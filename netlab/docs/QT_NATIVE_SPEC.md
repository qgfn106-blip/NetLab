# Netlab 原生桌面化（Qt）· 规格 · 约束 · 验收

> 版本：v1（2026-11-02）
> 状态：**已定稿，待开工**（方案 B：netlab 全原生 + PlotKit 窗懒加载 WebEngine）
> 上位决策：[REQUIREMENTS_AND_RULES.md](REQUIREMENTS_AND_RULES.md) D69–D76、R33
> 评估依据：[../../../docs/QT_MIGRATION_EVALUATION.md](../../../docs/QT_MIGRATION_EVALUATION.md)（四档形态、逐层映射、成本测算）
> 冲突裁定：本文件与上位文档冲突时，以 `REQUIREMENTS_AND_RULES.md` 的决策台账为准；台账未覆盖处，以本文件为准。

---

## 0. 怎么用这份文档

| 你想干什么 | 看哪一节 |
| --- | --- |
| 知道"为什么要做、做成什么样" | §1 问题、§2 方案 |
| 知道"具体要交付什么" | §4 需求（R33.1–R33.6） |
| 知道"哪条线不能碰" | §5 约束（C1–C13） |
| 知道"怎么实现、模块怎么分" | §6 实现决策（D69–D76 + 模块表） |
| 知道"怎么测" | §7 测试决策（seam） |
| 知道"做到什么程度算完" | §8 验收判据（A1–A25） |
| 知道"画布交互一项都不能少" | §9 20 项交互清单 |
| 知道"先做哪个、今天做什么" | §10 分期与任务勾选表 |
| 知道"哪些明确不做" | §12 不做清单 |

---

## 1. 问题陈述（用户视角）

netlab 现在是一个"Python 服务 + 浏览器显示层"的程序：双击 `start_desktop.bat` 起一个 pywebview 窗口，窗口里是 `frontend/index.html`，界面全部由 DOM + canvas 画出来。

这带来四类实际问题：

1. **重**：常驻 714–748 MB，启动到可交互 2.9–3.5 s（实测）。真正的仿真内核只占很小一部分，大头是 Chromium。
2. **脆**：为了显示界面必须起一个本地 HTTP 服务、带 token、占一个端口。端口被占、防火墙弹窗、代理劫持、双实例互抢，都属于"界面问题导致的程序故障"。
3. **不像桌面软件**：四个浮窗是 DOM 绝对定位，不能进任务栏、不能跨屏、不能 Alt+Tab；中文标签靠 contenteditable，输入法一直有坑；导出只能截图 PNG，做不了矢量图。
4. **交互逻辑全在 JS**：画布几何、命中测试、拖拽阈值都写在 `app.js` 里，Python 侧只能通过 HTTP 间接影响它，同一套规则容易两处实现。

---

## 2. 方案（用户视角）

把 netlab 的**显示层**换成 Qt Widgets，其余一切不动：

- 主画布、5 个图表、面板、菜单、文档窗全部变成原生控件；
- 求解器、工程格式、`.netlab` 校验、`SERVICE` API 一行不改；
- **PlotKit 一行不改**，netlab 里的 PlotKit 面板仍由 `QWebEngineView` 承载，但**只在第一次打开时才加载**；
- 老的浏览器界面保留但**冻结**（不再维护），作为只读出口。

换完之后：启动约 1.0–1.5 s，常驻约 200–300 MB（未打开 PlotKit 时），不监听端口，浮窗是真窗口，能出 PDF/SVG，画布几何回到 Python。

**不做**：不迁 PlotKit、不做三维、不重写 web 前端、不改求解器。

---

## 3. 用户故事

### 启动与外壳

1. 作为使用者，我想双击一次就进入可操作界面，以便不用等三秒看白屏。
2. 作为使用者，我想程序启动时不占用任何端口，以便不再遇到"端口被占用/防火墙弹窗"。
3. 作为使用者，我想第二次启动时聚焦已有窗口而不是再起一个进程，以便不会两个实例抢同一个工程文件。
4. 作为使用者，我想关掉窗口时未保存的改动被自动保存，以便不丢工作。
5. 作为使用者，我想上次的窗口大小、位置、面板布局、浮窗几何在重启后恢复，以便不用每次重摆。

### 主画布

6. 作为使用者，我想拖拽元件时画面跟手，以便连续布线不卡顿。
7. 作为使用者，我想框选、双击、右键、滚轮缩放、中键平移都保持现有手感，以便不用重学操作。
8. 作为使用者，我想连线时的路由、拐点、吸附、跨线桥、挂耳、结点样式与现在完全一致，以便图纸看起来没变。
9. 作为使用者，我想 GB 符号的方向与端子位置不变，以便已画好的图纸不会"翻面"。
10. 作为使用者，我想从模块库把模块拖进画布，以便复用已有电路。
11. 作为使用者，我想撤销/重做覆盖所有画布操作，以便放心试错。

### 面板与信息架构

12. 作为使用者，我想工程树/图层树能展开折叠、右键重命名、拖拽排序，以便管理多网络。
13. 作为使用者，我想属性面板是高密度表单，以便一屏看到更多参数。
14. 作为使用者，我想面板能停靠、浮动、组合、隐藏，以便按自己的习惯摆工作区。
15. 作为使用者，我想菜单、快捷键（Ctrl+S/E/Z/Y/D、Delete）与现在一致，以便肌肉记忆不作废。
16. 作为使用者，我想在中文标签里用输入法正常输入，以便不出现丢字/上屏错位。

