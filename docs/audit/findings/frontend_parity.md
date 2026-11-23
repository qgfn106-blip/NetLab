# 前端与模块等价/结构检查工具审计（P0-02 / P1-01 / P1-02）

- 基线提交：`5c076ea`（NetLab 3.20.2 / Project Schema 8），工作树 `audit-20261124`（干净，`git rev-parse --short HEAD` = 5c076ea，`git status --porcelain` 空）。
- 审计对象：`frontend/app.ts`（7511 行）、`frontend/app/*.ts`（76 个文件）、`frontend/tools/verify_app_parity.js`、`frontend/tools/parity_uncovered.js`、`frontend/tools/parity_body_allowlist.json`、`frontend/tools/check_app_sections.mjs`、`frontend/package.json` scripts、`frontend/scripts/build.mjs`、`frontend/tsconfig.json`。
- 方法：只读静态审计。此 worktree 未安装 `node_modules`，`node tools/verify_app_parity.js` 直接以 `ERR_MODULE_NOT_FOUND: Cannot find package 'typescript'` 失败（主仓 `NetlabHome/netlab/frontend/node_modules` 亦无 typescript/esbuild），故 `verify:parity` / `check:sections` 未能实跑；所有结论以**源码原文行 + 可复现的静态扫描 / node 内置复现**为证据，不含“应该是/基本正常”类无证据措辞。
- 本文所有行号均为实测（`wc -l`）：`analysis_chart.ts`=878、`analysis_workbench.ts`=837、`analysis_workbench_canvas.ts`=823（与任务书标注的 910/849/823 略有出入，以实测为准）。

---

## 一、P0-02 — verify_app_parity.js 等价检查器

### 1.1 结论（确认缺陷，且当前 HEAD 自身即可触发 exit 1）

确认两项 P0 级缺陷：

1. **顶层声明索引是“按裸名 key 的单一全局 Map”，没有模块维度**，导致不同 TS 文件的同名顶层声明被误判为 DUPLICATE。当前 HEAD 至少存在 `bool`、`SelectField`、`selectField` 三组跨模块同名声明，必然被误报并 `process.exit(1)`。
2. **`normalize()` 用未锚定的 `//[^\n]*` 正则删行注释**，会把字符串 / 模板字符串 / 正则字面量内部的 `//` 也删掉，导致函数/变量体哈希“伪变更”。

附带发现（详见 1.5）：同模块重复声明反而漏检、类型/接口体不参与哈希、`enum` 不被索引、签入的 `.js` 只校验“存在+已入库”而不校验是否与当前 `.ts` 同步、全局真冲突无任何模型。

### 1.2 证据 A —— 跨模块同名被误判为 DUPLICATE

**前提：本项目是逐文件独立编译的 ESM。**
- `frontend/package.json:5` `"type": "module"`；`frontend/tsconfig.json` `"module": "ES2020"`。
- `frontend/scripts/build.mjs:30-40`：对 `app/*.ts` 每个文件分别调用 esbuild，`format: 'esm'`、`outdir: root`、`write:false` 后 `writeFileSync(out.path, out.text)`。→ 每个 `app/*.ts` 都是独立 ES 模块，**顶层声明是模块作用域，不同模块出现同名顶层声明在 ESM 下完全合法**。

**缺陷实现（全局裸名 Map）：**
- `frontend/tools/verify_app_parity.js:68-80`：
  ```
  68: const baseNames = new Map();
  ...
  75:   for (const item of names) {
  76:     if (!baseNames.has(item.name)) baseNames.set(item.name, []);
  77:     baseNames.get(item.name).push(rel);
  78:     if (item.hash) baseBodies.set(item.name, item.hash);
  79:   }
  ```
- `frontend/tools/verify_app_parity.js:82-100`：`currentNames` 同构，键同样是 `item.name`，值为出现该名的文件数组。
- `frontend/tools/verify_app_parity.js:102-105`：
  ```
  102: const missing = [...baseNames.keys()].filter((name) => !currentNames.has(name));
  103: const duplicates = [...currentNames.entries()]
  104:   .filter(([, files]) => new Set(files).size > 1)
  105:   .map(([name, files]) => `${name}: ${[...new Set(files)].join(', ')}`);
  ```
  → 只要某名字在 **≥2 个不同文件**出现，`new Set(files).size > 1` 即为真，`duplicates` 命中。
