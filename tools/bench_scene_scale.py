# -*- coding: utf-8 -*-
"""NetLab 分层规模基准：scene / solver / recording / HTTP。

WP-4 要求：固定输入、预热、重复数、随机种子、计时边界与内存采样；至少覆盖
100 / 500 / 1000 / 5000 个未知量，并分别报告节点数、边数、矩阵未知量。

用法：
    python tools/bench_scene_scale.py
    python tools/bench_scene_scale.py --layers solver --unknowns 100 500 1000 5000
    python tools/bench_scene_scale.py --layers scene --nodes 100 400 --edges-factor 3

说明：scene 层受 netlab.core.common.limits.MAX_NODES=400 的产品限制；超过上限
的规模标 SKIPPED_LIMIT，不放宽产品上限。solver 层直接用 CircuitSolver，可覆盖
5000 未知量。旧参数 --nodes 仍兼容；显式请求超限时保留 PENDING_USER_AUTHORIZATION。
"""
from __future__ import annotations

import argparse
import gc
import json
import math
import os
import platform
import statistics
import sys
import time
import tracemalloc
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from netlab.core.common.limits import MAX_NODES  # noqa: E402
from netlab.core.compute.circuit.elements import Resistor, VoltageSource  # noqa: E402
from netlab.core.compute.circuit.solver import CircuitNode, CircuitSolver  # noqa: E402
from netlab.core.compute.simulation import Recorder  # noqa: E402
from netlab.core.model.scene import Scene  # noqa: E402
from tools.evidence import (  # noqa: E402
    ci_context,
    environment,
    make_result,
    repository,
    write_result,
)

RUNNER_VERSION = "netlab-bench-scale/2"
DEFAULT_UNKNOWNS = (100, 500, 1000, 5000)
DEFAULT_LAYERS = ("scene", "solver", "recording", "http")


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
    clean = [float(v) for v in samples if math.isfinite(float(v))]
    if not clean:
        return {"unit": unit, "n": 0, "samples": [], "p50": None, "p95": None,
                "min": None, "max": None, "mean": None, "stdev": None}
    return {
        "unit": unit,
        "n": len(clean),
        "samples": [round(v, 6) for v in clean],
        "p50": round(statistics.median(clean), 6),
        "p95": round(_percentile(clean, 0.95), 6),
        "min": round(min(clean), 6),
        "max": round(max(clean), 6),
        "mean": round(statistics.fmean(clean), 6),
        "stdev": round(statistics.pstdev(clean), 6) if len(clean) > 1 else 0.0,
    }


def _time(fn, warm: int, repeat: int, inner: int = 1) -> dict:
    """计时；inner 次调用合并为一个样本并按单次分摊，降低微秒级噪声。"""
    inner = max(1, int(inner))
    gc_was_enabled = gc.isenabled()
    if gc_was_enabled:
        gc.disable()
    try:
        for _ in range(max(0, int(warm))):
            for _ in range(inner):
                fn()
        samples = []
        for _ in range(max(1, int(repeat))):
            started = time.perf_counter()
            for _ in range(inner):
                fn()
            samples.append((time.perf_counter() - started) * 1000.0 / inner)
    finally:
        if gc_was_enabled:
            gc.enable()
    return _summary(samples)


def _rss_mb():
    try:
        import psutil  # type: ignore

        return round(psutil.Process(os.getpid()).memory_info().rss / 1e6, 3)
    except Exception:
        return None


def _peak_memory(fn) -> dict:
    before = _rss_mb()
    tracemalloc.start()
    try:
        tracemalloc.reset_peak()
        fn()
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    after = _rss_mb()
    return {
        "tracemalloc_peak_mb": round(peak / 1024 / 1024, 3),
        "rss_before_mb": before,
        "rss_after_mb": after,
        "rss_delta_mb": round(after - before, 3) if before is not None and after is not None else None,
        "peak_rss_mb": round(max(before, after), 3) if before is not None and after is not None else None,
    }


def build_signal_chain(nodes: int, edges: int) -> Scene:
    scene = Scene("signal")
    created = []
    for index in range(nodes):
        kind = "manual" if index == 0 else "gain"
        node = scene.add_node(
            name=f"n{index}",
            kind=kind,
            data={"voltage": 1.0} if index == 0 else {},
            position={"x": index * 10.0, "y": 0.0},
        )
        created.append(node)
    count = 0
    for index in range(1, nodes):
        if count >= edges:
            break
        scene.add_edge(
            source=created[index - 1].id,
            target=created[index].id,
            kind="scale",
            params={"gain": 1.0},
            name=f"e{count}",
        )
        count += 1
    stride = 2
    while count < edges and nodes > 2:
        added = False
        for index in range(0, nodes - stride):
            if count >= edges:
                break
            scene.add_edge(
                source=created[index].id,
                target=created[index + stride].id,
                kind="scale",
                params={"gain": 0.02},
                name=f"e{count}",
            )
            count += 1
            added = True
        if not added:
            break
        stride += 1
    scene.ensure_engine()
    return scene


