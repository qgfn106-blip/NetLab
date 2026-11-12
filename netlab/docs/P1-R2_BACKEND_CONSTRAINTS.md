# P1-R2 双后端约束表（只读审计）

> 任务来源：m00267。性质：**只读审计**，不改生产代码。
> 配套文件：`P1-R2_PARITY_MATRIX.md`（实测矩阵）、`P1-R2_CONVERGENCE_PLAN.md`（统一方案准入与提案）。
> 日期：2026-11-12（初版）/ 2026-11-13（C 块整改：E 矩阵数学表述与实测量化、switch/病态/奇异、性能口径）。

本文件逐项对照 Legacy MNA 后端（`CircuitSolver.ac_sweep`）与 Descriptor 状态空间后端（`DescriptorModel.frequency_response`）的能力边界、数值与错误处理差异，作为阶段 6 后续“等价性测试设计 → 统一方案”的准入依据。

## 1. 代码锚点

| 维度 | Legacy | Descriptor |
|------|--------|-----------|
| 入口 | `netlab/core/compute/circuit/solver.py:969 ac_sweep(self, frequencies, *, input_source=None, probes=None)` | `netlab/core/compute/circuit/descriptor.py:823 frequency_response(self, frequencies, *, input_source=None, probes=None)` |
| 支持 kinds 白名单 | `solver.py:890-901 AC_KINDS = {resistor, capacitor, inductor, vsource, isource, vcvs, vccs, switch}` | 无显式 AC 白名单；`descriptor.py:175-180` 显式识别 inductor/vsource/vcvs，其余支持 kind 走通用 stamp；`SUPPORTED_KINDS` 含 switch，非线性（opamp 等）构造期拒绝 |
| 未知量 | 节点电压（MNA，纯节点索引） | 节点电压 + 支路电流（电感/电压源/VCVS/opamp 各一支路） |
| 求解 | 每个 ω 组装复 MNA 线性系统求解 | 状态空间 `build()` 一次，逐 ω `system.solve(ω)`：`(A + jωE) x = b`（`descriptor.py:243`） |

## 2. 逐项约束对照（12 维度）

| # | 约束项 | Legacy MNA | Descriptor 状态空间 | 是否等价 | 证据 |
|---|--------|-----------|---------------------|----------|------|
| 1 | 元件支持范围 | `AC_KINDS` 白名单：R/C/L/V/I/VCVS/VCCS/switch；二极管/晶体管/数字器件**显式拒绝**（`solver.py:989-990`） | 线性 R/C/L/独立源/VCVS/VCCS/switch 走通用 stamp；opamp 等非线性**拒绝**“Descriptor 模型不支持非线性元件”（构造期） | 共同支持域一致；非支持元件双方均拒绝但消息不同 | T13/T14、C15 |
| 2 | 受控源支持 | VCVS（gain）、VCCS（gm）均支持（`AC_KINDS`） | VCVS、VCCS 均支持（VCVS 有专属支路电流，VCCS 走通用 stamp） | **等价** | T05/T06 MATCH |
| 3 | 浮置电路处理 | 悬空电阻可解（无电流）；真退化（并联理想压源）→ `ComputeError` 奇异 | 悬空电阻可解（结果一致）；真退化 → scipy `LinAlgError`（未包装） | 求解等价，**错误处理不等价** | T09 MATCH / T11 DIVERGE |
| 4 | 参考节点/规范自由度 | 需参考地；矩阵奇异时报“缺少直流通路/重复接地” | **必须恰好 1 个 ground**，否则 `ComputeError`（“电路需要至少一个接地节点”/“只能有一个接地节点”）；未知量=非地节点+内部节点 | 均需唯一参考；Descriptor 校验更严格且显式 | `descriptor.py:112` |
| 5 | 奇异矩阵处理 | 结构化 `ComputeError`，含支路名与排查提示 | 直接抛 `LinAlgError: Singular matrix`（scipy LU），无统一 schema、无定位 | **不等价（需统一）** | T11 |
| 6 | 多源输入 | 支持 ≥1 独立源；`input_source` 缺省取首个 vsource/isource；被选源单位激励、**其余源置零** | 同语义：`build(input_source)` 选源，其余置零 | **等价** | T07 |
| 7 | 输出探针映射 | 节点名→节点电压；元件名→元件电流（支持 R/C/L/V/I/VCVS 等线性元件；**switch 电流探针不支持**） | 同名 token；节点→节点电压；元件→支路/端口电流（vsource/VCVS/inductor=branch；isource=1.0 若为 input 否则 0；VCCS=gm·(Vca−Vcb)；**switch=conductance·ΔV**） | 节点电压与多数元件电流**实测等价**；**switch 电流探针不等价** | T08 MATCH / S16 |
| 8 | 复数数据类型 | numpy complex128 | numpy complex128 | 等价 | 运行确认 |
| 9 | 源归一化 | 选中独立源取单位激励（1V/1A），其余置零 | 同 | **等价** | T07/T12 |
| 10 | 数值稳定性/病态 | 每频点 MNA 直接解；病态矩阵仍可解，奇异时结构化报错 | 状态空间矩阵 `solve`；病态可解（T10 `cond(A)≈1.49e13`，结果 `max_abs=0`）；奇异抛 `LinAlgError`（T11；某些病态实例也可能先发 `LinAlgWarning`，但本轮 T11 实际为 `LinAlgError: Singular matrix`） | 共同支持域一致到 **≤2.9e-16**；病态边界行为不同 | T10 / T11 |
| 11 | 运行时状态副作用 | `ac_sweep` 不改变瞬态时间轴/节点电压/历史状态（docstring 声明；state_invariance 两次全等） | `from_scene` 新建模型、`frequency_response` 不写回 solver 状态；两次全等 | **等价**（无副作用） | state_invariance |
| 12 | 性能与资源 | 每调用重建/求解 MNA；5 频点稳态中位 0.35–0.38 ms（小电路）；180 段梯形 8.0–11.2 ms；**进程首次调用** 0.40–0.71 s（scipy 懒加载，不含 import 0.22–0.34 s） | 每调用 build + 逐频 solve；5 频点稳态中位 0.11–0.13 ms（小电路）、180 段梯形 5.4–7.1 ms；小电路约 2.8–3.2×、大电路约 1.2–1.6× | 量级相近，Descriptor 更快；优势随规模收窄 | PARITY §4 |

