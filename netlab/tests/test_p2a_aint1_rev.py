"""A-int-1 修订版：signal/gain 试点——handler 真正经 NodeDesc→prepare_compute 重建委托，
并真实使用 NodeRuntime（state/inputs 一致性断言）。旗标默认 off、非法 fail-safe off。"""

from __future__ import annotations

import logging

import pytest

import netlab.core.model.scene_engines as se
from netlab.core.common.limits import ComputeError
from netlab.core.model.scene import Scene


def _build(offset: float = 0.0):
    scene = Scene("signal")
    u = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    g = scene.add_node(name="g", kind="gain", params={"gain": 2.0, "offset": offset})
    scene.add_edge(name="e", source=u.id, target=g.id, kind="pass")
    return scene, g.id, u.id


def _frames(scene: Scene, steps: int = 25):
    out = []
    for _ in range(steps):
        scene.step(0.1)
        out.append({n.name: dict(n.data) for n in scene.nodes.values()})
    return out


def _build_chain():
    scene = Scene("signal")
    u = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    c = scene.add_node(name="c", kind="manual", data={"value": 0.3})
    integ = scene.add_node(
        name="i", kind="integrate", params={"gain": 1.0, "lower": -1e9, "upper": 1e9}
    )
    g1 = scene.add_node(name="g1", kind="gain", params={"gain": 1.5, "offset": 0.2})
    g2 = scene.add_node(name="g2", kind="gain", params={"gain": -2.0, "offset": 0.1})
    scene.add_edge(name="e1", source=u.id, target=integ.id, kind="pass")
    scene.add_edge(name="e2", source=integ.id, target=g1.id, kind="pass")
    scene.add_edge(name="e3", source=c.id, target=g1.id, kind="pass")
    scene.add_edge(name="e4", source=g1.id, target=g2.id, kind="pass")
    return scene


def test_flag_off_matches_baseline(monkeypatch) -> None:
    monkeypatch.delenv("NETLAB_NODE_RUNTIME_PILOT", raising=False)
    base = _frames(_build()[0])
    monkeypatch.setenv("NETLAB_NODE_RUNTIME_PILOT", "off")
    off = _frames(_build()[0])
    assert base == off


def test_flag_invalid_failsafe_off_warns_once(monkeypatch, caplog) -> None:
    monkeypatch.setenv("NETLAB_NODE_RUNTIME_PILOT", "bogus")
    se._runtime_pilot_mode._warned = False
    with caplog.at_level(logging.WARNING):
        _frames(_build()[0], 5)
    warns = [r for r in caplog.records if "非法" in r.getMessage()]
    assert len(warns) == 1


def test_flag_gain_bitwise_equal(monkeypatch) -> None:
    monkeypatch.setenv("NETLAB_NODE_RUNTIME_PILOT", "off")
    base = _frames(_build(offset=0.5)[0], 25)
    monkeypatch.setenv("NETLAB_NODE_RUNTIME_PILOT", "gain")
    on = _frames(_build(offset=0.5)[0], 25)
    assert base == on


def test_gain_pilot_chain_with_integrator_bitwise_equal(monkeypatch) -> None:
    monkeypatch.setenv("NETLAB_NODE_RUNTIME_PILOT", "off")
    base = _frames(_build_chain(), 25)
    monkeypatch.setenv("NETLAB_NODE_RUNTIME_PILOT", "gain")
    on = _frames(_build_chain(), 25)
    assert base == on


def test_pilot_actually_calls_prepare_compute(monkeypatch) -> None:
    monkeypatch.setenv("NETLAB_NODE_RUNTIME_PILOT", "gain")
    calls = []
    orig = se.prepare_compute

    def spy(kind, params):
        calls.append(kind)
        return orig(kind, params)

    monkeypatch.setattr(se, "prepare_compute", spy)
    scene, _gid, _uid = _build()
    scene.step(0.1)
    # 装配期 1 次 + 至少一次求值期的试点重建（kind == gain）
    assert calls.count("gain") >= 2, calls


def test_flag_off_has_no_pilot_rebuild(monkeypatch) -> None:
    monkeypatch.setenv("NETLAB_NODE_RUNTIME_PILOT", "off")
    calls = []
    orig = se.prepare_compute

    def spy(kind, params):
        calls.append(kind)
        return orig(kind, params)

    monkeypatch.setattr(se, "prepare_compute", spy)
    scene, _gid, _uid = _build()
    scene.step(0.1)
    n = len(calls)
    scene.step(0.1)
    assert len(calls) == n, calls  # off 时无每次求值重建


def test_runtime_state_assertion_is_used(monkeypatch) -> None:
    monkeypatch.setenv("NETLAB_NODE_RUNTIME_PILOT", "gain")

    class FakeRT:
        state = {"x": 1}
        inputs: dict = {}

    monkeypatch.setattr(
        se.NodeRuntime, "from_record", classmethod(lambda cls, rec: FakeRT())
    )
    scene, _gid, _uid = _build()
    with pytest.raises(ComputeError, match="A-int-1 试点"):
        scene.step(0.1)


def test_runtime_inputs_assertion_is_used(monkeypatch) -> None:
    monkeypatch.setenv("NETLAB_NODE_RUNTIME_PILOT", "gain")

    class FakeRT:
        state: dict = {}
        inputs = {"WRONG": 1}

    monkeypatch.setattr(
        se.NodeRuntime, "from_record", classmethod(lambda cls, rec: FakeRT())
    )
    scene, _gid, _uid = _build()
    with pytest.raises(ComputeError, match="A-int-1 试点"):
        scene.step(0.1)
