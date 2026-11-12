# Netlab 全栈扩展架构（Plugin API v1）

> 最后更新：2026-11-07（§6.8/§8.1/§8.2/§8.3/§9.1 以 3.20.1 代码校正：PanelSpec/VisualSpec 字段、netlab-ui/1 严格白名单、工程 ui 段旧键、实现现状标注）
> 状态：设计规范，已接受（2026-11-06）
> 决策记录：[adr/0002-plugin-extension-architecture.md](adr/0002-plugin-extension-architecture.md)
> 迁移指南：[EXTENDING.md](EXTENDING.md)（现有内置扩展方式）
> 术语：[GLOSSARY.md](GLOSSARY.md)

本文定义 Netlab 的插件化扩展边界：**节点与连接仍是唯一的数据图结构**，插件只扩展种类、算法、数据和表现。本文是设计规范；首版实现已完成（2026-11-06，§7.74），后续按 §14 迭代。

---

## 1. 目标与非目标

### 1.1 目标

1. 用户可以用一个 Python 插件包，同时接入：
   - 节点计算（compute）；
   - 连接函数（method）；
   - 电路元件（element）；
   - 分析算法（analysis）；
   - 数据导入/导出格式（data format）；
   - 自定义求解引擎（engine，只能作为新 mode）；
   - 模板生成器（template）；
   - 声明式 UI 面板与节点视觉。
2. 插件通过稳定的 `netlab.plugin_api.v1` 门面访问平台，不直接依赖 `netlab` 内部模块。
3. `NodeRecord` / `EdgeRecord` 的核心字段与 JSON 结构保持不变；插件私有数据独立命名空间。
4. 插件有 manifest、版本、依赖、能力声明、管理页和明确的错误状态。
5. UI 提供“简洁模式”和“专业模式”；用户可在视图内直接调整布局、令牌、节点卡片和连线样式。
6. 插件缺失时工程可降级打开，相关节点明确标为“未解析”，不静默替代。

### 1.2 非目标

- 不在本阶段实现在线插件市场、自动下载或自动 `pip install`；
- 不提供 OS 级沙箱；插件是受信任的进程内 Python 代码；
- 不允许插件替换内置 `SignalEngine`、`CircuitEngine`；
- 不允许插件任意改写核心 `NodeRecord` / `EdgeRecord` 字段；
- 不执行插件提供的任意 HTML/CSS/JS；
- 不把 `vector` 模式改为复数模式（R39 只做分析边界，vector 保持原语义）。

---

## 2. 不变式

### 2.1 节点记录

```json
{
  "id": "n1",
  "name": "gain1",
  "kind": "gain",
  "params": {"gain": 2.0},
  "data": {"voltage": 0.0},
  "position": {"x": 100, "y": 80},
  "size": {"w": 120, "h": 56},
  "ext": {}
}
```

- `id/name/kind/params/data/position/size` 是核心字段，插件不得增加、删除或改名。
- `ext` 是可选字段，值为 `dict[plugin_id, dict]`；只有对应插件可以读写自己的子树。
- 节点 `kind` 是字符串；内置 kind 不变；插件 kind 使用 `<plugin_id>.<local_kind>` 命名。
- `params` 只允许该 kind 的 `ParamSpec` 声明字段；未知参数在编辑/载入时拒绝。
- `data` 是本拍结果或用户可编辑值，不存跨步状态。
- `state` 不在持久化记录里，只存在运行时。

### 2.2 连接记录

```json
{
  "id": "e1",
  "name": "e1",
  "source": "n1",
  "target": "n2",
  "kind": "pass",
  "params": {},
  "delay": false,
  "enabled": true,
  "ext": {}
}
```

- `source/target/kind/params/delay/enabled` 是核心字段，插件不得改写语义。
- 插件连接函数通过 `MethodSpec` 注册；连接记录只保存 kind 和参数。
- 插件私有数据写入 `ext[plugin_id]`；不得把二进制、对象或 NumPy 数组写入记录。

