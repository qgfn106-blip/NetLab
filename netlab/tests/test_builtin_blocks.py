"""R25：只读内置结构块（opamp/comparator/dff/counter/shift/555/LDO/ADC/DAC）。"""

from __future__ import annotations

import pytest

from netlab.core.model import blocklib
from netlab.core.model.builtins import builtin_blocks, builtin_ids


@pytest.fixture(autouse=True)
def cleanup_networks(client):
    initial = {item["id"] for item in client.get("/api/networks").json()["networks"]}
    yield
    for item in client.get("/api/networks").json()["networks"]:
        if item["id"] not in initial:
            client.delete(f"/api/networks/{item['id']}")


def test_builtin_catalog_has_nine_readonly_structural_blocks():
    blocks = builtin_blocks()
    assert len(blocks) == 9
    assert {block.id for block in blocks} == builtin_ids()
    expected = {"opamp", "comparator", "dff", "counter4", "shift4", "timer555", "ldo", "adc4", "dac4"}
    assert {block.metadata.get("slug") for block in blocks} == expected
    assert all(block.builtin and block.model == "structural" for block in blocks)
    assert {block.name for block in blocks} >= {"内置运放", "内置比较器", "内置 555 定时器"}
    # 每个块都有可打开的内部节点、边和端口；端口名唯一。
    for block in blocks:
        assert block.nodes and block.edges and block.ports
        assert len({port.name for port in block.ports}) == len(block.ports)
        block.validate() if hasattr(block, "validate") else None
        assert len({node["id"] for node in block.nodes}) == len(block.nodes)


def test_builtin_blocks_are_merged_into_library_and_protected(client, tmp_path):
    library = str(tmp_path / "library")
    listed = client.get("/api/blocks", params={"library": library})
    assert listed.status_code == 200, listed.text
    rows = listed.json()["blocks"]
    assert len(rows) == 9
    assert all(row["builtin"] for row in rows)
    opamp = next(row for row in rows if row["name"] == "内置运放")
    assert opamp["model"] == "structural"

    # 内置块不依赖 library/blocks 文件：空库也能打开内部结构。
    opened = client.post(
        f"/api/blocks/{opamp['id']}/open-internal", json={"library": library}
    )
    assert opened.status_code == 200, opened.text
    body = opened.json()
    assert body["block"]["model"] == "structural"
    kinds = {node["kind"] for node in body["scene"]["nodes"]}
    assert "module_input" in kinds and "module_output" in kinds and "sum" in kinds

    # 验收②：打开内部后把当前临时网络另存为普通副本，副本可编辑且不再是内置。
    copied = client.post(
        "/api/blocks/save-copy",
        json={"library": library, "name": "我的运放副本", "description": "由内置运放另存"},
    )
    assert copied.status_code == 200, copied.text
    copy = copied.json()["block"]
    assert copy["name"] == "我的运放副本"
    assert copy["model"] == "structural"
    assert not copy["builtin"]
    assert copy["id"] != opamp["id"]

    # 只读：删除/改名/覆盖均拒绝。
    deleted = client.post(
        f"/api/blocks/{opamp['id']}/delete", json={"library": library}
    )
    assert deleted.status_code in (400, 409, 422)
    assert "内置" in deleted.text
    renamed = client.post(
        f"/api/blocks/{opamp['id']}/rename",
        json={"name": "我的运放", "library": library},
    )
    assert renamed.status_code in (400, 409, 422)
    assert "内置" in renamed.text


def test_builtin_block_load_without_library_and_scan_default_is_user_only(tmp_path):
    empty = tmp_path / "library"
    block = blocklib.load_block(empty, "a25000000001")
    assert block.name == "内置运放"
    assert block.builtin
    # 底层 scan_library 默认保持旧语义（只列用户库），API 才合并内置。
    assert blocklib.scan_library(empty) == []
    assert len(blocklib.scan_library(empty, include_builtin=True)) == 9
