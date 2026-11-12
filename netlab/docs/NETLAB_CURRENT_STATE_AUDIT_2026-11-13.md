# NetLab 当前状态复核与第一批整改报告（2026-11-13）

> 性质：**只读审计 + 整改准备**。基于 GitHub `qgfn106-blip/NetLab` 最新 `main` 实测，非旧 HEAD。本轮**不改任何生产代码**（`solver.py` / `descriptor.py` / `graph.py` / `scene.py` / `simulation.py` / `project.py` / `scene_types.py` / `blocks.py` 均未改），未动 FEM，未做大规模结构重构，未删旧格式兼容。
> 结论只覆盖「本轮可做」范围：状态同步 + Port Schema 设计 + 阶段6 对拍材料整改 + 8 项核心代码整改设计。修复实施需用户授权。

## 1. 三行交付
1. **改了什么**（仅文档/状态，无生产码）：同步 4 个状态文件到最新事实；新增 Port Schema 统一设计、8 项核心代码整改设计、本报告；整改阶段6 三份对拍文档并纳入探针脚本。
2. **跑了什么**：全量 pytest（953 passed / 1 skipped / 322.70s，core line 81.528757%）；switch 对拍实验（两后端一致）；性能中位数复测。
3. **输出**：状态基线已对齐最新 `main`；见 §2–§8 与两份配套文档。

## 2. 事实基线（8 字段）
| 字段 | 值 |
|------|----|
| latest_main_sha | `8f9344f67910caa3f738bbef5153f2aa897d3e5a` |
| latest_production_code_sha | `212a8908c190aa9fde018bda974b69413ea1e5bf`（`e41160f` 之后唯一触及生产码；fix(core) 插件引擎加载链 P1-1） |
| tested_sha | 本轮全量测试绑定 HEAD=`8f9344f`（生产代码 212a890，其上为 docs-only） |
| test_count | 953 passed / 1 skipped / 0 failed（322.70s） |
| coverage | core line 81.528757%（12474/14630） |
| latest_ci_runs | `8f9344f` 本轮刚 push，GitHub check-run 待产出（本轮未取得证据，如实标「待查」）；历史 `4dc7bdd` 的 5 check-run 均 success 仅作历史 |
| current_stage | 阶段 6（P1-R2）**只读审计已完成**；**AC/Bode 生产代码统一未实施** |
| stage_acceptance | 阶段 4 正式验收已批准；阶段 5 子目标达成但整体 open（未标完成） |
| pending_authorization | 阶段 6 AC/Bode 生产统一、阶段 7–13、ADR-008 升格落地、P0-2 全链路改造 |

**明确区分**：阶段 6「只读审计已完成」（四文档）≠「AC/Bode 生产代码统一已实施」。后者未做、需授权。

## 3. A. 状态文件同步（已改）
- `PROJECT_STATUS.md`：§1 baseline 表 main→`8f9344f`、生产码→`212a890`、测试→`953/1/322.70s/81.528757%`、CI 标「待查」；新增 §1.1「本轮状态复核（8 字段）」；阶段表阶段6 由「未开始」→「只读审计已完成、生产统一未实施」；ADR-008 记「1112n 授权 A/B/C 升格、落地待执行」。
- `CORE_ARCHITECTURE_V2_ROADMAP.md`：当前事实基线刷为 `8f9344f` / `212a890` / 953 / 81.528757%。
- `NETLAB_REVIEW_AUDIT_2026-11-12.md`：§A main/测试/生产码/CI/阶段 全部按最新事实纠正；§B stage5「暂停」→「1112n 恢复授权」、stage6「未开始」→「只读审计已完成、生产统一未实施」；§I P0-2 由「方案A还是B未定」→「已定方案A」。
- `status.json` / `reports/test_status.json`：按机制在最终 HEAD 重新生成（见 §9）。
- `DOCS_INDEX.md`：日期更新 + 登记新增文档。

## 4. B. Port Schema 统一审计（设计，见 `P0-2_PORT_SCHEMA_UNIFICATION_DESIGN.md`）
- 三套「端口」并存不可混称：V1 `blocks.PortDef`（可变，name 唯一，已实现）；V2 `CORE_MODEL_V2.PortDesc`+`PortType`（frozen、port_id 身份、文档草案零实现）；第三套 `ports.PortSpec/PinSpec`（器件引脚，非块端口，decision 明确不迁移）。
- 字段映射要点：name→port_id（V1 name 只能进 metadata）；direction inout→bidirectional（有损）；dtype/fields→PortType.dtype/shape/domain/quantity/unit；**default/net 在 V2 无对应（缺失）**；port_id/schema_version/domain/unit/dimension/cardinality/connection_semantics 需新增。
- 插件 GAP：`plugin_api/v1/__init__.py:215` 未导出 PortDef/PortDesc/PortType；建议新增导出 + 可选 `BlockSpec.ports`，PLUGIN_API_VERSION 1.0→1.1 兼容。
- 发现冲突（均带 file:line）：方案A内嵌 vs MINIMAL_DATA_MODEL 依赖 Registry；JSON 形态被 `check_stage4_docs.py` 写死 `list[str]` 与 CORE_MODEL_V2 要对象数组矛盾；MIGRATION 文档误纳 PortSpec；MINIMAL version:8 vs 代码 PROJECT_VERSION=7；V1 inout vs V2 无 inout；direction 重复定义；端口按 name 接线、改身份键会断线。
- 待拍板（文档 §8 对照表）：P1 方案A/B；P2 inout 处理；P3 版本升 8；P4 metadata 是否入哈希；P5 direction 归属；P6 default/net 是否升正式字段；P7 插件 BlockSpec.ports/复用 ComputeSpec。

