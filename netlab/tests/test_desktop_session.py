"""C-5：桌面会话 token 不进 URL 查询串，`--no-token` 仅调试构建可用。"""

from __future__ import annotations

import pytest

from netlab.desktop import webview_app


def test_session_url_uses_one_time_path_without_token_query():
    url = webview_app._session_url("http://127.0.0.1:9000/", "secret-token", "nonce")
    assert url == "http://127.0.0.1:9000/__desktop_session__/nonce"
    assert "?token=" not in url
    assert "secret-token" not in url


def test_session_url_without_token_is_plain_base():
    assert webview_app._session_url("http://127.0.0.1:9000/", None, None) == (
        "http://127.0.0.1:9000/"
    )


def test_session_url_requires_bootstrap_when_token_present():
    with pytest.raises(ValueError, match="bootstrap"):
        webview_app._session_url("http://127.0.0.1:9000/", "secret-token", None)


def test_no_token_requires_debug_build(monkeypatch):
    monkeypatch.delenv("NETLAB_DEBUG", raising=False)
    assert webview_app.main(["--no-token"]) == 2


def test_no_token_allowed_in_debug_build(monkeypatch):
    monkeypatch.setenv("NETLAB_DEBUG", "1")
    # 调试构建只校验开关；这里用 --selftest 避免真的开窗口。
    assert webview_app.main(["--no-token", "--selftest"]) == 0
