"""信号流字段解析与数值读取。

信号节点历史上写 ``voltage``，较新的节点写 ``value``。连接参数里残留的
旧字段名不应该让整条链路失败，所以读取端统一走这里：

1. 显式请求且存在 → 用显式字段；
2. 否则优先 ``value``；
3. 再 ``voltage``；
4. 再唯一的数值字段；
5. 仍有歧义 → ``ComputeError`` 并列出可用字段。

显式字段存在时永远优先，自定义键（``current``、``power`` 等）不会被
``value`` 抢走。输出端的空值 / ``auto`` / ``*`` 统一写成 ``value``。
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

from ..common.limits import ComputeError

PREFERRED_FIELDS = ("value", "voltage")
AUTO_KEYS = frozenset({"", "auto", "*"})


def _is_number(value: Any) -> bool:
    return not isinstance(value, bool) and isinstance(value, (int, float))


def _is_finite_number(value: Any) -> bool:
    return _is_number(value) and math.isfinite(float(value))


def resolve_field(
    payload: Mapping[str, Any],
    requested: str | None = None,
    *,
    source: str = "",
    subject: str = "连接",
) -> str:
    """Return the field name to read from *payload*.

    ``requested`` may be ``None`` / empty / ``auto`` for pure auto-matching.
    """
    if not isinstance(payload, Mapping):
        raise ComputeError(f"{subject} {source!r} 的载荷不是字段字典")
    text = str(requested if requested is not None else "").strip()
    auto = (not text) or text.lower() in AUTO_KEYS
    if not auto and text in payload:
        return text
    for key in PREFERRED_FIELDS:
        if key in payload and _is_finite_number(payload[key]):
            return key
    numeric = [str(key) for key, value in payload.items() if _is_finite_number(value)]
    if len(numeric) == 1:
        return numeric[0]
    available = ", ".join(sorted(str(key) for key in payload)) or "（空）"
    if not auto:
        raise ComputeError(
            f"{subject} {source!r} 没有可用字段 {text!r}，也无法自动匹配"
            f"（可用字段：{available}）"
        )
    raise ComputeError(
        f"{subject} {source!r} 无法自动匹配输入字段（可用字段：{available}）"
    )


def read_numeric(
    payload: Mapping[str, Any],
    requested: str | None = None,
    *,
    source: str = "",
    subject: str = "连接",
) -> float:
    """Resolve a field and return it as a finite float."""
    key = resolve_field(payload, requested, source=source, subject=subject)
    raw = payload[key]
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise ComputeError(f"{subject} {source!r} 的字段 {key!r} 不是数值")
    number = float(raw)
    if not math.isfinite(number):
        raise ComputeError(f"{subject} {source!r} 的字段 {key!r} 不是有限数值")
    return number


def read_node_numeric(node: Any, requested: str | None = None) -> float:
    """Read a numeric field from a node's current data payload."""
    data = getattr(node, "data", None)
    name = str(getattr(node, "name", "?"))
    if not isinstance(data, Mapping):
        raise ComputeError(f"节点 {name!r} 没有数据字段")
    return read_numeric(data, requested, source=name, subject="节点")


def resolve_output(requested: str | None = None) -> str:
    """Normalize an output key; empty / auto becomes ``value``."""
    text = str(requested if requested is not None else "").strip()
    return "value" if text.lower() in AUTO_KEYS else text
