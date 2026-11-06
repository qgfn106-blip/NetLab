"""优化算法验收：收敛率、最优性、最小二乘恢复。"""
import numpy as np

from mathspec.experiments.optim import (
    bfgs, conjugate_gradient, gradient_descent, levenberg_marquardt, newton_minimize,
)


def test_newton_quadratic_converges_in_one_step():
    def f(x):
        return (x[0] - 1.0) ** 2 + 2.0 * (x[1] + 2.0) ** 2

    def grad(x):
        return np.array([2.0 * (x[0] - 1.0), 4.0 * (x[1] + 2.0)])

    def hess(x):
        return np.array([[2.0, 0.0], [0.0, 4.0]])

    x, info = newton_minimize(f, grad, hess, np.array([10.0, 10.0]))
    assert info["converged"]
    assert info["iters"] <= 2                 # 二次函数 + 精确 Hessian：一步到最优
    assert np.linalg.norm(x - np.array([1.0, -2.0]), np.inf) < 1e-10


def test_bfgs_rosenbrock():
    def f(x):
        return 100.0 * (x[1] - x[0] ** 2) ** 2 + (1.0 - x[0]) ** 2

    def grad(x):
        return np.array([
            -400.0 * x[0] * (x[1] - x[0] ** 2) - 2.0 * (1.0 - x[0]),
            200.0 * (x[1] - x[0] ** 2),
        ])

    x, info = bfgs(f, grad, np.array([-1.2, 1.0]), max_iter=500)
    assert info["converged"], info
    assert info["iters"] < 200
    assert np.linalg.norm(x - np.array([1.0, 1.0]), np.inf) < 1e-6


def test_levenberg_marquardt_recovers_exponential():
    t = np.linspace(0.0, 2.0, 60)
    y = 2.5 * np.exp(-1.3 * t)

    def residual(p):
        return p[0] * np.exp(-p[1] * t) - y

    def jac(p):
        return np.column_stack([np.exp(-p[1] * t), -p[0] * t * np.exp(-p[1] * t)])

    p, info = levenberg_marquardt(residual, jac, np.array([1.0, 0.5]))
    assert info["converged"]
    assert abs(p[0] - 2.5) < 1e-6
    assert abs(p[1] - 1.3) < 1e-6


def test_conjugate_gradient_spd():
    rng = np.random.default_rng(7)
    n = 80
    M = rng.standard_normal((n, n))
    A = M.T @ M + n * np.eye(n)          # 对称正定
    b = rng.standard_normal(n)
    x, info = conjugate_gradient(A, b, tol=1e-9)
    assert info["converged"]
    assert info["iters"] <= n
    assert np.linalg.norm(A @ x - b, np.inf) < 1e-7


def test_gradient_descent_matches_optimum_on_quadratic():
    def f(x):
        return float((x[0] - 3.0) ** 2 + (x[1] + 1.0) ** 2)

    def grad(x):
        return np.array([2.0 * (x[0] - 3.0), 2.0 * (x[1] + 1.0)])

    x, info = gradient_descent(f, grad, np.array([0.0, 0.0]), lr=0.1, max_iter=500)
    assert info["converged"]
    assert np.linalg.norm(x - np.array([3.0, -1.0]), np.inf) < 1e-6
