"""Netlab 桌面运行时（PySide6 + QtWebEngine）。

模块职责：

* ``server_host``：在后台线程启动现有的 uvicorn/FastAPI，选择空闲端口；
* ``bridge``：QWebChannel 对象，提供原生文件对话框、工程读写和窗口状态；
* ``main_window``：原生窗口、菜单、最近文件、关闭确认；
* ``app``：入口与 ``--selftest``；
* ``selftest``：不依赖人工点击的后端/前端冒烟检查。

桌面模式复用现有 Web 前端与全部计算/业务逻辑，不重写界面。
"""

from __future__ import annotations

__all__ = ["main"]

from .app import main  # noqa: E402
