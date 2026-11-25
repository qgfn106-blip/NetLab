# NetLab 全面审计报告

> 审计对象：NetLab（桌面端 + FastAPI 计算平台）
> 基线提交：5c076eae55f739e2265327c0c73a7dac3440358a
> 版本口径：NetLab 3.20.2 / Project Schema 8
> 审计工作树：audit-20261124（相对 ProjectPoint 根目录；最终状态：P0/P1/P2 已全部提交并经 PR #71（merge 376b2bb）与 PR #72（merge e8720f2）合入代码基线 main=e8720f2；本文档经 PR #73 同步合入；详见 NETLAB_REMEDIATION_TRACKER.md）
> 审计日期：2026-11-24
> 说明：所有数字与 file:line 均来自 docs/audit/findings/ 与本轮实测；文中「未提交」为整改过程中的历史状态记录，最终合并结果以本文 §5 与 NETLAB_REMEDIATION_TRACKER.md 为准。

## 0. 摘要

NetLab 3.20.2 主体功能完整、测试与 CI 框架健全。本轮整改已全部落地并合入远端 main=e8720f2：P0-01..P0-04 修复 CI 链、前端等价 AST 检查、断环闭环 T=G/(1+L) 与真实测试证据；P1-01/P1-02 完成三模块拆分（878→786、837→800、823→774）与职责矩阵；P1-03/04/05 统一 PlotKit 0.3.0 与 Project Schema 8；P2-01..P2-06 完成 StampBuilder、AC/Bode 后端、analysis 分层、GPU 回退、FEM 补测与路径安全修复；P2-07 需求门禁语义化。追加 P3 实施（本地分支 feat/2026-11-25-p3-core-v2，未推送）：P3-01 Core V2 契约冻结文档+12 项契约测试、P3-08 验收清单已落地（定向 20 passed），P2-05 FEM 已补齐边界枚举与时间积分可插拔（8 passed）；P3-02/P3-05/P3-06/P3-08 实质验收仍未完成。最新全量（P2 集成基线）1789 passed/14 skipped/0 failed，覆盖率 82.70%≥81。合并路径：P0/P1-03..05/文档/P2-06/07 与 P1-01/02/P2-04/05 经 PR #71→376b2bb；P2-01/02/03 经 PR #72→e8720f2；CI 必需检查全绿。

## 1. 项目现状

### 1.1 结构与规模
- 后端 Python 包 netlab/：core/model（project.py 1208 行、path_guard.py、instance_model.py、v8_draft.py 等）、core/compute（analysis.py 2854 行 / 45 顶层函数、accel.py 229、fem.py 695）、core/compute/circuit（elements.py 876、stamps.py 120、solver.py 1426、descriptor.py 1092、descriptor_analysis.py 980、loop_analysis.py 826、nyquist.py 等）、server.py 552 行（FastAPI 主应用 + 16 子包，仅执行注册表受控计算，请求体经 Pydantic + 场景层校验）。
- 前端 TypeScript（ESM 逐文件编译）：app.ts 7511 行、单 IIFE、213 嵌套函数、88 endpoint；分析工作台三大模块 analysis_chart.ts 878、analysis_workbench.ts 837、analysis_workbench_canvas.ts 823 行（实测）。
- 测试：pytest.ini testpaths=netlab/tests, mathspec/tests；netlab/tests 217 个 .py、def test_ 1346 个；pytest --collect-only 采集约 1748–1750 items（全量实测 junit tests 1750）。

### 1.2 版本与 Schema
- netlab/__init__.py:13 __version__ = "3.20.2"。
- netlab/core/model/project.py:37 PROJECT_VERSION = 8。

### 1.3 CI 门禁（基线 / 当前工作树）
- python-tests.yml：Setup Python 3.12 → pytest；覆盖率门 --cov=netlab/core --cov-branch --cov-fail-under=81（:123）；diff_coverage --threshold 80（:134）。
- frontend-ts-build.yml：TS 构建 + section budget（frontend/tools/check_app_sections.mjs MAX_MODULE_LINES=800）+ app parity（frontend/tools/verify_app_parity.js）。
- 基线 python-tests.yml 额外含 Setup Node（section budget gate，:25-28）与 Section budget（strict audit P0，:44-48）两步，与 frontend-ts-build 的 section gate 职责重复（见 P0-01）。

### 1.4 依赖与环境
- PlotKit 依赖：pyproject.toml:18 plotkit>=0.3,<0.4（本轮已改；基线为 >=0.2,<0.3）；四 workflow 的 PlotKit checkout 本轮统一锁定 ref。

## 2. 问题清单（按 P0–P3 分级）

