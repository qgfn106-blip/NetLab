# NetLab 整改进度追踪表（Remediation Tracker）

> 基线提交：5c076eae55f739e2265327c0c73a7dac3440358a ｜ 代码整改合并基线：e8720f2（P1 PR #71 merge 376b2bb；P2 PR #72 merge e8720f2；本文档经 PR #73 同步合入）
> 版本：NetLab 3.20.2 / Project Schema 8 ｜ 审计日期：2026-11-24
> 状态取值（严格）：已合并 / 部分落地已合并 / 本地完成待评审（未推送）/ 实质能力已合入 main / 规划完成（未实施）/ 未开始。「提交」列：具体 commit 与合并结果（PR/merge commit）。

## 总表

| ID | 权重 | 状态 | 涉及文件 | 提交 | 证据 | 未完成原因 |
|---|---|---|---|---|---|---|
| P0-01 | 10 | 已合并 | .github/workflows/python-tests.yml | 7624bc1 → main e8720f2 | 已删 Setup Node(:,25-28) 与 Section budget(:44-48) 两步；section gate 保留 frontend-ts-build.yml | 已合并 main=e8720f2（PR #71/#72 必需检查全绿） |
| P0-02 | 8 | 已合并 | frontend/tools/verify_app_parity.js、frontend/tools/parity_ast.js、frontend/tests/parity_ast.test.mjs | 7624bc1 | parity_ast 8 用例全 pass；verify_app_parity 实跑 OK(83 TS/848 声明/73 运行模块/3 仅类型) | 已合并 |
| P0-03 | 12 | 已合并 | netlab/core/compute/analysis.py、netlab/core/compute/circuit/loop_analysis.py、netlab/core/compute/circuit/nyquist.py | 7624bc1 → main e8720f2 | LM-01..LM-04 已修复（T=G/(1+L)，删除 sign 双计，支路断环 forward 独立测量/closed=direct/parity 诚实化），loop_math_fix.md；最新全量 1789 passed/14 skipped/0 failed、覆盖率 82.70% | LM-05..07（nyquist 临界点/PM/运放测 L）保留待立项 |
| P0-04 | 5 | 已合并 | reports/evidence/、tools/run_evidence.py（pytest.ini/decisions.yaml 只读复核，未改） | 7624bc1 → main e8720f2 | 全量 1789 passed/14 skipped/0 failed（junit 1803）；覆盖率 82.70%（≥81 门禁）；requirements --all 43/43 PASS；reports/evidence/python-tests.json+AUDIT_EVIDENCE_LOG.md | decisions.yaml 为历史记录不追溯改写 |
| P1-01 | 12 | 已合并 | frontend/app/analysis_chart.ts(878→786)、analysis_workbench.ts(837→800)、analysis_workbench_canvas.ts(823→774)；新增 analysis_chart_spec.ts(133)、analysis_workbench_chrome.ts(78)、analysis_workbench_canvas_ids.ts(52) | bf49b27 + 8cf00e9 → PR #71 merge 376b2bb | check_app_sections OK（S5 通过）；verify_app_parity OK(86 TS/859 decl/76 模块)；build/tsc/test:utils 88 全绿 | 无；app.ts 主拆分 S1-S4 属后续 |
| P1-02 | 3 | 已合并（职责矩阵）+ 本地多片抽取 + S1/S2/S3/S4 + router/handlers/views 首片（未推送） | docs/audit/FRONTEND_RESPONSIBILITY_MATRIX.md、frontend/app.ts、frontend/app/endpoints.ts、frontend/app/store.ts、frontend/app/analysis_workbench_panel.ts、frontend/app/analysis_workbench_chart.ts、frontend/app/scene_panel.ts、frontend/app/scene_actions.ts、frontend/app/analysis_replay.ts、frontend/app/signal_list.ts、frontend/app/commands.ts、frontend/app/shell_view.ts、frontend/app/router.ts、frontend/app/handlers.ts、frontend/app/views.ts | bf49b27 → PR #71 merge 376b2bb；b5288f4；1f27eca；ea8413d；1625eeb；729bf6e；66d8272；57211fc；e1fcd10（feat/2026-11-25-p3-core-v2，未推送） | 职责矩阵已产出；app.ts 7511→4463：工作台面板 774 + 图表渲染 262（b5288f4）、场景面板 199 + 场景动作 772（1f27eca）、回放控制 188 + 信号列表/图例（本轮）、端点注册表 endpoints.ts（S1）、会话状态 store.ts（S2，applySnapshot/lookupSelection 注入）、命令层 commands.ts（S3，selection/clipboard/undo/redo；注入 task/selectEntity/renderInspector/deleteSelection/refreshState）、外壳视图 shell_view.ts（S4，updateInfoBar/renderNetworkList；注入 setInfo/switchNetwork/renameNetwork/openNetworkMenu）、路由 router.ts、网络处理器 handlers.ts、视图 views.ts 首片（57211fc），typecheck/build/test:utils 96 passed/parity/sections/端点快照（91 路径/101 条目）全绿 | app.ts P1-02 计划内 S1-S4 已完成；P3-06 已落地 router.ts/handlers.ts/views.ts 首片，完整 handlers/views 迁移与入口仅装配未完成 |
| P1-03 | 含于 10 | 已合并 | pyproject.toml、netlab/requirements.txt、四 workflow（python-tests/container/browser-e2e/frontend-ts-build） | 7624bc1 | plotkit>=0.3,<0.4；checkout ref 6939e8889ce4b1c64c0ec679658d9cfa99e67f37(0.3.0) | 已合并 |
| P1-04 | 含于 10 | 已合并 | netlab/core/model/{project.py,instance_model.py,v8_draft.py}、netlab/docs 5 篇、README/BUILD/CODE_GUIDE/PLUGIN_GUIDE | 7624bc1 | PlotKit 版本与 PROJECT_VERSION 同步为 8（EXTENSIBILITY §9 注明 v7 设计冻结基线） | 已合并 |
| P1-05 | 含于 10 | 已合并 | README.md、OPERATION.md、ARCHITECTURE.md | 7624bc1 | MyProject 说明改为「本地示例目录、.gitignore 排除、不入库；同名工程夹具在 netlab/tests/fixtures/projects/」 | 已合并 |
| 文档同步 | 8 | 已合并 | netlab/docs 5 篇、README/OPERATION/ARCHITECTURE、docs/canonical/decisions.yaml | 7624bc1 | 版本/示例边界/PROJECT_VERSION 已同步 | decisions.yaml 数值为历史决策记录，按惯例不追溯改写；门禁以 CI 为准（--cov-fail-under=81） |
| P2-01 | 5 | 已合并 | circuit/stamp_builder.py(新增294)、circuit/descriptor.py、circuit/elements.py、tests/test_stamp_parity.py | e5373f7 → PR #72 merge e8720f2 | descriptor._assemble_matrices 由 199 行降至 23 行、删除 9 路 kind 特判；R/L/C/sensor/vsource/VCVS/VCCS/isource 新装配与旧实现逐项相等（rtol=atol=0）；定向 241 passed | 电感 element.stamp 走二端伴随、descriptor 走独立支路，布局不同按设计保留并如实记录 |
| P2-02 | 4 | 已合并 | circuit/ac_backend.py(新增149)、circuit/descriptor.py、tests/test_ac_backend.py | e5373f7 → PR #72 merge e8720f2 | FastLinearStrategy/NativePerFrequencyStrategy + 统一 ac_sweep；线性 RLC 四路 Bode 逐点对拍 rtol 1e-8/atol 1e-12 通过；非线性自动选 native；descriptor.frequency_response 仅薄封装 | 返回值新增 strategy 键（附加信息） |
| P2-03 | 3 | 已合并 | netlab/core/compute/analysis.py、analysis_errors.py(新增)、analysis_numerics.py(新增)、tests/test_analysis_api_surface.py | 2c7530e → PR #72 merge e8720f2 | 异常层与 8 个纯数值函数迁出，analysis.py 2848→2771 行并保持再导出；API 快照 0 处不一致；pytest netlab/tests/test_analysis*.py 169 passed/7 skipped | 编排与 facade 有意保留，未硬拆 |
| P2-04 | 2 | 已合并 | netlab/core/compute/accel.py、netlab/tests/test_accel_fallback.py | 2db0867 → PR #71 merge 376b2bb | GPU 非有限解不再直抛 ComputeError，改为 RuntimeError→_record_gpu_failure→CPU 回退，与模块 docstring 一致；新增 5 条边界单测，8 passed | 无 |
| P2-05 | 2 | 已实现待评审（本地分支，未推送） | netlab/core/compute/fem.py、netlab/tests/test_fem.py | 基础单测 2db0867 → PR #71 376b2bb；追加能力 192c783（feat/2026-11-25-p3-core-v2，未推送） | 基础 3 条已合并；追加：boundary_top/bottom（insulated/dirichlet）+boundary_*_value、time_integrator（backward_euler/crank_nicolson）、FemMesh top/bottom、BE/CN 双时间格式并 dt/integrator 变化重建；test_fem.py 扩至 8 条（CN 均匀保持、Dirichlet 角点优先级、CN/BE 稳态对拍 max|Δ|<5e-2、非法枚举拒绝），8 passed | 架构重构（边界对象化、积分器插件注册）仍为后续 |
| P2-06 | 1 | 已合并 | netlab/core/model/path_guard.py、netlab/desktop/bridge.py、netlab/desktop/webview_bridge.py | 7624bc1 | path_guard.py:9 docstring「追加」改「覆盖」；webview_bridge.save_text 写入前接 ensure_allowed_path；desktop 12 tests passed | 已修复 |
| P2-07 | 5 | 已合并 | tools/check_requirement_verifiability.py（requirements.yaml 只读复核） | 7624bc1 | 约 48→118 行语义门禁（非空非占位/语义关键词/expected≠failure_condition/按声明校验退出码/扫 failed/error/Traceback），--all 43 条 | 已合并 |
| P3-01 | —（阶段合计 10） | 本地完成待评审（未推送） | docs/audit/CORE_V2_CONTRACT_FREEZE.md（新增）、netlab/tests/test_core_v2_contract.py（新增） | 192c783（feat/2026-11-25-p3-core-v2，未推送） | CF-01..CF-14 契约 + G0 五项；12 条契约测试（版本/StampSink/descriptor 委托/kind/电感双路径/ac_sweep 契约与策略/fast-native 对拍/ComputeError/GPU 回退/路径/FEM）；与 test_fem.py 合跑 20 passed | G0 评审未关闭 |
| P3-02 | —（阶段合计 10） | 本地完成待评审（未推送） | netlab/core/compute/analysis.py（facade 85 行）、analysis_metrics.py（451）、analysis_transfer.py（588）、analysis_envelopes.py（688）、analysis_loop.py（673）、analysis_loop_scan.py（569）、netlab/tests/test_analysis_layering.py（新增） | a3ccfa8（feat/2026-11-25-p3-core-v2，未推送） | analysis.py 2771→85 行，公共 __all__ 不变；五个子模块职责 metrics/transfer/envelopes/loop/scan；test_analysis_layering.py 断言公共符号与 facade 同一对象且无循环导入；全量 pytest 1811 passed/14 skipped/0 failed，覆盖率 87% | G2 评审未关闭 |
| P3-03 | —（阶段合计 10） | 实质能力已合入 main | circuit/stamp_builder.py、descriptor.py | e5373f7 → PR #72 e8720f2 | 单一 StampBuilder 已落地并由 CF-03..CF-06 约束；契约测试验证 descriptor 委托与 kind 分派 | 契约评审待关 |
| P3-04 | —（阶段合计 10） | 实质能力已合入 main | circuit/ac_backend.py、descriptor.py | e5373f7 → PR #72 e8720f2 | 统一 ac_sweep + 策略选择已落地，CF-07..CF-09 约束；fast/native 对拍通过 | 契约评审待关 |
| P3-05 | —（阶段合计 10） | 本地完成待评审（未推送） | frontend/tools/check_analysis_layers.mjs（新增）、frontend/tests/analysis_layers.test.mjs（新增）、frontend/app/analysis_chart_model.ts、analysis_chart_interaction.ts、analysis_chart.ts、analysis_chart_detail.ts；复用既有 analysis_workbench*.ts 分层 | a3ccfa8（feat/2026-11-25-p3-core-v2，未推送） | 分析图新增 model/interaction 纯层，analysis_chart 786→718；守卫覆盖 24 个分析图/工作台模块：行数≤800、import 只能同层或更低层、反向依赖报错；`node tools/check_analysis_layers.mjs` OK，`test:utils` 96 passed | G5 评审未关闭 |
| P3-06 | —（阶段合计 10） | 部分完成（端点契约守护 + app.ts 多片拆分 + S1/S2/S3/S4 + router/handlers/views 首片，未推送） | frontend/tools/app_endpoint_snapshot.json（新增）、frontend/tools/check_app_endpoints.mjs、frontend/tests/app_endpoints.test.mjs（新增）、frontend/app.ts、frontend/app/endpoints.ts、frontend/app/store.ts、frontend/app/analysis_workbench_panel.ts、frontend/app/analysis_workbench_chart.ts、frontend/app/scene_panel.ts、frontend/app/scene_actions.ts、frontend/app/analysis_replay.ts、frontend/app/signal_list.ts、frontend/app/commands.ts、frontend/app/shell_view.ts、frontend/app/router.ts、frontend/app/handlers.ts、frontend/app/views.ts | 5d39310、b5288f4、cc8922b、6800cfc、ea8413d、1625eeb、729bf6e、66d8272；57211fc；e1fcd10（feat/2026-11-25-p3-core-v2，未推送） | 端点快照 91 个唯一路径/101 个方法+路径条目 + 3 条 node:test；扫描范围扩展至整个 frontend/app；app.ts 7511→4463，工作台面板/图表渲染/场景面板/场景动作/回放控制/信号列表/命令层/外壳视图/路由/网络处理器/视图首片已模块化 | 完整 handlers/views 迁移与入口仅装配未完成 |
| P3-07 | —（阶段合计 10） | 部分完成（GPU 已合并，FEM 本地待评审） | accel.py、fem.py、tests/test_accel_fallback.py、test_fem.py | 2db0867 → PR #71 376b2bb；FEM 追加见 P2-05 | GPU 非有限回退 5 passed（已合并）；FEM 枚举/时间积分 8 passed（本地待评审） | 边界错误契约文档化见 CF-10..CF-13 |
| P3-08 | —（阶段合计 10） | 清单已交付待评审（G8 未通过） | docs/audit/P3_ACCEPTANCE_CHECKLIST.md（新增） | 192c783、a3ccfa8（feat/2026-11-25-p3-core-v2，未推送） | G0..G8 门禁与逐项验收表、阻断条件；结论 G8 未通过、不得宣称 Core V2 完成 | P3-02/P3-05 本地完成待评审；P3-06 部分完成；G0/G2/G5/G6 评审未签字；G8 未通过 |

