# COMP-01：被拒绝的预计算调用必须是原子的（状态/录制/进度与调用前一致）。
"""COMP-01 回归证据：插值规模超限的 precompute 调用不得留下任何副作用。

问题（simulation.py precompute）：插值规模上限校验发生在场景 reset、整段
预计算循环跑完之后才执行；校验一旦拒绝，场景时间/步数/录制帧已被替换成
新预计算的结果，进度快照停留在 running/100%，调用前状态永久丢失。

本文件用真实 Scene/Simulation 验证：
1. 超限调用抛 ValidationError 后，recorder/time/steps/场景检查点/进度
   全部与调用前一致（先跑一小段成功预计算制造非平凡“调用前”状态）；
2. 成功的预计算仍照常替换状态（防止修复方向矫枉过正、把成功路径也回滚）。
"""

from __future__ import annotations

import pytest

from netlab.core.common.limits import ValidationError
from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene


def _wide_scene() -> Scene:
    """7 个 manual 节点 × 6 个数值通道 = 42 个探针键（真实 Scene，非 Fake）。"""
    scene = Scene("signal")
    data = {
        "voltage": 1.0,
        "current": 0.5,
        "x1": 0.1,
        "x2": 0.2,
        "x3": 0.3,
        "x4": 0.4,
    }
    for i in range(7):
        scene.add_node(name=f"u{i}", kind="manual", data=dict(data))
    return scene


def test_rejected_oversized_interpolation_is_atomic() -> None:
    sim = Simulation(_wide_scene())
    try:
        # 先跑一小段成功预计算，制造非平凡的“调用前”状态。
        sim.precompute(0.02, dt=0.01, sample_every=1)
        before_frames = sim.recorder.snapshot()
        before_time = sim.time
        before_steps = sim.steps
        before_scene = sim.scene.capture_checkpoint()
        before_progress = sim.precompute_progress()
        assert before_progress["status"] == "done"

        # 42 通道 × rounds=6（每轮约 ×2）≈ 96001 帧 > 4,000,000 上限：
        # 该调用必须被拒绝，且拒绝后一切状态与调用前一致。
        with pytest.raises(ValidationError, match="插值规模过大"):
            sim.precompute(
                1.5,
                dt=1e-4,
                sample_every=10,
                interpolation_method="gaussian",
                interpolation_rounds=6,
            )

        assert sim.recorder.snapshot() == before_frames, "录制帧必须回滚到调用前"
        assert sim.time == before_time, "仿真时间必须回滚到调用前"
        assert sim.steps == before_steps, "步数必须回滚到调用前（循环根本不该跑）"
        assert sim.scene.capture_checkpoint() == before_scene, "场景状态必须回滚"
        progress = sim.precompute_progress()
        assert progress["status"] not in ("running", "interpolating"), (
            "进度不得停留在 running/interpolating"
        )
        assert progress["running"] is False, "进度不得显示仍在运行"
    finally:
        sim.shutdown()


def test_precompute_still_replaces_state_on_success() -> None:
    sim = Simulation(_wide_scene())
    try:
        first = sim.precompute(0.02, dt=0.01, sample_every=1)
        first_snapshot = sim.recorder.snapshot()
        assert first["frames"] == 2

        second = sim.precompute(0.03, dt=0.01, sample_every=1)
        # 成功路径行为不变：旧帧被替换、时间前进到新终点。
        assert second["frames"] == 3
        assert sim.time == pytest.approx(0.03)
        assert len(sim.recorder) == 3
        assert sim.recorder.snapshot() != first_snapshot
    finally:
        sim.shutdown()
