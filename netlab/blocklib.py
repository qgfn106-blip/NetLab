"""模块库文件层（R02 / D1 / D4 / D5 / D10）。

一个模块 = 一个独立文件，放在共享库的 ``library/blocks/<id>/v<N>.block``：

```
{
  "format": "netlab-block",
  "format_version": 1,
  "block": { ...BlockDef.to_payload(), "model": "behavioral|structural" },
  "checksum": "<sha256 of canonical block>"
}
```

规则（与台账一致）：

* 同 id 同 version **内容不同 → 拒绝**（D10）；内容相同 → 视为已存在；
* 版本号只能由「导入更高 version」产生，本层不做应用内 +1；
* 读取时校验格式、校验和与基本结构（节点 id 唯一、边端点存在），不做运行/干跑（R04）；
* 库扫描只读文件，不加载执行任何代码。
"""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any

from .blocks import BlockDef
from .limits import LimitError, NotFoundError, ValidationError
from .project import atomic_write, canonical_json

BLOCK_FORMAT = "netlab-block"
BLOCK_FORMAT_VERSION = 1
BLOCK_SUFFIX = ".block"
LIBRARY_BLOCKS_DIR = "blocks"
MAX_BLOCK_BYTES = 4_000_000


def _block_checksum(block_payload: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(block_payload).encode("utf-8")).hexdigest()


def block_dir(library: str | Path, block_id: str) -> Path:
    _check_id(block_id)
    return Path(library).expanduser() / LIBRARY_BLOCKS_DIR / block_id


def block_path(library: str | Path, block_id: str, version: int) -> Path:
    _check_version(version)
    return block_dir(library, block_id) / f"v{int(version)}{BLOCK_SUFFIX}"


def _check_id(block_id: Any) -> str:
    if not isinstance(block_id, str) or not block_id or len(block_id) > 40:
        raise ValidationError(f"功能块 id 不合法：{block_id!r}")
    if any(char in block_id for char in "/\\.."):
        raise ValidationError(f"功能块 id 不合法：{block_id!r}")
    return block_id


def _check_version(version: Any) -> int:
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise ValidationError("功能块版本必须是 ≥1 的整数")
    return version


def render_block_file(block: BlockDef) -> dict[str, Any]:
    payload = block.to_payload()
    return {
        "format": BLOCK_FORMAT,
        "format_version": BLOCK_FORMAT_VERSION,
        "block": payload,
        "checksum": _block_checksum(payload),
    }


def parse_block_file(payload: Any) -> BlockDef:
    """校验文件结构并还原 ``BlockDef``（不执行、不读工程）。"""
    if not isinstance(payload, dict):
        raise ValidationError("功能块文件必须是 JSON 对象")
    if payload.get("format") != BLOCK_FORMAT:
        raise ValidationError("不是 Netlab 模块文件（缺少 format 字段）")
    version = payload.get("format_version", 0)
    if version != BLOCK_FORMAT_VERSION:
        raise ValidationError(
            f"模块文件格式版本 {version!r} 不受支持（当前 {BLOCK_FORMAT_VERSION}）"
        )
    raw_block = payload.get("block")
    if not isinstance(raw_block, dict):
        raise ValidationError("模块文件缺少 block 对象")
    checksum = payload.get("checksum")
    if not isinstance(checksum, str) or checksum != _block_checksum(raw_block):
        raise ValidationError("模块文件校验和不匹配，可能已损坏或被修改")
    block = BlockDef.from_payload(raw_block)
    validate_block_structure(block)
    return block


def validate_block_structure(block: BlockDef) -> None:
    """基本结构检查：节点 id 唯一、连接端点存在、不可自引用。"""
    ids: set[str] = set()
    for index, node in enumerate(block.nodes):
        if not isinstance(node, dict):
            raise ValidationError(f"第 {index + 1} 个内部节点必须是对象")
        node_id = str(node.get("id") or "")
        if not node_id:
            raise ValidationError(f"第 {index + 1} 个内部节点缺少 id")
        if node_id in ids:
            raise ValidationError(f"功能块内部节点 id 重复：{node_id}")
        ids.add(node_id)
        if node.get("kind") == "block":
            child = str((node.get("params") or {}).get("block_id") or "")
            if child == block.id:
                raise ValidationError("功能块不能直接包含自身")
    for index, edge in enumerate(block.edges):
        if not isinstance(edge, dict):
            raise ValidationError(f"第 {index + 1} 条内部连接必须是对象")
        if edge.get("source") not in ids or edge.get("target") not in ids:
            raise ValidationError(f"第 {index + 1} 条内部连接的端点不存在")


