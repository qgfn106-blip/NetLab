# Netlab UI 规范（设计语言 · 接口 · 框架）

> 最后修改：2026-10-28 23:40
>
> 本文是 UI 的唯一实现口径，覆盖 R30 / P10 的 6 张票（UI-01…UI-06）。
> 需求口径仍以 [REQUIREMENTS_AND_RULES.md](REQUIREMENTS_AND_RULES.md) R14、R30、D60、D61 为准；
> 本文只描述「怎么做、在哪做、改哪里」。

## 1. 文件清单

| 文件 | 作用 | 规模 |
| --- | --- | --- |
| `frontend/index.html` | 唯一页面外壳：顶栏、菜单栏 + 信息条、网络栏、工具栏、画布、右栏、状态栏、设置窗、引导页、文档窗、qcard、toast、modal | 约 330 行 |
| `frontend/style.css` | 设计令牌 + 全部样式 + 主题/动效/性能档覆盖 + 新组件 | 约 1940 行 |
| `frontend/app.js` | 单 IIFE 前端应用；R30 新模块追加在文件末尾（`boot();` 之前） | 约 11200 行 |
| `netlab/docs/user/*.md` | 应用内文档中心的 5 篇用户向文档（离线、打包随源码） | 5 篇 |
| `netlab/server.py` | `GET /api/docs`、`GET /api/docs/{slug}` | — |
| `netlab/core/model/workspace.py` | 外观偏好设置键与校验 | — |

前端无构建步骤、无 npm 依赖、无框架；改完直接刷新即可（见 §17 版本与缓存）。

## 2. 设计语言

取自参考仓库 **RhineLabUI**（LBEILC/RhineLabUI）：**纸质档案 + 仪器刻度的科研终端**。

- 暖灰纸面 + 近黑墨字，1px 细线分隔，**0 圆角**；
- 大留白、极小字号眉标（8–10px、字距 +0.2em 左右）；
- 琥珀色 `#9b7247` 作强调，绿色 `#565c46` 作成功，暗红 `#8a4234` 作危险；
- 动效「静默微动」：只动 `transform`/`opacity`，进快出慢；
- 信息密度优先，不用彩色底块、不用渐变按钮、不用圆角卡片。

暗色不是简单反色：另给一套 7 组令牌（§3），靠 `html[data-theme="dark"]` 覆盖。

## 3. 设计令牌

写在 `style.css` 顶部 `:root`，运行时由 `applyAppearance()` 覆盖强调色与派生色。

### 3.1 颜色（浅色 / 深色）

| 令牌 | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--paper` | `#eae5e1` | `#11181b` | 页面底色 |
| `--paper-2` | `#edebe4` | `#202a2f` | 面板/卡片 |
| `--paper-3` | `#e2dccf` | `#1b2429` | hover/次级底 |
| `--ink` | `#080a08` | `#e0e3dc` | 主文字 |
| `--ink-2` | `#2b2a24` | `#c6cbc3` | 次级文字 |
| `--muted` | `#77756d` | `#a6b0b1` | 弱化文字 |
| `--dim` | `#9a9487` | `#7f8c8e` | 眉标/占位 |
| `--line` | `#d6d0c4` | `#536166` | 细线 |
| `--line-strong` | `#aaa59a` | `#6b7a7d` | 强分隔 |
| `--accent` | `#9b7247` | `#c5a16b` | 强调/选中/聚焦 |
| `--accent-2` | `#565c46` | `#9aa88c` | 次强调（矢量/成功） |
| `--accent-soft` | `#e4d5c1` | `#2e3b40` | 强调浅底 |
| `--green` | `#565c46` | `#9aa88c` | 成功 |
| `--amber` | `#a67d48` | `#c5a16b` | 警告 |
| `--red` | `#8a4234` | `#c08a7d` | 错误 |

另派生 `--ink-rgb/--paper-rgb/--paper-2-rgb/--accent-rgb/--accent-2-rgb/--green-rgb/--red-rgb` 供 rgba 使用。
`--radius: 0px` 是硬约定：新增组件不要写圆角。

### 3.2 字体与字号

```css
--sans: "MiSans", "Mi Sans", "PingFang SC", "Microsoft YaHei", system-ui;
--mono: "Cascadia Code", "JetBrains Mono", Consolas, "SFMono-Regular", monospace;
```

- 正文 11–12.5px / 行高 1.7–1.9；面板标题 12–13px；大标题 `clamp(26px, 3vw, 38px)`；
- 眉标 8–9px、`letter-spacing: .18em–.26em`、`text-transform: uppercase`；
- 数字/计时一律 `--mono`，避免跳动；
- 字重只用 400 / 600 / 650 / 750。

### 3.3 间距与尺寸

