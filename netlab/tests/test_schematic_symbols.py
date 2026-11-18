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
    assert len(PINS) == 39

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
