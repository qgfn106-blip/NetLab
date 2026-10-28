"""计时装饰器与环形采样（R13 / D17）。

设计要点：

* **关闭时几乎零开销**：包装函数第一行就是布尔判断，不做任何时间读取；
* 开启后只记录「函数名、次数、总时长、最大时长、最后时长」，环形保留最近
  ``MAX_SAMPLES`` 次采样，避免长时间运行把内存吃光；
* 线程安全（仿真线程与 HTTP 线程都会读写），但不加锁做聚合计算之外的等待；
* 计时失败绝不影响被装饰函数本身（记录异常吞掉）。

用法::

    @timed("scene.step")
    def step(self, dt): ...

    with profiling.measure("analysis.fft"):
        ...
"""

from __future__ import annotations

import functools
import threading
import time
from collections import deque
from contextlib import contextmanager
from typing import Any, Callable, Iterator, TypeVar

MAX_SAMPLES = 512
F = TypeVar("F", bound=Callable[..., Any])


class Profiler:
    """极轻量的全局计时器；默认关闭。"""

    def __init__(self) -> None:
        self._enabled = False
        self._lock = threading.Lock()
        self._samples: deque[tuple[str, float]] = deque(maxlen=MAX_SAMPLES)
        self._totals: dict[str, list[float]] = {}

    @property
    def enabled(self) -> bool:
        return self._enabled

    def set_enabled(self, value: bool) -> bool:
        self._enabled = bool(value)
        return self._enabled

    def clear(self) -> None:
        with self._lock:
            self._samples.clear()
            self._totals.clear()

    def record(self, name: str, seconds: float) -> None:
        if not self._enabled:
            return
        if seconds < 0:
            seconds = 0.0
        with self._lock:
            self._samples.append((name, seconds))
            entry = self._totals.get(name)
            if entry is None:
                entry = [0.0, 0.0, 0.0, 0.0]  # count, total, max, last
                self._totals[name] = entry
            entry[0] += 1.0
            entry[1] += seconds
            entry[2] = max(entry[2], seconds)
            entry[3] = seconds

    def snapshot(self, top: int = 20) -> dict[str, Any]:
        with self._lock:
            entries = [
                {
                    "name": name,
                    "count": int(values[0]),
                    "total_ms": round(values[1] * 1000.0, 4),
                    "max_ms": round(values[2] * 1000.0, 4),
                    "last_ms": round(values[3] * 1000.0, 4),
                    "mean_ms": round(values[1] * 1000.0 / values[0], 4)
                    if values[0]
                    else 0.0,
                }
                for name, values in self._totals.items()
            ]
            samples = len(self._samples)
            capacity = self._samples.maxlen
        entries.sort(key=lambda item: item["total_ms"], reverse=True)
        count = max(1, min(100, int(top)))
        return {
            "enabled": self._enabled,
            "samples": samples,
            "capacity": capacity,
            "entries": entries[:count],
        }


PROFILER = Profiler()


def set_enabled(value: bool) -> bool:
    return PROFILER.set_enabled(value)


def snapshot(top: int = 20) -> dict[str, Any]:
    return PROFILER.snapshot(top)


def clear() -> None:
    PROFILER.clear()


def timed(name: str | None = None) -> Callable[[F], F]:
    """装饰器：开启时记录一次调用耗时；关闭时只多一次布尔判断。"""

    def decorator(function: F) -> F:
        label = name or function.__qualname__

        @functools.wraps(function)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            if not PROFILER._enabled:  # 快路径：不读时钟
                return function(*args, **kwargs)
            started = time.perf_counter()
            try:
                return function(*args, **kwargs)
            finally:
                try:
                    PROFILER.record(label, time.perf_counter() - started)
                except Exception:  # 计时永远不能影响业务
                    pass

        return wrapper  # type: ignore[return-value]

    return decorator


@contextmanager
def measure(name: str) -> Iterator[None]:
    """显式计时块；关闭时不做任何时间读取。"""
    if not PROFILER._enabled:
        yield
        return
    started = time.perf_counter()
    try:
        yield
    finally:
        try:
            PROFILER.record(name, time.perf_counter() - started)
        except Exception:
            pass


__all__ = [
    "MAX_SAMPLES",
    "Profiler",
    "PROFILER",
    "timed",
    "measure",
    "set_enabled",
    "snapshot",
    "clear",
]
