"""WP-7：Model/Compiled/Runtime 生命周期与导入隔离契约。

- Model（Scene）只持有人工编辑的持久数据；Compiled（Engine）在 ensure_engine 时懒构建。
- Scene 模型变更（revision/_dirty）后，下一次 ensure_engine 必须编译新实例。
- Runtime（Simulation）拥有 Scene，并在 load_scene 后使用新 Scene 的 Engine。
- import scene 不得把 circuit 求解器、scipy 稀疏/线性代数或 simulation 循环拖进来。
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from netlab.core.compute.simulation import Simulation, default_simulation
from netlab.core.model.scene import Scene
from netlab.core.model.templates import build_template

ROOT = Path(__file__).resolve().parents[2]


def test_scene_model_starts_without_compiled_engine() -> None:
    scene = Scene("signal")
    scene.load_payload(build_template("signal_chain"))
    assert scene._engine is None
    assert scene._dirty is True


def test_dirty_scene_recompiles_engine() -> None:
    scene = Scene("signal")
    scene.load_payload(build_template("signal_chain"))
    first = scene.ensure_engine()
    assert scene.ensure_engine() is first
    assert scene._dirty is False

    scene.set_algebraic_solver(True)
    second = scene.ensure_engine()
    assert second is not first
    assert type(second).__name__ == "SignalEngine"


def test_simulation_runtime_wraps_scene_and_reloads_engine() -> None:
    simulation = default_simulation()
    original = simulation.scene
    payload = original.to_payload()
    original.ensure_engine()

    simulation.load_scene(payload)
    assert simulation.scene is not original
    assert simulation.scene.mode == original.mode
    engine = simulation.scene.ensure_engine()
    assert engine is simulation.scene._engine


def test_import_scene_does_not_load_compute_implementation() -> None:
    heavy = (
        "netlab.core.compute.circuit.solver",
        "netlab.core.compute.circuit.stamps",
        "netlab.core.compute.nodal",
        "netlab.core.compute.simulation",
        "scipy.sparse",
        "scipy.linalg",
    )
    code = (
        "import sys; import netlab.core.model.scene; "
        f"bad=[x for x in {heavy!r} if x in sys.modules]; "
        "print(','.join(bad))"
    )
    proc = subprocess.run(
        [sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True, timeout=120
    )
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.strip() == ""
