# NetLab 本轮复审与 Agent 修正审计（2026-11-12）

> 状态：只读审计报告 + P0-1 文档基线纠偏记录。**不是阶段 4 正式验收，也不放行阶段 5/6–13。**
> 权威输入：`NetLab_AgentFix_Task_2026-11-12.txt`（用户 2026-11-12 16:52 下发）；本报告以 GitHub `main` 实测代码/提交/测试/CI 为准。

## A. 一页现状结论

- GitHub `main` 最新提交：`4dc7bdd815477b63d51f683edc3af3c2765ba72b`（状态快照，提交说明 effective head 为 `1df4934`）。
- 测试报告绑定 HEAD：`1df4934f7dec861aa96bdf813d688516696753ee`；报告为 945 passed / 1 skipped / 0 failed，232.4s，core line coverage 81.38%，生成时间 2026-11-12 16:34:31 +08:00。
- 最后生产代码提交：`e41160f300393889c1b9539ebab73ed5280f2796`（P1-R1 Stamp 共享原语）。`b667e517...e41160f` 的 compare 确认含 `netlab/core/compute/circuit/descriptor.py`（+9/−30）与 `netlab/core/compute/circuit/stamps.py`（+30/−7）；因此 `PROJECT_STATUS.md` 原「代码基线 b667e517」已过期。
- CI：`4dc7bdd` 的 5 个 check-run（desktop-l2/build/test/e2e-l1/docker）均 `completed/success`；GitHub legacy commit status API 返回 `pending/total 0`，应写「check-runs 有证据、legacy status 无记录」，不可写成「CI 全绿」或「CI 失败」。`1df4934` 的 check-runs 为 0（其 945 结果是测试报告绑定，不是 CI 运行）。
- 阶段：0–3 已完成；阶段 4 设计冻结第三方封口评审 `a25c3774` 14/14 pass，正式验收已于 2026-11-12 获用户明确批准（用户授权）；阶段 5 P1-R1 代码已提交 `eaec04a` 但授权冲突、暂停；阶段 6–13 未开始。**阶段 5 已提交代码 ≠ 阶段 6 获准。**
- 本轮可立即做：P0-1 文档/状态基线纠偏（已完成）；P0-2 schema 契约需用户裁决，先给方案不擅自统一；P1-1～P1-6 只读审计与补丁设计已完成，未改生产代码；P2 仅给基准/拆分建议。

## B. 阶段 0–13 状态表

| 阶段 | 当前事实 | 允许动作 / 禁止动作 |
|---|---|---|
| 0 基线 | 已完成 | — |
| 1 P1-A-lite | 已完成 | — |
| 2 P-B | 已完成（§7.152） | — |
| 3 R40 收尾 | 已完成（§7.153） | — |
| 4 P1-A 设计冻结 | 9 份设计文档 + 第三方封口评审 `a25c3774` pass；2026-11-12 获用户明确批准，正式验收通过（用户授权） | 阶段 6+ 仍需用户单独授权；不得据本表推定后续阶段获准 |
| 5 P1-R1 Stamp 统一 | 代码提交 `e41160f`（状态刷新 `eaec04a`）；实际只统一两端口 Laplacian primitive，完整 CircuitElement 模型未统一；审批判暂停。P1-2 措辞已纠偏（`P1_R1_STAMP_CONVERGENCE.md`、`PROJECT_STATUS.md`）并补覆盖矩阵（2026-11-12 收口） | 只可修正状态/文档/测试措辞；不得作阶段 6 自动放行 |
| 6 P1-R2 AC/Bode 统一 | 未开始；双后端为两条独立实现（`V2_IMPLEMENTATION_GAP_ANALYSIS.md:92` 已纠正「兼容包装」误述）；P1-3 已补后端约束表 + 跨拓扑 parity matrix（2026-11-12 收口，仅文档） | 阶段 6 授权前不得改求解器生产代码 |
| 7–9 P1-S1/S2/S3 | 未开始 | 未授权不启动 |
| 10–13 P2–P5 | 未开始 | 未授权不启动 |

