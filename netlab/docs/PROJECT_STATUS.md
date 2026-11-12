# NetLab 项目状态（唯一事实源 · PROJECT_STATUS）

- **状态**：当前状态的唯一事实源（2026-11-11 建立；2026-11-12 阶段 4 设计冻结整改后刷新）。
- **最后刷新**：2026-11-12（Asia/Shanghai），随「阶段 4 设计冻结整改」更新。
- **阶段 4（P1-A）**：设计冻结整改已完成 P0-01–P0-04 与关键 P1，新增 `tools/check_stage4_docs.py` 与契约测试；全量 945 passed / 1 skipped / 81.380784%；第④轮独立评审最终复评已通过（无阻断）；阶段 4 可进入等待用户明确批准，仍不得标正式验收完成。
- **阶段 5（P1-R1）**：元件 Stamp 单一化已交付并 push `eaec04a`（三条 CI success、942 passed/81.3808%）；审批 2026-11-12 评估判「不允许进入阶段 6 · 需用户授权 · 暂停」，阶段 5 成果保留但不作放行依据，阶段 6–13 均 `PENDING_USER_AUTHORIZATION`。
- **维护规则**：本文件只记当前事实；路线/阶段表见 `CORE_ARCHITECTURE_V2_ROADMAP.md`，目标口径见 `CORE_ARCHITECTURE_V2.md`，执行约束见 `PROJECT_OPTIMIZATION_EXECUTION_PLAN.md`（该文件为 2026-11-11 快照，动态状态委托本文件），架构决策见 `docs/adr/`，历史完成记录见 `PROGRESS.md`。机器可读字段以 `status.json` / `reports/test_status.json` 为准。

## 1. 当前基线事实（四类事实分离）

| 项 | 当前事实 |
|---|---|
| 仓库 | `NetlabHome/`，分支 `main` |
| 代码基线 HEAD | `b667e517450b5f050424fe76d623af0cdeaf4eb1`（最后一次改动代码的提交；阶段 4 与本轮收口均为 docs-only，已 push） |
| 精确 HEAD / ahead | 文档收口提交后以 `git rev-parse HEAD` 与 `status.json` 为准；提交自身无法自引用 |
| origin/main | 与本地 `main` 同步（push 已授权并执行；ahead 0 / behind 0，截至本轮收口提交） |
| 版本 | 3.20.1 |
| 测试基线 | 942 passed / 1 skipped / 0 failed；core 覆盖率 81.3808%（12445/14619，含 33 条新增 stamp 对拍用例） |
| 前端门禁 | typecheck / build / test（27 passed）/ verify:parity / check:sections（app.ts 7968 行）/ e2e 四脚本全过 |
| 阶段 3 三条 CI（绑 `b667e51`） | python-tests `43115278340`、frontend-ts-build `43115278356`、container `43115278600`，均 success |
| 阶段 2 三条 CI（绑 `8e7f583`） | container `43098331619`、python-tests `43098331551`、frontend-ts-build `43098331562`，GitHub runner 排队（status=queued / conclusion=null / jobs=[]），不作通过证据 |
| P1 架构审计 | `CORE_ARCHITECTURE_AUDIT.md`（448 行，2026-11-11），已随本轮文档收口提交入库 |
| 工作树 | 文档收口提交后仅余 `status.json` / `reports/test_status.json` 状态尾提交；`dirty` 标记为生成时刻快照，门禁不校验该字段 |

## 2. 阶段进度（用户 2026-11-11 正式裁决的阶段 0–13 顺序）

