"""P4 元件：运放/比较器/稳压管/LED/D 触发器行为测试。"""

from __future__ import annotations

import pytest

from netlab.core.compute.nodal import element_catalog
from netlab.core.model.scene import Scene
from netlab.core.model.templates import build_template


def node(scene, name, kind="node"):
    return scene.add_node(name=name, kind=kind)


def voltage(scene, name):
    target = next(item for item in scene.nodes.values() if item.name == name)
    return float(target.data.get("voltage", 0.0))


def dc(scene, name, a, b, value):
    return scene.add_edge(
        name=name,
        source=a.id,
        target=b.id,
        kind="vsource",
        params={"wave": "dc", "offset": value, "amplitude": 0.0},
    )


def resistor(scene, name, a, b, r):
    return scene.add_edge(
        name=name, source=a.id, target=b.id, kind="resistor", params={"R": r}
    )


def test_catalog_has_behavioral_elements():
    kinds = {item["kind"] for item in element_catalog()}
    assert {"opamp", "comparator", "zener", "led", "dflipflop"} <= kinds
    for item in element_catalog():
        assert item["kind"] and item["label"]
        assert item.get("formula"), f"{item['kind']} 缺少公式"


def test_opamp_inverting_amplifier_gain():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    vin = node(scene, "vin")
    vn = node(scene, "vn")
    vout = node(scene, "vout")
    dc(scene, "V1", vin, gnd, 1.0)
    resistor(scene, "R1", vin, vn, 1000.0)
    resistor(scene, "R2", vn, vout, 10000.0)
    scene.add_edge(
        name="OP1",
        source=vout.id,
        target=gnd.id,
        kind="opamp",
        params={"vp": gnd.id, "vn": vn.id, "gain": 1.0e5, "vmax": 15.0},
    )
    scene.step(1.0e-3)
    assert voltage(scene, "vout") == pytest.approx(-10.0, abs=0.2)
    assert voltage(scene, "vn") == pytest.approx(0.0, abs=0.01)


def test_comparator_saturates_both_ways():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    a = node(scene, "a")
    b = node(scene, "b")
    out = node(scene, "out")
    dc(scene, "VA", a, gnd, 3.0)
    dc(scene, "VB", b, gnd, 1.0)
    scene.add_edge(
        name="CMP",
        source=out.id,
        target=gnd.id,
        kind="comparator",
        params={"vp": a.id, "vn": b.id, "gain": 1.0e6, "vmax": 5.0},
    )
    scene.step(1.0e-3)
    assert voltage(scene, "out") == pytest.approx(5.0, abs=0.05)

    scene2 = Scene("circuit")
    gnd2 = node(scene2, "gnd", "ground")
    a2 = node(scene2, "a")
    b2 = node(scene2, "b")
    out2 = node(scene2, "out")
    dc(scene2, "VA", a2, gnd2, 1.0)
    dc(scene2, "VB", b2, gnd2, 3.0)
    scene2.add_edge(
        name="CMP",
        source=out2.id,
        target=gnd2.id,
        kind="comparator",
        params={"vp": a2.id, "vn": b2.id, "gain": 1.0e6, "vmax": 5.0},
    )
    scene2.step(1.0e-3)
    assert voltage(scene2, "out") == pytest.approx(-5.0, abs=0.05)


def test_zener_clamps_reverse_breakdown():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    src = node(scene, "src")
    z = node(scene, "z")
    dc(scene, "V1", src, gnd, 10.0)
    resistor(scene, "R1", src, z, 100.0)
    # 反向接法：阳极接地、阴极接 z；超过 Vz 时击穿钳位
    scene.add_edge(
        name="Z1",
        source=gnd.id,
        target=z.id,
        kind="zener",
        params={
            "Vz": 5.1,
            "ron": 0.5,
            "Is": 1.0e-12,
            "n": 1.5,
            "temperature": 300.0,
            "rs": 0.0,
        },
    )
    scene.step(1.0e-3)
    assert voltage(scene, "z") == pytest.approx(5.1, abs=0.3)