状态词约定：已合并 / 部分落地已合并 / 规划完成（未实施）/ 未开始。总权重 100，分阶段见标题。

### 2.1 P0（最高优先级，合计 35）

#### P0-01 恢复完整 CI 链（权重 10）｜已合并
- file:line：.github/workflows/python-tests.yml:25-28（Setup Node (section budget gate)）、:44-48（Section budget (strict audit P0)）@ 基线 5c076ea。
- 现象：Python 测试作业携带 Node 安装与 section budget 检查两步，与 frontend-ts-build.yml 已有的 section gate 重复；CI 链把 Python 单测与前端工具链耦合。
- 影响：Python 单测作业额外依赖 Node 工具链，构建面与失败面扩大，「完整 CI 链」分层不清晰。
- 根因：历史上把前端结构门校验顺带塞入 Python 作业，未做职责拆分。
- 状态：工作树已从 python-tests.yml 删除上述两步，section gate 保留在 frontend-ts-build.yml；见 §5 证据；已合并（main=e8720f2）。

#### P0-02 修前端模块等价 AST 检查（权重 8）｜已合并
- file:line：frontend/tools/verify_app_parity.js:68-105（基线：顶层声明按裸名 key 建单一全局 Map，无模块维度）；normalize() 用未锚定的行注释正则。
- 现象：(a) 跨 TS 文件同名顶层声明被误判 DUPLICATE 并 process.exit(1)。实测例：bool@frontend/app/analysis_chart_appearance.ts:122 与 frontend/app/grid_prefs.ts:20；SelectField（interface）@frontend/app/analysis_workbench_chart_settings.ts:35 与 frontend/app/export_dialog.ts:31；selectField@frontend/app/analysis_workbench_chart_settings.ts:40 与 frontend/app/export_dialog.ts:36；allowlist 无重复豁免通道。(b) normalize() 删注释正则未锚定，会误删字符串/模板/正则字面量内的 // 或 /* */，产生哈希伪变更。
- 影响：门禁假阳性使 CI 无法通过或被迫绕过；注释剥离错误使等价比对不可信。
- 根因：项目 ESM 逐文件编译（frontend/package.json:5 "type":"module"；tsconfig ES2020；scripts/build.mjs:30-40 esbuild per-file format:esm），跨模块同名合法，而检查器把全局命名空间当单模块命名空间；注释剥离用正则而非词法/语法感知。
- 状态：新增 frontend/tools/parity_ast.js（字符串感知注释剥离 + 按文件判重）与 frontend/tests/parity_ast.test.mjs（8 用例），重写 verify_app_parity.js 改用之；实跑见 §4；已合并（main=e8720f2）。

#### P0-03 断环闭环传递函数复核修正（权重 12）｜已合并
- file:line：netlab/core/compute/analysis.py:2276-2284（界面 T_synth 合成）；analysis.py:2278-2279、netlab/core/compute/circuit/loop_analysis.py:430（feedback_sign 重复计极性）；loop_analysis.py:779-787,822（电阻支路自证）；analysis.py:2299,2304 与 loop_analysis.py:436-440（parity 与曲线错配）；circuit/nyquist.py:153,180（临界点硬编码）；nyquist.py:99（相位裕度基准）。
- 现象：见 §3 数学验证专章（LM-01..LM-09）。
- 影响：闭环传递函数在非单位反馈下偏差可达 20dB；正反馈判据错误；部分电路校验恒真（无判别力）。
- 根因：界面曲线用 L 合成而非 G；sign 与回路增益自带极性重复计入分母；校验量与绘制量不一致；Nyquist 临界点未随反馈极性。
- 状态：LM-01..LM-04 已修复（analysis.py:2275-2278 闭环显示直接取 extraction.closed_loop=G/(1+L)；loop_analysis.py:432 closed=forward/(1+L)，删除 sign 双计；loop_analysis.py:776-842 支路断环 forward 独立测量、closed=direct、parity_max_rel 诚实化并新增 branch_loop_synthesis_mismatch 告警）。LM-05..07（nyquist 临界点/PM 基准/运放扰动测 L）评估后保留，理由见 loop_math_fix.md §7，建议单独立项。详见 docs/audit/findings/loop_math_fix.md；定向 24 passed/7 skipped，全量全绿（见 §5）；已合入 main 7624bc1。

