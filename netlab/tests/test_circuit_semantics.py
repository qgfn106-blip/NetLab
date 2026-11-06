"""R21/D43/D44：接线放宽、多接地、单端电源自动对地、未参与器件。"""

from __future__ import annotations


from netlab.core.model.scene import Scene


def node(scene: Scene, name: str, kind: str = "node"):
    return scene.add_node(name=name, kind=kind)


def dc(scene: Scene, name: str, a, b, value: float):
    return scene.add_edge(
        name=name,
        source=a.id,
        target=b.id,
        kind="vsource",
        params={"wave": "dc", "offset": value, "amplitude": 0.0},
    )


def device(scene: Scene, name: str, element: str, **params):
    return scene.add_node(
        name=name, kind="device", params={"element": element, **params}
    )


def wire(scene: Scene, name: str, dev, net, pin: str):
    return scene.add_edge(
        name=name, source=dev.id, target=net.id, kind="wire", source_pin=pin
    )


def voltage(scene: Scene, name: str) -> float:
    record = next(item for item in scene.nodes.values() if item.name == name)
    return float(record.data.get("voltage", 0.0))


def test_multiple_grounds_are_merged():
    """D44：多个接地符号自动合并为同一 0V 参考，结果与单接地一致。"""
    scene = Scene("circuit")
    gnd1 = node(scene, "gnd1", "ground")
    gnd2 = node(scene, "gnd2", "ground")
    n1 = node(scene, "n1")
    dc(scene, "VS", n1, gnd1, 5.0)
    scene.add_edge(
        name="RL", source=n1.id, target=gnd2.id, kind="resistor", params={"R": 1000.0}
    )
    for _ in range(3):
        scene.step(1e-4)
    assert abs(voltage(scene, "n1") - 5.0) < 1e-6

    single = Scene("circuit")
    g = node(single, "gnd", "ground")
    m = node(single, "n1")
    dc(single, "VS", m, g, 5.0)
    single.add_edge(
        name="RL", source=m.id, target=g.id, kind="resistor", params={"R": 1000.0}
    )
    for _ in range(3):
        single.step(1e-4)
    assert abs(voltage(single, "n1") - voltage(scene, "n1")) < 1e-9


def test_unwired_device_is_skipped_not_blocking():
    """D43：未接齐器件不参与求解，运行不阻断；与它相连的孤立网络被忽略。"""
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    n1 = node(scene, "n1")
    dc(scene, "VS", n1, gnd, 5.0)
    scene.add_edge(
        name="RL", source=n1.id, target=gnd.id, kind="resistor", params={"R": 1000.0}
    )
    lonely = node(scene, "lonely")
    resistor = device(scene, "R1", "resistor", R=1000.0)
    wire(scene, "W1", resistor, lonely, "1")
    engine = scene.ensure_engine()
    assert engine.incomplete_devices
    assert len(engine.solver.elements) == 2  # VS + RL；未接齐的 R1 不在内
    scene.step(1e-4)  # 不再抛“器件引脚未接齐”
    assert abs(voltage(scene, "n1") - 5.0) < 1e-6
    assert abs(voltage(scene, "lonely")) < 1e-9


def test_single_ended_source_auto_grounds_free_pin():
    """D43：电源只接一端时，空脚自动对地，并在引擎里登记。"""
    scene = Scene("circuit")
    node(scene, "gnd", "ground")
    n1 = node(scene, "n1")
    src = device(scene, "V1", "vsource", wave="dc", offset=5.0, amplitude=0.0)
    wire(scene, "W+", src, n1, "+")
    engine = scene.ensure_engine()
    assert engine.incomplete_devices == []
    assert engine.implicit_grounds == [{"device": "V1", "pin": "-"}]
    scene.step(1e-4)
    assert abs(voltage(scene, "n1") - 5.0) < 1e-6


def test_source_with_no_wires_still_inactive():
    """两端都不接的电源不自动接地（没有参考意义），保持未参与。"""
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    n1 = node(scene, "n1")
    dc(scene, "VS", n1, gnd, 1.0)
    scene.add_edge(
        name="RL", source=n1.id, target=gnd.id, kind="resistor", params={"R": 1000.0}
    )
    device(scene, "V1", "vsource")
    engine = scene.ensure_engine()
    assert any("V1" in item for item in engine.incomplete_devices)
