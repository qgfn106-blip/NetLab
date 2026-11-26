# NetLab 架构收敛方案（Architecture Convergence）

> 基线提交：5c076eae55f739e2265327c0c73a7dac3440358a ｜ 版本：NetLab 3.20.2 / Project Schema 8
> 说明：本文件针对 P1-01、P1-02、P2-01..P2-06 给出「现状证据 / 目标架构 / 验证标准 / 迁移步骤（小步）/ 风险与回滚」。P1-01/P1-02 已随 PR #71（merge 376b2bb）合入 main（三模块 878→786、837→800、823→774，check:sections 通过，职责矩阵见 FRONTEND_RESPONSIBILITY_MATRIX.md）；P2-01/P2-02/P2-03 已随 PR #72（merge e8720f2）合入 main（e5373f7、2c7530e）；P2-04/P2-05 安全修复与补测随 PR #71 合入（2db0867）。所有行数与 file:line 来自 findings 与实测。

## 0. 通用验证手段
- 行为等价 AST 对比：复用 P0-02 的 frontend/tools/parity_ast.js（字符串感知注释剥离 + 按文件判重）与 verify_app_parity.js，确保拆分前后导出声明集合与签名一致；后端用 AST/导出比对函数签名不变。
- 快照测试：对每个待拆模块的公共方法（构造、渲染产物、事件响应、序列化结构）建立快照，拆分前后逐点比对。
- 行数门禁：前端沿用 frontend/tools/check_app_sections.mjs MAX_MODULE_LINES=800；后端为每文件设定目标行数与职责边界评审。
- 回滚单元：每个迁移步骤限定在独立新文件 + 一处装配改动，单独 PR 可 revert。

## 1. P1-01 分析工作台三模块按 model/render/interaction/facade 四层拆分（权重 12）

### 1.1 现状证据
- frontend/app/analysis_chart.ts = 878 行、analysis_workbench.ts = 837 行、analysis_workbench_canvas.ts = 823 行（实测），均超 frontend/tools/check_app_sections.mjs:12 MAX_MODULE_LINES=800，S5 结构门判失败。
- analysis_chart.ts 的 AnalysisChart 类跨度 84-874，职责四簇混杂：
  - 数据模型：baseView(324)/axisMap(378)/panelCount(382)/panelFor(387)/overrides(463)/resolvedScale(488)/gridView(493)，顶层 paddedRange(71)/logSafeRange(77)，状态 setEnvelope(161)/getEnvelope(174)/getViewState(194)/applyViewState(205)；
  - 渲染：tokens(401)/scheduleRender(393)/render(425)/buildStore(472)/buildSpec(506)；
  - 交互：bindEvents(255)/onWheel(603)/onPointerDown(621)/onPointerMove(643)/onPointerUp(670)/hoverAt(693)/nearestCurve(745)，以及 readout/tooltip/overlay(759+)；
  - 外观与生命周期：constructor(122)/getAppearance(178)/setAppearance(182)/setDetailHost(189)/refreshDetail(230)/setCursorFrequency(235)/resetView(242)/destroy(248)/renderToolbar(274)/createAnalysisChart(876)。
- 依赖：analysis_chart_plot.js(:28)、analysis_chart_utils.js(:29,:35)。

### 1.2 目标架构（每模块四层）
- model 层（纯数据/状态，无 DOM）：视图/坐标/面板/覆盖/尺度/包络状态与范围换算（paddedRange/logSafeRange）。
- render 层（依赖 model 与 plot utils，产视图产物）：tokens/scheduleRender/render/buildStore/buildSpec。
- interaction 层（依赖 render 产物，处理指针/滚轮/hover）：bindEvents/onWheel/onPointerDown/onPointerMove/onPointerUp/hoverAt/nearestCurve，输出 readout/tooltip/overlay。
- facade 层（对外 API）：constructor/get/setAppearance/setDetailHost/refreshDetail/setCursorFrequency/resetView/destroy/renderToolbar/createAnalysisChart，仅委托各层。
- analysis_workbench.ts、analysis_workbench_canvas.ts 以同一四层模板拆分，共享 model 与 render 契约。

