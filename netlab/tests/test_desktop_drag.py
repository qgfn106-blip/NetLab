"""桌面壳自绘拖窗的护栏：桥方法存在、垫片实现指针拖动、注入带版本号。"""
from __future__ import annotations

import inspect
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]          # NetlabHome/
SHIM = ROOT / "frontend" / "desktop-shim.js"


def test_bridge_exposes_move_api():
    from netlab.desktop.webview_bridge import WebviewBridge

    assert hasattr(WebviewBridge, "window_rect")
    assert hasattr(WebviewBridge, "window_move_to")
    src = inspect.getsource(WebviewBridge.window_move_to)
    assert "move(" in src


def test_shim_implements_pointer_drag():
    js = SHIM.read_text(encoding="utf-8")
    assert "window_move_to" in js
    assert "window_rect" in js
    assert "'pointerdown'" in js and "'pointermove'" in js
    # 交互控件必须被排除，否则点按钮会变成拖窗
    assert "INTERACTIVE" in js and "button" in js
    # 只在 pywebview 就绪后刷新窗口位置，避免拿到空 rect
    assert "pywebviewready" in js


def test_easy_drag_disabled():
    app = (ROOT / "netlab" / "desktop" / "webview_app.py").read_text(encoding="utf-8")
    assert re.search(r"easy_drag=False", app)


def test_shim_script_tag_is_versioned():
    server = (ROOT / "netlab" / "server.py").read_text(encoding="utf-8")
    assert re.search(r'desktop-shim\.js\?v=\d', server)
