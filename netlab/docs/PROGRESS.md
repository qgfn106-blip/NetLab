# Netlab 执行进度与修订计划

> 最后修改：2026-11-06 18:30

| 项 | 内容 |
| --- | --- |
| 记录时间 | 2026-11-06 15:45（Asia/Shanghai） |
| 当前阶段 | **2026-11-06 R43 数学加速（M1）M0–M1d 完成（§7.79）：P3 Woodbury 影子路径（n≥160 守卫；n=201 1.59×、n=301 4.85×）、P1 排序只读评测（真实语料 1/2 未过 DoD，生产保持 COLAMD）、P5 遥测只读诊断均已落地；默认 `NETLAB_MATH_ACCEL=off` 行为不变；M1d 集成回归完成**。静态 **3.20.1**，netlab 全量 **602 passed / 1 skipped**；mathspec 参考实现 **107 passed**。上一阶段 **§7.78**：R43 M0/M1b 影子实现；**§7.77**：文档体系整理；**§7.76**：前端 JS→TS 迁移（P16/P17）；**§7.74**：R40 全栈扩展架构；**§7.72**：R31 并网逆变器。 |
| 基线 | 修改前 43 passed（2026-10-24 14:26） |
| 当前测试 | **589 passed**（2026-11-06 02:00 全量 `python -m pytest netlab/tests -q`，3 warnings，69.95 s，退出码 0；stderr **0 次** `0xc0000139`；新增 R40 插件/工程/UI 目标测试 8 条） |
| 本地备份 | `NetlabExtras/backups/ProjectPoint_backups/netlab_3_20_1_20261106_0205`（10 文件 + MANIFEST.sha256，iro.js 颜色选择器集成备份，mismatches=0）；`NetlabExtras/backups/ProjectPoint_backups/netlab_3_20_0_20261106_0136`（36 文件 + MANIFEST.sha256，R40 代码 + 文档重构最终备份，mismatches=0）；`NetlabExtras/backups/ProjectPoint_backups/netlab_3_19_0_20261105_1450`（28 文件 + MANIFEST.sha256，§7.72 最终备份）；`NetlabExtras/backups/ProjectPoint_backups/netlab_3_18_0_20261105_1340`（15 文件 + MANIFEST.sha256，§7.71 最终备份）；`NetlabExtras/backups/ProjectPoint_backups/netlab_3_17_1_20261105_0845`（15 文件 + MANIFEST.sha256，§7.70 最终备份）；`NetlabExtras/backups/ProjectPoint_backups/netlab_3_17_0_20261105_0345`（23 文件 + MANIFEST.sha256，§7.69 最终备份）；`NetlabExtras/backups/ProjectPoint_backups/netlab_final_20261105_0205`（14 文件 + MANIFEST.sha256，§7.68 最终集成检查）、`NetlabExtras/backups/ProjectPoint_backups/netlab_solver_r38_20261105_0155`（9 文件 + MANIFEST.sha256，§7.67 相图指标/CSV）、`NetlabExtras/backups/ProjectPoint_backups/netlab_solver_p5_20261105_0140`（12 文件 + MANIFEST.sha256）、`NetlabExtras/backups/ProjectPoint_backups/netlab_solver_p4_20261105_0125`（本轮 §7.65 的 analysis.py / test_network_tf.py / 文档 + MANIFEST.sha256）、`NetlabExtras/backups/ProjectPoint_backups/netlab_solver_p3_20261105_0110`（§7.64 的 graph.py / computes.py / scene.py / test_algebraic_solver.py / 文档 + MANIFEST.sha256）、`NetlabExtras/backups/ProjectPoint_backups/netlab_solver_p2_20261105_0055`（§7.63 的 graph.py / scene.py / test_algebraic_solver.py / 文档 + MANIFEST.sha256）、`NetlabExtras/backups/ProjectPoint_backups/netlab_solver_p1_20261105_0040`（§7.62 的 graph.py / computes.py / scene.py / test_solver_plan.py / 文档 + MANIFEST.sha256）、`NetlabExtras/backups/ProjectPoint_backups/netlab_plan_20261104_2355`（本轮规划文档 4 文件 + MANIFEST.sha256，R36–R38/D92–D94）、`NetlabExtras/backups/ProjectPoint_backups/netlab_control_20261104_1815`（本轮 14 文件 + MANIFEST.sha256，§7.61）、`NetlabExtras/backups/ProjectPoint_backups/netlab_import_20261104_1423`（§7.60 10 文件 + MANIFEST.sha256，§7.60）、`NetlabExtras/backups/ProjectPoint_backups/netlab_guard_20261104_1356`（本轮 5 文件 + MANIFEST.sha256，§7.59）、`NetlabExtras/backups/ProjectPoint_backups/netlab_delayfix_20261104_1315`（本轮 7 文件 + MANIFEST.sha256，§7.58）、`NetlabExtras/backups/ProjectPoint_backups/netlab_menu_20261104_0756`（§7.57 7 文件 + MANIFEST.sha256）、`NetlabExtras/backups/ProjectPoint_backups/netlab_fields_20261104_0225`（21 文件 + MANIFEST.sha256，R35/D91）、`NetlabExtras/backups/ProjectPoint_backups/netlab_audit_20261103_1920`（15 文件 + MANIFEST.sha256，架构审计 §7.55）、`NetlabExtras/backups/ProjectPoint_backups/netlab_transfer_20261103_1602`（14 文件 + MANIFEST.sha256，R34/D90）、`netlab_20261101_2010`（本轮 7 源文件 + 5 文档 + 5 测试 + MANIFEST.sha256）、`NetlabExtras/backups/ProjectPoint_backups/netlab_plotkit_token_20261103_1253`（8 文件 + MANIFEST.sha256）、`NetlabExtras/backups/ProjectPoint_backups/netlab_free_layout_20261103_1430`（P4 自由布局）、`NetlabExtras/backups/ProjectPoint_backups/netlab_layer_window_20261103_1450`（P3 图层浮窗）、`NetlabExtras/backups/ProjectPoint_backups/netlab_notes_20261103_1508`（P5 批注）、`NetlabExtras/backups/ProjectPoint_backups/netlab_precision_20261103_1552`（PlotKit 预览精度 §7.53）、`NetlabExtras/backups/ProjectPoint_backups/netlab_20261024_142654`、`_1727`、`netlab_20261025_0125`、`netlab_20261025_1306`（P0-0）、`netlab_20261026_0348p1retry`（P1 收口）、`netlab_20261026_1240`（R15 收尾）、`netlab_20261026_1318`（R20 模型批基础层）、`netlab_20261026_1322`（R20 模型批功能完成）、`netlab_20261026_1330`（R20 UI 批）、`netlab_20261026_1335`（R20 UI 迁移动作）、`netlab_20261026_1340`（R20 信号端口）、`netlab_20261026_1415`（纯导线/共集示例）、`netlab_20261027_0150`（P7-01 前快照）、`netlab_20261027_1744`（P7-03 收尾）、`netlab_20261027_1753`（R22 参数放宽/单位）、`netlab_20261027_1856`（三极管型号预设）、`netlab_20261027_2218`（拐点拖动）、`netlab_20261027_2324`（P7-03/P7-05 收尾）、`netlab_20261027_2330`（P0 求解可靠性）、`netlab_20261028_0016`（P0 收尾/P7-05）、`netlab_20261028_0048`（电源波形界面）、`netlab_20261028_0103`（dt 精度预设）、`netlab_20261028_0114`（奇异阈值/步长原位微调）、`netlab_20261028_0318`（P0 求解加固：事务/均衡/断点/超时）、`netlab_20261028_0405`（Phase D/E 代码前快照）、`netlab_20261028_0434`（R26 代码前快照）、`netlab_20261028_1219`（工程校验和修复前 `project.py`）、`project_20261028_1219`（用户工程文件前快照）、`netlab_20261028_1855`（R27 后端/前端快照）、`docs_20261028_1932`（公开仓库文档前快照）、`docs_20261028_2108`（R28 文档前快照）、`web_20261028_2130`（演示页与 workflow 删除前快照）、`ui_20261028_2205`（R29 回放滑块前 static 快照）、`netlab_ui_20261028_2242`（R30 UI 集中优化前 netlab 全量）；文档快照见 `docs_20261026_*、docs_20261027_1744、netlab_docs_20261028_0420、netlab_docs_20261028_0445` |
| 备份清单 | 各自目录下 `MANIFEST.sha256` |
| 版本控制 | 用户已授权 GitHub `qgfn106-blip` 做版本管理/备份（2026-10-24）；仓库在 `NetlabHome/.git`，本地备份同时保留；GitHub `main` 已包含功能提交 `f564485` 与文档补记 `261f8a`（功能提交 tree `9ea4909842a34dc496cc0c1dd9b4ff38a1977854`，与本地 `51b1eba` 一致） |
| 速查文档 | **[AGENT_GUIDE.md](AGENT_GUIDE.md)（开工先读）**、**[UI_SPEC.md](UI_SPEC.md)（UI 设计语言/组件/接口）**、[FRAMEWORK_CHEATSHEET.md](FRAMEWORK_CHEATSHEET.md)、[LESSONS.md](LESSONS.md)、[REQUIREMENTS_AND_RULES.md](REQUIREMENTS_AND_RULES.md)、[SOLVER_CODE_MAP.md](SOLVER_CODE_MAP.md)；仓库根 `AGENTS.md` 指向本套文档 |
| 下一步 | R40 插件/UI/工程 v6 首版与全量文档重构已完成（§7.74/§7.75）；R31 P11-01…P11-07 已完成（§7.72）；R19 参考级图纸暂停；R25 完整电路级内部结构留后续 |
| 需求口径 | **以 [REQUIREMENTS_AND_RULES.md](REQUIREMENTS_AND_RULES.md) 的 R01–R43 + D1–D119 为准**；本文档 §7 为执行进度地图 |

> 本文件只记录**已实际验证**的内容；未完成的能力明确标为“未接通/未实现”，
> 不把计划写成已完成。

---

## 1. 已完成并验证

### 1.1 安全与基线

- 已创建带时间戳的本地源码备份与 SHA-256 清单；备份位于项目目录之外。
- 修改前全量回归：`python -m pytest netlab/tests -q` → **43 passed**。
- 所有新增/修改文件均通过 `python -m compileall -q netlab`（无语法错误）。

### 1.2 计算加速与数据安全（需求 1 的计算部分）

新增/修改：

- `netlab/core/compute/accel.py`（新）
  - `auto|cpu|gpu` 策略；GPU 需 CuPy + CUDA，规模阈值默认 192；
  - `solve_dense` / `matmul` / `synchronize` / `to_cpu` / `status`；
  - GPU 异常自动回退 CPU，返回前显式同步，不跨步异步。
- `netlab/core/compute/linalg.py`
  - `solve_linear` 统一走 `accel.solve_dense`；支持 1D/2D 右端。
- `netlab/core/model/graph.py`
  - 内置 handler/连接使用 `trusted` 快路径：缓存 `NodeView` 与参数视图、
    浅拷贝 data、快速标量结果校验；
  - 自定义/兼容回调和用户扩展仍走深拷贝 + `json_safe`；
  - `Network` 缓存延迟边与入边列表，不再每步全量扫描所有边。
- `netlab/core/compute/nodal.py`
  - MNA 矩阵/右端缓冲复用；
  - 线性电路 LU 分解缓存（矩阵与 dt 未变时只回代），`linear_reuse` 统计；
  - 非线性 Newton 迭代矩阵变化时缓存自然失效；
  - 预留 GPU 大矩阵路径。
- `netlab/core/compute/fem.py`
  - 高斯热源预计算为稀疏映射矩阵，去掉每步 `bincount` 循环；
  - 结果与原有有限元测试一致。
- `netlab/tests/test_netlab.py` 中数值、FEM、电路、图回归均通过。

实测（本机，Python 3.13.9，CPU，NumPy/SciPy）：

| 场景 | 节点/边 | 中位 step |
| --- | --- | --- |
| `rc_step` | 3 / 3 | 0.0385 ms |
| `control_loop` | 5 / 5 | 0.0419 ms |

新增 `netlab/tools/bench.py`，支持 signal/circuit/FEM/synthetic 场景、
重复轮次、中位数与 p95 输出。**尚未做修改前/后的正式对照基准**；
GPU 因本机未安装 CuPy，**未验证 GPU 路径**，仅验证 CPU 回退。

### 1.3 工程保存与桌面外壳（需求 1 的桌面部分、需求 4 的持久化部分）

新增：

- `netlab/core/model/project.py`
  - 版本化 `.netlab` 工程（format/version/name/scene/sim/fem/ui/blocks/extensions/checksum）；
  - `build_project` / `validate_project` / `migrate_project` / `project_scene_payload`；
  - 原子写入（同目录临时文件 → fsync → 旧文件 `.bak` → `os.replace`）；
  - `load_project` 完整校验；`load_project_raw` 只做结构/版本/校验和检查，
    供桌面桥在扩展信任确认前使用；
  - 旧场景 JSON 自动包装迁移；大小上限 8 MB。
- `netlab/server.py`
  - `GET/POST /api/project/export`、`POST /api/project/validate`、`POST /api/project/import`；
  - `GET/PATCH /api/accel`；
  - 桌面 token 中间件（`NETLAB_DESKTOP_TOKEN`，仅校验 `/api/*`，`/api/health` 例外）；
  - 桌面模式下禁用 `/api/shutdown`，必须关窗口。
- `netlab/desktop/`
  - `server_host.py`：后台 uvicorn、随机空闲端口、健康检查、优雅停止；
  - `bridge.py`：QWebChannel 原生打开/保存/另存、自动保存/恢复、错误提示；
  - `main_window.py`：原生窗口、菜单、最近文件、关闭确认、WebChannel 注入；
  - `app.py` / `__main__.py` / `selftest.py`；
- `netlab/start_desktop.bat`、`netlab/requirements-desktop.txt`。

已验证：

- `python -m netlab.desktop --selftest` → `ok: true`（后端 5 项 + QtWebEngine）。
- 工程 API 冒烟：构建 → 校验 → 导入 → 节点数一致；校验和存在。
- 桌面桥加载工程使用 raw 校验，避免在执行扩展代码前被注册表校验卡住。

**未接通**：前端尚未处理 `window.netlabDesktop`、`netlabDesktopCommand`、
token 请求头、桌面自动保存/恢复；桌面窗口目前能加载页面，但“文件”菜单
触发的保存/打开流程还没有前端实现。

#### 1.3.1 桌面壳改用 pywebview + WebView2（2026-10-31）

Qt WebEngine 壳保留为回退（`python -m netlab.desktop --qt`），默认走 pywebview：

| 项 | Qt WebEngine | pywebview + WebView2 |
| --- | --- | --- |
| 安装体积 | 打包 Chromium，数百 MB | 复用系统 WebView2，几乎为零 |
| 页面就绪 | 2.1–2.3 s | 2.9–3.5 s |
| 进程内存（同一页面） | 383–448 MB | 714–748 MB |

结论：**用体积换内存与启动时间**。功能上已补齐到与 Qt 壳同级：

- `netlab/desktop/webview_app.py`：原生菜单栏（文件/视图/帮助，走 `webview.menu`）、
  窗口几何持久化（`%APPDATA%/Netlab/NetlabDesktop/window.json`）、
  关闭前脏检查确认（`window.events.closing` 返回 False 取消关闭）、
  加载完成再显示（`hidden=True` + `loaded` 回调 + 8 s 兜底），不再有黑窗；
- `netlab/desktop/webview_bridge.py`：纯 Python 桥（打开/保存/另存/自动保存/恢复），
  文件对话框走 `window.create_file_dialog`；
- `frontend/desktop-shim.js`：把 pywebview 的 Promise API 适配成原来的
  QWebChannel 调用风格，**前端零改动**；顺带补 Ctrl+N/O/S/Shift+S；
- `netlab/server.py` 的 `index()` 在 `NETLAB_DESKTOP_SHELL=pywebview` 时注入垫片脚本。

验证：`python -m netlab.desktop --probe` → 标题正确、`window.netlabDesktop` 与
`netlabDesktopCommand` 都在、`hasAutosave()` 真实往返；`netlab/tests` 全绿。

#### 1.3.2 桥接环形窗口的裁剪 bug（2026-10-31 修）

`netlab/plotkit_bridge.py` 的 `_ingest` 原来用
`store.add(name, store.get(name)[-MAX_POINTS:], life="replace")` 做裁剪：
`add()` 会把数据集的 life **永久**改成 `replace`，而 `push()` 只在
`life == "append"` 时追加 → 约 6.8 秒后每次 push 只剩最后一帧，曲线塌成一条线。

修法：PlotKit 新增 `DataStore.trim(name, keep)`（原地裁旧数据、不动 life），
桥接改调 `store.trim(...)`。回归测试 `netlab/tests/test_plotkit_bridge_trim.py`
（推 50 帧、窗口 20，断言长度 20、life 仍是 append、最后一帧是 49.0）。

#### 1.3.3 plotly 退役对 netlab 的影响（2026-10-31）

PlotKit 在 P14-01 里删掉了 plotly 后端、`Figure.plotly()` 与 `GET /api/figure.json`。
netlab 侧**无需改动**，但要知道两点：

- 「绘图」子页签走的是 `/plotkit/api/render`（PNG 字节），从来没调用过 `figure.json`，
  所以页签行为完全不变（`netlab/tests/test_plotkit_tab.py` 仍全绿，netlab 全量 348 passed）。
- 桥接依赖的 `store.push/trim` 语义没变；`DataStore` 现在补了 `__len__/__getitem__`，
  桥接里原来被异常吞掉、从未真正执行过的裁剪分支才真正生效（见 1.3.2）。

### 1.4 规格自省与 Python 扩展（需求 2 的后端部分）

新增/修改：

- `netlab/core/compute/params.py`
  - `ParamSpec` 增加 `group` / `example` / `required` 并序列化。
- `netlab/core/compute/computes.py`、`netlab/core/compute/methods.py`、`netlab/core/compute/nodal.py`
  - 规格增加 `formula` / `source` / `editable` / `builtin`；
  - catalog 通过 `netlab/core/compute/introspection.py` 返回：
    `formula`、真实 `source`（`inspect.getsource`）、`source_path`、参数完整定义。
- `netlab/core/compute/introspection.py`（新）
  - 实际源码读取；失败返回空字符串，不伪造。
- `netlab/core/model/extensions.py`（新）
  - `Param` / `@node(...)` / `@method(...)`；
  - AST 检查：禁止 import、while、with、class、async、dunder 属性/敏感内建；
  - 受限 builtins；代码大小、AST 节点数、参数数量上限；
  - 执行失败回滚注册表；热替换同一 `user.*` kind；
  - 持久化到 `extensions/nodes|methods`；
  - 工程内嵌扩展默认不执行，信任后可原子加载。
- `netlab/server.py`
  - `GET /api/extensions`、`POST /api/extensions/validate|activate|deactivate|scan`、
    `GET /api/extensions/{kind}`；
  - 导入含扩展的工程必须 `trust_extensions=true`。

已验证：

- 自定义 `user.gain2` 节点：注册、场景运行输出 6.0、项目导出包含代码。
- `import os` 被拒绝；使用中的扩展 deactivate 返回 422。
- 扩展代码没有硬超时；这是**已知安全边界**，文档中必须明确“不是沙箱”。

**已实现（V2-2，2026-10-25）**：检查器旁新增「规格」页（公式/参数表/真实源码/源码路径）与
「扩展」页（列表、编辑器、校验、启用、停用、目录扫描）、工程打开时的扩展信任确认弹窗。

### 1.5 功能块系统（需求 3）——V2-0 已接通

已新增：

- `netlab/core/model/blocks.py`
  - `PortDef` / `BlockDef` / `BlockStore` / `BlockRuntime`；
  - 端口方向、字段、类型、默认值、版本、内置标记；
  - 封装选中节点、边界端口生成、实例化端口节点、父场景替换；
  - 嵌套深度上限 6、定义/节点/边/端口上限；
  - 每个实例独立内部 `Scene`，state 隔离；
  - 循环引用检测。
- `netlab/core/compute/computes.py`
  - 新增 `module_input` / `module_output` / `block` 三种节点规格。
- 公式表已补充这些 kind 的说明。

V2-0 已接通的部分（全部有测试覆盖，见 `netlab/tests/test_blocks.py`）：

1. `methods.py` 注册 `pass`（直通传递，只搬运有限数值字段）。
2. `Scene` 增加 `blocks: BlockStore`、`block_instances`、`block_depth`、
   `next_node_name` / `next_edge_name`、`to_payload`/`load_payload` 的 blocks
   读写；载入时校验 block 引用存在。
3. `SignalEngine._wire_blocks` 为块节点创建 `BlockRuntime` 与隐藏 feed/emit
   连接：输入端口 → 块 → 输出端口，隐藏边只负责拓扑顺序与数据搬运；
   块 handler 注入输入、推进内部网络、把输出写回端口缓冲区。
4. `Scene.reset` 经 `SignalEngine.reset` 重置全部块实例内部 state。
5. 封装算法接口边统一使用节点 id；端口按 name 唯一化；封装前先核算
   节点/连接上限，避免半成品状态。
6. `BlockRuntime.step` 改为按端口返回 `{端口: {字段: 值}}`，避免同名字段覆盖。
7. 块实例运行时缓存在 `Scene.block_instances`：重建引擎（例如改参数）不再
   清空内部 state；块定义被替换时按对象身份自动失效。

仍然未实现（属于 V2-3）：电路模式功能块、运放/比较器等内部电路展开、
数字逻辑块、模块 UI。

### 1.6 当前测试状态

```text
python -m pytest netlab/tests -q
71 passed
```

`test_catalog_and_health` 已改为与注册表比对（不再写死 13/11/9），
并断言关键 kind 仍然存在；新增 4 个测试文件：

- `test_blocks.py`（11 项）：直通字段过滤、扁平网络 vs 功能块数值等价、
  两实例状态隔离、reset、保存/加载往返、自引用与嵌套循环拒绝、
  非法端口映射、缺失 block 定义、嵌套封装前置校验。
- `test_accel.py`：CPU 回退、与 NumPy 解析解一致、非法输入拒绝、
  无 CuPy 时 gpu 策略回退。
- `test_project.py`：构建/校验/校验和、篡改拒绝、原子写与 `.bak`、
  旧场景迁移、含功能块工程的保存与载入、缺失定义/循环引用拒绝。
- `test_extensions.py`：AST 拒绝（import/while/dunder）、注册与执行、
  连接函数扩展、执行失败回滚、停用。

另：`python -m compileall -q netlab` 通过；`python -m netlab.desktop --selftest`
返回 `ok: true`。

---

## 2. 尚未开始/未完成的需求

| 需求 | 状态 | 说明 |
| --- | --- | --- |
| 1 桌面化 | 外壳完成，前端未接入 | 文件菜单/保存/打开/自动保存 UI 未接 |
| 1 性能/GPU | CPU 优化完成，GPU 未验证 | 缺 CuPy；无修改前正式基准对照 |
| 2 查看函数/参数 + Python 自定义 | ✅ 已完成（V2-2） | 规格页 + 扩展面板 + 信任确认，7 项测试覆盖 |
| 3 功能块 | 骨架，未接通 | 需 Scene/SignalEngine 集成与测试 |
| 4 保存/参数/绘制直觉 | 工程后端完成，前端未做 | 缺工程菜单、参数分组、撤销/重做 |
| 5 相图/回放 | 未开始 | 轨迹仍 1200 帧；无循环/推荐周期 |
| 6 连线路由 | 未开始 | 仍只有贝塞尔曲线 |
| 7 电路元件/运放/数字 | 仅公式目录，未实现 | 当前仍 9 种元件；无运放/触发器/寄存器 |

---

## 3. 修订后的执行计划（V2）

> 原则不变：每阶段完成后必须测试、审查、更新本文件，并报告后停下等待批准。
> 当前最优先的是把已经动过的内核/模块骨架收口，避免半成品继续扩散。

### V2-0 收口与回归基线（立即执行，最高优先级）

**目标**：让当前代码重新达到“全绿、可运行、无未接通引用”。

范围：

- 注册 `pass` 连接函数（供封装边界使用）；
- `Scene` 增加 `blocks: BlockStore`、`next_node_name`/`next_edge_name`、
  `to_payload`/`load_payload` 的 blocks 读写；
- `SignalEngine` 接通块节点：`BlockRuntime`、隐藏 feed/emit 边、端口注入、
  输出回写、reset、stats；
- 修正 `blocks.py` 封装算法的接口边 id/字段映射；
- 更新 `test_catalog_and_health` 的数量断言为“内置 + 新增 kind”的真实数量；
- 新增 `tests/test_blocks.py`：扁平网络 vs 功能块等价、两实例状态隔离、
  保存/加载、递归拒绝、端口映射非法拒绝；
- 新增 `tests/test_accel.py`、`test_project.py`、`test_extensions.py` 的最小覆盖；
- 全量测试 + `compileall` + 桌面 `--selftest`。

验收：

- 全量测试通过（数量以实际新增测试为准，不低于 50）；
- 功能块示例可运行且与扁平网络数值一致；
- 无未定义引用/导入错误；
- `PROGRESS.md` 更新，报告后停止。

### V2-1 桌面文件流与工程 UX（需求 1/4）——✅ 已完成（2026-10-24）

- 前端识别 `window.netlabDesktop`：保存/打开/另存/最近/自动保存/恢复；
- `netlabDesktopCommand('new|open|save|saveAs|recover|fit|help')`；
- `X-Netlab-Token` 请求头；
- 工程面板：当前工程名、未保存标记、保存/打开/另存、最近文件；
- 浏览器回退：下载/上传 + `localStorage` 自动保存；
- 关闭确认与异常恢复；
- 测试：`test_project.py` API 往返、原子写失败不留半成品、旧格式迁移。

验收：桌面窗口内完成“新建 → 改参数 → 保存 → 关闭 → 打开”闭环；
浏览器模式仍可用；全量测试通过。

### V2-2 规格查看与 Python 扩展 UI（需求 2）——✅ 已完成（2026-10-25）

- 检查器新增“函数/公式”页签：公式、源码、源码路径、参数表
  （名称/类型/默认/单位/范围/说明/必填）；
- 新增“扩展”面板：内置 kind 列表、代码编辑器（textarea + 行号提示）、
  校验、启用、停用、持久化、错误行号；
- 工程打开时的扩展信任确认（显示 kind、哈希、警告“非沙箱”）；
- 前端不执行代码，只通过 API；
- 测试：内置源码可读、参数表完整、危险 AST 拒绝、热重载失败回滚。

验收：任一内置节点/连接可看到真实源码与公式；自定义 `rate_limiter` /
`dead_zone` 可在应用内注册并运行；项目打开默认不执行代码。

### V2-3 功能块 UI 与电路/数字模块（需求 3/7）

- 模块面板：列出定义、封装选中、实例化、查看内部、另存/删除；
- 端口编辑：名称、方向、字段、类型、默认值；
- 内部编辑：面包屑进入/退出（需要 scope 栈；若风险高，改为“载入内部为新场景 + 保存回模块”）；
- 嵌套实例、参数绑定、递归检测；
- 电路功能块：运放/比较器/稳压器展开为内部 MNA 子电路；
- 数字块：AND/OR/NOT/XOR、D 触发器、JK/RS、寄存器、计数器；
  四态逻辑、确定性时钟边沿、模拟-数字桥（阈值/迟滞）；
- 明确标记“行为模型 vs 内部结构模型”。

验收：模块实例与扁平网络数值一致；两实例状态隔离；电路运放闭环增益/
饱和符合预期；触发器真值表/边沿测试通过；保存/加载/嵌套/递归拒绝。

### V2-4 电路元件库（需求 7）

分 Tier：

- Tier A：保险丝、PTC、MOV、稳压管、肖特基、LED、TVS、变容、光电二极管、
  可变 R/C、磁珠、电位器、整流桥、CCCS/CCVS；
- Tier B：BJT/MOSFET/JFET/SCR/TRIAC/IGBT、变压器/互感、555、光耦、继电器、
  直流电机；
- Tier C：MCU/CPU/存储器明确不在首期，文档标注。

每个元件必须有：端口、参数、MNA/行为模型、`prepare/stamp/commit/reset`、
数值或解析测试、参数单位/范围、内部说明。运放/触发器/寄存器优先做
“可查看内部”的层级模块，不能只做黑箱。

验收：每个 Tier A 元件有解析/行为测试；保险丝锁存；运放内部电路可展开；
保存/重置正确；文档列明 Tier B/C 边界。

### V2-5 连线路由、参数设置与撤销（需求 6/4）

- `EdgeRecord.route`：`auto|straight|orthogonal|manual`、waypoints、
  source/target anchor、label_offset、lane、z、avoid_nodes；
- 前端 `router.js` / `geometry.js`：贝塞尔/直线/正交折线/手动拐点；
  拖拽拐点、锚点、标签；层级置顶/置底；简单节点避让；
- 几何缓存按 revision + 节点坐标 + route 失效；拖动只重算受影响边；
- 参数面板分组、说明、单位、默认值、范围、恢复默认；
- 撤销/重做：服务端快照恢复，恢复时暂停并重置运行时状态（明确提示）；
- 测试：路由序列化/加载一致、拖动失效、正交几何单测、撤销不破坏运行状态。

验收：复杂网络连线不遮节点；直角/直线/手动可切换；参数修改有校验；
撤销/重做可用；性能无明显回退。

### V2-6 相图轨迹与回放（需求 5）

- `Recorder` 改列式环形缓冲，容量默认 20,000 帧，时间窗 + 最大点数；
- `/api/history` 抽稀返回；相图“时长 + 最大点数”；
- 回放：播放/暂停/时间游标/循环/速度；循环时长可自定义；
- 推荐周期：优先驱动频率 `1/f`，否则自相关首峰，否则 5 s，并显示依据；
- 区分仿真时间/保留时长/播放速度/循环周期/显示范围；
- 防止缓存无限增长、重复创建绘图对象；
- 测试：截断、重置、暂停、继续、循环边界。

验收：长轨迹不卡顿；循环边界正确；推荐值与依据可见；回放不改变仿真状态。

### V2-7 测试、审查、文档、发布

- 补全单元/集成/数值金标/API/JS 测试；
- 独立审查：计算顺序、数据隔离、锁、原子性、兼容性、安全边界；
- 更新 `README.md`、`ARCHITECTURE.md`、`EXTENDING.md`、`PROGRESS.md`；
- 新增 `docs/PYTHON_EXTENSIONS.md`、`docs/BLOCKS.md`、
  `docs/CIRCUIT_LIBRARY.md`、`docs/DIGITAL.md`、`docs/USER_GUIDE.md`；
- 单文件 exe/打包（可延后；当前未安装 PyInstaller）。

---

## 4. 风险与需要确认的决策

1. **功能块电路展开**：通用电路块需要端口别名合并/内部节点重命名，风险高。
   建议先做 signal/vector 模块，电路模块只对内置运放/比较器/稳压器做
   受控展开；用户自定义电路块后续再开。
2. **数字仿真层级**：建议先做四态逻辑 + 块级内部图，不做晶体管级；需确认。
3. **扩展信任**：当前是“本地可信扩展”，不是沙箱；是否接受？若要强隔离，
   需要子进程/IPC，性能和复杂度都会显著上升。
4. **GPU**：本机无 CuPy，无法验证收益；建议保持默认 CPU，GPU 仅实验开关。
5. **撤销/重做**：用服务端快照恢复会重置运行时状态；需接受“撤销后需重新运行”。
6. **测试数量断言**：现有测试写死 13/11/9/12；新增 kind 后必须改为
   “至少/分组计数”，否则每次扩展都会误报。

---

## 5. 下一步

请确认是否按 **V2-0 收口** 立即执行。该阶段只做“让当前半成品可运行、
测试全绿、补最小测试”，不新增 UI/电路元件，风险最低。
V2-0 完成并报告后，再按 V2-1 → V2-2 → V2-3 → V2-4 → V2-5 → V2-6 → V2-7
逐阶段推进。

---

## 6. 最新状态校正（2026-10-25 01:35，覆盖上文过时描述）

> 说明：本文件曾于 2026-10-25 01:21 被回退成 2026-10-24 17:58 的旧版本（71 passed / V2-0）。
> 下表为当前真实状态，与上文冲突时以本表为准。另：曾有一版「§6 当前计划 V3」被回退丢失，
> 其内容与 V2 阶段一一对应（V3-1=V2-2 规格 UI，V3-2=V2-3 功能块 UI+电路/数字块，
> V3-3=V2-4 元件库，V3-4=V2-5 路由+参数+撤销，V3-5=V2-6 相图回放，V3-6=V2-7 文档发布）。

### 6.1 状态快照

| 项 | 状态 |
| --- | --- |
| 全量测试 | **81 passed, 0 failed**（`python -m pytest netlab/tests -q`，新增 `test_spec.py` 7 项） |
| 语法检查 | `python -m compileall -q netlab` 通过 |
| 桌面自检 | `python -m netlab.desktop --selftest` → `"ok": true` |
| V2-0 功能块引擎 | ✅ 完成（`test_blocks.py` 11 项） |
| V2-1 桌面文件流与工程 UX | ✅ 完成：工程面板、保存/另存/打开/最近、45s 自动保存与恢复、关闭确认、token 头、`netlabDesktopCommand` |
| V2-2 规格查看 + 扩展 UI | 🟡 **前端已实现并经 CDP 手测**；后端（catalog 源码/公式/参数、扩展 API）本就存在 |
| 备份 | `NetlabExtras/backups/ProjectPoint_backups/netlab_20261024_142654`、`_1727`、`netlab_20261025_0125`（含 docs 与三个静态文件 + MANIFEST） |

### 6.2 V2-2 已实现内容（待回归）

- `frontend/index.html`：新增「规格」「扩展」两个面板 tab（`#tab-spec`、`#tab-ext`），静态资源版本 bump 到 `?v=2.2.0`。
- `frontend/app.js` 新增 §6.5：
  - `renderSpecPane()`：按当前选中节点/连接展示规格——公式、参数表（名称/类型/默认/单位/范围/必填/说明）、
    真实源码（带行号）、源码路径、内置/扩展/可自定义徽标；无选中时可下拉浏览当前模式全部规格。
  - `renderExtensionPanel()`：扩展列表（kind/type/sha256/参数数）、代码编辑器、新建模板、校验、启用、停用、
    刷新、目录扫描结果；结果区持久化（`state.ext.result`）。
  - `confirmModal` 支持传入 DOM 节点；打开含扩展工程时展示 kind/type/sha256 与「不是沙箱」警告。
- 已实测（8010 + CDP）：规格页渲染（公式/参数表/源码行/28 个 kind 可选）、模板校验通过、
  启用 `user.rate_limiter` 后列表与 catalog 同步（catalog 中出现 formula/params/source）。

### 6.3 V2-2 收尾结果（2026-10-25 已完成）

| 收尾项 | 结果 |
| --- | --- |
| 规格字段自动化测试 | ✅ 新增 `netlab/tests/test_spec.py` 7 项：四个注册表每项都带 formula/source/source_path/完整参数字段；内置项源码路径指向真实 `.py` |
| pass 公式缺失 | ✅ `methods.py` 的 `METHOD_FORMULAS` 补 `pass`（V2-0 新增时漏登记） |
| 电路节点规格空白 | ✅ `nodal.node_catalog()` 改为返回与元素相同的结构：`node` 用 MNA 公式 + `CircuitSolver.step` 源码，`ground` 用参考电位公式 + `_build_index` 源码 |
| 扩展节点数值端到端 | ✅ 真实 Scene 三步 → `y = 1,2,3`；再走 12 步 → 收敛 10.0（与 `y[k]=y[k-1]+clamp(Σu−y[k-1],±rate)` 一致）；同一用例在运行中的服务上复验通过 |
| 扩展 API 往返 | ✅ validate → activate（catalog 出现该 kind）→ 列表/notice → deactivate；在用节点时停用返回 422 |
| 信任弹窗实测 | ✅ 带 `extensions` 的工程：弹窗列出 kind/type/sha256 与「不是沙箱」；取消 → 场景与扩展均不变（toast 已取消）；信任 → 工程载入 2 节点且 `user.half` 注册成功 |
| 三件套回归 | ✅ `pytest` **81 passed**、`compileall` 通过、桌面 `--selftest` `ok: true` |

V2-2 期间发现并修掉的真 bug：前端「新建模板」给的 `def f(params): ... return handler`
与扩展系统语义不符——`@node` 的被装饰函数**本身就是 handler**（直接收 `ctx`，参数在
`ctx.params`），套一层工厂会在运行期报 `'ComputeContext' object has no attribute 'get'`。
模板已改为 `def rate_limiter(ctx)`，并把这个坑写进 `LESSONS.md §5`。

### 6.4 风险与提醒

- 本工作区出现过文件被回退的情况（PROGRESS.md 01:21 回退到 17:58 版本），
  重要文档改动后立即复制到 `NetlabExtras/backups/ProjectPoint_backups/`；发现内容突变先核对备份再决定是否重写。
- 8010 端口的开发服务与 9333 的 CDP 浏览器是**会话级**的，换窗口后先 `curl /api/health` 确认。

