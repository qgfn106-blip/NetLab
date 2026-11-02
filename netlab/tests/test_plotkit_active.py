"""D87：PlotKit 采样按可见性开关 + 数据通路若干减负。"""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

import netlab.plotkit_bridge as bridge
import netlab.server as server


@pytest.fixture()
def client():
    server.SERVICE.load_scene(server.build_template("rlc_series"))
    if server.SERVICE.running:
        server.SERVICE.pause()
    return TestClient(server.app)


def test_active_endpoint_toggles(client):
    r = client.post("/api/plotkit/active", json={"active": True})
    assert r.status_code == 200
    assert r.json()["active"] is True
    r = client.post("/api/plotkit/active", json={"active": False})
    assert r.json()["active"] is False


def test_no_sampling_when_inactive(client):
    """面板没打开时不采样：跑 1 秒也不应登记任何通道。"""
    client.post("/api/plotkit/active", json={"active": False})
    bridge.set_channels([])
    client.post("/api/control", json={"action": "run"})
    time.sleep(1.2)
    client.post("/api/control", json={"action": "pause"})
    assert len(client.get("/api/plotkit/channels").json()["channels"]) == 0


def test_sampling_resumes_when_active(client):
    client.post("/api/plotkit/active", json={"active": True})
    client.post("/api/control", json={"action": "run"})
    time.sleep(1.5)
    client.post("/api/control", json={"action": "pause"})
    channels = client.get("/api/plotkit/channels").json()["channels"]
    assert channels, "打开面板后应当开始登记通道"
