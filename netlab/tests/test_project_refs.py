"""R03：工程块引用（只记 id+version）、库解析、版本锁定与缺失清单。"""

from __future__ import annotations

import json
import shutil

import pytest

from netlab.core.model import blocklib
from netlab.core.model.blocks import BlockDef, PortDef
from netlab.core.common.limits import ValidationError
from netlab.core.model.project import (
    build_project,
    project_scene_payload,
    validate_project,
)
from netlab.core.model.scene import Scene
from netlab.core.compute.simulation import Simulation
from netlab.core.model.workspace import load_workspace, save_workspace


def build_block(version: int = 1) -> BlockDef:
    return BlockDef(
        id="aaaaaaaaaaaa",
        name="twice",
        mode="signal",
        description="",
        version=version,
        nodes=[
            {
                "id": "bbbbbbbbbbb1",
                "name": "inner",
                "kind": "sum",
                "params": {},
                "data": {},
                "position": {"x": 0.0, "y": 0.0},
            },
            {
                "id": "bbbbbbbbbbb2",
                "name": "__in",
                "kind": "module_input",
                "params": {
                    "role": "interface",
                    "port_name": "in",
                    "fields": ["voltage"],
                },
                "data": {},
                "position": {"x": -100.0, "y": 0.0},
            },
            {
                "id": "bbbbbbbbbbb3",
                "name": "__out",
                "kind": "module_output",
                "params": {
                    "role": "interface",
                    "port_name": "out",
                    "fields": ["voltage"],
                },
                "data": {},
                "position": {"x": 100.0, "y": 0.0},
            },
        ],
        edges=[],
        ports=[
            PortDef(name="in", direction="input", fields=["voltage"]),
            PortDef(name="out", direction="output", fields=["voltage"]),
        ],
    )


def scene_with_block(library) -> Simulation:
    """场景里只登记模块定义（不需要实例化即可被工程引用）。"""
    block = build_block()
    blocklib.write_block(library, block)
    scene = Scene("signal")
    scene.blocks.add(block)
    scene.add_node(name="src", kind="manual", data={"voltage": 2.0})
    simulation = Simulation(scene)
    simulation.apply_config({"fps": 30, "dt": 0.01, "steps_per_frame": 1})
    return simulation


def test_project_saves_block_refs_when_library_given(tmp_path):
    library = tmp_path / "library"
    simulation = scene_with_block(library)
    try:
        project = build_project(simulation, name="refs", library=str(library))
    finally:
        simulation.shutdown()
    assert project["blocks"] == [{"id": "aaaaaaaaaaaa", "version": 1}]
    assert "nodes" not in project["blocks"][0]

    validated = validate_project(project, library=str(library))
    payload = project_scene_payload(validated, library=str(library))
    assert len(payload["blocks"]) == 1
    assert payload["blocks"][0]["id"] == "aaaaaaaaaaaa"


def test_refs_require_library_and_report_missing(tmp_path):
    library = tmp_path / "library"
    simulation = scene_with_block(library)
    try:
        project = build_project(simulation, name="refs", library=str(library))
    finally:
        simulation.shutdown()

    with pytest.raises(ValidationError, match="库路径"):
        validate_project(project)

    blocklib.find_block_path(library, "aaaaaaaaaaaa").unlink()
    with pytest.raises(ValidationError, match="缺失|不存在") as excinfo:
        validate_project(project, library=str(library))
    assert "aaaaaaaaaaaa@v1" in str(excinfo.value)


def test_ensure_blocks_bumps_version_when_content_changes(tmp_path):
    library = tmp_path / "library"
    first = blocklib.ensure_blocks(library, [build_block().to_payload()])
    assert first == [{"id": "aaaaaaaaaaaa", "version": 1}]

    changed = build_block().to_payload()
    changed["description"] = "改过描述"
    second = blocklib.ensure_blocks(library, [changed])
    assert second == [{"id": "aaaaaaaaaaaa", "version": 2}]
    assert blocklib.load_block(library, "aaaaaaaaaaaa").version == 2


