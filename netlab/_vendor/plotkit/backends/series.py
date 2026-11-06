"""时序数据的公共处理：颜色、时间窗切片、按像素抽稀、坐标变换。

原来这些和 plotly 后端挤在同一个模块里；plotly 退役后（D33）它们只剩
"把 spec + store 变成 numpy 数组"这一件事，matplotlib 后端和热重绘缓存都用它。
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any, Mapping

import numpy as np

from ..spec.model import layers as spec_layers
from ..store.downsample import downsample_xy
from ..store.registry import DataStore

PALETTE = (
    "#4fc3f7",
    "#ff8a65",
    "#aed581",
    "#ba68c8",
    "#ffd54f",
    "#4db6ac",
    "#f06292",
    "#7986cb",
    "#a1887f",
    "#90a4ae",
)


THEMES: dict[str, dict[str, str]] = {
    "default": {
        "paper": "#ffffff",
        "plot": "#ffffff",
        "text": "#1f2937",
        "grid": "#e5e7eb",
    },
    "netlab-dark": {
        "paper": "#0f172a",
        "plot": "#111827",
        "text": "#e2e8f0",
        "grid": "#1f2937",
    },
}


def color_for(index: int) -> str:
    return PALETTE[index % len(PALETTE)]


_TRANGE: ContextVar = ContextVar("plotkit_trange", default=None)


def push_trange(trange):
    """设置当前视窗，返回 token 供 pop_trange 还原。"""
    return _TRANGE.set(tuple(trange) if trange is not None else None)


def pop_trange(token) -> None:
    _TRANGE.reset(token)


def current_trange():
    return _TRANGE.get()


def _is_monotonic(x: np.ndarray) -> bool:
    """升序判断：用相邻比较（bool 数组）而不是 np.diff（会分配 n*itemsize 的副本）。"""
    if x.size < 2:
        return True
    return bool(np.all(x[1:] >= x[:-1]))


def _window_slice(x: np.ndarray, trange) -> tuple[int, int]:
    """按 [t0, t1] 截取下标区间；数据是单调追加的，优先用 searchsorted。"""
    if trange is None or x.size == 0:
        return 0, x.size
    t0, t1 = float(trange[0]), float(trange[1])
    if _is_monotonic(x):
        i0 = int(np.searchsorted(x, t0, side="left"))
        i1 = int(np.searchsorted(x, t1, side="right"))
        return i0, max(i1, i0)
    mask = (x >= t0) & (x <= t1)
    idx = np.flatnonzero(mask)
    if idx.size == 0:
        return 0, 0
    return int(idx[0]), int(idx[-1]) + 1


def _xy(
    layer: Mapping[str, Any],
    store: DataStore,
    *,
    pixels: int | None,
    per_pixel: float,
    trange=None,
):
    data = layer.get("data", {})
    if trange is None:
        trange = _TRANGE.get()
    # 先按视窗取下标（零拷贝 slice），再只对窗口内数据做类型转换：
    # 旧实现在窗口之前就 astype(float) 全量复制，视窗对内存/耗时形同虚设。
    x_full = np.asarray(store.values(data["x"])).ravel()
    y_full = np.asarray(store.values(data["y"])).ravel()
    if x_full.size != y_full.size:
        raise ValueError(
            f"图层 {layer.get('id')} 的 x/y 长度不一致: {x_full.size} vs {y_full.size}"
            f"（x={data['x']!r}, y={data['y']!r}）"
        )
    i0, i1 = _window_slice(x_full, trange)
    x, y = x_full[i0:i1], y_full[i0:i1]
    has_error = any(k.startswith("error_") for k in data)
    if pixels and not has_error:
        # 超长序列走多级摘要：从够用的最粗一级开始抽，避免每次都在全量上扫一遍
        levels = None
        if i0 == 0 and i1 >= x_full.size:
            try:
                levels = store.pyramid(data["x"], data["y"])
            except Exception:
                levels = None
        x, y = downsample_xy(x, y, pixels, per_pixel=per_pixel, levels=levels)
    elif x.dtype != np.float64:
        x = x.astype(np.float64, copy=False)
        y = y.astype(np.float64, copy=False)
    return x, y


def _step(value: float, scale: str, decades: float) -> float:
    """沿某个轴的"数量级台阶"走一步：log 轴乘 10^n，线性轴加 n。"""
    return float(value) * (10.0**decades) if scale == "log" else float(value) + decades


def _numeric_bounds(values: Any) -> tuple[float | None, float | None]:
    """把一组数据压成 (最小, 最大)；非数值 / 全 NaN 时返回 (None, None)。"""
    array = np.asarray(values).ravel()
    if array.size == 0:
        return None, None
    try:
        numeric = array.astype(float)
    except (TypeError, ValueError):
        return None, None
    numeric = numeric[np.isfinite(numeric)]
    if numeric.size == 0:
        return None, None
    return float(numeric.min()), float(numeric.max())


def _layer_time_bounds(
    spec: Mapping[str, Any], store: DataStore
) -> tuple[float | None, float | None]:
    lo: float | None = None
    hi: float | None = None
    for layer in spec_layers(spec):
        data = layer.get("data", {})
        name = data.get("x")
        if not name or name not in store:
            continue
        low, high = _numeric_bounds(store.values(name))
        if low is None or high is None:
            continue
        lo = low if lo is None else min(lo, low)
        hi = high if hi is None else max(hi, high)
    return lo, hi


def _coord_time_bounds(store: DataStore) -> tuple[float | None, float | None]:
    """坐标数据集（role="coord"）的取值范围，作为没有图层时的回退。"""
    lo: float | None = None
    hi: float | None = None
    for name in store.names():
        if store.meta(name).get("role") != "coord":
            continue
        low, high = _numeric_bounds(store.values(name))
        if low is None or high is None:
            continue
        lo = low if lo is None else min(lo, low)
        hi = high if hi is None else max(hi, high)
    return lo, hi


def time_bounds(
    spec: Mapping[str, Any], store: DataStore
) -> tuple[float | None, float | None]:
    """回放要用的时间范围 (最小, 最大)。

    优先用图层 x 数据的范围；没有图层时回退到 ``role="coord"`` 的数据集：
    宿主可能只登记数据、图层由用户自己加（netlab D-PlotView），此时回放滑杆
    与"最近 N 秒"窗口仍然要有范围，否则有数据也点不动播放。
    """
    lo, hi = _layer_time_bounds(spec, store)
    if lo is not None and hi is not None:
        return lo, hi
    return _coord_time_bounds(store)
