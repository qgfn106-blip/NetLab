"""模块库 API：封装选中节点 → 落库 → 实例化 → 运行。"""

from __future__ import annotations

import json

from netlab.core.model import blocklib


def scene_nodes(client):
    return client.get("/api/scene/export").json()["nodes"]


def test_encapsulate_then_instantiate_and_run(client, tmp_path):
    library = tmp_path / "library"
    nodes = scene_nodes(client)
    mixed = next(node for node in nodes if node["name"] == "mixed")

    encapsulated = client.post(
        "/api/blocks/encapsulate",
        json={
            "node_ids": [mixed["id"]],
            "name": "twice",
            "library": str(library),
        },
    )
    assert encapsulated.status_code == 200, encapsulated.text
    body = encapsulated.json()
    block_id = body["block"]["id"]
    assert body["file"]["version"] == 1
    assert blocklib.find_block_path(library, block_id) is not None

    after_encapsulate = client.get("/api/scene/export").json()
    kinds = {node["kind"] for node in after_encapsulate["nodes"]}
    assert "block" in kinds
    # 1 个内部节点被替换成 1 个块节点 + 3 个端口节点（2 入 1 出）
    assert len(after_encapsulate["nodes"]) == len(nodes) - 1 + 1 + 3

    instantiated = client.post(
        "/api/blocks/instantiate",
        json={
            "block_id": block_id,
            "library": str(library),
            "position": {"x": 100.0, "y": 50.0},
            "name_prefix": "again",
        },
    )
    assert instantiated.status_code == 200, instantiated.text
    snapshot = instantiated.json()
    assert snapshot["instance"]["block_node"]
    assert snapshot["instance"]["input_nodes"]
    assert snapshot["instance"]["output_nodes"]

    after_instantiate = client.get("/api/scene/export").json()
    block_nodes = [
        node for node in after_instantiate["nodes"] if node["kind"] == "block"
    ]
    assert len(block_nodes) == 2
    assert all(node["params"].get("block_id") == block_id for node in block_nodes)

    stepped = client.post("/api/control", json={"action": "step", "steps": 2})
    assert stepped.status_code == 200, stepped.text


def test_library_scan_after_encapsulate(client, tmp_path):
    library = tmp_path / "library"
    nodes = scene_nodes(client)
    mixed = next(node for node in nodes if node["name"] == "mixed")
    created = client.post(
        "/api/blocks/encapsulate",
        json={"node_ids": [mixed["id"]], "name": "scanned", "library": str(library)},
    )
    assert created.status_code == 200, created.text
    listed = client.get("/api/blocks", params={"library": str(library)}).json()
    user_blocks = [item for item in listed["blocks"] if not item.get("builtin")]
    assert [item["name"] for item in user_blocks] == ["scanned"]
    assert user_blocks[0]["node_count"] >= 1


def test_block_api_errors(client, tmp_path):
    library = tmp_path / "library"
    empty = client.post(
        "/api/blocks/encapsulate",
        json={"node_ids": [], "name": "nope", "library": str(library)},
    )
    assert empty.status_code == 422

    missing = client.post(
        "/api/blocks/instantiate",
        json={"block_id": "ffffffffffff", "library": str(library)},
    )
    assert missing.status_code == 404

    bad_name = client.post(
        "/api/blocks/encapsulate",
        json={
            "node_ids": [scene_nodes(client)[0]["id"]],
            "name": "",
            "library": str(library),
        },
    )
    assert bad_name.status_code == 422


def test_encapsulated_block_file_is_loadable(tmp_path, client):
    """封装落库的文件必须能被 blocklib 正常读回（格式/校验和一致）。"""
    library = tmp_path / "library"
    nodes = scene_nodes(client)
    mixed = next(node for node in nodes if node["name"] == "mixed")
    created = client.post(
        "/api/blocks/encapsulate",
        json={"node_ids": [mixed["id"]], "name": "reload", "library": str(library)},
    )
    assert created.status_code == 200, created.text
    block_id = created.json()["block"]["id"]
    restored = blocklib.load_block(library, block_id)
    assert restored.name == "reload"
    assert restored.model == "behavioral"
    document = json.loads(
        blocklib.find_block_path(library, block_id).read_text(encoding="utf-8")
    )
    assert document["format"] == "netlab-block"
