"""R05：结构模型打开内部（临时网络）与另存为副本（新 id）。"""

from __future__ import annotations

import json

import pytest

from netlab.core.model import blocklib


@pytest.fixture(autouse=True)
def cleanup_networks(client):
    """打开内部会创建临时网络；测试结束删掉，避免污染同进程后续用例。"""
    initial = {item["id"] for item in client.get("/api/networks").json()["networks"]}
    yield
    for item in client.get("/api/networks").json()["networks"]:
        if item["id"] not in initial:
            client.delete(f"/api/networks/{item['id']}")


def scene_nodes(client):
    return client.get("/api/scene/export").json()["nodes"]


def encapsulate(client, library, name="twice", model="structural"):
    nodes = scene_nodes(client)
    mixed = next(node for node in nodes if node["name"] == "mixed")
    response = client.post(
        "/api/blocks/encapsulate",
        json={
            "node_ids": [mixed["id"]],
            "name": name,
            "library": str(library),
            "model": model,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_behavioral_block_rejects_open_internal(client, tmp_path):
    library = tmp_path / "library"
    body = encapsulate(client, library, name="opaque", model="behavioral")
    block_id = body["block"]["id"]
    opened = client.post(
        f"/api/blocks/{block_id}/open-internal", json={"library": str(library)}
    )
    assert opened.status_code == 409
    assert "行为模型" in opened.json()["detail"]


def test_open_internal_creates_temporary_network_and_save_copy(client, tmp_path):
    library = tmp_path / "library"
    body = encapsulate(client, library, name="twice", model="structural")
    block_id = body["block"]["id"]
    before_networks = len(client.get("/api/networks").json()["networks"])

    opened = client.post(
        f"/api/blocks/{block_id}/open-internal", json={"library": str(library)}
    )
    assert opened.status_code == 200, opened.text
    opened_body = opened.json()
    assert opened_body["block"]["model"] == "structural"
    assert opened_body["network"]
    assert "模块 twice" in opened_body["networks"][-1]["name"]
    assert len(opened_body["networks"]) == before_networks + 1

    # 内部场景包含原模块的内部节点（sum + 两个接口节点）
    kinds = {node["kind"] for node in opened_body["scene"]["nodes"]}
    assert "sum" in kinds
    assert "module_input" in kinds and "module_output" in kinds

    # 在临时网络里改内部：加一个节点，然后另存为副本
    added = client.post(
        "/api/nodes",
        json={"name": "extra", "kind": "sum", "position": {"x": 40.0, "y": 40.0}},
    )
    assert added.status_code == 200, added.text

    copied = client.post(
        "/api/blocks/save-copy",
        json={"library": str(library), "name": "twice-v2", "description": "改过内部"},
    )
    assert copied.status_code == 200, copied.text
    copy_body = copied.json()
    new_id = copy_body["block"]["id"]
    assert new_id != block_id
    assert copy_body["block"]["model"] == "structural"
    assert copy_body["block"]["version"] == 1

    names = {item["name"] for item in copy_body["blocks"]}
    assert {"twice", "twice-v2"} <= names

    loaded = blocklib.load_block(library, new_id)
    inner_names = {str(node.get("name")) for node in loaded.nodes}
    assert "extra" in inner_names
    assert any(port.name for port in loaded.ports)

    document = json.loads(
        blocklib.find_block_path(library, new_id).read_text(encoding="utf-8")
    )
    assert document["format"] == "netlab-block"
    assert document["block"]["model"] == "structural"


def test_open_internal_rolls_back_when_scene_invalid(client, tmp_path):
    """内部网络不合法（缺接地）时不应留下空壳临时网络。"""
    from netlab.core.model.blocks import BlockDef, PortDef

    library = tmp_path / "library"
    block = BlockDef(
        id="a1b2c3d4e5f6",
        name="noground",
        description="缺接地的内部网络",
        mode="circuit",
        model="structural",
        nodes=[
            {
                "id": "111111111111",
                "name": "a",
                "kind": "node",
                "params": {},
                "position": {"x": 0.0, "y": 0.0},
            },
            {
                "id": "222222222222",
                "name": "b",
                "kind": "node",
                "params": {},
                "position": {"x": 160.0, "y": 0.0},
            },
            {
                "id": "dddddddddddd",
                "name": "R1",
                "kind": "device",
                "params": {"element": "resistor", "R": 1000.0},
                "position": {"x": 80.0, "y": -40.0},
            },
        ],
        edges=[
            {
                "id": "eeeeeeeeeee1",
                "name": "w1",
                "source": "dddddddddddd",
                "target": "111111111111",
                "kind": "wire",
                "source_pin": "1",
            },
            {
                "id": "eeeeeeeeeee2",
                "name": "w2",
                "source": "dddddddddddd",
                "target": "222222222222",
                "kind": "wire",
                "source_pin": "2",
            },
        ],
        ports=[
            PortDef(
                name="a", direction="inout", dtype="electrical", net="111111111111"
            ),
            PortDef(
                name="b", direction="inout", dtype="electrical", net="222222222222"
            ),
        ],
    )
    blocklib.write_block(library, block)

    before = {item["id"] for item in client.get("/api/networks").json()["networks"]}
    opened = client.post(
        "/api/blocks/a1b2c3d4e5f6/open-internal", json={"library": str(library)}
    )
    assert opened.status_code == 422, opened.text
    assert "接地" in opened.json()["detail"]
    after = {item["id"] for item in client.get("/api/networks").json()["networks"]}
    assert after == before, "失败的 open-internal 不应留下临时网络"
