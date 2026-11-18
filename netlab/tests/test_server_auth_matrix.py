"""受保护 API 的认证矩阵与一次性 bootstrap。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from netlab import server
from netlab.server import app

PROTECTED = "/api/network/states"


def test_browser_mode_without_token_is_open(monkeypatch):
    monkeypatch.setattr(server, "_DESKTOP_TOKEN", None)
    assert TestClient(app).get(PROTECTED).status_code == 200


def test_protected_api_token_matrix(monkeypatch):
    token = "auth-test-token-1"
    monkeypatch.setattr(server, "_DESKTOP_TOKEN", token)
    client = TestClient(app)

    assert client.get("/api/health").status_code == 200
    assert client.get(PROTECTED).status_code == 403
    assert client.get(PROTECTED, headers={"X-Netlab-Token": "wrong"}).status_code == 403

    ok = client.get(PROTECTED, headers={"X-Netlab-Token": token})
    assert ok.status_code == 200
    assert token not in ok.text


def test_session_cookie_grants_access_without_header(monkeypatch):
    token = "auth-test-token-2"
    monkeypatch.setattr(server, "_DESKTOP_TOKEN", token)
    monkeypatch.setattr(server, "_DESKTOP_BOOTSTRAP", "boot-once")
    client = TestClient(app, base_url="https://127.0.0.1")

    first = client.get("/__desktop_session__/boot-once", follow_redirects=False)
    assert first.status_code == 303
    cookie = first.headers["set-cookie"]
    assert "HttpOnly" in cookie
    assert "SameSite=strict" in cookie
    assert "Secure" in cookie
    assert "Max-Age=28800" in cookie
    assert token not in first.headers.get("location", "")
    assert client.get(PROTECTED).status_code == 200


def test_bootstrap_nonce_is_single_use(monkeypatch):
    monkeypatch.setattr(server, "_DESKTOP_TOKEN", "audit-token-789")
    monkeypatch.setattr(server, "_DESKTOP_BOOTSTRAP", "boot-once")
    client = TestClient(app, base_url="https://127.0.0.1")

    assert client.get("/__desktop_session__/boot-once", follow_redirects=False).status_code == 303
    replay = TestClient(app, base_url="https://127.0.0.1").get(
        "/__desktop_session__/boot-once", follow_redirects=False
    )
    assert replay.status_code == 404
    assert "set-cookie" not in replay.headers


def test_query_token_never_sets_cookie(monkeypatch):
    monkeypatch.setattr(server, "_DESKTOP_TOKEN", "query-only-token")
    page = TestClient(app).get("/?token=audit-token-000")
    assert page.status_code == 200
    assert "netlab_desktop_token" not in page.headers.get("set-cookie", "")
    assert "audit-token-000" not in page.text


def test_non_ascii_token_header_is_forbidden_not_500(monkeypatch):
    """S2：非 ASCII 头不能触发 compare_digest 的 TypeError 变成 500。"""
    monkeypatch.setattr(server, "_DESKTOP_TOKEN", "ascii-token")
    response = TestClient(app).get(PROTECTED, headers={"X-Netlab-Token": b"\xe9"})
    assert response.status_code == 403
    assert "ascii-token" not in response.text


def test_metadata_endpoints_require_token(monkeypatch):
    """S4：OpenAPI 与交互文档不得在无 token 时暴露接口清单。"""
    token = "meta-token"
    monkeypatch.setattr(server, "_DESKTOP_TOKEN", token)
    client = TestClient(app)
    for path in ("/openapi.json", "/docs", "/redoc"):
        assert client.get(path).status_code == 403, path
        assert client.get(path, headers={"X-Netlab-Token": token}).status_code == 200, path


def test_bootstrap_rejects_foreign_host_and_origin_without_consuming_nonce(monkeypatch):
    """S5：DNS rebinding / 外部 Origin 不能换到会话 cookie，且不能消耗 nonce。"""
    monkeypatch.setattr(server, "_DESKTOP_TOKEN", "bootstrap-token")
    monkeypatch.setattr(server, "_DESKTOP_BOOTSTRAP", "boot-once")

    evil = TestClient(app, base_url="https://evil.example")
    assert evil.get("/__desktop_session__/boot-once", follow_redirects=False).status_code == 404
    assert server._DESKTOP_BOOTSTRAP == "boot-once"

    local = TestClient(app, base_url="https://127.0.0.1")
    rejected = local.get(
        "/__desktop_session__/boot-once",
        headers={"Origin": "https://evil.example"},
        follow_redirects=False,
    )
    assert rejected.status_code == 404
    assert "set-cookie" not in rejected.headers
    assert server._DESKTOP_BOOTSTRAP == "boot-once"

    malformed = local.get(
        "/__desktop_session__/boot-once",
        headers={"Origin": "http://[::1"},
        follow_redirects=False,
    )
    assert malformed.status_code == 404
    assert server._DESKTOP_BOOTSTRAP == "boot-once"

    assert local.get("/__desktop_session__/boot-once", follow_redirects=False).status_code == 303
    assert server._DESKTOP_BOOTSTRAP == ""