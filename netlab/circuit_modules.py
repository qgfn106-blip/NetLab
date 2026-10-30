"""电路模块封装（R24 / D49 / D50 / D51，票 P7-06 / P7-08）。

模型
----
信号流模式的模块靠「端口节点 + 数据传递」交换信息；电路模式里"信息"就是同一
电位，所以电路模块的端口绑定到**内部网络**，封装后父场景只留：

* 一个 ``kind="module"`` 的模块节点（引脚名 = 端口名）；
* 每个端口一根导线：外部网络 ↔ 模块引脚。

``BlockDef.mode == "circuit"`` 的内部结构沿用场景的记录格式（``device`` /
``node`` / ``ground`` 节点 + ``wire`` 导线），端口的 ``net`` 字段指出它对应的内部
网络节点 id。求解时按 D51 做电气直连展开（内外端口合并到同一 MNA 节点）。

端口标记
--------
网络节点（``kind`` 为 ``node`` / ``ground``）可以带 ``port_name`` 与
``port_direction`` 参数，表示"这个网络是一个模块端口"。封装时以标记为准；
未标记的跨界网络自动补端口（名字取器件.引脚或网络名，方向默认 ``inout``）。
"""

from __future__ import annotations

import copy
from typing import Any, Iterable, TYPE_CHECKING

from .blocks import MAX_BLOCK_NODES, MAX_BLOCK_PORTS, BlockDef, PortDef
from .limits import LimitError, ValidationError, check_id, check_name

if TYPE_CHECKING:  # pragma: no cover
    from .scene import Scene

#: 端口方向（电路里 ``inout`` 是常态：同一根线既送电也吸电）。
PORT_DIRECTIONS = ("input", "output", "inout")
DEVICE_KINDS = ("device", "module")
NET_KINDS = ("node", "ground")


def _new_id() -> str:
    import uuid

    return uuid.uuid4().hex[:12]


def pin_names(record: Any) -> list[str]:
    """模块节点的引脚名（= 端口名）；普通器件返回空列表。"""
    if record is None or record.kind != "module":
        return []
    ports = record.params.get("ports") or []
    names: list[str] = []
    for item in ports:
        if isinstance(item, dict):
            name = str(item.get("name") or "")
            if name:
                names.append(name)
    return names


def _wire_layout(scene: Any, source_id: str, target_id: str) -> dict[str, float]:
    """给程序生成的导线一个可渲染的布局（规则与自动布局一致，免得校验报未布局）。"""
    left = scene.nodes.get(source_id)
    right = scene.nodes.get(target_id)
    if left is None or right is None:
        return {"x": 0.0, "y": 0.0, "rot": 0}
    x1, y1 = float(left.position["x"]), float(left.position["y"])
    x2, y2 = float(right.position["x"]), float(right.position["y"])
    return {
        "x": (x1 + x2) / 2.0,
        "y": (y1 + y2) / 2.0,
        "rot": 0 if abs(x2 - x1) >= abs(y2 - y1) else 90,
    }


def _port_marker(record: Any) -> tuple[str, str]:
    """读取网络节点上的端口标记，返回 (名称, 方向)。"""
    params = record.params if record is not None else {}
    name = str(params.get("port_name") or "").strip()
    direction = str(params.get("port_direction") or "").strip()
    if direction not in PORT_DIRECTIONS:
        direction = "inout"
    return name, direction


def _unique(base: str, used: set[str]) -> str:
    text = str(base or "").strip() or "p"
    text = text[:32]
    candidate = text
    index = 2
    while candidate in used:
        candidate = f"{text}_{index}"[:32]
        index += 1
    used.add(candidate)
    return candidate


