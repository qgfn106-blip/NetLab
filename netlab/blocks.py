"""功能块（模块）系统：把一张网络封装成带输入/输出端口的功能节点。

模型
----
``BlockDef`` 是可复用定义：内部节点/连接 + ``module_input`` / ``module_output``
接口节点 + 端口描述。``BlockStore`` 保存定义并检测嵌套引用环。

实例化时在父场景创建：

* 一个 ``kind="block"`` 的功能节点；
* 每个端口一个 ``kind="module_input"`` / ``"module_output"`` 的端口节点；
* 块节点的 ``params.port_nodes`` 记录端口名 → 父场景端口节点 id；
* 引擎在块节点前后插入隐藏的 feed/emit 连接，保证拓扑顺序。

执行
----
父场景中输入端口节点先收到外部数据；块节点的 handler 把端口节点的数值注入
内部 ``module_input`` 接口节点，推进内部 ``Network``，再把 ``module_output``
的数据写回块节点；隐藏 emit 边复制到输出端口节点。每个实例拥有独立的
内部场景与 state，互不共享。
"""

from __future__ import annotations

import copy
import math
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Iterable, TYPE_CHECKING

from .computes import prepare_compute
from .limits import (
    MAX_EDGES,
    MAX_NODES,
    ComputeError,
    ConflictError,
    LimitError,
    NotFoundError,
    ValidationError,
    check_id,
    check_name,
)
from .methods import prepare_method
from .params import ParamSpec

if TYPE_CHECKING:  # pragma: no cover
    from .scene import Scene