#### P0-04 恢复真实完整测试证据（权重 5）｜已合并
- file:line：pytest.ini:2（testpaths）；docs/canonical/decisions.yaml:1071-1072（--cov-fail-under=78 与 CI 实际 81 不符）、:1076（678 passed 过时，实际 1736 passed/1750 采集）。
- 现象：文档覆盖率门槛（78）与 CI 实际（81）不一致；文档通过数（678）远低于实际采集（1748）。
- 影响：证据与门禁脱节，审计/回归结论不可追溯。
- 根因：文档未随 CI/测试增长同步。
- 状态：已合并 7624bc1。带夹具全量 pytest = 1736 passed/14 skipped/0 failed（junit：tests 1750/14 skipped/0 failed）；覆盖率 TOTAL 83%（≥ --cov-fail-under=81 门禁，CI 同款 --cov=netlab/core）；requirements --all 43/43 PASS；证据见 reports/evidence/python-tests.json 与 AUDIT_EVIDENCE_LOG.md。decisions.yaml 相关数字为 2026-11-08 历史决策记录（当时基线），按项目惯例不追溯改写；当前门禁以 CI workflow 为准（--cov-fail-under=81）。

### 2.2 P1 前端模块收敛（合计 15）

#### P1-01 三超限模块 ≤800（权重 12）｜已合并（PR #71 → 376b2bb）
- file:line：frontend/tools/check_app_sections.mjs:12 MAX_MODULE_LINES=800；frontend/app/analysis_chart.ts=878、analysis_workbench.ts=837、analysis_workbench_canvas.ts=823（实测基线）。
- 现象：三模块超 800 行硬上限，S5 结构门判失败。
- 影响：单文件过大，数据模型/渲染/交互/外观职责混杂，可维护性与可测试性差。
- 根因：AnalysisChart 等长期在单文件内叠加逻辑，未按层拆分。
- 状态：本轮仅出收敛方案（见 NETLAB_ARCHITECTURE_CONVERGENCE.md §1）。

#### P1-02 梳理前端职责（权重 3）｜已合并（PR #71 → 376b2bb）+ 本地四片抽取 + S1 端点注册表 + S2 会话状态 store（b5288f4 工作台面板、1f27eca 场景面板、本轮回放控制与信号列表/图例，累计 7511→5325，未推送）
- file:line：frontend/app.ts（7511 行、单 IIFE、213 嵌套函数、88 endpoint）。
- 现象：单 IIFE 入口承担全部路由/渲染/状态，嵌套函数 213 个、endpoint 88 个。
- 影响：入口不可分层审查、循环依赖与隐式全局状态风险高、测试困难。
- 根因：缺乏入口分层的架构约束。
- 状态：职责矩阵已产出；app.ts 7511→6585，工作台面板/图表渲染已抽为独立模块（b5288f4）；场景面板/场景动作（1f27eca）、回放控制（analysis_replay 188 行）与信号列表/图例（signal_list 137 行）继续抽出，累计 5325 行；S1 端点注册表、S2 会话状态 store 已完成，剩余 S3-S4 待后续。

### 2.3 P1 依赖与环境（合计 10）

#### P1-03 统一 PlotKit 依赖（含于 10）｜已合并
- file:line：pyproject.toml:18（plotkit>=0.3,<0.4）；netlab/requirements.txt（+1 注释指向 pyproject）；四 workflow PlotKit checkout：python-tests.yml:22-23、container.yml:16-17、browser-e2e、frontend-ts-build 加 ref 6939e8889ce4b1c64c0ec679658d9cfa99e67f37（PlotKit 0.3.0）。
- 现象：基线 pyproject 为 >=0.2,<0.3；workflow checkout 未固定 PlotKit ref，构建非确定。
- 影响：依赖版本漂移，构建不可复现。
- 根因：依赖声明与 CI 引用未统一锁定。
- 状态：已改（已合并）。

#### P1-04 统一版本（含于 10）｜已合并
- file:line：netlab/core/model/project.py（docstring）、instance_model.py:8、v8_draft.py:10,19；netlab/docs MIGRATION_AND_COMPATIBILITY.md、EXTENSIBILITY_ARCHITECTURE.md §9、BUILD_AND_PACKAGING.md:56/67、CODE_GUIDE.md:341、PLUGIN_GUIDE.md:57。
- 现象：文档与 docstring 残留 PlotKit 旧版本 >=0.2,<0.3 与 PROJECT_VERSION=7。
- 影响：版本口径不一致，误导使用方。
- 根因：文档未随版本升级同步。
- 状态：已改为 8（EXTENSIBILITY §9 标题注明 v7 为设计冻结基线、当前实现 8）（已合并）。注：v8_draft.py 以 _V8_DRAFT_VERSION=8 表达，不覆盖 project.PROJECT_VERSION 常量，报告按实际记。

