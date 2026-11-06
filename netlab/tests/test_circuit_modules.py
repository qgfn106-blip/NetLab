"""R24/D49–D51 电路模块：端口标记、封装、电气直连展开（票 P7-06 / P7-08）。"""

from __future__ import annotations

import pytest

from netlab.core.model.blocks import encapsulate_nodes
from netlab.core.compute.circuit_modules import (
    encapsulate_circuit,
    flatten_circuit,
    instantiate_circuit_block,
    module_net_map,
)
from netlab.core.common.limits import ComputeError, ValidationError
from netlab.core.model.scene import CircuitEngine, Scene


def node(scene, name, kind="node", **params):
    return scene.add_node(name=name, kind=kind, params=params or None)


def device(scene, name, element, **params):
    return scene.add_node(
        name=name, kind="device", params={"element": element, **params}
    )


def wire(scene, name, source, target, *, source_pin="", target_pin=""):
    return scene.add_edge(
        name=name,
        source=source.id,
        target=target.id,
        kind="wire",
        source_pin=source_pin,
        target_pin=target_pin,
    )


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
    return scene, {"gnd": gnd, "top": top, "mid": mid, "R1": r1, "R2": r2}


def settle(scene, steps=2):
    for _ in range(steps):
        scene.step(1e-4)


def test_net_port_marker_roundtrip():
    scene, parts = divider_scene()
    scene.update_node(parts["mid"].id, {"params": {"port_name": "vmid"}})
    assert scene.nodes[parts["mid"].id].params == {
        "port_name": "vmid",
        "port_direction": "inout",
    }
    with pytest.raises(ValidationError):
        scene.update_node(parts["mid"].id, {"params": {"port_direction": "input"}})


def test_encapsulate_keeps_voltage_equal():
    """封装前后外部节点电压逐点相等（R24 验收①）。"""
    scene, parts = divider_scene()
    scene.update_node(parts["mid"].id, {"params": {"port_name": "vmid"}})
    settle(scene)
    before = {name: voltage(scene, name) for name in ("top", "gnd", "mid")}

    block = encapsulate_circuit(
        scene, [parts["R1"].id, parts["mid"].id], name="divider"
    )
    assert block.mode == "circuit"
    assert {port.name for port in block.ports} == {"vmid", "top"}
    assert all(port.dtype == "electrical" for port in block.ports)
    assert all(port.net in {item["id"] for item in block.nodes} for port in block.ports)

    settle(scene)
    after = {name: voltage(scene, name) for name in ("top", "gnd", "mid")}
    for name in before:
        assert abs(after[name] - before[name]) < 1e-6, name
    assert abs(after["mid"] - 5.0) < 0.01


def test_encapsulate_absorbed_net_reconnects_outer_wires():
    """被吸收的网络留在父场景做端口网络，外部导线改接过去。"""
    scene, parts = divider_scene()
    settle(scene)
    top_before = voltage(scene, "top")
    block = encapsulate_nodes(
        scene, [parts["R1"].id, parts["R2"].id, parts["mid"].id], name="divider2"
    )
    assert block.mode == "circuit"
    module = next(item for item in scene.nodes.values() if item.kind == "module")
    assert set(module_net_map(scene, module.id)) == {port.name for port in block.ports}
    settle(scene)
    assert abs(voltage(scene, "top") - top_before) < 1e-6


def test_instantiate_circuit_block_adds_module_node():
    scene, parts = divider_scene()
    block = encapsulate_circuit(
        scene, [parts["R1"].id, parts["R2"].id, parts["mid"].id], name="divider3"
    )
    instance = instantiate_circuit_block(
        scene, block, position={"x": 120.0, "y": -60.0}
    )
    module = scene.nodes[instance["module_node"]]
    assert module.kind == "module"
    assert [item["name"] for item in module.params["ports"]] == [
        port.name for port in block.ports
    ]


def test_flatten_tolerates_unwired_ports():
    """端口没接线时求解不炸，校验给"端口未接线"警告。"""
    from netlab.core.model.schematic import validate_schematic

    scene, parts = divider_scene()
    encapsulate_circuit(
        scene, [parts["R1"].id, parts["R2"].id, parts["mid"].id], name="divider4"
    )
    module = next(item for item in scene.nodes.values() if item.kind == "module")
    wire_edge = next(
        edge
        for edge in scene.edges.values()
        if edge.kind == "wire" and module.id in (edge.source, edge.target)
    )
    scene.edges.pop(wire_edge.id)
    extra_nodes, extra_edges, merges = flatten_circuit(scene)
    assert extra_nodes and extra_edges
    assert len(merges) == 1
    warnings = validate_schematic(scene)["warnings"]
    assert any("端口未接线" in item for item in warnings)


