"""S0：原理图导出契约与 fixture 的不变量测试。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from netlab.core.compute.circuit.catalog import ELEMENT_SPECS
from netlab.core.model.ports import PINS
from netlab.core.model.project import migrate_scene_to_devices
from netlab.core.model.scene import Scene

FIXTURES = Path(__file__).with_name("fixtures") / "schematic_export"
DOC = Path(__file__).parents[2] / "docs" / "SCHEMATIC_EXPORT_CONTRACT.md"


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_pin_inventory_matches_element_specs() -> None:
    """真实 kind 清单：PINS 与 ELEMENT_SPECS 必须完全一致。"""
    assert len(PINS) == 40
    # ground 是场景接地标注，只作为符号渲染，不属于电路元件目录。
    assert set(PINS) == set(ELEMENT_SPECS) | {"ground"}
    for kind, pins in PINS.items():
        assert pins, f"{kind} 没有引脚"
        assert all(pin.name for pin in pins)


def test_legacy_and_device_fixtures_load_as_scenes() -> None:
    legacy = Scene("circuit")
    legacy.load_payload(_load("legacy_rc_branch.json"))
    assert len(legacy.nodes) == 4
    assert len(legacy.edges) == 6
    device = Scene("circuit")
    device.load_payload(_load("device_wire_rc_branch.json"))
    assert len(device.nodes) == 10
    assert len(device.edges) == 12


def test_legacy_migration_matches_frozen_device_fixture() -> None:
    legacy = _load("legacy_rc_branch.json")
    expected = _load("device_wire_rc_branch.json")
    migrated = migrate_scene_to_devices(legacy)
    assert migrated == expected
    assert migrate_scene_to_devices(expected) == expected


def test_unit_conversion_is_single_source() -> None:
    from netlab.core.compute.schematic_export_ir import (
        GRID_MM,
        MM_PER_WORLD,
        WORLD_PER_GRID,
        mm_to_world,
        world_to_mm,
    )

    assert MM_PER_WORLD == pytest.approx(0.127)
    assert WORLD_PER_GRID == pytest.approx(20.0)
    assert GRID_MM == pytest.approx(2.54)
    assert world_to_mm(20.0) == pytest.approx(2.54)
    assert mm_to_world(2.54) == pytest.approx(20.0)


def test_contract_document_has_required_terms() -> None:
    text = DOC.read_text(encoding="utf-8")
    for term in (
        "MM_PER_WORLD = 0.127",
        "显式 manual waypoints > edge anchors/source_pin/target_pin > device layout/rotation > circuit 默认正交 > 缺失坐标时的导出专用 fallback layout",
        "netlab-schematic-ir/1",
        "wire 不产生任何文字标签",
    ):
        assert term in text
