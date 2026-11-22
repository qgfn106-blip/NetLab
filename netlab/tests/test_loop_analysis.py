"""受控源断环提取的解析校验。"""

from __future__ import annotations

import numpy as np
import pytest

from netlab.core.compute.analysis import break_points
from netlab.core.compute.circuit import DescriptorModel
from netlab.core.compute.circuit.loop_analysis import (
    break_candidates,
    extract_controlled_source_loop,
)
from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene


def _non_inverting_amplifier(gain: float = 1.0e5, r1: float = 1.0e3, r2: float = 9.0e3) -> Scene:
    """VCVS 构成同相放大器：T = A / (1 + A * R1/(R1+R2))。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    n = scene.add_node(name="n", kind="node")
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
        params={"gain": gain, "control_source": vin.id, "control_target": n.id},
    )
    scene.add_edge(name="R1", source=n.id, target=gnd.id, kind="resistor", params={"R": r1})
    scene.add_edge(name="R2", source=out.id, target=n.id, kind="resistor", params={"R": r2})
    return scene


def _opamp_with_breakable_vcvs() -> Scene:
    """含非线性运放的断环场景：不显式给工作点时也必须能列出候选。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    vn = scene.add_node(name="vn", kind="node")
    out = scene.add_node(name="out", kind="node")
    out2 = scene.add_node(name="out2", kind="node")
    scene.add_edge(
        name="V1",
        source=vin.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 0.5, "amplitude": 1.0},
    )
    scene.add_edge(name="R1", source=vin.id, target=vn.id, kind="resistor", params={"R": 1.0e3})
    scene.add_edge(name="R2", source=vn.id, target=out.id, kind="resistor", params={"R": 1.0e4})
    scene.add_edge(
        name="OP1",
        source=out.id,
        target=gnd.id,
        kind="opamp",
        params={"vp": gnd.id, "vn": vn.id, "gain": 1.0e5, "vmax": 15.0},
    )
    scene.add_edge(
        name="E1",
        source=out2.id,
        target=gnd.id,
        kind="vcvs",
        params={"gain": 1.0, "control_source": vn.id, "control_target": gnd.id},
    )
    scene.add_edge(name="RL", source=out2.id, target=gnd.id, kind="resistor", params={"R": 1.0e4})
    return scene


def test_break_points_resolves_operating_point_for_nonlinear_scene() -> None:
    # 运放必须在直流工作点处线性化；break_points 未显式收到工作点时自动补求。
    result = break_points(Simulation(_opamp_with_breakable_vcvs()))
    assert result["ok"] is True
    assert [item["element"] for item in result["candidates"]] == ["E1"]
    assert result["candidates"][0]["control_a"] == "vn"
    assert result["candidates"][0]["output_a"] == "out2"


def test_break_candidates_reports_control_and_output() -> None:
    model = DescriptorModel.from_scene(_non_inverting_amplifier())
    candidates = break_candidates(model)
    assert [item["element"] for item in candidates] == ["E1"]
    assert candidates[0]["control_a"] == next(node.id for node in model.nodes if node.name == "vin")
    assert candidates[0]["gain"] == pytest.approx(1.0e5)


def test_vcvs_loop_gain_and_closed_loop_parity() -> None:
    scene = _non_inverting_amplifier()
    model = DescriptorModel.from_scene(scene)
    frequencies = np.logspace(0.0, 3.0, 24)
    result = extract_controlled_source_loop(model, "E1", frequencies, input_source="V1", output="out")

    beta = 1.0e3 / (1.0e3 + 9.0e3)
    expected_loop = 1.0e5 * beta
    assert np.allclose(np.real(result.loop_gain), expected_loop, rtol=1e-9)
    assert np.allclose(np.imag(result.loop_gain), 0.0, atol=1e-6)
    assert result.parity_max_rel is not None
    assert result.parity_max_rel < 1e-9

    expected_closed = 1.0e5 / (1.0 + expected_loop)
    assert np.allclose(np.real(result.closed_loop), expected_closed, rtol=1e-9)
    assert result.direct_response is not None
    assert np.allclose(np.real(result.direct_response), expected_closed, rtol=1e-9)
    assert result.poles["right_half_plane"] == 0
    assert result.poles["on_imaginary_axis"] is False


def test_vcvs_analytic_open_loop_matches_numeric_return_ratio() -> None:
    # 断环后解析开环 L(s) 必须与数值返回比一致；同相放大器为静态网络，L 为常数增益 1e4。
    model = DescriptorModel.from_scene(_non_inverting_amplifier())
    frequencies = np.logspace(0.0, 3.0, 16)
    result = extract_controlled_source_loop(
        model, "E1", frequencies, input_source="V1", output="out"
    )
    analytic = result.open_loop_transfer
    assert analytic is not None
    assert analytic["supported"] is True
    assert analytic["order"] == 0
    assert "10000" in analytic["expression"]
    assert analytic["parity_max_rel"] < 1e-6


def test_positive_feedback_sign_changes_closed_loop() -> None:
    scene = _non_inverting_amplifier(gain=1.5, r1=1.0e3, r2=1.0e3)
    model = DescriptorModel.from_scene(scene)
    frequencies = np.array([10.0, 100.0])
    negative = extract_controlled_source_loop(model, "E1", frequencies, feedback_sign=1.0)
    positive = extract_controlled_source_loop(model, "E1", frequencies, feedback_sign=-1.0)

    gain, beta = 1.5, 0.5
    assert np.allclose(np.real(negative.closed_loop), gain / (1.0 + gain * beta))
    assert np.allclose(np.real(positive.closed_loop), gain / (1.0 - gain * beta))
