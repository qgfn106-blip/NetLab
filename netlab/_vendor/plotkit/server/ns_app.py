"""NS 涡旋可视化：HTTP 接口（模式 A-prime：前导阶自相似解）。

只做「算 + 传」：场由 plotkit.ns 计算，前端用 WebGL2 渲染。
二进制帧统一为 magic(4) + meta_len(4) + meta(json) + float32 payload。
"""

from __future__ import annotations

import io
import json
import struct
import threading
from functools import lru_cache

import numpy as np
from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import Response

from ..ns import SimilarityParams, analyze, convergence, profile_table, velocity_at
from ..ns.solver import MODE_LABEL as SOLVER_LABEL
from ..ns.solver import SolverField, SolverParams
from ..ns.solver import solve as solve_ns

__all__ = ["router", "MODE_LABEL"]

MODE_LABEL = "Mode A-prime - Leading-order similarity field (not a verified blow-up solution)"

MAGIC = b"PKNS"

FORMULAS = [
    r"$|u(\cdot,t)|_{L^\infty} \sim \tau^{-(1/2+h)}$",
    r"$|\omega(\cdot,t)|_{L^\infty} \sim \tau^{-1}$",
    r"$\tau = 1 - t,\quad r = \sqrt{2qX},\quad z = q^{1/2-h}\,\eta$",
    r"$q = \tau/(1-\eta^2),\quad u_\theta = q^{-(1/2+h)}E(X,\eta)$",
]


def _frame(meta: dict, payload: np.ndarray) -> Response:
    """二进制帧：magic + meta_len + meta + float32 数据。

    meta 补空格到 4 字节对齐——否则前端 `new Float32Array(buffer, offset)` 会抛
    `RangeError: start offset should be a multiple of 4`。
    """
    raw = json.dumps(meta).encode()
    pad = (-len(raw)) % 4
    if pad:
        raw = raw + b" " * pad
    blob = payload.astype(np.float32, copy=False).tobytes()
    head = MAGIC + struct.pack("<I", len(raw))
    return Response(content=head + raw + blob, media_type="application/octet-stream")


def _frame_parts(meta: dict, *parts) -> Response:
    """多段二进制帧：magic + meta_len + meta + 各段原始字节（段长写进 meta）。

    与 `_frame` 不同：段可以是 float32 也可以是 uint32，不再统一转 float32。
    """
    raw = json.dumps(meta).encode()
    pad = (-len(raw)) % 4
    if pad:
        raw = raw + b" " * pad
    head = MAGIC + struct.pack("<I", len(raw))
    body = b"".join(np.ascontiguousarray(x).tobytes() for x in parts)
    return Response(content=head + raw + body, media_type="application/octet-stream")


@lru_cache(maxsize=8)
def _table(h: float, x0: float, eta0: float):
    p = SimilarityParams(h=h, x0=x0, eta0=eta0)
    return p, profile_table(p)


def _resolve(phys: str, h: float, x0: float, eta0: float):
    """物理量旋钮优先：`phys="Γ,a,r_core"` 走 PhysicalParams 映射，否则用剖面参数。"""
    if phys:
        try:
            g, a, rc = (float(v) for v in phys.split(","))
        except ValueError as exc:
            raise HTTPException(400, "phys 需为 'gamma,a,r_core'") from exc
        from ..ns.field import PhysicalParams

        p = PhysicalParams(gamma=g, a=a, r_core=rc, h=h, eta0=eta0).to_similarity()
        return p, profile_table(p)
    return _table(h, x0, eta0)

# ---------------------------------------------------------------- 数值解（模式 B）
# 参考工程 cmccomb/navier-stokes-singularity-simulation 的做法：从静止起步、平滑开启的
# 紧支撑制造外力。这里用伪谱 + 2/3 去混叠 + 每步投影，32³ 跑到 t=0.95 约 14 s。
_SOLVER: dict = {
    "field": None, "result": None, "progress": 0.0, "error": None,
    "started": False, "lock": threading.Lock(), "n": 32, "t_end": 0.95,
}


def _solver_progress(_i: int, t: float, _peak: float) -> None:
    _SOLVER["progress"] = min(1.0, float(t) / max(float(_SOLVER["t_end"]), 1e-9))


