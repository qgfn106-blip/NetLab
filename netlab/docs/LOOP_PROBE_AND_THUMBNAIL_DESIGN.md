# 环路探针与环路缩略图设计方案

- 状态：已实现核心目标①②＋解析开环 L(s)，③虚拟支路探针（`analysis.loop_analysis(..., loop_probe={break_id, loop_id})`：按用户点选的反馈支路找所属闭合环，在分析副本中选环内已有 VCVS/VCCS 作矩阵级断点，不向电路插入 BRK；环内无线性受控源时 fail-closed 仅显示闭环 T(s)），⑤信号流候选环后端枚举（`analysis.loop_candidates` + `/api/analysis/loops/candidates`），电路模式按支路选环（`analysis.loop_from_break` + `/api/analysis/loops/from-break`），以及④⑤环路缩略图交互前端（`analysis_workbench_loops.ts`：SVG 缩略图、点击一次选中整环、自动填 member_node_ids/member_edge_ids 快照、把环内 VCVS/VCCS 断点同步到断环元件）
- 日期：2026-11-21（同日完成核心断环修复）
- 实现要点：`loop_analysis` 新增可选 `loop_probe`（LoopProbeSpec：break_id/loop_id），虚拟探针优先于旧 `element=VCVS/VCCS` 路径，返回体带 `loop_id` 与 `probe="virtual_branch"`；无实体断环只返回闭环 T(s)（transfer_role=closed_loop，open_loop_transfer_function.supported=False，绝不冒充开环）；实体 VCVS 断环返回数值 L(s) 并附解析表达式（与数值返回比一致性校验，>1e-6 即 fail-closed）；前端按 role 分别渲染「开环 L(s)」「闭环 T(s)」。
- 运放电路补充：无 VCVS/VCCS 时可在**全局反馈电阻支路**上断开，向求和节点注入测试电流、测量支路返回电压，按 return ratio 求真实外环 L(s)；`extract_branch_loop` 不切断运放局部反馈，`branch_candidates` 把下游输出→上游反相输入的反馈电阻排到候选首位。`控制工程实验2_闭环分析示范.netlab` 已验证 L(s)=100/[s(s+10)]、相位裕度约 51.8°。
- 作用域：分析工作台“环路”模式、断环建模、缩略图交互
- 关联代码：
  - `netlab/core/compute/analysis.py`
  - `netlab/core/compute/circuit/loop_analysis.py`
  - `netlab/core/model/graph.py`
  - `frontend/app/analysis_workbench*.ts`

## 1. 背景与问题

用户提出：**“一个环路中有多个节点与部件，一个一个设置不现实，是否可以通过流式缩略图，直接进行分配。”**

当前分析工作台存在三个相互关联的问题。

### 1.1 无实体断环时把闭环传函当成开环

`_virtual_loop_analysis` 在 `analysis.py:1691` 调用 `tf_analysis(...)`，得到的是原电路在输入源到输出节点之间的**闭环 T(s)**；随后：

- `analysis.py:1752` 将它命名为 `open_loop_transfer`；
- `analysis.py:1753` 再调用 `closed_loop_transfer_function(open_loop_transfer)`，等于对已闭合系统做二次反馈；
- `analysis.py:1778-1780` 以 `transfer_role='open_loop'` 返回；
- 前端 `analysis_workbench_results.ts:33-40` 因此把它显示为“开环 G(s)”。

这会产生类似：

`9.99939 / (s^2 + 10.0002s + 99.996)`

的“开环”表达式；其中 `99.996` 实际是闭环系统的 `omega_n^2`，不是开环积分环节的常数项。真实开环应为：

`L(s) = 100/[s(s+10)] = 100/(s^2 + 10s)`

### 1.2 物理断环分支没有返回真实 L(s)

