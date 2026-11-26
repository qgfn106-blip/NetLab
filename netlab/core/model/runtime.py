"""Runtime：由 CompiledModel 创建、拥有独立生命周期与状态的执行层。

Runtime 不附着在 Model / CompiledModel 上；每个实例从 CompiledModel 的编译
字段重建自己的 Scene、Engine、时间步、缓存和运行态，绝不共享活 Scene 的
NodeRecord 字典。可选 initial_state 只作为普通字典复制进来。
"""
from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any, Mapping

from .instance_model import (
    FrozenMapping,
    NodeRuntime,
    deep_freeze,
    deep_thaw,
    stable_fingerprint,
)

SNAPSHOT_VERSION = "runtime-snapshot/1.0"


def _clone_block_instances(block_instances: Mapping[str, Any]) -> dict[str, Any]:
    """复制块实例：优先调用 BlockRuntime.clone，普通值退回 deepcopy。"""
    cloned: dict[str, Any] = {}
    for key, value in dict(block_instances).items():
        clone = getattr(value, "clone", None)
        cloned[key] = clone() if callable(clone) else copy.deepcopy(value)
    return cloned


@dataclass(frozen=True)
class RuntimeSnapshot:
    """显式运行态快照：带模型/编译指纹、版本与校验和。"""

    version: str
    mode: str
    model_fingerprint: str
    compiled_fingerprint: str
    generation: int
    state: FrozenMapping
    checksum: str = ""

    def __post_init__(self) -> None:
        object.__setattr__(self, "state", deep_freeze(self.state))
        if not self.checksum:
            object.__setattr__(self, "checksum", self._calculated_checksum())

    def to_payload(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "mode": self.mode,
            "model_fingerprint": self.model_fingerprint,
            "compiled_fingerprint": self.compiled_fingerprint,
            "generation": self.generation,
            "state": deep_thaw(self.state),
            "checksum": self.checksum,
        }

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "RuntimeSnapshot":
        from ..common.limits import ValidationError

        if not isinstance(payload, Mapping):
            raise TypeError("RuntimeSnapshot.from_payload 需要 Mapping")
        checksum = payload.get("checksum")
        if not isinstance(checksum, str) or not checksum:
            raise ValidationError("RuntimeSnapshot 缺少校验和 checksum，拒绝加载")
        if "version" not in payload or not str(payload.get("version") or ""):
            raise ValidationError("RuntimeSnapshot 缺少版本 version，拒绝加载")
        state = payload.get("state", {})
        if not isinstance(state, Mapping):
            raise ValidationError("RuntimeSnapshot.state 必须是 Mapping")
        return cls(
            version=str(payload["version"]),
            mode=str(payload.get("mode", "")),
            model_fingerprint=str(payload.get("model_fingerprint", "")),
            compiled_fingerprint=str(payload.get("compiled_fingerprint", "")),
            generation=int(payload.get("generation", 0) or 0),
            state=deep_freeze(state),
            checksum=checksum,
        )

    def _calculated_checksum(self) -> str:
        return stable_fingerprint(
            {
                "version": self.version,
                "mode": self.mode,
                "model_fingerprint": self.model_fingerprint,
                "compiled_fingerprint": self.compiled_fingerprint,
                "generation": self.generation,
                "state": deep_thaw(self.state),
            }
        )

    def verify(self, *, model_fingerprint: str, compiled_fingerprint: str, mode: str) -> None:
        from ..common.limits import ValidationError

        if self.version != SNAPSHOT_VERSION:
            raise ValidationError(
                f"RuntimeSnapshot 版本不兼容：{self.version!r}，期望 {SNAPSHOT_VERSION!r}"
            )
        if not self.checksum or self.checksum != self._calculated_checksum():
            raise ValidationError("RuntimeSnapshot 校验和无效，快照可能被篡改或损坏")
        if self.model_fingerprint != model_fingerprint:
            raise ValidationError("RuntimeSnapshot 的 Model 指纹与当前模型不匹配")
        if self.compiled_fingerprint != compiled_fingerprint:
            raise ValidationError("RuntimeSnapshot 的 CompiledModel 指纹与当前编译结果不匹配")
        if self.mode != mode:
            raise ValidationError("RuntimeSnapshot 的模式与当前运行时不一致")


