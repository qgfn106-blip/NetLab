"""图层能力注册表：kind → 如何变成某个后端的图元。

照搬 MultiPlotter 的形状（frozen dataclass + 单一注册入口 + 原地更新字典），但不抄它的
`draw_handler(ax, config)` 契约——那份契约字面就是 matplotlib 的 Axes，换后端等于伪造 ax。
这里每个后端各自实现 builder，注册表只负责「声明能力」。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Sequence

from ..store.registry import DataStore

Builder = Callable[[Mapping[str, Any], DataStore], Any]


@dataclass(frozen=True)
class LayerSpec:
    kind: str
    dimension: int
    builders: Mapping[str, Builder] = field(default_factory=dict)
    defaults: Mapping[str, Any] = field(default_factory=dict)
    passthrough: Sequence[str] = ()
    aliases: Sequence[str] = ()
    description: str = ""
    interactive: bool = True  # False = 只出静态图，前端不给缩放/平移（D36）

    @property
    def builder(self) -> Builder | None:
        """向后兼容：默认后端（matplotlib）的 builder。

        D38 之前只有单一 builder；改成多后端后旧代码仍按 `spec.builder` 取用，
        这里返回 mpl 的，取不到再退到第一个已注册后端。
        """
        if "mpl" in self.builders:
            return self.builders["mpl"]
        return next(iter(self.builders.values()), None)

    @property
    def backend_names(self) -> tuple[str, ...]:
        return tuple(sorted(self.builders))

    def builder_for(self, backend: str) -> Builder | None:
        return self.builders.get(backend)

    @property
    def browser_native(self) -> bool:
        """已废弃：D33 后全部走 matplotlib，保留该属性只为兼容旧调用。"""
        return self.interactive

    def validate(self) -> "LayerSpec":
        if not self.kind:
            raise ValueError("kind 不能为空")
        if self.dimension not in (2, 3):
            raise ValueError(f"dimension 必须是 2 或 3，收到 {self.dimension}")
        if isinstance(self.passthrough, str):
            raise ValueError("passthrough 不能是裸字符串")
        for name, fn in self.builders.items():
            if not isinstance(name, str) or not name:
                raise ValueError(f"{self.kind}: builder 后端名必须是非空字符串")
            if not callable(fn):
                raise ValueError(f"{self.kind}: builder[{name}] 不可调用")
        return self

    def as_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "dimension": self.dimension,
            "aliases": list(self.aliases),
            "passthrough": list(self.passthrough),
            "description": self.description,
            "interactive": self.interactive,
            "has_builder": self.builder is not None,
            "backends": list(self.backend_names),
        }


# 全局注册表（原地更新，保证 `from plotkit.backends.registry import LAYER_SPECS` 引用一直有效）
LAYER_SPECS: dict[str, LayerSpec] = {}
ALIASES: dict[str, str] = {}


def register(
    kind: str,
    dimension: int,
    builder: Builder | None = None,
    *,
    builders: Mapping[str, Builder] | None = None,
    defaults: Mapping[str, Any] | None = None,
    passthrough: Sequence[str] = (),
    aliases: Sequence[str] = (),
    description: str = "",
    interactive: bool = True,
    overwrite: bool = False,
) -> LayerSpec:
    """注册一个图层类型。

    `builder` 是 matplotlib 的 builder（历史写法，等价于 `builders={"mpl": builder}`）；
    多后端时用 `builders={"mpl": f1, "pyvista": f2}`。同一个 kind 可以只支持部分后端。
    """
    if kind in LAYER_SPECS and not overwrite:
        raise ValueError(f"kind 已注册: {kind}（要覆盖请传 overwrite=True）")
    table: dict[str, Builder] = dict(builders or {})
    if builder is not None:
        table.setdefault("mpl", builder)
    spec = LayerSpec(
        kind=kind,
        dimension=dimension,
        builders=table,
        defaults=dict(defaults or {}),
        passthrough=tuple(passthrough),
        aliases=tuple(aliases),
        description=description,
        interactive=interactive,
    ).validate()
    LAYER_SPECS[kind] = spec
    for alias in spec.aliases:
        ALIASES[alias] = kind
    return spec


def resolve(kind: str) -> LayerSpec:
    real = ALIASES.get(kind, kind)
    if real not in LAYER_SPECS:
        raise KeyError(
            f"未注册的图层类型: {kind!r}（已注册: {', '.join(sorted(LAYER_SPECS))}）"
        )
    return LAYER_SPECS[real]


def attach_builder(
    kind: str, backend: str, builder: Builder, *, overwrite: bool = False
) -> LayerSpec:
    """给已注册的 kind 追加一个后端的 builder（可选后端在自己的模块里调用）。

    matplotlib 的 builder 在 mpl_backend 里一次性注册；pyvista 等可选后端被 import 时
    再把自己的能力挂上来——这样没装 pyvista 的机器上注册表里就没有 pyvista 能力，
    `dispatch.choose()` 会据此判断"不支持"而不是等到渲染中途才炸。
    """
    from dataclasses import replace

    real = ALIASES.get(kind, kind)
    spec = LAYER_SPECS.get(real)
    if spec is None:
        raise KeyError(f"未注册的图层类型: {kind!r}")
    if backend in spec.builders and not overwrite:
        raise ValueError(
            f"{real}: 后端 {backend} 已注册 builder（要覆盖请传 overwrite=True）"
        )
    table = dict(spec.builders)
    table[backend] = builder
    new_spec = replace(spec, builders=table).validate()
    LAYER_SPECS[real] = new_spec
    return new_spec


def known_kind_names() -> set[str]:
    """合法 kind 名 = 注册名 + 别名（spec 里两种写法都允许，渲染时统一 resolve）。"""
    return set(LAYER_SPECS) | set(ALIASES)


def kinds() -> tuple[str, ...]:
    return tuple(sorted(LAYER_SPECS))


def describe() -> list[dict[str, Any]]:
    return [LAYER_SPECS[k].as_dict() for k in sorted(LAYER_SPECS)]
