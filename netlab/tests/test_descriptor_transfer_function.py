"""Descriptor SISO 传递函数边界与解析对拍测试。"""

from __future__ import annotations

import numpy as np
import pytest

from netlab.core.common.limits import ComputeError, ValidationError
from netlab.core.compute.circuit import DescriptorModel
from netlab.core.compute.circuit.descriptor_analysis import (
    UnsupportedAnalysisError,
    analyze_zeros,
    build_output_matrices,
    descriptor_transfer_function,
)
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
    scene.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0})
    scene.add_edge(name="C1", source=out.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6})
    return scene


def _rlc_low_pass() -> Scene:
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
    scene.add_edge(name="R1", source=vin.id, target=mid.id, kind="resistor", params={"R": 10.0})
    scene.add_edge(name="L1", source=mid.id, target=out.id, kind="inductor", params={"L": 1.0e-3})
    scene.add_edge(name="C1", source=out.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6})
    return scene


def _buffered_cascade() -> Scene:
    """两个经理想 VCVS 隔离的 RC 节，形成 -1000 rad/s 重根。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    a = scene.add_node(name="a", kind="node")
    b = scene.add_node(name="b", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(
        name="V1",
        source=vin.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 0.0, "amplitude": 1.0},
    )
    scene.add_edge(name="R1", source=vin.id, target=a.id, kind="resistor", params={"R": 1000.0})
    scene.add_edge(name="C1", source=a.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6})
    scene.add_edge(
        name="E1",
        source=b.id,
        target=gnd.id,
        kind="vcvs",
        params={"gain": 1.0, "control_source": a.id, "control_target": gnd.id},
    )
    scene.add_edge(name="R2", source=b.id, target=out.id, kind="resistor", params={"R": 1000.0})
    scene.add_edge(name="C2", source=out.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6})
    return scene


def _integrator() -> Scene:
    """电流源驱动电容：H(s)=1/(C s)，DC 增益无穷。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(
        name="I1",
        source=gnd.id,
        target=out.id,
        kind="isource",
        params={"wave": "dc", "offset": 0.0, "amplitude": 1.0},
    )
    scene.add_edge(name="C1", source=out.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6})
    return scene


def _lead_near_cancellation() -> Scene:
    """R1 远小于 R2 的滞后-超前网络，零点与极点接近对消。"""
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
    scene.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0})
    scene.add_edge(name="R2", source=out.id, target=gnd.id, kind="resistor", params={"R": 1.0e9})
    scene.add_edge(name="C1", source=vin.id, target=out.id, kind="capacitor", params={"C": 1.0e-6})
    return scene


