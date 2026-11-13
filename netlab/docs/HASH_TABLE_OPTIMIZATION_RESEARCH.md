# NetLab 哈希表与嵌套数据结构优化研究报告

> 日期：2026-11-08
> 范围：`PERF_DICT_AND_CPP_AUDIT.md`（历史审计，已归档）的文献延伸、数学分析与结构改进建议
> 约束：本报告是研究文档；不修改 NetLab 的运行算法，不把建议当作已实施事实
> 实施状态（2026-11-08）：仅 P0 的 `sparse_threshold=512` 已按 D120/§34.5 实施；其余条目仍为待评审建议。
> 配套审计：PERF_DICT_AND_CPP_AUDIT.md（历史审计，已归档，见 Git 历史）

## 摘要

NetLab 当前的性能问题不能简单归结为“哈希表太慢”。已有的只读审计给出了更准确的结论：在 390 节点 RC-ladder 基准中，`capture_checkpoint` 约占单步 45%，逐元件 Python stamp 约占 25%，残差计算约 6%，真正线性求解不到 1%；强制使用稀疏矩阵反而比稠密慢 2.1–2.2×。因此，优先级最高的改进不是把 Python `dict` 换成另一种哈希表，而是：

1. 减少每步的整场深拷贝（checkpoint / snapshot）；
2. 把逐元件 Python 循环改成预生成索引的 NumPy 批量装配；
3. 把“编辑期的嵌套 dict”与“计算期的扁平数组/CSR”分开；
4. 只对静态、只读、规模足够大的注册表考虑最小完美哈希（MPHF）；
5. 把 SwissTable、IcebergHT、MultiTable 等作为未来原生扩展或并发设计的参考，而不是纯 Python 重写的目标。

本报告把文献结论、数学条件和 NetLab 的可执行改造路线统一起来。按审计的收益估计，P0（关稀疏、修快照、slots、索引）可以先拿到约 2×；P1（向量化装配）可叠加 1.5–1.8×；P2（undo-log/CoW 检查点）若正确实现，与 P1 合计有望接近 2.5–3×。哈希表级算法优化的收益通常小于这些“数据布局 + 生命周期”改造。

## 1. 研究问题与边界

### 1.1 问题

NetLab 同时承担四类工作：

- 图结构编辑：节点、边、端口、参数、外观、位置随时增删改；
- 高频仿真：每个时间步多次 Newton 迭代、元件 stamp、残差、线性求解；
- 状态管理：每步 checkpoint、撤销、超时回滚、快照；
- 数据交换：`/api/state`、`/api/live`、工程保存/加载、录制与绘图。

Python 的 `dict` 适合第一类工作，因为动态、异构、可读；但同一套嵌套 dict 被直接用于第二、三、四类工作，就会产生重复查找、对象间接寻址、缓存不友好和整场深拷贝。问题不是“dict 是否是 O(1)”，而是“每步要执行多少次 dict 访问、每次访问要追几次指针、每次状态保存要复制多少对象”。

### 1.2 不在本报告范围内

- 不改变 `NodeRecord`、`Scene`、`CircuitSolver` 的现有语义；
- 不主张现在重写 C++ 求解器；
- 不以预印本数字替代 NetLab 自己的基准；
- 不把“哈希表负载因子可达 1”这类未独立复现的结论当作生产依据。

## 2. 现有审计事实（本报告的事实基线）

以下数字来自 `PERF_DICT_AND_CPP_AUDIT.md`（历史审计，已归档）的只读测量，不是本报告重新跑出的结果；报告中的建议必须用同一基准复测后才能宣称收益。

| 观测 | 数值/结论 | 含义 |
|---|---|---|
| RC-ladder 规模 | 390 节点 / 392 未知量，约 6 ms/步 | 当前主要工作负载 |
| `capture_checkpoint` | 约 45% | 每步整场深拷贝是最大单点 |
| 逐元件 Python stamp | 约 25%（dense） | `for element: element.stamp(ctx)` + 标量索引 |
| 残差范数 | 约 6% | 每次迭代 `A @ x` |
| 真正线性求解 | <1% | 392×392 的 LU 不是瓶颈 |
| 强制稀疏 | 比稠密慢 2.1–2.2× | `lil_matrix` 的 Python `__setitem__` + 每步 LIL→CSR |
| `runtime_state` + JSON | 约 17 ms/帧（392 节点） | `/api/state` 的主要成本 |
| `/api/live` | 400 帧×240 探针 = 45.6 ms / 1.47 MB | 轮询/序列化压力 |
| `precompute` 锁 | 整个 0→T 循环持 `self.lock` | `/api/live`、`snapshot` 被阻塞 |
| FEM | 925 节点 0.147 ms/step，COO 已向量化 | 不应再改 FEM 装配 |
| `MAX_NODES` | `scene.py:1514` 为 400 | 当前规模上限决定了“哈希表优化”的紧迫度 |

一个重要的现实约束：当前 `MAX_NODES=400`。在 400 节点以内，Python `dict` 的单次查找并不是最痛的地方；真正痛的是每步深拷贝和 Python 级循环。只有在未来把上限提高到数千/数万节点，或者把 NetLab 用作大规模数据分析后端时，扁平化/CSR/MPHF 的收益才会显著放大。

## 3. 论文阅读：按问题分组

### 3.1 静态/只读：最小完美哈希（MPHF）

**Modern Minimal Perfect Hashing: A Survey**（Hans-Peter Lehmann, Thomas Mueller, Rasmus Pagh, Giulio Ermanno Pibiri, Peter Sanders, Sebastiano Vigna, Stefan Walzer；ACM Computing Surveys 58(10), 2026；arXiv:2506.06536）是用户材料所称“1997 年以来该领域第一份系统综述”，包含大规模横向评测。MPHF 把 n 个**互不相同且静态**的键一一映射到 [0,n)，不存储冲突链；其信息论下界约为每键 `log2(e) ≈ 1.4427` bit。该综述摘要称其最小构造只比该下界高约 0.1%，但这是特定实现、特定键集与特定评测口径下的结果，不等于任意数据集都能达到。

