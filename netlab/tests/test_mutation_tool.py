#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""WP-3：变异工具分类契约的单元测试。"""
from __future__ import annotations

from pathlib import Path

import pytest

from tools import mutation_smoke


def test_classify_missing_pattern_is_invalid():
    assert mutation_smoke.classify_outcome(pattern_found=False, compile_error=None, exit_code=0) == "invalid"


def test_classify_compile_error_is_invalid():
    assert (
        mutation_smoke.classify_outcome(pattern_found=True, compile_error="SyntaxError: invalid syntax", exit_code=None)
        == "invalid"
    )


@pytest.mark.parametrize("exit_code, expected", [(0, "survived"), (1, "killed"), (2, "invalid"), (3, "infra-error"), (4, "invalid"), (5, "invalid")])
def test_classify_exit_codes(exit_code, expected):
    assert mutation_smoke.classify_outcome(pattern_found=True, compile_error=None, exit_code=exit_code) == expected


def test_classify_timeout_and_launch_error_are_infra():
    assert mutation_smoke.classify_outcome(pattern_found=True, compile_error=None, exit_code=None, timed_out=True) == "infra-error"
    assert mutation_smoke.classify_outcome(pattern_found=True, compile_error=None, exit_code=None, launch_error="no python") == "infra-error"


def test_internal_error_is_infra_even_with_exit_2():
    assert (
        mutation_smoke.classify_outcome(
            pattern_found=True, compile_error=None, exit_code=2, output="INTERNALERROR> traceback"
        )
        == "infra-error"
    )


def test_build_diff_contains_target_and_change():
    diff = mutation_smoke.build_diff("netlab/core/compute/circuit/elements.py", "a\nb\n", "a\nc\n")
    assert "a/netlab/core/compute/circuit/elements.py" in diff
    assert "b/netlab/core/compute/circuit/elements.py" in diff
    assert "-b" in diff and "+c" in diff


def test_select_mutants_by_name():
    selected = mutation_smoke._select_mutants("control-comment-only,resistor-gain-5pct")
    assert [item[0] for item in selected] == ["resistor-gain-5pct", "control-comment-only"]


def test_select_unknown_mutant_fails():
    with pytest.raises(SystemExit):
        mutation_smoke._select_mutants("does-not-exist")


def test_every_mutant_pattern_is_unique_in_source_tree():
    root = Path(mutation_smoke.ROOT)
    for name, relative_path, old, _new, _expected, _counts in mutation_smoke.MUTANTS:
        text = (root / relative_path).read_text(encoding="utf-8")
        assert text.count(old) == 1, f"{name}: pattern occurs {text.count(old)} times"


def test_controls_cover_both_directions():
    controls = [item for item in mutation_smoke.MUTANTS if item[4]]
    assert any(item[4] == "survived" and not item[5] for item in controls)
    assert any(item[4] == "killed" and item[5] for item in controls)
    assert any(item[5] for item in mutation_smoke.MUTANTS if not item[4])
