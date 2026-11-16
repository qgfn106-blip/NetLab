"""P2-D 兼容层契约测试（D1，纯测试、零生产代码改动）。

依据 P2-D 只读草案 10_P2D_COMPATIBILITY_READONLY_DESIGN.md 与审批裁定：
- 锁定 PROJECT_VERSION==7 且 8 未注册进 SCHEMA_MIGRATIONS（C1：不主动收缩兼容窗口）；
- v0–v7 及独立 scene-json 经现有 loader/migrate_project 仍可读，且与既有 golden 一致；
- 未知/未来版本（>7、v8）显式拒绝（fail-closed，不静默升级）。
"""

from __future__ import annotations

import copy
import json
import os

import pytest

from netlab.core.common.limits import ValidationError
from netlab.core.model import project as project_mod

LEGACY_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "projects", "legacy")
GOLDEN_PATH = os.path.join(LEGACY_DIR, "migrate_golden.json")
CASE_NAMES = ["scene_json", "v0", "v1", "v2", "v2_nonempty_scene", "v3", "v4", "v5", "v6", "v7"]


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


def test_current_version_is_7_and_no_v8_registered() -> None:
    assert project_mod.PROJECT_VERSION == 7
    assert 8 not in project_mod.SCHEMA_MIGRATIONS
    assert set(project_mod.SCHEMA_MIGRATIONS) == {1, 2, 4, 5, 6, 7}
    assert project_mod._MIGRATION_STEPS == (1, 2, 4, 5, 6, 7)


@pytest.mark.parametrize("name", CASE_NAMES)
def test_legacy_golden_still_readable_and_consistent(name: str, fixed_ids: None) -> None:
    with open(os.path.join(LEGACY_DIR, f"{name}.json"), encoding="utf-8") as fh:
        payload = json.load(fh)
    with open(GOLDEN_PATH, encoding="utf-8") as fh:
        golden = json.load(fh)[name]
    out = project_mod.migrate_project(copy.deepcopy(payload))
    assert out["version"] == project_mod.PROJECT_VERSION
    assert out["format"] == project_mod.PROJECT_FORMAT
    assert _normalize(out) == golden, f"{name} 迁移输出偏离既有 golden（兼容窗口被破坏）"


@pytest.mark.parametrize("version", [8, 9, 99])
def test_future_or_unknown_version_rejected(version: int) -> None:
    payload = {
        "format": project_mod.PROJECT_FORMAT,
        "version": version,
        "networks": [{"id": "n1", "name": "网络 1", "scene": {"mode": "signal", "nodes": [], "edges": []}, "sim": {}}],
        "current": "n1",
    }
    with pytest.raises(ValidationError):
        project_mod.migrate_project(copy.deepcopy(payload))
