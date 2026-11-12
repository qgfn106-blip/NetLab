# 核心接口契约设计冻结（阶段 4 / P1-A）

> 状态：`Proposed`（设计冻结草案，待评审）。本文给出**精确的 Python Protocol / ABC 方法签名、参数、返回、异常**，不是概念描述；所有代码块须 `ast.parse` 可解析。本文是目标设计口径，不是当前实现，也不是实施授权。
> 依据：`NETLAB_V2_PLANNING_REVIEW.md:100-108`（补 6 份文档第 4 份：精确方法签名）、`:132-136`（必须给出可执行 Python Protocol 签名）、`CORE_MODEL_V2.md` §4、`ENGINE_SPI_V2.md` §3。
> 边界：本文代码是**接口草案**，不导入、不注册、不执行；不写生产代码、不改冻结区、不改 FEM。

## 1. 异常层级

```python
from __future__ import annotations

class ModelError(Exception):
    """所有模型/引擎错误的基类。"""


class ModelValidationError(ModelError):
    """Description 结构或静态校验失败。"""


class UnitMismatchError(ModelValidationError):
    """端口单位/量纲不兼容，禁止隐式跨维度转换。"""


class CompilationError(ModelError):
    """编译失败，携带 Diagnostic 列表。"""


class EngineNotFoundError(ModelError):
    """未知 mode 或 EngineSpec 未注册。"""


class EngineStateError(ModelError):
    """生命周期状态不允许当前操作。"""


class SnapshotError(ModelError):
    """快照生成失败。"""


class SnapshotRestoreError(ModelError):
    """快照版本/世代不匹配或校验失败。"""


class NumericalError(ModelError):
    """步进数值失败，禁止静默回退。"""
```

## 2. 数据对象（frozen dataclass，见 CORE_MODEL_V2.md §4）

```python
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Sequence


@dataclass(frozen=True)
class Diagnostic:
    code: str
    message: str
    target: str = ""
    severity: str = "error"


@dataclass(frozen=True)
class CompiledModel:
    generation: str
    variables: tuple[str, ...]
    equations: tuple[str, ...]
    execution_plan: Mapping[str, Any]
    diagnostics: tuple[Diagnostic, ...] = ()
    sparse_structure: Mapping[str, Any] = field(default_factory=dict)
    cache_key_excludes: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "execution_plan", copy.deepcopy(dict(self.execution_plan)))
        object.__setattr__(self, "sparse_structure", copy.deepcopy(dict(self.sparse_structure)))


@dataclass(frozen=True)
class RuntimeSnapshot:
    version: int
    generation: str
    state: Mapping[str, Any]
    checksum: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "state", copy.deepcopy(dict(self.state)))


@dataclass(frozen=True)
class EngineSpec:
    mode: str
    domain: str
    version: int
    supported_node_kinds: tuple[str, ...] = ()
    supported_edge_kinds: tuple[str, ...] = ()
    supported_port_types: tuple[str, ...] = ()
    factory: Callable[["EngineSpec"], "Engine"] | None = None
    plugin_id: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "metadata", copy.deepcopy(dict(self.metadata)))
```

> 不可变契约（P1-02）：所有 `Mapping` 字段在构造时必须 `copy.deepcopy` 传入，禁止把外部可变容器直接挂进 `frozen` 对象；`test_stage4_document_contracts.py` 从本文 §2 代码块加载真实 dataclass，验证外部可变容器修改不污染快照、两个快照互不共享状态。

## 3. 精确 Protocol 签名

