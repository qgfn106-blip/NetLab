"""P3-02 analysis 分层模块（由 analysis.py 抽出，公共 API 不变）。"""
from __future__ import annotations

import math
import threading
import time
from pathlib import Path
from typing import Any, Callable

import numpy as np

from .frequency_diag import (
    cond_enabled as _freq_diag_enabled,
    point_diagnostics as _freq_point,
    summarize as _freq_summarize,
)
from . import complex_support as complex_layer
from . import transfer as transfer_math
from .exact_input import to_exact as _to_exact
from .circuit.descriptor import DescriptorModel
from .circuit.analysis_envelopes import bode_envelope, scene_fingerprint, step_envelope
from .circuit.fft_frequency import approximation_envelope, estimate_transfer_fft, multisine
from .circuit.loop_analysis import (
    branch_candidates,
    break_candidates,
    extract_branch_loop,
    extract_controlled_source_loop,
)
from .circuit.nyquist import nyquist_envelope, stability_margins
from .circuit.analysis_contract import curve, warning
from .circuit.descriptor_analysis import (
    UnsupportedAnalysisError,
    analyze_poles,
    analyze_zeros,
    build_output_matrices,
    descriptor_step_response,
    descriptor_transfer_function,
    descriptor_transient_response,
)
from ..common.limits import MAX_NODES, ComputeError, ValidationError
from .statespace import StateSpaceModel
from .analysis_errors import ANALYSIS_TIMEOUT, AnalysisError, MAX_EXPORT_ROWS
from .analysis_numerics import (
    _complex_list,
    _complex_pairs,
    _crossing,
    _frequency_axis,
    _number,
    _period_windows,
    _shift_score,
    _uniform,
)

from .analysis_metrics import numeric_precision_mode


def _state_space_payload(tf: Any) -> dict[str, Any] | None:
    """把 ``TransferFunction`` 转成可控标准型 A/B/C/D（只读呈现）。"""
    try:
        state_space = tf.to_state_space()
    except Exception:
        return None
    if state_space is None:
        return None
    a, b, c, d = state_space
    return {
        "realization": "controllable_canonical",
        "order": int(a.shape[0]),
        "A": [[float(value) for value in row] for row in a],
        "B": [[float(value) for value in row] for row in b],
        "C": [[float(value) for value in row] for row in c],
        "D": [[float(value) for value in row] for row in d],
        "note": "由总传函系数构造的可控标准型；仅用于导出/复核，不改变求解器内部状态",
    }


def _node_tf(kind: str, params: dict[str, Any]) -> str | None:
    if kind == "gain":
        return _number(params.get("gain", 1.0))
    if kind == "sum":
        return None  # 权重在边上处理
    if kind == "lag":
        tau = _number(params.get("tau", 0.1))
        return f"1/(1+({tau})*s)"
    if kind == "integrate":
        gain = _number(params.get("gain", 1.0))
        return f"({gain})/s"
    if kind == "transfer_function":
        # 三种输入形态统一走 transfer.from_params；sympy 只认 ** 形式的幂。
        return transfer_math.from_params(params).to_expression(power="**")
    return ""


