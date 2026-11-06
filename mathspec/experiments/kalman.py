"""状态估计与最优控制原型：Kalman 滤波 + LQR（DARE 迭代）。

对应"架构可扩展功能"中的观测器/最优控制（规范 §15），只依赖 numpy。
"""
from __future__ import annotations

import numpy as np


def kalman_filter(A, B, C, Q, R, x0, P0, us, ys):
    """线性高斯系统 Kalman 滤波。

    x_{k+1} = A x_k + B u_k + w,  y_k = C x_k + v
    返回估计序列、协方差序列、新息。
    """
    A = np.asarray(A, float); B = np.asarray(B, float); C = np.asarray(C, float)
    Q = np.asarray(Q, float); R = np.asarray(R, float)
    x = np.asarray(x0, float).copy()
    P = np.asarray(P0, float).copy()
    xs, Ps, innovs = [], [], []
    for u, y in zip(us, ys):
        x = A @ x + B @ np.asarray(u, float)          # predict (state)
        P = A @ P @ A.T + Q                          # predict (covariance)
        y = np.asarray(y, float)
        innov = y - C @ x
        S = C @ P @ C.T + R
        K = np.linalg.solve(S, C @ P).T              # P Cᵀ S⁻¹
        x = x + K @ innov
        I = np.eye(P.shape[0])
        # Joseph form：数值上保持对称正定
        P = (I - K @ C) @ P @ (I - K @ C).T + K @ R @ K.T
        xs.append(x.copy()); Ps.append(P.copy()); innovs.append(innov)
    return np.asarray(xs), np.asarray(Ps), np.asarray(innovs)


def lqr(A, B, Q, R, max_iter: int = 5000, tol: float = 1e-12):
    """离散时间 LQR：迭代求解 DARE，返回 (K, P, iters, residual)。"""
    A = np.asarray(A, float); B = np.asarray(B, float)
    Q = np.asarray(Q, float); R = np.asarray(R, float)
    P = Q.copy()
    for k in range(max_iter):
        S = R + B.T @ P @ B
        K = np.linalg.solve(S, B.T @ P @ A)
        P_new = Q + A.T @ P @ A - A.T @ P @ B @ K
        if float(np.linalg.norm(P_new - P, np.inf)) <= tol:
            P = P_new
            break
        P = P_new
    S = R + B.T @ P @ B
    K = np.linalg.solve(S, B.T @ P @ A)
    residual = float(np.linalg.norm(
        P - (Q + A.T @ P @ A - A.T @ P @ B @ K), np.inf))
    return K, P, k + 1, residual


def dare_residual(A, B, Q, R, P, K=None):
    A = np.asarray(A, float); B = np.asarray(B, float)
    Q = np.asarray(Q, float); R = np.asarray(R, float)
    P = np.asarray(P, float)
    if K is None:
        K = np.linalg.solve(R + B.T @ P @ B, B.T @ P @ A)
    return float(np.linalg.norm(P - (Q + A.T @ P @ A - A.T @ P @ B @ K), np.inf))
