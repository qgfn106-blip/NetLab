# -*- coding: utf-8 -*-
"""WP-0：命令运行器生成统一证据的回归测试。"""
from __future__ import annotations

import json
import sys

from tools import evidence, run_evidence


def test_successful_command_writes_valid_evidence(tmp_path):
    out = tmp_path / "evidence.json"
    code = run_evidence.main([
        "--tool", "unit-success",
        "--out", str(out),
        "--", sys.executable, "-c", "print('ok')",
    ])
    assert code == 0
    result = json.loads(out.read_text(encoding="utf-8"))
    assert evidence.validate_result(result) == []
    assert result["status"] == "passed"
    assert result["exit_code"] == 0
    assert result["command"][0] == sys.executable


def test_failing_command_records_real_exit_code(tmp_path):
    out = tmp_path / "evidence.json"
    code = run_evidence.main([
        "--tool", "unit-failure",
        "--out", str(out),
        "--", sys.executable, "-c", "raise SystemExit(3)",
    ])
    assert code == 3
    result = json.loads(out.read_text(encoding="utf-8"))
    assert result["status"] == "failed"
    assert result["exit_code"] == 3


def test_missing_executable_is_error(tmp_path):
    out = tmp_path / "evidence.json"
    code = run_evidence.main([
        "--tool", "unit-launch-error",
        "--out", str(out),
        "--", "definitely-not-a-real-executable-xyz",
    ])
    assert code == 127
    result = json.loads(out.read_text(encoding="utf-8"))
    assert result["status"] == "error"
    assert result["details"]["launch_error"]


def test_junit_nodeids_and_artifact_hash_are_recorded(tmp_path):
    junit = tmp_path / "junit.xml"
    junit.write_text(
        '<testsuite><testcase file="tests/test_sample.py" name="test_ok"/></testsuite>',
        encoding="utf-8",
    )
    artifact = tmp_path / "report.txt"
    artifact.write_text("abc", encoding="utf-8")
    out = tmp_path / "evidence.json"
    code = run_evidence.main([
        "--tool", "unit-junit",
        "--out", str(out),
        "--junit", str(junit),
        "--artifact", str(artifact),
        "--", sys.executable, "-c", "print('ok')",
    ])
    assert code == 0
    result = json.loads(out.read_text(encoding="utf-8"))
    assert result["nodeids"] == ["tests/test_sample.py::test_ok"]
    assert result["artifacts"][0]["sha256"] == evidence.sha256_bytes(b"abc")
    assert result["artifacts"][0]["bytes"] == 3