class Runtime:
    """CompiledModel 的执行实例；独立状态、独立生命周期。"""

    def __init__(
        self,
        compiled: Any,
        *,
        initial_state: Mapping[str, Any] | None = None,
        block_instances: Any = None,
        solver_options: Any = None,
    ) -> None:
        self._compiled = compiled
        self._disposed = False
        self._generation = 0
        self._last_stats: dict[str, Any] = {}
        self._state_dirty = False

        import importlib

        scene_cls = importlib.import_module(".scene", __package__).Scene
        scene = scene_cls(str(compiled.mode))
        scene.load_payload(compiled.execution_payload())
        scene.solver_options = solver_options
        self._scene = scene
        if block_instances is not None:
            # 调用方映射可能同时交给多个 Runtime；逐块克隆确保内部状态隔离。
            self._scene.block_instances = _clone_block_instances(block_instances)

        self._component_states: dict[str, NodeRuntime] = {
            node.id: NodeRuntime() for node in compiled.nodes
        }
        # 有初始状态（含 EngineAssembly 从活 Scene 提取的快照）时不要首次
        # step 再 reset，否则会清掉调用方预置的输入/状态。
        self._initialized = initial_state is not None
        if initial_state is not None:
            self.import_component_state(initial_state)

        create_engine = importlib.import_module(
            ".engine_registry", __package__
        ).create_engine
        self._engine = create_engine(compiled.mode, self._scene)

    # ---- 基本属性 ---------------------------------------------------------
    @property
    def compiled(self) -> Any:
        return self._compiled

    @property
    def model_fingerprint(self) -> str:
        return self._compiled.model_fingerprint

    @property
    def compiled_fingerprint(self) -> str:
        return self._compiled.fingerprint

    @property
    def scene(self) -> Any:
        return self._scene

    @property
    def engine(self) -> Any:
        return self._engine

    @property
    def generation(self) -> int:
        return self._generation

    @property
    def disposed(self) -> bool:
        return self._disposed

    # ---- 组件运行态 -------------------------------------------------------
    def _sync_component_states(self, checkpoint: Mapping[str, Any] | None = None) -> None:
        if checkpoint is None and not self._state_dirty:
            return
        if checkpoint is None:
            checkpoint = self._engine.capture_checkpoint()
        nodes = checkpoint.get("nodes", {}) if isinstance(checkpoint, Mapping) else {}
        if isinstance(nodes, Mapping):
            for node_id, values in nodes.items():
                if not isinstance(values, Mapping):
                    continue
                self._component_states[str(node_id)] = NodeRuntime(
                    state=values.get("state") or {},
                    inputs=values.get("inputs") or {},
                )
        self._state_dirty = False

    def component_state(self, node_id: str) -> dict[str, Any]:
        """返回单个节点的持久运行态快照（state/inputs 深拷贝）。"""
        self._ensure_alive()
        if node_id not in self._component_states:
            raise KeyError(f"未知节点：{node_id}")
        self._sync_component_states()
        return self._component_states[node_id].snapshot()

    @property
    def component_states(self) -> dict[str, dict[str, Any]]:
        """所有节点的运行态快照，供 UI/诊断读取。"""
        self._ensure_alive()
        self._sync_component_states()
        return {node_id: runtime.snapshot() for node_id, runtime in self._component_states.items()}

    def import_component_state(self, payload: Mapping[str, Any] | None) -> None:
        """把普通字典形式的节点/边/时钟状态复制到本运行时。"""
        if not payload:
            return
        if not isinstance(payload, Mapping):
            raise TypeError("Runtime.import_component_state 需要 Mapping")
        nodes = payload.get("nodes") or {}
        if isinstance(nodes, Mapping):
            for node_id, values in nodes.items():
                record = self._scene.nodes.get(str(node_id))
                if record is None or not isinstance(values, Mapping):
                    continue
                data = values.get("data")
                if isinstance(data, Mapping):
                    record.data.clear()
                    record.data.update(copy.deepcopy(dict(data)))
                state = values.get("state")
                if isinstance(state, Mapping) and (state or not record.state):
                    record.state.clear()
                    record.state.update(copy.deepcopy(dict(state)))
                inputs = values.get("inputs")
                if isinstance(inputs, Mapping):
                    record.inputs.clear()
                    record.inputs.update(copy.deepcopy(dict(inputs)))
                runtime_state = self._component_states.get(str(node_id))
                if runtime_state is not None:
                    runtime_state.state = copy.deepcopy(record.state)
                    runtime_state.inputs = copy.deepcopy(record.inputs)
        edges = payload.get("edges") or {}
        if isinstance(edges, Mapping):
            for edge_id, values in edges.items():
                record = self._scene.edges.get(str(edge_id))
                if record is None or not isinstance(values, Mapping):
                    continue
                state = values.get("state")
                if isinstance(state, Mapping):
                    record.state.clear()
                    record.state.update(copy.deepcopy(dict(state)))
        time_value = payload.get("time")
        if isinstance(time_value, (int, float)) and not isinstance(time_value, bool):
            self._scene.clock.time = float(time_value)
        # 显式导入状态意味着调用方已提供可用初态，后续 step 不应再 reset。
        self._initialized = True

    def export_component_state(self) -> dict[str, Any]:
        """导出当前引擎运行态为普通字典（节点 data/state/inputs、边 state、时间）。"""
        self._ensure_alive()
        checkpoint = self._engine.capture_checkpoint()
        self._sync_component_states(checkpoint)
        nodes: dict[str, Any] = {}
        raw_nodes = checkpoint.get("nodes", {}) if isinstance(checkpoint, Mapping) else {}
        if isinstance(raw_nodes, Mapping):
            for node_id, values in raw_nodes.items():
                if not isinstance(values, Mapping):
                    continue
                record = self._scene.nodes.get(str(node_id))
                state_value = values.get("state")
                if record is not None and (not isinstance(state_value, Mapping) or (not state_value and record.state)):
                    state_value = record.state
                nodes[str(node_id)] = {
                    "data": copy.deepcopy(values.get("data") or {}),
                    "state": copy.deepcopy(state_value or {}),
                    "inputs": copy.deepcopy(values.get("inputs") or {}),
                }
        edges: dict[str, Any] = {}
        raw_edges = checkpoint.get("edges", {}) if isinstance(checkpoint, Mapping) else {}
        for edge_id, record in self._scene.edges.items():
            value = raw_edges.get(edge_id) if isinstance(raw_edges, Mapping) else None
            if isinstance(value, Mapping):
                state_value = value.get("state", value)
            else:
                state_value = record.state
            edges[str(edge_id)] = {"state": copy.deepcopy(state_value or {})}
        return {
            "nodes": nodes,
            "edges": edges,
            "time": float(self._scene.clock.time),
        }

    # ---- 生命周期 ---------------------------------------------------------
    def initialize(self) -> "Runtime":
        self._ensure_alive()
        if not self._initialized:
            initializer = getattr(self._engine, "initialize", None)
            if callable(initializer):
                initializer()
            else:
                reset = getattr(self._engine, "reset", None)
                if callable(reset):
                    reset()
            self._initialized = True
        return self

    def execute(self, dt: float | None = None, *, deadline: float | None = None) -> dict[str, Any]:
        return self.step(dt, deadline=deadline)

    def step(self, dt: float | None = None, *, deadline: float | None = None) -> dict[str, Any]:
        self._ensure_alive()
        if not self._initialized:
            self.initialize()
        step_dt = 1.0 if dt is None else float(dt)
        step_kwargs: dict[str, Any] = {}
        if deadline is not None:
            step_kwargs["deadline"] = deadline
        stats = self._engine.step(step_dt, **step_kwargs)
        self._generation += 1
        self._last_stats = copy.deepcopy(stats) if isinstance(stats, dict) else {}
        self._state_dirty = True
        return stats if isinstance(stats, dict) else {}

    def reset(self) -> None:
        self._ensure_alive()
        self._engine.reset()
        self._generation = 0
        self._initialized = True
        self._last_stats = {}
        self._state_dirty = True

    def zero_time(self) -> None:
        self._ensure_alive()
        self._engine.zero_time()
        self._state_dirty = True

    def capture_checkpoint(self) -> dict[str, Any]:
        self._ensure_alive()
        return copy.deepcopy(self._engine.capture_checkpoint())

    def snapshot(self) -> RuntimeSnapshot:
        self._ensure_alive()
        checkpoint = self._engine.capture_checkpoint()
        self._sync_component_states(checkpoint)
        state = {
            "engine": copy.deepcopy(checkpoint),
            "components": {node_id: runtime.snapshot() for node_id, runtime in self._component_states.items()},
            "clock": float(self._scene.clock.time),
        }
        return RuntimeSnapshot(
            version=SNAPSHOT_VERSION,
            mode=self._compiled.mode,
            model_fingerprint=self._compiled.model_fingerprint,
            compiled_fingerprint=self._compiled.fingerprint,
            generation=self._generation,
            state=deep_freeze(state),
        )

    def restore(self, snapshot: RuntimeSnapshot | Mapping[str, Any]) -> None:
        self._ensure_alive()
        if not isinstance(snapshot, RuntimeSnapshot):
            snapshot = RuntimeSnapshot.from_payload(snapshot)
        snapshot.verify(
            model_fingerprint=self._compiled.model_fingerprint,
            compiled_fingerprint=self._compiled.fingerprint,
            mode=self._compiled.mode,
        )
        payload = deep_thaw(snapshot.state)
        engine_state: Any = payload
        components: Any = None
        clock: Any = None
        if isinstance(payload, Mapping) and "engine" in payload:
            engine_state = payload.get("engine") or {}
            components = payload.get("components")
            clock = payload.get("clock")
        self._engine.restore_checkpoint(engine_state)
        checkpoint = self._engine.capture_checkpoint()
        # 先以引擎恢复后的节点状态为基线，再用快照中的组件覆盖，避免旧组件残留。
        self._sync_component_states(checkpoint)
        if isinstance(components, Mapping):
            for node_id, values in components.items():
                if not isinstance(values, Mapping):
                    continue
                self._component_states[str(node_id)] = NodeRuntime(
                    state=values.get("state") or {},
                    inputs=values.get("inputs") or {},
                )
        if isinstance(clock, (int, float)) and not isinstance(clock, bool):
            self._scene.clock.time = float(clock)
        self._generation = int(snapshot.generation)
        self._initialized = True
        self._state_dirty = False

    def dispose(self) -> None:
        if self._disposed:
            return
        dispose = getattr(self._engine, "dispose", None)
        if callable(dispose):
            dispose()
        self._disposed = True

    def stats(self) -> dict[str, Any]:
        callback = getattr(self._engine, "stats", None)
        value = callback() if callable(callback) else {}
        return copy.deepcopy(value) if isinstance(value, dict) else {}

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_"):
            raise AttributeError(name)
        if object.__getattribute__(self, "_disposed"):
            raise RuntimeError("Runtime 已释放，不能再访问引擎属性")
        engine = object.__getattribute__(self, "_engine")
        return getattr(engine, name)

    def _ensure_alive(self) -> None:
        if self._disposed:
            raise RuntimeError("Runtime 已释放，不能再执行操作")
