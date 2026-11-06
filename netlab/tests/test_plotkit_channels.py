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
    c.post("/api/plotkit/precompute", json={"seconds": 0})
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


def test_channels_payload_has_build_stamp(client):
    """前端靠 build 字段识别「后端进程还是旧的」，必须一直返回。"""
    from netlab.server import APP_BUILD

    data = client.get("/api/plotkit/channels").json()
    assert data.get("build") == APP_BUILD
    assert client.get("/api/health").json().get("build") == APP_BUILD


def test_plotkit_meta_has_time_range_after_precompute():
    """预计算后即使一条图层都没加，回放也要有时间范围（否则播放点了不动）。

    2026-11-03 回归：PlotKit 的 time_bounds 只看图层 x 数据；netlab 按 D-PlotView
    只登记数据集、不建图层，于是 /api/meta 的 time 是 None，播放滑杆没有范围。
    """
    import time as _time

    c = _client()
    SERVICE.load_scene(build_template("rlc_series"))
    SERVICE.pause()
    pre = c.post("/api/plotkit/precompute", json={"seconds": 1.0}).json()
    assert pre["ok"] is True, pre
    assert pre["frames"] > 10
    c.post("/api/plotkit/active", json={"active": True})
    try:
        deadline = _time.time() + 5.0
        info: dict = {}
        while _time.time() < deadline:
            _time.sleep(0.3)
            info = c.get("/plotkit/api/meta").json().get("time") or {}
            if info.get("min") is not None and info.get("max") is not None:
                break
        assert info.get("min") is not None, f"预计算后没有时间范围: {info}"
        assert info.get("max") > info.get("min"), info
        assert info.get("count") > 10, info
    finally:
        c.post("/api/plotkit/active", json={"active": False})


def _precompute_point_count(c, dt: float) -> int:
    """用给定 dt 预计算 0.5 s，返回 PlotKit 实际收到的采样点数。"""
    import time as _time

    SERVICE.pause()
    SERVICE.load_scene(build_template("rlc_series"))
    pre = c.post("/api/plotkit/precompute", json={"seconds": 0.05, "dt": dt}).json()
    assert pre["ok"] is True, pre
    c.post("/api/plotkit/active", json={"active": True})
    try:
        deadline = _time.time() + 12.0
        info: dict = {}
        last = -1
        stable = 0
        while _time.time() < deadline:
            _time.sleep(0.4)
            info = c.get("/plotkit/api/meta").json().get("time") or {}
            count = int(info.get("count") or 0)
            if count > 0 and count == last:
                stable += 1
                if stable >= 3:  # 同步线程 0.5 s 一拍，连续 3 拍不变才算稳定
                    break
            else:
                stable = 0
            last = count
        return int(info.get("count") or 0)
    finally:
        c.post("/api/plotkit/active", json={"active": False})


def test_precision_increases_points_in_plotkit_preview():
    """提高仿真精度（更小 dt）要真的让 PlotKit 预览拿到更密的采样点。

    2026-11-03 反馈：用户在 netlab 把 dt 从 1e-4 调到 1e-5，PlotKit 曲线毫无变化。
    根因有两层：①`/api/plotkit/precompute` 写死 `step_dt = max(dt, seconds/2000)`，
    任何 dt 都跑成 2000 帧；②recorder 容量 1200、桥接每次只取 600 点，又各砍一刀。
    修复后：预计算按真实 dt 跑，容量/同步上限抬到 6000。
    """
    c = _client()
    coarse = _precompute_point_count(c, 1e-4)
    fine = _precompute_point_count(c, 1e-5)
    assert coarse >= 300, f"0.05 s/1e-4 只拿到 {coarse} 点，采样上限仍然太低"
    assert fine >= 3000, f"0.05 s/1e-5 只拿到 {fine} 点，采样上限仍然太低"
    assert fine > coarse, f"提高精度后点数没变多：1e-4→{coarse}, 1e-5→{fine}"


def test_precompute_honors_requested_dt():
    """预计算必须用用户给的 dt，而不是悄悄替换成 seconds/2000。"""
    c = _client()
    SERVICE.load_scene(build_template("rlc_series"))
    SERVICE.pause()
    data = c.post("/api/plotkit/precompute", json={"seconds": 0.05, "dt": 1e-5}).json()
    assert data["ok"] is True, data
    assert data["dt"] == 1e-5, f"预计算偷换了步长：请求 1e-5，实际 {data['dt']}"
    assert data["dt_used"] == 1e-5
    assert data["degraded"] is False
    assert data["frames"] > 3000, data


def test_precompute_uses_scene_dt_when_caller_omits_it():
    """前端预计算只发 seconds，步长必须取当前仿真配置的 dt（用户调的精度）。

    这正是用户的操作路径：在设置里把 dt 调小，再去面板点「接入」。
    """
    c = _client()
    SERVICE.load_scene(build_template("rlc_series"))
    SERVICE.pause()
    SERVICE.apply_config({"dt": 1e-5})
    try:
        data = c.post("/api/plotkit/precompute", json={"seconds": 0.05}).json()
    finally:
        SERVICE.apply_config({"dt": 1e-4})
    assert data["ok"] is True, data
    assert data["requested_dt"] == 1e-5, data
    assert data["dt_used"] == 1e-5
    assert data["frames"] >= 3000, data


def test_precompute_step_dt_degrades_openly():
    """步数超上限时可以降级，但必须返回 degraded + 实际步长，不能装作按用户精度跑了。

    直接测选步长的纯函数：走接口会真的跑满 20 万步，太慢。
    """
    from netlab.server import precompute_step_dt

    dt, degraded = precompute_step_dt(0.2, 1e-6)
    assert degraded is True
    assert dt == 0.2 / 200_000

    dt, degraded = precompute_step_dt(0.2, 1e-5)
    assert degraded is False
    assert dt == 1e-5
