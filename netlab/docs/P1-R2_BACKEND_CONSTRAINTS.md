# P1-R2 双后端约束表（只读审计）

> 任务来源：m00267。性质：**只读审计**，不改生产代码。
> 配套文件：`P1-R2_PARITY_MATRIX.md`（实测矩阵）、`P1-R2_CONVERGENCE_PLAN.md`（统一方案准入与提案）。
> 日期：2026-11-12。

本文件逐项对照 Legacy MNA 后端（`CircuitSolver.ac_sweep`）与 Descriptor 状态空间后端（`DescriptorModel.frequency_response`）的能力边界、数值与错误处理差异，作为阶段 6 后续"等价性测试设计 → 统一方案"的准入依据。

## 1. 代码锚点

| 维度 | Legacy | Descriptor |
|------|--------|-----------|
| 入口 | `netlab/core/compute/circuit/solver.py:969 ac_sweep(self, frequencies, *, input_source=None, probes=None)` | `netlab/core/compute/circuit/descriptor.py:823 frequency_response(self, frequencies, *, input_source=None, probes=None)` |
| 支持 kinds 白名单 | `solver.py:890-901 AC_KINDS = {resistor, capacitor, inductor, vsource, isource, vcvs, vccs, switch}` | 无显式白名单；`descriptor.py:175-180` 显式识别 inductor/vsource/vcvs，其余走通用元件 stamp；opamp 视为非线性 |
| 未知量 | 节点电压（MNA，纯节点索引） | 节点电压 + 支路电流（电感/电压源/VCVS/opamp 各一支路） |
| 求解 | 每个 ω 组装复 MNA 线性系统求解 | 状态空间 `build()` 一次，逐 ω `system.solve(ω)`（`descriptor.py:243`） |

## 2. 逐项约束对照

| 约束项 | Legacy MNA | Descriptor 状态空间 | 是否等价 | 证据 |
|--------|-----------|---------------------|----------|------|
| 元件支持范围 | `AC_KINDS` 白名单：R/C/L/V/I/VCVS/VCCS/switch；二极管/晶体管/数字器件**显式拒绝**（`solver.py:989-990`） | 线性 R/C/L/独立源/VCVS/VCCS 走通用 stamp；非线性（opamp 等）**拒绝**"Descriptor 模型不支持非线性元件"（descriptor.py 构造期） | 共同支持域一致；非支持元件双方均拒绝但消息不同 | #6/#12 实测 |
| 受控源支持 | VCVS（gain）、VCCS（gm）均支持（`AC_KINDS`） | 实测 VCVS、VCCS 均支持（VCVS 有专属支路电流，VCCS 走通用 stamp） | **等价** | #5/#6 MATCH |
| 浮置电路处理 | 悬空电阻可解（无电流）；真退化（并联理想压源）→ `ComputeError` 奇异 | 悬空电阻可解（结果一致）；真退化 → scipy `LinAlgError`（未包装） | 求解等价，**错误处理不等价** | #9 MATCH / #10 DIVERGE |
| 参考节点/规范自由度 | 需参考地；矩阵奇异时报"缺少直流通路/重复接地" | **必须恰好 1 个 ground**，否则 `ComputeError`（"电路需要至少一个接地节点"/"只能有一个接地节点"）；未知量=非地节点+内部节点 | 均需唯一参考；Descriptor 校验更严格且显式 | descriptor.py:112 构造期 |
| 奇异矩阵处理 | 结构化 `ComputeError`，含支路名与排查提示 | 直接抛 numpy/scipy `LinAlgError: Singular matrix`，无统一 schema | **不等价（需统一）** | #10 |
| 多源输入 | 支持 ≥1 独立源；input_source 缺省取首个 vsource/isource；被选源单位激励、**其余源置零** | 同语义：`build(input_source)` 选源，其余置零 | **等价** | #7 MATCH |
| 输出探针映射 | 节点名→节点电压；元件名→元件电流（vsource=its branch current；isource=its value；inductor=(Va−Vb)/(jωL) 等） | 同名 token；节点→节点电压；元件→支路/端口电流（vsource/VCVS/inductor=branch；isource=1.0 若为 input 否则 0；VCCS=gm·(Vca−Vcb)；switch=conductance·ΔV） | **实测等价**（含元件电流探针 #8 R1 2e-16） | #8 MATCH |
| 复数数据类型 | numpy complex128 | numpy complex128 | 等价 | 运行确认 |
| 源归一化 | 选中独立源取单位激励（1V/1A），其余置零 | 同 | **等价** | #7/#11 MATCH |
| 数值稳定性 | 每频点 MNA 直接解；病态→奇异报错 | 状态空间矩阵(solve)，病态→LinAlgError/Warning；本次 singular 触发 scipy `LinAlgWarning: Diagonal number 3 is exactly zero` | 共同支持域一致到 3.4e-14；病态边界行为不同 | 实测 |
| 运行时状态副作用 | `ac_sweep` 不改变瞬态时间轴/节点电压/历史状态（docstring 声明；state_invariance 两次全等） | `from_scene` 新建模型、`frequency_response` 不写回 solver 状态；两次全等 | **等价**（无副作用） | state_invariance |
| 性能与资源 | 每调用重建/求解 MNA；5 频点 ~0.4–0.6ms（稳态），首调 ~361ms 预热 | 每调用 build+逐频 solve；5 频点 ~0.12–0.17ms，约 3–4× 快 | 量级相近，Descriptor 更快（小规模） | §4 PARITY_MATRIX |

