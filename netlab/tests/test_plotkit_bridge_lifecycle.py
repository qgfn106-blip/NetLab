"""PlotKit 桥的生命周期 / 重置代次 / 通道上限回归（确定性，不靠 sleep）。

背景（2026-11-03 架构审计）：
- ``Recorder.clear()`` 后 seq 从 0 重来，桥只看整数 cursor 是否变小，会漏掉
  等值/更大的新序列，把新旧两段数据拼成一条曲线；
- 自动接入通道的上限按 ``figure.spec['layers']`` 算，但 D-PlotView 只登记数据集、
  不建图层，上限实际从未生效；
- 场景重置只清序列不清 t，重放数据会接在旧时间轴后面。
"""

from __future__ import annotations

import importlib.util
from types import SimpleNamespace

import pytest

from netlab import plotkit_bridge as bridge

bridge.ensure_plotkit_importable()

HAS_PLOTKIT = importlib.util.find_spec("plotkit") is not None
pytestmark = pytest.mark.skipif(not HAS_PLOTKIT, reason="未安装 plotkit")


class _ScriptedService:
    """按脚本返回 ``live()`` 结果的假仿真服务（避免真求解、避免 sleep）。"""

    def __init__(self, keys: list[str], payloads: list[dict] | None = None):
        self.recorder = SimpleNamespace(keys=lambda: list(keys))
        self._payloads = list(payloads or [])
        self.calls: list[tuple[int, int]] = []

    def live(self, cursor: int, limit: int = 6000) -> dict:
        self.calls.append((cursor, limit))
        if self._payloads:
            return self._payloads.pop(0)
        return {"frames": [], "cursor": cursor, "keys": list(self.recorder.keys())}


def _frame(seq: int, t: float, **values: float) -> dict:
    return {"seq": seq, "t": t, "v": dict(values)}


def test_recorder_generation_rotates_on_clear():
    from netlab.core.compute.simulation import Recorder

    first = Recorder(capacity=16)
    other = Recorder(capacity=16)
    before = first.generation
    assert before and before != other.generation

    first.push(0.0, {"a": 1.0})
    first.clear()

    assert first.generation != before
    assert first.seq == 0
    assert len(first.frames) == 0


def test_sync_once_resets_when_generation_changes_with_equal_cursor():
    keys = ["a"]
    fake = _ScriptedService(
        keys,
        [
            {
                "frames": [
                    _frame(1, 0.0, a=1.0),
                    _frame(2, 1.0, a=1.0),
                    _frame(3, 2.0, a=1.0),
                ],
                "cursor": 3,
                "keys": keys,
                "generation": "gen-1",
            },
            # 重置后：seq 又从 1 开始，cursor 恰好等于旧值 3
            {
                "frames": [
                    _frame(1, 0.0, a=3.0),
                    _frame(2, 1.0, a=3.0),
                    _frame(3, 2.0, a=3.0),
                ],
                "cursor": 3,
                "keys": keys,
                "generation": "gen-2",
            },
            # 判定重置后，同一轮用 cursor=0 重新取整段新记录
            {
                "frames": [
                    _frame(1, 0.0, a=3.0),
                    _frame(2, 1.0, a=3.0),
                    _frame(3, 2.0, a=3.0),
                ],
                "cursor": 3,
                "keys": keys,
                "generation": "gen-2",
            },
            {
                "frames": [_frame(4, 3.0, a=3.0), _frame(5, 4.0, a=3.0)],
                "cursor": 5,
                "keys": keys,
                "generation": "gen-2",
            },
        ],
    )
    figure = bridge.build_figure(fake)

    cursor, generation = bridge._sync_once(fake, figure, 0, None)
    assert (cursor, generation) == (3, "gen-1")
    assert list(figure.store.get("a")) == [1.0, 1.0, 1.0]

    cursor, generation = bridge._sync_once(fake, figure, cursor, generation)
    assert (cursor, generation) == (3, "gen-2")
    # 旧的一段必须整体丢掉，不能出现 [1,1,3,3] 这种拼接
    assert list(figure.store.get("t")) == [0.0, 1.0, 2.0]
    assert list(figure.store.get("a")) == [3.0, 3.0, 3.0]

    cursor, generation = bridge._sync_once(fake, figure, cursor, generation)
    assert cursor == 5
    assert list(figure.store.get("t")) == [0.0, 1.0, 2.0, 3.0, 4.0]
    assert list(figure.store.get("a")) == [3.0, 3.0, 3.0, 3.0, 3.0]


