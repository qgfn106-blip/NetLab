from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field

from ..core.common.limits import ValidationError
from ..core.compute import analysis

router = APIRouter(tags=["analysis"])
_service: Any = None
_current_workspace: Callable[[], Path | None] = lambda: None


class AnalysisExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    keys: list[str] | None = None
    t0: float | None = None
    t1: float | None = None
    decimate: int = 1
    name: str = "analysis"


class AnalysisTFRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["signal", "circuit"] = "signal"
    node: str | None = None
    input_node: str | None = None
    output_node: str | None = None
    input_source: str | None = None
    output: str | None = None
    operating_point: dict[str, float] | None = None
    step_dt: float = Field(default=1.0e-5, gt=0.0)
    step_duration: float = Field(default=5.0e-3, gt=0.0)
    f_start: float = Field(default=1.0, gt=0.0)
    f_stop: float = Field(default=1_000_000.0, gt=0.0)
    scale: Literal["log", "lin"] = "log"
    field: str | None = None
    expr: str | None = None
    numerator: list[float] | None = None
    denominator: list[float] | None = None
    zeros: list[float] | None = None
    poles: list[float] | None = None
    gain: float = 1.0
    method: str = "zoh"
    dt: float | None = None
    duration: float | None = None
    points: int = 240
    delay_pade_order: int = 3


class AnalysisPhaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    xs: list[float]
    ys: list[float]
    times: list[float] | None = None


class AnalysisFrequencyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input: str = Field(min_length=1)
    output: str = Field(min_length=1)
    f_start: float = Field(default=1.0, gt=0.0)
    f_stop: float = Field(default=1_000_000.0, gt=0.0)
    points: int = Field(default=241, ge=2, le=2001)
    scale: Literal["log", "lin"] = "log"
    input_field: str = "voltage"
    output_field: str = "voltage"


def _analysis_call(function, label: str):
    try:
        return analysis.run_with_timeout(function, label=label)
    except analysis.AnalysisError as exc:
        raise ValidationError(str(exc)) from exc


def _analysis_context() -> dict[str, Any]:
    return {"sim": _service.current, "name": _current_network_name()}


def _current_network_name() -> str:
    for item in _service.list_networks():
        if item.get("id") == _service.current_id:
            return str(item.get("name") or "网络")
    return "网络"


def _exports_dir() -> Path:
    workspace = _current_workspace()
    base = workspace / "exports" if workspace is not None else Path.cwd() / "exports"
    return base


@router.get("/api/analysis/metrics")
def analysis_metrics(
    keys: str = Query(""),
    t0: float | None = None,
    t1: float | None = None,
) -> dict[str, Any]:
    wanted = [item.strip() for item in keys.split(",") if item.strip()] or None
    return _analysis_call(
        lambda: analysis.analyze_metrics(_service.current, wanted, t0, t1),
        "指标计算",
    )


@router.get("/api/analysis/spectrum")
def analysis_spectrum(
    key: str = Query(...), t0: float | None = None, t1: float | None = None
) -> dict[str, Any]:
    return _analysis_call(
        lambda: analysis.spectrum(_service.current, key, t0, t1), "频谱计算"
    )


@router.get("/api/analysis/period")
def analysis_period(
    key: str = Query(...), t0: float | None = None, t1: float | None = None
) -> dict[str, Any]:
    return _analysis_call(
        lambda: analysis.recommend_period(_service.current, key, t0, t1), "周期推荐"
    )


@router.get("/api/analysis/math")
def analysis_math() -> dict[str, Any]:
    return _analysis_call(lambda: analysis.math_forms(_service.current), "数学形式")


@router.get("/api/analysis/transfer")
def analysis_transfer(
    input: str = Query(...),
    output: str = Query(...),
    input_field: str = "voltage",
    output_field: str = "voltage",
    domain: str = "s",
    delay_pade_order: int = 3,
) -> dict[str, Any]:
    return _analysis_call(
        lambda: analysis.transfer_function(
            _service.current,
            input,
            output,
            input_field=input_field,
            output_field=output_field,
            domain=domain,
            delay_pade_order=delay_pade_order,
        ),
        "传递函数推导",
    )


@router.post("/api/analysis/tf")
def analysis_tf(request: AnalysisTFRequest) -> dict[str, Any]:
    return _analysis_call(
        lambda: analysis.tf_analysis(
            _service.current,
            mode=request.mode,
            node=request.node,
            input_node=request.input_node,
            output_node=request.output_node,
            input_source=request.input_source,
            output=request.output,
            operating_point=request.operating_point,
            step_dt=request.step_dt,
            step_duration=request.step_duration,
            f_start=request.f_start,
            f_stop=request.f_stop,
            scale=request.scale,
            field=request.field,
            expr=request.expr,
            numerator=request.numerator,
            denominator=request.denominator,
            zeros=request.zeros,
            poles=request.poles,
            gain=request.gain,
            method=request.method,
            dt=request.dt,
            duration=request.duration,
            points=request.points,
            delay_pade_order=request.delay_pade_order,
        ),
        "传递函数分析",
    )


@router.post("/api/analysis/phase")
def analysis_phase(request: AnalysisPhaseRequest) -> dict[str, Any]:
    return _analysis_call(
        lambda: analysis.phase_metrics(request.xs, request.ys, request.times),
        "相平面指标",
    )


@router.post("/api/analysis/frequency")
def analysis_frequency(request: AnalysisFrequencyRequest) -> dict[str, Any]:
    return _analysis_call(
        lambda: analysis.frequency_response(
            _service.current,
            request.input,
            request.output,
            f_start=request.f_start,
            f_stop=request.f_stop,
            points=request.points,
            scale=request.scale,
            input_field=request.input_field,
            output_field=request.output_field,
        ),
        "频响分析",
    )


@router.post("/api/analysis/export")
def analysis_export(request: AnalysisExportRequest) -> dict[str, Any]:
    def run() -> dict[str, Any]:
        return analysis.export_csv(
            _service.current,
            directory=_exports_dir(),
            network_name=_current_network_name(),
            keys=request.keys,
            t0=request.t0,
            t1=request.t1,
            decimate=request.decimate,
            name=request.name,
        )

    return _analysis_call(run, "CSV 导出")


def build_router(
    *, service: Any, current_workspace: Callable[[], Path | None]
) -> APIRouter:
    global _service, _current_workspace
    _service = service
    _current_workspace = current_workspace
    return router
