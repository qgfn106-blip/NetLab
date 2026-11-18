"""S2：GB/classic 声明式符号规格与 SchemDraw 适配器测试。"""

from __future__ import annotations

import json

import pytest

from netlab.core.model.ports import PINS

schemdraw = pytest.importorskip("schemdraw")

from netlab.core.compute.schematic_symbols import (  # noqa: E402
    GBElement,
    SYMBOL_SCHEMA,
    SymbolSpecError,
    UnsupportedSymbolError,
    load_symbol_specs,
    symbol_inventory,
    symbol_spec,
    supported_kinds,
)

STYLES = ("gb", "classic")
PRIMITIVE_TYPES = {"line", "polyline", "circle", "arc", "polygon", "text"}


def test_every_pin_kind_has_declarative_spec() -> None:
    specs = load_symbol_specs()
    assert specs["schema"] == SYMBOL_SCHEMA
    assert set(specs["symbols"]) == set(PINS) == set(supported_kinds())
    assert len(PINS) == 40

    for kind, pin_spec in PINS.items():
        spec = symbol_spec(kind, "gb")
        assert [pin["name"] for pin in spec["pins"]] == [pin.name for pin in pin_spec]
        assert [pin["x"] for pin in spec["pins"]]
        assert [pin["y"] for pin in spec["pins"]]
        for style in STYLES:
            variant = symbol_spec(kind, style)
            assert variant["variants"][style]["primitives"]


def test_symbol_styles_share_one_pin_table() -> None:
    gb = symbol_spec("resistor", "gb")
    classic = symbol_spec("resistor", "classic")
    assert gb["pins"] == classic["pins"]
    assert gb["variants"]["gb"]["primitives"] != gb["variants"]["classic"]["primitives"]
    assert gb["label_slots"] == classic["label_slots"]
    assert gb["bbox"] == classic["bbox"]


def test_gb_transistors_use_bare_standard_symbol() -> None:
    for kind in ("npn", "pnp"):
        gb = symbol_spec(kind, "gb")["variants"]["gb"]["primitives"]
        classic = symbol_spec(kind, "classic")["variants"]["classic"]["primitives"]
        assert all(item["type"] != "circle" for item in gb), kind
        assert any(item["type"] == "circle" for item in classic), kind


def test_primitives_are_limited_declarative_types() -> None:
    specs = load_symbol_specs()
    for kind, spec in specs["symbols"].items():
        for style in STYLES:
            primitives = spec["variants"][style]["primitives"]
            assert primitives, kind
            for primitive in primitives:
                assert primitive["type"] in PRIMITIVE_TYPES, (kind, primitive)
                if primitive["type"] in {"line", "polyline", "polygon"}:
                    assert len(primitive["points"]) >= 2


def test_inventory_marks_supported_and_style_variants() -> None:
    inventory = symbol_inventory()
    assert len(inventory) == len(PINS)
    assert {row["kind"] for row in inventory} == set(PINS)
    assert all(row["status"] == "supported" for row in inventory)
    assert all(row["styles"] == list(STYLES) for row in inventory)


def test_gbelement_uses_schemdraw_public_api_and_draws() -> None:
    drawing = schemdraw.Drawing()
    element = GBElement("resistor", style="gb").at((10, 20))
    drawing.add(element)
    svg = drawing.get_imagedata("svg").decode("utf-8")
    assert "<svg" in svg
    assert element.__class__.__mro__[1].__name__ == "Element"
    assert set(element.anchors) == {"1", "2"}


@pytest.mark.parametrize("kind", sorted(PINS))
def test_every_supported_kind_builds_and_draws(kind: str) -> None:
    drawing = schemdraw.Drawing()
    element = GBElement(kind)
    drawing.add(element.at((0, 0)))
    assert element.anchors
    assert element.segments
    assert element.get_bbox() is not None


def test_unknown_kind_is_explicit_error() -> None:
    with pytest.raises(UnsupportedSymbolError):
        symbol_spec("no_such_device", "gb")
    with pytest.raises(UnsupportedSymbolError):
        GBElement("no_such_device")


def test_invalid_style_is_rejected() -> None:
    with pytest.raises(SymbolSpecError):
        symbol_spec("resistor", "presentation")

def _gb_lines(kind: str) -> list[list[list[float]]]:
    primitives = symbol_spec(kind, "gb")["variants"]["gb"]["primitives"]
    return [
        primitive["points"]
        for primitive in primitives
        if primitive["type"] == "line"
    ]


def test_gb_transistors_have_no_bent_terminal_leads() -> None:
    # GB/T 4728.5 S00663：集电极与发射极斜线接竖直引线，端口在引线末端；
    # 不得折回中心（旧实现先到 (4,±12) 再折回 x=0，形成折线）。
    for kind in ("npn", "pnp"):
        spec = symbol_spec(kind, "gb")
        pins = {pin["name"]: (pin["x"], pin["y"]) for pin in spec["pins"]}
        assert pins["B"] == (-24, 0)
        assert pins["C"] == (4, 24)
        assert pins["E"] == (4, -24)

        lines = _gb_lines(kind)
        for terminal, direction in (("C", 1), ("E", -1)):
            x, y = pins[terminal]
            touching = [points for points in lines if [x, y] in points]
            assert len(touching) == 1, f"{kind}.{terminal} 端口应只接一条引线"
            (x1, y1), (x2, y2) = touching[0]
            assert x1 == x2 == x, f"{kind}.{terminal} 端口引线应竖直"
            assert {y1, y2} == {y, 12 * direction}, f"{kind}.{terminal} 引线应从斜线末端直达端口"
            assert not any([0, y] in points for points in lines), f"{kind}.{terminal} 不得折回中心"

        arrows = [item for item in spec["variants"]["gb"]["primitives"] if item["type"] == "polygon"]
        assert arrows and all(item.get("fill") is True for item in arrows), f"{kind} 箭头应为实心"


def test_gb_ideal_sources_use_standard_bar_without_extra_arrow() -> None:
    # GB/T 4728.2 S00205/S00206：圆 + 一条穿过圆心的直线。
    # 标准图竖置：电流源横线（垂直引线）、电压源竖线（沿引线）；
    # 本工程符号横置（旋转 90°），因此电流源为竖线、电压源为横线。
    for kind in ("vsource", "isource"):
        spec = symbol_spec(kind, "gb")
        assert [(pin["name"], pin["x"], pin["y"]) for pin in spec["pins"]] == [
            ("+", -20, 0),
            ("-", 20, 0),
        ]
        primitives = spec["variants"]["gb"]["primitives"]
        assert [p["type"] for p in primitives].count("text") == 0
        assert not any(p["type"] == "polygon" for p in primitives)
        lines = _gb_lines(kind)
        if kind == "vsource":
            assert [[-10, 0], [10, 0]] in lines
        else:
            assert [[0, -10], [0, 10]] in lines