def transfer_function(
    sim: Any,
    input_node: str,
    output_node: str,
    *,
    input_field: str = "voltage",
    output_field: str = "voltage",
    domain: str = "s",
    delay_pade_order: int = 3,
) -> dict[str, Any]:
    """线性网络符号传递函数（sympy 可选）；``domain='z'`` 支持显式 z⁻¹。

    ``domain='s'`` 时，单步延迟边按 ``e^{-s·dt}`` 的 ``delay_pade_order``
    阶 Padé 有理近似处理（默认 3 阶）；``domain='z'`` 保持精确 ``z⁻¹``。
    """
    if domain not in {"s", "z"}:
        return {
            "ok": False,
            "reason": f"未知传递函数域 {domain!r}（只支持 s / z）",
            "source": "symbolic",
        }
    try:
        delay_pade_order = int(delay_pade_order)
    except (TypeError, ValueError):
        return {
            "ok": False,
            "reason": f"延迟 Padé 阶数必须是整数，收到 {delay_pade_order!r}",
            "source": "symbolic",
        }
    if not 1 <= delay_pade_order <= 8:
        return {
            "ok": False,
            "reason": "延迟 Padé 阶数必须在 1–8 之间",
            "source": "symbolic",
        }
    try:
        import sympy as sp
    except Exception as exc:  # pragma: no cover - 环境相关
        return {
            "ok": False,
            "reason": f"未安装 sympy，无法做符号推导：{exc}",
            "source": "symbolic（sympy 可选）",
        }
    scene = sim.scene
    if scene.mode != "signal":
        return {
            "ok": False,
            "reason": "目前只支持 signal 模式的线性传递函数",
            "source": "symbolic",
        }
    nodes = {node.name: node for node in scene.nodes.values()}
    nodes_by_id = {node.id: node for node in scene.nodes.values()}
    if input_node not in nodes or output_node not in nodes:
        return {"ok": False, "reason": "输入/输出节点名不存在", "source": "symbolic"}
    s = sp.Symbol("s")
    z = sp.Symbol("z")
    variable = z if domain == "z" else s
    try:
        delay_seconds = float(getattr(sim.config, "dt", 0.0))
    except (AttributeError, TypeError, ValueError):
        delay_seconds = 0.0

    def pade_delay() -> Any:
        """e^{-sT} 的 [p/p] Padé 有理近似（T=一个仿真步长）。"""
        if domain != "s":
            return sp.Integer(1)
        if not math.isfinite(delay_seconds) or delay_seconds <= 0.0:
            raise AnalysisError("s 域延迟近似需要正数仿真步长 dt")
        x = s * sp.Rational(str(delay_seconds))
        numerator = sp.Integer(0)
        denominator = sp.Integer(0)
        order = delay_pade_order
        for k in range(order + 1):
            coefficient = (
                sp.factorial(2 * order - k)
                * sp.factorial(order)
                / (sp.factorial(2 * order) * sp.factorial(k) * sp.factorial(order - k))
            )
            numerator += coefficient * (-x) ** k
            denominator += coefficient * x**k
        return sp.cancel(numerator / denominator)

    nonlinear_kinds = {
        "expression",
        "clip",
        "deadband",
        "saturate",
        "lookup",
        "table",
        "piecewise",
    }
    for node in nodes.values():
        if node.kind in nonlinear_kinds:
            return {
                "ok": False,
                "reason": f"网络含非线性节点 {node.name!r}（kind={node.kind!r}），不适用线性总传函",
                "source": "symbolic（sympy）",
            }

    def sym_number(value: Any) -> Any:
        # exact：十进制输入 -> 精确有理数（避免早期 float 漂移）；
        # standard：退回旧行为 sp.sympify(str(value))，允许 sp.Float（大系统提速）。
        if numeric_precision_mode() == "exact":
            return _to_exact(value)
        return sp.sympify(str(value))

    def local_tf(node: Any) -> Any:
        kind = node.kind
        params = node.params
        if kind == "gain":
            return sym_number(params.get("gain", 1.0))
        if kind == "sum":
            return sp.Integer(1)
        if domain == "z":
            raise AnalysisError(
                f"z 域总传函只支持 gain/sum 节点；{node.name!r} 是 {kind!r}，"
                "请改用逐拍仿真或先离散化"
            )
        if kind == "lag":
            tau = sym_number(params.get("tau", 0.1))
            return 1 / (1 + tau * s)
        if kind == "integrate":
            return sym_number(params.get("gain", 1.0)) / s
        if kind == "transfer_function":
            return sp.sympify(_node_tf(kind, params))
        if kind == "state_space":
            def _exact_rows(key: str, default: list) -> sp.Matrix:
                rows = params.get(key) or default
                return sp.Matrix([[sym_number(x) for x in row] for row in rows])

            a = _exact_rows("A", [])
            b = _exact_rows("B", [])
            c = _exact_rows("C", [])
            d = _exact_rows("D", [[0.0]])
            if a.shape[0] == 0 or b.shape[0] != a.shape[0]:
                raise AnalysisError(f"状态空间节点 {node.name!r} 的 A/B 维度不匹配")
            transfer = c * (s * sp.eye(a.shape[0]) - a).inv() * b + d
            return sp.simplify(transfer[0, 0])
        if kind in {"manual", "signal"}:
            return None
        raise AnalysisError(
            f"节点 {node.name!r}（kind={kind!r}）不在总传函支持范围内；"
            "目前支持 gain/sum/lag/integrate/transfer_function/state_space"
        )

    def edge_weight(edge: Any, target_node: Any) -> Any:
        delay_factor = sp.Integer(1)
        if edge.delay:
            delay_factor = pade_delay() if domain == "s" else 1 / variable
        if edge.kind == "pass":
            base = sp.Integer(1)
        elif edge.kind == "scale":
            base = sym_number((edge.params or {}).get("gain", 1.0))
        else:
            raise AnalysisError(
                f"连接 {edge.name!r} 的边类型 {edge.kind!r} 不在总传函支持范围内"
            )
        if target_node.kind == "sum":
            weights = target_node.params.get("weights") or {}
            weight = weights.get(edge.name, 1)
            return base * sym_number(weight) * delay_factor
        return base * delay_factor

    unknowns = [sp.Symbol(f"y_{index}") for index in range(len(nodes))]
    by_name = dict(zip(nodes.keys(), unknowns))
    equations = []
    for node in nodes.values():
        symbol = by_name[node.name]
        if node.name == input_node:
            equations.append(sp.Eq(symbol, sp.Integer(1)))
            continue
        local = local_tf(node)
        if local is None:
            equations.append(sp.Eq(symbol, sp.Integer(0)))
            continue
        total = sp.Integer(0)
        for edge in scene.edges.values():
            if not edge.enabled or edge.target != node.id:
                continue
            source = nodes_by_id.get(edge.source)
            if source is None:
                continue
            total += edge_weight(edge, node) * by_name[source.name]
        equations.append(sp.Eq(symbol, sp.expand(local * total)))

    try:
        solutions = sp.solve(equations, unknowns, dict=True)
        if not solutions:
            raise AnalysisError("线性网络节点方程无解，无法得到总传函")
        expr = sp.simplify(solutions[0][by_name[output_node]])
    except AnalysisError as exc:
        return {"ok": False, "reason": str(exc), "source": "symbolic（sympy）"}
    except Exception as exc:
        return {
            "ok": False,
            "reason": f"符号推导失败：{exc}",
            "source": "symbolic（sympy）",
        }
    if expr == 0:
        return {
            "ok": False,
            "reason": "从输入到输出没有线性通路（或增益为 0）",
            "source": "symbolic（sympy）",
        }
    num, den = sp.fraction(sp.together(expr))
    try:
        num_poly = sp.Poly(sp.expand(num), variable)
        den_poly = sp.Poly(sp.expand(den), variable)
        num_coeffs = [float(item) for item in num_poly.all_coeffs()][::-1]
        den_coeffs = [float(item) for item in den_poly.all_coeffs()][::-1]
    except Exception:
        num_coeffs, den_coeffs = [], []
    state_space = None
    if domain == "s":
        try:
            state_space = _state_space_payload(
                transfer_math.parse_expression(str(expr).replace("**", "^"))
            )
        except Exception:
            state_space = None
    return {
        "ok": True,
        "domain": domain,
        "variable": str(variable),
        "input": {"node": input_node, "field": input_field},
        "output": {"node": output_node, "field": output_field},
        "expression": str(expr),
        "numerator": str(num),
        "denominator": str(den),
        "numerator_coeffs": num_coeffs,
        "denominator_coeffs": den_coeffs,
        "order": max(0, len(den_coeffs) - 1),
        "state_space": state_space,
        "delay_pade_order": delay_pade_order if domain == "s" else 0,
        "delay_seconds": delay_seconds if domain == "s" else 0.0,
        "assumptions": [
            "线性节点：gain/sum/lag/integrate/transfer_function/state_space，pass/scale 连接；忽略偏置、限幅、初值",
            (
                f"z 域延迟边为精确 z⁻¹；s 域延迟边按 e^(-s·{delay_seconds:g}) 的 {delay_pade_order} 阶 Padé 近似"
                if domain == "s"
                else "z 域延迟边为精确 z⁻¹"
            ),
            "输入节点以外的独立源按 0 处理；非线性节点明确报错，不静默线性化",
            "结果只作数学形式呈现，不参与求解",
        ],
        "source": "symbolic（sympy）；线性网络节点方程求总传函",
    }






