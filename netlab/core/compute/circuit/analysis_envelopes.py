"""把电路的 Bode / 时域结果整理成 netlab-analysis-result/1 信封。

本模块只做数据整形：不重新求解、不改模型，负责：

* 统一的 log 频率轴与线性时域轴；
* 幅频/相频曲线，并在曲线 detail 中附带每点局部斜率（dB/dec、deg/dec）；
* 关键点标记（极点、零点、0 dB 穿越、-180° 穿越、峰值、带宽、阶跃峰值/稳定点）；
* 输出指纹（电路快照 + 分析参数），供缓存与过期判断。

调用方（analysis.py）仍保留原有的数值结果不变，只是额外挂上 envelope 字段；
前端拿到信封后不再自己推导坐标与关键点。
"""

from __future__ import annotations

import math
from typing import Any, Mapping, Sequence

import numpy as np

from .analysis_contract import (
    axis,
    curve,
    envelope,
    fingerprint as payload_fingerprint,
    local_slope,
    marker,
    warning,
)

__all__ = [
    "bode_envelope",
    "step_envelope",
    "scene_fingerprint",
]

_TWO_PI = 2.0 * math.pi


def _array(values: Sequence[float]) -> np.ndarray:
    return np.asarray([float(item) for item in values], dtype=float).reshape(-1)


def _finite_mask(*arrays: np.ndarray) -> np.ndarray:
    mask = np.ones(arrays[0].size, dtype=bool)
    for array in arrays:
        mask &= np.isfinite(array)
    return mask


def _slopes(x: np.ndarray, y: np.ndarray, *, log_x: bool = True) -> list[float | None]:
    count = min(x.size, y.size)
    out: list[float | None] = []
    for index in range(count):
        value = local_slope(x[:count], y[:count], index, log_x=log_x)
        out.append(None if value is None else round(float(value), 9))
    return out


def _nearest_index(values: np.ndarray, target: float, *, log_x: bool) -> int:
    if values.size == 0:
        return 0
    if log_x:
        safe = np.where(values > 0.0, np.log10(np.maximum(values, 1e-300)), 0.0)
        goal = math.log10(max(target, 1e-300))
        return int(np.argmin(np.abs(safe - goal)))
    return int(np.argmin(np.abs(values - target)))


def scene_fingerprint(scene: Any, params: Mapping[str, Any] | None = None) -> str:
    """电路场景 + 分析参数的稳定指纹。"""
    nodes = sorted(
        (
            {
                "name": getattr(node, "name", ""),
                "kind": getattr(node, "kind", ""),
                "params": getattr(node, "params", {}) or {},
                "enabled": getattr(node, "enabled", True),
            }
            for node in (getattr(scene, "nodes", {}) or {}).values()
        ),
        key=lambda item: str(item["name"]),
    )
    node_names = {
        getattr(node, "id", ""): getattr(node, "name", "")
        for node in (getattr(scene, "nodes", {}) or {}).values()
    }
    edges = sorted(
        (
            {
                "name": getattr(edge, "name", ""),
                "source": node_names.get(getattr(edge, "source", ""), getattr(edge, "source", "")),
                "target": node_names.get(getattr(edge, "target", ""), getattr(edge, "target", "")),
                "kind": getattr(edge, "kind", ""),
                "params": getattr(edge, "params", {}) or {},
                "enabled": getattr(edge, "enabled", True),
            }
            for edge in (getattr(scene, "edges", {}) or {}).values()
        ),
        key=lambda item: str(item["name"]),
    )
    return payload_fingerprint(
        {
            "mode": getattr(scene, "mode", ""),
            "nodes": nodes,
            "edges": edges,
            "params": dict(params or {}),
        }
    )


def _detail_point(
    *,
    frequency: float,
    magnitude_db: float,
    phase_deg: float,
    slope_db: float | None,
    slope_deg: float | None,
) -> dict[str, Any]:
    return {
        "frequency_hz": float(frequency),
        "magnitude_db": float(magnitude_db),
        "phase_deg": float(phase_deg),
        "slope_db_per_dec": slope_db,
        "slope_deg_per_dec": slope_deg,
    }


