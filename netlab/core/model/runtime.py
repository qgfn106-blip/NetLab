"""Runtime：由 CompiledModel 创建、拥有独立生命周期与状态的执行层。

Runtime 不附着在 Model / CompiledModel 上；每个实例持有自己的 Scene、Engine、
时间步、缓存和运行态。支持 initialize / execute / step / reset / snapshot / restore /
dispose，多实例之间完全隔离。
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any, Mapping

from .instance_model import (
    FrozenMapping,
    deep_freeze,
    deep_thaw,
    stable_fingerprint,
)

SNAPSHOT_VERSION = "runtime-snapshot/1.0"


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
            object.__setattr__(
                self,
                "checksum",
                stable_fingerprint(
                    {
                        "version": self.version,
                        "mode": self.mode,
                        "model_fingerprint": self.model_fingerprint,
                        "compiled_fingerprint": self.compiled_fingerprint,
                        "generation": self.generation,
                        "state": deep_thaw(self.state),
                    }
                ),
            )

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
        if not isinstance(payload, Mapping):
            raise TypeError("RuntimeSnapshot.from_payload 需要 Mapping")
        return cls(
            version=str(payload.get("version", SNAPSHOT_VERSION)),
            mode=str(payload.get("mode", "")),
            model_fingerprint=str(payload.get("model_fingerprint", "")),
            compiled_fingerprint=str(payload.get("compiled_fingerprint", "")),
            generation=int(payload.get("generation", 0) or 0),
            state=deep_freeze(payload.get("state") or {}),
            checksum=str(payload.get("checksum", "")),
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
        if self.checksum and self.checksum != self._calculated_checksum():
            raise ValidationError("RuntimeSnapshot 校验和无效，快照可能被篡改或损坏")
        if self.model_fingerprint != model_fingerprint:
            raise ValidationError("RuntimeSnapshot 的 Model 指纹与当前模型不匹配")
        if self.compiled_fingerprint != compiled_fingerprint:
            raise ValidationError("RuntimeSnapshot 的 CompiledModel 指纹与当前编译结果不匹配")
        if self.mode != mode:
            raise ValidationError("RuntimeSnapshot 的模式与当前运行时不一致")


class Runtime:
    """CompiledModel 的执行实例；独立状态、独立生命周期。"""

    def __init__(self, compiled: Any, *, scene: Any = None, block_instances: Any = None) -> None:
        self._compiled = compiled
        self._disposed = False
        # 引擎由活场景构造时已完成初始化；首次 step 若再 reset 会清掉
        # 调用方（如 BlockRuntime）预置的输入数据。从编译产物新建的独立
        # Runtime 则显式走 initialize()，保证生命周期语义完整。
        self._initialized = scene is not None
        self._generation = 0
        self._last_stats: dict[str, Any] = {}
        if scene is None:
            import importlib

            scene_cls = importlib.import_module(".scene", __package__).Scene
            payload = compiled.to_payload()
            scene = scene_cls(str(payload.get("mode", compiled.mode)))
            scene.load_payload(payload)
        self._scene = scene
        if block_instances is not None:
            self._scene.block_instances = block_instances
        import importlib

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
        step_kwargs: dict[str, Any] = {}
        if deadline is not None:
            step_kwargs["deadline"] = deadline
        if dt is None:
            stats = self._engine.step(**step_kwargs)
        else:
            stats = self._engine.step(float(dt), **step_kwargs)
        self._generation += 1
        self._last_stats = copy.deepcopy(stats)
        return stats if isinstance(stats, dict) else {}

    def reset(self) -> None:
        self._ensure_alive()
        self._engine.reset()
        self._generation = 0
        self._initialized = True
        self._last_stats = {}

    def zero_time(self) -> None:
        self._ensure_alive()
        self._engine.zero_time()

    def capture_checkpoint(self) -> dict[str, Any]:
        return copy.deepcopy(self._engine.capture_checkpoint())

    def snapshot(self) -> RuntimeSnapshot:
        self._ensure_alive()
        return RuntimeSnapshot(
            version=SNAPSHOT_VERSION,
            mode=self._compiled.mode,
            model_fingerprint=self._compiled.model_fingerprint,
            compiled_fingerprint=self._compiled.fingerprint,
            generation=self._generation,
            state=deep_freeze(self._engine.capture_checkpoint()),
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
        self._engine.restore_checkpoint(deep_thaw(snapshot.state))
        self._generation = int(snapshot.generation)
        self._initialized = True

    def dispose(self) -> None:
        if self._disposed:
            return
        dispose = getattr(self._engine, "dispose", None)
        if callable(dispose):
            dispose()
        self._disposed = True

    # ---- 旧引擎接口转发 ---------------------------------------------------
    def probes(self, *args: Any, **kwargs: Any) -> Any:
        self._ensure_alive()
        return self._engine.probes(*args, **kwargs)

    def stats(self) -> dict[str, Any]:
        self._ensure_alive()
        result = self._engine.stats()
        return result if isinstance(result, dict) else {}

    def operating_point(self) -> Any:
        self._ensure_alive()
        return self._engine.operating_point()

    def ac_sweep(self, *args: Any, **kwargs: Any) -> Any:
        self._ensure_alive()
        return self._engine.ac_sweep(*args, **kwargs)

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_"):
            raise AttributeError(name)
        if self.__dict__.get("_disposed", False):
            raise RuntimeError("Runtime 已释放")
        return getattr(self._engine, name)

    def _ensure_alive(self) -> None:
        if self._disposed:
            raise RuntimeError("Runtime 已释放")
