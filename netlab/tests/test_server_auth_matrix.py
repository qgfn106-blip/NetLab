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
    client = TestClient(app)

    first = client.get("/__desktop_session__/boot-once", follow_redirects=False)
    assert first.status_code == 303
    cookie = first.headers["set-cookie"]
    assert "HttpOnly" in cookie
    assert "SameSite=strict" in cookie
    assert token not in first.headers.get("location", "")
    assert client.get(PROTECTED).status_code == 200


def test_bootstrap_nonce_is_single_use(monkeypatch):
    monkeypatch.setattr(server, "_DESKTOP_TOKEN", "audit-token-789")
    monkeypatch.setattr(server, "_DESKTOP_BOOTSTRAP", "boot-once")
    client = TestClient(app)

    assert client.get("/__desktop_session__/boot-once", follow_redirects=False).status_code == 303
    replay = TestClient(app).get("/__desktop_session__/boot-once", follow_redirects=False)
    assert replay.status_code == 404
    assert "set-cookie" not in replay.headers


def test_query_token_never_sets_cookie(monkeypatch):
    monkeypatch.setattr(server, "_DESKTOP_TOKEN", "query-only-token")
    page = TestClient(app).get("/?token=audit-token-000")
    assert page.status_code == 200
    assert "netlab_desktop_token" not in page.headers.get("set-cookie", "")
    assert "audit-token-000" not in page.text