def encapsulate_circuit(
    scene: "Scene",
    node_ids: Iterable[str],
    *,
    name: str,
    description: str = "",
    model: str = "structural",
) -> BlockDef:
    """把选中的电路节点封装成电路模块，父场景替换为一个模块节点。"""
    if scene.mode != "circuit":
        raise ValidationError("只有电路场景可以封装成电路模块")
    selected = [check_id(item, "节点 id") for item in node_ids]
    if not selected:
        raise ValidationError("请选择要封装的电路节点")
    if len(set(selected)) != len(selected):
        raise ValidationError("选中的节点 id 不能重复")
    missing = [item for item in selected if item not in scene.nodes]
    if missing:
        raise ValidationError(
            "选中的节点已不存在（画布可能已过期，或这些节点刚被封装/删除）："
            + ", ".join(missing[:3])
            + "。请刷新画布后重新选择要封装的节点。"
        )
    selected_set = set(selected)
    records = [scene.nodes[item] for item in selected]
    devices = [item for item in records if item.kind in DEVICE_KINDS]
    nets = [item for item in records if item.kind in NET_KINDS]
    others = [item.name for item in records if item.kind not in DEVICE_KINDS + NET_KINDS]
    if others:
        raise ValidationError(
            "只能封装器件与网络节点，下列节点无法封装："
            + ", ".join(sorted(others)[:5])
        )
    if len(devices) > MAX_BLOCK_NODES:
        raise LimitError(f"一次最多封装 {MAX_BLOCK_NODES} 个器件")

    centroid_x = sum(item.position["x"] for item in records) / len(records)
    centroid_y = sum(item.position["y"] for item in records) / len(records)

    wires = [edge for edge in scene.edges.values() if edge.enabled and edge.kind == "wire"]
    internal_wires = [
        edge for edge in wires
        if edge.source in selected_set and edge.target in selected_set
    ]
    boundary_wires = [
        edge for edge in wires
        if (edge.source in selected_set) != (edge.target in selected_set)
    ]
    # 旧模型里器件本身就是一条「元件边」（kind=resistor/vsource/...），不是器件节点。
    # 封装必须把它一起搬进模块，否则父场景删了它两端的节点、却留下这条悬空元件边，
    # 运行时会报「元件 'resistor-9' 无法装配：'<不存在的节点 id>'」。
    elements = [
        edge for edge in scene.edges.values() if edge.enabled and edge.kind != "wire"
    ]
    internal_elements = [
        edge for edge in elements
        if edge.source in selected_set and edge.target in selected_set
    ]
    straddling = [
        edge for edge in elements
        if (edge.source in selected_set) != (edge.target in selected_set)
    ]
    if straddling:
        names = ", ".join(sorted({edge.name for edge in straddling})[:3])
        raise ValidationError(
            f"元件 {names} 的两个引脚分在选中范围的两侧，无法封装；"
            "请把整个元件和它两端连接的网络一起选进来，或先把它挪到模块外面"
        )
    if not devices and not internal_elements:
        raise ValidationError("封装至少要包含一个器件")

    # ---- 内部结构：先复制选中节点，再按边界类型补端口网络 ---------------
    id_map: dict[str, str] = {item.id: _new_id() for item in records}
    inner_nodes: list[dict[str, Any]] = []
    for record in records:
        payload = record.snapshot()
        payload["id"] = id_map[record.id]
        payload.pop("state", None)
        payload.pop("inputs", None)
        payload["position"] = {
            "x": float(record.position["x"] - centroid_x),
            "y": float(record.position["y"] - centroid_y),
        }
        inner_nodes.append(payload)

    inner_edges: list[dict[str, Any]] = []
    for edge in internal_wires:
        payload = edge.snapshot()
        payload["id"] = _new_id()
        payload["source"] = id_map[edge.source]
        payload["target"] = id_map[edge.target]
        payload.pop("state", None)
        inner_edges.append(payload)
    # 器件边（旧模型）也一起进模块；控制端等参数里引用的节点 id 同步改名。
    for edge in internal_elements:
        payload = edge.snapshot()
        payload["id"] = _new_id()
        payload["source"] = id_map[edge.source]
        payload["target"] = id_map[edge.target]
        payload.pop("state", None)
        params = payload.get("params")
        if isinstance(params, dict):
            payload["params"] = {
                key: (id_map[value] if isinstance(value, str) and value in id_map else value)
                for key, value in params.items()
            }
        inner_edges.append(payload)

    used: set[str] = set()
    ports: list[PortDef] = []
    #: 父场景要新建的网络节点：[(新 id, 名称, 位置)]，用于"被吸收的网络"。
    parent_nets: list[dict[str, Any]] = []
    #: 父场景要连到模块引脚的导线：[(外部网络 id, 端口名)]。
    parent_wires: list[tuple[str, str]] = []
    #: 父场景要把已有导线改指向的新网络：[(旧网络 id, 新网络 id)]。
    rewire: dict[str, str] = {}

    def add_port(
        port_name: str,
        direction: str,
        inner_net: str,
        external_net: str,
    ) -> None:
        port = _unique(port_name, used)
        ports.append(
            PortDef(
                name=port,
                direction=direction if direction in PORT_DIRECTIONS else "inout",
                fields=["voltage"],
                dtype="electrical",
                net=inner_net,
                description="电路端口（绑定内部网络）",
            )
        )
        parent_wires.append((external_net, port))

    # ---- 端口：按「外部网络」分组，一个外部网络只生成一个端口 -------------
    # 同一个外部网络可能连到多个内部点（例如只选了两个器件、中间网络没选），
    # 这种情况必须合成一个端口，否则会冒出 mid / mid_2 两个等价引脚。
    groups: list[tuple[Any, list[tuple[Any, str]]]] = []
    group_index: dict[str, int] = {}
    for edge in boundary_wires:
        if edge.source in selected_set:
            inside_id, inside_pin = edge.source, edge.source_pin
            outside_id, outside_pin = edge.target, edge.target_pin
        else:
            inside_id, inside_pin = edge.target, edge.target_pin
            outside_id, outside_pin = edge.source, edge.source_pin
        inside = scene.nodes[inside_id]
        outside = scene.nodes[outside_id]
        key = (
            f"net:{outside.id}" if outside.kind in NET_KINDS else f"edge:{edge.id}"
        )
        if key not in group_index:
            group_index[key] = len(groups)
            groups.append((outside, []))
        groups[group_index[key]][1].append((inside, inside_pin))
        _unused_pin = outside_pin

    for outside, members in groups:
        # 端口名优先级：外部网络端口标记 → 内部网络名 → 外部网络名 → 器件.引脚
        marker_name, direction = _port_marker(outside)
        absorbed = None  # 组里有「被吸收的内部网络」时，它就是端口在模块内部的落点
        pin_members: list[tuple[Any, str]] = []
        for inside, inside_pin in members:
            if inside.kind in NET_KINDS:
                if absorbed is None:
                    absorbed = inside
                    marker_name = marker_name or _port_marker(inside)[0]
            else:
                pin_members.append((inside, inside_pin))

        if absorbed is not None:
            # 被选中的网络接到外面：网络本身进模块，父场景换成一个同名新网络，
            # 原有外部导线改接到新网络上。
            parent_net_id = _new_id()
            parent_nets.append(
                {
                    "id": parent_net_id,
                    "name": absorbed.name,
                    "kind": absorbed.kind,
                    "params": {
                        key: value
                        for key, value in absorbed.params.items()
                        if key in ("port_name", "port_direction")
                    },
                    "position": {
                        "x": float(absorbed.position["x"]),
                        "y": float(absorbed.position["y"]),
                    },
                }
            )
            rewire[absorbed.id] = parent_net_id
            inner_net = id_map[absorbed.id]
            # 同一外部网络上还接着内部器件引脚：直接并到内部这个网络上。
            for index, (inside, inside_pin) in enumerate(pin_members, start=1):
                inner_edges.append(
                    {
                        "id": _new_id(),
                        "name": f"__port_wire_{index}",
                        "source": id_map[inside.id],
                        "target": inner_net,
                        "kind": "wire",
                        "params": {},
                        "delay": False,
                        "enabled": True,
                        "source_pin": inside_pin,
                        "target_pin": "",
                    }
                )
            port_base = marker_name or absorbed.name or "port"
            add_port(port_base, direction, inner_net, absorbed.id)
            continue

        if not pin_members:
            continue
        if any(inside.kind not in DEVICE_KINDS for inside, _pin in pin_members):
            raise ValidationError(
                "不能封装：有器件引脚直接连到另一个器件（导线必须经过网络节点）"
            )
        # 器件引脚接到外面：内部补一根端口网络挂住该引脚。
        inner_net_id = _new_id()
        inner_nodes.append(
            {
                "id": inner_net_id,
                "name": f"__port_{len(ports) + 1}",
                "kind": "node",
                "params": {},
                "data": {},
                "position": {"x": -320.0, "y": float(-120 + len(ports) * 80)},
            }
        )
        for index, (inside, inside_pin) in enumerate(pin_members, start=1):
            inner_edges.append(
                {
                    "id": _new_id(),
                    "name": f"__port_wire_{len(ports) + 1}_{index}",
                    "source": id_map[inside.id],
                    "target": inner_net_id,
                    "kind": "wire",
                    "params": {},
                    "delay": False,
                    "enabled": True,
                    "source_pin": inside_pin,
                    "target_pin": "",
                }
            )
        device_name, device_pin = pin_members[0][0].name, pin_members[0][1]
        port_base = marker_name or outside.name or (
            f"{device_name}.{device_pin}" if device_pin else device_name
        )
        add_port(port_base, direction, inner_net_id, outside.id)

    # 纯内部、但被标记成端口的网络：同样导出成端口（父场景留一个同名网络 +
    # 一根到模块引脚的导线），这样封装后还能在模块外面探测/改名/改方向。
    ported_inner = {port.net for port in ports}
    for record in nets:
        if record.id in rewire:
            continue
        marker_name, direction = _port_marker(record)
        if not marker_name:
            continue
        inner_net = id_map[record.id]
        if inner_net in ported_inner:
            continue
        parent_net_id = _new_id()
        parent_nets.append(
            {
                "id": parent_net_id,
                "name": record.name,
                "kind": record.kind,
                "params": {
                    key: value
                    for key, value in record.params.items()
                    if key in ("port_name", "port_direction")
                },
                "position": {
                    "x": float(record.position["x"]),
                    "y": float(record.position["y"]),
                },
            }
        )
        # 占位 id → 自身：后面统一换成 add_node 生成的真实 id
        rewire[parent_net_id] = parent_net_id
        add_port(marker_name, direction, inner_net, parent_net_id)
        ported_inner.add(inner_net)

    if not ports:
        raise ValidationError(
            "选中的电路没有任何跨边界连接，封装出来的模块没有端口；"
            "请把与外部连接的导线一起选进来，或先给网络加端口标记"
        )
    if len(ports) > MAX_BLOCK_PORTS:
        raise LimitError(f"模块端口不能超过 {MAX_BLOCK_PORTS} 个")

    new_node_count = len(scene.nodes) - len(selected) + len(parent_nets) + 1
    if new_node_count > 10000:  # 场景上限由 Scene 自己兜底，这里只防明显失控
        raise LimitError("封装后节点数过多")
    block_name = check_name(name, "模块名称")
    block = BlockDef(
        id=_new_id(),
        name=block_name,
        mode="circuit",
        description=description or f"封装自 {len(devices)} 个器件（电路）",
        nodes=inner_nodes,
        edges=inner_edges,
        ports=ports,
        model=model if model in ("behavioral", "structural") else "structural",
    )
    from .blocklib import validate_block_structure

    validate_block_structure(block)
    scene.blocks.add(block)

    # ---- 父场景改写 -----------------------------------------------------
    # 内部导线与"器件引脚跨界"的导线删除；"网络跨界"的导线保留，稍后改接到
    # 父场景新建的同名网络上（否则外部器件的接线会一起消失）。
    absorbed = {
        edge.id for edge in boundary_wires
        if scene.nodes[edge.source if edge.source in selected_set else edge.target].kind
        in NET_KINDS
    }
    remove_edges = {edge.id for edge in internal_wires}
    remove_edges |= {edge.id for edge in internal_elements}
    remove_edges |= {
        edge.id for edge in boundary_wires if edge.id not in absorbed
    }
    for edge_id in remove_edges:
        scene.edges.pop(edge_id, None)
    for node_id in selected:
        scene.nodes.pop(node_id, None)

    module_node = scene.add_node(
        name=scene.next_node_name(f"{block_name}"[:32]),
        kind="module",
        params={
            "block_id": block.id,
            "block_name": block.name,
            "ports": [
                {"name": port.name, "direction": port.direction}
                for port in block.ports
            ],
        },
        position={"x": centroid_x, "y": centroid_y},
    )
    for payload in parent_nets:
        node = scene.add_node(
            name=scene.next_node_name(payload["name"]),
            kind=payload["kind"],
            params=payload["params"],
            position=payload["position"],
        )
        # add_node 会生成新 id，记录真实 id 供导线使用。
        payload["real_id"] = node.id
    real_ids = {payload["id"]: payload["real_id"] for payload in parent_nets}
    for old_id, new_id in rewire.items():
        rewire[old_id] = real_ids[new_id]

    # 外部导线改接到新的网络节点上。
    for edge in list(scene.edges.values()):
        if edge.kind != "wire":
            continue
        touched = False
        if edge.source in rewire:
            edge.source = rewire[edge.source]
            touched = True
        if edge.target in rewire:
            edge.target = rewire[edge.target]
            touched = True
        if touched:
            scene._touch()

    for external_net, port_name in parent_wires:
        real = rewire.get(external_net, external_net)
        scene.add_edge(
            source=real,
            target=module_node.id,
            kind="wire",
            name=scene.next_edge_name(f"w_{port_name}"[:32]),
            params={},
            source_pin="",
            target_pin=port_name,
            layout=_wire_layout(scene, real, module_node.id),
        )
    scene._touch()
    return block