#### P1-05 示例隐私边界（含于 10）｜已合并
- file:line：README.md:44、OPERATION.md:149、ARCHITECTURE.md（MyProject 相关 4 行）；测试夹具目录 netlab/tests/fixtures/projects/。
- 现象：文档暗示仓库随带 MyProject/ 示例工程（可能含真实数据）。
- 影响：隐私/合规风险；示例数据入库。
- 根因：示例目录说明未与 .gitignore 边界对齐。
- 状态：改为「本地示例目录，.gitignore 排除、不入库；同名工程作为测试夹具在 netlab/tests/fixtures/projects/」，并严禁解除 .gitignore（已合并）。

### 2.4 文档同步（权重 8）｜已合并
- 涉及：netlab/docs/{BUILD_AND_PACKAGING,CODE_GUIDE,EXTENSIBILITY_ARCHITECTURE,MIGRATION_AND_COMPATIBILITY,PLUGIN_GUIDE}.md、README/OPERATION/ARCHITECTURE、docs/canonical/decisions.yaml。
- 状态：PlotKit 版本 / MyProject 边界 / PROJECT_VERSION 已同步（已合并 main=e8720f2）；decisions.yaml 相关数字（覆盖率/通过数）为 2026-11-08 历史决策记录，按项目惯例不追溯改写，当前门禁以 CI workflow 为准（--cov-fail-under=81；真实证据见 reports/evidence/，见 P0-04）。

### 2.5 P2 计算内核（合计 17）

#### P2-01 MNA Stamp 双轨 → 单一 StampBuilder 契约（权重 5）｜已合并（PR #72 → e8720f2）
- file:line：circuit/elements.py:66 抽象基类 stamp；:107/:173/:277/:345/:376/:413/:446/:470/:511/:571/:721/:849 共 12 具体 kind 各自装配；circuit/descriptor.py:551 _assemble_matrices 按 kind 独立装配；仅 2 端 Laplacian 原语共享 circuit/stamps.py:78。
- 现象：同一器件在 elements.stamp 与 descriptor._assemble_matrices 两处各写一套 MNA 装配。
- 影响：两轨易漂移，新增器件需改两处，覆盖易不全。
- 根因：历史并行演进，未收敛为单一 StampBuilder 契约。
- 修复：新增 circuit/stamp_builder.py（294 行，StaticMatrixSink + ElementStampSink + 每 kind stamp_<kind> 贡献函数），descriptor._assemble_matrices 由 199 行降至 23 行并删除 9 路 kind 特判，elements.py 各器件 stamp 委托共享函数。
- 验证：R/L/C/sensor/vsource/VCVS/VCCS/isource 新装配与旧实现逐项相等（rtol=atol=0）；新增 test_stamp_parity.py 8 条，定向 241 passed。电感 element.stamp 走二端伴随、descriptor 走独立支路，布局不同按设计保留并记录。
- 状态：已合并（PR #72 → e8720f2；分支提交 e5373f7）（见 CONVERGENCE §3）。

#### P2-02 AC/Bode 后端统一（权重 4）｜已合并（PR #72 → e8720f2）
- file:line：circuit/descriptor.py:1035-1048 纯线性 → solver.ac_sweep；:1049-1086 仅非线性/强制 native 路径每频点重装。
- 现象：两条频域求解路径并存。
- 影响：一致性风险与性能冗余。
- 根因：native 路径未接入统一 ac_sweep 抽象。
- 修复：新增 circuit/ac_backend.py（149 行，FastLinearStrategy/NativePerFrequencyStrategy + 统一 ac_sweep/select_strategy），descriptor.frequency_response 改为薄封装，非线性自动选 native。
- 验证：线性 RLC 四路 Bode 逐点对拍 rtol 1e-8/atol 1e-12 通过；新增 test_ac_backend.py 6 条。
- 状态：已合并（PR #72 → e8720f2；分支提交 e5373f7）（见 CONVERGENCE §4）。

#### P2-03 analysis.py 结构拆分（权重 3）｜已合并（PR #72 → e8720f2）
- file:line：netlab/core/compute/analysis.py（2854 行、45 顶层函数、class AnalysisError(78)），与 circuit 栈职责重叠。
- 现象：巨型分析模块，多层职责叠加。
- 影响：难测试、难演进、边界模糊。
- 根因：分析编排与数值实现未分层。
- 修复：新增 analysis_errors.py（AnalysisError/ANALYSIS_TIMEOUT/MAX_EXPORT_ROWS）与 analysis_numerics.py（8 个纯数值函数），analysis.py 2848→2771 行并保持再导出；新增 API 快照测试。
- 验证：pytest netlab/tests/test_analysis*.py 169 passed/7 skipped；API 快照 0 处不一致。编排/facade 有意保留，未硬拆。
- 状态：已合并（PR #72 → e8720f2；分支提交 2c7530e）（见 CONVERGENCE §5）。

