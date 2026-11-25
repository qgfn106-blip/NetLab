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

from .analysis_transfer import (
    _state_space_payload,
    frequency_response,
    transfer_function,
)


def _circuit_metrics(
    transfer: dict[str, Any],
    poles: dict[str, Any],
    step: dict[str, Any],
    bode: dict[str, Any],
    output: str,
) -> dict[str, Any]:
    """汇总旁路分析的关键指标（阶跃、极点、Bode）。"""
    times = np.asarray(step.get("times", []), dtype=float)
    values = np.asarray(step.get("values", []), dtype=float)
    finite = np.asarray(poles.get("finite", []), dtype=float)
    stable = bool(finite.size) and all(row[0] < 0.0 for row in finite)
    dc_gain = transfer.get("dc_gain")
    step_metrics = transfer_math._step_metrics(
        times, values, stable=stable, dc_gain=dc_gain
    )
    pole_metrics = []
    for row in finite:
        real, imag = float(row[0]), float(row[1])
        magnitude = float(np.hypot(real, imag))
        pole_metrics.append(
            {
                "real": real,
                "imag": imag,
                "omega_n": magnitude,
                "zeta": (-real / magnitude) if magnitude > 0.0 else None,
                "time_constant": (-1.0 / real) if real < 0.0 else None,
            }
        )
    probes = bode.get("probes", {})
    probe = probes.get(output) if isinstance(probes, dict) else None
    if not isinstance(probe, dict):
        probe = next(iter(probes.values()), {}) if isinstance(probes, dict) else {}
    frequencies = np.asarray(probe.get("frequencies", bode.get("frequencies", [])), dtype=float)
    magnitudes = np.asarray(probe.get("db", []), dtype=float)
    resonance_db = None
    resonance_hz = None
    bandwidth_hz = None
    if frequencies.size and magnitudes.size:
        index = int(np.nanargmax(magnitudes))
        resonance_db = float(magnitudes[index])
        resonance_hz = float(frequencies[index])
        reference = max(float(magnitudes[0]), resonance_db)
        bandwidth = np.where(magnitudes <= reference - 3.0)[0]
        if bandwidth.size:
            bandwidth_hz = float(frequencies[int(bandwidth[0])])
    return {
        **step_metrics,
        "stable": stable,
        "dc_gain": dc_gain,
        "poles": pole_metrics,
        "bode": {
            "bandwidth_hz": bandwidth_hz,
            "resonant_peak_db": resonance_db,
            "resonant_frequency_hz": resonance_hz,
        },
    }


