"""优化算法原型：梯度下降 / 阻尼 Newton / BFGS / Levenberg-Marquardt / 共轭梯度。

所有实现只依赖 numpy，用于在数学形式上验证收敛率与最优性条件；
不 import netlab。对应规范 §15（架构可扩展能力）与 PERFORMANCE §32。
"""
from __future__ import annotations

import numpy as np


def _armijo(f, x, f0, g, d, c1: float = 1e-4, beta: float = 0.5, max_ls: int = 50) -> float:
    """回溯线搜索：满足 f(x+αd) ≤ f(x) + c1·α·gᵀd 的最小 α（二分衰减）。"""
    alpha = 1.0
    gd = float(np.dot(g, d))
    for _ in range(max_ls):
        if f(x + alpha * d) <= f0 + c1 * alpha * gd:
            return alpha
        alpha *= beta
    return alpha


def gradient_descent(f, grad, x0, lr: float = 1e-2, max_iter: int = 20000, tol: float = 1e-10):
    x = np.asarray(x0, float).copy()
    hist = []
    for k in range(max_iter):
        g = np.asarray(grad(x), float)
        ng = float(np.linalg.norm(g, np.inf))
        hist.append(ng)
        if ng <= tol:
            return x, {"iters": k, "grad_norm": ng, "history": hist, "converged": True}
        x = x - lr * g
    return x, {"iters": max_iter, "grad_norm": ng, "history": hist, "converged": False}


def newton_minimize(f, grad, hess, x0, max_iter: int = 100, tol: float = 1e-12):
    """阻尼 Newton 求 min f。近根处 α=1，局部二次收敛。"""
    x = np.asarray(x0, float).copy()
    hist = []
    for k in range(max_iter):
        g = np.asarray(grad(x), float)
        ng = float(np.linalg.norm(g, np.inf))
        hist.append(ng)
        if ng <= tol:
            return x, {"iters": k, "grad_norm": ng, "history": hist, "converged": True}
        H = np.asarray(hess(x), float)
        try:
            d = np.linalg.solve(H, -g)
        except np.linalg.LinAlgError:
            d = -g
        if float(np.dot(g, d)) >= 0:          # 非下降方向 → 退回梯度方向
            d = -g
        f0 = float(f(x))
        alpha = _armijo(f, x, f0, g, d)
        x = x + alpha * d
    g = np.asarray(grad(x), float)
    return x, {"iters": max_iter, "grad_norm": float(np.linalg.norm(g, np.inf)), "history": hist, "converged": False}


def bfgs(f, grad, x0, max_iter: int = 500, tol: float = 1e-10):
    """BFGS 拟牛顿法（逆 Hessian 近似，Armijo 线搜索）。"""
    x = np.asarray(x0, float).copy()
    n = x.size
    H = np.eye(n)
    hist = []
    for k in range(max_iter):
        g = np.asarray(grad(x), float)
        ng = float(np.linalg.norm(g, np.inf))
        hist.append(ng)
        if ng <= tol:
            return x, {"iters": k, "grad_norm": ng, "history": hist, "converged": True}
        d = -H @ g
        if float(np.dot(g, d)) >= 0:
            H = np.eye(n)
            d = -g
        alpha = _armijo(f, x, float(f(x)), g, d)
        s = alpha * d
        x_new = x + s
        g_new = np.asarray(grad(x_new), float)
        y = g_new - g
        sy = float(np.dot(s, y))
        if sy > 1e-14:                         # 保持 H 正定
            rho = 1.0 / sy
            I = np.eye(n)
            V = I - rho * np.outer(s, y)
            H = V @ H @ V.T + rho * np.outer(s, s)
        x = x_new
    g = np.asarray(grad(x), float)
    return x, {"iters": max_iter, "grad_norm": float(np.linalg.norm(g, np.inf)), "history": hist, "converged": False}


def levenberg_marquardt(residual, jac, x0, max_iter: int = 200, tol: float = 1e-12):
    """非线性最小二乘：min ½‖r(x)‖²，阻尼 Gauss-Newton（LM）。"""
    x = np.asarray(x0, float).copy()
    lam = 1e-3
    r = np.asarray(residual(x), float)
    cost = 0.5 * float(np.dot(r, r))
    hist = [cost]
    for k in range(max_iter):
        J = np.asarray(jac(x), float)
        g = J.T @ r
        if float(np.linalg.norm(g, np.inf)) <= tol:
            return x, {"iters": k, "cost": cost, "history": hist, "lambda": lam, "converged": True}
        A = J.T @ J
        diag = np.maximum(np.diag(A), 1e-12)
        for _ in range(30):
            try:
                dx = np.linalg.solve(A + lam * np.diag(diag), -g)
            except np.linalg.LinAlgError:
                lam *= 10.0
                continue
            x_new = x + dx
            r_new = np.asarray(residual(x_new), float)
            cost_new = 0.5 * float(np.dot(r_new, r_new))
            if cost_new < cost:
                x, r, cost = x_new, r_new, cost_new
                lam = max(lam * 0.3, 1e-12)
                break
            lam *= 10.0
        hist.append(cost)
    return x, {"iters": max_iter, "cost": cost, "history": hist, "lambda": lam, "converged": False}


def conjugate_gradient(A, b, x0=None, max_iter: int | None = None, tol: float = 1e-10):
    """求解对称正定线性方程组 Ax=b 的共轭梯度法。"""
    A = np.asarray(A, float)
    b = np.asarray(b, float)
    n = b.size
    x = np.zeros(n) if x0 is None else np.asarray(x0, float).copy()
    r = b - A @ x
    p = r.copy()
    rs = float(np.dot(r, r))
    if max_iter is None:
        max_iter = n
    hist = [float(np.sqrt(rs))]
    for k in range(max_iter):
        if np.sqrt(rs) <= tol:
            return x, {"iters": k, "residual": float(np.sqrt(rs)), "history": hist, "converged": True}
        Ap = A @ p
        denom = float(np.dot(p, Ap))
        if denom <= 0:
            break
        alpha = rs / denom
        x = x + alpha * p
        r = r - alpha * Ap
        rs_new = float(np.dot(r, r))
        hist.append(float(np.sqrt(rs_new)))
        if np.sqrt(rs_new) <= tol:
            return x, {"iters": k + 1, "residual": float(np.sqrt(rs_new)), "history": hist, "converged": True}
        p = r + (rs_new / rs) * p
        rs = rs_new
    return x, {"iters": max_iter, "residual": float(np.sqrt(rs)), "history": hist, "converged": False}
