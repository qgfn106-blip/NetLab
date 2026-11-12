# P1-R2 交流/Bode 双后端一致性矩阵（只读审计）

> 任务来源：m00267《NetLab 阶段6 P1-R2 审计与 P0-2 Schema 决策》。
> 性质：**只读审计**。本轮不修改 `solver.py` / `descriptor.py`，不统一生产代码，不删除 Legacy 实现。
> 日期：2026-11-12（初版）/ 2026-11-13（C 块整改：拓扑计数、阈值口径、switch/病态/奇异补测、性能方法重评）。
> 证据全部来自当前工作树实际运行（HEAD `8f9344f`）。

## 1. 目的与范围

阶段 5（`eaec04a`）只统一了两端口 Laplacian 原语（`stamps.py:75` 等），**不代表完整 CircuitElement 元件模型已统一，更不宣称元件 Stamp 单一化完成**。阶段 6 正式改生产代码之前，必须先建立本文件与 `P1-R2_BACKEND_CONSTRAINTS.md` 两项只读地基。

本文件回答一个问题：在当前代码基线上，Legacy MNA 的 `CircuitSolver.ac_sweep()` 与 Descriptor 的 `DescriptorModel.frequency_response()`，在**共同支持域**内是否给出相同的复数频响？在**分歧区**（不支持元件、病态系统）各自行为如何？

## 2. 方法与环境

- 解释器：Python 3.13.9，numpy 2.3.5；`import netlab` 自 `NetlabHome/` 成功。
- 两个后端由**同一个 `Scene`** 构建，保证拓扑逐位一致：
  - Legacy：`Simulation(scene).ac_sweep(freqs, input_source=..., probes=[...])`
  - Descriptor：`DescriptorModel.from_scene(scene).frequency_response(freqs, input_source=..., probes=[...])`
- 频率网格：本矩阵用 `[10, 100, 1000, 10000, 100000]` Hz（严格递增、有限、>0，满足 `solver.py:988` 校验）。统一测试阶段的建议网格见 `P1-R2_CONVERGENCE_PLAN §3`（1e1–1e6 对数 + 谐振点加密），本文件 5 点只作当前对拍基线。
- 比较口径：**复数频响** `complex(real, imag)` 逐点比较，**不是**只比幅值/相位曲线。定义：
  - `max_abs = max(|Δ_i|)`，`Δ_i = Z_desc_i − Z_legacy_i`；
  - `scale = max(|Z_legacy_i|)`（该场景全频段参考峰值，`ref=Legacy`）；
  - `max_rel = max_abs / max(scale, 1e-12)`。
  - 采用**场景峰值归一**而非逐点 `|Δ_i|/max(|ref_i|,1e-30)`：后者在参考值过零/近零的频点会被放大成伪失败，不能反映整体复频响误差。
- 判据：`max_abs <= 1e-12` **且** `max_rel <= 1e-9` 记为 `MATCH`；否则 `DIVERGE`。两个条件同时成立才通过（“且”，不是“或”）。该门限与 `P1-R2_CONVERGENCE_PLAN §3` 一致。
- 探针：节点名（节点电压）或元件名（元件电流），两后端同一 token。
- 对拍脚本（**已纳入仓库，本文统一使用的入口**）：`tools/p1r2_parity_harness.py`（只读，无本机绝对路径）。仓库中另有一个并发会话提交的 `tools/p1r2_parity_probe.py`（早期 scratch 迁移，缺 switch/病态/性能全集），**已不作为对拍入口**，统一测试以 harness 为准。复现：

```bash
cd NetlabHome
PYTHONIOENCODING=utf-8 python tools/p1r2_parity_harness.py --repeats 20
# 机器可读： --json --json-out <path>；快速跳过性能： --quick
```

- 数据来源：下表是一次真实运行的**代表值**（2026-11-13，本机）。不同运行的末位可能在 1e-16 量级浮动；`0` 表示两后端结果逐位相等。

## 3. 结果矩阵

