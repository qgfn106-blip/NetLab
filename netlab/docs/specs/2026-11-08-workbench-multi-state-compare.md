---
status: ready-for-agent
title: 工作台：多状态参数对比 + 可分离分析面板 + 内嵌绘图 + 压缩工程格式
date: 2026-11-08
area: netlab frontend / backend / project format
grill_decisions: Q1=A Q2=A Q3=A Q4=B Q5=A Q6=工作台/分析/状态 Q7=A Q8=A Q9=D Q10=A Q11=B Q12=A Q13=A Q14=A Q15=A
---

# 工作台：多状态参数对比 + 可分离分析面板 + 内嵌绘图 + 压缩工程格式

## Problem Statement

netlab 目前的分析能力是「单网络单结果」：每个 Network 只有一个 6000 帧 recorder，`precompute` 覆盖写同一份；分析信号选择 `#signalList` 固定钉在 `#tab-chart` 内；要对比不同参数下的结果只能手工改参数、重跑、再记下曲线，无法保存“多套参数状态”并直接切换/对比。绘图侧还分两套前端（netlab 自己的简易 canvas chart + PlotKit 的 iframe 独立外壳），跨 iframe 通信且重复。工程文件是单个 JSON，**预计算结果/分析选择都不落盘**，重开工程即丢、需重算。

用户要一个「工作台」：在`工作台 ▸ 状态`里用参数表格保存多套参数状态、每个状态可独立预计算（效果与正常预计算相同）、可在状态间快速切换；在`工作台 ▸ 分析`里把多状态结果做成多子图并排对比，并能把信号选择/分析面板分离成可拖拽浮窗（可停靠回）。同时把 PlotKit 改为内嵌绘图模块（去掉 iframe 独立外壳）、工程改造成可自带预计算快照的压缩格式。

## Solution

- 分析面板新增顶层组 **工作台**，下挂两个子页 **分析 / 状态**。
- **状态**页：参数表格（全量收集元件/连线/仿真参数，可检索过滤隐藏、行内编辑）+ 状态列表（新建/复制/重命名/删除、可设基准）+ 每状态独立预计算 + 状态切换（写回当前 Network 参数）+ 统一时长。
- **预计算结果**：每状态一份本地缓存快照（numpy `.npz`），绘图按需加载；删除状态级联删缓存；参数/revision 变化使快照失效重算。
- **分析**页：多子图并排对比（按状态分面、共享选中信号，参考 PlotKit 网格布局，可自由布局且对齐），信号选择/分析面板可作为应用内可拖拽浮窗（复用 floatwin）并停靠回。
- **绘图统一**：把 PlotKit 渲染内核作为 netlab 内嵌绘图模块（去 iframe 独立外壳），netlab 简易 chart 保留；建子图时可选绘制器（PlotKit 内核 / netlab 简易 chart）。
- **工程格式**：改为单一压缩工程包（`.nlab`），内含 `project.json` + `cache/*.npz`；存量 `.json` 工程安全迁移。

## User Stories

1. 作为用户，我希望在「工作台 ▸ 状态」看到当前网络所有可编辑参数的表格，这样能集中改参数。
2. 作为大网络用户，我希望参数表能按节点名/kind/参数名检索过滤、隐藏无关行，这样能迅速定位目标参数。
3. 作为用户，我希望一键「新建状态」自动快照当前参数，作为一套可复用参数预设。
4. 作为用户，我希望复制/重命名/删除状态，并指定一个「基准状态」。
5. 作为用户，希望切换状态即把该状态参数写回当前网络，快速得到另一套参数。
6. 作为用户，希望手动改动后显示「未保存到状态」，可更新到当前状态或另存为新状态。
7. 作为用户，希望每个状态能独立预计算，且效果与正常预计算一致。
8. 作为用户，希望多状态预计算结果能同时保留以便对比，而不必反复重跑。
9. 作为用户，希望删除状态时其预计算缓存一并删除，不残留垃圾。
10. 作为用户，希望每状态共用同一仿真设置与预计算时长，保证横向可比。
11. 作为用户，希望在「分析 ▸ 对比」用多子图并排查看多个状态（按状态分面、共享同一组信号）。
12. 作为用户，希望对比图可自由布局但保持对齐，并能选基准状态做高亮/差值参考。
13. 作为用户，希望把信号选择/分析面板拖成浮窗、放到别处看，还能一键停靠回原位。
14. 作为用户，希望绘图不再有 iframe 割裂感，多子图直接在本页面内渲染。
15. 作为用户，希望建子图时可选择用 PlotKit 内核或 netlab 简易 chart 绘制。
16. 作为用户，希望工程保存为一个压缩包，内含各状态与预计算快照，重开工程结果还在。
17. 作为用户，希望旧的 `.json` 工程被安全迁移成新格式，不丢失数据。
18. 作为维护者，希望状态/参数/快照的结构清晰、向后兼容、有校验与失效规则。
19. 作为维护者，希望绘图统一到一套内核，减少两套前端的重复与跨 iframe 通信。
20. 作为验收者，希望有回归测试证明“每状态预计算 = 正常预计算”（数值一致）与“工程往返不丢状态/快照”。

