"""图层预设（对应 MultiPlotter 的 KIND_DEFAULTS，D27）。

- 每个 kind 一份默认样式；注册新 kind 时顺带登记预设，避免样式散落在各后端。
- 合并优先级（低 → 高）：`KIND_PRESETS` < `pk.init()` 全局默认 < `add_plot()` 显式参数 < `**kwargs`。
"""

from __future__ import annotations

import copy
from typing import Any, Mapping

#: kind -> {"style": {...}, "view": {...}, "params": {...}}
#: params 是"服务端要算的东西"（如 hist 的 bins），P13-01 起逐 kind 启用。
KIND_PRESETS: dict[str, dict[str, Any]] = {
    "line": {"style": {"mode": "lines", "width": 1.6}, "view": {}},
    "marker": {"style": {"mode": "markers", "marker": {"size": 7}}, "view": {}},
    "scatter": {"style": {"mode": "markers", "marker": {"size": 7}}, "view": {}},
    "bar": {"style": {"mode": "bars", "width": 0.8}, "view": {}},
    "hist": {"style": {"mode": "bars", "bins": 30, "density": False}, "view": {}},
    "pie": {"style": {"mode": "bars", "autopct": "%1.1f%%"}, "view": {"grid": False}},
    "image": {
        "style": {
            "mode": "bars",
            "cmap": "viridis",
            "colorbar": True,
            "origin": "upper",
            "aspect": "auto",
        },
        "view": {"grid": False},
    },
    "table": {"style": {"mode": "bars", "fontsize": 10}, "view": {"grid": False}},
    "heatmap": {
        "style": {"mode": "bars", "cmap": "viridis", "colorbar": True},
        "view": {"grid": False},
    },
    "contour": {
        "style": {"mode": "bars", "levels": 8, "labels": False, "colorbar": False},
        "view": {"grid": False},
    },
    "contourf": {
        "style": {"mode": "bars", "levels": 8, "colorbar": True},
        "view": {"grid": False},
    },
    "correlation": {
        "style": {
            "mode": "bars",
            "cmap": "RdBu_r",
            "vmin": -1.0,
            "vmax": 1.0,
            "colorbar": True,
        },
        "view": {"grid": False},
    },
    "quiver": {
        "style": {
            "cmap": "viridis",
            "color_by": "magnitude",
            "arrowsize": 1.0,
            "shaft": 0.0035,
            "colorbar": False,
        },
        "view": {"grid": False},
    },
    "barbs": {
        "style": {
            "cmap": "viridis",
            "color_by": "magnitude",
            "arrowsize": 6.0,
            "colorbar": False,
        },
        "view": {"grid": False},
    },
    "streamplot": {
        "style": {
            "cmap": "viridis",
            "density": 1.0,
            "arrowsize": 1.0,
            "colorbar": False,
        },
        "view": {"grid": False},
    },
    # P13-04：3D（默认给一个能看清立体感的视角）
    "surface": {
        "style": {"cmap": "viridis", "colorbar": True, "stride": 1, "shade": True},
        "view": {"elev": 30, "azim": -60, "grid": True},
    },
    "line3d": {
        "style": {"width": 1.8},
        "view": {"elev": 30, "azim": -60, "grid": True},
    },
    "scatter3d": {
        "style": {"cmap": "viridis", "marker": {"size": 6}, "colorbar": False},
        "view": {"elev": 30, "azim": -60, "grid": True},
    },
    "bar3d": {
        "style": {"cmap": "viridis", "colorbar": False, "shade": True},
        "view": {"elev": 30, "azim": -60, "grid": True},
    },
    "hist3d": {
        "style": {"cmap": "viridis", "colorbar": True, "bins": 8, "shade": True},
        "view": {"elev": 30, "azim": -60, "grid": True},
    },
    "quiver3d": {
        "style": {"cmap": "viridis", "length": 0.6, "colorbar": False},
        "view": {"elev": 30, "azim": -60, "grid": True},
    },
    "stream3d": {
        "style": {"cmap": "viridis", "density": 0.6, "colorbar": False},
        "view": {"elev": 30, "azim": -60, "grid": True},
    },
    # P13-05：统计/信号族
    "boxplot": {"style": {"showfliers": True, "widths": 0.6}, "view": {}},
    "violinplot": {"style": {"showmeans": True, "widths": 0.8}, "view": {}},
    "ecdf": {"style": {"width": 1.8}, "view": {}},
    "hexbin": {
        "style": {"cmap": "viridis", "gridsize": 20, "mincnt": 1, "colorbar": True},
        "view": {"grid": False},
    },
    "barh": {"style": {"width": 0.8}, "view": {}},
    "stackplot": {"style": {"opacity": 0.85}, "view": {}},
    "step": {"style": {"where": "pre", "width": 1.6}, "view": {}},
    "stem": {"style": {"width": 1.4}, "view": {}},
    # P13-07：方法表漏项
    "stairs": {"style": {"width": 1.6}, "view": {}},
    "broken_barh": {"style": {"row": 1.0, "height": 0.8}, "view": {"grid": False}},
    "eventplot": {
        "style": {"lineoffsets": 1.0, "linelengths": 0.6},
        "view": {"grid": False},
    },
    "bxp": {"style": {"widths": 0.6, "whis": 1.5}, "view": {}},
    "psd": {"style": {"nfft": 256, "fs": 1.0}, "view": {}},
    "specgram": {
        "style": {"nfft": 256, "fs": 1.0, "cmap": "magma", "colorbar": True},
        "view": {"grid": False},
    },
    # P13-09：方法级缺口
    "triplot": {"style": {}, "view": {"grid": False}},
    "tricontour": {"style": {"levels": 8, "cmap": "viridis"}, "view": {"grid": False}},
    "tricontourf": {
        "style": {"levels": 8, "cmap": "viridis", "colorbar": True},
        "view": {"grid": False},
    },
    "tripcolor": {
        "style": {"cmap": "viridis", "colorbar": True},
        "view": {"grid": False},
    },
    "voxels": {
        "style": {"cmap": "viridis"},
        "view": {"elev": 30, "azim": -60, "grid": True},
    },
    "trisurf": {
        "style": {"cmap": "viridis", "colorbar": True},
        "view": {"elev": 30, "azim": -60, "grid": True},
    },
    "stem3d": {
        "style": {"width": 1.2},
        "view": {"elev": 30, "azim": -60, "grid": True},
    },
    "text3d": {
        "style": {"fontsize": 10},
        "view": {"elev": 30, "azim": -60, "grid": True},
    },
    "csd": {"style": {"nfft": 256, "fs": 1.0}, "view": {}},
    "cohere": {"style": {"nfft": 256, "fs": 1.0}, "view": {}},
    "acorr": {"style": {}, "view": {"grid": False}},
    "xcorr": {"style": {}, "view": {"grid": False}},
    "angle_spectrum": {"style": {"nfft": 256, "fs": 1.0}, "view": {}},
    "magnitude_spectrum": {"style": {"nfft": 256, "fs": 1.0}, "view": {}},
    "phase_spectrum": {"style": {"nfft": 256, "fs": 1.0}, "view": {}},
}


