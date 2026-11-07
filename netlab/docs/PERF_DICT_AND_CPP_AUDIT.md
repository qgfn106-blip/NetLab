# netlab 性能审计：哈希表结构与瓶颈 / C++ 重写评估

> 生成：2026-11-08（只读审计；两条并行线合成）。所有结论带 `file:line` 证据；标注“待验证”的项需实测确认。

## A. 哈希表（dict）结构与内存审计

### A.1 主要 dict 结构清单
- **Scene 容器**：`Scene.nodes: dict[str,NodeRecord]` scene.py:919；`Scene.edges: dict[str,EdgeRecord]` scene.py:920；`Scene.block_instances: dict[str,BlockRuntime]` scene.py:924。
- **NodeRecord**（@dataclass，无 slots）scene.py:105-118：7 个 dict 字段（params/data/state/inputs/position/size/appearance）；`inputs: dict[str,dict]`。字段路径 `scene→nodes→{id}→params→{key}→值` 约 4–5 层。
- **EdgeRecord** scene.py:144-170：params/state/waypoints/anchors/layout/appearance。
- **SignalEngine** scene.py:222-227：`node_map`、`edge_map`、`block_runtimes`、`block_buffers: dict[str,dict[str,dict[str,Any]]]`（4 层）。
- **NetworkContainer** networks.py:37-41：`_entries/_names/_order/_states`，经 `__getattr__` 代理当前 Simulation（隐式委托）。
- **graph.Network** graph.py:366-374：`nodes:list`、`connections:list`、`_incoming:dict[Node,list]`（惰性索引）。
- **注册表**（扁平、健康）：`COMPUTE_SPECS` computes.py:63、`ELEMENT_SPECS` nodal.py:1010、`ENGINE_SPECS` engine_registry.py:14、`_BEHAVIOR_SPECS` builtins.py:509。
- **CircuitSolver** nodal.py:1631 `node_voltages:dict[str,float]`、`index`（_build_index 1644）。
- **Recorder** simulation.py:105-108：`frames=deque(maxlen)`、`_keys:list`。
- **项目载荷** project.py:122-126：scene/sim/states 整包 deepcopy。

### A.2 嵌套 / 镜像 / 可变共享
- **可变共享（根问题）**：`Node(data=record.data, params=params, state=record.state, inputs=record.inputs)` scene.py:236-246——同一可变 dict 被 Scene 与引擎同时持有；故 restore 只能原地 clear/update（scene.py:447-457），浅拷贝会漏。
- **浅 copy 残留**：`EdgeRecord.snapshot` 对 waypoints/anchors/layout 仅 `dict()` 浅复制（scene.py:187-189），内层 list 多处共享。
- **一次读字段穿 3 层 + 2 次深拷贝**（热轮询）：runtime_state 逐 edge `record.snapshot()`(scene.py:1083) + `engine.edge_map.get(id)`(1086) + `copy.deepcopy(connection.output)`(1088)。
- **块数据镜像**：实例化逐边 `copy.deepcopy(edge.params)` blocks.py:913/1085。

### A.3 内存放大点
- **每条记录无 `__slots__`**（scene.py:105/144）：每实例多 `__dict__`(~300–400B)+7 内嵌 dict；单节点结构开销约 1.5–2.5KB（不含值）。
- **每步整场 deepcopy（最重）**：`Simulation._advance_locked` 无条件 `scene.capture_checkpoint()`（simulation.py:327；scene.py:420-440）深拷贝所有 node.data/state/inputs + edge.state + block_buffers + block runtime；Circuit/Nodal 侧再加 `_capture_element_state` 逐元件深拷贝（nodal.py:1735-1759）。稳态每秒 60×N 次。
- **每次 HTTP 轮询整场快照**：runtime_state 深拷贝全节点/边（scene.py:1100/1083/1088），被 server.py:1369/1479/2079/2325 调用。
- **项目 load/save 巨量 deepcopy**：project.py:301-577 数十处 `copy.deepcopy(scene)`、313 逐节点、345/383 逐边；json 全量 dumps 66/770；webview_bridge.py:52 `json.loads(json.dumps(blocks))` 圆整拷贝。

### A.4 查询复杂度 / 繁琐
- **DC 求解 O(N²)**：`_check_floating` 每行线性扫 `self.nodes` 找 id（nodal.py:2244-2249）→ O(rows×nodes)。
- **线扫报错/残差路径**：`_index_name` nodal.py:1925-1929、`_trouble_name` 1958-1965 每次线扫；`_trouble_name` 在 Newton 残差修复中每轮可能调用 → O(iter×N)。
- **频响 O(F×N×E)**：analysis.py:860-888 每频率(860)×每节点(864)×遍历全 edges(872)，且每频率重建 matrix/rhs(862-863)；nodes/nodes_by_id 每次调用重建(838-839/454-455)。
- **名称唯一性 O(N)/O(N²)**：`_unique_node_name/_unique_edge_name` scene.py:1109-1117 每增扫全表；`_auto_edge_name` while+all() 每候选 O(N)（1119-1124）；`next_node_name/next_edge_name` 重建 set O(N)。
- **引擎重建**：ensure_engine 在 `_dirty` 时整体重建 Node 图（scene.py:933-950/228-279）——仅编辑时触发，稳态不重建（已核对，非每步）。

