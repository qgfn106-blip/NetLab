"""R18/R19：把现有电路场景直接导出为原理图（SchemDraw，可选依赖）。

设计边界：只做“已有网络结构 → 静态 SVG”，不追求交互式标准图纸；
SchemDraw 缺失时抛 ComputeError，由 API 返回可读安装提示。
"""

from __future__ import annotations

import html
import re
from typing import Any

from .nodal import ComputeError


def _load_schemdraw() -> tuple[Any, Any]:
    try:
        import schemdraw
        from schemdraw import elements as el
    except ImportError as exc:  # pragma: no cover - 环境差异
        raise ComputeError(
            "导出原理图需要 SchemDraw：请运行 python -m pip install schemdraw"
        ) from exc
    return schemdraw, el


def _element_map(el: Any) -> dict[str, Any]:
    return {
        "resistor": el.Resistor,
        "capacitor": el.Capacitor,
        "inductor": el.Inductor,
        "vsource": el.SourceV,
        "isource": el.SourceI,
        "diode": el.Diode,
        "led": el.LED,
        "zener": el.Zener,
        "switch": el.Switch,
        "opamp": el.Opamp,
        "npn": el.BjtNpn,
        "pnp": el.BjtPnp,
        "nmos": el.NFetch if hasattr(el, "NFetch") else el.NFet,
        "pmos": el.PFet,
        "thyristor": el.SCR,
        "igbt": el.IgbtN,
        "jfet": el.JFetN,
        "relay": el.Relay,
        "motor": el.Motor,
        "transformer": el.Transformer,
        "coupling_inductor": el.Transformer,
        "vcvs": el.SourceControlledV,
        "vccs": el.SourceControlledI,
        "comparator": el.Opamp,
    }


def _edge_label(edge: Any) -> str:
    """元件名 + 关键参数，打印时可直接读值。"""
    name = str(getattr(edge, "name", "") or "")
    params = getattr(edge, "params", {}) or {}
    value = ""
    for key, unit in (
        ("R", "Ω"),
        ("C", "F"),
        ("L", "H"),
        ("V", "V"),
        ("I", "A"),
        ("gain", ""),
    ):
        if key in params:
            raw = params[key]
            try:
                value = f"{float(raw):g}{unit}"
            except (TypeError, ValueError):
                value = f"{raw}{unit}"
            break
    return f"{name}\n{value}" if name and value else (name or value)