### 1.3 验证标准
- 拆分后每个 .ts 文件 ≤ 800 行（check_app_sections.mjs 通过）。
- 行为等价：verify_app_parity.js 对导出声明集合/签名通过；新增快照测试对每层公共行为（视图状态、渲染产物、交互响应）拆分前后逐点一致。
- 无新增循环依赖（依赖方向固定 facade→interaction→render→model）。

### 1.4 迁移步骤（小步，每步独立 PR）
1. 抽 model 层（纯数据/状态，无 DOM），保持 facade 内联调用；跑 AST + 快照。
2. 抽 render 层（依赖 model 与 plot utils）；跑快照。
3. 抽 interaction 层（依赖 render 产物）；补交互快照。
4. 抽 facade 对外 API，入口仅装配；过行数门禁。
5. 对 analysis_workbench / canvas 重复同模板。

### 1.5 风险与回滚
- 风险：事件绑定时机、渲染节流（scheduleRender）与实际绘制顺序变化引发回归；四层边界不清导致循环依赖。
- 回滚：每层为独立新文件 + 一处装配改动，单 PR 可 revert；用快照 + 交互用例兜底。

## 2. P1-02 前端入口 app.ts 职责边界梳理与拆分（权重 3）

### 2.1 现状证据
- frontend/app.ts：原 7511 行、单 IIFE、213 嵌套函数、88 endpoint；P3-06 已完成全部迁移（dd0e924），现仅 5 行装配入口，业务函数分居 14 个 `frontend/app/editor_*` 模块（全部 ≤800 行），并保留 endpoints.ts/store.ts/commands.ts/shell_view.ts/router.ts/handlers.ts/views.ts 等分层模块；A2 TS 环 0。
- 入口同时承担：路由/endpoint 注册、会话与状态、视图渲染、事件命令、网络请求处理；缺乏分层边界。

### 2.2 目标架构
- 拆为：router（endpoint 注册表，后端 88 条契约、前端快照 91 唯一路径/101 条目）、store（会话/状态）、views（渲染）、commands（事件/命令）、handlers（网络/业务）；app.ts 仅做装配与启动。
- 88 个后端 endpoint 契约收敛为声明式注册表（前端实测 91 唯一路径），便于审计 endpoint 数量与路径。

### 2.3 验证标准
- endpoint 清单快照：拆分前后后端 88 条 endpoint 契约、前端快照 91 唯一路径 / 101 方法+路径条目的路径与数量完全一致。
- 每文件 ≤ 800 行；导入无循环；AST 导出比对；冒烟测试（启动 + 关键路由）。

### 2.4 迁移步骤（小步）
1. 抽 handler 注册表（纯映射，不改行为）；快照 endpoint 清单。
2. 抽 store（会话/状态）并注入。
3. 抽 views 渲染层。
4. app.ts 收敛为装配入口，过行数门禁。

### 2.5 风险与回滚
- 风险：IIFE 内隐式全局变量与闭包共享状态在拆分时遗漏，导致运行时 undefined。
- 回滚：分文件独立 revert；用 endpoint 清单快照与冒烟测试守护。

## 3. P2-01 elements.stamp 与 descriptor._assemble_matrices 双轨收敛为单一 StampBuilder 契约（权重 5）｜已实施（e5373f7，已合并）

### 3.1 现状证据
- netlab/core/compute/circuit/elements.py:66 抽象基类 stamp；:107/:173/:277/:345/:376/:413/:446/:470/:511/:571/:721/:849 共 12 个具体 kind 各自实现 stamp(self, ctx: StampContext)。
- netlab/core/compute/circuit/descriptor.py:551 _assemble_matrices 按 kind 独立再装配一套。
- 仅 2 端 Laplacian 原语在 circuit/stamps.py:78 共享；两轨其余不共享。

### 3.2 目标架构
- 定义单一 StampBuilder 契约：每个器件 kind 提供一次 stamp(assembly)，向统一 MNA 三元组写入贡献；elements 与 descriptor 都调用同一 builder，删除 descriptor 中按 kind 的特判分支。
- 落地：新增 circuit/stamp_builder.py（StaticMatrixSink + ElementStampSink + 每 kind stamp_<kind> 贡献函数）；descriptor._assemble_matrices 199→23 行、删除 9 路 kind 特判；elements 各器件 stamp 委托共享函数。电感 element.stamp 用二端伴随、descriptor 静态用独立支路，布局不同按设计保留。
- 新增器件只需实现一次 stamp。