| # | code | 场景 / 拓扑 | 关键参数 | 激励 / input_source | 探针 | Legacy | Descriptor | max_abs | max_rel | 判定 |
|---|------|-------------|----------|---------------------|------|--------|-----------|---------|---------|------|
| 1 | T01 | RC 低通 | V–R(1k)–C(1µ) | 1V / V1 | out | ok | ok | 0 | 0 | **MATCH** |
| 2 | T02 | RC 高通 | V–C(1µ)–R(1k) | 1V / V1 | out | ok | ok | 0 | 0 | **MATCH** |
| 3 | T03 | RL 低通 | V–R(1k)–L(1m) | 1V / V1 | out | ok | ok | 7.85e-17 | 1.48e-16 | **MATCH** |
| 4 | T04 | RLC 串联谐振 | V–R(1k)–L(1m)–C(1µ) | 1V / V1 | out | ok | ok | 5.93e-17 | 2.84e-16 | **MATCH** |
| 5 | T05 | VCVS 受控源 | V–E1(gain=2)–RL(1k) | 1V / V1 | a, out | ok | ok | 0 | 0 | **MATCH** |
| 6 | T06 | VCCS 受控源 | V–G1(gm=2mS)–RL(1k) | 1V / V1 | a, out | ok | ok | 0 | 0 | **MATCH** |
| 7 | T07 | 多独立源（V1 激励，V2/I1 置零） | V1,V2(0.5)+R1/R2/R3 | 1V / V1 | out | ok | ok | 0 | 0 | **MATCH** |
| 8 | T08 | 多探针（节点 + 元件电流） | RC 低通 | 1V / V1 | out, R1, C1, V1 | ok | ok | 8.67e-19 | 4.07e-17 | **MATCH** |
| 9 | T09 | 浮置与接地节点 | 悬空支路节点 a/b + 接地节点 | 1V / V1 | a, b | ok | ok | 0 | 0 | **MATCH** |
| 10 | T10 | **病态（ill-conditioned，非奇异）** | 6 级 R 交替 1e-6/1e6 + C；`cond(A)≈1.49e13` | 1V / V1 | n5 | ok | ok | 0 | 0 | **MATCH** |
| 11 | T11 | **奇异（singular）** | V1‖V2 两个理想电压源并联；`rank(A)=2<3` | 1V / V1 | — | **ComputeError** | **LinAlgError** | — | — | **DIVERGE（失败行为）** |
| 12 | T12 | 电流源激励 | I1(1A)–R(1k) | 1A / I1 | inn | ok | ok | 0 | 0 | **MATCH** |
| 13 | T13 | switch 闭合（节点电压） | V–SW(closed, ron=1mΩ)–R(1k) | 1V / V1 | out | ok | ok | 0 | 0 | **MATCH** |
| 14 | T14 | switch 断开（节点电压） | V–SW(open, roff=1GΩ)–R(1k) | 1V / V1 | out | ok | ok | 0 | 0 | **MATCH** |
| 15 | C15 | opamp 非线性（控制项） | V–opamp(vp=vin, vn=out, gain=1e5) | 1V / V1 | — | **ComputeError** | **ComputeError** | — | — | **双方拒绝（消息不同）** |
| — | — | state_invariance | RC 低通连续两次调用 | — | out | 两次全等 | 两次全等 | — | — | **MATCH** |

**统计（逐行核对，不虚报）**

- 数值/行为场景共 **15** 个（T01–T14 + C15），另有 1 项状态不变性复核。
- `MATCH = 13/15`：T01–T10（10 个）+ T12–T14（3 个）。
- `DIVERGE = 1/15`：T11（双方均失败，但异常类型/契约不同）。
- `双方拒绝 = 1/15`：C15（opamp，消息不同）。
- 共同支持域内最大误差：`max_abs = 5.93e-17`（T04）、`max_rel = 2.84e-16`（T04），即 **≤ 2.9e-16**。

### 3.1 映射到 m00267 要求的 12 类（严格逐类）

