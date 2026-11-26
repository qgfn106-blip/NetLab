"""Model / CompiledModel / Runtime 三层边界与生命周期契约。

覆盖任务要求：Model 深层不可变且无运行态、CompiledModel 独立静态编译产物、
Runtime 由 CompiledModel 创建且多实例隔离、快照带指纹校验、旧 Scene/Engine
入口仍可用。
"""
from __future__ import annotations

import copy
import json
from collections.abc import Mapping

import pytest

from netlab.core.common.limits import ValidationError
from netlab.core.model.compiled_model import COMPILER_VERSION, CompiledModel, compile_model
from netlab.core.model.model import Model
from netlab.core.model.runtime import Runtime, RuntimeSnapshot
from netlab.core.model.scene import Scene
from netlab.core.model.templates import build_template


def _signal_model() -> Model:
    return Model.from_payload(build_template("signal_chain"))


def _circuit_model() -> Model:
    return Model.from_payload(build_template("rc_step"))


def test_model_deeply_immutable_serializable_and_no_runtime_state() -> None:
    payload = build_template("signal_chain")
    model = Model.from_payload(payload)

    assert isinstance(model, Model)
    assert model == Model.from_payload(model.to_payload())
    assert model.fingerprint == Model.from_payload(model.to_payload()).fingerprint
    assert model.deep_copy() == model
    assert model.deep_copy() is not model
    copied = copy.deepcopy(model)
    assert copied == model
    assert isinstance(copied.nodes[0].params, Mapping)
    assert not isinstance(copied.nodes[0].params, dict)

    node = model.nodes[0]
    assert isinstance(node.params, Mapping)
    assert not isinstance(node.params, dict)
    assert not hasattr(node, "state")
    assert not hasattr(node, "inputs")
    with pytest.raises(TypeError):
        node.params["gain"] = 1.0  # type: ignore[index]
    nested = model.nodes[2].params
    assert isinstance(nested["weights"], Mapping)
    with pytest.raises(TypeError):
        nested["weights"]["x"] = 1  # type: ignore[index]


def test_model_from_scene_excludes_state_and_inputs() -> None:
    scene = Scene("signal")
    scene.load_payload(build_template("signal_chain"))
    record = scene.nodes["a00000000003"]
    record.state = {"internal": 3.0}
    record.inputs = {"in": {"voltage": 2.0}}

    model = Model.from_scene(scene)
    dumped = model.to_payload()
    for node in dumped["nodes"]:
        assert "state" not in node
        assert "inputs" not in node

    clean = Scene("signal")
    clean.load_payload(build_template("signal_chain"))
    assert model.fingerprint == Model.from_scene(clean).fingerprint


def test_compiled_model_is_deterministic_static_artifact() -> None:
    model = _signal_model()
    first = compile_model(model)
    second = compile_model(model)

    assert isinstance(first, CompiledModel)
    assert first is not model
    assert first is not second
    assert first.fingerprint == second.fingerprint
    assert first.model_fingerprint == model.fingerprint
    assert first.compiler_version == COMPILER_VERSION
    assert isinstance(first.node_index, Mapping)
    assert isinstance(first.scene_payload, Mapping)
    assert first.node_index["a00000000003"] == 2
    assert len(first.components) == len(model.nodes) + len(model.edges)
    assert first.order == ("a00000000001", "a00000000002", "a00000000003", "a00000000004")
    assert first.equation_structure["method"] == "signal_flow"
    assert first.diagnostics == ()
    # 编译产物只含静态描述：payload 的节点不带 state/inputs
    for node in first.to_payload()["nodes"]:
        assert "state" not in node
        assert "inputs" not in node


def test_compiled_model_changes_when_model_changes() -> None:
    model = _signal_model()
    payload = model.to_payload()
    payload["nodes"][3]["params"]["gain"] = 2.5
    changed = Model.from_payload(payload)
    assert compile_model(model).fingerprint != compile_model(changed).fingerprint
    assert compile_model(model).model_fingerprint != compile_model(changed).model_fingerprint


