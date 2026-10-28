"""在后台线程运行现有 FastAPI 应用，并选择本机空闲端口。"""

from __future__ import annotations

import os
import socket
import threading
import time
import urllib.request
from typing import Any


def find_free_port(host: str = "127.0.0.1") -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return int(sock.getsockname()[1])


def _wait_ready(url: str, timeout: float = 20.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url + "api/health", timeout=0.8) as response:
                if response.status == 200:
                    return True
        except Exception:
            time.sleep(0.15)
    return False


class ServerHost:
    """拥有一个 uvicorn Server 实例；只监听 127.0.0.1。"""

    def __init__(self, host: str = "127.0.0.1", port: int | None = None) -> None:
        self.host = host
        self.port = int(port) if port else find_free_port(host)
        self.url = f"http://{host}:{self.port}/"
        self._thread: threading.Thread | None = None
        self._server: Any = None
        self._ready = False

    def start(self, *, token: str | None = None, log_level: str = "warning") -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        if token:
            os.environ["NETLAB_DESKTOP_TOKEN"] = token
        import uvicorn

        from netlab.server import app

        config = uvicorn.Config(
            app,
            host=self.host,
            port=self.port,
            log_level=log_level,
            access_log=False,
            lifespan="on",
        )
        self._server = uvicorn.Server(config)
        self._thread = threading.Thread(
            target=self._server.run,
            name="netlab-desktop-server",
            daemon=True,
        )
        self._thread.start()
        self._ready = _wait_ready(self.url)
        if not self._ready:
            raise RuntimeError(f"本地服务未能在 {self.url} 启动")

    @property
    def ready(self) -> bool:
        return self._ready

    def stop(self) -> None:
        server = self._server
        if server is not None:
            server.should_exit = True
        thread = self._thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=5.0)
        self._thread = None
        self._server = None
        self._ready = False

    def __enter__(self) -> "ServerHost":
        self.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.stop()
