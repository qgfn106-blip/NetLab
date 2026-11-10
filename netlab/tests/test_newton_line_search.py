"""Phase 1：Newton 线搜索/步长回退单元行为。"""

from __future__ import annotations

import numpy as np
import pytest

from netlab.core.model.scene import Scene


def _linear_solver():
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    n1 = scene.add_node(name="n1", kind="node")
    scene.add_edge(
        name="V1",
        source=n1.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 1.0, "amplitude": 0.0},
    )
    scene.add_edge(
        name="R1", source=n1.id, target=gnd.id, kind="resistor", params={"R": 1000.0}
    )
    return scene.ensure_engine().solver


def test_line_search_backtracks_when_full_step_increases_residual(monkeypatch):
    solver = _linear_solver()
    target = 3.0

    def residual(candidate, dt, mode):
        return float(np.sum((np.asarray(candidate) - target) ** 2)), 0

    monkeypatch.setattr(solver, "_true_residual", residual)
    solution = np.array([0.0])
    full_step = np.array([10.0])
    current_residual = float(np.sum((solution - target) ** 2))

    accepted, residual_value, _ = solver._line_search_solution(
        solution, full_step, 1.0e-4, "tran", current_residual
    )

    assert accepted[0] < full_step[0]
    assert residual_value < current_residual


def test_line_search_keeps_full_step_when_it_reduces_residual(monkeypatch):
    solver = _linear_solver()
    target = 3.0

    def residual(candidate, dt, mode):
        return float(np.sum((np.asarray(candidate) - target) ** 2)), 0

    monkeypatch.setattr(solver, "_true_residual", residual)
    solution = np.array([0.0])
    full_step = np.array([2.0])

    accepted, residual_value, _ = solver._line_search_solution(
        solution, full_step, 1.0e-4, "tran", 9.0
    )

    assert accepted[0] == pytest.approx(2.0)
    assert residual_value == pytest.approx(1.0)
