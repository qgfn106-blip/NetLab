"""画布渲染：立即模式 QPainter，一次 paintEvent 画完。

对应旧前端的 ``drawGraph``：网格点 → 连线 → 节点 → 覆盖层。
所有坐标都经过 :class:`~netlab.ui.geometry.ViewTransform`，与旧前端
``screen = (world + offset) * k`` 完全一致（spec C3/C13）。
"""

from __future__ import annotations

import math
from typing import Iterable, Mapping, Sequence

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import (
    QColor,
    QFont,
    QFontMetricsF,
    QPainter,
    QPainterPath,
    QPen,
    QPolygonF,
)

from ..geometry import ViewTransform
from ..models import EdgeVM, NodeVM, SceneVM
from ..theme import FONT_FAMILY, qcolor

SELECT = "#a8541f"
HOVER = "#7a4a2a"

#: 以下常量逐条对齐原 web 前端（app.js:2074-2110 / 2495-2614），保证像素 diff 与观感一致。
RING_NORMAL = "#cfc6b5"
RING_HOVER = "#8e8477"
NODE_SELECTED = "#a8541f"
NODE_STROKE_IDLE = "#bcb3a1"
NODE_FILL = "#faf8f2"
NODE_FILL_SEL = "#f7ecdf"
EDGE_NORMAL = "#a49a89"
EDGE_HOVER = "#5f584e"
EDGE_DISABLED = "#d3ccbc"
EDGE_DELAY = "#b0762a"
FLOW_PERIOD = 1.6  # 秒：web 用 1600ms 一周
FLOW_RADIUS = 1.35
FLOW_RADIUS_SELECTED = 2.0
FLOW_MAX_EDGES = 220

#: 有专属符号的元件（电路模式的 ``params.element``，或独立 kind）。
GLYPHS = {
    "resistor",
    "capacitor",
    "inductor",
    "vsource",
    "isource",
    "ground",
    "diode",
    "opamp",
    "switch",
    "transformer",
    "lamp",
    "led",
}


def _color(value: str, alpha: int = 255) -> QColor:
    return qcolor(value, alpha if alpha < 255 else None)


def draw_grid(
    painter: QPainter,
    view: ViewTransform,
    size: tuple[int, int],
    tokens: Mapping[str, str],
    *,
    step_world: float = 20.0,
    show: bool = True,
) -> None:
    width, height = size
    painter.fillRect(0, 0, width, height, _color(tokens["canvas_bg"]))
    if not show:
        return
    step = step_world * view.k
    while step < 12:
        step *= 2
    while step > 84:
        step /= 2
    ox = ((view.x * view.k) % step + step) % step
    oy = ((view.y * view.k) % step + step) % step
    painter.setPen(Qt.NoPen)
    painter.setBrush(_color(tokens["grid_dot"]))
    x = ox
    while x < width:
        y = oy
        while y < height:
            painter.drawRect(QRectF(round(x), round(y), 1.0, 1.0))
            y += step
        x += step
    origin_x = view.x * view.k
    origin_y = view.y * view.k
    painter.setPen(QPen(_color(tokens["grid_axis"]), 1))
    if 0 < origin_x < width:
        painter.drawLine(
            QPointF(round(origin_x) + 0.5, 0), QPointF(round(origin_x) + 0.5, height)
        )
    if 0 < origin_y < height:
        painter.drawLine(
            QPointF(0, round(origin_y) + 0.5), QPointF(width, round(origin_y) + 0.5)
        )


def edge_color(edge: EdgeVM, selected: bool, hovered: bool, tokens: Mapping[str, str]) -> str:
    if selected:
        return NODE_SELECTED
    if hovered:
        return EDGE_HOVER
    if not edge.enabled:
        return EDGE_DISABLED
    if edge.delay:
        return EDGE_DELAY
    return EDGE_NORMAL


