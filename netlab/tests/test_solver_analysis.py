"""DC 工作点与 AC 小信号扫频（.op / Bode）。"""

from __future__ import annotations

import math

import numpy as np
import pytest

from netlab.core.common.limits import ComputeError, ValidationError
from netlab.core.compute.nodal import SolverOptions
from netlab.core.model.scene import Scene
from netlab.core.compute.simulation import Simulation


def _divider() -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    n1 = scene.add_node(name="n1", kind="node")
    n2 = scene.add_node(name="n2", kind="node")
    scene.add_edge(
        name="V1",
        source=n1.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 10.0, "amplitude": 0.0},
    )
    scene.add_edge(
        name="R1", source=n1.id, target=n2.id, kind="resistor", params={"R": 1000.0}
    )
    scene.add_edge(
        name="R2", source=n2.id, target=gnd.id, kind="resistor", params={"R": 1000.0}
    )
    return scene


def _rc_low_pass() -> Scene:
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
    return scene


def test_operating_point_resistor_divider():
    scene = _divider()
    sim = Simulation(scene)
    result = sim.operating_point()
    assert result["node_voltages"]["n1"] == pytest.approx(10.0, rel=1e-9)
    assert result["node_voltages"]["n2"] == pytest.approx(5.0, rel=1e-9)
    assert result["node_voltages"]["gnd"] == pytest.approx(0.0)
    # R1 电流 5 mA（1 V / 1 kΩ → 10 V/(1k+1k)），V1 提供 −5 mA。
    assert result["elements"]["R1"]["current"] == pytest.approx(5.0e-3, rel=1e-6)
    assert result["elements"]["V1"]["current"] == pytest.approx(-5.0e-3, rel=1e-6)
    assert result["iterations"] >= 1
    assert result["time"] == pytest.approx(0.0)
    assert result["sparse"] is False


def test_operating_point_capacitor_open_inductor_short():
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    n1 = scene.add_node(name="n1", kind="node")
    n2 = scene.add_node(name="n2", kind="node")
    scene.add_edge(
        name="V1",
        source=n1.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 5.0, "amplitude": 0.0},
    )
    scene.add_edge(
        name="R1", source=n1.id, target=n2.id, kind="resistor", params={"R": 1000.0}
    )
    scene.add_edge(
        name="C1", source=n2.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6}
    )
    scene.add_edge(
        name="L1", source=n2.id, target=gnd.id, kind="inductor", params={"L": 1.0e-3}
    )
    result = Simulation(scene).operating_point()
    # 电容开路、电感短路（1e5 S ≈ 10 µΩ 近似）→ n2 被电感钳在近 0 V。
    assert result["node_voltages"]["n2"] == pytest.approx(0.0, abs=1e-6)
    assert result["elements"]["C1"]["current"] == pytest.approx(0.0, abs=1e-15)
    assert abs(result["elements"]["L1"]["current"]) == pytest.approx(5.0e-3, rel=1e-3)


def test_operating_point_does_not_mutate_transient_state():
    scene = _divider()
    scene.set_solver_options(SolverOptions())
    sim = Simulation(scene)
    sim.step_once(3)
    solver = scene.ensure_engine().solver
    time_before = solver.time
    solution_before = np.array(solver.solution, copy=True)
    sim.operating_point()
    assert solver.time == pytest.approx(time_before)
    np.testing.assert_allclose(solver.solution, solution_before, atol=1e-15)


def test_ac_low_pass_cutoff():
    scene = _rc_low_pass()
    cutoff = 1.0 / (2.0 * math.pi * 1000.0 * 1.0e-6)
    result = Simulation(scene).ac_sweep([cutoff], probes=["out", "R1"])
    magnitude = result["probes"]["out"]["magnitude"][0]
    assert magnitude == pytest.approx(1.0 / math.sqrt(2.0), rel=1e-6)
    assert result["probes"]["out"]["phase_deg"][0] == pytest.approx(-45.0, abs=1e-4)
    assert result["probes"]["out"]["db"][0] == pytest.approx(-3.0103, abs=1e-3)
    # 串联电阻上的电流领先电压 45°，幅值 1/(√2·1kΩ)。
    assert result["probes"]["R1"]["magnitude"][0] == pytest.approx(
        1.0 / (math.sqrt(2.0) * 1000.0), rel=1e-6
    )
    assert result["input"] == "V1"


def test_ac_resistive_divider_is_flat():
    scene = _divider()
    result = Simulation(scene).ac_sweep([10.0, 1000.0], probes=["n2"])
    assert result["probes"]["n2"]["magnitude"] == pytest.approx([0.5, 0.5], rel=1e-6)
    assert result["probes"]["n2"]["phase_deg"] == pytest.approx([0.0, 0.0], abs=1e-9)


def test_ac_default_input_and_probe_lengths():
    scene = _rc_low_pass()
    frequencies = [10.0, 100.0, 1000.0]
    result = Simulation(scene).ac_sweep(frequencies)
    assert len(result["frequencies"]) == len(frequencies)
    assert result["input"] == "V1"
    # 默认探针：全部非接地节点 + 电阻/电容/电感/源。
    assert {"vin", "out", "R1", "C1", "V1"} <= set(result["probes"])
    for probe in result["probes"].values():
        assert len(probe["magnitude"]) == len(frequencies)
        assert len(probe["phase_deg"]) == len(frequencies)
        assert len(probe["db"]) == len(frequencies)


def test_ac_inverting_amplifier_gain():
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
        name="E1",
        source=out.id,
        target=gnd.id,
        kind="vcvs",
        params={"gain": -2.0, "control_source": vin.id, "control_target": gnd.id},
    )
    result = Simulation(scene).ac_sweep([100.0], input_source="V1", probes=["out"])
    assert result["probes"]["out"]["magnitude"][0] == pytest.approx(2.0, rel=1e-9)
    assert abs(result["probes"]["out"]["phase_deg"][0]) == pytest.approx(
        180.0, abs=1e-6
    )


def test_ac_rejects_nonlinear_element():
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    n1 = scene.add_node(name="n1", kind="node")
    scene.add_edge(
        name="V1",
        source=n1.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 1.0, "amplitude": 1.0},
    )
    scene.add_edge(
        name="D1",
        source=n1.id,
        target=gnd.id,
        kind="diode",
        params={"Is": 1e-12, "n": 1.0, "temperature": 300.15},
    )
    with pytest.raises(ComputeError, match="AC 分析暂不支持元件"):
        Simulation(scene).ac_sweep([10.0])


def test_ac_invalid_frequency_and_unknown_input():
    scene = _rc_low_pass()
    sim = Simulation(scene)
    with pytest.raises(ValidationError, match="频率必须为正"):
        sim.ac_sweep([0.0])
    with pytest.raises(ComputeError, match="找不到激励源"):
        sim.ac_sweep([10.0], input_source="nope")


def test_ac_unknown_probe_rejected():
    with pytest.raises(ComputeError, match="AC 探针不存在"):
        Simulation(_rc_low_pass()).ac_sweep([10.0], probes=["missing"])


def test_analysis_requires_circuit_mode():
    signal = Scene("signal")
    with pytest.raises(ValidationError, match="仅支持电路模式"):
        Simulation(signal).operating_point()
