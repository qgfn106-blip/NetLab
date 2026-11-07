# Netlab 代码导读

> 面向**接手这个仓库的工程师**。目标：半天内建立地图，知道“某个功能该改哪个文件”，并能安全地加东西。
>
> 本文所有事实均来自当前工作树（2026-11-07 复核）的代码，结论后附 `文件:行` 证据。行数为 `wc -l` 的实测值（取整到个位）。
>
> 编码/格式规范（Python black+flake8、前端 TypeScript+esbuild）以 [CODE_STANDARDS.md](CODE_STANDARDS.md) 为唯一 SSOT（决策 D119）。
>
> 注意：`server.py` / `run.py` / `plotkit_bridge.py` 位于 **`netlab/` 包根**，不是仓库根 `NetlabHome/`。

---

## 0. 30 秒心智模型

Netlab 是一个“搭网络 → 点运行 → 看波形”的离散仿真台。四个事实决定了整个代码形状：

1. **两种仿真语义并存**：`signal`（字典数据沿有向边传播）与 `circuit`（节点电压法 MNA，支持反馈/双向元件），另有 `vector`（二维矢量场）。三者由 `Scene` 统一装配，见 `netlab/core/model/scene.py:172`（SignalEngine）与 `:507`（CircuitEngine）。
2. **`Scene` 是模型，`Simulation` 是驱动器**：`Simulation` 持后台线程、锁、配置和录制环形缓冲；`NetworkContainer` 管理一个工程里的多条网络，并把属性访问转发给“当前网络”。
3. **后端只有一个进程内单例 `SERVICE`**：FastAPI 的每个 `/api/*` 端点几乎都是对 `SERVICE` 的一行转调（`netlab/server.py:101`）。
4. **前端是 TypeScript 源码经 esbuild 构建的静态资源**：`frontend/`（`app.ts`/`app.utils.ts`/`desktop-shim.ts` 等）由 `frontend/package.json` 的 esbuild 脚本编译为 `*.js`，再由 FastAPI 的 `/static` 挂载；前端与后端只通过 HTTP JSON 通信，不 import 任何 Python。

一句话数据流：

```
frontend/app.js  ──HTTP──▶  netlab/server.py (SERVICE)  ──▶  Simulation  ──▶  Scene/Engine  ──▶  Recorder
      ▲                                                                                              │
      └──────────────────── GET /api/live?cursor=… ◀──────────────────────────────────────────────┘
```

---

## 1. 目录地图

```
NetlabHome/
├─ frontend/                 # TypeScript 源 + esbuild 产物：index.html / app.ts(+app.js) / app.utils.ts(+.js) / style.css / desktop-shim.ts(+.js) / package.json / tsconfig.json
│  ├─ index.html             # 单页骨架：各 tab-pane 容器、脚本入口
│  ├─ app.ts / app.js        # 全部前端逻辑源码（app.ts，esbuild 编译为 app.js）：画布、面板、轮询、绘图、相图播放
│  ├─ style.css              # 全部样式
│  └─ desktop-shim.ts/.js    # 桌面壳（pywebview）注入的 Promise→QWebChannel 风格原生桥适配（ts 源 → js 产物）
│
├─ netlab/                   # Python 包（后端 + 测试 + 文档）
│  ├─ core/                  # 内核层（本次结构整理的目标）
│  │  ├─ compute/            # 计算：求解器、元件/节点边算法、分析、参数模式、功率电子(powerelectronics)、原理图导出(schematic_export)
│  │  ├─ model/              # 连接与网络：Scene、图、功能块、工程文件、模板、工作区、端口契约(ports)、图纸模型(schematic)、视图配置(ui_profile)
│  │  └─ common/             # 公共：limits（上限、错误类型、类型转换）、fastcopy（状态快拷贝）
│  ├─ desktop/               # 桌面壳：当前入口是 pywebview + WebView2（另有遗留 Qt 文件）
│  ├─ tests/                 # pytest 测试（91 个 test_*.py 文件）
│  ├─ docs/                  # 文档（需求/决策/进度/本导读都在这里）
│  ├─ server.py              # FastAPI 应用与全部 /api 端点（≈2.4k 行）
│  ├─ run.py                 # 一键启动：uvicorn + 自动开浏览器
│  ├─ plotkit_bridge.py      # 把 PlotKit 作为子应用挂到 /plotkit（可选依赖）
│  └─ （无 shim）             # D85：33 个转发 shim 已删除，引用全部用 netlab.core.*
│
└─ tools/
   └─ reorg_core.py          # 一次性结构整理脚本（历史记录，见 §6）
```

每个目录一句话职责：

| 目录 | 职责 |
| --- | --- |
| `frontend/` | 浏览器端全部 UI 与绘图逻辑；TypeScript 源码经 esbuild 构建为静态 js，无第三方运行时框架/打包器。 |
| `netlab/` | Python 包根：服务入口、启动器、集成桥（shim 已于 D85 清空）。 |
| `netlab/core/compute/` | 不关心“场景怎么存”的计算内核：MNA 求解、节点/边算法、分析。 |
| `netlab/core/model/` | 关心“场景长什么样”的模型层：记录、图、功能块、工程文件、模板、工作区。 |
| `netlab/core/common/` | 全内核共享的上限常量、错误类型与安全类型转换。 |
| `netlab/desktop/` | 桌面壳：在后台线程起 uvicorn，用 pywebview 承载同一个 Web 前端。 |
| `netlab/tests/` | pytest 用例，覆盖求解器、场景、工程、API、模块、前端契约等。 |
| `netlab/docs/` | 需求与决策台账、架构、进度、导读。 |
| `tools/` | 仓库级一次性/维护脚本。 |

---

## 2. 模块清单

> 行数为 `wc -l` 实测。`__init__.py` 均为 1 行说明，不单列。

### 2.1 计算（`netlab/core/compute/`，合计 13,224 行，27 个模块）