## C. 问题清单（P0 / P1 / P2，每项含证据、复现/预期/实际、根因、影响、建议、测试）

### P0-1 状态与基线文件互相矛盾（已修文档）

- 证据：`PROJECT_STATUS.md:14` 原「代码基线 HEAD b667e517」过期；`BACKLOG.md:22/:29/:30` 942 passed/81.3808；`CORE_ARCHITECTURE_V2.md:5`、`CORE_ARCHITECTURE_V2_ROADMAP.md:4` 仍 b667e5/909/旧 CI；`CORE_ARCHITECTURE_AUDIT.md:1-8` 审计快照 e56d443/881；`PROJECT_OPTIMIZATION_EXECUTION_PLAN.md:6` 阶段 1 旧快照；`status.json` `git.head=1df4934`、`ahead_origin=34` 是本地跟踪快照。
- 预期：唯一事实源应有 latest_commit / tested_head / last_code_commit / test_count / coverage / CI_evidence / stage_acceptance / authorization 八字段；自动生成文件与人工文档不得各写一套数字。
- 实际：多份文档各自写旧数字，且把 `ahead_origin` 当远端 ahead。
- 根因：状态由 `gen_status.py` 与人工文档分别维护，历史阶段数字未标历史。
- 影响：审计者会被旧 HEAD/旧测试数误导；无法判断当前有效提交。
- 建议：以 `PROJECT_STATUS.md §1` 为唯一八字段表；其他文档只引用，不重复维护动态数字；历史数字保留并标「历史」。
- 本轮已做：更新 `PROJECT_STATUS.md`（latest `4dc7bdd`、tested `1df4934`、last code `e41160f`、945/81.380784、CI 证据 `4dc7bdd` 五 check-run）；`BACKLOG.md` 942→945、81.3808→81.380784；`CORE_ARCHITECTURE_V2.md`/`ROADMAP.md` 改为引用当前基线 + 阶段 3 历史；`CORE_ARCHITECTURE_AUDIT.md` 加历史快照说明；`PROJECT_OPTIMIZATION_EXECUTION_PLAN.md` 明确规划时快照。**未改任何生产代码。**
- 测试：`render_docs.py --check`、docs 隐私/SSOT 测试、`check_status_freshness`。

### P0-2 Typed Port 对象定义与 JSON 示例不统一（需用户裁决，不擅自修）

- 证据：`CORE_MODEL_V2.md:65-92` 定义 `PortType`（11 字段）与 `PortDesc(port_id,direction,port_type,cardinality,reference,component_id,coordinate_frame,metadata)`，`NodeDesc:96-100` 的 `ports: tuple["PortDesc", ...]`；`MINIMAL_DATA_MODEL_EXAMPLE.md:29-31` 仍写 `"ports": ["vin_p"]` 字符串列表；`tools/check_stage4_docs.py` 与 `test_stage4_document_contracts.py` 把 list[str] 当作通过条件。
- 预期：CORE_MODEL_V2 / MINIMAL / MIGRATION / CORE_INTERFACE_CONTRACTS / checker / 测试 / 迁移策略只有一种端口表示。
- 实际：两套表示并存，类型语义不同，示例与 dataclass 不兼容。
- 根因：阶段 4 曾用字符串列表简化示例，后来在 CORE 引入 PortDesc 对象但未统一示例/checker。
- 影响：实现者照示例写会生成与 Core dataclass 不兼容的工程；checker 反而固化错误契约。
- **需用户裁决的两个方案（本报告不选）**：
  - 方案 A（端口对象内嵌）：`NodeDesc.ports: tuple[PortDesc,...]`，JSON `ports` 为对象数组；每端口自包含 `port_type`；优点是自包含、序列化直观，缺点是重复定义/文件膨胀。
  - 方案 B（端口 ID 引用 + 注册表）：`NodeDesc.ports: tuple[str,...]` + `SceneDesc.port_registry: Mapping[str,PortDesc]`（或工程级 registry）；JSON `ports` 为字符串数组；优点是去重、便于共享 PortType/迁移，缺点是需解析引用、校验 dangling id。
