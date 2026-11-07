# Netlab 框架速查表（读完这份就不用再通读代码）


> 最后修改：2026-11-07（§0 一分钟事实与 §1 模块清单均已按代码实测校准：netlab 3.20.1、TypeScript+esbuild 前端、pywebview 桌面壳、627 passed + 1 skipped、R01–R43/D1–D119）
> 用途：每次新开窗口/新任务时先读这份，**不要**重新扫一遍全部源码。
> 需要细节时再按文末「文档导航」跳转对应文档。
> 与代码冲突时以代码为准，并回来更新本文件。

---

## 0. 一分钟事实

| 项 | 值 |
| --- | --- |
| 项目根 | `E:\Python\MyPython\ProjectPoint`（包在 `netlab/`） |
| 语言/栈 | Python 3.13 + FastAPI/uvicorn + NumPy/SciPy + TypeScript 前端（esbuild 构建为 JS）+ pywebview/WebView2 桌面外壳 |
| 启动 | `python netlab/run.py --port 8010 --no-browser`；桌面 `python -m netlab.desktop` |
| 前端 | `frontend/`：`app.ts`/`app.utils.ts`/`desktop-shim.ts` 源 + `index.html`/`style.css`；`npm run build`（esbuild）生成 `app.js` 等产物，改完构建并刷新，注意 bump `?v=` |
| 测试 | `python -m pytest netlab/tests -q` → **627 passed, 1 skipped**（2026-11-07 实测，共收集 628 项） |
| 版本控制 | 本目录是 git 仓库（`NetlabHome/` 为根）；测试与文档**随仓库跟踪**（可复现性），`.gitignore` 仅排除运行期/个人产物（MyProject、netlab/tools、NetlabExtras、node_modules、build、dist 等）；证据以 PROGRESS 为准 |
| 当前阶段 | 以 PROGRESS 头部为准：R01–R43 持续推进；2026-11-06 完成前端 JS→TS 迁移 + 构建期打包（esbuild）+ 桌面 PyInstaller 分发 POC |

---

## 1. 目录与模块职责

`netlab/` 下（行数为 2026-11-07 实测；Python 已按 D119 迁入 `netlab/core/{compute,model,common}/`，下表按逻辑模块列出，路径见各行）：