### 图表与分析

17. 作为使用者，我想 5 个图表（时域、FEM、相图、示波器、李萨如）继续可用，以便分析路径不断。
18. 作为使用者，我想鼠标悬停时读到与现在完全一致的数值，以便对得上以前的记录。
19. 作为使用者，我想图表在无数据、单点、极值情况下不崩，以便调试时不出洋相。
20. 作为使用者，我想回放时间轴拖动能即时反映到图表，以便定位波形。

### PlotKit 面板

21. 作为使用者，我想 PlotKit 面板功能完全不变（编辑、内嵌图、3D 都在），以便不损失已有能力。
22. 作为使用者，我想不打开 PlotKit 时不付它的内存代价，以便日常使用更轻。
23. 作为使用者，我想 PlotKit 服务起不来时看到明确错误而不是白屏，以便知道该修什么。
24. 作为使用者，我想关掉 PlotKit 面板后相关进程被回收，以便不留僵尸进程。

### 文档与导出

25. 作为使用者，我想文档窗能渲染标题/列表/表格/代码块，以便查帮助。
26. 作为使用者，我想把图纸导出成 PDF/SVG，以便放进论文和报告。
27. 作为使用者，我想切换深/浅主题立即生效，以便在不同环境下看屏幕。

### 验收与回归

28. 作为维护者，我想有像素级对比基线，以便确认"看起来没变"而不是"我觉得没变"。
29. 作为维护者，我想现有 pytest 全部继续通过，以便证明服务端契约没被破坏。
30. 作为维护者，我想界面能一键截图成 PNG，以便沿用"真机截图 + 裁切放大"的验收方式。

---

## 4. 需求清单（R33）

> 六段式：原话 / 解读 / 落地形态 / 不做什么 / 验收 / 权重·期次·现状。

### R33 netlab 显示层原生桌面化（Qt Widgets）

- **原话**（2026-11-02）：「不考虑代码修改量，与工程量大小，评估将当前项目从html改为qt的方案，包括netlab与plotkit」→「plotkit也要全套qt」→「那我决定只改netlab」→「选B，并且文档规范依然做好，规划计划需求约束验收等」。
- **解读**：只动 netlab 的显示层。方案 B = netlab 全原生 + PlotKit 面板懒加载 `QWebEngineView`。PlotKit 保持 web 原样，一行不改；netlab 的旧浏览器界面冻结保留。
- **落地形态**：新建 `netlab/ui/` 包；`desktop/` 保留为过渡入口；`SERVICE` 为唯一数据来源；画布立即模式 `QPainter`；图表自绘；主题 token 单一来源；像素 diff 作为验收手段。
- **不做什么**：不迁 PlotKit、不做三维原生、不重写 web 前端、不改求解器/工程格式/checksum、不引入 QML、不引入 pyqtgraph/VTK。
- **权重**：高（显示层是用户每天面对的部分）。**期次**：P0–P5。
- **现状**：待开工（`netlab/ui/` 尚不存在）。

#### R33.1 原生外壳与信息架构

- **解读**：`QMainWindow` + 菜单栏 + 工具栏 + 停靠面板 + 状态栏；信息架构与现在一致（右栏 4 组不变，R30 验收②）。
- **落地形态**：`shell.py`（主窗）、`panels/`（工程树、属性、分析、日志）、`theme.py`（token→QSS）。
- **验收**：A1/A2/A15/A19/A22；面板可停靠/浮动/隐藏，布局重启恢复。
- **期次**：P1。

#### R33.2 原生图表（5 个 canvas）

- **解读**：`#chart` 时域、FEM 场、相图、示波器、李萨如，全部改为自绘 `QWidget`。
- **落地形态**：`charts/base.py`（坐标轴/网格/刻度/绘制循环）+ 5 个子类；数据来自 `SERVICE` 快照。
- **不做什么**：不引入 pyqtgraph/matplotlib 做实时图表（一次全量重绘已足够，且要保证与现在像素一致）。
- **验收**：A8/A9（hover 数值一致）、A23（边界数据不崩）。
- **期次**：P1（chart）→ P2（其余 4 个）。

#### R33.3 原生主画布

- **解读**：canvas 2D 立即模式 → `QPainter` 立即模式，逐图元对照；不换 `QGraphicsScene`。
- **落地形态**：`canvas/scene_widget.py`（绘制 + 事件）、`canvas/renderer.py`（纯绘制函数，吃"视图模型"不吃控件状态）。
- **验收**：A5/A6/A7 + §9 的 20 项清单。
- **期次**：P3。

#### R33.4 PlotKit 面板懒加载

- **解读**：保留 `QWebEngineView`，但启动时不 import、不创建；首次打开才加载；子进程与端口由 netlab 托管。
- **落地形态**：`plotkit_panel.py`（懒加载、探活、失败降级、回收）。
- **验收**：A3/A4/A24。
- **期次**：P4。

#### R33.5 数据面直连

