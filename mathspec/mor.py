"""模型降阶（规范 §6）：POD / 平衡截断（带 H∞ 误差界）/ DMD。"""
from __future__ import annotations

import numpy as np
import scipy.linalg as sla


def pod(snapshots, r):
    """POD：快照矩阵 X(n,N) 的 SVD，取前 r 个模态。返回 (U_r, S_r, Vt_r)。

    条件：U_r 的列来自 SVD，具有正交性；后续投影与量化误差界都依赖
    ``U_r.T @ U_r = I``，外部传入非正交基时不能套用该界。
    """
    X = np.asarray(snapshots, float)
    U, S, Vt = np.linalg.svd(X, full_matrices=False)
    return U[:, :r], S[:r], Vt[:r, :]


def _gramians(A, B, C):
    P = sla.solve_continuous_lyapunov(A, -B @ B.T)
    Q = sla.solve_continuous_lyapunov(A.T, -C.T @ C)
    return (P + P.T) / 2.0, (Q + Q.T) / 2.0


def balanced_truncation(A, B, C, r):
    """平方根平衡截断。

    返回 (Ar, Br, Cr, hsv, error_bound)，其中
        error_bound = 2 * sum_{i>r} sigma_i   （H∞ 误差界，§6.2）

    条件：连续时间 LTI 系统 (A,B,C) 稳定且最小实现，Gramian 有限；
    H∞ 界按精确连续系统陈述。本函数不检查稳定性/可控可观性，也不处理
    奇异 Gramian 的数值秩截断，调用方需先验证这些前提。
    """
    A = np.asarray(A, float)
    B = np.asarray(B, float)
    C = np.asarray(C, float)
    P, Q = _gramians(A, B, C)

    # P = Sp Sp^T, Q = Sq Sq^T（对称半正定 -> 特征分解取平方根）
    sp_eval, Up = np.linalg.eigh(P)
    sp_eval = np.clip(sp_eval, 1e-30, None)
    Sp = Up @ np.diag(np.sqrt(sp_eval))
    sq_eval, Uq = np.linalg.eigh(Q)
    sq_eval = np.clip(sq_eval, 1e-30, None)
    Sq = Uq @ np.diag(np.sqrt(sq_eval))

    # SVD of Sq^T Sp = U Sigma V^T  -> 平衡变换使两 Gramian 都 = Sigma
    U, sig, Vt = np.linalg.svd(Sq.T @ Sp)
    V = Vt.T
    Sig_isqrt = np.diag(sig ** -0.5)
    Tmat = Sp @ V @ Sig_isqrt
    Tinv = Sig_isqrt @ U.T @ Sq.T

    Ab = Tinv @ A @ Tmat
    Bb = Tinv @ B
    Cb = C @ Tmat

    Ar = Ab[:r, :r]
    Br = Bb[:r, :]
    Cr = Cb[:, :r]
    error_bound = 2.0 * float(np.sum(sig[r:]))
    return Ar, Br, Cr, sig, error_bound


def dmd(X, r):
    """动态模态分解：拟合 x_{k+1} ~ A x_k，返回 (A_r, modes, eigenvalues)。"""
    X1 = np.asarray(X[:, :-1], float)
    X2 = np.asarray(X[:, 1:], float)
    Ur, Sr, Vrt = np.linalg.svd(X1, full_matrices=False)
    Ur, Sr, Vrt = Ur[:, :r], Sr[:r], Vrt[:r, :]
    Atilde = Ur.T @ X2 @ Vrt.T @ np.diag(1.0 / Sr)
    eigvals, W = np.linalg.eig(Atilde)
    modes = X2 @ Vrt.T @ np.diag(1.0 / Sr) @ W
    return Atilde, modes, eigvals
