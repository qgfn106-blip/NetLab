"""结构拆分后的 analysis 公共 API 面契约测试（P2-03）。

对照 netlab/tests/fixtures/analysis_api_snapshot.json（拆分前快照）断言：
- analysis.__all__ 与公共/外部可见符号集合不变；
- 公共函数签名逐字不变；
- 迁出的纯数值函数在 analysis 上仍可访问，且即 analysis_numerics 中的同一对象（签名不变）；
- AnalysisError 及上限常量仍从 analysis 导出，且与 analysis_errors 同一对象。
不依赖 MyProject 仿真夹具，可在无数据环境运行。
"""
from __future__ import annotations

import inspect
import json
from pathlib import Path

import numpy as np
import pytest

from netlab.core.compute import analysis, analysis_errors, analysis_numerics

_SNAP_PATH = Path(__file__).parent / "fixtures" / "analysis_api_snapshot.json"
_SNAP = json.loads(_SNAP_PATH.read_text(encoding="utf-8"))


def test_all_exports_present():
    assert set(analysis.__all__) == set(_SNAP["public_all"])
    for name in _SNAP["public_all"]:
        assert hasattr(analysis, name), name


def _assert_sig(obj, meta, label):
    if meta["kind"] == "class":
        assert isinstance(obj, type), label
        assert [b.__name__ for b in obj.__bases__] == meta["bases"], label
    else:
        assert str(inspect.signature(obj)) == meta["sig"], label


@pytest.mark.parametrize("name", sorted(_SNAP["public"]))
def test_public_signature_unchanged(name):
    _assert_sig(getattr(analysis, name), _SNAP["public"][name], name)


@pytest.mark.parametrize("name", sorted(_SNAP["extra_public"]))
def test_extra_public_signature_unchanged(name):
    _assert_sig(getattr(analysis, name), _SNAP["extra_public"][name], name)


@pytest.mark.parametrize("name", sorted(_SNAP["numerics_private"]))
def test_numerics_reexported_same_object(name):
    facade = getattr(analysis, name)
    moved = getattr(analysis_numerics, name)
    assert facade is moved
    assert str(inspect.signature(facade)) == _SNAP["numerics_private"][name]["sig"]


def test_errors_and_constants_reexported():
    assert analysis.AnalysisError is analysis_errors.AnalysisError
    assert issubclass(analysis_errors.AnalysisError, Exception)
    assert analysis.ANALYSIS_TIMEOUT == analysis_errors.ANALYSIS_TIMEOUT == _SNAP["constants"]["ANALYSIS_TIMEOUT"]
    assert analysis.MAX_EXPORT_ROWS == analysis_errors.MAX_EXPORT_ROWS == _SNAP["constants"]["MAX_EXPORT_ROWS"]


def test_numerics_behavior_smoke():
    grid, resampled = analysis_numerics._uniform(
        np.array([0.0, 1.0, 2.0]), np.array([0.0, 10.0, 20.0])
    )
    assert grid.shape == resampled.shape == (3,)
    log_axis = analysis_numerics._frequency_axis(1.0, 100.0, 5, "log")
    lin_axis = analysis_numerics._frequency_axis(1.0, 100.0, 5, "lin")
    assert log_axis.shape == lin_axis.shape == (5,)
    assert np.isclose(lin_axis[0], 1.0) and np.isclose(lin_axis[-1], 100.0)
