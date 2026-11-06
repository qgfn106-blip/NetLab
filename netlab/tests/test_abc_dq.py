"""R31/P11-02：abc↔dq Park 变换块。"""

from __future__ import annotations

import math

import pytest

from netlab.core.compute.computes import COMPUTE_SPECS
from netlab.core.model.scene import Scene


def _signal(scene: Scene, name: str, value: float):
    return scene.add_node(
        name=name,
        kind="signal",
        params={
            "field": "voltage",
            "wave": "dc",
            "offset": value,
            "amplitude": 0.0,
            "frequency": 0.0,
            "phase": 0.0,
            "delay": 0.0,
        },
    )


def _abc_scene(values: tuple[float, float, float], theta: float):
    scene = Scene("signal")
    a = _signal(scene, "a_src", values[0])
    b = _signal(scene, "b_src", values[1])
    c = _signal(scene, "c_src", values[2])
    t = _signal(scene, "theta_src", theta)
    node = scene.add_node(
        name="transform",
        kind="abc_dq",
        params={
            "mode": "abc_to_dq",
            "theta_source": "theta.voltage",
            "a_source": "a.voltage",
            "b_source": "b.voltage",
            "c_source": "c.voltage",
        },
    )
    for edge_name, source in (("a", a), ("b", b), ("c", c), ("theta", t)):
        scene.add_edge(name=edge_name, source=source.id, target=node.id, kind="pass")
    scene.step(1.0)
    return scene, node


def test_abc_dq_balanced_cosine_gives_d_axis_amplitude() -> None:
    scene, node = _abc_scene((1.0, -0.5, -0.5), 0.0)
    data = scene.nodes[node.id].data
    assert data["d"] == pytest.approx(1.0, abs=1e-12)
    assert data["q"] == pytest.approx(0.0, abs=1e-12)


def test_abc_dq_rotating_balanced_vector_has_constant_magnitude() -> None:
    for theta in (0.0, 0.4, math.pi / 2, 2.2):
        scene, node = _abc_scene((1.0, -0.5, -0.5), theta)
        data = scene.nodes[node.id].data
        assert math.hypot(data["d"], data["q"]) == pytest.approx(1.0, abs=1e-12)


def test_abc_dq_inverse_restores_three_phase_values() -> None:
    theta = 0.7
    scene = Scene("signal")
    d = _signal(scene, "d_src", 0.8)
    q = _signal(scene, "q_src", -0.35)
    t = _signal(scene, "theta_src", theta)
    node = scene.add_node(
        name="inverse",
        kind="abc_dq",
        params={
            "mode": "dq_to_abc",
            "theta_source": "theta.voltage",
            "d_source": "d.voltage",
            "q_source": "q.voltage",
        },
    )
    for edge_name, source in (("d", d), ("q", q), ("theta", t)):
        scene.add_edge(name=edge_name, source=source.id, target=node.id, kind="pass")
    scene.step(1.0)
    data = scene.nodes[node.id].data
    assert data["a"] == pytest.approx(
        0.8 * math.cos(theta) + 0.35 * math.sin(theta), abs=1e-12
    )
    assert data["b"] == pytest.approx(
        0.8 * math.cos(theta - 2 * math.pi / 3)
        + 0.35 * math.sin(theta - 2 * math.pi / 3),
        abs=1e-12,
    )
    assert data["c"] == pytest.approx(
        0.8 * math.cos(theta + 2 * math.pi / 3)
        + 0.35 * math.sin(theta + 2 * math.pi / 3),
        abs=1e-12,
    )


def test_abc_dq_is_registered_with_both_directions() -> None:
    spec = COMPUTE_SPECS["abc_dq"]
    assert spec.label == "三相坐标变换"
    assert {choice[0] for choice in spec.params[0].choices} == {
        "abc_to_dq",
        "dq_to_abc",
    }
