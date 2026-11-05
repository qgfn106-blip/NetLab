"""R31/P11-01：并网逆变器 dq 平均模型示例工程回归。"""

from __future__ import annotations

from pathlib import Path

from netlab.core.compute.simulation import Simulation
from netlab.core.model.project import load_project, project_scene_payload


def test_grid_inverter_avg_project_loads_and_precomputes() -> None:
    path = Path(__file__).resolve().parents[2] / "MyProject" / "grid_inverter_avg.netlab"
    project = load_project(path)
    assert project["format"] == "netlab-project"
    assert project["metadata"]["r31"] == "P11-01"

    network = project["networks"][0]
    scene = network["scene"]
    kinds = {node["kind"] for node in scene["nodes"]}
    assert {"signal", "expression", "state_space", "gain"} <= kinds
    assert network["sim"]["dt"] == 5e-5

    sim = Simulation()
    try:
        sim.load_scene(project_scene_payload(project))
        report = sim.precompute(0.2, dt=5e-5)
        assert report["error"] is None
        assert report["steps"] == 4000
        assert report["frames"] == 4000
        assert report["last_time"] == 2.0e-1

        frames = list(sim.recorder.frames)
        tail = frames[-200:]
        for key in ("n:i_d_meas:value", "n:i_q_meas:value"):
            values = [frame["v"][key] for frame in tail]
            assert max(values) - min(values) < 1.0e-3
    finally:
        sim.shutdown()
