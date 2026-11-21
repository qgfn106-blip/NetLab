# NetLab 布局优化方案

- 状态：工作台布局（A）已实现并通过测试；PlotKit GridSpec（B）与电路自动布局（C）为后续独立专项
- 日期：2026-11-21
- 作用域：分析工作台多画布布局、图表内子图布局、电路/信号流自动布局
- 关联代码：
  - `frontend/app/analysis_workbench_layout.ts`
  - `frontend/app/analysis_workbench_canvas.ts`
  - `frontend/app/analysis_workbench.ts`
  - `frontend/app/analysis_workbench_actions.ts`
  - `frontend/app/analysis_chart.ts`
  - `frontend/style.css`
  - `frontend/app.ts`
  - `../analysis-wb-plotkit/src/plotkit/static/render2d.ts`
- 外部参考：PlotJuggler `pj_plotting/widget` 的 `TabbedPlotWidget` / `PlotDocker` / `DockWidget` 布局实现

## 0. 摘要

NetLab 目前有三类“布局”问题，它们发生在不同层级，不能用一个全局网格模式同时解决：

1. **工作台多画布布局**：当前只有 `grid | tile | split | max` 四种互斥模式，不能嵌套、不能局部操作、不能保存分割比例。
2. **图表内子图布局**：PlotKit 只支持等分网格，`ncols` 固定后每个子图尺寸相同，不能设置行列权重、跨行/跨列。
3. **电路/信号流自动布局**：`app.ts` 的 `autoLayout()` 只做最长路径分层，没有破环、交叉最小化、Brandes-Köpf 坐标分配和正交避障布线。

本方案按“工作台树布局 → PlotKit GridSpec → 电路图 Sugiyama”三层推进。第一批先解决工作台交互和持久化，第二批再动图表内部网格，电路自动布局作为独立专项，避免一次改动同时动 UI、渲染和图形算法。

## 1. 背景与目标

### 1.1 用户问题

用户提出：

> “对于当前工作台的多子图编辑界面，我希望你可以阅读该仓库的代码，并学习其中的前端代码，与布局方式优化现在的布局界面并给出方案。”

核心诉求不是换一套配色，而是：

- 能自由组合多个画布；
- 能拖动、分割、合并、最大化、恢复；
- 每个画布内部的多个子图能适应宽屏/窄屏；
- 布局要能记住，不要每次重新摆。

### 1.2 目标

1. 工作台支持嵌套布局：左右分屏、上下分屏、tab 组合，而不是只能选一个全局模式。
2. 画布支持局部操作：在任意 tile 上水平/垂直分割，拖到另一个 tile 中央合并 tab，关闭后兄弟节点自动填满。
3. 布局可持久化：树结构、分割比例、画布顺序、侧栏折叠状态写入工程。
4. 图表内子图支持权重、跨行/跨列和自适应排列。
5. 电路/信号流自动布局可独立升级为 Sugiyama + 正交避障，不影响现有分析算法。

### 1.3 非目标

- 不改变任何电路求解、传递函数、环路分析算法。
- 不改变分析结果的数据结构和后端 API。
- 第一阶段不引入 Qt/ADS 或第三方 dock 库；用原生 DOM + CSS flex 实现最小布局树。
- 第一阶段不做自由浮动子窗口；工作台整体仍是现有浮窗，内部只做分割树。

## 2. 参考：PlotJuggler 的布局模型

PlotJuggler 是 Qt/C++ 桌面应用，不是 Web 前端；但它的布局代码比大多数 Web dock 示例更完整，值得借鉴的是数据模型和交互规则，不是具体控件。

### 2.1 TabbedPlotWidget：外层场景标签

- 自定义 tab strip，每个 tab 对应一套完整布局。
- 每个 tab 内部是一个 `PlotDocker`。
- 支持新增、关闭、双击改名、右键复制 tab；tab 过多时横向滚动。
- tab 是“布局方案”维度，不是单个图。

### 2.2 PlotDocker：每个 tab 内部的分割树

- 每个 `PlotDocker` 持有一个 ADS `CDockManager`，内部是一棵可递归分割的 `DockWidget` 树。
- 关键配置：
  - `EqualSplitOnInsertion = true`：新插入的 panel 默认均分当前区域；
  - `OpaqueSplitterResize = true`：拖动分隔条实时重排；
  - `DragPreviewIsDynamic = true`：拖拽时显示实时落点预览；
  - `FocusHighlighting = true`：活动 panel 高亮；
