"""R02 模块库文件层：.block 读写、版本规则、扫描与 API。"""

from __future__ import annotations

import copy
import json

import pytest

from netlab import blocklib
from netlab.blocks import BlockDef, PortDef
from netlab.limits import NotFoundError, ValidationError


def build_block(name: str = "双增益", *, version: int = 1) -> BlockDef:
    return BlockDef(
        id="aaaaaaaaaaaa",
        name=name,
        mode="signal",
        description="测试模块",
        version=version,
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
        model="structural",
    )


def test_block_file_layout_and_roundtrip(tmp_path):
    library = tmp_path / "library"
    block = build_block()
    path = blocklib.write_block(library, block)
    assert path == (library / "blocks" / "双增益.block").resolve()
    assert path.is_file()

    restored = blocklib.read_block_file(path)
    assert restored.id == block.id
    assert restored.model == "structural"
    assert restored.to_payload()["ports"][0]["name"] == "in"
    assert restored.version == 1

    document = json.loads(path.read_text(encoding="utf-8"))
    assert document["format"] == blocklib.BLOCK_FORMAT
    assert document["block"]["model"] == "structural"
    assert document["checksum"]

    scan = blocklib.scan_library(library)
    assert len(scan) == 1
    assert scan[0]["name"] == "双增益"
    assert scan[0]["versions"] == [1]
    assert scan[0]["model"] == "structural"


def test_write_block_bumps_version_and_rejects_duplicate_name(tmp_path):
    library = tmp_path / "library"
    block = build_block()
    first = blocklib.write_block(library, block)
    # 内容相同 → 幂等，同一个文件
    assert blocklib.write_block(library, build_block()) == first

    changed = build_block(name="双增益", version=1)
    changed.description = "改过描述"
    again = blocklib.write_block(library, changed)
    assert again == first
    assert blocklib.load_block(library, "aaaaaaaaaaaa").version == 2

    # 另一个模块用同名 → 拒绝
    other = build_block(name="双增益")
    other.id = "dddddddddddd"
    with pytest.raises(ValidationError, match="模块名已存在"):
        blocklib.write_block(library, other)


def test_rename_block_moves_file_and_rejects_duplicate(tmp_path):
    library = tmp_path / "library"
    blocklib.write_block(library, build_block())
    renamed = blocklib.rename_block(library, "aaaaaaaaaaaa", "加法")
    assert renamed.name == "加法"
    assert (library / "blocks" / "加法.block").is_file()
    assert not (library / "blocks" / "双增益.block").exists()

    second = build_block(name="另一个")
    second.id = "dddddddddddd"
    blocklib.write_block(library, second)
    with pytest.raises(ValidationError, match="模块名已存在"):
        blocklib.rename_block(library, "dddddddddddd", "加法")


def test_migrate_library_flattens_legacy_folders(tmp_path):
    library = tmp_path / "library"
    legacy = library / "blocks" / "aaaaaaaaaaaa"
    legacy.mkdir(parents=True)
    document = blocklib.render_block_file(build_block())
    (legacy / "v1.block").write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")

    scan = blocklib.scan_library(library)
    assert [item["name"] for item in scan] == ["双增益"]
    assert (library / "blocks" / "双增益.block").is_file()
    assert not legacy.exists()


def test_import_requires_higher_version(tmp_path):
    library = tmp_path / "library"
    first = blocklib.import_block(library, build_block().to_payload())
    assert first["version"] == 1

    with pytest.raises(ValidationError, match="必须更高"):
        blocklib.import_block(library, build_block(name="v1 改").to_payload())

    payload = build_block(name="v2").to_payload()
    payload["version"] = 2
    second = blocklib.import_block(library, payload)
    assert second["version"] == 2

    versions = blocklib.list_versions(library, "aaaaaaaaaaaa")
    assert [item["version"] for item in versions] == [2]
    latest = blocklib.load_block(library, "aaaaaaaaaaaa")
    assert latest.name == "v2"
    # 库里只保留最新版：按旧版本号读取也拿到最新内容
    assert blocklib.load_block(library, "aaaaaaaaaaaa", 1).name == "v2"


def test_tampered_and_malformed_files_are_rejected(tmp_path):
    library = tmp_path / "library"
    path = blocklib.write_block(library, build_block())
    document = json.loads(path.read_text(encoding="utf-8"))

    tampered = copy.deepcopy(document)
    tampered["block"]["name"] = "被改过"
    with pytest.raises(ValidationError, match="校验和"):
        blocklib.parse_block_file(tampered)

    bad_format = copy.deepcopy(document)
    bad_format["format"] = "something-else"
    with pytest.raises(ValidationError, match="不是 Netlab 模块文件"):
        blocklib.parse_block_file(bad_format)

    bad_edge = copy.deepcopy(document)
    bad_edge["block"]["edges"] = [
        {"id": "cccccccccccc", "source": "nope", "target": "bbbbbbbbbbb1"}
    ]
    bad_edge["checksum"] = blocklib._block_checksum(bad_edge["block"])
    with pytest.raises(ValidationError, match="端点不存在"):
        blocklib.parse_block_file(bad_edge)

    with pytest.raises(NotFoundError):
        blocklib.load_block(library, "ffffffffffff")


def test_missing_block_and_bad_ids(tmp_path):
    library = tmp_path / "library"
    with pytest.raises(NotFoundError):
        blocklib.list_versions(library, "ffffffffffff")
    with pytest.raises(ValidationError):
        blocklib.block_path(library, "../escape", 1)
    with pytest.raises(ValidationError):
        blocklib.block_path(library, "aaaaaaaaaaaa", 0)


def test_blocks_api_scan_import_and_detail(client, tmp_path):
    library = tmp_path / "api-library"
    payload = build_block().to_payload()

    imported = client.post(
        "/api/blocks/import", json={"payload": payload, "library": str(library)}
    )
    assert imported.status_code == 200, imported.text
    body = imported.json()
    assert body["version"] == 1
    assert body["library"] == str(library)
    assert len(body["blocks"]) == 1

    listed = client.get("/api/blocks", params={"library": str(library)})
    assert listed.status_code == 200
    assert listed.json()["blocks"][0]["id"] == "aaaaaaaaaaaa"

    detail = client.get(
        f"/api/blocks/aaaaaaaaaaaa", params={"library": str(library)}
    )
    assert detail.status_code == 200, detail.text
    assert detail.json()["block"]["model"] == "structural"
    assert [item["version"] for item in detail.json()["versions"]] == [1]

    conflict = client.post(
        "/api/blocks/import", json={"payload": payload, "library": str(library)}
    )
    assert conflict.status_code == 200, "相同内容重复导入应幂等"

    bad = client.post(
        "/api/blocks/import",
        json={"payload": {**payload, "name": "改名但仍 v1"}, "library": str(library)},
    )
    assert bad.status_code == 422
    assert "必须更高" in bad.json()["detail"]