4 / 6 / 8 / 10 / 12 / 14 / 18 / 20 / 22 / 24 / 32（px）。常用控件高 30–42px；
顶栏 66px、菜单栏 34px、状态栏 32px；网络栏默认 172px、工具栏 78px、右栏 388px；
设置窗默认 `min(760px, 92vw) × min(640px, 80vh)`；文档窗默认 `min(920px, 88vw) × min(640px, 80vh)`。

### 3.4 动效令牌

```css
--ease-out: cubic-bezier(.22, 1, .36, 1);   /* 进场 */
--ease-in:  cubic-bezier(.4, 0, 1, 1);      /* 退场 */
--t-fast: 150ms; --t-base: 200ms; --t-slow: 300ms;
--motion: 1;                                 /* 由 data-motion 控制 */
```

`html[data-motion=off]` 把 `--motion` 置 0 并强制 `transition/animation-duration: 0s`；
`low/med/high` 通过系数缩放时长。`prefers-reduced-motion: reduce` 有同等兜底。
只允许对 `transform`/`opacity` 做过渡；不要对 `width/top/left/filter` 做长动画。

### 3.5 性能档

`html[data-perf=perf|balanced|quality]`：

- `perf`：关闭 `backdrop-filter`、大阴影、动画时长压到 0.01ms，画布像素比上限 1.5；
- `balanced`：保留位移动画，关闭大面积模糊；
- `quality`：全部保留，画布像素比上限 2.5。

## 4. 布局与栅格

```
body: grid-template-rows: 66px 34px minmax(0,1fr) 32px
      grid-template-columns: minmax(0,1fr)   ← 防止 9 项菜单/信息条撑破视口
main: grid-template-columns: var(--net-w,172px) 78px minmax(0,1fr) var(--panel-w,388px)
```

- `main.fem-mode`：末列 `var(--panel-w-fem,404px)`，隐藏工具栏（FEM 独立工作区）；
- 右栏宽度可拖拽：`#panelResize` 拖 `main` 的 `--panel-w`（FEM 模式写 `--panel-w-fem`），clamp 260–720，持久化到 `localStorage['netlab.panel.width']`（`initPanelChrome()` + `panelVar()`）；
- 断点 1440 / 1180 的第 4 列必须写成 `var(--panel-w, 360px)` / `var(--panel-w, 336px)`——写死数值会让拖拽在 ≤1440 屏上完全失效（3.14.1 修）；
- `main.net-hidden`：左栏收起；`main.panel-hidden`：右栏收起；
- 设置窗/文档窗是浮窗，浮在画布之上但不改变 `main` 的网格列宽（3.10.0 起取消 `body.settings-open` 让位）；
- 断点：1440 / 1180 / 920 / 960；≤960 收起信息条；≤760 引导页单列；
- 任何新外壳块都必须加 `min-width: 0`，否则 flex/grid 子项会按 min-content 撑破。

## 5. 外壳组件

### 5.1 顶栏 `#topbar`

品牌（`NETLAB 工作台` + 副标题）→ 工作区切换 `TOPOLOGY / FIELD · FEM` → 模式胶囊
（信号流/电路/矢量）→ 运行控制（运行/单步/重置）→ 读数（t / fps / step）→ 时间轴 →
会话时钟 → 帮助（`?`）→ 退出。顶栏**不放**面板开关，收放走侧栏挂耳（见 5.5）。

按钮类名：`.btn`、`.btn.primary`、`.btn.running`、`.btn.ghost`、`.btn.danger`；
运行中主按钮反色（墨底纸字）。图标按钮需 `aria-label` + `title`。

### 5.2 菜单栏与信息条 `#menubar`

菜单 9 组（D61 修订 D13）：**文件 / 编辑 / 视图 / 工程 · 网络 / 仿真 / 分析 / 工具 / 设置 / 帮助**。
菜单数据由 `menuDefinition()` 生成（`{label, items:[{label, hint, action, disabled}]}`），
新增动作只改这一个函数，不要在前端另起一套菜单 DOM。

信息条 9 段（`data-info`）：`project / network / mode / counts / dt / time / steps / alerts / run`。
`updateInfoBar()` 每帧后更新；dt 优先取 `sim.config.dt`，按 µs/ms/s 自动换单位；
运行状态用 `.run-state`，停止状态带红点。

### 5.3 状态栏 `#statusbar`

左：模式、求解引擎、提示、光标世界坐标；右：6 个开关
（网格 / 吸附 / 捕捉点 / 正交 / 节点样式 / 图纸）+ 限值。开关是 `button.status-toggle[aria-pressed]`，
与「视图」菜单、设置窗「工程/画布网格」三处同步（同一 `state.ui` 字段）。

### 5.4 右栏 `#panel`

4 个一级组（`.panel-tab[data-group]`）：

