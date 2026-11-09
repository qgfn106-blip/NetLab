"""场景层：把可序列化的节点/连接记录装配成可运行的仿真引擎。

信号模式使用 ``graph.Network``（字典沿有向边传播）；电路模式使用
``nodal.CircuitSolver``（节点电压法）。两种模式对外暴露相同的
``step / reset / probes / stats`` 接口，供仿真循环与 HTTP 层复用。
"""

from __future__ import annotations

import copy
import math
import re
import time
import uuid
from typing import Any

from .blocks import BlockRuntime, BlockStore
from .channels import ChannelKey
from .records import EdgeRecord, NodeRecord
from ..compute.clock import SimClock
from ..compute.computes import (
    compute_catalog,
    get_compute_spec,
    prepare_compute,
    solver_traits,
)
from .graph import Network, Node
from ..common.limits import (
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
from ..compute.methods import (
    get_method_spec,
    method_catalog,
    prepare_method,
)
from ..compute.nodal import (
    CircuitNode,
    CircuitSolver,
    create_element,
    create_element_from_pins,
    element_catalog,
    element_spec,
    integration_methods,
    node_catalog,
)
from ..compute.params import validate_params
from .ports import pins_for_device
from ..compute.profiling import timed
class _Engine:
    def step(self, dt: float, deadline: float | None = None) -> None:  # pragma: no cover - 抽象
        raise NotImplementedError

    def reset(self) -> None:  # pragma: no cover - 抽象
        raise NotImplementedError

    def zero_time(self) -> None:  # pragma: no cover - 抽象
        """只把内核时间轴归零，不清除状态（R11）。"""
        raise NotImplementedError

    def probes(self, *, by_id: bool = False) -> dict[str, float]:  # pragma: no cover - 抽象
        raise NotImplementedError

    def stats(self) -> dict[str, Any]:  # pragma: no cover - 抽象
        raise NotImplementedError


class SignalEngine(_Engine):
    def __init__(self, scene: "Scene") -> None:
        self.network = Network(
            solve_algebraic=bool(getattr(scene, "solve_algebraic", False)),
            clock=scene.clock,
        )
        self.node_map: dict[str, Node] = {}
        self.edge_map: dict[str, Any] = {}
        self.scene = scene
        # 功能块实例：每个实例拥有独立的内部场景与 state。
        self.block_runtimes: dict[str, BlockRuntime] = {}
        self.block_buffers: dict[str, dict[str, dict[str, Any]]] = {}
        #: N-36：最近一步开始前的功能块快照，供超时回滚复用。
        self._last_block_snapshots: dict[str, Any] = {}
        for record in scene.nodes.values():
            try:
                _spec, params, handler = prepare_compute(record.kind, record.params)
            except Exception as exc:
                raise ComputeError(
                    f"节点 {record.name!r} 的计算方式无法装配：{exc}"
                ) from exc
            traits = solver_traits(record.kind, params)
            node = Node(
                name=record.name,
                data=record.data,
                kind=record.kind,
                params=params,
                state=record.state,
                inputs=record.inputs,
                handler=handler,
                trusted=not record.kind.startswith("user."),
                **traits,
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
                auto_delay=record.auto_delay,
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
    def _numeric_payload(data: dict[str, Any], limit: int = 32) -> dict[str, Any]:
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
        for stale in [
            key for key in self.scene.block_instances if key not in block_node_ids
        ]:
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
            internal_sim = bool(params.get("internal_sim", False))
            input_nodes = params.get("input_nodes") or {}
            output_nodes = params.get("output_nodes") or {}
            if not isinstance(input_nodes, dict) or not isinstance(output_nodes, dict):
                raise ComputeError(f"功能块节点 {record.name!r} 的端口映射必须是对象")
            # 复用已存在的实例：结构变化导致引擎重建时，块内部 state 不应被清空。
            runtime = self.scene.block_instances.get(record.id)
            if (
                runtime is None
                or runtime.block is not block
                or runtime.depth != self.scene.block_depth
                or runtime.internal_sim != internal_sim
            ):
                runtime = BlockRuntime(
                    block,
                    self.scene.blocks,
                    depth=self.scene.block_depth,
                    internal_sim=internal_sim,
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

    def rollback_last_step(self) -> None:
        """N-36：回滚最近一步（网络快照 + 功能块快照），不重新全量深拷贝。"""
        for block_id, snapshot in self._last_block_snapshots.items():
            runtime = self.block_runtimes.get(block_id)
            if runtime is not None:
                runtime.restore_checkpoint(snapshot)
        self.network.restore_last_step_state()

    def step(self, dt: float, deadline: float | None = None) -> None:
        # 整步事务：网络层已回滚节点/连接，功能块内部场景另行快照，
        # 保证块内 state（积分器、滤波器记忆等）在失败时一起回退。
        self._last_block_snapshots = {
            block_id: runtime.capture_checkpoint()
            for block_id, runtime in self.block_runtimes.items()
        }
        try:
            self.network.step(dt)
        except BaseException:
            self.rollback_last_step()
            raise

    def zero_time(self) -> None:
        self.network.time = 0.0

    def reset(self) -> None:
        for runtime in self.block_runtimes.values():
            runtime.reset()
        for buffer in self.block_buffers.values():
            buffer.clear()
        self.network.reset_state()

    def probes(self, *, by_id: bool = False) -> dict[str, float]:
        values: dict[str, float] = {}
        for record in self.scene.nodes.values():
            ident = record.id if by_id else record.name
            count = 0
            for key, value in record.data.items():
                if count >= 6:
                    break
                if (
                    isinstance(value, (int, float))
                    and not isinstance(value, bool)
                    and math.isfinite(float(value))
                ):
                    values[str(ChannelKey.node(ident, str(key)))] = float(value)
                    count += 1
        for record in self.scene.edges.values():
            connection = self.edge_map.get(record.id)
            if connection is None:
                continue
            ident = record.id if by_id else record.name
            count = 0
            for key, value in connection.output.items():
                if count >= 4:
                    break
                if (
                    isinstance(value, (int, float))
                    and not isinstance(value, bool)
                    and math.isfinite(float(value))
                ):
                    values[str(ChannelKey.edge(ident, str(key)))] = float(value)
                    count += 1
        # R36/P5：把节点内部状态暴露成相平面可选通道。状态空间用
        # state:<node>:<index>，积分器/延迟等标量状态用 state:<node>:<key>。
        for record in self.scene.nodes.values():
            node = self.node_map.get(record.id)
            if node is None:
                continue
            ident = record.id if by_id else record.name
            for key, value in node.state.items():
                if isinstance(value, (list, tuple)):
                    for index, item in enumerate(value):
                        if (
                            isinstance(item, (int, float))
                            and not isinstance(item, bool)
                            and math.isfinite(float(item))
                        ):
                            values[str(ChannelKey.state(ident, str(index)))] = float(item)
                elif (
                    isinstance(value, (int, float))
                    and not isinstance(value, bool)
                    and math.isfinite(float(value))
                ):
                    values[str(ChannelKey.state(ident, str(key)))] = float(value)
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
        from ..compute.circuit_modules import flatten_circuit

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
            node_id
            for node_id, record in net_records.items()
            if record.kind == "ground"
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
                raise ComputeError(f"元件 {record.name!r} 无法装配：{exc}") from exc
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
                if (
                    missing
                    and kind in ("vsource", "isource")
                    and pins
                    and len(missing) == 1
                ):
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
                raise ComputeError(f"器件 {record.name!r} 无法装配：{exc}") from exc
            elements.append(element)
            self.element_map[record.id] = element
            used_roots.update((element.a, element.b))
            used_roots.update(pins.values())
        # R21/D43：与未参与器件相连、实际没有任何元件引脚的孤立网络不进入 MNA
        # （否则会被判“悬空”而挡住运行）；它们保持 0 V，不参与求解。
        used_roots.add(ground_root)
        nodes = [node for node in nodes if node.id in used_roots]
        self.solver = CircuitSolver(
            nodes,
            elements,
            integration=scene.integration,
            options=getattr(scene, "solver_options", None),
            clock=scene.clock,
        )
        # R31/P11-05：跨域桥元素。sensor 在 MNA 解后采样，actuator 在下一拍
        # MNA 前读取 sensor/控制节点数据，显式一拍延迟，不形成代数环。
        self.bridge_sensors: list[tuple[NodeRecord, Any]] = []
        self.bridge_actuators: list[tuple[NodeRecord, Any]] = []
        #: N-36：最近一步的节点 data 浅快照；电路 step 会写回电压/传感器值。
        self._last_step_data_snapshot: dict[str, dict[str, Any]] = {}
        for record in all_nodes.values():
            if record.kind != "device":
                continue
            element = self.element_map.get(record.id)
            if element is None:
                continue
            kind = str(record.params.get("element") or "")
            if kind in ("sensor", "if_voltage_to_signal"):
                self.bridge_sensors.append((record, element))
            elif kind in ("actuator", "if_signal_to_current"):
                self.bridge_actuators.append((record, element))

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

    def _apply_bridge_actuators(self) -> None:
        """R31/P11-05：把上一拍信号字段写入受控电压源。"""
        by_name = {record.name: record for record in self.scene.nodes.values()}
        for record, element in self.bridge_actuators:
            source = str(record.params.get("source") or "").strip()
            value = 0.0
            if source:
                node_name, _, field = source.partition(".")
                source_node = by_name.get(node_name)
                if source_node is not None:
                    try:
                        value = float(source_node.data.get(field or "voltage", 0.0))
                    except (TypeError, ValueError):
                        value = 0.0
            try:
                gain = float(record.params.get("gain", 1.0))
                offset = float(record.params.get("offset", 0.0))
            except (TypeError, ValueError):
                gain, offset = 1.0, 0.0
            element.state["drive"] = gain * value + offset

    def _sample_bridge_sensors(self) -> None:
        """R31/P11-05：MNA 解后采样，供下一拍控制/驱动读取。"""
        for record, element in self.bridge_sensors:
            voltage = float(
                self.solver.node_voltages.get(element.a, 0.0)
                - self.solver.node_voltages.get(element.b, 0.0)
            )
            signal = str(record.params.get("signal") or "voltage")
            record.data[signal] = voltage
            record.data["voltage"] = voltage

    def step(self, dt: float, deadline: float | None = None) -> None:
        # N-36：只保存会被 step 写回的 data，而不是整套 Scene 深拷贝。
        self._last_step_data_snapshot = {
            record.id: dict(record.data) for record in self.scene.nodes.values()
        }
        try:
            self._apply_bridge_actuators()
            self.solver.step(dt, deadline=deadline)
            for record in self.scene.nodes.values():
                if record.kind == "device":
                    continue
                root = self.net_root.get(record.id, record.id)
                record.data["voltage"] = float(
                    self.solver.node_voltages.get(root, 0.0)
                )
            self._sample_bridge_sensors()
        except BaseException:
            self.rollback_last_step()
            raise

    def rollback_last_step(self) -> None:
        """N-36：回滚求解器与节点 data 到最近一步开始前。"""
        self.solver.restore_last_step_checkpoint()
        for record in self.scene.nodes.values():
            row = self._last_step_data_snapshot.get(record.id)
            if row is not None:
                record.data.clear()
                record.data.update(row)

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

    def probes(self, *, by_id: bool = False) -> dict[str, float]:
        values: dict[str, float] = {}
        for record in self.scene.nodes.values():
            root = self.net_root.get(record.id, record.id)
            voltage = self.solver.node_voltages.get(root, 0.0)
            ident = record.id if by_id else record.name
            values[f"n:{ident}:voltage"] = float(voltage)
        for record in self.scene.edges.values():
            element = self.element_map.get(record.id)
            if element is None:
                continue
            ident = record.id if by_id else record.name
            for key in ("current", "voltage_difference", "power"):
                value = element.state.get(key)
                if isinstance(value, (int, float)) and math.isfinite(float(value)):
                    values[str(ChannelKey.edge(ident, str(key)))] = float(value)
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
