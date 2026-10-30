"""模块库文件层（R02 / D1 / D4 / D5 / D10）。

一个模块 = 一个文件，文件名就是模块名，放在共享库的 ``library/blocks/<名字>.block``：

```
{
  "format": "netlab-block",
  "format_version": 1,
  "block": { ...BlockDef.to_payload(), "model": "behavioral|structural" },
  "checksum": "<sha256 of canonical block>"
}
```

规则（与台账一致）：

* 库里只保留每个模块的最新版，文件名 = 模块名（重名会被拒绝，避免歧义）；
* 内容发生变化时版本号自动 +1；导入已有模块必须带更高版本号；
* 旧的 ``library/blocks/<id>/v<N>.block`` 目录在扫描时自动压平成新布局；
* 读取时校验格式、校验和与基本结构（节点 id 唯一、边端点存在），不做运行/干跑（R04）；
* 库扫描只读文件，不加载执行任何代码。
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
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


def blocks_root(library: str | Path) -> Path:
    return Path(library).expanduser() / LIBRARY_BLOCKS_DIR


def _slug(name: Any, block_id: str = "") -> str:
    """模块名 → 文件名（去掉 Windows 非法字符，保留中文）。"""
    text = str(name or "").strip()
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    if not text:
        text = "模块" + block_id[:6]
    return text[:60]


def flat_path(library: str | Path, name: Any, block_id: str = "") -> Path:
    """模块在库里的文件路径：``blocks/<名字>.block``。"""
    return blocks_root(library) / (_slug(name, block_id) + BLOCK_SUFFIX)


def _flat_files(library: str | Path) -> list[Path]:
    root = blocks_root(library)
    if not root.is_dir():
        return []
    return sorted(path for path in root.glob("*" + BLOCK_SUFFIX) if path.is_file())


def _read_quiet(path: Path) -> BlockDef | None:
    try:
        return read_block_file(path)
    except (ValidationError, NotFoundError, LimitError, OSError):
        return None


def _legacy_versions(library: str | Path, block_id: str) -> list[dict[str, Any]]:
    folder = blocks_root(library) / str(block_id)
    if not folder.is_dir():
        return []
    items: list[dict[str, Any]] = []
    for path in sorted(folder.glob("v*" + BLOCK_SUFFIX)):
        try:
            version = int(path.stem[1:])
        except ValueError:
            continue
        items.append({"version": version, "path": str(path), "size": path.stat().st_size})
    items.sort(key=lambda item: item["version"])
    return items


def find_block_path(library: str | Path, block_id: str) -> Path | None:
    """按 id 找模块文件：先扁平 ``<名字>.block``，再兼容旧的 ``<id>/v<N>.block``。"""
    _check_id(block_id)
    for path in _flat_files(library):
        block = _read_quiet(path)
        if block is not None and block.id == block_id:
            return path
    legacy = _legacy_versions(library, block_id)
    if legacy:
        return Path(legacy[-1]["path"])
    return None


def migrate_library(library: str | Path) -> list[str]:
    """把旧的 ``blocks/<id>/v<N>.block`` 目录压平成 ``blocks/<名字>.block``（幂等）。"""
    root = blocks_root(library)
    if not root.is_dir():
        return []
    moved: list[str] = []
    for folder in sorted(root.iterdir()):
        if not folder.is_dir():
            continue
        versions = _legacy_versions(library, folder.name)
        if not versions:
            continue
        block = _read_quiet(Path(versions[-1]["path"]))
        if block is None:
            continue
        target = flat_path(library, block.name, block.id)
        if target.exists():
            other = _read_quiet(target)
            if other is not None and other.id != block.id:
                target = blocks_root(library) / (
                    _slug(block.name, block.id) + "-" + block.id[:6] + BLOCK_SUFFIX
                )
        atomic_write(target, json.dumps(render_block_file(block), ensure_ascii=False, indent=2))
        for item in versions:
            Path(item["path"]).unlink(missing_ok=True)
        try:
            folder.rmdir()
        except OSError:
            pass
        moved.append(str(target))
    return moved


def name_taken(
    library: str | Path, name: Any, *, ignore_id: str = ""
) -> dict[str, Any] | None:
    """重名检查（忽略大小写与首尾空白）；命中返回已有模块的 id/name。"""
    wanted = str(name or "").strip().casefold()
    if not wanted:
        return None
    for path in _flat_files(library):
        block = _read_quiet(path)
        if block is None or block.id == ignore_id:
            continue
        if str(block.name).strip().casefold() == wanted:
            return {"id": block.id, "name": block.name}
    return None


def _same_content(a: BlockDef, b: BlockDef) -> bool:
    def strip(block: BlockDef) -> str:
        payload = block.to_payload()
        for key in ("version", "created", "modified"):
            payload.pop(key, None)
        return canonical_json(payload)

    return strip(a) == strip(b)


def list_versions(library: str | Path, block_id: str) -> list[dict[str, Any]]:
    path = find_block_path(library, block_id)
    if path is None:
        raise NotFoundError(f"模块 {block_id!r} 不在库中")
    block = read_block_file(path)
    return [{"version": int(block.version), "path": str(path), "size": path.stat().st_size}]


def write_block(library: str | Path, block: BlockDef) -> Path:
    """写模块文件（一个模块一个文件、按名字命名）；内容变化时版本自动 +1。"""
    validate_block_structure(block)
    block = copy.deepcopy(block)
    blocks_root(library).mkdir(parents=True, exist_ok=True)
    current = find_block_path(library, block.id)
    target = flat_path(library, block.name, block.id)
    clash = name_taken(library, block.name, ignore_id=block.id)
    if clash is not None:
        raise ValidationError(
            f"模块名已存在：{block.name!r}（已有模块 {clash['name']!r}）；请换一个名字"
        )
    if target.exists() and (current is None or target.resolve() != current.resolve()):
        other = _read_quiet(target)
        if other is not None and other.id != block.id:
            raise ValidationError(f"模块名已存在：{block.name!r}；请换一个名字")
    if current is not None:
        old = _read_quiet(current)
        if old is not None:
            if _same_content(old, block) and target.resolve() == current.resolve():
                return current
            if int(block.version) <= int(old.version):
                block.version = int(old.version) + 1
            block.created = old.created or block.created
    atomic_write(target, json.dumps(render_block_file(block), ensure_ascii=False, indent=2))
    if current is not None and target.resolve() != current.resolve():
        current.unlink(missing_ok=True)
        legacy = blocks_root(library) / block.id
        if legacy.is_dir():
            for path in legacy.glob("*" + BLOCK_SUFFIX):
                path.unlink(missing_ok=True)
            try:
                legacy.rmdir()
            except OSError:
                pass
    return target


def rename_block(
    library: str | Path, block_id: str, name: str, *, version: int | None = None
) -> BlockDef:
    """改模块显示名：文件名跟着改，id 与引用不变（重名直接拒绝）。"""
    from .blocks import check_name

    clean = check_name(name, "模块名称")
    path = find_block_path(library, block_id)
    if path is None:
        raise NotFoundError(f"模块 {block_id!r} 不在库中")
    clash = name_taken(library, clean, ignore_id=block_id)
    if clash is not None:
        raise ValidationError(
            f"模块名已存在：{clean!r}（已有模块 {clash['name']!r}）；请换一个名字"
        )
    block = read_block_file(path)
    block.name = clean
    if version is not None:
        _check_version(version)
    target = flat_path(library, clean, block_id)
    atomic_write(target, json.dumps(render_block_file(block), ensure_ascii=False, indent=2))
    if target.resolve() != path.resolve():
        path.unlink(missing_ok=True)
    return read_block_file(target)


def overwrite_block(
    library: str | Path, payload: dict[str, Any], *, version: int | None = None
) -> BlockDef:
    """覆盖已存在的模块文件；调用方负责引用扫描与用户确认（D6）。"""
    block = BlockDef.from_payload(payload)
    validate_block_structure(block)
    path = find_block_path(library, block.id)
    if path is None:
        raise NotFoundError(f"模块 {block.id!r} 不在库中，不能覆盖")
    if version is not None:
        block.version = _check_version(version)
    atomic_write(path, json.dumps(render_block_file(block), ensure_ascii=False, indent=2))
    return read_block_file(path)


def import_block(
    library: str | Path,
    payload: dict[str, Any] | BlockDef,
    *,
    version: int | None = None,
) -> dict[str, Any]:
    """导入模块：新 id 建 v1；已有 id 必须带更高版本（D5/D10）。"""
    block = payload if isinstance(payload, BlockDef) else BlockDef.from_payload(payload)
    validate_block_structure(block)
    latest = 0
    existing: BlockDef | None = None
    path = find_block_path(library, block.id)
    if path is not None:
        existing = read_block_file(path)
        latest = int(existing.version)
    target_version = _check_version(version) if version is not None else int(block.version)
    if latest:
        if target_version <= latest:
            if existing is not None and _same_content(existing, block):
                target_version = latest
            else:
                raise ValidationError(
                    f"模块 {block.id!r} 已有 v{latest}；导入版本必须更高（收到 v{target_version}）"
                )
    block = copy.deepcopy(block)
    block.version = int(target_version)
    written = write_block(library, block)
    return {
        "id": block.id,
        "version": block.version,
        "path": str(written),
        "created": int(block.version) > latest,
    }


def remove_block(library: str | Path, block_id: str, version: int | None = None) -> list[int]:
    """删除模块文件（D6 的「真正删除」；引用扫描由调用方做）。"""
    path = find_block_path(library, block_id)
    if path is None:
        raise NotFoundError(f"模块 {block_id!r} 不在库中")
    block = read_block_file(path)
    if version is not None and int(version) != int(block.version):
        raise NotFoundError(f"模块 {block_id!r} 没有 v{version}")
    path.unlink(missing_ok=True)
    legacy = blocks_root(library) / block_id
    if legacy.is_dir():
        for item in legacy.glob("*" + BLOCK_SUFFIX):
            item.unlink(missing_ok=True)
        try:
            legacy.rmdir()
        except OSError:
            pass
    return [int(block.version)]


def load_block(library: str | Path, block_id: str, version: int | None = None) -> BlockDef:
    """按 id 读模块（库里只保留最新版；旧版本引用按最新版加载）。"""
    path = find_block_path(library, block_id)
    if path is None:
        raise NotFoundError(f"模块 {block_id!r} 不在库中")
    return read_block_file(path)


def block_ref(payload: dict[str, Any]) -> dict[str, Any]:
    """工程里保存的最小引用：只记 id + version（D4）。"""
    return {"id": str(payload.get("id") or ""), "version": int(payload.get("version") or 1)}


def ensure_blocks(library: str | Path, payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """保存前把工程用到的块同步进库，返回引用列表；内容不同则版本 +1。"""
    refs: list[dict[str, Any]] = []
    for payload in payloads:
        block = BlockDef.from_payload(payload)
        path = find_block_path(library, block.id)
        if path is not None:
            existing = read_block_file(path)
            if _same_content(existing, block):
                refs.append(block_ref(payload))
                continue
            if int(block.version) <= int(existing.version):
                block.version = int(existing.version) + 1
        write_block(library, block)
        refs.append({"id": block.id, "version": int(block.version)})
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
        raise ValidationError(
            "这个工程用到了模块引用，但当前没有可用的模块库路径；"
            "请在设置里指定 library 目录（默认是工作目录下的 library/）后再打开"
        )
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
            + "；请把对应的 <模块名>.block 放回 library/blocks/ 目录，"
            "或在工程里移除这些引用后再打开"
        )
    return payloads


def scan_library(library: str | Path) -> list[dict[str, Any]]:
    """列出库中所有模块（文件名 = 模块名）；不加载执行。"""
    try:
        migrate_library(library)
    except (ValidationError, NotFoundError, LimitError, OSError):
        pass
    items: list[dict[str, Any]] = []
    for path in _flat_files(library):
        block = _read_quiet(path)
        if block is None:
            items.append(
                {
                    "id": path.stem,
                    "name": path.stem,
                    "error": "模块文件无法解析",
                    "version": 0,
                    "versions": [],
                    "path": str(path),
                }
            )
            continue
        summary = block.summary()
        summary["versions"] = [int(block.version)]
        summary["path"] = str(path)
        summary["file"] = path.name
        items.append(summary)
    items.sort(key=lambda item: str(item.get("name") or "").casefold())
    return items


__all__ = [
    "BLOCK_FORMAT",
    "BLOCK_FORMAT_VERSION",
    "BLOCK_SUFFIX",
    "block_dir",
    "block_path",
    "blocks_root",
    "flat_path",
    "find_block_path",
    "migrate_library",
    "name_taken",
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
