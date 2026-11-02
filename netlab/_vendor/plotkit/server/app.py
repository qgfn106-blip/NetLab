"""HTTP 服务：把一份 Figure 暴露成浏览器可用的页面 + JSON/binary 接口。

接口一览（docs/DESIGN_v0.md §6）：
  GET  /                     页面
  GET  /api/meta             版本 / 可用 kind / 主题
  GET  /api/spec             当前 spec
  PUT  /api/spec             全量替换 spec（D10：默认回写方式）
  GET  /api/datasets         命名数据集目录（前端下拉用）
  GET  /api/series           float32 二进制列（ArrayBuffer 通道）
  GET  /api/png              matplotlib 渲染的静态图
  GET  /api/layout           界面布局（面板宽/折叠/分组），属于"软件怎么摆"
  PUT  /api/layout           全量替换布局
"""

from __future__ import annotations

import hashlib
import json
import os
import struct
import tempfile
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any, Mapping

import numpy as np
from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from ..backends import registry as reg
from ..spec.validate import SpecError, validate_spec
from ..store.downsample import downsample_xy
from ..store.registry import DATA_LOCK
from .assets import STATIC_DIR

MAGIC = b"PK01"


def _binary_xyz(x: np.ndarray, y: np.ndarray, z: np.ndarray, meta: Mapping[str, Any]) -> bytes:
    """帧格式：magic(4) + meta_len(4) + npoints(4) + meta json + float32 交错 (x,y,z)。

    三维视图直接把这段 buffer 传给 WebGL 的 ARRAY_BUFFER，不做任何解析。
    """
    meta_bytes = json.dumps(dict(meta), ensure_ascii=False).encode("utf-8")
    rows = np.empty((x.size, 3), dtype="<f4")
    rows[:, 0] = x.astype(np.float32, copy=False)
    rows[:, 1] = y.astype(np.float32, copy=False)
    rows[:, 2] = z.astype(np.float32, copy=False)
    header = MAGIC + struct.pack("<II", len(meta_bytes), int(x.size))
    return header + meta_bytes + rows.tobytes(order="C")



def _binary_field(values: np.ndarray, meta: Mapping[str, Any]) -> bytes:
    """三维标量场帧：magic(4)+meta_len(4)+n(4)+meta+float32 原始数组（x 变化最快）。

    JS 侧直接 `texImage3D(gl.R32F, w=nx, h=ny, d=nz)`，不需要解析。
    """
    meta_bytes = json.dumps(dict(meta), ensure_ascii=False).encode("utf-8")
    array = np.ascontiguousarray(values, dtype="<f4")
    header = MAGIC + struct.pack("<II", len(meta_bytes), int(array.size))
    return header + meta_bytes + array.tobytes(order="C")


def _binary_points(points: np.ndarray, scalars: np.ndarray, meta: Mapping[str, Any]) -> bytes:
    """点云帧：magic+meta_len+n+meta + float32 xyz + float32 scalar。"""
    meta_bytes = json.dumps(dict(meta), ensure_ascii=False).encode("utf-8")
    xyz = np.ascontiguousarray(points, dtype="<f4")
    scl = np.ascontiguousarray(scalars, dtype="<f4")
    header = MAGIC + struct.pack("<II", len(meta_bytes), int(xyz.shape[0]))
    return header + meta_bytes + xyz.tobytes(order="C") + scl.tobytes(order="C")


def _binary_series(x: np.ndarray, y: np.ndarray, meta: Mapping[str, Any]) -> bytes:
    """帧格式：magic(4) + meta_len(4) + npoints(4) + meta json + float32 交错 (x,y)。"""
    meta_bytes = json.dumps(dict(meta), ensure_ascii=False).encode("utf-8")
    pairs = np.empty((x.size, 2), dtype="<f4")
    pairs[:, 0] = x.astype(np.float32, copy=False)
    pairs[:, 1] = y.astype(np.float32, copy=False)
    header = MAGIC + struct.pack("<II", len(meta_bytes), int(x.size))
    return header + meta_bytes + pairs.tobytes(order="C")


MAX_LAYOUT_BYTES = 64 * 1024

#: 渲染结果缓存（D35）：键 = spec 摘要 + 数据集版本 + 尺寸 + 视窗 + 格式
_RENDER_CACHE: "OrderedDict[tuple, tuple[bytes, str, object]]" = OrderedDict()
_RENDER_CACHE_MAX = 8
#: 渲染闸门：matplotlib 出图是纯 CPU + 持解释器锁的重活，并发进来只会互相拖慢
#: 并把后台仿真线程饿死。串行化后前端看到的是"稍慢但稳定"而不是"卡顿 + 积压"。
_RENDER_LOCK = DATA_LOCK


def _clamp(value: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, int(value)))


