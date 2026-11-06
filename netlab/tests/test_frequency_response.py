"""R39 复数分析层：signal 节点方程与 circuit 复数 MNA 频响。"""

from __future__ import annotations

import math

import pytest

from netlab.core.compute import analysis
from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene


def _signal_lag() -> Simulation:
    scene = Scene("signal")
    source = scene.add_node(name="u", kind="manual", data={"voltage": 1.0})
    gain = scene.add_node(name="k", kind="gain", params={"gain": 2.0})
    lag = scene.add_node(name="lag", kind="lag", params={"tau": 1.0})
    scene.add_edge(source=source.id, target=gain.id, kind="pass")
    scene.add_edge(source=gain.id, target=lag.id, kind="pass")
    return Simulation(scene)


def _signal_delay() -> Simulation:
    scene = Scene("signal")
    source = scene.add_node(name="u", kind="manual", data={"voltage": 1.0})
    output = scene.add_node(name="out", kind="gain", params={"gain": 1.0})
    scene.add_edge(source=source.id, target=output.id, kind="pass", delay=True)
    sim = Simulation(scene)
    sim.config.dt = 0.01
    return sim


def _rc_low_pass() -> Simulation:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(
        name="V1",
        source=vin.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 0.0, "amplitude": 1.0},
    )
    scene.add_edge(
        name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0}
    )
    scene.add_edge(
        name="C1", source=out.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6}
    )
    return Simulation(scene)


def _rlc_low_pass() -> Simulation:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    mid = scene.add_node(name="mid", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(
        name="V1",
        source=vin.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 0.0, "amplitude": 1.0},
    )
    scene.add_edge(
        name="R1", source=vin.id, target=mid.id, kind="resistor", params={"R": 10.0}
    )
    scene.add_edge(
        name="L1", source=mid.id, target=out.id, kind="inductor", params={"L": 0.01}
    )
    scene.add_edge(
        name="C1", source=out.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6}
    )
    return Simulation(scene)


def test_signal_frequency_response_uses_complex_node_equations():
    sim = _signal_lag()
    try:
        result = analysis.frequency_response(
            sim,
            "u",
            "lag",
            f_start=1.0 / (2.0 * math.pi),
            f_stop=2.0 / (2.0 * math.pi),
            points=2,
        )
        assert result["ok"] is True
        assert result["backend"] == "complex_graph"
        first = complex(result["real"][0], result["imag"][0])
        assert abs(first) == pytest.approx(2.0 / math.sqrt(2.0), rel=1e-9)
        assert math.degrees(math.atan2(first.imag, first.real)) == pytest.approx(-45.0)
        assert len(result["frequencies_hz"]) == 2
        assert len(result["omega"]) == 2
    finally:
        sim.shutdown()


def test_signal_frequency_response_uses_exact_delay():
    sim = _signal_delay()
    try:
        result = analysis.frequency_response(
            sim, "u", "out", f_start=10.0, f_stop=20.0, points=2
        )
        value = complex(result["real"][0], result["imag"][0])
        assert abs(value) == pytest.approx(1.0, abs=1e-12)
        assert math.degrees(math.atan2(value.imag, value.real)) == pytest.approx(-36.0)
    finally:
        sim.shutdown()


def test_circuit_frequency_response_reuses_complex_mna():
    sim = _rc_low_pass()
    try:
        cutoff = 1.0 / (2.0 * math.pi * 1000.0 * 1.0e-6)
        result = analysis.frequency_response(
            sim, "V1", "out", f_start=cutoff, f_stop=2.0 * cutoff, points=2
        )
        assert result["ok"] is True
        assert result["backend"] == "complex_mna"
        assert result["magnitude"][0] == pytest.approx(1.0 / math.sqrt(2.0), rel=1e-6)
        assert result["phase_deg"][0] == pytest.approx(-45.0, abs=1e-6)
    finally:
        sim.shutdown()


def test_circuit_frequency_response_rlc_resonance():
    sim = _rlc_low_pass()
    try:
        f0 = 1.0 / (2.0 * math.pi * math.sqrt(0.01 * 1.0e-6))
        result = analysis.frequency_response(
            sim, "V1", "out", f_start=f0, f_stop=1.001 * f0, points=2, scale="lin"
        )
        assert result["ok"] is True
        assert result["backend"] == "complex_mna"
        assert result["magnitude"][0] == pytest.approx(10.0, rel=1e-6)
        assert result["phase_deg"][0] == pytest.approx(-90.0, abs=1e-5)
    finally:
        sim.shutdown()


def test_frequency_response_rejects_nonpositive_frequency():
    sim = _signal_lag()
    try:
        with pytest.raises(analysis.AnalysisError):
            analysis.frequency_response(sim, "u", "lag", f_start=0.0, f_stop=1.0)
        with pytest.raises(analysis.AnalysisError):
            analysis.frequency_response(
                sim, "u", "lag", f_start=1.0, f_stop=2.0, scale="bad"
            )
    finally:
        sim.shutdown()


def test_signal_frequency_response_rejects_nonlinear_node():
    scene = Scene("signal")
    source = scene.add_node(name="u", kind="manual", data={"voltage": 1.0})
    clip = scene.add_node(
        name="clip", kind="clip", params={"minimum": 0.0, "maximum": 1.0}
    )
    scene.add_edge(source=source.id, target=clip.id, kind="pass")
    sim = Simulation(scene)
    try:
        result = analysis.frequency_response(sim, "u", "clip", f_start=1.0, f_stop=2.0)
        assert result["ok"] is False
        assert "非线性" in result["reason"]
    finally:
        sim.shutdown()
