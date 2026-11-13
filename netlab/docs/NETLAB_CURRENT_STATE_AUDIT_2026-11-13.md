# NetLab 当前状态复核与第一批整改报告（2026-11-13）

> 性质：**只读审计 + 整改准备**。基于 GitHub `qgfn106-blip/NetLab` 最新 `main` 实测，非旧 HEAD。本轮**不改任何生产代码**（`solver.py` / `descriptor.py` / `graph.py` / `scene.py` / `simulation.py` / `project.py` / `scene_types.py` / `blocks.py` 均未改），未动 FEM，未做大规模结构重构，未删旧格式兼容。
> 结论只覆盖「本轮可做」范围：状态同步 + Port Schema 设计 + 阶段6 对拍材料整改 + 8 项核心代码整改设计。修复实施需用户授权。

## 1. 三行交付
1. **改了什么**（仅文档/状态，无生产码）：同步 4 个状态文件到最新事实；新增 Port Schema 统一设计、8 项核心代码整改设计、本报告；整改阶段6 三份对拍文档并纳入探针脚本。
2. **跑了什么**：本地全量 pytest（2026-11-13 01:12：953 passed / 1 skipped / 322.70s，core line 81.528757%）；`status.json` / `reports/test_status.json` 于 01:56:47 另记录一次全量 953/1/0、400.41s、81.53%（绑 `aa2e30b`）；switch 对拍实验（两后端一致）；性能中位数复测。均为本地结果（不冒称 CI）；`c70091d` 的 GitHub CI 已于本文件文末「补记」回填（见 `latest_ci_runs` 行）。
3. **输出**：状态基线已对齐最新 `main`；见 §2–§8 与两份配套文档。

## 2. 事实基线（8 字段）
| 字段 | 值 |
|------|----|
| latest_main_sha | `c70091d788524b75134a5a00946e7cce5f8fa095`（`origin/main` 同值；2026-11-13 本地 `git rev-parse` 实测、工作树 clean） |
| latest_production_code_sha | `212a8908c190aa9fde018bda974b69413ea1e5bf`（`e41160f` 之后唯一触及生产码；fix(core) 插件引擎加载链 P1-1） |
| tested_sha | `aa2e30bd59b7fb1fa5c5491d231bae596348bf8e`（`status.json` / `reports/test_status.json` 绑定；`c70091d` 为 status-only 尾提交，按 `PROJECT_STATUS.md §4` 不自引用） |
| test_count | 953 passed / 1 skipped / 0 failed（`status.json`：400.41s；01:12 本地另一次 322.70s） |
| coverage | core line 81.53%（`status.json`）；01:12 本地另一次 81.528757%（12474/14630） |
| latest_ci_runs | 审计时 `CI_NOT_VERIFIED` → **事后回填 `CI_VERIFIED`**（`c70091d`：3 workflow run `43274818892`/`43274818886`/`43274818874` + 5 check-run 全 `completed/success`，2026-11-13 经 GitHub REST API 直连取得，详见文末「补记」；依 V3 §4 本地 953 passed 不冒称 CI，历史 `4dc7bdd` 仅作历史） |
| current_stage | 阶段 5 整体 open；**阶段 6–13 均 `PENDING_USER_AUTHORIZATION`、未启动未验收**；只读审计/对拍材料已产出但依 `PROJECT_OPTIMIZATION_EXECUTION_PLAN.md:14` 不构成阶段交付物；**AC/Bode 生产代码统一未实施** |
| stage_acceptance | 阶段 4 正式验收已批准；阶段 5 子目标达成但整体 open（未标完成） |
| pending_authorization | 阶段 6 AC/Bode 生产统一、阶段 7–13、ADR-008 三项 A/B/C、P0-2 全链路改造、push / 发布 |

**明确区分**：仓内阶段 6 只读审计/对拍材料已产出 ≠ 阶段 6 已获授权/已验收 ≠「AC/Bode 生产代码统一已实施」。依 `PROJECT_OPTIMIZATION_EXECUTION_PLAN.md:14`，未获明确批准前下一阶段只能只读了解、不得产生实现或正式文档交付物；后者未做、需授权。

