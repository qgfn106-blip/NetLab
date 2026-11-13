"""阶段7 P1-S1 预置：v7→v8 迁移草稿（**未激活**）。

依据 `MIGRATION_AND_COMPATIBILITY.md` §9 与
`NetlabExtras/scratch/STAGE7_P1S1_DTO_DESIGN.md` §4.4：
- appearance → presentation.node_styles / edge_styles
- EdgeRecord.kind="wire" → PhysicalEdge、"signal" → DependencyEdge
- PortSpec/PinSpec → PortDesc/PortType（本草稿只做形态标记，不做 Registry 解析）
- 字段只加不删；未知字段进入 compat.extensions 原样保留，保证可回退

约束（P1-S1 明确）：**不改 PROJECT_VERSION（仍 7）**、不注册进
`SCHEMA_MIGRATIONS`、不接 `load_project`/`save_project`、不改外部 JSON。
本模块只供测试直接调用验证映射，作为阶段8的预置；现有工程完全不受影响。
"""
from __future__ import annotations

import copy
from typing import Any

_V8_DRAFT_VERSION = 8  # 仅草稿内使用；不得写入 project.PROJECT_VERSION


def migrate_v7_to_v8(payload: dict[str, Any]) -> dict[str, Any]:
    """返回 v8 形态草稿（纯函数，不修改入参，不改 PROJECT_VERSION）。"""
    if not isinstance(payload, dict):
        raise TypeError("v7 payload must be a dict")
    if payload.get("version") != 7:
        raise ValueError(
            f"migrate_v7_to_v8 只接受 version=7，实得 {payload.get('version')!r}"
        )
    out = copy.deepcopy(payload)
    node_styles: dict[str, Any] = {}
    edge_styles: dict[str, Any] = {}
    compat_extensions: dict[str, Any] = {}

    networks = out.get("networks")
    if isinstance(networks, list):
        for network in networks:
            if not isinstance(network, dict):
                continue
            scene = network.get("scene")
            if not isinstance(scene, dict):
                continue
            for node in scene.get("nodes") or []:
                if not isinstance(node, dict):
                    continue
                nid = str(node.get("id") or "")
                appearance = node.get("appearance")
                if isinstance(appearance, dict) and appearance:
                    node_styles[nid] = copy.deepcopy(appearance)
                # PortSpec/PinSpec 形态：只做标记，不引入 Registry 依赖
                if "port_type" in node or "port_id" in node:
                    compat_extensions.setdefault("ports", {})[nid] = {
                        "port_type": node.get("port_type"),
                        "port_id": node.get("port_id"),
                    }
            for edge in scene.get("edges") or []:
                if not isinstance(edge, dict):
                    continue
                eid = str(edge.get("id") or "")
                appearance = edge.get("appearance")
                if isinstance(appearance, dict) and appearance:
                    edge_styles[eid] = copy.deepcopy(appearance)
                kind = edge.get("kind")
                if kind == "wire":
                    edge["v8_kind"] = "PhysicalEdge"
                elif kind == "signal":
                    edge["v8_kind"] = "DependencyEdge"

    presentation: dict[str, Any] = {}
    if node_styles:
        presentation["node_styles"] = node_styles
    if edge_styles:
        presentation["edge_styles"] = edge_styles
    if presentation:
        out["presentation"] = presentation

    compat = out.get("compat")
    if not isinstance(compat, dict):
        compat = {}
        out["compat"] = compat
    if compat_extensions:
        ext = compat.get("extensions")
        if not isinstance(ext, dict):
            ext = {}
            compat["extensions"] = ext
        ext.update(compat_extensions)

    out["version"] = _V8_DRAFT_VERSION
    out["schema_version"] = "v8-draft"
    return out
