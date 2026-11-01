"""PlotKit 子页签的接入封口（R08/R23 先例，不新增右栏顶层分组）。

只验三件事：
1. netlab 首页仍然 200，且带上了「绘图」子页签入口与浮窗骨架；
2. 装了 plotkit 时 `/plotkit/` 与它的 api 可用（没装则跳过，不算失败）；
3. 挂载不影响既有 `/api/health`。
"""

from __future__ import annotations

import importlib.util

import pytest
from fastapi.testclient import TestClient

from netlab.server import app

HAS_PLOTKIT = importlib.util.find_spec("plotkit") is not None


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def test_index_exposes_plotkit_entry(client: TestClient) -> None:
    html = client.get("/").text
    assert 'data-sub="plotkit"' in html
    assert 'id="plotkitFrame"' in html
    assert 'id="plotkitWin"' in html


def test_health_still_works(client: TestClient) -> None:
    assert client.get("/api/health").status_code == 200


@pytest.mark.skipif(not HAS_PLOTKIT, reason="未安装 plotkit")
def test_plotkit_mounted(client: TestClient) -> None:
    page = client.get("/plotkit/")
    assert page.status_code == 200
    meta = client.get("/plotkit/api/meta")
    assert meta.status_code == 200
    assert meta.json()["app"] == "PlotKit"
    spec = client.get("/plotkit/api/spec")
    assert spec.status_code == 200
    assert spec.json()["spec_version"] == "0.1"


@pytest.mark.skipif(not HAS_PLOTKIT, reason="未安装 plotkit")
def test_plotkit_static_is_namespaced(client: TestClient) -> None:
    css = client.get("/plotkit/static/app.css")
    assert css.status_code == 200
    # 与 netlab 自己的 /static 不冲突：同名文件走的仍是 netlab 的版本
    netlab_css = client.get("/static/style.css")
    assert netlab_css.status_code == 200
    assert netlab_css.text != css.text
