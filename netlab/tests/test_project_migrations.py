"""P1-S1 阶段7：Project 版本迁移注册表（SCHEMA_MIGRATIONS）回归测试。

锁定两件事：
1) 注册表结构（阈值 1/2/4/5/6/7，均为可调用），由 migrate_project 顺序驱动；
2) 各旧版本 payload 迁移后均到达当前 PROJECT_VERSION 且结构合法、可重复迁移（幂等）。
真正的「旧输出逐字节不变」由 NetlabExtras/scratch/migrate_characterize.py 的
golden 比对保证（重构前后 10 例一致）。
"""
from __future__ import annotations

import copy

import pytest

from netlab.core.model import project as project_mod


def _scene() -> dict:
    return {"mode": "signal", "nodes": [], "edges": []}


def _payload(version: int) -> dict:
    return {
        "format": project_mod.PROJECT_FORMAT,
        "version": version,
        "networks": [
            {"id": "n1", "name": "网络 1", "scene": _scene(), "sim": {}},
        ],
        "current": "n1",
    }


def test_registry_structure() -> None:
    assert set(project_mod.SCHEMA_MIGRATIONS) == {1, 2, 4, 5, 6, 7}
    for step, fn in project_mod.SCHEMA_MIGRATIONS.items():
        assert callable(fn), f"迁移步 {step} 不是可调用对象"
    assert project_mod._MIGRATION_STEPS == (1, 2, 4, 5, 6, 7)


@pytest.mark.parametrize("version", range(0, project_mod.PROJECT_VERSION))
def test_each_legacy_version_reaches_current(version: int) -> None:
    payload = _payload(version) if version >= 2 else {
        "format": project_mod.PROJECT_FORMAT,
        "version": version,
        "scene": _scene(),
        "sim": {},
    }
    out = project_mod.migrate_project(copy.deepcopy(payload))
    assert out["version"] == project_mod.PROJECT_VERSION
    assert out["format"] == project_mod.PROJECT_FORMAT
    assert isinstance(out.get("networks"), list) and out["networks"]
    for network in out["networks"]:
        assert isinstance(network.get("scene"), dict)
        # v7 步：每条网络补齐 states 列表
        assert isinstance(network.get("states"), list)


def test_v6_payload_gets_states_and_is_idempotent() -> None:
    # v6 工程经 v7 步补齐 states；再迁移一次应保持不变（幂等）。
    payload = _payload(6)
    out1 = project_mod.migrate_project(copy.deepcopy(payload))
    out2 = project_mod.migrate_project(copy.deepcopy(out1))
    assert out1["networks"][0]["states"] == []
    # 幂等：再迁移一次不应改变结构（去掉时间戳）
    a, b = copy.deepcopy(out1), copy.deepcopy(out2)
    a.pop("created", None), a.pop("modified", None)
    b.pop("created", None), b.pop("modified", None)
    assert a == b


def test_v7_existing_states_preserved() -> None:
    payload = _payload(7)
    payload["networks"][0]["states"] = [{"id": "s1"}]
    out = project_mod.migrate_project(payload)
    assert out["networks"][0]["states"] == [{"id": "s1"}]


def test_migration_steps_called_in_order(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []
    originals = dict(project_mod.SCHEMA_MIGRATIONS)

    def _spy(step: int):
        real = originals[step]

        def inner(payload: dict, version: int) -> None:
            calls.append(step)
            real(payload, version)

        return inner

    monkeypatch.setattr(
        project_mod,
        "SCHEMA_MIGRATIONS",
        {s: _spy(s) for s in (1, 2, 4, 5, 6, 7)},
    )
    project_mod.migrate_project(
        {
            "format": project_mod.PROJECT_FORMAT,
            "version": 0,
            "scene": _scene(),
            "sim": {},
        }
    )
    assert calls == [1, 2, 4, 5, 6, 7]