---

## 7. 当前执行计划（P0–P6，2026-10-25 修订）

> 需求条目与决策依据见 [REQUIREMENTS_AND_RULES.md](REQUIREMENTS_AND_RULES.md)（R01–R20 / D1–D40）。
> 本节只做进度视图：每期做完更新状态列并附证据（测试数、实测结论）。

> **编号说明（先读这条）**：`R01–R20` 是**需求编号**；`P0-01…`、`P1-03` 是**票号**（期-序号），
> 票号后面括号或正文里的 R 编号才是它覆盖的需求。两边数字相同只是巧合：
> 例如 **P0-05 做的是 R10（选择/快捷键/撤销）**，而 **P1-03 做的是 R03（模块版本/引用/降级）**——
> 从 R10 回到「03」不是进度倒退，是换了一条编号轨道。

| 期 | 范围 | 状态 |
| --- | --- | --- |
| **P0-0** | 热修：添加节点菜单排除 `block/module_input/module_output`；坏块节点工程给可修复提示；补回归测试 | ✅ 完成（85 passed，备份 `netlab_20261025_1306`） |
| **P0** | 地基：R16 数据保护、R01 工程目录+library、R07 多网络数据模型与 API、R08 菜单栏/左侧栏/顶部信息条/改名、R10 快捷键与选择、R11 `T_step`/时间归零/重置、R13 计时装饰器 | ✅ 01–06 完成（113 passed）；R16 库保护已随 R03/R04 收尾补齐 |
| **P1** | 模块闭环：R02 文件化、R03 版本/引用/降级、R04 导入校验、R05 内部编辑+双模型、R06 接口块、模块库面板、矩形渲染 | ✅ R02–R06 完成 + 收尾（拖拽实例化、关闭内部网络、D6 改名/覆盖、报告落 exports；circuit 接口留 P4） |
| **P2** | 画布：R09 路由三态/锚点/尺寸/吸附/GB 符号/风格（工程级） | ✅ 完成；2026-10-26 补强两轮：标准网格/整理/正交/GB 放大；CAD 式状态栏（栅格/吸附/捕捉点/正交/节点样式）+ 电路小圆节点 + GB 功能专属符号 |
| **P3** | 分析：R12 时域频域/指标/数学形式/CSV、R11 推荐周期、R13 面板与超时保护、R17 L1+L2 | ✅ 完成（R17 L2 传递函数；L1 不强制未做；Bode 曲线未做） |
| **P4** | 元件：R15 三批 + 双模型 + GB；R18 图纸规范；R19 图纸模型 | 🟡 R15 三批全部完成（catalog 30 种）；R18 四批 + R19 数据层/渲染修复完成；**剩余双模型内部视图、R06 circuit 接口**；R19 参考级图纸暂停 |
| **P5** | 帮助：R14 `?` 卡片/文档中心/搜索/术语统一 | 未开始 |
| **P6** | 后续（不承诺）：L3 状态空间、自定义快捷键、分屏、自定义符号、参数反解 | 未开始 |

### 7.1 与旧 V2/V3 编号的对应

| 旧编号 | 新位置 |
| --- | --- |
| V2-0（功能块引擎收口） | 已完成，能力归入 R02/R03 的前置 |
| V2-1（桌面文件流） | 已完成，能力归入 R16 的前置 |
| V2-2（规格页 + 扩展 UI） | 已完成，改名后归入 R08「节点函数/连接函数」 |
| V2-3（功能块 UI + 电路/数字块） | 拆入 P1（模块 UI）与 P4（元件） |
| V2-4（元件库） | P4 |
| V2-5（路由/参数/撤销） | P2（画布）+ P0（撤销） |
| V2-6（相图回放） | P3（R11 推荐周期 + R12 分析） |
| V2-7（文档/审查/发布） | 拆分到各期收尾 + P5 |

### 7.2 P0-0 / 01 / 02 / 03 / 04 / 06 已完成证据

**P0-0（2026-10-25）**：catalog 增加 `addable`（`block`/`module_input`/`module_output`=false），
菜单与 kind 下拉按它过滤；`Scene` 对无 `block_id` 的 `kind=="block"` 抛可修复提示。
证据：85 passed；备份 `netlab_20261025_1306`。

**01 R01（2026-10-26）**：`netlab/core/model/workspace.py`（工程目录 `project.netlab + blocks/extensions/exports/backups`、
父目录 `library/{blocks,templates}` 单份共享、`%APPDATA%/Netlab/settings.json` 可被 `NETLAB_SETTINGS_DIR` 覆盖）；
API `GET /api/workspace`、`POST /api/workspace/{create,save,open}`、`GET/PATCH /api/settings`；
`server._apply_project` 供导入/打开共用。证据：`test_workspace.py` 7 项。

**02 R16 快照（2026-10-26）**：`write_snapshot` 写 `backups/snapshot-YYYYmmdd-HHMMSS-<8hex>.netlab`
（自包含：先 migrate + 补校验和），`prune_snapshots` 保留最近 N + 每日 1，`load_snapshot` 文件名白名单；
API `POST /api/workspace/snapshot`、`GET /api/workspace/snapshots`、`POST /api/workspace/restore`；
前端自动保存改为「有工程路径就写快照、按设置间隔（默认 60 s、可关）」。证据：`test_snapshots.py` 5 项。

**06 R11+R13（2026-10-26）**：`SimConfig.t_step`（0=跟随 dt，单步=round(T_step/dt)）、
`zero_time()`（只归零时间轴/录制，不清状态；`reset` 仍清状态）、`netlab/core/compute/profiling.py`
（`@timed`/`measure`、512 环形采样、默认关），装饰 `scene.step`/`network.step`/`circuit.solver.step`；
API `POST /api/control{action:"zero"}`、`PATCH /api/config{t_step}`、`GET/PATCH /api/profile`。
证据：`test_time_profile.py` 7 项。性能面板与单拍超时保护已由 P3 补齐（见 §7.2 P3 证据）。

**03 R07 多网络（2026-10-26）**：工程格式升到 v2（`networks: [...]` + `current`），
v1 与旧场景 JSON 自动迁移（校验和按迁移前验证、迁移后重算）；新增 `netlab/core/model/networks.py`
（`NetworkContainer`：每网络独立 `Simulation`/线程/录制器，切换暂停旧网络，未运行层不推进，
可 `run_all/pause_all`）；API `GET/POST /api/networks`、`PATCH/DELETE /api/networks/{id}`、
`POST /api/networks/{id}/activate`、`POST /api/networks/run-all|pause-all`；工程导入整体替换网络。
证据：`test_networks.py` 6 项（v1 迁移、非法网络拒绝、容器隔离与切换、工程往返、API CRUD、导入恢复全部网络）。

**04 R08 外壳（2026-10-26）**：`index.html` 新增菜单栏（8 项：文件/编辑/视图/工程·网络/仿真/分析/工具/帮助）与
顶部信息条（工程 `*`、网络与数量、模式、t、step、运行状态），左侧栏改为「网络列表」（点切换、双击改名、
新建/删除、可收起、宽度可拖且存入 localStorage），右侧页签「规格」拆为「节点函数」「连接函数」
（按角色锁定规格列表），「场景」页签改名「工程」；静态资源版本 bump 到 `?v=2.3.0`。
实测（CDP + Edge 无头截图）：8 个菜单可展开且条目正确；节点函数 16 项、连接函数按 edge kind 过滤；
侧栏新建→切换→改名走通（`/api/networks` 同步）；证据截图 [assets/shell-r08.png](assets/shell-r08.png)（1440 双网络）与 `NetlabExtras/screenshots/archify/shell-1000.png`（1000 窄屏）。
未做：撤销/重做、快捷键表、跨层绑定 UI（票 05 / R10、P1）。

**05 R10 交互基础 + R09 画布首批（2026-10-26）**：
数据模型（`scene.py`）新增节点 `size{w}`、连线 `route/waypoints/anchors`，含范围/枚举校验与
`to_payload/load_payload` 往返；API `PATCH /api/nodes/{id}{size}`、`POST/PATCH /api/edges{route,waypoints,anchors}`。
画布按路由绘制（自动曲线/直线/正交/手动）、Alt+点击加拐点、拖拐点、节点右下角尺寸手柄、
网格吸附（20，Alt 暂停）、工程级符号风格（经典/GB 矩形，存 `ui.grid/symbol`）。
交互：Ctrl+单击多选、Ctrl+拖框框选、Ctrl+C/X/V 内部剪贴板（跨网络确认）、Delete 批量删除、
撤销/重做 100 步（场景快照，保留当前 blocks）、快捷键表按 D28。
证据：`test_canvas_model.py` 3 项；CDP 实测（选择节点→尺寸输入 120→拖手柄 200；新增拐点 route=manual；
切正交落库；全选删除 0/0 → 撤销回 4/3；复制粘贴 4/3→8/6 → 撤销回 4/3；框选 2 节点/3 连接）；
截图 [assets/r09-gb.png](assets/r09-gb.png)（GB 矩形节点）、[assets/r09-orthogonal.png](assets/r09-orthogonal.png)（几何面板 + 正交路由）。

**P1-01 R02 文件层（2026-10-26）**：新增 `netlab/core/model/blocklib.py`（`.block` JSON + sha256 校验；
库路径 `library/blocks/<id>/v<N>.block`；同 id+version 内容不同拒绝、相同幂等；导入必须更高版本）；
`BlockDef` 增加 `model`（behavioral|structural，默认 behavioral）；API `GET /api/blocks`、
`POST /api/blocks/import`、`GET /api/blocks/{id}`（可带 `library` 参数，默认 settings.library_root 或 cwd/library）；
证据 `test_blocklib.py` 6 项（布局/往返、同版本冲突、版本单调、篡改拒绝、坏端点拒绝、API）。
**未做**：模块库面板、工程改引用式（只记 block_id+version）、拖拽实例化。

**P1-02 R02 UI（2026-10-26）**：右侧「模块」页签（列表显示模式/模型/版本/端口数；刷新、导入 `.block`、
封装选中、实例化按钮）+ 工具菜单入口；API `POST /api/blocks/instantiate`（从库解析版本→加入场景→实例化）、
`POST /api/blocks/encapsulate`（封装选中→写库 v1）。实测（CDP）：模块列表显示 `twice`；
点「实例化」节点 7→11（块节点 + 3 端口）；步进无错误（修掉「未接线实例导致 signal_path 缺 voltage」——
`BlockRuntime.step` 现在按端口默认值补 0）。截图 [assets/p1-blocks-panel.png](assets/p1-blocks-panel.png)。
证据：`test_blocks_api.py` 4 项 + `test_blocks.py` 未接线实例 1 项。

**P1-03 R03 引用式存储（2026-10-26）**：工程 v3 `blocks` 只存 `{id, version}`；
保存前 `blocklib.ensure_blocks` 同步进库（同版本内容不同 → 拒绝）；`validate_project(payload, library)`
解析引用，缺库/缺文件/损坏给出 `id@vN` 清单并拒绝（失败即停）；`project_scene_payload(..., library=)`、
`workspace.load/save`、`/api/project/export|import` 均已接线（默认 settings.library_root 或 cwd/library）。
证据 `test_project_refs.py` 5 项（引用保存、缺库/缺失清单、同版本冲突、workspace 往返、API 导出引用+缺文件导入 422）。
**未做**：降级只读 + 占位块替换（D7 修复动作）、删除/改名库模块的前置引用扫描（D6 交互）。

**P1-04 R03 收尾（2026-10-26）**：缺失引用 → `validate_project(..., allow_degraded=True)`
合成占位块（端口从场景的 `input_nodes/output_nodes` 推导、内部接口节点齐备、可装配引擎）；
`project["degraded"]={read_only,missing,message}`（加标记后重算 checksum）；`NetworkContainer` 降级期间
`mutate` 一律 409、`/api/control` 的 run/step/toggle 409；前端在 `sim.degraded` 出现时显示红色横幅。
D6：`workspace.scan_block_references` + `GET /api/blocks/{id}/references`，`POST /api/blocks/{id}/delete`
无 `force` 时 409 并列出引用工程。证据 `test_degraded.py` 2 项。

**P1-05 R04 导入前校验（2026-10-26）**：`netlab/core/model/block_validate.py` 输出 `{ok, blocking[], warnings[], summary, block}`
与可复制 `text`；阻断级含结构/自引用/端口无内部接口/干跑失败，警告级含缺描述/空模块/无连接/无输入输出/端口无字段/
接口未声明/子模块不在库；干跑真实 `BlockRuntime.step(0.01)` 1 步（passed/skipped/failed）。API
`POST /api/blocks/validate`；前端导入 `.block` 先校验（阻断→横幅拒绝、警告→确认后导入）。
证据 `test_block_validate.py` 6 项。

**P1-06 R05 内部编辑与双模型（2026-10-26）**：`BlockDef.model` 入库；封装支持 `model`；
`POST /api/blocks/{id}/open-internal` 仅 structural（behavioral 409），把内部作为独立临时网络打开
（D30，不压栈）；`POST /api/blocks/save-copy` 用 `build_block_from_scene` 把当前网络另存为新模块
（新 id、v1、默认 structural）；前端模块面板加「封装为结构模型」勾选、「打开内部」（behavioral 置灰）、
「另存为副本」。证据 `test_block_internal.py` 2 项。**未做**：behavioral 不展开内部的运行时路径（性能目标
未变）、临时网络清理入口。

**P1-07 R06 跨模式与接口块（2026-10-26）**：`Scene._check_block_mode` 在 add/update/load 三处拒绝
模式不匹配的模块（提示改用同模式模块或显式接口）；实例化 API 422。新增节点 kind
`if_signal_to_vector`（x=u·cosθ, y=u·sinθ）与 `if_vector_to_signal`（x/y/模长→标量，含 scale），
登记公式与 catalog。证据 `test_cross_mode.py` 5 项（场景拒绝、工程载荷拒绝、API 422、角度映射、分量/模长）。
**未做**：circuit 侧接口块（R06 期次 P4）。

**P1-08 P1 收尾批次（2026-10-26）**：① 模块项拖拽到画布实例化（DragEvent+DataTransfer，
`screenToWorld` 落点，CDP 实测 4→8 节点）；② 面板「关闭内部网络」删除「模块 …」临时网络；
③ D6 改名/覆盖：`rename_block` / `overwrite_block` + `POST /api/blocks/{id}/rename|overwrite`，
先 `scan_block_references`，有引用 409、`force` 才执行；⑥ 降级工程补回库文件后
`POST /api/project/retry` 严格重校验并解除只读（仍缺 409），面板「补回后重试」；④ R04 报告落当前工程 `exports/`
（`save_report=true`，`CURRENT_WORKSPACE` 由 workspace create/save/open 设置）；⑤ R16 口径补充：
库版本不可原地改、破坏性操作先扫引用、报告不覆盖正本。证据 `test_block_admin.py` 4 项。

**P2-02 R09 锚点拖拽（2026-10-26）**：选中连线显示两端手柄；`anchorSideFor` 按指针相对节点中心
的归一化距离判定 left/right/top/bottom（离开 1.9r 回 auto）；拖拽即时预览候选锚点，松手一次 PATCH
`anchors`（撤销一步可回退）。CDP 实测：amplifier 终点锚点 → `left`，Ctrl+Z 后回到 auto；
截图 [assets/p2-anchor-drag.png](assets/p2-anchor-drag.png)（检查器终点锚点=左）。前端静态版本 2.9.2。

**P3 分析旁路（2026-10-26）**：新增 `netlab/core/compute/analysis.py` 与 `/api/analysis/*`（metrics/spectrum/period/
math/transfer/export，统一 5s 线程超时）。指标含超调/上升/调节时间并带算法来源；频谱为录制 FFT（Hann+校正，
Top 峰值）；周期为 FFT 候选 + 平移一致性（score=1-mae/σ）；数学形式用节点注册表公式；CSV 含 `#` 元数据头、
`网络.节点.字段` 列名、抽稀、只写 `exports/` 同名加序号；传递函数用 sympy 逐级拼接线性节点（假设/来源/失败原因）。
R13：`step_timeout_ms` 单步保护（超时暂停并写 sim.error）；前端「分析」面板含指标/频谱/周期/数学形式/CSV/
传递函数与性能区。证据 `test_analysis.py` 10 项 + CDP 实测面板；截图 [assets/p3-analysis.png](assets/p3-analysis.png)。

**P4-01 R15 批次 1–2（2026-10-26）**：新增行为元件 opamp/comparator/zener/led/dflipflop
（tanh 平滑饱和、比较器双向饱和、稳压管 softplus 击穿钳位、D 触发器上升沿+保持），catalog 共 14 种；
GB 符号按 kind 绘制（电路模式 + `ui.symbol=gb`），截图 [assets/p4-gb-symbols.png](assets/p4-gb-symbols.png)。
证据 `test_p4_elements.py` 6 项（运放反相增益 -10、比较器 ±5、稳压管 5.1V 钳位、LED 正向压降、DFF 边沿/保持）。
**未做**：第三批（BJT/MOSFET/晶闸管/IGBT/变压器/555/LDO/逻辑门/ADC 等）、运放「内部电路」双模型视图、R06 circuit 接口。

**P2-03 R09 网格与 GB 可见性（2026-10-26）**：工程页「画布与标准网格」（吸附开关、10/20/50、
整理到网格）；新建节点/拖动/拐点吸附，Alt 暂停；电路场景 `route=auto` 与新建连线均按正交布线；
GB 符号放大到 1.6–2.4×、青绿主题色、纸色底遮导线。CDP 实测：RLC 模板切换 GB 后 R/L/C/V 符号清晰可见，
正交导线成直角；整理到网格把 (3,7) 节点归到 (0,0)。截图 [assets/p4-gb-grid.png](assets/p4-gb-grid.png)。

**P2-04 CAD 式网格与 GB 线条化（2026-10-26）**：底部状态栏高频开关（栅格/吸附/捕捉点/正交/节点样式），
工程页设置网格 10/20/50、节点样式、符号大小、符号颜色，随工程保存；拖动时最近网格点十字+细环；
电路节点改为空心圆/实心点/小方框（默认圆，直径 24），接地标准符号；GB 功能节点专属符号
（Σ/K 三角/∫/τ/f(x)/~/s/M/I/O/B），无贴图底、与导线同线宽主题色。截图
[assets/cad-grid-snap.png](assets/cad-grid-snap.png)（拖动捕捉）、[assets/cad-node-dot.png](assets/cad-node-dot.png)（实心点）。

**P4-02 R18 图纸规范首批（2026-10-26）**：元件位号（R1/L1/C1/V1）+ 参数（Ω/H/F/波形幅值频率）
常显；≥3 条线汇合的节点画实心节点；符号处用 `circuitWireGap` 只擦中点一小段断线（不贴图底）；
正交布线 + 网格吸附沿用 P2-03/04；截图 [assets/cad-schematic.png](assets/cad-schematic.png)。
**未做**：图纸模式（隐藏网格/图框）、端子号/线号、线宽分级、完整国标尺寸与多页图幅。

**P4-03 R18 方向对齐 + 脱扣器示意（2026-10-26）**：`drawCircuitGlyph` 的旋转改为取**符号中点所在线段**
的方向并量化到 90° 倍数（修复正交折线末段为 0 时的 0° 误判）；新增 `trip_unit` 模板：交流源→二极管
整流→RC 滤波→分压→比较器→R5/R6 电平→D 触发器→R7+LED，行为测试确认越限后 cmp>4、Q>4、LED 点亮。
截图 [assets/trip-unit.png](assets/trip-unit.png)。**未做**：图纸模式/图框、变压器/BJT 等第三批元件，
所以该图是行为级示意而非 DW15 逐器件复刻。

**P4-04 R18 标注/端口方向 + 运放内部宏模型（2026-10-26）**：电路 GB 模式只画元件名（不画参数），
横向线标注在上、纵向线标注在右；电路小节点端口点改为按实际边锚点绘制（随导线旋转）；
新增 `opamp_internal` 模板（7 节点/9 元件：VIN/VREF 差分输入 → E1 增益级 → R1/C1 极点 → E2 缓冲 →
ROUT/RL 输出），测试确认输出为正且数值有限。截图 [assets/opamp-internal.png](assets/opamp-internal.png)。

**R19 规划（2026-10-26）**：按 grill-with-docs 结论把「电气拓扑层 / 图纸布局层」分离写成文档：
`REQUIREMENTS_AND_RULES.md` 新增 R19 与 D34，`netlab/docs/GLOSSARY.md` 定义 20 个术语，
`netlab/docs/SCHEMATIC_DRAWING_SPEC.md` 给出引脚/导线/汇合点/标注/确定性布局/验收清单，
`netlab/docs/adr/0001-schematic-layer.md` 记录取舍与备选方案。**实现未开始**，下一步按 R19 票单施工。

**P4-05 R19 数据层首批（2026-10-26）**：`netlab/core/model/schematic.py` 提供引脚表/绑定解析/确定性自动布局/布局校验；
`EdgeRecord.layout` + API `pins`/`layout`；`/api/schematic/layout|validate`；前端符号位置/旋转优先 `layout`，
工程页「自动布局（电路）」应用后 fitView（可撤销）。测试 `test_schematic.py` 5 项（两次生成一致、节点在 20 网格、
引脚绑定填 params、45° 被拒、API 往返）。截图 [assets/r19-layout.png](assets/r19-layout.png)。
**已做**：旧工程布局迁移（fill_missing_layout，节点不动）、标签避让、交叉弧、图纸模式/图框；**D35 布局决策**：放弃自动布局，元件显式 layout；导线从引脚直线接入、符号沿导线方向；UI 自动布局按钮移除（API 保留）。**未做**：R15 第三批元件、密集图手工模板调优。

**P4-06 R19 引脚走线与位号（2026-10-26）**：`circuitPinPath` 让导线从节点锚点进入元件引脚 1，再从引脚 2 出到目标锚点，
符号处断线；`drawMultiPinWires` 为运放/比较器/DFF 画控制引脚线（参数绑定节点→IN±/D/CLK）；`elementIdentifier`
对不带前缀的名称按元件类型补 R/C/L/D/V/U 等位号；标签方向优先按 layout.rot 判断。截图
[assets/r19-pins.png](assets/r19-pins.png)（trip_unit 自动布局；密集图仍建议手工微调）。
**未做**：旧工程迁移、非连接交叉、标注碰撞检测、图纸模式/图框；自动布局对密集图的观感尚未调优。

**P4-07 R15 第三批收尾：ADC/变压器/互感（2026-10-26）**：新增 `netlab/core/compute/magnetics.py`——`transformer`（v2 = n·v1、
i1 + n·i2 = 0；`Lm>0` 时原边并联励磁电感，用第 3 条支路方程）与 `coupling_inductor`（双绕组互感 M = k·sqrt(L1·L2)，
梯形/后向欧拉伴随模型 `i = i_prev + (dt/2)·L⁻¹·v`）；`netlab/core/compute/digital.py` 新增 `adc4`（逐次逼近：CLK 上升沿逐位比较
8→4→2→1，4 拍锁存 Q3..Q0）。catalog 27→**30**；`test_magnetics.py` 4 项（变比/功率守恒、励磁电感、互感电压比
1.96、catalog）+ ADC 1 项（3.3 V→0b1010、4.9 V→0b1111），**195 passed**。前端补 GB 符号（变压器/互感双绕组+铁芯/
虚线耦合、ADC 矩形+阶梯+7 引脚）与位号 T/L/U。**同时修掉 3 个接线层真 bug**：① 手动布线 `waypoints` 把数字传给
`worldToScreen(point)` → 路径点 `null`（手动折线根本不显示）；② `elementLayoutCenter` 同样误用 → 多引脚引线坐标
NaN、从未画出；③ 引脚几何按世界单位绘制、与符号缩放不一致 → 改为符号本地单位 + `symbolScalePx()`；手动布线边
不再被引脚吸附覆盖，变压器副边参数引脚不再被当作主线。截图
[assets/r15-transformer.png](assets/r15-transformer.png)（T1 n=0.5，SEC+=4.999 V、功率 0）、
[assets/r15-coupling.png](assets/r15-coupling.png)（L1=1 mH/L2=4 mH/k=0.98）、
[assets/r15-adc.png](assets/r15-adc.png)（7 引脚 + 10 MΩ 偏置，无悬空报错）。前端静态版本 3.4.0→3.5.0。

**R20 多端口元件节点化（2026-10-26，模型批基础层落地）**：用户指出「多输入输出的传递连接方法元件需要采用节点的格式，直接采用连接方法没法控制输入输出端口啊」。12 条共识：① 范围 (a)+(b)，电路多引脚元件为核心；② 器件=节点、网络节点保留、边=导线（`source_pin`/`target_pin`，只 pin↔net）；③ 复用封装端口契约、内置组件、双模型；④ 组件黑盒（引脚+计算函数，无运行时中介节点），内部网络保存、默认黑盒、模块化后才展开；⑤ 内置 structural 只读随程序发布，用户模块化写 `.block` 库；⑥ `PinSpec`（role/required/顺序/几何），required 恰好一条导线；⑦ 统一 PinMap（`pins{引脚名:网络id}`、`self.pin`、a/b 别名、参数端口改引脚、旧参数兼容垫片）；⑧ 信号/矢量边 `source_port`/`target_port`；⑨ v3→v4 自动迁移（备份、幂等）；⑩ 先模型（只电路层）→ UI → 信号/矢量端口；⑪ 每阶段全绿+新测试封口；⑫ 兼容问题写入 §8.1 专节。证据：R20/D36–D40/§8.1、票 09–11；**2026-10-26 模型批基础层已落地（PinSpec/器件节点/导线/PinMap/v3→v4 迁移；209 passed）**；元件类已改 `self.pin()`，30 种元件装配测试通过（242 passed）；UI 批已支持器件框/引脚/导线/检查器与「迁移场景为器件模型」动作（静态 3.6.1，截图 r20-device-*）。旧边路径仍作兼容垫片。

**R20 UI 批（部分，2026-10-26）**：前端器件节点渲染（组件框 + 引脚 + 名称）、`wire` 导线（引脚→网络，正交/手动折线）、引脚拖拽建线（CDP 实测 8→9 条导线）、添加菜单「器件 · …」（30 种）、器件检查器（元件类型/宽度/引脚状态/参数）与导线检查器；静态版本 3.6.1；工具菜单「迁移场景为器件模型（R20）」调用 `/api/scene/migrate-devices`（幂等，CDP 实测 0→4 器件、4 边→8 导线）。截图 [assets/r20-device-nodes.png](assets/r20-device-nodes.png)、[assets/r20-device-inspector.png](assets/r20-device-inspector.png)。**未做**：内置模板迁移、旧边路径删除、布线/撤销专项回归；243 passed。

**R20 信号/矢量端口（票 11 核心，2026-10-26）**：`PortSpec` + `ComputeSpec.inputs`（if_signal_to_vector: u；if_vector_to_signal / vector_transform: x/y）；边 `source_port`/`target_port` + 校验；`Node.ports`/`ctx.ports`；接口节点优先读端口；`source_port` 装配期改写方法输入字段；检查器端口下拉。测试 5 项，**248 passed**。旧边不填端口按原语义兼容（§8.1）。**未做**：MIMO 方法（走节点格式）、R06 circuit 侧接口。

**R20 用户追加（2026-10-26）**：① 纯导线 `wire` 允许 net↔net，CircuitEngine union-find 合并网络（MNA 代表节点，探针/电压按根回填）；② 工具菜单「新建连线（选择端点）…」节点/引脚下拉创建；③ 导线检查器多折点；④ `common_collector` 共集模板（器件节点模型：VCC 12 V、R1 47k/R2 22k、RE 1k、CIN 10 µF 预充 -3.826 V、1 kHz 0.2 V；EMIT≈3.07 V、p2p≈0.41 V）。证据：测试 3 项、251 passed、截图 [assets/common-collector.png](assets/common-collector.png)。

**P7-03 R22 工业交互（代码主体，2026-10-27）**：
- 分类（D46）：`nodal.ELEMENT_GROUP_ORDER`（固定 10 组）+ `ELEMENT_GROUPS`（30 种元件逐项登记），
  启动时写回 `ElementSpec.group`，catalog 是唯一来源；`test_spec.py::test_element_groups_cover_all_kinds`
  断言 30 种全落组、10 组全部使用、无"未分类"。
- 右键与菜单（D45）：`app.js` 新增 `onContextMenu` 与通用 `openGenericMenu`（`children` = 下钻 + 「‹ 返回」，
  不用 hover 级联，键盘/触控可用），分四类上下文——空白（添加/粘贴/全选/撤销/重做/运行暂停/单步/适配视图/自动布局）、
  器件（属性/复制/断开全部导线/删除）、网络节点（属性/设为接地/复制/删除）、导线（属性/复制/添加拐点（中点）/
  清除拐点（有拐点时）/选中整条网络/删除）；多选 ≥2 时器件/节点菜单追加「对齐 / 分布」子菜单（6 对齐 + 2 分布）。
- 导线（D45）：添加菜单「导线（选择端点）…」打开对话框，A/B 两端各选节点 + 器件引脚，校验后建线；
  导线拐点、整条网络选择、断开全部导线均接到既有 API。
- CDP 实测（2026-10-27 17:2x，Edge headless 9445 + `common_collector`）：器件 R1 菜单 4 项；网络节点 BASE 5 项（含"设为接地"）；
  导线 `R1.VCC` 5 项（含"添加拐点（中点）""选中整条网络"）；空白菜单 9 项；「添加」子菜单 = 电学节点/接地 +
  10 组「器件 · …」 + 导线 + 返回；「器件 · 基础无源」= 电阻/电容/电感 + 返回；多选 R1+R2 出现「对齐 / 分布 ▸」，
  子菜单 8 个动作 + 返回；导线对话框标题「新建连线（选择端点）」、4 个下拉（12 个节点选项）。截图
  [assets/r22-categories.png](assets/r22-categories.png)（右键 → 添加 → 器件 · 基础无源）。
- **A1–A5 余项已完成（2026-10-27）**：① 引脚右键（引脚信息 / 从此引脚建线 / 断开该引脚导线）；② 空白右键「显示」子菜单
  （栅格/吸附/捕捉点/正交，复用状态栏开关）；③ 空白处多选上下文（对齐/分布、批量尺寸、删除选中）；④ 画布式导线工具
  （「导线工具（点两端）」→ 点两个端点 → 预览 → 落线，Esc 取消）；⑤ 批量尺寸进多选右键。CDP 实测：引脚菜单 3 项、
  空白菜单含「导线工具/显示/多选」、VCC↔IN 点两端建线 15→16 条、拐点拖动落库；截图 [assets/p703-context-menu.png](assets/p703-context-menu.png)。
- 证据：**259 passed**、`compileall`、`node --check app.js`、`desktop --selftest` ok；静态版本 3.7.3→**3.8.3**；
  备份 `netlab_20261027_1744`（另有 2218 拐点拖动、后续 3.8.x 备份）。

**P0 求解可靠性（2026-10-27）**：① `nodal.SolverOptions`（reltol/vntol/abstol/max_iter/gmin/gmin_steps/src_steps/residual_tol）与 `SimConfig` 同名字段打通，`PATCH /api/config` 可调、工程 `sim` 保存后生效；② Newton 判据改为**节点电压 `vntol` / 支路电流 `abstol` 分别判据** + 相对项，不再全未知量共用一个绝对容差；③ 失败后自动 **gmin stepping**（1e-3→逐步减小）与 **source stepping**（独立源 0→1 斜坡），仍失败才抛错并带残差/最大节点；④ **断点对齐**：`Scene.next_breakpoint()` 计算方波/脉冲/step 的下一跳变，`Simulation._advance_locked` 在该时刻缩短 dt 落点；⑤ **奇异诊断**：LU 零主元映射回节点/支路名，报“矩阵奇异（零主元）：节点 …”；⑥ 新增 `test_solver_p0.py` 3 项（配置、奇异、断点），**262 passed**。

**P0 收尾：前端求解设置 + 预计算（2026-10-28）**：① 工程页新增「求解器设置」面板（reltol/vntol/abstol/max_iter/gmin_steps/src_steps/residual_tol），修改即 PATCH `/api/config` 并重建电路引擎；② `residual_tol` 默认保持 **0（只记录不强制）**，避免未基准前改变既有收敛结果；③ 截图 [assets/p0-solver-panel.png](assets/p0-solver-panel.png)；④ 静态 3.8.6→3.8.12、**263 passed**；⑤ 修复奇异阈值误报：`diag <= 1e-14·scale` 会把病态但可解的矩阵（如用户工程在 `dt=4.166e-5`）判成奇异，放宽到 `1e-16·scale`，同一工程在 `dt=1e-6` 下也可正常求解（`dt=4.166e-5` 同样）；⑥ 修正 `_index_name` 只遍历 `needs_branch` 元件（原先把电阻误报成“支路”）；⑦ 仿真节奏提示补充「锁定 dt 后每帧固定 1/fps，曲线采样也受此限制」；⑧ 新增「时间步长预设」按钮与输入框旁「÷10 / ×10」原位微调（直接改小 dt，不必用预设窗）（快速 1e-4 / 标准 1e-5 / 高精度 1e-6 / 超高 1e-7），点击自动解除锁定并写回 dt，CDP 实测 1e-5→1e-6 生效。

**P7-05 播放与回放设置（2026-10-27，部分完成）**：① 图表工具栏新增时间轴（帧索引）、▶ 回放/⏸ 暂停、循环、回到实时、
重新求解、清空轨迹；② 回放只读 `state.frames`（图表按 `slice(0,index+1)` 绘制），不写回电路；状态显示「回放中 · n/N」；
③ 循环在记录窗口内回绕；④ 场景修改后用 `scene.revision` 对比录制时的 revision，显示红色「记录已过期」并启用「重新求解」
（reset+run）；⑤ 重置保留探针通道（`updateSignalKeyCache` 在 probe_keys 为空时不裁剪 `chart.selected`），提示「探针与仪器设置保留」；
⑥ CDP 实测：时间轴 3250 帧、拖到 1000 显示「回放中 · 1001/3250」、播放推进、编辑场景后 stale 文案出现；
截图 [assets/p705-replay.png](assets/p705-replay.png)。⑦ **求解窗口 0→T**（2026-10-28）：`Simulation.precompute(duration, dt?, sample_every?)` 从 0 重置并填录制帧，`POST /api/solve-window` 返回 steps/time/frames/error；图表工具栏「预计算 0→T…」按钮带时长输入，完成后重取帧；CDP 实测 0.001 s → 100 帧；263 passed。

**R22 参数输入放宽与单位切换（2026-10-27 收尾追加）**：① 放开元件参数上下限——R/C/L 删除 min/max、二极管温度删除 200–500 K、串联电阻删除 1e6 上限、波形频率/延迟删除 1e6 上限（保留 R/C/L/Is 为正、占空比 0–1、耦合 <1 等物理约束）；② 前端 `buildParamField` 对 F/H/Ω/V/A/s/Hz 自动选前缀（p/n/µ/m/空/k/M）并给单位下拉，`collectParamValues` 按所选因子换算回 SI 再提交；③ CDP 实测：CIN 10 µF 显示「10 µF」，切 nF 变「10000」，应用后 `/api/state` 仍为 `C=1e-05`；④ 修复「只能输入 1000uF」：单位切换后 `step` 仍是旧单位的 1e-9，浏览器 `stepMismatch` 静默拦截提交；改为 `step=any` 并随单位重算 min/max。复测 2000 µF→`C=0.002`、1e9 µF→`C=1000`、0.001 µF→`C=1e-9`；⑤ 记住用户选过的单位（localStorage `netlab.unit.<key>.<unit>`），保存/重渲染不再自动跳：1 µF 保存后仍是「1 µF」、0.1 µF 仍是「0.1 µF」，其他元件共用同一机制；静态 3.7.7。

**R22 电源波形参数界面拆分（2026-10-28）**：DC/正弦/方波/脉冲/step/ramp 不再共用同一套输入框——前端 `applyWaveFieldVisibility` 按 `wave` 只显示参与计算的字段（DC 仅「偏置/直流电压」；sine/triangle/saw 显示幅值/频率/相位/延迟；pulse 另加占空比；square 固定 50% 不显示占空比），并给出模式提示；`waveform.py` 的 offset/amplitude/frequency 标签与 help 同步改成「偏置/直流电压」「幅值（交流）」等。CDP 实测：DC 只显示 offset，切 sine 后 amplitude/frequency/phase/delay 出现、duty 仍隐藏；截图 [assets/source-dc-fields.png](assets/source-dc-fields.png)；静态 3.8.7；263 passed。

