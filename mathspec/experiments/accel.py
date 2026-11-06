"""不动点加速：Picard 与 Anderson 混合（规范 §14 创造性组合 C4）。

Anderson(m) 对仿射不动点问题 x = G(x) 等价于在 (I-G)x = b 上做 GMRES(m)
（Walker & Ni, SIAM J. Numer. Anal. 2011 的等价性结果）；这里只做数值验证：
同一收敛精度下迭代次数显著少于 Picard。
"""
from __future__ import annotations

from typing import Callable, Tuple

import numpy as np


def picard(G: Callable[[np.ndarray], np.ndarray], x0: np.ndarray,
           tol: float = 1e-12, max_iter: int = 1000) -> Tuple[np.ndarray, int]:
    x = np.asarray(x0, float).copy()
    for k in range(1, max_iter + 1):
        g = np.asarray(G(x), float)
        if np.max(np.abs(g - x)) <= tol:
            return g, k
        x = g
    raise RuntimeError("Picard 未收敛")


def anderson_solve(G: Callable[[np.ndarray], np.ndarray], x0: np.ndarray,
                   m: int = 5, tol: float = 1e-12,
                   max_iter: int = 500) -> Tuple[np.ndarray, int]:
    """Anderson 混合（type-II）：用最近 m+1 个点的差分做最小二乘外推。"""
    x = np.asarray(x0, float).copy()
    xs, fs, gs = [], [], []
    for k in range(1, max_iter + 1):
        g = np.asarray(G(x), float)
        f = g - x
        if np.max(np.abs(f)) <= tol:
            return g, k
        xs.append(x.copy())
        fs.append(f.copy())
        gs.append(g.copy())
        if len(xs) > m + 1:
            xs.pop(0)
            fs.pop(0)
            gs.pop(0)
        if len(xs) == 1:
            x = g
            continue
        dX = np.column_stack([xs[i + 1] - xs[i] for i in range(len(xs) - 1)])
        dF = np.column_stack([fs[i + 1] - fs[i] for i in range(len(fs) - 1)])
        # argmin_alpha || f - dF alpha ||_2
        alpha, *_ = np.linalg.lstsq(dF, f, rcond=None)
        x = x + f - (dX + dF) @ alpha
    raise RuntimeError("Anderson 未收敛")