def write_block(library: str | Path, block: BlockDef) -> Path:
    """写一个版本文件；同 id+version 内容冲突时拒绝（D10）。"""
    target = block_path(library, block.id, block.version)
    document = render_block_file(block)
    if target.exists():
        existing = read_block_file(target)
        if _block_checksum(existing.to_payload()) == document["checksum"]:
            return target
        raise ValidationError(
            f"功能块 {block.id!r} 的 v{block.version} 已存在且内容不同；"
            "版本号只能由导入更高版本产生"
        )
    atomic_write(target, json.dumps(document, ensure_ascii=False, indent=2))
    return target


def read_block_file(path: str | Path) -> BlockDef:
    target = Path(path)
    if not target.is_file():
        raise NotFoundError(f"模块文件不存在：{target}")
    size = target.stat().st_size
    if size > MAX_BLOCK_BYTES:
        raise LimitError("模块文件过大")
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValidationError(f"模块文件 JSON 解析失败：{exc}") from exc
    return parse_block_file(payload)


def _write_document(path: Path, block: BlockDef) -> None:
    atomic_write(path, json.dumps(render_block_file(block), ensure_ascii=False, indent=2))


def rename_block(
    library: str | Path, block_id: str, name: str, *, version: int | None = None
) -> BlockDef:
    """改模块显示名（只改指定/最新版本文件；id 不变，引用不受影响）。"""
    from .blocks import check_name

    clean = check_name(name, "模块名称")
    versions = list_versions(library, block_id)
    target = versions[-1] if version is None else next(
        (item for item in versions if item["version"] == version), None
    )
    if target is None:
        raise NotFoundError(f"模块 {block_id!r} 没有 v{version}")
    block = read_block_file(target["path"])
    block.name = clean
    _write_document(Path(target["path"]), block)
    return block


def overwrite_block(
    library: str | Path, payload: dict[str, Any], *, version: int | None = None
) -> BlockDef:
    """覆盖已存在的同 id+version 文件；调用方负责引用扫描与用户确认（D6）。"""
    block = BlockDef.from_payload(payload)
    validate_block_structure(block)
    target_version = int(version if version is not None else block.version)
    target = block_path(library, block.id, target_version)
    if not target.exists():
        raise NotFoundError(f"模块 {block.id!r} 没有 v{target_version}，不能覆盖")
    block.version = target_version
    _write_document(target, block)
    return block


def list_versions(library: str | Path, block_id: str) -> list[dict[str, Any]]:
    folder = block_dir(library, block_id)
    if not folder.is_dir():
        raise NotFoundError(f"模块 {block_id!r} 不在库中")
    items: list[dict[str, Any]] = []
    for path in sorted(folder.glob(f"v*{BLOCK_SUFFIX}")):
        try:
            version = int(path.stem[1:])
        except ValueError:
            continue
        items.append(
            {
                "version": version,
                "path": str(path),
                "size": path.stat().st_size,
            }
        )
    items.sort(key=lambda item: item["version"])
    return items


def import_block(
    library: str | Path,
    payload: dict[str, Any] | BlockDef,
    *,
    version: int | None = None,
) -> dict[str, Any]:
    """导入模块：新 id 建 v1；已有 id 必须是更高版本（D5/D10）。"""
    block = payload if isinstance(payload, BlockDef) else BlockDef.from_payload(payload)
    validate_block_structure(block)
    folder = block_dir(library, block.id)
    existing = list_versions(library, block.id) if folder.is_dir() else []
    latest = existing[-1]["version"] if existing else 0
    target_version = _check_version(version) if version is not None else int(block.version)
    if latest == 0:
        if target_version < 1:
            target_version = 1
    else:
        if target_version <= latest:
            existing_block = read_block_file(existing[-1]["path"])
            if _block_checksum(existing_block.to_payload()) == _block_checksum(
                block.to_payload()
            ):
                target_version = latest
            else:
                raise ValidationError(
                    f"模块 {block.id!r} 已有 v{latest}；导入版本必须更高（收到 v{target_version}）"
                )
    block = copy.deepcopy(block)
    block.version = int(target_version)
    path = write_block(library, block)
    return {
        "id": block.id,
        "version": block.version,
        "path": str(path),
        "created": int(block.version) > latest,
    }


