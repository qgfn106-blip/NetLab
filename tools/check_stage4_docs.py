# -*- coding: utf-8 -*-
"""Stage 4 design-document contract checker.

This checker is deliberately *not* a no-op: it fails on missing docs, missing
Proposed markers, private paths, missing unified interface members, and the
specific P0/P1/P2 defects that the Stage 4 remediation task book identified.
Semantic review items are reported as MANUAL (never silently passed).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parents[1] / "netlab" / "docs"

REQUIRED = [
    "CORE_MODEL_V2.md",
    "TYPED_PORT_SYSTEM.md",
    "ENGINE_SPI_V2.md",
    "ARCHITECTURE_BOUNDARIES.md",
    "CORE_OBJECT_RELATIONSHIP.md",
    "ENGINE_LIFECYCLE.md",
    "CORE_INTERFACE_CONTRACTS.md",
    "MIGRATION_AND_COMPATIBILITY.md",
    "MINIMAL_DATA_MODEL_EXAMPLE.md",
]

FORBIDDEN = (
    "127.0.0.1:7897",
    "127.0.0.1:7900",
    ".dsh-meow",
    "E:\\Python",
    "C:\\Users\\",
    "D:\\Program Files",
)


def read(name: str) -> str:
    return (DOCS / name).read_text(encoding="utf-8")


def check_docs() -> list[str]:
    errors: list[str] = []
    for name in REQUIRED:
        p = DOCS / name
        if not p.exists():
            errors.append(f"MISSING {name}")
            continue
        text = read(name)
        if "Proposed" not in text:
            errors.append(f"{name}: missing Proposed marker")
        for bad in FORBIDDEN:
            if bad in text:
                errors.append(f"{name}: forbidden private string {bad!r}")

    contracts = read("CORE_INTERFACE_CONTRACTS.md")
    engine = read("ENGINE_SPI_V2.md")
    minimal = read("MINIMAL_DATA_MODEL_EXAMPLE.md")
    typed = read("TYPED_PORT_SYSTEM.md")
    core_model = read("CORE_MODEL_V2.md")

    # P0-02: one complete EngineSpec definition, factory present in both.
    if "factory" not in engine:
        errors.append("ENGINE_SPI_V2.md: EngineSpec.factory missing")
    if "factory: Callable" not in contracts:
        errors.append("CORE_INTERFACE_CONTRACTS.md: EngineSpec.factory missing")

    # P0-02: PluginFacade must expose every method used elsewhere.
    for method in ("register_edge_kind", "read_compiled_summary", "register_port_type", "register_node_kind"):
        if f"def {method}" not in contracts:
            errors.append(f"CORE_INTERFACE_CONTRACTS.md: PluginFacade.{method} missing")

    # P0-01: RC example must contain C1 and ground the reference node, not vout.
    if '"id": "C1"' not in minimal:
        errors.append("MINIMAL_DATA_MODEL_EXAMPLE.md: capacitor C1 missing")
    if re.search(r'"kind":\s*"ground"[^}]*"target":\s*"vout"', minimal):
        errors.append("MINIMAL_DATA_MODEL_EXAMPLE.md: output still shorted by a ground/fixed constraint")
    if '"target": "gnd"' not in minimal:
        errors.append("MINIMAL_DATA_MODEL_EXAMPLE.md: ground constraint target missing")

    # P1-01: mechanical example must not zero the body velocity via a fixed constraint.
    if re.search(r'"kind":\s*"fixed"[^}]*"target":\s*"v_body"', minimal):
        errors.append("MINIMAL_DATA_MODEL_EXAMPLE.md: mechanical constraint still fixes v_body")
    if "d(v_body)/dt" not in minimal:
        errors.append("MINIMAL_DATA_MODEL_EXAMPLE.md: mechanical ODE missing")

    # P0-03: independent PortDesc with coordinate_frame; NodeDesc has ports.
    if "class PortDesc" not in minimal or "coordinate_frame" not in minimal:
        errors.append("MINIMAL_DATA_MODEL_EXAMPLE.md: PortDesc/coordinate_frame missing")
    if "ports: tuple[PortDesc" not in minimal and "ports: tuple[\"PortDesc\"" not in minimal:
        errors.append("MINIMAL_DATA_MODEL_EXAMPLE.md: NodeDesc.ports not typed as PortDesc")

    # P0-04: appearance must not be a Description field.
    if "appearance:" in core_model:
        errors.append("CORE_MODEL_V2.md: Appearance still declared on a Description object")
    if "appearance" in minimal and "presentation" not in minimal:
        errors.append("MINIMAL_DATA_MODEL_EXAMPLE.md: appearance handled without Presentation layer")

    # P2-01: seven base dimensions.
    if "[L, M, T, I, Θ, N, J]" not in typed:
        errors.append("TYPED_PORT_SYSTEM.md: dimension header is not 7-base")
    if "[2, 1, -3, -1, 0, 0, 0]" not in typed:
        errors.append("TYPED_PORT_SYSTEM.md: voltage dimension not 7-element")

    return errors


def main() -> int:
    errors = check_docs()
    if errors:
        print("STAGE4 DOC CHECK FAILED")
        for e in errors:
            print(" -", e)
        return 1
    print("STAGE4 DOC CHECK PASSED")
    print("MANUAL: semantic review of physics/design consistency still required (task book round 2/4)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
