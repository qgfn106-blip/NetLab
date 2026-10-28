"""R19 图纸模型数据层：引脚表、边布局、确定性自动布局与校验。"""

from __future__ import annotations

import math
from typing import Any

from .limits import ValidationError
from .nodal import element_spec

GRID = 20
RANK_STEP = 220
LANE_STEP = 120
ROT_STEP = 30
ELEMENT_PINS: dict[str, tuple[dict[str, Any], ...]] = {
    "vcvs": (
        {"name": "OUT+", "role": "output", "bind": "source", "dx": 0.0, "dy": 0.0},
        {"name": "OUT-", "role": "output", "bind": "target", "dx": 0.0, "dy": 0.0},
        {"name": "IN+", "role": "input", "bind": "control_source", "dx": 0.0, "dy": 0.0},
        {"name": "IN-", "role": "input", "bind": "control_target", "dx": 0.0, "dy": 0.0},
    ),
    "vccs": (
        {"name": "OUT+", "role": "output", "bind": "source", "dx": 0.0, "dy": 0.0},
        {"name": "OUT-", "role": "output", "bind": "target", "dx": 0.0, "dy": 0.0},
        {"name": "IN+", "role": "input", "bind": "control_source", "dx": 0.0, "dy": 0.0},
        {"name": "IN-", "role": "input", "bind": "control_target", "dx": 0.0, "dy": 0.0},
    ),
    "opamp": (
        {"name": "IN+", "role": "input", "bind": "vp", "dx": 0.0, "dy": 0.0},
        {"name": "IN-", "role": "input", "bind": "vn", "dx": 0.0, "dy": 0.0},
        {"name": "V+", "role": "power", "bind": "", "dx": 0.0, "dy": 0.0},
        {"name": "V-", "role": "power", "bind": "", "dx": 0.0, "dy": 0.0},
        {"name": "OUT", "role": "output", "bind": "source", "dx": 0.0, "dy": 0.0},
    ),
    "comparator": (
        {"name": "IN+", "role": "input", "bind": "vp", "dx": 0.0, "dy": 0.0},
        {"name": "IN-", "role": "input", "bind": "vn", "dx": 0.0, "dy": 0.0},
        {"name": "V+", "role": "power", "bind": "", "dx": 0.0, "dy": 0.0},
        {"name": "V-", "role": "power", "bind": "", "dx": 0.0, "dy": 0.0},
        {"name": "OUT", "role": "output", "bind": "source", "dx": 0.0, "dy": 0.0},
    ),
    "dflipflop": (
        {"name": "D", "role": "input", "bind": "d_node", "dx": 0.0, "dy": 0.0},
        {"name": "CLK", "role": "input", "bind": "clk_node", "dx": 0.0, "dy": 0.0},
        {"name": "Q+", "role": "output", "bind": "source", "dx": 0.0, "dy": 0.0},
        {"name": "Q-", "role": "output", "bind": "target", "dx": 0.0, "dy": 0.0},
    ),
}


ELEMENT_PINS.update({
    "npn": (
        {"name": "C", "role": "output", "bind": "source", "dx": 0.0, "dy": 0.0},
        {"name": "B", "role": "input", "bind": "base_node", "dx": 0.0, "dy": 0.0},
        {"name": "E", "role": "output", "bind": "target", "dx": 0.0, "dy": 0.0},
    ),
    "pnp": (
        {"name": "C", "role": "output", "bind": "source", "dx": 0.0, "dy": 0.0},
        {"name": "B", "role": "input", "bind": "base_node", "dx": 0.0, "dy": 0.0},
        {"name": "E", "role": "output", "bind": "target", "dx": 0.0, "dy": 0.0},
    ),
    "nmos": (
        {"name": "D", "role": "output", "bind": "source", "dx": 0.0, "dy": 0.0},
        {"name": "G", "role": "input", "bind": "gate_node", "dx": 0.0, "dy": 0.0},
        {"name": "S", "role": "output", "bind": "target", "dx": 0.0, "dy": 0.0},
    ),
    "pmos": (
        {"name": "D", "role": "output", "bind": "source", "dx": 0.0, "dy": 0.0},
        {"name": "G", "role": "input", "bind": "gate_node", "dx": 0.0, "dy": 0.0},
        {"name": "S", "role": "output", "bind": "target", "dx": 0.0, "dy": 0.0},
    ),
})


