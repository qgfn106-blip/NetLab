"""spec 数据结构与构造器（spec_version 0.1）。

设计要点（见 docs/DESIGN_v0.md §5）：
- spec 是纯 JSON 可序列化的 dict，字段名即契约；
- 未知字段一律保留（前向兼容），校验只针对已知字段；
- 同一个 spec 可以喂给不同渲染后端（matplotlib 默认、PyVista 可选）。
"""

from __future__ import annotations

import copy
import uuid
from typing import Any, Iterable, Mapping, Sequence

SPEC_VERSION = "0.1"

# 数据角色：决定"能绑到哪种 kind 的哪个参数"。
ROLES = ("auto", "coord", "series", "field", "table", "image")

# 第一版支持的图层类型（docs/DESIGN_v0.md §1 垂直切片）。
V0_KINDS = ("line", "scatter", "bar")

# 误差棒位置：每个都是"数据集名字"，不放数组（D3）。minus 缺省 = 对称。
ERROR_KEYS = ("error_x", "error_y", "error_x_minus", "error_y_minus")

# 字号分级默认值（pub 图要能逐级调，见 D17-B）。
DEFAULT_FONTS: dict[str, float] = {
    "title": 14.0,
    "axis": 12.0,
    "tick": 11.0,
    "legend": 11.0,
    "annotation": 11.0,
}


def new_layer_id() -> str:
    return "l" + uuid.uuid4().hex[:8]


def default_style(kind: str = "line") -> dict[str, Any]:
    style: dict[str, Any] = {
        "mode": "lines" if kind == "line" else "markers",
        "color": None,  # None = 由前端按图层顺序取调色板
        "width": 1.6,
        "dash": "solid",
        "marker": {
            "symbol": "circle",
            "size": 6,
            "opacity": 1.0,
            # marker 描边：pub 图里"彩色填充 + 深色描边"是最常见的画法
            "line": {"color": None, "width": 0.0},
        },
        # 误差棒样式；是否画由 data 里有没有 error_x/error_y 决定
        "error": {"width": None, "thickness": 1.2, "color": None, "opacity": 1.0},
        "fill": None,
        "opacity": 1.0,
    }
    if kind == "bar":
        style["mode"] = "bars"
        style["width"] = 0.8
    return style


def default_view() -> dict[str, Any]:
    return {
        "title": None,
        "xlabel": None,
        "ylabel": None,
        "xlim": None,
        "ylim": None,
        "xscale": "linear",
        "yscale": "linear",
        "grid": True,
        "invert_y": False,
        "zero_line": False,
        # 刻度样式：pub 图默认"朝内 + 四边镜像 + 次刻度"
        "ticks": {"inside": False, "mirror": False, "minor": False},
        # 对数轴刻度标签：sci = 2×10^0，plain = 2（论文更常见）
        "loglabels": "sci",
    }


def new_spec(
    *,
    size: Sequence[float] = (12.8, 8.4),
    dpi: int = 100,
    ncols: int = 1,
    subplots: int = 1,
    theme: str = "default",
    title: str | None = None,
    link_x: bool = False,
    fonts: Mapping[str, float] | None = None,
    window: float | None = None,
) -> dict[str, Any]:
    """新建一份空 spec。"""
    merged_fonts = dict(DEFAULT_FONTS)
    if fonts:
        merged_fonts.update({k: float(v) for k, v in fonts.items()})
    return {
        "spec_version": SPEC_VERSION,
        "figure": {
            "size": [float(size[0]), float(size[1])],
            "dpi": int(dpi),
            "ncols": int(ncols),
            "subplots": int(subplots),
            "theme": theme,
            "title": title,
            "link_x": bool(link_x),
            "window": float(window) if window else None,
            "fonts": merged_fonts,
            "shapes": [],
            "insets": [],
        },
        "layers": [],
    }


