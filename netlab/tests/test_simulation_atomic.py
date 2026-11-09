"""Phase 1: 单步超时与录制失败必须回滚到步前状态。"""

from __future__ import annotations

import time

import pytest

from netlab.core.common.limits import ComputeError
from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene


def _rc_scene() -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    n1 = scene.add_node(name="n1", kind="node")
    scene.add_edge(
        name="V1",
        source=n1.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 5.0, "amplitude": 0.0},
    )
    scene.add_edge(
        name="R1", source=n1.id, target=gnd.id, kind="resistor", params={"R": 1000.0}
    )
    scene.add_edge(
        name="C1", source=n1.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6}
    )
    return scene


def test_deadline_aborts_newton_before_iteration() -> None:
    scene = _rc_scene()
    with pytest.raises(ComputeError, match="超时"):
        scene.step(1.0e-4, deadline=time.perf_counter() - 1.0)


def test_recorder_push_failure_rolls_back_step_and_counter() -> None:
    sim = Simulation(_rc_scene())
    sim.config.dt = 1.0e-4

    def boom(*_args, **_kwargs):
        raise RuntimeError("disk full")

    sim.recorder.push = boom  # type: ignore[method-assign]
    sim.step_once(1)

    assert sim.steps == 0
    assert sim.time == pytest.approx(0.0)
    assert "disk full" in (sim.error or "")
    assert sim.recorder.keys() == []


def test_precompute_failure_restores_previous_scene_and_frames() -> None:
    sim = Simulation(_rc_scene())
    sim.config.dt = 1.0e-4
    sim.step_once(1)
    old_time = sim.time
    old_steps = sim.steps
    old_frames = list(sim.recorder.frames)

    original = sim.scene.step
    calls = {"n": 0}

    def fail_after_first(dt, deadline=None):
        calls["n"] += 1
        if calls["n"] > 1:
            raise RuntimeError("precompute boom")
        return original(dt, deadline=deadline)

    sim.scene.step = fail_after_first  # type: ignore[method-assign]
    result = sim.precompute(duration=1.0e-3, dt=1.0e-4, sample_every=1)

    assert result["error"] and "precompute boom" in result["error"]
    assert sim.steps == old_steps
    assert sim.time == pytest.approx(old_time)
    assert list(sim.recorder.frames) == old_frames
