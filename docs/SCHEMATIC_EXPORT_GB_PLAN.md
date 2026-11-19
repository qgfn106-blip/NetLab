# 原理图导出与 GB 绘图方案（基于现有 SchemDraw/Canvas 的修订版）

> 状态：**方案修订版 · PENDING_USER_AUTHORIZATION**（本次只修改本文档，未修改产品代码、测试或配置）
> 基线：NetLab 当前工作树；现有前端绘图与后端 SchemDraw 导出代码已按真实源码核对。
> 本版目标：不是另起一套绘图系统，而是让导出端复用现有场景几何、引脚和 GB 风格规则，同时保留 SchemDraw 作为 SVG 渲染器。

---

## 1. 对原方案的评价

原方案的产品目标是正确的：保留折点、以正交为主、使用 GB 风格元件、导线不显示 `wire-*` 文本、正确显示 junction、提供统一导出窗口，并通过参考图验收。这些目标与用户已经确认的要求一致。

但原方案不能直接实施，主要原因不是方向错，而是把当前系统的几个不同层次混成了一层：

| 评价 | 原方案问题 | 修订结论 |
| --- | --- | --- |
| 几何来源 | 把后端重写成自己的布局/规范化实现，却没有先定义它与前端 `edgePathPoints` 的一致关系。 | 先定义规范化后的导出 IR；输入优先使用现有 `route / waypoints / anchors / layout / source_pin / target_pin`，不凭节点中心重画。 |
| 符号来源 | 方案写成“直接向 `Drawing` 写 SVG 片段”。SchemDraw 的公开 `Drawing.add()` 接受 `Element`，`add_svgdef()` 只加入 `<defs>`，不能把任意完整 SVG 片段当作普通元件加入。 | 使用 SchemDraw `Element` + `Segment` 等公开绘图对象封装 GB 符号；禁止假设存在“直接添加 SVG 片段”的接口。 |
| 前后端重复 | 前端已经有 `circuit_symbols.ts`、`edgePathPoints()`、引脚几何和交叉跳线；原方案会再造一份不受约束的规则。 | 前端继续负责交互绘制；后端建立同语义但独立可测试的导出适配器，二者共享数据契约，不共享运行时实现。 |
| 符号数量 | “22 个 kind”没有由当前真实 kind 注册表推导，容易把不存在的种类写进验收标准。 | 先从 `ports.py`、元件注册表、`circuit_symbols.ts` 和 fixture 得到 inventory；验收数量等于 inventory，未知类型必须显式报告。 |
| junction | 仅按坐标或节点度数判断会把几何交叉误判为电气连接。 | junction 必须由解析后的 wire 拓扑、端点/折点合并和交叉规则共同决定；几何交叉默认不连接。 |
| 导出窗口 | 原方案把 renderer、style、rendering mode、format 当成别名，并把“新窗口”写成浏览器 `window.open` 风险。 | 明确四个正交维度；第一版使用应用内 modal/overlay，桌面目的地复用现有 `save_text` 原生保存框。 |
| 网格/角度 | 原方案写了泛化“四轴吸附”，与已确认的字段要求不一致，也没有定义 world unit 与 2.54 mm 的换算。 | 网格字段分层保存；角度是 wire route policy，不是网格 spacing 的别名；定义单位转换与容差。 |

**综合评价：** 原方案“产品目标 8/10，现状接线准确性 4/10，可实施性 5/10”。修订后的关键不是增加更多文件，而是先建立一个小而深的 `SchematicExportIR` 模块，让布局、符号和输出都从同一个接口接受测试。

---

## 2. 当前真实实现基线

### 2.1 前端 Canvas 是现有交互绘图的事实来源

现有前端已经具备大量不能丢失的语义：

