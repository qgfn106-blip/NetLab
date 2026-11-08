"""把 PlotKit 以子应用方式挂进 netlab（可选依赖，缺失时静默跳过）。

设计边界（D11/D13）：
- PlotKit 不 import netlab；本模块是**单向**的 netlab → PlotKit。
- 老的时间序列页签一行不改，新页签并存，用 ``?chart=plotkit`` / 子页签开关进退。
- 失败即降级：没装 plotkit、挂载报错，都不影响 netlab 启动。
"""

from __future__ import annotations

import importlib
import importlib.util
import json
import logging
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any

from .contracts import PLOTKIT_MAX_EXCLUSIVE, PLOTKIT_MIN
from .core.model.channels import ChannelKey

LOGGER = logging.getLogger(__name__)

MOUNT_PATH = "/plotkit"
PLUGIN_ID = "netlab.plotkit"
PLUGIN_DIR = Path(__file__).resolve().parents[1] / "extensions" / "plugins" / PLUGIN_ID
#: 每个通道保留的点数；超出后只留尾部（对应 spec 里的 life="replace" 语义）
MAX_POINTS = 20_000
#: 每次同步最多取多少帧。必须 ≥ recorder 容量（见 simulation.RECORDER_CAPACITY），
#: 否则预计算一次灌进来的帧会被 ``Recorder.since`` 再均匀抽稀一遍——2026-11-03
#: 用户反馈「提高仿真精度 PlotKit 曲线没变化」的另一半原因就是这个 600 的上限。
SYNC_PULL_LIMIT = 6000
#: 同步线程的采样节奏（秒）；前端实时重绘是 1Hz，这里 2Hz 足够，再快只是白烧 CPU
SYNC_INTERVAL = 0.5
#: 最多同时接多少个通道（probes 一次可能给 240 个）
MAX_CHANNELS = 64
#: 分析曲线数据集前缀。它们有自己的 x/y，不能参与 recorder 时间轴对齐。
ANALYSIS_PREFIX = "analysis:"
DEFAULT_WINDOW = 5.0  # 秒；与 netlab 老画布的「时间窗」默认值一致
#: 探针曲线统一细实线（默认的「线 + 圆点」在高密度下会糊成一片）
LINE_STYLE = {"mode": "lines", "width": 1.4, "marker": {"symbol": ""}}

_LOCK = threading.Lock()
_STATE: dict[str, Any] = {"figure": None, "app": None, "thread": None, "service": None}
#: 面板是否可见；不可见时不采样（省 CPU / 内存，避免后台白白堆积数据）
_ACTIVE = threading.Event()
#: 原生界面显式指定的配色 / 通道；None 表示按 workspace 设置与自动发现
_FORCED: dict[str, Any] = {"theme": None, "keys": None}
#: 由桥登记过的数据集名。场景重置时只清这些，用户自己在 PlotKit 里加的数据不动。
_REGISTERED: set[str] = set()
#: 最近一次挂载/导入失败的原因（给诊断接口用，避免"未挂载"这种无信息提示）
_LAST_ERROR: str = ""


def plugin_available() -> bool:
    """PlotKit 是否以插件包形式安装（``extensions/plugins/netlab.plotkit``）。"""
    return (PLUGIN_DIR / "plugin.json").is_file()


def plugin_enabled() -> bool:
    """读取插件管理器的持久化开关；没有状态文件时按启用处理。"""
    if not plugin_available():
        return False
    state_file = PLUGIN_DIR.parent / "plugins_state.json"
    if not state_file.is_file():
        return True
    try:
        payload = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return True
    return PLUGIN_ID not in set(map(str, payload.get("disabled") or []))



def _version_tuple(version: str) -> tuple[int, ...]:
    parts: list[int] = []
    for chunk in str(version).split(".")[:3]:
        digits = "".join(ch for ch in chunk if ch.isdigit())
        parts.append(int(digits or 0))
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts)