def ensure_solver(n: int = 32, t_end: float = 0.95) -> None:
    """后台线程算一次数值解；重复调用只启动一次。"""
    with _SOLVER["lock"]:
        if _SOLVER["started"]:
            return
        _SOLVER["started"] = True
        _SOLVER["n"] = int(n)
        _SOLVER["t_end"] = float(t_end)

    def work() -> None:
        try:
            res = solve_ns(SolverParams(n=n, t_end=t_end, save_every=0.02),
                           progress=_solver_progress)
            _SOLVER["result"] = res
            _SOLVER["field"] = SolverField(res)
            _SOLVER["progress"] = 1.0
        except Exception as exc:  # noqa: BLE001 - 启动失败要能被前端看到
            _SOLVER["error"] = f"{type(exc).__name__}: {exc}"[:300]

    threading.Thread(target=work, daemon=True, name="ns-solver").start()


def _solver_field(source: str):
    """source='solver' 时返回 SolverField；未就绪就抛 503（前端据此显示进度）。"""
    if source != "solver":
        return None
    if _SOLVER["error"]:
        raise HTTPException(500, f"数值解失败：{_SOLVER['error']}")
    if _SOLVER["field"] is None:
        ensure_solver()
        raise HTTPException(503, f"数值解准备中 {100 * _SOLVER['progress']:.0f}%")
    return _SOLVER["field"]


def _solver_time(field, t: float) -> float:
    """数值解只覆盖 [0, t_end]，越界就取端点（并在 meta 里标注）。"""
    times = _SOLVER["result"].times
    return float(min(max(t, float(times[0])), float(times[-1])))


def _cyl(source: str, t: float, R: np.ndarray, Z: np.ndarray,
         h: float, x0: float, eta0: float, phys: str = ""):
    """柱坐标 (r,z) 上的 (u_r, u_θ, u_z)：解析场直接算，数值解在 y=0 面上取。"""
    field = _solver_field(source)
    if field is None:
        p, table = _resolve(phys, h, x0, eta0)
        return velocity_at(np.maximum(R, 1e-6), Z, t, p, table)
    ts = _solver_time(field, t)
    pts = np.stack([R.ravel(), np.zeros(R.size), Z.ravel()], axis=1)
    v = field.velocity(pts, ts)
    shape = R.shape
    return v[:, 0].reshape(shape), v[:, 1].reshape(shape), v[:, 2].reshape(shape)


def _cart(source: str, t: float, P: np.ndarray, h: float, x0: float, eta0: float,
          phys: str = ""):
    """任意笛卡尔点上的速度。"""
    field = _solver_field(source)
    if field is not None:
        return field.velocity(P, _solver_time(field, t))
    r = np.hypot(P[:, 0], P[:, 1])
    th = np.arctan2(P[:, 1], P[:, 0])
    p, table = _resolve(phys, h, x0, eta0)
    ur, ut, uz = velocity_at(np.maximum(r, 1e-6), P[:, 2], t, p, table)
    return np.stack([ur * np.cos(th) - ut * np.sin(th),
                     ur * np.sin(th) + ut * np.cos(th), uz], axis=1)


router = APIRouter(prefix="/api/ns", tags=["ns"])


@router.get("/meta")
def meta() -> dict:
    p, _ = _table(SimilarityParams().h, SimilarityParams().x0, SimilarityParams().eta0)
    return {
        "mode": "A-prime",
        "label": MODE_LABEL,
        "formulas": FORMULAS,
        "params": {"h": p.h, "x0": p.x0, "eta0": p.eta0,
                   "nu": p.nu, "t_blow": p.t_blow},
        "paper_compliant": p.paper_compliant,
        "note": "前导阶自相似解；剖面形状为自选核，h<0.01 才落在论文证明区间。",
        "sources": ["analytic", "solver"],
        "solver": {"label": SOLVER_LABEL, "n": _SOLVER["n"], "t_end": _SOLVER["t_end"],
                   "ready": _SOLVER["field"] is not None,
                   "progress": round(float(_SOLVER["progress"]), 3),
                   "error": _SOLVER["error"]},
    }


