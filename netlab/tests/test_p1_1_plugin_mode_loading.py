"""P1-1 回归：插件引擎模式的场景加载／创建／切换链路。

缺陷（修复前）：插件引擎可注册（``ENGINE_SPECS``），``Scene.__init__`` 与
``project.load_project`` 也放行插件模式，但 ``scene_io.load_payload`` 与
``networks.add_network`` / ``set_network_mode`` 用内置 ``MODES`` 白名单硬拒，
造成"可注册、一加载就拒"的断链。

修复：统一走 ``scene_types.is_known_mode``（内置 MODES ∪ 已注册 ENGINE_SPECS）。
本测试覆盖：统一判定、Scene 往返、插件引擎懒创建、未知模式仍拒、内置模式不变、
networks 创建/切换插件模式。
"""

from __future__ import annotations

import pytest

from netlab.core.common.limits import ValidationError
from netlab.core.compute.simulation import Simulation
from netlab.core.model.engine_registry import (
    ENGINE_SPECS,
    register_engine,
    unregister_engine,
)
from netlab.core.model.networks import NetworkContainer, _blank_scene_payload
from netlab.core.model.scene import Scene
from netlab.core.model.scene_types import MODES, is_known_mode
from netlab.plugin_api.v1 import EngineSpec

PLUGIN_MODE = "fake_plugin_mode_p1_1"


class _DummyEngine:
    """满足 EngineProtocol 的最小引擎，供 ensure_engine 使用。"""

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
        label="Fake Plugin",
        description="P1-1 测试用假插件引擎",
        factory=lambda scene: _DummyEngine(),
    )
    register_engine(spec, plugin_id="test.p1_1")
    try:
        yield spec
    finally:
        unregister_engine(PLUGIN_MODE)
        assert PLUGIN_MODE not in ENGINE_SPECS


def test_is_known_mode_builtin_and_unknown():
    for mode in MODES:
        assert is_known_mode(mode) is True
    assert is_known_mode("definitely_unknown_mode") is False


def test_is_known_mode_sees_registered_plugin(plugin_engine):
    assert is_known_mode(PLUGIN_MODE) is True


def test_plugin_scene_roundtrip(plugin_engine):
    scene = Scene(PLUGIN_MODE)
    assert scene.mode == PLUGIN_MODE
    payload = scene.to_payload()
    assert payload["mode"] == PLUGIN_MODE

    restored = Scene(PLUGIN_MODE)
    restored.load_payload(payload)  # 修复前此处抛 ValidationError
    assert restored.mode == PLUGIN_MODE
    assert restored.nodes == {}


def test_plugin_engine_created_lazily(plugin_engine):
    scene = Scene(PLUGIN_MODE)
    engine = scene.ensure_engine()
    assert isinstance(engine, _DummyEngine)


def test_unknown_mode_still_rejected():
    scene = Scene("signal")
    with pytest.raises(ValidationError):
        scene.load_payload(
            {"mode": "definitely_unknown_mode", "nodes": [], "edges": []}
        )


def test_builtin_mode_roundtrip_unchanged():
    scene = Scene("signal")
    scene.add_node(name="n1", kind="manual", data={"voltage": 1.0})
    payload = scene.to_payload()
    restored = Scene("signal")
    restored.load_payload(payload)
    assert len(restored.nodes) == 1
    assert next(iter(restored.nodes.values())).name == "n1"


def test_blank_scene_payload_builtin_and_plugin(plugin_engine):
    builtin = _blank_scene_payload("signal")
    assert isinstance(builtin, dict) and builtin.get("mode") == "signal"
    plugin = _blank_scene_payload(PLUGIN_MODE)
    assert plugin == {"mode": PLUGIN_MODE, "nodes": [], "edges": [], "blocks": []}


def test_container_add_and_switch_plugin_mode(plugin_engine):
    initial = Simulation(Scene("signal"))
    container = NetworkContainer(initial, name="主网络")
    try:
        added = container.add_network(name="插件层", mode=PLUGIN_MODE)
        assert added["mode"] == PLUGIN_MODE
        network_id = added["id"]

        switched = container.set_network_mode(network_id, "circuit")
        assert switched["mode"] == "circuit"
    finally:
        container.shutdown()
