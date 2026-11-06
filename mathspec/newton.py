"""阻尼 Newton 求解器（规范 §5.2）：双判据 + Armijo 线搜索。"""
from __future__ import annotations

import numpy as np


def _fd_jacobian(F, x, f0=None, eps: float = 1e-8) -> np.ndarray:
    x = np.asarray(x, float)
    n = x.size
    if f0 is None:
        f0 = np.asarray(F(x), float)
    m = f0.size
    J = np.zeros((m, n))
    for j in range(n):
        dx = np.zeros(n)
        step = eps * max(1.0, abs(x[j]))
        dx[j] = step
        J[:, j] = (np.asarray(F(x + dx), float) - f0) / step
    return J


def damped_newton(F, x0, jac=None, tol: float = 1e-12, max_iter: int = 50):
    """求解 F(x)=0。

    返回 (x, info)，info 含每轮残差范数（供二次收敛检验）。
    """
    x = np.asarray(x0, float).copy()
    res_hist = []
    for k in range(max_iter):
        f = np.asarray(F(x), float)
        nf = float(np.linalg.norm(f, np.inf))
        res_hist.append(nf)
        if nf <= tol:
            return x, {"iters": k, "residuals": res_hist, "converged": True}
        J = jac(x) if jac is not None else _fd_jacobian(F, x, f)
        try:
            dx = np.linalg.solve(J, -f)
        except np.linalg.LinAlgError:
            dx = np.linalg.lstsq(J, -f, rcond=None)[0]
        # Armijo 回溯线搜索（近根处 alpha -> 1，保证局部二次收敛）
        alpha = 1.0
        for _ in range(30):
            xt = x + alpha * dx
            if float(np.linalg.norm(np.asarray(F(xt), float), np.inf)) < nf or alpha < 1e-8:
                break
            alpha *= 0.5
        x = x + alpha * dx
    f = np.asarray(F(x), float)
    res_hist.append(float(np.linalg.norm(f, np.inf)))
    return x, {"iters": max_iter, "residuals": res_hist, "converged": False}
