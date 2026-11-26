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


def numeric_precision_mode() -> str:
    """当前符号/传函数值精度模式：'exact'（默认）或 'standard'。

    仅影响符号/传函分析链路；数值仿真、时域、录制、绘图仍恒为 float64，不受影响。
    默认 'exact' 与既有行为一致（to_exact）。
    """
    return getattr(numeric_precision_mode, "_mode", "exact")


def set_numeric_precision_mode(mode: str) -> None:
    """设置符号数值精度模式。

    * 'exact'：符号/传函调用 ``to_exact``（默认）。
    * 'standard'：退回旧行为 ``sp.sympify(str(value))``，允许出现 ``sp.Float``（大系统提速）。
    """
    if mode not in ("exact", "standard"):
        raise ValueError(f"numeric_precision 必须是 exact 或 standard，收到 {mode!r}")
    numeric_precision_mode._mode = mode  # type: ignore[attr-defined]



def _frames(
    sim: Any, t0: float | None = None, t1: float | None = None
) -> list[dict[str, Any]]:
    with sim.lock:
        raw_frames = list(sim.recorder.frames)
        # 录制层内部保存稳定 id 键；分析层对外统一使用当前显示名，
        # 这样节点/连接改名不会把历史曲线断成两个通道（N-08/A-5）。
        frames = []
        for frame in raw_frames:
            item = dict(frame)
            item["v"] = {
                sim.scene.channel_display_name(key): value
                for key, value in frame.get("v", {}).items()
            }
            frames.append(item)
    if t0 is not None or t1 is not None:
        low = -math.inf if t0 is None else float(t0)
        high = math.inf if t1 is None else float(t1)
        frames = [frame for frame in frames if low <= frame["t"] <= high]
    return frames


def _series(
    sim: Any, key: str, t0: float | None = None, t1: float | None = None
) -> tuple[np.ndarray, np.ndarray]:
    frames = _frames(sim, t0, t1)
    times = np.array([frame["t"] for frame in frames], dtype=float)
    values = np.array(
        [frame["v"].get(key, float("nan")) for frame in frames], dtype=float
    )
    mask = np.isfinite(values)
    return times[mask], values[mask]


def _keys(sim: Any, keys: list[str] | None) -> list[str]:
    if keys:
        return list(keys)
    with sim.lock:
        return [
            sim.scene.channel_display_name(key)
            for key in sim.recorder.keys()
        ]




