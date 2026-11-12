# 阶段 4 P1-A 第④轮独立评审记录

> 状态：`Proposed`。本文件只登记独立评审输入与整改状态，不构成阶段 4 验收结论。

## 1. 初评（2026-11-12，HEAD a38fd6b）

评审方：独立只读评审 Agent `13d009cb`。结论：**不通过（第④轮初评）**。数学物理与 V1 代码对应全绿；阻断问题 A1–A4、次要 B1–B6、验证工具 C1–C3。

- A1 `PortType`/`PortDesc` 在 CORE_MODEL_V2 与 MINIMAL 中双定义且字段不同。
- A2 `SceneDesc` 与 MINIMAL/MIGRATION 示例封套字段不一致。
- A3 CORE_MODEL_V2 的 Edge JSON 示例用 `type`，`validate_edge` 读 `kind`。
- A4 `NodeDesc.ports` 与 JSON 字符串列表不符；MIGRATION 的 `initial_data` 为幻影字段。
- B1 boundary `value` vs `expression`；B2 `CompiledModel` 缺 `cache_key_excludes`/`diagnostics`；B3 `PortDirection`/`NodeRuntime`/`ConnectionRuntime` 未定义；B4 `PluginFacade` 注册面不足 9 类；B5 `SceneEdit` 签名不一致；B6 报告表述不实。
- C1 checker 仅子串检查；C2 负例未命中短路分支；C3 P1-02 测试未实例化 frozen dataclass。

## 2. 复评一（2026-11-12，HEAD a38fd6b）

评审方：独立只读评审 Agent `a32ae825`。结论：**有条件通过**。A1/A3/A4/B1–B5 已修；A2 封套、B6 表述、C1 字段级仍待收口。

## 3. 复评二（2026-11-12，HEAD a38fd6b，Agent 3bc1afbf）

评审方：独立只读评审 Agent `3bc1afbf`。结论：**有条件通过（无阻断问题）**。A1–A4 主缺陷闭环、B1–B5/C2/C3 闭环；非阻断问题 7 项，已处置：

1. `TYPED_PORT_SYSTEM.md:105/108/114/120/126` 的 `reference`/`component_id` 未在 PortType/PortDesc 定义 → 已在 `CORE_MODEL_V2.md` 的 `PortDesc` 增加 `reference: str = "node"` 与 `component_id: str = ""`。
2. `CORE_OBJECT_RELATIONSHIP.md:63/65` 的 `NodeRuntime.value`/`ConnectionRuntime.current` → 已改为 `NodeRuntime.state["value"]` / `ConnectionRuntime.state["current"]`。
3. `MINIMAL_DATA_MODEL_EXAMPLE.md` scene 缺 `compat` → 已增 `"compat": {}`。
4. 电阻/电容 params 键名统一 → MINIMAL 已改为 `"R": 1000.0`、`"C": 1.0e-6`。
5. 敏感占位文件小节编号重复 → 该文件已从版本库移除。
6. `tools/check_stage4_docs.py` 的 A3/A4 仅 token 级 → 已增加 `json.loads` 后 Edge JSON `kind/source_port/target_port` 字段级断言，以及 MINIMAL node `ports` 为 `list[str]`、CORE `ports: tuple[PortDesc,...]` 的断言。
7. STAGE4 §8 自证表述 → 已改为「本记录仅登记独立评审输入，不构成阶段4验收结论」。

## 4. 复评三（2026-11-12，HEAD 501ae78 + 文档一致性修复，Agent 901215bc）

评审方：独立只读评审 Agent `901215bc`。结论：**有条件通过（无阻断问题）**；A1–A4、B1–B6、C1–C3 均闭环，数学物理正确；另有 9 项非阻断字段级/文档卫生问题。已全部处置：

1. `MIGRATION_AND_COMPATIBILITY.md:106` 的 `source_pin/target_pin` 映射改为 `EdgeDesc.source_port/target_port`；
2. `EdgeRecord.delay` 迁移口径改为 V1 bool → V2 数值秒 `0.0`（true 保留 0.0 并记告警）；
3. `PROJECT_STATUS.md` 测试基线统一为 945 passed / 81.380784%，942 标注为阶段5历史；
4. `PROJECT_STATUS.md:100` 阶段4复评表述改为「有条件通过（无阻断），待最终复评/用户批准」；
5. `MINIMAL_DATA_MODEL_EXAMPLE.md` 机械场景补 `revision`/`compat`/`presentation`；
6. 机械边 params `damping` 改为 `b`，与方程一致；
7. `CORE_MODEL_V2.md` §3 对象表 SceneDesc 去掉「时钟」、Variable 去掉「所属节点/边」，与 §4 dataclass 对齐；
8. `CORE_MODEL_V2.md` 文件头删除旧测试基线数字，改为以 git rev-parse/status.json 为准；
9. `TYPED_PORT_SYSTEM.md` 的 `reference=node vin` 改为 `reference=node（节点 id=vin）`。

