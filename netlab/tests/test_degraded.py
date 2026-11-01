"""R03 收尾：缺失降级只读（占位块）与删除模块前的引用扫描（D6）。"""

from __future__ import annotations

import json

import pytest

from netlab import blocklib
from netlab.blocks import BlockDef, PortDef
from netlab.limits import ConflictError
from netlab.networks import NetworkContainer
from netlab.project import build_project, project_scene_payload, validate_project
from netlab.scene import Scene
from netlab.simulation import Simulation


def build_block() -> BlockDef:
    return BlockDef(
        id="aaaaaaaaaaaa",
        name="twice",
        mode="signal",
        description="",
        version=1,
        nodes=[
            {
                "id": "bbbbbbbbbbb1",
                "name": "inner",
                "kind": "sum",
                "params": {},
                "data": {},
                "position": {"x": 0.0, "y": 0.0},
            }
        ],
        edges=[],
        ports=[
            PortDef(name="in", direction="input", fields=["voltage"]),
            PortDef(name="out", direction="output", fields=["voltage"]),
        ],
    )


def project_with_block(library, tmp_path):
    block = build_block()
    blocklib.ensure_blocks(library, [block.to_payload()])
    scene = Scene("signal")
    scene.blocks.add(block)
    scene.add_node(name="src", kind="manual", data={"voltage": 1.0})
    simulation = Simulation(scene)
    simulation.apply_config({"fps": 30, "dt": 0.01, "steps_per_frame": 1})
    # 让场景里出现一个块节点（用于占位块端口推导）
    from netlab.blocks import instantiate_block

    instantiate_block(scene, block.id, position={"x": 0.0, "y": 0.0})
    try:
        project = build_project(simulation, name="degraded", library=str(library))
    finally:
        simulation.shutdown()
    return project, block


def test_degraded_validation_builds_placeholder_scene(tmp_path):
    library = tmp_path / "library"
    project, block = project_with_block(library, tmp_path)
    blocklib.find_block_path(library, block.id).unlink()

    degraded = validate_project(project, library=str(library), allow_degraded=True)
    assert degraded["degraded"]["read_only"] is True
    assert degraded["degraded"]["missing"][0]["id"] == block.id

    payload = project_scene_payload(
        degraded, library=str(library), allow_degraded=True
    )
    placeholder = next(item for item in payload["blocks"] if item["id"] == block.id)
    assert placeholder["metadata"]["placeholder"] is True
    assert {port["name"] for port in placeholder["ports"]} >= {"in", "out"}
    # 占位块必须能真正装配进引擎（端口与内部接口节点对齐）
    restored = Simulation(Scene("signal"))
    try:
        restored.load_scene(payload)
        restored.scene.ensure_engine()
        assert block.id in restored.scene.blocks.defs
    finally:
        restored.shutdown()


def test_reference_scan_and_guarded_delete(tmp_path, client, monkeypatch):
    library = tmp_path / "library"
    blocklib.ensure_blocks(library, [build_block().to_payload()])
    project_root = tmp_path / "projects"
    project_root.mkdir()
    (project_root / "a.netlab").write_text(
        json.dumps({"name": "工程 A", "blocks": [{"id": "aaaaaaaaaaaa", "version": 1}]}),
        encoding="utf-8",
    )
    (project_root / "b.netlab").write_text(
        json.dumps({"name": "工程 B", "blocks": []}), encoding="utf-8"
    )
    monkeypatch.setenv("NETLAB_SETTINGS_DIR", str(tmp_path / "settings"))

    from netlab.workspace import scan_block_references

    refs = scan_block_references(project_root, "aaaaaaaaaaaa")
    assert [item["name"] for item in refs] == ["工程 A"]

    listed = client.get(
        "/api/blocks/aaaaaaaaaaaa/references",
        params={"projects_root": str(project_root)},
    )
    assert listed.status_code == 200, listed.text
    assert listed.json()["references"][0]["name"] == "工程 A"

    blocked = client.post(
        "/api/blocks/aaaaaaaaaaaa/delete",
        json={"library": str(library), "projects_root": str(project_root)},
    )
    assert blocked.status_code == 409
    assert "仍被工程引用" in blocked.json()["detail"]

    forced = client.post(
        "/api/blocks/aaaaaaaaaaaa/delete",
        json={
            "library": str(library),
            "projects_root": str(project_root),
            "force": True,
        },
    )
    assert forced.status_code == 200, forced.text
    assert forced.json()["removed"] == [1]
    assert blocklib.find_block_path(library, "aaaaaaaaaaaa") is None


def test_degraded_container_blocks_load_scene_and_structure_edits():
    """D7：容器入口也必须拦截场景替换与网络增删改，不能只拦当前 Simulation。"""
    simulation = Simulation(Scene("signal"))
    container = NetworkContainer(simulation, name="只读")
    try:
        container.set_degraded({"read_only": True, "missing": []})
        with pytest.raises(ConflictError, match="降级只读"):
            container.load_scene({"nodes": [], "edges": []})
        with pytest.raises(ConflictError, match="降级只读"):
            container.add_network("新网络")
        with pytest.raises(ConflictError, match="降级只读"):
            container.rename_network(container.current_id, "改名")
        with pytest.raises(ConflictError, match="降级只读"):
            container.remove_network(container.current_id)
    finally:
        container.shutdown()

