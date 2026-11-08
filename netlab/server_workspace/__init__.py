"""工作区路由（R01：工程目录 / 共享库 / 用户设置）。

从 ``netlab/server.py`` 拆出，路由路径、请求字段、响应结构和异常语义保持不变。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict

from ..core.common.limits import ConflictError, ValidationError
from ..core.model.project import project_current_network
from ..core.model.workspace import (
    create_project,
    list_snapshots,
    load_settings,
    load_snapshot,
    load_workspace,
    prune_snapshots,
    save_workspace,
    scan_library,
    settings_file,
    workspace_for,
    write_snapshot,
)

ApplyProject = Callable[..., dict[str, Any]]
SetWorkspace = Callable[[Path], None]


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


def build_router(
    *,
    service: Any,
    apply_project: ApplyProject,
    set_current_workspace: SetWorkspace,
) -> APIRouter:
    router = APIRouter(tags=["workspace"])

    @router.get("/api/workspace")
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

    @router.post("/api/workspace/create")
    def workspace_create(request: WorkspaceCreateRequest) -> dict[str, Any]:
        workspace, project = create_project(
            request.path,
            simulation=service,
            name=request.name,
            library_root=request.library_root,
        )
        set_current_workspace(workspace.root)
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

    @router.post("/api/workspace/save")
    def workspace_save(request: WorkspaceSaveRequest) -> dict[str, Any]:
        if service.degraded:
            raise ConflictError(
                "工程处于降级只读模式：请先补回缺失的库文件，或确认用占位块替换后再保存"
            )
        workspace, path = save_workspace(
            request.path,
            service,
            name=request.name,
            library_root=request.library_root,
        )
        set_current_workspace(workspace.root)
        return {
            "workspace": workspace.as_dict(),
            "saved": str(path),
            "sim": service.info(),
        }

    @router.post("/api/workspace/open")
    def workspace_open(request: WorkspacePathRequest) -> dict[str, Any]:
        workspace, project = load_workspace(
            request.path, library_root=request.library_root
        )
        result = apply_project(
            project, request.trust_extensions, library=str(workspace.library)
        )
        set_current_workspace(workspace.root)
        result["workspace"] = workspace.as_dict()
        result["library"] = scan_library(workspace)
        return result

    @router.get("/api/workspace/snapshots")
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

    @router.post("/api/workspace/snapshot")
    def workspace_snapshot(request: WorkspaceSnapshotRequest) -> dict[str, Any]:
        """快照式自动保存：只写工程 backups/，不动正本（R16 / D16）。"""
        workspace = workspace_for(request.path, library_root=request.library_root)
        if not workspace.project_file.is_file():
            raise ValidationError(f"工程文件不存在：{workspace.project_file}")
        settings = load_settings()
        project = service.build_project(name=request.name or "自动快照")
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

    @router.post("/api/workspace/restore")
    def workspace_restore(request: WorkspaceRestoreRequest) -> dict[str, Any]:
        workspace = workspace_for(request.path, library_root=request.library_root)
        project = load_snapshot(workspace, request.snapshot)
        result = apply_project(
            project,
            request.trust_extensions,
            library=str(workspace.library),
        )
        set_current_workspace(workspace.root)
        result["workspace"] = workspace.as_dict()
        result["restored_from"] = request.snapshot
        return result

    return router
