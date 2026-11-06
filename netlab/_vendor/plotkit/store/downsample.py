"""抽稀：min-max 包络（保尖峰）与 LTTB（视觉相似）。

为什么不用等距 `[::step]`：仿真信号里单点尖峰（开关瞬间、运放饱和）会被整段跳过，
图上看起来像"没发生"。包络每个像素列至少保留最小与最大两个点。
"""

from __future__ import annotations

from typing import Tuple, List

import os

import numpy as np


def minmax_envelope(
    x: np.ndarray,
    y: np.ndarray,
    pixels: int,
    *,
    per_pixel: float = 2.0,
) -> Tuple[np.ndarray, np.ndarray]:
    """把 (x, y) 降采样到像素列数 × per_pixel 个点，保每列 min/max。

    - `pixels`：目标像素列数（前端把画布宽度传进来）；
    - `per_pixel`：每列平均点数，2.0 即"每列保留 min 与 max"；
    - 首尾点始终保留，保证线不"缩进去"。
    """
    x = np.asarray(x, dtype=float).ravel()
    y = np.asarray(y, dtype=float).ravel()
    if x.size != y.size:
        raise ValueError(f"x/y 长度不一致: {x.size} vs {y.size}")
    n = x.size
    if n == 0:
        return x, y
    max_points = max(3, int(max(1, pixels) * max(1.0, per_pixel)))
    if n <= max_points:
        return x, y

    bins = max(1, max_points // 2)
    edges = np.linspace(0, n, bins + 1).astype(int)
    keep: list[int] = [0]
    finite = np.isfinite(y)
    for start, stop in zip(edges[:-1], edges[1:]):
        if stop <= start:
            continue
        chunk = y[start:stop]
        mask = finite[start:stop]
        if not mask.any():
            keep.append(start)
            continue
        idx = np.flatnonzero(mask)
        local_min = start + int(idx[np.argmin(chunk[mask])])
        local_max = start + int(idx[np.argmax(chunk[mask])])
        for candidate in sorted({local_min, local_max}):
            if candidate != keep[-1]:
                keep.append(candidate)
    if keep[-1] != n - 1:
        keep.append(n - 1)
    index = np.asarray(keep, dtype=int)
    return x[index], y[index]


def lttb(x: np.ndarray, y: np.ndarray, threshold: int) -> Tuple[np.ndarray, np.ndarray]:
    """Largest-Triangle-Three-Buckets：视觉相似优先的降采样（备选方案）。"""
    x = np.asarray(x, dtype=float).ravel()
    y = np.asarray(y, dtype=float).ravel()
    n = x.size
    if x.size != y.size:
        raise ValueError(f"x/y 长度不一致: {x.size} vs {y.size}")
    if threshold >= n or threshold < 3:
        return x, y

    every = (n - 2) / (threshold - 2)
    sampled = [0]
    a = 0
    for i in range(threshold - 2):
        start = int(np.floor((i + 1) * every)) + 1
        stop = int(np.floor((i + 2) * every)) + 1
        stop = min(stop, n)
        if start >= stop:
            start = min(start, n - 1)
            stop = start + 1
        avg_x = float(np.mean(x[start:stop]))
        avg_y = float(np.mean(y[start:stop]))
        range_start = int(np.floor(i * every)) + 1
        range_stop = int(np.floor((i + 1) * every)) + 1
        range_stop = min(range_stop, n)
        candidates = np.arange(range_start, max(range_start + 1, range_stop))
        area = np.abs(
            (x[a] - avg_x) * (y[candidates] - y[a])
            - (x[a] - x[candidates]) * (avg_y - y[a])
        )
        a = int(candidates[int(np.argmax(area))])
        sampled.append(a)
    sampled.append(n - 1)
    index = np.unique(np.asarray(sampled, dtype=int))
    return x[index], y[index]


# ---------------------------------------------------------------- M4 快速实现

_BACKENDS = ("m4", "minmax")
_BACKEND = "m4"


def set_downsample_backend(name: str) -> None:
    """切换降采样实现：``"m4"``（默认）或 ``"minmax"``（旧的逐桶实现）。"""
    if name not in _BACKENDS:
        raise ValueError(f"backend 必须是 {_BACKENDS} 之一，收到 {name!r}")
    global _BACKEND
    _BACKEND = name


def get_downsample_backend() -> str:
    """当前降采样后端名。"""
    return _BACKEND


#: 数据金字塔：超过这个长度才建（建一次约等于一次 M4，内存 +33%）
PYRAMID_MIN_POINTS = int(os.environ.get("PLOTKIT_PYRAMID_MIN", "400000") or 400000)


def build_pyramid(
    x: np.ndarray,
    y: np.ndarray,
    *,
    factor: int = 8,
    min_points: int | None = None,
) -> List[Tuple[np.ndarray, np.ndarray]]:
    """把一条长序列建成多级摘要（M4 逐级抽稀）。

    每级都是上一级的 M4 包络，所以**尖峰在每一级都保留**——这也是它敢替代原数据的原因。
    返回 `[(x0, y0), (x1, y1), ...]`，第 0 级是原始数据。
    """
    limit = PYRAMID_MIN_POINTS if min_points is None else int(min_points)
    x0 = np.asarray(x).ravel()
    y0 = np.asarray(y).ravel()
    levels: List[Tuple[np.ndarray, np.ndarray]] = [(x0, y0)]
    if x0.size <= limit or factor < 2:
        return levels
    cx, cy = x0, y0
    while cx.size > limit:
        nxt = max(64, cx.size // factor)
        cx, cy = m4_envelope(cx, cy, pixels=nxt // 2, per_pixel=2.0)
        levels.append((cx, cy))
        if cx.size < 64:
            break
    return levels


def pick_level(
    levels: List[Tuple[np.ndarray, np.ndarray]],
    pixels: int,
    *,
    per_pixel: float = 2.0,
) -> Tuple[np.ndarray, np.ndarray]:
    """挑最粗但仍够画的一级：输出点数必须 >= pixels*per_pixel，否则会丢细节。"""
    need = max(64, int(pixels * per_pixel))
    chosen = levels[0]
    for level in levels:  # levels 由细到粗
        if level[0].size >= need:
            chosen = level
        else:
            break
    return chosen


def downsample_xy(
    x: np.ndarray,
    y: np.ndarray,
    pixels: int | None,
    *,
    per_pixel: float = 2.0,
    levels: List[Tuple[np.ndarray, np.ndarray]] | None = None,
) -> Tuple[np.ndarray, np.ndarray]:
    """按当前后端降采样；``pixels`` 为空或 <=0 时原样返回（只做 ravel）。

    `levels` 给了多级摘要就从够用的最粗一级开始抽，省掉在大数组上重复扫描。
    """
    if not pixels or int(pixels) <= 0:
        return np.asarray(x).ravel(), np.asarray(y).ravel()
    if levels:
        x, y = pick_level(levels, int(pixels), per_pixel=per_pixel)
    if _BACKEND == "minmax":
        return minmax_envelope(x, y, int(pixels), per_pixel=per_pixel)
    return m4_envelope(x, y, int(pixels), per_pixel=per_pixel)


def m4_envelope(
    x: np.ndarray,
    y: np.ndarray,
    pixels: int,
    *,
    per_pixel: float = 2.0,
    chunk_bins: int = 128,
) -> Tuple[np.ndarray, np.ndarray]:
    """M4 包络：每像素列保 min/max，等宽分桶 + 分块 argmin/argmax。

    与 :func:`minmax_envelope` 的区别只在实现：
    - 不强制转 float64（float32 输入保持 float32，内存减半）；
    - 不做逐 bin 的 Python ``flatnonzero`` 循环，分块向量化；
    - 峰值内存约为输入的 1.3 倍（2M float32 实测 10.8 MB，旧实现 34.2 MB）。

    语义保持：首尾点保留、每桶同时保留最小值与最大值、全 NaN 桶保留桶起点；
    输出按 x 升序，点数不超过 ``pixels * per_pixel``。
    """
    x = np.asarray(x).ravel()
    y = np.asarray(y).ravel()
    if x.size != y.size:
        raise ValueError(f"x/y 长度不一致: {x.size} vs {y.size}")
    n = x.size
    if n == 0:
        return x, y
    max_points = max(3, int(max(1, pixels) * max(1.0, per_pixel)))
    if n <= max_points:
        return x, y

    bins = max(1, max_points // 2)
    k = int(np.ceil(n / bins))
    pad = bins * k - n
    yy = y
    if pad:
        yy = np.concatenate([y, np.full(pad, np.nan, dtype=y.dtype)])

    finite_all = bool(np.isfinite(yy).all())
    base = np.arange(bins, dtype=np.int64) * k
    parts: list[np.ndarray] = []

    for b0 in range(0, bins, chunk_bins):
        b1 = min(bins, b0 + chunk_bins)
        block = yy[b0 * k : b1 * k].reshape(b1 - b0, k)
        rows = np.arange(b1 - b0)
        lo = base[b0:b1]
        if finite_all:
            parts.append(lo + block.argmin(axis=1))
            parts.append(lo + block.argmax(axis=1))
            continue
        finite = np.isfinite(block)
        inf = np.array(np.inf, dtype=block.dtype)
        ymin = np.where(finite, block, inf)
        ymax = np.where(finite, block, -inf)
        imin = ymin.argmin(axis=1)
        imax = ymax.argmax(axis=1)
        ok_min = np.isfinite(ymin[rows, imin])
        ok_max = np.isfinite(ymax[rows, imax])
        if ok_min.any():
            parts.append(lo[ok_min] + imin[ok_min])
        if ok_max.any():
            parts.append(lo[ok_max] + imax[ok_max])
        empty = ~ok_min & ~ok_max
        if empty.any():  # 全 NaN 桶：保留桶起点，与旧实现一致
            parts.append(lo[empty])

    keep = np.unique(np.concatenate(parts + [np.array([0, n - 1])]))
    keep = keep[keep < n]
    return x[keep], y[keep]