## 3. A. 状态文件同步（已改）
- `PROJECT_STATUS.md`：§1 baseline 表 main→`c70091d`、生产码→`212a890`、测试→`status.json` 的 `953/1/0、400.41s、81.53%`、CI→`CI_NOT_VERIFIED`；§1.1「本轮状态复核（8 字段）」同步刷新；阶段 6 统一为 `PENDING_USER_AUTHORIZATION`、只读材料不记阶段完成；ADR-008 三项统一为 `PENDING_USER_AUTHORIZATION`（原文「1112n 授权 A/B/C 升格」无原始授权记录可核实，2026-11-13 复核已撤销）。
- `CORE_ARCHITECTURE_V2_ROADMAP.md`：当前事实基线刷为 `c70091d` / `212a890` / `aa2e30b`（tested）/ 953 / 81.53% / `CI_NOT_VERIFIED`。
- `NETLAB_REVIEW_AUDIT_2026-11-12.md`：§A main/测试/生产码/CI/阶段 按当前事实纠正；§B stage5 保持「子目标达成、整体 open」、stage6 统一为 `PENDING_USER_AUTHORIZATION`；§I P0-2 标为「提案/待用户裁决」（与 `ADR-003` `Proposed` 对齐）；§J 移除已获用户批准的「阶段 4 正式验收」待授权 stale 项；「1112n 恢复授权/已授权升格」表述已撤销。
- `status.json` / `reports/test_status.json`：已于 2026-11-13T01:56:47+08:00 由 `c70091d` 重新生成（实测文件已更新）；`head` 绑定被测试提交 `aa2e30b`（status-only 尾提交不自引用，见 `PROJECT_STATUS.md §4`）。
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
- **下一阶段任务**：(a) 用户就 8 项与 Port Schema 7 个待拍板点给方向后，逐项先写失败测试再修复；(b) 阶段6 等价性测试设计（把 14 场景固化为 `tests/test_p1r2_ac_parity.py` + 失败行为用例，仍只读）；(c) ~~CI 侧在 `c70091d` 取得绑定精确 SHA + workflow run ID 的 check-run 证据后才写结论~~ **已完成**（2026-11-13 事后取得并回填，见文末「补记」）。

## 8. 修复状态分类
- **已修复**：无（本轮不改生产码，仅文档/状态）。
- **只有设计**：#1–#8（核心代码 8 项）+ Port Schema 统一方案（B）。
- **仍待授权**：全部生产代码修复、阶段6 AC/Bode 生产统一、阶段7–13、ADR-008 A/B/C 落地、P0-2 全链路改造（含 Web/插件）、FEM 相关（硬冻结）。

## 9. 验收自检
- 测试绑定：01:12 本地全量在 `8f9344f` 树实跑（953/1/322.70s）；`status.json` / `reports/test_status.json` 于 2026-11-13T01:56:47 重新生成并绑定 `aa2e30b`（953/1/0、400.41s、81.53%），`c70091d` 为 status-only 尾提交不自引用；两次均为本地结果，未把旧 SHA 结果冒充当前基线，未冒称 CI 证据。
- 未放宽断言、未用 Fake 冒充 Runtime 验证；未删旧格式兼容；未改 FEM / `graph.py` 大规模结构 / `scene.py` 大规模结构 / 外部工程格式。
- 阶段授权：阶段 6–13 均 `PENDING_USER_AUTHORIZATION`、未启动未验收；仓内只读审计/测试设计材料依 `PROJECT_OPTIMIZATION_EXECUTION_PLAN.md:14` 不构成阶段交付物；未实施 AC/Bode 生产统一。

---

## 补记（2026-11-13 03:00 Asia/Shanghai）：`c70091d` 的 CI 证据事后取得并回填

> 本文件为 2026-11-13 01:xx 的时点审计报告，正文 `CI_NOT_VERIFIED` 是**审计当时**的真实结论，按「历史章节不全局改写」原则保留；此处仅追加事后取得的证据，不构成对原审计结论的改写。当前事实源以 `PROJECT_STATUS.md` 为准。