def instantiate_circuit_block(
    scene: "Scene",
    block: BlockDef,
    *,
    position: dict[str, float] | None = None,
    name_prefix: str | None = None,
) -> dict[str, Any]:
    """在电路场景里放一个模块节点（引脚 = 端口，用户自行接线）。"""
    if block.mode != "circuit":
        raise ValidationError("这不是电路模块")
    if scene.blocks.get(block.id) is None:
        scene.blocks.add(copy.deepcopy(block))
    center = position or {"x": 0.0, "y": 0.0}
    prefix = check_name(name_prefix or block.name, "实例名称")
    node = scene.add_node(
        name=scene.next_node_name(prefix[:32]),
        kind="module",
        params={
            "block_id": block.id,
            "block_name": block.name,
            "ports": [
                {"name": port.name, "direction": port.direction}
                for port in block.ports
            ],
        },
        position=center,
    )
    return {
        "module_node": node.id,
        "block_node": node.id,
        "ports": [port.to_payload() for port in block.ports],
        "block": block.summary(),
    }


class _LightNode:
    """展平时用的轻量节点记录（字段与 ``NodeRecord`` 一致的部分）。"""

    __slots__ = ("id", "name", "kind", "params", "state", "position", "enabled")

    def __init__(self, payload: dict[str, Any], node_id: str) -> None:
        self.id = node_id
        self.name = str(payload.get("name") or node_id)[:32]
        self.kind = str(payload.get("kind") or "")
        self.params = copy.deepcopy(payload.get("params") or {})
        self.state = copy.deepcopy(payload.get("state") or {})
        self.position = copy.deepcopy(payload.get("position") or {"x": 0.0, "y": 0.0})
        self.enabled = bool(payload.get("enabled", True))