- `frontend/app/canvas_base.ts:201-220` 的 `wirePathPoints()`：网络节点/器件引脚的起终点、`route`、`waypoints` 和默认正交路径。
- `frontend/app/geometry.ts:335-390` 的 `edgePathPoints()`：普通边、wire、manual waypoint、orthogonal 和曲线路径的分派。
- `frontend/app/canvas_base.ts:184-198` 的 `circuitPinPath()`：两引脚器件的引脚路径。
- `frontend/app/circuit_symbols.ts:302-367` 的 `ELEMENT_PIN_GEOMETRY` 与 `elementPins()`：多引脚器件的引脚、绑定名和角色。
- `frontend/app/circuit_symbols.ts:369-385` 的器件中心、旋转和符号缩放。
- `frontend/app/circuit_symbols.ts:277-297` 的当前 junction 绘制规则，以及 `:289-324` 的交叉跳线规则。
- `frontend/app/inspector.ts:237-319` 已支持导线折点编辑；折点为空时按正交/直线路由。

因此，导出端至少必须保留以下优先级：

```text
显式 manual waypoints > edge anchors/source_pin/target_pin > device layout/rotation > circuit 默认正交 > 缺失坐标时的导出专用 fallback layout
```

“保留折点”不是在导出时重新猜一条好看的线，而是优先忠实转换已有的 `waypoints`。

### 2.2 当前后端导出为什么会失败

`netlab/core/compute/schematic_export.py:131-187` 当前 `scene_to_svg()` 的问题是结构性的：

1. `:145` 只得到节点坐标；`：147-160` 逐条 edge 以 `edge.source` 到 `edge.target` 画线或元件。
2. 没有读取 `route`、`waypoints`、`anchors`、`layout`、`source_pin`、`target_pin`。
3. `:153-160` 对 unknown kind 或渲染异常回退到带 label 的 `el.Line()`；这会把 wire 当作带文字的线。
4. `:161-173` 只对少量参数绑定追加直线，不能表达完整多引脚器件拓扑。
5. `:175-179` 只把 node/ground 画成点或地，不能把已迁移的 device node 与 wire graph 还原成器件-引脚结构。
6. `_element_map()` 依赖 SchemDraw 内置美式符号，当前没有接入工程 `symbol=gb|classic`。

### 2.3 当前模型不是只有“edge 元件”一种形态

`netlab/core/model/records.py:53-79` 的 `EdgeRecord` 已包含 `route`、`waypoints`、`anchors`、`layout`、`source_pin`、`target_pin`。同时，`netlab/core/model/project.py:300-465` 的 `migrate_scene_to_devices()` 会把部分旧 edge 元件迁移为 device node + wire edges。

所以导出必须同时接受两种合法输入：

- 新形态：`device node + wire edge`；
- 兼容形态：`element edge`，包括参数中绑定的额外引脚网络。

不允许只为 fixture 设计新形态，然后让旧工程导出静默丢器件。

---

## 3. 修订后的目标与边界

### 3.1 第一版必须实现

- 保留合法 `manual` 路由的所有折点；
- `auto` 路由在电路模式默认采用与前端一致的正交策略；
- 以器件引脚为连接端，而不是以器件中心为连接端；
- wire 不产生任何 `wire-*`、wire name 或 wire value 文本；
- device label/value 在符号外侧，且不得与符号或 wire 主段重叠；
- 真实多分支节点绘制实心 junction；单纯几何交叉不绘制 junction，并按 GB 风格断开/跳线；
- `gb` 与 `classic` 是 style，不是 renderer 或 rendering mode 的别名；
- 未知器件显示带原始 kind/name 的明确 unsupported box，并在响应 `unsupported[]` 中列出；
- 没有有效坐标时只使用导出阶段的确定性 fallback，不回写工程；
- JSON/SVG 共用同一个导出窗口和同一个数据快照；
- 桌面导出使用现有 `save_text`，取消不提示成功，失败显示真实错误，Web 模式保留浏览器下载回退。

### 3.2 第一版明确不做

