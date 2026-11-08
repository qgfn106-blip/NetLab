"""Shared simulation clock.

A single mutable clock object is owned by :class:`Scene` and passed by
reference to every engine that participates in the same simulation.  Keeping
one clock avoids the historical situation where ``Simulation.time``,
``Network.time``, ``CircuitSolver.time`` and ``FEM.time`` advanced
independently and could drift after breakpoints or failed/rolled-back steps.

The clock is deliberately tiny and dependency-free so it can be imported by
model, compute and test code without creating import cycles.
"""

from __future__ import annotations

import math


class SimClock:
    """A finite, mutable simulation time value shared by reference."""

    __slots__ = ("_time",)

    def __init__(self, time: float = 0.0) -> None:
        self._time = 0.0
        self.time = time

    @property
    def time(self) -> float:
        return self._time

    @time.setter
    def time(self, value: float) -> None:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise TypeError("仿真时间必须是数字")
        value = float(value)
        if not math.isfinite(value):
            raise ValueError("仿真时间必须是有限数")
        self._time = value

    def advance(self, dt: float) -> float:
        """Advance by ``dt`` and return the new time."""
        if isinstance(dt, bool) or not isinstance(dt, (int, float)):
            raise TypeError("步长必须是数字")
        dt = float(dt)
        if not math.isfinite(dt) or dt <= 0.0:
            raise ValueError("步长必须是正的有限数")
        self._time += dt
        return self._time

    def reset(self) -> None:
        self._time = 0.0

    def snapshot(self) -> float:
        return self._time

    def restore(self, value: float) -> None:
        self.time = value

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"SimClock({self._time!r})"