def analyze_metrics(
    sim: Any,
    keys: list[str] | None = None,
    t0: float | None = None,
    t1: float | None = None,
    *,
    settle_band: float = 0.02,
) -> dict[str, Any]:
    """时域指标；每个指标带 source 说明。"""
    items: dict[str, Any] = {}
    for key in _keys(sim, keys):
        times, values = _series(sim, key, t0, t1)
        if len(times) < 3:
            items[key] = {"ok": False, "reason": "该信号录制点不足（<3）"}
            continue
        initial = float(values[0])
        final = float(np.mean(values[-max(3, len(values) // 10) :]))
        amplitude = final - initial
        peak_value = float(values.max()) if amplitude >= 0 else float(values.min())
        overshoot = 0.0
        if abs(amplitude) > 1e-12:
            overshoot = max(0.0, (peak_value - final) / amplitude * 100.0)
        rise = None
        if abs(amplitude) > 1e-12:
            lo = initial + 0.1 * amplitude
            hi = initial + 0.9 * amplitude
            t_lo = _crossing(times, values, lo)
            t_hi = _crossing(times, values, hi)
            if t_lo is not None and t_hi is not None and t_hi >= t_lo:
                rise = t_hi - t_lo
        settle = None
        band = abs(amplitude) * settle_band
        if band > 1e-12:
            outside = np.abs(values - final) > band
            if outside.any():
                last_out = int(np.nonzero(outside)[0][-1])
                if last_out + 1 < len(times):
                    settle = float(times[last_out + 1] - times[0])
            else:
                settle = 0.0
        items[key] = {
            "ok": True,
            "samples": int(len(times)),
            "t_start": float(times[0]),
            "t_end": float(times[-1]),
            "initial": initial,
            "final": final,
            "min": float(values.min()),
            "max": float(values.max()),
            "mean": float(values.mean()),
            "rms": float(np.sqrt(np.mean(values**2))),
            "peak_time": float(
                times[int(np.argmax(values) if amplitude >= 0 else np.argmin(values))]
            ),
            "overshoot_pct": float(overshoot),
            "rise_time": rise,
            "settling_time": settle,
            "settle_band_pct": settle_band * 100.0,
            "source": "录制数据；10/90% 线性插值上升时间、±2% 稳态带、峰值相对终值超调",
        }
    return {"ok": True, "items": items, "source": "recorder"}


def phase_metrics(
    xs: list[float],
    ys: list[float],
    times: list[float] | None = None,
) -> dict[str, Any]:
    """相平面轨迹指标：长度、包围面积、极值、终值与超调。"""
    x = np.asarray(xs, dtype=float)
    y = np.asarray(ys, dtype=float)
    if x.size != y.size:
        raise AnalysisError("相平面 x/y 长度不一致")
    if times is not None and len(times) != x.size:
        raise AnalysisError("相平面时间长度不一致")
    if x.size < 2:
        raise AnalysisError("相平面轨迹点不足（<2）")
    mask = np.isfinite(x) & np.isfinite(y)
    x = x[mask]
    y = y[mask]
    if x.size < 2:
        raise AnalysisError("相平面轨迹没有有效数值点")
    times_array = None
    if times is not None:
        times_array = np.asarray(times, dtype=float)[mask]
    dx = np.diff(x)
    dy = np.diff(y)
    path_length = float(np.sum(np.hypot(dx, dy)))
    area = float(0.5 * np.sum(x[:-1] * y[1:] - x[1:] * y[:-1]))
    final = float(y[-1])
    peak = float(y.max() if final >= 0 else y.min())
    overshoot = 0.0
    if abs(final) > 1e-12:
        overshoot = max(0.0, (peak - final) / abs(final) * 100.0)
    result: dict[str, Any] = {
        "ok": True,
        "points": int(x.size),
        "path_length": path_length,
        "enclosed_area": area,
        "x_min": float(x.min()),
        "x_max": float(x.max()),
        "y_min": float(y.min()),
        "y_max": float(y.max()),
        "x_final": float(x[-1]),
        "y_final": final,
        "y_peak": peak,
        "overshoot_pct": float(overshoot),
        "source": "相平面轨迹；面积为鞋带公式，超调相对 y 终值",
    }
    if times_array is not None and times_array.size == x.size:
        result["t_start"] = float(times_array[0])
        result["t_end"] = float(times_array[-1])
    return result


def spectrum(
    sim: Any,
    key: str,
    t0: float | None = None,
    t1: float | None = None,
    *,
    window: str = "hann",
) -> dict[str, Any]:
    times, values = _series(sim, key, t0, t1)
    grid, uniform = _uniform(times, values)
    dt = float(grid[1] - grid[0])
    centered = uniform - float(np.mean(uniform))
    if window == "hann":
        win = np.hanning(len(centered))
        scaled = centered * win
        gain = max(1e-9, float(np.mean(win)))
    else:
        scaled = centered
        gain = 1.0
    mag = np.abs(np.fft.rfft(scaled)) * (2.0 / (len(scaled) * gain))
    freqs = np.fft.rfftfreq(len(scaled), dt)
    phase = np.degrees(np.angle(np.fft.rfft(scaled)))
    top = np.argsort(mag[1:])[::-1][:5] + 1 if len(mag) > 1 else np.array([], dtype=int)
    peaks = [
        {
            "freq": float(freqs[index]),
            "magnitude": float(mag[index]),
            "phase_deg": float(phase[index]),
        }
        for index in top
    ]
    return {
        "ok": True,
        "key": key,
        "freqs": [float(item) for item in freqs],
        "magnitude": [float(item) for item in mag],
        "phase_deg": [float(item) for item in phase],
        "peaks": peaks,
        "dt": dt,
        "window": window,
        "source": "录制数据 FFT（去均值 + Hann 窗 + 幅度增益校正）；不是运行点线性化结果",
    }




def recommend_period(
    sim: Any, key: str, t0: float | None = None, t1: float | None = None
) -> dict[str, Any]:
    """周期推荐：FFT 候选频率 → 候选周期 → 多窗口一致性校验 → 排序/诊断。"""
    result = spectrum(sim, key, t0, t1)
    times, values = _series(sim, key, t0, t1)
    grid, uniform = _uniform(times, values)
    span = float(grid[-1] - grid[0])
    candidates: list[dict[str, Any]] = []
    windows = _period_windows(len(grid))
    for peak in result["peaks"]:
        freq = peak["freq"]
        if freq <= 0:
            continue
        period = 1.0 / freq
        cycles = span / period
        if cycles < 2:
            continue
        scores: list[float] = []
        maes: list[float] = []
        usable = True
        for start, stop in windows:
            grid_w = grid[start:stop]
            value_w = uniform[start:stop]
            if grid_w.size < 8:
                usable = False
                break
            scored = _shift_score(grid_w, value_w, period)
            if scored is None:
                usable = False
                break
            scores.append(scored[0])
            maes.append(scored[1])
        if not usable:
            continue
        score = float(np.mean(scores))
        if score < 0.75:
            continue
        candidates.append(
            {
                "period": period,
                "score": score,
                "score_std": float(np.std(scores)),
                "cycles": cycles,
                "mae": float(np.mean(maes)),
                "windows": len(scores),
            }
        )
    candidates.sort(key=lambda item: (-item["score"], item["cycles"]))
    if not candidates:
        return {
            "ok": False,
            "key": key,
            "reason": "未找到可在 ≥2 个周期内重复的候选周期",
            "diagnosis": "录制太短、信号非周期或周期大于窗口；先多录制几个周期再试",
            "source": "录制数据 FFT + 多窗口周期一致性（MAE）校验",
        }
    best = candidates[0]
    periods = [float(item["period"]) for item in candidates[:3]]
    return {
        "ok": True,
        "key": key,
        "period": best["period"],
        "score": best["score"],
        "cycles": best["cycles"],
        "candidates": candidates[:3],
        "period_std": float(np.std(periods)) if len(periods) > 1 else 0.0,
        "diagnosis": "按 FFT 峰值 + 全窗/前后子窗平移一致性排序；score=1-mae/σ，score_std 越小越稳",
        "source": "录制数据 FFT + 多窗口周期一致性（MAE）校验",
    }


def math_forms(sim: Any) -> dict[str, Any]:
    """逐个节点给出「数学形式」（来自注册表公式 + 当前参数），不做符号求解。"""
    from .computes import COMPUTE_FORMULAS

    scene = sim.scene
    rows = []
    for node in scene.nodes.values():
        formula = COMPUTE_FORMULAS.get(node.kind, "")
        rows.append(
            {
                "id": node.id,
                "name": node.name,
                "kind": node.kind,
                "formula": formula,
                "params": dict(node.params),
            }
        )
    return {
        "ok": True,
        "rows": rows,
        "source": "节点函数注册表的公式字符串 + 当前参数；仅呈现，不参与求解",
    }





def export_csv(
    sim: Any,
    *,
    directory: str | Path,
    network_name: str,
    keys: list[str] | None = None,
    t0: float | None = None,
    t1: float | None = None,
    decimate: int = 1,
    name: str = "analysis",
) -> dict[str, Any]:
    """导出录制数据为 CSV：元数据头 + 列名 `网络.节点.字段`，只写 exports/。"""
    frames = _frames(sim, t0, t1)
    if not frames:
        raise AnalysisError("没有可导出的录制数据：先运行一段时间")
    selected = _keys(sim, keys)
    if not selected:
        selected = sorted(frames[0]["v"].keys())
    stride = max(1, int(decimate))
    rows = frames[::stride]
    if len(rows) > MAX_EXPORT_ROWS:
        raise AnalysisError(
            f"导出行数 {len(rows)} 超过上限 {MAX_EXPORT_ROWS}，请提高抽稀倍数"
        )
    columns = []
    for key in selected:
        prefix, rest = key.split(":", 1) if ":" in key else ("n", key)
        piece = rest.replace(":", ".")
        columns.append(f"{network_name}.{piece}")
    lines = [
        "# netlab analysis export",
        f"# network: {network_name}",
        f"# mode: {sim.scene.mode}",
        f"# time_range: {frames[0]['t']} .. {frames[-1]['t']}",
        f"# rows: {len(rows)} (decimate={stride})",
        f"# columns: time,{','.join(columns)}",
        "# source: recorder (probes)",
        "time," + ",".join(columns),
    ]
    for frame in rows:
        values = [f"{frame['t']:.9g}"]
        for key in selected:
            raw = frame["v"].get(key)
            values.append("" if raw is None else f"{float(raw):.9g}")
        lines.append(",".join(values))
    target_dir = Path(directory).expanduser()
    target_dir.mkdir(parents=True, exist_ok=True)
    base = (
        "".join(char for char in (name or "analysis") if char.isalnum() or char in "-_")
        or "analysis"
    )
    path = target_dir / f"{base}.csv"
    index = 2
    while path.exists():
        path = target_dir / f"{base}-{index}.csv"
        index += 1
    from ..model.project import atomic_write

    atomic_write(path, "\n".join(lines) + "\n")
    return {
        "ok": True,
        "path": str(path),
        "rows": len(rows),
        "columns": ["time"] + columns,
        "decimate": stride,
        "source": "recorder (probes)",
    }


