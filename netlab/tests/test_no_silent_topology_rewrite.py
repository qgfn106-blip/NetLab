"""A-1 回归：不得静默改写信号流拓扑，显式状态必须可往返。"""

import pytest

from netlab.core.common.limits import ConflictError
from netlab.core.model.scene import Scene


def _cycle_scene() -> tuple[Scene, str, str]:
    scene = Scene("signal")
    scene.set_algebraic_solver(False)
    first = scene.add_node(name="a", kind="sum", data={"voltage": 1.0})
    second = scene.add_node(name="b", kind="sum", data={"voltage": 0.0})
    scene.add_edge(name="a_to_b", source=first.id, target=second.id, kind="scale")
    return scene, first.id, second.id


def test_add_edge_default_rejects_cycle_with_readable_path() -> None:
    scene, first, second = _cycle_scene()

    with pytest.raises(ConflictError, match="代数环") as raised:
        scene.add_edge(name="b_to_a", source=second, target=first, kind="scale")

    message = str(raised.value)
    assert "a" in message and "b" in message
    assert "->" in message or "→" in message
    assert len(scene.edges) == 1


def test_auto_delay_is_explicit_opt_in_only() -> None:
    scene, first, second = _cycle_scene()

    edge = scene.add_edge(
        name="b_to_a", source=second, target=first, kind="scale", auto_delay=True
    )

    assert edge.delay is True
    assert edge.auto_delay is True


def test_scene_roundtrip_preserves_explicit_solver_and_delay_flags() -> None:
    scene, first, second = _cycle_scene()
    scene.set_algebraic_solver(True)
    scene.add_edge(name="b_to_a", source=second, target=first, kind="scale")

    payload = scene.to_payload(include_state=False)

    assert payload["solve_algebraic"] is True
    restored = Scene("signal")
    restored.load_payload(payload)
    assert restored.solve_algebraic is True
    assert all(edge.delay is False for edge in restored.edges.values())


def test_load_payload_rejects_silent_cycle() -> None:
    scene, first, second = _cycle_scene()
    scene.add_edge(
        name="b_to_a", source=second, target=first, kind="scale", auto_delay=True
    )
    payload = scene.to_payload(include_state=False)
    for edge in payload["edges"]:
        edge["delay"] = False
        edge.pop("auto_delay", None)

    restored = Scene("signal")
    with pytest.raises(ConflictError, match="代数环"):
        restored.load_payload(payload)
    assert not restored.edges
