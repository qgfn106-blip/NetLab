# P1-R2 收敛方案（准入与提案，只读）

> 任务来源：m00267。性质：**只读设计**。本文件只给"准入条件 + 统一实现提案 + 风险/验证计划"，**不修改生产代码**、不统一、不删除 Legacy。
> 前置：`P1-R2_PARITY_MATRIX.md`（实测矩阵）、`P1-R2_BACKEND_CONSTRAINTS.md`（约束表）。
> 日期：2026-11-12。

## 1. 准入闸门（Gate）与当前是否满足

m00267 规定：只有完成 parity matrix 与后端约束表后，才能进入等价性测试设计；只有明确共同支持范围、误差容限与不等价情况后，才能提出统一实现方案。

| 闸门 | 状态 | 依据 |
|------|------|------|
| G1 完成 parity matrix（≥12 拓扑，复数域比较，含失败行为/性能） | **已满足** | PARITY_MATRIX §3 全表 |
| G2 完成后端约束表（逐项 12 维度 + Descriptor 奇异 E 专项） | **已满足** | BACKEND_CONSTRAINTS §2/§3 |
| G3 明确共同支持范围 | **已满足** | `{R,C,L,V,I,VCVS,VCCS}` + 多源 + 悬空 + 元件电流探针（见 §3） |
| G4 明确误差容限 | **建议值见 §3**（待统一阶段确认） | 实测 ≤3.4e-14 |
| G5 明确不等价情况 | **已列 3 处**（见 §2） | 奇异错误语义 / 不支持元件文案 / switch 待验证 |

结论：G1–G3、G5 已具备；G4 需在等价性测试设计中正式落为门限。据此可进入"等价性测试设计 → 统一提案"，但**实现仍需单独授权**。

## 2. 已确认的不等价区（统一必须处理）

1. **奇异/病态错误契约不等价（必修）**
   - 现状：Legacy `ComputeError("电路矩阵奇异（零主元）：支路 'V2'；请检查悬空节点、缺少直流通路或重复接地的元件")`；Descriptor 直接泄漏 `LinAlgError: Singular matrix`。
   - 统一要求：Descriptor 侧把 `scipy.linalg.LinAlgError` / `LinAlgWarning` 转译为 `ComputeError`，附一致的定位信息（节点/支路），错误码与 Legacy 同构。
2. **不支持元件拒绝文案不等价（应修）**
   - opamp：Legacy "AC 分析暂不支持元件 'E1'（opamp）：小信号只对线性元件与受控源线性化…"；Descriptor "Descriptor 模型不支持非线性元件 'E1'（opamp）：请先线性化…"。
   - 统一要求：共同错误码/措辞（可保留后端细节，但对外 schema 与 code 一致）。
3. **`switch` 元件覆盖未对齐（待验证）**
   - Legacy `AC_KINDS` 含 `switch`，Descriptor 本轮未构建 switch 场景（缺参数契约证据）。统一前必须补 switch 的 AC 等价证据，或显式声明 Descriptor 不支持并统一拒绝。

## 3. 共同支持范围与建议误差容限（提案）

- 共同支持域（已实测等价）：R、C、L、vsource、isource、VCVS、VCCS；多独立源（非输入源置零）；悬空（dangling）节点；节点电压探针 + 元件电流探针。
- 建议等价门限：`max_rel(complex) < 1e-9` 且 `max_abs < 1e-12`（当前实测 ≤3.4e-14，留 4–5 个数量级余量，兼顾不同拓扑规模）。最终门限由等价性测试设计确认。
- 频率网格：覆盖 1e1–1e6 Hz 对数采样，并强制包含 RLC 谐振点附近加密点，避免"只测平坦段"。

## 4. 统一实现方案（提案，不在本轮实施）

> 目标：在**不回归数值结果**、**保持 API 兼容**、**性能不明显退化**的前提下，收敛 AC/Bode 两后端。

**方案（推荐：适配器 + 保留双引擎，先收敛错误契约，再评估合并）**

- **Step A —— 错误契约统一层（低风险，先行）**：新增内部适配器（例如 `ac_backend_adapter`），对外统一 `ac_analysis(scene, freqs, input_source, probes)`：
  - 捕获 Descriptor 的 `LinAlgError/LinAlgWarning` → 抛同构 `ComputeError`；
  - 统一不支持元件（opamp/二极管/…）的错误 code 与措辞；
  - 统一返回 dict 形状（`frequencies / probes{real,imag,magnitude,phase_deg,db}`，可选 `operating_point`）。
- **Step B —— 后端选择策略**：短期保留两引擎。适配器按电路特征选择（如：需要支路电流/opamp 建模或用大规模稀疏时走 Descriptor；其余走 Legacy），两引擎均经 Step A 的契约层，保证对外一致。
- **Step C —— 合并评估（高门槛，另行授权）**：只有在 Step A/B 稳定、且等价性测试全绿后，才评估"单一引擎"是否可行：
  - 可共用部分：R/C/L/独立源/VCVS/VCCS 的交流 stamp 语义（约束表 §2 已证明两后端一致）；可抽公共"AC stamp 原语"。
  - 必须保留的后端逻辑：Legacy 的 MNA 支路/瞬态历史耦合；Descriptor 的状态空间/极点零点/大规模稀疏能力——不能为合并牺牲各自独有能力。
  - API 兼容：`Scene.ac_sweep` / `Simulation(...).ac_sweep` / `DescriptorModel.frequency_response` 三个既有入口签名不得破坏；适配器层新增而非替换。
  - 避免数值回归：以 PARITY_MATRIX 全场景为回归基线，逐场景 `max_rel` 门限卡死。
  - 性能不退化：以 §4 PARITY_MATRIX 计时为基线，设定"不劣于基线 1.5×"门槛（大规模另测）。

**明确不在本轮做**：任何 `solver.py`/`descriptor.py` 修改、任何删除 Legacy、任何入口签名变更。

## 5. 风险与验证计划

| 风险 | 缓解 |
|------|------|
| Descriptor 错误包装改变既有调用方对 `LinAlgError` 的捕获 | 统一阶段先检索全仓 `except LinAlgError` 用法；适配器对外只抛 `ComputeError`，内部保留底层异常链（`raise ... from e`） |
| 后端选择策略引入"同输入不同后端→微差结果" | 选择策略确定化（按拓扑特征，非随机）；等价门限 1e-9 兜底 |
| switch / 大规模未覆盖 | 明确列入待验证清单，统一前补齐或显式拒绝 |
| 性能回退 | 基准门限 + 大规模另测 |

**等价性测试设计（下一步，非本轮）**：把本矩阵 12 场景固化为 `tests/test_p1r2_ac_parity.py`（参数化，复数域断言），并补 switch 与 1e1–1e6 对数频点 + 谐振加密；失败行为用例断言"两后端同为 `ComputeError` 且 code 一致"。

## 6. 交付边界声明

本文件与 PARITY_MATRIX、BACKEND_CONSTRAINTS 均为**只读审计产物**：允许新增文档，未改变任何生产计算行为。统一实现（Step A/B/C）需用户在阶段 6 后续明确授权后方可动生产代码。
