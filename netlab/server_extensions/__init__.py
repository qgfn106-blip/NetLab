"""应用内 Python 扩展的 HTTP 路由。"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from ..core.common.limits import NotFoundError, ValidationError
from ..core.model import extensions


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


def build_router(*, service: Any) -> APIRouter:
    router = APIRouter(tags=["extensions"])

    def in_use(kind: str) -> bool:
        with service.lock:
            if any(node.kind == kind for node in service.scene.nodes.values()):
                return True
            return any(edge.kind == kind for edge in service.scene.edges.values())

    @router.get("/api/extensions")
    def extensions_list() -> dict[str, Any]:
        return {
            "extensions": extensions.list_extensions(),
            "scan": extensions.scan_directory(),
            "notice": (
                "扩展代码在本进程执行，不是沙箱。只启用来源可信的代码；"
                "项目内嵌代码默认不执行。"
            ),
        }

    @router.post("/api/extensions/validate")
    def extensions_validate(request: ExtensionValidateRequest) -> dict[str, Any]:
        return extensions.validate_code(request.code)

    @router.post("/api/extensions/activate")
    def extensions_activate(request: ExtensionActivateRequest) -> dict[str, Any]:
        result = extensions.activate_code(
            request.code,
            filename=request.filename,
            persist=request.persist,
            kind_type=request.kind_type,
        )
        # 注册成功后立即重建引擎，让参数/源码错误在本次请求内暴露。
        try:
            service.mutate(lambda scene: None)
        except Exception:
            for kind in result.get("kinds") or []:
                extensions.deactivate(kind)
            raise
        return {
            "ok": True,
            "kinds": result.get("kinds") or [],
            "extensions": extensions.list_extensions(),
            "catalog": service.scene.catalog(),
        }

    @router.post("/api/extensions/deactivate")
    def extensions_deactivate(request: ExtensionDeactivateRequest) -> dict[str, Any]:
        if extensions.get_extension(request.kind) is None:
            raise NotFoundError(f"扩展 {request.kind!r} 不存在")
        if in_use(request.kind):
            raise ValidationError(
                f"扩展 {request.kind!r} 正在当前场景中使用，请先删除相关节点/连接"
            )
        result = extensions.deactivate(request.kind, remove_file=request.remove_file)
        service.mutate(lambda scene: None)
        return {
            "ok": True,
            "result": result,
            "extensions": extensions.list_extensions(),
            "catalog": service.scene.catalog(),
        }

    @router.get("/api/extensions/{kind}")
    def extensions_detail(kind: str) -> dict[str, Any]:
        item = extensions.get_extension(kind)
        if item is None:
            raise NotFoundError(f"扩展 {kind!r} 不存在")
        return item

    @router.post("/api/extensions/scan")
    def extensions_scan() -> dict[str, Any]:
        return extensions.scan_directory()

    return router
