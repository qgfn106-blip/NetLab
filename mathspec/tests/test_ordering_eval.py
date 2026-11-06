"""M0 原型：稀疏矩阵排序评测器测试。"""

from __future__ import annotations

import numpy as np
from scipy.sparse import csc_matrix

from mathspec.experiments.ordering_eval import evaluate


def _tridiagonal(n: int) -> csc_matrix:
    main = np.full(n, 2.0)
    off = np.full(n - 1, -1.0)
    return csc_matrix(np.diag(main) + np.diag(off, 1) + np.diag(off, -1))


def _grid(nx: int, ny: int) -> csc_matrix:
    count = nx * ny
    rows: list[int] = []
    cols: list[int] = []
    values: list[float] = []
    for y in range(ny):
        for x in range(nx):
            index = y * nx + x
            rows.append(index)
            cols.append(index)
            values.append(4.0)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx2, ny2 = x + dx, y + dy
                if 0 <= nx2 < nx and 0 <= ny2 < ny:
                    rows.append(index)
                    cols.append(ny2 * nx + nx2)
                    values.append(-1.0)
    return csc_matrix((values, (rows, cols)), shape=(count, count))


def test_tridiagonal_ordering_has_no_extra_fill() -> None:
    matrix = _tridiagonal(30)
    results = evaluate(matrix, repeats=1)
    assert results
    for row in results:
        assert row.ok
        assert row.nnz >= matrix.nnz
        assert np.isfinite(row.fill_ratio) and row.fill_ratio > 0.0


def test_grid_reports_all_strategies() -> None:
    results = evaluate(_grid(12, 12), repeats=1)
    names = {row.name for row in results}
    assert {
        "COLAMD",
        "MMD_ATA",
        "MMD_AT_PLUS_A",
        "NATURAL",
        "RCM",
        "MIN_DEGREE",
        "NESTED_DISSECTION",
    } <= names
    assert all(row.ok for row in results)
    best = min(row.nnz for row in results)
    natural = next(row for row in results if row.name == "NATURAL")
    assert best <= natural.nnz


def test_deterministic_repeat() -> None:
    matrix = _grid(8, 8)
    first = evaluate(matrix, repeats=1)
    second = evaluate(matrix, repeats=1)
    assert [(row.name, row.nnz) for row in first] == [
        (row.name, row.nnz) for row in second
    ]
