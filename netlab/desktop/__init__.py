"""Netlab 桌面运行时。

默认外壳是 pywebview + WebView2（``webview_app``）。下面的 Qt 壳
（``app``/``main_window``/``bridge``，PySide6 + QtWebEngine）是 2026-11-02 D78
之前的回退实现，仍可手工 ``python -m netlab.desktop.app`` 使用，但**默认不再
导入**——导入 PySide6 会多花时间和内存，正常启动不该付这个账。

模块职责：

模块职责：

* ``server_host``：在后台线程启动现有的 uvicorn/FastAPI，选择空闲端口；
* ``bridge``：QWebChannel 对象，提供原生文件对话框、工程读写和窗口状态；
* ``main_window``：原生窗口、菜单、最近文件、关闭确认；
* ``app``：入口与 ``--selftest``；
* ``selftest``：不依赖人工点击的后端/前端冒烟检查。

桌面模式复用现有 Web 前端与全部计算/业务逻辑，不重写界面。
"""

from __future__ import annotations

from typing import Any

__all__ = ["main"]


def __getattr__(name: str) -> Any:
    """按需导入（PEP 562）：只有真正要用 Qt 入口时才拉 PySide6。"""
    if name == "main":
        from .app import main as _main

        return _main
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
