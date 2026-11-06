"""R31/P11-04：dq 电流环 PI + 前馈解耦的阶跃跟随。"""

from __future__ import annotations

import math

from netlab.core.model.scene import Scene

DT = 5.0e-5
R = 0.1
L = 2.0e-3
OMEGA = 2.0 * math.pi * 50.0


def _build_scene():
    scene = Scene("signal")
    i_d_ref = scene.add_node(
        name="i_d_ref",
        kind="signal",
        params={
            "field": "voltage",
            "wave": "step",
            "offset": 0.0,
            "amplitude": 1.0,
            "delay": 0.005,
        },
    )
    i_q_ref = scene.add_node(
        name="i_q_ref",
        kind="signal",
        params={
            "field": "voltage",
            "wave": "dc",
            "offset": 0.0,
            "amplitude": 0.0,
            "frequency": 0.0,
            "delay": 0.0,
        },
    )
    plant = scene.add_node(
        name="plant",
        kind="state_space",
        params={
            "A": [[-R / L, OMEGA], [-OMEGA, -R / L]],
            "B": [[1.0 / L, 0.0], [0.0, 1.0 / L]],
            "C": [[1.0, 0.0], [0.0, 1.0]],
            "D": [[0.0, 0.0], [0.0, 0.0]],
            "method": "zoh",
            "input_map": ["vd_cmd.voltage", "vq_cmd.voltage"],
            "output_map": ["i_d", "i_q"],
            "x0": [0.0, 0.0],
        },
    )
    err_d = scene.add_node(
        name="err_d",
        kind="expression",
        params={
            "expr": "r - i",
            "variables": {"r": "id_ref.voltage", "i": "i_d.i_d"},
            "output": "voltage",
        },
    )
    err_q = scene.add_node(
        name="err_q",
        kind="expression",
        params={
            "expr": "r - i",
            "variables": {"r": "iq_ref.voltage", "i": "i_q.i_q"},
            "output": "voltage",
        },
    )
    pi_d = scene.add_node(
        name="pi_d",
        kind="pi",
        params={"kp": 6.0, "ki": 3000.0, "limit": 50.0, "error_source": "ed.voltage"},
    )
    pi_q = scene.add_node(
        name="pi_q",
        kind="pi",
        params={"kp": 6.0, "ki": 3000.0, "limit": 50.0, "error_source": "eq.voltage"},
    )
    cmd_d = scene.add_node(
        name="cmd_d",
        kind="expression",
        params={
            "expr": "u - 0.6283185307179586*q",
            "variables": {"u": "ud.voltage", "q": "i_q_cmd.i_q"},
            "output": "voltage",
        },
    )
    cmd_q = scene.add_node(
        name="cmd_q",
        kind="expression",
        params={
            "expr": "u + 0.6283185307179586*d",
            "variables": {"u": "uq.voltage", "d": "i_d_cmd.i_d"},
            "output": "voltage",
        },
    )

    edges = [
        ("id_ref", i_d_ref, err_d),
        ("i_d", plant, err_d),
        ("iq_ref", i_q_ref, err_q),
        ("i_q", plant, err_q),
        ("ed", err_d, pi_d),
        ("eq", err_q, pi_q),
        ("ud", pi_d, cmd_d),
        ("uq", pi_q, cmd_q),
        ("i_q_cmd", plant, cmd_d),
        ("i_d_cmd", plant, cmd_q),
        ("vd_cmd", cmd_d, plant),
        ("vq_cmd", cmd_q, plant),
    ]
    for name, source, target in edges:
        scene.add_edge(name=name, source=source.id, target=target.id, kind="pass")
    return scene, plant


def test_dq_current_loop_step_10_to_90_under_5ms() -> None:
    scene, plant = _build_scene()
    scene.ensure_engine()
    samples = []
    steps = int(round(0.03 / DT))
    for index in range(steps):
        scene.step(DT)
        samples.append((index * DT, float(scene.nodes[plant.id].data["i_d"])))
    start = next((i for i, (_, value) in enumerate(samples) if value >= 0.1), None)
    end = next((i for i, (_, value) in enumerate(samples) if value >= 0.9), None)
    assert start is not None and end is not None
    rise_ms = (samples[end][0] - samples[start][0]) * 1000.0
    assert rise_ms < 5.0
    assert abs(samples[-1][1] - 1.0) < 1.0e-3
