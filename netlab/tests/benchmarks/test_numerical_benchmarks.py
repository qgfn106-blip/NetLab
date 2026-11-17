"""A-4：可复现的数值基准与解析解回归。

这些测试只把求解器输出与闭式解比较，不依赖前端或 PlotKit。基准规模刻意
保持很小，CI 上是秒级回归；完整性能基准放在 ``netlab/tools``。
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from netlab.core.common.limits import ComputeError
from netlab.core.compute.nodal import StampContext
from netlab.core.compute.transistors import Mosfet
from netlab.core.model.scene import Scene
from netlab.core.model.templates import build_template


def _template_scene(name: str) -> Scene:
    payload = build_template(name)
    scene = Scene(payload.get("mode", "signal"))
    scene.load_payload(payload)
    return scene


def _node_voltage(scene: Scene, name: str) -> float:
    node = next(item for item in scene.nodes.values() if item.name == name)
    return float(node.data.get("voltage", 0.0))


def _rc_mid_voltage(step_dt: float, steps: int, integration: str = "trapezoidal") -> float:
    scene = _template_scene("rc_step")
    scene.integration = integration
    for _ in range(steps):
        scene.step(step_dt)
    return _node_voltage(scene, "mid")


def _convergence_order(integration: str, coarse_dt: float, coarse_steps: int) -> float:
    target = 5.0 * (1.0 - math.exp(-2.0))
    coarse = abs(_rc_mid_voltage(coarse_dt, coarse_steps, integration) - target)
    fine = abs(_rc_mid_voltage(coarse_dt / 2.0, coarse_steps * 2, integration) - target)
    assert coarse > 1.0e-7
    assert fine < coarse
    return math.log2(coarse / fine)


def test_rc_step_matches_analytic_solution() -> None:
    """RC 充电 4τ：v=5(1-e^-4)，与解析值误差 <0.01 V。"""
    value = _rc_mid_voltage(1.0e-5, 400)
    analytic = 5.0 * (1.0 - math.exp(-4.0))
    assert value == pytest.approx(analytic, abs=0.01)


def test_delayed_source_step_respects_event_time() -> None:
    """源在 t=1 ms 才跳变：0.5 ms 时仍为 0，2.5 ms 时按 τ=1 ms 充电。"""
    payload = build_template("rc_step")
    for edge in payload["edges"]:
        if edge["name"] == "V1":
            edge["params"]["delay"] = 1.0e-3
    scene = Scene(payload.get("mode", "circuit"))
    scene.load_payload(payload)
    for _ in range(50):
        scene.step(1.0e-5)
    assert _node_voltage(scene, "mid") == pytest.approx(0.0, abs=1.0e-9)
    for _ in range(200):
        stats = scene.step(1.0e-5)
        assert stats["status"] == "converged"
    analytic = 5.0 * (1.0 - math.exp(-1.5))
    assert _node_voltage(scene, "mid") == pytest.approx(analytic, abs=0.02)


def test_rc_step_trapezoidal_convergence_order() -> None:
    """步长减半时梯形法误差应二阶 O(dt²) 下降（p≈2；P3 修复前实测 1）。"""
    target = 5.0 * (1.0 - math.exp(-2.0))
    coarse = abs(_rc_mid_voltage(1.0e-5, 200) - target)
    fine = abs(_rc_mid_voltage(5.0e-6, 400) - target)
    assert coarse > 1.0e-6
    assert fine < coarse
    order = math.log2(coarse / fine)
    assert order == pytest.approx(2.0, abs=0.25)


def test_rc_transient_steady_state_matches_dc_operating_point() -> None:
    """瞬态跑到稳态后，节点电压必须与同一场景的 DC 工作点对拍。"""
    scene = _template_scene("rc_step")
    for _ in range(2000):
        scene.step(1.0e-5)
    transient = _node_voltage(scene, "mid")
    dc = float(scene.operating_point()["node_voltages"]["mid"])
    assert transient == pytest.approx(dc, abs=0.01)


def test_rc_ac_low_frequency_matches_dc_gain() -> None:
    """AC 扫频在极低频的幅值应回到 DC 工作点（同一线性化点）。"""
    scene = _template_scene("rc_step")
    result = scene.ac_sweep([1.0e-3])
    magnitude = float(result["probes"]["mid"]["magnitude"][0])
    dc = float(scene.operating_point()["node_voltages"]["mid"])
    assert magnitude * 5.0 == pytest.approx(dc, abs=0.01)


def test_rl_current_rise_matches_analytic_solution() -> None:
    """RL 一阶电路：i(t)=V/R(1-e^{-Rt/L})，10 ms 处误差 <2 mA。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    n1 = scene.add_node(name="n1", kind="node")
    n2 = scene.add_node(name="n2", kind="node")
    scene.add_edge(
        name="V1",
        source=n1.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 1.0, "amplitude": 0.0},
    )
    scene.add_edge(
        name="R1",
        source=n1.id,
        target=n2.id,
        kind="resistor",
        params={"R": 10.0},
    )
    scene.add_edge(
        name="L1",
        source=n2.id,
        target=gnd.id,
        kind="inductor",
        params={"L": 0.1},
    )
    for _ in range(1000):
        scene.step(1.0e-5)
    current = float(
        next(item for item in scene.edges.values() if item.name == "L1").state["current"]
    )
    analytic = (1.0 / 10.0) * (1.0 - math.exp(-10.0 * 0.01 / 0.1))
    assert current == pytest.approx(analytic, abs=2.0e-3)