### A.5 改进建议（按影响）
低风险立即可做：
1. `capture_checkpoint` 改**按需**（仅 timeout_ms>0 或存在断点才捕获，simulation.py:319-327）——去掉稳态每步整场深拷贝，收益最大、风险低。
2. NodeRecord/EdgeRecord 加 `dataclass(slots=True)`（scene.py:105/144）——省每实例 `__dict__`（确认 Py≥3.10）。
3. 只读快照路径 `snapshot(include_state=False)` 并去掉 `copy.deepcopy(connection.output)`（scene.py:1088）。
4. solver 预建 `node_by_id:dict`（_build_index nodal.py:1644），`_check_floating/_index_name/_trouble_name` 改 O(1)，消除 DC 的 O(N²)。
5. 频响循环外预聚合 adjacency（按 target 分组边），O(F×N×E)→O(F×(N+E))；nodes 索引缓存。
6. Scene 维护增量 `name→id` set 替代 scene.py:1109-1134 的 O(N)/O(N²) 扫描。

需重构：
7. 单一数据源：解决引擎 Node 与 NodeRecord 共享可变 dict（scene.py:236-246）——COW 或明确所有权。
8. 轮询快照改“版本号 + COW 缓存”替代每请求整场 deepcopy。
9. 热路径数值态考虑 numpy 结构化数组 / graph.Node/Connection 加 `__slots__`。

## B. 求解器 / 瞬态 / 序列化·RLock 瓶颈 + C++ 重写评估

### B.0 一句话结论
**不要为求解器写 C++。** 实测瓶颈不是线性代数（**<1%**，矩阵被 `MAX_NODES=400` 封顶，scene.py:1514），而是**纯 Python 对象开销**：每步深拷贝检查点 ~45%、逐元件 Python stamp 标量写矩阵 ~25–44%、序列化 ~17ms/帧。这些用 **NumPy/SciPy 向量化 + 去掉无谓深拷贝**就能吃掉大部分，零打包风险。

### B.1 瓶颈定位（量化）
基准：RC-ladder，Python 3.13.9 / numpy 2.3.5 / scipy 1.16.3；dense n≈390（392 未知量），约 6ms/步；cProfile 60 步 0.728s。

| 环节 | 占比 | 证据 |
|---|---|---|
| `capture_checkpoint` 逐元件深拷贝 | **~45%** | nodal.py:1751→:1735→fastcopy.py:24 `copy_state`（0.236s；fastcopy 自述“约占电路单步 40%”） |
| 逐元件 Python stamp 循环 + 标量写 | **~25%（dense）** | nodal.py:2020-2021 `for element: element.stamp(ctx)`；`_stamp_conductance`:125 `ctx.A[ai,ai]+=g` 每次 2 次 dict.get + numpy 标量索引 |
| `_residual_metric` ‖Ax−b‖ | ~6% | 每次迭代 `matrix @ solution` |
| **真正解线性方程** | **<1%** | 线性电路复用 LU：`lu_solve` 0.0287ms vs 整步 6ms；392×392 全新 `np.linalg.solve` 也才 1.25ms |

- **稀疏比稠密更慢（关键反直觉）**：强制 `sparse="on"` 对比 n=150 1.74→3.79ms、n=250 2.85→5.42ms、n=390 6.03→9.48ms ⇒ **稀疏恒慢 ~2.1–2.2×**。原因：`ctx.A` 是 scipy `lil_matrix`，`A[i,j]+=g` 走纯 Python `__getitem__/__setitem__`（sparse profile 中 `_stamp_conductance` 占 44%）；`_solve_sparse`:2170 每步都做 LIL→tocsr→排序→均衡→`tobytes()` 建 key 的 O(nnz) 哈希。`sparse_threshold=200`（:94）实为负优化。
- **信号模式同构中招**：`graph.py Network.step():699` 每步 `capture_step_state():1058` 深拷贝每节点 data/state/inputs/ports（4 dict）+ 每连接 state/output。拓扑排序/代数环**不是**瓶颈（`topological_order():659` 结果缓存于 `self._order`，仅拓扑变更失效 :378）。
- **序列化/IPC**（392 节点/781 边）：`runtime_state()` 构建 **7.44ms** + `json.dumps` **9.86ms** ⇒ `/api/state` ≈ **17ms/帧**；`/api/live` 400 帧×240 探针 = **45.6ms/1.47MB**；`probes()` 1.44ms/采样步。`fast_json`:153 与 `Recorder.push`:110/`since`:135 已优化（O(1)/O(新帧)）。
- **RLock**：`simulation.precompute():437` 整个 0→T 循环持 `self.lock` → `live():829`/`snapshot():812` 全程阻塞（已知“precompute 卡 /api/live”）；进度接口用独立 `_progress_lock`:256 不阻塞。
- **FEM 无需动**：`_assemble`:212 已向量化 COO、`_build_factorization`:236 只在 dt 变时重分解 splu，925 节点 0.147ms/步——已是纯 numpy/scipy 最优形态。