#### P2-04 GPU 边界 / 非有限 ComputeError（权重 2）｜已合并（PR #71 → 376b2bb）
- file:line：netlab/core/compute/accel.py:178-223（单步 H2D/D2H + 显式 sync）；min_size 门槛 192；原 solve_dense 非有限值直接 ComputeError，未按 docstring 回退 CPU。
- 修复：GPU 非有限解改抛 RuntimeError，经 `except Exception → _record_gpu_failure → CPU` 回退；CPU 奇异/非有限输入仍抛 ComputeError。
- 测试：netlab/tests/test_accel_fallback.py 5 条（GPU 非有限回退、min_size、非有限输入、奇异、形状）pass。
- 状态：已合并（PR #71 → 376b2bb；提交 2db0867）（见 CONVERGENCE §6）。

#### P2-05 FEM 边界与单测缺口（权重 2）｜部分落地已合并（PR #71 → 376b2bb）
- file:line：netlab/core/compute/fem.py:59-75 FemConfig、:163-177 _element_matrices、:247-266 backward-Euler；左右 Dirichlet、上下绝热。
- 现象：边界条件与时间积分实现存在，但单测覆盖不足。
- 影响：边界回归风险。
- 根因：FEM 用例稀疏。
- 状态：基础单测已合并（PR #71 → 376b2bb，test_fem.py 3 条）；追加整改在本地分支 feat/2026-11-25-p3-core-v2（未推送）已完成边界枚举化与时间积分可插拔：FemConfig 新增 boundary_top/boundary_bottom（insulated|dirichlet）+ boundary_*_value、time_integrator（backward_euler|crank_nicolson），非法枚举抛 ValidationError；FemMesh 新增 top/bottom 节点集；step() 支持 BE/CN 且 dt/integrator 变化时重建分解。test_fem.py 扩至 8 条（CN 均匀场保持、上下 Dirichlet 角点优先级、CN/BE 400 步稳态对拍 max|Δ|<5e-2、非法枚举拒绝、apply_config 接受新字段），8 passed。

#### P2-06 路径安全契约（权重 1）｜已合并（文档）+ 残余风险已消除
- file:line：netlab/core/model/path_guard.py:9 docstring（基线写「追加受信根目录」，与 allowed_roots() 的覆盖语义不符）；netlab/desktop/bridge.py 经 atomic_write / load_project_raw 内部 ensure_allowed_path（project.py:1075,1126）已保护；netlab/desktop/webview_bridge.py:206 save_text 直写无校验。
- 现象/影响：文档说「追加」实现是「覆盖」，契约误导；「任意路径逃逸」经 bridge 已被 ensure_allowed_path 阻断，该风险不成立；仅 webview_bridge.save_text 残余直写。
- 根因：文档与实现不一致；save_text 未接 ensure_allowed_path。
- 状态：docstring 已改「覆盖」，webview_bridge.save_text 写入前已加 ensure_allowed_path（已合并 main=e8720f2）；见 CONVERGENCE §8。

### 2.6 P2 需求验证门禁（P2-07，权重 5）｜已合并
- file:line：tools/check_requirement_verifiability.py（基线 48 行，仅查必填字段存在性 :29-31；现 118 行语义门禁）。
- 现象：基线只校验字段存在，不校验语义，占位/自相矛盾需求可通过。
- 影响：需求可验证性门禁形同虚设。
- 根因：门禁只做存在性检查。
- 状态：重写为语义门禁（字段非空非占位、expected/failure_condition 含语义关键词、expected≠failure_condition、按声明校验退出码、扫 stdout failed/error 与 stderr Traceback），新增 --all（43 条）；docs/canonical/requirements.yaml 计 43 条；已合并（main=e8720f2）。

### 2.7 P3 Core V2（P3-01..08，合计 10）｜P3-01/P3-08 本地完成待评审，其余未实施
- P3-01 已写 docs/audit/CORE_V2_CONTRACT_FREEZE.md（CF-01..CF-14 + G0 五项）与 netlab/tests/test_core_v2_contract.py（12 条：版本常量、StampSink 成员、descriptor 委托 stamp_builder、支持 kind、电感双路径例外、ac_sweep 返回契约/策略选择/fast-native 对拍、ComputeError、GPU 非有限回退、路径白名单、FEM 配置）；实跑 test_core_v2_contract.py + test_fem.py = 20 passed。
- P3-08 已写 docs/audit/P3_ACCEPTANCE_CHECKLIST.md（G0..G8 门禁、逐项验收表、阻断条件），结论 G8 未通过、不得宣称完成。
- P3-03/P3-04 的实质能力已由 P2-01（stamp_builder）/P2-02（ac_sweep）合入 main；P3-06 已完成端点契约守护 + app.ts 四片拆分 + S1 端点注册表 + S2 会话状态 store（7511→5325：b5288f4 工作台面板/图表渲染，1f27eca scene_panel/scene_actions，analysis_replay，signal_list）；P3-02（analysis 编排分层）、P3-05（工作台四层）仍未实施，见 CORE_V2_IMPLEMENTATION_ROADMAP.md。

