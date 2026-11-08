"""A-4：可复现的数值基准与解析解回归。

这些测试只把求解器输出与闭式解比较，不依赖前端或 PlotKit。基准规模刻意
保持很小，CI 上是秒级回归；完整性能基准放在 ``netlab/tools``。
"""

from __future__ import annotations

import math

import numpy as np
import pytest

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


def _rc_mid_voltage(step_dt: float, steps: int) -> float:
    scene = _template_scene("rc_step")
    for _ in range(steps):
        scene.step(step_dt)
    return _node_voltage(scene, "mid")


def test_rc_step_matches_analytic_solution() -> None:
    """RC 充电 4τ：v=5(1-e^-4)，与解析值误差 <0.01 V。"""
    value = _rc_mid_voltage(1.0e-5, 400)
    analytic = 5.0 * (1.0 - math.exp(-4.0))
    assert value == pytest.approx(analytic, abs=0.01)


def test_rc_step_backward_euler_convergence_order() -> None:
    """步长减半时后向欧拉误差应按一阶 O(dt) 下降（p≈1）。"""
    target = 5.0 * (1.0 - math.exp(-2.0))
    coarse = abs(_rc_mid_voltage(1.0e-5, 200) - target)
    fine = abs(_rc_mid_voltage(5.0e-6, 400) - target)
    assert coarse > 1.0e-6
    assert fine < coarse
    order = math.log2(coarse / fine)
    assert order == pytest.approx(1.0, abs=0.35)


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
