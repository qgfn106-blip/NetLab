"""有向节点/连接图：字典数据在节点之间流动。

这是原始示例的扩展版本，保留 ``Node.compute(inputs, data)`` 与
``Connection.method(source, target, params, state, dt)`` 两套回调签名，
同时增加：

* 节点 ``kind`` / ``params`` / ``state``，供可视化界面按注册表装配；
* 连接的 ``delay`` 标记：延迟边不参与拓扑排序，用上一步的输出切断代数环；
* 每步开始清空 ``inputs``，避免残留旧连接的数据；
* 数据隔离：回调拿到的是深拷贝后的输入、只读的参数与数据视图。
"""

from __future__ import annotations

import copy
import math
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Callable, Mapping

from .profiling import timed
from .limits import (
    ComputeError,
    ConflictError,
    NetlabError,
    NotFoundError,
    ValidationError,
    json_safe,
)

NodeData = dict[str, Any]
NodeInputs = dict[str, NodeData]
NodeCompute = Callable[[NodeInputs, NodeData], NodeData]
ConnectionCompute = Callable[
    ["NodeView", "NodeView", Mapping[str, Any], dict[str, Any], float], NodeData
]


def _fast_result(result: dict[str, Any], *, where: str) -> dict[str, Any]:
    """内置 handler 的快速结果校验：只做 JSON 标量检查，不做深拷贝。

    内置 handler 每次都会返回新字典，且只写入有限数值/布尔/短字符串；
    一旦出现嵌套结构就退回 ``json_safe``，保持与用户代码相同的安全边界。
    """
    cleaned: dict[str, Any] = {}
    for key, value in result.items():
        if not isinstance(key, str) or not key:
            raise ValidationError(f"{where}的键必须是非空字符串")
        if len(key) > 32:
            raise ValidationError(f"{where}中的键过长")
        if value is None or isinstance(value, bool):
            cleaned[key] = value
        elif isinstance(value, (int, float)):
            number = float(value)
            if not math.isfinite(number):
                raise ValidationError(f"{where}中不允许 NaN 或无穷大")
            if abs(number) > 1.0e15:
                raise ValidationError(f"{where}中的数值超出范围（|x| ≤ 1e+15）")
            cleaned[key] = value
        elif isinstance(value, str):
            if len(value) > 400:
                raise ValidationError(f"{where}中的字符串过长")
            cleaned[key] = value
        else:
            return json_safe(result, where=where)
    return cleaned


def _state_snapshot(state: Mapping[str, Any]) -> dict[str, Any]:
    """状态快照：优先深拷贝，遇到不可拷贝的自定义对象时退回浅拷贝。

    用户扩展的 handler / 连接函数可能在 state 里放任意对象；深拷贝失败不应该
    让整步无法回滚，因此逐步降级，并在浅拷贝时仍然是「新字典」以避免快照
    被后续原地修改污染。
    """
    try:
        return copy.deepcopy(dict(state))
    except Exception:  # 不可深拷贝的对象：退回浅拷贝，至少保证字典身份独立
        return dict(state)


@dataclass(frozen=True, slots=True)
class NodeView:
    """传给连接函数的只读节点视图：``.name`` 与 ``.data``。"""

    name: str
    data: Mapping[str, Any]


@dataclass(slots=True)
class ComputeContext:
    """注册表驱动的节点计算上下文。``inputs`` 与 ``data`` 均为副本。"""

    name: str
    inputs: NodeInputs
    data: NodeData
    state: dict[str, Any]
    params: dict[str, Any]
    dt: float
    time: float
    #: R20/Q8：按目标端口分组的入边载荷（target_port → payload）。
    ports: NodeInputs = field(default_factory=dict)


