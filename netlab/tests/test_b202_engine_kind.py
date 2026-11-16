"""REM-B2-02 (PS-02): EngineSpec kind/id.

engine 插件注册键须与 spec.mode 一致；未给 kind 时按 mode 派生；
显式 kind 与 mode 不一致 fail-closed；非 engine 能力仍走 _qualify 前缀逻辑。
"""
from __future__ import annotations

import types

import pytest

from netlab.core.model import plugins as P
from netlab.core.model.engine_registry import ENGINE_OWNERS, ENGINE_SPECS
from netlab.core.common.limits import ValidationError
from netlab.plugin_api.v1 import EngineSpec, PanelSpec


def _record(pid: str = "netlab.demo"):
    return types.SimpleNamespace(
        manifest=types.SimpleNamespace(id=pid),
        registered={},
        status="discovered",
        error="",
        loaded_at="",
    )


def _spec(mode: str, **kw) -> EngineSpec:
    return EngineSpec(
        mode=mode, label="Demo", description="d", factory=lambda scene: scene, **kw
    )


def _cleanup(mode: str) -> None:
    ENGINE_SPECS.pop(mode, None)
    ENGINE_OWNERS.pop(mode, None)


def test_engine_without_kind_derives_from_mode():
    pm = P.PluginManager()
    rec = _record()
    try:
        pm._install(rec, "engine", _spec("demo_nokind"))
        assert "demo_nokind" in ENGINE_SPECS
        assert ENGINE_OWNERS["demo_nokind"] == "netlab.demo"
        assert rec.registered["engine"] == ["demo_nokind"]
        assert ENGINE_SPECS["demo_nokind"].factory(object()) is not None
        pm._unload_record(rec)
        assert "demo_nokind" not in ENGINE_SPECS
        assert "demo_nokind" not in ENGINE_OWNERS
    finally:
        _cleanup("demo_nokind")


def test_engine_explicit_kind_equal_mode():
    pm = P.PluginManager()
    rec = _record()
    try:
        pm._install(rec, "engine", _spec("demo_eq", kind="demo_eq"))
        assert "demo_eq" in ENGINE_SPECS
        assert rec.registered["engine"] == ["demo_eq"]
        pm._unload_record(rec)
        assert "demo_eq" not in ENGINE_SPECS
    finally:
        _cleanup("demo_eq")


def test_engine_kind_mismatch_rejected():
    pm = P.PluginManager()
    rec = _record()
    try:
        with pytest.raises(ValidationError):
            pm._install(rec, "engine", _spec("demo_ne", kind="different"))
        assert "demo_ne" not in ENGINE_SPECS
        assert "demo_ne" not in ENGINE_OWNERS
    finally:
        _cleanup("demo_ne")


def test_non_engine_path_still_qualifies():
    pm = P.PluginManager()
    rec = _record()
    pm._install(
        rec, "panel", PanelSpec(id="p1", title="T", slot="main", layout={}, data_sources=[])
    )
    assert "netlab.demo.p1" in pm.panels
