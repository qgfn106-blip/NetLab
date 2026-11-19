"""S1：SchematicExportIR 对旧/新场景的适配测试。"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

pytest.importorskip("schemdraw")

from netlab.core.compute.schematic_export_ir import (
    ExportOptions,
    build_schematic_export_ir,
)

FIXTURES = Path(__file__).with_name("fixtures") / "schematic_export"


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _legacy() -> dict:
    return _load("legacy_rc_branch.json")


def _device() -> dict:
    return _load("device_wire_rc_branch.json")


def test_legacy_and_device_forms_build_identical_ir() -> None:
    legacy_ir = build_schematic_export_ir(_legacy())
    device_ir = build_schematic_export_ir(_device())
    assert legacy_ir.to_dict() == device_ir.to_dict()
    data = device_ir.to_dict()
    assert data["schema"] == "netlab-schematic-ir/1"
    assert data["style"] == "gb"
    assert data["stats"]["devices"] == 6
    assert data["stats"]["wires"] == 12
    assert data["stats"]["unsupported"] == 0
    assert {device["name"] for device in data["devices"]} == {
        "V1", "R1", "R2", "C1", "R3", "D1"
    }
    assert {net["name"] for net in data["nets"]} == {"SRC", "MID", "OUT", "GND"}


def test_junctions_are_branch_points_not_node_centers_only() -> None:
    data = build_schematic_export_ir(_device()).to_dict()
    points = {(round(item["x"], 6), round(item["y"], 6)) for item in data["junctions"]}
    assert points == {(120.0, 80.0), (240.0, 40.0), (120.0, 200.0)}
    assert all(item["reason"] == "branch" for item in data["junctions"])


def test_build_does_not_mutate_scene_payload() -> None:
    payload = _device()
    before = copy.deepcopy(payload)
    build_schematic_export_ir(payload)
    assert payload == before


def test_manual_waypoints_and_pin_fields_are_structured() -> None:
    payload = _device()
    wire = next(item for item in payload["edges"] if item["name"] == "R1.1")
    wire["route"] = "manual"
    wire["waypoints"] = [{"x": 40.0, "y": 80.0}, {"x": 80.0, "y": 40.0}]
    wire["source_pin"] = "1"
    wire["target_pin"] = ""
    data = build_schematic_export_ir(payload).to_dict()
    ir_wire = next(item for item in data["wires"] if item["id"] == wire["id"])
    assert ir_wire["route_source"] == "manual"
    assert ir_wire["source_pin"] == "1"
    assert ir_wire["points"][1:3] == [{"x": 40.0, "y": 80.0}, {"x": 80.0, "y": 40.0}]


def test_straight_route_is_not_orthogonalised() -> None:
    payload = _device()
    wire = next(item for item in payload["edges"] if item["name"] == "C1.2")
    wire["route"] = "straight"
    data = build_schematic_export_ir(payload).to_dict()
    ir_wire = next(item for item in data["wires"] if item["id"] == wire["id"])
    assert ir_wire["route_source"] == "straight"
    assert len(ir_wire["points"]) == 2


def test_unknown_device_is_unsupported_not_dropped() -> None:
    payload = _device()
    payload["nodes"].append({
        "id": "dev_unknown", "name": "U9", "kind": "device",
        "params": {"element": "mystery"}, "position": {"x": 10.0, "y": 20.0}, "size": {},
    })
    ir = build_schematic_export_ir(payload)
    data = ir.to_dict()
    assert data["stats"]["unsupported"] == 1
    item = data["unsupported"][0]
    assert item["kind"] == "mystery"
    assert item["name"] == "U9"
    assert any(w["code"] == "unsupported_device" for w in data["warnings"])


def test_crossing_without_junction_for_different_nets() -> None:
    payload = {
        "mode": "circuit",
        "nodes": [
            {"id": "a1", "name": "A1", "kind": "node", "position": {"x": 0.0, "y": 50.0}},
            {"id": "a2", "name": "A2", "kind": "node", "position": {"x": 100.0, "y": 50.0}},
            {"id": "b1", "name": "B1", "kind": "node", "position": {"x": 50.0, "y": 0.0}},
            {"id": "b2", "name": "B2", "kind": "node", "position": {"x": 50.0, "y": 100.0}},
        ],
        "edges": [
            {"id": "w_a", "name": "WA", "source": "a1", "target": "a2", "kind": "wire", "route": "straight"},
            {"id": "w_b", "name": "WB", "source": "b1", "target": "b2", "kind": "wire", "route": "straight"},
        ],
    }
    data = build_schematic_export_ir(payload).to_dict()
    assert data["junctions"] == []
    assert len(data["crossings"]) == 1
    crossing = data["crossings"][0]
    assert (crossing["x"], crossing["y"]) == (50.0, 50.0)
    assert crossing["over_wire_id"] == "w_a"
    assert crossing["under_wire_id"] == "w_b"


def test_wire_has_no_text_label() -> None:
    data = build_schematic_export_ir(_device()).to_dict()
    wire_ids = {wire["id"] for wire in data["wires"]}
    assert all(label["owner_id"] not in wire_ids for label in data["labels"])
    assert all(not label["text"].startswith("wire-") for label in data["labels"])


def test_ir_is_json_serializable_and_deterministic() -> None:
    first = build_schematic_export_ir(_device(), options=ExportOptions(style="classic"))
    second = build_schematic_export_ir(_device(), options=ExportOptions(style="classic"))
    assert first.to_dict() == second.to_dict()
    assert first.to_dict()["style"] == "classic"
    json.dumps(first.to_dict(), ensure_ascii=False)
