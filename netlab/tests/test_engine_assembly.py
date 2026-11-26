"""WP-7c：显式引擎装配（Model → Compiled → Runtime）契约。"""
from __future__ import annotations

from netlab.core.compute.simulation import default_simulation
from netlab.core.model.networks import NetworkContainer
from netlab.core.model.scene import Scene
from netlab.core.model.templates import build_template


def test_assemble_engine_exposes_all_three_stages() -> None:
    scene = Scene("signal")
    scene.load_payload(build_template("signal_chain"))
    assembly = scene.assembly

    assert assembly.mode == "signal"
    from netlab.core.model.compiled_model import CompiledModel
    from netlab.core.model.model import Model
    from netlab.core.model.runtime import Runtime

    assert isinstance(assembly.model, Model)
    assert isinstance(assembly.compiled, CompiledModel)
    assert isinstance(assembly.runtime, Runtime)
    assert assembly.compiled.mode == "signal"
    assert assembly.model is not assembly.compiled
    assert assembly.compiled is not assembly.runtime
    assert assembly.model is not assembly.runtime
    assert assembly.compiled.model_fingerprint == assembly.model.fingerprint
    assert scene.ensure_engine() is assembly.runtime.engine


def test_touch_reassembles_engine_and_updates_assembly() -> None:
    scene = Scene("signal")
    scene.load_payload(build_template("signal_chain"))
    first = scene.assembly

    scene.set_algebraic_solver(True)
    second = scene.assembly

    assert second is not first
    assert second.model is not first.model
    assert second.compiled is not first.compiled
    assert second.runtime is not first.runtime
    assert second.model is not second.runtime
    assert scene.ensure_engine() is second.runtime.engine


def test_container_ensure_assembled_prebuilds_every_network() -> None:
    simulation = default_simulation()
    container = NetworkContainer(simulation)
    assert simulation.scene._engine is None

    container.ensure_assembled()
    first = simulation.scene.assembly
    assert simulation.scene._engine is not None
    assert first is not None

    container.ensure_assembled()
    assert simulation.scene.assembly is first
