"""R15 第三批：逻辑门行为测试（与/或/非/异或）。"""

from __future__ import annotations

from netlab.core.model.scene import Scene


def node(scene, name, kind="node"):
    return scene.add_node(name=name, kind=kind)


def dc(scene, name, a, b, value):
    return scene.add_edge(name=name, source=a.id, target=b.id, kind="vsource",
                          params={"wave": "dc", "offset": value, "amplitude": 0.0})


def build_gate(gate: str, va: float, vb: float = 0.0) -> Scene:
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    vdd = node(scene, "vdd")
    a = node(scene, "a")
    b = node(scene, "b")
    out = node(scene, "out")
    dc(scene, "VDD", vdd, gnd, 5.0)
    dc(scene, "VA", a, gnd, va)
    dc(scene, "VB", b, gnd, vb)
    params = {"in_a": a.id, "vdd_node": vdd.id, "vth": 2.5, "ron": 50.0, "slope": 10.0}
    if gate != "not_gate":
        params["in_b"] = b.id
    scene.add_edge(name="G1", source=out.id, target=gnd.id, kind=gate, params=params)
    for _ in range(6):
        scene.step(1e-4)
    return scene


def voltage(scene, name):
    target = next(item for item in scene.nodes.values() if item.name == name)
    return float(target.data.get("voltage", 0.0))


def test_and_gate_truth_table():
    assert voltage(build_gate("and_gate", 5.0, 5.0), "out") > 4.5
    assert voltage(build_gate("and_gate", 5.0, 0.0), "out") < 0.5


def test_or_gate_truth_table():
    assert voltage(build_gate("or_gate", 0.0, 5.0), "out") > 4.5
    assert voltage(build_gate("or_gate", 0.0, 0.0), "out") < 0.5


def test_not_and_xor():
    assert voltage(build_gate("not_gate", 0.0), "out") > 4.5
    assert voltage(build_gate("not_gate", 5.0), "out") < 0.5
    assert voltage(build_gate("xor_gate", 5.0, 0.0), "out") > 4.5
    assert voltage(build_gate("xor_gate", 5.0, 5.0), "out") < 0.5


def test_logic_catalog():
    from netlab.core.compute.nodal import element_catalog

    kinds = {item["kind"] for item in element_catalog()}
    assert {"and_gate", "or_gate", "not_gate", "xor_gate"} <= kinds