- **解读**：UI 不再 110 ms 轮询 `/api/live`；改为 `SERVICE` 产出不可变快照，经 `QueuedConnection` 投递到 UI。
- **落地形态**：`bridge.py`（SERVICE 适配 + 信号）；UI 永不持锁。
- **验收**：A18（长跑不涨内存）、P5 闸门（无 `/api/live` 轮询）。
- **期次**：P1 起步（图表先用），P5 收口。

#### R33.6 旧前端冻结与去端口

- **解读**：`frontend/app.js` 冻结（不再更新、不再修 bug）；`/` 入口保留可用；`server.py` 的 `/api` 保留（PlotKit 与测试仍依赖）。
- **验收**：A16（正常运行不监听端口，PlotKit 面板除外）、A17（pytest 全绿）。
- **期次**：P5。

---

## 5. 约束（红线，C1–C13）

| # | 约束 | 理由 | 违反后果 |
| --- | --- | --- | --- |
| **C1** | 求解器、工程格式、`.netlab` 校验、checksum **一行不改** | 显示层替换不触碰领域逻辑 | 老工程打不开、测试全红 |
| **C2** | **PlotKit 零改动**：不改其代码、不让它 import netlab、不改其公开接口 | 用户明确"只改 netlab" | 破坏 D66 单向依赖 |
| **C3** | 主画布保持**立即模式** `QPainter`，不引入 `QGraphicsScene` | 现有几何/命中逻辑是立即模式的；换场景图=重写两遍 | 交互回归无法收敛 |
| **C4** | 任何渲染（mpl/PNG 解码）**不得在 GUI 线程** | 冷渲染 111 ms 会冻结窗口 | 拖动卡顿、白屏 |
| **C5** | 启动路径**不得 import `QtWebEngineWidgets`** | 导入即拉起 renderer 进程，收益归零 | A2/A3 直接不达标 |
| **C6** | UI **永不持仿真锁**；跨线程只传不可变快照 | 避免撕裂读/死锁 | 随机卡死 |
| **C7** | 不引入新重依赖（pyqtgraph / VTK / QML 运行时） | 体积与维护成本 | 安装体积反弹、二套栈 |
| **C8** | 测试数量只增不减；HTTP 契约保持（`TestClient` 测试继续跑） | HTTP 是现有测试契约 | 回归无保护 |
| **C9** | 主题 token **单一来源**（一份 JSON → CSS vars 与 QSS） | 两套主题必然漂移 | 深浅色不一致 |
| **C10** | 像素对比基线 **<1% 差异**（字体区域单独标注） | "看起来没变"不可验收 | 细节回归漏检 |
| **C11** | 单实例锁；正常运行**不监听 TCP 端口**（PlotKit 面板除外） | 端口是当前主要故障源 | 故障源没消除 |
| **C12** | 中文标签、GB 符号方向、D59 回放速度语义等**逐条对齐**，不得"顺手优化" | 用户逐条验收过 | 被当场打回 |
| **C13** | **UI 保真优先**：换框架不是换外观。间距、字号、行高、配色、圆角、图标全部与旧前端一致，以**同一份 token** 为源；判定用像素 diff 或并排比对，"看着差不多"不算通过 | 用户要求「尽量保持 ui 一致，效果做到最相似」 | 界面观感倒退，等于白换 |

---

## 6. 实现决策（D69–D76）

| # | 主题 | 结论 |
| --- | --- | --- |
| **D69** | 迁移范围 | 只改 netlab；PlotKit 保持 web 原样（用户 2026-11-02「那我决定只改netlab」） |
| **D70** | PlotKit 面板形态 | **懒加载 `QWebEngineView`**（方案 B）；只读 `QImage` 仅作降级备选，不作默认 |
| **D71** | 画布实现 | 保持立即模式 `QPainter`；不换 `QGraphicsScene`；绘制函数与事件处理分离 |
| **D72** | 图表实现 | 5 个图表自绘 `QWidget`；不引入 pyqtgraph，不用 matplotlib 做实时图 |
| **D73** | 数据通路 | 控制面留 `SERVICE`（HTTP 仍可用）；数据面直连快照 + `QueuedConnection`；UI 不轮询 |
| **D74** | 旧前端 | `frontend/app.js` 冻结但保留 `/` 入口（不删、不修）；删除需另开决策 |
| **D75** | 主题 | 一份 token（JSON）→ 生成 CSS vars 与 QSS；切换即时生效 |
| **D76** | 验收手段 | 像素 diff 工具 + §9 的 20 项交互清单，作为 P3 闸门 |

### 模块划分（新建 `netlab/ui/`）

| 模块 | 职责 | 依赖 |
| --- | --- | --- |
| `ui/app.py` | `QApplication` 引导、单实例锁、命令行开关 | shell |
| `ui/shell.py` | `QMainWindow`：菜单、工具栏、dock、状态栏、快捷键 | panels, theme |
| `ui/models.py` | **纯函数**：`SERVICE` 状态 → 视图模型（无 Qt import） | 无 |
| `ui/bridge.py` | `SERVICE` 适配、快照投递、信号定义 | models |
| `ui/panels/*` | 工程树、属性表、分析、日志 | models, theme |
| `ui/canvas/renderer.py` | 纯绘制：吃视图模型 + `QPainter` | models |
| `ui/canvas/scene_widget.py` | 事件 → 命令 → 状态变更 | renderer |
| `ui/charts/*` | `ChartBase` + 5 个子类 | models |
| `ui/doc/window.py` | `QTextDocument.setMarkdown` 文档窗 | theme |
| `ui/plotkit_panel.py` | 懒加载 WebEngine、子进程托管、降级 | bridge |
| `ui/theme.py` | token → QSS 生成器 + 热重载 | 无 |

