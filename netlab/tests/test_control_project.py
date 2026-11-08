"""欠阻尼二阶闭环与工程交付回归（R35 后续补强）。"""

from __future__ import annotations

import pytest

from netlab.core.compute.simulation import Simulation
from netlab.core.model.project import load_project, save_project
from netlab.core.model.scene import Scene


def _build_underdamped_scene() -> tuple[Scene, object]:
    """G(s)=4/(s(s+1.2)) 单位负反馈 → 4/(s²+1.2s+4)，ωn=2、ζ=0.3。"""
    scene = Scene("signal")
    source = scene.add_node(
        name="reference",
        kind="signal",
        params={
            "field": "value",
            "wave": "step",
            "offset": 0.0,
            "amplitude": 1.0,
            "delay": 0.0,
        },
    )
    error = scene.add_node(
        name="error",
        kind="sum",
        params={
            "field": "value",
            "output": "value",
            "weights": {"ref": 1.0, "feedback": 1.0},
        },
    )
    plant = scene.add_node(
        name="plant",
        kind="transfer_function",
        params={
            "form": "expr",
            "expr": "4/(s^2+1.2*s)",
            "method": "zoh",
            "field": "value",
            "output": "value",
        },
    )
    scene.add_edge(name="ref", source=source.id, target=error.id, kind="pass")
    scene.add_edge(name="forward", source=error.id, target=plant.id, kind="pass")
    feedback = scene.add_edge(
        name="feedback",
        source=plant.id,
        target=error.id,
        kind="scale",
        params={"gain": -1.0},
        auto_delay=True,
    )
    assert feedback.delay is True
    return scene, plant


def test_underdamped_closed_loop_step_has_expected_transient():
    scene, plant = _build_underdamped_scene()
    values: list[float] = []
    for _ in range(1200):
        scene.step(0.01)
        values.append(float(plant.data["value"]))

    assert values[0] == pytest.approx(0.0, abs=1e-12)
    assert values[-1] == pytest.approx(1.0, abs=0.01)
    peak = max(values)
    assert peak > 1.3
    overshoot = (peak - values[-1]) / values[-1] * 100.0
    # 连续理想 37.2%；显式 z^-1 反馈边实测约 39.18%，用窄区间锁定，
    # 避免把已知偏差用 30–45% 的宽区间固化成“合格”。
    assert 38.0 <= overshoot <= 40.5


def test_underdamped_precompute_converges_with_dt():
    """dt 减半后超调/终值应收敛，而不是只改时间标签。"""
    scene, _plant = _build_underdamped_scene()
    sim = Simulation(scene)
    try:
        report_fast = sim.precompute(12.0, dt=0.01)
        frames_fast = sim.live(0, 6000)["frames"]
        report_fine = sim.precompute(12.0, dt=0.002)
        frames_fine = sim.live(0, 6000)["frames"]
    finally:
        sim.shutdown()

    def metrics(frames):
        values = [frame["v"]["n:plant:value"] for frame in frames]
        final = sum(values[-max(3, len(values) // 10) :]) / max(3, len(values) // 10)
        peak = max(values)
        return peak, final, (peak - final) / abs(final) * 100.0

    peak_fast, final_fast, overshoot_fast = metrics(frames_fast)
    peak_fine, final_fine, overshoot_fine = metrics(frames_fine)
    assert report_fast["error"] is None and report_fine["error"] is None
    assert final_fast == pytest.approx(final_fine, abs=0.005)
    assert abs(overshoot_fast - overshoot_fine) < 2.5
    # 细步长收敛到连续理想 37.2% 附近；宽区间只用于粗步长的 z^-1 实现。
    assert 36.5 <= overshoot_fine <= 38.5


def test_control_project_roundtrip_is_openable(tmp_path):
    scene, _plant = _build_underdamped_scene()
    sim = Simulation(scene)
    try:
        path = tmp_path / "underdamped_control.netlab"
        save_project(path, sim, name="欠阻尼二阶控制", network_name="信号流")
        project = load_project(path)
    finally:
        sim.shutdown()

    assert project["format"] == "netlab-project"
    assert project["checksum"]
    network = project["networks"][0]
    assert network["scene"]["mode"] == "signal"
    assert any(
        node["kind"] == "transfer_function" for node in network["scene"]["nodes"]
    )
    assert any(edge["name"] == "feedback" for edge in network["scene"]["edges"])
