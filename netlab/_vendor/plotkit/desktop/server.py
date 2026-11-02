"""把现有 FastAPI 应用挂到本地端口，供桌面壳加载（pywebview 原型）。"""

from __future__ import annotations

import socket
import threading
import time
from dataclasses import dataclass


@dataclass
class ServerHandle:
    """后台线程里跑的 uvicorn；`stop()` 后端口释放。"""

    url: str
    port: int
    thread: threading.Thread
    server: object

    def stop(self, timeout: float = 5.0) -> None:
        try:
            self.server.should_exit = True  # type: ignore[attr-defined]
        except Exception:
            pass
        self.thread.join(timeout)


def _free_port(host: str) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return int(sock.getsockname()[1])


def serve(app, *, host: str = "127.0.0.1", port: int = 0, ready_timeout: float = 20.0) -> ServerHandle:
    """在后台线程启动 uvicorn，返回可访问的 URL。

    只绑 127.0.0.1：桌面壳不需要对外暴露；端口 0 = 让系统挑空闲端口。
    """
    import uvicorn

    port = int(port) or _free_port(host)
    config = uvicorn.Config(app, host=host, port=port, log_level="warning", access_log=False)
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, name="plotkit-desktop-server", daemon=True)
    thread.start()

    deadline = time.monotonic() + ready_timeout
    while time.monotonic() < deadline:
        if getattr(server, "started", False):
            return ServerHandle(f"http://{host}:{port}", port, thread, server)
        if not thread.is_alive():
            raise RuntimeError("本地服务线程意外退出，端口可能被占用")
        time.sleep(0.01)
    raise RuntimeError("本地服务启动超时")
