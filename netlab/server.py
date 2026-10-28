"""FastAPI 应用：REST 接口与静态演示页面。

服务端只执行注册表中的受控计算，不执行用户提交的代码；所有请求体先经
Pydantic 与场景层校验，错误以统一的 ``{"detail": "..."}`` 返回。
"""

from __future__ import annotations

import copy
import json
import os
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import Body, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from .fem import FemSimulation
from .limits import ConflictError, NetlabError, NotFoundError, ValidationError
from .networks import NetworkContainer
from .project import (
    build_project,
    compute_checksum,
    migrate_scene_to_devices,
    project_current_network,
    project_scene_payload,
    validate_project,
)
from .workspace import (
    create_project,
    list_snapshots,
    load_settings,
    load_snapshot,
    load_workspace,
    prune_snapshots,
    save_settings,
    save_workspace,
    scan_block_references,
    scan_library,
    settings_file,
    workspace_for,
    write_snapshot,
)

#: 最近一次打开/保存/创建的工程目录（用于把校验报告写进它的 exports/）。
CURRENT_WORKSPACE: Path | None = None

#: 降级打开时的原始工程载荷；补回库文件后可 POST /api/project/retry 重新解析。
LAST_PROJECT: dict[str, Any] | None = None
LAST_PROJECT_LIBRARY: str | None = None
from .simulation import Simulation, default_simulation
from .templates import TEMPLATES, build_template, template_catalog
from . import accel, analysis, block_validate, blocklib, extensions, profiling, schematic
from .blocks import build_block_from_scene, encapsulate_nodes, instantiate_block

STATIC_DIR = Path(__file__).resolve().parent / "static"
SERVICE: NetworkContainer = NetworkContainer(default_simulation(), name="网络 1")
FEM: FemSimulation = FemSimulation()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    SERVICE.ensure_thread()
    FEM.ensure_thread()
    try:
        yield
    finally:
        SERVICE.shutdown()
        FEM.shutdown()


app = FastAPI(
    title="Netlab 拓扑网络仿真",
    version="1.0.0",
    description="节点数据流 + 状态空间 + 节点电压法电路求解",
    lifespan=lifespan,
)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
_DESKTOP_TOKEN = os.environ.get("NETLAB_DESKTOP_TOKEN")


@app.middleware("http")
async def desktop_token_guard(request: Request, call_next):
    """桌面模式下只允许携带会话 token 的本地页面调用 API。"""
    if (
        _DESKTOP_TOKEN
        and request.url.path.startswith("/api/")
        and request.url.path != "/api/health"
        and request.headers.get("x-netlab-token") != _DESKTOP_TOKEN
    ):
        return JSONResponse(
            status_code=403,
            content={"detail": "桌面会话 token 无效，请从桌面窗口打开页面"},
        )
    return await call_next(request)


@app.exception_handler(NetlabError)
async def netlab_error_handler(_request, exc: NetlabError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content={"detail": str(exc)})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request, exc: RequestValidationError) -> JSONResponse:
    messages = []
    for error in exc.errors():
        location = ".".join(str(part) for part in error.get("loc", ()))
        messages.append(f"{location}: {error.get('msg', '不合法')}")
    return JSONResponse(
        status_code=422,
        content={"detail": "请求参数不合法：" + "；".join(messages[:5])},
    )


# ---- 请求模型 --------------------------------------------------------------
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


class EdgeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str
    target: str
    kind: str
    name: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    delay: bool = False
    enabled: bool = True
    auto_delay: bool = True
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
    source: str | None = None
    target: str | None = None
    route: str | None = None
    waypoints: list[dict[str, float]] | None = None
    anchors: dict[str, str] | None = None
    pins: dict[str, str] | None = None
    layout: dict[str, Any] | None = None
    source_pin: str | None = None
    target_pin: str | None = None
    source_port: str | None = None
    target_port: str | None = None


class PositionItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    position: dict[str, float]


class PositionsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    positions: list[PositionItem]


class ConfigUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fps: int | None = None
    dt: float | None = None
    steps_per_frame: int | None = None
    t_step: float | None = None
    lock_dt: bool | None = None
    sample_every: int | None = None
    realtime: bool | None = None
    step_timeout_ms: float | None = None
    reltol: float | None = None
    vntol: float | None = None
    abstol: float | None = None
    max_iter: int | None = None
    gmin_steps: int | None = None
    src_steps: int | None = None
    residual_tol: float | None = None
    breakpoints: bool | None = None
    sparse: Literal["auto", "on", "off"] | None = None
    sparse_threshold: int | None = None


class SolveWindowRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    duration: float
    dt: float | None = None
    sample_every: int | None = None


class ControlRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["run", "pause", "toggle", "step", "reset", "zero"]
    steps: int | None = None


class ModeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["signal", "circuit", "vector"]


class IntegrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    integration: Literal["trapezoidal", "backward_euler", "gear2"]


class ShutdownRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirm: bool = False


class FemConfigUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    nx: int | None = None
    ny: int | None = None
    dt: float | None = None
    fps: int | None = None
    steps_per_frame: int | None = None
    sample_every: int | None = None
    conductivity: float | None = None
    capacity: float | None = None
    source_amplitude: float | None = None
    source_frequency: float | None = None
    source_sigma: float | None = None
    source_x: float | None = None
    boundary_left: float | None = None
    boundary_right: float | None = None
    initial_temperature: float | None = None


class ProjectExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    ui: dict[str, Any] = Field(default_factory=dict)
    blocks: list[dict[str, Any]] = Field(default_factory=list)
    extensions: list[dict[str, Any]] = Field(default_factory=list)
    created: str | None = None


class ProjectImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project: dict[str, Any]
    trust_extensions: bool = False


class AccelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    policy: Literal["auto", "cpu", "gpu"]


class ExtensionValidateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    filename: str = "<netlab-extension>"


class ExtensionActivateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    filename: str = "<netlab-extension>"
    persist: bool = False
    kind_type: Literal["node", "method"] = "node"


class ExtensionDeactivateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str
    remove_file: bool = False


# ---- 页面与元数据 ----------------------------------------------------------
@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(
        STATIC_DIR / "index.html", headers={"Cache-Control": "no-store"}
    )


@app.get("/api/catalog")
def catalog() -> dict[str, Any]:
    return {
        "catalog": SERVICE.scene.catalog(),
        "templates": template_catalog(),
        "default_template": "signal_chain",
        "accel": accel.status(),
        "project": {"format_version": 1, "suffix": ".netlab"},
    }


@app.get("/api/state")
def state() -> dict[str, Any]:
    return SERVICE.snapshot()


@app.get("/api/live")
def live(
    cursor: int = Query(default=0, ge=0),
    limit: int = Query(default=400, ge=1, le=600),
) -> dict[str, Any]:
    return SERVICE.live(cursor, limit)


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "running": SERVICE.running,
        "mode": SERVICE.scene.mode,
        "fem_running": FEM.running,
    }


# ---- 仿真控制 --------------------------------------------------------------
@app.post("/api/control")
def control(request: ControlRequest) -> dict[str, Any]:
    if SERVICE.degraded and request.action in ("run", "step", "toggle"):
        raise ConflictError(
            "工程处于降级只读模式（库文件缺失）：补回库文件或确认替换占位块后才能运行"
        )
    if request.action == "run":
        SERVICE.start()
    elif request.action == "pause":
        SERVICE.pause()
    elif request.action == "toggle":
        SERVICE.toggle()
    elif request.action == "step":
        SERVICE.step_once(request.steps)
    elif request.action == "zero":
        SERVICE.zero_time()
    elif request.action == "reset":
        SERVICE.reset()
    return {"sim": SERVICE.info()}


@app.post("/api/solve-window")
def solve_window(request: SolveWindowRequest) -> dict[str, Any]:
    if SERVICE.degraded:
        raise ConflictError("工程处于降级只读模式，不能预计算")
    result = SERVICE.precompute(request.duration, request.dt, request.sample_every)
    return {"result": result, "sim": SERVICE.info()}


@app.get("/api/operating-point")
def operating_point() -> dict[str, Any]:
    """DC 工作点：不推进仿真时间，只解一次静态电路。"""
    if SERVICE.degraded:
        raise ConflictError("工程处于降级只读模式，不能做 DC 工作点分析")
    return {"result": SERVICE.current.operating_point(), "sim": SERVICE.info()}


@app.get("/api/ac-sweep")
def ac_sweep(
    input: str | None = Query(None, description="激励源名称，缺省取第一个独立源"),
    f_start: float = Query(1.0, gt=0.0),
    f_stop: float = Query(1.0e6, gt=0.0),
    points: int = Query(61, ge=2, le=2001),
    scale: Literal["log", "lin"] = "log",
    probes: str = Query("", description="逗号分隔的节点/元件名；空 = 默认全部"),
) -> dict[str, Any]:
    """AC 小信号扫频：先求工作点线性化，再逐频点解复数线性方程。"""
    import numpy as np

    if SERVICE.degraded:
        raise ConflictError("工程处于降级只读模式，不能做 AC 分析")
    if f_stop <= f_start:
        raise ValidationError("AC 扫频要求 f_stop 大于 f_start")
    if scale == "log":
        frequencies = np.logspace(
            float(np.log10(f_start)), float(np.log10(f_stop)), int(points)
        ).tolist()
    else:
        frequencies = np.linspace(f_start, f_stop, int(points)).tolist()
    wanted = [item.strip() for item in probes.split(",") if item.strip()] or None
    result = SERVICE.current.ac_sweep(
        frequencies, input_source=input, probes=wanted
    )
    return {"result": result, "sim": SERVICE.info()}


@app.patch("/api/config")
def update_config(request: ConfigUpdate) -> dict[str, Any]:
    payload = request.model_dump(exclude_unset=True, exclude_none=True)
    config = SERVICE.apply_config(payload)
    return {"config": config, "sim": SERVICE.info()}


@app.post("/api/mode")
def switch_mode(request: ModeRequest) -> dict[str, Any]:
    name = {"signal": "blank_signal", "circuit": "blank_circuit", "vector": "blank_vector"}[request.mode]
    payload = build_template(name)
    SERVICE.load_scene(payload)
    return SERVICE.snapshot()


# ---- 节点 ------------------------------------------------------------------
@app.post("/api/nodes")
def add_node(request: NodeCreate) -> dict[str, Any]:
    record = SERVICE.mutate(
        lambda scene: scene.add_node(
            name=request.name,
            kind=request.kind,
            params=request.params,
            data=request.data,
            position=request.position,
            size=request.size,
        )
    )
    snapshot = SERVICE.snapshot()
    snapshot["node"] = record.snapshot()
    return snapshot


@app.patch("/api/nodes/{node_id}")
def update_node(node_id: str, request: NodeUpdate) -> dict[str, Any]:
    payload = request.model_dump(exclude_unset=True)
    record = SERVICE.mutate(lambda scene: scene.update_node(node_id, payload))
    return {
        "node": record.snapshot(),
        "sim": SERVICE.info(),
        "revision": SERVICE.scene.revision,
    }


