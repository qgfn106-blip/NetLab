"""R15 第三批：4 位计数器与 4 位 DAC 测试。"""

from __future__ import annotations

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


def voltage(scene, name):
    target = next(item for item in scene.nodes.values() if item.name == name)
    return float(target.data.get("voltage", 0.0))


def test_dac4_weighted_output():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    out = node(scene, "out")
    b = [node(scene, f"b{i}") for i in range(4)]
    dc(scene, "VB0", b[0], gnd, 0.0)
    dc(scene, "VB1", b[1], gnd, 5.0)
    dc(scene, "VB2", b[2], gnd, 0.0)
    dc(scene, "VB3", b[3], gnd, 5.0)
    scene.add_edge(
        name="DAC",
        source=out.id,
        target=gnd.id,
        kind="dac4",
        params={
            "b0_node": b[0].id,
            "b1_node": b[1].id,
            "b2_node": b[2].id,
            "b3_node": b[3].id,
            "vref": 5.0,
            "vth": 2.5,
        },
    )
    scene.add_edge(
        name="RL", source=out.id, target=gnd.id, kind="resistor", params={"R": 10000.0}
    )
    for _ in range(2):
        scene.step(1e-4)
    assert abs(voltage(scene, "out") - 5.0 * 10 / 15.0) < 0.05


def test_counter4_counts_rising_edges():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    clk = node(scene, "clk")
    q = [node(scene, f"q{i}") for i in range(4)]
    scene.add_edge(
        name="CLK",
        source=clk.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "square", "amplitude": 2.5, "offset": 2.5, "frequency": 2000.0},
    )
    scene.add_edge(
        name="CNT",
        source=q[0].id,
        target=gnd.id,
        kind="counter4",
        params={
            "clk_node": clk.id,
            "rst_node": gnd.id,
            "q0_node": q[0].id,
            "q1_node": q[1].id,
            "q2_node": q[2].id,
            "q3_node": q[3].id,
            "vhigh": 5.0,
            "vlow": 0.0,
            "vth": 2.5,
        },
    )
    samples = {i: [] for i in range(4)}
    for _ in range(40):
        scene.step(1e-4)
        for i in range(4):
            samples[i].append(voltage(scene, f"q{i}"))
    assert max(samples[0]) > 4.5 and min(samples[0]) < 0.5
    assert max(samples[1]) > 4.5
    assert max(samples[2]) > 4.5


def test_shift4_serial_in_parallel_out():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    clk = node(scene, "clk")
    d = node(scene, "d")
    q = [node(scene, f"q{i}") for i in range(4)]
    dc(scene, "D", d, gnd, 5.0)
    scene.add_edge(
        name="CLK",
        source=clk.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "square", "amplitude": 2.5, "offset": 2.5, "frequency": 2000.0},
    )
    scene.add_edge(
        name="SR",
        source=q[0].id,
        target=gnd.id,
        kind="shift4",
        params={
            "d_node": d.id,
            "clk_node": clk.id,
            "rst_node": gnd.id,
            "q0_node": q[0].id,
            "q1_node": q[1].id,
            "q2_node": q[2].id,
            "q3_node": q[3].id,
            "vhigh": 5.0,
            "vlow": 0.0,
            "vth": 2.5,
        },
    )
    for _ in range(40):
        scene.step(1e-4)
    for i in range(3):
        assert voltage(scene, f"q{i}") > 4.5


def test_shift4_reset_clears():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    clk = node(scene, "clk")
    d = node(scene, "d")
    rst = node(scene, "rst")
    q = [node(scene, f"q{i}") for i in range(4)]
    dc(scene, "D", d, gnd, 5.0)
    dc(scene, "RST", rst, gnd, 5.0)
    scene.add_edge(
        name="CLK",
        source=clk.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "square", "amplitude": 2.5, "offset": 2.5, "frequency": 2000.0},
    )
    scene.add_edge(
        name="SR",
        source=q[0].id,
        target=gnd.id,
        kind="shift4",
        params={
            "d_node": d.id,
            "clk_node": clk.id,
            "rst_node": rst.id,
            "q0_node": q[0].id,
            "q1_node": q[1].id,
            "q2_node": q[2].id,
            "q3_node": q[3].id,
            "vhigh": 5.0,
            "vlow": 0.0,
            "vth": 2.5,
        },
    )
    for _ in range(20):
        scene.step(1e-4)
    assert max(voltage(scene, f"q{i}") for i in range(4)) < 0.5


def build_adc(scene, vin_value):
    gnd = node(scene, "gnd", "ground")
    clk = node(scene, "clk")
    vin = node(scene, "vin")
    q = [node(scene, f"q{i}") for i in range(4)]
    dc(scene, "VIN", vin, gnd, vin_value)
    scene.add_edge(
        name="CLK",
        source=clk.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "square", "amplitude": 2.5, "offset": 2.5, "frequency": 2000.0},
    )
    scene.add_edge(
        name="ADC",
        source=q[0].id,
        target=gnd.id,
        kind="adc4",
        params={
            "vin_node": vin.id,
            "clk_node": clk.id,
            "q1_node": q[1].id,
            "q2_node": q[2].id,
            "q3_node": q[3].id,
            "vref": 5.0,
            "vth": 2.5,
            "vhigh": 5.0,
            "vlow": 0.0,
        },
    )
    return gnd, q


def test_adc4_successive_approximation():
    def convert(vin_value):
        scene = Scene("circuit")
        _, q = build_adc(scene, vin_value)
        for _ in range(45):  # 约 9 个时钟上升沿 → 两次完整转换
            scene.step(1e-4)
        code = 0
        for index in range(4):
            if voltage(scene, f"q{index}") > 4.5:
                code |= 1 << index
        return code

    assert convert(3.3) == 0b1010  # 3.125 ≤ 3.3 < 3.4375
    assert convert(4.9) == 0b1111


def test_digital_catalog():
    from netlab.core.compute.nodal import element_catalog

    kinds = {item["kind"] for item in element_catalog()}
    assert {"counter4", "shift4", "dac4", "adc4"} <= kinds
