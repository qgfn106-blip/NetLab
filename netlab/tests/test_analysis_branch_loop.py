"""无源反馈支路断环：运放多级反馈外环开环 L(s) 回归。"""

from __future__ import annotations

from pathlib import Path

import pytest

from netlab.core.compute import analysis
from netlab.core.compute.simulation import Simulation
from netlab.core.model.project import load_project, project_scene_payload

ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / "MyProject" / "控制工程实验2_闭环分析示范.netlab"


def _target_sim():
    if not PROJECT.exists():
        pytest.skip("本地示范工程不存在")
    payload = project_scene_payload(load_project(PROJECT))
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
