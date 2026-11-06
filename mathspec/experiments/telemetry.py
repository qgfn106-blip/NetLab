"""端到端遥测与事件分析原型。

组合 §14 的机电试验台、量化/差分/CRC 管线与 §25 的零穿越分析：

1. 对连续系统输出做均匀采样；
2. 量化后用有符号一阶差分和 zlib 编码；
3. 通过带 CRC 的分块链路重传；
4. 解码并在重构信号上估计阈值穿越时刻。

链路在本实验的“单比特损坏→CRC 检测→有限重传成功”模型下无损；CRC32 不是密码学校验，
本原型不宣称对任意对抗性错误无损。因此事件时刻误差只由量化和采样插值造成。
"""
from __future__ import annotations

from typing import Dict

import numpy as np
import zlib

from mathspec.experiments.dataflow import (
    UniformQuantizer,
    delta_encode,
    pack_delta_codes,
    transmit_with_retry,
    unpack_delta_codes,
)
from mathspec.experiments.eventbus import locate_zero


def linear_crossing_time(ts: np.ndarray, values: np.ndarray,
                         threshold: float) -> float:
    """用相邻样本的分段线性插值估计首次上穿时刻。

    要求样本时间严格递增；若存在下降穿越，也支持首次符号变化。
    该函数只在观测样本上工作，不宣称消除采样插值误差。
    """
    ts = np.asarray(ts, dtype=float)
    values = np.asarray(values, dtype=float)
    if ts.ndim != 1 or values.ndim != 1 or ts.size != values.size:
        raise ValueError("ts 和 values 必须是等长一维数组")
    if ts.size < 2 or np.any(np.diff(ts) <= 0):
        raise ValueError("ts 必须至少含两个严格递增样本")
    g = values - float(threshold)
    for i in range(ts.size - 1):
        if g[i] == 0.0:
            return float(ts[i])
        if g[i] * g[i + 1] <= 0.0:
            if g[i + 1] == g[i]:
                return float(ts[i])
            alpha = -g[i] / (g[i + 1] - g[i])
            return float(ts[i] + alpha * (ts[i + 1] - ts[i]))
    raise ValueError("信号在时间窗内没有阈值穿越")


def locate_sample_crossing(ts: np.ndarray, values: np.ndarray,
                           threshold: float) -> int:
    """返回首次穿越所在的样本区间左端点。"""
    ts = np.asarray(ts, dtype=float)
    values = np.asarray(values, dtype=float)
    g = values - float(threshold)
    for i in range(len(g) - 1):
        if g[i] == 0.0 or g[i] * g[i + 1] <= 0.0:
            return i
    raise ValueError("信号在时间窗内没有阈值穿越")


def crossing_quantization_bound(dt: float, y0: float, y1: float,
                                epsilon: float) -> float:
    """固定穿越区间内，端点误差 <= epsilon 导致的线性时刻误差上界。

    设 d=|y1-y0|，且原始/重构端点保持同一侧并满足 d>2 epsilon。
    对线性插值参数 alpha，直接展开可得
    |alpha_hat-alpha| <= epsilon/(d-2 epsilon)，故时刻界为 dt 倍该量。
    这是量化误差界，不包含采样插值相对真实连续轨迹的误差。
    """
    dt = float(dt)
    y0, y1, epsilon = float(y0), float(y1), float(epsilon)
    d = abs(y1 - y0)
    if (not np.all(np.isfinite([dt, y0, y1, epsilon]))
            or dt <= 0.0 or epsilon < 0.0 or d <= 2.0 * epsilon):
        raise ValueError("需要有限输入、dt>0、epsilon>=0 且端点变化满足 d>2epsilon")
    return dt * epsilon / (d - 2.0 * epsilon)


def continuous_crossing_interpolation_bound(dt: float, curvature_bound: float,
                                            slope_lower_bound: float) -> float:
    """Bound chord-root error relative to a unique continuous root.

    If f is C² on a bracket of width dt, |f''| <= curvature_bound, and
    |f'| >= slope_lower_bound > 0 throughout it, the linear-interpolant root
    differs from the true root by at most M*dt²/(8*m).
    """
    dt = float(dt)
    curvature_bound = float(curvature_bound)
    slope_lower_bound = float(slope_lower_bound)
    if (not np.all(np.isfinite([dt, curvature_bound, slope_lower_bound]))
            or dt <= 0.0 or curvature_bound < 0.0 or slope_lower_bound <= 0.0):
        raise ValueError("需要 dt>0、曲率界>=0、斜率下界>0 且均为有限数")
    return curvature_bound * dt * dt / (8.0 * slope_lower_bound)