| 模块 | 行数 | 职责 |
| --- | ---: | --- |
| `nodal.py` | 2739 | 节点电压法（MNA）瞬态电路求解器：元件、装配、Newton、AC/工作点。 |
| `computes.py` | 1550 | 信号层**节点**计算方式注册表（`COMPUTE_SPECS`）与 `solver_traits()` 求解语义标签。 |
| `circuit_modules.py` | 788 | 电路模块封装/实例化（把子电路变成可复用块）。 |
| `methods.py` | 719 | 信号层**连接（边）**计算方式注册表（`METHOD_SPECS`）。 |
| `simulation.py` | 745 | 固定步长仿真循环、配置、录制缓冲、后台线程。 |
| `analysis.py` | 1089 | 分析旁路：指标、频谱、周期推荐、传递函数（支持线性网络节点方程 + 反馈环、s 域延迟 Padé、z 域显式延迟）、s 域 TF 分析、网络 Bode、相平面指标、A/B/C/D 导出、复数频响、CSV 导出。 |
| `analysis_plugins.py` | 95 | R40 插件分析算法注册表：`AnalysisSpec`、`run_analysis()`、结果信封校验。 |
| `complex_support.py` | 80 | 复数边界适配：`as_complex`/`as_real`/`complex_parts`/`map_complex`/`phase_degrees`；时域仍走实数。 |
| `transistors.py` | 620 | 三极管/MOS 行为模型及其元件规格。 |
| `digital.py` | 396 | 4 位计数器、4 位 DAC 等行为级数字/模拟接口。 |
| `magnetics.py` | 329 | 变压器与互感线圈（双端口磁耦合）。 |
| `powerelectronics.py` | 379 | R15 功率电子/电机：晶闸管/IGBT/JFET（Ron/Roff 分段线性）、继电器（线圈驱动触点）、直流电机（反电动势 + 机械一阶，后向欧拉）。 |
| `schematic_export.py` | 189 | R18/R19 SchemDraw 静态原理图导出：元件映射、网格回退、打印图框与标题栏（可选依赖，缺失抛 `ComputeError`）。 |
| `telemetry_quality.py` | 91 | 遥测质量评估：采样步长、插值误差界、FIFO 延迟界。 |
| `safeexpr.py` | 232 | 受限算术表达式求值（不执行任意 Python）。 |
| `accel.py` | 218 | 可选加速后端：NumPy / CuPy。 |
| `linalg.py` | 232 | 数值内核：稳定求解、矩阵指数、连续系统离散化。 |
| `params.py` | 211 | **`ParamSpec`**：节点/元件参数的统一定义、校验、序列化。 |
| `statespace.py` | 194 | 连续/离散状态空间模型与离散化。 |
| `fields.py` | 93 | 读取端字段兼容层：`value` 优先、显式键优先、歧义报错；节点/边/状态空间/块端口共用。 |
| `transfer.py` | 825 | s 域传递函数：表达式解析、TF→可控标准型、Bode、阶跃（含峰值时间/峰值）、零极点分析。 |
| `logic.py` | 196 | 逻辑门行为模型。 |
| `timers.py` | 182 | 555 定时器与 LDO 行为模型。 |
| `profiling.py` | 162 | 计时装饰器与环形采样。 |
| `waveform.py` | 114 | 标准波形发生器（电压源/电流源/信号节点共用）。 |
| `introspection.py` | 72 | 规格自省：把注册表条目转成前端可展示的公式/源码/参数说明。 |

### 2.2 连接与网络（`netlab/core/model/`，合计 11,306 行，17 个模块）

| 模块 | 行数 | 职责 |
| --- | ---: | --- |
| `scene.py` | 2036 | **`Scene`**：把可序列化的节点/边记录装配成可运行引擎（SignalEngine/CircuitEngine/插件 mode）；`set_algebraic_solver()` 开启 R36 P2/P3 代数环求解；`SignalEngine.probes()` 暴露 `state:<node>:<index>` 状态通道；block 节点 `internal_sim` 参与实例缓存键。 |
| `plugins.py` | 635 | R40 插件包管理：manifest 校验、依赖拓扑、动态加载/卸载、能力校验、启用状态与 `get_plugin_manager()`。 |
| `engine_registry.py` | 55 | R40 插件引擎注册表：新 mode 的 `EngineSpec` 与 `create_engine()`；拒绝覆盖内置三模式。 |
| `ui_profile.py` | 109 | R40 `netlab-ui/1`：主题令牌、布局、simple/professional 模式归一化（令牌→CSS 变量，不执行插件 HTML/CSS/JS）。 |
| `templates.py` | 1447 | 内置模板（16 个：信号链、控制环、RC/RLC、运放、三极管……）与 `SIM_PRESETS`。 |
| `project.py` | 981 | `.netlab` 工程文件的构建、校验、迁移（v5→v6）、checksum、原子保存/加载、`plugins` 锁段。 |
| `blocks.py` | 1142 | 功能块系统：`BlockDef`/`PortDef`，把网络封装成带端口的节点；`BlockRuntime` 行为/结构双路径、`compare_block_modes()`。 |
| `blocklib.py` | 725 | 模块库文件层：模块文件读写、版本、扁平/目录布局；R25 内置块虚拟注册表与只读保护。 |
| `builtins.py` | 557 | R25 内置只读 structural 块（opamp/comparator/dff/counter4/shift4/timer555/ldo/adc4/dac4），随代码发布、空库可打开。 |
| `block_behavior.py` | 144 | R25 内置块的行为快速模型：opamp/comparator/dff/counter4/shift4/timer555/ldo/adc4/dac4 的纯 Python 端口时序与状态。 |
| `extensions.py` | 603 | 应用内 Python 扩展：节点、连接函数与参数声明。 |
| `graph.py` | 1076 | **`Network`**（有向节点/连接图）、`Node`、`Connection`、`ComputeContext`、`SolverPlan`（R36/P1 断点 + SCC）与 `_step_solved()`（R36/P2 线性 SCC / P3 阻尼 Newton）。 |
| `workspace.py` | 515 | 工作区：工程目录、共享库、用户设置、快照。 |
| `schematic.py` | 480 | 图纸模型数据层：引脚表（`ELEMENT_PINS`）、确定性分层自动布局（`auto_layout`）、校验（`validate_schematic`）。 |
| `networks.py` | 328 | **`NetworkContainer`**：多网络容器，属性访问转发到当前网络，持久化 `ui`/`plugins`。 |
| `block_validate.py` | 253 | 模块导入前校验（阻断级/警告级 + 干跑一步）。 |
| `ports.py` | 220 | 端口契约：器件节点引脚声明、`PortSpec`/`PinSpec`。 |

