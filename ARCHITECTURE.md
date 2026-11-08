# Netlab 架构

> 最后更新：2026-11-06

> 读完这份文档，你应该能回答：**代码分成哪几层、各自在哪个目录**、**一次仿真步怎么走完**、**数据从画布到求解器再回到曲线经过了谁**、**想加功能该动哪里**。

## 0. 一句话

Netlab 是**单进程**应用：一个 Python 后端（FastAPI 服务 + 常驻仿真线程 + 场景状态）负责计算，一个纯静态前端负责显示。浏览器/桌面壳只是这个进程的显示层，不参与计算。

> 结构图：[docs/assets/netlab-architecture.svg](docs/assets/netlab-architecture.svg)（2026-11-06 分层版）

## 1. 目录即分层

```
NetlabHome/
├─ frontend/                  ← 前端（浏览器里跑；源码 TypeScript 经 esbuild 编译为提交的 .js）
│   ├─ index.html             页面骨架
│   ├─ app.ts                 前端 TypeScript 源（esbuild → app.js）
│   ├─ app.js                 全部交互与 Canvas 2D 绘制（单文件，编译产物）
│   ├─ style.css              主题与布局
│   └─ desktop-shim.js        桌面壳注入（无边框窗口按钮等）
│
└─ netlab/                    ← 后端（Python 包）
    ├─ server.py              HTTP 接口层（/api/*，薄封装）
    ├─ run.py                 命令行启动（uvicorn + 可选打开浏览器）
    ├─ plotkit_bridge.py      把 PlotKit 以子应用挂到 /plotkit（单向依赖）
    ├─ plugin_api/v1/         插件稳定门面（只导出稳定协议，不导出内核私有模块）
    ├─ desktop/               桌面壳（pywebview + WebView2；无边框窗口）
    ├─ core/                  ← 内核层（不含任何 HTTP / UI 代码）
    │   ├─ compute/           计算：求解器、元件模型、复频域、数字逻辑
    │   ├─ model/             连接与网络：场景、图、工程、块、插件、UI profile、工作区
    │   └─ common/            公共：错误与限额（limits）
    ├─ tests/                 pytest（HTTP + 纯函数 + 工程回归 + 像素）
    └─ docs/                  规格、进度、经验、数学与代码导读
```

> 包根只有真正的入口与适配模块：`__init__.py`、`server.py`、`run.py`、`plotkit_bridge.py`、`vscode_bridge.py`、`cache_guard.py`、`desktop/`、`core/`。**没有历史转发 shim**（D85 已清空并改写全部引用），也没有 PlotKit 源码副本（C-4 收口，PlotKit 作为外部依赖安装）。

> 说明：后端目录就是 `netlab/`（Python 包名必须叫 `netlab`，`python -m netlab.*` 才能工作，所以不再套一层 `backend/`）。前端与后端已经是两个平级目录，互不混淆。

**分层规则**：

| 层 | 目录 | 可以做 | 不可以做 |
| --- | --- | --- | --- |
| 前端 | `frontend/` | DOM / Canvas / HTTP 调用 | import Python、直接读文件 |
| 接口层 | `netlab/server.py`、`run.py`、`plotkit_bridge.py` | 校验请求、调 `SERVICE`、序列化 | 写求解算法 |
| 桌面壳 | `netlab/desktop/` | 开窗口、注入 shim、桥接文件对话框 | 写求解算法 |
| 内核层 | `netlab/core/{compute,model,common}/` | 纯 Python 计算与数据模型 | import server / desktop / 前端 |

## 2. 总体形状

```
┌──────────────────────────────────────────────────────────────────────┐
│ 前端 frontend/（index.html + app.js + style.css）                     │
│  画布渲染 · 参数面板 · 曲线/回放 · 轮询 /api/state + /api/live         │
└───────────────▲──────────────────────────────────┬───────────────────┘
                │ JSON（HTTP/本机）                 │ 用户操作
┌───────────────┴──────────────────────────────────▼───────────────────┐
│ 接口层 netlab/server.py（FastAPI）                                    │
│  请求校验 · 场景增删改 · 工程/工作区文件 · 分析接口 · 控制接口          │
└───────┬───────────────────────┬──────────────────────────────────────────┘
        │                       │
┌───────▼─────────┐    ┌────────▼──────────┐
│ NetworkContainer│    │ BlockLibrary      │
│ 多个 Simulation │    │ 复用子图 / 块定义  │
└───────┬─────────┘    └───────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────────────┐
│ Simulation（core/compute/simulation.py）                              │
│  配置 · 线程循环 · 实时节拍 · 录制器 Recorder · 预计算                 │
└───────┬──────────────────────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────────────┐
│ Scene（core/model/scene.py）：网络 + 引擎 + 参数校验                   │
│   signal/vector → SignalEngine     circuit → CircuitEngine            │
└───────┬──────────────────────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────┐   ┌────────────────────────────────┐
│ graph.Network（信号流，core/model）│   │ nodal.CircuitSolver（MNA，compute）│
│ 节点字典 + 拓扑步进 + 代数环延迟   │   │ 伴随模型 + Newton + 稀疏 LU      │
└──────────────────────────────────┘   └────────────────────────────────┘
```