- 阶段 0（项目事实与文档基线）：已完成 —— 本文件、`docs/adr/`、V2 规划/路线/审计/评审/执行约束文档已收口提交。
- 阶段 1（P1-A-lite）：已完成 —— `ADR-005` Presentation 外观归属 = Accepted（lite）；其余 ADR 仍 Proposed，ADR≠代码实施授权。
- 阶段 2（P-B 元素级视图外观完整版）：已完成并 push 到 `8e7f583` —— 900 passed / 1 skipped / 81.376055%；评估整改见 `PROGRESS.md §7.154`。
- 阶段 3（R40 收尾：节点卡片自由字段编辑）：已完成并 push 到 `b667e51` —— 909 passed / 1 skipped / 81.404692%，三条 CI success；详见 `PROGRESS.md §7.153`。
- 阶段 4（P1-A 全量设计冻结）：9 份 Proposed 文档已交付；**2026-11-12 任务书整改完成**：P0-01–P0-04 全修复、P1-01/P1-02/P1-06 修复、P1-03–P1-13/P2-02 差距分析文档化，新增 `tools/check_stage4_docs.py` + `test_stage4_document_contracts.py`；第④轮独立评审最终复评通过（无阻断），待用户明确批准；详见 `PROGRESS.md §7.159`、`STAGE4_REMEDIATION_REPORT.md`。
- 阶段 5（P1-R1 Stamp 统一）：已于任务书前交付并 push `eaec04a`（三条 CI success、942 passed/81.3808%）；审批评估判「不允许进入阶段 6 · 需用户授权 · 暂停」，成果保留、不作放行依据。
- 阶段 6–13（P1-R2 / P1-S1 / P1-S2 / P1-S3 / P2 / P3 / P4 / P5）：未开始，保持 `PENDING_USER_AUTHORIZATION`。

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | 项目事实与文档基线 | 已完成（文档收口提交） |
| 1 | P1-A-lite（ADR-005-lite） | 已完成（Accepted） |
| 2 | P-B 元素级视图外观完整版 | 已完成（`8e7f583`） |
| 3 | R40 收尾：节点卡片自由字段 | 已完成（`b667e51`） |
| 4 | P1-A 全量设计冻结 | 整改完成但验收未完成（第④轮独立评审未执行，判不通过） |
| 5 | P1-R1 Stamp 统一 | 已交付 `eaec04a`，按任务书冻结待复核 |
| 6 | P1-R2 AC/Bode 统一 | 未开始 |
| 7 | P1-S1 Project/DTO | 未开始 |
| 8 | P1-S2 Engine SPI v2 | 未开始 |
| 9 | P1-S3 前端拆分 | 未开始 |
| 10 | P2 Core Model V2（A/B/C/D） | 未开始 |
| 11 | P3 Equation + Compiler（研究型最小原型） | 未开始 |
| 12 | P4 Runtime + Plugin V2 | 未开始 |
| 13 | P5 Validation / 机械 / 多物理场 / Control Flow | 未开始 |

## 3. 授权边界

| 项 | 状态 |
|---|---|
| push / 发布 | 用户 2026-11-12 睡前授权，已执行；禁 force / rebase / amend / 改写历史 |
| 阶段自动推进 | 用户授权「做完一阶段自动发审批 → 评估 → 修问题 → 继续」，不等待确认；但每阶段评估通过前不越级开工 |
| R25（完整电路级内部结构） | 暂停（用户 2026-11-11 裁决先做 P-B） |
| R43（M2） | 仅 opt-in |
| R19（参考级图纸） | 暂停 |
| Phase 3 架构债 / Phase 4 CI 证据 | `PENDING_USER_AUTHORIZATION`（阶段 5 P1-R1 已交付 `eaec04a`，但阶段 5 准入存在授权冲突，按 `PENDING_USER_AUTHORIZATION` 处理；阶段 6–13 未获用户明确授权，暂停；不得以本文件或历史提交自证授权） |
| 500 / 1000 / 5000 规模档 | `PENDING_USER_AUTHORIZATION`；`MAX_NODES=400` 默认不放宽 |
| Newton 选主元 / SCC 差分 Jacobian | `PENDING_USER_AUTHORIZATION` |
| `NETLAB_MATH_ACCEL` | 默认 off，不擅自放量 |
| FEM | 禁止改动 |
| `graph.py` / `scene.py` 大规模重构 | 未经授权不动 |
| 外部 JSON / 功能删除 | 不改、不删 |

## 4. 文档职责分离

- 本文件：当前状态唯一事实源（动态状态）。
- `status.json` / `reports/test_status.json`：机器可读测试/覆盖率/Git 快照，由工具生成；status-only 尾提交无法自引用，故 `head` 指向被测试的有效代码提交。
- `PROGRESS.md`：阶段完成记录（追加式，历史数字保留）。
- `BACKLOG.md`：主线待办与当前基线一句话现状（GENERATED 块由 `render_docs.py` 生成）。
- `CORE_ARCHITECTURE_V2.md`：目标口径（规划，不是当前实现）。
- `CORE_ARCHITECTURE_V2_ROADMAP.md`：P1–P5 路线与阶段顺序。
- `NETLAB_V2_PLANNING_REVIEW.md`：规划评审（只读报告）。
- `PROJECT_OPTIMIZATION_EXECUTION_PLAN.md`：2026-11-11 执行约束快照（九项验收与报告格式），动态状态委托本文件。
- `CORE_ARCHITECTURE_AUDIT.md`：P1 只读架构审计。
- `docs/adr/`：ADR-001..007 与索引；仅 ADR-005（lite）Accepted，其余 Proposed；ADR 不是实施授权。
- `REQUIREMENTS_AND_RULES.md`：需求 R01–R43 与决策台账（唯一需求口径）。

