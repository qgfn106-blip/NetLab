"""S2-6：元件注册表搬家后的 P0 回归（ELEMENT_SPECS 运行时注入）。"""

from __future__ import annotations

from netlab.core.compute.circuit.catalog import ELEMENT_SPECS
from netlab.core.compute.transistors import BJT_SPECS


def test_transistor_specs_survive_catalog_move() -> None:
    """BJT/MOSFET 的 spec 在拆分前后仍可解析，数量与类型不变。"""
    assert len(BJT_SPECS) == 4
    for kind, spec in BJT_SPECS.items():
        assert kind in ELEMENT_SPECS, f"{kind} 未注入 ELEMENT_SPECS"
        entry = ELEMENT_SPECS[kind]
        assert entry.kind == spec["kind"]
        assert entry.label == spec["label"]
        assert entry.cls is spec["cls"]
