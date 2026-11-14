# NetLab 项目状态（唯一事实源 · PROJECT_STATUS）

- **状态**：当前状态唯一事实源（依《NetLab / PlotKit 轻量研发与证据管理协议 V3》§2/§4，四类事实分离）。2026-11-14 阶段 6（P1-R2 AC/Bode 双后端统一）已获用户明确授权并完成并入 main（见 `PROGRESS.md §7.169`）；阶段 7（P1-S1 Project/DTO 分层）已完成并入 main（DTO 首切片 §7.170、SCHEMA_MIGRATIONS §7.171、v0–v7 golden fixtures 与 v7→v8 迁移草稿（未激活）§7.172）；阶段 8（P1-S2 Engine SPI v2）经用户授权启动，切片1（engine_registry 统一入口 + 插件 kinds 白名单 + EngineSpec 加性 5 字段）已在分支 `feat/p1s2-engine-spi-v2` 实现、待审（§7.173）。
- **最后刷新**：2026-11-14（Asia/Shanghai）。机器可读基线以 `status.json` / `reports/test_status.json` 为准；本文件只记当前事实，历史完成数字见 `PROGRESS.md`。

> ⚠️ 2026-11-14 历史已由 `git filter-repo` 重写（移除 `reports/pytest.xml`），**重写前所有旧 SHA 均已失效**。当前有效基线：全量 **1061 passed / 1 skipped / 0 failed、core line 82.13%**（543.03s，本地非 CI，绑 `status.json` 的 `git.head`；GitHub CI 已验证 `CI_VERIFIED` @ `6f332a2`；3 workflow run + 5 check-run 全 `completed/success`，见 §1 `CI 证据` 行）、版本 3.20.1；提交自身无法自引用，精确 HEAD 以 `git rev-parse HEAD` 与 `status.json` 为准。§1 表格与 §1.1 中的旧 SHA/959 等为 2026-11-13 历史快照，仅作追溯；当前阶段状态见 §1.3。
- **阶段 4（P1-A）**：设计冻结整改已完成 P0-01–P0-04 与关键 P1，新增 `tools/check_stage4_docs.py` 与契约测试；全量 945 passed / 1 skipped / 81.380784%（阶段 4 验收当时快照，非当前基线）；第④轮封口评审已「通过（无阻断、无新增项）」；**2026-11-12 获用户明确批准，正式验收通过（用户授权）**；阶段 5 转正式复核（进入阶段 6 仍需用户单独授权）。
- **阶段 5（P1-R1）**：共享 `stamp_laplacian` 两端口原语收敛已交付（代码 `e41160f`，状态 tip `eaec04a`，三条 CI success）；**2026-11-12 只读复核判「子目标达成（零数值回归、无回归、数值等价 max_abs≈5.55e-17）」但「阶段 5 整体仍 open、不标完成、不进阶段 6」**——完整 CircuitElement 元件模型统一未完成（Descriptor 仍 A+sE、Legacy 仍伴随 MNA，双 `kind` 分派尚在）；ROADMAP:40 原目标基线不可零回归实现，彻底合并需 CORE_MODEL_V2 `ElementAdmittance`（Proposed，3× PENDING）。阶段 6–13 均 `PENDING_USER_AUTHORIZATION`。
- **维护规则**：本文件只记当前事实；路线/阶段表见 `CORE_ARCHITECTURE_V2_ROADMAP.md`，目标口径见 `CORE_ARCHITECTURE_V2.md`，执行约束见 `PROJECT_OPTIMIZATION_EXECUTION_PLAN.md`（该文件为 2026-11-11 快照，动态状态委托本文件），架构决策见 `docs/adr/`，历史完成记录见 `PROGRESS.md`。机器可读字段以 `status.json` / `reports/test_status.json` 为准。

## 1. 当前基线事实（四类事实分离）