def new_inset(
    subplot: int,
    parent: int,
    *,
    rect: Sequence[float] = (0.62, 0.62, 0.35, 0.34),
    fonts: Mapping[str, float] | None = None,
    inset_id: str | None = None,
) -> dict[str, Any]:
    """内嵌子图：`subplot` 这个槽位不再参与网格，而是按 `rect` 摆在 `parent` 槽位内部。

    rect = [x, y, w, h]，单位是**父轴绘图区的比例**（0..1，y 从下往上）——
    这样父轴缩放/换位置时 inset 跟着走，不需要换算像素。
    """
    return {
        "id": inset_id or ("i" + uuid.uuid4().hex[:8]),
        "subplot": int(subplot),
        "parent": int(parent),
        "rect": [float(v) for v in rect],
        "fonts": {k: float(v) for k, v in (fonts or {}).items()},
    }


SHAPE_TYPES = ("line", "rect", "arrow", "triangle", "path")


def new_shape(kind: str, **kwargs: Any) -> dict[str, Any]:
    """图级装饰（斜率为 −3 的参考三角、箭头标注、任意折线/矩形）。

    - `triangle`: 斜率为 `slope` 的直角三角形，锚点 `anchor=[x, y]`、横跨 `decades` 个数量级，
      可在 log 轴上直接给出"幂律斜率"示意；
    - `arrow`: 从 `start=[x, y]` 指向 `end=[x, y]`，可带 `text`。
    """
    if kind not in SHAPE_TYPES:
        raise ValueError(f"未知装饰类型 {kind!r}，可用：{', '.join(SHAPE_TYPES)}")
    shape: dict[str, Any] = {
        "type": kind,
        "xref": "x",
        "yref": "y",
        "subplot": 0,
        "color": "#94a3b8",
        "width": 1.4,
        "dash": "solid",
        "fill": None,
    }
    shape.update(kwargs)
    return shape


def new_layer(
    kind: str,
    *,
    subplot: int = 0,
    data: Mapping[str, str] | None = None,
    label: str | None = None,
    legend: bool = True,
    style: Mapping[str, Any] | None = None,
    view: Mapping[str, Any] | None = None,
    annotations: Iterable[Mapping[str, Any]] | None = None,
    layer_id: str | None = None,
) -> dict[str, Any]:
    """新建一层。`data` 里只放数据集**名字**，不放数组（D3 延迟绑定）。"""
    merged_style = default_style(kind)
    if style:
        for key, value in style.items():
            if key == "marker" and isinstance(value, Mapping):
                merged_style["marker"].update(value)
            else:
                merged_style[key] = value
    merged_view = default_view()
    if view:
        merged_view.update(view)
    return {
        "id": layer_id or new_layer_id(),
        "kind": kind,
        "subplot": int(subplot),
        "data": dict(data or {}),
        "label": label,
        "legend": bool(legend),
        "style": merged_style,
        "view": merged_view,
        "annotations": [dict(a) for a in (annotations or [])],
    }


def figure(spec: Mapping[str, Any]) -> dict[str, Any]:
    return spec["figure"]  # type: ignore[return-value]


def layers(spec: Mapping[str, Any]) -> list[dict[str, Any]]:
    return spec["layers"]  # type: ignore[return-value]


def layer_by_id(spec: Mapping[str, Any], layer_id: str) -> dict[str, Any]:
    for layer in layers(spec):
        if layer.get("id") == layer_id:
            return layer
    raise KeyError(f"图层不存在: {layer_id}")


def nrows(ncols: int, subplots: int) -> int:
    ncols = max(1, int(ncols))
    return max(1, -(-int(subplots) // ncols))


def subplot_xy(subplot: int, ncols: int) -> tuple[int, int]:
    """0 基槽位 → (row, col)，按行优先（与 MultiPlotter 的 row-major 一致）。"""
    ncols = max(1, int(ncols))
    return int(subplot) // ncols, int(subplot) % ncols


def deepcopy(spec: Mapping[str, Any]) -> dict[str, Any]:
    return copy.deepcopy(dict(spec))
