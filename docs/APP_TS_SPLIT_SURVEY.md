# app.ts 拆分测绘报告（S4，只读）

- 基线：`a053eda6cf48a4baacacaaca76fde72a57b42471`（G0）之后的 S4 测绘，当前 HEAD `eea4a05`（S3-4）。
- 文件：`NetlabHome/frontend/app.ts`，16,746 行，单个 IIFE（`(() => { 'use strict'; ... })()`，第 19 行起）。
- 统计：419 个顶层 `function`（另 3 个 `el` 重载声明），`state.*` 引用 **1317** 处，`state` 接口 **98** 个字段。
- 本阶段只读：未修改任何 `app.ts`/`app.js`，本报告是唯一交付物。

## 1. 共享可变状态清单

`State` 接口在 371-470 行；`const state: State` 在 664 行。按语义分组（字段名为接口原文）：

| 域 | 字段 | 风险 |
|---|---|---|
| 场景/选择 | `catalog, templates, mode, scene, sim, limits, selection, inspectorId, inspectorDirty, hover, hoverWaypoint, view, canvasSize, chartSize, pointer, drag, needsDraw, lastPaint, dirtyPositions, positionTimer, multi, clipboard, undoStack, redoStack, specKind, specRole, fnRole, wireTool` | 写点最多，`scene`（105 次引用）是最大共享核 |
| 实时/轮询 | `busy, liveBusy, stateBusy, cursor, frames, values, nodeValues, edgeValues, probeKeys, probeSignature, pollTimer, stateTimer, lastStateFetch, lastLiveError, precomputedRevision, precomputedSeconds, shuttingDown` | 定时器/请求竞态：`stateTimer`、`pollTimer`、`chartTimer` 由多个入口重置 |
| 图表/仪表 | `chart, instrument, replay, chartTimer, analysisLast, analysisSpectrum, analysisTF, tfCursor, tfDragging, phaseSize, phaseNode, phaseTrail, phaseIndex, phasePlaying, phaseLoop, phasePlayTimer, phaseTimer, acResult, acRevision, plotkitActive, plotkitMode` | `replay`（63）、`instrument`（47）、`frames`（46）跨图表/回放/仪表三块 |
| 外壳/UI | `ui, prefs, palette, settings, docs, docSlug, docGeo, plotkitGeo, vscodeGeo, plotkitDock, settingsGeo, moduleGeo, wbSignalGeo, wbSignalDock, moduleBlock, moduleDock, guideMode, guideShown, uiReady, floatZ, workspace, project, booted, degradedBanner, dismissedError, networks, currentNetwork, blocks, blocksLibrary, blocksStructural, ext` | `ui` 引用 110 次（DOM 引用表）、`project` 74、`mode` 75 |

引用热点（`state.*` 次数）：

- 字段：`ui` 110、`scene` 105、`mode` 75、`project` 74、`replay` 63、`view` 62、`selection` 54、`instrument` 47、`frames` 46、`sim` 45、`drag` 41、`multi` 36、`chart` 31、`prefs` 30、`catalog` 28。
- 函数：`bindStaticEvents` 54 次/462 行、`downloadText` 40/279、`setWorkspaceButtons` 36/117、`drawEdges` 33/197、`applySnapshot` 33/75、`readSimConfig` 30/295、`updateProjectPanel` 29/77、`renderScenePanel` 26/377、`renderEdgeInspector` 24/293。

共享状态结论：`state` 是单例总线，不能按“每模块一份 state”切；必须先切出纯选择器（`nodeById/edgeById/nodeByName/edgeByName/selectedNode/selectedEdge`，882-925 行）再切渲染/交互，否则任何模块拆分都会形成 `state ↔ render` 环。

## 2. DOM 入口清单

`ui` 对象（544-663 行）集中声明 DOM 引用；`$`/`$$` 定义在 481-482 行。

- `$('#id')` 形式：**234** 处，去重后 **182** 个 id。
- 直接 `document.getElementById`：7 处（`runWarnWin` 10187；`pkPrecomputeBar` 16152；`cacheWin` 16603；`cacheBody` 16642；`cacheMsg` 16683/16687/16693）。
- `document.querySelector/querySelectorAll`：10 处（`moduleWin .modwin-stage` 603、`[data-sub="plotkit"]` 10286/15275/16347、`.iro-popover` 13526、`#guide .guide-top` 15157、`#pkChannelList input...` 16028/16332/16335/16341）。

