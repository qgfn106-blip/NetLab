"""只读诊断记录（R43/P3/P5）。

环形缓冲保存最近的数学加速事件，供 ``/api/diagnostics/telemetry``
与测试读取；不进入仿真状态，不影响任何求解结果。
"""

from __future__ import annotations

from collections import deque
import threading
import time
from typing import Any

_MAX_EVENTS = 256
_LOCK = threading.Lock()
_EVENTS: deque[dict[str, Any]] = deque(maxlen=_MAX_EVENTS)
_COUNTERS: dict[str, int] = {}


def record(stage: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """记录一条诊断事件，返回事件本体。"""
    event = {
        "stage": str(stage),
        "at": time.time(),
        **(payload or {}),
    }
    with _LOCK:
        _EVENTS.append(event)
        _COUNTERS[event["stage"]] = _COUNTERS.get(event["stage"], 0) + 1
    return event


def snapshot(limit: int = 50) -> dict[str, Any]:
    """返回当前诊断快照（最近 ``limit`` 条）。"""
    with _LOCK:
        events = list(_EVENTS)[-max(0, int(limit)) :]
        counters = dict(_COUNTERS)
    return {"counters": counters, "events": events, "capacity": _MAX_EVENTS}


def reset() -> None:
    """清空诊断（仅供测试）。"""
    with _LOCK:
        _EVENTS.clear()
        _COUNTERS.clear()