ELEMENT_PINS.update({
    kind: (
        {"name": "A", "role": "input", "bind": "in_a", "dx": -18, "dy": -8},
        {"name": "B", "role": "input", "bind": "in_b", "dx": -18, "dy": 8},
        {"name": "VDD", "role": "power", "bind": "vdd_node", "dx": 0, "dy": -18},
        {"name": "Y", "role": "output", "bind": "source", "dx": 20, "dy": 0},
    )
    for kind in ("and_gate", "or_gate", "not_gate", "xor_gate")
})


ELEMENT_PINS.update({
    "ne555": (
        {"name": "OUT", "role": "output", "bind": "source", "dx": 18, "dy": 0},
        {"name": "GND", "role": "power", "bind": "target", "dx": -18, "dy": 8},
        {"name": "VCC", "role": "power", "bind": "vcc_node", "dx": -18, "dy": -8},
    ),
    "ldo": (
        {"name": "IN", "role": "input", "bind": "vin_node", "dx": -18, "dy": 0},
        {"name": "OUT", "role": "output", "bind": "source", "dx": 18, "dy": 0},
        {"name": "GND", "role": "power", "bind": "target", "dx": 0, "dy": 18},
    ),
})


ELEMENT_PINS.update({
    "counter4": (
        {"name": "CLK", "role": "input", "bind": "clk_node", "dx": -18, "dy": -6},
        {"name": "RST", "role": "input", "bind": "rst_node", "dx": -18, "dy": 6},
        {"name": "Q0", "role": "output", "bind": "q0_node", "dx": 18, "dy": -12},
        {"name": "Q1", "role": "output", "bind": "q1_node", "dx": 18, "dy": -4},
        {"name": "Q2", "role": "output", "bind": "q2_node", "dx": 18, "dy": 4},
        {"name": "Q3", "role": "output", "bind": "q3_node", "dx": 18, "dy": 12},
    ),
    "dac4": (
        {"name": "B0", "role": "input", "bind": "b0_node", "dx": -18, "dy": -12},
        {"name": "B1", "role": "input", "bind": "b1_node", "dx": -18, "dy": -4},
        {"name": "B2", "role": "input", "bind": "b2_node", "dx": -18, "dy": 4},
        {"name": "B3", "role": "input", "bind": "b3_node", "dx": -18, "dy": 12},
        {"name": "OUT", "role": "output", "bind": "source", "dx": 20, "dy": 0},
        {"name": "GND", "role": "power", "bind": "target", "dx": 0, "dy": 18},
    ),
})


ELEMENT_PINS.update({
    "shift4": (
        {"name": "D", "role": "input", "bind": "d_node", "dx": -18, "dy": -6},
        {"name": "CLK", "role": "input", "bind": "clk_node", "dx": -18, "dy": 6},
        {"name": "RST", "role": "input", "bind": "rst_node", "dx": -18, "dy": 14},
        {"name": "Q0", "role": "output", "bind": "q0_node", "dx": 18, "dy": -12},
        {"name": "Q1", "role": "output", "bind": "q1_node", "dx": 18, "dy": -4},
        {"name": "Q2", "role": "output", "bind": "q2_node", "dx": 18, "dy": 4},
        {"name": "Q3", "role": "output", "bind": "q3_node", "dx": 18, "dy": 12},
    ),
})


ELEMENT_PINS.update({
    "transformer": (
        {"name": "P1", "role": "input", "bind": "source", "dx": -18, "dy": -6},
        {"name": "P2", "role": "input", "bind": "target", "dx": -18, "dy": 6},
        {"name": "S1", "role": "output", "bind": "secondary_source", "dx": 18, "dy": -6},
        {"name": "S2", "role": "output", "bind": "secondary_target", "dx": 18, "dy": 6},
    ),
    "coupling_inductor": (
        {"name": "P1", "role": "input", "bind": "source", "dx": -18, "dy": -6},
        {"name": "P2", "role": "input", "bind": "target", "dx": -18, "dy": 6},
        {"name": "S1", "role": "output", "bind": "secondary_source", "dx": 18, "dy": -6},
        {"name": "S2", "role": "output", "bind": "secondary_target", "dx": 18, "dy": 6},
    ),
    "adc4": (
        {"name": "VIN", "role": "input", "bind": "vin_node", "dx": -18, "dy": -8},
        {"name": "CLK", "role": "input", "bind": "clk_node", "dx": -18, "dy": 8},
        {"name": "Q0", "role": "output", "bind": "source", "dx": 18, "dy": -12},
        {"name": "Q1", "role": "output", "bind": "q1_node", "dx": 18, "dy": -4},
        {"name": "Q2", "role": "output", "bind": "q2_node", "dx": 18, "dy": 4},
        {"name": "Q3", "role": "output", "bind": "q3_node", "dx": 18, "dy": 12},
        {"name": "COM", "role": "power", "bind": "target", "dx": 0, "dy": 18},
    ),
})


