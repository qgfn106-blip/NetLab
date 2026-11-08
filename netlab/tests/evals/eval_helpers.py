"""G2 数值对照的共享构造器（层 A/B/D/F）。"""
from __future__ import annotations

import math
from typing import Any

from netlab.core.model.scene import Scene
from netlab.core.model.templates import build_template


def scene_from_payload(payload: dict[str, Any]) -> Scene:
    scene = Scene(payload.get("mode", "circuit"))
    scene.load_payload(payload)
    return scene


def rc_scene(*, r: float = 1000.0, c: float = 1.0e-6, v: float = 5.0) -> Scene:
    payload = build_template("rc_step")
    for edge in payload["edges"]:
        if edge.get("name") == "R1":
            edge["params"]["R"] = r
        elif edge.get("name") == "C1":
            edge["params"]["C"] = c
        elif edge.get("name") == "V1":
            edge["params"].update({"wave": "step", "amplitude": v, "delay": 0.0})
    return scene_from_payload(payload)


def rlc_step_scene(*, r: float = 10.0, l: float = 0.01, c: float = 1.0e-4, v: float = 1.0) -> Scene:
    payload = build_template("rlc_series")
    for edge in payload["edges"]:
        if edge.get("name") == "R1":
            edge["params"]["R"] = r
        elif edge.get("name") == "L1":
            edge["params"]["L"] = l
        elif edge.get("name") == "C1":
            edge["params"]["C"] = c
        elif edge.get("name") == "V1":
            edge["params"] = {"wave": "step", "offset": 0.0, "amplitude": v, "delay": 0.0}
    return scene_from_payload(payload)


def node_voltage(scene: Scene, name: str) -> float:
    node = next(item for item in scene.nodes.values() if item.name == name)
    return float(node.data.get("voltage", 0.0))


def rc_analytic(t: float, *, r: float = 1000.0, c: float = 1.0e-6, v: float = 5.0) -> float:
    return v * (1.0 - math.exp(-t / (r * c)))


def rlc_step_analytic(
    t: float, *, r: float = 10.0, l: float = 0.01, c: float = 1.0e-4, v: float = 1.0
) -> float:
    alpha = r / (2.0 * l)
    omega0 = 1.0 / math.sqrt(l * c)
    omega_d = math.sqrt(max(omega0 * omega0 - alpha * alpha, 0.0))
    return v * (
        1.0
        - math.exp(-alpha * t)
        * (math.cos(omega_d * t) + (alpha / omega_d) * math.sin(omega_d * t))
    )


def rc_voltage_after(dt: float, steps: int, **kwargs: Any) -> float:
    scene = rc_scene(**kwargs)
    for _ in range(steps):
        scene.step(dt)
    return node_voltage(scene, "mid")
