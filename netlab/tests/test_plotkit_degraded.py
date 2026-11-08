"""PlotKit 不可用时的降级契约。

审计 C-4 / S5 验收：`/plotkit` 与其下任意子路径必须给出明确三态
（missing / incompatible / available 中的实际状态），
不得 404、不得 500、不得静默返回空页。
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from netlab import plotkit_bridge


@pytest.fixture(autouse=True)
def _clean_fallback_state():
    yield
    plotkit_bridge._STATE.pop("fallback_app", None)


def _client_with_state(monkeypatch, state: str, version=None, detail: str = "") -> TestClient:
    monkeypatch.setattr(
        plotkit_bridge,
        "probe",
        lambda: {"state": state, "version": version, "detail": detail},
    )
    app = FastAPI()
    plotkit_bridge.mount_fallback(app)
    return TestClient(app)


def test_missing_plotkit_returns_explicit_state(monkeypatch):
    client = _client_with_state(monkeypatch, "missing")
    for path in ("/plotkit/", "/plotkit/index.html", "/plotkit/api/spec", "/plotkit/api/channels"):
        response = client.get(path)
        assert response.status_code == 503, path
        payload = response.json()
        assert payload["state"] == "missing", path
        assert payload["detail"], path
        assert payload["path"] == path.rstrip("/"), path


def test_incompatible_plotkit_returns_readable_version_error(monkeypatch):
    client = _client_with_state(
        monkeypatch,
        "incompatible",
        "0.1.9",
        "PlotKit 0.1.9 不在 >=0.2,<0.3 兼容范围内",
    )
    response = client.get("/plotkit/api/spec")
    assert response.status_code == 503
    payload = response.json()
    assert payload["state"] == "incompatible"
    assert payload["version"] == "0.1.9"
    assert "0.2" in payload["detail"]


def test_fallback_handles_post_and_unknown_paths(monkeypatch):
    client = _client_with_state(monkeypatch, "missing")
    response = client.post("/plotkit/api/render")
    assert response.status_code == 503
    assert response.json()["state"] == "missing"