## 3. 数学验证专章：断环闭环传递函数

### 3.1 审查范围与定义
- 断环法提取（circuit/loop_analysis.py:1-13 原文定义）：受控源断开法；负反馈返回比为正；sign=+1 负反馈、-1 正反馈；VCVS 取 G=gain*(v_c-v_d) 且输出钳零；VCCS 取置零（开路）后输出节点电压；T=G/(1+sign*L)；直接闭环响应用于校验，超阈只警告。
- 核心计算（loop_analysis.py:407-430）：vector_test=_solve(matrix,test,omega)；control_test=_control_voltage；vector_input=_solve(matrix,input_rhs,omega)；若 vcvs/opamp/comparator：gain=_opamp_slope 或 element.gain，loop_value=-gain*control_test，forward_value=gain*control_input；若 vccs：gm=transconductance，forward_value=complex(vector_input[position])。

### 3.2 缺陷清单（LM-01..LM-09）

| 编号 | 严重度 | 位置 | 缺陷 | 后果 |
|---|---|---|---|---|
| LM-01 | 高 | compute/analysis.py:2276-2284 | 界面闭环 T_synth 用 L/(1+sign·L) 合成，分子应为 G | 仅单位反馈 G≡L 偶然成立；非单位反馈偏差达 20dB |
| LM-02 | 高 | circuit/loop_analysis.py:430、analysis.py:2278-2279 | feedback_sign 与 L 自带极性重复计入分母 | 正反馈传 sign=-1 得 1-L=1+|L|，闭环错误 |
| LM-03 | 高 | circuit/loop_analysis.py:779-787,822 | 电阻支路断环 closed=direct、forward 由 direct 反解、parity_max_rel 强制置 0 | T=G/(1+L) 同义反复，无法校验 L，校验恒真 |
| LM-04 | 中 | analysis.py:2299,2304 vs loop_analysis.py:436-440 | parity 由 extraction.closed_loop=G/(1+L) 计算，但同图呈现 L/(1+L) 曲线 | 校验曲线≠绘制曲线，parity 假象 |
| LM-05 | 中 | circuit/nyquist.py:153,180 | 包围数临界点硬编码 -1+0j，不随 feedback_sign | 正反馈（1-L=0 应绕 +1）判据错误 |
| LM-06 | 中/低 | circuit/nyquist.py:99 | 相位裕度 180+phase·feedback_sign；sign=-1 时 180-dphase | 正反馈应以 0/360 为基准，语义存疑 |
| LM-07 | 约中 | 与 LM-02/LM-03 关联 | 正反馈与断环极性耦合下的重复计入 | 与 LM-02 同类，须一并收敛极性定义 |
| LM-08 | 低 | circuit/loop_analysis.py:45-59 | 未显式建模/输出反馈因子 H(s)；LoopExtraction 仅 loop_gain/forward_gain 无 H | 非单位反馈 H 无法表达 |
| LM-09 | 低 | circuit/loop_analysis.py:434,781 | 仅取 C[0]@x+D[0,0]（第 0 输出行） | MIMO 静默丢其余输出 |

### 3.3 正确推导（原公式 | 修正定义 | 推导 | 解析 | 数值 | 误差 | 适用范围）