- 建议：若优先可迁移性与去重选 B；若优先对象自包含选 A。**在用户明确前不修改任何 schema、不把任一方案写成实现事实。**
- 测试（决定后）：正向 schema、负向（未定义 port_id、重复 id、direction 非法）、round-trip、旧工程迁移、checker 用 `json.loads` 字段级校验而非 token 存在性。

### P1-1 插件 Engine 注册与场景加载链路断开（只读复现，未改生产代码）

- 证据：`scene.py:82-87` `Scene.__init__` 允许 `ENGINE_SPECS` 中的插件 mode；`scene_io.py:84-86` `load_payload` 只允许 `MODES` 直接拒绝；`project.py:829` 允许 `mode not in MODES and mode not in plugin_modes()` 后 `Scene(mode).load_payload` 必然在 scene_io 拒绝；`networks.py:985+` `add_network` 只允许内建 MODES/模板硬编码；`blocks.py:129-166` `BlockDef.__post_init__` 同样限定 mode。
- 复现（本次已跑）：注册 `EngineSpec(mode="repro-plugin", factory=lambda scene: Dummy())` → `Scene("repro-plugin")` 成功 → `load_payload({"mode":"repro-plugin",...})` 抛 `ValidationError: 未知模式：'repro-plugin'`。
- 预期：register → catalog → `Scene(mode)` → `load_payload` → `NetworkContainer.add_network` → build/save/load project → `create_engine` → step/probes/stats → unload 全链路可用。
- 实际：`Scene` 接插件模式，但 `load_payload`、`add_network`、`BlockDef` 拒绝，链路在第一跳断开。
- 根因：`MODES` 白名单与 `ENGINE_SPECS` 插件模式没有统一 `is_engine_mode()` 判定；各入口各自硬编码 MODES。
- 影响：插件 Engine 无法端到端加载/保存工程；P1-B2 架构债仍未闭环。
- 建议补丁：新增 `engine_registry.is_engine_mode(mode)`（内建 MODES ∪ ENGINE_SPECS），替换 `scene_io.py:85`、`networks.py` mode 校验、`blocks.py` mode 校验、`project.py:829` 统一判定；保留内建模板字典 fallback；补端到端测试。触及 `graph.py`/`scene.py` 大规模重构需授权，本补丁只动上述入口。
- 测试：正向全链路、未知 mode 负向、两个 Project 注册不同插件隔离、unload 后 catalog/ENGINE_SPECS 清空。

### P1-2 P1-R1 被描述为「Stamp 单一化」，实际只统一共享矩阵原语（文档/状态纠偏项）

- 证据：`e41160f` 新增 `stamps.py:75 stamp_laplacian`、`descriptor.py` 三处两端口 Laplacian 委托；`descriptor.py:445 _assemble_matrices()` 仍按 `element.kind` 分派，电感/电压源/受控源支路变量仍是 Descriptor 专用装配；`elements.py` 的 `CircuitElement.stamp()` 仍是 Legacy MNA 伴随模型；`P1_R1_STAMP_CONVERGENCE.md:26-28` 已说明两种未知量集合不同，不能让 Descriptor 直接调 `element.stamp()`。
- 预期：状态拆成「两端口 Laplacian stamping primitive 已统一」与「完整 CircuitElement 模型统一未完成」。
- 实际：文档/报告把阶段 5 写成「Stamp 单一化」，容易被误读为完整元件模型统一。
- 影响：阶段 5 成果被高估，可能误导阶段 6 范围。
- 建议：改任务名/状态/ROADMAP/完成报告措辞；测试补接地/复数权重/非线性/支路元件/浮置网络/错误情况；性能基准区分 primitive 微基准（当前 1.093×）与整机装配（120 节点 RC 0.25ms），不得用 1.093× 代替整机结论；进一步统一须先设计 ElementAdmittance / StampContext / descriptor adapter 边界并数值对拍。
- 测试：现有 `test_stamp_unification.py` 已覆盖接地、复数权重、Resistor.stamp、RC 频响、浮置电容、静态断言；未覆盖非线性/支路元件/错误情况，列为待补。

