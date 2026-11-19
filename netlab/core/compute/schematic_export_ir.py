"""S1：SchematicExportIR——原理图导出的只读中间表示。

本模块把旧“元件边”场景与 R20+ “器件节点 + 引脚导线”场景归一成
同一份结构化 IR，供后续 SchemDraw/GB 符号渲染使用。它不输出 SVG，
也不修改调用方的 Scene / payload。

公开契约见 docs/SCHEMATIC_EXPORT_CONTRACT.md。
"""

from __future__ import annotations

import copy
import heapq
import math
from dataclasses import dataclass, field
from typing import Any

from .nodal import ComputeError
from .schematic_symbols import SymbolSpecError, UnsupportedSymbolError, symbol_spec
from ..model.ports import PINS, pins_for_device

SCHEMA = "netlab-schematic-ir/1"
MM_PER_WORLD = 0.127
WORLD_PER_GRID = 20.0
GRID_MM = WORLD_PER_GRID * MM_PER_WORLD
EPSILON = 1e-9

_DEVICE_ANCHOR_RADIUS = 20.0
_NET_ANCHOR_RADIUS = 12.0
_LABEL_OFFSET = 18.0
_LABEL_TEXT_HEIGHT = 15.0
_LABEL_TEXT_WIDTH_FACTOR = 10.5
_LABEL_CLEARANCE = 1.0

_PARAM_UNITS = (
    ("R", "Ω"),
    ("C", "F"),
    ("L", "H"),
    ("V", "V"),
    ("I", "A"),
)


def world_to_mm(value: float) -> float:
    """world unit -> 毫米。"""
    return float(value) * MM_PER_WORLD


def mm_to_world(value: float) -> float:
    """毫米 -> world unit。"""
    return float(value) / MM_PER_WORLD


@dataclass(frozen=True)
class ExportOptions:
    """导出选项；只影响 IR 的呈现元数据与 auto 路由，不改场景。"""

    style: str = "gb"
    route_mode: str = "orthogonal"
    include_values: bool = True

    def __post_init__(self) -> None:
        if self.style not in ("gb", "classic"):
            raise ValueError("style 必须是 gb 或 classic")
        if self.route_mode not in ("orthogonal", "free"):
            raise ValueError("route_mode 必须是 orthogonal 或 free")


@dataclass(frozen=True)
class IRPin:
    name: str
    role: str
    required: bool
    x: float
    y: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "role": self.role,
            "required": self.required,
            "x": float(self.x),
            "y": float(self.y),
        }


@dataclass(frozen=True)
class IRDevice:
    id: str
    kind: str
    name: str
    params: dict[str, Any]
    center: dict[str, float]
    rotation_deg: float
    bbox: dict[str, float] | None
    pins: tuple[IRPin, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "name": self.name,
            "params": copy.deepcopy(self.params),
            "center": {"x": float(self.center["x"]), "y": float(self.center["y"])},
            "rotation_deg": float(self.rotation_deg),
            "bbox": None if self.bbox is None else dict(self.bbox),
            "pins": [pin.to_dict() for pin in self.pins],
        }


@dataclass(frozen=True)
class IRNet:
    id: str
    name: str
    members: tuple[dict[str, str], ...] = field(default_factory=tuple)
    is_ground: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "members": [dict(item) for item in self.members],
            "is_ground": self.is_ground,
        }


@dataclass(frozen=True)
class IRWire:
    id: str
    net_id: str
    points: tuple[dict[str, float], ...]
    source_pin: str
    target_pin: str
    route_source: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "net_id": self.net_id,
            "points": [{"x": float(p["x"]), "y": float(p["y"])} for p in self.points],
            "source_pin": self.source_pin,
            "target_pin": self.target_pin,
            "route_source": self.route_source,
        }


@dataclass(frozen=True)
class IRJunction:
    x: float
    y: float
    reason: str = "branch"

    def to_dict(self) -> dict[str, Any]:
        return {"x": float(self.x), "y": float(self.y), "reason": self.reason}

@dataclass(frozen=True)
class IRGround:
    id: str
    x: float
    y: float
    net_id: str

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "x": self.x, "y": self.y, "net_id": self.net_id}


@dataclass(frozen=True)
class IRCrossing:
    x: float
    y: float
    over_wire_id: str
    under_wire_id: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "x": float(self.x),
            "y": float(self.y),
            "over_wire_id": self.over_wire_id,
            "under_wire_id": self.under_wire_id,
        }


@dataclass(frozen=True)
class IRLabel:
    text: str
    anchor: dict[str, float]
    placement: str
    owner_id: str
    role: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "anchor": {"x": float(self.anchor["x"]), "y": float(self.anchor["y"])},
            "placement": self.placement,
            "owner_id": self.owner_id,
            "role": self.role,
        }


@dataclass(frozen=True)
class IRUnsupported:
    id: str
    kind: str
    name: str
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "name": self.name,
            "reason": self.reason,
        }


@dataclass(frozen=True)
class IRWarning:
    code: str
    message: str
    owner_id: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "owner_id": self.owner_id}


@dataclass(frozen=True)
class IRStats:
    nodes: int
    devices: int
    wires: int
    junctions: int
    crossings: int
    labels: int
    unsupported: int
    warnings: int

    def to_dict(self) -> dict[str, int]:
        return {
            "nodes": self.nodes,
            "devices": self.devices,
            "wires": self.wires,
            "junctions": self.junctions,
            "crossings": self.crossings,
            "labels": self.labels,
            "unsupported": self.unsupported,
            "warnings": self.warnings,
        }