### 2.3 模式

- `signal`、`circuit`、`vector` 是内置模式，语义由核心维护。
- 插件可以注册新的 mode（例如 `stateflow`、`thermal`），但只能通过 `EngineProtocol` 驱动。
- 任何模式都必须使用统一 `NodeRecord`/`EdgeRecord`；不允许自定义 Scene 记录类。

---

## 3. 插件包布局与 manifest

### 3.1 目录

```text
NetlabHome/
└─ extensions/
   └─ plugins/
      └─ com.example.power/
         ├─ plugin.json
         ├─ __init__.py
         ├─ nodes.py
         ├─ methods.py
         ├─ elements.py
         ├─ analyses.py
         ├─ panels.py
         └─ data/
```

- 插件根目录名必须等于 manifest 的 `id`。
- 插件子目录可自由组织；入口由 `entry` 指定。
- 插件不得写入自己的安装目录；运行期数据使用 `PluginContext.data_dir`（默认 `NetlabHome/extensions/plugin_data/<plugin_id>/`）。

### 3.2 `plugin.json`

```json
{
  "schema": "netlab-plugin/1",
  "id": "com.example.power",
  "name": "Power Pack",
  "version": "1.2.0",
  "author": "Example Corp",
  "description": "电力电子节点、元件和分析算法",
  "plugin_api": "1.0",
  "netlab": ">=3.19,<4.0",
  "entry": "power_plugin:register",
  "capabilities": [
    "compute",
    "method",
    "element",
    "analysis",
    "data_io",
    "panel",
    "template"
  ],
  "permissions": [
    "filesystem:plugin_data",
    "network:none",
    "subprocess:none"
  ],
  "dependencies": {
    "com.example.core": ">=1.0,<2.0"
  }
}
```

字段规则：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `schema` | 是 | 固定 `netlab-plugin/1`，manifest 结构版本。 |
| `id` | 是 | 反向域名风格：`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`。 |
| `name` | 是 | 显示名。 |
| `version` | 是 | 插件语义化版本 `MAJOR.MINOR.PATCH`。 |
| `plugin_api` | 是 | 只接受主版本相同的 `1.x`；不兼容时拒绝加载并提示升级插件。 |
| `netlab` | 是 | 兼容的 Netlab 版本范围，按语义化版本解析。 |
| `entry` | 是 | `module:function`；函数签名 `def register(ctx: PluginContext) -> None`。 |
| `capabilities` | 是 | 供管理页展示、校验注册范围；不能注册未声明的能力。 |
| `permissions` | 否 | 声明性能力，不构成 OS 隔离；管理页展示。 |
| `dependencies` | 否 | `{plugin_id: version_range}`，按拓扑序加载。 |

### 3.3 插件入口

```python
# power_plugin.py
from netlab.plugin_api.v1 import PluginContext, ComputeSpec, ParamSpec


def register(ctx: PluginContext) -> None:
    ctx.register_compute(ComputeSpec(
        kind="com.example.power.rate_limiter",
        label="速率限制器",
        group="Power",
        description="限制信号上升/下降速率",
        params=(
            ParamSpec("rise", "上升速率", "float", 1.0),
            ParamSpec("fall", "下降速率", "float", 1.0),
        ),
        factory=make_rate_limiter,
        outputs=("voltage",),
    ))
```

- `register()` 只做注册，不启动线程、不读网络、不写用户目录。
- 注册在**暂存注册表**中原子完成；任一异常回滚整个插件，不留半成品。
- 注册重复 `kind` 直接报错，不允许覆盖内置或其它插件。

---

## 4. 加载、依赖与生命周期

### 4.1 状态机

```text
discovered → validating → loading → loaded
                         ↘ incompatible
                         ↘ error
loaded ⇄ disabled
loaded → reloading → loaded | error
```

