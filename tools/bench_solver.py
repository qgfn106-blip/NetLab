#!/usr/bin/env python3
"""G2 精度–规模–耗时基准：解析解对照 + dt 减半实测阶。

输出 `reports/bench.jsonl`，每行一个 (problem, solver, dt) 观测。
参考解一律用闭式解，不调用 Netlab 另一条求解路径。
"""
from __future__ import annotations

import argparse
import json
import math
import time
import tracemalloc
from pathlib import Path
from typing import Any, Callable

from netlab.core.model.scene import Scene
from netlab.core.model.templates import build_template

ROOT = Path(__file__).resolve().parents[1]
TAU = 1.0e-3


def _rc_scene() -> Scene:
    payload = build_template("rc_step")
    scene = Scene(payload.get("mode", "circuit"))
    scene.load_payload(payload)
    return scene


def _rc_value(steps: int, dt: float) -> tuple[float, float]:
    scene = _rc_scene()
    for _ in range(steps):
        scene.step(dt)
    node = next(item for item in scene.nodes.values() if item.name == "mid")
    value = float(node.data.get("voltage", 0.0))
    elements = {getattr(item, "name", ""): item for item in scene.ensure_engine().element_map.values()}
    resistor = elements["R1"].state
    capacitor = elements["C1"].state
    residual = abs(float(resistor["current"]) - float(capacitor["current"]))
    return value, residual


def _rc_analytic(t: float, *, r: float = 1000.0, c: float = 1.0e-6, v: float = 5.0) -> float:
    return v * (1.0 - math.exp(-t / (r * c)))


def run_rc(scale: int = 3) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    errors: dict[int, float] = {}
    for n in (20, 40, 80, 160):
        dt = TAU / n
        tracemalloc.start()
        started = time.perf_counter()
        value, residual = _rc_value(n, dt)
        wall_ms = (time.perf_counter() - started) * 1000.0
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        analytic = _rc_analytic(TAU)
        err = abs(value - analytic)
        errors[n] = err
        rows.append(
            {
                "problem": "P-RC-01",
                "solver": "trapezoidal",
                "nodes": scale,
                "dt": dt,
                "err_abs": err,
                "err_rel": err / abs(analytic),
                "observed_order": None,
                "residual": residual,
                "steps": n,
                "wall_ms": wall_ms,
                "peak_mb": peak / (1024.0 * 1024.0),
            }
        )
    keys = sorted(errors)
    for i in range(1, len(keys) - 1):
        coarse, fine = keys[i - 1], keys[i]
        order = math.log2(errors[coarse] / errors[fine])
        for row in rows:
            if row["steps"] == coarse:
                row["observed_order"] = order
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--jsonl", default="reports/bench.jsonl")
    args = parser.parse_args()
    rows = run_rc()
    out = ROOT / args.jsonl
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    orders = [row["observed_order"] for row in rows if row["observed_order"] is not None]
    print(f"wrote {len(rows)} rows to {out}")
    print("observed_order:", ", ".join(f"{value:.3f}" for value in orders))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