| 模块 | 行数 | 职责 | 关键符号 |
| --- | --- | --- | --- |
| `run.py` | 121 | 启动入口：参数、起 uvicorn、开浏览器 | `main` |
| `server.py` | 2438 | 全部 HTTP 路由 + Pydantic 请求模型 + 全局 `SERVICE` | `app`、`SERVICE`、`ProjectImportRequest` |
| `core/model/scene.py` | 2036 | 场景对象、节点/边记录、三种引擎、快照、catalog | `Scene`、`NodeRecord`、`EdgeRecord`、`SignalEngine`、`CircuitEngine` |
| `core/model/graph.py` | 1076 | 信号/矢量网络的执行图（节点、连接、拓扑序、代数环检测） | `Network`、`NodeView`、`ComputeContext` |
| `core/compute/computes.py` | 1550 | 节点计算方式注册表（signal/vector） | `ComputeSpec`、`register`、`compute_catalog`、`prepare_compute` |
| `core/compute/methods.py` | 719 | 连接传递函数注册表 | `MethodSpec`、`register`、`method_catalog`、`prepare_method` |
| `core/compute/nodal.py` | 2739 | 电路元件（MNA）与电路节点、内置元件注册表 | `CircuitElement`、`Resistor`、`element_catalog` |
| `core/compute/transistors.py` | 620 | 三极管/MOSFET 行为模型 | `BipolarJunction`、`Mosfet`、`BJT_SPECS` |
| `core/compute/logic.py` | 196 | 与/或/非/异或门行为模型 | `LogicGate`、`LOGIC_GATE_SPECS` |
| `core/compute/timers.py` | 182 | 555 方波与 LDO | `Astable555`、`LDO`、`TIMER_SPECS` |
| `core/compute/digital.py` | 396 | 计数器/移位寄存器/ADC/DAC | `Counter4`、`ShiftRegister4`、`ADC4`、`DAC4`、`DIGITAL_SPECS` |
| `core/compute/magnetics.py` | 329 | 变压器与互感线圈（双端口磁耦合） | `Transformer`、`CoupledInductor`、`MAGNETIC_SPECS` |
| `core/compute/powerelectronics.py` | 379 | R15 功率电子/电机：晶闸管/IGBT/JFET/继电器/直流电机（Ron/Roff 分段线性 + 反电动势一阶） | `Thyristor`、`Igbt`、`Jfet`、`Relay`、`DcMotor`、`POWER_ELECTRONIC_SPECS` |
| `core/model/ports.py` | 220 | R20 端口/引脚契约：39 种元件的 PortSpec/PinSpec | `PortSpec`、`PinSpec`、`PINS`、`pins_for` |
| `core/compute/params.py` | 211 | 参数规格 `ParamSpec` 与类型校验控件映射 | `ParamSpec.to_dict`、`validate_params` |
| `core/common/limits.py` | 267 | 上限常量与类型转换/错误类型 | `MAX_NODES`、`MAX_PRECOMPUTE_STEPS`、`ValidationError`、`as_float` |
| `core/common/fastcopy.py` | 31 | 状态快拷贝工具（只读路径加速） | `copy_state` |
| `core/compute/simulation.py` | 745 | 线程循环、录制、控制、事务式预计算 | `Simulation`、`Recorder`、`SimConfig` |
| `core/model/networks.py` | 328 | 多网络容器：当前网络、增删改、降级只读、工程打包 | `NetworkContainer` |
| `core/model/workspace.py` | 515 | 工作区目录、共享库、快照、用户设置 | `Workspace`、`create_project`、`load_workspace`、`save_workspace` |
| `core/model/blocks.py` | 1142 | 功能块：封装/实例化/内部运行时 | `BlockDef`、`BlockStore`、`BlockRuntime`、`encapsulate_nodes` |
| `core/compute/circuit_modules.py` | 788 | 电路封装/展开、端口标记与合并 | `encapsulate_circuit`、`flatten_circuit`、`module_net_map` |
| `core/model/project.py` | 981 | `.netlab` 工程文件：构建/校验/迁移/原子写/校验和 | `build_project`、`build_project_for`、`validate_project`、`compute_checksum` |
| `core/model/extensions.py` | 603 | Python 扩展：AST 校验、执行、持久化 | `Param`、`node`、`method`、`validate_code`、`activate_code` |
| `core/compute/introspection.py` | 72 | 把 spec 转成前端可展示的公式/源码/参数 | `spec_entry`、`safe_source` |
| `core/compute/accel.py` | 218 | 计算加速策略（CPU/GPU 自动回退） | `configure`、`solve_dense`、`status` |
| `core/compute/linalg.py` | 232 | 线性代数与离散化 | `solve_linear`、`expm`、`zoh_discretize` |
| `core/compute/statespace.py` | 194 | 状态空间离散化 | `StateSpaceModel` |
| `core/compute/waveform.py` | 114 | 波形源 | `waveform_value`、`waveform_specs` |
| `core/compute/safeexpr.py` | 232 | 表达式节点的受限 AST 求值（无 eval） | `evaluate` |
| `core/compute/schematic_export.py` | 189 | R18/R19 由电路场景导出 SchemDraw 原理图（可选依赖，缺失抛 `ComputeError`） | `scene_to_svg`、`_element_map`、`svg_filename` |
| `core/compute/telemetry_quality.py` | 91 | 遥测质量评估：采样步长/插值误差界/FIFO 延迟界 | `sample_dt_from_frames`、`interpolation_error_bound`、`fifo_delay_bound` |
| `core/model/schematic.py` | 480 | R19 图纸模型数据层：引脚表、确定性分层自动布局、校验 | `ELEMENT_PINS`、`pins_for`、`auto_layout`、`validate_schematic` |
| `core/model/ui_profile.py` | 109 | R40 `netlab-ui/1` 视图配置：令牌/布局/节点卡片字段 → CSS 变量 | `UI_PROFILE`、`default_ui`、`normalize_ui`、`ui_catalog` |
| `core/model/templates.py` | 1447 | 场景模板与仿真预设 | `TEMPLATES`、`build_template` |
| `frontend/app.ts` | 15634 | 全部前端逻辑（TS 源码，按分区组织，见 §6；esbuild 打包为 `app.js` 14,119 行） | 见 §6 |
| `desktop/` | — | pywebview 外壳（WebView2）：窗口/桥/服务宿主/自检（Qt 文件为 D78 遗留） | `webview_app.py`、`webview_bridge.py`、`server_host.py` |
| `tools/` | — | 基准与浏览器验证脚本 | `bench.py`、`cdp_eval.mjs`、`cdp_shot.mjs` |
| `tests/` | — | pytest 用例（91 个 test_*.py，共 628 项） | `conftest.py` 提供 `client`、`simulation` fixture |