@router.get("/state")
def state() -> dict:
    """前端轮询：数值解是否就绪（首次约 10–20 s）。"""
    ensure_solver()
    return {"ready": _SOLVER["field"] is not None,
            "progress": round(float(_SOLVER["progress"]), 3),
            "error": _SOLVER["error"],
            "n": _SOLVER["n"], "t_end": _SOLVER["t_end"],
            "label": SOLVER_LABEL}


@router.get("/slice")
def slice_(t: float = Query(0.5, ge=0.0), n_r: int = Query(192, ge=32, le=512),
           n_z: int = Query(256, ge=32, le=512),
           phys: str = Query(""), h: float = Query(0.005), x0: float = Query(0.6), eta0: float = Query(1.0),
           r_max: float = Query(0.35, gt=0.0), z_max: float = Query(1.2, gt=0.0),
           source: str = Query("analytic")):
    """轴对称场在 (r,z) 上的一个切片（体积渲染用 2D 纹理，方位角对称）。"""
    if t >= 1.0:
        raise HTTPException(400, "t 必须小于 t_blow=1")
    r = np.linspace(0.0, r_max, n_r)
    z = np.linspace(-z_max, z_max, n_z)
    R, Z = np.meshgrid(r, z, indexing="ij")
    ur, ut, uz = _cyl(source, t, R, Z, h, x0, eta0, phys)
    t_blow = SimilarityParams().t_blow if source != "solver" else 1.0

    # 着色标量：角速度 Ω = u_θ/r（涡核里最大，远处衰减），取 log10 便于压动态范围
    omega = np.abs(ut) / np.maximum(R, 1e-6)
    omega = omega.T                                   # (n_z, n_r)，行=z、列=r
    vmax = float(np.percentile(omega[omega > 0], 99.5)) if np.any(omega > 0) else 1.0
    scalar = np.log10(np.maximum(omega, vmax * 1e-4)).astype(np.float32)

    speed = np.sqrt(ur ** 2 + ut ** 2 + uz ** 2).T.astype(np.float32)
    meta = {
        "t": float(t), "tau": float(t_blow - t), "source": source,
        "label": (SOLVER_LABEL if source == "solver" else MODE_LABEL),
        "n_r": n_r, "n_z": n_z, "r_max": float(r_max), "z_max": float(z_max),
        "vmin": float(np.log10(vmax * 1e-4)), "vmax": float(np.log10(vmax)),
        "omega_p995": vmax, "u_max": float(np.sqrt((ur ** 2 + ut ** 2 + uz ** 2).max())),
        "layout": "rows=z, cols=r; scalar then speed",
    }
    payload = np.concatenate([scalar.ravel(), speed.ravel()])
    return _frame(meta, payload)


@router.get("/diagnostics")
def diagnostics(t: float = Query(0.5, ge=0.0),
                phys: str = Query(""), h: float = Query(0.005), x0: float = Query(0.6), eta0: float = Query(1.0),
                grid: bool = Query(True), n: int = Query(48, ge=16, le=96),
                source: str = Query("analytic")) -> dict:
    if t >= 1.0:
        raise HTTPException(400, "t 必须小于 t_blow=1")
    if source == "solver":
        field = _solver_field(source)
        res = _SOLVER["result"]
        ts = _solver_time(field, t)
        i = int(np.argmin(np.abs(np.asarray(res.times) - ts)))
        d = res.diag
        row = {
            "t": float(ts), "tau": float(1.0 - ts),
            "u_max": float(d["peak_speed"][i]),
            "omega_max": float(d["peak_vorticity"][i]),
            "enstrophy": float(d["enstrophy"][i]),
            "kinetic": float(d["energy"][i]),
            "core_radius": float(d["half_peak_radius"][i]),
            "divergence_rel": float(d["divergence"][i]),
            "n_grid": int(_SOLVER["n"]),
        }
        return {"analytic": row, "mode": "B-solver", "label": SOLVER_LABEL,
                "source": "solver", "note": "有限时间代理，非奇异性证明；数值解直接给出，无解析/网格双列。",
                "grid": None}
    p, table = _resolve(phys, h, x0, eta0)
    analytic = analyze(p, t, table=table, n_r=200, n_z=200).as_dict()
    out: dict = {"analytic": analytic, "mode": "A-prime", "label": MODE_LABEL}
    if grid:
        from ..ns import grid_stats

        out["grid"] = grid_stats(p, t, table=table, n=n).as_dict()
    return out