对 NetLab 的适用边界很明确：

- 适合：插件注册表、节点类型表、固定参数名表、只读的元件库、静态查找表；
- 不适合：`Scene.nodes`、`Scene.edges`、`block_buffers` 等编辑期会增删的容器；
- 原因：MPHF 的构造/重建成本高，一旦键集合变化就要重建；NetLab 的编辑操作远比查询频繁。

**PTHash**（SIGIR 2021）是 MPHF 的工程代表，用户材料称其查询比同类快 2–4×（待全文核验）；**SicHash、PaCHash、PHOBIC、ShockHash、Learned Monotone MPHF** 是同一家族的不同权衡（构造时间、空间、查询速度、外存/变长对象支持）。**Learned Static Function Data Structures**（PVLDB 19(5), 2026）代表最新方向：用模型学习 key→value 的相关性、按键生成前缀码，试图突破零阶熵下界；它同样是静态结构，且需要训练/构建阶段。

### 3.2 动态哈希表：开放寻址、SwissTable 与物理布局

**Analyzing Vectorized Hash Tables Across CPU Architectures**（PVLDB 16(11), 2023；作者 Maximilian Böther, Lawrence Benson, Ana Klimovic, Tilmann Rabl）比较 VLP、VFP、BBC 三类向量化设计在 x86/ARM/Power 上的表现。该论文/HPI 摘要给出的结论是 BBC 比标量线性探测快 2× 以上。关键不是“某一种结构永远最快”，而是：向量化收益依赖探测布局、负载因子、键/值大小和 CPU 微架构；在 Python 中用纯 Python 模拟 SIMD 通常只会更慢。

**IcebergHT**（SIGMOD/PACMMOD 2023；理论版 J. ACM 70(6), 2023）强调 stability 与 low associativity：论文摘要给出的空间开销约 17%，用户材料补充“每个键最多 4 个候选桶、元数据能放进一条 cache line（后者待全文核验）”。它特别适合“嵌套子表需要并发或指针稳定”的场景，也就是未来 NetLab 若做原生多级索引、且要求并发读时值得参考的结构。

**MultiTable**（arXiv:2609.39233, 2026-09）提出多表级联溢出，宣称物理负载因子可达 1、无需全表重哈希，并用 φ^k 描述溢出层级的空间/概率行为。它是本报告中最需要降级处理的来源：这是新预印本，“负载因子可达 1”依赖未证明假设，且只有单机单基线，缺少独立复现；只能作为研究线索，不能据此做生产决策。

**A Fine-Grained Analysis of SIMD-Based Hash Table Implementations**（Nicaud & Rotondo, arXiv:2610.02385, 2026-10）用 Wormald 微分方程方法分析 SwissTable 类结构的高精度概率行为。它的价值在方法论：如果要认真比较探测分布、溢出概率和尾延迟，应使用这种概率模型，而不是只看平均 O(1)。

**Abseil Swiss Tables Design Notes** 是工程一手资料（不是论文）：控制字节、1 字节部分哈希、16 槽分组、SSE2 并行比较、tombstone 管理，以及 `flat_hash_map` 与 `node_hash_map` 的取舍。网上流传的“SWISS 2016 论文”是杜撰的，不要引用。

### 3.3 嵌套/多层结构

**Adopting Worst-Case Optimal Joins in Relational Database Systems**（Freitag 等，PVLDB 13(11), 2020）给了一个非常重要的嵌套索引原则：整棵 hash trie 可以只建立在**哈希值**上，不存真实键，把精确 key 比较推迟到最终结果产出前；各层共享统一紧凑布局。对 NetLab 的启发是：嵌套表的每一层不必都存完整字符串键；编译期可以只存整数 ID 或 64-bit hash，最终命中再比较一次。

**Theoretically and Practically Efficient Parallel Nucleus Decomposition**（Shi, Dhulipala, Shun，arXiv:2111.10980）讨论多级嵌套表的空间权衡，并把末层表用前缀和放进一整块连续内存。它提醒我们：多级结构本身不一定坏，坏的是每级都独立分配小对象；把末级变成连续数组，可以显著改善局部性。

**Dremel: Interactive Analysis of Web-Scale Datasets**（VLDB 2010）与 **Nested Parquet Is Flat, Why Not Use It?**（SIGMOD 2025）代表嵌套值的列式 shredding：用 repetition/definition levels 表示可选、重复字段。它们适合“表里塞文档”的存储/序列化，而不是每步仿真热路径；NetLab 可以用它设计 `runtime_state` 的列式快照，但不能指望靠 Parquet 解决 Newton 迭代内的访问成本。

**ERT**（SIGMOD 2023）用节点内 extendible hashing 压缩树高；**CuckooGraph**（ICDE 2025）按度数自适应地把槽升级为子表，对付幂律偏斜。两者都是专用结构：ERT 适合层级索引，CuckooGraph 适合高度偏斜的图/属性表。NetLab 当前网络规模小，优先用整数索引 + CSR，不需要立刻上这些结构。

### 3.4 并发、外存与新硬件

**ClickHouse – Lightning Fast Analytics for Everyone**（PVLDB 17, 2024）给出 30+ 种表变体的工程 rationale：不同工作负载用不同布局，而不是一张哈希表打天下。**Robust External Hash Aggregation in the Solid State Age**（ICDE 2024）关注内存溢出时的性能悬崖；**Global Hash Tables Strike Back!**（Xue & Marcus，PVLDB 19(3), 2025）说明为聚合定制的共享并发表可以打平甚至超过分区方案；**SepHash**（PVLDB 17(5), 2024）与 **SHARD**（PVLDB 19(4), 2025）面向 RDMA/分离式内存，SHARD 复用 Iceberg hashing 降低 RTT。

