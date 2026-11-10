"""M4.2：Descriptor 小信号阶跃响应（RC 解析解对照）。"""

import math

import pytest

from netlab.core.compute.circuit.descriptor import DescriptorModel
from netlab.core.compute.circuit.descriptor_analysis import descriptor_step_response
from netlab.core.model.scene import Scene


def _rc_lowpass():
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(name="V1", source=vin.id, target=gnd.id, kind="vsource",
                   params={"wave": "dc", "offset": 0.0, "amplitude": 1.0})
    scene.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor",
                   params={"R": 1000.0})
    scene.add_edge(name="C1", source=out.id, target=gnd.id, kind="capacitor",
                   params={"C": 1.0e-6})
    return DescriptorModel.from_scene(scene)


def test_rc_step_matches_analytic_tau():
    model = _rc_lowpass()
    data = descriptor_step_response(model, "V1", "out", t_end=0.005, dt=1.0e-5)
    assert data["values"][0] == pytest.approx(0.0)
    at_tau = data["values"][100]
    assert at_tau == pytest.approx(1.0 - math.exp(-1.0), rel=5e-3)
    assert data["values"][-1] == pytest.approx(1.0, rel=1e-2)
