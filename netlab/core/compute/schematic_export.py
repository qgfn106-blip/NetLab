"""R18/R19：把现有电路场景直接导出为原理图（SchemDraw，可选依赖）。

设计边界：只做“已有网络结构 → 静态 SVG”，不追求交互式标准图纸；
SchemDraw 缺失时抛 ComputeError，由 API 返回可读安装提示。
"""

from __future__ import annotations

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
    drawing.config(fontsize=9, font="Microsoft YaHei")

    positions: dict[str, tuple[float, float]] = {}
    for node in scene.nodes.values():
        x = float(node.position.get("x", 0.0)) * 0.02
        y = -float(node.position.get("y", 0.0)) * 0.02
        positions[node.id] = (x, y)

    for edge in scene.edges.values():
        start = positions.get(edge.source)
        end = positions.get(edge.target)
        if start is None or end is None:
            continue
        cls = elements.get(str(edge.kind))
        label = str(getattr(edge, "name", "") or "")
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
    if title:
        drawing += el.Label().at((0.0, 0.6)).label(title, fontsize=10)
    svg = drawing.get_imagedata("svg")
    if isinstance(svg, bytes):
        return svg.decode("utf-8", errors="replace")
    return str(svg)


def svg_filename(project_name: str) -> str:
    stem = re.sub(r"[^\w\u4e00-\u9fff.-]+", "_", project_name.strip() or "schematic")
    return f"{stem[:60]}.svg"
