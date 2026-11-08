"""层 E：病态与事件边界（reset/zero_time/非法输入/奇异电路）。"""
from __future__ import annotations

import math

import pytest

from netlab.core.common.limits import ComputeError, ValidationError

from eval_helpers import node_voltage, rc_scene


def _mid(scene):
    return next(item for item in scene.nodes.values() if item.name == "mid")


def test_reset_clears_reactive_state():
    scene = rc_scene()
    for _ in range(100):
        scene.step(1e-5)
    assert node_voltage(scene, "mid") > 1.0
    scene.reset()
    assert node_voltage(scene, "mid") == pytest.approx(0.0, abs=1e-12)
    assert scene.ensure_engine().solver.time == 0.0


def test_zero_time_preserves_state_by_contract():
    scene = rc_scene()
    for _ in range(100):
        scene.step(1e-5)
    before = node_voltage(scene, "mid")
    scene.zero_time()
    assert node_voltage(scene, "mid") == pytest.approx(before, rel=0.0, abs=0.0)
    assert scene.ensure_engine().solver.time == 0.0


@pytest.mark.parametrize("dt", [0.0, -1.0, float("nan"), float("inf")])
def test_invalid_dt_rejected(dt):
    scene = rc_scene()
    with pytest.raises(ValidationError):
        scene.step(dt)


def test_negative_resistance_rejected():
    with pytest.raises(ValidationError):
        rc_scene(r=-1000.0)


def test_parallel_ideal_voltage_sources_report_error():
    scene = rc_scene()
    scene.add_edge(
        source="c00000000001",
        target="c00000000003",
        kind="vsource",
        name="V2",
        params={"wave": "dc", "amplitude": 3.0},
    )
    with pytest.raises(ComputeError):
        scene.step(1e-5)


def test_state_remains_finite_after_recoverable_error():
    scene = rc_scene()
    for _ in range(10):
        scene.step(1e-5)
    with pytest.raises(ValidationError):
        scene.step(-1.0)
    assert math.isfinite(node_voltage(scene, "mid"))