### P1-3 P1-R2 AC/Bode 双后端文档描述不准确（只读审计，阶段 6 前不改代码）

- 证据：`solver.py:969 CircuitSolver.ac_sweep()` 独立执行 DC 工作点/频率检查/AC 组装/探针；`descriptor.py:844 frequency_response()` 自己 build system 并逐频率 `system.solve(omega)`；`descriptor_analysis.py:809 descriptor_step_response` 用隐式 Euler 独立线性求解；`V2_IMPLEMENTATION_GAP_ANALYSIS.md:92` 把 frequency_response 描述为 ac_sweep 兼容包装，与源码不符。
- 预期：只读梳理两后端的输入约束/DC 线性化/激励源归一化/元件覆盖/支路电流探针/复数精度/奇异病态/相位幅值定义/错误语义/性能/状态副作用，建立跨拓扑 parity 矩阵。
- 实际：两条独立实现，只有单一 RC 低通/4 频点的窄 parity（`test_descriptor_rlc.py:174`，rtol 1e-8）；不能称后端统一。
- 建议：阶段 6 前不改求解器；先补 parity matrix（RC/RL/RLC/受控源/多输入源/浮置与接地/奇异病态/多探针/源归一化/状态不变性/复数误差/性能）。
- 测试：现有窄 parity 保留并标注范围；补跨拓扑 parity。

### P1-4 Description/Runtime 仍共享可变状态（复现与方案，不重构）

- 证据：`records.py:14-27 NodeRecord` 含 `params/data/state/inputs`；`scene_engines.py:93-140` SignalEngine 按引用传 `record.data/state/inputs`；`graph.py:164-200 Node.__post_init__` 明确 data/state 与 SceneRecord 共享字典，`MappingProxyType` 只保护只读视图；`graph.py:1061-1081 Network.capture_step_state` 对 data/inputs/ports 浅层 dict 快照；`test_stage4_document_contracts.py::test_runtime_state_isolation` 测 FakeCompiledModel/普通 dict，不是真实 Scene/Engine/Runtime。
- 预期：V2 目标 Runtime 与 Desc 隔离；当前 V1 共享引用明确标为现状。
- 建议：补真实对象测试计划（两个 Scene/Engine/Runtime、嵌套 mutable state、data/inputs/ports、step failure、timeout rollback、reset、snapshot/restore 串扰）；当前只复现与方案，不擅自重构 `graph.py`/`scene.py`。
- 测试：真实 Runtime 隔离测试（非 Fake）。

### P1-5 Plugin API 依赖方向与隔离范围不足（审计+方案）

- 证据：`plugin_api/v1/__init__.py:1-20` public API 直接 import `netlab.core.compute.params.ParamSpec`；`engine_registry.py:1-45` 从 `plugin_api.v1` import `EngineSpec` 形成反向依赖；`ENGINE_SPECS`/`ENGINE_OWNERS` 为进程级全局字典非 Project-scoped；`EngineSpec.node_kinds/edge_kinds` 在 `engine_catalog()` 暴露但未验证加载/编译时作为能力白名单；`EngineProtocol:147-153` 只声明 build/step/reset/probes/stats，V2 的 validate/compile/create_runtime/snapshot/restore/dispose 未落地。
- 建议：画 import DAG/SCC；检查 PluginManager 注册/失败回滚/unload 是否撤销全部 capability；两个 Project 注册不同插件验证隔离；Plugin v1 是进程内受信任 Python 代码，不是 OS 沙箱，不得宣传为安全沙箱。
- 测试：双 Project 隔离、注册失败回滚、unload 清空。

### P1-6 Project/DTO/工程文件边界（审计+方案，不改外部 JSON）

