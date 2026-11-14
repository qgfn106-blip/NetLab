"""预计算结果的后处理插值工具（需求④）：两种可选方法。

- ``method="average"``：**直接平均中点法**——相邻两点取算术平均作为中点（朴素线性中点）。
- ``method="gaussian"``：**高斯核加权中点法**——时间窗口 ``|t - t_mid| <= window`` 内，
  按时间欧氏距离的指数倒数 ``w = exp(-|t - t_mid|)`` 归一化后的加权平均
  ``v_mid = Σ w_k v_k / Σ w_k``。

两者都支持 ``rounds`` 轮细分（每轮点数约翻倍，N 轮后约 2**N 倍），并对多通道序列批量处理。
本模块是纯函数后处理，不触碰求解器，预计算/绘图/导出可共用。

复杂度说明（P1）：``gaussian`` 的实现基于时间轴有序，用二分定位窗口内的点，
每个中点只遍历其窗口邻域（典型 O(window) 个点），整体 O(n·w) 而非朴素 O(n²)；
窗口外的点权重本应为 0，因而结果与朴素实现逐位一致。
"""

from __future__ import annotations

import bisect
import math
from collections.abc import Mapping, Sequence

__all__ = ["METHODS", "midpoint_resample", "resample_multi", "estimate_frames"]

METHODS = ("average", "gaussian")

def estimate_frames(n: int, rounds: int) -> int:
    """估算 ``rounds`` 轮中点细分后的帧数：每轮长度 n -> 2n-1。"""
    if n <= 1:
        return max(0, n)
    r = max(0, int(rounds))
    return (n - 1) * (2 ** r) + 1

def _median_gap(times: Sequence[float]) -> float:
    gaps = sorted(
        times[i + 1] - times[i]
        for i in range(len(times) - 1)
        if times[i + 1] > times[i]
    )
    if not gaps:
        return 0.0
    return gaps[len(gaps) // 2]

def _gauss_midpoint(
    t_mid: float, times: Sequence[float], values: Sequence[float], window: float
) -> float | None:
    n = len(times)
    if window > 0.0:
        lo = bisect.bisect_left(times, t_mid - window)
        hi = bisect.bisect_right(times, t_mid + window)
    else:
        lo, hi = 0, n
    num = 0.0
    den = 0.0
    for k in range(lo, hi):
        d = abs(times[k] - t_mid)
        if window > 0.0 and d > window:
            continue
        w = math.exp(-d)
        num += w * values[k]
        den += w
    return None if den <= 0.0 else num / den

def _resample_one(
    times: Sequence[float],
    values: Sequence[float],
    method: str,
    rounds: int,
    window: float | None,
) -> tuple[list[float], list[float]]:
    if method not in METHODS:
        raise ValueError(f"未知插值方法 {method!r}；可选 {METHODS}")
    if rounds < 0:
        raise ValueError("rounds 必须 >= 0")
    if window is not None:
        window = float(window)
        if not math.isfinite(window) or window <= 0.0:
            raise ValueError("window 必须是有限正数（None 表示自动）")
    t = [float(x) for x in times]
    v = [float(x) for x in values]
    if len(t) != len(v):
        raise ValueError("times 与 values 长度必须一致")
    if len(t) < 2 or rounds == 0:
        return t, v
    if any(t[i + 1] < t[i] for i in range(len(t) - 1)):
        raise ValueError("times 必须单调非降")
    win = _median_gap(t) if window is None else float(window)
    for _ in range(rounds):
        new_t = [t[0]]
        new_v = [v[0]]
        for i in range(len(t) - 1):
            t_mid = (t[i] + t[i + 1]) / 2.0
            if method == "average":
                v_mid = (v[i] + v[i + 1]) / 2.0
            else:
                got = _gauss_midpoint(t_mid, t, v, win)
                v_mid = (v[i] + v[i + 1]) / 2.0 if got is None else got
            new_t.extend((t_mid, t[i + 1]))
            new_v.extend((v_mid, v[i + 1]))
        t, v = new_t, new_v
    return t, v

def midpoint_resample(
    times: Sequence[float],
    values: Sequence[float],
    *,
    method: str = "average",
    rounds: int = 1,
    window: float | None = None,
) -> tuple[list[float], list[float]]:
    """对单通道做中点细分插值。返回 (times, values)。"""
    return _resample_one(times, values, method, rounds, window)

def resample_multi(
    times: Sequence[float],
    series: Mapping[str, Sequence[float]] | Sequence[Sequence[float]],
    *,
    method: str = "average",
    rounds: int = 1,
    window: float | None = None,
):
    """对多通道批量插值。``series`` 为 dict[name, 序列] 时返回 (times, dict)；为 list 时返回 (times, list)。"""
    if isinstance(series, Mapping):
        if len(series) == 0:
            return [float(x) for x in times], {}
        out: dict[str, list[float]] = {}
        new_t: list[float] | None = None
        for name, vals in series.items():
            new_t, out[name] = _resample_one(times, vals, method, rounds, window)
        assert new_t is not None
        return new_t, out
    if len(series) == 0:
        return [float(x) for x in times], []
    out_list: list[list[float]] = []
    new_t = None
    for vals in series:
        new_t, vv = _resample_one(times, vals, method, rounds, window)
        out_list.append(vv)
    assert new_t is not None
    return new_t, out_list
