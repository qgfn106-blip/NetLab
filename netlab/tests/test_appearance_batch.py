"""阶段 2 P-B：外观批量端点与 Presentation 归属（ADR-005-lite）。

验收：一次校验/一次提交、失败原子回滚、外观不重编译引擎、旧项目兼容、HTTP 契约。
"""
from __future__ import annotations

import pytest

from netlab.core.common.limits import NotFoundError, ValidationError
from netlab.core.model.scene import Scene
from netlab.core.model.templates import build_template


def _signal_scene() -> Scene:
    scene = Scene("signal")
    scene.load_payload(build_template("signal_chain"))
    return scene


def _records(collection):
    return list(collection.values()) if isinstance(collection, dict) else list(collection)


def test_batch_appearance_single_revision_and_no_engine_rebuild() -> None:
    scene = _signal_scene()
    engine = scene.ensure_engine()
    assert scene._dirty is False
    node_id = next(iter(scene.nodes))
    edge_id = next(iter(scene.edges))
    before = scene.revision
    counts = scene.update_appearance_batch(
        nodes=[{"id": node_id, "appearance": {"strokeColor": "#AABBCC", "lineStyle": "dashed"}}],
        edges=[{"id": edge_id, "appearance": {"textColor": "#112233"}}],
    )
    assert counts == {"nodes": 1, "edges": 1}
    assert scene.revision == before + 1
    assert scene._dirty is False
    assert scene.ensure_engine() is engine
    assert scene.nodes[node_id].appearance == {"strokeColor": "#aabbcc", "lineStyle": "dashed"}
    assert scene.edges[edge_id].appearance == {"textColor": "#112233"}


def test_batch_appearance_atomic_on_unknown_id() -> None:
    scene = _signal_scene()
    node_id = next(iter(scene.nodes))
    before = scene.revision
    with pytest.raises(NotFoundError):
        scene.update_appearance_batch(
            nodes=[
                {"id": node_id, "appearance": {"strokeColor": "#AABBCC"}},
                {"id": "ffffffffffff", "appearance": {}},
            ]
        )
    assert scene.nodes[node_id].appearance == {}
    assert scene.revision == before


def test_batch_appearance_rejects_bad_value_before_writing() -> None:
    scene = _signal_scene()
    node_id = next(iter(scene.nodes))
    with pytest.raises(ValidationError):
        scene.update_appearance_batch(
            nodes=[{"id": node_id, "appearance": {"lineStyle": "wavy"}}]
        )
    assert scene.nodes[node_id].appearance == {}


def test_batch_appearance_over_limit_rejected() -> None:
    scene = _signal_scene()
    node_id = next(iter(scene.nodes))
    with pytest.raises(Exception) as excinfo:
        scene.update_appearance_batch(
            nodes=[{"id": node_id, "appearance": {}} for _ in range(5000)]
        )
    assert "过多" in str(excinfo.value) or "Limit" in type(excinfo.value).__name__


def test_single_appearance_only_patch_does_not_rebuild_engine() -> None:
    scene = _signal_scene()
    engine = scene.ensure_engine()
    node_id = next(iter(scene.nodes))
    edge_id = next(iter(scene.edges))
    scene.update_node(node_id, {"appearance": {"fillColor": "#AABBCC"}})
    assert scene._dirty is False
    assert scene.ensure_engine() is engine
    scene.update_edge(edge_id, {"appearance": {"strokeColor": "#AABBCC"}})
    assert scene._dirty is False
    assert scene.ensure_engine() is engine


def test_non_presentation_update_still_marks_dirty() -> None:
    scene = _signal_scene()
    scene.ensure_engine()
    node_id = next(iter(scene.nodes))
    scene.update_node(node_id, {"name": "renamed_node"})
    assert scene._dirty is True


def test_legacy_payload_without_appearance_keeps_default() -> None:
    scene = _signal_scene()
    payload = scene.to_payload()
    for node in _records(payload.get("nodes", [])):
        node.pop("appearance", None)
    for edge in _records(payload.get("edges", [])):
        edge.pop("appearance", None)
    restored = Scene("signal")
    restored.load_payload(payload)
    assert all(record.appearance == {} for record in restored.nodes.values())
    assert all(record.appearance == {} for record in restored.edges.values())


def test_api_appearance_batch_persists_and_is_atomic(client) -> None:
    exported = client.get("/api/scene/export").json()
    nodes = _records(exported.get("nodes", []))
    edges = _records(exported.get("edges", []))
    assert nodes and edges
    node_id, edge_id = nodes[0]["id"], edges[0]["id"]
    response = client.patch(
        "/api/scene/appearance",
        json={
            "nodes": [{"id": node_id, "appearance": {"strokeColor": "#AABBCC"}}],
            "edges": [{"id": edge_id, "appearance": {"lineStyle": "dotted"}}],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["updated"] == {"nodes": 1, "edges": 1}
    after = client.get("/api/scene/export").json()
    node_after = next(item for item in _records(after["nodes"]) if item["id"] == node_id)
    edge_after = next(item for item in _records(after["edges"]) if item["id"] == edge_id)
    assert node_after["appearance"]["strokeColor"] == "#aabbcc"
    assert edge_after["appearance"]["lineStyle"] == "dotted"

    bad = client.patch(
        "/api/scene/appearance",
        json={"nodes": [{"id": node_id, "appearance": {"lineStyle": "wavy"}}]},
    )
    assert bad.status_code >= 400, bad.text
    unchanged = client.get("/api/scene/export").json()
    node_unchanged = next(item for item in _records(unchanged["nodes"]) if item["id"] == node_id)
    assert node_unchanged["appearance"]["strokeColor"] == "#aabbcc"

    forbidden = client.patch("/api/scene/appearance", json={"bogus": 1})
    assert forbidden.status_code == 422