---

## 2. 两条主要数据流

**写操作（一次 HTTP 请求）**

```
前端 api() → FastAPI 路由 → SERVICE.mutate(lambda scene: ...)  ← 持锁、改场景、返回快照
                                        ↓
                              Scene._touch() 递增 revision
                                        ↓
                          引擎在下一拍按新图重建（缓存自动失效）
```

**仿真一拍**

```
Simulation._loop (线程) → Scene.step(dt) → 引擎.step(dt)
   signal/vector : SignalEngine → graph.Network.step（拓扑序、深拷贝/只读视图、代数环补延迟）
   circuit       : CircuitEngine → nodal.CircuitSolver（MNA + Newton/LU 缓存）
   跨域桥         : CircuitEngine._apply_bridge_actuators → MNA → _sample_bridge_sensors（显式一拍延迟）
   功能块         : SignalEngine._wire_blocks 建隐藏 feed/emit 边 + BlockRuntime 内部场景
                                        ↓
                             状态写回 NodeRecord/EdgeRecord.data/state
                                        ↓
前端轮询 /api/live、/api/state 取增量与快照
```

**读操作**：`/api/state` 返回完整快照（含 `catalog` 之外的一切），`/api/live?cursor=` 返回增量帧。

---

## 3. 核心对象与状态归属

| 对象 | 位置 | 说明 |
| --- | --- | --- |
| `Scene` | `scene.py` | 唯一权威状态：`nodes`、`edges`、`blocks`、`mode`、`revision`、`_engine` |
| `NodeRecord` | `scene.py` | `id/name/kind/params/data/state/position`；`data` 是用户可见输出，`state` 是内部状态 |
| `EdgeRecord` | `scene.py` | `id/name/kind/params/delay/enabled/source/target` |
| `ComputeSpec` / `MethodSpec` | `computes.py` / `methods.py` | 不可变规格：参数、输出字段、公式、源码、工厂函数 |
| `ParamSpec` | `params.py` | 参数元数据 + 强制类型转换（coerce） |
| `Simulation` | `simulation.py` | 线程与节奏，持有 `Recorder` |

规则：**只有 `SERVICE.mutate` 里的代码可以改场景**；前端永远不直接改状态，只发请求。

---

## 4. 注册表与 catalog

四张注册表：`COMPUTE_SPECS`（节点计算）、`METHOD_SPECS`（连接函数）、`ELEMENT_SPECS`（电路元件）、`TEMPLATES`（场景模板）。

装配链路：`register(...)` → `catalog()` → `spec_entry(spec, mode=..., formula=...)`（`introspection.py`）→ 前端 `state.catalog`。

`spec_entry` 产出的字段（前端可直接用，不必再算）：
`kind / label / group / description / mode / outputs / notes / formula / source / source_path / editable / builtin / params[]`。
`params[]` 每项：`key/label/type/default/unit/help/group/example/required`，可选 `min/max/step/positive/choices/placeholder`。

契约：注册 `kind` 唯一；参数默认值必须能通过 `ParamSpec.coerce`；输出字段名写进 `outputs` 才会出现在检查器实时值里。

---

## 5. 三种模式差异

| 模式 | 引擎 | 节点语义 | 连接语义 | 注意 |
| --- | --- | --- | --- | --- |
| `signal` | `SignalEngine`+`Network` | 对入边数据做计算 | 字段传递/延迟/传递函数 | 代数环必须靠 `delay` 边打断 |
| `vector` | 同上（共用） | 同上，数据含 `x/y/vx/vy` | 同上 + 扩散耦合 | 相图读 `x/y` 或 `vx/vy` |
| `circuit` | `CircuitEngine`+`nodal` | 等电位点 | R/L/C/源/二极管/开关/受控源 | 必须恰好一个 `ground`；矩阵按 dt 缓存 |