@router.get("/convergence")
def convergence_(t: float = Query(0.5, ge=0.0),
                 phys: str = Query(""), h: float = Query(0.005), x0: float = Query(0.6), eta0: float = Query(1.0)) -> dict:
    p, _ = _table(h, x0, eta0)
    return {"t": float(t), "rows": convergence(p, t, sizes=(32, 64, 96))}


@router.get("/formula.svg")
def formula_svg(width: float = Query(7.2, ge=2.0, le=16.0)) -> Response:
    """公式层：matplotlib mathtext 排成 SVG（真矢量，可缩放、可打印）。"""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig = plt.figure(figsize=(width, 0.34 * len(FORMULAS)), dpi=200)
    fig.patch.set_alpha(0.0)
    for i, tex in enumerate(FORMULAS):
        fig.text(0.01, 1.0 - (i + 0.5) / len(FORMULAS), tex,
                 color="#e8edf5", fontsize=11, va="center", ha="left")
    buf = io.BytesIO()
    fig.savefig(buf, format="svg", bbox_inches="tight", pad_inches=0.02,
                transparent=True, metadata={"Date": None})
    plt.close(fig)
    return Response(content=buf.getvalue(), media_type="image/svg+xml")


@router.get("/velocity")
def velocity_grid(t: float = Query(0.5, ge=0.0), n: int = Query(48, ge=16, le=96),
                  extent: float = Query(0.35, gt=0.0), z_extent: float = Query(1.0, gt=0.0),
                  phys: str = Query(""), h: float = Query(0.005), x0: float = Query(0.6), eta0: float = Query(1.0),
                  source: str = Query("analytic")):
    """笛卡尔速度网格（供 GPU 三线性插值推进粒子）。n³×(u,v,w) float32。"""
    if t >= 1.0:
        raise HTTPException(400, "t 必须小于 t_blow=1")
    p, table = _resolve(phys, h, x0, eta0)
    xs = np.linspace(-extent, extent, n).astype(np.float32)
    zs = np.linspace(-z_extent, z_extent, n).astype(np.float32)
    X, Y, Z = np.meshgrid(xs, xs, zs, indexing="ij")
    R = np.hypot(X, Y)
    th = np.arctan2(Y, X)
    ur, ut, uz = velocity_at(np.maximum(R, 1e-6), Z, t, p, table)
    U = (ur * np.cos(th) - ut * np.sin(th)).astype(np.float32)
    V = (ur * np.sin(th) + ut * np.cos(th)).astype(np.float32)
    W = uz.astype(np.float32)
    meta = {"t": float(t), "n": n, "extent": float(extent), "z_extent": float(z_extent),
            "order": "x fastest, then y, then z; interleaved channels u,v,w"}
    # The WebGL sampler indexes one interleaved (u, v, w) triple per
    # point, with x as the fastest spatial axis.
    payload = np.stack([
        U.ravel(order="F"), V.ravel(order="F"), W.ravel(order="F")
    ], axis=1).ravel()
    return _frame(meta, payload)


