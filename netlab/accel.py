"""可选加速后端：CPU（NumPy）与 GPU（CuPy，若已安装）。

设计原则
--------
* **单步内同步**：GPU 只用于一次线性代数调用，结果回拷到主机后才提交状态，
  不做跨步异步，不改变节点求值顺序。
* **规模门控**：小矩阵在 GPU 上通常因为 kernel 启动与 H2D/D2H 拷贝而更慢，
  因此只有规模达到 ``GPU_MIN_SIZE`` 且 CuPy + CUDA 可用时才尝试 GPU。
* **自动回退**：任何 GPU 初始化、显存或数值异常都会退回 CPU，并在
  :func:`status` 中记录原因；调用方无需捕获后端异常。
* **可审计**：记录最近一次使用的后端、后端调用次数与最近耗时，供
  ``/api/catalog`` 的性能面板显示。

通过环境变量 ``NETLAB_ACCEL=auto|cpu|gpu`` 选择策略（默认 ``auto``）。
``gpu`` 只是“优先尝试”，缺少 CuPy/CUDA 时仍会安全回退到 CPU。
"""

from __future__ import annotations

import math
import os
import threading
import time
from typing import Any

import numpy as np

from .limits import ComputeError

DEFAULT_GPU_MIN_SIZE = 192
_POLICY = "auto"
_GPU: Any | None = None
_GPU_ERROR: str | None = None
_GPU_CHECKED = False
_LAST_BACKEND = "cpu"
_LAST_MS = 0.0
_CALLS = 0
_GPU_CALLS = 0
_LOCK = threading.RLock()


def _policy() -> str:
    raw = os.environ.get("NETLAB_ACCEL", _POLICY).strip().lower()
    if raw in ("auto", "cpu", "gpu"):
        return raw
    return "auto"


def _gpu_min_size() -> int:
    try:
        raw = int(os.environ.get("NETLAB_ACCEL_GPU_MIN_SIZE", DEFAULT_GPU_MIN_SIZE))
    except (TypeError, ValueError):
        return DEFAULT_GPU_MIN_SIZE
    return max(16, min(8192, raw))


def _probe_gpu() -> Any | None:
    """惰性探测 CuPy/CUDA；失败只记录原因，不抛异常。"""
    global _GPU, _GPU_ERROR, _GPU_CHECKED
    with _LOCK:
        if _GPU_CHECKED:
            return _GPU
        _GPU_CHECKED = True
        if _policy() == "cpu":
            _GPU_ERROR = "NETLAB_ACCEL=cpu"
            return None
        try:
            import cupy as cp  # type: ignore[import-not-found]

            device = cp.cuda.Device(0)
            device.use()
            # 触发一次真实分配，尽早暴露驱动/权限问题。
            probe = cp.zeros((2, 2), dtype=cp.float64)
            cp.cuda.Stream.null.synchronize()
            del probe
            _GPU = cp
            _GPU_ERROR = None
        except Exception as exc:  # pragma: no cover - 依赖本机 GPU 环境
            _GPU = None
            _GPU_ERROR = f"{type(exc).__name__}: {exc}"
    return _GPU


def configure(policy: str | None = None) -> dict[str, Any]:
    """设置加速策略并返回当前状态；``policy`` 为 ``None`` 时只读。"""
    global _POLICY, _GPU_CHECKED, _GPU, _GPU_ERROR
    with _LOCK:
        if policy is not None:
            value = str(policy).strip().lower()
            if value not in ("auto", "cpu", "gpu"):
                raise ComputeError("加速策略必须是 auto / cpu / gpu")
            _POLICY = value
            _GPU_CHECKED = False
            _GPU = None
            _GPU_ERROR = None
        _probe_gpu()
        return status()


def reset_probe() -> None:
    """测试辅助：清空后端探测缓存。"""
    global _GPU_CHECKED, _GPU, _GPU_ERROR
    with _LOCK:
        _GPU_CHECKED = False
        _GPU = None
        _GPU_ERROR = None


def status() -> dict[str, Any]:
    with _LOCK:
        _probe_gpu()
        return {
            "policy": _policy(),
            "backend": "gpu" if _GPU is not None else "cpu",
            "gpu_available": _GPU is not None,
            "gpu_error": _GPU_ERROR,
            "gpu_min_size": _gpu_min_size(),
            "last_backend": _LAST_BACKEND,
            "last_ms": round(_LAST_MS, 6),
            "calls": _CALLS,
            "gpu_calls": _GPU_CALLS,
        }


