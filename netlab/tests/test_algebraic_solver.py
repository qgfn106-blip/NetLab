"""R36/P2–P3：信号流直接馈通 SCC 的线性 / Newton 求解回归。"""

import math

import pytest

from netlab.core.model.graph import AlgebraicLoopError, NewtonConvergenceError
from netlab.core.model.scene import Scene


def _value(scene: Scene, name: str) -> float:
    engine = scene.ensure_engine()
    node = engine.network.node(name)
    assert node is not None
    value = node.data.get("value")
    assert isinstance(value, (int, float)) and not isinstance(value, bool)
    return float(value)


def test_two_gain_algebraic_loop_solves_analytically() -> None:
    scene = Scene("signal")
    scene.set_algebraic_solver(True)
    a = scene.add_node(name="a", kind="gain", params={"gain": 2.0, "offset": 1.0})
    b = scene.add_node(name="b", kind="gain", params={"gain": 3.0})
    ab = scene.add_edge(name="ab", source=a.id, target=b.id, kind="scale")
    ba = scene.add_edge(name="ba", source=b.id, target=a.id, kind="scale")
    assert ab.delay is False and ab.auto_delay is False
    assert ba.delay is False and ba.auto_delay is False

    scene.step(0.1)

    # y_a = 1 + 2*y_b, y_b = 3*y_a  =>  y_a = -0.2, y_b = -0.6
    assert _value(scene, "a") == pytest.approx(-0.2)
    assert _value(scene, "b") == pytest.approx(-0.6)


def test_algebraic_scc_uses_external_source() -> None:
    scene = Scene("signal")
    scene.set_algebraic_solver(True)
    source = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    total = scene.add_node(
        name="s", kind="sum", params={"weights": {"ref": 1.0, "fb": 1.0}}
    )
    gain = scene.add_node(name="g", kind="gain", params={"gain": -0.5})
    scene.add_edge(name="ref", source=source.id, target=total.id, kind="pass")
    scene.add_edge(name="forward", source=total.id, target=gain.id, kind="pass")
    scene.add_edge(name="fb", source=gain.id, target=total.id, kind="pass")

    scene.step(0.1)

    # y_s = 1 - 0.5*y_s  =>  y_s = 2/3; y_g = -1/3
    assert _value(scene, "s") == pytest.approx(2.0 / 3.0)
    assert _value(scene, "g") == pytest.approx(-1.0 / 3.0)


def test_nonlinear_single_loop_newton_converges() -> None:
    scene = Scene("signal")
    scene.set_algebraic_solver(True)
    source = scene.add_node(name="u", kind="manual", data={"value": 0.5})
    loop = scene.add_node(
        name="y",
        kind="expression",
        params={
            "expr": "tanh(y) + u",
            "variables": {"y": "fb", "u": "in"},
            "output": "value",
        },
    )
    scene.add_edge(name="in", source=source.id, target=loop.id, kind="pass")
    scene.add_edge(name="fb", source=loop.id, target=loop.id, kind="pass")

    scene.step(0.1)

    value = _value(scene, "y")
    assert abs(value - math.tanh(value) - 0.5) <= 1.0e-8


def test_time_varying_expression_uses_current_time() -> None:
    scene = Scene("signal")
    scene.set_algebraic_solver(True)
    loop = scene.add_node(
        name="y",
        kind="expression",
        params={
            "expr": "0.5*y + t",
            "variables": {"y": "fb"},
            "output": "value",
        },
    )
    scene.add_edge(name="fb", source=loop.id, target=loop.id, kind="pass")

    scene.step(0.1)
    assert _value(scene, "y") == pytest.approx(0.2)
    scene.step(0.1)
    assert _value(scene, "y") == pytest.approx(0.4)


def test_nonlinear_loop_without_solution_reports_newton_failure() -> None:
    scene = Scene("signal")
    scene.set_algebraic_solver(True)
    loop = scene.add_node(
        name="y",
        kind="expression",
        params={
            "expr": "y*y + 1",
            "variables": {"y": "fb"},
            "output": "value",
        },
    )
    scene.add_edge(name="fb", source=loop.id, target=loop.id, kind="pass")

    with pytest.raises(NewtonConvergenceError, match="Newton|残差"):
        scene.step(0.1)


def test_explicit_algebraic_solver_solves_linear_feedback_loop() -> None:
    scene = Scene("signal")
    scene.set_algebraic_solver(True)
    assert scene.solve_algebraic is True
    source = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    total = scene.add_node(
        name="s", kind="sum", params={"weights": {"ref": 1.0, "fb": 1.0}}
    )
    gain = scene.add_node(name="g", kind="gain", params={"gain": -0.5})
    scene.add_edge(name="ref", source=source.id, target=total.id, kind="pass")
    scene.add_edge(name="forward", source=total.id, target=gain.id, kind="pass")
    scene.add_edge(name="fb", source=gain.id, target=total.id, kind="pass")

    scene.step(0.1)

    assert _value(scene, "s") == pytest.approx(2.0 / 3.0, abs=1e-9)
    assert _value(scene, "g") == pytest.approx(-1.0 / 3.0, abs=1e-9)


def test_singular_algebraic_loop_reports_nodes() -> None:
    scene = Scene("signal")
    scene.set_algebraic_solver(True)
    node = scene.add_node(
        name="self_loop", kind="gain", params={"gain": 1.0, "offset": 1.0}
    )
    scene.add_edge(name="back", source=node.id, target=node.id, kind="scale")

    with pytest.raises(AlgebraicLoopError, match="self_loop"):
        scene.step(0.1)
