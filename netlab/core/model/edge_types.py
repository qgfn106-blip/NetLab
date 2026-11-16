"""P2-C：Edge 三型（Dependency / Physical / Layout）纯数据契约与判定纯函数。

设计依据：用户 2026-11-15 决策（受控短期并存、禁双事实源）+ P2-C 只读草案
（NetlabExtras/scratch/p2_decision/09_P2C_EDGE_TYPES_READONLY_DESIGN.md）。
本模块**纯新增、不接线、不双写**：不替换 EdgeRecord、不改图求解、不改 PROJECT_VERSION。
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any

EDGE_TYPES = ("dependency", "physical", "layout")

_LEGACY_KIND_MAP = MappingProxyType({
    "wire": "physical",
    "signal": "dependency",
})


@dataclass(frozen=True)
class EdgeTypeInfo:
    kind: str
    participates_in_solve: bool
    description: str


EDGE_TYPE_INFO = MappingProxyType({
    "dependency": EdgeTypeInfo("dependency", True, "信号/数据依赖（影响拓扑与求解顺序）"),
    "physical": EdgeTypeInfo("physical", True, "物理连接（电气导线/端子）"),
    "layout": EdgeTypeInfo("layout", False, "仅布局/视觉连线，不参与求解"),
})


def classify_edge_kind(kind: Any) -> str:
    """把（可能是旧字符串的）边 kind 归类到三型之一；未知一律 fail-closed 抛 ValueError。"""
    if not isinstance(kind, str):
        raise ValueError(f"边类型必须是字符串，收到 {type(kind).__name__}")
    if kind in EDGE_TYPES:
        return kind
    if kind in _LEGACY_KIND_MAP:
        return _LEGACY_KIND_MAP[kind]
    raise ValueError(f"未知边类型：{kind!r}（允许 {EDGE_TYPES} 或旧映射 {tuple(_LEGACY_KIND_MAP)}）")


def try_classify_edge_kind(kind: Any) -> str | None:
    """宽松版本：未知返回 None（可选；默认路径应使用 fail-closed 的 classify_edge_kind）。"""
    try:
        return classify_edge_kind(kind)
    except ValueError:
        return None


def edge_participates_in_solve(kind: Any) -> bool:
    """该边类型是否参与求解（layout=False；dependency/physical=True）。"""
    return EDGE_TYPE_INFO[classify_edge_kind(kind)].participates_in_solve


@dataclass(frozen=True)
class EdgeDesc:
    """从 EdgeRecord 派生的惰性描述（不持有运行态、不改原记录）。"""

    id: str
    source: str
    target: str
    edge_type: str
    params: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_record(cls, record: Any) -> "EdgeDesc":
        return cls(
            id=str(getattr(record, "id")),
            source=str(getattr(record, "source")),
            target=str(getattr(record, "target")),
            edge_type=classify_edge_kind(getattr(record, "kind")),
            params=copy.deepcopy(getattr(record, "params", {}) or {}),
        )
