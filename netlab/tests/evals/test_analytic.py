"""层 A：解析解对照（RC 充电 / RLC 阶跃）。"""
from __future__ import annotations

import math

import pytest

from eval_helpers import rc_analytic, rc_voltage_after, rlc_step_analytic, rlc_step_scene, node_voltage


def test_rc_charging_matches_closed_form() -> None:
    tau = 1.0e-3
    value = rc_voltage_after(tau / 100.0, 100)
    analytic = rc_analytic(tau)
    assert value == pytest.approx(analytic, abs=1.0e-2)
    assert abs(value - analytic) / analytic <= 5.0e-3


def test_rc_four_tau_matches_closed_form() -> None:
    tau = 1.0e-3
    value = rc_voltage_after(tau / 100.0, 400)
    analytic = rc_analytic(4.0 * tau)
    assert value == pytest.approx(analytic, abs=1.0e-2)


def test_rlc_step_matches_closed_form() -> None:
    scene = rlc_step_scene()
    dt = 1.0e-5
    for _ in range(100):
        scene.step(dt)
    value = node_voltage(scene, "out")
    analytic = rlc_step_analytic(1.0e-3)
    assert value == pytest.approx(analytic, abs=5.0e-2)
    assert math.isfinite(value)
