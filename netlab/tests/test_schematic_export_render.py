"""S4：IR → SchemDraw SVG 渲染与 API 诊断测试。"""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

pytest.importorskip("schemdraw")

from netlab.core.compute.schematic_export_ir import build_schematic_export_ir


def _fixture() -> dict:
    root = Path(__file__).parent / "fixtures" / "schematic_export"
    return json.loads((root / "device_wire_rc_branch.json").read_text(encoding="utf-8"))


def _unknown_payload() -> dict:
    return {
        "mode": "circuit",
        "nodes": [
            {
                "id": "dev-unknown",
                "name": "U9",
                "kind": "device",
                "params": {"element": "mystery_kind"},
                "position": {"x": 100.0, "y": 100.0},
                "data": {"rotation": 0},
            }
        ],
        "edges": [],
    }


def _texts(svg: str) -> list[str]:
    root = ET.fromstring(svg.encode("utf-8"))
    return [
        "".join(node.itertext())
        for node in root.iter()
        if node.tag.rsplit("}", 1)[-1] == "text"
    ]


def test_scene_to_svg_is_parseable_with_viewbox():
    from netlab.core.compute.schematic_export import scene_to_svg
    from netlab.core.model.scene import Scene

    scene = Scene("circuit")
    ground = scene.add_node(name="gnd", kind="ground")
    a = scene.add_node(name="a", kind="node")
    b = scene.add_node(name="b", kind="node")
    scene.add_edge(name="V1", source=a.id, target=ground.id, kind="vsource", params={"wave": "dc", "offset": 5.0})
    scene.add_edge(name="R1", source=a.id, target=b.id, kind="resistor", params={"R": 1000.0})
    svg = scene_to_svg(scene, project_name="S4", network_name="main")
    root = ET.fromstring(svg.encode("utf-8"))
    assert root.tag.rsplit("}", 1)[-1] == "svg"
    assert root.attrib.get("viewBox")
    assert svg.count("<svg") == 1


def test_ir_renderer_emits_device_symbols_and_no_wire_text():
    from netlab.core.compute.schematic_export import render_schematic_svg

    ir = build_schematic_export_ir(_fixture())
    svg = render_schematic_svg(ir)
    texts = _texts(svg)
    assert any("R1" == text or "R1" in text for text in texts)
    assert any("1000" in text for text in texts)
    for net_name in ("SRC", "MID", "OUT", "GND"):
        assert net_name not in texts


def test_unknown_device_gets_visible_box_and_warning():
    from netlab.core.compute.schematic_export import render_schematic_svg

    ir = build_schematic_export_ir(_unknown_payload())
    assert [item.kind for item in ir.unsupported] == ["mystery_kind"]
    assert any("mystery_kind" in warning.message for warning in ir.warnings)
    svg = render_schematic_svg(ir)
    assert "U9" in svg
    assert "不支持" in svg
    ET.fromstring(svg.encode("utf-8"))


def test_render_is_deterministic_apart_from_metadata():
    from netlab.core.compute.schematic_export import render_schematic_svg

    ir = build_schematic_export_ir(_fixture())
    first = render_schematic_svg(ir)
    second = render_schematic_svg(ir)
    assert first == second


def test_export_document_reports_warnings_unsupported_stats():
    from netlab.core.compute.schematic_export import export_schematic_document

    document = export_schematic_document(_unknown_payload(), project_name="diag")
    assert document["ok"] is True
    assert document["unsupported"][0]["kind"] == "mystery_kind"
    assert document["stats"]["unsupported"] == 1
    assert document["warnings"]
    assert document["filename"] == "diag.svg"


def test_export_endpoint_exposes_diagnostics_and_options():
    from fastapi.testclient import TestClient

    from netlab.server import app

    client = TestClient(app)
    response_scene = client.post("/api/scene", json=_fixture())
    assert response_scene.status_code == 200, response_scene.text
    response = client.get(
        "/api/export/schematic",
        params={"name": "diag", "style": "classic", "route": "free", "values": "false"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["style"] == "classic"
    assert body["route"] == "free"
    assert body["stats"]["devices"] == 6
    assert body["stats"]["wires"] == 12
    assert body["warnings"] == []
    assert body["unsupported"] == []
    assert body["filename"] == "diag.svg"

def test_rendered_svg_uses_physical_world_scale() -> None:
    from netlab.core.compute.schematic_export import render_schematic_svg

    fixture = Path(__file__).parent / "fixtures" / "schematic_export" / "two_bjt_regulator.json"
    payload = json.loads(fixture.read_text(encoding="utf-8"))
    svg = render_schematic_svg(build_schematic_export_ir(payload))
    match = re.search(r'<svg[^>]*width="([0-9.]+)pt"[^>]*height="([0-9.]+)pt"', svg)
    assert match, svg[:300]
    width, height = float(match.group(1)), float(match.group(2))
    # 1 world = 0.127 mm = 0.005 in；整图应在数英寸内，而不是 20 多英寸。
    assert width < 400.0, width
    assert height < 400.0, height
    font_sizes = [float(value) for value in re.findall(r"font-size:\s*([0-9.]+)px", svg)]
    assert font_sizes, svg[:300]
    assert 5.0 <= min(font_sizes) <= 6.0, font_sizes