- 不把前端 Canvas 代码移植到 Python，也不让后端调用浏览器运行时；
- 不把 SchemDraw 换成新的 SVG/PNG 引擎；
- 不在导出时自动修改节点位置、route、waypoints 或工程文件；
- 不在第一版加入 PNG、截图、剪贴板等没有既有端到端契约的目标；
- 不用“所有器件都有 22 个固定种类”替代实际 kind inventory；
- 不把几何坐标重合直接当作电气连接；
- 不以“SVG 能打开”作为唯一视觉验收。

---

## 4. 修订后的数据契约：SchematicExportIR

新增一个内部导出接口，不直接让 `scene_to_svg()` 读散落字段。建议位置：`netlab/core/compute/schematic_export_ir.py`。它是后端导出模块的深接口，外部只需要传 scene 和选项，内部统一处理兼容形态、布局、引脚、线段和诊断。

建议的最小结构：

```text
SchematicExportIR
  units: { world: "netlab-world", svg: "pt", mm_per_world: explicit number }
  devices: [{ id, kind, name, params, center, rotation_deg, bbox, pins[] }]
  nets: [{ id, members[] }]
  wires: [{ id, net_id, points[], source_pin?, target_pin?, route_source }]
  junctions: [{ x, y, reason: "branch" | "explicit" }]
  crossings: [{ x, y, over_wire_id, under_wire_id }]
  labels: [{ text, anchor, placement, owner_id }]
  unsupported: [{ id, kind, name, reason }]
  warnings: [{ code, message, owner_id? }]
  stats: { nodes, devices, wires, junctions, crossings, unsupported }
```

### 4.1 IR 构建规则

1. 先解析场景为统一 device/net 图；新形态直接读取 device node 和 wire edge。
2. 兼容形态先使用已有 `migrate_scene_to_devices()` 的语义，或在导出 IR 内使用等价的只读适配器；不得修改 scene。
3. 对每个 device 使用明确的 pin catalog：pin name、bind、role、局部坐标、连接方向。catalog 必须与前端现有 `elementPins()` 和后端 `pins_for_device()` 做 inventory 对照。
4. 对每条 wire 解析端点。若 `route=manual` 且有 waypoints，保留原顺序；若 `route=straight`，保留直线；若 `route=auto`，使用导出选项决定 orthogonal/free；缺失端点才进入 fallback。
5. 把 world 坐标统一转换为 SVG 坐标，明确 y 轴方向、比例和 2.54 mm 标准栅格换算；禁止在多个函数中重复写 `*0.02` 这类隐式转换。
6. 规范化后删除连续重复点、零长度段和不必要的共线中间点，但不得删除用户显式保留、用于绕开器件或交叉的折点。

### 4.2 junction 与 crossing 的判定

- branch junction：同一 net 的三个或以上 wire 端点/合法分支在同一规范化坐标相遇；
- explicit junction：未来若模型有显式 junction 记录，优先保留；
- crossing：两个不同 net 的线段相交，默认不连接；选择稳定的 over/under 规则并输出 crossing 记录；
- 同一坐标但不同 net 不得仅因浮点近似就合并；使用定义好的 epsilon，并在 warnings 中报告近似合并；
- junction 点应绘制在导线交汇处，不以“节点中心有三条边”作为唯一判断。

---

## 5. SchemDraw 的正确保留方式

### 5.1 不采用“直接塞 SVG 片段”

当前 SchemDraw 0.23 的公开路径是：`Drawing.add(element)` → `Element._draw()` → segment backend；`Drawing.add_svgdef()` 的职责是加入 SVG `<defs>`。因此原方案中的“向 Drawing 直接写入自绘 SVG 片段”必须删除。

### 5.2 推荐的 GB 符号适配器

新增：

