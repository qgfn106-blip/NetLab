# -*- coding: utf-8 -*-
"""WP-8 AC 扫频 Woodbury 基准：off/on 配对计时、p50/p95、RSS 与误差。

默认 `NETLAB_MATH_ACCEL_P3=off`（稳定路径）；本工具只在基准进程内显式切换
`on`，用于测量 opt-in 收益，不改变产品默认值。

用法：
    python tools/bench_ac_woodbury.py
    python tools/bench_ac_woodbury.py --sizes 400 600 800 --frequencies 200
    python tools/bench_ac_woodbury.py --all-probes --frequencies 100

每个规模用同一个 CircuitSolver、同一组频点交替测 dense / Woodbury，避免
不同进程的 BLAS 热漂移；accuracy 用 off 结果作为直接解参考。
"""
from __future__ import annotations

import argparse
import gc
import json
import math
import os
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# 固定单线程 BLAS，减少配对测量噪声（必须在 numpy 导入前设置）。
for _name in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ.setdefault(_name, "1")

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from netlab.core.compute.circuit.elements import Capacitor, Resistor, VoltageSource  # noqa: E402
from netlab.core.compute.circuit.solver import CircuitNode, CircuitSolver  # noqa: E402
from netlab.core.compute.math_accel.diagnostics import reset as reset_diagnostics  # noqa: E402
from netlab.core.compute.math_accel.diagnostics import snapshot  # noqa: E402
from tools.evidence import environment  # noqa: E402

RUNNER_VERSION = "netlab-bench-ac-woodbury/1"
SCHEMA = "netlab-bench-ac-woodbury/1"
DEFAULT_SIZES = (400, 600, 800)
DEFAULT_FREQUENCIES = 200
PREDECLARED = {
    "min_woodybury_size": 160,
    "benefit_speedup": 1.2,
    "small_scale_degradation": 1.05,
    "residual_tolerance": 1.0e-8,
    "accuracy_max_abs": 1.0e-9,
}


def _percentile(values: list[float], fraction: float) -> float:
    if not values:
        return float("nan")
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * fraction
    lower = int(math.floor(position))
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def _rss_mb() -> float:
    try:
        import psutil

        return psutil.Process().memory_info().rss / (1024.0 * 1024.0)
    except Exception:
        return float("nan")


def build_ladder(nodes: int, cap_every: int = 20) -> CircuitSolver:
    """n 个非地节点的 RC 梯形网络；每 cap_every 节一只对地电容。"""
    circuit_nodes = [CircuitNode(id="n0", name="n0", ground=True)]
    circuit_nodes.extend(
        CircuitNode(id=f"n{i}", name=f"n{i}") for i in range(1, nodes)
    )
    elements = [
        Resistor(
            name=f"R{i}",
            a=f"n{i}",
            b=f"n{i - 1}",
            params={"R": 1000.0},
            state={},
        )
        for i in range(1, nodes)
    ]
    for i in range(cap_every, nodes, cap_every):
        elements.append(
            Capacitor(
                name=f"C{i}",
                a=f"n{i}",
                b="n0",
                params={"C": 1.0e-9},
                state={},
            )
        )
    elements.append(
        VoltageSource(
            name="V1",
            a=f"n{nodes - 1}",
            b="n0",
            params={"wave": "dc", "offset": 1.0},
            state={},
        )
    )
    return CircuitSolver(circuit_nodes, elements)


def _magnitudes(result: dict, tokens: list[str]) -> np.ndarray:
    return np.asarray(
        [result["probes"][token]["magnitude"] for token in tokens], dtype=float
    )


def _sweep_ms(solver: CircuitSolver, freqs: list[float], probes: list[str] | None) -> float:
    started = time.perf_counter()
    solver.ac_sweep(freqs, probes=probes)
    return (time.perf_counter() - started) * 1000.0


