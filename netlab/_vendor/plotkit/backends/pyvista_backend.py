"""PyVista / VTK 三维后端（D38，可选依赖）。

定位（见 docs/THREE_D_BACKENDS.md §1）：**只画三维工程图**——网格、体场、矢量场、点云。
二维图层一律交给 matplotlib（它仍是默认后端，D33 不变）。

三条硬边界在这里的落点（同文件 §5）：

1. **不复刻 `Axes3D` 语义**：没有 spines、没有论文级刻度排版，只有坐标轴 + 标题；
   想要论文图请继续用 matplotlib。
2. **数组不悄悄升精度**：所有数组走 `mpl_backend.as_float_keep`，float32 就是 float32。
3. **`stream3d` 默认仍用 plotkit 自己的 RK2**：轨迹直接复用
   `mpl_backend.stream3d_paths()`，与 matplotlib 逐点一致；不用 VTK stream tracer。

约定：本模块只在被 import 时才把 `pyvista` 的 builder 挂到注册表上；没装 pyvista 的
机器上 `dispatch.choose()` 会判定"不可用"，不会在 import 阶段炸掉整个包。
"""

from __future__ import annotations

import atexit
import hashlib
import io
import itertools
import json
import os
import queue
import weakref
import threading
from dataclasses import dataclass, field
from typing import Any, Mapping

import numpy as np

from . import registry
from .dispatch import BACKEND_PYVISTA, BackendUnsupported, RenderResult

# 复用离屏渲染窗口：新建一个 Plotter 要重建 OpenGL 上下文，实测每帧固定 ~450–600ms；
# 复用同一个窗口只要 12–30ms（本机 Intel Arc / OpenGL 4.5，2026-10-31 实测）。
_REUSE = os.environ.get("PLOTKIT_PYVISTA_REUSE", "1") not in ("0", "false", "False")
_PLOTTERS: dict[tuple[int, int], Any] = {}
_PLOTTER_LOCK = threading.RLock()
_MAX_PLOTTERS = 2

# VTK 的离屏上下文是线程亲和的：所有渲染都排到同一条专用线程上跑。
_WORKER: threading.Thread | None = None
_WORKER_LOCK = threading.Lock()
_JOBS: "queue.Queue" = queue.Queue()


def _worker_thread_handle():
    return _WORKER


def _worker_loop() -> None:
    while True:
        job = _JOBS.get()
        if job is None:  # pragma: no cover - 关闭信号
            return
        fn, box, event = job
        try:
            box["result"] = fn()
        except BaseException as exc:  # noqa: BLE001 - 原样抛回调用线程
            box["error"] = exc
        finally:
            event.set()


def _run_on_worker(fn):
    global _WORKER
    with _WORKER_LOCK:
        if _WORKER is None or not _WORKER.is_alive():
            _WORKER = threading.Thread(target=_worker_loop, name="plotkit-vtk", daemon=True)
            _WORKER.start()
    box: dict[str, Any] = {}
    event = threading.Event()
    _JOBS.put((fn, box, event))
    event.wait()
    if "error" in box:
        raise box["error"]
    return box["result"]


def close_plotters() -> None:
    """释放所有缓存的离屏窗口（测试和退出时用）。

    必须回到 VTK 线程上关：在主线程 close() 一个由工作线程创建的上下文会直接段错误
    （2026-10-31 实测 exit code 139）。
    """
    if _WORKER is not None and threading.current_thread() is not _WORKER:
        try:
            _run_on_worker(_close_all)
            return
        except Exception:  # pragma: no cover
            pass
    _close_all()


def _close_all() -> None:
    with _PLOTTER_LOCK:
        for plotter in _PLOTTERS.values():
            try:
                plotter.close()
            except Exception:  # pragma: no cover
                pass
        _PLOTTERS.clear()


def _atexit_close() -> None:  # pragma: no cover - 进程退出路径
    """退出前在 VTK 线程上关窗，否则解释器回收窗口时会刷 wglMakeCurrent 报错。"""
    try:
        close_plotters()
    except Exception:
        pass


atexit.register(_atexit_close)


_STORE_TOKENS: "weakref.WeakKeyDictionary" = weakref.WeakKeyDictionary()
_STORE_COUNTER = itertools.count(1)


def _store_token(store) -> int:
    """给每个 DataStore 一个稳定且互不相同的编号（GC 后自动回收，不复用 id）。"""
    try:
        token = _STORE_TOKENS.get(store)
        if token is None:
            token = next(_STORE_COUNTER)
            _STORE_TOKENS[store] = token
        return token
    except TypeError:  # pragma: no cover - 不可弱引用的实现
        return id(store)


