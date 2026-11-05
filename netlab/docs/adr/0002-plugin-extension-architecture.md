# ADR 0002：插件化全栈扩展架构

- 状态：已接受（2026-11-06）
- 决策者：用户（grill-with-docs 访谈）
- 相关：R40（待登记）、D99（待登记）、`EXTENSIBILITY_ARCHITECTURE.md`、`EXTENDING.md`、`GLOSSARY.md`

## 背景

Netlab 现有的扩展方式集中在四个进程内注册表：`COMPUTE_SPECS`、`METHOD_SPECS`、`ELEMENT_SPECS`、`TEMPLATES`。这套结构让新增节点、连接和电路元件不需要改前端，但仍有四个限制：

- 只有 `extensions/nodes|methods` 的单文件 Python 扩展，无法打包一组相关的节点、连接、算法、数据格式和 UI 描述；
- 新能力依赖直接 import `netlab.compute/computes/methods/nodal` 等内部模块，核心重构容易破坏扩展；
- 扩展代码没有能力声明、依赖关系、版本兼容与缺失插件处理；
- 前端只能靠内置的 `catalog` 和固定面板，没有“简单画布”和“视图内直接调节 UI”的正式协议。

用户要求：所有架构（UI 接口、数据接口、底层算法）都要可扩展，方便用户自定义接入函数；底层节点与连接结构保持稳定；同时提供更简易的节点/连接 UI，并允许在视图里直接设置和绘制 UI。

## 决策

采用**受信任的进程内插件包 + 稳定 `netlab.plugin_api.v1` 门面 + 声明式 UI 协议**。核心决策如下（完整规范见 `EXTENSIBILITY_ARCHITECTURE.md`）：

1. **扩展边界**：插件是模块级扩展；现有 `SignalEngine`/`CircuitEngine` 不可替换。
2. **自定义求解引擎**：只能注册为新的 mode；现有 `signal`/`circuit`/`vector` 语义不动。
3. **插件交付**：独立 Python 包，放在 `NetlabHome/extensions/plugins/<plugin_id>/`；工程只引用插件 id/version，不自动下载。
4. **插件形态**：`plugin.json` manifest + Python 入口模块 + 装饰器/显式注册；UI 由 schema 自动生成，不执行任意前端代码。
5. **节点/连接结构**：`NodeRecord`/`EdgeRecord` 的核心字段不变；插件私有持久化数据只进 `ext[plugin_id]`，`params` 仅允许 `ParamSpec` 声明的字段，`data` 是本拍用户数据，`state` 是运行时状态。
6. **UI 扩展**：自动表单（`ParamSpec`）+ 视觉元数据 + 声明式 `PanelSpec`；不开放插件 JS/HTML。
7. **安全模型**：受信任的进程内 Python 插件；manifest 声明 capability/permission 供管理页展示和用户判断；明确不是沙箱。
8. **兼容性**：语义化版本 + `plugin_api` 主版本 + `netlab` 版本范围；主版本不兼容拒绝加载并给出迁移提示。
9. **v1 扩展点**：节点计算、连接函数、电路元件、分析算法、数据导入导出、UI 面板描述、模板生成器，全部纳入。
10. **生命周期**：启动扫描加载、显式重载；运行中的场景不换代码；提供插件管理页。
11. **依赖**：manifest 声明插件 id+version 依赖，按拓扑序装载；循环、缺依赖、版本不满足均报错；第三方 Python 包由用户预装，不自动 pip。
12. **缺插件**：工程降级打开，相关节点标“未解析”，禁止运行并提示安装；不自动下载、不静默替代。
13. **旧扩展兼容**：保留 `extensions/nodes|methods` 兼容层并标记 legacy；新能力只走插件包。
14. **数据边界**：插件输入输出严格 JSON 原生类型；NumPy 数组转嵌套列表；复数统一 `{re,im}` 或 magnitude/phase；核心校验器拒绝非法类型。
15. **分析算法**：统一 `AnalysisSpec`，`run(ctx)->AnalysisResult`；结果信封为 `series`/`table`/`summary` 三类。
16. **导入边界**：插件只能 `from netlab.plugin_api.v1 import ...`；`netlab` 内部模块私有；加载器做静态导入检查。
17. **引擎协议**：固定 `EngineProtocol`：`build(scene,store)/step(dt)/reset()/probes()/stats()`；`EngineSpec` 声明 mode、kind schema、catalog 元数据。
18. **工程格式**：`format_version` 升 6，新增 `plugins` 锁段；v5 自动迁移为 v6（`plugins` 为空），Node/Edge 记录不变。
19. **管理页**：本地管理页显示 id/版本/作者/API/能力/依赖/状态，支持扫描、启用、禁用、重新加载、查看错误、打开插件目录；不做在线市场。
20. **简单画布**：在现有 Netlab 内新增“简洁模式”，与“专业模式”共用同一 Node/Edge 数据，不另建一套场景。
21. **视图内 UI 设计**：视图工具栏提供“界面设计”模式，可直接拖拽/缩放节点卡片、调整面板分隔、选择主题令牌、节点卡片字段和连线样式；配置保存为项目级 `ui` 覆盖，全局设置提供默认值。
22. **声明式 UI 配置**：`netlab-ui/1` 只允许布局、设计令牌、字段列表、枚举样式和 `PanelSpec`，不接受任意 CSS 选择器/HTML/JS。
23. **面板数据源**：`PanelSpec` 只绑定三类只读源——recorder 探针、`AnalysisSpec` 结果、插件 `snapshot()` JSON；统一在帧边界读取。
24. **工程锁**：工程 `plugins` 段保存插件 id、版本和可选内容 hash；运行时校验，缺失/不匹配进入“未解析/降级”状态。

## 后果

**正面**

- 节点与连接记录继续是唯一数据真相，插件只扩展“种类”和“表现”，不会长出第二套图模型。
- `plugin_api.v1` 成为稳定门面，核心可以重构而不破坏第三方插件。
- 插件包可同时提供节点、连接、元件、分析、数据格式、模板和 UI 描述，适合真实工程扩展。
- 简洁模式与专业模式共享数据；用户可以在视图里直接设计，不需要改代码或重启。
- 插件缺失、版本不匹配、依赖错误都有明确状态，不会静默改变仿真结果。

**代价/限制**

- Python 插件仍在进程内运行，能力声明不等于安全隔离；恶意插件不可完全防护。
- 插件 API 需要长期维护兼容层，主版本升级要有迁移工具/说明。
- UI 配置必须限制在声明式 schema 内，复杂自定义布局不能像任意前端框架一样自由。
- v6 工程格式需要迁移与校验；旧 v5 工程要写入空 `plugins` 并重算 checksum。

## 备选方案（未采用）

- **直接开放任意 `netlab` 内部 import**：灵活但核心重构立即破坏插件，不采用。
- **允许插件写任意 HTML/CSS/JS**：自由但破坏离线、安全和统一交互，不采用。
- **让插件替换 `SignalEngine`/`CircuitEngine`**：会绕过求解器不变量和既有测试，不采用。
- **只做单文件 `@node`/`@method` 扩展**：无法表达分析、数据格式、UI 面板和依赖，不满足本次目标。
- **工程缺插件时静默用空实现替代**：会悄悄改变仿真语义，不采用。
