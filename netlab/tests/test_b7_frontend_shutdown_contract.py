"""B7 F-02：/api/shutdown 前端契约——浏览器走带 token 的 api()，桌面走 pywebview 原生关闭。"""
from __future__ import annotations
import os


def _read(rel: str) -> str:
    root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    with open(os.path.join(root, rel), encoding="utf-8") as fh:
        return fh.read()


def test_app_ts_shutdown_uses_api_helper_and_desktop_close():
    src = _read("frontend/app.ts")
    # 不再有裸 fetch('/api/shutdown')
    assert "fetch('/api/shutdown'" not in src
    assert 'fetch("/api/shutdown"' not in src
    # 浏览器模式经 api() 附带 token；桌面走 pywebview 原生关闭
    assert "api('/api/shutdown'" in src
    assert "pywebview" in src and "window_close" in src


def test_net_helper_sends_desktop_token_header():
    src = _read("frontend/app/net.ts")
    assert "headers['X-Netlab-Token'] = DESKTOP_TOKEN" in src
