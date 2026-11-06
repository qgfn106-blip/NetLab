# Netlab 主线待办（BACKLOG）

> 最后修改：2026-11-06 18:30
> 用途：**一页回答「现在要做什么、还有什么没做」**。需求与决策的唯一口径仍是
> [REQUIREMENTS_AND_RULES.md](REQUIREMENTS_AND_RULES.md)（R01–R43 / D1–D118），进度证据在
> [PROGRESS.md](PROGRESS.md)。本文只做**汇总与排序**，不重复定义需求。
> 维护规则：做完一项就把「状态」改掉并写上证据（测试数 / 截图 / 实测数）；口径冲突以需求台账为准。

---

## 0. 一句话现状

- **能用的产品**：`start_desktop.bat` / `python -m netlab.desktop` 起 pywebview + WebView2 网页壳（**594 passed**，2026-11-06，静态 3.20.1；全量文档重构 §7.75 完成）。
- **界面口径**：前端在 `frontend/`（index.html / app.js / style.css）；Qt 原生界面已按 D78 备份到 Git 分支 `backup/qt-native-2026-11-02` 后删除，不再是产品形态。
- **已完成（一期）**：R41 前端 JavaScript→TypeScript 全局迁移（一期 P16 类型化、二期 P17 模块化均已完成），tsc strict 0 / node --test 纯函数单测绿 / AST 行为等价 / pytest 589 passed，见 REQUIREMENTS R41 / PROGRESS §7.76。
- **没做完的主线**：R25 三阶段已交付（P7-09/10/11：9 块/虚拟注册表/只读保护/另存副本/行为快速模型/`internal_sim` 开关/对比 API/UI），剩完整电路级内部结构；R19 参考级图纸暂停。**刚完成**：R31 并网逆变器 P11-01…P11-07（§7.72：L1 平均模型、`abc_dq`、SRF-PLL、dq 电流环、`sensor`/`actuator` 跨域桥、六开关三相桥示例、`cancel_precompute` 中断）；R39 复数分析层（§7.71）；R40 全栈扩展架构（§7.74，设计+代码首版完成，589 passed/3.20.1）；全量 589 passed/3.20.1。
- **实施中**：R36 非线性 / 非定常闭环求解 **P1–P5 已完成**（P1：节点求解语义标签、`Network.solver_plan()` 的 SCC/断点划分、自动 `z⁻¹` 可见记录；P2：`Network(solve_algebraic=True)` 线性 SCC 解 `(I-A)y=b`、`Scene.set_algebraic_solver()` 开关、`AlgebraicLoopError`；P3：阻尼 Newton + 有限差分雅可比 + 线搜索 + `NewtonConvergenceError`、表达式 `t`/`time` 时变变量；P4：线性网络节点方程总传函 + `tf_analysis` 网络 Bode；P5：`state:<node>:<index>` 状态通道、相图独立播放/步进/循环、`phase_metrics` L/A 指标；525 passed）。R37 线性网络总传函/Bode 对外能力已完成（s 域节点方程消元 + z 域纯 gain/sum 显式延迟），A/B/C/D 已导出（前端「导出 A/B/C/D」）；R38 状态通道/独立播放/指标/CSV 已完成（§7.66–§7.67），dt 收敛与无状态通道中文提示已补；见 [规划 spec](specs/2026-11-04-nonlinear-time-varying-solver-plan.md)。
- **刚完成**：**控制链路补强与欠阻尼工程（§7.61：超调按最终值方向、离散 `1/z` 左补零、`reset_state` 初值快照、`output=auto`、非整数时间网格；交付 `MyProject/underdamped_control.netlab`）**、**PlotKit 导入优先级 + 多工作树规范（§7.60：内置副本优先、`NETLAB_PLOTKIT_SRC` 覆盖、gmpy2 坏包清理、`tools/new_worktree.sh` + `docs/WORKTREE_RULES.md`）**、**结构护栏补齐相对导入（§7.59：`test_structure_layout.py` 解析相对/`netlab.*` 越界导入，6→14 条）**、**预计算反馈环首拍修复（§7.58：延迟边空载荷按 0、pass 空 dict 不注入）**、**信号流右键「添加」菜单按节点组分类（§7.57：基础/动态/高级/矢量/模块/接口，矢量置顶）**、**R35 输入字段自动匹配（D91 / §7.56：value 优先、显式键兼容、块端口别名）**、**架构审计修复（§7.55：PlotKit 子应用鉴权 + 宿主 shim、记录器代次、通道上限、桥生命周期、precompute 契约、缓存 API 契约）**、**R34 s 域传递函数节点与分析（D90 / §7.54：表达式/系数/零极点三形态、Bode/阶跃/零极点三视图、`POST /api/analysis/tf`）**、R26 的 UI 入口（§7.37）、D80 数据通路优化（§7.36）、D81 PlotKit 面板卡顿修复（§7.38）。