MAX_BLOCK_DEPTH = 6
MAX_BLOCK_NODES = 200
MAX_BLOCK_EDGES = 600
MAX_BLOCK_PORTS = 32
MAX_BLOCK_DEFS = 128


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _port_fields(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    if isinstance(value, (list, tuple)):
        result = []
        for item in value:
            text = str(item).strip()
            if text and text not in result:
                result.append(text)
        return result
    raise ValidationError("端口 fields 必须是字符串或字符串数组")


@dataclass
class PortDef:
    name: str
    direction: str
    fields: list[str] = field(default_factory=list)
    dtype: str = "signal"
    description: str = ""
    default: float = 0.0

    def to_payload(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "direction": self.direction,
            "fields": list(self.fields),
            "dtype": self.dtype,
            "description": self.description,
            "default": float(self.default),
        }

    @classmethod
    def from_payload(cls, raw: Any) -> "PortDef":
        if not isinstance(raw, dict):
            raise ValidationError("端口必须是对象")
        name = check_name(raw.get("name"), "端口名称")
        direction = str(raw.get("direction", "input"))
        if direction not in ("input", "output"):
            raise ValidationError("端口方向必须是 input 或 output")
        dtype = str(raw.get("dtype", "signal"))
        if dtype not in ("signal", "vector", "bit", "any"):
            raise ValidationError("端口 dtype 必须是 signal/vector/bit/any")
        fields = _port_fields(raw.get("fields"))
        if not fields:
            fields = ["x", "y"] if dtype == "vector" else ["voltage"]
        return cls(
            name=name,
            direction=direction,
            fields=fields,
            dtype=dtype,
            description=str(raw.get("description", ""))[:400],
            default=float(raw.get("default", 0.0) or 0.0),
        )


@dataclass
class BlockDef:
    id: str
    name: str
    mode: str
    description: str
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    ports: list[PortDef]
    version: int = 1
    #: 双模型（R05/D9）：默认 behavioral（不展开、保性能）；structural 才可看/改内部。
    model: str = "behavioral"
    builtin: bool = False
    created: str = field(default_factory=_now)
    modified: str = field(default_factory=_now)
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.id = check_id(self.id, "功能块 id")
        self.name = check_name(self.name, "功能块名称")
        if self.mode not in ("signal", "vector", "circuit"):
            raise ValidationError("功能块 mode 必须是 signal/vector/circuit")
        if self.model not in ("behavioral", "structural"):
            raise ValidationError("功能块 model 必须是 behavioral 或 structural")
        if not isinstance(self.nodes, list) or not isinstance(self.edges, list):
            raise ValidationError("功能块必须包含 nodes/edges 数组")
        if len(self.nodes) > MAX_BLOCK_NODES:
            raise LimitError(f"功能块节点不能超过 {MAX_BLOCK_NODES}")
        if len(self.edges) > MAX_BLOCK_EDGES:
            raise LimitError(f"功能块连接不能超过 {MAX_BLOCK_EDGES}")
        if len(self.ports) > MAX_BLOCK_PORTS:
            raise LimitError(f"功能块端口不能超过 {MAX_BLOCK_PORTS}")
        names = [port.name for port in self.ports]
        if len(set(names)) != len(names):
            raise ValidationError("功能块端口名称不能重复")
        directions = {port.direction for port in self.ports}
        if directions - {"input", "output"}:
            raise ValidationError("端口方向不合法")

    @property
    def input_ports(self) -> list[PortDef]:
        return [port for port in self.ports if port.direction == "input"]

    @property
    def output_ports(self) -> list[PortDef]:
        return [port for port in self.ports if port.direction == "output"]

    def to_payload(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "mode": self.mode,
            "description": self.description,
            "version": int(self.version),
            "model": self.model,
            "builtin": bool(self.builtin),
            "created": self.created,
            "modified": self.modified,
            "nodes": copy.deepcopy(self.nodes),
            "edges": copy.deepcopy(self.edges),
            "ports": [port.to_payload() for port in self.ports],
            "metadata": copy.deepcopy(self.metadata),
        }

    def summary(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "mode": self.mode,
            "description": self.description,
            "version": int(self.version),
            "model": self.model,
            "builtin": bool(self.builtin),
            "node_count": len(self.nodes),
            "edge_count": len(self.edges),
            "inputs": [port.to_payload() for port in self.input_ports],
            "outputs": [port.to_payload() for port in self.output_ports],
            "metadata": copy.deepcopy(self.metadata),
        }

    @classmethod
    def from_payload(cls, raw: Any) -> "BlockDef":
        if not isinstance(raw, dict):
            raise ValidationError("功能块定义必须是对象")
        ports = [PortDef.from_payload(item) for item in raw.get("ports") or []]
        return cls(
            id=str(raw.get("id") or _new_id()),
            name=str(raw.get("name") or "功能块"),
            mode=str(raw.get("mode") or "signal"),
            description=str(raw.get("description") or "")[:400],
            nodes=copy.deepcopy(raw.get("nodes") or []),
            edges=copy.deepcopy(raw.get("edges") or []),
            ports=ports,
            version=int(raw.get("version") or 1),
            model=str(raw.get("model") or "behavioral"),
            builtin=bool(raw.get("builtin", False)),
            created=str(raw.get("created") or _now()),
            modified=str(raw.get("modified") or _now()),
            metadata=copy.deepcopy(raw.get("metadata") or {}),
        )


def derive_ports(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> list[PortDef]:
    """从内部接口节点推导端口（封装时使用）。"""
    del edges
    ports: list[PortDef] = []
    for node in nodes:
        kind = node.get("kind")
        if kind not in ("module_input", "module_output"):
            continue
        params = node.get("params") or {}
        role = str(params.get("role", "interface"))
        if role != "interface":
            continue
        name = str(params.get("port_name") or node.get("name") or "port")
        direction = "input" if kind == "module_input" else "output"
        fields = _port_fields(params.get("fields"))
        if not fields:
            fields = ["voltage"]
        ports.append(
            PortDef(
                name=name,
                direction=direction,
                fields=fields,
                dtype=str(params.get("dtype", "signal")),
                description=str(params.get("description", "")),
                default=float(params.get("default", 0.0) or 0.0),
            )
        )
    return ports


class BlockStore:
    def __init__(self) -> None:
        self.defs: dict[str, BlockDef] = {}

    def add(self, block: BlockDef, *, replace: bool = False) -> BlockDef:
        if block.id in self.defs and not replace:
            raise ConflictError(f"功能块 id {block.id!r} 已存在")
        if len(self.defs) >= MAX_BLOCK_DEFS and block.id not in self.defs:
            raise LimitError(f"功能块数量不能超过 {MAX_BLOCK_DEFS}")
        # 禁止直接自引用；更深的嵌套环在装配时检测。
        for other in block.nodes:
            if other.get("kind") == "block":
                params = other.get("params") or {}
                if str(params.get("block_id")) == block.id:
                    raise ValidationError("功能块不能直接包含自身")
        self.defs[block.id] = block
        return block

    def get(self, block_id: str) -> BlockDef | None:
        return self.defs.get(block_id)

    def require(self, block_id: str) -> BlockDef:
        block = self.get(block_id)
        if block is None:
            raise NotFoundError(f"功能块 {block_id!r} 不存在")
        return block

    def remove(self, block_id: str) -> BlockDef:
        block = self.require(block_id)
        if block.builtin:
            raise ValidationError("内置功能块不能删除")
        del self.defs[block_id]
        return block

    def export_user(self) -> list[dict[str, Any]]:
        return [
            block.to_payload()
            for block in self.defs.values()
            if not block.builtin
        ]

    def all_summaries(self) -> list[dict[str, Any]]:
        return [block.summary() for block in self.defs.values()]

    def check_cycles(self) -> None:
        visiting: set[str] = set()
        done: set[str] = set()

        def visit(block_id: str, path: list[str]) -> None:
            if block_id in done:
                return
            if block_id in visiting:
                chain = " → ".join(path + [block_id])
                raise ValidationError(f"功能块存在循环引用：{chain}")
            block = self.defs.get(block_id)
            if block is None:
                return
            visiting.add(block_id)
            for node in block.nodes:
                if node.get("kind") == "block":
                    child = str((node.get("params") or {}).get("block_id") or "")
                    if child:
                        visit(child, path + [block_id])
            visiting.discard(block_id)
            done.add(block_id)

        for block_id in self.defs:
            visit(block_id, [])

    def load_payloads(self, items: Any, *, replace: bool = False) -> None:
        if items is None:
            return
        if not isinstance(items, list):
            raise ValidationError("blocks 必须是数组")
        for item in items:
            block = BlockDef.from_payload(item)
            self.add(block, replace=replace)
        self.check_cycles()


class BlockRuntime:
    """一个功能块实例的内部场景；每个实例独立 state。"""

    def __init__(
        self,
        block: BlockDef,
        store: BlockStore,
        *,
        depth: int = 0,
    ) -> None:
        if depth > MAX_BLOCK_DEPTH:
            raise ComputeError(
                f"功能块嵌套超过 {MAX_BLOCK_DEPTH} 层，请检查模块引用"
            )
        self.block = block
        self.store = store
        self.depth = depth
        self._scene: Any = None
        self._input_nodes: dict[str, str] = {}
        self._output_nodes: dict[str, tuple[str, list[str]]] = {}
        self._build()

    def _build(self) -> None:
        from .scene import Scene

        scene = Scene(self.block.mode)
        scene.blocks = self.store
        scene.block_depth = self.depth + 1
        scene.load_payload(
            {
                "mode": self.block.mode,
                "nodes": copy.deepcopy(self.block.nodes),
                "edges": copy.deepcopy(self.block.edges),
            }
        )
        scene.ensure_engine()
        self._scene = scene
        for node in self.block.nodes:
            kind = node.get("kind")
            params = node.get("params") or {}
            role = str(params.get("role", "interface"))
            if role != "interface" or kind not in ("module_input", "module_output"):
                continue
            name = str(node.get("name"))
            port_name = str(params.get("port_name") or name)
            if kind == "module_input":
                self._input_nodes[port_name] = name
            else:
                fields = _port_fields(params.get("fields")) or ["voltage"]
                self._output_nodes[port_name] = (name, fields)
        missing = [
            port.name
            for port in self.block.ports
            if port.direction == "input" and port.name not in self._input_nodes
        ] + [
            port.name
            for port in self.block.ports
            if port.direction == "output" and port.name not in self._output_nodes
        ]
        if missing:
            raise ValidationError(
                "功能块端口没有对应的内部接口节点："
                + "、".join(sorted(set(missing)))
            )

    @property
    def scene(self) -> "Scene":
        return self._scene

    def step(self, dt: float, inputs: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
        """推进内部网络一拍；返回 ``{端口名: {字段: 值}}``。

        每个端口单独返回，避免不同端口同名字段互相覆盖。所有跨实例数据
        都在这里做副本与标量过滤，内部 state 不会被父场景引用。
        """
        inner = self._scene
        # 1) 把父场景输入端口的数据注入内部接口节点（副本，避免跨实例共享）。
        #    未接线的输入按端口默认值补 0：实例刚拖入画布时不应让整网计算失败。
        defaults = {port.name: port for port in self.block.ports if port.direction == "input"}
        for port_name, node_name in self._input_nodes.items():
            record = next(
                (item for item in inner.nodes.values() if item.name == node_name),
                None,
            )
            if record is None:
                continue
            payload = dict(inputs.get(port_name) or {})
            port = defaults.get(port_name)
            if port is not None:
                for field in port.fields or []:
                    if field not in payload:
                        payload[field] = float(port.default or 0.0)
            for key, value in payload.items():
                if isinstance(value, (int, float, bool, str)) and not isinstance(value, complex):
                    record.data[key] = copy.deepcopy(value)
        # 2) 推进内部网络。
        inner.step(dt)
        # 3) 读取输出接口节点；只复制 JSON 标量，避免嵌套对象跨实例泄漏。
        outputs: dict[str, dict[str, Any]] = {}
        for port_name, (node_name, fields) in self._output_nodes.items():
            record = next(
                (item for item in inner.nodes.values() if item.name == node_name),
                None,
            )
            if record is None:
                continue
            payload: dict[str, Any] = {}
            for key in fields:
                value = record.data.get(key)
                if isinstance(value, bool) or (
                    isinstance(value, (int, float)) and math.isfinite(float(value))
                ):
                    payload[key] = float(value) if not isinstance(value, bool) else value
                elif isinstance(value, str):
                    payload[key] = value
            outputs[port_name] = payload
        return outputs

    def reset(self) -> None:
        self._scene.reset()

    def capture_checkpoint(self) -> dict[str, Any]:
        """记录内部场景状态；父场景整步回滚/超时恢复时使用。"""
        return {"scene": self._scene.capture_checkpoint()}

    def restore_checkpoint(self, checkpoint: dict[str, Any] | None) -> None:
        if not checkpoint:
            return
        self._scene.restore_checkpoint(checkpoint.get("scene"))

    def stats(self) -> dict[str, Any]:
        return {
            "block": self.block.id,
            "mode": self.block.mode,
            "nodes": len(self.block.nodes),
            "edges": len(self.block.edges),
            "depth": self.depth,
            "time": getattr(self._scene, "engine", None).network.time
            if getattr(self._scene, "_engine", None) is not None
            and hasattr(getattr(self._scene, "_engine"), "network")
            else 0.0,
        }


# ---- 封装与实例化 ----------------------------------------------------------
def _find_record(scene: "Scene", node_id: str):
    record = scene.nodes.get(node_id)
    if record is None:
        raise NotFoundError(f"节点 {node_id!r} 不存在")
    return record


def _method_output_field(kind: str, params: dict[str, Any] | None) -> list[str]:
    try:
        spec, _params, _method = prepare_method(kind, params or {})
    except Exception:
        return ["voltage"]
    outputs = list(spec.outputs or ())
    if not outputs:
        return ["voltage"]
    resolved: list[str] = []
    for item in outputs:
        if item in (params or {}):
            value = (params or {})[item]
            if isinstance(value, str):
                resolved.append(value)
                continue
        resolved.append(item)
    return resolved or ["voltage"]


def _node_port_fields(scene: "Scene", node_id: str, *, direction: str) -> list[str]:
    fields: list[str] = []
    for edge in scene.edges.values():
        if direction == "input" and edge.target == node_id and edge.enabled:
            fields.extend(_method_output_field(edge.kind, edge.params))
        if direction == "output" and edge.source == node_id and edge.enabled:
            # 输出端口需要源节点可供传递的字段；用方法输入字段近似。
            spec_params = edge.params or {}
            key = spec_params.get("input_key") or spec_params.get("input_x")
            if isinstance(key, str):
                fields.append(key)
    if not fields:
        fields = ["x", "y"] if scene.mode == "vector" else ["voltage"]
    result: list[str] = []
    for item in fields:
        if item not in result:
            result.append(item)
    return result[:8]


def build_block_from_scene(
    scene: "Scene",
    *,
    name: str,
    description: str = "",
    model: str = "behavioral",
) -> BlockDef:
    """把当前场景整体打包成新模块定义（不改动场景，用于「另存为副本」，D10）。"""
    inner_nodes: list[dict[str, Any]] = []
    for record in scene.nodes.values():
        payload = record.snapshot()
        payload.pop("state", None)
        payload.pop("inputs", None)
        inner_nodes.append(payload)
    inner_edges: list[dict[str, Any]] = []
    for edge in scene.edges.values():
        payload = edge.snapshot()
        payload.pop("state", None)
        inner_edges.append(payload)
    ports = derive_ports(inner_nodes, inner_edges)
    return BlockDef(
        id=_new_id(),
        name=name,
        mode=scene.mode,
        description=description or f"另存自场景 {scene.mode}（{len(inner_nodes)} 节点）",
        nodes=inner_nodes,
        edges=inner_edges,
        ports=ports,
        model=model,
        version=1,
    )


def encapsulate_nodes(
    scene: "Scene",
    node_ids: Iterable[str],
    *,
    name: str,
    description: str = "",
    include_position: bool = True,
    model: str = "behavioral",
) -> BlockDef:
    """把选中的节点/内部连接封装为 ``BlockDef``，并在父场景替换为功能节点。"""
    from .scene import Scene  # 局部导入避免循环

    selected = [check_id(item, "节点 id") for item in node_ids]
    if not selected:
        raise ValidationError("请选择至少一个节点")
    selected_set = set(selected)
    if len(selected_set) != len(selected):
        raise ValidationError("选中的节点 id 不能重复")
    if len(selected) > MAX_BLOCK_NODES:
        raise LimitError(f"一次最多封装 {MAX_BLOCK_NODES} 个节点")
    for node_id in selected:
        _find_record(scene, node_id)

    selected_nodes = [scene.nodes[node_id] for node_id in selected]
    # 选中集合里若包含功能块节点，它的端口节点也必须一起被选中，
    # 否则封装后的块节点会指向已被删除的父场景端口节点。
    for record in selected_nodes:
        if record.kind != "block":
            continue
        for key in ("input_nodes", "output_nodes"):
            mapping = record.params.get(key) or {}
            if not isinstance(mapping, dict):
                continue
            outside = [str(pid) for pid in mapping.values() if str(pid) not in selected_set]
            if outside:
                raise ValidationError(
                    f"封装包含功能块节点 {record.name!r} 时，"
                    "必须同时选中它的端口节点"
                )
    boundary_in = [
        edge for edge in scene.edges.values()
        if edge.target in selected_set and edge.source not in selected_set and edge.enabled
    ]
    boundary_out = [
        edge for edge in scene.edges.values()
        if edge.source in selected_set and edge.target not in selected_set and edge.enabled
    ]
    if len(boundary_in) + len(boundary_out) > MAX_BLOCK_PORTS:
        raise LimitError(f"封装后的端口不能超过 {MAX_BLOCK_PORTS} 个")

    centroid_x = sum(node.position["x"] for node in selected_nodes) / len(selected_nodes)
    centroid_y = sum(node.position["y"] for node in selected_nodes) / len(selected_nodes)

    inner_nodes: list[dict[str, Any]] = []
    for record in selected_nodes:
        payload = record.snapshot()
        payload.pop("state", None)
        payload.pop("inputs", None)
        if include_position:
            payload["position"] = {
                "x": float(record.position["x"] - centroid_x),
                "y": float(record.position["y"] - centroid_y),
            }
        else:
            payload["position"] = {"x": 0.0, "y": 0.0}
        inner_nodes.append(payload)

    inner_edges: list[dict[str, Any]] = []
    internal_edges = [
        edge for edge in scene.edges.values()
        if edge.source in selected_set and edge.target in selected_set and edge.enabled
    ]
    for edge in internal_edges:
        payload = edge.snapshot()
        payload.pop("state", None)
        inner_edges.append(payload)

    ports: list[PortDef] = []
    interface_nodes: list[dict[str, Any]] = []
    used_names = {str(node.get("name")) for node in inner_nodes}
    used_ports: set[str] = set()

    def unique_port(base: str) -> str:
        candidate = base
        index = 2
        while candidate in used_ports:
            candidate = f"{base}{index}"
            index += 1
        used_ports.add(candidate)
        return candidate

    # 入边：父边改为外部源 → 输入端口（pass），内部接口 → 原目标（原方法）。
    for index, edge in enumerate(boundary_in, start=1):
        port_name = unique_port(f"in_{edge.name}"[:32])
        interface_name = f"__in_{index}_{edge.name}"[:32]
        while interface_name in used_names:
            interface_name = f"__in_{index}_{interface_name}"[:32]
        used_names.add(interface_name)
        interface_id = _new_id()
        fields = _method_output_field(edge.kind, edge.params)
        interface_nodes.append(
            {
                "id": interface_id,
                "name": interface_name,
                "kind": "module_input",
                "params": {
                    "role": "interface",
                    "port_name": port_name,
                    "fields": fields,
                    "dtype": "vector" if scene.mode == "vector" else "signal",
                    "default": 0.0,
                },
                "data": {},
                "position": {"x": -280.0, "y": float(index * 90)},
            }
        )
        inner_edges.append(
            {
                "id": _new_id(),
                "name": edge.name,
                "source": interface_id,
                "target": edge.target,
                "kind": edge.kind,
                "params": copy.deepcopy(edge.params),
                "delay": bool(edge.delay),
                "enabled": True,
            }
        )
        ports.append(
            PortDef(
                name=port_name,
                direction="input",
                fields=fields,
                dtype="vector" if scene.mode == "vector" else "signal",
            )
        )

    # 出边：内部源 → 输出接口（pass），父边改为输出端口 → 外部目标（原方法）。
    for index, edge in enumerate(boundary_out, start=1):
        port_name = unique_port(f"out_{edge.name}"[:32])
        interface_name = f"__out_{index}_{edge.name}"[:32]
        while interface_name in used_names:
            interface_name = f"__out_{index}_{interface_name}"[:32]
        used_names.add(interface_name)
        interface_id = _new_id()
        fields = _method_output_field(edge.kind, edge.params)
        interface_nodes.append(
            {
                "id": interface_id,
                "name": interface_name,
                "kind": "module_output",
                "params": {
                    "role": "interface",
                    "port_name": port_name,
                    "fields": fields,
                    "dtype": "vector" if scene.mode == "vector" else "signal",
                    "default": 0.0,
                },
                "data": {},
                "position": {"x": 280.0, "y": float(index * 90)},
            }
        )
        inner_edges.append(
            {
                "id": _new_id(),
                "name": f"__pass_{index}_{edge.name}"[:32],
                "source": edge.source,
                "target": interface_id,
                "kind": "pass",
                "params": {},
                "delay": False,
                "enabled": True,
            }
        )
        ports.append(
            PortDef(
                name=port_name,
                direction="output",
                fields=fields,
                dtype="vector" if scene.mode == "vector" else "signal",
            )
        )

    inner_nodes.extend(interface_nodes)
    # 先在内存里完成上限核算，再动父场景：任何超限都在修改前报错，
    # 避免封装中途失败留下"节点已删、功能块未建"的半成品状态。
    new_node_count = len(scene.nodes) - len(selected) + len(ports) + 1
    if new_node_count > MAX_NODES:
        raise LimitError(f"封装后节点数会超过上限 {MAX_NODES}")
    remaining_edges = len(scene.edges) - len(internal_edges)
    if remaining_edges > MAX_EDGES:
        raise LimitError(f"封装后连接数会超过上限 {MAX_EDGES}")
    block_id = _new_id()
    block = BlockDef(
        id=block_id,
        name=name,
        mode=scene.mode,
        description=description or f"封装自 {len(selected)} 个节点",
        nodes=inner_nodes,
        edges=inner_edges,
        ports=ports,
        model=model,
    )
    scene.blocks.add(block)

    # 记录父场景需要删除的边界边与内部边。
    remove_edge_ids = {edge.id for edge in scene.edges.values() if edge.source in selected_set or edge.target in selected_set}
    # 创建父场景端口节点与块节点。
    input_nodes: dict[str, str] = {}
    output_nodes: dict[str, str] = {}
    block_node = scene.add_node(
        name=scene.next_node_name(f"{name}_block"[:32]),
        kind="block",
        params={"block_id": block_id, "block_name": name},
        position={"x": centroid_x, "y": centroid_y},
    )
    for index, port in enumerate(block.input_ports, start=1):
        node = scene.add_node(
            name=scene.next_node_name(f"{port.name}"[:32]),
            kind="module_input",
            params={
                "role": "port",
                "port_name": port.name,
                "block_id": block_id,
                "fields": port.fields,
                "dtype": port.dtype,
                "default": port.default,
            },
            position={
                "x": centroid_x - 230.0,
                "y": centroid_y + (index - (len(block.input_ports) + 1) / 2) * 92,
            },
        )
        input_nodes[port.name] = node.id
    for index, port in enumerate(block.output_ports, start=1):
        node = scene.add_node(
            name=scene.next_node_name(f"{port.name}"[:32]),
            kind="module_output",
            params={
                "role": "port",
                "port_name": port.name,
                "block_id": block_id,
                "fields": port.fields,
                "dtype": port.dtype,
                "default": port.default,
            },
            position={
                "x": centroid_x + 230.0,
                "y": centroid_y + (index - (len(block.output_ports) + 1) / 2) * 92,
            },
        )
        output_nodes[port.name] = node.id
    scene.update_node(
        block_node.id,
        {
            "params": {
                "block_id": block_id,
                "block_name": name,
                "input_nodes": input_nodes,
                "output_nodes": output_nodes,
            }
        },
    )

    # 删除被封装节点与所有跨界/内部边。
    for edge_id in remove_edge_ids:
        scene.edges.pop(edge_id, None)
    for node_id in selected:
        scene.nodes.pop(node_id, None)

    # 父边：入边与出边。
    for index, edge in enumerate(boundary_in, start=1):
        port_name = block.input_ports[index - 1].name
        port_node_id = input_nodes[port_name]
        scene.add_edge(
            source=edge.source,
            target=port_node_id,
            kind="pass",
            name=scene.next_edge_name(f"feed_{edge.name}"[:32]),
            params={},
            delay=False,
            enabled=True,
        )
    for index, edge in enumerate(boundary_out, start=1):
        port_name = block.output_ports[index - 1].name
        port_node_id = output_nodes[port_name]
        scene.add_edge(
            source=port_node_id,
            target=edge.target,
            kind=edge.kind,
            name=scene.next_edge_name(edge.name),
            params=copy.deepcopy(edge.params),
            delay=bool(edge.delay),
            enabled=True,
        )
    scene._touch()
    return block


def instantiate_block(
    scene: "Scene",
    block_id: str,
    *,
    position: dict[str, float] | None = None,
    name_prefix: str | None = None,
) -> dict[str, Any]:
    block = scene.blocks.require(block_id)
    center = position or {"x": 0.0, "y": 0.0}
    prefix = check_name(name_prefix or block.name, "实例名称") if name_prefix else block.name
    block_node = scene.add_node(
        name=scene.next_node_name(f"{prefix}_block"[:32]),
        kind="block",
        params={"block_id": block_id, "block_name": block.name},
        position=center,
    )
    input_nodes: dict[str, str] = {}
    output_nodes: dict[str, str] = {}
    for index, port in enumerate(block.input_ports, start=1):
        node = scene.add_node(
            name=scene.next_node_name(f"{block.name}_{port.name}"[:32]),
            kind="module_input",
            params={
                "role": "port",
                "port_name": port.name,
                "block_id": block_id,
                "fields": port.fields,
                "dtype": port.dtype,
                "default": port.default,
            },
            position={
                "x": center["x"] - 230.0,
                "y": center["y"] + (index - (len(block.input_ports) + 1) / 2) * 92,
            },
        )
        input_nodes[port.name] = node.id
    for index, port in enumerate(block.output_ports, start=1):
        node = scene.add_node(
            name=scene.next_node_name(f"{block.name}_{port.name}"[:32]),
            kind="module_output",
            params={
                "role": "port",
                "port_name": port.name,
                "block_id": block_id,
                "fields": port.fields,
                "dtype": port.dtype,
                "default": port.default,
            },
            position={
                "x": center["x"] + 230.0,
                "y": center["y"] + (index - (len(block.output_ports) + 1) / 2) * 92,
            },
        )
        output_nodes[port.name] = node.id
    scene.update_node(
        block_node.id,
        {
            "params": {
                "block_id": block_id,
                "block_name": block.name,
                "input_nodes": input_nodes,
                "output_nodes": output_nodes,
            }
        },
    )
    return {
        "block_node": block_node.id,
        "input_nodes": input_nodes,
        "output_nodes": output_nodes,
        "block": block.summary(),
    }
