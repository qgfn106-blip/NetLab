"""状态估计与最优控制验收：Kalman 协方差、LQR 稳定性、DARE 残差。"""
import numpy as np

from mathspec.experiments.kalman import dare_residual, kalman_filter, lqr


def _double_integrator(dt=1.0):
    A = np.array([[1.0, dt], [0.0, 1.0]])
    B = np.array([[0.5 * dt * dt], [dt]])
    return A, B


def test_lqr_stabilizes_double_integrator():
    A, B = _double_integrator()
    Q = np.eye(2)
    R = np.array([[1.0]])
    K, P, iters, residual = lqr(A, B, Q, R)
    assert iters < 1000
    assert residual < 1e-8
    eig = np.linalg.eigvals(A - B @ K)
    assert np.all(np.abs(eig) < 1.0)
    assert np.allclose(P, P.T, atol=1e-10)
    assert np.all(np.linalg.eigvalsh(P) > -1e-10)


def test_kalman_covariance_symmetric_psd_and_consistent():
    A, B = _double_integrator(dt=0.5)
    C = np.array([[1.0, 0.0]])
    Q = np.array([[1e-4, 0.0], [0.0, 1e-4]])
    R = np.array([[1e-2]])
    rng = np.random.default_rng(11)
    n_steps = 300
    x = np.zeros(2)
    us, ys, truths = [], [], []
    for _ in range(n_steps):
        u = np.array([0.0])
        x = A @ x + B @ u + rng.multivariate_normal(np.zeros(2), Q)
        y = C @ x + rng.normal(0.0, np.sqrt(R[0, 0]))
        us.append(u); ys.append(y); truths.append(x.copy())
    xs, Ps, _ = kalman_filter(A, B, C, Q, R, np.zeros(2), np.eye(2) * 10.0, us, ys)
    for P in Ps:
        assert np.allclose(P, P.T, atol=1e-12)
        assert np.all(np.linalg.eigvalsh(P) > -1e-10)
    err = np.asarray(truths) - xs
    # 归一化误差应落在 3σ 以内（粗一致性检查）
    sigma = np.sqrt(np.maximum(np.asarray(Ps)[:, 0, 0], 1e-12))
    assert np.mean(np.abs(err[:, 0]) / sigma) < 3.0
    K, P, _, _ = lqr(A, B, np.eye(2), np.array([[1.0]]))
    assert dare_residual(A, B, np.eye(2), np.array([[1.0]]), P, K) < 1e-8