class _LightEdge:
    """展平时用的轻量导线记录。"""

    __slots__ = (
        "id", "name", "source", "target", "kind", "params", "state",
        "delay", "enabled", "source_pin", "target_pin",
    )

    def __init__(self, payload: dict[str, Any], edge_id: str, source: str, target: str) -> None:
        self.id = edge_id
        self.name = str(payload.get("name") or edge_id)[:32]
        self.source = source
        self.target = target
        self.kind = str(payload.get("kind") or "wire")
        self.params = copy.deepcopy(payload.get("params") or {})
        self.state = copy.deepcopy(payload.get("state") or {})
        self.delay = bool(payload.get("delay", False))
        self.enabled = bool(payload.get("enabled", True))
        self.source_pin = str(payload.get("source_pin") or "")
        self.target_pin = str(payload.get("target_pin") or "")


def _pinmap(nodes: dict[str, Any], edges: Iterable[Any], module_id: str) -> dict[str, str]:
    """某个模块实例「端口名 → 它接到的网络节点 id」。"""
    result: dict[str, str] = {}
    for edge in edges:
        if not getattr(edge, "enabled", True) or getattr(edge, "kind", "") != "wire":
            continue
        if edge.target == module_id and edge.target_pin:
            result[edge.target_pin] = edge.source
        elif edge.source == module_id and edge.source_pin:
            result[edge.source_pin] = edge.target
    return result