def _stability_markers(
    *,
    values: Sequence[Sequence[float]],
    shape: str,
    prefix: str,
    frequencies: np.ndarray,
    magnitude_db: np.ndarray,
    phase_deg: np.ndarray,
    slopes_db: list[float | None],
    slopes_deg: list[float | None],
) -> list[dict[str, Any]]:
    """极点/零点标记：只取上半个复平面（成对极点去重），并过滤显示范围。"""
    if frequencies.size == 0:
        return []
    low = float(frequencies[0]) * 0.5
    high = float(frequencies[-1]) * 2.0
    seen: set[float] = set()
    out: list[dict[str, Any]] = []
    for row in values or ():
        try:
            real, imag = float(row[0]), float(row[1])
        except (TypeError, ValueError, IndexError):
            continue
        if imag < 0.0:
            continue
        frequency = math.hypot(real, imag) / _TWO_PI
        if not math.isfinite(frequency) or frequency <= 0.0:
            continue
        if frequency < low or frequency > high:
            continue
        key = round(frequency, 9)
        if key in seen:
            continue
        seen.add(key)
        index = _nearest_index(frequencies, frequency, log_x=True)
        magnitude = float(magnitude_db[index]) if magnitude_db.size else 0.0
        phase = float(phase_deg[index]) if phase_deg.size else 0.0
        marker_id = f"{prefix}-{len(out) + 1}"
        out.append(
            marker(
                marker_id,
                shape=shape,
                x=frequency,
                y=magnitude,
                label=f"{prefix}{len(out) + 1}",
                category="stability",
                detail={
                    **_detail_point(
                        frequency=frequency,
                        magnitude_db=magnitude,
                        phase_deg=phase,
                        slope_db=slopes_db[index] if index < len(slopes_db) else None,
                        slope_deg=slopes_deg[index] if index < len(slopes_deg) else None,
                    ),
                    "real": real,
                    "imag": imag,
                },
            )
        )
    return out


def _crossing_marker(
    *,
    marker_id: str,
    shape: str,
    label: str,
    frequencies: np.ndarray,
    values: np.ndarray,
    level: float,
    axis_y: str,
    phase_deg: np.ndarray,
    slopes_db: list[float | None],
    slopes_deg: list[float | None],
) -> dict[str, Any] | None:
    """找 y=level 的第一次穿越（log 频率插值）。"""
    count = min(frequencies.size, values.size)
    if count < 2:
        return None
    diff = values[:count] - level
    for index in range(count - 1):
        left, right = float(diff[index]), float(diff[index + 1])
        if left == 0.0:
            frequency = float(frequencies[index])
            break
        if left * right < 0.0:
            fraction = abs(left) / (abs(left) + abs(right))
            log_left = math.log10(max(float(frequencies[index]), 1e-300))
            log_right = math.log10(max(float(frequencies[index + 1]), 1e-300))
            frequency = 10.0 ** (log_left + fraction * (log_right - log_left))
            break
    else:
        return None
    index = _nearest_index(frequencies, frequency, log_x=True)
    phase = float(phase_deg[index]) if phase_deg.size else 0.0
    return marker(
        marker_id,
        shape=shape,
        x=frequency,
        y=level,
        label=label,
        category="response",
        axis_y=axis_y,
        detail=_detail_point(
            frequency=frequency,
            magnitude_db=level if axis_y == "mag_db" else float(values[index]),
            phase_deg=phase,
            slope_db=slopes_db[index] if index < len(slopes_db) else None,
            slope_deg=slopes_deg[index] if index < len(slopes_deg) else None,
        ),
    )


