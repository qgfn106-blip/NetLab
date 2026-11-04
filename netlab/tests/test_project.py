"""工程文件（.netlab）的最小回归：构建、校验、原子写、迁移与功能块往返。"""

from __future__ import annotations

import json

import pytest

from netlab.core.model.blocks import encapsulate_nodes
from netlab.core.common.limits import ValidationError
from netlab.core.model.project import (
    project_current_network,
    atomic_write,
    build_project,
    compute_checksum,
    migrate_project,
    project_scene_payload,
    validate_project,
)
from netlab.core.model.scene import Scene
from netlab.core.compute.simulation import Simulation


def build_simulation() -> Simulation:
    scene = Scene("signal")
    a = scene.add_node(name="a", kind="manual", data={"voltage": 1.0})
    b = scene.add_node(name="b", kind="sum")
    c = scene.add_node(name="c", kind="sum")
    scene.add_edge(source=a.id, target=b.id, kind="scale", params={"gain": 2.0})
    scene.add_edge(source=b.id, target=c.id, kind="scale", params={"gain": 3.0})
    simulation = Simulation(scene)
    simulation.apply_config({"fps": 30, "dt": 0.01, "steps_per_frame": 1})
    return simulation


def test_build_and_validate_project_roundtrip(tmp_path):
    simulation = build_simulation()
    try:
        project = build_project(simulation, name="demo")
        assert project["format"] == "netlab-project"
        assert project["checksum"] == compute_checksum(project)
        validated = validate_project(project)
        current = project_current_network(validated)["scene"]
        assert len(current["nodes"]) == 3
        assert "blocks" not in current

        target = tmp_path / "demo.netlab"
        atomic_write(target, project)
        assert target.is_file()
        payload = json.loads(target.read_text(encoding="utf-8"))
        assert validate_project(payload)["name"] == "demo"
    finally:
        simulation.shutdown()


def test_tampered_checksum_is_rejected():
    simulation = build_simulation()
    try:
        project = build_project(simulation)
    finally:
        simulation.shutdown()
    project["name"] = "changed"
    with pytest.raises(ValidationError, match="校验和"):
        validate_project(project)


def test_atomic_write_keeps_backup_and_no_temp_files(tmp_path):
    target = tmp_path / "x.netlab"
    atomic_write(target, {"format": "netlab-project", "version": 1})
    atomic_write(target, {"format": "netlab-project", "version": 1, "name": "v2"})
    assert target.with_suffix(target.suffix + ".bak").is_file()
    leftovers = [item.name for item in tmp_path.iterdir() if item.name.endswith(".tmp")]
    assert leftovers == []


def test_old_scene_json_is_migrated():
    scene = build_simulation().scene
    legacy = scene.to_payload(include_state=False)
    legacy.pop("blocks", None)
    project = migrate_project(legacy)
    assert project["format"] == "netlab-project"
    assert project["metadata"]["migrated_from"] == "scene-json"
    validated = validate_project(project)
    assert len(project_current_network(validated)["scene"]["nodes"]) == 3


def test_project_with_manual_block_node_reports_fix_hint():
    """P0-0：带“手动块节点”的工程在校验阶段就给出可修复提示，不等到运行。"""
    simulation = build_simulation()
    try:
        project = build_project(simulation, name="bad-block")
    finally:
        simulation.shutdown()
    project["networks"][0]["scene"]["nodes"].append(
        {
            "id": "bbbbbbbbbbb1",
            "name": "block1",
            "kind": "block",
            "params": {},
            "data": {},
            "position": {"x": 0.0, "y": 0.0},
        }
    )
    project["checksum"] = compute_checksum(project)
    with pytest.raises(ValidationError, match="缺少 block_id") as excinfo:
        validate_project(project)
    assert "重新实例化" in str(excinfo.value)


def test_project_with_block_roundtrip():
    simulation = build_simulation()
    try:
        scene = simulation.scene
        node = next(item for item in scene.nodes.values() if item.name == "b")
        block = encapsulate_nodes(scene, [node.id], name="twice")
        scene.ensure_engine()
        project = build_project(simulation, name="with-block")
        assert len(project["blocks"]) == 1
        assert project["blocks"][0]["id"] == block.id

        validated = validate_project(project)
        assert len(validated["blocks"]) == 1
        payload = project_scene_payload(validated)
        assert len(payload["blocks"]) == 1

        restored = Simulation(Scene("signal"))
        try:
            restored.load_scene(payload)
            restored.scene.ensure_engine()
            for _ in range(2):
                restored.scene.step(0.01)
            target = next(
                item for item in restored.scene.nodes.values() if item.name == "c"
            )
            assert target.data["value"] == pytest.approx(6.0)
        finally:
            restored.shutdown()
    finally:
        simulation.shutdown()


