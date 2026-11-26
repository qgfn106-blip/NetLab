"""闭环 Bode / 阶跃显示：显式断环与虚拟单位负反馈两条路径。"""

from __future__ import annotations

import numpy as np
import pytest

from netlab.core.compute import analysis, analysis_loop
from netlab.core.common.limits import ValidationError
from netlab.core.compute.analysis_errors import AnalysisError
from netlab.core.compute.circuit import descriptor_analysis
from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene


def _vcvs_amplifier() -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    out = scene.add_node(name="out", kind="node")
    control = scene.add_node(name="n", kind="node")
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
        params={"gain": 1.0e5, "control_source": vin.id, "control_target": control.id},
    )
    scene.add_edge(name="R1", source=control.id, target=gnd.id, kind="resistor", params={"R": 1000.0})
    scene.add_edge(name="R2", source=out.id, target=control.id, kind="resistor", params={"R": 9000.0})
    return scene


def test_explicit_closed_loop_bode_compares_synth_and_direct() -> None:
    body = analysis.loop_analysis(
        Simulation(_vcvs_amplifier()),
        element="E1",
        input_source="V1",
        output="out",
        f_start=10.0,
        f_stop=1000.0,
        points=21,
        display="closed_loop",
    )
    assert body["display"] == "closed_loop"
    envelope = body["envelopes"]["bode"]
    assert envelope["kind"] == "bode"
    labels = [str(curve.get("label")) for curve in envelope["curves"]]
    assert any("T_synth" in label for label in labels)
    assert any("T_direct" in label for label in labels)
    assert body["parity_max_rel"] is not None
    assert envelope["metrics"]["parity_max_rel"] == pytest.approx(body["parity_max_rel"])
    assert body["transfer_role"] == "closed_loop"
    assert body["transfer_function"]["supported"] is True
    assert body["transfer_function"]["expression"].startswith("(")


def test_explicit_closed_loop_step_returns_time_envelope() -> None:
    body = analysis.loop_analysis(
        Simulation(_vcvs_amplifier()),
        element="E1",
        input_source="V1",
        output="out",
        f_start=10.0,
        f_stop=1000.0,
        points=21,
        display="step",
        step_dt=1.0e-5,
        step_duration=2.0e-3,
    )
    assert body["kind"] == "loop_step"
    assert body["display"] == "step"
    assert body["transfer_role"] == "closed_loop"
    assert body["transfer_function"]["supported"] is True
    envelope = body["envelopes"]["time"]
    assert envelope["kind"] == "time"
    assert envelope["source"]["kind"] == "loop_step"
    times = envelope["axes"][0]
    assert times["unit"] == "s"
    values = envelope["curves"][0]["y"]
    assert len(values) == len(times["values"])
    assert any(abs(value - values[-1]) > 1.0e-9 for value in values)


def test_virtual_feedback_rejects_invalid_sign() -> None:
    with pytest.raises(AnalysisError):
        analysis.loop_analysis(
            Simulation(_vcvs_amplifier()),
            element="",
            input_source="V1",
            output="out",
            feedback_sign=0.0,
            display="closed_loop",
        )


def test_virtual_feedback_warns_and_stays_marked() -> None:
    body = analysis.loop_analysis(
        Simulation(_vcvs_amplifier()),
        element="",
        input_source="V1",
        output="out",
        f_start=10.0,
        f_stop=1000.0,
        points=21,
        display="closed_loop",
    )
    assert body["loop_origin"] == "virtual_unit_feedback"
    codes = {str(item.get("code")) for item in body["warnings"]}
    assert "no_physical_loop" in codes
    assert body["source"]["break_kind"] == "virtual"
    assert body["feedback_sign"] == 1.0
    assert body["source"]["feedback_sign"] == 1.0
    # 无断环时只能给出真实闭环 T(s)，绝不把闭环误标为开环。
    assert body["transfer_role"] == "closed_loop"
    assert body["transfer_function"]["supported"] is True
    assert body["transfer_function"]["expression"].startswith("(")
    assert body["closed_loop_transfer_function"]["supported"] is True
    assert body["closed_loop_transfer_function"]["expression"] == body["transfer_function"]["expression"]
    # 没有实体断环就没有真实开环 L(s)，必须 fail-closed 不返回假开环。
    assert body["open_loop_transfer_function"]["supported"] is False
    # 旧 bug 把闭环再反馈一次得到 9.99939/(s^2+10.0002s+99.996)，这里断言其已消失。
    assert "99.996" not in body["closed_loop_transfer_function"]["expression"]
    assert "9.99939" not in body["closed_loop_transfer_function"]["expression"]


def test_virtual_feedback_is_not_allowed_to_pose_as_open_loop() -> None:
    with pytest.raises(analysis.AnalysisError, match="实体断环"):
        analysis.loop_analysis(
            Simulation(_vcvs_amplifier()),
            element="",
            input_source="V1",
            output="out",
            f_start=10.0,
            f_stop=1000.0,
            points=21,
            display="loop",
        )


def test_explicit_open_loop_is_marked_open() -> None:
    body = analysis.loop_analysis(
        Simulation(_vcvs_amplifier()),
        element="E1",
        input_source="V1",
        output="out",
        f_start=10.0,
        f_stop=1000.0,
        points=21,
        display="loop",
    )
    assert body["display"] == "loop"
    assert body["transfer_role"] == "open_loop"
    assert body["transfer_function"]["supported"] is True
    assert body["transfer_function"]["expression"] == body["open_loop_transfer_function"]["expression"]
    curve = body["envelopes"]["bode"]["curves"][0]
    assert curve["detail"]["output"] == "L(E1)"


