# 阶段 4 设计冻结整改报告

> 状态：`Proposed`。对象：《阶段4架构设计整改与重新验收任务书》（2026-11-12 11:20）。本报告记录 P0/P1/P2 整改结果与证据；**不修改生产核心代码、不实施 V2 迁移**。所有证据均绑定本地提交与可复现命令。

## 1. 仓库状态

- 整改前基线：`eaec04af31c7fe1e9aa2488e7a09c183c603688c`（阶段 5 P1-R1 已交付并 push；该阶段在任务书到达前完成，见 §7）。
- 9 份设计文档原提交 `ad2e481`；任务书核查时自该提交后零改动，P0 缺陷全部存在。
- 本次整改在任务书之后新增改动（提交见 `git log` 与 §4）；工作树只含 `netlab/docs/*`、`netlab/tools/*`、`netlab/tests/*`、`adr/*`，无生产核心代码。
- 证据订正（2026-11-12 11:58 审批文档组）：P1-03 并非「完全无映射」，原 `MIGRATION_AND_COMPATIBILITY.md:21-35` 已有 v7→V2 12 行表（但非 V1→V2、`:26` data/state/inputs 未拆分，v6 PENDING）；P2-01 并非「完全无 UnitRegistry」，原已有 4 元量纲 + mV↔V 换算，缺七基与 m/mm、J↔N·m；`_stage4_validate.py` 为仓库外、非 tracked、只查格式的辅助脚本，其 PASSED 不等同契约测试，本轮已另建 tracked `tools/check_stage4_docs.py` + `netlab/tests/test_stage4_document_contracts.py`。
- 证据订正（2026-11-12 11:31 审批补充）：P1-R2 已有窄范围 parity 测试 `netlab/tests/test_descriptor_rlc.py:174`（单一 RC/4 频点，`rtol=1e-8`），任务书「无任何等价测试」不准确；P1-07 的导出路径 `records.py:29-50 NodeRecord.snapshot()` 已 `copy.deepcopy`，真正风险是 `scene_engines.py:101-107`/`graph.py:190-192/:200` 运行时共享可变 dict；「冻结区不改生产核心代码」是前向约束，不代表 `netlab/core/compute/circuit/` 历史零提交。

## 2. 整改统计

| 级别 | 总数 | 已修复 | 已登记/文档方案 | 未修复 |
| --- | --- | --- | --- | --- |
| P0 | 4 | 4 | 0 | 0 |
| P1 | 13 | 6（P1-01/P1-02/P1-03/P1-04/P1-05/P1-06） | 7（P1-07/08/09/10/11/12/13） | 0 |
| P2 | 2 | 1（P2-01） | 1（P2-02 测试计划） | 0 |

## 3. 关键设计修改

- **P0-01 RC 示例物理修正**：`MINIMAL_DATA_MODEL_EXAMPLE.md` 增加 `C1`（1 µF），接地约束改为 `target: gnd`，方程改为 `R1` 本构 + `C1` 本构 + `vout` KCL，`RC=1e-3 s`，`t=RC` 时 `v_vout=0.6321205588 V`，`i_R1=i_C1=0.0003678794 A`。拓扑/方程/约束/数值四者一致。
- **P0-02 接口统一**：`CORE_INTERFACE_CONTRACTS.md` 的 `EngineSpec` 增 `factory: Callable[["EngineSpec"], "Engine"] | None`；`PluginFacade` 补齐 `register_edge_kind()`、`read_compiled_summary()`；`ENGINE_SPI_V2.md` 的字段表与之一致。
- **P0-03 对象关系**：权威 `PortDesc` 定义在 `CORE_MODEL_V2.md` §4（port_id/direction/port_type 等），`MINIMAL_DATA_MODEL_EXAMPLE.md` 明确声明为示意子集并只引用、不重复定义；`NodeDesc.ports` 为 `tuple[PortDesc, ...]`，JSON 的 `ports` 为 port_id 字符串列表并在加载时转换；`NodeDesc` 增 `name`/`initial_data`，`SceneDesc` 增 `id/domain/presentation/compat`，运行时类 `NodeRuntime`/`ConnectionRuntime` 已定义。
- **P0-04 外观归属**：`CORE_MODEL_V2.md` 的 `NodeDesc` 删除 `appearance`；`MINIMAL_DATA_MODEL_EXAMPLE.md` 把颜色放入 `presentation.node_styles`（按节点 id 关联），不进物理模型/编译缓存键。
- **P1-01 机械示例**：`m·dv_body/dt = F - b·v_body`，`ground` 固定，`v_body(t)=v0·exp(-bt/m)`；`t=0.5 s` 得 `0.3678794412 m/s`，不再把 `v_body` 置零。
- **P1-02 不可变契约**：`CORE_INTERFACE_CONTRACTS.md` 增加 `Mapping` 字段构造时 `copy.deepcopy` 契约；当前 V2 `Runtime` 类尚未实现，`test_runtime_state_isolation` 以深拷贝映射验证契约，真实 Runtime 类隔离待实现阶段补测（本报告如实标注该证据强度限制）。
- **P1-03 字段迁移**：`MIGRATION_AND_COMPATIBILITY.md` 增 §7 逐字段表（NodeRecord/EdgeRecord 全字段、默认值/转换/是否计算/丢失处理）与 §8 完整 V1 JSON → V2 JSON 示例（含 state 入 Runtime、appearance/layout 入 Presentation 的解释）。
- **P1-04 物理守恒**：`TYPED_PORT_SYSTEM.md` 增 §10 across/through 定义、参考方向与符号约定，以及电学/机械平动/热学三套完整端口-连接-守恒-本构方程示例。
- **P1-05 三型边**：`CORE_MODEL_V2.md` 增 §12 `DependencyEdge`/`PhysicalEdge`/`LayoutEdge` 独立 dataclass、JSON 示例、`validate_edge` 校验逻辑与参与编译/布局判定表。
- **P1-06 可复现工具**：新增 `tools/check_stage4_docs.py`（真实检查，非空检查）与 `netlab/tests/test_stage4_document_contracts.py`；检查失败返回非 0，语义项显式标记 `MANUAL`。
- **P2-01 SI 量纲**：`TYPED_PORT_SYSTEM.md` 与 `CORE_INTERFACE_CONTRACTS.md` 统一为 7 基本量纲 `[L, M, T, I, Θ, N, J]`，四类物理量向量均改 7 元。
- **P1-07–P1-13、P2-02**：全部写入 `V2_IMPLEMENTATION_GAP_ANALYSIS.md`（Description/Runtime 隔离方案、PortSpec 差距、EdgeRecord 拆分、全局注册表隔离、插件信任边界、load_payload 流程、v6/v7 兼容、测试计划）；P1-03/04/05 的正式设计正文已回写对应主文档。
- **争议项 ADR**：新增 `adr/ADR-008-stage4-open-decisions.md`，把决策 A/B/C 列为 Open Decision（选项/后果/推荐，Proposed，不代替用户裁定）。