- `toggleFullscreen()` 保存 `pre_fullscreen_sizes_`，`exitFullscreen()` 恢复；
- 始终至少保留一个 `DockWidget`，不会出现空布局；
- XML 恢复时用 `splitHorizontal` / `splitVertical` 重建树。

### 2.3 DockWidget：每个叶子节点自带操作

- 每个 plot dock 自己有小工具栏：水平分割、垂直分割、全屏。
- 分割操作发生在具体 panel 上，不是全局切模式。
- 拖拽落点：
  - 拖到 panel 中央：合并成 tab 组；
  - 拖到 panel 边缘：按边缘方向分割；
  - 边缘显示落点预览。

### 2.4 借鉴结论

PlotJuggler 的布局是：

```text
Tab（场景）
  └─ Split Tree（分割树）
       ├─ Split
       │    ├─ Leaf（单个图）
       │    └─ Tabs（多个图）
       └─ Leaf
```

NetLab 应当采用同样的层级，而不是把布局压成一个 `LayoutMode` 枚举。

## 3. 当前实现与差距

### 3.1 工作台布局是全局枚举

`analysis_workbench_layout.ts:10-11`：

```ts
export type LayoutMode = 'grid' | 'tile' | 'split' | 'max';
export const WORKBENCH_LAYOUT_MODES: LayoutMode[] = ['grid', 'tile', 'split', 'max'];
```

`WorkbenchLayoutRec` 虽有 `rows`、`cols`、`order`（`analysis_workbench_layout.ts:26-31`），但：

- `order` 没有被使用；
- `rows` / `cols` 默认固定为 `1 / 1`（`analysis_workbench_layout.ts:47`）；
- `setLayout()` 只写 `root.dataset.layout`（`analysis_workbench_canvas.ts:139-144`）；
- `applyLayout()` 只同步全局模式（`analysis_workbench.ts:687-689`）；
- `persist()` 仍写入 `rows: 1, cols: 1, order: canvases.map(...)`（`analysis_workbench.ts:696-700`）。

结果是：所有画布只能处于同一种排列方式；切换模式会丢掉之前的局部布局。

### 3.2 画布 tile 没有局部操作

`analysis_workbench_canvas.ts:206-244` 的 tile 头只有标题、最大化、关闭：

- 没有水平/垂直分割；
- 没有拖拽合并 tab；
- 没有拖动排序；
- `max` 模式只是把所有非 active tile `display:none`（`style.css:2324-2325`），不是真正的单 tile 最大化，也没有恢复栈。

### 3.3 侧栏挤压画布区

工作台结构（`analysis_workbench.ts:64-82`）：

```text
.awb-body
  ├─ .awb-nav      默认 280px
  ├─ .awb-stage    剩余宽度
  └─ .awb-detail   默认 320px
```

默认窗口约 1180px 时，画布区只剩约 560px。再切两列分屏，每列约 280px，低于 tile 的 320px 最小宽度，图表会被压扁，坐标轴和 legend 挤在一起。

### 3.4 图表内部固定纵向子图

`analysis_chart.ts:512`：

```ts
figure: { subplots: panels, ncols: 1 }
```

PlotKit `render2d.ts:146-169` 的 `gridLayout()`：

- 只按 `ncols` / `nrows` 均分；
- 没有行/列权重；
- 没有 `rowSpan` / `colSpan`；
- 没有 per-cell 的最小尺寸或 aspect ratio。

### 3.5 电路自动布局停留在最长路径

`app.ts:2537-2607` 的 `autoLayout()`：

- 对所有节点初始化 `layer=0`，ground 置 0；
- 最多迭代 `min(48, nodes.length + 4)` 次，只做 `layer[target] = max(layer[target], layer[source] + 1)`；
- 没有环检测与破环；
- 没有跨层节点、虚拟节点；
- 没有交叉最小化；
- 节点顺序按旧 `y` 排序；
- 坐标直接 `x = (level - mid) * 276`、`y = (index - ...) * 128`，没有 Brandes-Köpf 对齐；
- 边仍是节点间直线，没有端口方向、避障或折线布线。