def test_rlc_series_resonance_matches_analytic_transfer() -> None:
    """RLC 串联谐振：|H|=1、相位 -90°（L=0.01H，C=1e-4F，R=10Ω）。"""
    scene = _template_scene("rlc_series")
    f0 = 1.0 / (2.0 * math.pi * math.sqrt(0.01 * 1.0e-4))
    result = scene.ac_sweep([f0])
    out = result["probes"]["out"]
    assert float(out["magnitude"][0]) == pytest.approx(1.0, rel=1.0e-6)
    assert float(out["phase_deg"][0]) == pytest.approx(-90.0, abs=1.0e-5)


def test_mosfet_saturation_square_law_matches_analytic() -> None:
    """MOSFET 饱和区平方律：Id = k/2 (Vgs - Vth)^2（λ=γ=0）。"""
    mos = Mosfet(
        "M",
        "d",
        "s",
        {"k": 0.001, "Vth": 2.0, "gate_node": "g"},
        {},
    )
    mos.prepare(1.0e-4, 0.0)
    ctx = StampContext(
        A=np.zeros((4, 4)),
        rhs=np.zeros(4),
        index={"d": 0, "s": 1, "g": 2, "b": 3},
        solution=np.asarray([4.0, 0.0, 5.0, 0.0]),
        dt=1.0e-4,
        time=0.0,
        iteration=0,
    )
    current, gm, gds, _, vgs, vds, _ = mos._operating_point(ctx)
    assert vgs == pytest.approx(5.0)
    assert vds == pytest.approx(4.0)
    assert current == pytest.approx(0.5 * 0.001 * 9.0)
    assert gm == pytest.approx(0.001 * 3.0)
    assert gds == pytest.approx(0.0)


def test_rc_backward_euler_convergence_order() -> None:
    """BE 一阶：步长减半误差约减半（p≈1）。"""
    assert _convergence_order("backward_euler", 1.0e-5, 200) == pytest.approx(1.0, abs=0.2)


def test_rc_gear2_convergence_order() -> None:
    """Gear2 刚性多步法：多步长下呈二阶收敛（p≈2）。"""
    assert _convergence_order("gear2", 1.0e-5, 200) == pytest.approx(2.0, abs=0.3)


def test_solver_step_reports_convergence_diagnostics() -> None:
    """每次瞬态步都返回状态、步长、迭代数、后向残差和失败原因占位。"""
    scene = _template_scene("rc_step")
    stats = scene.step(1.0e-5)
    assert stats["status"] == "converged"
    assert stats["converged"] is True
    assert stats["dt"] == pytest.approx(1.0e-5)
    assert stats["time"] == pytest.approx(1.0e-5)
    assert stats["iterations"] >= 1
    assert stats["residual"] < 1.0e-6
    assert stats["failure"] is None


def test_solver_step_failure_exposes_failure_diagnostics(monkeypatch: pytest.MonkeyPatch) -> None:
    """Newton 不收敛时：抛 ComputeError，同时 last_failure 保留机器可读原因。"""
    scene = _template_scene("rc_step")
    engine = scene.ensure_engine()
    solver = engine.solver

    def fake_newton(dt, guess, *, mode="tran", deadline=None):
        return guess.copy(), 4, False, 0.25, ["gmin stepping"]

    monkeypatch.setattr(solver, "_newton_with_strategies", fake_newton)
    with pytest.raises(ComputeError):
        scene.step(1.0e-5)
    failure = solver.last_failure
    assert solver.last_status == "failed"
    assert failure["status"] == "failed"
    assert failure["reason"] == "newton_nonconvergence"
    assert failure["iterations"] == 4
    assert failure["residual"] == pytest.approx(0.25)
    assert failure["strategies"] == ["gmin stepping"]