- `discovered`：扫描到目录和 manifest。
- `validating`：schema、id、版本范围、导入白名单、能力声明检查。
- `loading`：按依赖拓扑序导入并执行 `register()`。
- `loaded`：可用于场景。
- `disabled`：用户显式禁用，不再注册；已有工程引用时进入未解析。
- `error`：加载失败，保留错误摘要和 traceback（仅管理页）。
- `incompatible`：API/Netlab 版本不匹配。

### 4.2 依赖

- 依赖按 `dependencies` 建图，拓扑排序加载。
- 缺失依赖、版本不满足、循环依赖：插件状态 `error`，不加载；管理页显示缺失链。
- 依赖插件的公共 API 只能通过 `netlab.plugin_api.v1` 或该插件自己发布的扩展点访问，不允许直接 import 对方内部模块。

### 4.3 重载

- 只有**没有活动场景引用**该插件时，才允许热重载。
- 有活动场景时，管理页提示“重启后生效”，不强制中断运行中的仿真。
- 禁用一个被当前工程引用的插件，等同于工程进入“未解析”状态（见 §9）。

### 4.4 缺插件

工程打开时若 `plugins` 锁段有插件缺失：

1. 不删除节点/边；保留原 `kind`、`params`、`ext`。
2. 对应节点标记 `unresolved`，在画布/检查器/列表中显示“插件未安装”徽标。
3. 允许查看、导出、另存；禁止运行、禁止添加该插件新节点。
4. 提示安装的插件 id/版本范围，不自动下载、不自动替换。

---

## 5. 稳定 API 门面：`netlab.plugin_api.v1`

### 5.1 允许导入

```python
# 声明式 dataclass 全部由 netlab.plugin_api.v1 导出；
# 注册一律走 PluginContext 的 ctx.register_* 方法（见 §9.2），
# 模块级不存在 register_compute/register_panel 之类的自由函数。
from netlab.plugin_api.v1 import (
    ParamSpec,
    ComputeSpec,
    MethodSpec,
    ElementSpec,
    AnalysisSpec,
    AnalysisResult,
    AnalysisContext,
    DataFormatSpec,
    EngineSpec,
    EngineProtocol,
    PanelSpec,
    VisualSpec,
    TemplateSpec,
    PluginContext,
)
```

- 这是唯一允许的 `netlab` 导入路径。
- 加载器对插件源码做 AST 检查：允许 `netlab.plugin_api.v1`；拒绝 `netlab.computes`、`netlab.core`、`netlab.server` 等内部模块。
- 标准库、NumPy 等第三方包可由用户环境提供；插件必须在 manifest 的 `requires`/文档中声明第三方依赖。
- 禁止 `importlib` 动态导入、`eval/exec`、文件系统遍历等；这是导入卫生检查，不是安全沙箱。

### 5.2 `PluginContext`

```python
class PluginContext:
    plugin_id: str
    plugin_dir: Path
    data_dir: Path
    manifest: Any | None
    logger: logging.Logger
    registrations: list[tuple[str, Any]]
    # 方法：register_compute / register_method / register_element / register_analysis /
    #       register_data_format / register_panel / register_visual / register_template
    def register_compute(self, spec: ComputeSpec) -> ComputeSpec: ...
```

- `data_dir` 由平台创建；插件不得自行创建全局目录。
- `logger` 自动带插件 id 前缀（`netlab.plugin.<id>`）。
- `manifest` 是已校验的 manifest 快照；`registrations` 记录声明，由 `PluginManager` 统一落注册表。

---

## 6. 扩展点

### 6.1 节点计算（compute）

```python
@dataclass(frozen=True)
class ComputeSpec:
    kind: str
    label: str
    group: str
    description: str
    params: tuple[ParamSpec, ...]
    factory: Callable[[dict[str, Any]], Handler]
    outputs: tuple[str, ...] = ()
    notes: str = ""
    formula: str = ""
```