@dataclass(frozen=True)
class SchematicExportIR:
    style: str
    devices: tuple[IRDevice, ...]
    nets: tuple[IRNet, ...]
    wires: tuple[IRWire, ...]
    junctions: tuple[IRJunction, ...]
    crossings: tuple[IRCrossing, ...]
    labels: tuple[IRLabel, ...]
    grounds: tuple[IRGround, ...]
    unsupported: tuple[IRUnsupported, ...]
    warnings: tuple[IRWarning, ...]
    stats: IRStats

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema": SCHEMA,
            "units": {
                "world": "netlab-world",
                "svg": "pt",
                "mm_per_world": MM_PER_WORLD,
                "grid_mm": GRID_MM,
            },
            "style": self.style,
            "devices": [item.to_dict() for item in self.devices],
            "nets": [item.to_dict() for item in self.nets],
            "wires": [item.to_dict() for item in self.wires],
            "junctions": [item.to_dict() for item in self.junctions],
            "crossings": [item.to_dict() for item in self.crossings],
            "labels": [item.to_dict() for item in self.labels],
            "grounds": [item.to_dict() for item in self.grounds],
            "unsupported": [item.to_dict() for item in self.unsupported],
            "warnings": [item.to_dict() for item in self.warnings],
            "stats": self.stats.to_dict(),
        }


@dataclass
class _DeviceInfo:
    id: str
    node: dict[str, Any]
    element: str
    center: dict[str, float]
    rotation: float
    pins: dict[str, IRPin]
    supported: bool
    bbox: dict[str, float] | None
    label_slots: tuple[dict[str, Any], ...]


def _num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _point(value: Any) -> dict[str, float]:
    if isinstance(value, dict):
        return {"x": _num(value.get("x")), "y": _num(value.get("y"))}
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        return {"x": _num(value[0]), "y": _num(value[1])}
    return {"x": 0.0, "y": 0.0}


def _node_position(node: dict[str, Any]) -> dict[str, float]:
    position = node.get("position")
    if isinstance(position, dict):
        return _point(position)
    return {"x": 0.0, "y": 0.0}


def _as_payload(scene: Any) -> dict[str, Any]:
    if isinstance(scene, dict):
        return copy.deepcopy(scene)
    to_payload = getattr(scene, "to_payload", None)
    if callable(to_payload):
        payload = to_payload(include_state=False)
        if isinstance(payload, dict):
            return copy.deepcopy(payload)
    raise ComputeError("原理图导出需要 Scene 或场景 payload")


def _needs_migration(payload: dict[str, Any]) -> bool:
    nodes = payload.get("nodes") or []
    edges = payload.get("edges") or []
    if any(isinstance(n, dict) and n.get("kind") == "device" for n in nodes):
        return False
    if any(isinstance(e, dict) and e.get("kind") == "wire" for e in edges):
        return False
    return True


def _rotate(dx: float, dy: float, degrees: float) -> tuple[float, float]:
    if not degrees:
        return dx, dy
    rad = math.radians(degrees)
    cos_a = math.cos(rad)
    sin_a = math.sin(rad)
    return dx * cos_a - dy * sin_a, dx * sin_a + dy * cos_a


def _anchor_offset(side: str, radius: float) -> tuple[float, float]:
    side = (side or "auto").lower()
    if side == "left":
        return -radius, 0.0
    if side == "right":
        return radius, 0.0
    if side == "top":
        return 0.0, -radius
    if side == "bottom":
        return 0.0, radius
    return 0.0, 0.0


def _format_value(params: dict[str, Any]) -> str:
    parts: list[str] = []
    for key, unit in _PARAM_UNITS:
        if key not in params:
            continue
        value = params.get(key)
        if isinstance(value, bool) or value is None:
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        text = format(number, ".6g")
        parts.append(f"{text}{unit}")
    return " / ".join(parts)


def _coord(value: float) -> float:
    """消除 90° 旋转引入的 1e-15 级浮点噪声。"""
    return round(float(value), 9)


def _rotate_bbox(
    bbox: Any, center: dict[str, float], degrees: float
) -> dict[str, float] | None:
    if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
        return None
    x1, y1, x2, y2 = (float(value) for value in bbox)
    corners: list[tuple[float, float]] = []
    for x, y in ((x1, y1), (x2, y1), (x2, y2), (x1, y2)):
        dx, dy = _rotate(x, y, degrees)
        corners.append((center["x"] + dx, center["y"] + dy))
    xs = [item[0] for item in corners]
    ys = [item[1] for item in corners]
    return {
        "left": _coord(min(xs)),
        "top": _coord(min(ys)),
        "right": _coord(max(xs)),
        "bottom": _coord(max(ys)),
    }


def _label_rect(
    anchor: dict[str, float], text: str, placement: str = "center"
) -> tuple[float, float, float, float]:
    width = max(12.0, len(text) * _LABEL_TEXT_WIDTH_FACTOR)
    height = _LABEL_TEXT_HEIGHT
    x = float(anchor["x"])
    y = float(anchor["y"])
    if placement == "right":
        return (x, y - height / 2.0, x + width, y + height / 2.0)
    if placement == "left":
        return (x - width, y - height / 2.0, x, y + height / 2.0)
    if placement == "above":
        return (x - width / 2.0, y - height, x + width / 2.0, y)
    if placement == "below":
        return (x - width / 2.0, y, x + width / 2.0, y + height)
    return (x - width / 2.0, y - height / 2.0, x + width / 2.0, y + height / 2.0)


def _rects_overlap(
    left: tuple[float, float, float, float], right: tuple[float, float, float, float]
) -> bool:
    return not (left[2] <= right[0] or right[2] <= left[0] or left[3] <= right[1] or right[3] <= left[1])


def _expand_rect(rect: tuple[float, float, float, float], margin: float) -> tuple[float, float, float, float]:
    return (rect[0] - margin, rect[1] - margin, rect[2] + margin, rect[3] + margin)