这些论文对当前 NetLab 的直接价值较低：NetLab 是单进程 Python + GIL，既没有 RDMA，也没有需要跨机并发的聚合；但它们支持一个架构判断：**当并发/外存成为主约束时，应重新设计表的所有权与分区，而不是给现有嵌套 dict 加锁**。

### 3.5 经典缓存与指针结构

**Leveraging Caches to Accelerate Hash Tables and Memoization**（2019）提出 Flat-HTA 与 Hierarchical-HTA，直接研究缓存层次对哈希表访问的影响；**Making Pointer-Based Data Structures Cache Conscious**（2000）与 **Cache-Conscious Structure Definition**（1999）讨论结构聚集、字段拆分、字段重排。**On the Optimal Time/Space Tradeoff for Hash Tables**（2021）提供理论下界，提醒我们不要承诺“同时做到 O(1) 查询、最小空间、任意动态更新”的万能结构。

对 NetLab 的结论：

- 指针追踪（pointer chasing）是嵌套 dict 的核心微架构成本；
- 把热字段连续存放、把冷字段拆开，比换哈希函数更有效；
- 任何“扁平化”都要付出编辑灵活性/内存冗余的代价，应按字段热度分层。

### 3.6 逐篇 WHY–HOW–WHAT 速查

| 文献 | WHY（解决什么） | HOW（核心做法） | WHAT（结论/对 NetLab 的用法） |
|---|---|---|---|
| Modern Minimal Perfect Hashing Survey, 2026 | MPHF 领域缺少统一评测 | 分类、下界、大规模横评 | 静态注册表可用；动态 Scene 不适用 |
| Analyzing Vectorized Hash Tables, PVLDB 2023 | 向量化哈希表缺乏跨架构比较 | VLP/VFP/BBC 在 x86/ARM/Power 实测 | BBC 可快 2×+；纯 Python 不适用 |
| IcebergHT, SIGMOD/JACM 2023 | 高负载因子下的稳定性与低关联 | 低关联、元数据单 cache line | 未来原生并发子表参考 |
| MultiTable, arXiv 2026 | 负载因子逼近 1 | 多表级联溢出、φ^k | 预印本，仅研究线索 |
| Fine-Grained SIMD Hash Analysis, arXiv 2026 | SwissTable 概率行为难分析 | Wormald 微分方程 | 方法论参考，不直接实现 |
| Abseil Swiss Tables | 工程级哈希表设计 | 控制字节、分组、SIMD、tombstone | 原生扩展/库选型参考 |
| FOCS 2024 Open Addressing | 不重排开放寻址的查询/插入界 | Elastic/Funnel Hashing | 支持“编辑/查询分离”的架构直觉 |
| Worst-Case Optimal Joins, PVLDB 2020 | 哈希 trie 存真实键太贵 | 只在哈希值上建 trie，延迟 key 比较 | 嵌套索引用整数/hash，不存重复字符串 |
| Nucleus Decomposition, arXiv 2021 | 多级嵌套表空间权衡 | 末层前缀和连续内存 | 多级结构要连续化末层 |
| Dremel, VLDB 2010 | 嵌套数据列式存储 | repetition/definition levels | 快照/序列化参考，不进热路径 |
| Nested Parquet, SIGMOD 2025 | 嵌套列式是否值得 | 嵌套 Parquet 的扁平化评估 | 存储层参考 |
| ERT, SIGMOD 2023 | 哈希 trie 树高 | 节点内 extendible hashing | 层级索引参考 |
| CuckooGraph, ICDE 2025 | 幂律偏斜 | 按度数升级子表 | 专用场景 |
| PTHash, SIGIR 2021 | MPHF 查询速度 | 分区/压缩编码 | 静态表可选 |
| SicHash/PaCHash/PHOBIC/ShockHash/Learned MPHF | MPHF 空间/构造/外存权衡 | 不同 cuckoo/压缩/学习方案 | 先做选型基准，不直接替换 dict |
| Learned Static Functions, PVLDB 2026 | 零阶熵下界限制 | 学习 key→value、前缀码 | 静态、需训练，前沿观察 |
| ClickHouse, PVLDB 2024 | 分析系统表变体多 | 30+ 表布局工程经验 | 一表一策，不搞统一容器 |
| Robust External Hash Aggregation, ICDE 2024 | 内存溢出性能悬崖 | 自适应 spill/分区 | 未来大数据导出参考 |
| Global Hash Tables Strike Back, PVLDB 2025 | 分区假设未必最优 | 共享并发表 | 未来并行聚合参考 |
| SepHash/SHARD, PVLDB 2024/2025 | RDMA/分离内存哈希索引 | 降低 RTT、复用 Iceberg | 当前不适用 |
| Leveraging Caches, 2019 | 缓存层次影响哈希表 | Flat-HTA/Hierarchical-HTA | 直接支持热/冷字段分层 |
| Pointer-Based Data Structures, 2000 | 指针结构缓存不友好 | 结构聚集/字段重排 | 嵌套 dict 的经典诊断 |
| Cache-Conscious Structure Definition, 1999 | 字段布局影响缓存 | 字段拆分/重排 | 热字段 SoA、冷字段保留 dict |
| Optimal Time/Space Tradeoff, 2021 | 时间/空间理论边界 | 下界与构造 | 避免过度承诺 |

## 4. 数学分析

### 4.1 嵌套 dict 的访问成本模型

设一次字段访问经过 `d` 层字典，每层平均哈希/探测成本为 `c_h`，指针解引用与对象访问成本为 `c_p`。则

\[
T_{\text{nested}}(d) = \sum_{k=1}^{d}(c_{h,k}+c_{p,k}) \approx d(c_h+c_p).
\]