@dataclass(eq=False)
class Node:
    name: str
    data: NodeData = field(default_factory=dict)
    compute: NodeCompute | None = None
    # 每条入边一个键，值为该边本步输出的字典。
    inputs: NodeInputs = field(default_factory=dict)
    #: R20/Q8：按目标端口分组的入边载荷。
    ports: NodeInputs = field(default_factory=dict)
    kind: str = "manual"
    params: dict[str, Any] = field(default_factory=dict)
    state: dict[str, Any] = field(default_factory=dict)
    handler: Callable[[ComputeContext], NodeData] | None = field(
        default=None, repr=False, compare=False
    )
    # 内置 handler 已审计、不会修改入参；走浅拷贝快路径。用户扩展必须为 False。
    trusted: bool = field(default=False, repr=False, compare=False)
    _view: NodeView | None = field(default=None, repr=False, compare=False)

    def __post_init__(self) -> None:
        # data 与 state 保持引用语义：场景记录与运行时对象共享同一份字典，
        # 这样每一步的结果都能直接回写，界面无需额外同步。
        if self.data is None:
            self.data = {}
        if self.state is None:
            self.state = {}
        self.params = dict(self.params)
        if self.inputs is None:
            self.inputs = {}
        self._view = NodeView(self.name, MappingProxyType(self.data))

    @property
    def view(self) -> NodeView:
        """缓存的只读视图；``MappingProxyType`` 会实时反映 data 的更新。"""
        if self._view is None:
            self._view = NodeView(self.name, MappingProxyType(self.data))
        return self._view

    def set_data(self, values: NodeData, *, replace: bool = False) -> None:
        """写入节点数据；默认按键合并，``replace=True`` 时整体替换。"""
        if not isinstance(values, dict):
            raise TypeError("node data must be a dict")
        if replace:
            self.data = dict(values)
            self._view = NodeView(self.name, MappingProxyType(self.data))
        else:
            self.data.update(values)

    def update(self, dt: float = 1.0, time: float = 0.0) -> None:
        """计算一个字典差分并合并进 ``data``。没有计算方式时什么也不做。"""
        if self.compute is None and self.handler is None:
            return

        if self.compute is not None:
            # 兼容原始回调：无法证明其只读，始终深拷贝。
            inputs_copy = {
                key: copy.deepcopy(payload) for key, payload in self.inputs.items()
            }
            ports_copy = {
                key: copy.deepcopy(payload) for key, payload in self.ports.items()
            }
            data_copy = copy.deepcopy(self.data)
            trusted = False
        elif self.trusted:
            # 内置 handler 不修改入参；输入字典是每条边新生成的，data 用浅拷贝。
            inputs_copy = self.inputs
            ports_copy = self.ports
            data_copy = dict(self.data)
            trusted = True
        else:
            inputs_copy = {
                key: copy.deepcopy(payload) for key, payload in self.inputs.items()
            }
            ports_copy = {
                key: copy.deepcopy(payload) for key, payload in self.ports.items()
            }
            data_copy = copy.deepcopy(self.data)
            trusted = False

        # S-04：用户 handler 的 state 同样是隔离副本，失败时不能留下半改状态。
        state_arg = self.state if trusted else _state_snapshot(self.state)

        try:
            if self.compute is not None:
                result = self.compute(inputs_copy, data_copy)
            else:
                assert self.handler is not None
                result = self.handler(
                    ComputeContext(
                        name=self.name,
                        inputs=inputs_copy,
                        data=data_copy,
                        state=state_arg,
                        params=self.params,
                        dt=dt,
                        time=time,
                        ports=ports_copy,
                    )
                )
        except NetlabError:
            raise
        except Exception as exc:  # 用户回调的异常附上节点名，便于定位
            raise ComputeError(f"节点 {self.name!r} 计算失败：{exc}") from exc

        if not isinstance(result, dict):
            raise ComputeError(f"节点 {self.name!r} 的计算结果必须是字典")
        if trusted:
            clean = _fast_result(
                result, where=f"节点 {self.name!r} 的计算结果"
            )
        else:
            clean = json_safe(result, where=f"节点 {self.name!r} 的计算结果")
        if state_arg is not self.state:
            # 隔离副本验证通过后原地回写，保持 state 字典身份（记录与运行时共享）。
            self.state.clear()
            self.state.update(state_arg)
        self.data.update(clean)