def test_circuit_block_roundtrip_and_run(tmp_path):
    """封装 → 落库 → 载入 → 拖入 → 运行（R24 验收②③④）。"""
    from netlab.core.model import blocklib
    from netlab.core.compute.circuit_modules import instantiate_circuit_block

    scene, parts = divider_scene()
    block = encapsulate_circuit(
        scene, [parts["R1"].id, parts["R2"].id, parts["mid"].id], name="divider5"
    )
    library = tmp_path / "library"
    library.mkdir()
    blocklib.import_block(library, block.to_payload())
    listed = blocklib.scan_library(library)
    assert [item["id"] for item in listed] == [block.id]
    assert listed[0]["mode"] == "circuit"

    loaded = blocklib.load_block(library, block.id)
    assert loaded.mode == "circuit"
    assert [port.name for port in loaded.ports] == [port.name for port in block.ports]

    fresh = Scene("circuit")
    fresh.blocks.add(loaded)
    gnd = fresh.add_node(name="gnd", kind="ground")
    top = fresh.add_node(name="top", kind="node")
    fresh.add_edge(
        name="V1",
        source=top.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 10.0, "amplitude": 0.0},
    )
    instance = instantiate_circuit_block(fresh, loaded, position={"x": 200.0, "y": 0.0})
    module = instance["module_node"]
    port_names = [port.name for port in loaded.ports]
    for index, name in enumerate(port_names, start=1):
        net = top if name == "top" else gnd
        fresh.add_edge(
            name=f"W{index}",
            source=module,
            target=net.id,
            kind="wire",
            source_pin=name,
        )
    for _ in range(2):
        fresh.step(1e-4)
    assert abs(voltage(fresh, "top") - 10.0) < 0.01
    module_node = fresh.nodes[module]
    assert module_node.kind == "module"
    assert module_node.name == "divider5"


def test_module_wire_autofills_single_port():
    """单端口模块：外部直连唯一端口，不必再指定引脚名（R24 交互修复）。"""
    scene, parts = divider_scene()
    # 只给 top 打端口标记，其余全进模块 → 正好一个端口
    scene.update_node(parts["top"].id, {"params": {"port_name": "vin"}})
    block = encapsulate_circuit(
        scene,
        [item.id for item in parts.values()],
        name="divider1p",
    )
    assert len(block.ports) == 1
    module = next(item for item in scene.nodes.values() if item.kind == "module")
    outside = node(scene, "out")
    edge = wire(scene, "Wx", module, outside)
    assert edge.source_pin == block.ports[0].name


def test_module_wire_still_requires_pin_when_ambiguous():
    """多端口模块：仍必须显式指定引脚，不能猜。"""
    scene, parts = divider_scene()
    encapsulate_circuit(
        scene, [parts["R1"].id, parts["R2"].id, parts["mid"].id], name="divider3p"
    )
    module = next(item for item in scene.nodes.values() if item.kind == "module")
    outside = node(scene, "out2")
    with pytest.raises(ValidationError, match="必须指定引脚"):
        wire(scene, "Wy", module, outside)


def test_port_wires_carry_layout_and_validate_clean():
    """封装生成的端口导线要有布局，校验不再把「没布局」当错误。"""
    from netlab.core.model.schematic import validate_schematic

    scene, parts = divider_scene()
    encapsulate_circuit(
        scene, [parts["R1"].id, parts["R2"].id, parts["mid"].id], name="divider6"
    )
    wires = [
        edge for edge in scene.edges.values() if edge.kind == "wire" and edge.target_pin
    ]
    assert wires
    for edge in wires:
        assert edge.layout.get("rot") in (0, 90)
        assert "x" in edge.layout and "y" in edge.layout
    report = validate_schematic(scene)
    assert not [item for item in report["blocking"] if "rot 必须是" in item]


