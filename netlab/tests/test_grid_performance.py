"""R31/P11-07：并网逆变器平均/开关模型长步长性能冒烟。"""

from __future__ import annotations

import threading
import time
from pathlib import Path

from netlab.core.compute.simulation import Simulation
from netlab.core.model.project import load_project, project_scene_payload

ROOT = Path(__file__).resolve().parents[2]


def _run(project_name: str, duration: float, dt: float) -> tuple[int, int, float]:
    project = load_project(ROOT / "MyProject" / project_name)
    sim = Simulation()
    try:
        sim.load_scene(project_scene_payload(project))
        started = time.perf_counter()
        report = sim.precompute(duration, dt=dt)
        elapsed = time.perf_counter() - started
        assert report["error"] is None
        assert report["last_time"] >= duration - 2.0 * dt
        return report["steps"], report["frames"], elapsed
    finally:
        sim.shutdown()


def test_grid_performance_smoke() -> None:
    avg_steps, avg_frames, avg_elapsed = _run("grid_inverter_avg.netlab", 0.005, 1.0e-6)
    assert avg_steps == 5000
    assert avg_frames == 5000
    assert avg_elapsed < 20.0

    sw_steps, sw_frames, sw_elapsed = _run("grid_inverter_switch.netlab", 0.002, 1.0e-6)
    assert sw_steps == 2000
    assert sw_frames == 2000
    assert sw_elapsed < 30.0


def test_precompute_can_be_cancelled() -> None:
    project = load_project(ROOT / "MyProject" / "grid_inverter_avg.netlab")
    sim = Simulation()
    result: list[dict] = []
    try:
        sim.load_scene(project_scene_payload(project))
        thread = threading.Thread(target=lambda: result.append(sim.precompute(0.02, dt=1.0e-6)))
        thread.start()
        time.sleep(0.05)
        sim.cancel_precompute()
        thread.join(timeout=10.0)
        assert not thread.is_alive()
        assert result and result[0]["cancelled"] is True
        assert result[0]["steps"] < 20000
    finally:
        sim.shutdown()

