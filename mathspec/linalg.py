"""线性求解：稠密 LU 缓存 / 稀疏 splu 缓存（规范 §5.1）。"""
from __future__ import annotations

import numpy as np
import scipy.linalg as sla
import scipy.sparse as sp
import scipy.sparse.linalg as spla


class DenseLU:
    """稠密 LU：一次分解、多次回代（对应 netlab _lu_cache）。"""

    def __init__(self, A) -> None:
        self.A = np.asarray(A)
        self.lu, self.piv = sla.lu_factor(self.A)

    def solve(self, b):
        return sla.lu_solve((self.lu, self.piv), np.asarray(b, float))


def solve_dense(A, b):
    return DenseLU(A).solve(b)


class SparseLU:
    """稀疏 splu 缓存（对应 netlab _solve_sparse）。"""

    def __init__(self, A) -> None:
        self.A = sp.csc_matrix(A)
        self.lu = spla.splu(self.A)

    def solve(self, b):
        return self.lu.solve(np.asarray(b, float))


def solve_sparse(A, b):
    return SparseLU(A).solve(b)


def residual(A, x, b) -> float:
    """无穷范数残差 ‖Ax-b‖∞（同时支持稠密与 scipy 稀疏 A）。"""
    x = np.asarray(x, float)
    Ax = A @ x if sp.issparse(A) else np.asarray(A) @ x
    return float(np.max(np.abs(Ax - np.asarray(b, float))))
