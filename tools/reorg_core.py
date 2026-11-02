"""把 netlab 的底层模块收进 netlab/core/{compute,model,common}，旧路径留兼容 shim。

一次性脚本，跑完即可（保留在 tools/ 里作为记录）。
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "netlab"

COMPUTE = {
    "accel", "analysis", "circuit_modules", "computes", "digital", "fem",
    "introspection", "linalg", "logic", "magnetics", "methods", "nodal",
    "params", "profiling", "safeexpr", "statespace", "timers", "transistors",
    "waveform",
}
MODEL = {
    "block_validate", "blocklib", "blocks", "extensions", "graph", "networks",
    "ports", "project", "scene", "schematic", "templates", "workspace",
}
COMMON = {"limits"}

BUCKET: dict[str, str] = {}
for _n in COMPUTE:
    BUCKET[_n] = "compute"
for _n in MODEL:
    BUCKET[_n] = "model"
for _n in COMMON:
    BUCKET[_n] = "common"

SHIM = '''"""兼容层：实现在 netlab.core.{bucket}.{name}（2026-11-02 结构整理）。

保留这个文件只是为了不破坏历史 import；新代码请直接用新路径。
"""
from .core.{bucket} import {name} as _impl
from .core.{bucket}.{name} import *  # noqa: F401,F403


def __getattr__(attr):  # 转发私有名字与非常量
    return getattr(_impl, attr)


def __dir__():
    return dir(_impl)
'''


def rewrite(text: str, bucket: str) -> str:
    def repl_from(mod: str) -> str:
        target = BUCKET.get(mod)
        if target is None or target == bucket:
            return f"from .{mod}"
        return f"from ..{target}.{mod}"

    def sub_direct(m: re.Match) -> str:
        return repl_from(m.group(1)) + " import"

    def sub_bare(m: re.Match) -> str:
        names = [n.strip() for n in m.group(1).split(",")]
        parts = []
        for name in names:
            target = BUCKET.get(name)
            if target is None or target == bucket:
                parts.append(f"from . import {name}")
            else:
                parts.append(f"from ..{target} import {name}")
        return "\n".join(parts)

    text = re.sub(r"from \.([A-Za-z_]\w*) import", sub_direct, text)
    text = re.sub(r"from \. import ([\w, ]+)", sub_bare, text)
    return text


def main() -> None:
    moved = []
    for name, bucket in sorted(BUCKET.items()):
        src = ROOT / f"{name}.py"
        if not src.is_file():
            continue
        dest_dir = ROOT / "core" / bucket
        dest_dir.mkdir(parents=True, exist_ok=True)
        init = dest_dir / "__init__.py"
        if not init.exists():
            init.write_text(f'"""netlab.core.{bucket} —— 见 docs/ARCHITECTURE.md。"""\n', encoding="utf-8")
        text = src.read_text(encoding="utf-8")
        new_text = rewrite(text, bucket)
        (dest_dir / f"{name}.py").write_text(new_text, encoding="utf-8")
        src.write_text(
            SHIM.format(bucket=bucket, name=name), encoding="utf-8"
        )
        moved.append((name, bucket, new_text != text))

    core_init = ROOT / "core" / "__init__.py"
    if not core_init.exists():
        core_init.write_text('"""netlab 内核层：compute（计算）/ model（连接与网络）/ common（公共）。"""\n', encoding="utf-8")
    print(f"moved {len(moved)} modules")
    for name, bucket, changed in moved:
        print(f"  {name:18s} -> core/{bucket}/   imports_rewritten={changed}")


if __name__ == "__main__":
    main()