| 项 | 当前事实 |
|---|---|
| 仓库 | `NetlabHome/`，分支 `main` |
| 最新 main 提交 | 已推送基线 `origin/main`；提交自身无法自引用，精确 HEAD/SHA 以 `git rev-parse HEAD` 与 `status.json.git.head` 为准。阶段 7 P1-S1 Round4（golden fixtures + v7→v8 草稿）代码提交为当前有效测试基线；当前 HEAD `6f332a2` 的 GitHub CI 已验证 `CI_VERIFIED`（3 workflow run + 5 check-run 全 `completed/success`，见 §1 `CI 证据` 行）；历史 `c70091d` 的同类证据仅覆盖该 SHA |
| 复审/阶段6文档提交（已 push） | `fadf651`/`af444ac`/`073e422` 随 `584f540` 推上；`8f9344f`、`be2128a`、`aa2e30b`、`c70091d`、`9b67c2a`、`5c76741`、`1ab22c3`、`4975f90`、`9b2f9af` 均在 `origin/main`（审批复核实测本地 HEAD 与 `origin/main` 同值）。阶段 6 文档为未获阶段授权时的产出，见 §2 |
| 测试报告绑定 HEAD | `status.json` / `reports/test_status.json` 绑定当前有效代码提交（`git.head`，见文件本身）；1061 passed / 1 skipped / 0 failed、543.03s、core line 82.13%（本地非 CI，`pytest netlab/tests -q --cov=netlab/core --cov-branch --cov-fail-under=81`）。status-only 尾提交按 §4 不自引用；生成器见 `tools/write_test_status.py` / `tools/gen_status.py` |
| 最后生产代码提交 | 阶段 7 P1-S1 Round3 已改 `netlab/core/model/project.py`（`SCHEMA_MIGRATIONS` 注册表替换 if 链）；Round4 新增 `netlab/core/model/v8_draft.py`（草稿、未激活、不改 `PROJECT_VERSION=7`）。阶段 6 AC/Bode 统一生产代码见 `PROGRESS.md §7.169`。精确 SHA 以 `git log --oneline -- netlab/core` 为准 |
| 精确 HEAD / ahead | 文档收口提交后以 `git rev-parse HEAD` 与 `status.json` 为准；提交自身无法自引用 |
| origin/main | 精确远端以 GitHub `branches/main` API 为准；Git Data API 推送不更新本地 `origin/main` 跟踪引用（当前本地引用可能陈旧，ahead/behind 不作远端依据） |
| 版本 | 3.20.1 |
| 测试基线 | 以 `status.json` / `reports/test_status.json` 为准：1061 passed / 1 skipped / 0 failed；core line 82.13%（543.03s，绑当前有效代码提交）。历史 959/81.61%（`1ab22c3`）、1005/81.96%（`e2b390f`）、1026/82.04%（`b19a635`）为各轮基线；均为本地结果（不冒称 CI）。当前 HEAD `6f332a2` 的 GitHub CI 已验证（3 workflow run + 5 check-run 全 `completed/success`，见 §1 `CI 证据` 行），历史 `c70091d` 的同类证据仅覆盖该 SHA；本地数字与 CI 证据分开记录 |
| CI 证据（当前 HEAD `6f332a2`） | `CI_VERIFIED` @ head_sha `6f332a21bbaaaaf628e76a8c2c539a5623e6c2f6`（Repository `qgfn106-blip/NetLab`，event `push`；Checked At 2026-11-14 12:44 Asia/Shanghai，经 GitHub REST API 直连 HTTP 200 取得）：3 workflow run 全 `completed/success` — `python-tests` #191 / Run ID `43511916161` / [run](https://github.com/qgfn106-blip/NetLab/actions/runs/43511916161)、`frontend-ts-build` #225 / `43511916205` / [run](https://github.com/qgfn106-blip/NetLab/actions/runs/43511916205)、`container` #150 / `43511916077` / [run](https://github.com/qgfn106-blip/NetLab/actions/runs/43511916077)；5 check-run 全 `completed/success` — `build` `132184028364`、`e2e-l1` `132184028205`、`test` `132184028111`、`desktop-l2` `132184027539`、`docker` `132184027235`；窗口 2026-11-13T21:34:39Z→21:38:31Z（北京 11-14 05:34–05:38）。依 V3 §4：本证据只覆盖 `6f332a2` 这 3 个 workflow；本地 1052 passed 为本地运行不冒称 CI；`c70091d` 的同格式证据见下行（历史） |
| CI 证据（历史 `c70091d`） | `CI_VERIFIED` @ head_sha `c70091d788524b75134a5a00946e7cce5f8fa095`（Repository `qgfn106-blip/NetLab`，event `push`；Checked At 2026-11-13 03:00 Asia/Shanghai，经 GitHub REST API 直连 `curl --noproxy '*'` HTTP 200 取得）：3 workflow run 全 `completed/success` — `python-tests` #134 / Run ID `43274818892` / [run](https://github.com/qgfn106-blip/NetLab/actions/runs/43274818892)、`frontend-ts-build` #168 / `43274818886` / [run](https://github.com/qgfn106-blip/NetLab/actions/runs/43274818886)、`container` #93 / `43274818874` / [run](https://github.com/qgfn106-blip/NetLab/actions/runs/43274818874)；5 check-run 全 `completed/success` — `test` `131380307795`、`desktop-l2` `131380307574`、`build` `131380308274`、`e2e-l1` `131380308763`、`docker` `131380308489`；窗口 2026-11-12T17:57:29Z→18:01:50Z（北京 01:57–02:01）；legacy combined status `state=pending total_count=0`（以 check-runs 为准，不写「CI 全绿/失败」）。依 V3 §4：本证据仅覆盖 `c70091d` 的 3 个 workflow，本地 959 passed 为本地运行不冒称 CI，历史 `4dc7bdd` 的 5 check-run success 仅作历史、不覆盖当前 HEAD；本轮新增的纯文档提交已随 `9b2f9af` push（`9b67c2a`/`5c76741`/`1ab22c3`/`4975f90`/`9b2f9af`），仍未被 `c70091d` 的 CI 覆盖（`CI_NOT_VERIFIED`） |
| 前端门禁 | typecheck / build / test（27 passed）/ verify:parity / check:sections（app.ts 7968 行）/ e2e 四脚本全过 |
| 阶段 3 三条 CI（绑 `b667e51`） | python-tests `43115278340`、frontend-ts-build `43115278356`、container `43115278600`，均 success |
| 阶段 2 三条 CI（绑 `8e7f583`） | container `43098331619`、python-tests `43098331551`、frontend-ts-build `43098331562`，GitHub runner 排队（status=queued / conclusion=null / jobs=[]），不作通过证据 |
| P1 架构审计 | `CORE_ARCHITECTURE_AUDIT.md`（2026-11-11 历史快照，加注历史说明），已随本轮文档收口提交入库 |
| 工作树 | `origin/main`=`9b2f9af` 后工作树 clean；本次审批纠偏作为 docs 尾提交推送后工作树 clean（提交自身无法自引用，精确远端以 `git ls-remote origin main` 为准）；`status.json` 的 `dirty`/`ahead_origin` 为生成时刻快照，门禁不校验该字段 |