def combined_event_time_bound(dt: float, y0: float, y1: float,
                              epsilon: float, curvature_bound: float,
                              slope_lower_bound: float) -> float:
    """Combine quantized-chord and continuous interpolation error bounds."""
    return (crossing_quantization_bound(dt, y0, y1, epsilon)
            + continuous_crossing_interpolation_bound(
                dt, curvature_bound, slope_lower_bound))


def max_quantization_error_for_tolerance(
        dt: float, y0: float, y1: float, time_tolerance: float,
        curvature_bound: float, slope_lower_bound: float,
        additional_time_error: float = 0.0) -> float:
    """Largest epsilon allowed by the additive end-to-end time-error budget.

    This is an algebraic budget calculation only; it does not establish a
    bracket, endpoint sign margin, unique root, or non-tangency. The caller
    must validate those crossing assumptions separately. The sampled endpoint
    gap ``d = |y1 - y0|`` is held fixed.

    ``additional_time_error`` should be zero when source timestamps are
    preserved end-to-end, because transport latency then changes only the
    notification wall time, not the source-time estimate. Use a separately
    bounded value when analyzing arrival-time estimates.
    """
    dt = float(dt)
    y0, y1 = float(y0), float(y1)
    time_tolerance = float(time_tolerance)
    additional_time_error = float(additional_time_error)
    if (not np.all(np.isfinite([dt, y0, y1, time_tolerance,
                                additional_time_error]))
            or dt <= 0.0 or time_tolerance <= 0.0
            or additional_time_error < 0.0):
        raise ValueError("时间间隔/容差必须为正，附加误差须非负且所有输入有限")
    interpolation = continuous_crossing_interpolation_bound(
        dt, curvature_bound, slope_lower_bound)
    remaining = time_tolerance - interpolation - additional_time_error
    d = abs(y1 - y0)
    if remaining <= 0.0 or d <= 0.0:
        raise ValueError("连续插值与附加误差已耗尽预算，或端点没有变化")
    # Solve dt*epsilon/(d-2*epsilon) <= remaining for epsilon.
    return remaining * d / (dt + 2.0 * remaining)


def interpolated_arrival_delay(alpha: float, delay0: float,
                               delay1: float) -> float:
    """Return the convexly interpolated endpoint delay (alpha in [0,1])."""
    alpha, delay0, delay1 = float(alpha), float(delay0), float(delay1)
    if (not np.all(np.isfinite([alpha, delay0, delay1]))
            or not 0.0 <= alpha <= 1.0 or delay0 < 0.0 or delay1 < 0.0):
        raise ValueError("alpha 必须在 [0,1]，延迟须为非负有限数")
    return (1.0 - alpha) * delay0 + alpha * delay1


def fifo_window_delay_bound(backlog_ahead_chunks: int, window_chunks: int,
                            max_attempts: int, service_time: float,
                            failed_attempt_wait: float,
                            propagation_delay: float) -> float:
    """Bound delivery time for a finite FIFO window under explicit limits.

    Counts are chunks; backlog includes every chunk ahead of this window.
    Each chunk succeeds within at most ``max_attempts`` attempts. Each attempt
    costs at most service_time, each failed attempt incurs at most
    failed_attempt_wait, and each chunk incurs propagation_delay. Unbounded
    outage, timeout, or retries invalidate the result.
    """
    counts = (backlog_ahead_chunks, window_chunks, max_attempts)
    if any(not isinstance(v, (int, np.integer)) for v in counts):
        raise ValueError("队列计数与尝试次数必须为整数")
    if backlog_ahead_chunks < 0 or window_chunks < 1 or max_attempts < 1:
        raise ValueError("积压须非负，窗口块数和最大尝试次数须为正")
    service_time = float(service_time)
    failed_attempt_wait = float(failed_attempt_wait)
    propagation_delay = float(propagation_delay)
    if (not np.all(np.isfinite([service_time, failed_attempt_wait,
                                propagation_delay]))
            or min(service_time, failed_attempt_wait, propagation_delay) < 0.0):
        raise ValueError("服务、失败等待和传播时间须为非负有限数")
    per_chunk = (max_attempts * service_time
                 + (max_attempts - 1) * failed_attempt_wait
                 + propagation_delay)
    return float((backlog_ahead_chunks + window_chunks) * per_chunk)


