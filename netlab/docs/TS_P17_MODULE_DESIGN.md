# 二期 P17 详细设计与验收口径（前端 JS→TS 模块化）

> 关联：REQUIREMENTS_AND_RULES.md R41 / §5 P17；执行台账见 PROGRESS.md §7.76。
> 状态：设计中（开工前另立的口径文档；随实现推进更新为 implemented）。
> 本文件定义的决策 D112–D117 将在 P17 实施时并入 REQUIREMENTS 决策台账。

## 1. 目标与红线
- **目标**：把一期已类型化的产物（PlotKit 4 个静态文件 + netlab frontend 2 个文件）从「全局/IIFE + 经典 `<script>`」改为「原生 ES Modules + 按职责拆文件」，并为拆出的**纯函数**补单元测试；提升可维护性与可测性。
- **红线（不可破）**：离线可用；**零构建步骤**（源即产物，浏览器/Node 原生加载）；**不引入任何第三方运行时依赖**、**不引入打包器**（webpack/vite/rollup/esbuild 均不用）；`/api/` 契约与页面 DOM 行为不变；运行期仍不需要 Node。
- **允许**：devDependency（typescript、@types、测试工具全部 dev-only）；ESM 由浏览器原生 `<script type="module">` 加载。

## 2. 现状与约束（勘察结论）
- PlotKit：`src/plotkit/static/` 下 `render2d.ts` / `view3d.ts` / `app.ts` / `nsview.ts` 均编译为 `.js`；`index.html` 顺序 `<script>` 加载 view3d→render2d→app，`ns.html` 加载 nsview；各文件把 API 挂到 `window.Plot2D` / `window.PK3D` / `window.NS`。netlab 侧通过 `netlab/_vendor/plotkit` 的 `.js` 副本消费（`plotkit_vendor install`）。
- netlab：`frontend/app.ts`（15,066 行、单 IIFE、约 19 段、两大共享对象 `state`/`ui`、400+ 函数）+ `frontend/desktop-shim.ts`（IIFE，桌面桥）。`server.py` 的 `_resolve_frontend_dir()` 选择前端目录；`index.html` 用 `?v=UI_BUILD` 加载 `/static/app.js`；版本三处对齐（index.html `?v=` / app.js `UI_BUILD` / server.py `APP_BUILD`）。

## 3. 设计决策（D112–D117）
- **D112 加载方式**：改用原生 ESM。每页面一个入口，`index.html` 用 `<script type="module" src=".../index.js">`。保留 `window.Plot2D/PK3D/NS` 等全局挂载作为**兼容层**（供尚未模块化的外部消费者，如 iframe 注入、vendor 副本）。
- **D113 拆文件边界**：按「纯函数 / 渲染核心 / UI 胶水」三层拆分；纯函数单独成 `*.utils.ts`（无 DOM 依赖、可被 node 直接测）。清单见 §4。
- **D114 类型共享**：抽 `plotkit.types.ts` / `app.types.ts`（`export interface`/`type`，纯类型、编译期擦除），各模块 `import type`，避免重复定义与全局冲突。
- **D115 单元测试**：用 Node 内置 `node --test`（Node ≥22）+ 编译后的 ESM `.js`，测试文件 `*.test.mjs`，**零第三方**。只测纯函数（math/scale/ticks/format/hex/colorRamp/quantile 等）；涉及 DOM/WebGL 的渲染流程靠既有 parity 脚本 + GUI probe 回归，不做单测。
- **D116 兼容与回归**：模块化后必须过 ①`tsc` 0 ②现有 parity 脚本（render2d/view3d/app/nsview 等价）③`pytest` 全绿 ④`tools/gui_smoke.py` 与基线 drift=false ⑤PlotKit→vendor 重装后 netlab 侧冒烟一致。
- **D117 灰度/回滚**：按 §5 小步推进，每步独立提交；任一步回归失败即回滚该步（`git revert`/`git reset` 回上一步），不连带后续。

