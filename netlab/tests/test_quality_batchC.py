"""批次C：P2-05 circuit tf 顶层回传实际 step_dt。"""

from __future__ import annotations

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


def test_circuit_tf_reports_actual_step_dt_at_top_level():
    res = A._circuit_tf_analysis(
        _Sim(_rc_scene()),
        input_source="V1", output="out", operating_point=None,
        step_dt=1e-4, step_duration=5e-3, f_start=10.0, f_stop=1000.0,
        points=11, scale="log",
    )
    assert "step_dt" in res, "顶层应回传实际 step_dt"
    assert res["step_dt"] == float(res["step"]["dt"])
    assert res["step_dt"] > 0.0
