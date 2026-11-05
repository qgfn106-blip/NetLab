"""R31/P11-05：跨域桥 sensor/actuator 的延迟与兼容性回归。"""

from __future__ import annotations

from netlab.core.compute.nodal import element_spec
from netlab.core.compute.simulation import Simulation
from netlab.core.model.project import atomic_write, build_project, load_project
from netlab.core.model.scene import Scene


def _bridge_scene() -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vcc = scene.add_node(name="vcc", kind="node")
    n1 = scene.add_node(name="n1", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(name="V1", source=vcc.id, target=gnd.id, kind="vsource",
                   params={"wave": "dc", "offset": 10.0, "amplitude": 0.0})
    scene.add_edge(name="R1", source=vcc.id, target=n1.id, kind="resistor", params={"R": 1000.0})
    scene.add_edge(name="R2", source=n1.id, target=gnd.id, kind="resistor", params={"R": 1000.0})
    scene.add_edge(name="R3", source=out.id, target=gnd.id, kind="resistor", params={"R": 1000.0})

    sensor = scene.add_node(name="sensor", kind="device", params={"element": "sensor", "signal": "voltage"})
    scene.add_edge(name="sensor_in", source=sensor.id, target=n1.id, kind="wire", source_pin="IN")
    scene.add_edge(name="sensor_gnd", source=sensor.id, target=gnd.id, kind="wire", source_pin="GND")

    actuator = scene.add_node(
        name="actuator",
        kind="device",
        params={"element": "actuator", "source": "sensor.voltage", "gain": 1.0, "offset": 0.0},
    )
    scene.add_edge(name="act_out", source=actuator.id, target=out.id, kind="wire", source_pin="OUT")
    scene.add_edge(name="act_gnd", source=actuator.id, target=gnd.id, kind="wire", source_pin="GND")
    return scene


def test_sensor_actuator_are_delayed_by_one_step() -> None:
    scene = _bridge_scene()
    engine = scene.ensure_engine()
    assert len(engine.bridge_sensors) == 1
    assert len(engine.bridge_actuators) == 1

    engine.step(1.0e-4)
    sensor = next(node for node in scene.nodes.values() if node.name == "sensor")
    out = next(node for node in scene.nodes.values() if node.name == "out")
    assert abs(sensor.data["voltage"] - 5.0) < 1.0e-6
    assert abs(out.data["voltage"]) < 1.0e-9

    engine.step(1.0e-4)
    assert abs(out.data["voltage"] - 5.0) < 1.0e-6


def test_plain_circuit_has_no_bridge_elements() -> None:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    n1 = scene.add_node(name="n1", kind="node")
    scene.add_edge(name="V1", source=n1.id, target=gnd.id, kind="vsource",
                   params={"wave": "dc", "offset": 1.0, "amplitude": 0.0})
    scene.add_edge(name="R1", source=n1.id, target=gnd.id, kind="resistor", params={"R": 1000.0})
    engine = scene.ensure_engine()
    assert engine.bridge_sensors == []
    assert engine.bridge_actuators == []
    engine.step(1.0e-4)
    assert abs(n1.data["voltage"] - 1.0) < 1.0e-9


def test_bridge_element_specs_are_registered() -> None:
    assert element_spec("sensor").label
    assert element_spec("actuator").label


def test_bridge_project_round_trips_checksum(tmp_path) -> None:
    scene = _bridge_scene()
    sim = Simulation(scene)
    sim.config.dt = 1.0e-4
    project = build_project(sim, name="bridge", metadata={"r31": "P11-05"})
    path = tmp_path / "bridge.netlab"
    atomic_write(path, project)
    loaded = load_project(path)
    assert loaded["metadata"]["r31"] == "P11-05"
    kinds = {node["kind"] for node in loaded["networks"][0]["scene"]["nodes"]}
    assert "device" in kinds

