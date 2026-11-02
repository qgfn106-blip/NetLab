"""PlotKit 面板的数据接入接口：通道列举 + 选择。"""
from __future__ import annotations

from fastapi.testclient import TestClient

from netlab.core.model.templates import build_template
from netlab.server import SERVICE, app


def _client() -> TestClient:
    return TestClient(app)


def test_channels_endpoint_shape():
    c = _client()
    data = c.get("/api/plotkit/channels").json()
    assert set(data) >= {"mounted", "channels", "selected"}
    assert isinstance(data["channels"], list)
    assert isinstance(data["selected"], list)


def test_channels_follow_recorder_and_can_be_selected():
    c = _client()
    SERVICE.load_scene(build_template("rlc_series"))
    SERVICE.start()
    try:
        import time

        time.sleep(1.0)
    finally:
        SERVICE.pause()
    data = c.get("/api/plotkit/channels").json()
    assert data["mounted"] is True
    assert data["channels"], "跑过仿真后应该能看到探针通道"
    keys = data["channels"][:2]
    posted = c.post("/api/plotkit/channels", json={"keys": keys}).json()
    assert posted["ok"] is True
    assert posted["selected"] == keys
    assert set(posted["selected"]).issubset(set(posted["channels"]))
    # 空 keys = 恢复自动发现
    reset = c.post("/api/plotkit/channels", json={"keys": []}).json()
    assert reset["ok"] is True
    assert len(reset["selected"]) >= len(keys)
