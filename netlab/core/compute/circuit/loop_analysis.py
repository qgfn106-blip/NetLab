"""闭环回路增益提取（受控源断开法）。

本模块把电路中的一个受控源（VCVS / VCCS）视为反馈环路的断点：保留电路
其余部分不变，把该受控源的输出换成独立测试激励，求解控制电压对测试激励
的传递关系，得到回路增益 L(s)（return ratio）。

约定
----
* 负反馈的返回比为正；feedback_sign=+1 表示负反馈，-1 表示正反馈。
* VCVS 的正向增益取 G = gain * (v_c - v_d)，其中输出端被钳位为零、
  输入激励保持有效；闭环传递函数 T = G / (1 + feedback_sign * L)。
* VCCS 的正向增益取“把受控电流源置零（开路）后在输出节点测得的电压”。
* 直接闭环响应用于校验：偏离超过阈值时只发警告，不伪称精确。

本模块不修改 DescriptorModel，只复制其装配好的矩阵后打补丁。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from ...common.limits import ComputeError, ValidationError
from .descriptor import DescriptorModel, DescriptorSystem
from .descriptor_analysis import analyze_poles, analyze_zeros, build_output_matrices

__all__ = [
    "LoopExtraction",
    "break_candidates",
    "extract_controlled_source_loop",
]

_CONTROLLED_KINDS = ("vcvs", "vccs")
_PARITY_TOL = 1e-6


@dataclass(frozen=True)
class LoopExtraction:
    """一次受控源断环的数值结果（数组均为正向频率顺序）。"""

    element: str
    kind: str
    input_source: str
    output_probe: str
    output_name: str
    feedback_sign: float
    frequencies_hz: np.ndarray
    loop_gain: np.ndarray
    forward_gain: np.ndarray
    closed_loop: np.ndarray
    direct_response: np.ndarray | None
    parity_max_rel: float | None
    poles: dict[str, Any] = field(default_factory=dict)
    warnings: tuple[dict[str, Any], ...] = ()
    open_loop_transfer: dict[str, Any] | None = None


def _frequency_array(frequencies: Any) -> np.ndarray:
    values = np.asarray(frequencies, dtype=np.float64).reshape(-1)
    if values.size == 0:
        raise ValidationError("频率数组不能为空")
    if not np.all(np.isfinite(values)) or np.any(values <= 0.0):
        raise ValidationError("频率必须为有限正数")
    return values


def break_candidates(model: DescriptorModel) -> list[dict[str, Any]]:
    """列出可作为断点的受控源。"""
    if not isinstance(model, DescriptorModel):
        raise ValidationError("break_candidates 需要 DescriptorModel")
    candidates: list[dict[str, Any]] = []
    for element in model.elements:
        if element.kind in _CONTROLLED_KINDS:
            candidates.append(
                {
                    "element": element.name,
                    "kind": element.kind,
                    "control_a": element.control_a,
                    "control_b": element.control_b,
                    "output_a": element.a,
                    "output_b": element.b,
                    "gain": float(element.gain),
                }
            )
    return candidates


def _resolve_node(model: DescriptorModel, token: str | None, fallback: str) -> tuple[str, str]:
    if token is None:
        node_id = fallback
    else:
        text = str(token)
        node_id = text if text in model.index.node_index else model.index.node_name_to_id.get(text)
        if node_id is None:
            raise ComputeError(f"输出节点不存在：{text!r}")
    node = model.index.node_by_id.get(node_id)
    name = getattr(node, "name", None) or str(node_id)
    return str(node_id), str(name)


def _assert_supported(model: DescriptorModel, element: Any) -> None:
    if element.kind not in _CONTROLLED_KINDS:
        raise ComputeError(
            f"元件 {element.name!r} 的类型 {element.kind!r} 不是可断开的线性受控源"
        )
    if element.name not in model.index.branch_index:
        raise ComputeError(f"受控源 {element.name!r} 没有独立支路变量，无法断环")


def _broken_matrices(
    model: DescriptorModel, element: Any
) -> tuple[DescriptorSystem, np.ndarray, np.ndarray, np.ndarray]:
    """返回原始系统、打补丁后的 A、E 以及测试激励右端项。"""
    system = model.build(None)
    A = np.array(system.A, dtype=np.float64, copy=True)
    E = np.array(system.E, dtype=np.float64, copy=True)
    size = int(A.shape[0])
    test = np.zeros(size, dtype=np.float64)

    if element.kind == "vcvs":
        row = model.index.branch_index[element.name]
        ci = model.index.node_index.get(element.control_a)
        di = model.index.node_index.get(element.control_b)
        gain = float(element.gain)
        # 还原装配时写入的受控关系：A[row, ci] -= gain, A[row, di] += gain。
        if ci is not None:
            A[row, ci] += gain
        if di is not None:
            A[row, di] -= gain
        # 支路方程变为 v_a - v_b = v_t。
        test[row] = 1.0
    else:  # vccs
        ai = model.index.node_index.get(element.a)
        bi = model.index.node_index.get(element.b)
        ci = model.index.node_index.get(element.control_a)
        di = model.index.node_index.get(element.control_b)
        gm = float(element.transconductance)
        # 还原 A[ai,ci] += gm, A[ai,di] -= gm, A[bi,ci] -= gm, A[bi,di] += gm。
        if ai is not None and ci is not None:
            A[ai, ci] -= gm
        if ai is not None and di is not None:
            A[ai, di] += gm
        if bi is not None and ci is not None:
            A[bi, ci] += gm
        if bi is not None and di is not None:
            A[bi, di] -= gm
        # 测试电流从 a 流入、从 b 流出。
        if ai is not None:
            test[ai] += 1.0
        if bi is not None:
            test[bi] -= 1.0
    return system, A, E, test


def _control_voltage(model: DescriptorModel, element: Any, vector: np.ndarray) -> complex:
    ci = model.index.node_index.get(element.control_a)
    di = model.index.node_index.get(element.control_b)
    value = 0.0 + 0.0j
    if ci is not None:
        value += vector[ci]
    if di is not None:
        value -= vector[di]
    return complex(value)


def _solve(matrix: np.ndarray, rhs: np.ndarray, omega: float) -> np.ndarray:
    try:
        return np.linalg.solve(matrix, rhs)
    except np.linalg.LinAlgError as exc:
        raise ComputeError(
            f"断环矩阵在 ω={omega:.6g} rad/s 奇异（可能存在虚轴极点，回路增益无定义）"
        ) from exc


def _poly_expr(coeffs: np.ndarray) -> str:
    """把按降幂排列的多项式系数渲染为可读表达式（自变量为复频率 s）。"""
    values = np.real_if_close(np.asarray(coeffs, dtype=np.complex128).reshape(-1))
    terms: list[str] = []
    degree = values.size - 1
    for index, raw in enumerate(values):
        power = degree - index
        value = complex(raw)
        if abs(value) < 1e-14:
            continue
        if abs(value.imag) > 1e-9:
            coeff = f"{value.real:.6g}{value.imag:+.6g}j"
        else:
            coeff = f"{value.real:.6g}"
        if power == 0:
            terms.append(coeff)
        elif power == 1:
            terms.append(f"{coeff}*s")
        else:
            terms.append(f"{coeff}*s^{power}")
    if not terms:
        return "0"
    return " + ".join(terms).replace("+ -", "- ")


def _analytic_open_loop(
    model: DescriptorModel,
    element: Any,
    A: np.ndarray,
    E: np.ndarray,
    test: np.ndarray,
    freqs: np.ndarray,
    loop_values: np.ndarray,
) -> dict[str, Any] | None:
    """在已打补丁的断环铅笔上解析求开环 L(s)，并以数值返回比做一致性校验。

    仅对 VCVS 提供解析式（VCCS 断环语义不同，直接返回 unsupported）。
    解析与数值返回比不一致时返回 unsupported，绝不返回可疑解析式。
    """
    if element.kind != "vcvs":
        return {"supported": False, "reason": "VCCS 断环暂不提供解析开环表达式"}
    try:
        size = int(A.shape[0])
        control = np.zeros(size, dtype=np.complex128)
        ci = model.index.node_index.get(element.control_a)
        di = model.index.node_index.get(element.control_b)
        if ci is not None:
            control[ci] += 1.0
        if di is not None:
            control[di] -= 1.0
        if not np.any(control):
            return {"supported": False, "reason": "受控源控制端无有效节点，无法解析开环"}
        factor = -float(element.gain)  # 与数值返回比 loop_value = -gain*control_test 同号
        poles = np.asarray(analyze_poles(A, E).finite_poles, dtype=np.complex128)
        zeros = np.asarray(
            analyze_zeros(
                A, E, test.reshape(-1, 1), control.reshape(1, -1), np.zeros((1, 1))
            ).finite_zeros,
            dtype=np.complex128,
        )
        den = np.poly(poles) if poles.size else np.array([1.0])
        num = np.poly(zeros) if zeros.size else np.array([1.0])
        sample = None
        for candidate in (1.0, 10.0, 1j, 1j * 10.0, 100.0):
            try:
                x = np.linalg.solve(candidate * E + A, test.astype(np.complex128))
            except np.linalg.LinAlgError:
                continue
            h = factor * complex(control @ x)
            den_v = np.polyval(den, candidate)
            num_v = np.polyval(num, candidate)
            if abs(den_v) < 1e-12 or abs(num_v) < 1e-30 or not np.isfinite(h):
                continue
            sample = h * den_v / num_v
            break
        if sample is None:
            return {"supported": False, "reason": "无法确定解析开环定标，跳过解析解"}
        num = num * sample
        rel_max = 0.0
        checked = 0
        for frequency, reference in zip(freqs, loop_values):
            if abs(reference) < 1e-9:
                continue
            s = 1j * 2.0 * np.pi * float(frequency)
            den_v = np.polyval(den, s)
            if abs(den_v) < 1e-30:
                continue
            approx = np.polyval(num, s) / den_v
            rel = abs(approx - reference) / max(abs(reference), 1e-12)
            rel_max = max(rel_max, float(rel))
            checked += 1
        if checked == 0 or rel_max > _PARITY_TOL:
            return {
                "supported": False,
                "reason": f"解析开环与数值返回比不一致（最大相对误差 {rel_max:.3g}），不采用",
            }
        num_real = np.real_if_close(num)
        den_real = np.real_if_close(den)
        return {
            "supported": True,
            "expression": f"({_poly_expr(num_real)}) / ({_poly_expr(den_real)})",
            "order": int(max(len(num_real), len(den_real)) - 1),
            "relative_order": int(len(den_real) - len(num_real)),
            "parity_max_rel": float(rel_max),
            "source": "descriptor_broken_pencil",
        }
    except ComputeError as exc:
        return {"supported": False, "reason": f"解析开环提取失败：{exc}"}
    except Exception as exc:  # noqa: BLE001 - 解析失败一律降级，不影响数值结果
        return {"supported": False, "reason": f"解析开环提取失败：{exc}"}


def extract_controlled_source_loop(
    model: DescriptorModel,
    element_name: str,
    frequencies: Any,
    *,
    input_source: str | None = None,
    output: str | None = None,
    feedback_sign: float = 1.0,
) -> LoopExtraction:
    """用受控源断开法提取回路增益与合成闭环响应。

    参数:
        model: 已装配的描述符模型（非线性电路需先带工作点线性化）。
        element_name: 断开的受控源名称。
        frequencies: 正向频率数组（Hz），必须为有限正数。
        input_source: 输入源名称；缺省使用模型中第一个独立电压源。
        output: 输出节点（id 或名称）；VCVS 缺省为受控源输出 a 端。
        feedback_sign: +1 负反馈，-1 正反馈。

    返回:
        LoopExtraction。
    """
    if not isinstance(model, DescriptorModel):
        raise ValidationError("extract_controlled_source_loop 需要 DescriptorModel")
    element = model.index.element_by_name.get(str(element_name))
    if element is None:
        raise ComputeError(f"断点元件不存在：{element_name!r}")
    _assert_supported(model, element)
    freqs = _frequency_array(frequencies)
    sign = float(feedback_sign)
    if sign not in (1.0, -1.0):
        raise ValidationError("feedback_sign 只能为 +1 或 -1")

    if input_source is None:
        input_source = next(
            (item.name for item in model.elements if item.kind == "vsource"), None
        )
    if input_source is None:
        raise ComputeError("回路提取需要至少一个独立电压源作为输入激励")
    if input_source not in model.index.element_by_name:
        raise ComputeError(f"输入源不存在：{input_source!r}")

    fallback = element.a
    output_id, output_name = _resolve_node(model, output, fallback)
    system, A, E, test = _broken_matrices(model, element)
    input_rhs = np.array(system.B, dtype=np.float64, copy=True)

    # VCVS 的输出被钳位：右端项在断点支路行置零。
    if element.kind == "vcvs":
        input_rhs[model.index.branch_index[element.name]] = 0.0

    try:
        C, D = build_output_matrices(model, output_id, input_source)
    except ComputeError:
        C = D = None

    loop_values = np.empty(freqs.size, dtype=np.complex128)
    forward = np.empty(freqs.size, dtype=np.complex128)
    closed = np.empty(freqs.size, dtype=np.complex128)
    direct = np.empty(freqs.size, dtype=np.complex128) if (C is not None and D is not None) else None

    for index, frequency in enumerate(freqs):
        omega = 2.0 * np.pi * float(frequency)
        matrix = A + 1j * omega * E
        vector_test = _solve(matrix, test.astype(np.complex128), omega)
        control_test = _control_voltage(model, element, vector_test)

        vector_input = _solve(matrix, input_rhs.astype(np.complex128), omega)
        control_input = _control_voltage(model, element, vector_input)

        if element.kind == "vcvs":
            gain = float(element.gain)
            loop_value = -gain * control_test
            forward_value = gain * control_input
        else:
            gm = float(element.transconductance)
            position = model.index.node_index.get(output_id)
            if position is None:
                raise ComputeError("VCCS 断环的输出节点必须是电压未知量节点")
            forward_value = complex(vector_input[position])
            loop_value = -gm * control_test

        loop_values[index] = loop_value
        forward[index] = forward_value
        closed[index] = forward_value / (1.0 + sign * loop_value)

        if direct is not None:
            original = system.solve(omega)
            direct[index] = complex(C[0] @ original + D[0, 0])

    parity: float | None = None
    if direct is not None:
        scale = np.maximum(np.abs(direct), 1e-12)
        relative = np.abs(closed - direct) / scale
        parity = float(np.max(relative)) if relative.size else None

    open_loop_transfer = _analytic_open_loop(model, element, A, E, test, freqs, loop_values)

    warnings: list[dict[str, Any]] = []
    if parity is not None and parity > _PARITY_TOL:
        warnings.append(
            {
                "code": "loop_parity_failed",
                "message": "受控源断环合成闭环响应与直接闭环响应不一致，结果仅作图参考",
                "severity": "warning",
                "max_relative_difference": parity,
            }
        )

    poles_payload: dict[str, Any] = {}
    try:
        pole_result = analyze_poles(A, E)
        finite = np.asarray(pole_result.poles, dtype=np.complex128)
        on_imaginary = [
            complex(value)
            for value in finite
            if abs(float(np.real(value))) <= 1e-9 and abs(float(np.imag(value))) > 1e-12
        ]
        poles_payload = {
            "finite": [complex(value) for value in finite],
            "infinite_count": int(pole_result.infinite_count),
            "right_half_plane": int(np.count_nonzero(np.real(finite) > 1e-9)),
            "on_imaginary_axis": bool(on_imaginary),
            "imaginary_poles": on_imaginary,
        }
        if on_imaginary:
            warnings.append(
                {
                    "code": "loop_pole_on_imaginary_axis",
                    "message": "回路增益存在虚轴极点，Nyquist 判据不能给出稳定性结论",
                    "severity": "error",
                }
            )
    except ComputeError as exc:
        warnings.append(
            {
                "code": "loop_poles_unavailable",
                "message": f"回路增益极点不可用：{exc}",
                "severity": "warning",
            }
        )

    return LoopExtraction(
        element=str(element.name),
        kind=str(element.kind),
        input_source=str(input_source),
        output_probe=str(output_id),
        output_name=str(output_name),
        feedback_sign=sign,
        frequencies_hz=freqs,
        loop_gain=loop_values,
        forward_gain=forward,
        closed_loop=closed,
        direct_response=direct,
        parity_max_rel=parity,
        poles=poles_payload,
        warnings=tuple(warnings),
        open_loop_transfer=open_loop_transfer,
    )
