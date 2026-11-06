"""R18/R19：SchemDraw 静态原理图导出测试。"""

from __future__ import annotations

import pytest

from netlab.core.compute.nodal import ComputeError
from netlab.core.model.scene import Scene

pytest.importorskip("schemdraw")


def _circuit() -> Scene:
    scene = Scene("circuit")
    ground = scene.add_node(name="gnd", kind="ground")
    a = scene.add_node(name="a", kind="node")
    b = scene.add_node(name="b", kind="node")
    scene.add_edge(
        name="V1",
        source=a.id,
        target=ground.id,
        kind="vsource",
        params={"wave": "dc", "offset": 5.0, "amplitude": 0.0},
    )
    scene.add_edge(
        name="R1", source=a.id, target=b.id, kind="resistor", params={"R": 1000.0}
    )
    scene.nodes[b.id].position = {"x": 200.0, "y": 120.0}
    return scene


def test_scene_to_svg_contains_symbols():
    from netlab.core.compute.schematic_export import scene_to_svg

    svg = scene_to_svg(_circuit(), project_name="测试工程", network_name="主网络")
    assert svg.lstrip().startswith("<?xml")
    assert "<svg" in svg
    assert "R1" in svg
    assert "测试工程" in svg
    assert "节点 ·" in svg
    assert "<g transform=" in svg


def test_scene_to_svg_labels_values_and_grid_fallback():
    from netlab.core.compute.schematic_export import scene_to_svg

    scene = _circuit()
    for node in scene.nodes.values():
        node.position = {"x": 0.0, "y": 0.0}
    svg = scene_to_svg(scene, project_name="grid", network_name="n")
    assert "1000Ω" in svg
    assert svg.count("<svg") == 1


def test_scene_to_svg_rejects_non_circuit():
    from netlab.core.compute.schematic_export import scene_to_svg

    with pytest.raises(ComputeError, match="仅支持电路模式"):
        scene_to_svg(Scene("signal"))


def test_export_endpoint_returns_svg():
    from fastapi.testclient import TestClient

    from netlab.server import app

    client = TestClient(app)
    client.post("/api/scene", json=_circuit().to_payload(include_state=False))
    response = client.get(
        "/api/export/schematic", params={"name": "demo", "network": "main"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert "<svg" in body["svg"]
    assert body["filename"] == "demo.svg"