@dataclass(eq=False)
class Connection:
    name: str
    source: Node
    target: Node
    method: ConnectionCompute
    params: dict[str, Any] = field(default_factory=dict)
    state: dict[str, Any] = field(default_factory=dict)
    kind: str = "custom"
    delay: bool = False
    enabled: bool = True
    #: R20/Q8：端口绑定（引用源节点输出字段 / 目标节点输入端口）。
    source_port: str = ""
    target_port: str = ""
    output: NodeData = field(default_factory=dict)
    trusted: bool = field(default=False, repr=False, compare=False)
    _params_view: Mapping[str, Any] | None = field(
        default=None, repr=False, compare=False
    )
    _source_params: Mapping[str, Any] | None = field(
        default=None, repr=False, compare=False
    )

    def __post_init__(self) -> None:
        self.params = dict(self.params)
        if self.state is None:
            self.state = {}
        self._params_view = MappingProxyType(self.params)
        if self.source_port:
            override = {
                key: self.source_port
                for key in ("input_key", "input_x", "input_y", "field")
                if key in self.params
            }
            self._source_params = MappingProxyType(
                {**self.params, **override} if override else dict(self.params)
            )
        else:
            self._source_params = self._params_view

    def evaluate(self, dt: float, time: float = 0.0) -> NodeData:
        """调用连接函数并校验返回值；参数与端点数据对函数只读。"""
        # Node.view 与参数视图在构造时缓存；MappingProxyType 会随底层字典更新，
        # 因此每步不必重新分配包装对象。
        try:
            result = self.method(
                self.source.view,
                self.target.view,
                self._source_params or self._params_view or MappingProxyType(self.params),
                self.state,
                dt,
            )
        except NetlabError:
            raise
        except Exception as exc:
            raise ComputeError(f"连接 {self.name!r} 计算失败：{exc}") from exc

        if not isinstance(result, dict):
            raise ComputeError(f"连接 {self.name!r} 的计算结果必须是字典")
        payload = (
            _fast_result(result, where=f"连接 {self.name!r} 的输出")
            if self.trusted
            else json_safe(result, where=f"连接 {self.name!r} 的输出")
        )
        self.output = payload
        return payload