def probe() -> dict[str, Any]:
    """PlotKit 可用性三态：``missing`` / ``incompatible`` / ``available``。

    只依赖 PlotKit 的公开接口 ``plotkit.probe()``；旧版本没有该接口时退回
    ``__version__`` 区间判断，绝不 import PlotKit 的任何内部模块。
    """
    if not ensure_plotkit_importable():
        return {"state": "missing", "version": None, "detail": "PlotKit 未安装"}
    try:
        import plotkit
    except Exception as exc:  # pragma: no cover - 安装损坏时给可读降级
        return {
            "state": "missing",
            "version": None,
            "detail": f"PlotKit 导入失败：{exc}",
        }
    version = str(getattr(plotkit, "__version__", "") or "")
    inner = getattr(plotkit, "probe", None)
    if callable(inner):
        try:
            result = dict(inner())
            result.setdefault("version", version)
            return result
        except Exception as exc:  # pragma: no cover - 公开 probe 自身故障
            return {
                "state": "incompatible",
                "version": version,
                "detail": f"PlotKit probe 失败：{exc}",
            }
    if PLOTKIT_MIN <= _version_tuple(version) < PLOTKIT_MAX_EXCLUSIVE:
        return {"state": "available", "version": version, "detail": ""}
    return {
        "state": "incompatible",
        "version": version,
        "detail": f"PlotKit {version or '未知版本'} 不在 >=0.2,<0.3 兼容范围内",
    }


def _load_development_source(src: Path) -> None:
    """从显式开发目录加载 ``plotkit``（仅开发用；绝不修改 ``sys.path``）。

    用 ``importlib.util.spec_from_file_location`` 建立包，子模块通过包的
    ``__path__`` 解析，因此不需要把源码目录塞进 ``sys.path``。
    """
    package_dir = src / "plotkit"
    init = package_dir / "__init__.py"
    if not init.is_file():
        raise FileNotFoundError(f"{src} 下没有 plotkit/__init__.py")
    spec = importlib.util.spec_from_file_location(
        "plotkit", init, submodule_search_locations=[str(package_dir)]
    )
    if spec is None or spec.loader is None:  # pragma: no cover - 解释器异常
        raise ImportError(f"无法为 {init} 创建 import spec")
    module = importlib.util.module_from_spec(spec)
    sys.modules["plotkit"] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop("plotkit", None)
        raise


def ensure_plotkit_importable() -> bool:
    """确保 ``import plotkit`` 可用（C-4 / D154：只剩两级来源）。

    1. 已安装的包（``pip install plotkit``，正常运行与 CI 的唯一来源）；
    2. ``NETLAB_PLOTKIT_SRC`` 指定的开发源码目录（仅开发/调试用，用 importlib
       直接加载，不写 ``sys.path``）。

    不再有任何内置副本 / 插件副本 / 同仓库相对路径的隐式回退；找不到时返回
    False，并通过 :func:`last_error` 给出可读原因。
    """
    global _LAST_ERROR
    if "plotkit" in sys.modules:
        return True
    try:
        importlib.import_module("plotkit")
        LOGGER.info("PlotKit 使用已安装的包")
        return True
    except Exception as exc:
        installed_error = f"{type(exc).__name__}: {exc}"
    override = (os.environ.get("NETLAB_PLOTKIT_SRC") or "").strip()
    if override:
        src = Path(override)
        try:
            _load_development_source(src)
            LOGGER.info("PlotKit 使用开发源码 %s", src)
            return True
        except Exception as exc:
            _LAST_ERROR = (
                f"NETLAB_PLOTKIT_SRC={src} 加载失败：{type(exc).__name__}: {exc}"
            )
            return False
    _LAST_ERROR = (
        "PlotKit 未安装（"
        + installed_error
        + "）；请 pip install 'plotkit>=0.2,<0.3'，或设置 NETLAB_PLOTKIT_SRC 指向开发源码"
    )
    return False


def last_error() -> str:
    """最近一次 PlotKit 导入/挂载失败的原因；空串表示没有错误。"""
    return _LAST_ERROR


