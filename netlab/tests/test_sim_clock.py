"""A-3 / N-05：场景内所有引擎共享同一个 SimClock。"""

from __future__ import annotations

import pytest

from netlab.core.compute.simulation import SimConfig, Simulation
from netlab.core.model.scene import Scene


def _rc_scene() -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    first = scene.add_node(name="n1", kind="node")
    second = scene.add_node(name="n2", kind="node")
    scene.add_edge(
        name="V1",
        source=first.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 1.0, "amplitude": 0.0},
    )
    scene.add_edge(
        name="R1",
        source=first.id,
        target=second.id,
        kind="resistor",
        params={"R": 1000.0},
    )
    scene.add_edge(
        name="R2",
        source=second.id,
        target=gnd.id,
        kind="resistor",
        params={"R": 1000.0},
    )
    return scene


def test_signal_simulation_and_network_share_clock_for_1000_steps():
    scene = Scene("signal")
    sim = Simulation(scene)
    for _ in range(1000):
        assert sim._advance_locked(1e-3, 1) is True
    assert sim.time == scene.ensure_engine().network.time == scene.clock.time
    assert abs(scene.clock.time - 1.0) < 1e-12


def test_circuit_simulation_and_solver_share_clock():
    scene = _rc_scene()
    sim = Simulation(scene)
    for _ in range(10):
        assert sim._advance_locked(1e-4, 1) is True
    assert sim.time == scene.clock.time
    assert scene.ensure_engine().solver.time == scene.clock.time


def test_failed_step_does_not_advance_shared_clock(monkeypatch):
    scene = Scene("signal")
    sim = Simulation(scene)
    before = scene.clock.time

    def boom(_dt: float) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(scene, "step", boom)
    assert sim._advance_locked(1e-3, 1) is False
    assert scene.clock.time == before
    assert sim.time == before


def test_recorder_sample_dt_tracks_actual_step_interval():
    scene = _rc_scene()
    sim = Simulation(scene)
    assert sim._advance_locked(1.0e-4, 1) is True
    assert sim.recorder.quality["sample_dt"] == pytest.approx(1.0e-4, abs=1.0e-15)
    assert sim._advance_locked(3.0e-4, 1) is True
    assert sim.recorder.quality["sample_dt"] == pytest.approx(3.0e-4, abs=1.0e-15)


def test_sim_config_separates_numerical_and_presentation_fields():
    config = SimConfig()
    numerical = config.numerical_params()
    presentation = config.presentation_params()
    assert "dt" in numerical and "reltol" in numerical
    assert "fps" in presentation and "sample_every" in presentation
    assert set(numerical).isdisjoint(presentation)
    fields = {name for name in config.__dataclass_fields__ if not name.isupper()}
    assert set(numerical) | set(presentation) == fields
