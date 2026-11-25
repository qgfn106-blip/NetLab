# 前端职责矩阵与分层边界（Frontend Responsibility Matrix）

> 基线：5c076ea ｜ 版本：NetLab 3.20.2 ｜ 分支：feat/2026-11-24-p1-convergence
> 目的：落实 P1-02「梳理前端职责」。本文定义模块层、依赖方向、现状违规与后续拆分路径；P1-01 的代码拆分结果同步记录。

## 1. 分层模型

| 层 | 职责 | 允许依赖 | 禁止 |
|---|---|---|---|
| entry/router | 启动、DOM 装配、endpoint 注册、全局事件 | 任意下层 | 被下层 import |
| service | 网络/桌面桥/缓存/导出等外部能力封装 | util/model | 直接操作业务视图 DOM |
| model | 状态、数据结构、纯计算、序列化 | util | DOM、网络、全局单例副作用 |
| render | 把 model 转成 DOM/图表产物 | model、util、render 组件 | 发起网络请求、持久化 |
| interaction | 指针/键盘/滚轮/命令到 model 的映射 | model、render、service | 直接写持久化或协议 |
| facade | 对外稳定 API，只做装配与委托 | 本层以下全部 | 承载具体渲染/交互算法 |
| util | 无业务语义的纯函数 | 无 | 反向依赖业务层 |

依赖方向固定为：`entry → facade → interaction → render → model → util`；service 可被任何层使用，但 service 不得反向 import 视图层。

## 2. 模块职责矩阵

### 2.1 入口与全局

| 模块 | 行数 | 层 | 职责 | 现状/边界问题 |
|---|---:|---|---|---|
| frontend/app.ts | 5390 | entry/router | 88 endpoint、会话状态、全局事件、视图刷新、命令分发 | **单体入口**，213 嵌套函数；已抽工作台面板/图表渲染/场景面板/场景动作/回放控制/信号列表，S1 端点注册表完成，仍待 S2-S4 |
| frontend/app/state.ts | 266 | model(全局) | `state`/`ui` 可变单例 | 被大量模块共享；禁止在 model 纯函数内改它 |
| frontend/app/types.ts | 502 | model | 全前端类型定义 | 类型聚合，无运行时代码 |
| frontend/app/constants.ts | 153 | model | UI 常量、颜色、限制值 | 纯常量 |
| frontend/app/dom.ts | 176 | util | DOM 查询与画布上下文 | 页面启动时绑定，须先于业务模块 |

### 2.2 电路编辑与画布

| 模块 | 行数 | 层 | 职责 |
|---|---:|---|---|
| inspector.ts / instruments.ts / spec_panel.ts | 713 / 486 / 470 | interaction+render | 属性面板、仪器、参数面板 |
| project.ts | 514 | model/service | 工程读写、快照、序列化 |
| geometry.ts / circuit_symbols.ts / canvas_base.ts | 484 / 385 / 365 | render | 几何、符号、画布基元 |
| canvas_render.ts / canvas_nodes.ts / canvas_edges.ts / canvas_glyphs.ts | 308 / 264 / 224 / 223 | render | 节点/边/图元绘制 |
| chart_draw.ts / plotkit_data.ts / plotkit_frame.ts | 213 / 360 / 179 | render | 图表绘制与 PlotKit 数据/帧适配 |
| phase.ts / ac_analysis.ts / analysis.ts | 375 / 131 / 730 | model | 相图、AC、分析数据模型与 API 客户端 |

### 2.3 分析工作台（P1-01 重点）

| 模块 | 行数 | 层 | 职责 |
|---|---:|---|---|
| analysis_workbench.ts | 800 | facade | 工作台壳、会话/状态选择、对外 API；已降至门禁上限 |
| analysis_workbench_actions.ts | 426 | interaction | 运行/对比/导出等命令动作 |
| analysis_workbench_canvas.ts | 774 | facade/interaction | 子画布登记、布局树操作、标签页/分割 |
| analysis_workbench_canvas_ids.ts | 52 | model(纯函数) | 画布/标签页 id 与布局树深拷贝（P1-01 新抽出） |
| analysis_workbench_chrome.ts | 78 | interaction | 侧栏拖拽、尺寸、折叠/专注态、UI 记录组装、光标映射（P1-01 新抽出） |
| analysis_workbench_layout_tree.ts | 372 | model | v2 布局树纯函数（root/split/tabs/merge/normalize） |
| analysis_workbench_layout.ts | — | model | UI 记录读写与 schema 归一化 |
| analysis_workbench_results.ts | — | render | 对比表/指标/传函摘要 HTML |
| analysis_workbench_chart_settings.ts | 377 | interaction+render | 图表外观设置对话框 |
| analysis_workbench_loops.ts | 146 | render | 环路列表 HTML 与断点建议 |
| analysis_workbench_meta.ts | — | model | kind 标签/提示/状态色/工具函数 |
| analysis_chart.ts | 786 | facade | 图实例生命周期、对外 API、委托渲染/交互 |
| analysis_chart_spec.ts | 133 | render(纯函数) | PlotKit spec 组装：panel/scale/grid（P1-01 新抽出） |
| analysis_chart_detail.ts / analysis_chart_appearance.ts | 264 / 238 | model+render | 详情 HTML、外观类型与归一化 |
| analysis_chart_plot.ts / analysis_chart_utils.ts | — | render/util | PlotKit 绘图适配与坐标工具 |

