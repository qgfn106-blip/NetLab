"""环形窗口裁剪的回归测试（plotkit_bridge）。

历史 bug：`_ingest` 用 `store.add(..., life="replace")` 做裁剪，会把数据集的
追加语义永久改成"替换"，于是下一次 `push()` 只留最后一帧，曲线几秒后塌成一条
水平线。这里用真实 plotkit 数据集验证：裁剪之后仍然继续追加。
"""

from __future__ import annotations

import importlib.util

import pytest

from netlab import plotkit_bridge

# 先让 vendored PlotKit 进 sys.path，再判断是否可用；否则单独跑本文件会假跳过。
plotkit_bridge.ensure_plotkit_importable()

HAS_PLOTKIT = importlib.util.find_spec("plotkit") is not None

pytestmark = pytest.mark.skipif(not HAS_PLOTKIT, reason="未安装 plotkit")


def _frames(start: int, count: int) -> list[dict]:
    return [
        {"t": float(start + i), "v": {"ch0": float(start + i)}} for i in range(count)
    ]


def test_trim_keeps_appending(monkeypatch) -> None:
    import numpy as np
    import plotkit as pk

    from netlab import plotkit_bridge as bridge

    monkeypatch.setattr(bridge, "MAX_POINTS", 20)

    fig = pk.figure()
    fig.add_data("t", [], role="coord", life="append")
    fig.add_data("ch0", [], role="series", life="append")

    # 分 5 批各 10 帧推入，总量 50 > MAX_POINTS=20
    for batch in range(5):
        bridge._ingest(fig, _frames(batch * 10, 10), ["ch0"])

    series = fig.store.get("ch0")
    assert len(series) == 20  # 窗口被裁到 20
    assert series.meta.life == "append"  # 追加语义没有被改掉
    assert np.isclose(float(series.values[-1]), 49.0)  # 最后一帧是新的，不是冻住的
    assert np.isclose(float(fig.store.get("t").values[-1]), 49.0)