- `frontend/tools/verify_app_parity.js:134-143`：
  ```
  134: if (unexpectedMissing.length || duplicates.length || missingJs.length || untrackedJs.length || unexpectedBodies.length || !uncoveredDiff.ok) {
  ...
  136:   if (duplicates.length) console.error(`DUPLICATE declarations:\n${duplicates.join('\n')}`);
  ...
  142:   process.exit(1);
  143: }
  ```
- `frontend/tools/parity_body_allowlist.json` 只有 `allowed_bodies` / `removed_declarations` / `uncovered_files` 三类豁免，**没有“重复声明”豁免通道** → 误报无法通过 allowlist 消除。

**真实跨模块同名声明（静态全量扫描 + grep 原文）：**
| 名字 | 种类 | 文件:行（原文证据） |
|---|---|---|
| `bool` | function | `frontend/app/analysis_chart_appearance.ts:122` `function bool(value: unknown, fallback: boolean): boolean {` ；`frontend/app/grid_prefs.ts:20` `function bool(value: unknown, fallback: boolean): boolean {` |
| `SelectField` | interface | `frontend/app/analysis_workbench_chart_settings.ts:35` `interface SelectField {` ；`frontend/app/export_dialog.ts:31` `interface SelectField {` |
| `selectField` | function | `frontend/app/analysis_workbench_chart_settings.ts:40` 与 `frontend/app/export_dialog.ts:36`，两者签名为 `function selectField(label: string, values: Array<[string, string]>, current: string): SelectField {` |

`collect()`（见 1.5）会把 `FunctionDeclaration`、`InterfaceDeclaration` 都写入 `names`，所以上表三者都会进入 `currentNames`，各占 2 个文件 → 必然出现在 `duplicates` → 退出码 1。

**佐证（历史）：** `docs/README.md:121` 记录 `2026-11-21 | fix(ci): 消除 parity 重复声明并拆出菜单模块满足 S5 行数上限` —— 说明“parity 重复声明误报卡 CI”是该工具长期存在的痛点，仅临时改名为 `isRecordNode` 等消掉了个别碰撞，机制本身未修，`bool`/`SelectField`/`selectField` 仍留存。

### 1.3 证据 B —— normalize() 正则误伤字符串 / 模板

- `frontend/tools/verify_app_parity.js:16-18`：
  ```
  16: function normalize(text) {
  17:   return String(text || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  18: }
  ```
  第二个 `.replace(/\/\/[^\n]*/g, '')` **未锚定行首**，会匹配任意位置的 `//` 直到行尾，包括字符串、模板字符串、正则字面量内部。
- 用 node 内置复现（无第三方依赖）实际输出：
  ```
  IN : "const u = \"https://example.com/a\"; const n = 1;"
  OUT: "const u = \"https:"                       // 整段含 URL 被截断，连后面的 ; const n = 1 一起丢失
  IN : "const t = `see http://x/y`;"
  OUT: "const t = `see http:"                       // 模板字符串被截断
  IN : "const a = 1; // trailing note\nconst b = 2;"
  OUT: "const a = 1; const b = 2;"                 // 整行注释场景正确
  IN : "const re = /ab\/\/cd/;"
  OUT: "const re = /ab"                            // 正则字面量被截断
  ```
  → 任何体（变量初始化 / 函数体 / 类体）里出现含 `//` 的字符串（URL、`http://localhost`、Windows 风格路径、`file://`、正则）都会被误删，`normalize()` 结果与基线不同 → 被 `changedBodies`（:123-125）判为“函数体变更”、或把未变判定成变。
- **对比**：同仓 `frontend/scripts/build.mjs:22-28` 的 `runtimeText()` 用的是 `replace(/^\s*\/\/[^\n]*$/gm,'')`（**换行锚定，整行注释**），不会伤及行内字符串；两者规范化策略不一致，进一步说明 verify 的写法是缺陷而非约定。

### 1.4 现有检查覆盖能力矩阵（file:line 证据）

