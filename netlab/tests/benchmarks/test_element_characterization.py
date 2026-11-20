"""WP-6：R/L/C、二极管与受控源的 stamp/初值/限幅特性回归。

这些测试从元件级最小电路直接驱动 CircuitSolver.operating_point，补充
数值基准里的系统级解析解回归；重点锁定直流初值语义（C 开路、L 短路）、
二极管指数限幅和受控源增益符号。
"""

from __future__ import annotations

import math

import pytest

from netlab.core.common.limits import ComputeError
from netlab.core.compute.circuit.elements import (
    Capacitor,
    Diode,
    Inductor,
    Resistor,
    Switch,
    VCCS,
    VCVS,
    VoltageSource,
)
from netlab.core.compute.circuit.solver import CircuitSolver
from netlab.core.compute.circuit.stamps import CircuitNode


def _solve(element_specs: list[tuple[str, object]], *, node_names: list[str]) -> dict[str, object]:
    nodes = [CircuitNode(id=name, name=name, ground=name == "gnd") for name in node_names]
    elements = []
    for name, spec in element_specs:
        kind = spec[0]
        kwargs = spec[1]
        elements.append(kind(name=name, **kwargs))
    solver = CircuitSolver(nodes, elements)
    return solver.operating_point()


def _vsource(a: str, b: str, value: float = 1.0) -> dict[str, object]:
    return {"a": a, "b": b, "params": {"wave": "dc", "offset": value}, "state": {}}


def test_resistor_dc_divider_and_operating_point() -> None:
    op = _solve(
        [
            ("V1", (VoltageSource, _vsource("in", "gnd", 5.0))),
            ("R1", (Resistor, {"a": "in", "b": "out", "params": {"R": 1000.0}, "state": {}})),
            ("R2", (Resistor, {"a": "out", "b": "gnd", "params": {"R": 1000.0}, "state": {}})),
        ],
        node_names=["gnd", "in", "out"],
    )
    assert op["node_voltages"]["in"] == pytest.approx(5.0)
    assert op["node_voltages"]["out"] == pytest.approx(2.5)
    assert op["elements"]["R1"]["current"] == pytest.approx(2.5e-3)
    assert op["elements"]["R2"]["current"] == pytest.approx(2.5e-3)


def test_capacitor_is_open_and_inductor_is_short_in_dc_operating_point() -> None:
    capacitor = _solve(
        [
            ("V1", (VoltageSource, _vsource("in", "gnd", 5.0))),
            ("R1", (Resistor, {"a": "in", "b": "out", "params": {"R": 1000.0}, "state": {}})),
            ("C1", (Capacitor, {"a": "out", "b": "gnd", "params": {"C": 1e-6, "v0": 2.0}, "state": {}})),
        ],
        node_names=["gnd", "in", "out"],
    )
    assert capacitor["node_voltages"]["out"] == pytest.approx(5.0)
    assert capacitor["elements"]["C1"]["current"] == pytest.approx(0.0)

    inductor = _solve(
        [
            ("V1", (VoltageSource, _vsource("in", "gnd", 5.0))),
            ("R1", (Resistor, {"a": "in", "b": "out", "params": {"R": 1000.0}, "state": {}})),
            ("L1", (Inductor, {"a": "out", "b": "gnd", "params": {"L": 0.01}, "state": {}})),
        ],
        node_names=["gnd", "in", "out"],
    )
    assert inductor["node_voltages"]["out"] == pytest.approx(0.0, abs=1e-6)
    assert inductor["elements"]["L1"]["current"] == pytest.approx(5e-3, rel=1e-5)


def test_diode_forward_bias_and_exponential_limit() -> None:
    op = _solve(
        [
            ("V1", (VoltageSource, _vsource("in", "gnd", 1.0))),
            ("R1", (Resistor, {"a": "in", "b": "out", "params": {"R": 1000.0}, "state": {}})),
            (
                "D1",
                (
                    Diode,
                    {
                        "a": "out",
                        "b": "gnd",
                        "params": {"Is": 1e-12, "n": 1.0, "temperature": 300.0},
                        "state": {},
                    },
                ),
            ),
        ],
        node_names=["gnd", "in", "out"],
    )
    diode_voltage = op["node_voltages"]["out"]
    assert 0.2 < diode_voltage < 0.75
    assert op["elements"]["D1"]["current"] > 1e-4

    diode = Diode(
        name="Dcheck",
        a="out",
        b="gnd",
        params={"Is": 1e-12, "n": 1.0, "temperature": 300.0},
        state={},
    )
    low = diode._conductance(2.0)[1]
    high = diode._conductance(60.0 * diode.thermal)[1]
    assert low == pytest.approx(high)
    assert math.isfinite(low)
    assert diode._conductance(0.0)[0] == pytest.approx(0.0)


