"""Nyquist 轮廓、包围计数与稳定裕度。

约定
----
* 以 s 平面右半平面为被包围区域，沿虚轴从 -j∞ 到 +j∞，再沿右半平面大圆弧
  返回，轮廓方向为顺时针。
* 由于 L(s) 在实系数电路中有共轭对称性，正频率段与负频率段互为共轭镜像。
* 签名包围数 N 以逆时针为正（与工程教材一致）；稳定判据为 Z = P - N，
  其中 P 是回路增益在右半平面的极点数，Z 是闭环右半平面极点数。
* 负反馈下相位裕度 PM = 180° + arg L(jω_c)；增益裕度 GM = -20log10|L(jω_pc)|。
"""

from __future__ import annotations

from typing import Any

import numpy as np

from ...common.limits import ValidationError
from .analysis_contract import axis, curve, envelope, marker, warning

__all__ = [
    "complex_payload",
    "frequency_array",
    "nyquist_contour",
    "nyquist_envelope",
    "stability_margins",
    "winding_number",
]

_TWO_PI = 2.0 * np.pi


def frequency_array(frequencies: Any) -> np.ndarray:
    values = np.asarray(frequencies, dtype=np.float64).reshape(-1)
    if values.size < 2:
        raise ValidationError("Nyquist 至少需要两个频率点")
    if not np.all(np.isfinite(values)) or np.any(values <= 0.0):
        raise ValidationError("频率必须为有限正数")
    return values


def complex_payload(values: Any, *, prefix: str = "") -> dict[str, list[float]]:
    array = np.asarray(values, dtype=np.complex128).reshape(-1)
    real = array.real.tolist()
    imag = array.imag.tolist()
    magnitude = np.abs(array).tolist()
    phase = np.degrees(np.angle(array)).tolist()
    key = (lambda name: f"{prefix}_{name}") if prefix else (lambda name: name)
    return {
        key("real"): real,
        key("imag"): imag,
        key("magnitude"): magnitude,
        key("phase_deg"): phase,
    }


def _crossings(x: np.ndarray, y: np.ndarray, level: float) -> list[float]:
    """求折线穿过水平 level 的 x 坐标（线性插值）。"""
    result: list[float] = []
    delta = y - float(level)
    for index in range(delta.size - 1):
        left, right = delta[index], delta[index + 1]
        if left == 0.0:
            result.append(float(x[index]))
        elif left * right < 0.0:
            fraction = left / (left - right)
            result.append(float(x[index] + fraction * (x[index + 1] - x[index])))
    if delta.size and delta[-1] == 0.0:
        result.append(float(x[-1]))
    return result


