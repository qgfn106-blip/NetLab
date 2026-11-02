"""R20 模型批：器件节点 + 引脚导线 + PinMap 装配（试点）。"""

from __future__ import annotations

import pytest

from netlab.core.common.limits import ComputeError, ValidationError
from netlab.core.model.scene import Scene
from netlab.core.model.templates import build_template


def node(scene, name, kind="node"):
    return scene.add_node(name=name, kind=kind)


def device(scene, name, element, **params):
    return scene.add_node(name=name, kind="device", params={"element": element, **params})


def wire(scene, name, source, target, *, source_pin="", target_pin=""):
    return scene.add_edge(
        name=name, source=source.id, target=target.id, kind="wire",
        source_pin=source_pin, target_pin=target_pin,
    )


def voltage(scene, name):
    target = next(item for item in scene.nodes.values() if item.name == name)
    return float(target.data.get("voltage", 0.0))


def dc(scene, name, a, b, value):
    return scene.add_edge(name=name, source=a.id, target=b.id, kind="vsource",
                          params={"wave": "dc", "offset": value, "amplitude": 0.0})


def divider_scene():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    top = node(scene, "top")
    mid = node(scene, "mid")
    dc(scene, "V1", top, gnd, 10.0)
    r1 = device(scene, "R1", "resistor", R=1000.0)
    r2 = device(scene, "R2", "resistor", R=1000.0)
    wire(scene, "W1", r1, top, source_pin="1")
    wire(scene, "W2", r1, mid, source_pin="2")
    wire(scene, "W3", r2, mid, source_pin="1")
    wire(scene, "W4", r2, gnd, source_pin="2")
    return scene


def test_device_resistor_divider():
    scene = divider_scene()
    for _ in range(2):
        scene.step(1e-4)
    assert abs(voltage(scene, "mid") - 5.0) < 0.01


def test_device_transformer_ratio():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    pri = node(scene, "pri")
    sec = node(scene, "sec")
    dc(scene, "V1", pri, gnd, 10.0)
    transformer = device(scene, "T1", "transformer", ratio=0.5, Lm=0.0)
    wire(scene, "W1", transformer, pri, source_pin="P1")
    wire(scene, "W2", transformer, gnd, source_pin="P2")
    wire(scene, "W3", transformer, sec, source_pin="S1")
    wire(scene, "W4", transformer, gnd, source_pin="S2")
    scene.add_edge(name="RL", source=sec.id, target=gnd.id, kind="resistor",
                   params={"R": 1000.0})
    for _ in range(3):
        scene.step(1e-4)
    assert abs(voltage(scene, "sec") - 5.0) < 0.05


def test_device_snapshot_roundtrip():
    scene = divider_scene()
    payload = scene.to_payload()
    clone = Scene("signal")
    clone.load_payload(payload)
    for _ in range(2):
        clone.step(1e-4)
    assert abs(voltage(clone, "mid") - 5.0) < 0.01
    wires = [edge for edge in clone.edges.values() if edge.kind == "wire"]
    assert len(wires) == 4
    assert {edge.source_pin for edge in wires} == {"1", "2"}


def test_wire_requires_device_pin():
    scene = divider_scene()
    r1 = next(item for item in scene.nodes.values() if item.name == "R1")
    top = next(item for item in scene.nodes.values() if item.name == "top")
    with pytest.raises(ValidationError):
        scene.add_edge(name="BAD1", source=r1.id, target=top.id, kind="wire")
    with pytest.raises(ValidationError):
        scene.add_edge(name="BAD2", source=r1.id, target=top.id, kind="wire",
                       source_pin="9")
    with pytest.raises(ValidationError):
        scene.add_edge(name="BAD3", source=r1.id, target=top.id, kind="wire",
                       source_pin="1", params={"x": 1})


def test_wire_only_pin_to_net():
    scene = divider_scene()
    r1 = next(item for item in scene.nodes.values() if item.name == "R1")
    r2 = next(item for item in scene.nodes.values() if item.name == "R2")
    gnd = next(item for item in scene.nodes.values() if item.name == "gnd")
    with pytest.raises(ValidationError):
        scene.add_edge(name="BAD4", source=r1.id, target=r2.id, kind="wire",
                       source_pin="1", target_pin="1")
    with pytest.raises(ValidationError):
        scene.add_edge(name="BAD5", source=gnd.id, target=gnd.id, kind="wire")


