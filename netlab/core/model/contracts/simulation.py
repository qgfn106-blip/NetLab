"""纯协议：场景/仿真器的最小契约（无实现依赖）。"""
from __future__ import annotations

from typing import Any, Mapping, Protocol, runtime_checkable


@runtime_checkable
class SceneLikeProtocol(Protocol):
    mode: str
    nodes: Mapping[str, Any]
    edges: Mapping[str, Any]

    def ensure_engine(self) -> Any: ...

    def capture_checkpoint(self) -> Mapping[str, Any]: ...

    def restore_checkpoint(self, checkpoint: Mapping[str, Any]) -> None: ...


@runtime_checkable
class SimulationProtocol(Protocol):
    scene: Any
    config: Any
    steps: int
    time: float

    def step(self, dt: float) -> Mapping[str, Any]: ...
