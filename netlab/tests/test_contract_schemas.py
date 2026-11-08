"""C1 契约单一真源：schema 校验 + 生成物漂移。"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from netlab.contracts import API_VERSION, SCHEMA_VERSIONS, validate

ROOT = Path(__file__).resolve().parents[2]


def test_channel_key_valid() -> None:
    validate("channel_key", {"kind": "n", "ident": "n3", "field": "voltage"})
    validate("channel_key", {"kind": "state", "ident": "n3", "field": "0", "v": 1})


def test_channel_key_invalid() -> None:
    with pytest.raises(Exception):
        validate("channel_key", {"kind": "bogus", "ident": "n3", "field": "voltage"})
    with pytest.raises(Exception):
        validate("channel_key", {"kind": "n", "ident": "", "field": "voltage"})


def test_frame_and_project_and_plot_spec() -> None:
    validate("frame", {"t": 1.5, "values": {"a": 1.0}, "v": 1})
    validate("project", {"v": 6, "name": "demo", "scene": {"nodes": []}})
    validate("plot_spec", {"spec_version": "0.1", "figure": {}, "layers": []})
    assert API_VERSION == "1"
    assert SCHEMA_VERSIONS["project"] == 6


def test_generated_artifacts_are_in_sync() -> None:
    proc = subprocess.run(
        [sys.executable, "tools/gen_contracts.py", "--check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
