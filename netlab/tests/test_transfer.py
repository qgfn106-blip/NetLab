"""R34：s 域传递函数节点、Bode/阶跃/零极点分析。"""

from __future__ import annotations

import math

import numpy as np
import pytest

from netlab.core.common.limits import ComputeError
from netlab.core.compute import analysis
from netlab.core.compute import transfer
from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene


def test_parse_expression_rational():
    tf = transfer.parse_expression("(2*s+1)/(s^2+3*s+2)")
    assert tf.num == (2.0, 1.0)
    assert tf.den == (1.0, 3.0, 2.0)
    assert tf.order == 2
    assert tf.relative_order == 1
    assert tf.to_expression() == "(2*s + 1)/(s^2 + 3*s + 2)"


def test_parse_expression_implicit_multiplication_and_powers():
    tf = transfer.parse_expression("2s/(s+1)")
    assert tf.num == (2.0, 0.0)
    assert tf.den == (1.0, 1.0)
    tf = transfer.parse_expression("(s+1)(s+2)/(s+3)^2")
    assert tf.num == (1.0, 3.0, 2.0)
    assert tf.den == (1.0, 6.0, 9.0)


@pytest.mark.parametrize(
    ("text", "fragment"),
    [
        ("1/(s+1", "')'"),
        ("s^1.5", "整数"),
        ("1/0", "除以零"),
        ("s^2", "真有理式"),
        ("abc", "无法识别"),
        ("", "不能为空"),
    ],
)
def test_parse_expression_errors(text, fragment):
    with pytest.raises(ComputeError) as info:
        transfer.parse_expression(text)
    assert fragment in str(info.value)


def test_from_coefficients_and_zpk():
    tf = transfer.from_coefficients([1, 2], [1, 3, 2])
    assert tf.num == (1.0, 2.0)
    assert tf.den == (1.0, 3.0, 2.0)
    zpk = transfer.from_zpk([-1.0], [-2.0, -3.0], gain=2.0)
    assert zpk.num == (2.0, 2.0)
    assert zpk.den == (1.0, 5.0, 6.0)
    assert zpk.gain() == pytest.approx(1.0 / 3.0)


def test_from_params_dispatches_three_forms():
    assert transfer.from_params({"form": "expr", "expr": "1/(s+1)"}).num == (1.0,)
    assert transfer.from_params(
        {"form": "coeff", "numerator": [1], "denominator": [1, 2]}
    ).den == (1.0, 2.0)
    assert transfer.from_params(
        {"form": "zpk", "zeros": [], "poles": [-1], "gain": 3}
    ).num == (3.0,)
    with pytest.raises(ComputeError):
        transfer.from_params({"form": "unknown"})


def test_state_space_matches_transfer_at_complex_points():
    for text in (
        "(2*s+1)/(s^2+3*s+2)",
        "2s/(s+1)",
        "(s^2+2s+3)/(s^2+3s+2)",
        "1/(s+1)^2",
    ):
        tf = transfer.parse_expression(text)
        a, b, c, d = tf.to_state_space()
        for point in (0.3 + 0.7j, -0.4 + 0.2j, 1.2 - 0.5j):
            expected = tf.at(point)
            actual = (c @ np.linalg.solve(point * np.eye(a.shape[0]) - a, b) + d)[0, 0]
            assert actual == pytest.approx(expected, rel=1e-10, abs=1e-12)


def test_static_gain_has_no_state_space():
    tf = transfer.parse_expression("5")
    assert tf.is_static is True
    assert tf.to_state_space() is None
    assert tf.gain() == pytest.approx(5.0)


def test_stability_classification():
    assert transfer.parse_expression("1/(s+1)").stability() == "stable"
    assert transfer.parse_expression("1/s").stability() == "marginal"
    assert transfer.parse_expression("1/(s-1)").stability() == "unstable"


def test_bode_first_order():
    report = transfer.bode_data(transfer.parse_expression("1/(s+1)"), omega=[1.0])
    assert report["magnitude"][0] == pytest.approx(1 / math.sqrt(2))
    assert report["magnitude_db"][0] == pytest.approx(-3.0103, abs=1e-3)
    assert report["phase_deg"][0] == pytest.approx(-45.0, abs=1e-6)


def test_step_response_first_order_metrics():
    report = transfer.step_response(
        transfer.parse_expression("1/(s+1)"), dt=0.01, duration=10
    )
    assert report["stable"] is True
    assert report["metrics"]["final"] == pytest.approx(1.0, abs=1e-3)
    assert report["metrics"]["rise_time"] == pytest.approx(2.197, abs=0.05)
    assert report["metrics"]["settling_time"] == pytest.approx(3.91, abs=0.1)
    assert report["metrics"]["steady_state_error"] == pytest.approx(0.0)


def test_step_response_unstable_has_no_metrics():
    report = transfer.step_response(
        transfer.parse_expression("1/(s-1)"), dt=0.01, duration=2
    )
    assert report["stable"] is False
    assert report["metrics"]["final"] is None
    assert report["metrics"]["rise_time"] is None
    assert report["metrics"]["steady_state_error"] is None