### 2.3 公共（`netlab/core/common/`，合计 298 行）

| 模块 | 行数 | 职责 |
| --- | ---: | --- |
| `limits.py` | 267 | 上限常量（节点/边/字段/字节数）、错误类型（`NetlabError` 家族）、`as_*` 安全转换。 |
| `fastcopy.py` | 31 | 状态快拷贝工具（`copy_state`），只读路径加速。 |

### 2.4 服务与外壳

| 模块 | 行数 | 职责 |
| --- | ---: | --- |
| `netlab/server.py` | 2438 | FastAPI 应用：静态前端、全部 `/api/*` 端点、`SERVICE` 单例、PlotKit 挂载、复数频响、块行为/结构对比、插件管理/分析/UI profile。 |
| `netlab/run.py` | 121 | 启动器：解析 `--host/--port`，起 uvicorn，健康检查后开浏览器。 |
| `netlab/plotkit_bridge.py` | 708 | 把 PlotKit 子应用挂到 `/plotkit`；探针帧同步 + `analysis:` 独立分析曲线数据集（不随 recorder t 追加）。 |
| `netlab/desktop/__main__.py` | 22 | 桌面入口：`python -m netlab.desktop` → `webview_app.main()`。 |
| `netlab/desktop/webview_app.py` | 430 | **当前桌面壳**：pywebview + WebView2，注入 `desktop-shim.js`。 |
| `netlab/desktop/webview_bridge.py` | 275 | pywebview 原生桥：文件对话框、工程读写、窗口状态。 |
| `netlab/desktop/server_host.py` | 97 | 在后台线程启动现有 uvicorn/FastAPI，选择空闲端口。 |
| `netlab/desktop/app.py` | 87 | 遗留 Qt 入口（PySide6），当前不被 `__main__` 使用。 |
| `netlab/desktop/bridge.py` | 288 | Qt 回退壳的 `QWebChannel` 桥（默认不加载，仅 `python -m netlab.desktop.app` 用）。 |
| `netlab/desktop/main_window.py` | 281 | Qt 回退壳主窗口（默认不加载）。 |
| `netlab/desktop/selftest.py` | 109 | 无人工点击的后端/前端冒烟检查。 |

> 桌面壳现状：`netlab/desktop/__init__.py` 的 docstring 仍写着 PySide6/QtWebEngine，但 `__main__.py:15` 实际导入的是 `webview_app.main`（pywebview）。Qt 原生界面已于 2026-11-02 备份到分支后删除。读代码以 `webview_app.py` / `webview_bridge.py` 为准。

### 2.4.1 插件 API（`netlab/plugin_api/v1/`）

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `__init__.py` | 226 | 稳定插件门面：规格 dataclass、`EngineProtocol`、`PluginContext.register_*`；插件只允许依赖此模块。 |

### 2.5 前端

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `frontend/app.ts`（源）/ `app.js`（esbuild 产物） | 15634 / 14119 | 全部前端逻辑：API 封装、画布、面板渲染、实时轮询、图表绘制、相图播放条、CSV/A-B-C-D 导出、PlotKit 发送、块行为/结构对比、插件管理/视图设计。 |
| `frontend/index.html` | 689 | 单页骨架：各 `tab-pane` 容器与脚本入口。 |
| `frontend/style.css` | 2280 | 全部样式（含主题变量）。 |
| `frontend/desktop-shim.ts`（源）/ `.js`（产物） | 376 / 308 | 桌面模式下把 Promise 风格原生桥映射成 QWebChannel 风格。 |

---

## 3. 关键符号索引

### 3.1 场景与仿真

