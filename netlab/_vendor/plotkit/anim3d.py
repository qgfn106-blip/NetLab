"""三维动画 API（D39）：同一个离屏 Plotter 复用，逐帧只改 actor 位姿 / 相机。

二维动画（`figure.animate_gif()`）是"改数据再整图重画"；三维不能这么干——
每次新建 Plotter 要重建 OpenGL 上下文（实测 450–600 ms/帧），所以这里复用
一个窗口，只更新 actor 的位置与朝向，单帧成本回到 10–30 ms。

    anim = fig.anim3d(frames=120, fps=20, width=640, height=400)
    car = anim.add_box("car", size=(0.25, 0.20, 0.03), color="#ef4444")
    car.set_pose(xyz)                      # (frames, 3) 或 (3,)
    trail = anim.add_trail("path", xyz, color="#94a3b8")
    anim.orbit(azim=(-60, 60))             # 相机扫一圈（可选）
    anim.save_gif("car.gif")
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np

from .backends import pyvista_backend


def _pv():
    return pyvista_backend._pv()          # 复用同一份 pyvista 导入与 OFF_SCREEN 设置


@dataclass
class _Actor:
    name: str
    handle: Any                            # pyvista Actor
    poses: np.ndarray | None = None        # (frames, 3) 世界坐标
    headings: np.ndarray | None = None     # (frames,) 绕 z 轴的角度（度）
    scale: float = 1.0

    def apply(self, index: int) -> None:
        if self.poses is not None:
            row = self.poses[min(index, len(self.poses) - 1)]
            self.handle.position = (float(row[0]), float(row[1]), float(row[2]))
        if self.headings is not None:
            angle = float(self.headings[min(index, len(self.headings) - 1)])
            self.handle.orientation = (0.0, 0.0, angle)


@dataclass
class _Trail:
    name: str
    points: np.ndarray                    # (n, 3) 完整轨迹
    color: str
    width: float
    actor: Any = None

    def update(self, plotter, index: int, frames: int) -> None:
        """轨迹逐帧生长：只画到当前帧对应的比例。"""
        n = len(self.points)
        if n < 2:
            return
        upto = max(2, int(round(n * (index + 1) / max(1, frames))))
        if self.actor is not None:
            try:
                plotter.remove_actor(self.actor)
            except Exception:
                pass
        self.actor = plotter.add_mesh(
            _pv().lines_from_points(self.points[:upto].astype(np.float32)),
            color=self.color, line_width=float(self.width),
        )


class Anim3D:
    """一个可复用 Plotter 的三维动画：静态场景来自 figure，动态物体由这里添加。"""

    def __init__(self, figure, *, frames: int = 120, fps: float = 20.0,
                 width: int = 640, height: int = 400, dpi: int = 100) -> None:
        if not (1 <= int(frames) <= 2000):
            raise ValueError(f"frames 必须在 1…2000 之间，收到 {frames}")
        if not (1 <= float(fps) <= 120):
            raise ValueError(f"fps 必须在 1…120 之间，收到 {fps}")
        self.figure = figure
        self.frames = int(frames)
        self.fps = float(fps)
        self.width = max(80, min(4000, int(width)))
        self.height = max(60, min(4000, int(height)))
        self.dpi = int(dpi)
        self._actors: list[_Actor] = []
        self._trails: list[_Trail] = []
        self._orbit: dict[str, Any] | None = None
        self._base_view: dict[str, Any] = {}
        self._plotter = None
        self._background_actor = None

    # ---- 场景 -------------------------------------------------------------
    def _ensure_plotter(self):
        if self._plotter is not None:
            return self._plotter
        pv = _pv()
        plotter = pv.Plotter(off_screen=True, window_size=(self.width, self.height))
        pyvista_backend._SUPPRESS_SCALAR_BAR = True   # 每帧都烙一条色标没意义
        spec = self.figure.spec
        figure_cfg = spec.get("figure") or {}
        plotter.background_color = str(figure_cfg.get("facecolor") or "white")

        # 静态场景：沿用 spec 里的三维图层
        layers = [l for l in (spec.get("layers") or []) if pyvista_backend.supports(l)]
        if layers:
            sub_spec = dict(spec)
            sub_spec["layers"] = layers
            for layer in layers:
                real = pyvista_backend.registry.ALIASES.get(str(layer.get("kind")), layer.get("kind"))
                builder = pyvista_backend._BUILDERS.get(real)
                if builder is None:
                    continue
                for item in builder(layer, self.figure.store):
                    pyvista_backend._add_item(plotter, item)

        self._base_view = dict((layers[0].get("view") if layers else {}) or {})
        self._plotter = plotter
        return plotter

    def _apply_camera(self, index: int) -> None:
        plotter = self._plotter
        view = dict(self._base_view)
        if self._orbit:
            for key in ("elev", "azim", "zoom"):
                if self._orbit.get(key) is not None:
                    view[key] = self._orbit[key]
        pyvista_backend._apply_view(plotter, self.figure.spec.get("figure") or {},
                                    pyvista_backend._view_bounds([], None, None),
                                    layer_view=view)
        if self._orbit:
            span = max(1, self.frames - 1)
            t = index / span
            azim = view.get("azim")
            if isinstance(azim, (tuple, list)) and len(azim) == 2:
                value = float(azim[0]) + (float(azim[1]) - float(azim[0])) * t
            else:
                value = float(azim if azim is not None else -58)
            elev = view.get("elev")
            if isinstance(elev, (tuple, list)) and len(elev) == 2:
                elev = float(elev[0]) + (float(elev[1]) - float(elev[0])) * t
            current = dict(view)
            current["azim"] = value
            current["elev"] = float(elev if elev is not None else 26)
            pyvista_backend._apply_view(plotter, self.figure.spec.get("figure") or {},
                                        pyvista_backend._view_bounds([], None, None),
                                        layer_view=current)

    # ---- 动态物体 ---------------------------------------------------------
    def add_box(self, name: str, *, size: Sequence[float] = (1.0, 1.0, 1.0),
                color: str = "#ef4444", opacity: float = 1.0,
                center: Sequence[float] = (0.0, 0.0, 0.0)) -> _Actor:
        """一个可以逐帧移动/转向的长方体（车体、设备舱这类）。"""
        pv = _pv()
        plotter = self._ensure_plotter()
        sx, sy, sz = (float(v) / 2.0 for v in size)
        cx, cy, cz = (float(v) for v in center)
        box = pv.Box(bounds=(cx - sx, cx + sx, cy - sy, cy + sy, cz - sz, cz + sz))
        actor = plotter.add_mesh(box, color=color, opacity=float(opacity))
        handle = _Actor(name=name, handle=actor)
        self._actors.append(handle)
        return handle

    def add_points(self, name: str, xyz: Iterable, *, color: str = "#2563eb",
                   size: float = 6.0, poses: bool = False) -> _Actor:
        """点云；`poses=True` 时把 `xyz` 当作逐帧位置（(frames,3)）。"""
        pv = _pv()
        plotter = self._ensure_plotter()
        pts = np.asarray(list(xyz) if not isinstance(xyz, np.ndarray) else xyz, dtype=float)
        if pts.ndim != 2 or pts.shape[1] != 3:
            raise ValueError("xyz 需要 (n, 3) 形状")
        if poses:
            cloud = pv.PolyData(pts[0:1].astype(np.float32))
            actor = plotter.add_mesh(cloud, color=color, point_size=float(size),
                                     render_points_as_spheres=True)
            handle = _Actor(name=name, handle=actor, poses=pts)
        else:
            cloud = pv.PolyData(pts.astype(np.float32))
            actor = plotter.add_mesh(cloud, color=color, point_size=float(size),
                                     render_points_as_spheres=True)
            handle = _Actor(name=name, handle=actor)
        self._actors.append(handle)
        return handle

    def add_trail(self, name: str, xyz: Iterable, *, color: str = "#94a3b8",
                  width: float = 2.0) -> _Trail:
        """逐帧生长的轨迹线。"""
        pts = np.asarray(list(xyz) if not isinstance(xyz, np.ndarray) else xyz, dtype=float)
        if pts.ndim != 2 or pts.shape[1] != 3:
            raise ValueError("轨迹需要 (n, 3) 形状")
        trail = _Trail(name=name, points=pts, color=color, width=float(width))
        self._ensure_plotter()
        self._trails.append(trail)
        return trail

    def set_pose(self, actor: _Actor | str, xyz: Iterable | None = None,
                 heading: Iterable | None = None) -> None:
        """给某个物体设逐帧位姿（`xyz` 是 (frames,3)，`heading` 是 (frames,) 角度）。"""
        target = self._resolve(actor)
        if xyz is not None:
            arr = np.asarray(xyz, dtype=float)
            if arr.ndim == 1:
                arr = arr.reshape(1, 3)
            if arr.shape[1] != 3:
                raise ValueError("xyz 需要 (frames, 3) 或 (3,)")
            target.poses = arr
        if heading is not None:
            head = np.asarray(heading, dtype=float).ravel()
            if head.size and np.nanmax(np.abs(head)) < 4 * math.pi:
                head = np.degrees(head)        # 弧度输入也接受
            target.headings = head

    def orbit(self, *, elev: Any = None, azim: Any = None, zoom: Any = None) -> None:
        """相机动画：`azim=(a0, a1)` / `elev=(e0, e1)` 表示起止角（度）。"""
        self._orbit = {"elev": elev, "azim": azim, "zoom": zoom}

    def _resolve(self, actor: _Actor | str) -> _Actor:
        if isinstance(actor, _Actor):
            return actor
        for handle in self._actors:
            if handle.name == actor:
                return handle
        raise KeyError(f"没有名为 {actor!r} 的动态物体")

    # ---- 渲染 -------------------------------------------------------------
    def _frame_bytes(self, index: int) -> bytes:
        plotter = self._plotter
        for actor in self._actors:
            actor.apply(index)
        for trail in self._trails:
            trail.update(plotter, index, self.frames)
        self._apply_camera(index)
        plotter.render()                      # 必须先 render，否则 screenshot 拿的是上一帧
        image = plotter.screenshot(return_img=True)
        return pyvista_backend._encode_png(image)

    def frames_png(self) -> list[bytes]:
        """逐帧 PNG 列表（前端按帧播放用）。"""
        self._ensure_plotter()
        try:
            return [self._frame_bytes(i) for i in range(self.frames)]
        finally:
            self.close()

    def _images(self):
        from PIL import Image

        return [Image.open(io.BytesIO(png)).convert("RGB") for png in self.frames_png()]

    def save_gif(self, path: str | Path | None = None) -> bytes:
        """合成 GIF（不依赖 ffmpeg）。给了 `path` 就同时写文件。"""
        images = self._images()
        if not images:
            raise ValueError("没有可渲染的帧")
        buffer = io.BytesIO()
        images[0].save(buffer, format="GIF", save_all=True, append_images=images[1:],
                       duration=max(1, int(round(1000.0 / self.fps))), loop=0, disposal=2)
        payload = buffer.getvalue()
        if path is not None:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            Path(path).write_bytes(payload)
        return payload

    def save_mp4(self, path: str | Path, *, crf: int = 20) -> Path:
        """交给 ffmpeg 合成 MP4（需要 PATH 里有 ffmpeg）。"""
        import shutil
        import subprocess
        import tempfile

        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError("导出 MP4 需要 ffmpeg，请先安装并加入 PATH（GIF 不依赖它）")
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        frames = self.frames_png()
        if not frames:
            raise ValueError("没有可渲染的帧")
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            for i, png in enumerate(frames):
                (folder / f"f{i:04d}.png").write_bytes(png)
            cmd = [ffmpeg, "-y", "-loglevel", "error", "-framerate", f"{self.fps:g}",
                   "-i", str(folder / "f%04d.png"), "-pix_fmt", "yuv420p",
                   "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-crf", str(int(crf)), str(target)]
            subprocess.run(cmd, check=True)
        return target

    def close(self) -> None:
        if self._plotter is not None:
            try:
                self._plotter.close()
            except Exception:
                pass
            self._plotter = None