**R22 三极管/MOSFET 型号预设与详细参数（2026-10-27）**：① BJT 参数从 7 项扩到 18 项，新增 `model`（型号）与
Vceo/Vcbo/Vebo/Ic_max/Pd/hFE 上下限/Vce_sat/Vbe_sat/fT；默认型号 NPN=2N3904、PNP=2N3906，
预设 2N3904/BC547/2N2222/S8050/2N3055、2N3906/BC557/S8550/2N2907。② MOSFET 新增 `model` 与
Vds_max/Id_max/Pd/Rds_on；默认 NMOS=2N7000、PMOS=IRF9540N，预设 2N7000/IRF540N/AO3400、IRF9540N/AO3401。
③ `ElementSpec.presets` 随 catalog 下发，前端选中型号即把 datasheet 典型值填进参数表（单位按当前前缀换算）。
④ **兼容**：新增参数都有默认值，旧工程载入时由 `validate_params` 自动补齐，无需迁移；
Vceo/Ic_max/Pd/hFE/fT/Vce_sat 等限值只做展示与记录，**不参与盖章**（曾试过用 Vce_sat/Ic_max 做
串联电导近似饱和压降，导致共集模板 Newton 不收敛，已回退）。⑤ CDP 实测：Q1 选 2N3055 后 beta=50、
Vceo=60、Ic_max=15 A（显示 15000 mA）、fT=2.5 MHz，应用后落库一致；静态 3.7.7；259 passed。
⑥ **常用集成元件型号**（同日追加）：运放 LM741/LM358/TL072/NE5532/LM324、比较器 LM393/LM311/LM339/TLV3201、
D 触发器 74HC74/74LS74/CD4013、逻辑门 74HC08/74HC32/74HC04/74HC86 + 74LS/CD4000 系列、
计数器 74HC161/74HC163/CD4029、移位寄存器 74HC595/74HC164/CD4094、ADC0804/ADC0809/TLC549、
DAC0832/TLC5620/MCP4725、555（NE555/SE555/LM555/LMC555）、LDO（LM7805/LM7812/LM317/AMS1117-3.3/5.0）。
每个型号都带 datasheet 典型参数与备注（电平标准/电源范围/限值），旧工程默认补齐、无需迁移。

**P7-03 追加：拐点直接拖动 + 画布坐标显示（2026-10-27）**：① 添加拐点后自动选中该导线并显示拐点手柄；
② 拐点命中从「仅选中导线」放宽到任意手动路由导线（半径 11px），按下即选中并进入拖动，无需先点检查器；
③ 拖动时画布实时显示十字准线 + 标签「拐点 N  x … y …」，底部状态栏同步显示鼠标世界坐标；
④ 手柄加大到 5px、悬停变实心并显示 grab 光标；松手后一次 PATCH 落库。CDP 实测：未选中导线上直接拖拐点
`(-80,100)→(-140,140)`，`/api/state` 落库一致；截图 [assets/waypoint-drag.png](assets/waypoint-drag.png)（拖动中 HUD）。
静态 3.7.9；259 passed。

### 7.3 票单与下一张

票单：`NetlabExtras/scratch/p0-foundation/issues/` 01–07、`p1-modules/issues/` 01–08（08 为 P1 收尾批次）、
`p2-canvas/issues/` 01–02、`p3-analysis/issues/` 01–04 均 done；`p4-elements/issues/` 01–08 done
（08 = R15 收尾：ADC/变压器/互感）；**09–11 = R20 节点化（均 done）；12 = 遗留清理（pending）；13 = 纯导线/共集示例（done）**；`p4-schematic/issues/01`（R19 参考级图纸）deferred。
**下一张：P7-03 余项（R22，见 §7.5-A）**——引脚右键、右键显示开关、空白多选上下文、画布式点两端导线工具；补齐后再进 P7-04（探针/示波器/李萨如）。历史票 12（R20 遗留清理）仍 pending，排在 P7 之后。
P3 遗留：Bode 幅相曲线（第二条频域路径目前为符号传递函数）、R17 L1 术语/图形（文档标注不强制）。

### 7.4 R21–R25 施工票单（2026-10-27 起，P7）

> 需求口径见 [REQUIREMENTS_AND_RULES.md](REQUIREMENTS_AND_RULES.md) §3 R21–R25 与 §2 D41–D52；本表只做进度视图，每票完成时更新状态并附证据（测试数/实测结论）。
> 开工顺序按依赖：P7-A 语义层不改，后面 UI/模块化都会返工；内置结构中难收敛（ADC/DAC/LDO/555）按用户要求后置。

| 票 | 覆盖 | 内容 | 状态 |
| --- | --- | --- | --- |
| P7-01 | R21 / D41 / D42 | 比较器与运放改单端 5 脚（`IN±/V±/OUT`、`VCC/VEE` 参数默认+引脚覆盖）；v4→v5 迁移与迁移报告 | ✅ 完成（254 passed；selftest ok；静态 3.7.1；备份 `netlab_20261027_0150`） |
| P7-02 | R21 / D43 / D44 | 未接齐器件不参与求解（红色辉光+清单）、电源单端自动对地（可见接地标记）、多接地自动合并、多选批量尺寸 | ✅ 完成（258 passed；selftest ok；静态 3.7.0→3.7.2） |
| P7-03 | R22 / D45 / D46 | 右键全量动作（基础动作 / 对齐分布/显示/拐点/引脚右键）、10 组元件分类、导线工具与分组 | ✅ 完成（2026-10-27）：A1–A5 全部补齐（引脚右键、显示开关、空白多选、点两端导线、批量尺寸入口）；262 passed、静态 3.8.4；截图 `p703-context-menu.png` |
| P7-04 | R23 / D47 | 探针仪表：电压表/电流表、示波器（1–4 通道）、李萨如（X/Y） | **done**（2026-10-29，§7.20） |
| P7-05 | R23 / D48 | 求解窗口（0→T 预计算）、时间轴回放、过期标记、循环播放、波形时间窗口、重置保留探针 | ✅ 完成（2026-10-28）：时间轴/播放/循环/过期标记/时间窗/重置保留探针 + **求解窗口 0→T**（`/api/solve-window` + 图表按钮）；263 passed、静态 3.8.6 |
| P7-06 | R24 / D49 | 端口符号 + 右键设端口 + 电路模块封装（端口名/方向） | **done**（2026-10-29，§7.21） |
| P7-07 | R24 / D50 | 内部浮窗视图（可收为侧边栏）+ 从网络列表封装入口 | **done**（2026-10-29，§7.22） |
| P7-08 | R24 / D51 | 电气直连展开（内外端口同一 MNA 节点）+ 封装前后等价性测试 | **done**（2026-10-29，§7.23） |
| P7-09 | R25 / D52 | 内置结构批 1：运放/比较器（只读 + 另存副本 + 结构仿真开关 + 对比） | pending |
| P7-10 | R25 / D52 | 内置结构批 2：D 触发器/计数器/移位寄存器（真值表/时序等价） | pending |
| P7-11 | R25 / D52 | 内置结构批 3：555/LDO/ADC/DAC（难收敛后置） | pending |
| P7-12 | 收尾 | 迁移清单回归、§8.1 与文档同步、备份与简报 | pending |

P7-01 证据：`test_device_nodes` 单端比较器两例、`test_project_migration::test_v4_opamp_rails_migrate_to_single_ended`；254 passed；静态 3.7.1。

### 7.5 剩余任务总览（2026-10-27 17:56 收尾）

> 本表是"下一窗口从哪继续"的唯一清单；每完成一项改状态并附证据，不在对话里留口头待办。

**A. P7-03 余项（R22/D45）——已全部完成（2026-10-27）**

| # | 任务 | 现状/入口 | 验收 |
| --- | --- | --- | --- |
| A1 | 引脚右键 | ✅ 已做：引脚信息/从此引脚建线/断开该引脚导线 | CDP 实测 3 项 |
| A2 | 右键显示开关 | ✅ 已做：「显示」子菜单 4 项，复用状态栏开关 | 状态栏同步 |
| A3 | 空白处多选上下文 | ✅ 已做：空白右键「多选」子菜单（对齐/分布/批量尺寸/删除） | CDP 实测菜单出现 |
| A4 | 画布式导线工具 | ✅ 已做：「导线工具（点两端）」+ 预览 + Esc | VCC↔IN 实测 15→16 条 |
| A5 | 批量尺寸右键入口 | ✅ 已做：多选右键入口复用 `batchResizeSelection` | 菜单出现 |
| A6 | 收口 | ✅ 已完成：262 passed 全绿、静态 3.8.4、截图、备份 | 本表已更新 |

**B. 后续票（按顺序）**

1. **P7-04（D47）探针仪表**：电压表/电流表（旁路测量，不改电路状态）、示波器 1–4 通道、李萨如 X/Y。
2. **P7-05（D48）回放**：求解窗口 0→T、时间轴拖动（只回放记录，标"回放中"）、记录过期标记、循环播放、波形时间窗口、重置保留探针设置。
3. **P7-06/07/08（D49–D51）电路模块化**：端口符号（1 引脚 device + 右键设端口）、封装电路模块（端口名/方向）、内部浮窗（可收侧边栏）、电气直连展开（内外端口同一 MNA 节点）+ 封装前后逐点等价测试。
4. **P7-09/10/11（D52）内置结构**：运放/比较器 → DFF/计数器/移位寄存器 → 555/LDO/ADC/DAC；只读 `.block` + 另存副本 + 结构仿真开关 + 与行为模型对比。
5. **P7-12 收尾**：迁移清单回归（`trip_unit`/`opamp_inverting`/RLC/多网络/引用式 blocks/校验和/二次幂等）、§8.1 与文档同步、备份。

**C. 其他遗留（不阻塞 P7）**

- **票 12（R20 遗留清理）**：内置模板迁移、旧边路径/参数端口删除、`schematic.py` 支持器件节点、回归。
- **R06 circuit 侧接口块**：信号/矢量已有 `if_*`，电路侧未做。
- **R19 参考级图纸**：deferred；D35 已放弃自动布局（元件显式 `layout`），密集图仍建议手工微调。
- **P3 Bode 幅相曲线**：第二条频域路径目前是符号传递函数，未画曲线。
- **R17 L1 术语/图形**：文档标注阶段，不强制。
- **Git**：用户已授权 GitHub `qgfn106-blip`，但仓库仍无 `.git`；落地前继续用 `NetlabExtras/backups/ProjectPoint_backups/` + `MANIFEST.sha256`。

### 7.6 当前问题与用户工程诊断（2026-10-28 01:08）

> 详细报告：[MyProject/未命名工程-诊断报告.md](../../MyProject/未命名工程-诊断报告.md)。本节只留“下一窗口必须知道”的索引，不复制报告全文。

**平台进度**：P7-01/02/03/05 完成；P0 完成（SolverOptions、电压/电流分容差、gmin/source stepping、断点、奇异诊断、求解窗口、dt 精度预设）；263 passed、静态 3.8.12、备份 `netlab_20261028_0103`。P7-04 暂缓；下一票 P7-06。

**平台已修问题**：
- DC/交流电源参数界面拆分：DC 只显示「偏置/直流电压」，不再显示幅值/频率；`waveform.py` 标签与 help 同步。
- 奇异判定误报：`diag<=1e-14·scale` 会把病态但可解矩阵判死（用户 `dt=4.166e-5` 被误杀），已放宽到 `1e-16·scale`；`_index_name` 只遍历 `needs_branch` 元件。
- `lock_dt` 提示补充：锁定后每帧固定 `1/fps`，加 steps 不改善曲线采样。
- 工程页新增 dt 预设：快速 1e-4 / 标准 1e-5 / 高精度 1e-6 / 超高 1e-7（自动解除锁定）。

**用户工程 `MyProject/未命名工程.netlab` 的 8 个问题**（详见报告）：
1. +12V 源 `wave=dc, offset=0, amplitude=12` → 实际 0V；改 `offset=12`。
2. Q1 基极只有 100k 到地，无 +12 偏置 → 截止；加 470k 到 +12。
3. U1A 的 R2/R3 接反（正反馈）→ 改成 `OUT→IN-`、`IN+→地`。
4. 100µF 接在集电极 → 应改到发射极旁路。
5. Vref 分压未接 +12V；47k/10k 也只有 2.1V，要 4.7V 用 47k/30k。
6. 两个运放默认 ±15V 轨；单电源 12V 应设 `vcc=12, vee=0`。
7. 输入 amplitude=5 是 ±5V（10Vpp）；图上是 5Vpp，应设 2.5。
8. 输出 `n13` 已有 1k 到地，不是悬空；改 10k 更轻；开集电极比较器要上拉。

**用户工程的时间步长**：`dt=1e-4, steps=2` 对 1kHz 只有 10 点/周期；建议关锁定，`dt=1e-6`、steps=10（每帧 1e-5）。`dt=1e-6` 下工程仍报奇异，因为第 3 项正反馈等拓扑问题；先修拓扑再提精度。

**下一窗口先做什么**：先按报告修用户工程（或另存 `未命名工程-fixed.netlab`），平台侧继续 P7-06/07/08；P7-04 按用户要求暂缓。

### 7.7 P0 求解加固（事务/均衡/断点/超时，2026-10-28）

> 方案：`docs/SOLVER_OPTIMIZATION_PLAN.md`；证据报告：`docs/SOLVER_OPTIMIZATION_REPORT.md`；备份 `netlab_20261028_0318`。

**完成（Phase A/B/C）**：

- **失败事务**：`CircuitSolver.step` 先 `capture_checkpoint`（时间/解/节点电压/迭代统计/每个元件的 `state`/`iteration_guess`/`result`/`time`/`value`/`source_scale`），`_step_locked` 抛任何异常都 `restore_checkpoint` 后重抛；`Scene` 与 `SignalEngine` 也有同构检查点；`Simulation._advance_locked` 在异常与超时时先恢复场景，再记录 `ComputeError`。
- **猜测分层**：`Diode` 的 `vd`、`BipolarJunction` 的 `vbe`、LDO 的 `value` 改为“`stamp` 读猜测、`update_guess` 只写猜测、`commit` 才写已提交状态”；LDO `stamp` 不再写 `self.value`。
- **stepping 隔离**：gmin 从 `SolverOptions.gmin` 起步（默认回到历史值 `1e-3`，每个 trial ×0.1），每次 trial 前后快照/恢复元件状态；`source_scale` 放 `try/finally` 必复位；失败信息只列实际尝试过的策略，并带最大残差节点。
- **尺度无关残差**：`_residual_metric = max|Ax−b| / (max(|A||x|) + dt·max|b| + 1e-30)`；线性分支也做解质量检查（返回零解会抛“线性电路解质量不足”并回滚）。
- **矩阵均衡**：`_solve_matrix` 行列缩放后分解，缓存缩放 LU + 列尺度；`pivot_tol` 判零主元，真奇异仍报“电路矩阵奇异（零主元）”；`_build_index` 对未知量排序，结果稳定。
- **断点**：`Scene.next_breakpoint` 同时扫描旧边与器件节点上的 `vsource/isource`，dc/delay/step/ramp/square/pulse 统一候选，含相位。
- **配置**：`SimConfig` 增加 `residual_safety_tol=1e-8`、`scaling=True`、`pivot_tol=1e-14`，`PATCH /api/config` 与工程 `sim` 均可持久化；前端暂未暴露这三项，`stats()` 记录实际生效的 `scaling/pivot_tol/residual/strategies`。

**证据**：

- `test_solver_p0.py` 13 项（新增失败重试=干净运行、线性解质量、源比例恢复、gmin 起点、缩放保解、器件节点断点、超时回滚等）；全套 **272 passed, 2 warnings**（8.18 s）。
- 高电容细 dt：100 µF + 1 kΩ、dt=1e-6、200 步 → v=0.009965 V，解析 0.009990 V，误差 2.495e-05 V，`residual=4.44e-17`；旧阈值下该量级会被误判奇异。
- 性能：11 节点 RC 阶梯 0.315 ms/step（缩放）/0.304 ms/step（未缩放），开销约 3.6%；`capture_checkpoint` 0.133 ms，事务后每步约 0.29 ms。
- `compileall` 通过；`desktop --selftest` → `"ok": true`。

**未完成（历史记录，已于 §7.8 补齐）**：Phase D 只做 Diode/BJT/LDO；Comparator 迟滞方向记忆、LogicGate 电流、BJT 文档公式、MOSFET 线性区/体效应、OpAmp 转换速率、catalog 公式同步未做。Phase E 只有电路/信号检查点，延迟边输出事务、自定义 handler state 隔离、信号链失败重试一致性测试未做。DC 工作点、AC/Bode、Gear、稀疏化、自适应 dt 未开始。

**下一步**：按原计划 P7-06/07/08；求解器侧若要继续，优先 Phase D 的元件契约（Comparator/Logic/MOSFET）与 Phase E 的延迟边事务，两者都需独立审批后开工。

### 7.8 Phase D/E 完成（元件契约 + 信号/矢量整步事务，2026-10-28 04:20）

> 用户指令：完成 `SOLVER_OPTIMIZATION_REPORT.md` §6 未完成项与 `SOLVER_OPTIMIZATION_PLAN.md` §10 的 Phase D/E 剩余任务（2026-10-28 03:5x）。备份 `netlab_20261028_0405`（代码前）、`netlab_docs_20261028_0420`（文档前）。

**Phase D 元件契约**

- **Comparator（P1-03）**：`state["hys_level"]` 记录回差方向（0 未定/±1），`_f` 用 `offset=+0.5·hys·level`：高电平只在 `u<−hys/2` 翻低、低电平只在 `u>+hys/2` 翻高；`commit` 按输出相对中点更新电平（死区 `1e-3·span`），`reset` 清状态；`hys=0` 与旧行为一致。
- **LogicGate（P1-04）**：`_currents(ctx)` 按两条电导支路求和，`current()`/`commit` 输出 `current/voltage_difference/power/supply_current`，不再恒 0。
- **BJT（P1-05）**：catalog 公式改为与 `_junction()` 一致的分段线性（`vbe_on/rin`、`leak=1e-9`、`Ic=βIb`），注明 `Is/n` 仅记录并用于热电压限幅。
- **MOSFET（P1-06）**：新增线性区 `Id=k(Vov·Vds−Vds²/2)`、沟道长度调制 λ、体效应（`body_node` 参数 + γ/φ，`Vth=Vth0+γ(√(φ−Vbs)−√φ)`）；`stamp` 增加 gds/gmbs。**同时修复**：`A[di,di]+=gds` 原被包在“源极非地”分支内，源极接地时 gds 丢失 → Newton 在 0.5↔4.875 V 极限环（60 次不收敛但残差为 0）。修复后 nmos 开关解 1.5505 V（线性区正确解），旧断言 `drain<1.5` 按物理改为 `1.0<drain<2.0`。
- **OpAmp（P1-08）**：可选 `slew_rate`/`gbw`（默认 0 = 理想），`_dynamic()` 用 `state["vout"]` 做一阶滞后 `α=1−exp(−dt/τ)` 与 `SR·dt` 钳位；`reset` 清 `vout`。
- **catalog 同步（P1-12）**：`nodal.py` 的 spec.formula/notes 与 `ELEMENT_FORMULAS`、`transistors.py`/`logic.py` 的公式全部与实现一致；新增 `test_element_contracts.py` 做符号级断言。

**Phase E 信号/矢量整步事务**

- `graph.py`：`Network.capture_step_state/restore_step_state` 冻结 time、节点 data/state/inputs/ports、连接 state/output；`Network.step` 任一节点异常 → 整步回滚后重抛（延迟边 `Connection.output` 一并回滚）。
- `Node.update`：非 trusted handler 收到 `deepcopy(state)`，成功后原地写回，异常不污染内部状态。
- `blocks.py`/`scene.py`：`BlockRuntime.capture_checkpoint/restore_checkpoint`；`SignalEngine.capture_checkpoint` 带 `"blocks"`；`SignalEngine.step` 失败先逐块恢复块内状态再重抛（块内积分器不再被失败步推进）。
- 新增 `test_solver_transactions.py` 6 项覆盖上述契约。

**证据**：全套 **292 passed, 2 warnings**（8.28 s）；`compileall` COMPILE_OK；`desktop --selftest` → `"ok": true`。数值：nmos 开关 1.5505 V（手算一致）；比较器 hys=1 V 时上升翻转 ∈(0.35,0.65) V、下降 ∈(−0.65,−0.35) V；逻辑门电流 ≈−4.7 mA；运放 SR=1e4 V/s 时单步差 ≤1 V；MOS 体效应 Vth 抬升 0.0967 V（γ=0.5, Vbs=−0.3 V）。

**仍未做**：DC 工作点 `.op`、AC/Bode、Gear、稀疏化、自适应 dt/自适应 LTE（D17 明确不做）；BJT/MOS 不宣称器件级；`Network.step` checkpoint 的独立性能表未出（只保证既有基准与全套测试不退化）。


### 7.9 R26 求解器分析能力（DC / AC-Bode / Gear2 / 稀疏矩阵，2026-10-28 04:48）

> 用户指令（2026-10-28 04:29 原话）：「DC 工作点 .op、AC/Bode、Gear、稀疏化 将这些完成」——明确推翻 `SOLVER_OPTIMIZATION_PLAN.md` 原先的「不做」条目。备份 `netlab_20261028_0434`（代码前）、`netlab_docs_20261028_0445`（文档前）。

**内核（`netlab/core/compute/nodal.py`）**

- **DC 工作点**：新增 `CircuitSolver.operating_point()`。实现方式是不调 `prepare`、令 `time=0` 并让源取 `waveform_value(params, 0)`，在 `StampContext(mode="dc")` 下：电容直接不盖章（开路）、电感用 `DC_CONDUCTANCE=1e5`（≈10 µΩ）短路近似、其余元件按工作点线性化；Newton 失败提示改为「直流工作点 … 未收敛」。成功后用 `mode="dc"` 的 ctx 逐元件 `commit`，返回 `time/node_voltages/elements/iterations/matrix_size/residual/strategies/sparse`，**`finally` 恢复 checkpoint**——调用前后 `solver.time` 与 `solution` 逐元素不变（有测试）。
- **AC/Bode**：新增 `ac_sweep(frequencies, *, input_source=None, probes=None)`。先内部求一次工作点（临时检查点），再逐频点用 `mode="ac"`、`omega=2πf` 的复数 MNA：C→`jωC`、L→`1/(jωL)`、独立源取 1 V/1 A 激励（其余源置 0）；`AC_KINDS` 限定 resistor/capacitor/inductor/vsource/isource/vcvs/vccs/switch，二极管/MOS 等直接报「AC 分析暂不支持元件 …」。探针支持节点电压、R/C/L 电流、压源支路电流，输出 `magnitude/phase_deg/db`；只读，调用后瞬态状态不变。
- **Gear2（BDF2）**：`integration` 增加 `"gear2"`。C：`g=1.5C/dt`、`src=C(−2v_n+0.5v_{n−1})/dt`；L：`g=dt/(1.5L)`、`src=(2i_n−0.5i_{n−1})/1.5`；历史缺失或 `gear_dt != dt` 自动回退 backward_euler（`_gear_ready=False`）并滚动 `v_prev/i_prev/gear_dt`。固定 dt 语义不变，自适应 dt（D17）仍不做。
- **稀疏矩阵**：`SolverOptions` 增 `sparse="auto"|"on"|"off"`、`sparse_threshold=200`；`_build_index` 决定 `self.sparse` 与 `_blank_matrix()`（lil/稠密）；`_newton_solve` 每轮新建空白矩阵；`_solve_matrix` 走 `_solve_sparse`：均衡 → csr → `splu`，缓存键含 `indptr/indices/data` 字节，奇异统一映射为「电路矩阵奇异（稀疏 LU）」/零主元带节点名；`_check_floating` 用 `getnnz(axis=1)`；无 SciPy 时 auto/on 自动退回稠密。
- `integration_methods()` 增 Gear2 项；`reset`/`restore_checkpoint` 清稀疏 LU 缓存。

**接入层**

- `scene.py`：`CircuitEngine.operating_point()/ac_sweep()` 把网络代表节点 id 映射回场景显示名（节点电压与探针键都映射）；`Scene.operating_point()/ac_sweep()` 校验 `mode == "circuit"`。
- `simulation.py`：`SimConfig.sparse/sparse_threshold` 与 `Simulation.operating_point()/ac_sweep()`（持锁调用）；`apply_config` 校验 `sparse ∈ {auto,on,off}` 并透传 `SolverOptions`。
- `server.py`：`ConfigUpdate.sparse/sparse_threshold`、`IntegrationRequest.integration` 加 `gear2`、新增 `GET /api/operating-point` 与 `GET /api/ac-sweep`（`input/f_start/f_stop/points/scale/probes`，log 用 `np.logspace`，lin 用 `np.linspace`；降级模式拒绝）。
- **UI 未接图表入口**：本批只交付 API 与场景层接口（与既有「求解器设置面板」一致，先有可验证后端）。

**证据**

- DC：分压 10 V→n2=5.0 V、R1 电流 5 mA、V1 −5 mA；电容开路/电感短路拓扑 n2≈5e-8 V（1e5 S 近似）；分析后 `solver.time==0`、`solution` 不变。
- AC：RC 低通（R=1k、C=1µF）在 fc=159.1549 Hz 处 0.707107/−45.0°/−3.0103 dB，R1 电流 0.000707/+45°；反相 VCVS gain=−2 → 2.0/180°；含二极管报「AC 分析暂不支持元件」。
- Gear2：RC 放电 10×1e-4 s → 精确 1.839397，gear2=1.847744、BE=1.927716；首步与 BE 相同（4.545455）；dt 变化后回退 BE。
- 稀疏：60 节梯形 60 节点解与稠密逐点 `rtol=1e-9` 一致；并联双压源报「电路矩阵奇异」；`sparse="bogus"` 报「sparse 必须是 auto、on 或 off」。
- 全套 **315 passed, 2 warnings**（8.88 s）；`compileall` COMPILE_OK；`desktop --selftest` → `"ok": true`。

**仍未做/边界**：AC 只做线性小信号（非线性元件明确拒绝）；DC 电感用 1e5 S 短路近似、不是 0 Ω；Gear2 固定 dt，回退规则见 D55；稀疏默认 auto>200，无 SciPy 退稠密；UI 图表与「分析」面板入口未接；自适应 dt/自适应 LTE 仍按 D17 不做。

### 7.10 工程校验和二次校验修复（2026-10-28 12:24）

> 用户反馈（2026-10-28 12:17 原话）：「@MyProject\未命名工程.netlab 现在这个工程不校验了请将工程改为能接入的状态」。备份 `netlab_20261028_1219`（`project.py` 前）、`project_20261028_1219`（用户工程 + 旧 `.bak`）。

**根因**：`validate_project()` 在逐网络校验时用 `Scene.to_payload()` 规范化场景（未保存的元件新增参数会补默认值；本工程两个 opamp 缺 `gbw/slew_rate`，补成 `0.0`），但函数返回前没有重算 `project["checksum"]`。打开工程会走两次校验（`load_project` → `_apply_project` / `project_scene_payload`），第二次拿规范化后的内容对旧校验和，必然报「工程文件校验和不匹配，可能已损坏或被修改」。原始文件本身校验和是正确的（`verify_checksum(raw) == True`），不是文件损坏。

**修复**

- `netlab/core/model/project.py`：`validate_project()` 在完成全部网络规范化后重算 `project["checksum"] = compute_checksum(project)`（仅当工程原本带 checksum），并在代码注释里说明「规范化是程序行为，不是篡改」。
- `netlab/tests/test_project.py` 新增 `test_validate_normalizes_scene_without_breaking_checksum`：构造 opamp 电路工程 → 删掉 `gbw/slew_rate` 后重算校验和模拟旧文件 → 连续两次 `validate_project` + `project_scene_payload` 均须通过，且规范化后两参数为 `0.0`。
- 用户工程 `MyProject/未命名工程.netlab`：经 `load_project → validate_project → atomic_write` 重写为规范形式（`checksum=d5a4ca2a3ef7…`、version 5、28 节点/28 连线），原文件保留在 `NetlabExtras/backups/ProjectPoint_backups/project_20261028_1219/`。

**验证**

- 新工程文件连续 `load_project` 两次通过、校验和稳定；`project_scene_payload` 通过；`Scene.load_payload + ensure_engine` 装配 17 个元件；`Scene.step(1e-4)` 连跑 5 步（`solver.time=5e-4`）无异常。
- 全套 **316 passed, 2 warnings**（8.53 s）；`compileall` COMPILE_OK；`desktop --selftest` → `"ok": true`。

**边界**：只修「规范化后校验和未同步」这一类；文件内容被真实篡改仍在校验和检查处拒绝。

### 7.11 R27 回放与时间轴可用性（2026-10-28 18:55）

> 用户反馈（2026-10-28 18:36 原话）：「我将实时节拍关后会出先这个错误，我还发现我预计算时间窗口时会发生起始时间不为0的问题，我还希望直接可以在顶栏上控制时间轴」。备份 `netlab_20261028_1855`（后端 `simulation.py` + 前端三件套的快照）。

**根因**

1. 极速模式波形断裂：`Simulation.live()` 用客户端 cursor 调 `Recorder.since(cursor, limit=600)`，而 `since` 在待投递帧超过 limit 时「只留最后 limit 帧」，中间整段被丢弃；前端把两段首尾按时间连线，于是出现直线段/相位跳变。极速模式每步录制一帧（约 10k 帧/s），而轮询约 5–10 次/s，必然触发。
2. 预计算起点非 0：`precompute` 按 `sample_every`（常为 1）逐帧 push，5 s×1e-4=50000 帧远超 `RECORDER_CAPACITY=1200` 的环形缓冲，最后只剩末尾约 0.12 s。
3. 顶栏没有时间轴控件，回放只能进图表浮窗操作。

**修复**

- `Recorder.since`：超限时改为等间隔降采样（`_resample`，`step=(count-1)/(limit-1)` 四舍五入，保留首尾，帧间隔差 ≤1），不再截尾。
- `precompute`：`needed = ceil(count / RECORDER_CAPACITY)`、`sample = max(sample_every, needed)`，保证 0→T 全程装得下；返回值新增 `dt/sample_every/first_time/last_time`。
- `_advance_locked`：`steps == 1` 时必录一帧，使首帧落在 t=dt（原来首帧在 t=sample·dt）。
- 前端：顶栏新增 `#topTimeline` 滑块 + `#topTimelineTime`（`t 当前 / 总长 s`），拖动触发 `enterReplay` 进入只读回放，双击 `leaveReplay` 回到实时；`updateReplayUI()` 与图表时间轴同步，无帧时禁用。

**证据**

- `Recorder` push 3000 帧 → `since(0,600)` 返回 600 帧，seq 1801…3000，末帧为最新，帧间隔集合 {2,3}（差 ≤1）。
- `sim.precompute(5.0, dt=1e-3)` → `frames=1001, sample_every=5, first_time=0.001, last_time=5.0`；`precompute(2.0, dt=1e-3, sample_every=1)` 帧数 ≤1200 且 `first_time ≤ 2e-3`。
- `node --check frontend/app.js` 通过；HTML id 唯一、CSS 类与 JS 引用一致。
- 全套 **319 passed, 2 warnings**；`compileall` COMPILE_OK；`desktop --selftest` → `"ok": true`。

**仍未做/边界**：浏览器端行为（拖动平滑度、双击回实时）未做自动化测试，只做了 DOM/JS 语法与后端数据一致性验证；极速模式下仍是「每次 poll 最多 600 帧」，只是抽样均匀；若未来把 `RECORDER_CAPACITY` 调小，预计算会自动提高采样步长、波形时间分辨率随之下降（会在返回值的 `sample_every` 里体现）。

### 7.12 工作区目录整理（2026-10-28 19:05）

> 用户原话（m01718）：「现在请帮我整理以下文件夹，把netlab相关的关键文件夹，需要的文件夹都整合在一个文件夹里，projectpoint的文件夹整理的干净一点」；补充（m01755）：「Netlab相关文件全部整理在一个文件夹里面，demo，测试，截图，备份等，再单独开一个其他文件夹存放」。

**调整后的根目录**

- `netlab/`：应用本体（代码、静态资源、pytest 套件、文档），不动。
- `NetlabExtras/`：辅助资料统一收纳——`demos/`（`circuit_grid.py`、`element.py`、`node_connection_demo.py`）、`screenshots/archify/`（原 `.archify`）、`backups/ProjectPoint_backups/`（原根目录备份）、`scratch/`（原 `.scratch` 探针脚本）、`legacy-docs/`（原 `netlab/docs/未命名工程-诊断报告.md` 旧副本）、`README.md`。
- `MyProject/`、`library/`、`extensions/` 保留在根：`netlab/core/model/workspace.py` 的 `workspace_for()` 以「工程根目录的父目录/library」定位共享库，`netlab/server.py` 的默认库路径用 `Path.cwd()/"library"`，三者搬走会破坏运行时解析。
- 清理删除：`.pytest_cache`、`.pytest_tmp`、`Plugin/`、`tools/`、`netlab/.pytest_cache`、`netlab/catalog.tmp.json`、`netlab/fem.tmp.json`、`netlab/femlive.tmp.json`、全仓库 `__pycache__` 与 `*.pyc`（均可再生）。
- 未移动 `netlab/tests`：它是代码套件的一部分，移出会使 `python -m pytest netlab/tests` 与文档里所有验收入口失效；用户所说的「测试」按临时测试产物（`.pytest_tmp`）与探针脚本（`.scratch`）处理。

**文档同步**：`NetlabExtras/backups/ProjectPoint_backups/`、`NetlabExtras/scratch/`、`NetlabExtras/screenshots/archify/` 三类路径引用已在 AGENT_GUIDE / FRAMEWORK_CHEATSHEET / LESSONS / PROGRESS / SOLVER_OPTIMIZATION_PLAN / SOLVER_OPTIMIZATION_REPORT / SOLVER_CODE_MAP 全量替换（历史记录行同步改到新位置）。

**验证**：目录整理后 `python -m pytest netlab/tests -q --basetemp .pytest_tmp` → 319 passed, 2 warnings；`compileall` COMPILE_OK；`desktop --selftest` → `"ok": true`。


---

## 7.13 公开仓库上线（2026-10-28 20:41）

- 仓库 `https://github.com/qgfn106-blip/NetLab`（Public、MIT），根 = `NetlabHome/`：`README.md`、`ARCHITECTURE.md`、`INSTALL.md`、`OPERATION.md`、`LICENSE`、`.gitignore`、`docs/assets/` 四图、`examples/demo.netlab`、`netlab/requirements*.txt`、`netlab/download_wheels.bat`、`install_offline.bat`。
- 入库边界（用户 m01956）：不含 `MyProject/`、`netlab/docs/`、`netlab/tests/`、`netlab/tools/`；`library/`、`extensions/` 仅 `.gitkeep`。
- 提交 `823cd18`（65 文件、1.9 MB）与 `1787c11`（离线脚本）；远程 67 个 blob；`git push --force` 覆盖建仓时自动生成的 LICENSE-only initial commit。
- 验证：`git clone NetlabHome .tmp_clone` → `python -m netlab.desktop --selftest` → `"ok": true`；示例工程 `step(1e-4)`×5 → `t=5e-4`；`/api/health`、`/api/state` 200。
- 边界：发布版不含测试，无法对外复现 319 项；未打 tag、未预生成 wheels。

## 7.14 浏览器内演示上线（Pyodide + GitHub Pages，2026-10-28 21:08；同日已撤销）

> **后续：2026-10-28 21:15 用户要求删除静态网页，本节是已撤销的部署记录，见 §7.15。**

- `web/index.html`（Pyodide 0.28.3 从 CDN 加载、解包 `netlab.zip`、执行 `demo.py`、canvas 画 Vin/Vout）+ `web/build_zip.py`（35 模块 → 190 KB）+ `web/demo.py`（V1 1 kHz → 1 kΩ → 100 nF，2000 步 × 5 µs）+ `.github/workflows/pages.yml`。
- Pages 以 `build_type=workflow` 启用（分支源只接受 `/` 或 `/docs`）；提交 `bad6b63` + `1cc94fc`；Actions run 成功。
- CDP 实测：状态「完成」、2000 步 564 ms、首开冷启动 79 s（CDN）。

## 7.15 静态演示页按要求删除（2026-10-28 21:15–21:18）

**用户指令（m02602 原话）**：「那算了请将这个静态网页全部删掉」。

- GitHub Pages：`DELETE /repos/qgfn106-blip/NetLab/pages` → 204，`GET .../pages` → 404；站点 `https://qgfn106-blip.github.io/NetLab/` → **404**。
- 仓库：移除 `web/{index.html,demo.py,build_zip.py,netlab.zip}` 与 `.github/workflows/pages.yml`，README 删掉「浏览器内演示」节及目录树 `web/` 行（`web`/`pyodide` 字样清零），提交 `dd0e7d1`（走 Git Data API：tree 删除条目 `sha: null`；`git push` 当时 `github.com:443` 连接失败）。
- 备份：`NetlabExtras/backups/ProjectPoint_backups/web_20261028_2130/`（`web/` 四件 + `pages.yml` + 演示截图 + `MANIFEST.sha256`）。
- 未受影响：应用本体、`netlab/tests`（319 passed）、本地 `python -m netlab.run` 用法。
- 待办：本地提交 `dfb2e01` 与远程 `dd0e7d1` 内容等价但历史分叉，网络恢复后 `git fetch` + `git reset --hard origin/main` 收敛。

## 7.16 R29 回放速度可调（一个滑块，2026-10-28 22:08）

**用户原话（m02813）**：「回放时播放速度依然不可调，且我发现边播放边计算时，速度过快会发生严重卡顿，请为控制回放播放速度增加可调参数，并且将所有的播放时间速度设置更加简单，最好可以直接一个滑块调节」。

