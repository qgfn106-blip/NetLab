"""桌面壳（pywebview + WebView2）。不 import webview，保证无 GUI 环境也能 import 本包。"""

from __future__ import annotations

from .server import ServerHandle, serve

__all__ = ["ServerHandle", "serve", "main"]


def main(argv: list[str] | None = None) -> int:
    from .app import main as _main

    return _main(argv)
