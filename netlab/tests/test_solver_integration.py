"""Gear2 / BDF2 积分与固定步长回退规则。"""

from __future__ import annotations

import math

import pytest

from netlab.core.compute.nodal import Capacitor, Inductor, integration_methods
from netlab.core.model.scene import Scene


def _rc_discharge() -> Scene:
    """R=1kΩ、C=1µF，v0=5 V 的自由放电（τ=1 ms）。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    n1 = scene.add_node(name="n1", kind="node")
    scene.add_edge(name="C1", source=n1.id, target=gnd.id, kind="capacitor",
                   params={"C": 1.0e-6, "v0": 5.0})
    scene.add_edge(name="R1", source=n1.id, target=gnd.id, kind="resistor",
                   params={"R": 1000.0})
    return scene


def _rl_charge() -> Scene:
    """V=5 V、R=100Ω、L=1 mH 串联（τ=10 µs）。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    n1 = scene.add_node(name="n1", kind="node")
    n2 = scene.add_node(name="n2", kind="node")
    scene.add_edge(name="V1", source=n1.id, target=gnd.id, kind="vsource",
                   params={"wave": "dc", "offset": 5.0, "amplitude": 0.0})
    scene.add_edge(name="R1", source=n1.id, target=n2.id, kind="resistor",
                   params={"R": 100.0})
    scene.add_edge(name="L1", source=n2.id, target=gnd.id, kind="inductor",
                   params={"L": 1.0e-3})
    return scene


def _run(scene: Scene, steps: int, dt: float, integration: str) -> None:
    """直接驱动电路引擎，避免 Simulation 的默认 dt 干扰积分测试。"""
    scene.set_integration(integration)
    engine = scene.ensure_engine()
    for _ in range(steps):
        engine.step(dt)


def _node_voltage(scene: Scene, name: str) -> float:
    for record in scene.nodes.values():
        if record.name == name:
            return float(record.data.get("voltage", 0.0))
    raise KeyError(name)


def test_integration_methods_include_gear2():
    values = {item["value"] for item in integration_methods()}
    assert {"trapezoidal", "backward_euler", "gear2"} <= values
    scene = _rc_discharge()
    scene.set_integration("gear2")
    assert scene.integration == "gear2"
    assert scene.runtime_state()["integration"] == "gear2"


def test_gear2_more_accurate_than_backward_euler():
    dt = 1.0e-4
    steps = 10
    exact = 5.0 * math.exp(-(dt * steps) / 1.0e-3)
    scene = _rc_discharge()
    _run(scene, steps, dt, "gear2")
    gear2 = _node_voltage(scene, "n1")
    scene = _rc_discharge()
    _run(scene, steps, dt, "backward_euler")
    be = _node_voltage(scene, "n1")
    assert abs(gear2 - exact) < abs(be - exact)
    assert gear2 == pytest.approx(exact, rel=1.0e-2)


def test_gear2_first_step_falls_back_to_backward_euler():
    dt = 1.0e-4
    scene = _rc_discharge()
    _run(scene, 1, dt, "gear2")
    gear2 = _node_voltage(scene, "n1")
    scene = _rc_discharge()
    _run(scene, 1, dt, "backward_euler")
    be = _node_voltage(scene, "n1")
    assert gear2 == pytest.approx(be, rel=1e-12)
    # BE 单步：v = v0/(1 + dt/RC) = 5/1.1。
    assert be == pytest.approx(5.0 / 1.1, rel=1e-9)


def test_gear2_dt_change_resets_history():
    """dt 变化后第一步必须退回 BE，避免旧历史配新步长。"""
    scene = _rc_discharge()
    _run(scene, 3, 1.0e-4, "gear2")
    before = _node_voltage(scene, "n1")
    scene.ensure_engine().step(1.0e-5)
    after = _node_voltage(scene, "n1")
    expected = before / (1.0 + (1.0e-5 / 1.0e-3))
    assert after == pytest.approx(expected, rel=1e-9)


def test_gear2_capacitor_history_rolls():
    scene = _rc_discharge()
    _run(scene, 3, 1.0e-4, "gear2")
    solver = scene.ensure_engine().solver
    capacitor = next(
        element for element in solver.elements if isinstance(element, Capacitor)
    )
    current = _node_voltage(scene, "n1")
    # 滚动历史：v_prev 是上一步电压，仍高于当前电压（自由放电单调下降）。
    assert 0.0 < current < capacitor.state["v_prev"]
    assert capacitor.state["gear_dt"] == pytest.approx(1.0e-4)


def test_gear2_rl_inductor_current():
    dt = 1.0e-6
    steps = 10
    tau = 1.0e-3 / 100.0
    exact = 5.0 / 100.0 * (1.0 - math.exp(-(dt * steps) / tau))
    scene = _rl_charge()
    _run(scene, steps, dt, "gear2")
    gear2 = _node_voltage(scene, "n2")
    inductor = next(
        element for element in scene.ensure_engine().solver.elements
        if isinstance(element, Inductor)
    )
    current = inductor.state["i"]
    assert current == pytest.approx(exact, rel=2.0e-2)
    scene = _rl_charge()
    _run(scene, steps, dt, "backward_euler")
    be = _node_voltage(scene, "n2")
    assert abs(current - exact) <= abs(be - exact) + 1e-12
    assert gear2 == pytest.approx(5.0 - 100.0 * current, rel=1e-6)