## Implementation Decisions

**已定决策（grill Q1–Q15）**
- Q1=A：状态绑定到**每个 Network**（切换网络即切换其状态列表）。
- Q2=A：参数表**全量自动收集**（`node.params`/`edge.params` 依 kind 规格 + `Simulation.config` + `scene.integration`），**支持检索过滤/隐藏/行内编辑**。
- Q3=A：状态定义（名称+参数快照）**存进工程文件**。
- Q4=B：对比为**多子图网格并排**（参考 PlotKit 多子图；可自由布局但保证对齐）。
- Q5=A：分析选择/面板分离为**应用内可拖拽浮窗**（复用 floatwin，可停靠回）。
- Q6=：父组名 **工作台**，子页 **分析 / 状态**。
- Q7=A：`状态`页=参数表+状态管理+预计算+切换；`分析`页=对比图+信号选择浮窗+常规分析。
- Q8=A：PlotKit **保留渲染内核、去掉 iframe 独立外壳**，作为 netlab 内嵌绘图模块；**netlab 简易 chart 保留**；建子图时**可选绘制器**。
- Q9=D：每状态**本地缓存快照文件**，绘图按需加载（`numpy .npz`，零新增依赖）。
- Q10=A：缓存放**工程同级隐藏缓存目录**（如 `<工程名>.cache/` 或 `.netlab/`），关闭工程/删除状态自动清理，参数/revision 变化快照失效。
- Q11=B：工程改为**单一压缩格式**，并**迁移现存 `.json` 工程**。
- Q12=A：切换状态=**写回当前 Network 参数**；手改标「未保存到状态」，可更新/另存。
- Q13=A：对比**按状态分面**：每子图一个状态、共享同一组选中信号。
- Q14=A：状态列表全套（新建/复制/重命名/删除/基准）；**删除状态级联删除其所有缓存**。
- Q15=A：各状态**统一仿真设置 + 统一预计算时长**（随快照存设置；时长状态页统一设）。

**技术方案（实现决定）**
- 状态数据结构：每 Network 增 `states: [{id,name,params,sim,base:bool,created}]`（`params` 含节点/连线参数映射 + sim 设置 + integration）；首个为默认；一个 `base` 状态。
- 预计算缓存：每状态一个 `.npz`（帧 t / 各 probe 值 / 元信息：state id、参数哈希、sim、revision、生成时间）；清单 `cache/manifest.json` 记录哈希与失效；参数或 revision 变化→重算。
- 工程包：`.nlab` = zip（stdlib `zipfile`：`project.json` + `cache/*.npz` + 可选 `assets/`）；内层 `project.json` 仍是现有结构 + 每 network 的 `states`；`PROJECT_VERSION` 升级；保存=打包原子写；打开=解包到临时/缓存目录再加载；保留一次性兼容读取旧 `.json`（迁移用途）。
- 迁移：脚本扫描现存工程→**整目录备份**→批量转 `.nlab`→断言新文件可加载且状态/网络数 >= 旧、checksum 正常→才删旧（沿用“先复制再删除、迁移后断言、重名保留两份”的教训）。
- PlotKit 内嵌：把 PlotKit 渲染 JS 作为 netlab 内嵌模块挂到容器（去独立页面/iframe）；提供统一 `renderer` 抽象（`plotkit` / `simple-chart`），子图创建时选。
- 浮窗：复用 `initFloatWindow/placeFloatWindow/raiseFloatWindow/toggleFloatMaximize`+`analWin` 范式；浮窗与主面板共享 `state.chart.selected`。
- 契约：前端 `/api/` 一律走 `api()` helper（禁裸 fetch，含新增 endpoint）；失败态/空态/未挂载三态区分。

## Testing Decisions

