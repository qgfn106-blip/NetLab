"""插件自定义求解引擎注册表（R40）。

现有 ``signal`` / ``circuit`` / ``vector`` 引擎不替换；插件只能注册**新 mode**。
内建与插件引擎统一经 :func:`create_engine` 创建（阶段 8 · P1-S2 G7）。
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass
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
        try:
            engine.spec = spec  # 让 validate() 直接取到白名单，无需再查注册表
        except AttributeError:  # 引擎使用 __slots__ 时忽略
            pass
        return engine
    if not is_builtin_mode(mode):
        raise KeyError(f"未知引擎模式：{mode}")
    factory = _builtin_factory(mode)
    if factory is None:  # 防御：BUILTIN_MODES 与工厂映射不一致
        raise KeyError(f"未知引擎模式：{mode}")
    return factory(scene)


@dataclass(frozen=True, slots=True)
class EngineAssembly:
    """一次显式装配的三个稳定阶段：Model → CompiledModel → Runtime。

    内建模式的 model/compiled/runtime 是三个不同类型、不同身份的实例：
    model 是不可变描述，compiled 是独立编译产物，runtime 是执行实例。
    插件若未实现新生命周期方法，则用轻量适配器保证三层身份仍然不同；
    Scene.ensure_engine() 通过 runtime.engine 仍返回插件真实引擎。
    """

    mode: str
    model: Any
    compiled: Any
    runtime: Any


def _accepts_keyword(func: Any, name: str) -> bool:
    """判断可调用对象是否接受指定关键字参数（含 **kwargs）。"""
    if not callable(func):
        return False
    try:
        parameters = inspect.signature(func).parameters.values()
    except (TypeError, ValueError):
        return False
    return any(
        parameter.kind is inspect.Parameter.VAR_KEYWORD or parameter.name == name
        for parameter in parameters
    )


class _PluginCompiledModel:
    """插件旧 SPI 的编译产物适配器：只负责暴露稳定身份与转发属性。"""

    def __init__(self, target: Any) -> None:
        self._target = target

    def __getattr__(self, name: str) -> Any:
        return getattr(self._target, name)


class _PluginRuntime:
    """插件旧 SPI 的运行时适配器：执行仍转发给插件对象。"""

    def __init__(self, target: Any, engine: Any) -> None:
        self._target = target
        self._engine = engine
        self._step_accepts_deadline = _accepts_keyword(
            getattr(target, "step", None), "deadline"
        )

    @property
    def engine(self) -> Any:
        return self._engine

    def step(self, dt: float, deadline: float | None = None) -> Any:
        """兼容旧插件 ``step(dt)``：仅在插件声明 deadline 时才转发。"""
        step = getattr(self._target, "step", None)
        if step is None:
            step = getattr(self._engine, "step")
        if deadline is not None and self._step_accepts_deadline:
            return step(dt, deadline=deadline)
        return step(dt)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._target, name)


def assemble_engine(
    mode: str, scene: Any, *, block_instances: Any = None
) -> EngineAssembly:
    """内建模式走 Model → compile → CompiledModel → create_runtime 的真实链路。

    插件若未实现生命周期方法，则用适配器保持旧插件可用；不允许
    create_runtime 返回 None 后静默空转。
    """
    if is_builtin_mode(mode):
        from .compiled_model import _scene_initial_state
        from .model import Model

        model = Model.from_scene(scene)
        compiled = model.compile()
        # 只把普通字典快照交给 Runtime；Runtime 自己重建独立 Scene/Engine。
        runtime = compiled.create_runtime(
            initial_state=_scene_initial_state(scene),
            block_instances=block_instances,
            solver_options=getattr(scene, "solver_options", None),
        )
        return EngineAssembly(mode=mode, model=model, compiled=compiled, runtime=runtime)
    model = create_engine(mode, scene)
    compile_fn = getattr(model, "compile", None)
    compiled_target = compile_fn() if callable(compile_fn) else model
    runtime_fn = getattr(model, "create_runtime", None)
    runtime_target = runtime_fn(compiled_target) if callable(runtime_fn) else model
    if runtime_target is None:
        raise RuntimeError(f"引擎运行时为空：{mode}")
    compiled = _PluginCompiledModel(compiled_target)
    runtime_engine = getattr(runtime_target, "engine", model)
    runtime = _PluginRuntime(runtime_target, runtime_engine)
    return EngineAssembly(mode=mode, model=model, compiled=compiled, runtime=runtime)


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


# ---- G3 注册表作用域骨架（切片2）------------------------------------------
# 现状是进程级全局注册表；这里只提供"作用域快照 / 还原 / 复位"三件套，
# 供测试隔离与未来按 Project 作用域化使用，**不改变默认全局语义**。
def registry_snapshot() -> dict[str, EngineSpec]:
    """记录当前注册集作为作用域基线，并返回其副本。

    基线挂在函数属性上（而非模块级可变全局），以通过 A3「白名单外可变单例」检查。
    """
    registry_snapshot._baseline = dict(ENGINE_SPECS)  # type: ignore[attr-defined]
    registry_snapshot._baseline_owners = dict(ENGINE_OWNERS)  # type: ignore[attr-defined]
    return dict(ENGINE_SPECS)


def registry_restore(state: dict[str, EngineSpec]) -> None:
    """把注册集还原为给定快照（副本语义）。

    P1-05：同时原子恢复 ``ENGINE_SPECS`` 与 ``ENGINE_OWNERS``——owners 取
    ``registry_snapshot`` 时记录的基线中、且仍存在于本快照里的条目，避免
    「spec 还原了但 owner 残留」的脏状态。先构造副本再整体替换，保持原子性。
    """
    restored = dict(state)
    baseline_owners = getattr(registry_snapshot, "_baseline_owners", {}) or {}
    restored_owners = {k: v for k, v in baseline_owners.items() if k in restored}
    ENGINE_SPECS.clear()
    ENGINE_SPECS.update(restored)
    ENGINE_OWNERS.clear()
    ENGINE_OWNERS.update(restored_owners)


def reset_registry() -> None:
    """复位到最近一次 registry_snapshot() 的基线；无基线则清空。"""
    baseline = getattr(registry_snapshot, "_baseline", None)
    owners = getattr(registry_snapshot, "_baseline_owners", None)
    ENGINE_SPECS.clear()
    ENGINE_OWNERS.clear()
    if baseline:
        ENGINE_SPECS.update(baseline)
    if owners:
        ENGINE_OWNERS.update(owners)