## 3. Descriptor 奇异 E 矩阵与代数约束（专项检查，数学表述已纠正）

### 3.1 频域方程与各矩阵的角色

Descriptor 在频域求解线性系统：

```
(A + jωE) x = b(ω),   s = jω
```

其中 `A`、`E` 为实数矩阵，`x` 为“节点电压 + 支路电流”未知量，`b(ω)` 由激励源与频率决定。**求解是对 `A+jωE` 做 LU/线性求解，不是对 `E` 求逆**；因此“E 是否可逆”本身不是求解前提。

### 3.2 E 结构性奇异是 DAE 的常态

`E` 只承载**动态状态**（电容节点电压、电感支路电流）：理想电压源、VCVS 等**代数约束**对应的未知量在 `E` 中贡献**整行整列为 0**，所以

```
rank(E) = 动态状态数 < n（未知量数）   —— 这是设计使然，不是病态/退化
```

实测量化（本机、当前 harness）：

| 电路 | `size` | `rank(E)` | `rank(A)` | `cond(A)` | 结果 |
|---|---:|---:|---:|---:|---|
| T01 RC 低通 | 3 | 1 | 3 | 1.0e3 | 可解，MATCH |
| T03 RL 低通 | 4 | 1 | 4 | 1.0 | 可解，MATCH |
| T04 RLC 串联 | 4 | 2 | 4 | 1.02 | 可解，MATCH |
| T05 VCVS | 5 | 2 | 5 | 5.0e3 | 可解，MATCH |
| T06 VCCS | 4 | 2 | 4 | 2.4e3 | 可解，MATCH |
| T12 电流源+R | 1 | 0 | 1 | 1.0 | 可解，MATCH |
| 纯电阻 3 节点（补充） | 3 | **0** | 3 | 5.0e2 | **可解**，`rank(E)=0` 仍 MATCH |

> **铁证**：纯电阻电路的 `E` 是零矩阵（`rank(E)=0`），系统仍能正常求解并给出与 Legacy 完全一致的频响。因此“E 退化导致 AC 失败”的说法不成立。

### 3.3 真正的奇异：`A + jωE` 秩亏

