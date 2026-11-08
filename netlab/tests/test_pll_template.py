"""R31/P11-03：PLL 模板工程回归。"""

from __future__ import annotations

from pathlib import Path

from netlab.core.compute.simulation import Simulation
from netlab.core.model.project import load_project, project_scene_payload


def test_pll_template_project_loads_and_locks() -> None:
    path = Path(__file__).resolve().parents[2] / "MyProject" / "pll_template.netlab"
    project = load_project(path)
    assert project["metadata"]["r31"] == "P11-03"
    network = project["networks"][0]
    assert network["sim"]["dt"] == 5e-5
    kinds = {node["kind"] for node in network["scene"]["nodes"]}
    assert {"expression", "pll", "gain"} <= kinds

    sim = Simulation()
    try:
        sim.load_scene(project_scene_payload(project))
        report = sim.precompute(0.1, dt=5e-5)
        assert report["error"] is None
        frames = sim.live(0, 6000)["frames"]
        keys = list(frames[-1]["v"])
        freq_key = next(key for key in keys if "freq_meas" in key)
        d_key = next(key for key in keys if "d_meas" in key)
        tail = frames[-500:]
        assert max(abs(frame["v"][freq_key] - 50.0) for frame in tail) < 1.0e-2
        assert abs(sum(frame["v"][d_key] for frame in tail) / len(tail) - 1.0) < 1.0e-2
    finally:
        sim.shutdown()