- `factory(params)` 返回 `handler(ctx)`；`handler` 规则与 `EXTENDING.md` §1 完全一致。
- `ctx.state` 只存跨步状态；`ctx.data` 是本拍可编辑数据；返回值必须 JSON 原生。
- 插件 kind 由 `PluginManager._qualify` 统一加 `<plugin_id>.` 前缀（`netlab/core/model/plugins.py:226-235`）；`ParamSpec` 的字段名不得以 `_` 开头。

### 6.2 连接函数（method）

```python
@dataclass(frozen=True)
class MethodSpec:
    kind: str
    label: str
    group: str
    description: str
    params: tuple[ParamSpec, ...]
    factory: Callable[[dict[str, Any]], MethodHandler]
    outputs: tuple[str, ...] = ()
    notes: str = ""
    formula: str = ""
```

签名：`method(source: NodeData, target: NodeData, params: dict, state: dict, dt: float) -> None`。
连接函数只能读写 `target` 和传入的 `state`，不得访问全局 Scene。

### 6.3 电路元件（element）

```python
@dataclass(frozen=True)
class ElementSpec:
    kind: str
    label: str
    description: str
    params: tuple[ParamSpec, ...]
    element_cls: type
    notes: str = ""
    group: str = "插件"
    formula: str = ""
    pins: tuple[dict[str, Any], ...] = ()
```

元件类遵循 `EXTENDING.md` §3 的生命周期：`prepare/commit/stamp`。插件元件不得修改 `CircuitSolver` 内部矩阵布局，不得注册全局回调。

### 6.4 分析算法（analysis）

```python
@dataclass(frozen=True)
class AnalysisSpec:
    kind: str
    label: str
    description: str
    params: tuple[ParamSpec, ...]
    modes: tuple[str, ...]
    run: Callable[[AnalysisContext], AnalysisResult]
```

`AnalysisContext`：

```python
@dataclass
class AnalysisContext:
    scene: Scene
    simulation: Simulation | None
    params: dict[str, Any]
    probes: list[str]
    input_node: str | None
    output_node: str | None
    logger: logging.Logger
```

`AnalysisResult` 统一信封：

```json
{
  "kind": "series",
  "series": [
    {
      "name": "v(out)",
      "x": [0.0, 0.001],
      "y": [0.0, 1.0],
      "x_unit": "s",
      "y_unit": "V"
    }
  ],
  "table": null,
  "summary": {"peak": 1.0},
  "warnings": []
}
```

许可 `kind`：`series` / `table` / `summary`。所有数组必须是有限数值的列表；复数用 `{re, im}` 或幅度/相位字段，不允许 `NaN/Inf`。

### 6.5 数据导入/导出（data format）

```python
@dataclass(frozen=True)
class DataFormatSpec:
    kind: str
    label: str
    extensions: tuple[str, ...]
    mime_types: tuple[str, ...]
    read: Callable[[bytes, dict[str, Any]], dict[str, Any]]   # 返回下方 Dataset（dict）
    write: Callable[[dict[str, Any], dict[str, Any]], bytes]
```

`Dataset` 统一结构：

```json
{
  "columns": [
    {"name": "time", "unit": "s", "dtype": "float"},
    {"name": "voltage", "unit": "V", "dtype": "float"}
  ],
  "rows": [[0.0, 1.0], [0.001, 1.1]],
  "metadata": {"source": "scope.csv"}
}
```

### 6.6 自定义求解引擎（engine）

> 说明：下列 `EngineSpec` 为 **V1 插件实现说明中的历史示意**，不是阶段 4 V2 接口定义；V2 唯一完整定义见 `CORE_INTERFACE_CONTRACTS.md`，字段以该文档为准。

```python
@dataclass(frozen=True)
class EngineSpec:
    mode: str
    label: str
    description: str
    factory: Callable[[Any], Any]
    node_kinds: tuple[str, ...] = ()
    edge_kinds: tuple[str, ...] = ()
```

`EngineProtocol`：

