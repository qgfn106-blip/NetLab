"""R14：帮助搜索结果与只读文档页。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from netlab.server import app


def _client() -> TestClient:
    return TestClient(app)


def test_help_search_finds_element_by_kind() -> None:
    with _client() as client:
        response = client.get("/api/help/search", params={"q": "thyristor"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] >= 1
    kinds = {(item["kind"], item.get("ref")) for item in payload["items"]}
    assert ("element", "thyristor") in kinds
    assert payload["items"][0]["kind"] == "element"
    assert payload["groups"][0]["label"] == "元件"
    assert payload["items"][0]["kind_label"] == "元件"


def test_help_search_finds_template() -> None:
    with _client() as client:
        template = client.get("/api/help/search", params={"q": "RC"}).json()
    assert any(item["kind"] == "template" for item in template["items"])


def test_help_search_empty_query_is_empty() -> None:
    with _client() as client:
        payload = client.get("/api/help/search", params={"q": "  "}).json()
    assert payload == {"q": "  ", "items": [], "count": 0}