def preset(kind: str) -> dict[str, Any]:
    """取某个 kind 的预设副本；未登记返回空结构（不报错，交给注册表兜底）。"""
    return copy.deepcopy(KIND_PRESETS.get(kind, {}))


def register_preset(
    kind: str,
    *,
    style: Mapping[str, Any] | None = None,
    view: Mapping[str, Any] | None = None,
    params: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """登记/覆盖一个 kind 的预设；返回登记后的副本。"""
    entry = KIND_PRESETS.setdefault(kind, {})
    if style:
        entry.setdefault("style", {}).update(dict(style))
    if view:
        entry.setdefault("view", {}).update(dict(view))
    if params:
        entry.setdefault("params", {}).update(dict(params))
    return copy.deepcopy(entry)


# ---------------------------------------------------------------------------
# 全局默认（`pk.init()` / `pk.style_scope()`，PK-R13）
#
# 语义（与 KIND_PRESETS 一起构成合并链，优先级低 → 高）：
#     KIND_PRESETS  <  GLOBAL_DEFAULTS（init / style_scope）  <  add_plot 显式参数  <  **kwargs
# 这里只存"图层级"的 view / style 键；figure 级（size/dpi/theme）请直接传给 pk.figure()。
# ---------------------------------------------------------------------------

#: 进程级全局默认。`style_scope` 通过临时替换本 dict 的内容实现作用域隔离。
GLOBAL_DEFAULTS: dict[str, Any] = {}


def init_globals(**kwargs: Any) -> dict[str, Any]:
    """`pk.init()` 的存储端：把非 None 的值并入 `GLOBAL_DEFAULTS`，返回新副本。"""
    for key, value in kwargs.items():
        if value is not None:
            GLOBAL_DEFAULTS[key] = value
    return copy.deepcopy(GLOBAL_DEFAULTS)


def global_defaults() -> dict[str, Any]:
    """取当前全局默认的深拷贝（Figure 构造时并入 `self.defaults`）。"""
    return copy.deepcopy(GLOBAL_DEFAULTS)


def reset_globals() -> None:
    """清空全局默认（测试与 `style_scope` 收尾用）。"""
    GLOBAL_DEFAULTS.clear()


def merged(
    kind: str,
    *,
    style: Mapping[str, Any] | None = None,
    view: Mapping[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """预设 + 显式参数合并，返回 (style, view)。"""
    base = preset(kind)
    out_style = dict(base.get("style") or {})
    out_view = dict(base.get("view") or {})
    for key, value in (style or {}).items():
        if key in ("marker", "error") and isinstance(value, Mapping):
            out_style[key] = {**dict(out_style.get(key) or {}), **dict(value)}
        else:
            out_style[key] = value
    out_view.update(dict(view or {}))
    return out_style, out_view
