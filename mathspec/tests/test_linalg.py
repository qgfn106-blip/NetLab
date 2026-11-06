import numpy as np
import scipy.sparse as sp

import mathspec.linalg as la


def test_dense_solve_residual():
    rng = np.random.default_rng(0)
    A = rng.normal(size=(6, 6))
    A = A @ A.T + 6 * np.eye(6)
    b = rng.normal(size=6)
    x = la.solve_dense(A, b)
    assert la.residual(A, x, b) < 1e-10


def test_dense_lu_reuse():
    A = np.array([[2.0, 1.0], [1.0, 3.0]])
    lu = la.DenseLU(A)
    b = np.array([1.0, 2.0])
    x1 = lu.solve(b)
    x2 = lu.solve(np.array([3.0, 4.0]))
    assert la.residual(A, x1, b) < 1e-12
    assert la.residual(A, x2, np.array([3.0, 4.0])) < 1e-12


def test_sparse_solve():
    n = 50
    A = sp.diags([-np.ones(n - 1), 2 * np.ones(n), -np.ones(n - 1)], [-1, 0, 1]).tocsc()
    b = np.ones(n)
    x = la.solve_sparse(A, b)
    assert la.residual(A, x, b) < 1e-9
