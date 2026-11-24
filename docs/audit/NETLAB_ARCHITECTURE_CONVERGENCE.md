# NetLab 架构收敛方案（Architecture Convergence）

> 基线提交：5c076eae55f739e2265327c0c73a7dac3440358a ｜ 版本：NetLab 3.20.2 / Project Schema 8
> 说明：本文件针对 P1-01、P1-02、P2-01..P2-06 给出「现状证据 / 目标架构 / 验证标准 / 迁移步骤（小步）/ 风险与回滚」。P1-01/P1-02 已在 feat/2026-11-24-p1-convergence 分支落地（三模块 878→786、837→800、823→774，check:sections 通过，职责矩阵见 FRONTEND_RESPONSIBILITY_MATRIX.md）；P2 仍以方案为主。所有行数与 file:line 来自 findings 与实测。

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
- frontend/app.ts：7511 行、单 IIFE、213 嵌套函数、88 endpoint。
- 入口同时承担：路由/endpoint 注册、会话与状态、视图渲染、事件命令、网络请求处理；缺乏分层边界。

### 2.2 目标架构
- 拆为：router（endpoint 注册表，88 条显式分组）、store（会话/状态）、views（渲染）、commands（事件/命令）、handlers（网络/业务）；app.ts 仅做装配与启动。
- 88 个 endpoint 收敛为声明式注册表，便于审计 endpoint 数量与路径。

### 2.3 验证标准
- endpoint 清单快照：拆分前后 88 条 endpoint 的路径与数量完全一致。
- 每文件 ≤ 800 行；导入无循环；AST 导出比对；冒烟测试（启动 + 关键路由）。

### 2.4 迁移步骤（小步）
1. 抽 handler 注册表（纯映射，不改行为）；快照 endpoint 清单。
2. 抽 store（会话/状态）并注入。
3. 抽 views 渲染层。
4. app.ts 收敛为装配入口，过行数门禁。

### 2.5 风险与回滚
- 风险：IIFE 内隐式全局变量与闭包共享状态在拆分时遗漏，导致运行时 undefined。
- 回滚：分文件独立 revert；用 endpoint 清单快照与冒烟测试守护。

## 3. P2-01 elements.stamp 与 descriptor._assemble_matrices 双轨收敛为单一 StampBuilder 契约（权重 5）

### 3.1 现状证据
- netlab/core/compute/circuit/elements.py:66 抽象基类 stamp；:107/:173/:277/:345/:376/:413/:446/:470/:511/:571/:721/:849 共 12 个具体 kind 各自实现 stamp(self, ctx: StampContext)。
- netlab/core/compute/circuit/descriptor.py:551 _assemble_matrices 按 kind 独立再装配一套。
- 仅 2 端 Laplacian 原语在 circuit/stamps.py:78 共享；两轨其余不共享。

### 3.2 目标架构
- 定义单一 StampBuilder 契约：每个器件 kind 提供一次 stamp(assembly)，向统一 MNA 三元组写入贡献；elements 与 descriptor 都调用同一 builder，删除 descriptor 中按 kind 的特判分支。
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

## 4. P2-02 AC/Bode 后端统一 ac_sweep（权重 4）

### 4.1 现状证据
- netlab/core/compute/circuit/descriptor.py:1035-1048 纯线性路径 delegate solver.ac_sweep；
- descriptor.py:1049-1086 仅非线性/强制 native 路径每频点重装矩阵求解。

### 4.2 目标架构
- 统一 ac_sweep(system, freqs) 后端；native（每频点重装）实现为 ac_sweep 的一个 strategy；线性走快速 strategy；descriptor 只负责选择 strategy，不再内联两条实现。

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

## 5. P2-03 analysis.py 结构拆分（权重 3）

### 5.1 现状证据
- netlab/core/compute/analysis.py：2854 行、45 顶层函数、class AnalysisError(78)，与 circuit 栈职责重叠（编排 + 数值 + 错误 + 包络）。

### 5.2 目标架构
- 拆为 analysis/errors（AnalysisError 等）、analysis/numerics（数值实现）、analysis/orchestrate（流程编排）、analysis/envelopes（包络展示），对外保留 facade 与既有公共 API。

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
- netlab/core/compute/accel.py:155-175、:178-223：单步 H2D/D2H 与显式 sync；min_size 门槛 192；solve_dense 遇到非有限值不回落、直接抛 ComputeError。

### 6.2 目标架构
- 形式化加速契约：输入规模 < min_size 走 CPU；GPU 路径明确 H2D/D2H 与 sync 点；非有限输入/输出统一抛 ComputeError（与 CPU 路径语义一致，不静默回落）。

### 6.3 验证标准
- 边界单测：min_size 上下、非有限输入、NaN/Inf 结果均得预期异常；CPU/GPU 结果对拍（无 GPU 时跳过 GPU 断言）。

### 6.4 迁移步骤（小步）
1. 以文档 + 断言固化 accel 契约；
2. 统一非有限值 ComputeError 处理；
3. 补齐边界单测。

### 6.5 风险与回滚
- 风险：无 GPU 环境测试跳过导致覆盖盲区；错误语义变化影响调用方。
- 回滚：契约断言可单独关闭；异常类型保持向后兼容。

## 7. P2-05 FEM 边界与单测缺口（权重 2）

### 7.1 现状证据
- netlab/core/compute/fem.py:59-75 FemConfig；:163-177 _element_matrices；:247-266 backward-Euler 时间积分；边界为左右 Dirichlet、上下绝热（Neumann）。

### 7.2 目标架构
- 边界条件显式枚举化（Dirichlet/Neumann），时间积分可插拔；对每类边界与积分组合建立单测矩阵。

### 7.3 验证标准
- 每个边界组合至少一条单测；对已知解析解/能量守恒对拍；
- 拆分/重构不改变默认配置输出（快照）。

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
