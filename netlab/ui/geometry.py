"""纯几何：节点尺寸、引脚位置、正交路由、坐标变换与命中测试。

不 import Qt；画布控件与测试共用同一套算法，避免"画一套、测一套"。
路由风格对齐旧前端：默认 ``auto`` 走正交折线，``straight`` 直连，
显式 ``waypoints`` 时按用户拐点走线。
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping, Sequence

from .. import schematic

DEFAULT_RADIUS = 46.0
DEFAULT_W = DEFAULT_RADIUS * 2
DEFAULT_H = DEFAULT_RADIUS * 2

#: 从节点边界伸出的"引线"长度（世界单位）。
STUB = 26.0

_SIDES = ("left", "right", "top", "bottom")


def node_size(raw: Mapping[str, Any]) -> tuple[float, float]:
    size = raw.get("size") or {}
    width = size.get("w") if isinstance(size, Mapping) else None
    height = size.get("h") if isinstance(size, Mapping) else None
    try:
        w = float(width) if width is not None else DEFAULT_W
    except (TypeError, ValueError):
        w = DEFAULT_W
    try:
        h = float(height) if height is not None else w
    except (TypeError, ValueError):
        h = w
    return (max(12.0, w), max(12.0, h))


def pin_specs(kind: str) -> tuple[Mapping[str, Any], ...]:
    try:
        return tuple(schematic.pins_for(kind))
    except Exception:  # pragma: no cover - 未知 kind 时退回四向锚点
        return ()


def _pin_side(spec: Mapping[str, Any]) -> str:
    """没有显式偏移的引脚按角色/绑定落到四条边之一。"""
    role = str(spec.get("role") or "")
    bind = str(spec.get("bind") or "")
    if role == "input":
        return "left"
    if role == "output":
        return "right"
    if role == "power":
        return "bottom"
    if bind in ("source", "secondary_source"):
        return "right"
    if bind in ("target", "secondary_target"):
        return "left"
    return "right"


def pin_points(
    kind: str, x: float, y: float, w: float, h: float
) -> list[tuple[float, float, Mapping[str, Any]]]:
    """返回 ``(世界坐标 x, y, 引脚定义)``；无引脚定义时给四个方向锚点。

    引脚表里 ``dx/dy`` 全为 0 的元件（如运放、晶体管）没有固定偏移，
    这里按角色分到左右下三条边并沿边均匀排布——与旧前端的画法一致。
    """
    specs = pin_specs(kind)
    out: list[tuple[float, float, Mapping[str, Any]]] = []
    if not specs:
        half_w, half_h = w / 2.0, h / 2.0
        for name, px, py in (
            ("left", -half_w, 0.0),
            ("right", half_w, 0.0),
            ("top", 0.0, -half_h),
            ("bottom", 0.0, half_h),
        ):
            out.append((x + px, y + py, {"name": name, "role": "auto", "bind": name}))
        return out

    if any(float(spec.get("dx", 0.0)) or float(spec.get("dy", 0.0)) for spec in specs):
        for spec in specs:
            out.append(
                (
                    x + float(spec.get("dx", 0.0)),
                    y + float(spec.get("dy", 0.0)),
                    spec,
                )
            )
        return out

    # 无偏移：按边分组后均匀分布
    groups: dict[str, list[Mapping[str, Any]]] = {"left": [], "right": [], "top": [], "bottom": []}
    for spec in specs:
        groups[_pin_side(spec)].append(spec)
    half_w, half_h = w / 2.0, h / 2.0
    for side, items in groups.items():
        count = len(items)
        for index, spec in enumerate(items):
            frac = (index + 1) / (count + 1) - 0.5  # -0.5..0.5
            if side == "left":
                out.append((x - half_w, y + frac * h * 0.8, spec))
            elif side == "right":
                out.append((x + half_w, y + frac * h * 0.8, spec))
            elif side == "top":
                out.append((x + frac * w * 0.8, y - half_h, spec))
            else:
                out.append((x + frac * w * 0.8, y + half_h, spec))
    return out


def boundary_point(
    x: float, y: float, w: float, h: float, side: str
) -> tuple[float, float]:
    if side == "left":
        return (x - w / 2.0, y)
    if side == "right":
        return (x + w / 2.0, y)
    if side == "top":
        return (x, y - h / 2.0)
    if side == "bottom":
        return (x, y + h / 2.0)
    return (x, y)


def auto_side(
    sx: float, sy: float, tx: float, ty: float
) -> tuple[str, str]:
    """按两点相对位置选左右/上下，返回 ``(源侧, 目标侧)``。"""
    dx = tx - sx
    dy = ty - sy
    if abs(dx) >= abs(dy):
        return ("right", "left") if dx >= 0 else ("left", "right")
    return ("bottom", "top") if dy >= 0 else ("top", "bottom")


def _normal(side: str) -> tuple[float, float]:
    return {
        "left": (-1.0, 0.0),
        "right": (1.0, 0.0),
        "top": (0.0, -1.0),
        "bottom": (0.0, 1.0),
    }.get(side, (1.0, 0.0))


def route_points(
    source: Any,
    target: Any,
    *,
    route: str = "auto",
    waypoints: Sequence[tuple[float, float]] = (),
    anchors: Mapping[str, str] | None = None,
) -> tuple[tuple[float, float], ...]:
    """计算一条边的世界坐标折线；节点缺失时返回空元组。"""
    if source is None or target is None:
        return ()
    anchors = anchors or {}
    src_side = anchors.get("source") or ""
    dst_side = anchors.get("target") or ""
    if src_side not in _SIDES or dst_side not in _SIDES:
        auto_src, auto_dst = auto_side(source.x, source.y, target.x, target.y)
        src_side = src_side if src_side in _SIDES else auto_src
        dst_side = dst_side if dst_side in _SIDES else auto_dst

    start = boundary_point(source.x, source.y, source.w, source.h, src_side)
    end = boundary_point(target.x, target.y, target.w, target.h, dst_side)

    if waypoints:
        return tuple([start, *[(float(px), float(py)) for px, py in waypoints], end])

    if route == "straight":
        return (start, end)

    # 引线：从边界沿法线伸出 STUB，避免线贴着符号走。
    nx1, ny1 = _normal(src_side)
    nx2, ny2 = _normal(dst_side)
    p1 = (start[0] + nx1 * STUB, start[1] + ny1 * STUB)
    p2 = (end[0] + nx2 * STUB, end[1] + ny2 * STUB)

    horizontal = src_side in ("left", "right") and dst_side in ("left", "right")
    vertical = src_side in ("top", "bottom") and dst_side in ("top", "bottom")

    if horizontal:
        mid_x = (p1[0] + p2[0]) / 2.0
        mid = [(mid_x, p1[1]), (mid_x, p2[1])]
    elif vertical:
        mid_y = (p1[1] + p2[1]) / 2.0
        mid = [(p1[0], mid_y), (p2[0], mid_y)]
    else:
        # 混合方向：走 L 形，先走源法线方向再走目标法线方向。
        mid = [(p2[0], p1[1])] if src_side in ("left", "right") else [(p1[0], p2[1])]

    points: list[tuple[float, float]] = [start, p1, *mid, p2, end]
    return _dedupe(points)


def _dedupe(points: Iterable[tuple[float, float]]) -> tuple[tuple[float, float], ...]:
    out: list[tuple[float, float]] = []
    for point in points:
        px = round(float(point[0]), 3)
        py = round(float(point[1]), 3)
        if out and abs(out[-1][0] - px) < 0.01 and abs(out[-1][1] - py) < 0.01:
            continue
        out.append((px, py))
    return tuple(out)


def snap(value: float, step: float = 20.0) -> float:
    if step <= 0:
        return value
    return round(value / step) * step


class ViewTransform:
    """世界 ↔ 屏幕：``screen = (world + offset) * k``（与旧前端一致）。"""

    __slots__ = ("k", "x", "y")

    def __init__(self, k: float = 1.0, x: float = 0.0, y: float = 0.0) -> None:
        self.k = k
        self.x = x
        self.y = y

    def to_screen(self, wx: float, wy: float) -> tuple[float, float]:
        return ((wx + self.x) * self.k, (wy + self.y) * self.k)

    def to_world(self, sx: float, sy: float) -> tuple[float, float]:
        k = self.k or 1.0
        return (sx / k - self.x, sy / k - self.y)

    def zoom_at(self, sx: float, sy: float, factor: float, *, lo: float = 0.25, hi: float = 4.0) -> None:
        wx, wy = self.to_world(sx, sy)
        new_k = max(lo, min(hi, self.k * factor))
        if abs(new_k - self.k) < 1e-9:
            return
        self.k = new_k
        self.x = sx / self.k - wx
        self.y = sy / self.k - wy

    def copy(self) -> "ViewTransform":
        return ViewTransform(self.k, self.x, self.y)


def fit_transform(
    bounds: tuple[float, float, float, float],
    width: float,
    height: float,
    *,
    margin: float = 60.0,
) -> ViewTransform:
    x0, y0, x1, y1 = bounds
    span_x = max(1.0, x1 - x0)
    span_y = max(1.0, y1 - y0)
    k = min((width - margin * 2) / span_x, (height - margin * 2) / span_y)
    k = max(0.25, min(1.4, k))
    cx = (x0 + x1) / 2.0
    cy = (y0 + y1) / 2.0
    return ViewTransform(k, width / (2.0 * k) - cx, height / (2.0 * k) - cy)


__all__ = [
    "DEFAULT_H",
    "DEFAULT_RADIUS",
    "DEFAULT_W",
    "STUB",
    "ViewTransform",
    "auto_side",
    "boundary_point",
    "fit_transform",
    "node_size",
    "pin_points",
    "pin_specs",
    "route_points",
    "snap",
]
