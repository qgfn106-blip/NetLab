"""P1 收尾：D6 改名/覆盖（引用扫描 + force）与 R04 报告落 exports/。"""

from __future__ import annotations

import json

from netlab.core.model import blocklib
from netlab.core.model.blocks import BlockDef, PortDef


def build_block(name: str = "twice") -> BlockDef:
    return BlockDef(
        id="aaaaaaaaaaaa",
        name=name,
        mode="signal",
        description="测试模块",
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


def project_refs(root, name="工程 A"):
    (root / f"{name}.netlab").write_text(
        json.dumps({"name": name, "blocks": [{"id": "aaaaaaaaaaaa", "version": 1}]}),
        encoding="utf-8",
    )


def test_rename_scans_references_and_force(client, tmp_path):
    library = tmp_path / "library"
    projects = tmp_path / "projects"
    projects.mkdir()
    blocklib.write_block(library, build_block())
    project_refs(projects)

    blocked = client.post(
        "/api/blocks/aaaaaaaaaaaa/rename",
        json={"name": "新名字", "library": str(library), "projects_root": str(projects)},
    )
    assert blocked.status_code == 409
    assert "仍被工程引用" in blocked.json()["detail"]

    forced = client.post(
        "/api/blocks/aaaaaaaaaaaa/rename",
        json={
            "name": "新名字",
            "library": str(library),
            "projects_root": str(projects),
            "force": True,
        },
    )
    assert forced.status_code == 200, forced.text
    assert forced.json()["block"]["name"] == "新名字"
    assert blocklib.load_block(library, "aaaaaaaaaaaa").name == "新名字"


def test_overwrite_same_version_without_references(client, tmp_path):
    library = tmp_path / "library"
    projects = tmp_path / "projects"
    projects.mkdir()
    blocklib.write_block(library, build_block())

    changed = build_block().to_payload()
    changed["description"] = "覆盖后的描述"
    overwritten = client.post(
        "/api/blocks/aaaaaaaaaaaa/overwrite",
        json={"payload": changed, "library": str(library), "projects_root": str(projects)},
    )
    assert overwritten.status_code == 200, overwritten.text
    assert overwritten.json()["block"]["version"] == 1
    assert blocklib.load_block(library, "aaaaaaaaaaaa").description == "覆盖后的描述"


def test_overwrite_with_references_needs_force(client, tmp_path):
    library = tmp_path / "library"
    projects = tmp_path / "projects"
    projects.mkdir()
    blocklib.write_block(library, build_block())
    project_refs(projects)

    changed = build_block().to_payload()
    changed["description"] = "改过"
    blocked = client.post(
        "/api/blocks/aaaaaaaaaaaa/overwrite",
        json={"payload": changed, "library": str(library), "projects_root": str(projects)},
    )
    assert blocked.status_code == 409

    forced = client.post(
        "/api/blocks/aaaaaaaaaaaa/overwrite",
        json={
            "payload": changed,
            "library": str(library),
            "projects_root": str(projects),
            "force": True,
        },
    )
    assert forced.status_code == 200, forced.text
    assert blocklib.load_block(library, "aaaaaaaaaaaa").description == "改过"


def test_validate_report_saved_into_workspace_exports(client, tmp_path):
    project = tmp_path / "lab" / "proj"
    created = client.post("/api/workspace/create", json={"path": str(project), "name": "报告工程"})
    assert created.status_code == 200, created.text

    valid = build_block().to_payload()
    valid["ports"] = [
        {"name": "in", "direction": "input", "fields": ["voltage"], "dtype": "signal", "default": 0.0},
        {"name": "out", "direction": "output", "fields": ["voltage"], "dtype": "signal", "default": 0.0},
    ]
    valid["nodes"] = [
        {
            "id": "ccccccccccc1",
            "name": "__in",
            "kind": "module_input",
            "params": {"role": "interface", "port_name": "in", "fields": ["voltage"]},
            "data": {},
            "position": {"x": 0.0, "y": 0.0},
        },
        {
            "id": "ccccccccccc2",
            "name": "inner",
            "kind": "sum",
            "params": {},
            "data": {},
            "position": {"x": 0.0, "y": 0.0},
        },
        {
            "id": "ccccccccccc3",
            "name": "__out",
            "kind": "module_output",
            "params": {"role": "interface", "port_name": "out", "fields": ["voltage"]},
            "data": {},
            "position": {"x": 0.0, "y": 0.0},
        },
    ]
    valid["edges"] = [
        {"id": "ddddddddddd1", "name": "e1", "source": "ccccccccccc1", "target": "ccccccccccc2", "kind": "pass", "params": {}},
        {"id": "ddddddddddd2", "name": "e2", "source": "ccccccccccc2", "target": "ccccccccccc3", "kind": "pass", "params": {}},
    ]
    response = client.post(
        "/api/blocks/validate",
        json={"payload": valid, "save_report": True},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    path = body["report_path"]
    assert path.startswith(str(project / "exports"))
    saved = json.loads(open(path, encoding="utf-8").read())
    assert saved["ok"] is True
    assert "通过" in saved["text"]
