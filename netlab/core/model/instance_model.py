"""P2-A（A1）：不可变描述契约（NodeDesc / EdgeDesc）与运行态（NodeRuntime）。

本模块为 Model / CompiledModel / Runtime 三层提供稳定的数据契约：

- NodeDesc / EdgeDesc 只持描述字段，不含 state/inputs；
- 所有嵌套容器递归冻结为真正的 Mapping / Sequence 语义，而不是
  继承 dict / list 后覆写方法；deep_thaw 可无损还原普通容器；
- NodeRuntime 持运行态 state/inputs，与 NodeRecord 相互隔离。

兼容：NodeDesc.to_fields() 保留旧 A1 四字段契约；完整的静态描述字段由
to_model_fields() 提供。
"""
from __future__ import annotations

import copy
import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Iterator


# ---- 递归冻结容器 ----------------------------------------------------------

def _hashable(value: Any) -> Any:
    if isinstance(value, FrozenMapping):
        return tuple(sorted((str(k), _hashable(v)) for k, v in value.items()))
    if isinstance(value, FrozenSequence):
        return tuple(_hashable(v) for v in value)
    if isinstance(value, frozenset):
        return tuple(sorted(_hashable(v) for v in value))
    if isinstance(value, (dict, list, tuple, set)):
        return _hashable(deep_freeze(value))
    if hasattr(value, "tolist"):
        return _hashable(value.tolist())
    return value


class FrozenMapping(Mapping[str, Any]):
    """只读、递归冻结的 Mapping（非 dict 子类）。"""

    __slots__ = ("_data",)

    def __init__(self, data: Mapping[str, Any] | None = None) -> None:
        object.__setattr__(self, "_data", {str(k): deep_freeze(v) for k, v in dict(data or {}).items()})

    def __getitem__(self, key: str) -> Any:
        return self._data[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self._data)

    def __len__(self) -> int:
        return len(self._data)

    def __repr__(self) -> str:
        return f"FrozenMapping({self._data!r})"

    def __eq__(self, other: object) -> bool:
        if isinstance(other, Mapping):
            return dict(self._data) == {str(k): deep_thaw(v) for k, v in other.items()}
        return NotImplemented

    def __hash__(self) -> int:
        return hash(tuple(sorted((k, _hashable(v)) for k, v in self._data.items())))

    def __deepcopy__(self, memo: dict[int, Any]) -> "FrozenMapping":
        return FrozenMapping(copy.deepcopy(self._data, memo))


class FrozenSequence(Sequence[Any]):
    """只读、递归冻结的 Sequence（非 list/tuple 子类）。"""

    __slots__ = ("_items",)

    def __init__(self, items: Sequence[Any] | Iterator[Any] | None = None) -> None:
        object.__setattr__(self, "_items", tuple(deep_freeze(v) for v in list(items or ())))

    def __getitem__(self, index: int | slice) -> Any:
        return self._items[index]

    def __len__(self) -> int:
        return len(self._items)

    def __repr__(self) -> str:
        return f"FrozenSequence({self._items!r})"

    def __eq__(self, other: object) -> bool:
        if isinstance(other, Sequence) and not isinstance(other, (str, bytes, bytearray)):
            return list(self._items) == [deep_thaw(v) for v in other]
        return NotImplemented

    def __hash__(self) -> int:
        return hash(tuple(_hashable(v) for v in self._items))

    def __deepcopy__(self, memo: dict[int, Any]) -> "FrozenSequence":
        return FrozenSequence(copy.deepcopy(self._items, memo))


def deep_freeze(value: Any) -> Any:
    """递归冻结任意 JSON 式容器；标量原样返回。"""
    if isinstance(value, (FrozenMapping, FrozenSequence, frozenset)):
        return value
    if isinstance(value, Mapping):
        return FrozenMapping(value)
    if isinstance(value, (list, tuple)):
        return FrozenSequence(value)
    if isinstance(value, set):
        return frozenset(deep_freeze(item) for item in value)
    if isinstance(value, bytearray):
        return bytes(value)
    return copy.deepcopy(value)


