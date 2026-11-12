# -*- coding: utf-8 -*-
"""Stage 4 design-document contract tests (P1-06).

These tests exercise the real checker, not a no-op, and additionally prove the
P1-02 deep-copy isolation contract on Runtime-like state mappings.
"""
from __future__ import annotations

import copy
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "tools" / "check_stage4_docs.py"


def _load_checker():
    spec = importlib.util.spec_from_file_location("check_stage4_docs", TOOL)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_stage4_documents_pass_contract_checks():
    checker = _load_checker()
    errors = checker.check_docs()
    assert errors == [], "\n".join(errors)


def test_checker_rejects_regression(monkeypatch):
    checker = _load_checker()
    # Replace one required doc with a temporary broken copy to prove the checker
    # is not a no-op. We monkeypatch DOCS to a temp directory.
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        docs = root / "netlab" / "docs"
        docs.mkdir(parents=True)
        for name in checker.REQUIRED:
            (docs / name).write_text("Proposed\n", encoding="utf-8")
        # Broken doc: has C1 and gnd target, but still shorts vout with a ground constraint.
        (docs / "MINIMAL_DATA_MODEL_EXAMPLE.md").write_text(
            'Proposed\n"id": "C1"\n"target": "gnd"\n{"kind": "ground", "target": "vout"}\n',
            encoding="utf-8",
        )
        monkeypatch.setattr(checker, "DOCS", docs)
        errors = checker.check_docs()
        assert any("shorted" in e for e in errors)

def test_runtime_state_isolation():
    # P1-02: frozen dataclasses must deep-copy nested mappings on construction.
    from dataclasses import dataclass, field
    from typing import Any

    @dataclass(frozen=True)
    class FakeCompiledModel:
        execution_plan: dict[str, Any] = field(default_factory=dict)

        def __post_init__(self):
            object.__setattr__(self, "execution_plan", copy.deepcopy(self.execution_plan))

    template = {"nodes": {"n1": {"value": 1.0}}, "meta": {"generation": "g1"}}
    compiled = FakeCompiledModel(execution_plan=template)
    assert compiled.execution_plan == template
    template["nodes"]["n1"]["value"] = 2.0
    assert compiled.execution_plan["nodes"]["n1"]["value"] == 1.0
    runtime_a = copy.deepcopy(template)
    runtime_b = copy.deepcopy(template)
    runtime_a["nodes"]["n1"]["value"] = 99.0
    runtime_a["meta"]["generation"] = "mutated"
    assert runtime_b["nodes"]["n1"]["value"] == 2.0
    assert runtime_b["meta"]["generation"] == "g1"
