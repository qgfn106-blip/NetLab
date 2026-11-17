"""REM-B5-02：低覆盖模块最小测试（safeexpr / analysis_plugins / extensions）。

纯测试、零生产代码改动。覆盖各模块公开 API 的正常与拒绝路径，不追求全分支，
仅把此前未覆盖的入口纳入回归。
"""
from __future__ import annotations

import math

import pytest

from netlab.core.common.limits import ComputeError


def test_safeexpr_basic() -> None:
    from netlab.core.compute.safeexpr import evaluate

    assert evaluate("1 + 2 * 3", {}) == 7.0
    assert evaluate("a * b + c", {"a": 2, "b": 3, "c": 4}) == 10.0


def test_safeexpr_function() -> None:
    from netlab.core.compute.safeexpr import evaluate

    assert evaluate("sin(0)", {}) == 0.0
    assert abs(evaluate("cos(0)", {}) - 1.0) < 1e-12


def test_safeexpr_rejects_empty_and_nonnumeric() -> None:
    from netlab.core.compute.safeexpr import evaluate

    with pytest.raises(ComputeError):
        evaluate("", {})
    with pytest.raises(ComputeError):
        evaluate("a + 1", {"a": math.nan})


def test_safeexpr_rejects_dangerous() -> None:
    from netlab.core.compute.safeexpr import evaluate

    with pytest.raises(ComputeError):
        evaluate("__import__('os').system('echo x')", {})


def test_safeexpr_names() -> None:
    from netlab.core.compute.safeexpr import expression_names

    assert expression_names("a + b * c") == {"a", "b", "c"}


def test_analysis_register_run_catalog_unregister() -> None:
    from netlab.core.compute import analysis_plugins as ap
    from netlab.plugin_api.v1 import AnalysisResult, AnalysisSpec

    kind = "b5_02_summary"
    spec = AnalysisSpec(
        kind=kind,
        label="B5-02 摘要",
        description="最小测试",
        params=(),
        modes=("signal",),
        run=lambda ctx: AnalysisResult(kind="summary", summary={"p": ctx.params.get("p", 0)}),
    )
    ap.register_analysis(spec)
    try:
        assert any(c["kind"] == kind for c in ap.analysis_catalog())
        out = ap.run_analysis(kind, scene=object(), params={"p": 5})
        assert out["ok"] is True and out["summary"]["p"] == 5
    finally:
        ap.unregister_analysis(kind)
    with pytest.raises(KeyError):
        ap.run_analysis(kind, scene=object())


def test_analysis_duplicate_register_rejected() -> None:
    from netlab.core.compute import analysis_plugins as ap
    from netlab.plugin_api.v1 import AnalysisSpec

    kind = "b5_02_dup"
    spec = AnalysisSpec(kind=kind, label="x", description="", params=(), modes=("signal",), run=lambda ctx: None)
    ap.register_analysis(spec)
    try:
        with pytest.raises(RuntimeError):
            ap.register_analysis(spec)
    finally:
        ap.unregister_analysis(kind)


def test_validate_analysis_result_rejects() -> None:
    from netlab.core.compute.analysis_plugins import validate_analysis_result
    from netlab.plugin_api.v1 import AnalysisResult

    with pytest.raises(ValueError):
        validate_analysis_result(AnalysisResult(kind="bogus"))
    with pytest.raises(ValueError):
        validate_analysis_result(AnalysisResult(kind="series", series=[{"x": [1.0], "y": [1.0, 2.0]}]))


def test_extensions_list_and_validate() -> None:
    from netlab.core.common.limits import ValidationError
    from netlab.core.model import extensions

    assert isinstance(extensions.list_extensions(), list)
    assert extensions.MAX_CODE_BYTES > 0 and extensions.MAX_AST_NODES > 0
    # 未用 @node/@method 声明的代码必须被拒绝
    with pytest.raises(ValidationError):
        extensions.validate_code("def run(x):\n    return x + 1\n")


def test_extensions_validate_rejects_forbidden() -> None:
    from netlab.core.model import extensions

    with pytest.raises(Exception):
        extensions.validate_code("import os\nos.system('echo hi')\n")