| group | 标题 | 内容 |
| --- | --- | --- |
| `inspect` | 检查器 | 选中对象参数表单；空态给「添加节点 / 适配视图」 |
| `fn` | 函数 | 子导航 `node-fn` / `edge-fn`，对应 `#tab-spec` |
| `modules` | 模块与扩展 | 子导航 `blocks` / `ext` |
| `analysis` | 分析 | 子导航 `chart` / `vector` / `analysis` / `inst`（信号 / 相图 / 旁路分析 / 仪器） |

`fem` 组（`#tab-fem`）只在场工作区出现，不属于网络右栏。检查器 `#tab-inspect` 内边距 16px 18px 22px，文字不贴边。

### 5.6 仪器面板 `#tab-inst`

右栏 分析 → 仪器（`data-sub="inst"`），一提票 R23 / D47 / P7-04。只读 `state.frames`，**不改电路状态、不触发求解**；没有任何场景数量之外的副作用。

| 区块 | 控件 | 行为 |
| --- | --- | --- |
| 时间窗 | `#instWindow`（数字，s） | 示波器只画 `最后时刻 − 时间窗` 之后的帧；状态行 `#instStatus` 报「N 帧 · 窗口 X s」 |
| 万用表 | `#instMeterKey` | 单路探针，给 5 个读数：实时 `#instValNow` / 平均 `#instValMean` / 有效值 `#instValRms` / 峰峰值 `#instValPP` / 最大最小 `#instValMinMax` |
| 示波器 | `#instCh1`–`#instCh4` | 4 通道时间波形，纵向按四路幅值统一缩放（`amp = max(abs(v)) × 1.1`）；每通道左侧色点 `.inst-ch .dot.on` 标记是否已接、下方图例给当前值 |
| 李萨如 | `#instLX` / `#instLY` / `#instTrail` | X-Y 双通道波形，`trail` 取最近 N 帧（20–4000，默认 600） |

三条约定：

- 下拉选项按探针键分类（节点电压 / 元件电流 / 元件压差 / 元件电压 / 元件功率），文案 `名称 · 字段`（如 `signal · 电压`）；图例同样用这套文案，不裸露 `n:signal:voltage` 键。
- 首次进入（四路全空且无可记忆选择）自动接「第一个电压 + 第一个电流」，避免空白页；用户的选择存 `localStorage`（`instrumentPrefsKey()`），刷新后恢复。
- 画布尺寸自适应：`ResizeObserver` 观察 `.scope-wrap`，按 `devicePixelRatio` 存 `state.instrument.scopeSize` / `lissSize`，跨主题重绘不拉伸。

### 5.5 侧栏收放挂耳 `.hanger`

两个按钮挂在各自侧栏的分界处，像「挂耳」凸出在画布一侧：

| 元素 | 位置 | 收起后 |
| --- | --- | --- |
| `#netHanger`（`.hanger-net`） | `left: calc(var(--net-edge, var(--net-w,172px)) - 12px)` | `main.net-hidden` → `left: 0`，字形 `‹`→`›` |
| `#panelHanger`（`.hanger-panel`） | `right: calc(var(--panel-edge, var(--panel-w,388px)) - 5px)`（约 5px 压在面板上、14px 凸到画布） | `main.panel-hidden` → `right: 6px`，字形 `›`→`‹` |

- 尺寸 19×78，底部 16%，`1px` 描边 + `--panel-bg` 底（与侧栏同材质），hover 反色；贴边一侧不出边框、外侧两角 7px 圆角，收起态恢复整框圆角与边框；`aria-expanded` 随状态更新。
- 定位用 `--net-edge` / `--panel-edge`（3.14.1 起）：由 `syncChromeEdges()`（`app.js`）按 `getBoundingClientRect().width` **实测**写回 `main`，收起/展开、初始化、window resize、拖拽 finish 各调一次；拖动过程中与 `--panel-w`/`--net-w` 同步写，所以挂耳不会滞后或悬空。
- **必须放在 `<main>` 内部**：它们用 `calc(var(--panel-*) …)` 定位，变量只写在 `main` 上，放外面会拿不到值而退化成默认 388（3.9.9 踩坑）。
- 收起后侧栏本身 `display:none`，挂耳仍留在栏位边缘，用它即可原地展开——不再需要顶栏按钮或设置窗。
`switchTab(name)` 是唯一入口：`scene` 已迁移到设置窗工程页，调用时打开设置窗并切到 `project`。
选中节点/连线时 `syncFnRoleToSelection()` 只切子导航角色；不强行把用户从检查器拽走。

## 5.7 电路模块与端口标记（R24 / D49–D51 / P7-06）

电路模式下两类"带引脚"的节点用同一套渲染：器件（`kind=device`）与模块实例（`kind=module`）。判据是 `isPinNode()`——`state.scene.mode === 'circuit' && (kind === 'device' || kind === 'module')`。