- `netlab/core/compute/schematic_symbols.py`：定义 `GBElement(Element)` 适配器，把声明式符号规格编译成 SchemDraw segments；
- `netlab/core/compute/symbols/gb.json`：单一声明式符号规格；同时包含 `gb`、`classic` 的 style 变体，不能另建一套不一致的引脚表；
- `netlab/core/compute/schematic_symbol_catalog.py`：可选的 catalog 校验和 inventory 输出。若文件数量过多，可将 catalog 校验并入 `schematic_symbols.py`，不要为了“文件多”而拆薄模块。

每个 symbol spec 至少包含：

```text
{ kind, style, primitives, anchors, pins, bbox, label_slots, rotation_policy }
```

`primitives` 只允许有限、可测试的声明式类型，例如 line、polyline、circle、arc、polygon、text；编译器把它们转换为 SchemDraw `Segment`、`SegmentCircle`、`SegmentArc`、`SegmentText` 等对象。器件图形和 pin anchors 必须来自同一 spec，不能一份用于绘图、另一份手写用于接线。

### 5.3 符号 inventory 不预先写死为 22

S1 开始先生成一份真实 inventory：

- 后端：`netlab/core/model/ports.py`、element registry/创建器；
- 前端：`frontend/app/circuit_symbols.ts:302-367`；
- 现有 `_element_map()`：`netlab/core/compute/schematic_export.py:27-53`；
- 用户确认的等价 fixture：桥式整流 + 两级 BJT 稳压。

每个 inventory 项标记 `supported / fallback-box / not-in-fixture`。验收标准写“inventory 中声明为 supported 的每个 kind 均有结构测试”，而不是写一个未经核对的固定数量。

---

## 6. 几何、走线和布局实施方案

### 6.1 路由优先级

导出端新增 `resolve_export_path(edge, endpoints, options)`，规则固定为：

1. `manual + waypoints`：完整保留，并在端点处接到实际 pin anchor；
2. `straight`：保留直线，但若与器件图形相交，返回 warning，不静默改线；
3. `auto + circuitOrthogonal`：采用与前端同样的水平优先/垂直优先正交策略；
4. `auto + angle policy`：只有用户选择了 45°/60° 等非正交模式才使用角度规范化；
5. 缺失/重叠/非法坐标：仅对该场景启用 deterministic export fallback layout，并把 `fallback_layout=true` 写入 stats/warnings。

### 6.2 角度字段的实际含义

- `angle_mode = constrained | free`；
- `angle_set = [0, 45, 60, 90]`，仅在 constrained 下使用；
- `angle_tolerance_deg = 3`，是吸附容差，不是强制把所有线段改成某个角度；
- 默认仍以 orthogonal 为主；45°/60°是允许的补充方向，不得把用户已有 manual 路径全部重写。

导线检查器的角度控制应影响当前 wire 的 route policy；工程设置中的默认值只影响新建/auto wire 和导出选项，不覆盖已有 manual waypoints。

### 6.3 fallback layout

fallback 只在导出时生效：

- 先固定 ground/电源/输入输出角色；
- 对连通图按拓扑层级从左到右排列；
- 对同层节点按稳定 id 排序；
- 器件放在其主连接线中部，支路保持最少交叉；
- 使用固定 seed/排序，保证同一输入每次得到相同 SVG；
- 不写回 `position`、`layout` 或 `waypoints`。

这比“坐标不足就全部重排”更安全，因为有合法位置的真实工程必须保持用户布局。

---

## 7. 统一导出窗口的正确拆分

### 7.1 四个维度必须独立

| 维度 | 第一版值 | 说明 |
| --- | --- | --- |
| renderer | `schemdraw` | 当前唯一后端渲染器；保留未来扩展位，但不伪造多个 renderer。 |
| style | `follow-project` / `gb` / `classic` | 符号风格；与 renderer 分开。 |
| render mode | `schematic` / `scene-data` | `schematic` 产出图；`scene-data` 产出当前场景 JSON。 |
| format | `svg` / `json` | `schematic` 只允许 SVG；`scene-data` 只允许 JSON。 |
| destination | `desktop-save-dialog` / `browser-download` | 由前端/桌面壳处理，不作为后端图形渲染参数。 |