def _node_frequency_gain(node: Any, omega: float) -> complex:
    """单个 signal 节点在 jω 处的局部复增益。"""
    kind = node.kind
    params = getattr(node, "params", None) or {}
    if kind == "sum":
        return 1.0 + 0.0j
    if kind == "gain":
        return complex_layer.as_complex(params.get("gain", 1.0))
    if kind == "lag":
        tau = float(params.get("tau", 0.1))
        return 1.0 / (1.0 + 1j * omega * tau)
    if kind == "integrate":
        if omega == 0.0:
            raise AnalysisError(f"积分节点 {node.name!r} 在 0 Hz 处没有有限频响")
        return complex_layer.as_complex(params.get("gain", 1.0)) / (1j * omega)
    if kind == "transfer_function":
        try:
            return complex(transfer_math.from_params(params).at(1j * omega))
        except Exception as exc:
            raise AnalysisError(
                f"节点 {node.name!r} 的传递函数参数无效：{exc}"
            ) from exc
    if kind == "state_space":
        try:
            model = StateSpaceModel.from_params(params)
            if model.b.shape[1] != 1 or model.c.shape[0] != 1:
                raise AnalysisError(
                    f"状态空间节点 {node.name!r} 只支持单输入单输出频响"
                )
            matrix = 1j * omega * np.eye(model.a.shape[0]) - model.a
            value = model.c @ np.linalg.solve(matrix, model.b) + model.d
            return complex(value[0, 0])
        except AnalysisError:
            raise
        except Exception as exc:
            raise AnalysisError(f"状态空间节点 {node.name!r} 频响失败：{exc}") from exc
    if kind in {"manual", "signal"}:
        return 0.0 + 0.0j
    raise AnalysisError(
        f"节点 {node.name!r}（kind={kind!r}）不在频响支持范围内；"
        "目前支持 gain/sum/lag/integrate/transfer_function/state_space"
    )