`analysis.py:2001-2003` 的 `physical_transfer` 是原电路直接闭环 `T(s)`，返回时又被标成 `transfer_role='closed_loop'`（`analysis.py:2053-2054`）。因此 UI 即使选了实体断环元件，也无法显示真实开环表达式，只能显示闭环 `T(s)`。

### 1.3 现有断环实现依赖受控源，必须插入 VCVS

`loop_analysis.py:35` 只定义 `_CONTROLLED_KINDS = ("vcvs", "vccs")`；`break_candidates()`（`loop_analysis.py:68-86`）只扫描受控源；`_broken_matrices()`（`loop_analysis.py:111` 起）只对受控源支路打补丁。

因此示范工程只能在反馈线 `wire-38` 上串入增益为 1 的 VCVS `BRK` 作为“断环夹具”。它不改变闭环动态，但改变了工程结构，不应作为最终方案。

## 2. 概念定义

必须区分两个量：

- **闭环 T(s)**：原电路、原反馈拓扑不变，只确定输入源与输出节点后直接求得的小信号传函。
- **开环 L(s)**：选定断点，将环路暂时断开；在其他独立源置零的条件下注入测试激励，测量返回量，按 return ratio 定义求得的环路增益。

对于负反馈：

`T(s) = L(s) / (1 + L(s))`

但 `L(s)` 不能由 `T(s)` 反推后冒充原系统的开环；它必须来自真实断环或等价的返回比测量。

## 3. 目标与非目标

### 目标

1. 无实体断环时只显示闭环 `T(s)`，绝不标成“开环 G(s)”。
2. 有断环时返回真实 `L(s)`，并单独返回/显示闭环 `T(s)`。
3. 断环不修改用户保存的电路，不要求插入 VCVS；使用分析层虚拟探针。
4. 用户通过环路缩略图一次点击选中整条环，自动分配 `member_node_ids` / `member_edge_ids`，不需要逐节点设置。
5. 支持信号流与电路两种模式；信号流优先自动检测，电路模式以用户点选反馈支路为准。

### 非目标

- 不改变 `NodeRecord` / `EdgeRecord` 的电气语义。
- 不把 `loop_id` 写进元件参数或 MNA 矩阵。
- 首期不支持含延迟环节 `e^{-sT}` 的精确开环传函（延迟边按状态边界处理，另行标注）。
- 首期不承诺自动枚举任意复杂电路的全部最小反馈边集。

## 4. 数据模型

环标记属于分析层，不属于电路元件。

```text
LoopGroup {
  loop_id: string
  label?: string
  member_node_ids: string[]
  member_edge_ids: string[]
  break_kind: "signal_edge" | "circuit_branch"
  break_id: string
  feedback_sign: 1 | -1  # 1=负反馈（分母 1+L），-1=正反馈（分母 1-L）
}

LoopProbeSpec {
  loop_id: string
  break_id: string
  injection: "voltage_series" | "current_shunt"
  source_value: number
}
```

节点函数只需要可选的 `loop_ids` 用于高亮和归属显示：

```text
node.data.loop_ids = ["loop-1", "loop-2"]
```

不能只用节点函数里的 `is_loop: true`：一个环跨越多个节点与部件，真正的断点必须在 `break_id` 指向的边/支路上。

## 5. 交互流程

### 5.1 环路缩略图

分析工作台打开“环路”分析后，显示一个可交互缩略图：

- 复用当前 schematic 画布的节点/导线渲染，缩放到小窗口；
- 每个候选环路使用独立颜色和箭头高亮；
- hover 显示：`loop_id`、成员节点数、成员边数、建议断点；
- 点击环路上的任意反馈线或受控源输出端，选中整条环；
- 多个候选返回路径时，列表显示“候选 1 / 候选 2”，由用户点选；
- 确认后一次性生成 `LoopGroup`，不需要逐节点点击。