按前缀分组（182 个 id）：`other` 57、`anal/analysis` 22、`btn` 20、`plotkit/pk` 14、`seg` 13、`st` 11、`tab-` 11、`module` 10、`guide` 7、`inst` 7、`doc` 6、`settings/set` 4。

高频核心锚点：`graph`、`chart`、`phase`、`scope`、`lissajous`（画布五件套）；`stage`、`panel`、`main`（布局）；`tab-inspect/tab-spec/tab-ext/tab-blocks/tab-analysis/tab-chart/tab-inst`（面板）；`modal/modalCard/toasts/errorBanner`（反馈）；`plotkitFrame/plotkitInlineHost/plotkitWin`（PlotKit）。

## 3. 事件绑定清单

`addEventListener` 共 **230** 处，分布在 25+ 个函数。事件类型：`click` 92、`change` 54、`input` 20、`pointerdown` 11、`keydown` 8、`pointermove` 6、`pointerup` 5、`pointercancel` 5、`resize` 5、`dblclick` 4、`submit` 3，其余 `pointerleave/contextmenu/blur/wheel/netlab-desktop-ready/beforeunload/dragover/drop/mousemove/mousedown/mouseup/mouseleave/dragstart/focus` 各 1-2。

按宿主函数（前 22）：

| 函数 | 绑定数 | 行范围 |
|---|---:|---|
| `bindStaticEvents` | 39 | 14151-14612 |
| `renderScenePanel` | 15 | 7461-7837 |
| `initDocWin` | 14 | 16376-16425 |
| `initAppearanceControls` | 13 | 14850-15003 |
| `initFloatWindow` | 12 | 15667-15732 |
| `bindCanvas` | 9 | 3720 起 |
| `initGuide` | 9 | 15149-15193 |
| `initNetworkSidebar` | 8 | 10812-10941 |
| `previewElementAppearance` | 8 | 13564-13840 |
| `renderEdgeInspector` | 7 | 6130-6422 |
| `renderNodeInspector` | 6 | 5855-6045 |
| `createChartRenderer` | 6 | 12919-13298 |
| `initPlotkitDataBar` | 6 | 16326-16355 |

结论：`bindStaticEvents` 是“全局事件总线”（39 条），必须最后搬且只允许 shell 入口 import；各面板的 `init*` 事件应在各自模块内自注册，禁止继续堆进 `bindStaticEvents`。

## 4. `api()`/`jsonRequest()` 调用点清单

- `api(path, options)` 定义在 997 行；`jsonRequest` 定义在 1038 行；`plotkitFrameUrl` 1045 行。
- `api(` 调用 **36** 处；`jsonRequest(` 调用 **92** 处；`fetch(` 2 处（`api` 内部 1009 行；`/api/shutdown` 直连 10333 行）。
- 端点分组：`/api/nodes` 13、`/api/edges` 13、`/api/blocks` 12、`/api/scene` 10、`/api/network` 8、`/api/plotkit` 7、`/api/analysis` 7、`/api/settings` 5、`/api/networks` 5、`/api/positions` 4、`/api/extensions` 4、`/api/project` 4、`/api/plugins` 4、`/api/control` 3、`/api/config` 3、`/api/state` 3、`/api/profile` 3、`/api/ui` 3、`/api/cache` 3、`/api/help` 2，其余 12 个端点各 1。
- 认证：`DESKTOP_TOKEN` 953 行起；所有请求经 `api()` 自动加 `X-Netlab-Token`（1001 行），超时 15s，403 token 错误统一文案（1022-1024 行）。
- 结论：`api.ts` 可独立最早搬；`jsonRequest` 是 API 包装层，不应散落到业务模块。

## 5. 候选模块边界（建议 9 个域，S5 每轮一个域）

