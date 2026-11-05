"""插件自定义求解引擎注册表（R40）。

现有 ``signal`` / ``circuit`` / ``vector`` 引擎不替换；插件只能注册**新 mode**。
Scene 在构造时会懒加载这里登记的工厂。
"""

from __future__ import annotations

from typing import Any

from ...plugin_api.v1 import EngineSpec


ENGINE_SPECS: dict[str, EngineSpec] = {}
ENGINE_OWNERS: dict[str, str] = {}


def register_engine(spec: EngineSpec, *, plugin_id: str = "") -> EngineSpec:
    if spec.mode in {"signal", "circuit", "vector"}:
        raise ValueError("不能替换内置模式 signal/circuit/vector")
    if spec.mode in ENGINE_SPECS:
        raise RuntimeError(f"重复注册引擎模式：{spec.mode}")
    ENGINE_SPECS[spec.mode] = spec
    if plugin_id:
        ENGINE_OWNERS[spec.mode] = plugin_id
    return spec


def unregister_engine(mode: str) -> None:
    ENGINE_SPECS.pop(mode, None)
    ENGINE_OWNERS.pop(mode, None)


def plugin_modes() -> tuple[str, ...]:
    return tuple(ENGINE_SPECS)


def create_engine(mode: str, scene: Any) -> Any:
    spec = ENGINE_SPECS.get(mode)
    if spec is None:
        raise KeyError(f"未知引擎模式：{mode}")
    engine = spec.factory(scene)
    if engine is None:
        raise RuntimeError(f"引擎工厂没有返回实例：{mode}")
    return engine


def engine_catalog() -> list[dict[str, Any]]:
    return [
        {
            "mode": spec.mode,
            "label": spec.label,
            "description": spec.description,
            "node_kinds": list(spec.node_kinds),
            "edge_kinds": list(spec.edge_kinds),
        }
        for spec in ENGINE_SPECS.values()
    ]
