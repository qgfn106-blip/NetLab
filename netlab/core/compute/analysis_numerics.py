"""analysis 的纯数值/数学辅助函数。

P2-03 结构拆分第二步：从 analysis.py 迁出只依赖 numpy/math 的纯计算辅助
（重采样、过零、周期评分、复数编码、频率轴等）。这些函数不含编排状态、不读
仿真对象；analysis.py facade 重新导入，签名与行为完全不变。
"""

from __future__ import annotations

import math

import numpy as np

from .analysis_errors import AnalysisError


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


def _number(value: Any) -> str:
    number = float(value)
    return str(int(number)) if number.is_integer() else repr(number)


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