## 3. 场景数据模型

一个工程（`*.netlab`）是版本化 JSON：

```json
{
  "format": "netlab-project", "version": 6,
  "networks": [ { "id", "name", "mode": "signal|vector|circuit",
                  "nodes": [ { "id", "name", "kind", "position", "params", "data" } ],
                  "edges": [ { "id", "name", "source", "target", "kind", "params" } ] } ],
  "current": "网络 1",
  "ui": { "profile": "netlab-ui/1" }, "plugins": [], "blocks": [], "extensions": {},
  "metadata": { "name", "saved_at" },
  "checksum": "<sha256>"
}
```

- **节点**：画布上的圆形实体。`kind` 决定用哪套处理逻辑；`params` 是静态参数；`data` 是每步更新的动态数据。
- **连接**：有向边。`kind` 决定连接函数；信号模式下是纯函数，电路模式下连接代表元件。
- **网络**：一个工程可含多个网络，`mode` 在网络级固定；同一进程只有一个「当前网络」在跑。
- **校验和**：`core/model/project.py:compute_checksum` 对除 `checksum` 外的负载规范化后取 sha256；任何迁移都要重算。

运行时对象由 `Scene` 持有：`nodes: dict[str, NodeRecord]`、`edges: dict[str, EdgeRecord]`，带 `params`（校验后）与 `state`（跨步状态）。

## 4. 两种计算内核

### 4.1 信号流与矢量（`core/model/graph.py:Network`）

- 每个节点持有一个字典；每条连接是 `(source_view, target_view, params, state, dt) -> dict` 的纯函数。
- 每步按**拓扑顺序**逐个 `update`：连接先从上游取值算出目标输入，再调用节点处理函数。
- 代数环：`algebraic_cycles` 检测，环内边自动插入一步延迟（`delayed=True`），保证可解。
- **事务**：`Network.step` 先 `capture_step_state()`，任一步抛错就 `restore_step_state()`；失败不留半更新现场。
- 不可信（`trusted=False`）处理器拿到的是隔离副本 `state`，成功后原地回写。

### 4.2 电路（`core/compute/nodal.py:CircuitSolver`）

标准 MNA：未知量 = 非接地节点电压 + 需支路电流的元件（独立电压源、VCVS、运放等）。

**一步求解**（`_step_locked`）：

1. `time += dt`，所有元件 `prepare(dt, time)`：电容/电感把储能转成伴随电导 + 电流源；独立源刷新当前值。
2. `_newton_with_strategies()` 求非线性方程组：初始猜值取上一步状态；每轮 `_blank_matrix()` 新建矩阵，逐元件 `stamp()`（`_stamp_conductance` / `_stamp_current`），解 `A·x=b`；残差用**尺度无关的后向误差**；不收敛依次尝试 gmin stepping、source stepping；规模大时用 SciPy 稀疏 LU + 行列均衡。
3. 收敛后逐元件 `commit()`：写 `state` 与 `result`（`current`/`voltage_difference`/`power`…），供 UI 探针读取。
4. 失败恢复本步快照——**一步要么完整推进，要么完全不动**。

**积分方法**（`Scene.integration`）：

| 方法 | 伴随模型 | 特点 |
| --- | --- | --- |
| `trapezoidal` | `g=2C/dt` 等 | 默认，二阶，开关电路可能振铃 |
| `backward_euler` | `g=C/dt` 等 | 一阶，强阻尼，最稳 |
| `gear2` | BDF2 | 二阶，固定步长；历史不足或 dt 变化时退回 BE |

**分析接口**：`operating_point()`（DC 工作点，电容开路、电感 `1e5 S`、源取 t=0，求完恢复检查点）；`ac_sweep(freqs, ...)`（工作点线性化后按 jω 构复数 MNA 逐频求解，含非线性器件会明确报错）。


### 4.3 并网逆变器控制链（`core/compute/computes.py`，R31）

