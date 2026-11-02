"""R09 画布数据模型：节点尺寸、连线路由/拐点/锚点的校验与往返。"""

from __future__ import annotations

import copy

import pytest

from netlab.core.common.limits import LimitError, ValidationError
from netlab.core.model.scene import Scene


def build_scene() -> Scene:
    scene = Scene("signal")
    a = scene.add_node(name="a", kind="manual", data={"voltage": 1.0}, size={"w": 80})
    b = scene.add_node(name="b", kind="sum")
    scene.add_edge(
        source=a.id,
        target=b.id,
        kind="scale",
        params={"gain": 2.0},
        route="orthogonal",
        waypoints=[{"x": 10.0, "y": 20.0}, {"x": 30.0, "y": 40.0}],
        anchors={"source": "right", "target": "left"},
    )
    return scene


def test_geometry_fields_roundtrip():
    scene = build_scene()
    node = next(item for item in scene.nodes.values() if item.name == "a")
    assert node.size == {"w": 80.0}
    payload = scene.to_payload(include_state=False)
    assert payload["nodes"][0]["size"] == {"w": 80.0}
    edge_payload = payload["edges"][0]
    assert edge_payload["route"] == "orthogonal"
    assert edge_payload["waypoints"] == [{"x": 10.0, "y": 20.0}, {"x": 30.0, "y": 40.0}]
    assert edge_payload["anchors"] == {"source": "right", "target": "left"}

    restored = Scene("signal")
    restored.load_payload(copy.deepcopy(payload))
    restored_node = next(item for item in restored.nodes.values() if item.name == "a")
    restored_edge = next(iter(restored.edges.values()))
    assert restored_node.size == {"w": 80.0}
    assert restored_edge.route == "orthogonal"
    assert restored_edge.waypoints == [{"x": 10.0, "y": 20.0}, {"x": 30.0, "y": 40.0}]
    assert restored_edge.anchors == {"source": "right", "target": "left"}


def test_invalid_size_and_geometry_are_rejected():
    scene = Scene("signal")
    a = scene.add_node(name="a", kind="manual")
    b = scene.add_node(name="b", kind="sum")
    with pytest.raises(ValidationError, match="节点尺寸"):
        scene.update_node(a.id, {"size": {"w": 10}})
    with pytest.raises(ValidationError, match="节点尺寸"):
        scene.update_node(a.id, {"size": {"w": 300}})
    with pytest.raises(ValidationError, match="节点尺寸"):
        scene.update_node(a.id, {"size": {"z": 50}})

    with pytest.raises(ValidationError, match="路由方式"):
        scene.add_edge(source=a.id, target=b.id, kind="scale", route="curvy")
    with pytest.raises(LimitError, match="拐点最多"):
        scene.add_edge(
            source=a.id,
            target=b.id,
            kind="scale",
            waypoints=[{"x": 1.0, "y": 2.0}] * 65,
        )
    with pytest.raises(ValidationError, match="锚点 source"):
        scene.add_edge(
            source=a.id, target=b.id, kind="scale", anchors={"source": "middle"}
        )


def test_api_updates_geometry(client):
    exported = client.get("/api/scene/export").json()
    node = exported["nodes"][0]
    edge = exported["edges"][0]

    resized = client.patch(f"/api/nodes/{node['id']}", json={"size": {"w": 90}})
    assert resized.status_code == 200, resized.text
    assert resized.json()["node"]["size"] == {"w": 90.0}

    routed = client.patch(
        f"/api/edges/{edge['id']}",
        json={
            "route": "manual",
            "waypoints": [{"x": 120.0, "y": -40.0}],
            "anchors": {"source": "bottom", "target": "top"},
        },
    )
    assert routed.status_code == 200, routed.text
    body = routed.json()["edge"]
    assert body["route"] == "manual"
    assert body["waypoints"] == [{"x": 120.0, "y": -40.0}]
    assert body["anchors"] == {"source": "bottom", "target": "top"}

    state = client.get("/api/state").json()
    edge_state = next(item for item in state["scene"]["edges"] if item["id"] == edge["id"])
    assert edge_state["route"] == "manual"

    bad = client.patch(f"/api/edges/{edge['id']}", json={"route": "zigzag"})
    assert bad.status_code == 422
    assert "路由方式" in bad.json()["detail"]
