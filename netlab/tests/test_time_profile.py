"""R11（T_step / 时间归零 / 重置）与 R13（计时装饰器）回归。"""

from __future__ import annotations

import pytest

from netlab.core.compute import profiling
from netlab.core.compute.profiling import Profiler, measure, timed
from netlab.core.model.scene import Scene
from netlab.core.compute.simulation import Simulation


def build_simulation(**config) -> Simulation:
    scene = Scene("signal")
    src = scene.add_node(name="src", kind="manual", data={"voltage": 4.0})
    acc = scene.add_node(name="acc", kind="integrate", params={"gain": 1.0})
    scene.add_edge(source=src.id, target=acc.id, kind="scale", params={"gain": 1.0})
    simulation = Simulation(scene)
    simulation.apply_config({"fps": 50, "dt": 0.01, "steps_per_frame": 1, **config})
    return simulation


def test_t_step_controls_single_step_count():
    simulation = build_simulation(t_step=0.05)
    try:
        simulation.step_once()  # 未显式给步数 → 按 T_step/dt = 5 步
        assert simulation.steps == 5
        assert simulation.time == pytest.approx(0.05)
        config = simulation.apply_config({"t_step": 0.0})
        assert config["t_step"] == 0.0
        simulation.step_once()
        assert simulation.steps == 6  # T_step=0 回落到 steps_per_frame
        with pytest.raises(Exception):
            simulation.apply_config({"t_step": -1.0})
    finally:
        simulation.shutdown()


def test_zero_time_keeps_state_but_resets_clock():
    simulation = build_simulation()
    try:
        simulation.step_once(3)
        node = next(
            item for item in simulation.scene.nodes.values() if item.name == "acc"
        )
        before = dict(node.data)
        engine = simulation.scene.ensure_engine()
        assert engine.network.time == pytest.approx(0.03)
        frames_before = len(simulation.recorder)
        assert frames_before == 3

        simulation.zero_time()

        assert simulation.time == 0.0
        assert simulation.steps == 0
        assert len(simulation.recorder) == 0
        assert dict(node.data) == before, "时间归零不能清状态"
        assert engine.network.time == 0.0
        simulation.step_once()
        assert simulation.steps == 1
    finally:
        simulation.shutdown()


def test_reset_clears_state_and_time():
    simulation = build_simulation()
    try:
        simulation.step_once(2)
        node = next(
            item for item in simulation.scene.nodes.values() if item.name == "acc"
        )
        node.data["acc"] = 1.0
        simulation.reset()
        assert simulation.time == 0.0
        assert simulation.steps == 0
        assert len(simulation.recorder) == 0
        assert node.state == {}
        assert simulation.scene.ensure_engine().network.time == 0.0
    finally:
        simulation.shutdown()


def test_profiler_disabled_costs_nothing_and_records_nothing():
    profiler = Profiler()
    calls = {"n": 0}

    @timed("demo.work")
    def work(value: int) -> int:
        calls["n"] += 1
        return value * 2

    assert profiler.snapshot()["enabled"] is False
    assert work(3) == 6
    assert calls["n"] == 1
    profiling.PROFILER.set_enabled(False)
    profiling.PROFILER.clear()
    assert work(4) == 8
    assert profiling.PROFILER.snapshot()["entries"] == []


def test_profiler_records_and_sorts_when_enabled():
    original = profiling.PROFILER
    profiling.set_enabled(True)
    profiling.clear()
    try:

        @timed("fast")
        def fast() -> None:
            pass

        @timed("slow")
        def slow() -> None:
            for _ in range(2000):
                pass

        for _ in range(3):
            fast()
        for _ in range(5):
            slow()
        with measure("block"):
            pass

        snapshot = profiling.snapshot()
        names = [item["name"] for item in snapshot["entries"]]
        assert snapshot["enabled"] is True
        assert set(names) == {"fast", "slow", "block"}, names
        slow_entry = next(
            item for item in snapshot["entries"] if item["name"] == "slow"
        )
        assert slow_entry["count"] == 5
        assert slow_entry["max_ms"] >= slow_entry["mean_ms"] > 0

        profiling.clear()
        assert profiling.snapshot()["entries"] == []
    finally:
        profiling.set_enabled(original.enabled)
        profiling.clear()


def test_scene_step_is_timed_when_enabled(client):
    enabled = client.patch("/api/profile", json={"enabled": True, "reset": True})
    assert enabled.status_code == 200, enabled.text
    assert enabled.json()["enabled"] is True

    stepped = client.post("/api/control", json={"action": "step", "steps": 2})
    assert stepped.status_code == 200, stepped.text
    state = client.get("/api/profile").json()
    names = [item["name"] for item in state["entries"]]
    assert "scene.step" in names, names
    assert state["entries"][0]["count"] >= 2

    paused = client.patch("/api/profile", json={"enabled": False})
    assert paused.status_code == 200
    assert paused.json()["enabled"] is False


def test_control_zero_action_keeps_scene_state(client):
    client.post("/api/control", json={"action": "step", "steps": 3})
    before = client.get("/api/state").json()["scene"]["nodes"]
    zeroed = client.post("/api/control", json={"action": "zero"})
    assert zeroed.status_code == 200, zeroed.text
    assert zeroed.json()["sim"]["steps"] == 0
    after = client.get("/api/state").json()["scene"]["nodes"]
    assert [node["data"] for node in before] == [node["data"] for node in after]
