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
from .scene_types import normalize_appearance
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


class _SceneEditMixin:
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
        from .engine_registry import validate_kind

        validate_kind(self.mode, kind)
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
        allowed = {"name", "kind", "params", "data", "position", "size", "appearance"}
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
        if "appearance" in payload:
            record.appearance = normalize_appearance(payload["appearance"])
        if set(payload) == {"appearance"}:
            # 仅外观变化不需要重建引擎（ADR-005-lite §1）。
            self.revision += 1
        else:
            self._touch()
        return record

    def update_appearance_batch(
        self,
        *,
        nodes: list[dict[str, Any]] | None = None,
        edges: list[dict[str, Any]] | None = None,
    ) -> dict[str, int]:
        """批量外观（ADR-005-lite §4）：先全部校验再统一写入。

        外观只属 Presentation：不改物理参数、不重建引擎、不触发重编译；
        中途任何一项不合法都抛错且不落任何写入，保证一次提交要么全成要么全无。
        """
        node_items = nodes or []
        edge_items = edges or []
        total = len(node_items) + len(edge_items)
        if total > MAX_NODES + MAX_EDGES:
            raise LimitError("外观批量修改的条目过多")
        staged_nodes: list[tuple[NodeRecord, dict[str, Any]]] = []
        staged_edges: list[tuple[EdgeRecord, dict[str, Any]]] = []
        for item in node_items:
            if not isinstance(item, dict):
                raise ValidationError("外观项必须是对象")
            record = self.nodes.get(check_id(item.get("id"), "节点 id"))
            if record is None:
                raise NotFoundError("节点不存在")
            staged_nodes.append((record, normalize_appearance(item.get("appearance") or {})))
        for item in edge_items:
            if not isinstance(item, dict):
                raise ValidationError("外观项必须是对象")
            record = self.edges.get(check_id(item.get("id"), "连线 id"))
            if record is None:
                raise NotFoundError("连线不存在")
            staged_edges.append((record, normalize_appearance(item.get("appearance") or {})))
        for record, appearance in staged_nodes + staged_edges:
            record.appearance = appearance
        if total:
            # 外观只属 Presentation，不进入物理编译缓存键（ADR-005-lite §1/§4）。
            self.revision += 1
        return {"nodes": len(staged_nodes), "edges": len(staged_edges)}

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
    def _cycle_path(
        self,
        source_id: str,
        target_id: str,
        *,
        skip_edge: str | None = None,
        edges: dict[str, "EdgeRecord"] | None = None,
        nodes: dict[str, "NodeRecord"] | None = None,
    ) -> list[str]:
        """返回新增 source→target 边会形成的环路径（节点 id 序列）。"""
        if source_id == target_id:
            return [source_id, source_id]
        node_items = self.nodes if nodes is None else nodes
        adjacency: dict[str, list[str]] = {node_id: [] for node_id in node_items}
        edge_items = self.edges.values() if edges is None else edges.values()
        for edge in edge_items:
            if not edge.enabled or edge.delay or edge.id == skip_edge:
                continue
            adjacency[edge.source].append(edge.target)
        parent: dict[str, str | None] = {target_id: None}
        stack = [target_id]
        while stack:
            current = stack.pop()
            for neighbour in adjacency.get(current, ()):
                if neighbour == source_id:
                    path = [source_id]
                    cursor: str | None = current
                    while cursor is not None:
                        path.append(cursor)
                        if cursor == target_id:
                            break
                        cursor = parent.get(cursor)
                    path.append(source_id)
                    return path
                if neighbour not in parent:
                    parent[neighbour] = current
                    stack.append(neighbour)
        return []

    def _would_cycle(
        self, source_id: str, target_id: str, *, skip_edge: str | None = None
    ) -> bool:
        return bool(self._cycle_path(source_id, target_id, skip_edge=skip_edge))

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
        auto_delay: bool = False,
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
        if not isinstance(kind, str):
            raise ValidationError("kind 必须是字符串")
        from .engine_registry import validate_kind

        validate_kind(self.mode, kind, edge=True)
        if pins is not None:
            from .schematic import apply_pin_bindings

            bound = apply_pin_bindings(
                {
                    "kind": kind,
                    "source": source,
                    "target": target,
                    "params": params or {},
                    "pins": pins,
                }
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

        auto_delay_applied = False
        if self.mode == "circuit":
            if delay:
                raise ValidationError("电路模式使用节点电压法求解，不支持延迟连接")
            if source_id == target_id:
                raise ValidationError("元件两端不能是同一个节点")
            delay = False
        elif not delay and self._would_cycle(source_id, target_id):
            if auto_delay:
                delay = True
                auto_delay_applied = True
            elif getattr(self, "solve_algebraic", False):
                # R36/P2：代数环交给 solver_plan/SCC 求解，不再自动改写为 z⁻¹。
                pass
            else:
                cycle_ids = self._cycle_path(source_id, target_id)
                cycle_names = [
                    self.nodes[node_id].name if node_id in self.nodes else node_id
                    for node_id in cycle_ids
                ]
                path = " -> ".join(cycle_names)
                raise ConflictError(
                    f"这条连接会形成代数环：{path}。"
                    "请显式设置 delay=True 或启用 solve_algebraic。"
                )

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
            auto_delay=auto_delay_applied,
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
            "appearance",
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
        if "appearance" in payload:
            record.appearance = normalize_appearance(payload["appearance"])
        if set(payload) == {"appearance"}:
            # 仅外观变化不需要重建引擎（ADR-005-lite §1）。
            self.revision += 1
        else:
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
