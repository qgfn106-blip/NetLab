"""在 Pyodide 里跑的演示脚本：RC 低通（1 kHz 正弦输入）。

浏览器里只加载本文件与 netlab.zip，不依赖 FastAPI / 服务器。
"""

from __future__ import annotations

import json

from netlab.scene import Scene


def run_demo(
    steps: int = 2000,
    dt: float = 5e-6,
    sample: int = 10,
    frequency: float = 1000.0,
    amplitude: float = 1.0,
    resistance: float = 1000.0,
    capacitance: float = 100e-9,
) -> str:
    """跑一段 RC 低通，返回 JSON：t / vin / vout / dt / freq。"""
    scene = Scene("circuit")
    src = scene.add_node(name="src", kind="node")
    gnd = scene.add_node(name="gnd", kind="ground")
    mid = scene.add_node(name="mid", kind="node")
    scene.add_edge(
        name="V1",
        source=src.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "sine", "offset": 0.0, "amplitude": amplitude, "frequency": frequency},
    )
    scene.add_edge(
        name="R1",
        source=src.id,
        target=mid.id,
        kind="resistor",
        params={"R": resistance},
    )
    scene.add_edge(
        name="C1",
        source=mid.id,
        target=gnd.id,
        kind="capacitor",
        params={"C": capacitance},
    )
    engine = scene.ensure_engine()
    times: list[float] = []
    vin: list[float] = []
    vout: list[float] = []
    for index in range(steps):
        engine.step(dt)
        if index % sample:
            continue
        times.append(float(engine.solver.time))
        vin.append(float(scene.nodes[src.id].data.get("voltage", 0.0)))
        vout.append(float(scene.nodes[mid.id].data.get("voltage", 0.0)))
    return json.dumps(
        {
            "t": times,
            "vin": vin,
            "vout": vout,
            "dt": dt,
            "frequency": frequency,
            "steps": steps,
        }
    )
