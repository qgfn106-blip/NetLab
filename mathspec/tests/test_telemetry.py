"""§16/§33 综合遥测管线验收。"""
from __future__ import annotations

import numpy as np
import pytest

from mathspec.experiments.dataflow import UniformQuantizer
from mathspec.experiments.drivetrain import DriveTrainParams, simulate
from mathspec.experiments.telemetry import (
    combined_event_time_bound,
    continuous_crossing_interpolation_bound,
    crossing_quantization_bound,
    exact_linear_event_check,
    fifo_window_delay_bound,
    interpolated_arrival_delay,
    linear_crossing_time,
    max_quantization_error_for_tolerance,
    telemetry_event_pipeline,
)


def test_telemetry_pipeline_is_lossless_and_bounds_event_error():
    p = DriveTrainParams()
    ts, xs = simulate(p, V=12.0, tau_L=0.5, t_end=0.5, dt=1e-3)
    values = xs[:, 2]
    q = UniformQuantizer(-1.0, 25.0, bits=12)
    out = telemetry_event_pipeline(
        ts, values, threshold=10.0, quantizer=q,
        chunk_size=64, corruption_rate=0.2, seed=17,
    )
    assert out["lossless_codes"] is True
    assert out["retransmits"] > 0
    assert out["time_error"] <= out["time_bound"] + 1e-12
    assert out["compression_ratio"] > 1.0


def test_crossing_bound_is_conservative_for_endpoint_perturbations():
    ts = np.array([0.0, 0.1])
    values = np.array([0.2, 1.2])
    threshold = 0.7
    epsilon = 0.05
    truth = linear_crossing_time(ts, values, threshold)
    bound = crossing_quantization_bound(0.1, values[0], values[1], epsilon)
    for e0 in np.linspace(-epsilon, epsilon, 7):
        for e1 in np.linspace(-epsilon, epsilon, 7):
            perturbed = values + [e0, e1]
            estimate = linear_crossing_time(ts, perturbed, threshold)
            assert abs(estimate - truth) <= bound + 1e-12


def test_event_root_reference_reaches_bisection_precision():
    assert exact_linear_event_check() < 1e-12




def test_continuous_interpolation_bound_is_exact_for_linear_and_conservative_for_quadratic():
    assert continuous_crossing_interpolation_bound(0.2, 0.0, 1.0) == 0.0
    # f(t) = (t - 0.7) + 0.5*(t - 0.7)^2 on [0.5, 0.9].
    # It has the unique root 0.7, |f''|=1, and f'(t)>=0.8 on the bracket.
    a, b, root = 0.5, 0.9, 0.7
    f = lambda t: (t - root) + 0.5 * (t - root) ** 2
    fa, fb = f(a), f(b)
    secant_root = a - fa * (b - a) / (fb - fa)
    bound = continuous_crossing_interpolation_bound(b - a, 1.0, 0.8)
    assert abs(secant_root - root) <= bound + 1e-12


def test_combined_event_bound_covers_quadratic_root_with_endpoint_perturbations():
    # Same monotone quadratic; epsilon keeps both endpoint signs unchanged.
    a, b, root = 0.5, 0.9, 0.7
    dt, M, m, epsilon = b - a, 1.0, 0.8, 0.005
    f = lambda t: (t - root) + 0.5 * (t - root) ** 2
    y0, y1 = f(a), f(b)
    assert y0 + epsilon < 0.0 < y1 - epsilon
    bound = combined_event_time_bound(dt, y0, y1, epsilon, M, m)
    for e0 in np.linspace(-epsilon, epsilon, 9):
        for e1 in np.linspace(-epsilon, epsilon, 9):
            estimate = a - (y0 + e0) * dt / ((y1 + e1) - (y0 + e0))
            assert abs(estimate - root) <= bound + 1e-12


def test_quantization_budget_inverse_is_tight_and_monotone():
    dt, a, b, root = 0.4, 0.5, 0.9, 0.7
    M, m, extra = 1.0, 0.8, 0.005
    f = lambda t: (t - root) + 0.5 * (t - root) ** 2
    y0, y1 = f(a), f(b)
    tolerance = 0.04
    allowed = max_quantization_error_for_tolerance(
        dt, y0, y1, tolerance, M, m, additional_time_error=extra)
    assert allowed > 0.0
    assert combined_event_time_bound(dt, y0, y1, allowed, M, m) + extra == pytest.approx(tolerance)
    assert combined_event_time_bound(dt, y0, y1, allowed * (1 + 1e-8), M, m) + extra > tolerance


def test_arrival_delay_is_a_convex_endpoint_combination():
    d0, d1 = 0.0, 0.8
    delays = [interpolated_arrival_delay(alpha, d0, d1)
              for alpha in np.linspace(0.0, 1.0, 11)]
    assert delays[0] == pytest.approx(d0)
    assert delays[-1] == pytest.approx(d1)
    assert all(d0 <= delay <= d1 for delay in delays)
    # Convex interpolation is affine in alpha, so every interior point obeys
    # the exact interpolation identity (not merely a range check).
    for alpha, delay in zip(np.linspace(0.0, 1.0, 11), delays):
        assert delay == pytest.approx((1.0 - alpha) * d0 + alpha * d1)
    assert interpolated_arrival_delay(0.75, d1, d0) == pytest.approx(0.2)


