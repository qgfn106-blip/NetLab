"""分析结果契约 `netlab-analysis-result/1` 的结构与工具函数测试。"""

from __future__ import annotations

import math

import pytest

from netlab.core.common.limits import ComputeError, ValidationError
from netlab.core.compute.circuit import analysis_contract as contract


def _simple_envelope() -> dict:
    f = [1.0, 10.0, 100.0]
    gain = [-20.0, -40.0, -60.0]
    return contract.envelope(
        "bode",
        source={"frequency_path": "descriptor_linearized"},
        axes=[
            contract.axis("f", "频率", "Hz", f, scale="log10"),
            contract.axis("mag_db", "幅值", "dB", gain),
        ],
        curves=[
            contract.curve(
                "gain_db",
                label="G",
                x_axis="f",
                y_axis="mag_db",
                x=f,
                y=gain,
            )
        ],
        markers=[
            contract.marker(
                "p1",
                shape="pole",
                x=10.0,
                y=-40.0,
                label="极点 1",
                category="stability",
                detail={"freq_hz": 10.0},
            )
        ],
        metrics={"bandwidth_hz": 10.0},
        fingerprint=contract.fingerprint({"circuit": "demo"}),
    )


def test_envelope_roundtrip_validates() -> None:
    payload = contract.validate_envelope(_simple_envelope())
    assert payload["schema"] == contract.SCHEMA
    assert payload["kind"] == "bode"
    assert payload["axes"][0]["n"] == 3
    assert payload["curves"][0]["axes"] == ["f", "mag_db"]
    assert len(payload["fingerprint"]) == 64


def test_envelope_rejects_duplicate_axis_ids() -> None:
    with pytest.raises(ValidationError):
        contract.envelope(
            "bode",
            source={},
            axes=[
                contract.axis("f", "频率", "Hz", [1.0, 2.0]),
                contract.axis("f", "频率", "Hz", [1.0, 2.0]),
            ],
            curves=[],
        )


def test_curve_rejects_unknown_axis_reference() -> None:
    envelope = _simple_envelope()
    envelope["curves"][0]["axes"] = ["f", "missing"]
    with pytest.raises(ValidationError):
        contract.validate_envelope(envelope)


def test_contract_rejects_non_finite_values() -> None:
    with pytest.raises(ValidationError):
        contract.axis("f", "频率", "Hz", [1.0, math.inf])
    with pytest.raises(ValidationError):
        contract.curve(
            "gain_db",
            label="G",
            x_axis="f",
            y_axis="mag_db",
            x=[1.0, 10.0],
            y=[0.0, math.nan],
        )


def test_contract_rejects_unknown_marker_shape() -> None:
    with pytest.raises(ValidationError):
        contract.marker("x", shape="star", x=1.0, y=2.0, label="?")


def test_contract_rejects_non_positive_log_axis() -> None:
    with pytest.raises(ValidationError):
        contract.axis("f", "频率", "Hz", [0.0, 10.0], scale="log10")


def test_local_slope_matches_minus_20db_per_decade() -> None:
    frequencies = [1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0]
    values = [-20.0 * math.log10(item) for item in frequencies]
    for index in range(1, len(frequencies) - 1):
        slope = contract.local_slope(frequencies, values, index)
        assert slope is not None
        assert abs(slope + 20.0) < 1e-9


def test_first_crossing_and_nearest_index() -> None:
    frequencies = [1.0, 10.0, 100.0, 1000.0]
    values = [20.0, 10.0, -5.0, -30.0]
    index = contract.first_crossing(frequencies, values, 0.0)
    assert index == 2
    assert contract.nearest_index(frequencies, 90.0) == 2
    assert contract.first_crossing(frequencies, values, 0.0, rising=True) is None


def test_fingerprint_is_stable_and_sensitive() -> None:
    first = contract.fingerprint({"a": 1.0, "b": [1, 2]})
    second = contract.fingerprint({"b": [1, 2], "a": 1.0})
    assert first == second
    assert contract.fingerprint({"a": 1.0, "b": [1, 3]}) != first


def test_complex_axes_split_real_and_imag() -> None:
    x_axis, y_axis, real, imag = contract.complex_axes("ny", label="L(jw)", values=[1 + 2j, -3 - 4j])
    assert real == [1.0, -3.0]
    assert imag == [2.0, -4.0]
    assert x_axis["id"] == "ny_re" and y_axis["id"] == "ny_im"
    assert x_axis["n"] == y_axis["n"] == 2


def test_warning_and_metrics_rounding() -> None:
    item = contract.warning("loop_parity_failed", "闭环校验超差", severity="warning", max_rel=1e-7)
    assert item["code"] == "loop_parity_failed"
    assert item["max_rel"] == 1e-7
