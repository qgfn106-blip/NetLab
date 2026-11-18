"""S7：复杂 fixture 的结构 oracle、SVG XML 与确定性测试。"""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

pytest.importorskip("schemdraw")

ROOT = Path(__file__).parent / "fixtures" / "schematic_export"
SVG_NS = "http://www.w3.org/2000/svg"


def _fixture_names() -> list[str]:
    return ["bridge_rectifier", "two_bjt_regulator"]


def _load(name: str) -> tuple[dict, dict]:
    scene = json.loads((ROOT / f"{name}.json").read_text(encoding="utf-8"))
    expected = json.loads((ROOT / f"{name}.structure.json").read_text(encoding="utf-8"))
    return scene, expected


def _root(svg: str) -> ET.Element:
    return ET.fromstring(svg.encode("utf-8"))


def _find_all(root: ET.Element, cls: str) -> list[ET.Element]:
    return root.findall(f".//{{{SVG_NS}}}g[@class='{cls}']")


def _find_circles(root: ET.Element, cls: str) -> list[ET.Element]:
    return root.findall(f".//{{{SVG_NS}}}circle[@class='{cls}']")


@pytest.mark.parametrize("name", _fixture_names())
def test_complex_fixture_matches_structure_oracle(name: str):
    from netlab.core.compute.schematic_export import export_schematic_document

    scene, expected = _load(name)
    document = export_schematic_document(scene, project_name=name)
    svg = document["svg"]
    root = _root(svg)

    assert root.tag.rsplit("}", 1)[-1] == "svg"
    view_box = root.attrib.get("viewBox", "").split()
    assert len(view_box) == 4
    assert float(view_box[2]) > 0 and float(view_box[3]) > 0

    metadata = root.find(f".//{{{SVG_NS}}}metadata[@id='netlab-ir']")
    assert metadata is not None
    assert json.loads(metadata.text or "{}") == expected

    symbols = _find_all(root, "netlab-symbol")
    assert len(symbols) == len(expected["devices"])
    for group, device in zip(symbols, expected["devices"]):
        assert group.attrib["data-owner-id"] == device["id"]
        assert group.attrib["data-kind"] == device["kind"]
        pins = group.findall(f"{{{SVG_NS}}}circle")
        assert len(pins) == len(device["pins"])
        for pin_node, pin in zip(pins, device["pins"]):
            assert pin_node.attrib["data-pin-name"] == pin["name"]
            assert float(pin_node.attrib["data-x"]) == pytest.approx(pin["x"])
            assert float(pin_node.attrib["data-y"]) == pytest.approx(pin["y"])

    wires = _find_all(root, "netlab-wire")
    assert len(wires) == len(expected["wires"])
    for group, wire in zip(wires, expected["wires"]):
        assert group.attrib["data-owner-id"] == wire["id"]
        assert group.attrib["data-net-id"] == wire["net_id"]
        assert json.loads(group.attrib["data-points"]) == [
            [point["x"], point["y"]] for point in wire["points"]
        ]
        assert not group.findall(f".//{{{SVG_NS}}}text")

    junctions = _find_circles(root, "netlab-junction")
    assert [(float(node.attrib["data-x"]), float(node.attrib["data-y"])) for node in junctions] == [
        (junction["x"], junction["y"]) for junction in expected["junctions"]
    ]
    crossings = _find_circles(root, "netlab-crossing")
    assert [(float(node.attrib["data-x"]), float(node.attrib["data-y"])) for node in crossings] == [
        (crossing["x"], crossing["y"]) for crossing in expected["crossings"]
    ]


@pytest.mark.parametrize("name", _fixture_names())
def test_complex_fixture_svg_is_deterministic(name: str):
    from netlab.core.compute.schematic_export import export_schematic_document

    scene, _ = _load(name)
    first = export_schematic_document(scene, project_name=name)["svg"]
    second = export_schematic_document(scene, project_name=name)["svg"]
    assert first == second
    assert len(first) > 5000


def test_manual_waypoints_are_traceable_in_structure_layer():
    from netlab.core.compute.schematic_export import render_schematic_svg
    from netlab.core.compute.schematic_export_ir import build_schematic_export_ir

    scene, _ = _load("bridge_rectifier")
    edge = scene["edges"][0]
    edge["route"] = "manual"
    edge["waypoints"] = [{"x": 20.0, "y": 140.0}, {"x": 80.0, "y": 140.0}]
    ir = build_schematic_export_ir(scene)
    wire = next(item for item in ir.wires if item.id == edge["id"])
    points = [[point["x"], point["y"]] for point in wire.points]
    assert points[1] == [20.0, 140.0]
    assert points[2] == [80.0, 140.0]
    root = _root(render_schematic_svg(ir))
    wire_group = next(
        group for group in _find_all(root, "netlab-wire") if group.attrib["data-owner-id"] == edge["id"]
    )
    assert json.loads(wire_group.attrib["data-points"]) == points


def test_unknown_device_appears_as_labeled_symbol_group():
    from netlab.core.compute.schematic_export import render_schematic_svg
    from netlab.core.compute.schematic_export_ir import build_schematic_export_ir

    payload = {
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
    ir = build_schematic_export_ir(payload)
    assert [item.kind for item in ir.unsupported] == ["mystery_kind"]
    svg = render_schematic_svg(ir)
    root = _root(svg)
    texts = "".join(node.text or "" for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "text")
    assert "不支持" in texts and "U9" in texts
    groups = _find_all(root, "netlab-symbol")
    assert any(group.attrib["data-kind"] == "mystery_kind" for group in groups)