---

## 1. 现在该做的顺序

| 顺序 | 事项 | 为什么排这里 | 体量 |
| --- | --- | --- | --- |
| ① | ~~R33 收尾~~ → 已随 D78 关闭（原生壳下线，相关验收项作废） | — | — |
| ② | ~~web 版去留~~ → 已定：保留 web（D78），Qt 只留备份分支 | — | — |
| ③ | ~~R25 P7-09~~：opamp / comparator 内置只读内部结构 → **已完成（宏模型，§7.69）** | 只读内部/另存副本/空库回退已验证；电路级待后续 | — |
| ④ | ~~R25 P7-10~~：dff / counter4 / shift4 → **已完成（宏模型，§7.69）** | 承接 ③ 的同一套机制 | — |
| ⑤ | ~~R25 P7-11~~：555 / LDO / ADC / DAC → **已完成（宏模型；结构仿真开关/行为对比已补，§7.70）** | 完整电路级明确留作后续 | — |
| ⑥ | ~~R31 P11-01…P11-07~~ → **已完成（§7.72）**：L1 平均模型、`abc_dq`、SRF-PLL、dq 电流环、跨域桥、六开关示例、性能/中断 | 581 passed/3.19.0；P11-06 为趋势验证 | — |
| ⑦ | ~~复数分析层（Complex Bridge）~~ → **已完成（§7.71）**：统一 `frequency_response()` + 精确 `e^{-jωT}` + 电路 AC 复数 MNA + API | 只做分析边界，避免全量 complex；561 passed/3.18.0 | — |
| ⑧ | **R40 全栈扩展架构** → **首版完成（§7.74）**：插件包 + `netlab.plugin_api.v1` + 声明式 UI/简洁画布 | 仍需补节点拖拽细节/面板字段编辑与插件生态示例 | 大 |
| ⑨ | **R41 前端 JS→TS 迁移**（一期 P16 类型化，二期 P17 模块化）→ **一期 P16、二期 P17 均已完成（§7.76）**：7 文件全部严格类型化、1:1 编译、strict 棘轮、AST/行为等价、pytest 589 passed；详见 REQUIREMENTS R41 / PROGRESS §7.76 | 13,806 行 app.js 可维护性 + /api 契约类型化 + 模块化基建 | 已完成 |
| ⑩ | **R42 Python 代码 PEP 8 规范化**（P18，待 TS 重构完成后启动）→ **规划中（未开始）**：对 netlab + PlotKit 全部 Python 代码按 PEP 8 规范化与无损优化，不影响任何功能；详见 REQUIREMENTS R42 / P18 | 统一 Python 风格、提升可读性/可维护性，零功能变化 | 中（分模块小步、测试全绿门禁） |

> R31 已完成 P11-01…P11-07；P11-06 为理想 nmos + 50 Hz 方波栅极的趋势验证，10 kHz PWM/器件损耗留后续。

### 1.1 规划与实施（R36 P1–P5 已完成）

| 事项 | 依赖 | 规划要点 | 体量 |
| --- | --- | --- | --- |
| **R36 非线性 / 非定常闭环求解** | R35 字段层、现有 `Network.step` | 有状态节点作断点 → 直接馈通子图求 SCC → 线性环 `(I-A)y=b` → 非线性 / 时变环阻尼 Newton；显式延迟优先，自动 `z⁻¹` 只作兼容回退 | 中大 |
| **R37 线性网络总传函预计算与 Bode 幅相** | R36 的全局状态空间装配 | 纯线性网络装配 `A,B,C,D`，`G(s)=C(sI-A)^{-1}B+D`；支持串联 / 并联 / 反馈环；延迟边在 z 域按 `z⁻¹` 精确、s 域标近似；Bode 幅值 + 相位 | 中 |
| **R38 相平面 + 独立播放 + 数据分析** | R36 的状态通道 | 直接收集 `transfer_function` / 状态空间的真实状态，不从总传函反推；暴露 `state:<node>:<index>`；独立时间轴播放 / 步进 / 循环；峰值、超调、稳态、调节时间、CSV | 中 |
| **R39 复数分析层（Complex Bridge）** | R37/R38 分析出口 | `complex_support.py` 转换纯函数；`analysis.frequency_response()` 统一 signal/circuit 的 `H(jω)`；signal 精确 `e^{-jωT}`、circuit 复用复数 MNA；`nodal.ac_sweep` 增 `real/imag`；`POST /api/analysis/frequency`；时域/持久化保持实数 | 中 |
| **M1 数学加速接入（P3+P1+P5，影子验证）** | R36/R37 分析层、mathspec 原型 | 详见 [MATH_INTEGRATION_PLAN.md](MATH_INTEGRATION_PLAN.md)：M0 mathspec 原型 → M1a P1 排序评测 → M1b P3 AC 扫频 Woodbury → M1c P5 遥测误差口径 → M1d 影子集成；`NETLAB_MATH_ACCEL=off` 默认，先影子对拍再启用（M0/M1b 已完成，见 PROGRESS §7.78） | 中大 |

