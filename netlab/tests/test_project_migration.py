"""R20：v3 工程 → v4（器件节点 + 引脚导线）自动迁移。"""

from __future__ import annotations

import copy

from netlab.core.model.project import (
    PROJECT_FORMAT,
    PROJECT_VERSION,
    compute_checksum,
    make_network,
    migrate_project,
    validate_project,
)
from netlab.core.model.scene import Scene
from netlab.core.model.templates import build_template


def v3_project(scene_payload):
    scene = copy.deepcopy(scene_payload)
    sim = scene.pop("sim", {})
    network = make_network("网络 1", scene, sim)
    project = {
        "format": PROJECT_FORMAT,
        "version": 3,
        "name": "迁移测试",
        "networks": [network],
        "current": network["id"],
        "ui": {},
        "blocks": [],
        "extensions": [],
        "fem": {},
        "created": "2026-10-26T12:00:00",
        "modified": "2026-10-26T12:00:00",
    }
    project["checksum"] = compute_checksum(project)
    return project


def test_v3_rlc_project_migrates_and_solves():
    legacy = build_template("rlc_series")
    project = v3_project(legacy)
    migrated = validate_project(project)
    assert migrated["version"] == PROJECT_VERSION
    scene = migrated["networks"][0]["scene"]
    kinds = [node["kind"] for node in scene["nodes"]]
    assert kinds.count("device") == 4
    assert all(edge["kind"] == "wire" for edge in scene["edges"])
    assert len(scene["edges"]) == 8

    # 迁移前后数值一致（同一模板、同一 dt 序列）。
    old_scene = Scene("circuit")
    old_scene.load_payload(build_template("rlc_series"))
    new_scene = Scene("circuit")
    new_scene.load_payload(scene)
    for _ in range(20):
        old_scene.step(1e-4)
        new_scene.step(1e-4)
    for name in ("src", "mid", "out"):
        old = next(item for item in old_scene.nodes.values() if item.name == name)
        new = next(item for item in new_scene.nodes.values() if item.name == name)
        assert (
            abs(
                float(old.data.get("voltage", 0.0))
                - float(new.data.get("voltage", 0.0))
            )
            < 1e-9
        )


def test_migration_is_idempotent():
    project = v3_project(build_template("rlc_series"))
    once = migrate_project(project)
    twice = migrate_project(once)
    assert once["networks"][0]["scene"] == twice["networks"][0]["scene"]


def test_migration_keeps_incomplete_multipin_legacy():
    scene = {
        "mode": "circuit",
        "integration": "trapezoidal",
        "nodes": [
            {
                "id": "aaaaaaaaaaa1",
                "name": "gnd",
                "kind": "ground",
                "position": {"x": 0, "y": 200},
            },
            {
                "id": "aaaaaaaaaaa2",
                "name": "pri",
                "kind": "node",
                "position": {"x": 0, "y": 0},
            },
            {
                "id": "aaaaaaaaaaa3",
                "name": "sec",
                "kind": "node",
                "position": {"x": 200, "y": 0},
            },
        ],
        "edges": [
            {
                "id": "bbbbbbbbbbb1",
                "name": "T1",
                "source": "aaaaaaaaaaa2",
                "target": "aaaaaaaaaaa1",
                "kind": "transformer",
                "params": {"ratio": 0.5, "Lm": 0.0},
                "layout": {"x": 0, "y": 100, "rot": 90},
            },
        ],
    }
    project = v3_project(scene)
    migrated = migrate_project(project)
    result = migrated["networks"][0]["scene"]
    assert [node["kind"] for node in result["nodes"]].count("device") == 0
    assert result["edges"][0]["kind"] == "transformer"


def test_migration_complete_transformer_becomes_device():
    scene = {
        "mode": "circuit",
        "integration": "trapezoidal",
        "nodes": [
            {
                "id": "aaaaaaaaaaa1",
                "name": "gnd",
                "kind": "ground",
                "position": {"x": 0, "y": 200},
            },
            {
                "id": "aaaaaaaaaaa2",
                "name": "pri",
                "kind": "node",
                "position": {"x": 0, "y": 0},
            },
            {
                "id": "aaaaaaaaaaa4",
                "name": "sec",
                "kind": "node",
                "position": {"x": 300, "y": 0},
            },
        ],
        "edges": [
            {
                "id": "bbbbbbbbbbb1",
                "name": "V1",
                "source": "aaaaaaaaaaa2",
                "target": "aaaaaaaaaaa1",
                "kind": "vsource",
                "params": {"wave": "dc", "offset": 10.0, "amplitude": 0.0},
                "layout": {"x": 0, "y": 100, "rot": 90},
            },
            {
                "id": "bbbbbbbbbbb2",
                "name": "T1",
                "source": "aaaaaaaaaaa2",
                "target": "aaaaaaaaaaa1",
                "kind": "transformer",
                "params": {
                    "ratio": 0.5,
                    "Lm": 0.0,
                    "secondary_source": "aaaaaaaaaaa4",
                    "secondary_target": "aaaaaaaaaaa1",
                },
                "layout": {"x": 150, "y": 100, "rot": 90},
            },
            {
                "id": "bbbbbbbbbbb3",
                "name": "RL",
                "source": "aaaaaaaaaaa4",
                "target": "aaaaaaaaaaa1",
                "kind": "resistor",
                "params": {"R": 1000.0},
                "layout": {"x": 300, "y": 100, "rot": 90},
            },
        ],
    }
    migrated = migrate_project(v3_project(scene))
    result = migrated["networks"][0]["scene"]
    devices = [node for node in result["nodes"] if node["kind"] == "device"]
    assert len(devices) == 3
    wires = [edge for edge in result["edges"] if edge["kind"] == "wire"]
    assert len(wires) == 8
    trial = Scene("circuit")
    trial.load_payload(result)
    for _ in range(3):
        trial.step(1e-4)
    sec = next(node for node in trial.nodes.values() if node.name == "sec")
    assert abs(float(sec.data.get("voltage", 0.0)) - 5.0) < 0.05


