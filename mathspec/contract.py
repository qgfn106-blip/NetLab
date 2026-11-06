"""可插拔扩展的"强制点"原型（不依赖 netlab）。

演示 UNIFIED_SIM_MATH_SPEC.md §9 的四条硬约束如何在代码层被强制：

    §9.1 核心 schema 不可变   -> assert_core_schema_unchanged / CORE_SCHEMA
    §9.2 插件只扩不改         -> KindRegistry.register（拒绝覆盖内建、强制 user. 前缀）
    §9.3 引擎只能注册新 mode   -> EngineRegistry.register（拒绝覆盖 signal/circuit/vector）
    §9.4 私有数据进 ext        -> ExtNamespace（隔离 + JSON 可序列化校验）

这些断言是"契约检查器"原型；真正进 netlab 时用同一套断言挂进 netlab tests
（对应代码：engine_registry.py:18-21、extensions.py:193-199）。
"""
from __future__ import annotations

import json
from dataclasses import fields, is_dataclass
from typing import Any, Dict, List, Optional

from .graph import Edge, Node


class ContractError(RuntimeError):
    """违反可插拔硬约束。"""


# ---------------------------------------------------------------------------
# §9.1 核心 schema 不可变（金标准）
# ---------------------------------------------------------------------------
CORE_SCHEMA: Dict[str, List[str]] = {
    "Node": ["id", "kind", "params", "ports", "state", "ext"],
    "Edge": ["id", "source", "target", "kind", "delay", "ext"],
}

_RECORD_TYPES = {"Node": Node, "Edge": Edge}


def schema_of(record_type) -> List[str]:
    if not is_dataclass(record_type):
        raise ContractError(f"{record_type!r} 不是 dataclass")
    return [f.name for f in fields(record_type)]


def assert_core_schema_unchanged() -> None:
    """核心记录字段若被增删改序，抛 ContractError（CI 闸门）。"""
    for name, golden in CORE_SCHEMA.items():
        actual = schema_of(_RECORD_TYPES[name])
        if actual != golden:
            raise ContractError(
                f"核心 schema 被改动：{name} 期望 {golden}，实际 {actual}")


# ---------------------------------------------------------------------------
# §9.4 插件私有数据隔离（ext[plugin_id]）
# ---------------------------------------------------------------------------
def _assert_json_safe(plugin_id: str, value: Any) -> None:
    try:
        json.dumps(value)
    except (TypeError, ValueError) as exc:
        raise ContractError(
            f"插件 {plugin_id!r} 的私有数据必须 JSON 可序列化：{exc}") from exc


class ExtNamespace:
    """某插件对某记录的私有命名空间；只暴露 record.ext[plugin_id] 一格。"""

    def __init__(self, record, plugin_id: str):
        if not plugin_id:
            raise ContractError("plugin_id 不能为空")
        self._record = record
        self._pid = plugin_id

    def get(self) -> Optional[Any]:
        return self._record.ext.get(self._pid)

    def set(self, value: Any) -> None:
        _assert_json_safe(self._pid, value)
        self._record.ext[self._pid] = value

    def clear(self) -> None:
        self._record.ext.pop(self._pid, None)


# ---------------------------------------------------------------------------
# §9.3 引擎注册：只能新增 mode，不得覆盖核心
# ---------------------------------------------------------------------------
CORE_MODES = ("signal", "circuit", "vector")


class EngineRegistry:
    def __init__(self):
        self._modes: Dict[str, Any] = {m: None for m in CORE_MODES}

    def register(self, mode: str, factory: Any = None) -> None:
        if mode in CORE_MODES:
            raise ContractError(
                f"不得覆盖/替换核心引擎 mode：{mode!r}（自定义引擎只能注册为新 mode）")
        if mode in self._modes:
            raise ContractError(f"mode 已存在：{mode!r}")
        self._modes[mode] = factory

    def available(self) -> List[str]:
        return list(self._modes)


# ---------------------------------------------------------------------------
# §9.2 插件 kind：只扩不改 + user. 前缀
# ---------------------------------------------------------------------------
CORE_KINDS = (
    "gain", "sum", "lag", "integrate", "transfer_function",
    "state_space", "signal", "expression", "pi", "clip", "oscillator",
)


class KindRegistry:
    def __init__(self):
        self._kinds = set(CORE_KINDS)

    def register(self, kind: str, spec: Any = None) -> None:
        if not kind.startswith("user."):
            raise ContractError(f"自定义 kind 必须以 'user.' 前缀：{kind!r}")
        if kind in self._kinds:
            raise ContractError(f"kind 已存在：{kind!r}")
        self._kinds.add(kind)

    def has(self, kind: str) -> bool:
        return kind in self._kinds
