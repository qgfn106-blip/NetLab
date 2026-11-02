"""R20/Q8：信号/矢量节点端口与边端口绑定。"""

from __future__ import annotations

import pytest

from netlab.core.common.limits import ValidationError
from netlab.core.model.scene import Scene


def node(scene, name, kind="manual"):
    return scene.add_node(name=name, kind=kind, data={"voltage": 2.0} if kind == "manual" else {})


def test_signal_source_port_and_target_port():
    scene = Scene("signal")
    src = node(scene, "src")
    iface = scene.add_node(name="iface", kind="if_signal_to_vector",
                           params={"input_field": "voltage", "angle": 0.0})
    scene.add_edge(name="E1", source=src.id, target=iface.id, kind="scale",
                   params={"gain": 3.0, "input_key": "other", "output_key": "out"},
                   source_port="voltage", target_port="u")
    scene.step(1.0)
    values = next(item for item in scene.nodes.values() if item.name == "iface").data
    assert abs(float(values["x"]) - 6.0) < 1e-9
    assert abs(float(values["y"])) < 1e-9


def test_signal_ports_vector_inputs():
    scene = Scene("signal")
    src = scene.add_node(name="src", kind="manual", data={"x": 3.0, "y": 4.0})
    iface = scene.add_node(name="iface", kind="if_vector_to_signal",
                           params={"component": "magnitude", "scale": 1.0})
    scene.add_edge(name="EX", source=src.id, target=iface.id, kind="pass",
                   target_port="x")
    scene.add_edge(name="EY", source=src.id, target=iface.id, kind="pass",
                   target_port="y")
    scene.step(1.0)
    values = next(item for item in scene.nodes.values() if item.name == "iface").data
    assert abs(float(values["voltage"]) - 5.0) < 1e-9


def test_signal_ports_validation():
    scene = Scene("signal")
    src = node(scene, "src")
    iface = scene.add_node(name="iface", kind="if_signal_to_vector",
                           params={"input_field": "voltage"})
    typed = scene.add_node(name="typed", kind="gain", params={"gain": 1.0})
    with pytest.raises(ValidationError):
        scene.add_edge(name="BAD1", source=typed.id, target=iface.id, kind="pass",
                       source_port="nope")
    with pytest.raises(ValidationError):
        scene.add_edge(name="BAD2", source=src.id, target=iface.id, kind="pass",
                       target_port="nope")
    plain = scene.add_node(name="plain", kind="manual", data={"voltage": 1.0})
    with pytest.raises(ValidationError):
        scene.add_edge(name="BAD3", source=src.id, target=plain.id, kind="pass",
                       target_port="x")


def test_signal_ports_compat_without_ports():
    scene = Scene("signal")
    src = node(scene, "src")
    gain = scene.add_node(name="gain", kind="gain", params={"gain": 2.0})
    scene.add_edge(name="E1", source=src.id, target=gain.id, kind="pass")
    scene.step(1.0)
    values = next(item for item in scene.nodes.values() if item.name == "gain").data
    assert abs(float(values.get("voltage", 0.0)) - 4.0) < 1e-9


def test_signal_ports_api(client):
    client.post("/api/control", json={"action": "pause"})
    client.post("/api/mode", json={"mode": "signal"})
    client.post("/api/scene/clear")
    def add(name, kind, data=None, params=None):
        body = {"name": name, "kind": kind}
        if data is not None:
            body["data"] = data
        if params is not None:
            body["params"] = params
        response = client.post("/api/nodes", json=body)
        assert response.status_code == 200, response.text
        return response.json()["node"]
    src = add("SRC", "manual", {"voltage": 2.0})
    iface = add("IFACE", "if_signal_to_vector", {"x": 0, "y": 0},
                {"input_field": "voltage", "angle": 0.0})
    response = client.post("/api/edges", json={
        "name": "EP", "source": src["id"], "target": iface["id"], "kind": "scale",
        "params": {"gain": 2.0, "input_key": "other", "output_key": "out"},
        "source_port": "voltage", "target_port": "u",
    })
    assert response.status_code == 200, response.text
    assert response.json()["edge"]["source_port"] == "voltage"
    assert response.json()["edge"]["target_port"] == "u"
    bad = client.post("/api/edges", json={
        "name": "EBAD", "source": src["id"], "target": iface["id"], "kind": "pass",
        "target_port": "nope",
    })
    assert bad.status_code == 422
