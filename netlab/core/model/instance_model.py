"""P2-A（A1/P1）：Model 描述契约层 —— 递归深不可变 NodeDesc / EdgeDesc + NodeRuntime。

P1 范围（严格只读契约层，不切执行路径）：
- ``NodeDesc`` / ``EdgeDesc`` 只持**静态描述**字段，递归深不可变（含嵌套 dict/list/tuple/set）；
- ``NodeRuntime`` 保留运行态容器（本阶段仅类型，不接线）；
- 单一事实源仍是 ``NodeRecord`` / ``EdgeRecord``；描述对象从记录派生与其隔离，互不可变引用共享。

硬约束：纯契约层，不改执行路径 / 不迁 SignalEngine/Simulation / 不改 Network.step /
不改工程 JSON、PROJECT_VERSION=7、checksum / 不涉 Circuit/FEM。
"""
from __future__ import annotations

import copy
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

# ---------------------------------------------------------------------------
# 递归深不可变容器（P1）
# ---------------------------------------------------------------------------


class FrozenDict(dict):
    """递归深不可变的 dict；任何原地修改抛 TypeError。``deepcopy`` 返回普通 dict。"""

    def _immutable(self, *args: Any, **kwargs: Any) -> Any:
        raise TypeError("FrozenDict 不可修改")

    __setitem__ = _immutable
    __delitem__ = _immutable
    clear = _immutable
    pop = _immutable
    popitem = _immutable
    setdefault = _immutable
    update = _immutable
    __ior__ = _immutable
    __setattr__ = _immutable
    __delattr__ = _immutable

    def __deepcopy__(self, memo: dict[int, Any] | None = None) -> dict[str, Any]:
        memo = memo if memo is not None else {}
        return {copy.deepcopy(k, memo): copy.deepcopy(v, memo) for k, v in self.items()}


class FrozenList(list):
    """递归深不可变的 list；任何原地修改抛 TypeError。``deepcopy`` 返回普通 list。"""

    def _immutable(self, *args: Any, **kwargs: Any) -> Any:
        raise TypeError("FrozenList 不可修改")

    __setitem__ = _immutable
    __delitem__ = _immutable
    append = _immutable
    extend = _immutable
    insert = _immutable
    pop = _immutable
    remove = _immutable
    clear = _immutable
    sort = _immutable
    reverse = _immutable
    __iadd__ = _immutable
    __imul__ = _immutable
    __setattr__ = _immutable

    def __deepcopy__(self, memo: dict[int, Any] | None = None) -> list[Any]:
        memo = memo if memo is not None else {}
        return [copy.deepcopy(v, memo) for v in self]


def deep_freeze(value: Any) -> Any:
    """把嵌套容器递归冻结为不可变结构（dict→FrozenDict、list→FrozenList、tuple/set 递归）。"""
    if isinstance(value, Mapping):
        return FrozenDict({k: deep_freeze(v) for k, v in value.items()})
    if isinstance(value, list):
        return FrozenList([deep_freeze(v) for v in value])
    if isinstance(value, tuple):
        return tuple(deep_freeze(v) for v in value)
    if isinstance(value, (set, frozenset)):
        return frozenset(deep_freeze(v) for v in value)
    return value


def thaw(value: Any) -> Any:
    """把冻结结构还原为独立的普通 Python 结构（深拷贝，保留容器类型）。"""
    if isinstance(value, FrozenDict):
        return {k: thaw(v) for k, v in value.items()}
    if isinstance(value, FrozenList):
        return [thaw(v) for v in value]
    if isinstance(value, tuple):
        return tuple(thaw(v) for v in value)
    if isinstance(value, frozenset):
        return frozenset(thaw(v) for v in value)
    return copy.deepcopy(value)


