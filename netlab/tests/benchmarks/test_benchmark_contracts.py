# -*- coding: utf-8 -*-
"""WP-4 基准契约：固定输入、分布统计、指纹不可比与规模上报。"""
from __future__ import annotations

import copy

import pytest

from tools import bench_scene_scale as bench


def _env() -> dict:
    return {
        "processor": "test-cpu",
        "machine": "x86_64",
        "cpu_count": 8,
        "os": "TestOS",
        "os_release": "1.0",
        "python": "3.13.0",
        "python_implementation": "CPython",
        "packages": {"numpy": "2.0.0", "scipy": "1.15.0", "matplotlib": "3.10.0"},
        "threads": {"OMP_NUM_THREADS": None, "MKL_NUM_THREADS": None},
    }


def test_solver_chain_reports_nodes_edges_and_matrix_unknowns() -> None:
    solver, nodes, edges = bench.build_solver_chain(100)
    assert nodes == 100
    assert edges == 100
    assert int(solver.matrix_size) == 100


def test_bench_solver_reports_distribution_and_memory_contract() -> None:
    row = bench.bench_solver(100, steps=3, warmup=1)
    assert row["status"] == "PASS"
    assert row["nodes"] == 100
    assert row["edges"] == 100
    assert row["matrix_unknowns"] == 100
    timing = row["timing"]
    for key in ("p50", "p95", "min", "max", "n", "samples", "mean", "stdev", "unit"):
        assert key in timing
    assert timing["n"] == 3
    assert timing["p50"] > 0
    for key in ("tracemalloc_peak_mb", "rss_before_mb", "rss_after_mb", "rss_delta_mb"):
        assert key in row["memory"]


def test_scene_over_product_limit_is_skipped_not_silently_allowed() -> None:
    row = bench.bench_scene(500, 1500, steps=1, warmup=0)
    assert row["status"] == "SKIPPED_LIMIT"
    assert row["requested_unknowns"] == 500


def _result_and_baseline() -> tuple[dict, dict]:
    config = {"runner_version": "netlab-bench-scale/2", "layers": ["solver"],
              "unknowns": [100], "steps": 3, "warmup": 1}
    result = {"environment_bench": _env(), "config": config, "results": []}
    baseline = {"environment_bench": _env(), "config": copy.deepcopy(config), "results": []}
    return result, baseline


def test_fingerprint_change_is_incomparable() -> None:
    result, baseline = _result_and_baseline()
    assert bench._check_benchmark(result, baseline)[0] == "PASS"
    baseline["environment_bench"]["packages"]["numpy"] = "2.1.0"
    status, details = bench._check_benchmark(result, baseline)
    assert status == "INCOMPARABLE"
    assert any("numpy" in item for item in details)


def test_runner_version_change_is_incomparable() -> None:
    result, baseline = _result_and_baseline()
    baseline["config"]["runner_version"] = "netlab-bench-scale/3"
    assert bench._check_benchmark(result, baseline)[0] == "INCOMPARABLE"


def test_drift_requires_direction_and_band(monkeypatch: pytest.MonkeyPatch) -> None:
    result, baseline = _result_and_baseline()
    baseline["results"] = [{"layer": "solver", "requested_unknowns": 100, "status": "PASS",
                            "timing": {"p50": 10.0}}]
    result["results"] = [{"layer": "solver", "requested_unknowns": 100, "status": "PASS",
                          "timing": {"p50": 5.0}}]
    assert bench._check_benchmark(result, baseline)[0] == "PASS"
    result["results"][0]["timing"]["p50"] = 50.0
    assert bench._check_benchmark(result, baseline)[0] == "DRIFT"
