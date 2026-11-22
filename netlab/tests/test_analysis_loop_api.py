"""断环 / Nyquist API 契约回归。"""

from __future__ import annotations

import pytest

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
        params={
            "gain": 1.0e5,
            "control_source": vin.id,
            "control_target": control.id,
        },
    )
    scene.add_edge(name="R1", source=control.id, target=gnd.id, kind="resistor", params={"R": 1000.0})
    scene.add_edge(name="R2", source=out.id, target=control.id, kind="resistor", params={"R": 9000.0})
    return scene


def _load(client, scene: Scene) -> None:
    loaded = client.post("/api/scene", json=scene.to_payload())
    assert loaded.status_code == 200, loaded.text


def _body(**overrides):
    body = {
        "element": "E1",
        "input_source": "V1",
        "output": "out",
        "f_start": 10.0,
        "f_stop": 100000.0,
        "points": 41,
        "scale": "log",
    }
    body.update(overrides)
    return body


def test_break_candidates_list_controlled_sources(client) -> None:
    _load(client, _vcvs_amplifier())
    response = client.post("/api/analysis/loops", json={})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert [item["element"] for item in body["candidates"]] == ["E1"]
    candidate = body["candidates"][0]
    assert candidate["kind"] == "vcvs"
    assert candidate["control_a"] == "vin"
    assert candidate["control_b"] == "n"


def test_loop_candidates_endpoint_lists_circuit_breaks(client) -> None:
    _load(client, _vcvs_amplifier())
    response = client.post("/api/analysis/loops/candidates", json={})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["mode"] == "circuit"
    assert body["loops"] == []
    assert [item["element"] for item in body["break_candidates"]] == ["E1"]


def test_loop_from_break_endpoint_returns_member_loop(client) -> None:
    _load(client, _vcvs_amplifier())
    response = client.post("/api/analysis/loops/from-break", json={"break_id": "R2"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["mode"] == "circuit"
    assert set(body["loop"]["member_edge_names"]) == {"E1", "R1", "R2"}
    assert body["loop"]["suggested_break_id"] == body["loop"]["candidate_breaks"][0]["break_id"]


def test_loop_endpoint_returns_loop_gain_and_parity(client) -> None:
    _load(client, _vcvs_amplifier())
    response = client.post("/api/analysis/loop", json=_body())
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["kind"] == "loop"
    assert body["element"] == "E1"
    assert body["break_kind"] == "vcvs"
    assert body["parity_max_rel"] < 1e-6
    gain = complex(*body["loop_gain"][0])
    assert abs(gain) == 1.0e4
    closed = complex(*body["closed_loop"][0])
    assert abs(closed) == pytest.approx(1e5 / (1.0 + 1e4), rel=1e-9)
    envelope = body["envelopes"]["bode"]
    assert envelope["schema"] == "netlab-analysis-result/1"
    assert envelope["kind"] == "bode"
    assert envelope["axes"][0]["id"] == "f"
    assert len(envelope["curves"]) == 2


def test_loop_probe_resolves_controlled_source_without_fixture(client) -> None:
    _load(client, _vcvs_amplifier())
    response = client.post(
        "/api/analysis/loop",
        json=_body(element="", loop_probe={"break_id": "R2"}),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["probe"] == "virtual_branch"
    assert body["element"] == "E1"
    assert body["loop_id"].startswith("loop-")
    analytic = body["open_loop_transfer_function"]
    assert analytic["supported"] is True
    assert "10000" in analytic["expression"]
    assert analytic["parity_max_rel"] < 1e-6


def test_nyquist_endpoint_reports_p_n_z(client) -> None:
    _load(client, _vcvs_amplifier())
    response = client.post("/api/analysis/nyquist", json=_body(points=201))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["kind"] == "nyquist"
    metrics = body["metrics"]
    assert metrics["poles_right_half_plane"] == 0
    assert metrics["encirclements_ccw"] == 0
    assert metrics["closed_loop_right_half_plane"] == 0
    assert metrics["stable"] is True
    envelope = body["envelopes"]["nyquist"]
    assert envelope["schema"] == "netlab-analysis-result/1"
    assert envelope["kind"] == "nyquist"
    assert envelope["markers"][0]["shape"] == "nyquist_crit"


def test_loop_endpoint_rejects_unknown_element(client) -> None:
    _load(client, _vcvs_amplifier())
    response = client.post("/api/analysis/loop", json=_body(element="R1"))
    assert response.status_code == 422, response.text
