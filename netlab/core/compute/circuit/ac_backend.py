"""AC 扫频后端策略（P2-02 收敛）。

把 DescriptorModel.frequency_response 里长期并存的两条实现收敛为可插拔的
AcSweepStrategy，descriptor 只负责"选策略"，不再把两条实现内联在方法体里：

- FastLinearStrategy：纯线性电路（全部 kind ∈ CircuitSolver.AC_KINDS）时
  委托 canonical AC 核 CircuitSolver._ac_bode（Woodbury 快速路径），与
  CircuitSolver.ac_sweep 逐点一致。
- NativePerFrequencyStrategy：描述符原生后端，每频点 build + solve，
  用于 ac_backend='descriptor' 强制回退，以及 canonical 不覆盖的线性化路径。

数值与 API 保持不变；模块内局部 import solver 以避免循环导入
（solver 依赖 circuit 包，descriptor 依赖 solver）。
"""
from __future__ import annotations

import math
from abc import ABC, abstractmethod
from typing import Any, Iterable, Sequence


class AcSweepStrategy(ABC):
    """AC 扫频策略：给定描述符模型与频率序列，产出 Bode 数据字典。"""

    name: str = "base"

    @abstractmethod
    def sweep(
        self,
        model: Any,
        frequencies: Sequence[float],
        *,
        input_source: str | None = None,
        probes: Sequence[str] | None = None,
    ) -> dict[str, Any]:
        raise NotImplementedError


class FastLinearStrategy(AcSweepStrategy):
    """纯线性电路的 canonical 快速路径。"""

    name = "fast"

    def sweep(
        self,
        model: Any,
        frequencies: Sequence[float],
        *,
        input_source: str | None = None,
        probes: Sequence[str] | None = None,
    ) -> dict[str, Any]:
        from .solver import CircuitSolver  # 局部导入避免循环

        core = dict(
            CircuitSolver(model.nodes, model.elements)._ac_bode(
                list(frequencies),
                input_source=input_source,
                probes=list(probes) if probes else None,
            )
        )
        core["omega_rad_s"] = [2.0 * math.pi * frequency for frequency in frequencies]
        core["omega"] = list(core["omega_rad_s"])
        return model._attach_diagnostics(core, input_source)


class NativePerFrequencyStrategy(AcSweepStrategy):
    """描述符原生逐频点重建 + 求解路径。"""

    name = "native"

    def sweep(
        self,
        model: Any,
        frequencies: Sequence[float],
        *,
        input_source: str | None = None,
        probes: Sequence[str] | None = None,
    ) -> dict[str, Any]:
        system = model.build(input_source)
        resolved = model._resolve_probes(probes)
        omegas = [2.0 * math.pi * frequency for frequency in frequencies]

        output: dict[str, Any] = {
            "frequencies": list(frequencies),
            "omega_rad_s": omegas,
            "omega": list(omegas),
            "input": system.input_source,
            "probes": {},
        }
        chains = {
            token: {
                "real": [],
                "imag": [],
                "magnitude": [],
                "phase_deg": [],
                "db": [],
            }
            for token, _ in resolved
        }
        for token in chains:
            output["probes"][token] = chains[token]

        for omega in omegas:
            solution = system.solve(omega)
            for token, probe in resolved:
                value = model._probe_value(probe, solution, omega, system.input_source)
                magnitude = abs(value)
                chain = chains[token]
                chain["real"].append(float(value.real))
                chain["imag"].append(float(value.imag))
                chain["magnitude"].append(float(magnitude))
                chain["phase_deg"].append(
                    math.degrees(math.atan2(value.imag, value.real))
                )
                chain["db"].append(20.0 * math.log10(max(magnitude, 1.0e-30)))
        return model._attach_diagnostics(output, input_source, system)


def select_strategy(model: Any) -> AcSweepStrategy:
    """按模型能力与 ac_backend 开关选择默认策略。"""
    from .solver import CircuitSolver

    if getattr(model, "ac_backend", "legacy") == "descriptor":
        return NativePerFrequencyStrategy()
    if all(element.kind in CircuitSolver.AC_KINDS for element in model.elements):
        return FastLinearStrategy()
    return NativePerFrequencyStrategy()


def ac_sweep(
    model: Any,
    frequencies: Iterable[float],
    *,
    input_source: str | None = None,
    probes: Sequence[str] | None = None,
    strategy: AcSweepStrategy | None = None,
) -> dict[str, Any]:
    """统一 AC 扫频入口：校验频率 → 选策略 → 执行 → 标注所用策略。"""
    values = model._validate_frequencies(frequencies)
    chosen = strategy if strategy is not None else select_strategy(model)
    result = chosen.sweep(
        model, values, input_source=input_source, probes=probes
    )
    result.setdefault("frequencies", list(values))
    if "omega_rad_s" not in result:
        result["omega_rad_s"] = [2.0 * math.pi * frequency for frequency in values]
    result.setdefault("omega", list(result["omega_rad_s"]))
    result["strategy"] = chosen.name
    return result
