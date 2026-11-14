# Netlab 文档索引（DOCS INDEX）

> 最后核对：2026-11-14（全量文档基线同步 + 审计 A 阶段后复核 + D125 PlotKit 插件封装 + D129 测试配置 + D130 N-36 步骤事务 + D131 records 拆分 + D132 文档隐私清理 + D133 端到端控制实验 + D134 文档分层与会话日志 + D135 求解器影子门 + D136 影子门 CI 接入 + D137 插件路由拆分、D138 帮助检索路由拆分、D139 二维有限元路由拆分、D140 块库路由拆分、D141 分析路由拆分、D142 文档基线同步、D143 偏好/布局路由拆分、D144 BACKLOG 基线清理、D145 缓存/文档/加速路由拆分、D146 应用内扩展路由拆分、D147 仿真控制路由拆分、D148 工作区路由拆分、D149 多网络管理路由拆分、D150 PlotKit 接入/预计算路由拆分、D151 场景/模板路由拆分、D152 页面/UI/状态/诊断路由拆分、D153 工程文件路由拆分；本轮新增 VISION 草案、HASH_TABLE_OPTIMIZATION_RESEARCH、extensions/plugins/netlab.plotkit 官方插件、sessions 会话日志，更新 PROGRESS/DOCS_INDEX；阶段 4 P1-A 新增 9 份设计冻结草案 Proposed，见 §2.2）· 当前基线：静态 3.20.1 / 1052 passed / 1 skipped / 0 failed（core line 82.07%，见 `status.json`；本地非 CI；2026-11-14 历史 filter-repo 重写，重写前旧 SHA 失效；阶段 6 完成 / 阶段 7 P1-S1 进行中）/ R01–R43 / D1–D156；CI `CI_VERIFIED` @ `6f332a2`（3 workflow run + 5 check-run 全 `completed/success`，见 `PROJECT_STATUS.md §1` CI 证据行）；新增 **CODE_STANDARDS.md（代码规范，强制）**
> 目的：先在这里找文档，不要凭文件名猜新旧。**历史文档保留原文，但不得作为当前实现口径。**
> 文档精简（2026-11-13）：按用户隐私与保留策略，已移除 `docs/sessions/` 会话日志目录，以及早期审计/评审记录（STAGE4_INDEPENDENT_REVIEW、STAGE4_REMEDIATION_REPORT、specs/2026-11-09-n5-p3-audit、PERF_DICT_AND_CPP_AUDIT）；历史内容可从 Git 历史与 `PROGRESS.md` 追溯。

## 0. 文档分层（D-3 / N-30）

| 层 | 位置 | 面向 | 约定 |
| --- | --- | --- | --- |
| 用户文档 | `netlab/docs/user/`、根 `README.md`/`INSTALL.md`/`OPERATION.md` | 使用者 | 只讲怎么用，不讲内部实现 |
| 开发者文档 | `netlab/docs/*.md`、`adr/`、`specs/` | 贡献者 / agent | 架构、规范、决策、踩坑 |

隐私边界由 `netlab/tests/test_docs_privacy.py` 机检：本机路径、私有代理端口、记忆库路径零命中。

## 1. 建议阅读路线

