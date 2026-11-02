"""持久 Figure 热重绘缓存（阶段 D）。

只缓存**最近一个** (spec 签名, 宽, 高, dpi) 的 matplotlib Figure 及其 artist：
spec 不变时，新数据只做 `artist.set_data()`，再走 blit 或整张重画。

保守约定：
- 只在 `fmt="png"` 时启用；
- 只有"每条图层恰好一个可 set_data 的 artist"时才复用（折线/散点），
  其它 kind（bar/image/heatmap/3D…）一律回退无状态重建；
- 视图范围固定（每层都给了 xlim/ylim）才走 blit；否则整张重画（仍省掉构图）；
- 任何异常都回退无状态路径，绝不让渲染失败。
"""

from __future__ import annotations

import io
import json
import os
from dataclasses import dataclass, field
from typing import Any, Mapping

_ENTRY_LIMIT = 1
_DISABLED = os.environ.get("PLOTKIT_RENDER_CACHE", "1") in ("0", "false", "False")


def encode_png(canvas, *, compress_level: int = 6) -> bytes:
    """直接从 canvas 的 RGBA 缓冲编码 PNG。

    为什么要绕过 `print_png`/`savefig`：这两者内部都会再 `draw()` 一次整图，
    实测每帧多花 ~28ms 重算刻度与文本。这里只取当前缓冲，不重绘。
    两条路径（缓存命中/未命中）都用它，保证同一像素产出同一份字节。
    """
    from PIL import Image

    import numpy as np

    rgba = np.asarray(canvas.get_renderer().buffer_rgba())
    buf = io.BytesIO()
    Image.fromarray(rgba).save(buf, format="PNG", compress_level=compress_level)
    return buf.getvalue()


def _signature(spec: Mapping[str, Any]) -> str:
    return json.dumps(spec, sort_keys=True, default=str)


@dataclass
class Entry:
    key: tuple
    figure: Any
    layers: list = field(default_factory=list)
    background: Any = None
    fixed: bool = False
    layout_frozen: bool = False


class FigureCache:
    """单条目热重绘缓存。所有方法都是宽容的：不支持就返回 None/False。"""

    def __init__(self) -> None:
        self._entry: Entry | None = None
        self.hits = 0
        self.misses = 0

    # ---- 查询 -------------------------------------------------------------
    def lookup(self, spec: Mapping[str, Any], width: int, height: int, dpi: int) -> Entry | None:
        if _DISABLED or self._entry is None:
            return None
        key = (_signature(spec), int(width), int(height), int(dpi))
        if self._entry.key != key:
            self.misses += 1
            return None
        return self._entry

    def store(self, spec: Mapping[str, Any], width: int, height: int, dpi: int,
              figure: Any, layers: list) -> Entry:
        key = (_signature(spec), int(width), int(height), int(dpi))
        # 背景延迟到第一次真正 blit 时才拍（避免 miss 时多画一遍）
        self._entry = Entry(key=key, figure=figure, layers=list(layers), background=None,
                            fixed=limits_fixed(spec))
        return self._entry

    def clear(self) -> None:
        self._entry = None

    @property
    def enabled(self) -> bool:
        return not _DISABLED

    # ---- 复用 -------------------------------------------------------------
    @staticmethod
    def _tracked(figure) -> list:
        return [a for arts in (getattr(figure, "_plotkit_artists", None) or {}).values()
                for a in arts]

    @staticmethod
    def _overlays(figure) -> list:
        """压在数据线之上的静态 artist（轴框、图例、文字）。背景里先不画，blit 时补上。"""
        out = []
        for ax in figure.axes:
            for spine in ax.spines.values():
                if spine.get_visible():
                    out.append((ax, spine))
            legend = ax.get_legend()
            if legend is not None:
                out.append((ax, legend))
            for text in ax.texts:
                if text.get_visible():
                    out.append((ax, text))
        return out

    @classmethod
    def _snapshot(cls, figure):
        """拍"静态背景"：数据 artist 与"压在线上"的 overlay 都临时隐藏后重画。"""
        canvas = figure.canvas
        tracked = cls._tracked(figure)
        overlays = [a for _, a in cls._overlays(figure)]
        targets = tracked + overlays
        states = [bool(a.get_visible()) for a in targets]
        try:
            for artist in targets:
                artist.set_visible(False)
            canvas.draw()
            return canvas.copy_from_bbox(figure.bbox)
        except Exception:
            return None
        finally:
            for artist, state in zip(targets, states):
                artist.set_visible(state)

    def update(self, entry: Entry, store, *, pixels: int, trange) -> bool:
        """把新数据写进已有 artist；返回 False 表示必须重建。"""
        from .series import _xy

        for layer in entry.layers:
            made = (getattr(entry.figure, "_plotkit_artists", {}) or {}).get(layer.get("id")) or []
            if len(made) != 1 or not hasattr(made[0], "set_data"):
                return False
            try:
                x, y = _xy(layer, store, pixels=pixels, per_pixel=2.0, trange=trange)
                made[0].set_data(x, y)
            except Exception:
                return False
        if not entry.fixed:
            # 视图自动缩放：不重算的话第二次渲染会沿用上一帧的旧范围
            for ax in entry.figure.axes:
                try:
                    ax.relim()
                    ax.autoscale_view()
                except Exception:
                    return False
        return True

    def paint(self, entry: Entry, *, fmt: str, blit: bool):
        """输出图片字节。blit=True 时只重画 artist，否则整张重画。"""
        buffer = io.BytesIO()
        figure = entry.figure
        canvas = figure.canvas
        if blit:
            if entry.background is None:
                entry.background = self._snapshot(figure)
            if entry.background is not None:
                if not entry.layout_frozen:
                    # 视窗固定 → 版面不再变；冻结布局引擎可省掉每帧 ~40ms 的 constrained_layout
                    entry.layout_frozen = True
                    try:
                        figure.set_layout_engine("none")
                    except Exception:
                        pass
                canvas.restore_region(entry.background)
                for artist in self._tracked(figure):
                    ax = getattr(artist, "axes", None)
                    if ax is not None:
                        ax.draw_artist(artist)
                # 数据线之上补画"压在线上"的静态元素：坐标轴框、图例、文字
                # （整图绘制时它们 zorder 更高；它们也没进背景，所以只画这一次，不会双重叠加）
                for ax, artist in self._overlays(figure):
                    ax.draw_artist(artist)
                canvas.blit(figure.bbox)
                return encode_png(canvas)
        # 整张重画：会重新 autoscale，背景随之作废
        entry.background = None
        if fmt == "png":
            canvas.draw()
            return encode_png(canvas)
        figure.savefig(buffer, format=fmt, dpi=figure.dpi,
                       metadata={"Date": None}, bbox_inches=None)
        return buffer.getvalue()


_CACHE = FigureCache()


def get_cache() -> FigureCache:
    return _CACHE


def limits_fixed(spec: Mapping[str, Any]) -> bool:
    """每层都显式给了 xlim 与 ylim，背景才有资格被复用（不会因 autoscale 失效）。"""
    layers = spec.get("layers") or []
    if not layers:
        return False
    for layer in layers:
        view = layer.get("view") or {}
        if not view.get("xlim") or not view.get("ylim"):
            return False
    return True
