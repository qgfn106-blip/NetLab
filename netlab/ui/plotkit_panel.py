"""PlotKit 面板：唯一允许使用 QtWebEngine 的地方（spec C2/C5/D73）。

PlotKit 的编辑器保持原样（web 技术栈）；这里只做集成层的事：
1. 需要时才启动一个本机回环端口（随面板关闭而停止）；
2. 需要时才 import ``QtWebEngineWidgets`` 并创建视图；
3. 把 netlab 的主题、入口参数带进 URL，并在加载期给一个明确的进度提示。

也就是说：Chromium 仍在安装包里，但启动时不加载、不用时不加载。
"""

from __future__ import annotations

import os
import socket
import sys
import threading
import time
from pathlib import Path
from typing import Any

from PySide6.QtCore import QTimer, QUrl, Qt, Signal
from PySide6.QtWidgets import (
    QDockWidget,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

MOUNT = "/plotkit/"


def ensure_plotkit_importable() -> bool:
    """PlotKit 没装时，把同级仓库的 ``PlotKit/src`` 临时挂上 sys.path。"""
    try:
        import plotkit  # noqa: F401

        return True
    except Exception:
        pass
    candidate = Path(__file__).resolve().parents[3] / "PlotKit" / "src"
    if candidate.is_dir() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))
        try:
            import plotkit  # noqa: F401

            return True
        except Exception:
            return False
    return False


