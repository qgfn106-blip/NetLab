"""加速后端的最小回归：CPU 回退、解析解一致性与输入校验。"""

from __future__ import annotations

import numpy as np
import pytest

from netlab import accel
from netlab.limits import ComputeError


@pytest.fixture(autouse=True)
def _cpu_policy():
    accel.configure("cpu")
    yield
    accel.configure("auto")


def test_solve_dense_matches_numpy_on_cpu():
    matrix = np.array([[3.0, 1.0], [1.0, 2.0]])
    rhs = np.array([9.0, 8.0])
    solution = accel.solve_dense(matrix, rhs)
    np.testing.assert_allclose(solution, np.linalg.solve(matrix, rhs))
    assert accel.status()["backend"] == "cpu"


def test_matmul_and_to_cpu_are_consistent():
    left = np.arange(6.0).reshape(2, 3)
    right = np.arange(6.0).reshape(3, 2)
    np.testing.assert_allclose(accel.matmul(left, right), left @ right)
    device = accel.to_cpu(np.ones((2, 2)))
    assert isinstance(device, np.ndarray)
    assert device.dtype == float


def test_solve_dense_rejects_bad_input():
    with pytest.raises(ComputeError, match="方阵"):
        accel.solve_dense(np.ones((2, 3)), np.ones(2))
    with pytest.raises(ComputeError, match="维度"):
        accel.solve_dense(np.eye(2), np.ones(3))
    with pytest.raises(ComputeError, match="NaN"):
        accel.solve_dense(np.array([[np.nan, 0.0], [0.0, 1.0]]), np.ones(2))


def test_gpu_policy_falls_back_without_cupy():
    # 本机没有 CuPy 时，请求 gpu 也必须给出明确的不可用状态而不是崩溃。
    status = accel.configure("gpu")
    assert status["policy"] == "gpu"
    matrix = np.eye(3)
    rhs = np.array([1.0, 2.0, 3.0])
    np.testing.assert_allclose(accel.solve_dense(matrix, rhs), rhs)
    report = accel.status()
    assert report["backend"] == "cpu"
    if not accel.available():
        assert report.get("gpu_error")
