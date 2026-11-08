"""pytest 共享夹具；包导入由 pytest.ini 的 ``pythonpath = .`` 负责。"""

from __future__ import annotations

import pytest


@pytest.fixture()
def client():
    """进程内 HTTP 客户端；每个测试都回到原始信号链场景。"""
    from fastapi.testclient import TestClient

    from netlab.server import app
    from netlab.core.model.templates import build_template

    with TestClient(app) as test_client:
        test_client.post("/api/control", json={"action": "pause"})
        payload = build_template("signal_chain")
        payload["blocks"] = []  # 块定义在场景间持久，测试间必须清掉
        test_client.post("/api/scene", json=payload)
        yield test_client


@pytest.fixture(autouse=True)
def _clean_plotkit_bridge_state():
    """PlotKit 桥是进程级单例；清掉上个用例留下的通道/可见性状态。

    只清状态，不停线程：lifespan 退出时 ``stop()`` 会结束采样线程，后续用例
    打开面板时由 ``_ensure_sync_thread()`` 重建。
    """
    from netlab import plotkit_bridge as bridge

    bridge.set_active(False)
    figure = bridge.figure()
    if figure is not None:
        import plotkit

        with plotkit.store_lock():
            for name in list(bridge._REGISTERED):
                try:
                    figure.store.remove(name)
                except KeyError:
                    pass
    bridge._REGISTERED.clear()
    bridge._FORCED["keys"] = None
    bridge._FORCED["theme"] = None
    yield