def test_closed_loop_transfer_function_rejects_invalid_feedback_sign() -> None:
    supported = {
        "supported": True,
        "numerator_coeffs": [[1.0, 0.0]],
        "denominator_coeffs": [[2.0, 0.0], [1.0, 0.0]],
    }
    with pytest.raises(ValidationError):
        descriptor_analysis.closed_loop_transfer_function(supported, feedback_sign=0.0)
    with pytest.raises(ValidationError):
        descriptor_analysis.closed_loop_transfer_function(supported, feedback_sign="bad")


def test_closed_loop_transfer_function_uses_physical_feedback_sign() -> None:
    negative = descriptor_analysis.closed_loop_transfer_function(
        {"supported": True, "numerator_coeffs": [1.0], "denominator_coeffs": [1.0, 1.0]},
        feedback_sign=1.0,
    )
    positive = descriptor_analysis.closed_loop_transfer_function(
        {"supported": True, "numerator_coeffs": [1.0], "denominator_coeffs": [1.0, 1.0]},
        feedback_sign=-1.0,
    )
    assert negative is not None and positive is not None
    # 负反馈 T=G/(1+G)=1/(s+2)，正反馈 T=G/(1-G)=1/s。
    assert "s + 2" in negative["expression"]
    assert positive["expression"].endswith("/ (s)")


def test_closed_loop_transfer_function_rejects_unsupported_inputs() -> None:
    assert descriptor_analysis.closed_loop_transfer_function(None) is None
    assert descriptor_analysis.closed_loop_transfer_function({"supported": False}) is None
    assert (
        descriptor_analysis.closed_loop_transfer_function(
            {"supported": True, "numerator_coeffs": "bad", "denominator_coeffs": [1.0]}
        )
        is None
    )


def test_closed_loop_transfer_function_handles_complex_and_invalid_coefficients() -> None:
    body = descriptor_analysis.closed_loop_transfer_function(
        {
            "supported": True,
            "numerator_coeffs": [[1.0, 1.0]],
            "denominator_coeffs": [[1.0, 0.0]],
        }
    )
    assert body is not None
    assert body["supported"] is True
    assert (
        descriptor_analysis.closed_loop_transfer_function(
            {"supported": True, "numerator_coeffs": ["bad"], "denominator_coeffs": [1.0]}
        )
        is None
    )
    assert (
        descriptor_analysis.closed_loop_transfer_function(
            {"supported": True, "numerator_coeffs": [], "denominator_coeffs": [1.0]}
        )
        is None
    )
    assert (
        descriptor_analysis.closed_loop_transfer_function(
            {"supported": True, "numerator_coeffs": [1.0], "denominator_coeffs": []}
        )
        is None
    )


def test_closed_loop_transfer_function_guards_empty_polyadd(monkeypatch) -> None:
    monkeypatch.setattr(
        descriptor_analysis.np,
        "polyadd",
        lambda *_: np.asarray([], dtype=np.complex128),
    )
    body = descriptor_analysis.closed_loop_transfer_function(
        {"supported": True, "numerator_coeffs": [1.0], "denominator_coeffs": [1.0, 2.0]}
    )
    assert body is None


def test_physical_closed_loop_survives_transfer_expression_failure(monkeypatch) -> None:
    def _unavailable_transfer(*args, **kwargs):
        raise RuntimeError("transfer unavailable")

    monkeypatch.setattr(analysis_loop, "descriptor_transfer_function", _unavailable_transfer)
    body = analysis.loop_analysis(
        Simulation(_vcvs_amplifier()),
        element="E1",
        input_source="V1",
        output="out",
        f_start=10.0,
        f_stop=1000.0,
        points=21,
        display="closed_loop",
    )
    assert body["transfer_role"] == "closed_loop"
    assert body["transfer_function"] == {
        "supported": False,
        "reason": "transfer unavailable",
    }


def test_closed_loop_curve_is_g_over_one_plus_l_for_non_unity_feedback() -> None:
    """LM-01 回归：非单位反馈下闭环曲线必须是 G/(1+L)=A/(1+Aβ)，而非 L/(1+L)。

    该电路 A=1e5、β=0.1：正确闭环 |T|≈9.999（≈19.999 dB），
    旧的 L/(1+L) 会给出 ≈0.9999（≈0 dB），两者相差约 20 dB（审计实测值）。
    """
    body = analysis.loop_analysis(
        Simulation(_vcvs_amplifier()),
        element="E1",
        input_source="V1",
        output="out",
        f_start=10.0,
        f_stop=1000.0,
        points=21,
        display="closed_loop",
    )
    curves = body["envelopes"]["bode"]["curves"]
    synth_mag = next(
        c
        for c in curves
        if "T_synth" in str(c.get("label")) and "幅值" in str(c.get("label"))
    )
    gain, beta = 1.0e5, 1000.0 / (1000.0 + 9000.0)  # β=0.1
    expected_db = 20.0 * np.log10(gain / (1.0 + gain * beta))  # ≈19.999 dB（G/(1+L)）
    wrong_db = 20.0 * np.log10((gain * beta) / (1.0 + gain * beta))  # ≈0 dB（L/(1+L)）
    values = np.asarray(synth_mag["y"], dtype=float)
    assert np.allclose(values, expected_db, atol=1e-6)
    assert np.min(np.abs(values - wrong_db)) > 10.0  # 明确排除旧 L/(1+L)（相差≈20dB）
