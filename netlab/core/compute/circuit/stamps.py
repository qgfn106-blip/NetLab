"""电路 MNA 盖章基础设施：常量、求解选项、节点上下文与盖章助手。

从 ``nodal.py`` 原样搬出（M 轮，逻辑零改动）；对外仍由 ``nodal`` 再导出。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
K_BOLTZMANN = 8.617333262e-5
MAX_NEWTON_ITERATIONS = 60
NEWTON_ABS_TOL = 1.0e-6
NEWTON_REL_TOL = 1.0e-9
MAX_ABS_VOLTAGE = 1.0e9


@dataclass(frozen=True)
class SolverOptions:
    """P0：可调收敛参数（默认保持旧行为，gmin 仅作为失败后的救急）。"""

    reltol: float = NEWTON_REL_TOL
    vntol: float = NEWTON_ABS_TOL
    abstol: float = NEWTON_ABS_TOL
    max_iter: int = MAX_NEWTON_ITERATIONS
    #: gmin stepping 的起始泄漏电导（每个 trial ×0.1，最终回到 0）。
    #: 默认保持旧行为：从 1e-3 开始递减；由 SimConfig.gmin 覆盖。
    gmin: float = 1.0e-3
    gmin_steps: int = 10
    src_steps: int = 10
    #: 0 = 不强制残差检查；>0 = 相对后向误差阈值（尺度无关）
    residual_tol: float = 0.0
    #: 未显式设置 residual_tol 时的安全阈值（防止明显错误的解进入 commit）。
    residual_safety_tol: float = 1.0e-8
    #: 行列均衡：降低“病态但可解”和“真奇异”的混淆。
    scaling: bool = True
    #: 缩放后 LU 的零主元判定阈值（相对最大主元）。
    pivot_tol: float = 1.0e-14
    #: 稀疏矩阵策略：auto=超过阈值自动切换、on=强制稀疏、off=强制稠密（R26/D53）。
    sparse: str = "auto"
    #: auto 模式下矩阵尺寸超过该值改用稀疏。当前 LIL 装配在 ≤400 节点反而更慢，
    #: 默认提高到 512，避免默认踩到负优化；显式 on/off 不受影响（P0）。
    sparse_threshold: int = 512
    #: 单步计算截止时刻（time.perf_counter 的单调时钟）；None 表示不限制。
    deadline: float | None = None


@dataclass(slots=True)
class CircuitNode:
    id: str
    name: str
    ground: bool = False


@dataclass
class StampContext:
    A: Any
    rhs: np.ndarray
    index: dict[str, int]
    solution: np.ndarray
    dt: float
    time: float
    iteration: int
    #: tran=瞬态、dc=直流工作点、ac=小信号交流（R26/D54–D56）。
    mode: str = "tran"
    #: 交流分析的角频率（rad/s）；mode="ac" 时由求解器逐点设置。
    omega: float = 0.0

    def voltage(self, node_id: str) -> float:
        position = self.index.get(node_id)
        return 0.0 if position is None else float(self.solution[position])


def stamp_laplacian(
    matrix: Any, index: Any, a: str, b: str, weight: Any
) -> None:
    """P1-R1: the single implementation of a two-terminal Laplacian stamp.

    Adds ``weight * [[1, -1], [-1, 1]]`` to the ``a``/``b`` rows and columns
    of ``matrix``. ``index`` maps node ids to row positions; a node missing
    from ``index`` is a ground node and its row/column is skipped.

    Both the Legacy MNA companion-model path
    (:mod:`netlab.core.compute.circuit.elements`) and the descriptor
    ``A + sE`` path (:mod:`netlab.core.compute.circuit.descriptor`) call this
    function. ``weight`` is deliberately NOT cast to float so that the Legacy
    AC path keeps complex admittances such as ``1j * omega * C``. Callers that
    write into a float matrix cast at the call site, exactly as before.

    This is a pure refactor: the four updates and their order are identical to
    the pre-convergence inline bodies. See P1_R1_STAMP_CONVERGENCE.md.
    """
    ai = index.get(a)
    bi = index.get(b)
    if ai is not None:
        matrix[ai, ai] += weight
    if bi is not None:
        matrix[bi, bi] += weight
    if ai is not None and bi is not None:
        matrix[ai, bi] -= weight
        matrix[bi, ai] -= weight


def _stamp_conductance(ctx: StampContext, a: str, b: str, g: float) -> None:
    """P0 compatibility entry point; delegates to :func:`stamp_laplacian`."""
    stamp_laplacian(ctx.A, ctx.index, a, b, g)


def _stamp_current(ctx: StampContext, a: str, b: str, value: float) -> None:
    """元件内部电流从 a 流向 b 时，对 KCL 右端的贡献。"""
    ai = ctx.index.get(a)
    bi = ctx.index.get(b)
    if ai is not None:
        ctx.rhs[ai] -= value
    if bi is not None:
        ctx.rhs[bi] += value