def deep_thaw(value: Any) -> Any:
    """把冻结容器还原成普通 dict/list/set。"""
    if isinstance(value, FrozenMapping):
        return {k: deep_thaw(v) for k, v in value.items()}
    if isinstance(value, FrozenSequence):
        return [deep_thaw(v) for v in value]
    if isinstance(value, frozenset):
        return {deep_thaw(v) for v in value}
    if isinstance(value, Mapping):
        return {k: deep_thaw(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [deep_thaw(v) for v in value]
    return copy.deepcopy(value)


def canonical_json(value: Any) -> str:
    """稳定 JSON 序列化（排序键、紧凑分隔符、禁止 NaN）。"""
    def _default(item: Any) -> Any:
        if hasattr(item, "tolist"):
            return item.tolist()
        if hasattr(item, "item"):
            return item.item()
        raise TypeError(f"无法序列化类型 {type(item).__name__}")

    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
        default=_default,
    )


def stable_fingerprint(value: Any) -> str:
    """稳定 SHA-256 指纹。"""
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _freeze_mapping(value: Any) -> FrozenMapping:
    if isinstance(value, FrozenMapping):
        return value
    return FrozenMapping(value or {})


# ---- 节点描述 --------------------------------------------------------------

@dataclass(frozen=True)
class NodeDesc:
    """节点的不可变静态描述（无 state/inputs）。"""

    id: str
    name: str
    kind: str
    params: FrozenMapping
    data: FrozenMapping = field(default_factory=lambda: FrozenMapping({}))
    position: FrozenMapping = field(default_factory=lambda: FrozenMapping({}))
    size: FrozenMapping = field(default_factory=lambda: FrozenMapping({}))
    appearance: FrozenMapping = field(default_factory=lambda: FrozenMapping({}))

    def __post_init__(self) -> None:
        object.__setattr__(self, "id", str(self.id))
        object.__setattr__(self, "name", str(self.name))
        object.__setattr__(self, "kind", str(self.kind))
        for name in ("params", "data", "position", "size", "appearance"):
            object.__setattr__(self, name, _freeze_mapping(getattr(self, name)))

    @classmethod
    def from_record(cls, record: Any) -> "NodeDesc":
        return cls(
            id=str(record.id),
            name=str(record.name),
            kind=str(record.kind),
            params=deep_freeze(getattr(record, "params", {}) or {}),
            data=deep_freeze(getattr(record, "data", {}) or {}),
            position=deep_freeze(getattr(record, "position", {}) or {}),
            size=deep_freeze(getattr(record, "size", {}) or {}),
            appearance=deep_freeze(getattr(record, "appearance", {}) or {}),
        )

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "NodeDesc":
        return cls(
            id=str(payload.get("id", "")),
            name=str(payload.get("name", "")),
            kind=str(payload.get("kind", "")),
            params=deep_freeze(payload.get("params") or {}),
            data=deep_freeze(payload.get("data") or {}),
            position=deep_freeze(payload.get("position") or {}),
            size=deep_freeze(payload.get("size") or {}),
            appearance=deep_freeze(payload.get("appearance") or {}),
        )

    def to_fields(self) -> dict[str, Any]:
        """旧 A1 四字段契约（深拷贝）。"""
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "params": deep_thaw(self.params),
        }

    def to_model_fields(self) -> dict[str, Any]:
        """完整静态描述字段（深拷贝）。"""
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "params": deep_thaw(self.params),
            "data": deep_thaw(self.data),
            "position": deep_thaw(self.position),
            "size": deep_thaw(self.size),
            "appearance": deep_thaw(self.appearance),
        }


# ---- 连接描述 --------------------------------------------------------------

