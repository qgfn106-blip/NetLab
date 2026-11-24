# NetLab 整改进度追踪表（Remediation Tracker）

> 基线提交：5c076eae55f739e2265327c0c73a7dac3440358a ｜ 当前远端 main：e8720f2（P1 PR #71 merge 376b2bb；P2 PR #72 merge e8720f2）
> 版本：NetLab 3.20.2 / Project Schema 8 ｜ 审计日期：2026-11-24
> 状态取值（严格）：已合并 / 部分落地已合并 / 规划完成（未实施）/ 未开始。「提交」列：具体 commit 与合并结果（PR/merge commit）。

## 总表

| ID | 权重 | 状态 | 涉及文件 | 提交 | 证据 | 未完成原因 |
|---|---|---|---|---|---|---|
| P0-01 | 10 | 已合并 | .github/workflows/python-tests.yml | 7624bc1 → main e8720f2 | 已删 Setup Node(:,25-28) 与 Section budget(:44-48) 两步；section gate 保留 frontend-ts-build.yml | 已合并 main=e8720f2（PR #71/#72 必需检查全绿） |
| P0-02 | 8 | 已合并 | frontend/tools/verify_app_parity.js、frontend/tools/parity_ast.js、frontend/tests/parity_ast.test.mjs | 7624bc1 | parity_ast 8 用例全 pass；verify_app_parity 实跑 OK(83 TS/848 声明/73 运行模块/3 仅类型) | 已合并 |
| P0-03 | 12 | 已合并 | netlab/core/compute/analysis.py、netlab/core/compute/circuit/loop_analysis.py、netlab/core/compute/circuit/nyquist.py | 7624bc1 → main e8720f2 | LM-01..LM-04 已修复（T=G/(1+L)，删除 sign 双计，支路断环 forward 独立测量/closed=direct/parity 诚实化），loop_math_fix.md；最新全量 1789 passed/14 skipped/0 failed、覆盖率 82.70% | LM-05..07（nyquist 临界点/PM/运放测 L）保留待立项 |
| P0-04 | 5 | 已合并 | reports/evidence/、tools/run_evidence.py（pytest.ini/decisions.yaml 只读复核，未改） | 7624bc1 → main e8720f2 | 全量 1789 passed/14 skipped/0 failed（junit 1803）；覆盖率 82.70%（≥81 门禁）；requirements --all 43/43 PASS；reports/evidence/python-tests.json+AUDIT_EVIDENCE_LOG.md | decisions.yaml 为历史记录不追溯改写 |
| P1-01 | 12 | 已合并 | frontend/app/analysis_chart.ts(878→786)、analysis_workbench.ts(837→800)、analysis_workbench_canvas.ts(823→774)；新增 analysis_chart_spec.ts(133)、analysis_workbench_chrome.ts(78)、analysis_workbench_canvas_ids.ts(52) | bf49b27 + 8cf00e9 → PR #71 merge 376b2bb | check_app_sections OK（S5 通过）；verify_app_parity OK(86 TS/859 decl/76 模块)；build/tsc/test:utils 88 全绿 | 无；app.ts 主拆分 S1-S4 属后续 |
| P1-02 | 3 | 已合并 | docs/audit/FRONTEND_RESPONSIBILITY_MATRIX.md、frontend/app.ts | bf49b27 → PR #71 merge 376b2bb | 职责矩阵（entry→facade→interaction→render→model→util）已产出，现状违规与 S1-S4 后续拆分路径已记录 | app.ts 主拆分仍为后续 S1-S4（不破坏行为） |
| P1-03 | 含于 10 | 已合并 | pyproject.toml、netlab/requirements.txt、四 workflow（python-tests/container/browser-e2e/frontend-ts-build） | 7624bc1 | plotkit>=0.3,<0.4；checkout ref 6939e8889ce4b1c64c0ec679658d9cfa99e67f37(0.3.0) | 已合并 |
| P1-04 | 含于 10 | 已合并 | netlab/core/model/{project.py,instance_model.py,v8_draft.py}、netlab/docs 5 篇、README/BUILD/CODE_GUIDE/PLUGIN_GUIDE | 7624bc1 | PlotKit 版本与 PROJECT_VERSION 同步为 8（EXTENSIBILITY §9 注明 v7 设计冻结基线） | 已合并 |
| P1-05 | 含于 10 | 已合并 | README.md、OPERATION.md、ARCHITECTURE.md | 7624bc1 | MyProject 说明改为「本地示例目录、.gitignore 排除、不入库；同名工程夹具在 netlab/tests/fixtures/projects/」 | 已合并 |
| 文档同步 | 8 | 已合并 | netlab/docs 5 篇、README/OPERATION/ARCHITECTURE、docs/canonical/decisions.yaml | 7624bc1 | 版本/示例边界/PROJECT_VERSION 已同步 | decisions.yaml 数值为历史决策记录，按惯例不追溯改写；门禁以 CI 为准（--cov-fail-under=81） |
| P2-01 | 5 | 已合并 | circuit/stamp_builder.py(新增294)、circuit/descriptor.py、circuit/elements.py、tests/test_stamp_parity.py | e5373f7 → PR #72 merge e8720f2 | descriptor._assemble_matrices 由 199 行降至 23 行、删除 9 路 kind 特判；R/L/C/sensor/vsource/VCVS/VCCS/isource 新装配与旧实现逐项相等（rtol=atol=0）；定向 241 passed | 电感 element.stamp 走二端伴随、descriptor 走独立支路，布局不同按设计保留并如实记录 |
| P2-02 | 4 | 已合并 | circuit/ac_backend.py(新增149)、circuit/descriptor.py、tests/test_ac_backend.py | e5373f7 → PR #72 merge e8720f2 | FastLinearStrategy/NativePerFrequencyStrategy + 统一 ac_sweep；线性 RLC 四路 Bode 逐点对拍 rtol 1e-8/atol 1e-12 通过；非线性自动选 native；descriptor.frequency_response 仅薄封装 | 返回值新增 strategy 键（附加信息） |
| P2-03 | 3 | 已合并 | netlab/core/compute/analysis.py、analysis_errors.py(新增)、analysis_numerics.py(新增)、tests/test_analysis_api_surface.py | 2c7530e → PR #72 merge e8720f2 | 异常层与 8 个纯数值函数迁出，analysis.py 2848→2771 行并保持再导出；API 快照 0 处不一致；pytest netlab/tests/test_analysis*.py 169 passed/7 skipped | 编排与 facade 有意保留，未硬拆 |
| P2-04 | 2 | 已合并 | netlab/core/compute/accel.py、netlab/tests/test_accel_fallback.py | 2db0867 → PR #71 merge 376b2bb | GPU 非有限解不再直抛 ComputeError，改为 RuntimeError→_record_gpu_failure→CPU 回退，与模块 docstring 一致；新增 5 条边界单测，8 passed | 无 |
| P2-05 | 2 | 部分落地已合并 | netlab/core/compute/fem.py、netlab/tests/test_fem.py | 2db0867 → PR #71 merge 376b2bb | 新增 Q4 单元矩阵（行和为零/质量对称正定/总质量=ρcA）与边界物理测试 3 条，均 passed；边界枚举化与时间积分可插拔未实施 | 架构重构仍为后续方案 §7 |
| P2-06 | 1 | 已合并 | netlab/core/model/path_guard.py、netlab/desktop/bridge.py、netlab/desktop/webview_bridge.py | 7624bc1 | path_guard.py:9 docstring「追加」改「覆盖」；webview_bridge.save_text 写入前接 ensure_allowed_path；desktop 12 tests passed | 已修复 |
| P2-07 | 5 | 已合并 | tools/check_requirement_verifiability.py（requirements.yaml 只读复核） | 7624bc1 | 约 48→118 行语义门禁（非空非占位/语义关键词/expected≠failure_condition/按声明校验退出码/扫 failed/error/Traceback），--all 43 条 | 已合并 |
| P3-01 | —（阶段合计 10） | 规划完成（未实施） | docs/audit/CORE_V2_IMPLEMENTATION_ROADMAP.md | 随审计文档提交 | 规划已交付，见 CORE_V2_ROADMAP §P3-01 | 本轮只规划，不强制重写 |
| P3-02 | —（阶段合计 10） | 规划完成（未实施） | 同上 | 随审计文档提交 | 规划已交付，见 CORE_V2_ROADMAP §P3-02 | 本轮只规划 |
| P3-03 | —（阶段合计 10） | 规划完成（未实施） | 同上 | 随审计文档提交 | 规划已交付，见 CORE_V2_ROADMAP §P3-03 | 本轮只规划 |
| P3-04 | —（阶段合计 10） | 规划完成（未实施） | 同上 | 随审计文档提交 | 规划已交付，见 CORE_V2_ROADMAP §P3-04 | 本轮只规划 |
| P3-05 | —（阶段合计 10） | 规划完成（未实施） | 同上 | 随审计文档提交 | 规划已交付，见 CORE_V2_ROADMAP §P3-05 | 本轮只规划 |
| P3-06 | —（阶段合计 10） | 规划完成（未实施） | 同上 | 随审计文档提交 | 规划已交付，见 CORE_V2_ROADMAP §P3-06 | 本轮只规划 |
| P3-07 | —（阶段合计 10） | 规划完成（未实施） | 同上 | 随审计文档提交 | 规划已交付，见 CORE_V2_ROADMAP §P3-07 | 本轮只规划 |
| P3-08 | —（阶段合计 10） | 规划完成（未实施） | 同上 | 随审计文档提交 | 规划已交付，见 CORE_V2_ROADMAP §P3-08 | 本轮只规划 |