def test_circuit_encapsulate_api_loop(client, tmp_path):
    """服务层全链路：建电路 → 标记端口 → 封装落库 → 拖入 → 运行（P7-06/08）。"""
    client.post("/api/mode", json={"mode": "circuit"})
    library = str(tmp_path / "library")

    def add_node(name, kind, **extra):
        response = client.post("/api/nodes", json={"name": name, "kind": kind, **extra})
        assert response.status_code == 200, response.text
        return response.json()["node"]

    gnd = add_node("gnd2", "ground")
    top = add_node("top2", "node")
    mid = add_node("mid2", "node", params={"port_name": "vmid"})
    r1 = add_node("Rc", "device", params={"element": "resistor", "R": 1000.0})
    r2 = add_node("Rd", "device", params={"element": "resistor", "R": 1000.0})
    source = client.post(
        "/api/edges",
        json={
            "name": "V2",
            "source": top["id"],
            "target": gnd["id"],
            "kind": "vsource",
            "params": {"wave": "dc", "offset": 10.0, "amplitude": 0.0},
        },
    )
    assert source.status_code == 200, source.text
    for name, node, target, pin in (
        ("W1", r1, top, "1"),
        ("W2", r1, mid, "2"),
        ("W3", r2, mid, "1"),
        ("W4", r2, gnd, "2"),
    ):
        response = client.post(
            "/api/edges",
            json={
                "name": name,
                "source": node["id"],
                "target": target["id"],
                "kind": "wire",
                "source_pin": pin,
            },
        )
        assert response.status_code == 200, response.text

    client.post("/api/control", json={"action": "step", "steps": 4})
    scene = client.get("/api/scene/export").json()
    mid_voltage = next(node for node in scene["nodes"] if node["name"] == "mid2")[
        "data"
    ]["voltage"]
    assert abs(mid_voltage - 5.0) < 0.05

    encapsulated = client.post(
        "/api/blocks/encapsulate",
        json={
            "node_ids": [r1["id"], r2["id"], mid["id"]],
            "name": "divider-api",
            "library": library,
        },
    )
    assert encapsulated.status_code == 200, encapsulated.text
    body = encapsulated.json()
    block_id = body["block"]["id"]
    assert body["block"]["mode"] == "circuit"
    # mid2 带端口标记，虽然完全在模块内部，也要导出成端口（D49）
    assert {port["name"] for port in body["block"]["ports"]} == {"gnd2", "top2", "vmid"}

    after = client.get("/api/scene/export").json()
    modules = [node for node in after["nodes"] if node["kind"] == "module"]
    assert len(modules) == 1
    assert {port["name"] for port in modules[0]["params"]["ports"]} == {
        "gnd2",
        "top2",
        "vmid",
    }

    client.post("/api/control", json={"action": "step", "steps": 4})
    stepped = client.get("/api/scene/export").json()
    top_after = next(node for node in stepped["nodes"] if node["name"] == "top2")[
        "data"
    ]["voltage"]
    assert abs(top_after - 10.0) < 0.05

    instantiated = client.post(
        "/api/blocks/instantiate",
        json={
            "block_id": block_id,
            "library": library,
            "position": {"x": 240.0, "y": 40.0},
        },
    )
    assert instantiated.status_code == 200, instantiated.text
    instance = instantiated.json()["instance"]
    assert instance["block_node"]
    assert len(instance["ports"]) == 3


def _sine_source(scene, name, a, b, amplitude=5.0, frequency=1000.0):
    return scene.add_edge(
        name=name,
        source=a.id,
        target=b.id,
        kind="vsource",
        params={
            "wave": "sine",
            "offset": 0.0,
            "amplitude": amplitude,
            "frequency": frequency,
        },
    )


def _flat_divider():
    """参考电路：与模块内部完全等价的平铺分压器。"""
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    top = node(scene, "top")
    mid = node(scene, "mid")
    _sine_source(scene, "V1", top, gnd)
    r1 = device(scene, "R1", "resistor", R=1000.0)
    r2 = device(scene, "R2", "resistor", R=1000.0)
    wire(scene, "W1", r1, top, source_pin="1")
    wire(scene, "W2", r1, mid, source_pin="2")
    wire(scene, "W3", r2, mid, source_pin="1")
    wire(scene, "W4", r2, gnd, source_pin="2")
    return scene, mid


def _modular_divider(count=1):
    """把同一个分压器封装成电路模块，再在另一场景里按引脚接回去。"""
    seed, parts = divider_scene()
    seed.update_node(parts["mid"].id, {"params": {"port_name": "vmid"}})
    block = encapsulate_circuit(
        seed, [parts["R1"].id, parts["R2"].id, parts["mid"].id], name="divider-eq"
    )
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    top = node(scene, "top")
    _sine_source(scene, "V1", top, gnd)
    mids = []
    for index in range(count):
        mid = node(scene, f"out{index + 1}")
        instance = instantiate_circuit_block(
            scene,
            block,
            position={"x": 120.0 * index, "y": 0.0},
            name_prefix=f"div{index + 1}",
        )
        module_id = instance["module_node"]
        pins = {port.name for port in block.ports}
        assert pins == {"top", "gnd", "vmid"}
        wire(scene, f"WM{index}a", top, scene.nodes[module_id], target_pin="top")
        wire(scene, f"WM{index}b", gnd, scene.nodes[module_id], target_pin="gnd")
        wire(scene, f"WM{index}c", mid, scene.nodes[module_id], target_pin="vmid")
        mids.append(mid)
    return scene, mids, block


