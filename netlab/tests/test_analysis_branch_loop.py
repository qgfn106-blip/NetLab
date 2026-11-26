"""无源反馈支路断环：运放多级反馈外环开环 L(s) 回归。"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from netlab.core.compute import analysis
from netlab.core.compute.simulation import Simulation

FIXTURE = (
    Path(__file__).resolve().parent
    / "fixtures"
    / "projects"
    / "control_engineering_loop.json"
)


def _target_sim():
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    sim = Simulation()
    sim.load_scene(payload)
    return sim, sim.operating_point().get("node_voltages") or {}


def test_branch_candidates_suggest_global_feedback_resistor() -> None:
    sim, nodes = _target_sim()
    result = analysis.loop_candidates(sim, operating_point=nodes)
    branches = result.get("branch_candidates") or []
    suggested = [item for item in branches if item.get("suggested")]
    assert suggested and suggested[0]["element"] == "resistor1_c2"
    assert suggested[0]["control_a"] == "n5"
    assert suggested[0]["control_b"] == "n1"


def test_branch_loop_resolves_outer_open_loop_l_and_closed_t() -> None:
    sim, nodes = _target_sim()
    loop = analysis.loop_analysis(
        sim,
        element="resistor1_c2",
        input_source="V1",
        output="n5",
        display="loop",
        operating_point=nodes,
        f_start=0.01,
        f_stop=1000.0,
        points=60,
        step_duration=0.02,
        step_dt=1.0e-4,
    )
    assert loop["break_kind"] == "branch"
    assert loop["transfer_role"] == "open_loop"
    expression = loop["open_loop_transfer_function"]["expression"]
    assert expression == "(100) / (1*s^2 + 10*s)"
    assert loop["metrics"]["phase_margin_deg"] == pytest.approx(51.8, abs=0.1)

    closed = analysis.loop_analysis(
        sim,
        element="resistor1_c2",
        input_source="V1",
        output="n5",
        display="closed_loop",
        operating_point=nodes,
        f_start=0.01,
        f_stop=1000.0,
        points=20,
        step_duration=0.02,
        step_dt=1.0e-4,
    )
    assert closed["transfer_role"] == "closed_loop"
    assert "s^2 + 10.0002s + 99.996" in closed["transfer_function"]["expression"]
    curves = closed["envelopes"]["bode"]["curves"]
    labels = [str(curve.get("label")) for curve in curves]
    assert labels[0].startswith("闭环 T_synth") and labels[1].startswith("闭环 T_synth")
    frequencies = np.asarray(closed["frequencies_hz"], dtype=float)
    s = 1j * 2.0 * np.pi * frequencies
    # 有限开环增益 A=2e5 下，该断环点闭环传递函数为
    # T(s) = -99.995 / (s^2 + 10.0002 s + 99.996)；负号来自该节点的反相。
    analytic = -99.995 / (s * s + 10.0002 * s + 99.996)
    expected_mag = 20.0 * np.log10(np.abs(analytic))
    expected_phase = np.degrees(np.unwrap(np.angle(analytic)))
    assert np.max(np.abs(np.asarray(curves[0]["y"], dtype=float) - expected_mag)) < 1.0e-6
    assert np.max(np.abs(np.asarray(curves[1]["y"], dtype=float) - expected_phase)) < 1.0e-4


def test_open_loop_bode_matches_analytic_including_high_frequency() -> None:
    """默认 1 Hz–100 kHz 全频段必须用解析 L(s)，不能出现数值断环的高频地板。"""
    sim, nodes = _target_sim()
    result = analysis.loop_analysis(
        sim,
        element="resistor1_c2",
        input_source="V1",
        output="n5",
        display="loop",
        operating_point=nodes,
        f_start=1.0,
        f_stop=1.0e5,
        points=241,
    )
    curves = result["envelopes"]["bode"]["curves"]
    frequencies = np.asarray(result["frequencies_hz"], dtype=float)
    s = 1j * 2.0 * np.pi * frequencies
    analytic = 100.0 / (s * (s + 10.0))
    magnitude = np.asarray(curves[0]["y"], dtype=float)
    phase = np.asarray(curves[1]["y"], dtype=float)
    expected_mag = 20.0 * np.log10(np.abs(analytic))
    expected_phase = np.degrees(np.unwrap(np.angle(analytic)))
    assert np.max(np.abs(magnitude - expected_mag)) < 1.0e-6
    assert np.max(np.abs(phase - expected_phase)) < 1.0e-6
    assert magnitude[-1] == pytest.approx(-191.927, abs=1.0e-3)
    assert phase[-1] == pytest.approx(-180.0, abs=1.0e-3)


def test_open_loop_nyquist_matches_analytic_at_high_frequency() -> None:
    sim, nodes = _target_sim()
    result = analysis.nyquist_analysis(
        sim,
        element="resistor1_c2",
        input_source="V1",
        output="n5",
        operating_point=nodes,
        f_start=1.0,
        f_stop=1.0e5,
        points=241,
    )
    frequencies = np.asarray(result["frequencies_hz"], dtype=float)
    s = 1j * 2.0 * np.pi * frequencies
    analytic = 100.0 / (s * (s + 10.0))
    pairs = np.asarray(result["loop_gain"], dtype=float)
    measured = pairs[:, 0] + 1j * pairs[:, 1]
    assert np.max(np.abs(measured - analytic)) < 1.0e-12


def test_target_project_closed_loop_is_positive_phi() -> None:
    sim, nodes = _target_sim()
    result = analysis.tf_analysis(
        sim,
        mode="circuit",
        input_source="V1",
        output="n9",
        operating_point=nodes,
        f_start=1.0,
        f_stop=1.0e5,
        points=41,
    )
    tf = result["transfer_function"]
    assert tf["dc_gain"] == pytest.approx(1.0, abs=1.0e-4)
    assert tf["expression"].startswith("(99.99")
    curves = result["envelopes"]["bode"]["curves"]
    frequencies = np.geomspace(1.0, 1.0e5, 41)
    s = 1j * 2.0 * np.pi * frequencies
    analytic = 100.0 / (s * s + 10.0 * s + 100.0)
    expected_mag = 20.0 * np.log10(np.abs(analytic))
    expected_phase = np.degrees(np.unwrap(np.angle(analytic)))
    magnitude = np.asarray(curves[0]["y"], dtype=float)
    phase = np.asarray(curves[1]["y"], dtype=float)
    assert np.max(np.abs(magnitude - expected_mag)) < 1.0e-3
    assert np.max(np.abs(phase - expected_phase)) < 1.0e-2
    assert phase[-1] == pytest.approx(-180.0, abs=0.1)


def test_step_open_analysis_uses_outer_open_loop() -> None:
    sim, nodes = _target_sim()
    result = analysis.step_open_analysis(
        sim,
        element="resistor1_c2",
        input_source="V1",
        output="n5",
        operating_point=nodes,
        f_start=0.01,
        f_stop=1000.0,
        points=40,
        step_dt=1.0e-4,
        step_duration=0.02,
    )
    assert result["transfer_role"] == "open_loop"
    assert result["open_loop_transfer_function"]["expression"] == "(100) / (1*s^2 + 10*s)"
    assert result["envelopes"]["time"]["kind"] == "time"
    assert result["envelopes"]["bode"]["kind"] == "bode"
    assert result["envelopes"]["time"]["curves"]


def test_nyquist_closed_analysis_uses_closed_loop_transfer() -> None:
    sim, nodes = _target_sim()
    result = analysis.nyquist_closed_analysis(
        sim,
        input_source="V1",
        output="n5",
        operating_point=nodes,
        f_start=0.01,
        f_stop=1000.0,
        points=60,
    )
    assert result["transfer_role"] == "closed_loop"
    assert result["envelopes"]["nyquist"]["kind"] == "nyquist"
    assert result["envelopes"]["nyquist"]["curves"]
