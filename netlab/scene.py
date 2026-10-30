"""场景层：把可序列化的节点/连接记录装配成可运行的仿真引擎。

信号模式使用 ``graph.Network``（字典沿有向边传播）；电路模式使用
``nodal.CircuitSolver``（节点电压法）。两种模式对外暴露相同的
``step / reset / probes / stats`` 接口，供仿真循环与 HTTP 层复用。
"""

from __future__ import annotations

import copy
import math
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from .blocks import BlockRuntime, BlockStore
from .computes import compute_catalog, get_compute_spec, prepare_compute
from .graph import Network, Node
from .limits import (
    MAX_EDGES,
    MAX_FIELDS,
    MAX_NAME,
    MAX_NODES,
    ComputeError,
    ConflictError,
    LimitError,
    NotFoundError,
    ValidationError,
    as_float,
    check_id,
    check_name,
    json_safe,
)
from .methods import (
    get_method_spec,
    method_catalog,
    prepare_method,
)
from .nodal import (
    CircuitNode,
    CircuitSolver,
    ELEMENT_SPECS,
    create_element,
    create_element_from_pins,
    element_catalog,
    element_spec,
    integration_methods,
    node_catalog,
)
from .params import validate_params
from .ports import pins_for_device
from .profiling import timed

MODES = ("signal", "circuit", "vector")
MAX_POSITION = 10000.0
ROUTE_MODES = ("auto", "straight", "orthogonal", "manual")
ANCHOR_SIDES = ("auto", "left", "right", "top", "bottom")
MAX_WAYPOINTS = 64
MAX_NODE_SIZE = 200.0
MIN_NODE_SIZE = 24.0


@dataclass
class NodeRecord:
    id: str
    name: str
    kind: str
    params: dict[str, Any] = field(default_factory=dict)
    data: dict[str, Any] = field(default_factory=dict)
    state: dict[str, Any] = field(default_factory=dict)
    inputs: dict[str, dict[str, Any]] = field(default_factory=dict)
    position: dict[str, float] = field(
        default_factory=lambda: {"x": 0.0, "y": 0.0}
    )
    #: 节点尺寸（R09）：``{"w": 直径}``；空字典表示用默认半径。
    size: dict[str, float] = field(default_factory=dict)

    def snapshot(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "params": copy.deepcopy(self.params),
            "data": copy.deepcopy(self.data),
            "state": copy.deepcopy(self.state),
            "inputs": copy.deepcopy(self.inputs),
            "position": dict(self.position),
            "size": dict(self.size),
        }


@dataclass
class EdgeRecord:
    id: str
    name: str
    source: str
    target: str
    kind: str
    params: dict[str, Any] = field(default_factory=dict)
    state: dict[str, Any] = field(default_factory=dict)
    delay: bool = False
    enabled: bool = True
    #: 连线几何（R09/D24）：路由方式、手动拐点（世界坐标）、两端锚点。
    route: str = "auto"
    waypoints: list[dict[str, float]] = field(default_factory=list)
    anchors: dict[str, str] = field(default_factory=dict)
    #: 图纸布局层（R19）：符号位置与旋转（30° 步长）；空=未布局，自动生成。
    layout: dict[str, Any] = field(default_factory=dict)
    #: 导线引脚绑定（R20）：只在 kind=="wire" 时使用；网络节点一侧为空。
    source_pin: str = ""
    target_pin: str = ""
    #: 信号/矢量端口绑定（R20/Q8）：source 输出字段 → target 输入端口。
    source_port: str = ""
    target_port: str = ""

    def snapshot(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "source": self.source,
            "target": self.target,
            "kind": self.kind,
            "source_pin": self.source_pin,
            "target_pin": self.target_pin,
            "source_port": self.source_port,
            "target_port": self.target_port,
            "params": copy.deepcopy(self.params),
            "state": copy.deepcopy(self.state),
            "delay": self.delay,
            "enabled": self.enabled,
            "route": self.route,
            "waypoints": [dict(item) for item in self.waypoints],
            "anchors": dict(self.anchors),
            "layout": dict(self.layout),
        }


# ---- 引擎 ------------------------------------------------------------------
class _Engine:
    def step(self, dt: float) -> None:  # pragma: no cover - 抽象
        raise NotImplementedError

    def reset(self) -> None:  # pragma: no cover - 抽象
        raise NotImplementedError

    def zero_time(self) -> None:  # pragma: no cover - 抽象
        """只把内核时间轴归零，不清除状态（R11）。"""
        raise NotImplementedError

    def probes(self) -> dict[str, float]:  # pragma: no cover - 抽象
        raise NotImplementedError

    def stats(self) -> dict[str, Any]:  # pragma: no cover - 抽象
        raise NotImplementedError


