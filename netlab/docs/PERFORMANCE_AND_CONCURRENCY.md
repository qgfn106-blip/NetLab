# Netlab 并发与性能优化研究（多线程 / 多进程 / 异步 / 数据压缩 / 计算优化）

> 最后更新：2026-11-06 03:43（Asia/Shanghai）
> 适用基线：APP_BUILD 3.20.1（`netlab/server.py`），本次为**代码勘察 + 实测基准**，未改动任何运行代码。
> 文档性质：**技术评估与研究记录（非当前实现口径）**。结论分「已核实事实」与「建议/待验证」两类标注，供后续决策参考。
> 证据写法：`文件:行号` 指向当前代码；测得的数字来自 `NetlabExtras/scratch/bench_solve.py`（本机 Anaconda 3.13.9）。
> **规范化收敛**：本文件是**研究台账**（探索性）。可验收的数学规范见 [UNIFIED_SIM_MATH_SPEC.md](UNIFIED_SIM_MATH_SPEC.md)，零耦合参考实现与 pytest 见 [NetlabHome/mathspec/](../../mathspec/README.md)。

---

## 0. 结论速览（TL;DR）

- **"单进程"基本成立，"单线程"完全不是。** 后端 = 一个 OS 进程 + 大量线程（uvicorn 单 worker、pywebview UI 是另一个 WebView2 进程树）。真正的约束是 **CPython GIL**，不是进程数。
- **典型电路不算力瓶颈**（实测单步 ~0.48ms；R31 里 10 万步 101.7s ≈ 2× 实时）。瓶颈只在三种特定形态出现，且分属三层：
  1. **算力（单核 GIL）**：大/刚性非线性电路 —— Newton 迭代 × O(N³) 稠密解或昂贵稀疏分解，单线程吃满一个核。
  2. **交互（架构缺陷）**：`precompute` 全程持同一把 RLock，跑 0→T 期间 `/api/live`、`/api/state`、`/api/control` 全被阻塞 → 界面假死。
  3. **感知（前端）**：浏览器端 110ms 轮询 ≈ 9Hz 刷新，才是肉眼顺滑度上限（后端其实 30fps）。
- **多进程该上的是「任务分片」**（AC 扫频 / 参数扫描 / 多网络 / 重预计算隔离 / 三维批量出图），不是「单步」。
- **异步（async/await）对算力零帮助**，价值在「流式推送 + 长任务编排」。
- **压缩/编解码优化的是数据（传输/存储/序列化），不会让计算变快。**

---

## 1. 现在的线程 / 进程全景（已核实）

同一 OS 进程内（`netlab/desktop/server_host.py` 把 uvicorn 塞进后台线程，`workers=1`）：

| # | 线程 / 进程 | 证据 | 职责 |
|---|---|---|---|
| 1 | 主线程 | pywebview 启动 | GUI 事件循环（WebView2 托管） |
| 2 | uvicorn 事件循环线程 | `server_host.py` 后台 `threading.Thread` | asyncio 事件循环，监听 127.0.0.1 |
| 3 | anyio 工作线程池 (~40) | `server.py` 端点全是同步 `def` | 执行所有 HTTP 端点（FastAPI 自动 `run_in_threadpool`） |
| 4 | `netlab-simulation` | `core/compute/simulation.py:185` `Thread(name="netlab-simulation")` | 固定步长推进**当前网络**（其余网络冻结） |
| 5 | `netlab-fem` | `core/compute/fem.py:441` `Thread(name="netlab-fem")` | 有限元求解 |
| 6 | PlotKit 同步线程 | `plotkit_bridge.py:188`，`SYNC_INTERVAL=0.5` | 2Hz 从仿真环形缓冲拉增量给绘图 |
| 7 | PlotKit VTK 渲染线程 | `_vendor/plotkit/backends/pyvista_backend._WORKER` | 单线程三维渲染（OpenGL 上下文绑线程） |
| 8 | **ProcessPoolExecutor 子进程** | `_vendor/plotkit/backends/pyvista_pool.py` `render_many`，`min(4,CPU-1)` | **唯一真·多进程**：三维批量出图 |
| — | WebView2 进程树 | — | 前端 JS/渲染，独立于 Python 进程 |

**并发原语**：`core/compute/accel.py` 全局 `_LOCK=RLock`；`core/model/networks.py` `NetworkContainer.lock=RLock`；`simulation.py:166` `Simulation.lock=RLock`；PlotKit `_LOCK=Lock`。所有 Python 线程共享一把 GIL，纯 Python 段互相串行。

**规模护栏**：`core/common/limits.py:15-17` `MAX_NODES=400 / MAX_EDGES=1200 / MAX_FIELDS=64`。

---

## 2. 瓶颈评估（三层）

### 2.1 算力瓶颈 — 单核 GIL 下的时间步进
- 仿真循环：`simulation.py:199 _loop` 每帧在**一个线程**里串行跑 `steps_per_frame × _advance_locked`；`_advance_locked:227` → `scene.step()`（`nodal.py:1715 step` → `_step_locked:1726`）→ Newton（≤60 次）× 每步一次线性解。
- 线性解：稠密 <200 阶用缓存 LU（`nodal.py:1993 _solve_matrix`，首拍 `_scipy_lu_factor:2038`，后续 `_scipy_lu_solve:2026` 仅在矩阵变化时重分解）；>200 阶走稀疏 `_solve_sparse:2079` → `splu:2116`。
- **根因**：逐 element 的 Python 装配/Newton 循环受 GIL 锁死，多线程救不了；逼近 `MAX_NODES=400` 且需大量 Newton 迭代的刚性非线性电路会在单核掉出实时。

### 2.2 交互瓶颈 — 预计算全程持锁（最该先修）
- `simulation.py:316 precompute` 在 `with self.lock:`（:318）内跑完整个 0→T 循环，**全程持有同一把 RLock**，期间 `live:627 / info:594 / snapshot:619 / control` 全部阻塞 → 界面假死。
- 唯一逃生口：`cancel_precompute:312` 故意不取锁、只置取消标志。
- 建议：改成**异步 job + 进度推送**（见 §5），或至少分段让锁。

### 2.3 感知瓶颈 — 前端 9Hz 轮询
- `frontend/app.js:9765 pollLive` 每 110ms 拉 `/api/live?cursor=&limit=600`（注释「每 110ms 一次」，:9807）。
- 绘制 `drawGraph` 已被 `:2957 animationLoop` 的 `timestamp-lastPaint>=33` 门控到 ~30fps。
- 结论：视觉刷新 ≈ 9Hz 由轮询决定，与后端 30fps 不匹配。改 SSE/WebSocket 推送可解。

### 2.4 实测基准（`NetlabExtras/scratch/bench_solve.py`，已核实）
**稠密复数 `np.linalg.solve` 单次调用（O(N³)，<200 阶电路与小 AC 扫频走它）**

| N | 50 | 100 | 200 | 400 | 800 |
|---|---|---|---|---|---|
| ms | 0.030 | 0.096 | 0.591 | 3.446 | 18.67 |

**稀疏 `splu` 分解 / 求解（>200 阶走它）**

| N | 200 | 400 | 1000 | 4000 |
|---|---|---|---|---|
| factor(ms) | 1.61 | 6.19 | 109.7 | **10152** |
| solve(ms) | 0.026 | 0.072 | 0.566 | 15.3 |

> 说明：4000 阶是随机稀疏（非带状）悲观上界，真实电路矩阵有带状结构会便宜很多；但结论明确——**稀疏成本几乎全在「分解」，求解极便宜**，故「矩阵不变就复用分解」是关键优化（已实现）。

**纯 Python 每元素循环代理**（400 元素 × 60 Newton × 30fps 空循环）= **59ms/每仿真秒**（真实 `stamp/prepare` 是它的数倍到数十倍），佐证 GIL-bound 装配是单核饱和根因。

**历史实测（记忆）**：单步 ~0.48ms；R31 100,000 步 101.7s → 开关模型 24.0s（模型/事件层同样是大头）；Recorder 缓冲 5.4MB / 11.2MB。

---

## 3. 多线程：哪里够 / 哪里加

- **够用**：HTTP 层已是 ~40 线程池，I/O 并发充足。
- **适合线程**：I/O / 采样 / 调度型（PlotKit 2Hz 同步线程即正确做法）。
- **加线程无收益**：CPU 型在 GIL 下零收益；若一定要线程内并行数值，必须让热点落在 NumPy/SciPy 的 C 层（会释放 GIL），不能是 Python 级 `for` 循环。

## 4. 多进程：哪里真正需要

| 场景 | 现状 | 建议 |
|---|---|---|
| AC 扫频 / 参数扫描 / Monte Carlo | `nodal.py:2314` 纯 Python `for frequency in freqs:`，每频点全新复数稠密解、无复用（:2332） | 按频率分片到进程池，近线性加速（≤2001 点） |
| 多网络并行仿真 | 只推进当前网络，其余冻结 | 每网络一进程（线程无用） |
| 重预计算隔离 | `precompute` 持锁 | 挪 worker 进程 + 进度回调 |
| 三维批量出图 | `pyvista_pool.py` ProcessPoolExecutor | 保持（OpenGL 上下文必须绑进程） |
| 多工程/后台任务 | — | 与 UI 进程隔离 |

**明确不要多进程**：单条电路单个时间步（时间步串行，IPC/序列化开销 >> 收益）——这类提速走 BLAS 多线程（OpenBLAS/MKL）或 GPU（`accel.py`，规模门控 `DEFAULT_GPU_MIN_SIZE=192`，单步内同步）。
**架构事实**：`SERVICE`/`FEM` 是 `server.py` 模块级内存单例，**不能靠 `uvicorn workers>1` 横向扩容**（每个 worker 各持一份状态会发散）；进程化只能做「任务级分片 + 单一状态所有者」。

---

## 5. 异步（async/await）：落地点与反模式

> **定盘**：async 对算力零帮助，甚至有害——`async def` 里跑 numpy 会把事件循环堵死（比现在还糟）。async 的价值 = **等待型 I/O、任务编排、结果推送**。判断标准一条：**这个 await 期间是否真的在等（网络/磁盘/另一个进程/定时器）？** 是 → 值得；不是（在算）→ 不要。

| 场景 | 现在 | async 做法 | 收益 |
|---|---|---|---|
| **① 预计算 / 长任务** | `precompute` 同步持锁 → 假死 | `POST /api/precompute` 立即 `202+job_id`；计算本体进 ProcessPoolExecutor，`await loop.run_in_executor`；`GET /api/precompute/{id}/events` 用 **SSE 异步生成器**推进度；取消 = task cancel | **治界面假死（P0，最高价值）** |
| **② `/api/live` 轮询** | 每 110ms 拉 JSON（~9Hz 上限） | 后端 SSE 端点：帧产出 → `asyncio.Queue` 唤醒 → `yield` 增量；前端 `EventSource` | 去掉轮询/短连接线程开销，顺滑度↑ |
| **③ 批量任务并发** | 串行 for | `await asyncio.gather(*[loop.run_in_executor(pool, solve_one, f) for f in freqs])` | 多任务并发、可单独取消/进度 |
| 工程 load/save、导入导出 | 同步阻塞（`networks.py:272 load_project`） | `await asyncio.to_thread(...)` | 大文件时事件循环不卡 |
| 周期性维护（自动保存/缓存清理） | `threading.Thread`（`plotkit_bridge.py:188`） | `asyncio.create_task` + `async def` 循环 | 少常驻线程，生命周期统一 |
| 优雅关闭 | `server.py:2161` shutdown 线程 | lifespan 里 `await task.cancel()` | 取消/清理更可控 |

**反模式**：❌ 把 `_advance_locked`/Newton/装配改成 async；❌ 把同步 `def` 无脑改 `async def`（里面还是同步计算）；❌ 为 async 而 async（单用户桌面，线程池已够）。注意 `asyncio.to_thread` 走线程池，纯 Python 仍受 GIL；**重数值任务用 ProcessPoolExecutor 才有真并行**。

---

## 6. 数据侧：压缩 + 编解码模块（`codec.py` 设计）

> **定调**：压缩/编解码优化的是「数据」——传输、存储、序列化；它不会让「计算」本身变快。对 netlab，`/api/live` 每 110ms 的 JSON 帧、Recorder 的 5.4/11.2MB 曲线缓冲——这些是能压的；GIL 下的时间步进它救不了。

建议照 `core/compute/accel.py` 的成熟套路（**后端注册 + 缺失依赖静默回退 + raw 兜底**）做一个对称的 `core/common/codec.py`：`encode(frame)->bytes / decode(bytes)->frame`，后端可插拔，永远有 raw 兜底。