如果编译期把热字段变成连续数组，并用整数索引 `i` 访问，则

\[
T_{\text{flat}} = c_a + c_{\text{index}},
\]

其中 `c_a` 是数组元素访问，`c_index` 是索引数组访问（通常也可预先算好）。因此理想加速比为

\[
R = \frac{d(c_h+c_p)}{c_a+c_{\text{index}}}.
\]

用微架构量级做**说明性**估算（不是 NetLab 实测）：若 `c_h≈30ns`、`c_p≈80ns`、`c_a≈2ns`、`d=4`，则 `R≈220×`；现实中 Python 层还有解释器开销和对象分配，不能把 220× 当作端到端收益。更合理的用法是比较“每步访问次数”：

\[
N_{\text{access}} = N_{\text{node}} \times A_{\text{hot}} \times I_{\text{Newton}} \times S_{\text{steps}} \times d.
\]

在 `N=400, A=10, I=5, S=1000, d=4` 时，`N_access=8×10^7` 次；按每次 100ns 约 8s，按每次 10ns 约 0.8s。这个量级说明：即使单次 dict 查找很快，嵌套访问在长时间仿真中仍会成为可观的固定税。

### 4.2 内存与缓存局部性

CPython 的 `dict` 是“索引表 + 条目表”的紧凑哈希表，但每个独立 dict 仍有对象头、索引数组和条目数组。一个节点若带 7 个字段 dict，每个 dict 即使只有几个键，也会有数百字节的结构开销；加上 `NodeRecord.__dict__`、字符串键对象和值的 Python 对象，数量级约为每节点 1.5–2.5 KB。10,000 个节点仅结构开销就可能是 15–25 MB，而同样 10 个 `float64` 热字段的 SoA 只需 0.8 MB。

缓存角度，`dict` 访问是“读 dict 对象 → 读索引表 → 读条目 → 读值对象”的指针链；随机节点访问时，每一级都可能触发 cache miss。假设每级 miss 约 80–120ns，4 层就是 320–480ns；连续 NumPy 数组的顺序访问则可由硬件预取，摊到每元素约 1–5ns。**嵌套 dict 的问题主要是 locality，不是哈希函数。**

### 4.3 单表负载因子与探测

在**均匀散列/双重散列**假设下，开放寻址的成功查找期望探测数约为

\[
S(\alpha) \approx \frac{1}{\alpha}\ln\frac{1}{1-\alpha},
\]

失败查找约为

\[
U(\alpha) \approx \frac{1}{1-\alpha}.
\]

线性探测更差：成功查找约 `(1/2)(1+1/(1-α))`，失败查找约 `(1/2)(1+1/(1-α)^2)`。下表按均匀散列公式计算，`α` 是负载因子。`α=0.5` 时 `S≈1.39, U≈2`；`α=0.75` 时 `S≈1.85, U≈4`；`α=0.9` 时 `S≈2.56, U≈10`；`α=0.99` 时 `S≈4.65, U≈100`。这说明：

- Python `dict` 在正常负载下已经非常接近“常数”；
- 真正危险的是把负载推到 0.9 以上，或让每个节点维护多个小 dict；
- 如果未来做原生表，应把负载控制在 0.5–0.75；不要用“负载因子 1”作为默认目标。

### 4.4 编译/扁平化的盈亏平衡

设编译一次的成本为

\[
T_{\text{compile}} = aN + bE + cK,
\]

其中 `K` 是字段/类型数量；编译后每步节省

\[
\Delta = T_{\text{old}} - T_{\text{new}}.
\]

若之后还要跑 `S` 步，则平均每步成本为

\[
T_{\text{avg}}(S) = \frac{T_{\text{compile}}}{S} + T_{\text{new}}.
\]

只有

\[
S > S^* = \frac{T_{\text{compile}}}{\Delta}
\]

时，编译才划算。举例（说明性）：若 `T_compile=20ms`，每步节省 `0.5ms`，则 `S*=40` 步；如果用户每编辑一次只跑 10 步，编译层反而亏。因此 NetLab 应采用**惰性编译 + 版本失效**：只有连续仿真/批量分析超过阈值才构建 `RuntimeModel`；编辑阶段继续用 `Scene` 的 dict。

### 4.5 图结构的 CSR 成本

对 `N` 个节点、`E` 条边的有向图，CSR 用：

- `indptr: int32[N+1]`，约 `4(N+1)` 字节；
- `indices: int32[E]`，约 `4E` 字节；
- 可选 `weights: float64[E]`，约 `8E` 字节。

总内存约

\[
M_{\text{CSR}} = 4(N+1) + 4E + 8E = 4N + 12E + 4 \text{ bytes}.
\]

一次邻居遍历是 `O(deg(v))`，全图遍历是 `O(N+E)`；而“每个节点一个 dict of dict”的邻接表至少需要每节点一个 dict 对象和每条边一个条目对象，常数和 locality 都更差。CSR 的代价是插入/删除边最坏 `O(E)`（要搬移数组）；所以正确用法是：

- 编辑期：`Scene` 的 dict/列表；
- 计算期：一次性构建 CSR；
- 拓扑变化：标记 dirty，下一次仿真前重建；
- 高频局部编辑：用“可编辑 overlay + 定期重建”，不要每改一条边就重建整个 CSR。

### 4.6 检查点：全量拷贝 vs undo-log

设状态对象数为 `B`，状态总字节为 `M`。全量 checkpoint 的成本近似

\[
C_{\text{ckpt}} = c_{\text{alloc}}B + c_{\text{mem}}M.
\]

每步都 checkpoint 的期望成本为

\[
C_{\text{always}} = C_{\text{ckpt}} + pC_{\text{restore}},
\]

其中 `p` 是单步失败/超时概率。undo-log 只记录本步修改的 `u` 个字段：

