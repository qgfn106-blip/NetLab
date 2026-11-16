"""Edge 三型只读诊断（C-int-1：纯函数，不改求解分派/EdgeRecord/版本）。

依据审批 m08543/19：`diagnose_edge_types(scene) -> list[dict]`，按 classify_edge_kind/
EDGE_TYPE_INFO 标三型 + participates_in_solve，对「归类 layout 却带 source_port/
target_port/delay」出 warning；未知 kind → edge_type=None + warning=unknown（不抛）。
"""

from __future__ import annotations

from typing import Any

from .edge_types import EDGE_TYPE_INFO, try_classify_edge_kind

__all__ = ["diagnose_edge_types"]


def diagnose_edge_types(scene: Any) -> list[dict[str, Any]]:
    """只读诊断场景所有边的三型归类与一致性；从不抛异常、从不修改场景。"""
    edges = getattr(scene, "edges", {}) or {}
    records = list(edges.values()) if hasattr(edges, "values") else list(edges)
    records.sort(key=lambda r: str(getattr(r, "id", "")))
    out: list[dict[str, Any]] = []
    for record in records:
        edge_id = getattr(record, "id", None)
        kind = getattr(record, "kind", None)
        edge_type = try_classify_edge_kind(kind)
        info = EDGE_TYPE_INFO.get(edge_type) if edge_type is not None else None
        item: dict[str, Any] = {
            "edge": edge_id,
            "kind": kind,
            "edge_type": edge_type,
            "participates": (info.participates_in_solve if info is not None else None),
        }
        warnings: list[dict[str, Any]] = []
        if edge_type is None:
            warnings.append({"code": "unknown", "reason": f"未知边类型：{kind!r}"})
        elif edge_type == "layout":
            source_port = getattr(record, "source_port", "") or ""
            target_port = getattr(record, "target_port", "") or ""
            has_delay = bool(getattr(record, "delay", False))
            if source_port or target_port or has_delay:
                warnings.append(
                    {
                        "code": "layout_has_solve_binding",
                        "reason": "layout 边却带 source_port/target_port/delay 求解绑定",
                    }
                )
        if warnings:
            item["warnings"] = warnings
        out.append(item)
    return out