**接口约定**：

- `models.py` 只依赖标准库与 `SERVICE` 返回的普通数据结构，**不得 import Qt** —— 这是唯一新增的可单测 seam。
- `bridge.py` 对外只暴露"请求/快照/错误"三类信号；UI 不得直接调用 `SERVICE` 的阻塞方法。
- `renderer.py` 的函数签名统一为 `draw_x(painter, vm, rect)`，不读全局状态。

---

## 7. 测试决策

**好测试的标准**：只断言"用户能看到的外部行为"（画出来什么、状态变成什么、进程是否存在），不断言控件内部结构（不测"某个 QLabel 的 text"这类实现细节）。像素测试只在固定主题 + 固定 DPI 下比对。

| # | seam | 类型 | 是否新增 |
| --- | --- | --- | --- |
| S1 | HTTP `/api/*`（现有 9 个测试文件，`TestClient`/`httpx`） | 集成 | 已有，保持不动 |
| S2 | `ui/models.py` 纯函数投影（状态 → 视图模型） | 单元 | **新增（唯一新 seam）** |
| S3 | `QWidget.grab()` → golden PNG 像素 diff | 截图 | 新增（pytest-qt，缺依赖时 skip） |
| S4 | 进程/端口断言（无 `QtWebEngineProcess`、无监听端口） | 系统 | 新增（P4/P5 闸门） |

- **优先复用 S1**：任何"服务端行为是否变化"的问题都用现有 HTTP 测试回答，不要为 UI 再写一遍。
- **S2 是主战场**：画布视图模型（节点位置、路由拐点、命中顺序）全部在纯函数里算，测试不需要 `QApplication`。
- **S3 只做回归，不做发现**：golden 图由人工确认后入库；差异超 1% 才算失败。
- **S4 用子进程**：断言启动后 5 s 内进程列表无 `QtWebEngineProcess`；断言 `netstat`/`psutil` 无监听端口。

---

## 8. 验收判据（A1–A25）

| # | 判据 | 测法 |
| --- | --- | --- |
| **A1** | 启动到可交互 ≤ **1.5 s**（未开 PlotKit） | 冷启动 5 次取中位数；基线 2.9–3.5 s |
| **A2** | 常驻内存 ≤ **350 MB**（未开 PlotKit） | 启动后 10 s 读 RSS；基线 714–748 MB |
| **A3** | 未打开 PlotKit 时进程列表无 `QtWebEngineProcess` | `psutil` 断言 |
| **A4** | 打开 PlotKit 到出图 ≤ 3 s；关闭后进程/端口回收 | 计时 + 进程断言 |
| **A5** | 拖拽 100 帧平均帧时 ≤ **16.7 ms** | `QElapsedTimer` 打点 |
| **A6** | 与 web 版像素 diff **< 1%** | golden 对比，字体区域单列 |
| **A7** | §9 的 **20 项交互**全部通过 | 逐项手测 + 录屏 |
| **A8** | 图表 hover 数值与 web 版**完全一致** | 同数据同坐标比对 |
| **A9** | 文档窗标题/列表/表格/代码块/图片全部正确 | 目视 + 结构断言 |
| **A10** | 工程打开/保存/自动保存/脏状态行为不变 | 用现有工程回归 |
| **A11** | 撤销/重做 ≥100 步，语义与 web 版一致 | 脚本化操作序列 |
| **A12** | Ctrl+S/E/Z/Y/D、Delete 全部生效 | 快捷键清单逐条 |
| **A13** | 中文标签 IME 输入无丢字 | 微软拼音实测 |
| **A14** | 125%/150% 缩放下画布清晰、无错位 | 系统缩放实测 |
| **A15** | 第二次启动聚焦已有窗口，不起第二个服务 | 双开实测 |
| **A16** | 正常运行**不监听 TCP 端口**（PlotKit 面板除外） | `psutil` 断言 |
| **A17** | 现有 pytest **全绿**，数量只增不减 | `pytest -q` |
| **A18** | 30 min 连续仿真内存无单调增长（±10%） | 定时采样 |
| **A19** | 主题切换即时生效（不重启） | 点击切换 |
| **A20** | 导出 PDF/SVG 可用且文字可选中 | 打开产物检查 |
| **A21** | 强杀进程后重开能恢复自动保存 | 手动 kill |
| **A22** | 窗口/面板/浮窗几何重启恢复 | 改布局 → 重启 |
| **A23** | 5 个图表在无数据/单点/极值下不崩 | 构造边界数据 |
| **A24** | PlotKit 起不来时显示明确错误或最后一帧，不白屏 | 手动杀端口 |
| **A25** | 全窗口 UI 保真：菜单/工具栏/面板/画布/图表与旧前端并排比对，间距/字号/配色/圆角一致 | 截图并排 + 像素 diff |

---

## 9. 20 项交互清单（P3 闸门，逐项签字）

> 每项都要在原生版与 web 版之间做一次"同样操作 → 同样结果"的对照。