def test_sync_once_resets_when_legacy_cursor_regresses():
    keys = ["a"]
    fake = _ScriptedService(
        keys,
        [
            {"frames": [_frame(1, 0.0, a=1.0)], "cursor": 1, "keys": keys},
            {"frames": [_frame(1, 0.0, a=2.0)], "cursor": 1, "keys": keys},
            {"frames": [_frame(1, 0.0, a=2.0)], "cursor": 1, "keys": keys},
            # 判定重置后同一轮用 cursor=0 重新取整段
            {"frames": [_frame(1, 0.0, a=2.0)], "cursor": 1, "keys": keys},
        ],
    )
    figure = bridge.build_figure(fake)
    cursor, generation = bridge._sync_once(fake, figure, 0, None)
    assert cursor == 1
    # 没有 generation 的旧服务：cursor 没变小（1 -> 1），不能误判为重置
    cursor, generation = bridge._sync_once(fake, figure, cursor, generation)
    assert list(figure.store.get("a")) == [1.0, 2.0]

    # cursor 变小 = 明确的重置信号（旧 cursor 9 -> 新记录 cursor 1）
    bridge._sync_once(fake, figure, 9, generation)
    assert list(figure.store.get("a")) == [2.0]


def test_reset_clears_old_time_axis():
    fake = _ScriptedService(["a"])
    figure = bridge.build_figure(fake)
    bridge._ingest(figure, [_frame(1, 0.0, a=1.0), _frame(2, 1.0, a=1.0)], [])

    bridge._reset(figure, ["a"])

    assert list(figure.store.get("t")) == []
    assert list(figure.store.get("a")) == []


def test_reset_prunes_stale_channels_and_keeps_user_datasets():
    fake = _ScriptedService(["a", "b"])
    figure = bridge.build_figure(fake)
    import numpy as np

    figure.add_data("user-note", np.zeros(0), role="series", life="append", tags=["x"])

    bridge._reset(figure, ["b"])

    names = set(figure.store.names())
    assert "a" not in names  # 桥登记过、新场景已没有
    assert "b" in names  # 新场景仍有
    assert "user-note" in names  # 用户自己加的不动


def test_reset_does_not_clobber_subplot_layout():
    fake = _ScriptedService(["a"])
    figure = bridge.build_figure(fake)
    figure.spec.setdefault("figure", {})["subplots"] = 3

    bridge._reset(figure, ["a"])

    assert figure.spec["figure"]["subplots"] == 3


def test_ensure_channels_caps_registered_datasets_not_layers():
    fake = _ScriptedService([])
    figure = bridge.build_figure(fake)
    frames = [_frame(i, float(i), **{f"ch{i}": 1.0}) for i in range(80)]

    bridge._ensure_channels(figure, frames, limit=64)

    names = [name for name in figure.store.names() if name != "t"]
    assert len(names) == 64
    assert len(figure.spec.get("layers") or []) == 0


def test_set_channels_prunes_previous_explicit_selection(monkeypatch):
    import threading

    fake = _ScriptedService([])
    figure = bridge.build_figure(fake)
    frames = [_frame(i, float(i), ch0=1.0, ch1=1.0) for i in range(3)]
    bridge._ensure_channels(figure, frames, limit=64)
    # set_channels 操作的是全局 figure；测试用隔离的图，且不启后台采样线程
    monkeypatch.setitem(bridge._STATE, "figure", figure)
    monkeypatch.setattr(bridge, "_ACTIVE", threading.Event())
    monkeypatch.setattr(bridge, "_ensure_sync_thread", lambda: None)

    bridge.set_channels(["ch1"])

    names = [name for name in figure.store.names() if name != "t"]
    assert names == ["ch1"]
    assert bridge._FORCED["keys"] == ["ch1"]


def test_stop_then_set_active_restarts_sync_thread():
    from netlab import server  # noqa: F401  确保桥已挂到全局 app

    assert bridge.figure() is not None
    bridge.set_active(True)
    bridge.stop()
    assert bridge._STATE.get("thread") is None

    bridge.set_active(True)
    thread = bridge._STATE.get("thread")
    assert thread is not None and thread.is_alive()
    bridge.set_active(False)