def _edge_frequency_weight(edge: Any, dt: float, omega: float) -> complex:
    if edge.kind == "pass":
        base = 1.0 + 0.0j
    elif edge.kind == "scale":
        base = complex_layer.as_complex((edge.params or {}).get("gain", 1.0))
    else:
        raise AnalysisError(
            f"连接 {edge.name!r} 的边类型 {edge.kind!r} 不在频响支持范围内"
        )
    if edge.delay:
        if dt <= 0.0:
            raise AnalysisError(f"连接 {edge.name!r} 带延迟，但仿真步长 dt 不是正数")
        base *= np.exp(-1j * omega * dt)
    return base


def _signal_frequency_response(
    sim: Any,
    input_node: str,
    output_node: str,
    frequencies: np.ndarray,
    diag_sink: dict | None = None,
) -> np.ndarray:
    scene = sim.scene
    nodes = {node.name: node for node in scene.nodes.values()}
    nodes_by_id = {node.id: node for node in scene.nodes.values()}
    if input_node not in nodes or output_node not in nodes:
        raise AnalysisError("输入/输出节点名不存在")
    nonlinear = {
        "expression",
        "clip",
        "deadband",
        "saturate",
        "lookup",
        "table",
        "piecewise",
    }
    for node in nodes.values():
        if node.kind in nonlinear:
            raise AnalysisError(
                f"网络含非线性节点 {node.name!r}（kind={node.kind!r}），不适用线性频响"
            )
    names = list(nodes)
    index = {name: position for position, name in enumerate(names)}
    dt = float(getattr(sim.config, "dt", 0.0) or 0.0)
    values = np.empty(frequencies.size, dtype=np.complex128)
    diag_points: list[dict[str, Any]] = []
    for position, frequency in enumerate(frequencies):
        omega = 2.0 * math.pi * float(frequency)
        matrix = np.zeros((len(names), len(names)), dtype=np.complex128)
        rhs = np.zeros(len(names), dtype=np.complex128)
        for row, name in enumerate(names):
            node = nodes[name]
            if name == input_node:
                matrix[row, row] = 1.0
                rhs[row] = 1.0
                continue
            local = _node_frequency_gain(node, omega)
            matrix[row, row] = 1.0
            for edge in scene.edges.values():
                if not edge.enabled or edge.target != node.id:
                    continue
                source = nodes_by_id.get(edge.source)
                if source is None:
                    continue
                weight = _edge_frequency_weight(edge, dt, omega)
                if node.kind == "sum":
                    weights = node.params.get("weights") or {}
                    weight *= float(weights.get(edge.name, 1.0))
                matrix[row, index[source.name]] -= local * weight
        try:
            solution = np.linalg.solve(matrix, rhs)
        except np.linalg.LinAlgError as exc:
            raise AnalysisError(f"频响节点方程在 {frequency:g} Hz 处奇异") from exc
        values[position] = solution[index[output_node]]
        if diag_sink is not None:
            diag_points.append(_freq_point(matrix, rhs, solution))
    if diag_sink is not None:
        diag_sink["points"] = diag_points
    return values


