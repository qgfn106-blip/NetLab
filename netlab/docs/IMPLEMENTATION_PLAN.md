# Netlab 桌面化与七项功能扩展 · 实施计划

| 项 | 内容 |
| --- | --- |
| 文档状态 | 草案，待审阅 |
| 文档版本 | 0.1 |
| 日期 | 2026-10-24 |
| 适用代码 | netlab 1.0.0（Python 3.11+，FastAPI + NumPy/SciPy） |
| 基线测试 | `python -m pytest netlab/tests -q` → 43 passed |
| 本轮变更 | **仅新增本文档，未修改任何源码** |

> 本文档只描述“如何做、分几步做、改哪些文件、如何验收”，不包含实现代码。
> 在任何阶段获得明确批准之前，不开始下一阶段，也不扩大任务范围。

---

## 变动索引（2026-10-25）

> 本文件是 2026-10-24 的原始实施计划，**保留原文不重写**（便于审计当时判断）。
> 下列内容已失效或被取代，阅读时请以新文档为准：

| 本文章节 | 状态 | 取代者 |
| --- | --- | --- |
| §1 需求确认（七项需求） | 已被细化/取代 | REQUIREMENTS_AND_RULES.md §3（R01–R17）、§7.1（映射表） |
| §3 架构设计（单场景、单层、单文件工程） | **部分失效**：一进程多网络、工程目录 + library 引用式模块 | REQUIREMENTS_AND_RULES.md D2/D4/D18 |
| §4 阶段计划（V2-0…V2-7） | 已被取代 | 本仓库 PROGRESS.md §7（P0–P6）与本文件下方 §8 之外的进度视图 |
| §5 文件修改总表 | 部分过期（新增 workspace/library/analysis/profiling 等模块） | REQUIREMENTS_AND_RULES.md §3 各条「拟改架构」 |
| §9 待确认决策 | 已关闭 | REQUIREMENTS_AND_RULES.md §2（D1–D32） |
| 全局：命名（场景/规格） | 已作废 | REQUIREMENTS_AND_RULES.md §7.2 |

**新增的横切约束**（原文没有）：数据依赖与数据保护（§8）、性能与计时（R13）、
控制理论呈现层与求解器解耦（R17/D22）。

---

## 0. 执行摘要

本次需求包含七项：

1. 网页端改桌面程序；优化计算速度；尝试 GPU；保证计算顺序与数据安全。
2. 直接查看节点/连接的计算函数、传递函数、参数名与说明；在应用内用 Python 自定义。
3. 把构造好的网络保存为功能性节点；增加输入/输出节点接口。
4. 完善保存功能与参数设置，更符合一般软件设置与网络绘制直觉。
5. 相图轨迹延长；播放增加循环时间、自定义循环长度与推荐默认值。
6. 节点与连线互相遮掩；连线摆放更自由，支持直角/直线。
7. 按 `常用电路元件清单.txt` 完善电路元件；运放、触发器、寄存器等模块化并可看内部。

建议拆成 **Phase 0 – Phase 9**，一次只实现一个阶段：

```text
Phase 0  基线/回滚/基准/进度文档
Phase 1  桌面外壳 + 项目保存
Phase 2  性能优化 + 可选 GPU
Phase 3  规格自省 + Python 自定义
Phase 4  功能块/模块系统
Phase 5  电路元件 Tier A + 模拟功能块
Phase 6  数字/混合信号
Phase 7  连线路由 + 参数/保存 UX + 撤销
Phase 8  相图轨迹 + 回放
Phase 9  打包发布（可延后）
```

推荐先批准 **Phase 0 + Phase 1**，因为后续所有功能都依赖桌面文件对话框、项目持久化和可回滚基线。

---

## 1. 需求确认

### 1.1 我对七项需求的理解

| # | 需求 | 我的理解与交付边界 | 主要歧义 / 风险 |
| --- | --- | --- | --- |
| 1 | 网页端改桌面程序；优化计算；尝试 GPU；注意计算顺序与数据安全 | 用原生桌面窗口承载现有 UI，后端仍在本机进程内；文件用原生对话框；计算先做 CPU 热路径优化，GPU 作为**基准测试门控的可选后端**，不强行替换；所有步进保持单线程确定顺序，GPU 只在单步内的线性代数中使用并同步回主存 | “桌面程序”是否要求单文件 exe；GPU 是否必须默认开启 |
| 2 | 直接看到节点/连接的计算函数、传递函数、参数名与说明；在应用内用 Python 自定义 | 内置规格提供只读源码、公式、参数表；自定义节点/连接/传递函数提供应用内编辑器、参数声明、保存与热重载；配套说明文档 | **与现有“绝不执行用户提交代码”的安全模型冲突**，必须重新定义信任边界 |
| 3 | 构造好的网络保存为功能性节点；增加输入/输出节点接口 | 引入“功能块（Block）”定义与实例：内部子图 + `module_input` / `module_output` 接口节点；选中网络可一键封装；支持嵌套、独立状态、端口连线、模块库 | 模块是否需要参数化；电路模式模块是否同一期完成 |
| 4 | 完善保存功能与参数设置，更符合一般设置与绘图直觉 | 项目文件（场景 + 仿真 + FEM + UI + 模块 + 扩展）、保存/另存为/打开/最近/自动保存/崩溃恢复；参数分组、说明、单位、默认值、校验、撤销/重做 | 保存位置、是否要“工程目录”概念 |
| 5 | 相图轨迹延长；播放增加循环时间、自定义循环长度与推荐默认值 | 相图轨迹改为“时间长度 + 最大点数”；增加回放/暂停/拖动时间游标/循环播放/速度；循环时长可自定义，并给出推荐周期及依据 | 播放只针对相图，还是信号图也要 |
| 6 | 节点与线互相遮掩；连线自由摆放；直角/直线 | 连线增加路由模式（曲线/直线/正交/手动拐点）、锚点、标签偏移、层级、避让开关；前端几何路由与缓存；撤销/重做 | 自动避障的复杂度与性能 |
| 7 | 按清单完善电路元件；运放、触发器、寄存器模块化并可看内部 | 分级实现：2 端子元件直接扩展 MNA；多端子/复杂器件用“功能块 + 端口节点”展开；运放等给真实内部电路；数字器件给逻辑图/真值表 + 混合信号桥；MCU/CPU/存储器明确不在首期范围 | 模型保真度；是否要晶体管级数字电路仿真 |

### 1.2 必须提前确认的架构冲突

