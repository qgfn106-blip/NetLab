"""P2-A A-int-1 证据：signal/gain 试点开关 on/off 与基线逐帧 bitwise 相等。

flag=off（默认）必须与未设 env 的基线逐帧完全相等（bitwise）；flag=gain 走适配包装后
仍委托原 gain handler，故与 off 逐帧 bitwise 相等。非法值 fail-safe 为 off 并告警。
"""

from __future__ import annotations

import os
from typing import Any

import pytest

from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene


def _pilot_scene() -> Scene:
    scene = Scene("signal")
    u1 = scene.add_node(name="u1", kind="manual", data={"voltage": 1.0})
    u2 = scene.add_node(name="u2", kind="manual", data={"voltage": 2.0})
    g = scene.add_node(name="g", kind="gain", params={"gain": 2.0, "offset": 0.5})
    scene.add_edge(source=u1.id, target=g.id, kind="scale", params={"gain": 1.0})
    scene.add_edge(source=u2.id, target=g.id, kind="scale", params={"gain": 1.0})
    return scene


def _run(env: str | None, steps: int = 25) -> list[tuple[float, tuple[float, ...]]]:
    old = os.environ.get("NETLAB_NODE_RUNTIME_PILOT")
    if env is None:
        os.environ.pop("NETLAB_NODE_RUNTIME_PILOT", None)
    else:
        os.environ["NETLAB_NODE_RUNTIME_PILOT"] = env
    try:
        sim = Simulation(_pilot_scene())
        try:
            sim.precompute(steps * 0.01, dt=0.01, sample_every=1)
            frames = sim.recorder.since(0, 10**9)
            assert all(f["t"] is not None for f in frames)
            return [(float(f["t"]), tuple(sorted(float(v) for v in f["v"].values()))) for f in frames]
        finally:
            sim.shutdown()
    finally:
        if old is None:
            os.environ.pop("NETLAB_NODE_RUNTIME_PILOT", None)
        else:
            os.environ["NETLAB_NODE_RUNTIME_PILOT"] = old


def test_flag_off_bitwise_equals_baseline() -> None:
    assert _run(None) == _run("off")


def test_flag_gain_bitwise_equals_off() -> None:
    assert _run("gain") == _run("off")


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
def test_invalid_flag_failsafe_off_and_warns() -> None:
    with pytest.warns(RuntimeWarning):
        invalid = _run("not-a-mode")
    assert invalid == _run("off")