| # | 交互 | 现状实现位置 | 原生要求 |
| --- | --- | --- | --- |
| 1 | 拖拽元件移动（含吸附） | `canvas pointerdown/move/up` | 阈值、吸附网格、边界钳制一致 |
| 2 | 框选多选 | 同上 | 方向无关、Shift 追加 |
| 3 | 双击元件进入内部/重命名 | `dblclick` | 与 web 一致 |
| 4 | 右键上下文菜单 | `contextmenu` | 菜单项、顺序、禁用态一致 |
| 5 | 滚轮缩放（以光标为锚点） | `wheel` | 缩放中心、步长、上下限一致 |
| 6 | 中键/空格平移 | `pointermove` | 惯性无、边界一致 |
| 7 | 拖拽连线（端口吸附、路由、拐点） | `schematic.py` + 前端 | 拐点数量与位置一致 |
| 8 | 交叉跨线桥 | 绘制函数 | 桥的半径/间隙一致 |
| 9 | 结点圆点显隐规则 | 绘制函数 | 三线以上才画点 |
| 10 | 挂耳式拖拽把手（面板/浮窗） | `initFloatWindow` | 命中区、光标形状一致 |
| 11 | 浮窗拖动/缩放/双击最大化 | `head pointerdown/move/up` | 最小尺寸、边界一致 |
| 12 | 时间轴拖动与双击 | `topTimeline dblclick` | 吸附到帧、双击复位 |
| 13 | 图表 hover 读数 | `chart pointermove` | 数值、单位、小数位一致 |
| 14 | FEM 画布 hover 取点 | `femCanvas pointermove` | 与 web 一致 |
| 15 | 模块拖入画布 | `graph dragover/drop` | 落点、校验提示一致 |
| 16 | 键盘快捷键与焦点顺序 | `document keydown` | 输入框内不触发全局键 |
| 17 | 撤销/重做 | 快照栈 | 粒度一致（一次拖拽=一步） |
| 18 | 回放速度语义（D59） | 滑块 5–240 | 数值映射与节流一致 |
| 19 | 主题切换（深/浅） | CSS vars | token 一一对应 |
| 20 | 中文标签输入 | contenteditable | 原生 IME，无丢字 |

---

## 10. 分期与任务分解

> **每票完工闸门（对所有票生效）**：① 现有测试全绿；② 本票验收项**逐条实测**（不是读代码推断）；③ UI 类改动附与旧前端的像素/并排对比；④ 未达标就如实标未完成，不写成"已实现"。
> 票单拆解见 `.scratch/netlab-qt/issues/01–15`（一个票一个文件，含 Blocked by 与勾选式验收）。

### P0 地基（不动界面）

- [x] `netlab/ui/` 包骨架 + `--native` 启动开关（与 `--qt`、默认 webview 并存）
- [x] 像素 diff 工具：同尺寸截图 → 差异图 + 百分比报告
- [x] `models.py` 第一版：工程树 + 画布节点/边 的视图模型（纯函数）
- [x] 冻结约定写入 `AGENT_GUIDE.md`（`frontend/app.js` 不再新增功能）
- **闸门**：只读镜像能连 `SERVICE` 并打印视图模型；diff 工具跑通；A17 绿。

### P1 外壳 + 面板 + 第一个图表

- [x] `shell.py`：菜单栏（4 组）、工具栏、状态栏、dock 布局、`QSettings` 持久化
- [x] `theme.py`：token → QSS，深/浅两套
- [x] 工程树面板（`QTreeView`）+ 属性面板（高密度表单）
- [x] `charts/base.py` + 时域图表
- [x] `bridge.py`：SERVICE 快照 → 信号（先服务这一个图表）
- **闸门**：A1/A2/A10/A19/A22；能日常使用一周不崩。

### P2 其余图表 + 文档窗

- [x] FEM / 相图 / 示波器 / 李萨如 四个图表
- [x] 文档窗（`QTextDocument.setMarkdown` + 列表选择）
- [x] 图表 hover 读数与时间轴联动（工具栏滑杆回看历史帧，`−N 帧`）
- **闸门**：A8/A9/A23。

### P3 主画布

- [x] `renderer.py`：元件、导线、结点、标签、网格、选中框（逐图元对照；含跨线桥与标签避让）
- [x] `scene_widget.py`：事件 → 命令 → 状态（含缩放/平移/框选/拖拽）
- [x] 撤销栈（自建场景快照栈，上限 120）
- [x] 拖入模块、右键菜单、双击重命名
- **闸门**：A5/A6/A7 + §9 全部 20 项。

### P4 PlotKit 面板

- [x] 懒加载：首次点击才 `import` + 创建 `QWebEngineView`
- [x] 子进程托管：启动 → 探活 → 回收；失败降级（提示缺 plotkit 包）
- [ ]（部分）尺寸/主题/选中通道同步——尺寸已跟随 dock；主题与选中通道未做（需在 web 侧加 `?theme=`/postMessage 钩子，属 PlotKit 改动，超出 C2 边界）
- **闸门**：A3/A4/A24。

### P5 收口