1. **Python 自定义代码 vs 现有安全模型**

   当前 `computes.py` 与架构文档明确“不执行用户提交代码”。需求 2 要求应用内 Python 自定义，这必然要执行本地代码。

   建议：**本地可信扩展模式**——明确开关、项目打开时二次确认、AST 静态限制、代码哈希展示、只允许本地文件；同时保留“只读查看内置源码”和“受限表达式”两条安全路径。它不是沙箱，不能执行来源不明的项目代码。

2. **多端子电路器件 vs 现有“一条边 = 两个端点”模型**

   当前 `EdgeRecord` 只有 `source/target`，`CircuitElement` 只有 `a/b`。BJT、运放、电位器、变压器无法直接表达。

   建议：**不破坏现有边模型**，用“功能块 + 端口节点”表达多端子器件；电路模式展开时把端口节点与内部接口节点做别名合并。这样复用现有 MNA 与前端连线。

3. **GPU vs 小矩阵**

   当前 MNA 未知量通常几十个，FEM 默认 925 自由度。GPU 的 kernel 启动与拷贝开销很可能大于收益。

   建议：**先 CPU 优化并建立基准，再以实测决定 GPU**；保留 `auto/cpu/gpu` 后端与实验开关。如果 GPU 无稳定收益，就在文档中给出实测数据并默认关闭，不把它当作默认卖点。

---

## 2. 项目调查

### 2.1 现状架构

- 单进程、双工作区：TOPOLOGY（signal / circuit / vector）+ FIELD·FEM。
- 后端分层清晰：HTTP → 服务/线程 → 场景/引擎 → 计算层 → 数值/校验。
- 关键文件：
  - 场景与引擎：`netlab/scene.py`
  - 信号图运行时：`netlab/graph.py`
  - 电路 MNA：`netlab/nodal.py`
  - 节点/连接注册表：`netlab/computes.py`、`netlab/methods.py`
  - 线程、配置、录制：`netlab/simulation.py`
  - HTTP：`netlab/server.py`
  - 前端单文件：`netlab/static/app.js`（约 4675 行）
  - 测试：`netlab/tests/test_netlab.py`
  - 文档：`netlab/docs/ARCHITECTURE.md`、`netlab/docs/EXTENDING.md`
- 数据流：`NodeRecord/EdgeRecord → 引擎装配 → 每步 step → probes → Recorder → /api/live → Canvas`。
- 固定顺序：延迟边步首求值 → 拓扑序节点 → 节点内连接求值 → handler → 写回。这个顺序必须保留。

### 2.2 现状能力缺口

| 能力 | 现状 |
| --- | --- |
| 桌面程序 | 无；`run.py` 启动 uvicorn 并打开浏览器 |
| 持久化 | 无数据库；只有 `/api/scene/export` 的 JSON 下载 |
| 自动保存/恢复 | 无 |
| 模块化 | 无 |
| 自定义 Python | 无；只有受限表达式 `safeexpr` |
| 连线路由 | 只有贝塞尔曲线；无直线/正交/拐点/层级 |
| 相图 | 轨迹上限 1200 帧；无回放/循环 |
| 电路元件 | 9 种：R/C/L/电压源/电流源/二极管/开关/VCVS/VCCS |
| 多端子器件 | 无 |
| 数字逻辑 | 无 |
| GPU | 无 |
| 撤销/重做 | 无 |

### 2.3 性能热点（代码级）

1. `graph.py`：每步 `copy.deepcopy(inputs)` 与 `deepcopy(data)`；每条连接创建 `NodeView`、`MappingProxyType`；每步遍历所有边找延迟边。
2. `graph.py`：每步对连接输出和节点输出都执行 `json_safe`，深拷贝 + 递归校验。
3. `nodal.py`：每次 Newton 迭代 `np.zeros((n,n))`、`np.zeros(n)`；线性电路每步重新 `np.linalg.solve`，未复用 LU。
4. `fem.py`：`_source_vector` 每个 Gauss 点循环 + `bincount`；可预计算为矩阵乘。
5. 前端：每帧全量重绘边、探针键解析、相图点集重复过滤；`app.js` 单文件，修改成本高。

### 2.4 环境与基线

| 项 | 实测值 |
| --- | --- |
| Python | 3.13.9（Anaconda） |
| NumPy / SciPy / FastAPI | 2.3.5 / 1.16.3 / 0.148.0 |
| PySide6 | 6.9.2，`QtWebEngineWidgets` / `QtWebChannel` 可导入 |
| Node.js | v24.19.0 |
| GPU | RTX 4060 Laptop 8 GB，驱动 616.92，CUDA UMD 13.4 |
| CuPy / PyInstaller | 未安装 |
| numba | 0.62.1，但 `numba.cuda.is_available()` 为 False |
| 版本控制 | **当前目录不是 git 仓库** |
| 测试 | 43 passed，约 2.8 s |

> 结论：PySide6 桌面外壳可行；GPU 需要额外安装 CuPy 并做基准；打包需要额外安装 PyInstaller；缺少 git 是当前最大的回滚风险。

### 2.5 已知问题（文档中已承认，建议顺手修）

- `/api/scene/clear` 对 `vector` 会落到 `blank_circuit`。
- `Scene.load_payload` 只为 `signal` 自动加延迟，`vector` 不自动加。
- `Scene` 批量操作不是事务性的，中途失败可能留下部分修改。
- `app.js` 单文件，后续大功能必须按模块拆分或至少新增独立脚本。
- FEM 模型在 import 阶段构建，缺少 SciPy 会启动失败。
- 工作区有 `catalog.tmp.json`、`fem.tmp.json`、`femlive.tmp.json` 等临时产物，建议清理并加入忽略。

---

## 3. 架构设计

### 3.1 桌面运行时

```text
┌────────────────────── Netlab Desktop（PySide6 / QtWebEngine）──────────────────────┐
│ Qt GUI 线程                                                                          │
│   QMainWindow / QWebEngineView / QFileDialog / QMessageBox / 最近文件 / 关闭确认     │
│        │ QWebChannel：openProject / saveProject / autosave / reveal / quit           │
│        ▼                                                                             │
│ Chromium 页面：现有 static/（index.html + app.js + style.css + 新增 router.js）       │
│        │ HTTP 127.0.0.1:<free-port> + 桌面会话 token                                 │
│        ▼                                                                             │
│ uvicorn 线程：FastAPI app                                                            │
│        ├─ SERVICE（Simulation）── netlab-simulation 线程                             │
│        └─ FEM ────────────────── netlab-fem 线程                                     │
│                                                                                      │
│ 数据：.netlab 项目文件 / 自动保存 / 最近文件 / 扩展目录 / 模块库                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

决策：

- 保留现有 Canvas SPA，不做原生控件重写；桌面外壳负责窗口、菜单、文件、生命周期。
- HTTP 仅监听 `127.0.0.1`，使用随机空闲端口；桌面模式增加会话 token，防止本机其他页面误调 API。
- 浏览器模式继续保留：`python run.py` 行为不变，方便排错与回归。
- 桌面入口：`python -m netlab.desktop`；`start_desktop.bat` 双击启动。
- 单文件 exe/安装包放到独立发布阶段，避免一开始被 PyInstaller/QtWebEngine 打包问题拖住。

### 3.2 计算加速与数据安全

```text
Scene revision / dirty
   → Engine 原子重建（新引擎构建成功后再替换旧引擎）
   → 单线程 step：
        1. 延迟边统一求值
        2. 拓扑序节点
        3. 连接求值（只读视图）
        4. 节点 handler（内置快路径 / 自定义深拷贝）
        5. 结果校验（内置可信输出可跳过逐字段 json_safe）
   → probes → Recorder → 快照