> 用户已拍板按文档开工。R36 **P1–P5 已完成**：节点语义标签、`Network.solver_plan()`、自动延迟记录；`Network(solve_algebraic=True)` 按 `(I-A)y=b` 解线性直接馈通环，`Scene.set_algebraic_solver(True)` 后不再自动 `z⁻¹`；非线性/时变直接馈通 SCC 走阻尼 Newton；线性网络 `analysis.transfer_function()` 支持串联/并联/反馈环，`tf_analysis()` 可直接算网络 Bode；`SignalEngine.probes()` 暴露 `state:<node>:<index>`，前端相图支持状态通道与独立播放/步进/循环；全量 525 passed。R37 对外总传函/Bode 已完成（z 域支持纯 gain/sum + 显式延迟）；R38 状态通道/播放/指标/CSV/dt 收敛/无状态提示已完成。

---

## 2. 已关闭的旧欠账（留档）

- R33 原生桌面外壳 → **D78 关闭**（整体备份到分支 `backup/qt-native-2026-11-02` 后从工作树删除），A5/A13/A14/A18/A21 等验收项随之作废。
- **web 版去留 → 已定：保留 web**（D78），Qt 只留备份分支。

## 3. 需求缺口总表（按 R 号）

> 「缺口」只列**还没做**的部分；已完成的细节看需求台账对应小节。

