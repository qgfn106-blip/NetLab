"""CompiledModel：Model 的独立、静态、可复现编译产物。

CompiledModel 不是 Model 的副本，也不是 Engine 的别名：它由 Model 编译而来，
持有编译拓扑、索引、组件执行描述、自由度布局、方程结构、装配计划、编译器版本、
Model 指纹与诊断，不引用可变 Model 内部数据，不含 Runtime 状态，也不依赖 UI。
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Mapping

from .instance_model import (
    EdgeDesc,
    FrozenMapping,
    FrozenSequence,
    NodeDesc,
    deep_freeze,
    deep_thaw,
    stable_fingerprint,
)

if TYPE_CHECKING:  # 仅类型引用，避免 model <-> compiled_model 静态循环
    from .model import Model

COMPILER_VERSION = "model-compiler/1.0.0"


@dataclass(frozen=True)
class ComponentDescriptor:
    """单个节点/边的执行描述（编译期快照）。"""

    entity: str
    id: str
    kind: str
    executor: str
    label: str
    params_digest: str
    inputs: tuple[str, ...] = ()
    outputs: tuple[str, ...] = ()


@dataclass(frozen=True)
class VariableDescriptor:
    """自由度布局中的单个变量。"""

    name: str
    kind: str
    owner_id: str
    owner_kind: str


def _spec_lookup(mode: str, kind: str, entity: str) -> tuple[str, str, tuple[str, ...], tuple[str, ...]]:
    """返回 (executor, label, inputs, outputs)；未知类型回退 plugin。"""
    try:
        if mode == "circuit":
            if entity == "node":
                # 电路节点不是计算元件：它是 MNA 自由度载体（ground 除外）。
                return ("node", "电气节点" if kind != "ground" else "地", tuple(), tuple())
            from ..compute.circuit.catalog import ELEMENT_SPECS

            spec = ELEMENT_SPECS.get(kind)
            if spec is not None:
                return ("element", str(getattr(spec, "label", kind)), tuple(), tuple())
        if entity == "node":
            from ..compute.computes import get_compute_spec

            spec = get_compute_spec(kind)
            return ("compute", str(getattr(spec, "label", kind)), tuple(), tuple())
        from ..compute.methods import get_method_spec

        spec = get_method_spec(kind)
        return ("method", str(getattr(spec, "label", kind)), tuple(), tuple())
    except Exception:
        return ("plugin", kind, tuple(), tuple())


def _topological_order(node_ids: tuple[str, ...], edges: tuple[EdgeDesc, ...]) -> tuple[tuple[str, ...], bool]:
    known = set(node_ids)
    indegree = {node_id: 0 for node_id in node_ids}
    outgoing: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    for edge in edges:
        if edge.source in known and edge.target in known:
            outgoing[edge.source].append(edge.target)
            indegree[edge.target] += 1
    ready = [node_id for node_id in node_ids if indegree[node_id] == 0]
    ordered: list[str] = []
    while ready:
        current = ready.pop(0)
        ordered.append(current)
        for target in outgoing.get(current, ()):
            indegree[target] -= 1
            if indegree[target] == 0:
                ready.append(target)
    if len(ordered) == len(node_ids):
        return tuple(ordered), False
    return tuple(node_ids), True


def compile_model(model: Model) -> "CompiledModel":
    """确定性编译 Model；同一 Model 始终得到相同指纹。"""
    payload = model.to_payload()
    # 独立复制：编译产物不持有 Model 的字段/容器引用。
    nodes = tuple(NodeDesc.from_payload(item) for item in payload["nodes"])
    edges = tuple(EdgeDesc.from_payload(item) for item in payload["edges"])
    blocks = deep_freeze(payload["blocks"])
    diagnostics: list[dict[str, Any]] = []

    node_index: dict[str, int] = {}
    for index, node in enumerate(nodes):
        if node.id in node_index:
            diagnostics.append({"severity": "error", "code": "duplicate_node_id", "message": f"节点 id 重复：{node.id}", "entity": node.id})
        node_index[node.id] = index
    edge_index: dict[str, int] = {}
    for index, edge in enumerate(edges):
        if edge.id in edge_index:
            diagnostics.append({"severity": "error", "code": "duplicate_edge_id", "message": f"连接 id 重复：{edge.id}", "entity": edge.id})
        edge_index[edge.id] = index
        if edge.source not in node_index or edge.target not in node_index:
            diagnostics.append({"severity": "error", "code": "missing_endpoint", "message": f"连接 {edge.id} 的端点不存在", "entity": edge.id})

    order, has_cycle = _topological_order(tuple(node_index), edges)
    if has_cycle:
        diagnostics.append({"severity": "warning", "code": "cycle_detected", "message": "拓扑含环，执行顺序退回声明顺序", "entity": ""})

    adjacency: dict[str, list[str]] = {node_id: [] for node_id in node_index}
    for edge in edges:
        if edge.source in adjacency:
            adjacency[edge.source].append(edge.target)

    components: list[ComponentDescriptor] = []
    for node in nodes:
        executor, label, ins, outs = _spec_lookup(model.mode, node.kind, "node")
        components.append(
            ComponentDescriptor(
                entity="node",
                id=node.id,
                kind=node.kind,
                executor=executor,
                label=label,
                params_digest=stable_fingerprint(deep_thaw(node.params)),
                inputs=ins,
                outputs=outs,
            )
        )
    for edge in edges:
        executor, label, ins, outs = _spec_lookup(model.mode, edge.kind, "edge")
        components.append(
            ComponentDescriptor(
                entity="edge",
                id=edge.id,
                kind=edge.kind,
                executor=executor,
                label=label,
                params_digest=stable_fingerprint(deep_thaw(edge.params)),
                inputs=ins,
                outputs=outs,
            )
        )

    variables: list[VariableDescriptor] = []
    if model.mode == "circuit":
        from ..compute.circuit.catalog import ELEMENT_SPECS

        for node in sorted(nodes, key=lambda item: item.id):
            if node.kind == "ground":
                continue
            variables.append(VariableDescriptor(name=f"V({node.id})", kind="voltage", owner_id=node.id, owner_kind=node.kind))
        for edge in edges:
            spec = ELEMENT_SPECS.get(edge.kind)
            needs_branch = bool(getattr(getattr(spec, "cls", None), "needs_branch", False))
            if needs_branch:
                variables.append(VariableDescriptor(name=f"I({edge.id})", kind="current", owner_id=edge.id, owner_kind=edge.kind))
    else:
        for node_id in order:
            node = nodes[node_index[node_id]]
            variables.append(VariableDescriptor(name=node.name or node.id, kind="signal", owner_id=node.id, owner_kind=node.kind))

    equation_structure = {
        "method": "modified_nodal_analysis" if model.mode == "circuit" else "signal_flow",
        "node_equations": len(variables) if model.mode != "circuit" else sum(1 for node in nodes if node.kind != "ground"),
        "branch_equations": sum(1 for variable in variables if variable.kind == "current"),
        "variable_count": len(variables),
    }
    assembly_plan = (
        "validate_topology",
        "build_node_components",
        "build_edge_methods",
        "build_dof_layout",
        "initialize_runtime_state",
    )
    diagnostics_frozen = FrozenSequence(deep_freeze(item) for item in diagnostics)
    scene_payload = deep_freeze(payload)
    return CompiledModel(
        mode=model.mode,
        integration=model.integration,
        solve_algebraic=model.solve_algebraic,
        nodes=nodes,
        edges=edges,
        blocks=blocks,
        node_index=deep_freeze(node_index),
        edge_index=deep_freeze(edge_index),
        adjacency=deep_freeze(adjacency),
        order=order,
        components=tuple(components),
        dof_layout=tuple(variables),
        equation_structure=deep_freeze(equation_structure),
        assembly_plan=assembly_plan,
        compiler_version=COMPILER_VERSION,
        model_fingerprint=model.fingerprint,
        diagnostics=diagnostics_frozen,
        scene_payload=scene_payload,
    )


@dataclass(frozen=True)
class CompiledModel:
    mode: str
    integration: str
    solve_algebraic: bool
    nodes: tuple[NodeDesc, ...]
    edges: tuple[EdgeDesc, ...]
    blocks: FrozenSequence
    node_index: FrozenMapping
    edge_index: FrozenMapping
    adjacency: FrozenMapping
    order: tuple[str, ...]
    components: tuple[ComponentDescriptor, ...]
    dof_layout: tuple[VariableDescriptor, ...]
    equation_structure: FrozenMapping
    assembly_plan: tuple[str, ...]
    compiler_version: str
    model_fingerprint: str
    diagnostics: FrozenSequence
    scene_payload: FrozenMapping
    fingerprint: str = ""

    def __post_init__(self) -> None:
        object.__setattr__(self, "nodes", tuple(self.nodes))
        object.__setattr__(self, "edges", tuple(self.edges))
        for name in ("node_index", "edge_index", "adjacency", "scene_payload"):
            if not isinstance(getattr(self, name), FrozenMapping):
                object.__setattr__(self, name, FrozenMapping(getattr(self, name)))
        if not isinstance(self.blocks, FrozenSequence):
            object.__setattr__(self, "blocks", FrozenSequence(self.blocks))
        if not isinstance(self.diagnostics, FrozenSequence):
            object.__setattr__(self, "diagnostics", FrozenSequence(self.diagnostics))
        if not self.fingerprint:
            object.__setattr__(self, "fingerprint", stable_fingerprint(self.manifest()))

    def manifest(self) -> dict[str, Any]:
        return {
            "compiler_version": self.compiler_version,
            "model_fingerprint": self.model_fingerprint,
            "mode": self.mode,
            "integration": self.integration,
            "solve_algebraic": self.solve_algebraic,
            "nodes": [node.to_model_fields() for node in self.nodes],
            "edges": [edge.to_model_fields() for edge in self.edges],
            "blocks": deep_thaw(self.blocks),
            "node_index": deep_thaw(self.node_index),
            "edge_index": deep_thaw(self.edge_index),
            "adjacency": deep_thaw(self.adjacency),
            "order": list(self.order),
            "components": [component.__dict__ for component in self.components],
            "dof_layout": [variable.__dict__ for variable in self.dof_layout],
            "equation_structure": deep_thaw(self.equation_structure),
            "assembly_plan": list(self.assembly_plan),
            "diagnostics": deep_thaw(self.diagnostics),
        }

    def create_runtime(self, scene: Any = None, *, block_instances: Any = None):
        from .runtime import Runtime

        return Runtime(self, scene=scene, block_instances=block_instances)

    def to_payload(self) -> dict[str, Any]:
        return deep_thaw(self.scene_payload)

    @property
    def cache_key(self) -> str:
        """稳定缓存键：同一 Model + 同一编译器版本得到相同值。"""
        return self.fingerprint

    @property
    def has_errors(self) -> bool:
        return any(item.get("severity") == "error" for item in self.diagnostics)
