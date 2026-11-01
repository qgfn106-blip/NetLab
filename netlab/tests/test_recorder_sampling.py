"""R27/D57：录制帧均匀降采样与预计算覆盖整段窗口的回归。"""

from __future__ import annotations

import pytest

from netlab.limits import ValidationError
from netlab.scene import Scene
from netlab.simulation import RECORDER_CAPACITY, Recorder, Simulation


def test_recorder_resamples_pending_frames_instead_of_truncating():
    recorder = Recorder()
    for index in range(3000):
        recorder.push(index * 1e-4, {"x": float(index)})

    frames = recorder.since(0, 600)

    assert len(frames) == 600
    seqs = [frame["seq"] for frame in frames]
    assert seqs == sorted(seqs)
    assert len(set(seqs)) == 600
    assert seqs[-1] == recorder.seq, "最新帧必须保留，否则图表会滞后"
    assert frames[-1]["v"]["x"] == pytest.approx(2999.0)
    gaps = {b - a for a, b in zip(seqs, seqs[1:])}
    assert len(gaps) <= 2, gaps
    assert max(gaps) <= 3, "必须等间隔抽样，不能整段跳过"
    assert max(gaps) - min(gaps) <= 1, gaps


def test_recorder_returns_all_frames_when_under_limit():
    recorder = Recorder()
    for index in range(50):
        recorder.push(index * 1e-3, {"x": float(index)})
    assert len(recorder.since(0, 600)) == 50
    assert recorder.since(50, 600) == []
    assert [frame["seq"] for frame in recorder.since(49, 600)] == [50]


def test_precompute_covers_whole_window_within_capacity():
    scene = Scene("signal")
    src = scene.add_node(name="src", kind="manual", data={"voltage": 1.0})
    acc = scene.add_node(name="acc", kind="integrate", params={"gain": 1.0})
    scene.add_edge(source=src.id, target=acc.id, kind="scale", params={"gain": 1.0})
    sim = Simulation(scene)
    try:
        result = sim.precompute(2.0, dt=1e-3, sample_every=1)
    finally:
        sim.shutdown()

    assert result["error"] is None
    assert result["frames"] <= RECORDER_CAPACITY
    assert result["sample_every"] >= 2, "2000 步超过容量时必须自动降采样"
    assert result["first_time"] <= 2e-3, "预计算的起点必须仍在 0 附近"
    assert result["last_time"] == pytest.approx(2.0, abs=1e-9)
    assert len(sim.recorder) == result["frames"]


def test_rejected_precompute_keeps_existing_recording_and_scene():
    """超过步数上限时应先拒绝，不能先清空录制帧/重置场景再报错。"""
    scene = Scene("signal")
    src = scene.add_node(name="src", kind="manual", data={"voltage": 1.0})
    acc = scene.add_node(name="acc", kind="integrate", params={"gain": 1.0})
    scene.add_edge(source=src.id, target=acc.id, kind="scale", params={"gain": 1.0})
    sim = Simulation(scene)
    try:
        sim.precompute(0.01, dt=1e-3, sample_every=1)
        before = (sim.time, sim.steps, len(sim.recorder), sim.recorder.seq)
        with pytest.raises(ValidationError, match="超过"):
            sim.precompute(120.0, dt=1e-6, sample_every=1)
        after = (sim.time, sim.steps, len(sim.recorder), sim.recorder.seq)
        assert after == before
    finally:
        sim.shutdown()

