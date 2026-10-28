"""模块导入前校验（R04 / D12）：阻断级 / 警告级 + 干跑 1 步。

与 `blocklib` 的分工：`blocklib` 负责「文件格式 + 版本」，本模块负责「这个模块能不能
安全导入」——结构完整性、端口与内部接口一致性、嵌套引用、以及真实实例化后的干跑。

报告是纯数据（可直接 JSON 复制），前端只做展示，不再二次推断。
"""

from __future__ import annotations

import copy
from typing import Any

from .blocks import BlockDef, BlockStore, BlockRuntime
from .limits import NetlabError, ValidationError

MAX_REPORT_ITEMS = 40


def _item(code: str, message: str, *, where: str = "", hint: str = "") -> dict[str, str]:
    item = {"code": code, "message": message}
    if where:
        item["where"] = where
    if hint:
        item["hint"] = hint
    return item


def _interface_ports(block: BlockDef) -> set[str]:
    ports: set[str] = set()
    for node in block.nodes:
        if node.get("kind") not in ("module_input", "module_output"):
            continue
        params = node.get("params") or {}
        if str(params.get("role", "interface")) != "interface":
            continue
        ports.add(str(params.get("port_name") or node.get("name") or ""))
    return ports


def _child_block_ids(block: BlockDef) -> list[tuple[str, str]]:
    """返回 [(node_id, child_block_id)]。"""
    result: list[tuple[str, str]] = []
    for node in block.nodes:
        if node.get("kind") != "block":
            continue
        child = str((node.get("params") or {}).get("block_id") or "")
        if child:
            result.append((str(node.get("id") or ""), child))
    return result


