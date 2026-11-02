"""把 PlotKit 以子应用方式挂进 netlab（可选依赖，缺失时静默跳过）。

设计边界（D11/D13）：
- PlotKit 不 import netlab；本模块是**单向**的 netlab → PlotKit。
- 老的时间序列页签一行不改，新页签并存，用 ``?chart=plotkit`` / 子页签开关进退。
- 失败即降级：没装 plotkit、挂载报错，都不影响 netlab 启动。
"""

from __future__ import annotations

import importlib
import logging
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any

LOGGER = logging.getLogger(__name__)

MOUNT_PATH = "/plotkit"
#: 每个通道保留的点数；超出后只留尾部（对应 spec 里的 life="replace" 语义）
MAX_POINTS = 20_000
#: 同步线程的采样节奏（秒）；前端实时重绘是 1Hz，这里 2Hz 足够，再快只是白烧 CPU
SYNC_INTERVAL = 0.5
#: 最多同时接多少个通道（probes 一次可能给 240 个）
MAX_CHANNELS = 6
DEFAULT_WINDOW = 5.0   # 秒；与 netlab 老画布的「时间窗」默认值一致
#: 探针曲线统一细实线（默认的「线 + 圆点」在高密度下会糊成一片）
LINE_STYLE = {"mode": "lines", "width": 1.4, "marker": {"symbol": ""}}

_LOCK = threading.Lock()
_STATE: dict[str, Any] = {"figure": None, "app": None, "thread": None}
#: 原生界面显式指定的配色 / 通道；None 表示按 workspace 设置与自动发现
_FORCED: dict[str, Any] = {"theme": None, "keys": None}


def _plotkit_src_candidates() -> list[Path]:
    """PlotKit 源码目录的几个可能位置（同仓库并列布局优先）。"""
    here = Path(__file__).resolve()
    return [
        here.parents[2] / "PlotKit" / "src",        # ProjectPoint/PlotKit/src
        here.parents[1] / "PlotKit" / "src",        # NetlabHome/PlotKit/src
        here.parents[3] / "PlotKit" / "src",        # 更外层
    ]


def ensure_plotkit_importable() -> bool:
    """确保 ``import plotkit`` 可用。

    优先用已安装的 wheel；没有安装时，把同仓库的 ``PlotKit/src`` 追加进
    ``sys.path``（本地单机应用，避免让用户先跑 ``pip install -e``）。
    也可用环境变量 ``NETLAB_PLOTKIT_SRC`` 指定源码目录。
    """
    try:
        importlib.import_module("plotkit")
        return True
    except Exception:
        pass
    override = os.environ.get("NETLAB_PLOTKIT_SRC")
    vendored = None
    try:  # 内置副本（netlab/_vendor/plotkit）优先：装好 netlab 就带着 PlotKit
        from . import plotkit_vendor

        vendored = plotkit_vendor.vendor_path()
    except Exception:
        vendored = None
    candidates = ([vendored] if vendored else []) + ([Path(override)] if override else []) + _plotkit_src_candidates()
    for path in candidates:
        try:
            if (path / "plotkit" / "__init__.py").is_file():
                entry = str(path)
                if entry not in sys.path:
                    sys.path.insert(0, entry)
                importlib.invalidate_caches()
                importlib.import_module("plotkit")
                LOGGER.info("PlotKit 未安装，改用源码目录 %s", entry)
                return True
        except Exception:
            LOGGER.debug("从 %s 加载 PlotKit 失败", path, exc_info=True)
    return False


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
    forced = _FORCED.get("theme")
    if forced:
        return str(forced)
    try:
        from .workspace import load_settings

        theme = str((load_settings() or {}).get("theme") or "dark")
    except Exception:  # 读配置失败不该挡住绘图
        theme = "dark"
    return "netlab-dark" if theme == "dark" else "default"


def set_theme(dark: bool) -> bool:
    """让 PlotKit 的图跟着原生界面换深浅色；返回是否已作用到现有 figure。"""
    name = "netlab-dark" if dark else "default"
    _FORCED["theme"] = name
    figure = _STATE.get("figure")
    if figure is None:
        return False
    try:
        figure.spec.setdefault("figure", {})["theme"] = name
    except Exception:
        return False
    return True


def _layer_y(layer: dict[str, Any]) -> str:
    """图层里被画成曲线的通道名（PlotKit 把 x/y 放在 ``data`` 下）。"""
    data = layer.get("data") or {}
    return str(data.get("y") or "")


def set_channels(keys: list[str] | None) -> bool:
    """只显示指定通道（None/空 = 恢复自动发现）；用于「选中节点 → 看它的探针」。"""
    figure = _STATE.get("figure")
    wanted = [str(k) for k in (keys or [])][:MAX_CHANNELS]
    _FORCED["keys"] = wanted or None
    if figure is None:
        return False
    try:
        names = set(figure.store.names())
        keep = [layer for layer in figure.spec.get("layers") or [] if _layer_y(layer) == "t"]
        figure.spec["layers"] = keep
        targets = wanted or [k for k in names if k != "t"][:MAX_CHANNELS]
        for key in targets:
            if key not in names:
                continue
            figure.add_plot(x="t", y=key, label=_label(key), style=LINE_STYLE)
    except Exception:
        LOGGER.debug("切换 PlotKit 通道失败", exc_info=True)
        return False
    return True