def _segment_hit(
    a: tuple[float, float],
    b: tuple[float, float],
    c: tuple[float, float],
    d: tuple[float, float],
) -> tuple[float, float] | None:
    """两线段是否在内部相交（端点附近忽略，避免相邻连线误判）。"""
    rx, ry = b[0] - a[0], b[1] - a[1]
    sx, sy = d[0] - c[0], d[1] - c[1]
    denom = rx * sy - ry * sx
    if abs(denom) < 1e-9:
        return None
    qx, qy = c[0] - a[0], c[1] - a[1]
    t = (qx * sy - qy * sx) / denom
    u = (qx * ry - qy * rx) / denom
    if t <= 0.02 or t >= 0.98 or u <= 0.02 or u >= 0.98:
        return None
    return (a[0] + rx * t, a[1] + ry * t)


def crossing_map(scene: SceneVM, view: ViewTransform, limit: int = 160) -> dict[str, list[tuple[float, float]]]:
    """电路模式下，后画的连线在交叉点画一个"跨线"半圆（旧前端同款）。"""
    result: dict[str, list[tuple[float, float]]] = {}
    if scene.mode != "circuit" or len(scene.edges) > limit:
        return result
    paths = [(edge.id, edge.points) for edge in scene.edges if len(edge.points) > 1]
    for index, (first_id, first) in enumerate(paths):
        for second_id, second in paths[index + 1 :]:
            for a in range(1, len(first)):
                for b in range(1, len(second)):
                    hit = _segment_hit(first[a - 1], first[a], second[b - 1], second[b])
                    if hit is not None:
                        result.setdefault(second_id, []).append(view.to_screen(*hit))
    return result


def draw_crossing_hops(
    painter: QPainter,
    points: Sequence[tuple[float, float]],
    color: QColor,
    tokens: Mapping[str, str],
) -> None:
    for x, y in points:
        painter.setPen(Qt.NoPen)
        painter.setBrush(_color(tokens["canvas_bg"]))
        painter.drawEllipse(QPointF(x, y), 4.0, 4.0)
        painter.setPen(QPen(color, 1.1))
        painter.setBrush(Qt.NoBrush)
        painter.drawArc(QRectF(x - 4.2, y - 4.2, 8.4, 8.4), 105 * 16, 140 * 16)


def draw_edges(
    painter: QPainter,
    scene: SceneVM,
    view: ViewTransform,
    tokens: Mapping[str, str],
    *,
    selected: Iterable[str] = (),
    hovered: str | None = None,
    phase: float = 0.0,
    running: bool = False,
    hover_alpha: float = 0.0,
) -> None:
    selected = set(selected)
    hops = crossing_map(scene, view)
    for edge in scene.edges:
        if len(edge.points) < 2:
            continue
        is_sel = edge.id in selected
        is_hov = edge.id == hovered
        color = _color(edge_color(edge, is_sel, is_hov, tokens))
        # 线宽对齐 web：常态 1.15 / 悬停 1.7 / 选中 2.1
        if is_sel:
            width = 2.1
        elif is_hov:
            width = 1.7
        else:
            width = 1.15
        pen = QPen(color, width)
        pen.setCapStyle(Qt.RoundCap)
        pen.setJoinStyle(Qt.RoundJoin)
        if not edge.enabled:
            pen.setStyle(Qt.CustomDashLine)
            pen.setDashPattern([3, 5])
        elif edge.delay:
            pen.setStyle(Qt.CustomDashLine)
            pen.setDashPattern([7, 5])

        painter.setPen(pen)
        painter.setBrush(Qt.NoBrush)
        path = QPainterPath()
        path.moveTo(*view.to_screen(*edge.points[0]))
        for point in edge.points[1:]:
            path.lineTo(*view.to_screen(*point))
        painter.drawPath(path)
        if edge.id in hops:
            draw_crossing_hops(painter, hops[edge.id], color, tokens)
        if running and edge.enabled and (is_sel or len(scene.edges) <= FLOW_MAX_EDGES):
            _draw_flow(painter, view, edge, tokens, phase, selected=is_sel)
        _draw_arrow(painter, view, edge.points[-2], edge.points[-1], color)