def test_led_forward_drop():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    src = node(scene, "src")
    anode = node(scene, "anode")
    dc(scene, "V1", src, gnd, 5.0)
    resistor(scene, "R1", src, anode, 1000.0)
    scene.add_edge(
        name="LED1",
        source=anode.id,
        target=gnd.id,
        kind="led",
        params={"Is": 1.0e-12, "n": 1.0, "temperature": 300.0, "rs": 0.0},
    )
    scene.step(1.0e-3)
    drop = voltage(scene, "anode")
    assert 0.3 < drop < 1.5
    assert drop < 5.0


def _dff_scene(clock_params, q0=0.0):
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    d = node(scene, "d")
    clk = node(scene, "clk")
    q = node(scene, "q")
    dc(scene, "VD", d, gnd, 5.0)
    scene.add_edge(
        name="VCLK", source=clk.id, target=gnd.id, kind="vsource", params=clock_params
    )
    scene.add_edge(
        name="FF1",
        source=q.id,
        target=gnd.id,
        kind="dflipflop",
        params={
            "d_node": d.id,
            "clk_node": clk.id,
            "vth": 2.5,
            "vhigh": 5.0,
            "vlow": 0.0,
            "q0": q0,
        },
    )
    return scene


def test_opamp_inverting_manual_layout_template():
    """手工摆位运放模板：能装进引擎、步进数值有限。"""
    scene = Scene("circuit")
    scene.load_payload(build_template("opamp_inverting"))
    for _ in range(30):
        scene.step(1.0e-4)
    values = {
        node.name: float(node.data.get("voltage", 0.0)) for node in scene.nodes.values()
    }
    assert all(abs(value) < 1.0e6 for value in values.values())
    assert "out" in values


def test_opamp_internal_macro_template():
    """运放内部宏模型：有源器件级联后输出为正、数值有限。"""
    scene = Scene("circuit")
    scene.load_payload(build_template("opamp_internal"))
    for _ in range(30):
        scene.step(2.0e-4)
    values = {
        node.name: float(node.data.get("voltage", 0.0)) for node in scene.nodes.values()
    }
    assert values["out"] > 1.0
    assert all(abs(value) < 1.0e6 for value in values.values())


def test_trip_unit_demo_chain_trips():
    """脱扣器示意模板：分压越限 → 比较器翻转 → 时钟上升沿 → Q=1 → LED 点亮。"""
    scene = Scene("circuit")
    scene.load_payload(build_template("trip_unit"))
    for _ in range(1200):
        scene.step(2.0e-4)
    values = {
        node.name: float(node.data.get("voltage", 0.0)) for node in scene.nodes.values()
    }
    assert values["cmp"] > 4.0
    assert values["q"] > 4.0
    assert 0.3 < values["led"] < 1.5


def test_dflipflop_rising_edge_and_hold():
    # 时钟一直低：不更新
    scene = _dff_scene({"wave": "dc", "offset": 0.0, "amplitude": 0.0})
    for _ in range(3):
        scene.step(5.0e-3)
    assert voltage(scene, "q") == pytest.approx(0.0, abs=0.05)

    # 阶跃时钟：上升沿后 Q 跟随 D=5
    scene = _dff_scene(
        {"wave": "step", "offset": 0.0, "amplitude": 5.0, "delay": 0.001}
    )
    for _ in range(6):
        scene.step(5.0e-3)
    assert voltage(scene, "q") == pytest.approx(5.0, abs=0.05)

    # D 变低后保持（不再触发边沿）
    scene.nodes[next(n.id for n in scene.nodes.values() if n.name == "d")].data[
        "voltage"
    ] = 0.0
    for _ in range(3):
        scene.step(5.0e-3)
    assert voltage(scene, "q") == pytest.approx(5.0, abs=0.05)
