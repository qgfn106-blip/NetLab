# Netlab 架构

> 读完这份文档，你应该能回答：**进程里有哪些层**、**一次仿真步怎么走完**、**数据从画布到求解器再回到曲线经过了谁**、**想加功能该动哪里**。

## 1. 总体形状

Netlab 是**单进程**的：一个 FastAPI 服务、一个常驻仿真线程、一份场景状态和一份静态前端。浏览器只是这个进程的显示层。

```
┌──────────────────────────────────────────────────────────────────┐
│ 浏览器（netlab/static：index.html + app.js + style.css）           │
│  画布渲染 · 参数面板 · 曲线/回放 · 轮询 /api/state + /api/live     │
└───────────────▲──────────────────────────────────┬───────────────┘
                │ JSON（HTTP）                     │ 用户操作
┌───────────────┴──────────────────────────────────▼───────────────┐
│ FastAPI 服务层（netlab/server.py）                                │
│  请求校验 · 场景增删改 · 工程/工作区文件 · 分析接口 · 控制接口     │
└───────┬───────────────────────┬───────────────────────┬──────────┘
        │                       │                       │
┌───────▼────────┐     ┌────────▼─────────┐    ┌────────▼─────────┐
│ NetworkContainer│     │ FemSimulation    │    │ BlockLibrary     │
│ 多个 Simulation │     │ Q4 有限元 + 线程 │    │ 复用子图 / 块定义 │
└───────┬────────┘     └──────────────────┘    └──────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────────┐
│ Simulation（netlab/simulation.py）                                │
│  配置 · 线程循环 · 实时节拍 · 录制器 Recorder · 预计算             │
└───────┬──────────────────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────────┐
│ Scene（netlab/scene.py）：网络 + 引擎 + 参数校验                   │
│   signal/vector → SignalEngine     circuit → CircuitEngine        │
└───────┬──────────────────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────┐   ┌───────────────────────────┐
│ graph.Network（信号流）           │   │ nodal.CircuitSolver（MNA） │
│ 节点字典 + 连接纯函数 + 拓扑排序   │   │ 元件 stamp + Newton + 积分 │
└──────────────────────────────────┘   └───────────────────────────┘
```

## 2. 场景数据模型

一个工程（`*.netlab`）是一个版本化 JSON，核心字段：

```
{
  "format": "netlab-project", "version": 5,
  "networks": [ { "id", "name", "mode": "signal|vector|circuit",
                  "nodes": [ { "id", "name", "kind", "position", "params", "data" } ],
                  "edges": [ { "id", "name", "source", "target", "kind", "params" } ] } ],
  "current": "网络 1",
  "fem": {...}, "ui": {...}, "blocks": [...], "extensions": {...},
  "metadata": { "name", "saved_at", ... },
  "checksum": "<sha256>"
}
```

- **节点**：画布上的圆形实体。`kind` 决定用哪套处理逻辑；`params` 是静态参数；`data` 是每步更新的动态数据（信号模式下即节点状态）。
- **连接**：有向边。`kind` 决定连接函数；信号模式下是纯函数，电路模式下连接代表元件。
- **网络**：一个工程可含多个网络，`mode` 在网络级固定；同一进程里只有一个「当前网络」在跑。
- **校验和**：`project.compute_checksum` 对整个负载（除 `checksum` 字段外）做规范化序列化后取 sha256。任何规范化/迁移都必须重算它。

场景的运行时对象由 `Scene` 持有：`nodes: dict[str, NodeRecord]`、`edges: dict[str, EdgeRecord]`，两者都带 `params`（校验后的参数）与 `state`（跨步状态）。

## 3. 三种计算内核

### 3.1 信号流与矢量（`graph.Network`）

- 每个节点持有一个字典；每条连接是 `(source_view, target_view, params, state, dt) -> dict` 的纯函数。
- 每步按**拓扑顺序**逐个 `update`：连接先从上游取值算出目标输入，再调用节点处理函数。
- 非线性/代数环：`algebraic_cycles` 检测环，环内边自动插入一步延迟（`delayed=True`），保证可解。
- **事务**：`Network.step` 先 `capture_step_state()`，任一节点或连接抛错就 `restore_step_state()` 再抛出，失败不会留下半更新的现场。
- 不可信（`trusted=False`）的处理器拿到的 `state` 是隔离副本，成功后原地回写，避免处理器私改状态污染回滚。

### 3.2 电路（`nodal.CircuitSolver`）

标准 MNA：未知量 = 非接地节点电压 + 需要支路电流的元件（独立电压源、VCVS、运放等）。

**一步求解**（`_step_locked`）：

1. `time += dt`，所有元件 `prepare(dt, time)`：电容/电感把储能转成伴随电导 + 电流源；独立源刷新当前值。
2. `_newton_with_strategies()` 求非线性方程组：
   - 初始猜值来自上一步状态；
   - 每轮 `_blank_matrix()` 新建矩阵，逐元件 `stamp()`（`_stamp_conductance` / `_stamp_current` 两个原语），求解 `A·x = b`；
   - 残差用**尺度无关的后向误差**衡量；不收敛时依次尝试 gmin stepping、source stepping；
   - 规模较大（或 `sparse=on`）时用 SciPy 稀疏 LU + 行列均衡。