def _flow_position(points: Sequence[tuple[float, float]], frac: float) -> tuple[float, float]:
    """按屏幕折线的累计长度取点：0 = 起点，1 = 终点。"""
    lengths: list[float] = []
    total = 0.0
    for index in range(1, len(points)):
        seg = math.dist(points[index - 1], points[index])
        lengths.append(seg)
        total += seg
    if total <= 1e-6:
        return points[0]
    target = max(0.0, min(1.0, frac)) * total
    acc = 0.0
    for index, seg in enumerate(lengths):
        if acc + seg >= target:
            t = (target - acc) / seg if seg > 1e-6 else 0.0
            ax, ay = points[index]
            bx, by = points[index + 1]
            return (ax + (bx - ax) * t, ay + (by - ay) * t)
        acc += seg
    return points[-1]


def _draw_flow(
    painter: QPainter,
    view: ViewTransform,
    edge: EdgeVM,
    tokens: Mapping[str, str],
    phase: float,
    *,
    selected: bool = False,
) -> None:
    """连线上流动的光点：周期 1600ms、每边 2 个、逐边 hash 错相（web app.js:2214-2226）。

    延迟边用琥珀色 ``rgba(176,118,42,.8)``，其余 ``rgba(168,84,31,.7)``；半径 1.35（选中 2.0）。
    """
    screen = [view.to_screen(*point) for point in edge.points]
    seed = (sum(ord(char) for char in edge.id) % 997) / 997.0
    color = QColor(176, 118, 42) if edge.delay else QColor(168, 84, 31)
    radius = FLOW_RADIUS_SELECTED if selected else FLOW_RADIUS
    painter.setPen(Qt.NoPen)
    for index in range(2):
        frac = (phase / FLOW_PERIOD + seed + index * 0.5) % 1.0
        x, y = _flow_position(screen, frac)
        painter.setBrush(QColor(color.red(), color.green(), color.blue(), 178 if not edge.delay else 204))
        painter.drawEllipse(QPointF(x, y), radius, radius)


def _draw_arrow(
    painter: QPainter,
    view: ViewTransform,
    prev: tuple[float, float],
    tip: tuple[float, float],
    color: QColor,
) -> None:
    sx, sy = view.to_screen(*prev)
    tx, ty = view.to_screen(*tip)
    angle = math.atan2(ty - sy, tx - sx)
    size = 9.0
    painter.setPen(Qt.NoPen)
    painter.setBrush(color)
    painter.drawPolygon(
        QPolygonF(
            [
                QPointF(tx, ty),
                QPointF(tx - size * math.cos(angle - 0.42), ty - size * math.sin(angle - 0.42)),
                QPointF(tx - size * math.cos(angle + 0.42), ty - size * math.sin(angle + 0.42)),
            ]
        )
    )


def node_rect(node: NodeVM, view: ViewTransform) -> QRectF:
    cx, cy = view.to_screen(node.x, node.y)
    w = node.w * view.k
    h = node.h * view.k
    return QRectF(cx - w / 2.0, cy - h / 2.0, w, h)


def label_font(view: ViewTransform) -> QFont:
    """节点名：700 粗体，尺寸 clamp(12.5k, 6.5, 17)（web app.js:2551）。"""
    font = QFont(FONT_FAMILY)
    font.setPixelSize(max(7, int(round(min(17.0, max(6.5, 12.5 * view.k))))))
    font.setBold(True)
    return font


def kind_font(view: ViewTransform) -> QFont:
    """节点类别：600 mono，尺寸 clamp(7.5k, 5, 11)（web app.js:2547）。"""
    font = QFont("Cascadia Code", -1)
    font.setStyleHint(QFont.Monospace)
    font.setPixelSize(max(5, int(round(min(11.0, max(5.0, 7.5 * view.k))))))
    font.setBold(True)
    return font


