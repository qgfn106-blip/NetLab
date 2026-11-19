"""R18/R19 + S4：把电路场景通过 SchematicExportIR 导出为静态 SVG。

设计边界：
- IR 负责兼容旧场景、器件/网络/导线/标签语义，渲染器只消费 IR；
- 符号图形来自 schematic_symbols.GBElement（SchemDraw 公开 Element/Segment API）；
- SchemDraw 缺失时抛 ComputeError，由 API 返回可读安装提示；
- 本模块不写用户文件，destination 由桌面壳/浏览器负责。
"""

from __future__ import annotations

import html
import json
import re
from typing import Any

from .nodal import ComputeError
from .schematic_export_ir import (
    SCHEMA,
    ExportOptions,
    SchematicExportIR,
    build_schematic_export_ir,
)
from .schematic_symbols import GBElement, SymbolSpecError, UnsupportedSymbolError


def _load_schemdraw() -> tuple[Any, Any]:
    try:
        import matplotlib
        import schemdraw
        from schemdraw import elements as el
    except ImportError as exc:  # pragma: no cover - 环境差异
        raise ComputeError(
            "导出原理图需要 SchemDraw：请运行 python -m pip install schemdraw"
        ) from exc
    # 保留可搜索/可访问的 <text>，而不是把文字转成 path 轮廓。
    matplotlib.rcParams["svg.fonttype"] = "none"
    # 0.127 mm/world × 20 world/grid = 2.54 mm；1 world = 0.127 mm = 0.005 in。
    # 不设置时 SchemDraw 默认 0.5 in/world，导出图为物理尺寸的 100 倍且线宽过细。
    schemdraw.config(inches_per_unit=0.005)
    return schemdraw, el


def _strip_svg_noise(text: str) -> str:
    """去掉 matplotlib 注入的时间戳/注释，保证同一 IR 可复现。"""
    text = re.sub(r"<metadata>.*?</metadata>", "", text, flags=re.DOTALL)
    text = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
    return text


def _decorate_svg(svg: str, title: str, meta: str) -> str:
    """给 SchemDraw 的 SVG 套一层打印图框：留白 + 边框 + 标题栏。"""
    match = re.search(r'viewBox="0 0 ([0-9.]+) ([0-9.]+)"', svg)
    if not match:
        return svg
    width, height = float(match.group(1)), float(match.group(2))
    pad_x, pad_top, pad_bottom = 18.0, 34.0, 30.0
    outer_w = width + pad_x * 2
    outer_h = height + pad_top + pad_bottom
    svg = svg.replace(match.group(0), f'viewBox="0 0 {outer_w:g} {outer_h:g}"')
    svg = re.sub(r'width="[0-9.]+(?:pt|px)?"', f'width="{outer_w:g}pt"', svg, count=1)
    svg = re.sub(r'height="[0-9.]+(?:pt|px)?"', f'height="{outer_h:g}pt"', svg, count=1)
    head = f"""<rect x="0.5" y="0.5" width="{outer_w - 1:g}" height="{outer_h - 1:g}" fill="#ffffff" stroke="#333333" stroke-width="1.2"/>
<rect x="5" y="5" width="{outer_w - 10:g}" height="{outer_h - 10:g}" fill="none" stroke="#333333" stroke-width="0.6"/>
<text x="10" y="19" font-family="Microsoft YaHei, sans-serif" font-size="10" font-weight="600" fill="#222222">{html.escape(title)}</text>
<text x="10" y="29" font-family="Microsoft YaHei, sans-serif" font-size="7" fill="#666666">{html.escape(meta)}</text>
<g transform="translate({pad_x:g},{pad_top:g})">"""
    svg = re.sub(r"(<svg\b[^>]*>)", r"\1" + head, svg, count=1)
    footer = (
        f'</g><text x="{outer_w - 12:g}" y="{outer_h - 10:g}" text-anchor="end" '
        'font-family="Microsoft YaHei, sans-serif" font-size="6" fill="#777777">'
        "NetLab</text></svg>"
    )
    return svg.replace("</svg>", footer, 1)


def _label_halign(placement: str) -> str:
    if placement == "left":
        return "right"
    if placement == "right":
        return "left"
    return "center"


def _label_valign(placement: str) -> str:
    if placement == "above":
        return "bottom"
    if placement == "below":
        return "top"
    return "center"


