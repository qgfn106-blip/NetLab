"""P3 POD-DEIM 非线性降阶原型（对应 PERFORMANCE §31.3 P3）。

对 f(x)=tanh(x) 的采样快照做 POD，得到基 U（n×r）；再用 DEIM 贪心选 r 个插值点，
使每次评估只需计算这 r 个分量，而不是全 n 维非线性项。
"""
from __future__ import annotations

import numpy as np


def pod_basis_snapshots(F: np.ndarray, r: int) -> np.ndarray:
    """F: n×N 快照矩阵，返回前 r 个左奇异向量。"""
    U, _, _ = np.linalg.svd(F, full_matrices=False)
    return U[:, :r]


def deim_indices(U: np.ndarray, r: int) -> np.ndarray:
    """DEIM 贪心选点：每次选当前残差最大的分量。"""
    idx = [int(np.argmax(np.abs(U[:, 0])))]
    for j in range(1, r):
        u = U[:, j]
        P = U[idx, :j]                       # j×j
        c = np.linalg.solve(P, U[idx, j])    # 用前 j 个模态拟合第 j 个
        residual = u - U[:, :j] @ c
        idx.append(int(np.argmax(np.abs(residual))))
    return np.array(idx, dtype=int)


def deim_approximate(U: np.ndarray, idx: np.ndarray, f_values_at_idx: np.ndarray) -> np.ndarray:
    """给定插值点处的非线性函数值，复原全维近似 U (P^T U)^{-1} f(P^T x)。"""
    P = U[idx, :]
    theta = np.linalg.solve(P, f_values_at_idx)
    return U @ theta


def deim_error(n: int = 200, r: int = 8, n_snapshots: int = 60, seed: int = 0):
    rng = np.random.default_rng(seed)
    x = np.linspace(-2.0, 2.0, n)
    params = rng.uniform(0.5, 2.0, size=(n_snapshots, 2))
    F = np.tanh(params[:, 0:1] * x[None, :] + params[:, 1:2]).T   # n×N 光滑空间族快照
    U = pod_basis_snapshots(F, r)
    idx = deim_indices(U, r)

    xt = x
    f_true = np.tanh(1.2 * xt + 0.3)
    f_hat = deim_approximate(U, idx, f_true[idx])
    rel = float(np.linalg.norm(f_hat - f_true) / max(np.linalg.norm(f_true), 1e-15))
    return {
        "n": n, "r": r, "relative_error": rel,
        "full_evals": n, "deim_evals": int(len(idx)),
        "indices": idx,
    }
