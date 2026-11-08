"""R31/P11-06：六开关三相桥示例工程回归。"""

from __future__ import annotations

from pathlib import Path

from netlab.core.compute.simulation import Simulation
from netlab.core.model.project import load_project, project_scene_payload


def test_grid_switch_project_loads_and_runs() -> None:
    path = (
        Path(__file__).resolve().parents[2]
        / "MyProject"
        / "grid_inverter_switch.netlab"
    )
    project = load_project(path)
    assert project["metadata"]["r31"] == "P11-06"
    scene_payload = project_scene_payload(project)
    edge_kinds = [edge["kind"] for edge in scene_payload["edges"]]
    assert edge_kinds.count("nmos") == 6
    assert scene_payload["mode"] == "circuit"

    sim = Simulation()
    try:
        sim.load_scene(scene_payload)
        report = sim.precompute(0.02, dt=1.0e-5)
        assert report["error"] is None
        assert report["steps"] == 2000
        frames = sim.live(0, 6000)["frames"]
        keys = list(frames[-1]["v"])
        pcc_key = next(key for key in keys if "pcc_a" in key)
        mid_key = next(key for key in keys if "mid_a" in key)
        pcc_peak = max(abs(frame["v"][pcc_key]) for frame in frames)
        mid_peak = max(abs(frame["v"][mid_key]) for frame in frames)
        assert pcc_peak > 10.0
        assert mid_peak > 10.0
        assert all(abs(frame["v"][pcc_key]) < 200.0 for frame in frames)
    finally:
        sim.shutdown()