def measure(
    nodes: int, frequencies: int, all_probes: bool, warmup: int, repeat: int
) -> dict:
    solver = build_ladder(nodes)
    freqs = list(np.logspace(1.0, 5.0, frequencies))
    probes = None if all_probes else ["n1"]
    tokens = (
        [f"n{i}" for i in range(1, nodes)] if all_probes else ["n1"]
    )

    os.environ["NETLAB_MATH_ACCEL_P3"] = "off"
    for _ in range(warmup):
        _sweep_ms(solver, freqs, probes)
    off_result = solver.ac_sweep(freqs, probes=probes)

    reset_diagnostics()
    os.environ["NETLAB_MATH_ACCEL_P3"] = "on"
    for _ in range(warmup):
        _sweep_ms(solver, freqs, probes)
    on_result = solver.ac_sweep(freqs, probes=probes)
    counters = snapshot()["counters"]

    off_samples: list[float] = []
    on_samples: list[float] = []
    rss_before = _rss_mb()
    for index in range(repeat):
        gc.collect()
        order = ("off", "on") if index % 2 == 0 else ("on", "off")
        for mode in order:
            os.environ["NETLAB_MATH_ACCEL_P3"] = mode
            elapsed = _sweep_ms(solver, freqs, probes)
            (off_samples if mode == "off" else on_samples).append(elapsed)
    rss_after = _rss_mb()

    off_values = _magnitudes(off_result, tokens)
    on_values = _magnitudes(on_result, tokens)
    max_abs_error = float(np.max(np.abs(on_values - off_values)))
    scale = max(float(np.max(np.abs(off_values))), 1.0e-300)
    off_p50 = statistics.median(off_samples)
    on_p50 = statistics.median(on_samples)
    speedup = off_p50 / on_p50 if on_p50 > 0.0 else float("nan")
    fallback = int(counters.get("p3.fallback", 0))
    used = int(counters.get("p3.used", 0))
    status = "passed"
    reasons: list[str] = []
    if not math.isfinite(max_abs_error) or max_abs_error > PREDECLARED["accuracy_max_abs"]:
        status = "failed"
        reasons.append("accuracy")
    if used == 0 and nodes >= PREDECLARED["min_woodybury_size"]:
        status = "failed"
        reasons.append("woodbury_not_used")
    if fallback > 0 and speedup < 1.0:
        status = "failed"
        reasons.append("fallback_without_benefit")
    return {
        "nodes": nodes,
        "matrix_size": solver.matrix_size,
        "frequencies": frequencies,
        "probes": "all" if all_probes else "single",
        "warmup": warmup,
        "repeat": repeat,
        "off_p50_ms": round(off_p50, 3),
        "off_p95_ms": round(_percentile(off_samples, 0.95), 3),
        "on_p50_ms": round(on_p50, 3),
        "on_p95_ms": round(_percentile(on_samples, 0.95), 3),
        "speedup_p50": round(speedup, 3),
        "speedup_p95": round(
            _percentile(off_samples, 0.95) / _percentile(on_samples, 0.95), 3
        ),
        "rss_before_mb": round(rss_before, 2),
        "rss_after_mb": round(rss_after, 2),
        "rss_delta_mb": round(rss_after - rss_before, 2),
        "max_abs_error": max_abs_error,
        "max_rel_error": max_abs_error / scale,
        "fallback": fallback,
        "used": used,
        "status": status,
        "reasons": reasons,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sizes", type=int, nargs="+", default=list(DEFAULT_SIZES))
    parser.add_argument("--frequencies", type=int, default=DEFAULT_FREQUENCIES)
    parser.add_argument("--all-probes", action="store_true")
    parser.add_argument("--warmup", type=int, default=1)
    parser.add_argument("--repeat", type=int, default=7)
    parser.add_argument("--output", type=Path, default=ROOT / "reports" / "bench_ac_woodbury.json")
    args = parser.parse_args(argv)

    rows = [
        measure(size, args.frequencies, args.all_probes, args.warmup, args.repeat)
        for size in args.sizes
    ]
    benefit = [
        row["speedup_p50"]
        for row in rows
        if row["nodes"] >= PREDECLARED["min_woodybury_size"]
    ]
    status = "passed" if all(row["status"] == "passed" for row in rows) else "failed"
    if benefit and max(benefit) < PREDECLARED["benefit_speedup"]:
        status = "failed"
    payload = {
        "runner_version": RUNNER_VERSION,
        "schema": SCHEMA,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "status": status,
        "exit_code": 0 if status == "passed" else 1,
        "predeclared": PREDECLARED,
        "config": {
            "sizes": args.sizes,
            "frequencies": args.frequencies,
            "probes": "all" if args.all_probes else "single",
            "warmup": args.warmup,
            "repeat": args.repeat,
            "timer": "perf_counter around CircuitSolver.ac_sweep; dense/on paired alternately",
            "accuracy": "on vs off probe magnitudes; off is the direct-solve reference",
            "memory": "psutil RSS before/after the repeated sweeps",
            "blas_threads": {
                key: os.environ.get(key)
                for key in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS")
            },
        },
        "environment": environment(),
        "rows": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return int(payload["exit_code"])


if __name__ == "__main__":
    raise SystemExit(main())
