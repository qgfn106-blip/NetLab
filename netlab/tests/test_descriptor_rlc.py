"""线性 RLC 描述符模型（Descriptor）的解析与数值测试。"""

from __future__ import annotations

import math

import numpy as np
import pytest

from netlab.core.common.limits import ComputeError, ValidationError
from netlab.core.compute.circuit import DescriptorIndex, DescriptorModel
from netlab.core.model.scene import Scene
from netlab.core.compute.simulation import Simulation


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


def _rc_high_pass() -> Scene:
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
        name="C1", source=vin.id, target=out.id, kind="capacitor", params={"C": 1.0e-6}
    )
    scene.add_edge(
        name="R1", source=out.id, target=gnd.id, kind="resistor", params={"R": 1000.0}
    )
    return scene


def _series_rlc() -> Scene:
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
        name="L1", source=vin.id, target=mid.id, kind="inductor", params={"L": 1.0e-3}
    )
    scene.add_edge(
        name="R1", source=mid.id, target=out.id, kind="resistor", params={"R": 10.0}
    )
    scene.add_edge(
        name="C1", source=out.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6}
    )
    return scene


def _assert_probe_matches(probe: dict, expected: np.ndarray) -> None:
    assert len(probe["real"]) == len(expected)
    np.testing.assert_allclose(probe["real"], expected.real, rtol=1e-8, atol=1e-10)
    np.testing.assert_allclose(probe["imag"], expected.imag, rtol=1e-8, atol=1e-10)
    np.testing.assert_allclose(
        probe["magnitude"], np.abs(expected), rtol=1e-8, atol=1e-10
    )


def test_rc_low_pass_matches_analytic() -> None:
    scene = _rc_low_pass()
    model = DescriptorModel.from_scene(scene)
    frequencies = [1.0, 10.0, 100.0, 1000.0, 10000.0]
    result = model.frequency_response(frequencies, input_source="V1", probes=["out"])

    omega = 2.0 * math.pi * np.asarray(frequencies)
    expected = 1.0 / (1.0 + 1j * omega * 1000.0 * 1.0e-6)
    probe = result["probes"]["out"]
    _assert_probe_matches(probe, expected)
    np.testing.assert_allclose(
        probe["phase_deg"], np.angle(expected, deg=True), rtol=1e-8, atol=1e-10
    )


def test_rc_high_pass_matches_analytic() -> None:
    scene = _rc_high_pass()
    model = DescriptorModel.from_scene(scene)
    frequencies = [1.0, 10.0, 100.0, 1000.0, 10000.0]
    result = model.frequency_response(frequencies, input_source="V1", probes=["out"])

    omega = 2.0 * math.pi * np.asarray(frequencies)
    expected = (1j * omega * 1000.0 * 1.0e-6) / (
        1.0 + 1j * omega * 1000.0 * 1.0e-6
    )
    _assert_probe_matches(result["probes"]["out"], expected)


def test_series_rlc_resonance() -> None:
    scene = _series_rlc()
    model = DescriptorModel.from_scene(scene)
    inductance = 1.0e-3
    capacitance = 1.0e-6
    resistance = 10.0
    f0 = 1.0 / (2.0 * math.pi * math.sqrt(inductance * capacitance))
    frequencies = np.linspace(0.5 * f0, 1.5 * f0, 401)
    result = model.frequency_response(
        frequencies.tolist(), input_source="V1", probes=["out"]
    )

    omega = 2.0 * math.pi * frequencies
    expected = 1.0 / (
        1.0
        - omega**2 * inductance * capacitance
        + 1j * omega * resistance * capacitance
    )
    probe = result["probes"]["out"]
    _assert_probe_matches(probe, expected)

    magnitudes = np.asarray(probe["magnitude"])
    peak_index = int(np.argmax(magnitudes))
    # 电容电压的谐振峰略低于无阻尼自然频率 f0，解析峰值为：
    # ω_peak = sqrt(1/(LC) - R^2/(2L^2))。
    f_peak = math.sqrt(
        1.0 / (inductance * capacitance) - resistance**2 / (2.0 * inductance**2)
    ) / (2.0 * math.pi)
    assert abs(frequencies[peak_index] - f_peak) / f_peak < 1.0e-2
    assert magnitudes[peak_index] > 3.0