def test_flatten_matches_flat_circuit_frame_by_frame():
    """封装 + 实例化后，逐帧电压与平铺电路完全一致（P7-08 验收①）。"""
    flat, flat_mid = _flat_divider()
    modular, mids, _block = _modular_divider()
    assert len(mids) == 1
    flat_trace, module_trace = [], []
    for _ in range(24):
        flat.step(1e-4)
        modular.step(1e-4)
        flat_trace.append(float(flat_mid.data.get("voltage", 0.0)))
        module_trace.append(float(mids[0].data.get("voltage", 0.0)))
    assert max(abs(a - b) for a, b in zip(flat_trace, module_trace)) < 1e-6
    # 波形本身必须有内容，避免"两边都是 0"也能通过
    assert max(abs(item) for item in flat_trace) > 0.5


def test_flatten_merges_port_net_into_internal_net():
    """内外端口合并成同一个 MNA 节点：merges 指向「模块 id/内部网络」。"""
    scene, mids, block = _modular_divider()
    module = next(item for item in scene.nodes.values() if item.kind == "module")
    extra_nodes, extra_edges, merges = flatten_circuit(scene)
    assert extra_nodes and extra_edges
    internal = {f"{module.id}/{port.net}" for port in block.circuit_ports}
    external = set(module_net_map(scene, module.id).values())
    assert {left for left, _ in merges} <= external
    assert {right for _, right in merges} <= internal
    assert len(merges) == 3


def test_two_module_instances_stay_independent():
    """同一定义的两个实例各自独立求解，互不串扰。"""
    scene, mids, _block = _modular_divider(count=2)
    for _ in range(12):
        scene.step(1e-4)
    first = float(mids[0].data.get("voltage", 0.0))
    second = float(mids[1].data.get("voltage", 0.0))
    assert abs(first - second) < 1e-9
    assert abs(first) > 0.2


def test_boundary_group_merges_ports_to_same_outer_net():
    """两个器件引脚接到同一个外部网络时，只生成一个端口（不要 mid / mid_2）。"""
    scene, parts = divider_scene()
    # 只选两个电阻，不选中间网络 mid：mid 对两个电阻都是「外部网络」。
    block = encapsulate_circuit(
        scene, [parts["R1"].id, parts["R2"].id], name="pins-only"
    )
    names = [port.name for port in block.ports]
    assert len(names) == len(set(names)), names
    assert names.count("mid") == 1
    assert set(names) == {"top", "mid", "gnd"}
    # 端口在模块内部必须各自指向不同的网络节点，且接线不重复。
    nets = [port.net for port in block.ports]
    assert len(nets) == len(set(nets)) == 3


def test_encapsulate_reports_stale_node_hint():
    """选中已不存在的节点时，报错要说清楚该怎么办（画布过期）。"""
    scene, parts = divider_scene()
    stale = "deadbeefcafe"
    with pytest.raises(ValidationError) as excinfo:
        encapsulate_circuit(scene, [parts["R1"].id, stale], name="stale")
    message = str(excinfo.value)
    assert "刷新画布" in message
    assert stale in message


def _legacy_divider():
    """旧模型电路：器件本身就是「元件边」（kind=resistor / vsource），没有器件节点。"""
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    top = node(scene, "top")
    mid = node(scene, "mid")
    out = node(scene, "out")
    scene.add_edge(
        name="V1",
        source=top.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 10.0, "amplitude": 0.0},
    )
    scene.add_edge(
        name="R1", source=top.id, target=mid.id, kind="resistor", params={"R": 1000.0}
    )
    scene.add_edge(
        name="R2", source=mid.id, target=gnd.id, kind="resistor", params={"R": 2000.0}
    )
    wire(scene, "Wout", mid, out)
    return scene, {"top": top, "mid": mid, "gnd": gnd, "out": out}


