"""B3 R1：contracts 纯类型层守卫——可导入、无 compute 实现依赖。"""
from __future__ import annotations

import re
from pathlib import Path

import netlab.core.model.contracts.clock  # noqa: F401
import netlab.core.model.contracts.compute  # noqa: F401
import netlab.core.model.contracts.solver  # noqa: F401
import netlab.core.model.contracts.simulation  # noqa: F401
from netlab.core.model.contracts.clock import SimClockProtocol
from netlab.core.model.contracts.compute import NodeData
from netlab.core.model.contracts.solver import CircuitNodeProtocol


CONTRACTS_DIR = Path(__file__).resolve().parent.parent / "core" / "model" / "contracts"


def test_contracts_importable():
    import netlab.core.model.contracts as c  # noqa: F401


def test_nodedata_and_protocols_usable():
    nd = NodeData({"v": 1.0})
    assert nd.values["v"] == 1.0

    class _Node:
        id = "n1"
        name = "N1"
        ground = False

    class _Clock:
        def tick(self, dt: float) -> None:
            return None

        def now(self) -> float:
            return 0.0

    assert isinstance(_Node(), CircuitNodeProtocol)
    assert isinstance(_Clock(), SimClockProtocol)


def test_contracts_have_no_compute_imports():
    bad = []
    for f in CONTRACTS_DIR.glob("*.py"):
        for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(r"^\s*(from|import)\s+.*\bcompute\b", line):
                bad.append(f"{f.name}:{i}:{line.strip()}")
    assert not bad, bad


def test_contracts_only_stdlib_or_relative():
    for f in CONTRACTS_DIR.glob("*.py"):
        for line in f.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if not (s.startswith("from ") or s.startswith("import ")):
                continue
            ok = (
                s.startswith("from __future__")
                or s.startswith("from typing")
                or s.startswith("from dataclasses")
                or s.startswith("from collections")
                or s.startswith("from .")
                or s.startswith("import ")
            )
            assert ok, (f.name, s)
