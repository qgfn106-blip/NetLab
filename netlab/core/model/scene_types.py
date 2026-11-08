"""场景公共类型与外观规范化（避免 scene / scene_io 循环导入）。"""

from __future__ import annotations

import re
from typing import Any

from ..common.limits import ValidationError, as_float

MODES = ("signal", "circuit", "vector")
MAX_POSITION = 10000.0
ROUTE_MODES = ("auto", "straight", "orthogonal", "manual")
ANCHOR_SIDES = ("auto", "left", "right", "top", "bottom")
MAX_WAYPOINTS = 64
MAX_NODE_SIZE = 200.0
MIN_NODE_SIZE = 24.0

#: 元素级外观覆盖（P-B）：可选、默认空；空表示完全沿用主题令牌与布局默认。
APPEARANCE_KEYS = ("color", "opacity", "lineWidth", "fontSize")
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def normalize_appearance(value: Any) -> dict[str, Any]:
    """校验并规范化元素级外观覆盖（P-B）。

    只接受 color/opacity/lineWidth/fontSize；``None`` 或空字典表示「无覆盖」。
    返回值只包含显式设置过的键，未设置的不出现在结果里（支持部分覆盖）。
    """
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValidationError("元素外观必须是对象")
    unknown = set(value) - set(APPEARANCE_KEYS)
    if unknown:
        raise ValidationError(f"元素外观包含未知字段：{', '.join(sorted(unknown))}")
    clean: dict[str, Any] = {}
    if "color" in value:
        color = value["color"]
        if not isinstance(color, str) or not _HEX_COLOR_RE.match(color):
            raise ValidationError("元素外观 color 必须是 #RRGGBB")
        clean["color"] = color.lower()
    if "opacity" in value:
        clean["opacity"] = as_float(value["opacity"], "元素外观 opacity", lo=0.05, hi=1.0)
    if "lineWidth" in value:
        clean["lineWidth"] = as_float(
            value["lineWidth"], "元素外观 lineWidth", lo=0.5, hi=12.0
        )
    if "fontSize" in value:
        clean["fontSize"] = as_float(
            value["fontSize"], "元素外观 fontSize", lo=6.0, hi=48.0
        )
    return clean
