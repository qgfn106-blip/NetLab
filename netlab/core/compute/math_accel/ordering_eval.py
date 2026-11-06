"""P1：MNA 稀疏排序只读评测器（R43/M1a）。

该模块不参与生产求解路径，只负责把真实/合成 MNA 矩阵交给多种
``SuperLU`` 排序策略做对照：fill-in（``nnz(L+U)``）、factor 时间、
solve 时间、峰值内存与数值残差。结果供 ``tools/eval_mna_ordering.py``
生成 Markdown/CSV 报告。
"""

from __future__ import annotations

import time
import tracemalloc
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from scipy import sparse
from scipy.sparse.csgraph import reverse_cuthill_mckee
from scipy.sparse.linalg import splu


@dataclass
class OrderingResult:
    name: str
    n: int
    nnz_input: int
    nnz_factor: int
    fill_ratio: float
    factor_ms: float
    solve_ms: float
    peak_kb: float
    ok: bool
    rel_residual: float = 0.0
    note: str = ""

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _as_csc(matrix: Any) -> sparse.csc_matrix:
    if sparse.issparse(matrix):
        return sparse.csc_matrix(matrix, dtype=complex)
    return sparse.csc_matrix(np.asarray(matrix, dtype=complex))


def adjacency_from_matrix(matrix: Any) -> sparse.csr_matrix:
    csc = _as_csc(matrix)
    pattern = csc.copy()
    pattern.data = np.ones_like(pattern.data)
    pattern = pattern + pattern.T
    pattern.setdiag(0)
    pattern.eliminate_zeros()
    return sparse.csr_matrix(pattern)


def _validated_permutation(order: Iterable[int], n: int) -> np.ndarray:
    perm = np.asarray(list(order), dtype=int)
    if perm.shape != (n,) or sorted(perm.tolist()) != list(range(n)):
        raise ValueError("排序必须是 0..n-1 的排列")
    return perm


def _greedy_min_degree(adj: sparse.csr_matrix) -> np.ndarray:
    n = adj.shape[0]
    degree = np.asarray(adj.getnnz(axis=1)).ravel().astype(int)
    active = np.ones(n, dtype=bool)
    order: list[int] = []
    for _ in range(n):
        candidates = np.where(active)[0]
        if candidates.size == 0:
            break
        node = int(candidates[np.argmin(degree[candidates])])
        order.append(node)
        active[node] = False
        neighbors = adj.indices[adj.indptr[node] : adj.indptr[node + 1]]
        for neighbor in neighbors:
            if active[neighbor]:
                degree[neighbor] = max(0, degree[neighbor] - 1)
    return np.asarray(order, dtype=int)


def _nested_dissection_permutation(adj: sparse.csr_matrix) -> np.ndarray:
    """BFS 层分离近似：按到最大度节点的 BFS 层号排序。"""
    n = adj.shape[0]
    if n <= 2:
        return np.arange(n, dtype=int)
    degree = np.asarray(adj.getnnz(axis=1)).ravel()
    start = int(np.argmax(degree))
    level = np.full(n, -1, dtype=int)
    level[start] = 0
    queue = [start]
    head = 0
    while head < len(queue):
        node = queue[head]
        head += 1
        for neighbor in adj.indices[adj.indptr[node] : adj.indptr[node + 1]]:
            if level[neighbor] < 0:
                level[neighbor] = level[node] + 1
                queue.append(int(neighbor))
    # 不连通分量按原序号补在末尾
    remaining = np.where(level < 0)[0]
    if remaining.size:
        level[remaining] = level.max() + 1
    return np.lexsort((np.arange(n), level))


def _custom_order(name: str, adj: sparse.csr_matrix) -> np.ndarray:
    if name == "RCM":
        return reverse_cuthill_mckee(adj, symmetric_mode=True)
    if name == "MIN_DEGREE":
        return _greedy_min_degree(adj)
    if name == "NESTED_DISSECTION":
        return _nested_dissection_permutation(adj)
    raise ValueError(f"未知排序：{name}")


