# NetLab 项目优化执行规划（交付给「项目优化」）

- **状态**：执行约束文档（2026-11-11 按用户正式裁决重写；不是已完成阶段，也不代表任何阶段已获代码实施授权）
- **审查依据**：`NetlabHome/netlab/docs/NETLAB_V2_PLANNING_REVIEW.md`
- **当前事实源**：`NetlabHome/netlab/docs/PROJECT_STATUS.md`
- **事实基线**：Netlab HEAD `eb27dedc15a3f2fa061310cb5f5b33cf521f039b`，origin/main 同 SHA，ahead 0 / behind 0；`status.json` 881 passed / 1 skipped / core 81.312%，代码提交 `e56d443`；P1 审计见 `CORE_ARCHITECTURE_AUDIT.md`。
- **当前阶段**：阶段 0（项目事实与文档基线）已完成文档部分；阶段 1 P1-A-lite 的 ADR-005-lite 已产出。不得提前启动 P-B 代码实现。

## 1. 唯一允许的执行顺序（阶段 0–13）

`阶段0 项目事实与文档基线 → 阶段1 P1-A-lite → 阶段2 P-B 完整版 → 阶段3 R40 收尾 → 阶段4 P1-A 全量设计冻结 → 阶段5 P1-R1 Stamp 统一 → 阶段6 P1-R2 AC/Bode 统一 → 阶段7 P1-S1 Project/DTO → 阶段8 P1-S2 Engine SPI v2 → 阶段9 P1-S3 前端拆分 → 阶段10 P2 Core Model V2 → 阶段11 P3 Equation+Compiler → 阶段12 P4 Runtime+Plugin V2 → 阶段13 P5 Validation/机械/多物理场/Control Flow`

- 不得打乱顺序、跳步、并行越级启动未授权阶段。
- 只有当前阶段通过退出条件后，才可向用户申请进入下一阶段；未获明确批准前，下一阶段只能做只读了解，不得产生实现或正式文档交付物。
- 阶段 1 P1-A-lite 只处理 P-B 必须依赖的外观架构边界（Appearance 属 Presentation 层），不得误认为 P1-A 全量完成。
- P2 内部按 P2-A→P2-B→P2-C→P2-D（按真实依赖调整，不机械拆）；P3 先电路后机械；P2 完成后才可进入 P3；P3→P4→P5 依次进行。
- R25 暂停；R43 M2 仅 opt-in；R19 暂停；Phase 3 架构债 / Phase 4 CI 证据 / 500+ 规模档均 `PENDING_USER_AUTHORIZATION`，不得借本规划启动。

## 2. 阶段 0：项目事实与文档基线（本次完成）

- 核实 HEAD/分支/工作树/审计对应关系；建立 `PROJECT_STATUS.md`。
- 建立 `docs/adr/ADR-001..007`（ADR-005-lite Accepted，其余 Proposed）。
- 小范围修正 `CORE_ARCHITECTURE_V2.md:5`、`CORE_ARCHITECTURE_V2_ROADMAP.md:3`、`BACKLOG.md:26` 的过期状态口径，保留历史。
- 不改核心源码。
- **退出条件**：PROJECT_STATUS 事实与当前 HEAD 一致；文档冲突已定位；ADR 索引可用。

## 3. 阶段 1：P1-A-lite（下一步，文档已就绪）

- 交付：外观 Presentation 归属设计（见 `ADR-005-presentation-appearance.md` 的 P1-A-lite 节）、ADR-005-lite、P-B 改动范围/接口/验收。
- 不实现 P-B，不改 `graph.py`/`scene.py`，不改物理编译路径。
- **退出条件**：ADR-005-lite Accepted；P-B 范围/接口/验收明确；用户确认后进入阶段 2。

## 4. 阶段 2：P-B 完整版

- 范围：端口等子元素独立外观、选中 tick 等子元素外观、多选批量修改、自定义颜色对比度护栏、独立撤销（复用命令历史/SceneEdit/SceneTxn）、外观保存/加载、外观变化不触发物理重编译。
- 约束：外观属 Presentation；不进入 Runtime/物理参数/编译缓存键；批量操作原子可回滚；旧项目默认视觉不变。
- **退出条件**：§9.3 九项验收（功能、数据模型、单测、集成、兼容、数值、性能、CI 精确 HEAD、回滚风险）。

## 5. 后续阶段（不得提前启动）

| 阶段 | 内容 | 进入条件 |
|---|---|---|
| 3 | R40 收尾：节点卡片自由字段编辑已知限制 | P-B 通过验收并获用户批准 |
| 4 | P1-A 全量设计冻结：CORE_MODEL_V2/TYPED_PORT_SYSTEM/ENGINE_SPI_V2、边界对象关系、Engine 生命周期、接口契约、兼容迁移、最小数据模型示例 | 阶段 3 完成并获批 |
| 5 | P1-R1 CircuitElement Stamp 统一 | P1-A 冻结完成并获批 |
| 6 | P1-R2 AC/Bode 统一 | P1-R1 完成并获批 |
| 7 | P1-S1 Project/DTO 分层 | P1-R2 完成并获批 |
| 8 | P1-S2 Engine SPI v2 | P1-S1 完成并获批 |
| 9 | P1-S3 前端拆分 | P1-S2 完成并获批 |
| 10 | P2 Core Model V2（P2-A/B/C/D） | P1-S3 完成并获批 |
| 11 | P3 Equation+Compiler（电路→机械） | P2 完成并获批 |
| 12 | P4 Runtime+Plugin V2 | P3 完成并获批 |
| 13 | P5 Validation/机械/多物理场/Control Flow | P4 完成并获批 |

## 6. 每阶段统一验收（九项）

1. 功能正确性；2. 数据模型正确性；3. 单元测试；4. 集成测试；5. 兼容性（旧项目/旧 API）；6. 数值正确性；7. 性能基准；8. CI 证据（绑定精确 HEAD）；9. 回滚与风险说明。不适用项必须说明原因，不得省略。

## 7. 当前禁止

不改 FEM；不放宽 `MAX_NODES=400`；不擅自放量 `NETLAB_MATH_ACCEL`；不启动 R19/R25；不启动 Phase 3 架构债；不启动 Phase 4 CI 证据；不未经授权大规模重构 `graph.py`/`scene.py`；不改外部 JSON；不删除已有功能；不做无性能证据的求解器重写；不把 P3 原型扩大为完整生产编译器；不提前实现完整 Control Flow 运行时；不擅自 push/发布/改授权边界。

## 8. 报告格式

- 开始前：当前 HEAD、目标文件、相关代码入口、现有测试、计划改动范围、潜在风险、验收标准。
- 完成后：实际修改文件、核心改动、测试结果、CI 结果（精确 HEAD）、兼容性检查、未解决问题、当前 Git 状态、是否需下一阶段授权。
- 禁止“基本完成 / 应该没问题”等模糊描述；代码与文档冲突以代码事实为准，先报告差异再决定是否修文档。
