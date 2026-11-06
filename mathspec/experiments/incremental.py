"""P1 局部重分解：Woodbury 低秩更新原型（对应 PERFORMANCE §31.3 P1）。

场景：MNA 矩阵 A0 只改动少量元件 → A = A0 + U C V^T（rank k << n）。
先对 A0 做一次 LU，之后每次改动只用 k×k 小系统 + 两次三角回代。
"""
from __future__ import annotations

import time
from typing import Tuple

import numpy as np
from scipy.linalg import lu_factor, lu_solve


def woodbury_solve(lu_piv: Tuple[np.ndarray, np.ndarray], A0: np.ndarray,
                   U: np.ndarray, C: np.ndarray, V: np.ndarray,
                   b: np.ndarray) -> np.ndarray:
    """求解 (A0 + U C V^T) x = b，复用 A0 的 LU 分解。"""
    lu, piv = lu_piv
    x0 = lu_solve((lu, piv), b)
    Y = lu_solve((lu, piv), U)                 # A0^{-1} U, n×k
    M = np.linalg.inv(C) + V.T @ Y             # k×k
    z = np.linalg.solve(M, V.T @ x0)           # k
    return x0 - Y @ z


def low_rank_benchmark(n: int = 400, k: int = 4, seed: int = 0):
    """构造对角占优的 A0 与低秩改动，比较全量分解 vs Woodbury 的误差/耗时。"""
    rng = np.random.default_rng(seed)
    A0 = rng.standard_normal((n, n)) / np.sqrt(n)
    A0 = A0 + (n + 1.0) * np.eye(n)            # 良态、对角占优
    U = rng.standard_normal((n, k))
    V = rng.standard_normal((n, k))
    C = np.diag(rng.uniform(0.5, 1.5, size=k))
    A = A0 + U @ C @ V.T
    b = rng.standard_normal(n)

    t0 = time.perf_counter()
    lu_piv = lu_factor(A0)
    t_factor = time.perf_counter() - t0

    t2 = time.perf_counter()
    x_w = woodbury_solve(lu_piv, A0, U, C, V, b)
    t_wood = time.perf_counter() - t2

    t1 = time.perf_counter()
    x_d = np.linalg.solve(A, b)
    t_direct = time.perf_counter() - t1
    rel = float(np.linalg.norm(x_w - x_d) / max(np.linalg.norm(x_d), 1e-15))
    return {
        "n": n, "k": k, "relative_error": rel,
        "factor_seconds": t_factor, "woodbury_seconds": t_wood,
        "direct_seconds": t_direct,
        "speedup": t_direct / max(t_wood, 1e-12),
        "x": x_w,
    }