- 证据：`project.py:36-43` `PROJECT_VERSION=7`、`MAX_PROJECT_BYTES=8_000_000`（V2 目标版本 8 未实施，不得写成已实施）；`project.py:102-106` `verify_checksum` 缺失 checksum 时返回 True；`project.py:967-979` `decode_project_bytes` 先 `zlib.decompress` 后检查 8MB 解压大小；`project.py:770-865` `validate_project` 通过构造 Scene/load_payload/ensure_engine 复用校验，可能触发 Engine/Plugin 工厂。
- 建议：画 raw parse → checksum → schema validate → migration → plugin trust confirmation → Engine/Runtime creation 时序；评估高压缩比输入资源消耗，设计限流式解压+超限测试；明确工程信任确认发生处；未经批准不改 `.netlab` 外部 JSON、不删旧格式兼容。
- 测试：缺失/错误 checksum、压缩炸弹超限、未知插件、旧 v6/v7 工程。

### P2 性能与模块化观察项

- `NodeRecord.snapshot(include_state=False)` 深拷贝 params/data 的大场景 to_payload 成本；`Network.capture_step_state` 每步快照成本/状态大小/嵌套结构/失败回滚收益；`computes.py`/`analysis.py`/`circuit/solver.py`/`simulation.py` 聚合模块；`frontend/app.ts` 约 30 万字符（已拆子模块）。
- 建议：先通过依赖/职责图定拆分边界，不按行数机械拆；阶段 9 授权前不做大规模前端拆分；先建基准（大场景 snapshot 耗时、每步快照耗时/内存、模块依赖 SCC），不编造数字。

## D. 代码—文档—测试三方一致性矩阵

| 主题 | 代码事实 | 文档说法 | 测试覆盖 | 一致性 |
|---|---|---|---|---|
| P1-1 插件 Engine 加载 | 修复前：`scene_io.load_payload` 拒绝插件 mode（`Scene` 本已接受） | 设计文档称插件 Engine 可注册 | 曾 inline repro 复现拒绝；已补 `test_p1_1_plugin_mode_loading.py`（8 例） | **已修复（提交 212a890，见 §L）** |
| P0-2 Typed Port | `NodeDesc.ports=tuple[PortDesc]` | MINIMAL JSON `ports: ["vin_p"]` | checker 把 list[str] 当正确 | **不一致（需裁决）** |
| P1-2 P1-R1 | 只统一 `stamp_laplacian`；`elements.stamp()` 仍是 Legacy MNA | 已纠偏为「仅 primitive 收敛、完整模型未统一」；覆盖矩阵已补 | `test_stamp_unification.py` 33 例仅 primitive/RC | **已纠偏（措辞正确定性）；模型未统一仍属实** |
| P1-3 P1-R2 | 两条独立 AC 后端 | Gap 文档已纠正为「两条独立实现、非兼容包装」；后端约束表/parity matrix 已补 | 仅单一 RC/4 频点 parity | **已纠偏（文档错已改）；跨拓扑 parity 待阶段 6 补** |
| P1-4 Runtime 隔离 | records/graph 共享可变 dict | 文档称 Desc/Runtime 分离 | 只有 FakeCompiledModel 测试 | **不一致（目标 vs 现状）** |
| P1-5 Plugin API | core 内部 import 进 plugin_api；全局 registry | 文档称公开 Engine API | 无隔离/回滚测试 | **不一致（架构债）** |
| P1-6 Project 安全 | v7；checksum 缺失返回 True；先解压后限 8MB | 文档称 V2 版本 8/严格校验 | 未覆盖压缩炸弹/缺失 checksum | **不一致（待修）** |
| 状态基线 | main 4dc7bdd / tested 1df4934 / last code e41160f / 945 | 多文档旧数字 | status.json 已 1df4934 | **本轮已纠偏** |

## E. 插件 Engine 最小复现测试（本次已执行）

```text
register EngineSpec(mode="repro-plugin", factory=lambda scene: Dummy())
EXPECT: Scene(mode) accepts plugin mode -> OK
ACTUAL: load_payload rejected -> ValidationError 未知模式：'repro-plugin'
```