```python
from __future__ import annotations

from typing import Any, Callable, Mapping, Protocol, Sequence, runtime_checkable


@runtime_checkable
class UnitRegistry(Protocol):
    def compatible(self, left_unit: str, right_unit: str) -> bool:
        """量纲向量相等才返回 True。"""
        ...

    def convert(self, value: float, from_unit: str, to_unit: str) -> float:
        """显式换算；量纲不同抛 UnitMismatchError。"""
        ...

    def register(self, unit: str, dimension: tuple[int, int, int, int, int, int, int], scale: float) -> None:
        """注册单位；重复注册抛 ModelValidationError。"""
        ...


@runtime_checkable
class PortTypeRegistry(Protocol):
    def register(self, port_type: Any) -> None:
        """Plugin 注册 PortType；非法量纲抛 ModelValidationError。"""
        ...

    def resolve(self, domain: str, quantity: str) -> Any:
        """返回 PortType；未注册抛 EngineNotFoundError。"""
        ...

    def check_connection(self, source: Any, target: Any) -> None:
        """连接创建期快速静态检查；不兼容抛 UnitMismatchError。"""
        ...


@runtime_checkable
class SceneEdit(Protocol):
    def begin(self) -> str:
        """开启事务，返回 transaction id。"""
        ...

    def apply(self, op: str, payload: Mapping[str, Any]) -> None:
        """在事务中应用一次编辑；失败抛 ModelValidationError。"""
        ...

    def commit(self) -> SceneDesc:
        """提交，返回新 SceneDesc 与 revision；外观编辑只增 revision。"""
        ...

    def rollback(self, transaction_id: str) -> None:
        """回滚事务，Desc 恢复，Runtime 不受影响。"""
        ...


@runtime_checkable
class Runtime(Protocol):
    def step(self, dt: float) -> Mapping[str, float]:
        """推进一步；数值失败抛 NumericalError，不静默回退。"""
        ...

    def reset(self) -> None:
        """重置运行态，幂等，不改 Desc。"""
        ...

    def zero_time(self) -> None:
        """时间归零。"""
        ...

    def probes(self) -> Mapping[str, float]:
        """返回当前探针值。"""
        ...

    def stats(self) -> Mapping[str, Any]:
        """返回步数/耗时/求解器统计。"""
        ...


@runtime_checkable
class Engine(Protocol):
    def validate(self, desc: Any) -> Sequence[Diagnostic]:
        """静态校验；返回诊断列表，致命错误抛 ModelValidationError。"""
        ...

    def compile(self, desc: Any) -> CompiledModel:
        """编译；失败抛 CompilationError 并携带诊断。"""
        ...

    def create_runtime(self, compiled: CompiledModel) -> Runtime:
        """由 Engine 创建 Runtime；状态不对抛 EngineStateError。"""
        ...

    def snapshot(self, runtime: Runtime) -> RuntimeSnapshot:
        """由 Engine 生成快照；失败抛 SnapshotError。"""
        ...

    def restore(self, runtime: Runtime, snap: RuntimeSnapshot) -> None:
        """版本/世代不匹配抛 SnapshotRestoreError。"""
        ...

    def dispose(self, runtime: Runtime) -> None:
        """销毁 Runtime，幂等；Desc 与 CompiledModel 保留。"""
        ...


@runtime_checkable
class PluginFacade(Protocol):
    def register_port_type(self, port_type: Any) -> None:
        ...

    def register_node_kind(self, kind: str, spec: Mapping[str, Any]) -> None:
        ...

    def register_edge_kind(self, kind: str, spec: Mapping[str, Any]) -> None:
        ...

    def read_compiled_summary(self) -> Mapping[str, Any]:
        """只读编译摘要（变量/方程/计划摘要），不含运行态。"""
        ...

    def register_analysis_spec(self, spec: Any) -> None:
        ...

    def register_data_format(self, spec: Any) -> None:
        ...

    def register_panel(self, spec: Any) -> None:
        ...

    def register_visual(self, spec: Any) -> None:
        ...

    def register_template(self, spec: Any) -> None:
        ...

    def register_engine_spec(self, spec: Any) -> None:
        ...

    def read_probe(self, name: str) -> float:
        ...

    def write_parameter(self, name: str, value: float) -> None:
        """仅白名单且 writable 的 Parameter；否则抛 ModelValidationError。"""
        ...


@runtime_checkable
class RuntimeManager(Protocol):
    def create(self, spec: EngineSpec, desc: Any) -> Runtime:
        """依次 validate / compile / create_runtime；create_runtime 必须通过 spec.factory 创建 Engine 实例。"""
        ...

    def snapshot(self, runtime: Runtime) -> bytes:
        ...

    def restore(self, blob: bytes) -> Runtime:
        ...

    def destroy(self, runtime: Runtime) -> None:
        ...
```