def _rect_overlap_area(
    left: tuple[float, float, float, float], right: tuple[float, float, float, float]
) -> float:
    width = min(left[2], right[2]) - max(left[0], right[0])
    height = min(left[3], right[3]) - max(left[1], right[1])
    if width <= 0.0 or height <= 0.0:
        return 0.0
    return width * height


def _segment_hits_rect(
    x1: float, y1: float, x2: float, y2: float, rect: tuple[float, float, float, float]
) -> bool:
    def inside(px: float, py: float) -> bool:
        return rect[0] <= px <= rect[2] and rect[1] <= py <= rect[3]

    if inside(x1, y1) or inside(x2, y2):
        return True
    # Liang–Barsky 裁剪：参数区间仍有效即相交。
    dx = x2 - x1
    dy = y2 - y1
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x1 - rect[0]), (dx, rect[2] - x1), (-dy, y1 - rect[1]), (dy, rect[3] - y1)):
        if abs(p) < EPSILON:
            if q < 0:
                return False
            continue
        ratio = q / p
        if p < 0:
            t0 = max(t0, ratio)
        else:
            t1 = min(t1, ratio)
        if t0 > t1:
            return False
    return True


def _placement_for(dx: float, dy: float) -> str:
    if abs(dx) >= abs(dy):
        return "right" if dx >= 0 else "left"
    return "below" if dy >= 0 else "above"


def _label_candidates(
    center: dict[str, float],
    rotation: float,
    slot_x: float,
    slot_y: float,
    bbox: dict[str, float] | None,
) -> list[tuple[float, float]]:
    base_dx, base_dy = _rotate(slot_x, slot_y, rotation)
    if abs(base_dx) < EPSILON and abs(base_dy) < EPSILON:
        base_dx, base_dy = 0.0, _LABEL_OFFSET
    length = math.hypot(base_dx, base_dy) or _LABEL_OFFSET
    candidates: list[tuple[float, float]] = []
    for sign in (1.0, -1.0):
        for factor in (1.0, 1.25, 1.5, 1.8, 2.2, 2.8, 3.4, 4.2):
            distance = length * factor
            candidates.append(
                (center["x"] + base_dx / length * distance * sign,
                 center["y"] + base_dy / length * distance * sign)
            )
    if bbox is not None:
        middle_x = (bbox["left"] + bbox["right"]) / 2.0
        middle_y = (bbox["top"] + bbox["bottom"]) / 2.0
        for gap in (8.0, 12.0, 16.0, 22.0, 30.0, 40.0, 52.0, 68.0):
            candidates.extend(
                [
                    (bbox["left"] - gap, middle_y),
                    (bbox["right"] + gap, middle_y),
                    (middle_x, bbox["top"] - gap),
                    (middle_x, bbox["bottom"] + gap),
                ]
            )
            # 器件四周被导线包围时，正上/正下也可能压在穿过器件中心的导线上；
            # 补四个对角位置，让标签能同时避开器件与相邻导线。
            candidates.extend(
                [
                    (bbox["left"] - gap, bbox["top"] - gap),
                    (bbox["right"] + gap, bbox["top"] - gap),
                    (bbox["left"] - gap, bbox["bottom"] + gap),
                    (bbox["right"] + gap, bbox["bottom"] + gap),
                ]
            )
    return candidates


def _place_label(
    text: str,
    center: dict[str, float],
    rotation: float,
    slot: dict[str, Any] | None,
    bbox: dict[str, float] | None,
    device_rects: list[tuple[float, float, float, float]],
    wire_segments: list[tuple[float, float, float, float]],
    placed_rects: list[tuple[float, float, float, float]],
) -> tuple[dict[str, float], str]:
    slot_x = float(slot.get("x", 0.0)) if isinstance(slot, dict) else 0.0
    slot_y = float(slot.get("y", 0.0)) if isinstance(slot, dict) else 0.0
    candidates = _label_candidates(center, rotation, slot_x, slot_y, bbox)
    seen: set[tuple[float, float]] = set()
    best: tuple[float, dict[str, float], str] | None = None
    for x, y in candidates:
        key = (_coord(x), _coord(y))
        if key in seen:
            continue
        seen.add(key)
        anchor = {"x": key[0], "y": key[1]}
        placement = _placement_for(key[0] - center["x"], key[1] - center["y"])
        rect = _label_rect(anchor, text, placement)
        score = 0.0
        for other in device_rects:
            score += _rect_overlap_area(rect, other) * 100.0
        wire_clearance = _expand_rect(rect, 2.0)
        hits = sum(
            1
            for x1, y1, x2, y2 in wire_segments
            if _segment_hits_rect(x1, y1, x2, y2, wire_clearance)
        )
        score += hits * 10000.0
        for other in placed_rects:
            score += _rect_overlap_area(rect, other) * 10.0
        if score <= 0.0:
            return anchor, placement
        if best is None or score < best[0]:
            best = (score, anchor, placement)
    if best is not None:
        return best[1], best[2]
    fallback = candidates[0]
    anchor = {"x": _coord(fallback[0]), "y": _coord(fallback[1])}
    placement = _placement_for(fallback[0] - center["x"], fallback[1] - center["y"])
    return anchor, placement


def _normalise_points(points: list[dict[str, float]], *, preserve_collinear: bool) -> list[dict[str, float]]:
    cleaned: list[dict[str, float]] = []
    for point in points:
        if cleaned:
            previous = cleaned[-1]
            if abs(previous["x"] - point["x"]) <= EPSILON and abs(previous["y"] - point["y"]) <= EPSILON:
                continue
        cleaned.append({"x": float(point["x"]), "y": float(point["y"])})
    if preserve_collinear or len(cleaned) <= 2:
        return cleaned
    result = [cleaned[0]]
    for index in range(1, len(cleaned) - 1):
        a = result[-1]
        b = cleaned[index]
        c = cleaned[index + 1]
        cross = (b["x"] - a["x"]) * (c["y"] - a["y"]) - (b["y"] - a["y"]) * (c["x"] - a["x"])
        if abs(cross) > EPSILON:
            result.append(b)
    result.append(cleaned[-1])
    return result


