"""R01 工作区回归：工程目录树、共享库、用户设置、workspace API。

覆盖：新建工程目录、重复创建拒绝、两个工程共用 library、删除工程不影响库、
设置落在用户目录（测试用 NETLAB_SETTINGS_DIR 指向 tmp）、保存→打开往返、
API 拒绝非法路径与未知设置项。
"""

from __future__ import annotations

import json

import pytest

from netlab.core.model.project import (
    project_current_network,
    project_from_text,
    save_project,
)
from netlab.core.model.scene import Scene
from netlab.core.compute.simulation import Simulation
from netlab.core.model.networks import NetworkContainer
from netlab.core.model.workspace import (
    DEFAULT_SETTINGS,
    PROJECT_FILENAME,
    PROJECT_SUBDIRS,
    create_project,
    default_settings,
    ensure_library,
    load_settings,
    load_workspace,
    project_file_for,
    save_settings,
    save_workspace,
    scan_library,
    settings_file,
    workspace_for,
)


@pytest.fixture(autouse=True)
def isolated_settings(tmp_path, monkeypatch):
    """设置目录与真实 %APPDATA% 隔离。"""
    monkeypatch.setenv("NETLAB_SETTINGS_DIR", str(tmp_path / "settings"))
    yield


def build_simulation() -> Simulation:
    scene = Scene("signal")
    a = scene.add_node(name="a", kind="manual", data={"voltage": 2.0})
    b = scene.add_node(name="b", kind="sum")
    scene.add_edge(source=a.id, target=b.id, kind="scale", params={"gain": 3.0})
    simulation = Simulation(scene)
    simulation.apply_config({"fps": 30, "dt": 0.01, "steps_per_frame": 1})
    return simulation


def test_create_project_keeps_all_networks(tmp_path):
    """新建工程也必须走容器的多网络打包，不能只保存当前网络。"""
    first = build_simulation()
    container = NetworkContainer(first, name="第一层")
    container.add_network("第二层")
    target = tmp_path / "created"
    try:
        create_project(target, simulation=container, name="multi")
        payload = project_from_text((target / PROJECT_FILENAME).read_bytes())
        assert [item["name"] for item in payload["networks"]] == ["第一层", "第二层"]
    finally:
        container.shutdown()


def test_save_project_keeps_all_networks(tmp_path):
    first = build_simulation()
    container = NetworkContainer(first, name="第一层")
    container.add_network("第二层")
    path = tmp_path / "multi" / "project.netlab"
    try:
        save_project(path, container, name="multi")
        payload = project_from_text(path.read_bytes())
    finally:
        container.shutdown()
    assert [item["name"] for item in payload["networks"]] == ["第一层", "第二层"]
    assert payload["current"] in {item["id"] for item in payload["networks"]}


def test_create_project_makes_directory_tree(tmp_path):
    target = tmp_path / "lab" / "demo"
    simulation = build_simulation()
    try:
        workspace, project = create_project(target, simulation=simulation, name="demo")
    finally:
        simulation.shutdown()

    assert workspace.project_file == (target / PROJECT_FILENAME).resolve()
    assert workspace.project_file.is_file()
    for subdir in PROJECT_SUBDIRS:
        assert (target / subdir).is_dir(), subdir
    assert (tmp_path / "lab" / "library" / "blocks").is_dir()
    assert (tmp_path / "lab" / "library" / "templates").is_dir()
    assert project["name"] == "demo"
    assert len(project_current_network(project)["scene"]["nodes"]) == 2

    with pytest.raises(Exception, match="拒绝覆盖"):
        create_project(target, simulation=simulation)


def test_projects_share_library_and_delete_keeps_it(tmp_path):
    one = tmp_path / "lab" / "one"
    two = tmp_path / "lab" / "two"
    ensure_library(tmp_path / "lab" / "library")
    marker = tmp_path / "lab" / "library" / "blocks" / "gain.block"
    marker.write_text('{"id": "gain"}', encoding="utf-8")

    for path in (one, two):
        simulation = build_simulation()
        try:
            workspace, _ = create_project(path, simulation=simulation)
        finally:
            simulation.shutdown()
        assert marker.is_file()
        assert workspace.library == (tmp_path / "lab" / "library").resolve()
        scan = scan_library(workspace)
        assert [item["name"] for item in scan["blocks"]] == ["gain.block"]

    import shutil

    shutil.rmtree(one)
    assert marker.is_file(), "删除工程不能影响共享库"


def test_settings_live_in_user_dir_and_validate(tmp_path):
    path = settings_file()
    assert str(tmp_path / "settings") in str(path)
    assert load_settings() == default_settings()

    settings = save_settings({"autosave_interval_seconds": 30, "theme": "dark"})
    assert settings["autosave_interval_seconds"] == 30
    assert json.loads(path.read_text(encoding="utf-8"))["theme"] == "dark"
    assert "project.netlab" not in path.name

    with pytest.raises(Exception, match="未知设置项"):
        save_settings({"nope": 1})
    with pytest.raises(Exception, match="之间"):
        save_settings({"autosave_keep_recent": 0})
    with pytest.raises(Exception, match="theme"):
        save_settings({"theme": "neon"})