- **模块框**：矩形框（`drawGbDeviceNode`），框内显示块名（`params.block_name`），框下显示节点名；端口 = 块定义里的 `params.ports`，按 `devicePinLocal()` 排在左右两侧，右上为引脚圆点，`state.ui.showPins !== false` 且 `k > 0.55` 时显示端口名。
- **端口标记**：网络节点（`kind=node/ground`）的参数 `port_name` / `port_direction` / `port_note`。只填方向不填名字报错；方向 ∈ `in / out / inout`，缺省 `inout`；名字截断 32 字。**设置入口**（2026-10-30）：节点右键子菜单「设为模块端口 / 改端口方向」→ 输 入 / 输出 / 双向三项（`PORT_DIRECTION_CHOICES`，带一句说明），已标记的节点另有「取消模块端口」；节点属性面板同样三选一。电路场景默认「双向」（电气不分进出），方向只影响引脚画在左右哪侧与库卡片分组，不改变电气行为。
- **端口文案**：模块库卡片端口摘要由 `describeBlockPorts(spec)` 生成——电路模块按方向分组显示「输入 x  输出 y  双向 z」，信号块仍 `inputs → outputs`；`MODULE_DIR_LABEL` 为 输入/输出/双向。被标记的网络在封装时直接成为模块端口——**包括完全落在模块内部、没有任何跨边界导线的网络**（会额外生成父场景同名端口网络 + 一根到模块引脚的导线，用作探测/级联点）；跨边界网络则沿用原网络名。
- **封装入口**：多选节点后 `封装为模块`（`#btnEncapsulate`，Ctrl+单击多选），或右键网络列表项选「封装选中节点为模块…」，`POST /api/blocks/encapsulate` → 电路模式转 `encapsulate_circuit`：内部网络与器件搬进 `.block`，父场景原位置留一个模块节点 + 每个跨界网络的端口网络节点，外部导线改接到新网络；未标记的跨界网络用网络名当端口名。
- **实例化**：模块库面板拖到画布或 `blocks/instantiate`，生成模块节点 + 端口网络节点；端口没接线不报错，只在校验里给「端口未接线」warning。
- **连到模块**（2026-10-30 修）：导线必须带 `source_pin` / `target_pin`（端口名）。`createWireBetween()` 用 `isPinNode()` 判两侧（以前只判 `kind === 'device'`，把 `kind === 'module'` 漏了 → 请求不带引脚 → 后端报「起点是器件节点 '模块'，必须指定引脚」）；从端口小圆点拖线即带上该引脚，**单端口模块**允许省略并由前后端自动补（`scene.py` `_normalize_wire_pins` 的 `resolved` 回写），多端口模块必须在对话框里选引脚。
- **库卡片动作**（2026-10-30，D65）：除「实例化 / 打开内部」外新增「改名 / 删除」。「改名」先在前端对 `state.blocks` 查重名并立即 toast「模块名已存在」，再 `POST /api/blocks/{id}/rename`（文件名跟着改，id 与工程引用不变）；「删除」确认框写明「文件会删、画布实例会变缺失」，走 `POST /api/blocks/{id}/delete`（带 `version`）。两者被工程引用时服务端返回「仍被工程引用」，前端二次确认后带 `force:true` 重发。
- **库文件布局**（D65）：`library/blocks/<模块名>.block`——一个模块一个文件、文件名就是模块名，库里只保留最新版；面板底部提示同步为这句。
- **视觉约定**：模块框与器件框同色（选中 `#a8541f`、悬停 `#5f584e`、否则元件色）；程序生成的端口导线自带布局（中点 + rot 0/90），不要让它以「未布局」出现在校验里。

## 5.8 模块内部浮窗 `#moduleWin`（R24 / D50 / P7-07）

模块的「内部结构」不再只能靠打开临时网络来看，而是有自己的**只读预览浮窗**：

- **外壳**：`<div id="moduleWin" class="floatwin modwin" hidden>`，默认 `min(880px,92vw) × min(560px,78vh)`，z-index 133；
  复用 §6.1 浮窗基类（`initFloatWindow(ui.moduleWin,'moduleGeo',{minWidth:520,minHeight:340})`），标题栏可拖动、双击最大化。
- **布局**：`.modwin-body` 两列——左 `.modwin-side`（204px：`端口` 列表 `#modulePorts` 每行 `方向 + 端口名 + 电气徽标`、
  `节点/连线/端口/版本/模型` 统计、底部两个动作按钮），右 `.modwin-stage`（`<canvas id="moduleCanvas">`）。
