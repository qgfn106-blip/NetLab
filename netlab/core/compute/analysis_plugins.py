"""插件分析算法注册表（R40）。

平台核心分析（TF/相图/频响/AC 扫描）仍走各自模块；这里只登记插件提供的
``AnalysisSpec``，并把结果统一成可 JSON 的 ``series/table/summary`` 信封。
"""

from __future__ import annotations

from typing import Any

from ...plugin_api.v1 import AnalysisContext, AnalysisResult, AnalysisSpec


ANALYSIS_SPECS: dict[str, AnalysisSpec] = {}


def register_analysis(spec: AnalysisSpec, *, plugin_id: str = "") -> AnalysisSpec:
    if spec.kind in ANALYSIS_SPECS:
        raise RuntimeError(f"重复注册分析算法：{spec.kind}")
    ANALYSIS_SPECS[spec.kind] = spec
    if plugin_id:
        object.__setattr__(spec, "_plugin_id", plugin_id)
    return spec


def unregister_analysis(kind: str) -> None:
    ANALYSIS_SPECS.pop(kind, None)


def analysis_catalog() -> list[dict[str, Any]]:
    return [
        {
            "kind": spec.kind,
            "label": spec.label,
            "description": spec.description,
            "modes": list(spec.modes),
            "params": [param.to_dict() for param in spec.params],
        }
        for spec in ANALYSIS_SPECS.values()
    ]


def _finite(value: Any) -> bool:
    import math

    return isinstance(value, (int, float)) and math.isfinite(float(value))


def validate_analysis_result(result: AnalysisResult) -> AnalysisResult:
    if result.kind not in ("series", "table", "summary"):
        raise ValueError(f"分析结果 kind 非法：{result.kind}")
    for series in result.series:
        for key in ("x", "y"):
            values = series.get(key)
            if not isinstance(values, list) or len(values) != len(
                series.get("x" if key == "y" else "y", [])
            ):
                raise ValueError("series 的 x/y 必须等长数组")
            if not all(_finite(item) for item in values):
                raise ValueError("series 只允许有限数值")
    return result


def run_analysis(
    kind: str,
    *,
    scene: Any,
    simulation: Any | None = None,
    params: dict[str, Any] | None = None,
    probes: list[str] | None = None,
    input_node: str | None = None,
    output_node: str | None = None,
) -> dict[str, Any]:
    spec = ANALYSIS_SPECS.get(kind)
    if spec is None:
        raise KeyError(f"未知分析算法：{kind}")
    ctx = AnalysisContext(
        scene=scene,
        simulation=simulation,
        params=dict(params or {}),
        probes=list(probes or []),
        input_node=input_node,
        output_node=output_node,
    )
    result = spec.run(ctx)
    if not isinstance(result, AnalysisResult):
        raise TypeError("AnalysisSpec.run 必须返回 AnalysisResult")
    validate_analysis_result(result)
    return {
        "ok": True,
        "kind": result.kind,
        "series": result.series,
        "table": result.table,
        "summary": result.summary,
        "warnings": result.warnings,
        "plugin_kind": kind,
    }