模式切换会重置引擎缓存与运行状态。

**跨域桥（R31 P11-05）**：`sensor`/`actuator` 是电路元件（`ELEMENT_SPECS`），不是 signal compute 节点。`sensor` 以 `1e-12` 高阻采样节点电压并写回 `signal` 字段；`actuator` 是受控电压源，从 signal 上一拍值取 `gain*signal+offset`。`CircuitEngine.step()` 固定顺序为「actuator → MNA → 写节点电压 → sensor」，显式一拍延迟，旧工程无桥元素时零影响。

**R31 compute**：`abc_dq`（abc↔dq，幅值不变 Park）、`pll`（SRF-PLL，输出 `theta/frequency/d/q/locked`）、`pi`（抗饱和 PI）都在 `computes.py` 的 `COMPUTE_SPECS` 中，可直接用 `signal` 场景搭 L1 平均模型。

**R39 复数层**：`complex_support.py` 只做边界转换；`analysis.frequency_response()` 是统一入口。signal 走 `(I-W(jω))y=b` + 精确 `e^{-jωT}`，circuit 转调 `nodal.ac_sweep` 复数 MNA；时域/工程 JSON 仍 `float64`。

**R40 插件**：插件包放 `extensions/plugins/<id>/`，manifest `netlab-plugin/1`，只能 `from netlab.plugin_api.v1 import ...`；`PluginManager` 负责扫描/依赖/加载；现有 `signal/circuit/vector` 不可替换，新引擎只能注册新 mode。

---

## 6. 前端架构（`frontend/app.ts` 单文件，esbuild 打包为 `app.js`）

分区（行号为 `app.ts` 分区起点，按文件先后排列，改代码时直接定位；`app.js` 产物约 14,119 行，行号约为源码的 0.9 倍且已去类型）：

| 分区 | 位置(app.ts) | 内容 |
| --- | --- | --- |
| 0 常量与小工具 | L486 | `el/div/button/clamp/colorForKey`、`state`、`ui` |
| 0 桌面会话 | L970 | `DESKTOP_TOKEN`、`desktopBridge()`、`callBridge()` |
| 1 请求与提示 | L1015 | `api`、`jsonRequest`、`toast`、`showBanner`、`task` |
| 2 快照与全局 UI | L1131 | `applySnapshot`、模式 UI、状态栏 |
| 3 画布尺寸/视图变换/渲染 | L1400 | `draw*`、视图变换、尺寸 |
| 4 画布交互 | L3735 | 选择、拖拽、连线、缩放 |
| 5 弹层/菜单/模态 | L4669 | `confirmModal`、菜单、`showHelp` |
| 6 检查器动态表单 | L5009 | `renderInspector`、`buildParamField`、`section` |
| 6.5 规格查看与 Python 扩展面板 | L6398 | `renderSpecPane`、扩展面板 |
| 7 节点/连接/场景变更 | L6852 | `addNodeAt`、改参数、删节点/边 |
| 8 场景面板 | L7382 | 模式、节奏、模板、导入导出 |
| 8.5 工程文件 `.netlab` | L8121 | 保存/打开/自动保存/最近/信任确认 |
| 9 信号图与实时轮询 | L8594 | `drawChart`、`drawPhase`、`pollLoop` |
| 10 仿真控制/静态事件/启动 | L10573 | 快捷键、`bindStaticEvents`、`boot()` |
| 8.6 外壳菜单栏/左侧网络栏/顶部信息条（R08） | L10793 | 菜单栏、网络切换、状态信息条 |
| 8.7 模块库面板（R02） | L11380 | 模块/扩展库卡片与拖放 |

> 注：`boot()` 实际在 `app.ts:13645`，`bindStaticEvents()` 在 `app.ts:13310`。

要点：