def _scene_key(spec: Mapping[str, Any], store) -> str:
    """场景指纹：**忽略相机参数**（view），数据一变就换。

    这样"只转视角"的请求能命中已建好的场景，跳过 clear()+add_mesh() 的整场景重建
    （实测 100 万点：重建 82ms/帧 → 只动相机 6.5ms/帧）。
    """
    slim = {
        "figure": spec.get("figure") or {},
        "layers": [{k: v for k, v in layer.items() if k != "view"}
                   for layer in (spec.get("layers") or [])],
    }
    try:
        blob = json.dumps(slim, sort_keys=True, default=str)
    except Exception:  # pragma: no cover
        blob = str(id(spec))
    versions = []
    try:
        versions = [(n, store.meta(n)["version"]) for n in store.names()]
    except Exception:  # pragma: no cover
        pass
    # 必须带上 store 身份：不同 DataStore 的 version 都从 0 开始，光看 (名字, 版本)
    # 会把"两个内容不同但版本号相同"的图判成同一场景，于是直接吐出上一帧
    payload = blob + repr(versions) + repr(_store_token(store))
    return hashlib.blake2b(payload.encode("utf-8"), digest_size=8).hexdigest()


def _acquire_plotter(pv, width: int, height: int, scene_key: str = ""):
    """拿到一个尺寸匹配的离屏 Plotter；返回 (plotter, 是否命中已建好的场景)。"""
    key = (int(width), int(height), scene_key)
    if not _REUSE:
        return pv.Plotter(off_screen=True, window_size=(int(width), int(height))), False
    with _PLOTTER_LOCK:
        plotter = _PLOTTERS.get(key)
        if plotter is not None:
            return plotter, True
        while len(_PLOTTERS) >= _MAX_PLOTTERS:
            old_key, old = next(iter(_PLOTTERS.items()))
            _PLOTTERS.pop(old_key, None)
            try:
                old.close()
            except Exception:  # pragma: no cover
                pass
        plotter = pv.Plotter(off_screen=True, window_size=(int(width), int(height)))
        _PLOTTERS[key] = plotter
        return plotter, False

SUPPORTED_KINDS = (
    "volume",
    "surface",
    "trisurf",
    "scatter3d",
    "line3d",
    "quiver3d",
    "bar3d",
    "hist3d",
    "voxels",
    "stream3d",
    "stem3d",
    "text3d",
    "particles",
    "segments",
)


def _pv():
    try:
        import pyvista as pv
    except Exception as exc:  # pragma: no cover - 依赖缺失时才走
        from .dispatch import BackendUnavailable

        raise BackendUnavailable(f"pyvista 不可用：{exc}") from exc
    return pv


def _style(layer: Mapping[str, Any]) -> Mapping[str, Any]:
    return layer.get("style") or {}


def _data(layer: Mapping[str, Any]) -> Mapping[str, Any]:
    return layer.get("data") or {}


def _values(layer: Mapping[str, Any], store, key: str):
    from .mpl_backend import as_float_keep

    data = _data(layer)
    if key not in data:
        raise BackendUnsupported(f"{layer.get('kind')}: 缺少数据字段 {key!r}")
    return as_float_keep(store.values(data[key]))


def _xyz(layer, store, keys=("x", "y", "z")):
    return tuple(np.ravel(_values(layer, store, k)) for k in keys)


@dataclass
class _Item:
    """一条「要加到场景里的东西」，与 matplotlib 的 artist 对应。"""

    mesh: Any
    scalars: Any = None
    color: str | None = None
    cmap: str = "viridis"
    opacity: float = 1.0
    mode: str = "surface"          # surface | wireframe | points | lines | labels
    point_size: float = 8.0
    line_width: float = 2.0
    labels: Any = None
    kwargs: dict[str, Any] = field(default_factory=dict)


# --------------------------------------------------------------------------- #
# 各 kind 的 builder：`(layer, store) -> list[_Item]`
# --------------------------------------------------------------------------- #


