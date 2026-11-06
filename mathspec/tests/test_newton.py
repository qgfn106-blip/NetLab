import numpy as np

from mathspec.newton import damped_newton


def test_quadratic_convergence():
    F = lambda x: np.array([x[0] ** 2 - 2.0, x[1] ** 2 - 3.0])
    J = lambda x: np.diag([2 * x[0], 2 * x[1]])
    x, info = damped_newton(F, np.array([1.5, 1.5]), jac=J, tol=1e-13)
    assert info["converged"]
    root = np.array([np.sqrt(2.0), np.sqrt(3.0)])
    assert np.linalg.norm(x - root) < 1e-10
    assert info["iters"] <= 8
    res = np.array(info["residuals"])
    assert res[-1] <= 1e-12
    # 残差应单调下降
    assert np.all(np.diff(res) <= 1e-15)