# ---------------------------------------------------------------------------
# 描述对象（静态、深不可变）
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class NodeDesc:
    """节点的不可变描述视图（无运行态 state/inputs）。"""

    id: str
    name: str
    kind: str
    params: Mapping[str, Any]

    def __post_init__(self) -> None:
        if not isinstance(self.params, Mapping):
            raise TypeError("NodeDesc.params 必须是 Mapping")
        object.__setattr__(self, "params", deep_freeze(dict(self.params)))

    @classmethod
    def from_record(cls, record: Any) -> "NodeDesc":
        return cls(
            id=str(record.id),
            name=str(record.name),
            kind=str(record.kind),
            params=copy.deepcopy(dict(getattr(record, "params", {}) or {})),
        )

    def to_fields(self) -> dict[str, Any]:
        """描述字段的独立字典（深拷贝，无共享可变引用）。"""
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "params": thaw(self.params),
        }


# ---------------------------------------------------------------------------
# 连接描述对象（静态、深不可变；与 edge_types.EdgeDesc 的「边类型分类视图」区分：
# 本类面向 CompiledModel 的完整静态连接属性，不含运行态 state）
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EdgeDesc:
    """连接的不可变静态描述（无运行态 state）。"""

    id: str
    name: str
    source: str
    target: str
    kind: str
    params: Any = None
    source_port: str = ""
    target_port: str = ""
    delay: bool = False
    auto_delay: bool = False
    enabled: bool = True

    def __post_init__(self) -> None:
        raw = {} if self.params is None else self.params
        if not isinstance(raw, Mapping):
            raise TypeError("EdgeDesc.params 必须是 Mapping")
        object.__setattr__(self, "params", deep_freeze(dict(raw)))

    @classmethod
    def from_record(cls, record: Any) -> "EdgeDesc":
        return cls(
            id=str(record.id),
            name=str(getattr(record, "name", "")),
            source=str(record.source),
            target=str(record.target),
            kind=str(record.kind),
            params=copy.deepcopy(dict(getattr(record, "params", {}) or {})),
            source_port=str(getattr(record, "source_port", "")),
            target_port=str(getattr(record, "target_port", "")),
            delay=bool(getattr(record, "delay", False)),
            auto_delay=bool(getattr(record, "auto_delay", False)),
            enabled=bool(getattr(record, "enabled", True)),
        )

    def to_fields(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "source": self.source,
            "target": self.target,
            "kind": self.kind,
            "params": thaw(self.params),
            "source_port": self.source_port,
            "target_port": self.target_port,
            "delay": self.delay,
            "auto_delay": self.auto_delay,
            "enabled": self.enabled,
        }


# ---------------------------------------------------------------------------
# 运行态容器（仅类型，本阶段不接线）
# ---------------------------------------------------------------------------


class NodeRuntime:
    """节点运行态（state/inputs），与持久化 ``NodeRecord`` 相互隔离。"""

    __slots__ = ("state", "inputs")

    def __init__(
        self,
        state: dict[str, Any] | None = None,
        inputs: dict[str, Any] | None = None,
    ) -> None:
        self.state: dict[str, Any] = copy.deepcopy(state or {})
        self.inputs: dict[str, Any] = copy.deepcopy(inputs or {})

    @classmethod
    def from_record(cls, record: Any) -> "NodeRuntime":
        return cls(state=getattr(record, "state", {}) or {}, inputs=getattr(record, "inputs", {}) or {})

    def snapshot(self) -> dict[str, Any]:
        return {"state": copy.deepcopy(self.state), "inputs": copy.deepcopy(self.inputs)}

    def restore(self, snapshot: dict[str, Any]) -> None:
        if not isinstance(snapshot, dict):
            raise TypeError("NodeRuntime.restore 需要 dict 快照")
        if "state" not in snapshot or "inputs" not in snapshot:
            raise ValueError("NodeRuntime.restore 快照缺少 state/inputs 键")
        self.state = copy.deepcopy(snapshot["state"])
        self.inputs = copy.deepcopy(snapshot["inputs"])