### 2.4 服务与窗口

| 模块 | 行数 | 层 | 职责 |
|---|---:|---|---|
| desktop.ts / float.ts | — / 176 | service/interaction | 桌面桥、浮动窗口 |
| export_dialog.ts | 175 | interaction | 导出对话框 |
| docs.ts / settings_guide.ts | 284 / 163 | render | 文档页与设置引导 |
| appearance.ts / appearance_controls.ts / appearance_panel.ts | 236 / 255 / 167 | model+render | 外观状态、控件、面板 |
| cache.ts | 128 | service | 分析结果缓存 |

> 完整 76 个 app 模块的行数以 `wc -l frontend/app/*.ts | sort -nr` 为准；本表只列职责代表模块。

## 3. 现状违规与风险

1. **入口单体**：`frontend/app.ts` 原 7511 行、单 IIFE、88 endpoint、213 嵌套函数，承担路由/状态/视图/命令/网络五类职责；本地分支六片抽取 + S1 端点注册表后 5390 行，仍是 P1-02 的核心拆分对象。
2. **全局可变单例**：`state.ts` 的 `state`/`ui` 被入口与多个视图共享；拆分时最容易出现隐式闭包依赖，必须先冻结读写接口再搬迁。
3. **模块接近门禁上限**：`analysis_workbench.ts` 恰好 800 行，任何新增字段都会再次超限；后续应继续按 render/interaction 抽离，而不是压缩格式。
4. **ends 命名空间**：`analysis_workbench_canvas_ids.ts` 只放纯 id/深拷贝函数，避免 canvas 模块继续膨胀（已落地）。
5. **无反向依赖**：当前未见 render/model import `app.ts`；后续拆分须保持该约束，否则入口无法收敛。

## 4. P1-01 落地结果（本次）

| 原模块 | 拆分前 | 拆分后 | 新模块 | 验证 |
|---|---:|---:|---|---|
| analysis_chart.ts | 878 | 786 | analysis_chart_spec.ts（133 行，纯 render） | `tsc --noEmit` RC=0；parity OK（86 TS/859 声明/76 运行模块/3 类型） |
| analysis_workbench_canvas.ts | 823 | 774 | analysis_workbench_canvas_ids.ts（52 行，model 纯函数） | 同上 + `test:utils` 88 passed |
| analysis_workbench.ts | 837 | 800 | analysis_workbench_chrome.ts（78 行，interaction） | 同上 + `check:sections` S5 OK |

行为等价依据：拆分仅移动纯函数/方法体，方法签名与调用点不变；`verify_app_parity.js` 对导出声明与签名逐项比对通过，快照/单元测试全绿。

## 5. P1-02 后续拆分路径（建议，按小步）

| 阶段 | 动作 | 验收 |
|---|---|---|
| S1 | 从 app.ts 抽出端点声明式注册表（纯映射，不改行为）✅ 已完成 ea8413d | endpoint 快照 50 个规范化路径完全一致（前端路径口径；88 为后端 endpoint 总数口径） |
| S2 | 抽出 `app/store.ts`（会话/状态读写接口），入口改为注入 | 快照测试 + 启动冒烟 |
| S3 | 抽出 `app/commands.ts`（事件命令），入口只保留绑定 | 交互快照一致 |
| S4 | 抽出 `app/views.ts`（渲染刷新），入口仅装配启动 | 行数门禁 + 端到端冒烟 |

回滚：每阶段独立文件 + 单处装配改动，可单独 revert；任何阶段不得改变 endpoint 路径、状态字段名或持久化 schema。

## 6. 验证命令

```bash
cd frontend
npx tsc --noEmit -p tsconfig.json
npm run test:utils
npm run build && node tools/verify_app_parity.js
node tools/check_app_sections.mjs
```

最近一次结果（本轮场景面板抽取后）：`tsc` RC=0；`test:utils` 90 passed / 0 failed；parity `OK: app.ts parity passed (base=HEAD, 90 TS files, 941 top-level declarations, 80 runtime app modules, 3 type-only)`；`check_app_sections` `OK: S5 size limits passed`。