def _label(key: str) -> str:
    """``n:signal:voltage`` → ``signal·voltage``；其它形状原样返回。"""
    channel = ChannelKey.parse(key)
    return channel.label() if channel is not None else key


def _kind_tag(key: str) -> str:
    """通道类型标签（``n``/``e``/``state``）；未知键返回空串。"""
    channel = ChannelKey.parse(key)
    return channel.kind if channel is not None else ""


def _theme_name(service: Any) -> str:
    """把 netlab 的主题映射成 PlotKit 的配色。"""
    forced = _FORCED.get("theme")
    if forced:
        return str(forced)
    try:
        from .core.model.workspace import load_settings

        theme = str((load_settings() or {}).get("theme") or "dark")
    except Exception:  # 读配置失败不该挡住绘图
        theme = "dark"
    return "netlab-dark" if theme == "dark" else "default"


def set_active(active: bool) -> bool:
    """打开/关闭同步采样；返回当前是否激活。"""
    if active:
        _ACTIVE.set()
        _ensure_sync_thread()
    else:
        _ACTIVE.clear()
    return bool(active)


def is_active() -> bool:
    return _ACTIVE.is_set()


def _ensure_sync_thread() -> None:
    """确保采样线程活着。

    ``stop()`` 会结束线程（进程退出、测试卸载都会调用）；但全局桥本身不重建，
    之后再打开面板就没人采样了。这里在需要时按原 service/figure 重建一个。
    """
    thread = _STATE.get("thread")
    if thread is not None and thread.is_alive():
        return
    figure = _STATE.get("figure")
    service = _STATE.get("service")
    if figure is None or service is None:
        return
    stop_event = threading.Event()
    thread = threading.Thread(
        target=_sync_loop,
        args=(service, figure, stop_event),
        name="netlab-plotkit-sync",
        daemon=True,
    )
    thread.start()
    _STATE["thread"] = thread
    _STATE["stop"] = stop_event


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
    """登记要接入的通道（只登记数据源，不自动建图层）。

    D-PlotView：接入 = 把探针列注册成 PlotKit 的数据集；画什么、怎么画由用户在
    PlotKit 的图层面板里自己决定（拖拽/加图层），宿主不再替他生成曲线。
    """
    figure = _STATE.get("figure")
    wanted = [str(k) for k in (keys or [])][:MAX_CHANNELS]
    _FORCED["keys"] = wanted or None
    # 显式接入通道说明用户马上要看图，顺手把采样打开
    if wanted:
        _ACTIVE.set()
        _ensure_sync_thread()
    if figure is None:
        return False
    try:
        names = set(figure.store.names())
        targets = wanted or [k for k in sorted(names) if k != "t"][:MAX_CHANNELS]
        if wanted:
            # 显式接入时以选择为准：清掉上次接入、这次没选的通道，避免数据集列表
            # 越积越多（旧选择还会占着 MAX_CHANNELS 名额）。
            keep = set(wanted)
            for name in [n for n in _REGISTERED if n not in keep]:
                figure.store.remove(name)
                _REGISTERED.discard(name)
                names.discard(name)
        for key in targets:
            if key in names:
                continue
            if "t" in names:
                import numpy as np

                figure.add_data(
                    key,
                    np.full(len(figure.store.get("t")), np.nan),
                    role="series",
                    life="append",
                    tags=[_kind_tag(key)],
                )
                _REGISTERED.add(key)
    except Exception:
        LOGGER.debug("登记 PlotKit 通道失败", exc_info=True)
        return False
    return True


def selected_channels() -> list[str]:
    """当前接入的通道名（不含坐标 t）；供界面回显选中项。

    D-PlotView 起「接入」只登记数据集、不建图层，所以默认返回全部已登记通道。
    """
    if _FORCED.get("keys"):
        return list(_FORCED["keys"])
    return channels()