def _fft_frequency_trace(
    model: Any,
    input_source: str | None,
    output: str,
    *,
    sample_dt: float,
    sample_duration: float,
    f_start: float,
    f_stop: float,
    points: int,
    probe_frequencies: Any,
    probe_magnitude_db: Any,
    probe_phase_deg: Any,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """第二条频响通路：多正弦时域激励 -> 加窗 FFT 近似。

    只用于旁证；稳定性仍以描述器零极点为准。返回 (近似信封, 与描述器
    参考结果的逐点比较)。频段受采样率与仿真时长限制，实际有效频段写入
    source.band。
    """
    dt = max(float(sample_dt), 1.0e-9)
    duration = max(float(sample_duration), 0.1)
    max_samples = 60_000
    if duration / dt > max_samples:
        duration = max_samples * dt
    lo = max(float(f_start), 20.0 / duration)
    hi = min(float(f_stop), 0.45 / dt)
    if not np.isfinite(lo) or not np.isfinite(hi) or lo >= hi:
        raise AnalysisError(
            "FFT 近似频段不可用：请增大 step_duration 或减小 step_dt，"
            "使频率范围覆盖至少一个十倍频程"
        )
    # 让多正弦频率落在 FFT 整数 bin 上，避免非整周期截断造成相位泄漏。
    count = min(max(8, int(points)), 24)
    raw = np.geomspace(lo, hi, count)
    bins = np.unique(np.round(raw * duration).astype(int))
    bins = bins[(bins >= 1) & (bins / duration < 0.5 / dt)]
    if bins.size < 4:
        raise AnalysisError("FFT 近似频点不足：请增大 step_duration 或 points")
    frequencies = bins.astype(float) / duration
    excitation = multisine(
        frequencies.tolist(),
        sample_rate_hz=1.0 / dt,
        duration_s=duration,
        amplitude=1.0,
    )
    transient = descriptor_transient_response(
        model,
        input_source,
        output,
        excitation["values"],
        dt=dt,
    )
    estimate = estimate_transfer_fft(
        excitation["values"],
        transient["values"],
        dt,
        window="hann",
        coherence_min=0.15,
        f_min=float(frequencies[0]),
        f_max=float(frequencies[-1]),
    )
    payload = approximation_envelope(estimate, source="fft_trajectory")
    payload["source"] = {
        **dict(payload.get("source") or {}),
        "domain": "circuit",
        "mode": "circuit",
        "model": "fft_trajectory",
        "input_source": input_source,
        "output": output,
        "path": "fft_trajectory",
        "approximate": True,
        "band": [float(frequencies[0]), float(frequencies[-1])],
    }
    comparison: dict[str, Any] | None = None
    reference_f = np.asarray(list(probe_frequencies), dtype=float)
    reference_db = np.asarray(list(probe_magnitude_db), dtype=float)
    reference_phase = np.asarray(list(probe_phase_deg), dtype=float)
    if reference_f.size >= 2:
        estimate_f = np.asarray(estimate.frequencies_hz, dtype=float)
        estimate_mag = np.asarray(estimate.magnitude, dtype=float)
        estimate_phase = np.asarray(estimate.phase_deg, dtype=float)
        valid = np.asarray(estimate.valid, dtype=bool)
        valid &= (estimate_f >= float(reference_f[0])) & (estimate_f <= float(reference_f[-1]))
        valid &= np.isfinite(estimate_mag) & np.isfinite(estimate_phase)
        if np.any(valid):
            points_f = estimate_f[valid]
            ref_mag = 10.0 ** (reference_db / 20.0)
            ref_real = np.interp(points_f, reference_f, ref_mag * np.cos(np.radians(reference_phase)))
            ref_imag = np.interp(points_f, reference_f, ref_mag * np.sin(np.radians(reference_phase)))
            ref_complex = ref_real + 1j * ref_imag
            est_complex = estimate_mag[valid] * np.exp(1j * np.radians(estimate_phase[valid]))
            relative = np.abs(est_complex - ref_complex) / np.maximum(np.abs(ref_complex), 1.0e-12)
            rows = []
            for index in range(points_f.size):
                nearest = int(np.abs(reference_f - points_f[index]).argmin())
                rows.append(
                    {
                        "frequency_hz": round(float(points_f[index]), 6),
                        "reference_mag_db": round(float(reference_db[nearest]), 6),
                        "approx_mag_db": round(float(20.0 * np.log10(max(estimate_mag[valid][index], 1.0e-300))), 6),
                        "reference_phase_deg": round(float(reference_phase[nearest]), 6),
                        "approx_phase_deg": round(float(estimate_phase[valid][index]), 6),
                        "relative_error": round(float(relative[index]), 6),
                    }
                )
            comparison = {
                "reference_path": "descriptor_linearized",
                "approx_path": "fft_trajectory",
                "band": [float(points_f[0]), float(points_f[-1])],
                "points": rows,
                "mean_relative_error": round(float(np.mean(relative)), 6),
                "max_relative_error": round(float(np.max(relative)), 6),
            }
            if float(np.max(relative)) > 0.15:
                payload.setdefault("warnings", []).append(
                    warning(
                        "fft_comparison_deviation",
                        "FFT 近似与描述器线性化结果偏差较大，仅作旁证；稳定性以描述器结果为准。",
                        severity="warning",
                    )
                )
    if comparison is not None:
        payload.setdefault("evidence", {})["comparison"] = comparison
    return payload, comparison


def _circuit_tf_analysis(
    sim: Any,
    *,
    input_source: str | None,
    output: str | None,
    operating_point: dict[str, float] | None,
    step_dt: float,
    step_duration: float,
    f_start: float,
    f_stop: float,
    points: int,
    scale: str,
    frequency_path: str = "descriptor_linearized",
    budget_s: float | None = None,
) -> dict[str, Any]:
    """电路小信号旁路分析：Descriptor 状态空间 + 零极点 + 阶跃 + Bode。

    frequency_path 选择频响通路：descriptor_linearized（默认，权威）或
    fft_trajectory（时域多正弦激励 + FFT 近似，仅旁证）。
    """
    if frequency_path not in ("descriptor_linearized", "fft_trajectory"):
        raise AnalysisError(
            f"未知频响通路 {frequency_path!r}；只支持 descriptor_linearized / fft_trajectory"
        )
    if sim is None:
        raise AnalysisError("mode=circuit 时必须提供电路仿真")
    scene = getattr(sim, "scene", None)
    if scene is None or getattr(scene, "mode", None) != "circuit":
        raise AnalysisError("mode=circuit 需要 circuit 模式场景")
    if not input_source:
        raise AnalysisError("mode=circuit 必须提供 input_source")
    if not output:
        raise AnalysisError("mode=circuit 必须提供 output")

    # 小信号分析是同步请求，必须带时间预算，避免大电路/多频点把请求卡死到超时。
    import os as _os
    import time as _time

    if budget_s is None:
        try:
            budget_s = float(_os.environ.get("NETLAB_TF_BUDGET_S", "20") or "20")
        except (TypeError, ValueError):
            budget_s = 20.0
    budget_s = max(0.001, float(budget_s))
    _deadline = _time.perf_counter() + budget_s

    def _deadline_check(stage: str) -> None:
        if _time.perf_counter() > _deadline:
            raise AnalysisError(
                f"{stage}超时（>{budget_s:.3g}s）；请增大 step_dt、缩短 step_duration "
                f"或减少频点数 points 后重试"
            )

    # 自适应上限：控制阶跃步数与 Bode 频点数，防止病态规模拖死同步请求。
    _max_step_steps = 2000
    _max_bode_points = 400
    _steps = int(round(float(step_duration) / max(float(step_dt), 1e-12)))
    if _steps > _max_step_steps:
        step_dt = float(step_duration) / _max_step_steps
    points = max(1, min(int(points), _max_bode_points))

    try:
        model = DescriptorModel.from_scene(scene, operating_point=operating_point)
    except ComputeError as exc:
        message = str(exc)
        if "非线性" in message:
            raise AnalysisError(
                "非线性电路需要线性化工作点：请先运行 DC 工作点分析，"
                "并通过 operating_point 传入节点电压"
            ) from exc
        raise AnalysisError(f"状态空间构建失败：{message}") from exc

    def _guard(label: str, function: Any) -> Any:
        try:
            return function()
        except AnalysisError:
            raise
        except (ComputeError, UnsupportedAnalysisError, ValueError) as exc:
            raise AnalysisError(f"{label}失败：{exc}") from exc

    _deadline_check("状态空间构建")
    system = _guard("状态空间构建", lambda: model.build(input_source))
    _deadline_check("极点分析")
    pole_result = _guard("极点分析", lambda: analyze_poles(system))
    _deadline_check("输出矩阵构建")
    c_matrix, d_matrix = _guard(
        "输出矩阵构建", lambda: build_output_matrices(model, output, input_source)
    )
    _deadline_check("零点分析")
    zero_result = _guard(
        "零点分析", lambda: analyze_zeros(system, C=c_matrix, D=d_matrix)
    )

    def _step() -> dict[str, Any]:
        try:
            return descriptor_step_response(
                model,
                input_source,
                output,
                t_end=float(step_duration),
                dt=float(step_dt),
            )
        except UnsupportedAnalysisError as exc:
            raise AnalysisError(
                f"阶跃分析只支持非接地节点电压探针：{output!r}"
            ) from exc

    _deadline_check("阶跃分析")
    step = _guard("阶跃分析", _step)

    frequencies = _frequency_axis(
        f_start=float(f_start),
        f_stop=float(f_stop),
        points=int(points),
        scale=str(scale),
    )
    _deadline_check("Bode 分析")
    bode = _guard(
        "Bode 分析",
        lambda: model.frequency_response(
            [float(value) for value in frequencies],
            input_source=input_source,
            probes=[output],
        ),
    )
    _deadline_check("传递函数提取")
    transfer = _guard(
        "传递函数提取",
        lambda: descriptor_transfer_function(
            model, input_source=input_source, output=output
        ),
    )
    poles_payload = {
        "finite": _complex_list(pole_result.finite_poles),
        "infinite_count": int(pole_result.infinite_count),
        "max_residual": float(pole_result.max_residual),
        "size": int(pole_result.size),
        "regular": bool(pole_result.regular),
    }
    zeros_payload = {
        "finite": _complex_list(zero_result.finite_zeros),
        "infinite_count": int(zero_result.infinite_count),
        "max_residual": float(zero_result.max_residual),
        "size": int(zero_result.size),
        "regular": bool(zero_result.regular),
        "siso": bool(zero_result.siso),
    }
    metrics = _guard(
        "关键指标计算",
        lambda: _circuit_metrics(transfer, poles_payload, step, bode, output),
    )
    _deadline_check("结果封装")

    # ---- PlotKit 信封（netlab-analysis-result/1）---------------------------
    probe_payload = (bode.get("probes") or {}).get(output) or {}
    probe_frequencies = np.asarray(
        probe_payload.get("frequencies", bode.get("frequencies", [])), dtype=float
    )
    probe_db = np.asarray(probe_payload.get("db", []), dtype=float)
    probe_phase = np.asarray(probe_payload.get("phase_deg", []), dtype=float)
    source_payload = {
        "domain": "circuit",
        "mode": "circuit",
        "model": "descriptor_linearized",
        "path": "descriptor_linearized",
        "input_source": input_source,
        "output": output,
        "operating_point_supplied": bool(operating_point),
    }
    analysis_params = {
        "kind": "circuit_tf",
        "input_source": input_source,
        "output": output,
        "operating_point": dict(operating_point or {}),
        "step_dt": float(step_dt),
        "step_duration": float(step_duration),
        "f_start": float(f_start),
        "f_stop": float(f_stop),
        "points": int(points),
        "scale": str(scale),
        "frequency_path": str(frequency_path),
    }
    scene_params = {key: value for key, value in analysis_params.items() if key != "operating_point"}
    analysis_fp = scene_fingerprint(scene, {**scene_params, "op_present": bool(operating_point)})

    input_amplitude: float | None = None
    try:
        for edge in (getattr(scene, "edges", {}) or {}).values():
            if getattr(edge, "name", "") == input_source:
                raw = (getattr(edge, "params", {}) or {}).get("amplitude")
                input_amplitude = float(raw) if raw is not None else None
                break
    except (TypeError, ValueError):
        input_amplitude = None

    envelope_warnings = []
    if not metrics.get("stable", False):
        envelope_warnings.append(
            warning(
                "unstable",
                "系统存在非负实部极点，闭环/开环响应可能发散；请检查反馈与参数。",
            )
        )

    comparison: dict[str, Any] | None = None
    if frequency_path == "fft_trajectory":
        bode_payload, comparison = _fft_frequency_trace(
            model,
            input_source,
            output,
            sample_dt=float(step_dt),
            sample_duration=float(step_duration),
            f_start=float(f_start),
            f_stop=float(f_stop),
            points=int(points),
            probe_frequencies=probe_frequencies,
            probe_magnitude_db=probe_db,
            probe_phase_deg=probe_phase,
        )
        bode_payload["metrics"] = {
            "metrics": metrics,
            "stable": None,
            "approximate": True,
            "frequency_path": "fft_trajectory",
        }
    else:
        bode_payload = bode_envelope(
            frequencies=probe_frequencies,
            magnitude_db=probe_db,
            phase_deg=probe_phase,
            source=source_payload,
            output=output,
            poles=poles_payload.get("finite", []),
            zeros=zeros_payload.get("finite", []),
            metrics={"metrics": metrics, "stable": bool(metrics.get("stable", False))},
            warnings=envelope_warnings,
            fingerprint_value=analysis_fp,
            bandwidth_hz=(metrics.get("bode") or {}).get("bandwidth_hz"),
            resonant_peak_db=(metrics.get("bode") or {}).get("resonant_peak_db"),
            resonant_frequency_hz=(metrics.get("bode") or {}).get("resonant_frequency_hz"),
        )
    time_payload = step_envelope(
        times=step.get("times", []),
        values=step.get("values", []),
        source=source_payload,
        output=output,
        input_amplitude=input_amplitude,
        metrics=metrics,
        warnings=envelope_warnings,
        fingerprint_value=analysis_fp,
    )

    matrices = {
        "A": system.A,
        "E": system.E,
        "B": system.B,
        "C": c_matrix,
        "D": d_matrix,
    }
    element_count = sum(np.asarray(value).size for value in matrices.values())
    if element_count > MAX_NODES * MAX_NODES:
        raise AnalysisError(
            f"状态空间矩阵过大（{element_count} 个元素，上限 "
            f"{MAX_NODES * MAX_NODES}）；请缩小电路规模"
        )

    return {
        "ok": True,
        "domain": "circuit",
        "mode": "circuit",
        "input_source": input_source,
        "output": output,
        "operating_point_supplied": operating_point is not None,
        "state_space": {
            "realization": "descriptor",
            "n": int(system.A.shape[0]),
            "m": 1,
            "p": 1,
            "complex": True,
            "A": _complex_pairs(system.A),
            "E": _complex_pairs(system.E),
            "B": _complex_pairs(np.asarray(system.B).reshape(-1, 1)),
            "C": _complex_pairs(c_matrix),
            "D": _complex_pairs(d_matrix),
            "elements": int(element_count),
            "truncated": False,
        },
        "poles": poles_payload,
        "zeros": zeros_payload,
        "transfer_function": transfer,
        "closed_loop_transfer_function": transfer,
        "transfer_role": "closed_loop",
        "metrics": metrics,
        "step": step,
        "step_dt": float(step.get("dt", step_dt)) if isinstance(step, dict) else float(step_dt),
        "bode": bode,
        "frequency_path": str(frequency_path),
        "frequency_comparison": comparison,
        "fingerprint": analysis_fp,
        "envelopes": {"bode": bode_payload, "time": time_payload},
        "assumptions": [
            "基于 DC 工作点线性化的 Descriptor 状态空间",
            "Bode 与零极点同源：DescriptorModel.frequency_response",
            "阶跃响应使用隐式 Euler，仅节点电压探针",
        ],
        "source": "descriptor（小信号）",
    }


def tf_analysis(
    sim: Any = None,
    *,
    mode: str = "signal",
    node: str | None = None,
    input_node: str | None = None,
    output_node: str | None = None,
    input_source: str | None = None,
    output: str | None = None,
    operating_point: dict[str, float] | None = None,
    step_dt: float = 1.0e-5,
    step_duration: float = 5.0e-3,
    f_start: float = 1.0,
    f_stop: float = 1_000_000.0,
    scale: str = "log",
    field: str | None = None,
    expr: str | None = None,
    numerator: list[float] | None = None,
    denominator: list[float] | None = None,
    zeros: list[float] | None = None,
    poles: list[float] | None = None,
    gain: float = 1.0,
    method: str = "zoh",
    dt: float | None = None,
    duration: float | None = None,
    points: int = 240,
    delay_pade_order: int = 3,
    frequency_path: str = "descriptor_linearized",
) -> dict[str, Any]:
    """s 域传递函数分析：Bode、阶跃、零极点、稳定性。

    输入优先级：``node``（仿真里的 transfer_function 节点）> ``expr`` >
    ``numerator``/``denominator`` > ``zeros``/``poles``。只做解析与数值呈现，
    不写回求解器；参数错误统一转 ``AnalysisError``，服务层返回 422。
    """
    try:
        if mode not in ("signal", "circuit"):
            raise AnalysisError(f"未知分析模式 {mode!r}；只支持 signal/circuit")
        if mode == "circuit":
            return _circuit_tf_analysis(
                sim,
                input_source=input_source,
                output=output,
                operating_point=operating_point,
                step_dt=step_dt,
                step_duration=step_duration,
                f_start=f_start,
                f_stop=f_stop,
                points=points,
                scale=scale,
                frequency_path=frequency_path,
            )
        scene_mode = getattr(getattr(sim, "scene", None), "mode", None)
        if scene_mode is not None and scene_mode != "signal":
            raise AnalysisError(
                f"mode=signal 与 {scene_mode!r} 场景不一致；"
                "电路场景请传 mode='circuit'"
            )
        if input_node is not None or output_node is not None:
            if sim is None or not input_node or not output_node:
                raise AnalysisError("网络总传函必须同时提供 input_node 与 output_node")
            network_report = transfer_function(
                sim,
                input_node,
                output_node,
                delay_pade_order=delay_pade_order,
            )
            if not network_report.get("ok"):
                raise AnalysisError(
                    str(network_report.get("reason") or "网络总传函失败")
                )
            tf = transfer_math.parse_expression(
                str(network_report["expression"]).replace("**", "^")
            )
            if field is None:
                field = "value"
        elif node is not None:
            if sim is None:
                raise AnalysisError("指定 node 时必须提供仿真")
            scene = sim.scene
            if scene.mode != "signal":
                raise AnalysisError("目前只支持 signal 模式的传递函数节点")
            matches = [item for item in scene.nodes.values() if item.name == node]
            if not matches:
                raise AnalysisError(f"节点 {node!r} 不存在")
            found = matches[0]
            if found.kind != "transfer_function":
                raise AnalysisError(
                    f"节点 {node!r} 不是传递函数节点（kind={found.kind}）"
                )
            tf = transfer_math.from_params(found.params)
            if field is None:
                field = str(found.params.get("output") or "voltage")
        elif expr is not None:
            tf = transfer_math.parse_expression(expr)
        elif numerator is not None or denominator is not None:
            if numerator is None or denominator is None:
                raise AnalysisError("降幂系数模式必须同时给出分子和分母")
            tf = transfer_math.from_coefficients(numerator, denominator)
        elif zeros is not None or poles is not None:
            tf = transfer_math.from_zpk(zeros or [], poles or [], gain=float(gain))
        else:
            raise AnalysisError(
                "需要 node、expr、numerator/denominator 或 zeros/poles 之一"
            )
        result = transfer_math.analyze(
            tf,
            dt=dt,
            duration=duration,
            method=method,
            points=points,
        )
    except AnalysisError:
        raise
    except Exception as exc:
        raise AnalysisError(f"传递函数分析失败：{exc}") from exc

    result["node"] = node
    result["state_space"] = _state_space_payload(tf)
    if field is not None:
        result["field"] = field
    result["assumptions"] = [
        "连续域有理式；阶跃响应按所选方法（默认 ZOH）离散后推进",
        "零极点由数值求根得到；重根/近重根可能有数值误差",
        "阶跃指标基于单位阶跃与零初始状态；不稳定/临界系统只给轨迹与稳定性",
        "分析只读参数，不写回求解器",
    ]
    result["source"] = "transfer（s 域解析）"
    return result