| 你是 | 先读 | 再读 |
| --- | --- | --- |
| 第一次使用 | [README.md](../../README.md) | [OPERATION.md](../../OPERATION.md) |
| 想安装/离线部署 | [INSTALL.md](../../INSTALL.md) | [user/quickstart.md](user/quickstart.md) |
| 想理解整体架构 | [ARCHITECTURE.md](../../ARCHITECTURE.md) | [ARCHITECTURE.md](ARCHITECTURE.md)（详细版） |
| 想推进 V2 架构演进 | [CORE_ARCHITECTURE_V2.md](CORE_ARCHITECTURE_V2.md)（需求/差距） | [CORE_ARCHITECTURE_V2_ROADMAP.md](CORE_ARCHITECTURE_V2_ROADMAP.md)（P1–P5 路线） |
| 想查数学公式 | [MATH.md](MATH.md)（总览） | [math/ARCHITECTURE_MATH.md](math/ARCHITECTURE_MATH.md) / [math/ELEMENT_MATH.md](math/ELEMENT_MATH.md) / [math/ANALYSIS_MATH.md](math/ANALYSIS_MATH.md) |
| 想写插件/扩展 | [EXTENSIBILITY_ARCHITECTURE.md](EXTENSIBILITY_ARCHITECTURE.md) | [PLUGIN_GUIDE.md](PLUGIN_GUIDE.md) + [CODE_STANDARDS.md](CODE_STANDARDS.md)（Python 规范） |
| 想改前端/UI | [UI_SPEC.md](UI_SPEC.md) | [APPEARANCE_ENGINE_DESIGN.md](APPEARANCE_ENGINE_DESIGN.md)（外观引擎/令牌/色板/§12 实施进度，改色改 UI 必读）+ [CODE_STANDARDS.md](CODE_STANDARDS.md)（TS/JS 规范）+ [FRAMEWORK_CHEATSHEET.md](FRAMEWORK_CHEATSHEET.md) |
| 想知道项目做到哪 | [MILESTONES.md](MILESTONES.md)（精简里程碑） | [PROGRESS.md](PROGRESS.md)（逐轮会话日志） + [BACKLOG.md](BACKLOG.md) |
| 想查需求/决策 | [REQUIREMENTS_AND_RULES.md](REQUIREMENTS_AND_RULES.md) | [adr/0002-plugin-extension-architecture.md](adr/0002-plugin-extension-architecture.md) |
| 想改代码（贡献者 / agent） | **[CODE_STANDARDS.md](CODE_STANDARDS.md)** | [AGENT_GUIDE.md](AGENT_GUIDE.md) + [APPEARANCE_ENGINE_DESIGN.md](APPEARANCE_ENGINE_DESIGN.md)（改外观/画布色时） |

## 2. 当前有效文档（active）

### 2.1 项目入口

| 文档 | 用途 | 状态 |
| --- | --- | --- |
| [README.md](../../README.md) | 定位、主要能力、快速开始、演示、文档导航 | 当前 |
| [VISION.md](VISION.md) | 产品愿景草案：为谁、替代什么/不做什么、三条可证伪成功判据（B-1，待产品确认） | 草案 |
| [ARCHITECTURE.md](../../ARCHITECTURE.md) | 面向贡献者的短架构：分层、数据流、扩展点 | 当前 |
| [OPERATION.md](../../OPERATION.md) | 界面操作、工作流、演示图、快捷键 | 当前 |
| [INSTALL.md](../../INSTALL.md) | 安装、离线部署、局域网、故障排查 | 当前 |

### 2.2 架构与开发

