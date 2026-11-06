"""R15 第四批：功率电子与电机、R06/P4 跨域接口测试。"""

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


def resistor(scene, name, a, b, value):
    return scene.add_edge(
        name=name, source=a.id, target=b.id, kind="resistor", params={"R": value}
    )


def voltage(scene, name):
    target = next(item for item in scene.nodes.values() if item.name == name)
    return float(target.data.get("voltage", 0.0))


def settle(scene, steps=8, dt=1e-4):
    for _ in range(steps):
        scene.step(dt)


def thyristor_scene(gate_voltage: float) -> Scene:
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    vcc = node(scene, "vcc")
    anode = node(scene, "anode")
    gate = node(scene, "gate")
    dc(scene, "VCC", vcc, gnd, 5.0)
    dc(scene, "VG", gate, gnd, gate_voltage)
    resistor(scene, "RA", vcc, anode, 100.0)
    scene.add_edge(
        name="Q1",
        source=anode.id,
        target=gnd.id,
        kind="thyristor",
        params={
            "Ron": 0.05,
            "Roff": 1e9,
            "Vgt": 0.8,
            "Ih": 0.005,
            "gate_node": gate.id,
        },
    )
    return scene


def test_thyristor_triggers_and_latches():
    on = thyristor_scene(1.5)
    settle(on)
    assert voltage(on, "anode") < 0.5

    off = thyristor_scene(0.0)
    settle(off)
    assert voltage(off, "anode") > 4.0

    # 触发后撤掉门极电压仍应保持导通（门极节点改接 0 V 源）。
    latched = thyristor_scene(1.5)
    settle(latched, steps=3)
    gate_source = next(edge for edge in latched.edges.values() if edge.name == "VG")
    gate_source.params["offset"] = 0.0
    settle(latched, steps=3)
    assert voltage(latched, "anode") < 0.5


def igbt_scene(gate_voltage: float) -> Scene:
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    vcc = node(scene, "vcc")
    coll = node(scene, "coll")
    gate = node(scene, "gate")
    dc(scene, "VCC", vcc, gnd, 5.0)
    dc(scene, "VG", gate, gnd, gate_voltage)
    resistor(scene, "RC", vcc, coll, 1000.0)
    scene.add_edge(
        name="Q1",
        source=coll.id,
        target=gnd.id,
        kind="igbt",
        params={"Ron": 0.1, "Roff": 1e8, "Vth": 4.0, "gate_node": gate.id},
    )
    return scene


def test_igbt_is_voltage_controlled():
    on = igbt_scene(6.0)
    settle(on)
    assert voltage(on, "coll") < 1.0
    off = igbt_scene(0.0)
    settle(off)
    assert voltage(off, "coll") > 4.0


def jfet_scene(gate_voltage: float) -> Scene:
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    vcc = node(scene, "vcc")
    drain = node(scene, "drain")
    gate = node(scene, "gate")
    dc(scene, "VCC", vcc, gnd, 5.0)
    dc(scene, "VG", gate, gnd, gate_voltage)
    resistor(scene, "RD", vcc, drain, 1000.0)
    scene.add_edge(
        name="J1",
        source=drain.id,
        target=gnd.id,
        kind="jfet",
        params={"Ron": 50.0, "Roff": 1e9, "Vp": -2.0, "gate_node": gate.id},
    )
    return scene


def test_jfet_depletion_mode():
    on = jfet_scene(0.0)
    settle(on)
    assert voltage(on, "drain") < 1.5
    off = jfet_scene(-3.0)
    settle(off)
    assert voltage(off, "drain") > 4.0


def relay_scene(coil_voltage: float) -> Scene:
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    coil_src = node(scene, "coil_src")
    vcc = node(scene, "vcc")
    com = node(scene, "com")
    dc(scene, "VC", coil_src, gnd, coil_voltage)
    dc(scene, "VCC", vcc, gnd, 5.0)
    resistor(scene, "RC", vcc, com, 1000.0)
    scene.add_edge(
        name="K1",
        source=coil_src.id,
        target=gnd.id,
        kind="relay",
        params={
            "Rcoil": 100.0,
            "Ion": 0.01,
            "Ron": 0.05,
            "Roff": 1e9,
            "com_node": com.id,
            "no_node": gnd.id,
        },
    )
    return scene


def test_relay_contact_follows_coil():
    on = relay_scene(5.0)
    settle(on)
    assert voltage(on, "com") < 0.5
    off = relay_scene(0.0)
    settle(off)
    assert voltage(off, "com") > 4.0


def test_dc_motor_spins_up():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    vcc = node(scene, "vcc")
    dc(scene, "VCC", vcc, gnd, 5.0)
    motor = scene.add_edge(
        name="M1",
        source=vcc.id,
        target=gnd.id,
        kind="motor",
        params={
            "R": 1.0,
            "Ke": 0.05,
            "Kt": 0.05,
            "J": 1e-5,
            "b": 0.001,
            "Tload": 0.0,
        },
    )
    for _ in range(200):
        scene.step(1e-3)
    engine = scene.ensure_engine()
    element = engine.element_map[motor.id]
    assert element.speed > 5.0
    assert element.result["back_emf"] > 0.25
    assert element.result["current"] > 0.0


def test_catalog_has_fourth_batch_and_interfaces():
    from netlab.core.compute.nodal import element_catalog

    catalog = {item["kind"]: item for item in element_catalog()}
    assert {"thyristor", "igbt", "jfet", "relay", "motor"} <= set(catalog)
    assert {"if_voltage_to_signal", "if_signal_to_current"} <= set(catalog)
    assert catalog["motor"]["group"] == "功率电子与电机"
