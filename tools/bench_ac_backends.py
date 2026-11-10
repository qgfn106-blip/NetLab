"""M2.2：Legacy AC（off/shadow/on）与 Descriptor AC 的频率扫描对照。"""

from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path

from netlab.core.compute.circuit.descriptor import DescriptorModel
from netlab.core.model.scene import Scene
from netlab.core.compute.math_accel.diagnostics import reset as reset_math_diag, snapshot as math_diag_snapshot

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports"
FREQUENCIES = [10.0, 100.0, 1000.0, 10000.0, 100000.0]

def build_scene(sections: int = 180) -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    nodes = [scene.add_node(name=f"n{i}", kind="node") for i in range(1, sections + 1)]
    scene.add_edge(name="V1", source=nodes[0].id, target=gnd.id, kind="vsource", params={"wave": "dc", "offset": 0.0, "amplitude": 1.0})
    reactive_step = max(1, len(nodes) // 5)
    for index, node in enumerate(nodes):
        if index % reactive_step == 0 or index == len(nodes) - 1:
            scene.add_edge(name=f"C{index + 1}", source=node.id, target=gnd.id, kind="capacitor", params={"C": 1e-6})
        if index + 1 < len(nodes):
            scene.add_edge(name=f"R{index + 1}", source=node.id, target=nodes[index + 1].id, kind="resistor", params={"R": 100.0})
    return scene

def _magnitudes(probes: dict[str, dict[str, list[float]]], name: str) -> list[float]:
    return [float(value) for value in probes[name]["magnitude"]]

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["off", "shadow", "on", "descriptor"], required=True)
    parser.add_argument("--sections", type=int, default=180)
    parser.add_argument("--repeats", type=int, default=3)
    args = parser.parse_args()
    scene = build_scene(args.sections)
    if args.mode == "descriptor":
        DescriptorModel.from_scene(scene).frequency_response(FREQUENCIES, input_source="V1", probes=["n180"])
    else:
        scene.ensure_engine().solver.ac_sweep(FREQUENCIES, input_source="V1", probes=["n180"])
    timings: list[float] = []
    magnitudes: list[float] = []
    counters: dict[str, int] = {}
    for _ in range(args.repeats):
        reset_math_diag()
        started = time.perf_counter()
        if args.mode == "descriptor":
            model = DescriptorModel.from_scene(scene)
            result = model.frequency_response(FREQUENCIES, input_source="V1", probes=["n180"])
            elapsed = time.perf_counter() - started
            magnitudes = _magnitudes(result["probes"], "n180")
        else:
            engine = scene.ensure_engine()
            result = engine.solver.ac_sweep(FREQUENCIES, input_source="V1", probes=["n180"])
            elapsed = time.perf_counter() - started
            magnitudes = _magnitudes(result["probes"], "n180")
        timings.append(elapsed * 1000.0)
        counters = dict(math_diag_snapshot()["counters"])
    payload = {
        "mode": args.mode,
        "sections": args.sections,
        "matrix_size": len(scene.nodes),
        "frequencies_hz": FREQUENCIES,
        "median_ms": round(statistics.median(timings), 3),
        "all_ms": [round(value, 3) for value in timings],
        "magnitude_n180": [round(value, 12) for value in magnitudes],
        "math_accel_counters": counters,
    }
    OUT.mkdir(exist_ok=True)
    (OUT / f"bench_ac_backends_{args.mode}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