\[
C_{\text{undo}} = c_{\text{log}}u + pC_{\text{undo-restore}}.
\]

当

\[
C_{\text{ckpt}} - c_{\text{log}}u > p(C_{\text{undo-restore}} - C_{\text{restore}})
\]

时，undo-log 更优。由于审计测得 `C_ckpt≈2.7ms/步`（45%×6ms），而正常步的 `u` 远小于 `B`，即使 `p` 很小，undo-log 也通常占优。但 undo-log 的正确性要求：

- 每个会修改状态的路径都写入 journal；
- 失败时按逆序精确恢复；
- 不能遗漏 `deepcopy` 隐藏的可变对象（如 `connection.output`）；
- 回滚后 revision/缓存失效要一致。

若短期不敢改 checkpoint 语义，至少应做“按需 checkpoint”：仅当 `timeout_ms>0`、有断点、或调试模式开启时捕获；但必须保留异常路径的确定性恢复方案，否则会把性能优化变成正确性风险。

### 4.7 序列化与版本化快照

`runtime_state` 的成本近似

\[
T_{\text{snap}} = \alpha N + \beta E + \gamma K,
\]

其中 `K` 是字符串/JSON 字段数。审计测得 392 节点约 17ms/帧，其中 `runtime_state` 7.44ms、`json.dumps` 9.86ms。若前端每秒轮询 60 次，这相当于 1 秒的 CPU 时间被序列化吃掉。

版本化缓存可以把“未变化帧”的轮询成本降到 `O(1)`：

\[
T_{\text{poll}} =
\begin{cases}
O(1), & \text{revision 未变},\\
O(\Delta), & \text{只有局部变化},\\
O(N+E), & \text{全量重建}.
\end{cases}
\]

实现要点：`Scene`/`SignalEngine` 维护单调递增 `revision`；`runtime_state` 缓存最近一次结果；拓扑或状态变化时只失效相关部分；前端用 `If-None-Match`/revision 或增量 patch。不要在没有测量的情况下直接引入 `orjson` 等 C 扩展——它撞 NetLab 的零第三方/打包红线，而且 JSON 不是最大头。

### 4.8 名称索引：从 O(N²) 到 O(N)

若每次新增节点都线性扫描已有节点检查重名，批量加载 `N` 个节点的总成本是

\[
\sum_{i=1}^{N} i = \frac{N(N+1)}{2} = O(N^2).
\]

维护一个 `set`/`dict` 名称索引后，每次插入期望 `O(1)`，总成本 `O(N)`：

\[
T_{\text{index}} = c_{\text{hash}}N.
\]

对 10,000 个节点，`N²/2=5×10^7` 次字符串比较 vs `10^4` 次哈希插入，差距是数量级。这个改动风险低，应优先做。

### 4.9 频响/遍历：避免 O(F×N×E)

若对每个频点 `f`、每个节点 `n`、每条边 `e` 都线性扫描找目标，复杂度是

\[
O(F \cdot N \cdot E).
\]

预先按目标节点/源节点分组边，构建 `edges_by_target`，则每个频点只遍历一次邻接表：

\[
O(F \cdot (N+E)).
\]

当 `N≈400, E≈800` 时，比值约 `N` 量级；这是低风险的结构改进，不需要改求解算法。

### 4.10 优化问题的形式化

可以把布局选择写成带约束的多目标问题：

\[
\min_{L \in \mathcal{L}} \quad
\alpha T_{\text{edit}}(L) + \beta T_{\text{step}}(L) + \gamma M(L) + \delta T_{\text{serialize}}(L)
\]

subject to:

- 语义等价：对同一输入，数值结果在容差内一致；
- 编辑能力：增删改节点/边不丢字段；
- 打包约束：纯 Python/NumPy/SciPy，不引入新二进制依赖；
- 回滚正确性：失败后可恢复到上一步一致状态。

`L` 的候选至少包括：

1. `L_nested`：现状（每节点多 dict）；
2. `L_slots`：`dataclass(slots=True)` + 保留 dict 作为 `extra`；
3. `L_soa`：热字段列数组 + 冷字段 dict；
4. `L_compiled`：整数索引 + SoA + CSR；
5. `L_native`：C++/Rust 扩展（仅在 P0–P2 后评估）。

用 Pareto 前沿而不是单一分数选型：如果 `L_compiled` 只快 1.2× 但增加 300 行复杂度和大量 dirty 逻辑，它不应该上线；如果 `L_slots` 只快 5% 但零风险，可以先做。

## 5. 结构改进方案

### 5.1 双层数据架构

```
编辑数据层（Editable Model）
  Scene / NodeRecord / EdgeRecord / dict / list
  目标：增删改、序列化、用户参数、插件扩展
        │
        ▼  Model Compiler（惰性、版本化）
  - node id -> int index
  - edge (src,dst) -> int arrays
  - hot fields -> NumPy columns
  - adjacency -> CSR/CSC
  - dirty/version 传播
        │
        ▼
运行数据层（Compiled Runtime）
  RuntimeModel / NodeTable / EdgeTable / StateStore
  目标：高频读、批量 stamp、Newton、残差、快照
```

这不是“把 dict 全部删掉”。编辑层继续保留 dict 的灵活性；运行层只接管热路径。两者之间用明确的 `compile(scene) -> RuntimeModel` 和 `apply_delta` 边界。

### 5.2 P0：低风险优先池（非一次性实施清单）