## 5. 阶段 2 评估整改（2026-11-12）

「Netlab 项目审批」会话 07:07 的阶段 2 只读评估针对 05:20 的阶段 2 完成报告（HEAD `8e7f583`，三条 CI queued），结论「不允许进入阶段 3」。该评估回灌前，阶段 3 已按用户睡前连续推进授权完成并 push（`b667e51`，三条 CI success），形成竞态。本轮按「先修问题再继续」逐项整改，详见 `PROGRESS.md §7.154`：

- B1（阻塞）：文档整改产生新精确 HEAD，push 后以新 HEAD 触发三条新 run，待 conclusion=success 且 job/step 齐全后回填重报；旧 HEAD 绿与 queued run 均不顶替。
- H1：`PROGRESS.md §7.152` 末句「未经授权不 push、无 CI run、第 8 项不适用」已改为已授权 push + 三条 run 绑定但 queued + 第 8 项当时不成立。
- H2：本文件（唯一事实源）由「阶段 0 / 881 / 未提交未 push」刷新为当前事实；`BACKLOG.md`、`CORE_ARCHITECTURE_V2.md`、`CORE_ARCHITECTURE_V2_ROADMAP.md`、`DOCS_INDEX.md` 基线行同步刷新；16 份阶段 0 V2 文档单列 docs 提交，不掺阶段 3 代码。
- M1：status-only 尾提交自引用局限写入证据链；门禁不校验 `dirty` / `ahead_origin`。
- M2：`frontend/package.json:16`（e2e 追加 `appearance_ux.mjs` / `card_fields_ux.mjs`）与 `frontend/tools/parity_body_allowlist.json`（16 项 allowed_bodies）作为「验收口径变化」披露，授权依据 = 用户审批清单第 2 项「P1/P2 开启：去掉 PARITY_ALLOW_BODY_CHANGES=1 依赖」，改以 tracked allowlist 放行并由测试覆盖，未静默放宽。
- M3：改动文件全表见 `git diff --stat eb27ded..b667e51`（33 files +1612/−250）与阶段完成报告。
- M4：外观字段措辞改为「存于 SceneDoc 记录层 `records.py:27/:79`，不进 NodeRuntime / 物理参数 / 编译缓存键」；与 `ADR-005:14` 的既存张力登记为 P2 架构观察项。
- L1：第 7 项性能改「不适用 + 理由」——`ensure_engine() is engine` 是机制断言非量化基准，`ADR-005:30-32` 前端批量性能尚未量化验证。
- L2：`status.json dirty=true` 源于并行文档未跟踪，门禁 OK ≠ 工作树干净；文档收口提交后该来源消除。

## 6. 未解决事项

- 阶段 2 的 `8e7f583` 三条 CI 仍 queued（GitHub runner 未分配），如实标注，不作通过证据。
- 阶段 3 完成报告已获审批会话 2026-11-12 08:10 只读评估（结论：允许进入阶段 4；无阻塞项）；前置收口见 `PROGRESS.md §7.155`。阶段 4 完成报告已评估并批准进入阶段 5；后因阶段 4 任务书重定向，阶段 4 整改第④轮复评已通过，待用户批准正式验收。
- 阶段 4 整改已修复 P0-01–P0-04 与关键 P1，新增可复现 checker/测试；第④轮独立评审已执行：初评不通过→修复→最终复评通过（无阻断）；阶段 4 仍待用户明确批准后才可标正式验收完成。
- 阶段 5 P1-R1 已在任务书到达前完成并 push（`eaec04a`）；阶段 4 验收前不再推进阶段 6+，是否回退由用户裁定。
- ADR-001/002/003/004/006/007/008 仍 Proposed（ADR-008 为 Open Decision），不自行升格 Accepted；三项需用户决策标 `PENDING_USER_AUTHORIZATION`。
- 所有 `PENDING_USER_AUTHORIZATION` 项保持挂起，未获新授权不启动。