def _circuit_frequency_response(
    sim: Any,
    input_source: str,
    output_probe: str,
    frequencies: np.ndarray,
) -> np.ndarray:
    try:
        result = sim.ac_sweep(
            frequencies.tolist(),
            input_source=input_source,
            probes=[output_probe],
        )
    except Exception as exc:
        raise AnalysisError(f"电路 AC 频响失败：{exc}") from exc
    row = (result.get("probes") or {}).get(output_probe)
    if not isinstance(row, dict):
        raise AnalysisError(f"电路频响没有返回探针 {output_probe!r}")
    real = row.get("real")
    imag = row.get("imag")
    if isinstance(real, list) and isinstance(imag, list):
        return np.asarray(real, dtype=np.complex128) + 1j * np.asarray(
            imag, dtype=np.complex128
        )
    magnitude = np.asarray(row.get("magnitude", []), dtype=float)
    phase = np.radians(np.asarray(row.get("phase_deg", []), dtype=float))
    return magnitude * np.exp(1j * phase)


def frequency_response(
    sim: Any,
    input: str,
    output: str,
    *,
    f_start: float = 1.0,
    f_stop: float = 1_000_000.0,
    points: int = 241,
    scale: str = "log",
    input_field: str = "voltage",
    output_field: str = "voltage",
) -> dict[str, Any]:
    """统一频响入口：signal 用复数节点方程，circuit 复用复数 MNA。

    时域数据、求解器状态与工程持久化都不在这里改写；本函数只读参数并
    返回频率轴与复数值的四相表示（real/imag/magnitude/phase_deg）。
    """
    frequencies = _frequency_axis(f_start, f_stop, points, scale)
    mode = str(getattr(sim.scene, "mode", ""))
    freq_diag_points: list[dict[str, Any]] | None = None
    if mode == "signal":
        try:
            signal_diag = {"points": []} if _freq_diag_enabled() else None
            values = _signal_frequency_response(
                sim, input, output, frequencies, diag_sink=signal_diag
            )
            freq_diag_points = signal_diag["points"] if signal_diag is not None else None
        except AnalysisError as exc:
            return {
                "ok": False,
                "mode": "signal",
                "backend": "complex_graph",
                "input": input,
                "output": output,
                "frequencies_hz": [float(value) for value in frequencies],
                "reason": str(exc),
                "warnings": [],
                "source": "complex analysis layer（R39）",
            }
        backend = "complex_graph"
        assumptions = [
            "signal 节点按 jω 局部增益线性化，节点方程 (I-W(jω))y=b",
            "延迟边使用精确 e^(-jω·dt)，非 Padé 近似",
            "非线性节点明确报错，不静默线性化",
        ]
    elif mode == "circuit":
        values = _circuit_frequency_response(sim, input, output, frequencies)
        backend = "complex_mna"
        assumptions = [
            "复用电路 DC 工作点与复数 MNA 小信号分析",
            "线性元件按复阻抗 stamp；非线性元件仍由 AC 分析拒绝",
        ]
    else:
        raise AnalysisError(f"当前模式 {mode!r} 不支持频响分析")
    real, imag = complex_layer.complex_parts(values)
    phase = complex_layer.phase_degrees(values)
    return {
        "ok": True,
        "mode": mode,
        "backend": backend,
        "input": input,
        "output": output,
        "input_field": input_field,
        "output_field": output_field,
        "frequencies_hz": [float(value) for value in frequencies],
        "omega": [float(2.0 * math.pi * value) for value in frequencies],
        "omega_rad_s": [float(2.0 * math.pi * value) for value in frequencies],
        "real": [float(value) for value in real],
        "imag": [float(value) for value in imag],
        "magnitude": [float(abs(value)) for value in values],
        "phase_deg": [float(value) for value in phase],
        "assumptions": assumptions,
        "warnings": [],
        "diagnostics": (
            _freq_summarize(freq_diag_points)
            if freq_diag_points is not None
            else {
                "diag_enabled": False,
                "any_ill_conditioned": False,
                "max_rel_residual": None,
                "points": [],
            }
        ),
        "source": "complex analysis layer（R39）",
    }