def _build_app() -> Any:
    """给面板用的 FastAPI 应用：能复用 netlab 已挂的子应用就复用。"""
    from .. import server as netlab_server

    if getattr(netlab_server, "PLOTKIT_MOUNTED", False):
        return netlab_server.app
    from fastapi import FastAPI

    from .. import plotkit_bridge

    app = FastAPI()
    return app if plotkit_bridge.mount(app) else None


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
        if not ensure_plotkit_importable():
            return False
        try:
            import uvicorn

            app = _build_app()
        except Exception:
            return False
        if app is None:
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
    """PlotKit 编辑器的停靠面板：懒加载 + 主题跟随 + 明确的加载态。"""

    opened = Signal()

    def __init__(self, parent: QWidget | None = None, *, theme: str = "light") -> None:
        super().__init__("PlotKit", parent)
        self.setAllowedAreas(Qt.LeftDockWidgetArea | Qt.RightDockWidgetArea | Qt.BottomDockWidgetArea)
        self._theme = "dark" if str(theme) == "dark" else "light"
        self._follow = True

        self._host = QWidget(self)
        outer = QVBoxLayout(self._host)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        bar = QWidget(self._host)
        bar.setObjectName("plotkit-bar")
        row = QHBoxLayout(bar)
        row.setContentsMargins(8, 4, 8, 4)
        row.setSpacing(6)
        self._status = QLabel("未加载", bar)
        self._status.setObjectName("plotkit-status")
        self._btn_reload = QPushButton("刷新", bar)
        self._btn_reload.setToolTip("重新加载 PlotKit 页面（数据不会丢，同步线程在服务端）")
        self._btn_browser = QPushButton("在浏览器打开", bar)
        self._btn_browser.setToolTip("用系统浏览器打开同一张图，便于并排对照")
        self._btn_float = QPushButton("浮动", bar)
        self._btn_float.setCheckable(True)
        self._btn_float.setToolTip("在停靠 / 独立窗口之间切换")
        for btn in (self._btn_reload, self._btn_browser, self._btn_float):
            row.addWidget(btn)
        row.addStretch(1)
        row.addWidget(self._status)
        outer.addWidget(bar)

        self._stack = QStackedWidget(self._host)
        self._placeholder = QLabel("PlotKit 面板尚未加载（首次打开会启动本机回环端口）。")
        self._placeholder.setWordWrap(True)
        self._placeholder.setAlignment(Qt.AlignCenter)
        self._placeholder.setObjectName("plotkit-placeholder")
        self._stack.addWidget(self._placeholder)
        outer.addWidget(self._stack, 1)
        self.setWidget(self._host)

        self._view: Any = None
        self._server: _PlotKitServer | None = None
        self._failed = False

        self._btn_reload.clicked.connect(self.reload)
        self._btn_browser.clicked.connect(self.open_in_browser)
        self._btn_float.toggled.connect(self.setFloating)

    # ---- 状态 -------------------------------------------------------------
    def _set_status(self, text: str) -> None:
        self._status.setText(text)

    def set_theme(self, name: str) -> None:
        """跟随主界面主题：先改服务端图的配色，再让页面按新主题重载。"""
        theme = "dark" if str(name) == "dark" else "light"
        try:
            from .. import plotkit_bridge

            plotkit_bridge.set_theme(theme == "dark")
        except Exception:
            pass
        if theme == self._theme:
            return
        self._theme = theme
        if self._follow and self._view is not None:
            self._view.setUrl(QUrl(self._url()))

    def _url(self) -> str:
        assert self._server is not None
        return f"{self._server.url}?embed=1&theme={self._theme}&source=netlab"

    # ---- 加载 -------------------------------------------------------------
    def ensure_loaded(self) -> None:
        if self._view is not None or self._failed:
            if self._view is not None:
                self._view.setFocus()
            return
        # 无 GPU / 受限桌面会话下 Chromium 起不来，表现为页面一直空白；
        # 本机若设了系统代理，Chromium 走代理访问 127.0.0.1 也会一直转圈。
        # 这里只加载本机回环页面，所以默认关 GPU 光栅化 + 绕开代理。
        # 若仍空白，可设 NETLAB_WEBENGINE_NO_SANDBOX=1 再试。
        os.environ.setdefault("QTWEBENGINE_CHROMIUM_FLAGS", "--disable-gpu --no-proxy-server")
        if os.environ.get("NETLAB_WEBENGINE_NO_SANDBOX") == "1":
            os.environ["QTWEBENGINE_DISABLE_SANDBOX"] = "1"
            flags = os.environ["QTWEBENGINE_CHROMIUM_FLAGS"]
            if "--no-sandbox" not in flags:
                os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = flags + " --no-sandbox"
        try:
            from PySide6.QtWebEngineWidgets import QWebEngineView
        except Exception as exc:  # 缺 QtWebEngine 时降级为提示，不影响主程序
            self._failed = True
            self._placeholder.setText(f"未安装 QtWebEngine，PlotKit 面板不可用：{exc}")
            self._set_status("不可用")
            return
        self._set_status("正在启动…")
        self._placeholder.setText("正在启动 PlotKit（首次约 1–3 秒）…")
        self._server = _PlotKitServer()
        if not self._server.start():
            self._failed = True
            self._placeholder.setText(
                "PlotKit 面板不可用：找不到 plotkit 包。\n"
                "可执行 pip install -e ../PlotKit，或把 PlotKit/src 加进 PYTHONPATH。"
            )
            self._set_status("不可用")
            return
        view = QWebEngineView(self._stack)
        view.loadStarted.connect(lambda: self._set_status("正在加载页面…"))
        view.loadProgress.connect(lambda p: self._set_status(f"正在加载 {p}%"))
        view.loadFinished.connect(self._on_loaded)
        self._view = view
        self._stack.addWidget(view)
        self._stack.setCurrentWidget(view)
        view.setUrl(QUrl(self._url()))
        self.opened.emit()

    def _nudge_resize(self) -> None:
        """让页面按当前实际尺寸重画一次。

        PlotKit 只在 ``window.resize`` 时重算画布尺寸；面板刚创建时容器还没有尺寸，
        首帧可能按一个很小的框渲染（布局会塌），这里补一次通知。
        """
        if self._view is None:
            return
        try:
            self._view.page().runJavaScript(
                "window.dispatchEvent(new Event('resize'));"
            )
        except Exception:
            pass

    def resizeEvent(self, event) -> None:  # noqa: N802
        super().resizeEvent(event)
        if self._view is None:
            return
        timer = getattr(self, "_resize_timer", None)
        if timer is None:
            timer = QTimer(self)
            timer.setSingleShot(True)
            timer.setInterval(220)
            timer.timeout.connect(self._nudge_resize)
            self._resize_timer = timer
        timer.start()

    def _on_loaded(self, ok: bool) -> None:
        if ok:
            self._set_status("就绪")
            QTimer.singleShot(260, self._nudge_resize)
            QTimer.singleShot(1200, self._nudge_resize)
        else:
            self._set_status("加载失败")
            self._placeholder.setText(
                "页面没能加载。若一直是空白，请用环境变量重试：\n"
                "  NETLAB_WEBENGINE_NO_SANDBOX=1 python -m netlab.desktop --native\n"
                "（受限桌面会话里 Chromium 的沙箱起不来）"
            )
            self._stack.setCurrentWidget(self._placeholder)

    def reload(self) -> None:
        if self._view is not None:
            self._set_status("正在刷新…")
            self._view.reload()
        elif not self._failed:
            self.ensure_loaded()

    def open_in_browser(self) -> None:
        if self._server is None:
            return
        from PySide6.QtGui import QDesktopServices

        QDesktopServices.openUrl(QUrl(self._url()))

    def set_theme_follow(self, follow: bool) -> None:
        self._follow = bool(follow)

    def closeEvent(self, event) -> None:  # noqa: N802
        if self._server is not None:
            self._server.stop()
            self._server = None
        super().closeEvent(event)


__all__ = ["PlotKitPanel"]
