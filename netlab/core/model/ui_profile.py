"""可调节 UI 配置（R40，netlab-ui/1）。

只保存声明式令牌与布局；不执行任何插件/用户 HTML/CSS/JS。前端把令牌映射为
CSS 变量，插件只能通过 PanelSpec/VisualSpec 使用这些令牌。
"""

from __future__ import annotations

import copy
import re
from typing import Any

from ..common.limits import ValidationError

UI_PROFILE = "netlab-ui/1"
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

# R40 阶段 3：节点卡片字段（声明式白名单）。字段 id 固定，前端只能选择显示哪些、
# 以及它们的上下顺序；不允许携带任意 HTML/CSS/JS 或表达式。
CARD_FIELDS: tuple[str, ...] = ("kind", "name", "value", "id")
CARD_FIELD_LABELS: dict[str, str] = {
    "kind": "节点类型",
    "name": "节点名称",
    "value": "节点数值",
    "id": "编号尾号",
}
DEFAULT_CARD_FIELDS: list[str] = ["kind", "name", "value"]

DEFAULT_TOKENS: dict[str, str] = {
    "background": "#0b1220",
    "surface": "#111a2c",
    "panel": "#162238",
    "text": "#e6edf7",
    "muted": "#8da2bf",
    "accent": "#4cc9f0",
    "grid": "#22314b",
    "edge": "#7c8db5",
    "node": "#1c2b45",
    "danger": "#ff6b6b",
    "success": "#5ee39b",
}

DEFAULT_LAYOUT: dict[str, float] = {
    "panel_width": 320.0,
    "node_width": 150.0,
    "node_height": 54.0,
    "grid_size": 24.0,
    "edge_width": 2.0,
    "font_scale": 1.0,
}

DEFAULT_UI: dict[str, Any] = {
    "profile": UI_PROFILE,
    "mode": "professional",
    "tokens": dict(DEFAULT_TOKENS),
    "layout": dict(DEFAULT_LAYOUT),
    "node": {
        "radius": 10.0,
        "show_ports": True,
        "show_values": True,
        "show_detail": True,
        "show_value": True,
        "card_fields": list(DEFAULT_CARD_FIELDS),
    },
    "edge": {"route": "orthogonal", "arrow": True},
}


def _normalize_card_fields(value: Any) -> list[str]:
    """校验节点卡片字段：有序、白名单、去重、限量；不执行任何表达式。"""
    if not isinstance(value, list):
        raise ValidationError("ui.node.card_fields 必须是字段数组")
    fields: list[str] = []
    for item in value:
        if not isinstance(item, str) or item not in CARD_FIELDS:
            raise ValidationError(f"未知节点卡片字段：{item!r}")
        if item in fields:
            raise ValidationError(f"节点卡片字段重复：{item}")
        fields.append(item)
    if len(fields) > len(CARD_FIELDS):
        raise ValidationError("节点卡片字段过多")
    return fields


def default_ui() -> dict[str, Any]:
    return copy.deepcopy(DEFAULT_UI)


def normalize_ui(payload: dict[str, Any] | None) -> dict[str, Any]:
    if payload is None:
        return default_ui()
    if not isinstance(payload, dict):
        raise ValidationError("ui 配置必须是对象")
    result = default_ui()
    profile = payload.get("profile", UI_PROFILE)
    if profile != UI_PROFILE:
        raise ValidationError(f"不支持的 UI profile：{profile!r}")
    result["profile"] = UI_PROFILE
    mode = payload.get("mode", result["mode"])
    if mode not in ("simple", "professional"):
        raise ValidationError("ui.mode 必须是 simple 或 professional")
    result["mode"] = mode
    tokens = payload.get("tokens") or {}
    if not isinstance(tokens, dict):
        raise ValidationError("ui.tokens 必须是对象")
    for key, value in tokens.items():
        if key not in DEFAULT_TOKENS:
            raise ValidationError(f"未知 UI 颜色令牌：{key}")
        if not isinstance(value, str) or not HEX_RE.match(value):
            raise ValidationError(f"UI 令牌 {key} 必须是 #RRGGBB")
        result["tokens"][key] = value
    layout = payload.get("layout") or {}
    if not isinstance(layout, dict):
        raise ValidationError("ui.layout 必须是对象")
    for key, value in layout.items():
        if key not in DEFAULT_LAYOUT:
            raise ValidationError(f"未知布局项：{key}")
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValidationError(f"布局项 {key} 必须是数字")
        if not 0.1 <= float(value) <= 10000.0:
            raise ValidationError(f"布局项 {key} 超出范围")
        result["layout"][key] = float(value)
    for section in ("node", "edge"):
        values = payload.get(section)
        if values is None:
            continue
        if not isinstance(values, dict):
            raise ValidationError(f"ui.{section} 必须是对象")
        for key, value in values.items():
            if key not in result[section]:
                raise ValidationError(f"未知 ui.{section} 项：{key}")
            if section == "node" and key == "card_fields":
                result[section][key] = _normalize_card_fields(value)
                continue
            result[section][key] = value
    return result


def ui_catalog() -> dict[str, Any]:
    return {
        "profile": UI_PROFILE,
        "defaults": default_ui(),
        "card_fields": [
            {"id": field, "label": CARD_FIELD_LABELS[field]} for field in CARD_FIELDS
        ],
    }


__all__ = ["UI_PROFILE", "DEFAULT_UI", "CARD_FIELDS", "CARD_FIELD_LABELS", "DEFAULT_CARD_FIELDS", "default_ui", "normalize_ui", "ui_catalog"]