- **标题栏**：`#moduleWinTitle` 显示块名，`#moduleWinHint` 显示 `MODULE · N 节点 · vX`；`−`/`□`/`✕` 与 **收成侧栏** 按钮（`#moduleDock`，`.floatwin-dock`，激活时 `.on`）。
  收成侧栏后 `.modwin.docked`：贴右缘、宽 300px、隐藏 canvas 与 hint、标题单行省略，只留端口与统计——用作"边看图边改电路"的检查器。
- **预览画布** `drawModulePreview()`：把 `block.nodes/edges` 的位置等比缩放居中；节点框四档配色——端口（暖橙边框，取 `params.net` 命中 `modulePortList()`）、
  接地（绿）、器件（蓝灰）、普通网络（白）；左上角标题条显示 `只读预览 · 块名 · N 节点 / M 连线`；无节点时显示 `.modwin-empty` 并隐藏 canvas。
- **入口**：
  1. 模块库卡片「打开内部」→ `openModuleInternal(blockId)`（不再直接开临时网络）；
  2. 网络列表项右键菜单（`.ctxmenu`）：「在模块内部浮窗中打开」（当前网络是模块内部临时网络时可用）、「关闭模块内部临时网络」、
     「封装选中节点为模块…」（无选中时禁用并提示「先在画布上 Ctrl+单击多选」）、「打开模块库」。
- **动作**：「在临时网络中编辑」（`#moduleEdit`）调用 P7-06 的 `openBlockInternal()`——**只有成功才收窗**，失败（例如内部缺接地）保留预览、错误走统一 toast；
  「实例化到画布」（`#moduleAddInstance`）复用模块库的实例化路径。

## 6. 设置窗（内部浮窗）

`#settingsWin`（`class="floatwin setwin"`）是**非模态内部浮窗**，默认居中、宽 `min(760px,92vw)` × 高 `min(640px,80vh)`，
z-index 132；**不挤占画布**（不再有 `body.settings-open` 让位规则，打开前后 `#panel`/`#stage` 尺寸不变）。
标题栏 `.floatwin-head` 可拖动、双击最大化，右上 `—`/`▢`/`✕` 分别最小化、最大化、关闭（`.floatwin-min`/`.floatwin-max`/`#setWinClose`），
右下 `.floatwin-resize` 拖拽缩放；几何存 `state.settingsGeo`（`{left,top,width,height}`），本次会话内有效。
左侧 `.setwin-nav`（196px）三项，每项两行（`<b>` 名称 + `<em>` 一句说明），active 时左沿 2px accent：

- `project`（工程页 `#settingsScene`）：工作模式、仿真节奏、求解器、网络统计、积分、模板、工程文件、画布网格、场景数据；
- `view`：主题 `#segTheme`（system/light/dark）、强调色 `#accentSwatches`、动效 `#segMotion`（off/low/med/high）、
  性能 `#segPerf`（perf/balanced/quality）、信息条 `#segInfoBar`（on/off）；
- `interact`：启动引导 `#segGuide`（always/never）、自动保存 `#segAutosave` + 间隔 `#selAutosaveInterval`、
  文档入口（`[data-doc]`）。

所有控件用声明式绑定：`data-seg="theme"` / `data-value`，由 `initAppearanceControls()`
统一监听并调用 `setPref()`（写缓存 + PATCH `/api/settings`）。新增偏好项三步：
`workspace.py` 加键与校验 → index.html 加控件 → `syncPrefControls()` / `initAppearanceControls()` 注册。

### 6.1 浮窗基类 `.floatwin`

设置窗与文档中心共用一套浮窗行为，样式在 `style.css`「内部浮窗基类」段，逻辑在 `app.js`：

| 函数 | 作用 |
| --- | --- |
| `placeFloatWindow(root, key)` | 把 `state[key]` 的 `{left,top,width,height}` 写回样式；无记录时清空内联样式回到 CSS 默认居中 |
| `raiseFloatWindow(root)` | 点击即抬层：z-index 从 131 起自增，越过 138 时整体回落到 132 |
| `toggleFloatMaximize(root, key)` | 切 `.maximized`（`inset: 12px/108px`），同时把当前几何写进 `state[key]` |
| `initFloatWindow(root, key, {minWidth,minHeight})` | 绑定拖动、双击最大化、`-min`/`-max` 按钮、右下 grip 缩放、root `pointerdown` 抬层 |

细节约定：

- `.floatwin` 居中用 `translate(-50%,-50%)`；一旦有记忆位置就加 `.moved`（`transform:none` + 只淡入），
  否则进场动画的 translate 会与内联 `left/top` 叠加造成跳位（3.10.0 踩坑）。
