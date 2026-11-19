"""分析工作台会话与按状态执行分析。"""

from __future__ import annotations

import pytest

from netlab.core.common.limits import NotFoundError, ValidationError
from netlab.core.compute.circuit.analysis_session import AnalysisSession, AnalysisSessionStore
from netlab.core.model.scene import Scene
from netlab.server_analysis.workbench import _run_state


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


def _state_payload(scene: Scene | None = None, **extra):
    scene = scene or _rc_low_pass()
    return {
        "label": "RC",
        "circuit": scene.to_payload(include_state=False),
        "input_source": "V1",
        "output": "out",
        "ranges": {"f_start": 1.0, "f_stop": 1.0e5, "points": 41},
        **extra,
    }


def test_state_fingerprint_changes_with_circuit() -> None:
    session = AnalysisSession("t")
    state = session.add_state(_state_payload())
    first = state.fingerprint
    session.update_state(
        state.state_id,
        {"circuit": _state_payload()["circuit"] | {"integration": "euler"}},
    )
    assert session.get_state(state.state_id).fingerprint != first


def test_compute_cache_and_stale() -> None:
    session = AnalysisSession("t")
    state = session.add_state(_state_payload())
    calls = {"n": 0}

    def runner(current):
        calls["n"] += 1
        return {"ok": True, "envelope": {"kind": "bode", "axes": [], "curves": []}}

    first = session.compute(state.state_id, "bode", runner, params={"points": 41})
    second = session.compute(state.state_id, "bode", runner, params={"points": 41})
    assert calls["n"] == 1
    assert first["cache"]["cached"] is False
    assert second["cache"]["cached"] is True
    assert session.invalidate("改了电路") == 1
    third = session.compute(state.state_id, "bode", runner, params={"points": 41})
    assert third["cache"]["cached"] is False
    assert calls["n"] == 2


def test_compare_requires_two_states_and_builds_metric_table() -> None:
    session = AnalysisSession("t")
    one = session.add_state(_state_payload(label="A"))
    two = session.add_state(_state_payload(label="B"))
    for state, gain in ((one, 1.0), (two, 2.0)):
        session.compute(
            state.state_id,
            "bode",
            lambda current, gain=gain: {
                "envelope": {"metrics": {"dc_gain": gain}},
            },
        )
    with pytest.raises(ValidationError):
        session.compare([one.state_id], "bode")
    payload = session.compare([one.state_id, two.state_id], "bode")
    assert [row["label"] for row in payload["states"]] == ["A", "B"]
    assert payload["metrics"]["dc_gain"][1]["value"] == 2.0


def test_store_lru_and_ttl() -> None:
    store = AnalysisSessionStore(limit=2, ttl_s=1000.0)
    first = store.create("a")
    second = store.create("b")
    third = store.create("c")
    with pytest.raises(NotFoundError):
        store.get(first.session_id)
    assert store.get(second.session_id) is second
    assert store.get(third.session_id) is third
    store.drop(second.session_id)
    with pytest.raises(NotFoundError):
        store.get(second.session_id)


def test_run_state_returns_bode_envelope() -> None:
    session = AnalysisSession("t")
    state = session.add_state(_state_payload())
    result = _run_state(state, "bode", {"points": 41})
    envelope = result["envelope"]
    assert envelope["kind"] == "bode"
    assert envelope["source"]["mode"] == "circuit"
    magnitude = next(curve for curve in envelope["curves"] if curve["id"] == "bode_mag")
    assert magnitude["x"] and magnitude["y"]
    assert result["raw"]["metrics"]["stable"] is True


def test_run_state_time_domain_uses_same_state() -> None:
    session = AnalysisSession("t")
    state = session.add_state(_state_payload())
    result = _run_state(state, "time", {"step_dt": 1.0e-6, "step_duration": 5.0e-3})
    assert result["envelope"]["kind"] == "time"
    assert result["envelope"]["axes"][0]["id"] == "t"