@app.delete("/api/nodes/{node_id}")
def delete_node(node_id: str) -> dict[str, Any]:
    removed = SERVICE.mutate(lambda scene: scene.delete_node(node_id))
    snapshot = SERVICE.snapshot()
    snapshot["removed_edges"] = removed
    return snapshot


# ---- 连接 ------------------------------------------------------------------
@app.post("/api/edges")
def add_edge(request: EdgeCreate) -> dict[str, Any]:
    record = SERVICE.mutate(
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
        SERVICE.scene.mode in ("signal", "vector")
        and record.delay
        and not request.delay
    ):
        notice = "该连接会形成代数环，已自动设为单步延迟"
    snapshot = SERVICE.snapshot()
    snapshot["edge"] = record.snapshot()
    snapshot["notice"] = notice
    return snapshot


@app.patch("/api/edges/{edge_id}")
def update_edge(edge_id: str, request: EdgeUpdate) -> dict[str, Any]:
    payload = request.model_dump(exclude_unset=True)
    record = SERVICE.mutate(lambda scene: scene.update_edge(edge_id, payload))
    return {
        "edge": record.snapshot(),
        "sim": SERVICE.info(),
        "revision": SERVICE.scene.revision,
    }


@app.delete("/api/edges/{edge_id}")
def delete_edge(edge_id: str) -> dict[str, Any]:
    SERVICE.mutate(lambda scene: scene.delete_edge(edge_id))
    return SERVICE.snapshot()


@app.post("/api/positions")
def update_positions(request: PositionsUpdate) -> dict[str, Any]:
    items = [
        {"id": item.id, "position": item.position} for item in request.positions
    ]
    SERVICE.mutate(lambda scene: scene.update_positions(items))
    return {"ok": True, "revision": SERVICE.scene.revision}


# ---- 模板与场景 ------------------------------------------------------------
@app.get("/api/templates")
def templates() -> dict[str, Any]:
    return {"templates": template_catalog()}


@app.post("/api/templates/{name}")
def load_template(name: str) -> dict[str, Any]:
    if name not in TEMPLATES:
        raise NotFoundError(f"模板 {name!r} 不存在")
    SERVICE.load_scene(build_template(name))
    return SERVICE.snapshot()


@app.get("/api/scene/export")
def export_scene(include_state: bool = Query(default=False)) -> dict[str, Any]:
    return SERVICE.scene.to_payload(include_state=include_state)


