"""桌面导出桥：二进制导出必须真正写入用户选择的路径。"""

from __future__ import annotations

import base64
from pathlib import Path

from netlab.desktop.webview_bridge import WebviewBridge


def test_save_bytes_writes_png(tmp_path, monkeypatch):
    target = tmp_path / "netlab-analysis.png"
    bridge = WebviewBridge()
    monkeypatch.setattr(bridge, "_dialog", lambda **_: str(target))
    payload = b"\x89PNG\r\n\x1a\n" + b"chart-bytes"
    result = bridge.save_bytes("netlab-analysis.png", base64.b64encode(payload).decode("ascii"))
    assert result == str(target)
    assert Path(target).read_bytes() == payload


def test_save_bytes_cancel_returns_empty(tmp_path, monkeypatch):
    bridge = WebviewBridge()
    monkeypatch.setattr(bridge, "_dialog", lambda **_: "")
    assert bridge.save_bytes("x.png", base64.b64encode(b"x").decode("ascii")) == ""


def test_save_bytes_rejects_bad_base64():
    bridge = WebviewBridge()
    result = bridge.save_bytes("x.png", "not base64")
    assert result.startswith("__error__")
