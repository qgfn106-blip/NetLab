"""主画布控件：只负责「命中 + 手势 + 画」。

业务变更通过信号交给外壳（``MainWindow``），控件自身不改服务状态，
所以拖拽期间可以先本地预览、松手再提交一次。
"""

from __future__ import annotations

import json
import math
from typing import Any

from PySide6.QtCore import QPoint, QPointF, QRectF, Qt, QTimer, QVariantAnimation, Signal
from PySide6.QtGui import QCursor, QMouseEvent, QPainter, QWheelEvent
from PySide6.QtWidgets import QWidget

from .. import motion
from ..geometry import ViewTransform, snap
from ..models import ZOOM_MAX, ZOOM_MIN
from ..models import EdgeVM, NodeVM, SceneVM
from ..theme import tokens
from . import render

HIT_TOLERANCE = 7.0
PIN_RADIUS = 9.0


class CanvasWidget(QWidget):
    selectionChanged = Signal(object)          # list[str]
    moveRequested = Signal(object)             # list[{id,x,y}]
    edgeRequested = Signal(str, str)           # source, target
    deleteRequested = Signal(object)           # list[str]
    contextRequested = Signal(str, object, object)  # kind, id, global pos
    addNodeRequested = Signal(float, float)    # world x, y
    dropNodeRequested = Signal(str, object, float, float)  # kind, params, world x, y
    openInspectorRequested = Signal(str)
    statusMessage = Signal(str)
    zoomChanged = Signal(float)

    def __init__(self, tokens_map: dict[str, str] | None = None, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setMouseTracking(True)
        self.setFocusPolicy(Qt.StrongFocus)
        self.setAcceptDrops(True)
        self.setMinimumSize(320, 240)
        self.setAutoFillBackground(False)
        self._tokens = tokens_map or tokens("light")
        self._scene: SceneVM = SceneVM(mode="signal", integration="trapezoidal", nodes=(), edges=())
        self._view = ViewTransform(1.0, 0.0, 0.0)
        self._auto_fit = True
        self._fit_pending = False
        self._selection: set[str] = set()
        self._hover: str | None = None
        self._drag: dict[str, Any] = {}
        self._box: QRectF | None = None
        self._link: tuple[str, tuple[float, float], tuple[float, float]] | None = None
        self._pointer = QPointF(0, 0)
        self._show_grid = True
        self._grid_step = 20.0
        self._snap = True
        self._fitted = False
        # 动效状态：跑仿真时边上有流动虚线，选中时外环轻微脉冲
        self._running = False
        self._clock = 0.0
        self._hover_ramp = motion.Ramp(self, step_ms=16, speed=0.22)
        self._zoom_anim: QVariantAnimation | None = None
        self._tick_timer = QTimer(self)
        self._tick_timer.setInterval(50)
        self._tick_timer.timeout.connect(self._on_tick)

    # ---- 外部接口 ---------------------------------------------------------
    def set_running(self, running: bool) -> None:
        """仿真在跑时让边上的虚线流动起来（关掉动效则静止）。"""
        self._running = bool(running)
        self._sync_ticker()

    def _sync_ticker(self) -> None:
        want = motion.enabled() and (self._running or bool(self._selection))
        if want and not self._tick_timer.isActive():
            self._tick_timer.start()
        elif not want and self._tick_timer.isActive():
            self._tick_timer.stop()

    def _on_tick(self) -> None:
        self._clock = (self._clock + 0.05) % 1000.0
        self.update()

    def set_tokens(self, tokens_map: dict[str, str]) -> None:
        self._tokens = tokens_map
        self.update()

    def set_scene(self, scene: SceneVM, *, fit: bool = False) -> None:
        self._scene = scene
        ids = {node.id for node in scene.nodes} | {edge.id for edge in scene.edges}
        self._selection &= ids
        if fit or not self._fitted:
            self.fit()
            self._fitted = True
        self.update()

    def scene(self) -> SceneVM:
        return self._scene

    def set_selection(self, ids: list[str] | set[str]) -> None:
        self._selection = set(ids)
        self.selectionChanged.emit(sorted(self._selection))
        self._sync_ticker()
        self.update()

    def selection(self) -> list[str]:
        return sorted(self._selection)

    def selected_nodes(self) -> list[NodeVM]:
        return [node for node in self._scene.nodes if node.id in self._selection]

    def selected_edges(self) -> list[EdgeVM]:
        return [edge for edge in self._scene.edges if edge.id in self._selection]

    def set_grid(self, show: bool, step: float | None = None) -> None:
        self._show_grid = show
        if step is not None:
            self._grid_step = max(4.0, float(step))
        self.update()

    def set_snap(self, value: bool) -> None:
        self._snap = value

    def request_fit(self) -> None:
        """下一帧适配视图（首次载入场景时窗口可能还没有尺寸）。"""
        self._fit_pending = True
        self._auto_fit = True
        self.update()

    def fit(self) -> None:
        if not self._scene.nodes:
            self._view = ViewTransform(1.0, self.width() / 2.0, self.height() / 2.0)
        else:
            from ..geometry import fit_transform

            self._view = fit_transform(
                self._scene.bounds(), max(1, self.width()), max(1, self.height())
            )
        self._fit_size = (self.width(), self.height())
        self.zoomChanged.emit(self._view.k)
        self.update()

    def zoom_to(self, factor: float) -> None:
        self._auto_fit = False
        self._animate_zoom(factor, self.width() / 2.0, self.height() / 2.0)

    def _animate_zoom(self, factor: float, ax: float, ay: float) -> None:
        """以光标为锚平滑缩放；关掉动效时直接落位。"""
        target = max(ZOOM_MIN, min(ZOOM_MAX, self._view.k * factor))
        if not motion.enabled() or abs(target - self._view.k) < 1e-4:
            self._view.zoom_at(ax, ay, factor)
            self.zoomChanged.emit(self._view.k)
            self.update()
            return
        if self._zoom_anim is not None:
            self._zoom_anim.stop()
        anim = QVariantAnimation(self)
        anim.setDuration(90)
        anim.setStartValue(self._view.k)
        anim.setEndValue(target)
        anim.setEasingCurve(motion.QEasingCurve.OutCubic)

        def _apply(value: Any) -> None:
            k = float(value)
            step = k / max(1e-6, self._view.k)
            self._view.zoom_at(ax, ay, step)
            self.zoomChanged.emit(self._view.k)
            self.update()

        anim.valueChanged.connect(_apply)
        anim.finished.connect(lambda: setattr(self, "_zoom_anim", None))
        self._zoom_anim = anim
        anim.start(QVariantAnimation.DeleteWhenStopped)

    def reset_zoom(self) -> None:
        self._view.k = 1.0
        self.zoomChanged.emit(self._view.k)
        self.update()

    def center_on(self, node_id: str) -> None:
        node = self._scene.node(node_id)
        if node is None:
            return
        self._view.x = self.width() / (2.0 * self._view.k) - node.x
        self._view.y = self.height() / (2.0 * self._view.k) - node.y
        self.update()

    # ---- 命中 -------------------------------------------------------------
    def _hit_node(self, screen: QPointF) -> NodeVM | None:
        wx, wy = self._view.to_world(screen.x(), screen.y())
        for node in reversed(self._scene.nodes):
            if node.contains(wx, wy):
                return node
        return None

    def _hit_pin(self, screen: QPointF) -> tuple[NodeVM, Any] | None:
        for node in self._scene.nodes:
            for pin in node.pins:
                px, py = self._view.to_screen(pin.x, pin.y)
                if math.hypot(px - screen.x(), py - screen.y()) <= PIN_RADIUS:
                    return node, pin
        return None

    def _hit_edge(self, screen: QPointF) -> EdgeVM | None:
        wx, wy = self._view.to_world(screen.x(), screen.y())
        tolerance = HIT_TOLERANCE / max(0.2, self._view.k)
        for edge in self._scene.edges:
            if edge.hit(wx, wy, tolerance):
                return edge
        return None

    def _world(self, screen: QPointF) -> tuple[float, float]:
        return self._view.to_world(screen.x(), screen.y())

    def _maybe_snap(self, x: float, y: float) -> tuple[float, float]:
        if not self._snap:
            return (x, y)
        return (snap(x, self._grid_step), snap(y, self._grid_step))

    # ---- 绘制 -------------------------------------------------------------
    def showEvent(self, event) -> None:  # noqa: N802
        super().showEvent(event)
        if getattr(self, "_fit_pending", False) and self.width() > 40:
            self._fit_pending = False
            self.fit()

    def resizeEvent(self, event) -> None:  # noqa: N802
        super().resizeEvent(event)
        if self.width() <= 40:
            return
        if getattr(self, "_fit_pending", False):
            self._fit_pending = False
            self.fit()
        elif getattr(self, "_auto_fit", False):
            # 用户还没手动缩放/平移过：跟着窗口大小自动适配（dock 展开后不会缩在角落）
            self.fit()

    def paintEvent(self, event) -> None:
        if getattr(self, "_auto_fit", False) and self._scene.nodes:
            size = (self.width(), self.height())
            if size != getattr(self, "_fit_size", None) and size[0] > 80:
                self.fit()  # noqa: N802 - Qt 命名
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing, True)
        painter.setRenderHint(QPainter.TextAntialiasing, True)
        render.draw_grid(
            painter,
            self._view,
            (self.width(), self.height()),
            self._tokens,
            step_world=self._grid_step,
            show=self._show_grid,
        )
        render.draw_edges(
            painter,
            self._scene,
            self._view,
            self._tokens,
            selected=self._selection,
            hovered=self._hover,
            phase=self._clock,
            running=self._running,
            hover_alpha=self._hover_ramp.value,
        )
        for edge in self.selected_edges():
            if edge.waypoints:
                render.draw_waypoints(painter, edge.waypoints, self._view, self._tokens)
        render.draw_nodes(
            painter,
            self._scene,
            self._view,
            self._tokens,
            selected=self._selection,
            hovered=self._hover,
            pulse=math.sin(self._clock * 2.4),
            hover_alpha=self._hover_ramp.value,
        )
        if self._box is not None:
            render.draw_selection_box(painter, self._box, self._tokens)
        if self._link is not None:
            _, start, end = self._link
            render.draw_link_preview(
                painter,
                self._view.to_screen(*start),
                self._view.to_screen(*end),
                self._tokens,
            )
        hint = f"{int(self._view.k * 100)}%"
        if self._scene.mode:
            hint = f"{self._scene.mode} · {hint}"
        render.draw_hud(painter, hint, self._tokens)
        painter.end()

    # ---- 鼠标 -------------------------------------------------------------
    def mousePressEvent(self, event: QMouseEvent) -> None:  # noqa: N802
        pos = event.position()
        self._pointer = pos
        if event.button() == Qt.MiddleButton or (
            event.button() == Qt.LeftButton and event.modifiers() & Qt.AltModifier
        ):
            self._auto_fit = False
            self._drag = {"type": "pan", "start": pos, "origin": (self._view.x, self._view.y)}
            self.setCursor(QCursor(Qt.ClosedHandCursor))
            return
        if event.button() == Qt.RightButton:
            node = self._hit_node(pos)
            if node is not None:
                if node.id not in self._selection:
                    self.set_selection([node.id])
                self.contextRequested.emit("node", node.id, event.globalPosition().toPoint())
                return
            edge = self._hit_edge(pos)
            if edge is not None:
                if edge.id not in self._selection:
                    self.set_selection([edge.id])
                self.contextRequested.emit("edge", edge.id, event.globalPosition().toPoint())
                return
            self.contextRequested.emit("canvas", None, event.globalPosition().toPoint())
            return
        if event.button() != Qt.LeftButton:
            return

        pin_hit = self._hit_pin(pos)
        if pin_hit is not None:
            node, pin = pin_hit
            start = self._world(pos)
            self._link = (node.id, start, start)
            self._drag = {"type": "link", "node": node.id}
            self.update()
            return

        node = self._hit_node(pos)
        if node is not None:
            if event.modifiers() & Qt.ShiftModifier:
                if node.id in self._selection:
                    self._selection.discard(node.id)
                else:
                    self._selection.add(node.id)
            elif node.id not in self._selection:
                self._selection = {node.id}
            self.selectionChanged.emit(sorted(self._selection))
            self._drag = {
                "type": "node",
                "start": pos,
                "moved": False,
                "origins": {
                    item.id: (item.x, item.y)
                    for item in self._scene.nodes
                    if item.id in self._selection
                },
            }
            self.update()
            return

        edge = self._hit_edge(pos)
        if edge is not None:
            if event.modifiers() & Qt.ShiftModifier:
                self._selection.symmetric_difference_update({edge.id})
            else:
                self._selection = {edge.id}
            self.selectionChanged.emit(sorted(self._selection))
            self.update()
            return

        if not (event.modifiers() & Qt.ShiftModifier):
            self._selection.clear()
            self.selectionChanged.emit([])
        self._drag = {"type": "box", "start": pos}
        self._box = QRectF(pos, pos)
        self.update()

    def mouseMoveEvent(self, event: QMouseEvent) -> None:  # noqa: N802
        pos = event.position()
        self._pointer = pos
        drag = self._drag
        if not drag:
            self._update_hover(pos)
            return
        kind = drag.get("type")
        if kind == "pan":
            origin = drag["origin"]
            self._view.x = origin[0] + (pos.x() - drag["start"].x()) / max(1e-6, self._view.k)
            self._view.y = origin[1] + (pos.y() - drag["start"].y()) / max(1e-6, self._view.k)
            self.update()
        elif kind == "node":
            dx = (pos.x() - drag["start"].x()) / max(1e-6, self._view.k)
            dy = (pos.y() - drag["start"].y()) / max(1e-6, self._view.k)
            if abs(dx) > 1 or abs(dy) > 1:
                drag["moved"] = True
            for node in self._scene.nodes:
                origin = drag["origins"].get(node.id)
                if origin is None:
                    continue
                node.__dict__["x"] = origin[0] + dx
                node.__dict__["y"] = origin[1] + dy
            self.update()
        elif kind == "box":
            start = drag["start"]
            self._box = QRectF(start, pos).normalized()
            self.update()
        elif kind == "link":
            node_id, start, _ = self._link or ("", (0.0, 0.0), (0.0, 0.0))
            self._link = (node_id, start, self._world(pos))
            self.update()

    def mouseReleaseEvent(self, event: QMouseEvent) -> None:  # noqa: N802
        drag = self._drag
        self._drag = {}
        pos = event.position()
        if not drag:
            return
        kind = drag.get("type")
        if kind == "pan":
            self.setCursor(QCursor(Qt.ArrowCursor))
            return
        if kind == "node" and drag.get("moved"):
            items = []
            for node in self._scene.nodes:
                if node.id in drag["origins"]:
                    x, y = self._maybe_snap(node.x, node.y)
                    items.append({"id": node.id, "x": x, "y": y})
            self.moveRequested.emit(items)
            self.statusMessage.emit(f"移动 {len(items)} 个节点")
            return
        if kind == "box":
            rect = self._box
            self._box = None
            if rect is not None and (rect.width() > 3 or rect.height() > 3):
                x0, y0 = self._view.to_world(rect.left(), rect.top())
                x1, y1 = self._view.to_world(rect.right(), rect.bottom())
                hits = [
                    node.id
                    for node in self._scene.nodes
                    if x0 <= node.x <= x1 and y0 <= node.y <= y1
                ]
                hits += [
                    edge.id
                    for edge in self._scene.edges
                    if all(x0 <= px <= x1 and y0 <= py <= y1 for px, py in edge.points)
                ]
                self.set_selection(hits)
            self.update()
            return
        if kind == "link":
            link = self._link
            self._link = None
            if link is not None:
                source, _, end_world = link
                target = None
                for node in self._scene.nodes:
                    if node.id != source and node.contains(*end_world):
                        target = node
                        break
                if target is None:
                    self._update_hover(pos)
                    self.update()
                    return
                self.edgeRequested.emit(source, target.id)
            self.update()
            return
        self._update_hover(pos)
        self.update()

    def mouseDoubleClickEvent(self, event: QMouseEvent) -> None:  # noqa: N802
        pos = event.position()
        node = self._hit_node(pos)
        if node is not None:
            self.openInspectorRequested.emit(node.id)
            return
        wx, wy = self._maybe_snap(*self._world(pos))
        self.addNodeRequested.emit(wx, wy)

    # ---- 拖放（模块库 → 画布）-------------------------------------------
    @staticmethod
    def _drop_payload(mime) -> tuple[str, dict[str, Any]]:
        """模块库拖过来的载荷：``{"kind": ..., "params": {...}}`` 的 JSON。"""
        raw = bytes(mime.data("application/x-netlab-kind")).decode("utf-8", "ignore").strip()
        if not raw:
            text = mime.text().strip()
            raw = text.split(":", 1)[1].strip() if text.startswith("netlab-kind:") else ""
        if not raw:
            return "", {}
        try:
            payload = json.loads(raw)
        except ValueError:
            return raw, {}
        if isinstance(payload, str):
            return payload, {}
        if isinstance(payload, dict):
            kind = str(payload.get("kind") or "")
            params = payload.get("params")
            return kind, dict(params) if isinstance(params, dict) else {}
        return "", {}

    def dragEnterEvent(self, event) -> None:  # noqa: N802
        if self._drop_payload(event.mimeData())[0]:
            event.acceptProposedAction()
        else:
            event.ignore()

    def dragMoveEvent(self, event) -> None:  # noqa: N802
        if self._drop_payload(event.mimeData())[0]:
            event.acceptProposedAction()
        else:
            event.ignore()

    def dropEvent(self, event) -> None:  # noqa: N802
        kind, params = self._drop_payload(event.mimeData())
        if not kind:
            event.ignore()
            return
        pos = event.position() if hasattr(event, "position") else QPointF(event.pos())
        wx, wy = self._maybe_snap(*self._world(QPointF(pos)))
        self.dropNodeRequested.emit(kind, params, wx, wy)
        event.acceptProposedAction()

    def wheelEvent(self, event: QWheelEvent) -> None:  # noqa: N802
        self._auto_fit = False
        delta = event.angleDelta().y()
        if delta == 0:
            return
        factor = 1.12 if delta > 0 else 1 / 1.12
        pos = event.position()
        self._animate_zoom(factor, pos.x(), pos.y())

    def keyPressEvent(self, event) -> None:  # noqa: N802
        key = event.key()
        if key in (Qt.Key_Delete, Qt.Key_Backspace):
            if self._selection:
                self.deleteRequested.emit(sorted(self._selection))
            return
        if key == Qt.Key_Escape:
            self._selection.clear()
            self.selectionChanged.emit([])
            self._drag = {}
            self._box = None
            self._link = None
            self.update()
            return
        if key == Qt.Key_Home:
            self.fit()
            return
        step = 1.0 if event.modifiers() & Qt.ShiftModifier else 10.0
        dx = dy = 0.0
        if key == Qt.Key_Left:
            dx = -step
        elif key == Qt.Key_Right:
            dx = step
        elif key == Qt.Key_Up:
            dy = -step
        elif key == Qt.Key_Down:
            dy = step
        elif key in (Qt.Key_Plus, Qt.Key_Equal):
            self.zoom_to(1.12)
            return
        elif key == Qt.Key_Minus:
            self.zoom_to(1 / 1.12)
            return
        if dx or dy:
            items = [
                {"id": node.id, "x": node.x + dx, "y": node.y + dy}
                for node in self._scene.nodes
                if node.id in self._selection
            ]
            if items:
                self.moveRequested.emit(items)
            return
        super().keyPressEvent(event)

    def _update_hover(self, pos: QPointF) -> None:
        previous = self._hover
        node = self._hit_node(pos)
        self._hover = node.id if node is not None else None
        if self._hover is None:
            edge = self._hit_edge(pos)
            self._hover = edge.id if edge is not None else None
        if previous != self._hover:
            self._hover_ramp.value = 0.0
            self.update()
        self._hover_ramp.to(1.0 if self._hover else 0.0)
        self.setCursor(QCursor(Qt.PointingHandCursor if self._hover else Qt.ArrowCursor))


__all__ = ["CanvasWidget"]