def test_corrupt_settings_fall_back_to_defaults(tmp_path):
    path = settings_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{not json", encoding="utf-8")
    assert load_settings() == DEFAULT_SETTINGS


def test_save_and_open_project_directory_roundtrip(tmp_path):
    target = tmp_path / "lab" / "roundtrip"
    simulation = build_simulation()
    try:
        simulation.scene.step(0.01)
        workspace, saved = save_workspace(target, simulation, name="rt")
    finally:
        simulation.shutdown()
    assert saved.is_file()

    reopened, project = load_workspace(target)
    assert reopened.root == target.resolve()
    assert project["name"] == "rt"
    assert len(project_current_network(project)["scene"]["nodes"]) == 2
    assert project_from_text(saved.read_bytes())["name"] == "rt"


def test_workspace_api_roundtrip(client, tmp_path):
    target = tmp_path / "api-lab" / "proj"
    created = client.post(
        "/api/workspace/create", json={"path": str(target), "name": "api-demo"}
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["workspace"]["exists"] is True
    assert body["library"]["exists"] is True
    assert body["project"]["nodes"] == 4

    saved = client.post("/api/workspace/save", json={"path": str(target)})
    assert saved.status_code == 200, saved.text
    assert (target / PROJECT_FILENAME).is_file()

    opened = client.post("/api/workspace/open", json={"path": str(target)})
    assert opened.status_code == 200, opened.text
    assert opened.json()["workspace"]["project_file"].endswith(PROJECT_FILENAME)
    assert len(opened.json()["scene"]["nodes"]) == 4

    info = client.get("/api/workspace", params={"path": str(target)}).json()
    assert info["workspace"]["exists"] is True
    assert info["settings"]["autosave_enabled"] is True

    patched = client.patch("/api/settings", json={"autosave_interval_seconds": 15})
    assert patched.status_code == 200, patched.text
    assert patched.json()["settings"]["autosave_interval_seconds"] == 15

    bad = client.post("/api/workspace/create", json={"path": str(target)})
    assert bad.status_code == 422
    assert "拒绝覆盖" in bad.json()["detail"]

    missing = client.post("/api/workspace/open", json={"path": str(tmp_path / "nope")})
    assert missing.status_code == 422
    assert "工程文件不存在" in missing.json()["detail"]


def test_workspace_open_failure_keeps_previous_workspace(client, tmp_path, monkeypatch):
    from netlab import server
    from netlab.core.common.limits import ValidationError

    first = tmp_path / "ws-a"
    second = tmp_path / "ws-b"
    for path, name in ((first, "A"), (second, "B")):
        created = client.post(
            "/api/workspace/create", json={"path": str(path), "name": name}
        )
        assert created.status_code == 200, created.text

    opened = client.post("/api/workspace/open", json={"path": str(first)})
    assert opened.status_code == 200, opened.text
    first_root = opened.json()["workspace"]["root"]
    assert str(server.CURRENT_WORKSPACE) == first_root

    def fail_apply(*args, **kwargs):
        raise ValidationError("模拟打开失败")

    monkeypatch.setattr(server, "_apply_project", fail_apply)
    failed = client.post("/api/workspace/open", json={"path": str(second)})
    assert failed.status_code == 422, failed.text
    assert str(server.CURRENT_WORKSPACE) == first_root
    monkeypatch.undo()

    snapshot = client.post(
        "/api/workspace/snapshot", json={"path": str(second), "name": "B快照"}
    )
    assert snapshot.status_code == 200, snapshot.text
    restored = client.post(
        "/api/workspace/restore",
        json={
            "path": str(second),
            "snapshot": snapshot.json()["snapshots"][0]["name"],
        },
    )
    assert restored.status_code == 200, restored.text
    assert str(server.CURRENT_WORKSPACE) == restored.json()["workspace"]["root"]


def test_workspace_for_rejects_unknown_suffix(tmp_path):
    with pytest.raises(Exception, match="不是 Netlab 工程路径"):
        workspace_for(tmp_path / "x.txt")


def test_path_guard_rejects_escape_and_accepts_configured_root(tmp_path, monkeypatch):
    from netlab.core.common.limits import ValidationError

    allowed = tmp_path / "allowed"
    allowed.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()

    monkeypatch.setenv("NETLAB_ALLOWED_ROOTS", str(allowed))
    assert project_file_for(allowed / "project") == allowed / "project" / PROJECT_FILENAME

    with pytest.raises(ValidationError, match="不在允许的根目录内"):
        project_file_for(outside / "project")
    with pytest.raises(ValidationError, match="不在允许的根目录内"):
        project_file_for(allowed / ".." / "outside" / "project")

    container = NetworkContainer(build_simulation(), name="路径守卫")
    with pytest.raises(ValidationError, match="不在允许的根目录内"):
        container.set_project_dir(str(outside))