def test_descriptor_matrix_residual() -> None:
    model = DescriptorModel.from_scene(_series_rlc())
    system = model.build("V1")
    for frequency in (10.0, 100.0, 1000.0, 5000.0, 10000.0):
        residual = system.residual(2.0 * math.pi * frequency)
        assert residual < 1.0e-10, f"频率 {frequency} Hz 的残差过大：{residual:.3e}"


def test_descriptor_index_layout() -> None:
    scene = _series_rlc()
    # 使用场景真实 id 建立索引，验证“节点 + 电感 + 电压源”的未知量布局。
    engine = scene.ensure_engine()
    model = DescriptorModel.from_solver(engine.solver)
    index = model.index
    assert isinstance(index, DescriptorIndex)
    assert index.node_count == 3
    assert index.branch_count == 2
    assert index.size == 5
    assert index.inductor_index["L1"] == 3
    assert index.vsource_index["V1"] == 4


def test_frequency_response_shape_and_legacy_parity() -> None:
    scene = _rc_low_pass()
    model = DescriptorModel.from_scene(scene)
    frequencies = [10.0, 100.0, 1000.0, 10000.0]
    descriptor = model.frequency_response(
        frequencies, input_source="V1", probes=["out"]
    )
    legacy = Simulation(scene).ac_sweep(frequencies, input_source="V1", probes=["out"])

    assert set(descriptor) >= {"frequencies", "omega_rad_s", "omega", "probes"}
    assert descriptor["frequencies"] == frequencies
    np.testing.assert_allclose(
        descriptor["omega_rad_s"], 2.0 * math.pi * np.asarray(frequencies)
    )
    for key in ("real", "imag", "magnitude", "phase_deg", "db"):
        np.testing.assert_allclose(
            descriptor["probes"]["out"][key],
            legacy["probes"]["out"][key],
            rtol=1e-8,
            atol=1e-10,
        )


def test_invalid_frequencies_raise() -> None:
    model = DescriptorModel.from_scene(_rc_low_pass())
    with pytest.raises(ValidationError, match="AC 扫频至少需要一个频率点"):
        model.frequency_response([], input_source="V1", probes=["out"])
    for bad in (0.0, -1.0, float("nan"), float("inf")):
        with pytest.raises(ValidationError, match="AC 频率必须为正的有限数"):
            model.frequency_response([bad], input_source="V1", probes=["out"])
    for bad_list in ([100.0, 100.0], [1000.0, 100.0]):
        with pytest.raises(ValidationError, match="AC 频率必须严格递增"):
            model.frequency_response(bad_list, input_source="V1", probes=["out"])


def test_no_input_source_raises() -> None:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(
        name="R1", source=out.id, target=gnd.id, kind="resistor", params={"R": 1000.0}
    )
    scene.add_edge(
        name="C1", source=out.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6}
    )
    model = DescriptorModel.from_scene(scene)
    with pytest.raises(ComputeError, match="至少一个独立源"):
        model.frequency_response([100.0], probes=["out"])


def test_nonlinear_device_raises_clear_error() -> None:
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
    scene.add_edge(name="D1", source=out.id, target=gnd.id, kind="diode", params={})
    with pytest.raises(ComputeError, match="非线性"):
        DescriptorModel.from_scene(scene)


def test_unknown_probe_and_source_raise() -> None:
    model = DescriptorModel.from_scene(_rc_low_pass())
    with pytest.raises(ComputeError, match="AC 探针不存在"):
        model.frequency_response([100.0], input_source="V1", probes=["nope"])
    with pytest.raises(ComputeError, match="找不到激励源"):
        model.frequency_response([100.0], input_source="V9", probes=["out"])
