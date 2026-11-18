"""S3：路由、引脚、junction、crossing、label 验收测试。"""

from __future__ import annotations

import json
from pathlib import Path

from netlab.core.compute.schematic_export_ir import build_schematic_export_ir
from netlab.core.compute.schematic_symbols import symbol_spec

FIXTURES = Path(__file__).with_name("fixtures") / "schematic_export"


def _device_payload() -> dict:
    return json.loads((FIXTURES / "device_wire_rc_branch.json").read_text(encoding="utf-8"))


def _by_name(data: dict) -> dict[str, dict]:
    return {item["name"]: item for item in data["devices"]}


def _pin(device: dict, name: str) -> tuple[float, float]:
    for item in device["pins"]:
        if item["name"] == name:
            return (round(item["x"], 6), round(item["y"], 6))
    raise AssertionError(f"{device['name']} 缺少引脚 {name}")


def _distance_to_segment(
    px: float, py: float, x1: float, y1: float, x2: float, y2: float
) -> float:
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return ((px - x1) ** 2 + (py - y1) ** 2) ** 0.5
    t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return ((px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2) ** 0.5


def _label_rect(label: dict) -> tuple[float, float, float, float]:
    # 与实现相同的保守文本盒：高度 12 world，宽度按字符数估算。
    width = max(12.0, len(label["text"]) * 3.2)
    height = 12.0
    x = float(label["anchor"]["x"])
    y = float(label["anchor"]["y"])
    return (x - width / 2, y - height / 2, x + width / 2, y + height / 2)


def _rects_overlap(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])


def _segment_hits_rect(
    x1: float, y1: float, x2: float, y2: float, rect: tuple[float, float, float, float]
) -> bool:
    left, top, right, bottom = rect
    # 端点是否在矩形内（含边界）。
    for px, py in ((x1, y1), (x2, y2)):
        if left <= px <= right and top <= py <= bottom:
            return True
    # 线段与四条边相交。
    for ex1, ey1, ex2, ey2 in (
        (left, top, right, top),
        (left, bottom, right, bottom),
        (left, top, left, bottom),
        (right, top, right, bottom),
    ):
        d1 = (x2 - x1) * (ey1 - y1) - (y2 - y1) * (ex1 - x1)
        d2 = (x2 - x1) * (ey2 - y1) - (y2 - y1) * (ex2 - x1)
        d3 = (ex2 - ex1) * (y1 - ey1) - (ey2 - ey1) * (x1 - ex1)
        d4 = (ex2 - ex1) * (y2 - ey1) - (ey2 - ey1) * (x2 - ex1)
        if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and (
            (d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)
        ):
            return True
    return False


def test_device_pins_and_bbox_come_from_symbol_spec() -> None:
    data = build_schematic_export_ir(_device_payload()).to_dict()
    devices = _by_name(data)
    r1 = devices["R1"]
    assert _pin(r1, "1") == (40.0, 80.0)
    assert _pin(r1, "2") == (80.0, 80.0)
    assert r1["bbox"] == {"left": 38.0, "top": 70.0, "right": 82.0, "bottom": 90.0}
    # 90° 旋转后 bbox 与引脚一起旋转，而不是只转图形。
    r2 = devices["R2"]
    assert _pin(r2, "1") == (120.0, 120.0)
    assert _pin(r2, "2") == (120.0, 160.0)
    assert r2["bbox"] == {"left": 110.0, "top": 118.0, "right": 130.0, "bottom": 162.0}
    spec = symbol_spec("resistor", "gb")
    assert spec["pins"][0]["x"] == -20 and spec["pins"][1]["x"] == 20


def test_rotated_label_slots_are_used() -> None:
    data = build_schematic_export_ir(_device_payload()).to_dict()
    r2_labels = [item for item in data["labels"] if item["owner_id"] == _by_name(data)["R2"]["id"]]
    by_role = {item["role"]: item for item in r2_labels}
    # 未旋转时 designator (0,18), value (0,-18)；绕中心 90° 后分别落到左/右两侧。
    assert (round(by_role["designator"]["anchor"]["x"], 6), round(by_role["designator"]["anchor"]["y"], 6)) == (102.0, 140.0)
    assert by_role["designator"]["placement"] == "left"
    assert (round(by_role["value"]["anchor"]["x"], 6), round(by_role["value"]["anchor"]["y"], 6)) == (138.0, 140.0)
    assert by_role["value"]["placement"] == "right"


def test_wires_start_and_end_at_device_pins() -> None:
    data = build_schematic_export_ir(_device_payload()).to_dict()
    wires = {item["id"]: item for item in data["wires"]}
    assert wires["c9c41e1e1c41"]["points"][0] == {"x": 0.0, "y": 120.0}
    assert wires["c9c41e1e1c41"]["points"][-1] == {"x": 0.0, "y": 80.0}
    assert wires["dec29762d792"]["points"][0] == {"x": 40.0, "y": 80.0}
    assert wires["dec29762d792"]["points"][-1] == {"x": 0.0, "y": 80.0}
    assert wires["4418bb7a3fee"]["points"][0] == {"x": 120.0, "y": 120.0}


def test_labels_do_not_overlap_symbols_or_wire_segments() -> None:
    data = build_schematic_export_ir(_device_payload()).to_dict()
    device_rects = [
        (item["bbox"]["left"], item["bbox"]["top"], item["bbox"]["right"], item["bbox"]["bottom"])
        for item in data["devices"]
        if item["bbox"] is not None
    ]
    segments = []
    for wire in data["wires"]:
        for left, right in zip(wire["points"], wire["points"][1:]):
            segments.append((left["x"], left["y"], right["x"], right["y"]))
    label_rects: list[tuple[float, float, float, float]] = []
    for label in data["labels"]:
        rect = _label_rect(label)
        assert not any(_rects_overlap(rect, device) for device in device_rects), label
        assert not any(_segment_hits_rect(x1, y1, x2, y2, rect) for x1, y1, x2, y2 in segments), label
        assert not any(_rects_overlap(rect, other) for other in label_rects), label
        label_rects.append(rect)


def test_label_anchor_keeps_clearance_from_every_wire() -> None:
    data = build_schematic_export_ir(_device_payload()).to_dict()
    for label in data["labels"]:
        ax = float(label["anchor"]["x"])
        ay = float(label["anchor"]["y"])
        for wire in data["wires"]:
            for left, right in zip(wire["points"], wire["points"][1:]):
                distance = _distance_to_segment(ax, ay, left["x"], left["y"], right["x"], right["y"])
                assert distance > 2.0, (label, wire["id"], distance)


def test_wire_route_free_keeps_explicit_free_endpoints() -> None:
    payload = _device_payload()
    target = next(edge for edge in payload["edges"] if edge["kind"] == "wire")
    target["route"] = "free"
    data = build_schematic_export_ir(payload).to_dict()
    wire = next(item for item in data["wires"] if item["id"] == target["id"])
    assert wire["route_source"] == "free"
    assert wire["points"] == [
        {"x": wire["points"][0]["x"], "y": wire["points"][0]["y"]},
        {"x": wire["points"][-1]["x"], "y": wire["points"][-1]["y"]},
    ]