```

优化顺序：

1. **图热路径**：内置 handler 使用浅拷贝/只读视图；缓存 `NodeView` 与参数代理；预计算延迟边列表与入边列表；`json_safe` 只对自定义/未知输出强制。
2. **MNA**：复用 `A/rhs` 缓冲；预计算 stamp 索引；线性电路在 dt/结构不变时只做一次 LU 分解，每步只回代；非线性才逐 Newton 分解。
3. **FEM**：预计算高斯源基矩阵，将 `_source_vector` 改为矩阵乘；保持稀疏 LU。
4. **可选 GPU**：新增 `netlab/accel.py`，接口包括 `solve_dense`、`sparse_lu_solve`、`matmul`、`synchronize`、`to_cpu`。
   - `NETLAB_ACCEL=auto|cpu|gpu`；auto 只在规模超过阈值且 CuPy 可用时启用。
   - 单 stream；每步结束显式同步；结果回拷后才提交状态。
   - GPU 异常/不一致自动回退 CPU，并记录 `accel` 状态。
   - 不改节点求值顺序，不并行节点，不把用户代码放 GPU。
5. **数据安全契约**：
   - 一步是一个逻辑事务；失败不提交录制帧。
   - 引擎重建成功后才替换旧引擎。
   - 前端只接受 `revision`/`cursor` 不旧于本地的响应。
   - 保存使用临时文件 + fsync + 原子替换。
   - GPU 只做单步内线性代数，不做跨步异步。

### 3.3 规格自省与 Python 扩展

内置规格：

- 为 `ComputeSpec` / `MethodSpec` / `ElementSpec` 增加：
  - `source`（`inspect.getsource(factory)`，只读）
  - `formula`（人类可读公式，如 `y = offset + gain·Σu`）
  - `category` / `advanced` / `docs`
  - `editable` / `source_path`
- 检查器增加“代码 / 公式 / 参数说明”页签；参数表由 `ParamSpec` 自动生成：名称、类型、默认值、范围、单位、说明、示例。
- 传递函数额外显示归一化 `H(s)` / `H(z)` 与离散化方法。

自定义扩展：

- 新增 `netlab/extensions.py`，扫描 `extensions/nodes/*.py`、`extensions/methods/*.py`。
- 用装饰器注册，例如：

  ```python
  @define_node(kind="user.my_node", label="...", params=(P.float("gain", ...),))
  def compute(ctx):
      return {"y": ctx.inputs[...]["u"] * ctx.params["gain"]}
  ```

- 应用内编辑器：代码、参数声明、校验、保存、热重载；错误带行号。
- AST 静态限制：禁止 `eval/exec/compile/open/__import__`、危险模块导入、双下划线属性；允许 `math`、`numpy`、`netlab.ext`。
- **信任门控**：项目文件内嵌的扩展代码默认不执行；打开项目时列出代码哈希，用户确认后才加载。
- 明确说明：这是“本地可信扩展”，不是安全沙箱；来源不明的项目不要加载。

### 3.4 功能块 / 模块系统

```text
BlockDef（可复用定义，存项目与模块库）
  ├─ mode: signal | vector | circuit
  ├─ params: ParamSpec[]（可选，标量/矩阵/枚举）
  ├─ nodes: 普通节点 + module_input / module_output 接口节点
  └─ edges: 普通连接

        │ instantiate
        ▼

BlockInstance（父场景中的一个功能节点）
  ├─ block 节点：signal 模式执行内部 Network；circuit 模式展开
  ├─ port 节点：每个端口一个真实 NodeRecord，父场景连线接到它
  ├─ hidden feed/emit 边：保证 signal 模式拓扑顺序
  └─ 独立 state：每个实例互不共享
```

关键决策：

- **不修改 `EdgeRecord` 的两个端点模型**；用端口节点承接多端口连线。
- signal/vector：内部 `Network` 嵌套执行；输入端口值在内部步进前注入，输出端口值在内部步进后提交。
- circuit：实例展开为内部元件；端口节点与内部接口节点做并查集别名合并；每个实例独立状态。
- 嵌套编辑：API 增加 `scope=root|block:<id>`；前端用面包屑进入/退出模块；块定义保存到项目与用户模块库。
- 封装选中网络：
  1. 识别跨选择边界的入边/出边；
  2. 为每条边界边创建输入/输出接口节点与端口；
  3. 生成 `BlockDef`，内部重连线；
  4. 用 `BlockInstance` 替换选中节点，父场景边接到端口节点；
  5. 自动命名端口，冲突可编辑。
- 参数绑定：模块参数可在实例检查器编辑；内部参数支持 `"$param:name"` 绑定，装配时深拷贝替换。
- 限制：最大嵌套深度、最大展开节点/边数、递归引用检测、端口名唯一性。

### 3.5 项目保存

项目文件 `.netlab`（JSON，版本化）：

```json
{
  "format": "netlab-project",
  "version": 1,
  "app": "netlab 2.x",
  "name": "...",
  "created": "...",
  "modified": "...",
  "scene": { "mode": "...", "integration": "...", "nodes": [], "edges": [], "blocks": [] },
  "blocks": [],
  "extensions": [{ "kind": "user.x", "code": "...", "sha256": "..." }],
  "sim": {},
  "fem": {},
  "ui": { "view": {}, "workspace": "network", "phase": {}, "chart": {}, "routing": {} },
  "checksum": "..."
}
```

- 原子写入 + `.bak` 备份；自动保存独立目录；崩溃恢复提示。
- 桌面模式由 Qt 原生对话框选择路径，服务端不接收任意文件路径。
- 浏览器模式回退为下载/上传 + `localStorage` 自动保存。
- 旧场景 JSON 继续可导入；缺失字段补默认值。
- 打开含扩展代码的项目必须二次确认。

### 3.6 相图轨迹与回放

- 录制器改为**列式环形缓冲**：按探针键存 `array('d')` + 时间数组，避免每帧 dict 开销。
- 默认容量 20,000 帧；可配置；超限按时间淘汰。
- 新增 `/api/history?keys=&from=&to=&max_points=`，按需返回抽稀轨迹；相图不再依赖完整 live 帧。
- 相图轨迹改为“时长（秒）+ 最大点数”，默认例如 3 个推荐周期或 20 s，最大 300 s / 20k 点；渲染抽稀到 6k 点。
- 回放：播放/暂停/拖动时间游标/循环/速度；循环时长可自定义。
- 推荐周期：
  1. 若节点参数含 `forcing_frequency`，取 `1/f`；
  2. 否则对 `x/y` 或 `vx/vy` 做自相关，取第一个显著峰；
  3. 再否则默认 5 s；显示“推荐：X s（依据）”。
- 回放只读，不修改仿真状态；默认回放时暂停仿真，可配置。

### 3.7 连线路由

`EdgeRecord` 增加可选 `route`：

```json
{
  "mode": "auto|straight|orthogonal|manual",
  "waypoints": [{"x": 0, "y": 0}],
  "source_anchor": "auto|right|left|top|bottom",
  "target_anchor": "auto|right|left|top|bottom",
  "label_offset": {"x": 0, "y": 0},
  "lane": 0,
  "z": 0,
  "avoid_nodes": true
}
```

- 前端新增 `static/router.js` / `static/geometry.js`，纯函数 + Node 单测。
- 正交路由：曼哈顿折线 + 圆角；按边序号/哈希分车道；可选节点避让（线段-圆相交检测 + 绕行点）。
- 手动拐点：拖拽、Alt+点击删除、双击添加；标签可拖动。
- 层级：`z` + “置顶/置底”；选中边始终最上。
- 缓存：按 `revision + 节点坐标 + route` 缓存几何，拖动时只重算受影响边。
- 节点锚点：四向锚点 + 自动选择，减少线穿节点。

### 3.8 电路元件与混合信号

分级策略：

| 级别 | 范围 | 目标 |
| --- | --- | --- |
| A | 2 端子无源/保护/二极管族/电源；保险丝、PTC、MOV、稳压管、肖特基、LED、TVS、压敏、可变 R/C、磁珠 | 完整 MNA 模型、参数、测试、符号 |
| A | 运放、比较器、线性稳压器 | 功能块 + 真实内部电路（VCVS/反馈/钳位） |
| A | 逻辑门、D 触发器、JK/RS、计数器、移位寄存器、ADC/DAC | 数字引擎 + 混合信号桥 + 逻辑图/真值表 |
| B | BJT/MOSFET/JFET/SCR/TRIAC/IGBT、变压器/互感、555、光耦、继电器、直流电机 | 行为级或简化物理模型 + 内部图 |
| B | 热敏/光敏/霍尔/加速度/应变、蜂鸣器/扬声器、步进/伺服 | 参数化传感器/执行器块，简化模型 |
| C | MCU/CPU/RAM/ROM/Flash、PCB 封装、完整 SPICE 寄生 | 明确不在首期；提供通用数字块/状态机模板 |

多端子器件统一用功能块：

- 电位器：3 端口，内部两个电阻 + 滑动端。
- 整流桥：4 端口，4 个二极管。
- BJT：Ebers-Moll，内部两个二极管 + CCCS；需先补 `cccs/ccvs`。
- MOSFET/JFET：平方律 VCCS + 结电容/二极管。
- 变压器/互感：耦合电感 + CCCS/CCVS 或专用 4 端口块。
- 运放：VCVS + 输入/输出电阻 + 电源钳位二极管；可打开内部电路。
- 数字块：`digital.py` 四态逻辑、确定性事件队列、时钟边沿检测；模拟-数字桥用阈值/迟滞，数字-模拟桥用理想电压源/输出电阻；跨域反馈采用一步因果延迟，避免代数环。

---

## 4. 阶段计划

> 原则：一次只实现一个阶段；每阶段结束运行测试、更新 `docs/PROGRESS.md`（新建），并做独立审查。
> 推荐顺序：**Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9**。
> Phase 7/8 互不依赖，可根据优先级提前。

### Phase 0 — 基线与护栏

| 项 | 内容 |
| --- | --- |
| 目标 | 建立可回滚、可度量的基线，不改变功能 |
| 范围 | git 初始化与基线提交（若同意）；`.gitignore`；基准脚本；进度文档；清理临时产物 |
| 依赖 | 无 |
| 主要文件 | 新建 `netlab/tools/bench.py`、`netlab/docs/PROGRESS.md`、`.gitignore`；不改业务源码 |
| 交付物 | 基线测试报告、基准 JSON、基线 tag、风险清单 |
| 验收 | 43 个测试仍通过；基准可重复运行；git 可回滚；文档记录当前版本与环境 |
| 风险 | 若不愿用 git，则用 zip 备份替代；仍需可回滚 |

### Phase 1 — 桌面外壳 + 项目保存

| 项 | 内容 |
| --- | --- |
| 目标 | 双击启动原生窗口；项目可保存/打开/自动保存/恢复；关闭前确认 |
| 范围 | 桌面窗口、本地服务线程、原生文件对话框、项目文件、最近文件、自动保存、会话 token；**不含**模块/自定义代码/电路扩展 |
| 依赖 | Phase 0 |
| 新建 | `netlab/desktop/__init__.py`、`app.py`、`main_window.py`、`bridge.py`、`server_host.py`、`selftest.py`；`netlab/project.py`；`start_desktop.bat`；`requirements-desktop.txt` |
| 修改 | `netlab/server.py`（app 工厂 / token / 优雅关闭）、`netlab/run.py`（可选桌面入口）、`netlab/static/app.js`（桌面桥检测、项目菜单、dirty 标记）、`netlab/static/index.html`、`netlab/static/style.css`、`netlab/tests/test_netlab.py`（兼容性） |
| 交付物 | 可运行的桌面窗口；项目保存/打开/另存为/最近/自动保存/恢复；浏览器模式仍可用 |
| 验收 | `python -m netlab.desktop --selftest` 通过；项目往返后场景/配置/UI 一致；关闭未保存时提示；43 + 新增测试通过；无浏览器依赖 |
| 数据安全 | 服务端不读任意路径；桌面会话 token；原子保存；前端忽略旧 revision 快照 |
| 备注 | 单文件 exe 不在本阶段，放到 Phase 9；先保证源码运行与可测试 |

### Phase 2 — 计算性能与可选 GPU

| 项 | 内容 |
| --- | --- |
| 目标 | 用基准驱动优化；GPU 有证据才启用 |
| 范围 | 信号图热路径、MNA 线性复用、FEM 源项向量化、可选 CuPy 后端；不改变数值语义 |
| 依赖 | Phase 1（有基准脚本与桌面观测入口） |
| 新建 | `netlab/accel.py`；`netlab/tests/test_accel.py`；扩展 `tools/bench.py` |
| 修改 | `netlab/graph.py`、`netlab/scene.py`、`netlab/nodal.py`、`netlab/fem.py`、`netlab/linalg.py`、`netlab/simulation.py`、`netlab/limits.py`、`netlab/server.py`、`netlab/static/app.js`（accel 状态） |
| 交付物 | 前后基准报告；CPU 优化；可选 GPU 后端与自动回退；性能面板 |
| 验收 | 代表性场景 step_ms 有可重复改进（目标：信号 ≥1.5×、线性电路 ≥2×、FEM ≥1.3×；以基准为准）；数值与基线一致（容差内）；GPU 不可用/无收益时自动 CPU；确定性测试通过 |
| 数据安全 | 单线程步进顺序不变；GPU 单 stream + 同步；引擎原子重建；录制只在成功后写入 |
| 备注 | 若 GPU 实测无收益，保留实验开关并在文档写明，不默认开启 |

### Phase 3 — 规格自省 + Python 自定义

| 项 | 内容 |
| --- | --- |
| 目标 | 看得见函数/公式/参数；能在应用内写 Python 扩展 |
| 范围 | 内置源码/公式/参数说明；自定义节点/连接/传递函数；信任门控；文档 |
| 依赖 | Phase 1（项目保存与信任 UI） |
| 新建 | `netlab/extensions.py`；`docs/PYTHON_EXTENSIONS.md`；`tests/test_extensions.py` |
| 修改 | `netlab/computes.py`、`netlab/methods.py`、`netlab/nodal.py`（规格元数据/公式/源码）、`netlab/params.py`（参数文档字段）、`netlab/scene.py`（catalog）、`netlab/server.py`（扩展 API）、`netlab/limits.py`（代码大小/路径）、`netlab/static/app.js`（代码页/编辑器/参数表）、`netlab/project.py`（内嵌代码与哈希） |
| 交付物 | 内置源码查看；参数说明表；自定义扩展示例；应用内编辑/校验/保存/热重载；文档 |
| 验收 | 任一内置节点/连接可看到公式、参数表、源码；自定义 `rate_limiter` / `dead_zone` / 传递函数可运行；危险 AST 被拒；项目打开不自动执行代码；错误带行号；测试通过 |
| 安全 | 明确“本地可信扩展”边界；保留只读与受限表达式路径；不加载远程代码 |
| 风险 | 这是安全模型变更，需要明确批准 |

### Phase 4 — 功能块 / 模块系统

| 项 | 内容 |
| --- | --- |
| 目标 | 网络可封装为带输入/输出接口的功能节点；支持嵌套与复用 |
| 范围 | `BlockDef` / 实例 / 端口节点 / 接口节点 / 嵌套编辑 / 封装选中 / 模块库 / 参数绑定；signal+vector 先行 |
| 依赖 | Phase 1（保存）、Phase 3（若模块含自定义节点） |
| 新建 | `netlab/blocks.py`；`docs/BLOCKS.md`；`tests/test_blocks.py` |
| 修改 | `netlab/scene.py`（blocks/scope/序列化/展开）、`netlab/graph.py`（隐藏节点/端口）、`netlab/computes.py`（`module_input` / `module_output`）、`netlab/methods.py`（`block_feed` / `block_emit`）、`netlab/server.py`（blocks API/scope）、`netlab/templates.py`（示例模块）、`netlab/static/app.js`（块卡片/端口/面包屑/封装）、`netlab/limits.py`（嵌套/展开上限）、`netlab/project.py` |
| 交付物 | 封装/展开、端口编辑、嵌套编辑、模块库、参数绑定、保存/加载 |
| 验收 | 选中网络一键封装后外部连线保持；模块实例输出与扁平网络数值一致；两个实例状态互不影响；嵌套 2 层可用；递归/超限有可读错误；保存再打开一致；测试通过 |
| 数据安全 | 每实例独立 state；端口值拷贝；引擎原子构建；展开上限与递归检测 |
| 备注 | 电路模式模块展开放到 Phase 5/6，与多端子器件一起做 |

### Phase 5 — 电路元件库 Tier A + 模拟功能块

| 项 | 内容 |
| --- | --- |
| 目标 | 按清单补齐核心元件；运放/比较器/稳压器等可看内部电路 |
| 范围 | 2 端子元件、保险丝、PTC/MOV、稳压/肖特基/LED/TVS/变容/光电二极管、可变 R/C、磁珠；多端子经功能块；运放/比较器/稳压器；`cccs/ccvs` |
| 依赖 | Phase 4（功能块/端口/展开） |
| 新建 | `docs/CIRCUIT_LIBRARY.md`；`tests/test_elements_extra.py`；内置块定义可放 `blocks.py` 或 `netlab/builtin_blocks.py` |
| 修改 | `netlab/nodal.py`（新元件/规格/符号元数据/CCCS/CCVS）、`netlab/blocks.py`（内置块）、`netlab/templates.py`（示例）、`netlab/static/app.js`（符号/参数/内部视图入口）、`netlab/scene.py`（元件目录/序列化） |
| 交付物 | 元件参数/模型/测试/符号；保险丝熔断锁存；运放增益/饱和/内部电路；示例模板 |
| 验收 | 每个 Tier A 元件有解析或行为测试；保险丝按 `EXTENDING` 示例熔断并锁存；运放闭环增益/饱和符合预期；内部电路可打开并仿真；保存/重置正确；测试通过 |
| 备注 | Tier B/C 在文档中列明；不承诺一次性完成全部清单 |

### Phase 6 — 数字 / 混合信号

| 项 | 内容 |
| --- | --- |
| 目标 | 逻辑门/触发器/寄存器/计数器/ADC/DAC 可用；模拟-数字可协同 |
| 范围 | 四态逻辑、确定性事件队列、DFF/JK/RS、计数器、移位寄存器、ADC/DAC、混合信号桥、逻辑图/真值表 |
| 依赖 | Phase 5（模拟块/端口/内部视图） |
| 新建 | `netlab/digital.py`；`tests/test_digital.py`；`docs/DIGITAL.md` |
| 修改 | `netlab/blocks.py`（数字块）、`netlab/nodal.py`（桥接元件/采样）、`netlab/scene.py`（数字统计/状态）、`netlab/server.py`（数字配置/状态）、`netlab/static/app.js`（逻辑图/真值表/内部视图）、`netlab/templates.py`（示例） |
| 交付物 | 门真值表、DFF 边沿/寄存器移位/计数器测试；ADC/DAC 量化；混合信号示例；内部逻辑图 |
| 验收 | 真值表/时序测试通过；时钟边沿确定；跨域一步因果明确；无隐藏代数环；保存/重置正确；测试通过 |
| 非目标 | MCU/CPU/RAM/ROM/Flash 指令级仿真、PCB 封装 |

### Phase 7 — 连线路由 + 参数/保存 UX + 撤销

| 项 | 内容 |
| --- | --- |
| 目标 | 连线不遮节点、可直角/直线/手动；参数设置更像常规软件；操作可撤销 |
| 范围 | 路由模式/拐点/锚点/标签/层级/避让；参数分组/说明/默认/校验；撤销重做；保存 UI 完善 |
| 依赖 | Phase 1（保存）、Phase 4（端口） |
| 新建 | `netlab/static/router.js`、`netlab/static/geometry.js`、`netlab/tests-js/*.test.mjs`；`tests` 中路由序列化测试 |
| 修改 | `netlab/scene.py`（route 字段/校验）、`netlab/server.py`（请求模型）、`netlab/static/app.js`（绘制/命中/交互/撤销）、`netlab/static/index.html`、`netlab/static/style.css`、`netlab/project.py` |
| 交付物 | 直线/正交/手动路由；拖动拐点；避让开关；层级；标签拖动；参数表单升级；撤销/重做；保存/恢复 UI 设置 |
| 验收 | JS 几何单测通过；路由保存/加载一致；节点拖动后路由缓存正确失效；参数修改有校验/恢复默认；撤销/重做不破坏运行状态；CDP 截图检查 |
| 数据安全 | route 校验上限；撤销通过服务端快照恢复，恢复时暂停仿真并重置运行时状态（明确提示） |
| 备注 | 自动避障可先做“检测相交 + 简单绕行”，不追求全局最优 |

### Phase 8 — 相图轨迹与回放

| 项 | 内容 |
| --- | --- |
| 目标 | 轨迹更长；可回放、循环；循环时长可自定义并推荐 |
| 范围 | 列式录制器、history API、相图时长/抽稀、回放控件、推荐周期 |
| 依赖 | Phase 1（UI 设置保存）、Phase 2（性能/内存基线） |
| 新建 | `netlab/history.py`（或并入 `simulation.py`）；`tests/test_history.py`；`tests-js/phase.test.mjs` |
| 修改 | `netlab/simulation.py`、`netlab/server.py`、`netlab/static/app.js`、`netlab/static/index.html`、`netlab/static/style.css`、`netlab/project.py` |
| 交付物 | 20k 帧列式录制；`/api/history`；时长制轨迹；回放/循环/速度；推荐周期与依据 |
| 验收 | 内存有上限；长轨迹不卡顿；循环边界正确；自定义时长生效；推荐值与驱动频率/自相关一致；回放不改变仿真；保存/恢复设置；测试通过 |
| 风险 | 内存与抽稀；用容量/最大点数/时间窗三重限制 |

### Phase 9 — 发布与打包（建议但可延后）

| 项 | 内容 |
| --- | --- |
| 目标 | 单文件 exe/安装包；干净 Windows 可运行 |
| 范围 | PyInstaller spec、资源收集、QtWebEngine 打包、图标、版本、日志、卸载 |
| 依赖 | Phase 1–8 稳定 |
| 新建 | `netlab/pyproject.toml`、`netlab/netlab-desktop.spec`、`netlab/tools/build_windows.ps1` |
| 修改 | `netlab/README.md`、桌面启动说明 |
| 验收 | 无 Python 环境启动；静态资源/文档/模板齐全；端口冲突提示；关闭干净；杀软误报已知；冒烟通过 |
| 风险 | PyInstaller 未安装；QtWebEngine 体积大；需要实际干净机验证 |

### 需求 → 阶段映射

| 需求 | 阶段 |
| --- | --- |
| 1 桌面 | Phase 1 |
| 1 性能/GPU | Phase 2 |
| 2 源码/公式/自定义 | Phase 3 |
| 3 功能节点/模块 | Phase 4；电路模块在 Phase 5/6 |
| 4 保存/参数/直觉 | Phase 1 + Phase 7 |
| 5 相图/回放 | Phase 8 |
| 6 连线路由 | Phase 7 |
| 7 电路元件/运放/数字 | Phase 5 + Phase 6 |

---

## 5. 文件修改总表

| 区域 | 现有文件 | 计划新增 |
| --- | --- | --- |
| 桌面 | `netlab/run.py` | `netlab/desktop/*`、`start_desktop.bat`、`requirements-desktop.txt` |
| 项目保存 | `netlab/server.py`、`netlab/simulation.py` | `netlab/project.py` |
| 信号图 | `netlab/graph.py`、`netlab/scene.py` | — |
| 电路 | `netlab/nodal.py`、`netlab/linalg.py` | `netlab/digital.py` |
| 注册表/参数 | `netlab/computes.py`、`netlab/methods.py`、`netlab/params.py`、`netlab/limits.py` | `netlab/extensions.py`、`netlab/blocks.py` |
| FEM/加速 | `netlab/fem.py` | `netlab/accel.py` |
| 前端 | `netlab/static/app.js`、`netlab/static/index.html`、`netlab/static/style.css` | `netlab/static/router.js`、`netlab/static/geometry.js` |
| 模板 | `netlab/templates.py` | 模块/电路/数字示例模板 |
| 测试 | `netlab/tests/test_netlab.py` | `test_desktop.py`、`test_project.py`、`test_accel.py`、`test_extensions.py`、`test_blocks.py`、`test_elements_extra.py`、`test_digital.py`、`test_history.py`、`tests-js/*` |
| 工具 | `netlab/tools/cdp_*.mjs` | `netlab/tools/bench.py`、`netlab/tools/build_windows.ps1` |
| 文档 | `netlab/README.md`、`netlab/docs/ARCHITECTURE.md`、`netlab/docs/EXTENDING.md` | `netlab/docs/PROGRESS.md`、`netlab/docs/USER_GUIDE.md`、`netlab/docs/PYTHON_EXTENSIONS.md`、`netlab/docs/BLOCKS.md`、`netlab/docs/CIRCUIT_LIBRARY.md`、`netlab/docs/DIGITAL.md` |

---

## 6. 验证与质量门禁

### 6.1 每阶段必须运行的命令

```bash
cd E:\Python\MyPython\ProjectPoint
python -m pytest netlab/tests -q
python -m pytest netlab/tests -q -k "desktop or project or extensions or blocks or digital or history"
node --test netlab/tests-js
python -m netlab.desktop --selftest                              # Phase 1 起
python netlab/tools/bench.py --scene control_loop --repeat 5     # Phase 2 起
```

### 6.2 测试层次

| 层次 | 内容 |
| --- | --- |
| 单元 | 数值内核、元件、路由几何、推荐周期、历史缓冲 |
| API | FastAPI TestClient：项目、扩展、模块、路由、history |
| 数值金标 | 现有 43 个 + 模块等价性 + 元件解析解 + 混合信号时序 |
| 前端 JS | Node `--test`：路由、相图循环、抽稀、刷新顺序 |
| 桌面 | `--selftest`（QtWebEngine 不可用则明确 skip 并记录原因） |
| 手工 | 窗口/菜单/文件对话框/关闭确认/拖拽/撤销/相图回放 |
| 浏览器冒烟 | 现有 CDP 脚本 + 新功能截图 |

### 6.3 数据安全专项

- 确定性：同一场景、同一 dt 序列，两次运行帧值完全一致。
- 延迟边：优化前后 `z⁻¹` 语义严格不变。
- 隔离：自定义 handler 修改副本不影响现场；内置快路径有独立测试。
- GPU：CPU/GPU 结果一致；设备同步后才提交；异常回退。
- 原子性：引擎构建失败不替换旧引擎；保存失败不破坏原文件。
- 前端：旧 revision/cursor 响应被忽略；回放不写仿真状态。
- 项目：含代码项目不自动执行；扩展加载失败回滚到上一版本。

### 6.4 性能验收

- 先记录基线：信号链、状态空间闭环、RLC、二极管整流、FEM 默认网格、400 节点合成网络，各场景记录 `step_ms`、FPS、内存与矩阵规模。
- 优化后使用同一脚本、同一场景、同一预热次数对比；报告中给出中位数与波动范围，不只给单次最好值。
- 最低门槛：
  - 任何场景不得出现 **>5%** 的稳定性能回退；
  - 目标改进：信号图 ≥1.5×、线性电路 ≥2×、FEM ≥1.3×；
  - 达不到目标时，保留数据并说明瓶颈，不把未验证的优化写成结论。
- GPU 单独门控：
  - 只在 `CuPy` 可用且规模超过阈值时启用；
  - 与 CPU 结果做一致性测试；
  - 若代表性场景无 ≥1.2× 稳定收益，默认关闭，仅保留实验开关与实测文档。

### 6.5 独立审查

每个阶段完成后执行一次独立审查，审查重点：

1. **计算顺序与状态归属**：延迟边、拓扑序、节点/连接状态是否仍然正确。
2. **数据隔离**：内置快路径是否破坏原有“副本/只读视图”契约；自定义代码是否仍走深拷贝。
3. **并发与锁**：新线程、Qt 主线程、uvicorn 线程之间是否有阻塞或死锁风险。
4. **原子性**：引擎重建、项目保存、扩展热重载失败时是否留下半成品。
5. **兼容性**：旧场景 JSON、旧 API 调用、浏览器模式是否仍可用。
6. **安全边界**：扩展代码信任门控、桌面 token、路径处理、任意文件读写。
7. **测试证据**：新增测试是否真正覆盖失败路径，而不只是 happy path。

审查输出：问题清单 + 严重级别 + 修复建议；严重问题修复后才进入下一阶段。

### 6.6 文档更新（每阶段必做）

- 新建 `netlab/docs/PROGRESS.md`：阶段状态、完成项、验证命令与结果、已知问题、下一阶段。
- 更新 `netlab/docs/ARCHITECTURE.md`：桌面运行时、加速层、模块/端口、扩展、数字引擎、history、routing。
- 更新 `netlab/docs/EXTENDING.md`：新增“应用内 Python 扩展”“功能块封装”“多端子器件块”“数字块”章节。
- 更新 `netlab/README.md`：桌面启动方式、保存/打开、测试数量、GPU 说明、限制。
- 新增用户文档：
  - `docs/USER_GUIDE.md`：桌面操作、保存、参数、连线、相图回放；
  - `docs/PYTHON_EXTENSIONS.md`：扩展 API、参数声明、安全边界、示例；
  - `docs/BLOCKS.md`：模块定义、接口节点、封装、嵌套、参数绑定；
  - `docs/CIRCUIT_LIBRARY.md`：元件清单、模型、参数、Tier A/B/C；
  - `docs/DIGITAL.md`：逻辑语义、时序、混合信号因果、限制。

---

## 7. 架构决策记录（ADR）与风险

### 7.1 关键决策

| 决策 | 选择 | 原因 | 被否方案 |
| --- | --- | --- | --- |
| 桌面技术 | PySide6 + QtWebEngine | 已安装；复用现有 Canvas SPA；原生文件对话框/菜单；Python 同进程 | Electron/Tauri 引入新工具链；原生控件重写成本过高；pywebview 未安装且控制力较弱 |
| 本地服务 | 127.0.0.1 + 随机端口 + 桌面 token | 保留现有 HTTP 架构；避免端口冲突；降低本机其他页面误调风险 | 取消 HTTP 直接 IPC 需重写全部前端请求层 |
| 用户代码 | 本地可信扩展 + 显式信任 + AST 限制 | 满足应用内 Python 编辑；每步调用无 IPC 开销 | 子进程沙箱：每步 IPC 太慢；仅表达式：不满足 Python 需求 |
| GPU | 基准门控、可选、自动回退 | 当前矩阵小，GPU 可能负优化；需实测 | 强制 GPU：可能更慢且增加部署失败面 |
| 模块模型 | BlockDef + 实例 + 端口节点 + 隐藏边 | 不改现有 2 端点边模型；复用拓扑排序与 MNA；支持多端子 | 全局扁平化：状态隔离/嵌套编辑/探针复杂；改 Edge 为多端点：破坏面大 |
| 电路多端子 | 功能块 + 节点别名 | 复用现有元件与求解器；内部电路可编辑 | 直接给 MNA 加任意多端子元件：API/UI/序列化全面改动 |
| 数字仿真 | 独立四态逻辑引擎 + 混合信号桥 | 数字时序确定、可测试；避免用 MNA 硬模拟门电路 | 晶体管级数字电路：慢、易不收敛、首期不可控 |
| 录制 | 列式环形缓冲 | 长轨迹下避免 dict 开销；内存可控 | 继续 list[dict]：20k 帧内存过大 |
| 路由 | 前端几何 + 后端只存 schema | 交互/渲染在浏览器；服务端不参与绘制 | 后端计算路由：增加请求与状态同步成本 |

### 7.2 主要风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| QtWebEngine 打包体积/兼容性 | 安装包大、首次启动慢、杀软误报 | Phase 1 先源码运行验证；Phase 9 单独打包验证；保留浏览器回退 |
| 自定义 Python 代码 | 安全边界被突破、仿真被卡死 | 显式信任、AST 限制、代码哈希、文档警示；后续可加子进程沙箱 |
| 模块展开爆炸 | 节点/边数激增、内存/耗时上升 | 嵌套深度、实例数、展开节点/边上限；装配前预估；错误可读 |
| 电路非线性收敛 | Newton 不收敛、结果异常 | 保留现有限幅/收敛判据；新元件必须带测试；失败不提交状态 |
| 数字-模拟因果 | 跨域反馈出现代数环或一步延迟不直观 | 明确“采样-求值-驱动”顺序；文档标注一步延迟；提供波形验证 |
| app.js 继续膨胀 | 维护困难、冲突多 | 新功能拆到 `router.js`/`geometry.js`/按需脚本；不整体重写 |
| 无 git | 无法回滚/对比 | Phase 0 建议初始化 git 并打基线 tag；若不接受则 zip 备份 |
| 项目文件含代码 | 打开即执行的风险 | 默认不执行；信任确认；显示哈希；禁止远程加载 |
| 长历史内存 | 浏览器/后端内存上涨 | 列式存储 + 容量/时间窗/最大点数三重限制 + 抽稀 |
| API 兼容 | 旧前端/脚本失效 | 新字段全部可选；旧端点保留；项目版本迁移；回归测试 |

### 7.3 明确不做（首期）

- 不重写为原生 Qt 控件界面；保留现有 Canvas SPA。
- 不做 MCU/CPU/RAM/ROM/Flash 指令级仿真。
- 不做 PCB 封装、符号库、布线。
- 不做完整 SPICE 寄生/温度/噪声模型；按 Tier A/B 分级。
- 不做多用户/云端/认证体系；仍是本地单用户工具。
- 不强制 GPU；不以 GPU 作为默认卖点。
- 不在 Phase 1 交付单文件 exe；打包独立成 Phase 9。

---

## 8. 实施顺序与批准方式

### 8.1 推荐执行顺序

```text
Phase 0  基线/回滚/基准/进度文档
Phase 1  桌面外壳 + 项目保存
Phase 2  性能优化 + 可选 GPU
Phase 3  规格自省 + Python 自定义
Phase 4  功能块/模块系统
Phase 5  电路元件 Tier A + 模拟功能块
Phase 6  数字/混合信号
Phase 7  连线路由 + 参数/保存 UX + 撤销
Phase 8  相图轨迹 + 回放
Phase 9  打包发布（可延后）
```

Phase 7/8 可以提前到 Phase 3 之后，因为它们不依赖模块系统；但 Phase 1 的项目保存建议先完成，否则新设置无法持久化。

### 8.2 每阶段 Definition of Done

一个阶段只有同时满足以下条件才算完成：

1. 目标功能可用，且未超出批准范围；
2. 新增/修改代码有对应测试；
3. 全量回归通过；
4. 性能没有不可接受的退步（涉及计算时附基准）；
5. 数据安全/顺序相关测试通过；
6. 独立审查无未解决的严重问题；
7. 文档与 `docs/PROGRESS.md` 已更新；
8. 输出“修改文件、验证结果、已知问题、下一步”报告，然后**停下等待批准**。

### 8.3 批准后第一步做什么

如果批准 Phase 0 + Phase 1，严格按以下顺序执行，不会顺手做 Phase 2：

1. **Phase 0**
   - 若同意：`git init`、建立基线提交与 tag；
   - 若不同意：生成带时间戳的源码备份；
   - 添加 `.gitignore`、`tools/bench.py`、`docs/PROGRESS.md`；
   - 重跑 43 个测试并记录基线基准。
2. **Phase 1**
   - 先做桌面外壳与本地服务生命周期，确认窗口能加载现有页面；
   - 再做项目序列化/反序列化与原生文件对话框；
   - 再做自动保存/最近文件/关闭确认；
   - 最后补测试、文档与独立审查；
   - 报告后停止，等待批准 Phase 2。

### 8.4 阶段完成报告模板

```text
## Phase N 完成报告

### 目标与范围
- 目标：
- 实际完成：
- 未做/延期：

### 修改文件
- 新增：
- 修改：
- 删除：

### 验证结果
- 命令：
- 结果：
- 性能/基准：
- 未覆盖项：

### 已知问题与风险
- ...

### 独立审查结论
- ...

### 下一步
- 建议 Phase N+1：
- 需要确认的决策：
```

---

## 9. 待确认决策

请确认以下默认方案，或指出需要修改的项：

| # | 决策 | 推荐默认 | 备选 |
| --- | --- | --- | --- |
| 1 | 桌面技术 | **PySide6 + QtWebEngine，保留现有 UI** | pywebview / Electron / 原生重写 |
| 2 | 目标平台 | **Windows 10/11 x64；先源码运行，exe 放 Phase 9** | 必须首期交付单文件 exe |
| 3 | Python 自定义 | **本地可信扩展 + 项目打开二次确认 + AST 限制** | 仅受限表达式 / 子进程沙箱 |
| 4 | GPU | **先 CPU 优化，GPU 基准门控、可选、自动回退** | 强制默认 GPU |
| 5 | 电路范围 | **Tier A/B/C 分级；MCU/CPU 不做** | 全清单 SPICE 级 |
| 6 | 模块范围 | **Phase 4 先做 signal/vector；电路模块随 Phase 5/6** | 首期同时做电路模块 |
| 7 | 回放范围 | **Phase 8 先做相图回放/循环；信号图回放可选** | 相图 + 信号图同时做 |
| 8 | 版本控制 | **Phase 0 初始化 git 并打基线 tag** | 不初始化，仅 zip 备份 |

同意推荐方案时，回复类似：

```text
按推荐方案执行 Phase 0 + Phase 1。
```

或直接指出要调整的编号，例如：

```text
3 改为子进程沙箱；5 只做 Tier A；8 不做 git，用 zip 备份。
```

在确认前，不修改任何源码，也不开始下一阶段。

---

## 10. 变更记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| 0.1 | 2026-10-24 | 初稿：需求确认、项目调查、架构设计、Phase 0–9、文件清单、验证门禁、ADR、待确认决策 |