- **实现**：`state.replay.speed`（帧/秒，5–240，默认 60）；「图纸」页「▶ 回放」旁新增 `#replaySpeed` 滑块 + `#replaySpeedVal` 读数；`localStorage["netlab.replaySpeed"]` 记住上次速度；回放按钮与时间轴语义不变。
- **播放循环重写**：原先 `setInterval(1000/fps)` 每跳只前进 1 帧、速度被仿真 `fps` 绑死；现改固定 16 ms 定时器，按 `elapsed × speed` 累积推进帧，速度只改推进量、不改重绘频率；绘制仍走 `scheduleChartDraw` 的 70 ms 去抖。快放不再因每帧重绘拖死主线程。
- **证据（无头 Edge CDP，真实页面）**：设定 30/120/240 帧每秒，实测推进 29.8/119.1/240.9 帧/秒；240 帧/秒连播 3 s，PerformanceObserver 记录 **0 个 >50 ms 长任务**；暂停后索引不再变化；循环开启时从末尾回到开头（从 2129/2139 播 0.9 s 回到 98）。
- **改动文件**：`frontend/app.js`（状态、`toggleReplayPlayback`/`replayTick`、`stopReplayTimer`、事件与持久化）、`frontend/index.html`（滑块、版本键 `?v=3.8.14`）、`frontend/style.css`（`.replay-speed-field`）。
- **备份**：`NetlabExtras/backups/ProjectPoint_backups/ui_20261028_2205/`（改前 static 三件 + `MANIFEST.sha256`）。
- **验证**：`python -m pytest netlab/tests -q` → 319 passed；`compileall` OK；`desktop --selftest` ok。
- **边界**：速度上限 240 帧/秒（再快屏幕也分辨不出）；滑块只在「图纸」页，顶栏时间轴仍只管拖动定位。

## 7.17 R30（P10）UI 集中优化（2026-10-28 22:30–23:05）

追加（2026-10-29 00:30，静态 3.9.9）：侧栏收放改为「挂耳」——
- 去掉顶栏「面板」开关与网络栏头部收起按钮；新增 `#netHanger` / `#panelHanger`（19×78，挂在侧栏分界、凸向画布），收起后仍留在栏位可原地展开；
- 右栏可拖拽调宽（`#panelResize`，clamp 260–720，`localStorage['netlab.panel.width']`），检查器内边距 16/18/22 修正贴边；
- 引导页底部新增「打开工程」「设置视图」两个小按钮，设置抽屉以 `over-guide`（z-index 115）盖在开始页之上；
- 挂耳必须放在 `<main>` 内（依赖 `--panel-w`）；证据 `NetlabExtras/scratch/r30/33-hanger-panel-edge.png`、`34-panel-hidden-hanger.png`、`31-guide-actions.png`。

**用户原话要点（m00004 / m00015）**：进页面先显示工程场景（工作模式三选一）+ 应用简介与使用指南，文档栏形式、可关闭、菜单可重开；完成 P5 帮助体系 R14 全部 + 顶部信息条；右栏工程移到设置、节点/连接函数进函数子菜单并随选中切换、场与 FEM 独立；参考 RhineLabUI 做好动效、GPU 友好、视图设置可自定义 UI 风格/动效/性能；所有 UI 设计/接口/框架写进一个文档；任何工作模式启动时运行播放为关闭；核心功能交互不改。

- **启动引导页**：`#guide` 全屏纸面层，三张模式卡（信号流/电路/矢量）+ 使用指南 + 5 篇文档入口 + 示例工程入口；「不再显示」写全局 `ui_guide=never`；进入场景走 `switchMode(...,{skipConfirm:true})`；菜单「设置 → 重新打开引导页」可复现。后端 `default_simulation()` 改空白场景，启动不再载 demo。
- **右栏重排**：4 组 `.panel-tab`（检查器 / 函数 / 模块与扩展 / 分析），`#tab-spec` 由节点函数/连接函数共用，子导航随选中对象切换（`syncFnRoleToSelection`）；工程页 `#tab-scene` 移入 `#settingsDrawer` 的「工程」页；FEM 作为独立工作区不进网络右栏。
- **设置抽屉**（2026-10-29 起被 D62 取代：改为**内部浮窗**，见 §7.18）：非模态右侧 460px（`body.settings-open` 让位），三页「工程 / 视图 / 交互」；主题 system/light/dark、6 个强调色板、动效 off/low/med/high、性能 perf/balanced/quality、信息条显隐、引导开关、自动保存与间隔。
- **帮助体系（R14）**：顶部信息条补到 9 段（工程/网络/模式/节点·连线/dt/时间/步数/告警/运行状态）；参数 `?` 弹 `#qcard` 四段（说明/取值/单位与默认/公式 + 实现页）；文档中心 `#docWin` 非模态浮窗（拖动/缩放/最小化/搜索），内容来自 `docs/user/*.md` 经 `GET /api/docs` 渲染；菜单 9 组（D61 修订 D13），工具/帮助内旧 disabled 入口全部接通。
- **外观与画布**：`style.css` 换成 RhineLab 令牌（浅/深两套 + 0 圆角 + 1px 细线 + MiSans 栈），`html[data-theme|data-motion|data-perf]` 三轴；Canvas 颜色统一经 `C()` 映射主题令牌（含旧 `rgba(168,84,31,…)` 23 处），深色下自动混色；动效只动 transform/opacity，性能档关闭模糊/阴影。
- **启动停止**：`maybeAutostart()` 改 no-op，移除 FEM 首次切换的自动 run，`boot()` 末尾 `ensureStoppedOnBoot()` 两侧 `pause`。
- **兼容修复**：3.9.6 修复「开始页点文档直接退出」——`#guideDocs` 原先 `hideGuide()` 再开文档窗，改为只开文档窗（z-index 130 > 引导层 110），关闭文档仍回开始页；引导卡片由 1080px 放宽到 `min(1560px, 100vw-48px)`，开始页全屏铺开。3.9.5 修复「菜单点不开」——R30 为防横向溢出给 `#menubar` 加了 `overflow:hidden`，把绝对定位的 `.menu-panel` 整体裁掉；改为 `overflow:visible`（实测 `scrollWidth===innerWidth` 仍成立，下拉可正常展开、菜单项可点）。另：9 项菜单/信息条曾把 body 撑到 1583px（视口 1568），改 `body{grid-template-columns:minmax(0,1fr)}` + 各外壳块 `min-width:0`；`dt` 取 `sim.config.dt` 并自适应单位（0.0001 → `dt 0.10 ms`）；引导页动作行在 854px 高视口 sticky 吸底。
- **证据**：`pytest -q` → **323 passed**（新增 `test_r30_ui.py` 4 项：空白默认场景、5 篇文档索引与正文、单篇/未知 slug、UI 设置默认值与校验）；`compileall` OK；`node --check app.js` OK；`desktop --selftest` → `ok:true`（同步把 `project_import` 的「至少 1 个节点」断言改为合法模式断言）；无头 Edge CDP 实测菜单 9 组、信息条 9 段、右栏 4 组、docs=5、运行停止、主题/动效/抽屉/文档窗/搜索均生效，无 JS 异常与 console error；截图 `NetlabExtras/scratch/shot_guide2.png`、`scratch/r30/01-guide.png`～`05-search.png`。
- **改动文件**：`frontend/index.html`（重写外壳，3.9.6）、`frontend/style.css`（令牌 + 组件 + 三档覆盖）、`frontend/app.js`（R30 模块追加 + 面板/菜单/信息条/启动改造）、`workspace.py`（4 个 `ui_*` 设置键）、`simulation.py`（空白默认场景）、`server.py`（`/api/docs`、`/api/docs/{slug}`）、`docs/user/*.md`（5 篇）、`docs/UI_SPEC.md`（新增）、`tests/test_r30_ui.py`（新增）、`desktop/selftest.py`（断言更新）。
- **备份**：`NetlabExtras/backups/ProjectPoint_backups/netlab_ui_20261028_2242/`（netlab 全量 + AGENTS.md + `MANIFEST.sha256`）。
- **边界**：画布仍有少量旧灰色（`#7b7266` 等）走深色自动混色，未逐一配令牌；文档窗搜索为「按空行切段 + 包含匹配」，非全文索引；引导页「不再显示」只存全局、不按工程区分（D60）。

- 2026-10-29 00:05 首屏字标改为排版锁定（`NETLAB` 750 + 中文直述 + `ANALYSIS OS` 细体，三行错峰揭示），去掉旧 `h1.guide-title`「先选一个工程场景」；静态版本 `?v=3.9.7`，其余页面结构与交互未动。

## 7.18 设置改为内部浮窗（2026-10-29 01:0x，静态 3.10.0）

**用户原话**：「这里的设置可以不是侧边栏，而是独立出来的窗口」（配图为 设置菜单四项）。

- **结构**：`<aside id="settingsDrawer">` → `<div id="settingsWin" class="floatwin setwin" hidden role="dialog">`；头部 `header.floatwin-head`（`设置` + `#setWinHint` + `—`/`▢`/`✕`）+ `div.floatwin-body`（`nav.setwin-nav` 196px + `div.setwin-main` 三页 `div.setwin-pane[data-pane=project|view|interact]`）+ `div.floatwin-resize`。工程页 `#settingsScene` id 未变，内部控件全部保留。
- **浮窗通用层**：`app.js` 新增 `placeFloatWindow(root,key)` / `raiseFloatWindow(root)` / `toggleFloatMaximize(root,key)` / `initFloatWindow(root,key,{minWidth,minHeight})`；文档窗 `initDocWin()` 改为 `initFloatWindow(ui.docWin,'docGeo',{minWidth:420,minHeight:320})`，`placeDocWindow()` 变薄封装。点哪扇窗哪扇抬层（z 131 起，越 138 回落 132）。
- **取消让位**：删掉 `body.settings-open main{padding-right:…}` —— 浮窗浮在画布上但不改 `main` 网格列宽；CDP 实测打开设置窗前后 `#panel` 451px / `#stage` 835px 完全一致。
- **两个踩坑**：① 拖动夹的是 `top ≤ innerHeight - 高度 - 8`，否则窗口底边跑出视口、右下缩放柄不可点（首轮缩放测试就是因此失败的）；② 有记忆位置（`.moved`）时进场动画必须换成纯淡入 `floatwin-fade`，否则 `translate(-50%,-50%)` 与内联 `left/top` 叠加，重开时窗口会从半屏外飞进来（实测 `left` 短时为 -254）。
- **证据**：`NetlabExtras/scratch/verify_settings_win.mjs` 全绿——菜单进入→视图页（hint `SETTINGS · 全局外观偏好`）、拖动（left 388→168）、缩放（760×606 → 850×602）、页签切换（hint 同步 `全局交互偏好`）、最小化（高 40、贴右下 16px）、最大化（12/108、1512×634）、与文档窗共存并抬层（134 > 130）、Esc 先关设置窗、重开位置记忆稳定、`exceptions=[] consoleErrors=[]`；重开稳定性另测 `verify_settings_reopen.mjs`（4 次采样 left/top 恒为 508/136）。`node --check app.js` OK；HTML 标签闭合用 `html.parser` 校验无未闭合。截图 `NetlabExtras/scratch/r30/11-settings-window.png`、`12-settings-dragged.png`、`13-settings-interact.png`、`14-settings-minimized.png`、`15-settings-maximized.png`、`16-settings-and-doc.png`、`17-settings-project.png`、`18-settings-reopen.png`。
- **改动文件**：`frontend/index.html`（浮窗结构 + 版本 3.10.0）、`frontend/style.css`（`.floatwin` 基类 + `.setwin` 段，删旧 drawer 段与让位规则）、`frontend/app.js`（浮窗通用层 + `initSettingsWin`/`openSettings`/`setSettingsPane`）、`docs/UI_SPEC.md`（§6 重写 + §6.1 浮窗基类）、`docs/REQUIREMENTS_AND_RULES.md`（D62 + 变更记录）。

## 7.19 R31 并网逆变器电网控制立项（2026-10-29 01:39，规划完成；2026-11-05 由 §7.72 完成）

**用户原话**：「我现在的框架能不能实现逆变器电网控制」（附三相并网逆变器框图：`Udc` + 6 开关、`L1/L2/Cf/Rd` + `Lg` 入网、PCC、`abc/dq`、PLL、dq 电流环、PWM），随后「将这些放在需求与计划文档中，并按实现开发逻辑规划开发顺序」。

**能力评估（读代码得出，未实测）**：
- 信号流侧够用：`sum/gain/lag/integrate/clip/expression/state_space/oscillator/nonlinear_plant/sliding_mode`（`computes.py`），`expression` 能写乘、三角与比较，`state_space` 能做 dq 下的 LCL+电网 plant。
- 电路侧够用：`nmos/pmos/npn/pnp/diode/switch/transformer/coupling_inductor`（`nodal.py:943` 注册表），三相电网用三个 `sine` 源（相位 0/120/240）。
- **四条硬缺口**：① 场景只能三选一（`scene.py:772`），控制器与功率级不能同网络互采样；② 电路模式禁延迟边（`scene.py:1431`），门极只能接 `pulse/square` → 开环；③ 无 3ϕ→dq 原生块（`vector_transform` 仅 2×2，`computes.py:707`）；④ 无 PWM 载波比较块，且开关级需 µs 级 dt（`breakpoints` 已有，`simulation.py:195`）。

**结论与分层（D63）**：L1 平均模型零框架改动、两天内可出可跑示例；L2 跨域桥（D64：`sensor`/`actuator` + 步内「解 MNA → 采样 → 推进控制 → 下一拍驱动」）才让开关级闭环成立；L3 内建三相元件最后再评。

**票单（P11-01…P11-07，票序即顺序，详见 REQUIREMENTS §5 P11）**：01 平均模型地基 → 02 `abc_dq` 原生块 → 03 PLL 模板 → 04 dq 电流环 + 平均 PWM → 05 跨域桥（L2，动核心求解顺序，风险最高）→ 06 开关级三相桥示例 → 07 性能与封口（µs 步长耗时、降采样、L3 结论）。

**当前状态**：需求与票单已写入 `REQUIREMENTS_AND_RULES.md`（R31、D63、D64、§5 P11、§6 不做清单加「开关损耗/热模型/EMT 精度认证」），本文件同步；**2026-11-05 已按 §7.72 完成 P11-01…P11-07（581 passed / 3.19.0）**，本节保留立项记录。

## 7.20 P7-04 仪器面板（R23 / D47，2026-10-29）

**目标**：右栏 分析 组新增「仪器」子页，把探针数据做成万用表 / 示波器 / 李萨如三块，全程旁路——只读 `state.frames`，不写电路、不触发求解。

**实现（`frontend/`，`app.js` 8.6 段）**：
- 结构：`#tab-inst` 内 `时间窗` → `万用表`（`#instMeterKey` + 5 读数）→ `示波器`（`#instCh1–4` + `#scope` + `#instLegend`）→ `李萨如`（`#instLX/#instLY/#instTrail` + `#lissajous`）。
- 数据：`instrumentFrames()` 按 `state.instrument.window` 截取尾部帧（回放时取 `frames.slice(0, replay.index+1)`）；`instrumentStats()` 算实时/平均/RMS/峰峰值/极值；`drawScope()` 统一幅值缩放 `amp = max(abs) × 1.1`；`drawLissajous()` 取最近 `trail` 帧画 X-Y 轨迹。
- 选择项：`instrumentSelectGroups()` 按探针键分「节点电压 / 元件电流 / 元件压差 / 元件电压 / 元件功率」五组，文案 `名称 · 字段`；图例复用 `instrumentKeyLabel()`，不再裸露 `n:signal:voltage`。
- 空态：四路全空时自动接「第一个电压 + 第一个电流」；全摘光时画布给「给 CH1–CH4 接上信号」提示、图例清空。
- 持久化：`saveInstrumentPrefs()` 写 localStorage（meterKey / channels / lx / ly / trail / window）。
- 自适应：`ResizeObserver` 观察 `.scope-wrap`，按 DPR 记 `state.instrument.scopeSize` / `lissSize`。

**验收（`NetlabExtras/scratch/verify_p704.mjs`，全绿，exceptions=[] consoleErrors=[]）**：
- 面板可见、测点下拉 8 项、探针 7 路；自动接 `signal · 电压` / `bias · 电压`，读数 实时 4 / 平均 4 / 有效值 4 / 峰峰值 0 / 极值 4 4；状态行「400 帧 · 窗口 4 s」。
- 示波器画布 408×138：35 种颜色、126 行有内容（网格 + 双迹）；李萨如 408×150：38 色、138 行。
- 浅色主题重绘正常（36 色 / 126 行）；四路全摘 → 图例 0 项、画布只剩网格与提示。
- 旁路：暂停后连改时间窗与通道，`steps` 与帧数均不变（387 → 387，采样值仍 4）。
- 刷新后 `channels[0]` 仍为 `n:signal:voltage`（`persistOk` true）。
- `node --check app.js` OK；静态版本 bump 至 3.11.0。未跑 pytest（本次只改 static 资源，测试不引用）。

**踩坑（CDP 验收）**：
1. 复用的旧标签页会「连上但永不回包」——`Runtime.enable`/`evaluate` 全部超时。一律 `PUT /json/new?about:blank` 新开标签页再 `Page.navigate`。
2. `Page.navigate` 不吃 `ignoreCache`，同版本号会命中旧 `app.js`：先 `Network.enable` + `Network.setCacheDisabled`。
3. 首次会话启动引导页 `#guide` 会盖住工作台，截图前先点 `#guideClose`。

**下一票**：P7-06 / P7-07 / P7-08 电路模块化（用户要求「做到模块化完全做完，实现模块闭环」）。

## 7.21 P7-06 电路模块化：端口标记 · 封装 · 实例化（2026-10-29 02:55）

**用户诉求（R24 / D49–D51，m00502 原话）**：「逆变器不急，按你的开工顺序，做到模块化完全做完，实现模块闭环」。

**做了什么**：
- 端口标记 = 网络节点参数。`Scene._normalize_net_params` 只收 `port_name`/`port_direction`/`port_note`；有方向必须有名字，方向限 in/out/inout，名字截断 32 字。
- `netlab/core/compute/circuit_modules.py`（新文件，563 行）：
  - `encapsulate_circuit(scene, node_ids, name)`：把选中的节点/器件连上它们之间的边搬进 `.block`（内部网络层），父场景原位置留一个 `module` 节点 + 每个跨界网络的端口网络节点，外部导线改接到新网络；未标记端口的跨界网络用网络名自动当端口名。
  - `instantiate_circuit_block(scene, block, position)`：从块定义生成模块节点 + 端口网络节点，端口未接线不报错（校验给 warning）。
  - `flatten_circuit(scene)`：电气直连展开（内外端口合并同一 MNA 节点），为 P7-08 做准备；`module_net_map`、`pin_names` 辅助。
  - `_wire_layout`：程序生成的导线按两端位置给中点 + rot 0/90。
- `netlab/core/model/blocks.py:encapsulate_nodes` 在 circuit 模式转发到 `encapsulate_circuit`，信号流路径不变（D51「信号流仍走数据传递」）。
- `netlab/core/model/schematic.py:validate_schematic`：空布局不再算错（只校验已存在的 rot），否则 API/程序新建的导线会被误判。
- 前端：`isPinNode` 把模块当引脚节点画（矩形框 + 引脚圆点 + 端口名），模块节点在框内显示块名、框下显示节点名；模块库面板可拖入实例化，`/api/blocks/instantiate`。

**证据**：
- `netlab/tests/test_circuit_modules.py` 8 条全绿，全库 **331 passed**（8.8s）。
- CDP `NetlabExtras/scratch/verify_p706.mjs`：`midVoltage=5`（10V 分压器）、`blockMode=circuit`、`blockPorts=[top…,gnd…]`、重载后 `moduleNodes` 1 个、再实例化 `moduleCount=2`、`/api/schematic/validate` → `ok:true`、`warnings` 含「端口未接线」、`exceptions=[] consoleErrors=[]`；截图 `p706-module-dark.png`、`p706-module-two.png`（画布上两个模块框 + 端口名）。

**踩坑**：
1. 8010 上的旧进程仍在跑旧代码（`node.params.port_name` 被旧校验拒成「电学节点没有额外参数」），必须重启 `python -m netlab.run --port 8010` 才验证新行为。
2. 服务重启后首次进入会弹模式选择页（引导页），验收脚本里 `#guideClose` 一次不够——延后会再弹，改成「反复关到真的不可见」（最多 8 次）。
3. `Page.navigate` 每次都要 `Network.setCacheDisabled`，否则拿到上一版 app.js（旧规则见 §7.20）。

**下一票**：P7-07 内部浮窗视图（`/api/blocks/{id}/open-internal` 已存在）+ 网络列表右键「封装为模块」入口。

## 7.22 P7-07 模块内部浮窗与封装入口（2026-10-29 03:20，R24 / D50）

**用户原话**（m00502/m00505）：「逆变器不急，按你的开工顺序，做到模块化完全做完，实现模块闭环」，本票是其中的第二步（P7-06 打底后的「看得见」）。

**做了什么**：
- `#moduleWin`（`.floatwin modwin`，880×560，z 133）——左栏端口列表（方向 + 端口名 + 电气徽标）与 `节点/连线/端口/版本/模型` 统计、底部「在临时网络中编辑」「实例化到画布」；右栏 `<canvas id="moduleCanvas">` 只读预览（`drawModulePreview()`：等比缩放居中、端口暖橙 / 接地绿 / 器件蓝灰 / 普通网络白、左下角 `只读预览 · 块名 · N 节点 / M 连线`）。
- **收成侧栏**：标题栏 `#moduleDock`（`.floatwin-dock`）切 `.modwin.docked` —— 贴右缘 300px、隐藏 canvas 与 hint、标题单行省略，只留端口与统计。
- **入口改造**：模块库「打开内部」改为 `openModuleInternal()`（不再直接开临时网络）；网络列表项右键菜单新增「在模块内部浮窗中打开」「关闭模块内部临时网络」「封装选中节点为模块…」「打开模块库」四项（`.ctxmenu`，z 150）。
- **失败保留预览**：「在临时网络中编辑」调用 `openBlockInternal()`，**打开成功才收窗**；失败（例如内部缺接地）保留预览并走统一 toast，不再黑屏无反馈。

**验收（`NetlabExtras/scratch/verify_p707.mjs`，exceptions=[] consoleErrors=[]）**：
- 夹具：造 6 节点 / 5 连线 / 2 端口的 `structural` 模块（内部 `r1/r2` 分压 + 自带 `ground`，外部电源与负载提供两条跨边界导线）→ `ports=[topIn…, mid…]`、`hint=MODULE · 6 节点 · v1`、`meta=节点6 连线5 端口2 版本v1 模型结构`。
- 浮窗：880×560 @ (328,99)、canvas 670×515（466 色）、端口两行、z 133；收成侧栏 300px 贴右缘且 canvas `display:none`；Esc/关闭正常。
- 编辑链路：点「在临时网络中编辑」→ 浮窗隐藏 + 新建网络「模块 chain-…」；右键该临时网络 → 菜单出现且「在模块内部浮窗中打开」可用 → 点击后浮窗重新打开、标题回填块名。
- 抬层：先 Ctrl+K 开文档窗（z 130），点模块窗 → 134/135 压过文档窗。
- 清理：临时网络与模块库条目都能删干净（`networkDeleted=true`、`blockDeleted=true`）。
- 截图：`NetlabExtras/scratch/p707/p707-module-window.png`、`p707-module-docked.png`、`p707-module-light.png`、`p707-network-menu.png`。

**踩坑**：
1. 封装夹具必须先满足两条硬规则——**至少一个跨边界连接**（否则报「选中的电路没有任何跨边界连接」）与**源器件两端都在选择集内**（否则报 `元件 'V…' 无法装配`）；把接地一起选进模块后，源要改建成「设备节点 + 两根导线」，并且电压源先接 `+`、`-` 交给 R21/D43 的自动对地，否则报「两端都接地」。
2. 模块内部**必须自带 `ground`** 才允许「打开内部」进临时网络（`电路需要至少一个接地节点`），所以夹具把 `gIn` 一起选进模块。
3. canvas 里的空状态提示曾因 `.modwin-empty { display:grid }` 盖过 `[hidden]` 而永久显示，补 `.modwin-empty[hidden]{display:none}` 才算真隐藏；收成侧栏后标题被挤成三行，也靠 `.modwin.docked .floatwin-head b{…ellipsis}` + 隐藏 hint 修掉。

**改动文件**：`frontend/index.html`（`#moduleWin` 结构、`?v=3.14.0` 两处）、`frontend/app.js`（`openModuleInternal`/`closeModuleInternal`/`toggleModuleDock`/`renderModuleSide`/`modulePortList`/`drawModulePreview`/`initModuleWindow`、网络列表右键菜单）、`frontend/style.css`（`.modwin*`、`.ctxmenu`、`.modwin.docked`）、`docs/UI_SPEC.md`（§5.8 + §5.7 入口补句）、本文 §7.22 与票表。

**下一票**：P7-08 电气直连展开（内外端口同一 MNA 节点）+ 封装前后等价性测试。

## 7.23 P7-08 电气直连展开与等价性验收（2026-10-29 03:34，R24 / D51）

**用户原话**（m00502/m00505）：「逆变器不急，按你的开工顺序，做到模块化完全做完，实现模块闭环」，本票是模块化的最后一步：让「封装前后电气等价」有可复算的证据。

**已确认的运行时链路**：`CircuitEngine.__init__`（`netlab/core/model/scene.py:469-474`）先 `flatten_circuit(scene)` 拿到 `extra_nodes/extra_edges/merges`，把它们并进父场景，再用并查集把「模块引脚所在的外部网络」与「`{module_id}/{port.net}` 内部端口网络」合并——内外端口因此是同一个 MNA 节点，内部器件直接进父矩阵。没有模块实例时 `extra_*` 为空，行为与之前完全一致。

**修掉的一处实现与文档不一致**：`encapsulate_circuit` 原先只把**跨边界**的网络导成端口，完全在模块内部、但显式标了 `port_name` 的网络（例如分压中点，想留作探测点/级联点）会被吞掉。现在补了「纯内部端口标记」分支：生成父场景同名端口网络（保留 `port_name/port_direction` 与坐标）+ 一根到模块引脚的导线；占位映射写成 `rewire[parent_net_id] = parent_net_id`，再由既有 `real_ids` 一轮统一换成 `add_node` 生成的真实 id（直接写 `rewire[record.id]` 会让 `parent_wires` 找不到节点、报 `节点 '…' 不存在`）。

**新增等价性测试（`netlab/tests/test_circuit_modules.py`，现 11 条）**：
- `test_flatten_matches_flat_circuit_frame_by_frame`：平铺分压器 vs「同一分压器封装成模块 + 在新场景里按引脚接回」两条电路，各跑 24 步 1e-4，逐帧中点电压偏差 **< 1e-6**，并断言波形本身有内容（`max|v| > 0.5`）以排除「两边都是 0」的假通过。
- `test_flatten_merges_port_net_into_internal_net`：`flatten_circuit` 返回的 `merges` 必须落在「外部端口网络 × `{module_id}/{内部网络}`」的笛卡尔积内，且条数 = 端口数（3）。
- `test_two_module_instances_stay_independent`：同一模块定义的两个实例并排运行，两边中点电压差 **< 1e-9**，说明展开时各自 id 前缀独立、没有共用内部网络。
- 既有 `test_circuit_encapsulate_api_loop` 因新增导出端口而更新期望（`{gnd2, top2, vmid}`、实例 `ports` 3 个）。

**验证**：`python -m pytest netlab/tests/test_circuit_modules.py -q` → 11 passed；`python -m pytest -q` → **335 passed, 2 warnings**（10.36s，2 条为 SciPy `LinAlgWarning`，属既有奇异矩阵用例）。

**改动文件**：`netlab/core/compute/circuit_modules.py`（`encapsulate_circuit` 内部端口导出分支）、`netlab/tests/test_circuit_modules.py`（+3 条等价性测试、API 用例期望更新）、`docs/REQUIREMENTS_AND_RULES.md`（R24 现状、§9 变更记录）、本文 §7.23 与票表。静态资源本次未改，保持 3.14.0。

**模块化闭环结论**：封装（P7-06）→ 落库/载入（P7-06）→ 拖入与按引脚接线（P7-06）→ 内部视图/侧栏（P7-07）→ 求解时电气直连展开且与平铺电路逐帧一致（P7-08）——四步都能跑通并有测试/脚本证据。

**下一批**：P7-09/10/11 内置内部结构（R25 / D52），或按用户新指令切到 P11（逆变器，当前明确暂缓）。

## 7.24 R30 挂耳 / 右栏拖拽收尾（2026-10-29 03:35，静态 3.14.1）

**用户原话（m00003）**：「右边菜单栏不能直接拖动缩放，并且检查器文字离边框太近，上面的面板控制收起的功能不需要，建议直接用类似于，左侧侧边栏的按键缩放，而且我还发现左侧侧边栏缩放后无法直接再展开，必须通过设置展开，我希望在侧边栏收起后也能在侧边栏处展开，并且希望收放键与侧边栏融合更好，比如右侧侧边栏挂耳样的实现，此外我还希望能在开始界面，增加设置视图，与打开工程的功能」。

七点逐条核实：结构件（`#netHanger`/`#panelHanger`/引导页两个按钮/检查器 16·18·22 内边距）在 §7.17 追加里已经落地，但**三处不达标**，见下。

**缺陷 1（拖拽彻底失效的根因）**：`style.css` 的响应式规则把面板列宽写死——`@media (max-width:1440px)` 第 4 列是 `360px`、`@media (max-width:1180px)` 是 `336px`。1440×900 下 `--panel-w` 被完全忽略：设 `--panel-w:500px` 后实测 `grid-template-columns` 仍是 `172px 70px 838px 360px`。现改为 `var(--panel-w, 360px)` / `var(--panel-w, 336px)`。FEM 模式另有独立变量 `--panel-w-fem`（默认 404），拖拽原来只写 `--panel-w`，在 FEM 下同样「拖不动」；`initPanelChrome` 里新增 `panelVar()`，FEM 模式写 `--panel-w-fem`。

**缺陷 2（挂耳悬空 23px）**：挂耳定位用的是 CSS 变量默认值 `calc(var(--panel-w, 388px) - 5px)`，而变量没设、真实列宽 360 → 实测挂耳左边 1038、面板左沿 1080。现新增 `syncChromeEdges()`（`app.js` 约 10023 行）：按 `#networks` / `#panel` 的 `getBoundingClientRect().width` 实测写 `--net-edge` / `--panel-edge`，挂耳定位改用这两个变量（`calc(var(--panel-edge, …) - 5px)`）。调用点：`applyNetCollapsed` / `applyPanelHidden` 的 60 ms 回调开头、`initShell` 末尾 `requestAnimationFrame`、window resize、两个拖拽 finish，以及两个 pointermove（与 `--panel-w`/`--net-w` 同步写，拖动中不滞后）。

**缺陷 3（融合感）**：`.hanger` 背景由 `var(--paper-2)` 改 `var(--panel-bg)`（与侧栏同材质）、阴影降到 `0 1px 4px rgba(...,.07)`；贴边一侧去掉边框（`.hanger-net{border-left:none}` / `.hanger-panel{border-right:none}`）、外侧两角 7px 圆角，看起来像长在侧栏上而不是浮在画布上；收起态恢复整框圆角与边框。

**实测证据（QtWebEngine 无头 1440×900，Qt 6.9.2 offscreen 截图 + JS 量取）**：
- 拖拽：模拟 `pointerdown/move/up` 于 `#panelResize`，面板 360→480，挂耳跟到 946（面板左沿 960，压 5 px），`localStorage['netlab.panel.width']=480`；FEM 模式下 404→513（写 `--panel-w-fem`，`--panel-w` 保持空）。
- 贴边：`--panel-edge=360px`，`#panelHanger` 1066..1085 与面板左沿 1080 重叠 5 px；`#netHanger` 160..179 与 `#networks` 右沿 172 重叠 12 px。
- 左栏收放：点挂耳 → `main.net-hidden`、列宽 `0px 70px 1010px 360px`、挂耳停在 x 0..19；再点一次回到 `172px 70px 838px 360px`（原地展开，不必进设置）。
- 右栏收放：点挂耳 → `panel-hidden`、面板宽 0、挂耳停在 1434 侧（`right:6px`），画布铺到 1440。
- 引导页：`#guideOpenProject`（打开工程）/`#guideSettings`（设置视图）可见，点后者弹出 `.floatwin`（760×640，视图与外观页）。

**改动文件**：`frontend/style.css`（响应式列宽、`.hanger*` 材质/圆角/定位）、`frontend/app.js`（`syncChromeEdges` 新增与全部调用点、`ui.networks` 映射、`currentWidth()` 改实测优先、`panelVar()` FEM 分支）、`frontend/index.html`（`?v=3.14.1` 两处）、本文 §7.24 与头部行。

**验证**：`node --check app.js` OK；`python -m pytest netlab/tests -q` → **335 passed, 2 warnings**（纯前端改动，无新增用例）；备份 `NetlabExtras/backups/ProjectPoint_backups/ui_20261029_0335/`（static 三件 + `MANIFEST.sha256`）。

**边界**：拖拽 clamp 仍为 260–720；`localStorage` 的 `netlab.panel.width` 只记录拓扑模式宽度，FEM 宽度不落盘（下次进 FEM 回到 404）。

**证据文件**（`NetlabExtras/scratch/r30/`）：`35-inspector-node.png`（选中节点后的检查器内边距 + 双侧挂耳贴边）、`36-net-collapsed.png`、`37-panel-collapsed.png`、`38-fem-drag-513.png`、`39-guide-actions.png`、`40-hanger-dark.png`（深色同材质）。

## 7.25 封装报错修复 · 端口方向 · 库清理 · 封装指南（2026-10-30 01:50，静态 3.14.2）

**起因（用户 m01860 原话）**：「依然纯在封装时无法封装的问题出现节点不存在，某种连接无法封装等问题，请修复问题，并且修复完，讲解如何封装模块化以及如何使用，还有图二的一堆模块模板都是写什么，请减少垃圾，说明其用途，输入什么输出什么，还有设置端口为什么不区分输入输出」。

**真因**：不是封装算法错，而是**验收脚本在用户正在使用的同一进程里造夹具节点又删除**，用户画布选中集里留着已删除的 id，点封装即报 `节点不存在：…`（`circuit_modules.py:114`）。暴露的是「画布与场景不同步」的健壮性缺口。

**修复**：
1. 后端 `encapsulate_circuit` 边界段重写为**按外部网络分组**：同一外部网络的跨界导线只生成一个端口，同组被吸收网络并入同一内部网络（此前分压器中点会生出 `mid` 与 `mid_2` 两个口）；错误文案改为「选中的节点已不存在（画布可能已过期，或这些节点刚被封装/删除）：… 请刷新画布后重新选择要封装的节点。」
2. 前端三层防护：`applySnapshot` 按现存活 id 修剪 `state.multi`；`encapsulateSelection` 点封装前再过滤，全失效则 `refreshState(false)` + toast「画布已过期…」；请求包 `try/catch`，失败也刷新并提示。
3. 端口方向入口：节点右键子菜单「设为模块端口 / 改端口方向」→ 输入 / 输出 / 双向（带说明），已标记时加「取消模块端口」；库卡片端口摘要改 `describeBlockPorts()`（电路按方向分组，信号块保持 `inputs → outputs`）。

**库清理**：`library/blocks` 原有 16 个模块，其中 15 个是 02:49–03:17 验收脚本造的 `chain-*` / `divider-*` 夹具 → 移到 `NetlabExtras/backups/blocks_p706_fixtures_20261030/`；现在只剩用户自己的 `twice`（signal/behavioral：`in_signal_path×2.0 + in_bias_path×0.5 → out_amplifier`，2 进 1 出）。

**新增文档**：`docs/MODULES_HOWTO.md`（本次遇到的现象、封装三步与三条硬规则、端口方向为何默认双向、模块使用/内部浮窗/临时网络、库现状与 `twice` 用途、五条常见报错对照、验证文件清单）。

**测试**：`test_circuit_modules.py` 新增 `test_boundary_group_merges_ports_to_same_outer_net`、`test_encapsulate_reports_stale_node_hint` → 13 条；全库 **337 passed, 2 warnings**（10.53s）。静态 3.14.1 → **3.14.2**（index.html 两处 `?v=`）；应用已重启（`:8010`，日志 `NetlabExtras/scratch/app8010.log`）。

**CDP 验收教训**：新开标签页各自加载/恢复项目会让「服务端当前网络」与各页列表分叉（客户端「网络 10」、服务端只有「网络 1」），点网络项无法对齐；`#stage` 是 `<section>`，真画布是 `#graph`；画布右键派发到 `#graph` 有效，网络列表右键是 `.ctxmenu` + `.menu-item`。夹具请只写进临时工程/独立端口，别在用户正在用的场景里造删节点。

## 7.26 模块库按名字存盘 · 改名/删除入口（2026-10-30 02:30，静态 3.14.3）

