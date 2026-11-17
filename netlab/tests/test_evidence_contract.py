# -*- coding: utf-8 -*-
"""WP-0：统一证据结果契约的回归测试。"""
from __future__ import annotations

import json

from tools import evidence


def _make(**overrides):
    payload = {
        "tool": "unit-test",
        "root": ".",
        "command": ["python", "-c", "print('ok')"],
        "exit_code": 0,
        "duration_ms": 1,
        "status": "passed",
    }
    payload.update(overrides)
    return evidence.make_result(**payload)


def test_result_contains_required_contract_fields():
    result = _make()
    assert evidence.validate_result(result) == []
    for field in evidence.REQUIRED_FIELDS:
        assert field in result


def test_canonical_json_is_stable_across_roundtrip():
    result = _make(details={"b": 2, "a": 1})
    first = evidence.canonical_json(result)
    second = evidence.canonical_json(json.loads(first))
    assert first == second


def test_missing_ci_run_id_is_explicitly_not_verified(monkeypatch):
    monkeypatch.delenv("GITHUB_RUN_ID", raising=False)
    result = _make()
    assert result["ci"]["status"] == "CI_NOT_VERIFIED"
    assert evidence.ci_binding_status(result) == "CI_NOT_VERIFIED"


def test_ci_run_id_marks_verified(monkeypatch):
    monkeypatch.setenv("GITHUB_RUN_ID", "123456")
    monkeypatch.setenv("GITHUB_SHA", "a" * 40)
    result = _make()
    assert result["ci"]["status"] == "CI_VERIFIED"
    assert evidence.ci_binding_status(result) == "CI_VERIFIED"


def test_artifact_record_captures_hash_and_size(tmp_path):
    sample = tmp_path / "sample.bin"
    sample.write_bytes(b"abc")
    record = evidence.artifact_record(sample, "log")
    assert record["bytes"] == 3
    assert record["sha256"] == evidence.sha256_bytes(b"abc")
    assert record["role"] == "log"


def test_validate_reports_missing_required_fields():
    result = _make()
    result.pop("repository")
    problems = evidence.validate_result(result)
    assert any("repository" in problem for problem in problems)
