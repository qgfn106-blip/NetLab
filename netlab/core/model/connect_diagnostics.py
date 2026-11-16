"""连接类型只读诊断（B-int-1：纯函数，不接线、不改 add_edge 热路径）。

依据审批 m08543/18：新增纯函数 `diagnose_connection(scene, source_id, target_id, kind)`，
两端无端口类型元数据→[]；有则用 `port_types.can_connect` 产 warning 项。
零行为变化：不改 add_edge 返回值/异常/落库，不硬校验、不写 record、不改 EdgeRecord/版本/格式。
"""

from __future__ import annotations

from typing import Any

from .port_types import PORT_TYPES, PortDesc, can_connect

__all__ = ["diagnose_connection"]


def _port_meta(record: Any, direction: str) -> PortDesc | None:
    """从 record 的可选 `port_types` 元数据取某方向端口描述。

    约定：`record.port_types` 为 dict，如 {"output": "scalar", "input": {"type": "complex", ...}}。
    缺失/类型非法→None（无元数据，不产诊断）。
    """
    meta = getattr(record, "port_types", None)
    if not isinstance(meta, dict):
        return None
    raw = meta.get(direction)
    if raw is None:
        return None
    if isinstance(raw, str):
        if raw not in PORT_TYPES:
            return None
        return PortDesc(name=f"{getattr(record, 'id', '?')}:{direction}", type=raw, direction=direction)
    if isinstance(raw, dict):
        type_ = raw.get("type")
        if not isinstance(type_, str) or type_ not in PORT_TYPES:
            return None
        return PortDesc(
            name=str(raw.get("name", f"{getattr(record, 'id', '?')}:{direction}")),
            type=type_,
            role=str(raw.get("role", "")),
            direction=str(raw.get("direction", direction)),
            unit=str(raw.get("unit", "")),
            dimension=str(raw.get("dimension", "")),
            required=bool(raw.get("required", False)),
            order=int(raw.get("order", 0)),
        )
    return None


def diagnose_connection(
    scene: Any, source_id: str, target_id: str, kind: str
) -> list[dict[str, Any]]:
    """只读诊断一条连接的端口类型兼容性；从不抛异常、从不修改场景。"""
    nodes = getattr(scene, "nodes", {}) or {}
    source = nodes.get(source_id)
    if source is None:
        return [
            {
                "severity": "warning",
                "code": "source_missing",
                "source": source_id,
                "target": target_id,
                "kind": kind,
                "reason": f"源节点不存在：{source_id}",
            }
        ]
    target = nodes.get(target_id)
    if target is None:
        return [
            {
                "severity": "warning",
                "code": "target_missing",
                "source": source_id,
                "target": target_id,
                "kind": kind,
                "reason": f"目标节点不存在：{target_id}",
            }
        ]
    src_desc = _port_meta(source, "output")
    dst_desc = _port_meta(target, "input")
    if src_desc is None or dst_desc is None:
        return []
    ok, reason = can_connect(src_desc, dst_desc)
    if ok:
        return []
    return [
        {
            "severity": "warning",
            "code": "incompatible",
            "source": source_id,
            "target": target_id,
            "kind": kind,
            "reason": reason,
        }
    ]