def bench_scene(nodes: int, edges: int, steps: int, warmup: int) -> dict:
    if nodes > MAX_NODES:
        return {
            "layer": "scene",
            "requested_unknowns": nodes,
            "nodes": nodes,
            "edges": None,
            "matrix_unknowns": None,
            "status": "SKIPPED_LIMIT",
            "skipped_reason": f"MAX_NODES={MAX_NODES} 产品上限；未获授权不放宽",
            "timing": None,
            "memory": None,
        }
    scene = build_signal_chain(nodes, edges)
    timing = _time(lambda: scene.step(1e-3), warm=warmup, repeat=steps)
    memory = _peak_memory(lambda: scene.step(1e-3))
    return {
        "layer": "scene",
        "requested_unknowns": nodes,
        "nodes": nodes,
        "edges": len(scene.edges),
        "matrix_unknowns": None,
        "status": "PASS",
        "timing": timing,
        "steps": steps,
        "steps_per_second": round(1000.0 / timing["p50"], 3) if timing["p50"] else None,
        "memory": memory,
    }


def build_solver_chain(unknowns: int) -> tuple[CircuitSolver, int, int]:
    """构造恰好 unknowns 个矩阵未知量的链式电路。

    N 个节点含 1 个地 → N-1 个节点电压未知量；再加 1 个电压源支路电流，
    矩阵规模 = (N-1)+1 = N。因此 nodes=unknowns、elements≈unknowns。
    """
    if unknowns < 2:
        raise ValueError("unknowns 至少为 2")
    nodes = [CircuitNode(id="n0", name="n0", ground=True)]
    nodes.extend(CircuitNode(id=f"n{i}", name=f"n{i}") for i in range(1, unknowns))
    elements = []
    for i in range(1, unknowns):
        elements.append(
            Resistor(name=f"R{i}", a=f"n{i}", b=f"n{i-1}", params={"R": 1.0}, state={})
        )
    elements.append(
        VoltageSource(
            name="V1",
            a=f"n{unknowns - 1}",
            b="n0",
            params={"wave": "dc", "offset": 1.0},
            state={},
        )
    )
    solver = CircuitSolver(nodes, elements)
    return solver, len(nodes), len(elements)


def bench_solver(unknowns: int, steps: int, warmup: int) -> dict:
    solver, nodes, edges = build_solver_chain(unknowns)
    matrix_unknowns = int(solver.matrix_size)
    timing = _time(lambda: solver.step(1e-3), warm=warmup, repeat=steps)
    memory = _peak_memory(lambda: solver.step(1e-3))
    return {
        "layer": "solver",
        "requested_unknowns": unknowns,
        "nodes": nodes,
        "edges": edges,
        "matrix_unknowns": matrix_unknowns,
        "status": "PASS",
        "timing": timing,
        "steps": steps,
        "steps_per_second": round(1000.0 / timing["p50"], 3) if timing["p50"] else None,
        "memory": memory,
    }


def bench_recording(unknowns: int, steps: int, warmup: int) -> dict:
    channels = min(max(1, unknowns), 128)
    recorder = Recorder(capacity=max(1024, steps + warmup + 8))
    probes = {f"p{i}": float(i) / max(1, channels) for i in range(channels)}

    def push_frame() -> None:
        recorder.push(0.0, probes)

    timing = _time(push_frame, warm=warmup, repeat=steps, inner=20)
    memory = _peak_memory(lambda: recorder.push(0.0, probes))
    return {
        "layer": "recording",
        "requested_unknowns": unknowns,
        "nodes": 0,
        "edges": 0,
        "matrix_unknowns": None,
        "channels": channels,
        "frames": len(recorder.frames),
        "status": "PASS",
        "timing": timing,
        "steps": steps,
        "pushes_per_second": round(1000.0 / timing["p50"], 3) if timing["p50"] else None,
        "memory": memory,
    }


def bench_http(steps: int, warmup: int) -> dict:
    try:
        from fastapi.testclient import TestClient

        from netlab.server import app
    except Exception as exc:  # pragma: no cover - 环境缺依赖时如实报告
        return {
            "layer": "http",
            "requested_unknowns": 0,
            "nodes": 0,
            "edges": 0,
            "matrix_unknowns": None,
            "status": "ERROR",
            "error": f"HTTP 层不可用：{exc}",
            "timing": None,
            "memory": None,
        }
    client = TestClient(app)
    try:
        def request_status():
            response = client.get("/api/vscode/status")
            if response.status_code != 200:
                raise RuntimeError(f"status={response.status_code}")

        timing = _time(request_status, warm=warmup, repeat=steps)
        memory = _peak_memory(request_status)
    finally:
        client.close()
    return {
        "layer": "http",
        "requested_unknowns": 0,
        "nodes": 0,
        "edges": 0,
        "matrix_unknowns": None,
        "status": "PASS",
        "timing": timing,
        "steps": steps,
        "requests_per_second": round(1000.0 / timing["p50"], 3) if timing["p50"] else None,
        "memory": memory,
    }