| 能力 | 是否覆盖 | 证据 / 说明 |
|---|---|---|
| 声明丢失（整体消失） | 部分 | `verify_app_parity.js:102` 按裸名比对 base/current；若该名在**任意其它模块**仍存在则判不出丢失（跨模块同名互相遮蔽） |
| 函数/类体变更 | 部分 | `collect` 在 :37-38 对 function/class 存 `hash=normalize(body)`；但受 1.3 正则误伤 + 跨模块同名 `baseBodies/currentBodies` 按裸名覆盖（:78,98）影响 |
| 重复声明 | 语义相反 | 跨模块同名误报（1.2），同模块重复反而漏检（`new Set(files).size` 同文件只算 1，见 :104） |
| 产物存在（每个 runtime 模块有 .js） | 是 | :107-115 `missingJs`；type-only 模块 :112 跳过（实测 `git ls-files frontend/app | grep -c .js`=73，`.ts`=76，差 3 个 type-only，自洽） |
| 产物已入库（git tracked） | 是 | :116-120 `untrackedJs` 用 `git ls-files --error-unmatch` |
| 授权清单（body/删声明/uncovered） | 是 | :127-133 `allowed_bodies`/`removed_declarations`/`uncovered_files` |
| 运行时变化警告（uncovered 文件整体） | 是（仅 WARN） | :149-152 `wholeFileHash` 不同则 `console.error WARN`，不阻断 |
| type-only 模块识别 | 是 | `hasRuntime` :20-31；:92 `typeOnlyModules` |
| 大型单文件（exprRatio>0.5）识别 | 是 | :94 `uncovered` |
| 类型/接口体漂移 | **否** | `collect` :39-40 对 interface/typeAlias 一律 `hash: ''` → 类型字段增删/改查不出 |
| enum 声明 | **否** | `hasRuntime` :22 视 enum 为 runtime，但 `collect` :36-45 无 `isEnumDeclaration` 分支 → enum 名与体都不被索引 |
| default export / namespace / export assignment | **否** | `collect` 未处理 `ExportAssignment`、`ModuleDeclaration` |
| 产物与源码同步（.js 是否最新） | **否** | 只查 .js 存在 + 已入库（:108-121），不比对内容；提交陈旧的 .js 也能过 |
| 全局真冲突 | **否** | 无全局作用域模型；ESM 下不存在，脚本合并模式下才需要，但工具未区分 |

`collect()` 关键原文（`verify_app_parity.js:33-50`）：
```
37:     if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) {
38:       if (stmt.name?.text) out.push({ name: stmt.name.text, kind: ts.isFunctionDeclaration(stmt) ? 'function' : 'class', hash: normalize(stmt.body?.getText(sf)) });
39:     } else if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) {
40:       if (stmt.name?.text) out.push({ name: stmt.name.text, kind: 'type', hash: '' });
41:     } else if (ts.isVariableStatement(stmt)) {
42:       for (const decl of stmt.declarationList.declarations) {
43:         if (ts.isIdentifier(decl.name)) out.push({ name: decl.name.text, kind: 'variable', hash: normalize(decl.initializer?.getText(sf)) });
44:       }
45:     }
```

### 1.5 其他缺陷小结

1. **同模块重复漏检**：:104 `new Set(files).size > 1`，同一文件重复声明时 `files` 是 `[同一rel, 同一rel]`，Set 去重后 size=1 → 不报。真正“同模块重复声明”是语法错误，tsc 会报；但工具把它与跨模块同名混为一谈，恰好查反。
2. **类型体不参与哈希**（:40 `hash:''`）→ 接口字段删改在“等价检查”里不可见，是隐蔽的类型漂移缺口。
3. **enum 不索引**（无 `isEnumDeclaration` 分支）→ enum 删名/改名/删成员都不会进 `missing`。
4. **产物陈旧不校验**：只查存在 + 入库，不校验签入 `.js` 是否等于当前 `.ts` 的 esbuild 产物。
5. **`exprRatio > 0.5` 判“uncovered 大文件”**（:94）会把大量带顶层副作用语句的正常模块误列入 uncovered，仅 WARN 不阻断，意义有限。
6. **无模块维度**是根因：`baseBodies/currentBodies`（:78,98）也按裸名覆盖，跨模块同名函数体互相顶替，可能造成“体变更”假阴性或假阳性。