def test_missing_required_pin_skips_device():
    """R21/D43：缺必接引脚不再阻断运行，器件不参与并进入 inactive 清单。"""
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    top = node(scene, "top")
    dc(scene, "V1", top, gnd, 10.0)
    r1 = device(scene, "R1", "resistor", R=1000.0)
    wire(scene, "W1", r1, top, source_pin="1")
    engine = scene.ensure_engine()
    assert engine.incomplete_devices == ["R1 缺少引脚连接：2"]
    assert r1.id not in engine.element_map
    scene.step(1e-4)
    assert abs(float(top.data.get("voltage", 0.0)) - 10.0) < 1e-6


def test_duplicate_pin_wire_blocks_engine():
    scene = divider_scene()
    r1 = next(item for item in scene.nodes.values() if item.name == "R1")
    gnd = next(item for item in scene.nodes.values() if item.name == "gnd")
    wire(scene, "WX", r1, gnd, source_pin="1")
    with pytest.raises(ComputeError) as info:
        scene.step(1e-4)
    assert "多条导线" in str(info.value)


def test_device_node_requires_known_element():
    scene = Scene("circuit")
    with pytest.raises(ValidationError):
        scene.add_node(name="X", kind="device", params={"element": "nope"})
    with pytest.raises(ValidationError):
        scene.add_node(name="Y", kind="device", params={})


def test_device_logic_gate():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    a = node(scene, "a")
    b = node(scene, "b")
    vdd = node(scene, "vdd")
    out = node(scene, "out")
    for name, net in (("VA", a), ("VB", b), ("VDD", vdd)):
        dc(scene, name, net, gnd, 5.0)
    gate = device(scene, "U1", "and_gate", ron=50.0, vth=2.5, slope=10.0)
    for pin, net in (("A", a), ("B", b), ("VDD", vdd), ("GND", gnd), ("Y", out)):
        wire(scene, f"W{pin}", gate, net, source_pin=pin)
    scene.add_edge(name="RL", source=out.id, target=gnd.id, kind="resistor",
                   params={"R": 10000.0})
    for _ in range(3):
        scene.step(1e-4)
    assert voltage(scene, "out") > 4.5


def test_device_counter4():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    clk = node(scene, "clk")
    q = [node(scene, f"q{i}") for i in range(4)]
    scene.add_edge(name="CLK", source=clk.id, target=gnd.id, kind="vsource",
                   params={"wave": "square", "amplitude": 2.5, "offset": 2.5,
                           "frequency": 2000.0})
    counter = device(scene, "U1", "counter4", vhigh=5.0, vlow=0.0, vth=2.5)
    for pin, net in (("CLK", clk), ("RST", gnd), ("Q0", q[0]), ("Q1", q[1]),
                     ("Q2", q[2]), ("Q3", q[3]), ("COM", gnd)):
        wire(scene, f"W{pin}", counter, net, source_pin=pin)
    samples = []
    for _ in range(40):
        scene.step(1e-4)
        samples.append(voltage(scene, "q0"))
    assert max(samples) > 4.5 and min(samples) < 0.5


