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
from .scene_types import MODES, normalize_appearance
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


class _SceneIOMixin:
    def to_payload(self, *, include_state: bool = False) -> dict[str, Any]:
        nodes = []
        for record in self.nodes.values():
            nodes.append(record.snapshot(include_state=include_state))
        edges = []
        for record in self.edges.values():
            edges.append(record.snapshot(include_state=include_state))
        return {
            "mode": self.mode,
            "integration": self.integration,
            "solve_algebraic": bool(self.solve_algebraic),
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
        solve_algebraic = payload.get("solve_algebraic", False)
        if not isinstance(solve_algebraic, bool):
            raise ValidationError("solve_algebraic 必须是布尔值")

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
                appearance=normalize_appearance(raw.get("appearance")),
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
                auto_delay=bool(raw.get("auto_delay", False)),
                enabled=enabled,
                route=self._edge_route(raw.get("route")),
                waypoints=self._edge_waypoints(raw.get("waypoints")),
                anchors=self._edge_anchors(raw.get("anchors")),
                layout=self._edge_layout(raw.get("layout")),
                source_pin=source_pin,
                target_pin=target_pin,
                source_port=source_port,
                target_port=target_port,
                appearance=normalize_appearance(raw.get("appearance")),
            )

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

        if mode == "signal" and not solve_algebraic:
            for record in edges.values():
                if record.delay or not record.enabled:
                    continue
                cycle = self._cycle_path(
                    record.source,
                    record.target,
                    skip_edge=record.id,
                    edges=edges,
                    nodes=nodes,
                )
                if not cycle:
                    continue
                route = cycle
                raise ConflictError(
                    "导入信号流工程发现未显式处理的代数环："
                    + " -> ".join(route)
                    + "。请显式设置 delay=True 或启用 solve_algebraic。"
                )

        self.nodes = nodes
        self.edges = edges
        self.solve_algebraic = solve_algebraic
        self.block_instances = {}
        self._counter = len(edges)
        self._engine = None
        self._dirty = True
        self.revision += 1

    # ---- 元数据 -----------------------------------------------------------
    def catalog(self) -> dict[str, Any]:
        from .engine_registry import plugin_modes

        modes = [
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
        ]
        modes.extend(
            {"value": mode, "label": f"插件模式：{mode}", "description": "插件引擎"}
            for mode in plugin_modes()
        )
        return {
            "modes": modes,
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
