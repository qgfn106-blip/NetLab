"""matplotlib 后端：静态图 / 论文级导出 / 浏览器无等价物时的兜底。

用 `Figure` 对象直接构图（不碰 pyplot 全局状态，不改 rcParams），因此可在服务端多线程里安全调用。

论文级（pub）要素在这里是"原生长出来"的：误差棒、双对数 + 次刻度、内侧/镜像刻度、
逐级字号、真正的 LaTeX 上下标、inset 轴、箭头与斜率参考三角。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

import numpy as np

from ..spec.model import DEFAULT_FONTS
from ..spec.model import layers as spec_layers
from ..store.registry import DataStore
from . import registry as reg
from .series import PALETTE, THEMES, _step, color_for, _window_slice, current_trange  # noqa: F401
from .series import push_trange, pop_trange  # noqa: F401

FONT_FALLBACK = ("Microsoft YaHei", "SimHei", "Noto Sans CJK SC", "DejaVu Sans", "Arial")

MODE_STYLE = {
    "lines": {"linestyle": "-", "marker": None},
    "markers": {"linestyle": "None", "marker": "o"},
    "lines+markers": {"linestyle": "-", "marker": "o"},
}

DASH_MPL = {"solid": "-", "dot": ":", "dash": "--", "longdash": (0, (6, 3)), "dashdot": "-.", "longdashdot": (0, (8, 3, 2, 3))}

# plotly 的 symbol 名 → matplotlib 的 marker 简写
SYMBOL_MPL = {
    "circle": "o", "square": "s", "diamond": "D", "cross": "+", "x": "x",
    "triangle-up": "^", "triangle-down": "v", "triangle-left": "<", "triangle-right": ">",
    "star": "*", "hexagon": "h", "pentagon": "p", "hourglass": "d", "bowtie": "d",
    "line-ew": "_", "line-ns": "|",
}


def _marker_symbol(style: Mapping[str, Any]) -> str:
    return SYMBOL_MPL.get(str((style.get("marker") or {}).get("symbol", "circle")), "o")


def _error_bars(ax, layer, store, *, color: str) -> None:
    """误差棒：xerr/yerr 用 [minus, plus] 形式，支持非对称。"""
    data = layer.get("data") or {}
    if not any(k.startswith("error_") for k in data):
        return
    from ..backends.series import _xy

    x, y = _xy(layer, store, pixels=None, per_pixel=2.0)
    cfg = dict((layer.get("style") or {}).get("error") or {})
    ecolor = cfg.get("color") or color
    width = cfg.get("width")
    capsize = (float(width) / 2.0) if width else 0.0

    def _band(axis: str):
        raw = np.asarray(store.values(data[f"error_{axis}"])).ravel()
        minus_name = data.get(f"error_{axis}_minus")
        raw_minus = np.asarray(store.values(minus_name)).ravel() if minus_name else raw
        i0, i1 = _window_slice(np.asarray(store.values(data["x"])).ravel(), current_trange())
        return np.vstack([raw_minus[i0:i1], raw[i0:i1]]).astype(float)

    yerr = _band("y") if data.get("error_y") else None
    xerr = _band("x") if data.get("error_x") else None
    ax.errorbar(
        x, y, yerr=yerr, xerr=xerr,
        fmt="none", ecolor=ecolor,
        elinewidth=float(cfg.get("thickness", 1.2)),
        capsize=capsize, capthick=float(cfg.get("thickness", 1.2)),
        alpha=float(cfg.get("opacity", 1.0)),
        zorder=1,
    )


def _draw_line(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    from ..backends.series import _xy

    x, y = _xy(layer, store, pixels=pixels, per_pixel=per_pixel)
    style = layer.get("style") or {}
    mode = style.get("mode", "lines")
    kwargs = MODE_STYLE.get(mode, MODE_STYLE["lines"])
    marker = dict(style.get("marker") or {})
    color = style.get("color") or color_for(index)
    marker_line = dict(marker.get("line") or {})
    line = ax.plot(
        x, y,
        color=color,
        linewidth=float(style.get("width", 1.6)),
        linestyle=DASH_MPL.get(style.get("dash", "solid"), "-"),
        marker=_marker_symbol(style) if kwargs["marker"] or marker.get("symbol") else None,
        markersize=float(marker.get("size", 6)) * 0.7,
        markeredgecolor=marker_line.get("color") or color,
        markeredgewidth=float(marker_line.get("width", 0.0)),
        alpha=float(style.get("opacity", 1.0)),
        label=layer.get("label") or layer.get("data", {}).get("y"),
    )[0]
    _ = line
    if mode == "lines+markers":
        # marker 默认使用 line 的 color；描边单独给
        line.set_markerfacecolor(color)
    _error_bars(ax, layer, store, color=color)


def _draw_scatter(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    from ..backends.series import _xy

    x, y = _xy(layer, store, pixels=pixels, per_pixel=per_pixel)
    style = layer.get("style") or {}
    marker = dict(style.get("marker") or {})
    marker_line = dict(marker.get("line") or {})
    color = style.get("color") or color_for(index)
    sizes = marker.get("sizes")
    ax.scatter(
        x, y,
        color=color,
        s=np.asarray(sizes, dtype=float) ** 2 if sizes is not None else float(marker.get("size", 6)) ** 2,
        marker=_marker_symbol(style),
        edgecolors=marker_line.get("color") or color,
        linewidths=float(marker_line.get("width", 0.0)),
        alpha=float(marker.get("opacity", style.get("opacity", 1.0))),
        label=layer.get("label") or layer.get("data", {}).get("y"),
        zorder=3,
    )
    _error_bars(ax, layer, store, color=color)


def _draw_bar(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    from ..backends.series import _xy

    x, y = _xy(layer, store, pixels=pixels, per_pixel=per_pixel)
    style = layer.get("style") or {}
    color = style.get("color") or color_for(index)
    ax.bar(
        x, y,
        width=float(style.get("width", 0.8)) or 0.8,
        color=color,
        alpha=float(style.get("opacity", 1.0)),
        label=layer.get("label") or layer.get("data", {}).get("y"),
    )
    _error_bars(ax, layer, store, color=color)


def hist_counts(layer: Mapping[str, Any], store: DataStore) -> tuple[np.ndarray, np.ndarray]:
    """直方图分箱（服务端算，D31）。单独暴露出来，测试可以直接与 `np.histogram` 对拍。"""
    data = layer.get("data") or {}
    style = layer.get("style") or {}
    x = np.asarray(store.values(data["x"])).ravel().astype(float)
    x = x[np.isfinite(x)]
    return np.histogram(x, bins=style.get("bins", 30), density=bool(style.get("density")))


def _draw_hist(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    """直方图：分箱在服务端做（D31），前端只画柱子。"""
    data = layer.get("data") or {}
    style = layer.get("style") or {}
    counts, edges = hist_counts(layer, store)
    color = style.get("color") or color_for(index)
    ax.bar(edges[:-1], counts, width=np.diff(edges), align="edge", color=color,
           alpha=float(style.get("opacity", 1.0)),
           label=layer.get("label") or data.get("x"))


def _draw_pie(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    data = layer.get("data") or {}
    style = layer.get("style") or {}
    values = np.asarray(store.values(data["values"])).ravel().astype(float)
    labels = None
    if data.get("labels"):
        labels = [str(v) for v in np.asarray(store.values(data["labels"])).ravel()]
    ax.pie(values, labels=labels, autopct=str(style.get("autopct") or "") or None,
           startangle=90, counterclock=False)
    ax.set_axis_off()


def _draw_image(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    data = layer.get("data") or {}
    style = layer.get("style") or {}
    arr = np.asarray(store.values(data["image"]))
    if arr.ndim == 1:
        arr = arr.reshape(1, -1)
    im = ax.imshow(arr, cmap=str(style.get("cmap") or "viridis"),
                   origin=str(style.get("origin") or "upper"),
                   aspect=str(style.get("aspect") or "auto"),
                   vmin=style.get("vmin"), vmax=style.get("vmax"),
                   interpolation="nearest")
    if style.get("colorbar", True):
        ax.figure.colorbar(im, ax=ax, **COLORBAR_KW)


HIGHLIGHT_COLOR = "#ffd54f"


def _highlight_cells(table, cells, style: Mapping[str, Any], *, has_header: bool) -> None:
    """表格高亮：`highlight="max"/"min"` 或显式 `[[row, col], …]`（行 0 起，不含表头）。

    行号偏移由调用方传入 `has_header` 决定——以前靠 `(0, 0) in celld` 猜，
    无表头的表格会整体错一行（2026-10-31 评审发现）。
    """
    spec = style.get("highlight")
    if not spec:
        return
    color = str(style.get("highlight_color") or HIGHLIGHT_COLOR)
    arr = np.asarray(cells)
    numeric = arr.astype(float) if np.issubdtype(arr.dtype, np.number) else None
    targets: list[tuple[int, int]] = []
    if isinstance(spec, str):
        if spec not in ("max", "min"):
            raise ValueError(f"highlight 只支持 max / min 或 [[row, col], …]，收到 {spec!r}")
        if numeric is None:
            raise ValueError("highlight=max/min 需要数值单元格")
        idx = int(np.nanargmax(numeric)) if spec == "max" else int(np.nanargmin(numeric))
        targets = [divmod(idx, numeric.shape[1])]
    else:
        targets = [(int(r), int(c)) for r, c in spec]
    offset = 1 if has_header else 0
    for row, col in targets:
        cell = table.get_celld().get((row + offset, col))
        if cell is not None:
            cell.set_facecolor(color)
            cell.set_alpha(0.45)


def _draw_table(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    data = layer.get("data") or {}
    style = layer.get("style") or {}
    cells = np.asarray(store.values(data["cells"]))
    if cells.ndim == 1:
        cells = cells.reshape(-1, 1)
    header = None
    if data.get("header"):
        header = [str(v) for v in np.asarray(store.values(data["header"])).ravel()]
    ax.set_axis_off()
    table = ax.table(cellText=cells, colLabels=header, loc="center", cellLoc="center")
    table.auto_set_font_size(False)
    table.set_fontsize(float(style.get("fontsize", 10)))
    table.scale(1.0, 1.4)
    _highlight_cells(table, cells, style, has_header=header is not None)




#: colorbar 的统一摆位（三处共用，别各写一份魔数）
COLORBAR_KW = {"fraction": 0.046, "pad": 0.02}


def _maybe_colorbar(ax, mappable, style: Mapping[str, Any], *, default: bool = True) -> None:
    """按 `style.colorbar` 决定是否加色条（六处共用，别各写一份判断）。"""
    if style.get("colorbar", default):
        ax.figure.colorbar(mappable, ax=ax, **COLORBAR_KW)


def _field_arrays(layer: Mapping[str, Any], store: DataStore):
    """取 z（必需）与可选的 x/y 坐标；z 至少二维，一维自动补成 1 行。"""
    data = layer.get("data") or {}
    z = np.asarray(store.values(data["z"]), dtype=float)
    if z.ndim == 1:
        z = z.reshape(1, -1)
    x = np.asarray(store.values(data["x"])).ravel().astype(float) if data.get("x") else None
    y = np.asarray(store.values(data["y"])).ravel().astype(float) if data.get("y") else None
    return x, y, z


def _mesh(ax, layer, store, *, cmap_default: str = "viridis"):
    style = layer.get("style") or {}
    x, y, z = _field_arrays(layer, store)
    cmap = str(style.get("cmap") or cmap_default)
    vmin, vmax = style.get("vmin"), style.get("vmax")
    if x is not None and y is not None and x.size == z.shape[1] and y.size == z.shape[0]:
        return ax.pcolormesh(x, y, z, cmap=cmap, vmin=vmin, vmax=vmax,
                             shading=str(style.get("shading") or "auto"))
    return ax.imshow(z, cmap=cmap, vmin=vmin, vmax=vmax, origin="lower",
                     aspect=str(style.get("aspect") or "auto"), interpolation="nearest")


def _draw_heatmap(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    mesh = _mesh(ax, layer, store)
    _maybe_colorbar(ax, mesh, layer.get("style") or {})


def _contour_args(layer, store):
    style = layer.get("style") or {}
    x, y, z = _field_arrays(layer, store)
    levels = style.get("levels") or 8
    kwargs = {"levels": levels, "cmap": str(style.get("cmap") or "viridis")}
    if style.get("vmin") is not None:
        kwargs["vmin"] = style["vmin"]
    if style.get("vmax") is not None:
        kwargs["vmax"] = style["vmax"]
    args = (x, y, z) if x is not None and y is not None else (z,)
    return args, kwargs


def _draw_contour(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    args, kwargs = _contour_args(layer, store)
    cs = ax.contour(*args, **kwargs)
    style = layer.get("style") or {}
    if style.get("labels"):
        ax.clabel(cs, inline=True, fontsize=8)
    if style.get("colorbar"):
        ax.figure.colorbar(cs, ax=ax, **COLORBAR_KW)


def _draw_contourf(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    args, kwargs = _contour_args(layer, store)
    cs = ax.contourf(*args, **kwargs)
    if (layer.get("style") or {}).get("colorbar", True):
        ax.figure.colorbar(cs, ax=ax, **COLORBAR_KW)


def _draw_correlation(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    _draw_heatmap(ax, layer, store, index, pixels=pixels, per_pixel=per_pixel)
    # 列名存在数据集的 note 里（add_correlation 写入），有就画成刻度标签
    name = (layer.get("data") or {}).get("z")
    try:
        names = [s for s in str(store.meta(name).get("note") or "").split(",") if s]
    except KeyError:
        names = []
    if names:
        ticks = np.arange(len(names))
        ax.set_xticks(ticks)
        ax.set_yticks(ticks)
        ax.set_xticklabels(names, rotation=45, ha="right")
        ax.set_yticklabels(names)



def _vector_arrays(layer: Mapping[str, Any], store: DataStore):
    data = layer.get("data") or {}
    return tuple(np.asarray(store.values(data[k]), dtype=float) for k in ("x", "y", "u", "v"))


COLOR_BY_CHOICES = ("magnitude", "x", "y", "u", "v")


def _color_norm(style: Mapping[str, Any]):
    """vmin/vmax → matplotlib 的 Normalize（quiver/barbs/streamplot 只认 norm，不认 vmin/vmax）。"""
    vmin, vmax = style.get("vmin"), style.get("vmax")
    if vmin is None and vmax is None:
        return None
    from matplotlib.colors import Normalize

    return Normalize(vmin=None if vmin is None else float(vmin),
                     vmax=None if vmax is None else float(vmax))


def _color_values(style: Mapping[str, Any], x, y, u, v):
    """按 `color_by` 取上色用的标量：magnitude（默认）/ x / y / u / v。"""
    mode = str(style.get("color_by") or "magnitude")
    if mode not in COLOR_BY_CHOICES:
        raise ValueError(f"color_by={mode!r} 不支持（可用: {', '.join(COLOR_BY_CHOICES)}）")
    if mode == "x":
        return x
    if mode == "y":
        return y
    if mode == "u":
        return u
    if mode == "v":
        return v
    return np.hypot(u, v)


def quiver_scale(x, y, u, v, *, fraction: float = 0.06) -> float:
    """把"中位箭头长度 ≈ 画布跨度的 6%"换算成 quiver 的 scale（数据单位）。

    mpl 自带的 auto-scale 在 `angles="xy"` 下按 axes 宽度归一，网格密时箭头会长到糊满全图
    （2026-10-31 实测：整幅图变成一片渐变）。这里显式给 scale + `scale_units="xy"`，
    箭头长度就只由数据决定，换分辨率/换尺寸都不会变。
    """
    mag = np.hypot(np.asarray(u, dtype=float), np.asarray(v, dtype=float))
    finite = mag[np.isfinite(mag)]
    base = float(np.median(finite)) if finite.size else 1.0
    xs = np.asarray(x, dtype=float)
    ys = np.asarray(y, dtype=float)
    span = max(float(np.ptp(xs[np.isfinite(xs)])), float(np.ptp(ys[np.isfinite(ys)]))) or 1.0
    return max(base / (max(fraction, 1e-3) * span), 1e-12)


def _draw_quiver(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    x, y, u, v = _vector_arrays(layer, store)
    c = _color_values(style, x, y, u, v)
    cmap = str(style.get("cmap") or "viridis")
    kwargs = {
        "angles": "xy",
        # quiver 没有 arrowsize，用箭头头部尺寸换算（streamplot 才有 arrowsize）
        "headwidth": 3.0 * float(style.get("arrowsize", 1.0) or 1.0),
        "headlength": 5.0 * float(style.get("arrowsize", 1.0) or 1.0),
        "headaxislength": 4.5 * float(style.get("arrowsize", 1.0) or 1.0),
        # 注意：不能复用通用的 style["width"]（那是线宽 1.6，在 quiver 里表示
        # "箭杆宽度 = 1.6 个 axes 宽度"，会把整幅图糊满）。箭杆用独立键 shaft。
        "width": float(style.get("shaft", 0.0035) or 0.0035),
    }
    # 显式给 scale 才按数据单位缩放；否则按"中位箭头 ≈ 跨度 6%"自动算（见 quiver_scale）
    scale = style.get("scale")
    if scale in (None, 0, "auto"):
        kwargs["scale"] = quiver_scale(x, y, u, v)
    else:
        kwargs["scale"] = float(scale)
    kwargs["scale_units"] = "xy"
    norm = _color_norm(style)
    if norm is not None:
        kwargs["norm"] = norm
    if style.get("color"):
        kwargs["color"] = str(style["color"])
    else:
        kwargs["cmap"] = cmap
    q = ax.quiver(x, y, u, v, c, **kwargs)
    if style.get("key"):
        # quiverkey：给一个"这个箭头代表多少"的图例（对应 mpl 的 quiverkey）
        mag = np.hypot(u, v)
        ref = float(np.nanmax(mag) or 1.0)
        ax.quiverkey(q, 0.9, 1.02, ref, f"{ref:.3g}", labelpos="E", coordinates="axes",
                     fontproperties={"size": 8})
    if not style.get("color"):  # 纯色箭头时色条会误导（色条画的是模长，箭头是单色）
        _maybe_colorbar(ax, q, style, default=False)


def _draw_volume(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    """体渲染只有 pyvista 后端支持；mpl 里明确报错，而不是画个莫名其妙的东西。"""
    raise ValueError("volume 需要 pyvista 后端：fig.render(..., backend=\"pyvista\")")


def _draw_lic(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    """线积分卷积：把二维矢量场画成沿流向拉丝的纹理（ParaView 那种"丝状场"）。"""
    from .lic import lic_rgb

    style = layer.get("style") or {}
    data = layer.get("data") or {}
    u = np.asarray(store.values(data["u"]), dtype=float)
    v = np.asarray(store.values(data["v"]), dtype=float)
    if u.ndim != 2 or v.ndim != 2:
        raise ValueError(f"lic 的 u/v 需要二维场，收到 {u.shape} 与 {v.shape}")
    scalar = None
    if data.get("scalar"):
        scalar = np.asarray(store.values(data["scalar"]), dtype=float)
    rgb = lic_rgb(
        u, v,
        cmap=str(style.get("cmap") or "ocean"),
        steps=int(style.get("steps", 24) or 24),
        contrast=float(style.get("contrast", 1.0) or 1.0),
        step_px=float(style.get("step_px", 1.4) or 1.4),
        seed=int(style.get("seed", 0) or 0),
        scalar=scalar,
    )
    extent = None
    if data.get("x") and data.get("y"):
        xs = np.ravel(np.asarray(store.values(data["x"]), dtype=float))
        ys = np.ravel(np.asarray(store.values(data["y"]), dtype=float))
        extent = [float(xs[0]), float(xs[-1]), float(ys[0]), float(ys[-1])]
    ax.imshow(rgb, origin="lower", extent=extent, interpolation="bilinear",
              aspect="auto" if extent is None else "equal")


def _draw_barbs(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    """风羽图（mpl `barbs`）：每个点一根带旗的杆，长度编码风速。"""
    style = layer.get("style") or {}
    x, y, u, v = _vector_arrays(layer, store)
    c = _color_values(style, x, y, u, v)
    kwargs = {
        "length": float(style.get("arrowsize", 6.0) or 6.0),
        "linewidth": float(style.get("width", 0.8) or 0.8),
        "cmap": str(style.get("cmap") or "viridis"),
    }
    norm = _color_norm(style)
    if norm is not None:
        kwargs["norm"] = norm
    b = ax.barbs(x, y, u, v, c, **kwargs)
    if not style.get("color"):
        _maybe_colorbar(ax, b, style, default=False)


def _draw_streamplot(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    x, y, u, v = _vector_arrays(layer, store)
    if x.ndim != 2 or u.ndim != 2:
        raise ValueError("streamplot 需要二维网格：x/y 与 u/v 都要是 2D 数组（一维请改用 quiver）")
    density = style.get("density")
    density = 1.0 if density is None else float(density)
    color = style.get("color")
    if color:
        # 纯色流线：color 直接给字符串，此时不传 cmap（两者互斥）
        color_arg = str(color)
        cmap_arg = None
    else:
        color_arg = _color_values(style, x, y, u, v)
        cmap_arg = str(style.get("cmap") or "viridis")
    kwargs = {
        "density": density,
        "color": color_arg,
        "arrowsize": float(style.get("arrowsize", 1.0) or 1.0),
        "linewidth": float(style.get("width", 1.0) or 1.0),
    }
    if cmap_arg:
        kwargs["cmap"] = cmap_arg
        norm = _color_norm(style)
        if norm is not None:
            kwargs["norm"] = norm
    strm = ax.streamplot(x, y, u, v, **kwargs)
    if not style.get("color"):
        _maybe_colorbar(ax, strm.lines, style, default=False)



# ---------------- P13-04：3D 七种 ----------------

def _surface_grid(layer, store):
    data = layer.get("data") or {}
    z = as_float_keep(store.values(data["z"]))
    if z.ndim != 2:
        raise ValueError("surface 需要二维 z（行 = y，列 = x）")
    x = as_float_keep(store.values(data["x"])) if data.get("x") else None
    y = as_float_keep(store.values(data["y"])) if data.get("y") else None
    if x is None or y is None:
        return np.meshgrid(np.arange(z.shape[1]), np.arange(z.shape[0])) + (z,)
    if x.ndim == 2 and y.ndim == 2:
        if x.shape != z.shape or y.shape != z.shape:
            raise ValueError(f"surface 的 x/y 形状必须与 z 一致：z{z.shape}，x{x.shape}，y{y.shape}")
        return x, y, z
    X, Y = np.meshgrid(np.ravel(x), np.ravel(y))
    if X.shape != z.shape:
        raise ValueError(f"surface 的 x/y 长度必须匹配 z：z{z.shape}，得到 {X.shape}")
    return X, Y, z


def _draw_surface(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    X, Y, Z = _surface_grid(layer, store)
    stride = max(1, int(style.get("stride") or 1))
    surf = ax.plot_surface(
        X, Y, Z, cmap=str(style.get("cmap") or "viridis"), norm=_color_norm(style),
        rstride=stride, cstride=stride, linewidth=0, antialiased=True,
        shade=bool(style.get("shade", True)), alpha=float(style.get("opacity", 1.0)),
    )
    _maybe_colorbar(ax, surf, style)


def _color_kwargs(style: Mapping[str, Any], values) -> dict[str, Any]:
    """返回上色参数：有 color 就纯色，否则按 values 走 cmap + norm。"""
    if style.get("color"):
        return {"color": str(style["color"])}
    kwargs: dict[str, Any] = {"cmap": str(style.get("cmap") or "viridis")}
    norm = _color_norm(style)
    if norm is not None:
        kwargs["norm"] = norm
    return kwargs


def as_float_keep(arr):
    """保持输入浮点精度：float32 就是 float32，别悄悄升成 float64（D37 硬边界 §5.2）。

    整型/其它 dtype 才转 float64——整数参与 3D 计算必须先变浮点。
    """
    arr = np.asarray(arr)
    if arr.dtype in (np.float32, np.float64):
        return arr
    return arr.astype(np.float64)


def _xyz_arrays(layer, store, keys=("x", "y", "z")):
    data = layer.get("data") or {}
    return tuple(as_float_keep(store.values(data[k])) for k in keys)


def _draw_line3d(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    x, y, z = _xyz_arrays(layer, store)
    ax.plot(np.ravel(x), np.ravel(y), np.ravel(z),
            color=str(style.get("color") or color_for(index)),
            linewidth=float(style.get("width", 1.8) or 1.8),
            label=layer.get("label") or layer.get("data", {}).get("z"))


def _draw_segments(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    """多段折线：x/y/z 是**成对**的端点（第 2i、2i+1 个点连成一段）。"""
    from mpl_toolkits.mplot3d.art3d import Line3DCollection

    style = layer.get("style") or {}
    x, y, z = _xyz_arrays(layer, store)
    xs, ys, zs = np.ravel(x), np.ravel(y), np.ravel(z)
    n = (xs.size // 2) * 2
    if n < 2:
        return
    pts = np.stack([xs[:n], ys[:n], zs[:n]], axis=1).reshape(-1, 2, 3)
    coll = Line3DCollection(pts,
                            colors=str(style.get("color") or color_for(index)),
                            linewidths=float(style.get("width", 1.2) or 1.2))
    ax.add_collection3d(coll)
    ax.auto_scale_xyz(xs[:n], ys[:n], zs[:n])


def _draw_scatter3d(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    x, y, z = _xyz_arrays(layer, store)
    marker = style.get("marker") or {}
    kwargs = {
        "s": float(marker.get("size", 6) or 6) ** 2,
        "alpha": float(style.get("opacity", 1.0)),
        "depthshade": False,
    }
    colored = not style.get("color")
    values = np.ravel(z)
    if (layer.get("data") or {}).get("scalar"):
        # 用另一份场着色（例如按涡量给点上色），坐标仍由 x/y/z 决定
        values = np.ravel(_flat(layer, store, "scalar"))
    if colored:
        kwargs["c"] = values
    kwargs.update(_color_kwargs(style, values))
    sc = ax.scatter(np.ravel(x), np.ravel(y), np.ravel(z), **kwargs)
    if not style.get("color"):
        _maybe_colorbar(ax, sc, style, default=False)


def _draw_bar3d(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    x, y, z = (np.ravel(v) for v in _xyz_arrays(layer, store))
    def _bar_width(values):
        uniq = np.unique(values)
        return float(np.median(np.diff(uniq))) * 0.8 if uniq.size > 1 else 0.8
    dx, dy = _bar_width(x), _bar_width(y)
    if style.get("color"):
        colors = str(style["color"])
        mappable = None
    else:
        # bar3d 不吃 cmap：按高度把值映射成颜色，色条才有意义（同 hist3d）
        from matplotlib.cm import ScalarMappable
        from matplotlib.colors import Normalize
        import matplotlib

        cmap = matplotlib.colormaps[str(style.get("cmap") or "viridis")]
        norm = _color_norm(style) or Normalize(vmin=float(np.nanmin(z)), vmax=float(np.nanmax(z)) or 1.0)
        colors = cmap(norm(z))
        mappable = ScalarMappable(norm=norm, cmap=cmap)
    ax.bar3d(x, y, np.zeros_like(z), dx, dy, z, color=colors,
             alpha=float(style.get("opacity", 1.0)), shade=bool(style.get("shade", True)))
    if mappable is not None:
        _maybe_colorbar(ax, mappable, style, default=False)


def _draw_hist3d(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    data = layer.get("data") or {}
    x = np.ravel(np.asarray(store.values(data["x"]), dtype=float))
    y = np.ravel(np.asarray(store.values(data["y"]), dtype=float))
    bins = int(style.get("bins") or 8)
    counts, xe, ye = np.histogram2d(x, y, bins=bins)
    X, Y = np.meshgrid(xe[:-1], ye[:-1])
    # 柱子按计数上色：bar3d 不接受 cmap，必须自己把计数映射成颜色，
    # 否则柱子是单色、色条却是 0–1 的归一化刻度，两者对不上（2026-10-31 截图发现）。
    from matplotlib.cm import ScalarMappable
    from matplotlib.colors import Normalize
    import matplotlib

    cmap = matplotlib.colormaps[str(style.get("cmap") or "viridis")]
    norm = Normalize(vmin=0.0, vmax=float(counts.max()) or 1.0)
    ax.bar3d(X.ravel(), Y.ravel(), np.zeros(counts.size),
             np.diff(xe).mean() * 0.9, np.diff(ye).mean() * 0.9, counts.ravel(),
             color=cmap(norm(counts.ravel())), shade=bool(style.get("shade", True)))
    _maybe_colorbar(ax, ScalarMappable(norm=norm, cmap=cmap), style)


def _draw_quiver3d(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    x, y, z, u, v, w = _xyz_arrays(layer, store, ("x", "y", "z", "u", "v", "w"))
    kwargs = {
        "length": float(style.get("length", 0.6) or 0.6),
        "normalize": bool(style.get("normalize", False)),
        "linewidth": float(style.get("width", 1.0) or 1.0),
    }
    kwargs.update(_color_kwargs(style, np.hypot(u, v)))
    q = ax.quiver(np.ravel(x), np.ravel(y), np.ravel(z),
                  np.ravel(u), np.ravel(v), np.ravel(w), **kwargs)
    if not style.get("color"):
        _maybe_colorbar(ax, q, style, default=False)


def stream3d_paths(layer, store):
    """在三维网格上做 RK2 积分，返回 (paths, style)。

    D37：抽成公共函数——matplotlib 与 PyVista 必须**同一条轨迹**（硬边界 §5.3：
    VTK 自带 stream tracer 的结果不等价，不能拿它冒充 `algorithm="plotkit_rk2"`）。
    """
    style = layer.get("style") or {}
    algorithm = str(style.get("algorithm") or "plotkit_rk2")
    if algorithm != "plotkit_rk2":
        raise ValueError(f"stream3d 只支持 algorithm='plotkit_rk2'，收到 {algorithm!r}")
    X, Y, Z, U, V, W = _xyz_arrays(layer, store, ("x", "y", "z", "u", "v", "w"))
    if X.ndim != 3:
        raise ValueError("stream3d 需要三维网格：x/y/z 与 u/v/w 都要是 3D 数组")
    xs, ys, zs = X[:, 0, 0], Y[0, :, 0], Z[0, 0, :]
    span = max(float(np.ptp(xs)), float(np.ptp(ys)), float(np.ptp(zs))) or 1.0
    step = span / 30.0
    density = float(style.get("density", 0.6) or 0.6)
    every = max(1, int(round(4 * (1.0 - min(max(density, 0.0), 1.0)))))

    def direction(point):
        ix = int(np.abs(xs - point[0]).argmin())
        iy = int(np.abs(ys - point[1]).argmin())
        iz = int(np.abs(zs - point[2]).argmin())
        vec = np.array([U[ix, iy, iz], V[ix, iy, iz], W[ix, iy, iz]], dtype=float)
        norm = float(np.linalg.norm(vec))
        return vec / norm if norm > 1e-12 else np.zeros(3)

    lo = np.array([xs.min(), ys.min(), zs.min()])
    hi = np.array([xs.max(), ys.max(), zs.max()])
    paths = []
    # 数组按 (ix, iy, iz) 存放（与 xs=X[:,0,0] / ys=Y[0,:,0] / zs=Z[0,0,:] 一致）。
    # 2026-10-31 修正：原来写成 U[iz, iy, ix]，网格非立方时（如 9×9×5）会索引越界。
    for iz in range(0, X.shape[2], every):
        for iy in range(0, X.shape[1], every):
            for ix in range(0, X.shape[0], every):
                p = np.array([X[ix, iy, iz], Y[ix, iy, iz], Z[ix, iy, iz]], dtype=float)
                path = [p.copy()]
                for _ in range(40):
                    d1 = direction(p)
                    if not d1.any():
                        break
                    mid = p + d1 * step * 0.5
                    d2 = direction(mid)
                    p = p + (d2 if d2.any() else d1) * step
                    if np.any(p < lo) or np.any(p > hi):
                        break
                    path.append(p.copy())
                if len(path) > 3:
                    paths.append(np.array(path))
    return paths, style


def _draw_stream3d(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    """matplotlib 没有 stream3d：在网格上做 RK2 积分，再把轨迹画成 3D 折线。"""
    paths, style = stream3d_paths(layer, store)
    color = str(style.get("color") or color_for(index))
    for pts in paths:
        ax.plot(pts[:, 0], pts[:, 1], pts[:, 2], color=color,
                linewidth=float(style.get("width", 1.0) or 1.0), alpha=0.9)



# ---------------- P13-05：统计/信号族 ----------------

def _flat(layer, store, key: str) -> np.ndarray:
    """取单序列数据：只接受一维。二维会静默拉成锯齿线，这里直接报错让人改用多图层。"""
    data = layer.get("data") or {}
    arr = np.asarray(store.values(data[key]), dtype=float)
    if arr.ndim > 1:
        raise ValueError(
            f"{layer.get('kind')} 的 {key} 需要一维数据，收到 {arr.shape}；"
            f"多序列请拆成多个图层（多组/多条用 boxplot/violinplot/stackplot）")
    return arr


def _y_matrix(layer, store, key: str = "y"):
    """取一列或多列数据：1D 视为单列，返回 (n,) 或 (n, m)。"""
    data = layer.get("data") or {}
    return np.asarray(store.values(data[key]), dtype=float)


def _columns(arr) -> list[np.ndarray]:
    """二维数据按**行**分组（一行 = 一组 / 一条序列），与 stackplot 同一约定。

    之前按列切，导致 (2,120) 的小提琴图画出 120 个"琴"糊成一片（2026-10-31 截图发现）。
    """
    arr = np.asarray(arr, dtype=float)
    if arr.ndim == 1:
        return [arr[np.isfinite(arr)]]
    return [arr[i][np.isfinite(arr[i])] for i in range(arr.shape[0])]


def _draw_boxplot(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    cols = _columns(_y_matrix(layer, store))
    color = str(style.get("color") or color_for(index))
    ax.boxplot(cols, patch_artist=True, widths=float(style.get("widths", 0.6) or 0.6),
               showfliers=bool(style.get("showfliers", True)),
               medianprops={"color": color, "linewidth": 1.6},
               boxprops={"facecolor": color, "alpha": 0.35, "edgecolor": color},
               whiskerprops={"color": color}, capprops={"color": color})


def _draw_violinplot(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    cols = _columns(_y_matrix(layer, store))
    res = ax.violinplot(cols, showmeans=bool(style.get("showmeans", True)),
                        widths=float(style.get("widths", 0.8) or 0.8), showextrema=False)
    color = str(style.get("color") or color_for(index))
    for body in res["bodies"]:
        body.set_facecolor(color)
        body.set_edgecolor(color)
        body.set_alpha(float(style.get("opacity", 0.6)))


def ecdf_points(values) -> tuple[np.ndarray, np.ndarray]:
    """经验分布：排序后的取值与累计概率（重复值各占一个台阶）。"""
    arr = np.sort(np.asarray(values, dtype=float)[np.isfinite(values)])
    if arr.size == 0:
        return arr, arr
    return arr, np.arange(1, arr.size + 1) / float(arr.size)


def _draw_ecdf(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    xs, ys = ecdf_points(_flat(layer, store, "x"))
    ax.step(xs, ys, where="post", color=str(style.get("color") or color_for(index)),
            linewidth=float(style.get("width", 1.8) or 1.8),
            label=layer.get("label") or layer.get("data", {}).get("x"))


def _draw_hexbin(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    x, y = _flat(layer, store, "x"), _flat(layer, store, "y")
    if x.size != y.size:
        raise ValueError(f"hexbin 的 x/y 长度必须一致：{x.size} vs {y.size}")
    mincnt = style.get("mincnt")
    hb = ax.hexbin(x, y, gridsize=int(style.get("gridsize", 20) or 20),
                   cmap=str(style.get("cmap") or "viridis"),
                   norm=_color_norm(style),
                   mincnt=1 if mincnt is None else int(mincnt),
                   linewidths=0.2)
    _maybe_colorbar(ax, hb, style)


def _draw_barh(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    data = layer.get("data") or {}
    x, y = _flat(layer, store, "x"), _flat(layer, store, "y")
    ax.barh(x, y, height=float(style.get("width", 0.8) or 0.8),
            color=str(style.get("color") or color_for(index)),
            alpha=float(style.get("opacity", 1.0)),
            label=layer.get("label") or data.get("y"))


def _draw_stackplot(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    data = layer.get("data") or {}
    x = np.ravel(np.asarray(store.values(data["x"]), dtype=float))
    y = np.asarray(store.values(data["y"]), dtype=float)
    rows = [y] if y.ndim == 1 else [y[i] for i in range(y.shape[0])]
    if style.get("color"):
        colors = [str(style["color"])]
    else:
        colors = [PALETTE[(index + i) % len(PALETTE)] for i in range(len(rows))]
    ax.stackplot(x, *rows, colors=colors, alpha=float(style.get("opacity", 0.85)),
                 labels=[f"{layer.get('label') or data.get('y')} #{i + 1}" for i in range(len(rows))])


def _draw_step(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    data = layer.get("data") or {}
    x, y = _flat(layer, store, "x"), _flat(layer, store, "y")
    ax.step(x, y, where=str(style.get("where") or "pre"),
            color=str(style.get("color") or color_for(index)),
            linewidth=float(style.get("width", 1.6) or 1.6),
            label=layer.get("label") or data.get("y"))


def _draw_stem(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    x, y = _flat(layer, store, "x"), _flat(layer, store, "y")
    color = str(style.get("color") or color_for(index))
    container = ax.stem(x, y, linefmt="-", markerfmt="o", basefmt=" ", bottom=0.0)
    # 只改自己这三件，别遍历 ax.lines——那会把其他图层已经画好的线一起染掉
    container.markerline.set_color(color)
    container.stemlines.set_color(color)
    container.stemlines.set_linewidth(float(style.get("width", 1.4) or 1.4))



# ---------------- P13-07：方法表漏项 ----------------

def _draw_stairs(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    data = layer.get("data") or {}
    y = _flat(layer, store, "y")
    if data.get("x"):
        x = _flat(layer, store, "x")
        if x.size == y.size + 1:
            edges = x          # 直接给边界
        elif x.size == y.size:
            # 给的是阶梯中心：用中点推边界，别静默换成等距（对数/非均匀会全错）
            edges = np.concatenate(([x[0] - (x[1] - x[0]) / 2],
                                    (x[:-1] + x[1:]) / 2,
                                    [x[-1] + (x[-1] - x[-2]) / 2]))
        else:
            raise ValueError(f"stairs 的 x 必须是 n 个中心或 n+1 个边界：y={y.size}，x={x.size}")
    else:
        edges = np.arange(y.size + 1, dtype=float)
    ax.stairs(y, edges, color=str(style.get("color") or color_for(index)),
              linewidth=float(style.get("width", 1.6) or 1.6),
              label=layer.get("label") or data.get("y"))


def _draw_broken_barh(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    seg = np.atleast_2d(_y_matrix(layer, store))
    if seg.shape[1] != 2:
        raise ValueError(f"broken_barh 的 y 必须是 (n, 2) 的 [起点, 宽度]，收到 {seg.shape}")
    row = float(style.get("row", 1.0) or 1.0)
    height = float(style.get("height", 0.8) or 0.8)
    ax.broken_barh([tuple(map(float, s)) for s in seg], (row - height / 2.0, height),
                   facecolors=str(style.get("color") or color_for(index)),
                   alpha=float(style.get("opacity", 1.0)))


def _draw_eventplot(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    x = _y_matrix(layer, store, "x")
    rows = [np.ravel(x)] if x.ndim == 1 else [x[i] for i in range(x.shape[0])]
    base = float(style.get("lineoffsets", 1.0) or 1.0)
    offsets = base + np.arange(len(rows)) if len(rows) > 1 else base
    ax.eventplot(rows, colors=str(style.get("color") or color_for(index)),
                 lineoffsets=offsets,
                 linelengths=float(style.get("linelengths", 0.6) or 0.6))


def _draw_bxp(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    """bxp：先用数据算五数概括，再交给 mpl 的 bxp（保留"可传预算统计量"的语义）。"""
    style = layer.get("style") or {}
    cols = _columns(_y_matrix(layer, store))
    whis = float(style.get("whis", 1.5) or 1.5)
    color = str(style.get("color") or color_for(index))
    stats = []
    for col in cols:
        q1, med, q3 = (float(v) for v in np.percentile(col, [25, 50, 75]))
        iqr = q3 - q1
        low_fence, high_fence = q1 - whis * iqr, q3 + whis * iqr
        inside = col[(col >= low_fence) & (col <= high_fence)]
        lo = float(inside.min()) if inside.size else q1
        hi = float(inside.max()) if inside.size else q3
        fliers = col[(col < low_fence) | (col > high_fence)] if col.size else []
        stats.append({"med": med, "q1": q1, "q3": q3, "whislo": lo, "whishi": hi,
                      "fliers": [float(v) for v in fliers]})
    ax.bxp(stats, patch_artist=True, widths=float(style.get("widths", 0.6) or 0.6),
           boxprops={"facecolor": color, "alpha": 0.35, "edgecolor": color},
           medianprops={"color": color, "linewidth": 1.6},
           whiskerprops={"color": color}, capprops={"color": color})


def _draw_psd(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    x = _flat(layer, store, "x")
    nfft = int(style.get("nfft", 256) or 256)
    ax.psd(x, NFFT=nfft, noverlap=nfft // 2, Fs=float(style.get("fs", 1.0) or 1.0),
           color=str(style.get("color") or color_for(index)),
           label=layer.get("label") or layer.get("data", {}).get("x"))


def _draw_specgram(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    x = _flat(layer, store, "x")
    nfft = int(style.get("nfft", 256) or 256)
    _, _, _, image = ax.specgram(x, NFFT=nfft, noverlap=nfft // 2,
                                 Fs=float(style.get("fs", 1.0) or 1.0),
                                 cmap=str(style.get("cmap") or "magma"))
    _maybe_colorbar(ax, image, style)



# ---------------- P13-09：方法级缺口 ----------------

def _triangulation(layer, store):
    import matplotlib.tri as mtri

    return mtri.Triangulation(_flat(layer, store, "x"), _flat(layer, store, "y"))


def _draw_triplot(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    ax.triplot(_triangulation(layer, store),
               color=str(style.get("color") or color_for(index)),
               linewidth=float(style.get("width", 1.0) or 1.0))


def _draw_tricontour(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    cs = ax.tricontour(_triangulation(layer, store), _flat(layer, store, "z"),
                       levels=style.get("levels") or 8,
                       cmap=str(style.get("cmap") or "viridis"), norm=_color_norm(style))
    if style.get("labels"):
        ax.clabel(cs, inline=True, fontsize=8)


def _draw_tricontourf(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    cs = ax.tricontourf(_triangulation(layer, store), _flat(layer, store, "z"),
                        levels=style.get("levels") or 8,
                        cmap=str(style.get("cmap") or "viridis"), norm=_color_norm(style))
    _maybe_colorbar(ax, cs, style)


def _draw_tripcolor(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    mesh = ax.tripcolor(_triangulation(layer, store), _flat(layer, store, "z"),
                        cmap=str(style.get("cmap") or "viridis"), norm=_color_norm(style))
    _maybe_colorbar(ax, mesh, style)


def _draw_voxels(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    data = layer.get("data") or {}
    grid = np.asarray(store.values(data["z"]), dtype=float)
    if grid.ndim != 3:
        raise ValueError(f"voxels 需要三维数组，收到 {grid.shape}")
    filled = grid != 0
    import matplotlib

    cmap = matplotlib.colormaps[str(style.get("cmap") or "viridis")]
    if grid.max() > grid.min():
        from matplotlib.colors import Normalize

        norm = _color_norm(style) or Normalize(vmin=float(grid.min()), vmax=float(grid.max()))
        colors = cmap(norm(grid))
    else:
        colors = np.array([cmap(0.6)] * grid.size).reshape(grid.shape + (4,))
    ax.voxels(filled, facecolors=colors, edgecolor=None, alpha=float(style.get("opacity", 0.9)))


def _draw_trisurf(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    surf = ax.plot_trisurf(_flat(layer, store, "x"), _flat(layer, store, "y"),
                           _flat(layer, store, "z"),
                           cmap=str(style.get("cmap") or "viridis"), norm=_color_norm(style),
                           linewidth=0.2, antialiased=True)
    _maybe_colorbar(ax, surf, style)


def _draw_stem3d(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    """mpl 没有 stem3d：竖线 + 顶点散点自己画。"""
    style = layer.get("style") or {}
    x, y, z = (np.ravel(v) for v in _xyz_arrays(layer, store))
    color = str(style.get("color") or color_for(index))
    for xi, yi, zi in zip(x, y, z):
        ax.plot([xi, xi], [yi, yi], [0.0, zi], color=color,
                linewidth=float(style.get("width", 1.2) or 1.2))
    ax.scatter(x, y, z, color=color, s=18, depthshade=False)


def _draw_text3d(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    data = layer.get("data") or {}
    x, y, z = (np.ravel(v) for v in _xyz_arrays(layer, store))
    labels = [str(v) for v in np.ravel(np.asarray(store.values(data["labels"])))]
    if len(labels) != x.size:
        raise ValueError(f"text3d 的 labels 数量要与点一致：{len(labels)} vs {x.size}")
    color = str(style.get("color") or color_for(index))
    for xi, yi, zi, text in zip(x, y, z, labels):
        ax.text(xi, yi, zi, text, color=color,
                fontsize=float(style.get("fontsize", 10) or 10))


def _draw_csd(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    data = layer.get("data") or {}
    if not data.get("y"):
        raise ValueError("csd 需要第二个信号 y（数据集名字或数组）")
    x, y = _flat(layer, store, "x"), _flat(layer, store, "y")
    # 分段平均要求至少两段：nfft 不能超过长度的一半
    nfft = min(int(style.get("nfft", 256) or 256), max(8, x.size // 2))
    ax.csd(x, y, NFFT=nfft, noverlap=nfft // 2, Fs=float(style.get("fs", 1.0) or 1.0),
           color=str(style.get("color") or color_for(index)))


def _draw_cohere(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    data = layer.get("data") or {}
    if not data.get("y"):
        raise ValueError("cohere 需要第二个信号 y（数据集名字或数组）")
    x, y = _flat(layer, store, "x"), _flat(layer, store, "y")
    # 分段平均要求至少两段：nfft 不能超过长度的一半
    nfft = min(int(style.get("nfft", 256) or 256), max(8, x.size // 2))
    ax.cohere(x, y, NFFT=nfft, noverlap=nfft // 2, Fs=float(style.get("fs", 1.0) or 1.0),
              color=str(style.get("color") or color_for(index)))


def _draw_acorr(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    x = _flat(layer, store, "x")
    ax.acorr(x, maxlags=int(style.get("maxlags", 0) or min(50, x.size - 1)),
             color=str(style.get("color") or color_for(index)))


def _draw_xcorr(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
    style = layer.get("style") or {}
    data = layer.get("data") or {}
    if not data.get("y"):
        raise ValueError("xcorr 需要第二个信号 y（数据集名字或数组）")
    x, y = _flat(layer, store, "x"), _flat(layer, store, "y")
    ax.xcorr(x, y, maxlags=int(style.get("maxlags", 0) or min(50, x.size - 1)),
             color=str(style.get("color") or color_for(index)))


def _spectrum(method: str):
    def _draw(ax, layer, store, index: int, *, pixels=None, per_pixel=2.0) -> None:
        style = layer.get("style") or {}
        x = _flat(layer, store, "x")
        # 注意：angle/magnitude/phase_spectrum 只认 pad_to，没有 NFFT（psd/csd/cohere 才有）
        pad = min(int(style.get("nfft", 256) or 256), max(8, x.size))
        getattr(ax, method)(x, pad_to=pad, Fs=float(style.get("fs", 1.0) or 1.0),
                            color=str(style.get("color") or color_for(index)))
    return _draw

DRAWERS = {
    "line": _draw_line, "marker": _draw_scatter, "bar": _draw_bar,
    "hist": _draw_hist, "pie": _draw_pie, "image": _draw_image, "table": _draw_table,
    "heatmap": _draw_heatmap, "contour": _draw_contour, "contourf": _draw_contourf,
    "correlation": _draw_correlation,
    "quiver": _draw_quiver, "streamplot": _draw_streamplot, "barbs": _draw_barbs,
    "lic": _draw_lic,
    "volume": _draw_volume,
    "particles": _draw_volume,
    "surface": _draw_surface, "line3d": _draw_line3d, "scatter3d": _draw_scatter3d,
    "bar3d": _draw_bar3d, "hist3d": _draw_hist3d, "quiver3d": _draw_quiver3d,
    "stream3d": _draw_stream3d,
    "boxplot": _draw_boxplot, "violinplot": _draw_violinplot, "ecdf": _draw_ecdf,
    "hexbin": _draw_hexbin, "barh": _draw_barh, "stackplot": _draw_stackplot,
    "step": _draw_step, "stem": _draw_stem,
    "stairs": _draw_stairs, "broken_barh": _draw_broken_barh, "eventplot": _draw_eventplot,
    "bxp": _draw_bxp, "psd": _draw_psd, "specgram": _draw_specgram,
    "triplot": _draw_triplot, "tricontour": _draw_tricontour,
    "tricontourf": _draw_tricontourf, "tripcolor": _draw_tripcolor,
    "voxels": _draw_voxels, "trisurf": _draw_trisurf, "stem3d": _draw_stem3d,
    "text3d": _draw_text3d, "csd": _draw_csd, "cohere": _draw_cohere,
    "acorr": _draw_acorr, "xcorr": _draw_xcorr,
    "angle_spectrum": _spectrum("angle_spectrum"),
    "magnitude_spectrum": _spectrum("magnitude_spectrum"),
    "phase_spectrum": _spectrum("phase_spectrum"),
}


def _apply_view(ax, view: Mapping[str, Any], *, theme, fonts) -> None:
    if hasattr(ax, "get_zlim"):  # 3D 轴：没有 spines，改视角与 pane 颜色
        if view.get("xlim"):
            ax.set_xlim(*[float(v) for v in view["xlim"]])
        if view.get("ylim"):
            ax.set_ylim(*[float(v) for v in view["ylim"]])
        if view.get("zlim"):
            ax.set_zlim(*[float(v) for v in view["zlim"]])
        ax.view_init(elev=float(view.get("elev", 30.0)), azim=float(view.get("azim", -60.0)))
        ax.tick_params(colors=theme["text"], labelsize=float(fonts.get("tick", 11)))
        ax.grid(bool(view.get("grid", True)))
        for axis in (ax.xaxis, ax.yaxis, ax.zaxis):
            axis.pane.set_facecolor(theme["plot"])
            axis.pane.set_edgecolor(theme["grid"])
            axis.label.set_color(theme["text"])
        axis_size = float(fonts.get("axis", 12))
        if view.get("xlabel"):
            ax.set_xlabel(str(view["xlabel"]), color=theme["text"], fontsize=axis_size)
        if view.get("ylabel"):
            ax.set_ylabel(str(view["ylabel"]), color=theme["text"], fontsize=axis_size)
        if view.get("zlabel"):
            ax.set_zlabel(str(view["zlabel"]), color=theme["text"], fontsize=axis_size)
        if view.get("title"):
            ax.set_title(str(view["title"]), color=theme["text"], fontsize=axis_size)
        return
    if view.get("xlim"):
        ax.set_xlim(*[float(v) for v in view["xlim"]])
    if view.get("ylim"):
        ax.set_ylim(*[float(v) for v in view["ylim"]])
    from matplotlib.ticker import FuncFormatter, LogLocator

    if view.get("xscale") == "log":
        ax.set_xscale("log")
    if view.get("yscale") == "log":
        ax.set_yscale("log")
    if view.get("invert_y"):
        ax.invert_yaxis()

    ticks = dict(view.get("ticks") or {})
    mirror = bool(ticks.get("mirror"))
    ax.tick_params(
        axis="both", which="major",
        direction="in" if ticks.get("inside") else "out",
        top=mirror, right=mirror,
        colors=theme["text"], labelsize=float(fonts.get("tick", 11)),
        width=0.9, length=4.0,
    )
    if ticks.get("minor"):
        ax.minorticks_on()
        ax.tick_params(axis="both", which="minor", direction="in", top=mirror, right=mirror,
                       colors=theme["text"], width=0.6, length=2.2)
    else:
        ax.minorticks_off()

    for spine in ("top", "right"):
        ax.spines[spine].set_visible(mirror)
        ax.spines[spine].set_color(theme["text"] if mirror else theme["grid"])
    for spine in ("bottom", "left"):
        ax.spines[spine].set_color(theme["text"] if mirror else theme["grid"])

    if view.get("grid", True):
        ax.grid(True, color=theme["grid"], linewidth=0.6)
    else:
        ax.grid(False)
    if view.get("xlabel"):
        ax.set_xlabel(str(view["xlabel"]), color=theme["text"], fontsize=float(fonts.get("axis", 12)))
    if view.get("ylabel"):
        ax.set_ylabel(str(view["ylabel"]), color=theme["text"], fontsize=float(fonts.get("axis", 12)))
    if view.get("title"):
        ax.set_title(str(view["title"]), color=theme["text"], fontsize=float(fonts.get("axis", 12)))

    mode = str(view.get("loglabels", "sci"))
    plain_axes = {"plain": ("x", "y"), "plain-x": ("x",), "plain-y": ("y",)}.get(mode, ())
    # 论文里更常见的写法：对数轴直接标 2 4 6 8 10，而不是 2×10^0
    for name, axis, scale in (("x", ax.xaxis, view.get("xscale")), ("y", ax.yaxis, view.get("yscale"))):
        if name not in plain_axes or scale != "log":
            continue
        # 对数轴上 2/4/6/8 原本是"次刻度"，论文里恰恰要给它们标数字
        formatter = FuncFormatter(lambda value, _pos: f"{value:g}")
        axis.set_major_locator(LogLocator(base=10.0))
        axis.set_major_formatter(formatter)
        axis.set_minor_locator(LogLocator(base=10.0, subs=(2.0, 4.0, 6.0, 8.0)))
        axis.set_minor_formatter(formatter)
        for tick in list(axis.get_major_ticks()) + list(axis.get_minor_ticks()):
            tick.label1.set_fontsize(float(fonts.get("tick", 11)))



def _draw_decorations(fig, spec, axes: Mapping[int, Any], views: Mapping[int, Mapping[str, Any]],
                      *, theme, fonts) -> None:
    from matplotlib.patches import Rectangle

    for shape in spec.get("figure", {}).get("shapes") or []:
        kind = shape.get("type")
        subplot = int(shape.get("subplot", 0))
        target = axes.get(subplot)
        if target is None:
            continue
        view = views.get(subplot, {})
        color = shape.get("color", "#94a3b8")
        lw = float(shape.get("width", 1.4))
        ls = DASH_MPL.get(shape.get("dash", "solid"), "-")
        if kind == "line":
            target.plot([shape["x0"], shape["x1"]], [shape["y0"], shape["y1"]],
                        color=color, lw=lw, ls=ls, zorder=2, scalex=False, scaley=False)
        elif kind == "rect":
            patch = Rectangle((shape["x0"], shape["y0"]), shape["x1"] - shape["x0"], shape["y1"] - shape["y0"],
                              facecolor=shape.get("fill") or color, alpha=0.15, edgecolor=color, lw=lw, ls=ls)
            target.add_patch(patch)
        elif kind == "arrow":
            target.annotate(
                str(shape.get("text", "")),
                xy=tuple(shape["end"]), xytext=tuple(shape["start"]),
                xycoords="data", textcoords="data",
                color=color, fontsize=float(fonts.get("annotation", 11)),
                arrowprops=dict(arrowstyle="-|>", color=color, lw=lw, shrinkA=2, shrinkB=2),
            )
        elif kind == "triangle":
            x0, y0 = shape.get("anchor", (1.0, 1.0))
            decades = float(shape.get("decades", 1.0))
            slope = float(shape.get("slope", -3.0))
            x1 = _step(x0, str(view.get("xscale", "linear")), decades)
            y1 = _step(y0, str(view.get("yscale", "linear")), slope * decades)
            for a, b in (((x0, y0), (x1, y1)), ((x1, y1), (x1, y0)), ((x0, y0), (x1, y0))):
                target.plot([a[0], b[0]], [a[1], b[1]], color=color, lw=lw, ls=ls, zorder=2,
                            scalex=False, scaley=False)
            if shape.get("text"):
                target.annotate(
                    str(shape["text"]), xy=((x0 + x1) / 2, y0), xycoords="data",
                    textcoords="offset points", xytext=(0, 4), ha="center",
                    color=theme["text"], fontsize=float(fonts.get("annotation", 11)),
                )
        # path（任意 SVG 路径）在 matplotlib 侧没有等价物，静默跳过


def to_figure(
    spec: Mapping[str, Any],
    store: DataStore,
    *,
    dpi: int | None = None,
    pixels: int | None = None,
):
    """构建 matplotlib Figure（调用方负责 savefig / show）。"""
    from matplotlib.figure import Figure
    from matplotlib.backends.backend_agg import FigureCanvasAgg

    fig_cfg = spec.get("figure", {})
    theme = dict(THEMES.get(str(fig_cfg.get("theme", "default")), THEMES["default"]))
    # 允许逐图覆盖底色/文字色：深色版式常常需要比主题更黑一点的画布
    for key, slot in (("facecolor", "paper"), ("axes_facecolor", "plot"),
                      ("textcolor", "text"), ("gridcolor", "grid")):
        if fig_cfg.get(key):
            theme[slot] = str(fig_cfg[key])
    fonts = {**DEFAULT_FONTS, **dict(fig_cfg.get("fonts") or {})}
    size = fig_cfg.get("size", [12.8, 8.4])
    ncols = int(fig_cfg.get("ncols", 1))
    subplots = int(fig_cfg.get("subplots", 1))

    fig = Figure(figsize=(float(size[0]), float(size[1])), dpi=int(dpi or fig_cfg.get("dpi", 100)),
                 constrained_layout=True, facecolor=theme["paper"])
    FigureCanvasAgg(fig)
    fig.patch.set_facecolor(theme["paper"])
    if fig_cfg.get("title"):
        fig.suptitle(str(fig_cfg["title"]), color=theme["text"], fontsize=float(fonts.get("title", 14)))

    # 先分组：同一子图里 2D 与 3D 不能混排（与 MultiPlotter 同规则），
    # 且 3D 槽位要用 projection="3d" 建轴。
    by_subplot: dict[int, list[Mapping[str, Any]]] = {}
    for layer in spec_layers(spec):
        by_subplot.setdefault(int(layer.get("subplot", 0)), []).append(layer)

    slot_is_3d: dict[int, bool] = {}
    for slot, group in by_subplot.items():
        known = reg.known_kind_names()
        dims = {reg.resolve(l["kind"]).dimension for l in group if l.get("kind") in known}
        if 3 in dims and 2 in dims:
            raise ValueError(f"子图 {slot} 里 2D 与 3D 图层不能混排（请拆到不同子图）")
        slot_is_3d[slot] = 3 in dims

    insets = {int(ins.get("subplot", -1)): ins for ins in (fig_cfg.get("insets") or [])}
    grid_slots = [i for i in range(subplots) if i not in insets]
    gcols = max(1, min(ncols, len(grid_slots)))
    grows = max(1, -(-len(grid_slots) // gcols))

    axes: dict[int, Any] = {}
    for index, slot in enumerate(grid_slots):
        kwargs = {"projection": "3d"} if slot_is_3d.get(slot) else {}
        axes[slot] = fig.add_subplot(grows, gcols, index + 1, **kwargs)

    # inset 轴：位置按父轴绘图区的比例给（与 plotly 后端同一套 rect 语义）
    for slot, ins in insets.items():
        if slot_is_3d.get(slot):
            raise ValueError(f"子图 {slot} 是 3D，不能作为内嵌图（inset 只支持 2D）")
        parent = axes.get(int(ins.get("parent", 0)))
        if parent is None:
            continue
        rx, ry, rw, rh = [float(v) for v in ins.get("rect", (0.62, 0.62, 0.35, 0.34))]
        axes[slot] = parent.inset_axes([rx, ry, rw, rh])

    views: dict[int, dict[str, Any]] = {}
    artists: dict[str, list] = {}
    for subplot, group in by_subplot.items():
        ax = axes.get(subplot)
        if ax is None:
            raise ValueError(f"subplot 越界: {subplot}（共 {len(axes)} 个可用槽位）")
        view = group[0].get("view") or {}
        views[subplot] = view
        slot_fonts = {**fonts, **dict((insets.get(subplot) or {}).get("fonts") or {})}
        ax.set_facecolor(theme["plot"])
        _apply_view(ax, view, theme=theme, fonts=slot_fonts)
        # 等比例坐标：轨迹/几何图必须 1:1，否则体育场跑道会被拉成椭圆
        for layer in group:
            aspect = (layer.get("style") or {}).get("aspect")
            if aspect:
                try:
                    # constrained_layout 会无视 adjustable="box" 的收缩，只能靠 datalim 保住 1:1 比例
                    ax.set_aspect(str(aspect), adjustable="datalim")
                except (ValueError, TypeError):
                    pass
                break
        for index, layer in enumerate(group):
            kind = layer.get("kind")
            drawer = DRAWERS.get(kind)
            if drawer is None:
                # 自定义 kind：优先用注册时声明的 builder（PK-R13 register_layer 契约）
                try:
                    custom = reg.resolve(kind)
                except KeyError:
                    custom = None
                drawer = custom.builder if custom is not None else None
            if drawer is None:
                raise ValueError(f"matplotlib 后端暂不支持 kind={kind}（图层 {layer.get('id')}）")
            n_lines, n_colls, n_patches = len(ax.lines), len(ax.collections), len(ax.patches)
            drawer(ax, layer, store, index, pixels=pixels)
            made = (list(ax.lines[n_lines:]) + list(ax.collections[n_colls:])
                    + list(ax.patches[n_patches:]))
            if made and layer.get("id") is not None:
                artists.setdefault(str(layer["id"]), []).extend(made)

    for subplot, ax in axes.items():
        group = by_subplot.get(subplot, [])
        view = views.get(subplot, {})
        for layer in group:
            for ann in layer.get("annotations") or []:
                kind = ann.get("type")
                if kind == "hline":
                    ax.axhline(float(ann["y"]), color=ann.get("color", "#94a3b8"), linestyle=":", linewidth=1.0)
                elif kind == "vline":
                    ax.axvline(float(ann["x"]), color=ann.get("color", "#94a3b8"), linestyle=":", linewidth=1.0)
                elif kind == "band":
                    ax.axhspan(float(ann["from"]), float(ann["to"]),
                               color=ann.get("color", "#94a3b8"), alpha=0.15, linewidth=0)
                elif kind == "text":
                    ax.text(ann.get("x", 0.5), ann.get("y", 0.5), str(ann.get("text", "")),
                            transform=ax.transAxes, color=theme["text"],
                            fontsize=float(fonts.get("annotation", 11)))
        if any(layer.get("legend", True) and layer.get("label") for layer in group):
            handles, labels = ax.get_legend_handles_labels()
            keep = [
                (h, lab) for h, lab in zip(handles, labels)
                if any(layer.get("legend", True) and layer.get("label") == lab for layer in group)
            ]
            legend = ax.legend([h for h, _ in keep], [lab for _, lab in keep],
                               fontsize=float(fonts.get("legend", 11)), frameon=False)
            if legend is not None:
                for text in legend.get_texts():
                    text.set_color(theme["text"])
        # 刻度标签在 set_xscale 之后才刷新，这里补一次颜色
        ax.tick_params(axis="both", which="both", colors=theme["text"])
        for text in ax.get_xticklabels() + ax.get_yticklabels():
            text.set_fontsize(float(fonts.get("tick", 11)))
        _ = view

    _draw_decorations(fig, spec, axes, views, theme=theme, fonts=fonts)
    fig._plotkit_artists = artists
    return fig


def savefig(
    spec: Mapping[str, Any],
    store: DataStore,
    path: str | Path,
    *,
    dpi: int | None = None,
    pixels: int | None = None,
) -> Path:
    """把 spec 存成静态图（PNG/SVG/PDF，按扩展名）。"""
    from matplotlib import rc_context

    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with rc_context({"font.sans-serif": list(FONT_FALLBACK), "axes.unicode_minus": False}):
        figure = to_figure(spec, store, dpi=dpi, pixels=pixels)
        figure.savefig(target, dpi=dpi or int(spec.get("figure", {}).get("dpi", 100)))
    return target


def render_bytes(
    spec: Mapping[str, Any],
    store: DataStore,
    *,
    width: int = 900,
    height: int = 520,
    dpi: int = 100,
    fmt: str = "png",
    xlim: tuple[float, float] | None = None,
    ylim: tuple[float, float] | None = None,
    with_limits: bool = False,
):

    """按**像素尺寸**渲染，返回图片字节（D33：网页呈现的唯一出口）。

    与 `savefig` 的区别：
    - 尺寸以像素给定（交互窗口按容器大小要图），内部换算成英寸；
    - 可临时覆盖视窗 `xlim/ylim`（前端缩放/平移后请求重绘）；
    - 输出固定 metadata，保证同一 spec + 同一视窗两次渲染**逐字节一致**（像素快照可做回归）。
    """
    import copy as _copy
    import io as _io

    from matplotlib import rc_context

    fmt = (fmt or "png").lower()
    if fmt not in ("png", "svg"):
        raise ValueError(f"不支持的格式 {fmt!r}，只支持 png / svg")
    width = max(80, min(4000, int(width)))
    height = max(60, min(4000, int(height)))
    dpi = max(40, min(400, int(dpi)))

    work = _copy.deepcopy(dict(spec))
    fig_cfg = work.setdefault("figure", {})
    fig_cfg["size"] = [width / dpi, height / dpi]
    if xlim or ylim:
        for layer in work.get("layers") or []:
            view = layer.setdefault("view", {})
            if xlim:
                view["xlim"] = [float(xlim[0]), float(xlim[1])]
            if ylim:
                view["ylim"] = [float(ylim[0]), float(ylim[1])]

    from . import livecache

    cache = livecache.get_cache()
    buffer = _io.BytesIO()
    with rc_context({"font.sans-serif": list(FONT_FALLBACK), "axes.unicode_minus": False}):
        entry = cache.lookup(work, width, height, dpi) if fmt == "png" else None
        if entry is not None and cache.update(entry, store, pixels=width,
                                              trange=current_trange()):
            cache.hits += 1
            payload = cache.paint(entry, fmt=fmt, blit=livecache.limits_fixed(work))
            figure = entry.figure
        else:
            # 按像素宽度抽稀（D35）：6×20k 点直接画会到 300–400 ms，抽到 ≤2 点/列后回到百毫秒内
            figure = to_figure(work, store, dpi=dpi, pixels=width)
            if fmt == "png":
                # 与缓存路径共用同一个编码器：不触发 savefig 内部那次整图重绘
                figure.canvas.draw()
                payload = livecache.encode_png(figure.canvas)
                cache.store(work, width, height, dpi, figure, spec_layers(work))
            else:
                figure.savefig(buffer, format=fmt, dpi=dpi, metadata={"Date": None},
                               bbox_inches=None)
                payload = buffer.getvalue()
        limits = None
        if with_limits and figure.axes:
            main = figure.axes[0]
            box = [float(v) for v in main.get_position().bounds]  # x0, y0, w, h（figure 比例）
            inset_slots = {int(i.get("subplot", -1)) for i in (fig_cfg.get("insets") or [])}
            grid_slots = [i for i in range(int(fig_cfg.get("subplots", 1))) if i not in inset_slots]
            slots = []
            for slot, ax in zip(grid_slots, figure.axes):
                slots.append({"slot": int(slot),
                              "box": [round(float(v), 5) for v in ax.get_position().bounds]})
            limits = {"xlim": [float(v) for v in main.get_xlim()],
                      "ylim": [float(v) for v in main.get_ylim()],
                      "box": box,
                      "slots": slots,
                      "px": [int(width), int(height)]}
    return (payload, limits) if with_limits else payload


# ---------------- 注册 v0 三种基础图层（原在 plotly 后端注册，D33 迁移过来） ----------------
reg.register("line", 2, None, defaults={"mode": "lines", "width": 1.6},
             description="折线 / 曲线（时间序列主力）")
reg.register("marker", 2, None, defaults={"mode": "markers"},
             aliases=("scatter", "points"), description="散点")
reg.register("bar", 2, None, defaults={"mode": "bars"}, description="柱状图")
reg.register("segments", 3, None, defaults={"width": 1.2},
             description="多段折线（流线束 / 轨迹束，端点点对）")
reg.register("lic", 2, None, defaults={"steps": 24, "contrast": 1.0},
             description="线积分卷积（稠密矢量场纹理）")
reg.register("volume", 3, None, defaults={"cmap": "magma"},
             description="三维标量场体渲染（pyvista 或浏览器 WebGL）")
reg.register("particles", 3, None,
             defaults={"size": 3.2, "alpha": 0.06, "cmap": "inferno"},
             description="时空点云（浏览器 WebGL 点精灵；c 为逐点标量）")

# ---------------- 注册 P13-01 的四种图层（渲染统一走 mpl，builder 留空） ----------------
reg.register("hist", 2, None, defaults={"bins": 30}, description="直方图（服务端分箱）")
reg.register("pie", 2, None, defaults={"autopct": "%1.1f%%"}, description="饼图")
reg.register("image", 2, None, defaults={"cmap": "viridis", "colorbar": True}, description="图像 / 热图")
reg.register("table", 2, None, defaults={"fontsize": 10}, description="表格")

# ---------------- 注册 P13-02 的场类图层 ----------------
reg.register("heatmap", 2, None, defaults={"cmap": "viridis"}, description="热图（z 或 x/y/z）")
reg.register("contour", 2, None, defaults={"levels": 8}, description="等值线（可 clabel）")
reg.register("contourf", 2, None, defaults={"levels": 8}, description="填充等值线")
reg.register("correlation", 2, None, defaults={"cmap": "RdBu_r", "vmin": -1.0, "vmax": 1.0},
             aliases=("corr", "correlation_matrix"), description="相关系数矩阵（init-only 聚合）")

# ---------------- 注册 P13-03 的矢量场图层 ----------------
reg.register("quiver", 2, None, defaults={"color_by": "magnitude"}, description="矢量箭头图")
reg.register("streamplot", 2, None, defaults={"density": 1.0}, description="流线图（需二维网格）")
reg.register("barbs", 2, None, defaults={"color_by": "magnitude"}, description="风羽图（barbs）")

# ---------------- 注册 P13-04 的 3D 图层 ----------------
reg.register("surface", 3, None, defaults={"cmap": "viridis"}, description="三维曲面")
reg.register("line3d", 3, None, defaults={"width": 1.8}, description="三维折线")
reg.register("scatter3d", 3, None, defaults={"cmap": "viridis"}, description="三维散点")
reg.register("bar3d", 3, None, defaults={"shade": True}, description="三维柱状")
reg.register("hist3d", 3, None, defaults={"bins": 8}, description="三维直方（二维分箱 + 柱）")
reg.register("quiver3d", 3, None, defaults={"length": 0.6}, description="三维矢量箭头")
reg.register("stream3d", 3, None, defaults={"density": 0.6}, description="三维流线（RK2 积分）")

# ---------------- 注册 P13-05 的统计/信号族 ----------------
reg.register("boxplot", 2, None, defaults={"widths": 0.6}, description="箱线图（多列 = 多箱）")
reg.register("violinplot", 2, None, defaults={"widths": 0.8}, description="小提琴图")
reg.register("ecdf", 2, None, defaults={}, description="经验分布函数")
reg.register("hexbin", 2, None, defaults={"gridsize": 20}, description="六边形分箱密度图")
reg.register("barh", 2, None, defaults={"width": 0.8}, description="横向柱状")
reg.register("stackplot", 2, None, defaults={}, description="堆叠面积（多行 = 多条序列）")
reg.register("step", 2, None, defaults={"where": "pre"}, description="阶梯线")
reg.register("stem", 2, None, defaults={}, description="火柴杆图")

# ---------------- 注册 P13-07 的漏项图层 ----------------
reg.register("stairs", 2, None, defaults={}, description="阶梯面积/阶梯线")
reg.register("broken_barh", 2, None, defaults={"row": 1.0, "height": 0.8}, description="分段条形（甘特式）")
reg.register("eventplot", 2, None, defaults={}, description="事件栅格图")
reg.register("bxp", 2, None, defaults={"widths": 0.6}, description="箱线图（由数据算统计量）")
reg.register("psd", 2, None, defaults={"nfft": 256}, description="功率谱密度")
reg.register("specgram", 2, None, defaults={"nfft": 256}, description="时频谱图")

# ---------------- 注册 P13-09 的方法级缺口 ----------------
reg.register("triplot", 2, None, defaults={}, description="三角剖分线")
reg.register("tricontour", 2, None, defaults={"levels": 8}, description="非结构等值线")
reg.register("tricontourf", 2, None, defaults={"levels": 8}, description="非结构填充等值线")
reg.register("tripcolor", 2, None, defaults={}, description="非结构伪彩")
reg.register("voxels", 3, None, defaults={}, description="体素图")
reg.register("trisurf", 3, None, defaults={}, description="三角曲面")
reg.register("stem3d", 3, None, defaults={}, description="三维火柴杆")
reg.register("text3d", 3, None, defaults={}, description="三维文字标注")
reg.register("csd", 2, None, defaults={"nfft": 256}, description="互功率谱密度")
reg.register("cohere", 2, None, defaults={"nfft": 256}, description="相干函数")
reg.register("acorr", 2, None, defaults={}, description="自相关")
reg.register("xcorr", 2, None, defaults={}, description="互相关")
reg.register("angle_spectrum", 2, None, defaults={"nfft": 256}, description="相位谱")
reg.register("magnitude_spectrum", 2, None, defaults={"nfft": 256}, description="幅度谱")
reg.register("phase_spectrum", 2, None, defaults={"nfft": 256}, description="相位谱（unwrap）")