def pins_for(kind: str) -> tuple[dict[str, Any], ...]:
    """返回符号引脚表；两端元件默认 pin1/pin2。"""
    if kind in ELEMENT_PINS:
        return ELEMENT_PINS[kind]
    return (
        {"name": "pin1", "role": "passive", "bind": "source", "dx": 0.0, "dy": 0.0},
        {"name": "pin2", "role": "passive", "bind": "target", "dx": 0.0, "dy": 0.0},
    )


def apply_pin_bindings(edge_payload: dict[str, Any]) -> dict[str, Any]:
    """把 ``pins{引脚:节点id}`` 解析为电气绑定（写回 params 的绑定键）。"""
    pins = edge_payload.get("pins")
    if pins is None:
        return edge_payload
    if not isinstance(pins, dict) or not pins:
        raise ValidationError("pins 必须是非空对象：{引脚名: 节点id}")
    kind = str(edge_payload.get("kind") or "")
    table = {item["name"]: item for item in pins_for(kind)}
    params = dict(edge_payload.get("params") or {})
    for name, node_id in pins.items():
        pin = table.get(str(name))
        if pin is None:
            raise ValidationError(f"元件 {kind!r} 没有引脚 {name!r}；可用：{', '.join(table)}")
        if not isinstance(node_id, str) or not node_id:
            raise ValidationError(f"引脚 {name!r} 的节点 id 不合法")
        bind = str(pin["bind"])
        if bind == "source":
            edge_payload["source"] = node_id
        elif bind == "target":
            edge_payload["target"] = node_id
        elif bind:
            params[bind] = node_id
        # bind 为空 = 该引脚只参与图纸，不对应旧参数端口（如运放 V+/V−）。
    edge_payload["params"] = params
    return edge_payload


def _rank_map(scene: Any) -> dict[str, tuple[int, int]]:
    """确定性分层：BFS 生成树；子节点围绕父 lane 展开，尽量让边保持水平。"""
    adjacency: dict[str, set[str]] = {node_id: set() for node_id in scene.nodes}
    roots: list[str] = []
    for edge in scene.edges.values():
        if not edge.enabled:
            continue
        adjacency.setdefault(edge.source, set()).add(edge.target)
        adjacency.setdefault(edge.target, set()).add(edge.source)
        if edge.kind in ("vsource", "isource"):
            roots.append(edge.source)
    if not roots:
        roots = sorted(scene.nodes)
    ranks: dict[str, int] = {}
    parent: dict[str, str] = {}
    children: dict[str, list[str]] = {}
    order: list[str] = []
    queue: list[str] = []
    for root in sorted(set(roots)):
        ranks[root] = 0
        queue.append(root)
        order.append(root)
    head = 0
    while head < len(queue):
        current = queue[head]
        head += 1
        for neighbor in sorted(adjacency.get(current, ())):
            if neighbor not in ranks:
                ranks[neighbor] = ranks[current] + 1
                parent[neighbor] = current
                children.setdefault(current, []).append(neighbor)
                queue.append(neighbor)
                order.append(neighbor)
    for node_id in sorted(scene.nodes):
        if node_id not in ranks:
            ranks[node_id] = 0
            order.append(node_id)
    lanes: dict[str, int] = {root: 0 for root in roots}
    used: dict[int, set[int]] = {}
    for node_id in order:
        lane = lanes.get(node_id, 0)
        rank = ranks[node_id]
        if lane in used.setdefault(rank, set()):
            lane += 1
            while lane in used[rank]:
                lane += 1
            lanes[node_id] = lane
        used[rank].add(lane)
        kids = children.get(node_id, [])
        offsets = [0]
        for step in range(1, len(kids) + 1):
            offsets.extend([step, -step])
        for index, child in enumerate(kids):
            lanes[child] = lane + offsets[index % len(offsets)]
    result: dict[str, tuple[int, int]] = {}
    for node_id in sorted(scene.nodes):
        result[node_id] = (ranks[node_id], lanes.get(node_id, 0))
    return result