def stability_margins(
    frequencies: Any, loop_gain: Any, *, feedback_sign: float = 1.0
) -> dict[str, Any]:
    """计算全部 0 dB 与 -180° 穿越点及对应裕度。"""
    freqs = frequency_array(frequencies)
    values = np.asarray(loop_gain, dtype=np.complex128).reshape(-1)
    if values.size != freqs.size:
        raise ValidationError("频率与回路增益长度不一致")
    if not np.all(np.isfinite(values)):
        raise ValidationError("回路增益包含非有限值")

    magnitude = np.abs(values)
    with np.errstate(divide="ignore"):
        db = 20.0 * np.log10(np.maximum(magnitude, 1e-300))
    phase = np.degrees(np.unwrap(np.angle(values)))
    log_f = np.log10(freqs)

    sign = float(feedback_sign)
    critical_phase = -180.0 if sign >= 0.0 else 0.0

    def _wrap_degrees(value: float) -> float:
        return float((value + 180.0) % 360.0 - 180.0)

    gain_crossings: list[dict[str, Any]] = []
    for position in _crossings(log_f, db, 0.0):
        frequency = float(10.0**position)
        phase_at = float(np.interp(position, log_f, phase))
        gain_crossings.append(
            {
                "frequency_hz": frequency,
                "phase_deg": phase_at,
                "phase_margin_deg": _wrap_degrees((phase_at - critical_phase) * sign),
            }
        )

    phase_crossings: list[dict[str, Any]] = []
    unwrapped_min = float(np.min(phase))
    unwrapped_max = float(np.max(phase))
    start = int(np.ceil((unwrapped_min - critical_phase) / 360.0))
    stop = int(np.floor((unwrapped_max - critical_phase) / 360.0))
    for order in range(start, stop + 1):
        target = critical_phase + 360.0 * order
        for position in _crossings(log_f, phase, target):
            frequency = float(10.0**position)
            db_at = float(np.interp(position, log_f, db))
            phase_crossings.append(
                {
                    "frequency_hz": frequency,
                    "magnitude_db": db_at,
                    "gain_margin_db": float(-db_at),
                    "phase_deg": target,
                }
            )

    # 正反馈的 0° 临界相位可能只在 DC/首个采样点出现（例如 L(0)>1 的一阶系统）；
    # 若首点相位已贴近临界相位，则把端点作为相位穿越纳入，避免漏掉负增益裕度。
    endpoint_target = critical_phase
    if float(feedback_sign) < 0.0 and abs(_wrap_degrees(float(phase[0]) - endpoint_target)) <= 5.0:
        endpoint_log = float(log_f[0])
        duplicate = any(
            abs(float(np.log10(float(item["frequency_hz"]))) - endpoint_log) <= 1e-9
            for item in phase_crossings
        )
        if not duplicate:
            db_at = float(db[0])
            phase_crossings.insert(
                0,
                {
                    "frequency_hz": float(freqs[0]),
                    "magnitude_db": db_at,
                    "gain_margin_db": float(-db_at),
                    "phase_deg": float(endpoint_target),
                    "endpoint": True,
                },
            )

    phase_margin = gain_crossings[0]["phase_margin_deg"] if gain_crossings else None
    gain_margin = phase_crossings[0]["gain_margin_db"] if phase_crossings else None
    stable = None
    if phase_margin is not None:
        stable = bool(phase_margin > 0.0 and (gain_margin is None or gain_margin > 0.0))

    return {
        "gain_crossings": gain_crossings,
        "phase_crossings": phase_crossings,
        "phase_margin_deg": phase_margin,
        "gain_margin_db": gain_margin,
        "stable_from_margins": stable,
        "phase_unwrapped_deg": [float(value) for value in phase],
        "feedback_sign": sign,
        "critical_phase_deg": float(critical_phase),
        "critical_point_real": float(-sign),
    }


def nyquist_contour(frequencies: Any, loop_gain: Any) -> tuple[np.ndarray, np.ndarray]:
    """返回按 Nyquist 轮廓顺序排列的频率与复数值。

    正频率按升序给出；负频率段取其共轭并按降序排列，从而形成
    -j∞ → 0 → +j∞ 的连续轮廓。
    """
    freqs = frequency_array(frequencies)
    values = np.asarray(loop_gain, dtype=np.complex128).reshape(-1)
    if values.size != freqs.size:
        raise ValidationError("频率与回路增益长度不一致")
    negative_freqs = -freqs[::-1]
    contour = np.concatenate([np.conjugate(values[::-1]), values])
    return np.concatenate([negative_freqs, freqs]), contour


def winding_number(values: Any, point: complex = -1.0 + 0.0j) -> int:
    """计算闭合折线围绕 point 的逆时针包围次数。"""
    array = np.asarray(values, dtype=np.complex128).reshape(-1)
    if array.size < 3:
        return 0
    relative = array - complex(point)
    if np.any(np.abs(relative) < 1e-15):
        raise ValidationError("轮廓穿过临界点，包围数无定义")
    extended = np.concatenate([relative, relative[:1]])
    total = 0.0
    for left, right in zip(extended[:-1], extended[1:]):
        total += float(np.angle(right / left))
    return int(round(total / _TWO_PI))


