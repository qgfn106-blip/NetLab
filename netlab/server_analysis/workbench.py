"""分析工作台 HTTP 层：会话、状态、按状态执行分析、对比与失效。

旧接口（/api/analysis/tf、/loops、/nyquist）保持不变；本模块只新增
/api/analysis/workbench/*。分析执行使用状态内的电路快照构造独立的
Simulation，绝不修改当前工程或当前仿真。
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Query, Response
from pydantic import BaseModel, ConfigDict, Field

from ..core.common.limits import ValidationError
from ..core.compute import analysis
from ..core.compute.circuit.analysis_session import AnalysisSessionStore
from ..core.model.scene import Scene
from ..core.compute.simulation import Simulation
from .export_bundle import EXPORT_FORMATS, export_session

router = APIRouter(tags=["analysis-workbench"])
_sessions: AnalysisSessionStore = AnalysisSessionStore()
_analysis_runner = analysis


class SessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(default="分析会话", min_length=1, max_length=120)


class StateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(min_length=1)
    action: Literal["add", "update", "remove", "select"] = "add"
    state_id: str | None = None
    state: dict[str, Any] | None = None
    changes: dict[str, Any] | None = None
    select: bool = True


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(min_length=1)
    state_id: str | None = None
    kind: Literal[
        "bode", "time", "nyquist", "loop", "metrics", "poles", "loop_closed", "loop_step"
    ] = "bode"
    params: dict[str, Any] = Field(default_factory=dict)
    force: bool = False


class CompareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(min_length=1)
    state_ids: list[str] = Field(min_length=2, max_length=8)
    kind: Literal[
        "bode", "time", "nyquist", "loop", "metrics", "poles", "loop_closed", "loop_step"
    ] = "bode"
    include_stale: bool = True


class ExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(min_length=1)
    scope: Literal["subcanvas", "canvas"] = "subcanvas"
    canvas_id: str | None = None
    result_ids: list[str] = Field(default_factory=list)
    state_ids: list[str] = Field(default_factory=list)
    kind: Literal[
        "bode", "time", "nyquist", "loop", "metrics", "poles", "loop_closed", "loop_step"
    ] | None = None
    format: Literal["png", "svg", "pdf", "spec", "csv", "json", "zip"] = "png"
    layout: dict[str, Any] | None = None
    source_path: str | None = None
    title: str | None = None


class InvalidateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(min_length=1)
    reason: str = Field(default="电路已修改", max_length=200)


def _session(session_id: str):
    return _sessions.get(session_id)


def _state_payload_from_scene(sim: Simulation, *, label: str = "状态", **options: Any) -> dict[str, Any]:
    return {
        "label": label,
        "circuit": sim.scene.to_payload(include_state=False),
        **options,
    }


def _simulation_for_state(state: Any) -> Simulation:
    payload = state.circuit
    if not isinstance(payload, dict):
        raise ValidationError("状态快照必须是对象")
    mode = payload.get("mode") or "circuit"
    scene = Scene(str(mode))
    scene.load_payload(payload)
    return Simulation(scene)


def _run_state(state: Any, kind: str, params: dict[str, Any]) -> dict[str, Any]:
    sim = _simulation_for_state(state)
    ranges = dict(state.ranges or {})
    merged = {**ranges, **params}
    input_source = merged.get("input_source") or state.input_source
    output = merged.get("output") or state.output
    operating_point = merged.get("operating_point", state.operating_point)
    f_start = float(merged.get("f_start", 1.0))
    f_stop = float(merged.get("f_stop", 1_000_000.0))
    points = int(merged.get("points", 241))
    scale = str(merged.get("scale", "log"))
    if f_start <= 0 or f_stop <= 0 or f_stop <= f_start:
        raise ValidationError("频率范围必须满足 0 < f_start < f_stop")
    if points < 2 or points > 2001:
        raise ValidationError("频点数必须在 2..2001")

    def timeout_call(fn, label: str):
        try:
            return analysis.run_with_timeout(fn, label=label)
        except analysis.AnalysisError as exc:
            raise ValidationError(str(exc)) from exc

    if kind in ("bode", "time", "poles"):
        tf = timeout_call(
            lambda: analysis.tf_analysis(
                sim,
                mode="circuit",
                input_source=input_source,
                output=output,
                operating_point=operating_point,
                step_dt=float(merged.get("step_dt", 1.0e-5)),
                step_duration=float(merged.get("step_duration", 5.0e-3)),
                f_start=f_start,
                f_stop=f_stop,
                points=points,
                scale=scale,
                frequency_path=str(merged.get("frequency_path", "descriptor_linearized")),
            ),
            "传递函数分析",
        )
        envelope = (tf.get("envelopes") or {}).get(
            "time" if kind == "time" else "bode"
        )
        if not isinstance(envelope, dict):
            raise ValidationError("分析结果缺少 envelope")
        return {
            "ok": True,
            "kind": kind,
            "state_id": state.state_id,
            "envelope": envelope,
            "raw": tf,
            "source": tf.get("source"),
            "fingerprint": tf.get("fingerprint"),
        }

    element = merged.get("element") or state.loop_element
    feedback_sign = float(merged.get("feedback_sign", state.feedback_sign or 1.0))
    if kind in ("loop", "loop_closed", "loop_step"):
        display = {
            "loop": "loop",
            "loop_closed": "closed_loop",
            "loop_step": "step",
        }[kind]
        result = timeout_call(
            lambda: analysis.loop_analysis(
                sim,
                element=str(element or "__virtual__"),
                input_source=input_source,
                output=output,
                feedback_sign=feedback_sign,
                f_start=f_start,
                f_stop=f_stop,
                points=points,
                scale=scale,
                display=display,
                step_dt=float(merged.get("step_dt", 1.0e-5)),
                step_duration=float(merged.get("step_duration", 5.0e-3)),
                operating_point=operating_point,
            ),
            "闭环分析",
        )
        envelope = (result.get("envelopes") or {}).get(
            "time" if kind == "loop_step" else "bode"
        )
    elif kind == "nyquist":
        if not element:
            raise ValidationError("Nyquist 分析必须选择断环受控源")
        result = timeout_call(
            lambda: analysis.nyquist_analysis(
                sim,
                element=str(element),
                input_source=input_source,
                output=output,
                feedback_sign=feedback_sign,
                f_start=f_start,
                f_stop=f_stop,
                points=points,
                scale=scale,
                operating_point=operating_point,
            ),
            "Nyquist 分析",
        )
        envelope = (result.get("envelopes") or {}).get("nyquist")
    else:
        result = timeout_call(lambda: analysis.analyze_metrics(sim), "指标计算")
        return {
            "ok": True,
            "kind": "metrics",
            "state_id": state.state_id,
            "envelope": None,
            "raw": result,
            "fingerprint": None,
        }
    if not isinstance(envelope, dict):
        raise ValidationError("分析结果缺少 envelope")
    return {
        "ok": True,
        "kind": kind,
        "state_id": state.state_id,
        "envelope": envelope,
        "raw": result,
        "source": result.get("source"),
        "fingerprint": result.get("fingerprint"),
    }


@router.get("/api/analysis/workbench/sessions")
def workbench_sessions() -> dict[str, Any]:
    return {"ok": True, "sessions": _sessions.list()}


@router.post("/api/analysis/workbench/sessions")
def workbench_create_session(request: SessionRequest) -> dict[str, Any]:
    session = _sessions.create(request.name)
    return {"ok": True, "session": session.snapshot()}


@router.get("/api/analysis/workbench/session/{session_id}")
def workbench_session(session_id: str) -> dict[str, Any]:
    return {"ok": True, "session": _session(session_id).snapshot()}


@router.delete("/api/analysis/workbench/session/{session_id}")
def workbench_delete_session(session_id: str) -> dict[str, Any]:
    _sessions.drop(session_id)
    return {"ok": True}


@router.post("/api/analysis/workbench/state")
def workbench_state(request: StateRequest) -> dict[str, Any]:
    session = _session(request.session_id)
    if request.action == "add":
        if not request.state:
            raise ValidationError("add 需要 state")
        state = session.add_state(request.state, select=request.select)
        return {"ok": True, "state": state.to_dict(), "session": session.snapshot()}
    if not request.state_id:
        raise ValidationError(f"{request.action} 需要 state_id")
    if request.action == "update":
        if not request.changes:
            raise ValidationError("update 需要 changes")
        state = session.update_state(request.state_id, request.changes)
        return {"ok": True, "state": state.to_dict(), "session": session.snapshot()}
    if request.action == "remove":
        session.remove_state(request.state_id)
        return {"ok": True, "session": session.snapshot()}
    if request.action == "select":
        state = session.select_state(request.state_id)
        return {"ok": True, "state": state.to_dict(), "session": session.snapshot()}
    raise ValidationError("未知状态操作")


@router.post("/api/analysis/workbench/run")
def workbench_run(request: RunRequest) -> dict[str, Any]:
    session = _session(request.session_id)
    state = session.get_state(request.state_id)
    params = dict(request.params)
    result = session.compute(
        state.state_id,
        request.kind,
        lambda current: _run_state(current, request.kind, params),
        params=params,
        force=request.force,
    )
    return {"ok": True, **result}


@router.post("/api/analysis/workbench/compare")
def workbench_compare(request: CompareRequest) -> dict[str, Any]:
    session = _session(request.session_id)
    payload = session.compare(request.state_ids, request.kind, include_stale=request.include_stale)
    envelopes = []
    for state_id in request.state_ids:
        cached = session.cached(state_id, request.kind)
        if cached is None:
            continue
        envelope = cached.result.get("envelope")
        if isinstance(envelope, dict):
            envelopes.append(
                {
                    "state_id": state_id,
                    "label": session.get_state(state_id).label,
                    "stale": cached.stale,
                    "envelope": envelope,
                }
            )
    payload["envelopes"] = envelopes
    return {"ok": True, **payload}


@router.post("/api/analysis/workbench/invalidate")
def workbench_invalidate(request: InvalidateRequest) -> dict[str, Any]:
    session = _session(request.session_id)
    count = session.invalidate(request.reason)
    return {"ok": True, "invalidated": count, "session": session.snapshot()}




@router.post("/api/analysis/workbench/export")
def workbench_export(request: ExportRequest) -> Response:
    session = _session(request.session_id)
    artifact = export_session(
        session,
        format=request.format,
        result_ids=request.result_ids,
        state_ids=request.state_ids,
        kind=request.kind,
        layout=request.layout,
        source_path=request.source_path,
        title=request.title,
    )
    return Response(
        content=artifact.data,
        media_type=artifact.media_type,
        headers={"Content-Disposition": f'attachment; filename="{artifact.filename}"'},
    )


@router.get("/api/analysis/workbench/state-payload")
def workbench_state_payload(
    label: str = Query("状态"),
    select: bool = True,
) -> dict[str, Any]:
    """便捷入口：把当前仿真场景打包成可加入会话的状态。"""
    from . import _service  # type: ignore[attr-defined]

    if _service is None:
        raise ValidationError("服务尚未初始化")
    sim = _service.current
    return {
        "ok": True,
        "state": _state_payload_from_scene(sim, label=label, select=select),
    }


def install(*, store: AnalysisSessionStore | None = None) -> None:
    global _sessions
    if store is not None:
        _sessions = store
