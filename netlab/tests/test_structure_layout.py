"""D79/D85 结构约束的回归护栏：目录分层、无遗留 shim、依赖方向、引用路径。"""
from __future__ import annotations

import ast

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]          # NetlabHome
PKG = Path(__file__).resolve().parents[1]           # NetlabHome/netlab


def test_frontend_folder_holds_all_assets():
    front = ROOT / "frontend"
    for name in ("index.html", "style.css", "app.js", "desktop-shim.js"):
        assert (front / name).is_file(), f"frontend/{name} 缺失"
    assert not (PKG / "static").exists(), "旧 netlab/static 不应再存在"


def test_server_resolves_frontend_dir():
    from netlab import server

    assert server.FRONTEND_DIR.name == "frontend"
    assert (server.FRONTEND_DIR / "app.js").is_file()


CORE_MODULES = {
    "accel": "compute", "analysis": "compute", "circuit_modules": "compute",
    "computes": "compute", "digital": "compute", "fem": "compute",
    "introspection": "compute", "linalg": "compute", "logic": "compute",
    "magnetics": "compute", "methods": "compute", "nodal": "compute",
    "params": "compute", "profiling": "compute", "safeexpr": "compute",
    "simulation": "compute", "statespace": "compute", "timers": "compute",
    "transistors": "compute", "waveform": "compute",
    "block_validate": "model", "blocklib": "model", "blocks": "model",
    "extensions": "model", "graph": "model", "networks": "model",
    "ports": "model", "project": "model", "scene": "model",
    "schematic": "model", "templates": "model", "workspace": "model",
    "limits": "common",
}


def test_no_compatibility_shims_left():
    """D85：旧的 1KB 转发 shim 已全部删除，顶层只留真正的入口/适配模块。"""
    leftovers = sorted(CORE_MODULES[name] and name for name in CORE_MODULES if (PKG / f"{name}.py").exists())
    assert not leftovers, "仍存在兼容 shim：" + ", ".join(f"netlab/{n}.py" for n in leftovers)
    allowed = {"__init__.py", "server.py", "run.py", "plotkit_bridge.py", "plotkit_vendor.py", "vscode_bridge.py", "cache_guard.py"}
    extra = sorted(p.name for p in PKG.glob("*.py") if p.name not in allowed)
    assert not extra, "netlab/ 顶层出现了未分类模块：" + ", ".join(extra)


def test_all_imports_use_canonical_core_paths():
    """D85：全仓库不得再 import 已删除的旧路径（netlab.scene / from .graph 等）。"""
    banned = set(CORE_MODULES)
    offenders = []
    for path in PKG.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        rel = path.relative_to(PKG)
        depth = len(rel.parts) - 1
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                mod = node.module or ""
                first = mod.split(".")[0]
                if mod == "" and depth == 1:
                    # from . import x  → 顶层包内相对导入，指向已删 shim
                    hits = [a.name for a in node.names if a.name in banned]
                    if hits:
                        offenders.append(f"{rel}:{node.lineno}: from . import {hits[0]}")
                elif depth == 1 and node.level == 1 and first in banned:
                    offenders.append(f"{rel}:{node.lineno}: from .{mod} import ...")
                elif mod.startswith("netlab.") and mod.split(".")[1] in banned:
                    offenders.append(f"{rel}:{node.lineno}: from {mod} import ...")
    assert not offenders, "仍引用已删除的旧路径：\n" + "\n".join(offenders)


def test_core_does_not_import_outer_layers():
    """core 层不得 import server / desktop / frontend。"""
    offenders = []
    for path in (PKG / "core").rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names = [node.module]
            for name in names:
                if name.split(".")[0] in {"server", "desktop"} or name.startswith("netlab.server"):
                    offenders.append(f"{path.relative_to(ROOT)}: {name}")
    assert not offenders, "core 层出现了越界 import：" + "; ".join(offenders)


def test_plotkit_bridge_mounts_route():
    from netlab import plotkit_bridge, server

    assert plotkit_bridge.MOUNT_PATH == "/plotkit"
    assert plotkit_bridge.ensure_plotkit_importable() in (True, False)
    if not server.PLOTKIT_MOUNTED:
        pytest.skip("本机未安装 plotkit，跳过路由断言")
    paths = {getattr(r, "path", "") for r in server.app.routes}
    assert any(p.startswith("/plotkit") for p in paths)
