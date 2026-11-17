"""P2-A（P1）：CompiledModel 静态编译产物契约层（只读、不接线）。

P1 只建立**不可变静态数据结构**，不含：
- Scene / Engine / NodeRecord / EdgeRecord 等可变引用；
- 动态 Runtime 状态、handler 实例、执行计划落地；
- create_runtime 实现（Runtime 实例化属后续 P2/P3）。

契约（与运行时接口分离）：
- ``compile_from_records(mode, nodes, edges, order)`` 生成 ``CompiledModel``；
- ``CompiledModel`` 为冻结数据类，可被多次独立引用（不可变，安全共享）；
- 运行时工厂接口见 ``RuntimeFactoryProtocol`` / ``RuntimeProtocol``（仅类型契约，本阶段不实现）。
"""
from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Protocol, runtime_checkable

from .instance_model import EdgeDesc, NodeDesc


@dataclass(frozen=True)
class CompiledModel:
    """不可变静态编译产物。**不持有** Scene/Engine/NodeRecord 实例，不含任何运行态。"""

    mode: str
    nodes: tuple[NodeDesc, ...]
    edges: tuple[EdgeDesc, ...]
    order: tuple[str, ...]
    fingerprint: str

    def __post_init__(self) -> None:
        if not isinstance(self.mode, str) or not self.mode:
            raise ValueError("CompiledModel.mode 必须是非空字符串")
        if not isinstance(self.nodes, tuple) or not all(isinstance(n, NodeDesc) for n in self.nodes):
            raise TypeError("CompiledModel.nodes 必须是 tuple[NodeDesc,...]")
        if not isinstance(self.edges, tuple) or not all(isinstance(e, EdgeDesc) for e in self.edges):
            raise TypeError("CompiledModel.edges 必须是 tuple[EdgeDesc,...]")
        if not isinstance(self.order, tuple) or not all(isinstance(x, str) for x in self.order):
            raise TypeError("CompiledModel.order 必须是 tuple[str,...]")
        ids = [n.id for n in self.nodes]
        if len(set(ids)) != len(ids):
            raise ValueError("CompiledModel 节点 id 重复")
        if set(self.order) != set(ids) or len(self.order) != len(ids):
            raise ValueError("CompiledModel.order 必须恰好覆盖所有节点 id（不重不漏）")
        if not isinstance(self.fingerprint, str) or not self.fingerprint:
            raise ValueError("CompiledModel.fingerprint 必须是非空字符串")

    def node_map(self) -> Mapping[str, NodeDesc]:
        """只读 id→NodeDesc 映射（MappingProxyType，不可改底层）。"""
        return MappingProxyType({n.id: n for n in self.nodes})

    def edge_map(self) -> Mapping[str, EdgeDesc]:
        return MappingProxyType({e.id: e for e in self.edges})

    def to_dict(self) -> dict[str, Any]:
        """导出为独立普通字典（深拷贝，无共享可变引用）。"""
        return {
            "mode": self.mode,
            "nodes": [n.to_fields() for n in self.nodes],
            "edges": [e.to_fields() for e in self.edges],
            "order": list(self.order),
            "fingerprint": self.fingerprint,
        }


def _fingerprint(mode: str, nodes: tuple[NodeDesc, ...], edges: tuple[EdgeDesc, ...]) -> str:
    payload = {
        "mode": mode,
        "nodes": sorted((n.to_fields() for n in nodes), key=lambda d: d["id"]),
        "edges": sorted((e.to_fields() for e in edges), key=lambda d: d["id"]),
    }
    blob = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def compile_from_records(
    mode: str,
    nodes: Iterable[Any],
    edges: Iterable[Any],
    order: Iterable[str] | None = None,
) -> CompiledModel:
    """从 NodeRecord/EdgeRecord 生成不可变 CompiledModel（P1 静态产物，不接线）。"""
    node_descs = tuple(NodeDesc.from_record(n) for n in nodes)
    edge_descs = tuple(EdgeDesc.from_record(e) for e in edges)
    node_ids = [n.id for n in node_descs]
    if order is None:
        order_tuple = tuple(node_ids)
    else:
        order_tuple = tuple(str(x) for x in order)
    return CompiledModel(
        mode=mode,
        nodes=node_descs,
        edges=edge_descs,
        order=order_tuple,
        fingerprint=_fingerprint(mode, node_descs, edge_descs),
    )


@runtime_checkable
class RuntimeProtocol(Protocol):
    """运行态最小契约（P2/P3 实现；本阶段仅类型）。"""

    def step(self, dt: float) -> None: ...

    def snapshot(self) -> Any: ...

    def restore(self, snapshot: Any) -> None: ...

    def reset(self) -> None: ...

    def probes(self) -> Mapping[str, float]: ...

    def dispose(self) -> None: ...


class RuntimeFactoryProtocol(Protocol):
    """编译产物 → Runtime 工厂契约（与编译接口分离，本阶段不实现）。"""

    def create_runtime(self) -> RuntimeProtocol: ...