- `state` 是唯一前端状态；`ui` 是 DOM 引用表。新增 tab 要同时改 `index.html`（tab 按钮 + `section#tab-x`）、`switchTab()`、`ui` 表。
- 参数表单由 `buildParamFields(spec, values)` 依 `ParamSpec` 自动生成，不要手写表单。
- 检查器/规格面板靠 `renderInspector()`→`scheduleSpecRender()` 联动，选中变化会自动刷新。
- 静态资源用 `?v=x.y.z` 缓存，**改 js/css 必须 bump** `index.html` 里的版本号（当前 3.20.1）。
- **右键（R22）**：画布 `contextmenu` → `onContextMenu`（hitTest 分 node/edge/空白），菜单统一走
  `openGenericMenu(popup,x,y,title,items)`；item 形状 `{label,hint,action,danger,sep,children}`，有 `children` 时点击
  **下钻 + 「‹ 返回」**（不是 hover 级联）。五类上下文：空白/器件/网络节点/导线/多选（多选目前复用节点菜单：
  `state.multi.nodes.size > 1` 时追加「对齐 / 分布」）。
- **回放（R23/D48）**：录制帧在 `state.frames`；`state.replay{active,playing,index}` 只读回放；图表绘制用 `slice(0,index+1)`；过期标记比较 `scene.revision` 与 `replay.recordingRevision`；`updateSignalKeyCache` 在 probe 列表为空时保留 `chart.selected`（重置保留探针）。
- **元件分类（R22/D46）**：唯一来源是后端 `nodal.ELEMENT_GROUP_ORDER`（11 组顺序）与 `ELEMENT_GROUPS`
  （39 种 kind→组，启动时写回 `ElementSpec.group`，catalog 带 `group`）；前端 `ELEMENT_GROUP_ORDER` 只排显示顺序。
  新增元件必须登记 `ELEMENT_GROUPS`，否则 `test_spec` 报"未分类"。

---

## 7. API 速查

| 方法 | 路径 | 说明 | 请求体形状 |
| --- | --- | --- | --- |
| GET | `/api/health` | 存活探测 | — |
| GET | `/api/catalog` | 全部规格 + 模板 | — |
| GET | `/api/state` | 完整快照 | — |
| GET | `/api/live?cursor&limit` | 增量帧（limit≤600） | — |
| POST | `/api/control` | run/pause/step/reset | `{action, steps?}` |
| PATCH | `/api/config` | dt/节奏 | `{...}` |
| POST | `/api/mode` | 切模式 | `{mode}` |
| POST/PATCH/DELETE | `/api/nodes[/{id}]` | 节点增改删 | 节点字段 |
| POST/PATCH/DELETE | `/api/edges[/{id}]` | 连接增改删 | 边字段 |
| POST | `/api/positions` | 批量位置 | `{items:[...]}` |
| GET | `/api/templates`、POST `/api/templates/{name}` | 模板列表/应用 | — |
| GET/POST/PATCH | `/api/scene`、`/api/scene/clear` | 整场景导入/清空/改 | 场景载荷 |
| GET/POST | `/api/project/export`、`/api/project` | 导出/读取工程 | `{ui?, name?}` |
| POST | `/api/project/validate` | **裸工程对象**（不是 `{project:...}`） | 工程对象 |
| POST | `/api/project/import` | `{project, trust_extensions}` | 见左 |
| GET/PATCH | `/api/accel` | 加速策略与状态 | `{policy}` |
| GET | `/api/extensions` | 已启用列表 + 目录扫描 + 提示 | — |
| POST | `/api/extensions/validate` | `{code}` → `{ok, declared}` | — |
| POST | `/api/extensions/activate` | `{code, filename, persist, kind_type}` | — |
| POST | `/api/extensions/deactivate` | `{kind, remove_file}` | — |
| GET | `/api/extensions/{kind}` | 单个扩展详情（含源码） | — |
| POST | `/api/extensions/scan` | 目录扫描 | — |
| GET/POST | `/api/ui` | 读取/保存 `netlab-ui/1` 视图配置（返回 `ui` + `catalog`） | UI profile |
| GET | `/api/plugins`、POST `/api/plugins/{id}/{scan,enable,reload}` | 插件管理（D118） | — |
| GET/POST | `/api/schematic/layout`、`/api/schematic/validate` | 图纸自动布局 / 校验 | 场景载荷 |
| GET | `/api/export/schematic`、`/api/scene/export` | 导出 SchemDraw SVG / 场景 JSON | — |
| GET | `/api/help/search`、`/api/help/doc` | 帮助全文搜索 / 文档读取 | `?q=` / `?path=` |
| GET/POST | `/api/plotkit/diag|channels|active|analysis|precompute` | PlotKit 绘图桥 | 见 left |
| GET/POST | `/api/networks[...]`、`/api/workspace/...` | 多网络与工作区 | — |
| POST | `/api/analysis/{metrics,spectrum,period,math,transfer,export}` | 分析工具集 | — |
| POST | `/api/shutdown` | 退出（桌面模式禁用） | — |