### 1.6 关联：check_app_sections.mjs（S5 行数门）

`frontend/package.json:16` `"check:sections": "node tools/check_app_sections.mjs"`。`frontend/tools/check_app_sections.mjs`：
```
10: const MAX_APP_LINES = 8000;
11: const MAX_STATEMENT_LINES = 800;
12: const MAX_MODULE_LINES = 800;
...
51: const tooBig = spans.filter((s) => s.size > MAX_STATEMENT_LINES);
52: const tooBigModules = modules.filter((m) => m.lines > MAX_MODULE_LINES);
53: const ok = totalLines <= MAX_APP_LINES && tooBig.length === 0 && tooBigModules.length === 0;
...
84: process.exit(ok ? 0 : 1);
```
- 实测各模块行数：`analysis_chart.ts`=878、`analysis_workbench.ts`=837、`analysis_workbench_canvas.ts`=823 —— **三者均 > MAX_MODULE_LINES(800)**，静态可判定 `tooBigModules` 非空 → S5 门 `exit 1`（这正与 P1-01 的拆分诉求一致，见第三节）。
- `app.ts`=7511 < 8000 满足总行数上限；但其内部 IIFE 展开后的单条语句跨度是否 >800（:51 `tooBig`）需 tsc 实跑才能确证，本 worktree 无依赖，未下结论。

> 备注：`check:sections` 与 `verify:parity` 均依赖 `typescript` 包，clean worktree 未安装依赖时二者都会因 `ERR_MODULE_NOT_FOUND` 失败；CI 需先 `npm ci`。

---

## 二、P0-02 改造设计 —— 基于 TypeScript AST 的模块级声明索引

### 2.1 数据结构

```
type Decl = { kind: 'function'|'class'|'enum'|'variable'|'interface'|'type'|'namespace'|'exportAssign';
              exported: boolean;          // 是否 export
              hash: string };             // 规范化后的“无注释”AST 文本哈希
type ModuleIndex = Map<string /*moduleRelPath*/, Map<string /*name*/, Decl>>;
```
- 索引键从“全局裸名”改为 **`(moduleRelPath, name)` 两级 Map**；ESM 作用域天然按文件隔离。
- `collectModule(fileName, text)`：遍历 `sf.statements`，覆盖 function/class/enum/interface/type/namespace/variable（含多 declarator）/export assignment；`exported` 由 `ts.getModifiers(stmt)` 是否含 `ExportKeyword`（或 `export {...}`/`export default`）判定。
- 断言类型：string/JSON 均可，关键是保留 `moduleRelPath`。

### 2.2 比较规则（替代现逻辑）

1. **同名 ESM 允许**：不做跨模块 names 聚合；跨模块同名不进 duplicates。
2. **同模块重复拒绝**：同一 `Map<module>` 内同名两次 → 报 DUPLICATE（同时 tsc 也会报，双保险）。
3. **全局真冲突拒绝**：仅当构建模式为“脚本合并 / IIFE 单全局”（如 `desktop-shim.ts` 的 iife，或未来 `outFile` 合并）时，构建一个 synthetic global namespace 再查重；ESM 模式跳过。
4. **迁移丢声明拒绝**：base 有 `(moduleA, foo)`、current 无 → 若全库其它模块也无 `foo` 则 MISSING；若 `foo` 出现在其它模块 → 报 MOVED（警告/需 allowlist），不静默通过。
5. **未授权函数体变更拒绝**：只比同 `(module,name)` 的 hash；变更不在 `allowed_bodies` → FAIL。
6. **授权清单更新通过**：把 `(module,name)` 加入 `allowed_bodies`（由“裸名”改为“模块+名”以避免跨模块串味）。
7. **字符串含双斜杠不误判**：hash 不用正则剥注释。
8. **缺 JS 产物拒绝**：runtime 模块无对应 `.js` 或未 git 跟踪 → FAIL（保留现逻辑，并可扩展“产物新鲜度”）。

### 2.3 normalize 的正确实现（去正则）