`MyProject/` 提供 P11-01…P11-07 示例：平均模型 `grid_inverter_avg.netlab`（三相电网 + `abc_dq` + 6 状态 LCL `state_space`）、`pll_template.netlab`（SRF-PLL）、`grid_inverter_current.netlab`（dq RL + 双 PI + 前馈解耦）、`grid_inverter_switch.netlab`（六开关三相桥趋势验证）。`sensor`/`actuator` 是跨域桥：`CircuitEngine` 在 MNA 解后采样节点电压，下一拍把执行器值写回受控源，显式一拍延迟。

### 4.4 复数分析层（`core/compute/complex_support.py` + `analysis.frequency_response`，R39）

时域、瞬态、recorder、PlotKit 始终是 `float64`。只在分析边界使用 `complex128`：`as_complex`/`as_complex_array` 转换，`as_real` 在返回前校验虚部。`frequency_response(scene, input, output)` 对 signal 场景建立 `(I-W(jω))y=b` 复数节点方程，延迟边乘精确 `e^{-jωT}`；对 circuit 场景复用 `nodal.ac_sweep` 的复数 MNA。结果包含 `real/imag/magnitude/phase_deg/db` 与 `backend=complex_graph|complex_mna`。

### 4.5 插件引擎模式（`core/model/engine_registry.py`，R40）

现有 `signal`/`circuit`/`vector` 语义不可替换。插件通过 `EngineSpec(mode, factory, node_kinds, edge_kinds)` 注册**新 mode**；`Scene.ensure_engine()` 对非内置 mode 调 `create_engine(mode, scene)`。引擎必须实现 `EngineProtocol.build/step/reset/probes/stats`，节点/边仍是统一 `NodeRecord`/`EdgeRecord`，插件私有状态只放 `params`/`data`/`state` 或 `ext` 子树。

## 5. 参数、元件与扩展

- `core/compute/params.py:ParamSpec` 描述参数键/类型/默认值/单位/范围；`Scene` 增删改时统一 `validate_params`。
- `core/compute/nodal.py:ELEMENT_SPECS` 是元件目录（名称、参数、公式文本、引脚、分组）；`transistors.py`/`logic.py`/`timers.py`/`digital.py`/`magnetics.py` 的规格在导入时合并。
- 目录里的 `formula` 是给人看的，必须与实现一致。
- `core/model/extensions.py`：从 `extensions/nodes/*.py`、`extensions/methods/*.py` 动态加载自定义节点/连接，白名单校验后注册；这是 legacy 兼容层。
- `core/model/plugins.py`：扫描 `extensions/plugins/<id>/plugin.json`，校验 `netlab-plugin/1` manifest 与 `netlab.plugin_api.v1` 版本范围，按依赖拓扑动态导入；插件可注册 compute/method/element/analysis/data_format/panel/visual/template/engine 九类能力。插件不是沙箱，必须显式启用/信任。
- `core/model/blocks.py`：把一组节点封装成可复用块（`encapsulate_nodes`），块实例运行时是嵌套 `Scene`，暴露输入/输出端口；R25 的 9 个内置 structural 块走虚拟注册表，库缺失仍可打开。

## 6. 线程与数据流

```
用户操作 → POST /api/* → 修改 Scene（持有 Simulation.lock）
仿真线程 → Simulation._advance_locked(dt) → Scene.step(dt) → 引擎.step
        → Recorder.push(frame)（含 t、节点电压、元件探针）
前端     → GET /api/state（低频，结构/参数）
        → GET /api/live?cursor=N（高频，仅新帧，≤600 帧/次）
```

- 仿真线程按 `realtime` 决定是否按 `fps × steps_per_frame` sleep。
- `steps_per_frame` 只影响每帧步数，`sample_every` 只影响录制密度，都不改物理步长 `dt`。
- 录制环 1200 帧；超出容量**等间隔降采样**（保留首尾），不截断。

数据通路的关键成本与优化（实测：600 帧 × 7 探针的 `/api/live` 序列化
10.6 ms → 1.6 ms、字节 132 KB → 120 KB；`Recorder.since` 尾部增量 52 µs →
0.8 µs；204 节点 `to_payload` 1.74 ms → 1.07 ms）见
[docs/ARCHITECTURE.md §13.5](netlab/docs/ARCHITECTURE.md)：`/api/live`、
`/api/state`、`/api/scene/export` 走 `server.fast_json()` 跳过
FastAPI 的逐字段编码；前端 `drawChart` 二分定位时间窗并按像素抽稀。

## 7. 前端（`frontend/`）

运行期无需构建：`index.html` 直接加载编译产物 `app.js` 与 `style.css`；前端源码为 TypeScript（`app.ts` / `app.utils.ts`），由本地 esbuild 预编译（`frontend/package.json`）。