def auto_layout(scene: Any) -> dict[str, Any]:
    """确定性自动布局：节点落 20 网格，元件放中点，旋转量化 30°。"""
    if scene.mode != "circuit":
        return {"ok": False, "reason": "自动布局仅支持 circuit 场景"}
    positions = _rank_map(scene)
    nodes: dict[str, dict[str, float]] = {}
    for node_id, (rank, lane) in positions.items():
        nodes[node_id] = {
            "x": float(rank * RANK_STEP),
            "y": float((lane - 1) * LANE_STEP),
        }
    edges: dict[str, dict[str, Any]] = {}
    for edge in sorted(scene.edges.values(), key=lambda item: item.id):
        source = nodes.get(edge.source)
        target = nodes.get(edge.target)
        if source is None or target is None:
            continue
        dx = target["x"] - source["x"]
        dy = target["y"] - source["y"]
        # 自动布局优先水平/垂直（0/90），让密集图的符号保持正向、可读。
        rot = 0 if abs(dx) >= abs(dy) else 90
        edges[edge.id] = {
            "x": round((source["x"] + target["x"]) / 2 / GRID) * GRID,
            "y": round((source["y"] + target["y"]) / 2 / GRID) * GRID,
            "rot": rot,
        }
    return {"ok": True, "nodes": nodes, "edges": edges, "grid": GRID, "rot_step": ROT_STEP}


def apply_layout(scene: Any, layout: dict[str, Any]) -> dict[str, Any]:
    """把布局写回场景（节点锚点 + 元件 layout）。"""
    if not layout.get("ok"):
        raise ValidationError(str(layout.get("reason") or "布局不可用"))
    for node_id, position in (layout.get("nodes") or {}).items():
        record = scene.nodes.get(node_id)
        if record is not None:
            record.position["x"] = float(position["x"])
            record.position["y"] = float(position["y"])
    for edge_id, layout_item in (layout.get("edges") or {}).items():
        record = scene.edges.get(edge_id)
        if record is not None:
            record.layout = {
                "x": float(layout_item["x"]),
                "y": float(layout_item["y"]),
                "rot": int(layout_item["rot"]),
            }
    scene._touch()
    return {"nodes": len(layout.get("nodes") or {}), "edges": len(layout.get("edges") or {})}


def validate_schematic(scene: Any) -> dict[str, Any]:
    """引脚绑定/布局校验；返回 blocking 清单。"""
    blocking: list[str] = []
    for edge in scene.edges.values():
        layout = getattr(edge, "layout", None)
        if layout is not None:
            rot = layout.get("rot")
            if not isinstance(rot, int) or rot % ROT_STEP != 0:
                blocking.append(f"{edge.name}: rot 必须是 {ROT_STEP}° 的整数倍")
        params = edge.params or {}
        kind = edge.kind
        pins = pins_for(kind)
        for pin in pins:
            bind = pin["bind"]
            if bind == "source":
                node_id = edge.source
            elif bind == "target":
                node_id = edge.target
            else:
                node_id = str(params.get(bind) or "")
                if not node_id:
                    continue  # 两端元件不要求所有可选控制脚
            if node_id not in scene.nodes:
                blocking.append(f"{edge.name}: 引脚 {pin['name']} 绑定的节点不存在")
    return {"ok": not blocking, "blocking": blocking, "pins": sum(len(pins_for(e.kind)) for e in scene.edges.values())}


def fill_missing_layout(scene: Any) -> int:
    """旧工程迁移：只给缺失 layout 的电路边补默认布局（不移动节点）。"""
    if scene.mode != "circuit":
        return 0
    filled = 0
    for edge in scene.edges.values():
        if getattr(edge, "layout", None):
            continue
        source = scene.nodes.get(edge.source)
        target = scene.nodes.get(edge.target)
        if source is None or target is None:
            continue
        sx = float(source.position.get("x", 0.0))
        sy = float(source.position.get("y", 0.0))
        tx = float(target.position.get("x", 0.0))
        ty = float(target.position.get("y", 0.0))
        dx = tx - sx
        dy = ty - sy
        angle = math.degrees(math.atan2(dy, dx)) if (dx or dy) else 0.0
        rot = int(round(angle / ROT_STEP) * ROT_STEP) % 360
        edge.layout = {
            "x": round((sx + tx) / 2 / GRID) * GRID,
            "y": round((sy + ty) / 2 / GRID) * GRID,
            "rot": rot,
        }
        filled += 1
    if filled:
        scene._touch()
    return filled

__all__ = ["auto_layout", "apply_layout", "validate_schematic", "pins_for", "apply_pin_bindings", "fill_missing_layout"]