3. 收敛后逐元件 `commit()`：写 `state` 与 `result`（`current`、`voltage_difference`、`power`…），`result` 被 `state.update` 合并，供 UI 探针读取。
4. 失败时恢复本步开始前的快照（时间、解向量、元件状态），异常上抛——**一步要么完整推进，要么完全不动**。

**积分方法**（`SolverOptions`/`Scene.integration`）：

| 方法 | 元件伴随模型 | 特点 |
| --- | --- | --- |
| `trapezoidal` | `g=2C/dt` 等 | 默认，二阶、精度好，开关电路可能出现电流振铃 |
| `backward_euler` | `g=C/dt` 等 | 一阶、强阻尼，最稳 |
| `gear2` | BDF2 | 二阶、固定步长；历史不足或 `dt` 变化时自动退回 BE |

**分析接口**：

- `CircuitSolver.operating_point()`：DC 工作点。电容开路、电感用 `1e5 S` 近似短路、源取 `t=0` 值；求解后**恢复检查点**，不污染瞬态状态。
- `CircuitSolver.ac_sweep(freqs, input_source=..., probes=...)`：先求工作点，再在工作点线性化出实数矩阵，然后按 `jω` 构建复数 MNA，逐频求解。只支持线性元件与受控源；含二极管/BJT/MOS 等会明确报错。

### 3.3 有限元（`netlab/fem.py`）

单位方板上的二维 Q4 瞬态热传导，独立线程、独立录制，与拓扑网络互不影响。`/api/fem/state`、`/api/fem/live` 提供色图与探针数据。

## 4. 参数、元件与扩展

- `params.ParamSpec` 描述每个参数的键、类型、默认值、单位、范围；`Scene` 在增删改时统一 `validate_params`。
- `nodal.ELEMENT_SPECS` 是元件目录（名称、参数、公式文本、引脚、分组），`transistors.py` / `logic.py` / `timers.py` / `digital.py` / `magnetics.py` 的元件规格在导入时合并进来。
- 目录里的 `formula` 是**给人看的**，必须与实现一致；有测试盯着这一点（本仓库对外发布时不包含该测试，但代码里保留了同样的约定）。
- `extensions.py`：从 `extensions/nodes/*.py`、`extensions/methods/*.py` 动态加载自定义节点/连接，按白名单校验后注册。
- `blocks.py`：把一组节点封装成可复用块（`encapsulate_nodes`），块实例在运行时是嵌套 `Scene`，暴露输入/输出端口。

## 5. 线程与数据流

```
用户操作 → POST /api/* → 修改 Scene（持有 Simulation.lock）
仿真线程 → Simulation._advance_locked(dt) → Scene.step(dt) → 引擎.step
        → Recorder.push(frame)（含 t、节点电压、元件探针）
浏览器 → GET /api/state（低频，结构/参数）
       → GET /api/live?cursor=N（高频，仅新帧，≤600 帧/次）
```

- 仿真线程按 `realtime` 标志决定是否用 `fps × steps_per_frame` 的节拍 sleep；关闭实时节拍即「能算多快算多快」。
- `steps_per_frame` 只影响每帧步数，`sample_every` 只影响录制密度，两者都不改变物理步长 `dt`。
- 录制环 1200 帧；超出容量时**等间隔降采样**（保留首尾），而不是截断——保证任何一次投递都是完整时间序列。

## 6. 前端

无构建步骤：`index.html` 加载 `app.js`（原生 ES 模块风格，单文件）与 `style.css`。

- 画布用 Canvas 2D 绘制节点/连线/网格，支持缩放、平移、框选、正交连线。
- 参数面板由 `/api/catalog` 的描述数据动态生成，不在前端硬编码元件字段。
- 曲线面板维护自己的帧缓冲与回放游标；回放时进入「只读历史」状态，双击或「回到实时」退出。
- 与后端的所有请求都走同一个 `api()` 包装，统一超时、错误提示与 token 头。

## 7. 想改功能，去哪

| 需求 | 位置 |
| --- | --- |
| 新增电路元件 | `nodal.py` 或对应元件模块：子类 + `ELEMENT_SPECS` 条目 + 参数表 |
| 新增信号节点/连接 | `computes.py` / `methods.py` + 前端 `AddMenu` 描述 |
| 新增模板 | `templates.py` 的 `TEMPLATES` |
| 新增分析接口 | `server.py` 端点 → `Simulation`/`Scene` 方法 → 引擎实现 |
| 改参数校验 | `params.py` + 对应 spec |
| 改工程格式 | `project.py`（含版本迁移与 checksum） |
| 改画布交互 | `static/app.js` + `style.css` |

## 8. 不变式（改动时别破坏）

1. **场景可序列化**：任何状态都必须能进 `to_payload`，并能从 payload 完整重建。
2. **一步事务**：`Scene.step` 失败后，时间、解、元件状态必须与调用前一致。
3. **参数即契约**：`spec.params` 是校验与 UI 的唯一来源；实现读的参数必须都在表里。
4. **公式即文档**：`ELEMENT_SPECS.formula` 必须描述实际算法，不允许写「理想模型」而跑另一套。
5. **本机优先**：默认只监听 `127.0.0.1`，不引入外链资源与遥测。
