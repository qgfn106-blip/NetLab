"""P3 分析旁路 facade：公共 API 保持在 analysis 模块上，具体实现分层到
analysis_metrics / analysis_transfer / analysis_envelopes / analysis_loop。
"""
from __future__ import annotations

import threading
import time
from typing import Any, Callable

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
from .analysis_metrics import (
    analyze_metrics,
    export_csv,
    math_forms,
    numeric_precision_mode,
    phase_metrics,
    recommend_period,
    set_numeric_precision_mode,
    spectrum,
)
from .analysis_transfer import frequency_response, transfer_function
from .analysis_envelopes import DescriptorModel, _circuit_tf_analysis, tf_analysis
from .analysis_loop import (
    break_points,
    loop_analysis,
    loop_candidates,
    loop_from_break,
    nyquist_analysis,
    nyquist_closed_analysis,
    step_open_analysis,
)


def run_with_timeout(
    function: Callable[[], Any], seconds: float = ANALYSIS_TIMEOUT, label: str = "分析"
) -> Any:
    """线程级超时保护（R13）：超时返回可定位错误；无法强杀线程，只保证请求不再阻塞。"""
    box: dict[str, Any] = {}
    started = time.perf_counter()

    def target() -> None:
        try:
            box["value"] = function()
        except BaseException as exc:  # noqa: BLE001 - 原样抛回
            box["error"] = exc

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    thread.join(seconds)
    if thread.is_alive():
        raise AnalysisError(
            f"{label}超时（>{seconds:g}s）；缩小时间窗/抽稀或改用频域分析"
        )
    if "error" in box:
        raise box["error"]
    result = box.get("value")
    if isinstance(result, dict):
        result["elapsed_ms"] = round((time.perf_counter() - started) * 1000.0, 3)
    return result


__all__ = [
    "AnalysisError",
    "analyze_metrics",
    "spectrum",
    "recommend_period",
    "math_forms",
    "transfer_function",
    "tf_analysis",
    "frequency_response",
    "phase_metrics",
    "export_csv",
    "run_with_timeout",
]
