"""Plugin API v1 契约测试（批次 A2）：引擎 mode 与 BlockDef.mode 的边界。

契约（见 netlab/plugin_api/v1/__init__.py 模块文档）：
- 插件可注册自定义“引擎” mode（EngineSpec / register_engine），但不能替换内置
  signal/circuit/vector。
- BlockDef.mode 仅允许 signal/vector/circuit，不支持插件新增“功能块” mode。
- is_known_mode 对已注册引擎 mode 返回 True，对非 str 安全返回 False。
- Plugin API v1 是进程内扩展接口，不是安全沙箱。
"""

from __future__ import annotations

import pytest

import netlab.plugin_api.v1 as plugin_api
from netlab.core.common.limits import ValidationError
from netlab.core.model.blocks import BlockDef
from netlab.core.model.engine_registry import ENGINE_SPECS, register_engine, unregister_engine
from netlab.core.model.scene_types import is_known_mode
from netlab.plugin_api.v1 import EngineSpec

PLUGIN_MODE = "fake_plugin_mode_a2"


def _blockdef(mode: str) -> BlockDef:
    return BlockDef(
        id="abcd1234",
        name="blk",
        mode=mode,
        description="契约测试用功能块",
        nodes=[],
        edges=[],
        ports=[],
    )


def test_blockdef_accepts_builtin_modes_rejects_plugin_mode():
    for mode in ("signal", "vector", "circuit"):
        assert _blockdef(mode).mode == mode
    with pytest.raises(ValidationError):
        _blockdef(PLUGIN_MODE)  # 插件功能性 mode 不被 BlockDef 接受


def test_register_engine_cannot_override_builtin():
    spec = EngineSpec(mode="signal", label="x", description="x", factory=lambda scene: None)
    with pytest.raises(ValueError):
        register_engine(spec)


def test_is_known_mode_sees_registered_engine_mode():
    spec = EngineSpec(
        mode=PLUGIN_MODE, label="fake", description="批次A2契约测试", factory=lambda scene: None
    )
    register_engine(spec, plugin_id="test.a2")
    try:
        assert is_known_mode(PLUGIN_MODE) is True
        assert is_known_mode("signal") is True
        assert is_known_mode("definitely_unknown_mode") is False
        assert is_known_mode(["x"]) is False  # 非 str 安全返回 False
    finally:
        unregister_engine(PLUGIN_MODE)
        assert PLUGIN_MODE not in ENGINE_SPECS


def test_docs_state_not_a_sandbox_and_mode_boundary():
    doc = plugin_api.__doc__ or ""
    assert "安全沙箱" in doc
    assert "BlockDef.mode" in doc
    assert "EngineSpec" in doc