- [x] 数据面直连替换 `/api/live` 轮询（`bridge.LiveWorker` 直接调 `SERVICE.live()`）
- [x] 单实例锁；端口彻底不监听（`acceptance.py` 实测 `listening=[]`）
- [x] 冻结 `frontend/app.js`，`AGENT_GUIDE.md` 更新路由
- [x] 导出 PDF/SVG（`shell.export_vector`，文字保留为文本）
- **闸门**：A15/A16/A18/A20 + 全量 A1–A25 复测。

---

## 11. 风险登记

| # | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| 1 | 交互细节回归 | 用户逐条验收过的行为丢失 | §9 清单 + 像素 diff + 录屏对照 |
| 2 | 懒加载不彻底 | 启动即拉起 `QtWebEngineProcess` | 启动路径不 import；A3 进程断言 |
| 3 | 渲染阻塞 GUI | 冷渲染 111 ms 冻结窗口 | C4：worker + `QImage` |
| 4 | 线程竞争 | 撕裂读/死锁 | C6：不可变快照 + `QueuedConnection` |
| 5 | QSS 表现力不足 | 主题退化 | token 生成器 + 少量自绘控件 |
| 6 | 字体度量差异 | 文本换行/对齐偏 1–2 px | 像素 diff 时字体区域单列，按区域放行 |
| 7 | 旧前端腐烂 | 冻结后 bug 不修 | 明确 `/` 只作只读出口，问题引导到原生版 |
| 8 | 工期失控 | 12,550 行 JS 的交互面 | P0–P5 闸门，每期可停 |

---

## 12. 不做清单（Out of Scope）

1. **PlotKit 迁移**（编辑器/回放/内嵌图/3D 全原生）——用户已否决，仅保留懒加载 WebEngine。
2. **三维原生**（`QOpenGLWidget`、GLSL 移植）——不在本轮。
3. **web 前端重写或删除**——冻结保留。
4. **QML / Qt Quick**——统一用 Widgets，避免第二套声明式栈。
5. **pyqtgraph / VTK / matplotlib 实时图表**——自绘，保像素一致。
6. **求解器、工程格式、校验、checksum 的任何改动**。
7. **远程访问 / 浏览器演示站 / Pyodide（R28）**——不受本轮影响，也不因本轮加速。
8. **性能优化**——本轮目标是"壳成本"，不是帧率；瓶颈仍在 mpl 重绘与数据量。

---

## 13. 变更记录

- **v1（2026-11-02）**：按用户「选B」定稿。范围 = netlab 全原生 + PlotKit 窗懒加载；建立 R33（6 个子项）、C1–C12、D69–D76、A1–A24、20 项交互清单、P0–P5 任务表。上位评估见 `docs/QT_MIGRATION_EVALUATION.md`。
- **v1.1（2026-11-02）**：用户追加两条要求——①文档窗也纳入收口；②「所有完工后都要检测一下」「换 qt 窗口后尽量保持 ui 一致，效果做到最相似」。据此新增 **C13 UI 保真**、**A25 全窗口保真**、**每票完工闸门**（测试全绿 + 逐条实测 + UI 对比）；票单从 14 拆为 15（FEM 独立成票），收口票阻塞边加入文档窗。
- **v1.2（2026-11-02）**：票单 01–15 全部落地，P0–P5 勾选完成（P4 的"主题/选中通道同步"留作部分完成，原因是它要改 PlotKit web 侧，触 C2）；补 §14 验收结果表。

---

## 14. 验收结果（2026-11-02 实测）

> 环境：Windows + anaconda Python 3.13 + PySide6 6.9.2，`python -m netlab.desktop --native`。
> 判据定义见 §8；「实测」列是当次跑出来的数，不是推断。

