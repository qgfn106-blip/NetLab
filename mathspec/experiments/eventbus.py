"""P2/P8 最小事件总线原型：事件堆 + 时钟推进 + 零穿越二分定位。

对应 PERFORMANCE §31.3 P2（DEVS × FMI）与 §25 的零交叉/事件定位需求。
"""
from __future__ import annotations

import heapq
from dataclasses import dataclass, field
from typing import Callable, List, Tuple


@dataclass(order=True)
class Event:
    time: float
    kind: str = field(compare=False)
    payload: Tuple = field(default=(), compare=False)


class EventQueue:
    def __init__(self) -> None:
        self._heap: List[Event] = []

    def push(self, time: float, kind: str, payload: Tuple = ()) -> None:
        heapq.heappush(self._heap, Event(float(time), kind, payload))

    def pop(self) -> Event:
        if not self._heap:
            raise IndexError("event queue empty")
        return heapq.heappop(self._heap)

    def peek_time(self) -> float:
        if not self._heap:
            return float("inf")
        return self._heap[0].time

    def __len__(self) -> int:
        return len(self._heap)


def locate_zero(f: Callable[[float], float], a: float, b: float,
                tol: float = 1e-12, max_iter: int = 200) -> float:
    """二分定位 f 在 [a,b] 内的零点；要求 f(a)*f(b) <= 0。"""
    fa, fb = f(a), f(b)
    if fa == 0.0:
        return a
    if fb == 0.0:
        return b
    if fa * fb > 0:
        raise ValueError("no sign change on interval")
    lo, hi = a, b
    for _ in range(max_iter):
        mid = 0.5 * (lo + hi)
        fm = f(mid)
        if abs(fm) < tol or (hi - lo) < tol:
            return mid
        if fa * fm <= 0:
            hi, fb = mid, fm
        else:
            lo, fa = mid, fm
    return 0.5 * (lo + hi)


def simulate_event_queue(events: List[Tuple[float, str]], t_end: float) -> List[Tuple[float, str]]:
    """按时间顺序处理事件（演示调度 = 事件驱动的最小骨架）。"""
    q = EventQueue()
    for t, kind in events:
        if t <= t_end:
            q.push(t, kind)
    out: List[Tuple[float, str]] = []
    while len(q):
        ev = q.pop()
        out.append((ev.time, ev.kind))
    return out
