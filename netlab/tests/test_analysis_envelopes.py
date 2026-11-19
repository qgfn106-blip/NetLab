"""分析信封（netlab-analysis-result/1）构建与接线回归。"""

from __future__ import annotations

import math

import numpy as np
import pytest

from netlab.core.compute.circuit import DescriptorModel
from netlab.core.compute.circuit.analysis_contract import validate_envelope
from netlab.core.compute.circuit.analysis_envelopes import (
    bode_envelope,
    scene_fingerprint,
    step_envelope,
)
from netlab.core.model.scene import Scene


def _rc_low_pass(capacitance: float = 1.0e-6) -> Scene:
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
    scene.add_edge(name="C1", source=out.id, target=gnd.id, kind="capacitor", params={"C": capacitance})
    return scene


def _high_pass_bode() -> tuple[np.ndarray, np.ndarray, np.ndarray, float]:
    corner = 159.15494309189535
    frequencies = np.logspace(0.0, 6.0, 241)
    ratio = (1j * frequencies / corner) / (1.0 + 1j * frequencies / corner)
    magnitude_db = 20.0 * np.log10(np.maximum(np.abs(ratio), 1e-300))
    phase_deg = np.degrees(np.angle(ratio))
    return frequencies, magnitude_db, phase_deg, corner


def test_bode_envelope_builds_valid_axes_curves_and_slope() -> None:
    frequencies, magnitude_db, phase_deg, corner = _high_pass_bode()
    payload = bode_envelope(
        frequencies=frequencies,
        magnitude_db=magnitude_db,
        phase_deg=phase_deg,
        source={"input_source": "V1", "output": "out"},
        output="out",
        fingerprint_value="0" * 64,
    )
    validate_envelope(payload)
    assert payload["schema"] == "netlab-analysis-result/1"
    assert payload["kind"] == "bode"
    assert [item["id"] for item in payload["axes"]] == ["f", "mag_db", "phase_deg"]
    assert payload["axes"][0]["scale"] == "log10"
    assert [item["id"] for item in payload["curves"]] == ["bode_mag", "bode_phase"]
    assert payload["curves"][0]["n"] == frequencies.size

    slopes = payload["curves"][0]["detail"]["slope_db_per_dec"]
    assert len(slopes) == frequencies.size
    corner_index = int(np.argmin(np.abs(frequencies - corner)))
    assert slopes[corner_index] == pytest.approx(10.0, abs=1.0)  # 高通在转折点附近约为 +10 dB/dec

    phase_slopes = payload["curves"][1]["detail"]["slope_deg_per_dec"]
    assert phase_slopes[corner_index] == pytest.approx(-66.0, abs=8.0)


def test_bode_envelope_marks_0db_crossing_and_peak() -> None:
    corner = 100.0
    frequencies = np.logspace(0.0, 5.0, 401)
    ratio = 2.0 / (1.0 + 1j * frequencies / corner)
    magnitude_db = 20.0 * np.log10(np.abs(ratio))
    phase_deg = np.degrees(np.angle(ratio))
    payload = bode_envelope(
        frequencies=frequencies,
        magnitude_db=magnitude_db,
        phase_deg=phase_deg,
        source={"input_source": "V1", "output": "out"},
        output="out",
    )
    markers = {item["id"]: item for item in payload["markers"]}
    crossing = markers["cross-0db"]
    assert crossing["shape"] == "cross_gain"
    assert crossing["x"] == pytest.approx(corner * math.sqrt(3.0), rel=0.02)
    assert crossing["y"] == 0.0
    assert "slope_db_per_dec" in crossing["detail"]
    assert "peak" in markers


def test_bode_envelope_pole_marker_frequency() -> None:
    scene = _rc_low_pass()
    model = DescriptorModel.from_scene(scene)
    bode = model.frequency_response([10.0, 100.0, 1000.0], input_source="V1", probes=["out"])
    probe = bode["probes"]["out"]
    payload = bode_envelope(
        frequencies=bode["frequencies"],
        magnitude_db=probe["db"],
        phase_deg=probe["phase_deg"],
        source={"input_source": "V1", "output": "out"},
        output="out",
        poles=[[-1000.0, 0.0]],
    )
    pole = next(item for item in payload["markers"] if item["shape"] == "pole")
    assert pole["x"] == pytest.approx(1000.0 / (2.0 * math.pi), rel=1e-9)


def test_step_envelope_adds_peak_and_settling_markers() -> None:
    times = np.linspace(0.0, 0.01, 501)
    values = 1.0 - np.exp(-times / 0.001)
    payload = step_envelope(
        times=times,
        values=values,
        source={"input_source": "V1", "output": "out"},
        output="out",
        metrics={
            "peak_time": 0.004,
            "peak_value": 1.2,
            "settling_time": 0.005,
            "rise_time": 0.002,
        },
    )
    validate_envelope(payload)
    assert payload["kind"] == "time"
    assert [item["id"] for item in payload["curves"]] == ["step"]
    markers = {item["id"] for item in payload["markers"]}
    assert markers == {"peak", "settling", "rise"}


def test_scene_fingerprint_is_stable_and_sensitive() -> None:
    first = scene_fingerprint(_rc_low_pass(), {"points": 11})
    again = scene_fingerprint(_rc_low_pass(), {"points": 11})
    changed = scene_fingerprint(_rc_low_pass(2.0e-6), {"points": 11})
    different_params = scene_fingerprint(_rc_low_pass(), {"points": 21})
    assert first == again
    assert first != changed
    assert first != different_params
    assert len(first) == 64


def test_circuit_tf_endpoint_attaches_valid_envelopes(client) -> None:
    scene = _rc_low_pass()
    loaded = client.post("/api/scene", json=scene.to_payload())
    assert loaded.status_code == 200, loaded.text
    response = client.post(
        "/api/analysis/tf",
        json={
            "mode": "circuit",
            "input_source": "V1",
            "output": "out",
            "points": 11,
            "f_start": 10.0,
            "f_stop": 1000.0,
            "step_dt": 1.0e-5,
            "step_duration": 5.0e-3,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    envelopes = body["envelopes"]
    validate_envelope(envelopes["bode"])
    validate_envelope(envelopes["time"])
    assert envelopes["bode"]["curves"][0]["n"] == 11
    assert envelopes["time"]["curves"][0]["n"] == len(body["step"]["times"])
    assert body["fingerprint"] == envelopes["bode"]["fingerprint"]
    assert len(body["fingerprint"]) == 64
    assert envelopes["bode"]["metrics"]["metrics"]["stable"] is True