```python
class EngineProtocol(Protocol):
    def build(self, scene: Scene, store: BlockStore) -> None: ...
    def step(self, dt: float) -> None: ...
    def reset(self) -> None: ...
    def probes(self) -> dict[str, float]: ...
    def stats(self) -> dict[str, Any]: ...
```

- `mode` 由 `_qualify` 加 `<plugin_id>.` 前缀，避免和内置 mode 冲突。
- `node_kinds` / `edge_kinds` 是 kind 字符串元组；记录仍是统一 `NodeRecord`/`EdgeRecord`。
- 引擎不允许改 `Simulation` 主循环、Recorder 或 Scene 记录结构。

### 6.7 模板（template）

```python
@dataclass(frozen=True)
class TemplateSpec:
    kind: str
    label: str
    description: str
    builder: Callable[[dict[str, Any]], dict[str, Any]]
```

`builder` 返回可被 `load_payload()` 接受的 scene payload；不得直接写文件、不得依赖外部网络。

### 6.8 UI 面板与视觉（panel / visual）

```python
@dataclass(frozen=True)
class PanelSpec:                 # netlab/plugin_api/v1/__init__.py:109
    id: str
    title: str
    slot: str = "right"          # 当前仅作声明，前端按右栏/底栏插槽预留
    layout: dict[str, Any] = {}  # 见 §8.4
    data_sources: tuple[str, ...] = ("recorder",)  # 只读源名（探针/analysis kind/snapshot key）


@dataclass(frozen=True)
class VisualSpec:                # netlab/plugin_api/v1/__init__.py:118
    kind: str
    label: str
    icon: str = ""
    accent: str = ""             # 引用 §8.3 中的设计令牌名
    fields: tuple[str, ...] = ()
```

- `PanelSpec` 不允许 HTML/JS；`layout` 只支持 `sections`, `fields`, `table`, `chart`, `text`, `badge`, `progress` 等声明式节点。
- `snapshot()` 是插件可选方法：`def snapshot(self) -> dict[str, Any]`，无副作用，返回 JSON。
- **现状（3.20.1）**：注册表接受并保存 `PanelSpec`/`VisualSpec`，但前端 `frontend/app.ts` 目前没有渲染插件面板/自定义视觉的代码，仅 `VisualSpec` 的字段用于节点外观数据；本节其余为设计目标，实现后需同步。

---

## 7. 数据接口与类型

### 7.1 严格 JSON

- 插件边界只接受 `None/bool/int/float/str/list/dict`。
- `float` 必须有限（拒绝 `NaN/Inf`）。
- NumPy 标量转 `float`/`int`；数组转嵌套列表。
- 复数统一 `{"re": float, "im": float}`；频响结果如用幅度/相位，则字段名必须明确 `magnitude/phase_deg`。
- 禁止 `set`、`bytes`、dataclass、自定义对象、`numpy.float64`。

### 7.2 `ext` 命名空间

- 持久化插件数据只允许写入 `node.ext[plugin_id]` / `edge.ext[plugin_id]`。
- 每个插件只读写自己的子树；平台不合并、不解释其中的业务字段。
- `ext` 内容也必须是严格 JSON。

### 7.3 参数与状态

| 位置 | 用途 | 持久化 |
| --- | --- | --- |
| `params` | `ParamSpec` 声明的配置 | 是 |
| `data` | 本拍结果/用户可编辑值 | 是 |
| `state` | 跨步运行时状态 | 否 |
| `ext[plugin_id]` | 插件私有持久化数据 | 是 |

---

## 8. UI 架构

### 8.1 双模式画布

`ui profile` 的 `mode`（`netlab-ui/1.mode`，视图设计器选择项 `frontend/app.ts:12823`）：

- `professional`：现有画布、完整检查器、全部高级参数。
- `simple`：同一 `NodeRecord`/`EdgeRecord`，节点渲染为紧凑卡片，只展示 `VisualSpec.fields` 和 2–4 个关键值；连接用明确的端口点，点击/拖拽即建边；检查器只显示常用参数，高级项折叠。