def test_encapsulate_moves_legacy_element_edges_into_block():
    """旧模型电路封装后，元件边必须跟着进模块，父场景不能留下悬空元件。"""
    scene, parts = _legacy_divider()
    block = encapsulate_circuit(
        scene,
        [parts["top"].id, parts["mid"].id, parts["gnd"].id],
        name="legacy-divider",
    )
    kinds = sorted(edge["kind"] for edge in block.edges)
    assert kinds == ["resistor", "resistor", "vsource"]
    # 端口沿用内部网络名（mid），父场景留一个同名网络接出去。
    assert [port.name for port in block.ports] == ["mid"]

    # 父场景里每条元件边的两端都还必须在场上，否则运行时就会
    # 报「元件 'xxx' 无法装配：'<不存在的节点 id>'」。
    for edge in scene.edges.values():
        if not edge.enabled or edge.kind == "wire":
            continue
        assert edge.source in scene.nodes
        assert edge.target in scene.nodes

    # 再把模块实例接回一个新场景：模块自带电压源，只把 mid 端口接到外部节点。
    rebuilt = Scene("circuit")
    out = node(rebuilt, "out")
    instance = instantiate_circuit_block(rebuilt, block, position={"x": 0.0, "y": 0.0})
    module_id = instance["module_node"]
    wire(rebuilt, "WMmid", out, rebuilt.nodes[module_id], target_pin="mid")
    rebuilt.step(1e-4)
    assert abs(float(out.data.get("voltage", 0.0)) - 10.0 * 2000.0 / 3000.0) < 1e-6


def test_encapsulate_rejects_element_straddling_selection():
    """元件的两个引脚分在选中范围两侧时，要给出可操作的提示，而不是留下坏场景。"""
    scene, parts = _legacy_divider()
    with pytest.raises(ValidationError) as excinfo:
        encapsulate_circuit(scene, [parts["top"].id, parts["mid"].id], name="half")
    message = str(excinfo.value)
    assert "两侧" in message
    assert "V1" in message or "R2" in message


def test_shared_inner_net_merges_groups_and_drops_aliases():
    """同一个被选中网络接到多个外部网络时，只留一个端口，并删除别名内部网络。"""
    scene = Scene("circuit")
    a = node(scene, "A")
    b = node(scene, "B")
    x = node(scene, "X")
    y = node(scene, "Y")
    r = device(scene, "R", "resistor", R=1000.0)
    wire(scene, "WR1", r, x, source_pin="1")
    wire(scene, "WR2", r, y, source_pin="2")
    wire(scene, "BA", a, x)
    wire(scene, "BB", b, y)
    wire(scene, "BC", b, x)

    block = encapsulate_circuit(scene, [r.id, x.id, y.id], name="merged")

    assert len(block.circuit_ports) == 1
    assert len({port.net for port in block.circuit_ports}) == 1
    inner_names = [item["name"] for item in block.nodes]
    assert inner_names.count("X") == 1
    assert "Y" not in inner_names
    endpoints = {edge["source"] for edge in block.edges} | {
        edge["target"] for edge in block.edges
    }
    assert block.circuit_ports[0].net in endpoints

    module = next(item for item in scene.nodes.values() if item.kind == "module")
    assert len(module_net_map(scene, module.id)) == 1
    parent_net_names = [
        item.name for item in scene.nodes.values() if item.kind == "node"
    ]
    assert parent_net_names.count("X") == 1


def test_merged_group_uses_port_marker_from_any_member():
    """合并分组时端口标记不能因为“不是第一个外部网络”就被丢掉。"""
    scene = Scene("circuit")
    a = node(scene, "A")
    b = node(scene, "B", port_name="OUT", port_direction="output")
    x = node(scene, "X")
    y = node(scene, "Y")
    r = device(scene, "R", "resistor", R=1000.0)
    wire(scene, "WR1", r, x, source_pin="1")
    wire(scene, "WR2", r, y, source_pin="2")
    wire(scene, "BA", a, x)
    wire(scene, "BB", b, y)
    wire(scene, "BC", b, x)

    block = encapsulate_circuit(scene, [r.id, x.id, y.id], name="merged-marker")

    assert block.circuit_ports[0].name == "OUT"
    assert block.circuit_ports[0].direction == "output"


def test_merged_group_rejects_conflicting_port_markers():
    """同一电气网络上的两个不同端口名是歧义，应明确报错而不是静默选一个。"""
    scene = Scene("circuit")
    a = node(scene, "A", port_name="LEFT")
    b = node(scene, "B", port_name="RIGHT")
    x = node(scene, "X")
    y = node(scene, "Y")
    r = device(scene, "R", "resistor", R=1000.0)
    wire(scene, "WR1", r, x, source_pin="1")
    wire(scene, "WR2", r, y, source_pin="2")
    wire(scene, "BA", a, x)
    wire(scene, "BB", b, y)
    wire(scene, "BC", b, x)

    with pytest.raises(ValidationError, match="多个不同名称"):
        encapsulate_circuit(scene, [r.id, x.id, y.id], name="conflict")