| 符号 | 签名（摘） | 作用 | 位置 |
| --- | --- | --- | --- |
| `Scene` | `class Scene(mode: str = "signal")` | 场景门面：节点/边记录、引擎选择、步进、探针、检查点。 | `netlab/core/model/scene.py:767` |
| `Scene.step` | `step(dt: float) -> dict[str, Any]` | 推进一个仿真步；先 `ensure_engine()` 再调引擎 `step`。 | `scene.py:875` |
| `Scene.ensure_engine` | `ensure_engine() -> _Engine` | 按 `mode` 惰性创建并缓存 Signal/Circuit 引擎。 | `scene.py:792` |
| `Scene.probes` | `probes() -> dict[str, float]` | 收集本步可录制/可绘制的标量探针。 | `scene.py:893` |
| `Scene.capture_checkpoint` / `restore_checkpoint` | `capture_checkpoint() -> dict` / `restore_checkpoint(checkpoint) -> None` | 步失败/超时时的事务回滚。 | `scene.py:806` / `:810` |
| `Scene.catalog` | `catalog() -> dict[str, Any]` | 给前端的元数据总表：模式、compute、method、element、限制。 | `scene.py:1931` |
| `Scene.add_node` / `add_edge` | `add_node(...)` / `add_edge(...)` | 场景变更入口（带校验与命名）。 | `scene.py:1339` / `:1482` |
| `SignalEngine.step` | `step(dt: float) -> None` | 调 `self.network.step(dt)`，失败时回滚各功能块内部场景。 | `scene.py:396` |
| `CircuitEngine.step` | `step(dt: float) -> None` | 调 `self.solver.step(dt)`，再把解映射回节点 `voltage`。 | `scene.py:670` |
| `Simulation` | `class Simulation(scene: Scene \| None = None)` | 持场景、`SimConfig`、锁、后台线程、`Recorder`。 | `netlab/core/compute/simulation.py:124` |
| `SimConfig` | `@dataclass class SimConfig` | `fps/dt/steps_per_frame/sample_every/realtime/…` 与 MNA 容差、稀疏策略。 | `simulation.py:30` |
| `Recorder` | `@dataclass class Recorder(capacity=RECORDER_CAPACITY)` | 环形缓冲，`push(time, probes)` / `since(cursor, limit)`。 | `simulation.py:63`（容量常量 `:26`，`RECORDER_CAPACITY=1200`） |
| `Simulation.start` / `pause` / `toggle` / `step_once` | `start() -> None` 等 | 运行状态控制；`step_once` 供“单步”按钮。 | `simulation.py:246` / `:253` / `:257` / `:263` |
| `Simulation._advance_locked` | `_advance_locked(dt, sample_every) -> bool` | **一步仿真的真正落点**：断点、检查点、`scene.step`、超时、`recorder.push`。 | `simulation.py:189` |
| `Simulation.live` | `live(cursor: int, limit: int = 400) -> dict` | 返回自 `cursor` 之后的新帧（超限时均匀降采样）。 | `simulation.py:579` |
| `Simulation.snapshot` | `snapshot() -> dict` | 给 `/api/state` 的完整状态。 | `simulation.py:571` |
| `NetworkContainer` | `class NetworkContainer(initial: Simulation, *, name: str = "网络 1")` | 多网络容器，持 `RLock`、id→Simulation 映射、当前网络。 | `netlab/core/model/networks.py:31` |
| `NetworkContainer.__getattr__` | `__getattr__(name: str) -> Any` | **把所有未知属性转发给当前 `Simulation`**（所以 `SERVICE.live(...)` 可用）。 | `networks.py:75` |
| `NetworkContainer.build_project` / `load_project` | `build_project() -> dict` / `load_project(...) -> ...` | 多网络 ↔ 工程载荷的互相转换。 | `networks.py:203` / `:268` |

### 3.2 计算内核

| 符号 | 签名（摘） | 作用 | 位置 |
| --- | --- | --- | --- |
| `CircuitSolver` | `class CircuitSolver(...)` | MNA 求解器主体：索引、装配、Newton、稀疏/稠密、工作点、AC。 | `netlab/core/compute/nodal.py:1612` |
| `CircuitSolver.step` | `step(dt: float) -> dict[str, Any]` | 推进一个瞬态步。 | `nodal.py:1798` |
| `CircuitSolver.operating_point` | `operating_point() -> dict[str, Any]` | DC 工作点。 | `nodal.py:2269` |
| `CircuitSolver.ac_sweep` | `ac_sweep(frequencies, *, input_source=None, probes=None)` | 小信号 AC 扫频。 | `nodal.py:2335` |
| `CircuitElement` | `class CircuitElement` | 元件基类；子类含 `Resistor/Capacitor/Inductor/VoltageSource/…`（如 `Resistor:218`、`Capacitor:239`、`Diode:634`）。 | `nodal.py:147` |
| `ElementSpec` | `class ElementSpec` | 元件“规格 + 构造 + 元数据”的描述对象。 | `nodal.py:973` |
| `ELEMENT_SPECS` | `dict[str, ElementSpec]` | 元件注册表（39 种 kind）；晶体管/逻辑/定时器/数字/磁件/功率电子在文件尾部循环追加。 | `nodal.py:1010`、追加循环 `:2646-2676` |
| `element_spec` / `create_element` | `element_spec(kind: str) -> ElementSpec` / `create_element(...)` | 按 kind 取规格、创建元件实例。 | `nodal.py:1327` / `:1334` |
| `element_catalog` / `node_catalog` | `element_catalog() -> list[dict]` / `node_catalog() -> list[dict]` | 给前端的元件/电路节点元数据。 | `nodal.py:1490` / `:1560` |
| `ComputeSpec` | `@dataclass class ComputeSpec` | 信号层节点算法描述：`kind/label/params/factory/inputs/…`。 | `netlab/core/compute/computes.py:43` |
| `COMPUTE_SPECS` / `register` | `dict[str, ComputeSpec]` / `register(spec) -> ComputeSpec` | 节点算法注册表（22 种 kind）与注册函数（重复 kind 直接报错）。 | `computes.py:63` / `:128` |
| `compute_catalog` | `compute_catalog() -> list[dict]` | 把注册表导出给前端。 | `computes.py:1504` |
| `fields.*` | `resolve_field(...) -> str` / `read_numeric(...) -> float` / `read_node_numeric(node, requested=None) -> float` / `resolve_output(requested=None) -> str` | 读取端字段兼容层：显式键优先，否则数值型 `value`→`voltage`→唯一数值键；歧义/无匹配报中文错误并列出可用键。 | `netlab/core/compute/fields.py:36/70/88/97` |
| `ParamSpec` | `@dataclass(frozen=True) class ParamSpec` | 参数模式：`type/default/unit/min/max/choices/…` + `coerce()`。 | `netlab/core/compute/params.py:31` |
| `analysis.*` | `analyze_metrics / spectrum / recommend_period / transfer_function / tf_analysis / phase_metrics / export_csv` | 分析旁路函数族；`tf_analysis` 支持表达式/系数/零极点/场景节点/线性网络总传函（输入/输出节点）五种输入；`phase_metrics` 输出轨迹长度、包围面积、极值/终值/超调。 | `netlab/core/compute/analysis.py:85/200/266/404/649/148/991` |
| `TransferFunction` | `@dataclass class TransferFunction(num, den)` | s 域有理式：零极点、稳定性、TF→可控标准型、求值、频响、表达式输出。 | `netlab/core/compute/transfer.py:310` |
| `parse_expression` / `from_params` | `parse_expression(text: str) -> TransferFunction` / `from_params(params) -> TransferFunction` | 解析 `s` 表达式（隐式乘法/整数幂/负指数）；按 `form=expr|coeff|zpk` 构造。 | `transfer.py:530` / `:548` |
| `analyze` | `analyze(tf, dt=None, duration=None, method="zoh", points=240) -> dict` | 一次给出 Bode、阶跃、零极点、DC 增益与稳定性。 | `transfer.py:788` |
| `METHOD_SPECS` / `register` / `method_catalog` | `dict[str, MethodSpec]` / `register(spec)` / `method_catalog() -> list[dict]` | 数值方法注册表（12 种 kind）与导出。 | `netlab/core/compute/methods.py:41/44/695` |