def v4_project(scene_payload):
    project = v3_project(scene_payload)
    project["version"] = 4
    project["checksum"] = compute_checksum(project)
    return project


def test_v4_opamp_rails_migrate_to_single_ended():
    """R21/D42：OUT+/OUT− → OUT + V±（参数默认），OUT− 导线断开并进报告。"""
    scene = {
        "mode": "circuit",
        "integration": "trapezoidal",
        "nodes": [
            {
                "id": "aaaaaaaaaaa1",
                "name": "gnd",
                "kind": "ground",
                "position": {"x": 0, "y": 200},
            },
            {
                "id": "aaaaaaaaaaa2",
                "name": "inp",
                "kind": "node",
                "position": {"x": 0, "y": 0},
            },
            {
                "id": "aaaaaaaaaaa3",
                "name": "inm",
                "kind": "node",
                "position": {"x": 0, "y": 100},
            },
            {
                "id": "aaaaaaaaaaa4",
                "name": "out",
                "kind": "node",
                "position": {"x": 200, "y": 0},
            },
            {
                "id": "aaaaaaaaaaa5",
                "name": "U1",
                "kind": "device",
                "params": {
                    "element": "opamp",
                    "gain": 1.0e5,
                    "vmax": 10.0,
                    "vp": "aaaaaaaaaaa2",
                    "vn": "aaaaaaaaaaa3",
                },
                "position": {"x": 100, "y": 100},
            },
        ],
        "edges": [
            {
                "id": "bbbbbbbbbbb1",
                "name": "W_OUT",
                "source": "aaaaaaaaaaa5",
                "target": "aaaaaaaaaaa4",
                "kind": "wire",
                "source_pin": "OUT+",
                "target_pin": "",
            },
            {
                "id": "bbbbbbbbbbb2",
                "name": "W_RET",
                "source": "aaaaaaaaaaa5",
                "target": "aaaaaaaaaaa1",
                "kind": "wire",
                "source_pin": "OUT-",
                "target_pin": "",
            },
            {
                "id": "bbbbbbbbbbb3",
                "name": "W_INP",
                "source": "aaaaaaaaaaa5",
                "target": "aaaaaaaaaaa2",
                "kind": "wire",
                "source_pin": "IN+",
                "target_pin": "",
            },
            {
                "id": "bbbbbbbbbbb4",
                "name": "W_INM",
                "source": "aaaaaaaaaaa5",
                "target": "aaaaaaaaaaa3",
                "kind": "wire",
                "source_pin": "IN-",
                "target_pin": "",
            },
        ],
    }
    migrated = migrate_project(v4_project(scene))
    assert migrated["version"] == PROJECT_VERSION
    result = migrated["networks"][0]["scene"]
    device = next(node for node in result["nodes"] if node["kind"] == "device")
    assert device["params"]["vcc"] == 10.0
    assert device["params"]["vee"] == -10.0
    pins = sorted(
        str(edge.get("source_pin") or "")
        for edge in result["edges"]
        if edge["kind"] == "wire"
    )
    assert pins == ["IN+", "IN-", "OUT"]
    report = migrated["metadata"].get("rails_migration") or []
    assert report and report[0]["net_is_ground"] is True
    # 迁移结果能直接装进场景并装配引擎（无未知引脚/未知参数）。
    trial = Scene("circuit")
    trial.load_payload(result)
    trial.ensure_engine()


def test_api_migrate_scene_devices(client):
    client.post("/api/control", json={"action": "pause"})
    client.post("/api/mode", json={"mode": "circuit"})
    client.post("/api/scene", json=build_template("rlc_series"))
    first = client.post("/api/scene/migrate-devices")
    assert first.status_code == 200, first.text
    migration = first.json()["migration"]
    assert migration["converted"] == 4
    assert migration["devices"] == 4
    assert migration["wires"] == 8
    second = client.post("/api/scene/migrate-devices")
    assert second.status_code == 200
    assert second.json()["migration"]["converted"] == 0
