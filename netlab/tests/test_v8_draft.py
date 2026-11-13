"""阶段7 P1-S1：v7→v8 迁移草稿的映射测试（**草稿未激活**）。

断言：① PROJECT_VERSION 仍 7、SCHEMA_MIGRATIONS 无 8、load/save 不受影响；
② 映射按 §9 生效（appearance / wire / signal / port 标记）；
③ 字段只加不删（原 payload 所有键与值原样保留），入参不被修改。
"""
from __future__ import annotations

import copy
import json

import pytest

from netlab.core.model import project as project_mod
from netlab.core.model.v8_draft import migrate_v7_to_v8


def _v7_payload() -> dict:
    return {
        "format": project_mod.PROJECT_FORMAT,
        "version": 7,
        "app": "netlab 3.20.1",
        "name": "草稿样例",
        "created": "2026-01-01T00:00:00+00:00",
        "modified": "2026-01-01T00:00:00+00:00",
        "networks": [
            {
                "id": "n1",
                "name": "网络 1",
                "scene": {
                    "mode": "signal",
                    "nodes": [
                        {
                            "id": "a",
                            "kind": "signal",
                            "appearance": {"color": "#f00", "w": 12},
                            "port_type": "voltage",
                        },
                        {"id": "b", "kind": "signal"},
                    ],
                    "edges": [
                        {"id": "e1", "kind": "wire", "source": "a", "target": "b"},
                        {
                            "id": "e2",
                            "kind": "signal",
                            "source": "a",
                            "target": "b",
                            "appearance": {"line": "dash"},
                        },
                    ],
                },
                "sim": {},
                "states": [],
            }
        ],
        "current": "n1",
        "fem": {},
        "ui": {},
        "blocks": [],
        "extensions": [],
        "plugins": [],
        "metadata": {},
        "checksum": "deadbeef",
    }


def test_draft_is_not_activated() -> None:
    assert project_mod.PROJECT_VERSION == 7
    assert 8 not in project_mod.SCHEMA_MIGRATIONS
    # 现有迁移链不会产出 version=8
    out = project_mod.migrate_project(copy.deepcopy(_v7_payload()))
    assert out["version"] == 7
    assert "presentation" not in out
    assert "schema_version" not in out


def test_mapping() -> None:
    payload = _v7_payload()
    before = copy.deepcopy(payload)
    out = migrate_v7_to_v8(payload)

    assert payload == before, "入参不得被修改"
    assert out["version"] == 8 and out["schema_version"] == "v8-draft"
    assert out["presentation"]["node_styles"]["a"] == {"color": "#f00", "w": 12}
    assert out["presentation"]["edge_styles"]["e2"] == {"line": "dash"}
    edges = {e["id"]: e for e in out["networks"][0]["scene"]["edges"]}
    assert edges["e1"]["v8_kind"] == "PhysicalEdge"
    assert edges["e2"]["v8_kind"] == "DependencyEdge"
    assert out["compat"]["extensions"]["ports"]["a"] == {
        "port_type": "voltage",
        "port_id": None,
    }


def test_only_adds_fields_no_data_loss() -> None:
    payload = _v7_payload()
    out = migrate_v7_to_v8(copy.deepcopy(payload))
    # 原 payload 是 out 的「去掉新增字段」后的子集
    for key, value in payload.items():
        if key == "version":
            continue
        if key == "networks":
            # 节点/边新增 v8_kind；其余保持
            for i, net in enumerate(value):
                o_net = out["networks"][i]
                for nk, nv in net.items():
                    if nk != "scene":
                        assert o_net[nk] == nv
                for j, node in enumerate(net["scene"]["nodes"]):
                    assert out["networks"][i]["scene"]["nodes"][j] == node
                for j, edge in enumerate(net["scene"]["edges"]):
                    o_edge = out["networks"][i]["scene"]["edges"][j]
                    assert {k: v for k, v in o_edge.items() if k != "v8_kind"} == edge
            continue
        if key == "compat":
            # compat 可能被扩展，但原字段保留
            for ck, cv in value.items():
                assert out["compat"][ck] == cv
            continue
        assert out[key] == value, f"键 {key} 丢失或被改写"
    assert out["checksum"] == "deadbeef"


def test_rejects_non_v7_and_non_dict() -> None:
    with pytest.raises(TypeError):
        migrate_v7_to_v8([])  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        migrate_v7_to_v8({"version": 6})
    with pytest.raises(ValueError):
        migrate_v7_to_v8({"version": 8})


def test_no_appearance_yields_no_presentation() -> None:
    payload = _v7_payload()
    payload["networks"][0]["scene"]["nodes"][0].pop("appearance")
    payload["networks"][0]["scene"]["edges"][1].pop("appearance")
    out = migrate_v7_to_v8(payload)
    assert "presentation" not in out
