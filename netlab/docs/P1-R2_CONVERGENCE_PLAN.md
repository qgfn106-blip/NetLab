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
| G5 明确不等价情况 | **已列 2 处**（见 §2；switch 已消解） | 奇异错误语义 / 不支持元件文案 |

结论：G1–G3、G5 已具备；G4 需在等价性测试设计中正式落为门限。据此可进入"等价性测试设计 → 统一提案"，但**实现仍需单独授权**。

## 2. 已确认的不等价区（统一必须处理）

1. **奇异/病态错误契约不等价（必修）**
   - 现状：Legacy `ComputeError("电路矩阵奇异（零主元）：支路 'V2'；请检查悬空节点、缺少直流通路或重复接地的元件")`；Descriptor 直接泄漏 `LinAlgError: Singular matrix`。
   - 统一要求：Descriptor 侧把 `scipy.linalg.LinAlgError` / `LinAlgWarning` 转译为 `ComputeError`，附一致的定位信息（节点/支路），错误码与 Legacy 同构。
2. **不支持元件拒绝文案不等价（应修）**
   - opamp：Legacy "AC 分析暂不支持元件 'E1'（opamp）：小信号只对线性元件与受控源线性化…"；Descriptor "Descriptor 模型不支持非线性元件 'E1'（opamp）：请先线性化…"。
   - 统一要求：共同错误码/措辞（可保留后端细节，但对外 schema 与 code 一致）。
3. ~~**`switch` 元件覆盖未对齐（待验证）**~~ **已消解**：switch（closed ron=1mΩ / open roff=1GΩ）两后端实测一致（PARITY #13/#14，max_rel=0；参数契约 `catalog.py:190`）。不构成不等价项。

## 3. 共同支持范围与建议误差容限（提案）

- 共同支持域（已实测等价）：R、C、L、vsource、isource、VCVS、VCCS；开关 switch（closed/ open）；多独立源（非输入源置零）；悬空（dangling）节点；节点电压探针 + 元件电流探针。
- 建议等价门限：`max_rel(complex) < 1e-9` 且 `max_abs < 1e-12`（当前实测 ≤3.4e-14，留 4–5 个数量级余量，兼顾不同拓扑规模）。最终门限由等价性测试设计确认。
- 频率网格：覆盖 1e1–1e6 Hz 对数采样，并强制包含 RLC 谐振点附近加密点，避免"只测平坦段"。

## 4. 统一实现方案（提案，不在本轮实施）

> 目标：在**不回归数值结果**、**保持 API 兼容**、**性能不明显退化**的前提下，收敛 AC/Bode 两后端。

**方案方向（依 ROADMAP P1-R2「二选一 canonical」，本文给决策矩阵与推荐；最终选择待用户拍板）**

ROADMAP `CORE_ARCHITECTURE_V2_ROADMAP.md:41` 明确要求：`ac_sweep()` 与 `frequency_response()` **二选一定为 canonical，另一个做兼容包装或删除**。据此给决策矩阵与推荐：

| 维度 | Legacy `CircuitSolver.ac_sweep()`（MNA，solver.py:969） | Descriptor `DescriptorModel.frequency_response()`（状态空间，descriptor.py:844） |
|------|------|------|
| 与 P1-R1 方向一致性 | **高**：直接建立在 `elements.py` 元件 `stamp()` 单一模型上（P1-R1 已定 elements 为唯一元件模型） | 低：`_assemble_matrices` 属 P1-R1 要收敛掉的第二套重写 |
| 共同支持域对拍（本矩阵） | 与 Descriptor 机器精度一致（12 MATCH，复数 ≤3.37e-14） | 同左 |
| 性能（本环境小电路） | 稳态中位 ~0.604 ms | ~0.288 ms（~2.1× 快） |
| 能力 | 支持 AC_KINDS（含 switch），有 R43/P3 影子路径 | 状态空间原生、大规模稀疏、极点零点潜力；opamp/非线性同样拒绝 |
| 维护成本 | 与 R1 目标合一，长期最低 | 与 R1 去重方向冲突，留作 canonical 需反向维护第二套元件重写 |