def build_surface(layer, store) -> list[_Item]:
    pv = _pv()
    from .mpl_backend import _surface_grid

    X, Y, Z = _surface_grid(layer, store)
    ny, nx = Z.shape
    grid = pv.StructuredGrid()
    grid.dimensions = (int(nx), int(ny), 1)
    grid.points = np.column_stack([np.ravel(X), np.ravel(Y), np.ravel(Z)])
    style = _style(layer)
    # 默认用几何高度着色；给了 `scalar` 就用那份场（切片平面要按温度着色，几何 z 是平面坐标）
    scalar_key = _data(layer).get("scalar")
    if scalar_key:
        field = np.ravel(_values(layer, store, "scalar"))
        if field.size != nx * ny:
            raise BackendUnsupported(
                f"surface: scalar {scalar_key!r} 有 {field.size} 个点，几何是 {nx * ny}")
        grid["value"] = field
    else:
        grid["value"] = np.ravel(Z)
    return [_Item(mesh=grid, scalars="value", cmap=str(style.get("cmap") or "viridis"),
                  opacity=float(style.get("opacity", 1.0)),
                  mode="wireframe" if style.get("wireframe") else "surface",
                  kwargs={"clim": style["clim"]} if style.get("clim") else {})]


def build_trisurf(layer, store) -> list[_Item]:
    pv = _pv()
    import matplotlib.tri as mtri

    x, y, z = _xyz(layer, store)
    tri = mtri.Triangulation(x, y)
    faces = np.column_stack([np.full(len(tri.triangles), 3), tri.triangles]).ravel()
    poly = pv.PolyData(np.column_stack([x, y, z]), faces)
    poly["value"] = z
    style = _style(layer)
    return [_Item(mesh=poly, scalars="value", cmap=str(style.get("cmap") or "viridis"),
                  opacity=float(style.get("opacity", 1.0)))]