| R | 名称 | 缺口 | 下一步 | 体量 |
| --- | --- | --- | --- | --- |
| R01 | 工程目录与通用库 | 前端「新建/打开工程」面板、桌面桥目录选择 | 原生壳已覆盖（新建/打开/另存），web 侧冻结即可 | 已闭环 |
| R03 | 引用保护与缺失降级 | 占位块替换成新模块的交互 | 低优先：现在只能「补回库文件后重试」 | 小 |
| R04 | 模块导入前校验 | 模块面板独立「校验」按钮 | 低优先（导入流程已内置校验） | 小 |
| R06 | 跨模式接口块 | circuit 侧接口块（电压↔信号、信号↔电流源） | 与 R31 L2 跨域桥一起做更划算 | 中 |
| R09 | 连线路由与锚点 | 逐边锚点拖拽手柄（现在用下拉） | 交互打磨，可并入下一轮 UI 精修 | 小 |
| R10 | 选择/快捷键/剪贴板 | 跨工程片段文件 | 原生已有复制/粘贴/复制一份，缺「存成 .snippet」 | 小 |
| R11 | 周期推荐 | 多窗口预处理与备选周期统计 | 现在只有 FFT + 单窗口 MAE 简化版 | 中 |
| R12 | 分析能力 | 运行点线性化 Bode / AC 扫频 UI 已有 `#analWin` | 与 R26 共用实现；本次核对入口 | 已闭环 |
| R13 | 性能与超时 | 性能面板已接通 `/api/profile`；单拍超时配置与中断定位已完成 | 保护策略仍可继续细化 | 已完成 |
| R14 | 菜单与信息条 | 全局搜索（文档/节点/元件） | 文档窗已有，缺搜索框 | 小 |
| R15 | 元件清单 | 晶闸管 / IGBT / JFET / 继电器 / 电机；元件级 GB 图形细化 | 逐类加 `nodal` 模型 + 符号 + 测试 | 中大 |
| R17 | 信号流分析 | L1 术语/图形样式；L3 状态空间 / 梅森增益 | P6，未开工 | 中 |
| R18 | 图纸与规范 | 图纸模式（隐藏网格/图框）、端子号/线号、线宽分级、国标尺寸、多页图幅 | 纯渲染 + 元数据，做完「像图纸」 | 中大 |
| R19 | 参考级图纸 | ADC、变压器/互感未建模；参考级图纸**主动暂停** | 等 R25/R18 之后再恢复 | 中 |
| R20 | 器件节点模型 | 旧「边=元件」路径清零；信号/矢量端口 | 模板迁移后再删垫片 | 中 |
| R22 | 右键与导线工具 | 右键「添加」菜单已按电路/信号分组；余项逐项对照 | 继续对照 §R22 验收打勾 | 小 |
| R25 | 内置内部结构 | **P7-09/10/11 三阶段完成**（9 块/虚拟注册表/只读保护/另存副本/行为快速模型/`internal_sim`/对比 API）；仅完整电路级内部结构待后续 | 见 §1 第 ③–⑤ 项与 §7.70 | 大 |
| R26 | 求解器分析 | DC 工作点 / AC 扫频 UI 入口已在 `#analWin`；本次核对 | 与 R12 共用实现 | 已闭环 |
| R31 | 并网逆变器 | **P11-01…P11-07 已完成**（§7.72）：平均模型、abc_dq、PLL、电流环、跨域桥、六开关示例、性能/中断 | P11-06 仅趋势验证；10 kHz PWM/损耗留后续 | 完成 |
| R40 | 全栈可扩展架构 | **首版完成（§7.74）**：插件包、`netlab.plugin_api.v1`、compute/method/element/analysis/data-format/template/panel/engine 扩展点、工程 v6、简洁画布与视图设计 | 后续补节点拖拽细节/面板字段编辑与插件示例 | 大 |
| R33 | 原生桌面外壳 | A5/A13/A14/A18/A21 未验；web 去留未定 | 见 §2 | 小 |
| R34 | s 域传递函数节点与分析 | —（表达式/系数/零极点、Bode/阶跃/零极点、端点均完成） | 可选增强：Bode 光标、零极点拖动、MIMO | 已闭环 |
| R35 | 输入字段自动匹配 | —（value 优先、显式键兼容、块端口别名、22 条定向） | 可选增强：向量/矩阵跨类型自动换算（当前明确不做） | 已闭环 |
| R36 | 非线性 / 非定常闭环求解 | **P1–P5 完成**（节点语义标签、`solver_plan()` 状态断点/SCC、自动延迟记录；线性 SCC 解 `(I-A)y=b`；阻尼 Newton + 时变表达式；线性网络总传函/Bode；状态通道/相图播放） | 主线完成，后续只做回归与体验 | 已完成 |
| R37 | 线性网络总传函与 Bode 相位 | **已完成**：s 域节点方程总传函/Bode；z 域纯 gain/sum + 显式 z⁻¹；s 域延迟 Padé；A/B/C/D 已导出 | 先做 SISO，不做 MIMO | 完成 |
| R38 | 相平面 + 独立播放 + 数据分析 | **已完成**：状态通道、播放/步进/循环/滑块、L/A/峰值/超调/稳态/调节、CSV、dt 收敛测试、无状态提示 | 依赖 R36 状态通道；先做线性/二阶验收 | 完成 |

---

## 4. 待你拍板的决定

| # | 决定 | 选项 | 影响 |
| --- | --- | --- | --- |
| P1 | web 版最终形态 | (a) 删掉 `frontend/`，只留原生（b) 降级为只读看图 (c) 永久双维护 | 决定后才知道「改逻辑要不要同步两份」 |
| P2 | R19 参考级图纸是否恢复 | 恢复 / 继续暂停 | 恢复需要先有 R18 的图纸模式 |
| P3 | R20 旧「边=元件」路径何时清零 | 现在清 / 等模板全迁完 | 早清能少一层兼容垫片 |
| P4 | R31 是否现在启动 | 已拍板：已启动并完成 P11-01…P11-07（§7.72） | 后续只剩开关级精度增强 |
| P5 | R36–R38 求解器 / 分析路线是否现在开工 | 已拍板：先 R36；P1–P5 已完成 | 后续会改 `Network.step` 的求解路径与采样语义，按 spec 分阶段验收 |

---

## 5. 明确不做 / 暂停

- **R19 参考级图纸**：视觉不达标，用户主动暂停（2026-10-26）。
- **自适应 dt**：D17 明确不做。
- **PlotKit 整体改原生**：D69 只改 netlab；PlotKit 保持 web（面板懒加载嵌入）。
- **GitHub Pages 演示站**：2026-10-30 已按要求删除（PROGRESS §7.15）。

---

