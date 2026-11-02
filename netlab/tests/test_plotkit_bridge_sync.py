"""PlotKit 同步桥的回归测试：中途出现的通道不能让数据集长度错开。

历史 bug：仿真跑起来后才出现的探针（例如 e:V1:power）从 0 长度开始追加，
``t`` 却在涨，下一次 render 直接抛「图层 x/y 长度不一致」，面板曲线卡死。
"""
from __future__ import annotations

import pytest

from netlab.plotkit_bridge import _ensure_channels, _ingest, ensure_plotkit_importable

ensure_plotkit_importable()  # 同仓库并列布局时把 ../PlotKit/src 加进 sys.path
pk = pytest.importorskip("plotkit")


def _figure():
    fig = pk.figure(size=(6.0, 4.0), dpi=80)
    fig.add_data("t", [], unit="s", role="coord", life="append")
    fig.add_plot(x="t", y="a", label="a", subplot=0)
    return fig


def test_new_channel_is_padded_to_t_length():
    fig = _figure()
    fig.add_data("a", [], role="series", life="append")
    _ingest(fig, [{"t": 0.1, "v": {"a": 1.0}}, {"t": 0.2, "v": {"a": 2.0}}], [])
    # 第 3 帧才出现的新通道 b
    frames = [{"t": 0.3, "v": {"a": 3.0, "b": 9.0}}]
    _ensure_channels(fig, frames, limit=4)
    _ingest(fig, frames, [])

    store = fig.store
    lengths = {name: len(store.get(name)) for name in store.names()}
    assert len(set(lengths.values())) == 1, lengths
    assert lengths["b"] == lengths["t"] == 3
    # 补齐的前两帧是 NaN，而不是和别的曲线错位
    assert str(store.get("b")[:2]).count("nan") == 2


def test_ingest_survives_misaligned_store_and_render_does_not_raise():
    import numpy as np

    fig = _figure()
    fig.add_data("a", [], role="series", life="append")
    _ingest(fig, [{"t": 0.1, "v": {"a": 1.0}}], [])
    # 人为制造错位（模拟"t 已 push、曲线还没 push"的中间态）
    fig.store.push("t", np.asarray([0.2, 0.3], dtype="float64"))
    _ingest(fig, [{"t": 0.4, "v": {"a": 4.0}}], [])
    lengths = {name: len(fig.store.get(name)) for name in fig.store.names()}
    assert len(set(lengths.values())) == 1, lengths
    fig.render(width=600, height=380, dpi=80, fmt="png")
