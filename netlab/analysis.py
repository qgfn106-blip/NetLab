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

from .limits import ValidationError

ANALYSIS_TIMEOUT = 5.0
MAX_EXPORT_ROWS = 200_000


class AnalysisError(Exception):
    """分析失败/超时；服务层转 422。"""


def _frames(sim: Any, t0: float | None = None, t1: float | None = None) -> list[dict[str, Any]]:
    with sim.lock:
        frames = list(sim.recorder.frames)
    if t0 is not None or t1 is not None:
        low = -math.inf if t0 is None else float(t0)
        high = math.inf if t1 is None else float(t1)
        frames = [frame for frame in frames if low <= frame["t"] <= high]
    return frames


def _series(sim: Any, key: str, t0: float | None = None, t1: float | None = None) -> tuple[np.ndarray, np.ndarray]:
    frames = _frames(sim, t0, t1)
    times = np.array([frame["t"] for frame in frames], dtype=float)
    values = np.array([frame["v"].get(key, float("nan")) for frame in frames], dtype=float)
    mask = np.isfinite(values)
    return times[mask], values[mask]


def _keys(sim: Any, keys: list[str] | None) -> list[str]:
    if keys:
        return list(keys)
    with sim.lock:
        return list(sim.recorder.keys())


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
        final = float(np.mean(values[-max(3, len(values) // 10):]))
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
            "peak_time": float(times[int(np.argmax(values) if amplitude >= 0 else np.argmin(values))]),
            "overshoot_pct": float(overshoot),
            "rise_time": rise,
            "settling_time": settle,
            "settle_band_pct": settle_band * 100.0,
            "source": "录制数据；10/90% 线性插值上升时间、±2% 稳态带、峰值相对终值超调",
        }
    return {"ok": True, "items": items, "source": "recorder"}


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
    """周期推荐：FFT 候选频率 → 候选周期 → 多周期一致性校验 → 排序/诊断。"""
    result = spectrum(sim, key, t0, t1)
    times, values = _series(sim, key, t0, t1)
    grid, uniform = _uniform(times, values)
    span = float(grid[-1] - grid[0])
    std = float(np.std(uniform)) or 1.0
    candidates: list[dict[str, Any]] = []
    for peak in result["peaks"]:
        freq = peak["freq"]
        if freq <= 0:
            continue
        period = 1.0 / freq
        cycles = span / period
        if cycles < 2:
            continue
        shifted = np.interp(grid + period, grid, uniform, left=np.nan, right=np.nan)
        mask = np.isfinite(shifted)
        if mask.sum() < max(8, len(grid) // 3):
            continue
        mae = float(np.mean(np.abs(uniform[mask] - shifted[mask]))) / std
        score = max(0.0, 1.0 - mae)
        if score < 0.75:
            continue
        candidates.append(
            {"period": period, "score": score, "cycles": cycles, "mae": mae}
        )
    candidates.sort(key=lambda item: (-item["score"], item["cycles"]))
    if not candidates:
        return {
            "ok": False,
            "key": key,
            "reason": "未找到可在 ≥2 个周期内重复的候选周期",
            "diagnosis": "录制太短、信号非周期或周期大于窗口；先多录制几个周期再试",
            "source": "录制数据 FFT + 周期一致性（MAE）校验",
        }
    best = candidates[0]
    return {
        "ok": True,
        "key": key,
        "period": best["period"],
        "score": best["score"],
        "cycles": best["cycles"],
        "candidates": candidates[:3],
        "diagnosis": "按 FFT 峰值 + 平移一致性排序；score=1-mae/σ，越接近 1 越可信",
        "source": "录制数据 FFT + 周期一致性（MAE）校验",
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
    return ""


def transfer_function(
    sim: Any,
    input_node: str,
    output_node: str,
    *,
    input_field: str = "voltage",
    output_field: str = "voltage",
) -> dict[str, Any]:
    """线性网络符号传递函数（sympy 可选）；不支持则返回原因。"""
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
        return {"ok": False, "reason": "目前只支持 signal 模式的线性传递函数", "source": "symbolic"}
    nodes = {node.name: node for node in scene.nodes.values()}
    nodes_by_id = {node.id: node for node in scene.nodes.values()}
    if input_node not in nodes or output_node not in nodes:
        return {"ok": False, "reason": "输入/输出节点名不存在", "source": "symbolic"}
    edges_by_target: dict[str, list[Any]] = {}
    for edge in scene.edges.values():
        if not edge.enabled:
            continue
        target = nodes_by_id.get(edge.target)
        if target is None:
            continue
        edges_by_target.setdefault(target.name, []).append(edge)
    s = sp.Symbol("s")

    def edge_weight(edge: Any, source_node: Any) -> Any:
        if edge.delay:
            raise AnalysisError(f"连接 {edge.name!r} 带单步延迟，符号传递函数未支持（需 z 变换）")
        if source_node.kind == "sum":
            weights = (source_node.params.get("weights") or {})
            try:
                return sp.Integer(int(weights.get(edge.name, 1)))
            except (TypeError, ValueError):
                return sp.Integer(1)
        return sp.Integer(1)

    cache: dict[str, Any] = {}
    visiting: set[str] = set()

    def tf(name: str) -> Any:
        if name in cache:
            return cache[name]
        if name in visiting:
            raise AnalysisError(f"检测到代数环：{name!r}（符号推导只支持有向无环）")
        node = nodes[name]
        if name == input_node:
            cache[name] = sp.Integer(1)
            return cache[name]
        visiting.add(name)
        kind = node.kind
        local = _node_tf(kind, node.params)
        if local == "":
            # 独立源/非线性节点（不是所选输入）按外部输入 0 处理，只保留线性通路。
            visiting.discard(name)
            cache[name] = sp.Integer(0)
            return cache[name]
        if local is None:
            local_expr = sp.Integer(1)
        else:
            local_expr = sp.sympify(local.replace("s", "s"))
        total = sp.Integer(0)
        for edge in edges_by_target.get(name, []):
            source = nodes_by_id.get(edge.source)
            if source is None:
                continue
            weight = edge_weight(edge, source)
            total += sp.sympify(tf(source.name)) * weight * local_expr
        visiting.discard(name)
        cache[name] = sp.simplify(total)
        return cache[name]

    try:
        expr = sp.simplify(tf(output_node))
    except AnalysisError as exc:
        return {"ok": False, "reason": str(exc), "source": "symbolic（sympy）"}
    except Exception as exc:
        return {"ok": False, "reason": f"符号推导失败：{exc}", "source": "symbolic（sympy）"}
    if expr == 0:
        return {
            "ok": False,
            "reason": "从输入到输出没有线性通路（或增益为 0）",
            "source": "symbolic（sympy）",
        }
    num, den = sp.fraction(sp.together(expr))
    try:
        num_poly = sp.Poly(sp.expand(num), s)
        den_poly = sp.Poly(sp.expand(den), s)
        num_coeffs = [float(item) for item in num_poly.all_coeffs()][::-1]
        den_coeffs = [float(item) for item in den_poly.all_coeffs()][::-1]
    except Exception:
        num_coeffs, den_coeffs = [], []
    return {
        "ok": True,
        "input": {"node": input_node, "field": input_field},
        "output": {"node": output_node, "field": output_field},
        "expression": str(expr),
        "numerator": str(num),
        "denominator": str(den),
        "numerator_coeffs": num_coeffs,
        "denominator_coeffs": den_coeffs,
        "order": max(0, len(den_coeffs) - 1),
        "assumptions": [
            "线性节点：gain/sum/lag/integrate，pass 连接；忽略偏置、限幅、初值",
            "输入输出字段按 voltage 处理；delay 连接（z⁻¹）未支持",
            "输入节点以外的独立源/非线性节点按 0 处理（只保留所选输入到输出的线性通路）",
            "结果只作数学形式呈现，不参与求解",
        ],
        "source": "symbolic（sympy）；线性节点逐级拼接",
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
        raise AnalysisError(f"导出行数 {len(rows)} 超过上限 {MAX_EXPORT_ROWS}，请提高抽稀倍数")
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
    base = "".join(char for char in (name or "analysis") if char.isalnum() or char in "-_") or "analysis"
    path = target_dir / f"{base}.csv"
    index = 2
    while path.exists():
        path = target_dir / f"{base}-{index}.csv"
        index += 1
    from .project import atomic_write

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
    "export_csv",
    "run_with_timeout",
]
