# Netlab 文档索引（DOCS INDEX）

> 最后核对：2026-11-07 00:25 · 当前基线：静态 3.20.1 / 622 passed / R01–R43 / D1–D119；新增 **CODE_STANDARDS.md（代码规范，强制）**
> 目的：先在这里找文档，不要凭文件名猜新旧。**历史文档保留原文，但不得作为当前实现口径。**

## 1. 建议阅读路线

| 你是 | 先读 | 再读 |
| --- | --- | --- |
| 第一次使用 | [README.md](../../README.md) | [OPERATION.md](../../OPERATION.md) |
| 想安装/离线部署 | [INSTALL.md](../../INSTALL.md) | [user/quickstart.md](user/quickstart.md) |
| 想理解整体架构 | [ARCHITECTURE.md](../../ARCHITECTURE.md) | [ARCHITECTURE.md](ARCHITECTURE.md)（详细版） |
| 想查数学公式 | [MATH.md](MATH.md) | [CODE_GUIDE.md](CODE_GUIDE.md) |
| 想写插件/扩展 | [EXTENSIBILITY_ARCHITECTURE.md](EXTENSIBILITY_ARCHITECTURE.md) | [EXTENDING.md](EXTENDING.md) |
| 想改前端/UI | [UI_SPEC.md](UI_SPEC.md) | [FRAMEWORK_CHEATSHEET.md](FRAMEWORK_CHEATSHEET.md) |
| 想知道项目做到哪 | [PROGRESS.md](PROGRESS.md) | [BACKLOG.md](BACKLOG.md) |
| 想查需求/决策 | [REQUIREMENTS_AND_RULES.md](REQUIREMENTS_AND_RULES.md) | [adr/0002-plugin-extension-architecture.md](adr/0002-plugin-extension-architecture.md) |
| 想改代码（贡献者 / agent） | **[CODE_STANDARDS.md](CODE_STANDARDS.md)** | [AGENT_GUIDE.md](AGENT_GUIDE.md) |

## 2. 当前有效文档（active）

### 2.1 项目入口

| 文档 | 用途 | 状态 |
| --- | --- | --- |
| [README.md](../../README.md) | 定位、主要能力、快速开始、演示、文档导航 | 当前 |
| [ARCHITECTURE.md](../../ARCHITECTURE.md) | 面向贡献者的短架构：分层、数据流、扩展点 | 当前 |
| [OPERATION.md](../../OPERATION.md) | 界面操作、工作流、演示图、快捷键 | 当前 |
| [INSTALL.md](../../INSTALL.md) | 安装、离线部署、局域网、故障排查 | 当前 |

### 2.2 架构与开发

| 文档 | 用途 | 状态 |
| --- | --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 详细架构与运作原理（含 R31/R39/R40） | 当前 |
| [CODE_GUIDE.md](CODE_GUIDE.md) | 目录地图、模块职责、关键符号、调用链 | 当前 |
| [MATH.md](MATH.md) | 数学原理与实际实现位置 | 当前 |
| [FRAMEWORK_CHEATSHEET.md](FRAMEWORK_CHEATSHEET.md) | 机制速查、常见坑、token 节约 | 当前 |
| [MODULES_HOWTO.md](MODULES_HOWTO.md) | 模块化/封装/内部结构操作 | 当前 |
| [SCHEMATIC_DRAWING_SPEC.md](SCHEMATIC_DRAWING_SPEC.md) | 电路图绘制规范 | 当前 |
| [PERFORMANCE_AND_CONCURRENCY.md](PERFORMANCE_AND_CONCURRENCY.md) | 并发/性能评估研究：多线程·多进程·异步·数据压缩编解码·计算优化（评估记录，非实现口径） | 当前（研究） |
| [MATH_INTEGRATION_PLAN.md](MATH_INTEGRATION_PLAN.md) | R43 数学成果接入计划：P1 稀疏排序 / P3 AC 扫频 Woodbury / P5 遥测误差预算，影子验证 M0–M1d | 当前 |
| [UNIFIED_SIM_MATH_SPEC.md](UNIFIED_SIM_MATH_SPEC.md) | 统一仿真数学规范（§0–§17 完整；§0–§16 于 2026-11-06 从会话日志恢复） | 研究（完整） |
| [WORKTREE_RULES.md](WORKTREE_RULES.md) | 多工作树/多会话规范 | 当前 |
| [VSCODE_INTEGRATION.md](VSCODE_INTEGRATION.md) | VS Code 内嵌集成 | 当前 |

### 2.3 扩展体系

| 文档 | 用途 | 状态 |
| --- | --- | --- |
| [EXTENSIBILITY_ARCHITECTURE.md](EXTENSIBILITY_ARCHITECTURE.md) | `netlab.plugin_api.v1`、manifest、EngineProtocol、工程 v6、UI profile | 当前（首版实现完成） |
| [PLUGIN_GUIDE.md](PLUGIN_GUIDE.md) | 插件包目录、manifest 与 `PluginContext` 快速示例 | 当前 |
| [EXTENDING.md](EXTENDING.md) | 快速扩展指南；顶部链接插件包规范 | 当前（legacy 段落保留） |
| [adr/0002-plugin-extension-architecture.md](adr/0002-plugin-extension-architecture.md) | 24 条扩展架构决策 | 当前 |
| [GLOSSARY.md](GLOSSARY.md) | 全项目术语表 | 当前 |

### 2.4 UI / 用户文档

