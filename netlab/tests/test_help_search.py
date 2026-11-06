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


def test_help_search_finds_template_and_doc() -> None:
    with _client() as client:
        template = client.get("/api/help/search", params={"q": "RC"}).json()
        doc = client.get("/api/help/search", params={"q": "求解器"}).json()
    assert any(item["kind"] == "template" for item in template["items"])
    assert any(item["kind"] == "doc" for item in doc["items"])


def test_help_search_empty_query_is_empty() -> None:
    with _client() as client:
        payload = client.get("/api/help/search", params={"q": "  "}).json()
    assert payload == {"q": "  ", "items": [], "count": 0}


def test_help_doc_renders_and_rejects_path_traversal() -> None:
    with _client() as client:
        ok = client.get(
            "/api/help/doc", params={"path": "REQUIREMENTS_AND_RULES.md", "line": 3}
        )
        bad = client.get("/api/help/doc", params={"path": "../server.py"})
    assert ok.status_code == 200
    assert "REQUIREMENTS_AND_RULES.md" in ok.text
    assert bad.status_code == 404
