"""AC 扫频的 Woodbury 影子路径（R43/P3）。

数学形式见 ``mathspec/experiments/ac_sweep_woodbury.py``：
对只含 R/C/L 与受控源的线性电路，AC MNA 矩阵可写成

    A(ω) = A0 + E · diag(Δg(ω)) · Eᵀ

其中 A0 = A(ω0)，每个无功元件（电容/电感）贡献一个秩一向量
（两端节点差，接地端省略）。一次 LU 分解后逐频点做 Woodbury 小解。

本模块是生产侧实现，默认不启用；``nodal.ac_sweep`` 只在
``NETLAB_MATH_ACCEL=shadow|on`` 时构造它。
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any, Sequence

import numpy as np

from .config import math_accel_mode  # noqa: F401  (re-export for convenience)

#: 小矩阵上 Python/Woodbury 的固定开销超过稠密直接解收益；实测 n<160 时
#: ``on`` 路径反而更慢（n=51/101 约 0.6–0.9×），故生产侧只在大矩阵启用。
AC_WOODBURY_MIN_SIZE = 160


@dataclass(frozen=True)
class ReactiveStamp:
    """一个无功元件的秩一贡献（a/b 为 MNA 未知量下标，None=地）。"""

    name: str
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


def collect_reactive_stamps(
    elements: Sequence[Any], index: dict[str, int]
) -> list[ReactiveStamp]:
    """从 ``CircuitSolver.elements`` 收集电容/电感的无功印章。"""
    stamps: list[ReactiveStamp] = []
    for element in elements:
        kind = getattr(element, "kind", "")
        if kind == "capacitor":
            value = float(getattr(element, "capacitance", 0.0))
            stamp_kind = "C"
        elif kind == "inductor":
            value = float(getattr(element, "inductance", 0.0))
            stamp_kind = "L"
        else:
            continue
        if value <= 0.0:
            continue
        a = index.get(getattr(element, "a", ""))
        b = index.get(getattr(element, "b", ""))
        if a is None and b is None:
            continue
        if a is not None and b is not None and a == b:
            continue
        stamps.append(
            ReactiveStamp(
                name=str(getattr(element, "name", stamp_kind)),
                a=a,
                b=b,
                kind=stamp_kind,
                value=value,
            )
        )
    return stamps


class ACWoodburySolver:
    """A0 的一次 LU 分解 + 无功元件仿射族（生产侧影子实现）。"""

    def __init__(
        self,
        a0: np.ndarray,
        stamps: Sequence[ReactiveStamp],
        omega0: float,
        *,
        max_ratio: float = 0.25,
        cond_limit: float = 1.0e10,
    ) -> None:
        a0 = np.asarray(a0, dtype=complex)
        if a0.ndim != 2 or a0.shape[0] != a0.shape[1]:
            raise ValueError("a0 必须是方阵")
        if not math.isfinite(omega0) or omega0 <= 0.0:
            raise ValueError("omega0 必须是正的有限数")
        self.size = a0.shape[0]
        self.stamps = tuple(stamps)
        self.omega0 = float(omega0)
        self.ratio = len(self.stamps) / float(self.size) if self.size else float("inf")
        self.usable = True
        self.reason = ""
        if not self.stamps:
            self.usable = False
            self.reason = "没有无功元件"
        if self.ratio > max_ratio:
            self.usable = False
            self.reason = f"r/n={self.ratio:.3f} > max_ratio={max_ratio:.3f}"
        self.e_matrix = (
            np.column_stack([stamp.vector(self.size) for stamp in self.stamps])
            if self.stamps
            else np.zeros((self.size, 0))
        )
        self.g0 = np.array([stamp.conductance(self.omega0) for stamp in self.stamps])
        # 调用方传入的是 A_const（不含无功元件）；A(ω0)=A_const+Σg0·eeᵀ。
        self.a0 = np.array(a0, dtype=complex, copy=True)
        for column, g in zip(self.e_matrix.T, self.g0):
            self.a0 += g * np.outer(column, column)
        self._lu = None
        self.cond_estimate = float("inf")
        self.min_pivot = 0.0
        if not self.usable:
            return
        try:
            from scipy.linalg import lu_factor

            self._lu = lu_factor(self.a0, check_finite=False)
            diagonal = np.abs(np.diag(self._lu[0]))
            max_pivot = float(diagonal.max()) if diagonal.size else 0.0
            self.min_pivot = float(diagonal.min()) if diagonal.size else 0.0
            self.cond_estimate = float(np.linalg.cond(self.a0))
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

    def _delta(self, omega: float) -> np.ndarray:
        return np.array(
            [stamp.conductance(omega) - g0 for stamp, g0 in zip(self.stamps, self.g0)]
        )

    def _apply(self, omega: float, vector: np.ndarray) -> np.ndarray:
        delta = self._delta(omega)
        result = self.a0 @ vector
        if np.any(delta != 0.0):
            result = result + self.e_matrix @ (delta * (self.e_matrix.T @ vector))
        return result

    def solve(
        self, omega: float, rhs: np.ndarray, *, refine_steps: int = 1
    ) -> np.ndarray:
        """求解 A(ω)x = rhs。"""
        if not self.usable or self._lu is None:
            raise ValueError(f"ACWoodburySolver 不可用：{self.reason}")
        from scipy.linalg import lu_solve

        rhs = np.asarray(rhs, dtype=complex)
        if rhs.shape != (self.size,):
            raise ValueError("rhs 维度与 A0 不一致")
        y = lu_solve(self._lu, rhs, check_finite=False)
        delta = self._delta(omega)
        active = np.abs(delta) > 0.0
        if np.any(active):
            columns = self.e_matrix[:, active]
            delta_active = delta[active]
            z = lu_solve(self._lu, columns, check_finite=False)
            small = np.diag(1.0 / delta_active) + columns.conj().T @ z
            solution = y - z @ np.linalg.solve(small, columns.conj().T @ y)
        else:
            solution = y
        for _ in range(max(0, int(refine_steps))):
            residual = rhs - self._apply(omega, solution)
            solution = solution + lu_solve(self._lu, residual, check_finite=False)
        return solution

    def summary(self) -> dict[str, Any]:
        return {
            "usable": self.usable,
            "reason": self.reason,
            "ratio": self.ratio,
            "n": self.size,
            "r": len(self.stamps),
            "omega0": self.omega0,
            "cond_estimate": self.cond_estimate,
            "min_pivot": self.min_pivot,
        }
