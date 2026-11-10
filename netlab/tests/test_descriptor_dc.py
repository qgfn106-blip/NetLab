"""M2.1：Descriptor 直流工作点与 Legacy 有限电导电感模型对照。"""

from __future__ import annotations

import pytest

from netlab.core.compute.circuit.descriptor import DescriptorModel
from netlab.core.model.scene import Scene

def _rc_divider() -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(
        name="V1",
        source=vin.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 10.0, "amplitude": 1.0},
    )
    scene.add_edge(
        name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0}
    )
    scene.add_edge(
        name="R2", source=out.id, target=gnd.id, kind="resistor", params={"R": 1000.0}
    )
    scene.add_edge(
        name="C1", source=out.id, target=gnd.id, kind="capacitor", params={"C": 1e-6}
    )
    return scene

def _rl_circuit() -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(
        name="V1",
        source=vin.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 10.0, "amplitude": 1.0},
    )
    scene.add_edge(
        name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 10.0}
    )
    scene.add_edge(
        name="L1", source=out.id, target=gnd.id, kind="inductor", params={"L": 1e-3}
    )
    return scene

def test_descriptor_dc_matches_legacy_for_rc_divider() -> None:
    scene = _rc_divider()
    legacy = scene.ensure_engine().operating_point()
    model = DescriptorModel.from_scene(scene)
    dc = model.dc_solution()
    by_name = {
        model.index.node_by_id[node_id].name: voltage
        for node_id, voltage in dc["node_voltages"].items()
    }
    assert by_name["vin"] == pytest.approx(legacy["node_voltages"]["vin"], abs=1e-9)
    assert by_name["out"] == pytest.approx(legacy["node_voltages"]["out"], abs=1e-9)
    assert dc["residual"] < 1e-12

def test_descriptor_ideal_inductor_has_zero_dc_voltage() -> None:
    scene = _rl_circuit()
    legacy = scene.ensure_engine().operating_point()
    model = DescriptorModel.from_scene(scene)
    dc = model.dc_solution()
    by_name = {
        model.index.node_by_id[node_id].name: voltage
        for node_id, voltage in dc["node_voltages"].items()
    }
    # Descriptor 用独立支路电流表达 v_L = 0，电压严格为零。
    assert by_name["out"] == pytest.approx(0.0, abs=1e-12)
    assert dc["branch_currents"]["L1"] == pytest.approx(1.0, rel=1e-12)
    # Legacy 用 DC_CONDUCTANCE=1e5 近似短路，残压约 I/G = 1e-5 V。
    assert abs(legacy["elements"]["L1"]["voltage_difference"]) > 0.0
    assert abs(legacy["elements"]["L1"]["voltage_difference"]) < 1e-3
    assert dc["residual"] < 1e-12