| 要求类别 | 覆盖场景 | 说明 |
|---|---|---|
| RC | T01 / T02 | 低通、高通 |
| RL | T03 | 一阶 RL |
| RLC | T04 | 串联谐振 |
| 受控源 | T05 / T06 | VCVS、VCCS |
| 多独立源 | T07 | 非输入源置零 |
| 浮置与接地 | T09 | 悬空支路 + 接地节点 |
| 病态与奇异 | **T10（病态）/ T11（奇异）** | 两类分开实测，不再合并成一条 |
| 多探针 | T08 | 节点电压 + 3 类元件电流 |
| 源归一化 | T07 / T12 | 多源置零、1A 电流源单位激励 |
| 状态不变性 | state_invariance 行 | 两后端各自连续两次结果全等 |
| 复数误差 | 全表数值行 | **度量口径**（§2），不是拓扑类 |
| 性能 | §4 | **非功能项**，不是拓扑类 |

> 开关 switch 是用户要求补充的**增强场景**（T13 闭合 / T14 断开），不属于上述 12 类之一；它按 conductance 参与 MNA，两后端节点电压实测一致。

### 3.2 补充能力检查：switch 元件电流探针（S16）

- 同一 switch 电路把探针从节点 `out` 改为元件 `S1`：
  - Legacy：`ComputeError: AC 探针 'S1' 的电流暂不支持`（Legacy 的元件电流探针有 kind 白名单，switch 不在内）；
  - Descriptor：正常返回，`magnitude ≈ 9.99999e-4`（5 个频点一致）。
- 这是**真实能力差异**（Legacy 缺 switch 电流探针），不是数值误差；单列为 `S16`，不计入 15 个数值场景的 MATCH 统计。统一后端时必须收敛该探针契约（见 CONVERGENCE_PLAN §2）。

## 4. 性能观测（方法重评：冷启动 / 首调 / 稳态分离）

- 方法：`tools/p1r2_parity_harness.py` 端到端 API 调用（含 Scene/模型构建），5 频点；**先 3 次预热，再重复 20 次取中位数**；同进程冷/热与**全新进程**冷启动分开记录。下表为多次运行的区间 + 本次代表值。
- 关键区分（旧文档曾混用，现纠正）：
  1. **进程导入 `netlab`**：约 **0.22–0.34 s**；
  2. **import 完成后 Legacy 首次 `ac_sweep`**：约 **0.40–0.71 s**——耗时来自 scipy 稀疏模块的**懒加载**，**不含** import；旧文“首调约 361 ms（预热）”把这段误称为 import/预热，口径错误；
  3. **Descriptor 首次 `frequency_response`（新进程）**：约 **1.3–1.5 ms**；
  4. **同进程已 import 后的首次调用**：Legacy 0.48–0.51 ms / Descriptor 0.22–0.31 ms。
- 预热后稳态（本环境）：

| 电路 | Legacy 中位 | Descriptor 中位 | 比值 |
|---|---|---|---|
| 小电路（3 节点 RC 低通） | 0.35–0.38 ms | 0.11–0.13 ms | **2.8–3.2×**（本次 2.81×） |
| 大电路（180 段 RC 梯形） | 8.0–11.2 ms | 5.4–7.1 ms | **1.2–1.6×**（本次 1.17×，随机器负载波动） |

- 结论：
  - 旧文“**3–4× 快**”只在“小电路 + 冷/热混合”时出现，**不能作为稳态结论**；
  - 按冷/热分离后：**小电路约 2.8–3.2×，大电路约 1.2–1.6×**，优势随规模显著收窄；
  - “首调 361 ms”若计入，会得到数百倍的虚假优势（它主要是 scipy 懒加载的一次性成本），**不代表每次调用成本**；
  - 性能不构成 canonical 选型的主依据（canonical 侧可优化，见 CONVERGENCE_PLAN §4）。

## 5. 关键结论