- **不要**对源码字符串做 `replace(/\/\/[^\n]*/g,'')`。
- 用 AST 打印器：`const printer = ts.createPrinter({ removeComments: true }); const clean = printer.printNode(ts.EmitHint.Unspecified, node, sf);` 再 `hash(clean)`。`printNode` 保留字符串/模板/正则字面量的真实内容，仅剔除注释 trivia。
- 或对 node 做 token 扫描：`ts.createScanner` + `scanner.scan()`，仅拼接 `token` 文本（跳过 `trivia`），对字符串 token 原样保留。
- 对 `variable` 用整个 `VariableStatement` 的打印文本哈希（覆盖所有 declarator），避免 `:43` 只取 initializer、漏 `const a=1,b=2` 的 b。

### 2.4 必须新增的 8 类测试案例

| # | 用例 | 构造 | 期望 |
|---|---|---|---|
| T1 | 同名 ESM 允许 | 两模块各有 `function bool`（如 bool/grid_prefs） | PASS（不报 DUPLICATE） |
| T2 | 同模块重复拒绝 | 同一文件两次 `function foo` | FAIL（DUPLICATE） |
| T3 | 全局真冲突拒绝 | 脚本合并模式下两文件同全局名 | FAIL（仅在 global 模式） |
| T4 | 迁移丢声明拒绝 | base 有 `foo@a.ts`，current 全库无 foo | FAIL（MISSING） |
| T5 | 未授权函数体变更拒绝 | 改 `run()` 体，不在 allowlist | FAIL |
| T6 | 授权清单更新通过 | `run` 加入 `allowed_bodies`（模块+名） | PASS |
| T7 | 字符串含双斜杠不误判 | `const u = "https://x/y";` 体未变 | PASS（不报 CHANGED） |
| T8 | 缺 JS 产物拒绝 | runtime 模块删 .js / 未 git add | FAIL（MISSING/UNTRACKED built JS） |

---

## 三、P1-01 — 三个超大分析模块的职责拆分（按依赖关系，非机械切半）

> 现状：三者均超 `check_app_sections.mjs:12` 的 `MAX_MODULE_LINES=800`（878/837/823），S5 门会判失败，拆分是其自身门禁的硬要求。以下按“数据模型 → 渲染 → 交互/编排”的依赖方向给出拆分，接口边界即模块导出面。

### 3.1 analysis_chart.ts（878 行，class AnalysisChart 84-874）

现状依赖：`import { loadPlot2D, Plot2DApi, PlotAxis, PlotRenderResult } from './analysis_chart_plot.js'`（:28）；`import { chartXAxisKey, chartXUnit, cursorAxisCompatible, isAnalysisEnvelope } from './analysis_chart_utils.js'`（:29,:35）。类内方法可按职责分为四簇（行号实测）：

- **数据模型/坐标推导**：`baseView(324)`、`axisMap(378)`、`panelCount(382)`、`panelFor(387)`、`overrides(463)`、`resolvedScale(488)`、`gridView(493)`，及顶层 `paddedRange(71)`、`logSafeRange(77)`、以及状态存取 `setEnvelope(161)/getEnvelope(174)/getViewState(194)/applyViewState(205)`。
- **渲染（依赖 Plot2D）**：`tokens(401)`、`scheduleRender(393)`、`render(425)`、`buildStore(472)`、`buildSpec(506)`。
- **交互（指针/滚轮/命中）**：`bindEvents(255)`、`onWheel(603)`、`onPointerDown(621)`、`onPointerMove(643)`、`onPointerUp(670)`、`hoverAt(693)`、`nearestCurve(745)` 及 readout/tooltip/overlay 绘制（759+）。
- **外观/工具条/生命周期**：`constructor(122)`、`getAppearance(178)/setAppearance(182)`、`setDetailHost(189)/refreshDetail(230)`、`setCursorFrequency(235)`、`resetView(242)`、`destroy(248)`、`renderToolbar(274)`、`createAnalysisChart(876)`。

**依赖方向**：`model → (utils/types)`；`render → model + analysis_chart_plot`；`interaction → render + model`（需坐标/轴）；`facade → 全部`。