def _grid_positions(scene: Any) -> dict[str, tuple[float, float]]:
    """场景坐标优先；退化/重叠时回退到确定性网格，保证可读。"""
    raw: dict[str, tuple[float, float]] = {}
    for node in scene.nodes.values():
        position = getattr(node, "position", {}) or {}
        raw[node.id] = (
            float(position.get("x", 0.0)) * 0.02,
            -float(position.get("y", 0.0)) * 0.02,
        )
    if len(raw) < 2:
        return raw
    xs = [point[0] for point in raw.values()]
    ys = [point[1] for point in raw.values()]
    span_x = max(xs) - min(xs)
    span_y = max(ys) - min(ys)
    distinct = len(set(raw.values()))
    if distinct >= max(2, len(raw) // 2) and (span_x >= 2.4 or span_y >= 1.6):
        return raw
    ids = list(raw)
    cols = max(1, int(len(ids) ** 0.5 + 0.999))
    return {
        node_id: ((index % cols) * 2.6, -(index // cols) * 1.8)
        for index, node_id in enumerate(ids)
    }


def _decorate_svg(svg: str, title: str, meta: str) -> str:
    """给 SchemDraw 的 SVG 套一层打印图框：留白 + 边框 + 标题栏。"""
    match = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg)
    if not match:
        return svg
    width, height = float(match.group(1)), float(match.group(2))
    pad_x, pad_top, pad_bottom = 18.0, 34.0, 30.0
    outer_w = width + pad_x * 2
    outer_h = height + pad_top + pad_bottom
    svg = svg.replace(match.group(0), f'viewBox="0 0 {outer_w:g} {outer_h:g}"')
    svg = re.sub(r'width="[\d.]+(?:pt|px)?"', f'width="{outer_w:g}pt"', svg, count=1)
    svg = re.sub(r'height="[\d.]+(?:pt|px)?"', f'height="{outer_h:g}pt"', svg, count=1)
    head = f"""<rect x="0.5" y="0.5" width="{outer_w - 1:g}" height="{outer_h - 1:g}" fill="#ffffff" stroke="#333333" stroke-width="1.2"/>
<rect x="5" y="5" width="{outer_w - 10:g}" height="{outer_h - 10:g}" fill="none" stroke="#333333" stroke-width="0.6"/>
<text x="10" y="19" font-family="Microsoft YaHei, sans-serif" font-size="10" font-weight="600" fill="#222222">{html.escape(title)}</text>
<text x="10" y="29" font-family="Microsoft YaHei, sans-serif" font-size="7" fill="#666666">{html.escape(meta)}</text>
<g transform="translate({pad_x:g},{pad_top:g})">"""
    svg = re.sub(r"(<svg\b[^>]*>)", r"\1" + head, svg, count=1)
    footer = (
        f'</g><text x="{outer_w - 12:g}" y="{outer_h - 10:g}" text-anchor="end" '
        'font-family="Microsoft YaHei, sans-serif" font-size="7" fill="#777777">'
        f"{html.escape(meta)} · NetLab</text></svg>"
    )
    return svg.replace("</svg>", footer, 1)


def scene_to_svg(
    scene: Any,
    *,
    project_name: str = "",
    network_name: str = "",
) -> str:
    """返回 SVG 文本；调用方负责 Content-Type 与文件名。"""
    if getattr(scene, "mode", "") != "circuit":
        raise ComputeError("原理图导出仅支持电路模式（circuit）")
    schemdraw, el = _load_schemdraw()
    elements = _element_map(el)
    drawing = schemdraw.Drawing(show=False)
    drawing.config(fontsize=9, font="Microsoft YaHei", lw=1.1)

    positions = _grid_positions(scene)

    for edge in scene.edges.values():
        start = positions.get(edge.source)
        end = positions.get(edge.target)
        if start is None or end is None:
            continue
        cls = elements.get(str(edge.kind))
        label = _edge_label(edge)
        if cls is None:
            drawing += el.Line().at(start).to(end).label(label, loc="center")
        else:
            try:
                drawing += cls().at(start).to(end).label(label)
            except Exception:
                drawing += el.Line().at(start).to(end).label(label, loc="center")
        middle = ((start[0] + end[0]) / 2.0, (start[1] + end[1]) / 2.0)
        for key in (
            "gate_node",
            "base_node",
            "com_node",
            "no_node",
            "vin_node",
            "clk_node",
        ):
            extra_id = str((getattr(edge, "params", {}) or {}).get(key) or "")
            extra = positions.get(extra_id)
            if extra is not None:
                drawing += el.Line().at(extra).to(middle)

    for node in scene.nodes.values():
        if node.kind == "ground":
            drawing += el.Ground().at(positions.get(node.id, (0.0, 0.0)))
        elif node.kind == "node":
            drawing += el.Dot().at(positions.get(node.id, (0.0, 0.0)))

    title = " — ".join(
        part for part in (project_name.strip(), network_name.strip()) if part
    )
    meta = f"{len(scene.nodes)} 节点 · {len(scene.edges)} 元件"
    svg = drawing.get_imagedata("svg")
    text = svg.decode("utf-8", errors="replace") if isinstance(svg, bytes) else str(svg)
    return _decorate_svg(text, title or "NetLab 原理图", meta)


def svg_filename(project_name: str) -> str:
    stem = re.sub(r"[^\w\u4e00-\u9fff.-]+", "_", project_name.strip() or "schematic")
    return f"{stem[:60]}.svg"
