"""P3 分析旁路：指标/频谱/周期/传递函数/CSV/超时保护。"""

from __future__ import annotations

import json

import pytest

from netlab.core.compute import analysis
from netlab.core.model.scene import Scene
from netlab.core.compute.simulation import Simulation


def make_sim(series, dt=0.01):
    sim = Simulation(Scene("signal"))
    for index, value in enumerate(series):
        sim.recorder.push(round(index * dt, 9), {"n:out:voltage": float(value)})
    return sim


def step_series(n=400):
    return [1.0 - pow(2.718281828, -t / 40.0) for t in range(n)]


def sine_series(n=400, dt=0.01, freq=5.0):
    import math

    return [math.sin(2 * math.pi * freq * index * dt) for index in range(n)]


def test_metrics_step_response():
    report = analysis.analyze_metrics(make_sim(step_series()))
    item = report["items"]["n:out:voltage"]
    assert item["ok"] is True
    assert item["final"] == pytest.approx(1.0, abs=0.05)
    assert item["rise_time"] is not None and item["rise_time"] > 0
    assert item["settling_time"] is not None
    assert "source" in item


def test_spectrum_peak_and_period():
    sim = make_sim(sine_series())
    spec = analysis.spectrum(sim, "n:out:voltage")
    assert spec["ok"] is True
    assert spec["peaks"][0]["freq"] == pytest.approx(5.0, abs=0.1)
    period = analysis.recommend_period(sim, "n:out:voltage")
    assert period["ok"] is True
    assert period["period"] == pytest.approx(0.2, abs=0.02)
    assert period["candidates"]


def test_period_diagnoses_nonperiodic():
    sim = make_sim(step_series())
    period = analysis.recommend_period(sim, "n:out:voltage")
    assert period["ok"] is False
    assert "reason" in period


def test_math_forms_lists_formulas():
    sim = make_sim(step_series())
    report = analysis.math_forms(sim)
    assert report["ok"] is True
    assert isinstance(report["rows"], list)


def test_transfer_function_gain_and_integrator():
    scene = Scene("signal")
    source = scene.add_node(name="u", kind="manual", data={"voltage": 1.0})
    gain = scene.add_node(name="k", kind="gain", params={"gain": 2.0})
    integrate = scene.add_node(name="i", kind="integrate", params={"gain": 3.0})
    scene.add_edge(source=source.id, target=gain.id, kind="pass")
    scene.add_edge(source=gain.id, target=integrate.id, kind="pass")
    sim = Simulation(scene)
    try:
        assert analysis.transfer_function(sim, "u", "k")["ok"] is True
        assert analysis.transfer_function(sim, "u", "k")["expression"] == "2"
        result = analysis.transfer_function(sim, "u", "i")
        assert result["ok"] is True
        assert "6" in result["expression"] and "s" in result["expression"]
        bad = analysis.transfer_function(sim, "u", "nope")
        assert bad["ok"] is False
    finally:
        sim.shutdown()


def test_transfer_function_ignores_other_sources():
    scene = Scene("signal")
    u1 = scene.add_node(name="u1", kind="manual", data={"voltage": 1.0})
    u2 = scene.add_node(name="u2", kind="manual", data={"voltage": 2.0})
    total = scene.add_node(name="sum", kind="sum", params={})
    out = scene.add_node(name="out", kind="gain", params={"gain": 5.0})
    scene.add_edge(source=u1.id, target=total.id, kind="pass")
    scene.add_edge(source=u2.id, target=total.id, kind="pass")
    scene.add_edge(source=total.id, target=out.id, kind="pass")
    sim = Simulation(scene)
    try:
        result = analysis.transfer_function(sim, "u1", "out")
        assert result["ok"] is True, result
        assert result["expression"] == "5"
    finally:
        sim.shutdown()


def test_export_csv_metadata_and_unique_names(tmp_path):
    sim = make_sim(step_series(120))
    first = analysis.export_csv(
        sim,
        directory=tmp_path,
        network_name="网络 1",
        decimate=2,
        name="sig",
    )
    assert first["rows"] == 60
    text = open(first["path"], encoding="utf-8").read()
    assert "# network: 网络 1" in text
    assert "time,网络 1.out.voltage" in text
    second = analysis.export_csv(
        sim, directory=tmp_path, network_name="网络 1", name="sig"
    )
    assert second["path"].endswith("sig-2.csv")


def test_timeout_guard_raises():
    import time as _time

    with pytest.raises(analysis.AnalysisError, match="超时"):
        analysis.run_with_timeout(lambda: _time.sleep(0.3), seconds=0.05, label="测试")


def test_analysis_api(client, tmp_path, monkeypatch):
    monkeypatch.setenv("NETLAB_SETTINGS_DIR", str(tmp_path / "settings"))
    project = tmp_path / "lab" / "proj"
    created = client.post(
        "/api/workspace/create", json={"path": str(project), "name": "分析"}
    )
    assert created.status_code == 200, created.text
    # 跑几步产生录制
    client.patch(
        "/api/config", json={"dt": 0.01, "steps_per_frame": 1, "realtime": False}
    )
    for _ in range(30):
        client.post("/api/control", json={"action": "step", "steps": 1})
    metrics = client.get("/api/analysis/metrics")
    assert metrics.status_code == 200, metrics.text
    assert metrics.json()["ok"] is True
    key = next(iter(metrics.json()["items"]))
    spectrum = client.get("/api/analysis/spectrum", params={"key": key})
    assert spectrum.status_code == 200, spectrum.text
    exported = client.post(
        "/api/analysis/export", json={"name": "api-sig", "decimate": 1}
    )
    assert exported.status_code == 200, exported.text
    body = exported.json()
    assert body["rows"] > 0
    assert body["path"].startswith(str(project / "exports"))
    assert json.loads(json.dumps(body))["ok"] is True


def test_step_timeout_config_protects(client):
    client.patch("/api/config", json={"step_timeout_ms": 0.000001})
    client.post("/api/control", json={"action": "step", "steps": 1})
    state = client.get("/api/state").json()
    assert state["sim"]["error"] and "超时" in state["sim"]["error"]
    client.patch("/api/config", json={"step_timeout_ms": 0})
    client.post("/api/control", json={"action": "reset"})