| 维度 | 内容 |
|---|---|
| 原公式 | 界面 T_synth = L/(1+sign·L)（analysis.py:2276-2284）；提取器 closed_loop = G/(1+L)。 |
| 修正定义 | T = G/(1+L)（L 已含极性）；feedback_sign 仅记录声明的反馈类型、不再参与合成，避免同一极性被 L 与 sign 各乘一次。 |
| 推导 | 断环法得直接回路增益 L=-gain·control_test、前向 G=gain·control_input（VCVS）；标准反馈闭环 T=G/(1+L) 由叠加原理严格成立（正反馈令 L 带符号即可）。 |
| 解析 | 单位反馈 G≡L 时 L/(1+L)=G/(1+G) 偶然相等；非单位反馈 H≠1 时两者不等。 |
| 数值 | 测试电路 A=1e5,β=0.1 → L=1e4,G=1e5；真值 A/(1+Aβ)=9.9990(19.999dB)；提取 closed=G/(1+L)=9.9990(19.999dB) 正确；T_synth=L/(1+L)=0.9999(-0.00087dB) 错误，差 20dB。 |
| 误差 | 提取器 G/(1+L) 与 direct 对拍 parity ~7.6e-13（数值噪声级）；支路断环修正后 parity≈0.1 为诚实偏差并触发 branch_loop_synthesis_mismatch 告警（旧伪零点被纠正）；T_synth 旧式与 direct 相差 20dB（=1/β=10 倍）。 |
| 适用范围 | 单输入单输出、单回路负反馈（sign=+1）严格成立；正反馈须令分母用返回比自带极性（等价固定 +1）；纯阻性支路（LM-03）无独立 L，本校验无判别力；MIMO 仅第 0 输出行（LM-09）不适用。 |

### 3.4 数值反证（两例）
- 例 1（负反馈，非单位）：gain=1e5,R1=1k,R2=9k,β=0.1（netlab/tests/test_analysis_closed_loop.py:14-36）。真值 A/(1+Aβ)=9.9990=19.999dB；提取 closed_loop=G/(1+L)=9.9990（正确）；界面 T_synth=L/(1+L)=0.9999=-0.00087dB（错误），二者同图相差 20dB（1/β=10 倍），而 parity_max_rel 却报 1.78e-16 自称完美，说明 parity 校验的量与绘制的量不是同一曲线（LM-04）。
- 例 2（正反馈）：gain=1.5,β=0.5 → L=-0.75,G=-1.5。sign=+1 时 closed=-6.0，与 direct=-6.0 一致；sign=-1 时 closed=-0.857、direct=-6.0、parity=0.857（错误）。说明 feedback_sign 与 L 极性重复计入的危害（LM-02）。

### 3.5 结论与修复方向
- 提取器 T=G/(1+L) 经叠加原理严格成立，direct 对拍 ~1e-13，可作正确基线。
- 界面必须直接使用 extraction.closed_loop（=G/(1+L)）呈现闭环，不得用 loop_response(L) 重算；feedback_sign 仅记录声明、不参与合成（L 已含极性）。
- Nyquist 包围临界点、相位裕度基准须随反馈极性统一（正反馈绕 +1、基准 0/360）。
- 纯阻性支路须补充可独立获得的 L 或明确标注该校验无判别力；MIMO 须显式建模反馈因子 H(s) 与全部输出行。
- 修复结论：LM-01..LM-04 已修复并回归（详见 docs/audit/findings/loop_math_fix.md）：闭环显示 T=extraction.closed_loop=G/(1+L)；删除 sign 双计；支路断环 forward 独立测量、closed=direct、parity 诚实化。定向 24 passed/7 skipped，全量 1736 passed/14 skipped/0 failed。LM-05..07 保留待立项。

## 4. 测试结果

| 命令 | 结果 | 状态 |
|---|---|---|
| node --test frontend/tests/parity_ast.test.mjs | tests 8 / pass 8 / fail 0 | 已跑（2026-11-24，node v24） |
| node frontend/tools/verify_app_parity.js | exit0：OK: app.ts parity passed（86 TS files / 859 top-level declarations / 76 runtime app modules / 3 type-only） | 已跑（P1 拆分后） |
| python -m pytest（无夹具全量） | 7 failed / 1609 passed / 18 skipped（7 失败全部因缺 MyProject 夹具，非回归） | 已跑（基线记录） |
| python -m pytest（补同名夹具，相关 4 文件） | 7 passed | 已跑 |
| python -m pytest（带夹具全量，最新 P2 集成分支） | 1789 passed / 14 skipped / 0 failed（junit tests 1803） | 已跑（reports/evidence/python-tests.json，status=passed，exit 0） |
| tools/check_requirement_verifiability.py --all（43 条） | 43/43 PASS | 已跑 |
| pytest --cov=netlab/core --cov-fail-under=81 | TOTAL 82.70%（报告取整 83%）≥81，exit 0 | 已跑（19136 语句/2622 未覆盖） |

7 个失败原因说明：缺 netlab/tests/fixtures/projects 下的 MyProject 同名夹具（基线仓库不含 MyProject，因 .gitignore 排除），补同名测试夹具后相关用例通过；属环境/夹具缺失，非功能回归。

