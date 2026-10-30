"""把 PlotKit 以子应用方式挂进 netlab（可选依赖，缺失时静默跳过）。

设计边界（D11/D13）：
- PlotKit 不 import netlab；本模块是**单向**的 netlab → PlotKit。
- 老的时间序列页签一行不改，新页签并存，用 ``?chart=plotkit`` / 子页签开关进退。
- 失败即降级：没装 plotkit、挂载报错，都不影响 netlab 启动。
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

LOGGER = logging.getLogger(__name__)

MOUNT_PATH = "/plotkit"
#: 每个通道保留的点数；超出后只留尾部（对应 spec 里的 life="replace" 语义）
MAX_POINTS = 20_000
#: 同步线程的采样节奏（秒）
SYNC_INTERVAL = 0.2
#: 最多同时接多少个通道（probes 一次可能给 240 个）
MAX_CHANNELS = 6
DEFAULT_WINDOW = 5.0   # 秒；与 netlab 老画布的「时间窗」默认值一致

_LOCK = threading.Lock()
_STATE: dict[str, Any] = {"figure": None, "app": None, "thread": None}


def _label(key: str) -> str:
    """``n:signal:voltage`` → ``signal·voltage``；其它形状原样返回。"""
    parts = key.split(":")
    if len(parts) >= 3:
        return f"{parts[1]}·{':'.join(parts[2:])}"
    if len(parts) == 2:
        return parts[1]
    return key


def _theme_name(service: Any) -> str:
    """把 netlab 的主题映射成 PlotKit 的配色。"""
    try:
        from .workspace import load_settings

        theme = str((load_settings() or {}).get("theme") or "dark")
    except Exception:  # 读配置失败不该挡住绘图
        theme = "dark"
    return "netlab-dark" if theme == "dark" else "default"


def build_figure(service: Any) -> Any:
    """按当前场景的探针通道建一张图；没有任何通道时留一张空图。"""
    import plotkit as pk

    fig = pk.figure(size=(10.0, 6.0), dpi=100, theme=_theme_name(service), title="信号（PlotKit 预览）")
    keys = list(getattr(service, "recorder", None).keys())[:MAX_CHANNELS] if getattr(service, "recorder", None) else []
    fig.add_data("t", [], unit="s", role="coord", life="append")
    for key in keys:
        fig.add_data(key, [], role="series", life="append", tags=[key.split(":")[0]])
        fig.add_plot(x="t", y=key, label=_label(key), subplot=0)
    fig.set_view(0, xlabel="t / s", ylabel="值", grid=True)
    # 和老画布默认一致：只显示最近 5 秒（可在界面上改，回放时沿游标往回截）
    fig.window(DEFAULT_WINDOW)
    return fig


def _sync_loop(service: Any, figure: Any, stop_event: threading.Event) -> None:
    cursor = 0
    keys: list[str] = []
    while not stop_event.is_set():
        try:
            payload = service.live(cursor, limit=600)
            frames = payload.get("frames") or []
            if payload.get("cursor", cursor) < cursor:  # 重新运行 / 换场景 / 重置
                cursor = 0
                frames = []
                _reset(figure)
            if frames:
                cursor = payload.get("cursor", cursor)
                _ensure_channels(figure, frames, limit=MAX_CHANNELS)
                _ingest(figure, frames, keys)
        except Exception:  # 同步线程永不把异常抛给主线程
            LOGGER.debug("plotkit 同步失败", exc_info=True)
        time.sleep(SYNC_INTERVAL)


def _reset(figure: Any) -> None:
    """场景重置后清空历史：旧通道的曲线不该和新场景的数据拼在一起。"""
    import numpy as np

    try:
        figure.clear()
        fig_cfg = figure.spec.setdefault("figure", {})
        fig_cfg["subplots"] = 1
        for name in list(figure.store.names()):
            meta = figure.store.meta(name)
            figure.store.add(
                name,
                np.zeros(0, dtype="float64"),
                unit=meta.get("unit", ""),
                role=meta.get("role", "series"),
                life=meta.get("life", "append"),
                overwrite=True,
            )
    except Exception:
        LOGGER.debug("清空绘图历史失败", exc_info=True)


def _ensure_channels(figure: Any, frames: list[dict[str, Any]], *, limit: int = 4) -> None:
    """场景里新出现的通道自动补成数据集 + 图层（最多 limit 条曲线）。"""
    existing = set(figure.store.names())
    incoming: list[str] = []
    for frame in frames:
        for key in (frame.get("v") or {}):
            if key not in existing and key not in incoming:
                incoming.append(key)
    for key in incoming:
        if len(figure.spec["layers"]) >= limit:
            return
        figure.add_data(key, [], role="series", life="append", tags=[key.split(":")[0]])
        try:
            figure.add_plot(x="t", y=key, label=_label(key))
        except Exception:  # 通道名里有怪字符时宁可少画一条
            LOGGER.debug("无法为通道 %s 建图层", key, exc_info=True)


def _ingest(figure: Any, frames: list[dict[str, Any]], keys: list[str]) -> None:
    """把一批帧追加进 PlotKit 的命名数据集；缺字段补 NaN，保持等长。"""
    import numpy as np

    store = figure.store
    times = [float(frame.get("t", 0.0)) for frame in frames]
    store.push("t", np.asarray(times, dtype="float64"))
    seen = {name for name in store.names() if name != "t"}
    for name in seen:
        values = []
        for frame in frames:
            raw = (frame.get("v") or {}).get(name)
            values.append(np.nan if raw is None else float(raw))
        store.push(name, np.asarray(values, dtype="float64"))
    for name in list(store.names()):
        if name != "t" and len(store.get(name)) > MAX_POINTS:
            store.add(name, store.get(name)[-MAX_POINTS:], role="series", life="replace", overwrite=True)
    if "t" in store.names() and len(store.get("t")) > MAX_POINTS:
        store.add("t", store.get("t")[-MAX_POINTS:], role="coord", life="replace", overwrite=True)


def mount(app: Any, service: Any | None = None) -> bool:
    """把 PlotKit 子应用挂到 ``/plotkit``；成功返回 True，缺依赖/已挂载返回 False。"""
    with _LOCK:
        if _STATE.get("app") is not None:
            return False
        try:
            from plotkit.server.app import create_app
        except Exception:
            LOGGER.info("未安装 plotkit，跳过 /plotkit 子应用")
            return False
        try:
            from .server import SERVICE

            target = service if service is not None else SERVICE
            figure = build_figure(target)
            sub_app = create_app(figure, title="Netlab · PlotKit", layout_path=None)
            app.mount(MOUNT_PATH, sub_app)
            stop_event = threading.Event()
            thread = threading.Thread(
                target=_sync_loop,
                args=(target, figure, stop_event),
                name="netlab-plotkit-sync",
                daemon=True,
            )
            thread.start()
            _STATE.update({"figure": figure, "app": sub_app, "thread": thread, "stop": stop_event})
            LOGGER.info("PlotKit 已挂载到 %s", MOUNT_PATH)
            return True
        except Exception:
            LOGGER.warning("PlotKit 挂载失败，已跳过", exc_info=True)
            return False


def figure() -> Any:
    return _STATE.get("figure")


def stop() -> None:
    stop_event = _STATE.get("stop")
    if stop_event is not None:
        stop_event.set()
