"""S2：GB/classic 声明式符号规格到 SchemDraw 的适配器。

设计约束（见 docs/SCHEMATIC_EXPORT_GB_PLAN.md §5.2）：
- 规格文件是唯一图形与引脚来源；器件图形和 pin anchors 不各写一份。
- 只允许有限声明式 primitive，编译为 SchemDraw 公开 Segment 对象。
- 不向 Drawing 直接注入完整 SVG 片段。
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from schemdraw.elements import Element
from schemdraw.segments import Segment, SegmentArc, SegmentCircle, SegmentPoly, SegmentText

from netlab.core.model.ports import PINS

SYMBOL_SCHEMA = "netlab-schematic-symbols/1"
STYLES: tuple[str, ...] = ("gb", "classic")
PRIMITIVE_TYPES = frozenset({"line", "polyline", "circle", "arc", "polygon", "text"})


class SymbolSpecError(ValueError):
    """符号规格不合法。"""


class UnsupportedSymbolError(KeyError):
    """器件 kind 没有声明式符号规格。"""


def _symbols_path() -> Path:
    return Path(__file__).with_name("symbols") / "gb.json"


def _number(value: Any, *, where: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise SymbolSpecError(f"{where} 必须是数值")
    return float(value)


def _validate_primitive(primitive: Mapping[str, Any], *, where: str) -> None:
    kind = primitive.get("type")
    if kind not in PRIMITIVE_TYPES:
        raise SymbolSpecError(f"{where}: 不支持的 primitive 类型 {kind!r}")
    if kind in {"line", "polyline", "polygon"}:
        points = primitive.get("points")
        if not isinstance(points, list) or len(points) < 2:
            raise SymbolSpecError(f"{where}: {kind} 至少需要两个点")
        for point in points:
            if not isinstance(point, list) or len(point) != 2:
                raise SymbolSpecError(f"{where}: 点必须是 [x, y]")
            _number(point[0], where=where)
            _number(point[1], where=where)
    elif kind == "circle":
        center = primitive.get("center")
        if not isinstance(center, list) or len(center) != 2:
            raise SymbolSpecError(f"{where}: circle.center 必须是 [x, y]")
        if _number(primitive.get("radius"), where=f"{where}.radius") <= 0:
            raise SymbolSpecError(f"{where}: circle.radius 必须为正")
    elif kind == "arc":
        center = primitive.get("center")
        if not isinstance(center, list) or len(center) != 2:
            raise SymbolSpecError(f"{where}: arc.center 必须是 [x, y]")
        for key in ("width", "height"):
            if _number(primitive.get(key), where=f"{where}.{key}") <= 0:
                raise SymbolSpecError(f"{where}: arc.{key} 必须为正")
    elif kind == "text":
        if not isinstance(primitive.get("text"), str) or not primitive["text"]:
            raise SymbolSpecError(f"{where}: text.text 不能为空")
        pos = primitive.get("pos")
        if not isinstance(pos, list) or len(pos) != 2:
            raise SymbolSpecError(f"{where}: text.pos 必须是 [x, y]")


def _validate_specs(data: Mapping[str, Any]) -> None:
    if data.get("schema") != SYMBOL_SCHEMA:
        raise SymbolSpecError(f"符号 schema 不受支持：{data.get('schema')!r}")
    if data.get("coordinate_system") != "cartesian_y_up":
        raise SymbolSpecError("符号坐标系必须是 cartesian_y_up")
    styles = data.get("styles")
    if styles != list(STYLES):
        raise SymbolSpecError(f"符号 styles 必须是 {list(STYLES)!r}")
    symbols = data.get("symbols")
    if not isinstance(symbols, dict):
        raise SymbolSpecError("symbols 必须是对象")
    if set(symbols) != set(PINS):
        missing = sorted(set(PINS) - set(symbols))
        extra = sorted(set(symbols) - set(PINS))
        raise SymbolSpecError(f"符号 kind 与 ports.PINS 不一致；缺少={missing}，多出={extra}")
    for kind, spec in symbols.items():
        if not isinstance(spec, dict):
            raise SymbolSpecError(f"{kind}: spec 必须是对象")
        pin_rows = spec.get("pins")
        if not isinstance(pin_rows, list) or not pin_rows:
            raise SymbolSpecError(f"{kind}: pins 不能为空")
        names: list[str] = []
        for index, pin in enumerate(pin_rows):
            if not isinstance(pin, dict) or not isinstance(pin.get("name"), str):
                raise SymbolSpecError(f"{kind}.pins[{index}]: 缺少 name")
            names.append(pin["name"])
            _number(pin.get("x"), where=f"{kind}.pins[{index}].x")
            _number(pin.get("y"), where=f"{kind}.pins[{index}].y")
        expected = [pin.name for pin in PINS[kind]]
        if names != expected:
            raise SymbolSpecError(
                f"{kind}: 符号引脚名必须与 ports.PINS 一致；得到 {names!r}，期望 {expected!r}"
            )
        bbox = spec.get("bbox")
        if not isinstance(bbox, list) or len(bbox) != 4:
            raise SymbolSpecError(f"{kind}: bbox 必须是四个数")
        for value in bbox:
            _number(value, where=f"{kind}.bbox")
        if not isinstance(spec.get("label_slots"), list):
            raise SymbolSpecError(f"{kind}: label_slots 必须是数组")
        if spec.get("rotation_policy") not in {"free", "orthogonal"}:
            raise SymbolSpecError(f"{kind}: rotation_policy 不合法")
        variants = spec.get("variants")
        if not isinstance(variants, dict) or set(variants) != set(STYLES):
            raise SymbolSpecError(f"{kind}: variants 必须同时包含 gb 和 classic")
        for style, variant in variants.items():
            primitives = variant.get("primitives") if isinstance(variant, dict) else None
            if not isinstance(primitives, list) or not primitives:
                raise SymbolSpecError(f"{kind}.{style}: primitives 不能为空")
            for index, primitive in enumerate(primitives):
                _validate_primitive(primitive, where=f"{kind}.{style}.primitives[{index}]")


@lru_cache(maxsize=4)
def _load_symbol_specs_cached(path: str) -> dict[str, Any]:
    file_path = Path(path)
    try:
        raw = file_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise SymbolSpecError(f"无法读取符号规格：{file_path}") from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SymbolSpecError(f"符号规格 JSON 不合法：{exc}") from exc
    if not isinstance(data, dict):
        raise SymbolSpecError("符号规格根节点必须是对象")
    _validate_specs(data)
    return data


def load_symbol_specs(path: str | Path | None = None) -> dict[str, Any]:
    """读取并校验符号规格；不缓存调用方传入的临时路径。"""
    return _load_symbol_specs_cached(str(path) if path is not None else str(_symbols_path()))


def supported_kinds() -> tuple[str, ...]:
    return tuple(load_symbol_specs()["symbols"])


def symbol_spec(kind: str, style: str = "gb") -> dict[str, Any]:
    if style not in STYLES:
        raise SymbolSpecError(f"不支持的符号风格：{style!r}")
    try:
        return load_symbol_specs()["symbols"][kind]
    except KeyError as exc:
        raise UnsupportedSymbolError(kind) from exc


def symbol_inventory() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for kind, spec in load_symbol_specs()["symbols"].items():
        rows.append(
            {
                "kind": kind,
                "status": "supported",
                "styles": list(STYLES),
                "pin_count": len(spec["pins"]),
                "bbox": list(spec["bbox"]),
            }
        )
    return rows


def primitive_segments(primitives: Iterable[Mapping[str, Any]]) -> list[Any]:
    """把声明式 primitive 编译为显式 SchemDraw Segment 对象。"""
    segments: list[Any] = []
    for primitive in primitives:
        kind = primitive["type"]
        if kind in {"line", "polyline"}:
            segments.append(Segment([tuple(point) for point in primitive["points"]]))
        elif kind == "polygon":
            segments.append(
                SegmentPoly(
                    [tuple(point) for point in primitive["points"]],
                    closed=True,
                    fill=bool(primitive.get("fill", False)),
                )
            )
        elif kind == "circle":
            segments.append(
                SegmentCircle(tuple(primitive["center"]), float(primitive["radius"]))
            )
        elif kind == "arc":
            segments.append(
                SegmentArc(
                    tuple(primitive["center"]),
                    float(primitive["width"]),
                    float(primitive["height"]),
                    theta1=float(primitive.get("theta1", 0.0)),
                    theta2=float(primitive.get("theta2", 180.0)),
                )
            )
        elif kind == "text":
            segments.append(
                SegmentText(
                    tuple(primitive["pos"]),
                    str(primitive["text"]),
                    fontsize=float(primitive.get("size", 8.0)),
                )
            )
        else:  # pragma: no cover - validated earlier
            raise SymbolSpecError(f"不支持的 primitive 类型：{kind!r}")
    return segments


class GBElement(Element):
    """按声明式规格生成的 SchemDraw 元件。"""

    def __init__(self, kind: str, style: str = "gb", **kwargs: Any) -> None:
        super().__init__(**kwargs)
        spec = symbol_spec(kind, style)
        self.kind = kind
        self.style = style
        self.anchors.update(
            {pin["name"]: (float(pin["x"]), float(pin["y"])) for pin in spec["pins"]}
        )
        self.segments.extend(primitive_segments(spec["variants"][style]["primitives"]))