def nyquist_metrics(
    frequencies: Any,
    loop_gain: Any,
    *,
    feedback_sign: float = 1.0,
    poles: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """组合包围计数、稳定判据与裕度。"""
    freqs = frequency_array(frequencies)
    values = np.asarray(loop_gain, dtype=np.complex128).reshape(-1)
    margins = stability_margins(freqs, values, feedback_sign=feedback_sign)
    contour_freqs, contour = nyquist_contour(freqs, values)
    encirclements = winding_number(
        contour, point=complex(-float(feedback_sign), 0.0)
    )

    pole_info = dict(poles or {})
    right_half_plane = pole_info.get("right_half_plane")
    imaginary_axis = bool(pole_info.get("on_imaginary_axis", False))
    if right_half_plane is None:
        z_value = None
        determinate = False
    elif imaginary_axis:
        z_value = None
        determinate = False
    else:
        z_value = int(right_half_plane) - int(encirclements)
        determinate = True

    stable = None
    if determinate:
        stable = bool(z_value == 0)
    if margins["stable_from_margins"] is not None and stable is not None:
        stable = bool(stable and margins["stable_from_margins"])

    warnings: list[dict[str, Any]] = []
    if imaginary_axis:
        warnings.append(
            warning(
                "nyquist_imaginary_axis_pole",
                "回路增益在虚轴上有极点，Nyquist 判据不能给出稳定性结论",
                severity="error",
            )
        )
    if stable is False:
        warnings.append(
            warning("nyquist_unstable", "闭环系统存在右半平面极点或裕度为负", severity="warning")
        )
    if float(feedback_sign) < 0.0 and margins["phase_margin_deg"] is None:
        warnings.append(
            warning(
                "nyquist_positive_feedback_margin_undefined",
                "正反馈未找到 0° 相位穿越或 DC 端点，相位裕度不可判定，以 Nyquist 包围数为最终判据",
                severity="warning",
            )
        )
    if margins["phase_margin_deg"] is not None and margins["phase_margin_deg"] < 0.0:
        warnings.append(
            warning(
                "nyquist_negative_phase_margin",
                "相位裕度为负，闭环可能不稳定",
                severity="warning",
            )
        )

    return {
        "poles_right_half_plane": right_half_plane,
        "encirclements_ccw": encirclements,
        "encirclements_clockwise": -encirclements,
        "closed_loop_right_half_plane": z_value,
        "determinate": determinate,
        "stable": stable,
        "feedback_sign": float(feedback_sign),
        "critical_phase_deg": margins["critical_phase_deg"],
        "critical_point_real": margins["critical_point_real"],
        "phase_margin_deg": margins["phase_margin_deg"],
        "gain_margin_db": margins["gain_margin_db"],
        "gain_crossings": margins["gain_crossings"],
        "phase_crossings": margins["phase_crossings"],
        "contour_points": int(contour.size),
        "contour_frequencies_hz": contour_freqs.tolist(),
        "warnings": warnings,
    }


def nyquist_envelope(
    frequencies: Any,
    loop_gain: Any,
    *,
    source: dict[str, Any],
    poles: dict[str, Any] | None = None,
    feedback_sign: float = 1.0,
    element: str = "",
    output: str = "",
    fingerprint_value: str | None = None,
    evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """构造 PlotKit 可消费的 Nyquist 结果信封。"""
    freqs = frequency_array(frequencies)
    values = np.asarray(loop_gain, dtype=np.complex128).reshape(-1)
    if values.size != freqs.size:
        raise ValidationError("频率与回路增益长度不一致")
    metrics = nyquist_metrics(
        freqs, values, feedback_sign=feedback_sign, poles=poles
    )
    contour_freqs, contour = nyquist_contour(freqs, values)

    curve_positive = curve(
        "nyquist_pos",
        label="正频率分支",
        x_axis="re",
        y_axis="im",
        x=[float(value.real) for value in values],
        y=[float(value.imag) for value in values],
        style="solid",
        category="response",
        detail={
            "branch": "positive",
            "frequency_hz": freqs.tolist(),
            "arrow": "increasing_frequency",
        },
    )
    mirror = np.conjugate(values)
    curve_negative = curve(
        "nyquist_neg",
        label="负频率分支",
        x_axis="re",
        y_axis="im",
        x=[float(value.real) for value in mirror],
        y=[float(value.imag) for value in mirror],
        style="dashed",
        category="response",
        detail={
            "branch": "negative",
            "frequency_hz": freqs.tolist(),
            "arrow": "increasing_frequency",
        },
    )

    markers: list[dict[str, Any]] = [
        marker(
            "nyquist-crit",
            shape="nyquist_crit",
            x=-float(feedback_sign),
            y=0.0,
            label="临界点 -1" if float(feedback_sign) >= 0.0 else "临界点 +1",
            category="stability",
            axis_x="re",
            axis_y="im",
            detail={
                "description": "Nyquist 稳定判据的临界点",
                "feedback_sign": float(feedback_sign),
                "critical_point_real": -float(feedback_sign),
            },
        )
    ]

    log_f = np.log10(freqs)
    for index, crossing in enumerate(metrics["gain_crossings"], start=1):
        position = float(np.interp(np.log10(crossing["frequency_hz"]), log_f, np.arange(freqs.size)))
        nearest = int(min(max(round(position), 0), values.size - 1))
        point = complex(values[nearest])
        markers.append(
            marker(
                f"nyquist-gain-cross-{index}",
                shape="cross_gain",
                x=float(point.real),
                y=float(point.imag),
                label=f"0 dB 穿越 {crossing['frequency_hz']:.6g} Hz",
                category="margin",
                axis_x="re",
                axis_y="im",
                detail={
                    "frequency_hz": crossing["frequency_hz"],
                    "phase_margin_deg": crossing["phase_margin_deg"],
                },
            )
        )
    for index, crossing in enumerate(metrics["phase_crossings"], start=1):
        position = float(np.interp(np.log10(crossing["frequency_hz"]), log_f, np.arange(freqs.size)))
        nearest = int(min(max(round(position), 0), values.size - 1))
        point = complex(values[nearest])
        markers.append(
            marker(
                f"nyquist-phase-cross-{index}",
                shape="cross_phase",
                x=float(point.real),
                y=float(point.imag),
                label=(
                    f"{metrics['critical_phase_deg']:.0f}° 穿越 "
                    f"{crossing['frequency_hz']:.6g} Hz"
                ),
                category="margin",
                axis_x="re",
                axis_y="im",
                detail={
                    "frequency_hz": crossing["frequency_hz"],
                    "gain_margin_db": crossing["gain_margin_db"],
                },
            )
        )

    detail_source = dict(source)
    detail_source.update(
        {
            "break_element": element,
            "output": output,
            "feedback_sign": float(feedback_sign),
            "poles": dict(poles or {}),
        }
    )
    return envelope(
        "nyquist",
        source=detail_source,
        axes=[
            axis("re", "实部", "", [float(value.real) for value in values], scale="linear"),
            axis("im", "虚部", "", [float(value.imag) for value in values], scale="linear"),
        ],
        curves=[curve_positive, curve_negative],
        markers=markers,
        metrics={
            "feedback_sign": metrics["feedback_sign"],
            "critical_phase_deg": metrics["critical_phase_deg"],
            "critical_point_real": metrics["critical_point_real"],
            "phase_margin_deg": metrics["phase_margin_deg"],
            "gain_margin_db": metrics["gain_margin_db"],
            "poles_right_half_plane": metrics["poles_right_half_plane"],
            "encirclements_ccw": metrics["encirclements_ccw"],
            "encirclements_clockwise": metrics["encirclements_clockwise"],
            "closed_loop_right_half_plane": metrics["closed_loop_right_half_plane"],
            "stable": metrics["stable"],
            "determinate": metrics["determinate"],
            "gain_crossings": metrics["gain_crossings"],
            "phase_crossings": metrics["phase_crossings"],
        },
        warnings=list(metrics["warnings"]),
        evidence=dict(evidence or {}),
        fingerprint=fingerprint_value,
    )
