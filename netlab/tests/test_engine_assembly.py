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
    assert assembly.model is not None
    assert assembly.compiled.mode == "signal"
    assert assembly.compiled.engine is assembly.model
    assert assembly.runtime is assembly.model
    assert scene.ensure_engine() is assembly.runtime


def test_touch_reassembles_engine_and_updates_assembly() -> None:
    scene = Scene("signal")
    scene.load_payload(build_template("signal_chain"))
    first = scene.assembly

    scene.set_algebraic_solver(True)
    second = scene.assembly

    assert second is not first
    assert second.model is not first.model
    assert second.runtime is not first.runtime
    assert scene.ensure_engine() is second.runtime


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
