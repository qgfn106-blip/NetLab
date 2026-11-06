"""稀疏矩阵排序评测器（M0 原型）。

评测对象：同一稀疏复数/实数矩阵在 ``scipy.sparse.linalg.splu`` 下，
不同 ``permc_spec``（COLAMD / MMD_ATA / MMD_AT_PLUS_A / NATURAL）
以及自研预置换（RCM / 最小度 / 嵌套剖分）的 fill-in、分解耗时、
求解耗时与峰值内存。

本模块零耦合：只依赖 numpy/scipy，并复用同目录 ``ordering.py`` 的
图排序原型。
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
import time
import tracemalloc
from typing import Iterable, Sequence

import numpy as np
from scipy.sparse import csc_matrix, issparse
from scipy.sparse.linalg import splu

from . import ordering as graph_ordering


PERMUTATION_SPECS = ("COLAMD", "MMD_ATA", "MMD_AT_PLUS_A", "NATURAL")
CUSTOM_ORDERINGS = ("RCM", "MIN_DEGREE", "NESTED_DISSECTION")


@dataclass
class OrderingResult:
    name: str
    nnz: int
    nnz_input: int
    fill_ratio: float
    factor_ms: float
    solve_ms: float
    peak_kb: float
    ok: bool = True
    note: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def _as_csc(matrix) -> csc_matrix:
    if not issparse(matrix):
        matrix = csc_matrix(np.asarray(matrix))
    else:
        matrix = matrix.tocsc()
    if matrix.ndim != 2 or matrix.shape[0] != matrix.shape[1]:
        raise ValueError("matrix 必须是方阵")
    return matrix


def adjacency_from_matrix(matrix) -> list[list[int]]:
    """按稀疏模式构造无向邻接表（忽略数值与对角线）。"""
    csc = _as_csc(matrix)
    adjacency: list[list[int]] = []
    for row in range(csc.shape[0]):
        start, end = csc.indptr[row], csc.indptr[row + 1]
        neighbours = set(int(index) for index in csc.indices[start:end])
        neighbours.discard(row)
        adjacency.append(sorted(neighbours))
    return adjacency


def _nested_dissection_from_adjacency(adjacency: list[list[int]]) -> list[int]:
    """对任意无向图做 BFS 层分离的嵌套剖分近似排序。

    递归：从当前子图任一点 BFS，取最远层作 separator，先递归两侧，
    最后放 separator。非网格图也给出合法排列；网格上的质量由
    ``mathspec.experiments.ordering.nested_dissection_order`` 单独验证。
    """
    order: list[int] = []
    size = len(adjacency)

    def visit(nodes: list[int]) -> None:
        if len(nodes) <= 2:
            order.extend(sorted(nodes))
            return
        node_set = set(nodes)
        start = nodes[0]
        levels: list[list[int]] = []
        seen = {start}
        frontier = [start]
        while frontier:
            levels.append(sorted(frontier))
            next_frontier = []
            for node in frontier:
                for neighbour in adjacency[node]:
                    if neighbour in node_set and neighbour not in seen:
                        seen.add(neighbour)
                        next_frontier.append(neighbour)
            frontier = next_frontier
        if len(seen) < len(nodes):
            for node in nodes:
                if node not in seen:
                    visit([node])
            return
        separator = set(levels[-1]) if len(levels) > 1 else {nodes[0]}
        left = [
            node for node in nodes if node not in separator and node < min(separator)
        ]
        right = [
            node for node in nodes if node not in separator and node >= min(separator)
        ]
        if not left or not right:
            order.extend(sorted(nodes))
            return
        visit(left)
        visit(right)
        order.extend(sorted(separator))

    visit(list(range(size)))
    return order


def _permutation(matrix: csc_matrix, name: str) -> np.ndarray | None:
    if name == "RCM":
        return np.asarray(
            graph_ordering.rcm_order(adjacency_from_matrix(matrix)), dtype=int
        )
    if name == "MIN_DEGREE":
        return np.asarray(
            graph_ordering.min_degree_order(adjacency_from_matrix(matrix)), dtype=int
        )
    if name == "NESTED_DISSECTION":
        return np.asarray(
            _nested_dissection_from_adjacency(adjacency_from_matrix(matrix)), dtype=int
        )
    return None


def _factor_once(matrix: csc_matrix, permc_spec: str):
    started = time.perf_counter()
    lu = splu(matrix, permc_spec=permc_spec)
    elapsed = (time.perf_counter() - started) * 1.0e3
    return lu, elapsed


def evaluate(
    matrix,
    *,
    names: Sequence[str] = PERMUTATION_SPECS + CUSTOM_ORDERINGS,
    repeats: int = 3,
    seed: int = 0,
) -> list[OrderingResult]:
    """评测一组排序策略，返回按 fill-in 升序的结果。"""
    base = _as_csc(matrix)
    if repeats < 1:
        raise ValueError("repeats 必须 ≥ 1")
    rng = np.random.default_rng(seed)
    probe = rng.standard_normal(base.shape[0]).astype(base.dtype)
    results: list[OrderingResult] = []
    for name in names:
        permutation = _permutation(base, name)
        target = (
            base if permutation is None else base[permutation][:, permutation].tocsc()
        )
        try:
            lu, factor_ms = _factor_once(
                target, "NATURAL" if permutation is not None else name
            )
            solve_times = []
            for _ in range(repeats):
                started = time.perf_counter()
                lu.solve(probe)
                solve_times.append((time.perf_counter() - started) * 1.0e3)
            tracemalloc.start()
            _factor_once(target, "NATURAL" if permutation is not None else name)
            _, peak = tracemalloc.get_traced_memory()
            tracemalloc.stop()
            results.append(
                OrderingResult(
                    name=name,
                    nnz=int(lu.nnz),
                    nnz_input=int(target.nnz),
                    fill_ratio=float(lu.nnz) / max(1, target.nnz),
                    factor_ms=float(factor_ms),
                    solve_ms=float(sorted(solve_times)[len(solve_times) // 2]),
                    peak_kb=peak / 1024.0,
                )
            )
        except (RuntimeError, ValueError) as exc:
            results.append(
                OrderingResult(
                    name=name,
                    nnz=0,
                    nnz_input=int(target.nnz),
                    fill_ratio=float("inf"),
                    factor_ms=float("inf"),
                    solve_ms=float("inf"),
                    peak_kb=0.0,
                    ok=False,
                    note=str(exc),
                )
            )
    results.sort(key=lambda item: (not item.ok, item.nnz))
    return results


def compare_fill(results: Iterable[OrderingResult]) -> dict[str, float]:
    """返回各策略相对第一名的 fill-in 降幅（0–1）。"""
    rows = [row for row in results if row.ok]
    if not rows:
        return {}
    best = min(row.nnz for row in rows)
    return {row.name: 1.0 - best / row.nnz if row.nnz else 0.0 for row in rows}
