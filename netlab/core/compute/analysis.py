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

from . import complex_support as complex_layer
from . import transfer as transfer_math
from .circuit.descriptor import DescriptorModel
from .circuit.descriptor_analysis import (
    UnsupportedAnalysisError,
    analyze_poles,
    analyze_zeros,
    build_output_matrices,
    descriptor_step_response,
)
from ..common.limits import MAX_NODES, ComputeError
from .statespace import StateSpaceModel


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
        if isinstance(value, bool):
            return sp.Integer(int(value))
        if isinstance(value, (int, float)) and float(value).is_integer():
            return sp.Integer(int(value))
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
            a = sp.Matrix(params.get("A") or [])
            b = sp.Matrix(params.get("B") or [])
            c = sp.Matrix(params.get("C") or [])
            d = sp.Matrix(params.get("D") or [[0.0]])
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
) -> dict[str, Any]:
    """电路小信号旁路分析：Descriptor 状态空间 + 零极点 + 阶跃 + Bode。"""
    if sim is None:
        raise AnalysisError("mode=circuit 时必须提供电路仿真")
    scene = getattr(sim, "scene", None)
    if scene is None or getattr(scene, "mode", None) != "circuit":
        raise AnalysisError("mode=circuit 需要 circuit 模式场景")
    if not input_source:
        raise AnalysisError("mode=circuit 必须提供 input_source")
    if not output:
        raise AnalysisError("mode=circuit 必须提供 output")

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

    system = _guard("状态空间构建", lambda: model.build(input_source))
    pole_result = _guard("极点分析", lambda: analyze_poles(system))
    c_matrix, d_matrix = _guard(
        "输出矩阵构建", lambda: build_output_matrices(model, output, input_source)
    )
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

    step = _guard("阶跃分析", _step)

    frequencies = _frequency_axis(
        f_start=float(f_start),
        f_stop=float(f_stop),
        points=int(points),
        scale=str(scale),
    )
    bode = _guard(
        "Bode 分析",
        lambda: model.frequency_response(
            [float(value) for value in frequencies],
            input_source=input_source,
            probes=[output],
        ),
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
        "poles": {
            "finite": _complex_list(pole_result.finite_poles),
            "infinite_count": int(pole_result.infinite_count),
            "max_residual": float(pole_result.max_residual),
            "size": int(pole_result.size),
            "regular": bool(pole_result.regular),
        },
        "zeros": {
            "finite": _complex_list(zero_result.finite_zeros),
            "infinite_count": int(zero_result.infinite_count),
            "max_residual": float(zero_result.max_residual),
            "size": int(zero_result.size),
            "regular": bool(zero_result.regular),
            "siso": bool(zero_result.siso),
        },
        "step": step,
        "bode": bode,
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
    if mode == "signal":
        try:
            values = _signal_frequency_response(sim, input, output, frequencies)
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
        "source": "complex analysis layer（R39）",
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