### B.2 纯 Python/NumPy 收益（先做，零打包风险）
1. **关掉稀疏 / 阈值提到 >400**（`SolverOptions.sparse="off"` 或 `sparse_threshold≥401`）→ 即时 **~2.1×**，一行改动，零风险。**最高性价比。**
2. **向量化装配**：`_build_index` 预生成静态 `(row,col,val)` 三元组，Newton 每轮 `np.bincount`/`np.add.at` 累加进一维数组再 `coo→csr`，替掉 `for element: stamp`。stamping 44%→~5%，整步 **1.5–1.8×**（非线性元件仍每轮重算 val，索引复用）。
3. **检查点改 undo-log / copy-on-write**：只记录本步真正改动的 key，替掉整棵 dict 递归拷贝，吃掉 **~45%**，与 #2 合力整步有望 **2.5–3×**（需谨慎保持回滚语义 + 回归测试）。
4. **precompute 与 live 解耦**：在 Scene 克隆上跑 precompute，或按 chunk 释放锁 → 消除 UI 冻结。
5. **序列化瘦身**：`runtime_state` 静态拓扑缓存、只发动态值/增量；`/api/live` 靠 cursor 增量（已有）。`orjson` 虽快但属 C 扩展→撞红线，排除。

### B.3 C++ 重写候选（红线=零构建/零第三方/离线 ⇒ 须预编译多平台 .pyd/wheel）
| # | 候选（移植点） | 预计加速 | 冲突/风险 | 综合 |
|---|---|---|---|---|
| C1 | 整个 per-step 内核（checkpoint+stamp+residual+solve 合一，nodal.py:1751/1984/2020） | 3–6×（6ms→1–1.5ms@390） | 严重：多平台 .pyd、ABI 锁 Python 3.13、PyInstaller 打包、维护 | 收益高/风险极高 → **仅最后手段** |
| C2 | 仅 stamp 循环做 C 扩展 | 1.5–2× | 仍要打包；收益可被纯 numpy #2 基本覆盖 | **不划算** |
| C3 | JSON 序列化器（替代 fast_json） | 2–4× | 非计算热路径；orjson 类第三方撞红线 | **不划算** |
| — | 线性求解器（LU/Eigen） | ~0 | 占时 <1% 且 ≤400×400 | **直接排除** |

**结论：只有 C1（整 per-step 内核搬走）才有边际价值，但撞红线、收益不抵风险 → 不建议为求解器写 C++。**

### B.4 不确定项
cProfile 放大绝对耗时（真实 ~6ms vs profile 12ms/步），占比可信、绝对值偏高；信号模式未逐函数 profile（静态推断同构）；非线性采样少（3 元件），大非线性 Newton 迭代数需再测。均只读临时脚本，未改仓库。

## C. 综合优先级（两路合成）

| 排序 | 动作 | 收益 | 风险 | 工作量 | 来源 |
|---|---|---|---|---|---|
| **P0** | 关掉稀疏 / `sparse_threshold>400` | 高（2.1×） | 极低 | 极小（一行） | B.2#1 |
| **P1** | 向量化元件装配（预生成三元组 + bincount/add.at） | 高（1.6×） | 中（非线性/受控源正确性） | 中 | B.2#2 |
| **P2** | undo-log / CoW 检查点（同时消 A 的“每步整场深拷贝”） | 高 | 中高（回滚语义） | 中高 | B.2#3 / A.5#1 |
| **P3** | precompute↔live 锁解耦 | 中（消 UI 冻结） | 低 | 中 | B.2#4 |
| **P4** | 序列化瘦身 / 增量 state | 中 | 低 | 中 | B.2#5 / A.3 |
| **P5** | C++ 整内核（C1） | 高（理论） | 极高（红线/打包） | 高 | B.3 |

**低成本清理（A 路，顺手做）**：`NodeRecord/EdgeRecord` 加 `dataclass(slots=True)`（scene.py:105/144）省每实例 `__dict__`；solver 预建 `node_by_id` 把 DC `O(N²)→O(N)`（`_check_floating` nodal.py:2244 / `_index_name` 1925 / `_trouble_name` 1958）；频响预聚合 adjacency `O(F×N×E)→O(F×(N+E))`（analysis.py:872）；Scene 维护 `name→id` 增量索引替代 scene.py:1109-1134 的 O(N)/O(N²) 扫描；修正引擎 `Node` 与 `NodeRecord` 共享可变 dict 的镜像风险（scene.py:236-246）。

**综合结论**：按 **P0（一行 2×）→ P1 → P2** 三个动作，390 节点每步可从 ~6ms 降到 ~1.5–2ms（NumPy 地板：392 解全新 1.25ms、复用 0.03ms）；**C++ 不做**。
