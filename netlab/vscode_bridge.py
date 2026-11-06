"""VS Code Server 本地桥接。

把 VS Code 官方 Web 版服务器（``vscode-server-win32-x64-web``，即
``code serve-web`` 首启时下载的那份）作为子进程按需拉起，监听一个固定端口，
由前端用 iframe 直接加载 ``http://127.0.0.1:<port>/code/``。

为什么不在 FastAPI 里做反向代理：workbench 页面已经由 VS Code 自己按
``--server-base-path /code/`` 生成全部绝对路径，且页面没有 ``X-Frame-Options`` /
``frame-ancestors``；让 iframe 直接指向服务器，页面与它的 WebSocket 天然同源，
省掉代理对 HTTP 流式响应与 WebSocket 双向转发的全部复杂度。

为什么端口要固定（默认 8790，可用 ``NETLAB_VSCODE_PORT`` 覆盖）：
WebView2 的磁盘缓存按 origin（含端口）分区。若每次随机端口，则每次启动都是新
origin、缓存全部失效，workbench 的 ~21.5MB 前端包每次都要重新下载解析（冷启动
实测 5–8s）；固定端口后同一 origin 命中缓存，二次打开只需 ~1.7s。若端口被别的
程序占用，才退化到随机空闲端口。若 8790 上已有一个可响应的 VS Code 服务器
（例如上次异常退出遗留的进程），直接复用它，不再重复拉起。

服务器目录查找顺序（第一个含 ``out/server-main.js`` 的生效）：
1. 环境变量 ``NETLAB_VSCODE_SERVER_DIR``；
2. ``%LOCALAPPDATA%/netlab/vscode-server/vscode-server-win32-x64-web``；
3. 仓库内开发位置 ``<ProjectPoint>/NetlabExtras/vscode-server/server/vscode-server-win32-x64-web``。
"""

from __future__ import annotations

import atexit
import json
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any
from urllib.request import urlopen

_HOST = "127.0.0.1"
_BASE_PATH = "/code/"
_START_TIMEOUT = 40.0
_DEFAULT_PORT = 8790

_lock = threading.Lock()
_proc: subprocess.Popen | None = None
_port: int | None = None
_error: str | None = None
_log_path: Path | None = None
_external = False  # 复用了一个不是本进程拉起、但在目标端口上已可用的服务器


def _candidates() -> list[Path]:
    here = Path(__file__).resolve()
    out: list[Path] = []
    override = os.environ.get("NETLAB_VSCODE_SERVER_DIR")
    if override:
        out.append(Path(override))
    local = os.environ.get("LOCALAPPDATA")
    if local:
        out.append(
            Path(local) / "netlab" / "vscode-server" / "vscode-server-win32-x64-web"
        )
    # here = NetlabHome/netlab/vscode_bridge.py -> parents[2] = ProjectPoint
    out.append(
        here.parents[2]
        / "NetlabExtras"
        / "vscode-server"
        / "server"
        / "vscode-server-win32-x64-web"
    )
    return out


def find_server_dir() -> Path | None:
    """返回可用的 VS Code Server 目录；找不到时返回 None。"""
    for cand in _candidates():
        if (cand / "out" / "server-main.js").is_file():
            if (cand / "node.exe").is_file() or shutil.which("node"):
                return cand
    return None


def _node_exec(server_dir: Path) -> str | None:
    bundled = server_dir / ("node.exe" if os.name == "nt" else "node")
    if bundled.is_file():
        return str(bundled)
    return shutil.which("node")


def _bundled_extension_root() -> Path | None:
    """仓库内置的 VS Code 扩展源目录（NetlabHome/vscode-extensions）。"""
    root = Path(__file__).resolve().parents[1] / "vscode-extensions"
    return root if root.is_dir() else None


def _extensions_dir() -> Path:
    """VS Code Server 默认扩展目录（与服务端默认 server-data-dir 对应）。"""
    data = os.environ.get("NETLAB_VSCODE_DATA_DIR")
    if data:
        return Path(data) / "extensions"
    return Path.home() / ".vscode-server" / "extensions"


def _bundled_vsix() -> Path | None:
    root = _bundled_extension_root()
    if root is None:
        return None
    found = sorted(root.glob("*.vsix"))
    return found[-1] if found else None


def _install_bundled_extensions(server_dir: Path, node: str) -> None:
    """安装仓库内置的 VS Code 扩展。

    优先用官方 CLI ``--install-extension <vsix>``：只有这样写出的
    ``extensions.json`` 条目才带 ``metadata``，VS Code 才会真正加载扩展
    （纯目录复制会被当成 external source，活动栏不出现）。成功后写一个
    marker，避免每次启动都重新安装；失败则回退到目录复制。
    """
    vsix = _bundled_vsix()
    dest_root = _extensions_dir()
    try:
        dest_root.mkdir(parents=True, exist_ok=True)
    except Exception:
        return
    if vsix is not None:
        marker = dest_root / (".netlab-ext-" + vsix.stem)
        if marker.is_file():
            return
        cmd = [
            node,
            str(server_dir / "out" / "server-main.js"),
            "--install-extension",
            str(vsix),
            "--extensions-dir",
            str(dest_root),
            "--accept-server-license-terms",
            "--disable-telemetry",
        ]
        kwargs: dict[str, Any] = {}
        if os.name == "nt":
            kwargs["creationflags"] = 0x08000000
        try:
            proc = subprocess.run(
                cmd,
                cwd=str(server_dir),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=180,
                **kwargs,
            )
            if proc.returncode == 0:
                marker.write_text(vsix.name, encoding="utf-8")
                return
        except Exception:
            pass

    root = _bundled_extension_root()
    if root is None:
        return
    for src in root.iterdir():
        pkg = src / "package.json"
        if not (src.is_dir() and pkg.is_file()):
            continue
        try:
            meta = json.loads(pkg.read_text(encoding="utf-8"))
        except Exception:
            continue
        folder = "{}.{}-{}".format(
            meta.get("publisher", "netlab"),
            meta.get("name", src.name),
            meta.get("version", "0.0.1"),
        )
        dest = dest_root / folder
        if dest.exists():
            continue
        try:
            shutil.copytree(src, dest)
        except Exception:
            pass


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((_HOST, 0))
        return int(sock.getsockname()[1])


