# -*- coding: utf-8 -*-
"""WP-8 稀疏阈值基准：ladder / grid / star 多拓扑，稠密与稀疏配对计时。

目的：为 SolverOptions.sparse_threshold 的默认值提供可复跑证据。每个样本都
重新构造 CircuitSolver，只计一次 step（含首次因子分解），避免后续步的 LU
缓存掩盖阈值差异。稠密与稀疏在同一轮内交替测量，并报告配对比值的中位数/
p95，降低 BLAS 线程与 CPU 调频带来的跨轮漂移；阈值策略直接从配对样本回放，
不再单独跑第三遍。

用法：
    python tools/bench_solver_sparse.py
    python tools/bench_solver_sparse.py --sizes 400,800,1200,1600,2000
    python tools/bench_solver_sparse.py --thresholds 512,1200,1500 --repeat 9
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

# 基准必须可复跑：限制 BLAS 线程数，避免同一台机器上线程池调度改变 p50。
for _key in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ.setdefault(_key, "1")

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from netlab.core.compute.circuit.elements import Resistor, VoltageSource  # noqa: E402
from netlab.core.compute.circuit.solver import CircuitNode, CircuitSolver  # noqa: E402
from netlab.core.compute.circuit.stamps import SolverOptions  # noqa: E402
from tools.evidence import environment  # noqa: E402

RUNNER_VERSION = "netlab-bench-solver-sparse/2"
DEFAULT_FAMILIES = ("ladder", "grid", "star")
DEFAULT_SIZES = (400, 600, 800, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1800, 2000, 2500)
DEFAULT_THRESHOLDS = (512, 1000, 1200, 1400, 1500, 1600, 1800, 2000)
RESIDUAL_LIMIT = 1.0e-6

def _percentile(samples: list[float], fraction: float) -> float:
    if not samples:
        return float("nan")
    ordered = sorted(float(v) for v in samples)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * fraction
    low = int(math.floor(position))
    high = int(math.ceil(position))
    if low == high:
        return ordered[low]
    weight = position - low
    return ordered[low] * (1.0 - weight) + ordered[high] * weight

def _summary(samples: list[float], unit: str = "ms") -> dict:
    clean = [max(0.0, float(v)) for v in samples if math.isfinite(float(v))]
    if not clean:
        return {"unit": unit, "n": 0, "p50": None, "p95": None,
                "min": None, "max": None, "mean": None}
    return {
        "unit": unit,
        "n": len(clean),
        "p50": round(statistics.median(clean), 6),
        "p95": round(_percentile(clean, 0.95), 6),
        "min": round(min(clean), 6),
        "max": round(max(clean), 6),
        "mean": round(statistics.fmean(clean), 6),
    }

def _distribution(values: list[float]) -> dict:
    clean = [float(v) for v in values if math.isfinite(float(v))]
    if not clean:
        return {"n": 0, "p50": None, "p95": None, "max": None}
    return {
        "n": len(clean),
        "p50": round(statistics.median(clean), 12),
        "p95": round(_percentile(clean, 0.95), 12),
        "max": round(max(clean), 12),
    }

def _rss_mb() -> float | None:
    try:
        import psutil  # type: ignore

        return round(psutil.Process(os.getpid()).memory_info().rss / 1e6, 3)
    except Exception:
        return None

def _ladder(size: int) -> tuple[list[CircuitNode], list]:
    """size 个未知量：size-1 个节点 + 1 个电压源支路。"""
    nodes = [CircuitNode("n0", "gnd", ground=True)]
    nodes += [CircuitNode(f"n{i}", f"n{i}") for i in range(1, size)]
    elements = [VoltageSource("V1", "n1", "n0", {"wave": "dc", "offset": 5.0}, {})]
    for i in range(1, size - 1):
        elements.append(Resistor(f"R{i}", f"n{i}", f"n{i + 1}", {"R": 1000.0}, {}))
    for i in range(1, size):
        elements.append(Resistor(f"G{i}", f"n{i}", "n0", {"R": 1000.0}, {}))
    return nodes, elements

def _grid(size: int) -> tuple[list[CircuitNode], list]:
    """近似方阵电阻网格：size = cols*rows 个未知量（含 1 个电压源支路）。"""
    cols = max(2, int(math.sqrt(size)))
    rows = max(2, int(math.ceil(size / cols)))
    count = cols * rows
    nodes = [CircuitNode("n0", "gnd", ground=True)]
    nodes += [CircuitNode(f"n{i}", f"n{i}") for i in range(1, count)]
    def node(col: int, row: int) -> str:
        return "n0" if (col == 0 and row == 0) else f"n{col * rows + row}"
    elements = []
    for col in range(cols):
        for row in range(rows):
            if col + 1 < cols:
                elements.append(Resistor(f"H{col}_{row}", node(col, row), node(col + 1, row), {"R": 1000.0}, {}))
            if row + 1 < rows:
                elements.append(Resistor(f"V{col}_{row}", node(col, row), node(col, row + 1), {"R": 1000.0}, {}))
    elements.append(VoltageSource("V1", node(cols - 1, rows - 1), "n0", {"wave": "dc", "offset": 5.0}, {}))
    return nodes, elements

def _star(size: int) -> tuple[list[CircuitNode], list]:
    """单中心星形：size-2 个叶节点 + 中心 + 地 + 电压源支路。"""
    leaves = max(1, size - 2)
    nodes = [CircuitNode("n0", "gnd", ground=True), CircuitNode("c", "center")]
    nodes += [CircuitNode(f"n{i}", f"n{i}") for i in range(1, leaves + 1)]
    elements = [VoltageSource("V1", "c", "n0", {"wave": "dc", "offset": 5.0}, {})]
    for i in range(1, leaves + 1):
        elements.append(Resistor(f"S{i}", "c", f"n{i}", {"R": 1000.0}, {}))
        elements.append(Resistor(f"G{i}", f"n{i}", "n0", {"R": 1000.0}, {}))
    return nodes, elements

BUILDERS = {"ladder": _ladder, "grid": _grid, "star": _star}

def _solver_for(family: str, size: int, mode: str, threshold: int) -> CircuitSolver:
    nodes, elements = BUILDERS[family](size)
    options = SolverOptions(sparse=mode, sparse_threshold=int(threshold))
    return CircuitSolver(nodes, elements, options=options)

def _time_one(family: str, size: int, mode: str, threshold: int) -> tuple[float, dict, int, str]:
    solver = _solver_for(family, size, mode, threshold)
    gc_was_enabled = gc.isenabled()
    if gc_was_enabled:
        gc.disable()
    try:
        started = time.perf_counter()
        result = solver.step(1.0e-3)
        elapsed = (time.perf_counter() - started) * 1000.0
    finally:
        if gc_was_enabled:
            gc.enable()
    meta = {
        "residual": float(result.get("residual") or 0.0),
        "iterations": int(result.get("iterations") or 0),
    }
    return elapsed, meta, solver.matrix_size, str(result.get("status") or "unknown")

def _memory_one(family: str, size: int, mode: str, threshold: int) -> dict:
    before = _rss_mb()
    solver = _solver_for(family, size, mode, threshold)
    solver.step(1.0e-3)
    after = _rss_mb()
    return {
        "rss_before_mb": before,
        "rss_after_mb": after,
        "rss_delta_mb": round(after - before, 3) if before is not None and after is not None else None,
    }

def _run_pair(family: str, size: int, thresholds: list[int], warmup: int, repeat: int) -> tuple[dict, dict]:
    dense = {"times": [], "residuals": [], "iterations": [], "statuses": []}
    sparse = {"times": [], "residuals": [], "iterations": [], "statuses": []}
    ratios = []
    matrix_size = None
    for index in range(warmup + repeat):
        order = [("off", 0, dense), ("on", 0, sparse)]
        if index % 2:
            order.reverse()
        times = {}
        for mode, threshold, bucket in order:
            elapsed, meta, matrix_size, status = _time_one(family, size, mode, threshold)
            times[mode] = elapsed
            if index >= warmup:
                bucket["times"].append(elapsed)
                bucket["residuals"].append(meta["residual"])
                bucket["iterations"].append(meta["iterations"])
                bucket["statuses"].append(status)
        if index >= warmup:
            ratios.append(times["on"] / times["off"])

    def view(bucket: dict) -> dict:
        return {
            "timing": _summary(bucket["times"]),
            "residual": _distribution(bucket["residuals"]),
            "residual_max": max(bucket["residuals"]) if bucket["residuals"] else None,
            "iterations": bucket["iterations"],
            "status": bucket["statuses"][-1] if bucket["statuses"] else "unknown",
            "converged": all(item == "converged" for item in bucket["statuses"]),
        }

    dense_view = view(dense)
    sparse_view = view(sparse)
    policies = {}
    for threshold in thresholds:
        selected = "dense" if int(matrix_size or 0) <= int(threshold) else "sparse"
        source = dense_view if selected == "dense" else sparse_view
        policies[str(threshold)] = {
            "selected": selected,
            "timing": source["timing"],
            "residual_max": source["residual_max"],
        }
    row = {
        "family": family,
        "requested_size": size,
        "matrix_size": matrix_size,
        "dense": dense_view,
        "sparse": sparse_view,
        "sparse_over_dense": _summary(ratios, unit="ratio"),
        "policies": policies,
        "memory": {
            "dense": _memory_one(family, size, "off", 0),
            "sparse": _memory_one(family, size, "on", 0),
        },
    }
    return row, policies

def _parse_int_list(value: str) -> list[int]:
    return [int(item.strip()) for item in value.split(",") if item.strip()]

def run(args) -> int:
    families = [item.strip() for item in args.families.split(",") if item.strip()]
    unknown = [item for item in families if item not in BUILDERS]
    if unknown:
        raise SystemExit(f"未知拓扑 {unknown}; 可选 {', '.join(BUILDERS)}")
    sizes = _parse_int_list(args.sizes)
    thresholds = _parse_int_list(args.thresholds)
    if any(size < 8 for size in sizes) or any(value < 1 for value in thresholds):
        raise SystemExit("sizes 必须 >=8，thresholds 必须 >=1")
    if 512 not in thresholds:
        thresholds = [512, *thresholds]

    started_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    started = time.perf_counter()
    rows = []
    errors = []
    for family in families:
        for size in sizes:
            print(f"[bench] {family} size={size}", file=sys.stderr, flush=True)
            row, policies = _run_pair(family, size, thresholds, args.warmup, args.repeat)
            rows.append(row)
            if not row["dense"]["converged"] or not row["sparse"]["converged"]:
                errors.append(f"{family}/size={size}")
            if (row["dense"]["residual_max"] or 0.0) > RESIDUAL_LIMIT:
                errors.append(f"{family}/size={size}/dense-residual")
            if (row["sparse"]["residual_max"] or 0.0) > RESIDUAL_LIMIT:
                errors.append(f"{family}/size={size}/sparse-residual")

    effects = []
    for row in rows:
        before = row["policies"].get("512", {}).get("timing", {}).get("p50")
        if not before:
            continue
        for threshold in thresholds:
            if threshold == 512:
                continue
            after = row["policies"].get(str(threshold), {}).get("timing", {}).get("p50")
            if after:
                effects.append({
                    "family": row["family"],
                    "size": row["requested_size"],
                    "before_threshold": 512,
                    "after_threshold": threshold,
                    "before_p50_ms": before,
                    "after_p50_ms": after,
                    "after_over_before": round(after / before, 3),
                })

    duration_ms = int((time.perf_counter() - started) * 1000)
    payload = {
        "runner_version": RUNNER_VERSION,
        "schema": "netlab-bench-solver-sparse/2",
        "generated_at": started_at,
        "status": "passed" if not errors else "failed",
        "exit_code": 0 if not errors else 1,
        "duration_ms": duration_ms,
        "environment": environment(),
        "config": {
            "families": families,
            "sizes": sizes,
            "thresholds": thresholds,
            "warmup": args.warmup,
            "repeat": args.repeat,
            "dt": 1.0e-3,
            "residual_limit": RESIDUAL_LIMIT,
            "timer": "perf_counter around one CircuitSolver.step on a fresh solver; dense/sparse paired",
            "memory": "psutil RSS before/after one fresh step (no tracemalloc instrumentation)",
            "blas_threads": {key: os.environ.get(key) for key in
                             ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS")},
        },
        "rows": rows,
        "threshold_effect": effects,
        "errors": errors,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": payload["status"],
        "rows": len(rows),
        "errors": errors,
        "output": str(output),
        "duration_ms": duration_ms,
    }, ensure_ascii=False))
    return int(payload["exit_code"])

def main() -> int:
    parser = argparse.ArgumentParser(description="WP-8 稀疏阈值基准")
    parser.add_argument("--families", default=",".join(DEFAULT_FAMILIES))
    parser.add_argument("--sizes", default=",".join(str(item) for item in DEFAULT_SIZES))
    parser.add_argument("--thresholds", default=",".join(str(item) for item in DEFAULT_THRESHOLDS))
    parser.add_argument("--warmup", type=int, default=2)
    parser.add_argument("--repeat", type=int, default=9)
    parser.add_argument("--output", default="reports/bench_solver_sparse.json")
    return run(parser.parse_args())

if __name__ == "__main__":
    raise SystemExit(main())
