#!/usr/bin/env python3
"""架构契约机检：A1 依赖方向、A2 无环、A3 模块级可变单例、A6 冷启动隔离。

用法：python tools/check_architecture.py [--json reports/architecture.json]
任一硬失败 exit 1；A3 白名单外条目同样 exit 1。
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "netlab"
CONTRACTS = ROOT / "docs" / "contracts" / "layers.yaml"
MUTABLE_RE = re.compile(r"^_[a-z][A-Za-z0-9_]*$|^_[A-Z][A-Za-z0-9_]*$")
LOCK_CALLS = {"Lock", "RLock", "Event", "Condition", "Semaphore"}


def module_name(path: Path) -> str:
    rel = path.relative_to(ROOT).with_suffix("")
    parts = list(rel.parts)
    if parts and parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def is_package(path: Path) -> bool:
    return path.name == "__init__.py"


def resolve_import(node: ast.ImportFrom, module: str, package: bool) -> list[str]:
    targets: list[str] = []
    if node.level:
        base = module.split(".") if package else module.split(".")[:-1]
        drop = node.level - 1
        if drop > len(base):
            return targets
        prefix = base[: len(base) - drop] if drop else base
        if node.module:
            targets.append(".".join(prefix + node.module.split(".")))
        else:
            for alias in node.names:
                targets.append(".".join(prefix + [alias.name]))
    elif node.module:
        targets.append(node.module)
    return targets


def collect_modules() -> dict[str, dict[str, Any]]:
    mods: dict[str, dict[str, Any]] = {}
    for path in sorted(PKG.rglob("*.py")):
        if "_vendor" in path.parts:
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError as exc:  # pragma: no cover - 语法错误应由 pytest 先暴露
            raise SystemExit(f"cannot parse {path}: {exc}") from exc
        name = module_name(path)
        deps: set[str] = set()

        def is_type_checking(test: ast.expr) -> bool:
            if isinstance(test, ast.Name):
                return test.id == "TYPE_CHECKING"
            if isinstance(test, ast.Attribute):
                return test.attr == "TYPE_CHECKING"
            return False

        def visit(node: ast.AST, type_only: bool = False) -> None:
            if isinstance(node, ast.If) and is_type_checking(node.test):
                for child in node.body:
                    visit(child, True)
                return
            if isinstance(node, ast.Import):
                if not type_only:
                    for alias in node.names:
                        if alias.name.startswith(("netlab", "plotkit")):
                            deps.add(alias.name)
                return
            if isinstance(node, ast.ImportFrom):
                if not type_only:
                    for target in resolve_import(node, name, is_package(path)):
                        if target.startswith(("netlab", "plotkit")):
                            deps.add(target)
                return
            for child in ast.iter_child_nodes(node):
                visit(child, type_only)

        for node in tree.body:
            visit(node)
        mods[name] = {"path": path, "deps": deps, "tree": tree, "package": is_package(path)}
    return mods


def load_contract() -> dict[str, Any]:
    import yaml

    return yaml.safe_load(CONTRACTS.read_text(encoding="utf-8")) or {}


def matches(prefix: str, module: str) -> bool:
    return module == prefix or module.startswith(prefix + ".")


def check_a1(mods: dict[str, dict[str, Any]], contract: dict[str, Any]) -> list[dict[str, str]]:
    violations: list[dict[str, str]] = []
    for rule in contract.get("forbidden_edges", []):
        frm = str(rule["from"])
        denies = [str(x) for x in rule.get("to", [])]
        for mod, info in mods.items():
            if not matches(frm, mod):
                continue
            for dep in sorted(info["deps"]):
                for deny in denies:
                    if not matches(deny, dep):
                        continue
                    if rule.get("except_same_module") and dep == mod:
                        continue
                    violations.append({"from": mod, "to": dep, "rule": f"{frm} !-> {deny}"})
    return violations


def _cycle_key(cycle: list[str]) -> frozenset[str]:
    return frozenset(cycle[:-1])


def check_a2(mods: dict[str, dict[str, Any]], contract: dict[str, Any] | None = None) -> tuple[list[list[str]], list[list[str]]]:
    graph = {mod: sorted(d for d in info["deps"] if d in mods) for mod, info in mods.items()}
    cycles: list[list[str]] = []
    state: dict[str, int] = {}
    stack: list[str] = []

    def dfs(node: str) -> None:
        state[node] = 1
        stack.append(node)
        for nxt in graph.get(node, []):
            if state.get(nxt, 0) == 0:
                dfs(nxt)
            elif state.get(nxt) == 1:
                start = stack.index(nxt)
                cycles.append(stack[start:] + [nxt])
        stack.pop()
        state[node] = 2

    for node in graph:
        if state.get(node, 0) == 0:
            dfs(node)
    # 去重（同一环不同起点）
    unique: list[list[str]] = []
    seen: set[tuple[str, ...]] = set()
    for cycle in cycles:
        key = tuple(sorted(cycle[:-1]))
        if key not in seen:
            seen.add(key)
            unique.append(cycle)
    baseline = []
    for item in (contract or {}).get("a2_cycle_baseline", []):
        baseline.append(frozenset(str(x) for x in item.get("cycle", [])))
    new = [c for c in unique if _cycle_key(c) not in baseline]
    return unique, new


def is_mutable_assignment(node: ast.Assign | ast.AnnAssign) -> bool:
    value = node.value
    if isinstance(value, ast.Constant) and value.value is None:
        return True
    if isinstance(value, (ast.Dict, ast.List, ast.Set)):
        return True
    if isinstance(value, ast.Call):
        func = value.func
        if isinstance(func, ast.Attribute) and func.attr in LOCK_CALLS:
            return True
        if isinstance(func, ast.Name) and func.id in {"dict", "list", "set"}:
            return True
    return False


def check_a3(mods: dict[str, dict[str, Any]], contract: dict[str, Any]) -> list[dict[str, str]]:
    allowed: set[tuple[str, str]] = set()
    for item in contract.get("mutable_globals_whitelist", []):
        for name in item.get("names", []):
            allowed.add((str(item["module"]), str(name)))
    found: list[dict[str, str]] = []
    for mod, info in mods.items():
        for node in info["tree"].body:
            targets: list[ast.expr] = []
            if isinstance(node, ast.Assign):
                targets = list(node.targets)
            elif isinstance(node, ast.AnnAssign):
                targets = [node.target]
            if not targets or not is_mutable_assignment(node):
                continue
            for target in targets:
                if not isinstance(target, ast.Name):
                    continue
                name = target.id
                if name == "__all__" or not MUTABLE_RE.match(name):
                    continue
                if (mod, name) not in allowed:
                    found.append({"module": mod, "name": name, "line": str(node.lineno)})
    return found


def check_a6() -> dict[str, Any]:
    code = (
        "import sys; import netlab.core.compute.circuit.solver as m; "
        "bad=[x for x in ('netlab.server','plotkit') if x in sys.modules]; "
        "print(','.join(bad))"
    )
    proc = subprocess.run(
        [sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True, timeout=120
    )
    loaded = [x for x in (proc.stdout or "").strip().split(",") if x]
    return {"exit": proc.returncode, "loaded": loaded, "stderr": proc.stderr.strip()[-400:]}


def check_ts_cycles() -> list[list[str]]:
    base = ROOT / "frontend"
    files = [base / "app.ts", *sorted((base / "app").glob("*.ts"))]
    graph: dict[str, list[str]] = {}
    names = {p.name: p for p in files}
    import_re = re.compile(r"""from\s+["'](\.[^"']+)["']""")
    for path in files:
        deps: list[str] = []
        for match in import_re.finditer(path.read_text(encoding="utf-8")):
            target = match.group(1).split("/")[-1].replace(".js", ".ts")
            if target in names:
                deps.append(target)
        graph[path.name] = deps
    cycles: list[list[str]] = []
    state: dict[str, int] = {}
    stack: list[str] = []

    def dfs(node: str) -> None:
        state[node] = 1
        stack.append(node)
        for nxt in graph.get(node, []):
            if state.get(nxt, 0) == 0:
                dfs(nxt)
            elif state.get(nxt) == 1:
                start = stack.index(nxt)
                cycles.append(stack[start:] + [nxt])
        stack.pop()
        state[node] = 2

    for node in graph:
        if state.get(node, 0) == 0:
            dfs(node)
    return cycles


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", default=str(ROOT / "reports" / "architecture.json"))
    args = parser.parse_args()

    contract = load_contract()
    mods = collect_modules()
    a1 = check_a1(mods, contract)
    a2, a2_new = check_a2(mods, contract)
    ts_cycles = check_ts_cycles()
    a3 = check_a3(mods, contract)
    a6 = check_a6()

    report = {
        "commit": subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True
        ).stdout.strip(),
        "modules": len(mods),
        "edges": sum(len(i["deps"]) for i in mods.values()),
        "a1_violations": a1,
        "a2_cycles": a2,
        "a2_new_cycles": a2_new,
        "ts_cycles": ts_cycles,
        "a3_unlisted": a3,
        "a6": a6,
    }
    out = Path(args.json)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"A1 依赖方向: {'FAIL' if a1 else 'OK'} ({len(a1)} violations)")
    for v in a1[:20]:
        print(f"  {v['from']} -> {v['to']}  [{v['rule']}]")
    print(f"A2 Python 环: {'FAIL' if a2_new else 'OK'} (total={len(a2)}, new={len(a2_new)})")
    for c in a2[:5]:
        print("  " + " -> ".join(c))
    print(f"A2 TS 环: {'FAIL' if ts_cycles else 'OK'} ({len(ts_cycles)})")
    for c in ts_cycles[:5]:
        print("  " + " -> ".join(c))
    print(f"A3 白名单外可变全局: {'FAIL' if a3 else 'OK'} ({len(a3)})")
    for v in a3[:20]:
        print(f"  {v['module']}:{v['line']} {v['name']}")
    print(f"A6 冷启动隔离: {'FAIL' if a6['loaded'] or a6['exit'] else 'OK'} loaded={a6['loaded']}")
    if a6["stderr"]:
        print(a6["stderr"])

    failed = bool(a1 or a2_new or ts_cycles or a3 or a6["loaded"] or a6["exit"])
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