1. **共同支持域内，两后端达到机器精度一致**：**13 个 `MATCH` / 15 个场景**，最大复数误差 **≤ 2.9e-16**（T04：`max_abs=5.93e-17`、`max_rel=2.84e-16`）；T13/T14 switch 节点电压 `max_rel=0`。早期只有 `test_descriptor_rlc.py:174` 单一 RC 低通/4 频点，不足以支撑“完整等价”，本矩阵扩展到 15 个场景 + 状态不变性复核。
2. **唯一的数值性分歧是失败行为，不是结果**：T11 病态边界（两理想压源并联）下，Legacy 抛结构化 `ComputeError`（“电路矩阵奇异（零主元）：支路 'V2'；请检查悬空节点、缺少直流通路或重复接地的元件”），Descriptor 直接泄漏 scipy `LinAlgError: Singular matrix`，无统一 schema、无支路定位。→ 统一方案必须收敛错误语义。
3. **不支持元件两后端均拒绝，但文案不一致**：C15 opamp，Legacy 报“AC 分析暂不支持元件 'E1'（opamp）：小信号只对线性元件与受控源线性化…”，Descriptor 报“Descriptor 模型不支持非线性元件 'E1'（opamp）：请先线性化或改用瞬态分析”。→ 需统一错误码/措辞。
4. **switch 拓扑本身已等价，但 switch 元件电流探针能力不等价**：T13/T14 节点电压 `max_rel=0`；S16 中 Legacy 拒绝 switch 电流探针、Descriptor 可返回。→ 统一时必须收敛探针契约。
5. **E 矩阵结构性奇异是常态，不是病理**：T01（RC）`size=3, rank(E)=1`；T03 `size=4, rank(E)=1`；T04 `size=4, rank(E)=2`；T12（纯电流源+R）`size=1, rank(E)=0`；补充的 3 节点纯电阻电路 `rank(E)=0, rank(A)=3, cond(A)=5e2` 仍可解。真正奇异的是 `A+jωE`（T11 `rank(A)=2<3, cond(A)=1.37e32`）。详见 `P1-R2_BACKEND_CONSTRAINTS §3`。

## 6. 证据与复现

- 工作树：`NetlabHome/`，git main HEAD `8f9344f`。
- 脚本：`NetlabHome/tools/p1r2_parity_harness.py`。
  - 人类可读表：`cd NetlabHome && PYTHONIOENCODING=utf-8 python tools/p1r2_parity_harness.py`
  - JSON：追加 `--json --json-out <path>`；只做数值对拍：`--quick`。
- 脚本只读调用生产 API，不修改 `solver.py`/`descriptor.py`，也不写入仓库运行产物。

## 7. 修订记录

- 2026-11-12：初版矩阵（11 个编号场景 + state_invariance），口径为逐点 `max_rel`，曾误报“12 类/12 MATCH”。
- 2026-11-13（C 块整改）：
  - 场景由 14 个重排为 **15 个（T01–T14 + C15）**：新增独立 T10 病态（非奇异）、T11 奇异，switch 拆为 T13/T14，opamp 为 C15；补 state_invariance 与 S16 switch 电流探针专项。
  - **MATCH 由 12 纠正为 13**（T01–T10、T12–T14）；总数 15，T11 DIVERGE、C15 双方拒绝。
  - 最大误差由旧 `3.37e-14` 纠正为 **≤2.9e-16**；T03/T04 旧数字为旧场景参数，已按当前 harness 更新。
  - 判据定义改为**场景峰值归一**的 `max_abs/max(scale,1e-12)`，并明确 `max_abs<=1e-12 且 max_rel<=1e-9`。
  - 对拍入口统一为 `tools/p1r2_parity_harness.py`；`tools/p1r2_parity_probe.py` 仅为早期 scratch 迁移（无 switch/病态/性能全集），不再作为入口（文件由并发会话提交，本轮未删除）。
  - §4 性能按“进程导入/首调/稳态”分离重写，删除“首调 361 ms 含 import”“3–4×”的错误口径。