### 1.1 本轮状态复核（2026-11-13 03:57，基于本地 Git 工作树与 `status.json` 实测，非 GitHub 侧核验）
- 注：本节为 2026-11-13 历史快照；当前事实以文首 §1 表格、`status.json` 与 §1.3 为准。
- latest_main_sha：`origin/main`（已推送基线）=`9b2f9af85dc30069edbc66026ecf6b9f36827ce9`（status/docs 尾提交）；本地 HEAD 同值、worktree clean；本次审批纠偏 docs 尾提交后精确 HEAD 以 `git rev-parse HEAD` 为准、`git worktree list` 仅一个工作树
- latest_production_code_sha：`1ab22c33d8f436394669e7305674c597803a2d2b`（既有代码缺陷修复 3 项；此前生产码 `212a890` P1-1；其后 `4975f90` 为 status-only）
- tested_sha：`1ab22c33d8f436394669e7305674c597803a2d2b`（`status.json` / `reports/test_status.json` 绑定；`4975f90` 为 status-only 尾提交，无法自引用）
- test_count / coverage：959 passed / 1 skipped / 0 failed；316.28s；core line 81.61%（本地，非 CI）；审批复核独立复跑 959/1/0、126.99s；历史 953/81.53%（绑 `aa2e30b`）为修复前基线
- latest_ci_runs：`CI_VERIFIED` @ `c70091d788524b75134a5a00946e7cce5f8fa095`（2026-11-13 03:00 Asia/Shanghai 经 GitHub REST API 直连取得）：3 workflow run（`python-tests` #134/`43274818892`、`frontend-ts-build` #168/`43274818886`、`container` #93/`43274818874`）+ 5 check-run（`test`/`131380307795`、`desktop-l2`/`131380307574`、`build`/`131380308274`、`e2e-l1`/`131380308763`、`docker`/`131380308489`）全部 `completed/success`；Run URL 见 §1 `CI 证据` 行；legacy combined status `pending/total 0` 以 check-runs 为准。本证据仅绑 `c70091d`；其后推送的 `9b67c2a`/`5c76741`/`1ab22c3`/`4975f90`/`9b2f9af` 未被该 CI 覆盖，`4975f90`/`9b2f9af` 标 `CI_NOT_VERIFIED`
- current_stage：阶段 4 正式验收已获用户明确批准；阶段 5 子目标达成但整体 open；**阶段 6–13、ADR-008 A/B/C、P0-2 全链路改造、push 均 `PENDING_USER_AUTHORIZATION`**。仓内阶段 6 只读审计/对拍材料已产出，但依 `PROJECT_OPTIMIZATION_EXECUTION_PLAN.md:14`（未获明确批准前下一阶段只能只读了解、不得产生实现或正式文档交付物）不构成阶段交付物，不记阶段完成；AC/Bode 生产代码统一未实施。另 `1ab22c3` 完成 3 项既有代码缺陷修复（#7/#3/#2），属缺陷修复、不计入阶段 6 交付物
- stage_acceptance：阶段 4 正式验收已批准；阶段 5 子目标达成但整体 open（未标完成）
- pending_authorization：阶段 6 AC/Bode 生产统一、阶段 7–13、ADR-008 三项 A/B/C、P0-2 全链路改造、push / 发布
- 本次执行授权记录：用户在本会话（NetLab项目优化 `session-c20e8127`）2026-11-13 19:06 明确指令原话「push，，按依赖序 `7→3→2` 落地，把这份完工报告原文投递给 `03a3e6b4` 做复核」；据此执行 push 4 提交 + #7/#3/#2 三项修复 + 投递复核。该原话是本轮 push 与三项生产码修复的**原始用户授权记录**（此前 §3 写「未核到点名授权记录」系跨会话不可见，已据本会话原话补录，不改变「不计入阶段 6 交付物」的定性）。

