"""Nyquist 轮廓、包围数与裕度测试。"""

from __future__ import annotations

import math

import numpy as np
import pytest

from netlab.core.compute.circuit.nyquist import (
    nyquist_contour,
    nyquist_envelope,
    nyquist_metrics,
    stability_margins,
    winding_number,
)
from netlab.core.compute.circuit.analysis_contract import validate_envelope


def _frequencies(start=1e-2, stop=1e4, points=600):
    return np.logspace(math.log10(start), math.log10(stop), points)


def _first_order(gain: float, pole: float):
    frequencies = _frequencies()
    return frequencies, gain / (1j * frequencies - pole)


def test_winding_number_counts_ccw_circle():
    angles = np.linspace(0.0, 2.0 * math.pi, 400)
    contour = -1.0 + 0.5 * np.exp(1j * angles)
    assert winding_number(contour) == 1


def test_contour_order_is_negative_to_positive():
    frequencies = np.array([1.0, 10.0, 100.0])
    values = np.array([1.0, 2.0, 3.0], dtype=complex)
    contour_freqs, contour = nyquist_contour(frequencies, values)
    assert contour_freqs.tolist() == [-100.0, -10.0, -1.0, 1.0, 10.0, 100.0]
    assert contour[0] == np.conjugate(values[-1])


def test_stable_first_order_has_zero_encirclement():
    frequencies, loop = _first_order(10.0, -1.0)
    metrics = stability_margins(frequencies, loop)
    assert metrics["phase_margin_deg"] is not None
    assert metrics["phase_margin_deg"] > 0.0


def test_unstable_closed_loop_with_right_half_plane_pole():
    frequencies, loop = _first_order(0.5, 1.0)
    payload = nyquist_envelope(
        frequencies,
        loop,
        source={"kind": "test"},
        poles={"right_half_plane": 1, "on_imaginary_axis": False},
    )
    assert payload["metrics"]["poles_right_half_plane"] == 1
    assert payload["metrics"]["encirclements_ccw"] == 0
    assert payload["metrics"]["closed_loop_right_half_plane"] == 1
    assert payload["metrics"]["stable"] is False
    assert any(item["code"] == "nyquist_unstable" for item in payload["warnings"])


def test_winding_number_counts_around_plus_one():
    angles = np.linspace(0.0, 2.0 * math.pi, 400)
    contour = 1.0 + 0.5 * np.exp(1j * angles)
    assert winding_number(contour, point=1.0 + 0.0j) == 1


def test_positive_feedback_uses_minus_one_critical_point():
    # 物理带符号约定：正反馈返回比 L=-Aβ 为负实部，临界点仍是 -1（相角 180°）。
    frequencies, loop = _first_order(-2.0, -1.0)
    payload = nyquist_envelope(
        frequencies,
        loop,
        source={"kind": "test"},
        feedback_sign=-1.0,
        poles={"right_half_plane": 0, "on_imaginary_axis": False},
    )
    metrics = payload["metrics"]
    assert metrics["critical_point_real"] == -1.0
    assert metrics["critical_phase_deg"] == 180.0
    assert metrics["phase_margin_deg"] is not None
    assert abs(metrics["phase_margin_deg"] - 60.0) < 0.1
    assert metrics["gain_margin_db"] is not None
    assert metrics["gain_margin_db"] < 0.0
    assert metrics["stable"] is False
    critical = next(item for item in payload["markers"] if item["id"] == "nyquist-crit")
    assert critical["x"] == -1.0
    assert critical["label"] == "临界点 -1"


def test_positive_feedback_stable_marks_undefined_phase_margin():
    # 正反馈 L=-0.5/(1+jw)，|L|<1 且仅 DC 端点触及 180°，GM>0、PM 不可判定。
    frequencies, loop = _first_order(-0.5, -1.0)
    margins = stability_margins(frequencies, loop, feedback_sign=-1.0)
    assert margins["phase_margin_deg"] is None
    assert margins["gain_margin_db"] is not None
    assert margins["gain_margin_db"] > 0.0
    metrics = nyquist_metrics(
        frequencies,
        loop,
        feedback_sign=-1.0,
        poles={"right_half_plane": 0, "on_imaginary_axis": False},
    )
    assert metrics["stable"] is True
    assert any(
        item["code"] == "nyquist_positive_feedback_margin_undefined"
        for item in metrics["warnings"]
    )