@router.post("/export")
def export_animation(payload: dict = Body(...)):
    """把前端逐帧抓下来的 canvas 合成 GIF/MP4（保持屏幕上的渲染观感）。

    payload: {"frames": [dataURL...], "fps": 12, "fmt": "gif"|"mp4", "width": 900}
    """
    import base64
    import io
    import shutil
    import subprocess
    import tempfile

    from PIL import Image

    frames = payload.get("frames") or []
    if not frames:
        raise HTTPException(400, "frames 为空")
    fps = int(payload.get("fps") or 12)
    fmt = (payload.get("fmt") or "gif").lower()
    width = int(payload.get("width") or 900)

    images = []
    for data in frames:
        raw = data.split(",", 1)[-1]
        img = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB")
        if img.width > width:
            img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
        images.append(img)
    if not images:
        raise HTTPException(400, "帧解码失败")

    if fmt == "gif":
        buf = io.BytesIO()
        images[0].save(buf, format="GIF", save_all=True, append_images=images[1:],
                       duration=max(20, int(1000 / fps)), loop=0, optimize=True)
        return Response(content=buf.getvalue(), media_type="image/gif")
    if fmt == "mp4":
        if not shutil.which("ffmpeg"):
            raise HTTPException(400, "未安装 ffmpeg，无法导出 MP4（可用 GIF）")
        with tempfile.TemporaryDirectory() as tmp:
            for i, img in enumerate(images):
                img.save(f"{tmp}/f{i:04d}.png")
            target = f"{tmp}/out.mp4"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps),
                            "-i", f"{tmp}/f%04d.png", "-pix_fmt", "yuv420p", target], check=True)
            return Response(content=open(target, "rb").read(), media_type="video/mp4")
    raise HTTPException(400, f"不支持的格式 {fmt}")


@router.get("/arrows")
def arrows(t: float = Query(0.5, ge=0.0), n_r: int = Query(6, ge=2, le=12),
           n_theta: int = Query(20, ge=6, le=48), n_z: int = Query(7, ge=3, le=16),
           r_max: float = Query(0.42, gt=0.0), z_max: float = Query(0.95, gt=0.0),
           phys: str = Query(""), h: float = Query(0.005), x0: float = Query(0.6), eta0: float = Query(1.0),
           source: str = Query("analytic")):
    """柱坐标稀疏网格上的矢量箭头（任务书图层③）：位置 + 速度，供前端 glyph 批量绘制。"""
    if t >= 1.0:
        raise HTTPException(400, "t 必须小于 t_blow=1")
    rs = np.linspace(r_max / n_r, r_max, n_r, dtype=np.float32)
    thetas = np.linspace(0.0, 2 * np.pi, n_theta, endpoint=False, dtype=np.float32)
    zs = np.linspace(-z_max, z_max, n_z, dtype=np.float32)
    R, TH, Z = np.meshgrid(rs, thetas, zs, indexing="ij")
    ur, ut, uz = _cyl(source, t, R, Z, h, x0, eta0, phys)
    px = (R * np.cos(TH)).ravel().astype(np.float32)
    py = (R * np.sin(TH)).ravel().astype(np.float32)
    pz = Z.ravel().astype(np.float32)
    vx = (ur * np.cos(TH) - ut * np.sin(TH)).ravel().astype(np.float32)
    vy = (ur * np.sin(TH) + ut * np.cos(TH)).ravel().astype(np.float32)
    vz = uz.ravel().astype(np.float32)
    speed = np.sqrt(vx ** 2 + vy ** 2 + vz ** 2)
    meta = {"t": float(t), "count": int(px.size), "n_r": n_r, "n_theta": n_theta, "n_z": n_z,
            "r_max": float(r_max), "z_max": float(z_max),
            "u_max": float(speed.max()) if speed.size else 0.0,
            "u_theta_max": float(np.abs(ut).max()) if ut.size else 0.0,
            "order": "positions xyz then vectors xyz"}
    return _frame(meta, np.concatenate([px, py, pz, vx, vy, vz]))


@router.get("/iso")
def iso(t: float = Query(0.5, ge=0.0), frac: float = Query(0.2, gt=0.0, le=1.0),
        level: float | None = Query(None), source: str = Query("solver")) -> Response:
    """涡量等值面（B 模式）：marching cubes 在服务端算，前端只上传三角形。"""
    from ..ns.iso import isosurface

    if source != "solver":
        raise HTTPException(400, "等值面只支持数值解（source=solver）")
    _solver_field(source)
    res = _SOLVER["result"]
    t_use = float(min(max(t, float(res.times[0])), float(res.times[-1])))
    out = isosurface(res, t_use, frac=frac, level=level)
    pts = np.asarray(out["points"], dtype=np.float32)
    nrm = np.asarray(out["normals"], dtype=np.float32)
    tri = np.asarray(out["indices"], dtype=np.uint32)
    meta = {"t": out["t"], "level": float(out["level"]), "n_vert": int(pts.shape[0]),
            "n_tri": int(tri.shape[0]), "source": "solver", "label": SOLVER_LABEL,
            "order": "points f32x3, normals f32x3, indices u32x3"}
    return _frame_parts(meta, pts, nrm, tri)


