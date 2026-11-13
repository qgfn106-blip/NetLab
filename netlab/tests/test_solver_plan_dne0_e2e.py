"""补测：solver_plan 的 D≠0（多级延迟）路径与 integrator/transfer_function 端到端数值序列等价。

- 多级延迟链：两条 delay 边的串联，输出序列应等于输入序列的确定性移位（与手算参考对比）。
- 延迟链的 solver_plan：无同拍代数环，各节点独立 stage（不误判 algebraic）。
- transfer_function 积分器（1/s）：常值输入下输出应为斜率 = dt 的线性斜坡（与独立参考 k*dt 对比）。
"""

from __future__ import annotations

import pytest

from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene


def _delay_chain_sim():
    scene = Scene("signal")
    src = scene.add_node(name="src", kind="manual", data={"value": 0.0})
    a = scene.add_node(name="a", kind="gain", params={"gain": 1.0})
    b = scene.add_node(name="b", kind="gain", params={"gain": 1.0})
    out = scene.add_node(name="out", kind="gain", params={"gain": 1.0})
    scene.add_edge(source=src.id, target=a.id, kind="pass", delay=True)
    scene.add_edge(source=a.id, target=b.id, kind="pass", delay=True)
    scene.add_edge(source=b.id, target=out.id, kind="pass")
    sim = Simulation(scene)
    sim.apply_config({"fps": 100, "dt": 0.01, "steps_per_frame": 1})
    return sim, src, out


def test_multilevel_delay_sequence_matches_reference() -> None:
    sim, src, out = _delay_chain_sim()
    seq = []
    for k in range(6):
        src.data["value"] = float(k)
        sim.step_once(1)
        seq.append(out.data.get("value"))
    # 两条 delay 串联：手算参考序列
    assert seq == pytest.approx([0.0, 0.0, 1.0, 2.0, 3.0, 4.0], abs=1e-12)


def test_delayed_chain_plan_has_no_algebraic_stage() -> None:
    sim, _src, _out = _delay_chain_sim()
    plan = sim.scene.ensure_engine().network.solver_plan()
    # 4 个节点各自独立 stage，delay 边不引入同拍代数依赖
    assert len(plan.stages) == 4
    assert all(stage.algebraic is False for stage in plan.stages)
    assert len(plan.algebraic) == 0


def test_transfer_function_integrator_matches_reference_ramp() -> None:
    scene = Scene("signal")
    u = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    plant = scene.add_node(
        name="plant", kind="transfer_function", params={"form": "expr", "expr": "1/s"}
    )
    scene.add_edge(source=u.id, target=plant.id, kind="pass")
    sim = Simulation(scene)
    dt = 0.01
    sim.apply_config({"fps": 100, "dt": dt, "steps_per_frame": 1})
    seq = []
    for _ in range(6):
        sim.step_once(1)
        seq.append(plant.data.get("value"))
    # 独立参考：常值 1 输入经积分器 → k*dt 线性斜坡
    reference = [k * dt for k in range(6)]
    assert seq == pytest.approx(reference, abs=1e-9)
    diffs = [seq[i] - seq[i - 1] for i in range(1, len(seq))]
    assert all(d == pytest.approx(dt, abs=1e-12) for d in diffs)
