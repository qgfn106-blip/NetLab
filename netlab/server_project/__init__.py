"""工程文件路由域：导出、校验、导入、重试与工程目录登记。

从 ``netlab.server`` 拆出，行为、请求模型与响应结构保持不变。模块级状态
（``_last_project`` / ``_last_project_library``）只属于本进程，供降级工程重试
使用；调用方必须先通过 :func:`init` 注入 ``NetworkContainer`` 与 FEM 实例。
"""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body
from pydantic import BaseModel, ConfigDict, Field

from ..core.common.limits import ConflictError, ValidationError
from ..core.model import blocklib, extensions
from ..core.model.project import (
    compute_checksum,
    project_current_network,
    validate_project,
)
from ..core.model.workspace import load_settings

router = APIRouter(tags=["project"])

_service: Any = None
_fem: Any = None
_last_project: dict[str, Any] | None = None
_last_project_library: str | None = None


def init(*, service: Any, fem: Any) -> None:
    """绑定当前服务实例；只在 ``netlab.server`` 启动时调用一次。"""
    global _service, _fem
    _service = service
    _fem = fem


class ProjectExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    ui: dict[str, Any] = Field(default_factory=dict)
    blocks: list[dict[str, Any]] = Field(default_factory=list)
    extensions: list[dict[str, Any]] = Field(default_factory=list)
    plugins: list[dict[str, Any]] = Field(default_factory=list)
    created: str | None = None


class ProjectImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project: dict[str, Any]
    trust_extensions: bool = False


class ProjectContextRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = ""


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


def _library_path(library: str | None = None) -> Path:
    if library:
        return Path(library).expanduser()
    configured = str(load_settings().get("library_root") or "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.cwd() / "library"


def _project_payload(request: ProjectExportRequest | None = None) -> dict[str, Any]:
    request = request or ProjectExportRequest()
    extension_items = request.extensions or _extension_payload()
    library = _library_path()

    with _service.lock:
        block_payloads = _service.scene.blocks.export_user()
    blocklib.ensure_blocks(library, block_payloads)
    project = _service.build_project(
        name=request.name,
        fem=_fem,
        ui=request.ui,
        extensions=extension_items,
        plugins=request.plugins,
        created=request.created,
        library=str(library),
    )
    if request.blocks:
        project["blocks"] = copy.deepcopy(request.blocks)
        project.pop("checksum", None)
        project["checksum"] = compute_checksum(project)
    return project


def apply_project(
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
        _fem.apply_config(fem_payload)
    _service.load_project(project, library=library, allow_degraded=bool(degraded))
    global _last_project, _last_project_library
    _last_project = copy.deepcopy(project) if degraded else None
    _last_project_library = library
    return {
        "scene": _service.scene.runtime_state(),
        "sim": _service.info(),
        "networks": _service.list_networks(),
        "current": _service.current_id,
        "degraded": _service.degraded,
        "fem": _fem.snapshot(include_mesh=False),
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


@router.get("/api/project")
def project_export_get() -> dict[str, Any]:
    return {"project": _project_payload()}


@router.post("/api/project/export")
def project_export(request: ProjectExportRequest) -> dict[str, Any]:
    return {"project": _project_payload(request)}


@router.post("/api/project/validate")
def project_validate(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    library = str(_library_path())
    degraded = None
    try:
        project = validate_project(payload, library=library)
    except ValidationError:
        # 只是看摘要：模块库缺失也应能出摘要，并说明「打开时会是降级只读」。
        project = validate_project(payload, library=library, allow_degraded=True)
        degraded = project.get("degraded")
    scene = project_current_network(project).get("scene") or {}
    return {
        "ok": True,
        "degraded": degraded,
        "scene": {
            "nodes": len(scene.get("nodes") or []),
            "edges": len(scene.get("edges") or []),
            "mode": scene.get("mode"),
        },
    }


@router.post("/api/project/retry")
def project_retry() -> dict[str, Any]:
    """降级只读工程在补齐库文件后重试：仍缺失 → 409；成功 → 解除只读。"""
    if not _last_project:
        raise ConflictError("当前没有降级打开的工程")
    if not _service.degraded:
        raise ConflictError("当前工程未处于降级只读模式")
    library = _last_project_library or str(_library_path())
    refs = [
        item
        for item in (_last_project.get("blocks") or [])
        if isinstance(item, dict) and "nodes" not in item
    ]
    missing = blocklib.check_refs(library, refs)["missing"]
    if missing:
        raise ConflictError(
            "库文件仍缺失："
            + "、".join(f"{item['id']}@v{item['version']}" for item in missing)
            + "；补回后再重试"
        )
    payload = copy.deepcopy(_last_project)
    payload.pop("degraded", None)
    payload["checksum"] = compute_checksum(payload)
    return apply_project(payload, False, library=library, allow_fallback=False)


@router.post("/api/project/import")
def project_import(request: ProjectImportRequest) -> dict[str, Any]:
    return apply_project(request.project, request.trust_extensions)


@router.post("/api/project/context")
def project_context(request: ProjectContextRequest) -> dict[str, Any]:
    """前端保存/打开工程后登记工程目录，决定 .netlab-states 的落点。"""
    return _service.set_project_dir(request.path)


__all__ = [
    "ProjectContextRequest",
    "ProjectExportRequest",
    "ProjectImportRequest",
    "apply_project",
    "init",
    "router",
]
