"""纯协议：电路求解器/节点/元件工厂/积分方法的最小契约（无实现依赖）。"""
from __future__ import annotations

from typing import Any, Mapping, Protocol, runtime_checkable


@runtime_checkable
class CircuitNodeProtocol(Protocol):
    id: str
    name: str
    ground: bool


@runtime_checkable
class CircuitSolverProtocol(Protocol):
    nodes: list[Any]
    matrix_size: int

    def step(self, dt: float, deadline: float | None = ...) -> Mapping[str, Any]: ...

    def operating_point(self) -> Mapping[str, Any]: ...

    def capture_checkpoint(self) -> Mapping[str, Any]: ...

    def restore_checkpoint(self, checkpoint: Mapping[str, Any]) -> None: ...


class ElementFactoryProtocol(Protocol):
    """由节点/参数构造元件实例的工厂。"""

    def __call__(self, node: Any) -> Any: ...


class IntegrationMethodProtocol(Protocol):
    """积分方法（如梯形/后向欧拉）的元数据契约。"""

    name: str
    value: str
