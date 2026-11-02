"""后端调度层（D38）：把「spec + 数据」变成「一份 RenderResult」。

设计要点（对应 docs/THREE_D_BACKENDS.md §7）：

- **接口先行**：调用方只说"我要一张图"，不关心谁画的。`RenderResult` 是唯一返回类型，
  带 `backend` 字段，出问题时能立刻知道是哪条链路。
- **默认不变**：不显式指定时仍然走 matplotlib（D33），PyVista 只有明确点名才启用。
- **可选依赖**：没装 pyvista/vtk 时 `available()` 返回 False，点名用它就抛
  `BackendUnavailable`（带安装提示），不会在 import 阶段炸掉整个包。
- **能回退**：`backend="auto"` 时，三维图层在 PyVista 不可用/不支持该 kind 的情况下
  自动退回 matplotlib，并在 `meta["fallback"]` 里记下原因。
"""

from __future__ import annotations

import importlib.util
import os
from dataclasses import dataclass, field
from typing import Any, Mapping

BACKEND_MPL = "mpl"
BACKEND_PYVISTA = "pyvista"
BACKEND_VISPY = "vispy"      # 预留：没有 builder，永远不会被选中（文档 §9）
KNOWN_BACKENDS = (BACKEND_MPL, BACKEND_PYVISTA, BACKEND_VISPY)


class BackendUnavailable(RuntimeError):
    """点名要用的后端没装。"""


class BackendUnsupported(RuntimeError):
    """后端装了，但这个图层类型它画不了。"""


@dataclass(frozen=True)
class RenderResult:
    """一次渲染的完整结果。

    `payload` 是图片字节；`limits` 只在 `with_limits=True` 时给出（前端缩放起点）；
    `meta` 放可选诊断信息（是否回退、回退原因、耗时等）。
    """

    payload: bytes
    fmt: str
    width: int
    height: int
    dpi: int
    backend: str
    limits: Mapping[str, Any] | None = None
    meta: Mapping[str, Any] = field(default_factory=dict)

    def __len__(self) -> int:
        return len(self.payload)

    def as_tuple(self) -> tuple[bytes, Mapping[str, Any] | None]:
        """兼容旧调用方：`payload, limits = result.as_tuple()`。"""
        return self.payload, self.limits