错误模型：`ValidationError→422`、`NotFoundError→404`、`ConflictError→409`、`LimitError→413/422`、`ComputeError→422`；响应体统一 `{"detail": "中文描述"}`。
**注意**：`/api/project/validate` 与 `/api/project/import` 的请求体形状不同，混用会得到「缺少 format 字段」。

---

## 8. 工程文件 `.netlab`

顶层键（一份、扁平）：
`format("netlab-project") / version(1) / app / name / created / modified / scene / sim / ui / blocks / extensions / metadata / checksum`

- `scene` **不含** `blocks`（blocks 只在顶层存一份，导入时注入）。
- `checksum` = `canonical_json` 后 sha256；`canonical_json` 会把「整数值浮点」归一成 int、`-0.0` 归零（否则浏览器 JSON 往返必然失配）；`verify_checksum` 兼容旧算法。
- 上限 8 MB；写入走「同目录临时文件 → fsync → 旧文件 `.bak` → `os.replace`」。
- 含 `extensions` 的工程导入必须显式 `trust_extensions=true`，前端会弹信任确认（列出 kind/type/sha256）。

---

## 9. 桌面外壳（`netlab/desktop/`）

当前入口是 **pywebview + WebView2**（D78）：`python -m netlab.desktop` → `webview_app.main()`；Qt 文件（`main_window.py`/`bridge.py`）为历史遗留，不再作为运行路径。

- 进程内起 uvicorn（`server_host.ServerHost`），随机空闲端口，`NETLAB_DESKTOP_TOKEN` 经 `?token=` 交给页面，前端取到后从地址栏移除并加 `X-Netlab-Token` 头（`webview_app.py:302/313`，`server_host.py:42-46`）。
- 原生能力经 `WebviewBridge`（`js_api=bridge`，`webview_app.py:327`）暴露，方法为 snake_case、返回 JSON 字符串/基础类型：`save_project`、`save_project_to`、`open_project`、`open_project_path`、`current_path`、`autosave`、`has_autosave`、`recover_autosave`、`clear_autosave`、`set_dirty`、`window_minimize/toggle_maximize/close/rect/resize/move_to`、`command`（`webview_bridge.py:112-271`）；网页侧经 `static/desktop-shim.js` 映射到 `window.netlabDesktop`。
- 原生菜单动作全部转发给页面已有的 `window.netlabDesktopCommand('new|open|open-path|save|saveAs|recover|fit|help|…')`（`webview_app.py:192`、`webview_bridge.py:264`）。
- 自动保存落在 `%APPDATA%/Netlab/NetlabDesktop/autosave.netlab`（`webview_bridge.py:59-62/80-81`）。
- 自检：`python -m netlab.desktop --selftest`（期望 `ok: true`；检查 `has_bridge`/`has_win_ctl`/`has_command`/`has_autosave_roundtrip` 等，`webview_app.py:385-404`）。

---

## 10. 扩展系统（`extensions.py`）

- 持久化目录：`NetlabHome/extensions/nodes/*.py`、`extensions/methods/*.py`（工程内嵌扩展不写盘、默认不执行）。
- 执行命名空间已注入：`node`、`method`、`Param`、`math`、`np`/`numpy`，因此**文件里不允许也不必要 `import`**。
- AST 禁区：`Import/ImportFrom/ClassDef/While/With/Async*/Await/Yield*/Global` 等；禁 `eval/exec/compile/open/__import__/getattr/setattr/globals/locals/vars` 等名字；禁 `__dunder__` 属性与字符串。
- 装饰器签名：`@node(kind=, label=, params=(), group=, description=, outputs=(), notes=, formula=, validate=)`；`@method(...)` 少 `validate`。**被装饰函数本身就是 handler，不是工厂**：节点函数直接收 `ctx`（`ctx.inputs`、`ctx.data`、`ctx.state`、`ctx.params`、`ctx.dt`、`ctx.time`），
  连接函数收 `(source, target, params, state, dt)`；参数值在 `ctx.params` 里，不要再自己套一层 `return handler`。