**用户原话**：「先帮我把模块的这个菜单栏修改一下，能直接对这些保存的模块增删和重命名，并且在重复名字时提醒，以及 library 里的模块命名明显不合理，请按名字命名不要分割那么多子文件夹」。

**存储层改成「一个模块一个文件、文件名=模块名」**（`netlab/core/model/blocklib.py`）：
- 旧布局 `library/blocks/<id>/v<N>.block` → 新布局 `library/blocks/<模块名>.block`；库里只保留最新版，内容变化时版本号自动 +1（不再因「同版本内容不同」拒绝）。
- 重名（忽略大小写与首尾空白）拒绝保存/改名，报「模块名已存在：…（已有模块 …）；请换一个名字」。
- `scan_library` 先跑 `migrate_library`：旧 `<id>/v*.block` 自动压平成 `<名字>.block`，重名自动加 `-<id前6>` 后缀；`load_block` 忽略版本号（库里没有旧版），旧工程 `id@vN` 引用照常加载。
- 新增/改写：`blocks_root`、`_slug`（去 Windows 非法字符、保留中文、限 60 字）、`flat_path`、`find_block_path`、`migrate_library`、`name_taken`、`_same_content`；`write_block/rename_block/overwrite_block/import_block/remove_block/load_block/ensure_blocks/list_versions/scan_library` 全部跟着改。
- 实际库已迁移：`twice.block`、`加法.block`、`加法-f42824.block`（两个模块曾同名「加法」，第二个自动带后缀，用户可自行改名区分）。

**前端模块库面板**（`frontend/app.js` `renderBlocksPanel`）：每张卡片新增「改名」「删除」两个按钮。
- 改名：`window.prompt` 预填当前名 → 前端先查 `state.blocks` 重名（立即 toast「模块名已存在」）→ `POST /api/blocks/{id}/rename`；服务端报「仍被工程引用」时二次确认后带 `force:true`。
- 删除：确认框说明「文件会删、画布上的实例会变缺失」→ `POST /api/blocks/{id}/delete`（带 `version`），被引用时同样二次确认后 force。
- 面板底部说明改为「模块文件位于 `library/blocks/<模块名>.block`：一个模块一个文件，文件名就是模块名；库中只保留最新版」。

**测试**：`test_blocklib.py` 改为新语义并新增 3 条（版本自动 +1/重名拒绝、改名搬文件/重名拒绝、旧目录压平）；`test_blocks_api.py`/`test_degraded.py`/`test_project_refs.py`/`test_block_internal.py` 里写死旧路径 `blocks/<id>/v1.block` 的断言改成 `blocklib.find_block_path(...)`；`ensure_blocks` 冲突测试改为断言版本 +1。全库 **339 passed**。

**注意**：Python 侧改动需要重启 8010 才生效；重启前先 `POST /api/scene/export` 落盘，未保存的场景会丢。

## 7.27 旧模型器件边封装丢失修复（2026-10-30 02:45）

**用户反馈（m02502）**：封装后运行报「元件 'resistor-9' 无法装配：'b2e6c66398a5'」，附截图（画布上 `加法` 模块 + `resistor-9/10` 连线）。

**根因**：旧模型里器件本身就是一条边（`kind=resistor/vsource/...`，没有独立器件节点）。`encapsulate_circuit` 只把 `kind=="wire"` 的导线搬进模块，器件边既没进模块、也没从父场景删除；而它两端的网络节点已经被搬走 → 器件边悬空 → 运行期 `net_root[record.source]` KeyError。

**修复（`netlab/core/compute/circuit_modules.py`、`netlab/core/model/scene.py`）**：
- `encapsulate_circuit` 新增 `internal_elements`（两端都在选中集的器件边，连同名参数与控制端引用一起进模块）与 `straddling`（只有一端在选中集 → 直接报「两个引脚分在选中范围的两侧」）；`remove_edges` 一并移除已入模块的器件边；「至少要包含一个器件」的判断改成「没有器件节点也没有器件边」。
- 运行期：`CircuitEngine` 的旧模型装配改成遍历 `all_edges`（含 flatten 出来的模块内部边），并给悬空端点一个可操作的中文报错（「一端接在已不存在的节点上…请删掉这条元件连线重画」）。
- `_LightEdge` 补 `state` 字段，供 `create_element` 读取。

**验证**：`netlab/tests/test_circuit_modules.py` 新增两条（`test_encapsulate_moves_legacy_element_edges_into_block` 断言器件边进模块 + 父场景无悬空 + 实例化后电压等于 10 V×2/3；`test_encapsulate_rejects_element_straddling_selection`）；全库 **341 passed**。

**文档**：`docs/MODULES_HOWTO.md` 新增 §0.1（器件边漏洞与现在的行为）、§1 规则表更新、§6 测试数改 341。

## 7.28 桌面版「需要库路径」修复 + 模块库事故交代（2026-10-30）

**用户报错**：桌面版打开/保存工程弹「工程使用模块引用，需要一个库路径才能打开」，并说「还存在这个路径问题，无法保存」。

**根因**：桌面桥 `netlab/desktop/bridge.py` 三处 `validate_project(json.loads(payload_json))` 都没传 `library`，于是用了默认 `None`；工程里只要含 `blocks` 引用就直接 `ValidationError`。同类问题也存在于 `POST /api/project/validate`（FastAPI 端点没有 `library` 参数）。报错文案还写着旧布局 `library/blocks/<id>/v<N>.block`。

**已修**：
- `netlab/desktop/bridge.py`：新增 `_library_root()`（`NetlabHome/library`，不存在则退到工作目录）与 `_validate_for_file(payload)`——先用库路径校验，失败再 `allow_degraded=True` 重试并回填 `degraded`，随后恢复原始 `blocks` 与 `checksum`，保证「引用缺失也能保存」；三处调用点全部替换；`compute_checksum` 一并 import。
- `netlab/server.py`：`POST /api/project/validate` 改为传 `library=_library_path()`，`ValidationError` 时降级校验并在响应里带 `degraded`。
- `netlab/core/model/blocklib.py`：`library is None` 的文案改为「这个工程用到了模块引用，但当前没有可用的模块库路径；请在设置里指定 library 目录（默认是工作目录下的 library/）后再打开」；缺模块文案改成 `<模块名>.block` 要放回 `library/blocks/`。

**验证**：隔离端口 8011 + 临时工作区 `NetlabExtras/scratch/tmp_ws`，脚本 `NetlabExtras/scratch/verify_p706_legacy.py` —— 造「旧模型器件边」电路（vsource+两电阻，器件就是边）→ `/api/blocks/encapsulate` → 生成 `library/blocks/hr-legacy.block`（3 条边：`vsource V_legacytest`、`resistor R1_legacytest`、`resistor R2_legacytest`，端口 `mid_legacytest` inout），父场景无悬空器件边；`POST /api/control {"action":"run"}` 跑 142 步无装配错误，`out_legacytest` 读数与手算一致（4.0 V，因调试时多并了一只 1 kΩ：10×0.667/1.667）。验证后已关服务、删临时工作区。

**事故交代**：迁移库到「按名字存盘」时没先整库备份，`migrate_library` 只处理了 `twice`，用户的两个「加法」模块（`f2dd5dc94e3c`、`f42824621f08`）文件丢失且无备份，**不可恢复**（客户端仅存空壳摘要）。教训：动用户数据前必须先整体复制目录（已记入 LESSONS/记忆）。用户当前库只剩 `twice`。

**待生效**：本轮修复全在后端，需重启应用（并先 `POST /api/project/export` 落盘）才加载。

## 7.29 模块连线引脚：前端漏判 kind==='module'（2026-10-30）

**用户报**：从模块符号上拉线，红条报「起点是器件节点 '模块'，必须指定引脚」，并质疑「接口只是声明，外部直接连到显示的端口就行」。

**根因（前端）**：`frontend/app.js` 的 `createWireBetween()` 用 `source.kind === 'device'` 判断要不要带引脚，模块实例是 `kind === 'module'`，被漏掉 → 请求里根本没有 `source_pin` → `scene.py:1138` 拒绝。项目里本来就有正确的判据 `isPinNode(node)`（device 或 module），只是这里没用。

**已修**：
- `createWireBetween()`：改用 `isPinNode()` 判断两侧，并加 `pinFor()` —— 显式给了引脚就用它，没给且该节点**只有一个端口**时自动取那一个；两器件直连的拦截也改成 `isPinNode` 判断。
- `netlab/core/model/scene.py` `_normalize_wire_pins()`：单端口模块缺引脚时自动补（`resolved` 数组回写），多端口仍报「必须指定引脚」；顺带把循环改成 `resolved[index]` 回写，修掉「本地 `pin` 改了但返回值没变」的问题。
- 测试：`test_circuit_modules.py` 新增 `test_module_wire_autofills_single_port`（单端口自动填 `vin`）、`test_module_wire_still_requires_pin_when_ambiguous`（三端口仍报错）。该文件 17 passed，全库 **343 passed**。
- 静态版本 3.14.3 → 3.14.4；`node --check app.js` 通过。

**结论**：拖线到模块端口点（小圆点）即可；单端口模块直接拖到符号上；多端口在对话框里选。前端改动刷新即生效，后端自动补引脚需重启。

## 7.30 R32 绘图子系统接入（PlotKit 子页签 + 可分离内嵌窗口，2026-10-30 22:20，静态 3.15.0）

- **需求口径**：REQUIREMENTS_AND_RULES.md 的 **R32**（论文级绘图子系统）与 **D66**（接入方式）。
- **后端**：新增 `netlab/plotkit_bridge.py`——把当前场景探针通道镜像进 PlotKit 的命名数据集（`t` + `n:<节点>:<字段>`，`life="append"`，20480 点环形窗口），以子应用挂到 `/plotkit`（`plotkit_bridge.mount(app, SERVICE)`，`PLOTKIT_MOUNTED` 记录结果；没装 plotkit 时静默跳过）。场景重置/换模板时清空历史并重建通道（`_reset`）。
- **前端**：分析组新增「绘图」子页签（`data-sub="plotkit"`，不新增右栏顶层分组，R30 验收②不变）；点「打开绘图窗口」拉起非模态浮窗 `#plotkitWin`（iframe 懒加载 `/plotkit/?embed=1`），标题栏新增停靠按钮 `⇥`：**停靠 = 贴画布右侧的内嵌窗口（72% × 78%），浮出 = 可拖动浮窗**，几何存 `state.plotkitGeo`、`state.plotkitDock`，复用了 `initFloatWindow` 与 `.floatwin` 基类（D62）。
- **嵌入形态**：PlotKit 识别 `?embed=1` → `body.embed`，顶栏紧凑（隐藏品牌副标题与标题、菜单不换行）、右侧面板默认收起（`◂` 可展开）、`overflow:hidden` 去掉横向滚动条。
- **子路径安全**：PlotKit 前端资源改为相对路径 + `<base href="./">`，`fetch('api/...')`；`no-store` 中间件改为匹配 `"/static/" in path or path.endswith("/")`（挂到 `/plotkit` 后 `request.url.path` 带前缀，原先的 `startswith("/static")` 失效，导致改了 CSS 刷新还是旧的）。
- **测试**：新增 `netlab/tests/test_plotkit_tab.py` 4 项（首页含入口与浮窗骨架、`/api/health` 不受影响、`/plotkit/` 与 `/plotkit/api/{meta,spec}` 可用、`/plotkit/static/app.css` 与 netlab `/static/style.css` 互不干扰），全量 **347 passed**。
- **未做**：旧的时间序列 canvas 未删（P6，需 PlotKit 补齐回放/预计算/图例/多画布后再做）；`/plotkit/api/*` 不受桌面 token 守卫约束（仅本机回环，已在 D66 标注）。
- **证据**：`PlotKit/docs/netlab_docked.png`（停靠态实拍，control_loop 场景 6 条通道实时曲线）、`docs/netlab_tab.png`（浮出态）。

## 7.31 R32 绘图子系统：老画布能力对齐（v0.3，2026-10-30 23:30，PlotKit 124 passed）

- **需求口径**：R32（论文级绘图子系统）+ D67（时间窗进 spec / 回放属 L3）+ P12-06 票。
- **用户指令**（原话）：「补齐老画布能力」——先把老时间序列 canvas 的功能搬到 PlotKit，再谈删旧；删旧按「功能等价迁移」判，不许丢功能。
- **spec 层**：`src/plotkit/spec/model.py` 新增 `new_spec(..., window=)` → `figure.window`；`src/plotkit/spec/validate.py` 的 `KNOWN_FIGURE_KEYS` 加 `window` 并校验（正数或 null）。
- **后端切片**：`src/plotkit/backends/plotly_backend.py` 新增 `_window_slice()`（单调数据走 `np.searchsorted`）、`time_bounds()`；`_xy()/_error_bars()` 与三个 builder 都接 `trange`（误差数组必须同窗口切片，否则长度对不上）；`to_figure(..., t_end=)` 里 `right = t_end or hi`、`left = max(right - window, lo)`，并对没有显式 `xlim` 的非 inset 子图强制 `view["xlim"] = trange`。
- **API**：`GET /api/figure.json` 增加 `t` 参数（缓存键变 `(pixels, per_pixel, t)`）、`GET /api/meta` 增加 `window` 与 `time: {min, max, count}`、新增 `POST /api/clear`（数据集归零 + `figure.clear()` + 清缓存）；`Figure.window(seconds)`、`Figure.time_bounds()`、`Figure.plotly(t_end=)`。
- **前端**：头部下新增 `.toolbar`（时间窗 / 回放滑杆 / 播放 / 速度 5–240 / 循环 / 回到实时 / 清空 / 状态文字）；数据集面板加搜索框与「全部加图层」；`state.playhead/playing/playSpeed/playLoop/playClock`。
- **桥接**：`netlab/plotkit_bridge.py` 加 `DEFAULT_WINDOW = 5.0`，`build_figure()` 里 `fig.window(5.0)`，与老画布默认时间窗一致。
- **两个真 bug（实拍抓出，非猜测）**：
  1. 拖回放没反应——`playhead` 的 `input` 回调里先 `stopPlaying()`（内部 `syncPlayheadUI()` 把滑杆值写回旧游标）再读 `e.target.value`，读到的是旧值；改成**先读值再停播**。
  2. 播放不动——`requestAnimationFrame` 在无头/后台页被暂停；改用 `setTimeout` + 「真实经过时间 × 速度」推进，重绘降频也不失真。
- **测试**：`tests/test_window.py` 9 项（窗口切片、`t_end` 回放、数据起点夹取、无窗口全量、负 window 校验、`time_bounds`、`/api/meta` 的 time/window、`/api/figure.json?t=`、`/api/clear`）；PlotKit 全量 **124 passed**；netlab 仍 **347 passed**（本轮未改 netlab 后端，只改桥接默认窗口）。
- **实拍**：`PlotKit/docs/netlab_replay.png`（时间窗 2 s、游标 0.23 s，画的是历史段）、`PlotKit/docs/netlab_docked.png`（实时 5 s 窗口）；浏览器点「清空」→ 状态栏「已清空轨迹」、trace 0、游标回 null。
- **已取消（D68，2026-10-31）**：原 P12-07「删旧 canvas」及其四项前置（① 图例点击切换显隐；② 示波器/李萨如/相图三块画布；③ 「预计算 0→T」；④ 探针勾选树）——用户决定**不删** `drawChart()` 与 `state.frames`，PlotKit 与该路径长期并存。
- **文档同步**：`PlotKit/README.md` 增「时间窗与回放（v0.3）」，`PlotKit/docs/DESIGN_v0.md` 增 v0.3 段与 D23，本文件 §7.31，`REQUIREMENTS_AND_RULES.md` 的 R32 现状/D67/P12/§9，`LESSONS.md` 增本轮五条坑。

## 7.32 六项审查加固与残余修复（2026-11-01 20:08，356 passed / 3 skipped）

- **背景**：用户要求 NS 修复完成后继续审查 PlotKit 与 netlab。netlab 审查发现 6 个可复现缺陷；本轮先修高风险项，再按代码审查补残余。
- **多网络保存（R16/D2）**：`project.py` 抽出 `build_project_for()`，`save_project()` 与 `workspace.create_project()` 都按对象分派；`NetworkContainer.build_project` 负责全部网络，普通 `Simulation` 落回单场景构建。修复 `/api/workspace/save` 与 `/api/workspace/create` 把多网络压成“网络 1”的数据丢失。
- **降级只读（D7）**：`networks.py` 新增 `_require_writable()`，`load_scene`/`mutate`/`add_network`/`rename_network`/`remove_network` 共用；`/api/workspace/save` 也拒绝降级工程。`load_scene` 不再先清 `degraded` 标记，避免“切换模式/清空场景即解锁”。
- **预计算（D48）**：`limits.py` 新增 `MAX_PRECOMPUTE_STEPS = 200_000`；`Simulation.precompute()` 把 dt/采样/步数校验全部前移到任何 `scene.reset()`、`recorder.clear()` 之前，超限直接 `ValidationError`，不再静默截断，也不会因拒绝而清空已有录制。`needed` 降采样仍保留。
- **电路封装（P7-06）**：同一内部网络被多个外部分组共享时，合并后的代表网络按“有端口标记优先、再按节点 id”稳定选择；多个不同端口名直接报错，不再静默取第一个；父网络重写与端口 canonical 化逻辑保留。
- **节点校验（R24）**：`nodal.py` 在内部节点收集后校验 `source/target/control_*`，错误含具体 id；合法内部端点（如二极管 `__D3__junction`）放行。
- **工作区状态（R01）**：打开/恢复工程先 `_apply_project` 成功，再更新 `CURRENT_WORKSPACE`；恢复快照补传 `library=str(workspace.library)`，避免跨工作区解析模块引用到全局库。
- **测试**：新增 5 项（`test_workspace.py` 多网络新建、`test_degraded.py` 容器只读、`test_recorder_sampling.py` 拒绝不破坏状态、`test_circuit_modules.py` 端口标记/冲突）；净增 **356 passed, 3 skipped**（0 failed）。
- **验证**：`python -m compileall -q netlab` 通过；`python -m ruff check` 仅剩 `server.py` 4 条既有 E402（导入在模块级全局之后，属既有结构）；`python -m netlab.desktop --selftest` 退出 0，返回 `status=200`、`shim_injected=true`、`shim_status=200`；`git diff --check` 通过。
- **代码提交**：`a40dba6 fix(modules,project): D7 降级只读全覆盖 + R16/D2 多网络保存 + D48 预计算事务校验 + P7-06 封装合并确定性`。
- **残余与说明**：`nodal.py` 现在会把“端点悬空”从静默接地改为 `ComputeError`，属有意收紧；`pins` 绑定在 `Scene.add_edge()` 已物化为 `source/target`，封装复制不会携带独立 `pins` 字段（本轮用探针确认）。仓库级 `REQUIREMENTS_AND_RULES.md:738/764` 仍写“没有 Git”，与当前 `NetlabHome/` git 仓库事实冲突；本轮未改该历史口径，需单独立项裁定。
- **备份**：`NetlabExtras/backups/ProjectPoint_backups/netlab_20261101_2010/`（含改动源码与 `MANIFEST.sha256`）。

## 7.33 R33 原生桌面外壳（Qt Widgets，2026-11-02，385 passed / 3 skipped）

- **背景**：用户 2026-11-01 定「选B」——只改 netlab，PlotKit 一行不动；要求「qt 界面完全实现，接口都对齐，软件功能完善」。规格见 `QT_NATIVE_SPEC.md`（R33/C1–C13/D69–D76/A1–A25），票单 `.scratch/netlab-qt/issues/01–15`。
- **新包 `netlab/ui/`**（约 5.6k 行）：`models.py`（纯视图模型：NodeVM/EdgeVM/SceneVM/TreeVM/LiveVM + 投影函数）、`geometry.py`（引脚、边界点、正交路由、吸附、ViewTransform）、`theme.py`（light/dark token → QSS + `qcolor`）、`bridge.py`（`ServiceBridge` + `LiveWorker`/`FemWorker` 两个 QThread，数据面直连 `SERVICE.live()`，不再走 HTTP）、`canvas/render.py`（网格/边/元件符号/跨线桥/标签避让/HUD）、`canvas/widget.py`（选择/拖拽/框选/缩放/平移/连线/拖入/右键/双击）、`charts.py`（时域/相图/示波器/李萨如/FEM，含 hover 读数与时间轴回看）、`panels.py`（工程树 + 属性表单 + 模块库 `ModulePalette`）、`shell.py`（菜单/工具条/停靠面板/状态栏/QSettings/撤销栈 120/复制粘贴/PNG·PDF·SVG 导出）、`docwin.py`、`plotkit_panel.py`（懒加载 QWebEngineView + 子进程托管）、`app.py`（单实例、`--selftest`）、`pixeldiff.py`、`acceptance.py`。
- **启动**：`python -m netlab.desktop --native`（或 `netlab/start_native.bat`）；不带 `--native` 仍是 pywebview。
- **实测**（`--selftest`）：build 187 ms / first paint 268 ms / ready **287 ms** / RSS **151 MB**；`acceptance.py`：`children=[] webengine_processes=0 listening=[] rss_mb=148 PASS`。对照旧壳 714–748 MB、2.9–3.5 s。
- **像素 diff**：同参数两次截图 **0.000%**（430 万像素 0 差异），渲染确定性成立。
- **本轮修掉的坑**：`render.py` 相对导入层级（`.geometry`→`..geometry`）；`QColor("rgba(...)")` 非法导致 HUD 黑块（改用 `theme.qcolor`）；图表无曲线（`chart_dock.isVisible()` 门控 + live 帧值在嵌套 `v` 里）；图例压刻度（移到绘图区左上、超宽截断加 `…`）；电路元件 `dx=dy=0` 引脚按 role 分边；符号溢出/标签重叠（有符号不画外圆 + 两遍标签避让）；FEM 均匀场压到冷端 + 图像拉伸；`open_docs()` 不留引用被 GC；`QWidget.render(painter)` 需 `targetOffset`；`QSvgGenerator` 在 `PySide6.QtSvg` 而非 `QtGui`。
- **测试**：新增 `test_ui_models.py`(8)、`test_ui_geometry.py`(13)、`test_ui_widgets.py`(6)，全量 **383 passed, 3 skipped**（11.2 s）。
- **PlotKit 面板实机验证（2026-11-02 04:50）**：WebEngine 起初一直 `loadFinished(false)`，根因两条——①受限桌面会话里 Chromium 的 renderer 沙箱起不来（要 `--no-sandbox`）；②本机有系统代理，Chromium 连 `127.0.0.1` 也走代理，页面永远转圈（要 `--no-proxy-server`）。`plotkit_panel.ensure_loaded()` 现默认设 `QTWEBENGINE_CHROMIUM_FLAGS=--disable-gpu --no-proxy-server`，`NETLAB_WEBENGINE_NO_SANDBOX=1` 作兜底。加后 `loadFinished(True)`，面板完整渲染 PlotKit 编辑器（截图 `_shot_plotkit.png`），A4 由「未验」转「通过」。
- **未验项**（如实记录）：A5/A13/A14/A18/A21 依赖真实桌面会话（屏幕缩放）或人工 kill，本轮环境给不出数。
- **文档**：`QT_NATIVE_SPEC.md` 升 v1.2（§10 全部勾选、新增 §14 验收结果表）；`AGENT_GUIDE.md` 增原生外壳路由与 `frontend/app.js` 冻结说明；`REQUIREMENTS_AND_RULES.md` R33 现状更新。


### 7.33.1 追加：PlotKit 接入与动效（2026-11-02 05:20）

用户要求「Plotkit继续接入，并且优化ui与动效」，本轮补齐：

- **PlotKit 面板**（`netlab/ui/plotkit_panel.py` 重写）：顶部工具条（刷新 / 在浏览器打开 / 浮动 / 状态）+ `QStackedWidget`（占位 → WebEngine）；首次打开浮出 1100×760；`loadFinished` 与面板 resize 时向页面派发 `window.resize`，解决「图看起来是空的」。
- **主题联动**：`apply_theme` → `plotkit_bridge.set_theme()` + 页面 `?theme=`；`Figure.revision` 是 spec 内容摘要，原地改主题也会换 ETag。
- **通道联动**：画布选中节点 → 只画该节点探针（`n:<节点名>:`），取消选择恢复全部。
- **曲线样式**：`LINE_STYLE = {"mode": "lines", "width": 1.4, "marker": {"symbol": ""}}`（`mode=lines` 仍会画 marker，必须显式清空 symbol）。
- **动效**（`netlab/ui/motion.py`，可在「视图 → 界面动效」关闭）：连线流动光点（仿真运行时）、悬停淡入、选中脉冲、90 ms 光标锚定缩放、图表淡入、面板滑入。关掉后全部直接落终态。
- **QSS 补齐**：QSlider（groove/sub-page/handle）、QCheckBox/QRadioButton indicator、QProgressBar、QMenu::separator。
- **画布自适应**：首次载入场景后 `request_fit()`，且在用户手动缩放/平移前跟随窗口尺寸自动 fit（`_auto_fit`），修掉「dock 展开后电路缩在角落」。

坑（已写进 spec §15.3）：PlotKit 按元素尺寸渲染（窄面板 → constrained_layout 塌陷）、`mode=lines` 仍画圆点、`QTimer(owner)` 要求 QObject、浮动 dock 不能走 `slide_dock`。

验收：**385 passed, 3 skipped**；截图 `_shot_main_light.png`、`_shot_main_dark.png`、`_shot_plotkit_light.png`、`_shot_plotkit_dark5.png`。

### §7.33.2 自动保存与验收脚本（2026-11-02 10:55）

- **背景**：R33 验收表里 A21（强杀恢复）标着「未验」，核查发现不是「没测」，而是**原生壳根本没有自动保存**——web 壳有（`webview_bridge._autosave_path`），原生壳漏了。
- **实现**：`shell.py` 加 `AUTOSAVE_INTERVAL_MS=60_000`、`autosave_path()`（`%APPDATA%/Netlab/NetlabDesktop/autosave.netlab`）、`_autosave/_clear_autosave/recover_autosave/has_autosave`；`app.py` 加 `--no-recover` 与启动询问；`--selftest` 关掉自动保存避免污染用户目录；关窗只在自己拥有自动保存时清理。
- **脚本**：`netlab/ui/soak.py`（A18 长跑采样）、`netlab/ui/restore_check.py`（A21 三进程强杀恢复）。
- **实测**：`restore_check` → 崩溃前 1 节点、自动保存 1615 B、重启恢复 1 节点、`dirty=True`，**PASS**；`soak --minutes 2` → 148.6 MB 全程不变（波动 0.2 MB），脚本自检通过（30 分钟才算 A18 通过）。
- **顺手修**：模块库按 `scene.mode` 过滤桶，信号模式下不再出现 `node`/`device`（原来落地报「未知的节点构造方式」）。
- **测试**：新增 `test_catalog_entries_follow_mode`、`test_autosave_write_and_recover` → **387 passed, 3 skipped**。
- **文档**：`QT_NATIVE_SPEC.md` 新增 §16；`BACKLOG.md` 首版。

### §7.34 PlotKit 接入修复、结构整理与步进优化（2026-11-02 13:05）

- **PlotKit 接入（commit `ff401de`）**：根因是 `import plotkit` 失败（未装 wheel，`PLOTKIT_MOUNTED=False`），`/plotkit/` 恒 404。`netlab/plotkit_bridge.py` 新增 `ensure_plotkit_importable()`（env `NETLAB_PLOTKIT_SRC` → 同级 `PlotKit/src` 多级探测）并在 `mount()` 前调用；实测 `/plotkit/` 200、`/plotkit/api/meta` 200。
- **三种呈现形态**：PlotKit 页签改为「嵌入此处 / 浮出窗口 / 独立窗口」三按钮（`#btnPlotkitInline` / `#btnOpenPlotkit` / `#btnPlotkitPopup` + `#plotkitInlineHost`），`frontend/app.js` 新增 `ensurePlotkitFrame()` / `placePlotkit(mode)`；浮窗头加「↗ 独立窗口」。
- **结构整理（D79）**：`netlab/static` → `NetlabHome/frontend`；后端内核拆 `netlab/core/{compute,model,common}`，旧路径保留转发 shim；`tools/reorg_core.py` 可重放。359 passed。
- **步进优化**：`capture_checkpoint` 里的 `copy.deepcopy` 是单步最大热点（cProfile：占电路单步约 41%）。新增 `netlab/core/common/fastcopy.py::copy_state`（不可变标量原样、ndarray `.copy()`、容器递归、未知对象 deepcopy），`nodal._capture_element_state`/restore 与 `graph._state_snapshot` 改用它。基准 `tools/bench_step.py`（1200 步中位数，A/B 同机）：

| 模板 | 优化前 µs/步 | 优化后 µs/步 | 提升 |
| --- | ---: | ---: | ---: |
| rlc_series | 166.1 | 123.3 | −26% |
| rc_step | 139.4 | 113.8 | −18% |
| diode_rectifier | 320.1 | 263.4 | −18% |
| controlled_source | 142.0 | 110.5 | −22% |
| signal_chain | 24.9 | 20.2 | −19% |
| nonlinear_control | 95.3 | 80.8 | −15% |
| opamp_inverting | 279.4 | 259.4 | −7% |
| common_collector | 317.6 | 278.5 | −12% |

- **测试**：新增 `test_fastcopy.py`（5 条）与 `test_structure_layout.py`（11 条：frontend 目录齐全、server 解析 frontend、7 个旧路径 shim 仍转发、core 不得 import server/desktop 的 AST 扫描、plotkit 路由）→ 全量 **375 passed**。
- **文档**：`ARCHITECTURE.md`（根）整篇重写并嵌[结构图](docs/assets/netlab-structure.svg)；`netlab/docs/ARCHITECTURE.md` §2 按新结构重写；新增 `netlab/docs/CODE_GUIDE.md`（425 行，模块清单/符号索引/14 跳调用链/file:line 证据）与 `netlab/docs/MATH.md`（722 行，MNA/伴随模型/Newton/状态空间/Q4 FEM/器件/数字/磁性）；README/INSTALL 路径同步。
- **微优化（第二轮，噪声内）**：`_equilibration` 只取一次 `np.abs(matrix)`（原来整矩阵 abs 两次）；`_check_floating` 只在第 0 次 Newton 迭代执行（悬空是拓扑属性，与迭代无关）。定点 A/B（5 次中位数）：common_collector 298→279 µs、rlc 209→183 µs、diode 298→333 µs（该模板波动大）。结论：正向但幅度在噪声边缘，收益远小于第一轮的 `copy_state`；后续真正的提升点已不在 Python 侧的小函数，而在 ①线性电路复用 `lu_factor` 之后的 `_solve_matrix` 固定开销（4×4 电路仍 ~120 µs/步，numpy 小矩阵调用开销为主）②前端重绘。
- **代码质量**：`python -m pyflakes netlab/core netlab/server.py netlab/plotkit_bridge.py` 现在零告警（清掉 13 处未用 import/变量、修正 blocks.py 里 `field` 被循环变量遮蔽、scene.py 两处无占位符 f-string、删除 blocks.py 一个多余局部 import）。`netlab/desktop/{app,main_window,bridge}.py` 是 D78 前的旧 Qt 壳，已无人引用（`__main__` 只走 `webview_app`），留作死代码待清理，未在本轮删除。

### 7.35 第二轮性能与启动优化（2026-11-02）

| 优化 | 位置 | 机制 | 效果（A/B 交替、5 次中位数） |
|---|---|---|---|
| LU 复用带均衡因子 | `core/compute/nodal.py::_solve_matrix` | 缓存命中时直接用缓存的 row/col scale，跳过整矩阵 abs 与两次除法；缓存判定提到均衡之前 | rlc 125→108 µs/步，common_collector 273→235 µs/步，diode 262→250 µs/步（结果按位相同，见下） |
| SciPy 按需导入 | `core/compute/nodal.py::_load_scipy` | `import scipy.linalg` 需 200~300 ms，信号/矢量模式不需要；改为构造电路求解器时才加载 | `import netlab` 1047 ms → 265 ms；`--selftest` 端到端 2.71 s 不变（桌面本来就用到电路） |
| 桌面包惰性入口 | `netlab/desktop/__init__.py` | PEP 562 `__getattr__`，导入包不再拉 `app`（Qt 回退入口） | 语义更正确；Qt 壳仍可 `python -m netlab.desktop.app` 手工使用 |

数值等价性：`rlc_series / diode_rectifier / common_collector` 各跑 300 步后
`Scene.to_payload(include_state=True)` 的 SHA-256 前缀在优化前后完全一致
（`cdeb869ce37a2118` / `e92c51343e712821` / `6236a7eaa997d7c6`）。

### 7.36 数据结构与数据通路审计与优化（D80，2026-11-02）

用户要求「检查当前数据结构，数据传递路径，分析并优化，这些也写在之前的原理架构文档中」。
审计结论与实测（`time.perf_counter` 中位数，护栏 `netlab/tests/test_data_path.py`）：

| 热点 | 改前 | 改后 | 手段 |
|---|---|---|---|
| 600 帧 × 7 探针响应序列化 | `jsonable_encoder` 10.6 ms | 1.6 ms | `/api/live`、`/api/state`、`/api/fem/state|live`、`/api/scene/export` 改走 `server.fast_json()`（跳过逐字段编码） |
| 同一响应字节 | 131,756 B | 120,247 B | `separators=(",",":")` + `ensure_ascii=False` |
| 204 节点场景序列化 | 6.3 ms | 0.5 ms | 同上 |
| `Recorder.since` 3 帧增量（容量 5000） | 52 µs | 0.8 µs | `reversed(deque)` 反向收集、`seq<=cursor` 即停 |
| `Recorder.keys()` | 每次重建 | 0.2 µs | 探针集合不变时复用；`push` 比对、`clear` 清空 |
| `to_payload(include_state=False)` 204 节点 | 1.74 ms | 1.07 ms | `snapshot(include_state=False)` 不再深拷贝 `state`/`inputs` |
| 前端 `drawChart` 5000 帧 | 每帧从 0 扫 | 二分定位窗起点 + 每像素 >4 点抽稀 | 只影响绘制，保留末点，不改原始数据 |
| 前端无新帧轮询 | 全量刷 DOM | 只刷状态条 | `pollLive` 在 frames 空且未重置时跳过重活 |

数据通路：`求解线程 → Recorder(deque 1200) → /api/live?cursor=N → fast_json → 前端 pollLive(110ms) → ingestFrame → state.frames(≤5000) → drawChart(70–80ms 节流)`。

文档：`netlab/docs/ARCHITECTURE.md` 新增 **§13.5 数据结构与数据通路**（结构表、载荷表、通路图、实测表、有意保留的开销）；根 `ARCHITECTURE.md` §6 加实测摘要与链接。

验收：**380 passed / 3 skipped**（新增 5 条数据通路测试）；`/api/state`、`/api/live?cursor=0&limit=600`、`/api/scene/export`、`/api/catalog` 全部 200 且 JSON key 结构不变；前端静态版本 3.15.3（`node --check` 通过）。

### 7.37 R26 补上 UI 入口：DC 工作点 / AC 扫频浮窗（2026-11-02）

背景：R26 的求解器能力 2026-10-28 就完成了（`operating_point()` / `ac_sweep()` + `GET /api/operating-point`、
`GET /api/ac-sweep`），但「现状」一直记着「UI 未接图表入口，只有 API」，用户看不到工作点与 Bode 曲线。

本次补齐（前端，后端零改动，`frontend/` 三个文件）：

| 位置 | 内容 |
|---|---|
| 工具菜单 | 新增「DC 工作点（.op）」「AC 扫频（Bode）…」，分别打开同一个自定义浮窗 |
| `#analWin` 浮窗 | 复用 `initFloatWindow`（拖动/缩放/最小化/最大化），两页签：DC 工作点 / AC 扫频 |
| DC 工作点页 | 「求解工作点」→ `GET /api/operating-point`，两张表：节点电压；元件 电流/端电压/功率；页脚显示迭代步数、矩阵阶数、残差、稠密/稀疏 |
| AC 扫频页 | 激励源下拉（自动从当前场景的 vsource/isource 生成）、f 起/止、点数、对数/线性；「开始扫频」→ `GET /api/ac-sweep`；双区 Bode 图（幅值 dB 上、相位 ° 下），逐曲线配色 + 图例 |
| 默认探针 | 只取 `kind==='node'` 的节点（**ground 会被后端判为「AC 探针不存在」，必须排除**） |
| 失效策略 | `applySnapshot` 里比较 `scene.revision`，电路变了就把旧扫频结果置空并提示「电路已变化，请重新扫频」 |
| Esc | 按 Esc 关闭电路分析浮窗（与文档窗/设置窗一致） |

护栏：新增 `netlab/tests/test_ui_analysis_entry.py` 3 条（index 里有 `#analWin`/两页签/画布；app.js 调两个端点且菜单有入口；AC 默认探针块只含 `node`、不含 `ground`）。