def build_segments(layer, store) -> list[_Item]:
    """多段折线 → PolyData lines（每两行点构成一段）。"""
    import pyvista as pv

    data = layer.get("data") or {}
    x = _values(layer, store, "x")
    y = _values(layer, store, "y")
    z = _values(layer, store, "z")
    pts = np.column_stack([np.ravel(x), np.ravel(y), np.ravel(z)]).astype(float)
    n = (pts.shape[0] // 2) * 2
    if n < 2:
        return []
    pts = pts[:n]
    nseg = n // 2
    lines = np.empty((nseg, 3), dtype=np.int64)
    lines[:, 0] = 2
    lines[:, 1] = np.arange(0, n, 2)
    lines[:, 2] = np.arange(1, n, 2)
    poly = pv.PolyData(pts, lines=lines.ravel())
    style = layer.get("style") or {}
    color = style.get("color")
    rgb = None
    if isinstance(color, str) and color.startswith("#") and len(color) >= 7:
        rgb = tuple(int(color[i:i + 2], 16) / 255.0 for i in (1, 3, 5))
    elif color:
        rgb = tuple(float(c) for c in color)
    return [_Item(mesh=poly, color=rgb,
                  line_width=float(style.get("width", 1.2) or 1.2), mode="lines")]


def build_scatter3d(layer, store) -> list[_Item]:
    pv = _pv()
    x, y, z = _xyz(layer, store)
    poly = pv.PolyData(np.column_stack([x, y, z]))
    poly["value"] = _values(layer, store, "scalar") if (layer.get("data") or {}).get("scalar") else z
    style = _style(layer)
    marker = style.get("marker") or {}
    return [_Item(mesh=poly, scalars=None if style.get("color") else "value",
                  color=str(style["color"]) if style.get("color") else None,
                  cmap=str(style.get("cmap") or "viridis"),
                  opacity=float(style.get("opacity", 1.0)), mode="points",
                  point_size=float(marker.get("size", 6) or 6) * 1.6)]


def build_line3d(layer, store) -> list[_Item]:
    pv = _pv()
    x, y, z = _xyz(layer, store)
    poly = pv.lines_from_points(np.column_stack([x, y, z]))
    style = _style(layer)
    return [_Item(mesh=poly, color=str(style.get("color") or "#2f6fd0"),
                  mode="lines", line_width=float(style.get("width", 1.8) or 1.8))]


def build_volume(layer, store) -> list[_Item]:
    """三维标量场体渲染：x/y/z 一维坐标 + values 形状 (nz, ny, nx)（x 变化最快）。"""
    pv = _pv()
    data = _data(layer)
    style = _style(layer)
    xs = np.ravel(_values(layer, store, "x"))
    ys = np.ravel(_values(layer, store, "y"))
    zs = np.ravel(_values(layer, store, "z"))
    values = np.asarray(_values(layer, store, "values"), dtype=np.float64)
    if values.shape != (zs.size, ys.size, xs.size):
        raise BackendUnsupported(
            f"volume: values 形状应为 (nz, ny, nx) = {(zs.size, ys.size, xs.size)}，"
            f"收到 {values.shape}")
    grid = pv.ImageData(dimensions=(xs.size, ys.size, zs.size))
    grid.origin = (float(xs[0]), float(ys[0]), float(zs[0]))
    grid.spacing = (
        float((xs[-1] - xs[0]) / max(xs.size - 1, 1)),
        float((ys[-1] - ys[0]) / max(ys.size - 1, 1)),
        float((zs[-1] - zs[0]) / max(zs.size - 1, 1)),
    )
    grid.point_data["values"] = values.ravel(order="C")
    opacity = style.get("opacity_ramp") or style.get("opacity")
    if isinstance(opacity, (list, tuple)):
        opacity = [float(v) for v in opacity]
    elif opacity is None:
        opacity = [0.0, 0.05, 0.18, 0.45, 0.85]
    else:
        opacity = float(opacity)
    return [_Item(mesh=grid, scalars="values", cmap=str(style.get("cmap") or "magma"),
                  opacity=1.0, mode="volume",
                  kwargs={"opacity": opacity, "shade": bool(style.get("shade", True)),
                          "blending": "composite"})]


def build_quiver3d(layer, store) -> list[_Item]:
    pv = _pv()
    x, y, z, u, v, w = _xyz(layer, store, ("x", "y", "z", "u", "v", "w"))
    vectors = np.column_stack([u, v, w])
    if bool(_style(layer).get("normalize")):
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        vectors = np.divide(vectors, np.where(norms > 1e-12, norms, 1.0))
    poly = pv.PolyData(np.column_stack([x, y, z]))
    poly["vectors"] = vectors
    scale = float(_style(layer).get("length", 0.6) or 0.6)
    glyph = poly.glyph(orient="vectors", scale=False, factor=scale)
    style = _style(layer)
    return [_Item(mesh=glyph, color=str(style.get("color") or "#c2410c"), mode="surface")]


def _box_batch(pv, x, y, z, dx, dy, dz):
    """把一批柱/体素拼成一个 PolyData（逐柱 add_mesh 会慢到不可用）。"""
    parts = []
    for xi, yi, zi, dxi, dyi, dzi in zip(x, y, z, dx, dy, dz):
        parts.append(pv.Box(bounds=(float(xi), float(xi) + float(dxi),
                                    float(yi), float(yi) + float(dyi),
                                    float(zi), float(zi) + float(dzi))))
    if not parts:
        return None
    return parts[0].merge(parts[1:]) if len(parts) > 1 else parts[0]


def build_bar3d(layer, store) -> list[_Item]:
    pv = _pv()
    style = _style(layer)
    x, y, z = _xyz(layer, store)

    def width(values):
        uniq = np.unique(values)
        return float(np.median(np.diff(uniq))) * 0.8 if uniq.size > 1 else 0.8

    dx = np.full(x.shape, width(x))
    dy = np.full(y.shape, width(y))
    dz = z.copy()
    base = np.zeros_like(z)
    mesh = _box_batch(pv, x, y, base, dx, dy, dz)
    if mesh is None:
        raise BackendUnsupported("bar3d 没有可画的数据")
    return [_Item(mesh=mesh, color=str(style.get("color") or "#3b82f6"),
                  opacity=float(style.get("opacity", 1.0)))]


def build_hist3d(layer, store) -> list[_Item]:
    pv = _pv()
    style = _style(layer)
    x = np.ravel(_values(layer, store, "x"))
    y = np.ravel(_values(layer, store, "y"))
    bins = int(style.get("bins") or 8)
    counts, xe, ye = np.histogram2d(x, y, bins=bins)
    X, Y = np.meshgrid(xe[:-1], ye[:-1])
    dx = np.full(counts.size, float(np.diff(xe).mean()) * 0.9)
    dy = np.full(counts.size, float(np.diff(ye).mean()) * 0.9)
    mesh = _box_batch(pv, X.ravel(), Y.ravel(), np.zeros(counts.size),
                      dx, dy, counts.ravel())
    if mesh is None:
        raise BackendUnsupported("hist3d 没有可画的数据")
    return [_Item(mesh=mesh, color=str(style.get("color") or "#6366f1"),
                  opacity=float(style.get("opacity", 1.0)))]


def build_voxels(layer, store) -> list[_Item]:
    pv = _pv()
    style = _style(layer)
    grid = _values(layer, store, "z")
    if grid.ndim != 3:
        raise ValueError(f"voxels 需要三维数组，收到 {grid.shape}")
    nz, ny, nx = grid.shape
    image = pv.ImageData(dimensions=(nx + 1, ny + 1, nz + 1))
    # VTK 单元序是 x 最快 → Fortran ravel
    image.cell_data["value"] = np.ravel(grid, order="F")
    filled = image.threshold(0.0, scalars="value") if float(np.min(grid)) >= 0 else image
    return [_Item(mesh=filled, scalars="value", cmap=str(style.get("cmap") or "viridis"),
                  opacity=float(style.get("opacity", 0.9)))]


def build_stream3d(layer, store) -> list[_Item]:
    pv = _pv()
    from .mpl_backend import stream3d_paths

    paths, style = stream3d_paths(layer, store)
    if not paths:
        raise BackendUnsupported("stream3d 没有生成任何轨迹")
    parts = [pv.lines_from_points(p) for p in paths]
    mesh = parts[0].merge(parts[1:]) if len(parts) > 1 else parts[0]
    return [_Item(mesh=mesh, color=str(style.get("color") or "#0f766e"), mode="lines",
                  line_width=float(style.get("width", 1.0) or 1.0))]


def build_stem3d(layer, store) -> list[_Item]:
    pv = _pv()
    style = _style(layer)
    x, y, z = _xyz(layer, store)
    points = []
    lines = []
    for i, (xi, yi, zi) in enumerate(zip(x, y, z)):
        points.extend([[xi, yi, 0.0], [xi, yi, zi]])
        lines.append([2, 2 * i, 2 * i + 1])
    poly = pv.PolyData(np.array(points, dtype=float), lines=np.array(lines, dtype=np.int64).ravel())
    color = str(style.get("color") or "#2563eb")
    tips = pv.PolyData(np.column_stack([x, y, z]))
    return [
        _Item(mesh=poly, color=color, mode="lines",
              line_width=float(style.get("width", 1.2) or 1.2)),
        _Item(mesh=tips, color=color, mode="points", point_size=7.0),
    ]


def build_text3d(layer, store) -> list[_Item]:
    pv = _pv()
    x, y, z = _xyz(layer, store)
    labels = _data(layer).get("labels") or _data(layer).get("text")
    if isinstance(labels, str):
        labels = [labels]
    if labels is None:
        labels = [f"{v:.3g}" for v in z]
    poly = pv.PolyData(np.column_stack([x, y, z]))
    return [_Item(mesh=poly, mode="labels", labels=list(labels),
                  color=str(_style(layer).get("color") or "#111827"))]


def _build_particles(layer, store) -> list[_Item]:
    """浏览器里粒子是点精灵；服务端出图复用 scatter3d（点云 + 标量着色）。"""
    data = dict(layer.get("data") or {})
    if data.get("scalar") is None and data.get("c"):
        data["scalar"] = data["c"]
    clone = dict(layer)
    clone["data"] = data
    clone["kind"] = "scatter3d"
    return build_scatter3d(clone, store)


_BUILDERS = {
    "surface": build_surface,
    "trisurf": build_trisurf,
    "scatter3d": build_scatter3d,
    "line3d": build_line3d,
    "quiver3d": build_quiver3d,
    "bar3d": build_bar3d,
    "hist3d": build_hist3d,
    "voxels": build_voxels,
    "volume": build_volume,
    "stream3d": build_stream3d,
    "stem3d": build_stem3d,
    "text3d": build_text3d,
    "particles": _build_particles,
    "segments": build_segments,
}


def _register() -> None:
    """把 pyvista 的能力挂到全局注册表（幂等）。"""
    for kind, builder in _BUILDERS.items():
        try:
            spec = registry.resolve(kind)
        except KeyError:
            continue
        if BACKEND_PYVISTA in spec.builders:
            continue
        registry.attach_builder(kind, BACKEND_PYVISTA, builder)


_register()


# --------------------------------------------------------------------------- #
# 渲染
# --------------------------------------------------------------------------- #


_PNG_LEVEL = int(os.environ.get("PLOTKIT_PYVISTA_PNG_LEVEL", "1") or 1)


def _encode_png(arr) -> bytes:
    from PIL import Image

    if arr is None:
        raise BackendUnsupported("pyvista 没有返回图像")
    image = Image.fromarray(np.asarray(arr))
    buffer = io.BytesIO()
    # 默认 compress_level=1：点云画面接近噪声，zlib 在 6 级要 94ms、1 级只要 30ms，
    # 体积只大 3–4%（实测 300k 点、800×600：820KB → 850KB）。
    image.save(buffer, format="PNG", compress_level=_PNG_LEVEL)
    return buffer.getvalue()


def _view_bounds(layers, xlim=None, ylim=None):
    """把图层 view 里的 xlim/ylim/zlim 合成一个 VTK bounds（没有就返回 None）。"""
    xs, ys, zs = [], [], []
    for layer in layers:
        view = layer.get("view") or {}
        for key, bucket in (("xlim", xs), ("ylim", ys), ("zlim", zs)):
            lim = view.get(key)
            if lim and len(lim) == 2:
                bucket.append((float(lim[0]), float(lim[1])))
    if xlim:
        xs.append((float(xlim[0]), float(xlim[1])))
    if ylim:
        ys.append((float(ylim[0]), float(ylim[1])))
    if not (xs and ys):
        return None
    x0, x1 = min(a for a, _ in xs), max(b for _, b in xs)
    y0, y1 = min(a for a, _ in ys), max(b for _, b in ys)
    if zs:
        z0, z1 = min(a for a, _ in zs), max(b for _, b in zs)
    else:
        z0, z1 = -0.5, 0.5
    return (x0, x1, y0, y1, z0, z1)


def _apply_view(plotter, figure: Mapping[str, Any], bounds=None, layer_view=None) -> None:
    """按 elev/azim 摆相机。

    不能依赖 `camera_position = "iso"`：某些 VTK 版本上它会静默失败，相机留在默认的
    「沿 -Z 俯视」，三维图会被看成一张压扁的俯视图（2026-10-31 实测踩到）。
    这里直接按球坐标算相机位置，结果是确定的。
    """
    import math

    # 视角既可以在 figure 级给，也可以写在图层 view 里（fig.set_view(0, elev=…) 走的是后者）
    layer_view = layer_view or {}
    elev = float(figure.get("elev", layer_view.get("elev", 26.0)) or 26.0)
    azim = float(figure.get("azim", layer_view.get("azim", -58.0)) or -58.0)
    zoom = float(figure.get("zoom", layer_view.get("zoom", 1.0)) or 1.0)
    e = math.radians(elev)
    a = math.radians(azim)
    direction = np.array([math.cos(e) * math.cos(a),
                          math.cos(e) * math.sin(a),
                          math.sin(e)], dtype=float)
    try:
        box = tuple(bounds) if bounds else tuple(plotter.bounds)
        center = np.array([(box[0] + box[1]) / 2.0, (box[2] + box[3]) / 2.0,
                           (box[4] + box[5]) / 2.0], dtype=float)
        radius = max(box[1] - box[0], box[3] - box[2], box[5] - box[4], 1e-6) * 0.5
        # 球面正好装进视锥的距离 = r / sin(fov/2)；再留 5% 余量，避免边缘被裁
        fov = float(getattr(plotter.camera, "view_angle", 30.0) or 30.0)
        distance = radius / max(math.sin(math.radians(fov / 2.0)), 1e-6) * 1.05 / max(zoom, 1e-3)
        # 直接设相机，不走 view_vector()+reset_camera()：
        # 后者每帧要重算包围盒并触发一次完整 render，实测 300k 点 188ms/帧 → 6.6ms/帧
        plotter.camera_position = [tuple(center + distance * direction),
                                   tuple(center), (0.0, 0.0, 1.0)]
        plotter.camera.clipping_range = (distance * 0.01, distance * 10.0)
    except Exception:  # pragma: no cover
        pass


def render_result(
    spec: Mapping[str, Any],
    store,
    *,
    width: int = 900,
    height: int = 520,
    dpi: int = 100,
    fmt: str = "png",
    xlim: tuple[float, float] | None = None,
    ylim: tuple[float, float] | None = None,
    with_limits: bool = False,
) -> RenderResult:
    """对外入口：把渲染丢到**专用 VTK 线程**上执行。

    为什么必须单线程：离屏 OpenGL 上下文是线程亲和的。FastAPI 的同步端点跑在线程池里，
    如果第一次渲染发生在 A 线程、下一次在 B 线程，VTK 会刷
    `wglMakeCurrent failed ... (code 6)` 并渲染出黑图（2026-10-31 实测）。
    """
    if threading.current_thread() is _worker_thread_handle():
        return _render_sync(spec, store, width=width, height=height, dpi=dpi, fmt=fmt,
                            xlim=xlim, ylim=ylim, with_limits=with_limits)
    return _run_on_worker(
        lambda: _render_sync(spec, store, width=width, height=height, dpi=dpi, fmt=fmt,
                             xlim=xlim, ylim=ylim, with_limits=with_limits)
    )


def _render_sync(
    spec: Mapping[str, Any],
    store,
    *,
    width: int = 900,
    height: int = 520,
    dpi: int = 100,
    fmt: str = "png",
    xlim: tuple[float, float] | None = None,
    ylim: tuple[float, float] | None = None,
    with_limits: bool = False,
) -> RenderResult:
    if (fmt or "png").lower() != "png":
        # VTK 9.x 的 OpenGL2 后端会把 GL2PS 导出退化成「整幅位图塞进 SVG」，
        # 所以这里不给假矢量；要矢量请让 dispatch 回退到 matplotlib（见 dispatch.render_result）
        raise BackendUnsupported("pyvista 只出 PNG（真矢量请用 mpl 后端）")
    pv = _pv()
    pv.OFF_SCREEN = True

    width = max(80, min(4000, int(width)))
    height = max(60, min(4000, int(height)))
    figure = spec.get("figure") or {}

    layers = spec.get("layers") or []
    if not layers:
        raise BackendUnsupported("没有可画的图层")
    scene_key = _scene_key(spec, store)
    plotter, cached = _acquire_plotter(pv, width, height, scene_key)
    plotter.background_color = str(figure.get("facecolor") or "white")
    global _SUPPRESS_SCALAR_BAR
    _SUPPRESS_SCALAR_BAR = False
    if cached and getattr(plotter, "_plotkit_decorated", True) is False:
        # 缓存里是「混合出图用的无装饰场景」，这里要带刻度/色标，必须重建
        plotter.clear()
        cached = False
    plotter._plotkit_decorated = True
    if not cached:
        # 场景重建：只在数据/样式/尺寸变了时付一次这个钱
        for layer in layers:
            kind = str(layer.get("kind") or "")
            real = registry.ALIASES.get(kind, kind)
            builder = _BUILDERS.get(real)
            if builder is None:
                raise BackendUnsupported(f"pyvista 不支持图层类型 {kind!r}")
            for item in builder(layer, store):
                _add_item(plotter, item)

        title = figure.get("title")
        if title:
            # font_size 在 VTK 里是"字体相对大小"，11 会渲染成 ~45px 并被视口裁掉；
            # 用 5 + 像素定位，标题才完整落在左上角
            plotter.add_text(str(title), position=(14, int(height) - 16), font_size=5,
                             color="#111827")
        plotter.show_bounds(
            grid=False, location="outer", show_xaxis=True, show_yaxis=True, show_zaxis=True,
            xtitle=str(figure.get("xlabel") or "x"),
            ytitle=str(figure.get("ylabel") or "y"),
            ztitle=str(figure.get("zlabel") or "z"),
            color="#374151", font_size=10,
            # 默认刻度太密：透视图下角上的数字会叠在一起（"3.0 3.0"），z 轴又短，4 个标签就撞车
            n_xlabels=4, n_ylabels=4, n_zlabels=2, fmt="%.2g",
        )
    # 相机每次都重设（转视角时不重建场景，只走这一步）
    _apply_view(plotter, figure, _view_bounds(layers, xlim, ylim),
                layer_view=(layers[0].get("view") or {}))
    image = plotter.screenshot(return_img=True)
    payload = _encode_png(image)
    out_fmt = "png"
    bounds = plotter.bounds

    limits = None
    if with_limits:
        limits = {"xlim": [float(bounds[0]), float(bounds[1])],
                  "ylim": [float(bounds[2]), float(bounds[3])],
                  "zlim": [float(bounds[4]), float(bounds[5])]}
    return RenderResult(payload=payload, fmt=out_fmt, width=width, height=height,
                        dpi=dpi, backend=BACKEND_PYVISTA, limits=limits,
                        meta={"kinds": [str((l.get("kind") or "")) for l in layers],
                              "scene_cached": bool(cached)})


def _project(plotter, points):
    """把世界坐标投到**像素坐标**（左上原点，和截图数组一致）。"""
    ren = plotter.renderer
    height = float(plotter.window_size[1])
    out = []
    for px, py, pz in points:
        ren.SetWorldPoint(float(px), float(py), float(pz), 1.0)
        ren.WorldToDisplay()
        dx, dy, _dz = ren.GetDisplayPoint()
        out.append((float(dx), height - float(dy)))
    return out


def render_scene(
    spec: Mapping[str, Any],
    store,
    *,
    width: int = 900,
    height: int = 520,
    dpi: int = 100,
    xlim: tuple[float, float] | None = None,
    ylim: tuple[float, float] | None = None,
    decorate: bool = False,
):
    """只画三维内容（默认不带标题/包围盒/刻度），并回传投影信息。

    混合出图用它：3D 部分是位图，坐标轴/刻度/标题交给 matplotlib 画成矢量。
    返回 `(image_rgba, info)`，`info` 里有 bounds、尺寸和 8 个包围盒角的像素坐标。
    """
    pv = _pv()
    pv.OFF_SCREEN = True
    width = max(80, min(4000, int(width)))
    height = max(60, min(4000, int(height)))
    figure = spec.get("figure") or {}
    layers = spec.get("layers") or []
    if not layers:
        raise BackendUnsupported("没有可画的图层")

    scene_key = _scene_key(spec, store)
    plotter, cached = _acquire_plotter(pv, width, height, scene_key)
    plotter.background_color = str(figure.get("facecolor") or "white")
    global _SUPPRESS_SCALAR_BAR
    _SUPPRESS_SCALAR_BAR = not decorate
    if cached and getattr(plotter, "_plotkit_decorated", None) != decorate:
        # 带刻度/色标与不带的场景是两种东西，混用会让位图里烙着一个多余的色标
        plotter.clear()
        cached = False
    plotter._plotkit_decorated = decorate
    if not cached:
        for layer in layers:
            kind = str(layer.get("kind") or "")
            real = registry.ALIASES.get(kind, kind)
            builder = _BUILDERS.get(real)
            if builder is None:
                raise BackendUnsupported(f"pyvista 不支持图层类型 {kind!r}")
            for item in builder(layer, store):
                _add_item(plotter, item)
        if decorate:
            title = figure.get("title")
            if title:
                plotter.add_text(str(title), position=(14, int(height) - 16), font_size=5,
                                 color="#111827")
            plotter.show_bounds(grid=False, location="outer", color="#374151", font_size=10,
                                n_xlabels=4, n_ylabels=4, n_zlabels=2, fmt="%.2g")

    _apply_view(plotter, figure, _view_bounds(layers, xlim, ylim),
                layer_view=(layers[0].get("view") or {}))
    image = plotter.screenshot(return_img=True)
    b = plotter.bounds
    corners = [(x, y, z) for x in (b[0], b[1]) for y in (b[2], b[3]) for z in (b[4], b[5])]
    info = {
        "bounds": tuple(float(v) for v in b),
        "size": (int(width), int(height)),
        "corners_px": _project(plotter, corners),
        "corners": corners,
    }
    return image, info


def render_scene_threaded(spec, store, **kwargs):
    """在 VTK 工作线程上跑 `render_scene`（OpenGL 上下文绑线程，不能在主线程碰）。"""
    import threading as _threading

    if _WORKER is not None and _threading.current_thread() is _WORKER:
        return render_scene(spec, store, **kwargs)
    return _run_on_worker(lambda: render_scene(spec, store, **kwargs))


_SUPPRESS_SCALAR_BAR = False


def supports(layer: Mapping[str, Any]) -> bool:
    """这个图层能不能交给 pyvista 画（供三维动画等调用方筛选）。"""
    kind = str((layer or {}).get("kind") or "")
    return registry.ALIASES.get(kind, kind) in SUPPORTED_KINDS


def _add_item(plotter, item: _Item) -> None:
    kwargs: dict[str, Any] = {"opacity": float(item.opacity)}
    if item.mode == "points":
        kwargs.update({"style": "points", "point_size": float(item.point_size),
                       "render_points_as_spheres": True})
    elif item.mode == "lines":
        kwargs.update({"style": "surface", "line_width": float(item.line_width)})
    elif item.mode == "wireframe":
        kwargs.update({"style": "wireframe"})

    if item.mode == "labels":
        plotter.add_point_labels(item.mesh.points, item.labels, font_size=10,
                                 text_color=item.color or "#111827", shape_opacity=0.0)
        return

    if item.scalars:
        kwargs.update({
            "scalars": item.scalars, "cmap": item.cmap,
            "show_scalar_bar": not _SUPPRESS_SCALAR_BAR,
            "scalar_bar_args": {
                "title": "", "position_x": 0.86, "position_y": 0.12,
                "width": 0.06, "height": 0.62, "vertical": True,
                "label_font_size": 9, "fmt": "%.2f",
            },
        })
    else:
        kwargs["color"] = item.color or "#3b82f6"
        kwargs["show_scalar_bar"] = False
    if item.kwargs:
        extra = dict(item.kwargs)
        if "clim" in extra:
            extra["clim"] = tuple(float(v) for v in extra["clim"])
        kwargs.update(extra)
    if item.mode == "volume":
        # 体渲染：半透明"烟"而不是表面，配合 RGB 传递函数才像参考图那种发光涡管
        kwargs.pop("style", None)
        plotter.add_volume(item.mesh, **kwargs)
        return
    plotter.add_mesh(item.mesh, **kwargs)