第一版不显示 PNG、截图、剪贴板选项，避免窗口出现实际上没有端到端实现的选项。

### 7.2 窗口形态

“新窗口”在本方案中指应用内导出窗口（modal/overlay），不是 `window.open()`。这样不会引入弹窗拦截、跨窗口状态同步和 E2E 不稳定问题。若将来确实需要独立窗口，再增加明确的 desktop/webview contract。

建议新建 `frontend/app/export_dialog.ts`，只负责：表单状态、选项约束、预览摘要、调用统一 orchestrator、显示保存结果。真正的导出动作仍集中在 `exportScene`/`exportSchematic` 的共享 helper，避免三处分散入口重新分叉。

### 7.3 现有入口的修改位置

- `frontend/app.ts:1356`：工具栏入口改为 `openExportDialog()`；
- `frontend/app.ts:2967-2968`：文件面板两个按钮改为同一入口；
- `frontend/app.ts:4102-4103`：主菜单两个项目改为同一入口；
- `frontend/app.ts:3282-3340` 附近：保留底层 JSON/SVG 导出 helper，不让 UI 直接拼接不同协议；
- `frontend/app/desktop.ts` 与现有 `saveTextViaDesktop`：继续复用原生保存；取消、错误、Web fallback 语义保持一致。

### 7.4 API 设计

保持现有接口兼容，不把 destination 传给后端：

- `/api/export/schematic` 保留 `name`、`network`；新增可选 `style`、`angle_mode`、`angle_set` 等渲染选项；
- `/api/scene/export` 继续提供 JSON 数据；统一窗口只负责选择并调用它；
- SVG 响应扩展 `warnings`、`unsupported`、`stats`，但保留现有 `ok`、`svg`、`filename`；
- 后端不能把“已保存到文件”当作自己的结果；保存路径只能由 `save_text` 返回。

---

## 8. 网格、工程设置和导线检查器

### 8.1 字段位置必须落在现有 uiSettings.grid

当前 `frontend/app/project.ts:148-177` 已把 `grid` 作为工程 UI 设置的一部分；`frontend/app.ts:4654-4662` 已读取 grid；不要在顶层再散落一套同名字段。建议扩为：

```text
ui.grid = {
  spacing, subdivisions, show, snap, snapMarkers,
  angleMode, angleSet, angleToleranceDeg,
  showOrigin, showRuler, adaptiveZoom,
  orthogonal  // 兼容现有 circuitOrthogonal，逐步迁移
}
```

修改位置：

- 类型：`frontend/app/types.ts:62-73`；
- 默认状态：`frontend/app/state.ts:201-207` 附近；
- 工程序列化：`frontend/app/project.ts:148-177`；
- 工程回读：`frontend/app.ts:4654-4662` 和 `frontend/app/project.ts:511` 附近；
- 现有设置导航：`frontend/app/settings_guide.ts:29-75`；
- 现有状态控件：`frontend/index.html:314-317` 及 `app.ts:6667-6670`。

“2.54 mm”必须写入单位说明和转换函数，不要直接把它当作当前 `grid=20` 的同义词。当前前端使用 world/pixel 变换；实施时先决定 `mm_per_world`，再让显示网格、吸附和 SVG 输出都使用同一转换。

### 8.2 导线检查器

在 `frontend/app/inspector.ts:237-319` 的 wire inspector 增加：route mode、angle mode、angle set、折点规范化预览；保存时只更新 wire 的 route/waypoints，不修改电气连接字段。工程默认角度设置来自 `ui.grid`，当前 wire 的显式设置优先。

---

## 9. 精确修改清单

### 9.1 后端