@app.post("/api/scene")
def import_scene(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    if len(str(payload)) > 2_000_000:
        raise ValidationError("场景文件过大")
    SERVICE.load_scene(payload)
    return SERVICE.snapshot()


@app.post("/api/scene/migrate-devices")
def migrate_scene_devices() -> dict[str, Any]:
    """R20：把当前电路场景从「边=元件」迁移为「器件节点 + 引脚导线」。"""
    scene = SERVICE.scene
    if scene.mode != "circuit":
        raise ValidationError("只有电路场景可以迁移为器件模型")
    before = scene.to_payload(include_state=False)
    before_devices = sum(1 for node in before.get("nodes") or [] if node.get("kind") == "device")
    migrated = migrate_scene_to_devices(before)
    devices = sum(1 for node in migrated.get("nodes") or [] if node.get("kind") == "device")
    wires = sum(1 for edge in migrated.get("edges") or [] if edge.get("kind") == "wire")
    SERVICE.load_scene(migrated)
    snapshot = SERVICE.snapshot()
    snapshot["migration"] = {
        "converted": devices - before_devices,
        "devices": devices,
        "wires": wires,
    }
    return snapshot


@app.post("/api/scene/clear")
def clear_scene() -> dict[str, Any]:
    name = "blank_signal" if SERVICE.scene.mode == "signal" else "blank_circuit"
    SERVICE.load_scene(build_template(name))
    return SERVICE.snapshot()


@app.patch("/api/scene")
def update_scene_settings(request: IntegrationRequest) -> dict[str, Any]:
    SERVICE.mutate(lambda scene: scene.set_integration(request.integration))
    return SERVICE.snapshot()


# ---- 工程文件 --------------------------------------------------------------
def _extension_payload() -> list[dict[str, Any]]:
    return [
        {
            "kind": item["kind"],
            "type": item["type"],
            "code": item["source"],
            "sha256": item["sha256"],
            "filename": item["filename"],
        }
        for item in extensions.list_extensions()
    ]


def _project_payload(request: ProjectExportRequest | None = None) -> dict[str, Any]:
    request = request or ProjectExportRequest()
    extension_items = request.extensions or _extension_payload()
    library = _library_path()
    from . import blocklib

    with SERVICE.lock:
        block_payloads = SERVICE.scene.blocks.export_user()
    blocklib.ensure_blocks(library, block_payloads)
    project = SERVICE.build_project(
        name=request.name,
        fem=FEM,
        ui=request.ui,
        extensions=extension_items,
        created=request.created,
        library=str(library),
    )
    if request.blocks:
        project["blocks"] = copy.deepcopy(request.blocks)
        project.pop("checksum", None)
        project["checksum"] = compute_checksum(project)
    return project


@app.get("/api/project")
def project_export_get() -> dict[str, Any]:
    return {"project": _project_payload()}


@app.post("/api/project/export")
def project_export(request: ProjectExportRequest) -> dict[str, Any]:
    return {"project": _project_payload(request)}


@app.post("/api/project/validate")
def project_validate(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    project = validate_project(payload)
    scene = project_current_network(project).get("scene") or {}
    return {
        "ok": True,
        "summary": {
            "name": project.get("name"),
            "version": project.get("version"),
            "mode": scene.get("mode"),
            "networks": len(project.get("networks") or []),
            "nodes": len(scene.get("nodes") or []),
            "edges": len(scene.get("edges") or []),
            "blocks": len(project.get("blocks") or []),
            "extensions": len(project.get("extensions") or []),
            "modified": project.get("modified"),
        },
    }


def _apply_project(
    project: dict[str, Any],
    trust_extensions: bool,
    library: str | None = None,
    *,
    allow_fallback: bool = True,
) -> dict[str, Any]:
    """把已校验工程装进运行中的服务；供导入与打开工程共用。"""
    extension_items = project.get("extensions") or []
    if extension_items and not trust_extensions:
        raise ValidationError(
            "工程包含 Python 扩展代码。扩展会在本进程执行，不是沙箱；"
            "确认来源可信后，使用 trust_extensions=true 重新导入。"
        )
    if extension_items:
        extensions.activate_project_extensions(extension_items)
    library = library or str(_library_path())
    degraded = None
    try:
        project = validate_project(project, library=library)
    except ValidationError as exc:
        message = str(exc)
        if not allow_fallback or not any(
            marker in message for marker in ("缺失", "不存在", "库路径", "模块")
        ):
            raise
        # D7：缺失时降级只读打开，用占位块顶上；运行与编辑被禁用。
        project = validate_project(project, library=library, allow_degraded=True)
        degraded = project.get("degraded")
    # 先应用 FEM（失败时不破坏当前网络），再载入已通过校验的场景。
    fem_payload = project.get("fem") or {}
    if fem_payload:
        FEM.apply_config(fem_payload)
    SERVICE.load_project(project, library=library, allow_degraded=bool(degraded))
    global LAST_PROJECT, LAST_PROJECT_LIBRARY
    LAST_PROJECT = copy.deepcopy(project) if degraded else None
    LAST_PROJECT_LIBRARY = library
    return {
        "scene": SERVICE.scene.runtime_state(),
        "sim": SERVICE.info(),
        "networks": SERVICE.list_networks(),
        "current": SERVICE.current_id,
        "degraded": SERVICE.degraded,
        "fem": FEM.snapshot(include_mesh=False),
        "ui": project.get("ui") or {},
        "blocks": project.get("blocks") or [],
        "extensions": project.get("extensions") or [],
        "project": {
            "name": project.get("name"),
            "version": project.get("version"),
            "created": project.get("created"),
            "modified": project.get("modified"),
            "checksum": project.get("checksum"),
            "trusted_extensions": bool(trust_extensions),
        },
        "migration": {
            "rails": (project.get("metadata") or {}).get("rails_migration") or [],
        },
    }


@app.post("/api/project/retry")
def project_retry() -> dict[str, Any]:
    """降级只读工程在补齐库文件后重试：仍缺失 → 409；成功 → 解除只读。"""
    if not LAST_PROJECT:
        raise ConflictError("当前没有降级打开的工程")
    if not SERVICE.degraded:
        raise ConflictError("当前工程未处于降级只读模式")
    library = LAST_PROJECT_LIBRARY or str(_library_path())
    refs = [
        item
        for item in (LAST_PROJECT.get("blocks") or [])
        if isinstance(item, dict) and "nodes" not in item
    ]
    missing = blocklib.check_refs(library, refs)["missing"]
    if missing:
        raise ConflictError(
            "库文件仍缺失："
            + "、".join(f"{item['id']}@v{item['version']}" for item in missing)
            + "；补回后再重试"
        )
    payload = copy.deepcopy(LAST_PROJECT)
    payload.pop("degraded", None)
    payload["checksum"] = compute_checksum(payload)
    return _apply_project(payload, False, library=library, allow_fallback=False)


@app.post("/api/project/import")
def project_import(request: ProjectImportRequest) -> dict[str, Any]:
    return _apply_project(request.project, request.trust_extensions)


# ---- 多网络（R07 / D18） ----------------------------------------------------
class NetworkCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None


class NetworkRenameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str


@app.get("/api/networks")
def networks_list() -> dict[str, Any]:
    return {
        "networks": SERVICE.list_networks(),
        "current": SERVICE.current_id,
        "degraded": SERVICE.degraded,
        "sim": SERVICE.info(),
    }


@app.post("/api/networks")
def networks_create(request: NetworkCreateRequest) -> dict[str, Any]:
    created = SERVICE.add_network(request.name)
    return {"created": created["id"], "networks": SERVICE.list_networks()}


@app.patch("/api/networks/{network_id}")
def networks_rename(network_id: str, request: NetworkRenameRequest) -> dict[str, Any]:
    return SERVICE.rename_network(network_id, request.name)


@app.delete("/api/networks/{network_id}")
def networks_delete(network_id: str) -> dict[str, Any]:
    return SERVICE.remove_network(network_id)


@app.post("/api/networks/{network_id}/activate")
def networks_activate(network_id: str) -> dict[str, Any]:
    SERVICE.switch(network_id)
    return {"scene": SERVICE.scene.runtime_state(), "sim": SERVICE.info(), "networks": SERVICE.list_networks(), "current": SERVICE.current_id}


@app.post("/api/networks/run-all")
def networks_run_all() -> dict[str, Any]:
    return {"networks": SERVICE.run_all(), "sim": SERVICE.info()}


@app.post("/api/networks/pause-all")
def networks_pause_all() -> dict[str, Any]:
    return {"networks": SERVICE.pause_all(), "sim": SERVICE.info()}


# ---- 工作区（R01：工程目录 / 共享库 / 用户设置） ----------------------------
class WorkspaceCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    name: str | None = None
    library_root: str | None = None


class WorkspacePathRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    trust_extensions: bool = False
    library_root: str | None = None


class WorkspaceSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    name: str | None = None
    library_root: str | None = None


class WorkspaceSnapshotRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    name: str | None = None
    library_root: str | None = None


class WorkspaceRestoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    snapshot: str
    trust_extensions: bool = False
    library_root: str | None = None


@app.get("/api/workspace")
def workspace_info(path: str = Query("")) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "settings": load_settings(),
        "settings_file": str(settings_file()),
    }
    if not path.strip():
        return payload
    workspace = workspace_for(path)
    payload["workspace"] = workspace.as_dict()
    payload["library"] = scan_library(workspace)
    return payload


@app.post("/api/workspace/create")
def workspace_create(request: WorkspaceCreateRequest) -> dict[str, Any]:
    global CURRENT_WORKSPACE
    workspace, project = create_project(
        request.path,
        simulation=SERVICE,
        name=request.name,
        library_root=request.library_root,
    )
    CURRENT_WORKSPACE = workspace.root
    scene = project_current_network(project).get("scene") or {}
    return {
        "workspace": workspace.as_dict(),
        "library": scan_library(workspace),
        "project": {
            "name": project.get("name"),
            "checksum": project.get("checksum"),
            "networks": len(project.get("networks") or []),
            "nodes": len(scene.get("nodes") or []),
        },
    }


@app.post("/api/workspace/save")
def workspace_save(request: WorkspaceSaveRequest) -> dict[str, Any]:
    global CURRENT_WORKSPACE
    workspace, path = save_workspace(
        request.path,
        SERVICE,
        name=request.name,
        library_root=request.library_root,
    )
    CURRENT_WORKSPACE = workspace.root
    return {
        "workspace": workspace.as_dict(),
        "saved": str(path),
        "sim": SERVICE.info(),
    }


@app.post("/api/workspace/open")
def workspace_open(request: WorkspacePathRequest) -> dict[str, Any]:
    global CURRENT_WORKSPACE
    workspace, project = load_workspace(
        request.path, library_root=request.library_root
    )
    CURRENT_WORKSPACE = workspace.root
    result = _apply_project(project, request.trust_extensions, library=str(workspace.library))
    result["workspace"] = workspace.as_dict()
    result["library"] = scan_library(workspace)
    return result


@app.get("/api/workspace/snapshots")
def workspace_snapshots(path: str = Query(...)) -> dict[str, Any]:
    workspace = workspace_for(path)
    settings = load_settings()
    return {
        "workspace": workspace.as_dict(),
        "snapshots": list_snapshots(workspace),
        "autosave": {
            "enabled": bool(settings["autosave_enabled"]),
            "interval_seconds": int(settings["autosave_interval_seconds"]),
            "keep_recent": int(settings["autosave_keep_recent"]),
            "keep_daily": int(settings["autosave_keep_daily"]),
        },
    }


@app.post("/api/workspace/snapshot")
def workspace_snapshot(request: WorkspaceSnapshotRequest) -> dict[str, Any]:
    """快照式自动保存：只写工程 backups/，不动正本（R16 / D16）。"""
    workspace = workspace_for(request.path, library_root=request.library_root)
    if not workspace.project_file.is_file():
        raise ValidationError(f"工程文件不存在：{workspace.project_file}")
    settings = load_settings()
    project = SERVICE.build_project(name=request.name or "自动快照")
    saved = write_snapshot(workspace, project)
    removed = prune_snapshots(
        workspace,
        keep_recent=int(settings["autosave_keep_recent"]),
        keep_daily=int(settings["autosave_keep_daily"]),
    )
    return {
        "workspace": workspace.as_dict(),
        "saved": str(saved),
        "removed": removed,
        "snapshots": list_snapshots(workspace),
    }


@app.post("/api/workspace/restore")
def workspace_restore(request: WorkspaceRestoreRequest) -> dict[str, Any]:
    workspace = workspace_for(request.path, library_root=request.library_root)
    project = load_snapshot(workspace, request.snapshot)
    result = _apply_project(project, request.trust_extensions)
    result["workspace"] = workspace.as_dict()
    result["restored_from"] = request.snapshot
    return result


class ProfileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    reset: bool = False


class AnalysisExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    keys: list[str] | None = None
    t0: float | None = None
    t1: float | None = None
    decimate: int = 1
    name: str = "analysis"


def _analysis_call(function, label: str):
    try:
        return analysis.run_with_timeout(function, label=label)
    except analysis.AnalysisError as exc:
        raise ValidationError(str(exc)) from exc


def _analysis_context() -> dict[str, Any]:
    return {"sim": SERVICE.current, "name": _current_network_name()}


def _current_network_name() -> str:
    for item in SERVICE.list_networks():
        if item.get("id") == SERVICE.current_id:
            return str(item.get("name") or "网络")
    return "网络"


def _exports_dir() -> Path:
    base = CURRENT_WORKSPACE / "exports" if CURRENT_WORKSPACE is not None else Path.cwd() / "exports"
    return base


@app.get("/api/analysis/metrics")
def analysis_metrics(
    keys: str = Query(""),
    t0: float | None = None,
    t1: float | None = None,
) -> dict[str, Any]:
    wanted = [item.strip() for item in keys.split(",") if item.strip()] or None
    return _analysis_call(
        lambda: analysis.analyze_metrics(SERVICE.current, wanted, t0, t1),
        "指标计算",
    )


@app.get("/api/analysis/spectrum")
def analysis_spectrum(
    key: str = Query(...), t0: float | None = None, t1: float | None = None
) -> dict[str, Any]:
    return _analysis_call(lambda: analysis.spectrum(SERVICE.current, key, t0, t1), "频谱计算")


@app.get("/api/analysis/period")
def analysis_period(
    key: str = Query(...), t0: float | None = None, t1: float | None = None
) -> dict[str, Any]:
    return _analysis_call(lambda: analysis.recommend_period(SERVICE.current, key, t0, t1), "周期推荐")


@app.get("/api/analysis/math")
def analysis_math() -> dict[str, Any]:
    return _analysis_call(lambda: analysis.math_forms(SERVICE.current), "数学形式")


@app.get("/api/analysis/transfer")
def analysis_transfer(
    input: str = Query(...),
    output: str = Query(...),
    input_field: str = "voltage",
    output_field: str = "voltage",
) -> dict[str, Any]:
    return _analysis_call(
        lambda: analysis.transfer_function(
            SERVICE.current,
            input,
            output,
            input_field=input_field,
            output_field=output_field,
        ),
        "传递函数推导",
    )


@app.post("/api/analysis/export")
def analysis_export(request: AnalysisExportRequest) -> dict[str, Any]:
    def run() -> dict[str, Any]:
        return analysis.export_csv(
            SERVICE.current,
            directory=_exports_dir(),
            network_name=_current_network_name(),
            keys=request.keys,
            t0=request.t0,
            t1=request.t1,
            decimate=request.decimate,
            name=request.name,
        )

    return _analysis_call(run, "CSV 导出")


@app.get("/api/schematic/layout")
def schematic_layout_preview() -> dict[str, Any]:
    return schematic.auto_layout(SERVICE.scene)


@app.post("/api/schematic/layout")
def schematic_layout_apply() -> dict[str, Any]:
    layout = schematic.auto_layout(SERVICE.scene)
    if not layout.get("ok"):
        raise ValidationError(str(layout.get("reason") or "自动布局不可用"))
    applied = SERVICE.mutate(lambda scene: schematic.apply_layout(scene, layout))
    snapshot = SERVICE.snapshot()
    snapshot["layout"] = layout
    snapshot["applied"] = applied
    return snapshot


@app.get("/api/schematic/validate")
def schematic_validate() -> dict[str, Any]:
    return schematic.validate_schematic(SERVICE.scene)


@app.get("/api/profile")
def profile_state(top: int = Query(20)) -> dict[str, Any]:
    return profiling.snapshot(top)


@app.patch("/api/profile")
def profile_update(request: ProfileRequest) -> dict[str, Any]:
    if request.enabled is not None:
        profiling.set_enabled(request.enabled)
    if request.reset:
        profiling.clear()
    return profiling.snapshot()


class BlockImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    payload: dict[str, Any]
    library: str | None = None
    version: int | None = None


def _library_path(library: str | None = None) -> Path:
    if library:
        return Path(library).expanduser()
    configured = str(load_settings().get("library_root") or "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.cwd() / "library"


@app.get("/api/blocks")
def blocks_list(library: str = Query("")) -> dict[str, Any]:
    target = _library_path(library or None)
    return {"library": str(target), "blocks": blocklib.scan_library(target)}


class BlockValidateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    payload: dict[str, Any]
    library: str | None = None
    dry_run: bool = True
    save_report: bool = False


@app.post("/api/blocks/validate")
def blocks_validate(request: BlockValidateRequest) -> dict[str, Any]:
    report = block_validate.validate_block_payload(
        request.payload,
        library=str(_library_path(request.library)),
        dry_run=request.dry_run,
    )
    report["text"] = block_validate.report_as_text(report)
    report["library"] = str(_library_path(request.library))
    if request.save_report:
        target = (
            CURRENT_WORKSPACE / "exports"
            if CURRENT_WORKSPACE is not None
            else Path.cwd() / "exports"
        )
        target.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        block_info = report.get("block", {})
        name = f"block-validate-{block_info.get('id', 'unknown')}-v{block_info.get('version', 1)}-{stamp}.json"
        path = target / name
        path.write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        report["report_path"] = str(path)
    return report


class BlockOpenInternalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    library: str | None = None
    version: int | None = None


class BlockSaveCopyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    library: str | None = None
    name: str
    description: str = ""
    model: str | None = None


@app.post("/api/blocks/{block_id}/open-internal")
def blocks_open_internal(block_id: str, request: BlockOpenInternalRequest) -> dict[str, Any]:
    """把结构模型的内部打开成一个临时网络（D30：独立网络，不做面包屑）。"""
    target = _library_path(request.library)
    block = blocklib.load_block(target, block_id, request.version)
    if block.model != "structural":
        raise ConflictError(
            "该模块是行为模型（behavioral）：不提供内部视图。"
            "需要编辑内部时请用结构模型（structural）重新封装。"
        )
    payload = {
        "mode": block.mode,
        "nodes": copy.deepcopy(block.nodes),
        "edges": copy.deepcopy(block.edges),
        "blocks": [block.to_payload()],
    }
    created = SERVICE.add_network(f"模块 {block.name}")
    network_id = created["id"]
    simulation = SERVICE.simulation(network_id)
    simulation.load_scene(payload)
    SERVICE.switch(network_id)
    return {
        "network": network_id,
        "block_id": block.id,
        "block": block.summary(),
        "scene": SERVICE.scene.runtime_state(),
        "sim": SERVICE.info(),
        "networks": SERVICE.list_networks(),
    }


@app.post("/api/blocks/save-copy")
def blocks_save_copy(request: BlockSaveCopyRequest) -> dict[str, Any]:
    """把当前网络另存为新的模块副本（新 id、v1；D10 改内部=另存副本）。"""
    target = _library_path(request.library)
    with SERVICE.lock:
        scene = SERVICE.scene
        model = request.model or "structural"
        block = build_block_from_scene(
            scene,
            name=request.name,
            description=request.description,
            model=model,
        )
    path = blocklib.write_block(target, block)
    return {
        "block": block.summary(),
        "path": str(path),
        "library": str(target),
        "blocks": blocklib.scan_library(target),
    }


@app.get("/api/blocks/{block_id}/references")
def blocks_references(
    block_id: str,
    library: str = Query(""),
    projects_root: str = Query(""),
    version: int | None = None,
) -> dict[str, Any]:
    root = projects_root or str(Path.cwd())
    return {
        "block_id": block_id,
        "projects_root": root,
        "references": scan_block_references(root, block_id, version=version),
    }


class BlockDeleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    library: str | None = None
    version: int | None = None
    projects_root: str | None = None
    force: bool = False


class BlockRenameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    library: str | None = None
    version: int | None = None
    projects_root: str | None = None
    force: bool = False


class BlockOverwriteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    payload: dict[str, Any]
    library: str | None = None
    version: int | None = None
    projects_root: str | None = None
    force: bool = False


@app.post("/api/blocks/{block_id}/rename")
def blocks_rename(block_id: str, request: BlockRenameRequest) -> dict[str, Any]:
    """D6：改名先扫描引用；有引用默认拒绝，force 才执行。"""
    target = _library_path(request.library)
    references = scan_block_references(
        request.projects_root or str(Path.cwd()), block_id
    )
    if references and not request.force:
        raise ConflictError(
            "该模块仍被工程引用："
            + "、".join(item["name"] for item in references[:5])
            + "；确认改名请带 force=true"
        )
    block = blocklib.rename_block(target, block_id, request.name, version=request.version)
    return {
        "block": block.summary(),
        "references": references,
        "library": str(target),
        "blocks": blocklib.scan_library(target),
    }


@app.post("/api/blocks/{block_id}/overwrite")
def blocks_overwrite(block_id: str, request: BlockOverwriteRequest) -> dict[str, Any]:
    """D6/D10：同版本覆盖必须显式 force；先扫描引用。"""
    target = _library_path(request.library)
    payload_id = str(request.payload.get("id") or "")
    if payload_id != block_id:
        raise ValidationError("覆盖内容的 block id 与路径不一致")
    version = int(request.version or request.payload.get("version") or 1)
    references = scan_block_references(
        request.projects_root or str(Path.cwd()), block_id, version=version
    )
    if references and not request.force:
        raise ConflictError(
            "该模块版本仍被工程引用："
            + "、".join(item["name"] for item in references[:5])
            + "；确认覆盖请带 force=true"
        )
    block = blocklib.overwrite_block(target, request.payload, version=version)
    return {
        "block": block.summary(),
        "references": references,
        "library": str(target),
    }


@app.post("/api/blocks/{block_id}/delete")
def blocks_delete(block_id: str, request: BlockDeleteRequest) -> dict[str, Any]:
    target = _library_path(request.library)
    references = scan_block_references(
        request.projects_root or str(Path.cwd()), block_id, version=request.version
    )
    if references and not request.force:
        raise ConflictError(
            "该模块仍被工程引用："
            + "、".join(item["name"] for item in references[:5])
            + "；确认要删除请带 force=true"
        )
    removed = blocklib.remove_block(target, block_id, request.version)
    return {"removed": removed, "references": references, "library": str(target)}


@app.post("/api/blocks/import")
def blocks_import(request: BlockImportRequest) -> dict[str, Any]:
    target = _library_path(request.library)
    result = blocklib.import_block(target, request.payload, version=request.version)
    result["library"] = str(target)
    result["blocks"] = blocklib.scan_library(target)
    return result


@app.get("/api/blocks/{block_id}")
def blocks_detail(block_id: str, library: str = Query(""), version: int | None = None) -> dict[str, Any]:
    target = _library_path(library or None)
    versions = blocklib.list_versions(target, block_id)
    block = blocklib.load_block(target, block_id, version)
    return {
        "library": str(target),
        "versions": versions,
        "block": block.to_payload(),
    }


class BlockInstanceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    block_id: str
    library: str | None = None
    version: int | None = None
    position: dict[str, float] | None = None
    name_prefix: str | None = None


class BlockEncapsulateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_ids: list[str]
    name: str
    description: str = ""
    library: str | None = None
    include_position: bool = True
    model: str = "behavioral"


@app.post("/api/blocks/instantiate")
def blocks_instantiate(request: BlockInstanceRequest) -> dict[str, Any]:
    target = _library_path(request.library)
    block = blocklib.load_block(target, request.block_id, request.version)

    def apply(scene):
        if scene.blocks.get(block.id) is None:
            scene.blocks.add(block)
        return instantiate_block(
            scene,
            block.id,
            position=request.position,
            name_prefix=request.name_prefix,
        )

    instance = SERVICE.mutate(apply)
    snapshot = SERVICE.snapshot()
    snapshot["instance"] = instance
    return snapshot


@app.post("/api/blocks/encapsulate")
def blocks_encapsulate(request: BlockEncapsulateRequest) -> dict[str, Any]:
    target = _library_path(request.library)

    def apply(scene):
        return encapsulate_nodes(
            scene,
            request.node_ids,
            name=request.name,
            description=request.description,
            include_position=request.include_position,
            model=request.model,
        )

    block = SERVICE.mutate(apply)
    imported = blocklib.import_block(target, block.to_payload())
    return {
        "block": block.summary(),
        "file": imported,
        "blocks": blocklib.scan_library(target),
        "scene": SERVICE.scene.runtime_state(),
        "sim": SERVICE.info(),
        "library": str(target),
    }


@app.get("/api/settings")
def settings_get() -> dict[str, Any]:
    return {"settings": load_settings(), "path": str(settings_file())}


@app.patch("/api/settings")
def settings_patch(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return {"settings": save_settings(payload), "path": str(settings_file())}


# ---- 加速后端 --------------------------------------------------------------
@app.get("/api/accel")
def accel_state() -> dict[str, Any]:
    return accel.status()


@app.patch("/api/accel")
def accel_configure(request: AccelRequest) -> dict[str, Any]:
    return accel.configure(request.policy)


# ---- 应用内 Python 扩展 ----------------------------------------------------
def _extension_in_use(kind: str) -> bool:
    with SERVICE.lock:
        if any(node.kind == kind for node in SERVICE.scene.nodes.values()):
            return True
        return any(edge.kind == kind for edge in SERVICE.scene.edges.values())


@app.get("/api/extensions")
def extensions_list() -> dict[str, Any]:
    return {
        "extensions": extensions.list_extensions(),
        "scan": extensions.scan_directory(),
        "notice": (
            "扩展代码在本进程执行，不是沙箱。只启用来源可信的代码；"
            "项目内嵌代码默认不执行。"
        ),
    }


@app.post("/api/extensions/validate")
def extensions_validate(request: ExtensionValidateRequest) -> dict[str, Any]:
    return extensions.validate_code(request.code)


@app.post("/api/extensions/activate")
def extensions_activate(request: ExtensionActivateRequest) -> dict[str, Any]:
    result = extensions.activate_code(
        request.code,
        filename=request.filename,
        persist=request.persist,
        kind_type=request.kind_type,
    )
    # 注册成功后立即重建引擎，让参数/源码错误在本次请求内暴露。
    try:
        SERVICE.mutate(lambda scene: None)
    except Exception:
        for kind in result.get("kinds") or []:
            extensions.deactivate(kind)
        raise
    return {
        "ok": True,
        "kinds": result.get("kinds") or [],
        "extensions": extensions.list_extensions(),
        "catalog": SERVICE.scene.catalog(),
    }


@app.post("/api/extensions/deactivate")
def extensions_deactivate(request: ExtensionDeactivateRequest) -> dict[str, Any]:
    if extensions.get_extension(request.kind) is None:
        raise NotFoundError(f"扩展 {request.kind!r} 不存在")
    if _extension_in_use(request.kind):
        raise ValidationError(
            f"扩展 {request.kind!r} 正在当前场景中使用，请先删除相关节点/连接"
        )
    result = extensions.deactivate(request.kind, remove_file=request.remove_file)
    SERVICE.mutate(lambda scene: None)
    return {
        "ok": True,
        "result": result,
        "extensions": extensions.list_extensions(),
        "catalog": SERVICE.scene.catalog(),
    }


@app.get("/api/extensions/{kind}")
def extensions_detail(kind: str) -> dict[str, Any]:
    item = extensions.get_extension(kind)
    if item is None:
        raise NotFoundError(f"扩展 {kind!r} 不存在")
    return item


@app.post("/api/extensions/scan")
def extensions_scan() -> dict[str, Any]:
    return extensions.scan_directory()


# ---- 二维有限元 ------------------------------------------------------------
@app.get("/api/fem/state")
def fem_state(include_mesh: bool = Query(default=True)) -> dict[str, Any]:
    return FEM.snapshot(include_mesh=include_mesh)


@app.get("/api/fem/live")
def fem_live(
    cursor: int = Query(default=0, ge=0),
    limit: int = Query(default=30, ge=1, le=120),
) -> dict[str, Any]:
    return FEM.live(cursor, limit)


@app.post("/api/fem/control")
def fem_control(request: ControlRequest) -> dict[str, Any]:
    if request.action == "run":
        FEM.start()
    elif request.action == "pause":
        FEM.pause()
    elif request.action == "toggle":
        FEM.toggle()
    elif request.action == "step":
        FEM.step_once(request.steps)
    elif request.action == "reset":
        FEM.reset()
    return {"fem": FEM.info()}


@app.patch("/api/fem/config")
def fem_config(request: FemConfigUpdate) -> dict[str, Any]:
    payload = request.model_dump(exclude_unset=True, exclude_none=True)
    config = FEM.apply_config(payload)
    return {"config": config, "fem": FEM.snapshot(include_mesh=True)}


@app.post("/api/shutdown")
def shutdown(request: ShutdownRequest, http_request: Request) -> dict[str, Any]:
    """关闭后台线程并终止服务进程，释放监听端口。仅允许本机调用。"""
    if not request.confirm:
        raise ValidationError("关闭服务需要 confirm=true")
    if _DESKTOP_TOKEN:
        raise ValidationError("桌面模式请直接关闭窗口，不要调用 /api/shutdown")
    client = http_request.client
    host = client.host if client is not None else ""
    if host not in ("127.0.0.1", "::1", "localhost"):
        raise ValidationError("只允许从本机关闭服务")
    SERVICE.shutdown()
    FEM.shutdown()

    def terminate() -> None:
        time.sleep(0.4)
        os._exit(0)

    threading.Thread(target=terminate, name="netlab-shutdown", daemon=True).start()
    return {"ok": True, "message": "服务正在关闭，端口即将释放"}