## 4. 目标设计：工作台多画布布局

### 4.1 两级模型

```text
WorkbenchLayout
  ├─ Tab：频域分析
  │    └─ LayoutNode：split(row, 0.58)
  │         ├─ canvas：Bode
  │         └─ split(column, 0.5)
  │              ├─ canvas：Nyquist
  │              └─ tabs：阶跃 / 误差
  ├─ Tab：时域分析
  │    └─ LayoutNode：canvas：阶跃响应
  └─ Tab：自定义
```

### 4.2 LayoutNode

新增 `frontend/app/analysis_workbench_layout_tree.ts`：

```ts
export type LayoutNode =
  | { type: 'canvas'; canvasId: string }
  | {
      type: 'split';
      axis: 'row' | 'column';
      ratio: number;
      first: LayoutNode;
      second: LayoutNode;
    }
  | { type: 'tabs'; active: string; children: LayoutNode[] }
  | { type: 'auto'; canvasIds: string[] };

export interface WorkbenchTabRec {
  id: string;
  title: string;
  root: LayoutNode;
}

export interface WorkbenchLayoutRecV2 {
  schema: 'netlab-analysis-workbench/2';
  tabs: WorkbenchTabRec[];
  activeTab: string;
  sizes: { sidebar: number; detail: number };
  collapsed: { sidebar: boolean; detail: boolean };
}
```

说明：

- `split.ratio` 只表示第一个子节点占比，第二个为 `1 - ratio`；默认 `0.5`，限制在 `0.15 ~ 0.85`。
- `tabs.children` 可以是任意 `LayoutNode`，但第一阶段建议只允许 `canvas` 叶子，降低嵌套复杂度。
- `auto` 仅用于兼容旧 `grid/tile` 工程；新布局不再主动创建 `auto`。
- `max` 不再是布局模式，改为运行时的 `maximized: { tabId, canvasId, previousRoot }`。

### 4.3 迁移策略

1. `WORKBENCH_SCHEMA` 从 `netlab-analysis-workbench/1` 升到 `/2`。
2. `readWorkbenchUi()` 遇到旧 `layout.mode`：
   - `grid` / `tile` → 生成一个 `auto` 根节点；
   - `split` → 生成一个平衡的 `split` 树；
   - `max` → 生成原来的 `auto` 树，并把 `maximized` 置空，避免打开就只剩一个 tile。
3. `writeWorkbenchUi()` 写 v2 树；旧的 `rows/cols/order` 只作为迁移输入，不再作为运行时状态。
4. 读取时做 `normalize()`：删除不存在的 `canvasId`、合并空节点、修正非法比例、保证每个 tab 至少一个 canvas。

### 4.4 渲染结构

```text
.awb-workbench
  ├─ .awb-workbench-tabs
  │    └─ .awb-workbench-tab[data-active]
  ├─ .awb-workbench-body
  │    ├─ .awb-nav（可折叠）
  │    ├─ .awb-stage
  │    │    └─ .awb-layout-root
  │    │         ├─ .awb-split[data-axis="row"]
  │    │         │    ├─ .awb-pane
  │    │         │    ├─ .awb-splitter
  │    │         │    └─ .awb-pane
  │    │         └─ .awb-tabs
  │    │              ├─ .awb-tabstrip
  │    │              └─ .awb-tabpanel
  │    └─ .awb-detail（可折叠）
```

递归渲染伪代码：

```ts
function renderNode(node: LayoutNode): HTMLElement {
  switch (node.type) {
    case 'canvas':
      return this.entries.get(node.canvasId)!.tile;
    case 'split': {
      const el = div('awb-split');
      el.dataset.axis = node.axis;
      const first = div('awb-pane');
      first.style.flexGrow = String(node.ratio);
      first.append(renderNode(node.first));
      const second = div('awb-pane');
      second.style.flexGrow = String(1 - node.ratio);
      second.append(renderNode(node.second));
      el.append(first, splitter(node, first, second), second);
      return el;
    }
    case 'tabs':
      return this.renderTabs(node);
    case 'auto':
      return this.renderAuto(node.canvasIds);
  }
}
```

### 4.5 交互规则

