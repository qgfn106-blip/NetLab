"""数值内核：稳定求解、矩阵指数、连续系统离散化。

只依赖 NumPy；``expm`` 使用 Higham 的 13 阶 Padé 缩放平方算法，精度足以
支撑状态空间与 ZOH 离散化，不必引入 SciPy 运行时依赖。
"""

from __future__ import annotations

import math

import numpy as np

from . import accel
from .limits import ComputeError

_PADE13 = (
    64764752532480000.0,
    32382376266240000.0,
    7771770303897600.0,
    1187353796428800.0,
    129060195264000.0,
    10559470521600.0,
    670442572800.0,
    33522128640.0,
    1323241920.0,
    40840800.0,
    960960.0,
    16380.0,
    182.0,
    1.0,
)
_THETA13 = 5.371920351148152


def as_array(value, name: str, *, ndim: int = 2, max_size: int = 12) -> np.ndarray:
    """把嵌套列表转成有限浮点数组，并检查形状与规模。"""
    try:
        array = np.asarray(value, dtype=float)
    except (TypeError, ValueError) as exc:
        raise ComputeError(f"{name} 不是有效数值数组") from exc
    if array.ndim != ndim:
        raise ComputeError(f"{name} 必须是 {ndim} 维数组")
    if array.size == 0:
        raise ComputeError(f"{name} 不能为空")
    if array.shape[0] > max_size or (ndim == 2 and array.shape[1] > max_size):
        raise ComputeError(f"{name} 的维度不能超过 {max_size}")
    if not np.all(np.isfinite(array)):
        raise ComputeError(f"{name} 含有 NaN 或无穷大")
    if np.max(np.abs(array)) > 1.0e12:
        raise ComputeError(f"{name} 的数值过大")
    return array


def solve_linear(matrix: np.ndarray, rhs: np.ndarray, *, what: str = "线性方程组") -> np.ndarray:
    """求解 A x = b；奇异时给出可读错误，避免返回垃圾值。"""
    matrix = np.asarray(matrix, dtype=float)
    rhs = np.asarray(rhs, dtype=float)
    if matrix.shape[0] != matrix.shape[1] or matrix.shape[0] != rhs.shape[0]:
        raise ComputeError(f"{what}系数矩阵维度不匹配")
    # accel 在内部决定 CPU/GPU；返回前已同步，调用方可以安全提交状态。
    return accel.solve_dense(matrix, rhs, what=what)


def inverse(matrix: np.ndarray, *, what: str = "矩阵") -> np.ndarray:
    matrix = np.asarray(matrix, dtype=float)
    identity = np.eye(matrix.shape[0])
    try:
        return np.linalg.solve(matrix, identity)
    except np.linalg.LinAlgError as exc:
        raise ComputeError(f"{what}不可逆：{exc}") from exc


def expm(matrix: np.ndarray) -> np.ndarray:
    """矩阵指数（缩放 + 13 阶 Padé 平方）。"""
    matrix = np.asarray(matrix, dtype=float)
    if matrix.ndim != 2 or matrix.shape[0] != matrix.shape[1]:
        raise ComputeError("expm 需要方阵")
    size = matrix.shape[0]
    if size == 0:
        return np.zeros((0, 0))
    norm = float(np.max(np.sum(np.abs(matrix), axis=1)))
    if norm == 0.0:
        return np.eye(size)
    scale = max(0, int(math.ceil(math.log2(norm / _THETA13)))) if norm > _THETA13 else 0
    a = matrix / (2.0**scale)
    identity = np.eye(size)
    a2 = a @ a
    a4 = a2 @ a2
    a6 = a2 @ a4
    b = _PADE13
    u = a @ (
        a6 @ (b[13] * a6 + b[11] * a4 + b[9] * a2)
        + b[7] * a6
        + b[5] * a4
        + b[3] * a2
        + b[1] * identity
    )
    v = (
        a6 @ (b[12] * a6 + b[10] * a4 + b[8] * a2)
        + b[6] * a6
        + b[4] * a4
        + b[2] * a2
        + b[0] * identity
    )
    result = solve_linear(v - u, v + u, what="矩阵指数求解")
    for _ in range(scale):
        result = result @ result
    return result


def zoh_discretize(a: np.ndarray, b: np.ndarray, dt: float) -> tuple[np.ndarray, np.ndarray]:
    """零阶保持离散化：x[k+1] = Ad x[k] + Bd u[k]。"""
    a = as_array(a, "A 矩阵", max_size=12)
    b = as_array(b, "B 矩阵", max_size=12)
    if a.shape[0] != a.shape[1] or b.shape[0] != a.shape[0]:
        raise ComputeError("A、B 矩阵维度不匹配")
    n, m = b.shape
    augmented = np.zeros((n + m, n + m))
    augmented[:n, :n] = a
    augmented[:n, n:] = b
    exponential = expm(augmented * dt)
    return exponential[:n, :n], exponential[:n, n:]