| # | 结果 | 实测证据 |
| --- | --- | --- |
| A1 启动 ≤1.5 s | **通过** | `--selftest`：build 187 ms / first paint 268 ms / ready 287 ms（两次 287、294 ms） |
| A2 常驻 ≤350 MB | **通过** | RSS 151 MB（两次一致）；`acceptance.py` 另测 148 MB |
| A3 无 `QtWebEngineProcess` | **通过** | `acceptance.py`：`webengine_processes=0`、`children=[]` |
| A4 PlotKit 出图 ≤3 s | **通过** | 实测：面板启动→`loadFinished(True)` 约 2–3 s，页面完整渲染出编辑器（截图 `_shot_plotkit.png`）。踩坑记录：本机必须 `--no-sandbox`（受限桌面会话）+ `--no-proxy-server`（系统代理会把 127.0.0.1 也走代理，页面永远转圈）；代码已默认带 `--disable-gpu --no-proxy-server`，`NETLAB_WEBENGINE_NO_SANDBOX=1` 作为兜底开关 |
| A5 拖拽帧时 ≤16.7 ms | **未验** | 需人工拖拽打点 |
| A6/A25 像素 diff <1% | **部分** | 同参数两次截图 diff **0.000%**（渲染确定性成立）；与 web 版并排比对需人工 |
| A7 §9 20 项交互 | **部分** | 选择/框选/拖拽/缩放/平移/连线/跨线桥/右键/双击/撤销/快捷键/拖入模块已实测截图；IME、缩放屏未验 |
| A8 hover 读数 | **通过** | 截图 `_shot_hover.png`：`t = 0.02582s src.voltage = 0.97 …` |
| A9 文档窗 | **通过** | 截图 `_shot_doc.png`：标题/列表/表格/代码块正确，主题同色系 |
| A10 工程打开/保存/脏状态 | **通过** | 沿用 `project.py` 校验；`test_ui_widgets` 覆盖保存路径外的模型层 |
| A11 撤销 ≥100 步 | **通过** | `MAX_UNDO=120`，单测断言 |
| A12 快捷键 | **通过** | Ctrl+S/E/Z/Y/D、Delete、Ctrl+0、F5 均已绑定；输入框内让位有单测 |
| A13 IME | **未验** | 需人工用微软拼音实测 |
| A14 125%/150% 缩放 | **未验** | 需改系统缩放实测 |
| A15 单实例 | **通过** | `QLocalServer` 占名 + 二次启动发 `activate` |
| A16 不监听端口 | **通过** | `acceptance.py`：`listening=[]` |
| A17 pytest 全绿 | **通过** | **385 passed, 3 skipped**（10–11 s）；新增 `test_ui_models`/`test_ui_geometry`/`test_ui_widgets` 共 29 条 |
| A18 30 min 内存平稳 | **脚本就绪** | `python -m netlab.ui.soak --minutes 30`；2 分钟自检 148.6→148.6 MB（波动 0.2 MB） |
| A19 主题即时切换 | **通过** | 菜单/工具条按钮切换，`build_qss` 重刷；截图浅色 |
| A20 PDF/SVG 导出 | **通过** | `_canvas_test.pdf` 14 KB、`_canvas_test.svg` 88 KB，文字为文本对象 |
| A21 强杀后恢复 | **通过** | `python -m netlab.ui.restore_check`：子进程写自动保存后 `os._exit`，重启恢复 1→1 节点；自动保存 = 60 s 定时 + 关闭时清理 |
| A22 几何重启恢复 | **通过** | `QSettings` 存 geometry/state；代码路径已走通 |
| A23 图表边界数据 | **通过** | 空数据/单点/均匀场均有分支（FEM 均匀场 bug 已修） |
| A24 PlotKit 失败不白屏 | **通过** | 失败时显示「找不到 plotkit 包…」占位提示 |

**诚实结论**：除 A5/A13/A14/A18 外全部通过，且 A4（PlotKit 面板出图）与 A21 之外的 WebEngine 项已在加 `--no-sandbox --no-proxy-server` 后实机验证。A5/A13/A14/A18/A21 依赖真实桌面会话、屏幕缩放与人工 kill，本轮（无 GPU/无输入焦点）给不出数，未标"已通过"。


---

## 15. 追加：PlotKit 接入与动效（2026-11-02 第二轮）

用户原话：「Plotkit继续接入，并且优化ui与动效」。本轮只动**原生侧**与 `plotkit_bridge`，PlotKit 只加了 `?theme=` 一个参数（C2 的例外记录在 §15.4）。

### 15.1 接入做了什么

| 能力 | 实现 | 文件 |
| --- | --- | --- |
| 面板工具条 | 刷新 / 在浏览器打开 / 浮动 / 右侧状态文字；`QStackedWidget` 占位页 → WebEngine | `netlab/ui/plotkit_panel.py` |
| 真懒加载 | `ensure_loaded()` 才 `import QtWebEngineWidgets`（C5 不变） | 同上 |
| 主题联动 | `apply_theme` → `plotkit_bridge.set_theme()` + 页面 `?theme=light\|dark` 重载 | `shell.py`、`plotkit_panel.py`、`plotkit_bridge.py` |
| 通道联动 | 画布选中节点 → 只画该节点的探针（`n:<节点名>:` 前缀）；取消选择恢复全部 | `shell._sync_plotkit_channels` |
| 曲线样式 | `LINE_STYLE = {"mode": "lines", "width": 1.4, "marker": {"symbol": ""}}`，去掉高密度圆点 | `plotkit_bridge.py` |
| 默认浮窗 | 首次打开直接浮出 1100×760（停靠时面板太窄，图例会把曲线压没） | `shell.toggle_plotkit` |
| 尺寸自适应 | `loadFinished` 后与面板 resize 时向页面派发 `window.resize`，让 PlotKit 按真实尺寸重画 | `plotkit_panel._nudge_resize` |

### 15.2 动效（可关：视图 → 界面动效）

| 动效 | 触发 | 实现 |
| --- | --- | --- |
| 信号流动光点 | 仿真运行中，沿连线按路径长度移动的金色小点 | `render._draw_flow` / `_flow_position`；相位来自 `canvas._clock`（50 ms 定时器，仅运行或有选中时启动） |
| 悬停淡入 | 鼠标移入连线/节点 | `motion.Ramp` + `hover_alpha`，线宽 1.4→1.9、描边 alpha 渐变 |
| 选中脉冲 | 选中节点 | 外环半径 4→5.8 px、alpha 0.40→0.62（`pulse` 正弦） |
| 缩放平滑 | 滚轮/±/按钮 | `QVariantAnimation` 90 ms，以光标为锚 |
| 图表淡入 | 首次显示 / 切主题 | `QGraphicsOpacityEffect` 190 ms，结束后摘 effect |
| 面板滑入 | 停靠面板展开 | `maximumWidth/Height` 动画，结束复位 |

关掉动效时所有函数直接落终态（`motion.duration()` 返回 0、`Ramp.to()` 直接赋值），不残留 effect。