def channels() -> list[str]:
    """当前 figure 里可选的通道名（不含坐标 t 与分析曲线）。"""
    figure = _STATE.get("figure")
    if figure is None:
        return []
    try:
        return [
            name
            for name in figure.store.names()
            if name != "t" and not name.startswith(ANALYSIS_PREFIX)
        ]
    except Exception:
        return []


def add_analysis_curve(
    name: str,
    x: Any,
    y: Any,
    *,
    figure: Any = None,
    x_label: str = "t / s",
    y_label: str = "value",
) -> dict[str, Any]:
    """把一条分析曲线（TF 阶跃、相图等）作为独立数据集/图层送进 PlotKit。

    分析曲线不参与 recorder 的 ``t`` 追加：数据集名带 ``analysis:`` 前缀，
    ``_ingest`` 会跳过它们。重复发送同名曲线时替换旧图层，而不是越叠越多。
    """
    import numpy as np

    fig = figure if figure is not None else _STATE.get("figure")
    if fig is None:
        raise RuntimeError("PlotKit 未挂载，无法接收分析曲线")
    xs = np.asarray(list(x or []), dtype="float64")
    ys = np.asarray(list(y or []), dtype="float64")
    if xs.size == 0 or ys.size == 0 or xs.size != ys.size:
        raise ValueError("分析曲线的 x/y 必须非空且长度一致")
    if xs.size > MAX_POINTS:
        indices = np.linspace(0, xs.size - 1, MAX_POINTS, dtype=int)
        xs, ys = xs[indices], ys[indices]
    slug = "".join(
        ch if ch.isalnum() or ch in "-_." else "_" for ch in str(name)
    ).strip("_")
    slug = slug or "curve"
    key = f"{ANALYSIS_PREFIX}{slug}"
    x_name = f"{key}:x"
    y_name = f"{key}:y"
    label = str(name)
    import plotkit as pk

    with pk.store_lock():
        # 同名曲线先移除旧图层（x/y 数据集直接覆盖）。
        layers = list(fig.spec.get("layers") or [])
        kept = [
            layer
            for layer in layers
            if not (
                layer.get("label") == label
                or (layer.get("data") or {}).get("x") == x_name
            )
        ]
        if len(kept) != len(layers):
            fig.spec["layers"][:] = kept
        fig.add_data(x_name, xs, unit="s", role="coord", life="replace", overwrite=True)
        fig.add_data(y_name, ys, unit="", role="series", life="replace", overwrite=True)
        fig.add_plot("line", x=x_name, y=y_name, label=label, style=LINE_STYLE)
        fig.set_view(0, xlabel=x_label, ylabel=y_label)
    return {"ok": True, "dataset": key, "points": int(xs.size), "label": label}


def build_figure(service: Any) -> Any:
    """按当前场景的探针通道建一张图；没有任何通道时留一张空图。"""
    import plotkit as pk

    fig = pk.figure(
        size=(10.0, 6.0),
        dpi=100,
        theme=_theme_name(service),
        title="信号（PlotKit 预览）",
    )
    keys = (
        list(getattr(service, "recorder", None).keys())[:MAX_CHANNELS]
        if getattr(service, "recorder", None)
        else []
    )
    fig.add_data("t", [], unit="s", role="coord", life="append")
    for key in keys:
        fig.add_data(key, [], role="series", life="append", tags=[_kind_tag(key)])
        _REGISTERED.add(key)
    # D-PlotView：只登记数据源；曲线由用户在 PlotKit 图层面板里自己加
    fig.set_view(0, xlabel="t / s", grid=True)
    # 和老画布默认一致：只显示最近 5 秒（可在界面上改，回放时沿游标往回截）
    fig.window(DEFAULT_WINDOW)
    return fig


