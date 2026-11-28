# 插件三层装配与 Engine SPI v2 可行性评估

> 状态：评估记录（2026-11-28）。本评估不修改插件三层相关生产代码；结论供 Engine SPI v2 设计评审与后续独立立项使用。
> 依据：`netlab/docs/ENGINE_SPI_V2.md`（Proposed，设计冻结草案，§边界明确“不写生产代码；不改 scene.py/scene_engines.py/engine_registry.py；Plugin 不能替换内建 Engine；不改 FEM”）。

## 1. 结论

当前插件模式确实完成了 **Model → compile → CompiledModel → create_runtime** 的调用链，但插件引擎始终被 `_PluginCompiledModel` / `_PluginRuntime` 适配器包住；当插件没有实现生命周期方法时，适配器退回旧插件协议。因此“插件三层”目前是**兼容层意义上的三层**，不是架构意义上的独立三层。

要实现真正的插件三层，需要先给插件增加**可声明、可验证的 native-lifecycle 契约**，并让 `assemble_engine()` 只在插件提供真实 `compile/create_runtime` 且返回独立对象时跳过适配器。该改动会触及 `engine_registry.py` 与插件 API 契约，超出本文件“设计冻结草案”的授权边界，故本轮只完成可行性评估，不直接改生产代码。

## 2. 现状链路与证据

### 2.1 统一入口

`netlab/core/model/engine_registry.py:148-179` 的 `assemble_engine()`：

- 内建模式（156-168 行）：`Model.from_scene(scene)` → `model.compile()` → `compiled.create_runtime(...)`，返回 `EngineAssembly(mode, model, compiled, runtime)`。
- 插件模式（169-179 行）：`create_engine(mode, scene)` 后：
  - `compile_fn = getattr(model, "compile", None)`，只有可调用才调用，否则 `compiled_target = model`；
  - `runtime_fn = getattr(model, "create_runtime", None)`，同样做能力探测；
  - 无论插件返回什么，最终都包成 `_PluginCompiledModel(compiled_target)` / `_PluginRuntime(runtime_target, runtime_engine)`。

### 2.2 插件适配器的边界

`netlab/core/model/engine_registry.py` 内的适配器只做兼容，不提供独立模型：

- `_PluginCompiledModel` 把插件结果包装成 `CompiledModel` 形状；
- `_PluginRuntime` 以委托方式转发 `step`/属性（116-145 行附近），并处理旧插件 `step(dt)` 与 `step(dt, deadline=...)` 的签名差异。

### 2.3 现有生命周期骨架

`netlab/core/model/scene_engines.py:85` 的 `_Engine` 已有：

- `validate`（137-169 行）：按 `EngineSpec` 的 kind 白名单产诊断；
- `compile`（171-175 行）：当前只把引擎自身包成 `CompiledModel(mode, engine=self)`；
- `create_runtime`（177-179 行）：当前直接返回引擎自身；
- `snapshot/restore/dispose`（181-223 行附近）：快照原语薄壳。

这些方法说明生命周期接口已具雏形，但 `compile`/`create_runtime` 仍是“引擎自身即模型/运行时”的占位实现，不能作为独立三层的证据。

### 2.4 场景侧消费

`netlab/core/model/scene.py:98-117` 在装配后会从 `assembly.runtime` 取 `engine` 与 `scene`，并把 `runtime_scene.block_instances` 挂回场景。因此若插件 native runtime 不是独立对象、或没有稳定的 `engine`/`scene` 暴露，场景侧会退回旧语义。

## 3. 差距矩阵

| 能力 | 内建引擎 | 当前插件引擎 | 真正三层所需 |
| --- | --- | --- | --- |
| model 对象 | `Model` 独立编译 | 插件对象，可能无生命周期 | 独立、可指纹化、不可变描述 |
| compiled 对象 | `CompiledModel` 承载优化结果 | `_PluginCompiledModel` 包装原对象 | 插件真正 `compile()` 产出独立编译产物 |
| runtime 对象 | `Runtime` 独立场景/块实例 | `_PluginRuntime` 委托插件对象 | 插件 `create_runtime(compiled)` 返回独立运行时 |
| 状态隔离 | Runtime 复制 Scene/BlockRuntime | 取决于插件自身 | 插件 runtime 拥有自己的状态，不复用 model |
| 快照 | checksum + model fingerprint | 由适配器转调 | runtime 实现 snapshot/restore |
| 兼容旧插件 | 不适用 | 已有探测 + 适配器 | 保留 fallback，不破坏旧插件 |

## 4. 可选方案

### 方案 A：给 EngineSpec 增加 native_lifecycle 开关（v1 加法式）