def _place_label(
    rect: QRectF,
    is_glyph: bool,
    width: float,
    height: float,
    occupied: Sequence[QRectF],
) -> QRectF:
    """标签避让：符号下方 → 上方 → 右侧 → 左侧 → 更下方 → 更上方。"""
    cx, cy = rect.center().x(), rect.center().y()
    if not is_glyph and width <= rect.width() - 6 and height <= rect.height() - 6:
        return QRectF(cx - width / 2, cy - height / 2, width, height)
    gap = 3.0
    candidates = [
        QRectF(cx - width / 2, rect.bottom() + gap, width, height),
        QRectF(cx - width / 2, rect.top() - height - gap, width, height),
        QRectF(rect.right() + gap, cy - height / 2, width, height),
        QRectF(rect.left() - width - gap, cy - height / 2, width, height),
        QRectF(cx - width / 2, rect.bottom() + gap * 2 + height, width, height),
        QRectF(cx - width / 2, rect.top() - height * 2 - gap * 2, width, height),
    ]
    for candidate in candidates:
        if not any(candidate.intersects(area) for area in occupied):
            return candidate
    return candidates[0]


def draw_nodes(
    painter: QPainter,
    scene: SceneVM,
    view: ViewTransform,
    tokens: Mapping[str, str],
    *,
    selected: Iterable[str] = (),
    hovered: str | None = None,
    pulse: float = 0.0,
    hover_alpha: float = 0.0,
) -> None:
    selected = set(selected)
    occupied: list[QRectF] = [node_rect(node, view) for node in scene.nodes]
    font = label_font(view)
    metrics = QFontMetricsF(font)
    pending: list[tuple[QRectF, str, bool]] = []

    for node in scene.nodes:
        rect = node_rect(node, view)
        glyph = node_glyph(node)
        is_glyph = glyph in GLYPHS and rect.width() >= 34 and rect.height() >= 34
        draw_node(
            painter,
            node,
            view,
            tokens,
            selected=node.id in selected,
            hovered=node.id == hovered,
            pulse=pulse,
            hover_alpha=hover_alpha,
        )
        if rect.width() < 26 or rect.height() < 20:
            continue
        if not is_glyph and abs(node.w - node.h) < 0.5 and rect.width() >= 56:
            # 圆形节点：名字 + 类别画在圆内（对齐 web app.js:2547-2562）
            name_f = label_font(view)
            name_m = QFontMetricsF(name_f)
            name_h = name_m.height()
            painter.setFont(name_f)
            painter.setPen(_color(tokens["ink"]))
            nm = name_m.elidedText(node.name, Qt.ElideRight, rect.width() - 14)
            painter.drawText(
                QRectF(rect.left() + 4, rect.center().y() - name_h * 0.92, rect.width() - 8, name_h),
                Qt.AlignHCenter | Qt.AlignVCenter,
                nm,
            )
            k_f = kind_font(view)
            k_m = QFontMetricsF(k_f)
            painter.setFont(k_f)
            painter.setPen(_color(tokens["muted"]))
            painter.drawText(
                QRectF(rect.left() + 4, rect.center().y() + name_h * 0.08, rect.width() - 8, k_m.height()),
                Qt.AlignHCenter | Qt.AlignVCenter,
                node.kind,
            )
            continue
        limit = max(24.0, rect.width() * (1.6 if is_glyph else 1.0) - 4)
        text = metrics.elidedText(node.name, Qt.ElideRight, limit)
        width = min(limit, metrics.horizontalAdvance(text) + 8)
        height = metrics.height() + 2
        box = _place_label(rect, is_glyph, width, height, occupied)
        occupied.append(box)
        pending.append((box, text, is_glyph))

    painter.setFont(font)
    painter.setPen(_color(tokens["ink"]))
    for box, text, is_glyph in pending:
        painter.drawText(box, Qt.AlignCenter, text)


def node_glyph(node: NodeVM) -> str:
    """节点该画哪个符号：独立 kind 优先，其次 ``params.element``。"""
    if node.kind in GLYPHS:
        return node.kind
    element = node.params.get("element") if isinstance(node.params, Mapping) else None
    return str(element or "")


