"""补充覆盖批次B 已知缺口：预计算【取消路径】就地恢复同一 Engine 与字段。

（CircuitEngine / BlockRuntime 的就地恢复需真实电路/功能块夹具，见交付报告未覆盖风险说明。）
"""

from __future__ import annotations

from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene


def _make_signal_sim() -> Simulation:
    scene = Scene("signal")
    scene.add_node(name="a", kind="manual", data={"voltage": 1.0})
    sim = Simulation(scene)
    sim.apply_config({"fps": 30, "dt": 0.01, "steps_per_frame": 1, "sample_every": 1})
    return sim


def test_precompute_cancel_restores_same_engine_and_fields():
    sim = _make_signal_sim()
    engine_before = sim.scene.ensure_engine()
    sim._frame_times.extend([0.0, 0.1])
    sim._last_sample_time = 0.1
    before_frames = list(sim._frame_times)

    def fake_advance(dt, sample):
        # 第一次推进后置位取消标志，令下一轮 for 顶部捕获 cancelled=True
        sim._precompute_cancel.set()
        return True

    sim._advance_locked = fake_advance  # type: ignore[assignment]
    sim.precompute(duration=0.1, dt=0.01, sample_every=1)

    assert sim.error is None, "取消不应记为 error"
    assert sim.scene.ensure_engine() is engine_before, "取消回滚后必须是同一 Engine"
    assert list(sim._frame_times) == before_frames, "_frame_times 应恢复"
    assert sim._last_sample_time == 0.1, "_last_sample_time 应恢复"