def _draw_unknown(drawing: Any, el: Any, device: Any) -> None:
    cx = float(device.center["x"])
    cy = -float(device.center["y"])
    half_w, half_h = 40.0, 30.0
    points = [
        (cx - half_w, cy - half_h),
        (cx + half_w, cy - half_h),
        (cx + half_w, cy + half_h),
        (cx - half_w, cy + half_h),
        (cx - half_w, cy - half_h),
    ]
    for start, end in zip(points, points[1:]):
        drawing.add(el.Line().at(start).to(end))
    drawing.add(el.Label().at((cx, cy)).label(f"不支持: {device.kind}", fontsize=8))


def _attr(value: Any) -> str:
    return html.escape(str(value), quote=True)


def _structure_layer(ir: SchematicExportIR) -> str:
    """附加机器可读结构层（display:none），不改变视觉渲染。

    结构 oracle 需要稳定的 owner id、pin anchor、junction/crossing 坐标，
    但 Matplotlib 的 line2d 分组不稳定；这里以独立结构层承载，不改动
    SchemDraw 的真实图形。
    """
    root = '<g id="netlab-structure" display="none" data-schema="netlab-schematic-structure/1">'
    parts = [root]
    for device in ir.devices:
        bbox = device.bbox or {}
        parts.append(
            '<g class="netlab-symbol" data-owner-id="%s" data-kind="%s" data-name="%s" '
            'data-center-x="%s" data-center-y="%s" data-rotation="%s" '
            'data-bbox-left="%s" data-bbox-top="%s" data-bbox-right="%s" data-bbox-bottom="%s">'
            % (
                _attr(device.id), _attr(device.kind), _attr(device.name),
                _attr(device.center["x"]), _attr(device.center["y"]), _attr(device.rotation_deg),
                _attr(bbox.get("left", "")), _attr(bbox.get("top", "")),
                _attr(bbox.get("right", "")), _attr(bbox.get("bottom", "")),
            )
        )
        for pin in device.pins:
            parts.append(
                '<circle class="netlab-pin-anchor" data-owner-id="%s" data-pin-name="%s" '
                'data-pin-role="%s" data-x="%s" data-y="%s" cx="%s" cy="%s" r="0"/>'
                % (
                    _attr(device.id), _attr(pin.name), _attr(pin.role),
                    _attr(pin.x), _attr(pin.y), _attr(pin.x), _attr(-pin.y),
                )
            )
        parts.append("</g>")
    for wire in ir.wires:
        points = [[float(point["x"]), float(point["y"])] for point in wire.points]
        parts.append(
            '<g class="netlab-wire" data-owner-id="%s" data-net-id="%s" data-points="%s">'
            '<polyline points="%s"/></g>'
            % (
                _attr(wire.id), _attr(wire.net_id),
                _attr(json.dumps(points, ensure_ascii=False, separators=(",", ":"))),
                _attr(" ".join(f"{x:g},{y:g}" for x, y in points)),
            )
        )
    for junction in ir.junctions:
        parts.append(
            '<circle class="netlab-junction" data-reason="%s" data-x="%s" data-y="%s" cx="%s" cy="%s" r="1.6"/>'
            % (_attr(junction.reason), _attr(junction.x), _attr(junction.y), _attr(junction.x), _attr(-junction.y))
        )
    for crossing in ir.crossings:
        parts.append(
            '<circle class="netlab-crossing" data-x="%s" data-y="%s" data-over-wire="%s" data-under-wire="%s" cx="%s" cy="%s" r="1.6"/>'
            % (
                _attr(crossing.x), _attr(crossing.y), _attr(crossing.over_wire_id),
                _attr(crossing.under_wire_id), _attr(crossing.x), _attr(-crossing.y),
            )
        )
    parts.append("</g>")
    payload = json.dumps(ir.to_dict(), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    parts.append(
        '<metadata id="netlab-ir" data-schema="%s">%s</metadata>'
        % (_attr(SCHEMA), html.escape(payload, quote=False))
    )
    return "".join(parts)


def render_schematic_svg(ir: SchematicExportIR) -> str:
    """把 IR 渲染为 SVG 文本；不读写用户文件。"""
    schemdraw, el = _load_schemdraw()
    drawing = schemdraw.Drawing(show=False)
    drawing.config(fontsize=5.5, font="Microsoft YaHei", lw=0.8)

    # 先画导线：颜色/线宽统一，且不产生任何文字。
    for wire in ir.wires:
        points = [(float(point["x"]), -float(point["y"])) for point in wire.points]
        for start, end in zip(points, points[1:]):
            drawing.add(el.Line().at(start).to(end))

    for junction in ir.junctions:
        drawing.add(el.Dot(radius=1.6).at((float(junction.x), -float(junction.y))))
    for crossing in ir.crossings:
        drawing.add(
            el.Dot(radius=1.6, open=True).at((float(crossing.x), -float(crossing.y)))
        )

    unsupported_ids = {item.id for item in ir.unsupported}
    for device in ir.devices:
        if device.id in unsupported_ids:
            _draw_unknown(drawing, el, device)
            continue
        try:
            element = GBElement(device.kind, style=ir.style)
        except (UnsupportedSymbolError, SymbolSpecError):
            _draw_unknown(drawing, el, device)
            continue
        drawing.add(
            element.at((float(device.center["x"]), -float(device.center["y"]))).theta(
                -float(device.rotation_deg)
            )
        )

    for ground in ir.grounds:
        try:
            element = GBElement("ground", style=ir.style)
        except (UnsupportedSymbolError, SymbolSpecError):
            continue
        drawing.add(element.at((float(ground.x), -float(ground.y))))

    for label in ir.labels:
        drawing.add(
            el.Label()
            .at((float(label.anchor["x"]), -float(label.anchor["y"])))
            .label(
                label.text,
                halign=_label_halign(label.placement),
                valign=_label_valign(label.placement),
                fontsize=5.5,
            )
        )

    svg = drawing.get_imagedata("svg")
    text = svg.decode("utf-8", errors="replace") if isinstance(svg, bytes) else str(svg)
    clean = _normalise_svg_ids(_strip_svg_noise(text))
    return clean.replace("</svg>", _structure_layer(ir) + "</svg>", 1)


def _normalise_svg_ids(svg: str) -> str:
    """把 Matplotlib 的随机 clipPath id 归一成稳定序号，保证导出可复现。"""
    mapping: dict[str, str] = {}

    def replace_id(match: "re.Match[str]") -> str:
        old = match.group(1)
        if old not in mapping:
            mapping[old] = f"clip{len(mapping) + 1}"
        return 'id="' + mapping[old] + '"'

    svg = re.sub(r'id="(p[0-9a-f]+)"', replace_id, svg)

    def replace_ref(match: "re.Match[str]") -> str:
        old = match.group(1)
        return "url(#" + mapping.get(old, old) + ")"

    return re.sub(r"url\(#(p[0-9a-f]+)\)", replace_ref, svg)


def export_schematic_document(
    scene: Any,
    *,
    project_name: str = "",
    network_name: str = "",
    style: str = "gb",
    route: str = "orthogonal",
    include_values: bool = True,
) -> dict[str, Any]:
    """返回可被 API 直接序列化的完整导出文档（SVG + 诊断）。"""
    if style not in ("gb", "classic"):
        raise ComputeError("原理图样式仅支持 gb 或 classic")
    if route not in ("orthogonal", "free", "straight"):
        raise ComputeError("导线走线模式仅支持 orthogonal、free 或 straight")
    options = ExportOptions(style=style, route_mode=route, include_values=include_values)
    ir = build_schematic_export_ir(scene, options=options)
    svg = render_schematic_svg(ir)
    title = " — ".join(
        part for part in (project_name.strip(), network_name.strip()) if part
    )
    meta = (
        f"{ir.stats.nodes} 节点 · {ir.stats.devices} 元件 · "
        f"{ir.stats.wires} 导线 · {style} · {route}"
    )
    decorated = _decorate_svg(svg, title or "NetLab 原理图", meta)
    return {
        "ok": True,
        "svg": decorated,
        "filename": svg_filename(project_name),
        "style": style,
        "route": route,
        "warnings": [item.to_dict() for item in ir.warnings],
        "unsupported": [item.to_dict() for item in ir.unsupported],
        "stats": ir.stats.to_dict(),
    }


def scene_to_svg(
    scene: Any,
    *,
    project_name: str = "",
    network_name: str = "",
    style: str = "gb",
    route: str = "orthogonal",
    include_values: bool = True,
) -> str:
    """返回 SVG 文本；调用方负责 Content-Type 与文件名。"""
    if getattr(scene, "mode", "") != "circuit":
        raise ComputeError("原理图导出仅支持电路模式（circuit）")
    document = export_schematic_document(
        scene,
        project_name=project_name,
        network_name=network_name,
        style=style,
        route=route,
        include_values=include_values,
    )
    return str(document["svg"])


def svg_filename(project_name: str) -> str:
    stem = re.sub(r"[^\w\u4e00-\u9fff.-]+", "_", project_name.strip() or "schematic")
    return f"{stem[:60]}.svg"
