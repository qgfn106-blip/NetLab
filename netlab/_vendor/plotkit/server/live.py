"""本地服务：把一份 Figure 起在一个后台线程里（uvicorn，可选依赖）。"""

from __future__ import annotations

import socket
import threading
import time
from typing import Any

from .app import create_app


def free_port(host: str = "127.0.0.1") -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return int(sock.getsockname()[1])


class LiveServer:
    def __init__(
        self,
        figure: Any,
        *,
        host: str = "127.0.0.1",
        port: int = 0,
        title: str | None = None,
    ) -> None:
        self.figure = figure
        self.host = host
        self.port = int(port) or free_port(host)
        self.title = title
        self._server: Any = None
        self._thread: threading.Thread | None = None

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}/"

    def start(self, *, timeout: float = 10.0) -> str:
        try:
            import uvicorn
        except ImportError as exc:  # pragma: no cover - 环境相关
            raise ImportError('需要 uvicorn：pip install -e ".[server]"') from exc

        app = create_app(self.figure, title=self.title)
        config = uvicorn.Config(
            app, host=self.host, port=self.port, log_level="warning", access_log=False
        )
        self._server = uvicorn.Server(config)
        self._thread = threading.Thread(
            target=self._server.run, name="plotkit-live", daemon=True
        )
        self._thread.start()

        deadline = time.time() + timeout
        while time.time() < deadline:
            if getattr(self._server, "started", False):
                return self.url
            if self._thread is not None and not self._thread.is_alive():
                break
            time.sleep(0.02)
        raise RuntimeError(f"PlotKit 服务启动超时: {self.url}")

    def stop(self) -> None:
        if self._server is not None:
            self._server.should_exit = True
        if self._thread is not None:
            self._thread.join(timeout=5.0)
            self._thread = None
        self._server = None

    def __enter__(self) -> "LiveServer":
        self.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self.stop()

    def __repr__(self) -> str:  # pragma: no cover
        return f"LiveServer(url={self.url!r}, running={bool(self._thread and self._thread.is_alive())})"
