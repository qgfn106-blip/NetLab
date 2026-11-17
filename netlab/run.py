"""Netlab 一键启动入口。

默认绑定 127.0.0.1:8010，并自动打开浏览器；也可以从命令行覆盖：

    python -m netlab.run --port 8020 --no-browser
"""

from __future__ import annotations

import argparse
import ipaddress
import os
import sys
import threading
import time
import webbrowser

LOOPBACK_HOST_NAMES = frozenset({"localhost"})
UNSAFE_WARNING = (
    "警告：--unsafe-no-auth 已启用，服务将无认证暴露在非回环地址 {host} 上；"
    "仅限受信网络临时使用。"
)


def is_loopback_host(host: str) -> bool:
    """判断监听地址是否仅限本机（localhost、IPv4/IPv6 回环）。"""
    value = (host or "").strip().strip("[]")
    if not value:
        return False
    if value.lower() in LOOPBACK_HOST_NAMES:
        return True
    try:
        return ipaddress.ip_address(value).is_loopback
    except ValueError:
        return False


def validate_security(host: str, token: str | None, unsafe_no_auth: bool) -> str | None:
    """返回错误信息；None 表示启动策略允许。"""
    if is_loopback_host(host):
        return None
    if token:
        return None
    if unsafe_no_auth:
        return None
    return (
        f"拒绝启动：--host {host} 不是回环地址，但没有访问令牌。"
        "请用 --token 或 NETLAB_DESKTOP_TOKEN 指定令牌；"
        "只在完全受信的隔离网络中才可显式使用 --unsafe-no-auth。"
    )


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
    parser.add_argument(
        "--token",
        default=None,
        help="API 访问令牌（也可用 NETLAB_DESKTOP_TOKEN 环境变量；不要写进 URL）",
    )
    parser.add_argument(
        "--unsafe-no-auth",
        action="store_true",
        help="显式允许非回环地址在无令牌下启动（仅限受信网络，风险自负）",
    )
    parser.add_argument(
        "--no-browser", action="store_true", help="启动后不自动打开浏览器"
    )
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
    token = args.token or os.environ.get("NETLAB_DESKTOP_TOKEN")
    error = validate_security(args.host, token, args.unsafe_no_auth)
    if error:
        print(error, file=sys.stderr, flush=True)
        return 2
    if token:
        # 在导入 netlab.server 前写入环境变量：server 模块在导入时读取 token。
        os.environ["NETLAB_DESKTOP_TOKEN"] = token
    elif args.unsafe_no_auth and not is_loopback_host(args.host):
        print(UNSAFE_WARNING.format(host=args.host), file=sys.stderr, flush=True)
    # 先做一次端口探测，给出比 uvicorn 更直白的提示。
    import socket

    try:
        with socket.create_server((args.host, args.port)):
            pass
    except OSError:
        print(f"端口 {args.port} 已被占用，无法启动。", file=sys.stderr, flush=True)
        print(
            f"请改用：python run.py --port {args.port + 1}", file=sys.stderr, flush=True
        )
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
        print(
            "端口可能已被占用，可使用 --port 指定其它端口。",
            file=sys.stderr,
            flush=True,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
