"""块库与块操作 API 路由。

从 ``netlab/server.py`` 拆出的 C-1 路由域；行为与请求/响应语义保持不变。
调用方注入 ``service``（NetworkContainer）与 ``current_workspace`` 读取器。
"""

from __future__ import annotations

import copy
import json
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field

from ..core.common.limits import ConflictError, ValidationError
from ..core.model import block_validate, blocklib
from ..core.model.blocks import (
    build_block_from_scene,
    encapsulate_nodes,
    instantiate_block,
)
from ..core.model.workspace import load_settings, scan_block_references


router = APIRouter(tags=["blocks"])


def build_router(*, service: Any, current_workspace: Any) -> APIRouter:
    global _service, _current_workspace
    _service = service
    _current_workspace = current_workspace
    return router


_service: Any = None
_current_workspace: Any = None


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


@router.get("/api/blocks")
def blocks_list(library: str = Query("")) -> dict[str, Any]:
    target = _library_path(library or None)
    return {
        "library": str(target),
        "blocks": blocklib.scan_library(target, include_builtin=True),
    }


class BlockValidateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    payload: dict[str, Any]
    library: str | None = None
    dry_run: bool = True
    save_report: bool = False


@router.post("/api/blocks/validate")
def blocks_validate(request: BlockValidateRequest) -> dict[str, Any]:
    report = block_validate.validate_block_payload(
        request.payload,
        library=str(_library_path(request.library)),
        dry_run=request.dry_run,
    )
    report["text"] = block_validate.report_as_text(report)
    report["library"] = str(_library_path(request.library))
    if request.save_report:
        workspace = _current_workspace()
        target = (
            workspace / "exports"
            if workspace is not None
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


@router.post("/api/blocks/{block_id}/open-internal")
def blocks_open_internal(
    block_id: str, request: BlockOpenInternalRequest
) -> dict[str, Any]:
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
    created = _service.add_network(f"模块 {block.name}")
    network_id = created["id"]
    simulation = _service.simulation(network_id)
    try:
        simulation.load_scene(payload)
        _service.switch(network_id)
    except Exception:
        # 载入失败（例如内部网络缺接地）时把临时网络回滚掉，避免留下空壳网络
        if network_id in {item["id"] for item in _service.list_networks()}:
            _service.remove_network(network_id)
        raise
    return {
        "network": network_id,
        "block_id": block.id,
        "block": block.summary(),
        "scene": _service.scene.runtime_state(),
        "sim": _service.info(),
        "networks": _service.list_networks(),
    }


class BlockCompareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    duration: float = Field(0.02, gt=0, le=10)
    dt: float = Field(0.001, gt=0, le=1)
    inputs: dict[str, dict[str, Any]] | None = None
    library: str | None = None


@router.post("/api/blocks/{block_id}/compare")
def blocks_compare(block_id: str, request: BlockCompareRequest) -> dict[str, Any]:
    """对比内置块的行为快速模型与 structural 内部场景。"""
    from ..core.model.blocks import compare_block_modes

    target = _library_path(request.library)
    block = blocklib.load_block(target, block_id)
    return compare_block_modes(
        block,
        duration=request.duration,
        dt=request.dt,
        inputs=request.inputs,
    )


@router.post("/api/blocks/save-copy")
def blocks_save_copy(request: BlockSaveCopyRequest) -> dict[str, Any]:
    """把当前网络另存为新的模块副本（新 id、v1；D10 改内部=另存副本）。"""
    target = _library_path(request.library)
    with _service.lock:
        scene = _service.scene
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
        "blocks": blocklib.scan_library(target, include_builtin=True),
    }


@router.get("/api/blocks/{block_id}/references")
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


@router.post("/api/blocks/{block_id}/rename")
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
    block = blocklib.rename_block(
        target, block_id, request.name, version=request.version
    )
    return {
        "block": block.summary(),
        "references": references,
        "library": str(target),
        "blocks": blocklib.scan_library(target, include_builtin=True),
    }


@router.post("/api/blocks/{block_id}/overwrite")
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


@router.post("/api/blocks/{block_id}/delete")
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


@router.post("/api/blocks/import")
def blocks_import(request: BlockImportRequest) -> dict[str, Any]:
    target = _library_path(request.library)
    result = blocklib.import_block(target, request.payload, version=request.version)
    result["library"] = str(target)
    result["blocks"] = blocklib.scan_library(target, include_builtin=True)
    return result


@router.get("/api/blocks/{block_id}")
def blocks_detail(
    block_id: str, library: str = Query(""), version: int | None = None
) -> dict[str, Any]:
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


@router.post("/api/blocks/instantiate")
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

    instance = _service.mutate(apply)
    snapshot = _service.snapshot()
    snapshot["instance"] = instance
    return snapshot


@router.post("/api/blocks/encapsulate")
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

    block = _service.mutate(apply)
    imported = blocklib.import_block(target, block.to_payload())
    return {
        "block": block.summary(),
        "file": imported,
        "blocks": blocklib.scan_library(target, include_builtin=True),
        "scene": _service.scene.runtime_state(),
        "sim": _service.info(),
        "library": str(target),
    }
