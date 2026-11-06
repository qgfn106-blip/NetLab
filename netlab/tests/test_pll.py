"""R31/P11-03：SRF-PLL 频率跟踪与相位跳变重锁。"""

from __future__ import annotations

import math

from netlab.core.model.scene import Scene

DT = 5.0e-5
TAU = 2.0 * math.pi


def _wrap(angle: float) -> float:
    return (angle + math.pi) % TAU - math.pi


def _phase_sources(scene: Scene, frequency: float, jump: float = 0.0):
    w = TAU * frequency
    jump_node = None
    if jump:
        jump_node = scene.add_node(
            name="jump",
            kind="signal",
            params={
                "field": "voltage",
                "wave": "step",
                "offset": 0.0,
                "amplitude": jump,
                "frequency": 0.0,
                "phase": 0.0,
                "delay": 0.1,
            },
        )
    nodes = []
    for name, phase, jump_edge in (
        ("a_src", 0.0, "jump_a"),
        ("b_src", -2.0 * math.pi / 3.0, "jump_b"),
        ("c_src", 2.0 * math.pi / 3.0, "jump_c"),
    ):
        variables = {"j": f"{jump_edge}.voltage"} if jump_node else {}
        node = scene.add_node(
            name=name,
            kind="expression",
            params={
                "expr": (
                    f"cos({w:.17g}*t + {phase:.17g} + j)"
                    if jump_node
                    else f"cos({w:.17g}*t + {phase:.17g})"
                ),
                "variables": variables,
                "output": "voltage",
            },
        )
        nodes.append(node)
    return nodes[0], nodes[1], nodes[2], jump_node


def _run(frequency: float, *, seconds: float = 0.3, jump: float = 0.0):
    scene = Scene("signal")
    a, b, c, jump_node = _phase_sources(scene, frequency, jump)
    pll = scene.add_node(
        name="pll",
        kind="pll",
        params={"nominal_frequency": 50.0, "kp": 20.0, "ki": 1000.0},
    )
    for edge_name, source in (("a", a), ("b", b), ("c", c)):
        scene.add_edge(name=edge_name, source=source.id, target=pll.id, kind="pass")
    if jump_node is not None:
        for edge_name, target in (("jump_a", a), ("jump_b", b), ("jump_c", c)):
            scene.add_edge(
                name=edge_name, source=jump_node.id, target=target.id, kind="pass"
            )
    errors = []
    engine = scene.ensure_engine()
    for _ in range(int(round(seconds / DT))):
        scene.step(DT)
        theta = float(scene.nodes[pll.id].data["theta"])
        now = float(engine.network.time)
        reference = TAU * frequency * now + (jump if now >= 0.1 else 0.0)
        errors.append(abs(_wrap(theta - reference)))
    return errors


def test_pll_tracks_50hz_within_one_degree() -> None:
    errors = _run(50.0)
    assert max(errors[-1000:]) < math.radians(1.0)


def test_pll_tracks_50_point_5hz_within_one_degree() -> None:
    errors = _run(50.5)
    assert max(errors[-1000:]) < math.radians(1.0)


def test_pll_relocks_after_30_degree_jump_within_60ms() -> None:
    errors = _run(50.0, seconds=0.25, jump=math.radians(30.0))
    index = int(round(0.16 / DT))  # 60 ms after the 0.1 s phase jump
    assert max(errors[index:]) < math.radians(1.0)
