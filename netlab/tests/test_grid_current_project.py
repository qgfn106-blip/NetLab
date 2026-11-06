"""R31/P11-04：dq 电流环示例工程回归。"""

from __future__ import annotations

from pathlib import Path

from netlab.core.compute.simulation import Simulation
from netlab.core.model.project import load_project, project_scene_payload


def test_grid_inverter_current_project_loads_and_tracks_step() -> None:
    path = (
        Path(__file__).resolve().parents[2]
        / "MyProject"
        / "grid_inverter_current.netlab"
    )
    project = load_project(path)
    assert project["metadata"]["r31"] == "P11-04"
    network = project["networks"][0]
    assert network["sim"]["dt"] == 5e-5
    kinds = {node["kind"] for node in network["scene"]["nodes"]}
    assert {"signal", "expression", "pi", "state_space"} <= kinds

    sim = Simulation()
    try:
        sim.load_scene(project_scene_payload(project))
        report = sim.precompute(0.03, dt=5e-5)
        assert report["error"] is None
        assert report["steps"] == 600
        frames = list(sim.recorder.frames)
        keys = list(frames[-1]["v"])
        key = next(key for key in keys if key.endswith(":i_d"))
        values = [frame["v"][key] for frame in frames]
        start = next(i for i, value in enumerate(values) if value >= 0.1)
        end = next(i for i, value in enumerate(values) if value >= 0.9)
        rise_ms = (end - start) * 5e-5 * 1000.0
        assert rise_ms < 5.0
        assert abs(values[-1] - 1.0) < 1.0e-3
    finally:
        sim.shutdown()