## 6. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-05 | **最终补强 / 集成检查**：`analysis.transfer_function(domain='z')` 支持纯 gain/sum + 显式 `z⁻¹`；`/api/analysis/tf` 暴露 `input_node`/`output_node`，新增 `/api/analysis/phase` 契约测试；`test_control_project` 加 dt 收敛（39.15%→37.53%）；相图无状态通道中文提示；静态 **3.16.17**，全量 **524 passed** |
| 2026-11-05 | **R36 P5 完成**：`state:<node>:<index>` 状态通道、`phase_metrics` L/A 指标、相图独立播放/步进/循环/帧滑块、`/api/analysis/phase` 与 `/api/analysis/tf` 参数对齐；新增 `test_state_channels.py` 3 条，全量 **521 passed**，静态 **3.16.15** |
| 2026-11-05 | **R38 相图指标/CSV 补全**：`drawPhase` 增加峰值/超调/稳态/调节时间，工具栏 `phaseExport` 复用 `/api/analysis/export`；静态 **3.16.16**，521 passed |
| 2026-11-05 | **R36 P4 完成**：线性网络节点方程总传函（串联/并联/反馈），`analysis.tf_analysis()` 支持网络 Bode；新增 `test_network_tf.py` 4 条，全量 **518 passed**，静态 3.16.14 |
| 2026-11-05 | **R36 P3 完成**：非线性 / 时变直接馈通 SCC 阻尼 Newton（有限差分雅可比、线搜索、`NewtonConvergenceError`），表达式注入 `t`/`time`；新增 3 条 Newton 测试，全量 **514 passed**，静态 3.16.14 |
| 2026-11-05 | **R36 P2 完成**：`Network(solve_algebraic=True)` / `_step_solved()`、线性直接馈通 SCC 解 `(I-A)y=b`、`AlgebraicLoopError`、`Scene.set_algebraic_solver()`；新增 `test_algebraic_solver.py` 3 条，全量 **511 passed**，静态 3.16.14 |
| 2026-11-05 | **R36 P1 完成**：`Node` 求解语义标签、`solver_traits()`、`Network.solver_plan()`（状态断点 + 直接馈通 Tarjan SCC + DAG 拓扑）、`auto_delayed_connections()`；新增 `test_solver_plan.py` 4 条，全量 **508 passed**，静态 3.16.14；spec 改 `ready-for-agent` |
| 2026-11-04 | **新增规划（未开工）**：R36 非线性/非定常闭环求解（状态断点 + SCC + Newton）、R37 线性网络总传函与 Bode 相位、R38 相平面/独立播放/数据分析；新增 D92–D94；规格 `docs/specs/2026-11-04-nonlinear-time-varying-solver-plan.md`。本轮不改代码，504 passed 基线不变 |
| 2026-11-02 | 首版：汇总 R01–R33 的未完成项、R33 收尾清单、四个待拍板决定 |
| 2026-11-02 | 原生壳补自动保存（60 s + 启动恢复），新增 `soak.py`/`restore_check.py`；A21 实测通过，A18 脚本就绪 |
| 2026-11-02 | web 前端退役（D77），同日 **D78 撤销**：Qt 原生界面备份到 Git 分支 `backup/qt-native-2026-11-02` 后删除，web 前端已恢复（356 passed） |
| 2026-11-02 | D79 结构重构（frontend/ + netlab/core 三桶）、D80 数据通路优化（383 passed）；**R26 补上 UI 入口**：工具菜单「DC 工作点 / AC 扫频」+ 电路分析浮窗（工作点表格 / Bode 幅相曲线），3 条前端护栏测试 |
| 2026-11-04 | 信号流右键「添加」菜单按节点组分类（§7.57）：基础/动态/高级/矢量/模块/接口子菜单，矢量置顶；全量 486 passed，静态 3.16.14 |
| 2026-11-04 | R35 输入字段自动匹配（D91 / §7.56）：新增 `fields.py`，`value` 优先 + 显式键兼容 + 块端口别名；全量 484 passed，静态 3.16.13 |
| 2026-11-04 | 预计算反馈环首拍修复（§7.58）：延迟边读取空源节点按 0、`pass` 空 dict 不注入；新增首拍回归测试，全量 487 passed，静态 3.16.14 |
| 2026-11-04 | 控制链路补强与欠阻尼工程（§7.61）：超调按最终值方向、离散 `1/z` 左补零、`reset_state` 初值快照、`output=auto`、非整数时间网格；交付 `MyProject/underdamped_control.netlab`；全量 504 passed，静态 3.16.14 |
| 2026-11-05 | **复数分析层 spec**：新增 [spec](specs/2026-11-05-complex-analysis-layer.md)，定义 `analysis.frequency_response()` 公共 seam、`complex_support` 小 seam 与 `POST /api/analysis/frequency`；尚未实现 |
