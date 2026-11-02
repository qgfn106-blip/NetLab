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
    # D87：只有面板可见时才采样；测试里显式"打开面板"
    c.post("/api/plotkit/active", json={"active": True})
    try:
        import time

        time.sleep(1.2)
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


def test_precompute_runs_and_records_frames():
    """接入前预计算：0→T 一次算完并登记，仿真保持停止。"""
    c = _client()
    SERVICE.load_scene(build_template("rlc_series"))
    SERVICE.pause()
    resp = c.post("/api/plotkit/precompute", json={"seconds": 1.0})
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True, data
    assert data["frames"] and data["frames"] > 10
    assert data["seconds"] == 1.0
    assert SERVICE.running is False
    # 预计算后可列出可接入通道
    chans = c.get("/api/plotkit/channels").json()
    assert chans["available"]


def test_precompute_rejects_absurd_duration():
    c = _client()
    resp = c.post("/api/plotkit/precompute", json={"seconds": 0})
    data = resp.json()
    # seconds<=0 会被兜底成 5s 并正常执行；真正超限（>120s）应报错而不是崩溃
    resp2 = c.post("/api/plotkit/precompute", json={"seconds": 999})
    assert resp2.status_code == 200
    assert resp2.json()["ok"] is False


def test_available_probes_listed_without_running():
    """不运行仿真也能列出「可接入的探针」——这是"面板 0 通道"的根因修复。"""
    c = _client()
    SERVICE.load_scene(build_template("rlc_series"))
    SERVICE.pause()
    data = c.get("/api/plotkit/channels").json()
    assert data["mounted"] is True
    assert data["available"], "停止状态下也应列出场景探针"
    assert any(k.startswith("n:") for k in data["available"])


def test_接入_available_keys_registers_datasets():
    c = _client()
    SERVICE.load_scene(build_template("rlc_series"))
    SERVICE.pause()
    avail = c.get("/api/plotkit/channels").json()["available"][:2]
    posted = c.post("/api/plotkit/channels", json={"keys": avail}).json()
    assert posted["ok"] is True
    assert posted["selected"] == avail
    assert set(avail).issubset(set(posted["channels"]))


def test_diag_reports_vendor_and_error():
    c = _client()
    data = c.get("/api/plotkit/diag").json()
    assert "mounted" in data
    assert "candidates" in data and data["candidates"]
