# 职责边界：A3 = 真实 Scene/Simulation 惰性适配前后单步等价性
"""P2-A A3 窄口径证据：惰性适配器对试点 sum+integrate 的仿真行为零影响。

纯测试、不接线、不改生产码。目标：补齐 P2-A 退出条件「单步数值一致 / 旧节点行为不变」
的可验证证据——同一试点场景，构造 NodeDesc/NodeRuntime 惰性适配器前后，仿真逐步输出逐点一致。
"""

from __future__ import annotations

from typing import Any

from netlab.core.compute.simulation import Simulation
from netlab.core.model.instance_model import NodeDesc, NodeRuntime
from netlab.core.model.scene import Scene


def _pilot_scene() -> Scene:
    scene = Scene("signal")
    u1 = scene.add_node(name="u1", kind="manual", data={"voltage": 1.0})
    u2 = scene.add_node(name="u2", kind="manual", data={"voltage": 2.0})
    s = scene.add_node(name="s", kind="sum")
    acc = scene.add_node(name="acc", kind="integrate", params={"gain": 1.0})
    scene.add_edge(source=u1.id, target=s.id, kind="scale", params={"gain": 1.0})
    scene.add_edge(source=u2.id, target=s.id, kind="scale", params={"gain": 1.0})
    scene.add_edge(source=s.id, target=acc.id, kind="scale", params={"gain": 1.0})
    return scene


def _run(scene: Scene) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    sim = Simulation(scene)
    try:
        result = sim.precompute(0.05, dt=0.01, sample_every=1)
        frames = sim.recorder.since(0, 10**9)
        return result, frames
    finally:
        sim.shutdown()


def _norm(frames: list[dict[str, Any]]) -> list[tuple[float, dict[str, float]]]:
    # 节点 id 在两次建场景时随机、故按每帧数值多重集合比较（顺序无关、逐点一致）
    return [
        (round(float(f["t"]), 12), tuple(sorted(round(float(v), 12) for v in f["v"].values())))
        for f in frames
    ]


def test_frames_identical_before_after_constructing_adapters() -> None:
    control_result, control_frames = _run(_pilot_scene())

    patched_scene = _pilot_scene()
    # 构造惰性适配器（不得接线/双写）：仅读 record 生成 Desc/Runtime
    for node in patched_scene.nodes.values():
        NodeDesc.from_record(node)
        NodeRuntime.from_record(node)
    patched_result, patched_frames = _run(patched_scene)

    assert control_result["error"] is None and patched_result["error"] is None
    assert _norm(control_frames) == _norm(patched_frames), "构造适配器后仿真逐点输出必须完全一致"


def test_pilot_integrate_accumulates_old_behavior_unchanged() -> None:
    result, frames = _run(_pilot_scene())
    assert result["error"] is None
    acc_key = next(k for k in frames[0]["v"] if k.endswith(":acc"))
    seq = [f["v"].get(acc_key) for f in frames]
    assert len(seq) >= 2
    # 输入恒为正（1+2，gain 1），梯形积分应单调不减且首步很小
    vals = [float(v) for v in seq if v is not None]
    assert all(b >= a - 1e-12 for a, b in zip(vals, vals[1:])), vals
    assert vals[-1] > vals[0]
    assert abs(vals[0]) < 0.05