- 在 `netlab/plugin_api/v1/__init__.py` 的 `EngineSpec` 增加 `native_lifecycle: bool = False`（或等价的 `capabilities` 映射），默认关闭，旧插件零行为变化。
- 插件在 `EngineSpec` 显式声明后，必须实现：
  - `compile()` 返回插件 API 的 `CompiledModel`（含独立编译产物，而非 `engine=self`）；
  - `create_runtime(compiled)` 返回独立 runtime 对象，需暴露 `step`、`scene`、`engine`（或稳定适配属性）、`capture_checkpoint`、`restore_checkpoint`；
  - `validate()` 返回 `Diagnostic` 序列。
- `assemble_engine()` 在 `native_lifecycle is True` 且返回对象通过类型/契约检查时直接返回 `EngineAssembly(mode, model, compiled, runtime)`，否则保持现有适配器。
- 优点：改动局部、可灰度；缺点：把 v1 的语义扩成两种模式，契约仍依赖鸭子类型，容易“声明了但实现不完整”。

### 方案 B：新增 SPI v2 native-lifecycle 协议（推荐）

- 保留 v1 现有 `EngineSpec` 与适配器不动；在 `plugin_api` 新增 v2 命名空间/协议，定义明确的 `PluginModel`、`PluginCompiledModel`、`PluginRuntime` 协议与版本号。
- `EngineSpec.version` 提升到 v2 的插件才可选择 native lifecycle；注册表在注册时校验插件是否实现完整生命周期，缺项直接拒绝注册。
- `assemble_engine()`：v2 原生插件走真实链路；v1 插件继续走 `_PluginCompiledModel` / `_PluginRuntime`。
- 优点：契约清晰、可测试、可回滚；缺点：改动面比 A 大，需要设计评审、迁移指南和插件作者适配。

### 方案 C：维持现状，只记录限制

- 不新增契约，继续以适配器保证旧插件可用；在文档与验收报告中明确“插件三层是兼容适配，不是独立三层”。
- 优点：零风险；缺点：插件无法获得真正的模型/运行时分离，也无法承诺插件 runtime 的状态隔离。

**建议**：采用方案 B，分两阶段实施：先设计评审与协议草案（不改生产代码），评审通过后以独立 PR 实现 v2 协议与注册表能力校验，最后迁移示例插件并补契约测试。方案 A 可作为临时过渡，但不建议长期保留双语义。

## 5. 验收与测试计划（方案 B 实施时）

1. 注册期契约测试：v2 插件缺 `compile`/`create_runtime` 必须在 `register_engine` 阶段报错；v1 插件注册行为不变。
2. 装配测试：v2 插件 `assemble_engine()` 返回的 `compiled`/`runtime` 与插件内部对象身份符合契约，且不经过 `_PluginCompiledModel`/`_PluginRuntime`。
3. 状态隔离测试：同一 model 创建两个 runtime，分别 step 后 `probes()` 互不影响。
4. 快照测试：v2 runtime `snapshot/restore` 往返后状态一致；模型指纹变化时拒绝恢复。
5. 兼容测试：现有 v1 插件（含旧 `step(dt)` 签名）全部回归通过。
6. 架构门：`check_architecture` A1/A2/A3/A6/A7 无新增违规。

## 6. 风险与回滚

- **风险**：v2 插件若声明 native lifecycle 但 runtime 不是独立对象，会重现“名义三层”；必须在注册期与装配期双重校验。
- **风险**：插件 runtime 的 `scene` 生命周期若与 Scene 持有的 `block_instances` 不一致，会引入跨 runtime 共享状态；需要在契约中明确所有权。
- **回滚**：保留 v1 适配器路径；v2 注册字段默认关闭，出现回归可整体禁用 v2 路径而不影响旧插件。

## 7. 本轮边界与遗留

- 本轮插件三层改造不修改 `netlab/core/model/scene.py`、`scene_engines.py`、`engine_registry.py` 或 `netlab/plugin_api/v1` 的生产实现；原因是 `ENGINE_SPI_V2.md` 仍为 Proposed 设计冻结草案，未获实施授权。
- 当前插件兼容性由 `netlab/tests/test_p1s2_engine_spi_v2.py`、`test_p1s2_engine_spi_v2_slice2.py` 和 `test_p1_1_plugin_mode_loading.py` 覆盖；后续 v2 实施应在此基础上增加 native-lifecycle 契约测试。
- 结论：插件“真正三层”需要独立设计评审与实施 PR；在此之前，最终验收报告应如实标注为“engine-only SPI v1 兼容适配层”，不得标为已完成。
