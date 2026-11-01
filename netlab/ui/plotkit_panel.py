"""PlotKit 面板：唯一允许使用 QtWebEngine 的地方（spec C2/C5/D73）。

PlotKit 的编辑器保持原样（web 技术栈，一行不改）；这里只做两件事：
1. 需要时才启动一个本机回环端口（随面板关闭而停止）；
2. 需要时才 import ``QtWebEngineWidgets`` 并创建视图。

也就是说：Chromium 仍在安装包里，但启动时不加载、不用时不加载。
"""

from __future__ import annotations

import socket
import threading
import time
from typing import Any

from PySide6.QtCore import QUrl, Qt
from PySide6.QtWidgets import QDockWidget, QLabel, QVBoxLayout, QWidget

MOUNT = "/plotkit/"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class _PlotKitServer:
    """在后台线程里跑一个只服务本机的 uvicorn。"""

    def __init__(self) -> None:
        self.port = _free_port()
        self._server: Any = None
        self._thread: threading.Thread | None = None

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}{MOUNT}"

    def start(self, timeout: float = 15.0) -> bool:
        if self._thread is not None:
            return True
        try:
            import uvicorn

            from ..server import app
        except Exception:
            return False
        config = uvicorn.Config(app, host="127.0.0.1", port=self.port, log_level="warning")
        self._server = uvicorn.Server(config)
        self._thread = threading.Thread(target=self._server.run, name="netlab-plotkit-http", daemon=True)
        self._thread.start()
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                with socket.create_connection(("127.0.0.1", self.port), timeout=0.25):
                    return True
            except OSError:
                time.sleep(0.1)
        return False

    def stop(self) -> None:
        if self._server is not None:
            self._server.should_exit = True
        if self._thread is not None:
            self._thread.join(timeout=3.0)
        self._server = None
        self._thread = None


class PlotKitPanel(QDockWidget):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__("PlotKit", parent)
        self.setAllowedAreas(Qt.LeftDockWidgetArea | Qt.RightDockWidgetArea | Qt.BottomDockWidgetArea)
        self._host = QWidget(self)
        self._layout = QVBoxLayout(self._host)
        self._layout.setContentsMargins(0, 0, 0, 0)
        self._placeholder = QLabel("PlotKit 面板尚未加载（首次打开会启动本机回环端口）。")
        self._placeholder.setWordWrap(True)
        self._placeholder.setAlignment(Qt.AlignCenter)
        self._layout.addWidget(self._placeholder)
        self.setWidget(self._host)
        self._view: Any = None
        self._server: _PlotKitServer | None = None
        self._failed = False

    def ensure_loaded(self) -> None:
        if self._view is not None or self._failed:
            return
        try:
            from PySide6.QtWebEngineWidgets import QWebEngineView
        except Exception as exc:  # 缺 QtWebEngine 时降级为提示，不影响主程序
            self._failed = True
            self._placeholder.setText(f"未安装 QtWebEngine，PlotKit 面板不可用：{exc}")
            return
        self._server = _PlotKitServer()
        if not self._server.start():
            self._failed = True
            self._placeholder.setText("PlotKit 服务启动失败（plotkit 未安装或端口不可用）。")
            return
        self._view = QWebEngineView(self)
        self._view.setUrl(QUrl(self._server.url))
        self._layout.replaceWidget(self._placeholder, self._view)
        self._placeholder.hide()

    def reload(self) -> None:
        if self._view is not None:
            self._view.reload()

    def closeEvent(self, event) -> None:  # noqa: N802
        if self._server is not None:
            self._server.stop()
            self._server = None
        super().closeEvent(event)


__all__ = ["PlotKitPanel"]
