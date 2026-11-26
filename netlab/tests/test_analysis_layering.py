"""P3-02 analysis 分层结构测试：公共函数仍由 analysis facade 暴露且与实现模块同一对象。"""
from __future__ import annotations

from netlab.core.compute import (
    analysis,
    analysis_envelopes,
    analysis_loop,
    analysis_metrics,
    analysis_transfer,
)


def test_metrics_symbols_reexported_same_object() -> None:
    for name in ("analyze_metrics", "phase_metrics", "spectrum", "recommend_period", "math_forms", "export_csv", "numeric_precision_mode", "set_numeric_precision_mode"):
        assert getattr(analysis, name) is getattr(analysis_metrics, name), name


def test_transfer_symbols_reexported_same_object() -> None:
    for name in ("transfer_function", "frequency_response"):
        assert getattr(analysis, name) is getattr(analysis_transfer, name), name


def test_envelopes_symbols_reexported_same_object() -> None:
    for name in ("tf_analysis",):
        assert getattr(analysis, name) is getattr(analysis_envelopes, name), name


def test_loop_symbols_reexported_same_object() -> None:
    for name in ("break_points", "loop_candidates", "loop_from_break", "loop_analysis", "nyquist_analysis", "step_open_analysis", "nyquist_closed_analysis"):
        assert getattr(analysis, name) is getattr(analysis_loop, name), name


def test_layers_import_without_cycles() -> None:
    # 导入顺序固定 facade -> loop -> envelopes -> transfer -> metrics
    assert analysis_metrics.__name__.endswith("analysis_metrics")
    assert analysis_transfer.__name__.endswith("analysis_transfer")
    assert analysis_envelopes.__name__.endswith("analysis_envelopes")
    assert analysis_loop.__name__.endswith("analysis_loop")