- 拖动时 `top` 夹在 `40 … innerHeight - 高度 - 8`，保证标题栏露头且右下缩放柄不会移出屏幕。
- 缩放 `minWidth/minHeight` 由各窗传入（文档 420×320）；`width/height` 同时受视口上限约束。
- 最小化 `.minimized`：高 40px、贴右下（`right:16px; bottom:46px`）；最大化 `.maximized`：`top:108px` 让开顶栏+菜单栏。
- 窗口 z-index：文档 130、设置 132、`#qcard` 140、引导页 110（引导页开着时浮窗仍可见，靠抬层而非固定层级）。

## 7. 引导页

`#guide` 全屏纸面层（z-index 110），内容：眉标 + 排版字标 + 副标题、三张模式卡
（`.guide-mode[data-mode=signal|circuit|vector]`，选中反墨色）、使用指南、文档/示例入口、
底部「不再显示」`#guideNever` + 「先看文档」`#guideDocs` + 「进入场景」`#guideEnter`。

首屏字标是纯排版锁定（无图片、无像素块，参考 RhineLabUI）：

| 元素 | 规格 |
| --- | --- |
| 眉标 `.guide-eyebrow` | `LOCAL SESSION · 2026 · 单机运行`，8.5px mono / +0.26em / `--dim` |
| 主字 `.gm-l1` | `NETLAB`，750 / `clamp(46px,5.6vw,86px)` / -0.035em / `--ink` |
| 中文直述 `.gm-l2` | `信号流 · 电路 · 矢量场仿真`，11px sans / +0.24em / `--muted` |
| 副字 `.gm-l3` | `ANALYSIS OS`，300 / `clamp(24px,2.7vw,40px)`，`OS` 用 `<em>` 取 `--accent` 700 |

三行用 `guide-line-in`（translateY(14px)→0，780ms `--ease-out`）错峰 40/120/200ms 揭示；
`data-motion=off` 时关闭动画。字标尺寸随视口 clamp，不另建断点。

- 每次启动显示，除非 `ui_guide=never`；「不再显示」勾选后写入全局设置；
- 进入场景：`enterGuideScene()` → `hideGuide()` → 需要时 `switchMode(mode,{skipConfirm:true})`；
- `#guideDemo` 打开信号链示例工程（替代旧的「启动即 demo」）；
- 帮助菜单「重新打开引导页」= `showGuide(true)`；
- 键盘 `Enter`（非输入框内）等于「进入场景」。

## 8. 文档中心

`#docWin` 是非模态浮窗（`class="floatwin docwin"`，z-index 130，基类见 §6.1）：标题栏可拖动、右下角 `.floatwin-resize` 缩放、
`.floatwin-min` 最小化到右下、`.floatwin-max` 最大化、`#docWinClose` 关闭；`Esc` 关闭（设置窗开着时先关设置窗）。

- 左侧 `#docNav` 目录（5 篇），顶部 `#docSearch` 搜索；
- 搜索：`searchDocs(query)` 按空行切段、大小写不敏感包含匹配，命中的段落显示前 150 字，
  点击命中跳转到该文档并保留关键词；无命中给引导文案；
- 渲染：`renderMarkdown()` 支持 `#/##/###`、段落、无序/有序列表、代码块、行内 `**粗体**` / `` `代码` `` /
  `[文本](链接)`；链接统一 `target="_blank" rel="noreferrer"`；不执行任何脚本/HTML；
- 入口：帮助菜单、`Ctrl+K`、引导页、设置窗「交互与文档」、参数 `?` 卡片底部「实现页」。

### 8.1 内容管线

文档源是 `netlab/docs/user/*.md`，后端按固定顺序返回：

1. `GET /api/docs` → `{docs:[{slug,title,text}]}`（顺序由 `USER_DOC_ORDER` 决定）；
2. `GET /api/docs/{slug}` → 单篇；未知 slug 返回 404。

新增一篇用户文档：放 md 到 `docs/user/` → 在 `server.py` 的 `USER_DOC_ORDER` 加 `(slug, 标题)` →
刷新即可（前端 `ensureDocs()` 缓存过期逻辑见 §12）。`docs/` 下的内部文档不会进应用。

## 9. 参数帮助 `?`

`renderSpecPane()` / `paramTable()` 在说明列生成 `?` 按钮；点击 `attachParamHelp(button, param, role)`
弹出 `#qcard`（z-index 140），四段内容：

1. 说明（`param.help`）；
2. 取值（`paramRangeText(param)`，含枚举/范围）；
3. 单位与默认（`param.unit`、`param.default`）；
4. 公式（`param.formula`，等宽字体）+ 「查看实现」跳转到 `state.docs` 对应的实现页（内部文档不在应用内时，跳到术语表对应条目）。

`buildParamField()` 的 label 通过 `typeLabelHelp()` 共享同一份帮助数据；
新增参数不需要改 UI，只要 ParamSpec 带 `help/unit/default/formula`。

## 10. 外观状态机

