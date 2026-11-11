"""节点、连接、模板与场景路由（D151）。

从 server.py 原样搬运，不改变路由路径、请求模型或响应结构。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Literal

from fastapi import APIRouter, Body, Query, Response
from pydantic import BaseModel, ConfigDict, Field

from ..core.common.limits import NotFoundError, ValidationError
from ..core.model.project import migrate_scene_to_devices
from ..core.model.templates import TEMPLATES, build_template, template_catalog


class NodeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    kind: str = "manual"
    params: dict[str, Any] = Field(default_factory=dict)
    data: dict[str, Any] = Field(default_factory=dict)
    position: dict[str, float] | None = None
    size: dict[str, float] | None = None


class NodeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    kind: str | None = None
    params: dict[str, Any] | None = None
    data: dict[str, Any] | None = None
    position: dict[str, float] | None = None
    size: dict[str, float] | None = None
    appearance: dict[str, Any] | None = None


class EdgeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str
    target: str
    kind: str
    name: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    delay: bool = False
    enabled: bool = True
    auto_delay: bool = False
    route: str = "auto"
    waypoints: list[dict[str, float]] = Field(default_factory=list)
    anchors: dict[str, str] = Field(default_factory=dict)
    pins: dict[str, str] | None = None
    layout: dict[str, Any] | None = None
    source_pin: str = ""
    target_pin: str = ""
    source_port: str = ""
    target_port: str = ""


class EdgeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    kind: str | None = None
    params: dict[str, Any] | None = None
    delay: bool | None = None
    enabled: bool | None = None
    route: str | None = None
    waypoints: list[dict[str, float]] | None = None
    anchors: dict[str, str] | None = None
    pins: dict[str, str] | None = None
    layout: dict[str, Any] | None = None
    source_pin: str | None = None
    target_pin: str | None = None
    source_port: str | None = None
    target_port: str | None = None
    appearance: dict[str, Any] | None = None


class PositionItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    position: dict[str, float]


class PositionsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    positions: list[PositionItem]


class AppearanceItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    appearance: dict[str, Any] = Field(default_factory=dict)


class AppearanceBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nodes: list[AppearanceItem] = Field(default_factory=list)
    edges: list[AppearanceItem] = Field(default_factory=list)


class IntegrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    integration: Literal["trapezoidal", "backward_euler", "gear2"]


class AlgebraicSolverRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool


def build_router(
    *,
    service: Any,
    fast_json: Callable[[Any], Response],
) -> APIRouter:
    router = APIRouter(tags=["scene"])

    # ---- 节点 --------------------------------------------------------------
    @router.post("/api/nodes")
    def add_node(request: NodeCreate) -> dict[str, Any]:
        record = service.mutate(
            lambda scene: scene.add_node(
                name=request.name,
                kind=request.kind,
                params=request.params,
                data=request.data,
                position=request.position,
                size=request.size,
            )
        )
        snapshot = service.snapshot()
        snapshot["node"] = record.snapshot()
        return snapshot

    @router.patch("/api/nodes/{node_id}")
    def update_node(node_id: str, request: NodeUpdate) -> dict[str, Any]:
        payload = request.model_dump(exclude_unset=True)
        record = service.mutate(lambda scene: scene.update_node(node_id, payload))
        return {
            "node": record.snapshot(),
            "sim": service.info(),
            "revision": service.scene.revision,
        }

    @router.delete("/api/nodes/{node_id}")
    def delete_node(node_id: str) -> dict[str, Any]:
        removed = service.mutate(lambda scene: scene.delete_node(node_id))
        snapshot = service.snapshot()
        snapshot["removed_edges"] = removed
        return snapshot

    # ---- 连接 --------------------------------------------------------------
    @router.post("/api/edges")
    def add_edge(request: EdgeCreate) -> dict[str, Any]:
        record = service.mutate(
            lambda scene: scene.add_edge(
                source=request.source,
                target=request.target,
                kind=request.kind,
                name=request.name,
                params=request.params,
                delay=request.delay,
                enabled=request.enabled,
                auto_delay=request.auto_delay,
                route=request.route,
                waypoints=request.waypoints,
                anchors=request.anchors,
                pins=request.pins,
                layout=request.layout,
                source_pin=request.source_pin,
                target_pin=request.target_pin,
                source_port=request.source_port,
                target_port=request.target_port,
            )
        )
        notice = None
        if (
            service.scene.mode in ("signal", "vector")
            and record.delay
            and not request.delay
        ):
            notice = "已按请求 auto_delay=true 将该连接设为单步延迟"
        snapshot = service.snapshot()
        snapshot["edge"] = record.snapshot()
        snapshot["notice"] = notice
        return snapshot

    @router.patch("/api/edges/{edge_id}")
    def update_edge(edge_id: str, request: EdgeUpdate) -> dict[str, Any]:
        payload = request.model_dump(exclude_unset=True)
        record = service.mutate(lambda scene: scene.update_edge(edge_id, payload))
        return {
            "edge": record.snapshot(),
            "sim": service.info(),
            "revision": service.scene.revision,
        }

    @router.delete("/api/edges/{edge_id}")
    def delete_edge(edge_id: str) -> dict[str, Any]:
        service.mutate(lambda scene: scene.delete_edge(edge_id))
        return service.snapshot()

    @router.patch("/api/scene/appearance")
    def update_appearance(request: AppearanceBatch) -> dict[str, Any]:
        """批量外观（ADR-005-lite §4）：一次校验、一次提交，失败不落任何写入。

        外观属 Presentation 层：不改物理参数、不触发物理重编译。
        """
        counts = service.mutate(
            lambda scene: scene.update_appearance_batch(
                nodes=[item.model_dump() for item in request.nodes],
                edges=[item.model_dump() for item in request.edges],
            )
        )
        return {"ok": True, "updated": counts, "revision": service.scene.revision}

    @router.post("/api/positions")
    def update_positions(request: PositionsUpdate) -> dict[str, Any]:
        items = [{"id": item.id, "position": item.position} for item in request.positions]
        service.mutate(lambda scene: scene.update_positions(items))
        return {"ok": True, "revision": service.scene.revision}

    # ---- 模板与场景 --------------------------------------------------------
    @router.get("/api/templates")
    def templates() -> dict[str, Any]:
        return {"templates": template_catalog()}

    @router.post("/api/templates/{name}")
    def load_template(name: str) -> dict[str, Any]:
        if name not in TEMPLATES:
            raise NotFoundError(f"模板 {name!r} 不存在")
        service.load_scene(build_template(name))
        return service.snapshot()

    @router.get("/api/scene/export")
    def export_scene(include_state: bool = Query(default=False)) -> Response:
        return fast_json(service.scene.to_payload(include_state=include_state))

    @router.get("/api/export/schematic")
    def export_schematic(name: str = Query(""), network: str = Query("")) -> dict[str, Any]:
        """R18/R19：用 SchemDraw 把当前电路场景直接输出为静态 SVG。"""
        from ..core.compute.schematic_export import scene_to_svg, svg_filename

        svg = scene_to_svg(service.scene, project_name=name, network_name=network)
        return {"ok": True, "svg": svg, "filename": svg_filename(name)}

    @router.post("/api/scene")
    def import_scene(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        if len(str(payload)) > 2_000_000:
            raise ValidationError("场景文件过大")
        service.load_scene(payload)
        return service.snapshot()

    @router.post("/api/scene/migrate-devices")
    def migrate_scene_devices() -> dict[str, Any]:
        """R20：把当前电路场景从「边=元件」迁移为「器件节点 + 引脚导线」。"""
        scene = service.scene
        if scene.mode != "circuit":
            raise ValidationError("只有电路场景可以迁移为器件模型")
        before = scene.to_payload(include_state=False)
        before_devices = sum(
            1 for node in before.get("nodes") or [] if node.get("kind") == "device"
        )
        migrated = migrate_scene_to_devices(before)
        devices = sum(
            1 for node in migrated.get("nodes") or [] if node.get("kind") == "device"
        )
        wires = sum(
            1 for edge in migrated.get("edges") or [] if edge.get("kind") == "wire"
        )
        service.load_scene(migrated)
        snapshot = service.snapshot()
        snapshot["migration"] = {
            "converted": devices - before_devices,
            "devices": devices,
            "wires": wires,
        }
        return snapshot

    @router.post("/api/scene/clear")
    def clear_scene(mode: str | None = Query(None)) -> dict[str, Any]:
        if mode is None:
            name = "blank_signal" if service.scene.mode == "signal" else "blank_circuit"
        else:
            names = {
                "signal": "blank_signal",
                "circuit": "blank_circuit",
                "vector": "blank_vector",
            }
            if mode not in names:
                raise ValidationError(f"未知场景模式：{mode!r}")
            name = names[mode]
        service.load_scene(build_template(name))
        return service.snapshot()

    @router.patch("/api/scene")
    def update_scene_settings(request: IntegrationRequest) -> dict[str, Any]:
        service.mutate(lambda scene: scene.set_integration(request.integration))
        return service.snapshot()

    @router.put("/api/scene/algebraic")
    def update_algebraic_solver(
        request: AlgebraicSolverRequest,
    ) -> dict[str, Any]:
        """R36/P2：显式切换信号流的直接馈通代数环求解，并随工程持久化。"""
        service.mutate(lambda scene: scene.set_algebraic_solver(request.enabled))
        return service.snapshot()

    return router
