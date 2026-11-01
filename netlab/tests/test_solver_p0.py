"""P0：可调收敛参数与奇异诊断。"""

from __future__ import annotations

import copy
import time

import numpy as np
import pytest

from netlab.limits import ComputeError
from netlab.nodal import SolverOptions
from netlab.scene import Scene
from netlab.simulation import Simulation


def _diode_scene() -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    n1 = scene.add_node(name="n1", kind="node")
    scene.add_edge(name="V1", source=n1.id, target=gnd.id, kind="vsource",
                   params={"wave": "dc", "offset": 5.0, "amplitude": 0.0})
    scene.add_edge(name="R1", source=n1.id, target=gnd.id, kind="resistor",
                   params={"R": 1000.0})
    scene.add_edge(name="D1", source=n1.id, target=gnd.id, kind="diode",
                   params={"Is": 1e-12, "n": 1.0, "temperature": 300.15})
    return scene


def _divided_scene() -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    n1 = scene.add_node(name="n1", kind="node")
    n2 = scene.add_node(name="n2", kind="node")
    scene.add_edge(name="V1", source=n1.id, target=gnd.id, kind="vsource",
                   params={"wave": "dc", "offset": 1.0, "amplitude": 0.0})
    scene.add_edge(name="R1", source=n1.id, target=n2.id, kind="resistor",
                   params={"R": 1.0e3})
    scene.add_edge(name="R2", source=n2.id, target=gnd.id, kind="resistor",
                   params={"R": 1.0e6})
    return scene


def test_solver_options_follow_sim_config():
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    n1 = scene.add_node(name="n1", kind="node")
    scene.add_edge(name="V1", source=n1.id, target=gnd.id, kind="vsource",
                   params={"wave": "dc", "offset": 1.0, "amplitude": 0.0})
    sim = Simulation(scene)
    sim.apply_config({"reltol": 1e-7, "vntol": 1e-5, "abstol": 1e-8,
                      "max_iter": 123, "gmin_steps": 4, "residual_tol": 1e-4})
    solver = sim.scene.ensure_engine().solver
    assert solver.options.reltol == 1e-7
    assert solver.options.vntol == 1e-5
    assert solver.options.abstol == 1e-8
    assert solver.options.max_iter == 123
    assert solver.options.gmin_steps == 4
    assert solver.options.residual_tol == 1e-4


def test_default_gmin_stepping_starts_at_legacy_value():
    """默认 gmin 救急须从旧的 1e-3 起步，否则 stepping 等于没跑。"""
    scene = _diode_scene()
    solver = scene.ensure_engine().solver
    assert solver.options.gmin == pytest.approx(1.0e-3)
    assert solver.options.gmin_steps > 0


def test_singular_matrix_reports_node():
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    n1 = scene.add_node(name="n1", kind="node")
    for name in ("V1", "V2"):
        scene.add_edge(name=name, source=n1.id, target=gnd.id, kind="vsource",
                       params={"wave": "dc", "offset": 5.0, "amplitude": 0.0})
    with pytest.raises(ComputeError) as error:
        scene.step(1e-4)
    message = str(error.value)
    assert "奇异" in message or "零主元" in message
    assert "节点" in message or "支路" in message


def test_next_breakpoint_square_and_pulse():
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    n1 = scene.add_node(name="n1", kind="node")
    scene.add_edge(name="V1", source=n1.id, target=gnd.id, kind="vsource",
                   params={"wave": "square", "offset": 0.0, "amplitude": 1.0,
                           "frequency": 1000.0, "duty": 0.5, "delay": 0.0})
    assert scene.next_breakpoint(0.0, 0.001) == pytest.approx(0.0005)
    assert scene.next_breakpoint(0.0006, 0.001) == pytest.approx(0.001)


def test_precompute_fills_recorder_from_zero():
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    n1 = scene.add_node(name="n1", kind="node")
    scene.add_edge(name="V1", source=n1.id, target=gnd.id, kind="vsource",
                   params={"wave": "dc", "offset": 5.0, "amplitude": 0.0})
    scene.sync_probes = None
    sim = Simulation(scene)
    result = sim.precompute(0.001, 1e-4, 1)
    assert result["steps"] == 10
    assert result["frames"] == 10
    assert abs(result["time"] - 0.001) < 1e-9


def test_failed_step_restores_solver_and_element_state(monkeypatch):
    scene = _diode_scene()
    scene.step(1e-4)
    solver = scene.ensure_engine().solver
    diode = next(e for e in solver.elements if e.kind == "diode")
    before_time = solver.time
    before_solution = solver.solution.copy()
    before_voltage = dict(solver.node_voltages)
    before_state = copy.deepcopy(diode.state)
    before_result = copy.deepcopy(diode.result)

    def fail(*_args, **_kwargs):
        raise ComputeError("forced failure")

    monkeypatch.setattr(solver, "_newton_solve", fail)
    with pytest.raises(ComputeError):
        scene.step(1e-4)

    assert solver.time == pytest.approx(before_time)
    assert np.array_equal(solver.solution, before_solution)
    for key, value in before_voltage.items():
        assert solver.node_voltages[key] == pytest.approx(value)
    assert diode.state == before_state
    assert diode.result == before_result