def test_workspace_save_open_with_block_refs(tmp_path):
    target = tmp_path / "lab" / "proj"
    simulation = scene_with_block(tmp_path / "seed-lib")
    # 让工程自己的 library 拥有同内容块
    library = target.parent / "library"
    blocklib.ensure_blocks(library, [build_block().to_payload()])
    try:
        workspace, saved = save_workspace(target, simulation, name="refs-ws")
    finally:
        simulation.shutdown()
    document = json.loads(saved.read_text(encoding="utf-8"))
    assert document["blocks"] == [{"id": "aaaaaaaaaaaa", "version": 1}]

    reopened, project = load_workspace(target)
    assert len(project["blocks"]) == 1
    payload = project_scene_payload(project, library=str(reopened.library))
    restored = Simulation(Scene("signal"))
    try:
        restored.load_scene(payload)
        restored.scene.ensure_engine()
        restored.scene.step(0.01)
    finally:
        restored.shutdown()


def test_export_api_uses_refs_and_import_resolves(client, tmp_path, monkeypatch):
    library = tmp_path / "api-library"
    monkeypatch.setenv("NETLAB_SETTINGS_DIR", str(tmp_path / "settings"))
    configured = client.patch("/api/settings", json={"library_root": str(library)})
    assert configured.status_code == 200, configured.text

    # 通过 API 封装一个节点，让场景里出现模块
    nodes = client.get("/api/scene/export").json()["nodes"]
    mixed = next(node for node in nodes if node["name"] == "mixed")
    created = client.post(
        "/api/blocks/encapsulate",
        json={"node_ids": [mixed["id"]], "name": "api-refs", "library": str(library)},
    )
    assert created.status_code == 200, created.text
    block_id = created.json()["block"]["id"]

    project = client.get("/api/project").json()["project"]
    assert project["blocks"]
    assert all("nodes" not in item for item in project["blocks"])

    # 把引用指向的库文件删掉 → 降级只读打开：给出缺失清单、禁止运行/编辑（D7）
    blocklib.find_block_path(library, block_id).unlink()
    imported = client.post("/api/project/import", json={"project": project})
    assert imported.status_code == 200, imported.text
    body = imported.json()
    assert body["degraded"]["read_only"] is True
    assert body["degraded"]["missing"][0]["id"] == block_id

    blocked = client.post("/api/control", json={"action": "step", "steps": 1})
    assert blocked.status_code == 409
    assert "降级" in blocked.json()["detail"]

    node_id = body["scene"]["nodes"][0]["id"]
    readonly = client.patch(
        f"/api/nodes/{node_id}", json={"position": {"x": 1.0, "y": 2.0}}
    )
    assert readonly.status_code == 409


def test_degraded_retry_after_library_restored(client, tmp_path, monkeypatch):
    """补回库文件后 /api/project/retry 能解除只读；仍缺失时 409。"""
    from netlab.core.model.blocks import instantiate_block

    library = tmp_path / "library"
    monkeypatch.setenv("NETLAB_SETTINGS_DIR", str(tmp_path / "settings"))
    client.patch("/api/settings", json={"library_root": str(library)})
    block = build_block()
    blocklib.write_block(library, block)

    scene = Scene("signal")
    scene.blocks.add(block)
    scene.add_node(name="src", kind="manual", data={"voltage": 1.0})
    instantiate_block(scene, block.id, position={"x": 0.0, "y": 0.0})
    simulation = Simulation(scene)
    simulation.apply_config({"fps": 30, "dt": 0.01, "steps_per_frame": 1})
    try:
        project = build_project(simulation, name="retry", library=str(library))
    finally:
        simulation.shutdown()
    assert len(project["blocks"]) == 1

    target = blocklib.find_block_path(library, block.id)
    saved = target.read_text(encoding="utf-8")
    target.unlink()
    degraded = client.post("/api/project/import", json={"project": project})
    assert degraded.status_code == 200, degraded.text
    assert degraded.json()["degraded"] is not None

    still = client.post("/api/project/retry")
    assert still.status_code == 409

    target.write_text(saved, encoding="utf-8")
    retried = client.post("/api/project/retry")
    assert retried.status_code == 200, retried.text
    assert retried.json()["degraded"] is None
    stepped = client.post("/api/control", json={"action": "step", "steps": 1})
    assert stepped.status_code == 200