**拆分方案（4 个文件）：**
1. `analysis_chart_model.ts`：纯函数模块，导出 `baseView/axisMap/panelCount/panelFor/overrides/resolvedScale/gridView/paddedRange/logSafeRange` + 视图状态纯变换。**零 DOM、零 Plot2D 依赖**，可单测。
2. `analysis_chart_render.ts`：`buildSpec/buildStore/tokens/render/scheduleRender`，内部封装 `loadPlot2D`；仅依赖 model + plot。
3. `analysis_chart_interaction.ts`：`bindEvents/onWheel/onPointer*/hoverAt/nearestCurve` 与 readout/tooltip/overlay；依赖 render（拿坐标）+ model（拿轴）。
4. `analysis_chart.ts`（facade）：保留 `class AnalysisChart` 生命周期/外观/工具条/详情宿主与 `createAnalysisChart`，组合委托上述三者；对外接口不变。
- 接口边界：model 导出纯数据类型与推导函数；render 暴露 `render(view)`/`buildSpec(...)`；interaction 通过回调订阅 render 的布局结果。

### 3.2 analysis_workbench.ts（837 行，class AnalysisWorkbench extends WorkbenchActions）

现状依赖（:9-34）：`analysis_chart.js`（isAnalysisEnvelope）、`analysis_workbench_results.js`（compareTableHtml/mergeCompareEnvelopes/metricsHtml/transferSummaryHtml）、`analysis_workbench_layout.js`（readWorkbenchUi/writeWorkbenchUi/WORKBENCH_SCHEMA）、`analysis_workbench_layout_tree.js`（emptyLayout/LayoutPreset）、`analysis_workbench_canvas.js`（AnalysisCanvasWorkspace）、`desktop.js`（toast）、`state.js`（state）、actions/loops 等。方法分四簇：

- **会话/状态编排**：`ensureSession(439)`、`syncCircuitFromState(470)`、`setCircuit(476)`、`snapshotCurrent(486)`、`portDefaults(512)`、`updateSelectedState(527)`、`selectState(550)`、`invalidateSession(564)`、`rangesPayload(577)`、`clearLocalResults(223)`、`restoreCanvasResults(230)`、`reloadSavedUi(148)`。
- **导航/面板 HTML 渲染**：`renderContext(241)`、`stateOptions(272)`、`renderNav(278)`、`kindSub(372)`、`sourceOptions(384)`、`outputOptions(394)`、`bindParamInputs(408)`、`activeState(432)`。
- **执行/对比编排**：`run(590)`、`runCompare(641)` 及 mergeEnvelopes/对比表/指标渲染（依赖 results + client）。
- **生命周期/挂载**：`constructor(57)`、`mount(72)`、`open(120)`、`spawnWorkspace(136)`、`setKind(169)`、`destroy(183)`、`renderAll(192)`、`onWorkspaceChange(210)`、`openAnalysis(361)`。

**依赖方向**：`session(依赖 net/api + state + layout) → nav(只读 session 结果生成 HTML) / run(依赖 session + client + results)`；`facade → 全部`。

**拆分方案（4 个文件）：**
1. `analysis_workbench_session.ts`：会话/circuit/state 读写与持久化编排（上述第一簇）。
2. `analysis_workbench_nav.ts`：纯 HTML/选项构建器（第二簇），输入 session 快照、输出字符串/节点，**不改状态**，可快照测试。
3. `analysis_workbench_run.ts`：run/runCompare/merge/指标与对比表（第三簇）。
4. `analysis_workbench.ts`（facade，保留 `extends WorkbenchActions`）：生命周期/挂载/委托，维持 WorkbenchActions 依赖的 protected 钩子（`currentKind/selectedCanvas/activeState/refreshNavigation/activeAnalysisKind/run` 等）。

### 3.3 analysis_workbench_canvas.ts（823 行，class AnalysisCanvasWorkspace）

现状已部分分离树模型（`analysis_workbench_layout_tree.ts` 372 行已存在并被 workbench.ts:12 import），但 canvas 内部仍混有树操作、渲染、拖拽交互、条目/图表生命周期与持久化。方法分四簇：

