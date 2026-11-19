"""Nyquist 轮廓、包围数与裕度测试。"""

from __future__ import annotations

import math

import numpy as np
import pytest

from netlab.core.compute.circuit.nyquist import (
    nyquist_contour,
    nyquist_envelope,
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