| 文件 | 修改方向 | 必须避免 |
| --- | --- | --- |
| `netlab/core/compute/schematic_export_ir.py` | 新建：场景兼容适配、单位转换、pin/net/wire/junction/crossing IR。 | 直接输出 SVG；把 layout 改回 scene。 |
| `netlab/core/compute/schematic_layout.py` | 新建或并入 IR：路由优先级、fallback layout、路径清理。 | 无条件重新布局已有工程。 |
| `netlab/core/compute/schematic_symbols.py` | 新建：声明式 spec → SchemDraw Element/Segment。 | 假设能把完整 SVG 字符串直接 `Drawing.add()`。 |
| `netlab/core/compute/symbols/gb.json` | 新建：GB/classic primitive、bbox、anchors、pins、label slots。 | 与前端另写不一致的 pin 表。 |
| `netlab/core/compute/schematic_export.py:27-187` | 重构成 IR → symbol renderer → wires/labels → frame；保留 `scene_to_svg`/`svg_filename` 兼容入口。 | 继续按 edge source/target 中心画线；wire fallback label。 |
| `netlab/server_scene/__init__.py:247-257` | 解析有限渲染选项，扩展诊断响应，保留旧参数。 | 接受 destination 并让后端写用户文件。 |
| `netlab/tests/test_schematic_export.py` | 从“有 SVG/R1/标题”扩展为 schema/route/label/unsupported/junction 测试。 | 只测 SVG 非空。 |
| `netlab/tests/test_schematic_symbols.py` | 新建：catalog inventory、pin anchor、style、unknown box、SchemDraw public API。 | 用未经核实的 22 个固定数量。 |
| `netlab/tests/fixtures/schematic/` | 放桥式整流 + 两级 BJT 稳压的等价场景和预期结构 JSON；图片只作人工参考。 | 只放一张没有结构 oracle 的 PNG。 |

### 9.2 前端

| 文件 | 修改方向 |
| --- | --- |
| `frontend/app/export_dialog.ts` | 新建应用内统一导出窗口，四维选项约束和保存结果处理。 | `window.open()` 新窗口。 |
| `frontend/app.ts:1356,2967-2968,4102-4103` | 三处入口只调用统一窗口。 | 保留三套独立导出逻辑。 |
| `frontend/app.ts:3282-3340` | 抽出 JSON/SVG 底层 helper，统一请求选项和 `saveTextViaDesktop`。 | 在 UI 层重复拼 URL、文件名和 toast。 |
| `frontend/app/types.ts`, `state.ts`, `project.ts` | 扩展嵌套 `ui.grid`，提供旧字段读取兼容。 | 顶层新增同名 grid 字段。 |
| `frontend/app/settings_guide.ts`, `frontend/index.html`, `frontend/app.ts:6667-6670` | 增加 spacing/stepper、subdivisions、visibility、snap、angle、origin/ruler、adaptive controls。 | 把 subdivisions 当成独立 snap step；用户未确认该字段。 |
| `frontend/app/inspector.ts:237-319` | 增加 wire route/angle 控件，显式 waypoints 优先。 | 设置全局默认时覆盖已有手工折点。 |
| `frontend/e2e/export_dialog_ux.mjs` | 新建统一窗口四条主链；通过 `window.__nsTest` mock 保存桥，不阻塞真实对话框。 | 在 CI 直接打开原生保存对话框。 |

---

## 10. 实施阶段（修订版）