_ROUTE_CLEARANCE = 3.0
_ROUTE_ESCAPE = 8.0
_ROUTE_BEND_PENALTY = 1.2


def _orthogonal_points(start: dict[str, float], end: dict[str, float]) -> list[dict[str, float]]:
    dx = abs(end["x"] - start["x"])
    dy = abs(end["y"] - start["y"])
    if dx <= EPSILON or dy <= EPSILON:
        return [start, end]
    if dx >= dy:
        mid_x = (start["x"] + end["x"]) / 2.0
        return [start, {"x": mid_x, "y": start["y"]}, {"x": mid_x, "y": end["y"]}, end]
    mid_y = (start["y"] + end["y"]) / 2.0
    return [start, {"x": start["x"], "y": mid_y}, {"x": end["x"], "y": mid_y}, end]


def _escape_point(pin: dict[str, float], bbox: dict[str, float] | None) -> dict[str, float]:
    """从器件引脚沿最近一条 bbox 边向外退让，避免导线贴着符号走。"""
    if not bbox:
        return {"x": float(pin["x"]), "y": float(pin["y"])}
    px, py = float(pin["x"]), float(pin["y"])
    distances = (
        ("left", abs(px - float(bbox["left"]))),
        ("right", abs(px - float(bbox["right"]))),
        ("top", abs(py - float(bbox["top"]))),
        ("bottom", abs(py - float(bbox["bottom"]))),
    )
    side = min(distances, key=lambda item: item[1])[0]
    if side == "left":
        return {"x": float(bbox["left"]) - _ROUTE_ESCAPE, "y": py}
    if side == "right":
        return {"x": float(bbox["right"]) + _ROUTE_ESCAPE, "y": py}
    if side == "top":
        return {"x": px, "y": float(bbox["top"]) - _ROUTE_ESCAPE}
    return {"x": px, "y": float(bbox["bottom"]) + _ROUTE_ESCAPE}


def _obstacle_rects(obstacles: list[dict[str, float]] | None) -> list[tuple[float, float, float, float]]:
    rects: list[tuple[float, float, float, float]] = []
    for bbox in obstacles or ():
        if not bbox:
            continue
        rects.append(
            (
                float(bbox["left"]) - _ROUTE_CLEARANCE,
                float(bbox["top"]) - _ROUTE_CLEARANCE,
                float(bbox["right"]) + _ROUTE_CLEARANCE,
                float(bbox["bottom"]) + _ROUTE_CLEARANCE,
            )
        )
    return rects


def _axis_segment_blocked(
    a: dict[str, float],
    b: dict[str, float],
    rects: list[tuple[float, float, float, float]],
) -> bool:
    # 内缩极小量：沿 bbox 外侧候选线走不算穿越。
    for rect in rects:
        inner = (rect[0] + 1e-7, rect[1] + 1e-7, rect[2] - 1e-7, rect[3] - 1e-7)
        if _segment_hits_rect(a["x"], a["y"], b["x"], b["y"], inner):
            return True
    return False


def _detour_points(
    start: dict[str, float],
    end: dict[str, float],
    start_bbox: dict[str, float] | None,
    end_bbox: dict[str, float] | None,
    obstacles: list[dict[str, float]] | None,
) -> list[dict[str, float]] | None:
    """在器件 bbox 外侧做 Manhattan 最短路；失败时返回 None 交由旧折弯兜底。"""
    rects = _obstacle_rects(obstacles)
    if not rects:
        return None
    start_escape = _escape_point(start, start_bbox)
    end_escape = _escape_point(end, end_bbox)
    xs = {_coord(start_escape["x"]), _coord(end_escape["x"])}
    ys = {_coord(start_escape["y"]), _coord(end_escape["y"])}
    for left, top, right, bottom in rects:
        xs.add(_coord(left))
        xs.add(_coord(right))
        ys.add(_coord(top))
        ys.add(_coord(bottom))
    x_list = sorted(xs)
    y_list = sorted(ys)
    x_index = {value: index for index, value in enumerate(x_list)}
    y_index = {value: index for index, value in enumerate(y_list)}
    start_key = (x_index[_coord(start_escape["x"])], y_index[_coord(start_escape["y"])])
    goal_key = (x_index[_coord(end_escape["x"])], y_index[_coord(end_escape["y"])])

    def point_at(key: tuple[int, int]) -> dict[str, float]:
        return {"x": x_list[key[0]], "y": y_list[key[1]]}

    inf = float("inf")
    distances: dict[tuple[int, int, int], float] = {(*start_key, 0): 0.0}
    previous: dict[tuple[int, int, int], tuple[int, int, int]] = {}
    heap: list[tuple[float, int, int, int]] = [(0.0, start_key[0], start_key[1], 0)]
    goal_state: tuple[int, int, int] | None = None
    while heap:
        cost, xi, yi, direction = heapq.heappop(heap)
        state = (xi, yi, direction)
        if cost > distances.get(state, inf):
            continue
        if (xi, yi) == goal_key:
            goal_state = state
            break
        here = point_at((xi, yi))
        for dxi, dyi, next_direction in ((1, 0, 1), (-1, 0, 1), (0, 1, 2), (0, -1, 2)):
            nxi, nyi = xi + dxi, yi + dyi
            if not (0 <= nxi < len(x_list) and 0 <= nyi < len(y_list)):
                continue
            there = point_at((nxi, nyi))
            if _axis_segment_blocked(here, there, rects):
                continue
            step = math.hypot(there["x"] - here["x"], there["y"] - here["y"])
            turn = _ROUTE_BEND_PENALTY if direction and direction != next_direction else 0.0
            next_cost = cost + step + turn
            next_state = (nxi, nyi, next_direction)
            if next_cost < distances.get(next_state, inf) - EPSILON:
                distances[next_state] = next_cost
                previous[next_state] = state
                heapq.heappush(heap, (next_cost, nxi, nyi, next_direction))
    if goal_state is None:
        return None
    path: list[dict[str, float]] = []
    state = goal_state
    while True:
        path.append(point_at((state[0], state[1])))
        if state not in previous:
            break
        state = previous[state]
    path.reverse()
    return [start_escape, *path]


