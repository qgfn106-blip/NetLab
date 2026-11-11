"""线性 Descriptor 系统的极点与传输零点分析（M4.1 / M4.3）。

本模块只读取 :class:`~netlab.core.compute.circuit.descriptor.DescriptorModel`
已经装配好的 ``A``、``E`` 矩阵，不修改 ``descriptor.py``。

描述符形式为::

    E ẋ + A x = B u
    y = C x + D u

M4.1 极点
---------
极点满足 ``det(A + sE) = 0``。等价地，令 ``(-A) v = s E v``，用
``scipy.linalg.eig(-A, E, homogeneous_eigvals=True)`` 求广义特征值。使用
齐次特征值 ``(alpha, beta)`` 可以可靠地区分：

* ``beta != 0``：有限极点 ``s = alpha / beta``；
* ``beta == 0``：无穷远极点，表示非真（improper）或无阻尼的代数约束。

直接调用 ``eig(A, E)`` 在 ``E`` 奇异时会产生 ``inf`` 并触发除零警告，因此本
模块统一使用齐次形式。每个有限极点都返回归一化残差
``||A v + s E v|| / (||A|| ||v|| + |s| ||E|| ||v|| + eps)``。

M4.3 传输零点
-------------
SISO 传输零点满足 Rosenbrock 矩阵行列式为零::

    det([[A + sE, -B],
         [C,       D]]) = 0

令 ``P0 = [[A, -B], [C, D]]``、``P1 = [[E, 0], [0, 0]]``，则
``det(P0 + s P1) = 0``。用 ``eig(-P0, P1, homogeneous_eigvals=True)`` 求
``s``，同样以 ``beta != 0`` 判定有限零点。

当前只实现 SISO（单输入、单输出）。MIMO 传输零点涉及 Rosenbrock 矩阵的
Kronecker 结构，尚未实现，会显式抛出 :class:`UnsupportedAnalysisError`。

探针与输出矩阵
--------------
:class:`DescriptorSystem` 只包含 ``B``，不包含 ``C`` / ``D``。本模块提供
:func:`build_output_matrices`，把 ``DescriptorModel`` 的节点电压探针、支路
电流探针（电阻/开关/电感/电压源/VCVS/VCCS/电流源）转换为 ``C``、``D``。
电容电流探针含微分项 ``sC(v_a-v_b)``，不能写成静态的 ``Cx + Du``，因此
显式报不支持。

典型用法::

    from netlab.core.compute.circuit.descriptor import DescriptorModel
    from netlab.core.compute.circuit.descriptor_analysis import (
        descriptor_poles,
        descriptor_zeros,
    )

    model = DescriptorModel.from_scene(scene)
    poles = descriptor_poles(model)
    zeros = descriptor_zeros(model, input_source="V1", output="out")
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy import linalg

from ...common.limits import ComputeError, ValidationError
from .descriptor import DescriptorModel, DescriptorSystem

_EPS = float(np.finfo(float).eps)

#: 齐次特征值中 ``beta`` 相对 ``max(|alpha|, |beta|)`` 的判定阈值。使用
#: 相对阈值可避免电路参数整体缩放（例如 pF/nH 量级）被误判为无穷远特征值。
_FINITE_BETA_TOL = 100.0 * float(np.finfo(float).eps)

#: 正则性检查的容差放大系数（相对机器精度）。
_REGULARITY_FACTOR = 100.0


class UnsupportedAnalysisError(ComputeError, NotImplementedError):
    """分析能力尚未实现的限制。

    同时继承 :class:`ComputeError`（业务层可按 422 处理）与
    :class:`NotImplementedError`（库调用方可按"未实现"捕获），使两套调用
    约定都得到明确信号。
    """


@dataclass(frozen=True)
class PoleResult:
    """M4.1 极点分析结果。

    Attributes:
        finite_poles: 有限极点（复数组），按实部、虚部排序。
        residuals: 与 ``finite_poles`` 一一对应的归一化残差。
        infinite_count: 无穷远极点的个数。
        size: 描述符状态维数（``A`` 的阶数）。
        regular: 铅笔是否正则；只有正则时该结果才可能返回。
    """

    finite_poles: np.ndarray
    residuals: np.ndarray
    infinite_count: int
    size: int
    regular: bool = True

    @property
    def finite_count(self) -> int:
        """有限极点个数。"""
        return int(self.finite_poles.size)

    @property
    def poles(self) -> np.ndarray:
        """``finite_poles`` 的别名。"""
        return self.finite_poles

    @property
    def max_residual(self) -> float:
        """最大归一化残差；没有有限极点时为 0。"""
        return float(np.max(self.residuals)) if self.residuals.size else 0.0


@dataclass(frozen=True)
class ZeroResult:
    """M4.3 传输零点分析结果（SISO）。

    Attributes:
        finite_zeros: 有限传输零点（复数组），按实部、虚部排序。
        residuals: 与 ``finite_zeros`` 一一对应的归一化残差。
        infinite_count: 无穷远零点个数（Rosenbrock 铅笔的无穷特征值）。
        size: 描述符状态维数 ``n``；Rosenbrock 铅笔阶数为 ``n + 1``。
        regular: Rosenbrock 铅笔是否正则。
        siso: 是否按 SISO 求解；当前恒为 True。
    """

    finite_zeros: np.ndarray
    residuals: np.ndarray
    infinite_count: int
    size: int
    regular: bool = True
    siso: bool = True

    @property
    def finite_count(self) -> int:
        """有限零点个数。"""
        return int(self.finite_zeros.size)

    @property
    def zeros(self) -> np.ndarray:
        """``finite_zeros`` 的别名。"""
        return self.finite_zeros

    @property
    def max_residual(self) -> float:
        """最大归一化残差；没有有限零点时为 0。"""
        return float(np.max(self.residuals)) if self.residuals.size else 0.0


# ---------------------------------------------------------------------------
# 校验与通用工具
# ---------------------------------------------------------------------------


def _as_square_matrix(value: Any, name: str) -> np.ndarray:
    """把输入转为有限值的二维复方阵。"""
    try:
        matrix = np.asarray(value, dtype=np.complex128)
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{name} 必须是数值矩阵") from exc
    if matrix.ndim != 2:
        raise ValidationError(f"{name} 必须是二维矩阵，实际维度为 {matrix.ndim}")
    if matrix.shape[0] != matrix.shape[1]:
        raise ValidationError(f"{name} 必须是方阵，实际形状为 {matrix.shape}")
    if matrix.size == 0:
        raise ValidationError(f"{name} 不能是空矩阵")
    if not np.all(np.isfinite(matrix)):
        raise ValidationError(f"{name} 包含 NaN 或 Inf")
    return matrix


def _coerce_pencil(source: Any, E: Any | None) -> tuple[np.ndarray, np.ndarray]:
    """接受 ``(A, E)``、``DescriptorModel`` 或 ``DescriptorSystem``。"""
    if E is None and hasattr(source, "A") and hasattr(source, "E"):
        A = _as_square_matrix(getattr(source, "A"), "A")
        E_matrix = _as_square_matrix(getattr(source, "E"), "E")
    else:
        A = _as_square_matrix(source, "A")
        if E is None:
            E_matrix = np.eye(A.shape[0], dtype=np.complex128)
        else:
            E_matrix = _as_square_matrix(E, "E")
    if A.shape != E_matrix.shape:
        raise ValidationError(
            f"A 与 E 的形状必须一致，实际为 {A.shape} 和 {E_matrix.shape}"
        )
    return A, E_matrix


def _matrix_norm(matrix: np.ndarray) -> float:
    """矩阵的 Frobenius 范数（空矩阵返回 0）。"""
    return float(np.linalg.norm(matrix))


def _normalized_pole_residual(
    A: np.ndarray, E: np.ndarray, pole: complex, vector: np.ndarray
) -> float:
    """单对广义特征值的归一化残差（极点满足 ``(A + sE) v = 0``）。"""
    lhs = A @ vector + pole * (E @ vector)
    denominator = (
        _matrix_norm(A) * float(np.linalg.norm(vector))
        + abs(pole) * _matrix_norm(E) * float(np.linalg.norm(vector))
        + _EPS
    )
    return float(np.linalg.norm(lhs) / denominator)


def _normalized_zero_residual(
    P0: np.ndarray, P1: np.ndarray, zero: complex, vector: np.ndarray
) -> float:
    """Rosenbrock 铅笔单对广义特征值的归一化残差。"""
    lhs = P0 @ vector + zero * (P1 @ vector)
    denominator = (
        (_matrix_norm(P0) + abs(zero) * _matrix_norm(P1))
        * float(np.linalg.norm(vector))
        + _EPS
    )
    return float(np.linalg.norm(lhs) / denominator)


def _sorted_eigenpairs(
    values: np.ndarray, vectors: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """按 ``(实部, 虚部)`` 排序特征值与对应特征向量列。"""
    if values.size == 0:
        return values, vectors
    order = np.lexsort((values.imag, values.real))
    return values[order], vectors[:, order]


def is_regular_pencil(source: Any, E: Any | None = None) -> bool:
    """检查矩阵铅笔 ``(A, E)`` 是否正则。

    矩阵铅笔正则当且仅当 ``det(A + sE)`` 不恒为零。这里使用复数 QZ 分解
    ``A = Q AA Z^H``、``E = Q BB Z^H``：若存在对角对 ``(AA_ii, BB_ii)``
    同时为零，则铅笔奇异；正则铅笔不会出现 ``(0, 0)`` 特征值对。

    参数:
        source: ``(A, E)`` 中的 ``A``，或带 ``A``/``E`` 属性的
            :class:`DescriptorModel` / :class:`DescriptorSystem`。
        E: 可选，矩阵铅笔的 ``E``。省略时若 ``source`` 自带 ``E`` 则使用之。

    返回:
        True 表示正则；False 表示奇异（极点无定义）。

    异常:
        ValidationError: 输入不是同阶方阵或含非有限值。
        ComputeError: QZ 分解失败。
    """
    A, E_matrix = _coerce_pencil(source, E)
    try:
        AA, BB, _Q, _Z = linalg.qz(A, E_matrix, output="complex")
    except linalg.LinAlgError as exc:  # pragma: no cover - LAPACK 失败极难触发
        raise ComputeError(f"矩阵铅笔正则性检查失败：{exc}") from exc

    diagonal_a = np.abs(np.diag(AA))
    diagonal_b = np.abs(np.diag(BB))
    scale = max(_matrix_norm(A), _matrix_norm(E_matrix))
    tolerance = _REGULARITY_FACTOR * A.shape[0] * np.finfo(float).eps * scale
    singular_pairs = (diagonal_a <= tolerance) & (diagonal_b <= tolerance)
    return not bool(np.any(singular_pairs))


def check_pencil_regularity(source: Any, E: Any | None = None) -> bool:
    """:func:`is_regular_pencil` 的别名，供"检查正则性"语义调用。"""
    return is_regular_pencil(source, E)


# ---------------------------------------------------------------------------
# M4.1 极点
# ---------------------------------------------------------------------------


def analyze_poles(source: Any, E: Any | None = None) -> PoleResult:
    """求描述符系统 ``det(A + sE) = 0`` 的有限极点。

    参数:
        source: 矩阵 ``A``、:class:`DescriptorModel` 或
            :class:`DescriptorSystem`。
        E: 可选，矩阵 ``E``；``source`` 自带 ``E`` 时可省略。

    返回:
        :class:`PoleResult`，含有限极点、无穷远极点个数与逐点残差。

    异常:
        ValidationError: 非方阵、形状不一致、空矩阵或非有限数值。
        ComputeError: 矩阵铅笔奇异（``det(A + sE)`` 恒为零），或广义
            特征值求解失败。
    """
    A, E_matrix = _coerce_pencil(source, E)
    if not is_regular_pencil(A, E_matrix):
        raise ComputeError(
            "描述符矩阵铅笔奇异：det(A + sE) 恒等于零，极点无定义"
        )

    try:
        homogeneous, eigenvectors = linalg.eig(
            -A, E_matrix, right=True, homogeneous_eigvals=True
        )
    except linalg.LinAlgError as exc:
        raise ComputeError(f"描述符广义特征值求解失败：{exc}") from exc

    alpha = homogeneous[0]
    beta = homogeneous[1]
    beta_scale = np.maximum(np.abs(alpha), np.abs(beta))
    finite_mask = np.abs(beta) > _FINITE_BETA_TOL * beta_scale
    finite_count = int(np.count_nonzero(finite_mask))
    infinite_count = int(A.shape[0] - finite_count)

    if finite_count:
        poles = alpha[finite_mask] / beta[finite_mask]
        vectors = eigenvectors[:, finite_mask]
        poles, vectors = _sorted_eigenpairs(poles, vectors)
        residuals = np.asarray(
            [
                _normalized_pole_residual(A, E_matrix, pole, vectors[:, index])
                for index, pole in enumerate(poles)
            ],
            dtype=float,
        )
    else:
        poles = np.empty(0, dtype=np.complex128)
        residuals = np.empty(0, dtype=float)

    return PoleResult(
        finite_poles=np.asarray(poles, dtype=np.complex128),
        residuals=residuals,
        infinite_count=infinite_count,
        size=int(A.shape[0]),
        regular=True,
    )


def descriptor_poles(model: DescriptorModel | DescriptorSystem) -> PoleResult:
    """:func:`analyze_poles` 的便捷入口：直接接受 Descriptor 模型/系统。"""
    if not isinstance(model, (DescriptorModel, DescriptorSystem)):
        raise ValidationError(
            "descriptor_poles 需要 DescriptorModel 或 DescriptorSystem"
        )
    return analyze_poles(model)


# ---------------------------------------------------------------------------
# M4.3 传输零点
# ---------------------------------------------------------------------------


def _as_input_matrix(B: Any, size: int) -> np.ndarray:
    """把 B 规范为 ``(n, m)`` 复矩阵。"""
    try:
        matrix = np.asarray(B, dtype=np.complex128)
    except (TypeError, ValueError) as exc:
        raise ValidationError("B 必须是数值向量或矩阵") from exc
    if matrix.ndim == 1:
        matrix = matrix.reshape(-1, 1)
    if matrix.ndim != 2:
        raise ValidationError(f"B 必须是一维向量或二维矩阵，实际维度为 {matrix.ndim}")
    if matrix.shape[0] != size:
        raise ValidationError(
            f"B 的行数必须等于 A 的阶数 {size}，实际为 {matrix.shape[0]}"
        )
    if matrix.size == 0:
        raise ValidationError("B 不能是空矩阵")
    if not np.all(np.isfinite(matrix)):
        raise ValidationError("B 包含 NaN 或 Inf")
    if not np.any(np.abs(matrix) > 0.0):
        raise ValidationError("输入矩阵 B 不能全为零")
    return matrix


def _as_output_matrix(C: Any, size: int) -> np.ndarray:
    """把 C 规范为 ``(p, n)`` 复矩阵。"""
    try:
        matrix = np.asarray(C, dtype=np.complex128)
    except (TypeError, ValueError) as exc:
        raise ValidationError("C 必须是数值向量或矩阵") from exc
    if matrix.ndim == 1:
        matrix = matrix.reshape(1, -1)
    if matrix.ndim != 2:
        raise ValidationError(f"C 必须是一维向量或二维矩阵，实际维度为 {matrix.ndim}")
    if matrix.shape[1] != size:
        raise ValidationError(
            f"C 的列数必须等于 A 的阶数 {size}，实际为 {matrix.shape[1]}"
        )
    if matrix.size == 0:
        raise ValidationError("C 不能是空矩阵")
    if not np.all(np.isfinite(matrix)):
        raise ValidationError("C 包含 NaN 或 Inf")
    return matrix


def _as_feedthrough_matrix(D: Any, rows: int, columns: int) -> np.ndarray:
    """把 D 规范为 ``(p, m)`` 复矩阵。"""
    if D is None:
        return np.zeros((rows, columns), dtype=np.complex128)
    try:
        matrix = np.asarray(D, dtype=np.complex128)
    except (TypeError, ValueError) as exc:
        raise ValidationError("D 必须是数值标量或矩阵") from exc
    if matrix.ndim == 0:
        matrix = matrix.reshape(1, 1)
    if matrix.ndim == 1:
        matrix = matrix.reshape(1, -1)
    if matrix.ndim != 2:
        raise ValidationError(f"D 必须是标量、向量或二维矩阵，实际维度为 {matrix.ndim}")
    if matrix.shape != (rows, columns):
        raise ValidationError(
            f"D 的形状必须为 {(rows, columns)}，实际为 {matrix.shape}"
        )
    if not np.all(np.isfinite(matrix)):
        raise ValidationError("D 包含 NaN 或 Inf")
    return matrix


def analyze_zeros(
    source: Any,
    E: Any | None = None,
    B: Any | None = None,
    C: Any | None = None,
    D: Any | None = None,
) -> ZeroResult:
    """求 SISO 线性系统的有限传输零点（Rosenbrock 矩阵方法）。

    支持两种调用形式：

    * ``analyze_zeros(A, E, B, C, D)``：直接给矩阵；
    * ``analyze_zeros(system, C=C, D=D)``：``system`` 为
      :class:`DescriptorSystem` 时自动取用其 ``A``、``E``、``B``。

    参数:
        source: 矩阵 ``A`` 或带 ``A``/``E``（/``B``）的系统对象。
        E: 可选矩阵 ``E``。
        B: 输入矩阵 ``(n, m)``；SISO 要求 ``m == 1``。
        C: 输出矩阵 ``(p, n)``；SISO 要求 ``p == 1``。
        D: 前馈矩阵 ``(p, m)``；省略时为零。

    返回:
        :class:`ZeroResult`。

    异常:
        ValidationError: 形状不合法、B/C 全零等。
        UnsupportedAnalysisError: MIMO（``p > 1`` 或 ``m > 1``）尚未实现。
        ComputeError: Rosenbrock 铅笔奇异或广义特征值求解失败。
    """
    if E is None and hasattr(source, "A") and hasattr(source, "E"):
        A = _as_square_matrix(getattr(source, "A"), "A")
        E_matrix = _as_square_matrix(getattr(source, "E"), "E")
        if B is None and hasattr(source, "B"):
            B = getattr(source, "B")
    else:
        A = _as_square_matrix(source, "A")
        if E is None:
            E_matrix = np.eye(A.shape[0], dtype=np.complex128)
        else:
            E_matrix = _as_square_matrix(E, "E")
    if A.shape != E_matrix.shape:
        raise ValidationError(
            f"A 与 E 的形状必须一致，实际为 {A.shape} 和 {E_matrix.shape}"
        )
    if B is None:
        raise ValidationError("零点分析需要输入矩阵 B（或带 B 的 DescriptorSystem）")
    if C is None:
        raise ValidationError("零点分析需要输出矩阵 C")

    B_matrix = _as_input_matrix(B, A.shape[0])
    C_matrix = _as_output_matrix(C, A.shape[0])
    input_count = int(B_matrix.shape[1])
    output_count = int(C_matrix.shape[0])
    D_matrix = _as_feedthrough_matrix(D, output_count, input_count)

    if input_count != 1 or output_count != 1:
        raise UnsupportedAnalysisError(
            "MIMO 传输零点尚未实现：当前仅支持 SISO（单输入、单输出，"
            f"实际为 {input_count} 输入 / {output_count} 输出）"
        )
    if not np.any(np.abs(C_matrix) > 0.0) and not np.any(np.abs(D_matrix) > 0.0):
        raise ValidationError("输出矩阵 C 与 D 不能同时全为零")

    n = int(A.shape[0])
    P0 = np.block(
        [
            [A, -B_matrix],
            [C_matrix, D_matrix],
        ]
    )
    P1 = np.block(
        [
            [E_matrix, np.zeros((n, input_count), dtype=np.complex128)],
            [
                np.zeros((output_count, n), dtype=np.complex128),
                np.zeros((output_count, input_count), dtype=np.complex128),
            ],
        ]
    )

    if not is_regular_pencil(P0, P1):
        raise ComputeError(
            "Rosenbrock 矩阵铅笔奇异：传输零点无定义（请检查输入/输出矩阵）"
        )

    try:
        homogeneous, eigenvectors = linalg.eig(
            -P0, P1, right=True, homogeneous_eigvals=True
        )
    except linalg.LinAlgError as exc:
        raise ComputeError(f"传输零点广义特征值求解失败：{exc}") from exc

    alpha = homogeneous[0]
    beta = homogeneous[1]
    beta_scale = np.maximum(np.abs(alpha), np.abs(beta))
    finite_mask = np.abs(beta) > _FINITE_BETA_TOL * beta_scale
    finite_count = int(np.count_nonzero(finite_mask))
    infinite_count = int(P0.shape[0] - finite_count)

    if finite_count:
        zeros = alpha[finite_mask] / beta[finite_mask]
        vectors = eigenvectors[:, finite_mask]
        zeros, vectors = _sorted_eigenpairs(zeros, vectors)
        residuals = np.asarray(
            [
                _normalized_zero_residual(P0, P1, zero, vectors[:, index])
                for index, zero in enumerate(zeros)
            ],
            dtype=float,
        )
    else:
        zeros = np.empty(0, dtype=np.complex128)
        residuals = np.empty(0, dtype=float)

    return ZeroResult(
        finite_zeros=np.asarray(zeros, dtype=np.complex128),
        residuals=residuals,
        infinite_count=infinite_count,
        size=n,
        regular=True,
        siso=True,
    )


def build_output_matrices(
    model: DescriptorModel, probe: str, input_source: str | None = None
) -> tuple[np.ndarray, np.ndarray]:
    """把单个探针转换为 SISO 输出矩阵 ``C``、``D``。

    支持的探针与 :meth:`DescriptorModel.frequency_response` 的电压/电流
    探针一致：节点电压、电阻/开关电流、电感/电压源/VCVS 支路电流、
    VCCS 输出电流、独立电流源电流。电容电流含 ``sC`` 微分项，不能由静态
    ``C x + D u`` 表示，故显式拒绝。

    参数:
        model: 已装配的 :class:`DescriptorModel`。
        probe: 节点 id、节点名或元件名。
        input_source: 当前输入源名称；用于判断电流源探针是否为激励源。

    返回:
        ``(C, D)``：``C`` 形状 ``(1, n)``，``D`` 形状 ``(1, 1)``。

    异常:
        ComputeError: 探针不存在，或使用电容电流等不可静态化的探针。
        ValidationError: ``model`` 类型不正确。
    """
    if not isinstance(model, DescriptorModel):
        raise ValidationError("build_output_matrices 需要 DescriptorModel")
    token = str(probe)
    node_id = token if token in model.index.node_index else model.index.node_name_to_id.get(token)
    element = None
    if node_id is None:
        element = model.index.element_by_name.get(token)
    if node_id is None and element is None:
        raise ComputeError(f"输出探针不存在：{token!r}")

    size = model.index.size
    C = np.zeros((1, size), dtype=np.float64)
    D = np.zeros((1, 1), dtype=np.float64)

    if node_id is not None:
        position = model.index.node_index.get(node_id)
        if position is not None:
            C[0, position] = 1.0
        return C, D

    assert element is not None
    if element.kind == "capacitor":
        raise ComputeError(
            f"电容电流探针 {element.name!r} 含微分项 sC，不能用 Cx + Du 表示；"
            "请改用节点电压或其他支路电流探针"
        )
    if element.kind in ("resistor", "switch"):
        conductance = float(element.conductance)
        position_a = model.index.node_index.get(element.a)
        position_b = model.index.node_index.get(element.b)
        if position_a is not None:
            C[0, position_a] += conductance
        if position_b is not None:
            C[0, position_b] -= conductance
        return C, D
    if element.kind in ("inductor", "vsource", "vcvs"):
        C[0, model.index.branch_index[element.name]] = 1.0
        return C, D
    if element.kind == "vccs":
        transconductance = float(element.transconductance)
        position_a = model.index.node_index.get(element.control_a)
        position_b = model.index.node_index.get(element.control_b)
        if position_a is not None:
            C[0, position_a] += transconductance
        if position_b is not None:
            C[0, position_b] -= transconductance
        return C, D
    if element.kind == "isource":
        if input_source is not None and element.name == str(input_source):
            D[0, 0] = 1.0
        return C, D
    raise ComputeError(f"输出探针 {element.name!r} 的元件类型不支持：{element.kind!r}")


def descriptor_zeros(
    model: DescriptorModel,
    input_source: str | None = None,
    output: str | None = None,
) -> ZeroResult:
    """便捷入口：由 Descriptor 模型、输入源与输出探针求 SISO 传输零点。

    参数:
        model: :class:`DescriptorModel`。
        input_source: 输入源名称；省略时按 ``DescriptorModel.build`` 的规则
            选择第一个独立源。
        output: 输出探针（节点名/节点 id/元件名）。省略时选第一个非接地
            节点电压。

    返回:
        :class:`ZeroResult`。
    """
    if not isinstance(model, DescriptorModel):
        raise ValidationError("descriptor_zeros 需要 DescriptorModel")
    system = model.build(input_source)
    probe = output
    if probe is None:
        if not model.index.node_index:
            raise ValidationError("模型没有非接地节点，无法选择默认输出探针")
        probe = next(iter(model.index.node_index))
    C, D = build_output_matrices(model, probe, input_source=system.input_source)
    return analyze_zeros(system, C=C, D=D)


def _complex_list(values: np.ndarray) -> list[list[float]]:
    """把复数数组编码成 ``[[re, im], ...]``。"""
    return [[float(np.real(item)), float(np.imag(item))] for item in np.asarray(values).reshape(-1)]


def _format_coefficient(value: complex) -> str:
    """把多项式系数格式化为紧凑的实数字符串；明显非实数时保留复数。"""
    real = float(np.real(value))
    imag = float(np.imag(value))
    if abs(imag) <= 1.0e-10 * max(1.0, abs(real)):
        if abs(real - round(real)) <= 1.0e-10 * max(1.0, abs(real)):
            return str(int(round(real)))
        return f"{real:.6g}"
    return f"({real:.6g}{imag:+.6g}j)"


def _poly_text(coefficients: np.ndarray, variable: str = "s") -> str:
    """把降幂系数数组写成可读多项式，如 ``s^2 + 2*s + 1``。"""
    values = np.asarray(coefficients, dtype=np.complex128).reshape(-1)
    while values.size > 1 and abs(values[0]) <= 1.0e-12:
        values = values[1:]
    terms: list[str] = []
    degree = values.size - 1
    for index, value in enumerate(values):
        power = degree - index
        if abs(value) <= 1.0e-12:
            continue
        text = _format_coefficient(value)
        if power >= 1 and text == "1":
            text = ""
        elif power >= 1 and text == "-1":
            text = "-"
        if power == 0:
            terms.append(text)
        elif power == 1:
            terms.append(f"{text}{variable}")
        else:
            terms.append(f"{text}{variable}^{power}")
    if not terms:
        return "0"
    result = terms[0]
    for term in terms[1:]:
        if term.startswith("-"):
            result += " - " + term[1:]
        else:
            result += " + " + term
    return result


def _real_if_close(values: np.ndarray) -> np.ndarray:
    """把数值噪声范围内的复数系数还原为实数数组。"""
    array = np.asarray(values, dtype=np.complex128)
    if not array.size:
        return array.real
    scale = max(1.0, float(np.max(np.abs(array))))
    if np.all(np.abs(array.imag) <= 1.0e-9 * scale):
        return array.real
    return array


def descriptor_transfer_function(
    model: DescriptorModel,
    input_source: str | None = None,
    output: str | None = None,
) -> dict[str, Any]:
    """从 SISO Descriptor 模型提取有理传递函数。

    使用有限极点/零点构造 ``G(s) = k * prod(s-z_i) / prod(s-p_i)``。该方法
    不依赖 ``E`` 可逆，因此同样适用于 index-1 的奇异描述符系统；阶数超过
    64 时返回 ``supported=False``，避免把超大矩阵转成不可读的表达式。
    """
    if not isinstance(model, DescriptorModel):
        raise ValidationError("descriptor_transfer_function 需要 DescriptorModel")
    system = model.build(input_source)
    probe = output
    if probe is None:
        if not model.index.node_index:
            raise ValidationError("模型没有非接地节点，无法选择默认输出探针")
        probe = next(iter(model.index.node_index))
    c_matrix, d_matrix = build_output_matrices(
        model, probe, input_source=system.input_source
    )
    order = int(system.A.shape[0])
    if order > 64:
        return {
            "supported": False,
            "reason": f"电路阶数 {order} 超过传递函数提取上限 64",
            "order": order,
        }

    pole_result = analyze_poles(system)
    zero_result = analyze_zeros(system, C=c_matrix, D=d_matrix)
    poles = np.asarray(pole_result.finite_poles, dtype=np.complex128).reshape(-1)
    zeros = np.asarray(zero_result.finite_zeros, dtype=np.complex128).reshape(-1)
    denominator = np.poly(poles) if poles.size else np.asarray([1.0], dtype=complex)
    numerator = np.poly(zeros) if zeros.size else np.asarray([1.0], dtype=complex)

    def evaluate(point: complex) -> complex | None:
        matrix = point * system.E + system.A
        try:
            state = np.linalg.solve(matrix, system.B)
        except np.linalg.LinAlgError:
            return None
        value = np.asarray(c_matrix).reshape(1, -1) @ state + d_matrix
        return complex(np.asarray(value).reshape(-1)[0])

    sample = None
    for candidate in (0.0, 1.0, 10.0j, -10.0j):
        value = evaluate(complex(candidate))
        if value is not None and np.isfinite(value):
            denominator_value = np.polyval(denominator, candidate)
            numerator_value = np.polyval(numerator, candidate)
            if abs(numerator_value) > 1.0e-15 and np.isfinite(denominator_value):
                sample = value * denominator_value / numerator_value
                break
    if sample is None:
        raise UnsupportedAnalysisError("无法确定传递函数增益：所有采样点均落在极点或零点上")
    numerator = numerator * sample
    numerator = _real_if_close(numerator)
    denominator = _real_if_close(denominator)

    dc_value = evaluate(0.0)
    dc_gain = None if dc_value is None or not np.isfinite(dc_value) else float(np.real(dc_value))
    finite_order = int(pole_result.finite_count)
    return {
        "supported": True,
        "expression": f"({_poly_text(numerator)}) / ({_poly_text(denominator)})",
        "numerator": _poly_text(numerator),
        "denominator": _poly_text(denominator),
        "numerator_coeffs": [float(np.real(item)) if abs(np.imag(item)) < 1e-10 else [float(np.real(item)), float(np.imag(item))] for item in numerator],
        "denominator_coeffs": [float(np.real(item)) if abs(np.imag(item)) < 1e-10 else [float(np.real(item)), float(np.imag(item))] for item in denominator],
        "order": finite_order,
        "relative_order": max(0, finite_order - int(zero_result.finite_count)),
        "dc_gain": dc_gain,
        "dc_gain_finite": bool(dc_gain is not None and np.isfinite(dc_gain)),
        "poles": _complex_list(poles),
        "zeros": _complex_list(zeros),
    }


__all__ = [
    "PoleResult",
    "ZeroResult",
    "UnsupportedAnalysisError",
    "analyze_poles",
    "analyze_zeros",
    "build_output_matrices",
    "check_pencil_regularity",
    "descriptor_poles",
    "descriptor_transfer_function",
    "descriptor_zeros",
    "is_regular_pencil",
]


def descriptor_step_response(
    model: DescriptorModel,
    input_source: str | None,
    probe: str,
    *,
    t_end: float,
    dt: float = 1.0e-4,
) -> dict[str, Any]:
    """规则 index-1 Descriptor 系统的单位阶跃响应（隐式 Euler）。

    仅支持节点电压输出；奇异系统由 ``numpy.linalg.LinAlgError`` 明确报错。
    """
    import numpy as np

    if t_end <= 0.0 or dt <= 0.0:
        raise ValueError("t_end 与 dt 必须为正")
    system = model.build(input_source)
    node_id = model.index.node_name_to_id.get(probe, probe)
    position = model.index.node_index.get(str(node_id))
    if position is None:
        raise UnsupportedAnalysisError("阶跃分析只支持非接地节点电压探针")
    c = np.zeros(model.index.size)
    c[position] = 1.0
    steps = int(round(t_end / dt))
    if steps <= 0:
        raise ValueError("时间窗口至少需要一个步长")
    x = np.zeros(model.index.size, dtype=float)
    times = [0.0]
    values = [float(c @ x)]
    lhs = system.E + dt * system.A
    for index in range(1, steps + 1):
        rhs = system.E @ x + dt * system.B
        x = np.linalg.solve(lhs, rhs)
        times.append(index * dt)
        values.append(float(c @ x))
    return {"probe": probe, "times": times, "values": values, "dt": dt}