## 状态汇总

| 状态 | 条目 | 说明 |
|---|---|---|
| 已合并 main | P0-01..P0-04、P1-01..P1-05、文档同步、P2-01..P2-04、P2-06、P2-07 | 全部进入远端 main=e8720f2（P0/P1-03..05/文档/P2-06/07 与 P1-01/02/P2-04/05 经 PR #71→376b2bb；P2-01/02/03 经 PR #72→e8720f2；CI 必需检查全绿） |
| 本地完成待评审（未推送） | P3-01、P3-02、P3-05、P3-08、P2-05（追加） | 分支 feat/2026-11-25-p3-core-v2；P3-01 契约+12 测试、P3-02 analysis 2771→85 facade+四子模块、P3-05 17 模块四层守卫、P3-08 验收清单、P2-05 FEM 边界枚举/时间积分；全量 1811 passed/14 skipped、覆盖率 87% |
| 实质能力已合入 main | P3-03、P3-04 | 分别由 P2-01/P2-02 落地，契约评审待关 |
| 部分完成 | P3-06 | 端点契约快照与守护测试已落地；app.ts 已从 7511 降到 4463（工作台面板/图表渲染/场景面板/场景动作/回放控制/信号列表与图例模块化，S1 端点注册表、S2 会话状态 store、S3 命令层、S4 外壳视图完成，P3-06 已补 router.ts/handlers.ts/views.ts 首片）；完整 handlers/views 迁移与入口仅装配未完成 |
| 规划完成（未实施） | （无） | P3-02/P3-05 已本地实现待评审 |
| 仅方案 | （无） | P2-01..03 已实施并合入 main=e8720f2 |
| 已完成 | P0-01..04、P1-01..05、文档同步、P2-01..07 | 全部合入远端 main=e8720f2 |