验收：**383 passed / 2 warnings**；离屏 QtWebEngine 实测（端口 8125 临时 uvicorn + `rlc_series` 模板）：
DC 工作点 2 张表 8 行、meta「迭代 1 步 · 矩阵 4 · 残差 0 · 稠密」；AC 扫频 meta「3 条曲线 · 激励 V1 · 121 点」，
画布 1286×719、有效笔迹像素 52,221，图例 `src / mid / out`，无 JS 报错。
静态资源版本 3.15.3 → **3.15.4**（index.html 两处 `?v=`），`node --check` 通过。

### 7.38 修 PlotKit 面板「卡顿」：三处真 bug + 渲染节流（2026-11-02，D81）

用户原话：「继续完成，并且检查解决plotkit卡顿的问题」。测得三件事：**不是网络问题，是渲染太贵 + 两处长度错位导致曲线卡死 + 面板藏起来还在出图**。

| # | 根因（实测证据） | 修法 |
|---|---|---|
| 1 | **中途出现的通道让数据集长度错开**：开跑后才出现的探针（如 `e:V1:power`）从 0 长度起追加，`t` 却在涨 → `ValueError: 图层 x/y 长度不一致: 2424 vs 88`，整张图停止更新（用户看到的就是"卡住"）。 | `plotkit_bridge._ensure_channels` 新通道先 `np.full(len(t), nan)` 补齐；`_ingest` 每次 push 前把所有序列对齐到 `len(t)`（短补 NaN、长裁剪）。 |
| 2 | **读写出图与写入并发**：0.5 s 的同步线程在 push/trim，出图线程在整批读，读到"t 已加、曲线还没加"的中间态 → `20232 vs 20000` 同样报错。 | `plotkit/store/registry.py` 新增模块级 `DATA_LOCK`（RLock）；`_sync_loop` 的 `_ensure_channels`/`_ingest`/`_reset` 与 PlotKit 的整个 `build()` 用同一把锁互斥；同时把渲染串行化（`_RENDER_LOCK = DATA_LOCK`），避免多个 200 ms 渲染排队积压。 |
| 3 | **出图成本高、频率还高**：6 条曲线 528 点时 `figure.render` 900×520 = 72 ms、1200×700 = 149 ms、1600×950 = 191 ms、2400×1400 = 308 ms；matplotlib 是纯 Python+C 且持解释器锁，实测把 `scene.step` 从 122 µs 拖到 138–207 µs。原来 500 ms 轮询 + 每有新版立刻全量重绘 + 拖动时每 70 ms 半清预览，面板几乎在连续出图。 | ①`renderUrl` 按面积上限 1400×1000 等比缩小；②实时自动重绘节流到 `LIVE_MIN_MS=1000`（合并排队，只保留最后一次）；③轮询 500→1000 ms；④拖动预览 70→160 ms、缩放 0.55→0.5；⑤`plotVisible()`（`offsetParent`/`clientWidth`）+ `document.hidden` + 宿主 `postMessage({type:'plotkit-visibility'})` 三路判可见，看不见就完全停；⑥同步线程 0.2→0.5 s。 |
| 4 | **面板先于仿真打开 → 永远「0 个图层」**：spec 只在启动时取一次，后端后来补的 layer 前端不再拉，看起来像没画出来。 | `poll()` 里若 `state.spec.layers.length === 0` 就重取 `api/spec`，有图层则重渲染并 `refreshTimeInfo()`。 |

实测（`_verify2.py`/`_verify3.py`，离屏 QtWebEngine + 临时 uvicorn + `rlc_series`）：

| 场景 | `/plotkit/api/render` 请求 / 8 s |
|---|---|
| 面板可见（inline） | 8（≈1 Hz，原来 ≈2 Hz） |
| 切到「信号」页签（面板隐藏） | **0** |
| 切回「绘图」页签 | 8 |
| 浮窗模式打开 → 关闭浮窗 | 8 → **0** |
| 空场景先开面板，再载模板开跑 | 0 图层 → 6 图层 + 有图，全自动恢复 |

护栏：新增 `netlab/tests/test_plotkit_bridge_sync.py` 2 条（新通道补齐后所有序列与 `t` 等长且补的是 NaN；人为制造 `t` 多两帧的错位后 `_ingest` 仍能对齐且 `render` 不抛）。

验收：netlab **385 passed**（383 + 2）；PlotKit **436 passed**；服务端日志 0 error；静态版本 3.15.4 → **3.15.5**（index.html 两处 `?v=`），两个 `node --check` 通过。

### 7.39 无边框窗口拖不动（D82，2026-11-02）

**现象**：无边框改造后用户反馈「没法拖动窗口」。

**根因**：用 `easy_drag=True` + `webview.settings['DRAG_REGION_DIRECT_TARGET_ONLY']=True`，拖动只认 `.pywebview-drag-region` 的**命中元素本身**；而垫片只给 `.brand` 及其子元素加了类，顶栏空白处/其他区域命中 `#topbar` 就不匹配，于是"点哪都拖不动"。另外垫片在 `DOMContentLoaded` 时取 `window_rect()`，此时 `window.pywebview` 还没注入，rect 一直是 null。

**修法**：改为**页面自绘拖动**（不依赖 easy_drag）。
- `desktop-shim.js`：`#topbar` 上 `pointerdown/pointermove/pointerup`，排除 `button/input/select/textarea/a/label/[role=tab]/#nlWinCtl` 等交互控件；按下时记 `screenX/screenY` 与窗口左上角，移动时 `window_move_to(x0+dx, y0+dy)`（requestAnimationFrame 合并）；`pywebviewready` 与 `pointerenter` 时刷新窗口 rect；空白区双击仍切最大化。
- `webview_bridge.py`：新增 `window_rect()` / `window_move_to(x, y)`。
- `webview_app.py`：`easy_drag=False`（避免两套机制同时移动窗口）。
- 垫片注入加版本号 `?v=3.15.6`，静态资源版本 3.15.5 → **3.15.6**。

**验证**：pywebview 实测 `window_rect()=[176,176,1186,763]`；派发 `pointerdown(500,300)` → `pointermove(640,400)` 后窗口变为 `(316,276)`，位移正好 +140/+100；`pointerup` 后继续 move 不再移动。护栏 `netlab/tests/test_desktop_drag.py` 4 条。

### 7.40 内嵌 PlotKit 接入探针数据 + 无边框窗口四边缩放（D83，2026-11-02）

**需求**：用户「嵌入 plotkit 要能接入节点数据，并且窗口可以鼠标缩放」。

**数据接入**
- 后端：`plotkit_bridge.selected_channels()`（回显当前在画的通道）；`server.py` 新增 `GET/POST /api/plotkit/channels`（列举 recorder/PlotKit 里的探针通道；POST `{keys:[...]}` 调 `plotkit_bridge.set_channels`，空数组=恢复自动发现）。
- 前端：`#tab-plotkit` 顶部新增「数据接入」折叠条 —— 通道复选列表（`n:src:voltage` 显示为 `src.voltage`）、全选/清空/**按选中节点**/接入；接入后重载 `#plotkitFrame` 让新 spec 生效；绘图页签激活时与每 5s 刷新一次通道。

**窗口缩放**
- `webview_bridge.window_resize(x, y, w, h)`（`window.resize` + `window.move`）。
- `desktop-shim.js` 新增 `installResize()`：八向透明手柄（`n/s/e/w/ne/nw/se/sw`，5–10px，各自光标），拖动按方向改 x/y/w/h，最小 1100×700，rAF 合并调用 `window_resize`。

**验证**
- `GET /api/plotkit/channels` 跑 1s 后返回 6 条通道；`POST {keys:[前2条]}` → `selected` 正好这 2 条；空 keys 恢复 6 条。
- 真机 pywebview：`.nl-resize` 手柄 8 个；派发 `pointerdown`+`pointermove(+100,+80)` 于 `se` 手柄后窗口 `1186×763 → 1285×842`。
- 前端：预载 `rlc_series` 跑 2672 步后，面板列出 6 条通道；勾 2 条点「接入」→ 提示「可选 6 条通道，当前画 2 条」。
- 新增测试 `test_plotkit_channels.py` 2 条、`test_desktop_drag.py` +2 条。

### 7.41 PlotKit 内置进 netlab + 开始页可拖动 + 控件悬停动效（D84，2026-11-02）

**需求**：用户「plotkit 还要独立下载，请把 plotkit 包括在 netlab 的安装里面，并且可独立安装与卸载；开始界面还不可以拖拽；增加鼠标放在可动按键上的 UI 动效」。

**1. PlotKit 内置（不再要求单独下载）**
- 新模块 `netlab/plotkit_vendor.py`：`status() / install(src, force) / uninstall() / vendor_path()`；CLI `python -m netlab.plotkit_vendor status|install|uninstall [--src --force]`。
- 内置目录 `netlab/_vendor/plotkit`（本次实装 54 文件 / 678 KB，版本 0.2.0，来源 `PlotKit/src/plotkit`）。
- `plotkit_bridge.ensure_plotkit_importable()` 优先用内置副本（`vendor_path()` 排第一），其次 `NETLAB_PLOTKIT_SRC`、再仓库源码目录；`import plotkit` 实测解析到 `netlab/_vendor/plotkit/__init__.py`。
- 卸载后自动退回「外部安装 PlotKit」模式；打包时把 `netlab/_vendor` 一起带上即可随安装包分发。

**2. 开始页（引导卡）可拖动**
- `initGuide()` 里给 `.guide-top` 绑定 pointer 拖动，位移写到 `.guide-card` 的 `transform: translate(...)`；排除按钮/链接/输入等交互元素，pointerup/cancel 收尾。无边框窗口下也能把挡住的地方挪开。

**3. 控件悬停动效**
- `style.css` 统一 `button/.btn/.ghost/.primary` 的 `transition`（background/border/color/shadow/transform）；hover 上浮 1px + 投影、active 回落 + 内投影、`:focus-visible` 描边；并补 `.ghost/.primary` 独立样式。
- `html[data-motion="off"]` 下全部动效关闭（尊重设置里的「动效程度」）。

**验证**：`test_plotkit_vendor.py` 3 条（状态/安装-覆盖-卸载/仓库确实自带副本）；静态版本 3.15.7→3.15.8。

### 7.42 清理包根：删除 33 个兼容 shim，引用全部改规范路径（D85，2026-11-02）

**需求**：用户「netlab中程序文件还是一片混乱，按架构与功能分好类，并且注意程序直接的引用也要对应修正，避免bug」。

**做法**
- 删除 `netlab/` 包根 33 个 1KB 转发 shim（D79 由 `tools/reorg_core.py` 生成的过渡产物）。
- 脚本全仓库改写 import：`from .scene import X` → `from .core.model.scene import X`；`from netlab.graph import X` → `from netlab.core.model.graph import X`；`from netlab import accel` → `from netlab.core.compute import accel`；`desktop/*` 用 `from ..core.model.project import X`。共 45 + 17 个文件（含 tests/tools）。
- 修两处遗漏：`server.py:730` 函数内 `from . import blocklib` → `from .core.model import blocklib`；`test_device_nodes.py:227` 动态 `__import__("netlab.ports")` → `netlab.core.model.ports`。

**现在包根**：`__init__.py`、`server.py`、`run.py`、`plotkit_bridge.py`、`plotkit_vendor.py`、`vscode_bridge.py` + `core/ desktop/ tests/ docs/ tools/ _vendor/`。

**护栏**：`test_structure_layout.py` 用两条测试守住 —— 包根不得出现未分类 .py；AST 扫描全仓库不得再引用已删旧路径（含 `from . import x` 与字符串动态导入）。

**文档**：根 `ARCHITECTURE.md` 目录树与 §8 依赖规则、`netlab/docs/ARCHITECTURE.md` §2、`netlab/docs/CODE_GUIDE.md` §6 已同步改写（删掉“兼容 shim”口径）。

**验收**：`pytest netlab/tests -q` → 391 passed。

### 7.43 PlotView：PlotKit 改为「只登记数据 + 前端自绘 + 定格导出」（D86，2026-11-02）

**背景**：用户反馈内嵌 PlotKit 有三个硬伤 —— ①回放/缩放走服务端 matplotlib，单帧 20 s 级；②接入后自动把曲线画出来，用户想自己拖图层；③2D 类型只接了 3 种、子图与图层参数不全。经 6 轮 grilling 定案（数据与渲染解耦、保留 PlotKit 前端但统一到 netlab 风格、接入前强制预计算、全部 2D 类型前端自绘）。

**改动**
- `PlotKit/src/plotkit/static/render2d.js`（新增，约 900 行，`window.Plot2D`）：canvas 2D 渲染器，负责坐标/刻度/网格/图例/轴标题与 23 种 kind（line step stairs stem marker scatter points bar barh segments area hist ecdf boxplot violinplot violin pie hexbin quiver table heatmap image contour contourf），`pick()` 支持悬停取值。
- `PlotKit/src/plotkit/server/app.py`：新增 `GET /api/column?name=&pixels=`（单列 float32 + 保首尾抽稀，`_binary_field` 复用）。
- `PlotKit/src/plotkit/static/{app.js,index.html,app.css}`：`#plotCanvas` + 前端渲染路径（`clientRenderable`/`ensureSeries`/`renderClient`/`replayRender`）；滚轮以光标为锚缩放、拖拽平移、双击复位；图层编辑器扩到「图型/颜色/子图/数据/图例/线宽/线型/点形/点大小/不透明度/图例开关/X-Y 范围/X-Y 刻度/网格/Y 轴翻转」；新增「画布与子图」组（标题/列数/子图数/X-Y 轴名）；design token 与 netlab 统一（纸色底、墨色字、赭石强调）。
- `netlab/plotkit_bridge.py`：`MAX_CHANNELS 6→64`；`set_channels()` 只登记数据集、**不再自动建图层**；`build_figure/_ensure_channels` 去掉 `add_plot`。
- `netlab/server.py`：新增 `POST /api/plotkit/precompute {seconds}`（内部 `Simulation.precompute`，按 duration/2000 放大步长避免爆步数），接入前强制预计算。
- `netlab/frontend/app.js`：`applyPkChannels()` 先预计算再登记（按钮禁用 + 进度提示）；`analysisWarn()` 在 DC/AC 分析前弹提醒（不阻断）。

**实测**
- 前端渲染 20 次连续 `renderClient` 平均 **1.46 ms/帧**（旧服务端 72–308 ms/帧；回放单帧 20 s 级）；滚轮缩放 1.4 ms。
- 23 种 kind 全部可渲染（无异常；heatmap/contourf 先修了 `item.min/max` 未赋值导致的 `stops[i].map` 崩溃）。
- 双子图（`figure.subplots=2`）前端渲染出 2 个坐标轴；`/api/column` 二进制为 `PK01 + meta_len + n + meta + float32*n`，3 点抽稀保首尾。
- netlab **393 passed**；PlotKit `tests/test_api.py` 17 passed + 新增 `tests/test_api_column.py` 3 passed。

**边界**：contourf 目前按网格色块近似（无等值线路径）；streamplot/3D 系列仍回落服务端渲染（仅定格导出）。

**坑**：PlotKit 静态文件改动后必须 `python -m netlab.plotkit_vendor install --src ../PlotKit/src/plotkit --force` 同步内置副本，否则 netlab 里加载的是旧 JS（现象：`window.Plot2D undefined`）。

### 7.44 性能减负：网格 pattern、帧上限自适应、面板不可见不采样（D87，2026-11-02）

**背景**：用户反馈「运行卡顿感很强」，要求查冗余与重复执行。先量化再动手：后端数据通路全在 10–250 µs 量级（`live(增量3帧)` 11 µs、`live(0,600)` 241 µs、`snapshot()` 64 µs），不是瓶颈；浏览器侧在无 GPU（`--disable-gpu` 软件光栅）下 p50≈190 ms/帧且每帧 80 ms long task，去掉 `--disable-gpu` 后 p50=16–17 ms（60 fps）—— 说明「卡」主要来自无 GPU 环境的合成开销，但 `drawGraph()` 自身仍有可省之处。

**实测（QtWebEngine，`window.__graphMs` 采样）**

| 项 | 前 | 后 | 倍数 |
| --- | --- | --- | --- |
| drawGraph 7 节点 | 6.1 ms | **1.9 ms** | 3.2× |
| drawGraph 127 节点 | 20.6 ms | **8.8 ms** | 2.3× |
| 面板关闭时 PlotKit 采样 | 每 0.2 s 空转（数据集无限增长） | **0** | — |

**改动**
- `frontend/app.js`：`gridPattern(step,dpr,color)` 用离屏 tile + `createPattern('repeat')` 缓存，`drawGrid` 一次 `fillRect`（原 3150 次 1×1 fillRect）；`frameCap()` 按探针数自适应 `min(5000, max(600, 250000/键数))`；`updateInspectorLive/updateSignalListValues/updateLegendValues` 面板不可见时直接返回；`pollLoop` 在 `document.hidden` 时降到 1000 ms；`/api/state` 轮询 4000→8000 ms。
- `netlab/plotkit_bridge.py`：`_ACTIVE = threading.Event()` + `set_active/is_active`，`_sync_loop` 不活跃时 `wait(0.5)` 跳过采样。
- `netlab/server.py`：`POST /api/plotkit/active`；静态版本 3.16.1。
- `frontend/app.js` 的 `notifyPlotkit(visible)` 同步把可见性 POST 给后端。

**验证**：新增 `netlab/tests/test_plotkit_active.py` 3 条（端点开关、不可见不采样、可见恢复采样）；全量 **396 passed**；画布截图确认网格/节点/连线正常。

### 7.45 PlotKit「接不进节点」修复 + 缓存体检与安全清理（D88，2026-11-02）

**用户反馈**：面板仍然提示「PlotKit 未挂载」、数据接入 0 条，无法按节点选数据源；另问「能不能自动检查清理缓存，但是保证数据安全」。

**根因（两条，都是真 bug）**
1. 通道列表只取 `plotkit_bridge.channels()`（= 已登记到 PlotKit 的数据集），而登记发生在「接入」之后 → **仿真未运行/未接入时永远 0 条**，看起来像"接不进去"。现在 `/api/plotkit/channels` 额外返回 `available` = `SERVICE.scene.probes().keys()`（**不运行也能列出场景探针**），前端优先用它渲染。
2. 挂载状态是 import 期算死的布尔量，一旦首次失败（依赖顺序/路径）就永久 `False`，且提示只有一句"未挂载"。现在：`plotkit_bridge` 记录 `_LAST_ERROR` 与候选路径，新增 `diagnose()` 与 `remount()`；`/api/plotkit/channels` 在未挂载时**再试一次 remount（自愈）**，并返回 `diag.last_error`；面板新增「重试」按钮。

**缓存体检与安全清理（新增 `netlab/cache_guard.py`）**
- 三档：`safe`（`.plotkit`、`%TEMP%/plotkit-*`、`__pycache__`、`.pytest_cache`）、`caution`（`.plotkit-desktop` WebView2 用户数据：会重置面板宽度等界面偏好）、`protected`（`*.netlab`、`autosave.netlab`、`docs/`、`exports/`、`_vendor`、settings/window.json —— 永不删除）。
- 默认 **dry-run**；`clean()` 删前校验：档位、保护名单、路径深度（拒删根/家目录）、最近写入时间。
- 入口：`python -m netlab.cache_guard status|clean [--yes --caution]`；HTTP `GET /api/cache/status`、`POST /api/cache/clean`；工具菜单「缓存体检与清理…」弹窗（列出每项大小、只删安全档、谨慎档要二次确认）；启动 6 秒后静默体检，安全档 >300 MB 才提示，不自动删。

**验证**：停止态 `available` 16 条 → 全选接入后 `channels/selected` 16 条；页面 UI 提示「场景共 16 条探针…」；缓存弹窗可打开并列出条目；`test_cache_guard.py` 7 条 + `test_plotkit_channels.py` 新增 3 条；全量 **405 passed**；静态 3.16.2、`server.py` 垫片版本同步。

### 7.46 运行前「建议预计算」对话框（D89，2026-11-02）

用户：「这里点击运行后先弹出警告，建议预计算，并且在里面可以设置预计算的时间窗口」。

- 点顶栏「运行」（或空格、菜单「运行 / 暂停」）且当前是停止态时，先弹 `#runWarnWin`：
  说明"实时运行只登记探针、面板不会边算边画"，给「预计算时间窗」输入（1–120 s，快捷 1/5/10/30）。
- 三个出口：**预计算并接入**（`POST /api/plotkit/precompute {seconds}`，显示耗时/帧数，完成后自动切到「绘图」页并刷新通道）、**直接运行**、**取消**。
- 勾「以后不再提示」写 localStorage 偏好 `runWarn=false`（`state.prefs`，不入服务端 settings）；「重新求解」内部流程用 `control('run', undefined, {skipWarn:true})` 绕过。
- 实测：3 s 窗预计算 → 自动跳页、16 条通道可画；「直接运行」→ `/api/health` running=true；409 passed。版本 3.16.3。
### 7.47 运行/预计算分离 + 两处配色修正（D90，2026-11-03）

用户：「运行与预计算分开，若已经有了预计算数据，有了对应时间轴数据，运行不再报弹窗，并且写时间的输入口字体颜色过淡，看不清；还有拖拽选中区域的框是全黑的，请改成有大约 70–80% 的透明度类似的」。

- `frontend/app.js`：新增 `hasPrecomputed()`（`state.precomputedSeconds` 已设，或录制帧跨度 ≥ 时间窗 90%），`control()` 的运行前拦截多一个 `!hasPrecomputed()` 条件；「预计算并接入」成功后写 `state.precomputedSeconds`。仿真菜单新增独立项「预计算数据…」（只开对话框、不运行）。
- 预计算时间窗输入框：显式 `background:#fff; color:#111814; -webkit-text-fill-color:#111814; font:600 14px`，不再继承主题浅色。
- `drawSelectionBox()`：改为固定半透明（深色主题 `rgba(197,161,107,.16)` / 浅色 `rgba(168,84,31,.10)`，边线 .70/.65），不再走 `C()` 的 legacy 映射（该映射在深色下会退化为近黑实心）。
- 实测：点运行弹窗、填 3 s 预计算后再次点运行 **不再弹窗**（`dialogAfter:false`）；输入框 computed `color rgb(17,24,20)`、`font-weight 600`；深色主题框选区域中心像素 `rgba(199,162,106,41)`（约 16% 透明叠加，非黑）。另补：场景被重置/替换（`resetFrames` 或 `scene.revision` 变化）时清 `state.precomputedSeconds`，恢复首次运行提示——实测 `afterPre:false`、`afterReset:true`。版本 3.16.5；全量 **409 passed**。

### 7.48 PlotKit 桌面 token 误报修复（2026-11-03）

**症状与根因**：桌面 API 由 `X-Netlab-Token` 守卫保护；PlotKit 数据条此前有原生 `fetch('/api/plotkit/...')` 绕过 `api()`，导致请求收到 403，却在刷新/重试中被解释为未挂载或空列表。

**改动**
- `frontend/app.js`：通道刷新、重试、预计算、POST 接入与运行前预计算统一经 `api()`，复用桌面 token；刷新/重试失败显示明确错误，空缓存时列表显示加载失败态，不再误报真实无探针；刷新返回明确结果，避免二次刷新失败后仍 toast「PlotKit 已就绪」；保留服务端真实 `mounted:false` 诊断。
- 独立只读审查发现重试流程有“刷新失败仍提示就绪”的边界错误，已添加 `test_retry_does_not_report_ready_when_channel_refresh_fails` 回归测试并修正。
- 新增 `netlab/tests/test_plotkit_frontend_auth.py`：静态护栏检查 helper/token、无 PlotKit 原生 fetch、错误/空态文案；集成验证 token 缺失为 403、携 token 可读取 mounted/available。
- `netlab/tests/test_run_warn.py`：确认运行前预计算走 helper 且显示失败原因。
- 静态资源版本同步到 3.16.6（`UI_BUILD`、`APP_BUILD`、`index.html` 两处 query）。规格见 `docs/specs/2026-11-03-plotkit-desktop-token.md`。

**验证**
- 定向：`python -m pytest netlab/tests/test_plotkit_frontend_auth.py netlab/tests/test_plotkit_channels.py netlab/tests/test_run_warn.py -q` → 14 passed, 1 warning。
- 全量：`python -m pytest netlab/tests -q` → 413 passed, 3 warnings；pytest 结束阶段可重复输出 Windows `fatal exception: code 0xc0000139`，堆栈涉及 `plotkit_bridge._sync_loop` 与 sympy/gmpy2 导入，命令退出码 0，但进程关闭异常仍未解决。
- 已完成收尾：`python -m compileall -q netlab` 退出 0（仅有 vendored PlotKit `SyntaxWarning: invalid escape sequence '\s'`）；`python -m netlab.desktop --selftest` 退出 0，后端 URL status 200、shim 注入及 status 均 200；备份 8 个本次修改文件及 `MANIFEST.sha256` 至 `NetlabExtras/backups/ProjectPoint_backups/netlab_plotkit_token_20261103_1253/`。

### 7.49 PlotKit 预计算后无法播放 + 拖拽打断播放（2026-11-03）

**症状**：netlab 预计算完成、PlotKit 数据条也能列出通道，但点播放游标不动。

**根因（实测）**：`PlotKit/src/plotkit/backends/series.py::time_bounds()` 只遍历图层 `x` 数据算时间范围；netlab 按 D-PlotView 只登记数据集、不自动建图层，于是 `/plotkit/api/meta` 返回 `time: {min: null, max: null, count: 600}`，前端 `playStep()` 在 `min == null` 时恒返回 0。

**改动**
- `PlotKit/src/plotkit/backends/series.py`：`time_bounds()` 在图层范围为空时回退到 `role="coord"` 数据集（新增 `_numeric_bounds` / `_layer_time_bounds` / `_coord_time_bounds`）。
- `PlotKit/src/plotkit/static/app.js`：拖动面板宽度时只改 CSS 不再逐帧重绘（重绘占 `state.busy`，`tickPlay` 在 busy 时跳过推进，表现为"一拖就断播"），松手后重绘一次。
- `PlotKit/src/plotkit/static/index.html` + `app.js`：「布局」分组新增「复位面板宽度」按钮，等价于原来隐藏的双击 grip。
- 版本 3.16.6 → **3.16.7**（`frontend/app.js` UI_BUILD、`netlab/server.py` APP_BUILD、`frontend/index.html` 两处 query）；`python -m netlab.plotkit_vendor install --force` 已同步内置 PlotKit（55 文件）。
- 规格与后续四件（独立图层面板 / 子图自由布局可重叠 / 批注）见 `PlotKit/docs/specs/2026-11-03-canvas-free-layout-annotations.md`；PlotKit 需求表新增 PK-R17…PK-R21。

**验证**
- 新回归（先红后绿）：`PlotKit/tests/test_window.py::test_time_bounds_falls_back_to_coord_data_without_layers`（红：`Obtained: None`；绿：`(0.0, 2.0)`）；`netlab/tests/test_plotkit_channels.py::test_plotkit_meta_has_time_range_after_precompute`。
- 实测：预计算 1 s → `/plotkit/api/meta` 的 `time = {'min': 0.0005, 'max': 1.0, 'count': 600}`。
- 定向：`python -m pytest netlab/tests/test_run_warn.py netlab/tests/test_plotkit_channels.py netlab/tests/test_plotkit_frontend_auth.py -q` → 15 passed, 1 warning。
- 全量：`python -m pytest netlab/tests -q` → **414 passed, 3 warnings**，退出码 0；结束阶段仍输出 Windows `fatal exception: code 0xc0000139`（§7.48 已记录的既有问题，未解决）。

### 7.50 PlotKit 子图自由布局（PK-R20）+ 桌面垫片版本号单一来源（2026-11-03）

**用户要求**（原话，`PlotKit/docs/specs/2026-11-03-canvas-free-layout-annotations.md`）：「先P4 ，然后3，最后5，记得更新文档」——本轮做 P4 子图自由拖拽/可重叠。

**改动**
- `PlotKit/src/plotkit/backends/mpl_backend.py`：抽出模块级 `_grid_rect(index, ncols, nrows, *, top=0.95)`（left=0.085/right=0.97/bottom=0.10）；`to_figure()` 解析可选 `figure.layout = [{slot, rect:[x,y,w,h]}]`（figure 比例，y 从下往上，允许重叠），命中槽位走 `fig.add_axes(rect)` 并 `set_layout_engine("none")`；没写 layout 时仍 `add_subplot`，渲染与改前一致。
- `PlotKit/src/plotkit/spec/validate.py`：`KNOWN_FIGURE_KEYS` 加 `layout`，并校验数组/项/slot 非负整数不重复/rect 4 数且 w、h>0/范围 -0.5…1.5。
- `PlotKit/src/plotkit/api/native.py:319`：`update_layout` 白名单加 `layout`。
- `PlotKit/src/plotkit/static/app.js`：「布局」组新增 `#btn-free-layout` / `#btn-grid-layout`；`layoutList()`、`gridRectFor()`、`enableFreeLayout()`（优先用服务端 `X-PlotKit-Axes` 包围盒 materialize）、`disableFreeLayout()`、`trimLayoutTo()`、`renderLayoutOverlay()`（虚线框拖动/拖角缩放，松手 `commit("拖拽子图"/"缩放子图")`，三位小数）；关键坑：前端 canvas 渲染不写 `state.img`，自由布局必须强制走服务端渲染（`redraw()` / `replayRender()` 的 `clientRenderable(state.spec) && !layoutList().length`），`renderClient` 成功后补 `renderLayoutOverlay()` 防「回到网格」后残框。
- `PlotKit/src/plotkit/static/index.html` / `app.css`：`#layout-overlay`、`.layout-box` 等样式与提示。
- `NetlabHome/netlab/server.py:401`：desktop-shim 的 `?v=` 改为 `f"...?v={APP_BUILD}"`——此前写死 `3.16.5`，每次 bump 都会漏改（P4 全量跑出红测才发现）。
- 版本 3.16.7 → **3.16.8**（`frontend/app.js` UI_BUILD、`netlab/server.py` APP_BUILD、`frontend/index.html` 两处 query、server.py shim 注入）；`python -m netlab.plotkit_vendor install --force` 已同步内置 PlotKit（55 文件）。

**验证**
- 新回归 `PlotKit/tests/test_free_layout.py` 11 项：重叠摆位、无 layout 时网格不变、缺项退回网格、6 组非法 layout 校验、服务端渲染回报 boxes、静态页控件存在。用旧 vendored 代码跑同测试 **8 failed**，确认能红。
- UI 冒烟（无头 Edge + CDP，临时脚本已删）：开启 → `layout=[{slot:0,rect:[0.09385,0.124,0.4248,0.752]},{slot:1,rect:[0.53635,0.124,0.4248,0.752]}]`；拖 40/20px → `[0.208,0.042,0.425,0.752]` 并持久化；把槽 0 拖到槽 1 → 两 rect 完全相同（重叠成立）；回到网格 → `layout=null`、overlay 隐藏、`plotImg.naturalWidth>0`。
- `test_desktop_drag.py` 新增 `test_shim_script_tag_renders_numeric_version`（pywebview 壳下 HTML 里出现 `desktop-shim.js?v={APP_BUILD}` 实际值），并收紧 `test_shim_script_tag_is_versioned`（必须是 `{APP_BUILD}`，禁止写死数字）。
- PlotKit 全量：`PYTHONPATH=src python -m pytest -q` → **451 项全绿**（42.3 s）。
- netlab 全量：`python -m pytest netlab/tests -q` → **415 passed, 3 warnings**，退出码 0；结束阶段仍输出 Windows `fatal exception: code 0xc0000139`（`netlab/plotkit_bridge.py:223 _sync_loop` + sympy/gmpy2 native 导入，§7.48 既有问题，未解决）。
- `python -m compileall -q netlab` 退出 0（仅 vendored PlotKit `SyntaxWarning`）；`python -m netlab.desktop --selftest` 退出 0（status 200、shim_injected True、shim_status 200）。
- 备份：`NetlabExtras/backups/ProjectPoint_backups/netlab_free_layout_20261103_1430/`。

**下一步**：P3 图层设置独立窗口 → P5 画布批注（文字框/数据标注/箭头）。

### 7.51 PlotKit 图层独立窗口（PK-R19 / P3 方案 A）（2026-11-03）

**用户要求**（m00970 原话）：「先P4 ，然后3，最后5，记得更新文档」——P4 完成后本轮做 P3。

**改动**
- `PlotKit/src/plotkit/static/index.html`：图层 `<details>` 加 `id="layerSect"` 便于整体搬家；「布局」组加 `#btn-layer-pop`；`.plotwrap` 内加浮窗 `#layerWin`（标题栏 `#layerWinBar`、`#layerWinBody`、`.layerwin-resize`、`#btn-layer-close`）。
- `PlotKit/src/plotkit/static/app.js`：新增 `layerWinState`、`layerWinWrap()`、`clampLayerWinRect()`、`defaultLayerWinRect()`、`applyLayerWinRect()`、`saveLayerWinRect()`、`readLayerWinSaved()`、`popLayers()`、`dockLayers()` 与 `bindLayerWindow()`。浮出把 `#layerSect` 搬进 `#layerWinBody`，收起插回 `#panel`（内嵌图分组前）；拖动/缩放走 pointer 事件，最小 260×180；`localStorage["pk.layerWin"]={popped,rect}` 记住位置与浮出状态，只有 `popped:true` 才在刷新后还原；标题栏上的按钮不触发拖窗。
- `PlotKit/src/plotkit/static/app.css`：`.layerwin`（absolute, z-index 30, 圆角阴影）、`.layerwin-bar`（move 光标）、`.layerwin-body`、`.layerwin-resize`、`.layerwin[hidden]`。
- 版本 3.16.8 → **3.16.9**（UI_BUILD / APP_BUILD / index 两处 query；shim 注入已走 `{APP_BUILD}` 单一来源）；`python -m netlab.plotkit_vendor install --force` 已同步内置 PlotKit（55 文件）。

**验证**
- 新回归 `PlotKit/tests/test_layer_window.py` 5 项静态护栏（结构 id、pop/dock 的 DOM 搬运、拖动/缩放的 clamp 与按钮排除、持久化与还原条件、CSS 存在）。用 P4 备份的旧静态文件对照，8 个关键标记全部缺失 → 断言在改前是红的。
- UI 冒烟（无头 Edge + CDP，临时脚本已删，15 项断言全 PASS）：浮出后图层分组在 `#layerWinBody`、面板内查不到；初始 rect 380×418 → 拖标题栏 −120/+80 位置同步变化；拖右下角 → 450×468；收起后归位且 `popped:false`；刷新保持收起；再浮出后刷新还原 450×468。
- PlotKit 全量：`PYTHONPATH=src python -m pytest -q` → **456 项全绿**（46.2 s）。
- netlab 全量：`python -m pytest netlab/tests -q` → **415 passed, 3 warnings**，退出码 0；stderr 仍有 `Windows fatal exception: code 0xc0000139`（§7.48 既有问题）。
- `python -m compileall -q netlab` 退出 0；`python -m netlab.desktop --selftest` 退出 0（status 200、shim_injected True、shim_status 200）。
- 备份：`NetlabExtras/backups/ProjectPoint_backups/netlab_layer_window_20261103_1450/`。

**下一步**：P5 画布批注（文字框/数据标注/箭头）。

### 7.52 PlotKit 画布批注（PK-R21 / P5）（2026-11-03）

**用户要求**（m00699 第 5 条原话）：「不能自行放置文字框，数据标注，箭头等类似于笔记功能」。按用户定序（m00970）「先P4 ，然后3，最后5，记得更新文档」，这是本轮最后一票。

**设计**：批注单独放 `figure.notes`，不复用 `figure.shapes`（只有数据坐标、无文字框语义），也不复用图层级 `annotations`（那是 hline/vline/band/text 的轴级标注）。条目 `{id, kind, text, color, size, …}`，`kind` ∈ `text`（`pos`，figure 比例）/ `arrow`（`start`→`end`，figure 比例）/ `region`（`rect`，figure 比例虚线框）/ `mark`（`subplot` + 数据坐标 `x`/`y`，缩放平移后仍指向同一数据点）。

**改动**
- `PlotKit/src/plotkit/spec/model.py`：`NOTE_TYPES` + `new_note()`（默认 `color="#0f766e"`、`size=11.0`、`id="n"+uuid4[:8]`，未知 kind 抛 ValueError）。
- `PlotKit/src/plotkit/spec/validate.py`：`KNOWN_FIGURE_KEYS` 加 `notes`；逐条校验 kind、text、size、pos/start/end 两数、rect 四数且 w/h>0、mark 的 subplot 与 x/y。
- `PlotKit/src/plotkit/backends/mpl_backend.py`：`_draw_notes()` 用 `fig.text`（圆角底框）/ `FancyArrowPatch` / `Rectangle`（虚线）/ `ax.annotate`（数据标注引线）绘制，在 `_draw_decorations()` 之后调用。
- `PlotKit/src/plotkit/api/native.py`：`update_layout` 白名单加 `notes`。
- `PlotKit/src/plotkit/static/index.html`：「布局」组加「文字框 / 箭头 / 框选 / 数据标注 / 删除批注」与 `#note-overlay` 覆盖层。
- `PlotKit/src/plotkit/static/app.js`：`noteState`、`noteList()`、`noteImageRect()`、`setNoteTool()`、`addNote()`、`deleteSelectedNote()`、`editNoteText()`、`renderNoteOverlay()`、`bindNoteOverlay()`（点击/拖拽建批注、拖动移动、双击改字、Delete 删除、Esc 退工具）。
- `PlotKit/src/plotkit/static/app.css`：`.note-overlay`（默认 `pointer-events:none`，选工具后 `.armed` 接管）、`.note-item`、`.note-text`、`.note-mark`、`.note-region`、`.note-arrow`、`.note-preview`。
- 关键约束：批注覆盖层要 `state.img` 几何，而前端 canvas 渲染路径不写 `state.img` → `redraw()`/`replayRender()` 的条件再加 `!noteList().length && !noteState.tool`，有批注或开着工具时强制服务端渲染；`renderLayoutOverlay()` 开头顺带 `renderNoteOverlay()`，保证所有既有重绘入口都会刷批注层。
- 版本 3.16.9 → **3.16.10**（UI_BUILD / APP_BUILD / index 两处 query）；`python -m netlab.plotkit_vendor install --force` 已同步内置 PlotKit（55 文件）。