def _parallel_ladder(count: int) -> Scene:
    """电流源驱动的 count 节 RC 梯形，Descriptor 阶数恰为 count。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    first = scene.add_node(name="n0", kind="node")
    scene.add_edge(
        name="I1",
        source=gnd.id,
        target=first.id,
        kind="isource",
        params={"wave": "dc", "offset": 0.0, "amplitude": 1.0},
    )
    nodes = [first]
    for index in range(count):
        if index:
            nodes.append(scene.add_node(name=f"n{index}", kind="node"))
        node = nodes[index]
        scene.add_edge(
            name=f"C{index}",
            source=node.id,
            target=gnd.id,
            kind="capacitor",
            params={"C": 1.0e-6},
        )
        scene.add_edge(
            name=f"R{index}",
            source=node.id,
            target=gnd.id,
            kind="resistor",
            params={"R": 1000.0},
        )
        if index:
            scene.add_edge(
                name=f"Rc{index}",
                source=nodes[index - 1].id,
                target=node.id,
                kind="resistor",
                params={"R": 100.0},
            )
    return scene


def _transfer(scene: Scene, input_source: str, output: str) -> dict:
    return descriptor_transfer_function(
        DescriptorModel.from_scene(scene), input_source=input_source, output=output
    )


def test_rc_low_pass_analytic_magnitude_and_phase():
    transfer = _transfer(_rc_low_pass(), "V1", "out")
    assert transfer["supported"] is True
    assert transfer["expression"] == "(1000) / (s + 1000)"
    assert transfer["poles"] == [[-1000.0, 0.0]]
    assert transfer["zeros"] == []
    assert transfer["dc_gain"] == pytest.approx(1.0, rel=1e-12)

    frequencies = np.asarray([10.0, 100.0, 1000.0, 10000.0])
    numerator = np.asarray(transfer["numerator_coeffs"], dtype=float)
    denominator = np.asarray(transfer["denominator_coeffs"], dtype=float)
    actual = np.polyval(numerator, 1j * frequencies) / np.polyval(
        denominator, 1j * frequencies
    )
    expected = 1.0 / (1.0 + 1j * frequencies / 1000.0)
    np.testing.assert_allclose(actual, expected, rtol=1e-10, atol=1e-12)


def test_rlc_low_pass_analytic_poles_and_coefficients():
    transfer = _transfer(_rlc_low_pass(), "V1", "out")
    assert transfer["supported"] is True
    assert transfer["order"] == 2
    assert transfer["relative_order"] == 2
    poles = np.asarray([complex(*item) for item in transfer["poles"]])
    expected = np.asarray([-5000.0 + 31224.989991991995j, -5000.0 - 31224.989991991995j])
    np.testing.assert_allclose(np.sort(poles.real), np.sort(expected.real), rtol=1e-9)
    np.testing.assert_allclose(np.sort(poles.imag), np.sort(expected.imag), rtol=1e-9)
    assert all(isinstance(value, (int, float)) for value in transfer["numerator_coeffs"])
    assert all(isinstance(value, (int, float)) for value in transfer["denominator_coeffs"])
    assert transfer["dc_gain"] == pytest.approx(1.0, rel=1e-9)


def test_repeated_poles_are_preserved():
    transfer = _transfer(_buffered_cascade(), "V1", "out")
    assert transfer["supported"] is True
    assert transfer["order"] == 2
    assert transfer["denominator"] == "s^2 + 2000s + 1000000"
    poles = sorted((complex(*item) for item in transfer["poles"]), key=lambda value: value.real)
    assert poles[0] == pytest.approx(-1000.0, abs=1e-8)
    assert poles[1] == pytest.approx(-1000.0, abs=1e-8)
    assert transfer["denominator_coeffs"] == pytest.approx([1.0, 2000.0, 1000000.0], rel=1e-9)


def test_pure_integrator_reports_infinite_dc_gain():
    transfer = _transfer(_integrator(), "I1", "out")
    assert transfer["supported"] is True
    assert transfer["expression"] == "(1000000) / (s)"
    assert transfer["poles"] == [[0.0, 0.0]]
    assert transfer["dc_gain"] is None
    assert transfer["dc_gain_finite"] is False


def test_near_zero_pole_zero_pair_is_stable():
    transfer = _transfer(_lead_near_cancellation(), "V1", "out")
    assert transfer["supported"] is True
    assert transfer["relative_order"] == 0
    assert transfer["dc_gain"] == pytest.approx(1.0, rel=1e-5)
    zero = complex(*transfer["zeros"][0])
    pole = complex(*transfer["poles"][0])
    assert abs(zero - pole) < 0.01
    assert abs(zero.real + 1000.0) < 0.01


def test_order_64_supported_and_order_65_rejected():
    supported = descriptor_transfer_function(
        DescriptorModel.from_scene(_parallel_ladder(64)), input_source="I1", output="n63"
    )
    assert supported["supported"] is True
    assert supported["order"] == 64

    rejected = descriptor_transfer_function(
        DescriptorModel.from_scene(_parallel_ladder(65)), input_source="I1", output="n64"
    )
    assert rejected["supported"] is False
    assert rejected["order"] == 65
    assert "64" in rejected["reason"]


def test_invalid_input_and_output_are_reported():
    model = DescriptorModel.from_scene(_rc_low_pass())
    with pytest.raises(ComputeError):
        descriptor_transfer_function(model, input_source="NOPE", output="out")
    with pytest.raises(ComputeError):
        descriptor_transfer_function(model, input_source="V1", output="NOPE")


def test_descriptor_transfer_function_requires_descriptor_model():
    with pytest.raises(ValidationError):
        descriptor_transfer_function(object(), input_source="V1", output="out")


def test_mimo_zero_extraction_is_rejected():
    model = DescriptorModel.from_scene(_rc_low_pass())
    system = model.build("V1")
    c_matrix, d_matrix = build_output_matrices(model, "out", input_source="V1")
    c_mimo = np.vstack([c_matrix, c_matrix])
    d_mimo = np.vstack([d_matrix, d_matrix])
    with pytest.raises(UnsupportedAnalysisError):
        analyze_zeros(system, C=c_mimo, D=d_mimo)
