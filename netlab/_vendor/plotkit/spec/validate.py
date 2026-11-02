"""spec 校验（v0 规则见 docs/DESIGN_v0.md §5）。

约定：
- 校验**不修改** spec；
- 所有问题一次收齐（前端要一次看到全部错误，而不是改一个报一个）；
- 未知字段记 warning 并保留，不报错（前向兼容）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence

from .model import ROLES, SPEC_VERSION

# kind -> {参数名: 允许的数据角色}
REQUIRED_DATA: dict[str, dict[str, tuple[str, ...]]] = {
    "line": {"x": ("coord", "series", "auto"), "y": ("series", "auto")},
    "scatter": {"x": ("coord", "series", "auto"), "y": ("series", "auto")},
    "bar": {"x": ("coord", "series", "auto"), "y": ("series", "auto")},
    # P13-01：低档四种
    "hist": {"x": ("coord", "series", "auto")},
    "pie": {"labels": ("table", "series", "auto"), "values": ("series", "auto")},
    "image": {"image": ("image", "field", "auto")},
    "table": {"cells": ("table", "auto")},
    # P13-02：场类（x/y 可选，缺省按数组下标）
    "heatmap": {"z": ("field", "image", "auto")},
    "contour": {"z": ("field", "image", "auto")},
    "contourf": {"z": ("field", "image", "auto")},
    "correlation": {"z": ("field", "image", "auto")},
    # P13-03：矢量场（x/y 可为 2D 网格，也可为等长 1D）
    "quiver": {"x": ("coord", "series", "field", "auto"), "y": ("coord", "series", "field", "auto"),
               "u": ("series", "field", "auto"), "v": ("series", "field", "auto")},
    "streamplot": {"x": ("coord", "series", "field", "auto"),
                   "y": ("coord", "series", "field", "auto"),
                   "u": ("field", "series", "auto"), "v": ("field", "series", "auto")},
    "barbs": {"x": ("coord", "series", "field", "auto"), "y": ("coord", "series", "field", "auto"),
              "u": ("series", "field", "auto"), "v": ("series", "field", "auto")},
    # 体渲染（仅 pyvista）：x/y/z 一维坐标 + values 形状 (nz, ny, nx)
    "volume": {"x": ("coord", "series", "auto"), "y": ("coord", "series", "auto"),
               "z": ("coord", "series", "auto"), "values": ("field", "image", "auto")},
    # 时空点云（浏览器 WebGL 点精灵）：x/y/z 逐点坐标 + 可选 c 标量
    "particles": {"x": ("series", "coord", "auto"), "y": ("series", "coord", "auto"),
                  "z": ("series", "coord", "auto")},
    # 线积分卷积：稠密矢量场纹理（u/v 必须是二维场）
    "lic": {"u": ("field", "auto"), "v": ("field", "auto")},
    # P13-04：3D 七种
    "surface": {"z": ("field", "image", "auto")},
    "line3d": {"x": ("coord", "series", "auto"), "y": ("coord", "series", "auto"),
               "z": ("series", "field", "auto")},
    "segments": {"x": ("coord", "series", "auto"), "y": ("coord", "series", "auto"),
                 "z": ("series", "field", "auto")},
    "scatter3d": {"x": ("coord", "series", "auto"), "y": ("coord", "series", "auto"),
                  "z": ("series", "field", "auto")},
    "bar3d": {"x": ("coord", "series", "auto"), "y": ("coord", "series", "auto"),
              "z": ("series", "field", "auto")},
    "hist3d": {"x": ("coord", "series", "auto"), "y": ("coord", "series", "auto")},
    "quiver3d": {"x": ("coord", "series", "field", "auto"), "y": ("coord", "series", "field", "auto"),
                 "z": ("series", "field", "auto"), "u": ("series", "field", "auto"),
                 "v": ("series", "field", "auto"), "w": ("series", "field", "auto")},
    # P13-09：方法级缺口（三角/非结构、3D 补全、信号族）
    "triplot": {"x": ("coord", "series", "auto"), "y": ("series", "auto")},
    "tricontour": {"x": ("coord", "series", "auto"), "y": ("series", "auto"),
                   "z": ("series", "field", "auto")},
    "tricontourf": {"x": ("coord", "series", "auto"), "y": ("series", "auto"),
                    "z": ("series", "field", "auto")},
    "tripcolor": {"x": ("coord", "series", "auto"), "y": ("series", "auto"),
                  "z": ("series", "field", "auto")},
    "voxels": {"z": ("field", "image", "auto")},
    "trisurf": {"x": ("coord", "series", "auto"), "y": ("series", "auto"),
                "z": ("series", "field", "auto")},
    "stem3d": {"x": ("coord", "series", "auto"), "y": ("series", "auto"),
               "z": ("series", "field", "auto")},
    "text3d": {"x": ("coord", "series", "auto"), "y": ("series", "auto"),
               "z": ("series", "field", "auto"), "labels": ("table", "auto")},
    "csd": {"x": ("series", "coord", "auto"), "y": ("series", "auto")},
    "cohere": {"x": ("series", "coord", "auto"), "y": ("series", "auto")},
    "acorr": {"x": ("series", "coord", "auto")},
    "xcorr": {"x": ("series", "coord", "auto"), "y": ("series", "auto")},
    "angle_spectrum": {"x": ("series", "coord", "auto")},
    "magnitude_spectrum": {"x": ("series", "coord", "auto")},
    "phase_spectrum": {"x": ("series", "coord", "auto")},
    # P13-07：方法表漏项
    "stairs": {"y": ("series", "field", "auto")},
    "broken_barh": {"y": ("field", "series", "auto")},
    "eventplot": {"x": ("series", "coord", "auto")},
    "bxp": {"y": ("series", "field", "auto")},
    "psd": {"x": ("coord", "series", "auto")},
    "specgram": {"x": ("coord", "series", "auto")},
    # P13-05：统计/信号族
    "boxplot": {"y": ("series", "field", "auto")},
    "violinplot": {"y": ("series", "field", "auto")},
    "ecdf": {"x": ("series", "coord", "auto")},
    "hexbin": {"x": ("coord", "series", "auto"), "y": ("series", "auto")},
    "barh": {"x": ("coord", "series", "auto"), "y": ("series", "auto")},
    "stackplot": {"x": ("coord", "series", "auto"), "y": ("series", "field", "auto")},
    "step": {"x": ("coord", "series", "auto"), "y": ("series", "auto")},
    "stem": {"x": ("coord", "series", "auto"), "y": ("series", "auto")},
    "stream3d": {"x": ("coord", "series", "field", "auto"), "y": ("coord", "series", "field", "auto"),
                 "z": ("series", "field", "auto"), "u": ("series", "field", "auto"),
                 "v": ("series", "field", "auto"), "w": ("series", "field", "auto")},
}

KNOWN_VIEW_KEYS = {
    "title", "xlabel", "ylabel", "xlim", "ylim",
    "xscale", "yscale", "grid", "invert_y", "zero_line", "ticks", "loglabels",
    # P13-04：3D 视图
    "zlim", "zlabel", "elev", "azim", "projection",
}
KNOWN_STYLE_KEYS = {
    "mode", "color", "width", "dash", "marker", "fill", "opacity", "error",
    # P13-01：hist / pie / image / table 用的键
    "bins", "density", "autopct", "cmap", "colorbar", "origin", "aspect",
    "vmin", "vmax", "fontsize", "header_color",
    # P13-02：场类
    "levels", "labels", "shading",
    # P13-03：矢量场
    "scale", "density", "arrowsize", "color_by", "shaft", "key",
    # 线积分卷积
    "steps", "contrast", "step_px", "seed", "opacity_ramp", "shade",
    # P13-04：3D
    "stride", "shade", "length", "normalize", "clim",
    # P13-05：统计/信号族
    "where", "gridsize", "widths", "showfliers", "showmeans", "mincnt",
    # P13-07：stairs / broken_barh / eventplot / bxp / psd / specgram
    "nfft", "fs", "orientation", "lineoffsets", "linelengths", "row", "height", "whis",
    "highlight", "fontsize3d",
    # P16-06：体积 / 粒子（浏览器三维图层）
    "level", "iso", "markersize", "pointsize", "density_scale",
    # PK-R13：透传白名单——kind 允许把后端专有 kwargs 原样存进 style["passthrough"]
    "passthrough",
}
KNOWN_FIGURE_KEYS = {
    "window",
    "size", "dpi", "ncols", "subplots", "theme", "title", "link_x",
    "fonts", "shapes", "insets", "anim",
}
KNOWN_TOP_KEYS = {"spec_version", "figure", "layers"}
ANNOTATION_TYPES = {"text", "hline", "vline", "band"}
MODES = {"lines", "markers", "lines+markers", "bars"}
DASHES = {"solid", "dot", "dash", "longdash", "dashdot", "longdashdot"}


@dataclass
class Issue:
    code: str
    path: str
    message: str
    level: str = "error"  # error | warning

    def as_dict(self) -> dict[str, str]:
        return {"code": self.code, "path": self.path, "message": self.message, "level": self.level}


@dataclass
class Report:
    issues: list[Issue] = field(default_factory=list)

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.level == "error"]

    @property
    def warnings(self) -> list[Issue]:
        return [i for i in self.issues if i.level == "warning"]

    @property
    def ok(self) -> bool:
        return not self.errors

    def add(self, code: str, path: str, message: str, level: str = "error") -> None:
        self.issues.append(Issue(code, path, message, level))

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "errors": [i.as_dict() for i in self.errors],
            "warnings": [i.as_dict() for i in self.warnings],
        }

    def raise_if_bad(self) -> None:
        if not self.ok:
            detail = "; ".join(f"{i.path}: {i.message}" for i in self.errors)
            raise SpecError(detail, self)


class SpecError(ValueError):
    """spec 非法。`report` 里带着全部问题，便于前端一次性展示。"""

    def __init__(self, message: str, report: Report | None = None) -> None:
        super().__init__(message)
        self.report = report


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _check_limits(report: Report, path: str, value: Any) -> None:
    if value is None:
        return
    if not isinstance(value, (list, tuple)) or len(value) != 2 or not all(_is_number(v) for v in value):
        report.add("view.limits", path, "必须是 null 或长度为 2 的数字列表")
        return
    if value[0] == value[1]:
        report.add("view.limits", path, "上下限不能相等")


def validate_spec(
    spec: Any,
    *,
    store: Any | None = None,
    known_kinds: Sequence[str] | None = None,
) -> Report:
    """校验 spec，返回 Report。`store` 提供 `.meta(name)` 时校验数据引用与角色。"""
    report = Report()

    if not isinstance(spec, Mapping):
        report.add("spec.type", "$", "spec 必须是对象（dict）")
        return report

    for key in spec:
        if key not in KNOWN_TOP_KEYS:
            report.add("spec.unknown", f"$.{key}", f"未知字段，保留但不解释: {key}", "warning")

    version = spec.get("spec_version")
    if not isinstance(version, str):
        report.add("spec.version", "$.spec_version", "缺少 spec_version")
    elif version.split(".")[0] != SPEC_VERSION.split(".")[0]:
        report.add("spec.version", "$.spec_version", f"不支持的 spec_version: {version}")

    fig = spec.get("figure")
    if not isinstance(fig, Mapping):
        report.add("figure.type", "$.figure", "缺少 figure 对象")
        return report

    for key in fig:
        if key not in KNOWN_FIGURE_KEYS:
            report.add("figure.unknown", f"$.figure.{key}", f"未知 figure 字段: {key}", "warning")

    size = fig.get("size", [12.8, 8.4])
    if not isinstance(size, (list, tuple)) or len(size) != 2 or not all(_is_number(v) and v > 0 for v in size):
        report.add("figure.size", "$.figure.size", "size 必须是两个正数")

    dpi = fig.get("dpi", 100)
    if not isinstance(dpi, int) or isinstance(dpi, bool) or dpi <= 0:
        report.add("figure.dpi", "$.figure.dpi", "dpi 必须是正整数")

    anim = fig.get("anim")
    if anim is not None:
        if not isinstance(anim, Mapping):
            report.add("figure.anim", "$.figure.anim", "anim 必须是对象")
        else:
            frames = anim.get("frames", 30)
            if not isinstance(frames, int) or isinstance(frames, bool) or not 1 <= frames <= 600:
                report.add("figure.anim.frames", "$.figure.anim.frames", "frames 必须是 1…600 的整数")
            fps = anim.get("fps", 12.0)
            if not _is_number(fps) or not 1.0 <= float(fps) <= 120.0:
                report.add("figure.anim.fps", "$.figure.anim.fps", "fps 必须在 1…120 之间")

    ncols = fig.get("ncols", 1)
    if not isinstance(ncols, int) or isinstance(ncols, bool) or ncols < 1:
        report.add("figure.ncols", "$.figure.ncols", "ncols 必须是 >=1 的整数")
        ncols = 1

    subplots = fig.get("subplots", 1)
    if not isinstance(subplots, int) or isinstance(subplots, bool) or subplots < 1:
        report.add("figure.subplots", "$.figure.subplots", "subplots 必须是 >=1 的整数")
        subplots = 1

    window = fig.get("window")
    if window is not None and not (_is_number(window) and float(window) > 0):
        report.add("figure.window", "$.figure.window", "window 必须是正数（秒）或 null")

    lay = spec.get("layers")
    if not isinstance(lay, list):
        report.add("layers.type", "$.layers", "layers 必须是数组")
        return report

    kinds = tuple(known_kinds) if known_kinds is not None else tuple(REQUIRED_DATA)
    seen_ids: set[str] = set()

    for index, layer in enumerate(lay):
        path = f"$.layers[{index}]"
        if not isinstance(layer, Mapping):
            report.add("layer.type", path, "图层必须是对象")
            continue

        layer_id = layer.get("id")
        if not isinstance(layer_id, str) or not layer_id:
            report.add("layer.id", f"{path}.id", "图层缺少稳定 id（前端 undo/重排依赖它）")
        elif layer_id in seen_ids:
            report.add("layer.id.duplicate", f"{path}.id", f"图层 id 重复: {layer_id}")
        else:
            seen_ids.add(layer_id)

        kind = layer.get("kind")
        if kind not in kinds:
            report.add("layer.kind", f"{path}.kind", f"不支持的 kind: {kind!r}（合法值: {', '.join(kinds)}）")
            continue

        subplot = layer.get("subplot", 0)
        if not isinstance(subplot, int) or isinstance(subplot, bool) or not (0 <= subplot < subplots):
            report.add("layer.subplot", f"{path}.subplot", f"subplot 必须在 [0, {subplots}) 内")

        data = layer.get("data", {})
        if not isinstance(data, Mapping):
            report.add("layer.data", f"{path}.data", "data 必须是 {参数名: 数据集名} 的对象")
            data = {}

        for param, allowed_roles in REQUIRED_DATA.get(kind, {}).items():
            name = data.get(param)
            if not isinstance(name, str) or not name:
                report.add("layer.data.missing", f"{path}.data.{param}",
                           f"{kind} 需要参数 {param}（数据集的**名字**，不是数组）")
                continue
            if store is not None:
                try:
                    meta = store.meta(name)
                except KeyError:
                    report.add("layer.data.unknown", f"{path}.data.{param}", f"数据集不存在: {name}")
                    continue
                role = str(meta.get("role", "auto"))
                if role not in ROLES:
                    report.add("layer.data.role", f"{path}.data.{param}", f"数据集 {name} 的 role 非法: {role}")
                elif role != "auto" and role not in allowed_roles:
                    report.add("layer.data.role", f"{path}.data.{param}",
                               f"数据集 {name} 的 role={role}，不能绑到 {kind}.{param}"
                               f"（允许: {', '.join(allowed_roles)}）")

        style = layer.get("style", {})
        if not isinstance(style, Mapping):
            report.add("layer.style", f"{path}.style", "style 必须是对象")
        else:
            for key in style:
                if key not in KNOWN_STYLE_KEYS:
                    report.add("layer.style.unknown", f"{path}.style.{key}", f"未知样式字段: {key}", "warning")
            mode = style.get("mode", "lines")
            if mode not in MODES:
                report.add("layer.style.mode", f"{path}.style.mode", f"不支持的 mode: {mode!r}")
            dash = style.get("dash", "solid")
            if dash not in DASHES:
                report.add("layer.style.dash", f"{path}.style.dash", f"不支持的 dash: {dash!r}")
            width = style.get("width", 1.6)
            if not _is_number(width) or width < 0:
                report.add("layer.style.width", f"{path}.style.width", "width 必须是非负数")
            opacity = style.get("opacity", 1.0)
            if not _is_number(opacity) or not (0 <= opacity <= 1):
                report.add("layer.style.opacity", f"{path}.style.opacity", "opacity 必须在 [0, 1] 内")
            color = style.get("color")
            if color is not None and not isinstance(color, str):
                report.add("layer.style.color", f"{path}.style.color", "color 必须是颜色字符串或 null")

        view = layer.get("view", {})
        if not isinstance(view, Mapping):
            report.add("layer.view", f"{path}.view", "view 必须是对象")
        else:
            for key in view:
                if key not in KNOWN_VIEW_KEYS:
                    report.add("layer.view.unknown", f"{path}.view.{key}", f"未知 view 字段: {key}", "warning")
            _check_limits(report, f"{path}.view.xlim", view.get("xlim"))
            _check_limits(report, f"{path}.view.ylim", view.get("ylim"))
            for axis in ("xscale", "yscale"):
                scale = view.get(axis, "linear")
                if scale not in ("linear", "log"):
                    report.add("layer.view.scale", f"{path}.view.{axis}", f"不支持的 scale: {scale!r}")
                if scale == "log":
                    lim = view.get("xlim" if axis == "xscale" else "ylim")
                    if isinstance(lim, (list, tuple)) and len(lim) == 2:
                        try:
                            lo, hi = float(lim[0]), float(lim[1])
                        except (TypeError, ValueError):
                            continue
                        if lo <= 0 or hi <= 0:
                            report.add("layer.view.log_limit", f"{path}.view.{axis}lim",
                                       "对数轴的范围必须全部为正数")

        anns = layer.get("annotations", [])
        if not isinstance(anns, list):
            report.add("layer.annotations", f"{path}.annotations", "annotations 必须是数组")
        else:
            for j, ann in enumerate(anns):
                if not isinstance(ann, Mapping) or ann.get("type") not in ANNOTATION_TYPES:
                    report.add("layer.annotation.type", f"{path}.annotations[{j}]",
                               f"标注 type 必须是 {', '.join(sorted(ANNOTATION_TYPES))} 之一")

    return report


def validate_or_raise(spec: Any, *, store: Any | None = None, known_kinds: Sequence[str] | None = None) -> Report:
    report = validate_spec(spec, store=store, known_kinds=known_kinds)
    report.raise_if_bad()
    return report
