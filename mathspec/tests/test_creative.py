"""§31 创造性原型测试：P1 Woodbury / P2 事件总线 / P3 POD-DEIM。"""
import numpy as np
import pytest

from mathspec.experiments.incremental import low_rank_benchmark, woodbury_solve
from mathspec.experiments.pod_deim import deim_error, deim_indices, deim_approximate, pod_basis_snapshots
from mathspec.experiments.eventbus import EventQueue, locate_zero, simulate_event_queue


def test_woodbury_low_rank_update_matches_direct_solve():
    r = low_rank_benchmark(n=400, k=4, seed=1)
    assert r["relative_error"] <= 1e-9
    # 单次计时受 BLAS warm-up、线程调度和缓存影响；性能只作为报告指标。
    assert r["woodbury_seconds"] > 0.0
    assert r["direct_seconds"] > 0.0


def test_event_queue_ordering_and_zero_location():
    q = EventQueue()
    q.push(1.0, "b")
    q.push(0.5, "a")
    q.push(2.0, "c")
    assert [q.pop().kind for _ in range(3)] == ["a", "b", "c"]

    f = lambda t: np.sin(3.0 * t) - 0.5
    root = locate_zero(f, 0.0, 0.6, tol=1e-13)
    assert abs(f(root)) <= 1e-10
    assert root == pytest.approx(np.arcsin(0.5) / 3.0, abs=1e-10)

    out = simulate_event_queue([(1.0, "x"), (0.2, "y")], t_end=2.0)
    assert out == [(0.2, "y"), (1.0, "x")]


def test_deim_uses_few_evaluations_with_small_error():
    r = deim_error(n=200, r=8, n_snapshots=60, seed=2)
    assert r["deim_evals"] == r["r"] < r["full_evals"]
    assert r["relative_error"] <= 1e-2
