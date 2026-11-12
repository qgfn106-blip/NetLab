# 阶段 4 P1-A 第④轮独立评审记录

> 状态：`Proposed`。评审方：独立只读评审 Agent（subagent `13d009cb-9870-4103-8480-d5eabbbebeb0`），2026-11-12。评审对象：九份设计文档、V1 关键源码、`tools/check_stage4_docs.py`、`netlab/tests/test_stage4_document_contracts.py`。评审方只读，未修改、提交或推送任何文件。

## 1. 结论（评审当时）

**不通过（第④轮）**。数学物理与 V1 代码对应全绿，但按「同名同字段同签名 / JSON 与 dataclass 一致 / 不存在方法·类型」三条硬标准，存在 4 个阻断级 P1 与 6 个次要 P2，以及 3 个验证工具问题。

## 2. 阻断级 P1（评审当时未修复）

- **A1 PortType/PortDesc 重复定义**：`CORE_MODEL_V2.md:66-87` 与 `MINIMAL_DATA_MODEL_EXAMPLE.md:90-112` 同名不同字段（CORE PortType 11 字段，MINIMAL 8 字段；PortDesc 字段/默认值不同）。
- **A2 SceneDesc 与示例不一致**：`SceneDesc` 缺 `id/domain/presentation/compat`，而 MINIMAL 与 MIGRATION 两个示例分别带不同封套字段。
- **A3 Edge JSON 自相矛盾**：`CORE_MODEL_V2.md:336` 示例使用 `type`，`:345` `validate_edge` 读取 `kind`，自带校验器拒绝自带示例。
- **A4 ports/initial_data 类型不一致**：`NodeDesc.ports: tuple[PortDesc,...]` 与示例 `["vin_p"]` 字符串列表不符；MIGRATION 引入的 `NodeDesc.initial_data` 在模型定义中不存在。

## 3. 次要 P2

- B1 boundary `value` 与 `BoundaryCondition.expression` 字段名/类型不符。
- B2 编译产物含 `cache_key_excludes`，但 `CompiledModel` 未定义该字段；缺 `diagnostics` 说明。
- B3 `PortDirection`、`NodeRuntime`、`ConnectionRuntime` 未定义（约 35 处引用）。
- B4 `PluginFacade` 注册能力面小于 `ENGINE_SPI_V2.md` §4 声明的 9 类。
- B5 `SceneEdit` §3 Protocol 与 §5 签名表不一致（缺 `apply`，`commit` 返回类型不一致）。
- B6 报告曾称测试使用「两个 Runtime 实例」，实际测试使用普通 dict。

## 4. 验证工具问题

- C1 `check_stage4_docs.py` 只做存在性子串检查，不比对字段，A1–A4/B1–B2 可逃逸仍判 PASS。
- C2 负例测试的 broken doc 未命中短路分支，短路逻辑未被覆盖。
- C3 `test_runtime_state_isolation` 仅测试普通 dict 的 `copy.deepcopy`，未实例化 frozen dataclass/Runtime。

## 5. 数学物理与代码对应（评审通过项）

- RC：`R=1000Ω, C=1µF ⇒ τ=1e-3s`；`v_out(τ)=0.6321205588V`；`i_R1=i_C1=3.678794e-4A`；KCL 自洽。
- 机械：`m=1kg, b=2N·s/m, F=0, v0=1 ⇒ v(0.5)=e^-1=0.3678794412m/s`；fixed 约束只固定参考地。
- 七维量纲 `[L,M,T,I,Θ,N,J]` 下 V/A/N/(m/s) 自洽；电学/机械/热学三域守恒方程正确。
- V1 代码位置 `graph.py:163/:290/:362`、`scene_engines.py:93-111`、`records.py:14/:81`、`project.py:829`、`scene_io.py:85` 与文档描述一致；`test_descriptor_rlc.py:174` 存在窄范围 parity 测试。

## 6. 整改状态

评审后已按最小放行清单修复 A1–A4、B1–B5、C1–C3（最新文档与校验工具见本目录），B6 表述已纠正；P1-02 的真实 Runtime 尚未实现，测试以代表性 frozen dataclass 验证深层复制契约。因修复发生在本次评审之后，需安排第④轮复评；复评通过前阶段 4 仍不得标正式验收完成。

## 7. 残余风险

1. MINIMAL/MIGRATION 示例必须持续声明「字段以 `CORE_MODEL_V2.md` §4 为准、示例可为子集」，否则实现可能照示例产生不兼容。
2. `PortDirection`/`NodeRuntime`/`ConnectionRuntime` 已在 `CORE_MODEL_V2.md` 给出草案，但仍需在 P2 实现阶段落码。
3. `PluginFacade` 能力面已按 `ENGINE_SPI_V2.md` §4 补齐注册方法，后续实现须保持同步。
4. checker 已加强字段级存在与关键字段断言，但仍需在 CI 中运行 `test_stage4_document_contracts.py` 防止浅门误报绿。
5. P1-07 运行时共享可变 dict 仍只登记方案，阶段 5 若直接实现 Runtime 须先落隔离方案。