def test_device_wire_api(client):
    client.post("/api/control", json={"action": "pause"})
    client.post("/api/mode", json={"mode": "circuit"})
    scene = client.post("/api/scene/clear").json()["scene"]
    gnd = next(node for node in scene["nodes"] if node["kind"] == "ground")

    def add_node(name, kind, params=None):
        body = {"name": name, "kind": kind}
        if params is not None:
            body["params"] = params
        response = client.post("/api/nodes", json=body)
        assert response.status_code == 200, response.text
        return response.json()["node"]

    top = add_node("TOPAPI", "node")
    r1 = add_node("R1API", "device", {"element": "resistor", "R": 1000.0})
    assert client.post("/api/edges", json={
        "name": "VAPI", "source": top["id"], "target": gnd["id"], "kind": "vsource",
        "params": {"wave": "dc", "offset": 10.0, "amplitude": 0.0},
    }).status_code == 200
    first = client.post("/api/edges", json={
        "name": "WAPI1", "source": r1["id"], "target": top["id"],
        "kind": "wire", "source_pin": "1",
    })
    assert first.status_code == 200, first.text
    assert first.json()["edge"]["source_pin"] == "1"
    second = client.post("/api/edges", json={
        "name": "WAPI2", "source": r1["id"], "target": gnd["id"],
        "kind": "wire", "source_pin": "2",
    })
    assert second.status_code == 200, second.text
    state = client.post("/api/control", json={"action": "step"}).json()
    assert state["sim"]["steps"] >= 1
    bad = client.post("/api/edges", json={
        "name": "WAPIBAD", "source": r1["id"], "target": top["id"],
        "kind": "wire", "source_pin": "9",
    })
    assert bad.status_code == 422


@pytest.mark.parametrize("element", sorted(__import__("netlab.core.model.ports", fromlist=["PINS"]).PINS))
def test_all_circuit_kinds_accept_device_nodes(element):
    from netlab.core.model.ports import pins_for_device

    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    nets = [node(scene, f"n{i}") for i in range(8)]
    dev = device(scene, "D1", element)
    for index, pin in enumerate(pins_for_device(element)):
        wire(scene, f"W{index}", dev, nets[index % len(nets)], source_pin=pin.name)
    engine = scene.ensure_engine()
    assert engine.incomplete_devices == []
    assert dev.id in engine.element_map


def test_device_opamp_inverting():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    vin = node(scene, "vin")
    inv = node(scene, "inv")
    out = node(scene, "out")
    dc(scene, "VIN", vin, gnd, 0.5)
    scene.add_edge(name="R1", source=vin.id, target=inv.id, kind="resistor",
                   params={"R": 1000.0})
    scene.add_edge(name="R2", source=inv.id, target=out.id, kind="resistor",
                   params={"R": 10000.0})
    opamp = device(scene, "U1", "opamp", gain=1.0e5, vcc=15.0, vee=-15.0)
    # R21：单端输出；V+/V− 不接线时走参数默认（对地 ±15）。
    for pin, net in (("IN+", gnd), ("IN-", inv), ("OUT", out)):
        wire(scene, f"W{pin}", opamp, net, source_pin=pin)
    for _ in range(4):
        scene.step(1e-4)
    assert abs(voltage(scene, "out") + 5.0) < 0.1


def test_device_comparator_single_ended_default_rails():
    """R21/D41：单端输出 + 双电源参数（V± 未接时对地 ±VCC/VEE）。"""
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    vin = node(scene, "vin")
    out = node(scene, "out")
    dc(scene, "VIN", vin, gnd, 1.0)
    cmp_ = device(scene, "U1", "comparator", gain=1.0e6, vcc=15.0, vee=-15.0)
    for pin, net in (("IN+", gnd), ("IN-", vin), ("OUT", out)):
        wire(scene, f"W{pin}", cmp_, net, source_pin=pin)
    scene.add_edge(name="RL", source=out.id, target=gnd.id, kind="resistor",
                   params={"R": 1000.0})
    for _ in range(3):
        scene.step(1e-4)
    # vp=0 < vin=1 → 低电平 ≈ VEE
    assert abs(voltage(scene, "out") + 15.0) < 0.2

    scene2 = Scene("circuit")
    gnd2 = node(scene2, "gnd", "ground")
    vp2 = node(scene2, "vp")
    vin2 = node(scene2, "vin")
    out2 = node(scene2, "out")
    dc(scene2, "VIN", vin2, gnd2, 1.0)
    dc(scene2, "VP", vp2, gnd2, 2.0)
    cmp2 = device(scene2, "U1", "comparator", gain=1.0e6, vcc=15.0, vee=-15.0)
    for pin, net in (("IN+", vp2), ("IN-", vin2), ("OUT", out2)):
        wire(scene2, f"W{pin}", cmp2, net, source_pin=pin)
    scene2.add_edge(name="RL", source=out2.id, target=gnd2.id, kind="resistor",
                    params={"R": 1000.0})
    for _ in range(3):
        scene2.step(1e-4)
    assert abs(voltage(scene2, "out") - 15.0) < 0.2