| 文档 | 用途 | 状态 |
| --- | --- | --- |
| [UI_SPEC.md](UI_SPEC.md) | 界面规范、设计令牌、简单画布/视图内设计 | 当前 |
| [user/quickstart.md](user/quickstart.md) | 5 分钟上手 | 当前 |
| [user/interface.md](user/interface.md) | 界面区域说明 | 当前 |
| [user/shortcuts.md](user/shortcuts.md) | 快捷键 | 当前 |
| [user/faq.md](user/faq.md) | 常见问题 | 当前 |
| [user/glossary.md](user/glossary.md) | 用户术语 | 当前 |

### 2.5 需求、进度与经验

| 文档 | 用途 | 状态 |
| --- | --- | --- |
| [REQUIREMENTS_AND_RULES.md](REQUIREMENTS_AND_RULES.md) | R01–R43 需求、D1–D119 决策、分期、不做清单 | 当前 |
| [PROGRESS.md](PROGRESS.md) | 执行证据与验收记录（含 §7.70–§7.78） | 当前 |
| [BACKLOG.md](BACKLOG.md) | 当前主线、剩余项、待拍板决定 | 当前 |
| [LESSONS.md](LESSONS.md) | 踩坑与经验（按 §7.x 记录） | 当前 |
| [AGENT_GUIDE.md](AGENT_GUIDE.md) | Agent 开工三问、文档路由、闸门 | 当前 |
| [CODE_STANDARDS.md](CODE_STANDARDS.md) | **代码规范（强制）**：TS/JS + Python + 测试 + 提交 + 文档规范；改代码前必读 | 当前 |

### 2.6 功能规格（spec，按日期归档）

| 文档 | 主题 | 状态 |
| --- | --- | --- |
| [2026-11-03-s-domain-transfer-function.md](specs/2026-11-03-s-domain-transfer-function.md) | s 域传递函数 | 已实现，历史证据 |
| [2026-11-04-auto-field-matching.md](specs/2026-11-04-auto-field-matching.md) | 字段自动匹配 | 已实现，历史证据 |
| [2026-11-04-control-transient-feedback.md](specs/2026-11-04-control-transient-feedback.md) | 控制瞬态反馈 | 已实现，历史证据 |
| [2026-11-04-nonlinear-time-varying-solver-plan.md](specs/2026-11-04-nonlinear-time-varying-solver-plan.md) | 非线性/非定常求解 | 已实现，历史证据 |
| [2026-11-05-global-tf-delay-and-time-metrics.md](specs/2026-11-05-global-tf-delay-and-time-metrics.md) | 全局传函延迟/时域指标 | 已实现，历史证据 |
| [2026-11-05-r25-builtin-internal-structures.md](specs/2026-11-05-r25-builtin-internal-structures.md) | R25 内置结构/行为模型 | 已实现（宏模型阶段） |
| [2026-11-05-signalflow-plotkit-analysis-curves.md](specs/2026-11-05-signalflow-plotkit-analysis-curves.md) | 信号流→PlotKit 分析曲线 | 已实现 |
| [2026-11-05-complex-analysis-layer.md](specs/2026-11-05-complex-analysis-layer.md) | R39 复数分析层 | 已实现 |

## 3. 历史/参考文档（historical）

这些文档保留当时的决策与技术评估，**不再作为当前行为依据**；引用时请标注“历史”。

> 2026-11-06 文档整理：已删除 7 个已完成/过期文档（`DOCUMENTATION_PLAN.md`、`IMPLEMENTATION_PLAN.md`、`QT_NATIVE_SPEC.md`、`NGSPICE_SOLVER_COMPARISON.md`、`SOLVER_OPTIMIZATION_PLAN.md`、`SOLVER_OPTIMIZATION_REPORT.md`、`TS_P17_MODULE_DESIGN.md`）；原文见 git 历史。`docs/specs/*` 作为已实现功能的验收证据保留。

| 文档 | 状态 | 说明 |
| --- | --- | --- |
| [SOLVER_CODE_MAP.md](SOLVER_CODE_MAP.md) | reference | 求解器代码地图，按当前代码需复核后使用 |
| [adr/0001-schematic-layer.md](adr/0001-schematic-layer.md) | accepted | 示意图层决策（仍有效） |

## 4. 文档维护规则

1. 新功能必须先写/更新 spec 或 ADR，再改代码；完成后同步本索引。
2. 当前文档必须写适用版本与最后更新时间；过期内容移到 historical 或删除重复。
3. 图片放 `docs/assets/`，命名 `功能-场景.png`；README/OPERATION 只引用当前截图。
4. 数学公式标注实现位置 `文件:函数`，不写无法在代码中定位的抽象公式。
5. 每轮全量验证后更新 `PROGRESS.md` 与备份 `MANIFEST.sha256`。
6. 文档分层：项目入口（README/ARCHITECTURE/OPERATION/INSTALL）→ 开发规范（AGENT_GUIDE/CODE_GUIDE/MATH）→ 需求与计划（REQUIREMENTS/BACKLOG/PROGRESS）→ 研究记录（PERFORMANCE/UNIFIED/MATH_INTEGRATION_PLAN）→ 历史档（historical，标注状态）。研究记录不参与“当前实现口径”判断。
7. 已完成的一次性计划/报告在结论并入 PROGRESS 或需求台账后删除；同类文档优先合并，不并行保留多份。删除前在本索引登记日期与清单。
8. **单一事实来源（避免阅读/修改混乱）**：需求·决策·分期 = `REQUIREMENTS_AND_RULES.md`；进度与证据 = `PROGRESS.md`；主线待办 = `BACKLOG.md`；代码规范 = `CODE_STANDARDS.md`；开工路由 = `AGENT_GUIDE.md`；全量导航 = 本文件。同一事实只在一处维护，其余**链接引用、不复制**；改其一须同步引用它的状态（尤其 REQUIREMENTS ↔ PROGRESS / BACKLOG）。