## 4. 验证结果

- `python tools/check_stage4_docs.py` → `STAGE4 DOC CHECK PASSED`（并打印 `MANUAL: semantic review ...`）。
- `python -m pytest netlab/tests/test_stage4_document_contracts.py -q` → 3 passed（含 checker 反例测试与 deepcopy 隔离测试）。
- 9 份文档逐份 `ast.parse` / `json.loads` / Mermaid 裸竖线检查：由 `tools/check_stage4_docs.py` 覆盖核心契约；完整语法检查沿用阶段 4 的 `_stage4_validate.py`（仓库根，非提交物）。
- 全量 `python -m pytest netlab/tests -q --junitxml=reports/pytest.xml --cov=netlab/core --cov-branch --cov-report=json:coverage.json` → **945 passed / 1 skipped / 0 failed / 236.37s**，core 覆盖率 **81.380784%**（12445/14619）；新增 3 个契约测试。阶段 5 的 942 基线保留为历史，本结果为本轮整改实测。

## 5. 仍未解决问题

- 第④轮「另一 Agent 独立评审」初评已执行（独立只读 Agent `13d009cb`），结论「不通过」；A1–A4/B1–B6/C1–C3 已按最小放行清单修复，详见 `STAGE4_INDEPENDENT_REVIEW.md`。复评尚未执行，本报告不能自称「通过」。
- 第①轮审查残留已修复：`MINIMAL_DATA_MODEL_EXAMPLE.md` 标题/章节的节点计数改为 RC 3 节点+2 边、机械 2 节点+1 边；`CORE_MODEL_V2.md` 13 类对象表删除 NodeDesc 的「外观」并新增独立 `class PortDesc`；`CORE_INTERFACE_CONTRACTS.md` 的 `RuntimeManager.create` 明确 `spec.factory` 创建 Engine；`EXTENSIBILITY_ARCHITECTURE.md:427` 的第三处 `EngineSpec` 标注为 V1 历史示意、以 `CORE_INTERFACE_CONTRACTS.md` 为唯一 V2 定义。以上均纳入 `tools/check_stage4_docs.py` 回归断言。
- 决策 A（显式 Runtime 快照）、B（Plugin 权限边界）、C（v6 兼容窗口）仍 `PENDING_USER_AUTHORIZATION`，见 ADR-008。
- P1-07/P1-09/P1-10/P1-12 的代码级整改方案已设计，但按任务书「只形成整改方案不改代码」未实施。
- 阶段 5 P1-R1 已在任务书到达前完成并 push（`eaec04a`）；是否需要回退/保留由用户在阶段 4 验收后裁定，本报告不擅自回退。

## 6. 阶段 4 是否可验收

**当前判定：不通过（初评未通过，复评待进行）**。任务书要求四轮验收；第④轮独立评审初评已执行并判「不通过」，A1–A4/B1–B6/C1–C3 已修复，但第④轮复评尚未执行，不能标阶段 4 正式验收完成。

- P0-01–P0-04：全部修复，有 file:line 证据与 checker 断言。
- 关键 P1-01/P1-02/P1-03/P1-04/P1-05/P1-06：已修复并有测试或文档正文。
- P1-03–P1-13/P2-02：已形成可评审的差距分析与方案文档，无遗漏。
- 判定依据：四轮验收未齐（第④轮初评未通过、复评未执行），按任务书定义 `通过 = 所有 P0 + 关键 P1 + 独立评审通过`；完成独立复评并复核残留后才可重评。

## 7. 阶段 5 建议

- 阶段 5 P1-R1 生产代码重构已在任务书前完成（`eaec04a`，三条 CI success），本次整改未继续阶段 5/6。
- 建议：**冻结阶段 5 之后的新阶段**，先完成阶段 4 第④轮独立评审与用户验收；若验收要求回退阶段 5，再按独立分支处理，不 force/rebase/amend。
- 阶段 6–13 继续 `PENDING_USER_AUTHORIZATION`，不自动启动。