@router.get("/streamlines")
def streamlines_(t: float = Query(0.5, ge=0.0), seeds: int = Query(48, ge=4, le=400),
                 steps: int = Query(200, ge=20, le=1200), radius: float = Query(0.12, gt=0.0),
                 source: str = Query("solver")) -> Response:
    """流线束（B 模式）：VTK 积分器在服务端跑，返回折线点 + 每条线的点数。"""
    from ..ns.iso import streamlines

    if source != "solver":
        raise HTTPException(400, "流线只支持数值解（source=solver）")
    _solver_field(source)
    res = _SOLVER["result"]
    t_use = float(min(max(t, float(res.times[0])), float(res.times[-1])))
    out = streamlines(res, t_use, seeds=seeds, steps=steps, seed_radius=radius)
    pts = np.asarray(out["points"], dtype=np.float32)
    cnt = np.asarray(out["counts"], dtype=np.int32)
    meta = {"t": out["t"], "n_vert": int(pts.shape[0]), "n_lines": int(out["n_lines"]),
            "source": "solver", "label": SOLVER_LABEL,
            "order": "points f32x3, counts i32"}
    return _frame_parts(meta, pts, cnt)


@router.get("/pathlines")
def pathlines(t0: float = Query(0.0, ge=0.0), t1: float = Query(0.5, gt=0.0),
              seeds: int = Query(180, ge=8, le=800), steps: int = Query(160, ge=16, le=600),
              r_seed: float = Query(0.06, gt=0.0), z_seed: float = Query(0.55, gt=0.0),
              phys: str = Query(""), h: float = Query(0.005), x0: float = Query(0.6), eta0: float = Query(1.0),
              source: str = Query("analytic")):
    """从环带上释放的种子点做 RK4 积分（真实速度场），返回折线束 + 每帧长度。"""
    if t1 >= 1.0:
        raise HTTPException(400, "t 必须小于 t_blow=1")
    p, table = _resolve(phys, h, x0, eta0)
    rng = np.random.default_rng(7)
    n = seeds
    theta = rng.uniform(0, 2 * np.pi, n)
    rr = r_seed * np.sqrt(rng.uniform(0.25, 1.0, n))
    zz = rng.uniform(-z_seed, z_seed, n)
    pos = np.stack([rr * np.cos(theta), rr * np.sin(theta), zz], axis=1)

    dt = (t1 - t0) / max(steps - 1, 1)
    out = np.empty((steps, n, 3), dtype=np.float32)
    out[0] = pos

    def vel(pts, tt):
        r = np.hypot(pts[:, 0], pts[:, 1])
        th = np.arctan2(pts[:, 1], pts[:, 0])
        ur, ut, uz = _cyl(source, tt, np.maximum(r, 1e-6).reshape(-1, 1),
                          pts[:, 2].reshape(-1, 1), h, x0, eta0, phys)
        ur, ut, uz = ur.ravel(), ut.ravel(), uz.ravel()
        return np.stack([ur * np.cos(th) - ut * np.sin(th),
                         ur * np.sin(th) + ut * np.cos(th), uz], axis=1)

    cur = pos.copy()
    for i in range(1, steps):
        tt = t0 + dt * (i - 1)
        k1 = vel(cur, tt)
        k2 = vel(cur + 0.5 * dt * k1, tt + 0.5 * dt)
        k3 = vel(cur + 0.5 * dt * k2, tt + 0.5 * dt)
        k4 = vel(cur + dt * k3, tt + dt)
        cur = cur + (dt / 6.0) * (k1 + 2 * k2 + 2 * k3 + k4)
        out[i] = cur

    meta = {"t0": float(t0), "t1": float(t1), "seeds": n, "steps": steps,
            "layout": "steps x seeds x xyz (float32, x fastest)"}
    return _frame(meta, out.ravel())