def draw_node(
    painter: QPainter,
    node: NodeVM,
    view: ViewTransform,
    tokens: Mapping[str, str],
    *,
    selected: bool = False,
    hovered: bool = False,
    pulse: float = 0.0,
    hover_alpha: float = 0.0,
) -> None:
    """单个节点：外圈三层状态 + 主体 + 类型弧线 + 引脚（对齐 web app.js:2495-2614）。

    外圈不脉动（原前端没有 breathing/pulse，``pulse`` 参数仅为兼容保留）。
    """
    cx, cy = view.to_screen(node.x, node.y)
    w = node.w * view.k
    h = node.h * view.k
    rect = QRectF(cx - w / 2.0, cy - h / 2.0, w, h)
    circular = abs(node.w - node.h) < 0.5
    glyph = node_glyph(node)
    has_glyph = glyph in GLYPHS and w >= 34 and h >= 34

    # 1) 外圈：选中 #a8541f 1.6 实线 / 悬停 #8e8477 1 实线 / 常态 #cfc6b5 1 虚线[2,4]
    if selected:
        ring_color, ring_width, ring_dash = QColor(NODE_SELECTED), 1.6, None
    elif hovered:
        ring_color, ring_width, ring_dash = QColor(RING_HOVER), 1.0, None
    else:
        ring_color, ring_width, ring_dash = QColor(RING_NORMAL), 1.0, [2, 4]
    if w >= 16 and h >= 16:
        ring = QPen(ring_color, ring_width)
        if ring_dash:
            ring.setStyle(Qt.CustomDashLine)
            ring.setDashPattern(ring_dash)
        painter.setPen(ring)
        painter.setBrush(Qt.NoBrush)
        pad = 5.0
        if circular and not has_glyph:
            painter.drawEllipse(rect.adjusted(-pad, -pad, pad, pad))
        else:
            painter.drawRoundedRect(rect.adjusted(-pad, -pad, pad, pad), 8, 8)

    stroke = QColor(NODE_SELECTED) if selected else QColor(NODE_STROKE_IDLE)

    if has_glyph:
        side = min(w, h) * 0.66
        box = QRectF(cx - side / 2.0, cy - side / 2.0, side, side)
        _draw_glyph(painter, glyph, box, stroke)
    else:
        painter.setPen(QPen(stroke, 1.5 if selected else 1.0))
        painter.setBrush(QColor(NODE_FILL_SEL if selected else NODE_FILL))
        if circular:
            painter.drawEllipse(rect)
        else:
            painter.drawRoundedRect(rect, 6, 6)
        # 顶部类型弧线（web app.js:2511-2517）
        if circular and w >= 20:
            arc_pen = QPen(_color(tokens.get("accent", "#9b7247")))
            arc_pen.setWidthF(max(1.2, min(3.5, 2.4 * view.k)))
            arc_pen.setCapStyle(Qt.RoundCap)
            painter.setPen(arc_pen)
            painter.setBrush(Qt.NoBrush)
            radius = w / 2.0 - 2.5 * view.k
            if radius > 2:
                arc_rect = QRectF(cx - radius, cy - radius, radius * 2, radius * 2)
                painter.drawArc(arc_rect, int(180 * 16), int(-100 * 16))

    if selected:
        # 四角刻度（web app.js:2601-2612）：四方向各 6px 短线
        tick = 6.0
        d = max(w, h) / 2.0 + 7.0
        painter.setPen(QPen(QColor(NODE_SELECTED), 1.0))
        painter.setBrush(Qt.NoBrush)
        for dx, dy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
            painter.drawLine(
                QPointF(cx + dx * d, cy + dy * d),
                QPointF(cx + dx * (d + tick), cy + dy * (d + tick)),
            )

    # 引脚点：半径 clamp(3.4k, 2, 5)
    painter.setPen(QPen(_color(tokens["line_strong"]), 1.2))
    painter.setBrush(_color(tokens["node_fill"]))
    pin_radius = max(2.0, min(5.0, 3.4 * view.k))
    for pin in node.pins:
        px, py = view.to_screen(pin.x, pin.y)
        painter.drawEllipse(QPointF(px, py), pin_radius, pin_radius)