def test_runtime_instances_are_isolated_and_have_lifecycle() -> None:
    compiled = compile_model(_signal_model())
    first = compiled.create_runtime()
    second = compiled.create_runtime()

    assert isinstance(first, Runtime)
    assert first is not compiled
    assert first is not second
    assert first.scene is not second.scene
    assert first.engine is not second.engine

    first.step(0.001)
    assert first.generation == 1
    assert second.generation == 0

    snapshot = first.snapshot()
    assert isinstance(snapshot, RuntimeSnapshot)
    assert snapshot.model_fingerprint == compiled.model_fingerprint
    assert snapshot.compiled_fingerprint == compiled.fingerprint
    first.step(0.001)
    assert first.generation == 2
    first.restore(snapshot)
    assert first.generation == 1

    second.dispose()
    assert second.disposed is True
    with pytest.raises(RuntimeError):
        second.step(0.001)


def test_runtime_snapshot_checksum_and_version_are_verified() -> None:
    compiled = compile_model(_signal_model())
    runtime = compiled.create_runtime()
    runtime.step(0.001)
    snapshot = runtime.snapshot()
    json.dumps(snapshot.to_payload())

    tampered = snapshot.to_payload()
    tampered["generation"] = 99
    altered = RuntimeSnapshot.from_payload(tampered)
    with pytest.raises(ValidationError):
        altered.verify(
            model_fingerprint=compiled.model_fingerprint,
            compiled_fingerprint=compiled.fingerprint,
            mode=compiled.mode,
        )

    stale = snapshot.to_payload()
    stale["version"] = "runtime-snapshot/0.9"
    with pytest.raises(ValidationError):
        RuntimeSnapshot.from_payload(stale).verify(
            model_fingerprint=compiled.model_fingerprint,
            compiled_fingerprint=compiled.fingerprint,
            mode=compiled.mode,
        )


def test_model_and_compiled_cache_keys_are_stable() -> None:
    model = _signal_model()
    compiled = compile_model(model)
    assert model.cache_key == model.fingerprint
    assert compiled.cache_key == compiled.fingerprint
    assert model.cache_key == Model.from_payload(model.to_payload()).cache_key


def test_runtime_snapshot_rejects_incompatible_model() -> None:
    model = _signal_model()
    compiled = compile_model(model)
    runtime = compiled.create_runtime()
    runtime.step(0.001)
    snapshot = runtime.snapshot()

    payload = model.to_payload()
    payload["nodes"][3]["params"]["gain"] = 9.0
    other = compile_model(Model.from_payload(payload)).create_runtime()
    with pytest.raises(ValidationError):
        other.restore(snapshot)


def test_scene_assembly_exposes_three_distinct_layers_and_real_step() -> None:
    scene = Scene("signal")
    scene.load_payload(build_template("signal_chain"))
    assembly = scene.assembly

    assert isinstance(assembly.model, Model)
    assert isinstance(assembly.compiled, CompiledModel)
    assert isinstance(assembly.runtime, Runtime)
    assert assembly.model is not assembly.compiled
    assert assembly.model is not assembly.runtime
    assert assembly.compiled is not assembly.runtime
    assert scene.ensure_engine() is assembly.runtime.engine

    stats = scene.step(0.001)
    assert stats["time"] == pytest.approx(0.001)
    assert assembly.runtime.generation == 1


def test_circuit_compile_and_runtime_execute() -> None:
    model = _circuit_model()
    compiled = compile_model(model)
    assert compiled.mode == "circuit"
    assert compiled.dof_layout
    assert compiled.equation_structure["method"] == "modified_nodal_analysis"
    runtime = compiled.create_runtime()
    runtime.step(1.0e-4)
    assert runtime.stats()
    assert runtime.generation == 1
    assert runtime.compiled is compiled
