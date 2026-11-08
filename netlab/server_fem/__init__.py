"""二维有限元 REST 路由。

从 ``netlab.server`` 拆出的独立路由域，保持路径、请求字段和响应结构不变。
"""
from __future__ import annotations

from typing import Any, Callable, Literal

from fastapi import APIRouter, Query
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict


class FemControlRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal[
        "run", "pause", "toggle", "step", "reset", "zero", "cancel_precompute"
    ]
    steps: int | None = None


class FemConfigUpdateRequest(BaseModel):
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


def build_router(*, fem: Any, fast_json: Callable[[Any], Response]) -> APIRouter:
    """构造二维有限元路由；依赖由服务端注入，避免循环 import。"""
    router = APIRouter(tags=["fem"])

    @router.get("/api/fem/state")
    def fem_state(include_mesh: bool = Query(default=True)) -> Response:
        return fast_json(fem.snapshot(include_mesh=include_mesh))

    @router.get("/api/fem/live")
    def fem_live(
        cursor: int = Query(default=0, ge=0),
        limit: int = Query(default=30, ge=1, le=120),
    ) -> Response:
        return fast_json(fem.live(cursor, limit))

    @router.post("/api/fem/control")
    def fem_control(request: FemControlRequest) -> dict[str, Any]:
        if request.action == "run":
            fem.start()
        elif request.action == "pause":
            fem.pause()
        elif request.action == "toggle":
            fem.toggle()
        elif request.action == "step":
            fem.step_once(request.steps)
        elif request.action == "reset":
            fem.reset()
        return {"fem": fem.info()}

    @router.patch("/api/fem/config")
    def fem_config(request: FemConfigUpdateRequest) -> dict[str, Any]:
        payload = request.model_dump(exclude_unset=True, exclude_none=True)
        config = fem.apply_config(payload)
        return {"config": config, "fem": fem.snapshot(include_mesh=True)}

    return router
