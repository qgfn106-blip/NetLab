"""R07 多网络回归：v2 迁移、容器隔离/切换/编辑、API 与工程往返。"""

from __future__ import annotations

import copy

import pytest

from netlab.core.common.limits import NotFoundError, ValidationError
from netlab.core.model.networks import NetworkContainer
from netlab.core.model.project import (
    PROJECT_VERSION,
    build_project,
    compute_checksum,
    migrate_project,
    project_current_network,
    project_networks,
    validate_project,
)
from netlab.core.model.scene import Scene
from netlab.core.compute.simulation import Simulation
from netlab.core.model.templates import build_template


def build_simulation(name: str = "a") -> Simulation:
    scene = Scene("signal")
    node = scene.add_node(name=name, kind="manual", data={"voltage": 1.0})
    scene.add_node(name=f"{name}_out", kind="sum")
    simulation = Simulation(scene)
    simulation.apply_config({"fps": 30, "dt": 0.01, "steps_per_frame": 1})
    simulation.config  # touch
    del node
    return simulation


def test_v1_project_migrates_to_single_network():
    simulation = build_simulation()
    try:
        project = build_project(simulation, name="legacy")
    finally:
        simulation.shutdown()
    network = project["networks"][0]
    legacy = copy.deepcopy(project)
    legacy["version"] = 1
    legacy["scene"] = copy.deepcopy(network["scene"])
    legacy["sim"] = copy.deepcopy(network["sim"])
    legacy.pop("networks", None)
    legacy.pop("current", None)
    legacy.pop("checksum", None)
    legacy["checksum"] = compute_checksum(legacy)

    migrated = migrate_project(legacy)
    assert migrated["version"] == PROJECT_VERSION
    assert len(migrated["networks"]) == 1
    assert migrated["current"] == migrated["networks"][0]["id"]
    assert migrated["metadata"]["migrated_from_networks"] == "v1"

    validated = validate_project(legacy)
    assert len(project_networks(validated)) == 1
    assert len(project_current_network(validated)["scene"]["nodes"]) == 2


def test_project_rejects_empty_or_duplicate_networks():
    simulation = build_simulation()
    try:
        project = build_project(simulation)
    finally:
        simulation.shutdown()
    broken = copy.deepcopy(project)
    broken["networks"] = []
    broken.pop("checksum", None)
    broken["checksum"] = compute_checksum(broken)
    with pytest.raises(ValidationError, match="非空数组"):
        validate_project(broken)

    duplicate = copy.deepcopy(project)
    duplicate["networks"].append(copy.deepcopy(duplicate["networks"][0]))
    duplicate.pop("checksum", None)
    duplicate["checksum"] = compute_checksum(duplicate)
    with pytest.raises(ValidationError, match="网络 id 重复"):
        validate_project(duplicate)


def test_container_isolation_switch_and_edits():
    container = NetworkContainer(build_simulation("one"), name="主网络")
    try:
        first = container.current_id
        created = container.add_network("副网络")
        second = created["id"]
        assert container.list_networks()[1]["name"] == "副网络"

        container.switch(first)
        container.step_once(2)
        states = {item["id"]: item for item in container.list_networks()}
        assert states[first]["steps"] == 2
        assert states[second]["steps"] == 0, "未运行层不得被推进"
        assert states[first]["running"] is False

        container.switch(second)
        container.step_once(3)
        states = {item["id"]: item for item in container.list_networks()}
        assert states[second]["steps"] == 3
        assert states[first]["steps"] == 2, "切换后旧网络保持冻结"

        renamed = container.rename_network(second, "改名网络")
        assert renamed["name"] == "改名网络"
        with pytest.raises(ValidationError, match="不能为空"):
            container.rename_network(second, "   ")

        removed = container.remove_network(second)
        assert removed["removed"] == second
        assert removed["current"] == first
        with pytest.raises(ValidationError, match="至少"):
            container.remove_network(first)
        with pytest.raises(NotFoundError):
            container.simulation(second)
    finally:
        container.shutdown()


def test_container_project_roundtrip_keeps_networks():
    container = NetworkContainer(build_simulation("one"), name="网络 A")
    try:
        container.add_network("网络 B")
        project = container.build_project(name="two-net")
        assert project["version"] == PROJECT_VERSION
        assert [item["name"] for item in project["networks"]] == ["网络 A", "网络 B"]
        current = project["current"]
        assert current == project["networks"][0]["id"]

        restored = NetworkContainer(build_simulation("tmp"))
        try:
            restored.load_project(validate_project(project))
            names = [item["name"] for item in restored.list_networks()]
            assert names == ["网络 A", "网络 B"]
            assert restored.current_id == current
        finally:
            restored.shutdown()
    finally:
        container.shutdown()


def test_network_api_crud_and_project_export(client):
    initial = client.get("/api/networks").json()
    assert len(initial["networks"]) == 1
    first_id = initial["networks"][0]["id"]

    created = client.post("/api/networks", json={"name": "第二层"})
    assert created.status_code == 200, created.text
    networks = created.json()["networks"]
    assert len(networks) == 2
    second_id = next(item["id"] for item in networks if item["name"] == "第二层")

    activated = client.post(f"/api/networks/{second_id}/activate")
    assert activated.status_code == 200, activated.text
    assert activated.json()["current"] == second_id

    renamed = client.patch(f"/api/networks/{second_id}", json={"name": "工艺层"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "工艺层"

    exported = client.get("/api/project").json()["project"]
    assert exported["version"] == PROJECT_VERSION
    assert len(exported["networks"]) == 2
    assert exported["current"] == second_id

    deleted = client.delete(f"/api/networks/{second_id}")
    assert deleted.status_code == 200, deleted.text
    assert len(deleted.json()["networks"]) == 1

    last = client.delete(f"/api/networks/{first_id}")
    assert last.status_code == 422
    assert "至少" in last.json()["detail"]

    missing = client.post("/api/networks/not-a-real-id/activate")
    assert missing.status_code == 404


def test_project_import_restores_all_networks(client):
    first = client.get("/api/networks").json()["networks"][0]["id"]
    client.post("/api/networks", json={"name": "导入前"})
    project = client.get("/api/project").json()["project"]
    assert len(project["networks"]) == 2

    # 回到单网络，再导入双网络工程
    second = next(item["id"] for item in project["networks"] if item["id"] != first)
    client.delete(f"/api/networks/{second}")

    imported = client.post("/api/project/import", json={"project": project})
    assert imported.status_code == 200, imported.text
    body = imported.json()
    assert len(body["networks"]) == 2
    assert len(body["scene"]["nodes"]) > 0
    assert body["current"] == project["current"]
