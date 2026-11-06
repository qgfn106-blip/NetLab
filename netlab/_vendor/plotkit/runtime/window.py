"""QtWebEngine 原生窗口（可选依赖 PySide6）。

为什么不自己写窗口框架：netlab 的 `netlab/desktop.py` 已经验证过这套壳
（PySide6 6.9.2 + QtWebEngine/Chromium 130 + QWebChannel）。这里只保留最小可用版本：
起本地服务 → QWebEngineView 打开 → 关窗即停服务。QWebChannel 桥（request_resize /
close / save_png / on_spec_changed）留给接入 netlab 时再挂，避免第一版就耦合。
"""

from __future__ import annotations

from typing import Any

from ..server.live import LiveServer

DEFAULT_SIZE = (1280, 860)


def open_window(
    figure: Any,
    *,
    port: int = 0,
    block: bool | None = None,
    title: str | None = None,
    size: tuple[int, int] = DEFAULT_SIZE,
) -> Any:
    from PySide6.QtCore import QUrl
    from PySide6.QtGui import QColor
    from PySide6.QtWidgets import QApplication
    from PySide6.QtWebEngineWidgets import QWebEngineView

    server = LiveServer(figure, port=port, title=title)
    server.start()

    app = QApplication.instance()
    if app is None:
        app = QApplication([])

    view = QWebEngineView()
    page = view.page()
    page.setBackgroundColor(QColor("#ffffff"))
    view.setWindowTitle(
        title or str(figure.spec.get("figure", {}).get("title") or "PlotKit")
    )
    view.resize(*size)
    view.load(QUrl(server.url))
    view.show()

    def _cleanup(*_: Any) -> None:
        server.stop()

    view.destroyed.connect(_cleanup)
    app.aboutToQuit.connect(_cleanup)

    if block if block is not None else True:
        try:
            app.exec()
        finally:
            _cleanup()
    return view