- **布局树模型（纯逻辑）**：`layoutTree` 存取、`setLayout/setPreset`、split/duplicate/move/close/reorder tabs、`applyDrop`，及顶层 `isLayoutNode/containsTabsNode/cloneNodeWithNewIds`（约 :30-90）。
- **渲染（DOM 模板）**：`render`、`renderTabbar`、`renderNode`。
- **拖拽/菜单交互**：`beginSplitDrag`、`bindDropTarget`、`clearDropIndicator`、`applyDrop`、`openTileMenu`、`openTabMenu`。
- **条目/图表生命周期与持久化**：`createEntry`、`addKind`、`setEnvelope`、`openChartSettings`、`persist`。

**依赖方向**：`layout_ops(纯树) → canvas_view(DOM) → canvas_interaction(拖拽/菜单) → canvas facade(条目/图表/持久化)`。

**拆分方案（3 个新增 + 复用一个已有）：**
1. 扩展 `analysis_workbench_layout_tree.ts`（已存在）：把 canvas 内所有**纯树变换**（clone/drop/reorder/move/close）迁入，彻底去 DOM。
2. `analysis_workbench_canvas_view.ts`：`render/renderTabbar/renderNode`。
3. `analysis_workbench_canvas_interaction.ts`：`beginSplitDrag/bindDropTarget/clearDropIndicator/applyDrop/openTileMenu/openTabMenu`。
4. `analysis_workbench_canvas.ts`（facade）：workspace 编排 + 条目/图表生命周期 + persist，调用上面三者。

**接口边界**：layout_tree 只导出纯函数与类型（输入树+操作，输出新树），可直接单测；view 接收树+选中信息返回 DOM；interaction 只发“意图事件”（split/drop/menu），由 facade 调用 layout_tree 落盘。

---

## 四、P1-02 — app.ts 结构性评估（业务/API/HTTP/状态）

### 4.1 业务是否过重（确认：是）

