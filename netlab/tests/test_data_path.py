"""数据结构与数据通路的护栏测试（D80）。

覆盖三处优化点，防止后续改动悄悄破坏契约或退回慢路径：

1. ``Recorder.since`` 从尾部反向收集，结果必须与「整窗扫描 + 均匀降采样」等价；
2. ``Recorder.keys`` 缓存必须随探针集合变化/清空而失效；
3. ``Scene.to_payload(include_state=False)`` 不再深拷贝 state/inputs，
   但返回的 params/data 仍是副本（改返回值不能污染场景）；
4. ``server.fast_json`` 产出的 JSON 与默认序列化结构一致，且能处理 NumPy 标量。
"""

from __future__ import annotations

import json

import numpy as np

from netlab.core.compute.simulation import Recorder
from netlab.core.model.scene import Scene
from netlab.core.model.templates import build_template
from netlab.server import fast_json


def _brute_since(frames: list[dict], cursor: int, limit: int) -> list[dict]:
    selected = [frame for frame in frames if frame["seq"] > cursor]
    if len(selected) > limit:
        selected = Recorder._resample(selected, limit)
    return selected


def test_since_matches_full_scan_for_many_cursors() -> None:
    recorder = Recorder()
    for index in range(2500):
        recorder.push(index * 0.01, {"a": float(index), "b": float(index) * 2})
    frames = list(recorder.frames)
    for cursor in (0, 1, 100, 1800, 2490, 2498, 2499, 2500, 9999):
        expected = _brute_since(frames, cursor, 600)
        actual = recorder.since(cursor, 600)
        assert [f["seq"] for f in actual] == [f["seq"] for f in expected], cursor
        # 降采样时期望保留首尾帧
        if actual:
            assert actual[-1] is frames[-1] or actual[-1]["seq"] == frames[-1]["seq"]


def test_since_returns_only_new_frames_at_tip() -> None:
    recorder = Recorder()
    for index in range(1200):
        recorder.push(index * 0.01, {"a": float(index)})
    tail = recorder.since(recorder.seq - 3, 600)
    assert [frame["seq"] for frame in tail] == [
        recorder.seq - 2,
        recorder.seq - 1,
        recorder.seq,
    ]


def test_keys_cache_invalidates_on_probe_change_and_clear() -> None:
    recorder = Recorder()
    recorder.push(0.0, {"a": 1.0, "b": 2.0})
    assert recorder.keys() == ["a", "b"]
    recorder.push(0.01, {"a": 1.0, "b": 2.0})
    assert recorder.keys() == ["a", "b"]
    recorder.push(0.02, {"a": 1.0, "b": 2.0, "c": 3.0})
    assert recorder.keys() == ["a", "b", "c"]
    recorder.push(0.03, {"c": 3.0})
    assert recorder.keys() == ["c"]
    recorder.clear()
    assert recorder.keys() == []
    recorder.push(0.0, {"x": 0.0})
    assert recorder.keys() == ["x"]


def test_snapshot_without_state_omits_state_and_keeps_copies() -> None:
    scene = Scene("signal")
    scene.load_payload(build_template("signal_chain"))
    node = next(iter(scene.nodes.values()))
    node.params["gain"] = 1.5

    light = node.snapshot(include_state=False)
    assert "state" not in light and "inputs" not in light
    light["params"]["gain"] = 99.0
    assert node.params["gain"] == 1.5, "返回值必须是副本，不能污染场景"

    full = node.snapshot()
    assert "state" in full and "inputs" in full

    payload = scene.to_payload(include_state=False)
    assert all("state" not in item for item in payload["nodes"])
    assert all("state" not in item for item in payload["edges"])


def test_fast_json_roundtrips_and_handles_numpy() -> None:
    payload = {
        "frames": [{"seq": 1, "t": 0.01, "v": {"a": 1.0}}],
        "np_scalar": np.float64(2.5),
        "np_array": np.array([1, 2, 3], dtype=np.int64),
    }
    response = fast_json(payload)
    assert response.media_type == "application/json"
    decoded = json.loads(response.body)
    assert decoded["frames"] == payload["frames"]
    assert decoded["np_scalar"] == 2.5
    assert decoded["np_array"] == [1, 2, 3]

    # 与默认 json.dumps 的结构一致（只是更紧凑）
    reference = json.loads(json.dumps(payload, default=str))
    assert set(decoded) == set(reference)