```mermaid
flowchart LR
  A[打开环路分析] --> B[后端返回候选环]
  B --> C[缩略图高亮环路]
  C --> D[用户点击一条反馈线]
  D --> E[反向路径搜索]
  E --> F{返回路径数量}
  F -->|1 条| G[生成 LoopGroup]
  F -->|多条| H[列出候选环]
  H --> G
  G --> I[内部测试源断环]
  I --> J[返回 L(s) 与 T(s)]
```

### 5.2 环标记分配

选中环路后：

1. 系统自动填 `member_node_ids` / `member_edge_ids`；
2. 默认把用户点击的边设为 `break_id`；
3. 右侧下拉可改“建议断点”，但成员分配不再需要用户操作；
4. 节点函数上的 `loop_ids` 自动同步，仅用于显示。

## 6. 环检测算法

### 6.1 信号流模式

使用有向连接图：

- 只取 `connection.enabled == true` 且 `connection.delay == false` 的边；
- 对图做 Tarjan SCC（`graph.py:520` 的 `_strongly_connected_components`）；
- SCC 节点数 > 1 或存在自环，即为一个反馈环；
- `graph.py:567-581` 的 `algebraic_cycles()` 已有该逻辑，但目前只返回节点名，需要扩展为返回环成员边及候选断点。

对于多个环：

1. 先按 SCC 分组；
2. 对每个 SCC 选择一条反馈边（优先用户点击的边）；
3. 删除该边后重新跑 SCC；若仍成环，继续选边，直到图成为 DAG；
4. 得到反馈边集；每个独立环生成一个 `LoopGroup`。

最小反馈边集是 NP-hard；工程实现采用“用户选择 + 删除后重检”的贪心策略，不承诺全局最小。

### 6.2 电路模式

电路不能用“节点/导线 SCC”直接判断：理想导线和地线会把整个网络并成一个巨大 SCC。

建议流程：

1. 用并查集把 `wire` 连接的节点合并成“电气网络节点”（net）；
2. 以 net 为顶点、器件为边构图；
3. 对受控源增加控制方向：`control_a/control_b -> output_a/output_b`；
4. 用户点击一条候选反馈线 `u -> v` 后：
   - 暂时删除该边；
   - 从 `v` 到 `u` 做 BFS/DFS，找返回路径；
   - 若存在路径，路径上的 net/器件加点击边组成一个 `LoopGroup`；
   - 若不存在路径，提示“该线不在闭合反馈环中”。

自动候选可以只先扫描受控源：

- 从 `output_a/output_b` 出发，沿无源网络找 `control_a/control_b`；
- 找到可达路径时生成候选环；
- 无源网络路径不唯一时，交给缩略图让用户点选，不自动拍板。

### 6.3 标记验证

删除 `break_id` 后必须满足：

- 图模型重新检测时不再形成该环；
- 电路测试源返回量非零；
- 若 `T_direct` 可用，验证 `T_direct` 与 `L/(1 + feedback_sign * L)` 数值一致。

验证失败时分析必须 fail-closed，不能返回一个看似合理的假开环。

## 7. 后端实现

### 7.1 新接口

建议在 `break_points()` 基础上扩展（保留旧字段兼容）：

```text
loop_candidates(sim, operating_point=None) -> {
  ok: true,
  loops: [{
    loop_id,
    label,
    member_node_ids,
    member_edge_ids,
    candidate_breaks: [{break_id, kind, suggested}],
    suggested_break_id,
    feedback_sign
  }]
}
```

`loop_analysis` 新增可选参数：

```text
loop_probe: LoopProbeSpec | None
```

有 `loop_probe` 时优先走虚拟断环；旧 `element=VCVS/VCCS` 路径保留兼容，但不再要求 UI 创建 VCVS。

### 7.2 内部断环

在 `loop_analysis.py` 中新增：

- `_break_branch_matrices(model, break_id)`：复制 `DescriptorModel` 矩阵，在指定支路插入 0V 串联测试源（或电流测试源）；
- 求解测试激励到返回量的传函；
- 返回 `L(s)` 的频率响应和可解析表达式（若不能解析，只返回频域数组并明确标注）。

