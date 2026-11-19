"""P2-D 兼容层契约测试（D1），现已升级到 PROJECT_VERSION 8。

- 锁定 PROJECT_VERSION==8 且 v8 迁移已注册（分析工作台布局，D9）；
- 未知/未来版本（>8）显式拒绝（fail-closed，不静默升级）。

注：v0–v7 与独立 scene-json 的「迁移输出 == golden」逐字节对拍已由
`test_project_migrations_golden.py::test_legacy_fixture_matches_golden` 唯一负责，
本文件不再重复同一断言（REM-B5-01 去重），只保留版本策略与拒绝语义。
"""

from __future__ import annotations

import copy

import pytest

from netlab.core.common.limits import ValidationError
from netlab.core.model import project as project_mod


def test_current_version_is_8_with_v8_registered() -> None:
    assert project_mod.PROJECT_VERSION == 8
    assert 8 in project_mod.SCHEMA_MIGRATIONS
    assert set(project_mod.SCHEMA_MIGRATIONS) == {1, 2, 4, 5, 6, 7, 8}
    assert project_mod._MIGRATION_STEPS == (1, 2, 4, 5, 6, 7, 8)


@pytest.mark.parametrize("version", [9, 99])
def test_future_or_unknown_version_rejected(version: int) -> None:
    payload = {
        "format": project_mod.PROJECT_FORMAT,
        "version": version,
        "networks": [{"id": "n1", "name": "网络 1", "scene": {"mode": "signal", "nodes": [], "edges": []}, "sim": {}}],
        "current": "n1",
    }
    with pytest.raises(ValidationError):
        project_mod.migrate_project(copy.deepcopy(payload))
