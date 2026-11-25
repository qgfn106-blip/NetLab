"""P3-02 analysis 分层模块（由 analysis.py 抽出，公共 API 不变）。"""
from __future__ import annotations

import math
import threading
import time
from pathlib import Path
from typing import Any, Callable

import numpy as np

from .frequency_diag import (
    cond_enabled as _freq_diag_enabled,
    point_diagnostics as _freq_point,
    summarize as _freq_summarize,
)
from . import complex_support as complex_layer
from . import transfer as transfer_math
from .exact_input import to_exact as _to_exact
from .circuit.descriptor import DescriptorModel
from .circuit.analysis_envelopes import bode_envelope, scene_fingerprint, step_envelope
from .circuit.fft_frequency import approximation_envelope, estimate_transfer_fft, multisine
from .circuit.loop_analysis import (
    branch_candidates,
    break_candidates,
    extract_branch_loop,
    extract_controlled_source_loop,
)
from .circuit.nyquist import nyquist_envelope, stability_margins
from .circuit.analysis_contract import curve, warning
from .circuit.descriptor_analysis import (
    UnsupportedAnalysisError,
    analyze_poles,
    analyze_zeros,
    build_output_matrices,
    descriptor_step_response,
    descriptor_transfer_function,
    descriptor_transient_response,
)
from ..common.limits import MAX_NODES, ComputeError, ValidationError
from .statespace import StateSpaceModel
from .analysis_errors import ANALYSIS_TIMEOUT, AnalysisError, MAX_EXPORT_ROWS
from .analysis_numerics import (
    _complex_list,
    _complex_pairs,
    _crossing,
    _frequency_axis,
    _number,
    _period_windows,
    _shift_score,
    _uniform,
)

from .analysis_envelopes import tf_analysis
from .analysis_transfer import frequency_response, transfer_function

from .analysis_loop_scan import (
    _analytic_loop_frequency_response,
    _loop_model,
    _resolve_loop_probe,
    _virtual_loop_analysis,
    break_points,
    loop_candidates,
    loop_from_break,
)