def test_device_comparator_wired_rails_follow_pins():
    """R21/D41：V+/V− 接线后按引脚电压，输出相对 V−。"""
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    vcc = node(scene, "vcc")
    vee = node(scene, "vee")
    vin = node(scene, "vin")
    out = node(scene, "out")
    dc(scene, "VCC", vcc, gnd, 12.0)
    dc(scene, "VEE", vee, gnd, -12.0)
    dc(scene, "VIN", vin, gnd, 1.0)
    cmp_ = device(scene, "U1", "comparator", gain=1.0e6)
    for pin, net in (("IN+", gnd), ("IN-", vin), ("V+", vcc),
                     ("V-", vee), ("OUT", out)):
        wire(scene, f"W{pin}", cmp_, net, source_pin=pin)
    scene.add_edge(name="RL", source=out.id, target=vee.id, kind="resistor",
                   params={"R": 1000.0})
    for _ in range(3):
        scene.step(1e-4)
    # IN+ < IN− → 输出低电平 = V−
    assert abs(voltage(scene, "out") + 12.0) < 0.2


def test_device_555_and_ldo():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    vcc = node(scene, "vcc")
    out = node(scene, "out")
    dc(scene, "VCC", vcc, gnd, 12.0)
    ldo = device(scene, "U1", "ldo", vout=5.0, dropout=0.5)
    for pin, net in (("IN", vcc), ("OUT", out), ("GND", gnd)):
        wire(scene, f"L{pin}", ldo, net, source_pin=pin)
    scene.add_edge(name="RL", source=out.id, target=gnd.id, kind="resistor",
                   params={"R": 1000.0})
    for _ in range(3):
        scene.step(1e-4)
    assert abs(voltage(scene, "out") - 5.0) < 0.05

    timer = Scene("circuit")
    tgnd = node(timer, "gnd", "ground")
    tvcc = node(timer, "vcc")
    tout = node(timer, "out")
    dc(timer, "VCC", tvcc, tgnd, 5.0)
    u555 = device(timer, "U1", "ne555", freq=1000.0, duty=0.5,
                  vhigh=5.0, vlow=0.0)
    for pin, net in (("OUT", tout), ("VCC", tvcc), ("GND", tgnd)):
        wire(timer, f"T{pin}", u555, net, source_pin=pin)
    samples = []
    for _ in range(25):
        timer.step(1e-4)
        samples.append(voltage(timer, "out"))
    assert max(samples) > 4.5 and min(samples) < 0.5


def test_pure_wire_merges_net_nodes():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    a = node(scene, "a")
    b = node(scene, "b")
    dc(scene, "V1", a, gnd, 10.0)
    scene.add_edge(name="RL", source=b.id, target=gnd.id, kind="resistor",
                   params={"R": 1000.0})
    wire(scene, "WNET", a, b)
    for _ in range(2):
        scene.step(1e-4)
    assert abs(voltage(scene, "a") - 10.0) < 0.01
    assert abs(voltage(scene, "b") - 10.0) < 0.01


def test_pure_wire_rejects_pins_and_device_device():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    a = node(scene, "a")
    b = node(scene, "b")
    with pytest.raises(ValidationError):
        scene.add_edge(name="BAD", source=a.id, target=b.id, kind="wire",
                       source_pin="1")
    d1 = device(scene, "D1", "resistor", R=1000.0)
    d2 = device(scene, "D2", "resistor", R=1000.0)
    with pytest.raises(ValidationError):
        scene.add_edge(name="BAD2", source=d1.id, target=d2.id, kind="wire",
                       source_pin="1", target_pin="1")


def test_common_collector_template_follows_input():
    scene = Scene("circuit")
    scene.load_payload(build_template("common_collector"))
    emitter = next(item for item in scene.nodes.values() if item.name == "EMIT")
    samples = []
    for index in range(1200):
        scene.step(1e-5)
        if index >= 800:
            samples.append(float(emitter.data.get("voltage", 0.0)))
    low, high = min(samples), max(samples)
    assert 2.7 < low < 3.2
    assert 0.3 < high - low < 0.5