def _expand_block(
    scene: "Scene",
    block: BlockDef,
    prefix: str,
    depth: int,
    merges: list[tuple[str, str]],
    extra_nodes: dict[str, Any],
    extra_edges: list[Any],
) -> None:
    from .blocks import MAX_BLOCK_DEPTH
    from .limits import ComputeError

    if depth > MAX_BLOCK_DEPTH:
        raise ComputeError(f"模块嵌套超过 {MAX_BLOCK_DEPTH} 层：{block.name!r}")
    nodes: dict[str, Any] = {}
    for payload in block.nodes:
        record = _LightNode(payload, prefix + str(payload.get("id")))
        nodes[record.id] = record
    edges: list[Any] = []
    for payload in block.edges:
        source = prefix + str(payload.get("source"))
        target = prefix + str(payload.get("target"))
        edges.append(_LightEdge(payload, prefix + str(payload.get("id")), source, target))

    for record in list(nodes.values()):
        if record.kind != "module":
            continue
        child = scene.blocks.get(str(record.params.get("block_id") or ""))
        if child is None or child.mode != "circuit":
            raise ComputeError(
                f"模块 {record.name!r} 引用的电路模块定义不存在："
                f"{record.params.get('block_id')}"
            )
        pins = _pinmap(nodes, edges, record.id)
        child_prefix = f"{record.id}/"
        for port in child.circuit_ports:
            external = pins.get(port.name)
            if not external:
                # 没接线的端口先悬空，校验入口会给出"未接端口"警告。
                continue
            merges.append((external, child_prefix + port.net))
        _expand_block(
            scene, child, child_prefix, depth + 1, merges, extra_nodes, extra_edges
        )
        nodes.pop(record.id, None)
        edges = [item for item in edges if item.source != record.id and item.target != record.id]

    extra_nodes.update(nodes)
    extra_edges.extend(edges)


