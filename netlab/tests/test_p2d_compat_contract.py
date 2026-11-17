"""P2-D 兼容层契约测试（D1，纯测试、零生产代码改动）。

依据 P2-D 只读草案 10_P2D_COMPATIBILITY_READONLY_DESIGN.md 与审批裁定：
- 锁定 PROJECT_VERSION==7 且 8 未注册进 SCHEMA_MIGRATIONS（C1：不主动收缩兼容窗口）；
- 未知/未来版本（>7、v8）显式拒绝（fail-closed，不静默升级）。

注：v0–v7 与独立 scene-json 的「迁移输出 == golden」逐字节对拍已由
`test_project_migrations_golden.py::test_legacy_fixture_matches_golden` 唯一负责，
本文件不再重复同一断言（REM-B5-01 去重），只保留版本策略与拒绝语义。
"""

from __future__ import annotations

import copy

import pytest

from netlab.core.common.limits import ValidationError
from netlab.core.model import project as project_mod


def test_current_version_is_7_and_no_v8_registered() -> None:
    assert project_mod.PROJECT_VERSION == 7
    assert 8 not in project_mod.SCHEMA_MIGRATIONS
    assert set(project_mod.SCHEMA_MIGRATIONS) == {1, 2, 4, 5, 6, 7}
    assert project_mod._MIGRATION_STEPS == (1, 2, 4, 5, 6, 7)


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
