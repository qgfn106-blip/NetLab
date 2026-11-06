"""AC 扫频双参数仿射族 + Woodbury 求解（M0 原型）。

数学形式
--------
对只含 R/C/L 与受控源的线性电路，AC 小信号 MNA 矩阵可写成

    A(ω) = A_const + Σ_k g_k(ω) · e_k e_kᵀ

其中 ``e_k`` 是第 k 个电容/电感两端的节点差向量（接地端省略），

    g_C(ω) = jωC,      g_L(ω) = 1 / (jωL).

取参考频点 ω0，令 ``A0 = A(ω0)``、``Δg_k(ω) = g_k(ω) - g_k(ω0)``，则

    A(ω) = A0 + E · diag(Δg(ω)) · Eᵀ.

对每个频点用 Woodbury 恒等式：

    A⁻¹b = A0⁻¹b - A0⁻¹E (diag(Δg)⁻¹ + EᵀA0⁻¹E)⁻¹ EᵀA0⁻¹b.

因此只需一次 O(n³) 的 A0 分解，逐频点只做 O(nr + r³) 的回代与小解。

本模块是零耦合参考实现：只依赖 numpy/scipy，不 import netlab。
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Iterable, Sequence

import numpy as np
from scipy.linalg import lu_factor, lu_solve


@dataclass(frozen=True)
class ReactiveStamp:
    """一个电容/电感对 MNA 矩阵的秩一贡献描述。

    ``a`` / ``b`` 为未知量下标；``None`` 表示地（不产生该位置的自由度）。
    ``kind`` 为 ``"C"``（电容）或 ``"L"``（电感）；``value`` 为 C/L 的数值。
    """

    a: int | None
    b: int | None
    kind: str
    value: float

    def vector(self, size: int) -> np.ndarray:
        vector = np.zeros(size, dtype=float)
        if self.a is not None:
            vector[self.a] += 1.0
        if self.b is not None:
            vector[self.b] -= 1.0
        return vector

    def conductance(self, omega: float) -> complex:
        if not math.isfinite(omega) or omega <= 0.0:
            raise ValueError("omega 必须是正的有限数")
        if self.kind == "C":
            return 1j * omega * self.value
        if self.kind == "L":
            return 1.0 / (1j * omega * self.value)
        raise ValueError(f"未知无功元件类型：{self.kind!r}")


def rank_ratio(stamps: Sequence[ReactiveStamp], size: int) -> float:
    """无功元件数 / MNA 未知量数。"""
    if size <= 0:
        raise ValueError("size 必须为正整数")
    return len(stamps) / float(size)


def conductance_matrix(
    base: np.ndarray, stamps: Sequence[ReactiveStamp], omega: float
) -> np.ndarray:
    """直接装配 A(ω) = base + Σ g_k(ω) e_k e_kᵀ。"""
    matrix = np.array(base, dtype=complex, copy=True)
    size = matrix.shape[0]
    for stamp in stamps:
        vector = stamp.vector(size)
        matrix += stamp.conductance(omega) * np.outer(vector, vector)
    return matrix


class WoodburyFamily:
    """A0 的一次分解 + 无功元件仿射族。"""

    def __init__(
        self,
        base: np.ndarray,
        stamps: Sequence[ReactiveStamp],
        omega0: float,
        *,
        max_ratio: float = 0.25,
        cond_limit: float = 1.0e12,
    ) -> None:
        base = np.asarray(base, dtype=complex)
        if base.ndim != 2 or base.shape[0] != base.shape[1]:
            raise ValueError("base 必须是方阵")
        if not math.isfinite(omega0) or omega0 <= 0.0:
            raise ValueError("omega0 必须是正的有限数")
        if not stamps:
            raise ValueError("至少需要一个无功元件")
        self.size = base.shape[0]
        self.stamps = tuple(stamps)
        self.omega0 = float(omega0)
        self.ratio = rank_ratio(self.stamps, self.size)
        self.usable = True
        self.reason = ""
        if self.ratio > max_ratio:
            self.usable = False
            self.reason = f"r/n={self.ratio:.3f} > max_ratio={max_ratio:.3f}"
        columns = [stamp.vector(self.size) for stamp in self.stamps]
        self.e_matrix = (
            np.column_stack(columns) if columns else np.zeros((self.size, 0))
        )
        self.g0 = np.array([stamp.conductance(self.omega0) for stamp in self.stamps])
        self.a0 = np.array(base, dtype=complex, copy=True)
        for column, g in zip(self.e_matrix.T, self.g0):
            self.a0 += g * np.outer(column, column)
        try:
            self._lu = lu_factor(self.a0, check_finite=False)
            diagonal = np.abs(np.diag(self._lu[0]))
            max_pivot = float(diagonal.max()) if diagonal.size else 0.0
            self.cond_estimate = float(np.linalg.cond(self.a0))
            self.min_pivot = float(diagonal.min()) if diagonal.size else 0.0
            if not np.all(np.isfinite(self.a0)):
                self.usable = False
                self.reason = "A0 含非有限值"
            elif max_pivot == 0.0 or self.min_pivot < 1.0e-14 * max(1.0, max_pivot):
                self.usable = False
                self.reason = "A0 主元过小"
            elif (
                not math.isfinite(self.cond_estimate) or self.cond_estimate > cond_limit
            ):
                self.usable = False
                self.reason = f"A0 条件数 {self.cond_estimate:.3g} > {cond_limit:.0e}"
        except (ValueError, np.linalg.LinAlgError) as exc:
            self.usable = False
            self.reason = f"A0 分解失败：{exc}"
            self._lu = None
            self.cond_estimate = float("inf")
            self.min_pivot = 0.0

    def _apply(self, omega: float, vector: np.ndarray) -> np.ndarray:
        """计算 A(ω)·vector（用于残差修正，O(n² + nr)）。"""
        delta = np.array(
            [stamp.conductance(omega) - g0 for stamp, g0 in zip(self.stamps, self.g0)]
        )
        result = self.a0 @ vector
        if np.any(delta != 0.0):
            result = result + self.e_matrix @ (delta * (self.e_matrix.T @ vector))
        return result

    def solve(
        self, omega: float, rhs: np.ndarray, *, refine_steps: int = 1
    ) -> np.ndarray:
        """用 Woodbury 恒等式求解 A(ω)x = rhs。

        ``refine_steps`` 用同一 LU 做迭代残差修正，抵消远频点的消去误差；
        每步只多一次 O(n²) 矩阵-向量乘与一次 O(n²) 回代。
        """
        if not self.usable or self._lu is None:
            raise ValueError(f"WoodburyFamily 不可用：{self.reason}")
        rhs = np.asarray(rhs, dtype=complex)
        if rhs.shape != (self.size,):
            raise ValueError("rhs 维度与 A0 不一致")
        y = lu_solve(self._lu, rhs, check_finite=False)
        delta = np.array(
            [stamp.conductance(omega) - g0 for stamp, g0 in zip(self.stamps, self.g0)]
        )
        active = np.abs(delta) > 0.0
        if not np.any(active):
            solution = y
        else:
            columns = self.e_matrix[:, active]
            delta_active = delta[active]
            z = lu_solve(self._lu, columns, check_finite=False)
            small = np.diag(1.0 / delta_active) + columns.conj().T @ z
            correction = z @ np.linalg.solve(small, columns.conj().T @ y)
            solution = y - correction
        for _ in range(max(0, int(refine_steps))):
            residual = rhs - self._apply(omega, solution)
            solution = solution + lu_solve(self._lu, residual, check_finite=False)
        return solution


def ac_sweep_woodbury(
    base: np.ndarray,
    stamps: Sequence[ReactiveStamp],
    frequencies: Sequence[float],
    rhs: np.ndarray,
    *,
    omega0: float | None = None,
    max_ratio: float = 0.25,
) -> tuple[list[np.ndarray], WoodburyFamily]:
    """对一组频率做 Woodbury 扫描，返回各频点解与 family。"""
    freqs = [float(f) for f in frequencies]
    if not freqs:
        raise ValueError("至少需要一个频率点")
    if any(not math.isfinite(f) or f <= 0.0 for f in freqs):
        raise ValueError("频率必须是正的有限数")
    if omega0 is None:
        omega0 = 2.0 * math.pi * math.sqrt(freqs[0] * freqs[-1])
    family = WoodburyFamily(base, stamps, omega0, max_ratio=max_ratio)
    solutions = [family.solve(2.0 * math.pi * frequency, rhs) for frequency in freqs]
    return solutions, family
