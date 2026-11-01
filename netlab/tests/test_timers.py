"""R15 第三批：555 方波与 LDO 稳压行为测试。"""

from __future__ import annotations

from netlab.scene import Scene


def node(scene, name, kind="node"):
    return scene.add_node(name=name, kind=kind)


def dc(scene, name, a, b, value):
    return scene.add_edge(name=name, source=a.id, target=b.id, kind="vsource",
                          params={"wave": "dc", "offset": value, "amplitude": 0.0})


def voltage(scene, name):
    target = next(item for item in scene.nodes.values() if item.name == name)
    return float(target.data.get("voltage", 0.0))


def test_ne555_toggles():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    out = node(scene, "out")
    scene.add_edge(name="U1", source=out.id, target=gnd.id, kind="ne555",
                   params={"freq": 1000.0, "duty": 0.5, "vhigh": 5.0, "vlow": 0.0})
    samples = []
    for _ in range(25):
        scene.step(1e-4)
        samples.append(voltage(scene, "out"))
    assert max(samples) > 4.5
    assert min(samples) < 0.5
    # 一个周期内既有高又有低
    period = samples[:10]
    assert max(period) > 4.5 and min(period) < 0.5


def test_ldo_regulates_and_drops_out():
    def build(vin):
        scene = Scene("circuit")
        gnd = node(scene, "gnd", "ground")
        vcc = node(scene, "vcc")
        out = node(scene, "out")
        dc(scene, "VIN", vcc, gnd, vin)
        scene.add_edge(name="U1", source=out.id, target=gnd.id, kind="ldo",
                       params={"vin_node": vcc.id, "vout": 5.0, "dropout": 0.5})
        scene.add_edge(name="RL", source=out.id, target=gnd.id, kind="resistor", params={"R": 1000.0})
        for _ in range(3):
            scene.step(1e-4)
        return scene

    high = build(12.0)
    assert abs(voltage(high, "out") - 5.0) < 0.05
    low = build(3.0)
    assert abs(voltage(low, "out") - 2.5) < 0.1


def test_timer_catalog():
    from netlab.nodal import element_catalog

    kinds = {item["kind"] for item in element_catalog()}
    assert {"ne555", "ldo"} <= kinds