def _sync_once(
    service: Any, figure: Any, cursor: int, generation: str | None
) -> tuple[int, str | None]:
    """跑一轮增量同步，返回 ``(cursor, generation)``。

    单独拆出来是为了让测试能确定性地驱动“一轮同步”，不必等 0.5s 的线程节奏，
    也不用为重置 / 代次切换这类时序问题写 sleep。
    """
    payload = service.live(cursor, limit=SYNC_PULL_LIMIT)
    current = payload.get("generation")
    reset = payload.get("cursor", cursor) < cursor  # 重新运行 / 换场景 / 重置
    if current is not None:
        if generation is None:
            generation = current
        elif current != generation:
            # 2026-11-03 修复：记录器 clear() 后 seq 从 0 重新开始，旧 cursor
            # 可能恰好等于新 seq，只看 cursor 是否变小会漏掉重置，把新旧
            # 两段数据拼在一条曲线上。代次变了就整段重来。
            reset = True
    if reset:
        cursor = 0
        # 用 cursor=0 重新取整段新记录：旧 cursor 读新记录可能直接是空的
        payload = service.live(0, limit=SYNC_PULL_LIMIT)
        frames = payload.get("frames") or []
        if payload.get("generation") is not None:
            generation = payload["generation"]
        import plotkit as pk

        with pk.store_lock():
            _reset(figure, payload.get("keys"))
    else:
        frames = payload.get("frames") or []
    if frames:
        cursor = payload.get("cursor", cursor)
        import plotkit as pk

        with pk.store_lock():  # 与出图线程互斥，避免读到半写入的数据集
            if _FORCED.get("keys") is None:
                _ensure_channels(figure, frames, limit=MAX_CHANNELS)
            _ingest(figure, frames, [])
    return cursor, generation


def _sync_loop(service: Any, figure: Any, stop_event: threading.Event) -> None:
    cursor = 0
    generation: str | None = None
    while not stop_event.is_set():
        # 没有人看这个面板就不采样（挂载后默认关，前端打开面板时再打开）
        if not _ACTIVE.is_set():
            stop_event.wait(0.5)
            continue
        try:
            cursor, generation = _sync_once(service, figure, cursor, generation)
        except Exception:  # 同步线程永不把异常抛给主线程
            LOGGER.debug("plotkit 同步失败", exc_info=True)
        time.sleep(SYNC_INTERVAL)


def _reset(figure: Any, keys: list[str] | None = None) -> None:
    """场景重置后清空历史：旧通道的曲线不该和新场景的数据拼在一起。

    ``keys`` 是新场景当前的通道名（``Recorder.keys()``，未知时传 None）：
    - 已知时删掉桥自己登记过、但新场景已经没有的数据集，避免通道列表一直挂着
      上一个场景的名字；用户自己加的数据集不在 ``_REGISTERED`` 里，不会被删。
    - 同时把失效的固定选择剪掉；全失效则退回自动发现。
    - 不再强制 ``subplots = 1``：那是用户的版式设置，重置数据不该顺手改掉。
    """
    import numpy as np

    try:
        figure.clear()
        current = set(keys or [])
        if current:
            stale = [name for name in _REGISTERED if name not in current]
            for name in stale:
                figure.store.remove(name)
                _REGISTERED.discard(name)
        for name in list(figure.store.names()):
            # t 也要清空：只清序列、留着旧 t 的话，重放的第一帧会接在旧时间轴后面
            # （x 出现重复段，曲线被拉长），对齐逻辑也会把新序列补满 NaN。
            meta = figure.store.meta(name)
            figure.store.add(
                name,
                np.zeros(0, dtype="float64"),
                unit=meta.get("unit", ""),
                role=meta.get("role", "series"),
                life=meta.get("life", "append"),
                overwrite=True,
            )
        forced = _FORCED.get("keys")
        if forced is not None and current:
            kept = [key for key in forced if key in current]
            _FORCED["keys"] = kept or None
    except Exception:
        LOGGER.debug("清空绘图历史失败", exc_info=True)


