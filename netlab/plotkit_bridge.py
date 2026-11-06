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
DEFAULT_WINDOW = 5.0   # 秒；与 netlab 老画布的「时间窗」默认值一致
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

    优先级：已导入 → ``NETLAB_PLOTKIT_SRC``（显式指定源码）→ 内置副本
    ``netlab/_vendor/plotkit`` → 已安装的 wheel → 同仓库 ``PlotKit/src``。
    内置副本随 netlab 一起分发、版本固定，因此优先于环境里可能残留的旧安装；
    本地单机应用也不需要用户先跑 ``pip install -e``。
    """
    global _LAST_ERROR
    if "plotkit" in sys.modules:
        return True
    override = (os.environ.get("NETLAB_PLOTKIT_SRC") or "").strip()
    vendored = None
    try:  # 内置副本（netlab/_vendor/plotkit）：装好 netlab 就带着 PlotKit
        from . import plotkit_vendor

        vendored = plotkit_vendor.vendor_path()
    except Exception:
        vendored = None
    prioritized: list[tuple[Path, str]] = []
    if override:
        prioritized.append((Path(override), "NETLAB_PLOTKIT_SRC"))
    if vendored is not None:
        prioritized.append((vendored, "内置副本"))
    errors: list[str] = []
    for path, label in prioritized:
        entry = str(path)
        inserted = entry not in sys.path
        if inserted:
            sys.path.insert(0, entry)
        try:
            if (path / "plotkit" / "__init__.py").is_file():
                importlib.invalidate_caches()
                importlib.import_module("plotkit")
                LOGGER.info("PlotKit 使用%s %s", label, entry)
                return True
        except Exception as exc:  # 记下原因，继续退回其它来源
            errors.append(f"{path}: {exc}")
            LOGGER.debug("从 %s 加载 PlotKit 失败", path, exc_info=True)
        finally:
            if inserted and "plotkit" not in sys.modules and entry in sys.path:
                sys.path.remove(entry)
    # 已安装的 wheel（没有内置副本时的常规路径）
    try:
        importlib.import_module("plotkit")
        LOGGER.info("PlotKit 使用已安装的包")
        return True
    except Exception:
        pass
    for path in _plotkit_src_candidates():
        entry = str(path)
        inserted = entry not in sys.path
        if inserted:
            sys.path.insert(0, entry)
        try:
            if (path / "plotkit" / "__init__.py").is_file():
                importlib.invalidate_caches()
                importlib.import_module("plotkit")
                LOGGER.info("PlotKit 使用源码目录 %s", entry)
                return True
        except Exception as exc:
            errors.append(f"{path}: {exc}")
            LOGGER.debug("从 %s 加载 PlotKit 失败", path, exc_info=True)
        finally:
            if inserted and "plotkit" not in sys.modules and entry in sys.path:
                sys.path.remove(entry)
    _LAST_ERROR = "找不到可导入的 plotkit；候选：" + "; ".join(errors or [str(p) for p in _plotkit_src_candidates()])
    return False


def last_error() -> str:
    """最近一次 PlotKit 导入/挂载失败的原因；空串表示没有错误。"""
    return _LAST_ERROR


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
                figure.add_data(key, np.full(len(figure.store.get("t")), np.nan), role="series",
                                life="append", tags=[key.split(":")[0]])
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
    slug = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in str(name)).strip("_")
    slug = slug or "curve"
    key = f"{ANALYSIS_PREFIX}{slug}"
    x_name = f"{key}:x"
    y_name = f"{key}:y"
    label = str(name)
    from plotkit.store.registry import DATA_LOCK

    with DATA_LOCK:
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

    fig = pk.figure(size=(10.0, 6.0), dpi=100, theme=_theme_name(service), title="信号（PlotKit 预览）")
    keys = list(getattr(service, "recorder", None).keys())[:MAX_CHANNELS] if getattr(service, "recorder", None) else []
    fig.add_data("t", [], unit="s", role="coord", life="append")
    for key in keys:
        fig.add_data(key, [], role="series", life="append", tags=[key.split(":")[0]])
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
        from plotkit.store.registry import DATA_LOCK as _DL

        with _DL:
            _reset(figure, payload.get("keys"))
    else:
        frames = payload.get("frames") or []
    if frames:
        cursor = payload.get("cursor", cursor)
        from plotkit.store.registry import DATA_LOCK

        with DATA_LOCK:  # 与出图线程互斥，避免读到半写入的数据集
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


def _ensure_channels(figure: Any, frames: list[dict[str, Any]], *, limit: int = 4) -> None:
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
        for key in (frame.get("v") or {}):
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
            key, np.full(t_len, np.nan, dtype="float64"), role="series", life="append",
            tags=[key.split(":")[0]],
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
    info: dict[str, Any] = {"mounted": _STATE.get("figure") is not None}
    try:
        from . import plotkit_vendor

        vendor = plotkit_vendor.vendor_path()
        info["vendor"] = str(vendor)
        info["vendor_exists"] = (vendor / "plotkit" / "__init__.py").is_file()
    except Exception as exc:
        info["vendor"] = None
        info["vendor_exists"] = False
        info["vendor_error"] = str(exc)
    try:
        spec = importlib.util.find_spec("plotkit")
        info["plotkit_module"] = getattr(spec, "origin", None) if spec else None
    except Exception:
        info["plotkit_module"] = None
    info["candidates"] = [str(p) for p in _plotkit_src_candidates()]
    info["last_error"] = _LAST_ERROR
    info["active"] = _ACTIVE.is_set()
    return info


_HOST_SHIM = """<script>
/* netlab 宿主 shim：只给同源 /plotkit/api/ 请求补桌面 token。
   token 由宿主放在 URL 片段里传入，读取后立即从地址栏抹掉；页面 HTML、查询串、
   localStorage 与 cookie 都不出现 token。 */
