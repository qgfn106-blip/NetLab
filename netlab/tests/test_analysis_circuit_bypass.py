"""电路小信号旁路分析（Descriptor）API 契约回归。"""

from __future__ import annotations

import pytest

from netlab.core.compute.circuit import DescriptorModel
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


def _diode_scene() -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(
        name="V1",
        source=vin.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 0.7, "amplitude": 1.0},
    )
    scene.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0})
    scene.add_edge(
        name="D1",
        source=out.id,
        target=gnd.id,
        kind="diode",
        params={"Is": 1e-14, "n": 1.0, "temperature": 300.0, "rs": 0.0},
    )
    return scene


def _load(client, scene: Scene) -> None:
    loaded = client.post("/api/scene", json=scene.to_payload())
    assert loaded.status_code == 200, loaded.text


def _circuit_body(**overrides):
    body = {
        "mode": "circuit",
        "input_source": "V1",
        "output": "out",
        "points": 11,
        "f_start": 10.0,
        "f_stop": 1000.0,
        "step_dt": 1.0e-5,
        "step_duration": 5.0e-3,
    }
    body.update(overrides)
    return body


def test_circuit_tf_returns_descriptor_state_space_poles_and_step(client) -> None:
    scene = _rc_low_pass()
    _load(client, scene)

    response = client.post("/api/analysis/tf", json=_circuit_body())
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["domain"] == "circuit"
    assert body["mode"] == "circuit"

    state_space = body["state_space"]
    assert state_space["realization"] == "descriptor"
    assert state_space["complex"] is True
    assert state_space["n"] >= 1
    assert state_space["m"] == 1
    assert state_space["p"] == 1
    assert len(state_space["A"]) == state_space["n"]
    assert len(state_space["A"][0]) == state_space["n"]
    assert len(state_space["A"][0][0]) == 2

    poles = body["poles"]
    assert poles["infinite_count"] >= 1
    assert any(
        abs(value[0] + 1000.0) < 1e-6 and abs(value[1]) < 1e-9
        for value in poles["finite"]
    )
    assert body["zeros"]["finite"] == []
    assert body["zeros"]["siso"] is True

    step = body["step"]
    assert step["probe"] == "out"
    assert len(step["times"]) == len(step["values"])
    assert 0.9 < step["values"][-1] < 1.01

    bode = body["bode"]
    assert bode["probes"]["out"]["magnitude"]
    assert len(bode["frequencies"]) == 11

    transfer = body["transfer_function"]
    assert transfer["supported"] is True
    assert transfer["order"] == 1
    assert "1000" in transfer["expression"]
    assert transfer["dc_gain"] == pytest.approx(1.0)
    assert transfer["dc_gain_finite"] is True
    metrics = body["metrics"]
    assert metrics["final"] == pytest.approx(1.0, abs=1e-6)
    assert metrics["rise_time"] == pytest.approx(0.0022, rel=0.05)
    assert metrics["steady_state_error"] == pytest.approx(0.0, abs=1e-6)


def test_circuit_bode_uses_descriptor_and_matches_direct_model(client) -> None:
    scene = _rc_low_pass()
    _load(client, scene)

    response = client.post(
        "/api/analysis/tf",
        json=_circuit_body(points=3, f_start=10.0, f_stop=1000.0),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["bode"]["frequencies"] == pytest.approx([10.0, 100.0, 1000.0])

    direct = DescriptorModel.from_scene(scene).frequency_response(
        [10.0, 100.0, 1000.0], input_source="V1", probes=["out"]
    )
    assert body["bode"]["probes"]["out"]["magnitude"] == pytest.approx(
        direct["probes"]["out"]["magnitude"], rel=1e-9
    )


def test_circuit_tf_signal_mode_is_unchanged(client) -> None:
    scene = Scene("signal")
    source = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    plant = scene.add_node(
        name="plant",
        kind="transfer_function",
        params={"form": "expr", "expr": "1/(s+1)"},
    )
    scene.add_edge(source=source.id, target=plant.id, kind="pass")
    _load(client, scene)

    response = client.post(
        "/api/analysis/tf",
        json={
            "mode": "signal",
            "input_node": "u",
            "output_node": "plant",
            "points": 3,
            "duration": 2.0,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["state_space"]["order"] == 1
    assert "1/(s + 1)" in body["expression"]

    default = client.post(
        "/api/analysis/tf",
        json={
            "input_node": "u",
            "output_node": "plant",
            "points": 3,
            "duration": 2.0,
        },
    )
    assert default.status_code == 200, default.text
    explicit_body = dict(body)
    default_body = dict(default.json())
    explicit_body.pop("elapsed_ms", None)
    default_body.pop("elapsed_ms", None)
    assert default_body == explicit_body


def test_circuit_tf_rejects_mode_mismatch_and_missing_io(client) -> None:
    signal_scene = Scene("signal")
    source = signal_scene.add_node(name="u", kind="manual", data={"value": 1.0})
    plant = signal_scene.add_node(
        name="plant",
        kind="transfer_function",
        params={"form": "expr", "expr": "1/(s+1)"},
    )
    signal_scene.add_edge(source=source.id, target=plant.id, kind="pass")
    _load(client, signal_scene)

    mismatch = client.post("/api/analysis/tf", json=_circuit_body())
    assert mismatch.status_code == 422, mismatch.text
    assert "mode=circuit" in mismatch.text

    circuit_scene = _rc_low_pass()
    _load(client, circuit_scene)
    signal_mode = client.post(
        "/api/analysis/tf",
        json={"mode": "signal", "input_source": "V1", "output": "out"},
    )
    assert signal_mode.status_code == 422, signal_mode.text
    assert "mode=signal" in signal_mode.text

    missing = client.post("/api/analysis/tf", json={"mode": "circuit", "points": 3})
    assert missing.status_code == 422, missing.text


def test_circuit_tf_nonlinear_requires_operating_point(client) -> None:
    scene = _diode_scene()
    _load(client, scene)

    rejected = client.post("/api/analysis/tf", json=_circuit_body())
    assert rejected.status_code == 422, rejected.text
    assert "operating_point" in rejected.text or "工作点" in rejected.text

    operating_point = scene.operating_point()["node_voltages"]
    accepted = client.post(
        "/api/analysis/tf",
        json=_circuit_body(operating_point=operating_point),
    )
    assert accepted.status_code == 200, accepted.text
    body = accepted.json()
    assert body["operating_point_supplied"] is True
    assert body["state_space"]["n"] >= 1
    assert body["step"]["values"]
