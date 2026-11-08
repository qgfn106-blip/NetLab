"""偏好与布局路由（D143）。

只搬运既有实现，不改变路由路径、请求模型或响应结构。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Query
from pydantic import BaseModel, ConfigDict

from ..core.common.limits import ValidationError
from ..core.compute import profiling
from ..core.model import schematic
from ..core.model.workspace import load_settings, save_settings, settings_file


class ProfileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    reset: bool = False


def build_router(*, service: Any) -> APIRouter:
    router = APIRouter(tags=["preferences"])

    @router.get("/api/schematic/layout")
    def schematic_layout_preview() -> dict[str, Any]:
        return schematic.auto_layout(service.scene)

    @router.post("/api/schematic/layout")
    def schematic_layout_apply() -> dict[str, Any]:
        layout = schematic.auto_layout(service.scene)
        if not layout.get("ok"):
            raise ValidationError(str(layout.get("reason") or "自动布局不可用"))
        applied = service.mutate(lambda scene: schematic.apply_layout(scene, layout))
        snapshot = service.snapshot()
        snapshot["layout"] = layout
        snapshot["applied"] = applied
        return snapshot

    @router.get("/api/schematic/validate")
    def schematic_validate() -> dict[str, Any]:
        return schematic.validate_schematic(service.scene)

    @router.get("/api/profile")
    def profile_state(top: int = Query(20)) -> dict[str, Any]:
        return profiling.snapshot(top)

    @router.patch("/api/profile")
    def profile_update(request: ProfileRequest) -> dict[str, Any]:
        if request.enabled is not None:
            profiling.set_enabled(request.enabled)
        if request.reset:
            profiling.clear()
        return profiling.snapshot()

    @router.get("/api/settings")
    def settings_get() -> dict[str, Any]:
        return {"settings": load_settings(), "path": str(settings_file())}

    @router.patch("/api/settings")
    def settings_patch(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return {"settings": save_settings(payload), "path": str(settings_file())}

    return router