def test_fifo_delay_bound_counts_backlog_window_and_retry_waits():
    # Per chunk: 3*0.2 service + 2*0.5 failed-attempt waits + 0.1 propagation.
    # Five chunks (two already queued + three in this window) cost at most 8.5.
    assert fifo_window_delay_bound(2, 3, 3, 0.2, 0.5, 0.1) == pytest.approx(8.5)
    # Increasing either backlog or window size increases the bound by one chunk.
    assert fifo_window_delay_bound(3, 3, 3, 0.2, 0.5, 0.1) == pytest.approx(10.2)
    assert fifo_window_delay_bound(2, 4, 3, 0.2, 0.5, 0.1) == pytest.approx(10.2)


def test_telemetry_rejects_unsorted_nonfinite_saturated_and_invalid_chunks():
    q = UniformQuantizer(0.0, 1.0, bits=8)
    with pytest.raises(ValueError, match="严格递增"):
        telemetry_event_pipeline(np.array([0.0, 0.0]), np.array([0.1, 0.9]), 0.5, q)
    with pytest.raises(ValueError, match="有限"):
        telemetry_event_pipeline(np.array([0.0, 1.0]), np.array([0.1, np.nan]), 0.5, q)
    with pytest.raises(ValueError, match="饱和"):
        telemetry_event_pipeline(np.array([0.0, 1.0]), np.array([-0.1, 0.9]), 0.5, q)
    with pytest.raises(ValueError, match="chunk_size"):
        telemetry_event_pipeline(np.array([0.0, 1.0]), np.array([0.1, 0.9]), 0.5, q, chunk_size=0)
    with pytest.raises(ValueError, match="chunk_size"):
        telemetry_event_pipeline(np.array([0.0, 1.0]), np.array([0.1, 0.9]), 0.5, q, chunk_size=1.5)


@pytest.mark.parametrize("args", [
    (0.0, 1.0, 1.0), (-0.1, 1.0, 1.0), (1.0, -1.0, 1.0),
    (1.0, 1.0, 0.0), (np.inf, 1.0, 1.0), (1.0, np.nan, 1.0),
])
def test_continuous_bound_rejects_invalid_bracket_or_assumption(args):
    with pytest.raises(ValueError):
        continuous_crossing_interpolation_bound(*args)


@pytest.mark.parametrize("args", [
    (0.0, 0.0, 1.0, 0.1), (1.0, 0.0, 1.0, -0.1),
    (1.0, 0.0, 0.2, 0.1), (1.0, 0.0, 1.0, np.inf),
])
def test_quantization_bound_rejects_invalid_interval_or_gap(args):
    with pytest.raises(ValueError):
        crossing_quantization_bound(*args)


@pytest.mark.parametrize("args", [
    (0.4, -0.16, 0.22, 0.02, 1.0, 0.8, 0.0),  # curvature alone exhausts tolerance
    (0.0, -0.16, 0.22, 0.04, 1.0, 0.8, 0.0),
    (0.4, -0.16, 0.22, np.inf, 1.0, 0.8, 0.0),
    (0.4, -0.16, 0.22, 0.1, -1.0, 0.8, 0.0),
])
def test_budget_inverse_rejects_invalid_or_exhausted_budget(args):
    with pytest.raises(ValueError):
        max_quantization_error_for_tolerance(*args)


@pytest.mark.parametrize("args", [
    (-0.1, 0.0, 1.0), (1.1, 0.0, 1.0), (np.nan, 0.0, 1.0),
    (0.5, -0.1, 1.0), (0.5, 0.0, np.inf),
])
def test_arrival_delay_rejects_invalid_fraction_or_endpoint_delay(args):
    with pytest.raises(ValueError):
        interpolated_arrival_delay(*args)


@pytest.mark.parametrize("args", [
    (-1, 1, 1, 0.2, 0.5, 0.1), (0, 0, 1, 0.2, 0.5, 0.1),
    (0, 1, 0, 0.2, 0.5, 0.1), (0.5, 1, 1, 0.2, 0.5, 0.1),
    (0, 1, 1, -0.1, 0.5, 0.1), (0, 1, 1, 0.2, np.inf, 0.1),
    (0, 1, 1, 0.2, 0.5, -0.1),
])
def test_fifo_bound_rejects_invalid_counts_or_time_limits(args):
    with pytest.raises(ValueError):
        fifo_window_delay_bound(*args)


def test_telemetry_rejects_changed_crossing_interval():
    ts = np.array([0.0, 1.0])
    values = np.array([0.2, 0.8])
    quantizer = UniformQuantizer(0.0, 1.0, bits=2)
    with pytest.raises(ValueError, match="量化改变了穿越区间"):
        telemetry_event_pipeline(ts, values, threshold=0.25, quantizer=quantizer)