| 动作 | 位置 | 预期 | 风险 |
|---|---|---|---|
| 关闭稀疏或把 `sparse_threshold` 提到 >400 | `SolverOptions`/`nodal.py` | ~2.1×（审计） | 极低 |
| `NodeRecord`/`EdgeRecord` 加 `slots=True` | `scene.py:105-170` | 降内存/属性访问 | 低（注意动态字段迁到 `extra`） |
| `snapshot(include_state=False)`，去掉 `connection.output` 的深拷贝 | `scene.py` | 降快照/检查点 | 低 |
| `CircuitSolver` 建 `node_by_id` 索引 | `nodal.py:1644` 附近 | 消除 O(N²) 查找 | 低 |
| 名称唯一性用 `set`/`dict` 索引 | `Scene`/`Project` | O(N²)→O(N) | 低 |
| 频响按目标节点分组边 | 频响/信号遍历 | O(F·N·E)→O(F·(N+E)) | 低 |
| `precompute` 分块释放 `self.lock` 或克隆 Scene | `simulation.py:437` | 消除 UI 冻结 | 中低 |

> **实施状态（2026-11-08）**：仅第一行 `sparse_threshold` 200→512 已实施（D120 / `PERFORMANCE_AND_CONCURRENCY.md` §34.5）；其余六项仍是候选，逐项需要独立的兼容性验证与回归。P1（编译型运行时）、P2（检查点/撤销）、P3（并发锁）均未实施。`PERFORMANCE_AND_CONCURRENCY.md` §34.2 使用实施切分，其 P0 只覆盖本表第一行，P1–P3 编号不等同于本报告的研究优先级。

### 5.3 P1：编译型运行时（核心结构改造）

建议新增独立模块（例如 `netlab/core/runtime/compiled.py`，具体命名由实现阶段决定）：

```python
@dataclass(slots=True)
class NodeTable:
    index: dict[str, int]          # 仅边界查找
    x: np.ndarray                  # float64[N]
    y: np.ndarray
    kind: np.ndarray               # int16[N]
    # 热字段按列；冷字段留在 Scene 的 extra dict

@dataclass(slots=True)
class EdgeTable:
    src: np.ndarray                # int32[E]
    dst: np.ndarray
    kind: np.ndarray
    weight: np.ndarray | None

@dataclass(slots=True)
class RuntimeModel:
    nodes: NodeTable
    edges: EdgeTable
    indptr: np.ndarray             # int32[N+1]
    indices: np.ndarray            # int32[E]
    state: dict[str, np.ndarray]   # 每个热状态一列
    revision: int
```

迁移顺序建议：

1. 先做 `SignalEngine`（信号模式）的整数索引 + 列状态，因为它的每步深拷贝问题最明显（`graph.py:699/1058`）；
2. 再做 `CircuitSolver` 的元件三元组预生成与向量化装配（审计 B.2#2）；
3. 最后把 `Scene` 的编辑 API 与 `RuntimeModel` 的同步做成版本化 delta；
4. 用 feature flag 保留旧路径，A/B 对照后才切换默认。

### 5.4 P2：检查点、快照与撤销

推荐顺序：

1. 先把 `capture_checkpoint` 从“无条件”改为“条件触发”，但保留异常回滚策略；
2. 对 `Scene` 的 `data/state/inputs` 和 `EdgeRecord.state/output` 建 undo journal；
3. `capture_checkpoint` 只保存 journal 起点与元数据，不复制全部对象；
4. `restore_checkpoint` 逆序回放 journal，校验 revision；
5. 对 `runtime_state` 建 revision 缓存 + 增量 patch；
6. 对 `Project` 保存/加载去掉不必要的 `deepcopy`，用显式序列化。

验收必须包括“失败注入”测试：在 step 中途抛出异常，回滚后与原始快照逐字段相等；连续 1000 步随机增删改后，undo/redo 与全量 checkpoint 的结果一致。

### 5.5 P3：并发与锁

`precompute` 当前整个循环持 `self.lock`，导致 `/api/live` 与 `snapshot` 阻塞。两种方案：

- **克隆**：在 `Scene` 的浅克隆/COW 快照上跑 precompute，完成后原子替换；读线程永远读旧快照；
- **分块**：按时间块释放锁，允许读线程插入；需要保证读者看到一致 revision。

在纯 Python + GIL 下，不要先做“无锁并发哈希表”；先把锁的持有范围缩小，收益更直接。

### 5.6 C++/原生扩展的决策门

审计的结论应保持：C++ 只在“整个 per-step 内核”层面有 3–6× 潜在收益，但有多平台 `.pyd`、ABI、PyInstaller 打包和维护风险；仅 stamp 循环的 C2 只有 1.5–2×，会被 NumPy 向量化覆盖；JSON C3 不划算；线性求解器约 0 收益。因此：

- **不做**：为了 hash map 而写 C++ 扩展；
- **不做**：把 `dict` 换成纯 Python SwissTable；
- **可做**：如果 P0–P2 后仍有一个明确的内核占 >50%，再评估预编译 wheel 的 C1；
- **参考**：Abseil `flat_hash_map`、IcebergHT 的 cache-line 元数据、FOCS 的分层插入策略。

## 6. 实验设计与验收标准

### 6.1 基准矩阵

使用现有 `NetlabHome/netlab/tools/bench.py` 和 `NetlabHome/tools/bench_step.py`，不要另造只测单次 `dict` 查找的微基准。至少覆盖：

- 规模：100 / 1,000 / 10,000 / 100,000 节点（若 `MAX_NODES` 允许；否则用合成 `RuntimeModel` 单独测）；
- 嵌套深度：2 / 4 / 6 层（当前 `NodeRecord` 约 4–5 层，`block_buffers` 更深）；
- 工作负载：随机字段读、全图遍历、高频状态更新、MNA 装配、Newton 迭代、`runtime_state` 序列化；
- 场景：`signal_chain`、`control_loop`、`transfer_cascade`、`rc_step`、`rlc_series`、`diode_rectifier`、`controlled_source`、`nonlinear_control`、`vector_network`、`fem`。

### 6.2 指标