### 3.3 模型与工程

| 符号 | 签名（摘） | 作用 | 位置 |
| --- | --- | --- | --- |
| `Node` / `Connection` / `Network` | `class Node` / `class Connection` / `class Network(*, auto_delay=False, solve_algebraic=False)` | 信号层图模型；`Network.step(dt)` 默认拓扑推进，`solve_algebraic=True` 时走 `_step_solved()` 解 SCC；`solver_plan()` 返回 R36/P1 的断点 + SCC 执行计划。 | `netlab/core/model/graph.py:162` / `:289` / `:360` |
| `ComputeContext` / `NodeData` | `class ComputeContext` / `NodeData` | 计算 handler 的输入上下文与节点数据别名。 | `graph.py:147` / `:35` |
| `PortDef` | `class PortDef` | 功能块端口定义（名称/方向）。 | `netlab/core/model/blocks.py:80` |
| `BlockDef` | `@dataclass class BlockDef(id, name, mode, description, nodes, edges, ports, …)` | 功能块定义；`model` 取 `behavioral/structural`。 | `blocks.py:129` |
| `blocklib.*` | `read_block_file / validate_block_structure / render_block_file / blocks_root / …` | 模块库文件层；**仓库中没有 `BlockLibrary` 类**，库能力由这些函数 + `BlockDef` 承担。 | `netlab/core/model/blocklib.py:127/104/72/147` |
| `compute_checksum` | `compute_checksum(payload: dict) -> str` | 去掉 `checksum` 字段后规范化 JSON 的 SHA-256。 | `netlab/core/model/project.py:86` |
| `verify_checksum` | `verify_checksum(payload) -> bool` | 兼容新旧两种规范化方式的校验。 | `project.py:96` |
| `load_project` / `save_project` | `load_project(path, …)` / `save_project(path, payload, …)` | 工程加载（含迁移）与原子保存。 | `project.py:910` / `:965` |
| `atomic_write` | `atomic_write(path, payload) -> Path` | 写临时文件后替换，旧文件备份为 `.bak`。 | `project.py:874` |
| `build_project` / `validate_project` / `migrate_project` | `build_project(...)` / `validate_project(project, …)` / `migrate_project(payload)` | 工程构建、校验、版本迁移。 | `project.py:121` / `:682` / `:503` |
| `TEMPLATES` / `build_template` | `dict[str, dict]` / `build_template(name) -> dict` | 模板表（16 个）与实例化。 | `netlab/core/model/templates.py:1307` / `:1440` |

### 3.4 服务与集成

| 符号 | 签名（摘） | 作用 | 位置 |
| --- | --- | --- | --- |
| `SERVICE` | `SERVICE: NetworkContainer = NetworkContainer(default_simulation(), name="网络 1")` | **进程内唯一仿真服务单例**，所有端点围绕它。 | `netlab/server.py:101` |
| `app` | `FastAPI(title="Netlab 拓扑网络仿真", …)` | 应用对象；`/static` 挂载前端，lifespan 起停线程。 | `server.py:127` 起（`/static` 在 `:133`） |
| `/api` 端点组织 | 见 §3.4.1 | 端点按“元数据 / 控制 / 节点 / 连接 / 模板与场景 / 工程 / 多网络 / 工作区 / 分析 / 模块 / 扩展”分段。 | `server.py:241` 起的分段注释 |
| `plotkit_bridge.mount` | `mount(app, service=None) -> bool` | 挂载 `/plotkit` 子应用并起同步线程；缺依赖返回 `False`。 | `netlab/plotkit_bridge.py:669`（`MOUNT_PATH="/plotkit"` `:22`） |
| `plotkit_bridge.build_figure` | `build_figure(service) -> Any` | 用服务探针构造 PlotKit figure。 | `plotkit_bridge.py:348` |
| `run.main` | `main()` | uvicorn 启动 + 浏览器打开。 | `netlab/run.py`（`parse_args` / 入口） |
| `desktop.webview_app.main` | `main()` | 桌面壳入口。 | `netlab/desktop/webview_app.py`（由 `__main__.py:15` 调用） |

#### 3.4.1 `/api` 端点分组（`netlab/server.py`）