### 1.2 是否需下一阶段授权（独立结论）
- **更新（2026-11-14）**：阶段 6（P1-R2 AC/Bode 生产统一）已于 2026-11-14 获用户明确授权并完成并入 main（`PROGRESS.md §7.169`）；阶段 7（P1-S1）已完成并入 main；阶段 8（P1-S2 Engine SPI v2）已经用户授权启动，切片1 已实现待审（获批并合入后方可进入切片2及后续）。阶段 9–13、ADR-008 A/B/C、P0-2 全链路改造仍 `PENDING_USER_AUTHORIZATION`，须用户本人明确授权后方可进入。push 依用户 2026-11-14 授权由 Agent 核查后代为执行，不逐项询问。

### 1.3 当前阶段状态（2026-11-14，四类事实分离）
- 文档/规划：阶段 6 已完成并入 main；阶段 7 P1-S1 已完成并入 main；阶段 8 P1-S2 Engine SPI v2 进行中（切片1 已实现待审），顺序按 `PROJECT_OPTIMIZATION_EXECUTION_PLAN.md:11`，未跳步、未并行越级。
- 代码事实：`PROJECT_VERSION=7` 不变；`netlab/core/model/dto.py` 恒等映射已入库；`project.py` 的 `migrate_project` 由 `SCHEMA_MIGRATIONS` 注册表驱动（特征化 10 例逐字节等价）；`v8_draft.py` 仅测试直接调用、不激活。
- 测试事实（本地非 CI）：全量 1061 passed / 1 skipped / 0 failed、core line 82.13%（以 `status.json`/`reports/test_status.json` 产物为准）；`tools/check_architecture.py` A1/A2/A3/A6 全 OK；`check_stage4_docs.py`、docs 隐私/SSOT/契约 6 passed、`check_status_freshness.py` OK。
- CI 事实（2026-11-14 补记）：`CI_VERIFIED` @ `622711b4589dbcecc5698cee3fcf9555769015ab`（分支 `feat/p1s2-engine-spi-v2`，事件 `push`）——3 workflow run 全 `completed/success`：`python-tests` `43567489008`、`frontend-ts-build` `43567489016`、`container` `43567489032`；5 check-run 全 `completed/success`：`test` `132364387545`、`desktop-l2` `132364387371`、`e2e-l1` `132364386533`、`docker` `132364386397`、`build` `132364386194`。依 V3 §4 仅覆盖上述 SHA；本地 1059 passed 仍标「本地非 CI」。历史 `6f332a2` 证据见 §1 CI 证据行。
- 授权事实：见 §1.2；阶段 8 已获用户授权（切片1 待审，切片2 及其后须先设设计/授权边界）；阶段 9–13、ADR-008 A/B/C、P0-2 全链路改造仍 `PENDING_USER_AUTHORIZATION`。

