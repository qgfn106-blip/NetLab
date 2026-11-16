"""B3 R1：contracts 纯类型层守卫——可导入、无 compute 实现依赖。"""
from __future__ import annotations

import re
from pathlib import Path


CONTRACTS_DIR = Path(__file__).resolve().parent.parent / "core" / "model" / "contracts"


def test_contracts_importable():
    import netlab.core.model.contracts as c  # noqa: F401


def test_contracts_have_no_compute_imports():
    bad = []
    for p in CONTRACTS_DIR.glob("*.py"):
        for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(r"^\s*(from|import)\s+.*\bcompute\b", line):
                bad.append(f"{p.name}:{i}:{line.strip()}")
    assert not bad, bad


def test_contracts_only_stdlib_or_future_imports():
    allowed_top = {"from __future__", "import ", "from typing", "from dataclasses", "from collections"}
    for p in CONTRACTS_DIR.glob("*.py"):
        for line in p.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if not (s.startswith("from ") or s.startswith("import ")):
                continue
            assert s.startswith("from __future__") or s.startswith("from typing") or s.startswith("from dataclasses") or s.startswith("from collections") or s.startswith("import "), (p.name, s)
