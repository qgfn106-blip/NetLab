"""三维混合出图：PyVista 出位图，matplotlib 把坐标轴/刻度/标题画成**真矢量**。

为什么要混合：VTK 的 GL2PS 在本机（9.7.1 + OpenGL2）会把整个场景降级成一张位图，
SVG 里只有一个 `<image>`；而论文/排版要的是"文字和线可缩放、可检索"。
所以 3D 内容继续由 GPU 光栅化（快、好看），外面那圈轴和字改由 matplotlib 画。

产物里：`<image>` 是三维场景，`<text>` / `<path>` 是坐标轴、刻度、标题——后者是真矢量。

    from plotkit.backends import hybrid3d
    data = hybrid3d.render_hybrid(spec, store, width=800, height=600, fmt="svg")
"""

from __future__ import annotations

import io
import math
from typing import Any, Mapping, Sequence

import numpy as np

from . import pyvista_backend

_AXIS_COLOR = "#374151"
_EDGE_COLOR = "#9ca3af"


def _nice_ticks(lo: float, hi: float, count: int = 4) -> list[float]:
    """1-2-5 规则的刻度（和 matplotlib 的观感一致）。"""
    if not (math.isfinite(lo) and math.isfinite(hi)) or hi <= lo:
        return [lo]
    raw = (hi - lo) / max(1, count)
    mag = 10.0 ** math.floor(math.log10(raw))
    for mult in (1, 2, 5, 10):
        step = mult * mag
        if (hi - lo) / step <= count * 1.5:
            break
    start = math.ceil(lo / step) * step
    ticks = []
    value = start
    while value <= hi + step * 1e-6:
        ticks.append(round(value, 10))
        value += step
    return ticks or [lo]


def _fmt(value: float) -> str:
    if value == 0:
        return "0"
    if abs(value) >= 1e4 or abs(value) < 1e-3:
        return f"{value:.2g}"
    text = f"{value:.3g}"
    return text


def _pick_edges(corners, px, bounds):
    """挑三条"最靠下"的包围盒边当坐标轴（屏幕上最低的那条通常不被遮挡）。"""
    (x0, x1, y0, y1, z0, z1) = bounds
    index = {(x, y, z): i
             for i, (x, y, z) in enumerate(corners)}
    axes = []
    specs = [
        ("x", (x0, x1), [("y", y0), ("y", y1)], [("z", z0), ("z", z1)]),
        ("y", (y0, y1), [("x", x0), ("x", x1)], [("z", z0), ("z", z1)]),
        ("z", (z0, z1), [("x", x0), ("x", x1)], [("y", y0), ("y", y1)]),
    ]
    for name, (lo, hi), other_a, other_b in specs:
        best = None
        for _, a_val in other_a:
            for _, b_val in other_b:
                vals = {"x": (lo, hi), "y": (lo, hi), "z": (lo, hi)}
                vals[name] = (lo, hi)
                vals[other_a[0][0]] = (a_val, a_val)
                vals[other_b[0][0]] = (b_val, b_val)
                p_lo = (vals["x"][0], vals["y"][0], vals["z"][0])
                p_hi = (vals["x"][1], vals["y"][1], vals["z"][1])
                i_lo, i_hi = index.get(p_lo), index.get(p_hi)
                if i_lo is None or i_hi is None:
                    continue
                y_mean = (px[i_lo][1] + px[i_hi][1]) / 2.0
                if best is None or y_mean > best[0]:   # 屏幕 y 向下为正：取最大=最靠下
                    best = (y_mean, i_lo, i_hi)
        if best is not None:
            axes.append((name, lo, hi, px[best[1]], px[best[2]]))
    return axes


def _scalar_info(spec: Mapping[str, Any], store):
    """找第一个带标量场的图层，取出色标范围（供矢量色标用）。"""
    for layer in spec.get("layers") or []:
        data = layer.get("data") or {}
        style = layer.get("style") or {}
        key = data.get("scalar") or data.get("z")
        if not key:
            continue
        try:
            vals = np.asarray(store.values(key), dtype=float).ravel()
        except Exception:
            continue
        vals = vals[np.isfinite(vals)]
        if vals.size == 0:
            continue
        clim = style.get("clim")
        if not clim:
            clim = (float(vals.min()), float(vals.max()))
        lo, hi = float(clim[0]), float(clim[1])
        if not (math.isfinite(lo) and math.isfinite(hi)) or hi <= lo:
            lo, hi = float(vals.min()), float(vals.max())
        if hi <= lo:
            hi = lo + 1.0
        return {"cmap": str(style.get("cmap") or "viridis"), "clim": (lo, hi)}
    return None