## 5. C. 阶段6 对拍材料整改（已改三文档）
- `P1-R2_PARITY_MATRIX.md`：判据收紧为 `max_rel(complex)<1e-9 且 max_abs<1e-12`；**新增 switch_closed(#13)/switch_open(#14) 实测（两后端 max_rel=0）**；MATCH 场景 9→**12 个**、拓扑 12→**14 个**；性能改中位数法（Legacy 0.604ms / Descriptor 0.288ms ≈ **2.1×**，纠正原单次 3–4×）；探针脚本纳入 `tools/p1r2_parity_probe.py`。
- `P1-R2_BACKEND_CONSTRAINTS.md`：switch 由「待验证」→「已消解」，「三处不等价」→「两处（奇异错误语义 + 不支持元件文案）」；**§3 奇异 E 表述纠正**：E 奇异是 DAE 正常性质，真奇异是 `A+sE` 秩亏（拓扑约束冗余/互斥），非「E 退化」。
- `P1-R2_CONVERGENCE_PLAN.md`：G5 不等价由 3→2 处；共同支持域补 switch；等价性测试固化 14 场景；与 ROADMAP 的 P1-R2 收敛目标（非奇异/奇异/病态/多端口对拍 + 误差阈值 + 回滚）对齐。
- 未改 `solver.py` / `descriptor.py`。

## 6. D. 核心代码 8 项整改设计（见 `CORE_CODE_REMEDIATION_DESIGN.md`）
| # | 模块:行 | 问题 | 严重度 | 状态 |
|---|---------|------|--------|------|
| 1 | `compute/simulation.py:561-575/615-624` | 预计算失败/取消 Runtime 恢复不完整（load 默认 include_state=False 丢 state/清 engine） | 中 | 仅设计 |
| 2 | `compute/circuit/solver.py:271-280` | `capture_checkpoint` 未保存 `_startup_pending` | 低 | 仅设计 |
| 3 | `compute/circuit/solver.py:471-473` | Source Stepping 末次 Newton 遗漏 `deadline` | 低 | 仅设计 |
| 4 | `model/graph.py:597-602/618-621` | `solver_plan` 断点重引入依赖边、排序失败任意追加 | 中 | 仅设计 |
| 5 | `model/graph.py:855-864` | 非线性 SCC Newton 重复推进外部状态连接 | **高（最高风险）** | 仅设计 |
| 6 | `model/project.py:972/978` | `decode_project_bytes` 解压后才判 8MB（zip-bomb） | 中 | 仅设计 |
| 7 | `model/scene_types.py:13-22` | `is_known_mode` 非字符串缺类型防护 | 低 | 仅设计 |
| 8 | `model/blocks.py:148-149` | 插件模式 ↔ BlockDef 模式边界不一致 | 低 | 仅设计 |

每项在配套文档均含：位置、根因、影响、最小修复、失败测试（先红）、回归测试、风险。

## 7. 问题清单 · 依赖顺序 · 风险分级 · 下一阶段任务
- **风险分级**：高 = #5（最高风险，改动 Newton 数值主路径，影响所有 solve_algebraic=True 非线性工程，建议 feature flag 分阶段放开）；中 = #1 #4 #6；低 = #2 #3 #7 #8。
- **依赖/建议实施序**：7 → 3 → 2 → 8 → 6 → 4 → 1 → 5（高危先评审；#5 最后、feature flag）。
- **下一阶段任务**：(a) 用户就 8 项与 Port Schema 7 个待拍板点给方向后，逐项先写失败测试再修复；(b) 阶段6 等价性测试设计（把 14 场景固化为 `tests/test_p1r2_ac_parity.py` + 失败行为用例，仍只读）；(c) CI 侧在 `8f9344f` 产出后补 check-run 证据。

## 8. 修复状态分类
- **已修复**：无（本轮不改生产码，仅文档/状态）。
- **只有设计**：#1–#8（核心代码 8 项）+ Port Schema 统一方案（B）。
- **仍待授权**：全部生产代码修复、阶段6 AC/Bode 生产统一、阶段7–13、ADR-008 A/B/C 落地、P0-2 全链路改造（含 Web/插件）、FEM 相关（硬冻结）。

## 9. 验收自检
- 测试绑定：本轮全量测试在 `8f9344f` 树实跑（953/1/322.70s），未把旧 SHA 结果冒充新 HEAD；status.json/test_status.json 于最终 HEAD 重新生成。
- 未放宽断言、未用 Fake 冒充 Runtime 验证；未删旧格式兼容；未改 FEM / `graph.py` 大规模结构 / `scene.py` 大规模结构 / 外部工程格式。
- 未擅自扩大阶段授权：阶段6 仅完成只读审计与测试设计，未实施 AC/Bode 生产统一。