结论：`Scene.__init__` 与 `scene_io.load_payload` 对插件 mode 判定不一致，P1-1 阻断成立。修复测试应覆盖：register → catalog → Scene(mode) → load_payload → NetworkContainer.add_network → build/save/load project → create_engine → step/probes/stats → unload；另加未知 mode 负向与两 Project 隔离。

## F. P1-R1 / P1-R2 数值正确性与性能审计

- P1-R1：`stamp_laplacian` 与收敛前内联体逐元素等价（33 测试，含接地、复数权重、Resistor.stamp、RC 频响、浮置电容、静态无内联体断言）；D-5 影子报告 `max_abs=5.55e-17`、`max_rel=4.84e-14`；性能 `stamp_laplacian` 20 万次 197.31ms（≈0.99µs/次）vs inline 180.46ms（≈0.90µs/次），比值 1.093×；120 节点 RC 装配 0.25ms。**这只证明两端口 primitive 统一，不证明完整元件模型统一。**
- P1-R2：现有 parity 仅 `test_descriptor_rlc.py:174` 单一 RC 低通/4 频点，rtol 1e-8、atol 1e-10；缺 RL/RLC/受控源/多输入源/浮置与接地/奇异病态/多探针/源归一化/状态不变性/复数误差/性能矩阵。阶段 6 授权前不改求解器生产代码。

## G. Runtime 隔离与工程文件安全审计

- Runtime 隔离：`NodeRecord` 含 `data/state/inputs` 且 `SignalEngine` 按引用传递；`Node.__post_init__` 共享 dict；真实隔离测试缺失。建议先补真实 Scene/Engine/Runtime 双实例、嵌套 mutable、step failure/timeout rollback/reset/snapshot-restore 串扰测试；不重构 `graph.py`/`scene.py`。
- 工程文件安全：`PROJECT_VERSION=7`（V2 目标 8 未实施）；`verify_checksum` 缺失返回 True（旧格式兼容 vs 新格式严格）；`decode_project_bytes` 先解压后限 8MB（压缩炸弹风险）；`validate_project` 通过构造 Scene/Engine 复用校验可能触发插件工厂。建议画检查时序、加缺失/错误 checksum、压缩炸弹超限、未知插件、v6/v7 迁移测试。

## H. 修正补丁计划（按依赖排序，含工作量与回滚）

1. **P0-1 状态基线纠偏（已做，文档/状态，0.5 人日）**：唯一八字段表；回滚仅 revert 文档提交。
2. **P0-2 Typed Port schema 统一（需用户裁决，1–2 人日）**：先定 A/B；再改 CORE/MINIMAL/MIGRATION/CORE_INTERFACE/checker/测试；回滚保留旧格式只读兼容。
3. **P1-1 插件 Engine 端到端（1–2 人日，需确认是否触及冻结边界）**：新增 `is_engine_mode()`，统一 scene_io/networks/blocks/project 判定；端到端测试；回滚开关保留内建 MODES 原路径。
4. **P1-2 P1-R1 状态重定性（0.5 人日，文档/测试报告）**：改名/拆分状态/补覆盖矩阵；无生产代码回滚风险。
5. **P1-3 P1-R2 只读 parity 计划（1 人日，阶段 6 前不改代码）**：跨拓扑矩阵、后端约束表；仅文档。
6. **P1-4 真实 Runtime 隔离测试设计（1 人日，先设计）**：测试先行；不改 graph/scene；回滚仅删除测试。
7. **P1-5 Plugin API/Project 安全边界（1–2 人日，审计+方案+Open Decision）**：import DAG、双 Project 隔离、unload 回滚；需授权后再动。
8. **P2 性能与模块拆分（1–2 人日，只做基准/建议）**：快照成本/依赖图；阶段 9 前不做前端大规模拆分。

依赖：P0-1 → P0-2（决定 schema）→ P1-1（端到端）→ P1-2/P1-3（只读审计）→ P1-4/P1-5（设计）→ P2。P1-1 若触及 `graph.py`/`scene.py` 大规模重构，必须先提交方案+授权请求，不得越级。

## I. 需用户裁决的 Open Decisions

