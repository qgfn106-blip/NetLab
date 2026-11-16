"""纯协议：仿真时钟（无实现依赖）。"""
from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class SimClockProtocol(Protocol):
    """仿真时钟的最小契约：推进与读当前时刻。"""

    def tick(self, dt: float) -> None: ...

    def now(self) -> float: ...