def test_checksum_survives_javascript_number_roundtrip():
    """浏览器 JSON 只有一种 number：整数值浮点会变成 int，-0.0 会变成 0。"""
    simulation = build_simulation()
    try:
        project = build_project(
            simulation, ui={"view": {"x": -430.0, "y": 0.0, "k": 1.0}}
        )
    finally:
        simulation.shutdown()

    def jsify(value):
        if isinstance(value, bool) or value is None:
            return value
        if isinstance(value, float):
            if value == 0:
                return 0
            if value.is_integer():
                return int(value)
            return value
        if isinstance(value, dict):
            return {key: jsify(item) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [jsify(item) for item in value]
        return value

    js_project = json.loads(json.dumps(jsify(project)))
    assert js_project["checksum"] == project["checksum"]
    validate_project(js_project)


def _opamp_circuit_simulation() -> Simulation:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vcc = scene.add_node(name="vcc", kind="node", data={"voltage": 12.0})
    out = scene.add_node(name="out", kind="node")
    mid = scene.add_node(name="mid", kind="node")
    scene.add_edge(
        name="V1",
        source=vcc.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 12.0, "amplitude": 0.0},
    )
    opamp = scene.add_node(
        name="U1",
        kind="device",
        params={"element": "opamp", "gain": 1e5, "vcc": 12.0, "vee": 0.0},
    )
    for name, pin, target in (
        ("W1", "OUT", out),
        ("W2", "IN+", mid),
        ("W3", "IN-", gnd),
        ("W4", "V+", vcc),
        ("W5", "V-", gnd),
    ):
        scene.add_edge(
            name=name,
            source=opamp.id,
            target=target.id,
            kind="wire",
            source_pin=pin,
        )
    scene.add_edge(
        name="RL", source=out.id, target=gnd.id, kind="resistor", params={"R": 1000.0}
    )
    scene.add_edge(
        name="RB", source=mid.id, target=gnd.id, kind="resistor", params={"R": 1000.0}
    )
    simulation = Simulation(scene)
    simulation.apply_config({"dt": 1e-5})
    return simulation


def test_validate_normalizes_scene_without_breaking_checksum():
    """旧工程缺少元件新增参数的默认值：规范化后必须重算校验和，二次校验仍通过。"""
    simulation = _opamp_circuit_simulation()
    try:
        project = build_project(simulation)
    finally:
        simulation.shutdown()

    # 模拟 R26 之前保存的工程：opamp 参数里没有 gbw/slew_rate。
    for node in project["networks"][0]["scene"]["nodes"]:
        params = node.get("params") or {}
        for key in ("gbw", "slew_rate"):
            params.pop(key, None)
    project.pop("checksum", None)
    project["checksum"] = compute_checksum(project)

    validated = validate_project(project)
    assert validated["checksum"] == compute_checksum(validated)
    # 打开工程会走两次校验（load_project + _apply_project），第二次必须仍然通过。
    again = validate_project(validated)
    assert again["name"] == validated["name"]
    scene = project_scene_payload(again)
    opamp = next(node for node in scene["nodes"] if node["name"] == "U1")
    assert opamp["params"]["gbw"] == 0.0
    assert opamp["params"]["slew_rate"] == 0.0


def test_project_export_import_api_roundtrip(client):
    exported = client.post(
        "/api/project/export", json={"ui": {"view": {"x": 1.5, "y": 2.0, "k": 1.0}}}
    )
    assert exported.status_code == 200
    project = exported.json()["project"]
    # 再模拟一次浏览器 JSON 往返，校验和必须仍然成立。
    roundtripped = json.loads(json.dumps(project))
    imported = client.post("/api/project/import", json={"project": roundtripped})
    assert imported.status_code == 200, imported.text
    body = imported.json()
    assert len(body["scene"]["nodes"]) == 4
    assert body["project"]["checksum"] == project["checksum"]


def test_project_import_with_extensions_requires_trust(client):
    exported = client.post("/api/project/export", json={}).json()["project"]
    exported["extensions"] = [
        {"kind": "user.demo", "type": "node", "code": "x = 1\n", "sha256": "0"}
    ]
    exported = migrate_project(exported)
    exported["checksum"] = compute_checksum(exported)
    response = client.post("/api/project/import", json={"project": exported})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "不是沙箱" in detail
    assert "trust_extensions=true" in detail


def test_project_rejects_block_node_with_missing_definition():
    payload = {
        "format": "netlab-project",
        "version": 1,
        "scene": {
            "mode": "signal",
            "nodes": [
                {
                    "id": "eeeeeeeeeeee",
                    "name": "blk",
                    "kind": "block",
                    "params": {"block_id": "ffffffffffff", "block_name": "ghost"},
                    "data": {},
                    "position": {"x": 0.0, "y": 0.0},
                }
            ],
            "edges": [],
        },
        "blocks": [],
        "sim": {},
        "fem": {},
        "ui": {},
        "extensions": [],
    }
    payload = migrate_project(payload)
    payload["checksum"] = compute_checksum(payload)
    with pytest.raises(ValidationError, match="功能块不存在"):
        validate_project(payload)


def test_project_rejects_cyclic_blocks():
    payload = {
        "format": "netlab-project",
        "version": 1,
        "scene": {"mode": "signal", "nodes": [], "edges": []},
        "blocks": [
            {
                "id": "aaaaaaaaaaaa",
                "name": "A",
                "mode": "signal",
                "nodes": [
                    {
                        "id": "bbbbbbbbbbbb",
                        "name": "inner",
                        "kind": "block",
                        "params": {"block_id": "cccccccccccc"},
                    }
                ],
                "edges": [],
                "ports": [],
            },
            {
                "id": "cccccccccccc",
                "name": "B",
                "mode": "signal",
                "nodes": [
                    {
                        "id": "dddddddddddd",
                        "name": "inner",
                        "kind": "block",
                        "params": {"block_id": "aaaaaaaaaaaa"},
                    }
                ],
                "edges": [],
                "ports": [],
            },
        ],
        "sim": {},
        "fem": {},
        "ui": {},
        "extensions": [],
    }
    payload = migrate_project(payload)
    payload["checksum"] = compute_checksum(payload)
    with pytest.raises(ValidationError, match="循环引用"):
        validate_project(payload)