| 候选模块 | 行范围（约） | 行数 | 内容/职责 | 隐式依赖与环风险 |
|---|---:|---:|---|---|
| `app/state.ts` | 1-947 | 947 | 接口、常量、`$`/`$$`、`ui`、`state`、选择器 | 必须零业务依赖；选择器若引用渲染工具会成环 |
| `app/api.ts` | 948-1107 | 160 | `desktopBridge`、`api`、`jsonRequest`、toast/banner | 只依赖 `state.prefs`/`DESKTOP_TOKEN`；被所有面板依赖 |
| `app/core/sync.ts` | 1108-1372 | 265 | `applySnapshot`、`syncUI`、状态条/提示 | 写 `state.scene/sim/limits`；调 `render` 前必须经 `requestDraw` |
| `app/render/canvas.ts` | 1373-3715 | 2343 | 尺寸/视图变换、`drawGrid`/`drawEdges`/`drawNodes`/`drawCircuitGlyph` | 读 `state.scene/view`、选择器；被 interaction/sync 调用，反向调用会成环 |
| `app/interact/canvas.ts` | 3716-5066 | 1351 | 指针/滚轮/上下文菜单/连线/多选、弹层菜单 | 写 `state.selection/drag/pointer`；调 `requestDraw` 与 `scene commands` |
| `app/inspector.ts` | 5067-6909 | 1843 | 检查器表单、规格/公式、扩展面板 | 读 `state.catalog`、写 `inspector*`；调 `api` 与 `renderInspector` |
| `app/scene/commands.ts` + `panels/scene.ts` + `project/file.ts` | 6910-8684 | 1775 | 节点/边/场景变更、场景面板、模板、导入导出、.netlab | 写 `state.scene`、调 `api`；与 `sync/applySnapshot` 有双向数据流，需单向事件 |
| `app/charts/{live,instruments}.ts` | 8685-10009 | 1325 | 信号图/实时轮询、回放、示波器/李萨如/相位 | 读 `state.frames`；定时器写 `state.chartTimer/pollTimer`；与 `render` 共享画布上下文 |
| `app/panels/{modules,analysis,workbench}.ts` + `app/settings/*` | 10942-12676 + 14568-15148 | 2636 | 模块库、分析面板、工作台、外观/设置 | 大量 API 与 DOM；`init*` 事件自注册，禁止进 `bindStaticEvents` |
| `app/plotkit/*` | 12677-14567 + 15211-15311 + 16018-16425 | 2410 | PlotKit 内嵌渲染、子图、数据栏、窗口 | 依赖 `api`/`state.plotkit*`/`plotkitFrameUrl`；不得 import `render` 内部私有函数 |
| `app/shell/{menubar,network,workspace,control,boot}.ts` | 10010-10941 + 14143-14612 + 16501-16742 | 2742 | 菜单栏/网络栏/工作区/仿真控制/`bindStaticEvents`/`boot` | 最高扇出；只允许它依赖所有模块，任何模块不得反向 import shell |

实际 S5 按契约的 8-12 轮执行，可把上表 9 个域拆为：state/API（2 轮）、render（2 轮：画布渲染、图表/仪表）、interaction+overlays（1 轮）、inspector（1 轮）、scene+project（2 轮）、panels（2 轮）、plotkit（1 轮）、shell（1 轮）；每轮按 M 轮判据 + `AppContext` 显式传依赖。

## 6. 边界结论

1. 先做 `state.ts` 与 `api.ts`，它们是唯一无业务环的底座；`state.ts` 只暴露 `State`、`Ui`、`state`、`ui` 和纯选择器。
2. 所有模块禁止直接读 `document`（`ui` 对象之外）；新增 DOM 入口必须登记到 `ui`。
3. 所有重绘统一走 `requestDraw()`（3558 行），禁止模块自行调 `draw*`；这是防止 render/interaction 成环的硬约束。
4. `bindStaticEvents` 最后搬，只作为 `app/shell/boot.ts` 的入口，禁止被其他模块 import。
5. 安全网：`npm run test` 仅 5 条 `app.utils` 纯函数测试，对 `app.ts` 零覆盖；真正等价证据是 `npm run build` 后产物字节零差异 + `tsc --strict`（契约 S5 已写明）。

## 7. 机器可复核数据

- `state.*` = 1317；`addEventListener` = 230；`$('#...')` 唯一 id = 182；`api(` = 36；`jsonRequest(` = 92；顶层函数 = 419；总行数 = 16,746。
- 最大函数（行数）：`bindStaticEvents` 462、`createChartRenderer` 380、`renderScenePanel` 377、`readSimConfig` 295、`renderEdgeInspector` 293、`openWireDialog` 279、`downloadText` 279、`previewElementAppearance` 277。
