"""阶段7 P1-S1：v0–v7 golden fixtures 的迁移回归（CI 可复现）。

golden 由重构前的 if 链实现生成（见 NetlabExtras/scratch/migrate_characterize.py）：
10 个旧格式/旧版本输入 → 归一化（去 created/modified、键排序）后的期望输出。
本测试固定 `_now` / `_network_id`，对每个 fixture 再跑一次 `migrate_project`，
与 golden 逐字段比较 —— 保证 if 链→SCHEMA_MIGRATIONS 重构及后续改动零行为变化。
"""
from __future__ import annotations

import copy
import json
import os

import pytest

from netlab.core.model import project as project_mod

LEGACY_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "projects", "legacy")
GOLDEN_PATH = os.path.join(LEGACY_DIR, "migrate_golden.json")
CASE_NAMES = [
    "scene_json",
    "v0",
    "v1",
    "v2",
    "v2_nonempty_scene",
    "v3",
    "v4",
    "v5",
    "v6",
    "v7",
]


def _normalize(obj: dict) -> dict:
    obj = json.loads(json.dumps(obj, default=str, sort_keys=True))
    obj.pop("created", None)
    obj.pop("modified", None)
    return obj


@pytest.fixture
def fixed_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(project_mod, "_now", lambda: "2026-01-01T00:00:00+00:00")
    seq = [0]

    def nid() -> str:
        seq[0] += 1
        return f"netfixed{seq[0]}"

    monkeypatch.setattr(project_mod, "_network_id", nid)


def test_golden_file_present() -> None:
    assert os.path.isfile(GOLDEN_PATH)
    with open(GOLDEN_PATH, encoding="utf-8") as fh:
        golden = json.load(fh)
    assert set(golden) == set(CASE_NAMES)


@pytest.mark.parametrize("name", CASE_NAMES)
def test_legacy_fixture_matches_golden(name: str, fixed_ids: None) -> None:
    with open(os.path.join(LEGACY_DIR, f"{name}.json"), encoding="utf-8") as fh:
        payload = json.load(fh)
    with open(GOLDEN_PATH, encoding="utf-8") as fh:
        golden = json.load(fh)[name]

    out = project_mod.migrate_project(copy.deepcopy(payload))
    assert _normalize(out) == golden, f"{name} 迁移输出偏离 golden"
    assert out["version"] == project_mod.PROJECT_VERSION


@pytest.mark.parametrize("name", CASE_NAMES)
def test_legacy_fixture_dto_roundtrip(name: str) -> None:
    """迁移结果仍是合规 v7 payload，DTO 接缝对其严格恒等。"""
    from netlab.core.model.dto import ProjectDTO

    with open(os.path.join(LEGACY_DIR, f"{name}.json"), encoding="utf-8") as fh:
        payload = json.load(fh)
    migrated = project_mod.migrate_project(copy.deepcopy(payload))
    dto = ProjectDTO.from_payload(migrated)
    assert dto.to_payload() == migrated
