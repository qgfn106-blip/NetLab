"""NetLab 场景规模基准：在 MAX_NODES 允许范围内输出真实 steps/s 与内存峰值。

用法：
    python tools/bench_scene_scale.py --nodes 100 400 --edges-factor 3

500+ 节点受 netlab.core.common.limits.MAX_NODES=400 限制，属产品行为变更；
未获用户书面授权前，本工具只报告 PENDING_USER_AUTHORIZATION，不擅自放宽上限。
"""
from __future__ import annotations

import argparse
import json
import statistics
import time
import tracemalloc
from pathlib import Path

from netlab.core.common.limits import MAX_NODES
from netlab.core.model.scene import Scene


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


def bench(nodes: int, edges: int, steps: int, warmup: int) -> dict:
    scene = build_signal_chain(nodes, edges)
    for _ in range(warmup):
        scene.step(1e-3)
    samples = []
    tracemalloc.start()
    for _ in range(steps):
        started = time.perf_counter()
        scene.step(1e-3)
        samples.append((time.perf_counter() - started) * 1e3)
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    median = statistics.median(samples)
    return {
        "nodes": nodes,
        "edges": len(scene.edges),
        "steps": steps,
        "median_ms": round(median, 6),
        "steps_per_second": round(1000.0 / median, 1) if median > 0 else None,
        "peak_tracemalloc_mb": round(peak / 1024 / 1024, 3),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="NetLab 场景规模基准")
    parser.add_argument("--nodes", type=int, nargs="+", default=[100, 400])
    parser.add_argument("--edges-factor", type=int, default=3)
    parser.add_argument("--steps", type=int, default=30)
    parser.add_argument("--warmup", type=int, default=20)
    parser.add_argument("--out", default="reports/bench_scale.json")
    args = parser.parse_args(argv)
    if any(n > MAX_NODES for n in args.nodes):
        print(
            f"PENDING_USER_AUTHORIZATION: 请求节点数 {max(args.nodes)} 超过 MAX_NODES={MAX_NODES}；"
            "放宽上限属产品行为变更，未获授权前不执行。"
        )
        return 3
    results = []
    for nodes in args.nodes:
        results.append(bench(nodes, nodes * args.edges_factor, args.steps, args.warmup))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"max_nodes": MAX_NODES, "results": results}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
