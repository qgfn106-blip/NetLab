"""P5.2 遥测误差界：从 Recorder 样本估计插值误差与 FIFO 数据年龄。

这里只做**只读、可复算**的质量口径：

* 线性插值误差：对均匀采样，经典界为 ``M*h^2/8``（``M=max|f''|``）。
  运行时没有 ``M`` 的先验上界，因此用样本二阶差分给出**数据派生的保守估计**：
  ``max|Δ²y|/8``。它等价于把 ``M`` 估计为 ``max|Δ²y|/h^2``；
  这不是对采样点之间未观测极值的严格证书，假设中必须写明。
* FIFO 延迟：进程内 ``Recorder`` 是定长丢弃最旧帧的环形缓冲。读取窗口最旧帧的
  最大数据年龄为 ``capacity * sample_dt``（秒）；不含磁盘/网络传输延迟。
"""

from __future__ import annotations

import math
import statistics
from typing import Any, Mapping, Sequence


def sample_dt_from_frames(frames: Sequence[Mapping[str, Any]]) -> float | None:
    """从帧时间戳估计采样间隔（中位数）；不足两帧返回 None。"""
    if len(frames) < 2:
        return None
    times: list[float] = []
    for frame in frames:
        try:
            value = float(frame["t"])
        except (KeyError, TypeError, ValueError):
            return None
        if not math.isfinite(value):
            return None
        times.append(value)
    diffs = [b - a for a, b in zip(times, times[1:]) if b > a]
    if not diffs:
        return None
    return float(statistics.median(diffs))


def interpolation_error_bound(frames: Sequence[Mapping[str, Any]]) -> float | None:
    """样本二阶差分派生的线性插值误差估计 ``max|Δ²y|/8``。

    要求至少 3 帧且所有探针值有限；否则返回 None。
    """
    if len(frames) < 3:
        return None
    first_values = frames[0].get("v")
    if not isinstance(first_values, Mapping):
        return None
    keys = list(first_values.keys())
    if not keys:
        return None
    max_second_difference = 0.0
    seen_valid_channel = False
    for key in keys:
        values: list[float] = []
        valid = True
        for frame in frames:
            probes = frame.get("v")
            if not isinstance(probes, Mapping) or key not in probes:
                valid = False
                break
            try:
                value = float(probes[key])
            except (TypeError, ValueError):
                valid = False
                break
            if not math.isfinite(value):
                valid = False
                break
            values.append(value)
        if not valid or len(values) < 3:
            continue
        seen_valid_channel = True
        for index in range(1, len(values) - 1):
            second = abs(values[index + 1] - 2.0 * values[index] + values[index - 1])
            if second > max_second_difference:
                max_second_difference = second
    if not seen_valid_channel:
        return None
    return max_second_difference / 8.0


def fifo_delay_bound(
    capacity: int, sample_dt: float | None, frames_recorded: int
) -> float | None:
    """FIFO 窗口最旧帧的最大数据年龄（秒）；无帧或采样间隔未知时返回 None。"""
    if frames_recorded <= 0 or capacity <= 0 or sample_dt is None:
        return None
    if not math.isfinite(sample_dt) or sample_dt <= 0.0:
        return None
    return float(capacity) * float(sample_dt)
