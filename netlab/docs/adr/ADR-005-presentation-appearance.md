# ADR-005: Presentation 外观归属（ADR-005-lite）

- **状态**：**Accepted（ADR-005-lite，2026-11-11）**
- **决策者**：用户（2026-11-11 正式裁决）
- **关联**：`NETLAB_V2_PLANNING_REVIEW.md` §2、§9；`PROJECT_STATUS.md`；`APPEARANCE_ENGINE_DESIGN.md`

## 背景

P-B 需要做元素级外观（颜色、透明度、线宽、字号、子元素等），但当前外观状态与节点数据结构的关系不清；若把外观写进 Runtime 或物理参数，会污染模型语义、触发不必要的编译/缓存失效。

## 决策（已确认原则）

1. **层级归属**：Appearance 属 **Presentation 层**，不属于 `NodeRuntime`/`ConnectionRuntime`；修改外观不得修改物理模型、物理参数、方程、模型结构或求解器配置，也不得进入物理编译缓存键。
2. **持久化位置**：默认放 `SceneDoc` 的 Presentation 层；当前不单独建 view 文件。SceneDoc 保存场景及默认 Presentation；Presentation 与物理模型定义独立；`NodeDesc`/`EdgeDesc` 不直接承担复杂视觉状态。
3. **临时状态**：选中、高亮、悬停、临时预览不写入普通场景持久化，与持久化外观分离。
4. **事务**：批量外观修改统一走 `SceneEdit`/`SceneTxn`，一次校验、一次提交；不得 N 次逐条更新，也不得另造独立 undo 栈（优先复用现有命令历史/SceneTxn）。
5. **schema 与迁移**：外观属性有独立 schema 与版本迁移；旧项目缺失 appearance 时必须保持默认视觉兼容。
6. **未来多视图**：保留“同一物理模型多 View、独立布局/外观覆盖、不复制整份物理模型”的扩展空间；暂不实现完整多用户视图系统。

## P1-A-lite 的最小交付（本 ADR 即其边界说明）

- 明确 P-B 改动范围：呈现/外观数据路径、`SceneEdit` 批量入口、选择/悬停临时状态、默认兼容。
- 明确接口与验收：外观修改不改动物理数值、不触发 Model Compiler 重编译、不进入编译缓存键；批量操作原子且可回滚；旧项目加载默认不变。
- 完成 ADR-005-lite 后允许进入阶段 2 P-B 完整版。

## P-B 完整版范围

端口等子元素独立外观、选中 tick 等子元素外观、多选批量修改、自定义颜色对比度护栏、独立撤销、外观保存/加载、外观变化不触发物理重编译。

## 影响与未验证项

- 具体 `SceneDoc` schema 字段、迁移代码、前端性能与撤销行为尚未实现验证；需 P-B 阶段按九项验收核对。
- 完整 ADR-005 可在阶段 4 P1-A 全量设计冻结时补齐；当前 `Accepted` 仅代表上述 lite 原则。