class SignalEngine(_Engine):
    def __init__(self, scene: "Scene") -> None:
        self.network = Network()
        self.node_map: dict[str, Node] = {}
        self.edge_map: dict[str, Any] = {}
        self.scene = scene
        # 功能块实例：每个实例拥有独立的内部场景与 state。
        self.block_runtimes: dict[str, BlockRuntime] = {}
        self.block_buffers: dict[str, dict[str, dict[str, Any]]] = {}
        for record in scene.nodes.values():
            try:
                _spec, params, handler = prepare_compute(record.kind, record.params)
            except Exception as exc:
                raise ComputeError(
                    f"节点 {record.name!r} 的计算方式无法装配：{exc}"
                ) from exc
            node = Node(
                name=record.name,
                data=record.data,
                kind=record.kind,
                params=params,
                state=record.state,
                inputs=record.inputs,
                handler=handler,
                trusted=not record.kind.startswith("user."),
            )
            self.network.add_node(node)
            self.node_map[record.id] = node
        for record in scene.edges.values():
            # R20/Q8：source_port 在装配期改写方法的输入字段（内置方法在工厂里
            # 编译 input_key，运行期再改参数不会生效）。
            edge_params = dict(record.params)
            if record.source_port:
                for key in ("input_key", "input_x", "input_y", "field"):
                    if key in edge_params:
                        edge_params[key] = record.source_port
            try:
                _spec, params, method = prepare_method(record.kind, edge_params)
            except Exception as exc:
                raise ComputeError(
                    f"连接 {record.name!r} 的计算方式无法装配：{exc}"
                ) from exc
            connection = self.network.connect(
                record.name,
                self.node_map[record.source],
                self.node_map[record.target],
                method,
                delay=record.delay,
                enabled=record.enabled,
                kind=record.kind,
                state=record.state,
                params=params,
                source_port=record.source_port,
                target_port=record.target_port,
                _trusted=not record.kind.startswith("user."),
            )
            self.edge_map[record.id] = connection
        self._wire_blocks()

    # ---- 功能块 -----------------------------------------------------------
    @staticmethod
    def _feed_name(node_name: str, port_name: str) -> str:
        return f"__feed.{node_name}.{port_name}"

    @staticmethod
    def _numeric_payload(
        data: dict[str, Any], limit: int = 32
    ) -> dict[str, Any]:
        values: dict[str, Any] = {}
        for key, raw in data.items():
            if len(values) >= limit:
                break
            if isinstance(raw, bool) or not isinstance(raw, (int, float)):
                continue
            number = float(raw)
            if math.isfinite(number):
                values[key] = number
        return values

    def _feed_method(self) -> Any:
        def method(source, target, _params, _state, _dt):
            del target
            return SignalEngine._numeric_payload(source.data)

        return method

    @staticmethod
    def _emit_method(buffer: dict[str, dict[str, Any]], port_name: str) -> Any:
        def method(source, target, _params, _state, _dt):
            del source, target, _params, _state, _dt
            return dict(buffer.get(port_name) or {})

        return method

    def _block_handler(
        self,
        record: Any,
        block: Any,
        runtime: BlockRuntime,
        buffer: dict[str, dict[str, Any]],
    ) -> Any:
        feeds = {
            port.name: self._feed_name(record.name, port.name)
            for port in block.input_ports
        }

        def handler(ctx) -> dict[str, Any]:
            inputs: dict[str, dict[str, Any]] = {}
            for port_name, connection_name in feeds.items():
                payload = ctx.inputs.get(connection_name)
                if payload:
                    inputs[port_name] = payload
            outputs = runtime.step(ctx.dt, inputs)
            for port_name, payload in outputs.items():
                buffer[port_name] = payload
            return {}

        return handler

    def _wire_blocks(self) -> None:
        """为 ``kind="block"`` 节点创建运行时与隐藏 feed/emit 连接。

        隐藏连接只用于确定拓扑顺序（输入端口 → 块 → 输出端口），
        以及把端口数据搬运进出块节点；它们不属于用户可见的连接。
        """
        block_node_ids = {
            record.id for record in self.scene.nodes.values() if record.kind == "block"
        }
        for stale in [key for key in self.scene.block_instances if key not in block_node_ids]:
            del self.scene.block_instances[stale]
        for record in self.scene.nodes.values():
            if record.kind != "block":
                continue
            params = record.params or {}
            block_id = str(params.get("block_id") or "")
            if not block_id:
                raise ComputeError(
                    f"功能块节点 {record.name!r} 缺少 block_id："
                    "请删除该节点，或用模块库重新实例化"
                )
            block = self.scene.blocks.require(block_id)
            input_nodes = params.get("input_nodes") or {}
            output_nodes = params.get("output_nodes") or {}
            if not isinstance(input_nodes, dict) or not isinstance(output_nodes, dict):
                raise ComputeError(
                    f"功能块节点 {record.name!r} 的端口映射必须是对象"
                )
            # 复用已存在的实例：结构变化导致引擎重建时，块内部 state 不应被清空。
            runtime = self.scene.block_instances.get(record.id)
            if (
                runtime is None
                or runtime.block is not block
                or runtime.depth != self.scene.block_depth
            ):
                runtime = BlockRuntime(
                    block, self.scene.blocks, depth=self.scene.block_depth
                )
                self.scene.block_instances[record.id] = runtime
            buffer: dict[str, dict[str, Any]] = {}
            node = self.node_map[record.id]
            node.handler = self._block_handler(record, block, runtime, buffer)
            node.trusted = True
            for port in block.input_ports:
                port_id = input_nodes.get(port.name)
                if not isinstance(port_id, str) or port_id not in self.node_map:
                    raise ComputeError(
                        f"功能块 {block.name!r} 的输入端口 {port.name!r} "
                        "没有对应的父场景端口节点"
                    )
                self.network.connect(
                    self._feed_name(record.name, port.name),
                    self.node_map[port_id],
                    node,
                    self._feed_method(),
                    kind="block_feed",
                    _trusted=True,
                )
            for port in block.output_ports:
                port_id = output_nodes.get(port.name)
                if not isinstance(port_id, str) or port_id not in self.node_map:
                    raise ComputeError(
                        f"功能块 {block.name!r} 的输出端口 {port.name!r} "
                        "没有对应的父场景端口节点"
                    )
                self.network.connect(
                    f"__emit.{record.name}.{port.name}",
                    node,
                    self.node_map[port_id],
                    self._emit_method(buffer, port.name),
                    kind="block_emit",
                    _trusted=True,
                )
            self.block_runtimes[record.id] = runtime
            self.block_buffers[record.id] = buffer

    def capture_checkpoint(self) -> dict[str, Any]:
        return {
            "time": float(self.network.time),
            "nodes": {
                record.id: {
                    "data": copy.deepcopy(record.data),
                    "state": copy.deepcopy(record.state),
                    "inputs": copy.deepcopy(record.inputs),
                }
                for record in self.scene.nodes.values()
            },
            "edges": {
                record.id: copy.deepcopy(record.state)
                for record in self.scene.edges.values()
            },
            "buffers": copy.deepcopy(self.block_buffers),
            "blocks": {
                block_id: runtime.capture_checkpoint()
                for block_id, runtime in self.block_runtimes.items()
            },
        }

    def restore_checkpoint(self, checkpoint: dict[str, Any]) -> None:
        self.network.time = float(checkpoint.get("time", 0.0))
        for record in self.scene.nodes.values():
            row = checkpoint["nodes"].get(record.id)
            if row is not None:
                # 原地恢复：SignalEngine 的 Node 持有这些 dict 的引用。
                record.data.clear()
                record.data.update(copy.deepcopy(row["data"]))
                record.state.clear()
                record.state.update(copy.deepcopy(row["state"]))
                record.inputs.clear()
                record.inputs.update(copy.deepcopy(row["inputs"]))
        for record in self.scene.edges.values():
            if record.id in checkpoint["edges"]:
                record.state.clear()
                record.state.update(copy.deepcopy(checkpoint["edges"][record.id]))
        self.block_buffers = copy.deepcopy(checkpoint.get("buffers", {}))
        blocks = checkpoint.get("blocks") or {}
        for block_id, runtime in self.block_runtimes.items():
            runtime.restore_checkpoint(blocks.get(block_id))

    def step(self, dt: float) -> None:
        # 整步事务：网络层已回滚节点/连接，功能块内部场景另行快照，
        # 保证块内 state（积分器、滤波器记忆等）在失败时一起回退。
        snapshots = {
            block_id: runtime.capture_checkpoint()
            for block_id, runtime in self.block_runtimes.items()
        }
        try:
            self.network.step(dt)
        except BaseException:
            for block_id, snapshot in snapshots.items():
                runtime = self.block_runtimes.get(block_id)
                if runtime is not None:
                    runtime.restore_checkpoint(snapshot)
            raise

    def zero_time(self) -> None:
        self.network.time = 0.0

    def reset(self) -> None:
        for runtime in self.block_runtimes.values():
            runtime.reset()
        for buffer in self.block_buffers.values():
            buffer.clear()
        self.network.reset_state()

    def probes(self) -> dict[str, float]:
        values: dict[str, float] = {}
        for record in self.scene.nodes.values():
            count = 0
            for key, value in record.data.items():
                if count >= 6:
                    break
                if (
                    isinstance(value, (int, float))
                    and not isinstance(value, bool)
                    and math.isfinite(float(value))
                ):
                    values[f"n:{record.name}:{key}"] = float(value)
                    count += 1
        for record in self.scene.edges.values():
            connection = self.edge_map.get(record.id)
            if connection is None:
                continue
            count = 0
            for key, value in connection.output.items():
                if count >= 4:
                    break
                if (
                    isinstance(value, (int, float))
                    and not isinstance(value, bool)
                    and math.isfinite(float(value))
                ):
                    values[f"e:{record.name}:{key}"] = float(value)
                    count += 1
        return values

    def stats(self) -> dict[str, Any]:
        return {
            "kind": self.scene.mode,
            "matrix_size": 0,
            "nodes": len(self.network.nodes),
            "edges": len(self.network.connections),
            "blocks": len(self.block_runtimes),
            "time": self.network.time,
        }