| 阶段 | 内容 | 完成门槛 |
| --- | --- | --- |
| S0 | inventory、现状 fixture、单位/route/style/mode contract | 真实 kind 清单、旧/新场景各一份、契约评审通过。 |
| S1 | `SchematicExportIR` 与旧/新场景适配 | 不改 scene；route/waypoints/source_pin/target_pin 可被结构化读取。 |
| S2 | SchemDraw GBElement 与单源 symbol spec | 用公开 Element/Segment API 生成 SVG；每个 supported kind 的 pin 与 bbox 测试通过。 |
| S3 | 路由、引脚、junction、crossing、label | fixture 中折点保留；wire 无文字；不同 net 交叉无 junction；标签不压线。 |
| S4 | `scene_to_svg`/API 收口 | 旧调用兼容；响应包含 warnings/unsupported/stats；未知 kind 不静默降级。 |
| S5 | 统一导出窗口和 native/browser destination | SVG/JSON 选项互斥正确；取消静默；失败可见；三入口行为相同。 |
| S6 | 工程 grid 与 wire inspector | 工程默认可保存/回读；显式 manual waypoints 不被默认设置改写。 |
| S7 | 参考图、结构 oracle、Playwright E2E、人工签收 | CI 可运行；fixture 结构、SVG XML、视觉对照和整图人工签收全部通过。 |

每阶段都必须提交可回滚的小 PR；没有通过当前阶段门槛，不进入下一阶段。

---

## 11. 验收标准

### 11.1 结构验收（自动化）

- 输出是可解析 XML 的 SVG，包含完整 viewBox；
- 所有 wire 元素没有 text label；
- 所有 supported device 都有 symbol group、pin anchor 和 owner id；
- manual waypoints 在规范化前后点数与顺序可追踪，不能被无故删除；
- unknown kind 不生成无标签直线，必须出现在 `unsupported[]` 并有可见 box；
- junction/crossing 的数量和坐标来自 IR，不能只按 SVG 圆点数量猜测；
- 同一输入快照生成的 SVG 在排序、尺寸和内容上稳定。

### 11.2 数值/几何验收

- 引脚连接误差小于定义的 world-unit epsilon；
- 每条 wire 的相邻点不产生零长度段；
- wire 与所属符号 bbox 不相交（允许连接 pin anchor 的端点接触）；
- 交叉线的 net id 不被合并；
- 标签 bbox 与 wire/symbol bbox 不重叠，或在明确的 label slot 内；
- 2.54 mm 栅格转换在正向/反向转换后误差不超过规定 epsilon；
- fallback layout 对同一 scene 重复运行结果一致，且不修改输入。

### 11.3 E2E 验收

- 从工具栏、文件面板、主菜单进入同一导出窗口；
- `schematic + SVG` 调用 SchemDraw 路径，`scene-data + JSON` 调用 scene export；
- 桌面模式 mock `saveText` 可验证 default name、完整文本和真实路径 toast；
- 取消保存无“成功”提示；
- 保存失败显示错误；
- Web 模式才走浏览器下载回退；
- 项目设置修改后保存/回读，wire inspector 的显式折点保持不变。

### 11.4 视觉验收

采用三层证据：

1. 结构 JSON oracle：验证器件、引脚、网络、折点、junction、crossing；
2. 符号对照页：每个 supported kind 与 GB 参考小图并排；
3. 整图人工签收：桥式整流 + 两级 BJT 稳压 fixture，检查符号、线型、折点、标签、junction、留白和可读性。

“SVG 文件存在”“浏览器能打开”“有 R1 文本”都不能单独作为发布标准。

---

## 12. 风险、回滚与决策点

| 风险 | 处理 |
| --- | --- |
| SchemDraw custom Element 与当前版本不兼容 | 只使用已验证的 public `Element`/`Segment`/`Drawing.add` 路径；启动时做最小 renderer smoke test；失败回滚到旧导出入口。 |
| 前后端路径略有差异 | 以 IR 结构断言为准；增加一个与前端 fixture 对比的 route parity 测试；不要声称二者共享实现。 |
| 旧 edge 形态被遗漏 | S0 必须有旧 edge fixture，S1 通过兼容适配器测试后才可删除旧导出逻辑。 |
| 视觉上“更规范”但改变用户布局 | 有效坐标/显式 waypoints 不重排；fallback 仅导出、仅缺失坐标。 |
| 网格单位不清 | 在 S0 固定 world/mm/svg 转换和容差；未固定前不实现 2.54 mm 验收。 |
| 导出窗口选项超出实际能力 | 第一版只显示已实现的 renderer/style/mode/format/destination；PNG 等保留为后续需求。 |