| 文档 | 用途 | 状态 |
| --- | --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 详细架构与运作原理（含 R31/R39/R40） | 当前 |
| [CORE_ARCHITECTURE_V2.md](CORE_ARCHITECTURE_V2.md) | V2 平台架构需求、目标能力与当前实现差距（规划口径，不是现状） | 规划 |
| [CORE_ARCHITECTURE_V2_ROADMAP.md](CORE_ARCHITECTURE_V2_ROADMAP.md) | V2 执行路线：P1 审计→P2 Core Model/Typed Port→P3 Equation/Compiler→P4 Runtime/Plugin→P5 Validation/机械/多物理场 | 规划 |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | 当前状态唯一事实源：HEAD/分支/同步状态、当前阶段、已完成/进行中阶段、下一项授权、最近 CI 证据、文档冲突 | 当前（2026-11-11 建立） |
| [NETLAB_REVIEW_AUDIT_2026-11-12.md](NETLAB_REVIEW_AUDIT_2026-11-12.md) | 2026-11-12 本轮复审 A–J 审计报告：P0/P1/P2 问题、插件 Engine 复现、P1-R1/R2 审计、补丁计划与 Open Decisions | 当前 |
| [adr/README.md](adr/README.md) | ADR 索引：ADR-001..007 与历史 ADR 0001–0003 的编号/状态说明 | 当前 |
| [CODE_GUIDE.md](CODE_GUIDE.md) | 目录地图、模块职责、关键符号、调用链 | 当前 |
| [MATH.md](MATH.md) | 数学入口与全局地图；专题见 [math/ARCHITECTURE_MATH.md](math/ARCHITECTURE_MATH.md)、[math/ELEMENT_MATH.md](math/ELEMENT_MATH.md)、[math/ANALYSIS_MATH.md](math/ANALYSIS_MATH.md) | 当前 |
| [FRAMEWORK_CHEATSHEET.md](FRAMEWORK_CHEATSHEET.md) | 机制速查、常见坑、token 节约 | 当前 |
| [MODULES_HOWTO.md](MODULES_HOWTO.md) | 模块化/封装/内部结构操作 | 当前 |
| [SCHEMATIC_DRAWING_SPEC.md](SCHEMATIC_DRAWING_SPEC.md) | 电路图绘制规范 | 当前 |
| [PERFORMANCE_AND_CONCURRENCY.md](PERFORMANCE_AND_CONCURRENCY.md) | 并发/性能评估研究：多线程·多进程·异步·数据压缩编解码·计算优化（评估记录，非实现口径） | 当前（研究） |
| [HASH_TABLE_OPTIMIZATION_RESEARCH.md](HASH_TABLE_OPTIMIZATION_RESEARCH.md) | 哈希表/嵌套数据结构优化研究：论文综述、数学分析、双层数据架构与 P0–P3 改造路线（研究记录，非实现口径） | 研究（2026-11-08） |
| [MATH_INTEGRATION_PLAN.md](MATH_INTEGRATION_PLAN.md) | R43 数学成果接入计划：P1 稀疏排序 / P3 AC 扫频 Woodbury / P5 遥测误差预算，影子验证 M0–M1d | 当前 |
| [UNIFIED_SIM_MATH_SPEC.md](UNIFIED_SIM_MATH_SPEC.md) | 统一仿真数学规范（§0–§17 完整；§0–§16 于 2026-11-06 从会话日志恢复） | 研究（完整） |
| [WORKTREE_RULES.md](WORKTREE_RULES.md) | 多工作树/多会话规范 | 当前 |
| [VSCODE_INTEGRATION.md](VSCODE_INTEGRATION.md) | VS Code 内嵌集成 | 当前 |
| [CORE_MODEL_V2.md](CORE_MODEL_V2.md) | P1-A 核心模型 V2：13 类对象、四类关系图、三型边、Desc/Runtime 分层、渐进迁移 | 规划（阶段 4 设计冻结草案，Proposed） |
| [TYPED_PORT_SYSTEM.md](TYPED_PORT_SYSTEM.md) | Typed Port：PortType/UnitRegistry、连接语义、4 类物理量、五问 | 规划（Proposed） |
| [ENGINE_SPI_V2.md](ENGINE_SPI_V2.md) | Engine SPI V2：EngineSpec 能力声明、生命周期、Plugin 边界、五问 | 规划（Proposed） |
| [ARCHITECTURE_BOUNDARIES.md](ARCHITECTURE_BOUNDARIES.md) | 六层边界与依赖方向、编译缓存键组成、ADR 与授权 | 规划（Proposed） |
| [CORE_OBJECT_RELATIONSHIP.md](CORE_OBJECT_RELATIONSHIP.md) | 对象关系图与所有权、Desc/Runtime 五问 | 规划（Proposed） |
| [ENGINE_LIFECYCLE.md](ENGINE_LIFECYCLE.md) | create→validate→compile→run→snapshot→restore→destroy、快照契约与回滚 | 规划（Proposed） |
| [CORE_INTERFACE_CONTRACTS.md](CORE_INTERFACE_CONTRACTS.md) | Python Protocol/ABC 精确签名、参数/返回/异常总表 | 规划（Proposed） |
| [MIGRATION_AND_COMPATIBILITY.md](MIGRATION_AND_COMPATIBILITY.md) | 旧记录/工程 v6·v7 字段映射、兼容窗口、风险 R1–R6、回滚 | 规划（Proposed） |
| [MINIMAL_DATA_MODEL_EXAMPLE.md](MINIMAL_DATA_MODEL_EXAMPLE.md) | 最小领域示例：RC 3 节点+2 边、机械 2 节点+1 边；JSON/内存对象/编译产物/运行结果 | 规划（Proposed） |\
| [V2_IMPLEMENTATION_GAP_ANALYSIS.md](V2_IMPLEMENTATION_GAP_ANALYSIS.md) | 阶段 4 整改：P1-03–P1-13/P2-02 差距与迁移方案 | 规划（Proposed） |
| [P1_R1_STAMP_CONVERGENCE.md](P1_R1_STAMP_CONVERGENCE.md) | 阶段 5 P1-R1 元件 Stamp 单一化收敛方案（Proposed） | 阶段 5 |
| [P1-R2_CONVERGENCE_PLAN.md](P1-R2_CONVERGENCE_PLAN.md) | 阶段 6 P1-R2 收敛方案（准入闸门 + 统一提案 + 风险/验证，只读设计） | 阶段 6 |
| [P0-2_PORT_SCHEMA_DECISION.md](P0-2_PORT_SCHEMA_DECISION.md) | P0-2 决策：PortDesc 内嵌（方案 A）依赖审计、差距与最小迁移提案 | 阶段 6 |
| [P0-2_PORT_SCHEMA_UNIFICATION_DESIGN.md](P0-2_PORT_SCHEMA_UNIFICATION_DESIGN.md) | P0-2 Port Schema 统一设计（V1 PortDef/V2 PortDesc/PortType 字段映射、迁移、插件兼容；只读设计） | 阶段 6 |
| [CORE_CODE_REMEDIATION_DESIGN.md](CORE_CODE_REMEDIATION_DESIGN.md) | 核心代码 8 项问题整改设计（file:line 依据/根因/失败测试/回归/风险；只读设计未实施） | 阶段 6 |
| [NETLAB_CURRENT_STATE_AUDIT_2026-11-13.md](NETLAB_CURRENT_STATE_AUDIT_2026-11-13.md) | 当前状态复核与第一批整改报告（8 字段基线 + A/B/C/D 结论 + 修复状态分类） | 阶段 6 |
| [GITHUB_CONTRIBUTION_PRIVACY_SECURITY_POLICY.md](GITHUB_CONTRIBUTION_PRIVACY_SECURITY_POLICY.md) | GitHub 贡献规范与隐私安全门禁（v1.0）：Agent 权限隔离、禁止上传数据分类、暂存区扫描、Commit/Push/PR 规范、.gitignore/Hook/Secret Scanner 门禁；**所有 GitHub 提交必须遵循** | 当前（2026-11-13） |

