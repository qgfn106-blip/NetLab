"""PlotKit 子页签的接入封口（R08/R23 先例，不新增右栏顶层分组）。

只验三件事：
1. netlab 首页仍然 200（web 前端已退役，只留说明页）；
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


def test_index_retired_page(client: TestClient) -> None:
    # D77：原 web 前端退役，首页只保留说明（不再有绘图子页签骨架）。
    response = client.get("/")
    assert response.status_code == 200
    assert "原生" in response.text


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
    # netlab 自己的 web 前端已删除（D77），/static 不再存在
    assert client.get("/static/style.css").status_code == 404
