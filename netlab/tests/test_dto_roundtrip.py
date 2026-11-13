"""阶段7 P1-S1：ProjectDTO/NetworkDoc/SceneDoc 恒等映射的 round-trip 测试。

目标：dto 层对当前 v7 payload 严格恒等——不改变外部 JSON、不改既有 dict 管线。
"""
from __future__ import annotations

import glob
import os

import pytest

from netlab.core.model import project as proj
from netlab.core.model.dto import ProjectDTO, NetworkDoc, SceneDoc

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "projects")
FIXTURES = sorted(glob.glob(os.path.join(FIXTURE_DIR, "*.netlab")))


def _load(path: str) -> dict:
    with open(path, "rb") as fh:
        return proj.decode_project_bytes(fh.read())


def test_fixtures_present():
    assert FIXTURES, "no .netlab fixtures found"


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: os.path.basename(p))
def test_roundtrip_payload_identity(path: str) -> None:
    payload = _load(path)
    dto = ProjectDTO.from_payload(payload)
    out = dto.to_payload()
    # dict 级恒等
    assert out == payload
    # 字节级恒等（golden：重新编码后与原始文件完全一致）
    with open(path, "rb") as fh:
        raw = fh.read()
    assert proj.encode_project_bytes(out) == raw


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: os.path.basename(p))
def test_dto_exposes_fields(path: str) -> None:
    payload = _load(path)
    dto = ProjectDTO.from_payload(payload)

    assert isinstance(dto, ProjectDTO)
    assert dto.format == payload["format"]
    assert dto.version == payload["version"]
    assert dto.app == payload.get("app")

    assert isinstance(dto.networks, list)
    assert len(dto.networks) == len(payload["networks"])
    assert [n.to_payload() for n in dto.networks] == payload["networks"]
    for net in dto.networks:
        assert isinstance(net, NetworkDoc)
        if net.scene is not None:
            assert isinstance(net.scene, SceneDoc)
            assert net.scene.to_payload() == net.to_payload()["scene"]


def test_from_payload_rejects_non_dict() -> None:
    with pytest.raises(TypeError):
        ProjectDTO.from_payload([])  # type: ignore[arg-type]