def _draw_glyph(painter: QPainter, kind: str, box: QRectF, color: QColor) -> None:
    """在 ``box`` 内画 GB 风格元件符号（归一化坐标，随缩放一起变）。"""
    painter.save()
    painter.setPen(QPen(color, 1.6))
    painter.setBrush(Qt.NoBrush)
    cx, cy = box.center().x(), box.center().y()
    half = min(box.width(), box.height()) / 2.0
    side = half * 2.0

    def pt(fx: float, fy: float) -> QPointF:
        return QPointF(cx + fx * half, cy + fy * half)

    if kind == "resistor":
        path = QPainterPath(pt(-1.0, 0.0))
        for index in range(6):
            path.lineTo(pt(-0.62 + index * 0.208, 0.3 if index % 2 == 0 else -0.3))
        path.lineTo(pt(1.0, 0.0))
        painter.drawPath(path)
    elif kind == "capacitor":
        painter.drawLine(pt(-0.16, -0.62), pt(-0.16, 0.62))
        painter.drawLine(pt(0.16, -0.62), pt(0.16, 0.62))
        painter.drawLine(pt(-1.0, 0.0), pt(-0.16, 0.0))
        painter.drawLine(pt(0.16, 0.0), pt(1.0, 0.0))
    elif kind == "inductor":
        radius = side / 6.0
        for index in range(3):
            left = cx - radius * 3 + index * radius * 2
            painter.drawArc(QRectF(left, cy - radius, radius * 2, radius * 2), 0, 180 * 16)
    elif kind in ("vsource", "isource", "lamp", "led"):
        radius = half * 0.8
        painter.drawEllipse(QPointF(cx, cy), radius, radius)
        if kind == "vsource":
            painter.drawLine(pt(-0.3, 0.0), pt(0.3, 0.0))
            painter.drawLine(pt(0.0, -0.3), pt(0.0, 0.3))
        elif kind == "isource":
            painter.drawLine(pt(-0.34, 0.0), pt(0.34, 0.0))
            painter.drawLine(pt(0.34, 0.0), pt(0.04, -0.2))
            painter.drawLine(pt(0.34, 0.0), pt(0.04, 0.2))
        else:
            painter.drawLine(pt(-0.26, -0.26), pt(0.26, 0.26))
            painter.drawLine(pt(-0.26, 0.26), pt(0.26, -0.26))
    elif kind == "ground":
        painter.drawLine(pt(0.0, -1.0), pt(0.0, -0.1))
        for index, width in enumerate((0.85, 0.52, 0.2)):
            y = -0.1 + index * 0.3
            painter.drawLine(pt(-width, y), pt(width, y))
    elif kind == "diode":
        painter.drawPolygon(QPolygonF([pt(-0.42, -0.46), pt(-0.42, 0.46), pt(0.34, 0.0)]))
        painter.drawLine(pt(0.34, -0.5), pt(0.34, 0.5))
        painter.drawLine(pt(-1.0, 0.0), pt(-0.42, 0.0))
        painter.drawLine(pt(0.34, 0.0), pt(1.0, 0.0))
    elif kind == "opamp":
        painter.drawPolygon(QPolygonF([pt(-0.55, -0.72), pt(-0.55, 0.72), pt(0.72, 0.0)]))
        painter.drawLine(pt(-1.0, -0.32), pt(-0.55, -0.32))
        painter.drawLine(pt(-1.0, 0.32), pt(-0.55, 0.32))
        painter.drawLine(pt(0.72, 0.0), pt(1.0, 0.0))
    elif kind == "switch":
        painter.drawLine(pt(-1.0, 0.0), pt(-0.24, 0.0))
        painter.drawLine(pt(0.24, 0.0), pt(1.0, 0.0))
        painter.drawLine(pt(-0.24, 0.0), pt(0.3, -0.46))
        painter.drawEllipse(pt(-0.24, 0.0), 2.2, 2.2)
        painter.drawEllipse(pt(0.24, 0.0), 2.2, 2.2)
    elif kind == "transformer":
        # 两组竖向绕组相对，中间两道铁芯线。
        radius = side / 9.0
        for index in range(3):
            top = cy - radius * 3.0 + index * radius * 2.0
            painter.drawArc(
                QRectF(cx - radius * 3.4, top, radius * 1.7, radius * 2.0), 90 * 16, 180 * 16
            )
            painter.drawArc(
                QRectF(cx + radius * 1.7, top, radius * 1.7, radius * 2.0), 270 * 16, 180 * 16
            )
        painter.drawLine(pt(-0.12, -0.85), pt(-0.12, 0.85))
        painter.drawLine(pt(0.12, -0.85), pt(0.12, 0.85))
    else:
        painter.drawRect(QRectF(cx - half * 0.72, cy - half * 0.72, half * 1.44, half * 1.44))
    painter.restore()