## 4. 模块划分（落地文件清单）
### 4.1 PlotKit（`src/plotkit/static/`）
- 新增 `plotkit.types.ts`：抽公共类型（Spec/Layer/Series/Store/View/Tokens/RenderOptions/Vec3/Mat4/VolumeMeta/ParticleMeta 等），`export`。
- 新增 `plot2d.utils.ts`：`niceStep`/`ticksLinear`/`ticksLog`/`fmtNum`/`extent`/`padRange`/`union`/`quantile`/`hexAlpha`/`colorRamp`（来自 render2d，纯函数）。
- 新增 `plot3d.utils.ts`：`mat4Mul`/`perspective`/`lookAt`/`invert`/`sub`/`dot`/`cross`/`norm`/`applyMat4`/`niceTicks`/`clamp`/`fmtTick`（来自 view3d，纯函数）。
- 改造 `render2d.ts` 为模块：`import {...} from './plot2d.utils.js'`，`export` 出 `render`/`pick`/`PALETTE`，末尾 `window.Plot2D = ...` 兼容层。
- 同理模块化 `view3d.ts`/`nsview.ts`/`app.ts`；`app.ts` 按 UI 职责再拆（见 4.3）。
- `index.html`/`ns.html` 改为 `type="module"` 入口。
### 4.2 netlab（`frontend/`）
- 新增 `app.types.ts`：AppState/UiState/服务端响应类型。
- 新增 `api.ts`：`api<T>()` 与 `/api/` 契约封装（从 app.ts 抽）。
- 新增 `app.utils.ts`：`$`/`$$`/DOM/格式化等纯工具。
- `app.ts` 保留为入口，import 上述模块并 `import './features/*.js'`。
### 4.3 app.ts 拆分（按现有段）
- 以现有约 19 段为边界拆 `features/`：`devices.ts`（R20 器件节点）、`instruments.ts`（R23 仪器面板）、`dialogs.ts`（预计算/设置/文档中心/内部浮窗）、`plotkit-bridge.ts`（PlotKit 数据接入）、`circuit-analysis.ts`（R26 DC/AC）、`launch.ts`（启动引导/保持停止）、`cache.ts`（缓存体检 D88）等；`state`/`ui` 收拢到 `app.state.ts` 作为**单一来源**，各 feature `import`。
- 单段 >1500 行再二次拆分。

## 5. 分期与逐步验收（P17.1→P17.4）
- **P17.1 纯函数抽离 + 单测（PlotKit）**：新建 types/utils，改 render2d/view3d `import`；`node --test` 覆盖 utils（niceStep/ticks 边界、extent/padRange、union、quantile、hexAlpha、colorRamp 至少约 15 用例）。门禁：tsc 0、单测绿、parity 全等价、pytest 绿、GUI smoke 一致。
- **P17.2 PlotKit ESM 化**：4 文件转模块 + `index.html`/`ns.html` `type=module` + `window.*` 兼容层。门禁同上 + 页面加载验证（probe 页 + PlotKit iframe）。
- **P17.3 netlab 前端 ESM 化与拆分**：`api.ts`/`app.utils.ts`/`app.types.ts` + `features/*`；server 注入不变（仍 `/static/app.js`，但入口改 module）。门禁：tsc 0、`pytest` 589+ 全绿、GUI smoke 与基线一致、前端契约测试（`test_frontend_*.py`）全绿。
- **P17.4 收尾**：删死代码、更新 GLOSSARY/README 与模块图、全量回归；PROGRESS §7.76 台账 P17 标 ✅。

## 6. 每步通用门禁
1. `tsc -p ... --noEmit` 0 错、无 any/`@ts-*`（banned=0）。
2. `node --check` 每个产物。
3. PlotKit parity 脚本（4 文件）与 netlab Python 契约测试全绿。
4. `tools/gui_smoke.py` 对基线 drift=false（GUI 级）。
5. PlotKit→vendor 重装（`plotkit_vendor install --force`，只带 `.js`）后 netlab 冒烟一致。
6. 提交按每文件/每步、精确 pathspec；同步更新 PROGRESS 台账。

## 7. 风险与不做
- 风险：ESM 改变加载时序（原顺序 script 依赖 → 需显式 import 顺序）；`window.*` 兼容层遗漏导致 iframe/vendor 消费者取不到；app.ts 拆分易引入循环依赖（用 `app.state.ts` 单一来源 + 单向依赖规避）。
- 不做：不引入打包器/框架/CSS-in-JS；不改 `/api` 契约；不重写渲染算法（只搬移与加导出）；除重新生成 vendor 外不改运行期结构。

## 8. 验收总口径
「P17 完成」= P17.1–P17.4 全部通过 + `tsc` 0 + 单测绿 + parity/pytest/GUI smoke 全绿 + 文档台账更新 + 分支可合并。