- 画布用 Canvas 2D 绘制节点/连线/网格，支持缩放、平移、框选、正交连线。
- 参数面板由 `/api/catalog` 描述数据动态生成，前端不硬编码元件字段。
- 曲线面板维护自己的帧缓冲与回放游标。
- 所有请求走同一个 `api()` 包装（统一超时、错误提示、token 头）。
- 绘图（PlotKit）三种承载：右侧面板内嵌 / 浮窗 / 独立浏览器窗口。

## 8. 依赖规则

```mermaid
graph LR
  FE[frontend/ 静态资源] -->|HTTP| API[server.py 接口层]
  API --> CORE[core/* 内核]
  API --> PLUGINS[plugin_api/v1 + core/model/plugins.py]
  PLUGINS --> CORE
  PLUGINPKG[extensions/plugins/* 插件包] -->|只 import| PLUGINS
  SHELL[desktop/ 桌面壳] --> API
  BRIDGE[plotkit_bridge] -->|单向| PK[PlotKit 包]
  CORE --> COMMON[core/common]
  CORE --> COMPUTE[core/compute]
  CORE --> MODEL[core/model]
```

- **禁止**：`core/**` 不得 import `server`、`desktop`、`frontend`；`PlotKit` 不得 import `netlab`；插件包不得 import `netlab.core.*` 的私有模块，只能 import `netlab.plugin_api.v1`。
- 内核内部 `compute` 与 `model` 目前**允许双向**（例如 `blocks`(model) 用 `computes`(compute)，`computes`(compute) 用 `graph`(model)），这是历史事实；新增代码优先让 `model` 依赖 `compute`。
- 模块引用一律用**规范路径** `netlab.core.<分桶>.<模块>`；旧写法（`from netlab.scene import ...`、`from .graph import ...`）已于 D85 全量改写，包根不再保留转发 shim。新增模块请直接放进对应分桶，不要往 `netlab/` 包根堆文件。

## 9. 想改功能，去哪

| 需求 | 位置 |
| --- | --- |
| 新增电路元件 | `core/compute/nodal.py` 或对应元件模块：子类 + `ELEMENT_SPECS` 条目 + 参数表 |
| 新增信号节点/连接 | `core/compute/computes.py` / `methods.py` + 前端 `AddMenu` 描述 |
| 新增模板 | `core/model/templates.py:TEMPLATES` |
| 新增分析接口 | `server.py` 端点 → `Simulation`/`Scene` 方法 → 引擎实现 |
| 改参数校验 | `core/compute/params.py` + 对应 spec |
| 改工程格式 | `core/model/project.py`（版本迁移 + checksum） |
| 改画布交互 | `frontend/app.ts`（产物 `app.js`）+ `frontend/style.css` |
| 改窗口外观 | `netlab/desktop/webview_app.py` + `frontend/desktop-shim.js` |
| 改绘图接入 | `netlab/plotkit_bridge.py` + `frontend/app.ts` 的 placePlotkit |
| 新增插件能力 | `plugin_api/v1/__init__.py` + `core/model/plugins.py` + `PLUGIN_GUIDE.md` |
| 新增自定义引擎 | `core/model/engine_registry.py` + 实现 `EngineProtocol` 的插件包 |
| 改 UI 主题/布局 | `core/model/ui_profile.py` + `frontend/style.css` + `frontend/app.ts` 的 applyUiTokens |

## 10. 不变式（改动时别破坏）

1. **场景可序列化**：任何状态都能进 `to_payload`，并能从 payload 完整重建。
2. **一步事务**：`Scene.step` 失败后，时间、解、元件状态必须与调用前一致。
3. **参数即契约**：`spec.params` 是校验与 UI 的唯一来源。
4. **公式即文档**：`ELEMENT_SPECS.formula` 必须描述实际算法。
5. **分层单向**：内核不依赖接口层与前端；PlotKit 单向。
6. **本机优先**：默认只监听 `127.0.0.1`，无外链资源与遥测。
7. **插件数据严格 JSON**：插件输入/输出只能 JSON 原生类型；NumPy 数组转列表，复数统一 `{re,im}` 或 magnitude/phase。
8. **Node/Edge 结构稳定**：插件私有字段只进 `params`/`data`/`state` 或 `ext` 子树，不新增/重命名核心记录字段。

---

配套文档：数学推导见 [netlab/docs/MATH.md](netlab/docs/MATH.md)，逐模块导读见 [netlab/docs/CODE_GUIDE.md](netlab/docs/CODE_GUIDE.md)，需求与决策见 [netlab/docs/REQUIREMENTS_AND_RULES.md](netlab/docs/REQUIREMENTS_AND_RULES.md)。