## 3. Descriptor 奇异 E 矩阵与代数约束（专项检查）

- Descriptor 采用 `A + sE` 形式（`descriptor.py` 状态空间构造）。E 矩阵对应储能/代数约束（电容、电感、电压源/VCVS 的理想约束支路）。当存在理想电压源并联、悬空代数约束互斥等情形时，`E`（或其组合 `A+sE`）在个别频点退化，`scipy.linalg` 直接抛 `LinAlgError: Singular matrix` 或发 `LinAlgWarning`（本次 singular 场景出现 `LinAlgWarning: Diagonal number 3 is exactly zero`）。
- 现状：Descriptor 层**未把该底层异常转译为 `ComputeError`**，也未附支路/节点定位信息；Legacy 则给出"零主元 + 支路名 + 排查提示"。这是两后端在"病态系统"上最实质的契约差异，必须在统一方案中收敛（见 CONVERGENCE_PLAN §2）。
- 代数约束处理：Descriptor 通过把电压源/VCVS/电感作为独立支路电流未知量处理理想约束；若约束冗余/互斥则系统奇异，当前无预检（如"并联理想压源"检测），仅靠求解期异常暴露。

## 4. 结论（对统一方案的输入）

1. **能力子集关系**：两后端在 `{R,C,L,V,I,VCVS,VCCS}` + 多源 + 悬空 + 元件电流探针上**数值等价**（机器精度）。Descriptor 额外可建 opamp 分母但 AC 域双方都拒绝；Legacy 有 `switch` 在 `AC_KINDS` 而 Descriptor 未在本轮覆盖 switch（列为待验证项）。
2. **必须收敛的三处不等价**：
   - (a) 奇异/病态：Descriptor 泄漏 `LinAlgError`，需包装为与 Legacy 同构的 `ComputeError`（含编号、支路、提示）。
   - (b) 不支持元件报错文案：opamp 等双方均拒但消息不同，需统一错误码/措辞。
   - (c) `switch` 在 Legacy `AC_KINDS` 内、Descriptor 未验证——列为**待验证差异**（本审计未构建 switch 场景，因缺参数契约证据，不作结论，明确标为未覆盖）。
3. **可选共享点**：两后端对 R/C/L/独立源/VCVS/VCCS 的 stamp 语义一致，是否存在可共用的"交流 stamp 原语层"需在统一方案评估（不得在本只读阶段改码）。

## 5. 未覆盖/待验证清单（诚实边界）

- `switch` 元件在 AC 域的 Descriptor 侧行为（Legacy 白名单含 switch）。
- 大规模电路（>500 网络）性能与内存门槛。
- 非线性器件的 AC 线性化工作点一致性（当前 opamp 双方均整体拒绝，未进 AC 小信号）。
- 复数探针的相位缠绕/符号约定在极端频点（本矩阵 5 频点相对误差已达 1e-14，未见异常）。
