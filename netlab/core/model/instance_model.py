"""P2-A（A1）：NodeDesc（不可变描述）/ NodeRuntime（运行态）惰性并行接缝。

严格约束（审批 m05956）：
- 纯新增，不接线到现有引擎、不双写；单一事实源仍为 ``NodeRecord``。
- ``NodeDesc`` 只持描述字段（id/name/kind/params），**不含** state/inputs；port 声明保持
  最小/不透明（不实现 PortType/单位/连接检查，属 P2-B）。
- ``NodeRuntime`` 持运行态 state/inputs，snapshot/restore 深拷贝；与 record 相互隔离。
- 不改外部 JSON / PROJECT_VERSION=7 / .netlab 格式 / checksum；不触 FEM / MAX_NODES。

本模块与 P1-S1 ``dto.py`` 同构：并行接缝，为后续「描述与运行态分离」提供类型入口，
当前不改动任何数值路径。
"""
from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class NodeDesc:
    """节点的不可变描述视图（无运行态）。"""

    id: str
    name: str
    kind: str
    params: dict[str, Any]

    @classmethod
    def from_record(cls, record: Any) -> "NodeDesc":
        return cls(
            id=str(record.id),
            name=str(record.name),
            kind=str(record.kind),
            params=copy.deepcopy(dict(record.params)),
        )

    def to_fields(self) -> dict[str, Any]:
        """描述字段的独立字典（深拷贝），用于 roundtrip 校验。"""
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "params": copy.deepcopy(self.params),
        }


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