## 状态汇总

| 状态 | 条目 | 说明 |
|---|---|---|
| 已合并 main | P0-01..P0-04、P1-01..P1-05、文档同步、P2-01..P2-04、P2-06、P2-07 | 全部进入远端 main=e8720f2（P0/P1-03..05/文档/P2-06/07 与 P1-01/02/P2-04/05 经 PR #71→376b2bb；P2-01/02/03 经 PR #72→e8720f2；CI 必需检查全绿） |
| 实施中 | （无） | — |
| 部分落地已合并 | P2-05 | FEM 单测已随 PR #71 合入 main=e8720f2；边界枚举化/时间积分可插拔待后续 |
| 规划完成（未实施） | P3-01..08 | CORE_V2 路线图已交付，按任务书本轮只规划不重写 |
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
- 已交付权重：99/100（P2-05 架构重构 2 分中 FEM 边界枚举/时间积分可插拔 1 分未做，其余全部落地；P3 计规划交付 10 分）

## 说明
- P0/P1/P2 已全部进入远端 main=e8720f2：P0/P1-03..05/文档/P2-06/07 与 P1-01/02/P2-04/05 经 PR #71（merge 376b2bb）；P2-01/02/03 经 PR #72（merge e8720f2）。本地子代理分支 705fa2a（p2-analysis）、66d8efa（p2-circuit）已分别 cherry-pick 为 2c7530e/e5373f7 进入 main，内容已收，无需再合。
- 最新全量回归（P2 集成分支）：1789 passed / 14 skipped / 0 failed（junit tests 1803），覆盖率 82.70%（≥81），证据 reports/evidence/python-tests.json（status=passed，exit 0）。
- P2-06 文档契约已改「覆盖」；save_text 残余直写已接 ensure_allowed_path；「任意路径逃逸风险」经 desktop/bridge.py ensure_allowed_path 已受保护、不成立。
- P0-03 修复结论与回归数据见 docs/audit/findings/loop_math_fix.md；最新全量以 1789 passed/14 skipped/0 failed、覆盖率 82.70% 为准（§62），P0-04 带夹具全量与 requirements --all(43) 已回填 reports/evidence/。
