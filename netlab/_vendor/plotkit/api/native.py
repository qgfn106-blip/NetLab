"""原生 API：`pk.figure()` / `fig.add_plot(...)`。

两种入口（native / mpl 代理）都只往同一个 `Figure.spec` 里写东西，
因此"同一调用 → 同一份 spec"是结构上成立的，不靠约定。
"""

from __future__ import annotations

import hashlib
import warnings
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np

from ..backends import dispatch, mpl_backend
from ..backends.series import time_bounds as _time_bounds
from ..backends import registry as reg
from ..spec import io as spec_io
from .. import presets as preset_mod
from ..spec import model
from ..spec.model import (
    new_inset,
    new_layer,
    new_spec,
)
from ..spec.validate import (
    KNOWN_STYLE_KEYS,
    KNOWN_VIEW_KEYS,
    REQUIRED_DATA,
    validate_spec,
)
from ..store.registry import DataStore

# 样式简写 → (字段, 值转换)
STYLE_ALIASES: dict[str, tuple[str, Any]] = {
    "color": ("color", None),
    "c": ("color", None),
    "lw": ("width", float),
    "linewidth": ("width", float),
    "width": ("width", float),
    "dash": ("dash", None),
    "linestyle": ("dash", None),
    "mode": ("mode", None),
    "alpha": ("opacity", float),
    "opacity": ("opacity", float),
    "fill": ("fill", None),
    "s": ("marker_size", float),
    "markersize": ("marker_size", float),
}

KIND_ALIASES = {"plot": "line", "scatter": "marker", "points": "marker"}

# 只用 (x, y) 绘制、可以按时间窗口零拷贝切片的 kind。
# 其它 kind（image/heatmap/3D 等）读整块数组，仍走整体截断的 _store_at 保底。
_WINDOWABLE_KINDS = frozenset({"line", "scatter", "marker", "points", "bar"})


def _all_windowable(spec: Mapping[str, Any]) -> bool:
    for layer in spec.get("layers") or []:
        if layer.get("kind") not in _WINDOWABLE_KINDS:
            return False
    return True


def default_store() -> DataStore:
    """进程级默认 store（`pk.data`）；宿主可换成自己的实例。"""
    global _DEFAULT_STORE
    if _DEFAULT_STORE is None:
        _DEFAULT_STORE = DataStore(namespace="default")
    return _DEFAULT_STORE


_DEFAULT_STORE: DataStore | None = None


def set_default_store(store: DataStore) -> DataStore:
    global _DEFAULT_STORE
    _DEFAULT_STORE = store
    return store


def _style_from_kwargs(kwargs: Mapping[str, Any], *, sink: list[str]) -> dict[str, Any]:
    style: dict[str, Any] = {}
    for key, value in kwargs.items():
        if key in STYLE_ALIASES:
            field, caster = STYLE_ALIASES[key]
            if field == "marker_size":
                style.setdefault("marker", {})["size"] = float(value)
            else:
                style[field] = caster(value) if caster else value
        elif key in KNOWN_STYLE_KEYS:
            # bins / cmap / colorbar / autopct… 直接就是样式字段，不需要别名
            style[key] = value
        else:
            # 后端专有参数：不静默吞掉，明确告诉用户"被忽略了"
            sink.append(key)
    return style