**推荐：Legacy `ac_sweep()` 定为 canonical AC/Bode 后端**（与 P1-R1「elements.py 单一元件模型」方向一致、长期维护成本最低）；`DescriptorModel.frequency_response()` 收敛为**兼容/可选状态空间路径**（需要大规模稀疏/极点零点时保留），待能力迁到 canonical 后再评估删除。2.1× 性能差可用 canonical 侧优化弥补，不作选型主依据。

- **Step A —— 错误契约统一层（低风险，先行，两路径共用）**：内部适配器 `ac_analysis(scene, freqs, input_source, probes)` 统一对外：捕获 Descriptor `LinAlgError/LinAlgWarning` → 抛同构 `ComputeError`；统一不支持元件（opamp/二极管/…）错误 code 与措辞；统一返回 dict 形状（`frequencies / probes{real,imag,magnitude,phase_deg,db}`，可选 `operating_point`）。
- **Step B —— 切 canonical + 兼容包装**：以 Legacy `ac_sweep()` 为唯一 canonical 计算路径；`DescriptorModel.frequency_response()` 转为可选兼容包装（默认转发 canonical 或仅在状态空间专属场景启用），保留 `Scene.ac_sweep` / `Simulation.ac_sweep` / `DescriptorModel.frequency_response` 既有入口签名。
- **Step C —— 迁移与回滚（需用户授权后实施）**：feature flag `ac_backend=legacy|descriptor` 保留可回切；以 PARITY_MATRIX 全场景（14 拓扑 + state_invariance）为回归门限、逐场景 `max_rel<1e-9` 卡死；性能基准（3 预热 + 30 次中位数 + 180 段网络）不低于 canonical 基线 1.5×；待 Descriptor 专属能力（大规模稀疏/极点零点）在 canonical 侧落地或确认无需后，再评估删除 Descriptor 路径。

**明确不在本轮做**：任何 `solver.py`/`descriptor.py` 修改、任何删除 Legacy/Descriptor、任何入口签名变更；canonical 最终选择需用户拍板。

## 5. 风险与验证计划

| 风险 | 缓解 |
|------|------|
| Descriptor 错误包装改变既有调用方对 `LinAlgError` 的捕获 | 统一阶段先检索全仓 `except LinAlgError` 用法；适配器对外只抛 `ComputeError`，内部保留底层异常链（`raise ... from e`） |
| 后端选择策略引入"同输入不同后端→微差结果" | 选择策略确定化（按拓扑特征，非随机）；等价门限 1e-9 兜底 |
| switch 已补测一致；大规模未覆盖 | 大规模明确列入待验证清单，统一前补齐或显式拒绝 |
| 性能回退 | 基准门限 + 大规模另测 |

**等价性测试设计（下一步，非本轮）**：把本矩阵 14 场景固化为 `tests/test_p1r2_ac_parity.py`（参数化，复数域断言；switch 已含 #13/#14），并补 1e1–1e6 对数频点 + 谐振加密；失败行为用例断言"两后端同为 `ComputeError` 且 code 一致"。

## 6. 交付边界声明

本文件与 PARITY_MATRIX、BACKEND_CONSTRAINTS 均为**只读审计产物**：允许新增文档，未改变任何生产计算行为。统一实现（Step A/B/C）需用户在阶段 6 后续明确授权后方可动生产代码。

## 7. 修订记录（2026-11-13，C 块整改）
- switch 由「待验证/不等价」改为「已消解（#13/#14 实测一致）」；不等价区由 3 处收敛为 2 处。
- 共同支持域补 switch；等价性测试固化为 14 场景。
- 未改任何生产代码。
- **§4 重写（2026-11-13）**：原「适配器+保留双引擎」与 ROADMAP:41「二选一 canonical」冲突，已改为「Legacy `ac_sweep()` 为 canonical + Descriptor 兼容路径」的决策矩阵与迁移/回滚方案（最终选择待用户拍板）。
