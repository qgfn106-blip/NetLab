"""插件自定义求解引擎注册表（R40）。

现有 ``signal`` / ``circuit`` / ``vector`` 引擎不替换；插件只能注册**新 mode**。
内建与插件引擎统一经 :func:`create_engine` 创建（阶段 8 · P1-S2 G7）。
"""

from __future__ import annotations

from typing import Any

from ...plugin_api.v1 import EngineSpec
from ..common.limits import ValidationError

ENGINE_SPECS: dict[str, EngineSpec] = {}
ENGINE_OWNERS: dict[str, str] = {}

# 内建模式与 `scene_types.MODES` 必须一致：模块级 import 会形成
# engine_registry <-> scene_types 环（A2 架构契约禁止），故此处保留副本，
# 并由 `test_builtin_modes_matches_scene_types` 锁死二者不漂移。
BUILTIN_MODES: tuple[str, ...] = ("signal", "circuit", "vector")


def is_builtin_mode(mode: str) -> bool:
    return mode in BUILTIN_MODES


def register_engine(spec: EngineSpec, *, plugin_id: str = "") -> EngineSpec:
    if spec.mode in BUILTIN_MODES:
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


def _builtin_factory(mode: str) -> Any:
    if mode == "circuit":
        from .scene_engines import CircuitEngine

        return CircuitEngine
    if mode in ("signal", "vector"):
        from .scene_engines import SignalEngine

        return SignalEngine
    return None


def create_engine(mode: str, scene: Any) -> Any:
    """内建与插件引擎的统一创建入口（G7）。"""
    spec = ENGINE_SPECS.get(mode)
    if spec is not None:
        engine = spec.factory(scene)
        if engine is None:
            raise RuntimeError(f"引擎工厂没有返回实例：{mode}")
        return engine
    if not is_builtin_mode(mode):
        raise KeyError(f"未知引擎模式：{mode}")
    factory = _builtin_factory(mode)
    if factory is None:  # 防御：BUILTIN_MODES 与工厂映射不一致
        raise KeyError(f"未知引擎模式：{mode}")
    return factory(scene)


def allowed_kinds(mode: str, *, edge: bool = False) -> tuple[str, ...] | None:
    """插件模式声明的节点/连接类型白名单；内置模式或未声明返回 ``None``（不限制）。"""
    spec = ENGINE_SPECS.get(mode)
    if spec is None:
        return None
    return spec.edge_kinds if edge else spec.node_kinds


def validate_kind(mode: str, kind: str, *, edge: bool = False) -> None:
    """插件模式若声明类型白名单，则校验 ``kind`` 是否被允许（G2）。"""
    allowed = allowed_kinds(mode, edge=edge)
    if not allowed:
        return
    if kind not in allowed:
        what = "连接" if edge else "节点"
        raise ValidationError(f"引擎模式 {mode!r} 不支持{what}类型 {kind!r}")


def engine_catalog() -> list[dict[str, Any]]:
    return [
        {
            "mode": spec.mode,
            "label": spec.label,
            "description": spec.description,
            "domain": spec.domain,
            "version": spec.version,
            # 归属双通道：register_engine(plugin_id=...) 记在 ENGINE_OWNERS，
            # spec.plugin_id 为 frozen dataclass 默认空；以 OWNERS 回退保证一致。
            "plugin_id": spec.plugin_id or ENGINE_OWNERS.get(spec.mode, ""),
            "node_kinds": list(spec.node_kinds),
            "edge_kinds": list(spec.edge_kinds),
            "supported_port_types": list(spec.supported_port_types),
        }
        for spec in ENGINE_SPECS.values()
    ]
