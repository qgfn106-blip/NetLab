"""阶段 8 · P1-S2 Engine SPI v2 · 切片1（G1+G2+G7）。

G1：EngineSpec 补齐 SPI v2 目标字段（domain/version/supported_port_types/plugin_id/metadata，加性默认值，不改既有字段）。
G2：注册表消费 node_kinds/edge_kinds 白名单（插件模式限定可用的节点/连接类型）。
G7：内建与插件引擎统一经 ``create_engine`` 创建，``Scene.ensure_engine`` 走同一入口（消除内建 if/else 分支）。
"""

from __future__ import annotations

import dataclasses

import pytest

from netlab.core.common.limits import ValidationError
from netlab.core.model.scene_engines import CircuitEngine, SignalEngine
from netlab.core.model.engine_registry import (
    create_engine,
    engine_catalog,
    register_engine,
    unregister_engine,
    validate_kind,
)
from netlab.core.model.scene import Scene
from netlab.plugin_api.v1 import EngineSpec

PLUGIN_MODE = "spi2_plugin_mode"

class _DummyEngine:
    """满足 EngineProtocol 的最小引擎。"""

    def build(self, scene, store):
        return None

    def step(self, dt):
        return None

    def reset(self):
        return None

    def probes(self):
        return {}

    def stats(self):
        return {}

@pytest.fixture()
def plugin_engine():
    spec = EngineSpec(
        mode=PLUGIN_MODE,
        label="SPI2",
        description="spi2 demo",
        factory=lambda scene: _DummyEngine(),
        node_kinds=("manual",),
        edge_kinds=("scale",),
    )
    register_engine(spec, plugin_id="test")
    try:
        yield spec
    finally:
        unregister_engine(PLUGIN_MODE)


def test_engine_spec_exposes_spi_v2_fields():
    names = {f.name for f in dataclasses.fields(EngineSpec)}
    for required in ("domain", "version", "supported_port_types", "plugin_id", "metadata"):
        assert required in names, f"EngineSpec 缺 SPI v2 字段 {required}"
    spec = EngineSpec(mode="x", label="x", description="", factory=lambda s: None)
    assert spec.domain == ""
    assert spec.version == ""
    assert tuple(spec.supported_port_types) == ()
    assert spec.plugin_id == ""
    assert dict(spec.metadata) == {}


def test_create_engine_handles_builtin_modes():
    from netlab.core.model.engine_registry import _builtin_factory

    assert _builtin_factory("circuit") is CircuitEngine
    assert _builtin_factory("signal") is SignalEngine
    assert _builtin_factory("vector") is SignalEngine
    assert _builtin_factory("definitely_not_a_mode") is None
    assert isinstance(Scene("signal").ensure_engine(), SignalEngine)
    assert isinstance(Scene("vector").ensure_engine(), SignalEngine)


def test_create_engine_unknown_mode_raises_keyerror():
    with pytest.raises(KeyError):
        create_engine("definitely_not_a_mode", Scene("signal"))


def test_validate_kind_unit(plugin_engine):
    validate_kind(PLUGIN_MODE, "manual")
    with pytest.raises(ValidationError):
        validate_kind(PLUGIN_MODE, "sum")
    # 内置模式不额外限制（保持既有行为）
    validate_kind("signal", "any_kind")


def test_plugin_kind_whitelist_node(plugin_engine):
    scene = Scene(PLUGIN_MODE)
    scene.add_node(name="ok", kind="manual")
    with pytest.raises(ValidationError) as exc:
        scene.add_node(name="bad", kind="sum")
    assert "引擎模式" in str(exc.value)


def test_plugin_kind_whitelist_edge(plugin_engine):
    scene = Scene(PLUGIN_MODE)
    a = scene.add_node(name="a", kind="manual")
    b = scene.add_node(name="b", kind="manual")
    scene.add_edge(source=a.id, target=b.id, kind="scale")
    with pytest.raises(ValidationError) as exc:
        scene.add_edge(source=a.id, target=b.id, kind="sum")
    assert "引擎模式" in str(exc.value)


def test_engine_catalog_consumes_kinds(plugin_engine):
    rows = engine_catalog()
    row = next(r for r in rows if r["mode"] == PLUGIN_MODE)
    assert row["node_kinds"] == ["manual"]
    assert row["edge_kinds"] == ["scale"]