def selected_channels() -> list[str]:
    """当前图里真正在画的通道名（不含坐标 t）；供界面回显选中项。"""
    if _FORCED.get("keys"):
        return list(_FORCED["keys"])
    figure = _STATE.get("figure")
    if figure is None:
        return []
    try:
        out: list[str] = []
        for layer in figure.spec.get("layers") or []:
            key = _layer_y(layer)
            if key and key != "t" and key not in out:
                out.append(key)
        return out
    except Exception:
        return []

def channels() -> list[str]:
    """当前 figure 里可选的通道名（不含坐标 t）。"""
    figure = _STATE.get("figure")
    if figure is None:
        return []
    try:
        return [name for name in figure.store.names() if name != "t"]
    except Exception:
        return []


def build_figure(service: Any) -> Any:
    """按当前场景的探针通道建一张图；没有任何通道时留一张空图。"""
    import plotkit as pk

    fig = pk.figure(size=(10.0, 6.0), dpi=100, theme=_theme_name(service), title="信号（PlotKit 预览）")
    keys = list(getattr(service, "recorder", None).keys())[:MAX_CHANNELS] if getattr(service, "recorder", None) else []
    fig.add_data("t", [], unit="s", role="coord", life="append")
    for key in keys:
        fig.add_data(key, [], role="series", life="append", tags=[key.split(":")[0]])
        fig.add_plot(x="t", y=key, label=_label(key), subplot=0, style=LINE_STYLE)
    fig.set_view(0, xlabel="t / s", grid=True)
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
                from plotkit.store.registry import DATA_LOCK as _DL

                with _DL:
                    _reset(figure)
            if frames:
                cursor = payload.get("cursor", cursor)
                from plotkit.store.registry import DATA_LOCK

                with DATA_LOCK:  # 与出图线程互斥，避免读到半写入的数据集
                    if _FORCED.get("keys") is None:
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
    """场景里新出现的通道自动补成数据集 + 图层（最多 limit 条曲线）。

    新通道必须**先补齐到当前 t 的长度**（用 NaN）：中途出现的探针若从 0 长度开始
    追加，它和 ``t`` 的长度会永远错开，下一次 render 直接抛
    ``ValueError: 图层 x/y 长度不一致``，曲线就此卡住不再更新。
    """
    import numpy as np

    existing = set(figure.store.names())
    incoming: list[str] = []
    for frame in frames:
        for key in (frame.get("v") or {}):
            if key not in existing and key not in incoming:
                incoming.append(key)
    t_len = len(figure.store.get("t")) if "t" in existing else 0
    for key in incoming:
        if len(figure.spec["layers"]) >= limit:
            return
        figure.add_data(
            key, np.full(t_len, np.nan, dtype="float64"), role="series", life="append",
            tags=[key.split(":")[0]],
        )
        try:
            figure.add_plot(x="t", y=key, label=_label(key), style=LINE_STYLE)
        except Exception:  # 通道名里有怪字符时宁可少画一条
            LOGGER.debug("无法为通道 %s 建图层", key, exc_info=True)


def _ingest(figure: Any, frames: list[dict[str, Any]], keys: list[str]) -> None:
    """把一批帧追加进 PlotKit 的命名数据集；缺字段补 NaN，保持等长。"""
    import numpy as np

    from plotkit.store.registry import DATA_LOCK

    store = figure.store
    names_all = list(store.names())
    t_len = len(store.get("t")) if "t" in names_all else 0
    # 对齐：任何比 t 短的序列先补 NaN，比 t 长的先裁掉，保证 push 后长度一致
    for name in names_all:
        if name == "t":
            continue
        have = len(store.get(name))
        if have < t_len:
            store.push(name, np.full(t_len - have, np.nan, dtype="float64"))
        elif have > t_len:
            store.trim(name, t_len)
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
            # 必须用 trim 而不是 add(..., life="replace")：后者会把数据集永久改成
            # "替换"语义，下一次 push 只留最后一帧，曲线几秒后就塌了。
            store.trim(name, MAX_POINTS)
    if "t" in store.names() and len(store.get("t")) > MAX_POINTS:
        store.trim("t", MAX_POINTS)


def mount(app: Any, service: Any | None = None) -> bool:
    """把 PlotKit 子应用挂到 ``/plotkit``；成功返回 True，缺依赖/已挂载返回 False。"""
    with _LOCK:
        if _STATE.get("app") is not None:
            return False
        try:
            if not ensure_plotkit_importable():
                LOGGER.info("未安装 plotkit，跳过 /plotkit 子应用")
                return False
            from plotkit.server.app import create_app
        except Exception:
            LOGGER.info("未安装 plotkit，跳过 /plotkit 子应用", exc_info=True)
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
