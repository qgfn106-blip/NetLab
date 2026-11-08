"""层 B：不变量（LC 能量守恒）。"""
from __future__ import annotations

import pytest

from netlab.core.model.scene import Scene


def _lc_energy(scene: Scene, node_id: str, edge_id: str) -> float:
    c = 1.0e-4
    l = 0.01
    voltage = float(scene.nodes[node_id].data.get("voltage", 0.0))
    current = float(scene.ensure_engine().element_map[edge_id].state["i"])
    return 0.5 * c * voltage * voltage + 0.5 * l * current * current


def test_lc_energy_is_conserved() -> None:
    scene = Scene("circuit")
    a = scene.add_node(name="a", kind="node").id
    b = scene.add_node(name="b", kind="node").id
    g = scene.add_node(name="gnd", kind="ground").id
    l_edge = scene.add_edge(source=a, target=b, kind="inductor", name="L1", params={"L": 0.01})
    scene.add_edge(source=b, target=g, kind="capacitor", name="C1", params={"C": 1.0e-4, "v0": 1.0})

    scene.step(1.0e-5)
    initial = _lc_energy(scene, b, l_edge.id)
    assert initial == pytest.approx(0.5 * 1.0e-4, rel=1.0e-3)

    for _ in range(200):
        scene.step(1.0e-5)
        energy = _lc_energy(scene, b, l_edge.id)
        assert energy == pytest.approx(initial, rel=1.0e-6, abs=1.0e-12)