class CircuitEngine(_Engine):
    def __init__(self, scene: "Scene") -> None:
        self.scene = scene
        # R24/D51：电路模块按"电气直连"展开——模块引脚与内部端口网络合并，
        # 内部器件进父矩阵。没有模块时 extra_* 为空，行为与之前完全一致。
        from .circuit_modules import flatten_circuit

        extra_nodes, extra_edges, merges = flatten_circuit(scene)
        all_nodes = {**scene.nodes, **extra_nodes}
        all_edges = list(scene.edges.values()) + list(extra_edges)
        self.block_records = extra_nodes
        net_records = {
            record.id: record
            for record in all_nodes.values()
            if record.kind in ("node", "ground")
        }
        parent = {node_id: node_id for node_id in net_records}

        def find(node_id: str) -> str:
            root = node_id
            while parent[root] != root:
                root = parent[root]
            while parent[node_id] != root:
                parent[node_id], node_id = root, parent[node_id]
            return root

        def union(first: str, second: str) -> None:
            root_a, root_b = find(first), find(second)
            if root_a != root_b:
                parent[root_b] = root_a

        # R24/D51：模块端口 ↔ 内部端口网络合并成同一个电气节点。
        for first, second in merges:
            if first in net_records and second in net_records:
                union(first, second)
            elif second in net_records and first not in net_records:
                raise ComputeError(
                    f"模块端口接到的网络 {first!r} 不是网络节点（不能接在器件上）"
                )
        # R20：网络节点之间的纯导线在电气上合并网络（MNA 只保留代表节点）。
        for edge in all_edges:
            if not edge.enabled or edge.kind != "wire":
                continue
            if edge.source in net_records and edge.target in net_records:
                union(edge.source, edge.target)
        ground_ids = [
            node_id for node_id, record in net_records.items() if record.kind == "ground"
        ]
        if not ground_ids:
            raise ComputeError("电路需要至少一个接地节点（把某个节点设为 ground）")
        for other in ground_ids[1:]:
            union(ground_ids[0], other)
        ground_root = find(ground_ids[0])
        net_root = {node_id: find(node_id) for node_id in net_records}
        roots: dict[str, NodeRecord] = {}
        for node_id, record in net_records.items():
            root = net_root[node_id]
            roots.setdefault(root, record)
        nodes = [
            CircuitNode(id=root, name=record.name, ground=root == ground_root)
            for root, record in roots.items()
        ]
        self.net_root = net_root
        elements = []
        self.element_map: dict[str, Any] = {}
        #: 编辑期允许器件暂时缺引脚；运行期不阻断，这些器件不参与求解（R21/D43）。
        self.incomplete_devices: list[str] = []
        #: 只有一端接线的电源：空脚自动对地（R21/D43），这里记录以便前端画出接地标记。
        self.implicit_grounds: list[dict[str, str]] = []
        used_roots: set[str] = set()
        # 旧模型（过渡期兼容）：边 = 元件。模块内部的元件边（flatten 出来的）
        # 也要一起装配，否则封装进模块的元件会整个消失。
        for record in all_edges:
            if not record.enabled or record.kind == "wire":
                continue
            if record.source not in net_root or record.target not in net_root:
                raise ComputeError(
                    f"元件 {record.name!r} 的一端接在已不存在的节点上"
                    f"（{record.source if record.source not in net_root else record.target}）；"
                    "请删掉这条元件连线重新绘制，或撤销刚才的封装/删除操作"
                )
            try:
                element = create_element(
                    record.kind,
                    record.name,
                    net_root[record.source],
                    net_root[record.target],
                    record.params,
                    record.state,
                    integration=scene.integration,
                )
            except Exception as exc:
                raise ComputeError(
                    f"元件 {record.name!r} 无法装配：{exc}"
                ) from exc
            elements.append(element)
            self.element_map[record.id] = element
            used_roots.update((element.a, element.b))
            # 旧边的控制端等参数可能引用额外网络节点，不能当成孤立网络剪掉。
            for value in record.params.values():
                if isinstance(value, str) and value in net_root:
                    used_roots.add(net_root[value])
        # R20 新模型：器件节点 + 引脚导线。
        for record in all_nodes.values():
            if record.kind != "device":
                continue
            kind = str(record.params.get("element") or "")
            pins: dict[str, str] = {}
            for edge in all_edges:
                if not edge.enabled or edge.kind != "wire":
                    continue
                if edge.source == record.id:
                    pin_name, net_id = edge.source_pin, edge.target
                elif edge.target == record.id:
                    pin_name, net_id = edge.target_pin, edge.source
                else:
                    continue
                if pin_name in pins:
                    raise ComputeError(
                        f"器件 {record.name!r} 的引脚 {pin_name!r} 接了多条导线"
                    )
                pins[pin_name] = net_root[net_id]
            try:
                from .ports import pins_for_device

                missing = [
                    pin.name
                    for pin in pins_for_device(kind)
                    if pin.required and pin.name not in pins
                ]
                if missing and kind in ("vsource", "isource") and pins and len(missing) == 1:
                    # 单端电源：另一脚自动对地（图上画接地标记，不是隐藏规则）。
                    pins[missing[0]] = ground_root
                    self.implicit_grounds.append(
                        {"device": record.name, "pin": missing[0]}
                    )
                    missing = []
                if missing:
                    self.incomplete_devices.append(
                        f"{record.name} 缺少引脚连接：{', '.join(missing)}"
                    )
                    continue
                element = create_element_from_pins(
                    kind,
                    record.name,
                    pins,
                    record.params,
                    record.state,
                    integration=scene.integration,
                    ground=ground_root,
                )
            except ComputeError:
                raise
            except Exception as exc:
                raise ComputeError(
                    f"器件 {record.name!r} 无法装配：{exc}"
                ) from exc
            elements.append(element)
            self.element_map[record.id] = element
            used_roots.update((element.a, element.b))
            used_roots.update(pins.values())
        # R21/D43：与未参与器件相连、实际没有任何元件引脚的孤立网络不进入 MNA
        # （否则会被判“悬空”而挡住运行）；它们保持 0 V，不参与求解。
        used_roots.add(ground_root)
        nodes = [node for node in nodes if node.id in used_roots]
        self.solver = CircuitSolver(
            nodes, elements, integration=scene.integration,
            options=getattr(scene, "solver_options", None),
        )

    def capture_checkpoint(self) -> dict[str, Any]:
        return {
            "solver": self.solver.capture_checkpoint(),
            "nodes": {
                record.id: {
                    "data": copy.deepcopy(record.data),
                    "inputs": copy.deepcopy(record.inputs),
                }
                for record in self.scene.nodes.values()
            },
            "edges": {
                record.id: copy.deepcopy(record.state)
                for record in self.scene.edges.values()
                if record.id not in self.element_map
            },
        }

    def restore_checkpoint(self, checkpoint: dict[str, Any]) -> None:
        self.solver.restore_checkpoint(checkpoint["solver"])
        for record in self.scene.nodes.values():
            row = checkpoint["nodes"].get(record.id)
            if row is not None:
                record.data.clear()
                record.data.update(copy.deepcopy(row["data"]))
                record.inputs.clear()
                record.inputs.update(copy.deepcopy(row["inputs"]))
            if record.id in self.element_map:
                # 器件节点的 state 与元件共享，恢复后重新绑定。
                record.state = self.element_map[record.id].state
        for record in self.scene.edges.values():
            if record.id in self.element_map:
                # 保持边记录与元件共享同一个 state 字典。
                record.state = self.element_map[record.id].state
            elif record.id in checkpoint["edges"]:
                record.state = copy.deepcopy(checkpoint["edges"][record.id])

    def step(self, dt: float) -> None:
        self.solver.step(dt)
        for record in self.scene.nodes.values():
            if record.kind == "device":
                continue
            root = self.net_root.get(record.id, record.id)
            record.data["voltage"] = float(
                self.solver.node_voltages.get(root, 0.0)
            )

    def operating_point(self) -> dict[str, Any]:
        """DC 工作点：不推进瞬态状态，节点电压按场景显示名返回。

        求解器内部以网络代表节点（net_root 的 root id）为键，这里映射回
        场景节点名，前端与探针都能直接读。
        """
        result = self.solver.operating_point()
        names = {node.id: node.name for node in self.solver.nodes}
        result["node_voltages"] = {
            names.get(node_id, node_id): float(value)
            for node_id, value in result["node_voltages"].items()
        }
        return result

    def ac_sweep(
        self,
        frequencies: list[float],
        *,
        input_source: str | None = None,
        probes: list[str] | None = None,
    ) -> dict[str, Any]:
        """AC 小信号扫频（先在工作点线性化），节点电压同样映射回显示名。"""
        result = self.solver.ac_sweep(
            frequencies, input_source=input_source, probes=probes
        )
        names = {node.id: node.name for node in self.solver.nodes}
        result["probes"] = {
            names.get(name, name): value for name, value in result["probes"].items()
        }
        operating = result.get("operating_point")
        if isinstance(operating, dict) and "node_voltages" in operating:
            operating["node_voltages"] = {
                names.get(node_id, node_id): float(value)
                for node_id, value in operating["node_voltages"].items()
            }
        return result

    def zero_time(self) -> None:
        self.solver.zero_time()

    def reset(self) -> None:
        self.solver.reset()
        for record in self.scene.nodes.values():
            record.data["voltage"] = 0.0
            record.inputs.clear()
        for record in self.scene.edges.values():
            if record.id not in self.element_map:
                record.state.clear()

    def probes(self) -> dict[str, float]:
        values: dict[str, float] = {}
        for record in self.scene.nodes.values():
            root = self.net_root.get(record.id, record.id)
            voltage = self.solver.node_voltages.get(root, 0.0)
            values[f"n:{record.name}:voltage"] = float(voltage)
        for record in self.scene.edges.values():
            element = self.element_map.get(record.id)
            if element is None:
                continue
            for key in ("current", "voltage_difference", "power"):
                value = element.state.get(key)
                if isinstance(value, (int, float)) and math.isfinite(float(value)):
                    values[f"e:{record.name}:{key}"] = float(value)
        return values

    def stats(self) -> dict[str, Any]:
        return {
            "kind": "circuit",
            "matrix_size": self.solver.matrix_size,
            "nodes": len(self.solver.nodes),
            "elements": len(self.solver.elements),
            "iterations": self.solver.last_iterations,
            "nonlinear": self.solver.nonlinear,
            "solve_ms": self.solver.last_solve_ms,
            "linear_reuse": self.solver.linear_reuse,
            "time": self.solver.time,
            "residual": self.solver.last_residual,
            "strategies": list(self.solver.last_strategies),
            "scaling": self.solver.last_scaled,
            "pivot_tol": self.solver.options.pivot_tol,
            # R21/D43：编辑期/运行期可见的“未参与求解”清单与自动接地记录。
            "inactive_devices": list(self.incomplete_devices),
            "implicit_grounds": list(self.implicit_grounds),
        }