def _diode_series_scene() -> Scene:
    """5V 经 1k 限流后接二极管，避免并联直挂源的指数溢出。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    n1 = scene.add_node(name="n1", kind="node")
    n2 = scene.add_node(name="n2", kind="node")
    scene.add_edge(name="V1", source=n1.id, target=gnd.id, kind="vsource",
                   params={"wave": "dc", "offset": 5.0, "amplitude": 0.0})
    scene.add_edge(name="R1", source=n1.id, target=n2.id, kind="resistor",
                   params={"R": 1000.0})
    scene.add_edge(name="D1", source=n2.id, target=gnd.id, kind="diode",
                   params={"Is": 1e-12, "n": 1.0, "temperature": 300.15})
    return scene


def test_failed_step_then_retry_matches_clean_run(monkeypatch):
    """失败步回滚后重跑，必须与从未失败过的干净运行一致。"""
    clean = _diode_series_scene()
    retried = _diode_series_scene()

    def advance(scene, steps):
        for _ in range(steps):
            scene.step(1e-5)

    advance(clean, 4)
    advance(retried, 1)
    solver = retried.ensure_engine().solver
    original = solver._newton_solve
    state = {"fail": True}

    def flaky(*args, **kwargs):
        if state["fail"]:
            state["fail"] = False
            raise ComputeError("forced failure")
        return original(*args, **kwargs)

    monkeypatch.setattr(solver, "_newton_solve", flaky)
    with pytest.raises(ComputeError):
        retried.step(1e-5)
    advance(retried, 3)

    clean_engine = clean.ensure_engine()
    retried_engine = retried.ensure_engine()
    # 两个场景的节点 id 随机，按探针名（含节点名）比较，避免未知量排序差异干扰。
    assert retried_engine.solver.time == pytest.approx(clean_engine.solver.time)
    clean_probes = clean_engine.probes()
    retried_probes = retried_engine.probes()
    assert retried_probes.keys() == clean_probes.keys()
    for key, value in clean_probes.items():
        assert retried_probes[key] == pytest.approx(value, rel=1e-9, abs=1e-12)


def test_linear_solution_quality_check(monkeypatch):
    """线性电路也要拒绝明显错误的解，并把时间回滚。"""
    scene = _divided_scene()
    solver = scene.ensure_engine().solver
    monkeypatch.setattr(
        solver, "_solve_matrix", lambda _matrix, rhs, _dt: np.zeros(len(rhs))
    )
    with pytest.raises(ComputeError) as error:
        scene.step(1e-4)
    assert "解质量" in str(error.value)
    assert solver.time == pytest.approx(0.0)


def test_source_scale_restored_after_solver_exception(monkeypatch):
    scene = _divided_scene()
    solver = scene.ensure_engine().solver
    source = next(e for e in solver.elements if e.kind == "vsource")

    def fail(*_args, **_kwargs):
        raise ComputeError("forced matrix failure")

    monkeypatch.setattr(solver, "_solve_matrix", fail)
    with pytest.raises(ComputeError):
        scene.step(1e-4)
    assert source.source_scale == pytest.approx(1.0)


def test_gmin_start_value_comes_from_options(monkeypatch):
    scene = _diode_scene()
    scene.set_solver_options(
        SolverOptions(gmin=0.5, gmin_steps=2, src_steps=0, max_iter=2)
    )
    solver = scene.ensure_engine().solver
    seen: list[float] = []

    def fake_newton(_dt, gmin, initial, source_scale=1.0, *, mode="tran"):
        seen.append(float(gmin))
        return np.zeros(solver.matrix_size), 1, False, 1.0

    monkeypatch.setattr(solver, "_newton_solve", fake_newton)
    with pytest.raises(ComputeError):
        scene.step(1e-4)
    assert any(abs(value - 0.5) < 1e-12 for value in seen)
    assert any(abs(value - 0.05) < 1e-12 for value in seen)


def test_matrix_scaling_preserves_solution():
    results = []
    for scaling in (True, False):
        scene = _divided_scene()
        scene.set_solver_options(SolverOptions(scaling=scaling))
        scene.step(1e-4)
        solver = scene.ensure_engine().solver
        n2 = next(n for n in scene.nodes.values() if n.name == "n2")
        results.append((float(solver.node_voltages[n2.id]), solver.last_scaled))
    assert results[0][1] is True
    assert results[1][1] is False
    assert results[0][0] == pytest.approx(results[1][0], rel=1e-9, abs=1e-12)
    assert results[0][0] == pytest.approx(1.0e6 / (1.0e6 + 1.0e3), rel=1e-9)


def test_next_breakpoint_includes_device_source():
    scene = Scene("circuit")
    scene.add_node(
        name="V1",
        kind="device",
        params={
            "element": "vsource",
            "wave": "square",
            "offset": 0.0,
            "amplitude": 1.0,
            "frequency": 1000.0,
            "duty": 0.5,
            "delay": 0.0,
        },
    )
    assert scene.next_breakpoint(0.0, 0.001) == pytest.approx(0.0005)


def test_timeout_restores_scene_checkpoint(monkeypatch):
    scene = _divided_scene()
    sim = Simulation(scene)
    sim.apply_config({"step_timeout_ms": 1.0})
    solver = scene.ensure_engine().solver
    original_step = scene.step

    def slow_step(dt):
        time.sleep(0.01)
        return original_step(dt)

    monkeypatch.setattr(scene, "step", slow_step)
    assert sim._advance_locked(1e-4, 1) is False
    assert sim.time == pytest.approx(0.0)
    assert solver.time == pytest.approx(0.0)
    assert "超时" in (sim.error or "")