(function () {
  "use strict";
  var TOKEN = "";
  try {
    var hash = window.location.hash || "";
    var match = /(?:^#|&)netlabToken=([^&]*)/.exec(hash);
    if (match) TOKEN = decodeURIComponent(match[1]);
    if (hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  } catch (error) { TOKEN = ""; }
  if (!TOKEN) return;
  var API = "/plotkit/api";
  function isApi(url) {
    try {
      var parsed = new URL(url, window.location.href);
      return parsed.origin === window.location.origin &&
        (parsed.pathname === API || parsed.pathname.indexOf(API + "/") === 0);
    } catch (error) { return false; }
  }
  var rawFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var url = typeof input === "string" ? input : (input && input.url) || String(input);
      if (isApi(url)) {
        var headers = new Headers(
          (init && init.headers) || (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined)
        );
        headers.set("X-Netlab-Token", TOKEN);
        init = Object.assign({}, init || {}, { headers: headers });
      }
    } catch (error) { /* 保底按原样请求，服务端会给出 403 */ }
    return rawFetch(input, init);
  };
  var rawOpen = window.open.bind(window);
  window.open = function (url, name, features) {
    try {
      var target = new URL(url, window.location.href);
      if (target.origin === window.location.origin && target.pathname === API + "/png") {
        var popup = rawOpen("about:blank", name, features);
        rawFetch(target.href, { headers: { "X-Netlab-Token": TOKEN } })
          .then(function (response) {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.blob();
          })
          .then(function (blob) {
            var objectUrl = URL.createObjectURL(blob);
            if (popup) popup.location = objectUrl;
            window.setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 60000);
          })
          .catch(function (error) {
            if (popup) popup.close();
            window.alert("PNG 导出失败：" + (error && error.message ? error.message : error));
          });
        return popup;
      }
    } catch (error) { /* 非 API 链接照常打开 */ }
    return rawOpen(url, name, features);
  };
})();
</script>"""


def _host_index_html() -> str:
    """读取实际导入的 PlotKit 首页，并在第一个脚本前插入宿主鉴权 shim。"""
    from plotkit.server.assets import STATIC_DIR

    html = (Path(STATIC_DIR) / "index.html").read_text(encoding="utf-8")
    position = html.find("<script")
    if position < 0:
        return html
    return html[:position] + _HOST_SHIM + "\n  " + html[position:]


def remount(app: Any | None = None, service: Any | None = None) -> bool:
    """运行时再试一次挂载（用户点了「重试」或首次挂载时依赖还没就绪）。"""
    if _STATE.get("figure") is not None:
        return True
    if app is None:
        try:
            import netlab.server as _srv

            app = _srv.app
        except Exception:
            return False
    return mount(app, service)


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
            # 子应用首页由宿主先接管：在 PlotKit 自己的脚本之前注入 shim，让它把
            # 同源 /plotkit/api/ 请求自动带上桌面 token。首页与静态资源本身仍公开。
            try:
                index_html = _host_index_html()
            except Exception:
                index_html = ""
                LOGGER.debug("PlotKit 首页注入 shim 失败，回退到子应用自带首页", exc_info=True)
            if index_html:
                from fastapi.responses import HTMLResponse

                def _plotkit_host_index() -> HTMLResponse:
                    return HTMLResponse(
                        index_html,
                        headers={
                            "Cache-Control": "no-store",
                            "Referrer-Policy": "no-referrer",
                        },
                    )

                for _path in (MOUNT_PATH, MOUNT_PATH + "/"):
                    try:
                        app.add_api_route(
                            _path, _plotkit_host_index, methods=["GET"], include_in_schema=False
                        )
                    except Exception:
                        LOGGER.debug("注册 PlotKit 宿主首页失败：%s", _path, exc_info=True)
            app.mount(MOUNT_PATH, sub_app)
            stop_event = threading.Event()
            thread = threading.Thread(
                target=_sync_loop,
                args=(target, figure, stop_event),
                name="netlab-plotkit-sync",
                daemon=True,
            )
            thread.start()
            _STATE.update({
                "figure": figure, "app": sub_app, "thread": thread,
                "stop": stop_event, "service": target,
            })
            LOGGER.info("PlotKit 已挂载到 %s", MOUNT_PATH)
            return True
        except Exception:
            LOGGER.warning("PlotKit 挂载失败，已跳过", exc_info=True)
            return False


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