| 指标 | 工具 | 备注 |
|---|---|---|
| 单步耗时 | `perf_counter`，≥5 次取中位数/p95 | 区分 `Scene.step` 与 `Simulation.step` |
| 峰值内存 | `tracemalloc` / `psutil` | 记录 Python 对象与 RSS |
| 分配次数 | `tracemalloc` 快照差异 | 验证 checkpoint 是否减少临时对象 |
| 序列化耗时/字节 | `timeit` + `len(json)` | `/api/state`、`/api/live` |
| 数值一致性 | 现有测试 + 新回归 | 电压/电流误差 ≤1e-12 或与旧路径 bitwise 相同 |
| 回滚一致性 | 失败注入 | 逐字段比较 + revision |

### 6.3 验收门槛（建议）

- P0：所有现有测试通过；RC-ladder 中位步耗时至少改善 1.8×；`runtime_state` 在未变化帧 `O(1)`；
- P1：信号模式/电路模式各至少 1.3×；数值结果与旧路径一致；内存下降 ≥20%；
- P2：checkpoint 时间下降 ≥50%；1000 步随机编辑回滚无差异；
- 任何改动不得改变 `Scene`/`Project` 的公开 API 语义；若必须改变，提供迁移层和文档。

## 7. 风险、反模式与不推荐路线

### 7.1 反模式

1. **用纯 Python 重写 SwissTable**：Python 层的解释器开销远大于哈希表本身的常数改进；内置 `dict` 是 C 实现，通常更快。
2. **给所有字段都上 SoA**：冷字段/异构参数会浪费内存，并让编辑代码复杂化；只扁平化热字段。
3. **给动态图用 MPHF**：每次增删都要重建；MPHF 只适合静态只读注册表。
4. **把稀疏矩阵当作默认**：审计已经实测 LIL 的 Python `__setitem__` 比稠密慢 2.1–2.2×；在 400 节点内不要开。
5. **直接采用 MultiTable 的“负载因子 1”**：预印本、未证明假设、单基线；只能做研究实验。
6. **先写 C++ 再优化 Python 结构**：会把打包/ABI 风险和算法问题混在一起；先做 P0–P2。

### 7.2 风险

- `slots=True` 会破坏“运行时给 NodeRecord 动态加字段”的代码；必须先盘点所有 `setattr`/`__dict__` 用法，把动态字段迁到 `extra`。
- `capture_checkpoint` 改为条件触发后，异常回滚可能失效；没有 undo-log 前不要直接关闭。
- `RuntimeModel` 的 dirty 传播若漏掉某条路径，会出现“仿真读旧拓扑”；必须有 revision/一致性测试。
- 版本化快照若跨线程共享 NumPy 数组，需保证只读/复制边界；不要让前端线程读到正在写的列。
- 任何“预估 2×”都必须以 NetLab 的 `bench_step.py` 复测为准；审计的 6ms 是特定机器/版本。

## 8. 结论与建议

1. **先做 P0，不要先换哈希表**：关稀疏/阈值、slots、轻量 snapshot、节点索引、名称索引、频响分组、precompute 锁。它们风险低，且直接针对审计测出的最大成本。
2. **P1 的核心是“编译层”而不是“新容器”**：`Scene` 继续用 dict 编辑，`RuntimeModel` 用整数索引 + SoA + CSR 计算；用 feature flag 和版本失效控制复杂度。
3. **P2 的核心是“只记录变化”**：undo-log/CoW checkpoint + 版本化序列化，比全量深拷贝更符合 NetLab 的交互式仿真。
4. **哈希表算法研究放在正确的位置**：MPHF/PTHash 用于静态注册表；SwissTable/IcebergHT 用于未来原生扩展；FOCS 的分层思想用于理解“插入成本与查询成本可解耦”；MultiTable 等预印本只做观察。
5. **C++ 不是当前答案**：除非 P0–P2 后仍有一个可隔离的整步内核瓶颈，否则不建议为哈希表或求解器引入原生扩展。

## 9. 参考文献与核验状态

> 说明：以下条目按用户提供的论文清单整理。`已核验` 表示本次研究直接访问了出版社/DOI/arXiv 页面或摘要；`用户提供` 表示来自用户清单，尚未独立核对全文；`预印本` 表示尚未经过同行评审，数字不可直接用于生产决策。