def _config(args, layers: list[str]) -> dict:
    return {
        "runner_version": RUNNER_VERSION,
        "layers": layers,
        "unknowns": list(args.unknowns),
        "nodes": list(args.nodes) if args.nodes else None,
        "edges_factor": args.edges_factor,
        "steps": args.steps,
        "warmup": args.warmup,
        "seed": 1234,
        "timer": "time.perf_counter() around one operation; warmup then repeat",
        "memory": "tracemalloc.reset_peak around one call; optional psutil RSS before/after",
        "max_nodes": MAX_NODES,
    }


def run(args) -> tuple[dict, int]:
    started = time.perf_counter()
    started_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    layers = [item.strip() for item in args.layers.split(",") if item.strip()]
    unknown = [item.strip() for item in layers if item not in DEFAULT_LAYERS]
    if unknown:
        raise SystemExit(f"未知层 {unknown}；可选 {', '.join(DEFAULT_LAYERS)}")
    if args.nodes:
        unknown_nodes = list(args.nodes)
        for nodes in unknown_nodes:
            if nodes > MAX_NODES:
                print(
                    f"PENDING_USER_AUTHORIZATION: 请求节点数 {nodes} 超过 MAX_NODES={MAX_NODES}；"
                    "放宽上限属产品行为变更，未获授权前不执行。"
                )
                return {}, 3
    else:
        unknown_nodes = list(args.unknowns)

    results = []
    for size in unknown_nodes:
        if "scene" in layers:
            results.append(bench_scene(size, size * args.edges_factor, args.steps, args.warmup))
        if "solver" in layers:
            results.append(bench_solver(size, args.steps, args.warmup))
        if "recording" in layers:
            results.append(bench_recording(size, args.steps, args.warmup))
        if "http" in layers and size == unknown_nodes[0]:
            results.append(bench_http(args.steps, args.warmup))

    exit_code = 1 if any(row.get("status") == "ERROR" for row in results) else 0
    duration_ms = int((time.perf_counter() - started) * 1000)
    status = "passed" if exit_code == 0 else "failed"
    result = make_result(
        "tools/bench_scene_scale.py",
        ROOT,
        sys.argv,
        exit_code,
        duration_ms,
        status,
        details={"config": _config(args, layers), "results": results},
        started_at=started_at,
    )
    result["schema_bench"] = "netlab-bench-scale/2"
    result["environment_bench"] = environment()
    result["repository_bench"] = repository(ROOT)
    result["config"] = _config(args, layers)
    result["results"] = results
    result["ci_status"] = ci_context()["status"]
    return result, exit_code


def _load_bench_config() -> dict:
    defaults = {
        "relative_band": 1.0,
        "memory_band": 0.5,
        "minimum_absolute_delta_ms": 0.25,
        "layer_absolute_floor_ms": {"scene": 15.0, "solver": 1.0, "recording": 0.5, "http": 15.0},
        "fingerprint_keys": [
            "processor", "machine", "cpu_count", "os", "os_release",
            "python", "python_implementation", "packages.numpy", "packages.scipy",
            "packages.matplotlib", "threads",
        ],
        "exit_codes": {"PASS": 0, "DRIFT": 1, "INCOMPARABLE": 2, "ERROR": 3},
    }
    path = ROOT / "docs" / "bench_config.json"
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return defaults
    if isinstance(raw, dict):
        for key in ("relative_band", "memory_band", "minimum_absolute_delta_ms"):
            value = raw.get(key)
            if isinstance(value, (int, float)) and math.isfinite(float(value)):
                defaults[key] = float(value)
        for key in ("fingerprint_keys",):
            value = raw.get(key)
            if isinstance(value, list) and value:
                defaults[key] = [str(item) for item in value]
        value = raw.get("layer_absolute_floor_ms")
        if isinstance(value, dict):
            floors = {str(k): float(v) for k, v in value.items()
                      if isinstance(v, (int, float)) and math.isfinite(float(v))}
            if floors:
                defaults["layer_absolute_floor_ms"] = floors
        codes = raw.get("exit_codes")
        if isinstance(codes, dict):
            for status in ("PASS", "DRIFT", "INCOMPARABLE", "ERROR"):
                value = codes.get(status)
                if isinstance(value, int) and value >= 0:
                    defaults["exit_codes"][status] = value
    return defaults


