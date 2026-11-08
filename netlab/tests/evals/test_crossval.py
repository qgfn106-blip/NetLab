"""层 C：外部交叉验证（scipy 独立积分器）。"""
from __future__ import annotations

import numpy as np
import pytest
from scipy.integrate import solve_ivp

from eval_helpers import node_voltage, rc_scene, rlc_step_scene


def _rc_reference(*, r: float, c: float, v: float, t_end: float) -> float:
    def rhs(_t, y):
        return [(v - y[0]) / (r * c)]

    sol = solve_ivp(rhs, (0.0, t_end), [0.0], rtol=1e-11, atol=1e-13, dense_output=False)
    return float(sol.y[0, -1])


def _rlc_reference(*, r: float, l: float, c: float, v: float, t_end: float) -> float:
    def rhs(_t, y):
        i, vc = y
        return [(v - vc - r * i) / l, i / c]

    sol = solve_ivp(rhs, (0.0, t_end), [0.0, 0.0], rtol=1e-11, atol=1e-13, max_step=t_end / 400)
    return float(sol.y[1, -1])


def test_rc_matches_scipy_at_four_tau():
    r, c, v = 1000.0, 1.0e-6, 5.0
    t_end = 4.0 * r * c
    scene = rc_scene(r=r, c=c, v=v)
    for _ in range(400):
        scene.step(t_end / 400)
    got = node_voltage(scene, "mid")
    want = _rc_reference(r=r, c=c, v=v, t_end=t_end)
    assert abs(got - want) <= 5e-3
    assert abs(got - want) / max(abs(want), 1e-12) <= 1e-3


def test_rlc_matches_scipy_at_one_ms():
    r, l, c, v = 10.0, 0.01, 1.0e-4, 1.0
    t_end = 1.0e-3
    scene = rlc_step_scene(r=r, l=l, c=c, v=v)
    for _ in range(1000):
        scene.step(t_end / 1000)
    got = node_voltage(scene, "out")
    want = _rlc_reference(r=r, l=l, c=c, v=v, t_end=t_end)
    assert abs(got - want) <= 5e-2
    assert abs(got - want) / max(abs(want), 1e-12) <= 1e-2


def test_rc_reference_is_independent_of_netlab():
    """参考解只依赖 scipy/解析式；若 netlab 未导入 scipy.integrate 仍应成立。"""
    assert np.isfinite(_rc_reference(r=1000.0, c=1e-6, v=5.0, t_end=4e-3))
