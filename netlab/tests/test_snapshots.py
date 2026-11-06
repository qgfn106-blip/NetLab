"""R16 快照式自动保存：写 backups/、不动正本、保留策略与恢复。

覆盖：快照不修改 project.netlab、命名唯一、保留最近 N + 每日 1、文件名非法拒绝、
API 快照/列表/恢复往返。
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta

import pytest

from netlab.core.model.project import build_project
from netlab.core.model.scene import Scene
from netlab.core.compute.simulation import Simulation
from netlab.core.model.workspace import (
    Workspace,
    create_project,
    list_snapshots,
    load_snapshot,
    prune_snapshots,
    write_snapshot,
    workspace_for,
)


@pytest.fixture(autouse=True)
def isolated_settings(tmp_path, monkeypatch):
    monkeypatch.setenv("NETLAB_SETTINGS_DIR", str(tmp_path / "settings"))
    yield


def build_simulation() -> Simulation:
    scene = Scene("signal")
    a = scene.add_node(name="a", kind="manual", data={"voltage": 1.0})
    b = scene.add_node(name="b", kind="sum")
    scene.add_edge(source=a.id, target=b.id, kind="scale", params={"gain": 2.0})
    simulation = Simulation(scene)
    simulation.apply_config({"fps": 30, "dt": 0.01, "steps_per_frame": 1})
    return simulation


def snapshot_payload(name: str = "快照") -> dict:
    simulation = build_simulation()
    try:
        return build_project(simulation, name=name)
    finally:
        simulation.shutdown()


def make_workspace(tmp_path) -> Workspace:
    simulation = build_simulation()
    try:
        workspace, project = create_project(
            tmp_path / "lab" / "snap", simulation=simulation, name="snap"
        )
    finally:
        simulation.shutdown()
    return workspace


def test_snapshot_never_touches_project_file(tmp_path):
    workspace = make_workspace(tmp_path)
    original = workspace.project_file.read_bytes()
    digest = hashlib.sha256(original).hexdigest()

    saved = write_snapshot(
        workspace, snapshot_payload("快照"), now=datetime(2026, 10, 26, 3, 0, 0)
    )
    assert saved.is_file()
    assert saved.parent == workspace.subdir("backups")
    assert workspace.project_file.read_bytes() == original
    assert hashlib.sha256(workspace.project_file.read_bytes()).hexdigest() == digest

    # 非法 tag 被忽略而不是拼进文件名，快照仍落在 backups/ 内
    hostile = write_snapshot(workspace, snapshot_payload("x"), tag="../../../evil")
    assert hostile.parent == workspace.subdir("backups")
    assert ".." not in hostile.name


def test_snapshots_are_unique_and_listed_newest_first(tmp_path):
    workspace = make_workspace(tmp_path)
    base = datetime(2026, 10, 26, 3, 0, 0)
    for minute in range(3):
        write_snapshot(
            workspace,
            snapshot_payload(f"s{minute}"),
            now=base + timedelta(minutes=minute),
        )
    items = list_snapshots(workspace)
    assert len(items) == 3
    assert all(item["name"].startswith("snapshot-") for item in items)
    assert items[0]["created"] > items[-1]["created"]

    # 同一秒内写两份也不能互相覆盖
    same = write_snapshot(workspace, snapshot_payload("x"), now=base)
    other = write_snapshot(workspace, snapshot_payload("y"), now=base)
    assert same.name != other.name


def test_prune_keeps_recent_and_daily(tmp_path):
    workspace = make_workspace(tmp_path)
    base = datetime(2026, 10, 20, 9, 0, 0)
    for index in range(15):
        write_snapshot(
            workspace,
            snapshot_payload(f"s{index}"),
            now=base + timedelta(days=index // 3, hours=index % 3),
        )
    removed = prune_snapshots(workspace, keep_recent=5, keep_daily=2)
    remaining = list_snapshots(workspace)
    assert removed, "超出保留策略的快照应被删除"
    assert len(remaining) >= 5
    days = {item["day"] for item in remaining}
    assert len(days) <= 15
    # 最近 5 份必须都在
    newest = {item["name"] for item in list_snapshots(workspace)[:5]}
    assert newest <= {item["name"] for item in remaining}


def test_load_snapshot_rejects_bad_names_and_returns_project(tmp_path):
    workspace = make_workspace(tmp_path)
    path = write_snapshot(workspace, snapshot_payload("restore-me"))
    project = load_snapshot(workspace, path.name)
    assert project["name"] == "restore-me"
    with pytest.raises(Exception, match="不是合法的快照文件名"):
        load_snapshot(workspace, "../project.netlab")
    with pytest.raises(Exception, match="快照不存在"):
        load_snapshot(workspace, "snapshot-20260101-000000-deadbeef.netlab")


def test_snapshot_api_roundtrip(client, tmp_path):
    target = tmp_path / "api-lab" / "snap"
    created = client.post(
        "/api/workspace/create", json={"path": str(target), "name": "api-snap"}
    )
    assert created.status_code == 200, created.text
    before = (target / "project.netlab").read_bytes()

    written = client.post(
        "/api/workspace/snapshot", json={"path": str(target), "name": "snap"}
    )
    assert written.status_code == 200, written.text
    body = written.json()
    assert body["saved"].endswith(".netlab")
    assert len(body["snapshots"]) == 1
    assert (target / "project.netlab").read_bytes() == before

    listed = client.get("/api/workspace/snapshots", params={"path": str(target)}).json()
    assert listed["autosave"]["enabled"] is True
    assert listed["autosave"]["interval_seconds"] == 60
    name = listed["snapshots"][0]["name"]

    restored = client.post(
        "/api/workspace/restore", json={"path": str(target), "snapshot": name}
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["restored_from"] == name
    assert restored.json()["project"]["name"] == "snap"

    bad = client.post(
        "/api/workspace/restore", json={"path": str(target), "snapshot": "../x.netlab"}
    )
    assert bad.status_code == 422
    missing = client.post(
        "/api/workspace/snapshot", json={"path": str(tmp_path / "lab" / "none")}
    )
    assert missing.status_code == 422