def cont2discrete(
    a: np.ndarray,
    b: np.ndarray,
    c: np.ndarray,
    d: np.ndarray,
    dt: float,
    method: str = "zoh",
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """把连续状态空间模型离散化；支持 zoh / forward / backward / tustin。"""
    a = as_array(a, "A 矩阵")
    b = as_array(b, "B 矩阵")
    c = as_array(c, "C 矩阵")
    d = as_array(d, "D 矩阵")
    n, m = b.shape
    if a.shape != (n, n) or c.shape[1] != n or d.shape != (c.shape[0], m):
        raise ComputeError("状态空间矩阵维度不匹配")
    if not math.isfinite(dt) or dt <= 0:
        raise ComputeError("dt 必须为正数")

    if method == "zoh":
        ad, bd = zoh_discretize(a, b, dt)
        return ad, bd, c.copy(), d.copy()
    if method == "forward":
        return np.eye(n) + dt * a, dt * b, c.copy(), d.copy()
    if method == "backward":
        m_inv = inverse(np.eye(n) - dt * a, what="(I - dt·A)")
        ad = m_inv
        bd = m_inv @ b * dt
        return ad, bd, c.copy(), d.copy()
    if method == "tustin":
        half = 0.5 * dt
        m_inv = inverse(np.eye(n) - half * a, what="(I - dt/2·A)")
        ad = m_inv @ (np.eye(n) + half * a)
        bd = m_inv @ b * dt
        cd = c @ m_inv
        dd = d + half * (c @ m_inv @ b)
        return ad, bd, cd, dd
    raise ComputeError(f"未知的离散化方法：{method!r}")


def tustin_tf(numerator, denominator, dt: float) -> tuple[np.ndarray, np.ndarray]:
    """双线性变换把连续 H(s) 转为 H(z)，返回按 z⁻¹ 升幂的 ``(b, a)``。

    返回值的含义是 ``H(z) = (b0 + b1·z⁻¹ + …) / (1 + a1·z⁻¹ + …)``，
    可直接用于直接 II 型转置的递推；``a[0]`` 恒为 1。
    """
    num = np.asarray(numerator, dtype=float).ravel()
    den = np.asarray(denominator, dtype=float).ravel()
    if num.size == 0 or den.size == 0:
        raise ComputeError("传递函数系数不能为空")
    if not np.all(np.isfinite(num)) or not np.all(np.isfinite(den)):
        raise ComputeError("传递函数系数必须是有限数值")
    if abs(den[0]) < 1e-300:
        raise ComputeError("传递函数分母首项不能为 0")
    num = num / den[0]
    den = den / den[0]
    degree = max(num.size, den.size) - 1
    alpha = 2.0 / dt
    # 输入是降幂系数，左侧补零对齐到 degree 次。
    num = np.pad(num, (degree + 1 - num.size, 0))
    den = np.pad(den, (degree + 1 - den.size, 0))

    # s = alpha * (1 - z) / (1 + z)；通分到 (1+z)^degree。
    def substitute(poly: np.ndarray) -> np.ndarray:
        result = np.zeros(degree + 1)
        for index, coefficient in enumerate(poly):
            power = degree - index  # 降幂数组的下标对应 s 的幂次
            if coefficient == 0.0:
                continue
            term = coefficient * (alpha**power) * np.array([1.0])
            # (1 - z)^power
            for _ in range(power):
                term = np.convolve(term, np.array([1.0, -1.0]))
            # (1 + z)^(degree - power)
            for _ in range(degree - power):
                term = np.convolve(term, np.array([1.0, 1.0]))
            if term.size < result.size:
                term = np.pad(term, (0, result.size - term.size))
            result += term
        return result

    b_poly = substitute(num)
    a_poly = substitute(den)
    # a_poly 是按 z⁰、z¹… 升幂排列的分母；递推要求 a[0] = 1。
    scale = a_poly[0]
    if abs(scale) < 1e-300:
        raise ComputeError("双线性变换后分母常数项为 0")
    return b_poly / scale, a_poly / scale


def power_iteration_norm(matrix: np.ndarray, iterations: int = 12) -> float:
    """粗估谱范数，用于界面展示（不做精确 SVD）。"""
    matrix = np.asarray(matrix, dtype=float)
    if matrix.size == 0:
        return 0.0
    vector = np.ones(matrix.shape[1]) / math.sqrt(matrix.shape[1])
    norm = 0.0
    for _ in range(iterations):
        probe = matrix @ vector
        norm = float(np.linalg.norm(probe))
        if norm == 0.0:
            return 0.0
        vector = probe / norm
    return norm
