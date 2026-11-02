"""R19 图纸模型：引脚绑定、布局校验、确定性自动布局。"""

from __future__ import annotations

import pytest

from netlab.core.model import schematic
from netlab.core.common.limits import ValidationError
from netlab.core.model.scene import Scene
from netlab.core.model.templates import build_template


def circuit_scene():
    scene = Scene("circuit")
    scene.load_payload(build_template("rlc_series"))
    return scene


def test_auto_layout_is_deterministic_and_on_grid():
    scene = circuit_scene()
    first = schematic.auto_layout(scene)
    second = schematic.auto_layout(scene)
    assert first == second
    assert first["ok"] is True
    for position in first["nodes"].values():
        assert position["x"] % 20 == 0
        assert position["y"] % 20 == 0
    for item in first["edges"].values():
        assert item["rot"] % 30 == 0


def test_apply_layout_sets_nodes_and_edge_layout():
    scene = circuit_scene()
    layout = schematic.auto_layout(scene)
    applied = schematic.apply_layout(scene, layout)
    assert applied["nodes"] == len(layout["nodes"])
    assert applied["edges"] == len(layout["edges"])
    for edge in scene.edges.values():
        assert edge.layout["rot"] % 30 == 0
    report = schematic.validate_schematic(scene)
    assert report["ok"] is True, report["blocking"]


def test_pin_bindings_fill_electrical_params():
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vp = scene.add_node(name="vp", kind="node")
    vn = scene.add_node(name="vn", kind="node")
    out = scene.add_node(name="out", kind="node")
    edge = scene.add_edge(
        kind="opamp",
        source=gnd.id,
        target=gnd.id,
        pins={"IN+": vp.id, "IN-": vn.id, "OUT": out.id},
        params={"gain": 1e5},
    )
    assert edge.params["vp"] == vp.id
    assert edge.params["vn"] == vn.id
    assert edge.source == out.id
    assert edge.target == gnd.id

    with pytest.raises(ValidationError, match="没有引脚"):
        scene.add_edge(
            kind="opamp",
            source=gnd.id,
            target=gnd.id,
            pins={"NOPE": vp.id},
        )


def test_invalid_rotation_is_rejected():
    scene = circuit_scene()
    edge = next(iter(scene.edges.values()))
    with pytest.raises(ValidationError, match="30"):
        scene.update_edge(edge.id, {"layout": {"x": 0, "y": 0, "rot": 45}})


def test_schematic_api_layout_and_validate(client):
    client.post("/api/scene", json=build_template("rlc_series"))
    response = client.post("/api/schematic/layout")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["layout"]["ok"] is True
    assert body["applied"]["edges"] > 0
    validated = client.get("/api/schematic/validate")
    assert validated.status_code == 200
    assert validated.json()["ok"] is True
    exported = client.get("/api/scene/export").json()
    assert all("layout" in edge for edge in exported["edges"])
    assert all(edge["layout"]["rot"] % 30 == 0 for edge in exported["edges"])


def test_fill_missing_layout_keeps_node_positions():
    scene = circuit_scene()
    before = {node.id: dict(node.position) for node in scene.nodes.values()}
    for edge in scene.edges.values():
        edge.layout = {}
    filled = schematic.fill_missing_layout(scene)
    assert filled == len(scene.edges)
    for node in scene.nodes.values():
        assert node.position == before[node.id]
    for edge in scene.edges.values():
        assert edge.layout["rot"] % 30 == 0
        assert edge.layout["x"] % 20 == 0
        assert edge.layout["y"] % 20 == 0
