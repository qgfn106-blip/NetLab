#!/usr/bin/env python3
"""B-1 判据 3：390 节点/391 未知量 RC 梯形，sparse=off 与 sparse=auto 同进程中位耗时。

预热 5 步、计时 120 步；输出 JSON（median/mean/p95/ratio），ratio<=1.25 时 exit 0。
"""
from __future__ import annotations

import argparse
import json
import statistics
import time

from netlab.core.compute.nodal import SolverOptions
from netlab.core.model.scene import Scene

from solver_shadow_check import _ladder


def _measure(mode: str, *, warmup: int, steps: int, dt: float) -> list[float]:
    scene = _ladder(390)
    scene.set_solver_options(SolverOptions(sparse=mode))
    for _ in range(warmup):
        scene.step(dt)
    samples: list[float] = []
    for _ in range(steps):
        started = time.perf_counter()
        scene.step(dt)
        samples.append((time.perf_counter() - started) * 1.0e3)
    return samples


def percentile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    k = max(0, min(len(ordered) - 1, int(round((p / 100.0) * (len(ordered) - 1)))))
    return ordered[k]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="B-1 sparse off vs auto median benchmark")
    parser.add_argument("--nodes", type=int, default=390)
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--steps", type=int, default=120)
    parser.add_argument("--dt", type=float, default=1.0e-4)
    parser.add_argument("--limit", type=float, default=1.25)
    args = parser.parse_args(argv)

    off = _measure("off", warmup=args.warmup, steps=args.steps, dt=args.dt)
    auto = _measure("auto", warmup=args.warmup, steps=args.steps, dt=args.dt)
    result = {
        "problem": "B1-PERF-390",
        "nodes": args.nodes,
        "unknowns": args.nodes + 1,
        "warmup": args.warmup,
        "steps": args.steps,
        "dt": args.dt,
        "off_ms": {"median": statistics.median(off), "mean": statistics.mean(off), "p95": percentile(off, 95)},
        "auto_ms": {"median": statistics.median(auto), "mean": statistics.mean(auto), "p95": percentile(auto, 95)},
    }
    ratio = result["auto_ms"]["median"] / result["off_ms"]["median"] if result["off_ms"]["median"] else float("inf")
    result["ratio_auto_over_off"] = ratio
    result["limit"] = args.limit
    result["passed"] = ratio <= args.limit
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
