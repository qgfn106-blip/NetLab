# -*- coding: utf-8 -*-
"""Stage 4 design-document contract checker.

This checker is deliberately *not* a no-op: it fails on missing docs, missing
Proposed markers, private paths, missing unified interface members, and the
specific P0/P1/P2 defects that the Stage 4 remediation task book identified.
Semantic review items are reported as MANUAL (never silently passed).
"""
from __future__ import annotations

import json
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
    if "| `factory` |" not in engine:
        errors.append("ENGINE_SPI_V2.md: EngineSpec.factory missing")
    if "factory: Callable" not in contracts:
        errors.append("CORE_INTERFACE_CONTRACTS.md: EngineSpec.factory missing")

    # P0-02: PluginFacade must expose every method used elsewhere.
    for method in ("register_edge_kind", "read_compiled_summary", "register_port_type", "register_node_kind", "register_analysis_spec", "register_data_format", "register_panel", "register_visual", "register_template", "register_engine_spec"):
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
    if "PortType/PortDesc 的权威定义见" not in minimal:
        errors.append("MINIMAL_DATA_MODEL_EXAMPLE.md: PortType/PortDesc 权威定义声明缺失")
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

    # P1-03: full field migration map and JSON example.
    migration = read("MIGRATION_AND_COMPATIBILITY.md")
    for token in ("NodeRecord.data", "NodeRecord.state", "EdgeRecord.state", "V1 输入", "V2 输出"):
        if token not in migration:
            errors.append(f"MIGRATION_AND_COMPATIBILITY.md: P1-03 token missing {token!r}")

    # P1-04: across/through conservation examples for three domains.
    for token in ("across", "through", "电学完整示例", "机械平动完整示例", "热学完整示例", "守恒方程"):
        if token not in typed:
            errors.append(f"TYPED_PORT_SYSTEM.md: P1-04 token missing {token!r}")

    # P1-05: three independent edge dataclasses and validation.
    for token in ("class DependencyEdge", "class PhysicalEdge", "class LayoutEdge", "def validate_edge"):
        if token not in core_model:
            errors.append(f"CORE_MODEL_V2.md: P1-05 token missing {token!r}")

    # Round-1 residual consistency checks.
    if "这是 2 节点 + 1 边" in minimal or "各 3 个节点" in minimal:
        errors.append("MINIMAL_DATA_MODEL_EXAMPLE.md: 标题/章节仍写 2 节点+1 边或「各 3 节点」，与 RC 3 节点+2 边/机械 2 节点+1 边不一致")
    if "RC 低通（3 节点 + 2 边）" not in minimal or "质量-阻尼（2 节点 + 1 边）" not in minimal:
        errors.append("MINIMAL_DATA_MODEL_EXAMPLE.md: 未明确 RC 3 节点+2 边与机械 2 节点+1 边")
    if "class PortDesc:" not in core_model:
        errors.append("CORE_MODEL_V2.md: 缺少独立 class PortDesc")
    if "port_id: str" not in core_model or "PortDirection = Literal" not in core_model:
        errors.append("CORE_MODEL_V2.md: PortDesc 未使用 port_id/PortDirection 统一签名")
    if "class PortDesc:" in minimal:
        errors.append("MINIMAL_DATA_MODEL_EXAMPLE.md: 不应重复定义 PortDesc，权威定义在 CORE_MODEL_V2.md")
    if "def __post_init__" not in contracts:
        errors.append("CORE_INTERFACE_CONTRACTS.md: 缺少 frozen Mapping 的 __post_init__ deepcopy 契约")
    for field in ("NodeRecord.name", "EdgeRecord.name", "EdgeRecord.auto_delay", "source_pin", "target_pin", "source_port", "target_port"):
        if field not in (DOCS / "MIGRATION_AND_COMPATIBILITY.md").read_text(encoding="utf-8"):
            errors.append(f"MIGRATION_AND_COMPATIBILITY.md: 逐字段表缺少 {field}")
    if "| `Node` / `NodeDesc` | 物理或功能节点描述：id、kind、ports、params、外观 |" in core_model:
        errors.append("CORE_MODEL_V2.md: 13 类对象表 NodeDesc 仍含外观")
    if "spec.factory" not in contracts:
        errors.append("CORE_INTERFACE_CONTRACTS.md: RuntimeManager.create 未声明通过 spec.factory 创建 Engine")

    # Semantic envelope/JSON checks (A2/A3 regression protection).
    def json_blocks(text: str) -> list[object]:
        blocks = re.findall(r"```json\s*\n(.*?)```", text, re.S)
        parsed: list[object] = []
        for block in blocks:
            try:
                parsed.append(json.loads(block))
            except Exception:
                continue
        return parsed

    minimal_json = json_blocks(minimal)
    if not any(
        isinstance(obj, dict)
        and "presentation" not in obj
        and isinstance(obj.get("scenes"), list)
        and obj["scenes"]
        and isinstance(obj["scenes"][0], dict)
        and "presentation" in obj["scenes"][0]
        and "domain" in obj["scenes"][0]
        for obj in minimal_json
    ):
        errors.append("MINIMAL_DATA_MODEL_EXAMPLE.md: project-level presentation or scene envelope inconsistent")

    migration_json = json_blocks((DOCS / "MIGRATION_AND_COMPATIBILITY.md").read_text(encoding="utf-8"))
    if not any(
        isinstance(obj, dict)
        and isinstance(obj.get("scenes"), list)
        and obj["scenes"]
        and isinstance(obj["scenes"][0], dict)
        and "presentation" in obj["scenes"][0]
        and "domain" in obj["scenes"][0]
        for obj in migration_json
    ):
        errors.append("MIGRATION_AND_COMPATIBILITY.md: scene envelope missing domain/presentation")

    def _has_type_key(value):
        if isinstance(value, dict):
            if "type" in value:
                return True
            return any(_has_type_key(v) for v in value.values())
        if isinstance(value, list):
            return any(_has_type_key(v) for v in value)
        return False

    if any(_has_type_key(block) for block in json_blocks(core_model)):
        errors.append("CORE_MODEL_V2.md: edge JSON still uses type instead of kind")

    # A3 field-level: edge JSON examples must expose kind/source_port/target_port.
    core_json = json_blocks(core_model)
    def walk_edges(value):
        if isinstance(value, dict):
            if "kind" in value and ("source_port" in value or "target_port" in value):
                yield value
            for child in value.values():
                yield from walk_edges(child)
        elif isinstance(value, list):
            for child in value:
                yield from walk_edges(child)
    edge_examples = [edge for obj in core_json for edge in walk_edges(obj)]
    if not edge_examples or not all("kind" in e and "source_port" in e and "target_port" in e for e in edge_examples):
        errors.append("CORE_MODEL_V2.md: Edge JSON examples must include kind/source_port/target_port")
    if edge_examples and any("type" in e and "kind" not in e for e in edge_examples):
        errors.append("CORE_MODEL_V2.md: Edge JSON example uses type without kind")

    # A4 field-level: NodeDesc.ports must be tuple[PortDesc,...], JSON ports are list[str].
    if 'ports: tuple["PortDesc", ...]' not in core_model and "ports: tuple[PortDesc, ...]" not in core_model:
        errors.append("CORE_MODEL_V2.md: NodeDesc.ports must be tuple[PortDesc, ...]")
    node_ports_ok = False
    for obj in minimal_json:
        scenes = obj.get("scenes") if isinstance(obj, dict) else None
        if not isinstance(scenes, list) or not scenes or not isinstance(scenes[0], dict):
            continue
        for node in scenes[0].get("nodes", []):
            if isinstance(node, dict) and "ports" in node:
                ports = node["ports"]
                if isinstance(ports, list) and all(isinstance(x, str) for x in ports):
                    node_ports_ok = True
    if not node_ports_ok:
        errors.append("MINIMAL_DATA_MODEL_EXAMPLE.md: node ports JSON must be list[str] (converted to tuple[PortDesc])")

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