def remove_block(library: str | Path, block_id: str, version: int | None = None) -> list[int]:
    """删除模块版本（D6 的「真正删除」动作；引用扫描由调用方做）。"""
    versions = list_versions(library, block_id)
    targets = [item for item in versions if version is None or item["version"] == version]
    if not targets:
        raise NotFoundError(f"模块 {block_id!r} 没有 v{version}")
    removed: list[int] = []
    for item in targets:
        Path(item["path"]).unlink(missing_ok=True)
        removed.append(int(item["version"]))
    folder = block_dir(library, block_id)
    try:
        if folder.is_dir() and not any(folder.iterdir()):
            folder.rmdir()
    except OSError:
        pass
    return removed


def load_block(library: str | Path, block_id: str, version: int | None = None) -> BlockDef:
    versions = list_versions(library, block_id)
    if not versions:
        raise NotFoundError(f"模块 {block_id!r} 没有任何版本")
    target = (
        next((item for item in versions if item["version"] == version), None)
        if version is not None
        else versions[-1]
    )
    if target is None:
        raise NotFoundError(f"模块 {block_id!r} 没有 v{version}")
    return read_block_file(target["path"])


def block_ref(payload: dict[str, Any]) -> dict[str, Any]:
    """工程里保存的最小引用：只记 id + version（D4）。"""
    return {"id": str(payload.get("id") or ""), "version": int(payload.get("version") or 1)}


