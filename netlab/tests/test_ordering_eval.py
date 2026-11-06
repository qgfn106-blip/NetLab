"""P1 排序评测器的测试（R43/M1a）。"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from scipy import sparse

from netlab.core.compute.math_accel.ordering_eval import (
    OrderingResult,
    evaluate_matrix,
    matrix_from_project,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _tridiagonal(n: int = 40) -> sparse.csc_matrix:
    main = np.full(n, 2.0, dtype=complex)
    off = np.full(n - 1, -1.0, dtype=complex)
    return sparse.diags([off, main, off], offsets=[-1, 0, 1], format="csc")


def test_matrix_from_project_real_circuit() -> None:
    matrix, meta = matrix_from_project(
        PROJECT_ROOT / "MyProject" / "grid_inverter_switch.netlab"
    )
    assert matrix.shape[0] == matrix.shape[1] > 0
    assert matrix.nnz > 0
    assert meta["network"]
    assert meta["nodes"] >= matrix.shape[0] // 2


def test_evaluate_matrix_covers_all_orderings_and_is_correct() -> None:
    matrix = _tridiagonal()
    results = evaluate_matrix(matrix, repeats=1)
    names = {item.name for item in results}
    assert names == {
        "COLAMD",
        "MMD_ATA",
        "MMD_AT_PLUS_A",
        "NATURAL",
        "RCM",
        "MIN_DEGREE",
        "NESTED_DISSECTION",
    }
    assert all(isinstance(item, OrderingResult) and item.ok for item in results)
    assert all(item.rel_residual < 1e-10 for item in results)
    assert all(item.nnz_factor >= item.nnz_input for item in results)
    fills = [item.nnz_factor for item in results]
    assert fills == sorted(fills)


def test_evaluate_matrix_rejects_bad_rhs() -> None:
    matrix = _tridiagonal(8)
    with pytest.raises(ValueError):
        evaluate_matrix(matrix, rhs=np.ones(3))