```
state.prefs = {theme, motion, perf, accent, guide, infobar}
resolveTheme(): system → matchMedia('(prefers-color-scheme: dark)')
applyAppearance(): 写 html[data-theme|data-motion|data-perf]
                   + 覆盖 --accent / --accent-rgb / --accent-soft
                   + state.palette = THEME_TOKENS[theme]
                   + 同步控件 / 写 pref 缓存
```

画布颜色统一走 `C(value)`：

- 认识旧硬编码色（`#a8541f`、`#6f695f`、`rgba(168,84,31,…)` 等）→ 映射到当前主题令牌；
- 深色主题下未知浅色自动向 `#e0e3dc` 混合 42%，避免白块；
- 新增画布颜色必须用 `C(...)` 或 `tokens()`，禁止直接写 hex。

## 11. UI JavaScript 接口

所有函数在同一 IIFE 内，按职责分组（行号随版本漂移，用函数名检索）。

| 函数 | 作用 |
| --- | --- |
| `loadUiPrefs()` | 读 `GET /api/settings` + localStorage 缓存，填 `state.prefs` |
| `setPref(key, value)` | 写缓存 + PATCH 设置 + `applyAppearance()` |
| `applyAppearance()` | 应用主题/动效/性能/强调色/信息条显隐 |
| `initAppearanceControls()` | 绑定 `#segTheme/#accentSwatches/#segMotion/#segPerf/#segInfoBar` |
| `openSettings(pane)` / `closeSettings()` | 打开/关闭设置窗（`placeFloatWindow(ui.settingsWin,'settingsGeo')`） |
| `initSettingsWin()` | 绑定浮窗行为、导航、关闭、场景页渲染 |
| `placeFloatWindow` / `raiseFloatWindow` / `toggleFloatMaximize` / `initFloatWindow` | 浮窗通用层（见 §6.1） |
| `showGuide(force)` / `hideGuide()` / `initGuide()` | 引导页生命周期 |
| `enterGuideScene()` | 按选中模式进入空白场景（`switchMode(...,{skipConfirm:true})`） |
| `ensureDocs()` / `openDoc(slug)` / `closeDoc()` | 文档加载与窗口 |
| `renderDocNav()` / `renderDocBody()` / `renderMarkdown()` / `searchDocs(q)` | 文档渲染与检索 |
| `initDocWin()` | 拖动/缩放/最小化/最大化/搜索键位 |
| `attachParamHelp(btn, param, role)` / `typeLabelHelp(label, param)` | 参数 `?` 四段卡片 |
| `syncFnRoleToSelection()` | 选中对象时切函数子导航角色 |
| `updateInfoBar()` / `setInfo(key, value)` | 信息条 9 段 |
| `menuDefinition()` | 9 组菜单的唯一数据源 |
| `switchTab(name)` / `setPanelGroup(g)` / `setGroupSub(g, sub)` / `activeTab()` | 右栏分组路由 |
| `togglePanel()` / `applyPanelHidden(h)` / `initPanelChrome()` | 右栏收起、宽度拖拽与持久化 |
| `ensureStoppedOnBoot()` | 启动后强制 pause 两侧仿真（R30-6） |
| `tokens()` / `C(v)` / `mixHex()` | 画布取色 |

调试钩子：`window.__netlabDebug`（`state`、`worldToScreen`、`screenToWorld` 等），仅用于自动化验证，勿在产品逻辑依赖。

## 12. 后端接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/docs` | 返回 5 篇用户文档 `{docs:[{slug,title,text}]}` |
| `GET /api/docs/{slug}` | 单篇；未知返回 404 |
| `GET /api/settings` | 全部设置（含 `ui_accent/ui_motion/ui_perf/ui_guide`） |
| `PATCH /api/settings` | 局部更新；`ui_motion∈{off,low,med,high}`、`ui_perf∈{perf,balanced,quality}`、`ui_guide∈{always,never}`、`ui_accent` 空串或 `#rrggbb` |

`/api/state` 中 UI 依赖字段：`sim.running/time/steps/config.dt`、`scene.mode/nodes/edges`。

## 13. 持久化分层（D60）

| 数据 | 位置 | 作用域 |
| --- | --- | --- |
| 主题、强调色、动效、性能、引导、自动保存、信息条显隐 | `%APPDATA%/Netlab/settings.json`（`ui_*` 键） | 跟人走，全局 |
| 图纸风格、GB 符号、网格、节点样式、符号缩放、颜色 | 工程 `.netlab` 的 `ui` 段 | 跟工程走（守 D24） |
| 侧栏宽度、回放速度、pref 缓存 | localStorage（`netlab.networks.*`、`netlab.replaySpeed`、`netlab.ui.prefs`） | 浏览器 |

## 14. 键盘与可访问性

