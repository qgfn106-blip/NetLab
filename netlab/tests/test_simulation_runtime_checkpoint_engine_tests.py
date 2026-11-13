"""批次补测：CircuitEngine / BlockRuntime 就地恢复（同一 Engine）覆盖。

- CircuitEngine：预计算中途失败后，必须就地恢复同一 CircuitEngine 实例，
  且 state/solution 回滚到预计算前；_frame_times / last sample / recorder 一致。
- BlockRuntime：capture/restore checkpoint 往返恢复 behavior state 与时间。
"""

from __future__ import annotations

import pytest

from netlab.core.compute.simulation import Simulation
from netlab.core.model.blocks import BlockDef, BlockRuntime
from netlab.core.model.scene import Scene


def _rc_scene() -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    n1 = scene.add_node(name="n1", kind="node")
    scene.add_edge(name="V1", source=n1.id, target=gnd.id, kind="vsource",
                   params={"wave": "dc", "offset": 5.0, "amplitude": 0.0})
    scene.add_edge(name="R1", source=n1.id, target=gnd.id, kind="resistor", params={"R": 1000.0})
    scene.add_edge(name="C1", source=n1.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6})
    return scene


def test_precompute_failure_restores_same_circuit_engine_and_fields() -> None:
    sim = Simulation(_rc_scene())
    sim.config.dt = 1.0e-4
    sim.step_once(1)
    engine_before = sim.scene.ensure_engine()
    before_state = sim.scene.capture_checkpoint()["state"]
    old_time = sim.time
    old_frames = list(sim.recorder.frames)
    old_ft = list(sim._frame_times)
    old_lst = sim._last_sample_time

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
    assert sim.scene.ensure_engine() is engine_before, "CircuitEngine 必须就地恢复同一实例（不得重建）"
    after_cp = sim.scene.capture_checkpoint()
    assert after_cp["engine"] is engine_before
    assert repr(after_cp["state"]) == repr(before_state), "CircuitEngine state/solution 应回滚到预计算前"
    assert sim.time == pytest.approx(old_time)
    assert list(sim._frame_times) == old_ft
    assert sim._last_sample_time == old_lst
    assert list(sim.recorder.frames) == old_frames


def test_block_runtime_capture_restore_roundtrip() -> None:
    block = BlockDef(
        id="abcd1234", name="B", mode="signal", description="",
        nodes=[], edges=[], ports=[], metadata={"behavior": {"kind": "gain", "gain": 2.0}},
    )
    runtime = BlockRuntime(block, None)  # behavior-only，无内部场景
    runtime._behavior_state = {"x": 1.0}
    runtime._behavior_time = 0.5
    checkpoint = runtime.capture_checkpoint()
    runtime._behavior_state = {"x": 9.0}
    runtime._behavior_time = 2.0
    runtime.restore_checkpoint(checkpoint)
    assert runtime._behavior_state == {"x": 1.0}
    assert runtime._behavior_time == 0.5