## 4. ABC 版本（需要强制实现时用）

```python
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Mapping, Sequence


class EngineBase(ABC):
    @abstractmethod
    def validate(self, desc: Any) -> Sequence[Diagnostic]:
        ...

    @abstractmethod
    def compile(self, desc: Any) -> CompiledModel:
        ...

    @abstractmethod
    def create_runtime(self, compiled: CompiledModel) -> Runtime:
        ...

    @abstractmethod
    def snapshot(self, runtime: Runtime) -> RuntimeSnapshot:
        ...

    @abstractmethod
    def restore(self, runtime: Runtime, snap: RuntimeSnapshot) -> None:
        ...

    @abstractmethod
    def dispose(self, runtime: Runtime) -> None:
        ...
```

## 5. 签名总表（供评审核对）

| 接口 | 方法 | 参数 | 返回 | 异常 |
| --- | --- | --- | --- | --- |
| `UnitRegistry` | `compatible` | `left_unit, right_unit` | `bool` | — |
| `UnitRegistry` | `convert` | `value, from_unit, to_unit` | `float` | `UnitMismatchError` |
| `UnitRegistry` | `register` | `unit, dimension, scale` | `None` | `ModelValidationError` |
| `SceneEdit` | `begin` | — | `str` | — |
| `SceneEdit` | `apply` | `op`, `payload` | `None` | `ModelValidationError` |
| `SceneEdit` | `commit` | — | `SceneDesc` | `ModelValidationError` |
| `SceneEdit` | `rollback` | `transaction_id` | `None` | `ModelValidationError` |
| `Engine` | `validate` | `desc` | `Sequence[Diagnostic]` | `ModelValidationError` |
| `Engine` | `compile` | `desc` | `CompiledModel` | `CompilationError` |
| `Engine` | `create_runtime` | `compiled` | `Runtime` | `EngineStateError` |
| `Engine` | `snapshot` | `runtime` | `RuntimeSnapshot` | `SnapshotError` |
| `Engine` | `restore` | `runtime, snap` | `None` | `SnapshotRestoreError` |
| `Engine` | `dispose` | `runtime` | `None` | — |
| `Runtime` | `step` | `dt` | `Mapping[str, float]` | `NumericalError` |
| `PluginFacade` | `write_parameter` | `name, value` | `None` | `ModelValidationError` |
| `RuntimeManager` | `restore` | `blob` | `Runtime` | `SnapshotRestoreError` |

## 6. 与现状对照

现状 `netlab/core/model/scene_engines.py:61` 的 `_Engine` 只有 `step/reset/zero_time/probes/stats`；本文补 `validate/compile/create_runtime/snapshot/restore/dispose` 共 7 个方法。现状 `EngineProtocol.build` 从未调用（审计 §5）；本文明确 `compile` 是唯一编译入口。实施顺序见 `CORE_ARCHITECTURE_AUDIT.md:385` 的 P1-S2，阶段 4 只冻结签名不改代码。

三项「需用户决策」（`NETLAB_V2_PLANNING_REVIEW.md:136`）见 `MIGRATION_AND_COMPATIBILITY.md` §3、`ENGINE_LIFECYCLE.md` §6、`ARCHITECTURE_BOUNDARIES.md` §6，均标 `PENDING_USER_AUTHORIZATION`，本阶段不裁定。