- Repository：`qgfn106-blip/NetLab`；Commit SHA（head_sha）：`c70091d788524b75134a5a00946e7cce5f8fa095`；Event：`push`
- Checked At：2026-11-13 03:00（Asia/Shanghai），经 GitHub REST API 直连 `curl --noproxy '*'`（HTTP 200）取回；聚合 API 出口受 rate-limit 403，未采用其数据
- Workflow run（Run ID / Conclusion / Run URL），3 个全部 `completed/success`：
  - `python-tests` #134 / `43274818892` / `success` / https://github.com/qgfn106-blip/NetLab/actions/runs/43274818892
  - `frontend-ts-build` #168 / `43274818886` / `success` / https://github.com/qgfn106-blip/NetLab/actions/runs/43274818886
  - `container` #93 / `43274818874` / `success` / https://github.com/qgfn106-blip/NetLab/actions/runs/43274818874
- Check-run（5 个，全 `completed/success`）：`test` `131380307795`、`desktop-l2` `131380307574`、`build` `131380308274`、`e2e-l1` `131380308763`、`docker` `131380308489`
- 时间窗：2026-11-12T17:57:29Z → 18:01:50Z（Asia/Shanghai 01:57 → 02:01）
- legacy combined status API：`state=pending total_count=0`（以 check-runs 为准，不写「CI 全绿/失败」）
- V3 §4 边界：本证据仅覆盖 `c70091d` 的 3 个 workflow；本地 953 passed 仍为本地运行、不冒称 CI（尽管 `python-tests` 的 `test` check-run 在 CI 侧跑过全量 `pytest netlab/tests -q`，但本仓库 `status.json` 数字仍绑本地 `aa2e30b`，两者分开记录）；本轮新增的纯文档/测试提交未 push、未被该 CI 覆盖（`CI_NOT_VERIFIED`）
- 对应本文件 §7 下一阶段任务 (c)：已完成

## 补记（2026-11-13 19:52 Asia/Shanghai）：既有代码缺陷修复 3 项已落地并推送

> 本文件为 2026-11-13 01:xx 时点审计报告，正文「已修复：无 / 只有设计 / 仍待授权：全部生产代码修复」是审计当时真实结论，按「历史章节不全局改写」原则保留；此处追加事后事实，不构成对原审计结论的改写。当前事实源以 `PROJECT_STATUS.md` 为准。

- 2026-11-13 执行者会话按依赖序 7→3→2 落地 3 项最小生产代码修复（#7 `is_known_mode` 非 str 防护、#3 source stepping 末次 Newton 补 `deadline`、#2 `capture_checkpoint`/`restore_checkpoint` 冻结恢复 `_startup_pending`），提交 `1ab22c3`；红测 `5c76741` 6 条由 `xfail(strict=True)` 转绿并移除标记。
- 全量 `pytest netlab/tests -q`：959 passed / 1 skipped / 0 failed（审批方独立复跑 126.99s，本地非 CI）；`status.json`/`reports/test_status.json` 绑 `1ab22c3`（316.28s，core line 81.61%）。
- 已 push 到 `origin/main`=`4975f90`（4 提交 `9b67c2a`/`5c76741`/`1ab22c3`/`4975f90`）；`4975f90` 的 GitHub CI 未取得，标 `CI_NOT_VERIFIED`；`c70091d` 的 CI_VERIFIED 仅覆盖 `c70091d`。
- 边界：#5（Newton 主路径，最高风险）与 #1/#4/#6/#8、阶段 6 AC/Bode 生产统一、阶段 7–13、ADR-008 A/B/C、P0-2 全链路均仍 `PENDING_USER_AUTHORIZATION`；本轮 3 项修复按「既有代码缺陷修复」记录，不计入阶段 6 交付物。
- 授权记录：用户在本会话（NetLab项目优化 `session-c20e8127`）2026-11-13 19:06 原话「push，，按依赖序 `7→3→2` 落地，把这份完工报告原文投递给 `03a3e6b4` 做复核」为本轮 push 与 3 项修复的原始授权记录。