def _compose(spec: Mapping[str, Any], store, image: np.ndarray, info: Mapping[str, Any],
             *, width: int, height: int, dpi: int, fmt: str) -> bytes:

    figure_cfg = spec.get("figure") or {}
    face = str(figure_cfg.get("facecolor") or "white")
    # 默认 svg.fonttype="path" 会把每个字形转成路径：慢 2 倍、体积大、还不可选中/搜索。
    # 这里要的就是"文字是文字"，所以强制 none（rc_context 不污染全局）。
    from matplotlib import rc_context

    rc = {"svg.fonttype": "none"} if fmt == "svg" else {}
    with rc_context(rc):
        return _compose_figure(spec, store, image, info, width=width, height=height,
                               dpi=dpi, fmt=fmt, face=face, figure_cfg=figure_cfg)


def _compose_figure(spec, store, image, info, *, width, height, dpi, fmt, face,
                    figure_cfg) -> bytes:
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure

    fig = Figure(figsize=(width / dpi, height / dpi), dpi=dpi, facecolor=face)
    FigureCanvasAgg(fig)
    ax = fig.add_axes([0.0, 0.0, 1.0, 1.0])
    ax.set_axis_off()
    ax.set_autoscale_on(False)
    ax.imshow(image, extent=(0, width, height, 0), interpolation="lanczos", zorder=0)
    ax.set_xlim(0, width)
    ax.set_ylim(height, 0)

    bounds = info["bounds"]
    px = info["corners_px"]
    corners = info["corners"]

    # 包围盒的 12 条棱：细灰线，纯矢量
    (x0, x1, y0, y1, z0, z1) = bounds
    edges = [
        ((x0, y0, z0), (x1, y0, z0)), ((x0, y1, z0), (x1, y1, z0)),
        ((x0, y0, z1), (x1, y0, z1)), ((x0, y1, z1), (x1, y1, z1)),
        ((x0, y0, z0), (x0, y1, z0)), ((x1, y0, z0), (x1, y1, z0)),
        ((x0, y0, z1), (x0, y1, z1)), ((x1, y0, z1), (x1, y1, z1)),
        ((x0, y0, z0), (x0, y0, z1)), ((x1, y0, z0), (x1, y0, z1)),
        ((x0, y1, z0), (x0, y1, z1)), ((x1, y1, z0), (x1, y1, z1)),
    ]
    index = {c: i for i, c in enumerate(corners)}
    for a, b in edges:
        ia, ib = index.get(a), index.get(b)
        if ia is None or ib is None:
            continue
        (xa, ya), (xb, yb) = px[ia], px[ib]
        ax.plot([xa, xb], [ya, yb], color=_EDGE_COLOR, linewidth=0.6, alpha=0.55, zorder=2)

    # 三条主轴的刻度 + 轴名（矢量文字）
    label_of = {"x": str(figure_cfg.get("xlabel") or "x"),
                "y": str(figure_cfg.get("ylabel") or "y"),
                "z": str(figure_cfg.get("zlabel") or "z")}
    for name, lo, hi, p_lo, p_hi in _pick_edges(corners, px, bounds):
        ax.plot([p_lo[0], p_hi[0]], [p_lo[1], p_hi[1]], color=_AXIS_COLOR,
                linewidth=1.1, zorder=3)
        for value in _nice_ticks(lo, hi):
            t = (value - lo) / (hi - lo) if hi > lo else 0.0
            tx = p_lo[0] + (p_hi[0] - p_lo[0]) * t
            ty = p_lo[1] + (p_hi[1] - p_lo[1]) * t
            ax.plot([tx], [ty], marker="|", color=_AXIS_COLOR, markersize=4, zorder=3)
            ax.annotate(_fmt(value), (tx, ty), xytext=(0, -9), textcoords="offset points",
                        ha="center", va="top", fontsize=7.5, color=_AXIS_COLOR, zorder=4)
        # 轴名放在末端外侧
        dx, dy = p_hi[0] - p_lo[0], p_hi[1] - p_lo[1]
        norm = math.hypot(dx, dy) or 1.0
        ax.annotate(label_of[name], (p_hi[0] + dx / norm * 16, p_hi[1] + dy / norm * 16),
                    ha="center", va="center", fontsize=9, color=_AXIS_COLOR,
                    fontweight="bold", zorder=4)

    scalar = _scalar_info(spec, store)
    if scalar is not None:
        from matplotlib.collections import PolyCollection
        from matplotlib.patches import Rectangle

        from .._compat import get_cmap

        cmap = get_cmap(scalar["cmap"])
        lo, hi = scalar["clim"]
        x0, w = width * 0.905, width * 0.022
        y0, hgt = height * 0.16, height * 0.60
        steps = 64
        # 一次 PolyCollection 画完整条色带（64 个 Rectangle 会白付 60+ms 的 add_patch 开销）
        quads, colors = [], []
        for i in range(steps):
            frac = i / (steps - 1)
            y_rect = y0 + hgt * (1.0 - frac)
            h_rect = hgt / steps + 0.8
            quads.append([(x0, y_rect), (x0 + w, y_rect),
                          (x0 + w, y_rect + h_rect), (x0, y_rect + h_rect)])
            colors.append(cmap(frac))
        ax.add_collection(PolyCollection(quads, facecolors=colors, edgecolors="none",
                                         zorder=3))
        ax.add_patch(Rectangle((x0, y0), w, hgt, facecolor="none",
                               edgecolor=_AXIS_COLOR, linewidth=0.6, zorder=4))
        for i in range(5):
            frac = i / 4
            value = lo + (hi - lo) * frac
            ty = y0 + hgt * (1.0 - frac)
            ax.plot([x0 + w, x0 + w + 4], [ty, ty], color=_AXIS_COLOR, linewidth=0.6, zorder=4)
            ax.annotate(_fmt(value), (x0 + w + 6, ty), ha="left", va="center",
                        fontsize=7.5, color=_AXIS_COLOR, zorder=5)

    title = figure_cfg.get("title")
    if title:
        fig.text(0.5, 0.975, str(title), ha="center", va="top", fontsize=11,
                 color="#111827", zorder=5)

    # 图层标签 = 图例（矢量），用一小块色块 + 文字
    labels = []
    for layer in spec.get("layers") or []:
        text = layer.get("label") or layer.get("name")
        if text:
            labels.append(str(text))
    if labels:
        for i, text in enumerate(labels[:6]):
            fig.text(0.985, 0.94 - i * 0.045, text, ha="right", va="top", fontsize=8,
                     color=_AXIS_COLOR, zorder=5)

    buffer = io.BytesIO()
    fig.savefig(buffer, format=fmt, dpi=dpi, facecolor=face, bbox_inches=None,
                metadata={"Date": None} if fmt != "png" else {"Software": None})
    return buffer.getvalue()


def render_hybrid(
    spec: Mapping[str, Any],
    store,
    *,
    width: int = 900,
    height: int = 520,
    dpi: int = 100,
    fmt: str = "svg",
    xlim: Sequence[float] | None = None,
    ylim: Sequence[float] | None = None,
) -> bytes:
    """三维混合出图：3D 场景位图 + 矢量坐标轴/刻度/标题。"""
    fmt = (fmt or "svg").lower()
    if fmt not in ("svg", "pdf", "png"):
        raise pyvista_backend.BackendUnsupported(f"混合出图不支持 {fmt!r}（支持 svg/pdf/png）")
    image, info = pyvista_backend.render_scene_threaded(
        spec, store, width=width, height=height, dpi=dpi,
        xlim=tuple(xlim) if xlim else None, ylim=tuple(ylim) if ylim else None,
        decorate=False,
    )
    return _compose(spec, store, np.asarray(image), info, width=int(width), height=int(height),
                    dpi=int(dpi), fmt=fmt)
