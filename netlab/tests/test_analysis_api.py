"""R36/P4-P5：分析接口契约回归（网络 TF / 相平面指标）。"""

from __future__ import annotations

import pytest

from netlab.core.model.scene import Scene


def test_analysis_phase_endpoint_returns_metrics(client) -> None:
    response = client.post(
        "/api/analysis/phase",
        json={
            "xs": [1.0, 0.0, -1.0, 0.0, 1.0],
            "ys": [0.0, 1.0, 0.0, -1.0, 0.0],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["points"] == 5
    assert body["path_length"] == pytest.approx(4.0 * 2.0**0.5)
    assert body["enclosed_area"] == pytest.approx(2.0)


def test_analysis_tf_accepts_network_input_output(client) -> None:
    scene = Scene("signal")
    source = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    plant = scene.add_node(
        name="plant",
        kind="transfer_function",
        params={"form": "expr", "expr": "1/(s+1)"},
    )
    scene.add_edge(source=source.id, target=plant.id, kind="pass")

    loaded = client.post("/api/scene", json=scene.to_payload())
    assert loaded.status_code == 200, loaded.text

    response = client.post(
        "/api/analysis/tf",
        json={
            "input_node": "u",
            "output_node": "plant",
            "points": 3,
            "duration": 2.0,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert "1/(s + 1)" in body["expression"]
    assert body["state_space"]["order"] == 1
    assert body["state_space"]["A"][0][0] == pytest.approx(-1.0)
    assert body["state_space"]["D"] == [[0.0]]


def test_analysis_tf_delay_pade_and_peak_time(client) -> None:
    scene = Scene("signal")
    source = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    gain = scene.add_node(name="gain", kind="gain", params={"gain": 2.0})
    plant = scene.add_node(
        name="plant", kind="transfer_function", params={"form": "expr", "expr": "1/(s+1)"}
    )
    scene.add_edge(source=source.id, target=gain.id, kind="pass")
    scene.add_edge(source=gain.id, target=plant.id, kind="scale", delay=True)
    loaded = client.post("/api/scene", json=scene.to_payload())
    assert loaded.status_code == 200, loaded.text

    response = client.post(
        "/api/analysis/tf",
        json={
            "input_node": "u",
            "output_node": "plant",
            "points": 16,
            "duration": 3.0,
            "delay_pade_order": 1,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert "step" in body and "metrics" in body["step"]
    assert body["step"]["metrics"]["peak_value"] is not None

    query = client.get(
        "/api/analysis/transfer",
        params={"input": "u", "output": "plant", "delay_pade_order": 1},
    )
    assert query.status_code == 200, query.text
    report = query.json()
    assert report["ok"] is True
    assert report["delay_pade_order"] == 1