def bode_envelope(
    *,
    frequencies: Sequence[float],
    magnitude_db: Sequence[float],
    phase_deg: Sequence[float],
    source: Mapping[str, Any],
    output: str = "",
    poles: Sequence[Sequence[float]] = (),
    zeros: Sequence[Sequence[float]] = (),
    metrics: Mapping[str, Any] | None = None,
    warnings: Sequence[Mapping[str, Any]] = (),
    evidence: Mapping[str, Any] | None = None,
    fingerprint_value: str | None = None,
    bandwidth_hz: float | None = None,
    resonant_peak_db: float | None = None,
    resonant_frequency_hz: float | None = None,
) -> dict[str, Any]:
    """Bode 信封：幅频 + 相频 + 关键点 + 局部斜率。"""
    freqs = _array(frequencies)
    mag = _array(magnitude_db)
    phase = _array(phase_deg)
    count = min(freqs.size, mag.size, phase.size)
    freqs, mag, phase = freqs[:count], mag[:count], phase[:count]
    mask = _finite_mask(freqs, mag, phase) & (freqs > 0.0)
    freqs, mag, phase = freqs[mask], mag[mask], phase[mask]
    if freqs.size == 0:
        return envelope(
            "bode",
            source=source,
            axes=[axis("f", "频率", "Hz", [1.0], scale="log10")],
            curves=[],
            markers=[],
            metrics=dict(metrics or {}),
            warnings=[
                *warnings,
                warning("bode_empty", "频响没有任何有效频点，无法绘制 Bode 图。", severity="error"),
            ],
            evidence=dict(evidence or {}),
            fingerprint=fingerprint_value,
        )

    # 相位展开后再显示，避免 ±180° 跳变把斜率算坏。
    phase_unwrapped = np.degrees(np.unwrap(np.radians(phase)))
    slopes_db = _slopes(freqs, mag)
    slopes_deg = _slopes(freqs, phase_unwrapped)

    axes = [
        axis("f", "频率", "Hz", freqs.tolist(), scale="log10"),
        axis("mag_db", "幅值", "dB", mag.tolist()),
        axis("phase_deg", "相位", "°", phase_unwrapped.tolist()),
    ]
    curves = [
        curve(
            "bode_mag",
            label="幅频响应",
            x_axis="f",
            y_axis="mag_db",
            x=freqs.tolist(),
            y=mag.tolist(),
            style="solid",
            category="response",
            detail={"slope_db_per_dec": slopes_db, "output": output},
        ),
        curve(
            "bode_phase",
            label="相频响应",
            x_axis="f",
            y_axis="phase_deg",
            x=freqs.tolist(),
            y=phase_unwrapped.tolist(),
            style="dashed",
            category="response",
            detail={"slope_deg_per_dec": slopes_deg, "output": output},
        ),
    ]

    markers: list[dict[str, Any]] = []
    markers.extend(
        _stability_markers(
            values=poles,
            shape="pole",
            prefix="p",
            frequencies=freqs,
            magnitude_db=mag,
            phase_deg=phase_unwrapped,
            slopes_db=slopes_db,
            slopes_deg=slopes_deg,
        )
    )
    markers.extend(
        _stability_markers(
            values=zeros,
            shape="zero",
            prefix="z",
            frequencies=freqs,
            magnitude_db=mag,
            phase_deg=phase_unwrapped,
            slopes_db=slopes_db,
            slopes_deg=slopes_deg,
        )
    )

    crossing_gain = _crossing_marker(
        marker_id="cross-0db",
        shape="cross_gain",
        label="0 dB 穿越",
        frequencies=freqs,
        values=mag,
        level=0.0,
        axis_y="mag_db",
        phase_deg=phase_unwrapped,
        slopes_db=slopes_db,
        slopes_deg=slopes_deg,
    )
    if crossing_gain is not None:
        markers.append(crossing_gain)

    crossing_phase = _crossing_marker(
        marker_id="cross-phase-180",
        shape="cross_phase",
        label="-180° 穿越",
        frequencies=freqs,
        values=phase_unwrapped,
        level=-180.0,
        axis_y="phase_deg",
        phase_deg=phase_unwrapped,
        slopes_db=slopes_db,
        slopes_deg=slopes_deg,
    )
    if crossing_phase is not None:
        markers.append(crossing_phase)

    peak_index = int(np.argmax(mag))
    markers.append(
        marker(
            "peak",
            shape="peak",
            x=float(freqs[peak_index]),
            y=float(mag[peak_index]),
            label="幅值峰值",
            category="response",
            axis_y="mag_db",
            detail=_detail_point(
                frequency=float(freqs[peak_index]),
                magnitude_db=float(mag[peak_index]),
                phase_deg=float(phase_unwrapped[peak_index]),
                slope_db=slopes_db[peak_index] if peak_index < len(slopes_db) else None,
                slope_deg=slopes_deg[peak_index] if peak_index < len(slopes_deg) else None,
            ),
        )
    )

    if bandwidth_hz is not None and math.isfinite(float(bandwidth_hz)) and bandwidth_hz > 0.0:
        index = _nearest_index(freqs, float(bandwidth_hz), log_x=True)
        markers.append(
            marker(
                "cutoff",
                shape="cutoff",
                x=float(bandwidth_hz),
                y=float(mag[index]),
                label="带宽 (-3 dB)",
                category="response",
                axis_y="mag_db",
                detail=_detail_point(
                    frequency=float(bandwidth_hz),
                    magnitude_db=float(mag[index]),
                    phase_deg=float(phase_unwrapped[index]),
                    slope_db=slopes_db[index] if index < len(slopes_db) else None,
                    slope_deg=slopes_deg[index] if index < len(slopes_deg) else None,
                ),
            )
        )

    computed_metrics: dict[str, Any] = {
        "bandwidth_hz": bandwidth_hz,
        "resonant_peak_db": resonant_peak_db,
        "resonant_frequency_hz": resonant_frequency_hz,
    }
    merged_metrics = {key: value for key, value in computed_metrics.items() if value is not None}
    merged_metrics.update(dict(metrics or {}))

    merged_evidence: dict[str, Any] = {
        "model": "descriptor_linearized",
        "input_source": source.get("input_source"),
        "output": output,
        "points": int(freqs.size),
        "poles": len(list(poles or ())),
        "zeros": len(list(zeros or ())),
    }
    merged_evidence.update(dict(evidence or {}))

    return envelope(
        "bode",
        source=source,
        axes=axes,
        curves=curves,
        markers=markers,
        metrics=merged_metrics,
        warnings=warnings,
        evidence=merged_evidence,
        fingerprint=fingerprint_value,
    )