def ensure_blocks(library: str | Path, payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """保存前把工程用到的块同步进库，返回引用列表；同版本冲突直接拒绝。"""
    refs: list[dict[str, Any]] = []
    for payload in payloads:
        block = BlockDef.from_payload(payload)
        target = block_path(library, block.id, block.version)
        if target.exists():
            existing = read_block_file(target)
            if _block_checksum(existing.to_payload()) != _block_checksum(block.to_payload()):
                raise ValidationError(
                    f"模块 {block.id!r} v{block.version} 在库中内容不同；"
                    "请先导入更高版本再保存工程"
                )
        else:
            write_block(library, block)
        refs.append(block_ref(payload))
    return refs


def make_placeholder(
    block_id: str,
    version: int,
    *,
    mode: str = "signal",
    input_ports: list[str] | None = None,
    output_ports: list[str] | None = None,
) -> dict[str, Any]:
    """为缺失的模块生成可加载的占位块（端口来自父场景映射，只读、带标记）。"""

    def port_payload(name: str, direction: str) -> dict[str, Any]:
        return {
            "name": name,
            "direction": direction,
            "fields": ["voltage"],
            "dtype": "vector" if mode == "vector" else "signal",
            "description": "库文件缺失时的占位端口",
            "default": 0.0,
        }

    nodes: list[dict[str, Any]] = []
    for index, name in enumerate(input_ports or [], start=1):
        nodes.append(
            {
                "id": f"{index:04x}{block_id[:6]}a",
                "name": f"__in_{name}"[:32],
                "kind": "module_input",
                "params": {
                    "role": "interface",
                    "port_name": name,
                    "fields": ["voltage"],
                    "dtype": "signal",
                    "default": 0.0,
                },
                "data": {},
                "position": {"x": -200.0, "y": float(index * 80)},
            }
        )
    for index, name in enumerate(output_ports or [], start=1):
        nodes.append(
            {
                "id": f"{index:04x}{block_id[:6]}b",
                "name": f"__out_{name}"[:32],
                "kind": "module_output",
                "params": {
                    "role": "interface",
                    "port_name": name,
                    "fields": ["voltage"],
                    "dtype": "signal",
                    "default": 0.0,
                },
                "data": {},
                "position": {"x": 200.0, "y": float(index * 80)},
            }
        )
    return {
        "id": block_id,
        "name": f"占位 {block_id[:6]}",
        "mode": mode,
        "description": "库文件缺失时的占位块（只读，替换前禁止运行）",
        "version": int(version),
        "model": "behavioral",
        "builtin": False,
        "nodes": nodes,
        "edges": [],
        "ports": [port_payload(name, "input") for name in input_ports or []]
        + [port_payload(name, "output") for name in output_ports or []],
        "metadata": {"placeholder": True, "missing_block_id": block_id},
    }


def resolve_refs_degraded(
    library: str | Path | None,
    refs: Any,
    *,
    mode: str = "signal",
    port_map: dict[str, dict[str, list[str]]] | None = None,
) -> dict[str, Any]:
    """解析引用；缺失的用占位块替代，返回 ``payloads`` 与 ``missing`` 清单。

    ``port_map`` 由工程场景推导：``{block_id: {"inputs": [..], "outputs": [..]}}``。
    """
    payloads: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    for item in refs or []:
        block_id = str((item or {}).get("id") or "")
        version = int((item or {}).get("version") or 1)
        try:
            block = load_block(library, block_id, version) if library else None
        except (NotFoundError, ValidationError, LimitError):
            block = None
        if block is not None:
            payloads.append(block.to_payload())
            continue
        ports = (port_map or {}).get(block_id) or {}
        placeholder = make_placeholder(
            block_id,
            version,
            mode=mode,
            input_ports=ports.get("inputs") or [],
            output_ports=ports.get("outputs") or [],
        )
        payloads.append(placeholder)
        missing.append(
            {
                "id": block_id,
                "version": version,
                "name": placeholder["name"],
            }
        )
    return {"payloads": payloads, "missing": missing}


def check_refs(library: str | Path, refs: Any) -> dict[str, list[dict[str, Any]]]:
    """逐条检查引用能否解析；返回 resolved / missing 清单（不抛错）。"""
    resolved: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    for item in refs or []:
        block_id = str((item or {}).get("id") or "")
        version = int((item or {}).get("version") or 1)
        try:
            block = load_block(library, block_id, version)
        except (NotFoundError, ValidationError, LimitError):
            missing.append({"id": block_id, "version": version})
            continue
        resolved.append({"id": block.id, "version": block.version})
    return {"resolved": resolved, "missing": missing}


def resolve_refs(library: str | Path | None, refs: Any) -> list[dict[str, Any]]:
    """把引用解析成完整 payload；缺失时给出可执行清单（D6/D7 的「失败即停」）。"""
    if refs is None or refs == []:
        return []
    if library is None:
        raise ValidationError("工程使用模块引用，需要一个库路径才能打开")
    payloads: list[dict[str, Any]] = []
    missing: list[str] = []
    for item in refs:
        block_id = str((item or {}).get("id") or "")
        version = int((item or {}).get("version") or 1)
        try:
            block = load_block(library, block_id, version)
        except (NotFoundError, ValidationError, LimitError):
            missing.append(f"{block_id}@v{version}")
            continue
        payloads.append(block.to_payload())
    if missing:
        raise ValidationError(
            "工程引用的模块在库中缺失或损坏："
            + "、".join(missing)
            + "；请把对应 .block 文件放回 library/blocks/<id>/v<N>.block，"
            "或移除引用后再打开"
        )
    return payloads


def scan_library(library: str | Path) -> list[dict[str, Any]]:
    """列出库中所有模块的最新版本摘要；不加载执行。"""
    root = Path(library).expanduser() / LIBRARY_BLOCKS_DIR
    if not root.is_dir():
        return []
    items: list[dict[str, Any]] = []
    for folder in sorted(root.iterdir()):
        if not folder.is_dir():
            continue
        block_id = folder.name
        try:
            versions = list_versions(library, block_id)
        except (NotFoundError, ValidationError):
            continue
        if not versions:
            continue
        latest = versions[-1]
        try:
            block = read_block_file(latest["path"])
        except (ValidationError, LimitError):
            items.append(
                {
                    "id": block_id,
                    "name": block_id,
                    "error": "模块文件无法解析",
                    "version": latest["version"],
                    "versions": [item["version"] for item in versions],
                }
            )
            continue
        summary = block.summary()
        summary["versions"] = [item["version"] for item in versions]
        summary["path"] = latest["path"]
        items.append(summary)
    return items


__all__ = [
    "BLOCK_FORMAT",
    "BLOCK_FORMAT_VERSION",
    "BLOCK_SUFFIX",
    "block_dir",
    "block_path",
    "render_block_file",
    "parse_block_file",
    "validate_block_structure",
    "write_block",
    "read_block_file",
    "list_versions",
    "import_block",
    "load_block",
    "remove_block",
    "rename_block",
    "overwrite_block",
    "scan_library",
    "block_ref",
    "ensure_blocks",
    "check_refs",
    "resolve_refs",
    "make_placeholder",
    "resolve_refs_degraded",
]
