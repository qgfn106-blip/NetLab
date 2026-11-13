"""Netlab plugin API v1（稳定门面）。

插件作者只应从这个包导入；不要直接依赖 ``netlab.core`` 内部模块。平台会把
这里的声明适配到内部注册表，并保持 ``NodeRecord`` / ``EdgeRecord`` 结构不变。

扩展边界（契约，2026-11-13 批次 A2）：
- **引擎 mode ≠ 功能块 mode**。插件可经 ``EngineSpec`` + ``register_engine`` 注册
  自定义**求解引擎 mode**（不能替换内置 ``signal`` / ``circuit`` / ``vector``）；
  但 ``BlockDef.mode``（功能块自定义模式）当前**仅允许** ``signal`` / ``vector`` /
  ``circuit``，不支持插件新增功能块 mode。
- 若需插件自定义功能块模式，属 Plugin API V2 范畴，须另行定义 Typed Port、
  生命周期、持久化、权限边界与兼容性，不在 v1 契约内。
- 本 API 是**进程内 Python 扩展接口，不是操作系统级安全沙箱**；插件在宿主进程内
  运行、拥有与宿主相同能力，不要依赖它做不可信代码隔离。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol, runtime_checkable

# ParamSpec 是平台与插件共享的参数模式。它是稳定门面的一部分。
from ...core.compute.params import ParamSpec  # noqa: F401

PLUGIN_API_VERSION = "1.0"
PLUGIN_SCHEMA = "netlab-plugin/1"
KIND_PREFIX = "plugin."


@dataclass(frozen=True)
class ComputeSpec:
    """一个信号/向量节点的计算方式。factory(params) 返回 handler(ctx)。"""

    kind: str
    label: str
    group: str
    description: str
    params: tuple[ParamSpec, ...]
    factory: Callable[[dict[str, Any]], Callable[[Any], dict[str, Any]] | None]
    outputs: tuple[str, ...] = ()
    notes: str = ""
    formula: str = ""


@dataclass(frozen=True)
class MethodSpec:
    """一条连接的传递函数；factory(params) 返回 transfer(source,target,...)。"""

    kind: str
    label: str
    group: str
    description: str
    params: tuple[ParamSpec, ...]
    factory: Callable[[dict[str, Any]], Callable[..., dict[str, Any]]]
    outputs: tuple[str, ...] = ()
    notes: str = ""
    formula: str = ""


@dataclass(frozen=True)
class ElementSpec:
    """一个电路元件；element_cls 必须是平台的 CircuitElement 子类。"""

    kind: str
    label: str
    description: str
    params: tuple[ParamSpec, ...]
    element_cls: type[Any]
    notes: str = ""
    group: str = "插件"
    formula: str = ""
    pins: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True)
class AnalysisSpec:
    kind: str
    label: str
    description: str
    params: tuple[ParamSpec, ...]
    modes: tuple[str, ...]
    run: Callable[["AnalysisContext"], "AnalysisResult"]


@dataclass
class AnalysisContext:
    scene: Any
    simulation: Any | None
    params: dict[str, Any]
    probes: list[str] = field(default_factory=list)
    input_node: str | None = None
    output_node: str | None = None
    logger: logging.Logger = field(
        default_factory=lambda: logging.getLogger("netlab.plugin")
    )


@dataclass
class AnalysisResult:
    kind: str = "summary"
    series: list[dict[str, Any]] = field(default_factory=list)
    table: list[dict[str, Any]] | None = None
    summary: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class DataFormatSpec:
    kind: str
    label: str
    extensions: tuple[str, ...]
    mime_types: tuple[str, ...]
    read: Callable[[bytes, dict[str, Any]], dict[str, Any]]
    write: Callable[[dict[str, Any], dict[str, Any]], bytes]


@dataclass(frozen=True)
class PanelSpec:
    id: str
    title: str
    slot: str = "right"
    layout: dict[str, Any] = field(default_factory=dict)
    data_sources: tuple[str, ...] = ("recorder",)


@dataclass(frozen=True)
class VisualSpec:
    kind: str
    label: str
    icon: str = ""
    accent: str = ""
    fields: tuple[str, ...] = ()


@dataclass(frozen=True)
class TemplateSpec:
    """一个场景模板生成器；builder(params) 返回 scene payload。"""

    kind: str
    label: str
    description: str
    builder: Callable[[dict[str, Any]], dict[str, Any]]


@dataclass(frozen=True)
class EngineSpec:
    mode: str
    label: str
    description: str
    factory: Callable[[Any], Any]
    node_kinds: tuple[str, ...] = ()
    edge_kinds: tuple[str, ...] = ()


@runtime_checkable
class EngineProtocol(Protocol):
    def build(self, scene: Any, store: Any) -> None: ...
    def step(self, dt: float) -> None: ...
    def reset(self) -> None: ...
    def probes(self) -> dict[str, Any]: ...
    def stats(self) -> dict[str, Any]: ...


class PluginContext:
    """插件入口函数收到的上下文。

    ``register_*`` 只登记声明；真正写入平台注册表由 PluginManager 统一完成，
    因此插件不能绕过能力声明，也不会在异常时留下半注册状态。
    """

    def __init__(
        self,
        plugin_id: str,
        plugin_dir: Path,
        data_dir: Path,
        *,
        manifest: Any = None,
        logger: logging.Logger | None = None,
        sink: Callable[[str, Any], None] | None = None,
    ) -> None:
        self.plugin_id = plugin_id
        self.plugin_dir = Path(plugin_dir)
        self.data_dir = Path(data_dir)
        self.manifest = manifest
        self.logger = logger or logging.getLogger(f"netlab.plugin.{plugin_id}")
        self._sink = sink
        self.registrations: list[tuple[str, Any]] = []

    def _register(self, capability: str, spec: Any) -> Any:
        self.registrations.append((capability, spec))
        if self._sink is not None:
            self._sink(capability, spec)
        return spec

    def register_compute(self, spec: ComputeSpec) -> ComputeSpec:
        return self._register("compute", spec)

    def register_method(self, spec: MethodSpec) -> MethodSpec:
        return self._register("method", spec)

    def register_element(self, spec: ElementSpec) -> ElementSpec:
        return self._register("element", spec)

    def register_analysis(self, spec: AnalysisSpec) -> AnalysisSpec:
        return self._register("analysis", spec)

    def register_data_format(self, spec: DataFormatSpec) -> DataFormatSpec:
        return self._register("data_io", spec)

    def register_panel(self, spec: PanelSpec) -> PanelSpec:
        return self._register("panel", spec)

    def register_visual(self, spec: VisualSpec) -> VisualSpec:
        return self._register("visual", spec)

    def register_engine(self, spec: EngineSpec) -> EngineSpec:
        return self._register("engine", spec)

    def register_template(self, spec: TemplateSpec) -> TemplateSpec:
        return self._register("template", spec)


__all__ = [
    "AnalysisContext",
    "AnalysisResult",
    "AnalysisSpec",
    "ComputeSpec",
    "DataFormatSpec",
    "EngineProtocol",
    "EngineSpec",
    "ElementSpec",
    "KIND_PREFIX",
    "MethodSpec",
    "PLUGIN_API_VERSION",
    "PLUGIN_SCHEMA",
    "PanelSpec",
    "ParamSpec",
    "PluginContext",
    "TemplateSpec",
    "VisualSpec",
]