| 分组 | 代表端点 | 行 |
| --- | --- | --- |
| 页面与元数据 | `GET /`、`/api/catalog`、`/api/state`、`/api/live`、`/api/health` | `445/642/747/752/929` |
| 仿真控制 | `POST /api/control`、`POST /api/solve-window`、`GET /api/operating-point`、`GET /api/ac-sweep`、`POST /api/mode` | `955/978/986/994/1028` |
| 节点 | `POST /api/nodes`、`DELETE /api/nodes/{id}`、`POST /api/positions` | `1041/1069/1131` |
| 连接 | `POST /api/edges`、`DELETE /api/edges/{id}` | `1078/1125` |
| 模板与场景 | `GET /api/templates`、`POST /api/templates/{name}`、`GET/POST /api/scene…` | `1139/1144/1152/1166` |
| 工程文件 | `GET /api/project`、`POST /api/project/{export,validate,retry,import}` | `1261/1266/1271/1360/1386` |
| 多网络 | `GET/POST /api/networks`、`…/activate`、`…/run-all`、`…/pause-all` | `1404/1414/1430/1441/1446` |
| 工作区 | `GET /api/workspace`、`…/create|save|open|snapshots|snapshot|restore` | `1493…1602` |
| 分析 | `GET /api/analysis/{metrics,spectrum,period,math,transfer}`、`POST /api/analysis/export` | `1703/1716/1725/1734/1739/1813` |
| 图纸 / 性能 | `GET/POST /api/schematic/layout`、`GET /api/schematic/validate`、`GET /api/profile` | `1830/1835/1847/1852` |
| 导出 / 帮助 | `GET /api/export/schematic`、`GET /api/help/search`、`GET /api/help/doc` | `1157/462/608` |
| 功能块 | `GET /api/blocks`、`…/validate`、`…/{id}/open-internal`、`…/save-copy`、`…/references` | `1883/1901/1944/2007/2029` |
| 扩展 / 文档 | 应用内 Python 扩展、应用内文档中心 | `2312` 起、`2280` 起 |

---

## 4. 调用链：从“用户点运行”到“曲线出现在前端”

以信号/电路网络为例。

| # | 发生处 | 代码 | 做了什么 |
| ---: | --- | --- | --- |
| 1 | 浏览器 | `frontend/app.ts:13314` `ui.runBtn.addEventListener('click', () => void control('toggle'))` | 运行按钮触发 `control('toggle')`。 |
| 2 | 浏览器 | `app.ts:10612` `control()` → `:10594` `networkControl()` | 组装 `{action:'toggle'}`，`jsonRequest('/api/control', 'POST', …)`（`jsonRequest` 定义见 `:1059`）。 |
| 3 | HTTP | `POST /api/control` | 请求进入 FastAPI。 |
| 4 | `server.py:955` `control()` | `SERVICE.toggle()` | 降级只读时拒绝；否则按 action 调 `start/pause/toggle/step_once/zero_time/reset`。返回 `{"sim": SERVICE.info()}`。 |
| 5 | `networks.py:77` `__getattr__` | 属性转发到当前 `Simulation` | `NetworkContainer` 把 `toggle` 转给当前网络。 |
| 6 | `simulation.py:370` `toggle()` | 置 `running` | 后台 `_loop()`（`:274`）开始按 `fps` 循环。 |
| 7 | `simulation.py:302` `_advance_locked()` | 断点 → `capture_checkpoint` → `scene.step(step_dt)` | 真正推进一个仿真步；异常/超时会 `restore_checkpoint` 并暂停。 |
| 8 | `scene.py:987` `Scene.step()` | `ensure_engine().step(dt)` | 选择并调用引擎。 |
| 9 | 引擎 | `SignalEngine.step`（`scene.py:418`）→ `Network.step`（`graph.py:699`）；或 `CircuitEngine.step`（`scene.py:765`）→ `CircuitSolver.step`（`nodal.py:1798`） | 完成本步计算。 |
| 10 | `simulation.py` `_advance_locked` | `self.recorder.push(self.time, self.scene.probes())` | 把 `{seq, t, v}` 推入环形缓冲（`Recorder.push` `:110`）。 |
| 11 | 浏览器轮询 | `app.ts:10551` `pollLoop()` → `:10473` `pollLive()` | 运行中每 110ms、空闲每 500ms 轮询；`GET /api/live?cursor=…&limit=600`（`:10482`）。 |
| 12 | `server.py:752` `live()` | `SERVICE.live(cursor, limit)` → `Simulation.live`（`simulation.py:715`）→ `Recorder.since`（`:135`） | 返回游标之后的新帧。 |
| 13 | 浏览器 | `pollLive` 内 `ingestFrame(frame)`（`app.ts:1338`）→ `scheduleChartDraw()`（`:4552`） | 追加到 `state.frames`，安排重绘。 |
| 14 | 浏览器 | `app.ts:9718` `drawChart()` | 在 `#chart` canvas 上绘制曲线（`index.html` 的 `tab-chart`）。 |

> 单步按钮走同一条链，只是 action 换成 `'step'`，`server.py` 调 `SERVICE.step_once()`；`step`/`reset` 后前端会立即补一次 `pollLive()`（`app.ts:10608`）。

---

## 5. 依赖规则

### 5.1 现状：`compute` 与 `model` 是**双向**依赖

任务里问“compute 可被 model 用、model 可被 compute 用？”——**以实际 import 为准，答案是两边都在用，包级存在环**：

| 方向 | 证据（模块级 import） |
| --- | --- |
| `compute → model` | `core/compute/simulation.py:25` `from ..model.scene import Scene`；`computes.py:16` `from ..model.graph import ComputeContext, NodeData`；`computes.py:36` `from ..model.ports import PortSpec`；`circuit_modules.py:27` `from ..model.blocks import … BlockDef, PortDef` |
| `model → compute` | `core/model/scene.py:18` `from ..compute.computes import …`；`blocks.py:43/44` 引 `fields/methods`；`extensions.py:47/52/53` 引 `COMPUTE_SPECS/METHOD_SPECS/ParamSpec`；`graph.py:25` `from ..compute.profiling import timed`；`networks.py:27` `from ..compute.simulation import Simulation`；`project.py:28` 同 |
| `compute/model → common` | 几乎每个模块都 `from ..common.limits import …`（如 `computes.py:15`、`scene.py:20`） |

**结论**：不存在“compute 是底层、model 是上层”的干净分层；两者互相引用。为避免导入期的硬环，代码里大量使用**函数内延迟 import**：

- `core/compute/analysis.py:1047` `from ..model.project import atomic_write`
- `core/compute/nodal.py:1455` `from ..model.ports import pins_for_device`
- `core/compute/circuit_modules.py:521` `from ..model.blocklib import validate_block_structure`
- `core/model/scene.py:1231` `from ..compute.circuit_modules import DEVICE_KINDS, pin_names`
- `core/model/blocks.py:780` `from ..compute.circuit_modules import encapsulate_circuit`