def draw_selection_box(
    painter: QPainter,
    rect: QRectF,
    tokens: Mapping[str, str],
) -> None:
    pen = QPen(QColor(168, 84, 31, 166), 1.0)
    pen.setStyle(Qt.CustomDashLine)
    pen.setDashPattern([4, 3])
    painter.setPen(pen)
    painter.setBrush(QColor(168, 84, 31, 20))
    painter.drawRect(rect)


def draw_snap_marker(
    painter: QPainter,
    point: tuple[float, float],
    view: ViewTransform,
) -> None:
    """拖动时的吸附十字（web app.js:1481-1510）：7px 十字，rgba(168,84,31,.85)，1.2px。"""
    x, y = view.to_screen(*point)
    pen = QPen(QColor(168, 84, 31, 217), 1.2)
    painter.setPen(pen)
    painter.setBrush(Qt.NoBrush)
    painter.drawLine(QPointF(x - 3.5, y), QPointF(x + 3.5, y))
    painter.drawLine(QPointF(x, y - 3.5), QPointF(x, y + 3.5))


def draw_link_preview(
    painter: QPainter,
    start: tuple[float, float],
    end: tuple[float, float],
    tokens: Mapping[str, str],
) -> None:
    painter.setPen(QPen(_color(tokens["accent"]), 1.6, Qt.DashLine))
    painter.setBrush(Qt.NoBrush)
    painter.drawLine(QPointF(*start), QPointF(*end))


def draw_hud(
    painter: QPainter,
    text: str,
    tokens: Mapping[str, str],
    *,
    at: tuple[float, float] = (12.0, 12.0),
) -> None:
    font = QFont(FONT_FAMILY, 9)
    painter.setFont(font)
    metrics = QFontMetricsF(font)
    width = metrics.horizontalAdvance(text) + 16
    height = metrics.height() + 8
    rect = QRectF(at[0], at[1], width, height)
    painter.setPen(QPen(_color(tokens["line"]), 1))
    painter.setBrush(_color(tokens["panel_bg"]))
    painter.drawRoundedRect(rect, 4, 4)
    painter.setPen(_color(tokens["muted"]))
    painter.drawText(rect, Qt.AlignCenter, text)


def draw_waypoints(
    painter: QPainter,
    points: Sequence[tuple[float, float]],
    view: ViewTransform,
    tokens: Mapping[str, str],
) -> None:
    painter.setPen(QPen(_color(tokens["accent"]), 1.2))
    painter.setBrush(_color(tokens["paper"]))
    for x, y in points:
        sx, sy = view.to_screen(x, y)
        painter.drawEllipse(QPointF(sx, sy), 3.4, 3.4)


__all__ = [
    "GLYPHS",
    "draw_edges",
    "draw_grid",
    "draw_hud",
    "draw_link_preview",
    "draw_node",
    "draw_nodes",
    "draw_selection_box",
    "draw_waypoints",
    "edge_color",
    "node_glyph",
]
