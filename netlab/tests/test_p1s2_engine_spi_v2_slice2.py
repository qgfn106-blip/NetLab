"""阶段8 P1-S2 切片2：生命周期钩子骨架 + RuntimeSnapshot 契约 + G3 注册表作用域骨架。

对应审计草案 §3.4「第二个切片」：把 checkpoint 原语上提为基类 snapshot/restore，
新增 validate / compile / create_runtime / dispose 薄壳；仍不引入 RuntimeManager，
不改数值内核、不改外部 JSON。
"""

from __future__ import annotations

from types import SimpleNamespace

from netlab.core.model.engine_registry import (
    ENGINE_SPECS,
    register_engine,
    registry_restore,
    registry_snapshot,
    reset_registry,
    unregister_engine,
)
from netlab.core.model.scene import Scene
from netlab.core.model.scene_engines import SignalEngine, _Engine
from netlab.plugin_api.v1 import Diagnostic, EngineSpec, RuntimeSnapshot


class _StubEngine(_Engine):
    def __init__(self, scene):
        self.scene = scene


def _stub_scene(mode, node_kinds, edge_kinds=()):
    nodes = {f"n{i}": SimpleNamespace(id=f"n{i}", kind=k) for i, k in enumerate(node_kinds)}
    edges = {f"e{i}": SimpleNamespace(id=f"e{i}", kind=k) for i, k in enumerate(edge_kinds)}
    return SimpleNamespace(mode=mode, nodes=nodes, edges=edges)


def test_engine_exposes_lifecycle_skeleton():
    engine = SignalEngine(Scene("signal"))
    for name in ("validate", "compile", "create_runtime", "snapshot", "restore", "dispose"):
        assert hasattr(engine, name), f"_Engine 缺少生命周期钩子 {name}"


def test_compile_and_create_runtime_return_contract_objects():
    engine = SignalEngine(Scene("signal"))
    compiled = engine.compile()
    assert compiled.mode == "signal"
    assert compiled.engine is engine
    runtime = engine.create_runtime(compiled)
    assert runtime is not None
    engine.dispose()  # 薄壳：不抛错


def test_snapshot_returns_runtime_snapshot_and_restores():
    engine = SignalEngine(Scene("signal"))
    snap = engine.snapshot()
    assert isinstance(snap, RuntimeSnapshot)
    assert snap.mode == "signal"
    assert isinstance(snap.state, dict)
    engine.restore(snap)  # 同模式同引擎往返不抛错


def test_validate_reports_kinds_outside_plugin_whitelist():
    spec = register_engine(EngineSpec(mode="plugx", label="P", description="", factory=lambda scene: None, node_kinds=("foo",), edge_kinds=("bar",)))
    engine = _StubEngine(_stub_scene("plugx", node_kinds=("foo", "baz"), edge_kinds=("bar", "qux")))
    engine.spec = spec
    diags = engine.validate()
    assert all(isinstance(d, Diagnostic) for d in diags)
    msgs = " ".join(d.message for d in diags)
    assert "baz" in msgs and "qux" in msgs
    assert "foo" not in msgs and "'bar'" not in msgs


def test_validate_builtin_mode_has_no_diagnostics():
    engine = SignalEngine(Scene("signal"))
    assert engine.validate() == []


def test_registry_scope_snapshot_restore_reset():
    before = set(ENGINE_SPECS)
    snapshot = registry_snapshot()
    register_engine(EngineSpec(mode="plugy", label="Y", description="", factory=lambda scene: None, node_kinds=("k",)))
    assert "plugy" in ENGINE_SPECS
    registry_restore(snapshot)
    assert set(ENGINE_SPECS) == before, "registry_restore 应还原到快照时的注册集"
    register_engine(EngineSpec(mode="plugz", label="Z", description="", factory=lambda scene: None, node_kinds=("k",)))
    reset_registry()
    assert set(ENGINE_SPECS) == before, "reset_registry 应清回快照/内建基线，不影响内建模式"
    assert "plugz" not in ENGINE_SPECS


def test_create_engine_attaches_spec_for_validate():
    from netlab.core.model.engine_registry import create_engine

    spec = register_engine(
        EngineSpec(
            mode="plugw",
            label="W",
            description="",
            factory=lambda scene: _StubEngine(scene),
            node_kinds=("ok",),
        )
    )
    engine = create_engine("plugw", _stub_scene("plugw", node_kinds=("ok", "bad")))
    assert engine.spec is spec
    msgs = " ".join(d.message for d in engine.validate())
    assert "bad" in msgs and "'ok'" not in msgs