**现状（3.20.1）**：切换只会写 `body.dataset.canvasMode` 并切 `.simple-canvas`（`frontend/app.ts:12737-12740`），`frontend/style.css` 尚无对应样式规则，独立的简单画布渲染**尚未实现**；已实现的是节点字段开关 `show_detail/show_value`（映射 `state.ui.cardDetail/cardValue`，`app.ts:3166-3167`）。

简洁模式不是新场景、不是新数据格式、不是新求解模式；切换只改变视图，不改工程数据。

### 8.2 视图内“界面设计”

工具栏增加“界面设计”开关。开启后：

- 节点：拖动位置（已实现）；节点边角缩放/端口位置调整（设计目标）。
- 边：拖动折点、选择直线/正交/曲线（`edge.route`、`edge.waypoints`，已实现），线宽/虚线/颜色令牌（设计目标）。
- 面板：拖动分隔条调整宽度（`#panelResize`，已实现）；面板显隐/排序（设计目标）。
- 选择对象后，右侧“外观”页签显示：显示字段（`show_detail`/`show_value`）、颜色令牌、布局尺寸与字体缩放。
- 支持撤销/重做；「应用并保存」调用 `POST /api/ui` 写入运行期 UI 配置（`netlab-ui/1`），当前版本不提供“设为全局默认”或写入工程文件的入口。

所有设计操作都是声明式的，写入 `ui` profile；不得注入任意 CSS/HTML。

### 8.3 UI profile schema（`netlab-ui/1`）

```json
{
  "profile": "netlab-ui/1",
  "mode": "professional",
  "tokens": {
    "background": "#0b1220", "surface": "#111a2c", "panel": "#162238",
    "text": "#e6edf7", "muted": "#8da2bf", "accent": "#4cc9f0",
    "grid": "#22314b", "edge": "#7c8db5", "node": "#1c2b45",
    "danger": "#ff6b6b", "success": "#5ee39b"
  },
  "layout": {
    "panel_width": 320, "node_width": 150, "node_height": 54,
    "grid_size": 24, "edge_width": 2, "font_scale": 1.0
  },
  "node": {"radius": 10, "show_ports": true, "show_values": true,
           "show_detail": true, "show_value": true},
  "edge": {"route": "orthogonal", "arrow": true}
}
```

- 严格白名单：`profile`/`mode`/`tokens`/`layout`/`node`/`edge` 之外的键一律 `ValidationError`（`netlab/core/model/ui_profile.py:61-105`）。
- `profile` 必须是 `netlab-ui/1`；`mode` 只能是 `simple|professional`。
- `tokens.*` 只接受 11 个已知令牌名且值必须是 `#RRGGBB`（`HEX_RE`），不接受别名或任意 hex 之外的写法；`layout.*` 必须是已知项且为数字（0.1–10000）。
- `node.show_detail` / `node.show_value` 即前端「显示节点类型/端口」「显示节点数值」两个开关；`node.show_ports`、`node.radius`、`edge.route/arrow` 同样受白名单约束。
- 通过 `POST /api/ui` 保存到运行期 `SERVICE.ui`（不写入工程文件）；工程 `.netlab` 的 `ui` 段是另一组旧键（见 §9.1）。

### 8.4 `PanelSpec.layout` 组件

```json
{
  "sections": [
    {"type": "fields", "title": "关键值", "fields": ["i_d", "i_q"]},
    {"type": "chart", "title": "波形", "series": ["i_d", "i_q"], "x": "time"},
    {"type": "table", "title": "状态", "source": "snapshot"},
    {"type": "text", "title": "说明", "text": "..."}
  ]
}
```

- 组件只允许 `fields/table/chart/text/badge/progress`。
- `chart` 的 `series` 只能引用 `PanelSpec.data_sources`（元组，默认 `('recorder',)`）声明的只读源。
- 面板在帧边界统一取数；不能直接读插件对象。