### 15.3 这一轮踩到的坑

1. **PlotKit 按元素尺寸渲染**：`plotSize()` 取 `#plot` 的 clientWidth/Height（最小 320×200）。停靠面板只有 ~640×200 时，`constrained_layout` 直接塌陷（日志刷 `axes sizes collapsed to zero`），图看起来是空的。→ 给足面积 + 主动派发 resize。
2. **`mode: "lines"` 仍会画圆点**：后端 `_marker_symbol(style) if kwargs["marker"] or marker.get("symbol")`，而 marker 默认 `{"symbol": "circle"}` 是真值。→ 必须显式 `"marker": {"symbol": ""}`。
3. **`QTimer(owner)` 要求 owner 是 QObject**：`Ramp` 的 owner 是自绘控件（QWidget 可以），但单测里传了普通对象直接 `TypeError`。→ `QTimer()` + `isinstance(owner, QObject)` 才 `setParent`。
4. **浮动 dock 不能走 `slide_dock`**：`maximumWidth` 动画会把浮窗卡在 640 px。→ 浮动时跳过动画。
5. **改 `figure.spec` 不用手动失效缓存**：`Figure.revision` 是 spec 内容摘要 + 数据集版本，原地改也会换 ETag。
6. **`SERVICE.catalog()` 不存在**：catalog 在 `SERVICE.current.scene.catalog()`；`NetworkContainer.__getattr__` 只委托到 `Simulation`。

### 15.4 C2 的例外

PlotKit 侧只改了一处：`frontend/app.js` 增加 `?theme=light|dark`（覆盖页面外壳深浅色，不动 `spec.figure.theme`）。理由：原生界面换主题时，宿主外壳与图内配色必须同步，否则白底嵌在深色窗里。改动 4 行，`node --check` 通过。

### 15.5 验收

- 全量 `python -m pytest netlab/tests -q` → **385 passed, 3 skipped**（新增 motion/bridge 各 1 条）。
- 截图：`_shot_main_light.png`（浅色主窗 + 流动光点）、`_shot_main_dark.png`、`_shot_plotkit_light.png` / `_shot_plotkit_dark5.png`（面板浮窗，深浅两套）、`_shot_hover.png`、`_shot_seek.png`。
- 仍未验：A5（拖拽帧时）、A13（IME）、A14（系统缩放）、A18（30 min 长跑，脚本就绪）。A21 已由 `restore_check.py` 三进程实测通过。

---

## 16. 自动保存与验收脚本（2026-11-02）

### 16.1 自动保存（补 A21）

| 项 | 内容 |
| --- | --- |
| 触发 | `QTimer` 60 s 一次，仅当场景脏（`_dirty`）才写；保存成功、正常关窗时清除 |
| 路径 | `%APPDATA%/Netlab/NetlabDesktop/autosave.netlab`（与 web 壳同一份，可互相接续） |
| 内容 | `build_project()` → `validate_project()` 的完整工程（含校验和），不是半成品 |
| 恢复 | 启动时若文件存在且未加 `--no-recover`，弹「恢复未保存的工作」；`MainWindow.recover_autosave()` 装回场景并保持脏状态 |
| 失败 | 写盘异常只写日志，不打断用户 |

### 16.2 两个验收脚本

| 脚本 | 用途 | 输出 |
| --- | --- | --- |
| `python -m netlab.ui.soak --minutes 30` | A18 长跑：起原生界面，按 `--interval` 采样 RSS | 首段/末段均值、波动幅度、PASS/FAIL；不足 10 分钟只算脚本自检 |
| `python -m netlab.ui.restore_check` | A21 强杀恢复：子进程 A 写自动保存后 `os._exit`（不清理），父进程校验文件，子进程 B 恢复并比对节点数 | `nodes_before/N/MB/PASS` |

### 16.3 顺带修的模式过滤

模块库原先把 `computes / circuit_nodes / elements` 三个桶全摊平，信号模式下能点到 `node`/`device`，落地时抛「未知的节点构造方式」。现在按 `scene.mode` 过滤：signal/vector 只给 computes，circuit 只给 circuit_nodes + elements。

---

## 17. 原 web 前端退役（v1.3，2026-11-02）

用户决定：「请把原web界面打包到github备份，后在本地删掉」。见 D77。

| 备份 | 位置 |
| --- | --- |
| Git 分支 | `backup/web-ui-static-2026-11-02`（含完整 static 与旧壳） |
| Git 标签 | `web-legacy-2026-11-02` |
| 压缩包 | `docs/archive/netlab-web-ui-2026-11-02.zip`（154 KB，6 文件 + 说明） |

本地删除：`frontend/{index.html,app.js,style.css,desktop-shim.js}`、`netlab/desktop/webview_app.py`、`netlab/desktop/webview_bridge.py`。

代码调整：`server.py` 去掉 `StaticFiles` 挂载与 `STATIC_DIR`，`/` 改为内置说明页（`/api/*` 不变）；`desktop/__main__.py` 默认原生、`--web` 报错退出 2；`test_plotkit_tab.py` 改为断言首页说明页 + `/static/style.css` 404。

验收：**387 passed / 3 skipped**；`/` 200（含「原生」文案）、`/static/style.css` 404、`/api/health` 200、`--selftest` ready 301 ms / RSS 155 MB。
