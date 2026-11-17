"""B6 mathspec 独立修复：csr_from_triplets 跨行判重 + 时间积分/hybrid/drivetrain 的 dt<=0 校验（RED/GREEN）。"""
from __future__ import annotations

import numpy as np
import pytest

from mathspec.experiments.datastruct import csr_from_triplets
from mathspec.integrate import backward_euler, rk4, verlet
from mathspec.hybrid import HybridAutomaton
from mathspec.experiments.drivetrain import DriveTrainParams, simulate as drive_simulate


def _canonical(csr):
    indptr, indices, data, shape = csr
    rows = []
    for r in range(len(indptr) - 1):
        for k in range(indptr[r], indptr[r + 1]):
            rows.append((r, int(indices[k]), float(data[k])))
    return rows, shape


def test_csr_cross_row_same_col_not_merged():
    # 两行同一列、不同行——绝不能跨行合并/清空
    csr = csr_from_triplets([0, 1], [0, 0], [1.0, 2.0], (2, 1))
    indptr, indices, data, shape = csr
    assert list(indptr) == [0, 1, 2]
    assert _canonical(csr)[0] == [(0, 0, 1.0), (1, 0, 2.0)]


def test_csr_within_row_duplicate_summed():
    csr = csr_from_triplets([0, 0, 1], [1, 1, 2], [1.0, 2.0, 3.0], (2, 3))
    indptr, indices, data, shape = csr
    assert list(indptr) == [0, 1, 2]
    assert _canonical(csr)[0] == [(0, 1, 3.0), (1, 2, 3.0)]


def test_csr_approval_example_indptr():
    csr = csr_from_triplets([0, 0, 1], [0, 1, 2], [1.0, 1.0, 3.0], (2, 3))
    assert list(csr[0]) == [0, 2, 3]
    assert _canonical(csr)[0] == [(0, 0, 1.0), (0, 1, 1.0), (1, 2, 3.0)]


def test_integrate_reject_nonpositive_dt():
    f = lambda t, x: -np.asarray(x, float)
    for dt in (0.0, -1e-3):
        for fn in (
            lambda: backward_euler(f, [1.0], 0.0, 1.0, dt),
            lambda: rk4(f, [1.0], 0.0, 1.0, dt),
            lambda: verlet(lambda t, x: -np.asarray(x, float), [1.0], [0.0], 0.0, 1.0, dt),
        ):
            with pytest.raises(ValueError):
                fn()


def test_hybrid_reject_nonpositive_dt():
    auto = HybridAutomaton({"m": lambda t, x: -np.asarray(x, float)})
    for dt in (0.0, -1e-3):
        with pytest.raises(ValueError):
            auto.simulate([1.0], "m", 0.0, 1.0, dt)


def test_drivetrain_reject_nonpositive_dt():
    p = DriveTrainParams()
    for dt in (0.0, -1e-3):
        with pytest.raises(ValueError):
            drive_simulate(p, dt=dt)

def test_public_docstrings_preserved():
    assert backward_euler.__doc__ and "后向欧拉" in backward_euler.__doc__
    assert rk4.__doc__ is None or isinstance(rk4.__doc__, str)
    assert verlet.__doc__ and "Verlet" in verlet.__doc__

