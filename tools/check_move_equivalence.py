#!/usr/bin/env python3
"""M 轮（纯搬运）AST 等价检查器。

用法：
    python tools/check_move_equivalence.py --before netlab/core/compute/nodal.py --after netlab/core/compute/circuit

判据（全部机检）：
1. 提取搬运前后所有函数/类/顶层数据的 (kind, qualname, 参数签名, 函数体源码 hash) 序列；
2. 提取顶层公开符号集合（定义、import-from 名字、非下划线赋值）；
3. 若任一侧有 __all__，比较其字面量列表；
4. 三者全等才 exit 0。

--after 可以是单文件或目录（目录会递归收集 *.py，跳过 __pycache__）。
"""

from __future__ import annotations

import argparse
import ast
import copy
import hashlib
import sys
from dataclasses import dataclass
from pathlib import Path

IGNORED_DIRS = {"__pycache__", ".mypy_cache", ".pytest_cache"}


@dataclass(frozen=True)
class Definition:
    kind: str
    qualname: str
    signature: str
    body_hash: str


def _source_hash(text: str, node: ast.AST) -> str:
    """函数体 AST hash（相对导入层级归一化）。

    模块跨包搬移时，函数体内的 ``from ..model import x`` 必须改成
    ``from ...model import x``；这是路径调整而非逻辑变化。因此计算 hash 前
    把 ``ImportFrom.level`` 归零，其余 AST 结构（含全部语句与表达式）保持
    精确比较。非函数/类节点仍按源码片段比较。
    """
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        clone = copy.deepcopy(node)
        for sub in ast.walk(clone):
            if isinstance(sub, ast.ImportFrom):
                sub.level = 0
        payload = ast.dump(ast.Module(body=clone.body, type_ignores=[]), include_attributes=False)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()
    segment = ast.get_source_segment(text, node) or ""
    return hashlib.sha256(segment.encode("utf-8")).hexdigest()


def _signature(node: ast.AST) -> str:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        parts = [ast.unparse(node.args)]
        if node.returns is not None:
            parts.append("-> " + ast.unparse(node.returns))
        decorators = ",".join(ast.unparse(d) for d in node.decorator_list)
        return "(" + "; ".join(parts) + ")" + (f" @[{decorators}]" if decorators else "")
    if isinstance(node, ast.ClassDef):
        bases = ",".join(ast.unparse(b) for b in node.bases)
        keywords = ",".join(f"{k.arg}={ast.unparse(k.value)}" for k in node.keywords)
        decorators = ",".join(ast.unparse(d) for d in node.decorator_list)
        return f"bases=[{bases}] keywords=[{keywords}] decorators=[{decorators}]"
    if isinstance(node, (ast.Assign, ast.AnnAssign)):
        return "="
    return ""


def _literal_all(node: ast.AST) -> list[str] | None:
    if not isinstance(node, ast.Assign) or len(node.targets) != 1:
        return None
    target = node.targets[0]
    if not isinstance(target, ast.Name) or target.id != "__all__":
        return None
    try:
        value = ast.literal_eval(node.value)
    except (ValueError, SyntaxError):
        return None
    if isinstance(value, (list, tuple)) and all(isinstance(x, str) for x in value):
        return list(value)
    return None


def _walk_defs(body: list[ast.stmt], prefix: str, text: str, out: list[Definition]) -> None:
    for node in body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            kind = "class" if isinstance(node, ast.ClassDef) else (
                "async_function" if isinstance(node, ast.AsyncFunctionDef) else "function"
            )
            qualname = f"{prefix}{node.name}"
            out.append(Definition(kind, qualname, _signature(node), _source_hash(text, node)))
            if isinstance(node, ast.ClassDef):
                _walk_defs(node.body, qualname + ".", text, out)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if isinstance(target, ast.Name) and not target.id.startswith("_"):
                    out.append(Definition("data", f"{prefix}{target.id}", "=", _source_hash(text, node)))