- **好测试**：测外部行为——预计算的数值结果、状态/快照的工程往返、对比图的数据正确性、迁移不丢数据；不断言内部实现/具体色值。
- **Seam 1（数值等价）**：对同一状态，`状态预计算` 与 `正常预计算` 产出的帧序列/probe 值逐点一致（golden 比对）。
- **Seam 2（工程往返）**：保存 `.nlab`→重新加载→每网络 `states` 数量/内容、缓存快照可复原；`project.json` 结构不变；checksum 正常。
- **Seam 3（迁移）**：对现存样本 `.json` 迁移前后网络数/状态数/节点边数一致、可加载；失败中止回滚。
- **Seam 4（对比渲染）**：按状态分面的子图数量与数据绑定正确（可用结构化快照/数据断言，非像素）。
- **Seam 5（浮窗/绘制器）**：浮窗停靠/还原、子图选 plotkit/simple 绘制器切换生效。
- **先例**：`tools/screenshots/dom_contrast_audit.mjs`（CDP 真实渲染审计）、`tools/verify_per_network_mode.py`、`test_precompute_exposes_sim_for_netlab_analysis`、`capture/probe`。
- **回归基线**：pytest 现基线 630 passed 1 skipped，实施不得回归；GUI `--probe` ok。

## Out of Scope

- 不改 PlotKit 的绘图算法/内核数学（只改“如何被 netlab 内嵌/调用”）。
- 不改 netlab 求解器/计算内核的数学；不改画布节点/连线的视觉配色体系。
- 状态间差异图（Δ）本期只留“基准状态”钩子，不做独立差值图（后续可加）。
- i18n、主题新增、逐令牌编辑器。
- 分析选择/回放帧以外的非状态持久化。

## 分阶段（建议，实现按此拆）

- **W1 状态与参数表**：工作台组 + 状态数据模型/工程结构 + 参数表格（全量/检索/隐藏/行内编辑）+ 状态 CRUD/基准/切换写回。
- **W2 预计算 + 对比**：每状态预计算到缓存 `.npz`（含进度条复用）+ 多子图对比（按状态分面）+ 可分离浮窗。
- **W3 绘图内嵌**：PlotKit 去 iframe 化作为内嵌模块 + `renderer` 抽象（plotkit/simple-chart）+ netlab 简易 chart 保留。
- **W4 工程压缩格式**：`.nlab` 打包/读取 + 存量 `.json` 安全迁移 + 版本升级。

## Further Notes

- 本 spec 由 /grill-me 依据 15 个已定决策综合而成；尚未改任何代码。
- 用户红线：以“能用/能看懂”为验收，对比图与浮窗需真实渲染验证。
- 迁移与格式变更是高风险点，必须备份 + 断言 + 可回滚。

## 附：W4 事实纠偏（2026-11-08 只读侦察，覆盖上文 W4 相关措辞）

- **后缀实为 `.netlab`，不是 `.nlab`**（`project.py:37 PROJECT_SUFFIX=".netlab"`）。全仓无任何压缩代码；当前 `.netlab` = 纯文本 JSON（`project_to_text = json.dumps(indent=2, ensure_ascii=False)`）。
- **磁盘上没有 `.json` 工程**：存量工程都是 `.netlab`（JSON 文本），如 `NetlabHome/MyProject/*.netlab`(7 个)、`examples/demo.netlab`、`%APPDATA%/Netlab(Desktop)/autosave.netlab`。前端 `importSceneFile` 才吃旧式 scene-json（进内存不落盘）。
- **W4 定案（据此覆盖上文）**：沿用 `.netlab` 后缀，内容改为**压缩容器**：加魔数头（如 `b"\x1fNLAB\x01"`）+ `zlib/gzip`，读时先探魔数→解压→`json.loads`；**文件首字节非魔数则按纯文本 JSON 解析（零成本兼容全部存量 .netlab，无需批量重写）**。checksum 仍算在解压后的 canonical body 上（与压缩无关）。
- 收口点：`project.py` 的 `project_to_text/atomic_write/load_project_raw`（+`PROJECT_VERSION` 升一级）；桥层 `desktop/webview_bridge.py`（save/open/autosave/_FILE_TYPES）统一“压缩写入、解压后把 JSON 文本交给前端”（前端零改）；**遗留死路径 `desktop/bridge.py`(Qt) 与 `app.py` 一并改或删除**；`server.py:652` catalog 的 suffix/format_version 同步。
- 迁移=“旧文件自动兼容读取 + 新保存即压缩”，可选做一次性批量重写（整目录时间戳备份→写 `.netlab.new`→断言可加载/网络·状态·节点边数不降/checksum 正常→再替换）。
- `MAX_PROJECT_BYTES=8MB` 作用于**未压缩 body**，压缩后仍按解压后大小校验。
