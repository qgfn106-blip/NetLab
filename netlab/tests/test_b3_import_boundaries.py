"""B3 R2：graph.py 依赖收敛到 core.common（clock/fields/profiling），不再顶层 import compute 实现。

注：全域「import netlab.core.model.graph 完全不加载 compute.*」要等 R3–R5 把 scene→scene_engines
链路收敛后才可达成（当前 netlab/__init__ 会 import scene，scene→scene_engines→compute.*）。
本批（R2）只保证 graph.py 自身对这三个模块的依赖边已被切断，改用 core.common 的同一对象（身份相等）。
"""
from __future__ import annotations

import ast
from pathlib import Path

import netlab.core.common.clock as c
import netlab.core.common.fields as f
import netlab.core.common.profiling as p
import netlab.core.model.graph as g

_MODS = ("compute.clock", "compute.fields", "compute.profiling")


def _top_level_compute_imports(path: str) -> set[str]:
    tree = ast.parse(Path(path).read_text(encoding="utf-8"))
    found: set[str] = set()
    for node in tree.body:  # 只看模块顶层 import
        if isinstance(node, ast.ImportFrom) and node.module:
            for name in _MODS:
                if node.module.endswith(name):
                    found.add(node.module)
    return found


def test_graph_has_no_top_level_compute_impl_imports() -> None:
    assert _top_level_compute_imports("netlab/core/model/graph.py") == set()


def test_common_modules_do_not_import_compute() -> None:
    for mod in ("clock", "fields", "profiling"):
        assert _top_level_compute_imports(f"netlab/core/common/{mod}.py") == set()


def test_graph_rebinds_from_common_identity() -> None:
    # graph 用的是 core.common 的同一批对象（不是 compute 的副本/重实现）
    assert g.SimClock is c.SimClock
    assert g.read_numeric is f.read_numeric
    assert g.resolve_output is f.resolve_output
    assert g.timed is p.timed


def test_compute_old_paths_still_export_same_objects() -> None:
    # 旧导入路径兼容：compute.clock/fields/profiling 仍可导入到同一对象
    from netlab.core.compute import clock as cc
    from netlab.core.compute import fields as cf
    from netlab.core.compute import profiling as cp

    assert cc.SimClock is c.SimClock
    assert cf.read_numeric is f.read_numeric
    assert cp.timed is p.timed