新代码请沿用这个约定：**模块顶部只 import 同层/更底层；反向依赖放到函数内**，不要扩大包级环。

### 5.2 禁止事项（已核对）

1. **`core` 不得 import `server` / `desktop`**：对 `netlab/core/**.py` 做正则检索，无任何 `server`/`desktop` 导入（见 §8 证据）。内核必须能脱离 FastAPI/桌面壳单独测试。
2. **PlotKit 是单向依赖 `netlab → plotkit`**：`netlab/plotkit_bridge.py:265` `from plotkit.server.app import create_app`；反向在 `PlotKit/` 中检索不到 `import netlab`。不要把 Netlab 的类型塞进 PlotKit。
3. **前端不得直接 import Python**：`frontend/` 是静态资源（TypeScript 源码经 esbuild 构建），只通过 `fetch`/XHR 访问 `/api/*`；后端也不“import 前端”，只用 `FileResponse`/`StaticFiles` 提供文件（`server.py:96`、`:342`）。
4. **渲染线程边界**：仿真线程只写 `Recorder`；HTTP 线程只读 `Recorder`；共享状态一律走 `Simulation.lock` / `NetworkContainer.lock`。新增端点不要在无锁情况下直接改 `Scene`。

---

## 6. 结构整理历史（D79 → D85）

### 6.1 两次整理

1. **D79（2026-11-02）**：`tools/reorg_core.py` 把旧模块按“计算 / 模型 / 公共”分桶搬进 `netlab/core/{compute,model,common}/`，并在包根生成 33 个转发 shim（`from .core.<bucket>.<name> import *` + `__getattr__`），以保证历史 import 不炸。
2. **D85（2026-11-02）**：包根 33 个 1KB shim 让 `netlab/` 看起来“一片混乱”（用户原话），因此**全部删除**，并把仓库内所有引用改写为规范路径：
   - `from .scene import X` → `from .core.model.scene import X`
   - `from netlab.graph import X` → `from netlab.core.model.graph import X`
   - `from netlab import accel` → `from netlab.core.compute import accel`
   - `desktop/*.py`：`from ..project import X` → `from ..core.model.project import X`

### 6.2 现在的规则

- 包根只允许：`__init__.py`、`server.py`、`run.py`、`plotkit_bridge.py`、`plotkit_vendor.py`、`vscode_bridge.py`、`cache_guard.py`，以及 `core/`、`desktop/`、`tests/`、`docs/`、`tools/`、`_vendor/` 目录。
- 新增模块请放进 `core/compute`、`core/model` 或 `core/common`；不要再在包根加文件。
- 回归护栏：`netlab/tests/test_structure_layout.py` 会断言「包根没有多余 .py」与「全仓库没有引用已删旧路径」。

---

## 7. 扩展指南

### 7.1 新增一个电路元件（MNA）

| 步骤 | 文件 | 要点 |
| --- | --- | --- |
| 1. 写元件类 | `netlab/core/compute/nodal.py` | 继承 `CircuitElement`（`nodal.py:147`），实现装配/状态钩子；可参考 `Resistor`（`:218`）、`Capacitor`（`:239`）、`Diode`（`:634`）。 |
| 2. 注册规格 | `netlab/core/compute/nodal.py` | 在 `ELEMENT_SPECS`（`:1010`）加 `ElementSpec`（`:973`）：`kind/label/params/cls/formula/notes`。批量器件可仿照文件尾部 `:2646-2676` 从 `transistors/logic/timers/digital/magnetics/powerelectronics` 合并。 |
| 3. 引脚（若需要） | `netlab/core/model/ports.py` | 在引脚表里声明该 kind 的引脚，`schematic`/前端才能连线。 |
| 4. 前端图标/表单 | `frontend/app.ts` + `frontend/style.css`（构建产物 `app.js`） | 元件目录由 `/api/catalog` 的 `elements` 字段下发（`server.py:642` → `Scene.catalog` `scene.py:2054` → `element_catalog` `nodal.py:1490`）；前端按 kind 渲染。 |
| 5. 测试 | `netlab/tests/` | 参考 `test_device_nodes.py`、`test_circuit_modules.py`、`test_circuit_semantics.py`。 |

### 7.2 新增一个信号节点（signal 层算法）

| 步骤 | 文件 | 要点 |
| --- | --- | --- |
| 1. 实现 handler 工厂 | `netlab/core/compute/computes.py` | 写 `_xxx_factory(params) -> Handler`，参考 `_gain_factory`（`:233`）、`_integrate_factory`（`:321`）。 |
| 2. 注册 | 同文件 | `register(ComputeSpec(kind=..., label=..., params=(ParamSpec(...),), factory=..., inputs=(...)))`；`COMPUTE_SPECS` 在 `:63`，`register` 在 `:128`。kind 重复会 `RuntimeError`。 |
| 3. 参数声明 | `netlab/core/compute/params.py` | 用 `ParamSpec`（`:31`）声明类型、范围、单位、下拉项；前后端共用。 |
| 4. 前端菜单 | `frontend/app.ts`（构建产物 `app.js`） | “添加节点”菜单来自 `/api/catalog` 的 `computes`（`compute_catalog` `computes.py:1504`）；按 `group/label` 渲染即可，一般无需改后端。 |

> 连接（边）算法同理，但注册表在 `netlab/core/compute/methods.py`（`METHOD_SPECS` / `method_catalog` `:41` / `:695`）。

### 7.3 新增一个模板

| 步骤 | 文件 | 要点 |
| --- | --- | --- |
| 1. 写模板函数 | `netlab/core/model/templates.py` | 返回 `{"nodes": [...], "edges": [...], "sim": {...}}`，参考 `rc_step()`（`:318`）、`rlc_series()`（`:361`）。 |
| 2. 登记 | 同文件 `TEMPLATES` | 在 `TEMPLATES`（`:1307`）加条目（名称、描述、mode、`build`）。 |
| 3. 目录/实例化 | 同文件 | `template_catalog()`（`:1427`）与 `build_template()`（`:1440`）自动生效；`/api/templates` 直接读它。 |

