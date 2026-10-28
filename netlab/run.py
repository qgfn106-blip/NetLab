"""Netlab 一键启动入口。

默认绑定 127.0.0.1:8010，并自动打开浏览器；也可以从命令行覆盖：

    python run.py --port 8020 --no-browser
"""

from __future__ import annotations

import argparse
import sys
import threading
import time
import webbrowser
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
PACKAGE_PARENT = PROJECT_ROOT.parent
if str(PACKAGE_PARENT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_PARENT))


def setup_console() -> None:
    """让 Windows 控制台按 UTF-8 显示中文启动信息（失败时静默忽略）。"""
    if sys.platform != "win32":
        return
    try:
        import ctypes

        kernel32 = ctypes.windll.kernel32
        kernel32.SetConsoleOutputCP(65001)
        kernel32.SetConsoleCP(65001)
    except Exception:
        pass
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Netlab 拓扑网络仿真台：节点数据流 + 状态空间 + 节点电压法",
    )
    parser.add_argument("--host", default="127.0.0.1", help="监听地址（默认仅本机）")
    parser.add_argument("--port", type=int, default=8010, help="监听端口（默认 8010）")
    parser.add_argument("--no-browser", action="store_true", help="启动后不自动打开浏览器")
    parser.add_argument(
        "--log-level",
        default="info",
        choices=("critical", "error", "warning", "info", "debug", "trace"),
        help="uvicorn 日志级别",
    )
    return parser.parse_args()


def open_browser_later(url: str) -> None:
    def worker() -> None:
        # 等后端真正可访问再打开，避免双击启动时浏览器先到、页面报连接失败。
        import urllib.request

        deadline = time.time() + 12.0
        while time.time() < deadline:
            try:
                urllib.request.urlopen(url + "api/health", timeout=0.6).read(64)
                break
            except Exception:
                time.sleep(0.25)
        try:
            webbrowser.open(url)
        except Exception:
            pass

    threading.Thread(target=worker, name="netlab-open-browser", daemon=True).start()


def main() -> int:
    setup_console()
    args = parse_args()
    # 先做一次端口探测，给出比 uvicorn 更直白的提示。
    import socket

    try:
        with socket.create_server((args.host, args.port)):
            pass
    except OSError:
        print(f"端口 {args.port} 已被占用，无法启动。", file=sys.stderr, flush=True)
        print(f"请改用：python run.py --port {args.port + 1}", file=sys.stderr, flush=True)
        return 1

    url_host = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
    url = f"http://{url_host}:{args.port}/"
    print(f"Netlab 启动中：{url}", flush=True)
    print(f"API 文档：{url}docs", flush=True)
    print("按 Ctrl+C 停止。", flush=True)
    if not args.no_browser:
        open_browser_later(url)

    import uvicorn

    from netlab.server import app

    try:
        uvicorn.run(app, host=args.host, port=args.port, log_level=args.log_level)
    except KeyboardInterrupt:
        pass
    except OSError as exc:
        print(f"启动失败：{exc}", file=sys.stderr, flush=True)
        print("端口可能已被占用，可使用 --port 指定其它端口。", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