1. **阶段 4 正式验收批准**：第三方封口评审 `a25c3774` 14/14 pass；已于 2026-11-12 获用户明确批准正式验收（用户授权）——本项已解决。
2. **P0-2 Port schema**：方案 A（PortDesc 内嵌）还是方案 B（port_id + registry）？未定前不统一。
3. **ADR-008 三项**：A 显式 Runtime 快照是否入 Project Save；B Plugin 权限边界（只读/可写哪些层）；C 兼容窗口是否必须支持 v6。均 `PENDING_USER_AUTHORIZATION`。
4. **阶段 5 `eaec04a`**：恢复、保持冻结、或回退？按审批 13:10「不允许进入阶段6·需用户授权·暂停」保持冻结。
5. **两路线裁定**：V2 设计路线与实现路线（是否继续 P1-A/P1-R1 双轨，是否先 P2 重构）需用户裁定。
6. **P1-1 补丁是否触及冻结区**：若需改 `graph.py`/`scene.py`/`scene_io.py` 的冻结部分，先提交补丁方案+授权请求。

## J. 可立即修 vs 必须等待授权

- **可立即做（已完成/可继续）**：P0-1 文档/状态基线纠偏（已做）；P0-2 选项分析与 checker 审计；P1-2/P1-3 只读审计与文档纠偏；P1-4/P1-5/P1-6 设计/测试计划；P2 基准与拆分建议。
- **必须等待授权**：P0-2 最终 schema 选择与全链路改造；P1-1 生产代码补丁（若触及冻结/阶段 8 范围）；阶段 4 正式验收；阶段 5 恢复/回退；阶段 6–13；ADR-008 三项；V2 生产实现与外部 JSON 变更；FEM/graph.py/scene.py 大规模重构；MAX_NODES=400、NETLAB_MATH_ACCEL、500+、Newton/SCC。
- **不得声称**：Proposed 设计 = 实现；Fake 测试 = 真实 Runtime 隔离；返回结构兼容 = 数值后端统一；旧 SHA CI 绿灯 = 当前 HEAD 证据。

## K. P1-2 / P1-3 收口记录（2026-11-12）

- P1-2（P1-R1 措辞高估）：`P1_R1_STAMP_CONVERGENCE.md` 标题/范围澄清与 `PROJECT_STATUS.md` 阶段 5 已把口径定为「仅 `stamp_laplacian` 两端口原语收敛、完整 `CircuitElement` 模型未统一」；本报告同日在 `P1_R1_STAMP_CONVERGENCE.md §3.1` 补**覆盖矩阵**（已覆盖 vs 未覆盖）。**不含生产代码改动。**
- P1-3（P1-R2 文档错）：`V2_IMPLEMENTATION_GAP_ANALYSIS.md:92` 已纠正「兼容包装」误述为「两条独立实现」；本报告同日在 `V2_IMPLEMENTATION_GAP_ANALYSIS.md §11.1/§11.2` 补**后端约束表 + 跨拓扑 parity matrix**（标「待补」者阶段 6 授权后测，不编造通过结论）。**不含求解器生产代码改动。**
- 状态：P1-2/P1-3 的「措辞/文档」缺陷视为**已收口**；「跨拓扑全量等价证据」属阶段 6 执行范围，仍 `PENDING`。

---

*本报告记录审计与 P0-1 文档纠偏，以及 P1-2/P1-3（2026-11-12）措辞/矩阵收口；未改任何生产代码，未 push。*

## L. 其他状态同步（2026-11-12 晚）

- **P1-1 已修复**：提交 `212a890`（代码 + 测试；全量 `pytest netlab/tests` → 953 passed / 1 skipped），提交 `1246ee3` 记录于 `PROJECT_STATUS.md §6`；补丁仅动运行时代码 `scene_types.py`/`scene_io.py`/`networks.py`（新增 `is_known_mode`、`_blank_scene_payload`），不触阶段 4 冻结边界。
- **阶段 4 正式验收已批准**：2026-11-12 获用户明确批准（见 `PROJECT_STATUS.md`）；阶段 6+ 仍需用户单独授权。