def _route_points(
    start: dict[str, float],
    end: dict[str, float],
    route: str,
    waypoints: list[Any],
    route_mode: str,
    *,
    obstacles: list[dict[str, float]] | None = None,
    start_bbox: dict[str, float] | None = None,
    end_bbox: dict[str, float] | None = None,
) -> tuple[list[dict[str, float]], str]:
    route = (route or "auto").lower()
    explicit_waypoints = [_point(item) for item in waypoints if isinstance(item, (dict, list, tuple))]
    if route == "manual" or explicit_waypoints:
        # 手动折点是作者意图，原样保留（包括与引脚重合的第一个折点），不自动合并。
        return [dict(start), *[dict(item) for item in explicit_waypoints], dict(end)], "manual"
    if route == "straight":
        return _normalise_points([start, end], preserve_collinear=True), "straight"
    if route == "free":
        return _normalise_points([start, end], preserve_collinear=True), "free"
    if route_mode == "free":
        return _normalise_points([start, end], preserve_collinear=True), "free"
    detour = _detour_points(start, end, start_bbox, end_bbox, obstacles)
    points = [start, *detour, end] if detour is not None else _orthogonal_points(start, end)
    return _normalise_points(points, preserve_collinear=False), "orthogonal"


def _segment_point_distance(point: dict[str, float], a: dict[str, float], b: dict[str, float]) -> float:
    ax, ay = a["x"], a["y"]
    bx, by = b["x"], b["y"]
    px, py = point["x"], point["y"]
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    if length_sq <= EPSILON:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / length_sq
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _point_on_segment(point: dict[str, float], a: dict[str, float], b: dict[str, float]) -> bool:
    if _segment_point_distance(point, a, b) > 1e-7:
        return False
    return (
        min(a["x"], b["x"]) - EPSILON <= point["x"] <= max(a["x"], b["x"]) + EPSILON
        and min(a["y"], b["y"]) - EPSILON <= point["y"] <= max(a["y"], b["y"]) + EPSILON
    )


def _segment_intersection(
    p1: dict[str, float], p2: dict[str, float], p3: dict[str, float], p4: dict[str, float]
) -> dict[str, float] | None:
    x1, y1 = p1["x"], p1["y"]
    x2, y2 = p2["x"], p2["y"]
    x3, y3 = p3["x"], p3["y"]
    x4, y4 = p4["x"], p4["y"]
    dx1, dy1 = x2 - x1, y2 - y1
    dx2, dy2 = x4 - x3, y4 - y3
    denominator = dx1 * dy2 - dy1 * dx2
    if abs(denominator) <= EPSILON:
        return None
    t = ((x3 - x1) * dy2 - (y3 - y1) * dx2) / denominator
    u = ((x3 - x1) * dy1 - (y3 - y1) * dx1) / denominator
    if -EPSILON <= t <= 1.0 + EPSILON and -EPSILON <= u <= 1.0 + EPSILON:
        return {"x": x1 + t * dx1, "y": y1 + t * dy1}
    return None


def _same_point(left: dict[str, float], right: dict[str, float]) -> bool:
    return abs(left["x"] - right["x"]) <= 1e-7 and abs(left["y"] - right["y"]) <= 1e-7


def _at_endpoint(point: dict[str, float], segment: tuple[dict[str, float], dict[str, float]]) -> bool:
    return _same_point(point, segment[0]) or _same_point(point, segment[1])


def _classify_wire_endpoint(
    endpoint_id: str,
    pin_name: str,
    side: str,
    device_map: dict[str, _DeviceInfo],
    net_map: dict[str, dict[str, Any]],
) -> dict[str, float]:
    if endpoint_id in device_map:
        info = device_map[endpoint_id]
        pin = info.pins.get(pin_name)
        if pin is not None:
            return {"x": pin.x, "y": pin.y}
        dx, dy = _anchor_offset(side, _DEVICE_ANCHOR_RADIUS)
        return {"x": info.center["x"] + dx, "y": info.center["y"] + dy}
    node = net_map.get(endpoint_id)
    if node is not None:
        center = _node_position(node)
        dx, dy = _anchor_offset(side, _NET_ANCHOR_RADIUS)
        return {"x": center["x"] + dx, "y": center["y"] + dy}
    return {"x": 0.0, "y": 0.0}


