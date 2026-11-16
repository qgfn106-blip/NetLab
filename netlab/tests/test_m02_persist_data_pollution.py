"""M-02：工程保存快照不应把运行时 `data`（计算节点输出）持久化为初值。

修复：`Scene.to_payload(authored_data=True)` 仅用于工程保存路径，对 compute/handler
节点用 `_initial_data`（建模初值）替换 `data`；manual 等无 handler 节点保留 authored
data；默认 `authored_data=False` 行为逐字节不变。
"""

import pytest

from netlab.core.model.scene import Scene
from netlab.core.compute.simulation import Simulation
from netlab.core.model.project import build_project
from netlab.core.model.networks import NetworkContainer


def _build_scene():
    scene = Scene("signal")
    u = scene.add_node(name="u", kind="manual", data={"value": 3.0})
    g = scene.add_node(name="g", kind="gain", params={"gain": 2.0})
    scene.add_edge(name="e", source=u.id, target=g.id, kind="pass")
    return scene, u.id, g.id


def _node(payload, nid):
    return next(n for n in payload["nodes"] if n["id"] == nid)


def test_saved_snapshot_uses_initial_not_runtime_output() -> None:
    scene, uid, gid = _build_scene()
    assert scene.nodes[gid].data == {}
    scene.step(0.1)
    assert scene.nodes[gid].data.get("value") == pytest.approx(6.0)

    payload = scene.to_payload(include_state=False, authored_data=True)
    # compute 节点：保存初值（空），不含运行时输出
    assert _node(payload, gid)["data"] == {}
    # manual 节点：保留用户 authored 值
    assert _node(payload, uid)["data"]["value"] == pytest.approx(3.0)
    # 重载后不被运行时输出当作初值
    reloaded = Scene("signal")
    reloaded.load_payload(payload)
    assert reloaded.nodes[gid].data.get("value") is None


def test_default_to_payload_unchanged_keeps_runtime_data() -> None:
    scene, _uid, gid = _build_scene()
    scene.step(0.1)
    payload = scene.to_payload(include_state=False)  # 默认 authored_data=False
    assert _node(payload, gid)["data"].get("value") == pytest.approx(6.0)


def test_build_project_save_path_uses_initial_data() -> None:
    scene, uid, gid = _build_scene()
    scene.step(0.1)
    proj = build_project(Simulation(scene), name="t")
    payload = proj["networks"][0]["scene"]
    assert _node(payload, gid)["data"] == {}
    assert _node(payload, uid)["data"]["value"] == pytest.approx(3.0)


def test_network_container_build_project_save_path_uses_initial_data() -> None:
    scene, uid, gid = _build_scene()
    scene.step(0.1)
    nc = NetworkContainer(Simulation(scene))
    proj = nc.build_project(name="t")
    payload = proj["networks"][0]["scene"]
    assert _node(payload, gid)["data"] == {}
    assert _node(payload, uid)["data"]["value"] == pytest.approx(3.0)


def _build_circuit():
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(name="V1", source=vin.id, target=gnd.id, kind="vsource",
                   params={"wave": "dc", "offset": 0.0, "amplitude": 1.0})
    scene.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0})
    scene.add_edge(name="C1", source=out.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6})
    return scene, out.id


def test_circuit_authored_snapshot_strips_runtime_voltage() -> None:
    scene, outid = _build_circuit()
    scene.step(1.0e-4)
    assert scene.nodes[outid].data.get("voltage") is not None
    payload = scene.to_payload(include_state=False, authored_data=True)
    assert "voltage" not in _node(payload, outid)["data"]


def test_circuit_default_to_payload_keeps_runtime_voltage() -> None:
    scene, outid = _build_circuit()
    scene.step(1.0e-4)
    payload = scene.to_payload(include_state=False)
    assert _node(payload, outid)["data"].get("voltage") is not None


def test_circuit_build_project_strips_runtime_voltage() -> None:
    scene, outid = _build_circuit()
    scene.step(1.0e-4)
    proj = build_project(Simulation(scene), name="t")
    payload = proj["networks"][0]["scene"]
    assert "voltage" not in _node(payload, outid)["data"]


def test_circuit_network_container_strips_runtime_voltage() -> None:
    scene, outid = _build_circuit()
    scene.step(1.0e-4)
    nc = NetworkContainer(Simulation(scene))
    proj = nc.build_project(name="t")
    payload = proj["networks"][0]["scene"]
    assert "voltage" not in _node(payload, outid)["data"]