def test_diode_dc_operating_point_satisfies_kcl_small_saturation_current() -> None:
    """审计 §3.3 回归：小 Is + 高压必须收敛到真解且满足 KCL，不得出现假收敛。

    旧实现以有限幅切残差当收敛证据，Is=1e-14、Vs=2V 时会在 Vout≈2V（漏电几乎为 0）
    处伪收敛，二极管电流与环境电流差 ~1e12 A，严重违反 KCL。
    """
    op = _solve(
        [
            ("V1", (VoltageSource, _vsource("in", "gnd", 2.0))),
            ("R1", (Resistor, {"a": "in", "b": "out", "params": {"R": 1000.0}, "state": {}})),
            (
                "D1",
                (
                    Diode,
                    {
                        "a": "out",
                        "b": "gnd",
                        "params": {"Is": 1e-14, "n": 1.0, "temperature": 300.0},
                        "state": {},
                    },
                ),
            ),
        ],
        node_names=["gnd", "in", "out"],
    )
    vout = op["node_voltages"]["out"]
    i_diode = op["elements"]["D1"]["current"]
    i_resistor = op["elements"]["R1"]["current"]
    # 解析解 Vout≈0.6623 V，I≈1.3377 mA（Is=1e-14, R=1k, Vs=2V）
    assert vout == pytest.approx(0.6623, abs=5e-3)
    assert i_diode == pytest.approx(1.3377e-3, rel=5e-2)
    # KCL：流过电阻的电流必须等于二极管电流，不允许假收敛
    assert i_diode == pytest.approx(i_resistor, rel=1e-6, abs=1e-9)
    assert abs(i_diode - i_resistor) < 1e-6


def test_capacitor_and_inductor_initial_conditions_and_gear2_first_step() -> None:
    capacitor = Capacitor(
        name="Cinit",
        a="a",
        b="gnd",
        params={"C": 1e-6, "v0": 2.0},
        state={},
        integration="gear2",
    )
    assert capacitor.state["v"] == pytest.approx(2.0)
    capacitor.prepare(1e-4, 0.0)
    assert capacitor._gear_ready is False
    assert capacitor.conductance == pytest.approx(1e-6 / 1e-4)
    capacitor.reset()
    assert capacitor.state["v"] == pytest.approx(2.0)
    assert "v_prev" not in capacitor.state

    inductor = Inductor(
        name="Linit",
        a="a",
        b="gnd",
        params={"L": 1e-3, "initial": 0.25},
        state={},
        integration="gear2",
    )
    assert inductor.state["i"] == pytest.approx(0.25)
    inductor.prepare(1e-4, 0.0)
    assert inductor._gear_ready is False
    assert inductor.conductance == pytest.approx(1e-4 / 1e-3)
    inductor.reset()
    assert inductor.state["i"] == pytest.approx(0.25)
    assert "i_prev" not in inductor.state


def test_switch_conductance_uses_closed_state_and_rejects_invalid_resistance() -> None:
    closed = Switch(
        name="S1",
        a="a",
        b="b",
        params={"closed": True, "ron": 0.5, "roff": 1e9},
        state={},
    )
    opened = Switch(
        name="S2",
        a="a",
        b="b",
        params={"closed": False, "ron": 0.5, "roff": 1e9},
        state={},
    )
    assert closed.conductance == pytest.approx(2.0)
    assert opened.conductance == pytest.approx(1e-9)
    with pytest.raises(ComputeError):
        Switch(name="S3", a="a", b="b", params={"closed": True, "ron": 0.0, "roff": 1e9}, state={})


def test_vcvs_scales_control_voltage() -> None:
    op = _solve(
        [
            ("V1", (VoltageSource, _vsource("in", "gnd", 1.0))),
            (
                "E1",
                (
                    VCVS,
                    {
                        "a": "out",
                        "b": "gnd",
                        "params": {"gain": 2.0, "control_source": "in", "control_target": "gnd"},
                        "state": {},
                    },
                ),
            ),
            ("R1", (Resistor, {"a": "out", "b": "gnd", "params": {"R": 1000.0}, "state": {}})),
        ],
        node_names=["gnd", "in", "out"],
    )
    assert op["node_voltages"]["out"] == pytest.approx(2.0)
    assert op["elements"]["E1"]["voltage_difference"] == pytest.approx(2.0)
    assert abs(op["elements"]["E1"]["current"]) == pytest.approx(2e-3)


def test_vccs_transconductance_uses_control_voltage() -> None:
    op = _solve(
        [
            ("V1", (VoltageSource, _vsource("in", "gnd", 1.0))),
            (
                "G1",
                (
                    VCCS,
                    {
                        "a": "out",
                        "b": "gnd",
                        "params": {"gm": 1e-3, "control_source": "in", "control_target": "gnd"},
                        "state": {},
                    },
                ),
            ),
            ("R1", (Resistor, {"a": "out", "b": "gnd", "params": {"R": 1000.0}, "state": {}})),
        ],
        node_names=["gnd", "in", "out"],
    )
    assert op["node_voltages"]["out"] == pytest.approx(-1.0)
    assert op["elements"]["G1"]["current"] == pytest.approx(1e-3)