1. Lehmann, H.-P., Mueller, T., Pagh, R., Pibiri, G. E., Sanders, P., Vigna, S., & Walzer, S. *Modern Minimal Perfect Hashing: A Survey*. ACM Computing Surveys 58(10), 2026. [arXiv:2506.06536](https://arxiv.org/abs/2506.06536) · [UNIMI 记录](https://expertise.unimi.it/resource/item/1571793) — 已核验（arXiv v3 摘要；摘要称最小构造比 `log2(e)` 下界高约 0.1%）。
2. Böther, M., Benson, L., Klimovic, A., & Rabl, T. *Analyzing Vectorized Hash Tables Across CPU Architectures*. PVLDB 16(11): 2755–2768, 2023. [PVLDB PDF](https://www.vldb.org/pvldb/vol16/p2755-bother.pdf) · [HPI 摘要页](https://hpi.de/rabl/news/2023/vectorized-hash-table-analysis-paper-accepted-at-vldb-23.html) — 摘要已核验；全文 PDF 未抽取。
3. Pandey, P., Bender, M. A., Conway, A., Farach-Colton, M., Kuszmaul, W., Tagliavini, G., & Johnson, R. *IcebergHT: High Performance Hash Tables Through Stability and Low Associativity*. SIGMOD/PACMMOD 2023; J. ACM 70(6), 2023. [DOI](https://doi.org/10.1145/3588727) · [MIT DSpace](https://dspace.mit.edu/handle/1721.1/150847) — 摘要已核验（空间开销约 17%）；全文细节待核验。
4. *MultiTable: A Faster Hash Table at any Physical Load Factor up to and Including One*. arXiv:2609.39233, 2026-09. [HTML](https://arxiv.org/html/2609.39233v1) — 预印本，待核验；不要直接采信数字。
5. Nicaud, Rotondo. *A Fine-Grained Analysis of SIMD-Based Hash Table Implementations*. arXiv:2610.02385, 2026-10. [HTML](https://arxiv.org/html/2610.02385) — 预印本。
6. Abseil. *Swiss Tables Design Notes*. [abseil.io](https://abseil.io/about/design/swisstables) — 工程一手资料，已核验入口。
7. Farach-Colton, Krapivin, Kuszmaul. *Optimal Bounds for Open Addressing Without Reordering*. FOCS 2024, pp. 594–605; arXiv:2501.02305. [arXiv HTML](https://arxiv.org/html/2501.02305v2) — 用户提供。
8. Freitag et al. *Adopting Worst-Case Optimal Joins in Relational Database Systems*. PVLDB 13(11): 1891–1904, 2020. — 用户提供。
9. Shi, Dhulipala, Shun. *Theoretically and Practically Efficient Parallel Nucleus Decomposition*. arXiv:2111.10980. [PDF](https://arxiv.org/pdf/2111.10980) — 预印本。
10. *Dremel: Interactive Analysis of Web-Scale Datasets*. VLDB 2010. — 用户提供。
11. *Nested Parquet Is Flat, Why Not Use It?* SIGMOD 2025. [PDF](https://daml.in.tum.de/~rey/papers/nestedparquet_rey.pdf) — 用户提供。
12. *ERT* (SIGMOD 2023), *CuckooGraph* (ICDE 2025) — 用户提供的延伸阅读；本报告未将其作为主要证据。
13. Pibiri, Trani. *PTHash: Revisiting FCH Minimal Perfect Hashing*. SIGIR 2021. [arXiv](https://arxiv.org/abs/2104.10402v2) — 用户提供。
14. *SicHash*, *PaCHash* (ALENEX 2023), *PHOBIC* / *ShockHash* (ESA/ALENEX 2024), *Learned Monotone MPHF* (ESA 2023) — 用户提供；按 MPHF 家族处理。
15. Hermann et al. *Learned Static Function Data Structures*. PVLDB 19(5): 917–930, 2026. [PDF](https://www.vldb.org/pvldb/vol19/p917-vinciguerra.pdf) — 用户提供。
16. Schulze et al. *ClickHouse – Lightning Fast Analytics for Everyone*. PVLDB 17, 2024. [PDF](https://www.vldb.org/pvldb/vol17/p3731-schulze.pdf) — 用户提供。
17. *Robust External Hash Aggregation in the Solid State Age*. ICDE 2024 — 用户提供。
18. Xue, Marcus. *Global Hash Tables Strike Back!* PVLDB 19(3): 523–535, 2025. [PDF](https://www.vldb.org/pvldb/vol19/p523-marcus.pdf) — 用户提供。
19. *SepHash*. PVLDB 17(5), 2024; *SHARD*. PVLDB 19(4), 2025. [PDF](https://www.vldb.org/pvldb/vol19/p684-zha.pdf) — 用户提供。
20. *Leveraging Caches to Accelerate Hash Tables and Memoization*. 2019. [DOI](https://doi.org/10.1145/3352460.3358272) — 用户提供。
21. *Making Pointer-Based Data Structures Cache Conscious*. 2000. [Microsoft Research](https://www.microsoft.com/en-us/research/publication/making-pointer-based-data-structures-cache-conscious/) — 用户提供。
22. *Cache-Conscious Structure Definition*. 1999. [Microsoft Research](https://www.microsoft.com/en-us/research/publication/cache-conscious-structure-definition-2/) — 用户提供。
23. *On the Optimal Time/Space Tradeoff for Hash Tables*. arXiv:2111.00602, 2021. [arXiv](https://arxiv.org/abs/2111.00602) — 用户提供。
24. GraphBLAS, Ligra, Galois, VTK, NetworkX, SuiteSparse — 用户提供的工程/框架参考；本报告只使用其 CSR/CSC 与列式数组思想。

## 附录 A：公式速查

| 场景 | 公式 | 条件 |
|---|---|---|
| 嵌套访问 | `T ≈ d(c_h+c_p)` | 每层哈希+指针成本近似常数 |
| 扁平访问 | `T ≈ c_a+c_index` | 索引预计算 |
| 成功探测 | `S(α)≈(1/α)ln(1/(1−α))` | 均匀探测近似 |
| 失败探测 | `U(α)≈1/(1−α)` | 均匀探测近似 |
| 名称索引 | `O(N²) → O(N)` | 用 set/dict 维护唯一性 |
| CSR 内存 | `4N+12E+4` bytes | int32 索引 + float64 权重 |
| 编译盈亏 | `S* = T_compile/Δ` | 之后至少跑 S 步 |
| 全量 checkpoint | `C_ckpt=c_alloc B+c_mem M` | 对象图 |
| undo-log | `C_undo=c_log u+pC_restore` | 修改集远小于全量 |
| 版本化快照 | 未变 `O(1)`，变化 `O(Δ)` | revision 正确失效 |

## 附录 B：研究记录与限制

- 本报告基于 `PERF_DICT_AND_CPP_AUDIT.md`（历史审计，已归档）的只读测量，未重新运行 390 节点基准；所有“预期收益”是审计估计或本报告的数学量级，不是承诺。
- 论文清单中部分条目只核验到出版社/arXiv 入口，未逐篇通读全文；引用具体数字时已在正文标注来源和不确定性。
- `MultiTable`、`Fine-Grained SIMD Hash Analysis`、`Learned Static Functions` 属于新预印本/新方向，需独立复现后再考虑进入生产。
- 本报告不修改任何 NetLab 运行时代码；若进入实施，应按 `AGENT_GUIDE.md` 的范围/证据/回归要求单独开工作项。
