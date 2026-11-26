"""Model：权威、声明式、深层可靠的不可变模型层。

Model 只包含静态描述（mode / integration / solve_algebraic / NodeDesc / EdgeDesc /
功能块定义），不依赖 Runtime、不持有运行态，可序列化、深拷贝、相等比较与指纹。
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any, Mapping

from .instance_model import (
    EdgeDesc,
    FrozenMapping,
    FrozenSequence,
    NodeDesc,
    canonical_json,
    deep_freeze,
    deep_thaw,
    stable_fingerprint,
)


@dataclass(frozen=True)
class Model:
    """不可变模型：静态描述的单一权威来源，不含任何 Runtime 状态。"""

    mode: str
    integration: str = "trapezoidal"
    solve_algebraic: bool = False
    nodes: tuple[NodeDesc, ...] = ()
    edges: tuple[EdgeDesc, ...] = ()
    blocks: FrozenSequence = field(default_factory=lambda: FrozenSequence())
    fingerprint: str = ""
    source_revision: int = 0

    def __post_init__(self) -> None:
        object.__setattr__(self, "mode", str(self.mode))
        object.__setattr__(self, "integration", str(self.integration))
        object.__setattr__(self, "solve_algebraic", bool(self.solve_algebraic))
        object.__setattr__(self, "nodes", tuple(self.nodes))
        object.__setattr__(self, "edges", tuple(self.edges))
        if not isinstance(self.blocks, FrozenSequence):
            object.__setattr__(self, "blocks", FrozenSequence(self.blocks or ()))
        for node in self.nodes:
            if not isinstance(node, NodeDesc):
                raise TypeError("Model.nodes 只能包含 NodeDesc")
        for edge in self.edges:
            if not isinstance(edge, EdgeDesc):
                raise TypeError("Model.edges 只能包含 EdgeDesc")
        if not self.fingerprint:
            object.__setattr__(self, "fingerprint", stable_fingerprint(self._fingerprint_payload()))

    @classmethod
    def from_scene(cls, scene: Any) -> "Model":
        """从 Scene 捕获静态模型；排除 NodeRecord.state / inputs 等运行态字段。"""
        payload = scene.to_payload(include_state=False, authored_data=True)
        return cls.from_payload(payload, source_revision=int(getattr(scene, "revision", 0) or 0))

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any], *, source_revision: int = 0) -> "Model":
        if not isinstance(payload, Mapping):
            raise TypeError("Model.from_payload 需要 Mapping")
        raw_nodes = payload.get("nodes") or []
        raw_edges = payload.get("edges") or []
        if not isinstance(raw_nodes, (list, tuple)) or not isinstance(raw_edges, (list, tuple)):
            raise TypeError("Model payload 的 nodes/edges 必须是数组")
        nodes = tuple(NodeDesc.from_payload(item) for item in raw_nodes if isinstance(item, Mapping))
        edges = tuple(EdgeDesc.from_payload(item) for item in raw_edges if isinstance(item, Mapping))
        return cls(
            mode=str(payload.get("mode", "signal")),
            integration=str(payload.get("integration", "trapezoidal")),
            solve_algebraic=bool(payload.get("solve_algebraic", False)),
            nodes=nodes,
            edges=edges,
            blocks=deep_freeze(payload.get("blocks") or []),
            source_revision=source_revision,
        )

    def _fingerprint_payload(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "integration": self.integration,
            "solve_algebraic": self.solve_algebraic,
            "nodes": [node.to_model_fields() for node in self.nodes],
            "edges": [edge.to_model_fields() for edge in self.edges],
            "blocks": deep_thaw(self.blocks),
        }

    def to_payload(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "integration": self.integration,
            "solve_algebraic": self.solve_algebraic,
            "nodes": [node.to_model_fields() for node in self.nodes],
            "edges": [edge.to_model_fields() for edge in self.edges],
            "blocks": deep_thaw(self.blocks),
        }

    def deep_copy(self) -> "Model":
        return Model.from_payload(copy.deepcopy(self.to_payload()), source_revision=self.source_revision)

    def with_fingerprint(self) -> "Model":
        return Model.from_payload(self.to_payload(), source_revision=self.source_revision)

    @property
    def cache_key(self) -> str:
        """稳定缓存键：与 fingerprint 同义，供编译缓存使用。"""
        return self.fingerprint

    @property
    def node_ids(self) -> tuple[str, ...]:
        return tuple(node.id for node in self.nodes)

    @property
    def edge_ids(self) -> tuple[str, ...]:
        return tuple(edge.id for edge in self.edges)

    def node_by_id(self) -> FrozenMapping:
        return FrozenMapping({node.id: node for node in self.nodes})

    def edge_by_id(self) -> FrozenMapping:
        return FrozenMapping({edge.id: edge for edge in self.edges})

    def compile(self):
        from .compiled_model import compile_model

        return compile_model(self)