#### 4.5.1 分割

- tile 头 `⋯` 菜单：水平分割、垂直分割、复制、移动到新 tab、最大化/恢复、关闭。
- 新分割默认均分（`EqualSplitOnInsertion`）；
- 已有兄弟节点比例不变；
- 每个 pane 最小 `240 × 180`；小于最小尺寸时提示先最大化，或自动把新节点放进 tab。
- 分割线 6px，支持 pointer capture、双击 50/50、键盘方向键微调。

#### 4.5.2 拖拽

- 拖动 tile 标题栏；
- 落点判定：
  - 左/右边缘 25% → 水平分割；
  - 上/下边缘 25% → 垂直分割；
  - 中央 → 合并为 tab；
- 半透明蓝色落点预览，`Esc` 取消；
- 拖拽完成后调用纯函数 `splitLeaf()` / `moveToTab()`，不直接改 DOM 数据结构。

#### 4.5.3 Tab

- tab strip 横向滚动；
- 拖动排序；
- 双击标题改名；
- 右键复制（复制整棵子树）；
- 关闭 tab 后切到相邻 tab；
- 关闭最后一个 tab 时，当前节点折叠为单个 canvas。

#### 4.5.4 最大化与专注模式

- tile 最大化：保存当前 tab 的 `root` 和所有 split 比例，只渲染当前 leaf；退出恢复。
- 工作台专注模式：隐藏导航/详情，仅保留画布区；`Esc` 退出。
- 工作台整体最大化继续复用 `float.ts` 的浮窗最大化，不重复实现。

#### 4.5.5 侧栏响应式

- 导航/详情支持折叠成 40px 图标栏；
- 工作台宽度 < 1100px 时，详情从固定列改为抽屉浮层；
- 画布区 `min-width: 520px`；
- 折叠状态写入 `collapsed`。

### 4.6 持久化

- 布局树写入工程 `ui.analysis_workbench`；
- 侧栏宽度、折叠状态、tab 顺序、split 比例一并保存；
- 不把图表的临时结果或分析参数写进布局树；
- 读取失败或版本不认识时回落到默认布局，并提示一次。

## 5. 目标设计：PlotKit 子图 GridSpec

### 5.1 新增 FigureGrid

`render2d.ts` 的 `FigureSpec` 增加可选字段：

```ts
interface FigureGrid {
  rows?: number[];       // 行权重，例如 [1, 1.2]
  cols?: number[];       // 列权重，例如 [1.4, 1]
  gapX?: number;         // 可选，默认 26
  gapY?: number;         // 可选，默认 30
  cells?: Array<{
    slot: number;
    row: number;
    col: number;
    rowSpan?: number;
    colSpan?: number;
  }>;
}
```

### 5.2 gridLayout 改造

当前逻辑：

```ts
const cw = Math.max(1, (W - left - right - gapX * (ncols - 1)) / ncols);
const ch = Math.max(1, (H - top - bottom - gapY * (nrows - 1)) / nrows);
```

改为：

1. 计算列权重总和与行权重总和；
2. 按权重分配 `colWidths[]` / `rowHeights[]`；
3. 每个 cell 根据 `row/col/rowSpan/colSpan` 计算矩形；
4. 没有 `grid` 时保持现有均分行为，确保旧图完全不变；
5. 每个子图仍使用已有的 `ctx.save() + rect(box) + clip() + restore()`，防止曲线越出网格。

### 5.3 图表 UI

`analysis_chart.ts` 将 `canvas.view_state.subplot_layout` 传给 PlotKit：

```ts
figure: {
  subplots: panels,
  ncols: layout?.ncols ?? 1,
  grid: layout?.grid,
}
```

图表 tile 菜单增加：

- 纵向（默认）
- 横向
- 2×2
- 自适应

窄 tile 自动回落纵向；宽 tile 才提供横向/网格选项。

## 6. 目标设计：电路/信号流自动布局

> 本节是独立专项，不阻塞工作台布局第一批交付；建议在 P3 之后实施。

### 6.1 目标管线

```text
SceneGraph
  → 构建 LayoutGraph（节点/边/端口）
  → 环检测（Tarjan SCC）
  → 破环（反馈边反转）
  → 分层（longest path / network simplex）
  → 层内排序（median + transpose，减少交叉）
  → 坐标分配（Brandes-Köpf + 节点宽度）
  → 正交避障布线（A* / visibility graph）
  → 写回 position + edge path
```