## 权重核对（总 100）
- P0：P0-01(10)+P0-02(8)+P0-03(12)+P0-04(5)=35 ✓
- P1 前端模块收敛：P1-01(12)+P1-02(3)=15 ✓
- P1 依赖与环境：P1-03+P1-04+P1-05=10 ✓
- 文档同步：8 ✓
- P2 计算内核：P2-01(5)+P2-02(4)+P2-03(3)+P2-04(2)+P2-05(2)+P2-06(1)=17 ✓
- P2 需求验证门禁：P2-07=5 ✓
- P3 Core V2 规划：P3-01..08=10 ✓
- 合计 35+15+10+8+17+5+10=100 ✓
- 已交付权重：按原任务书口径 100/100（P2-05 追加能力已在本地分支完成，P3 计规划交付 10 分）；但 P3 Core V2 实质实施仅 P3-01/P3-03/P3-04/P3-07 部分/P3-08 清单，P3-02/P3-05 本地完成待评审，P3-06 部分完成（分层首片已落地），G8 未通过，不得据此宣称 Core V2 完成。

## 说明
- P0/P1/P2 已全部进入远端 main=e8720f2：P0/P1-03..05/文档/P2-06/07 与 P1-01/02/P2-04/05 经 PR #71（merge 376b2bb）；P2-01/02/03 经 PR #72（merge e8720f2）。本地子代理分支 705fa2a（p2-analysis）、66d8efa（p2-circuit）已分别 cherry-pick 为 2c7530e/e5373f7 进入 main，内容已收，无需再合。
- 最新全量回归（P2 集成分支）：1789 passed / 14 skipped / 0 failed（junit tests 1803），覆盖率 82.70%（≥81），证据 reports/evidence/python-tests.json（status=passed，exit 0）。
- P2-06 文档契约已改「覆盖」；save_text 残余直写已接 ensure_allowed_path；「任意路径逃逸风险」经 desktop/bridge.py ensure_allowed_path 已受保护、不成立。
- P3 追加实施与 P2-05 增强均在本地分支 feat/2026-11-25-p3-core-v2（基 main=5c076eae），**未推送、未 PR**；P3-02 analysis 分层 a3ccfa8、P3-05 四层门禁 a3ccfa8；全量 pytest 1811 passed/14 skipped/0 failed、覆盖率 87%（≥81）；前端 typecheck/build/test:utils 96 passed/parity 101 TS、999 声明、91 运行模块/分层守卫 OK（24 模块、0 cycles）/端点快照 91 路径/101 条目/L1 smoke passed。
- P0-03 修复结论与回归数据见 docs/audit/findings/loop_math_fix.md；最新全量以 1789 passed/14 skipped/0 failed、覆盖率 82.70% 为准（§62），P0-04 带夹具全量与 requirements --all(43) 已回填 reports/evidence/。