### 8.5 前端组件目录

- 所有节点视觉从 `VisualSpec` + 设计令牌渲染；插件不提供 DOM。
- 简单模式的卡片内容由 `netlab-ui/1.node.show_detail/show_value` 与 `layout` 参数控制（现为设计目标）。
- 专业模式保留现有交互；两者共享选择模型、撤销栈、保存/载入和测试。

---

## 9. 工程格式 v6

### 9.1 结构

```json
{
  "format": "netlab-project",
  "version": 6,
  "name": "grid-inverter",
  "plugins": [
    {"id": "com.example.power", "version": "1.2.0", "sha256": "..."}
  ],
  "networks": [],
  "current": null,
  "ui": {"view": "signal", "tab": "chart", "grid": {"snap": true, "size": 20},
         "cardDetail": true, "cardValue": true},
  "metadata": {}
}
```

- `plugins` 是正式字段；`sha256` 可选，用于内容校验。
- 工程 `ui` 段保存的是**旧版视图偏好**（`view/tab/workspace/grid/symbol/nodeStyle/drawing*/cardDetail/cardValue/symbolScale/glyphColor`，由 `frontend/app.ts` 的 `buildProjectPayload()` 组装、`netlab/core/model/project.py` 的 `json_safe(ui)` 落盘）；它与运行期 `netlab-ui/1`（`POST /api/ui`）是两套结构，不要混用。
- `networks` 内 NodeRecord/EdgeRecord 结构不变。

### 9.2 v5 → v6 迁移

1. 读入 v5。
2. 增加 `"version": 6` 和 `"plugins": []`。
3. 增加空 `"ui": {}`。
4. 保持所有 `networks`、`current`、`metadata` 原样。
5. 重新计算 `checksum` 后保存。

迁移必须是幂等的；重复打开 v6 不再改写。

### 9.3 缺插件与版本不匹配

- 工程锁记录插件 id/version；加载时按 semver 范围校验。
- 缺失或版本不匹配：工程以只读/降级模式打开，相关节点 `unresolved`，禁止运行。
- 不自动安装、不自动降级到其他版本；管理页给出安装/升级提示。

---

## 10. 插件管理页

### 10.1 入口

- 顶部/设置增加“扩展”入口，打开本地管理页（浮窗或独立视图，沿用现有浮窗框架）。
- 页面显示：
  - 插件名称、id、版本、作者、`plugin_api`、`netlab` 兼容范围；
  - capabilities/permissions；
  - dependency 状态；
  - `loaded/disabled/error/incompatible/missing` 状态与错误摘要；
  - 已注册的 compute/method/element/analysis/panel 数量。

### 10.2 操作

- 扫描插件目录；
- 启用/禁用（同一端点，`enabled` 布尔开关）；
- 重新加载（无活动场景时）；
- 查看错误详情；
- 查看/复制插件 id 和版本；
- 不提供在线市场、不自动下载。

### 10.3 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/plugins` | 插件摘要、状态、能力、依赖 |
| GET | `/api/plugins/{id}` | 详情、注册项、错误 |
| POST | `/api/plugins/scan` | 扫描目录 |
| POST | `/api/plugins/{id}/enable` | 启用/禁用（请求体 `{"enabled": true\|false}`，禁用=`false`） |
| POST | `/api/plugins/{id}/reload` | 重载（无活动场景） |

所有请求沿用现有 `extra="forbid"` 与统一错误体；管理页不执行插件代码以外的任意输入。

---

## 11. 兼容性

### 11.1 版本规则

- `plugin_api`: `1.0`；同主版本兼容，主版本升级需迁移。
- `netlab`: Python 包语义化版本；插件 manifest 声明范围。
- `schema`: `netlab-plugin/1`；manifest 结构变化时升版本。
- `ui schema`: `netlab-ui/1`。

### 11.2 旧扩展兼容层