# ---- 场景 ------------------------------------------------------------------
class Scene:
    def __init__(self, mode: str = "signal") -> None:
        if mode not in MODES:
            raise ValidationError(f"未知模式：{mode!r}")
        self.mode = mode
        self.integration = "trapezoidal"
        self.solver_options = None
        self.nodes: dict[str, NodeRecord] = {}
        self.edges: dict[str, EdgeRecord] = {}
        # 功能块定义；BlockRuntime 的内部场景共享同一份定义表。
        self.blocks = BlockStore()
        # 功能块实例的运行时缓存：结构变化重建引擎时复用，内部 state 才不会丢。
        self.block_instances: dict[str, BlockRuntime] = {}
        self.block_depth = 0
        self.revision = 0
        self._engine: _Engine | None = None
        self._dirty = True
        self.last_step_ms = 0.0
        self._counter = 0

    # ---- 通用 -------------------------------------------------------------
    def _touch(self) -> None:
        self.revision += 1
        self._dirty = True

    def ensure_engine(self) -> _Engine:
        if self._engine is None or self._dirty:
            self._engine = (
                CircuitEngine(self) if self.mode == "circuit" else SignalEngine(self)
            )
            self._dirty = False
        return self._engine

    def set_solver_options(self, options: object | None) -> None:
        """P0：更新求解器选项；下次 ensure_engine 时生效。"""
        self.solver_options = options
        self.revision += 1
        self._dirty = True

    def capture_checkpoint(self) -> dict[str, Any]:
        engine = self.ensure_engine()
        return {"engine": engine, "state": engine.capture_checkpoint()}

    def restore_checkpoint(self, checkpoint: dict[str, Any] | None) -> None:
        if not checkpoint:
            return
        engine = self.ensure_engine()
        state = checkpoint.get("state")
        if engine is checkpoint.get("engine") and state is not None:
            engine.restore_checkpoint(state)

    def _iter_source_params(self) -> list[dict[str, Any]]:
        """收集边源与器件节点源的参数（P0-09：器件节点也参与断点）。"""
        rows: list[dict[str, Any]] = []
        for edge in self.edges.values():
            if edge.enabled and edge.kind in ("vsource", "isource"):
                rows.append(edge.params or {})
        for record in self.nodes.values():
            if record.kind != "device":
                continue
            params = record.params or {}
            if str(params.get("element", "")) in ("vsource", "isource"):
                rows.append(params)
        return rows

    @staticmethod
    def _breakpoint_in(params: dict[str, Any], now: float, dt: float) -> float | None:
        wave = str(params.get("wave", "sine"))
        if wave == "dc":
            return None
        frequency = float(params.get("frequency", 0.0) or 0.0)
        delay = float(params.get("delay", 0.0) or 0.0)
        phase = float(params.get("phase", 0.0) or 0.0)
        eps = 1.0e-12
        candidates: list[float] = []
        # 延迟起点本身就是一次跳变（之前是 offset，之后按相位取值）。
        if delay > now + eps and delay <= now + dt + eps:
            candidates.append(delay)
        if wave in ("step", "ramp"):
            return min(candidates) if candidates else None
        if frequency <= 0.0:
            return min(candidates) if candidates else None
        if wave not in ("square", "pulse"):
            return min(candidates) if candidates else None
        period = 1.0 / frequency
        duty = min(0.99, max(0.01, float(params.get("duty", 0.5) or 0.5)))
        fractions = (0.5, 1.0) if wave == "square" else (duty, 1.0)
        cycles_now = (now - delay) * frequency + phase / 360.0
        base = int(math.floor(cycles_now))
        for cycle in (base - 1, base, base + 1):
            for fraction in fractions:
                point = delay + (cycle + fraction - phase / 360.0) * period
                if point > now + eps and point <= now + dt + eps:
                    candidates.append(point)
        return min(candidates) if candidates else None

    def next_breakpoint(self, now: float, dt: float) -> float | None:
        """P0/D48：返回 (now, now+dt] 内最近的波形跳变时刻（边源+器件源）。"""
        if dt <= 0.0:
            return None
        best: float | None = None
        for params in self._iter_source_params():
            point = self._breakpoint_in(params, now, dt)
            if point is not None:
                best = point if best is None else min(best, point)
        return best

    @timed("scene.step")
    def step(self, dt: float) -> dict[str, Any]:
        engine = self.ensure_engine()
        started = time.perf_counter()
        engine.step(dt)
        self.last_step_ms = (time.perf_counter() - started) * 1000.0
        stats = engine.stats()
        stats["step_ms"] = self.last_step_ms
        return stats

    def zero_time(self) -> None:
        """时间归零：引擎时间轴归零，节点数据/历史状态保留（R11/D14）。"""
        self.ensure_engine().zero_time()

    def reset(self) -> None:
        engine = self.ensure_engine()
        engine.reset()
        self.last_step_ms = 0.0

    def probes(self) -> dict[str, float]:
        engine = self.ensure_engine()
        values = engine.probes()
        if len(values) > 240:
            values = dict(list(values.items())[:240])
        return values

    def stats(self) -> dict[str, Any]:
        base: dict[str, Any] = {
            "mode": self.mode,
            "revision": self.revision,
            "integration": self.integration,
            "step_ms": self.last_step_ms,
            "node_count": len(self.nodes),
            "edge_count": len(self.edges),
        }
        try:
            base.update(self.ensure_engine().stats())
        except Exception as exc:  # 让界面仍能渲染并提示问题
            base["engine_error"] = str(exc)
        return base

    def runtime_state(self) -> dict[str, Any]:
        """给 HTTP 层的完整快照：包含最新输出、输入与引擎统计。"""
        engine: _Engine | None = None
        engine_error: str | None = None
        try:
            engine = self.ensure_engine()
        except Exception as exc:
            engine_error = str(exc)

        edges = []
        for record in self.edges.values():
            item = record.snapshot()
            output: dict[str, Any] = {}
            if isinstance(engine, SignalEngine):
                connection = engine.edge_map.get(record.id)
                if connection is not None:
                    output = copy.deepcopy(connection.output)
            else:
                for key in ("current", "voltage_difference", "power"):
                    if key in record.state:
                        output[key] = record.state[key]
            item["output"] = output
            edges.append(item)

        state = {
            "mode": self.mode,
            "integration": self.integration,
            "revision": self.revision,
            "nodes": [record.snapshot() for record in self.nodes.values()],
            "edges": edges,
            "stats": self.stats(),
        }
        if engine_error is not None:
            state["engine_error"] = engine_error
        return state

    # ---- 名称与参数 -------------------------------------------------------
    def _unique_node_name(self, name: str, *, ignore: str | None = None) -> None:
        for node_id, record in self.nodes.items():
            if node_id != ignore and record.name == name:
                raise ConflictError(f"节点名称 {name!r} 已存在")

    def _unique_edge_name(self, name: str, *, ignore: str | None = None) -> None:
        for edge_id, record in self.edges.items():
            if edge_id != ignore and record.name == name:
                raise ConflictError(f"连接名称 {name!r} 已存在")

    def _auto_edge_name(self, kind: str) -> str:
        while True:
            self._counter += 1
            candidate = f"{kind}-{self._counter}"
            if all(record.name != candidate for record in self.edges.values()):
                return candidate

    def next_node_name(self, base: str) -> str:
        """在现有节点名中生成唯一名称（保留可读前缀）。"""
        return self._unique_name(base, {record.name for record in self.nodes.values()})

    def next_edge_name(self, base: str) -> str:
        """在现有连接名中生成唯一名称。"""
        return self._unique_name(base, {record.name for record in self.edges.values()})

    @staticmethod
    def _unique_name(base: str, existing: set[str]) -> str:
        text = str(base or "").strip() or "item"
        if len(text) > MAX_NAME:
            text = text[:MAX_NAME]
        candidate = text
        index = 2
        while candidate in existing:
            suffix = f"_{index}"
            candidate = text[: MAX_NAME - len(suffix)] + suffix
            index += 1
        return candidate

    def _normalize_node_params(
        self, kind: str, raw: Any
    ) -> tuple[dict[str, Any], str]:
        if self.mode in ("signal", "vector"):
            spec = get_compute_spec(kind)
            params = validate_params(list(spec.params), raw)
            # 只有 kind="block" 手动创建一定坏（没有 block_id）；module_input /
            # module_output 在模块内部场景里本来就不带 block_id，不能在这里拦。
            if kind == "block" and not str(params.get("block_id") or "").strip():
                raise ValidationError(
                    f"{spec.label}（kind={kind}）缺少 block_id，不能手动创建："
                    "功能块实例只能由模块库实例化或封装生成。"
                    "若这是打开旧工程时报的错，请删除该节点后用模块库重新实例化。"
                )
            return params, spec.label
        if kind == "device":
            return self._normalize_device_params(raw), "器件"
        if kind == "module":
            return self._normalize_module_params(raw), "电路模块"
        if kind not in ("node", "ground"):
            raise ValidationError(
                "电路模式的节点类型只能是 node、ground、device 或 module"
            )
        return self._normalize_net_params(raw), "接地" if kind == "ground" else "电学节点"

    def _normalize_net_params(self, raw: Any) -> dict[str, Any]:
        """网络节点可带端口标记（R24/D49）：这个名字/方向的网络就是模块端口。"""
        if raw in (None, {}):
            return {}
        if not isinstance(raw, dict):
            raise ValidationError("网络节点参数必须是对象")
        allowed = {"port_name", "port_direction", "port_note"}
        unknown = set(raw) - allowed
        if unknown:
            raise ValidationError(
                "网络节点只支持端口标记参数：" + ", ".join(sorted(allowed))
            )
        name = str(raw.get("port_name") or "").strip()
        direction = str(raw.get("port_direction") or "").strip()
        if direction and direction not in ("input", "output", "inout"):
            raise ValidationError("端口方向必须是 input / output / inout")
        if direction and not name:
            raise ValidationError("选了端口方向就要给端口名称")
        params: dict[str, Any] = {}
        if name:
            params["port_name"] = name[:32]
            params["port_direction"] = direction or "inout"
        if raw.get("port_note"):
            params["port_note"] = str(raw.get("port_note"))[:200]
        return params

    def _normalize_module_params(self, raw: Any) -> dict[str, Any]:
        """电路模块节点：只能由模块库实例化或封装生成（R24/D51）。"""
        if not isinstance(raw, dict):
            raise ValidationError("模块节点参数必须是对象")
        block_id = str(raw.get("block_id") or "").strip()
        if not block_id:
            raise ValidationError(
                "模块节点缺少 block_id，不能手动创建：电路模块只能由模块库实例化或封装生成"
            )
        ports = raw.get("ports")
        clean: list[dict[str, str]] = []
        if isinstance(ports, list):
            for item in ports:
                if not isinstance(item, dict):
                    raise ValidationError("模块端口必须是对象")
                name = str(item.get("name") or "").strip()
                direction = str(item.get("direction") or "inout")
                if not name:
                    raise ValidationError("模块端口缺少名称")
                if direction not in ("input", "output", "inout"):
                    raise ValidationError("模块端口方向必须是 input / output / inout")
                clean.append({"name": name[:32], "direction": direction})
        return {
            "block_id": block_id,
            "block_name": str(raw.get("block_name") or "")[:32],
            "ports": clean,
        }

    def _normalize_device_params(self, raw: Any) -> dict[str, Any]:
        """器件节点参数：``{"element": 元件 kind, ...元件参数}``。"""
        if not isinstance(raw, dict):
            raise ValidationError("器件节点参数必须是对象：{'element': 元件 kind, ...}")
        element = raw.get("element")
        if not isinstance(element, str) or not element:
            raise ValidationError("器件节点缺少 element（元件 kind）")
        try:
            spec = element_spec(element)
            pins_for_device(element)
        except (ComputeError, KeyError) as exc:
            raise ValidationError(f"器件节点元件不合法：{exc}") from exc
        payload = {key: value for key, value in raw.items() if key != "element"}
        params = validate_params(list(spec.params), payload)
        return {"element": element, **params}

    def _normalize_edge_params(self, kind: str, raw: Any) -> dict[str, Any]:
        if self.mode in ("signal", "vector"):
            spec = get_method_spec(kind)
            return validate_params(list(spec.params), raw)
        if kind == "wire":
            if raw not in (None, {}):
                raise ValidationError("导线没有参数")
            return {}
        spec = element_spec(kind)
        return validate_params(list(spec.params), raw)

    def _normalize_wire_pins(
        self,
        kind: str,
        source_id: str,
        target_id: str,
        source_pin: Any,
        target_pin: Any,
        nodes: dict[str, "NodeRecord"] | None = None,
    ) -> tuple[str, str]:
        """R20：导线只允许「器件引脚 ↔ 网络节点」，并校验引脚存在。"""
        node_map = self.nodes if nodes is None else nodes
        if kind != "wire":
            if source_pin or target_pin:
                raise ValidationError("只有导线（kind=wire）可以绑定引脚")
            return "", ""
        if self.mode != "circuit":
            raise ValidationError("导线（kind=wire）只用于电路模式")
        if not isinstance(source_pin, str) or not isinstance(target_pin, str):
            raise ValidationError("导线引脚必须是字符串")
        source_node = node_map.get(source_id)
        target_node = node_map.get(target_id)
        if source_node is None or target_node is None:
            raise NotFoundError("导线的端点节点不存在")
        from .circuit_modules import DEVICE_KINDS, pin_names

        is_device = (
            source_node.kind in DEVICE_KINDS,
            target_node.kind in DEVICE_KINDS,
        )
        if is_device[0] and is_device[1]:
            raise ValidationError("导线不允许直接连接两个器件（请经网络节点）")
        if not any(is_device):
            # 纯导线：两个网络节点之间，电气上合并为一个网络。
            if source_pin or target_pin:
                raise ValidationError("网络节点之间的纯导线不能绑定引脚")
            return "", ""
        resolved = [source_pin, target_pin]
        for index, (side, node) in enumerate(
            (("起点", source_node), ("终点", target_node))
        ):
            pin = resolved[index]
            if node.kind in DEVICE_KINDS:
                if not pin and node.kind == "module":
                    # 只有一个端口的模块：外部直接连到那个端口，不必再指定引脚名。
                    only = pin_names(node)
                    if len(only) == 1:
                        pin = resolved[index] = only[0]
                if not pin:
                    raise ValidationError(f"{side}是器件节点 {node.name!r}，必须指定引脚")
                if node.kind == "module":
                    names = set(pin_names(node))
                    label = "模块"
                else:
                    element = str(node.params.get("element") or "")
                    try:
                        names = {item.name for item in pins_for_device(element)}
                    except KeyError as exc:
                        raise ValidationError(str(exc)) from exc
                    label = "器件"
                if pin not in names:
                    raise ValidationError(
                        f"{label} {node.name!r} 没有引脚 {pin!r}；可用：{', '.join(sorted(names))}"
                    )
            elif pin:
                raise ValidationError(f"{side}是网络节点，不能绑定引脚 {pin!r}")
        return resolved[0], resolved[1]

    def _normalize_signal_ports(
        self,
        kind: str,
        source_id: str,
        target_id: str,
        source_port: Any,
        target_port: Any,
        nodes: dict[str, "NodeRecord"] | None = None,
    ) -> tuple[str, str]:
        """R20/Q8：信号/矢量边的端口绑定；电路用 source_pin/target_pin。"""
        node_map = self.nodes if nodes is None else nodes
        source_port = "" if source_port in (None, "") else str(source_port)
        target_port = "" if target_port in (None, "") else str(target_port)
        if self.mode == "circuit":
            if source_port or target_port:
                raise ValidationError("电路场景使用引脚的 source_pin/target_pin，不用端口")
            return "", ""
        if not source_port and not target_port:
            return "", ""
        source = node_map.get(source_id)
        target = node_map.get(target_id)
        if source is None or target is None:
            raise NotFoundError("连接的端点节点不存在")
        source_spec = get_compute_spec(source.kind)
        target_spec = get_compute_spec(target.kind)
        if source_port:
            outputs = tuple(source_spec.outputs or ())
            if outputs and source_port not in outputs:
                raise ValidationError(
                    f"节点 {source.name!r} 没有输出字段 {source_port!r}；可用：{', '.join(outputs)}"
                )
        if target_port:
            ports = [item.name for item in target_spec.inputs]
            if not ports:
                raise ValidationError(f"节点 {target.name!r} 没有声明输入端口")
            if target_port not in ports:
                raise ValidationError(
                    f"节点 {target.name!r} 没有输入端口 {target_port!r}；可用：{', '.join(ports)}"
                )
        return source_port, target_port

    def _check_block_mode(
        self, kind: str, params: dict[str, Any], *, node_id: str | None = None
    ) -> None:
        """R06/D11：模块模式必须与所在场景一致，跨模式要被明确拒绝。"""
        if kind != "block":
            return
        block_id = str(params.get("block_id") or "")
        block = self.blocks.get(block_id) if block_id else None
        if block is None:
            return
        if block.mode != self.mode:
            where = f"节点 {node_id!r}" if node_id else f"模块 {block.name!r}"
            raise ValidationError(
                f"{where} 是 {block.mode} 模式模块，不能放进 {self.mode} 模式场景；"
                "请改用同模式模块，或经显式接口块连接（signal↔vector 用 if_*_interface，"
                "circuit 侧接口块在 P4）"
            )

    @staticmethod
    def _node_size(raw: Any) -> dict[str, float]:
        """节点尺寸：只接受 ``{"w": 直径}``（可选 h），范围 24..200。"""
        if raw in (None, {}):
            return {}
        if not isinstance(raw, dict):
            raise ValidationError("节点尺寸必须是对象")
        unknown = set(raw) - {"w", "h"}
        if unknown:
            raise ValidationError(
                f"节点尺寸包含未知键：{', '.join(sorted(unknown))}"
            )
        result: dict[str, float] = {}
        for key in ("w", "h"):
            if key not in raw:
                continue
            value = as_float(raw[key], f"节点尺寸 {key}", lo=MIN_NODE_SIZE, hi=MAX_NODE_SIZE)
            result[key] = round(value, 3)
        return result

    @staticmethod
    def _edge_route(raw: Any) -> str:
        if raw in (None, ""):
            return "auto"
        route = str(raw)
        if route not in ROUTE_MODES:
            raise ValidationError(
                f"路由方式必须是 {'/'.join(ROUTE_MODES)} 之一，收到 {route!r}"
            )
        return route

    @staticmethod
    def _edge_layout(raw: Any) -> dict[str, Any]:
        if raw in (None, {}):
            return {}
        if not isinstance(raw, dict):
            raise ValidationError("layout 必须是对象")
        unknown = set(raw) - {"x", "y", "rot"}
        if unknown:
            raise ValidationError(f"layout 包含未知键：{', '.join(sorted(unknown))}")
        rot = int(raw.get("rot", 0) or 0)
        if rot % 30 != 0:
            raise ValidationError("layout.rot 必须是 30° 的整数倍")
        return {
            "x": as_float(raw.get("x", 0.0), "layout.x"),
            "y": as_float(raw.get("y", 0.0), "layout.y"),
            "rot": rot % 360,
        }

    @staticmethod
    def _edge_waypoints(raw: Any) -> list[dict[str, float]]:
        if raw in (None, []):
            return []
        if not isinstance(raw, list):
            raise ValidationError("拐点必须是数组")
        if len(raw) > MAX_WAYPOINTS:
            raise LimitError(f"拐点最多 {MAX_WAYPOINTS} 个")
        points: list[dict[str, float]] = []
        for index, item in enumerate(raw):
            if not isinstance(item, dict):
                raise ValidationError(f"第 {index + 1} 个拐点必须是对象")
            unknown = set(item) - {"x", "y"}
            if unknown:
                raise ValidationError(
                    f"拐点包含未知键：{', '.join(sorted(unknown))}"
                )
            points.append(
                {
                    "x": as_float(
                        item.get("x"), f"拐点 x", lo=-MAX_POSITION, hi=MAX_POSITION
                    ),
                    "y": as_float(
                        item.get("y"), f"拐点 y", lo=-MAX_POSITION, hi=MAX_POSITION
                    ),
                }
            )
        return points

    @staticmethod
    def _edge_anchors(raw: Any) -> dict[str, str]:
        if raw in (None, {}):
            return {}
        if not isinstance(raw, dict):
            raise ValidationError("锚点必须是对象")
        unknown = set(raw) - {"source", "target"}
        if unknown:
            raise ValidationError(f"锚点包含未知键：{', '.join(sorted(unknown))}")
        result: dict[str, str] = {}
        for key in ("source", "target"):
            if key not in raw:
                continue
            side = str(raw[key])
            if side not in ANCHOR_SIDES:
                raise ValidationError(
                    f"锚点 {key} 必须是 {'/'.join(ANCHOR_SIDES)} 之一"
                )
            result[key] = side
        return result

    def _position(self, raw: Any) -> dict[str, float]:
        if raw is None:
            angle = len(self.nodes) * 0.72
            return {
                "x": float(round(220.0 * math.cos(angle))),
                "y": float(round(150.0 * math.sin(angle))),
            }
        if not isinstance(raw, dict):
            raise ValidationError("坐标必须是 {x, y} 对象")
        unknown = set(raw) - {"x", "y"}
        if unknown:
            raise ValidationError(f"坐标包含未知键：{', '.join(sorted(unknown))}")
        return {
            "x": as_float(raw.get("x", 0.0), "x 坐标", lo=-MAX_POSITION, hi=MAX_POSITION),
            "y": as_float(raw.get("y", 0.0), "y 坐标", lo=-MAX_POSITION, hi=MAX_POSITION),
        }

    # ---- 节点 -------------------------------------------------------------
    def add_node(
        self,
        *,
        name: str,
        kind: str = "manual",
        params: Any = None,
        data: Any = None,
        position: Any = None,
        size: Any = None,
        node_id: str | None = None,
    ) -> NodeRecord:
        if len(self.nodes) >= MAX_NODES:
            raise LimitError(f"节点数量不能超过 {MAX_NODES}")
        clean_name = check_name(name, "节点名称")
        self._unique_node_name(clean_name)
        if not isinstance(kind, str):
            raise ValidationError("kind 必须是字符串")
        params_clean, _label = self._normalize_node_params(kind, params)
        self._check_block_mode(kind, params_clean)
        data_clean = json_safe(data or {}, where=f"节点 {clean_name!r} 的数据")
        if len(data_clean) > MAX_FIELDS:
            raise LimitError(f"节点数据最多 {MAX_FIELDS} 个字段")
        identifier = check_id(node_id, "节点 id") if node_id else uuid.uuid4().hex[:12]
        if identifier in self.nodes:
            raise ConflictError(f"节点 id {identifier!r} 已存在")
        record = NodeRecord(
            id=identifier,
            name=clean_name,
            kind=kind,
            params=params_clean,
            data=data_clean,
            state={},
            inputs={},
            position=self._position(position),
            size=self._node_size(size),
        )
        self.nodes[identifier] = record
        self._touch()
        return record

    def update_node(self, node_id: str, payload: dict[str, Any]) -> NodeRecord:
        record = self.nodes.get(node_id)
        if record is None:
            raise NotFoundError(f"节点 {node_id!r} 不存在")
        allowed = {"name", "kind", "params", "data", "position", "size"}
        unknown = set(payload) - allowed
        if unknown:
            raise ValidationError(f"节点更新包含未知字段：{', '.join(sorted(unknown))}")

        if "name" in payload:
            name = check_name(payload["name"], "节点名称")
            self._unique_node_name(name, ignore=node_id)
            record.name = name
        if "kind" in payload:
            kind = payload["kind"]
            if not isinstance(kind, str):
                raise ValidationError("kind 必须是字符串")
            params_clean, _label = self._normalize_node_params(
                kind, payload.get("params")
            )
            self._check_block_mode(kind, params_clean, node_id=node_id)
            if kind != record.kind:
                record.state.clear()
                record.inputs.clear()
            record.kind = kind
            record.params = params_clean
        elif "params" in payload:
            params_clean, _label = self._normalize_node_params(
                record.kind, payload["params"]
            )
            record.params = params_clean
        if "data" in payload:
            data_clean = json_safe(
                payload["data"], where=f"节点 {record.name!r} 的数据"
            )
            if len(data_clean) > MAX_FIELDS:
                raise LimitError(f"节点数据最多 {MAX_FIELDS} 个字段")
            record.data = data_clean
        if "position" in payload:
            position = self._position(payload["position"])
            record.position = position
        if "size" in payload:
            record.size = self._node_size(payload["size"])
        self._touch()
        return record

    def update_positions(self, items: list[dict[str, Any]]) -> None:
        if not isinstance(items, list) or len(items) > MAX_NODES:
            raise ValidationError("positions 必须是节点坐标数组")
        seen: set[str] = set()
        updates: dict[str, dict[str, float]] = {}
        for item in items:
            if not isinstance(item, dict):
                raise ValidationError("坐标项必须是对象")
            node_id = check_id(item.get("id"), "节点 id")
            if node_id in seen:
                raise ValidationError(f"重复的节点 id：{node_id}")
            if node_id not in self.nodes:
                raise NotFoundError(f"节点 {node_id!r} 不存在")
            seen.add(node_id)
            updates[node_id] = self._position(item.get("position"))
        for node_id, position in updates.items():
            self.nodes[node_id].position = position
        if updates:
            self.revision += 1  # 坐标变化不需要重建引擎

    def delete_node(self, node_id: str) -> list[str]:
        if node_id not in self.nodes:
            raise NotFoundError(f"节点 {node_id!r} 不存在")
        removed_edges = [
            edge.id
            for edge in self.edges.values()
            if edge.source == node_id or edge.target == node_id
        ]
        for edge_id in removed_edges:
            del self.edges[edge_id]
        del self.nodes[node_id]
        self._touch()
        return removed_edges

    # ---- 连接 -------------------------------------------------------------
    def _would_cycle(
        self, source_id: str, target_id: str, *, skip_edge: str | None = None
    ) -> bool:
        adjacency: dict[str, list[str]] = {node_id: [] for node_id in self.nodes}
        for edge in self.edges.values():
            if not edge.enabled or edge.delay or edge.id == skip_edge:
                continue
            adjacency[edge.source].append(edge.target)
        if source_id == target_id:
            return True
        stack = [target_id]
        seen = {target_id}
        while stack:
            current = stack.pop()
            for neighbour in adjacency.get(current, ()):
                if neighbour == source_id:
                    return True
                if neighbour not in seen:
                    seen.add(neighbour)
                    stack.append(neighbour)
        return False

    def add_edge(
        self,
        *,
        source: str,
        target: str,
        kind: str,
        name: str | None = None,
        params: Any = None,
        delay: bool = False,
        enabled: bool = True,
        auto_delay: bool = True,
        route: Any = "auto",
        waypoints: Any = None,
        anchors: Any = None,
        pins: Any = None,
        layout: Any = None,
        source_pin: Any = "",
        target_pin: Any = "",
        source_port: Any = "",
        target_port: Any = "",
    ) -> EdgeRecord:
        if len(self.edges) >= MAX_EDGES:
            raise LimitError(f"连接数量不能超过 {MAX_EDGES}")
        if pins is not None:
            from .schematic import apply_pin_bindings

            bound = apply_pin_bindings(
                {"kind": kind, "source": source, "target": target, "params": params or {}, "pins": pins}
            )
            source, target, params = bound["source"], bound["target"], bound["params"]
        source_id = check_id(source, "起点 id")
        target_id = check_id(target, "终点 id")
        if source_id not in self.nodes:
            raise NotFoundError(f"起点节点 {source_id!r} 不存在")
        if target_id not in self.nodes:
            raise NotFoundError(f"终点节点 {target_id!r} 不存在")
        if not isinstance(kind, str):
            raise ValidationError("kind 必须是字符串")
        params_clean = self._normalize_edge_params(kind, params)
        clean_name = (
            check_name(name, "连接名称") if name else self._auto_edge_name(kind)
        )
        self._unique_edge_name(clean_name)

        if self.mode == "circuit":
            if delay:
                raise ValidationError("电路模式使用节点电压法求解，不支持延迟连接")
            if source_id == target_id:
                raise ValidationError("元件两端不能是同一个节点")
            delay = False
        elif not delay and self._would_cycle(source_id, target_id):
            if auto_delay:
                delay = True
            else:
                raise ConflictError("这条连接会形成代数环，请改用单步延迟连接")

        source_pin, target_pin = self._normalize_wire_pins(
            kind, source_id, target_id, source_pin, target_pin
        )
        source_port, target_port = self._normalize_signal_ports(
            kind, source_id, target_id, source_port, target_port
        )

        identifier = uuid.uuid4().hex[:12]
        record = EdgeRecord(
            id=identifier,
            name=clean_name,
            source=source_id,
            target=target_id,
            kind=kind,
            params=params_clean,
            state={},
            delay=bool(delay),
            enabled=bool(enabled),
            route=self._edge_route(route),
            waypoints=self._edge_waypoints(waypoints),
            anchors=self._edge_anchors(anchors),
            layout=self._edge_layout(layout),
            source_pin=source_pin,
            target_pin=target_pin,
            source_port=source_port,
            target_port=target_port,
        )
        self.edges[identifier] = record
        self._touch()
        return record

    def update_edge(self, edge_id: str, payload: dict[str, Any]) -> EdgeRecord:
        record = self.edges.get(edge_id)
        if record is None:
            raise NotFoundError(f"连接 {edge_id!r} 不存在")
        allowed = {
            "name",
            "kind",
            "params",
            "delay",
            "enabled",
            "source",
            "target",
            "route",
            "waypoints",
            "anchors",
            "layout",
            "pins",
            "source_pin",
            "target_pin",
            "source_port",
            "target_port",
        }
        unknown = set(payload) - allowed
        if unknown:
            raise ValidationError(f"连接更新包含未知字段：{', '.join(sorted(unknown))}")

        if "pins" in payload:
            from .schematic import apply_pin_bindings

            bound = apply_pin_bindings(
                {
                    "kind": payload.get("kind", record.kind),
                    "source": payload.get("source", record.source),
                    "target": payload.get("target", record.target),
                    "params": payload.get("params", record.params),
                    "pins": payload["pins"],
                }
            )
            payload = dict(payload)
            payload["source"] = bound["source"]
            payload["target"] = bound["target"]
            payload["params"] = bound["params"]
        source_id = record.source
        target_id = record.target
        if "source" in payload:
            source_id = check_id(payload["source"], "起点 id")
            if source_id not in self.nodes:
                raise NotFoundError(f"起点节点 {source_id!r} 不存在")
        if "target" in payload:
            target_id = check_id(payload["target"], "终点 id")
            if target_id not in self.nodes:
                raise NotFoundError(f"终点节点 {target_id!r} 不存在")

        kind = record.kind
        new_params: dict[str, Any] | None = None
        if "kind" in payload:
            kind = payload["kind"]
            if not isinstance(kind, str):
                raise ValidationError("kind 必须是字符串")
        if "params" in payload or kind != record.kind:
            new_params = self._normalize_edge_params(kind, payload.get("params"))

        delay = bool(payload.get("delay", record.delay))
        enabled = bool(payload.get("enabled", record.enabled))
        if self.mode == "circuit":
            if delay:
                raise ValidationError("电路模式不支持延迟连接")
            if source_id == target_id:
                raise ValidationError("元件两端不能是同一个节点")

        if "name" in payload:
            name = check_name(payload["name"], "连接名称")
            self._unique_edge_name(name, ignore=edge_id)
            record.name = name
        source_pin, target_pin = self._normalize_wire_pins(
            kind,
            source_id,
            target_id,
            payload.get("source_pin", record.source_pin),
            payload.get("target_pin", record.target_pin),
        )
        source_port, target_port = self._normalize_signal_ports(
            kind,
            source_id,
            target_id,
            payload.get("source_port", record.source_port),
            payload.get("target_port", record.target_port),
        )
        if kind != record.kind:
            record.state.clear()
            record.kind = kind
        if new_params is not None:
            record.params = new_params
        if self.mode == "signal" and enabled and not delay:
            if self._would_cycle(source_id, target_id, skip_edge=edge_id):
                raise ConflictError(
                    "取消延迟或启用该连接会形成代数环；请保留一条单步延迟"
                )
        record.source = source_id
        record.target = target_id
        record.source_pin = source_pin
        record.target_pin = target_pin
        record.source_port = source_port
        record.target_port = target_port
        record.delay = delay
        record.enabled = enabled
        if "route" in payload:
            record.route = self._edge_route(payload["route"])
        if "waypoints" in payload:
            record.waypoints = self._edge_waypoints(payload["waypoints"])
        if "anchors" in payload:
            record.anchors = self._edge_anchors(payload["anchors"])
        if "layout" in payload:
            record.layout = self._edge_layout(payload["layout"])
        self._touch()
        return record

    def delete_edge(self, edge_id: str) -> None:
        if edge_id not in self.edges:
            raise NotFoundError(f"连接 {edge_id!r} 不存在")
        del self.edges[edge_id]
        self._touch()

    def set_integration(self, method: str) -> None:
        allowed = {item["value"] for item in integration_methods()}
        if method not in allowed:
            raise ValidationError(f"未知积分方法：{method!r}")
        self.integration = method
        self._touch()

    def operating_point(self) -> dict[str, Any]:
        """DC 工作点（仅电路模式），不推进时间、不改瞬态状态。"""
        if self.mode != "circuit":
            raise ValidationError("DC 工作点仅支持电路模式")
        return self.ensure_engine().operating_point()

    def ac_sweep(
        self,
        frequencies: list[float],
        *,
        input_source: str | None = None,
        probes: list[str] | None = None,
    ) -> dict[str, Any]:
        """AC 小信号扫频（仅电路模式），先在工作点线性化。"""
        if self.mode != "circuit":
            raise ValidationError("AC 分析仅支持电路模式")
        return self.ensure_engine().ac_sweep(
            frequencies, input_source=input_source, probes=probes
        )

    # ---- 整体导入/导出 ----------------------------------------------------
    def to_payload(self, *, include_state: bool = False) -> dict[str, Any]:
        nodes = []
        for record in self.nodes.values():
            item = record.snapshot()
            if not include_state:
                item.pop("state", None)
                item.pop("inputs", None)
            nodes.append(item)
        edges = []
        for record in self.edges.values():
            item = record.snapshot()
            if not include_state:
                item.pop("state", None)
            edges.append(item)
        return {
            "mode": self.mode,
            "integration": self.integration,
            "nodes": nodes,
            "edges": edges,
            "blocks": self.blocks.export_user(),
        }

    def load_payload(self, payload: Any) -> None:
        if not isinstance(payload, dict):
            raise ValidationError("场景必须是 JSON 对象")
        mode = payload.get("mode", self.mode)
        if mode not in MODES:
            raise ValidationError(f"未知模式：{mode!r}")
        integration = payload.get("integration", "trapezoidal")
        allowed_integration = {item["value"] for item in integration_methods()}
        if integration not in allowed_integration:
            raise ValidationError(f"未知积分方法：{integration!r}")

        raw_nodes = payload.get("nodes")
        raw_edges = payload.get("edges")
        if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
            raise ValidationError("场景必须包含 nodes 与 edges 数组")
        if len(raw_nodes) > MAX_NODES:
            raise LimitError(f"节点数量不能超过 {MAX_NODES}")
        if len(raw_edges) > MAX_EDGES:
            raise LimitError(f"连接数量不能超过 {MAX_EDGES}")

        raw_blocks = payload.get("blocks")
        if raw_blocks is not None:
            if not isinstance(raw_blocks, list):
                raise ValidationError("场景 blocks 必须是数组")
            store = BlockStore()
            store.load_payloads(raw_blocks)
            self.blocks = store

        self.mode = mode
        self.integration = integration
        nodes: dict[str, NodeRecord] = {}
        edges: dict[str, EdgeRecord] = {}

        for index, raw in enumerate(raw_nodes):
            if not isinstance(raw, dict):
                raise ValidationError(f"第 {index + 1} 个节点不是对象")
            name = check_name(raw.get("name"), f"第 {index + 1} 个节点名称")
            if any(record.name == name for record in nodes.values()):
                raise ConflictError(f"节点名称 {name!r} 重复")
            kind = raw.get("kind", "manual")
            if not isinstance(kind, str):
                raise ValidationError("节点 kind 必须是字符串")
            params = self._normalize_node_params(kind, raw.get("params"))
            data = json_safe(raw.get("data") or {}, where=f"节点 {name!r} 的数据")
            state = json_safe(raw.get("state") or {}, where=f"节点 {name!r} 的状态")
            position = self._position(raw.get("position"))
            node_id = raw.get("id")
            identifier = (
                check_id(node_id, "节点 id") if node_id else uuid.uuid4().hex[:12]
            )
            if identifier in nodes:
                raise ConflictError(f"节点 id {identifier!r} 重复")
            nodes[identifier] = NodeRecord(
                id=identifier,
                name=name,
                kind=kind,
                params=params[0],
                data=data,
                state=state,
                inputs={},
                position=position,
                size=self._node_size(raw.get("size")),
            )

        for index, raw in enumerate(raw_edges):
            if not isinstance(raw, dict):
                raise ValidationError(f"第 {index + 1} 条连接不是对象")
            if raw.get("pins") is not None:
                from .schematic import apply_pin_bindings

                raw = apply_pin_bindings(
                    {
                        "kind": raw.get("kind"),
                        "source": raw.get("source"),
                        "target": raw.get("target"),
                        "params": raw.get("params") or {},
                        "pins": raw.get("pins"),
                    }
                )
            source_id = check_id(raw.get("source"), "起点 id")
            target_id = check_id(raw.get("target"), "终点 id")
            if source_id not in nodes or target_id not in nodes:
                raise ValidationError(f"第 {index + 1} 条连接的端点不存在")
            kind = raw.get("kind")
            if not isinstance(kind, str):
                raise ValidationError("连接 kind 必须是字符串")
            params = self._normalize_edge_params(kind, raw.get("params"))
            source_pin, target_pin = self._normalize_wire_pins(
                kind,
                source_id,
                target_id,
                raw.get("source_pin", ""),
                raw.get("target_pin", ""),
                nodes,
            )
            source_port, target_port = self._normalize_signal_ports(
                kind,
                source_id,
                target_id,
                raw.get("source_port", ""),
                raw.get("target_port", ""),
                nodes,
            )
            name = (
                check_name(raw["name"], "连接名称")
                if raw.get("name")
                else f"{kind}-{index + 1}"
            )
            if any(record.name == name for record in edges.values()):
                raise ConflictError(f"连接名称 {name!r} 重复")
            state = json_safe(raw.get("state") or {}, where=f"连接 {name!r} 的状态")
            delay = bool(raw.get("delay", False))
            enabled = bool(raw.get("enabled", True))
            if mode == "circuit":
                delay = False
                if source_id == target_id:
                    raise ValidationError("元件两端不能是同一个节点")
            identifier = (
                check_id(raw.get("id"), "连接 id")
                if raw.get("id")
                else uuid.uuid4().hex[:12]
            )
            if identifier in edges:
                raise ConflictError(f"连接 id {identifier!r} 重复")
            edges[identifier] = EdgeRecord(
                id=identifier,
                name=name,
                source=source_id,
                target=target_id,
                kind=kind,
                params=params,
                state=state,
                delay=delay,
                enabled=enabled,
                route=self._edge_route(raw.get("route")),
                waypoints=self._edge_waypoints(raw.get("waypoints")),
                anchors=self._edge_anchors(raw.get("anchors")),
                layout=self._edge_layout(raw.get("layout")),
                source_pin=source_pin,
                target_pin=target_pin,
                source_port=source_port,
                target_port=target_port,
            )

        if mode == "signal":
            # 导入时若存在代数环，自动把最后一条相关连接标记为延迟。
            for edge in edges.values():
                if edge.delay or not edge.enabled:
                    continue
                adjacency: dict[str, list[str]] = {key: [] for key in nodes}
                for other in edges.values():
                    if other.id == edge.id or other.delay or not other.enabled:
                        continue
                    adjacency[other.source].append(other.target)
                stack = [edge.target]
                seen = {edge.target}
                cyclic = edge.source == edge.target
                while stack and not cyclic:
                    current = stack.pop()
                    for neighbour in adjacency.get(current, ()):
                        if neighbour == edge.source:
                            cyclic = True
                            break
                        if neighbour not in seen:
                            seen.add(neighbour)
                            stack.append(neighbour)
                if cyclic:
                    edge.delay = True

        for record in nodes.values():
            if record.kind != "block":
                continue
            block_id = str(record.params.get("block_id") or "")
            if not block_id or self.blocks.get(block_id) is None:
                raise ValidationError(
                    f"节点 {record.name!r} 引用的功能块不存在：{block_id!r}"
                    "；请删除该节点后用模块库重新实例化，或把对应模块文件补回库中"
                )
            self._check_block_mode("block", {"block_id": block_id}, node_id=record.id)

        self.nodes = nodes
        self.edges = edges
        self.block_instances = {}
        self._counter = len(edges)
        self._engine = None
        self._dirty = True
        self.revision += 1

    # ---- 元数据 -----------------------------------------------------------
    def catalog(self) -> dict[str, Any]:
        return {
            "modes": [
                {"value": "signal", "label": "信号流", "description": "字典沿有向边传播"},
                {
                    "value": "circuit",
                    "label": "电路",
                    "description": "节点电压法求解，支持反馈与双向元件",
                },
                {
                    "value": "vector",
                    "label": "矢量",
                    "description": "二维矢量场与非线性动态源，支持扩散耦合",
                },
            ],
            "computes": compute_catalog(),
            "methods": method_catalog(),
            "elements": element_catalog(),
            "circuit_nodes": node_catalog(),
            "integration": integration_methods(),
            "limits": {
                "nodes": MAX_NODES,
                "edges": MAX_EDGES,
                "fields": MAX_FIELDS,
            },
        }