- 上限：代码 200 KB、AST 20000 节点、参数 48 个。
- 安全边界：**不是沙箱**（同进程、无硬超时）；失败会回滚注册表。
- 启用后要重建引擎（`SERVICE.mutate(lambda s: None)`），否则参数/源码错误要等下一次才暴露。

---

## 11. 硬上限

| 项 | 值 |
| --- | --- |
| 节点 / 连接 / 字段 | 400 / 1200 / 64 |
| 名称 / 字符串 | 32 / 400 |
| 数组 / 矩阵 | 256 / 12×12 |
| 代数环深度 | 8 |
| 功能块 | 定义 128，嵌套 6 层，块内节点 200、连接 600、端口 32 |
| 工程文件 | 8 MB |
| 扩展代码 / AST / 参数 | 200 KB / 20000 / 48 |
| GPU 阈值 | 规模 ≥192 才走 GPU（缺 CuPy 自动回退 CPU） |

---

## 12. 改哪里

| 要做的事 | 文件 | 入口 |
| --- | --- | --- |
| 新增节点计算方式 | `computes.py` | `ComputeSpec` + `register` + `COMPUTE_FORMULAS` |
| 新增连接函数 | `methods.py` | `MethodSpec` + `register` |
| 新增电路元件 | `nodal.py` | `CircuitElement` 子类 + 注册表 |
| 新增参数类型 | `params.py` + `app.js` | `ParamSpec.coerce/to_dict`、`buildParamField` |
| 新增 HTTP 接口 | `server.py` | Pydantic 模型 + 路由 + `SERVICE.mutate` |
| 新增面板 tab | `index.html` + `app.js` | tab 按钮、`section#tab-x`、`switchTab`、`ui` |
| 改右键菜单/上下文 | `app.js` | `onContextMenu`、`openGenericMenu`（`children`=下钻+返回） |
| 新增元件分类 | `nodal.py` | `ELEMENT_GROUP_ORDER`、`ELEMENT_GROUPS`（catalog `group` 唯一来源） |
| 改检查器/规格页 | `app.js` | `renderNodeInspector`、`renderSpecPane` |
| 改工程文件格式 | `project.py` | `build_project`/`validate_project`/`migrate_project` |
| 改桌面菜单/桥 | `webview_app.py`、`webview_bridge.py` | `_build_menu()`、`WebviewBridge`（js_api） |
| 改扩展限制 | `extensions.py` | `MAX_*`、`_FORBIDDEN_*` |

---

## 13. 三件套验证（每阶段收尾必跑）

```bash
cd /e/Python/MyPython/ProjectPoint/NetlabHome
python -m pytest netlab/tests -q            # 期望 627 passed, 1 skipped
python -m compileall -q netlab              # 无输出即通过
python -m netlab.desktop --selftest         # 期望 "ok": true
```

前端改动再加一条端到端（见 LESSONS.md §3）：

```bash
python netlab/run.py --port 8010 --no-browser --log-level warning &   # 必要时重启
node netlab/tools/cdp_eval.mjs "document.title"
```

---

## 文档导航

| 文档 | 什么时候读 |
| --- | --- |
| 本文件 | 开工第一件事：框架速查 |
| [LESSONS.md](LESSONS.md) | 踩坑/排错/验证前先查，避免重复错误 |
| [REQUIREMENTS_AND_RULES.md](REQUIREMENTS_AND_RULES.md) | 需求原话、提示词与协作规则 |
| [PROGRESS.md](PROGRESS.md) | 当前进度与 V2 阶段计划 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 需要深入原理（1000 行，按需查章节） |
| `IMPLEMENTATION_PLAN.md`（已删除，见 git 历史） | 最初设计与需求映射 |
| [EXTENDING.md](EXTENDING.md) | 要写扩展/新规格时的可复制代码 |
| [CODE_STANDARDS.md](CODE_STANDARDS.md) | 改代码前必读：Python black+flake8、前端 TypeScript+esbuild 规范（D119，SSOT） |