### 7.4 新增一个分析接口

| 步骤 | 文件 | 要点 |
| --- | --- | --- |
| 1. 纯计算函数 | `netlab/core/compute/analysis.py` | 入参用 `sim`/帧序列，返回可 JSON 化结构；参考 `analyze_metrics`（`:85`）、`spectrum`（`:200`）、`transfer_function`（`:404`）。 |
| 2. 路由 | `netlab/server.py` | 在“分析”分段（`:1703` 起）加 `@app.get("/api/analysis/<name>")`，从 `SERVICE` 取当前网络并调用。 |
| 3. 前端面板 | `frontend/app.ts`（构建产物 `app.js`） | 分析面板渲染在 `renderAnalysisPanel()`（`:12541`）；`index.html:298` 是 `tab-analysis` 容器。 |

### 7.5 新增一个前端面板

| 步骤 | 文件 | 要点 |
| --- | --- | --- |
| 1. 容器 | `frontend/index.html` | 加一个 `<div id="tab-xxx" class="tab-pane">`（现有 pane 见 `:124-298`）。 |
| 2. 渲染 | `frontend/app.ts`（构建产物 `app.js`） | 写 `renderXxx()`，在 tab 切换/sync 流程里调用；参考 `renderAnalysisPanel()`（`:12541`）。 |
| 3. 样式 | `frontend/style.css` | 加面板样式；优先复用现有 CSS 变量/类。 |
| 4. 数据 | 已有 `/api/*` 或新增端点 | 前端只通过 `api()` / `jsonRequest()` 访问后端，不 import Python。 |

---

## 8. 核对过的关键位置清单

| 结论 | 证据（文件:行） |
| --- | --- |
| 前端资源在仓库级 `frontend/`，非 `netlab/frontend` | `netlab/server.py:87-99`（`_resolve_frontend_dir` 指向 `parents[1]/"frontend"`，回退 `static`）；目录实测只有 `NetlabHome/frontend/` |
| 前端静态资源（TS 经 esbuild 构建） | `frontend/` 含 `app.ts`/`app.utils.ts`/`desktop-shim.ts` 源与 esbuild 产物；`server.py:133` `app.mount("/static", StaticFiles(...))` |
| `Scene` 类与 `step` | `netlab/core/model/scene.py:862`、`:987` |
| `Simulation` / `Recorder` / `SimConfig` | `netlab/core/compute/simulation.py:236` / `:73` / `:40` |
| 一步仿真的落点 | `simulation.py:302` `_advance_locked`；录制 `:110` `Recorder.push` |
| `NetworkContainer` 属性转发 | `netlab/core/model/networks.py:77` `__getattr__` |
| `CircuitSolver` 与元件注册表 | `netlab/core/compute/nodal.py:1612`、`:1010` `ELEMENT_SPECS`、`:1327` `element_spec` |
| `ComputeSpec` / `COMPUTE_SPECS` / `register` | `netlab/core/compute/computes.py:43` / `:63` / `:128` |
| `ParamSpec` | `netlab/core/compute/params.py:31` |
| `BlockDef`（无 `BlockLibrary` 类） | `netlab/core/model/blocks.py:129`；全仓检索 `class .*Library` 无结果 |
| 工程 checksum / load / save | `netlab/core/model/project.py:86` / `:96` / `:910` / `:965` / `:874` |
| `SERVICE` 单例与 `/api` 组织 | `netlab/server.py:101`；分组注释 `:241/444/954/1040/1077/1138/1222/1391/1451/2239/2257/2293/2304/2383` |
| `/api/live` 与 `/api/control` | `server.py:752` / `:955` |
| `plotkit_bridge.mount` 与挂载点 | `netlab/plotkit_bridge.py:669`、`:22`（`MOUNT_PATH="/plotkit"`） |
| compute↔model 双向依赖 | 见 §5.1 的 import 行号 |
| 函数内延迟 import 的环规避 | `analysis.py:1047`、`nodal.py:1455`、`circuit_modules.py:521`、`scene.py:1231`、`blocks.py:780` |
| core 不 import server/desktop | 对 `netlab/core/**.py` 检索 `(import|from).*(server|desktop)` 无命中 |
| PlotKit 无反向依赖 | 对 `PlotKit/**.py` 检索 `import netlab|from netlab` 无命中 |
| shim 历史与现状 | D79 曾生成 33 个包根 shim，**D85 已全部删除**（现存 0）；规范路径见 §6.1。`tools/reorg_core.py` 仍保留模板 |
| `tools/reorg_core.py` 的分桶与重写 | `tools/reorg_core.py:13-30`（集合）、`:32-43`（SHIM 模板）、`:45-70`（`rewrite`） |
| 前端点运行入口 | `frontend/app.ts:13314`（按钮）、`:10612`（`control`）、`:10594`（`networkControl`）、`:1059`（`jsonRequest` 定义） |
| 前端轮询与重绘 | `frontend/app.ts:10551`（`pollLoop`）、`:10473`（`pollLive`）、`:10482`（GET）、`:1338`（`ingestFrame`）、`:9718`（`drawChart`） |

---

### 附：给新人的建议阅读顺序

1. `netlab/core/model/scene.py` 的 `Scene`（先看 `step` / `ensure_engine` / `probes`）。
2. `netlab/core/compute/simulation.py` 的 `Simulation`（`_loop` / `_advance_locked` / `live`）。
3. `netlab/server.py` 的端点分段（先读 `/api/catalog`、`/api/state`、`/api/live`、`/api/control`）。
4. `frontend/app.ts` 的 `pollLive` / `drawChart`（只读这两段即可理解前端主线）。
5. 按任务再深入 `nodal.py`（电路）或 `computes.py`（信号）。