class Network:
    """节点与有向连接组成的网络，按依赖顺序推进一步。"""

    def __init__(self, *, auto_delay: bool = False) -> None:
        self.nodes: list[Node] = []
        self.connections: list[Connection] = []
        self.time = 0.0
        self.auto_delay = auto_delay
        self._order: list[Node] | None = None
        self._incoming: dict[Node, list[Connection]] | None = None
        self._delayed: list[Connection] | None = None

    # ---- 结构维护 ---------------------------------------------------------
    def invalidate(self) -> None:
        self._order = None
        self._incoming = None
        self._delayed = None

    def add_node(self, node: Node) -> Node:
        if node in self.nodes:
            raise ConflictError(f"节点 {node.name!r} 已在该网络中")
        if any(existing.name == node.name for existing in self.nodes):
            raise ConflictError(f"节点名称 {node.name!r} 已被占用")
        self.nodes.append(node)
        self.invalidate()
        return node

    def remove_node(self, node: Node) -> None:
        if node not in self.nodes:
            raise NotFoundError(f"节点 {node.name!r} 不在网络中")
        self.nodes.remove(node)
        self.connections = [
            connection
            for connection in self.connections
            if connection.source is not node and connection.target is not node
        ]
        self.invalidate()

    def node(self, name: str) -> Node | None:
        for node in self.nodes:
            if node.name == name:
                return node
        return None

    def connection(self, name: str) -> Connection | None:
        for connection in self.connections:
            if connection.name == name:
                return connection
        return None

    def connect(
        self,
        name: str,
        source: Node,
        target: Node,
        method: ConnectionCompute,
        *,
        delay: bool = False,
        enabled: bool = True,
        kind: str = "custom",
        state: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        source_port: str = "",
        target_port: str = "",
        **extra: Any,
    ) -> Connection:
        """创建一条有向连接；参数与历史状态只属于这条边。

        ``params`` 可以是字典（推荐，避免与关键字重名），也可以像原示例那样
        直接作为关键字参数传入。
        """
        if source not in self.nodes or target not in self.nodes:
            raise ConflictError("连接的起点与终点都必须属于该网络")
        if any(connection.name == name for connection in self.connections):
            raise ConflictError(f"连接名称 {name!r} 已被占用")
        if not callable(method):
            raise ValidationError("连接计算函数不可调用")

        merged: dict[str, Any] = dict(params or {})
        trusted = bool(extra.pop("_trusted", False))
        merged.update(extra)
        connection = Connection(
            name=name,
            source=source,
            target=target,
            method=method,
            params=json_safe(merged, where="连接参数"),
            state=state if state is not None else {},
            kind=kind,
            delay=delay,
            source_port=str(source_port or ""),
            target_port=str(target_port or ""),
            enabled=enabled,
            trusted=trusted,
        )
        self.connections.append(connection)
        self.invalidate()
        return connection

    def remove_connection(self, connection: Connection) -> None:
        if connection not in self.connections:
            raise NotFoundError(f"连接 {connection.name!r} 不在网络中")
        self.connections.remove(connection)
        self.invalidate()

    def set_delay(self, connection: Connection, delay: bool) -> None:
        connection.delay = bool(delay)
        self.invalidate()

    # ---- 图结构与环检测 ---------------------------------------------------
    def _enabled_edges(self, *, include_delayed: bool) -> list[Connection]:
        return [
            connection
            for connection in self.connections
            if connection.enabled and (include_delayed or not connection.delay)
        ]

    def algebraic_cycles(self) -> list[list[str]]:
        """返回不经过延迟边的强连通分量（即无法按拓扑排序的代数环）。"""
        adjacency: dict[Node, list[Node]] = {node: [] for node in self.nodes}
        for connection in self._enabled_edges(include_delayed=False):
            adjacency[connection.source].append(connection.target)

        index = 0
        indices: dict[Node, int] = {}
        lowlink: dict[Node, int] = {}
        stack: list[Node] = []
        on_stack: set[Node] = set()
        components: list[list[str]] = []

        def strongconnect(node: Node) -> None:
            nonlocal index
            indices[node] = lowlink[node] = index
            index += 1
            stack.append(node)
            on_stack.add(node)
            for neighbour in adjacency[node]:
                if neighbour not in indices:
                    strongconnect(neighbour)
                    lowlink[node] = min(lowlink[node], lowlink[neighbour])
                elif neighbour in on_stack:
                    lowlink[node] = min(lowlink[node], indices[neighbour])
            if lowlink[node] == indices[node]:
                component: list[Node] = []
                while True:
                    member = stack.pop()
                    on_stack.discard(member)
                    component.append(member)
                    if member is node:
                        break
                members = set(component)
                has_self_loop = any(
                    connection.source is connection.target
                    and connection.source in members
                    for connection in self._enabled_edges(include_delayed=False)
                )
                if len(component) > 1 or has_self_loop:
                    components.append([member.name for member in reversed(component)])

        for node in self.nodes:
            if node not in indices:
                strongconnect(node)
        return components

    def topological_order(self) -> list[Node]:
        """按非延迟依赖排序；存在代数环时抛出 ``ComputeError``。"""
        if self._order is not None:
            return self._order

        incoming_count = {node: 0 for node in self.nodes}
        outgoing: dict[Node, list[Node]] = {node: [] for node in self.nodes}
        incoming: dict[Node, list[Connection]] = {node: [] for node in self.nodes}
        for connection in self._enabled_edges(include_delayed=True):
            incoming[connection.target].append(connection)
        for connection in self._enabled_edges(include_delayed=False):
            incoming_count[connection.target] += 1
            outgoing[connection.source].append(connection.target)

        ready = [node for node in self.nodes if incoming_count[node] == 0]
        order: list[Node] = []
        while ready:
            node = ready.pop()
            order.append(node)
            for target in outgoing[node]:
                incoming_count[target] -= 1
                if incoming_count[target] == 0:
                    ready.append(target)

        if len(order) != len(self.nodes):
            cycles = self.algebraic_cycles()
            detail = "、".join("→".join(cycle + [cycle[0]]) for cycle in cycles[:3])
            raise ComputeError(
                "网络中存在代数环"
                + (f"（{detail}）" if detail else "")
                + "：请把环上的一条连接设为“单步延迟”，或在电路模式下求解"
            )

        self._order = order
        self._incoming = incoming
        self._delayed = self._enabled_edges(include_delayed=True)
        self._delayed = [
            connection for connection in self._delayed if connection.delay
        ]
        return order

    @timed("network.step")
    def step(self, dt: float = 1.0) -> None:
        """按依赖顺序推进一拍：每条连接求值一次，每个节点更新一次。

        S-01/S-02/S-03：整步是事务——步首记录时间、节点数据/状态/输入与连接
        状态/输出快照；任何一步抛错都回滚到步首再向上抛，避免「半个网络已
        推进」的半改状态（重试与干净运行因此结果一致）。
        """
        if not isinstance(dt, (int, float)) or isinstance(dt, bool):
            raise ValidationError("dt 必须是数字")
        if not math.isfinite(dt) or dt <= 0:
            raise ValidationError("dt 必须为正的有限数")

        order = self.topological_order()
        assert self._incoming is not None
        snapshot = self.capture_step_state()
        try:
            delayed_edges = self._delayed or ()
            # 延迟边在步首统一求值：此时所有节点都还是上一拍的值，
            # 因此输出严格等于 z⁻¹·x，且与节点处理顺序无关。
            delayed_payloads: dict[Connection, NodeData] = {}
            for connection in delayed_edges:
                delayed_payloads[connection] = connection.evaluate(
                    dt, time=self.time + dt
                )
            for node in order:
                node.inputs.clear()
                node.ports.clear()
                for connection in self._incoming.get(node, ()):
                    if connection.delay:
                        payload = delayed_payloads.get(connection)
                        if payload is None:
                            continue
                    else:
                        payload = connection.evaluate(dt, time=self.time + dt)
                    node.inputs[connection.name] = payload
                    if connection.target_port:
                        node.ports[connection.target_port] = payload
                node.update(dt, time=self.time + dt)
            self.time += dt
        except BaseException:
            self.restore_step_state(snapshot)
            raise

    def capture_step_state(self) -> dict[str, Any]:
        """记录整步事务快照（时间、节点数据/状态/输入、连接状态/输出）。"""
        return {
            "time": self.time,
            "nodes": {
                node: (
                    dict(node.data),
                    _state_snapshot(node.state),
                    dict(node.inputs),
                    dict(node.ports),
                )
                for node in self.nodes
            },
            "connections": {
                connection: (
                    _state_snapshot(connection.state),
                    dict(connection.output),
                )
                for connection in self.connections
            },
        }

    def restore_step_state(self, snapshot: Mapping[str, Any]) -> None:
        """原地回滚到 :meth:`capture_step_state` 记录的状态。"""
        self.time = snapshot["time"]
        for node, (data, state, inputs, ports) in snapshot["nodes"].items():
            node.data.clear()
            node.data.update(data)
            node.state.clear()
            node.state.update(state)
            node.inputs.clear()
            node.inputs.update(inputs)
            node.ports.clear()
            node.ports.update(ports)
        for connection, (state, output) in snapshot["connections"].items():
            connection.state.clear()
            connection.state.update(state)
            connection.output = output

    def reset_state(self) -> None:
        """清空所有历史状态与输入快照，但保留拓扑与参数。"""
        for node in self.nodes:
            node.state.clear()
            node.inputs.clear()
        for connection in self.connections:
            connection.state.clear()
            connection.output = {}
        self.time = 0.0

    def __repr__(self) -> str:  # pragma: no cover - 调试辅助
        return (
            f"Network(nodes={len(self.nodes)}, "
            f"connections={len(self.connections)}, time={self.time:.3f})"
        )