def test_analyze_expression_report_shape():
    report = analysis.tf_analysis(
        expr="(2*s+1)/(s^2+3*s+2)", duration=8, points=64
    )
    assert report["ok"] is True
    assert report["dc_gain"] == pytest.approx(0.5)
    assert report["stable"] is True
    assert report["stability"] == "stable"
    assert report["order"] == 2
    assert len(report["bode"]["omega"]) == 64
    assert report["step"]["metrics"]["final"] == pytest.approx(0.5, abs=1e-2)
    assert report["source"].startswith("transfer")


def test_analyze_coefficients_and_zpk():
    report = analysis.tf_analysis(numerator=[1], denominator=[1, 2], duration=6)
    assert report["ok"] is True
    assert report["poles"][0]["real"] == pytest.approx(-2.0)
    report = analysis.tf_analysis(zeros=[-1], poles=[-2], gain=2, duration=6)
    assert report["ok"] is True
    assert report["dc_gain"] == pytest.approx(1.0)


def test_analyze_requires_one_input_form():
    with pytest.raises(analysis.AnalysisError):
        analysis.tf_analysis()
    with pytest.raises(analysis.AnalysisError):
        analysis.tf_analysis(numerator=[1])
    with pytest.raises(analysis.AnalysisError):
        analysis.tf_analysis(expr="1/(s+1")


def test_transfer_node_steps_first_order():
    scene = Scene("signal")
    source = scene.add_node(name="u", kind="manual", data={"voltage": 1.0})
    node = scene.add_node(
        name="g",
        kind="transfer_function",
        params={
            "form": "expr",
            "expr": "1/(s+1)",
            "field": "voltage",
            "output": "voltage",
            "method": "zoh",
        },
    )
    scene.add_edge(source=source.id, target=node.id, kind="pass")
    for _ in range(1000):
        scene.step(0.01)
    assert node.data["voltage"] == pytest.approx(1 - math.exp(-10), rel=1e-3)


def test_transfer_node_static_gain():
    scene = Scene("signal")
    source = scene.add_node(name="u", kind="manual", data={"voltage": 2.0})
    node = scene.add_node(
        name="g",
        kind="transfer_function",
        params={"form": "expr", "expr": "3", "field": "voltage", "output": "voltage"},
    )
    scene.add_edge(source=source.id, target=node.id, kind="pass")
    scene.step(0.01)
    assert node.data["voltage"] == pytest.approx(6.0)


def test_transfer_node_bad_x0_length():
    scene = Scene("signal")
    scene.add_node(
        name="g",
        kind="transfer_function",
        params={"form": "expr", "expr": "1/(s+1)", "x0": [1.0, 2.0]},
    )
    with pytest.raises(ComputeError):
        scene.step(0.01)


def test_symbolic_transfer_function_sees_transfer_node():
    scene = Scene("signal")
    source = scene.add_node(name="u", kind="manual", data={"voltage": 1.0})
    node = scene.add_node(
        name="g",
        kind="transfer_function",
        params={"form": "expr", "expr": "1/(s+1)"},
    )
    scene.add_edge(source=source.id, target=node.id, kind="pass")
    report = analysis.transfer_function(Simulation(scene), "u", "g")
    assert report["ok"] is True
    assert report["denominator_coeffs"] == pytest.approx([1.0, 1.0])


def test_tf_analysis_from_transfer_node():
    scene = Scene("signal")
    scene.add_node(
        name="g",
        kind="transfer_function",
        params={"form": "expr", "expr": "2/(s+1)", "output": "voltage"},
    )
    sim = Simulation(scene)
    try:
        report = analysis.tf_analysis(sim, node="g")
        assert report["ok"] is True
        assert report["dc_gain"] == pytest.approx(2.0)
        assert report["step"]["metrics"]["final"] == pytest.approx(2.0, abs=0.01)
    finally:
        sim.shutdown()


def test_tf_analysis_rejects_non_transfer_node():
    scene = Scene("signal")
    scene.add_node(name="k", kind="gain", params={"gain": 2.0})
    sim = Simulation(scene)
    try:
        with pytest.raises(analysis.AnalysisError):
            analysis.tf_analysis(sim, node="k")
    finally:
        sim.shutdown()


def test_analysis_tf_endpoint(client):
    response = client.post(
        "/api/analysis/tf",
        json={"expr": "(2*s+1)/(s^2+3*s+2)", "duration": 6, "points": 64},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["dc_gain"] == pytest.approx(0.5)
    assert payload["step"]["stable"] is True


def test_analysis_tf_endpoint_rejects_bad_expression(client):
    response = client.post("/api/analysis/tf", json={"expr": "1/(s+1"})
    assert response.status_code == 422
    assert "传递函数" in response.json()["detail"]


def test_underdamped_step_overshoot_uses_response_peak():
    tf = transfer.parse_expression("1/(s^2+0.4*s+1)")
    result = transfer.step_response(tf, duration=20.0, dt=0.01)
    assert result["metrics"]["overshoot_pct"] == pytest.approx(52.66, abs=0.2)


def test_step_response_uses_actual_non_integral_grid():
    tf = transfer.parse_expression("1/(s+1)")
    result = transfer.step_response(tf, duration=1.0, dt=0.3)
    assert result["t"] == pytest.approx([0.0, 0.3, 0.6, 0.9, 1.0])
    assert result["t"][-1] == pytest.approx(1.0)