验证：`check_stage4_docs.py` PASS；契约/隐私/SSOT 6 passed。最终结论仍以「有条件通过（无阻断）」记录，待最终复评/用户批准，不自行标正式验收。

## 5. 数学物理核验

RC：`R=1000Ω, C=1µF ⇒ τ=1e-3s`，`v_out(τ)=0.6321205588V`，`i_R1=i_C1=3.678794e-4A`，KCL 自洽。机械：`m dv/dt = F - b v`，`v(0.5)=e^-1=0.3678794412m/s`。七维量纲 `[L,M,T,I,Θ,N,J]` 与三域守恒正确。

## 6. 结论与残余风险

- 阶段4第④轮仍未封口；非阻断问题已修，仍须按任务书安排最终独立复评，并由用户明确批准后才可标阶段 4 正式验收完成。
- 残余：`type/kind` 负向守卫目前仅覆盖 CORE_MODEL_V2；MINIMAL/MIGRATION 为示意子集，字段以 CORE_MODEL_V2 §4 为准。

## 7. 最终复评停止规则与评审汇总

评审汇总：

| 阶段 | Agent | 评审 HEAD | 结论 | 遗留项处理 |
| --- | --- | --- | --- | --- |
| 初评 | `13d009cb` | a38fd6b | 不通过 | A1–A4/B1–B6/C1–C3 |
| 复评一 | `a32ae825` | a38fd6b | 有条件通过 | A2/B6/C1 |
| 复评二 | `3bc1afbf` | a38fd6b | 有条件通过（无阻断） | 7 项非阻断 |
| 复评三 | `901215bc` | 501ae78 | 有条件通过（无阻断） | 9 项非阻断 |
| 封口评审一 | `d65f7a81` | 78dc86f | 有条件通过（无阻断，6 项非阻断） | N1–N4/N6 已修，N5 已标注 |
| 封口评审二 | `a25c3774` | 78dc86f | **通过（无阻断、无 fail、无新增轮次）** | 2 项文案改善项已修 |

停止规则（2026-11-12 冻结）：评审对象冻结为当前 HEAD 的九份文档 + `tools/check_stage4_docs.py` + `test_stage4_document_contracts.py`；由与上述四个初始 Agent 不同的第三方独立 Agent 按字段级检查表评审一次。若结论为「通过·无阻断·无新增项」，即封口，不再因非阻断文字项追加新一轮；非阻断项记入待办但不阻塞封口。最终阶段 4 正式验收仍须用户明确批准（PENDING_USER_AUTHORIZATION），审批方只读不代替。

## 8. 封口评审结果（2026-11-12，HEAD 78dc86f + 工作树修复）

- `d65f7a81`（第三方独立，read-only）：`conditional_pass`，无 blocking，14 项中 13 pass；N1–N6 为非阻断（MIGRATION 物理边端口、MINIMAL diagnostics、示例字段子集、checker 浅层项、FakeCompiledModel 替身、validate_edge 异常类型）。
- 已修复 N1–N4/N6：MIGRATION 节点补 `name`/`ports`、物理边补 `source_port`/`target_port`；MINIMAL 节点补 `initial_data`、编译产物补 `diagnostics: []`；checker 收严 factory/9 个 register 方法/JSON 块 type 检查；`validate_edge` 改抛 `ModelValidationError`。N5 保持如实标注。
- `a25c3774`（另一独立 read-only 最终复核）：`verdict: pass`，无 blocking、无 fail、无新增轮次；14 项全部 pass；数学/量纲复算一致；仅 2 项文案改善（机械节点 `initial_data`、TYPED 重复词），均已修。
- 结论：第④轮封口评审已达成「通过·无阻断·无新增项」；阶段4正式验收仍须审批四轮齐备性复核 + 用户明确批准，`PENDING_USER_AUTHORIZATION`。