def validate_block_payload(
    payload: dict[str, Any],
    *,
    library: str | None = None,
    dry_run: bool = True,
    dt: float = 0.01,
) -> dict[str, Any]:
    """校验一个模块 payload；返回可复制的结构化报告。"""
    blocking: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    block: BlockDef | None = None

    # 1) 结构/端口/字段
    try:
        block = BlockDef.from_payload(payload)
    except (ValidationError, NetlabError) as exc:
        return {
            "ok": False,
            "summary": {"blocking": 1, "warnings": 0, "dry_run": "skipped"},
            "block": {},
            "blocking": [_item("structure", str(exc))],
            "warnings": warnings,
        }

    try:
        from .blocklib import validate_block_structure

        validate_block_structure(block)
    except NetlabError as exc:
        return {
            "ok": False,
            "summary": {"blocking": 1, "warnings": 0, "dry_run": "skipped"},
            "block": {"id": block.id, "name": block.name, "version": block.version},
            "blocking": [_item("structure", str(exc))],
            "warnings": warnings,
        }

    if len(block.nodes) == 0:
        warnings.append(_item("empty_body", "模块内部没有任何节点", hint="空模块可以导入，但实例化后没有计算"))
    if len(block.edges) == 0 and len(block.nodes) > 1:
        warnings.append(_item("no_internal_edges", "模块有多个内部节点但没有任何连接"))
    if not block.description.strip():
        warnings.append(_item("missing_description", "模块缺少描述"))
    if not block.output_ports:
        warnings.append(_item("no_output", "模块没有输出端口，实例化后不会向上游产出数据"))
    if not block.input_ports:
        warnings.append(_item("no_input", "模块没有输入端口"))

    interface = {name for name in _interface_ports(block) if name}
    declared = {port.name for port in block.ports}
    for port in block.ports:
        if port.name not in interface:
            blocking.append(
                _item(
                    "port_without_interface",
                    f"端口 {port.name!r} 没有对应的内部接口节点",
                    where=f"ports/{port.name}",
                    hint="封装生成的模块会自动带接口节点；手写模块需要补 module_input/module_output（role=interface）",
                )
            )
        if not port.fields:
            warnings.append(
                _item("port_without_fields", f"端口 {port.name!r} 没有字段声明", where=f"ports/{port.name}")
            )
    for name in sorted(interface - declared):
        warnings.append(
            _item(
                "interface_without_port",
                f"内部接口节点 {name!r} 没有在 ports 中声明",
                where=f"nodes/{name}",
            )
        )

    # 2) 端口映射（场景层才会出现；模块文件里若带了也要一致）
    for index, node in enumerate(block.nodes):
        if node.get("kind") != "block":
            continue
        params = node.get("params") or {}
        child = str(params.get("block_id") or "")
        if child == block.id:
            blocking.append(_item("self_reference", "模块直接包含自身", where=f"nodes[{index}]"))
        if not child:
            blocking.append(_item("missing_child_id", "嵌套块节点缺少 block_id", where=f"nodes[{index}]"))

    # 3) 干跑：把模块真实实例化并推进 1 步
    dry_status = "skipped"
    if dry_run:
        store = BlockStore()
        try:
            store.add(copy.deepcopy(block))
            missing_children: list[str] = []
            if library:
                from . import blocklib

                for node_id, child_id in _child_block_ids(block):
                    if child_id == block.id or store.get(child_id) is not None:
                        continue
                    try:
                        child_block = blocklib.load_block(library, child_id)
                    except (NetlabError, OSError):
                        missing_children.append(child_id)
                        continue
                    store.add(copy.deepcopy(child_block))
            if missing_children:
                warnings.append(
                    _item(
                        "missing_child_module",
                        "嵌套模块不在库中：" + "、".join(sorted(set(missing_children))),
                        hint="干跑会跳过缺失的子模块；补齐库文件后再校验一次",
                    )
                )
            runtime = BlockRuntime(store.require(block.id), store, depth=0)
            inputs = {
                port.name: {field: float(port.default or 0.0) for field in (port.fields or ["voltage"])}
                for port in block.input_ports
            }
            runtime.step(float(dt), inputs)
            dry_status = "passed"
        except (NetlabError, Exception) as exc:
            dry_status = "failed"
            blocking.append(
                _item(
                    "dry_run",
                    f"干跑失败：{exc}",
                    hint=f"block_id={block.id} version={block.version}；先修内部计算/连接再看报告",
                )
            )

    report = {
        "ok": not blocking,
        "summary": {
            "blocking": len(blocking),
            "warnings": len(warnings),
            "dry_run": dry_status,
        },
        "block": {
            "id": block.id,
            "name": block.name,
            "version": block.version,
            "mode": block.mode,
            "model": block.model,
            "inputs": [port.name for port in block.input_ports],
            "outputs": [port.name for port in block.output_ports],
            "nodes": len(block.nodes),
            "edges": len(block.edges),
        },
        "blocking": blocking[:MAX_REPORT_ITEMS],
        "warnings": warnings[:MAX_REPORT_ITEMS],
    }
    return report


def report_as_text(report: dict[str, Any]) -> str:
    """可直接复制给用户/日志的纯文本报告。"""
    lines = [
        f"模块 {report.get('block', {}).get('name') or '?'} "
        f"(id={report.get('block', {}).get('id')}, v{report.get('block', {}).get('version')})",
        f"结论：{'通过' if report.get('ok') else '阻断'}；"
        f"阻断 {report.get('summary', {}).get('blocking', 0)} 项 / "
        f"警告 {report.get('summary', {}).get('warnings', 0)} 项 / "
        f"干跑 {report.get('summary', {}).get('dry_run')}",
    ]
    if report.get("blocking"):
        lines.append("阻断：")
        lines.extend(f"  - [{item['code']}] {item['message']}" for item in report["blocking"])
    if report.get("warnings"):
        lines.append("警告：")
        lines.extend(f"  - [{item['code']}] {item['message']}" for item in report["warnings"])
    return "\n".join(lines)


__all__ = ["validate_block_payload", "report_as_text"]