def test_rlc_series_satisfies_kcl_kvl_and_state_equations() -> None:
    """RLC 串联：逐器件 KCL/KVL、C dv/dt 与 L di/dt 状态方程同时成立。"""
    scene = _template_scene("rlc_series")
    dt = 1.0e-5
    for _ in range(200):
        scene.step(dt)

    def sample():
        edges = {item.name: item for item in scene.edges.values()}
        nodes = {item.name: item for item in scene.nodes.values()}
        return {
            "i_v": float(edges["V1"].state["current"]),
            "i_r": float(edges["R1"].state["current"]),
            "i_l": float(edges["L1"].state["current"]),
            "i_c": float(edges["C1"].state["current"]),
            "v_src": float(nodes["src"].data.get("voltage", 0.0)),
            "v_mid": float(nodes["mid"].data.get("voltage", 0.0)),
            "v_out": float(nodes["out"].data.get("voltage", 0.0)),
            "v_r": float(edges["R1"].state["voltage_difference"]),
            "v_l": float(edges["L1"].state["voltage_difference"]),
            "v_c": float(edges["C1"].state["voltage_difference"]),
        }

    before = sample()
    scene.step(dt)
    after = sample()
    # KCL：串联回路电流大小相等；电源按吸收惯例电流为负。
    assert abs(after["i_v"]) == pytest.approx(after["i_r"], abs=1.0e-9)
    for key in ("i_l", "i_c"):
        assert after[key] == pytest.approx(after["i_r"], abs=1.0e-9)
    # KVL：源电压 = 各无源器件压降之和。
    assert before["v_r"] + before["v_l"] + before["v_c"] == pytest.approx(before["v_src"], abs=1.0e-9)
    assert before["v_src"] - before["v_mid"] == pytest.approx(before["v_r"], abs=1.0e-9)
    assert before["v_mid"] - before["v_out"] == pytest.approx(before["v_l"], abs=1.0e-9)
    assert before["v_out"] == pytest.approx(before["v_c"], abs=1.0e-9)
    # 状态方程：i_C = C dv_C/dt；v_L = L di_L/dt。
    cap_residual = after["i_c"] - 100.0e-6 * (after["v_out"] - before["v_out"]) / dt
    ind_residual = after["v_l"] - 0.01 * (after["i_l"] - before["i_l"]) / dt
    assert cap_residual == pytest.approx(0.0, abs=2.0e-3)
    assert ind_residual == pytest.approx(0.0, abs=3.0e-3)


def test_rlc_series_matches_scipy_dop853_reference() -> None:
    """RLC 瞬态在 2 ms 处与 SciPy DOP853 状态方程参考解的误差 < 3 mV。"""
    from scipy.integrate import solve_ivp

    scene = _template_scene("rlc_series")
    dt = 1.0e-5
    for _ in range(200):
        scene.step(dt)
    simulated = _node_voltage(scene, "out")

    resistance, inductance, capacitance = 10.0, 0.01, 100.0e-6
    amplitude, frequency = 1.0, 50.0

    def rhs(time_value, state):
        current, capacitor_voltage = state
        source = amplitude * math.sin(2.0 * math.pi * frequency * time_value)
        return [
            (source - resistance * current - capacitor_voltage) / inductance,
            current / capacitance,
        ]

    solution = solve_ivp(
        rhs,
        [0.0, dt * 200],
        [0.0, 0.0],
        method="DOP853",
        rtol=1.0e-10,
        atol=1.0e-12,
        t_eval=[dt * 200],
    )
    assert solution.success
    assert simulated == pytest.approx(float(solution.y[1, 0]), abs=3.0e-3)


def test_diode_rectifier_nonlinear_transient_converges() -> None:
    """二极管整流（非线性器件族）在源跳变后每步收敛，输出电容电压为正且有限。"""
    scene = _template_scene("diode_rectifier")
    for _ in range(1000):
        stats = scene.step(1.0e-5)
        assert stats["status"] == "converged"
        assert stats["failure"] is None
    output = _node_voltage(scene, "out")
    assert math.isfinite(output)
    assert output > 0.0


def test_ill_conditioned_resistive_divider_stays_converged() -> None:
    """病态分压（R1=1 mΩ、R2=1 TΩ，电导比 1e15）仍收敛且残差受控。"""
    scene = Scene("circuit")
    ground = scene.add_node(name="gnd", kind="ground")
    source = scene.add_node(name="src", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(name="V1", source=source.id, target=ground.id, kind="vsource",
                   params={"wave": "dc", "offset": 1.0})
    scene.add_edge(name="R1", source=source.id, target=out.id, kind="resistor",
                   params={"R": 1.0e-3})
    scene.add_edge(name="R2", source=out.id, target=ground.id, kind="resistor",
                   params={"R": 1.0e12})
    for _ in range(5):
        stats = scene.step(1.0e-3)
        assert stats["status"] == "converged"
        assert stats["failure"] is None
        assert math.isfinite(stats["residual"])
        assert stats["residual"] < 1.0e-6
    voltage = _node_voltage(scene, "out")
    assert voltage == pytest.approx(1.0, abs=1.0e-6)


def test_stiff_rc_large_timestep_stays_stable() -> None:
    """τ=1 ns 的刚性 RC 在 dt=1 µs 下仍收敛，不产生 NaN/发散。"""
    scene = Scene("circuit")
    ground = scene.add_node(name="gnd", kind="ground")
    source = scene.add_node(name="src", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(name="V1", source=source.id, target=ground.id, kind="vsource",
                   params={"wave": "step", "offset": 0.0, "amplitude": 1.0})
    scene.add_edge(name="R1", source=source.id, target=out.id, kind="resistor",
                   params={"R": 1.0})
    scene.add_edge(name="C1", source=out.id, target=ground.id, kind="capacitor",
                   params={"C": 1.0e-9, "v0": 0.0})
    for _ in range(20):
        stats = scene.step(1.0e-6)
        assert stats["status"] == "converged"
    voltage = _node_voltage(scene, "out")
    assert math.isfinite(voltage)
    assert voltage == pytest.approx(1.0, abs=0.01)