def telemetry_event_pipeline(ts: np.ndarray, values: np.ndarray,
                             threshold: float, quantizer: UniformQuantizer,
                             chunk_size: int = 256,
                             corruption_rate: float = 0.0,
                             seed: int = 0) -> Dict[str, object]:
    """Run the zero-coupled telemetry, lossless-link, and event-analysis chain.

    Event detection uses the first exact-zero or first sign-change interval.
    The returned quantized-chord bound is valid only when that interval is
    preserved, endpoint signs remain valid, ``d > 2*epsilon``, and the caller
    has established a unique non-tangent crossing. Multiple or tangent roots
    are not certified by this first-crossing check.
    """
    ts = np.asarray(ts, dtype=float)
    values = np.asarray(values, dtype=float)
    threshold = float(threshold)
    if ts.ndim != 1 or values.ndim != 1 or ts.size != values.size:
        raise ValueError("ts 和 values 必须是等长一维数组")
    if (ts.size < 2 or not np.all(np.isfinite(ts))
            or not np.all(np.isfinite(values)) or not np.isfinite(threshold)
            or np.any(np.diff(ts) <= 0.0)):
        raise ValueError("时间戳须有限严格递增，信号/阈值须有限且至少两个样本")
    if (not isinstance(chunk_size, (int, np.integer)) or chunk_size < 1):
        raise ValueError("chunk_size 必须为正整数")
    if np.any(values < quantizer.xmin) or np.any(values > quantizer.xmax):
        raise ValueError("量化器发生饱和，半量化步长误差界不适用")
    codes = quantizer.encode(values)
    deltas = delta_encode(codes)
    payload = zlib.compress(pack_delta_codes(deltas))
    sent = transmit_with_retry(payload, chunk_size=chunk_size,
                               corruption_rate=corruption_rate, seed=seed)
    decoded_deltas = unpack_delta_codes(zlib.decompress(sent["data"]))
    decoded_codes = np.cumsum(decoded_deltas)
    if not np.array_equal(decoded_codes, codes):
        raise RuntimeError("遥测解码结果与发送前码流不一致")
    reconstructed = quantizer.decode(decoded_codes)

    i_raw = locate_sample_crossing(ts, values, threshold)
    try:
        i_hat = locate_sample_crossing(ts, reconstructed, threshold)
    except ValueError as exc:
        raise ValueError("量化改变了穿越区间，当前误差界不适用") from exc
    if i_raw != i_hat:
        raise ValueError("量化改变了穿越区间，当前误差界不适用")
    raw_time = linear_crossing_time(ts, values, threshold)
    reconstructed_time = linear_crossing_time(ts, reconstructed, threshold)
    dt = float(ts[i_raw + 1] - ts[i_raw])
    bound = crossing_quantization_bound(
        dt, values[i_raw], values[i_raw + 1], quantizer.max_abs_error())
    raw = pack_delta_codes(deltas)
    return {
        "time": raw_time,
        "reconstructed_time": reconstructed_time,
        "time_error": abs(reconstructed_time - raw_time),
        "time_bound": bound,
        "sample_index": i_raw,
        "decoded_values": reconstructed,
        "payload_bytes": len(payload),
        "raw_delta_bytes": len(raw),
        "compression_ratio": len(raw) / max(len(payload), 1),
        "chunks": sent["chunks"],
        "retransmits": sent["retransmits"],
        "lossless_codes": True,
    }


def exact_linear_event_check() -> float:
    """独立的小验证：事件总线二分在解析根上达到数值精度。"""
    root = locate_zero(lambda t: t - 1.23456789, 0.0, 2.0)
    return abs(root - 1.23456789)