def _parse_limits(raw: str | None) -> tuple[float, float] | None:
    if not raw:
        return None
    parts = [p for p in str(raw).replace(" ", "").split(",") if p]
    if len(parts) != 2:
        raise HTTPException(400, f"视窗参数必须是 \"lo,hi\"，收到 {raw!r}")
    lo, hi = float(parts[0]), float(parts[1])
    if not (lo < hi):
        raise HTTPException(400, f"视窗下界必须小于上界，收到 {raw!r}")
    return lo, hi


def _cached(request: Request, key: tuple, build, media_type: str) -> Response:
    """统一的"渲染 → 缓存 → ETag/304 → 响应"流程。

    `build()` 返回 `(payload, extra_headers)`；缓存键由调用方给出（含 spec 摘要与参数）。
    """
    cached = _RENDER_CACHE.get(key)
    hit = cached is not None
    if cached is None:
        try:
            if hit is False:
                with _RENDER_LOCK:
                    cached = _RENDER_CACHE.get(key)  # 排队期间可能已被别人算好
                    if cached is not None:
                        hit = True
                        payload, tag, extra = cached
                        headers = {"ETag": tag, "Cache-Control": "no-store, max-age=0",
                                   "X-PlotKit-Render": "hit"}
                        headers.update(extra or {})
                        if request.headers.get("if-none-match") == tag:
                            return Response(status_code=304, headers=headers)
                        return Response(content=payload, media_type=media_type, headers=headers)
                    payload, extra = build()
        except (SpecError, ValueError) as exc:
            raise HTTPException(400, str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 - 渲染失败直接回给前端看
            raise HTTPException(500, f"渲染失败: {exc}") from exc
        tag = _etag(payload)
        _RENDER_CACHE[key] = (payload, tag, extra)
        while len(_RENDER_CACHE) > _RENDER_CACHE_MAX:
            _RENDER_CACHE.popitem(last=False)
    else:
        payload, tag, extra = cached
        _RENDER_CACHE.move_to_end(key)

    headers = {"ETag": tag, "Cache-Control": "no-store, max-age=0",
               "X-PlotKit-Render": "hit" if hit else "miss"}
    headers.update(extra or {})
    if request.headers.get("if-none-match") == tag:
        return Response(status_code=304, headers=headers)
    return Response(content=payload, media_type=media_type, headers=headers)


def _etag(payload: bytes) -> str:
    return '"' + hashlib.sha1(payload).hexdigest()[:16] + '"'



def _write_json_atomic(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(dict(payload), ensure_ascii=False, indent=2, sort_keys=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".layout-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def create_app(figure: Any, *, title: str | None = None, layout_path: str | Path | None = None,
               with_ns: bool = False) -> FastAPI:
    """`figure` 是 plotkit.api.native.Figure。"""
    app = FastAPI(title=title or "PlotKit", docs_url=None, redoc_url=None)
    if with_ns:                      # 同一个进程里同时提供二维图与 NS 三维涡旋接口
        from .ns_app import router as ns_router

        app.include_router(ns_router)
    # 图 JSON/spec 动辄几十 KB，压缩后 ~1/10；本地回环也受益于解析前的字节数
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    # 开发期绕开浏览器缓存：静态资源一律 no-store（否则改完 JS 刷新还是旧页面）
    @app.middleware("http")
    async def _no_store(request, call_next):
        response = await call_next(request)
        # 挂在子路径（如 /plotkit/）时 request.url.path 会带前缀，不能只判 startswith("/static")
        path = request.url.path
        if "/static/" in path or path.endswith("/static") or path.endswith("/"):
            response.headers["Cache-Control"] = "no-store, max-age=0"
        return response


    @app.get("/")
    def index() -> FileResponse:
        page = STATIC_DIR / "index.html"
        if not page.exists():
            raise HTTPException(500, "缺少 static/index.html")
        return FileResponse(page, media_type="text/html; charset=utf-8")

    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.get("/api/meta")
    def meta() -> dict[str, Any]:
        fig_cfg = figure.spec.get("figure", {})
        return {
            "app": "PlotKit",
            "spec_version": figure.spec.get("spec_version"),
            "title": title or fig_cfg.get("title"),
            "kinds": reg.describe(),
            "themes": ["default", "netlab-dark"],
            "datasets": len(figure.store),
            "warnings": figure.warnings,
            "window": fig_cfg.get("window"),
            "time": _time_info(),  # 回放滑杆要用的范围/样本数
        }

    @app.get("/api/spec")
    def get_spec() -> JSONResponse:
        return JSONResponse(figure.spec)

    @app.put("/api/spec")
    async def put_spec(request: Request) -> JSONResponse:
        payload = await request.json()
        report = validate_spec(payload, store=figure.store, known_kinds=reg.known_kind_names())
        if not report.ok:
            return JSONResponse({"ok": False, **report.as_dict()}, status_code=400)
        figure.spec = payload
        return JSONResponse({"ok": True, "warnings": [i.as_dict() for i in report.warnings]})

    def _time_info() -> dict[str, Any]:
        lo, hi = figure.time_bounds()
        count = 0
        for name in figure.store.names():
            if figure.store.meta(name).get("role") == "coord":
                count = max(count, int(figure.store.meta(name).get("length") or 0))
        return {"min": lo, "max": hi, "count": count}

    @app.post("/api/clear")
    def clear_history() -> dict[str, Any]:
        """清空轨迹：跟老画布的「清空轨迹」对齐——图层和数据都归零，宿主程序继续推就重新长出来。"""
        import numpy as np

        for name in list(figure.store.names()):
            meta = figure.store.meta(name)
            figure.store.add(name, np.zeros(0, dtype="float64"),
                             unit=meta.get("unit", ""), role=meta.get("role", "series"),
                             life=meta.get("life", "append"), overwrite=True)
        figure.clear()
        return {"ok": True, "datasets": len(figure.store)}

    @app.get("/api/datasets")
    def datasets() -> dict[str, Any]:
        return figure.store.catalog()

    @app.get("/api/series")
    def series(
        x: str,
        y: str,
        i0: int = 0,
        i1: int = -1,
        pixels: int | None = None,
        per_pixel: float = 2.0,
    ) -> Response:
        try:
            xv = np.asarray(figure.store.values(x)).ravel().astype(float)
            yv = np.asarray(figure.store.values(y)).ravel().astype(float)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        stop = None if i1 < 0 else min(i1, xv.size)
        xv, yv = xv[i0:stop], yv[i0:stop]
        if pixels:
            xv, yv = downsample_xy(xv, yv, pixels, per_pixel=per_pixel)
        meta = {"x": x, "y": y, "i0": i0, "i1": (stop if stop is not None else int(xv.size))}
        return Response(content=_binary_series(xv, yv, meta), media_type="application/octet-stream")

    @app.get("/api/column")
    def column(name: str, pixels: int | None = None) -> Response:
        """单列 float32 数据（前端 2D 渲染器用）。

        与 /api/series 的区别：一个数据集只传一次，不重复传 x；按 `pixels` 等间隔抽稀，
        并保证首尾点都在（缩放/回放时端点不丢）。
        """
        try:
            values = np.asarray(figure.store.values(name)).ravel().astype(np.float64)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        total = int(values.size)
        if pixels and total > int(pixels) > 1:
            idx = np.linspace(0, total - 1, int(pixels)).astype(np.int64)
            values = values[idx]
        meta = {"name": name, "n": int(values.size), "total": total}
        return Response(content=_binary_field(values, meta),
                        media_type="application/octet-stream")

    @app.get("/api/xyz")
    def xyz(x: str, y: str, z: str, max: int = 200_000) -> Response:
        """三维视图的数据出口：float32 交错 (x,y,z)，前端直接塞进 WebGL 顶点缓冲。"""
        try:
            xv = np.asarray(figure.store.values(x)).ravel()
            yv = np.asarray(figure.store.values(y)).ravel()
            zv = np.asarray(figure.store.values(z)).ravel()
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        n = min(xv.size, yv.size, zv.size)
        xv, yv, zv = xv[:n], yv[:n], zv[:n]
        limit = _clamp(max, 1_000, 2_000_000)
        if n > limit:  # 均匀抽样：三维不按像素列抽稀，只控总量
            idx = np.linspace(0, n - 1, limit).astype(np.int64)
            xv, yv, zv = xv[idx], yv[idx], zv[idx]
        meta = {"x": x, "y": y, "z": z, "n": int(xv.size), "total": int(n)}
        return Response(content=_binary_xyz(xv, yv, zv, meta),
                        media_type="application/octet-stream")

    @app.get("/api/mesh")
    def mesh(x: str, y: str, z: str, stride: int = 1) -> Response:
        """曲面的三角网格出口：顶点 + 法线 + 索引，前端直接 drawElements。

        `z` 按 `np.meshgrid(x, y)` 的约定解释（行 = y，列 = x）。
        """
        try:
            xr = np.asarray(figure.store.values(x), dtype=float)
            yr = np.asarray(figure.store.values(y), dtype=float)
            zv = np.asarray(figure.store.values(z), dtype=float)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        # 两种存法都接受：坐标向量（1D）或整张网格（meshgrid 的 2D 结果）
        if xr.ndim == 2:
            xv = xr[0, :].ravel()
        else:
            xv = xr.ravel()
        if yr.ndim == 2:
            yv = yr[:, 0].ravel()
        else:
            yv = yr.ravel()
        if zv.ndim == 1:  # 允许传已经摊平的一维场
            if xv.size * yv.size != zv.size:
                raise HTTPException(400, "z 的尺寸与 x×y 不匹配")
            zv = zv.reshape(yv.size, xv.size)
        if zv.shape != (yv.size, xv.size):
            raise HTTPException(400, "z 的形状与 x/y 长度不匹配")
        step = max(1, int(stride))
        if step > 1:
            xv, yv = xv[::step], yv[::step]
            zv = zv[::step, ::step]

        ny, nx = zv.shape
        gx, gy = np.meshgrid(xv, yv)                     # (ny, nx)
        verts = np.empty((nx * ny, 3), dtype="<f4")
        verts[:, 0] = gx.ravel().astype(np.float32, copy=False)
        verts[:, 1] = gy.ravel().astype(np.float32, copy=False)
        verts[:, 2] = zv.ravel().astype(np.float32, copy=False)

        # 法线：用数据坐标的梯度算（x/y 步长不等时也正确），不是索引空间
        dz_dy, dz_dx = np.gradient(zv, yv, xv)
        normals = np.empty((nx * ny, 3), dtype="<f4")
        nrm = np.stack([-dz_dx.ravel(), -dz_dy.ravel(), np.ones(nx * ny)], axis=1)
        nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12
        normals[:] = nrm.astype(np.float32)

        idx = np.arange(nx * ny, dtype=np.int64).reshape(ny, nx)
        a = idx[:-1, :-1].ravel()
        b = idx[:-1, 1:].ravel()
        c = idx[1:, :-1].ravel()
        d = idx[1:, 1:].ravel()
        tris = np.empty((a.size * 2, 3), dtype="<u4")
        tris[0::2] = np.stack([a, b, d], axis=1)         # 逆时针，正面朝 +z
        tris[1::2] = np.stack([a, d, c], axis=1)

        meta = {"x": x, "y": y, "z": z, "nx": int(nx), "ny": int(ny),
                "nvert": int(verts.size // 3), "ntri": int(tris.shape[0])}
        meta_bytes = json.dumps(meta, ensure_ascii=False).encode("utf-8")
        header = MAGIC + struct.pack("<III", len(meta_bytes), int(verts.size // 3),
                                     int(tris.shape[0]))
        body = verts.tobytes(order="C") + normals.tobytes(order="C") + tris.tobytes(order="C")
        return Response(content=header + meta_bytes + body,
                        media_type="application/octet-stream")


    @app.get("/api/volume")
    def volume(x: str = Query(...), y: str = Query(...), z: str = Query(...),
               values: str = Query(...), stride: int = Query(1, ge=1, le=8),
               t: float | None = Query(None), mode: str = Query("field"),
               level: float | None = Query(None)) -> Response:
        """三维标量场。values 形状 (nz, ny, nx)，x 变化最快。

        mode="field"   原始 float32 场（浏览器自绘）；
        mode="surface" 服务端 marching cubes 抽等值面，返回与 /api/mesh 完全相同的
                       顶点/法线/索引二进制（前端复用已验证的 mesh 渲染路径）。
        """
        try:
            xv = np.asarray(figure.store.values(x), dtype=np.float64).ravel()
            yv = np.asarray(figure.store.values(y), dtype=np.float64).ravel()
            zv = np.asarray(figure.store.values(z), dtype=np.float64).ravel()
            field = np.asarray(figure.store.values(values), dtype=np.float64)
        except (KeyError, IndexError) as exc:
            raise HTTPException(404, f"未知数据集：{exc}") from exc
        if field.ndim != 3:
            raise HTTPException(400, "values 必须是三维数组 (nz, ny, nx)")
        nz, ny, nx = field.shape
        if stride > 1:
            field = field[::stride, ::stride, ::stride]
            nz, ny, nx = field.shape
        finite = field[np.isfinite(field)]
        vmin = float(finite.min()) if finite.size else 0.0
        vmax = float(finite.max()) if finite.size else 1.0
        if mode == "surface":
            import pyvista as pv

            grid = pv.ImageData(dimensions=(nx, ny, nz),
                                spacing=(float(np.ptp(xv)) / max(nx - 1, 1),
                                         float(np.ptp(yv)) / max(ny - 1, 1),
                                         float(np.ptp(zv)) / max(nz - 1, 1)),
                                origin=(float(xv.min()), float(yv.min()), float(zv.min())))
            grid.point_data["value"] = field.ravel(order="C")
            lv = float(level) if level is not None else float(vmin + 0.25 * (vmax - vmin))
            surf = grid.contour([lv], scalars="value")
            surf = surf.triangulate()
            if surf.n_points == 0:
                raise HTTPException(400, "该等值面在数据范围内没有交点，换一个 level")
            surf.compute_normals(point_normals=True, cell_normals=False,
                                 auto_orient_normals=True, inplace=True)
            verts = np.asarray(surf.points, dtype="<f4")
            faces = np.asarray(surf.faces, dtype=np.int64).reshape(-1, 4)[:, 1:]
            tris = faces.astype("<u4")
            nrm = np.asarray(surf.point_data.get("Normals"), dtype="<f4")
            if nrm.shape != verts.shape:            # 兜底：法线缺失时按面法线平均
                nrm = np.zeros_like(verts)
            meta = {"x": x, "y": y, "z": z, "nx": int(nx), "ny": int(ny), "nz": int(nz),
                    "nvert": int(verts.shape[0]), "ntri": int(tris.shape[0]),
                    "level": lv, "vmin": vmin, "vmax": vmax}
            mb = json.dumps(meta, ensure_ascii=False).encode("utf-8")
            header = MAGIC + struct.pack("<III", len(mb), int(verts.shape[0]), int(tris.shape[0]))
            body = verts.tobytes(order="C") + nrm.astype("<f4").tobytes(order="C") + tris.tobytes(order="C")
            return Response(content=header + mb + body, media_type="application/octet-stream")

        meta = {"nx": int(nx), "ny": int(ny), "nz": int(nz),
                "x": [float(xv.min()), float(xv.max())],
                "y": [float(yv.min()), float(yv.max())],
                "z": [float(zv.min()), float(zv.max())],
                "vmin": vmin, "vmax": vmax, "t": t}
        return Response(content=_binary_field(field, meta),
                        media_type="application/octet-stream")

    MAX_BATCH_FRAMES = 600

    @app.post("/api/render3d/batch")
    def render3d_batch(payload: dict = Body(...)) -> Response:
        """三维批量渲染：一次请求出 N 帧，返回 zip。

        请求体：
            {"width":800,"height":600,"dpi":100,"workers":4,
             "data": {"x": [...], "y": [...]},          # 可选；不给就用本应用 figure 的数据集
             "frames": [{"spec": {...}}, {"spec": {...}}]}

        单帧失败不会整批失败：该帧写成 `frame_000N.error.txt`，HTTP 仍 200。
        """
        frames = payload.get("frames") or []
        if not isinstance(frames, list) or not frames:
            raise HTTPException(400, "frames 不能为空")
        if len(frames) > MAX_BATCH_FRAMES:
            raise HTTPException(400, f"frames 最多 {MAX_BATCH_FRAMES} 帧")
        width = int(payload.get("width", 900))
        height = int(payload.get("height", 520))
        dpi = int(payload.get("dpi", 100))
        workers = payload.get("workers")

        raw = payload.get("data") or {}
        store = figure.store
        if raw:
            from ..store.registry import DataStore

            store = DataStore()
            for name, values in raw.items():
                payload_value = values
                role = "auto"
                if isinstance(values, dict):
                    payload_value = values.get("values")
                    role = str(values.get("role") or "auto")
                arr = np.asarray(payload_value, dtype=np.float64)
                store.add(str(name), arr, role=role)

        jobs = []
        for frame in frames:
            spec = frame.get("spec") if isinstance(frame, dict) else None
            spec = spec or figure.spec
            t_val = frame.get("t") if isinstance(frame, dict) else None
            jobs.append((spec, store, {"width": width, "height": height,
                                       "dpi": dpi, "fmt": "png"},
                         None if t_val is None else float(t_val)))

        from ..backends.series import pop_trange, push_trange, time_bounds

        def _with_time(job, render):
            """逐帧 t：用 ContextVar 把 [t-window, t] 塞进渲染管线（与 /api/render?t= 同一套）。"""
            spec, st, kwargs, t_val = job
            if t_val is None:
                return render(spec, st, **kwargs)
            lo, hi = time_bounds(spec, st)
            wnd = float((spec.get("figure") or {}).get("window") or 0.0)
            if wnd > 0:
                trange = (t_val - wnd, t_val)
            else:
                trange = (float(lo) if lo is not None else float("-inf"), t_val)
            token = push_trange(trange)
            try:
                return render(spec, st, **kwargs)
            finally:
                pop_trange(token)

        from ..backends import mpl_backend, pyvista_backend, pyvista_pool
        from ..backends.pyvista_pool import workers_default

        three_d = {"volume", "particles", "segments", "surface", "trisurf", "scatter3d",
                   "line3d", "quiver3d", "bar3d", "hist3d", "voxels", "stream3d",
                   "stem3d", "text3d"}

        def _is_3d(spec: dict) -> bool:
            for layer in (spec or {}).get("layers") or []:
                if layer.get("kind") in three_d:
                    return True
                if "z" in (layer.get("data") or {}):
                    return True
            return False

        # 二维帧走进程内 mpl（进程池是为绕开 VTK 的单线程限制才存在的，二维不需要）
        payloads: list[bytes] = [b""] * len(jobs)
        pool_jobs: list[tuple[int, tuple]] = []
        try:
            for i, job in enumerate(jobs):
                if _is_3d(job[0]):
                    pool_jobs.append((i, job))
                else:
                    out = _with_time(job, lambda spec, st, **kw: mpl_backend.render_bytes(spec, st, **kw))
                    payloads[i] = out if isinstance(out, bytes) else out[0]
            # 进程池要给每个 worker 重新 import VTK（约 2–3 s），所以**先量一帧**再决定：
            # 单帧 < 250 ms 或剩余帧太少 → 全部进程内串行（实测 48 帧 500×360 曲面：
            # 进程内 1.9 s vs 4 worker 10.3 s）；反之才值得开池。
            import time as _time

            if pool_jobs:
                head_i, head_job = pool_jobs[0]
                t0 = _time.perf_counter()
                result = _with_time(head_job,
                                    lambda spec, st, **kw: pyvista_backend.render_result(spec, st, **kw))
                payloads[head_i] = result.payload if hasattr(result, "payload") else result
                per_frame = _time.perf_counter() - t0
                rest = pool_jobs[1:]
                # 有逐帧 t 时必须留在进程内：trange 走 ContextVar，跨进程会丢
                timed = any(job[3] is not None for _, job in pool_jobs)
                if workers is not None:
                    effective = int(workers)
                elif timed:
                    effective = 1
                else:
                    effective = workers_default() if (per_frame >= 0.25 and len(rest) >= 4) else 1
                if rest and effective > 1:
                    rendered = pyvista_pool.render_many([job for _, job in rest], workers=effective)
                    for (i, _), data in zip(rest, rendered):
                        payloads[i] = data
                else:
                    for i, job in rest:
                        out2 = _with_time(job, lambda spec, st, **kw: pyvista_backend.render_result(spec, st, **kw))
                        payloads[i] = out2.payload if hasattr(out2, "payload") else out2
        except Exception as exc:  # noqa: BLE001 - 整批失败才报 500
            raise HTTPException(500, f"批量渲染失败：{type(exc).__name__}: {exc}") from exc

        import io as _io
        import zipfile as _zip

        buffer = _io.BytesIO()
        with _zip.ZipFile(buffer, "w", compression=_zip.ZIP_STORED) as bundle:
            for i, data in enumerate(payloads, start=1):
                bundle.writestr(f"frame_{i:04d}.png", data)
        return Response(content=buffer.getvalue(), media_type="application/zip",
                        headers={"X-PlotKit-Frames": str(len(payloads)),
                                 "X-PlotKit-Workers": str(workers or "auto")})

    @app.get("/api/segments")
    def segments(x: str = Query(...), y: str = Query(...), z: str = Query(...),
                 stride: int = Query(1, ge=1, le=16)) -> Response:
        """多段折线的端点（第 2i、2i+1 个点连成一段），float32 平铺。"""
        try:
            xv = np.asarray(figure.store.values(x), dtype=np.float64).ravel()
            yv = np.asarray(figure.store.values(y), dtype=np.float64).ravel()
            zv = np.asarray(figure.store.values(z), dtype=np.float64).ravel()
        except (KeyError, IndexError) as exc:
            raise HTTPException(404, f"未知数据集：{exc}") from exc
        n = min(xv.size, yv.size, zv.size)
        step = max(1, int(stride))
        pts = np.stack([xv[:n], yv[:n], zv[:n]], axis=1)[::step]
        meta = {"x": x, "y": y, "z": z, "n": int(pts.shape[0]),
                "bbox": [pts.min(axis=0).tolist(), pts.max(axis=0).tolist()]}
        return Response(content=_binary_points(pts, None, meta),
                        media_type="application/octet-stream")

    @app.get("/api/particles")
    def particles(x: str = Query(...), y: str = Query(...), z: str = Query(...),
                  c: str | None = Query(None), stride: int = Query(1, ge=1, le=16),
                  t: float | None = Query(None)) -> Response:
        """时空点云（浏览器里用柔光点精灵画）：可选 c 作为每点标量着色。"""
        try:
            xv = np.asarray(figure.store.values(x), dtype=np.float64).ravel()
            yv = np.asarray(figure.store.values(y), dtype=np.float64).ravel()
            zv = np.asarray(figure.store.values(z), dtype=np.float64).ravel()
            cv = (np.asarray(figure.store.values(c), dtype=np.float64).ravel()
                  if c else np.zeros_like(xv))
        except (KeyError, IndexError) as exc:
            raise HTTPException(404, f"未知数据集：{exc}") from exc
        if not (xv.size == yv.size == zv.size == cv.size):
            raise HTTPException(400, "x / y / z / c 长度必须一致")
        pts = np.stack([xv, yv, zv], axis=1)[::stride]
        scl = cv[::stride]
        finite = scl[np.isfinite(scl)]
        meta = {"count": int(pts.shape[0]),
                "x": [float(xv.min()), float(xv.max())],
                "y": [float(yv.min()), float(yv.max())],
                "z": [float(zv.min()), float(zv.max())],
                "cmin": float(finite.min()) if finite.size else 0.0,
                "cmax": float(finite.max()) if finite.size else 1.0,
                "t": t}
        return Response(content=_binary_points(pts, scl, meta),
                        media_type="application/octet-stream")

    @app.get("/api/timeline")
    def timeline(x: str, y: str, z: str, t: str | None = None, frames: int = 240) -> Any:
        """三维时间轴：把 (x, y, z[, t]) 重采样成固定帧数，前端拖动/播放只改标记点与轨迹。"""
        frames = _clamp(frames, 2, 4000)
        try:
            xs = np.asarray(figure.store.values(x), dtype=float).ravel()
            ys = np.asarray(figure.store.values(y), dtype=float).ravel()
            zs = np.asarray(figure.store.values(z), dtype=float).ravel()
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        n = min(xs.size, ys.size, zs.size)
        if n < 2:
            raise HTTPException(400, "轨迹至少需要 2 个点")
        xs, ys, zs = xs[:n], ys[:n], zs[:n]
        if t:
            try:
                ts = np.asarray(figure.store.values(t), dtype=float).ravel()[:n]
            except KeyError as exc:
                raise HTTPException(404, str(exc)) from exc
            order = np.argsort(ts, kind="stable")
            ts, xs, ys, zs = ts[order], xs[order], ys[order], zs[order]
        else:
            ts = np.arange(n, dtype=float)
        if n > frames:
            idx = np.unique(np.linspace(0, n - 1, frames).round().astype(int))
            ts, xs, ys, zs = ts[idx], xs[idx], ys[idx], zs[idx]
        return {
            "t": [float(v) for v in ts],
            "x": [float(v) for v in xs],
            "y": [float(v) for v in ys],
            "z": [float(v) for v in zs],
            "total": int(n),
        }

    @app.post("/api/region")
    def region(payload: dict = Body(...)) -> Any:
        """三维框选后的精确统计：把点乘 MVP 投到 NDC，落在矩形内且深度有效的点参与统计。

        前端只做粗筛高亮（快），松手后调这里拿全量数据的精确数值（准）。
        """
        try:
            xs = np.asarray(figure.store.values(payload["x"]), dtype=float).ravel()
            ys = np.asarray(figure.store.values(payload["y"]), dtype=float).ravel()
            zs = np.asarray(figure.store.values(payload["z"]), dtype=float).ravel()
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        except (TypeError, ValueError) as exc:
            raise HTTPException(400, f"请求缺少 x/y/z：{exc}") from exc
        n = min(xs.size, ys.size, zs.size)
        if n == 0:
            raise HTTPException(400, "数据集为空")
        xs, ys, zs = xs[:n], ys[:n], zs[:n]

        try:
            mvp = np.asarray(payload["mvp"], dtype=float).reshape(4, 4).T  # JS 给的是列主序
            x0, y0, x1, y1 = [float(v) for v in payload["rect"]]
        except (KeyError, TypeError, ValueError) as exc:
            raise HTTPException(400, f"mvp/rect 不合法：{exc}") from exc

        pts = np.empty((n, 4), dtype=float)
        pts[:, 0] = xs
        pts[:, 1] = ys
        pts[:, 2] = zs
        pts[:, 3] = 1.0
        clip = pts @ mvp.T
        w = clip[:, 3]
        ok = w > 1e-9
        ndc = np.zeros((n, 3), dtype=float)
        ndc[ok] = clip[ok, :3] / w[ok, None]
        lo_x, hi_x = min(x0, x1), max(x0, x1)
        lo_y, hi_y = min(y0, y1), max(y0, y1)
        mask = (ok & (ndc[:, 0] >= lo_x) & (ndc[:, 0] <= hi_x)
                & (ndc[:, 1] >= lo_y) & (ndc[:, 1] <= hi_y)
                & (ndc[:, 2] >= -1.0) & (ndc[:, 2] <= 1.0))

        stats: dict[str, dict[str, float]] = {}
        for name, arr in (("x", xs), ("y", ys), ("z", zs)):
            picked = arr[mask]
            if picked.size == 0:
                stats[name] = {"count": 0}
                continue
            stats[name] = {
                "count": int(picked.size),
                "min": float(np.min(picked)),
                "max": float(np.max(picked)),
                "mean": float(np.mean(picked)),
                "p05": float(np.percentile(picked, 5)),
                "p95": float(np.percentile(picked, 95)),
                "sum": float(np.sum(picked)),
            }
        return {
            "count": int(mask.sum()),
            "total": int(n),
            "ratio": float(mask.sum()) / float(n),
            "stats": stats,
        }

    @app.get("/api/pick")
    def pick(x: float, y: float, sx: float = 1.0, sy: float = 1.0,
             tol: float = 0.03, layer: str | None = None) -> dict[str, Any]:
        """hover 精确拾取：在数据点上找最近邻（按视窗跨度归一化），而不是从像素反推。"""
        sx = abs(sx) or 1.0
        sy = abs(sy) or 1.0
        best: dict[str, Any] | None = None
        for item in figure.spec.get("layers") or []:
            if layer and item.get("id") != layer:
                continue
            data = item.get("data") or {}
            xn, yn = data.get("x"), data.get("y")
            if not xn or not yn:
                continue
            try:
                xv = np.asarray(figure.store.values(xn)).ravel()
                yv = np.asarray(figure.store.values(yn)).ravel()
            except KeyError:
                continue
            n = min(xv.size, yv.size)
            if not n:
                continue
            xv, yv = xv[:n].astype(float, copy=False), yv[:n].astype(float, copy=False)
            dist = ((xv - x) / sx) ** 2 + ((yv - y) / sy) ** 2
            i = int(np.argmin(dist))
            if best is None or dist[i] < best["d2"]:
                best = {"d2": float(dist[i]), "x": float(xv[i]), "y": float(yv[i]),
                        "i": i, "layer": item.get("id"),
                        "label": (item.get("label") or item.get("kind") or "")}
        if best is None or best["d2"] > tol * tol:
            return {"hit": False}
        best.pop("d2")
        best["hit"] = True
        return best

    layout_file = Path(layout_path) if layout_path else Path.cwd() / "layout.json"

    @app.get("/api/layout")
    def get_layout() -> JSONResponse:
        try:
            return JSONResponse(json.loads(layout_file.read_text(encoding="utf-8")))
        except (FileNotFoundError, json.JSONDecodeError):
            return JSONResponse({})

    @app.put("/api/layout")
    async def put_layout(request: Request) -> JSONResponse:
        raw = await request.body()
        if len(raw) > MAX_LAYOUT_BYTES:
            raise HTTPException(413, f"layout 超过 {MAX_LAYOUT_BYTES} 字节")
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise HTTPException(400, f"layout 不是合法 JSON: {exc}") from exc
        if not isinstance(payload, dict):
            raise HTTPException(400, "layout 顶层必须是对象")
        _write_json_atomic(layout_file, payload)
        return JSONResponse({"ok": True, "path": str(layout_file)})

    @app.get("/api/render")
    def render(
        request: Request,
        w: int = 900,
        h: int = 520,
        dpi: int = 100,
        fmt: str = "png",
        xlim: str | None = None,
        ylim: str | None = None,
        t: float | None = None,
        backend: str | None = None,
    ) -> Response:
        """按像素尺寸渲染（D33/D34）：网页呈现的唯一图片出口。

        - 支持 `xlim/ylim` 覆盖视窗（前端缩放/平移停手后带新范围来重绘）；
        - `backend` 可选 `mpl` / `pyvista` / `auto`（D37，默认走 figure 自己的选择）；
        - 同一 spec + 同一视窗走 ETag，命中返回 304；
        - `X-PlotKit-Render: hit|miss` 便于前端/验收区分。
        """
        fmt = (fmt or "png").lower()
        if fmt not in ("png", "svg"):
            raise HTTPException(400, f"不支持的格式 {fmt!r}（png / svg）")
        width, height, dpi = _clamp(w, 80, 4000), _clamp(h, 60, 4000), _clamp(dpi, 40, 400)
        xr, yr = _parse_limits(xlim), _parse_limits(ylim)
        backend = (backend or "").strip().lower() or None
        key = (figure.revision, "render", width, height, dpi, fmt, xr, yr, t, backend)

        def build():
            payload, limits = figure.render(width=width, height=height, dpi=dpi, fmt=fmt,
                                            xlim=xr, ylim=yr, with_limits=True, t_end=t,
                                            backend=backend)
            extra = {"X-PlotKit-Backend": str((limits or {}).get("backend") or backend or "mpl")}
            if limits:
                if limits.get("xlim") and limits.get("ylim"):
                    extra["X-PlotKit-Xlim"] = f"{limits['xlim'][0]:.6g},{limits['xlim'][1]:.6g}"
                    extra["X-PlotKit-Ylim"] = f"{limits['ylim'][0]:.6g},{limits['ylim'][1]:.6g}"
                if limits.get("box"):
                    extra["X-PlotKit-Box"] = ",".join(f"{v:.5f}" for v in limits["box"])
                if limits.get("px"):
                    extra["X-PlotKit-Px"] = f"{limits['px'][0]},{limits['px'][1]}"
                if limits.get("slots"):
                    extra["X-PlotKit-Axes"] = ";".join(
                        f"{s['slot']}," + ",".join(f"{v:.5f}" for v in s["box"]) for s in limits["slots"])
            return payload, extra

        return _cached(request, key, build, "image/png" if fmt == "png" else "image/svg+xml")

    @app.get("/api/anim")
    def anim(
        request: Request,
        w: int = 640,
        h: int = 400,
        dpi: int = 100,
        fps: float | None = None,
        fmt: str = "gif",
    ) -> Response:
        """动画（P13-06/07）：按 `figure.anim` 逐帧渲染，合成 GIF 或 MP4。"""
        width, height, dpi = _clamp(w, 80, 4000), _clamp(h, 60, 4000), _clamp(dpi, 40, 400)
        fmt = (fmt or "gif").lower()
        builders = {
            "gif": ("image/gif", lambda: (figure.animate_gif(width=width, height=height, dpi=dpi, fps=fps), {})),
            "mp4": ("video/mp4", lambda: (figure.animate_mp4(width=width, height=height, dpi=dpi, fps=fps), {})),
        }
        if fmt not in builders:
            raise HTTPException(400, f"不支持的动画格式 {fmt!r}（gif / mp4）")
        media_type, build = builders[fmt]
        return _cached(request, (figure.revision, "anim", width, height, dpi, fps, fmt), build, media_type)

    @app.get("/api/png")
    def png(dpi: int | None = None) -> Response:
        try:
            payload = figure.png(dpi=dpi)
        except Exception as exc:  # noqa: BLE001 - 直接回给前端看
            raise HTTPException(500, f"matplotlib 渲染失败: {exc}") from exc
        return Response(content=payload, media_type="image/png")

    return app