- 当拓扑存在**冗余/互斥的理想约束**时（典型：两个理想电压源并联），约束行线性相关，`A + jωE` 对**所有** ω 都秩亏。T11：`size=3, rank(A)=2<3, cond(A)=1.37e32`，两后端均失败——Legacy 抛结构化 `ComputeError`，Descriptor 抛 `LinAlgError: Singular matrix`。
- scipy 的 `LinAlgWarning: Diagonal number 3 is exactly zero` 是 **LU 分解的零主元提示**，指向的是 `A+jωE` 的消元失败，**不是 `E` 的秩退化**；T11 本轮实测直接为 `LinAlgError: Singular matrix`。
- 数学上：矩阵 pencil `(A, E)` 正则（regular）当且仅当存在 `s` 使 `A + sE` 非奇异。含冗余理想电压源约束的电路使 `A+sE` 恒奇异（非正则/约束互斥），这才是失败根因；根因在**拓扑级约束**，不是元件储能矩阵。
- 现状：Descriptor **没有**并联理想压源等冗余约束的预检，仅靠求解期异常暴露；且未把底层异常转译为 `ComputeError`，也未附支路/节点定位。Legacy 则给出“零主元 + 支路名 + 排查提示”。这是两后端在病态/奇异系统上最实质的契约差异（见 CONVERGENCE_PLAN §2）。

## 4. 结论（对统一方案的输入）

1. **能力子集关系**：两后端在 `{R,C,L,V,I,VCVS,VCCS}` + 多源 + 悬空 + 节点电压/多数元件电流探针上**数值等价**（13/15 MATCH，最大误差 ≤2.9e-16）。switch 的**节点电压**行为在 Legacy `AC_KINDS` 与 Descriptor 通用 conductance stamp 下实测一致（T13/T14，`max_rel=0`）。
2. **必须收敛的不等价，共三处**：
   - (a) **奇异/病态错误契约**：Descriptor 泄漏 `LinAlgError`，需包装为与 Legacy 同构的 `ComputeError`（含错误码、支路/节点定位、排查提示）。
   - (b) **不支持元件报错文案**：opamp 等双方均拒绝但消息/错误码不同，需统一。
   - (c) **switch 元件电流探针能力**：Legacy 报“AC 探针 'S1' 的电流暂不支持”，Descriptor 可返回；统一时须决定“Legacy 补齐探针”或“双方统一拒绝”，不能长期一侧支持一侧拒绝。
   - 说明：~~switch 拓扑未覆盖~~ **已消解**（T13/T14 已实测）；switch 的差异只在**元件电流探针**这一能力维度。
3. **可选共享点**：两后端对 R/C/L/独立源/VCVS/VCCS 的 stamp 语义一致，是否存在可共用的“交流 stamp 原语层”需在统一方案评估（不得在本只读阶段改码）。

## 5. 未覆盖/待验证清单（诚实边界）

- `switch` 元件 AC **节点电压**行为已补测（T13/T14）；**switch 元件电流探针**为已知能力差异（S16），尚未统一。
- 大规模电路（>500 网络）的性能与内存门槛（当前最大 180 段 RC 梯形）。
- 非线性器件的 AC 线性化工作点一致性（当前 opamp 双方均整体拒绝，未进 AC 小信号）。
- 复数探针的相位缠绕/符号约定在极端频点（当前 5 频点相对误差 ≤2.9e-16，未见异常）。
- 统一测试拟扩展到 1e1–1e6 对数频点 + 谐振加密（见 CONVERGENCE_PLAN §3）。

## 6. 修订记录（2026-11-13，C 块整改）

- §3 全面重写并给出数值证据：`rank(E)` 常小于 `n`（T01=1、T03=1、T04=2、T12=0；纯电阻 3 节点 `rank(E)=0` 仍可解）；明确频域解 `(A+jωE)x=b`、**不对 E 求逆**；真正奇异是 `A+jωE` 秩亏（T11 `rank(A)=2<3`，`cond(A)=1.37e32`），`LinAlgWarning: Diagonal number 3 is exactly zero` 是 LU 零主元提示，不是 E 退化。
- §2 第 10 行纠正：T11 实测为 `LinAlgError: Singular matrix`，不再写“本次触发 `LinAlgWarning: …`”；T10 病态 `cond(A)≈1.49e13` 仍 `max_abs=0`。
- §2 第 12 行性能口径重写：区分进程导入（0.22–0.34 s）、Legacy 首次调用（0.40–0.71 s，scipy 懒加载）、稳态（小 0.35–0.38 vs 0.11–0.13 ms，2.8–3.2×；大 8.0–11.2 vs 5.4–7.1 ms，1.2–1.6×）。旧“0.604/0.288 ms，2.1×”仅旧场景代表值，已更新。
- §4 结论从“两处不等价”改为**三处**：新增 switch 元件电流探针能力差异；switch 拓扑本身已消解。
- 未改任何生产代码。
