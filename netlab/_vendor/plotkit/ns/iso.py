"""从数值解里抽等值面与流线（B 模式的"丝状结构"）。

思路：把求解器保存的三维帧包成 PyVista 的 ImageData，涡量用中心差分算，
等值面交给 VTK 的 marching cubes，流线交给 VTK 的积分器——不在 Python 里手写几何算法。
"""

from __future__ import annotations

from typing import Any

import numpy as np


def frame_index(result: Any, t: float) -> int:
    times = np.asarray(result.times, dtype=float)
    return int(np.clip(np.searchsorted(times, float(t)), 0, times.size - 1))


def _grid_info(result: Any) -> tuple[int, float, float]:
    p = result.params
    n = int(p.n)
    length = float(p.length)
    return n, length / n, length


def _vorticity(frame: np.ndarray, dx: float) -> np.ndarray:
    """|ω|：中心差分求旋度。frame 形状 (3, n, n, n)，分量在前。

    np.gradient 返回按 (d/dx, d/dy, d/dz) 排的三个数组。
    """
    du = np.gradient(frame[0], dx)
    dv = np.gradient(frame[1], dx)
    dw = np.gradient(frame[2], dx)
    wx = dv[2] - dw[1]
    wy = dw[0] - du[2]
    wz = du[1] - dv[0]
    return np.sqrt(wx * wx + wy * wy + wz * wz)


def _image_data(result: Any, idx: int):
    import pyvista as pv

    n, dx, length = _grid_info(result)
    grid = pv.ImageData(
        dimensions=(n, n, n),
        spacing=(dx, dx, dx),
        origin=(-length / 2, -length / 2, -length / 2),
    )
    return grid, n, dx


def isosurface(
    result: Any, t: float, *, frac: float = 0.45, level: float | None = None
) -> dict[str, Any]:
    """返回等值面的 (顶点, 三角形索引, 顶点法线)，供前端直接上传 GPU。"""
    idx = frame_index(result, t)
    frame = np.asarray(result.frames[idx], dtype=np.float64)
    grid, n, dx = _image_data(result, idx)
    mag = _vorticity(frame, dx)
    top = float(mag.max())
    if not np.isfinite(top) or top <= 0.0:
        return {
            "points": np.zeros((0, 3), np.float32),
            "indices": np.zeros((0, 3), np.uint32),
            "normals": np.zeros((0, 3), np.float32),
            "level": 0.0,
            "t": float(t),
        }
    lvl = float(frac * top) if level is None else float(level)
    grid["w"] = mag.ravel(order="F")  # x 变化最快
    surf = grid.contour([lvl], scalars="w")
    # 阈值落在场的极值附近时，contour 可能只返回点/线单元（没有多边形面），
    # 这时 compute_normals 会直接抛 TypeError，必须先判出"真的有三角面"。
    faces_raw = np.asarray(surf.faces) if surf.n_cells else np.zeros(0, np.int64)
    has_polys = faces_raw.size >= 4 and np.any(faces_raw.reshape(-1, 4)[:, 0] == 3)
    if has_polys:
        surf.compute_normals(cell_normals=False, point_normals=True, inplace=True)
    pts = np.asarray(surf.points, dtype=np.float32)
    if pts.size == 0:
        return {
            "points": pts.reshape(-1, 3),
            "indices": np.zeros((0, 3), np.uint32),
            "normals": np.zeros((0, 3), np.float32),
            "level": lvl,
            "t": float(t),
        }
    faces = faces_raw.reshape(-1, 4)
    tri = faces[faces[:, 0] == 3][:, 1:].astype(np.uint32)
    if tri.size == 0:
        return {
            "points": pts.reshape(-1, 3),
            "indices": np.zeros((0, 3), np.uint32),
            "normals": np.zeros((0, 3), np.float32),
            "level": lvl,
            "t": float(result.times[idx]),
        }
    if has_polys:
        nrm = np.asarray(surf.point_normals, dtype=np.float32)
    else:
        nrm = np.zeros_like(pts, dtype=np.float32)
    return {
        "points": pts,
        "indices": tri,
        "normals": nrm,
        "level": lvl,
        "t": float(result.times[idx]),
        "max": top,
    }


def streamlines(
    result: Any,
    t: float,
    *,
    seeds: int = 60,
    steps: int = 220,
    seed_radius: float = 0.12,
) -> dict[str, Any]:
    """在当前时刻的速度场上积分流线，返回折线束（位置 + 每条线的点数）。"""
    import pyvista as pv

    idx = frame_index(result, t)
    frame = np.asarray(result.frames[idx], dtype=np.float32)
    grid, n, dx = _image_data(result, idx)
    grid.point_data["U"] = np.column_stack(
        [
            frame[0].ravel(order="F"),
            frame[1].ravel(order="F"),
            frame[2].ravel(order="F"),
        ]
    ).astype(np.float32)
    grid.set_active_vectors("U")

    # 种子：赤道盘上均匀撒一圈 + 轴上几颗，避免全挤在核心
    ang = np.linspace(0.0, 2 * np.pi, seeds, endpoint=False)
    rad = seed_radius * (0.45 + 0.55 * (np.arange(seeds) % 5) / 4.0)
    pts = np.column_stack(
        [rad * np.cos(ang), rad * np.sin(ang), np.zeros(seeds, dtype=float)]
    )
    extra = np.column_stack([np.zeros(8), np.zeros(8), np.linspace(-0.6, 0.6, 8)])
    src = pv.PolyData(np.vstack([pts, extra]).astype(np.float32))
    lines = grid.streamlines_from_source(
        src,
        vectors="U",
        max_steps=int(steps),
        terminal_speed=1e-6,
        integration_direction="both",
        initial_step_length=dx * 0.5,
        max_step_length=dx * 2.0,
        max_error=1e-5,
    )
    pts_out = np.asarray(lines.points, dtype=np.float32)
    raw = np.asarray(lines.lines)
    counts, cursor, spans = [], 0, []
    while cursor < raw.size:
        k = int(raw[cursor])
        counts.append(k)
        spans.append(raw[cursor + 1 : cursor + 1 + k])
        cursor += k + 1
    return {
        "points": pts_out,
        "counts": np.asarray(counts, np.int32),
        "t": float(result.times[idx]),
        "n_lines": len(counts),
    }