def _ensure_channels(
    figure: Any, frames: list[dict[str, Any]], *, limit: int = 4
) -> None:
    """场景里新出现的通道自动补成数据集 + 图层（最多 limit 条曲线）。

    新通道必须**先补齐到当前 t 的长度**（用 NaN）：中途出现的探针若从 0 长度开始
    追加，它和 ``t`` 的长度会永远错开，下一次 render 直接抛
    ``ValueError: 图层 x/y 长度不一致``，曲线就此卡住不再更新。
    """
    import numpy as np

    existing = {
        name for name in figure.store.names() if not name.startswith(ANALYSIS_PREFIX)
    }
    incoming: list[str] = []
    for frame in frames:
        for key in frame.get("v") or {}:
            if key not in existing and key not in incoming:
                incoming.append(key)
    # 2026-11-03 修复：以前用 len(figure.spec["layers"]) 判上限，但 D-PlotView 只
    # 登记数据集、不自动建图层，layers 恒为 0，64 条通道的上限根本没生效（80 个
    # 探针能全部进来）。这里按已登记的数据集计数，t 是坐标不算通道。
    used = len([name for name in existing if name != "t"])
    room = max(0, int(limit) - used)
    t_len = len(figure.store.get("t")) if "t" in existing else 0
    for key in incoming:
        if room <= 0:
            return
        figure.add_data(
            key,
            np.full(t_len, np.nan, dtype="float64"),
            role="series",
            life="append",
            tags=[_kind_tag(key)],
        )
        _REGISTERED.add(key)
        room -= 1


def _ingest(figure: Any, frames: list[dict[str, Any]], keys: list[str]) -> None:
    """把一批帧追加进 PlotKit 的命名数据集；缺字段补 NaN，保持等长。"""
    import numpy as np

    store = figure.store
    names_all = list(store.names())
    t_len = len(store.get("t")) if "t" in names_all else 0
    # 对齐：任何比 t 短的序列先补 NaN，比 t 长的先裁掉，保证 push 后长度一致。
    # 分析曲线有自己的 x/y 轴，不参与 recorder 时间轴对齐。
    for name in names_all:
        if name == "t" or name.startswith(ANALYSIS_PREFIX):
            continue
        have = len(store.get(name))
        if have < t_len:
            store.push(name, np.full(t_len - have, np.nan, dtype="float64"))
        elif have > t_len:
            store.trim(name, t_len)
    times = [float(frame.get("t", 0.0)) for frame in frames]
    store.push("t", np.asarray(times, dtype="float64"))
    seen = {
        name
        for name in store.names()
        if name != "t" and not name.startswith(ANALYSIS_PREFIX)
    }
    for name in seen:
        values = []
        for frame in frames:
            raw = (frame.get("v") or {}).get(name)
            values.append(np.nan if raw is None else float(raw))
        store.push(name, np.asarray(values, dtype="float64"))
    for name in list(store.names()):
        if (
            name != "t"
            and not name.startswith(ANALYSIS_PREFIX)
            and len(store.get(name)) > MAX_POINTS
        ):
            # 必须用 trim 而不是 add(..., life="replace")：后者会把数据集永久改成
            # "替换"语义，下一次 push 只留最后一帧，曲线几秒后就塌了。
            store.trim(name, MAX_POINTS)
    if "t" in store.names() and len(store.get("t")) > MAX_POINTS:
        store.trim("t", MAX_POINTS)


def diagnose() -> dict[str, Any]:
    """挂载诊断：告诉界面到底缺什么。"""
    info: dict[str, Any] = {
        "mounted": _STATE.get("figure") is not None,
        "plugin_id": PLUGIN_ID,
        "plugin_available": plugin_available(),
        "plugin_enabled": plugin_enabled(),
        "plugin_path": str(PLUGIN_DIR),
    }
    try:
        spec = importlib.util.find_spec("plotkit")
        info["plotkit_module"] = getattr(spec, "origin", None) if spec else None
    except Exception:
        info["plotkit_module"] = None
    override = (os.environ.get("NETLAB_PLOTKIT_SRC") or "").strip()
    info["development_source"] = override or None
    info["probe"] = probe()
    info["last_error"] = _LAST_ERROR
    info["active"] = _ACTIVE.is_set()
    return info


