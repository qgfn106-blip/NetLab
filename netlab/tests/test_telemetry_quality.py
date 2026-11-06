"""P5：遥测质量口径与只读诊断接口。"""

from __future__ import annotations

from netlab.core.compute.math_accel import diagnostics
from netlab.core.compute.simulation import RECORDER_CAPACITY, Recorder

QUALITY_FIELDS = {
    "sample_dt",
    "quant_bits",
    "interp_error_bound",
    "interp_error_bound_method",
    "fifo_depth",
    "delay_bound",
    "delay_bound_method",
    "assumptions",
}


def test_recorder_quality_schema_is_fixed() -> None:
    recorder = Recorder()
    quality = recorder.quality_snapshot()
    assert QUALITY_FIELDS <= set(quality)
    assert quality["quant_bits"] is None
    assert quality["interp_error_bound"] is None
    assert quality["delay_bound"] is None
    assert quality["fifo_depth"] == RECORDER_CAPACITY
    assert isinstance(quality["assumptions"], list)
    assert quality["assumptions"]

    recorder.push(0.01, {"probe": 1.0}, sample_dt=0.002)
    assert recorder.quality_snapshot()["sample_dt"] == 0.002
    assert recorder.quality_snapshot()["frames_recorded"] == 1

    recorder.clear()
    assert recorder.quality_snapshot()["sample_dt"] is None


def test_telemetry_endpoint_exposes_quality(client) -> None:
    response = client.get("/api/diagnostics/telemetry")
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    telemetry = payload["telemetry"]
    assert QUALITY_FIELDS <= set(telemetry)
    assert {"sim_time", "steps", "running", "frames_recorded", "capacity"} <= set(
        telemetry
    )
    assert telemetry["quant_bits"] is None


def test_live_response_schema_unchanged(client) -> None:
    payload = client.get("/api/live").json()
    assert set(payload) == {"frames", "cursor", "oldest", "keys", "generation", "sim"}


def test_math_accel_diagnostics_endpoint(client) -> None:
    diagnostics.record("p5.test", {"note": "diagnostic only"})
    response = client.get("/api/diagnostics/math-accel", params={"limit": 10})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["events"]["counters"]["p5.test"] >= 1
    assert payload["events"]["capacity"] == 256
