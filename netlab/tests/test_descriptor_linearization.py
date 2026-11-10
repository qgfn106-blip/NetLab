"""M3：非线性器件在给定直流工作点处的 Descriptor 线性化。"""

import pytest

from netlab.core.common.limits import ComputeError
from netlab.core.compute.circuit.descriptor import DescriptorModel
from netlab.core.model.scene import Scene


def _diode_scene():
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(name="V1", source=vin.id, target=gnd.id, kind="vsource",
                   params={"wave": "dc", "offset": 0.7, "amplitude": 1.0})
    scene.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor",
                   params={"R": 1000.0})
    scene.add_edge(name="D1", source=out.id, target=gnd.id, kind="diode",
                   params={"Is": 1e-14, "n": 1.0, "temperature": 300.0, "rs": 0.0})
    return scene, out.id


def test_diode_requires_operating_point_for_linearization():
    scene, _ = _diode_scene()
    with pytest.raises(ComputeError, match="非线性元件"):
        DescriptorModel.from_scene(scene)


def test_diode_linearizes_conductance_at_operating_point():
    scene, out_id = _diode_scene()
    op = scene.ensure_engine().solver.operating_point()
    model = DescriptorModel.from_scene(scene, operating_point=op)
    out_index = model.index.node_index[out_id]
    # R1 到 out 的 1/1000 S 加上二极管在 0.7V 附近的正向电导。
    assert model.A[out_index, out_index] > 1.0 / 1000.0
    # 小信号频响应有限且非全零。
    data = model.frequency_response([10.0, 1000.0], input_source="V1", probes=["out"])
    assert len(data["probes"]["out"]["magnitude"]) == 2
    assert all(abs(value) > 0.0 for value in data["probes"]["out"]["magnitude"])