- `frontend/app.ts` = **7511 行**；其主体是一个 IIFE（`import` 之后 `(function(){ ... })()`），内部 **213 个 2 空格缩进的嵌套函数**（`^\s{2}(async )?function \w+` 计数），顶层只 import 57 处模块（dom/ui/state/net/canvas_*/chart_draw/...）。
- `app.ts` 内出现 **88 处 `/api/` 字面量**、**7 处 `await api(`**，即大量后端契约、请求体拼装、响应分支、UI 更新、渲染与状态变更**集中在这一个 IIFE**。业务编排与 UI 未真正分层，拆文件（app/*.ts）只是把“函数/渲染”外移，核心编排仍是单文件巨石。

### 4.2 UI 模块是否直接构造 API 数据（确认：是，存在泄漏）

- **12 个 `app/*.ts` 直接 `import ... from './net.js'`**：`analysis.ts, analysis_client.ts, appearance.ts, appearance_controls.ts, cache.ts, docs.ts, inspector.ts, plotkit_data.ts, plotkit_frame.ts, project.ts, spec_panel.ts, ui_helpers.ts`。
- **14 个文件直接调用 `api()/jsonRequest()`**：`analysis.ts, analysis_client.ts, appearance.ts, appearance_controls.ts, cache.ts, docs.ts, inspector.ts, net.ts, param_commit.ts, plotkit_data.ts, plotkit_frame.ts, project.ts, spec_panel.ts, ui_helpers.ts`。
- 其中 `appearance.ts / appearance_controls.ts / analysis.ts / plotkit_data.ts / plotkit_frame.ts` 属于视图/模型层，却在模块内**直接拼 endpoint 与请求体**（如 `jsonRequest('/api/...', 'POST', body)`），而非经统一 domain client → UI 与后端契约耦合，字段改名需跨多处改。

### 4.3 HTTP 是否多套重复实现（确认：至少两套 JSON HTTP 路径）

- **规范实现**：`frontend/app/net.ts` `export async function api(path, options)`（:34），内部 `fetch(path, config)`（:47）+ `AbortController` 超时（:36-37）+ `X-Netlab-Token` 头（:39）+ JSON 解析/错误规范化（:48-60）；`jsonRequest` 应为其包装。
- **重复实现（旁路）**：`frontend/app/analysis_client.ts:87-104` `workbenchExportRequest(body)` 自行构造 `headers`/`X-Netlab-Token`（:88-89）并**直接** `fetch('/api/analysis/workbench/export', {...})`（:90），重新实现响应错误处理（:95-104），绕过 `net.ts api()` → 同一后端 API 出现第二套 HTTP 实现，token/超时/错误格式易与主实现漂移。
- 另 `frontend/desktop-shim.ts:367` 的 `function api()` 是 pywebview 桥（非 HTTP），语义不同，属正常；但说明“api”命名在不同层复用，易混淆。

### 4.4 状态同步是否多来源（确认：是）

- **单一可变 `state` 单例**：`frontend/app/state.ts`，被 **37 个 `app/*.ts`** `import { state } from './state.js'`（ac_analysis、analysis、analysis_workbench、canvas_*、fields、inspector、plotkit_*、project、theme、windows 等），任意模块可直接改同一对象 → 谁写谁读无所有权约束。
- **localStorage 直写**：`appearance.ts, fields.ts, instruments.ts, param_fields.ts, plotkit_frame.ts, project.ts` 共 **6 个模块**直接 `localStorage.*`，另一路持久化源。
- **后端状态**：通过 `net.ts api()/jsonRequest` 打 `/api/state`、`/api/update` 等（app.ts 88 处 `/api/`），服务端 State 为第三源。
- **历史/撤销栈**：app.ts 内维护 undo/redo 快照栈（`pushUndoSnapshot/undoStack/redoStack` 命中），第四源。
- 结论：**后端 State + 全局 `state` 单例（37 写者）+ localStorage（6 模块）+ undo 栈 + DOM 派生 UI 状态** 并存，缺单一真相源与明确同步协议 → 易出现“改了 A 处、B 处不刷新”类不一致。

### 4.5 建议（供后续排期，不属本次只读修改）

1. 把 app.ts 的**业务编排**（节点/边/场景/仿真/分析/PlotKit 的流程）抽成领域服务模块，UI 只订阅 view-model；app.ts 退化为装配入口（目标 < 2000 行）。
2. **统一 HTTP** 到 `net.ts api()/jsonRequest`，`analysis_client.ts:90` 与任何直接 `fetch('/api/...')` 全部改走 `api()`；endpoint 常量集中，禁止 UI 模块内联拼 body。
3. **状态收敛**：明确 `state` 的写者（如 reducer/命令总线），localStorage 仅存 UI 偏好并命名空间化、与后端 State 显式同步；undo 栈与 `state` 走同一提交路径。
4. 配合 P1-01 拆分三巨头后，用 `check:sections`（800 行/文件）+ 新增的模块级 parity 索引（第二节）双重守护，避免再次长回巨石。

---

## 五、结论与优先级

| ID | 严重度 | 问题 | 关键文件:行 |
|---|---|---|---|
| P0-02a | P0 | 顶层声明按裸名进单一全局 Map，跨模块同名（bool/SelectField/selectField）误判 DUPLICATE → exit 1 | `tools/verify_app_parity.js:68-105,134-143` |
| P0-02b | P0 | `normalize()` 未锚定 `//[^\n]*` 正则误删字符串/模板/正则内 `//`，体哈希伪变更 | `tools/verify_app_parity.js:16-18`（对照正确写法 `scripts/build.mjs:22-28`） |
| P0-02c | P1 | 同模块重复漏检、类型体/枚举不索引、产物陈旧不校验、全局冲突无模型 | `tools/verify_app_parity.js:39-45,104,108-121` |
| P1-01 | P1 | 三分析模块 878/837/823 > 800，需按依赖拆分 | `app/analysis_chart.ts`、`app/analysis_workbench.ts`、`app/analysis_workbench_canvas.ts`；门禁 `tools/check_app_sections.mjs:12,52,84` |
| P1-02 | P1 | app.ts 业务过重（7511 行/213 嵌套函数/88 endpoint）；12 模块引 net、14 文件直调 api；analysis_client.ts:90 第二套 fetch；state 37 写者 + 6 localStorage 源 | `app.ts`、`app/analysis_client.ts:87-104`、`app/state.ts`、`app/net.ts:34-60` |

> 说明：`verify:parity`/`check:sections` 因 clean worktree 无 `node_modules` 未能实跑；上述 P0 结论由源码逻辑链 + 真实同名声明 + node 内置正则复现共同支撑，修复后应在 `npm ci` 环境跑通第二节 8 类测试回归。
