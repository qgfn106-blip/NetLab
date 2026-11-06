"""R36/P4：线性网络总传函、反馈与 Bode 回归。"""

import math

import pytest
import sympy as sp

from netlab.core.compute import analysis
from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene


def _tf(value: str):
    return sp.sympify(value)


def _series_scene() -> tuple[Scene, str]:
    scene = Scene("signal")
    u = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    gain = scene.add_node(name="gain", kind="gain", params={"gain": 2.0})
    plant = scene.add_node(
        name="plant",
        kind="transfer_function",
        params={"form": "expr", "expr": "1/(s+1)"},
    )
    scene.add_edge(source=u.id, target=gain.id, kind="pass")
    scene.add_edge(source=gain.id, target=plant.id, kind="pass")
    return scene, "plant"


def test_series_network_tf() -> None:
    scene, output = _series_scene()
    result = analysis.transfer_function(Simulation(scene), "u", output)
    assert result["ok"] is True, result
    assert sp.simplify(_tf(result["expression"]) - _tf("2/(s+1)")) == 0
    space = result["state_space"]
    assert space is not None
    assert space["realization"] == "controllable_canonical"
    assert space["order"] == 1
    assert len(space["A"]) == 1 and len(space["B"][0]) == 1
    assert space["D"] == [[0.0]]


def test_parallel_network_tf() -> None:
    scene = Scene("signal")
    u = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    a = scene.add_node(name="a", kind="gain", params={"gain": 2.0})
    b = scene.add_node(name="b", kind="gain", params={"gain": 3.0})
    total = scene.add_node(name="total", kind="sum", params={})
    out = scene.add_node(name="out", kind="gain", params={"gain": 1.0})
    scene.add_edge(source=u.id, target=a.id, kind="pass")
    scene.add_edge(source=u.id, target=b.id, kind="pass")
    scene.add_edge(source=a.id, target=total.id, kind="pass")
    scene.add_edge(source=b.id, target=total.id, kind="pass")
    scene.add_edge(source=total.id, target=out.id, kind="pass")
    result = analysis.transfer_function(Simulation(scene), "u", "out")
    assert result["ok"] is True, result
    assert sp.simplify(_tf(result["expression"]) - 5) == 0


def test_unity_feedback_network_tf_and_bode() -> None:
    scene = Scene("signal")
    scene.set_algebraic_solver(True)
    u = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    error = scene.add_node(
        name="error", kind="sum", params={"weights": {"ref": 1.0, "fb": -1.0}}
    )
    plant = scene.add_node(
        name="plant",
        kind="transfer_function",
        params={"form": "expr", "expr": "1/(s+1)"},
    )
    scene.add_edge(name="ref", source=u.id, target=error.id, kind="pass")
    scene.add_edge(name="forward", source=error.id, target=plant.id, kind="pass")
    scene.add_edge(name="fb", source=plant.id, target=error.id, kind="pass")
    sim = Simulation(scene)

    result = analysis.transfer_function(sim, "u", "plant")
    assert result["ok"] is True, result
    assert sp.simplify(_tf(result["expression"]) - _tf("1/(s+2)")) == 0

    report = analysis.tf_analysis(
        sim, input_node="u", output_node="plant", points=3, duration=2
    )
    omega = report["bode"]["omega"]
    position = min(range(len(omega)), key=lambda index: abs(omega[index] - 1.0))
    frequency = omega[position]
    expected = 1 / (2 + 1j * frequency)
    assert report["bode"]["magnitude"][position] == pytest.approx(abs(expected))
    assert report["bode"]["phase_deg"][position] == pytest.approx(
        math.degrees(math.atan2(expected.imag, expected.real)), abs=1e-6
    )


def test_explicit_delay_network_tf_in_z_domain() -> None:
    scene = Scene("signal")
    u = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    gain = scene.add_node(name="gain", kind="gain", params={"gain": 2.0})
    out = scene.add_node(name="out", kind="gain", params={"gain": 1.0})
    scene.add_edge(source=u.id, target=gain.id, kind="pass")
    scene.add_edge(source=gain.id, target=out.id, kind="scale", delay=True)

    result = analysis.transfer_function(Simulation(scene), "u", "out", domain="z")
    assert result["ok"] is True, result
    assert result["domain"] == "z"
    assert sp.simplify(_tf(result["expression"]) - _tf("2/z")) == 0


def test_explicit_delay_network_tf_in_s_domain_uses_pade() -> None:
    scene = Scene("signal")
    u = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    gain = scene.add_node(name="gain", kind="gain", params={"gain": 2.0})
    out = scene.add_node(name="out", kind="gain", params={"gain": 1.0})
    scene.add_edge(source=u.id, target=gain.id, kind="pass")
    scene.add_edge(source=gain.id, target=out.id, kind="scale", delay=True)
    sim = Simulation(scene)
    dt = float(sim.config.dt)

    result = analysis.transfer_function(sim, "u", "out")
    assert result["ok"] is True, result
    assert result["domain"] == "s"
    assert result["delay_pade_order"] == 3
    assert result["delay_seconds"] == pytest.approx(dt)
    expression = _tf(result["expression"])
    assert sp.limit(expression, sp.Symbol("s"), 0) == 2

    first_order = analysis.transfer_function(sim, "u", "out", delay_pade_order=1)
    assert first_order["ok"] is True, first_order
    expected = _tf(f"2*(1-s*{dt}/2)/(1+s*{dt}/2)")
    assert sp.simplify(_tf(first_order["expression"]) - expected) == 0

    report = analysis.tf_analysis(
        sim, input_node="u", output_node="out", points=3, duration=2
    )
    assert report["step"]["metrics"]["peak_value"] is not None
    assert report["bode"]["magnitude"][0] >= 0


def test_nonlinear_network_tf_reports_reason() -> None:
    scene = Scene("signal")
    u = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    expr = scene.add_node(
        name="expr",
        kind="expression",
        params={"expr": "tanh(u)", "variables": {"u": "u"}},
    )
    scene.add_edge(source=u.id, target=expr.id, kind="pass")
    result = analysis.transfer_function(Simulation(scene), "u", "expr")
    assert result["ok"] is False
    assert "非线性" in result["reason"]
