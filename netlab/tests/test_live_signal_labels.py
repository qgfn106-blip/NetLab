"""信号面板：帧键、探针键与显示名的一致性（2026-11-09 UI 修复回归）。"""

from __future__ import annotations

from netlab.core.compute.simulation import Simulation
from netlab.core.model.templates import build_template


def test_live_frames_use_display_names_and_keep_stable_probe_keys() -> None:
    sim = Simulation()
    sim.load_scene(build_template("rlc_series"))
    sim.step_once(3)
    live = sim.live(0, 10)
    raw_keys = list(sim.recorder.keys())
    display_keys = [sim.scene.channel_display_name(key) for key in raw_keys]
    assert raw_keys, "运行后应记录到探针通道"
    assert live["sim"]["probe_keys"] == raw_keys
    assert live["keys"] == display_keys
    assert live["frames"], "应至少有一帧"
    for frame in live["frames"]:
        assert list(frame["v"]) == display_keys
    labels = live["sim"]["probe_labels"]
    assert set(labels) == set(raw_keys)
    assert [labels[key] for key in raw_keys] == display_keys


def test_live_labels_follow_rename_without_changing_keys() -> None:
    sim = Simulation()
    sim.load_scene(build_template("rlc_series"))
    sim.step_once(2)
    raw_keys = list(sim.recorder.keys())
    labels_before = dict(sim.live(0, 1)["sim"]["probe_labels"])
    node = next(iter(sim.scene.nodes.values()))
    node.name = "改名的节点"
    labels_after = dict(sim.live(0, 1)["sim"]["probe_labels"])
    assert list(sim.recorder.keys()) == raw_keys
    assert any(labels_after[key] != labels_before[key] for key in raw_keys)
    assert any("改名的节点" in value for value in labels_after.values())