**验证**
- 新回归 `PlotKit/tests/test_notes.py` 14 项：`new_note` 默认值/未知类型、合法 spec、7 组非法条目（未知 kind、缺 pos、arrow 缺 end、region 零宽/3 元 rect、mark 缺 y、size=0）、notes 非数组、渲染像素确实变化、mark 指向不存在子图不崩、服务端 PUT→render 往返、静态页控件。改前端前静态护栏断言为红（`note-overlay` 不存在）。
- UI 冒烟（无头 Edge + CDP，临时脚本与截图已删）：文字框/箭头/框选/数据标注依次建成，`GET /api/spec` 读到 4 条（持久化），数据标注落在 `x=1.4349, y=2.5064`；双击文字框改为「改过的批注」；删除后剩 `arrow/region/mark`；截图确认四类批注都进了 PNG。
- PlotKit 全量：**470 项全绿**（46.5 s，456→470）。
- netlab 全量：`python -m pytest netlab/tests -q` → **415 passed, 3 warnings**，退出码 0；stderr 仍有 2 行 `Windows fatal exception: code 0xc0000139`（§7.48 既有问题，未解决）。
- `python -m compileall -q netlab` 退出 0；`python -m netlab.desktop --selftest` 退出 0（status 200、shim_injected True、shim_status 200）。
- 备份：`NetlabExtras/backups/ProjectPoint_backups/netlab_notes_20261103_1508/`。

**P4→P3→P5 收尾**：用户 m00699 的 5 条反馈全部落地——①预计算后无法播放（§7.49）②拖画布不合理/难复位/打断播放（§7.49）③图层设置独立窗口（§7.51）④子图自由拖拽且可重叠（§7.50）⑤画布批注（本节）。

### 7.53 PlotKit 预览精度不随仿真精度变化（2026-11-03）

**用户反馈**（m01696 原话）：「为什么即使我在netlab提高了仿真精度，在plotkit里精度依然没有提高，请修复这个问题，并且继续完成任务」。截图里 dt 已设 1e-6、电路模式、120 fps、每帧 1 步，PlotKit 预览 0.5 s 窗口只有约 20 个折点。

**根因（三层，全部与 dt 无关）**
1. `netlab/server.py` 的 `plotkit_precompute` 写死 `step_dt = max(dt, seconds / 2000.0)`：请求 `dt=1e-4` 或 `1e-5`，实测响应都是 `dt: 0.00025, frames: 2000`。
2. `netlab/core/compute/simulation.py` 的 `Simulation.live()` 把 `limit` 钳到 600，桥接每次最多取 600 点。
3. 同文件 `RECORDER_CAPACITY = 1200`，`precompute()` 用 `sample = max(sample, ceil(count / RECORDER_CAPACITY))` 反推采样间隔，点数只跟容量走（1e-4 → 1001 帧、1e-5 → 1191 帧）。

**改动**
- `netlab/server.py`：新增 `PRECOMPUTE_MAX_STEPS = 200_000` 与纯函数 `precompute_step_dt(seconds, requested_dt, *, max_steps)`，返回 `(step_dt, degraded)`；`plotkit_precompute` 改为读 `payload["dt"]`（缺省 `cfg["dt"]`，越界回落 0.01），响应带 `requested_dt` / `dt_used` / `degraded`。
- `netlab/core/compute/simulation.py`：`RECORDER_CAPACITY` 1200 → **6000**（注释写明它同时是单次预计算的采样点上上限）；`live()` 钳制改为 `min(RECORDER_CAPACITY, int(limit))`。
- `netlab/plotkit_bridge.py`：新增 `SYNC_PULL_LIMIT = 6000` 并用于 `_sync_loop`，与录制容量绑定。
- `frontend/app.js`：两个预计算入口（运行前弹窗、数据条「接入」前）显示降级说明与实际步长，并按 warn 级别 toast。
- 版本 3.16.10 → **3.16.11**（UI_BUILD / APP_BUILD / index 两处 query）。本次只改 netlab 侧，无需重新 vendor PlotKit。

**验证**
- 新回归（`netlab/tests/test_plotkit_channels.py`）：`test_precision_increases_points_in_plotkit_preview`（0.05 s 下 1e-5 点数远多于 1e-4；改前红在 600/1001）、`test_precompute_honors_requested_dt`（响应 `dt==1e-5`、`degraded False`、`frames>3000`）、`test_precompute_uses_scene_dt_when_caller_omits_it`（前端只发 seconds 时取场景 dt）、`test_precompute_step_dt_degrades_openly`（纯函数验证超上限降级）。
- `netlab/tests/test_plotkit_frontend_auth.py::test_precompute_degradation_is_surfaced_in_both_call_sites`：两个调用点都显示降级信息。
- `netlab/tests/test_recorder_sampling.py`：两条写死旧容量的断言改为按容量常量与待读帧数计算，预计算用例改 12 s/1e-3 触发降采样。
- 实测：0.5 s@1e-4 → `frames 5000, sample_every 1`、store 5000 点、gap 1e-4；0.5 s@1e-5 → `frames 5556, sample_every 9`、5556 点、gap 9e-5；接口级 0.05 s 时 1e-4 得约 500 点、1e-5 得 5000 点；`dt=1e-6` 在 1 s 窗口触发 20 万步上限，返回 `degraded: true` 并提示缩小时间窗。
- netlab 全量：**447 passed, 3 warnings**（61.31 s），退出码 0；stderr 仍有 2 行 `Windows fatal exception: code 0xc0000139`（§7.48 既有问题，未解决）。注：15:48 有并行会话在改 `netlab/tests/test_transfer.py`，中途一次全量出现 2 个瞬时失败（445 passed），文件稳定后复跑 447 全绿。
- `python -m compileall -q netlab` 退出 0；`python -m netlab.desktop --selftest` 退出 0（status 200、shim_injected True、shim_status 200）。
- 规格：`netlab/docs/specs/2026-11-03-plotkit-precision.md`。

### 7.54 R34 s 域传递函数节点与分析（D90）（2026-11-03）

**用户要求**（2026-11-03 原话）：「优化信号流的功能，可以直接用频域s方程写传递函数，并计算，参考matlab simulink里的功能」；参考实现点名 xcos、pathsim、pathview、petercorke/bdsim、python-control。要求「完善功能 并且严格按照文档规则更新记录文档，并吸取经验」。

**设计**：连续 TF 用降幂系数构造、内部升幂运算；解析 `s` 表达式（`s`、数字、`+ - * / ^`、括号、隐式乘法、整数幂/负指数）；真分式转可控标准型后复用既有 `StateSpaceModel` 的 zoh/tustin/backward/forward 离散推进，静态增益直接乘；分析旁路只读不写场景。

**改动**
- 新增 `netlab/core/compute/transfer.py`（803 行）：`TransferFunction`、`parse_expression`、`from_coefficients/from_zpk/from_params`、`to_state_space`、`poles/zeros/stability/at/frequency_response`、`bode_data`、`step_response`、`analyze`。
- `netlab/core/compute/computes.py`：注册 `transfer_function`（「传递函数 G(s)」，组「高级」），参数 `form/expr/numerator/denominator/zeros/poles/gain/field/output/method/x0`；静态增益分支；`COMPUTE_FORMULAS` 加公式行。
- `netlab/core/compute/analysis.py`：`_node_tf` 识别 `transfer_function`（sympy 用 `**`）；新增 `tf_analysis`（node > expr > num/den > zpk，返回 Bode/阶跃/零极点/DC/稳定性/assumptions）。
- `netlab/server.py`：`AnalysisTFRequest` + `POST /api/analysis/tf`（422 走既有 `_analysis_call`）。
- `frontend/app.js` / `index.html`：分析面板新增「传递函数分析（s 域）」——节点下拉 + 表达式 + Bode/阶跃/零极点三视图 + 文本摘要；`state.analysisTF` 保留结果并在重渲染后重绘。
- 版本戳：`UI_BUILD` / `APP_BUILD` / `index.html` 两处 `?v=` 全部 3.16.12。
- 文档：新增规格 `netlab/docs/specs/2026-11-03-s-domain-transfer-function.md`；REQUIREMENTS 新增 **R34** 与 **D90**、§9 增量行；MATH 新增 §6.3；CODE_GUIDE 增 `transfer.py` 与 `tf_analysis` 索引；LESSONS 增「s 域解析/因果性/静态增益/稳态误差」四条；BACKLOG 更新到 R34/D90。

**测试与证据**
- 定向：`python -m pytest netlab/tests/test_transfer.py -q` → **27 passed, 1 warning in 2.11 s**。
- 全量：`python -m pytest netlab/tests -q` → **449 passed, 3 warnings in 65.09 s**，退出码 0；stderr 仍有 `Windows fatal exception: code 0xc0000139`（§7.48 既有环境噪声，测试不受影响）。
- 数值验收：`1/(s+1)` Bode 在 `ω=1` 为 `-3.0103 dB / -45°`；阶跃 `rise≈2.197`、`settling≈3.91`、稳态误差 0；TF→SS 在 `0.3+0.7j` 与解析值误差 <1e-15；节点 1000×0.01 s 终值≈1；静态增益 `3×2=6`。
- `python -m compileall -q netlab` 退出 0；`python -m netlab.desktop --selftest` 退出 0（status 200、shim_injected True、shim_status 200）。
- 备份：`NetlabExtras/backups/ProjectPoint_backups/netlab_transfer_20261103_1602/`（源码/测试/前端/文档 + MANIFEST.sha256）。

**下一步**：R25 P7-09（opamp/comparator 内置结构）仍是主线；R34 的可选增强（Bode 光标、零极点拖动、MIMO）不阻塞。



### 7.55 架构审计：跨挂载鉴权、直播代次与 PlotKit 生命周期（2026-11-03）

**起因**：用户要求按既有文档与经验做一次证据驱动的架构/代码审计（冗余、数据与接口错位、新旧代码冲突、嵌套过深、运行效率/延迟/内存/安全），只实施已确认的安全改进，并同步测试与文档。

**已确认并修复的问题**

1. **PlotKit 子应用绕过桌面 token**：宿主 `desktop_token_guard` 原先只匹配 `/api/`，挂在 `/plotkit` 的子应用 `PUT /api/spec`、`POST /api/clear`、`PUT /api/layout` 无 token 即可访问（TestClient 实测 200）。现在 `is_guarded_api_path()` 同时覆盖 `/plotkit/api` 与 `/plotkit/api/`，仍豁免 `/api/health`；子应用根页与静态资源保持公开。
2. **iframe/popup 拿不到 token**：新增宿主 shim——`GET /plotkit`、`GET /plotkit/` 由宿主在 vendor `index.html` 第一条 `<script src>` 前注入；主前端 `plotkitFrameUrl()` 只在 URL fragment 传 token，shim 读取后立即 `history.replaceState` 抹掉，并仅对同源 `/plotkit/api…` 的 `fetch` 追加 `X-Netlab-Token`（保留 Request/Headers/二进制语义）；`window.open('api/png')` 例外改为带 token 的 fetch→blob（否则导出按钮会 403）。
3. **清零/换网后曲线混线**：`Recorder.clear()` 把 `seq` 归零，桥只按 cursor 变小判断重置，新旧记录同号时会漏帧或把新数据接在旧时间轴上（复现：旧 `y=1` 与新 `y=3` 混成 `[1,1,1,3,3]`）。记录器新增 `generation`（clear/重建即轮换），`Simulation.live` 原子返回；桥检测代次变化或 cursor 回退时重读 `live(0, limit)`，在同一把 `DATA_LOCK` 内 `_reset` + 灌入新数据，空帧也提交新代次。
4. **通道上限无效**：`_ensure_channels` 用 `len(figure.spec['layers'])` 判断，而 D-PlotView 正常 0 图层，80 通道能全部登记。改为按已登记数据集（排除 `t`）计数，最多 64；仍不自动建图层。
5. **`_reset` 残留旧状态**：不再强制 `subplots=1`（保留用户版式）；清空 `t`（否则新时间轴接在旧轴后）；按当前探针键剪枝旧数据集与 `_FORCED['keys']`，用户自建图层不动。
6. **生命周期**：`stop()` 现在清 `_ACTIVE`、set event、join 2 s（同线程跳过）、清空 thread/stop；`set_active(True)`/`set_channels` 可重建同步线程；server lifespan 先停桥再停 SERVICE（桥线程持 `DATA_LOCK`）。
7. **预计算假成功**：`SERVICE.precompute()` 返回 `{frames, error}` 时路由原先仍 `ok=True`。现在 `ok = not result.get("error")`，前端既有 `pre.ok === false` 分支生效。
8. **接入顺序**：`applyPkChannels` 先 POST `/api/plotkit/channels` 设好选中键，再预计算，避免桥用旧选择消费掉帧、新通道全 NaN。

**测试与证据**

- 新增 `netlab/tests/test_plotkit_bridge_lifecycle.py`（11 条，无 sleep）：代次轮换/实例独立、同 cursor 代次重置只留新数据、cursor 回退重置、`_reset` 清 `t`/剪枝但保留用户数据集与版式、80→64 上限、`set_channels` 剪枝、stop 后 `set_active` 重启。
- `test_plotkit_frontend_auth.py` 增 4 条：跨挂载缺 token/wrong token 403、`/plotkit/api` 403、query token 不生效、child root 公开且 shim 在 vendor 脚本前、HTML 不含真 token、浏览器模式 200、precompute `ok=false`。
- `test_plotkit_bridge_trim.py` 调整为先 `ensure_plotkit_importable()` 再判断 `HAS_PLOTKIT`（单跑不再 skip）；`conftest.py` 增 autouse 清理（数据集/`_REGISTERED`/`_FORCED`，不停线程）。
- 定向：24 passed（lifecycle + auth + bridge sync + trim）；扩大：59 passed / 2 warnings / 49 s；`node --check frontend/app.js` OK；`python -m compileall -q netlab` OK；`python -m netlab.desktop --selftest` → status 200 / `shim_injected: true`。
- 全量：`python -m pytest netlab/tests -q` → **462 passed, 3 warnings, 64.82 s，退出码 0**；运行中仍打印 2 次 `Windows fatal exception: code 0xc0000139`（gmpy2 native import 线程，既有环境问题，未定位）。

### 7.56 R35 输入字段自动匹配 + value 优先（2026-11-04）

**起因**：用户截图里运行前预计算报 `连接 'tf-5' 计算失败：“节点 'transfer_function2' 没有数据字段 'voltage'”`——上游写 `value`、下游默认 `voltage`，字段名不一致直接断链。用户要求「自匹配输入对象的键，输入输出优先统一为 value，再此之外可以自定义键名」。

**设计**：新增 `netlab/core/compute/fields.py` 作为唯一读取层：
- `resolve_field`：显式请求的键存在就用；否则优先数值型 `value`，再 `voltage`，再唯一数值键；歧义或无匹配抛 `ComputeError`，消息列可用键。
- `read_numeric` / `read_node_numeric` / `resolve_output`：数值与有限性校验、输出键默认 `value`。
- 接入点：`computes._numeric`/`_sum_inputs`（逐入边解析，支持 value/voltage 混接）、表达式 `resolve`（不带点号自动匹配，`data` 仍要求显式键）、`methods._read` 与 5 个 signal 工厂（`output_key` 归一）、`statespace.resolve_inputs`、`blocks.py` 单字段端口别名读写。
- 默认值：sum/gain/lag/integrate/transfer_function/clip 的 `field`/`output`、signal 边的 `input_key`/`output_key` 全部改 `value`，留空或 `auto` 时自动匹配；显式键（如 `current`）和旧 `voltage` 参数仍兼容。

**测试与证据**：
- 新增 `tests/test_fields.py` 22 条：优先级/显式键/唯一键/歧义/非数值、`mappingproxy`、`resolve_output`、gain/sum/TF/state_space 集成。
- 块封装仍 0.0 的根因是父场景端口数据是 `voltage`、块内声明 `value`；`blocks.py` 单字段别名后 `test_blocks`/`test_project`/`test_solver_transactions`/`test_block_validate` 37 条通过。
- 全量：`python -m pytest netlab/tests -q` → **484 passed, 3 warnings, 70.77 s，退出码 0**；stderr 仍有 `0xc0000139` 噪声。
- 静态版本 3.16.13（app.js/server.py/index.html 两处）；备份 `netlab_fields_20261104_0225`。

**经验**：读取端兼容层要放在最靠近 payload 的地方，别在每个节点/工厂里各写一份；`NodeView.data` 是 `mappingproxy`，用 `collections.abc.Mapping` 判断而不是 `dict`；块端口有「声明字段」和「实际字段」两套键，单字段必须做别名，否则封装块内外部永远对不上。

## §7.57 信号流右键「添加」菜单按节点组分类（2026-11-04）

**起因**：电路画布的右键「添加电学节点/器件」已经按「器件 · 组」下钻；信号流仍把所有计算节点平铺成一长串，节点种类变多后很难找。

**改动**：
- `frontend/app.js` 新增 `COMPUTE_GROUP_ORDER = ['基础', '动态', '高级', '矢量', '模块', '接口']`。
- `buildAddMenuItems()` 在非电路模式按 `state.catalog.computes[].group` 分组，生成「节点 · 基础/动态/高级/矢量/模块/接口」子菜单，叶子仍是原来的 `addNodeAt(kind, x, y)`；`addable === false` 的模块实例/端口节点继续过滤。
- 矢量模式把「矢量」组提到最前；catalog 里未列出的组按首次出现顺序补在最后，不丢节点。
- 电路分支保持原样：平铺 `circuit_nodes` + 「器件 · 组」子菜单；代码路径不变。

**测试与证据**：
- 新增 `netlab/tests/test_frontend_menus.py` 2 条静态契约：分组常量/`节点 · ${group}` 子菜单结构、矢量组置顶。
- `node --check frontend/app.js` 通过。
- 全量：`python -m pytest netlab/tests -q` → **486 passed, 3 warnings, 66.22 s，退出码 0**；stderr 仍是 `0xc0000139` 既有噪声。
- 静态版本 3.16.14（app.js/server.py/index.html 两处）；备份 `netlab_menu_20261104_0756`。

## §7.58 预计算反馈环首拍报错修复（2026-11-04）

**现象**：运行前预计算 0→5 s 中断：`节点 'transfer_function2' 没有可用字段 'voltage'，也无法自动匹配（可用字段：〈空〉）`；图上 `sum1` 与 `transfer_function2` 之间有 dashed `tf-5 z^-1` 反馈边。

**根因**：`Network.step` 在步首统一求值延迟边，此时源节点还没算过，`data` 为 `{}`；`methods._read` 直接 `read_node_numeric` 抛 `ComputeError`。`pass` 边更直接，把空 dict 原样传给目标。

**修复**：
- `netlab/core/compute/methods.py` 的 `_read`：`node.data` 为空时返回 0.0（z⁻¹ 首拍默认零）；非空但字段不对仍走读取层报错。
- `netlab/core/model/graph.py` 的 `step`：延迟边求值结果为空 dict 时不注入，目标节点按「无该路输入」处理（等价 0），避免 `pass` 空载荷被当成字段错误。
- 新增 `test_fields.py::test_delayed_edge_uses_zero_before_source_is_computed`：sum + TF 反馈环，首拍不抛错、第二拍输出 >0。

**验证**：全量 487 passed, 3 warnings, 61.86 s, exit 0；stderr 仍是 `0xc0000139` 既有噪声。静态版本不变（3.16.14，后端修复无需 bump 前端戳）；重启后端进程生效。

### 7.59 结构护栏补齐相对导入（2026-11-04）

- **问题**：`test_structure_layout.py::test_core_does_not_import_outer_layers` 只看 `Import` 与 `level=0` 的 `ImportFrom`，`from ..server import x`、`from ... import desktop`、`from netlab import desktop` 都能绕过，core 层的依赖方向护栏形同虚设。
- **修复**：新增 `_outer_layer_imports()`：按文件所在包解析 `node.level`（`core/demo.py` 的 `..server` → `netlab.server`；`core/compute/demo.py` 的 `...server` → `netlab.server`），并把 `from pkg import name` 的 alias 当作潜在子模块；`_is_outer_layer()` 统一判定 `server` / `desktop`。
- **自测**：新增 8 条参数化用例（相对与绝对形式必须命中、合法 core 引用不得误报），防止解析逻辑回退。
- **现状**：core 层扫描无越界 import；全量 **495 passed**（2026-11-04 13:55，3 warnings，61.38 s，exit 0；stderr 仍有 2 次 Windows `0xc0000139`，既有环境噪声）。
- **未做**：VS Code 自定义数据目录（未复现）、WebView2 真机 shim 端到端（需真实桌面交互），见 BACKLOG 待拍板。

### 7.60 导入优先级、环境噪声与多工作树（2026-11-04）

- **PlotKit 导入优先级统一**（`netlab/plotkit_bridge.py`）：此前 `plotkit_vendor.py` 的文档说内置副本优先，`ensure_plotkit_importable()` 却先 `import plotkit`（环境里的旧安装先命中）。现按「已导入 → `NETLAB_PLOTKIT_SRC` → 内置副本 `netlab/_vendor/plotkit` → 已安装 wheel → 同仓库 `PlotKit/src`」解析；某来源失败时移除临时 `sys.path` 项再退回下一来源。新增 `last_error()` 访问器。新增 `netlab/tests/test_plotkit_import_priority.py` 2 条子进程测试（内置副本命中、env 覆盖最高优先级）。
- **`0xc0000139` 定位与消除**（环境问题，不改仓库代码）：根因是本机 `gmpy2 2.2.1`（Anaconda Python 3.13）DLL 入口缺失——`python -c "import gmpy2"` 直接 `ImportError: DLL load failed`；sympy/mpmath 在测试线程懒加载它时触发 Windows fatal exception。`python -m pip uninstall -y gmpy2` 后全量 497 passed、**0 次 fatal exception**、退出码 0（72.24 s）。换机复现时先单查 `import gmpy2`。
- **多工作树规范**：新增 `tools/new_worktree.sh`（在 `../ProjectPoint-worktrees/<名称>` 建 `wt/<名称>` 工作树；未提交改动不会带过去）与 `netlab/docs/WORKTREE_RULES.md`（一树一会话、不 reset 他人改动、共享数据复制、合并由 owner、收尾清理）。`.gitignore` 忽略本地产物 `NetlabExtras/` 与 `layout.json`。
- **验证**：目标测试 17 passed（导入优先级 2 + 桥接同步 2 + 生命周期 11 + PlotKit 页签 2）；全量 `python -m pytest netlab/tests -q` → 497 passed / 3 warnings / 72.24 s / exit 0 / 0 次 `0xc0000139`。工作树脚本做过一次真实「创建 → 校验 → 删除」冒烟测试，`git worktree list` 恢复单工作树。

### 7.61 控制链路补强与欠阻尼工程（2026-11-04）

**起因**：用户要求修复信号流传入值匹配、检查控制系统链路，并交付一个能展示欠阻尼二阶阶跃瞬态的 Netlab 工程。R35 已统一 `value` 优先，但控制链路仍暴露五个数值/状态问题。

**修复**：
- `netlab/core/compute/transfer.py` 的 `_step_metrics`：稳态优先取有限 `dc_gain`，超调按最终值方向取峰值，避免初始 0 被当成峰值；`1/(s²+0.4s+1)` 的超调由误报 0 修正为 **52.66%**。
- `netlab/core/compute/transfer.py` 的 `step_response`：按实际步长推进；`duration/dt` 非整数时末段单独离散，时间标签与推进一致（例 `[0, 0.3, 0.6, 0.9, 1.0]`）。
- `netlab/core/compute/methods.py` 的 `_tf_factory`：离散分子按分母阶数**左补零**，`H(z)=1/z` 的单位阶跃为 `[0, 1, 1]`；分子阶数高于分母抛 `ComputeError`。
- `netlab/core/model/graph.py`：`Node` 保存 `_initial_data` 建模快照；`reset_state` 恢复计算节点初值，手动源保留当前值；重复预计算不再读到上次末值。
- `netlab/core/compute/computes.py`：sum/gain/lag/integrate/expression/transfer_function 统一用 `resolve_output`，`output=auto`/空/`*` 写 `value`，自定义键保留。

**工程**：`MyProject/underdamped_control.netlab`（v5，checksum `0002a6aa…`）。结构：signal 阶跃 → sum（`ref` + `feedback`）→ `transfer_function` `G(s)=4/(s²+1.2s)`；反馈边 `scale gain=-1` 自动 `z^-1`。闭环理想 `4/(s²+1.2s+4)`（ωn=2、ζ=0.3）；dt=0.01、12 s 实测峰值 1.393、终值 1.0009、超调 **39.18%**（连续理想 37.2%，反馈 `z^-1` 带来约 2 个点的相位滞后）。用 `Scene.load_payload` 重放验证通过。

**测试与证据**：
- 新增 7 条：`test_fields.py` 的 `output=auto`、`1/z`、`reset_state`；`test_transfer.py` 的超调与非整数网格；`test_control_project.py` 的闭环瞬态与工程 roundtrip。
- 全量：`python -m pytest netlab/tests -q` → **504 passed, 3 warnings, 73.36 s，退出码 0**；stderr **0 次** `0xc0000139`（gmpy2 已卸载）。
- 收尾复验：`python -m compileall -q netlab` 退出码 0；`python -m netlab.desktop --selftest` → status 200、`shim_injected=True`、`shim_status=200`；静态版本保持 3.16.14（本轮无前端改动）。
- 备份 `netlab_control_20261104_1815`（14 文件 + `MANIFEST.sha256`）。

### 7.62 R36 P1 执行图标签与 SCC 检测（2026-11-05）

- **目标**：在不动默认 `Network.step` 行为的前提下，先给求解器建立可检查的执行图：有状态节点作断点，直接馈通子图识别 SCC，自动 `z⁻¹` 可见记录，为后续线性 SCC 解与 Newton 提供接口。
- **节点语义**：`Node` 增加 `linear` / `stateful` / `direct_feedthrough` / `time_varying` / `nonlinear`；`compute.solver_traits(kind, params)` 按节点类型给出默认标签（signal/manual 不直接馈通，signal/lag/integrate/block 有状态，TF/state_space 按 `D` 判直接馈通，expression/nonlinear 保守标非线性）。
- **执行图**：新增 `SolverStage` / `SolverPlan`；`Network.solver_plan()` 以「`stateful and not direct_feedthrough`」为断点，把直接馈通节点构成子图，Tarjan SCC 缩点后按 DAG 拓扑排序；`Network.auto_delayed_connections()` 与 `Connection.auto_delay` 记录自动延迟边。
- **兼容**：默认 `step` 仍走原拓扑路径，不启用新求解；旧工程与既有测试不变；`EdgeRecord.auto_delay` 不写入工程快照。
- **测试**：新增 `netlab/tests/test_solver_plan.py` 4 条（traits、双增益直接馈通 SCC、TF 状态断点、Scene 自动延迟记录）；全量 **508 passed, 3 warnings, 59.36 s, exit 0**，无 `0xc0000139`。
- **状态**：R36 **P1 完成**；P2 线性 SCC 解、P3 Newton、P4 总传函/Bode、P5 相平面/播放仍待实现；R37/R38 未开工。静态版本保持 3.16.14（本轮后端改动）。

### 7.63 R36 P2 线性 SCC 求解（2026-11-05）

- **目标**：让纯线性直接馈通环不再依赖自动 `z⁻¹`，而是在同一拍内解代数方程；默认仍保留旧路径，显式开启后生效。
- **执行路径**：`Network.__init__(solve_algebraic=False)`；开启时 `Network.step()` 走 `_step_solved()`，按 `solver_plan().stages` 逐阶段推进；先求显式延迟边，代数阶段解 `(I-A)y=b`，其余阶段复用原节点 `update` 逻辑。失败时用 `capture_step_state`/`restore_step_state` 回滚。
- **节点/边范围**：P2 只解 `sum` / `gain` 节点与 `pass` / `scale` 边；奇异矩阵、暂不支持的节点/边抛 `AlgebraicLoopError`，消息带节点/边名，不静默改成延迟。
- **场景接口**：`Scene.solve_algebraic=False`；`Scene.set_algebraic_solver(True)` 后 `SignalEngine` 构造 `Network(solve_algebraic=True)`，`add_edge` 遇环不再自动加 `z⁻¹`（显式 `delay=True` 仍优先）。
- **测试**：新增 `netlab/tests/test_algebraic_solver.py` 3 条——双增益环解析解（a=-0.2、b=-0.6）、自环奇异报错、带外部输入的和/增益环（2/3、-1/3）；全量 **511 passed, 3 warnings, 64.56 s, exit 0**，无 `0xc0000139`。
- **状态**：R36 **P1–P2 完成**；P3 Newton、P4 总传函/Bode、P5 相平面/播放仍待实现；静态版本保持 3.16.14。

### 7.64 R36 P3 非线性 / 时变 Newton（2026-11-05）

- **目标**：让含非线性表达式或时变表达式的直接馈通 SCC 在同一拍内用阻尼 Newton 求解，不自动加 `z⁻¹`，失败时明确报错而不是返回伪值。
- **执行路径**：`_step_solved()` 对 `stage.nonlinear` 调 `_solve_nonlinear_stage()`；`_evaluate_node()` 用候选输出值构造 `ComputeContext` 并调用节点 handler（不写回节点），支持 `sum`/`gain`/`expression` 等无状态节点；外部入边照常求值，延迟边用本拍延迟载荷。
- **Newton**：残差 `F(y)=handler(y)-y`，有限差分雅可比（`1e-6*max(1,|y|)`），`np.linalg.solve` 求步长，线搜索从 `α=1` 起最多减半 8 次，`tol=1e-9`、`max_iter=50`；零初值分量给非零起点避免落在雅可比奇异点；失败抛 `NewtonConvergenceError`（带节点、残差、迭代次数）。
- **时变**：`expression` 节点每拍自动注入保留变量 `t` 与 `time`（用户显式映射同名变量时以映射为准）；Newton 迭代内部冻结该拍时间。
- **测试**：`test_algebraic_solver.py` 新增 3 条——`y=tanh(y)+u` 收敛到残差 ≤1e-8、时变 `0.5*y+t` 两拍为 0.2/0.4、无解 `y*y+1` 抛 `NewtonConvergenceError`；该文件共 6 条。全量 **514 passed, 3 warnings, 61.91 s, exit 0**，无 `0xc0000139`。
- **状态**：R36 **P1–P3 完成**；P4 总传函/Bode、P5 相平面/播放待实现；静态版本保持 3.16.14（后端改动）。

### 7.65 R36 P4 线性网络总传函与 Bode（2026-11-05）

- **目标**：从整张信号流网络直接得到输入到输出的总传函，支持串联/并联/反馈，并复用现有 Bode/阶跃分析；不再要求手工拼接公式。
- **实现**：重写 `analysis.transfer_function()` 为线性网络节点方程 `(I-W)y=b` 的符号消元。节点支持 `gain`/`sum`/`lag`/`integrate`/`transfer_function`/`state_space`；边支持 `pass`/`scale`；反馈环直接联立求解，非线性节点明确返回“不支持线性总传函”，不静默线性化。`tf_analysis()` 新增 `input_node`/`output_node`，网络总传函可直接走 Bode/阶跃/零极点分析。
- **测试**：新增 `netlab/tests/test_network_tf.py` 4 条——串联 `2/(s+1)`、并联 `5`、单位负反馈 `1/(s+2)` 及 Bode 幅相、非线性网络报错；全量 **518 passed, 3 warnings, 71.61 s, exit 0**，无 `0xc0000139`。
- **状态**：R36 **P1–P4 完成**；P5 相平面/播放待实现；R37 的 s 域总传函/Bode 基础已由 P4 提供，连续延迟 s 域近似与 R38 仍待后续。静态版本保持 3.16.14（后端改动）。

### 7.66 R36 P5 相平面状态通道、独立播放与数据分析（2026-11-05）

- **目标**：让相平面不再只认矢量模式的人工 `x/y` 字段，而是直接读取信号流节点的真实内部状态；相图拥有独立于主仿真的播放条，并给出轨迹指标。
- **状态通道**：`SignalEngine.probes()` 遍历 `node.state`：list/tuple 按索引输出 `state:<node>:<index>`（状态空间 `x` 列表自动成为 `:0/:1`），标量数值输出 `state:<node>:<key>`；只接受有限数值、排除 bool。预计算录制自然把这些键写进 frames。
- **分析**：`analysis.phase_metrics(xs, ys, times=None)` 输出点数、`path_length`、`enclosed_area`（鞋带公式）、x/y 极值与终值、`y_peak`、相对 y 终值的 `overshoot_pct`、可选起止时间；长度不一致/无效点抛 `AnalysisError`。新增 `POST /api/analysis/phase`；`/api/analysis/tf` 请求补上 `input_node`/`output_node` 并传给 `tf_analysis`，P4 网络 Bode 的 API 对齐。
- **前端**：`vectorCandidates()` 增加 `state:<node>:<index>` 候选；`drawPhase()` 在 x/y、vx/vy、x1/x2 之后回退到状态通道；相图工具栏新增播放/暂停、步进、循环、当前帧滑块（`phasePlay`/`phaseStep`/`phaseLoop`/`phaseFrame`），播放定时器只驱动相图、不影响主仿真；读数增加轨迹长度 `L` 与包围面积 `A`。
- **测试**：新增 `netlab/tests/test_state_channels.py` 3 条——TF 节点暴露 `state:g:0/1`、单位圆轨迹长度≈2π/面积≈π、x/y 长度不一致报错；全量 **521 passed, 3 warnings, 59.68 s, exit 0**，无 `0xc0000139`。
- **状态**：R36 **P1–P5 完成**（求解器主线）；R37 全局状态空间装配/延迟 z 域、R38 完整验收（dt 收敛、非线性相图提示）仍待后续；CSV 导出与指标读数已在 §7.67 补全。由于本轮改了前端静态资源，版本戳升 **3.16.15**（`app.js` UI_BUILD、`index.html` 两处 `?v=`、`server.py` APP_BUILD）。

### 7.67 R38 相图数据分析与 CSV 补全（2026-11-05）

- **目标**：让相图读数不止 L/A，直接给出峰值、超调、稳态值、调节时间，并能把当前相图两个状态通道导出为 CSV。
- **前端**：`drawPhase()` 在轨迹块中计算 `y` 峰值、相对 `y` 终值的超调、末值与 2% 调节时间；读数追加 `峰值/超调/稳态/调节`。相图工具栏新增 `phaseExport` 按钮，复用 `exportAnalysisCsv(keys, defaultName)`，优先导出 `state:<node>:<index>`，无状态通道时回退 `n:<node>:x/y`。
- **后端**：不新增接口；继续使用 `POST /api/analysis/export` 的 `keys` 参数。`phase_metrics` 的同一套指标已由 `/api/analysis/phase` 提供。
- **验证**：`node --check frontend/app.js` 通过；`python -m pytest netlab/tests/test_state_channels.py -q` 3 passed；全量 **521 passed, 3 warnings, 61.01 s, exit 0**；`compileall` 通过；selftest status 200、shim 200。静态版本升 **3.16.16**（四处同步）。

### 7.68 最终集成检查、R37 延迟 z 域与 R38 dt 收敛（2026-11-05）

- **目标**：在 R36 P1–P5 之后补齐 R37 对外总传函/延迟 z 域和 R38 的 dt 收敛/无状态提示，并做一次接口、闭环、精度、性能与结构检查，统一整理文档后提交 git。
- **R37**：`analysis.transfer_function(..., domain='z')` 支持纯 `gain`/`sum` 网络的显式 `z⁻¹`（回归 `2/z`），`domain='s'` 遇到延迟明确报错；`/api/analysis/transfer` 增加 `domain` 参数，`/api/analysis/tf` 补 `input_node`/`output_node`。内部仍用符号节点方程消元，全局 `A/B/C/D` 导出保留为后续优化项。
- **R38**：`test_control_project.py` 新增 dt 收敛测试：12 s、dt=0.01 → 0.002，超调 39.15% → 37.53%（差 1.62 个百分点），终值差 <0.005；`drawPhase()` 对无状态通道的信号流节点给中文提示。
- **接口**：新增 `test_analysis_api.py` 2 条，覆盖 `POST /api/analysis/phase` 与 `POST /api/analysis/tf` 的 `input_node`/`output_node`；前端仍走 `api()` token 封装，无新增直连 fetch。
- **性能**：同一欠阻尼工程预计算 12 s：dt=0.01 1200 帧 115 ms、dt=0.002 6000 帧 546 ms（约 11k 步/s）；总传函符号消元与相图指标均为毫秒级，无新增热点。
- **状态**：R36 P1–P5、R37 对外能力、R38 完成；全量 **525 passed, 3 warnings, 80.46 s, exit 0**；静态版本 **3.16.17**（四处同步）；备份 `netlab_final_20261105_0205`（14 文件 + MANIFEST）；工作树并行改动保留，提交前统一整理。

