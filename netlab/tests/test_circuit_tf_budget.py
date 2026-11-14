"""小信号旁路分析（circuit tf）超时防护：时间预算 + 自适应上限。"""

from __future__ import annotations

import time

import pytest

from netlab.core.compute import analysis as A
from netlab.core.model.scene import Scene


class _Sim:
    def __init__(self, scene: Scene) -> None:
        self.scene = scene


def _rc_scene() -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(
        name="V1", source=vin.id, target=gnd.id, kind="vsource",
        params={"wave": "dc", "offset": 0.0, "amplitude": 1.0},
    )
    scene.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0})
    scene.add_edge(name="C1", source=out.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6})
    return scene


def _call(**kw):
    base = dict(
        input_source="V1", output="out", operating_point=None,
        step_dt=1e-4, step_duration=5e-3, f_start=10.0, f_stop=1000.0,
        points=11, scale="log",
    )
    base.update(kw)
    return A._circuit_tf_analysis(_Sim(_rc_scene()), **base)


def test_default_small_case_runs():
    res = _call()
    assert res["ok"] is True and "bode" in res


def test_points_capped_to_400():
    res = _call(points=100000)
    freqs = res["bode"]["frequencies"]
    assert 0 < len(freqs) <= 400


def test_timeout_raises_analysis_error(monkeypatch):
    orig = A.DescriptorModel.from_scene.__func__

    def slow(cls, scene, **kw):
        time.sleep(0.05)
        return orig(cls, scene, **kw)

    monkeypatch.setattr(A.DescriptorModel, "from_scene", classmethod(slow))
    with pytest.raises(A.AnalysisError) as ei:
        _call(budget_s=0.005)
    assert "超时" in str(ei.value)
