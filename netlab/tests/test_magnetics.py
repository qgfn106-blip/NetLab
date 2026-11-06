"""R15 第三批（收尾）：变压器与互感线圈测试。"""

from __future__ import annotations

import math

from netlab.core.model.scene import Scene


def node(scene, name, kind="node"):
    return scene.add_node(name=name, kind=kind)


def dc(scene, name, a, b, value):
    return scene.add_edge(
        name=name,
        source=a.id,
        target=b.id,
        kind="vsource",
        params={"wave": "dc", "offset": value, "amplitude": 0.0},
    )


def sine(scene, name, a, b, amplitude):
    return scene.add_edge(
        name=name,
        source=a.id,
        target=b.id,
        kind="vsource",
        params={
            "wave": "sine",
            "amplitude": amplitude,
            "offset": 0.0,
            "frequency": 50.0,
        },
    )


def voltage(scene, name):
    target = next(item for item in scene.nodes.values() if item.name == name)
    return float(target.data.get("voltage", 0.0))


def test_transformer_ratio_and_power():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    primary = node(scene, "pri")
    secondary = node(scene, "sec")
    dc(scene, "V1", primary, gnd, 10.0)
    transformer = scene.add_edge(
        name="T1",
        source=primary.id,
        target=gnd.id,
        kind="transformer",
        params={
            "ratio": 0.5,
            "Lm": 0.0,
            "secondary_source": secondary.id,
            "secondary_target": gnd.id,
        },
    )
    scene.add_edge(
        name="RL",
        source=secondary.id,
        target=gnd.id,
        kind="resistor",
        params={"R": 1000.0},
    )
    for _ in range(3):
        scene.step(1e-4)
    assert abs(voltage(scene, "sec") - 5.0) < 0.05
    # i2 = −5 mA（流入变压器方向为负），i1 = −n·i2 = 2.5 mA；功率守恒。
    assert abs(float(transformer.state["i2"]) + 0.005) < 5.0e-4
    assert abs(float(transformer.state["power"])) < 1.0e-6


def test_transformer_with_magnetizing_inductance():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    primary = node(scene, "pri")
    secondary = node(scene, "sec")
    dc(scene, "V1", primary, gnd, 10.0)
    transformer = scene.add_edge(
        name="T1",
        source=primary.id,
        target=gnd.id,
        kind="transformer",
        params={
            "ratio": 1.0,
            "Lm": 1.0e-3,
            "secondary_source": secondary.id,
            "secondary_target": gnd.id,
        },
    )
    scene.add_edge(
        name="RL",
        source=secondary.id,
        target=gnd.id,
        kind="resistor",
        params={"R": 1000.0},
    )
    for _ in range(3):
        scene.step(1e-4)
    assert abs(voltage(scene, "sec") - 10.0) < 0.1
    # 励磁支路电流随 DC 电压上升（di/dt = v1/Lm = 10 kA/s；梯形法 3 拍约 1.5 A）。
    assert float(transformer.state["im"]) > 1.0


def test_coupled_inductor_voltage_ratio():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    primary = node(scene, "pri")
    secondary = node(scene, "sec")
    sine(scene, "V1", primary, gnd, 10.0)
    coupling = scene.add_edge(
        name="L1L2",
        source=primary.id,
        target=gnd.id,
        kind="coupling_inductor",
        params={
            "L1": 1.0e-3,
            "L2": 4.0e-3,
            "coupling": 0.98,
            "secondary_source": secondary.id,
            "secondary_target": gnd.id,
        },
    )
    scene.add_edge(
        name="RL",
        source=secondary.id,
        target=gnd.id,
        kind="resistor",
        params={"R": 1.0e6},
    )
    samples = []
    for _ in range(400):  # 50 Hz 下两个周期
        scene.step(1e-4)
        samples.append((voltage(scene, "pri"), voltage(scene, "sec")))
    tail = samples[200:]
    primary_peak = max(abs(item[0]) for item in tail)
    secondary_peak = max(abs(item[1]) for item in tail)
    # |v2/v1| ≈ M/L1 = k·sqrt(L2/L1) = 0.98×2 = 1.96
    assert primary_peak > 9.0
    ratio = secondary_peak / primary_peak
    assert 1.85 < ratio < 2.05, ratio
    assert math.isfinite(float(coupling.state["v2"]))


def test_magnetics_catalog():
    from netlab.core.compute.nodal import element_catalog

    kinds = {item["kind"] for item in element_catalog()}
    assert {"transformer", "coupling_inductor"} <= kinds
