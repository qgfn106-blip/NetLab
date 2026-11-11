"""scene_types 公共常量与外观校验（G1 变更行覆盖率补强）。"""
from __future__ import annotations

import pytest

from netlab.core.common.limits import ValidationError
from netlab.core.model.scene_types import (
    ANCHOR_SIDES,
    MAX_NODE_SIZE,
    MAX_POSITION,
    MAX_WAYPOINTS,
    MIN_NODE_SIZE,
    MODES,
    ROUTE_MODES,
    normalize_appearance,
)


def test_constants_are_stable() -> None:
    assert MODES == ("signal", "circuit", "vector")
    assert ROUTE_MODES == ("auto", "straight", "orthogonal", "manual")
    assert ANCHOR_SIDES == ("auto", "left", "right", "top", "bottom")
    assert MAX_POSITION == 10000.0
    assert MAX_WAYPOINTS == 64
    assert (MIN_NODE_SIZE, MAX_NODE_SIZE) == (24.0, 200.0)


def test_empty_appearance() -> None:
    assert normalize_appearance(None) == {}
    assert normalize_appearance({}) == {}


def test_full_appearance_normalized() -> None:
    result = normalize_appearance(
        {"color": "#AABBCC", "opacity": 0.5, "lineWidth": 2, "fontSize": 12}
    )
    assert result == {"color": "#aabbcc", "opacity": 0.5, "lineWidth": 2.0, "fontSize": 12.0}


def test_extended_appearance_normalized() -> None:
    result = normalize_appearance(
        {
            "color": "#AABBCC",
            "fillColor": "#FFFFFF",
            "strokeColor": "#112233",
            "textColor": "#11100E",
            "portColor": "#445566",
            "tickColor": "#A8541F",
            "lineStyle": "dashed",
            "opacity": 0.5,
            "lineWidth": 2,
            "fontSize": 12,
        }
    )
    assert result == {
        "color": "#aabbcc",
        "fillColor": "#ffffff",
        "strokeColor": "#112233",
        "textColor": "#11100e",
        "portColor": "#445566",
        "tickColor": "#a8541f",
        "lineStyle": "dashed",
        "opacity": 0.5,
        "lineWidth": 2.0,
        "fontSize": 12.0,
    }


def test_appearance_rejects_bad_line_style() -> None:
    with pytest.raises(ValidationError):
        normalize_appearance({"lineStyle": "wavy"})


@pytest.mark.parametrize("key", ["fillColor", "strokeColor", "textColor", "portColor", "tickColor"])
def test_appearance_rejects_bad_extended_color(key: str) -> None:
    with pytest.raises(ValidationError):
        normalize_appearance({key: "red"})


def test_appearance_rejects_unknown_key() -> None:
    with pytest.raises(ValidationError):
        normalize_appearance({"glow": 1})


def test_appearance_rejects_bad_color() -> None:
    with pytest.raises(ValidationError):
        normalize_appearance({"color": "red"})


@pytest.mark.parametrize(
    "payload",
    [
        {"opacity": 0.01},
        {"opacity": 1.5},
        {"lineWidth": 0.1},
        {"lineWidth": 20},
        {"fontSize": 2},
        {"fontSize": 100},
    ],
)
def test_appearance_ranges(payload: dict) -> None:
    with pytest.raises(ValidationError):
        normalize_appearance(payload)


def test_appearance_rejects_non_object() -> None:
    with pytest.raises(ValidationError):
        normalize_appearance("x")  # type: ignore[arg-type]