def flatten_circuit(scene: "Scene") -> tuple[dict[str, Any], list[Any], list[tuple[str, str]]]:
    """电气直连展开（R24/D51）：把电路模块实例摊平成父场景可求解的记录。

    返回 ``(额外节点, 额外导线, 需合并的网络对)``；模块引脚与内部端口网络合并后
    内外就是同一个 MNA 节点，因此封装前后节点电压逐点相等。
    """
    from .limits import ComputeError

    extra_nodes: dict[str, Any] = {}
    extra_edges: list[Any] = []
    merges: list[tuple[str, str]] = []
    for record in list(scene.nodes.values()):
        if record.kind != "module":
            continue
        block = scene.blocks.get(str(record.params.get("block_id") or ""))
        if block is None or block.mode != "circuit":
            raise ComputeError(
                f"模块节点 {record.name!r} 引用的电路模块定义不存在："
                f"{record.params.get('block_id')}"
            )
        pins = module_net_map(scene, record.id)
        block_prefix = f"{record.id}/"
        for port in block.circuit_ports:
            external = pins.get(port.name)
            if not external:
                continue  # 悬空端口：校验阶段给警告，求解阶段按悬空网络忽略
            merges.append((external, block_prefix + port.net))
        _expand_block(
            scene, block, block_prefix, 1, merges, extra_nodes, extra_edges
        )
    return extra_nodes, extra_edges, merges


def module_net_map(scene: "Scene", node_id: str) -> dict[str, str]:
    """模块节点上「端口名 → 外部网络节点 id」（按导线绑定推导）。"""
    record = scene.nodes.get(node_id)
    if record is None or record.kind != "module":
        return {}
    result: dict[str, str] = {}
    for edge in scene.edges.values():
        if not edge.enabled or edge.kind != "wire":
            continue
        if edge.target == node_id and edge.target_pin:
            result[edge.target_pin] = edge.source
        elif edge.source == node_id and edge.source_pin:
            result[edge.source_pin] = edge.target
    return result


__all__ = [
    "PORT_DIRECTIONS",
    "flatten_circuit",
    "unwired_ports",
    "encapsulate_circuit",
    "instantiate_circuit_block",
    "module_net_map",
    "pin_names",
]


def unwired_ports(scene: "Scene") -> list[str]:
    """所有模块实例中还没接线的端口，用于校验警告。"""
    missing: list[str] = []
    for record in scene.nodes.values():
        if record.kind != "module":
            continue
        block = scene.blocks.get(str(record.params.get("block_id") or ""))
        if block is None:
            missing.append(f"{record.name}: 引用的模块定义不存在")
            continue
        pins = module_net_map(scene, record.id)
        for port in block.circuit_ports:
            if not pins.get(port.name):
                missing.append(f"{record.name}.{port.name}: 端口未接线")
    return missing