class Figure:
    """一张图 = 一份 spec + 一个数据 store。"""

    def __init__(
        self,
        spec: Mapping[str, Any] | None = None,
        *,
        store: DataStore | None = None,
        size: Sequence[float] = (12.8, 8.4),
        dpi: int = 100,
        ncols: int = 1,
        subplots: int = 1,
        theme: str = "default",
        title: str | None = None,
        link_x: bool = False,
        fonts: Mapping[str, float] | None = None,
        window: float | None = None,
        strict: bool = False,
        defaults: Mapping[str, Any] | None = None,
    ) -> None:
        # 每张图默认自带 store：否则两张图共用一个全局 store，同名数据集会互相打架
        self.store = store if store is not None else DataStore(namespace="figure")
        if spec is not None:
            self.spec = dict(spec)
        else:
            self.spec = new_spec(
                size=size,
                dpi=dpi,
                ncols=ncols,
                subplots=subplots,
                theme=theme,
                title=title,
                link_x=link_x,
                fonts=fonts,
                window=window,
            )
        self.warnings: list[str] = []
        #: 严格模式：跨后端不支持的参数直接抛错，而不是 warning 后忽略（D28）
        self.strict = bool(strict)
        #: 全局默认（`pk.init()` / `pk.style_scope()` + 构造时显式 defaults）。
        #: 合并优先级低于显式参数、高于 KIND_PRESETS（D27）。
        self.defaults: dict[str, Any] = {
            **preset_mod.global_defaults(),
            **dict(defaults or {}),
        }

    # ---------------- 图层 ----------------
    def add_plot(
        self,
        kind: str = "line",
        *,
        x: Any = None,
        y: Any = None,
        data: Mapping[str, str] | None = None,
        subplot: int = 0,
        label: str | None = None,
        legend: bool = True,
        view: Mapping[str, Any] | None = None,
        style: Mapping[str, Any] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """加一层。`x`/`y` 既可以是**数据集名字**，也可以直接给数组（会自动注册成匿名数据集）。"""
        real_kind = KIND_ALIASES.get(kind, kind)
        if real_kind is None:
            raise ValueError(f"不支持的图层类型: {kind!r}")
        reg.resolve(real_kind)  # 未注册的 kind 立即报错，而不是到绘制时才炸

        refs = dict(data or {})
        if x is not None:
            refs["x"] = self._ensure_dataset(x, role="coord", hint=f"{real_kind}.x")
        if y is not None:
            refs["y"] = self._ensure_dataset(y, role="series", hint=f"{real_kind}.y")
        # 非 x/y 的数据键（pie 的 labels/values、image 的 image、table 的 cells…）
        role_for = {
            "labels": "table",
            "cells": "table",
            "header": "table",
            "image": "image",
            "values": "series",
            "z": "field",
            "u": "field",
            "v": "field",
            "w": "field",
            "error_x": "series",
            "error_y": "series",
        }
        for key, value in list(refs.items()):
            if isinstance(value, str):
                continue
            refs[key] = self._ensure_dataset(
                value, role=role_for.get(key, "auto"), hint=f"{real_kind}.{key}"
            )
        missing = [
            param for param in REQUIRED_DATA.get(real_kind, {}) if not refs.get(param)
        ]
        if missing:
            raise ValueError(
                f"{real_kind} 缺少数据参数: {', '.join(missing)}（传数据集名字或数组）"
            )

        ignored: list[str] = []
        layer_spec = reg.resolve(real_kind)
        passthrough_keys = set(layer_spec.passthrough)

        def _merge_style(dest: dict[str, Any], extra: Mapping[str, Any]) -> None:
            for key, value in extra.items():
                if key in ("marker", "error") and isinstance(value, Mapping):
                    dest[key] = {**dict(dest.get(key) or {}), **dict(value)}
                else:
                    dest[key] = value

        def _as_passthrough(key: str, value: Any) -> bool:
            """透传白名单：kind 声明过的后端专有 kwargs 原样收进 style["passthrough"]。"""
            if key in passthrough_keys:
                merged_style.setdefault("passthrough", {})[key] = value
                return True
            return False

        # 合并链（低 → 高）：KIND_PRESETS < 全局默认(init/style_scope) < 显式 style < **kwargs（D27）
        base = preset_mod.preset(real_kind)
        merged_style = {
            k: v for k, v in (base.get("style") or {}).items() if k in KNOWN_STYLE_KEYS
        }
        preset_view = dict(base.get("view") or {})

        # 全局默认覆盖预设；随后被显式 view/style 覆盖
        _merge_style(
            merged_style,
            {k: v for k, v in self.defaults.items() if k in KNOWN_STYLE_KEYS},
        )
        for key in KNOWN_VIEW_KEYS:
            if key in self.defaults:
                preset_view[key] = self.defaults[key]

        for key, value in (style or {}).items():
            if key not in KNOWN_STYLE_KEYS:
                if _as_passthrough(key, value):
                    continue
                ignored.append(key)
                continue
            _merge_style(merged_style, {key: value})

        extra_kwargs = dict(kwargs)
        for key in list(extra_kwargs):
            if key in STYLE_ALIASES or key in KNOWN_STYLE_KEYS:
                continue
            if key in passthrough_keys:
                _as_passthrough(key, extra_kwargs.pop(key))
        for field, value in _style_from_kwargs(extra_kwargs, sink=ignored).items():
            _merge_style(merged_style, {field: value})
        if ignored:
            msg = (
                f"图层 {real_kind}: 参数 {', '.join(sorted(ignored))} 不属于样式白名单，已忽略"
                f"（可用: {', '.join(sorted(STYLE_ALIASES))}）"
            )
            if self.strict:
                raise ValueError(msg)
            self.warnings.append(msg)
            warnings.warn(msg, stacklevel=2)

        if label is None and self.defaults.get("legend") is False:
            legend = False

        merged_view = dict(preset_view)
        merged_view.update(dict(view or {}))
        layer = new_layer(
            real_kind,
            subplot=subplot,
            data=refs,
            label=label,
            legend=legend,
            style=merged_style,
            view=merged_view,
        )
        self.spec["layers"].append(layer)
        return layer

    def add(
        self, kind: str, cfg: Mapping[str, Any] | None = None, **kwargs: Any
    ) -> dict[str, Any]:
        """MultiPlotter 风格入口：`fig.add("line", {"x": t, "y": v, "color": "#f00"})`。

        与 `add_plot` 等价，只是把"数据键 / 视窗 / 样式 / 其余参数"从同一个 dict 里拆开，
        对应它的 `ADD_DISPATCH`（D27）。当前支持 x/y 类图层；饼图、表格等由 P13-01 起逐个接入。
        """
        payload: dict[str, Any] = dict(cfg or {})
        payload.update(kwargs)
        x = payload.pop("x", None)
        y = payload.pop("y", None)
        # 数据键 vs 样式键：`labels` 在 pie 里是数据、在 contour 里是布尔样式，
        # 所以先看该 kind 的 REQUIRED_DATA，再按"值不是标量"兜底。
        required = set(REQUIRED_DATA.get(kind, {}))
        optional = (
            "z",
            "u",
            "v",
            "w",
            "error_x",
            "error_y",
            "header",
            "cells",
            "image",
            "values",
            "scalar",
            "t",
            "time",
        )
        data = {}
        for key in list(payload):
            if key in required:
                data[key] = payload.pop(key)
            elif key in optional and not isinstance(payload[key], (bool, int, float)):
                data[key] = payload.pop(key)
        subplot = int(payload.pop("subplot", 0))
        label = payload.pop("label", None)
        legend = bool(payload.pop("legend", True))
        view = payload.pop("view", None)
        style = payload.pop("style", None)
        return self.add_plot(
            kind,
            x=x,
            y=y,
            data=data or None,
            subplot=subplot,
            label=label,
            legend=legend,
            view=view,
            style=style,
            **payload,
        )

    def add_correlation(
        self,
        data: Mapping[str, Any],
        *,
        subplot: int = 0,
        label: str = "相关系数",
        style: Mapping[str, Any] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """相关系数矩阵（对应 MultiPlotter 的 `add_correlation_heatmap`）。

        `data` 是 `{名字: 一维数组}`；矩阵在**服务端**算（D31），前端只画。
        缺省配色为发散色 `RdBu_r` 且固定 `[-1, 1]`，这样 0 永远是白色。
        """
        if len(data) < 2:
            raise ValueError("add_correlation 至少需要两列")
        names = list(data)
        arrays = [np.asarray(v, dtype=float).ravel() for v in data.values()]
        lengths = {a.size for a in arrays}
        if len(lengths) != 1:
            raise ValueError(
                f"add_correlation 的各列长度必须一致，收到 {sorted(lengths)}"
            )
        matrix = np.corrcoef(np.vstack(arrays))
        dataset = f"corr_{len(self.store) + 1}"
        self.store.add(dataset, matrix, role="field", note=",".join(names))
        merged = {"cmap": "RdBu_r", "vmin": -1.0, "vmax": 1.0, "colorbar": True}
        merged.update(dict(style or {}))
        return self.add_plot(
            "correlation",
            data={"z": dataset},
            subplot=subplot,
            label=label,
            style=merged,
            **kwargs,
        )

    def add_trace(self, trace: Mapping[str, Any]) -> dict[str, Any]:
        """plotly 风格字典：`{"type": "scatter", "x": ..., "y": ..., "mode": "lines"}`（只解析，不依赖 plotly）。"""
        kind = {"scatter": "line", "bar": "bar"}.get(
            str(trace.get("type", "scatter")), "line"
        )
        mode = str(trace.get("mode", "lines"))
        if kind == "line" and mode == "markers":
            kind = "marker"
        line = trace.get("line") or {}
        marker = trace.get("marker") or {}
        kwargs: dict[str, Any] = {}
        if line.get("color"):
            kwargs["color"] = line["color"]
        elif marker.get("color") and isinstance(marker.get("color"), str):
            kwargs["color"] = marker["color"]
        if line.get("width"):
            kwargs["width"] = line["width"]
        if line.get("dash"):
            kwargs["dash"] = line["dash"]
        name = trace.get("name")
        return self.add_plot(
            kind,
            x=trace.get("x"),
            y=trace.get("y"),
            subplot=int(trace.get("subplot", 0)),
            label=name,
            **kwargs,
        )

    def layers(self) -> list[dict[str, Any]]:
        return self.spec["layers"]

    def remove_layer(self, layer_id: str) -> None:
        self.spec["layers"] = [
            l for l in self.spec["layers"] if l.get("id") != layer_id
        ]

    def clear(self) -> None:
        self.spec["layers"] = []

    # ---------------- 布局 ----------------
    def update_layout(self, **kwargs: Any) -> "Figure":
        fig = self.spec["figure"]
        for key, value in kwargs.items():
            if key in (
                "size",
                "dpi",
                "ncols",
                "subplots",
                "theme",
                "title",
                "link_x",
                "layout",
                "notes",
            ):
                fig[key] = value
            elif key in (
                "xlabel",
                "ylabel",
                "xlim",
                "ylim",
                "grid",
                "xscale",
                "yscale",
                "ticks",
                "loglabels",
            ):
                self.update_view(**{key: value})
            else:
                msg = f"update_layout: 不支持的参数 {key!r}，已忽略"
                self.warnings.append(msg)
                warnings.warn(msg, stacklevel=2)
        return self

    def update_traces(self, **kwargs: Any) -> "Figure":
        ignored: list[str] = []
        style = _style_from_kwargs(kwargs, sink=ignored)
        for layer in self.spec["layers"]:
            for key, value in style.items():
                if key == "marker":
                    layer["style"]["marker"].update(value)
                else:
                    layer["style"][key] = value
        if ignored:
            msg = f"update_traces: 参数 {', '.join(sorted(ignored))} 已忽略"
            self.warnings.append(msg)
            warnings.warn(msg, stacklevel=2)
        return self

    def update_view(self, **kwargs: Any) -> "Figure":
        for layer in self.spec["layers"]:
            layer["view"].update(kwargs)
        return self

    def add_inset(
        self,
        subplot: int,
        parent: int = 0,
        *,
        rect: tuple[float, float, float, float] = (0.62, 0.62, 0.35, 0.34),
        fonts: Mapping[str, float] | None = None,
    ) -> dict[str, Any]:
        """把 `subplot` 槽位变成 `parent` 槽位内部的小图；rect 是父轴绘图区的比例。"""
        inset = new_inset(subplot, parent, rect=rect, fonts=fonts)
        self.spec["figure"].setdefault("insets", []).append(inset)
        need = max(int(subplot), int(parent)) + 1
        if int(self.spec["figure"].get("subplots", 1)) < need:
            self.spec["figure"]["subplots"] = need
        return inset

    def add_shape(self, kind: str, **kwargs: Any) -> dict[str, Any]:
        """图级装饰：line / rect / arrow / triangle / path（见 model.new_shape）。"""
        shape = model.new_shape(kind, **kwargs)
        self.spec["figure"].setdefault("shapes", []).append(shape)
        return shape

    # ---------------- 动画 ----------------
    def set_anim(
        self,
        *,
        frames: int = 30,
        fps: float = 12.0,
        t_start: float | None = None,
        t_end: float | None = None,
    ) -> "Figure":
        """配置动画：把时间轴切成 `frames` 帧，按 `fps` 播放（P13-06）。

        帧不存数据快照，只存「时间切片」——每帧用 `render(t_end=…)` 现算，
        与交互渲染同一条路径，不会出现"动画和静态图不一致"。
        """
        frames = int(frames)
        if frames < 1:
            raise ValueError(f"frames 必须 ≥ 1，收到 {frames}")
        fps = float(fps)
        if fps <= 0:
            raise ValueError(f"fps 必须 > 0，收到 {fps}")
        anim = {"frames": frames, "fps": fps}
        if t_start is not None:
            anim["t_start"] = float(t_start)
        if t_end is not None:
            anim["t_end"] = float(t_end)
        self.spec.setdefault("figure", {})["anim"] = anim
        return self

    def anim3d(
        self,
        *,
        frames: int = 120,
        fps: float = 20.0,
        width: int = 640,
        height: int = 400,
        dpi: int = 100,
    ):
        """三维动画（D39）：复用同一个离屏 Plotter，逐帧只改 actor 位姿/相机。

        用法见 `plotkit.anim3d.Anim3D`：`add_box / add_points / add_trail /
        set_pose / orbit`，最后 `save_gif()` 或 `frames_png()`。
        """
        from ..anim3d import Anim3D

        return Anim3D(self, frames=frames, fps=fps, width=width, height=height, dpi=dpi)

    def anim_settings(self) -> dict[str, Any]:
        """返回补齐默认值后的动画参数（时间范围缺省取 `t` 数据集的区间）。"""
        raw = dict((self.spec.get("figure") or {}).get("anim") or {})
        frames = int(raw.get("frames", 30))
        fps = float(raw.get("fps", 12.0))
        if not 1 <= frames <= 600:
            raise ValueError(f"anim.frames 必须在 1…600 之间，收到 {frames}")
        if not 1.0 <= fps <= 120.0:
            raise ValueError(f"anim.fps 必须在 1…120 之间，收到 {fps}")
        t_start, t_end = raw.get("t_start"), raw.get("t_end")
        if t_start is None or t_end is None:
            lo, hi = 0.0, 1.0
            if "t" in self.store.names():
                t = np.asarray(self.store.values("t")).ravel().astype(float)
                if t.size:
                    lo, hi = float(np.nanmin(t)), float(np.nanmax(t))
            t_start = lo if t_start is None else float(t_start)
            t_end = hi if t_end is None else float(t_end)
        return {
            "frames": frames,
            "fps": fps,
            "t_start": float(t_start),
            "t_end": float(t_end),
        }

    def frame_times(self) -> list[float]:
        """每帧的时间游标（含首尾）。"""
        cfg = self.anim_settings()
        if cfg["frames"] == 1:
            return [cfg["t_end"]]
        return [
            float(v) for v in np.linspace(cfg["t_start"], cfg["t_end"], cfg["frames"])
        ]

    def anim_limits(
        self, *, width: int = 640, height: int = 400, dpi: int = 100
    ) -> tuple[tuple[float, float] | None, tuple[float, float] | None]:
        """动画锁定的视窗：用**完整数据**渲染一次取范围，所有帧都复用它。"""
        _, limits = self.render(width=width, height=height, dpi=dpi, with_limits=True)
        if not limits:
            return None, None
        return tuple(limits["xlim"]), tuple(limits["ylim"])

    def render_frames(
        self, *, width: int = 640, height: int = 400, dpi: int = 100
    ) -> list[bytes]:
        """逐帧渲染成 PNG 列表（前端按帧播放用）。

        先用**完整数据**渲染一次拿到视窗，之后每帧都锁在这个视窗里——
        否则 matplotlib 会按当前帧的数据自动缩放，看起来是"整幅图在放大"，
        而不是"波形在生长"（2026-10-31 评审发现）。
        """
        xlim, ylim = self.anim_limits(width=width, height=height, dpi=dpi)
        return [
            self.render(
                width=width, height=height, dpi=dpi, t_end=t, xlim=xlim, ylim=ylim
            )
            for t in self.frame_times()
        ]

    def animate_gif(
        self,
        *,
        width: int = 640,
        height: int = 400,
        dpi: int = 100,
        fps: float | None = None,
    ) -> bytes:
        """把各帧合成 GIF（浏览器直接按帧播放，≥24 fps 由 fps 控制）。"""
        import io as _io

        from PIL import Image

        cfg = self.anim_settings()
        rate = float(fps or cfg["fps"])
        frames = [
            Image.open(_io.BytesIO(png)).convert("RGB")
            for png in self.render_frames(width=width, height=height, dpi=dpi)
        ]
        if not frames:
            raise ValueError("没有可渲染的帧")
        buffer = _io.BytesIO()
        frames[0].save(
            buffer,
            format="GIF",
            save_all=True,
            append_images=frames[1:],
            duration=max(1, int(round(1000.0 / rate))),
            loop=0,
            disposal=2,
        )
        return buffer.getvalue()

    def animate_mp4(
        self,
        *,
        width: int = 640,
        height: int = 400,
        dpi: int = 100,
        fps: float | None = None,
    ) -> bytes:
        """把各帧交给 ffmpeg 合成 MP4（需要系统里有 ffmpeg；没有就抛可读错误）。"""
        import shutil
        import subprocess
        import tempfile

        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError(
                "导出 MP4 需要 ffmpeg，请先安装并加入 PATH（GIF 不依赖它）"
            )
        cfg = self.anim_settings()
        rate = float(fps or cfg["fps"])
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            frames = self.render_frames(width=width, height=height, dpi=dpi)
            if not frames:
                raise ValueError("没有可渲染的帧")
            for i, png in enumerate(frames):
                (folder / f"f{i:04d}.png").write_bytes(png)
            target = folder / "out.mp4"
            cmd = [
                ffmpeg,
                "-y",
                "-loglevel",
                "error",
                "-framerate",
                f"{rate:g}",
                "-i",
                str(folder / "f%04d.png"),
                "-pix_fmt",
                "yuv420p",
                "-vf",
                "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                str(target),
            ]
            done = subprocess.run(cmd, capture_output=True, text=True)
            if done.returncode != 0:
                raise RuntimeError(
                    f"ffmpeg 失败（{done.returncode}）：{done.stderr.strip()[:300]}"
                )
            return target.read_bytes()

    def set_view(self, subplot: int, **kwargs: Any) -> "Figure":
        for layer in self.spec["layers"]:
            if int(layer.get("subplot", 0)) == int(subplot):
                layer["view"].update(kwargs)
        return self

    # ---------------- 数据 ----------------
    def _ensure_dataset(self, value: Any, *, role: str, hint: str) -> str:
        """名字直接返回；数组则注册成匿名数据集（`anon_xxx`）。"""
        if isinstance(value, str):
            return value
        if isinstance(value, np.ndarray) or isinstance(value, (list, tuple)):
            name = f"anon_{hint.replace('.', '_')}_{len(self.store) + 1}"
            self.store.add(name, value, role=role, tags=("anon", hint))
            return name
        raise TypeError(f"{hint} 只接受数据集名字或数组，收到 {type(value).__name__}")

    @property
    def revision(self) -> tuple:
        """版本指纹：spec 内容摘要 + 每个数据集 version。

        用内容摘要而不是 `id(spec)`：原地改 `fig.spec`（改主题、改样式）也要让缓存失效。
        服务端拿它做 `/api/render` 的 ETag 缓存键（D22）。
        """
        try:
            digest = hashlib.blake2b(
                spec_io.dumps(self.spec).encode("utf-8"), digest_size=8
            ).hexdigest()
        except Exception:  # spec 里有不可序列化对象时退回对象身份，别让绘图挂掉
            digest = str(id(self.spec))
        return (
            digest,
            tuple((n, self.store.meta(n)["version"]) for n in self.store.names()),
        )

    def add_data(self, name: str, values: Any, **kwargs: Any):
        return self.store.add(name, values, **kwargs)

    # ---------------- 输出 ----------------
    def validate(self, *, strict: bool = True):
        report = validate_spec(
            self.spec, store=self.store, known_kinds=reg.known_kind_names()
        )
        if strict:
            report.raise_if_bad()
        return report

    def window(self, seconds: float | None = None) -> "Figure":
        """设置"最近 N 秒"滚动窗口（None = 显示全部历史）。"""
        self.spec["figure"]["window"] = float(seconds) if seconds else None
        return self

    def time_bounds(self) -> tuple[float | None, float | None]:
        """所有图层 x 数据的时间范围，给回放滑杆用。"""
        return _time_bounds(self.spec, self.store)

    def to_spec(self) -> dict[str, Any]:
        return self.spec

    def to_json(self) -> str:
        return spec_io.dumps(self.spec)

    def save_spec(self, path: str | Path) -> Path:
        return spec_io.save(self.spec, path)

    @classmethod
    def load_spec(cls, path: str | Path, *, store: DataStore | None = None) -> "Figure":
        return cls(spec_io.load(path), store=store)

    def savefig(
        self, path: str | Path, *, dpi: int | None = None, pixels: int | None = None
    ) -> Path:
        """静态后端（matplotlib）。"""
        self.validate()
        return mpl_backend.savefig(self.spec, self.store, path, dpi=dpi, pixels=pixels)

    def render(
        self,
        *,
        width: int = 900,
        height: int = 520,
        dpi: int = 100,
        fmt: str = "png",
        xlim: tuple[float, float] | None = None,
        ylim: tuple[float, float] | None = None,
        with_limits: bool = False,
        t_end: float | None = None,
        backend: str | None = None,
    ):
        """按像素尺寸渲染（网页呈现的唯一出口，D33/D34）。

        `with_limits=True` 时返回 `(bytes, (xlim, ylim))`，供前端把"当前图实际显示的范围"
        记下来，后续缩放/平移才有正确的起点。

        `backend`（D37）：`"mpl"`（默认）/ `"pyvista"` / `"auto"`；不传则读
        `figure.backend` 或环境变量 `PLOTKIT_BACKEND`，都没有就是 matplotlib。
        """
        result = self.render_result(
            width=width,
            height=height,
            dpi=dpi,
            fmt=fmt,
            xlim=xlim,
            ylim=ylim,
            with_limits=with_limits,
            t_end=t_end,
            backend=backend,
        )
        if not with_limits:
            return result.payload
        payload, limits = result.as_tuple()
        if limits is not None:
            limits = dict(limits)
            limits["backend"] = result.backend
            if result.meta.get("fallback"):
                limits["fallback"] = result.meta["fallback"]
        return payload, limits

    def render_result(
        self,
        *,
        width: int = 900,
        height: int = 520,
        dpi: int = 100,
        fmt: str = "png",
        xlim: tuple[float, float] | None = None,
        ylim: tuple[float, float] | None = None,
        with_limits: bool = False,
        t_end: float | None = None,
        backend: str | None = None,
    ):
        """同 `render`，但返回带后端信息的 `RenderResult`。"""
        self.validate()
        trange = None
        store = self.store
        wnd = (self.spec.get("figure") or {}).get("window")
        if t_end is not None:
            t1 = float(t_end)
            # window 有值 → 取 [t_end-window, t_end]；无值 → 取 (-inf, t_end] 前缀。
            trange = (t1 - float(wnd), t1) if wnd else (float("-inf"), t1)
            if not _all_windowable(self.spec):
                # 非 xy 图层（图像/热图/3D 等）无法按时间切片，退回整体截断的旧行为。
                store = self._store_at(t_end)
        elif wnd:
            # 没有回放游标：实时视图 = 数据末尾往回 window 秒（plotly 退役后由这里接管）
            _, t_hi = _time_bounds(self.spec, self.store)
            if t_hi is None:
                # 实时图可以先创建再推送数据；没有首帧时保留空范围，
                # 首批数据到达后下一次渲染再启用滚动窗口。
                trange = None
            else:
                t1 = float(t_hi)
                trange = (t1 - float(wnd), t1)
                if not _all_windowable(self.spec):
                    store = self._store_at(t1)
        token = mpl_backend.push_trange(trange)
        try:
            return dispatch.render_result(
                self.spec,
                store,
                backend=backend,
                width=width,
                height=height,
                dpi=dpi,
                fmt=fmt,
                xlim=xlim,
                ylim=ylim,
                with_limits=with_limits,
            )
        finally:
            mpl_backend.pop_trange(token)

    def _store_at(self, t_end: float):
        """回放：按游标截断到 `t <= t_end` 的一份临时 store（只读，不改原数据）。"""
        names = self.store.names()
        if "t" not in names:
            return self.store
        t = np.asarray(self.store.values("t")).ravel()
        cut = int(np.searchsorted(t, float(t_end), side="right"))
        if cut <= 0:
            cut = 1
        from ..store.registry import DataStore as _DS

        tmp = _DS(namespace="replay")
        for name in names:
            meta = self.store.meta(name)
            arr = np.asarray(self.store.values(name))
            if arr.ndim >= 1 and arr.shape[0] == t.size:
                arr = arr[:cut]
            tmp.add(
                name,
                arr,
                unit=meta.get("unit", ""),
                role=meta.get("role", "auto"),
                life="replace",
                overwrite=True,
            )
        return tmp

    def png(self, *, dpi: int | None = None) -> bytes:
        """内存里直接出 PNG（服务端一次性导出用）。"""
        import io as _io

        buffer = _io.BytesIO()
        self.validate()
        with __import__("matplotlib").rc_context(
            {
                "font.sans-serif": list(mpl_backend.FONT_FALLBACK),
                "axes.unicode_minus": False,
            }
        ):
            figure = mpl_backend.to_figure(self.spec, self.store, dpi=dpi)
            figure.savefig(
                buffer, format="png", dpi=dpi or int(self.spec["figure"]["dpi"])
            )
        return buffer.getvalue()

    def html(
        self, *, title: str | None = None, width: int = 900, height: int = 520
    ) -> str:
        """自包含 HTML（内联 matplotlib 的 SVG，零 CDN、零 JS 依赖，D33）。

        以前内联的是 vendored plotly bundle（1.1 MB）；渲染统一走 mpl 之后
        直接嵌 SVG 即可，导出文件更小、也不需要任何脚本。
        """
        import html as _html

        svg = self.render(width=width, height=height, fmt="svg").decode("utf-8")
        # SVG 自带的 xml 声明/DOCTYPE 放进 <body> 是非法的，切掉
        start = svg.find("<svg")
        if start > 0:
            svg = svg[start:]
        head = _html.escape(title or str(self.spec["figure"].get("title") or "PlotKit"))
        return (
            '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="utf-8">'
            f"<title>{head}</title><style>"
            "html,body{margin:0;padding:0;background:#fff}"
            "svg{display:block;width:100%;height:auto}"
            "</style></head><body>" + svg + "</body></html>"
        )

    def show(
        self,
        sink: str | None = None,
        *,
        port: int = 0,
        open_browser: bool | None = None,
    ) -> Any:
        """展示：inline → window → browser 三级探测（D9）。"""
        from ..runtime.sink import show_figure

        return show_figure(self, sink=sink, port=port, open_browser=open_browser)

    def __repr__(self) -> str:  # pragma: no cover - 调试辅助
        fig = self.spec["figure"]
        return (
            f"Figure(subplots={fig.get('subplots')}, ncols={fig.get('ncols')}, "
            f"layers={len(self.spec['layers'])}, theme={fig.get('theme')!r})"
        )


def figure(**kwargs: Any) -> Figure:
    return Figure(**kwargs)


def subplots(
    nrows_: int = 1,
    ncols: int = 1,
    *,
    size: Sequence[float] | None = None,
    dpi: int = 100,
    theme: str = "default",
    title: str | None = None,
    link_x: bool = False,
) -> tuple[Figure, list[Any]]:
    """matplotlib 风格：返回 (figure, axes 列表)，但底层仍是同一份 spec。"""
    from .mpl_proxy import AxesProxy

    rows = max(1, int(nrows_))
    cols = max(1, int(ncols))
    subplots_count = rows * cols
    width, height = size or (4.8 * cols, 3.6 * rows)
    fig = Figure(
        size=(width, height),
        dpi=dpi,
        ncols=cols,
        subplots=subplots_count,
        theme=theme,
        title=title,
        link_x=link_x,
    )
    axes = [AxesProxy(fig, index) for index in range(subplots_count)]
    return fig, axes
