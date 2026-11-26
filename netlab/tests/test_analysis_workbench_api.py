"""分析工作台 HTTP API：会话、状态、执行、对比、失效与导出。"""

from __future__ import annotations

import json

from netlab.core.model.scene import Scene


def _rc_payload(label: str = "RC") -> dict:
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
    return {
        "label": label,
        "circuit": scene.to_payload(include_state=False),
        "input_source": "V1",
        "output": "out",
        "ranges": {"f_start": 1.0, "f_stop": 1.0e5, "points": 41},
    }


def _new_session(client, name: str = "API 会话") -> str:
    response = client.post("/api/analysis/workbench/sessions", json={"name": name})
    assert response.status_code == 200, response.text
    return response.json()["session"]["session_id"]


def _add_state(client, session_id: str, label: str = "RC") -> str:
    response = client.post(
        "/api/analysis/workbench/state",
        json={
            "session_id": session_id,
            "action": "add",
            "state": _rc_payload(label),
            "select": True,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["state"]["state_id"]


def _run(client, session_id: str, state_id: str, kind: str = "bode") -> dict:
    response = client.post(
        "/api/analysis/workbench/run",
        json={"session_id": session_id, "state_id": state_id, "kind": kind},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_workbench_session_state_run_compare_invalidate(client) -> None:
    session_id = _new_session(client)
    listed = client.get("/api/analysis/workbench/sessions").json()
    assert any(item["session_id"] == session_id for item in listed["sessions"])

    first = _add_state(client, session_id, "RC 1")
    second = _add_state(client, session_id, "RC 2")

    snapshot = client.get(f"/api/analysis/workbench/session/{session_id}").json()["session"]
    assert snapshot["active_state_id"] == second
    assert [state["state_id"] for state in snapshot["states"]] == [first, second]

    run = _run(client, session_id, first)
    assert run["envelope"]["schema"] == "netlab-analysis-result/1"
    assert run["envelope"]["kind"] == "bode"
    assert run["cache"]["cached"] is False

    again = _run(client, session_id, first)
    assert again["cache"]["cached"] is True

    assert _run(client, session_id, second)["envelope"]["kind"] == "bode"
    compared = client.post(
        "/api/analysis/workbench/compare",
        json={"session_id": session_id, "state_ids": [first, second], "kind": "bode"},
    )
    assert compared.status_code == 200, compared.text
    payload = compared.json()
    assert len(payload["envelopes"]) == 2
    assert all(item["stale"] is False for item in payload["envelopes"])

    invalid = client.post(
        "/api/analysis/workbench/invalidate",
        json={"session_id": session_id, "reason": "电路已修改"},
    )
    assert invalid.status_code == 200, invalid.text
    assert invalid.json()["invalidated"] == 2

    stale = client.get(f"/api/analysis/workbench/session/{session_id}").json()["session"]
    assert all(result["stale"] for result in stale["results"])
    assert _run(client, session_id, first)["cache"]["cached"] is False


def _run_kind(client, session_id: str, state_id: str, kind: str, params: dict | None = None) -> dict:
    payload = dict(params or {})
    if kind in (
        "loop",
        "loop_closed",
        "loop_step",
        "nyquist",
        "nyquist_closed",
        "step_open",
    ):
        payload.setdefault("feedback_sign", 1.0)
        payload.setdefault("feedback_sign_confirmed", True)
    response = client.post(
        "/api/analysis/workbench/run",
        json={"session_id": session_id, "state_id": state_id, "kind": kind, "params": payload},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    return body


def test_workbench_bode_is_labeled_closed_loop(client) -> None:
    session_id = _new_session(client, "Bode 闭环")
    state_id = _add_state(client, session_id)
    body = _run_kind(client, session_id, state_id, "bode")
    assert body["raw"]["transfer_role"] == "closed_loop"
    assert body["raw"]["transfer_function"]["supported"] is True
    assert body["raw"]["transfer_function"]["expression"]


def test_workbench_nyquist_closed_is_labeled_closed_loop(client) -> None:
    session_id = _new_session(client, "Nyquist 闭环")
    state_id = _add_state(client, session_id)
    body = _run_kind(client, session_id, state_id, "nyquist_closed")
    assert body["envelope"]["kind"] == "nyquist"
    assert body["raw"]["transfer_role"] == "closed_loop"
    assert body["envelope"]["curves"]


def test_workbench_rejects_unconfirmed_feedback_sign(client) -> None:
    session_id = _new_session(client, "反馈极性")
    state_id = _add_state(client, session_id)
    for params in (
        {"feedback_sign": None},
        {"feedback_sign": 1.0, "feedback_sign_confirmed": False},
        {"feedback_sign": 0.0},
    ):
        response = client.post(
            "/api/analysis/workbench/run",
            json={"session_id": session_id, "state_id": state_id, "kind": "loop", "params": params},
        )
        assert response.status_code == 422, response.text
        assert "反馈" in response.text


def test_workbench_rejects_unconfirmed_feedback_sign_for_all_signal_kinds(client) -> None:
    session_id = _new_session(client, "反馈极性全分析")
    state_id = _add_state(client, session_id)
    for kind in ("nyquist", "nyquist_closed", "step_open"):
        for params in (
            {"feedback_sign": None, "feedback_sign_confirmed": False},
            {"feedback_sign": 1.0, "feedback_sign_confirmed": False},
        ):
            response = client.post(
                "/api/analysis/workbench/run",
                json={
                    "session_id": session_id,
                    "state_id": state_id,
                    "kind": kind,
                    "params": params,
                },
            )
            assert response.status_code == 422, response.text
            assert "反馈" in response.text


def test_workbench_loop_without_break_is_rejected(client) -> None:
    session_id = _new_session(client, "环路无断点")
    state_id = _add_state(client, session_id)
    response = client.post(
        "/api/analysis/workbench/run",
        json={"session_id": session_id, "state_id": state_id, "kind": "loop", "params": {}},
    )
    assert response.status_code == 422, response.text
    assert "实体断环" in response.text


def test_workbench_fft_frequency_path_is_approximate_and_compared(client) -> None:
    session_id = _new_session(client, "FFT 通路")
    state_id = _add_state(client, session_id)
    body = _run_kind(
        client,
        session_id,
        state_id,
        "bode",
        {"frequency_path": "fft_trajectory", "step_dt": 1.0e-5, "step_duration": 5.0e-2},
    )
    envelope = body["envelope"]
    assert envelope["source"]["path"] == "fft_trajectory"
    assert envelope["source"]["approximate"] is True
    assert envelope["metrics"]["approximate"] is True
    assert envelope["metrics"]["stable"] is None
    comparison = body["raw"]["frequency_comparison"]
    assert comparison["points"]
    assert comparison["max_relative_error"] >= 0.0
    assert comparison["band"][0] < comparison["band"][1]


def test_workbench_closed_loop_with_virtual_feedback_has_parity_curves(client) -> None:
    session_id = _new_session(client, "虚拟闭环")
    state_id = _add_state(client, session_id)
    body = _run_kind(client, session_id, state_id, "loop_closed")
    envelope = body["envelope"]
    labels = [str(curve.get("label")) for curve in envelope["curves"]]
    assert any("闭环 T(s)" in label for label in labels)
    assert envelope["source"]["loop_origin"] == "virtual_unit_feedback"
    assert "no_physical_loop" in {str(item.get("code")) for item in envelope["warnings"]}
    assert body["raw"]["display"] == "closed_loop"
    assert body["raw"]["transfer_role"] == "closed_loop"
    assert body["raw"]["transfer_function"]["supported"] is True
    assert body["raw"]["closed_loop_transfer_function"]["supported"] is True
    assert body["raw"]["open_loop_transfer_function"]["supported"] is False


def test_workbench_closed_loop_step_returns_time_envelope(client) -> None:
    session_id = _new_session(client, "虚拟阶跃")
    state_id = _add_state(client, session_id)
    body = _run_kind(
        client, session_id, state_id, "loop_step", {"step_dt": 1.0e-5, "step_duration": 2.0e-3}
    )
    envelope = body["envelope"]
    assert envelope["kind"] == "time"
    assert envelope["source"]["kind"] == "loop_step"
    assert envelope["axes"][0]["unit"] == "s"
    assert body["raw"]["transfer_role"] == "closed_loop"
    assert body["raw"]["transfer_function"]["supported"] is True
    assert body["raw"]["open_loop_transfer_function"]["supported"] is False


def test_workbench_accepts_poles_kind(client) -> None:
    session_id = _new_session(client, "极点列表")
    state_id = _add_state(client, session_id)
    body = _run_kind(client, session_id, state_id, "poles")
    assert body["kind"] == "poles"
    assert body["envelope"]["kind"] == "bode"


def test_workbench_export_returns_manifest(client) -> None:
    session_id = _new_session(client, "导出会话")
    state_id = _add_state(client, session_id)
    _run(client, session_id, state_id)

    response = client.post(
        "/api/analysis/workbench/export",
        json={"session_id": session_id, "format": "json", "kind": "bode"},
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/json")
    assert "attachment" in response.headers["content-disposition"]
    payload = json.loads(response.content)
    assert payload["manifest"]["schema"] == "netlab-analysis-export/1"
    assert payload["manifest"]["session_id"] == session_id
    assert payload["manifest"]["state_ids"] == [state_id]
    assert payload["results"][0]["kind"] == "bode"
    assert payload["results"][0]["state_id"] == state_id

    csv_response = client.post(
        "/api/analysis/workbench/export",
        json={"session_id": session_id, "format": "csv", "kind": "bode"},
    )
    assert csv_response.status_code == 200, csv_response.text
    assert csv_response.content.startswith("\ufeff".encode("utf-8"))


def _diode_payload(label: str = "Diode") -> dict:
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
    return {
        "label": label,
        "circuit": scene.to_payload(include_state=False),
        "input_source": "V1",
        "output": "out",
        "ranges": {"f_start": 1.0, "f_stop": 1.0e5, "points": 41},
    }


def test_workbench_auto_supplies_dc_operating_point_for_nonlinear(client):
    session_id = _new_session(client, "非线性自动工作点")
    response = client.post(
        "/api/analysis/workbench/state",
        json={
            "session_id": session_id,
            "action": "add",
            "state": _diode_payload(),
            "select": True,
        },
    )
    assert response.status_code == 200, response.text
    state_id = response.json()["state"]["state_id"]

    body = _run(client, session_id, state_id, "bode")
    assert body["ok"] is True
    assert body["raw"]["operating_point_supplied"] is True


def test_workbench_state_preserves_unconfirmed_feedback_sign(client) -> None:
    session_id = _new_session(client, "极性状态")
    payload = _rc_payload("未确认")
    payload["feedback_sign"] = None
    payload["feedback_sign_confirmed"] = False
    response = client.post(
        "/api/analysis/workbench/state",
        json={"session_id": session_id, "action": "add", "state": payload, "select": True},
    )
    assert response.status_code == 200, response.text
    state = response.json()["state"]
    assert state["feedback_sign"] is None
    assert state["feedback_sign_confirmed"] is False

    updated = client.post(
        "/api/analysis/workbench/state",
        json={
            "session_id": session_id,
            "action": "update",
            "state_id": state["state_id"],
            "changes": {"feedback_sign": None},
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["state"]["feedback_sign"] is None

    invalid = client.post(
        "/api/analysis/workbench/state",
        json={
            "session_id": session_id,
            "action": "update",
            "state_id": state["state_id"],
            "changes": {"feedback_sign": 0},
        },
    )
    assert invalid.status_code == 422
    assert "feedback_sign" in invalid.text