### 6.2 环处理

- 用 `Tarjan SCC` 找出强连通分量；
- 对每个 SCC 用 DFS 回边 + Eades-Lin-Smyth 启发式选择反馈边；
- 排序时反转反馈边，绘制时保留原始箭头方向；
- 对纯 DAG 直接进入分层。

### 6.3 分层

- 初始 `rank = 0`；ground / 独立源作为锚点；
- 最长路径分层作为快速基线；
- 可选 network simplex 最小化总边长；
- 对跨层边插入虚拟节点，参与排序和坐标分配；
- 多连通分量按包围盒打包，避免重叠。

### 6.4 交叉最小化

- 初始化顺序：旧位置或节点名；
- 4 轮 barycenter / median 上下扫描；
- 相邻节点 transpose，若交叉数下降则交换；
- 稳定 tie-break：旧 y → 节点名 → id，保证可重复。

### 6.5 坐标分配

- 使用 Brandes-Köpf 四向对齐（left/right/up/down）取宽度最小的方案；
- 节点宽度、端口位置、边标签参与间距计算；
- 同层节点最小间距 `nodeGap`，层间距 `rankGap`；
- 结果限制在画布安全区域内，必要时整体平移。

### 6.6 正交避障布线

- 节点包围盒作为障碍物；
- 端口按信号方向选择左/右/上/下；
- A* 在栅格或 visibility graph 上寻路，转弯惩罚高于长度惩罚；
- 找不到路径时退化为两段折线；
- 边与节点、边与边保持最小间距；
- 支持正交折线 / 平滑曲线两种样式，默认正交。

### 6.7 UI

`自动布局` 菜单改为：

```text
自动布局
  ├─ 信号流（左→右）
  ├─ 电路（上→下，ground 在下）
  ├─ 紧凑
  ├─ 宽松
  └─ 布局选项…
```

应用前保存快照，失败可撤销；布局只修改节点 position / edge path，不修改网表。

## 7. 文件改造清单

| 文件 | 改动 |
| --- | --- |
| `frontend/app/analysis_workbench_layout_tree.ts`（新增） | LayoutNode 纯函数、normalize、serialize/deserialize、split/remove/tabs/maximize |
| `frontend/app/analysis_workbench_layout.ts` | schema v2、迁移旧 LayoutMode、WorkbenchTabRec |
| `frontend/app/analysis_workbench_canvas.ts` | 递归渲染、split/tab/auto、tile 菜单、splitter、拖拽落点 |
| `frontend/app/analysis_workbench.ts` | applyLayout 接树、persist v2、侧栏折叠/专注模式 |
| `frontend/app/analysis_workbench_actions.ts` | 布局预设按钮、新建 tab、分割/合并动作 |
| `frontend/app/analysis_chart.ts` | 透传 `figure.grid`、子图排列菜单、ResizeObserver |
| `frontend/style.css` | .awb-split/.awb-splitter/.awb-tabs/.awb-workbench-tabs、响应式 |
| `../analysis-wb-plotkit/src/plotkit/static/render2d.ts` | FigureGrid、权重、span、兼容旧 ncols |
| `frontend/app.ts` | autoLayout 改调用 `graph_layout.ts`、布局选项 |
| `frontend/app/graph_layout.ts`（新增） | Sugiyama 分层、排序、坐标、正交布线 |
| `frontend/e2e/workbench_layout.mjs`（新增） | 工作台布局 e2e |
| `frontend/e2e/graph_layout.mjs`（新增） | 电路自动布局 e2e/指标 |

## 8. 实施阶段

### P0：布局数据层（0.5～1 天）

- 新增 `analysis_workbench_layout_tree.ts`；
- 完成 `splitLeaf / removeLeaf / moveToTab / maximize / normalize / serialize`；
- 单元测试覆盖：空树、单 leaf、多层 split、关闭 leaf、tab 关闭、非法比例、未知 canvasId。

### P1：工作台骨架（1～2 天）