def _collect_file(path: Path) -> tuple[list[Definition], set[str], list[str] | None]:
    text = path.read_text(encoding="utf-8")
    tree = ast.parse(text, filename=str(path))
    defs: list[Definition] = []
    _walk_defs(tree.body, "", text, defs)
    public: set[str] = set()
    all_value: list[str] | None = None
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if not node.name.startswith("_"):
                public.add(node.name)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            for target in node.targets if isinstance(node, ast.Assign) else [node.target]:
                if isinstance(target, ast.Name) and not target.id.startswith("_"):
                    public.add(target.id)
            maybe = _literal_all(node)
            if maybe is not None:
                all_value = maybe
    return defs, public, all_value


def _collect(path: Path) -> tuple[list[Definition], set[str], list[str] | None]:
    if path.is_file():
        files = [path]
    elif path.is_dir():
        files = sorted(p for p in path.rglob("*.py") if not (set(p.parts) & IGNORED_DIRS))
    else:
        raise SystemExit(f"path not found: {path}")
    defs: list[Definition] = []
    public: set[str] = set()
    all_values: list[list[str]] = []
    for file in files:
        d, p, a = _collect_file(file)
        defs.extend(d)
        public |= p
        if a is not None:
            all_values.append(a)
    all_value = all_values[0] if len(all_values) == 1 else (sorted(all_values)[0] if all_values else None)
    return defs, public, all_value


def _collect_many(paths: list[Path]) -> tuple[list[Definition], set[str], list[str] | None]:
    defs: list[Definition] = []
    public: set[str] = set()
    all_values: list[list[str]] = []
    for path in paths:
        d, p, a = _collect(path)
        defs.extend(d)
        public |= p
        if a is not None:
            all_values.append(a)
    all_value = sorted(all_values)[0] if all_values else None
    return defs, public, all_value


def _diff(name: str, before, after) -> list[str]:
    problems: list[str] = []
    if before == after:
        return problems
    if isinstance(before, list) and isinstance(after, list):
        bs, as_ = set(before), set(after)
        if bs - as_:
            problems.append(f"{name}: missing after: {sorted(bs - as_)}")
        if as_ - bs:
            problems.append(f"{name}: extra after: {sorted(as_ - bs)}")
        return problems
    if isinstance(before, list) and isinstance(after, list) and len(before) != len(after):
        problems.append(f"{name}: length {len(before)} -> {len(after)}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="M 轮 AST 等价检查")
    parser.add_argument("--before", required=True, type=Path, nargs="+")
    parser.add_argument("--after", required=True, type=Path, nargs="+")
    args = parser.parse_args()

    before_defs, before_public, before_all = _collect_many(args.before)
    after_defs, after_public, after_all = _collect_many(args.after)

    problems: list[str] = []
    if before_defs != after_defs:
        before_keys = [(d.kind, d.qualname, d.signature, d.body_hash) for d in before_defs]
        after_keys = [(d.kind, d.qualname, d.signature, d.body_hash) for d in after_defs]
        missing = [k for k in before_keys if k not in after_keys]
        extra = [k for k in after_keys if k not in before_keys]
        if missing:
            problems.append(f"definitions missing after: {len(missing)}")
            for item in missing[:10]:
                problems.append(f"  - {item[0]} {item[1]} {item[2]}")
        if extra:
            problems.append(f"definitions extra after: {len(extra)}")
            for item in extra[:10]:
                problems.append(f"  + {item[0]} {item[1]} {item[2]}")
    problems.extend(_diff("public symbols", sorted(before_public), sorted(after_public)))
    problems.extend(_diff("__all__", before_all, after_all))

    print(f"BEFORE {args.before}: definitions={len(before_defs)} public_symbols={len(before_public)}")
    print(f"AFTER  {args.after}: definitions={len(after_defs)} public_symbols={len(after_public)}")
    if problems:
        print("FAIL: AST equivalence not proven")
        for problem in problems:
            print("  " + problem)
        return 1
    print("OK: AST equivalence passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