回滚策略：每个阶段独立 PR；S4 以前保留旧 `scene_to_svg` 兼容路径，S5 以前保留原有 JSON/SVG 入口，任何阶段失败可单独回退，不回退工程用户数据。

---

## 13. 原方案需要逐项修改的位置

| 原文位置 | 修改动作 |
| --- | --- |
| §2 “缺几何契约 + 缺符号契约” | 保留结论，但补充当前前端已有 `edgePathPoints`、引脚和交叉规则，改成“后端未接入既有契约”，不是“系统完全没有契约”。 |
| §3.1 `symbols/gb.json` + “bake 成 SVG 片段” | 改为 declarative spec → SchemDraw `GBElement`/segments；删除直接 SVG 片段说法。 |
| §3.2 “渲染契约” | 增加 `SchematicExportIR`、pin/net/wire/crossing/label owner；禁止只以最终 SVG 验证。 |
| §3.3 “三步规范化” | 改为 route precedence + explicit manual preservation + unit conversion；角度吸附不能覆盖手工折点。 |
| §3.4 fallback layout | 增加“新/旧场景兼容、只读、不回写、稳定排序”。 |
| §3.5 API | 删除 destination 作为后端参数；保留旧查询参数，新增有限渲染选项和诊断字段。 |
| §4.1 renderer/style/mode/format | 拆成独立枚举；第一版 renderer 只有 schemdraw，mode 只有 schematic/scene-data，format 只 SVG/JSON。 |
| §4.1 “PNG/复制到剪贴板” | 移到明确的后续需求，不进入第一版 UI。 |
| §4.2 “新窗口” | 改为应用内 modal/overlay；不使用 `window.open()`。 |
| §4.3/§5.2 偏好字段 | 改为嵌套 `ui.grid`，与现有 `project.ts`/`applyProjectUi` 接线一致。 |
| §5.1 “22 个 kind” | 删除固定数量，改为 inventory-driven acceptance。 |
| §6 阶段 | 增加 S0 inventory/units/legacy fixture，并把 S1–S7 按 IR→renderer→geometry→API→UI→E2E 排序。 |
| §7 验收 | 增加结构 IR、拓扑 junction、单位转换、稳定性和取消/失败 E2E；删除“只看 SVG 有无”的宽松表述。 |

---

## 14. 当前结论与批准边界

本修订版建议的最短可靠路径是：

```text
S0 真实 inventory/单位/fixture
→ S1 SchematicExportIR（兼容旧 edge 与 device+wire）
→ S2 SchemDraw GBElement（公开 Element/Segment 接口）
→ S3 路由/引脚/junction/crossing/label
→ S4 API 兼容与诊断
→ S5 统一导出窗口与 native save
→ S6 grid/inspector 接线
→ S7 结构 + 视觉 + E2E 验收
```

在用户明确批准实施之前，所有产品代码、测试、配置和 Git 历史改动仍为 **PENDING_USER_AUTHORIZATION**。

文档依据的关键现有位置：

- `NetlabHome/netlab/core/compute/schematic_export.py:27-187`；
- `NetlabHome/netlab/core/model/records.py:53-79`；
- `NetlabHome/netlab/core/model/project.py:300-465`；
- `NetlabHome/frontend/app/canvas_base.ts:184-220`；
- `NetlabHome/frontend/app/geometry.ts:335-390`；
- `NetlabHome/frontend/app/circuit_symbols.ts:277-385`；
- `NetlabHome/frontend/app/inspector.ts:237-319`；
- `NetlabHome/frontend/app/project.ts:148-177`；
- `NetlabHome/frontend/app.ts:4654-4662`；
- `NetlabHome/frontend/app/settings_guide.ts:29-75`；
- `NetlabHome/frontend/index.html:314-317`。
