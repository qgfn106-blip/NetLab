"""PlotKit：一套 spec，渲染统一走 matplotlib（D33）。

    import plotkit as pk
    fig = pk.figure(title="RC 充电")
    fig.add_data("t", t, unit="s", role="coord")
    fig.add_data("v_out", v_out, unit="V", role="series", tags=["输出"])
    fig.add_plot("line", x="t", y="v_out", label="V_out")
    fig.show()                 # inline / 原生窗口 / 浏览器 自动选
    fig.savefig("out.png")     # matplotlib 静态
    fig.save_spec("spec.json") # 唯一真相

全局样式（PK-R13）：

    pk.init(fontsize=12, width=2.0, grid=False)   # 进程级默认，作用于之后创建的 Figure
    with pk.style_scope(color="#d00", grid=True):  # 临时覆盖，退出即还原
        ...
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator, Mapping, Sequence

from . import presets as _presets
from . import field3d, ns  # noqa: F401  (三维涡旋场景)
from .quick import quick, show
from .api.native import Figure, default_store, figure, set_default_store, subplots
from .backends import dispatch as _dispatch
from .backends import registry as _reg
from .backends.dispatch import (
    BackendUnavailable,
    BackendUnsupported,
    RenderResult,
    RendererSelector,
)
from .store.reclaim import Reclaimer
from .store.registry import DataStore
from .host_api import (
    API_VERSION,
    PlotRenderPort,
    create_server,
    index_html,
    probe,
    store_lock,
)

__version__ = "0.2.1"


class _DataProxy:
    """`pk.data` 始终指向**当前**默认 store（``set_default_store`` 之后也不会变成旧对象）。"""

    def __getattr__(self, name: str) -> Any:
        return getattr(default_store(), name)

    def __repr__(self) -> str:  # pragma: no cover
        return repr(default_store())


data = _DataProxy()


# ---------------------------------------------------------------------------
# 全局默认样式（PK-R13：`init()` / `style_scope()`）
# ---------------------------------------------------------------------------
def init(**defaults: Any) -> dict[str, Any]:
    """设置进程级默认样式（view / style 键），作用于**之后**创建的 Figure。

    合并优先级：`KIND_PRESETS < init 全局 < add_plot 显式参数 < **kwargs`（D27）。
    只接受图层级键（如 `width` / `color` / `grid` / `xlabel`）；figure 级（`size`/`dpi`/`theme`）请传给 `pk.figure()`。
    返回当前全部全局默认的副本。
    """
    return _presets.init_globals(**defaults)


def reset_style() -> None:
    """清空 `init()` 设过的全局默认。"""
    _presets.reset_globals()


def global_style() -> dict[str, Any]:
    """查看当前全局默认（副本）。"""
    return _presets.global_defaults()


@contextmanager
def style_scope(**defaults: Any) -> Iterator[None]:
    """临时覆盖全局默认，退出（含异常）后还原到进入前的状态。"""
    previous = _presets.global_defaults()
    _presets.init_globals(**defaults)
    try:
        yield
    finally:
        _presets.reset_globals()
        _presets.GLOBAL_DEFAULTS.update(previous)


# ---------------------------------------------------------------------------
# 图层注册契约（PK-R13：`register_layer`）
# ---------------------------------------------------------------------------
def register_layer(
    kind: str,
    dimension: int = 2,
    *,
    builder: Any = None,
    defaults: Mapping[str, Any] | None = None,
    preset: Mapping[str, Any] | None = None,
    passthrough: Sequence[str] = (),
    aliases: Sequence[str] = (),
    description: str = "",
    interactive: bool = True,
    overwrite: bool = False,
):
    """注册/声明一种图层能力（对应 MultiPlotter 的图层注册契约）。

    一次调用同时登记：registry 能力（dimension / builder / defaults / passthrough / aliases）
    与可选预设（`preset={"style": {...}, "view": {...}, "params": {...}}`）。

    - `builder`：可选的绘制器 `(ax, layer, store, index, *, pixels=None, per_pixel=2.0)`；
      为 None 时由 mpl 后端内置的 `DRAWERS` 按 kind 名分派。
    - `passthrough`：允许透传给后端的额外 kwargs 名单；`add_plot` 遇到这些键会原样存进
      `style["passthrough"]`，不再当作未知参数忽略/报错。
    """
    spec = _reg.register(
        kind,
        dimension,
        builder,
        defaults=defaults,
        passthrough=passthrough,
        aliases=aliases,
        description=description,
        interactive=interactive,
        overwrite=overwrite,
    )
    if preset:
        _presets.register_preset(
            kind,
            style=preset.get("style"),
            view=preset.get("view"),
            params=preset.get("params"),
        )
    return spec


def kinds() -> tuple[str, ...]:
    """已注册的图层种类（按名排序）。"""
    return _reg.kinds()


def describe() -> list[dict[str, Any]]:
    """已注册图层的能力清单（含 dimension / aliases / passthrough / interactive / backends）。"""
    return _reg.describe()


# ---------------------------------------------------------------------------
# 多后端调度（D37，见 docs/THREE_D_BACKENDS.md）
# ---------------------------------------------------------------------------
def available_backends() -> dict[str, bool]:
    """每个渲染后端是否可用（matplotlib 恒为 True；pyvista 需要额外安装）。"""
    return _dispatch.available_backends()


def choose_backend(spec: Mapping[str, Any], requested: str | None = None) -> str:
    """按 spec/显式指定/环境变量决定用哪个后端。"""
    return _dispatch.choose_backend(spec, requested)


def backends() -> tuple[str, ...]:
    """全部已知后端名。"""
    return _dispatch.KNOWN_BACKENDS


__all__ = [
    "quick",
    "show",
    "Figure",
    "figure",
    "subplots",
    "data",
    "default_store",
    "set_default_store",
    "DataStore",
    "Reclaimer",
    "init",
    "reset_style",
    "global_style",
    "style_scope",
    "register_layer",
    "kinds",
    "describe",
    "available_backends",
    "choose_backend",
    "backends",
    "RenderResult",
    "RendererSelector",
    "BackendUnavailable",
    "BackendUnsupported",
    "API_VERSION",
    "PlotRenderPort",
    "create_server",
    "index_html",
    "probe",
    "store_lock",
    "__version__",
]