def _bindable(port: int) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind((_HOST, port))
            return True
    except OSError:
        return False


def _serves(port: int | None) -> bool:
    if not port:
        return False
    try:
        with urlopen(f"http://{_HOST}:{port}{_BASE_PATH}", timeout=1.0) as resp:
            return resp.status == 200
    except Exception:
        return False


def _preferred_port() -> int:
    raw = os.environ.get("NETLAB_VSCODE_PORT")
    if raw:
        try:
            return int(raw)
        except ValueError:
            pass
    return _DEFAULT_PORT


def _default_folder() -> Path:
    override = os.environ.get("NETLAB_VSCODE_FOLDER")
    if override:
        return Path(override)
    # here = NetlabHome/netlab/vscode_bridge.py -> parents[1] = NetlabHome
    return Path(__file__).resolve().parents[1]


def _running() -> bool:
    if _proc is not None and _proc.poll() is None:
        return True
    if _external and _port is not None:
        return _serves(_port)
    return False


def _snapshot() -> dict[str, Any]:
    running = _running()
    return {
        "available": find_server_dir() is not None,
        "running": running,
        "url": f"http://{_HOST}:{_port}{_BASE_PATH}" if running and _port else None,
        "port": _port if running else None,
        "error": _error,
    }


def status(start_request: bool = False) -> dict[str, Any]:
    """查询状态；``start_request=True`` 时确保服务器已拉起（可能阻塞数秒）。"""
    if start_request:
        return start()
    with _lock:
        return _snapshot()


def start() -> dict[str, Any]:
    """拉起服务器（幂等）。返回与 :func:`status` 相同的状态字典。"""
    global _proc, _port, _error, _log_path, _external

    with _lock:
        if _proc is not None and _proc.poll() is None:
            return _snapshot()
        if _external and _serves(_port):
            return _snapshot()

        _error = None
        _proc = None
        _port = None
        _external = False

        server_dir = find_server_dir()
        if server_dir is None:
            _error = (
                "未找到 VS Code Server 目录；请设置环境变量 NETLAB_VSCODE_SERVER_DIR "
                "指向 vscode-server-win32-x64-web"
            )
            return _snapshot()

        node = _node_exec(server_dir)
        if node is None:
            _error = "未找到 Node 运行时（服务器目录内 node.exe 或 PATH 中的 node）"
            return _snapshot()

        preferred = _preferred_port()
        # 目标端口上已有可响应的服务器（上次遗留 / 另一个 netlab 实例）：直接复用。
        if _serves(preferred):
            _external = True
            _port = preferred
            return _snapshot()

        port = preferred if _bindable(preferred) else _free_port()
        _install_bundled_extensions(server_dir, node)
        cmd = [
            node,
            str(server_dir / "out" / "server-main.js"),
            "--host",
            _HOST,
            "--port",
            str(port),
            "--without-connection-token",
            "--server-base-path",
            _BASE_PATH,
            "--disable-telemetry",
            "--accept-server-license-terms",
            "--disable-workspace-trust",
            "--default-folder",
            str(_default_folder()),
        ]

        _log_path = Path(tempfile.gettempdir()) / "netlab-vscode-server.log"
        log_handle = open(_log_path, "ab", buffering=0)
        kwargs: dict[str, Any] = {}
        if os.name == "nt":
            kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
        try:
            proc = subprocess.Popen(
                cmd,
                cwd=str(server_dir),
                stdin=subprocess.DEVNULL,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                **kwargs,
            )
        except Exception as exc:  # pragma: no cover - 依赖本地环境
            _error = f"启动 VS Code Server 失败：{exc}"
            return _snapshot()

        _proc, _port, _external = proc, port, False
        deadline = time.time() + _START_TIMEOUT
        while time.time() < deadline:
            if proc.poll() is not None:
                _error = (
                    f"VS Code Server 退出（code {proc.returncode}），"
                    f"日志见 {_log_path}"
                )
                _proc = None
                _port = None
                return _snapshot()
            try:
                with urlopen(f"http://{_HOST}:{port}{_BASE_PATH}", timeout=1.0) as resp:
                    if resp.status == 200:
                        return _snapshot()
            except Exception:
                time.sleep(0.25)

        _error = f"VS Code Server 启动超时（{_START_TIMEOUT:.0f}s），日志见 {_log_path}"
        return _snapshot()


def shutdown() -> None:
    """停止本进程拉起的子进程（应用退出时调用）；复用的外部服务器不处理。"""
    global _proc, _external
    with _lock:
        proc = _proc
        _proc = None
        _external = False
        if proc is not None and proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except Exception:  # pragma: no cover - 依赖本地环境
                try:
                    proc.kill()
                except Exception:
                    pass


atexit.register(shutdown)