### 3.3 验证标准
- 每个 kind 断言 elements.stamp 结果与 descriptor 装配结果矩阵逐项相等（容差 0）；
- 新增器件仅一处实现；覆盖率维持 CI 门 --cov-fail-under=81。

### 3.4 迁移步骤（小步）
1. 抽象 StampBuilder 接口，并适配 descriptor 现有逻辑到该接口（保持输出不变）。
2. 按 kind 逐个迁移，每迁移一个加对拍测试（新旧结果相等）。
3. 删除 descriptor._assemble_matrices 的重复 kind 分支，elements 改调 builder。

### 3.5 风险与回滚
- 风险：受控源/多端器件（VCVS/VCCS/opamp）装配边界、数值等价。
- 回滚：保留旧路径 feature flag，按 kind 灰度切换；每 kind 对拍通过再删旧。

## 4. P2-02 AC/Bode 后端统一 ac_sweep（权重 4）｜已实施（e5373f7，已合并）

### 4.1 现状证据
- netlab/core/compute/circuit/descriptor.py:1035-1048 纯线性路径 delegate solver.ac_sweep；
- descriptor.py:1049-1086 仅非线性/强制 native 路径每频点重装矩阵求解。

### 4.2 目标架构
- 统一 ac_sweep(system, freqs) 后端；native（每频点重装）实现为 ac_sweep 的一个 strategy；线性走快速 strategy；descriptor 只负责选择 strategy，不再内联两条实现。
- 落地：新增 circuit/ac_backend.py（FastLinearStrategy / NativePerFrequencyStrategy / select_strategy），descriptor.frequency_response 改为薄封装；线性四路 Bode 对拍 rtol 1e-8/atol 1e-12 通过。

### 4.3 验证标准
- 同一电路在线性 / 非线性 / 强制 native 三模式下 Bode 幅相逐点对拍（给定容差）；
- 性能不退化（native 路径耗时基线）。

### 4.4 迁移步骤（小步）
1. 提 ac_sweep strategy 接口；
2. 将 native 每频点重装实现为 strategy；
3. descriptor 改为只选 strategy；跑三模式对拍。

### 4.5 风险与回滚
- 风险：数值差异、性能回退。
- 回滚：strategy 可切换，保留原直接调用路径开关。

## 5. P2-03 analysis.py 结构拆分（权重 3）｜已实施（2c7530e，已合并）

### 5.1 现状证据
- netlab/core/compute/analysis.py：2854 行、45 顶层函数、class AnalysisError(78)，与 circuit 栈职责重叠（编排 + 数值 + 错误 + 包络）。

### 5.2 目标架构
- 拆为 analysis/errors（AnalysisError 等）、analysis/numerics（数值实现）、analysis/orchestrate（流程编排）、analysis/envelopes（包络展示），对外保留 facade 与既有公共 API。
- 落地：新增 analysis_errors.py 与 analysis_numerics.py（8 个纯数值函数），analysis.py 2848→2771 行并保持再导出；API 快照 0 差异，test_analysis*.py 169 passed/7 skipped。编排/facade 有意保留，未硬拆。

### 5.3 验证标准
- 公共函数/类签名不变（AST/导出比对）；每文件行数下降并满足职责边界；全量测试全绿、覆盖率维持 81。

### 5.4 迁移步骤（小步）
1. 抽 errors 层（低耦合）；
2. 抽 numerics 层；
3. 抽编排层；
4. facade 收口。

### 5.5 风险与回滚
- 风险：循环导入、隐式共享状态、异常路径语义变化。
- 回滚：分文件独立 revert；保留 facade 使外部不受影响。

## 6. P2-04 GPU 边界与非有限 ComputeError（权重 2）