- `Esc` 关闭顺序：qcard → 设置窗 → 文档窗；`Ctrl+K` 打开文档并聚焦搜索；
- 引导页 `Enter` = 进入场景；文档搜索 `Enter` = 跳到第一条命中；
- 所有可点控件用 `button`，状态用 `aria-pressed` / `aria-checked`；
- 图标按钮必须有 `aria-label`；`?` 按钮带 `title`；
- 对比度：主文字 ≥ 7:1，弱化文字 ≥ 4.5:1（暗色同标准）。

## 15. 验收矩阵（R30 / R14）

| 验收点 | 实现 | 证据 |
| --- | --- | --- |
| 启动先选场景、不再自动 demo | `default_simulation()` 空白 + `showGuide()` | pytest `test_default_simulation_is_blank`；截图 01 |
| 引导可关闭、菜单可重开、可不再显示 | `#guideClose` / 帮助菜单 / `#guideNever` + `ui_guide` | 设置引导切换；`test_ui_settings_defaults_and_validation` |
| 文档栏式简介与应用内指南 | `#guide` + `#docWin` 5 篇 | 截图 04/05；`test_docs_index_returns_five_user_docs` |
| 右栏 4 组、工程进设置、场独立 | `#panel` 4 `.panel-tab` + `#settingsDrawer` + `fem` 组 | 截图 02；分组切换 4 组各 1 pane |
| 节点/连接函数随选中切换 | `syncFnRoleToSelection()` + 子导航 | 选中节点后 `fnRole=node` |
| 信息条 9 项 | `#infoBar` 9 个 `data-info` | 截图 02 |
| 菜单 9 项（D61） | `menuDefinition()` | 自动导出菜单树 9 组 |
| 帮助体系：`?` 四段 + 搜索 + 术语统一 | `attachParamHelp` + `searchDocs` | 搜索「回放」4 条命中 |
| 任一模式启动停止 | `ensureStoppedOnBoot()` + 移除自动 run | 进入后 `running=false` |
| 主题/强调色/动效/性能可调 | `applyAppearance()` + 4 组控件 | 浅色切换后 `--paper=#eae5e1` |
| GPU 友好 | 只动 transform/opacity；性能档关模糊/阴影 | 无 `filter` 长动画；`data-perf` 生效 |

## 16. 扩展点与禁忌

**可以这样加**：新面板组（`PANEL_GROUPS` + index.html 一个 `.panel-group` + 一个 `switchTab` 分支）；
新菜单项（只改 `menuDefinition()`）；新设置项（§6 三步）；新文档（§8.1 两步）；
新画布颜色（`C()` / `tokens()`）；新动效（两条曲线 + 四档时长）。

**不要这样写**：

- 新增圆角、渐变按钮、彩色大面积底；不要用 `backdrop-filter` 叠 canvas；
- 在 CSS 里写 hex（除令牌表）；在 Canvas 里写死颜色；
- 新开第二套菜单/信息条/状态提示数据源（三处同步是既有坑）；
- 在 `boot()` 里直接 `run`；任何模式启动必须停止；
- 引入前端构建链或第三方 CDN（离线要求）；
- 在引导页里点「先看文档」时调用 `hideGuide()`（会退出开始页；文档窗应浮在引导层之上，关闭文档回到开始页）；
- 把 `.hanger` 放到 `<main>` 之外——它依赖 `main` 上的 `--panel-w` / `--net-w`；
- 给 `#menubar` 或外壳块加 `overflow: hidden`——菜单面板绝对定位于 `.menu` 内，会被整体裁掉；控宽请用 `min-width: 0` + `.info-bar { overflow: hidden }`（3.9.5 踩坑）。

## 17. 版本与缓存

三处静态资源引用必须同步 bump（`?v=`）：

- `index.html` 的 `<link rel="stylesheet" href="/static/style.css?v=…">`
- `index.html` 的 `<script src="/static/app.js?v=…">`
- 当前版本 **3.9.9**

改前端后：改两处 `?v=` → 强刷或重开桌面应用。后端/文档改动不需要 bump。

## 18. 验证命令

```bash
cd NetlabHome
python -m pytest netlab/tests -q              # 当前 323 passed
python -m compileall -q netlab
python -m netlab.desktop --selftest           # backend + qt + ok:true
node --check frontend/app.js
# 浏览器实测（页在 http://127.0.0.1:8010，CDP 在 9333）：
node netlab/tools/cdp_check.mjs
```

R30 的自动化 UI 验收脚本在 `NetlabExtras/scratch/verify_r30.mjs`（引导页、设置抽屉、文档窗、主题、分组），
设置窗改造的验收脚本是 `NetlabExtras/scratch/verify_settings_win.mjs`（拖动/缩放/最小化/最大化/页签/与文档窗共存/位置记忆），
截图输出到 `NetlabExtras/scratch/r30/`。
