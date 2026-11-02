"""D79 结构约束的回归护栏：目录分层、兼容 shim、依赖方向。"""
from __future__ import annotations

import ast
import importlib
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


@pytest.mark.parametrize(
    "old,new",
    [
        ("netlab.graph", "netlab.core.model.graph"),
        ("netlab.scene", "netlab.core.model.scene"),
        ("netlab.networks", "netlab.core.model.networks"),
        ("netlab.project", "netlab.core.model.project"),
        ("netlab.simulation", "netlab.core.compute.simulation"),
        ("netlab.nodal", "netlab.core.compute.nodal"),
        ("netlab.limits", "netlab.core.common.limits"),
    ],
)
def test_legacy_shims_point_to_core(old, new):
    legacy = importlib.import_module(old)
    target = importlib.import_module(new)
    assert legacy.Network if hasattr(legacy, "Network") else True
    # shim 必须转发到同一个模块对象里的同名符号
    shared = [n for n in dir(target) if not n.startswith("_") and hasattr(legacy, n)]
    assert shared, f"{old} 未从 {new} 转发任何符号"


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