### 2.3 扩展体系

| 文档 | 用途 | 状态 |
| --- | --- | --- |
| [EXTENSIBILITY_ARCHITECTURE.md](EXTENSIBILITY_ARCHITECTURE.md) | `netlab.plugin_api.v1`、manifest、EngineProtocol、工程 v6、UI profile | 当前（首版实现完成） |
| [PLUGIN_GUIDE.md](PLUGIN_GUIDE.md) | 插件包目录、manifest 与 `PluginContext` 快速示例 | 当前 |
| `extensions/plugins/netlab.plotkit/` | 官方 PlotKit 插件声明（PanelSpec + `/plotkit/` iframe，D125） | 当前 |
| [EXTENDING.md](EXTENDING.md) | 快速扩展指南；顶部链接插件包规范 | 当前（legacy 段落保留） |
| [adr/0002-plugin-extension-architecture.md](adr/0002-plugin-extension-architecture.md) | 24 条扩展架构决策 | 当前 |
| [adr/0003-appearance-engine.md](adr/0003-appearance-engine.md) | 外观引擎 ADR：令牌单一来源（D75）+ LIGHT/DARK 双色板 + 画布令牌化 + 外观面板决策 | 当前 |
| [GLOSSARY.md](GLOSSARY.md) | 全项目术语表 | 当前 |

### 2.4 UI / 用户文档