def _fingerprint_value(env: dict, key: str):
    """支持 packages.numpy / packages.scipy / threads 等嵌套指纹。"""
    if key.startswith("packages."):
        return (env.get("packages") or {}).get(key.split(".", 1)[1])
    return env.get(key)


def _check_benchmark(result: dict, baseline: dict, config: dict | None = None) -> tuple[str, list[str]]:
    """返回 (状态, 明细)；状态与 bench_regress 四态一致。"""
    cfg = config or _load_bench_config()
    measured_env = result.get("environment_bench") or result.get("environment") or {}
    base_env = baseline.get("environment_bench") or baseline.get("environment") or {}
    changed = []
    for key in cfg["fingerprint_keys"]:
        if _fingerprint_value(measured_env, key) != _fingerprint_value(base_env, key):
            changed.append(key)
    if result.get("config") != baseline.get("config"):
        changed.append("config")
    if changed:
        return "INCOMPARABLE", [f"指纹/输入契约不同：{', '.join(changed)}"]

    base_rows = {
        (row.get("layer"), row.get("requested_unknowns")): row
        for row in baseline.get("results", [])
        if isinstance(row, dict)
    }
    drifts = []
    for row in result.get("results", []):
        key = (row.get("layer"), row.get("requested_unknowns"))
        ref = base_rows.get(key)
        if ref is None:
            continue
        if row.get("status") != ref.get("status"):
            continue
        if row.get("status") != "PASS":
            continue
        cur = (row.get("timing") or {}).get("p50")
        old = (ref.get("timing") or {}).get("p50")
        if not isinstance(cur, (int, float)) or not isinstance(old, (int, float)) or old <= 0:
            continue
        delta = (float(cur) - float(old)) / float(old)
        absolute_delta = float(cur) - float(old)
        floor = float((cfg.get("layer_absolute_floor_ms") or {}).get(
            key[0], cfg["minimum_absolute_delta_ms"]))
        if delta > float(cfg["relative_band"]) and absolute_delta > floor:
            drifts.append(
                f"{key[0]}/{key[1]}: {float(cur):.3f}ms vs 基线 {float(old):.3f}ms"
                f"（{delta:+.0%}，超出 +{float(cfg['relative_band']):.0%} 退化带及 "
                f"{floor:.3f}ms 噪声底）"
            )
    if drifts:
        return "DRIFT", drifts
    return "PASS", []


def _print_check(status: str, details: list[str]) -> int:
    token = "ok" if status == "PASS" else status.lower()
    for line in details:
        print(f"  [{'drift' if status == 'DRIFT' else 'info'}] {line}")
    print(f"bench_scale: check={token} status={status}")
    return {"PASS": 0, "DRIFT": 1, "INCOMPARABLE": 2, "ERROR": 3}[status]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="NetLab 分层规模基准")
    parser.add_argument("--layers", default=",".join(DEFAULT_LAYERS),
                        help="逗号分隔：scene,solver,recording,http")
    parser.add_argument("--unknowns", type=int, nargs="+", default=list(DEFAULT_UNKNOWNS),
                        help="矩阵未知量阶梯（默认 100 500 1000 5000）")
    parser.add_argument("--nodes", type=int, nargs="+", default=None,
                        help="兼容旧参数：仅 scene 层节点数")
    parser.add_argument("--edges-factor", type=int, default=3)
    parser.add_argument("--steps", type=int, default=10)
    parser.add_argument("--warmup", type=int, default=2)
    parser.add_argument("--out", default="reports/bench_scale.json")
    parser.add_argument("--check", action="store_true", help="与基线比较 p50（退化方向）")
    parser.add_argument("--baseline", default=str(ROOT / "docs" / "bench_scale_baseline.json"),
                        help="基线 JSON 路径")
    args = parser.parse_args(argv)

    result, code = run(args)
    if code == 3:
        return 3
    if args.check:
        baseline_path = Path(args.baseline)
        if not baseline_path.is_file():
            print(f"bench_scale: check=error status=ERROR 缺少基线 {baseline_path}")
            return 3
        try:
            baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            print(f"bench_scale: check=error status=ERROR 基线不可读：{exc}")
            return 3
        status, details = _check_benchmark(result, baseline)
        return _print_check(status, details)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    write_result(out, result)
    print(f"bench_scale: status={result['status']} results={len(result['results'])} -> {out}")
    for row in result["results"]:
        timing = row.get("timing") or {}
        p50 = timing.get("p50")
        print(
            f"  {row['layer']:9s} unknowns={row['requested_unknowns']:<5d} "
            f"nodes={str(row['nodes']):<5s} edges={str(row['edges']):<5s} "
            f"matrix={str(row['matrix_unknowns']):<5s} status={row['status']:<14s} "
            f"p50={p50 if p50 is not None else 'n/a'}"
        )
    return code


if __name__ == "__main__":
    raise SystemExit(main())