def _factor_and_solve(
    matrix: sparse.csc_matrix,
    rhs: np.ndarray,
    permc_spec: str,
    repeats: int,
    permutation: np.ndarray | None = None,
) -> OrderingResult:
    n = matrix.shape[0]
    work = matrix if permutation is None else matrix[permutation][:, permutation]
    rhs_work = rhs if permutation is None else rhs[permutation]
    name = permc_spec if permutation is None else "CUSTOM"
    nnz_input = int(matrix.nnz)
    peak_kb = 0.0
    factor_ms = 0.0
    solve_ms = 0.0
    lu = None
    try:
        times: list[float] = []
        for _ in range(max(1, repeats)):
            tracemalloc.start()
            started = time.perf_counter()
            lu = splu(sparse.csc_matrix(work), permc_spec=permc_spec)
            times.append((time.perf_counter() - started) * 1000.0)
            current, peak = tracemalloc.get_traced_memory()
            peak_kb = max(peak_kb, peak / 1024.0)
            tracemalloc.stop()
        factor_ms = float(np.median(times))
        solve_times: list[float] = []
        for _ in range(max(1, repeats)):
            started = time.perf_counter()
            lu.solve(rhs_work)
            solve_times.append((time.perf_counter() - started) * 1000.0)
        solve_ms = float(np.median(solve_times))
        solution = lu.solve(rhs_work)
        if permutation is not None:
            solution = np.empty_like(solution)
            solution[permutation] = lu.solve(rhs_work)
        residual = matrix @ solution - rhs
        rel = float(np.linalg.norm(residual) / max(1e-300, np.linalg.norm(rhs)))
        return OrderingResult(
            name=name,
            n=n,
            nnz_input=nnz_input,
            nnz_factor=int(lu.nnz),
            fill_ratio=float(lu.nnz / max(1, nnz_input)),
            factor_ms=factor_ms,
            solve_ms=solve_ms,
            peak_kb=peak_kb,
            ok=True,
            rel_residual=rel,
        )
    except Exception as exc:  # pragma: no cover - 失败时报告而非中断
        return OrderingResult(
            name=name,
            n=n,
            nnz_input=nnz_input,
            nnz_factor=0,
            fill_ratio=0.0,
            factor_ms=factor_ms,
            solve_ms=solve_ms,
            peak_kb=peak_kb,
            ok=False,
            note=str(exc),
        )


def evaluate_matrix(
    matrix: Any,
    *,
    methods: tuple[str, ...] = ("COLAMD", "MMD_ATA", "MMD_AT_PLUS_A", "NATURAL"),
    custom: tuple[str, ...] = ("RCM", "MIN_DEGREE", "NESTED_DISSECTION"),
    repeats: int = 3,
    rhs: np.ndarray | None = None,
) -> list[OrderingResult]:
    """对同一矩阵评估所有排序，返回按 fill-in 升序的结果。"""
    csc = _as_csc(matrix)
    n = csc.shape[0]
    if rhs is None:
        rhs = np.ones(n, dtype=complex)
    else:
        rhs = np.asarray(rhs, dtype=complex)
        if rhs.shape != (n,):
            raise ValueError("rhs 长度必须等于矩阵阶数")
    adjacency = adjacency_from_matrix(csc)
    results: list[OrderingResult] = []
    for method in methods:
        result = _factor_and_solve(csc, rhs, method, repeats)
        result.name = method
        results.append(result)
    for name in custom:
        perm = _validated_permutation(_custom_order(name, adjacency), n)
        result = _factor_and_solve(csc, rhs, "NATURAL", repeats, permutation=perm)
        result.name = name
        results.append(result)
    results.sort(
        key=lambda item: (not item.ok, item.nnz_factor if item.ok else 1 << 60)
    )
    return results


def matrix_from_scene(scene: Any, omega: float | None = None) -> sparse.csc_matrix:
    """从 circuit 场景的当前引擎导出 AC MNA 稀疏矩阵（只读，不推进状态）。"""
    from ..nodal import StampContext

    engine = scene.ensure_engine()
    solver = getattr(engine, "solver", None)
    if solver is None:
        raise ValueError("矩阵导出仅支持 circuit 场景")
    size = solver.matrix_size
    if size == 0:
        raise ValueError("场景没有可装配的电路节点")
    if omega is None:
        omega = 2.0 * np.pi * 1000.0
    A = (
        sparse.lil_matrix((size, size), dtype=complex)
        if solver.sparse
        else np.zeros((size, size), dtype=complex)
    )
    ctx = StampContext(
        A=A,
        rhs=np.zeros(size, dtype=complex),
        index=solver.index,
        solution=solver.solution,
        dt=0.0,
        time=0.0,
        iteration=0,
        mode="ac",
        omega=float(omega),
    )
    for element in solver.elements:
        if hasattr(element, "value"):
            element.value = 0.0
        element.stamp(ctx)
    return _as_csc(ctx.A)


def matrix_from_project(path: str | Path) -> tuple[sparse.csc_matrix, dict[str, Any]]:
    """读取 .netlab 工程中第一个 circuit 场景并导出 MNA 矩阵。"""
    from ...model.project import load_project, project_scene_payload
    from ...model.scene import Scene

    target = Path(path)
    project = load_project(target)
    for item in project.get("networks", []):
        network_id = item.get("id")
        if not network_id:
            continue
        payload = project_scene_payload(project, network_id)
        if str(payload.get("mode")) != "circuit":
            continue
        scene = Scene("circuit")
        scene.load_payload(payload)
        matrix = matrix_from_scene(scene)
        return matrix, {
            "file": target.name,
            "network": item.get("name"),
            "nodes": len(payload.get("nodes", [])),
            "edges": len(payload.get("edges", [])),
            "n": int(matrix.shape[0]),
            "nnz": int(matrix.nnz),
        }
    raise ValueError(f"工程中没有 circuit 场景：{target}")


def evaluate_corpus(
    paths: Iterable[str | Path], repeats: int = 3
) -> list[dict[str, Any]]:
    """对一组 .netlab 工程输出评测行。"""
    rows: list[dict[str, Any]] = []
    for path in paths:
        matrix, meta = matrix_from_project(path)
        for result in evaluate_matrix(matrix, repeats=repeats):
            row = result.as_dict()
            row.update(meta)
            rows.append(row)
    return rows