def test_right_half_plane_pole_encircles_critical_point():
    frequencies, loop = _first_order(2.0, 1.0)
    payload = nyquist_envelope(
        frequencies,
        loop,
        source={"kind": "test"},
        poles={"right_half_plane": 1, "on_imaginary_axis": False},
    )
    assert payload["metrics"]["encirclements_ccw"] == 1
    assert payload["metrics"]["closed_loop_right_half_plane"] == 0
    assert payload["metrics"]["stable"] is True


def test_imaginary_axis_pole_is_indeterminate():
    frequencies, loop = _first_order(1.0, 0.0)
    payload = nyquist_envelope(
        frequencies,
        loop,
        source={"kind": "test"},
        poles={"right_half_plane": 0, "on_imaginary_axis": True},
    )
    assert payload["metrics"]["determinate"] is False
    assert payload["metrics"]["stable"] is None
    assert any(item["code"] == "nyquist_imaginary_axis_pole" for item in payload["warnings"])


def test_envelope_validates():
    frequencies, loop = _first_order(10.0, -1.0)
    payload = nyquist_envelope(
        frequencies,
        loop,
        source={"kind": "test"},
        poles={"right_half_plane": 0, "on_imaginary_axis": False},
    )
    validate_envelope(payload)
    assert payload["kind"] == "nyquist"
    assert payload["markers"][0]["shape"] == "nyquist_crit"
    assert len(payload["curves"]) == 2
    assert len(payload["axes"]) == 2


def test_multiple_phase_crossings_are_sorted_and_worst_gain_margin_used():
    frequencies = np.logspace(-2.0, 4.0, 2401)
    u = (np.log10(frequencies) - np.log10(frequencies[0])) / (
        np.log10(frequencies[-1]) - np.log10(frequencies[0])
    )
    # 相位从 0° 单调降到 -720°，在 -180° 和 -540° 两处穿越临界相位。
    phase_deg = -720.0 * u
    # 幅值随频率单调下降，使两个穿越点的增益裕度不同。
    magnitude = 10.0 ** ((10.0 - 30.0 * u) / 20.0)
    loop = magnitude * np.exp(1j * np.deg2rad(phase_deg))

    margins = stability_margins(frequencies, loop)
    crossing_freqs = [float(item["frequency_hz"]) for item in margins["phase_crossings"]]
    gain_margins = [float(item["gain_margin_db"]) for item in margins["phase_crossings"]]
    assert len(crossing_freqs) == 2
    assert crossing_freqs == sorted(crossing_freqs)
    assert min(gain_margins) < max(gain_margins)
    assert margins["gain_margin_db"] == pytest.approx(min(gain_margins))


def test_multiple_gain_crossings_use_worst_phase_margin():
    frequencies = np.logspace(-2.0, 4.0, 2401)
    u = (np.log10(frequencies) - np.log10(frequencies[0])) / (
        np.log10(frequencies[-1]) - np.log10(frequencies[0])
    )
    # 0 dB 多次穿越，同时相位单调下降，使各次穿越的相位裕度不同。
    db = 10.0 * np.cos(4.0 * np.pi * u)
    phase_deg = -60.0 - 240.0 * u
    loop = 10.0 ** (db / 20.0) * np.exp(1j * np.deg2rad(phase_deg))

    margins = stability_margins(frequencies, loop)
    crossing_freqs = [float(item["frequency_hz"]) for item in margins["gain_crossings"]]
    phase_margins = [float(item["phase_margin_deg"]) for item in margins["gain_crossings"]]
    assert len(crossing_freqs) >= 4
    assert crossing_freqs == sorted(crossing_freqs)
    assert min(phase_margins) < max(phase_margins)
    assert margins["phase_margin_deg"] == pytest.approx(min(phase_margins))
    assert margins["phase_margin_deg"] < phase_margins[0]
