"""R15 第三批：BJT / MOSFET 行为模型开关测试。"""

from __future__ import annotations

import pytest

from netlab.core.model.scene import Scene


def node(scene, name, kind="node"):
    return scene.add_node(name=name, kind=kind)


def dc(scene, name, a, b, value):
    return scene.add_edge(name=name, source=a.id, target=b.id, kind="vsource",
                          params={"wave": "dc", "offset": value, "amplitude": 0.0})


def resistor(scene, name, a, b, value):
    return scene.add_edge(name=name, source=a.id, target=b.id, kind="resistor", params={"R": value})


def voltage(scene, name):
    target = next(item for item in scene.nodes.values() if item.name == name)
    return float(target.data.get("voltage", 0.0))


def npn_switch(base_voltage: float) -> Scene:
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    vcc = node(scene, "vcc")
    base_src = node(scene, "base_src")
    base = node(scene, "base")
    coll = node(scene, "coll")
    dc(scene, "VCC", vcc, gnd, 5.0)
    dc(scene, "VB", base_src, gnd, base_voltage)
    resistor(scene, "RB", base_src, base, 10000.0)
    resistor(scene, "RC", vcc, coll, 1000.0)
    scene.add_edge(name="Q1", source=coll.id, target=gnd.id, kind="npn",
                   params={"Is": 1e-14, "n": 1.0, "temperature": 300.0, "beta": 100.0, "base_node": base.id})
    return scene


def test_npn_switch_on_and_off():
    on = npn_switch(5.0)
    for _ in range(5):
        on.step(1e-4)
    assert voltage(on, "coll") < 1.0

    off = npn_switch(0.0)
    for _ in range(5):
        off.step(1e-4)
    assert voltage(off, "coll") > 4.0


def test_pnp_switch_on_and_off():
    def build(base_voltage):
        scene = Scene("circuit")
        gnd = node(scene, "gnd", "ground")
        vcc = node(scene, "vcc")
        base_src = node(scene, "base_src")
        base = node(scene, "base")
        coll = node(scene, "coll")
        dc(scene, "VCC", vcc, gnd, 5.0)
        dc(scene, "VB", base_src, gnd, base_voltage)
        resistor(scene, "RB", base_src, base, 10000.0)
        resistor(scene, "RC", coll, gnd, 1000.0)
        scene.add_edge(name="Q1", source=coll.id, target=vcc.id, kind="pnp",
                       params={"Is": 1e-14, "n": 1.0, "temperature": 300.0, "beta": 100.0, "base_node": base.id})
        return scene

    on = build(0.0)
    for _ in range(5):
        on.step(1e-4)
    assert voltage(on, "coll") > 3.0

    off = build(5.0)
    for _ in range(5):
        off.step(1e-4)
    assert voltage(off, "coll") < 1.0


def test_nmos_switch():
    def build(gate_voltage):
        scene = Scene("circuit")
        gnd = node(scene, "gnd", "ground")
        vcc = node(scene, "vcc")
        gate = node(scene, "gate")
        drain = node(scene, "drain")
        dc(scene, "VCC", vcc, gnd, 5.0)
        dc(scene, "VG", gate, gnd, gate_voltage)
        resistor(scene, "RD", vcc, drain, 1000.0)
        scene.add_edge(name="M1", source=drain.id, target=gnd.id, kind="nmos",
                       params={"k": 0.001, "Vth": 2.0, "gate_node": gate.id})
        return scene

    on = build(5.0)
    for _ in range(5):
        on.step(1e-4)
    # 线性区模型（vds < vgs−vth 时 Id = k(vov·vds − vds²/2)）的物理正确解：
    # vds 由 5−k(vov·vds−vds²/2)·1k = vds 解得 ≈1.55 V；旧纯饱和模型给 0.5 V。
    assert 1.0 < voltage(on, "drain") < 2.0

    off = build(0.0)
    for _ in range(5):
        off.step(1e-4)
    assert voltage(off, "drain") > 4.0


def test_catalog_has_third_batch():
    from netlab.core.compute.nodal import element_catalog

    kinds = {item["kind"] for item in element_catalog()}
    assert {"npn", "pnp", "nmos", "pmos"} <= kinds
