"""多网络管理路由（R07 / D18）。

从 ``netlab/server.py`` 拆出，路由路径、请求字段、响应结构和异常语义保持不变。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from ..core.common.limits import ValidationError


class NetworkCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    mode: str | None = None


class NetworkUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    mode: str | None = None


def build_router(*, service: Any) -> APIRouter:
    router = APIRouter(tags=["networks"])

    @router.get("/api/networks")
    def networks_list() -> dict[str, Any]:
        return {
            "networks": service.list_networks(),
            "current": service.current_id,
            "degraded": service.degraded,
            "sim": service.info(),
        }

    @router.post("/api/networks")
    def networks_create(request: NetworkCreateRequest) -> dict[str, Any]:
        created = service.add_network(request.name, request.mode)
        return {
            "created": created["id"],
            "mode": created.get("mode"),
            "networks": service.list_networks(),
        }

    @router.patch("/api/networks/{network_id}")
    def networks_update(
        network_id: str, request: NetworkUpdateRequest
    ) -> dict[str, Any]:
        result: dict[str, Any] | None = None
        if request.name is not None:
            result = service.rename_network(network_id, request.name)
        if request.mode is not None:
            result = service.set_network_mode(network_id, request.mode)
        if result is None:
            raise ValidationError("请至少提供 name 或 mode")
        return result

    @router.delete("/api/networks/{network_id}")
    def networks_delete(network_id: str) -> dict[str, Any]:
        return service.remove_network(network_id)

    @router.post("/api/networks/{network_id}/activate")
    def networks_activate(network_id: str) -> dict[str, Any]:
        service.switch(network_id)
        return {
            "scene": service.scene.runtime_state(),
            "sim": service.info(),
            "networks": service.list_networks(),
            "current": service.current_id,
        }

    @router.post("/api/networks/run-all")
    def networks_run_all() -> dict[str, Any]:
        return {"networks": service.run_all(), "sim": service.info()}

    @router.post("/api/networks/pause-all")
    def networks_pause_all() -> dict[str, Any]:
        return {"networks": service.pause_all(), "sim": service.info()}

    return router