- 现有 `extensions/nodes/*.py`、`extensions/methods/*.py` 继续可加载；注册 kind 保留 `user.` 前缀。
- 旧扩展在管理页显示为 `legacy`，不具备 plugin 包能力（analysis/engine/data_io/panel/template）。
- 新扩展不应使用旧接口；文档标注 deprecated，只保证现有行为不回归。

### 11.3 与内置注册表

- 内置 `COMPUTE_SPECS` 等仍是核心；插件注册到独立 `PLUGIN_REGISTRY`，catalog 合并输出。
- 插件 kind 不得与内置 kind 同名；加载时先校验后注册。
- 插件被禁用后，其 kind 从 catalog 消失；已有工程引用进入未解析。

---

## 12. 安全与信任

- 插件是受信任的进程内 Python 代码；没有沙箱、没有资源限额。
- `plugin.json` 的 `permissions` 是声明性的，管理页展示；用户首次启用/工程首次引用时明确提示。
- 平台执行静态导入白名单检查，阻止常见的 `netlab` 内部 import，但这不是安全边界。
- 插件不得自动更新、自动下载或修改其他插件目录。
- 插件数据目录按 id 隔离；路径解析必须拒绝 `..` 和绝对路径逃逸。

---

## 13. 测试与验收

### 13.1 单元测试

- manifest 校验：必填字段、id 格式、版本范围、非法 schema、路径越界。
- 依赖：拓扑顺序、循环、缺失、版本不匹配。
- 注册：内置冲突、插件冲突、重复注册、能力未声明。
- 导入检查：允许 `netlab.plugin_api.v1`，拒绝 `netlab.core`、`netlab.server`、动态 import。
- 数据边界：拒绝 NumPy 标量、NaN/Inf、set、bytes；复数 `{re,im}` 通过。
- 工程 v5→v6 迁移：字段保持不变、checksum 更新、幂等。

### 13.2 集成测试

- 示例插件注册 compute/method/element/analysis/panel/template；
- 自定义 EngineSpec 在空场景起步、step/reset/probes/stats；
- 缺插件工程降级打开、节点标未解析、运行被拒绝；
- 旧 `user.` 扩展仍能加载并被标记 legacy；
- 插件管理页 API 全流程（扫描/启用/禁用/重载）；
- UI profile 保存/载入/项目覆盖；简洁模式不改变 Node/Edge 记录。

### 13.3 验收口径

- 现有 581 项回归测试不下降；新增插件测试独立文件。
- 同一工程在 simple/professional 两种视图下节点/边数量、kind、params、连接关系完全一致。
- 插件缺失时工程可读、可导出，但运行返回明确错误码与提示。

---

## 14. 实施阶段（设计后）

| 阶段 | 内容 | 交付 |
| --- | --- | --- |
| P0 | 固定 API 门面与 manifest schema，写 `plugin_api/v1` 类型 | 类型/文档/校验 |
| P1 | 插件扫描、依赖、注册表、管理页 API | 可加载空插件 |
| P2 | compute/method/element 适配与迁移测试 | 首批扩展点 |
| P3 | analysis/data_format/template/engine | 算法与数据扩展 |
| P4 | UI profile、简洁画布、视图设计器、PanelSpec | UI 扩展 |
| P5 | 工程 v6、缺插件降级、legacy 兼容 | 迁移与验收 |
| P6 | 文档/示例插件/全量回归/备份 | 稳定版 |

每一阶段都必须先写测试；实现阶段不得改变本规范中的 Node/Edge 不变式和插件 API 主版本。

---

## 15. 相关文档

- [ARCHITECTURE.md](ARCHITECTURE.md)：现有运行时、注册表和前端架构；
- [EXTENDING.md](EXTENDING.md)：现有单文件扩展写法（legacy 与内置扩展）；
- [GLOSSARY.md](GLOSSARY.md)：插件、视图、数据接口术语；
- [adr/0002-plugin-extension-architecture.md](adr/0002-plugin-extension-architecture.md)：本规范的决策记录。
