"""批次B（#1）：预计算失败/取消必须就地恢复同一 Engine 与仿真级运行时状态。

旧实现用 ``before_scene = self.scene.to_payload()`` + ``self.scene.load_payload(...)``
回滚：load_payload 会重建 Scene/Engine，丢失引擎内部运行时状态（元件 state / solution /
_startup_pending 等）且 Engine 身份改变；同时 ``_frame_times`` 被 clear 而非恢复。
本测试锁定：失败回滚后 (a) Engine 身份不变；(b) _frame_times / last_sample / recorder 还原。
"""

from __future__ import annotations

import pytest

from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene


def _make_sim() -> Simulation:
    scene = Scene("signal")
    scene.add_node(name="a", kind="manual", data={"voltage": 1.0})
    sim = Simulation(scene)
    sim.apply_config({"fps": 30, "dt": 0.01, "steps_per_frame": 1, "sample_every": 1})
    return sim


def test_precompute_failure_restores_same_engine_and_runtime_fields(monkeypatch):
    sim = _make_sim()
    engine_before = sim.scene.ensure_engine()
    # 预置仿真级运行时状态（帧时间/上次采样/录制）
    sim._frame_times.extend([0.0, 0.1, 0.2])
    sim._last_sample_time = 0.2
    sim.recorder.push(0.1, sim.scene.probes(by_id=True), sample_dt=0.1)
    before_frames = list(sim._frame_times)
    before_recorder = sim.recorder.snapshot()

    def boom(*args, **kwargs):
        raise RuntimeError("模拟单步计算失败")

    monkeypatch.setattr(sim.scene, "step", boom)

    sim.precompute(duration=0.1, dt=0.01, sample_every=1)

    assert sim.error is not None, "预计算应记录错误并回滚"
    engine_after = sim.scene.ensure_engine()
    assert engine_after is engine_before, (
        "预计算失败回滚后必须是同一个 Engine（旧实现 load_payload 会重建，身份改变）"
    )
    assert list(sim._frame_times) == before_frames, "_frame_times 应恢复为失败前内容，而非被清空"
    assert sim._last_sample_time == 0.2, "_last_sample_time 应恢复"
    assert sim.recorder.snapshot() == before_recorder, "recorder 应恢复为失败前快照"
