"""受控源断环提取的解析校验。"""

from __future__ import annotations

import numpy as np
import pytest

from netlab.core.compute import analysis
from netlab.core.compute.analysis import break_points
from netlab.core.compute.circuit import DescriptorModel
from netlab.core.compute.circuit.loop_analysis import (
    branch_candidates,
    break_candidates,
    extract_branch_loop,
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
    assert [item["element"] for item in result["candidates"]] == ["OP1", "E1"]
    assert result["candidates"][0]["kind"] == "opamp"
    assert result["candidates"][0]["control_a"] == "gnd"
    assert result["candidates"][0]["control_b"] == "vn"
    assert result["candidates"][0]["output_a"] == "out"
    assert result["candidates"][1]["control_a"] == "vn"
    assert result["candidates"][1]["output_a"] == "out2"


def test_break_candidates_reports_control_and_output() -> None:
    model = DescriptorModel.from_scene(_non_inverting_amplifier())
    candidates = break_candidates(model)
    assert [item["element"] for item in candidates] == ["E1"]
    assert candidates[0]["control_a"] == next(node.id for node in model.nodes if node.name == "vin")
    assert candidates[0]["gain"] == pytest.approx(1.0e5)


def test_branch_candidates_absent_without_opamps() -> None:
    # 纯 VCVS 电路没有“多级运放外环”，不应把普通反馈电阻当作默认断点。
    model = DescriptorModel.from_scene(_non_inverting_amplifier())
    assert branch_candidates(model) == []


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


def _positive_feedback_amplifier(gain: float = 1.5, r1: float = 1.0e3, r2: float = 1.0e3) -> Scene:
    """把同相放大器的受控源控制端极性反接，构成真正的正反馈：L = -A*beta < 0。"""
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
        params={"gain": gain, "control_source": n.id, "control_target": vin.id},
    )
    scene.add_edge(name="R1", source=n.id, target=gnd.id, kind="resistor", params={"R": r1})
    scene.add_edge(name="R2", source=out.id, target=n.id, kind="resistor", params={"R": r2})
    return scene


def test_feedback_sign_does_not_double_count_polarity() -> None:
    """LM-02 回归：feedback_sign 仅声明极性，不得与 L 自带符号重复相乘。

    同一（负反馈）电路在 feedback_sign=+1 与 -1 下的闭环必须一致，
    且等于真实闭环 T = A / (1 + A*beta)（旧实现会把 -1 再乘一次，得到 A/(1-Aβ)）。
    """
    scene = _non_inverting_amplifier(gain=1.5, r1=1.0e3, r2=1.0e3)
    model = DescriptorModel.from_scene(scene)
    frequencies = np.array([10.0, 100.0])
    negative = extract_controlled_source_loop(model, "E1", frequencies, feedback_sign=1.0)
    positive = extract_controlled_source_loop(model, "E1", frequencies, feedback_sign=-1.0)

    gain, beta = 1.5, 0.5
    expected = gain / (1.0 + gain * beta)  # ≈0.857，物理负反馈
    assert np.allclose(np.real(negative.closed_loop), expected)
    # 旧实现此时会得到 gain/(1-gain*beta)=6.0（符号双计）；修复后两值必须相等。
    assert np.allclose(np.real(positive.closed_loop), expected)
    assert np.allclose(np.real(negative.closed_loop), np.real(positive.closed_loop))
    assert np.allclose(np.real(negative.loop_gain), gain * beta)


def test_true_positive_feedback_topology_closed_loop_analytic() -> None:
    """LM-01/02 回归：真反馈拓扑反接后 L<0，闭环 = G/(1+L) = A/(1-Aβ)，|T|=6.0。"""
    model = DescriptorModel.from_scene(_positive_feedback_amplifier())
    frequencies = np.array([10.0, 100.0])
    result = extract_controlled_source_loop(model, "E1", frequencies)

    gain, beta = 1.5, 0.5
    # 电路极性给出负的返回比（与 feedback_sign 无关）。
    assert np.allclose(np.real(result.loop_gain), -gain * beta, rtol=1e-9)
    assert np.allclose(np.imag(result.loop_gain), 0.0, atol=1e-9)
    # 闭环 G/(1+L) = A/(1-Aβ)，幅值 1.5/0.25 = 6.0。
    assert np.allclose(np.abs(result.closed_loop), abs(gain / (1.0 - gain * beta)), rtol=1e-9)
    assert result.direct_response is not None
    assert np.allclose(result.closed_loop, result.direct_response, rtol=1e-9)
    assert result.parity_max_rel is not None
    assert result.parity_max_rel < 1e-9


def test_branch_loop_marks_opamp_asymptotic_approximation() -> None:
    scene = _opamp_with_breakable_vcvs()
    sim = Simulation(scene)
    operating_point = sim.operating_point().get("node_voltages") or {}
    model = DescriptorModel.from_scene(scene, operating_point=operating_point)
    result = extract_branch_loop(
        model,
        "R2",
        np.logspace(0.0, 3.0, 16),
        input_source="V1",
        output="out",
    )
    assert result.loop_gain_kind == "asymptotic_opamp"
    warning = next(
        item for item in result.warnings if item["code"] == "loop_gain_idealized"
    )
    assert warning["opamp_gain_scale"] == 1000.0


def test_branch_loop_without_opamp_is_exact() -> None:
    model = DescriptorModel.from_scene(_non_inverting_amplifier())
    result = extract_branch_loop(
        model,
        "R2",
        np.logspace(0.0, 3.0, 16),
        input_source="V1",
        output="out",
    )
    assert result.loop_gain_kind == "exact"
    assert all(item["code"] != "loop_gain_idealized" for item in result.warnings)


def test_loop_analysis_payload_marks_idealized_opamp() -> None:
    scene = _opamp_with_breakable_vcvs()
    result = analysis.loop_analysis(
        Simulation(scene),
        element="R2",
        input_source="V1",
        output="out",
        display="loop",
        f_start=1.0,
        f_stop=1000.0,
        points=16,
    )
    assert result["loop_gain_kind"] == "asymptotic_opamp"
    assert result["source"]["loop_gain_kind"] == "asymptotic_opamp"
    assert any(
        item["code"] == "loop_gain_idealized" for item in result["warnings"]
    )