**① 运行时曲线 / `/api/live` 帧（热路径，收益最大）**
- **无损、数值友好**：[Blosc2](https://blosc.org)（`pip install blosc2`）专为数值数组设计——多线程分块 + `shuffle`/`bitshuffle` 过滤器对 float 序列极有效，含 NDArray/SChunk 容器。例：`blosc2.compress(arr, cname='zstd', filter=blosc2.Filter.BITSHUFFLE)`；比裸 zstd 更适合 ndarray。
- **时序专用编码**：相邻帧高度相关 → *delta-of-delta* + 浮点 *XOR（Gorilla）* + 位打包，平滑信号可 10×+。参考 [tscodec-go](https://github.com/MichaHoffmann/tscodec-go)（自适应时序编解码）。
- **传输换二进制**：现在走 `fast_json`（文本 `json.dumps`，`server.py:137`）。改 **Arrow IPC**（`pyarrow`，零拷贝列式）或 `numpy.tobytes()+zstd`，前端用 `TypedArray` 直读，省掉 JS 端 JSON.parse。

**② 磁盘：工程文件 / 预计算快照** → `Zarr` / `HDF5(+Blosc)` / `Arrow Feather`；Blosc2 `NDArray` 可直接落盘并保持压缩，代替无压缩 `.npz`。

**③ 进程/线程间（预计算 job、扫频分片、PlotKit）** → 首选 **`multiprocessing.shared_memory`（Python 标准库，零新依赖！）** 避免 pickle 拷贝；大规模可用 Arrow Plasma。

**关键提醒**：压缩本身花 CPU，单核已满时若放关键路径会抢 CPU、得不偿失——压缩只放**边界**（网络/磁盘/跨进程），放 I/O 线程/进程，别进仿真线程。**lossy 压缩绝不能碰仿真真值**，只能用于「显示副本」。

---

## 7. 计算侧：现代优化方法（GitHub / arXiv 检索结果）

| 方向 | 方法 / 工具 | 对 netlab 适用性 |
|---|---|---|
| **JIT 编译** | [Numba](https://numba.pydata.org/)（`@njit` 编循环为本机码）、Cython、Pythran | ⭐⭐⭐ 最直接命中 GIL 瓶颈：`nodal.py` 逐 element `stamp()`/Newton `@njit`，消除解释开销 |
| **数组表达式融合** | NumExpr（免临时数组）、JAX（`jit`+`vmap`，纯函数/静态形状约束） | ⭐⭐ 适合向量化后的装配与探针计算 |
| **稀疏直接法** | 重排序降 fill-in（COLAMD/AMD、METIS nested dissection）；GPU 稀疏 LU：[GLU3.0 (arXiv:1908.00204)](https://arxiv.org/abs/1908.00204) 比 GLU2.0 7–13× | ⭐⭐ 实测 splu 4000 阶分解 10s，**fill-in 是命门**，重排序比换硬件更划算 |
| **GPU 线性代数** | cuSPARSE / cuSOLVER / CuPy（`accel.py` 门控 192 已备） | ⭐ 批量扫频/大矩阵值得，单步同步下收益有限 |
| **自适应步长/变阶积分** | BDF/GEAR（SPICE 默认 trapezoidal+GEAR），局部截断误差控步 | ⭐⭐⭐ 减少总步数，常比单步提速更有效（R31 开关模型 101.7s→24s 即模型层大头） |
| **Newton 优化** | 简化/chord Newton 复用 Jacobian、稀疏 Jacobian、GMIN 步长钳制减少失败重试 | ⭐⭐ 刚性非线性电路主要耗时源 |
| **误差有界有损压缩** | 综述 [Survey on Error-Bounded Lossy Compression (arXiv:2404.02840)](https://arxiv.org/abs/2404.02840)、[SZ3 (arXiv:2111.02925)](https://arxiv.org/html/2111.02925v2)、ZFP | ⭐⭐ 只用于显示/传输副本，不污染真值 |
| **内存/分配** | 环形缓冲复用、numpy 预分配 in-place、对象池，避免每步 alloc | ⭐⭐ 低成本直接见效 |
| **并行范式** | 任务并行=进程池（扫频）；数据并行=向量化/GPU；流水线=仿真→压缩→渲染 | 与 §4 一致 |
| **混合精度** | 中间/显示量 float32，真值 float64 | ⭐ 谨慎，需误差验证 |

**提速顺序经验**：向量化 → JIT → 算法（自适应步长/稀疏重排）→ 并行/GPU，而非先上多进程。netlab 目前卡在「第一档没做透」（逐 element Python 循环）就先谈多进程了。

---

## 8. 优化优先级路线图

- **P0 交互**：预计算 async job + SSE（修界面假死）。
- **P1 数据**：`codec.py` 编解码层；`/api/live` 改二进制帧（Blosc2/Arrow）；Recorder 压缩存储；多进程分片用 `shared_memory`。
- **P1 计算**：**Numba 编译热循环（stamp/Newton）**（对单核 GIL 最直接）；稀疏重排序（COLAMD/AMD）；自适应步长（BDF/GEAR）。
- **P2**：GPU 稀疏 LU / CuPy 批量；JAX 试点；混合精度。

**依赖策略**：codec / numba / blosc2 都做**可选依赖 + 缺失回退**（像 `nodal.py:_load_scipy` 按需导入），不硬绑定。
**验收纪律**：性能改动用**同模板 5 次取中位数 + A/B 交替（git stash 切换）**，落在 ±15% 噪声边缘如实标「噪声边缘」，不吹百分比。

---

## 9. 待验证 / 风险

- [ ] `codec.py` 各后端在真实 `/api/live` 帧与 Recorder 缓冲上的**压缩比 + 编解码耗时**（离线基准，未做）。
- [ ] Numba `@njit` 对 `stamp/Newton` 热循环的 A/B（5 次中位数，未做）。
- [ ] 稀疏重排序对真实电路矩阵 fill-in 的影响（`bench_solve.py` 用的是随机稀疏，需换真实矩阵复核）。
- [ ] 压缩 CPU 成本 vs 传输节省的净收益（loopback 同机 HTTP 带宽非瓶颈，收益主要来自跳过 JSON 文本解析）。
- [ ] lossy 压缩的误差界选取与「只用于显示副本」的隔离机制。
- [ ] async job/SSE 与现有 `cancel_precompute`、桌面 token 契约（`app.js` 走 `api()` helper）的兼容。

---

## 10. 参考链接（第一轮：并发 / 数据 / 计算）

- Blosc2 / python-blosc2：<https://blosc.org> · <https://blosc.org//python-blosc2/getting_started/overview.html>
- Numba：<https://numba.pydata.org/>
- tscodec-go（时序编解码）：<https://github.com/MichaHoffmann/tscodec-go>
- GLU3.0 GPU 稀疏 LU for 电路仿真：<https://arxiv.org/abs/1908.00204>
- 误差有界有损压缩综述：<https://arxiv.org/abs/2404.02840>
- SZ3：<https://arxiv.org/html/2111.02925v2>
- 基准脚本：`NetlabExtras/scratch/bench_solve.py`

---

## 11. 跨学科方法灵感库（第二轮检索：自动控制 / 数值分析 / 离散数学 / 计算机 / ML·AI）

> 第二轮目标：跳出"并发+压缩"的框，从**别的学科**借"先进技巧与灵感"，看能否迁移到 netlab 的仿真/分析引擎。
> 每条给出：**思想 → 出处 → 对 netlab 的启发 → 落地性/风险**。
> 标记：⭐ 低风险、可较快试点；🔬 研究性、需原型验证；⚠️ 谨慎（精度/真值隔离）。
> 提醒：本轮只做**方法与灵感清单**，未逐一复现论文；引用公式/数字前须按项目规矩先取原文核对（记忆教训），此处不臆造公式。

### 11.1 自动控制（control）

1. **实时 MPC 的在线快速 QP（imuQP）** — [arXiv:2503.03581](https://adsabs.harvard.edu/abs/2025arXiv250303581T)：用 *inverse-matrix-updates* 让 QP 每周期不从头分解。
   - 启发：netlab 的 AC 扫频/工作点每频点都 `np.linalg.solve` 全新矩阵（`nodal.py:2332`，§2.4）。当**频率/参数慢变**时，可借"秩一/低秩更新复用上一步分解"。⭐（与现有 `_lu_cache` 同源，可扩到频点间）
2. **波形松弛 (Waveform Relaxation) + Parareal 并行时间** — [arXiv:1909.08895](https://arxiv.org/abs/1909.08895)：场/路耦合用 WR 协同仿真，并对 WR 施加 **parareal（并行时间）**，再用 micro-macro parareal 把"场系统"用集总模型替代做顺序段。
   - 启发：**"并行时间"是 §4 没提到的一条多进程路**——把 0→T 切段并行迭代，直指 `precompute` 长任务（§2.2）。🔬 风险：parareal 需迭代收敛，粗糙传播子精度决定加速；刚性/故障瞬态未必收敛快。
3. **模型降阶 (MOR) / 扩展 Krylov 子空间** — [arXiv:2007.01948](https://arxiv.org/abs/2007.01948)：moment-matching + 扩展 Krylov 处理多端子电路模型降阶。
   - 启发：**先降阶再仿真**——大网络缩成小等效模型，属"算法层"提速（可比并行更有效）。🔬 限制：主流 MOR 面向线性时不变；netlab 在线改参数/拓扑需重建，更适合**只读分析 / 扫频**，不适合交互仿真。
4. **无源 / 耗散性约束** — 控制理论用 passivity/dissipativity 保证数值稳定（呼应 SPICE passivity）。
   - 启发：若求解器保留结构（无源/能量守恒），可用更大步长仍稳定。🔬

### 11.2 数值分析 / 数学（numerical analysis）

1. **指数积分器 + 自适应 Krylov** — [arXiv:2607.11293](https://arxiv.org/html/2607.11293)：对刚性线性部分用矩阵指数精确推进、非线性部分低秩近似，Krylov 维数自适应（low-rank exponential integrators）。
   - 启发：电路可写成 `C dx/dt = -G x + f`（线性主导刚性），指数积分器对"线性主导"的 RC/传输线可**大步长且稳定**，正中 §7「自适应步长」痛点。🔬 风险：需 `expm_multiply`/Krylov，每步成本高；开关/非线性元件破坏线性部分。
2. **算子分裂 / IMEX** — 把刚性项（隐式）与非刚性项（显式/半隐式）分开积分。
   - 启发：**线性网络部分隐式 + 非线性元件显式/半隐式**，减少每步全矩阵 Newton。⭐ 相对好落地、收益明确。
3. **随机投影神经网络解刚性 ODE（RPNN）** — [arXiv:2108.01584](https://arxiv.org/abs/2108.01584)：物理约束 + 随机投影网络拟合刚性 ODE 解。
   - 启发：把"解 ODE"变"训练小网络拟合"，粗网格上可跳过大量细步。⚠️ 精度/稳定性存疑，不能替代真值。

### 11.3 离散数学 / 图论（discrete math / graph）

1. **超图划分做并行电路仿真** — [CN116258114A](https://patents.google.com/patent/CN116258114A/zh)：用超图划分把电路切成子网并行。
   - 启发：除"多网络/任务分片"外，**单网络内部也能按拓扑切块**（domain decomposition）再交给多进程。⭐/🔬
2. **RL + GNN 做图划分 / 稀疏矩阵排序** — [arXiv:2104.03546](https://arxiv.org/abs/2104.03546)：A2C 强化学习 + SAGE 图卷积，递归划分图，产出 nested dissection 排序以**降低 fill-in**。
   - 启发：netlab 稀疏成本几乎全在 fill-in（§2.4 实测 4000 阶分解 10s）。用**学习到的排序替代 AMD/COLAMD/METIS** 是"算法+ML"交叉路。🔬 风险：训练/泛化成本，工业上 METIS/AMD 已很强，ML 排序目前多为小幅改进。
3. **近似最小度 (AMD) / nested dissection** — 经典重排序（§7 已列）；图论视角强调"**先切再排**"以压 fill-in。

### 11.4 计算机系统（computer science / systems）

1. **无锁 SPSC 环形缓冲** — [ringbuf (C++17)](https://github.com/UFO-010/ringbuf) / 环形队列：单生产者单消费者无锁。
   - 启发：netlab "仿真线程 → Recorder → HTTP/绘图"天然是 SPSC 形态，现用 `threading.Lock`+deque；改**无锁环形缓冲**可降采样/读取锁竞争。⭐ 但⚠️ CPython 里纯 Python "无锁"仍受 GIL，真实收益需把缓冲下沉到 C/`shared_memory` 或原子操作。
2. **数据布局 AoS → SoA + 缓存友好** — 装配时把 element 列表转 NumPy 结构化数组/SoA，减少 Python 对象属性访问。⭐
3. **SIMD / 向量化** — NumPy 已用 SIMD；重申"让热点落在 C 层"（§3）。
4. **arena / 对象池分配** — §7 已提，避免每步 alloc。

### 11.5 机器学习 / AI（ML / AI）

1. **GNN 代理模型（surrogate）** — [清华 PRL 超导量子电路 GNN 参数设计](https://new.qq.com/rain/a/20250723A08O5900)；通用思路：GNN 学"参数/拓扑 → 性能"映射。
   - 启发：在线用 GNN 前向做**参数扫描 / 设计优化的粗筛**（先粗筛再真仿真精算），不是替代真值。⭐（对"参数扫描"场景价值最大）
2. **神经算子 + FEM 域分解混合** — [arXiv:2504.11383](https://arxiv.org/abs/2504.11383)：physics-informed DeepONet 与 FEM 用 **Schwarz 域分解**耦合、数值时间推进，缓解"纯神经算子误差累积 / 多物理泛化差"。
   - 启发：**混合求解**——大部区域用便宜神经算子、关键/边界用精确 FEM/SPICE，Schwarz 交替。是"AI 加速但不失精度"的稳健范式。🔬
3. **PINN / Neural ODE 解刚性系统** — [arXiv:2511.11734](https://arxiv.org/html/2511.11734v1)："尺度感知残差"的 Physics-Informed Neural ODE 学刚性生物动力学。启发同 11.2.3，强调刚性需尺度感知。⚠️
4. **学习型预条件子（ML preconditioner）** — [arXiv:2010.2866](https://arxiv.org/abs/arXiv:2010.2866)（ML preconditioners for geophysical flows）、[arXiv:2609.37140 BandPC](https://arxiv.org/abs/2609.37140v1)（学习残差带预条件组合给 flexible CG）。
   - 启发：若未来从直接法 `splu` 转**迭代法**，可用 ML 预测/组合预条件子加速。🔬
5. **可微仿真（differentiable simulation）** — [Dojo, arXiv:2203.00806](https://arxiv.org/abs/2203.00806)：可微物理引擎（机器人）。
   - 启发：若 netlab 做**参数反演 / 自动调参 / 最优控制**，可微仿真能直接对元件参数求梯度，替代有限差分多次仿真。🔬 大改，但是控制/参数优化的高级方向。
6. **数字孪生 + 迁移学习（PDE）** — [arXiv:2501.06400](https://arxiv.org/html/2501.06400)：DT 数学与 PDE 迁移学习。
   - 启发：每个工程做"数字孪生"基线模型 + 迁移学习快速适配新参数。🔬

### 11.6 跨学科"元启发"一句话清单

- **从"重算"到"更新"**：秩一/低秩更新复用分解（MPC-iuQP、AC 扫频）。
- **从"串行时间"到"并行时间"**：Parareal / Waveform Relaxation（长预计算）。
- **从"大步长"到"稳定大步长"**：指数积分器 / IMEX / 算子分裂 / 无源约束。
- **从"直接解"到"降阶/代理"**：Krylov MOR、GNN 代理、神经算子混合。
- **从"每处都精确"到"分工"**：Schwarz 域分解、超图划分、混合精度。
- **从"锁"到"无锁/共享内存"**：SPSC ring、`multiprocessing.shared_memory`。

### 11.7 对 netlab 的优先级映射（保守）

| 档 | 方法 | 说明 |
|---|---|---|
| **可试点（⭐）** | 算子分裂/IMEX（线性隐式+非线性显式）；AC 扫频频点间矩阵更新/分片；无锁或 shared_memory 缓冲；AoS→SoA 布局；GNN 粗筛参数扫描 | 改动可控、收益路径清晰 |
| **中期研究（🔬）** | Parareal 并行时间；Krylov MOR（限线性/只读）；ML 预条件 / ML 排序；PINN / 神经算子混合求解；可微仿真 | 需原型 + 误差验证 |
| **谨慎（⚠️）** | 任何 lossy / AI 结果 | **绝不污染仿真真值**，只用于"粗筛/显示/加速候选"，必须 A/B 且误差有界（承接 §6 / §8 验收纪律） |

> 与第一轮的关系：第一轮解决的是"**工程层**"（并发/压缩/JIT/稀疏重排），第二轮多是"**算法层**"（降阶/时间并行/混合求解/AI 代理）。对 netlab 的排序仍成立：**工程层先做透（Numba、稀疏重排、自适应步长、async job），算法层有真实大网络/长预计算需求时再上**。

---

## 12. 参考链接（第二轮：跨学科）

- 实时 MPC 快速 QP（imuQP）：<https://adsabs.harvard.edu/abs/2025arXiv250303581T>
- 场/路耦合 波形松弛 + Parareal：<https://arxiv.org/abs/1909.08895>
- 扩展 Krylov 电路模型降阶：<https://arxiv.org/abs/2007.01948>
- 自适应 Krylov 低秩指数积分器：<https://arxiv.org/html/2607.11293>
- 物理约束 RPNN 解刚性 ODE：<https://arxiv.org/abs/2108.01584>
- 超图划分电路仿真（专利）：<https://patents.google.com/patent/CN116258114A/zh>
- RL+GNN 图划分 / 稀疏矩阵排序：<https://arxiv.org/abs/2104.03546>
- 无锁 SPSC ring buffer：<https://github.com/UFO-010/ringbuf>
- 神经算子 + FEM 域分解耦合：<https://arxiv.org/abs/2504.11383>
- Physics-Informed Neural ODE（刚性）：<https://arxiv.org/html/2511.11734v1>
- 学习型预条件子：<https://arxiv.org/abs/arXiv:2010.2866> · <https://arxiv.org/abs/2609.37140v1>
- 可微物理引擎 Dojo：<https://arxiv.org/abs/2203.00806>
- 数字孪生与 PDE 迁移学习：<https://arxiv.org/html/2501.06400>

---

## 13. 第三轮：更广方向的信息源（期刊 / 博客 / 专栏 / 社区），附地址

> 本轮特意跳出"论文"，纳入**工程博客、期刊专栏、厂商/社区文档、语言社区**，目的是把可长期跟踪的信息源沉淀下来，而不只是单篇论文。
> 说明：以下多为博客/专栏/文档，**非全部同行评审**，当作"灵感与工程实践"来源；引用其中具体结论或公式前，仍须打开原文核对（项目规矩，不凭摘要）。

| 方向 | 来源 | 地址 | 对 netlab 的用处 |
|---|---|---|---|
| 电路 / EDA（直接先例） | **Xyce**（Sandia 并行 SPICE 兼容仿真器） | <https://xyce.sandia.gov/?p=199/> | 大型电路**并行仿真**的工业级参考；号称首个可全仿真大规模数字电路。对标 §4「多进程/并行」 |
| 电路 / EDA | **ngspice**（开源 SPICE） | <https://ngspice.sourceforge.io/> | 开源 MNA / 器件模型实现，可对照 netlab 的 `nodal.py` 求解细节 |
| 电路 / EDA | SPICE 稀疏矩阵内核说明 | <http://xictools.com/manual/wrsmanual/node157.html> | 点明"仿真核心 = 装配 / 分解 / 求解"，与 §2.4 的 LU/splu 结论一致 |
| 电路 / EDA | Fast SPICE 技术综述（Stanford） | <http://chipgen.stanford.edu/people/alum/pdf/1405_Liao_VerilogModelForMixedSignalCircuits.pdf> | 加速 SPICE 引擎的技术集合（面向大设计），可作算法清单 |
| 电路 / EDA | **CircuitLab Blog** | <https://www.circuitlab.com/blog/13> | **浏览器端**电路仿真的工程实战，与 netlab 同形态，最贴近 |
| 电路 / EDA | **Wokwi** Makers Blog | <https://blog.wokwi.com> | 在线电路仿真/交互产品实践 |
| 性能工程（系统） | **pythonspeed**（Itamar Turner-Trauring） | <http://pythonspeed.com> | Python 性能实战（NumPy / Numba / 内存），**最贴 netlab 技术栈**，优先跟踪 |
| 性能工程（系统） | **Brendan Gregg** Blog | <https://www.brendangregg.com/blog/> | 系统性能方法论（火焰图 / 观测 / USE 方法） |
| 性能工程（系统） | **Dan Luu** | <https://danluu.com/> | 延迟与性能第一性分析（web bloat、input lag），校准"感知性能"直觉 |
| 无锁 / 并发 | **LMAX Disruptor + Mechanical Sympathy** | <https://www.javacodegeeks.com/2026/10/the-disruptor-and-mechanical-sympathy-ring-buffers-against-queues.html> · <http://lmax-exchange.github.io/disruptor/> | 无锁环形缓冲 vs 队列的经典论证，直接支撑 §11.4 的 SPSC 缓冲 |
| 数值 / 科学计算（期刊） | **SIAM News** | <https://sinews.siam.org/> | 应用数学 / 优化前沿专栏，长期灵感源 |
| 数值 / 科学计算（专栏） | **Nick Higham** Blog | <https://nhigham.com/> | 数值线性代数（矩阵函数 / 稳定性 / 舍入误差）权威随笔 |
| 数值 / 科学计算（专栏） | **Cleve's Corner**（MathWorks） | <https://blogs.mathworks.com/cleve/> | 数值算法 / 线性代数一手洞见（Cleve Moler 撰） |
| 语言 / 运行时（社区） | **Julia** | <https://julialang.org/> | 科学计算语言的多线程/性能设计可借鉴（不是建议换语言） |
| 数据驱动动力学（数学×控制） | **Koopman / DMD**（Nature topic） | <https://www.nature.com/nature-index/topics/l4/dynamic-mode-decomposition-in-nonlinear-dynamical-systems> | 用线性算子近似非线性动力学，或可做**降阶/加速**（呼应 §11.1 MOR、§11.2） |
| 数据驱动动力学 | SINDy / operator-theoretic methods | <https://www.emergentmind.com/topics/operator-theoretic-and-data-driven-methods> | 从数据辨识方程，建模/降阶灵感 |
| 前端 / Web 性能 | **OffscreenCanvas**（web.dev） | <https://web.dev/articles/offscreen-canvas> | 把 canvas 计算移出主线程（Web Worker），直指 netlab 前端 30fps 绘制上限 |
| 前端 / Web 性能 | requestAnimationFrame 60fps 指南 | <https://www.w3tweaks.com/javascript/javascript-requestanimationframe-60fps> | rAF 节流 / longtask 观测，对应前端 110ms 轮询问题（§2.3） |

**跟踪优先级建议**（性价比最高的 5 个）：
1. **pythonspeed** —— 直接对应 netlab 的 Python/NumPy 热点；
2. **Xyce / ngspice** —— 电路仿真的并行与求解工业实践；
3. **LMAX Disruptor / Mechanical Sympathy** —— 无锁缓冲改造；
4. **Nick Higham** —— 稀疏 LU / 矩阵函数 / 稳定性；
5. **web.dev（含 OffscreenCanvas）** —— 前端感知性能。

> 与 §11/§12 的关系：§11 是"方法灵感"，§12 是"论文出处"，本节是"**长期信息源**"。三者互补：先在本节筛来源 → 再到 §11/§12 找具体方法 → 需要落地时按 §6/§8 的验收纪律做 A/B。

## 14. 第四轮：现代力学 / 有限元分析的数学方法与简化方法（学习 + 评估）

> 本轮回答用户请求（m00296）：检索计算力学 / 有限元（FEM）的**数学主干、简化 / 降维方法、现代离散与求解器**，并逐条评估对 netlab 现有 FEM 的适用性。外部结论来自公开论文 / 教程（链接见 §14.6），落地前须打开原文核对，不凭摘要写代码。

### 14.0 先锚定 netlab 现在的 FEM 实况（评估基准）

- 代码：`NetlabHome/netlab/core/compute/fem.py`。对象是**二维瞬态热传导** Q4 双线性单元：`ρc ∂T/∂t = ∇·(k∇T) + q(x,y,t)`（模块 docstring 明写）。
- 离散：弱形式 + Galerkin；单元 K/M 用 **2×2 Gauss 积分**在参考单元上算后装配成全局稀疏阵（`_assemble` at `fem.py:210`，`coo_matrix(...).tocsr()`）。
- 时间：**后向欧拉**（L-稳定，无条件稳定）；每帧 `steps_per_frame` 步。
- 线性求解：`_build_factorization`（`fem.py:234`）构造 `operator = M/dt + K`，用 Dirichlet 掩码消去左右边界行列（reduced），`scipy.sparse.linalg.splu` **一次分解**（`_lu` 缓存，`_factor_dt` 变才重分解），每步只回代。
- 参数：`FemConfig` nx=36, ny=24, dt=0.002, fps=30, steps_per_frame=8, sample_every=1；Dirichlet 左右各 20℃，上下绝缘，高斯热源位置摆动。
- **结论先行**：对"单方块、线性、一阶热传导、~10³ 自由度"这类问题，当前"一次 splu + 每步回代"在数值上已是**教科书级正确且足够快**的解法；真正开销在 Python 逐层循环与帧节拍，不在线性代数（实测 splu solve 0.026–0.57ms，见 §2.4）。所以下面多数"高级方法"对**当前场景是过度设计**；价值在于"模型变大 / 变复杂 / 要并行"时的路线储备。

### 14.1 数学主干（已具备，确认无缺）

| 环节 | 方法 | netlab 现状 | 评估 |
|---|---|---|---|
| 空间离散 | 弱形式 + Galerkin；等参 Q4 | 已用 | ✅ 标准 |
| 单元积分 | Gauss 积分（2×2） | 已用 | ✅ 对 Q4 全积分无锁死 |
| 时间离散 | 后向欧拉（一阶、L-稳定） | 已用 | ✅ 热传导首选稳健；精度仅一阶，可用 Crank–Nicolson（二阶，需处理振荡）作精度升级 |
| 线代 | 稀疏直接法 splu + 回代 | 已用 | ✅ 中等网格最优；规模门槛见 14.3 |

### 14.2 简化 / 降维方法（用户重点：简化方法）

| 方法 | 一句话 | 适用前提 | 对 netlab FEM |
|---|---|---|---|
| **静态凝聚 Static Condensation / Schur 补** | 消去单元 / 子域内部自由度，只保留边界 / 界面未知量 | 高阶单元(p≥2)或有大量内部 DOF 的子结构 | Q4 无内部节点，**当前无收益**；引入 Q9/高阶或子结构才值得 |
| **子结构 / 超单元 Substructuring + Craig–Bampton** | 大模型拆"超单元"，缩为界面 DOF + 固定界面模态 | 大型装配体、重复部件 | 单方块用不上；扩成多区块 / 多材料装配时是标准路线 |
| **Guyan 缩减 / 模态截断** | 按刚度 / 模态能量丢弃低贡献 DOF | 结构动力学（二阶、惯性主导） | 一阶热传导刚性扩散谱宽，需保留大量模态，**收益弱**；不建议 |
| **模态叠加 Modal Superposition** | 先解广义特征问题 Kφ=λMφ，再按模态推进 | 线性、多工况、长时程 | 先付特征分解成本；仅"同模型跑很多次"才划算 |
| **POD–Galerkin / DEIM 降阶** | 用少量快照基把 N 维降到 r 维，非线性源项用 DEIM 采样近似 | 参数化 / 重复仿真、训练成本可摊销 | **最值得记的一条**：做参数扫掠 / 多次重复时数量级省时；单次瞬态不划算 |
| **质量集中 Mass Lumping** | 把一致 M 对角化，配合显式步进每步 O(N) 免解方程 | 显式动力学、波传播 | 热传导显式稳定 dt≲h²/2α（nx=36→dt~4e-4，比现 2e-3 小 5×），**显式反而更慢**，不推荐 |
| **减缩积分 Reduced Integration + hourglass 稳定** | 少取积分点防剪切 / 体积锁死 | 弯曲板壳、近不可压 | 热传导无锁死问题，**用不上** |
| **时间大步长 / finite increment calculus** | 放宽显式稳定步长限制 | 一阶瞬态 | 可探索，但需严格验稳 |

### 14.3 现代离散与求解器（面向"更大 / 更复杂 / 并行"）

| 方法 | 核心 | 何时值得上 | 对 netlab |
|---|---|---|---|
| **代数多重网格 AMG** | O(N) 迭代求解，替代直接法 | 网格 ≳10⁴–10⁵ DOF 或 3D | 现 splu 已够快（实测 N=1000 factor 109ms）；**规模门槛未到，暂不换** |
| **域分解 FETI / Schwarz** | 区域切块各解子问题，界面迭代耦合 → 天然并行 | 多核 / 多进程、超大模型 | 把 §4"多进程"真正落到 FEM 的**数学路径**；单机小网格不必 |
| **HDG（可杂化间断 Galerkin）** | 单元内部可静态凝聚消除，全局只解界面混合变量 | 高阶、并行、复杂几何 | 现代高阶范式；与 14.2 静态凝聚同源，思路可借鉴 |
| **VEM 虚拟单元** | 任意多边形网格上的广义有限元 | 网格质量差 / 多边形剖分 | 实现重，无场景，仅记录 |
| **IGA 等几何分析** | 用 CAD 样条基函数直接做分析，几何精确、高阶光滑 | CAD 集成、薄壳 / 流固 | 无 CAD 流程需求，仅记录 |
| **XFEM 扩展有限元** | 裂纹 / 界面不连续无需重划网格 | 断裂、损伤 | 无断裂需求，不适用 |
| **混合 / 对偶 FEM** | 同时解多个场变量 | 多物理场（热-力、渗流）耦合 | 将来做热-力耦合可考虑 |

### 14.4 "现代力学分析"的数学方法（分析力学视角）

- **变分原理 / 最小势能 / 虚功原理**：FEM 弱形式的理论根基，现实现已隐含使用。
- **拉格朗日 / 哈密顿分析力学 + 辛积分 / 变分积分器**（symplectic / variational integrator）：给结构动力学长期**保能量 / 保相空间结构**；对一阶热传导不适用，但若将来做**机械多体 / 结构动力学**，这是正确的时间积分框架。
- **离散外微分 DEC**：把"保结构离散"统一到外微分框架，理论参考价值 > 直接实现价值。

### 14.5 对 netlab FEM 的评估结论（分档，按性价比）

**A. 现在就该做（低成本、稳赚）**
1. **装配缓存**：K、M 只在 `mesh revision` 或物性参数变化时重装配；把 `_assemble` 结果按 revision 缓存。
2. **分解复用已有 ✅**：`operator=M/dt+K` 一次 splu，`dt` 不变就复用 `_lu`——保持，别每步重分解。
3. **每步回代成本已很低**（实测 solve 0.026–0.57ms），不是瓶颈；别过度优化这里。
4. **输出降采样**：录制 / 传输按 `sample_every` 或空间抽样，减少前端与序列化压力（呼应 §2.3）。

**B. 有明确新场景再做（别提前上）**
- 多区块 / 多材料装配体 → **子结构 + Craig–Bampton / 静态凝聚**；
- 参数扫掠 / 多次重复仿真 → **POD–DEIM 降阶**；
- 网格显著变大或转 3D → **AMG**（替代 splu）；
- 要真正并行 → **域分解（Schwarz / FETI）** + 多进程（§4）；
- 高阶 / 复杂几何 → **HDG**。

**C. 明确不推荐（对当前问题）**
- 显式 + 质量集中（热传导刚性 → dt 更小、更慢）；
- 减缩积分 / hourglass（无锁死问题）；
- XFEM / IGA / VEM（无对应工程场景）；
- Guyan 缩减 / 模态叠加（一阶热传导谱宽，收益弱）。

### 14.6 参考链接（第四轮：计算力学 / FEM）

| 主题 | 来源 | 地址 |
|---|---|---|
| 子结构 / 超单元 / Craig–Bampton | CAEflow 指南 | <https://caeflow.com/fea/substructuring> |
| 界面缩减法综述 | ScienceDirect | <https://www.sciencedirect.com/science/article/abs/pii/S088832701830284X> |
| 静态凝聚（Schur 补）教程 | NGSolve | <https://docu.ngsolve.org/v6.2.1910/i-tutorials/unit-1.4-staticcond/staticcond.html> |
| 高阶单元质量集中 | ScienceDirect (CMAME) | <https://www.sciencedirect.com/science/article/pii/S0045782517303043> |
| 减缩积分 + 热力学一致稳定 | ScienceDirect (CMAME 2010) | <https://www.sciencedirect.com/science/article/abs/pii/S0045782510000800> |
| POD / 降阶用于热传导 | ScienceDirect | <https://www.sciencedirect.com/science/article/pii/S0263822314004413> |
| key-node DEIM + AMR（瞬态热-力） | ScienceDirect | <https://www.sciencedirect.com/science/article/pii/S1290072926000633> |
| 大时间步显式瞬态热传导 | ScienceDirect (IJHMT) | <https://www.sciencedirect.com/science/article/abs/pii/S0017931016324607> |
| finite increment calculus 大步长 | ScienceDirect (CMAME 2022) | <https://www.sciencedirect.com/science/article/abs/pii/S004578252200425X> |
| 变分多尺度稳定 FEM（板 / 梁） | ScienceDirect | <https://sciencedirect.com/science/article/pii/S0168874X2300001X> |
| AMG 并行 FEM | BYU thesis | <https://scholarsarchive.byu.edu/etd/784> |
| 多重网格弹性实时（CUDA） | TUM | <https://www.cs.cit.tum.de/en/cg/research/publications/2011/a-real-time-multigrid-finite-hexahedra-method-for-elasticity-simulation-using-cuda/> |
| FETI 方法 | arXiv:1208.6380 | <https://arxiv.org/pdf/1208.6380v1> |
| 两通道传输条件域分解 | arXiv:2608.25041 | <https://arxiv.org/html/2608.25041v1> |
| HDG 教程（不可压流） | arXiv:1911.05198 | <https://arxiv.org/abs/1911.05198> |
| VEM 曲边 | arXiv:1711.04306 | <https://arxiv.org/html/1711.04306v2> |
| VEM H(curl)/H(div) | arXiv:2501.15168 | <https://arxiv.org/pdf/2501.15168v1> |
| IGA 曲线各向异性 | arXiv:2009.10293 / 2009.10230 | <https://www.arxiv.org/prevnext?id=2009.10293&function=prev> |
| 自适应网格加密标记策略基准 | arXiv:2605.05234 | <https://arxiv.org/html/2605.05234v1> |
| 降阶方法（几何非线性结构）综述 | arXiv:2107.05077 | <https://aps.arxiv.org/abs/2107.05077> |
| Reduced basis（参数化几何） | arXiv:1807.07790 | <https://export.arxiv.org/abs/1807.07790v3> |
| 混合 / 对偶 FEM | PMC | <https://pmc.ncbi.nlm.nih.gov/articles/PMC3185384/> |
| 辛积分保相空间结构 | Auckland | <https://researchspace.auckland.ac.nz/items/84f205de-daea-4a38-892f-00b2a95f5620> |
| 变分积分器 | Wikipedia | <http://wikipedia.com/wiki/Variational_integrator> |
| 离散外微分 DEC | DEC wiki | <https://th.vvikipedla.com/wiki/Discrete_exterior_calculus> |

### 14.7 一句话结论

> netlab 的 FEM 已是"正确的基础实现"，瓶颈不在数值方法而在**每步的 Python 开销 + 帧节拍**。上述方法里真正值得提前准备的是"**装配缓存 + 参数扫掠时用 POD/DEIM 降阶 + 大模型才上 AMG / 域分解**"；其余（子结构、HDG、IGA、VEM、XFEM、显式质量集中）是**按新场景触发**的储备，现在上就是过度设计。

## 15. 第五轮：计算流体力学 / 凝聚态物理 / 晶体计算模拟 的灵感与方法

> 本轮回答用户请求（m00341）：从 CFD、凝聚态物理、晶体计算模拟找灵感。这些是"**外域方法 → 类比迁移**"，不是直接给 netlab 用；引用具体算法前须打开原文核对（项目规矩）。

### 15.1 计算流体力学（CFD）

| 方法 | 核心思想 | 对 netlab 的迁移 / 评估 |
|---|---|---|
| **算子分裂 / 投影法（Chorin projection）** | 先解输运再投影到无散度约束，分步解耦 | 与 §11.2 算子分裂同源；多物理/多约束耦合可拆步解，**中价值** |
| **Lattice Boltzmann（LBM）** | 介观分布函数，局部"碰撞+迁移"，天然并行/GPU 友好 | 架构启发：大网络"局部更新 + 邻居交换"的分块无锁并行（呼应 §11.4 ring buffer），非直接算法 |
| **半拉格朗日 + 大时间步** | 回溯特征线，稳定下放宽 dt | 输运/对流主导问题可放宽步长；netlab 电路非对流主导，**低相关** |
| **WENO / 通量限制器 / 保单调重构** | 高阶重构抑制振荡、保单调 | 前端画曲线/插值防过冲可借用（边际）；**低价值** |
| **局部时间步 / 双时间步** | 各区域按自身稳定步长推进，外层伪时间收敛 | 对应 §14.5 的"多网络独立步长"：netlab 已冻结非当前网络，可进一步让各网络走各自 dt，**中价值** |
| **混合精度 + GPU（mixed-precision SEM）** | 主体低精度、关键处高精度 | 大矩阵线代可降 float32 提速（配合 `accel.py`），**值得试验** |
| immersed boundary / FSI / 谱元 | 复杂边界 / 高阶 | 无对应场景，**记录备查** |

### 15.2 凝聚态物理

| 方法 | 核心思想 | 对 netlab 的迁移 / 评估 |
|---|---|---|
| **DFT 平面波 + 赝势 + 自洽场（SCF）** | 固定点自洽迭代 + 混合（mixing）收敛 | 借鉴"自洽混合稳定强非线性迭代"，可辅助 `nodal.py` 的 Newton 收敛，**中价值** |
| **Anderson 加速 / DIIS 混合** | 对固定点迭代做历史外推加速收敛 | **⭐高价值可落地**：`_newton_with_strategies` 的迭代/松弛可加 Anderson/DIIS 加速，直接减少迭代数 |
| **Chebyshev 滤波子空间迭代 / 块 Chebyshev–Davidson** | 只求极值特征对，避开全谱 | AC 扫频/小信号若只需少数关键模态，用子空间迭代替代全特征分解，**中价值** |
| **Verlet / 辛积分（MD）** | 保能量长时程积分 | 与 §14.4 辛积分同源；结构/多体动力学适用，一阶热传导不适用，**储备** |
| **快速多极子 FMM（O(N)）/ 核无关 FMM** | 层次化远场近似，O(N) | 大型网络的远场/长程求和可层次化加速（若将来做电磁场 N 体），**按场景储备** |
| Ewald 求和 | 长程静电分实空间+倒空间 | 周期性场景才用，**不适用** |
| 蒙特卡洛 | 采样估计 | 参数不确定性的 MC 传播、随机化粗筛，**低-中价值** |

### 15.3 晶体计算模拟

| 方法 | 核心思想 | 对 netlab 的迁移 / 评估 |
|---|---|---|
| **空间群对称性 / Wyckoff 等价类** | 用对称性合并等价原子/坐标 | **⭐高价值可落地**：检测**图自同构/电路对称**→ 合并等价节点/支路，直接缩小 MNA 规模 |
| **k 点采样 + 对称性约化（Monkhorst-Pack）** | 只算不可约布里渊区点 | **⭐可迁移**：AC 扫频利用对称/共轭关系只算独立频点、复用邻近频点分解 |
| **结构预测进化 / 粒子群（CALYPSO / USPEX）** | 势能面多极值全局搜索 | 电路参数/拓扑自动寻优的全局搜索思路（呼应 §11.5 RL/GNN 粗筛），**中价值** |
| **声子 / 晶格动力学（DFPT）** | 简正模、色散关系 | 网络的模态/特征值分析（同 §14.2 模态），**储备** |
| 自洽场加速（Anderson/DIIS） | 见 15.2 | 与 15.2 合并：**最优先落地项** |

### 15.4 对 netlab 的迁移优先级（提炼）

**A. 高价值、可落地（建议列入试点）**
1. **Anderson / DIIS 收敛加速** → `nodal.py` 的 Newton/迭代收敛，减少迭代数与失败重试。
2. **对称性约化** → 图自同构检测合并等价节点/支路（缩小 MNA）；AC 扫频利用共轭/对称只算独立频点。
3. **混合精度 float32** → `accel.py` 大矩阵线代试验降精度提速（小矩阵仍 float64）。

**B. 中价值（有场景再做）**
- 局部/自适应时间步（多网络独立 dt）；Chebyshev/子空间迭代（模态/特征分析）；DFT 式自洽混合（稳定强非线性）。

**C. 低 / 不适用**
- Ewald、immersed boundary、FSI、半拉格朗日（无对流主导场景）；WENO 限制器（边际）。

### 15.5 参考链接（第五轮：CFD / 凝聚态 / 晶体计算）

| 主题 | 来源 | 地址 |
|---|---|---|
| CFD 数学模型与数值方法综述 | arXiv:2512.16351 | <https://arxiv.org/abs/2512.16351> |
| Lattice Boltzmann（软物质） | arXiv:2405.14551 | <https://arxiv.org/html/2405.14551v1> |
| Lattice Boltzmann（可压缩流） | arXiv:1209.3542 | <https://arxiv.org/html/1209.3542v1> |
| 投影法族（不可压 N–S，高频阻尼控制） | ScienceDirect | <https://www.sciencedirect.com/science/article/pii/S0045782518302494> |
| 算子分裂半拉格朗日 VOF 对流 | ScienceDirect | <https://www.sciencedirect.com/science/article/abs/pii/S0021999112002100> |
| 低耗散激波捕捉框架 | ScienceDirect | <https://www.sciencedirect.com/science/article/pii/S0021999120307348> |
| 7/9 阶 WENO 有限差分 | ScienceDirect | <https://www.sciencedirect.com/science/article/abs/pii/S004579302030092X> |
| 局部 / 双时间步 | CMCC | <https://www.cmcc.it/wp-content/uploads/2012/08/rp0135-isc-06-2012-1.pdf> |
| 无散度插值 immersed boundary | arXiv:1701.07169 | <https://arxiv.org/abs/1701.07169v1> |
| 熵稳定间断谱元（SBP） | arXiv:2312.07874 | <https://export.arxiv.org/abs/2312.07874> |
| 混合精度 SEM + GPU（Taylor–Green） | arXivLens | <https://arxivlens.com/PaperView/Details/mixed-precision-sem-based-cfd-simulations-on-gpus-a-taylor-green-vortex-case-5034-c8970dd8> |
| 平面波 DFT 方法（化学） | ScienceDirect | <https://www.sciencedirect.com/science/article/pii/S1574140017300099> |
| 平面波赝势方法 | NOMAD | <https://nomad-laboratory.de/meetings/FHImd2003/Dabstracts/pehlke1_2003.html> |
| NAMD 分子动力学（Verlet/辛积分） | PMC | <https://pmc.ncbi.nlm.nih.gov/articles/PMC7395834/pdf/JCPSA6-000153-044130_1.pdf> |
| 能量漂移（辛 vs 非辛） | Wikipedia | <https://en.chped.com/wiki/Energy_drift> |
| 核无关快速多极子 O(N) | arXiv:1605.01715 | <https://www.arxiv.org/abs/1605.01715v1> |
| Ewald 求和（量子-经典） | arXiv:2512.20886 | <https://arxiv.org/pdf/2512.20886v1> |
| Chebyshev 滤波子空间迭代（SCF） | ScienceDirect | <https://www.sciencedirect.com/science/article/pii/S002199910600146X> |
| 块 Chebyshev–Davidson 大特征值 | ScienceDirect | <https://www.sciencedirect.com/science/article/abs/pii/S0021999110004791> |
| CALYPSO 结构预测（粒子群） | CALYPSO | <http://www.calypso.cn/> |
| 晶体结构预测：空间群→全局最优 | 科研学术网 | <http://www.keyanxueshu.com/19605/> |
| 第一性原理声子（DFPT） | ScienceDirect | <https://www.sciencedirect.com/science/article/pii/S096697951300191X/pdfft?md5=ca8e47db3b370027741b15fdcbd08585&pid=1-s2.0-S096697951300191X-main.pdf> |
| k 点采样 / KPOINTS（VASP） | VASP Wiki | <https://vasp.at/wiki/index.php?diff=next&oldid=17894> |

### 15.6 一句话结论

> 这三个领域里，真正能"搬回 netlab"的是三条工程可落地项：**① Anderson/DIIS 收敛加速（省 Newton 迭代）② 对称性约化（图自同构合并等价节点 / AC 扫频只算独立频点）③ 混合精度大矩阵**；其余（LBM 并行、FMM、Ewald、结构预测、辛积分）是灵感与储备，按新场景触发。

## 16. 第六轮：开源仿真 / 计算软件的源码库 + 数学原理

> 本轮回答用户请求（m00372）：找**已有的仿真计算软件源码库**（GitHub/官方仓库）并梳理其**数学原理**，评估对 netlab 的借鉴。许可证以各仓库 LICENSE 为准（下表仅注"开源"），引用实现细节前须看源码。

### 16.1 电路仿真器（与 netlab `nodal.py` 最贴近）

| 项目 | 语言/许可 | 仓库 | 数学原理（要点） | 对 netlab 借鉴 |
|---|---|---|---|---|
| **ngspice** | C / 开源 | <https://ngspice.sourceforge.io/> · 镜像 <https://github.com/imr/ngspice> | 改进节点法（MNA）打表；Newton–Raphson + **迭代限幅**（pnjlim/fetlim）；DC 工作点用 **gmin 步进 / source 步进 / 伪瞬态**；瞬态用 BE / 梯形 / **Gear(BDF)**，按 **LTE 自适应步长**；稀疏 LU（新版接 KLU） | **最值得对照**：收敛策略（gmin/source stepping + 器件限幅）可直接移植到 `_newton_with_strategies`；LTE 变步长；KLU |
| **Xyce** | C++ / 开源 | <https://github.com/Xyce/Xyce> | MNA + Newton；**MPI 并行**（KLU/Trilinos）；**谐波平衡（Harmonic Balance）** 求周期稳态；.STEP/.AC | 并行化参考；谐波平衡用于周期/AC 稳态分析 |
| **ahkab** | Python / 开源 | <https://github.com/ahkab/ahkab> | MNA + Newton；瞬态(BE/梯形/Gear)；**符号小信号**；周期稳态(shooting) | **Python 实现、结构与 netlab 最近**，可逐行对照 `nodal.py` |
| **circuitjs1（Falstad）** | Java/JS / 开源 | <https://github.com/pfalstad/circuitjs1> | 浏览器端 MNA + 迭代松弛，实时求解 | 浏览器内"前端+解算同进程"的实时取舍参考（与 netlab 同形态） |

### 16.2 数值 / 线代 / ODE 内核库（可直接换/借）

| 库 | 语言/许可 | 仓库 | 数学原理 | 对 netlab 借鉴 |
|---|---|---|---|---|
| **SuiteSparse · KLU** | C / 开源 | <https://github.com/DrTimothyAldenDavis/SuiteSparse> | **面向电路/结构化稀疏矩阵的 LU**：AMD/BTF 排序 + 符号分解复用 | **⭐高价值**：电路矩阵拓扑固定时，KLU 常比通用 `splu` 更快（ngspice 用它）；可先 benchmark |
| **SUNDIALS · CVODE/IDA** | C / BSD | <https://github.com/LLNL/sundials> | **变阶变步长 BDF/Adams** 刚性 ODE/DAE 积分器 + Newton + LTE 控制 | **⭐高价值**：把固定 dt 升级为变阶变步长 BDF，成熟实现可借鉴其误差控制 |
| **PETSc** | C / 开源 | <https://github.com/petsc/petsc> | KSP 迭代求解、PC 预条件（AMG/ASM/ILU）、TS 时间步进、DM 域分解 | 若上 AMG / 域分解，直接复用（对应 §14.3） |
| SuperLU / UMFPACK | C / 开源 | 见 SuiteSparse / SuperLU 官网 | 通用稀疏直接 LU | 通用备选 |

### 16.3 FEM / CFD / MD / DFT 开源库（数学原理速览）

| 库 | 领域 | 仓库 | 数学原理（要点） |
|---|---|---|---|
| **FEniCS / dolfinx** | FEM | <https://github.com/FEniCS/dolfinx> | 变分形式自动装配（UFL 形式语言 → 代码），PETSc 后端；弱形式即代码 |
| **deal.II** | FEM | <https://github.com/dealii/dealii> | 自适应 **hp-FEM**、误差估计驱动网格加密、并行 |
| **MFEM** | FEM | <https://github.com/mfem/mfem> | 高阶有限元、有限元包、GPU |
| **Elmer** | 多物理 FEM | <https://github.com/ElmerCSC/elmerfem> | 多物理场耦合 FEM |
| **OpenFOAM** | CFD | <https://github.com/OpenFOAM/OpenFOAM-dev> | 有限体积（FVM）、**PISO/SIMPLE 压力-速度耦合**、**欠松弛因子** |
| **SU2** | CFD | <https://github.com/su2code/SU2> | 有限体积 + **adjoint 伴随**优化 |
| **LAMMPS** | 分子动力学 | <https://github.com/lammps/lammps> | Verlet 邻居表、PPPM 长程、多时间步 |
| **Quantum ESPRESSO** | DFT | <https://github.com/QEF/q-e> | 平面波 DFT、SCF 自洽迭代、赝势 |

### 16.4 源码级借鉴优先级

**A. 高价值、建议先做（可直接 benchmark / 移植）**
1. **KLU 替代/补充 `splu`**：电路/结构化稀疏矩阵专用 LU，拓扑固定时更快（benchmark 对比 `_solve_matrix` 的 `splu`）。
2. **移植 ngspice 收敛策略**：`gmin 步进 / source 步进 / pnjlim 限幅` → 增强 `_newton_with_strategies` 的稳健性（当前已有 strategies，可补这几招）。
3. **变阶变步长 BDF（借 SUNDIALS 思路）**：替代固定 dt 的后向欧拉，按 LTE 控步。
4. **ahkab 逐行对照**：Python 参考实现，核验 netlab MNA/Newton 实现。

**B. 中价值（有场景再做）**
- Xyce 谐波平衡（若做周期稳态/频域）；OpenFOAM 欠松弛（迭代稳定）；PETSc（若上 AMG/域分解）。

**C. 参考架构（不直接换）**
- FEniCS/deal.II/MFEM 的装配与并行架构；netlab FEM 小，保持自研更划算。

### 16.5 仓库地址表（第六轮汇总）

| 类别 | 项目 | 地址 |
|---|---|---|
| 电路 | ngspice | <https://ngspice.sourceforge.io/> / <https://github.com/imr/ngspice> |
| 电路 | Xyce | <https://github.com/Xyce/Xyce> |
| 电路 | ahkab | <https://github.com/ahkab/ahkab> |
| 电路 | circuitjs1 | <https://github.com/pfalstad/circuitjs1> |
| 线代 | SuiteSparse(KLU) | <https://github.com/DrTimothyAldenDavis/SuiteSparse> |
| ODE | SUNDIALS | <https://github.com/LLNL/sundials> |
| 求解器 | PETSc | <https://github.com/petsc/petsc> |
| FEM | FEniCS/dolfinx | <https://github.com/FEniCS/dolfinx> |
| FEM | deal.II | <https://github.com/dealii/dealii> |
| FEM | MFEM | <https://github.com/mfem/mfem> |
| FEM | Elmer | <https://github.com/ElmerCSC/elmerfem> |
| CFD | OpenFOAM | <https://github.com/OpenFOAM/OpenFOAM-dev> |
| CFD | SU2 | <https://github.com/su2code/SU2> |
| MD | LAMMPS | <https://github.com/lammps/lammps> |
| DFT | Quantum ESPRESSO | <https://github.com/QEF/q-e> |

### 16.6 一句话结论

> 对 netlab 最"够得着"的是**电路仿真同源库**：以 **ahkab（Python 参考实现）** 对照代码，用 **KLU** 换/补稀疏 LU，把 **ngspice 的 gmin/source-stepping + 器件限幅** 移植进 Newton，并借 **SUNDIALS 的变阶变步长 BDF** 升级固定 dt——这四项都不需要重写架构，性价比最高。

## 17. 第七轮：大数据仿真（大规模仿真数据的生成 / 传输 / 存储 / 查询 / 可视化）

> 本轮回答用户请求（m00407）：阅读"大数据仿真"相关知识。核心问题不是"数据多"，而是**算得比存得快、存得比读得快、读得比画得快**——三个环节任一卡住都表现为"仿真卡"。下面按数据生命周期分层，并落到 netlab 已有的大数据存储层设计。

### 17.1 全景：数据生命周期与三处瓶颈

```
仿真生成 ──聚合──▶ 压缩 ──▶ 存储(分块) ──▶ 索引 ──▶ 查询 ──▶ 降采样 ──▶ 渲染
   (CPU)                 (I/O)                   (SQL/谓词)   (像素级)
```
- **生成瓶颈**：每步都要 probe/序列化，Python 逐点开销（netlab 已在 §2.3/§5 讨论）。
- **存储瓶颈**：写盘吞吐 vs 采样率；未压缩 float64 体量大。
- **读取/渲染瓶颈**：一次拉太多点，前端画不动（netlab `pollLive` limit=600、frameCap≈25 万点）。

### 17.2 数学 / 工程原理（分层）

**（a）压缩**
- **无损**：zstd / gzip / **Blosc2**（分块 + 多线程 + SIMD，配 **shuffle 字节重排**把同类字节聚一起，压缩率显著提升）。科学二进制首选 Blosc2。
- **有损但有界（error-bounded）**：
  - **SZ**：Lorenzo 预测 + 线性量化 + 熵编码，保证绝对/相对误差 ≤ ε；率-失真可调。
  - **ZFP**：4×4×4 块正交变换 + 定点率控制，固定压缩率、随机访问友好。
  - 数学保证：`‖x − x̂‖∞ ≤ ε`（绝对）或相对误差界；这是"可视化无损"的工程定义。
- **时序专用 Gorilla**：delta-of-delta + XOR 前一值，适合等间隔平滑曲线——**netlab 探针时序极适合**，压缩比常 10×+。
- **量化**：float64→float32→定点 int16，按量程缩放（与"min-max 包络抽稀"同源思想）。

**（b）多分辨率 / 降采样**
- **min-max 包络**：每像素列只保留 min/max，保峰、不丢毛刺（netlab 已用）。
- **LTTB**（最大三角形三桶法）、**M4**（min/max/first/last 四值/桶）——保形降采样。
- **小波多分辨率**（Haar / CDF 5/3）：多尺度细节分层，按需取 LOD。

**（c）存储格式**
- **HDF5 / NetCDF**：分块 + 压缩 + **MPI-IO 并行**；传统科学格式。
- **ADIOS2（BP 格式）**：为 **in-situ / in-transit** 设计，边算边写，异步聚合。
- **Zarr**：分块 chunk，云对象存储友好。
- **Parquet / Arrow**：列式，谓词下推，适合分析查询。
- **numpy .npy / memmap**：简单内存映射大数组。

**（d）传输**
- **Apache Arrow**（列式内存**零拷贝**）+ **Arrow Flight**（RPC）：替代 JSON，体积小、序列化近零成本。
- WebSocket 二进制 / SharedArrayBuffer：浏览器端零拷贝。

**（e）查询 / 索引**
- 单机列式：**DuckDB**（可 `asof join` 对齐多通道、谓词下推）；分布式才上 ClickHouse / InfluxDB / TimescaleDB。
- **chunk min-max 索引**：查询只读命中块（netlab 记忆里的设计）。

**（f）in-situ / in-transit**
- **SENSEI / ADIOS2 / Damaris**：把可视化/分析嵌进仿真进程或异步代理，**避免"写盘→读盘"往返**；多进程仿真尤其关键。

**（g）代理模型 / 降阶（data-driven）**
- ML surrogate 替代昂贵仿真做大规模参数扫描（呼应 §11.5 GNN、§14.2 POD–DEIM）；"大数据仿真"的省算路线，但需训练数据。

### 17.3 对 netlab 的映射（结合已有"大数据存储层设计"）

netlab 现状（2026-10-30 设计，已较合理）：**热窗 200 万点 / 60s、块 1M 点 float32(4MB)、会话配额 2GB、min-max 包络抽稀 ≤2 点/像素列、ArrayBuffer float32 二进制传输、引用计数回收**。

- **已达成的正确点 ✅**：环形热窗 + 分块落盘 + min-max 抽稀 + float32 二进制 + 引用计数回收——这正是"热/冷分层 + 降采样 + 紧凑传输"的正解。
- **可增强（按性价比）**：
  1. **块压缩用 Blosc2(zstd+shuffle) 或 ZFP 有界有损**：对可视化数据常 10–50×，冷块收益最大。
  2. **探针时序用 Gorilla（delta/XOR）**：平滑曲线压缩比高。
  3. **传输从 JSON 换 Arrow IPC / 二进制**：`fast_json` 已是 `json.dumps`，再进一步可降本。
  4. **冷数据 Parquet + DuckDB**：支持导出/回溯/多通道 `asof` 对齐。
  5. **若多进程仿真 → ADIOS2/SENSEI 式 in-situ**：避免写盘瓶颈。

### 17.4 优先级

- **A（高价值、低成本）**：块压缩 Blosc2/ZFP；探针时序 Gorilla；传输渐进换 Arrow 二进制。
- **B（中）**：Parquet + DuckDB 冷查询/导出；多进程时上 in-situ。
- **C（不适用）**：分布式集群方案（ClickHouse/Spark）——单机桌面产品过度设计。

### 17.5 参考链接（第七轮：大数据仿真 / 数据系统）

| 主题 | 来源 | 地址 |
|---|---|---|
| Exascale PIC 内存流式 + in-situ 可视化 | arXiv:2512.03914 | <https://arxiv.org/abs/2512.03914v2> |
| ADIOS2 介绍（in-situ/in-transit I/O） | ADIOS2 Docs | <https://adios2.readthedocs.io/en/v2.12.0/introduction/introduction.html> |
| 万亿粒子并行 I/O 与分析 | LBNL | <https://sdm.lbl.gov/sdav/highlights/28-highlights/data-management/55-scaling-trillion-particles.html> |
| 自适应多分辨率编码（大规模体可视化） | arXiv:2409.00184 | <https://arxiv.org/html/2409.00184v1> |
| SENSEI in-situ（NekRS CFD） | arXiv:2312.09888 | <https://www.arxiv.org/abs/2312.09888v2> |
| Damaris 异步数据聚合中间件 | HDF Group | <https://www.hdfgroup.org/d> |
| ZFP 浮点压缩 | zfp.io | <https://zfp.io/> |
| Gorilla 时序数据库（delta/XOR） | VLDB | <https://www.vldb.org/pvldb/vol8/p1816-teller.pdf> |
| Apache Arrow（零拷贝列式） | Arrow | <https://arrow.apache.org/> |
| Blosc2 高性能二进制压缩 | Blosc | <https://blosc.org/pages/blosc-in-depth/> |
| SZ vs ZFP 率-失真自动选择 | OSTI | <https://www.osti.gov/pages/servlets/purl/1559037> |
| Arrow Flight 零拷贝数据管道 | DrCodes | <https://drcodes.com/posts/build-zero-copy-data-pipelines-with-apache-arrow-flight> |
| datashader 大数据可视化 | HoloViews | <http://holoviews.holoviz.org/user_guide/Large_Data.html> |
| DuckDB asof join（时序对齐） | DuckDB | <https://duckdb.org/docs/current/guides/sql_features/asof_join.html> |
| MinMax 降采样算法 | HU Berlin | <https://www.informatik.hu-berlin.de/de/forschung/gebiete/wbi/teaching/studienDiplomArbeiten/finished/2025/expose_wuestner.pdf> |
| ML surrogate 替代高保真仿真 | Lacuna | <https://lacuna.tiptreesystems.com/node/cluster/txn_91e69feb5e264abeaa6ea0f456dd53be> |

### 17.6 一句话结论

> netlab 的大数据存储层设计（热窗 + 分块 + min-max 抽稀 + float32 二进制）方向正确；**增量收益最大的三件事**是"**块压缩 Blosc2/ZFP + 探针时序 Gorilla + 传输换 Arrow 二进制**"；分布式/列式数据库对单机桌面产品是过度设计，冷数据用 Parquet+DuckDB 即可。

## 18. 第八轮：图论 / 超图 / 因子图 —— 重思 NetLab 的数学结构

> 本轮回答用户请求（m00454）：阅读图论、超图、因子图相关论文，并**重新思考 NetLab 的数学结构**。指定的三篇文献均为高可信一手来源（题录经 Crossref 核对），其余为补充阅读。核心结论：**NetLab 的信号 / 电路 / 场三种引擎，本质是同一类"局部函数在变量上的图模型"的三个实例**——可统一用图论 + 因子图 + 超图的语言描述，并据此获得更早的结构诊断、更快的增量求解与可并行的分区。

### 18.1 指定文献（精确题录，经 Crossref 核实）

| # | 题录 | DOI | 与本项目关系 |
|---|------|-----|--------------|
| 1 | Dellaert F. *Factor Graphs: Exploiting Structure in Robotics.* Annu. Rev. Control Robot. Auton. Syst. **4**:141–166 (2021) | `10.1146/annurev-control-061520-010504` | 因子图=「局部函数在变量子集上的二部图」，把"建模 / 计算性能 / 设计思维"三价值讲透 |
| 2 | Benveniste A., Caillaud B., Malandain M. *The mathematical foundations of physical systems modeling languages.* Annual Reviews in Control **50**:72–118 (2020) | `10.1016/j.arcontrol.2020.08.001` | equation-based（非因果）建模语言的形式语义：结构分析、索引约简、多模式 DAE、因果环 |
| 3 | Saft P., Pfeil M., Stetter R., Till M., Rudolph S. *Integration of geometry modelling and behavior simulation based on graph-based design languages and functional mockup units.* Procedia CIRP **128**:310–315 (2024) | `10.1016/j.procir.2024.06.025` | 图基设计语言（规则图重写）+ FMU/FMI 端口组合协同仿真 + 数字孪生 |

### 18.2 三篇的方法论要点

**（1）因子图（Dellaert 2021）**
- 二部图：**因子节点**= 一个只依赖变量子集的局部函数；**变量节点**= 未知量。目标函数 = 各因子之积（或和）。
- 三大价值：① 建模清晰（暴露问题的**局部性/稀疏结构**）；② 计算加速（**变量消元 = 稀疏矩阵分解**；好的**消元次序 min-fill/AMD** 极大降 fill-in；**增量更新**只重解受影响子图，iSAM 思路）；③ 设计思维（把算法写成图上的推理，便于组合与复用）。
- Sum-product / 高斯消息传递（GBP）在**线性**问题下等价于求解稀疏线性系统——即"图上的消元"。

**（2）物理系统建模语言的数学基础（Benveniste 2020）**
- 对比**非因果（equation-based，如 Modelica）**与**因果（dataflow/同步语言，如 Lustre/Esterel）**两类建模范式；用非标准分析统一连续时间语义。
- 关键工具：**结构分析（Pryce 方法）**判定 DAE 索引；**索引约简 / 哑导数（dummy derivatives）**；**多模式（multi-mode）DAE**；**因果环（causality loop）检测**。
- 稀疏矩阵侧用 **Pothen–Szyld 块三角化（BTF）**：把大系统按强连通块排成"块下三角"序列，顺序求解——与电路 MNA / 数据流 SCC 分解同源。

**（3）图基设计语言 + FMU（Saft 2024）**
- 用**图**表达工程结构（节点=构件，边=关系/连接），**规则图重写**生成设计变体。
- 行为仿真用 **FMU（FMI 标准）** 端口组合，由**主算法（master algorithm）编排协同仿真**，服务数字孪生。
- 启示：**模块 = 带端口的子图；连接 = 端口匹配；展开 = 图重写**——这正是"组合性"的形式化。

### 18.3 NetLab 现状的数学结构（对码核实）

三引擎共享同一个 `Scene` 记录模型，`_Engine`（`scene.py:156`）抽象 `step / reset / zero_time / probes / stats`：

- **SignalEngine**（`scene.py:174`）→ `graph.Network`（数据流图）：
  - 节点 = `compute handler` + `state` + `params` + `data`；边 = `Connection`（含 `delay` 单位延迟、线性增益/偏置，`graph.py:820`）。
  - `algebraic_cycles()`（`graph.py:482`）用 **Tarjan SCC** 找代数环；
  - `solver_plan()`（`graph.py:533`）把 SCC **收缩成 DAG**，标记 `algebraic` 阶段，`SolverStage.algebraic`；
  - 代数阶段用 `_solve_nonlinear_stage`（Newton，`graph.py:897`）或 `_solve_linear_stage`（`graph.py:991`）；
  - `delay` 边 = 单位延迟 `z⁻¹`，用于**切断代数环** → 本质是**同步数据流图（SDF）/ 离散时间因子图**。
- **CircuitEngine**（`scene.py:511`）→ `CircuitSolver`（MNA）：
  - 并查集把**导线/模块端口合并成同一电气节点**（`scene.py:527-553`）、器件 stamp 进 MNA 矩阵、`splu` 分解；
  - 本质 = **带超边（多端器件）的标签图上的 DAE**；MNA 矩阵 = 广义**关联矩阵/Laplacian** + 器件本构。
- **VectorEngine** → `fem.py`：网格图上的 PDE 离散（热传导**刚度矩阵 ≈ 加权图 Laplacian**）。
- **跨域桥** `sensor/actuator`（`scene.py:680-694`）：用**显式一拍延迟**做端口耦合——是 **bond graph / port-Hamiltonian 能量端口**的雏形，但目前以延迟近似。

### 18.4 用图论 / 超图 / 因子图重审 NetLab 的数学结构（具体结论）

1. **NetLab 是三类图模型的统一体**：信号 = 有向数据流图（DAG + SCC + 延迟边）；电路 = **超图**（多端器件为超边）+ 关联矩阵；场 = 网格图（PDE）。三者都能改写成**因子图**：变量 = 节点电压 / 边流 / 信号值，因子 = 元件本构 / 计算 handler。
2. **求解 = 图上的消元**：MNA/LU 的消元次序决定 fill-in；当前 `_lu_cache`/`splu` 只做数值分解缓存，**未显式优化消元次序、未做 symbolic 分解复用**。借 Dellaert 的 **min-fill/AMD 排序 + 增量重分解**：拓扑只改局部时只重解受影响子块。
3. **超图分区 = 并行与域分解**：netlist 天然是超图（多端器件=超边）。用 **hMETIS/KaHIP 做超边割最小**分区，可把大电路 / 大 FEM 拆子域并行（落地 §5 多进程、§14 域分解）。当前 `flatten_circuit`+并查集只到**连通分量**级，未做**负载均衡分区**。
4. **结构分析（Pryce + BTF）前置诊断**：在装配阶段判定 DAE 索引、检测因果环/欠定/奇异，比现在"运行时 Newton 不收敛 / 奇异主元"更早更准。可把现有 `ComputeError("非线性电路…未收敛")` 的事后报错，升级为**装配期结构体检**。
5. **图重写 + 端口代数 = 模块组合形式化**：借 Saft 的图基设计语言，把"模块=带端口子图、连接=端口匹配、展开=图重写(flatten)"写成显式规则，替代 `flatten_circuit` 里的手写特例（R24/D51）。
6. **能量端口（bond graph / port-Hamiltonian）统一三域**：用 effort/flow 端口 + 能量守恒做跨域耦合，天然无源稳定（呼应 §11 的 MPC 无源/耗散约束）；可替换当前"一拍延迟"耦合。
7. **稀疏图算法工具箱**（多数已具备或有库）：连通分量（并查集，已有）、SCC（Tarjan，已有）、**BTF/块三角化**（Pothen）、**AMD/COLAMD 排序**（`scipy.sparse.linalg.splu(permc_spec=...)` 内置）、**超图分区**（hMETIS/KaHIP）、最小生成树（网络化简）、**图 Laplacian 特征值**（稳定性/模式分析、谱聚类）。

### 18.5 优先级 / 可落地

- **A（高价值、低成本）**：① 装配期**结构分析（Pryce/BTF）**做奇异/因果环预诊断；② `splu` 换 **AMD/COLAMD 排序**并缓存 **symbolic factorization** 做增量重分解；③ 把"多端器件=超边"在数据模型里**显式建模**，为分区铺路。
- **B（中）**：超图分区（hMETIS）驱动多进程域分解；端口代数/图重写形式化模块展开；因子图消元框架**统一三引擎 solver 接口**。
- **C（研究/长期）**：bond graph / port-Hamiltonian 能量端口统一三域；图 Laplacian 谱分析做稳定性与降阶。

### 18.6 参考文献（第八轮：图论 / 超图 / 因子图）

| 主题 | 来源 / 地址 |
|---|---|
| 因子图综述（指定） | Dellaert 2021, DOI `10.1146/annurev-control-061520-010504`，PDF <https://dellaert.github.io/files/Dellaert21ar_FG.pdf> |
| 物理系统建模语言数学基础（指定） | Benveniste 2020, DOI `10.1016/j.arcontrol.2020.08.001`，PDF <https://inria.hal.science/hal-03045498/file/JARAP_726%20%281%29.pdf> |
| 图基设计语言 + FMU（指定） | Saft 2024, DOI `10.1016/j.procir.2024.06.025`，<https://doi.org/10.1016/j.procir.2024.06.025> |
| Kalman 滤波 / 因子图 / 电路网络（三者等价） | Vontobel <http://shiftleft.com/mirrors/www.hpl.hp.com/personal/Pascal_Vontobel/publications/papers/pvto-2002-1.pdf> |
| 线性模拟电路的高斯消息传递（因子图统计） | USU <https://digitalcommons.usu.edu/etd/504> |
| 超图划分并行电路仿真（专利） | CN116258114A <https://patents.google.com/patent/CN116258114A/zh> |
| 超图形式化建模范式（运动/动力学） | MDPI <https://www.mdpi.com/2673-3161/6/4/74/htm> |
| Pothen–Szyld 块三角化（BTF） | ACM TOMS, DOI `10.1145/98267.98287` |
| hMETIS 超图划分 | <http://glaros.dtc.umn.edu/gkhome/metis/hmetis/overview> |
| KaHIP 图划分 | <https://kahip.github.io/> |
| port-Hamiltonian 系统 | <https://en.wikipedia.org/wiki/Port-Hamiltonian_system> |
| Modelica / FMI 标准 | <https://modelica.org/> · <https://fmi-standard.org/> |
| GTSAM（因子图/增量平滑参考实现） | <https://gtsam.org/> |
| scipy splu（permc_spec 排序选项） | <https://docs.scipy.org/doc/scipy/reference/generated/scipy.sparse.linalg.splu.html> |

### 18.7 一句话结论

> NetLab 的三种引擎不是三套孤立系统，而是**同一张"局部函数图"的三种投影**：信号模式是**带延迟边的同步数据流图**、电路模式是**多端器件超图上的 DAE**、场模式是**网格图上的 PDE**。用**因子图的消元观**重写求解器可拿到"消元排序 + 增量重分解"的性能红利；用**超图分区**可落地多进程/域分解；用**Pryce/BTF 结构分析**可把奇异/因果环从事后报错变成装配期体检；用**端口代数 / 能量端口**可把三域组合形式化并保持无源稳定。

## 19. 第九轮：图论 / 超图 / 因子图 领域的深入论文精读（续 §18）

> 用户（m00520）要求"先全部整理到文档中，关于上面所提到的领域继续阅读相关论文"。本轮把 §18 的六个子方向各追一篇/一组代表作深读，并把"论文方法 → NetLab 代码落点"逐条对齐。**统一主线：把 NetLab 的求解、诊断、并行、建模四件事，全部换成"图上的结构算法"。**

### 19.1 因子图与增量求解（对应 §18.4 结论 2：求解=图上消元）

- **iSAM2（Kaess et al., 2012, IJRR）** *iSAM2: Incremental Smoothing and Mapping Using the Bayes Tree* — 把因子图消元结果存成 **Bayes tree**；只对受影响子树做**流体重线性化（fluid relinearization）** 与**增量变量重排序**，避免每步全图重解。<https://www.cs.cmu.edu/~kaess/pub/Kaess12ijrr.pdf>
- **iSAM2 前身（Kaess et al., 2011, ICRA）** *…with Fluid Relinearization and Incremental Variable Reordering*。<https://people.csail.mit.edu/kaess/pub/Kaess11icra.pdf>
- **对 NetLab 的落点**：`nodal.py` 的 `_lu_cache` 现在"矩阵一变就整块重分解"。可仿 Bayes tree 维护**消元树/依赖子树**：参数改动只触碰少数元件 → 只重算受影响的消元子块，其余复用 symbolic + numeric 因子。这正是电路"只改一个电阻"场景的最大红利。

### 19.2 结构分析 / 索引约简（对应 §18.4 结论 4：装配期结构诊断）

- **Pantelides（1988）** *The Consistent Initialization of Differential-Algebraic Systems* — 用二分图**最大匹配**做索引约简的经典算法。
- **Pryce（2001）** *A simple structural analysis method for DAEs* — 给每个方程赋微分阶 `σ`，直接由结构判索引。
- **Mattsson & Söderlind** *Index Reduction in Differential-Algebraic Equations Using Dummy Derivatives*（Lund）— 用哑导数把高索引 DAE 降到索引 1。<https://lucris.lub.lu.se/ws/files/9390471/7477.pdf>
- **Qin et al.** *Structural analysis of high-index DAE for process simulation* — arXiv:1206.6177 <https://arxiv.org/html/1206.6177v1>
- **Graph theory, irreducibility, and structural analysis of DAE systems** — arXiv:1411.4129 <https://arxiv.org/html/1411.4129v1>
- **Dulmage–Mendelsohn 分解 / 最大匹配**（HSL_MC79 实现）— 把稀疏矩阵拆成"欠定/恰定/过定"三块。<http://hsl.rl.ac.uk/catalogue/hsl_mc79.html>
- **对 NetLab 的落点**：装配期对 `CircuitEngine` 的"方程 × 变量"二分图求最大匹配 + DM 分解 → 立刻知道是否存在**欠定（缺方程/浮空节点）/过定（冗余约束）/奇异（索引>0）**，比现在"`splu` 报零主元 / Newton 不收敛"更早、更能定位到具体节点。

### 19.3 稀疏消元排序（fill-in 最小化，对应 §18.4 结论 2/4）

- **AMD（Amestoy, Davis, Duff, 1996, SIAM J. Matrix Anal. Appl.）** *An Approximate Minimum Degree Ordering Algorithm* — 近似最小度排序，电路/FEM 稀疏 LU 的默认利器；blog 直觉：消元=删顶点并补团，次序不同 fill 从 6 变 0。<https://blog.csdn.net/weixin_32466193/article/details/165776935>
- **COLAMD（Davis, Gilbert, Larimore, Ng, 2004, ACM TOMS）** *A column approximate minimum degree ordering algorithm* — 非对称 LU 的列排序。
- **Nested dissection（George, 1973）** — 网格类问题递归分块，FEM 更优。
- **对 NetLab 的落点**：`scipy.sparse.linalg.splu(permc_spec=...)` 默认 `COLAMD`；对**结构性强的电路/FEM**可显式选 `MMD_AT_PLUS_A` 或按嵌套剖分排序；并把 **symbolic factorization** 缓存下来（矩阵稀疏结构不变、仅数值变时，只重做 numeric）。详见 <https://docs.scipy.org/doc/scipy/reference/generated/scipy.sparse.linalg.splu.html>

### 19.4 超图划分与并行（对应 §18.4 结论 3：超图分区=并行/域分解）

- **hMETIS（Karypis & Kumar, Univ. Minnesota）** *hMETIS: A Hypergraph Partitioning Package* — 多级（coarsen/initial partition/refine）超图划分，目标=**超边割最小 + 均衡**。<https://course.ece.cmu.edu/~ee760/760docs/hMetisManual.pdf>
- **KaHIP 团队** *Engineering Initial Partitioning Algorithms for direct k-way Hypergraph Partitioning* — 直接 k 路超图分区。<https://ae.iti.kit.edu/english/3130.php>
- **综述**：《面向分布式图计算的图划分技术综述》，计算机研究与发展，DOI `10.7544/issn1000-1239.202330790` <https://crad.ict.ac.cn/article/doi/10.7544/issn1000-1239.202330790>；《VLSI 电路划分算法综述》（Zhu & Chen，zbMATH 1265.68365）<https://zbmath.org/1265.68365>
- **对 NetLab 的落点**：netlist 天然是超图（三端器件/模块=超边）。用 hMETIS/KaHIP 做**超边割最小分区** → 子域，再交给 §5 的多进程 / §14 的域分解。当前 `flatten_circuit`+并查集只到连通分量，未做均衡分区。

### 19.5 图信号处理（GSP，对应 §18.4 结论 7：图 Laplacian 谱）

- **Ortega, Frossard, Kovačević, Moura, Vandergheynst（2018, Proc. IEEE）** *Graph Signal Processing: Overview, Challenges and Applications* — 图 Fourier 变换 / 图 Laplacian 谱 / 图滤波 / 采样与重建。<https://infoscience.epfl.ch/entities/publication/c9842180-4bbc-43c6-8d55-1217d078f7cd>
- **对 NetLab 的落点**：把探针时序看作"网格图（FEM 节点/电路节点）上的信号"，可用**图滤波做时空平滑/降采样/异常检测**，用**图 Laplacian 特征值**做稳定性与模式分析——比逐列 min-max 抽稀更有物理意义（呼应 §17 降采样）。

### 19.6 图机器学习 / 代理模型（与 §11 GNN 代理呼应）

- **ROM + 数字孪生综述（Kramer & Qian, 2026, Struct. Multidisc. Optim.）** *Reduced-order modeling for engineering systems: survey and opportunities for digital twins* <https://kramer.ucsd.edu/img/pubs/J55-ROM-survey-Kramer-Qian-2026.pdf>
- **软硬件协同图机器学习（Nat. Mach. Intell. 速递）** <https://m.thepaper.cn/rss_newsDetail_22030417>
- **对 NetLab 的落点**：用 **GNN 对拓扑图做性能/收敛粗筛**（预测哪些拓扑会 Newton 不收敛/奇异），先粗筛再真算——把 §11 的 GNN 代理从"想法"接到 §19.2 的结构诊断上。

### 19.7 第九轮落地映射（论文 → NetLab 代码 → 优先级）

| 子方向 | 代表文献 | NetLab 落点 | 优先级 |
|---|---|---|---|
| 增量因子图求解 | iSAM2 (Kaess 2012) | `nodal.py` `_lu_cache` → 消元树+增量重分解 | A |
| 结构分析/索引约简 | Pantelides 1988 / Pryce 2001 / Dummy derivatives | `CircuitEngine` 装配期最大匹配+DM 分解，替代运行时奇异报错 | A |
| 稀疏消元排序 | AMD(1996)/COLAMD(2004)/nested dissection | `splu(permc_spec=…)` + symbolic 复用 | A |
| 超图划分并行 | hMETIS / KaHIP | `flatten_circuit` → 超图分区 → 多进程/域分解 | B |
| 图信号处理 | Ortega 2018 (GSP) | 探针信号图滤波/谱分析，"物理感知"降采样 | B |
| 图机器学习代理 | ROM 综述 2026 / GNN | GNN 粗筛拓扑收敛性，接 §11 | C |

### 19.8 第九轮新增参考文献（含地址）

1. Kaess et al., *iSAM2: Incremental Smoothing and Mapping Using the Bayes Tree*, IJRR 2012 — <https://www.cs.cmu.edu/~kaess/pub/Kaess12ijrr.pdf>
2. Kaess et al., *iSAM2 … Fluid Relinearization and Incremental Variable Reordering*, ICRA 2011 — <https://people.csail.mit.edu/kaess/pub/Kaess11icra.pdf>
3. Mattsson & Söderlind, *Index Reduction in DAE Using Dummy Derivatives* — <https://lucris.lub.lu.se/ws/files/9390471/7477.pdf>
4. Qin et al., *Structural analysis of high-index DAE for process simulation*, arXiv:1206.6177 — <https://arxiv.org/html/1206.6177v1>
5. *Graph theory, irreducibility, and structural analysis of DAE systems*, arXiv:1411.4129 — <https://arxiv.org/html/1411.4129v1>
6. HSL_MC79（最大匹配 + Dulmage–Mendelsohn 分解）— <http://hsl.rl.ac.uk/catalogue/hsl_mc79.html>
7. AMD 排序直觉（删顶点补团）— <https://blog.csdn.net/weixin_32466193/article/details/165776935>
8. hMETIS（Karypis & Kumar）— <https://course.ece.cmu.edu/~ee760/760docs/hMetisManual.pdf>
9. KaHIP 团队，*Engineering Initial Partitioning Algorithms for direct k-way Hypergraph Partitioning* — <https://ae.iti.kit.edu/english/3130.php>
10. 《面向分布式图计算的图划分技术综述》— <https://crad.ict.ac.cn/article/doi/10.7544/issn1000-1239.202330790>
11. 《VLSI 电路划分算法综述》（Zhu & Chen）— <https://zbmath.org/1265.68365>
12. Ortega et al., *Graph Signal Processing: Overview, Challenges and Applications*, Proc. IEEE 2018 — <https://infoscience.epfl.ch/entities/publication/c9842180-4bbc-43c6-8d55-1217d078f7cd>
13. Kramer & Qian, *Reduced-order modeling for engineering systems: survey and opportunities for digital twins*, 2026 — <https://kramer.ucsd.edu/img/pubs/J55-ROM-survey-Kramer-Qian-2026.pdf>
14. 软硬件协同图机器学习（Nat. Mach. Intell. 速递）— <https://m.thepaper.cn/rss_newsDetail_22030417>
15. scipy `splu`（permc_spec 排序选项）— <https://docs.scipy.org/doc/scipy/reference/generated/scipy.sparse.linalg.splu.html>

### 19.9 一句话结论

> 深入读下来，§18 的判断被进一步坐实：**NetLab 的性能与健壮性上限，取决于它把电路/信号/场"当作图来算"的程度**——用 iSAM2 的增量消元观改 `_lu_cache`、用 Pantelides/Pryce/DM 把奇异诊断前置到装配期、用 AMD/COLAMD 降 fill-in、用 hMETIS/KaHIP 分区上多进程、用 GSP 做物理感知降采样、用 GNN 做收敛粗筛。这六件事都不需要重写物理内核，而是在**求解器/装配器/调度层**加"图算法"。

## 20. 第十轮：编译原理 / 数据流计算 / 响应式编程 —— 把 NetLab 当"编译器 + 数据流机"

> 用户（m00545）请求从编译原理、数据流计算、响应式编程找灵感，并给了 5 个 DOI/链接（均经 Crossref/官方核实，见 20.1）。核心洞察：**NetLab 的 `SignalEngine` 本质就是一台"数据流机"，而整个"场景 → 引擎"的过程本质是一次"编译"。** 因此编译原理的**遍（pass）/ IR / JIT**、数据流计算的**Kahn/SDF/Ptolemy actor 调度**、响应式编程的**增量/自调整计算**，都能直接套到 NetLab 的求解与刷新链路上。

### 20.1 五篇指定文献（核实题录）

| # | 题录 | DOI / 地址 | 分量 |
|---|------|-----------|------|
| 1 | Dennis J.B., Misunas D.P. *A preliminary architecture for a basic data-flow processor.* ISCA '75, pp.126–132 | `10.1145/642089.642111` | **数据流计算**的开山之作（数据流机架构） |
| 2 | Najjar W.A., Lee E.A., Gao G.R. *Advances in the dataflow computational model.* Parallel Computing 25(13–14):1907–1929 (1999) | `10.1016/S0167-8191(99)00070-8`；<https://ptolemy.berkeley.edu/publications/papers/99/dataflow/> | **Ptolemy 数据流模型**综述（Kahn/SDF/DDF/PN） |
| 3 | Lattner C., Adve V. *LLVM: A Compilation Framework for Lifelong Program Analysis & Transformation.* CGO 2004 | <https://llvm.org/pubs/2004-01-30-CGO-LLVM.html> | **编译原理**：IR + pass 管理的现代范式 |
| 4 | Hammer M., Phang K., Hicks M., Foster J. *Adapton: Composable, Demand-Driven Incremental Computation.* PLDI 2014 | `10.1145/2594291.2594324`；<http://matthewhammer.org/adapton> | **响应式/增量计算**：按需、脏标记、可组合 |
| 5 | Hammer M. et al. *Incremental Computation with Names.* OOPSLA 2015 | `10.1145/2814270.2814305` | **响应式/增量计算**：用"名字"解决稳定标识问题 |

### 20.2 编译原理：从"解释执行图"到"编译器 + 优化遍"

- **LLVM 的启示**：把"计算"抽象成 **IR + 一系列可组合的 pass**（分析 pass / 变换 pass），由一个 pass manager 串起来；前后端解耦、可复用、可插拔。NetLab 现在的 `scene.py / graph.py / nodal.py / fem.py` 更像是"**手写的解释器**"：每次 step 现算。
- **可借的编译技术**（都对 NetLab 有直接落点）：
  - **SSA / def-use 链**（Cytron 1991）：把数据流图的连线显式化成"每个信号只定义一次"的 def-use 图，便于做后续分析。
  - **常量传播 / 常量折叠**：`params` 在拓扑不变时应**编译期折叠**（如固定电阻、固定增益），不必每帧重算。
  - **死代码消除（DCE）**：不影响任何 probe 的节点/子图，运行时直接跳过（当前每帧全图都算）。
  - **公共子表达式消除（CSE）**：拓扑里重复的等价子图合并。
  - **部分求值 / 特化（partial evaluation）**：拓扑固定时，把"引擎"特化成一张**静态执行计划**（见 20.3 的 SDF 调度），只留真正的数值内核。
  - **JIT / 后端代码生成**：热点的 compute handler、Newton 内层循环可用 Numba/LLVM 生成机器码（NetLab 现已 numpy 向量化，JIT 是进一步手段）。
- **落点**：`solver_plan()`（`graph.py:533`，SCC→DAG→stages）其实就是一次"**编译**"。应把它**缓存**起来、按 `revision` 失效——拓扑不变就复用编译结果，只在拓扑变更时重新"编译"，这是零风险的"缓存编译产物"红利。进一步可定义一个 **NetLab IR + pass pipeline**（canonicalize / fold / DCE / schedule），把现在散落在各 engine 里的逻辑收拢成"遍"。

### 20.3 数据流计算：Kahn / SDF / Ptolemy actor 与 SignalEngine

- **数据流机（Dennis 1975）→ 数据流过程网络（Lee & Parks 1995）→ Ptolemy（Najjar/Lee/Gao 1999）** 的血脉：计算=**actor（节点）在数据到达时点火（fire）**，调度决定"何时算哪个 actor"。
- 三种经典模型对 NetLab 的意义：
  - **Kahn 过程网络（KPN, 1974）**：确定性、阻塞队列、天然并行；语义清晰但缓冲无界。
  - **同步数据流（SDF, Lee & Messerschmitt 1987）**：每个 actor 的**点火速率固定** → 可**静态调度、算有界缓冲、消除动态调度开销**。**这正是 NetLab `SignalEngine` 应采用的模型**：它的 `Connection.delay = z⁻¹` 就是 SDF 的**初始 token（延迟寄存器）**，`algebraic_cycles`(SCC) 就是需要迭代/切环的反馈环。
  - **Ptolemy actor/director 分离**：**计算（actor）与调度（director）解耦**，同一张图可换不同"导演"（SDF/DDF/DE/CT）。→ NetLab 可把"每帧整图推进"的调度，抽象成可替换的 **Director**：实时播放用墙钟节拍、预计算用尽力而为、离线批处理用静态 SDF 调度。
- **落点**：把 `SignalEngine` 从"每帧全图跑一遍"升级为 **静态 SDF 调度 + 变更驱动**：拓扑编译期定好 actor 点火序与缓冲；运行期只有**输入发生变化的 actor**才点火（与 20.4 的增量计算合流）。这直接降 CPU 与延迟。

### 20.4 响应式编程：FRP / 自调整计算 / Adapton / 增量计算 with names

- **FRP（Elliott & Hudak 1997）**：把随时间变化的量建模成 **signal/behavior + event**，用函数组合表达"随依赖自动更新"。
- **自调整计算（Acar 2005）/ Adapton（PLDI 2014）**：**按需（demand-driven）+ 脏标记 + 记忆化（memoization）**——只在被观察时才算，输入没变就复用上次结果；可组合。
- **Incremental Computation with Names（OOPSLA 2015）**：解决"**稳定标识**"难题——同一个逻辑量在改名/重排后仍能被增量系统识别为"同一个"，从而安全复用缓存。**NetLab 的节点 `id` 恰好是稳定身份**，天然适配"按键/按 id 的记忆表"。
- **差分数据流（Differential Dataflow, McSherry 2013）**：把"结果对输入的导数"增量维护——适合大规模"改一点、看全局"的场景。
- **对 NetLab 的直接价值**：现在后端 `Simulation._loop` 每帧整图 `_advance_locked`、前端 `pollLive` 每 110ms 拉增量重绘。可引入**脏传播**：`mutate()`（`networks.py:262`）改参数时，沿 def-use/依赖边标记下游 dirty；只有 dirty 且被**观察**（probe/画面可见）的节点才重算。离线预计算也可用"增量重算受影响子图"（与 §19 的 iSAM2 增量消元同构）。

### 20.5 落地映射（技术 → NetLab 代码 → 优先级）

| 技术 | 论文 | NetLab 落点 | 优先级 |
|---|---|---|---|
| 编译产物缓存 | LLVM (CGO'04) | `solver_plan()`(graph.py:533) 按 revision 缓存，拓扑不变复用 | **A（零风险）** |
| 常量折叠 + DCE | 编译原理（Cytron/Ferrante） | 固定 params 折进计划；不影响 probe 的节点跳过 | **A** |
| 静态 SDF 调度 | Lee & Messerschmitt 1987 / Ptolemy 1999 | `SignalEngine` 编译期定 actor 点火序+有界缓冲 | **A/B** |
| Director 抽象 | Ptolemy actor/director | 实时播放/预计算/离线批处理共用一张图、换调度器 | B |
| 按需增量 + 记忆化 | Adapton (PLDI'14) | `mutate` 触发脏传播，只重算 dirty 且被观察节点 | **A/B** |
| 稳定标识缓存 | Incremental with Names (OOPSLA'15) | 以节点 `id` 为键的记忆表，跨改名复用 | B |
| JIT 热点内核 | LLVM / Numba | Newton 内层、compute handler 生成机器码 | C |

### 20.6 新增参考文献（含地址）

1. Dennis & Misunas, *A preliminary architecture for a basic data-flow processor*, ISCA '75 — <https://dl.acm.org/doi/10.1145/642089.642111>
2. Najjar, Lee, Gao, *Advances in the dataflow computational model*, Parallel Computing 1999 — <https://ptolemy.berkeley.edu/publications/papers/99/dataflow/>
3. Lee & Parks, *Dataflow Process Networks*, Proc. IEEE 83(5), 1995（Ptolemy 核心）
4. Lee & Messerschmitt, *Synchronous Data Flow*, Proc. IEEE 75(9), 1987
5. Kahn, *The semantics of a simple language for parallel programming*, 1974
6. Lattner & Adve, *LLVM: A Compilation Framework for Lifelong Program Analysis & Transformation*, CGO 2004 — <https://llvm.org/pubs/2004-01-30-CGO-LLVM.html>
7. Cytron et al., *Efficiently Computing Static Single Assignment Form*, TOPLAS 1991
8. Ferrante, Ottenstein, Warren, *The Program Dependence Graph and Its Use in Optimization*, TOPLAS 1987
9. Hammer et al., *Adapton: Composable, Demand-Driven Incremental Computation*, PLDI 2014 — <http://matthewhammer.org/adapton>
10. Hammer et al., *Incremental Computation with Names*, OOPSLA 2015 — <https://2015.splashcon.org/details/oopsla2015/1/Incremental-Computation-with-Names>
11. Acar, *Self-Adjusting Computation*, 2005（CMU 博士论文）
12. Elliott & Hudak, *Functional Reactive Animation*, ICFP 1997
13. McSherry et al., *Differential Dataflow*, CIDR 2013

### 20.7 一句话结论

> 把 NetLab 看成"**一门小型数据流语言的编译器**"，一切就顺了：`scene → graph` 是**前端**，`solver_plan` 是**中端编译（SCC/DAG/调度）**、`step` 是**后端执行**。于是三件事立刻可落地——**① 把编译出的执行计划按 revision 缓存（零风险）**、**② 用 SDF 静态调度 + 脏传播/按需增量（Adapton 思路）只算变化且被观察的节点**、**③ 用 pass pipeline 做常量折叠/DCE/CSE 削减每帧工作量**。这三件都不动物理内核，只在"编译/调度/刷新"层做。

## 21. 第十一轮：编译原理 / 数据流计算 / 响应式编程 的深入续读

> 承接 §20，继续把这三大方向的**经典与当代代表作**读进来，重点补三块 NetLab 最缺的：**有环图的增量重算理论（属性文法/INC）**、**增量视图维护的形式化（DBSP/差分数据流）**、**图级编译优化（Halide/TVM/MLIR/sea-of-nodes）**。文献题录均经检索核实。

### 21.1 数据流架构与调度（经典脉络）

- **Arvind & Culler**, *Dataflow Architectures*, Annual Review of Computer Science 1:225–253 (1986) — **标记 token（tagged-token）动态数据流**，与 Dennis 的静态数据流对立；理解"静态调度 vs 动态调度"的根本取舍。
- **Petri nets（Petri 1962）** — 并发/同步的图形化形式模型；SDF/PN 都可视为其受限变体。
- **Kahn（1974）** 过程网络 → **Parks（1995）** *Bounded Scheduling of Process Networks*（Ptolemy 博士论文）— 给出把无界 KPN **静态调度成有界缓冲**的判定算法。<https://ptolemy.eecs.berkeley.edu/papers/parksThesis/>
- **Lee & Messerschmitt（1987）** SDF → ** cyclo-static dataflow（Bilsen et al. 1996）** → **latency-insensitive design（Carloni et al. 2001）**：把时序/同步从功能里抽离，用"就绪/有效"握手让调度对延迟不敏感。**对 NetLab 的意义：仿真步进可用"数据就绪即点火"的 latency-insensitive 语义，而非固定墙钟。**
- **Click & Paleczny（1995）** *A Simple Graph-Based Intermediate Program Representation*（sea-of-nodes）— 编译器 IR 直接用图表示，与 NetLab 的"图即程序"高度同构。

### 21.2 增量视图维护与差分数据流（增量计算的形式化）

- **Naiad / timely dataflow（Murray et al., SOSP 2013）** — 用**进度追踪（progress tracking）+ 时间戳（timestamps）** 判定"计算何时静止"，支持增量/迭代数据流。<https://sigops.org/s/conferences/sosp/2013/papers/p439-murray.pdf>
- **Differential Dataflow（McSherry et al., CIDR 2013）** — 用"集合的差分"增量维护结果。
- **DBSP（Budiu et al., VLDB 2023）** *DBSP: Automatic Incremental View Maintenance for Rich Query Languages* — 把任意查询编译成**算子电路（circuit）**，再加一个**微分算子 D** 自动增量维护；理论上"任何电路都可自动增量"。**这是 NetLab"改一个参数只重算一部分"的严格形式化依据。** <https://www.vldb.org/pvldb/vol16/p1601-budiu.pdf>
- **Build Systems à la Carte（Mokhov, Mitchell, Peyton Jones, ICFP 2018）** — 用"**rebuilder × scheduler**"二维矩阵统一各种构建系统；关键概念 **constructive traces（构建轨迹）+ early cutoff（结果没变就不再向上传播）**。**直接对应 NetLab 每帧"哪些节点该重算、结果没变要不要继续传播"的策略选择。** <https://www.microsoft.com/en-us/research/uploads/prod/2018/03/build-systems-a-la-carte.pdf>
- **A Theory of Changes（Cai, Giarrusso, Rendel, Ostermann, ICFP 2014）** — 用**静态微分**把 λ 演算增量化的理论，arXiv:1312.0658。

### 21.3 有环图的增量重算（对 NetLab 的 SCC 反馈环最贴切）

> 这是 NetLab **最有价值但最缺**的一块：`SignalEngine` 有 `algebraic_cycles`(SCC) 反馈环，改一个输入后如何"只重算受影响环、并正确处理环内不动点"，正是属性文法增量求值理论解决的问题。

- **Demers, Reps, Teitelbaum（POPL 1981 / TOPLAS 1983）** *Incremental Evaluation for Attribute Grammars* / *Incremental Context-Dependent Analysis* — 增量属性求值的开山：维护依赖图，输入变则只重算受影响子图。
- **Yellin & Strom（TOPLAS 1991）** *INC: A Language for Incremental Computations* — 支持**环**的增量计算：对环用**不动点迭代**，并做"变化传播"；正是 SCC 环增量重算的算法蓝本。
- **Circular Attribute Grammars（Farrow 1986；Jones & Swierstra）** — 允许属性依赖成环、用不动点定义语义；对应 NetLab 代数环的迭代求解。
- **Lazy Incremental Computation for Efficient Scene Graph Rendering**（TU Wien）— 场景图**惰性增量渲染**：只重算/重绘脏子树。**这对 NetLab 前端 `drawGraph` 的直接借鉴最强**。<https://www.cg.tuwien.ac.at/courses/RendEng/2015/RendEng-2015-11-16-paper2.pdf>

### 21.4 图级编译优化（更像编译器的 NetLab）

- **Halide（Ragan-Kelley et al., PLDI 2013）** — **算法与调度（schedule）分离**：同一算法可换不同调度（tile/fuse/parallel/vectorize）；核心=**融合（fusion）省内存、tiling 提局部性**。<https://halide-lang.org/>
- **TVM（Chen et al., OSDI 2018）** — 深度学习**图级算子融合 + 自动调度/调优**；NetLab 的 `compute handler` 组合可视为算子图，可借"算子融合"思想把相邻小算子合并成一个内核。
- **MLIR（Lattner et al., CGO 2021）** *MLIR: Scaling Compiler Infrastructure for Domain Specific Computation* — **多层 IR + dialect + pass**；NetLab 若做"统一 IR"，可采用 dialect 化的多抽象层（scene 层 / 元件层 / 内核层）。

### 21.5 响应式编程综述

- **Bainomugisha et al.（ACM Computing Surveys 45(4), 2013）** *A Survey on Reactive Programming* — 系统梳理 RP 的分类（事件驱动/数据流/FRP/actor）、语义与工程权衡。<https://dlnext.acm.org/doi/10.1145/2501654.2501666>
- **Push-pull FRP（Elliott 2009）** — 拉模式减少无用重算，与 §20 的按需计算互补。

### 21.6 落地映射（技术 → NetLab 代码 → 优先级）

| 技术 | 代表文献 | NetLab 落点 | 优先级 |
|---|---|---|---|
| 差分视图维护 | DBSP (VLDB'23) / Differential Dataflow | Recorder/probe 增量：改参数只对受影响子电路算"差分" | **A/B** |
| 构建式增量 + 早停 | Build Systems à la Carte (ICFP'18) | 每帧重算策略：constructive trace + early cutoff（结果不变不再向下传播） | **A** |
| 有环增量求值 | INC (Yellin & Strom 1991) / 增量属性文法 | `algebraic_cycles`(SCC) 环的增量重算 + 不动点 | **A/B** |
| 惰性增量重绘 | Lazy Incremental Scene Graph (TU Wien) | 前端 `drawGraph` 只重绘脏子树 | **A** |
| 进度/静止判定 | Naiad timely dataflow (SOSP'13) | 判断"本步/本帧是否还有活"，供调度与预计算 | B |
| 算法/调度分离 | Halide (PLDI'13) / TVM (OSDI'18) | `compute handler` 组合的算子融合、调度可替换 | B |
| 多层 IR + dialect | MLIR (CGO'21) / sea-of-nodes (1995) | 统一 scene/元件/内核三层 IR，pass 可插拔 | C |

### 21.7 新增参考文献（含地址）

1. Arvind & Culler, *Dataflow Architectures*, Annu. Rev. Comput. Sci. 1986
2. Parks, *Bounded Scheduling of Process Networks*, PhD (Ptolemy) — <https://ptolemy.eecs.berkeley.edu/papers/parksThesis/>
3. Bilsen et al., *Cyclo-static Dataflow*, IEEE Trans. SP 1996
4. Carloni et al., *Latency-Insensitive Design*, 2001
5. Click & Paleczny, *A Simple Graph-Based Intermediate Program Representation*, 1995
6. Murray et al., *Naiad: A Timely Dataflow System*, SOSP 2013 — <https://sigops.org/s/conferences/sosp/2013/papers/p439-murray.pdf>
7. Budiu et al., *DBSP: Automatic Incremental View Maintenance for Rich Query Languages*, VLDB 2023 — <https://www.vldb.org/pvldb/vol16/p1601-budiu.pdf>
8. Mokhov, Mitchell, Peyton Jones, *Build Systems à la Carte*, ICFP 2018 — <https://www.microsoft.com/en-us/research/uploads/prod/2018/03/build-systems-a-la-carte.pdf>
9. Cai, Giarrusso, Rendel, Ostermann, *A Theory of Changes for Higher-Order Languages*, ICFP 2014 — arXiv:1312.0658
10. Yellin & Strom, *INC: A Language for Incremental Computations*, TOPLAS 1991
11. Demers, Reps, Teitelbaum, *Incremental Evaluation for Attribute Grammars*, POPL 1981 / TOPLAS 1983
12. Ragan-Kelley et al., *Halide*, PLDI 2013 — <https://halide-lang.org/>
13. Chen et al., *TVM: An Automated End-to-End Optimizing Compiler for Deep Learning*, OSDI 2018
14. Lattner et al., *MLIR: Scaling Compiler Infrastructure for Domain Specific Computation*, CGO 2021
15. Bainomugisha et al., *A Survey on Reactive Programming*, ACM CSUR 2013 — <https://dlnext.acm.org/doi/10.1145/2501654.2501666>
16. *Lazy Incremental Computation for Efficient Scene Graph Rendering* — <https://www.cg.tuwien.ac.at/courses/RendEng/2015/RendEng-2015-11-16-paper2.pdf>

### 21.8 一句话结论

> 续读之后，NetLab 的"增量刷新"有了**完整理论栈**：底层是 **INC/增量属性文法的有环增量求值**（解决 SCC 反馈环），中层是 **DBSP/差分数据流的增量视图维护**（改参数只算差分），上层是 **Build Systems à la Carte 的构建式增量+早停**（结果不变不传播），前端是 **惰性增量场景图重绘**（只画脏子树）；而**Halide/TVM/MLIR** 提供了"图即程序"的图级编译优化手法。把这四层思想落到 NetLab，就得到一个"**改动 → 最小重算 → 最小重绘**"的响应式引擎。

## 22. 第十二轮：程序变换 / 等式饱和 / 图重写 —— 让 NetLab 的图可被"自动优化"

> 继续扩读的落点：既然 NetLab 的 `scene → graph` 是程序，那么"**如何自动把这张图改写得更省更快**"就是下一个前沿。本轮覆盖**项重写与等式饱和（e-graph）**、**超优化**、**部分求值/多阶段编程**、**图重写系统（DPO）**、**浮点精度重写（Herbie）**、**GraphBLAS 半环线性代数**。六者共同支撑一句话：**NetLab 的图不只是被解释执行，还能被"自动搜索 + 自动改写 + 形式化验证"**。

### 22.1 项重写与等式饱和（E-graph / egg）

- **等式饱和（Tate et al., POPL 2009）** *Equality Saturation: A New Approach to Optimization* — 用 **e-graph** 同时保存大量"等价程序"，一遍遍套用重写规则直到饱和，再从中挑最优——避免传统编译"相位序/启发式"造成的局部最优。DOI `10.1145/1480881.1480915`；PDF <https://goto.ucsd.edu/~mstepp/peggy/pubs/popl09.pdf>
- **egg（Willsey et al., POPL 2021）** *egg: Fast and Extensible E-graphs* — 现代高效 e-graph 库；支持**可扩展重写规则**与**抽取（extraction）成本模型**。DOI `10.1145/3434304`；<https://www.mwillsey.com/papers/egg>
- **对 NetLab 的落点**：把"元件/子电路/子图"放进 **e-graph**，用物理等价规则（串并联化简、星三角变换、理想源合并、单位元消除）做**饱和**，再按成本（元件数/矩阵 nnz/估计耗时）**抽取**最优等价电路。**规则可随 `extensions` 扩展**——这正好是"扩展系统"的正确形态。

### 22.2 超优化（Superoptimization）

- **Massalin（ASPLOS 1987）** *Superoptimizer: A Look at the Smallest Program* — 穷举搜索最短指令序列。
- **Bansal & Aiken（2006/2008）** 用 **STP 求解器**做有界超优化。
- **STOKE（Schkufza, Sharma, Aiken, ASPLOS 2013）** *Stochastic Superoptimization* — 用 **MCMC 随机搜索**在"正确性检验 + 性能代价"下找最优内核。
- **对 NetLab 的落点**：对 `compute handler` 的内层数值序列（如 Newton 残差、线性求解小内核）做**有界超优化**，生成更少指令/更少临时数组的实现；适用于离线编译期，不进运行时。

### 22.3 部分求值 / 多阶段编程（Staging）

- **Jones, Gomard, Sestoft（1993）** *Partial Evaluation and Automatic Program Generation* — 经典专著：给定部分输入（如固定拓扑/固定参数），把程序**特化**，消去大段运行期开销。<https://studwww.itu.dk/~sestoft/pebook/pebook.html>
- **Taha & Sheard（2000）MetaML** / 多阶段编程 — 显式区分"生成期 vs 运行期"代码。
- **对 NetLab 的落点**：与 §20.2 的 partial evaluation 合流——**拓扑+常量参数固定时，把引擎特化成一张静态、无分支的执行计划**（"编译期"完成调度与折叠），运行期只跑数值。

### 22.4 图重写系统（DPO / GP2 / GrGen）—— 模块展开的形式化

- **双推挽（Double-Pushout, DPO）图重写** — 用"模式图 L → 保留 K → 结果图 R"的范畴论框架定义"匹配-替换"，有**合流性/终止性**分析。<https://en.wikipedia.org/wiki/Double-pushout_approach>
- **Adhesive HLR 范畴（Ehrig et al.）** — 把 DPO 推广到带属性的图（属性=端口/类型）。<https://www.user.tu-berlin.de/lieske/tfs/publikationen/Papers07/PE07.pdf>
- **GP 2 / GrGen.NET** — 实用图重写语言/工具（规则匹配 + 并行替换）。
- **对 NetLab 的落点**：`flatten_circuit`（模块展开）、`sensor/actuator` 端口桥接，本质是"**用规则把模块子图替换成展开后的子图**"。用 DPO 形式化后，可**静态检查规则是否合流/终止**（避免展开顺序导致不同结果），替代现在手写特例（R24/D51）。

### 22.5 浮点精度重写（Herbie）—— 数值健壮性

- **Herbie（Panchekha, Sanchez-Stern, Wilcox, Tatlock, PLDI 2015）** *Automatically Improving Accuracy for Floating Point Expressions* — 用**搜索+局部误差分析**把数值表达式改写成**更精确**的等价形式（如重排求和、稳定化公式）。<https://pldi15.sigplan.org/event/pldi2015-papers-automatically-improving-accuracy-for-floating-point-expressions> · <http://herbie.uwplse.org/papers.html>
- **对 NetLab 的落点**：Newton 残差、病态矩阵的缩放/均衡、`probe` 计算公式的数值稳定性，可用 Herbie 式重写**自动降误差**（呼应 §19 的 row/col scaling）。

### 22.6 GraphBLAS：求解 = 半环上的图线性代数

- **GraphBLAS（Kepner & Gilbert 等）** — 把图算法表达为**稀疏矩阵在自定义半环（semiring）上的乘加**；MNA/最短路/可达性都可统一成"图线性代数"。<https://graphblas.org/> · *Graphs, Matrices, and the GraphBLAS: Seven Good Reasons* <https://lacuna.tiptreesystems.com/work/graphs-matrices-and-the-graphblas-seven-good-reasons/version/art_f92686312f89401da6f9796a30e25caf>
- **对 NetLab 的落点**：`CircuitEngine` 的 MNA 装配与求解本质是**稀疏矩阵乘/解**；用 GraphBLAS 抽象可**统一信号图/电路/场的线性代数后端**，并在 CPU/GPU 间切换（呼应 §18"求解=图上消元"、§5 多进程）。

### 22.7 落地映射（技术 → NetLab 代码 → 优先级）

| 技术 | 代表文献 | NetLab 落点 | 优先级 |
|---|---|---|---|
| E-graph 等式饱和 | Tate POPL'09 / egg POPL'21 | 子电路等价化简（串并联/星三角）+ 按成本抽取；规则随 extensions 扩展 | B |
| 超优化 | Massalin'87 / STOKE ASPLOS'13 | 离线特化热点内核（Newton 残差等） | C |
| 部分求值/多阶段 | Jones-Gomard-Sestoft'93 / MetaML | 拓扑+常量固定时特化执行计划（接 §20.2） | A |
| 图重写 DPO | DPO/Adhesive HLR / GP2 | `flatten_circuit` 模块展开形式化 + 合流/终止检查 | B |
| 浮点精度重写 | Herbie PLDI'15 | Newton 残差/病态矩阵/探针公式自动降误差 | B |
| GraphBLAS 半环 | Kepner-Gilbert | MNA 装配求解统一为图线性代数、换后端 | C |

### 22.8 新增参考文献（含地址）

1. Tate et al., *Equality Saturation: A New Approach to Optimization*, POPL 2009 — <https://goto.ucsd.edu/~mstepp/peggy/pubs/popl09.pdf>
2. Willsey et al., *egg: Fast and Extensible E-graphs*, POPL 2021 — <https://www.mwillsey.com/papers/egg>
3. Massalin, *Superoptimizer: A Look at the Smallest Program*, ASPLOS 1987
4. Bansal & Aiken, *Automatic Generation of Peephole Superoptimizers*, ASPLOS 2006
5. Schkufza, Sharma, Aiken, *Stochastic Superoptimization (STOKE)*, ASPLOS 2013
6. Jones, Gomard, Sestoft, *Partial Evaluation and Automatic Program Generation*, 1993 — <https://studwww.itu.dk/~sestoft/pebook/pebook.html>
7. Taha & Sheard, *MetaML and Multi-Stage Programming with Explicit Annotations*, 2000
8. *Double-Pushout Graph Rewriting* — <https://en.wikipedia.org/wiki/Double-pushout_approach>
9. Ehrig et al., *Adhesive HLR Categories / Algebraic Graph Transformation* — <https://www.user.tu-berlin.de/lieske/tfs/publikationen/Papers07/PE07.pdf>
10. Panchekha et al., *Automatically Improving Accuracy for Floating Point Expressions (Herbie)*, PLDI 2015 — <http://herbie.uwplse.org/papers.html>
11. Kepner & Gilbert, *GraphBLAS / Graphs, Matrices, and the GraphBLAS* — <https://graphblas.org/>
12. *Superoptimization* 综述 — <https://en.wikipedia.org/wiki/Superoptimization>

### 22.9 一句话结论

> 这一轮把"优化"从"人工写 pass"推进到"**自动搜索改写**"：**e-graph/等式饱和**让等价电路变换可被系统搜索并按成本取优（规则随扩展生长）、**部分求值/多阶段**让固定拓扑被特化成静态计划、**DPO 图重写**给模块展开以形式化与合流保证、**Herbie**把数值精度也纳入自动重写、**GraphBLAS**把求解统一成图线性代数。对 NetLab 的高性价比落点排序：**多阶段特化(§20.2) > e-graph 子电路化简 > DPO 形式化展开 > Herbie 数值重写 > 超优化/GraphBLAS（研究）**。

## 23. 第十三轮：Modelica 物理系统建模 + FMI —— 多物理场仿真的工业级蓝图

> 用户（m00607）请求读 Modelica 与 FMI。这直接命中 NetLab 的"本行"：NetLab 就是一个物理系统建模/仿真工具，而 Modelica 是这一行**最成熟的方程基多领域建模语言**、FMI 是其**标准化可执行容器与协同仿真接口**。两者合计给出一套"**从模型到仿真器到跨工具协同**"的完整工业级架构，正好补上 NetLab 现在偏"信号流 + 手写特例"的短板。

### 23.1 指定资料（核实题录）

| # | 题录 | DOI / 地址 |
|---|------|-----------|
| 1 | Mattsson S.E., Elmqvist H., Otter M. *Physical system modeling with Modelica.* Control Engineering Practice **6**(4):501–510 (1998) | `10.1016/S0967-0661(98)00047-1` |
| 2 | Elmqvist H., Mattsson S.E., Otter M. *Modelica — a language for physical system modeling, visualization and interaction.* IEEE CACSD 1999, pp.630–639 | `10.1109/CACSD.1999.808720` |
| 3 | Benveniste A., Caillaud B., Malandain M. *The mathematical foundations of physical systems modeling languages.* Annual Reviews in Control **50**:72–118 (2020) | `10.1016/j.arcontrol.2020.08.001`（已在 §18 精读） |
| 4 | *Functional Mock-up Interface Specification*（FMI 3.0，Modelica Association Project） | <https://fmi-standard.org/docs/main/> |

### 23.2 Modelica 的核心思想（三条支柱）

1. **方程基 / 非因果（acausal）建模**：模型写成一组**方程**（`der(x)=…`、`0=f(x,u)`…），而不是赋值语句。**求解顺序由工具在编译期决定**，用户不必手写"谁先算谁"。——这与 NetLab 现在"信号流图 + 手写方向"相反，正是"多物理场自动定序"的关键。
2. **连接器（connector）+ flow / potential 变量**：连接器里既有 **potential（势，如电压/温度/位移）** 又有 **flow（流，如电流/热流/力）**。`connect(a,b)` 的语义 = **势变量相等 + 流变量求和为零**（KCL/KVL 的多领域推广）。这让"电气/机械/热/流体"用**同一套连接语义**拼装。
3. **面向对象 / 可替换（replaceable-redeclare）/ 多领域库**：类、继承、组件、`replaceable` 泛型，配合 Modelica Standard Library（电气、机械、热、流体…），实现**模块化复用**。工具还做**符号预处理**（见 23.3）把大模型化到可解。

### 23.3 Modelica 工具的符号预处理管线（与 NetLab 直接对映）

一套 Modelica 编译器把一个"看起来是几千条方程"的模型变成可仿真代码，靠的是一条**符号流水线**——这条流水线几乎逐条对应本项目的 §18/§19/§22：

1. **Flattening（展平）**：继承/组件/redeclare 全部展开成扁平方程集。
2. **Connection expansion（连接展开）**：把 `connect()` 展开成"势相等 + 流求和"的方程（含模块端口）。
3. **Alias elimination（别名消去）**：合并恒等变量，减小规模。
4. **Index reduction（索引约简）**：用 **Pantelides / 哑导数（dummy derivatives）** 把高索引 DAE 降到可积分（**= §19.2**）。
5. **BLT transformation（块下三角化）**：对方程-变量依赖图做 **Tarjan SCC → 块下三角**，得到可顺序求解的块序列（**= §18 的 SCC/BTF、§21 的调度**）。
6. **Tearing（撕裂）**：对每个非线性代数环，**挑少数"撕裂变量"**，把大非线性块降成"小稠密解 + 不动点迭代"，大幅降低维数（**= NetLab `_solve_nonlinear_stage` 的升级方向**）。
7. **Causalization（因果化）**：为每条方程指定解哪个变量，生成显式赋值序（后端代码生成）。

> **对 NetLab 的意义**：NetLab 已有 `flatten_circuit`（展平）、并查集（连接合并）、`algebraic_cycles`/`solver_plan`（SCC/BLT 雏形），但**缺 index reduction、别名消去、tearing、统一因果化**。把 Modelica 这条流水线补进 `scene → 引擎` 的"编译期"，就能从"能算"升级到"大规模也能算"。

### 23.4 FMI 3.0：可执行模型容器与协同仿真（架构蓝图）

- **FMU（Functional Mock-up Unit）** = 一个 ZIP：`modelDescription.xml`（变量、因果性 `causality`=parameter/input/output/local/independent、单位、依赖、能力标志）+ 二进制/源码 + 文档/资源。**标准 C API** 由导入方（仿真器/优化器）调用。
- **三种接口类型**（正好映射 NetLab 的三种模式）：
  - **Model Exchange (ME)**：FMU 只暴露 ODE/DAE 方程，**积分器由导入方提供**（NetLab "信号/场" 那种"我方做时间推进"）。
  - **Co-Simulation (CS)**：FMU **自带求解器**，通过 `fmi3DoStep` 推进；支持 **Early Return、Event Mode、Intermediate Update、Clocks**（NetLab "电路/多解算器耦合"）。
  - **Scheduled Execution (SE)**：导入方是**调度器**，按 clock 激活 model partition（NetLab 若做实时/嵌入式）。
- **事件与超密集时间（super-dense time）**：把时间建模成 `(t_R, t_I)`，区分"同一物理时刻的多次事件"；用 **event indicators（零穿越 z）** 定位**状态事件**，区分 **time/state/step events**。**对 NetLab：把"固定 dt 推进"升级为"带事件检测的自适应推进"**（现在 `_advance_locked` 是固定步长）。
- **FMI 3.0 新增**：terminals（语义化端口分组）、icons、clocks/clocked variables、更多整型+float32、binary 类型、数组变量、structural parameters（运行时可改数组尺寸）、方向导数 **与伴随导数（adjoint）**、`BuildConfiguration`。**对 NetLab：若做"模块=FMU"式架构，terminals/clocks/adjoint 都是现成的接口设计参考。**

### 23.5 对 NetLab 的落地映射（技术 → 代码 → 优先级）

| Modelica/FMI 概念 | 来源 | NetLab 落点 | 优先级 |
|---|---|---|---|
| 方程基/非因果连接器（flow-potential） | Mattsson 1998 | blocks/ports 从"因果信号"升级为"acausal 连接器"，自动定序 | **A（多物理场基础）** |
| 符号预处理管线（flatten→alias→index→BLT→tearing→causalize） | Modelica/CACSD'99 | `scene→引擎`编译期补齐 index reduction/别名消去/tearing | **A/B** |
| Tearing 降维 | Modelica 工具 | `_solve_nonlinear_stage` 用撕裂变量把大 SCC 块降成小稠密解+不动点 | **B** |
| 事件检测 + 超密集时间 | FMI 3.0 | `_advance_locked` 从定步长升级为带 state/time event 的自适应推进 | **B** |
| FMU 容器 / modelDescription | FMI 3.0 | 模块封装为"带变量表+因果性+单位"的可导入单元；或导出/导入 FMU | **C（生态互操作）** |
| ME/CS/SE 三接口 | FMI 3.0 | 对应 NetLab 三种模式；Co-Simulation 用于 signal/circuit/fem 多解算器耦合 | **B/C** |

### 23.6 参考文献（含地址）

1. Mattsson, Elmqvist, Otter, *Physical system modeling with Modelica*, Control Eng. Practice 6(4), 1998 — <https://doi.org/10.1016/S0967-0661(98)00047-1>
2. Elmqvist, Mattsson, Otter, *Modelica — a language for physical system modeling, visualization and interaction*, IEEE CACSD 1999 — <https://doi.org/10.1109/CACSD.1999.808720>
3. Benveniste, Caillaud, Malandain, *The mathematical foundations of physical systems modeling languages*, Annu. Rev. Control 50, 2020 — <https://doi.org/10.1016/j.arcontrol.2020.08.001>
4. *FMI Specification 3.0* — <https://fmi-standard.org/docs/main/>
5. *Modelica Association / Modelica Standard Library* — <https://modelica.org/>
6. Fritzson, *Principles of Object-Oriented Modeling and Simulation with Modelica 3.3*（教材，补充）

### 23.7 一句话结论

> Modelica 之于 NetLab 的价值不在"再多一个功能"，而在**一套被验证过的"方程基多领域建模 + 符号预处理"方法论**：用 **acausal 连接器（flow/potential）** 让电气/机械/热/流体统一拼装，用 **flatten→alias→index reduction→BLT→tearing→causalize** 这条流水线把"大而杂的方程"编译成"可顺序求解的小块"（正好补上 §18/§19/§22 缺失的 index reduction 与 tearing），再用 **FMI 的 ME/CS/SE + 事件/超密集时间** 做跨解算器协同与互操作。落点优先级：**acausal 连接器 > 符号预处理管线(含 tearing) > 事件检测 > FMU 互操作**。

## 24. 第十四轮：数值分析、科学计算与稀疏矩阵算法 —— 从方程建立到求解器执行

> 用户（m00631）给出的提纲：不止"积分算法"，而是**方程建立 → 离散 → 求解器执行**的完整体系，四个方向 A 非线性方程组、B 稀疏矩阵、C 自动微分+稀疏雅可比、D 微分方程/DAE/刚性/自适应。这直接命中 NetLab 电路求解核心 `nodal.py`。下面把**指定文献核实 → 代码现状 → 差距 → 落地**逐条对齐。

### 24.1 指定文献（核实题录）

| # | 题录 | DOI / 地址 |
|---|------|-----------|
| 1 | Davis T.A., Palamadai Natarajan E. *Algorithm 907: KLU, A Direct Sparse Solver for Circuit Simulation Problems.* ACM TOMS **36**(3):17 (2010) | `10.1145/1824801.1824814` |
| 2 | Coleman T.F., Verma A. *The Efficient Computation of Sparse Jacobian Matrices Using Automatic Differentiation.* SIAM J. Sci. Comput. **19**(4):1210–1233 (1998) | `10.1137/S1064827595295349` |
| 3 | *Sparser, Better, Faster, Stronger: Sparsity Detection for Efficient Automatic Differentiation* (2025) | arXiv:2501.17737 |
| 4 | *asdex: Automatic Sparse Differentiation in JAX* (2026 预印本，前沿) | arXiv:2610.12336 |
| 5 | Nichols K.G., Kazmierski T.J., Zwolinski M., Brown A.D. *Overview of SPICE-like circuit simulation algorithms.* IEE Proc. Circuits Devices Syst. **141**(4):242 (1994) | `10.1049/ip-cds:19941246` |

> 核实结果与你的预期一致：KLU = **BTF 置换 + 填充缩减排序(AMD/ND) + Gilbert–Peierls 左看式稀疏 LU**，是 Xyce 默认稀疏直接解；Coleman–Verma 用**图着色（bicoloring）**把"逐个变量求导"压成"按颜色批量求导"。

### 24.2 A. 非线性方程组求解 —— 现状与差距

**代码现状（`nodal.py` `_newton_solve` 1910–1991 / `_newton_with_strategies` 1775–1830）**：
- 每次迭代**重新 stamp 组装矩阵**：`matrix=self._blank_matrix(); rhs.fill(0); for element: element.stamp(ctx)`，再 `new_solution=self._solve_matrix(...)`——即 Newton 的 J 是由各非线性元件 `stamp`+`update_guess` **隐式装配**（解析导数，非有限差分，这是电路仿真正确做法）。
- 收敛判据：**节点增量** `delta<=self._tolerance()` **且** 后向残差 `residual<=residual_tol`（两者都查，工程上稳健）。
- 发散保护：`not np.all(np.isfinite)` → ComputeError；`max|x|>1e9` → "电压超过 1e9 V，仿真已发散"。
- 失败救急：**gmin stepping**（`gmin` 从 1e-3 ×0.1 递减，回 0）+ **source stepping**（独立源 0→1 斜坡，上解作初值）——这是 SPICE 的经典 homotopy 策略，已在 `_newton_with_strategies` 落地。
- **缺口**：**没有阻尼/线搜索（damped Newton）**、**没有信赖域（trust-region）**、**没有 Modified Newton（冻结/半更新雅可比）**；`_newton_solve` 里每步直接全量更新 `solution=new_solution`。

**建议（优先级中）**：
1. **阻尼 Newton + Armijo 线搜索**：当残差下降不足时缩短步长 `x←x+α·Δx`，对强非线性/初值差大幅降低发散率（`graph.py` 已有类似 line search，可移植到 `nodal`）。
2. **Modified Newton**：矩阵变化很小时复用上次 LU（已有 `_lu_cache` 机制），或每 k 次迭代才重分解，省分解开销。
3. **信赖域**：残差曲面病态时比线搜索更稳，但实现成本高，排在阻尼 Newton 之后。
4. 收敛判据已双判据，可再补 **相对残差 + 归一化**（`||F||/(||F0||+ε)`）。

### 24.3 B. 稀疏矩阵计算 —— 现状与差距（本轮最大机会）

**代码现状**：
- 稠密：`_solve_matrix` 用 `scipy.linalg.lu_factor` 一次分解 + `lu_solve` 回代；**线性电路矩阵不变时整段 LU 缓存复用**（`_lu_cache/_lu_matrix/_cached_dt`，`linear_reuse` 计数）——语义正确且省时。
- 稀疏：`self.sparse` 时走 `_solve_sparse`，**行/列均衡**（`_equilibration`）后 `_splu(scaled)`（`nodal.py:2116`，SciPy SuperLU，默认 **COLAMD** 排序），零主元→奇异诊断。**没有显式 BTF、没有 AMD/ND 选择、没有 KLU、没有 Krylov 迭代解**。
- GPU：稠密且 `matrix_size>=gpu_min_size(192)` 时走 CuPy（`accel`）。
- 规模上限：`MAX_NODES=400 / MAX_EDGES=1200`（`limits.py`）——**在稠密路径下是合理的**（N=400 复数 solve 实测 3.4ms），但**稀疏路径尚未吃满**。

**建议（优先级高，收益最大）**：
1. **KLU 替换/新增 splu 后端**：KLU 专为电路非对称 MNA 设计（BTF+AMD+Gilbert–Peierls），比通用 SuperLU 在电路矩阵上快且更省内存（Xyce 默认）。落地：可选 `scikits.umfpack`/`klu` 绑定或 C 扩展；或先用 **`scipy.sparse.linalg.splu(permc_spec="MMD_AT_PLUS_A")`/`COLAMD`** 对比调参。
2. **显式 BTF + AMD**：MNA 大矩阵先做 BTF 块三角化（Tarjan SCC，与 §18/§19 同一套），再对每块 AMD 排序——正是 §24.1 KLU 的三板斧，可直接对 `_solve_sparse` 改造。
3. **Nested Dissection**：二维网格（FEM）类矩阵优于 AMD；电路（近平面+非对称）通常 AMD 更省 fill-in，按矩阵结构自适应选。
4. **Krylov 迭代（GMRES/BiCGStab）+ 预条件**：超大稀疏、只求近似解时用；但电路 MNA 常需直接解精度，**排在 KLU/BTF 之后**。
5. **CSR/CSC 存储**：当前 `tocsr` 已是 CSR；分解按 CSC 更优，注意转换成本。

### 24.4 C. 自动微分 + 稀疏雅可比 + 图着色 —— 现状与差距

**代码现状**：
- **`nodal.py` 的 Jacobian 是"逐元件解析 stamp"，天然精确且天然稀疏**——比 FD/AD 全量求导更优，**这里不需要图着色**（每个非线性元件只对自己的局部变量求导）。
- **真正需要图着色的是 `graph.py` 的信号图 `Network`**：它用**有限差分**近似雅可比（R36 P3），对 N 个未知量要 **N+1 次函数求值**——正是 Coleman–Verma 要解决的问题。

**建议（优先级中，仅对信号图 Newton）**：
1. **图着色 + 稀疏 AD（Coleman–Verma bicoloring）**：利用 J 的稀疏结构，把 N+1 次 FD 压到"颜色数"次（对角带状可低至 2–3 次）——`graph.py` Newton 的直接加速点。
2. **Sparser/Better/Faster（2025）**：算子重载自动检测局部/全局稀疏结构，无需改用户代码——可给 `graph.py` 表达式求导自动建稀疏模式。
3. **asdex（2026，前沿）**：JAX 生态的稀疏自动微分，作为**研究参考**，不急于工程化。
4. 排优先级：**逐元件解析 stamp（现状，最优）> graph.py 图着色 FD > Sparser 自动稀疏检测 > asdex（研究）**。

### 24.5 D. 微分方程与数值积分 —— 现状与差距

**代码现状**：
- 时间推进：**后向欧拉（一阶、L-稳定）**，`dt` 由 `SimConfig` 固定（默认 0.002s），`steps_per_frame` 决定每帧步数；**无局部截断误差(LTE)自适应步长、无事件定位**（`_advance_locked` 固定步长）。
- 刚性/DAE：MNA 是 **index-1 DAE（微分代数）**，隐式后向欧拉 + Newton 已能处理刚性与代数约束——方向正确。
- 已有：`step_timeout_ms` 单步超时（R13）、`capture_checkpoint/restore_checkpoint` 步失败回滚。

**建议（优先级中）**：
1. **自适应 LTE 步长**：SPICE 用 LTE（局部截断误差）控制步长，可在快速瞬变时自动缩小、平稳段放大——**当前最大缺失**，直接提升精度与速度。
2. **变阶/变步长 BDF（SUNDIALS-CVODE 路线，§16）**：从一阶欧拉到高阶 BDF，刚性系统大幅提速。
3. **事件定位（event location）**：开关/二极管导通等状态事件用零穿越检测 + 精确定位，避免在事件点强行跨步（对应 §23 FMI 的事件/超密集时间）。
4. **隐式 Radau IIA / TR-BDF2**：需要高阶高稳定时选，排在 BDF 之后。
5. 参考 **Nichols 1994 SPICE 综述**：把"方程建立 → 时间离散 → 积分稳定性 → Newton → 收敛救急"串成完整链路，正好是 NetLab 的架构自查表。

### 24.6 对 NetLab 的落地映射 + 优先级

| 方向 | 具体落点 | 代码位置 | 优先级 |
|---|---|---|---|
| A 非线性 | 阻尼 Newton + Armijo 线搜索（移植 graph.py line search） | `nodal.py:_newton_solve`(1910) | **中高** |
| A 非线性 | Modified Newton 复用 LU（已有 `_lu_cache` 基础） | `_solve_matrix`(1993) | 中 |
| B 稀疏 | **KLU / BTF+AMD 替换或新增 splu 后端** | `_solve_sparse`(2079)/`_splu`(2116) | **高（收益最大）** |
| B 稀疏 | 排序策略自适应（AMD vs ND 按结构） | `_solve_sparse` | 中 |
| B 稀疏 | Krylov+预条件（巨型稀疏） | 新后端 | 低（研究） |
| C AD | graph.py 信号图 **图着色稀疏雅可比** | `graph.py` Newton | 中 |
| C AD | Sparser 自动稀疏检测 / asdex（研究） | graph.py | 低 |
| D 积分 | **自适应 LTE 步长** | `simulation.py:_advance_locked` / `SimConfig` | **高** |
| D 积分 | 变阶 BDF / 事件定位 | 同上 + 事件检测 | 中 |

**一句话路线**：**稀疏后端换 KLU（BTF+AMD）+ 时间积分配自适应 LTE** 是两条最高杠杆；`nodal` 的解析 stamp 已是最优（无需 AD/图着色），图着色只补 `graph.py` 的有限差分雅可比；阻尼 Newton 作为收敛稳健性补强。

### 24.7 参考文献（含地址）

1. Davis & Palamadai Natarajan, *Algorithm 907: KLU*, ACM TOMS 36(3), 2010 — <https://doi.org/10.1145/1824801.1824814>
2. Coleman & Verma, *Efficient Computation of Sparse Jacobian Matrices Using AD*, SIAM J. Sci. Comput. 19(4), 1998 — <https://doi.org/10.1137/S1064827595295349>
3. *Sparser, Better, Faster, Stronger*, 2025 — <https://arxiv.org/abs/2501.17737>
4. *asdex: Automatic Sparse Differentiation in JAX*, 2026 — <https://arxiv.org/abs/2610.12336>
5. Nichols, Kazmierski, Zwolinski, Brown, *Overview of SPICE-like circuit simulation algorithms*, IEE Proc. Circuits Devices Syst. 141(4), 1994 — <https://doi.org/10.1049/ip-cds:19941246>
6. Davis, *Direct Methods for Sparse Linear Systems*, SIAM 2006（BTF/AMD/KLU 教材）

### 24.8 一句话结论

> NetLab 电路求解的**数学骨架已经正确**（解析 stamp 装配 Jacobian + 双判据 Newton + gmin/source stepping + 稀疏 splu + 线性 LU 缓存），真正的增量不在"再换积分公式"，而在**稀疏直接解的工程质量（KLU/BTF/AMD 替代通用 SuperLU）** 与**时间积分的自适应（LTE/BDF/事件定位）**这两条主线；非线性方向补**阻尼 Newton**，AD/图着色只对 `graph.py` 的有限差分雅可比有意义（`nodal.py` 逐元件解析求导已是最优）。优先级：**KLU/BTF 稀疏后端 > 自适应 LTE > 阻尼 Newton > 图着色 FD > Krylov/高阶 BDF（研究）**。

## 25. 第十五轮：混合动力系统与离散事件仿真 —— 从"连续计算网络"到"动态物理系统"

> 用户（m00679）指出：现实物理系统**不全是连续变化**——电机连续、PWM 定时切换、继电器吸合、二极管导通/截止突变。数学上是**分段连续/混合系统** `ẋ = f_q(x,u)`（`q` 为离散模式）。目标是让 NetLab 从"所有节点同一计算规则"走向"**不同节点不同运行机制**"（普通计算节点=输入变化触发、连续物理元件=积分器推进、离散控制节点=事件触发、混合元件=按状态切换模型）。

### 25.1 指定资料（核实题录）

| # | 题录 | DOI / 地址 |
|---|------|-----------|
| 1 | Moradvandi A., Lindeboom R.E.F., Abraham E., De Schutter B. *Models and methods for hybrid system identification: a systematic survey.* IFAC-PapersOnLine **56**(2):95–107 (2023) | `10.1016/j.ifacol.2023.10.1553` |
| 2 | Yaakoubi A.E., Rezk H., Al-Dhaifallah M., Haggège J. *MLD-MPC Approach for Three-Tank Hybrid Benchmark Problem.* Computers, Materials & Continua (CMC) **75**(2):3657–3675 (2023) | `10.32604/cmc.2023.034929` |
| 3 | FMI 3.0 协同仿真的事件/时间同步（已在 §23 精读） | <https://fmi-standard.org/docs/main/> |
| 4 | *经典延伸*：Bemporad & Morari, *Control of systems integrating logic, dynamics, and constraints*（MLD 形式），Automatica 35(3):407–427 (1999) | `10.1016/S0005-1098(98)00178-2` |
| 5 | *经典延伸*：Henzinger, *The theory of hybrid automata*，LICS 1996 | 会议论文（无 DOI 索引） |

### 25.2 数学骨架：混合自动机

一个混合自动机由 `(Q, X, f, Init, Inv, E, G, R)` 描述：离散状态集合 `Q`、连续状态 `X`、**每个模式 `q` 一条连续流 `ẋ=f_q(x,u)`**、初始集、**不变式 `Inv(q)`**、**边/迁移 `E`**、**守卫 `G(e)`（guard，通常是零穿越/阈值条件）**、**重置映射 `R(e)`（切换时跳变）**。运行 = 在模式内连续演化 → 守卫触发瞬间**跳到新模式并重置状态** → 继续。关键难点：**Zeno 现象**（有限时间内无限次跳变）与**事件定位精度**。

- **MLD 形式**（Bemporad–Morari）：把逻辑/切换用**二进制辅助变量 + 不等式约束**编码进线性动态，得到混合整数动力学，可交给 **MPC→MILP** 求解（三水箱 benchmark 即此类）。
- **辨识**（Moradvandi 2023 综述）：从数据估计模式数、guard 面、各模式参数——是"混合系统"落地绕不开的一环。

### 25.3 六项技术要点（用户提纲 1–6）

1. **状态机 FSM**：模式/迁移/动作的最小描述；NetLab 可用它承载"控制器节点"。
2. **离散事件系统 DES**：事件队列 + 离散状态转移，时间只由事件推进（不只是定时步进）。
3. **连续动态系统**：ODF/DAE 积分（已由 §24 的 Newton+积分器承担）。
4. **混合自动机**：把 1–3 统一（模式内连续、模式间事件）。
5. **零交叉事件检测（zero-crossing）**：为每个守卫定义**事件函数 `g(x)`**，检测其在步内**符号翻转**，用**插值/Brent 求根**定位穿越时刻，而不是"跨过去就算了"。
6. **事件定位与状态重置**：把时间推进到事件精确时刻 `t*`，施加 `R(e)` 重置状态，再以新模式继续；必要时限制步长避免 Zeno。

### 25.4 对 NetLab 现状对码（差距在"粒度"和"事件"）

- **只有"模式级"异构，没有"节点级"异构**：`scene.py` 用**三种引擎**区分 `signal/circuit/vector`（`SignalEngine` `scene.py:174`、`CircuitEngine` `scene.py:511`、`VectorEngine`），但**同一个场景内所有节点走同一个 `step(dt)`**——`SignalEngine.step`(`scene.py:422`) 直接 `self.network.step(dt)`；`CircuitEngine.step`(`scene.py:764`) 直接 `self.solver.step(dt)`。用户想要的"普通节点/连续元件/离散控制/混合元件各自机制"目前**没有运行时区分**。
- **已有的异构苗头**：① `block` 复合节点——`SignalEngine` 为 `kind=="block"` 建**独立子场景运行器** `block_runtimes`（`scene.py:299/422`，带各自 checkpoint），这已是"节点内一套独立动力学"的雏形；② `extensions/nodes/user.*` 自定义节点（如 `user.rate_limiter.py` 的 `@node` 每步 handler）——**节点类型可扩展**，但仍是"每步调用一次"的离散步进。
- **开关是"固定电导"，不是"状态切换"**：`Switch`(`nodal.py:515`) 构造时按 `closed` 取 `1/ron` 或 `1/roff` 定死后**不再变**——没有运行时按电压/时间切换的机制。
- **二极管是"平滑非线性电导"，没有导通/截止事件**：`Diode`(`nodal.py:615`) 用指数 `Is·(exp(v/nVt)−1)` 每 Newton 迭代重新线性化（`stamp` 653、`update_guess` 662），是**连续模型**——好处是天然连续可导，代价是**没有显式 on/off 状态、没有零穿越事件**，在快速开关/大信号下可能漏掉真实切换点。
- **全局缺失**：**任何地方都没有 zero-crossing 检测、事件队列、事件定位、状态重置**——`_advance_locked` 固定 `dt` 推进（§24 已记），开关/继电器/PWM 只能靠"足够小 dt 硬逼近"。

### 25.5 目标架构：异构节点运行时 + 事件总线

**A. 节点运行时分类（node runtime taxonomy）** —— 给每个节点声明"运行机制"，而非全局一种：

| 节点类别 | 运行机制 | 触发 | NetLab 对应 |
|---|---|---|---|
| 计算节点（comb） | 输入变化即算，无状态 | 脏传播（§21） | signal 图普通节点 |
| 离散步进节点 | 每步/每 tick 执行一次 | 时钟 | `user.*` 扩展、`block` 内离散块 |
| 连续积分节点 | 由积分器推进 `ẋ=f_q` | 时间步 | circuit/vector 元件 |
| 事件触发节点 | 事件队列驱动 | guard 触发 | 新增（PWM/继电器/FSM 控制器） |
| 混合节点 | 模式内积分 + 守卫切换 + 重置 | 两者兼具 | 新增（带 mode 的元件） |

**B. 事件总线（event bus）** —— 统一的事件循环：
1. **注册事件函数**：每个离散/混合节点声明 `g_i(x,t)`（电压差、电流过零、定时器到点…）。
2. **步内监视**：积分推进时记录所有 `g_i` 的**符号**；一旦翻转 → 用**求根**定位 `t*∈(t, t+dt)`。
3. **事件排队与定位**：取**最早** `t*`，把仿真时钟推进到 `t*`，其余状态停在该点。
4. **重置与重算**：对触发节点施加 `R(e)`（开关电导切换、二极管 on/off、模式变量跳变），再以新模式重解。
5. **Zeno 保护**：单步内事件数超限则强制增大最小步长/打日志（工程兜底）。
6. **与 FMI 协同仿真对齐**：外部 FMU/多解算器用 **doStep + 事件/中间更新** 握手（§23.4），NetLab 事件总线即"主算法(master algorithm)"。

**C. 落地形态**：把 `Switch` 从"构造定电导"升级为**带 `mode` 的混合元件**（`closed` 变成运行时状态，由 `g=v_a-v_b−vth` 触发切换），`Diode` 增加**显式 on/off + 迟滞（hysteresis）** 以贴近真实器件；给 `Simulation._advance_locked` 增加**事件检测钩子**，`SimConfig` 增 `event_tol`/`max_events_per_step`。

### 25.6 落地映射 + 优先级

| 能力 | 落点 | 代码位置 | 优先级 |
|---|---|---|---|
| 零交叉事件检测 + 事件定位 | 新增事件总线，挂在时间推进 | `simulation.py:_advance_locked` / 新 `events.py` | **高** |
| 开关/二极管改为混合元件（mode+guard+reset） | 元件状态化 | `nodal.py:515`(Switch) / `615`(Diode) | **高** |
| 节点运行时分类（comb/离散/连续/事件/混合） | 引擎调度层 | `scene.py` `_Engine`/`SignalEngine`/`CircuitEngine` | 中高 |
| FSM/控制器节点（PWM、继电器逻辑） | 新节点类型 | `extensions/nodes/` + signal 图 | 中 |
| 与 FMI 协同仿真时间同步 | master algorithm | 新模块，对 §23.4 | 中（生态） |
| MLD 形式 / MLD-MPC | 建模+控制层 | 新模块（研究） | 低（研究） |

**一句话路线**：先把 **"零交叉事件检测 + 事件定位 + 状态重置"** 做成 `Simulation` 的一等公民（事件总线），再把 **Switch/Diode 升级为带 mode 的混合元件**；节点运行时分类让"离散控制节点/连续积分节点/混合节点"各走各的机制——这正是从"连续计算网络"迈向"动态物理系统仿真"的关键一步。

### 25.7 参考文献（含地址）

1. Moradvandi, Lindeboom, Abraham, De Schutter, *Models and methods for hybrid system identification: a systematic survey*, IFAC-PapersOnLine 56(2), 2023 — <https://doi.org/10.1016/j.ifacol.2023.10.1553>
2. Yaakoubi, Rezk, Al-Dhaifallah, Haggège, *MLD-MPC Approach for Three-Tank Hybrid Benchmark Problem*, CMC 75(2), 2023 — <https://doi.org/10.32604/cmc.2023.034929>
3. Bemporad & Morari, *Control of systems integrating logic, dynamics, and constraints*, Automatica 35(3), 1999 — <https://doi.org/10.1016/S0005-1098(98)00178-2>
4. FMI 3.0 Specification（事件/超密集时间）— <https://fmi-standard.org/docs/main/>
5. Henzinger, *The theory of hybrid automata*, LICS 1996（经典，混合自动机理论）
6. Cellier & Kofman, *Continuous System Simulation*, Springer 2006（事件检测/zero-crossing 教材）

### 25.8 一句话结论

> NetLab 当前是"**模式级异构、连续时间推进**"：三种引擎按场景切换，但同一场景内所有节点共用固定 `dt` 的 `step`，开关是固定电导、二极管是平滑非线性电导，**没有任何零交叉事件检测与状态重置**。要成为真正的混合系统仿真，补的是 **①零交叉事件检测+事件定位+状态重置的事件总线、②Switch/Diode 的混合元件化（mode+guard+reset）、③节点运行时分类（comb/离散/连续/事件/混合）**；优先级：**事件总线 > 混合元件 > 节点分类 > FSM 控制器 > FMI/MLD（研究）**。

## 26. 第十六轮：计算机图形学与科学可视化 A —— 图布局算法

> 用户（m00734）指出 NetLab 的可视化本身是独立研究课题，并明确**先区分两件事**：①**把网络显示得清晰**（图布局/连线路由，本节 A）；②**把计算结果显示得准确**（科学可视化/数据精度，留待后续 B 节）。本节聚焦 A：图布局算法，并落到 NetLab 前端网络画布与 PlotKit 的优化。

### 26.1 指定资料（Crossref 核实题录）

| # | 题录 | 出处 / DOI |
|---|------|-----------|
| 1 | Gibson H., Faith J., Vickers P. *A survey of two-dimensional graph layout techniques for information visualisation.* | Information Visualization **12**(3–4):324–357 (2013；在线 2012) — `10.1177/1473871612455749` |
| 2 | Zhang S., Xu R., Quan Y. *Large graph layout optimization based on vision and computational efficiency: a survey.* | Visual Intelligence **1**(1), Art.14 (2023) — `10.1007/s44267-023-00007-w` |
| 3 | Both C., Dehmamy N., Yu R., Barabási A.-L. *Accelerating network layouts using graph neural networks.* | Nature Communications **14**:1560 (2023) — `10.1038/s41467-023-37189-2` |
| 4 | Di Bartolomeo S., Crnovrsanin T., Saffo D., Puerta E., Wilson C., Dunne C. *Evaluating Graph Layout Algorithms: A Systematic Review of Methods and Best Practices.* | Computer Graphics Forum **43**(6):e15073 (2024) — `10.1111/cgf.15073` |

> 第 4 篇是"验收标准"——综述了 200+ 篇的**评测方法、基准数据集、指标体系**；建议 NetLab 直接照它的维度建布局测试集，而不是凭肉眼感觉好坏。

### 26.2 先分清"两类布局"（否则会改错地方）

| 布局类型 | 对象 | NetLab 现状代码 | 本节的算法适用性 |
|---|---|---|---|
| **网络节点布局**（画布） | 场景节点/连线（signal/circuit/vector） | `frontend/app.js` `autoLayout`(6641)、`drawGraph`(2817)、`drawEdges`(2136)、路由 `route=auto/straight/orthogonal/manual`(1304–1318, 1959–1964) | **A 节主体**：Sugiyama/力导向/应力优化/边捆绑 |
| **面板/子图布局**（图表） | PlotKit 图的 subplot 网格 | `PlotKit/src/plotkit/static/render2d.js` `gridLayout`(116–142)：等宽等高分格 + `fig.subplots`/`insets` | GridSpec 式比例/跨格/受限布局 |
| **科学数据呈现**（准确性） | 曲线/场/时序的采样与绘制 | — | 留待 B 节 |

### 26.3 图布局算法族谱（对应用户清单）

1. **力导向（Force-directed）**：Fruchterman–Reingold（斥力+弹簧，O(V²)/迭代）、Kamada–Kawai（按图距离匹配应力）、**Barnes–Hut 近似 O(V log V)**。优点：通用、自然；缺点：局部极小、无方向语义、大图慢、每次结果抖动。
2. **应力优化（Stress Majorization / SMACOF）**：最小化 `Σ w_ij(||p_i−p_j|| − d_ij)²`，其中 `d_ij` 为图最短路距离；单调收敛、比力导向稳，但最短路 + O(V²) 内层贵。**适合中小图，且可用当前位置做初值以保持"心智地图"（mental map）**。
3. **层次布局（Hierarchical / Sugiyama）**：四阶段——①**破环**（feedback arc set，反向最小边）②**分层**（longest-path / network simplex 最小化跨度）③**层内排序降交叉**（barycenter/median + 相邻交换，交叉最小化是 NP-hard 用启发式）④**坐标分配**（Brandes–Köpf：保序、直边优先）。**信号流/电路这类有向图最贴合**。
4. **边捆绑（Edge Bundling）**：层次/KD-tree 捆绑、力导向捆绑，把平行/密集边聚成束，降视觉杂乱。
5. **图聚类 + 多层次（Multilevel）**：先粗化聚类 → 粗图布局 → 逐层细化（FM³、Walshaw），大规模图的标准做法。
6. **降维布局**：MDS / t-SNE / UMAP 把高维相似度映到 2D（属"用降维做布局"一支，适合属性驱动）。
7. **GNN 学习布局**（Both 2023）：用图神经网络学习"图→坐标"的映射，为大规模/流式图**大幅加速**生成接近力导向质量的布局（训练后可秒级出图），适合做"大图快速预览"。

### 26.4 对 NetLab 现状对码（关键差距）

- **`autoLayout`(app.js:6641–6711) 只是"最长路径分层"**：`layer[target] = max(layer[source]+1)` 迭代收敛 → 按层分列 `x=(level-mid)*276`、层内按 y/名称排序 `y=(index-(n-1)/2)*128`，写回 `/api/positions` + `fitView()`。**只有 Sugiyama 的第②步（longest-path 分层），缺破环、缺层内交叉最小化、缺 Brandes–Köpf 坐标优化、边路由仍走 orthogonal 直线**——密集图必然交叉/压盖。
- **边路由已有基本盘**：`route` 支持 `straight / orthogonal / manual(waypoints)`（`app.js:1304–1318`、`1959–1964`），但**正交路由无避障**（只有中点折线），多层/多障碍时会穿过节点。
- **PlotKit `gridLayout`(render2d.js:116–142) 是等宽等高网格**：`ncols` 由 `fig.ncols` 或 `ceil(n/ncols)` 决定、固定 `gapX=26/gapY=30`、每格等分；**无按比例（width_ratios/height_ratios）、无跨格 span、无 aspect 约束、无 constrained-layout 自动留白**。
- **重要产品约束（历史教训）**：`0mvocd763` 记录"电路图自动布局两次尝试踩坑（强制 H/V 旋转+正交引线叠压；缺逐元件坐标导致引线压盖），用户最终**放弃自动布局、改由 agent 自行摆放**，渲染层优先**显式 layout + 符号沿导线直线连接**，自动布局只留实验 API"。→ 本节建议必须**尊重该决策**：主路径保持显式布局，自动布局作为**可选的"整理一下"实验功能**，且必须配真·Sugiyama + 避障路由 + 指标体系才敢默认开。

### 26.5 落地映射 + 优先级

| 能力 | 落点 | 说明 | 优先级 |
|---|---|---|---|
| **真·Sugiyama**（破环+网络单纯形分层+交叉最小化+Brandes–Köpf 坐标） | 替换 `app.js:autoLayout` | 面向 signal/circuit 有向图，直接减少交叉与压盖；作为"整理布局"实验入口 | **A（高）** |
| **正交避障路由**（libavoid/Adaptagrams 思路：正交连接器 + 障碍绕行） | `app.js` 路由层（`route=orthogonal`） | 电路图可读性提升最大；手动 waypoints 仍优先 | **A（高）** |
| **应力优化（SMACOF）小图可选** | `autoLayout` 备选算法 | 用当前位置初值保心智地图；适合 ≤200 节点 | B |
| **评测基准与指标** | 新建 `tests/layout_bench` | 按 Di Bartolomeo 2024：交叉数、应力、邻域保持、宽高比、运行时、心智地图稳定性 | **A（先建，才能量化收益）** |
| **边捆绑（Edge Bundling）** | `drawEdges` 可选 | 仅密集图/大图开启，避免默认干扰 | C |
| **多层次/聚类布局** | `autoLayout` 大图分支 | 现 `MAX_NODES=400`，收益有限 | C |
| **GNN 加速布局** | 研究 | 大图/流式图预览，需离线训练 | 研究 |
| **PlotKit GridSpec 式布局**（比例/跨格/aspect/constrained） | `render2d.js:gridLayout` | 把等分网格升级为 `width_ratios/height_ratios` + span + 自动留白，直接扩 PlotKit 出图能力 | **B（高性价比）** |

### 26.6 参考文献（含地址）

1. Gibson, Faith, Vickers, *A survey of two-dimensional graph layout techniques for information visualisation*, Information Visualization 12(3–4), 2013 — <https://doi.org/10.1177/1473871612455749>
2. Zhang, Xu, Quan, *Large graph layout optimization based on vision and computational efficiency: a survey*, Visual Intelligence 1(1):14, 2023 — <https://doi.org/10.1007/s44267-023-00007-w>
3. Both, Dehmamy, Yu, Barabási, *Accelerating network layouts using graph neural networks*, Nature Communications 14:1560, 2023 — <https://doi.org/10.1038/s41467-023-37189-2>
4. Di Bartolomeo et al., *Evaluating Graph Layout Algorithms: A Systematic Review of Methods and Best Practices*, Computer Graphics Forum 43(6):e15073, 2024 — <https://doi.org/10.1111/cgf.15073>
5. 延伸：Brandes & Köpf, *Fast and simple horizontal coordinate assignment*, GD 2001；Sugiyama, Tagawa, Toda, *Methods for visual understanding of hierarchical system structures*, IEEE SMC 1981；Fruchterman & Reingold, *Graph drawing by force-directed placement*, SPE 1991；Gansner et al., *A technique for drawing directed graphs*（Graphviz dot）, IEEE TSE 1993。

### 26.7 一句话结论

> NetLab 的"清晰显示"瓶颈不在算法多寡，而在**现有 `autoLayout` 只做了 Sugiyama 的分层一步**（缺破环/交叉最小化/坐标优化/避障路由），叠加历史"自动布局踩坑→改显式布局"的决策。落地应：**先把"真·Sugiyama + 正交避障路由"做成可选"整理布局"，用 2024 综述的指标体系建基准量化收益；同时把 PlotKit `gridLayout` 从等分网格升级为 GridSpec 式（比例/跨格/aspect/constrained）**——前者治"电路图可读性"，后者扩"图表排版能力"。优先级：**布局评测基准 ≈ 真·Sugiyama ≈ 正交避障路由 > PlotKit GridSpec > 应力优化 > 边捆绑/多层次/GNN（研究）**。

## 27. 第十七轮：并行计算、工作流引擎与任务调度

> 用户（m00791）指出：第 21/22 轮（数据流/增量）关注"**计算依赖如何产生**"，本轮关注"**计算任务如何利用硬件资源执行**"——DAG 调度、多线程执行、任务窃取、关键路径、GPU 分配、内存感知调度、分块算法、并行依赖同步。并点名 **Dask**（分块算法 + 任务调度 + 内存感知执行）。

### 27.1 指定资料（Crossref 核实题录）

| # | 题录 | 出处 / DOI |
|---|------|-----------|
| 1 | Rocklin M. *Dask: Parallel Computation with Blocked Algorithms and Task Scheduling.* | Proc. 14th Python in Science Conf. (SciPy 2015), pp.126–132 — `10.25080/majora-7b98e3ed-013` |

### 27.2 Dask 的核心思想（四点，比"会跑 DAG"更重要）

1. **任务图（task graph）与执行分离**：先懒构建一张**带依赖的任务 DAG**（"算什么"），再由**调度器**决定"怎么跑/在哪跑"。同一张图可换 **threaded / multiprocessing / distributed** 后端——**换硬件不改逻辑**。
2. **分块算法（blocked algorithms）**：把大数组/数据框切成块（chunk），每个任务是"对一块做一次 NumPy/pandas 运算"，实现**超内存计算**与**流水线**。这决定了粒度。
3. **调度器**：threaded（共享内存、受 GIL 约束、任务宜 10–100ms）、multiprocessing（绕 GIL、任务宜 ≥100ms–1s）、distributed（跨机）。
4. **内存感知执行**：调度时考虑中间结果驻留，避免 OOM；支持 spill-to-disk。

> **对 NetLab 的直接启示**：真正的价值不是"引入 Dask"，而是借它的**三层抽象**——(a) 把场景/求解显式化为**任务图**，(b) 把任务做**粗粒度**，(c) 让执行策略**可切换（线程/进程/GPU）且内存有感知**。

### 27.3 用户提的三个关键问题（通用原则 + 经验法则）

**① 计算粒度（每节点一线程 vs 多节点组一任务）**
- 并行不是越细越好：**任务开销 ≈ 调度 + 同步 + 数据搬运**，若单任务实际计算 < 开销，并行反而更慢。
- **经验法则（Dask 社区）**：线程调度任务宜 **~10–100ms**；进程调度任务宜 **~0.1–1s**（进程启动/pickle 更贵）。**NetLab 单步实测 ~0.48ms**，远低于此阈值 → **"每节点一线程"必然赔本**。
- 结论：**按"整步/整扫频段/整批"聚合**，不要按单节点切。细粒度要靠 **向量化/SoA（§11）** 消化，而不是线程。

**② 数据共享（并发读写同一结构的安全）**
- 手段排序：**不可变快照（copy-on-write）> 双缓冲 > 读写分离 > 细锁**。
- NetLab 现状是"**一把 RLock 包住整个 precompute**"（`simulation.py:316/318`），安全但**串行化一切**；应改为"计算线程产出**不可变帧快照**，HTTP 只读快照"（双缓冲/无锁 SPSC 环，见 §11/§24）。
- **跨进程**时数据不共享内存：只能 pickle/共享内存（`multiprocessing.shared_memory`）传块，代价高 → 更支持"进程只用于粗粒度独立任务"。

**③ CPU/GPU 协同**
- 判定式：**收益 ≈ (计算量 / 传输+启动开销)**。小矩阵（< 阈值）GPU 更慢——NetLab `accel.py` 已用 `DEFAULT_GPU_MIN_SIZE=192` 门控，且**单步内同步**（不跨步异步），这是对的。
- 设计策略：按"任务类型 + 数据规模 + 传输成本"路由——**大矩阵线代→GPU；大量小任务→CPU 多核/向量化；混合→按块分流**。

### 27.4 对 NetLab 现状对码（有多少调度基建）

- **没有任何 DAG 任务调度器 / 任务窃取 / 关键路径**：`grep` 全 `netlab/` 只有 `_vendor/plotkit/backends/pyvista_pool.py` 用 **`ProcessPoolExecutor`**(line 20/87) 做**批量三维出图**（`workers=min(4, CPU-1)`，每 worker 首载 vtk 1–2s）——这是唯一"多进程执行"的地方。
- **计算是"单线程定步循环"**：`simulation.py` 一个 `netlab-simulation` 线程、`fem.py` 一个 `netlab-fem` 线程；HTTP 端点全是同步 `def`，被 FastAPI 丢进 **anyio 线程池（~40）**——但真正的重活（precompute）**在请求线程里同步跑完整个 0→T 且全程持 RLock**（`server.py:749–754` → `SERVICE.precompute` → `simulation.py:316/318`），**期间其它请求全排队**。
- **AC 扫频串行**：`nodal.py` 逐频点 `np.linalg.solve`（§24），天生 **embarrassingly parallel** 却没并行。
- **GPU 已有但极窄**：`accel.py` 仅单次线代调用可切 CuPy，规模门控 + 同步回拷，无"多任务 GPU 队列/流"。

> 一句话现状：**NetLab 有"线程池"但没有"调度"**——重活靠一把锁串行，独立任务（扫频/批处理/参数扫）没被并行化，GPU 只覆盖单点。

### 27.5 落地映射 + 优先级（哪些该并行、哪些不该）

| 场景 | 是否值得并行 | 方式 | 优先级 |
|---|---|---|---|
| **单步 Newton/装配**（~0.48ms/步） | **不值得**（细粒度赔本） | 向量化/SoA/稀疏，非线程 | — |
| **AC 扫频逐频点**（独立、矩阵中大型） | **值得** | 线程池（NumPy/LAPACK 释放 GIL）或进程池 | **A（高）** |
| **参数扫掠 / 蒙特卡洛 / 批量工作点** | **值得** | `ProcessPoolExecutor`（绕 GIL、粗粒度） | **A（高）** |
| **批量三维出图** | 已并行 | `pyvista_pool`（现状） | 已具备 |
| **多网络/多工程同时推进** | 值得 | 每网络一个仿真线程（已有 `NetworkContainer`） | 已有 |
| **重活不阻塞 HTTP（precompute 等）** | **必须** | 改 job + 快照发布（双缓冲/无锁环），不要持锁跑完 | **A（高，接 §6）** |
| **DAG 任务图 + 关键路径调度** | 中 | 显式化场景依赖→调度器（借鉴 Dask，不引入 Dask） | B |
| **内存感知 / spill-to-disk** | 中 | 大数据录制/回放（接 §17） | B |
| **GPU 多任务/流并发** | 低（当前单点） | 大规模时再做多流 | C |

**粒度决策表（记住这张就够）**：
- 计算 < 1ms 的任务 → **不并行，向量化**；
- 1ms–100ms、共享内存且释放 GIL → **线程池**；
- ≥100ms、独立无共享 → **进程池**；
- 数据放不下 → **分块 + 流式（blocked algorithm）**；
- 大量小矩阵 → **CPU 批处理**；少量大矩阵 → **GPU**。

### 27.6 参考文献（含地址）

1. Rocklin, *Dask: Parallel Computation with Blocked Algorithms and Task Scheduling*, SciPy 2015, pp.126–132 — <https://doi.org/10.25080/majora-7b98e3ed-013>
2. Dask 官方文档（调度器/最佳实践：任务时长建议、`map_blocks`、内存管理）— <https://docs.dask.org/>
3. 延伸：Blumofe & Leiserson, *Scheduling multithreaded computations by work stealing*, JACM 1999；Python `concurrent.futures` / `multiprocessing.shared_memory` 文档。

### 27.7 一句话结论

> NetLab 有线程池、没有调度；重活被一把 RLock 串行化，独立的扫频/批处理却没并行。落地不引入 Dask，而借它的三层抽象：**①把场景/求解显式化成粗粒度任务图 ②重活改"计算线程 + 不可变快照发布"不再持锁阻塞 HTTP ③把 AC 扫频/参数扫/批处理交给线程池或进程池**。粒度铁律：**<1ms 别并行（向量化）、1–100ms 线程池、≥100ms 进程池、放不下就分块流式；小矩阵 CPU、大矩阵 GPU**。优先级：**precompute 去锁快照 = AC 扫频并行 = 参数扫掠进程池 > DAG 调度（借鉴 Dask）> 内存感知/GPU 多流**。

## 28. 第十八轮：数据库、数据溯源与版本管理

> 用户（m00822）指出一个"容易被忽略但对大型专业软件极重要"的领域：NetLab 未来不只要存**节点位置**，还要存**节点参数 / 计算函数 / 网络拓扑 / 计算依赖 / 物理状态 / 仿真历史 / 计算结果 / 模块引用**；且**用户改一个参数后，必须能知道哪些结果失效、哪些仍然有效**。这正好是前面 §20/§21/§25 的"数据侧收口"。

### 28.1 指定资料（Crossref 核实题录）

| # | 题录 | 出处 / DOI |
|---|------|-----------|
| 1 | Lin S., Xiao H., Jiang W., Li D., Liang J., Li Z. *A survey of provenance in scientific workflow.* | Journal of High Speed Networks **29**(2):129–145 (2023) — `10.3233/JHS-222017` |
| 2 | Lima S., Correia J., Araujo F., Cardoso J. *Improving observability in Event Sourcing systems.* | Journal of Systems and Software **181**:111015 (2021) — `10.1016/j.jss.2021.111015` |
| 3 | Scheidegger C., Koop D., Santos E., Vo H., Callahan S., Freire J., Silva C. *Tackling the Provenance Challenge one layer at a time.*（VisTrails） | Concurrency and Computation: Practice and Experience **20**(5):473–483 (2008, online 2007) — `10.1002/cpe.1237` |
| 4 | *延伸*：W3C PROV-O 溯源本体 | <https://www.w3.org/TR/prov-o/> |

### 28.2 问题定义：一个专业仿真软件到底要存什么

用户的清单可归为**三类状态 + 一条链**：

- **声明式状态**：节点/边、参数、拓扑、模块引用（= 模型"是什么"）；
- **计算状态**：计算函数版本、求解器、依赖关系、物理状态（= 模型"怎么算"）；
- **结果状态**：仿真历史、计算结果（= 模型"算出什么"）；
- **溯源链（provenance）**：`y=f(a,b,c)` 里，**y 由哪些输入、哪个版本的 f、哪个求解器、是否发生状态切换产生**——这条链把上面三类缝起来，回答"**这个数是怎么来的 / 改 a 后谁失效**"。

### 28.3 数据溯源（Data Provenance）的方法论

- **Prospective vs Retrospective**：前者=工作流"将要怎么跑"的配方；后者=实际执行的记录（用了哪次运行、哪些输入）。
- **模型/标准**：**OPM**（Open Provenance Model）、**W3C PROV**（Entity–Activity–Agent 三元组）、**ProvONE**（科学工作流扩展）。核心就是"**实体-活动-代理**"三段式：`wasGeneratedBy / used / wasDerivedFrom / wasAttributedTo`。
- **溯源半环（provenance semirings, Green et al. PODS'07）**：把"这条结果由哪些输入按什么组合贡献"代数化——用半环（如 `how`、`why`）在关系代数上标注来源，可精确算"哪些输入影响这条输出"。
- **复现（reproducibility）**：Lin 2023 综述把溯源的价值落在**对抗复现危机**；它还讨论了**区块链做安全/不可篡改溯源**——对单机桌面是**过度设计**（见 §28.7）。
- **工作流溯源**：VisTrails（28.5）是标杆——既存**数据产品**的溯源，也存**工作流演化**的溯源。

### 28.4 Event Sourcing（事件溯源）——版本与撤销的骨架

- **核心**：不存"当前状态"，而存**一串状态变化事件**（`AddNode A` / `SetParam R=100` / `Connect A,B` / `SetParam R=200` / `Disconnect A,B`），**重放到任意前缀即得历史状态**。
- **能力**：**undo/redo、回滚到任意历史、查看修改历史、分支实验（不同参数各成一条事件分支）、追踪结果产生过程**。
- **配套工程**：**周期快照**（每 N 个事件存一次全量，避免重放太久）+ **事件日志**（append-only，带 `seq/时间戳/actor/因果序`）+ **CQRS**（读写分离：写侧追加事件，读侧投影成快照）。
- **坑（必须记住）**：① **schema 演化/数据转换**——旧事件格式变了要"upcaster"迁移（Overeem 2017 *The dark side of event sourcing: Managing data conversion*）；② **日志膨胀**——需 log pruning + 快照（Erb 2018）；③ **观测性/一致性**——跨事件因果序（Lamport 时钟）、追踪（Lima 2021 讲 observability）。

### 28.5 VisTrails 的关键教训：**按"变更"记录，统一两类溯源**

VisTrails 的设计要点（对 NetLab 直接可借）：
1. **change-based provenance**：不是每次存全量，而是**记录工作流的一次次改动**（一层层 diff），天然支持"演化历史 + 版本树"。
2. **两类溯源统一**：**数据产品的溯源**（结果是哪次工作流跑出来的）与**工作流演化的溯源**（工作流本身怎么改的）用**同一套层次化结构**表示，可查询（Provenance Challenge）。
3. **版本树/分支**：同一份数据可以有多个演化分支，**改参数 = 从某节点长出新枝**——正好对应"分支实验不同参数"。
4. **探索式场景**："change is the norm"——为**不断变化**的工作流量身定做（NetLab 的"边搭边调"正是这种）。

### 28.6 对 NetLab 现状对码（有什么、缺什么）

- **存的是"最终快照"，不是"溯源链"**：`project.py` `build_project_for`(940) → `save_project`(952) 把整个工程序列化成一份 JSON（节点/边参数、layout、模块引用都在 `NodeRecord/EdgeRecord.snapshot`）。**只保留 retrospective 的"最后一帧"，没有历史、没有事件、没有依赖失效链。**（保存路径的坑见记忆：多网络要走 `NetworkContainer.build_project`、库路径要显式传入降级。）
- **已有"版本号"但不是"溯源"**：`scene.py` 的 `self.revision`（882）在每次实质变更时 `+=1`（890/909/2038；坐标变化 1554 也 `+=1` 但不重建引擎），快照里带 `revision`（1014/1053）。它是**粗粒度缓存失效开关**（前端 `hasPrecomputed`、引擎是否重建据此判断）——**只能回答"变了没有"，不能回答"改了哪、谁失效"**。
- **已有"事务回滚"但不是"历史"**：`scene.capture_checkpoint`(379)/`restore_checkpoint`(401)、`nodal.CircuitSolver.capture_checkpoint`(1668)/`restore`(1679)、`simulation.py` 每步 `capture/restore`(235/239/246) —— 这是**单步计算失败/超时的内存回滚**，**不落盘、不构成历史**。但它是做"快照"的现成基础。
- **没有 undo/redo / 事件日志 / 持久化历史**：`grep` 全 `netlab/` 未见 event log / journal / undo 核心实现；`_vendor/plotkit/store/registry.py` 的 `DataSet.history` 只记 `(version,length,at)` 元数据，PlotKit 的 `clear_history` 也只清缓存——都不是完整溯源。

> 一句话现状：**NetLab 有"快照 + 粗版本号 + 单步回滚"，缺"事件历史 + 细粒度依赖失效 + 结果溯源"。**

### 28.7 落地设计：四层（从已有能力长出来）

| 层 | 目标 | 落点 | 依赖 | 优先级 |
|---|---|---|---|---|
| **L0 内容哈希 + 失效传播** | 改一个参数，精确知道**哪些下游结果失效** | 把 `scene.revision` 从"全局计数器"升级为**结构哈希**（节点/边/参数的 Merkle 哈希），沿依赖图传播 | 接 §20 缓存 / §21 脏传播 | **A（高，收益最大）** |
| **L1 事件日志 + 快照（Event Sourcing）** | **undo/redo、历史、分支实验、复现编辑过程** | 把 `mutate`/编辑操作记为 append-only 事件（seq/时间戳/actor），周期性 `capture_checkpoint` 落盘为快照 | 复用现有 checkpoint | **A（高）** |
| **L2 结果溯源（Provenance）** | "这个结果怎么来的"：输入哈希+求解器/参数版本+函数版本+随机种子+模式切换+输出哈希 | PROV 风格 `Entity-Activity-Agent` 记录，挂在每次仿真批次 | 接 §25 事件（状态切换） | B |
| **L3 内容寻址结果存储** | 大结果可复现、可去重、可复用 | 结果按内容哈希命名存储，大数组用 §17 块压缩（Blosc2/ZFP），复现=重放事件+重算或命中缓存直取 | 接 §17 存储 | B |
| — 区块链安全溯源 | 不可篡改审计 | 单机桌面**不需要**（过度设计） | — | C（研究） |

**关键设计原则**（避免 Event Sourcing 的坑）：
- **事件要带 schema 版本 + upcaster**，否则老工程打不开（Overeem 教训）；
- **必须配快照 + log pruning**，否则重放/存储爆炸（Erb 教训）；
- **编辑事件（L1）与仿真事件（L2）分两条流**：前者是用户建模操作，后者是时间轴上的物理/事件（接 §25），别混；
- **内容哈希是 L0→L2 的公共钥匙**：`改参数 → 新哈希 → 沿依赖图找"结果哈希依赖它"的记录 → 标记 stale`，这就是用户要的"**哪些结果失效**"。

### 28.8 与前面章节的衔接（这是"数据侧收口"）

- **§20/§21（编译器/增量 build system）**：回答"**哪些失效、early cutoff**"的**计算面**；本节的**内容哈希 + 依赖图**正是它的**数据面**。
- **§25（混合系统事件）**：给"仿真过程中发生状态切换"提供**事件源**，写进 L2 溯源。
- **§17（大数据存储）**：给 L3 结果内容寻址 + 块压缩。
- **§26（可视化）**：给"结果如何呈现"，与"结果如何溯源"互补。
- **§27（调度）**："复现=重放+重算"本身是一批可调度的任务。

### 28.9 优先级路线（一句话）

> **先把 `revision` 升级成"内容哈希 + 依赖失效传播"（L0，直接回答用户的"改参数谁失效"），再把编辑操作做成"事件日志 + 周期快照"（L1，得到 undo/redo/历史/分支），然后给仿真结果加 PROV 溯源与内容寻址存储（L2/L3）。** 区块链溯源不做。

### 28.10 参考文献（含地址）

1. Lin et al., *A survey of provenance in scientific workflow*, J. High Speed Networks 29(2), 2023 — <https://doi.org/10.3233/JHS-222017>
2. Lima, Correia, Araujo, Cardoso, *Improving observability in Event Sourcing systems*, J. Systems & Software 181, 2021 — <https://doi.org/10.1016/j.jss.2021.111015>
3. Scheidegger et al., *Tackling the Provenance Challenge one layer at a time*（VisTrails）, Concurrency & Computation 20(5), 2008 — <https://doi.org/10.1002/cpe.1237>
4. W3C, *PROV-O: The PROV Ontology* — <https://www.w3.org/TR/prov-o/>
5. Green, Karvounarakis, Tannen, *Provenance Semirings*, PODS 2007 — <https://doi.org/10.1145/1265530.1265535>
6. Overeem et al., *The dark side of event sourcing: Managing data conversion*, SANER 2017（事件 schema 演化）

### 28.11 一句话结论

> NetLab 现在存的是**"最终快照"**（`build_project_for`→JSON）+ 一个**粗粒度 `revision` 版本号** + **单步内存回滚 checkpoint**，缺少专业软件最该有的**事件历史**与**结果溯源**。要回答用户那句"**改一个参数后哪些结果失效**"，最小必要改动是 **L0：把 revision 升级为内容哈希 + 沿依赖图传播失效**；要 undo/redo/历史/分支，则补 **L1 事件日志 + 快照**（Event Sourcing，带 schema upcaster 与 log pruning）；要"这个结果怎么来的"，再加 **L2 PROV 溯源 + L3 内容寻址存储**。这正是 §20/§21 增量计算的**数据面**、§25 仿真事件的**归档面**——把它补上，NetLab 才从"能算能存"升级为"**可追溯、可复现、可管理**"的专业仿真平台。

## 29. 第十九轮：控制理论、系统辨识与模型降阶（MOR）—— 让 NetLab 跑"两种运行模式"

> 用户（m00852）指出：MOR 是连接机械工程、控制工程与科学计算的交叉方向；一个几十万自由度的有限元模型，工程上常只关心几个关键位置的位移/应力/振动响应，能否用更小的数学模型近似其动态行为？并建议 NetLab 未来提供**两种运行模式**：**高精度仿真（完整物理模型）**与**快速仿真（降阶模型）**，用于参数扫描、动态演示、控制器设计。这一轮把 MOR 讲清楚，并对到 NetLab 现有代码。

### 29.1 指定资料（Crossref 核实题录）

| # | 题录 | DOI |
|---|------|-----|
| 1 | Rowley C.W., Dawson S.T.M. *Model Reduction for Flow Analysis and Control.* Annual Review of Fluid Mechanics **49**:387–417 (2017) | `10.1146/annurev-fluid-010816-060042` |
| 2 | Lu K., Jin Y., Chen Y., Yang Y., Hou L., Zhang Z., Li Z., Fu C. *Review for order reduction based on proper orthogonal decomposition and outlooks of applications in mechanical systems.* Mechanical Systems and Signal Processing **123**:264–297 (2019) | `10.1016/j.ymssp.2019.01.018` |
| 3 | *Reduced-Order Modeling for Engineering Systems: Survey and Opportunities for Digital Twins.* Structural and Multidisciplinary Optimization **69**(6), 2026（Springer，CC-BY） | `10.1007/s00158-026-04310-0` |

### 29.2 为什么专业仿真软件非有 MOR 不可

- **many-query 外层循环**：参数扫描、优化、控制设计、数字孪生实时镜像——**full model 每次都整算**，成本爆炸；ROM 把单次求解降 1~3 个数量级。
- **fit for purpose**：工程只关心**少数输入-输出通道**的动态；高维 full model 里大量模态对 I/O 贡献极小，可直接丢弃。MOR 的目标就是"**保留主要动态、丢掉快模态/弱耦合模态**"，同时给出**误差界**。
- **数字孪生（2026 综述）**：把 ROM 与实时优化/控制绑定；工业级还要求"可复现、可认证误差"。
- **对 NetLab**：面板实时演示、参数滑块扫描、控制器设计，全都是 many-query 场景——正是 ROM 的主场。

### 29.3 方法族谱（核心思路 / 适用 / 误差特性 / 侵入性）

| 方法 | 核心思路 | 适用 | 误差特性 | 侵入性 |
|---|---|---|---|---|
| **POD（本征正交分解）** | 对快照矩阵做 SVD，取能量占比高的前 r 个正交模态作基 | 数据驱动、线性/非线性（配 Galerkin/DEIM） | 无先验误差界，靠**能量谱截断**；Eckart–Young 给最优低秩近似 | 低（只要快照） |
| **SVD** | POD 的线性代数核：X≈U_rΣ_rV_rᵀ | 任意矩阵降秩 | **最优** Frobenius 意义低秩近似 | 无 |
| **Balanced Truncation（平衡截断）** | 用可控/可观 Gramian（解 Lyapunov 方程）平衡后截掉弱模态 | **线性**时不变系统 (A,B,C,D) | **H∞ 误差有界**：‖G−G_r‖∞ ≤ 2Σ_{i>r}σ_i | 中（需系统矩阵+解 Lyapunov，规模受限；大规模用低秩 ADI） |
| **Krylov / 矩匹配（Arnoldi·Lanczos·PRIMA）** | 构造 Krylov 子空间匹配前 2k 阶矩 | **大规模稀疏线性** | 匹配矩、无全局误差界，但**廉价、可扩到上万阶** | 中（需矩阵-向量乘） |
| **DMD（动态模态分解）** | 从时序快照 X'≈AX 做特征分解，得演化模态/频率 | 数据驱动、非线性/流场 | 近似 Koopman 谱，无保证 | 低（只要快照） |
| **Koopman / operator inference** | 用线性算子（或低维算子）描述非线性演化 | 非线性、数据驱动 | 研究前沿，依赖字典/回归 | 中 |
| **DEIM** | 对非线性项做插值降维，避免全维重算 | 与 POD 配合处理非线性 f(x) | 可控近似误差 | 中 |
| **系统辨识（ERA / Ho–Kalman / OKID / DMDc）** | 从输入-输出数据辨识状态空间 (A,B,C,D) | 黑箱/实验数据建模 | 依赖激励充分性 | 低（只要 I/O 数据） |

### 29.4 对 NetLab 现状的对码（有控制系统子集，无 MOR）

- **已有（线性控制链）**：`core/compute/transfer.py`（`from_params` 支持 expr/coeff/zpk、`to_state_space`、`bode_data`、`step_response`、`analyze`、`stability`）；`core/compute/statespace.py`（`x'=Ax+Bu, y=Cx+Du` 规格 + 共享离散化）；`core/compute/analysis.py` `_state_space_payload`(316)、`transfer_function`(353)（符号 s 域网络 TF，**仅线性节点** gain/sum/lag/integrate/transfer_function/state_space + pass/scale，忽略偏置/限幅/初值）；`core/compute/computes.py` `_state_space_factory`(677)/`_transfer_function_factory`(706)；`server.py` `/api/analysis/transfer`(1474)。
- **缺口**：全仓 grep `reduce|balanced|krylov|pod|svd|dmd|koopman|order_reduction` **无任何 MOR 实现**（`fem.py:240` 的 "reduced" 只是 Dirichlet 边界消去）。
- **结论**：NetLab 已经把"**线性网络 → (A,B,C,D)**"这条路走通，缺的只是"**(A,B,C,D) → 降阶 (A_r,B_r,C_r,D_r)**"这一步——这是**最低成本、最高杠杆**的增量。三条数据源天然并存：① 线性网络/控制系统的状态空间；② 仿真 `recorder` 的时间快照（POD/DMD）；③ FEM 的 M/K 矩阵（模态截断/POD，与 §14 重叠）。

### 29.5 落地设计：`analysis_mode = "full" | "reduced"`

1. **统一入口**：分析/仿真请求加 `mode`（full/reduced）、`method`（pod/svd/bt/krylov/dmd）、`order`、可选 `error_tol`。
2. **线性链快速通道**：线性网络 → `to_state_space` 得 (A,B,C,D) → 归一化/平衡 → **Balanced Truncation**（小规模，`scipy.linalg` 解 Lyapunov 或用 `slycot`）或 **Krylov 矩匹配**（大规模稀疏，自写 Arnoldi）→ ROM → 复用现有 `bode_data/step_response/stability` 出图，并回报 **H∞ 误差界**。
3. **数据驱动通道**：从 `recorder` 快照矩阵 X=[x(t₀)…x(t_m)] ∈ ℝ^{n×m} 做 **SVD/POD** 投影（有方程则 Galerkin，无方程则 **operator inference / DMDc**）→ 低维 ROM，用于演示与参数扫描。
4. **FEM 通道**：M/K 做**模态截断或 POD**（低阶模态叠加），供快速热/结构演示（与 §14 的 POD–DEIM 呼应）。
5. **两种模式 UI**：同一节点/面板提供"**高精度 / 快速**"开关；快速模式驱动参数滑块与实时演示，高精度模式做最终校验；面板明确标注**误差估计**，避免"静默失真"（呼应 §26 的"显示准确"诉求）。

### 29.6 落地映射表 + 优先级

| MOR 概念 | 来源 | NetLab 落点 | 优先级 |
|---|---|---|---|
| POD + SVD | Lu 2019 | 对 `recorder` 快照做 SVD，得模态基；快速演示/扫描 | **A（非侵入、复用现有数据）** |
| 数据驱动 operator inference / DMDc | Rowley 2017 | 无方程时从快照拟合低维线性模型 | **A/B** |
| Balanced Truncation（H∞ 有界） | 2026 综述 | 线性网络 `to_state_space`→降阶→复用 bode/step；给误差界 | **A（小规模）/B（低秩 ADI 大规模）** |
| Krylov 矩匹配 | 2026 综述 | 大规模稀疏线性系统降阶（AC 扫频线性化后） | **B** |
| DEIM | Lu 2019 | 非线性项降维（配合 POD） | **B** |
| FEM 模态截断 / POD | §14 重叠 | 大 M/K 快速热/结构演示 | **B** |
| Koopman / 神经算子 | Rowley 2017 / 2026 综述 | 非线性全局线性化（研究） | **C** |
| 系统辨识 ERA/Ho–Kalman | 控制理论 | 从实验 I/O 辨识模型（黑箱建模） | **C** |

> 实现依赖：**pyMOR**（开源 MOR 框架，<https://pymor.org/>）可直接参考 balanced truncation / Krylov / POD 的成熟实现，避免自造轮子；小规模用 `scipy.linalg.solve_lyapunov`，有 `slycot` 更稳。

### 29.7 参考文献（含地址）

1. Rowley & Dawson, *Model Reduction for Flow Analysis and Control*, Annu. Rev. Fluid Mech. 49, 2017 — <https://doi.org/10.1146/annurev-fluid-010816-060042>
2. Lu et al., *Review for order reduction based on proper orthogonal decomposition …*, Mech. Syst. Signal Process. 123, 2019 — <https://doi.org/10.1016/j.ymssp.2019.01.018>
3. *Reduced-Order Modeling for Engineering Systems: Survey and Opportunities for Digital Twins*, Struct. Multidiscip. Optim. 69(6), 2026 — <https://doi.org/10.1007/s00158-026-04310-0>
4. pyMOR — Model Order Reduction library — <https://pymor.org/>
5. Benner, Gugercin, Willcox, *A Survey of Projection-Based Model Reduction Methods for Parametric Dynamical Systems*, SIAM Review 57(4), 2015 — <https://doi.org/10.1137/130932715>
6. Antoulas, *Approximation of Large-Scale Dynamical Systems*, SIAM, 2005（MOR 经典教材）

### 29.8 一句话结论

> NetLab 已经有"**线性网络 → (A,B,C,D) → bode/step/stability**"的控制分析链，缺的只是最后一步 **降阶**。补上 MOR 就能兑现用户要的"两种运行模式"：**full** 走完整物理模型保精度，**reduced** 走 POD/DMD（数据驱动，复用 recorder 快照，非侵入）或 Balanced Truncation/Krylov（线性系统，**BT 还能给 H∞ 误差界**）获得 1~3 个数量级的加速，专供**参数扫描、动态演示、控制器设计、数字孪生**这些 many-query 场景。优先级：**POD/DMD 快通道（A，零侵入） > BT 小规模（A） > Krylov 大规模（B） > DEIM/Koopman（B/C）**；关键工程约束是**面板必须显示误差估计**，不做"静默降阶"。

## 30. 第二十轮：研究路线总纲 + "论文 → 数学原理 → 可借鉴算法 → NetLab 实现方案"三项式台账

> 用户（m00889）给出六阶段实际研究路线与一个综合课题建议，并特别要求：**把每篇论文的阅读成果记录成三项——数学原理 / 可借鉴的算法 / NetLab 对应的实现方案**，避免"只积累论文而没有形成自己的技术体系"。本节即按此把前 §11–§29 的成果**收敛成一张可执行台账**，并把路线钉到已有章节上。

### 30.1 六阶段路线（对映已有章节）

| 阶段 | 学习内容 | 研究目标 | 本文对应章节 |
|---|---|---|---|
| **1 数据模型重设计** | 因子图、超图、数据流图 | 让**拓扑关系 / 物理约束 / 计算依赖**各自有独立数学定义 | §18 / §19 / §21 |
| **2 计算编译系统** | LLVM、SSA、Adapton | 网络 → **中间表示**；依赖分析、循环处理、增量计算 | §20 / §21 / §22 |
| **3 科学计算引擎** | Modelica、DAE、SPICE、KLU、稀疏自动微分 | 让**计算节点与物理元件统一参与数学求解** | §23 / §24 |
| **4 多领域动态仿真** | 混合系统、FMI、ODE/DAE 求解 | 电气 / 机械 / 控制**同一环境**仿真 | §25 / §23 |
| **5 可视化与大型计算** | VTK、图布局、Dask、模型降阶 | 复杂网络、大型仿真数据、三维动画、**快速计算** | §26 / §27 / §29 |
| **6 软件工程体系** | 数据溯源、版本管理、工作流、插件架构 | **可复现、可复用、可扩展** | §28 |

### 30.2 三项式台账（核心：每篇论文 = 数学原理 / 可借鉴算法 / NetLab 实现方案）

#### 阶段 1 — 数据模型（拓扑 / 约束 / 依赖）

| 论文 / 来源 | 数学原理 | 可借鉴的算法 | NetLab 实现方案（文件 / 接口） |
|---|---|---|---|
| Dellaert 2021 因子图 (10.1146/annurev-control-061520-010504) | 因子图=变量×因子的二分图；MAP 推断=最小化积因子 | 稀疏因子图 + 变量消元（=图消元）排序 | 把 `scene.py` 三引擎统一为"因子/超图 IR"，节点=变量或因子、边=依赖 |
| Benveniste 2020 (10.1016/j.arcontrol.2020.08.001) | 非因果方程、连接器代数、bond graph、端口 Hamiltonian | connect 语义=势相等/流求和；索引约简 | `blocks` 连接器升级为 flow/potential acausal 端口 |
| Saft 2024 (10.1016/j.procir.2024.06.025) | 图重写（DPO）+ FMU 端口组合 | DPO 图重写、端口代数 | 模块展开=图重写规则集（对应 §22） |

#### 阶段 2 — 计算编译系统

| 论文 / 来源 | 数学原理 | 可借鉴的算法 | NetLab 实现方案 |
|---|---|---|---|
| LLVM (Lattner & Adve, CGO 2004) | SSA、IR、pass 流水线 | 静态单赋值 + 常量折叠/DCE/CSE | 网络→IR（DAG/SSA），`pass pipeline` 前置到 scene→引擎编译期 |
| Adapton (PLDI 2014) / Incremental Computation with Names (OOPSLA 2015) | 自调整计算、脏传播、记忆化 | 脏标记 + early cutoff | `solver_plan` 按 `revision` 缓存，脏传播跳过未变子图 |
| DBSP (VLDB 2023) | 差分数据流 / z-变换 | 增量视图维护 | 增量帧 delta 沿依赖图传播 |
| Naiad (SOSP 2013) | timely dataflow、迭代/反馈 | 迭代调度、progress tracking | 反馈环（delay=z⁻¹）的迭代调度 |
| Build Systems à la Carte (ICFP 2018) | 构建系统=调度+重建策略 | early cutoff、依赖跟踪 | 按 revision 短路重建 |
| egg (POPL 2021) / Tate (POPL 2009) | e-graph 等式饱和 | 等价类合并 + 代价提取 | 子电路等价化简（§22） |

#### 阶段 3 — 科学计算引擎

| 论文 / 来源 | 数学原理 | 可借鉴的算法 | NetLab 实现方案 |
|---|---|---|---|
| Modelica (Mattsson 1998 / CACSD'99) | 方程基/acausal；DAE；符号预处理 | flatten→alias→index reduction→BLT→tearing→causalize | `scene→引擎`编译期补齐 index reduction + tearing |
| KLU (Davis 2010, 10.1145/1824801.1824814) | BTF 块三角 + 稀疏 LU | AMD/ND 排序 + Gilbert–Peierls 消元 | `nodal._solve_sparse` 把 `splu` 换/补 KLU 内核 |
| Coleman & Verma 1998 (10.1137/S1064827595295349) | 图着色压缩雅可比 | bicoloring 求稀疏差分 | `graph.py` 有限差分雅可比用图着色；`nodal` 解析 stamp 已最优 |
| Sparser (arXiv:2501.17737) / asdex (arXiv:2610.12336) | 稀疏自动微分 | 稀疏模式检测 + 压缩 AD | `_newton_solve` 的解析导数细化为可验证稀疏 AD |
| SPICE 综述 (Nichols 1994, 10.1049/ip-cds:19941246) | MNA + Newton + 收敛策略 | gmin/source stepping、LTE、变步长 | `_newton_with_strategies` 增强 + 自适应积分器 |

#### 阶段 4 — 多领域动态仿真

| 论文 / 来源 | 数学原理 | 可借鉴的算法 | NetLab 实现方案 |
|---|---|---|---|
| 混合自动机 / MLD (IFAC 2023, 10.1016/j.ifacol.2023.10.1553；CMC 2023, 10.32604/cmc.2023.034929) | 混合自动机 (Q,X,f,Init,Inv,E,G,R)；MLD 混合逻辑动态 | 零交叉事件检测 + 事件定位 + 状态重置 | 全局事件总线；`Switch`/`Diode` 混合元件化（§25） |
| FMI 3.0 (fmi-standard.org) | 分段连续模型、超密集时间 | ME/CS/SE 三接口、doStep、intermediate update | 模块=FMU 式容器；signal/circuit/fem 用 co-simulation 主算法耦合 |
| SUNDIALS CVODE | 变阶变步长 BDF | 自适应步长 + 事件根 | 从固定 dt 升级为自适应 DAE 积分器 |

#### 阶段 5 — 可视化与大型计算

| 论文 / 来源 | 数学原理 | 可借鉴的算法 | NetLab 实现方案 |
|---|---|---|---|
| Gibson 2013 / Zhang 2023 / Both 2023 / Di Bartolomeo 2024 | 力导向/层次/应力/谱布局；度量与评测 | Sugiyama 分层 + Brandes–Köpf + 正交避障路由 | `app.js autoLayout` 升级真 Sugiyama + 正交路由（§26） |
| Dask (Rocklin 2015, 10.25080/majora-7b98e3ed-013) | 任务图 + 分块算法 + 可换调度器 | DAG 调度、工作窃取、内存感知 | `precompute` 去锁快照 + AC 扫频并行 + 参数扫进程池（§27） |
| MOR (Rowley 2017；Lu 2019；SMO 2026, 10.1007/s00158-026-04310-0) | 投影/平衡/矩匹配/数据驱动 | POD/SVD、Balanced Truncation、Krylov、DMD | `analysis_mode=full/reduced`；`transfer.py`→降阶→复用 bode/step（§29） |

#### 阶段 6 — 软件工程体系

| 论文 / 来源 | 数学原理 | 可借鉴的算法 | NetLab 实现方案 |
|---|---|---|---|
| Provenance 综述 (Lin 2023, 10.3233/JHS-222017) | PROV 图、溯源半环 | 内容哈希 + 依赖失效传播 | L0：`revision`→内容哈希，沿依赖图传播失效（§28） |
| Event Sourcing (Lima 2021, 10.1016/j.jss.2021.111015) | 事件日志 = 状态变迁序列 | 事件日志 + 周期快照 + schema upcaster | L1：事件日志 + 快照，支撑 undo/redo/分支 |
| VisTrails (Scheidegger 2008, 10.1002/cpe.1237) | 按"变更"记录的统一溯源 | 变更树 + 版本 DAG | L2/L3：PROV 结果溯源 + 内容寻址存储 |

> **用法**：每读一篇新论文，先填这三格（数学原理 / 算法 / NetLab 落点），填不出"实现方案"就说明还没读透——这张表就是 NetLab 技术体系的骨架。

### 30.3 综合研究课题：面向多物理场仿真的统一图模型与混合计算引擎设计

> 用户建议的最值得做的一个综合课题。**目标**：设计一种**通用网络结构**，使"计算节点 / 物理元件 / 数学方程 / 动态状态"能在同一系统中表达，并由**统一执行框架**完成求解。

**实验对象**：直流电机驱动机械负载（电气 + 机械 + 控制 + 齿轮），六步实现：
1. 用图结构表示电机、电源、机械负载、控制器、齿轮；
2. 用方程或因子图表达电气与机械关系（acausal 连接器：电压/电流 ↔ 转速/转矩）；
3. 用编译分析生成求解任务（flatten→BLT→tearing→causalize）；
4. 用 ODE/DAE 求解器计算动态状态；
5. 把 PWM 开关、控制器等**离散事件**加入仿真（事件总线）；
6. 实现**增量计算 + 波形显示 + 结果溯源**。

**三个基础问题（决定 NetLab 能否从"可视化节点软件"长成"通用科学计算平台"）**：
1. **数学表达能力** —— 能否用统一数据结构描述不同领域网络及其关系？（阶段 1 + §18）
2. **计算执行能力** —— 能否把用户模型转成高效、正确、可并行的计算任务？（阶段 2 + §20–§22 + §27）
3. **数值求解能力** —— 能否让不同领域物理方程在同一框架下运行？（阶段 3–4 + §23–§25）

参考：*Symbolic Modified Nodal Analysis using Python — Mechanical Systems*（外部资料，符号 MNA 扩展到机械域的示例）— <https://tiburonboy.github.io/Symbolic-Modified-Nodal-Analysis-using-Python/mech-sys.html>

### 30.4 一句话结论

> 前十九轮是"**横向铺开找方法**"，这一轮把它收敛成"**纵向能落地的技术体系骨架**"：**六阶段路线**给出研究顺序（数据模型→编译→求解引擎→多领域动态→可视化/大计算→软件工程），**三项式台账**保证每篇论文都落成"数学原理 + 算法 + NetLab 实现方案"三格（不留空才算读透），**综合课题**（统一图模型 + 混合计算引擎，以直流电机驱动机械负载为试验台）则是把六个阶段串起来的"母题"。三问——**数学表达 / 计算执行 / 数值求解**——就是 NetLab 从"节点画布"走向"通用科学计算平台"的判据。

---

## 31. 第三十一轮：创造性拓展 —— 论文回顾、自主扩读与可能路径

> 用户（m01189）：「PERFORMANCE_AND_CONCURRENCY.md 创造性拓展时还可回顾这些论文，与自行进行拓展阅读，尝试思考也许可以的路径，请自行完成这些任务。」本节不是再罗列文献，而是把已读的 §18–§30 论文按**数学内核**重排、补读 2024–2026 新文献，并给出**跨方向组合的创造性路径**（标注可行性、验证方式与风险）。

### 31.1 回顾：把论文按"数学内核"重排（而不是按领域）

同一数学内核会在不同领域重复出现——把它们并置，才能产生组合创新。

| 数学内核 | 来自哪些论文/方向 | 在 NetLab 的"原语"形态 | 可组合对象 |
|---|---|---|---|
| **稀疏消元 + 排序** | KLU/BTF/AMD/ND（§19/§24）、SubtreeLU（§31.2）、超图分区（§19） | `_solve_sparse`、`solver_plan` | 增量重分解、并行 LU、图重排 |
| **低秩/子空间近似** | POD/SVD/Eckart–Young（§29）、BT/Hankel（§29）、Krylov MOR（§29）、POD-DEIM（§31.2） | `mor.py`、`analysis_mode=reduced` | 参数扫频、非线性项降阶、压缩 |
| **不动点加速** | Newton（§24）、Anderson/DIIS（§15/§24）、GMRES（§24） | `_newton_with_strategies` | 非线性电路、耦合场、MOR 训练 |
| **图上消元/传播** | 因子图（§18）、BLT/Tarjan（§18/§23）、数据流（§20–§21）、e-graph（§22） | `graph.py`、`scene.py` | 编译期化简、等价重写、增量计算 |
| **事件/分段连续** | 混合自动机/MLD（§25）、FMI 3.0 事件（§23）、零交叉（§4） | 无（现状缺失） | 事件总线、co-simulation、数字孪生 |
| **增量/差分** | 数据流增量（§20–§21）、Event Sourcing（§28）、POD+差分压缩（§14） | `revision`、无事件日志 | 增量求解、时间旅行调试、传输压缩 |
| **对称性/等价类** | 图自同构（§15）、e-graph 饱和（§22）、超图分区（§19） | 无 | 对称约化 AC 扫频、等价电路合并 |
| **最优传输/量化** | 量化（§14）、Gorilla/ZFP（§17）、Blosc2（§17） | 探针缓冲 | 有界有损压缩、语义压缩 |

### 31.2 自主扩读：2024–2026 新文献（按对 NetLab 的相关性排序）

| # | 文献 | 数学内核 | 对 NetLab 的可能落点 |
|---|---|---|---|
| N1 | **SubtreeLU: High-performance parallel sparse LU factorization for circuit simulation**（Jiawen Cheng）— <https://scholar.google.at/citations?citation_for_view=2xMwBPYAAAAJ%3AIjCSPb-OGe4C&hl=en&view_op=view_citation> | 电路矩阵按**子树/层次结构**分解，子树间并行消元，树间用 Schur 补耦合 | `_solve_sparse` 的**并行 LU** 路径；与 KLU 的 BTF 互补（BTF 是块级，SubtreeLU 是树级） |
| N2 | **Localized diakoptic refactorization for MNA-based EMT and DP power system simulations**（IET 2025）— <https://digital-library.theiet.org/doi/abs/10.1049/icp.2025.4299> | **Diakoptics（撕裂）+ 局部重分解**：只对变化子网络重分解，其余复用 | AC 扫频/参数扫掠中"只改一个元件"时，避免全矩阵重分解——**Woodbury/Schur 低秩更新**的工程化 |
| N3 | **iG-kway: Incremental k-way Graph Partitioning on GPU**（DAC 2025）— <https://dl.acm.org/doi/pdf/10.1109/DAC63849.2025.11132904> | 动态图的**增量 k 路划分**（只迁移受影响顶点） | 超图分区从"每次重算"变为"增量维护"；配合并行求解的负载均衡 |
| N4 | **Adapting parallel DEVS semantics to FMI 3.0 co-simulation using synchronous clocks**（SIMULATION 2025, DOI `10.1177/00375497251393255`）— <https://data.europa.eu/doi/10.1177/00375497251393255> | **DEVS 离散事件 + FMI 3.0 Scheduled Execution 的同步时钟**语义对齐 | 事件总线与 co-simulation 主算法的形式化基础（§25 + §23 的交叉） |
| N5 | **Integrating SystemC TLM into FMI 3.0 Co-Simulations with an Open-Source Approach**（arXiv:2508.20223）— <https://api.semanticscholar.org/arXiv:2508.20223> | TLM（事务级建模）与 FMI 的**适配层**：端口/时钟/数据类型的桥接 | 若 NetLab 未来接硬件在环/数字孪生，可作为"外部求解器接入"模板 |
| N6 | **Physics-Informed Neural Networks for Device and Circuit Modeling: A Case Study of NeuroSPICE**（arXiv:2512.23624）— <https://adsabs.harvard.edu/cgi-bin/bib_query?arXiv:2512.23624> | PINN 拟合器件 I-V/电容特性，替代解析模型 | 非线性器件（Diode/MOS）的**学习型模型**；与 `nodal` 的解析 stamp 并存，做"模型选择" |
| N7 | **Application of POD to Time Domain Simulation of Nonlinear Field-Circuit Coupled Problems**（IEEE 2024, doc 10585828）— <https://xplorestaging.ieee.org/document/10585828/metrics> | POD 对**场-路耦合**瞬态的降阶 | FEM（热/场）+ circuit 耦合的降阶预览（§29 + §14 的直接延伸） |
| N8 | **Anderson Acceleration Without Restart: n-Step Super Quadratic Convergence**（arXiv:2403.16734）— <https://arxiv.org/abs/2403.16734> | Anderson 无重启的 n 步超二次收敛理论 | 给 `anderson_solve` 提供更强收敛保证；可替代部分 Newton 外迭代 |
| N9 | **Enhancing computational efficiency in digital twins: a survey of techniques and challenges for fast inference** — <https://www.mendeley.com/catalogue/3309d141-746d-375f-8ca8-feb47a7562c2> | 数字孪生的快速推理技术谱（ROM/代理/增量） | `analysis_mode=full/reduced` 的总体分类框架 |

> 说明：以上为**题录级**扩读（标题/摘要/出版信息），未逐篇精读全文；凡进入实现前必须按 §30 的三项式台账补全"数学原理/算法/落点"三格。

### 31.3 创造性组合路径（12 条，按"数学可行 × 工程收益"排序）

| # | 组合 | 数学表述 | 预期收益 | 验证方式 | 风险 |
|---|---|---|---|---|---|
| P1 | **局部重分解（Diakoptics × KLU/SubtreeLU）** | $A=A_0+UCV^{\mathsf T}$，用 Woodbury：$A^{-1}=A_0^{-1}-A_0^{-1}U(C^{-1}+V^{\mathsf T}A_0^{-1}U)^{-1}V^{\mathsf T}A_0^{-1}$ | 单元件改动时 O(n²k) 而非 O(n³) | 对比 `splu` 全分解 vs Woodbury 解的误差/时间（n=400, k≤8） | 低秩假设不成立时退化；需检测 rank |
| P2 | **事件驱动 co-simulation（DEVS × FMI 3.0 SE）** | 同步时钟 $\mathcal{C}$ 上的离散事件轨迹；DEVS 的 $(\delta_{int},\delta_{ext},\lambda,ta)$ 与 FMI clock 对齐 | 多求解器只在事件时刻通信，通信量↓ | 两子系统（电路+机械）耦合的步数/误差对比 | 语义对齐复杂；需 formal co-sim |
| P3 | **POD-DEIM 非线性降阶** | 非线性项 $f(x)\approx U_f\,\tilde f(P^{\mathsf T}x)$，DEIM 选插值点 $P$ | 非线性电路/辐射项从 O(n) 降到 O(r) | 在 `mor.py` 上扩 DEIM，对比全阶/降阶误差 | 非线性强时 DEIM 不稳 |
| P4 | **e-graph × BTF/tearing 等价重写** | 等式饱和在电路代数律下生成等价类；每个类取最小成本代表 | 自动化简子电路（串并联合并、恒等消除） | 随机电路上比较重写前后 MNA 规模/解一致 | 规则集需保证 soundness |
| P5 | **Anderson × Newton × KLU** | 外层 Anderson 加速 Newton 的定点迭代；内层 KLU 解线性化 | 初值差时外迭代 2–5× 减少 | 对比 `_newton_with_strategies` 的迭代数 | 可能破坏二次收敛尾段 |
| P6 | **对称性约化 × 增量分区 × AC 扫频** | 图自同构群 $\Gamma$ 作用，轨道数 = 独立未知量；分区增量维护 | 对称电路扫频点数 $\|V\|/\|V/\Gamma\|$ 减少 | 构造对称 RC 网络，对比全扫/约化扫 | 自动检测自同构开销大 |
| P7 | **神经预条件 × Krylov** | 学习 $M^{-1}\approx A^{-1}$，GMRES/BiCGStab 预条件 | 超大稀疏时迭代数↓ | 在 2D FEM 矩阵上测迭代数 | 训练数据/泛化风险 |
| P8 | **事件溯源 × 增量计算 → 时间旅行调试** | 事件日志 + 周期快照 + 反向重放；依赖图增量重算 | 用户可回退任一步并只重算受影响子图 | 原型：日志重放与快照一致性 | 日志体积/GC |
| P9 | **POD+差分+CRC 语义压缩** | 定理 14.3/14.4 + 差分可逆 + CRC | 探针流 10–25× 压缩且误差有界 | **已在 mathspec §14 验证（23.65×）** | 真实探针流需窗口化 POD |
| P10 | **数字孪生：离线全阶 + 在线降阶 + 事件校正** | 全阶 $G$ 与降阶 $G_r$；事件时用全阶校正，平时用 $G_r$ | 预览 10–100×，事件精度不丢 | 双模型并行跑同一场景对比 | 切换抖动/状态一致性 |
| P11 | **Modelica acausal × FMI terminals × 插件生态** | 连接器 flow/potential 代数 + FMI terminals 语义 | 多物理场模块可插拔 | 用 §23 的映射做两个模块的 FMU 互操作原型 | 标准兼容成本 |
| P12 | **溯源 × e-graph → 证明携带的优化** | 每次重写记录 PROV 节点；优化结果附带可检查的证明树 | 优化可信、可审计、可回滚 | 记录并重放一组重写规则，验证解不变 | 证明树存储开销 |

### 31.4 三个"最值得先做"的创造性原型（数学层，不改 netlab）

1. **`mathspec/experiments/incremental.py`**（对应 P1）：随机 MNA 矩阵 $A_0$（n=400），低秩改动 $UCV^{\mathsf T}$（k=4），比较 `splu(A)` 全分解 vs `lu_factor(A0)`+Woodbury 的**解误差与耗时**。**已实现并验证**：相对误差 $1.37\times10^{-15}$；Woodbury 回代 $0.717\,\mathrm{ms}$ vs 直接解 $1.696\,\mathrm{ms}$（**$2.36\times$**，不含一次性 LU 分解 $4.04\,\mathrm{ms}$——适用于多次改动复用同一 $A_0$ 分解的扫频/瞬态场景）。
2. **`mathspec/experiments/eventbus.py`**（对应 P2/P8）：实现最小 DEVS 事件队列（事件堆 + 时钟推进 + 零穿越二分定位），与固定步长对比事件时刻误差。**已实现并验证**：零点定位 $f(\text{root})=-2.45\times10^{-14}$（误差 $\sim10^{-14}$），事件队列按时间严格有序。
3. **`mathspec/experiments/pod_deim.py`**（对应 P3）：对非线性标量场 $f(x)=\tanh(x)$ 做 POD-DEIM，比较全阶/降阶/DEIM 三种计算的误差与评估次数。**已实现并验证**：$n=200,r=8$ 相对误差 $0.227\%$（$\le1\%$），非线性评估 $8$ 次 vs 全阶 $200$ 次（**$25\times$** 少）。

### 31.5 判断准则（避免"为组合而组合"）

- **数学正确性**：组合后的误差界必须能写出（如 P1 的 Woodbury 条件数、P3 的 DEIM 误差界）；写不出界的组合只做研究，不进实现。
- **收益可测**：每条路径必须有一个**可测的基线**（当前 `splu`/`fixed dt`/`full model`），否则不算优化。
- **复杂度预算**：新增依赖/代码路径不超过收益的量级；优先"局部替换"（P1/P5/P9），谨慎"架构级"（P2/P11）。
- **可回退**：所有路径都应有 `full` 回退开关（如 `analysis_mode=full`、`solver=klu|splu`）。

### 31.6 一句话结论

> 这一轮的核心不是"再读多少篇"，而是**把数学内核从领域外壳里剥出来**：稀疏消元、低秩近似、不动点加速、图上传播、事件分段、增量差分、对称约化、量化传输——这 8 个内核的**两两组合**就是 NetLab 下一代引擎的"元素周期表"。其中 **P1 局部重分解、P3 POD-DEIM、P9 语义压缩**已具备最小验证路径（P9 已在 `mathspec` §14 通过），建议按此顺序做原型。

## 32. 第三十二轮：优化算法与数据结构的数学验证与拓展

> 用户（m01335）任务：继续整理与扩展 **netlab 除当前功能外架构可实现的功能**的数学形式验证与拓展，继续测试**优化算法与数据结构**的数学验证与拓展，自行拓展阅读。本节与 `UNIFIED_SIM_MATH_SPEC.md` **§15** 配对：§15 给形式化定义与定理，本节给**算法/数据结构层面的复杂度分析与实测**。全部实现位于 `NetlabHome/mathspec/experiments/{optim,datastruct,ordering,kalman}.py`，测试位于 `mathspec/tests/`，**零 import netlab**。

### 32.1 两种性能杠杆：收敛阶 vs 常数/局部性

`PERFORMANCE` 前 31 节主要讨论**并发与架构**（线程/进程/锁/调度）。本节换个轴：**同一功能内**的算法与数据结构选择。它们不是"常数优化"，而是**渐近复杂度与收敛阶的选择**：

- **优化算法**：决定迭代量；线性/超线性/二次等局部收敛结论均依赖函数光滑性、曲率/正定性、初值区域和线搜索等具体假设，表中单次运行不验证这些普遍定理；
- **数据结构**：决定每次操作多贵（$O(1)$ / $O(\log n)$ / 摊还 $\alpha(n)$ / $O(n)$）；
- **稀疏排序**：影响特定矩阵图与分解实现的填充；不能仅凭渐近复杂度或对称图模型外推一般 MNA/SuperLU 的时间、内存收益。

### 32.2 优化算法族谱与实测（Rosenbrock 同一问题）

测试函数 $f(x,y)=100(y-x^2)^2+(1-x)^2$，起点 $(-1.2,1.0)$：

| 方法 | 每步代价（本例实现） | 理论收敛描述（满足其假设时） | 本例迭代/步数 | 终值 $\|\nabla f\|_\infty$ | 终值 $f$ |
|---|---|---|---|---|---|
| 梯度下降（lr=1e-3） | $O(n)$ | 强凸且步长合适时线性；一般非凸无统一速率 | 20000（上限） | $1.11\times10^{-4}$ | $1.94\times10^{-8}$ |
| 阻尼 Newton（精确 Hessian） | 稠密求解约 $O(n^3)$ | 局部二次需正则性、非奇异 Hessian 与足够接近解等条件 | 22 | $0$（浮点） | $0$ |
| BFGS（逆 Hessian 近似） | $O(n^2)$ | 超线性需标准正则性及适当线搜索；本实现为 Armijo，不能直接套用强 Wolfe 定理 | 35 | $2.84\times10^{-11}$ | $7.66\times10^{-25}$ |
| LM（最小二乘） | 稠密线性化子问题约 $O(mn^2+n^3)$；稀疏成本依实现/填充 | 局部快速收敛依残差、Jacobian 与阻尼条件 | 6（指数拟合） | — | 代价 $2.66\times10^{-30}$ |
| 共轭梯度（SPD，$n=80$） | $O(\mathrm{nnz})$ / 步（矩阵向量乘） | 精确算术有限步终止；条件数控制实际收敛 | 22 | 残差 $9.78\times10^{-10}$ | — |

**结论**：同一 Rosenbrock 问题上，BFGS 用 35 次达到 $\|\nabla f\|_\infty\approx2.84\times10^{-11}$，而梯度下降（lr=1e-3）在 20000 次**人为上限**时仍为 $1.11\times10^{-4}$。两者终止判据、步长/线搜索和预算不同，不能把 20000 与 35 的比值解释为收敛率或“数量级”定理；只能说明该实例上拟牛顿法在给定预算内更有效。优化算法选型必须按**问题结构**：
- 有解析 Hessian 且维数小 → Newton；
- 只有梯度、维数中 → BFGS/L-BFGS；
- 最小二乘/参数拟合 → LM（Gauss–Newton + 阻尼）；
- 对称正定线性子问题 → CG；
- 非线性定点迭代 → Anderson（§14 已测 66×）。

### 32.3 数据结构族谱与实测

| 结构 | 关键操作 | 复杂度 | 不变量 | 实测 |
|---|---|---|---|---|
| **并查集**（路径压缩+按大小合并） | `find`/`union` | 摊还 $O(\alpha(n))$ | 连通分量数 = 根数；`find` 幂等 | 200k 次混合操作 $0.444$ s（$\approx2.2\mu s$/op），分量数与朴素一致 |
| **二叉堆** | push/pop | $O(\log n)$ | 父 ≤ 子 | 100k push+pop $0.074$ s，弹出严格有序 |
| **环形缓冲** | push（满则覆盖最旧） | $O(1)$ | 长度 ≤ capacity；快照旧→新 | 500k 次 push（容量 4096）$0.097$ s，长度恒 4096 |
| **LRU 缓存** | get/put | $O(1)$ 期望 | 容量 ≤ cap；get 提升最近性 | 淘汰顺序与访问历史一致 |
| **CSR** | 三元组装配/matvec | $O(\mathrm{nnz})$ | 重复项求和；`y=Ax` 一致 | 与稠密 matvec 逐项一致 |

> 这些正是 netlab 现有的分散原语：`scene.py` 的并查集（导线/端口合并）、`Recorder` 的环形缓冲（`RECORDER_CAPACITY=6000`）、事件总线（§25）的堆、计划缓存的 LRU、`nodal._solve_sparse` 的 CSR。把它们统一到"验证过的原语"能减少各处的边界 bug。

### 32.4 稀疏排序：填充数才是稀疏 LU 的真正成本

12×12 二维网格（$n=144$，4 邻域）上的符号填充与带宽：

| 排序 | 带宽 | 符号填充边数 | 相对自然序 |
|---|---|---|---|
| 自然序（行优先） | 12 | 1331 | 1.00× |
| RCM（Reverse Cuthill–McKee） | 12 | 946 | **0.71×** |
| 最小度（贪心） | 123 | 618 | **0.46×** |
| 嵌套剖分（ND） | 113 | 992 | **0.75×** |

**范围与解读（仅此 12×12 无向网格图）**：
- RCM 在该规则网格上带宽不降（自然序已接近最优），但此符号消元模型的填充边数降约 29%。
- 最小度在此图上的符号填充最少（0.46×），但带宽大（123）；嵌套剖分结果为该图上的另一个折衷。
- 这些是对称图上的结构性计数，不是非对称 MNA + SuperLU/COLAMD 的因子 nnz、峰值内存或 wall-clock 测量。排序选择须在代表性真实矩阵上用同一求解器实测后再判断；不能据此声称一般填充下降或推荐规模切换。

### 32.5 与 netlab 的映射（下一步可试点的四处）

| netlab 位置 | 当前 | 可换/可加 | 预期收益 | 风险 |
|---|---|---|---|---|
| `nodal._solve_sparse`(2079) | 默认 COLAMD + `splu` | 仅可在代表性 MNA 矩阵上比较候选排序 | 尚无 Netlab 真实矩阵收益数据 | 排序开销/实现复杂度 |
| `simulation.Recorder` | 自定义环形缓冲 | 统一 RingBuffer（容量/覆盖语义测试过） | 边界 bug↓，行为可验证 | 需保持现有游标协议 |
| `scene` 导线/端口合并 | 并查集（分散） | 统一 UnionFind（路径压缩+按大小） | 摊还 α(n) 有保证，分量数可查 | 与现有语义对齐 |
| 计划/布局缓存 | 无统一 LRU | LRU（O(1)） | 缓存命中率可测，内存上限可控 | 失效策略需与 revision 对齐 |

### 32.6 状态估计与最优控制的实测（与 §15 配对）

- **Kalman**：双积分器 + 一条 300 步含噪轨迹；归一化误差均值 $0.861<3$ 仅为单次 sanity check，不是 3σ coverage/一致性检验；协方差最大不对称 $3.47\times10^{-18}$；最小特征值 $3.75\times10^{-4}>0$（本例 Joseph 形式数值 PSD）。统计一致性需多条独立轨迹及 NEES/NIS/覆盖率检验。
- **LQR/DARE**：19 次值迭代，DARE 残差 $1.1\times10^{-13}$，闭环特征值 $0.377\pm0.216j$，$|\lambda|=0.434<1$。
- 这两项是"**数字孪生**"能力的数学地基：离线全阶模型 → 在线观测器/降阶模型 → 事件校正（§31 P10）。

### 32.7 延伸阅读（算法与数据结构经典 + 2024–2026）

1. Nocedal & Wright, *Numerical Optimization*, 2nd ed., Springer (2006).
2. Boyd & Vandenberghe, *Convex Optimization*, Cambridge (2004).
3. Tarjan, *Efficiency of a Good but Not Linear Set Union Algorithm*, JACM 22(2):215–225 (1975), DOI `10.1145/321879.321884`.
4. Sleator & Tarjan, *Amortized Efficiency of List Update and Paging Rules*, CACM 28(2):202–208 (1985), DOI `10.1145/2786.2793`.
5. Cuthill & McKee, *Reducing the Bandwidth of Sparse Symmetric Matrices*, ACM 1969, DOI `10.1145/800195.805928`.
6. George, *Nested Dissection of a Regular Finite Element Mesh*, SIAM J. Numer. Anal. 10(2):345–363 (1973), DOI `10.1137/0710032`.
7. Amestoy, Davis & Duff, *An Approximate Minimum Degree Ordering Algorithm*, SIAM J. Matrix Anal. Appl. 17(4):886–905 (1996), DOI `10.1137/S0895479894278952`.
8. Davis, *Direct Methods for Sparse Linear Systems*, SIAM (2006).
9. *Anderson Acceleration Without Restart: n-Step Super Quadratic Convergence*, arXiv:2403.16734 — <https://arxiv.org/abs/2403.16734>
10. *iG-kway: Incremental k-way Graph Partitioning on GPU*, DAC 2025 — <https://dl.acm.org/doi/pdf/10.1109/DAC63849.2025.11132904>
11. *Localized diakoptic refactorization for MNA-based EMT and DP power system simulations*, IET 2025 — <https://digital-library.theiet.org/doi/abs/10.1049/icp.2025.4299>
12. *SubtreeLU: High-performance parallel sparse LU factorization for circuit simulation*（2025）。

### 32.8 一句话结论

> **优化算法决定“迭代次数”，数据结构决定“每次迭代的常数”，稀疏排序决定“特定矩阵图的结构填充”**——三者是同一性能杠杆的三个旋钮。数学验证给出的可执行结论仅限于已测实例：Rosenbrock 上 BFGS 35 次达到梯度阈值，而 GD 在 20000 次人为上限仍未达到（判据与预算不同，不能当作收敛率比较）；并查集/堆/环缓冲/LRU/CSR 的复杂度与不变量以当前 `mathspec` 测试为准；12×12 无向网格上最小度的符号填充为自然序的 0.46×，但这不外推一般 MNA 求解器收益。

## 33. 第三十三轮：遥测、可靠传输与事件分析的数学组合验证

> 本节总结 `NetlabHome/mathspec/experiments/telemetry.py` 的零耦合遥测验证。目标是把机电状态方程、量化、差分编码、压缩、可靠传输、事件定位组合成一条可验收数据路径；不修改 netlab 运行算法。

### 33.1 数学管线

$$
 y_k \to Q(y_k)=c_k \to c_k-c_{k-1}=d_k
 \to \operatorname{pack}_{i32}(d_k) \to \operatorname{zlib}
 \to \operatorname{CRC32+retry} \to \hat y_k \to \hat t_e.
$$

`int32` 有符号差分和累加解码在每个差分可表示且完整解码时是可逆的；zlib 和 CRC 重传在模型假设下不引入数值误差。CRC32 是非密码学校验，不能排除任意碰撞；这里的“无损”仅指注入的单比特损坏被检测并在有限重传最终成功的实验模型。若链路最终成功且分析保留源时间戳，码流满足 $\hat c_k=c_k$，因此源时间轴上的总误差分解为：

$$
|\hat t_e-t_e| \le e_{sampling}+e_{quantization},
$$

其中本轮只对量化弦线根项给出界；若真实连续轨迹在同一括区内满足 $f\in C^2$、$|f''|\le M$、$|f'|\ge m>0$ 且根唯一，则还可加入 $Mh^2/(8m)$，得到条件组合界。源时间戳保留时，传输延迟只改变通知墙钟时间，不改变源时间估计；若分析的是到达时间，则还需加上实际或已证明的延迟上界（FIFO 顺序本身不提供该上界）。

### 33.2 事件时间界及其硬条件

对于相邻样本区间 $[t_i,t_{i+1}]$，令 $g_j=y_{i+j}-h$，$d=|g_1-g_0|$，端点量化误差满足 $|\hat g_j-g_j|\le\epsilon$。若 $d>2\epsilon$ 且原始与重构端点保持相反符号，则

$$
|\hat t_e-t_e| \le (t_{i+1}-t_i)\frac{\epsilon}{d-2\epsilon}.
$$

这里的区间不变量与符号裕量都不可省略：若量化使首次穿越消失或移动到另一区间，管线返回 `ValueError("量化改变了穿越区间，当前误差界不适用")`，不会伪造误差界。该界还要求固定同一采样区间、$d>2\epsilon$、端点符号保持（等价于 $|g_j|>\epsilon$）；若量化器发生饱和、差分超出 `int32`、存在多次/切向穿越或根唯一性未经证明，以上界也不适用。

### 33.3 实测与复现

| 验收项 | 结果 |
|---|---|
| drivetrain 输出遥测 | 负载角速度，`dt=1e-3` |
| 量化配置 | `[-1,25]`、12 bit，$\epsilon\le\Delta/2$ |
| 可靠传输 | chunk=64、corruption rate=0.2，发生重传且码流无损 |
| 事件界 | 同一穿越区间、端点误差界成立时 `time_error <= time_bound`；连续根组合项需额外 $C^2$/横截条件 |
| 参考根 | `exact_linear_event_check() < 1e-12` |
| 端点性质测试 | 7×7 扰动网格均满足同一区间内的量化界 |
| 全量验证 | `python -m pytest mathspec/tests -q` → **98 passed in 3.56 s**（2026-11-06 最近一次实测；耗时随机器负载变化）；本轮新增连续事件界、预算逆解、FIFO 延迟假设、可用性加权与 int32 边界覆盖 |

重现命令：

```text
cd NetlabHome
python -m pytest mathspec/tests/test_telemetry.py -q
python -m pytest mathspec/tests -q
```

### 33.4 适用于 NetLab 的接口契约

- **采样器**输出有序时间戳、量化配置、饱和计数和窗口 revision；
- **传输层**保留块序号、CRC、重传次数、超时失败状态；zlib 只负责压缩，不能替代可靠性；
- **分析层**输出 `event_time`、`interval_index`、`bound`、`valid`。只有区间保持、未饱和且 $d>2\epsilon$ 时 `valid=true`；否则输出无效原因。

该接口是数学验证后的候选形态，不是对现有 NetLab API 的修改建议或已完成实现。下一阶段若接入真实 Recorder，必须再测采样插值误差、窗口边界、长时间序列的差分范围和实际吞吐；这些不能由当前零耦合实验外推。