def step_envelope(
    *,
    times: Sequence[float],
    values: Sequence[float],
    source: Mapping[str, Any],
    output: str = "",
    input_amplitude: float | None = None,
    metrics: Mapping[str, Any] | None = None,
    warnings: Sequence[Mapping[str, Any]] = (),
    evidence: Mapping[str, Any] | None = None,
    fingerprint_value: str | None = None,
) -> dict[str, Any]:
    """阶跃响应信封：时域曲线 + 峰值/稳定点标记。"""
    t = _array(times)
    y = _array(values)
    count = min(t.size, y.size)
    t, y = t[:count], y[:count]
    mask = _finite_mask(t, y)
    t, y = t[mask], y[mask]
    if t.size == 0:
        return envelope(
            "time",
            source=source,
            axes=[axis("t", "时间", "s", [0.0])],
            curves=[],
            markers=[],
            metrics=dict(metrics or {}),
            warnings=[
                *warnings,
                warning("time_empty", "时域响应没有任何有效采样点，无法绘制波形。", severity="error"),
            ],
            evidence=dict(evidence or {}),
            fingerprint=fingerprint_value,
        )

    axes = [
        axis("t", "时间", "s", t.tolist()),
        axis("value", "输出", "V", y.tolist()),
    ]
    curves = [
        curve(
            "step",
            label="阶跃响应",
            x_axis="t",
            y_axis="value",
            x=t.tolist(),
            y=y.tolist(),
            style="solid",
            category="response",
            detail={"output": output, "input_amplitude": input_amplitude},
        )
    ]

    payload_metrics = dict(metrics or {})
    markers: list[dict[str, Any]] = []
    peak_time = payload_metrics.get("peak_time")
    peak_value = payload_metrics.get("peak_value")
    if isinstance(peak_time, (int, float)) and isinstance(peak_value, (int, float)):
        markers.append(
            marker(
                "peak",
                shape="peak",
                x=float(peak_time),
                y=float(peak_value),
                label="峰值",
                category="response",
                axis_x="t",
                axis_y="value",
                detail={"time_s": float(peak_time), "value": float(peak_value)},
            )
        )
    settling_time = payload_metrics.get("settling_time")
    if isinstance(settling_time, (int, float)) and math.isfinite(float(settling_time)):
        index = int(np.argmin(np.abs(t - float(settling_time))))
        markers.append(
            marker(
                "settling",
                shape="cutoff",
                x=float(settling_time),
                y=float(y[index]),
                label="稳定时间",
                category="response",
                axis_x="t",
                axis_y="value",
                detail={"time_s": float(settling_time), "value": float(y[index])},
            )
        )
    rise_time = payload_metrics.get("rise_time")
    if isinstance(rise_time, (int, float)) and math.isfinite(float(rise_time)):
        index = int(np.argmin(np.abs(t - float(rise_time))))
        markers.append(
            marker(
                "rise",
                shape="cross_gain",
                x=float(rise_time),
                y=float(y[index]),
                label="上升时间",
                category="response",
                axis_x="t",
                axis_y="value",
                detail={"time_s": float(rise_time), "value": float(y[index])},
            )
        )

    merged_evidence: dict[str, Any] = {
        "model": "descriptor_linearized",
        "input_source": source.get("input_source"),
        "output": output,
        "points": int(t.size),
        "step_dt": float(t[1] - t[0]) if t.size > 1 else None,
    }
    merged_evidence.update(dict(evidence or {}))

    return envelope(
        "time",
        source=source,
        axes=axes,
        curves=curves,
        markers=markers,
        metrics=payload_metrics,
        warnings=warnings,
        evidence=merged_evidence,
        fingerprint=fingerprint_value,
    )
