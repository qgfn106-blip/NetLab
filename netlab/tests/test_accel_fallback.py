"""P2-04：GPU 数值异常必须回退 CPU，而不是直接抛错。"""

from __future__ import annotations

import numpy as np
import pytest

from netlab.core.compute import accel


class _FakeLinalg:
    def solve(self, matrix, rhs):
        return np.full(rhs.shape, np.inf, dtype=float)


class _FakeStream:
    def synchronize(self):
        return None


class _FakeCuda:
    class Stream:
        null = _FakeStream()


class _FakeGpu:
    """模拟 CuPy：asarray/asnumpy 恒等，solve 返回非有限值。"""

    linalg = _FakeLinalg()
    cuda = _FakeCuda()

    def asarray(self, value):
        return np.asarray(value)

    def asnumpy(self, value):
        return np.asarray(value)


def test_gpu_nonfinite_falls_back_to_cpu(monkeypatch):
    monkeypatch.delenv("NETLAB_ACCEL", raising=False)
    monkeypatch.setenv("NETLAB_ACCEL_GPU_MIN_SIZE", "16")
    monkeypatch.setattr(accel, "_GPU", _FakeGpu())
    monkeypatch.setattr(accel, "_GPU_CHECKED", True)
    monkeypatch.setattr(accel, "_GPU_ERROR", None)
    monkeypatch.setattr(accel, "_GPU_CALLS", 0)

    size = 16
    matrix = np.eye(size)
    rhs = np.ones(size)
    solution = accel.solve_dense(matrix, rhs, what="测试")

    assert np.allclose(solution, np.ones(size))
    assert accel.status()["last_backend"] == "cpu"
    assert "非有限" in (accel.status()["gpu_error"] or "")


def test_small_matrix_stays_on_cpu_even_with_gpu(monkeypatch):
    monkeypatch.delenv("NETLAB_ACCEL", raising=False)
    monkeypatch.setenv("NETLAB_ACCEL_GPU_MIN_SIZE", "192")
    monkeypatch.setattr(accel, "_GPU", _FakeGpu())
    monkeypatch.setattr(accel, "_GPU_CHECKED", True)
    monkeypatch.setattr(accel, "_GPU_ERROR", None)
    monkeypatch.setattr(accel, "_GPU_CALLS", 0)

    size = 16
    solution = accel.solve_dense(np.eye(size), np.ones(size), what="小矩阵")

    assert np.allclose(solution, np.ones(size))
    assert accel.status()["last_backend"] == "cpu"
    assert accel.status()["gpu_calls"] == 0


def test_nonfinite_input_rejected_before_gpu():
    from netlab.core.common.limits import ComputeError

    matrix = np.eye(4)
    rhs = np.ones(4)
    rhs[0] = np.nan
    with pytest.raises(ComputeError):
        accel.solve_dense(matrix, rhs, what="非有限输入")


def test_cpu_singular_raises_compute_error():
    from netlab.core.common.limits import ComputeError

    with pytest.raises(ComputeError):
        accel.solve_dense(np.zeros((4, 4)), np.ones(4), what="奇异测试")


def test_invalid_shape_rejected():
    from netlab.core.common.limits import ComputeError

    with pytest.raises(ComputeError):
        accel.solve_dense(np.ones((3, 2)), np.ones(3), what="形状测试")