def available() -> bool:
    return _probe_gpu() is not None


def _begin() -> float:
    return time.perf_counter()


def _finish(started: float, backend: str) -> None:
    global _LAST_BACKEND, _LAST_MS, _CALLS, _GPU_CALLS
    with _LOCK:
        _CALLS += 1
        if backend == "gpu":
            _GPU_CALLS += 1
        _LAST_BACKEND = backend
        _LAST_MS = (time.perf_counter() - started) * 1000.0


def to_cpu(array: Any) -> np.ndarray:
    """把 CuPy / NumPy 数组统一成主机上的 NumPy 数组。"""
    if _GPU is not None and isinstance(array, _GPU.ndarray):  # pragma: no cover
        return np.asarray(_GPU.asnumpy(array), dtype=float)
    return np.asarray(array, dtype=float)


def synchronize() -> None:
    """显式同步设备；CPU 路径为空操作。"""
    if _GPU is not None:  # pragma: no cover - 依赖本机 GPU
        _GPU.cuda.Stream.null.synchronize()


def matmul(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    """矩阵乘法；大矩阵且 GPU 可用时使用 GPU，结果同步回主机。"""
    started = _begin()
    left = np.asarray(left, dtype=float)
    right = np.asarray(right, dtype=float)
    gpu = _probe_gpu()
    if gpu is not None and _policy() != "cpu" and max(left.shape + right.shape) >= _gpu_min_size():
        try:  # pragma: no cover - 依赖本机 GPU
            out = gpu.asnumpy(gpu.asarray(left) @ gpu.asarray(right))
            synchronize()
            _finish(started, "gpu")
            return np.asarray(out, dtype=float)
        except Exception as exc:
            _record_gpu_failure(exc)
    result = left @ right
    _finish(started, "cpu")
    return result


def solve_dense(
    matrix: np.ndarray,
    rhs: np.ndarray,
    *,
    what: str = "线性方程组",
) -> np.ndarray:
    """求解 ``A x = b``；GPU 失败或规模不足时使用 NumPy。

    调用方拿到的一定是主机上的 NumPy 数组，且只在返回后才提交状态。
    """
    started = _begin()
    matrix = np.asarray(matrix, dtype=float)
    rhs = np.asarray(rhs, dtype=float)
    if matrix.ndim != 2 or matrix.shape[0] != matrix.shape[1]:
        raise ComputeError(f"{what}系数矩阵必须是方阵")
    if rhs.ndim not in (1, 2) or rhs.shape[0] != matrix.shape[0]:
        raise ComputeError(f"{what}右端向量维度不匹配")
    if not np.all(np.isfinite(matrix)) or not np.all(np.isfinite(rhs)):
        raise ComputeError(f"{what}包含 NaN 或无穷大")
    gpu = _probe_gpu()
    if (
        gpu is not None
        and _policy() != "cpu"
        and matrix.shape[0] >= _gpu_min_size()
    ):
        try:  # pragma: no cover - 依赖本机 GPU
            device_matrix = gpu.asarray(matrix)
            device_rhs = gpu.asarray(rhs)
            out = gpu.asnumpy(gpu.linalg.solve(device_matrix, device_rhs))
            synchronize()
            solution = np.asarray(out, dtype=float)
            if not np.all(np.isfinite(solution)):
                raise ComputeError(f"{what}在 GPU 上解出非有限数值")
            _finish(started, "gpu")
            return solution
        except ComputeError:
            raise
        except Exception as exc:
            _record_gpu_failure(exc)
    try:
        solution = np.linalg.solve(matrix, rhs)
    except np.linalg.LinAlgError as exc:
        raise ComputeError(
            f"{what}的系数矩阵奇异：可能有悬空节点（没有接参考地）"
            "或者理想电压源形成回路"
        ) from exc
    if not np.all(np.isfinite(solution)):
        raise ComputeError(f"{what}解出了非有限数值，请检查参数")
    _finish(started, "cpu")
    return solution


def _record_gpu_failure(exc: Exception) -> None:
    global _GPU_ERROR
    with _LOCK:
        _GPU_ERROR = f"{type(exc).__name__}: {exc}"