## 2. 阶段进度（用户 2026-11-11 正式裁决的阶段 0–13 顺序）

- 阶段 0（项目事实与文档基线）：已完成 —— 本文件、`docs/adr/`、V2 规划/路线/审计/评审/执行约束文档已收口提交。
- 阶段 1（P1-A-lite）：已完成 —— `ADR-005` Presentation 外观归属 = Accepted（lite）；其余 ADR 仍 Proposed，ADR≠代码实施授权。
- 阶段 2（P-B 元素级视图外观完整版）：已完成并 push 到 `8e7f583` —— 900 passed / 1 skipped / 81.376055%；评估整改见 `PROGRESS.md §7.154`。
- 阶段 3（R40 收尾：节点卡片自由字段编辑）：已完成并 push 到 `b667e51` —— 909 passed / 1 skipped / 81.404692%，三条 CI success；详见 `PROGRESS.md §7.153`。
- 阶段 4（P1-A 全量设计冻结）：9 份 Proposed 文档已交付；**2026-11-12 任务书整改完成**：P0-01–P0-04 全修复、P1-01/P1-02/P1-06 修复、P1-03–P1-13/P2-02 差距分析文档化，新增 `tools/check_stage4_docs.py` + `test_stage4_document_contracts.py`；第④轮封口评审已「通过（无阻断、无新增项）」；已于 2026-11-12 获用户明确批准正式验收；详见 `PROGRESS.md §7.159`（阶段4评审/整改记录已按保留策略归档，见 Git 历史）。
- 阶段 5（P1-R1 Stamp 统一）：代码 `e41160f`（状态 tip `eaec04a`，三条 CI success）已交付；2026-11-12 只读复核判「子目标达成、零数值回归」，但阶段 5 整体仍 open（元件模型完整统一未完成）；成果保留、不作阶段 5 整体完成依据，不进阶段 6。
- 阶段 6（P1-R2 AC/Bode 统一）：**已完成**（2026-11-14 用户明确授权启动，canonical=`CircuitSolver.ac_sweep`，`DescriptorModel.frequency_response` 纯线性路径委托；三支 A/B/C 合入 main，C 支严格对拍 `test/p1r2-ac-parity-strict`；1005 passed / 1 skipped / core 81.95%，GitHub 5 check-run 全 success；详见 `PROGRESS.md §7.169`）。
- 阶段 7（P1-S1 Project/DTO 分层）：进行中（用户 2026-11-14 授权按规划继续）。已完成 DTO 首切片（`dto.py`，§7.170）、`SCHEMA_MIGRATIONS` 注册表替换 if 链（§7.171）、v0–v7 golden fixtures 与 v7→v8 迁移草稿（未激活，§7.172）；`PROJECT_VERSION=7` 不变、外部 JSON 不变、未接调用方。阶段 8–13（P1-S2 / P1-S3 / P2 / P3 / P4 / P5）：保持 `PENDING_USER_AUTHORIZATION`。

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | 项目事实与文档基线 | 已完成（文档收口提交） |
| 1 | P1-A-lite（ADR-005-lite） | 已完成（Accepted） |
| 2 | P-B 元素级视图外观完整版 | 已完成（`8e7f583`） |
| 3 | R40 收尾：节点卡片自由字段 | 已完成（`b667e51`） |
| 4 | P1-A 全量设计冻结 | **已完成（2026-11-12 用户批准正式验收）** |
| 5 | P1-R1 Stamp 统一 | 子目标达成（共享 Laplacian 原语，2026-11-12 复核 PASS）；**阶段 5 整体 open，不标完成、不进阶段 6** |
| 6 | P1-R2 AC/Bode 统一 | **已完成**（2026-11-14 授权并完成并入 main，见 `PROGRESS.md §7.169`） |
| 7 | P1-S1 Project/DTO | 进行中（DTO 首切片 → SCHEMA_MIGRATIONS 注册表 → golden fixtures + v8 草稿；见 §7.170–§7.172） |
| 8 | P1-S2 Engine SPI v2 | 未开始 |
| 9 | P1-S3 前端拆分 | 未开始 |
| 10 | P2 Core Model V2（A/B/C/D） | 未开始 |
| 11 | P3 Equation + Compiler（研究型最小原型） | 未开始 |
| 12 | P4 Runtime + Plugin V2 | 未开始 |
| 13 | P5 Validation / 机械 / 多物理场 / Control Flow | 未开始 |