### 6.1 现状证据
- netlab/core/compute/accel.py:178-223：单步 H2D/D2H 与显式 sync；min_size 门槛 192。原 solve_dense 在 GPU 解出非有限值时 `raise ComputeError` 并被 `except ComputeError: raise` 直接重抛，未回退 CPU，与模块 docstring「任何 GPU 初始化、显存或数值异常都会退回 CPU」相矛盾。

### 6.2 目标架构（已落地）
- 加速契约：输入规模 < min_size 走 CPU；GPU 路径明确 H2D/D2H 与 sync 点；GPU 初始化/显存/数值异常一律记录并回退 CPU（`status().gpu_error` 可审计）；若 CPU 仍解出非有限值或矩阵奇异，则抛 ComputeError。

### 6.3 验证标准（已满足）
- 边界单测：min_size 上下、非有限输入、GPU 非有限结果回退、CPU 奇异、形状错误；`netlab/tests/test_accel_fallback.py` 5 条用例 8 passed（含 FEM 3 条）。

### 6.4 迁移步骤（已执行）
1. 修正 GPU 非有限值为 RuntimeError，落入 `except Exception → _record_gpu_failure → CPU`；
2. 保留非有限输入/奇异矩阵的 ComputeError；
3. 补齐边界单测。

### 6.5 风险与回滚
- 风险：无 GPU 环境以 fake 对象覆盖，真实驱动差异未覆盖；回退后 CPU 可能更慢。
- 回滚：单文件 revert；异常语义仅影响 GPU 路径，CPU 调用方不变。

## 7. P2-05 FEM 边界与单测缺口（权重 2）

### 7.1 现状证据
- netlab/core/compute/fem.py:59-75 FemConfig；:163-177 _element_matrices；:247-266 backward-Euler 时间积分；边界为左右 Dirichlet、上下绝热（Neumann）。

### 7.2 目标架构
- 边界条件显式枚举化（Dirichlet/Neumann），时间积分可插拔；对每类边界与积分组合建立单测矩阵。

### 7.3 验证标准
- 每个边界组合至少一条单测；对已知解析解/能量守恒对拍；
- 拆分/重构不改变默认配置输出（快照）。
- 已补 `netlab/tests/test_fem.py`：Q4 刚度行和为零、质量矩阵对称正定且总质量=ρc·A；左右 Dirichlet 保持 20℃；无源均匀场保持 20℃（上下 Neumann 无通量）；Gauss 源加热内部而边界不变。3 条 passed。

### 7.4 迁移步骤（小步）
1. 边界条件枚举化（保持默认行为）；
2. 补边界单测矩阵；
3. 时间积分可插拔（默认 backward-Euler 不变）。

### 7.5 风险与回滚
- 风险：数值稳定性、边界组合遗漏。
- 回滚：积分后端与边界实现可切换，默认路径不变。

## 8. P2-06 路径安全契约（权重 1）

### 8.1 现状证据
- netlab/core/model/path_guard.py:9 docstring 本轮已由「追加受信根目录」改为「覆盖默认根目录（设置后仅信任列出的根）」，与 allowed_roots()（对 NETLAB_ALLOWED_ROOTS 采用替换语义）一致。
- netlab/desktop/bridge.py 经 atomic_write / load_project_raw 内部 ensure_allowed_path（project.py:1075,1126）已受保护，「任意路径逃逸」风险不成立。
- 残余：netlab/desktop/webview_bridge.py:206 save_text 直写，未接 ensure_allowed_path。

### 8.2 目标架构
- 统一契约：所有写盘入口（含 save_text）必须经 ensure_allowed_path；文档明确「覆盖」语义。

### 8.3 验证标准
- 逃逸单测：.. / 符号链接 / 不同盘符 / 覆盖语义 env（NETLAB_ALLOWED_ROOTS）均按预期拒绝或允许；save_text 越界被拒。

### 8.4 迁移步骤（小步）
1. save_text 接 ensure_allowed_path；
2. 补逃逸单测；
3. 文档定稿（覆盖语义 + 各入口清单）。

### 8.5 风险与回滚
- 风险：合法导出路径被误拒（用户目录外）。
- 回滚：通过 NETLAB_ALLOWED_ROOTS 显式放宽根目录；单点改动可 revert。
