"""D-5 / N-19 求解器影子门测试。"""

from __future__ import annotations

import numpy as np

from netlab.core.compute.nodal import SolverOptions
from netlab.core.compute.shadow import assert_shadow_agreement, shadow_gate
from netlab.core.model.scene import Scene


def _ladder(count: int, *, source: float = 3.0) -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    nodes = [scene.add_node(name=f"n{i}", kind="node") for i in range(count)]
    scene.add_edge(
        name="V1",
        source=nodes[0].id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": source, "amplitude": 0.0},
    )
    for index in range(count - 1):
        scene.add_edge(
            name=f"Rs{index}",
            source=nodes[index].id,
            target=nodes[index + 1].id,
            kind="resistor",
            params={"R": 1000.0},
        )
    for index, node in enumerate(nodes):
        scene.add_edge(
            name=f"Rp{index}",
            source=node.id,
            target=gnd.id,
            kind="resistor",
            params={"R": 1000.0},
        )
    return scene


def _voltages(scene: Scene) -> list[float]:
    return [
        float(record.data.get("voltage", 0.0))
        for record in scene.nodes.values()
        if record.name.startswith("n")
    ]


def test_shadow_gate_off_is_noop_and_invalid_mode_rejected() -> None:
    result = shadow_gate([1.0, 2.0], [9.0, 9.0], mode="off")
    assert result.passed is True
    assert result.max_abs_error == 0.0
    assert result.max_rel_error == 0.0

    try:
        shadow_gate([1.0], [1.0], mode="bogus")
    except ValueError:
        pass
    else:
        raise AssertionError("invalid shadow mode must raise")


def test_shadow_gate_detects_perturbation_and_nonfinite() -> None:
    result = shadow_gate([1.0, 2.0], [1.0, 2.0 + 1.0e-6], mode="shadow")
    assert result.passed is False
    assert result.max_rel_error > 1.0e-10

    nan_result = shadow_gate([1.0, 2.0], [1.0, np.nan], mode="shadow")
    assert nan_result.passed is False


def test_dense_sparse_solver_shadow_gate_at_max_size() -> None:
    dense_scene = _ladder(390)
    dense_scene.set_solver_options(SolverOptions(sparse="off"))
    dense_scene.step(1.0e-4)

    sparse_scene = _ladder(390)
    sparse_scene.set_solver_options(SolverOptions(sparse="on"))
    sparse_scene.step(1.0e-4)

    result = assert_shadow_agreement(
        _voltages(dense_scene),
        _voltages(sparse_scene),
        mode="shadow",
        rtol=1.0e-10,
    )
    assert result.max_rel_error < 1.0e-10