- `AnalysisCanvasWorkspace` 改递归渲染；
- tile 菜单支持水平/垂直分割；
- splitter 拖动、双击 50/50；
- tab 组、拖动排序、中央落点合并；
- 旧 `grid/tile/split/max` 映射为布局预设；
- `persist()` 写 v2 树。

### P2：响应式与专注模式（0.5～1 天）

- 侧栏折叠/抽屉；
- 工作台宽度变化重新布局；
- `ResizeObserver` 驱动图表；
- 小尺寸 tile 的 compact 样式；
- tile 最大化/恢复。

### P3：PlotKit GridSpec（1 天）

- `FigureGrid` 权重与 span；
- `analysis_chart` 子图排列菜单；
- 回归所有现有图表类型；
- 截图对比纵向/横向/2×2。

### P4：电路自动布局（2～3 天，独立分支）

- `graph_layout.ts` 分层 + 排序 + 坐标；
- 正交避障布线；
- 布局选项菜单与撤销；
- 指标对比和性能测试。

## 9. 验收标准

### 9.1 工作台

- 4 个画布做 2×2，拖动比例后刷新/重开工程，树和比例完全恢复。
- 分割后关闭一个 leaf，兄弟节点填满，无空白、无 0 尺寸 pane。
- 拖到另一个 tile 中央形成 tab 组，切换 tab 后各自结果不串。
- tile 最大化再恢复，布局树、比例、tab 活动项一致。
- 1024px 宽度下侧栏折叠，画布区无横向滚动，图表可读。
- 原有 `workbench_analysis`、`float_window_ux`、`plotkit_clip` e2e 全部通过。

### 9.2 PlotKit

- 2×2 子图无重叠、无越界绘制；
- 权重列/行尺寸符合预期；
- `rowSpan/colSpan` 子图覆盖正确；
- 旧图表（无 `grid`）像素结果不回归；
- 小尺寸 tile 不出现负宽高或 axis 重叠。

### 9.3 电路自动布局

- 无环图：分层正确、无节点重叠；
- 有环图：能正确破环，不出现无限迭代；
- 交叉数相对当前实现显著下降（基准对比记录，不劣化）；
- 边不穿过节点包围盒（正交避障）；
- 200 节点规模布局时间目标 < 150ms（实测记录）；
- 布局失败可撤销，原位置完整恢复。

## 10. 风险与取舍

1. **迁移风险**：旧工程只有 `mode/rows/cols/order`，无法还原用户没有保存过的分割比例；迁移时按预设生成，不伪造历史。
2. **交互复杂度**：拖拽落点、tab 合并、关闭 leaf 的边界很多；必须用纯函数 + 单元测试先固定行为，再接 DOM。
3. **小尺寸可用性**：最小 pane 设为 `240×180`，低于此值时自动降级为 tab，避免“看起来分了但看不见”。
4. **PlotKit 兼容**：`grid` 必须是可选字段，默认路径完全不变；先加渲染测试再改图表 UI。
5. **自动布局语义**：电路图有 ground / 端口方向 / 器件符号约束，不能只按普通 DAG 处理；先做信号流，再扩展电路模式。
6. **性能**：递归渲染和 splitter 拖动不要每次重绘全部图表；用 `requestAnimationFrame` 合并尺寸更新。

## 11. 开放问题

1. 工作台顶层 tab 是否按“分析类型”固定生成，还是完全由用户创建？
2. 布局树保存在工程文件还是用户偏好（localStorage）？建议工程文件优先，便于分享。
3. 电路自动布局的端口方向和器件符号边界，是否需要后端提供端口元数据？
4. PlotKit 的 `rowSpan/colSpan` 是否需要支持不等宽子图内的坐标轴对齐？
5. 是否需要在布局切换时做过渡动画？第一版建议不做，避免干扰拖拽。

## 12. 结论

优先做工作台布局树，这是当前最影响使用体验、且风险最低的一刀：

- 用 `LayoutNode` 替换全局 `LayoutMode`；
- 用 tab + split tree 替换扁平 grid；
- 用 v2 持久化替换 `rows:1, cols:1`；
- 用局部 tile 菜单替换全局布局下拉。

PlotKit GridSpec 和电路 Sugiyama 自动布局分别作为后续独立专项推进，避免一次改动同时触碰 UI、渲染和图形算法。
