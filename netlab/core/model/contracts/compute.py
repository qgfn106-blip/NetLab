"""纯类型：计算规格/处理器/端口/节点数据的结构化契约（无实现依赖）。

说明：这里用 Protocol 描述形状，避免与 `model.ports.PortSpec` 等具体 dataclass 重复定义；
R2–R5 时具体实现可按需 `implements` 或结构化匹配。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Protocol, Sequence, runtime_checkable


@dataclass(frozen=True)
class NodeData:
    """节点数据视图（只读快照用）。"""

    values: Mapping[str, float] = field(default_factory=dict)


@runtime_checkable
class PortSpecLike(Protocol):
    """端口描述形状（对应 model.ports.PortSpec 等）。"""

    name: str
    direction: str
    fields: Sequence[str]
    dtype: str
    description: str
    default: float


@runtime_checkable
class ComputeSpecProtocol(Protocol):
    """计算规格形状（kind/参数表的只读契约）。"""

    kind: str
    params: Mapping[str, Any]


class ComputeHandler(Protocol):
    """节点计算处理器：给定上下文/步长/节点与输入，写入输出。"""

    def __call__(
        self,
        ctx: Any,
        dt: float,
        node: Any,
        inputs: Mapping[str, Any],
        outputs: Mapping[str, Any],
    ) -> Any: ...
