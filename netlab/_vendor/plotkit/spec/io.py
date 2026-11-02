"""spec 的序列化 / 落盘（spec.json 是唯一真相，D4）。"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any, Mapping

from .model import SPEC_VERSION
from .validate import SpecError


def dumps(spec: Mapping[str, Any], *, indent: int | None = 2) -> str:
    """规范化序列化：键排序固定，便于逐字节比较与 diff。"""
    return json.dumps(
        spec,
        ensure_ascii=False,
        sort_keys=True,
        indent=indent,
        separators=(",", ": ") if indent else (",", ":"),
    )


def loads(text: str) -> dict[str, Any]:
    try:
        spec = json.loads(text)
    except json.JSONDecodeError as exc:  # pragma: no cover - 直接转发
        raise SpecError(f"spec JSON 解析失败: {exc}") from exc
    if not isinstance(spec, dict):
        raise SpecError("spec 顶层必须是对象")
    version = spec.get("spec_version")
    if not isinstance(version, str):
        raise SpecError("spec 缺少 spec_version")
    if version.split(".")[0] != SPEC_VERSION.split(".")[0]:
        raise SpecError(f"不支持的 spec_version: {version}（本版本: {SPEC_VERSION}）")
    return spec


def save(spec: Mapping[str, Any], path: str | os.PathLike[str]) -> Path:
    """原子写入：先写临时文件再替换，避免半截 spec 被别的进程读到。"""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = dumps(spec)
    fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=".spec-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
        os.replace(tmp, target)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    return target


def load(path: str | os.PathLike[str]) -> dict[str, Any]:
    return loads(Path(path).read_text(encoding="utf-8"))