电气模型本身不修改；所有矩阵补丁只在分析用副本上完成。

### 7.3 返回字段

- `transfer_function`：真实 `L(s)`，`transfer_role='open_loop'`；
- `closed_loop_transfer_function`：原电路直接 `T(s)` 或 `L/(1+L)` 合成值，注明来源；
- `loop_gain`：频域数组保留；
- `transfer_role` 只能取 `open_loop` / `closed_loop`，不再用 `open_loop` 表示闭环。

## 8. 前端实现

主要改动文件：

- `analysis_workbench_meta.ts`：新增 `LoopGroup` 类型和环路候选选项；
- `analysis_workbench.ts`：侧栏增加“环路缩略图”区域；
- `analysis_workbench_actions.ts`：点击边时生成 `loop_probe`，不再只读 `[data-awb=element]`；
- `analysis_workbench_results.ts`：按 `transfer_role` 分开渲染“开环 L(s)”和“闭环 T(s)”；
- 新增 `analysis_workbench_loops.ts`：缩略图、路径高亮、候选环列表。

UI 约束：

- 缩略图不参与主画布缩放，不改变布局；
- 选择环只改变分析参数，不改变工程拓扑；
- 无实体断环时显示“当前为闭环 T(s)，未断环，无法给出开环 L(s)”；
- 不再出现 `BRK` 这种仅为分析的 VCVS。

## 9. 测试与验收

### 单元测试

- 信号流 SCC：单环、双环、共享边、含 delay 边；
- 电路并查集：导线合并后 net 数正确；
- 点击边返回路径：简单 RC、运放反馈、无环支路；
- `LoopGroup` 成员完整性：节点/边集合与高亮一致。

### 数值验收

用控制工程实验2：

- 原电路直接 T(s) = 100/(s^2 + 10s + 100)；
- 内部断环 L(s) = 100/[s(s+10)] = 100/(s^2 + 10s)；
- `T_direct` 与 `L/(1+L)` 数值一致，相位裕度约 51.8 度；
- 不含 `BRK` VCVS 的工程也能得到上述结果。

### UI/E2E

- 打开缩略图，点击反馈线，整条环一次性高亮；
- 页面显示“开环 L(s)”而非假开环；
- 切换 `loop_closed` 显示“闭环 T(s)”；
- 工程保存后无 VCVS 辅助元件；
- 截图留存。

## 10. 实施阶段

- **P0**：数据模型、环路候选 API、信号流 SCC 扩展；
- **P1**：电路 net 图 + 点击边反向路径搜索；
- **P2**：DescriptorModel 虚拟支路断环，返回真实 `L(s)`；
- **P3**：缩略图 UI、环路一次性分配、结果渲染；
- **P4**：删除示范工程 `BRK`，补齐数值/E2E 回归，更新文档。

## 11. 开放问题

1. 多条返回路径时默认选哪条：最短路径、最低阶路径还是用户上次选择。
2. 嵌套环/共享边是否需要独立 `LoopGroup`，还是允许一个环组包含多个独立环。
3. `LoopGroup` 是否随工程保存；若保存，放在 `ui.analysis_workbench` 还是独立分析会话。
4. 含 delay 边的反馈环是否只允许频域数值分析，不提供有理表达式。
5. 受控源断环旧接口保留多久，何时移除 `BRK` 兼容路径。

## 12. 验收清单

- [x] 无实体断环不显示“开环 G(s)”
- [x] 物理/虚拟断环返回真实 L(s)
- [x] 缩略图点击一次完成整环分配
- [x] 不修改主电路、不要求 VCVS
- [x] T_direct 与 L/(1+L) 数值一致
- [x] 信号流与电路两种模式均有回归测试
- [x] 示范工程保存文件中没有 BRK