@dataclass(frozen=True)
class EdgeDesc:
    """连接/元件的不可变静态描述（无 state）。"""

    id: str
    name: str
    source: str
    target: str
    kind: str
    params: FrozenMapping
    delay: float = 0.0
    auto_delay: bool = False
    enabled: bool = True
    route: str = "auto"
    waypoints: FrozenSequence = field(default_factory=lambda: FrozenSequence())
    anchors: FrozenMapping = field(default_factory=lambda: FrozenMapping({}))
    layout: FrozenMapping = field(default_factory=lambda: FrozenMapping({}))
    source_pin: Any = None
    target_pin: Any = None
    source_port: Any = None
    target_port: Any = None
    appearance: FrozenMapping = field(default_factory=lambda: FrozenMapping({}))

    def __post_init__(self) -> None:
        for name in ("id", "name", "source", "target", "kind", "route"):
            object.__setattr__(self, name, str(getattr(self, name)))
        object.__setattr__(self, "delay", float(self.delay or 0.0))
        object.__setattr__(self, "auto_delay", bool(self.auto_delay))
        object.__setattr__(self, "enabled", bool(self.enabled))
        for name in ("params", "anchors", "layout", "appearance"):
            object.__setattr__(self, name, _freeze_mapping(getattr(self, name)))
        if not isinstance(self.waypoints, FrozenSequence):
            object.__setattr__(self, "waypoints", FrozenSequence(self.waypoints or ()))
        for name in ("source_pin", "target_pin", "source_port", "target_port"):
            object.__setattr__(self, name, deep_freeze(getattr(self, name)))

    @classmethod
    def from_record(cls, record: Any) -> "EdgeDesc":
        return cls(
            id=str(record.id),
            name=str(record.name),
            source=str(record.source),
            target=str(record.target),
            kind=str(record.kind),
            params=deep_freeze(getattr(record, "params", {}) or {}),
            delay=float(getattr(record, "delay", 0.0) or 0.0),
            auto_delay=bool(getattr(record, "auto_delay", False)),
            enabled=bool(getattr(record, "enabled", True)),
            route=str(getattr(record, "route", "auto") or "auto"),
            waypoints=deep_freeze(getattr(record, "waypoints", []) or []),
            anchors=deep_freeze(getattr(record, "anchors", {}) or {}),
            layout=deep_freeze(getattr(record, "layout", {}) or {}),
            source_pin=getattr(record, "source_pin", None),
            target_pin=getattr(record, "target_pin", None),
            source_port=getattr(record, "source_port", None),
            target_port=getattr(record, "target_port", None),
            appearance=deep_freeze(getattr(record, "appearance", {}) or {}),
        )

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "EdgeDesc":
        return cls(
            id=str(payload.get("id", "")),
            name=str(payload.get("name", "")),
            source=str(payload.get("source", "")),
            target=str(payload.get("target", "")),
            kind=str(payload.get("kind", "")),
            params=deep_freeze(payload.get("params") or {}),
            delay=float(payload.get("delay", 0.0) or 0.0),
            auto_delay=bool(payload.get("auto_delay", False)),
            enabled=bool(payload.get("enabled", True)),
            route=str(payload.get("route", "auto") or "auto"),
            waypoints=deep_freeze(payload.get("waypoints") or []),
            anchors=deep_freeze(payload.get("anchors") or {}),
            layout=deep_freeze(payload.get("layout") or {}),
            source_pin=payload.get("source_pin"),
            target_pin=payload.get("target_pin"),
            source_port=payload.get("source_port"),
            target_port=payload.get("target_port"),
            appearance=deep_freeze(payload.get("appearance") or {}),
        )

    def to_model_fields(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "source": self.source,
            "target": self.target,
            "kind": self.kind,
            "params": deep_thaw(self.params),
            "delay": self.delay,
            "auto_delay": self.auto_delay,
            "enabled": self.enabled,
            "route": self.route,
            "waypoints": deep_thaw(self.waypoints),
            "anchors": deep_thaw(self.anchors),
            "layout": deep_thaw(self.layout),
            "source_pin": deep_thaw(self.source_pin),
            "target_pin": deep_thaw(self.target_pin),
            "source_port": deep_thaw(self.source_port),
            "target_port": deep_thaw(self.target_port),
            "appearance": deep_thaw(self.appearance),
        }


# ---- 节点运行态 ------------------------------------------------------------

class NodeRuntime:
    """节点运行态（state/inputs），与持久化 NodeRecord 相互隔离。"""

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
