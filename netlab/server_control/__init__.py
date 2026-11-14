"""仿真控制、求解窗口与分析入口的 HTTP 路由。"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict

from ..core.common.limits import ConflictError, ValidationError
from ..core.model.templates import build_template


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
    interpolation_method: str | None = None
    interpolation_rounds: int = 1
    interpolation_window: float | None = None


class ControlRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal[
        "run", "pause", "toggle", "step", "reset", "zero", "cancel_precompute"
    ]
    steps: int | None = None


class ModeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["signal", "circuit", "vector"]


def build_router(*, service: Any) -> APIRouter:
    router = APIRouter(tags=["control"])

    @router.post("/api/control")
    def control(request: ControlRequest) -> dict[str, Any]:
        if service.degraded and request.action in ("run", "step", "toggle"):
            raise ConflictError(
                "工程处于降级只读模式（库文件缺失）：补回库文件或确认替换占位块后才能运行"
            )
        if request.action == "run":
            service.start()
        elif request.action == "pause":
            service.pause()
        elif request.action == "toggle":
            service.toggle()
        elif request.action == "step":
            service.step_once(request.steps)
        elif request.action == "zero":
            service.zero_time()
        elif request.action == "reset":
            service.reset()
        elif request.action == "cancel_precompute":
            service.cancel_precompute()
        return {"sim": service.info()}

    @router.post("/api/solve-window")
    def solve_window(request: SolveWindowRequest) -> dict[str, Any]:
        if service.degraded:
            raise ConflictError("工程处于降级只读模式，不能预计算")
        result = service.precompute(
            request.duration,
            request.dt,
            request.sample_every,
            interpolation_method=request.interpolation_method,
            interpolation_rounds=request.interpolation_rounds,
            interpolation_window=request.interpolation_window,
        )
        return {"result": result, "sim": service.info()}

    @router.get("/api/operating-point")
    def operating_point() -> dict[str, Any]:
        """DC 工作点：不推进仿真时间，只解一次静态电路。"""
        if service.degraded:
            raise ConflictError("工程处于降级只读模式，不能做 DC 工作点分析")
        return {"result": service.current.operating_point(), "sim": service.info()}

    @router.get("/api/ac-sweep")
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

        if service.degraded:
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
        result = service.current.ac_sweep(
            frequencies, input_source=input, probes=wanted
        )
        return {"result": result, "sim": service.info()}

    @router.patch("/api/config")
    def update_config(request: ConfigUpdate) -> dict[str, Any]:
        payload = request.model_dump(exclude_unset=True, exclude_none=True)
        config = service.apply_config(payload)
        return {"config": config, "sim": service.info()}

    @router.post("/api/mode")
    def switch_mode(request: ModeRequest) -> dict[str, Any]:
        name = {
            "signal": "blank_signal",
            "circuit": "blank_circuit",
            "vector": "blank_vector",
        }[request.mode]
        payload = build_template(name)
        service.load_scene(payload)
        return service.snapshot()

    return router