def loop_analysis(
    sim: Any,
    *,
    element: str | None = "",
    input_source: str | None = None,
    output: str | None = None,
    feedback_sign: float = 1.0,
    f_start: float = 1.0,
    f_stop: float = 1_000_000.0,
    points: int = 241,
    scale: str = "log",
    display: str = "loop",
    step_dt: float = 1.0e-5,
    step_duration: float = 5.0e-3,
    operating_point: dict[str, float] | None = None,
    loop_probe: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """断环分析：回路增益 Bode / 闭环 T(s) Bode / 直接闭环阶跃。

    display=loop 返回 L(s) 的 Bode 与稳定裕度；closed_loop 返回 T(s) 与
    直接闭环响应两条曲线；step 返回直接闭环阶跃响应。element 为空或
    "__virtual__" 时仅允许 closed_loop/step（直接闭环 T(s)）；display=loop
    必须显式断环，绝不把闭环冒充开环 L(s)。
    """
    if display not in ("loop", "closed_loop", "step"):
        raise AnalysisError(f"未知闭环显示 {display!r}；只支持 loop / closed_loop / step")
    resolved_loop_id: str | None = None
    probe_mode = "element"
    if loop_probe:
        element, resolved_loop_id = _resolve_loop_probe(
            sim, loop_probe=loop_probe, operating_point=operating_point
        )
        probe_mode = "virtual_branch"
    if not element or element == "__virtual__":
        if display == "loop":
            raise AnalysisError(
                "环路分析必须选择实体断环点，未断环无法求开环 L(s)；"
                "如需直接闭环响应请改用闭环 Bode/阶跃。"
            )
        return _virtual_loop_analysis(
            sim,
            input_source=input_source,
            output=output,
            feedback_sign=feedback_sign,
            f_start=f_start,
            f_stop=f_stop,
            points=points,
            scale=scale,
            display=display,
            step_dt=step_dt,
            step_duration=step_duration,
            operating_point=operating_point,
        )
    scene, model = _loop_model(sim, operating_point)
    frequencies = _frequency_axis(f_start, f_stop, points, scale)
    selected_element = model.index.element_by_name.get(str(element))
    try:
        if selected_element is not None and getattr(selected_element, "kind", "") == "resistor":
            extraction = extract_branch_loop(
                model,
                element,
                frequencies,
                input_source=input_source,
                output=output,
                feedback_sign=feedback_sign,
            )
        else:
            extraction = extract_controlled_source_loop(
                model,
                element,
                frequencies,
                input_source=input_source,
                output=output,
                feedback_sign=feedback_sign,
            )
    except (ComputeError, ValidationError, ValueError) as exc:
        raise AnalysisError(f"断环分析失败：{exc}") from exc

    loop_response = _analytic_loop_frequency_response(extraction, frequencies)
    if loop_response is None:
        loop_response = extraction.loop_gain
    margins = stability_margins(
        frequencies, loop_response, feedback_sign=feedback_sign
    )
    source_payload = {
        "domain": "circuit",
        "mode": "circuit",
        "model": "descriptor_linearized",
        "path": "descriptor_linearized",
        "kind": "loop",
        "break_element": extraction.element,
        "break_kind": extraction.kind,
        "input_source": extraction.input_source,
        "output": extraction.output_name,
        "feedback_sign": float(feedback_sign),
        "operating_point_supplied": bool(operating_point),
    }
    analysis_params = {
        "kind": "circuit_loop",
        "element": extraction.element,
        "input_source": extraction.input_source,
        "output": extraction.output_name,
        "feedback_sign": float(feedback_sign),
        "f_start": float(f_start),
        "f_stop": float(f_stop),
        "points": int(points),
        "scale": str(scale),
        "display": str(display),
        "step_dt": float(step_dt),
        "step_duration": float(step_duration),
    }
    fingerprint_value = scene_fingerprint(
        scene, {**analysis_params, "op_present": bool(operating_point)}
    )

    magnitude_db = 20.0 * np.log10(np.maximum(np.abs(loop_response), 1e-300))
    phase_deg = np.degrees(np.unwrap(np.angle(loop_response)))
    envelope_warnings = list(extraction.warnings)
    if margins["stable_from_margins"] is False:
        envelope_warnings.append(
            warning(
                "loop_negative_margin",
                "回路增益裕度为负，闭环可能不稳定",
                severity="warning",
            )
        )
    bode_payload = bode_envelope(
        frequencies=frequencies,
        magnitude_db=magnitude_db,
        phase_deg=phase_deg,
        source=source_payload,
        output=f"L({extraction.element})",
        poles=extraction.poles.get("finite", []),
        zeros=(),
        metrics={
            "phase_margin_deg": margins["phase_margin_deg"],
            "gain_margin_db": margins["gain_margin_db"],
            "stable_from_margins": margins["stable_from_margins"],
        },
        warnings=envelope_warnings,
        fingerprint_value=fingerprint_value,
    )
    if display == "closed_loop":
        # 闭环 T 直接采用提取器给出的 T = G/(1+L)（G=forward_gain、L=loop_gain，L 已含极性）。
        # 旧实现用 loop_response/(1+sign*loop_response)=L/(1+L) 绘制，非单位反馈会差 1/β（LM-01/LM-04）。
        closed_synth = extraction.closed_loop
        closed_mag = 20.0 * np.log10(np.maximum(np.abs(closed_synth), 1e-300))
        closed_phase = np.degrees(np.unwrap(np.angle(closed_synth)))
        bode_payload = bode_envelope(
            frequencies=frequencies,
            magnitude_db=closed_mag,
            phase_deg=closed_phase,
            source={**source_payload, "kind": "loop_closed"},
            output=f"T({extraction.output_name})",
            poles=extraction.poles.get("finite", []),
            zeros=(),
            metrics={
                "phase_margin_deg": margins["phase_margin_deg"],
                "gain_margin_db": margins["gain_margin_db"],
                "stable_from_margins": margins["stable_from_margins"],
                "parity_max_rel": extraction.parity_max_rel,
            },
            warnings=envelope_warnings,
            fingerprint_value=fingerprint_value,
        )
        bode_payload["curves"][0]["label"] = "闭环 T_synth 幅值"
        bode_payload["curves"][1]["label"] = "闭环 T_synth 相位"
        if extraction.direct_response is not None:
            direct_mag = 20.0 * np.log10(
                np.maximum(np.abs(extraction.direct_response), 1e-300)
            )
            direct_phase = np.degrees(np.unwrap(np.angle(extraction.direct_response)))
            bode_payload["curves"].append(
                curve(
                    "closed_loop_direct_mag",
                    label="直接闭环 T_direct 幅值",
                    x_axis="f",
                    y_axis="mag_db",
                    x=[float(value) for value in frequencies],
                    y=[float(value) for value in direct_mag],
                    style="dashed",
                    category="loop",
                    detail={"parity_max_rel": extraction.parity_max_rel},
                )
            )
            bode_payload["curves"].append(
                curve(
                    "closed_loop_direct_phase",
                    label="直接闭环 T_direct 相位",
                    x_axis="f",
                    y_axis="phase_deg",
                    x=[float(value) for value in frequencies],
                    y=[float(value) for value in direct_phase],
                    style="dashed",
                    category="loop",
                    detail={"parity_max_rel": extraction.parity_max_rel},
                )
            )
    try:
        physical_transfer = descriptor_transfer_function(
            model, extraction.input_source, extraction.output_name
        )
    except Exception as exc:  # noqa: BLE001 - 传函不可得时不应中断整个环路分析
        physical_transfer = {"supported": False, "reason": str(exc)}
    if display == "step":
        steps = int(round(float(step_duration) / max(float(step_dt), 1e-12)))
        actual_dt = float(step_dt)
        if steps > 2000:
            actual_dt = float(step_duration) / 2000.0
        step_payload = descriptor_step_response(
            model,
            extraction.input_source,
            extraction.output_name,
            t_end=float(step_duration),
            dt=actual_dt,
        )
        step_envelope_payload = step_envelope(
            times=step_payload.get("times", []),
            values=step_payload.get("values", []),
            source={**source_payload, "kind": "loop_step"},
            output=extraction.output_name,
            metrics={
                "phase_margin_deg": margins["phase_margin_deg"],
                "gain_margin_db": margins["gain_margin_db"],
                "stable_from_margins": margins["stable_from_margins"],
                "parity_max_rel": extraction.parity_max_rel,
            },
            warnings=envelope_warnings,
            fingerprint_value=fingerprint_value,
        )
        return {
            "ok": True,
            "kind": "loop_step",
            "display": "step",
            "element": extraction.element,
            "break_kind": extraction.kind,
            "loop_id": resolved_loop_id,
            "probe": probe_mode,
            "input_source": extraction.input_source,
            "output": extraction.output_name,
            "feedback_sign": float(feedback_sign),
            "parity_max_rel": extraction.parity_max_rel,
            "poles": extraction.poles,
            "metrics": {
                "phase_margin_deg": margins["phase_margin_deg"],
                "gain_margin_db": margins["gain_margin_db"],
                "stable_from_margins": margins["stable_from_margins"],
                "parity_max_rel": extraction.parity_max_rel,
            },
            "warnings": envelope_warnings,
            "fingerprint": fingerprint_value,
            "envelopes": {"time": step_envelope_payload},
            "source": {**source_payload, "kind": "loop_step"},
            "transfer_function": physical_transfer,
            "open_loop_transfer_function": extraction.open_loop_transfer,
            "transfer_role": "closed_loop",
        }
    return {
        "ok": True,
        "display": display,
        "kind": "loop",
        "element": extraction.element,
        "break_kind": extraction.kind,
        "loop_id": resolved_loop_id,
        "probe": probe_mode,
        "input_source": extraction.input_source,
        "output": extraction.output_name,
        "feedback_sign": float(feedback_sign),
        "frequencies_hz": [float(value) for value in frequencies],
        "loop_gain": _complex_list(loop_response),
        "forward_gain": _complex_list(extraction.forward_gain),
        "closed_loop": _complex_list(extraction.closed_loop),
        "direct_response": (
            _complex_list(extraction.direct_response)
            if extraction.direct_response is not None
            else None
        ),
        "parity_max_rel": extraction.parity_max_rel,
        "poles": extraction.poles,
        "metrics": {
            "phase_margin_deg": margins["phase_margin_deg"],
            "gain_margin_db": margins["gain_margin_db"],
            "stable_from_margins": margins["stable_from_margins"],
            "gain_crossings": margins["gain_crossings"],
            "phase_crossings": margins["phase_crossings"],
        },
        "warnings": envelope_warnings,
        "fingerprint": fingerprint_value,
        "envelopes": {"bode": bode_payload},
        "source": source_payload,
        "transfer_function": (
            extraction.open_loop_transfer if display == "loop" else physical_transfer
        ),
        "open_loop_transfer_function": extraction.open_loop_transfer,
        "transfer_role": "open_loop" if display == "loop" else "closed_loop",
    }


def _extract_frequency_loop(
    model: DescriptorModel,
    element: str,
    frequencies: Any,
    *,
    input_source: str | None = None,
    output: str | None = None,
    feedback_sign: float = 1.0,
):
    """按元件类型选择断环提取：无源电阻走支路返回比，受控源/运放走矩阵断点。"""
    candidate = model.index.element_by_name.get(str(element))
    if candidate is not None and getattr(candidate, "kind", "") == "resistor":
        return extract_branch_loop(
            model,
            element,
            frequencies,
            input_source=input_source,
            output=output,
            feedback_sign=feedback_sign,
        )
    return extract_controlled_source_loop(
        model,
        element,
        frequencies,
        input_source=input_source,
        output=output,
        feedback_sign=feedback_sign,
    )


def nyquist_analysis(
    sim: Any,
    *,
    element: str,
    input_source: str | None = None,
    output: str | None = None,
    feedback_sign: float = 1.0,
    f_start: float = 1.0,
    f_stop: float = 1_000_000.0,
    points: int = 401,
    scale: str = "log",
    operating_point: dict[str, float] | None = None,
) -> dict[str, Any]:
    """断环：Nyquist 轮廓、包围数、P/N/Z 与稳定裕度。

    element 可为受控源（VCVS/VCCS/运放）或无源反馈电阻支路；后者按返回比
    断开外环，适合多级运放电路。
    """
    scene, model = _loop_model(sim, operating_point)
    if not element:
        raise AnalysisError("Nyquist 分析必须选择断环元件")
    frequencies = _frequency_axis(f_start, f_stop, points, scale)
    try:
        extraction = _extract_frequency_loop(
            model,
            element,
            frequencies,
            input_source=input_source,
            output=output,
            feedback_sign=feedback_sign,
        )
    except (ComputeError, ValidationError, ValueError) as exc:
        raise AnalysisError(f"Nyquist 分析失败：{exc}") from exc

    source_payload = {
        "domain": "circuit",
        "mode": "circuit",
        "model": "descriptor_linearized",
        "kind": "nyquist",
        "break_element": extraction.element,
        "break_kind": extraction.kind,
        "input_source": extraction.input_source,
        "output": extraction.output_name,
        "feedback_sign": float(feedback_sign),
        "operating_point_supplied": bool(operating_point),
    }
    analysis_params = {
        "kind": "circuit_nyquist",
        "element": extraction.element,
        "input_source": extraction.input_source,
        "output": extraction.output_name,
        "feedback_sign": float(feedback_sign),
        "f_start": float(f_start),
        "f_stop": float(f_stop),
        "points": int(points),
        "scale": str(scale),
    }
    fingerprint_value = scene_fingerprint(
        scene, {**analysis_params, "op_present": bool(operating_point)}
    )
    loop_response = _analytic_loop_frequency_response(extraction, frequencies)
    if loop_response is None:
        loop_response = extraction.loop_gain
    payload = nyquist_envelope(
        frequencies,
        loop_response,
        source=source_payload,
        poles=extraction.poles,
        feedback_sign=feedback_sign,
        element=extraction.element,
        output=extraction.output_name,
        fingerprint_value=fingerprint_value,
        evidence={
            "parity_max_rel": extraction.parity_max_rel,
            "break_kind": extraction.kind,
        },
    )
    metrics = dict(payload.get("metrics") or {})
    warnings_list = list(payload.get("warnings") or [])
    for item in extraction.warnings:
        if item not in warnings_list:
            warnings_list.append(item)
    payload["warnings"] = warnings_list
    return {
        "ok": True,
        "kind": "nyquist",
        "element": extraction.element,
        "break_kind": extraction.kind,
        "input_source": extraction.input_source,
        "output": extraction.output_name,
        "feedback_sign": float(feedback_sign),
        "frequencies_hz": [float(value) for value in frequencies],
        "loop_gain": _complex_list(loop_response),
        "poles": extraction.poles,
        "metrics": metrics,
        "warnings": warnings_list,
        "fingerprint": fingerprint_value,
        "envelopes": {"nyquist": payload},
        "source": source_payload,
    }


def step_open_analysis(
    sim: Any,
    *,
    element: str | None = "",
    input_source: str | None = None,
    output: str | None = None,
    feedback_sign: float = 1.0,
    f_start: float = 1.0,
    f_stop: float = 1_000_000.0,
    points: int = 241,
    scale: str = "log",
    step_dt: float = 1.0e-5,
    step_duration: float = 5.0e-3,
    operating_point: dict[str, float] | None = None,
    loop_probe: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """开环阶跃：先按断环求真实 L(s)，再由 L(s) 做单位阶跃响应。

    与 loop_analysis(display="loop") 共用同一断环口径；绝不把闭环 T(s)
    直接冒充开环阶跃。
    """
    loop = loop_analysis(
        sim,
        element=element,
        input_source=input_source,
        output=output,
        feedback_sign=feedback_sign,
        f_start=f_start,
        f_stop=f_stop,
        points=points,
        scale=scale,
        display="loop",
        step_dt=step_dt,
        step_duration=step_duration,
        operating_point=operating_point,
        loop_probe=loop_probe,
    )
    open_tf = loop.get("open_loop_transfer_function") or {}
    expression = open_tf.get("expression") if isinstance(open_tf, dict) else None
    if not expression:
        raise AnalysisError("开环阶跃需要可解析的开环传递函数 L(s)，当前断环结果不足")
    try:
        tf = transfer_math.parse_expression(str(expression))
        signal = transfer_math.analyze(
            tf,
            dt=float(step_dt),
            duration=float(step_duration),
            points=int(points),
        )
    except Exception as exc:  # noqa: BLE001 - 统一转分析错误
        raise AnalysisError(f"开环阶跃求解失败：{exc}") from exc
    source_payload = {
        **(loop.get("source") or {}),
        "kind": "step_open",
        "transfer_role": "open_loop",
        "open_loop_expression": str(expression),
    }
    bode_payload_source = {**source_payload, "kind": "step_open_bode"}
    bode = signal.get("bode") or {}
    time_payload = signal.get("step") or {}
    bode_env = bode_envelope(
        frequencies=bode.get("frequency_hz", []),
        magnitude_db=bode.get("magnitude_db", []),
        phase_deg=bode.get("phase_deg", []),
        source=bode_payload_source,
        output=str(loop.get("output") or ""),
    )
    time_env = step_envelope(
        times=time_payload.get("t", []),
        values=time_payload.get("y", []),
        source={**source_payload, "kind": "step_open"},
        output=str(loop.get("output") or ""),
    )
    return {
        **signal,
        "kind": "step_open",
        "display": "step",
        "element": loop.get("element"),
        "break_kind": loop.get("break_kind"),
        "input_source": loop.get("input_source"),
        "output": loop.get("output"),
        "feedback_sign": float(feedback_sign),
        "transfer_role": "open_loop",
        "open_loop_transfer_function": open_tf,
        "envelopes": {"bode": bode_env, "time": time_env},
        "source": source_payload,
    }


def nyquist_closed_analysis(
    sim: Any,
    *,
    input_source: str | None = None,
    output: str | None = None,
    feedback_sign: float = 1.0,
    f_start: float = 1.0,
    f_stop: float = 1_000_000.0,
    points: int = 401,
    scale: str = "log",
    operating_point: dict[str, float] | None = None,
) -> dict[str, Any]:
    """闭环 Nyquist：直接由闭环 T(s) 画 Nyquist 轮廓。

    该曲线只展示闭环传递函数的复平面轨迹；稳定性判定仍应看开环 L(s)
    的 Nyquist 包围或 Bode 裕度，本函数不把闭环轮廓当作开环判据。
    """
    tf_result = tf_analysis(
        sim,
        mode="circuit",
        input_source=input_source,
        output=output,
        operating_point=operating_point,
        f_start=f_start,
        f_stop=f_stop,
        points=points,
        scale=scale,
    )
    transfer = tf_result.get("transfer_function") or {}
    expression = transfer.get("expression") if isinstance(transfer, dict) else None
    if not expression:
        raise AnalysisError("闭环 Nyquist 需要可解析的闭环传递函数 T(s)")
    try:
        tf = transfer_math.parse_expression(str(expression))
    except Exception as exc:  # noqa: BLE001
        raise AnalysisError(f"闭环传递函数解析失败：{exc}") from exc
    frequencies = _frequency_axis(f_start, f_stop, points, scale)
    magnitude, phase = tf.frequency_response(2.0 * math.pi * np.asarray(frequencies))
    loop_gain = np.asarray(magnitude, dtype=np.float64) * np.exp(
        1j * np.asarray(phase, dtype=np.float64)
    )
    source_payload = {
        "domain": "circuit",
        "mode": "circuit",
        "model": "descriptor_linearized",
        "kind": "nyquist_closed",
        "transfer_role": "closed_loop",
        "input_source": input_source,
        "output": output,
        "feedback_sign": float(feedback_sign),
    }
    payload = nyquist_envelope(
        frequencies,
        loop_gain,
        source=source_payload,
        feedback_sign=feedback_sign,
        element="__closed_loop__",
        output=str(output or tf_result.get("output") or ""),
    )
    metrics = dict(payload.get("metrics") or {})
    metrics["role"] = "closed_loop_contour"
    payload["metrics"] = metrics
    warnings_list = list(payload.get("warnings") or [])
    warnings_list.append(
        warning(
            "nyquist_closed_visualization",
            "闭环 Nyquist 轮廓仅展示闭环 T(s) 轨迹，稳定性请以开环 Nyquist/裕度为准",
            severity="info",
        )
    )
    payload["warnings"] = warnings_list
    return {
        "ok": True,
        "kind": "nyquist_closed",
        "transfer_role": "closed_loop",
        "input_source": input_source,
        "output": output,
        "feedback_sign": float(feedback_sign),
        "frequencies_hz": [float(value) for value in frequencies],
        "metrics": metrics,
        "warnings": warnings_list,
        "envelopes": {"nyquist": payload},
        "source": source_payload,
        "transfer_function": transfer,
    }


