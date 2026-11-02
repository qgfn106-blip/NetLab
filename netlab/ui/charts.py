"""五个原生图表：时域、相图、示波器、李萨如、有限元。

全部是立即模式 QPainter，数据来自 :class:`LiveVM`（求解线程产出的快照），
绘图本身不做任何计算，只做坐标映射（spec C4）。
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import QColor, QFont, QImage, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import QWidget

from . import motion
from .models import LiveVM
from .theme import FONT_FAMILY, qcolor, tokens

PALETTE = [
    "#a8541f", "#1f5f5b", "#2a2621", "#7b8c3a", "#8a4a7c",
    "#b08a3e", "#4a6f8a", "#8e2f24", "#5f6b52", "#7a4a2a",
]

MARGIN_L = 48.0
MARGIN_R = 14.0
MARGIN_T = 30.0
MARGIN_B = 28.0


class PlotBase(QWidget):
    """坐标框 + 刻度 + 网格；子类只实现 ``draw_series``。"""

    def __init__(self, title: str = "", parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._tokens = tokens("light")
        self.title = title
        self._x_range = (0.0, 1.0)
        self._y_range = (0.0, 1.0)
        self._mouse: QPointF | None = None
        # 首次显示时整体淡入；悬停竖线也跟着淡入，避免鼠标划过时闪一下
        self._reveal = motion.Ramp(self, step_ms=16, speed=0.24)
        self._cursor = motion.Ramp(self, step_ms=16, speed=0.3)
        self.setMinimumHeight(120)
        self.setAutoFillBackground(False)
        self.setMouseTracking(True)

    def set_tokens(self, tokens_map: dict[str, str]) -> None:
        self._tokens = tokens_map
        self.update()

    # ---- 映射 -------------------------------------------------------------
    def plot_rect(self) -> QRectF:
        return QRectF(
            MARGIN_L,
            MARGIN_T,
            max(1.0, self.width() - MARGIN_L - MARGIN_R),
            max(1.0, self.height() - MARGIN_T - MARGIN_B),
        )

    def map_point(self, x: float, y: float) -> QPointF:
        rect = self.plot_rect()
        x0, x1 = self._x_range
        y0, y1 = self._y_range
        sx = rect.left() + (x - x0) / (x1 - x0 or 1.0) * rect.width()
        sy = rect.bottom() - (y - y0) / (y1 - y0 or 1.0) * rect.height()
        return QPointF(sx, sy)

    def set_ranges(self, x: tuple[float, float], y: tuple[float, float]) -> None:
        self._x_range = x
        self._y_range = y

    def unmap_x(self, px: float) -> float:
        rect = self.plot_rect()
        x0, x1 = self._x_range
        frac = (px - rect.left()) / (rect.width() or 1.0)
        return x0 + (x1 - x0) * frac

    def unmap_y(self, py: float) -> float:
        rect = self.plot_rect()
        y0, y1 = self._y_range
        frac = (rect.bottom() - py) / (rect.height() or 1.0)
        return y0 + (y1 - y0) * frac

    # ---- 悬停读数（A8） ---------------------------------------------------
    def showEvent(self, event) -> None:  # noqa: N802
        super().showEvent(event)
        if self._reveal.value < 0.02:
            self._reveal.to(1.0)

    def mouseMoveEvent(self, event) -> None:  # noqa: N802
        self._mouse = event.position()
        self._cursor.to(1.0)
        self.update()
        super().mouseMoveEvent(event)

    def leaveEvent(self, event) -> None:  # noqa: N802
        self._mouse = None
        self._cursor.to(0.0)
        self.update()
        super().leaveEvent(event)

    def x_tick_label(self, value: float) -> str:
        return _fmt(value)

    def hover_text(self, x: float) -> str:
        return f"x = {_fmt(x)}"

    def _draw_cursor(self, painter: QPainter, rect: QRectF) -> None:
        point = self._mouse
        if point is None or not rect.contains(point):
            return
        alpha = self._cursor.value
        if alpha <= 0.02:
            return
        painter.save()
        painter.setOpacity(alpha)
        painter.setPen(QPen(qcolor(self._tokens["muted"]), 1, Qt.DashLine))
        painter.drawLine(QPointF(point.x(), rect.top()), QPointF(point.x(), rect.bottom()))
        text = self.hover_text(self.unmap_x(point.x()))
        if not text:
            return
        painter.setFont(QFont(FONT_FAMILY, 8))
        metrics = painter.fontMetrics()
        width = metrics.horizontalAdvance(text) + 14
        height = metrics.height() + 6
        left = min(max(rect.left() + 6, point.x() + 10), rect.right() - width - 6)
        top = rect.top() + 6
        painter.setPen(Qt.NoPen)
        painter.setBrush(qcolor(self._tokens["panel_bg"]))
        painter.drawRoundedRect(QRectF(left, top, width, height), 3, 3)
        painter.setPen(qcolor(self._tokens["ink"]))
        painter.drawText(QRectF(left + 7, top, width - 14, height), Qt.AlignLeft | Qt.AlignVCenter, text)
        painter.restore()

    # ---- 绘制 -------------------------------------------------------------
    def paintEvent(self, event) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing, True)
        painter.fillRect(self.rect(), qcolor(self._tokens["canvas_bg"]))
        painter.setOpacity(0.25 + 0.75 * self._reveal.value)
        rect = self.plot_rect()
        painter.setPen(QPen(qcolor(self._tokens["line"]), 1))
        painter.setBrush(Qt.NoBrush)
        painter.drawRect(rect)
        self._draw_grid(painter, rect)
        painter.save()
        painter.setClipRect(rect)
        self.draw_series(painter, rect)
        painter.restore()
        self._draw_cursor(painter, rect)
        painter.setOpacity(1.0)
        self._draw_title(painter)
        self._draw_legend(painter)
        painter.end()

    def _draw_grid(self, painter: QPainter, rect: QRectF) -> None:
        pen = QPen(qcolor(self._tokens["grid_dot"]), 1, Qt.DotLine)
        painter.setPen(pen)
        x0, x1 = self._x_range
        y0, y1 = self._y_range
        for index in range(1, 4):
            x = rect.left() + rect.width() * index / 4.0
            painter.drawLine(QPointF(x, rect.top()), QPointF(x, rect.bottom()))
            y = rect.top() + rect.height() * index / 4.0
            painter.drawLine(QPointF(rect.left(), y), QPointF(rect.right(), y))
        painter.setPen(qcolor(self._tokens["muted"]))
        font = QFont(FONT_FAMILY, 8)
        painter.setFont(font)
        for index in range(5):
            frac = index / 4.0
            value = y1 + (y0 - y1) * frac
            painter.drawText(
                QRectF(2, rect.top() + rect.height() * frac - 7, MARGIN_L - 8, 14),
                Qt.AlignRight | Qt.AlignVCenter,
                _fmt(value),
            )
            xv = x0 + (x1 - x0) * frac
            painter.drawText(
                QRectF(rect.left() + rect.width() * frac - 30, rect.bottom() + 4, 60, 14),
                Qt.AlignCenter,
                self.x_tick_label(xv),
            )

    def _draw_title(self, painter: QPainter) -> None:
        if not self.title:
            return
        painter.setPen(qcolor(self._tokens["ink"]))
        painter.setFont(QFont(FONT_FAMILY, 9, QFont.DemiBold))
        painter.drawText(QRectF(MARGIN_L, 2, self.width() - MARGIN_L, 18), Qt.AlignLeft | Qt.AlignVCenter, self.title)

    def _draw_legend(self, painter: QPainter) -> None:
        items = self.legend()
        if not items:
            return
        font = QFont(FONT_FAMILY, 8)
        painter.setFont(font)
        metrics = painter.fontMetrics()
        rect = self.plot_rect()
        widths = [16 + metrics.horizontalAdvance(label) + 12 for label, _ in items]
        total_items = len(items)
        while len(items) > 1 and sum(widths) > rect.width() - 16:
            items = items[:-1]
            widths = widths[:-1]
        if len(items) < total_items:
            items = items + [("…", "transparent")]
            widths = widths + [20]
        total = sum(widths)
        x = rect.left() + 8
        y = rect.top() + 6
        painter.setPen(Qt.NoPen)
        painter.setBrush(qcolor(self._tokens["panel_bg"]))
        painter.drawRoundedRect(QRectF(x - 4, y - 2, total + 8, 18), 3, 3)
        for (label, color), width in zip(items, widths):
            painter.setPen(Qt.NoPen)
            painter.setBrush(QColor(color))
            painter.drawRect(QRectF(x, y + 3, 8, 8))
            painter.setPen(qcolor(self._tokens["ink"]))
            painter.drawText(QPointF(x + 12, y + 11), label)
            x += width

    def legend(self) -> list[tuple[str, str]]:
        return []

    def draw_series(self, painter: QPainter, rect: QRectF) -> None:
        raise NotImplementedError


class TimeSeriesPlot(PlotBase):
    def __init__(self, title: str = "时域", parent: QWidget | None = None) -> None:
        super().__init__(title, parent)
        self._keys: list[str] = []
        self._series: dict[str, list[float]] = {}
        self._window = 300
        self._cursor = 0
        self._y_range = (-1.0, 1.0)
        self._times: list[float] = []
        self._seek: int | None = None  # 距最新帧的回溯步数，0 = 最新

    def set_keys(self, keys: Sequence[str]) -> None:
        self._keys = list(keys)[:8]
        self.update()

    def keys(self) -> list[str]:
        return list(self._keys)

    def set_window(self, frames: int) -> None:
        self._window = max(20, int(frames))
        self.update()

    def push(self, live: LiveVM) -> None:
        for frame in live.frames:
            for key in self._keys:
                if key in frame.values:
                    buffer = self._series.setdefault(key, [])
                    buffer.append(frame.values[key])
                    if len(buffer) > 5000:
                        del buffer[: len(buffer) - 5000]
            self._times.append(frame.t)
            if len(self._times) > 5000:
                del self._times[: len(self._times) - 5000]
            self._cursor = frame.seq
        self.update()

    def clear(self) -> None:
        self._series.clear()
        self._times.clear()
        self._seek = None
        self.update()

    def set_seek(self, back: int | None) -> None:
        """时间轴回看：``back`` 是从最新帧往回数的步数。"""
        self._seek = back
        self.update()

    def x_tick_label(self, value: float) -> str:
        visible = self._times[-self._window :]
        if not visible:
            return _fmt(value)
        index = max(0, min(len(visible) - 1, int(round(value))))
        span = visible[-1] - visible[0]
        digits = 4 if span < 0.01 else 3 if span < 0.1 else 2 if span < 10 else 1
        return f"{visible[index]:.{digits}f}s"

    def hover_text(self, x: float) -> str:
        visible = self._times[-self._window :]
        if not visible:
            return f"帧 {int(round(x))}"
        index = max(0, min(len(visible) - 1, int(round(x))))
        parts = [f"t = {visible[index]:.4g}s"]
        for key in self._keys[:3]:
            data = self._visible(key)
            if index < len(data):
                parts.append(f"{_short(key)} = {_fmt(data[index])}")
        return "  ".join(parts)

    def _visible(self, key: str) -> list[float]:
        data = self._series.get(key, [])
        return data[-self._window:]

    def draw_series(self, painter: QPainter, rect: QRectF) -> None:
        lo = math.inf
        hi = -math.inf
        for key in self._keys:
            for value in self._visible(key):
                lo = min(lo, value)
                hi = max(hi, value)
        if not math.isfinite(lo) or not math.isfinite(hi):
            lo, hi = -1.0, 1.0
        if hi - lo < 1e-9:
            lo, hi = lo - 1.0, hi + 1.0
        pad = (hi - lo) * 0.08
        count = max([len(self._visible(key)) for key in self._keys] or [2])
        self.set_ranges((0.0, float(max(1, count - 1))), (lo - pad, hi + pad))
        for index, key in enumerate(self._keys):
            data = self._visible(key)
            if len(data) < 2:
                continue
            path = QPainterPath()
            path.moveTo(self.map_point(0.0, data[0]))
            for i, value in enumerate(data[1:], start=1):
                path.lineTo(self.map_point(float(i), value))
            painter.setPen(QPen(QColor(PALETTE[index % len(PALETTE)]), 1.6))
            painter.setBrush(Qt.NoBrush)
            painter.drawPath(path)
        self._draw_seek(painter, count)

    def _draw_seek(self, painter: QPainter, count: int) -> None:
        if self._seek is None:
            return
        position = max(0, min(count - 1, count - 1 - int(self._seek)))
        painter.setPen(QPen(qcolor(self._tokens["accent"]), 1, Qt.DashLine))
        painter.drawLine(self.map_point(float(position), self._y_range[0]),
                         self.map_point(float(position), self._y_range[1]))
        painter.setBrush(qcolor(self._tokens["accent"]))
        painter.setPen(Qt.NoPen)
        for key in self._keys:
            data = self._visible(key)
            if position < len(data):
                point = self.map_point(float(position), data[position])
                painter.drawEllipse(point, 2.6, 2.6)

    def legend(self) -> list[tuple[str, str]]:
        return [(_short(key), PALETTE[index % len(PALETTE)]) for index, key in enumerate(self._keys)]


class PhasePlot(PlotBase):
    """相图：两条探针信号互为坐标。"""

    def __init__(self, title: str = "相图", parent: QWidget | None = None) -> None:
        super().__init__(title, parent)
        self._x_key = ""
        self._y_key = ""
        self._points: list[tuple[float, float]] = []
        self._y_range = (-1.0, 1.0)
        self._x_range = (-1.0, 1.0)

    def set_keys(self, x_key: str, y_key: str) -> None:
        if (x_key, y_key) != (self._x_key, self._y_key):
            self._points.clear()
        self._x_key = x_key
        self._y_key = y_key
        self.update()

    def push(self, live: LiveVM) -> None:
        for frame in live.frames:
            x = frame.values.get(self._x_key)
            y = frame.values.get(self._y_key)
            if x is None or y is None:
                continue
            self._points.append((x, y))
            if len(self._points) > 2000:
                del self._points[: len(self._points) - 2000]
        self.update()

    def clear_points(self) -> None:
        self._points.clear()
        self.update()

    def draw_series(self, painter: QPainter, rect: QRectF) -> None:
        if not self._points:
            self.set_ranges((-1.0, 1.0), (-1.0, 1.0))
            return
        xs = [p[0] for p in self._points]
        ys = [p[1] for p in self._points]
        x0, x1 = min(xs), max(xs)
        y0, y1 = min(ys), max(ys)
        if x1 - x0 < 1e-9:
            x0, x1 = x0 - 1, x1 + 1
        if y1 - y0 < 1e-9:
            y0, y1 = y0 - 1, y1 + 1
        self.set_ranges((x0, x1), (y0, y1))
        path = QPainterPath()
        path.moveTo(self.map_point(*self._points[0]))
        for point in self._points[1:]:
            path.lineTo(self.map_point(*point))
        painter.setPen(QPen(QColor(PALETTE[0]), 1.5))
        painter.setBrush(Qt.NoBrush)
        painter.drawPath(path)

    def hover_text(self, x: float) -> str:
        point = self._mouse
        if point is None:
            return f"x = {_fmt(x)}"
        return f"{_short(self._x_key)} = {_fmt(self.unmap_x(point.x()))}  " \
               f"{_short(self._y_key)} = {_fmt(self.unmap_y(point.y()))}"

    def legend(self) -> list[tuple[str, str]]:
        if not self._x_key:
            return []
        return [(f"{_short(self._x_key)} → {_short(self._y_key)}", PALETTE[0])]


class ScopePlot(TimeSeriesPlot):
    def __init__(self, title: str = "示波器", parent: QWidget | None = None) -> None:
        super().__init__(title, parent)
        self.set_window(240)


class LissajousPlot(PhasePlot):
    def __init__(self, title: str = "李萨如", parent: QWidget | None = None) -> None:
        super().__init__(title, parent)


class FemPlot(PlotBase):
    """有限元温度场：把 ``field`` 画成热图，可选网格线。"""

    def __init__(self, title: str = "有限元温度场", parent: QWidget | None = None) -> None:
        super().__init__(title, parent)
        self._image: QImage | None = None
        self._nx = 0
        self._ny = 0
        self._range = (0.0, 1.0)
        self._mesh: dict | None = None
        self._show_mesh = True

    def set_snapshot(self, payload: dict | None) -> None:
        if not payload:
            self._image = None
            self.update()
            return
        field = payload.get("field") or []
        config = payload.get("config") or {}
        nx = int(config.get("nx", 0) or 0)
        ny = int(config.get("ny", 0) or 0)
        self._mesh = payload.get("mesh")
        if not field or nx <= 0 or ny <= 0:
            return
        w = nx + 1
        h = ny + 1
        if len(field) < w * h:
            return
        lo = min(field)
        hi = max(field)
        # 场是均匀的（还没开始升温）时不能把整片压到冷端，取中段色。
        flat = hi - lo <= 1e-9
        self._range = (lo, hi if not flat else lo + 1.0)
        image = QImage(w, h, QImage.Format_RGB32)
        for j in range(h):
            for i in range(w):
                value = field[j * w + i]
                color = _heat(lo + 0.5, lo, lo + 1.0) if flat else _heat(value, lo, hi)
                image.setPixel(i, j, color.rgb())
        self._image = image
        self._nx, self._ny = nx, ny
        self.set_ranges((0.0, float(nx)), (0.0, float(ny)))
        self.update()

    def draw_series(self, painter: QPainter, rect: QRectF) -> None:
        if self._image is None:
            painter.setPen(qcolor(self._tokens["muted"]))
            painter.drawText(rect, Qt.AlignCenter, "尚未求解")
            return
        painter.setRenderHint(QPainter.SmoothPixmapTransform, True)
        # 保持网格真实长宽比：等比缩放后居中，别把 36×24 的场拉成一条。
        target = QRectF(rect)
        if self._nx > 0 and self._ny > 0:
            aspect = self._nx / float(self._ny)
            if target.width() / max(1.0, target.height()) > aspect:
                width = target.height() * aspect
                target = QRectF(
                    target.center().x() - width / 2.0, target.top(), width, target.height()
                )
            else:
                height = target.width() / aspect
                target = QRectF(
                    target.left(), target.center().y() - height / 2.0, target.width(), height
                )
        self._draw_rect = target
        painter.drawImage(target, self._image)
        if self._show_mesh and self._mesh:
            nodes = self._mesh.get("nodes") or []
            elements = self._mesh.get("elements") or []
            pen = QPen(QColor(0, 0, 0, 40), 0.6)
            painter.setPen(pen)
            span_x = self._nx or 1.0
            span_y = self._ny or 1.0

            def project(x: float, y: float) -> QPointF:
                return QPointF(
                    target.left() + (x / span_x) * target.width(),
                    target.bottom() - (y / span_y) * target.height(),
                )

            for element in elements[:4000]:
                idx = element.get("nodes") if isinstance(element, dict) else element
                if not idx or len(idx) < 3:
                    continue
                points = [nodes[i] for i in idx if 0 <= i < len(nodes)]
                if len(points) < 3:
                    continue
                path = QPainterPath()
                path.moveTo(project(float(points[0].get("x", 0)), float(points[0].get("y", 0))))
                for point in points[1:]:
                    path.lineTo(project(float(point.get("x", 0)), float(point.get("y", 0))))
                path.closeSubpath()
                painter.drawPath(path)

    def legend(self) -> list[tuple[str, str]]:
        if self._image is None:
            return []
        return [(f"{_fmt(self._range[0])} – {_fmt(self._range[1])}", PALETTE[0])]


def _short(key: str) -> str:
    """探针键 ``n:signal:voltage`` → ``signal.voltage``，图例/读数用。"""
    parts = [part for part in str(key).split(":") if part]
    if len(parts) >= 3:
        return ".".join(parts[-2:])
    return parts[-1] if parts else str(key)


def _fmt(value: float) -> str:
    if value == 0:
        return "0"
    magnitude = abs(value)
    if magnitude >= 1000 or magnitude < 0.01:
        return f"{value:.2e}"
    return f"{value:.2f}".rstrip("0").rstrip(".")


def _heat(value: float, lo: float, hi: float) -> QColor:
    span = hi - lo or 1.0
    t = max(0.0, min(1.0, (value - lo) / span))
    # 冷→暖：深蓝 → 青 → 米 → 铜
    stops = [
        (0.0, (18, 42, 60)),
        (0.35, (36, 110, 120)),
        (0.65, (226, 214, 186)),
        (1.0, (168, 84, 31)),
    ]
    for index in range(len(stops) - 1):
        t0, c0 = stops[index]
        t1, c1 = stops[index + 1]
        if t0 <= t <= t1:
            f = (t - t0) / (t1 - t0 or 1.0)
            return QColor(
                int(c0[0] + (c1[0] - c0[0]) * f),
                int(c0[1] + (c1[1] - c0[1]) * f),
                int(c0[2] + (c1[2] - c0[2]) * f),
            )
    return QColor(0, 0, 0)


__all__ = [
    "FemPlot",
    "LissajousPlot",
    "PhasePlot",
    "PlotBase",
    "ScopePlot",
    "TimeSeriesPlot",
]