def _has_module(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except Exception:
        return False


# 对外名字（`plotkit.available_backends()` / `plotkit.choose_backend()`）
def available_backends() -> dict[str, bool]:
    return available()


def choose_backend(spec: Mapping[str, Any], requested: str | None = None) -> str:
    return choose(spec, requested)


def _ensure_registered(name: str) -> None:
    """可选后端被 import 时才把自己的 builder 挂到注册表上。"""
    if name == BACKEND_PYVISTA:
        try:
            from . import pyvista_backend  # noqa: F401
        except Exception:
            pass


def available() -> dict[str, bool]:
    """每个后端是否可用（matplotlib 是硬依赖，恒为 True）。

    vispy 目前只是**预留名字**：即使装了也不会被选中（没有实现 builder），
    列出来是为了让 `plotkit.backends()` 与文档 §9 的「预留」说法对得上。
    """
    return {
        BACKEND_MPL: True,
        BACKEND_PYVISTA: _has_module("pyvista") and _has_module("vtk"),
        BACKEND_VISPY: False,
    }


def _figure_backend(spec: Mapping[str, Any]) -> str | None:
    fig = spec.get("figure") or {}
    value = fig.get("backend")
    return str(value).strip().lower() if value else None


def _is_3d(spec: Mapping[str, Any]) -> bool:
    from .registry import ALIASES, LAYER_SPECS

    if str((spec.get("figure") or {}).get("projection") or "").lower() == "3d":
        return True
    for layer in spec.get("layers") or []:
        kind = str(layer.get("kind") or "")
        real = ALIASES.get(kind, kind)
        entry = LAYER_SPECS.get(real)
        if entry is not None and entry.dimension == 3:
            return True
    return False


def _unsupported_layers(spec: Mapping[str, Any], backend: str) -> list[str]:
    """哪些三维图层这个后端画不了。

    matplotlib 不走注册表的 builder（它用 `mpl_backend.DRAWERS` 表），所以恒返回空——
    真要缺会在渲染时由 DRAWERS 报错，不要在这里误判成"不支持"。
    """
    if backend == BACKEND_MPL:
        return []

    from .registry import ALIASES, LAYER_SPECS

    missing: list[str] = []
    for layer in spec.get("layers") or []:
        kind = str(layer.get("kind") or "")
        real = ALIASES.get(kind, kind)
        entry = LAYER_SPECS.get(real)
        if entry is None:
            continue
        if entry.dimension == 3 and entry.builder_for(backend) is None:
            missing.append(real)
    return missing


def choose(spec: Mapping[str, Any], requested: str | None = None) -> str:
    """决定用哪个后端；不改变默认行为（默认 matplotlib）。"""
    want = (requested or os.environ.get("PLOTKIT_BACKEND") or _figure_backend(spec) or "").strip().lower()
    if not want:
        want = BACKEND_MPL

    if want == "auto":
        if not _is_3d(spec):
            return BACKEND_MPL
        if not available()[BACKEND_PYVISTA]:
            return BACKEND_MPL
        _ensure_registered(BACKEND_PYVISTA)
        if _unsupported_layers(spec, BACKEND_PYVISTA):
            return BACKEND_MPL
        return BACKEND_PYVISTA

    if want not in KNOWN_BACKENDS:
        raise BackendUnavailable(f"未知后端 {want!r}（可选：{', '.join(KNOWN_BACKENDS)}, auto）")

    if not available()[want]:
        hint = "pip install pyvista" if want == BACKEND_PYVISTA else ""
        raise BackendUnavailable(f"后端 {want} 不可用，请先安装依赖：{hint}".strip())

    _ensure_registered(want)
    missing = _unsupported_layers(spec, want)
    if missing:
        raise BackendUnsupported(
            f"后端 {want} 暂不支持图层：{', '.join(sorted(set(missing)))}")
    return want


def _hybrid_3d(fmt: str) -> bool:
    """矢量格式 + 三维场景 → 用混合出图（PyVista 位图 + mpl 矢量轴）。

    `PLOTKIT_3D_SVG=mpl` 可强制回退到纯 mpl 真矢量（老行为）。
    """
    mode = (os.environ.get("PLOTKIT_3D_SVG") or "hybrid").strip().lower()
    return (fmt or "").lower() in ("svg", "pdf") and mode != "mpl"


def render_result(
    spec: Mapping[str, Any],
    store: Any,
    *,
    backend: str | None = None,
    width: int = 900,
    height: int = 520,
    dpi: int = 100,
    fmt: str = "png",
    xlim: tuple[float, float] | None = None,
    ylim: tuple[float, float] | None = None,
    with_limits: bool = False,
) -> RenderResult:
    """统一入口：选后端 → 渲染 → 包装成 RenderResult。"""
    auto = (backend or "").strip().lower() == "auto"
    name = choose(spec, backend)

    if name == BACKEND_MPL:
        from . import mpl_backend

        out = mpl_backend.render_bytes(
            spec, store, width=width, height=height, dpi=dpi, fmt=fmt,
            xlim=xlim, ylim=ylim, with_limits=with_limits,
        )
        payload, limits = out if with_limits else (out, None)
        return RenderResult(payload=payload, fmt=fmt, width=width, height=height,
                            dpi=dpi, backend=BACKEND_MPL, limits=limits)

    try:
        from . import pyvista_backend

        if _hybrid_3d(fmt):
            # 混合出图：三维场景仍是 GPU 位图，坐标轴/刻度/标题由 mpl 画成真矢量
            # （GL2PS 在 OpenGL2 下只剩位图，见 docs/THREE_D_BACKENDS.md §11）
            from . import hybrid3d

            payload = hybrid3d.render_hybrid(
                spec, store, width=width, height=height, dpi=dpi, fmt=fmt,
                xlim=xlim, ylim=ylim,
            )
            limits = None
            if with_limits:
                try:
                    _, info = pyvista_backend.render_scene_threaded(
                        spec, store, width=width, height=height, dpi=dpi)
                    b = info["bounds"]
                    limits = {"xlim": [b[0], b[1]], "ylim": [b[2], b[3]],
                              "zlim": [b[4], b[5]], "backend": BACKEND_PYVISTA}
                except Exception:
                    limits = None
            return RenderResult(payload=payload, fmt=fmt, width=width, height=height,
                                dpi=dpi, backend=BACKEND_PYVISTA, limits=limits,
                                meta={"hybrid": True})

        return pyvista_backend.render_result(
            spec, store, width=width, height=height, dpi=dpi, fmt=fmt,
            xlim=xlim, ylim=ylim, with_limits=with_limits,
        )
    except (BackendUnsupported, BackendUnavailable) as exc:
        # 要矢量图时**始终**回退 mpl：VTK 9.x 的 OpenGL2 后端把 GL2PS 导出退化成
        # 「整幅位图塞进 SVG」（实测 cube/sphere/line 全是 <image>，零 <polygon>），
        # 与其给假矢量，不如换后端出真矢量。
        if not (auto or (fmt or "").lower() == "svg"):
            raise
        from . import mpl_backend

        out = mpl_backend.render_bytes(
            spec, store, width=width, height=height, dpi=dpi, fmt=fmt,
            xlim=xlim, ylim=ylim, with_limits=with_limits,
        )
        payload, limits = out if with_limits else (out, None)
        return RenderResult(payload=payload, fmt=fmt, width=width, height=height,
                            dpi=dpi, backend=BACKEND_MPL, limits=limits,
                            meta={"fallback": BACKEND_MPL, "reason": str(exc)[:200]})


class RendererSelector:
    """把「选谁画」和「画出来」收成一次调用（对应文档 §7 的 RendererSelector）。

        sel = RendererSelector(spec, requested="auto")
        sel.backend                      # 解析后的后端名（'mpl' / 'pyvista'）
        result = sel.render(store, width=800, height=500)   # -> RenderResult

    构造时就解析后端（该报的 `BackendUnavailable` / `BackendUnsupported` 会立刻抛），
    `render()` 之后 `backend` 会更新成**实际**出图的后端（`auto` 回退时会变）。
    """

    def __init__(self, spec: Mapping[str, Any], *, requested: str | None = None) -> None:
        self.spec = spec
        self.requested = (requested or "").strip().lower() or None
        self.backend = choose(spec, self.requested)

    def available(self) -> dict[str, bool]:
        return available()

    def explain(self) -> dict[str, Any]:
        """给日志/接口用：为什么选了这个后端。"""
        return {
            "requested": self.requested or "default",
            "chosen": self.backend,
            "available": available(),
        }

    def render(self, store: Any, **kwargs: Any) -> RenderResult:
        result = render_result(self.spec, store, backend=self.requested or self.backend, **kwargs)
        self.backend = result.backend
        return result