## §7.69 全局传函延迟、时域指标、PlotKit 与 R25（2026-11-05）

**目标**：完成 m07293 的五项：①修复带单步延迟的 s 域全局传递函数；②时域动态性能补齐峰值时间并统一展示上升/峰值/超调/稳定时间；③信号流分析曲线接入 PlotKit；④并行小项（R22/R12/R26/R13/R37）；⑤R25 内置内部结构。

**实现**：
- **全局传函延迟**：`netlab/core/compute/analysis.py` 的 `transfer_function(..., domain="s", delay_pade_order=3)` 增加 1–8 阶 `[p/p]` Padé；单步延迟时间取 `sim.config.dt`，用 `s·dt` 构造有理近似；z 域仍精确 `z⁻¹`。返回 `delay_pade_order`/`delay_seconds`，assumptions 明确近似阶数。GET `/api/analysis/transfer` 与 POST `/api/analysis/tf` 均支持 `delay_pade_order`。
- **时域指标**：`netlab/core/compute/transfer.py` 的 `_step_metrics()` 增加 `peak_time`/`peak_value`；正/负终值分别取 argmax/argmin，仅明显超调时给峰值时间，单调/过阻尼与不稳定系统返回 `None`。前端 `analysisTFSummary` 显示峰值与峰值时间，`drawTFStep` 画峰值点并标注。
- **TF 面板闭环**：`runAnalysisTransfer()` 改 POST `/api/analysis/tf`，传 `input_node/output_node/points=240`，一次得到 Bode/阶跃/零极点；TF 面板新增「导出 A/B/C/D」，`analysis.py` 的 `_state_space_payload()` 复用 `TransferFunction.to_state_space()` 可控标准型。
- **PlotKit**：`netlab/plotkit_bridge.py` 增加 `analysis:` 前缀与 `add_analysis_curve()`；`_ingest`/`_ensure_channels`/`channels()` 全部跳过分析数据集，避免被 recorder 的 `t` 追加；新增 `POST /api/plotkit/analysis`。前端 TF 阶跃与相图工具栏加「发送到 PlotKit」。
- **并行小项**：R22 信号流右键分组沿用既有实现；R12/R26 的 DC 工作点/AC 扫频沿用 `#analWin` 唯一实现并核对；R13 性能面板接通 `/api/profile?top=20`（开关/应用/清空 + 耗时表）；R37 A/B/C/D 导出落地。
- **R25**：新增 `netlab/core/model/builtins.py` 的 9 个只读 structural 宏块（opamp/comparator/dff/counter4/shift4/timer555/ldo/adc4/dac4，固定 id `a25000000001`–`a25000000009`）；`blocklib` 增加虚拟注册表、`include_builtin` 合并、内置写/删/改名保护、`load_block` 回退；`server.py` 所有块扫描合并内置；前端「内置」徽标与只读提示；`save-copy` 可另存普通副本。

**测试与证据**：
- 新增/扩展：`test_analysis_api.py`（延迟 Padé + 网络参数 + state_space）、`test_network_tf.py`（s 域延迟、state_space）、`test_transfer.py`（peak_time/peak_value）、`test_plotkit_bridge_sync.py`（analysis 曲线独立 x 轴）、`test_builtin_blocks.py`（9 块/只读/另存副本/空库回退）。
- 全量 `python -m pytest netlab/tests -q` → **531 passed, 3 warnings, 71.53 s, exit 0**；stderr **0 次** `0xc0000139`。
- 真实工程 `MyProject/underdamped_control.netlab`（dt=0.002、反馈边 delay=True）s 域总传函：order 5、stable、final 1.0、overshoot 37.50%、rise 0.659 s、peak_time 1.648 s、peak_value 1.3750、settling 5.624 s、SSE 0。
- 性能：同工程 12 s 预计算 dt=0.01（1200 帧）约 115–141 ms、dt=0.002（6000 帧）约 546–648 ms（本机复测波动）；本次新增均在分析与导出路径，不进入逐拍求解热路径。
- `python -m compileall -q netlab`、`node --check frontend/app.js`、`python -m netlab.desktop --selftest` 均通过。
- 静态版本 **3.17.0**（四处：`frontend/app.js:19`、`frontend/index.html:8/:632`、`netlab/server.py:29`）。

**已知限制（§7.69 当时）**：R25 的 9 个内置结构是 signal 宏模型，不是完整电路级器件；「按内部结构仿真」开关与行为模型对比已在后续 §7.70 补齐；完整电路级仍留作后续，不把宏模型冒充电路级模型。

## §7.70 R25 行为快速模型、内部结构开关与对比（2026-11-05）

**目标**：补齐 R25 第三阶段——让 9 个内置结构块默认走行为快速模型，同时允许用户切换「按内部结构仿真」，并能一键对比两条路径的短时响应与误差。

**实现**：
- 新增 `netlab/core/model/block_behavior.py`：9 类内置块的纯 Python 端口行为模型（运放饱和、比较器、DFF 上升沿、4 位计数器/移位寄存器、555 方波、LDO 限幅、ADC 量化、DAC 解码），状态由每个 `BlockRuntime` 独占。
- `netlab/core/model/builtins.py` 为每个内置块写入 `metadata["behavior"]`；`BlockRuntime(..., internal_sim=False)` 默认行为路径，`internal_sim=True` 或无 behavior 时构建内部 `Scene`。`reset/capture_checkpoint/restore_checkpoint/stats` 均覆盖两条路径。
- `netlab/core/model/scene.py:_wire_blocks()` 读取块节点 `params["internal_sim"]`，把开关纳入 `block_instances` 缓存失效判断；`netlab/core/compute/computes.py` 的 `block` 参数表新增 `internal_sim` 布尔参数，前端 inspector 通过既有 `buildParamFields` 自动渲染，PATCH `/api/nodes/{id}` 可保存。
- 新增 `compare_block_modes()` 与 `POST /api/blocks/{block_id}/compare`：同时运行行为/结构两个 runtime，返回 time、behavior、structural、max_abs_diff、rms_diff、steps、note；前端内置块卡片「行为/结构对比」弹窗展示峰值与误差。
- 内置块的行为/结构对比结果：opamp/comparator/dff/timer555/ldo/dac4 当前路径差为 0；counter4/shift4/adc4 因结构宏模型与行为模型的量化/时序定义不同存在有限差异，接口如实返回，不伪装等价。

**测试与证据**：
- `python -m pytest netlab/tests/test_builtin_blocks.py -q` → **15 passed, 1 warning, 2.11 s**（新增行为路径/开关保存/9 块对比用例）。
- 全量 `python -m pytest netlab/tests -q` → **543 passed, 3 warnings, 74.58 s, exit 0**；stderr **0 次** `0xc0000139`。
- `python -m compileall -q netlab` 通过；前端 `node --check frontend/app.js` 通过；`python -m netlab.desktop --selftest` 返回 status 200 / shim 200。
- 静态版本 **3.17.1**（四处：`frontend/app.js:19`、`frontend/index.html:8/:632`、`netlab/server.py:29`）。

**已知限制**：9 个内置块内部仍是 signal 宏模型，不是完整电路级器件；counter4/shift4 的数字时序、adc4 的量化边界与行为模型可能不完全逐点一致。后续可逐类替换成电路级结构并补等价性测试，不改变块 id/端口。

## §7.71 R39 复数分析层（Complex Bridge）完成（2026-11-05）

**目标**：在不改动时域/持久化数据的前提下，为信号流与电路提供统一的 `H(jω)` 复数出口；信号流延迟用精确 `e^{-jωT}`，电路复用 DC 工作点 + 复数 MNA。规格：[2026-11-05-complex-analysis-layer.md](specs/2026-11-05-complex-analysis-layer.md)。

**实现**：
1. 新增 `netlab/core/compute/complex_support.py`：`as_complex`/`as_complex_array`/`as_real`/`complex_parts`/`map_complex`/`phase_degrees`；只在分析边界做实数↔复数转换，不进入节点状态/recorder/工程 JSON。
2. 新增 `analysis.frequency_response(sim, input, output, *, f_start, f_stop, points, scale, input_field, output_field)`：统一返回 `frequencies_hz/omega/omega_rad_s/real/imag/magnitude/phase_deg/backend/assumptions/warnings/source`；signal 走 `(I-W(jω))y=b` 复数节点方程，延迟边用精确 `exp(-jωdt)`；circuit 复用 `sim.ac_sweep()` 的 DC 工作点 + 复数 MNA。
3. `nodal.ac_sweep()` 每个 probe 在原有 `magnitude/phase_deg/db` 外新增 `real/imag`，旧字段不变。
4. 新增 `POST /api/analysis/frequency`（`AnalysisFrequencyRequest`，`input/output` 必填，`points` 2–2001，`scale=log|lin`；失败经 `_analysis_call` 转 422）。
5. 新增 `test_complex_support.py` 10 条、`test_frequency_response.py` 6 条（signal 一阶滞后、精确延迟相位、RC 低通、RLC 谐振、非法频率、非线性拒绝）、API 契约测试 1 条。

**精度对照**：
- signal 一阶滞后 `2/(1+jω)` 在 1/(2π) Hz：幅值 `1.41421356`、相位 `-45°`。
- 单步延迟 `dt=0.01 s` 在 10 Hz：相位 `-36°`（精确 `-ωT`，非 Padé）。
- circuit RC 低通 `R=1 kΩ/C=1 µF` 在 `fc=159.1549 Hz`：`0.707107/−45.0°`。
- circuit RLC 低通 `R=10 Ω/L=0.01 H/C=1 µF` 在 `f0=1591.55 Hz`：幅值 `10.0`、相位 `-90°`（Q=10）。
- 全量 **561 passed, 3 warnings, 73.01 s, exit 0**；时域/recorder/JSON 仍为 `float64`。

**性能（本机，241 点）**：signal 复数图 **3.6 ms**；circuit 复数 MNA **100.5 ms**（含 DC 工作点，逐频点 MNA；未新增缓存层）。

**边界**：不做全量 `complex` 迁移；`vector` 模式保持原样；本轮不强制前端复数表格/CSV；不替代符号总传函。完整电路级/多端口 MIMO 频响留后续。

**状态**：完成；静态版本 3.18.0；备份 `netlab_3_18_0_20261105_1340`（15 文件 + MANIFEST.sha256）。

## §7.72 R31 并网逆变器 P11-01…P11-07 完成（2026-11-05）

**目标**：按 D63 三层路线补齐并网逆变器从 L1 平均模型到 L2 跨域桥、开关级示例与性能封口，并提供可一键载入的 `.netlab` 工程。

**实现**：
- P11-01：`MyProject/grid_inverter_avg.netlab`，三相 311 V/50 Hz 信号源 + `theta_grid` + `abc_dq` + 6 状态 dq LCL+电网 `state_space`（`i1d/i1q/vcd/vcq/i2d/i2q`）+ `i_d/i_q/v_d/v_q` 测量；0.2 s/dt=50 µs、4000 步，约 1.26 s，i_d≈2.815、i_q≈-1.932，尾段稳定。
- P11-02：`computes.py` 新增 `abc_dq`（正/反 Park，幅值不变，`read_numeric` 读连接字段），4 条测试通过。
- P11-03：`computes.py` 新增 `pll` SRF-PLL（`theta/frequency/d/q/locked`，PI 限幅、相位重锁），`MyProject/pll_template.netlab` 生成，3 条 PLL 测试 + 模板工程测试通过。
- P11-04：`computes.py` 新增 `pi`（抗饱和积分），`MyProject/grid_inverter_current.netlab` 生成；dq RL + 双 PI + 前馈解耦，i_d 10%→90% <5 ms，电流环/工程测试通过。
- P11-05：`nodal.py` 新增 `SensorElement`/`ActuatorSource` 与 `ELEMENT_SPECS`，`ports.py` 补 PINS；`CircuitEngine.step()` 固定顺序「actuator 取上一拍 → MNA → 写节点电压 → sensor 采样写信号」，显式一拍延迟；4 条桥测试覆盖延迟、旧工程不变、规格注册、checksum 往返。
- P11-06：`MyProject/grid_inverter_switch.netlab`，6 个 nmos 三相桥 + LCL + 50 Hz 脉冲栅极（duty=0.48 留死区），0.02 s/dt=10 µs、2000 步可运行；测试断言 pcc/mid 峰值 >10 V 且不发散。
- P11-07：`test_grid_performance.py` 覆盖 1 µs 步长性能（平均模型 5000 步、开关模型 2000 步）与 `Simulation.cancel_precompute()`；前端预计算浮窗新增「停止计算」，`POST /api/control {action:"cancel_precompute"}` 中断并保留已算帧。长仿真实测（`NetlabExtras/scratch/bench_r31.py`）：平均模型 0.1 s/dt=1 µs、100000 步 **101.7 s**（1017 µs/步，峰值 5.4 MB）；开关模型 0.01 s/dt=1 µs、10000 步 **24.0 s**（2398.5 µs/步，峰值 11.2 MB），0.1 s 按线性估算约 240 s。UI 可随时中断。

**验证**：
- 全量 `python -m pytest netlab/tests -q` → **581 passed, 3 warnings, 78.15 s, exit 0**。
- R31 目标测试 18 条：平均工程 1、abc_dq 4、PLL 3 + 模板 1、电流环 1 + 工程 1、桥 4、开关工程 1、性能/中断 2（不同文件合计）。
- `python -m compileall -q netlab`、`node --check frontend/app.js`、`python -m netlab.desktop --selftest`（status 200、shim 200）待最终重跑。
- 静态版本 **3.19.0**（`frontend/app.js:19`、`frontend/index.html:8/:632`、`netlab/server.py:29`）。

**已知限制**：P11-06 为理想 nmos 行为级开关 + 50 Hz 方波栅极/死区，未实现 10 kHz 载波 PWM 与器件损耗；趋势验证成立，绝对 EMT 精度不作承诺。R25 完整电路级内部结构仍留后续。

---

## §7.73 R40 全栈可扩展架构设计（2026-11-06，设计完成、代码未实现）

**目标**：按用户要求，把节点计算、连接函数、电路元件、分析算法、数据导入导出、模板、UI 面板和自定义求解引擎整理成可分发插件协议；保持 NodeRecord/EdgeRecord 核心结构不变。

**设计交付**：
- `docs/adr/0002-plugin-extension-architecture.md`：24 条架构决策（插件包/manifest/API/依赖/生命周期/缺插件/数据边界/AnalysisSpec/EngineProtocol/工程 v6/管理页/简洁画布/视图设计）。
- `docs/EXTENSIBILITY_ARCHITECTURE.md`：完整规范（目标/不变式/包布局/`plugin.json`/加载状态机/`netlab.plugin_api.v1`/扩展点/数据契约/`EngineProtocol`/UI profile 与 `PanelSpec`/工程 v6/管理页/兼容/安全/测试验收/实施阶段）。
- `docs/GLOSSARY.md`：补插件包、manifest、plugin API、plugin registry、capabilities、unresolved node、plugin lock、simple canvas、UI profile、view design、PanelSpec、AnalysisResult、DataFormatSpec、EngineProtocol、plugin mode。
- `docs/EXTENDING.md`：顶部增加插件包入口与 legacy 说明。
- `docs/ARCHITECTURE.md`：顶部链接 + §8.6 插件包与全栈扩展（规划）。
- `docs/UI_SPEC.md`：§20 简单画布与视图内设计（规划）。
- `docs/REQUIREMENTS_AND_RULES.md`：R40 六段式、权重表、D99。

**关键决策**：现有 `SignalEngine`/`CircuitEngine` 不可替换；新求解引擎只能注册为新 mode；插件是受信任进程内 Python 包，不是沙箱；工程 `format_version` 计划升 6，`plugins` 锁段 + v5 自动迁移；缺插件降级打开；UI 只允许 `netlab-ui/1` 声明式配置，不执行任意 HTML/CSS/JS。

**验证**：`python -m pytest netlab/tests -q` → **581 passed, 3 warnings, 114.21 s, exit 0**（本次文档变更后基线复跑；无代码改动）。

**备份**：`NetlabExtras/backups/ProjectPoint_backups/netlab_r40_design_20261106_0030`（9 个文档 + `MANIFEST.sha256`，复核 mismatches=0）。

**状态**：设计文档已完成（2026-11-06）。代码实现待排期，实施阶段按 `EXTENSIBILITY_ARCHITECTURE.md` §14 执行；现有 581 项回归基线不受影响。

---

## §7.74 R40 全栈扩展架构实现（2026-11-06，代码完成）

**实现**：
- `netlab/plugin_api/v1`：稳定门面与 `ComputeSpec`/`MethodSpec`/`ElementSpec`/`AnalysisSpec`/`DataFormatSpec`/`TemplateSpec`/`PanelSpec`/`VisualSpec`/`EngineSpec`/`EngineProtocol`；插件只能依赖该门面。
- `netlab/core/model/plugins.py`：`PluginManager` 扫描 `extensions/plugins/*/plugin.json`，校验 schema/id/semver/`plugin_api`/netlab 范围/依赖拓扑/能力；支持 enable/disable/reload、`plugins_state.json`，插件登记 compute/method/element/analysis/data_io/panel/template/visual/engine。
- `netlab/core/compute/analysis_plugins.py`：统一 `AnalysisSpec` 注册与 `run_analysis()`；`netlab/core/model/engine_registry.py`：新 mode 的 `EngineSpec` 注册与 `create_engine()`，拒绝覆盖 signal/circuit/vector。
- 工程 `PROJECT_VERSION=6`：新增 `plugins` 锁段、`ui.profile="netlab-ui/1"`，v5→v6 自动迁移；`netlab/core/model/ui_profile.py` 提供主题令牌/布局/简单/专业模式归一化。
- `server.py`：启动扫描插件；新增 `/api/plugins` 管理接口、`/api/analysis/plugin`、`/api/ui`；`/api/catalog` 汇总插件/分析/引擎与 `format_version=6`。
- `frontend/app.js`：块库工具栏「插件管理」「视图设计」；插件列表/启用/禁用/重载/扫描；颜色令牌、布局 range、simple/professional 切换与 `/api/ui` 保存/启动加载。
- `extensions/plugins/README.md`：插件包目录、manifest 与 `netlab.plugin_api.v1` 示例。

**验证**：
- `python -m pytest netlab/tests -q` → **589 passed, 3 warnings, 83.05 s, exit 0**；新增 `test_plugin_manager.py` 3 条与 `test_project_v6_ui.py` 5 条；`python -m compileall -q netlab`、`node --check frontend/app.js` 通过。
- 静态版本 **3.20.1**（`frontend/app.js:19`、`frontend/index.html:8/:632`、`netlab/server.py:29`、`netlab/__init__.py:13`）。

**已知限制**：视图设计 v1 提供主题令牌/布局/模式切换，节点拖拽细节与面板字段编辑仍按后续迭代补充；插件为受信任进程内 Python 代码，不是安全沙箱；插件管理不做在线市场/自动下载。

**备份**：`NetlabExtras/backups/ProjectPoint_backups/netlab_3_20_0_20261106_0136`（36 文件 + MANIFEST.sha256，R40 代码 + 文档重构最终备份，mismatches=0）。

## §7.75 全量文档重构与演示资产（2026-11-06）

**范围**：README、根 ARCHITECTURE/OPERATION/INSTALL、netlab/docs 的 CODE_GUIDE/MATH/UI_SPEC/FRAMEWORK_CHEATSHEET/EXTENDING/GLOSSARY、DOCS_INDEX/DOCUMENTATION_PLAN/PLUGIN_GUIDE、ADR 0002；新增架构图与 28 秒演示视频。

**实现**：
- `README.md`：R31/R39/R40 能力矩阵、`version: 6`、插件/UI 能力、演示视频与架构图入口；`ARCHITECTURE.md`：五层架构/目录树/工程 v6/插件引擎/复频域/并网控制链；`OPERATION.md`：4 张演示图、R39 频响、R31 示例工程、R40 插件/视图设计与性能；`INSTALL.md`：WebView2/pywebview、离线依赖、插件目录与故障排查。
- `netlab/docs/MATH.md`：新增 §12 并网逆变器（Park、SRF-PLL、dq LCL、dq PI 解耦、桥延迟）与 §13 复数频响（复数图方程、复数 MNA、幅值/相位/dB、精度边界）；`CODE_GUIDE.md` 行数与模块；`UI_SPEC.md` §20 简单画布/视图设计；`FRAMEWORK_CHEATSHEET.md` R31/R39/R40 速查。
- 新增 `docs/assets/netlab-architecture.svg`（分层架构）与 `docs/assets/netlab-demo.mp4`（1280×720，28 s，6 页幻灯片）。

**验证**：
- `python -m pytest netlab/tests -q` → **589 passed, 3 warnings, 69.95 s, exit 0**；`python -m compileall -q netlab`、`node --check frontend/app.js`、`python -m netlab.desktop --selftest`（status 200 / shim_status 200）通过；`0xc0000139` 0 次。
- `ffprobe docs/assets/netlab-demo.mp4` → duration 28.0 s，size 260059 B；架构 SVG 6.4 KB。

**已知限制**：演示视频为 6 张幻灯片的 28 秒概览，不是逐功能录屏；视图设计 v1 使用离线 vendored iro.js 5.5.2 色轮（`frontend/vendor/iro.min.js`）并保留原生 `<input type="color">` 回退；插件为受信任进程内 Python 代码，不是安全沙箱。

**备份**：`NetlabExtras/backups/ProjectPoint_backups/netlab_3_20_0_20261106_0136`（36 文件 + MANIFEST.sha256，R40 代码 + 文档重构最终备份，mismatches=0）。


## §7.76 前端 JavaScript → TypeScript 全局迁移（规划，2026-11-06）

**状态：一期 P16 已完成——7 个文件（vscode 扩展、PlotKit `render2d`/`view3d`/`app`/`nsview`、netlab `desktop-shim`/`app.js`）全部严格类型化并通过 DoD（tsc strict 0、AST/行为等价、Python 契约测试全绿）；二期 P17 模块化已完成（P17.1 纯函数抽离+单测、P17.2 PlotKit ESM 化、P17.3 netlab 前端 ESM 化+纯函数拆分、P17.4 收尾全量验证全绿，版号三处一致、可 fast-forward 合并；决策 D112–D117 已并入 REQUIREMENTS 附录 C，原 `TS_P17_MODULE_DESIGN.md` 已删除，历史见 git）。** 需求与验收口径见 [REQUIREMENTS_AND_RULES.md](REQUIREMENTS_AND_RULES.md) R41 / §5 P16（一期类型化）/ P17（二期模块化，已完成）；决策 D100–D117。

**为什么做**：`frontend/app.js` 13,806 行单一大 IIFE、无类型无模块，维护成本高；`/api` 契约仅靠 Python 字符串匹配测试、前端无类型约束易漂移；缺模块化基建。

**范围（一期 P16）**：
- netlab：`frontend/app.js`（13,806 行）、`frontend/desktop-shim.js`（271）。
- PlotKit：`src/plotkit/static/app.js`（2,759）、`nsview.js`（1,371）、`render2d.js`（825）、`view3d.js`（867）。
- vscode 扩展：`vscode-extensions/netlab-sidebar/extension.js`（126，CommonJS；仅求兼容、非重点）。
- 排除：`netlab/tools/*.mjs`、`frontend/vendor/iro.min.js`。

**运行时红线**：零构建 / 零第三方运行时 / 离线；TS 仅开发期编译，产物 `.js` 提交并随包发布，仍 `<script>` 加载，不引打包器。

**打样顺序（由小到大）**：vscode 扩展 → PlotKit `render2d` → `view3d` → `app` → `nsview` → netlab `desktop-shim` → netlab `app.js`（最后、按功能区分块）。

**代码规范**：风格 / 语言特性以 Google TypeScript 风格指南为准，类型建模 / 迁移以 TypeScript 手册为准；`eslint`+`@typescript-eslint`+`prettier` 仅 devDependency 作开发期门禁（D106）。

### 迁移台账（每文件状态）

> 基线用 `netlab/tools/cdp_*.mjs` 录（DOM 快照 / 截图 / 控制台零报错 / 关键 `/api` 往返），存迁移分支 `docs/ts-migration/baseline/<日期>/`，可回测。状态取值：待开始 / 进行中 / 已完成（DoD 全过）/ 临时豁免（登记原因与 TODO）。**当前进度：第 1–7 个全部已完成（含 netlab `app.js`）；一期 P16 收官。**

| 文件 | 行数 | 期次/顺序 | 状态 | 基线 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `vscode-extensions/netlab-sidebar/extension.js` | 126 | P16 / 1 | ✅ 已完成 | 无需 e2e（tsc strict + node --check + vscode-stub 冒烟） | CommonJS，仅求兼容；提交 `cf9d633` |
| `PlotKit/src/plotkit/static/render2d.js` | 825 | P16 / 2 | ✅ 已完成 | 行为等价比对：`scripts/verify_render2d_parity.js` render+pick 727 步 canvas 操作一致 | 源 `render2d.ts` + 产物 `render2d.js`；提交 `885014b` |
| `PlotKit/src/plotkit/static/view3d.js` | 867 | P16 / 3 | ✅ 已完成 | 行为等价比对：`scripts/verify_view3d_parity.js` export keys + PALETTE + hexToRgba（6 组）+ parseFrame/Mesh/Volume/Particles + View3D API 共 21 项全一致 | 源 `view3d.ts` + 产物 `view3d.js`；提交 `394e979` |
| `PlotKit/src/plotkit/static/app.js` | 2,759 | P16 / 4 | ✅ 已完成 | AST 归一化等价比对（`scripts/verify_app_parity.js`，AST EQUAL）+ tsc strict 零错 + node --check + pytest 38 passed；无 any/@ts-nocheck | 源 `app.ts`（3,037 行）+ 产物 `app.js`；提交 `08691bd` |
| `PlotKit/src/plotkit/static/nsview.js` | 1,371 | P16 / 5 | ✅ 已完成 | AST 归一化等价比对（`scripts/verify_nsview_parity.js`，AST EQUAL 266293）+ tsc strict 零错 + node --check + pytest 470 passed；禁 any/@ts-* | 源 `nsview.ts`（1,534 行）+ 产物 `nsview.js`；提交 `795aaad` |
| `NetlabHome/frontend/desktop-shim.js` | 271 | P16 / 6 | ✅ 已完成 | AST 归一化等价比对（`tools/verify_desktop_shim_parity.js`，AST EQUAL 40124、token 2394==2394）+ tsc strict 零错 + node --check + pytest 21 passed；禁 any/@ts-*；alwaysStrict:false 防顶层 use strict 注入 | 源 `desktop-shim.ts`（376 行）+ 产物 `desktop-shim.js`；提交 `4eeed2e` |
| `NetlabHome/frontend/app.js` | 13,806 | P16 / 7（最后） | ✅ 已完成 | AST 归一化等价比对（`tools/verify_app_parity.js`，AST EQUAL 2183237==2183237）+ tsc strict 零错（基线 1,964 → 0）+ `node --check` + pytest 全量 **589 passed**；禁 any/@ts-*（banned=0）；产物与 HEAD `app.js` 字节一致（零 artifact diff） | 源 `app.ts`（15,066 行）+ 产物 `app.js`（562,404B）；提交 `7a5cdce` |

**DoD（每个文件全过才进下一个）**：①`tsc` strict + `eslint` 0 error + `prettier` 已格式化（或已登记临时豁免）②迁移前后 e2e 基线逐条一致、控制台 0 报错 ③现有 Python 契约测试全绿（改名 / 路径同步更新并保留）④版号三处同步（`frontend/index.html` `?v=`、`frontend/app.js` `UI_BUILD`、`netlab/server.py` `APP_BUILD`）⑤提交干净（精确 pathspec）。
**一期收尾门禁**：临时豁免清零、`tsc --strict` 全绿、全部 e2e 基线通过。

**下一步**：一期 P16 已收官——vscode 扩展 `cf9d633`、PlotKit `render2d` `885014b` / `view3d` `394e979` / `app` `08691bd` / `nsview` `795aaad`、netlab `desktop-shim` `4eeed2e` / `app.js` `753988e`（app.ts 修正提交；P16 原 `7a5cdce` 为中间态）全部完成。PlotKit 运行时内置副本已同步（`python -m netlab.plotkit_vendor install --force`，55 文件，vendor 忽略 `*.ts`、只随包 `.js`），提交 `0f41632`。待办：PlotKit 分支+tag 因代理 127.0.0.1:7897 暂断仍待补推；后续按 R42/P18 做 Python PEP 8 规范化。二期 P17：P17.1 纯函数抽离+单测 `958a509`、P17.2 PlotKit ESM 化已完成（PlotKit `render2d/view3d/app/nsview` 转 module、index/ns `type=module`、netlab `plotkit_bridge.py` shim 锚点改 `find("<script")`、vendor 重装 57 文件）；P17.3 netlab 前端 ESM 化 + 纯函数拆分（`frontend/app.utils` + node 单测）已完成；P17.4 收尾完成（全量验证全绿、版号三处一致 3.20.1、两仓库 feat 可 fast-forward 合并），待网络补推后合并；决策 D112–D117 见 REQUIREMENTS 附录 C（原设计文档已删除）。

**R42/P18 已完成（2026-11-06）**：netlab 121 个 .py、PlotKit 92 个 .py 经 `black` 做 PEP 8 规范化（AST 等价、行为不变）；提交 netlab `3673808`、PlotKit `32587c4`（均已推 `feat/ts-migration`）；`pytest netlab/tests` 589 passed、PlotKit 470 passed、`node test:utils` 19 passed。

---

### §7.76 附：GUI e2e 基线（2026-11-06）

- 工具：`tools/gui_smoke.py`（起 pywebview/WebView2 真窗口跑 `python -m netlab.desktop --probe`）；基线 `netlab/docs/ts-migration/baseline/2026-11-06/gui-probe.json`。
- 冒烟项：`has_bridge=true`、`has_win_ctl=true`、`has_command=true`、`has_autosave_roundtrip='true'`（JS→Python 往返）、`drag_region=29`；标题「Netlab · 可解释仿真环境」。
- 测试：`netlab/tests/test_gui_smoke.py`（默认 skip；`NETLAB_GUI_SMOKE=1` 启用，1 passed）。连跑两次与基线一致。
- 结论：一期 P16 类型化后 GUI 壳与前端仍正常运行、桥接可用。

---

## §7.77 文档体系整理（2026-11-06 15:45）

**状态：完成**。用户指出 `REQUIREMENTS_AND_RULES.md` 未更新，并要求整理文档：重复文档合并、已完成文档删除、按原文档规范操作。

**需求台账**：
- `REQUIREMENTS_AND_RULES.md` 新增 **R43 数学成果接入（P1 稀疏排序 / P3 AC 扫频 Woodbury / P5 遥测误差预算，影子验证）**，六段式齐全。
- 附录 C 补录 **D112–D117**（自 `TS_P17_MODULE_DESIGN.md` 合并，P17 已完成）与 **D118**（数学成果接入决策）；全文口径统一为 **R01–R43 / D1–D118**。
- §0/§1/§4.1/§5 同步：新增 P19（M1 数学接入）；P17 状态改为已完成。

**文档索引**：
- `DOCS_INDEX.md` 基线更新为 **静态 3.20.1 / 589 passed / R01–R43 / D1–D118**。
- §2.2 新增 `MATH_INTEGRATION_PLAN.md`（当前）与 `UNIFIED_SIM_MATH_SPEC.md`（研究，部分 §17）索引。
- §3 登记删除 **7 个已完成/过期文档**：`DOCUMENTATION_PLAN.md`、`IMPLEMENTATION_PLAN.md`、`QT_NATIVE_SPEC.md`、`NGSPICE_SOLVER_COMPARISON.md`、`SOLVER_OPTIMIZATION_PLAN.md`、`SOLVER_OPTIMIZATION_REPORT.md`、`TS_P17_MODULE_DESIGN.md`（原文见 git 历史）。
- §4 新增文档分层规则与“已完成计划删除/同类合并”规则。

**同步**：`BACKLOG.md` 口径改为 R01–R43 / D1–D118、3.20.1；`PROGRESS.md` 需求口径与当前阶段同步。

---

## §7.78 R43 M1 数学加速影子实现（2026-11-06 18:30）

**状态：M0/M1b 完成；M1c/M1d 未开始**。用户要求按文档规范开始改底层代码并从 main 新开分支。

- 分支：`feat/math-accel-shadow`（从 `main` 新开，未带入 `feat/ts-migration`）。
- M0（mathspec）：新增 `experiments/ac_sweep_woodbury.py`（双参数仿射族 + Woodbury）与 `experiments/ordering_eval.py`（COLAMD/MMD_ATA/MMD_AT_PLUS_A/NATURAL + RCM/MIN_DEGREE/NESTED_DISSECTION 评测）；新增测试 9 条，mathspec 全量 **107 passed in 5.66s**。
- M1b（netlab）：新增 `netlab/core/compute/math_accel/{config,diagnostics,woodbury_ac,__init__}.py`；`nodal.ac_sweep` 增加 `off|shadow|on` 分支——默认 off 行为不变，shadow 只对拍不生效，on 在 `r/n≤0.10` 走 Woodbury、`0.10<r/n≤0.25` 仅影子、`>0.25` 直接解；条件数/主元守卫 + 残差修正。
- 测试：`netlab/tests/test_math_accel.py` **5 passed**；`test_solver_analysis.py`+`test_complex_support.py` **22 passed**；netlab 全量 **594 passed, 1 skipped in 101.71s**。
- 性能实测（2026-11-06，RC 梯形）：2001 频点/101 节点：off 1131.5 ms / shadow 1305.1 ms / on 755.7 ms（**1.50×**）；501 频点/201 节点：off 966.8 ms / on 463.0 ms（**2.09×**）。`on` 路径已加 fast path：复用 `base_matrix/base_rhs`，跳过逐频点重复 stamp；收益随规模增长。
- 文档：`MATH_INTEGRATION_PLAN.md` 升 v1.1（§11 实施记录、里程碑状态）、REQUIREMENTS R43 现状、BACKLOG M1 行同步。

**验证**：`docs/specs/*` 作为已实现功能的验收证据保留；mathspec 最近一次全量 `python -m pytest mathspec/tests -q` = **107 passed**（不影响 netlab 594 passed 基线）。

---

## §7.79 R43 M1a P1 排序评测 + M1c P5 遥测（2026-11-06 18:40）

**状态：M1a/M1c/M1d 完成**。

- **P1（M1a）**：新增 `netlab/core/compute/math_accel/ordering_eval.py`（只读导出真实 MNA 矩阵 + 7 种排序对照）与 `tools/eval_mna_ordering.py`；`netlab/tests/test_ordering_eval.py` 3 条通过。真实语料只有 2 个 circuit 工程（`grid_inverter_switch.netlab` 23 阶、`未命名工程.netlab` 7 阶），计时抖动明显，**1/2 达标，未通过 DoD → 生产 `_solve_sparse` 保持 COLAMD 不替换**。合成电路状矩阵 n=400 上 `MMD_AT_PLUS_A` factor 0.793×、fill 0.625×，作为扩大语料后的观察信号。报告：`mathspec/research/P1_ORDERING_REPORT.md` / `P1_ORDERING_RESULTS.csv`。
- **P5（M1c）**：`Recorder.quality` 固定 schema（`sample_dt`/`quant_bits`/`interp_error_bound`/`fifo_depth`/`delay_bound`/`assumptions`）、`Recorder.quality_snapshot()`、`Simulation.telemetry_quality()`；`server.py` 新增只读 `GET /api/diagnostics/telemetry` 与 `GET /api/diagnostics/math-accel`，`/api/live` 顶层结构与行为零变化。`netlab/tests/test_telemetry_quality.py` 4 条通过。
- **文档**：`MATH_INTEGRATION_PLAN.md` 升 v1.3（§11 补 M1a/M1c 实施记录）；REQUIREMENTS R43 现状、BACKLOG M1 行同步。
- **测试**：netlab 全量 **602 passed, 1 skipped in 116.37s**；mathspec 107 passed。
- **小矩阵守卫（M1b 收尾）**：新增 `AC_WOODBURY_MIN_SIZE=160`。实测 501 频点：n=51 off 71.3ms/on 77.7ms（0.92×）、n=101 173.9/171.1（1.02×）、n=201 1027.8/647.1（1.59×）、n=301 5187.9/1070.3（4.85×）；n<160 直接回退稠密解，`test_math_accel.py` 增至 6 条。