## 3. 授权边界

| 项 | 状态 |
|---|---|
| push / 发布 | 已发生的 push 为 Git 事实（`origin/main`=`4975f90`，含 `9b67c2a`/`5c76741`/`1ab22c3`/`4975f90` 4 提交，均为既有代码缺陷修复/状态绑定；执行者自述经用户跨会话授权，审批方未核到点名该范围的原始授权记录，故按「修复提交」记录、不计入阶段 6 交付物）；睡前「连续推进」原话已被用户 2026-11-12 醒来后的新指令覆盖，依 V3 §2 不得由会话或仓内自述自行重新激活；后续 push 保持 `PENDING_USER_AUTHORIZATION`；禁 force / rebase / amend / 改写历史 |
| 阶段自动推进 | `PENDING_USER_AUTHORIZATION`。无人值守连续推进已让位于用户 2026-11-12 醒来后的新指令；每阶段须用户本人明确批准后方可进入，不越级开工 |
| R25（完整电路级内部结构） | 暂停（用户 2026-11-11 裁决先做 P-B） |
| R43（M2） | 仅 opt-in |
| R19（参考级图纸） | 暂停 |
| Phase 3 架构债 / Phase 4 CI 证据 | `PENDING_USER_AUTHORIZATION`（阶段 5 P1-R1 代码 `e41160f` 已交付（子目标达成、阶段 5 整体 open），阶段 5 准入仍存授权边界，按 `PENDING_USER_AUTHORIZATION` 处理；阶段 6–13 未获用户明确授权，暂停；不得以本文件或历史提交自证授权） |
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
- 阶段 3 完成报告已获审批会话 2026-11-12 08:10 只读评估（结论：允许进入阶段 4；无阻塞项）；前置收口见 `PROGRESS.md §7.155`。阶段 4 曾于 08:10 获评估允许进入阶段 5，后因 10:48 第 4 阶段整改任务书重定向，该放行已被覆盖；当前阶段 4 整改第④轮封口评审「通过（无阻断、无新增项）」，已于 2026-11-12 获用户明确批准，正式验收通过。
- 阶段 4 整改已修复 P0-01–P0-04 与关键 P1，新增可复现 checker/测试；第④轮独立评审已执行：初评不通过→修复→复评「有条件通过（无阻断）」→封口评审「通过（无阻断、无新增项）」；已于 2026-11-12 获用户明确批准，正式验收完成。
- 阶段 5 P1-R1 代码 `e41160f`（状态 tip `eaec04a`）已交付；2026-11-12 复核判子目标达成、阶段 5 整体仍 open（保留成果、不回退），阶段 6+ 仍需用户单独授权方可推进。
- P1-1（插件引擎注册↔场景加载断链，审计列阻断）已修复：新增 `scene_types.is_known_mode()`（内置 `MODES` ∪ 已注册 `ENGINE_SPECS`）单一判定，`scene_io.load_payload` / `networks.add_network` / `set_network_mode` 改用之，插件 mode 不再被误拒；提交 `212a890`。后续 `1ab22c3` 又修复既有代码缺陷 3 项（#7 is_known_mode 非str防护、#3 末次 Newton 补 deadline、#2 checkpoint 冻结/恢复 _startup_pending），全量 959 passed / 1 skipped（GUI smoke 需 `NETLAB_GUI_SMOKE=1`）；上述均属缺陷修复，非阶段 6 交付物。
- ADR-001/002/003/004/006/007 仍 Proposed；`docs/adr/ADR-008-stage4-open-decisions.md` 状态为 `Proposed`，A/B/C 三项均 Open Decision / `PENDING_USER_AUTHORIZATION`（原文：「在用户明确裁定前，任何文档不得写成已定或已实现，也不得据此实施 V2 迁移」）；仓内「1112n 已授权升格」表述无原始授权记录可核实，已撤销。
- 所有 `PENDING_USER_AUTHORIZATION` 项保持挂起，未获新授权不启动。