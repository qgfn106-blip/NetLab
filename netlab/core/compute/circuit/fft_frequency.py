"""时域轨迹频响近似（FFT / 自相关）。

本模块提供与描述器线性化路径并列的第二条频响通路：给定输入/输出时间序列，
估计 H(f)=Y(f)/X(f)。该路径只用于旁证与不可线性化场景的近似展示，不用于
稳定性判定——稳定性始终以描述器零极点/Nyquist 为准。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

import numpy as np

from ...common.limits import ValidationError

__all__ = [
    "FrequencyApproximation",
    "multisine",
    "estimate_transfer",
    "estimate_transfer_fft",
    "estimate_transfer_autocorrelation",
    "approximation_envelope",
]

_WINDOWS = ("none", "hann", "hamming", "blackman")


@dataclass(frozen=True)
class FrequencyApproximation:
    frequencies_hz: np.ndarray
    magnitude: np.ndarray
    phase_deg: np.ndarray
    coherence: np.ndarray
    valid: np.ndarray
    method: str
    window: str
    dt: float
    warnings: tuple[dict[str, Any], ...] = field(default_factory=tuple)


def _series(values: Iterable[float], name: str) -> np.ndarray:
    array = np.asarray(list(values), dtype=np.float64).reshape(-1)
    if array.size < 8:
        raise ValidationError(f"{name} 序列至少需要 8 个采样点，实际 {array.size}")
    if not np.all(np.isfinite(array)):
        raise ValidationError(f"{name} 序列包含非有限值")
    return array


def _window(samples: int, name: str) -> np.ndarray:
    key = (name or "none").lower()
    if key not in _WINDOWS:
        raise ValidationError(f"未知窗函数 {name!r}，可选 {', '.join(_WINDOWS)}")
    if key == "none":
        return np.ones(samples, dtype=np.float64)
    if key == "hann":
        return np.hanning(samples)
    if key == "hamming":
        return np.hamming(samples)
    return np.blackman(samples)


def _coherence(x: np.ndarray, y: np.ndarray, window: np.ndarray, segments: int = 4) -> np.ndarray:
    """用 Welch 分段估计 |Sxy|^2/(Sxx*Syy)，作为有效频段判据。"""
    size = x.size
    segment = max(16, size // max(1, segments))
    if segment >= size:
        return np.ones_like(np.abs(np.fft.rfft(x * window)))
    step = max(1, segment // 2)
    acc_xy: np.ndarray | None = None
    acc_xx: np.ndarray | None = None
    acc_yy: np.ndarray | None = None
    local_window = _window(segment, "hann")
    starts = list(range(0, size - segment + 1, step))
    bins = np.fft.rfftfreq(segment, d=1.0)
    for start in starts:
        xs = x[start : start + segment] * local_window
        ys = y[start : start + segment] * local_window
        fx = np.fft.rfft(xs)
        fy = np.fft.rfft(ys)
        xy = np.abs(fx * np.conj(fy)) ** 2
        xx = np.abs(fx) ** 2
        yy = np.abs(fy) ** 2
        acc_xy = xy if acc_xy is None else acc_xy + xy
        acc_xx = xx if acc_xx is None else acc_xx + xx
        acc_yy = yy if acc_yy is None else acc_yy + yy
    assert acc_xy is not None and acc_xx is not None and acc_yy is not None
    denom = acc_xx * acc_yy
    coherence = np.divide(acc_xy, denom, out=np.zeros_like(acc_xy), where=denom > 0.0)
    # 把分段分辨率映射回全序列频率轴。
    full_bins = np.fft.rfftfreq(size, d=1.0)
    if bins.size < 2:
        return np.ones_like(np.abs(np.fft.rfft(x * window)))
    return np.interp(full_bins, bins, np.clip(coherence, 0.0, 1.0))


def _fft_transfer(x: np.ndarray, y: np.ndarray, dt: float, window: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    win = _window(x.size, window)
    fx = np.fft.rfft(x * win)
    fy = np.fft.rfft(y * win)
    freqs = np.fft.rfftfreq(x.size, d=dt)
    denom = fx
    mag = np.divide(np.abs(fy), np.maximum(np.abs(denom), 1e-300))
    phase = np.degrees(np.angle(fy) - np.angle(fx))
    phase = (phase + 180.0) % 360.0 - 180.0
    valid = (np.abs(denom) > 1e-12) & np.isfinite(mag)
    return freqs, mag, phase, valid


def estimate_transfer_fft(
    input_values: Sequence[float],
    output_values: Sequence[float],
    dt: float,
    *,
    window: str = "hann",
    coherence_min: float = 0.8,
    f_min: float | None = None,
    f_max: float | None = None,
    settle_time_s: float = 0.0,
) -> FrequencyApproximation:
    """FFT 除法估计频响；返回相干性掩码与警告。

    settle_time_s 丢弃起始暂态采样，避免未稳态轨迹污染相位。
    """
    if dt <= 0.0:
        raise ValidationError("dt 必须为正")
    x = _series(input_values, "输入")
    y = _series(output_values, "输出")
    if x.size != y.size:
        raise ValidationError("输入与输出序列长度必须一致")
    trim = max(0, int(round(max(0.0, settle_time_s) / dt)))
    if trim:
        if x.size - trim < 8:
            raise ValidationError("settle_time_s 过大，剩余采样点不足")
        x, y = x[trim:], y[trim:]
    freqs, mag, phase, valid = _fft_transfer(x, y, dt, window)
    coherence = _coherence(x, y, _window(x.size, window))
    with np.errstate(invalid="ignore"):
        valid = valid & np.isfinite(coherence) & (coherence >= coherence_min)
    if f_min is not None:
        valid &= freqs >= float(f_min)
    if f_max is not None:
        valid &= freqs <= float(f_max)
    warnings: list[dict[str, Any]] = []
    if not np.any(valid):
        warnings.append(
            {
                "code": "fft_no_valid_band",
                "message": "FFT 近似没有满足相干性要求的频段，仅作参考。",
                "severity": "warning",
            }
        )
    warnings.append(
        {
            "code": "fft_approximation",
            "message": "该频响来自时域轨迹 FFT 近似，只用于旁证，不用于稳定性判定。",
            "severity": "info",
        }
    )
    return FrequencyApproximation(
        frequencies_hz=freqs,
        magnitude=mag,
        phase_deg=phase,
        coherence=coherence,
        valid=valid,
        method="fft",
        window=window,
        dt=float(dt),
        warnings=tuple(warnings),
    )


def estimate_transfer_autocorrelation(
    input_values: Sequence[float],
    output_values: Sequence[float],
    dt: float,
    *,
    coherence_min: float = 0.5,
    max_lag: int | None = None,
    settle_time_s: float = 0.0,
) -> FrequencyApproximation:
    """互相关/自相关（Wiener-Hopf）频响估计，适合含噪声的轨迹。"""
    if dt <= 0.0:
        raise ValidationError("dt 必须为正")
    x = _series(input_values, "输入")
    y = _series(output_values, "输出")
    if x.size != y.size:
        raise ValidationError("输入与输出序列长度必须一致")
    trim = max(0, int(round(max(0.0, settle_time_s) / dt)))
    if trim:
        if x.size - trim < 8:
            raise ValidationError("settle_time_s 过大，剩余采样点不足")
        x, y = x[trim:], y[trim:]
    size = x.size
    lags = int(max_lag or min(size // 2, 512))
    acf = np.correlate(x, x, mode="full")[size - 1 : size - 1 + lags]
    ccf = np.correlate(y, x, mode="full")[size - 1 : size - 1 + lags]
    acf = acf / max(float(acf[0]), 1e-300)
    spectrum_x = np.fft.rfft(acf)
    spectrum_y = np.fft.rfft(ccf / max(float(acf[0]), 1e-300))
    freqs = np.fft.rfftfreq(2 * lags - 1, d=dt)
    bins = min(freqs.size, spectrum_y.size)
    freqs = freqs[:bins]
    h = np.divide(spectrum_y[:bins], spectrum_x[:bins], out=np.zeros(bins, dtype=complex), where=np.abs(spectrum_x[:bins]) > 1e-12)
    mag = np.abs(h)
    phase = (np.degrees(np.angle(h)) + 180.0) % 360.0 - 180.0
    coherence = np.clip(np.abs(h) / (1.0 + np.abs(h)), 0.0, 1.0)
    valid = (np.abs(spectrum_x[:bins]) > 1e-12) & (coherence >= coherence_min) & np.isfinite(mag)
    warnings = [
        {
            "code": "fft_approximation",
            "message": "该频响来自自相关近似，只用于旁证，不用于稳定性判定。",
            "severity": "info",
        }
    ]
    return FrequencyApproximation(
        frequencies_hz=freqs,
        magnitude=mag,
        phase_deg=phase,
        coherence=coherence,
        valid=valid,
        method="autocorrelation",
        window="none",
        dt=float(dt),
        warnings=tuple(warnings),
    )


def estimate_transfer(
    input_values: Sequence[float],
    output_values: Sequence[float],
    dt: float,
    *,
    method: str = "fft",
    window: str = "hann",
    coherence_min: float | None = None,
    f_min: float | None = None,
    f_max: float | None = None,
    settle_time_s: float = 0.0,
) -> FrequencyApproximation:
    key = (method or "fft").lower()
    if key == "fft":
        return estimate_transfer_fft(
            input_values,
            output_values,
            dt,
            window=window,
            coherence_min=0.8 if coherence_min is None else coherence_min,
            f_min=f_min,
            f_max=f_max,
            settle_time_s=settle_time_s,
        )
    if key in ("autocorrelation", "correlation", "wiener"):
        return estimate_transfer_autocorrelation(
            input_values,
            output_values,
            dt,
            coherence_min=0.5 if coherence_min is None else coherence_min,
        )
    raise ValidationError(f"未知频响近似方法 {method!r}")


def multisine(
    frequencies_hz: Sequence[float],
    *,
    sample_rate_hz: float,
    duration_s: float,
    amplitude: float = 1.0,
    phases: Sequence[float] | None = None,
) -> dict[str, Any]:
    """构造多正弦激励，供时域仿真后做 FFT 频响近似。"""
    freqs = np.asarray(list(frequencies_hz), dtype=np.float64).reshape(-1)
    if freqs.size == 0 or np.any(freqs <= 0.0) or not np.all(np.isfinite(freqs)):
        raise ValidationError("激励频率必须为有限正数")
    if sample_rate_hz <= 0.0 or duration_s <= 0.0:
        raise ValidationError("采样率与时长必须为正")
    if np.any(freqs >= sample_rate_hz / 2.0):
        raise ValidationError("激励频率必须低于奈奎斯特频率")
    size = int(round(sample_rate_hz * duration_s))
    times = np.arange(size, dtype=np.float64) / sample_rate_hz
    phase_values = np.zeros(freqs.size) if phases is None else np.asarray(list(phases), dtype=np.float64)
    if phase_values.size != freqs.size:
        raise ValidationError("相位数量必须与频率数量一致")
    signals = np.sin(2.0 * np.pi * freqs[:, None] * times[None, :] + phase_values[:, None])
    values = amplitude * np.sum(signals, axis=0) / max(1, freqs.size)
    return {
        "times": times.tolist(),
        "values": values.tolist(),
        "dt": 1.0 / sample_rate_hz,
        "frequencies_hz": freqs.tolist(),
        "sample_rate_hz": float(sample_rate_hz),
    }


def approximation_envelope(estimate: FrequencyApproximation, *, source: str = "fft_trajectory") -> dict[str, Any]:
    """把近似结果转成与主通路一致的 Bode 信封（source 明确标注近似）。"""
    from .analysis_contract import axis, curve, envelope, fingerprint, warning

    frequencies = np.asarray(estimate.frequencies_hz, dtype=np.float64)
    magnitude = np.asarray(estimate.magnitude, dtype=np.float64)
    phase = np.asarray(estimate.phase_deg, dtype=np.float64)
    valid = np.asarray(estimate.valid, dtype=bool)
    if frequencies.size == 0:
        raise ValidationError("频响近似为空")
    magnitude_db = 20.0 * np.log10(np.maximum(magnitude, 1e-300))
    mask = valid & np.isfinite(magnitude_db) & np.isfinite(phase) & (frequencies > 0.0)
    if not np.any(mask):
        mask = np.isfinite(magnitude_db) & np.isfinite(phase) & (frequencies > 0.0)
    frequencies = frequencies[mask]
    magnitude_db = magnitude_db[mask]
    phase = phase[mask]
    axes = [
        axis("f", "频率", "Hz", frequencies, scale="log10"),
        axis("mag_db", "幅值", "dB", magnitude_db),
        axis("phase_deg", "相位", "deg", phase),
    ]
    curves = [
        curve("bode_mag", label="FFT 近似幅值", x_axis="f", y_axis="mag_db", x=frequencies, y=magnitude_db, style="solid", category="response"),
        curve("bode_phase", label="FFT 近似相位", x_axis="f", y_axis="phase_deg", x=frequencies, y=phase, style="dashed", category="response"),
    ]
    warnings = [dict(item) for item in estimate.warnings]
    warnings.append(
        warning(
            "approximation_source",
            f"频响来自 {estimate.method} 近似（窗 {estimate.window}），仅旁证，不用于稳定性判定。",
            severity="info",
        )
    )
    payload = envelope(
        kind="bode",
        source={"path": source, "method": estimate.method, "window": estimate.window, "approximate": True},
        axes=axes,
        curves=curves,
        markers=[],
        metrics={"valid_bins": int(mask.sum()), "total_bins": int(frequencies.size)},
        warnings=warnings,
        evidence={"dt": estimate.dt, "coherence_min": float(np.min(estimate.coherence)) if estimate.coherence.size else None},
    )
    payload["fingerprint"] = fingerprint(payload)
    return payload