def remount(app: Any | None = None, service: Any | None = None) -> bool:
    """运行时再试一次挂载（用户点了「重试」或首次挂载时依赖还没就绪）。"""
    if _STATE.get("figure") is not None:
        return True
    if app is None:
        # 不反向 import netlab.server（A2 无环）；调用方必须显式传入 app。
        LOGGER.info("PlotKit remount 缺少 app，跳过")
        return False
    return mount(app, service)


def mount(app: Any, service: Any | None = None) -> bool:
    """把 PlotKit 子应用挂到 ``/plotkit``；成功返回 True，缺依赖/已挂载返回 False。"""
    with _LOCK:
        if _STATE.get("app") is not None:
            return False
        if plugin_available() and not plugin_enabled():
            LOGGER.info("netlab.plotkit 插件已停用，跳过 /plotkit 子应用")
            return False
        try:
            if not ensure_plotkit_importable():
                LOGGER.info("未安装 plotkit，跳过 /plotkit 子应用")
                return False
            import plotkit as pk
        except Exception:
            LOGGER.info("未安装 plotkit，跳过 /plotkit 子应用", exc_info=True)
            return False
        try:
            target = service if service is not None else _STATE.get("service")
            if target is None:
                LOGGER.info("PlotKit 挂载缺少 service，跳过")
                return False
            _STATE["service"] = target
            figure = build_figure(target)
            sub_app = pk.PlotRenderPort(
                figure, title="Netlab · PlotKit", layout_path=None
            ).app
            fallback = _STATE.pop("fallback_app", None)
            if fallback is not None:
                # 启动时挂了降级子应用；真正挂载成功后必须摘掉，否则同前缀会先命中降级页。
                app.router.routes = [
                    route
                    for route in app.router.routes
                    if getattr(route, "app", None) is not fallback
                ]
            app.mount(MOUNT_PATH, sub_app)
            stop_event = threading.Event()
            thread = threading.Thread(
                target=_sync_loop,
                args=(target, figure, stop_event),
                name="netlab-plotkit-sync",
                daemon=True,
            )
            thread.start()
            _STATE.update(
                {
                    "figure": figure,
                    "app": sub_app,
                    "thread": thread,
                    "stop": stop_event,
                    "service": target,
                }
            )
            LOGGER.info("PlotKit 已挂载到 %s", MOUNT_PATH)
            return True
        except Exception:
            LOGGER.warning("PlotKit 挂载失败，已跳过", exc_info=True)
            return False


def mount_fallback(app: Any) -> None:
    """PlotKit 不可用时在 ``/plotkit`` 下给出明确三态响应。

    契约要求：不得 500、不得 traceback、不得静默返回空页。无论请求哪个子路径，
    都回 503 + JSON ``{state, version, detail, path}``，前端据此展示"未安装 /
    版本不符"的可读提示。
    """
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse

    fallback = FastAPI(
        title="Netlab · PlotKit（不可用）",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @fallback.api_route(
        "/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"]
    )
    def plotkit_unavailable(path: str) -> JSONResponse:
        state = probe()
        return JSONResponse(
            status_code=503,
            content={
                "state": state.get("state", "missing"),
                "version": state.get("version"),
                "detail": state.get("detail") or "PlotKit 不可用",
                "path": f"{MOUNT_PATH}/{path}".rstrip("/") or MOUNT_PATH,
            },
        )

    app.mount(MOUNT_PATH, fallback)
    _STATE["fallback_app"] = fallback


def figure() -> Any:
    return _STATE.get("figure")


def stop() -> None:
    """停止同步线程：置位、join，并清掉线程状态（测试/重启可安全复用）。"""
    _ACTIVE.clear()
    stop_event = _STATE.get("stop")
    thread = _STATE.get("thread")
    if stop_event is not None:
        stop_event.set()
    if (
        thread is not None
        and thread.is_alive()
        and thread is not threading.current_thread()
    ):
        thread.join(timeout=2.0)
    _STATE["thread"] = None
    _STATE["stop"] = None
