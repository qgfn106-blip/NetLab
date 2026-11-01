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

from .models import LiveVM
from .theme import FONT_FAMILY, qcolor, tokens

PALETTE = [
    "#a8541f", "#1f5f5b", "#2a2621", "#7b8c3a", "#8a4a7c",
    "#b08a3e", "#4a6f8a", "#8e2f24", "#5f6b52", "#7a4a2a",
]

MARGIN_L = 48.0
MARGIN_R = 14.0
MARGIN_T = 26.0
MARGIN_B = 28.0


class PlotBase(QWidget):
    """坐标框 + 刻度 + 网格；子类只实现 ``draw_series``。"""

    def __init__(self, title: str = "", parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._tokens = tokens("light")
        self.title = title
        self._x_range = (0.0, 1.0)
        self._y_range = (0.0, 1.0)
        self.setMinimumHeight(120)
        self.setAutoFillBackground(False)

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

    # ---- 绘制 -------------------------------------------------------------
    def paintEvent(self, event) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing, True)
        painter.fillRect(self.rect(), qcolor(self._tokens["canvas_bg"]))
        rect = self.plot_rect()
        painter.setPen(QPen(qcolor(self._tokens["line"]), 1))
        painter.setBrush(Qt.NoBrush)
        painter.drawRect(rect)
        self._draw_grid(painter, rect)
        painter.save()
        painter.setClipRect(rect)
        self.draw_series(painter, rect)
        painter.restore()
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
                _fmt(xv),
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
        while len(items) > 1 and sum(widths) > rect.width() - 16:
            items = items[:-1]
            widths = widths[:-1]
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
            painter.setPen(qcolor(self._tokens["muted"]))
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
            self._cursor = frame.seq
        self.update()

    def clear(self) -> None:
        self._series.clear()
        self.update()

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

    def legend(self) -> list[tuple[str, str]]:
        return [(key, PALETTE[index % len(PALETTE)]) for index, key in enumerate(self._keys)]


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

    def legend(self) -> list[tuple[str, str]]:
        if not self._x_key:
            return []
        return [(f"{self._x_key} → {self._y_key}", PALETTE[0])]


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
        painter.drawImage(rect, self._image)
        if self._show_mesh and self._mesh:
            nodes = self._mesh.get("nodes") or []
            elements = self._mesh.get("elements") or []
            pen = QPen(QColor(0, 0, 0, 40), 0.6)
            painter.setPen(pen)
            for element in elements[:4000]:
                idx = element.get("nodes") if isinstance(element, dict) else element
                if not idx or len(idx) < 3:
                    continue
                points = [nodes[i] for i in idx if 0 <= i < len(nodes)]
                if len(points) < 3:
                    continue
                path = QPainterPath()
                path.moveTo(self.map_point(float(points[0].get("x", 0)), float(points[0].get("y", 0))))
                for point in points[1:]:
                    path.lineTo(self.map_point(float(point.get("x", 0)), float(point.get("y", 0))))
                path.closeSubpath()
                painter.drawPath(path)

    def legend(self) -> list[tuple[str, str]]:
        if self._image is None:
            return []
        return [(f"{_fmt(self._range[0])} – {_fmt(self._range[1])}", PALETTE[0])]


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
