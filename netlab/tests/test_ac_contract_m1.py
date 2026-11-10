"""M1：AC 扫频契约固化（前端 ac_analysis.ts 消费形状 + 输入校验 + 状态不变性）。"""

from __future__ import annotations

import math

import numpy as np
import pytest

from netlab.core.common.limits import ValidationError
from netlab.core.compute.nodal import SolverOptions
from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene


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
        name="R1",
        source=vin.id,
        target=out.id,
        kind="resistor",
        params={"R": 1000.0},
    )
    scene.add_edge(
        name="C1",
        source=out.id,
        target=gnd.id,
        kind="capacitor",
        params={"C": 1.0e-6},
    )
    return scene


_RC_CUTOFF_HZ = 1.0 / (2.0 * math.pi * 1000.0 * 1.0e-6)
_PROBE_FIELDS = ("real", "imag", "magnitude", "phase_deg", "db")


def _as_complex(probe: dict[str, list[float]]) -> list[complex]:
    return [
        complex(real, imag)
        for real, imag in zip(probe["real"], probe["imag"])
    ]


def test_ac_siso_matches_frontend_contract_shape() -> None:
    frequencies = [10.0, 100.0, 1000.0]
    result = Simulation(_rc_low_pass()).ac_sweep(
        frequencies, input_source="V1", probes=["out"]
    )

    # 与 ac_analysis.ts 的 AcResultRec / drawAcChart 消费形状一致。
    assert set(result) == {"frequencies", "input", "probes", "operating_point"}
    assert result["frequencies"] == pytest.approx(frequencies)
    assert result["input"] == "V1"
    assert isinstance(result["input"], str)
    assert set(result["probes"]) == {"out"}

    probe = result["probes"]["out"]
    assert set(probe) == set(_PROBE_FIELDS)
    for field in _PROBE_FIELDS:
        assert isinstance(probe[field], list)
        assert len(probe[field]) == len(frequencies)
        assert all(isinstance(value, float) for value in probe[field])

    operating_point = result["operating_point"]
    assert set(operating_point) == {"iterations", "node_voltages"}
    assert int(operating_point["iterations"]) >= 1
    assert isinstance(operating_point["node_voltages"], dict)
    assert "out" in operating_point["node_voltages"]
    assert all(
        isinstance(value, float)
        for value in operating_point["node_voltages"].values()
    )

    # RC 低通解析解 H(jω) = 1 / (1 + j·f/fc)。
    for index, frequency in enumerate(frequencies):
        ratio = frequency / _RC_CUTOFF_HZ
        expected = 1.0 / complex(1.0, ratio)
        assert probe["real"][index] == pytest.approx(expected.real, rel=1e-9)
        assert probe["imag"][index] == pytest.approx(
            expected.imag, rel=1e-9, abs=1e-12
        )
        assert probe["magnitude"][index] == pytest.approx(
            abs(expected), rel=1e-9
        )
        assert probe["phase_deg"][index] == pytest.approx(
            math.degrees(math.atan2(expected.imag, expected.real)), abs=1e-6
        )
        assert probe["db"][index] == pytest.approx(
            20.0 * math.log10(abs(expected)), rel=1e-9
        )


def test_ac_multi_probe_share_frequency_axis_and_same_solution() -> None:
    frequencies = [10.0, 100.0, 1000.0]
    result = Simulation(_rc_low_pass()).ac_sweep(
        frequencies, input_source="V1", probes=["out", "R1"]
    )

    assert set(result["probes"]) == {"out", "R1"}
    assert result["frequencies"] == pytest.approx(frequencies)
    out_probe = result["probes"]["out"]
    r1_probe = result["probes"]["R1"]
    for probe in (out_probe, r1_probe):
        for field in _PROBE_FIELDS:
            assert len(probe[field]) == len(result["frequencies"])

    out_complex = _as_complex(out_probe)
    r1_complex = _as_complex(r1_probe)
    for index, frequency in enumerate(frequencies):
        ratio = frequency / _RC_CUTOFF_HZ
        expected_out = 1.0 / complex(1.0, ratio)
        expected_r1_current = (1.0 - expected_out) / 1000.0

        assert out_complex[index] == pytest.approx(expected_out, rel=1e-9)
        assert r1_complex[index] == pytest.approx(
            expected_r1_current, rel=1e-9, abs=1e-15
        )
        # KCL：V_out + R1·I_R1 = V_in = 1 V，两路探针来自同一次 AC 求解。
        assert abs(out_complex[index] + 1000.0 * r1_complex[index] - 1.0) < 1e-9

        assert out_probe["magnitude"][index] == pytest.approx(
            abs(expected_out), rel=1e-9
        )
        assert out_probe["phase_deg"][index] == pytest.approx(
            math.degrees(math.atan2(expected_out.imag, expected_out.real)),
            abs=1e-6,
        )
        assert r1_probe["magnitude"][index] == pytest.approx(
            abs(expected_r1_current), rel=1e-9
        )
        assert r1_probe["phase_deg"][index] == pytest.approx(
            math.degrees(
                math.atan2(expected_r1_current.imag, expected_r1_current.real)
            ),
            abs=1e-6,
        )


@pytest.mark.parametrize(
    "frequencies",
    [
        [],
        [0.0],
        [-10.0],
        [10.0, 0.0],
        [float("nan")],
        [float("inf")],
        [float("-inf")],
        [100.0, 10.0],
        [10.0, 10.0],
    ],
)
def test_ac_rejects_invalid_frequency_axis(frequencies: list[float]) -> None:
    with pytest.raises(ValidationError):
        Simulation(_rc_low_pass()).ac_sweep(
            frequencies, input_source="V1", probes=["out"]
        )


def test_ac_sweep_does_not_mutate_transient_state() -> None:
    scene = _rc_low_pass()
    scene.set_solver_options(SolverOptions())
    sim = Simulation(scene)
    sim.step_once(3)

    solver = scene.ensure_engine().solver
    payload_before = scene.to_payload()
    time_before = sim.time
    steps_before = sim.steps
    solution_before = np.array(solver.solution, copy=True)
    node_voltages_before = dict(solver.node_voltages)

    result = sim.ac_sweep(
        [10.0, 100.0, 1000.0], input_source="V1", probes=["out"]
    )
    assert result["probes"]["out"]["magnitude"]

    assert sim.time == pytest.approx(time_before)
    assert sim.steps == steps_before
    np.testing.assert_allclose(solver.solution, solution_before, atol=1e-15)
    assert solver.node_voltages == node_voltages_before
    assert scene.to_payload() == payload_before
