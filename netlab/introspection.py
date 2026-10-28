"""规格自省：把注册表条目转成前端可展示的公式、源码与参数说明。

源码通过 ``inspect.getsource`` 读取**实际注册的函数/类**，不是另写一份
示意文本；读取失败时返回空字符串，前端会明确显示“源码不可用”，
不会用伪造内容冒充实现。
"""

from __future__ import annotations

import inspect
import textwrap
from typing import Any, Mapping

MAX_SOURCE_CHARS = 200_000


def safe_source(target: Any) -> str:
    try:
        text = inspect.getsource(target)
    except (OSError, TypeError, IndentationError):
        return ""
    text = textwrap.dedent(text).strip()
    if len(text) > MAX_SOURCE_CHARS:
        text = text[:MAX_SOURCE_CHARS] + "\n# … 源码过长，已截断 …"
    return text


def source_path(target: Any) -> str:
    try:
        path = inspect.getsourcefile(target) or inspect.getfile(target)
    except (OSError, TypeError):
        return ""
    return str(path)


def formula_for(spec: Any, mapping: Mapping[str, str]) -> str:
    value = getattr(spec, "formula", "") or mapping.get(spec.kind, "")
    return str(value)


def spec_entry(
    spec: Any,
    *,
    mode: str,
    formula: str = "",
    source_target: Any | None = None,
    outputs: tuple[str, ...] | None = None,
) -> dict[str, Any]:
    target = source_target if source_target is not None else getattr(spec, "factory", None)
    source = getattr(spec, "source", "")
    if not source and target is not None:
        source = safe_source(target)
    return {
        "kind": spec.kind,
        "label": spec.label,
        "group": spec.group,
        "description": spec.description,
        "mode": mode,
        "outputs": list(outputs if outputs is not None else getattr(spec, "outputs", ())),
        "notes": getattr(spec, "notes", ""),
        "formula": formula,
        "source": source,
        "source_path": source_path(target) if target is not None else "",
        "editable": bool(getattr(spec, "editable", False)),
        "builtin": bool(getattr(spec, "builtin", True)),
        "addable": bool(getattr(spec, "addable", True)),
        "params": [param.to_dict() for param in spec.params],
    }