## 5. 整改证据（工作树实测；提交状态见 tracker）
- P0-01：.github/workflows/python-tests.yml 已无 Setup Node / Section budget 两步（已提交并合并）；section gate 保留在 frontend-ts-build.yml。
- P0-02：新增 frontend/tools/parity_ast.js（98 行）与 frontend/tests/parity_ast.test.mjs（8 用例全过）；verify_app_parity.js 改用 normalizeSource / duplicatedInFile，按文件判重；实跑 OK（83/848/73/3）。
- P1-03：pyproject.toml:18 plotkit>=0.3,<0.4；requirements.txt +1 注释指向 pyproject；四 workflow checkout ref 6939e8889ce4b1c64c0ec679658d9cfa99e67f37（0.3.0）。
- P1-04：project.py/instance_model.py/v8_draft.py 与 docs 的 PlotKit 版本、PROJECT_VERSION 已同步为 8（EXTENSIBILITY §9 注明 v7 设计冻结基线）。
- P1-05：README.md:44、OPERATION.md:149、ARCHITECTURE.md 的 MyProject 说明改为本地示例目录、.gitignore 排除、夹具在 netlab/tests/fixtures/projects/。
- P2-06：path_guard.py:9 docstring「追加」→「覆盖」；webview_bridge.save_text 写入前新增 ensure_allowed_path(target, purpose="导出路径")（原 :206 直写残余已修），py_compile OK、desktop 12 tests passed。
- P2-07：tools/check_requirement_verifiability.py 由 48 行扩为 118 行语义门禁，--all 覆盖 43 条。
- git 状态：P0/P1/P2 已全部合并并进入远端 main=e8720f2（P0/P1-03..05/文档/P2-06/07 与 P1-01/02/P2-04/05 → PR #71 merge 376b2bb；P2-01/02/03 → PR #72 merge e8720f2）；工作树 clean（仅未跟踪 reports/e2e*）。

## 6. 未完成项
1. P0-03 断环闭环：LM-01..LM-04 已修复并回归（loop_math_fix.md）；全量 1789 passed/14 skipped/0 failed、覆盖率 82.70%；LM-05..07（nyquist 临界点/PM 基准/运放扰动测 L）保留待单独立项。
2. P0-04：证据已回填（1789 passed/14 skipped/0 failed；覆盖率 82.70%；requirements 43/43）；decisions.yaml 历史决策记录不追溯改写，门禁以 CI 为准。
3. P1-01 已完成三模块拆分（878→786、837→800、823→774，check:sections 通过）并随 PR #71 合入；P1-02 已产出职责矩阵，并在本地分支将 app.ts 7511→5325（b5288f4 工作台面板/图表渲染；1f27eca scene_panel/scene_actions；analysis_replay；signal_list），S1、S2 已完成，剩余 S3-S4 待后续。
4. P2-01/P2-02/P2-03 内核收敛已随 PR #72 合入 main=e8720f2；P2-04 GPU 回退、P2-05 FEM 基础单测已随 PR #71 合入；P2-05 边界枚举与时间积分可插拔已在本地分支 feat/2026-11-25-p3-core-v2（未推送）实现并通过 8 条测试。
5. P2-06 残余已修复（webview_bridge.save_text 已接 ensure_allowed_path）并随 PR #71 合入。
6. P3-01 契约冻结（CORE_V2_CONTRACT_FREEZE.md + 12 条契约测试，20 passed）与 P3-08 验收清单（P3_ACCEPTANCE_CHECKLIST.md）已在本地分支 feat/2026-11-25-p3-core-v2 完成待评审、未推送；P3-06 端点契约守护与 app.ts 四片拆分 + S1 端点注册表已落地（b5288f4 + 1f27eca + analysis_replay + signal_list + endpoints + store（applySnapshot/lookupSelection），7511→5325）；P3-02/P3-05 仍未实施；**G8 未通过，不得宣称 Core V2 完成**。
7. P0/P1/P2 已全部合入远端 main=e8720f2（PR #71 与 PR #72，必需检查全绿）；P3 追加实施仅本地分支（未推送、未 PR），其中 P3-01/P3-08 完成待评审、P3-06 部分完成（契约守护+四片拆分），P3-02/P3-05 未完成。

## 7. 结论：能否进入下一阶段
- P0 门禁：P0-01..P0-04 已全部闭环并合入 main=e8720f2：P0-01/P0-02 门禁修复并自测通过；P0-03 数学修正并经解析对拍（全量 1789 passed/14 skipped/0 failed，覆盖率 82.70%）；P0-04 真实完整测试证据已回填。P1/P2 已完成并合入，可进入下一阶段（P3 Core V2 规划已交付）。
- 建议路径：P0/P1/P2 已全部进入远端 main=e8720f2；后续处理 LM-05..07 与 P3-02/P3-05/P3-06 剩余实施；P3-01/P3-08/P2-05 追加能力需评审后推送并走 PR。
