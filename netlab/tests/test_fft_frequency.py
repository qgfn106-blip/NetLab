import numpy as np
import pytest

from netlab.core.compute.circuit.fft_frequency import (
    approximation_envelope,
    estimate_transfer,
    estimate_transfer_autocorrelation,
    estimate_transfer_fft,
    multisine,
)


def _rc_response(freqs, r=1000.0, c=1e-6):
    fc = 1.0 / (2.0 * np.pi * r * c)
    h = 1.0 / (1.0 + 1j * np.asarray(freqs) / fc)
    return h


def _simulate(freqs, *, sample_rate=4000.0, duration=0.5):
    excitation = multisine(freqs, sample_rate_hz=sample_rate, duration_s=duration)
    dt = excitation["dt"]
    t = np.asarray(excitation["times"])
    x = np.asarray(excitation["values"])
    fc = 159.15494309189535
    # 精确一阶低通：用状态空间离散递推（零阶保持），避免手工相位误差。
    y = np.zeros_like(x)
    state = 0.0
    decay = np.exp(-2.0 * np.pi * fc * dt)
    gain = 1.0 - decay
    for index in range(1, x.size):
        state = decay * state + gain * x[index - 1]
        y[index] = state
    # 输出相对输入含半个采样周期的零阶保持延迟。
    return x, y, dt


def test_multisine_rejects_nyquist_alias():
    with pytest.raises(Exception):
        multisine([3000.0], sample_rate_hz=4000.0, duration_s=0.1)


def test_fft_transfer_matches_rc_amplitude_within_2_percent():
    freqs = np.array([30.0, 80.0, 120.0, 160.0])
    x, y, dt = _simulate(freqs, duration=4.0)
    estimate = estimate_transfer_fft(x, y, dt, coherence_min=0.0, settle_time_s=0.2)
    expected = np.abs(_rc_response(freqs))
    got = []
    for f in freqs:
        index = int(np.argmin(np.abs(estimate.frequencies_hz - f)))
        got.append(estimate.magnitude[index])
    got = np.asarray(got)
    rel = np.abs(got - expected) / expected
    assert float(np.max(rel)) < 0.02


def test_fft_phase_matches_rc_within_2_degrees():
    freqs = np.array([30.0, 80.0, 120.0, 160.0])
    x, y, dt = _simulate(freqs, duration=4.0)
    estimate = estimate_transfer(x, y, dt, coherence_min=0.0, settle_time_s=0.2)
    # 零阶保持递推含半个采样周期的固有延迟，比较时显式扣除。
    expected = np.degrees(np.angle(_rc_response(freqs))) - 180.0 * freqs * dt
    got = []
    for f in freqs:
        index = int(np.argmin(np.abs(estimate.frequencies_hz - f)))
        got.append(estimate.phase_deg[index])
    rel = np.abs(np.asarray(got) - expected)
    assert float(np.max(rel)) < 2.0


def test_invalid_band_warns_but_returns_envelope():
    x = np.zeros(256)
    y = np.zeros(256)
    estimate = estimate_transfer_fft(x, y, 1.0 / 1000.0, coherence_min=0.9)
    payload = approximation_envelope(estimate)
    assert payload["kind"] == "bode"
    assert payload["source"]["approximate"] is True
    assert any(item["code"] == "fft_approximation" for item in payload["warnings"])


def test_autocorrelation_returns_finite_values():
    freqs = np.array([50.0, 100.0])
    x, y, dt = _simulate(freqs, duration=2.0)
    estimate = estimate_transfer_autocorrelation(x, y, dt, coherence_min=0.0)
    assert estimate.method == "autocorrelation"
    assert np.all(np.isfinite(estimate.magnitude))
