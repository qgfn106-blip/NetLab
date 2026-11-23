"""P3 分析旁路（R12 / R11 / R17）：指标、频谱、周期推荐、数学形式、CSV 导出。

原则：只读录制数据，绝不写回求解器。每个结论都带 ``source``（算法/来源），
无法解析时返回 ``ok=false`` 与原因，而不是静默编造。
"""

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
from .circuit.fft_frequency import (
    approximation_envelope,
    estimate_transfer_fft,
    multisine,
)
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


ANALYSIS_TIMEOUT = 5.0
MAX_EXPORT_ROWS = 200_000


class AnalysisError(Exception):
    """分析失败/超时；服务层转 422。"""


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


def _uniform(times: np.ndarray, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """把不等间隔的录制重采样到均匀网格（dt=中位间隔）。"""
    if len(times) < 3:
        raise AnalysisError("录制点数不足（<3），先运行一段再分析")
    diffs = np.diff(times)
    diffs = diffs[diffs > 0]
    if not len(diffs):
        raise AnalysisError("录制时间没有推进")
    dt = float(np.median(diffs))
    grid = np.arange(times[0], times[-1] + dt * 0.5, dt)
    return grid, np.interp(grid, times, values)


def _crossing(times: np.ndarray, values: np.ndarray, level: float) -> float | None:
    for index in range(1, len(values)):
        a, b = values[index - 1], values[index]
        if (a - level) == 0:
            return float(times[index - 1])
        if (a - level) * (b - level) < 0:
            ratio = (level - a) / (b - a)
            return float(times[index - 1] + ratio * (times[index] - times[index - 1]))
    return None


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


def _shift_score(
    grid: np.ndarray, values: np.ndarray, period: float
) -> tuple[float, float] | None:
    """按 period 平移一个周期，返回 (score, mae)；样本不足返回 None。"""
    shifted = np.interp(grid + period, grid, values, left=np.nan, right=np.nan)
    mask = np.isfinite(shifted)
    if mask.sum() < max(8, len(grid) // 3):
        return None
    std = float(np.std(values[mask])) or 1.0
    mae = float(np.mean(np.abs(values[mask] - shifted[mask]))) / std
    return max(0.0, 1.0 - mae), mae


def _period_windows(size: int) -> list[tuple[int, int]]:
    """返回全窗 + 前后两个重叠子窗，用于备选周期稳定性统计。"""
    windows = [(0, size)]
    if size >= 24:
        windows.append((0, max(12, int(round(size * 0.65)))))
        windows.append((min(size - 12, int(round(size * 0.35))), size))
    return windows


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


def _number(value: Any) -> str:
    number = float(value)
    return str(int(number)) if number.is_integer() else repr(number)


def _state_space_payload(tf: Any) -> dict[str, Any] | None:
    """把 ``TransferFunction`` 转成可控标准型 A/B/C/D（只读呈现）。"""
    try:
        state_space = tf.to_state_space()
    except Exception:
        return None
    if state_space is None:
        return None
    a, b, c, d = state_space
    return {
        "realization": "controllable_canonical",
        "order": int(a.shape[0]),
        "A": [[float(value) for value in row] for row in a],
        "B": [[float(value) for value in row] for row in b],
        "C": [[float(value) for value in row] for row in c],
        "D": [[float(value) for value in row] for row in d],
        "note": "由总传函系数构造的可控标准型；仅用于导出/复核，不改变求解器内部状态",
    }


def _node_tf(kind: str, params: dict[str, Any]) -> str | None:
    if kind == "gain":
        return _number(params.get("gain", 1.0))
    if kind == "sum":
        return None  # 权重在边上处理
    if kind == "lag":
        tau = _number(params.get("tau", 0.1))
        return f"1/(1+({tau})*s)"
    if kind == "integrate":
        gain = _number(params.get("gain", 1.0))
        return f"({gain})/s"
    if kind == "transfer_function":
        # 三种输入形态统一走 transfer.from_params；sympy 只认 ** 形式的幂。
        return transfer_math.from_params(params).to_expression(power="**")
    return ""


def transfer_function(
    sim: Any,
    input_node: str,
    output_node: str,
    *,
    input_field: str = "voltage",
    output_field: str = "voltage",
    domain: str = "s",
    delay_pade_order: int = 3,
) -> dict[str, Any]:
    """线性网络符号传递函数（sympy 可选）；``domain='z'`` 支持显式 z⁻¹。

    ``domain='s'`` 时，单步延迟边按 ``e^{-s·dt}`` 的 ``delay_pade_order``
    阶 Padé 有理近似处理（默认 3 阶）；``domain='z'`` 保持精确 ``z⁻¹``。
    """
    if domain not in {"s", "z"}:
        return {
            "ok": False,
            "reason": f"未知传递函数域 {domain!r}（只支持 s / z）",
            "source": "symbolic",
        }
    try:
        delay_pade_order = int(delay_pade_order)
    except (TypeError, ValueError):
        return {
            "ok": False,
            "reason": f"延迟 Padé 阶数必须是整数，收到 {delay_pade_order!r}",
            "source": "symbolic",
        }
    if not 1 <= delay_pade_order <= 8:
        return {
            "ok": False,
            "reason": "延迟 Padé 阶数必须在 1–8 之间",
            "source": "symbolic",
        }
    try:
        import sympy as sp
    except Exception as exc:  # pragma: no cover - 环境相关
        return {
            "ok": False,
            "reason": f"未安装 sympy，无法做符号推导：{exc}",
            "source": "symbolic（sympy 可选）",
        }
    scene = sim.scene
    if scene.mode != "signal":
        return {
            "ok": False,
            "reason": "目前只支持 signal 模式的线性传递函数",
            "source": "symbolic",
        }
    nodes = {node.name: node for node in scene.nodes.values()}
    nodes_by_id = {node.id: node for node in scene.nodes.values()}
    if input_node not in nodes or output_node not in nodes:
        return {"ok": False, "reason": "输入/输出节点名不存在", "source": "symbolic"}
    s = sp.Symbol("s")
    z = sp.Symbol("z")
    variable = z if domain == "z" else s
    try:
        delay_seconds = float(getattr(sim.config, "dt", 0.0))
    except (AttributeError, TypeError, ValueError):
        delay_seconds = 0.0

    def pade_delay() -> Any:
        """e^{-sT} 的 [p/p] Padé 有理近似（T=一个仿真步长）。"""
        if domain != "s":
            return sp.Integer(1)
        if not math.isfinite(delay_seconds) or delay_seconds <= 0.0:
            raise AnalysisError("s 域延迟近似需要正数仿真步长 dt")
        x = s * sp.Rational(str(delay_seconds))
        numerator = sp.Integer(0)
        denominator = sp.Integer(0)
        order = delay_pade_order
        for k in range(order + 1):
            coefficient = (
                sp.factorial(2 * order - k)
                * sp.factorial(order)
                / (sp.factorial(2 * order) * sp.factorial(k) * sp.factorial(order - k))
            )
            numerator += coefficient * (-x) ** k
            denominator += coefficient * x**k
        return sp.cancel(numerator / denominator)

    nonlinear_kinds = {
        "expression",
        "clip",
        "deadband",
        "saturate",
        "lookup",
        "table",
        "piecewise",
    }
    for node in nodes.values():
        if node.kind in nonlinear_kinds:
            return {
                "ok": False,
                "reason": f"网络含非线性节点 {node.name!r}（kind={node.kind!r}），不适用线性总传函",
                "source": "symbolic（sympy）",
            }

    def sym_number(value: Any) -> Any:
        # exact：十进制输入 -> 精确有理数（避免早期 float 漂移）；
        # standard：退回旧行为 sp.sympify(str(value))，允许 sp.Float（大系统提速）。
        if numeric_precision_mode() == "exact":
            return _to_exact(value)
        return sp.sympify(str(value))

    def local_tf(node: Any) -> Any:
        kind = node.kind
        params = node.params
        if kind == "gain":
            return sym_number(params.get("gain", 1.0))
        if kind == "sum":
            return sp.Integer(1)
        if domain == "z":
            raise AnalysisError(
                f"z 域总传函只支持 gain/sum 节点；{node.name!r} 是 {kind!r}，"
                "请改用逐拍仿真或先离散化"
            )
        if kind == "lag":
            tau = sym_number(params.get("tau", 0.1))
            return 1 / (1 + tau * s)
        if kind == "integrate":
            return sym_number(params.get("gain", 1.0)) / s
        if kind == "transfer_function":
            return sp.sympify(_node_tf(kind, params))
        if kind == "state_space":
            def _exact_rows(key: str, default: list) -> sp.Matrix:
                rows = params.get(key) or default
                return sp.Matrix([[sym_number(x) for x in row] for row in rows])

            a = _exact_rows("A", [])
            b = _exact_rows("B", [])
            c = _exact_rows("C", [])
            d = _exact_rows("D", [[0.0]])
            if a.shape[0] == 0 or b.shape[0] != a.shape[0]:
                raise AnalysisError(f"状态空间节点 {node.name!r} 的 A/B 维度不匹配")
            transfer = c * (s * sp.eye(a.shape[0]) - a).inv() * b + d
            return sp.simplify(transfer[0, 0])
        if kind in {"manual", "signal"}:
            return None
        raise AnalysisError(
            f"节点 {node.name!r}（kind={kind!r}）不在总传函支持范围内；"
            "目前支持 gain/sum/lag/integrate/transfer_function/state_space"
        )

    def edge_weight(edge: Any, target_node: Any) -> Any:
        delay_factor = sp.Integer(1)
        if edge.delay:
            delay_factor = pade_delay() if domain == "s" else 1 / variable
        if edge.kind == "pass":
            base = sp.Integer(1)
        elif edge.kind == "scale":
            base = sym_number((edge.params or {}).get("gain", 1.0))
        else:
            raise AnalysisError(
                f"连接 {edge.name!r} 的边类型 {edge.kind!r} 不在总传函支持范围内"
            )
        if target_node.kind == "sum":
            weights = target_node.params.get("weights") or {}
            weight = weights.get(edge.name, 1)
            return base * sym_number(weight) * delay_factor
        return base * delay_factor

    unknowns = [sp.Symbol(f"y_{index}") for index in range(len(nodes))]
    by_name = dict(zip(nodes.keys(), unknowns))
    equations = []
    for node in nodes.values():
        symbol = by_name[node.name]
        if node.name == input_node:
            equations.append(sp.Eq(symbol, sp.Integer(1)))
            continue
        local = local_tf(node)
        if local is None:
            equations.append(sp.Eq(symbol, sp.Integer(0)))
            continue
        total = sp.Integer(0)
        for edge in scene.edges.values():
            if not edge.enabled or edge.target != node.id:
                continue
            source = nodes_by_id.get(edge.source)
            if source is None:
                continue
            total += edge_weight(edge, node) * by_name[source.name]
        equations.append(sp.Eq(symbol, sp.expand(local * total)))

    try:
        solutions = sp.solve(equations, unknowns, dict=True)
        if not solutions:
            raise AnalysisError("线性网络节点方程无解，无法得到总传函")
        expr = sp.simplify(solutions[0][by_name[output_node]])
    except AnalysisError as exc:
        return {"ok": False, "reason": str(exc), "source": "symbolic（sympy）"}
    except Exception as exc:
        return {
            "ok": False,
            "reason": f"符号推导失败：{exc}",
            "source": "symbolic（sympy）",
        }
    if expr == 0:
        return {
            "ok": False,
            "reason": "从输入到输出没有线性通路（或增益为 0）",
            "source": "symbolic（sympy）",
        }
    num, den = sp.fraction(sp.together(expr))
    try:
        num_poly = sp.Poly(sp.expand(num), variable)
        den_poly = sp.Poly(sp.expand(den), variable)
        num_coeffs = [float(item) for item in num_poly.all_coeffs()][::-1]
        den_coeffs = [float(item) for item in den_poly.all_coeffs()][::-1]
    except Exception:
        num_coeffs, den_coeffs = [], []
    state_space = None
    if domain == "s":
        try:
            state_space = _state_space_payload(
                transfer_math.parse_expression(str(expr).replace("**", "^"))
            )
        except Exception:
            state_space = None
    return {
        "ok": True,
        "domain": domain,
        "variable": str(variable),
        "input": {"node": input_node, "field": input_field},
        "output": {"node": output_node, "field": output_field},
        "expression": str(expr),
        "numerator": str(num),
        "denominator": str(den),
        "numerator_coeffs": num_coeffs,
        "denominator_coeffs": den_coeffs,
        "order": max(0, len(den_coeffs) - 1),
        "state_space": state_space,
        "delay_pade_order": delay_pade_order if domain == "s" else 0,
        "delay_seconds": delay_seconds if domain == "s" else 0.0,
        "assumptions": [
            "线性节点：gain/sum/lag/integrate/transfer_function/state_space，pass/scale 连接；忽略偏置、限幅、初值",
            (
                f"z 域延迟边为精确 z⁻¹；s 域延迟边按 e^(-s·{delay_seconds:g}) 的 {delay_pade_order} 阶 Padé 近似"
                if domain == "s"
                else "z 域延迟边为精确 z⁻¹"
            ),
            "输入节点以外的独立源按 0 处理；非线性节点明确报错，不静默线性化",
            "结果只作数学形式呈现，不参与求解",
        ],
        "source": "symbolic（sympy）；线性网络节点方程求总传函",
    }


def _complex_pairs(matrix: Any) -> list[list[list[float]]]:
    """把矩阵编码为 ``[[re, im], ...]``，保证 JSON 可序列化。"""
    array = np.asarray(matrix, dtype=np.complex128)
    return [
        [[float(value.real), float(value.imag)] for value in row]
        for row in array
    ]


def _complex_list(values: Any) -> list[list[float]]:
    """把一维复数数组编码为 ``[[re, im], ...]``。"""
    array = np.asarray(values, dtype=np.complex128).reshape(-1)
    return [[float(value.real), float(value.imag)] for value in array]


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


def _frequency_axis(
    f_start: float,
    f_stop: float,
    points: int,
    scale: str,
) -> np.ndarray:
    """生成频响频率轴；单点/零频/负频都明确报错。"""
    if isinstance(points, bool) or not isinstance(points, (int, np.integer)):
        raise AnalysisError("频响点数必须是整数")
    if not 2 <= int(points) <= 2001:
        raise AnalysisError("频响点数必须在 2–2001 之间")
    if not all(math.isfinite(float(value)) for value in (f_start, f_stop)):
        raise AnalysisError("频响起止频率必须是有限数值")
    if float(f_start) <= 0.0 or float(f_stop) <= float(f_start):
        raise AnalysisError("频响要求 0 < f_start < f_stop")
    if scale not in {"log", "lin"}:
        raise AnalysisError("频响 scale 只能是 log 或 lin")
    count = int(points)
    if scale == "log":
        return np.geomspace(float(f_start), float(f_stop), count)
    return np.linspace(float(f_start), float(f_stop), count)


def _analytic_loop_frequency_response(
    extraction: Any, frequencies: Any
) -> np.ndarray | None:
    """用断环解析传函计算回路频响，避免数值断环在高频的条件数退化。

    extraction.loop_gain 来自每个频点的描述系统数值求解；当回路增益幅值
    很小（高频段）时，断环测试解与输入解会发生严重相消，出现虚假的
    -160 dB 地板和相位跳回 0°。open_loop_transfer 是同一描述系统铅笔
    的解析传函（表达式形式），低频已与数值解逐点一致，全程用它可保证
    Bode/Nyquist 符合数学推导。解析不可用时回退到原始数值解。
    """
    transfer = getattr(extraction, "open_loop_transfer", None)
    if not isinstance(transfer, dict):
        return None
    if not transfer.get("supported") or not transfer.get("expression"):
        return None
    try:
        tf = transfer_math.parse_expression(str(transfer["expression"]))
        magnitude, phase = tf.frequency_response(
            2.0 * math.pi * np.asarray(frequencies, dtype=np.float64)
        )
        response = np.asarray(magnitude, dtype=np.float64) * np.exp(
            1j * np.asarray(phase, dtype=np.float64)
        )
    except Exception:  # noqa: BLE001 - 解析不可用时保持原有数值路径
        return None
    if response.shape != np.asarray(frequencies).shape:
        return None
    if not np.all(np.isfinite(response.real)) or not np.all(np.isfinite(response.imag)):
        return None
    return response


def _node_frequency_gain(node: Any, omega: float) -> complex:
    """单个 signal 节点在 jω 处的局部复增益。"""
    kind = node.kind
    params = getattr(node, "params", None) or {}
    if kind == "sum":
        return 1.0 + 0.0j
    if kind == "gain":
        return complex_layer.as_complex(params.get("gain", 1.0))
    if kind == "lag":
        tau = float(params.get("tau", 0.1))
        return 1.0 / (1.0 + 1j * omega * tau)
    if kind == "integrate":
        if omega == 0.0:
            raise AnalysisError(f"积分节点 {node.name!r} 在 0 Hz 处没有有限频响")
        return complex_layer.as_complex(params.get("gain", 1.0)) / (1j * omega)
    if kind == "transfer_function":
        try:
            return complex(transfer_math.from_params(params).at(1j * omega))
        except Exception as exc:
            raise AnalysisError(
                f"节点 {node.name!r} 的传递函数参数无效：{exc}"
            ) from exc
    if kind == "state_space":
        try:
            model = StateSpaceModel.from_params(params)
            if model.b.shape[1] != 1 or model.c.shape[0] != 1:
                raise AnalysisError(
                    f"状态空间节点 {node.name!r} 只支持单输入单输出频响"
                )
            matrix = 1j * omega * np.eye(model.a.shape[0]) - model.a
            value = model.c @ np.linalg.solve(matrix, model.b) + model.d
            return complex(value[0, 0])
        except AnalysisError:
            raise
        except Exception as exc:
            raise AnalysisError(f"状态空间节点 {node.name!r} 频响失败：{exc}") from exc
    if kind in {"manual", "signal"}:
        return 0.0 + 0.0j
    raise AnalysisError(
        f"节点 {node.name!r}（kind={kind!r}）不在频响支持范围内；"
        "目前支持 gain/sum/lag/integrate/transfer_function/state_space"
    )


def _edge_frequency_weight(edge: Any, dt: float, omega: float) -> complex:
    if edge.kind == "pass":
        base = 1.0 + 0.0j
    elif edge.kind == "scale":
        base = complex_layer.as_complex((edge.params or {}).get("gain", 1.0))
    else:
        raise AnalysisError(
            f"连接 {edge.name!r} 的边类型 {edge.kind!r} 不在频响支持范围内"
        )
    if edge.delay:
        if dt <= 0.0:
            raise AnalysisError(f"连接 {edge.name!r} 带延迟，但仿真步长 dt 不是正数")
        base *= np.exp(-1j * omega * dt)
    return base


def _signal_frequency_response(
    sim: Any,
    input_node: str,
    output_node: str,
    frequencies: np.ndarray,
    diag_sink: dict | None = None,
) -> np.ndarray:
    scene = sim.scene
    nodes = {node.name: node for node in scene.nodes.values()}
    nodes_by_id = {node.id: node for node in scene.nodes.values()}
    if input_node not in nodes or output_node not in nodes:
        raise AnalysisError("输入/输出节点名不存在")
    nonlinear = {
        "expression",
        "clip",
        "deadband",
        "saturate",
        "lookup",
        "table",
        "piecewise",
    }
    for node in nodes.values():
        if node.kind in nonlinear:
            raise AnalysisError(
                f"网络含非线性节点 {node.name!r}（kind={node.kind!r}），不适用线性频响"
            )
    names = list(nodes)
    index = {name: position for position, name in enumerate(names)}
    dt = float(getattr(sim.config, "dt", 0.0) or 0.0)
    values = np.empty(frequencies.size, dtype=np.complex128)
    diag_points: list[dict[str, Any]] = []
    for position, frequency in enumerate(frequencies):
        omega = 2.0 * math.pi * float(frequency)
        matrix = np.zeros((len(names), len(names)), dtype=np.complex128)
        rhs = np.zeros(len(names), dtype=np.complex128)
        for row, name in enumerate(names):
            node = nodes[name]
            if name == input_node:
                matrix[row, row] = 1.0
                rhs[row] = 1.0
                continue
            local = _node_frequency_gain(node, omega)
            matrix[row, row] = 1.0
            for edge in scene.edges.values():
                if not edge.enabled or edge.target != node.id:
                    continue
                source = nodes_by_id.get(edge.source)
                if source is None:
                    continue
                weight = _edge_frequency_weight(edge, dt, omega)
                if node.kind == "sum":
                    weights = node.params.get("weights") or {}
                    weight *= float(weights.get(edge.name, 1.0))
                matrix[row, index[source.name]] -= local * weight
        try:
            solution = np.linalg.solve(matrix, rhs)
        except np.linalg.LinAlgError as exc:
            raise AnalysisError(f"频响节点方程在 {frequency:g} Hz 处奇异") from exc
        values[position] = solution[index[output_node]]
        if diag_sink is not None:
            diag_points.append(_freq_point(matrix, rhs, solution))
    if diag_sink is not None:
        diag_sink["points"] = diag_points
    return values


def _circuit_frequency_response(
    sim: Any,
    input_source: str,
    output_probe: str,
    frequencies: np.ndarray,
) -> np.ndarray:
    try:
        result = sim.ac_sweep(
            frequencies.tolist(),
            input_source=input_source,
            probes=[output_probe],
        )
    except Exception as exc:
        raise AnalysisError(f"电路 AC 频响失败：{exc}") from exc
    row = (result.get("probes") or {}).get(output_probe)
    if not isinstance(row, dict):
        raise AnalysisError(f"电路频响没有返回探针 {output_probe!r}")
    real = row.get("real")
    imag = row.get("imag")
    if isinstance(real, list) and isinstance(imag, list):
        return np.asarray(real, dtype=np.complex128) + 1j * np.asarray(
            imag, dtype=np.complex128
        )
    magnitude = np.asarray(row.get("magnitude", []), dtype=float)
    phase = np.radians(np.asarray(row.get("phase_deg", []), dtype=float))
    return magnitude * np.exp(1j * phase)


def frequency_response(
    sim: Any,
    input: str,
    output: str,
    *,
    f_start: float = 1.0,
    f_stop: float = 1_000_000.0,
    points: int = 241,
    scale: str = "log",
    input_field: str = "voltage",
    output_field: str = "voltage",
) -> dict[str, Any]:
    """统一频响入口：signal 用复数节点方程，circuit 复用复数 MNA。

    时域数据、求解器状态与工程持久化都不在这里改写；本函数只读参数并
    返回频率轴与复数值的四相表示（real/imag/magnitude/phase_deg）。
    """
    frequencies = _frequency_axis(f_start, f_stop, points, scale)
    mode = str(getattr(sim.scene, "mode", ""))
    freq_diag_points: list[dict[str, Any]] | None = None
    if mode == "signal":
        try:
            signal_diag = {"points": []} if _freq_diag_enabled() else None
            values = _signal_frequency_response(
                sim, input, output, frequencies, diag_sink=signal_diag
            )
            freq_diag_points = signal_diag["points"] if signal_diag is not None else None
        except AnalysisError as exc:
            return {
                "ok": False,
                "mode": "signal",
                "backend": "complex_graph",
                "input": input,
                "output": output,
                "frequencies_hz": [float(value) for value in frequencies],
                "reason": str(exc),
                "warnings": [],
                "source": "complex analysis layer（R39）",
            }
        backend = "complex_graph"
        assumptions = [
            "signal 节点按 jω 局部增益线性化，节点方程 (I-W(jω))y=b",
            "延迟边使用精确 e^(-jω·dt)，非 Padé 近似",
            "非线性节点明确报错，不静默线性化",
        ]
    elif mode == "circuit":
        values = _circuit_frequency_response(sim, input, output, frequencies)
        backend = "complex_mna"
        assumptions = [
            "复用电路 DC 工作点与复数 MNA 小信号分析",
            "线性元件按复阻抗 stamp；非线性元件仍由 AC 分析拒绝",
        ]
    else:
        raise AnalysisError(f"当前模式 {mode!r} 不支持频响分析")
    real, imag = complex_layer.complex_parts(values)
    phase = complex_layer.phase_degrees(values)
    return {
        "ok": True,
        "mode": mode,
        "backend": backend,
        "input": input,
        "output": output,
        "input_field": input_field,
        "output_field": output_field,
        "frequencies_hz": [float(value) for value in frequencies],
        "omega": [float(2.0 * math.pi * value) for value in frequencies],
        "omega_rad_s": [float(2.0 * math.pi * value) for value in frequencies],
        "real": [float(value) for value in real],
        "imag": [float(value) for value in imag],
        "magnitude": [float(abs(value)) for value in values],
        "phase_deg": [float(value) for value in phase],
        "assumptions": assumptions,
        "warnings": [],
        "diagnostics": (
            _freq_summarize(freq_diag_points)
            if freq_diag_points is not None
            else {
                "diag_enabled": False,
                "any_ill_conditioned": False,
                "max_rel_residual": None,
                "points": [],
            }
        ),
        "source": "complex analysis layer（R39）",
    }


def _resolve_operating_point(
    sim: Any, operating_point: dict[str, float] | None
) -> dict[str, float] | None:
    """断环分析缺少工作点时，先求一次直流工作点。

    含运放/二极管等非线性器件的电路必须在工作点处线性化，否则
    DescriptorModel 会拒收这些元件；这里自动补一次 DC 工作点。纯线性
    电路也会额外求解一次，但结果与器件线性化无关。
    """
    if operating_point:
        return operating_point
    try:
        result = sim.operating_point()
    except (ComputeError, ValidationError, ValueError) as exc:
        raise AnalysisError(
            f"断环分析需要直流工作点，但工作点求解失败：{exc}"
        ) from exc
    values = result.get("node_voltages") if isinstance(result, dict) else None
    return values or None


def _loop_model(
    sim: Any, operating_point: dict[str, float] | None
) -> tuple[Any, DescriptorModel]:
    if sim is None:
        raise AnalysisError("断环分析必须提供电路仿真")
    scene = getattr(sim, "scene", None)
    if scene is None or getattr(scene, "mode", None) != "circuit":
        raise AnalysisError("断环分析需要 circuit 模式场景")
    operating_point = _resolve_operating_point(sim, operating_point)
    try:
        model = DescriptorModel.from_scene(scene, operating_point=operating_point)
    except ComputeError as exc:
        raise AnalysisError(f"断环状态空间构建失败：{exc}") from exc
    return scene, model


def break_points(sim: Any, *, operating_point: dict[str, float] | None = None) -> dict[str, Any]:
    """列出当前电路可断环的受控源，供前端选择。"""
    scene, model = _loop_model(sim, operating_point)
    candidates = break_candidates(model)
    for item in candidates:
        for key in ("control_a", "control_b", "output_a", "output_b"):
            node_id = item.get(key)
            node = model.index.node_by_id.get(node_id) if node_id is not None else None
            item[key] = str(getattr(node, "name", None) or node_id)
    return {
        "ok": True,
        "candidates": candidates,
        "branch_candidates": branch_candidates(model),
        "scene": {
            "mode": getattr(scene, "mode", "circuit"),
            "elements": len(getattr(scene, "edges", {}) or {}),
        },
    }


def loop_candidates(sim: Any, *, operating_point: dict[str, float] | None = None) -> dict[str, Any]:
    """列出候选反馈环路，供前端缩略图/一次选中整环。

    信号流模式：按有向连接图（enabled 且非延迟）做 Tarjan SCC，自动枚举反馈环，
    返回成员节点/边与候选断点；电路模式：暂不自动枚举拓扑环，返回受控源候选断点。
    """
    scene = getattr(sim, "scene", sim)
    mode = str(getattr(scene, "mode", "circuit"))
    scene_summary = {
        "mode": mode,
        "nodes": len(getattr(scene, "nodes", {}) or {}),
        "edges": len(getattr(scene, "edges", {}) or {}),
    }
    if mode == "signal":
        engine = scene.ensure_engine()
        network = getattr(engine, "network", None)
        if network is None:
            return {"ok": False, "mode": mode, "loops": [], "reason": "信号流引擎未就绪"}
        edge_id_by_name = {
            conn.name: rid for rid, conn in getattr(engine, "edge_map", {}).items()
        }
        node_id_by_name = {
            node.name: rid for rid, node in getattr(engine, "node_map", {}).items()
        }
        loops: list[dict[str, Any]] = []
        for index, group in enumerate(network.algebraic_cycle_groups(), start=1):
            members = list(group["nodes"])
            internal = list(group["edges"])
            self_loops = [c for c in internal if c.source is c.target]
            ordered = self_loops + [c for c in internal if c not in self_loops]
            breaks = [
                {
                    "break_id": edge_id_by_name.get(c.name, c.name),
                    "name": c.name,
                    "kind": "signal_edge",
                    "suggested": pos == 0,
                }
                for pos, c in enumerate(ordered)
            ]
            loops.append(
                {
                    "loop_id": f"loop-{index}",
                    "label": f"候选环 {index}",
                    "member_node_ids": [node_id_by_name.get(n.name, n.name) for n in members],
                    "member_node_names": [n.name for n in members],
                    "member_edge_ids": [edge_id_by_name.get(c.name, c.name) for c in internal],
                    "member_edge_names": [c.name for c in internal],
                    "candidate_breaks": breaks,
                    "suggested_break_id": breaks[0]["break_id"] if breaks else None,
                    "feedback_sign": 1,
                }
            )
        return {"ok": True, "mode": mode, "loops": loops, "scene": scene_summary}
    scene2, model = _loop_model(sim, operating_point)
    circuit_candidates = break_candidates(model)
    for item in circuit_candidates:
        for key in ("control_a", "control_b", "output_a", "output_b"):
            node_id = item.get(key)
            node = model.index.node_by_id.get(node_id) if node_id is not None else None
            item[key] = str(getattr(node, "name", None) or node_id)
    branches = branch_candidates(model)
    return {
        "ok": True,
        "mode": mode,
        "loops": [],
        "break_candidates": circuit_candidates,
        "branch_candidates": branches,
        "reason": "电路模式暂不自动枚举拓扑环，请从候选断点或反馈支路点选后解析",
        "scene": {
            "mode": mode,
            "nodes": len(getattr(scene2, "nodes", {}) or {}),
            "edges": len(getattr(scene2, "edges", {}) or {}),
        },
    }


def loop_from_break(
    sim: Any, *, break_id: str, operating_point: dict[str, float] | None = None
) -> dict[str, Any]:
    """电路模式：以用户点选的反馈支路为断点，搜索包含它的最短闭合拓扑路径。

    导线（kind=="wire"）先并查集合并为电气 net，器件作为 net 间无向边；删除所选
    支路后从其一端 BFS 回到另一端，找到即组成一个候选 LoopGroup。该结果仅用于
    缩略图/一次选中整环，feedback_sign 默认 +1，须用户确认。
    """
    scene = getattr(sim, "scene", sim)
    mode = str(getattr(scene, "mode", "circuit"))
    if mode != "circuit":
        raise AnalysisError("按支路选环需要 circuit 模式场景")
    edges = dict(getattr(scene, "edges", {}) or {})
    nodes = dict(getattr(scene, "nodes", {}) or {})
    edge_by_token: dict[str, Any] = {}
    for edge in edges.values():
        edge_by_token[str(getattr(edge, "id", ""))] = edge
        edge_by_token[str(getattr(edge, "name", ""))] = edge
    break_edge = edge_by_token.get(str(break_id))
    if break_edge is None:
        raise AnalysisError(f"未找到反馈支路：{break_id}")
    parent = {node_id: node_id for node_id in nodes}

    def find(x: str) -> str:
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for edge in edges.values():
        if edge is break_edge:
            continue
        if getattr(edge, "enabled", True) and str(getattr(edge, "kind", "")) == "wire":
            union(str(edge.source), str(edge.target))

    def net_of(token: str) -> str:
        return find(token) if token in parent else str(token)

    source_net = net_of(str(break_edge.source))
    target_net = net_of(str(break_edge.target))
    adjacency: dict[str, list[tuple[str, Any]]] = {}
    for edge in edges.values():
        if edge is break_edge:
            continue
        if not getattr(edge, "enabled", True):
            continue
        if str(getattr(edge, "kind", "")) == "wire":
            continue
        a = net_of(str(edge.source))
        b = net_of(str(edge.target))
        if a == b:
            continue
        adjacency.setdefault(a, []).append((b, edge))
        adjacency.setdefault(b, []).append((a, edge))

    prev: dict[str, tuple[str, Any] | None] = {target_net: None}
    queue = [target_net]
    found = False
    while queue:
        current = queue.pop(0)
        if current == source_net:
            found = True
            break
        for neighbor, edge in adjacency.get(current, ()):
            if neighbor in prev:
                continue
            prev[neighbor] = (current, edge)
            queue.append(neighbor)
    scene_summary = {"mode": mode, "nodes": len(nodes), "edges": len(edges)}
    if not found:
        return {
            "ok": False,
            "mode": mode,
            "break_id": str(break_id),
            "reason": "所选的反馈支路不在任何闭合反馈环中",
            "scene": scene_summary,
        }
    path_edges: list[Any] = []
    cursor = source_net
    while prev[cursor] is not None:
        parent_net, edge = prev[cursor]
        path_edges.append(edge)
        cursor = parent_net
    loop_edges = path_edges + [break_edge]
    node_ids: list[str] = []
    for edge in loop_edges:
        for endpoint in (str(edge.source), str(edge.target)):
            if endpoint not in node_ids:
                node_ids.append(endpoint)
    node_names = [str(getattr(nodes.get(nid), "name", nid)) for nid in node_ids]
    loop = {
        "loop_id": f"loop-{getattr(break_edge, 'id', break_id)}",
        "label": f"反馈环（{getattr(break_edge, 'name', break_id)}）",
        "member_node_ids": node_ids,
        "member_node_names": node_names,
        "member_edge_ids": [str(getattr(e, "id", "")) for e in loop_edges],
        "member_edge_names": [str(getattr(e, "name", "")) for e in loop_edges],
        "candidate_breaks": [
            {
                "break_id": str(getattr(break_edge, "id", break_id)),
                "name": str(getattr(break_edge, "name", break_id)),
                "kind": "circuit_branch",
                "suggested": True,
            }
        ],
        "suggested_break_id": str(getattr(break_edge, "id", break_id)),
        "feedback_sign": 1,
    }
    return {
        "ok": True,
        "mode": mode,
        "loop": loop,
        "loops": [loop],
        "warnings": [
            "电路模式按无向拓扑搜索包含该支路的最短闭合路径；feedback_sign 默认 +1，需用户确认。"
        ],
        "scene": scene_summary,
    }


def _resolve_loop_probe(
    sim: Any,
    *,
    loop_probe: dict[str, Any] | None,
    operating_point: dict[str, float] | None,
) -> tuple[str, str | None]:
    """把虚拟支路探针解析为环内可断开的线性受控源。

    LoopProbeSpec 只带 break_id（用户点选的反馈支路）与 loop_id。分析层不向
    用户电路插入任何 BRK 夹具：先按支路找出所属闭合环，再在环内选择已有的
    VCVS/VCCS 作为矩阵级断点。若环内没有线性受控源，则无法在不改变电路
    的前提下定义唯一开环 L(s)，明确 fail-closed。
    """
    probe = dict(loop_probe or {})
    break_id = str(probe.get("break_id") or probe.get("element") or "").strip()
    if not break_id:
        raise AnalysisError("虚拟断环探针需要 break_id（用户点选的反馈支路）")
    scene = getattr(sim, "scene", sim)
    edges = dict(getattr(scene, "edges", {}) or {})
    by_token: dict[str, Any] = {}
    for edge in edges.values():
        by_token[str(getattr(edge, "id", ""))] = edge
        by_token[str(getattr(edge, "name", ""))] = edge
    selected = by_token.get(break_id)
    if selected is not None and str(getattr(selected, "kind", "")) in ("vcvs", "vccs"):
        return str(getattr(selected, "name", "") or break_id), str(probe.get("loop_id") or "") or None
    # v8 器件节点场景：用户点选的反馈支路可能是 device 节点（电阻），直接作为无源支路断点。
    for node in (getattr(scene, "nodes", {}) or {}).values():
        token = str(getattr(node, "id", "")) or str(getattr(node, "name", ""))
        if break_id not in (str(getattr(node, "id", "")), str(getattr(node, "name", ""))):
            continue
        params = getattr(node, "params", {}) or {}
        if str(getattr(node, "kind", "")) == "device" and str(params.get("element", "")) == "resistor":
            return str(getattr(node, "name", "") or token), str(probe.get("loop_id") or "") or None
    group = loop_from_break(sim, break_id=break_id, operating_point=operating_point)
    if not group.get("ok"):
        raise AnalysisError(str(group.get("reason") or "所选反馈支路不在任何闭合反馈环中"))
    loop = dict(group.get("loop") or {})
    for edge_id in loop.get("member_edge_ids") or []:
        candidate = edges.get(str(edge_id)) or by_token.get(str(edge_id))
        if candidate is not None and str(getattr(candidate, "kind", "")) in ("vcvs", "vccs"):
            return str(getattr(candidate, "name", "") or edge_id), str(loop.get("loop_id") or "")
    raise AnalysisError(
        "所选环路不含 VCVS/VCCS 线性受控源，无法在不改变电路的前提下定义唯一开环 L(s)；"
        "当前只能显示闭环 T(s)"
    )


def _virtual_loop_analysis(
    sim: Any,
    *,
    input_source: str | None,
    output: str | None,
    feedback_sign: float,
    f_start: float,
    f_stop: float,
    points: int,
    scale: str,
    display: str,
    step_dt: float,
    step_duration: float,
    operating_point: dict[str, float] | None,
) -> dict[str, Any]:
    """无实体断环时仅展示直接求得的闭环 T(s)（明确标注，不参与判稳，不冒充开环）。"""
    if not input_source or not output:
        raise AnalysisError("虚拟单位负反馈需要 input_source 与 output")
    tf = tf_analysis(
        sim,
        mode="circuit",
        input_source=input_source,
        output=output,
        operating_point=operating_point,
        step_dt=step_dt,
        step_duration=step_duration,
        f_start=f_start,
        f_stop=f_stop,
        points=points,
        scale=scale,
    )
    bode = tf.get("bode") or {}
    probe = (bode.get("probes") or {}).get(output) or bode
    frequencies = np.asarray(probe.get("frequencies") or bode.get("frequencies") or [], dtype=float)
    magnitude_db = np.asarray(probe.get("db") or bode.get("db") or [], dtype=float)
    phase_deg = np.asarray(probe.get("phase_deg") or bode.get("phase_deg") or [], dtype=float)
    count = min(frequencies.size, magnitude_db.size, phase_deg.size)
    frequencies = frequencies[:count]
    magnitude_db = magnitude_db[:count]
    phase_deg = phase_deg[:count]
    if count == 0:
        raise AnalysisError("虚拟单位负反馈无法取得频响数据")
    # 电路未断环时，直接测量得到的响应就是真实闭环 T(jω)；
    # 开环 L(s) 必须来自实体断环，绝不在此反推、冒充开环。
    closed = 10.0 ** (magnitude_db / 20.0) * np.exp(1j * np.radians(phase_deg))
    source_payload = {
        "domain": "circuit",
        "mode": "circuit",
        "model": "descriptor_linearized",
        "path": "descriptor_linearized",
        "kind": "loop",
        "loop_origin": "virtual_unit_feedback",
        "break_element": "__virtual__",
        "break_kind": "virtual",
        "input_source": input_source,
        "output": output,
        "feedback_sign": 1.0,
        "operating_point_supplied": bool(operating_point),
    }
    warning_items = [
        warning(
            "no_physical_loop",
            "电路未选择实体断环元件，当前仅显示直接求得的闭环 T(s)；未断环，无法给出开环 L(s)，也不会把闭环误标为开环。",
            severity="warning",
        )
    ]
    metrics = {
        "phase_margin_deg": None,
        "gain_margin_db": None,
        "stable_from_margins": None,
        "gain_crossings": [],
        "phase_crossings": [],
        "loop_gain_available": False,
    }
    fingerprint_value = scene_fingerprint(
        sim.scene,
        {"kind": "virtual_loop", "input_source": input_source, "output": output,
         "f_start": float(f_start), "f_stop": float(f_stop), "points": int(points),
         "op_present": bool(operating_point)},
    )
    # 直接闭环 T(s) 来自 tf_analysis 的解析式；开环不可得，标记为 unsupported。
    closed_loop_transfer = tf.get("transfer_function")
    open_loop_transfer = {
        "supported": False,
        "reason": "电路未选择实体断环元件，无法给出开环 L(s)；当前仅显示闭环 T(s)。",
    }
    if display == "step":
        step_payload = dict((tf.get("envelopes") or {}).get("time") or {})
        if not step_payload:
            raise AnalysisError("虚拟单位负反馈缺少阶跃结果")
        step_payload["source"] = {**source_payload, "kind": "loop_step"}
        step_payload["warnings"] = [*(step_payload.get("warnings") or []), *warning_items]
        step_payload["metrics"] = {**metrics, "approximate_closed_loop": True}
        return {
            "ok": True,
            "kind": "loop_step",
            "display": "step",
            "element": "__virtual__",
            "break_kind": "virtual",
            "input_source": input_source,
            "output": output,
            "feedback_sign": 1.0,
            "loop_origin": "virtual_unit_feedback",
            "parity_max_rel": None,
            "poles": tf.get("poles"),
            "metrics": metrics,
            "warnings": warning_items,
            "fingerprint": fingerprint_value,
            "envelopes": {"time": step_payload},
            "source": source_payload,
            "transfer_function": closed_loop_transfer,
            "open_loop_transfer_function": open_loop_transfer,
            "closed_loop_transfer_function": closed_loop_transfer,
            "transfer_role": "closed_loop",
        }
    if display == "closed_loop":
        closed_mag = 20.0 * np.log10(np.maximum(np.abs(closed), 1e-300))
        closed_phase = np.degrees(np.unwrap(np.angle(closed)))
        bode_payload = bode_envelope(
            frequencies=frequencies,
            magnitude_db=closed_mag,
            phase_deg=closed_phase,
            source={**source_payload, "kind": "loop_closed"},
            output=f"T({output}) 虚拟单位负反馈",
            poles=(tf.get("poles") or {}).get("finite", []),
            metrics=dict(metrics),
            warnings=warning_items,
            fingerprint_value=fingerprint_value,
        )
        bode_payload["curves"][0]["label"] = "闭环 T(s) 幅值"
        bode_payload["curves"][1]["label"] = "闭环 T(s) 相位"
    else:
        bode_payload = dict((tf.get("envelopes") or {}).get("bode") or {})
        if not bode_payload:
            raise AnalysisError("虚拟单位负反馈缺少 Bode 结果")
        bode_payload["source"] = source_payload
        bode_payload["warnings"] = [*(bode_payload.get("warnings") or []), *warning_items]
        bode_payload["metrics"] = {**metrics, "approximate_closed_loop": False}
    return {
        "ok": True,
        "kind": "loop",
        "display": display,
        "element": "__virtual__",
        "break_kind": "virtual",
        "input_source": input_source,
        "output": output,
        "feedback_sign": 1.0,
        "loop_origin": "virtual_unit_feedback",
        "frequencies_hz": [float(value) for value in frequencies],
        "loop_gain": [],
        "forward_gain": [],
        "closed_loop": _complex_list(closed),
        "loop_gain_available": False,
        "direct_response": None,
        "parity_max_rel": None,
        "poles": tf.get("poles"),
        "metrics": metrics,
        "warnings": warning_items,
        "fingerprint": fingerprint_value,
        "envelopes": {"bode": bode_payload},
        "source": source_payload,
        "transfer_function": closed_loop_transfer,
        "open_loop_transfer_function": open_loop_transfer,
        "closed_loop_transfer_function": closed_loop_transfer,
        "transfer_role": "closed_loop",
    }


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
        closed_synth = extraction.closed_loop
        with np.errstate(divide="ignore", invalid="ignore"):
            candidate_synth = loop_response / (
                1.0 + float(feedback_sign) * loop_response
            )
        if np.all(np.isfinite(candidate_synth.real)) and np.all(
            np.isfinite(candidate_synth.imag)
        ):
            closed_synth = candidate_synth
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


def run_with_timeout(
    function: Callable[[], Any], seconds: float = ANALYSIS_TIMEOUT, label: str = "分析"
) -> Any:
    """线程级超时保护（R13）：超时返回可定位错误；无法强杀线程，只保证请求不再阻塞。"""
    box: dict[str, Any] = {}
    started = time.perf_counter()

    def target() -> None:
        try:
            box["value"] = function()
        except BaseException as exc:  # noqa: BLE001 - 原样抛回
            box["error"] = exc

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    thread.join(seconds)
    if thread.is_alive():
        raise AnalysisError(
            f"{label}超时（>{seconds:g}s）；缩小时间窗/抽稀或改用频域分析"
        )
    if "error" in box:
        raise box["error"]
    result = box.get("value")
    if isinstance(result, dict):
        result["elapsed_ms"] = round((time.perf_counter() - started) * 1000.0, 3)
    return result


__all__ = [
    "AnalysisError",
    "analyze_metrics",
    "spectrum",
    "recommend_period",
    "math_forms",
    "transfer_function",
    "tf_analysis",
    "frequency_response",
    "phase_metrics",
    "export_csv",
    "run_with_timeout",
]