def build_schematic_export_ir(scene: Any, *, options: ExportOptions | None = None) -> SchematicExportIR:
    """把电路场景归一化为 SchematicExportIR；不修改输入。"""
    options = options or ExportOptions()
    payload = _as_payload(scene)
    if payload.get("mode") != "circuit":
        raise ComputeError("原理图导出仅支持电路模式")
    if _needs_migration(payload):
        from ..model.project import migrate_scene_to_devices

        payload = migrate_scene_to_devices(payload)

    raw_nodes = payload.get("nodes")
    raw_edges = payload.get("edges")
    if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
        raise ComputeError("场景必须包含 nodes 与 edges 数组")

    nodes = [item for item in raw_nodes if isinstance(item, dict)]
    edges = [item for item in raw_edges if isinstance(item, dict)]
    net_map: dict[str, dict[str, Any]] = {
        str(node.get("id") or ""): node for node in nodes if node.get("kind") != "device"
    }
    device_map: dict[str, _DeviceInfo] = {}
    unsupported: list[IRUnsupported] = []
    warnings: list[IRWarning] = []
    warning_keys: set[tuple[str, str, str]] = set()

    def warn(code: str, message: str, owner_id: str = "") -> None:
        key = (code, message, owner_id)
        if key not in warning_keys:
            warning_keys.add(key)
            warnings.append(IRWarning(code=code, message=message, owner_id=owner_id))

    for node in nodes:
        if node.get("kind") != "device":
            continue
        node_id = str(node.get("id") or "")
        params = node.get("params") if isinstance(node.get("params"), dict) else {}
        element = str(params.get("element") or "")
        center = _node_position(node)
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        rotation = _num(data.get("rotation"))
        pin_map: dict[str, IRPin] = {}
        bbox: dict[str, float] | None = None
        label_slots: tuple[dict[str, Any], ...] = ()
        if element in PINS:
            try:
                symbol = symbol_spec(element, options.style)
            except (SymbolSpecError, UnsupportedSymbolError) as exc:
                warn("missing_symbol", f"器件 {element} 缺少 {options.style} 符号：{exc}", node_id)
            else:
                coordinates = {
                    str(item.get("name")): item for item in symbol.get("pins", [])
                }
                for spec in pins_for_device(element):
                    symbol_pin = coordinates.get(spec.name)
                    if symbol_pin is None:
                        continue
                    dx, dy = _rotate(
                        float(symbol_pin.get("x", 0.0)),
                        float(symbol_pin.get("y", 0.0)),
                        rotation,
                    )
                    pin_map[spec.name] = IRPin(
                        name=spec.name,
                        role=spec.role,
                        required=spec.required,
                        x=_coord(center["x"] + dx),
                        y=_coord(center["y"] + dy),
                    )
                bbox = _rotate_bbox(symbol.get("bbox"), center, rotation)
                label_slots = tuple(copy.deepcopy(symbol.get("label_slots") or ()))
        else:
            unsupported.append(
                IRUnsupported(
                    id=node_id,
                    kind=element,
                    name=str(node.get("name") or ""),
                    reason="unknown_element",
                )
            )
            warn("unsupported_device", f"不支持的器件类型：{element or '<空>'}", node_id)
        device_map[node_id] = _DeviceInfo(
            id=node_id,
            node=node,
            element=element,
            center=center,
            rotation=rotation,
            pins=pin_map,
            supported=element in PINS,
            bbox=bbox,
            label_slots=label_slots,
        )

    # 兼容垫片：迁移后仍未转换的旧元件边，显式记为不支持，不静默丢弃。
    for edge in edges:
        kind = str(edge.get("kind") or "")
        if kind == "wire":
            continue
        edge_id = str(edge.get("id") or "")
        if edge_id in device_map:
            continue
        params = edge.get("params") if isinstance(edge.get("params"), dict) else {}
        layout = edge.get("layout") if isinstance(edge.get("layout"), dict) else {}
        source = net_map.get(str(edge.get("source") or ""))
        target = net_map.get(str(edge.get("target") or ""))
        if layout.get("x") is not None and layout.get("y") is not None:
            center = {"x": _num(layout.get("x")), "y": _num(layout.get("y"))}
        elif source is not None and target is not None:
            a = _node_position(source)
            b = _node_position(target)
            center = {"x": (a["x"] + b["x"]) / 2.0, "y": (a["y"] + b["y"]) / 2.0}
        else:
            center = {"x": 0.0, "y": 0.0}
        unsupported.append(
            IRUnsupported(
                id=edge_id,
                kind=kind,
                name=str(edge.get("name") or ""),
                reason="legacy_edge_not_migrated" if kind in PINS else "unknown_element",
            )
        )
        warn("unsupported_device", f"旧元件边无法迁移：{edge_id} ({kind})", edge_id)

    # 并查集：网络节点之间的导线把网络合并。
    parent: dict[str, str] = {node_id: node_id for node_id in net_map}

    def find(item: str) -> str:
        root = item
        while parent.get(root, root) != root:
            root = parent[root]
        while parent.get(item, item) != item:
            nxt = parent[item]
            parent[item] = root
            item = nxt
        return root

    def union(left: str, right: str) -> None:
        root_left = find(left)
        root_right = find(right)
        if root_left != root_right:
            parent[root_right] = root_left

    for edge in edges:
        if edge.get("kind") != "wire":
            continue
        source_id = str(edge.get("source") or "")
        target_id = str(edge.get("target") or "")
        if source_id in net_map and target_id in net_map:
            union(source_id, target_id)

    groups: dict[str, list[str]] = {}
    for node_id in net_map:
        groups.setdefault(find(node_id), []).append(node_id)

    canonical_by_node: dict[str, str] = {}
    net_objects: dict[str, IRNet] = {}
    for members in groups.values():
        canonical_node = min(
            members,
            key=lambda item: (
                _node_position(net_map[item])["x"],
                _node_position(net_map[item])["y"],
                str(net_map[item].get("name") or ""),
                item,
            ),
        )
        node = net_map[canonical_node]
        is_ground = any(str(net_map[item].get("kind") or "") == "ground" for item in members)
        net_id = canonical_node
        for item in members:
            canonical_by_node[item] = net_id
        net_objects[net_id] = IRNet(
            id=net_id,
            name=str(node.get("name") or net_id),
            members=(),
            is_ground=is_ground,
        )

    net_members: dict[str, set[tuple[str, str]]] = {net_id: set() for net_id in net_objects}
    wire_objects: list[IRWire] = []
    synthetic_nets: dict[str, IRNet] = {}

    for index, edge in enumerate(edges):
        if edge.get("kind") != "wire":
            continue
        edge_id = str(edge.get("id") or f"wire-{index}")
        source_id = str(edge.get("source") or "")
        target_id = str(edge.get("target") or "")
        source_pin = str(edge.get("source_pin") or "")
        target_pin = str(edge.get("target_pin") or "")
        anchors = edge.get("anchors") if isinstance(edge.get("anchors"), dict) else {}
        source_side = str(anchors.get("source") or "auto")
        target_side = str(anchors.get("target") or "auto")

        source_is_device = source_id in device_map
        target_is_device = target_id in device_map
        source_is_net = source_id in net_map
        target_is_net = target_id in net_map
        if not (source_is_device or source_is_net):
            warn("missing_wire_endpoint", f"导线 {edge_id} 的源端不存在：{source_id}", edge_id)
        if not (target_is_device or target_is_net):
            warn("missing_wire_endpoint", f"导线 {edge_id} 的目标端不存在：{target_id}", edge_id)

        net_id = ""
        if source_is_net:
            net_id = canonical_by_node.get(source_id, source_id)
        elif target_is_net:
            net_id = canonical_by_node.get(target_id, target_id)
        else:
            net_id = f"__wire_net__:{edge_id}"
            synthetic_nets[net_id] = IRNet(
                id=net_id,
                name=str(edge.get("name") or edge_id),
                members=(),
                is_ground=False,
            )
            net_members.setdefault(net_id, set())

        if source_is_device and not source_pin:
            warn("missing_pin_binding", f"导线 {edge_id} 缺少 source_pin", edge_id)
        elif source_is_device and source_pin not in device_map[source_id].pins:
            warn("missing_pin_binding", f"导线 {edge_id} 的 source_pin 无效：{source_pin}", edge_id)
        if target_is_device and not target_pin:
            warn("missing_pin_binding", f"导线 {edge_id} 缺少 target_pin", edge_id)
        elif target_is_device and target_pin not in device_map[target_id].pins:
            warn("missing_pin_binding", f"导线 {edge_id} 的 target_pin 无效：{target_pin}", edge_id)

        if source_is_device and source_pin in device_map[source_id].pins:
            net_members[net_id].add((source_id, source_pin))
        if target_is_device and target_pin in device_map[target_id].pins:
            net_members[net_id].add((target_id, target_pin))
        if source_is_device and not source_pin:
            net_members[net_id].add((source_id, ""))
        if target_is_device and not target_pin:
            net_members[net_id].add((target_id, ""))

        start = _classify_wire_endpoint(source_id, source_pin, source_side, device_map, net_map)
        end = _classify_wire_endpoint(target_id, target_pin, target_side, device_map, net_map)
        waypoints = edge.get("waypoints") if isinstance(edge.get("waypoints"), list) else []
        obstacles = [info.bbox for info in device_map.values() if info.bbox]
        start_bbox = device_map[source_id].bbox if source_is_device and source_id in device_map else None
        end_bbox = device_map[target_id].bbox if target_is_device and target_id in device_map else None
        points, route_source = _route_points(
            start,
            end,
            str(edge.get("route") or "auto"),
            waypoints,
            options.route_mode,
            obstacles=obstacles,
            start_bbox=start_bbox,
            end_bbox=end_bbox,
        )
        if len(points) == 1:
            warn("zero_length_wire", f"导线 {edge_id} 起终点相同", edge_id)
        wire_objects.append(
            IRWire(
                id=edge_id,
                net_id=net_id,
                points=tuple(points),
                source_pin=source_pin,
                target_pin=target_pin,
                route_source=route_source,
            )
        )

    for net_id, members in net_members.items():
        if net_id in synthetic_nets:
            net_objects[net_id] = IRNet(
                id=synthetic_nets[net_id].id,
                name=synthetic_nets[net_id].name,
                members=tuple(
                    {"device": device, "pin": pin} for device, pin in sorted(members)
                ),
                is_ground=False,
            )
        elif net_id in net_objects:
            current = net_objects[net_id]
            net_objects[net_id] = IRNet(
                id=current.id,
                name=current.name,
                members=tuple(
                    {"device": device, "pin": pin} for device, pin in sorted(members)
                ),
                is_ground=current.is_ground,
            )

    # 器件表：按 name/id 稳定排序。
    devices: list[IRDevice] = []
    for info in sorted(device_map.values(), key=lambda item: (str(item.node.get("name") or ""), item.id)):
        params = info.node.get("params") if isinstance(info.node.get("params"), dict) else {}
        devices.append(
            IRDevice(
                id=info.id,
                kind=info.element,
                name=str(info.node.get("name") or ""),
                params={key: copy.deepcopy(value) for key, value in params.items() if key != "element"},
                center=dict(info.center),
                rotation_deg=info.rotation,
                bbox=dict(info.bbox) if info.bbox is not None else None,
                pins=tuple(info.pins.values()),
            )
        )

    # junction：同一 net 的三个或以上导线腿在同一规范化点相遇。
    junction_map: dict[tuple[float, float], IRJunction] = {}
    for net_id, net in net_objects.items():
        net_wires = [wire for wire in wire_objects if wire.net_id == net_id]
        segments: list[tuple[dict[str, float], dict[str, float]]] = []
        candidates: list[dict[str, float]] = []
        for wire in net_wires:
            for point in wire.points:
                candidates.append(point)
            for left, right in zip(wire.points, wire.points[1:]):
                segments.append((left, right))
        if not segments:
            continue
        for point in candidates:
            endpoint_legs = 0
            for segment in segments:
                if _at_endpoint(point, segment):
                    endpoint_legs += 1
            # S1 先按“同一 net 的三个或以上导线端点”判定；引脚级 T 分支
            # 需要真实 symbol 引脚坐标，留到 S3 与路由一起收口。
            if endpoint_legs >= 3:
                key = (round(point["x"], 9), round(point["y"], 9))
                junction_map[key] = IRJunction(x=point["x"], y=point["y"], reason="branch")

    # crossing：不同 net 的线段相交，默认不连接。
    crossing_map: dict[tuple[float, float, str, str], IRCrossing] = {}
    for left_index, left in enumerate(wire_objects):
        for right in wire_objects[left_index + 1 :]:
            if left.net_id == right.net_id:
                continue
            for a1, a2 in zip(left.points, left.points[1:]):
                for b1, b2 in zip(right.points, right.points[1:]):
                    point = _segment_intersection(a1, a2, b1, b2)
                    if point is None:
                        continue
                    junction_key = (round(point["x"], 9), round(point["y"], 9))
                    if junction_key in junction_map:
                        # 同一分支节点上的“交叉”是电气连接，不是几何交叉。
                        continue
                    left_end = _at_endpoint(point, (a1, a2))
                    right_end = _at_endpoint(point, (b1, b2))
                    if left_end and right_end:
                        # 器件引脚当前都落在器件中心；两条不同网络的线从同一器件中心
                        # 出发并不等于电气相连，也不是可视交叉，交给符号层区分引脚。
                        continue
                    over, under = sorted((left.id, right.id))
                    key = (round(point["x"], 9), round(point["y"], 9), over, under)
                    crossing_map[key] = IRCrossing(
                        x=point["x"], y=point["y"], over_wire_id=over, under_wire_id=under
                    )

    labels: list[IRLabel] = []
    device_rects: list[tuple[float, float, float, float]] = []
    for info in device_map.values():
        if info.bbox is not None:
            device_rects.append(
                (
                    info.bbox["left"],
                    info.bbox["top"],
                    info.bbox["right"],
                    info.bbox["bottom"],
                )
            )
    wire_segments: list[tuple[float, float, float, float]] = []
    for wire in wire_objects:
        for left, right in zip(wire.points, wire.points[1:]):
            wire_segments.append((left["x"], left["y"], right["x"], right["y"]))
    placed_rects: list[tuple[float, float, float, float]] = []
    for info in sorted(device_map.values(), key=lambda item: (str(item.node.get("name") or ""), item.id)):
        name = str(info.node.get("name") or "")
        entries: list[tuple[str, str]] = []
        if name:
            entries.append(("designator", name))
        if options.include_values and info.supported:
            params = info.node.get("params") if isinstance(info.node.get("params"), dict) else {}
            value_text = _format_value(params)
            if value_text:
                entries.append(("value", value_text))
        for role, text in entries:
            slot = next(
                (item for item in info.label_slots if str(item.get("role") or "") == role),
                None,
            )
            anchor, placement = _place_label(
                text,
                info.center,
                info.rotation,
                slot,
                info.bbox,
                device_rects,
                wire_segments,
                placed_rects,
            )
            labels.append(
                IRLabel(
                    text=text,
                    anchor=anchor,
                    placement=placement,
                    owner_id=info.id,
                    role=role,
                )
            )
            placed_rects.append(_label_rect(anchor, text, placement))

    sorted_warnings = tuple(sorted(warnings, key=lambda item: (item.code, item.owner_id, item.message)))
    sorted_nets = tuple(sorted(net_objects.values(), key=lambda item: item.id))
    sorted_wires = tuple(sorted(wire_objects, key=lambda item: item.id))
    sorted_junctions = tuple(sorted(junction_map.values(), key=lambda item: (item.x, item.y)))
    sorted_crossings = tuple(
        sorted(crossing_map.values(), key=lambda item: (item.x, item.y, item.over_wire_id, item.under_wire_id))
    )
    sorted_labels = tuple(sorted(labels, key=lambda item: (item.owner_id, item.role, item.text)))
    sorted_unsupported = tuple(sorted(unsupported, key=lambda item: item.id))

    stats = IRStats(
        nodes=len(nodes),
        devices=len(devices),
        wires=len(sorted_wires),
        junctions=len(sorted_junctions),
        crossings=len(sorted_crossings),
        labels=len(sorted_labels),
        unsupported=len(sorted_unsupported),
        warnings=len(sorted_warnings),
    )
    grounds = tuple(
        sorted(
            (
                IRGround(
                    id=node_id,
                    x=_node_position(node)["x"],
                    y=_node_position(node)["y"],
                    net_id=node_id,
                )
                for node_id, node in net_map.items()
                if str(node.get("kind") or "") == "ground"
            ),
            key=lambda item: item.id,
        )
    )
    return SchematicExportIR(
        style=options.style,
        devices=tuple(devices),
        nets=sorted_nets,
        wires=sorted_wires,
        junctions=sorted_junctions,
        crossings=sorted_crossings,
        labels=sorted_labels,
        grounds=grounds,
        unsupported=sorted_unsupported,
        warnings=sorted_warnings,
        stats=stats,
    )


__all__ = [
    "SCHEMA",
    "IRGround",
    "MM_PER_WORLD",
    "WORLD_PER_GRID",
    "GRID_MM",
    "EPSILON",
    "ExportOptions",
    "IRPin",
    "IRDevice",
    "IRNet",
    "IRWire",
    "IRJunction",
    "IRCrossing",
    "IRLabel",
    "IRUnsupported",
    "IRWarning",
    "IRStats",
    "SchematicExportIR",
    "world_to_mm",
    "mm_to_world",
    "build_schematic_export_ir",
]
