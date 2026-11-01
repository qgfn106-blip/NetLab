"""视图模型：把服务状态投影成「用户能看到的东西」的纯数据。

本模块**不 import Qt**，也不 import FastAPI；输入是 ``SERVICE`` 产出的普通
字典，输出是不可变的 dataclass。这样画布/图表/面板的几何与内容都能脱离
GUI 单测（spec §7 的 S2 seam）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Sequence

from .. import schematic
from .geometry import (
    DEFAULT_RADIUS,
    node_size,
    pin_points,
    route_points,
)

#: 画布默认缩放上限/下限（与旧前端一致）。
ZOOM_MIN = 0.25
ZOOM_MAX = 4.0

#: 旧前端的默认网格步长（世界单位）。
GRID_STEP = 20.0


@dataclass(frozen=True)
class PinVM:
    name: str
    role: str
    bind: str
    x: float
    y: float


@dataclass(frozen=True)
class NodeVM:
    id: str
    name: str
    kind: str
    x: float
    y: float
    w: float
    h: float
    pins: tuple[PinVM, ...] = ()
    params: Mapping[str, Any] = field(default_factory=dict)
    state: Mapping[str, Any] = field(default_factory=dict)

    @property
    def radius(self) -> float:
        return max(self.w, self.h) / 2.0

    def contains(self, x: float, y: float) -> bool:
        """圆/矩形命中：宽高不等时按矩形，相等时按圆（与旧前端一致）。"""
        if abs(self.w - self.h) < 0.5:
            dx = x - self.x
            dy = y - self.y
            return dx * dx + dy * dy <= (self.w / 2.0) ** 2
        return (
            abs(x - self.x) <= self.w / 2.0 and abs(y - self.y) <= self.h / 2.0
        )


@dataclass(frozen=True)
class EdgeVM:
    id: str
    name: str
    kind: str
    source: str
    target: str
    route: str
    waypoints: tuple[tuple[float, float], ...]
    anchors: Mapping[str, str]
    enabled: bool
    delay: bool
    points: tuple[tuple[float, float], ...] = ()

    @property
    def length(self) -> float:
        total = 0.0
        for (x1, y1), (x2, y2) in zip(self.points, self.points[1:]):
            total += ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
        return total

    def hit(self, x: float, y: float, tolerance: float = 6.0) -> bool:
        for (x1, y1), (x2, y2) in zip(self.points, self.points[1:]):
            if _point_segment_distance(x, y, x1, y1, x2, y2) <= tolerance:
                return True
        return False


@dataclass(frozen=True)
class SceneVM:
    mode: str
    integration: str
    nodes: tuple[NodeVM, ...]
    edges: tuple[EdgeVM, ...]

    def node(self, node_id: str) -> NodeVM | None:
        for item in self.nodes:
            if item.id == node_id:
                return item
        return None

    def edge(self, edge_id: str) -> EdgeVM | None:
        for item in self.edges:
            if item.id == edge_id:
                return item
        return None

    def bounds(self) -> tuple[float, float, float, float]:
        """世界坐标包围盒 ``(x0, y0, x1, y1)``；空场景返回 ``(0,0,0,0)``。"""
        if not self.nodes:
            return (0.0, 0.0, 0.0, 0.0)
        xs = [n.x for n in self.nodes]
        ys = [n.y for n in self.nodes]
        return (
            min(xs) - DEFAULT_RADIUS,
            min(ys) - DEFAULT_RADIUS,
            max(xs) + DEFAULT_RADIUS,
            max(ys) + DEFAULT_RADIUS,
        )


@dataclass(frozen=True)
class NetworkVM:
    id: str
    name: str
    current: bool


@dataclass(frozen=True)
class TreeVM:
    networks: tuple[NetworkVM, ...]
    nodes: tuple[NodeVM, ...]
    edges: tuple[EdgeVM, ...]


@dataclass(frozen=True)
class FrameVM:
    seq: int
    values: Mapping[str, float]
    t: float = 0.0


@dataclass(frozen=True)
class LiveVM:
    frames: tuple[FrameVM, ...]
    cursor: int
    keys: tuple[str, ...]
    running: bool = False
    fps: float = 0.0
    error: str | None = None


# ---------------------------------------------------------------------------
# 投影函数
# ---------------------------------------------------------------------------


def build_scene_vm(payload: Mapping[str, Any] | None) -> SceneVM:
    """把 ``scene.to_payload()`` 的字典投影成 :class:`SceneVM`。"""
    if not isinstance(payload, Mapping):
        return SceneVM(mode="signal", integration="trapezoidal", nodes=(), edges=())

    nodes: list[NodeVM] = []
    raw_nodes = payload.get("nodes") or []
    for raw in raw_nodes:
        if not isinstance(raw, Mapping):
            continue
        kind = str(raw.get("kind") or "")
        position = raw.get("position") or {}
        try:
            x = float(position.get("x", 0.0))
            y = float(position.get("y", 0.0))
        except (TypeError, ValueError):
            x = y = 0.0
        w, h = node_size(raw)
        params = dict(raw.get("params") or {})
        # 电路模式的元件挂在 kind="device" 下，引脚/符号由 params.element 决定。
        pin_kind = str(params.get("element") or kind) if kind in ("device", "module") else kind
        pins: list[PinVM] = []
        for px, py, pin in pin_points(pin_kind, x, y, w, h):
            pins.append(
                PinVM(
                    name=str(pin.get("name", "")),
                    role=str(pin.get("role", "")),
                    bind=str(pin.get("bind", "")),
                    x=px,
                    y=py,
                )
            )
        nodes.append(
            NodeVM(
                id=str(raw.get("id") or ""),
                name=str(raw.get("name") or ""),
                kind=kind,
                x=x,
                y=y,
                w=w,
                h=h,
                pins=tuple(pins),
                params=params,
                state=dict(raw.get("state") or {}),
            )
        )

    by_id = {node.id: node for node in nodes}
    edges: list[EdgeVM] = []
    for raw in payload.get("edges") or []:
        if not isinstance(raw, Mapping):
            continue
        source = str(raw.get("source") or "")
        target = str(raw.get("target") or "")
        waypoints = tuple(
            (float(point.get("x", 0.0)), float(point.get("y", 0.0)))
            for point in (raw.get("waypoints") or [])
            if isinstance(point, Mapping)
        )
        anchors = {
            str(key): str(value)
            for key, value in (raw.get("anchors") or {}).items()
            if value
        }
        points = route_points(
            by_id.get(source),
            by_id.get(target),
            route=str(raw.get("route") or "auto"),
            waypoints=waypoints,
            anchors=anchors,
        )
        edges.append(
            EdgeVM(
                id=str(raw.get("id") or ""),
                name=str(raw.get("name") or ""),
                kind=str(raw.get("kind") or ""),
                source=source,
                target=target,
                route=str(raw.get("route") or "auto"),
                waypoints=waypoints,
                anchors=anchors,
                enabled=bool(raw.get("enabled", True)),
                delay=bool(raw.get("delay", False)),
                points=points,
            )
        )

    return SceneVM(
        mode=str(payload.get("mode") or "signal"),
        integration=str(payload.get("integration") or "trapezoidal"),
        nodes=tuple(nodes),
        edges=tuple(edges),
    )


def build_tree_vm(
    networks: Iterable[Mapping[str, Any]] | None,
    scene: SceneVM,
) -> TreeVM:
    items: list[NetworkVM] = []
    for raw in networks or []:
        if not isinstance(raw, Mapping):
            continue
        items.append(
            NetworkVM(
                id=str(raw.get("id") or ""),
                name=str(raw.get("name") or ""),
                current=bool(raw.get("current")),
            )
        )
    return TreeVM(networks=tuple(items), nodes=scene.nodes, edges=scene.edges)


def build_live_vm(payload: Mapping[str, Any] | None) -> LiveVM:
    """把 ``Simulation.live()`` 的结果投影成 :class:`LiveVM`。"""
    if not isinstance(payload, Mapping):
        return LiveVM(frames=(), cursor=0, keys=())
    frames: list[FrameVM] = []
    for raw in payload.get("frames") or []:
        if not isinstance(raw, Mapping):
            continue
        seq = raw.get("seq", 0)
        try:
            seq = int(seq)
        except (TypeError, ValueError):
            seq = 0
        values: dict[str, float] = {}
        nested = raw.get("v")
        if isinstance(nested, Mapping):
            for key, value in nested.items():
                if isinstance(value, (int, float)):
                    values[str(key)] = float(value)
        else:
            for key, value in raw.items():
                if key not in ("seq", "t") and isinstance(value, (int, float)):
                    values[str(key)] = float(value)
        try:
            stamp = float(raw.get("t") or 0.0)
        except (TypeError, ValueError):
            stamp = 0.0
        frames.append(FrameVM(seq=seq, values=values, t=stamp))
    sim = payload.get("sim") or {}
    return LiveVM(
        frames=tuple(frames),
        cursor=int(payload.get("cursor") or 0),
        keys=tuple(str(key) for key in (payload.get("keys") or ())),
        running=bool(sim.get("running", sim.get("is_running", False))),
        fps=float(sim.get("actual_fps") or 0.0),
        error=sim.get("error"),
    )


def visible_series(live: LiveVM, key: str) -> list[float]:
    return [frame.values.get(key, 0.0) for frame in live.frames]


def series_extent(series: Sequence[float]) -> tuple[float, float]:
    if not series:
        return (0.0, 1.0)
    lo = min(series)
    hi = max(series)
    if abs(hi - lo) < 1e-9:
        return (lo - 1.0, hi + 1.0)
    return (lo, hi)


def pin_index(node: NodeVM) -> dict[str, PinVM]:
    return {pin.name: pin for pin in node.pins}


def _point_segment_distance(
    px: float, py: float, x1: float, y1: float, x2: float, y2: float
) -> float:
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0.0 and dy == 0.0:
        return ((px - x1) ** 2 + (py - y1) ** 2) ** 0.5
    t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    nx = x1 + t * dx
    ny = y1 + t * dy
    return ((px - nx) ** 2 + (py - ny) ** 2) ** 0.5


__all__ = [
    "GRID_STEP",
    "ZOOM_MAX",
    "ZOOM_MIN",
    "EdgeVM",
    "FrameVM",
    "LiveVM",
    "NetworkVM",
    "NodeVM",
    "PinVM",
    "SceneVM",
    "TreeVM",
    "build_live_vm",
    "build_scene_vm",
    "build_tree_vm",
    "pin_index",
    "series_extent",
    "visible_series",
]