| 文档 | 用途 | 状态 |
| --- | --- | --- |
| [UI_SPEC.md](UI_SPEC.md) | 界面规范、设计令牌、视图设计器（简单画布为设计目标，见 §20 实现现状） | 当前 |
| [APPEARANCE_ENGINE_DESIGN.md](APPEARANCE_ENGINE_DESIGN.md) | 全局外观引擎设计（令牌单一来源/双色板/画布令牌化/外观面板分期），§12 为 P-A1–P-A4 实施进度与已知限制；改色/改 UI 必读 | 当前（P-A 已实施，P-B 待办） |
| [user/quickstart.md](user/quickstart.md) | 5 分钟上手 | 当前 |
| [user/interface.md](user/interface.md) | 界面区域说明 | 当前 |
| [user/shortcuts.md](user/shortcuts.md) | 快捷键 | 当前 |
| [user/faq.md](user/faq.md) | 常见问题 | 当前 |
| [user/glossary.md](user/glossary.md) | 用户术语 | 当前 |

### 2.5 需求、进度与经验

| 文档 | 用途 | 状态 |
| --- | --- | --- |
| [REQUIREMENTS_AND_RULES.md](REQUIREMENTS_AND_RULES.md) | R01–R43 需求、D1–D156 决策、分期、不做清单 | 当前 |
| [MILESTONES.md](MILESTONES.md) | 精简里程碑（可对外复述的阶段结果与复现命令） | 当前 |
| [PROGRESS.md](PROGRESS.md) | 执行证据与验收记录（含 §7.70–§7.121；逐轮执行日志） | 当前 |
| [BACKLOG.md](BACKLOG.md) | 当前主线、剩余项、待拍板决定 | 当前 |
| [LESSONS.md](LESSONS.md) | 踩坑与经验（按 §7.x 记录） | 当前 |
| [AGENT_GUIDE.md](AGENT_GUIDE.md) | Agent 开工三问、文档路由、闸门 | 当前 |
| [CODE_STANDARDS.md](CODE_STANDARDS.md) | **代码规范（强制）**：TS/JS + Python + 测试 + 提交 + 文档规范；改代码前必读 | 当前 |

### 2.6 主日志（PROGRESS）

| 文档 | 用途 | 状态 |
| --- | --- | --- |
| [PROGRESS.md](PROGRESS.md) | 逐轮执行证据的主日志（§7.x） | 当前 |

### 2.7 功能规格（spec，按日期归档）

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
| [2026-11-03-plotkit-desktop-token.md](specs/2026-11-03-plotkit-desktop-token.md) | PlotKit 桌面 token 误报 | 已实现，历史证据 |
| [2026-11-03-plotkit-precision.md](specs/2026-11-03-plotkit-precision.md) | PlotKit 精度 | 已实现，历史证据 |

## 3. 历史/参考文档（historical）

这些文档保留当时的决策与技术评估，**不再作为当前行为依据**；引用时请标注“历史”。

> 2026-11-06 文档整理：已删除 7 个已完成/过期文档（`DOCUMENTATION_PLAN.md`、`IMPLEMENTATION_PLAN.md`、`QT_NATIVE_SPEC.md`、`NGSPICE_SOLVER_COMPARISON.md`、`SOLVER_OPTIMIZATION_PLAN.md`、`SOLVER_OPTIMIZATION_REPORT.md`、`TS_P17_MODULE_DESIGN.md`）；原文见 git 历史。`docs/specs/*` 作为已实现功能的验收证据保留。
> 2026-11-14 文档整理：按规则 7 删除 2 份已完成的一次性只读报告 （`P1-R2_PARITY_MATRIX.md`、`P1-R2_BACKEND_CONSTRAINTS.md`）——15 场景实测矩阵与双后端约束结论已并入 `netlab/tests/test_p1r2_ac_parity.py` 与 `PROGRESS.md §7.169`，原文见 git 历史。保留 `P1-R2_CONVERGENCE_PLAN.md`（Step A/C 未实施）、`NETLAB_REVIEW_AUDIT_2026-11-12.md`（P1-4/5/6 补丁方案暂无第二处）、`NETLAB_CURRENT_STATE_AUDIT_2026-11-13.md`（含唯一授权原话），结论并入 `PROGRESS.md`/需求台账前不删。历史章节按当时文件名的引用属历史快照，不作全局改写。

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