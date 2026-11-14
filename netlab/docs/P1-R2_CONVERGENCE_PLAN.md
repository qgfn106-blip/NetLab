# P1-R2 收敛方案（准入与提案，只读）

> 任务来源：m00267。性质：**只读设计**。本文件只给“准入条件 + 统一实现提案 + 风险/验证计划”，**不修改生产代码**、不统一、不删除 Legacy。
> 前置：实测矩阵与后端约束表原为 `P1-R2_PARITY_MATRIX.md` / `P1-R2_BACKEND_CONSTRAINTS.md`（两份只读报告已于 2026-11-14 按 `DOCS_INDEX.md` 规则 7 删除，原文见 git 历史）；其 15 场景结论已并入 `netlab/tests/test_p1r2_ac_parity.py` 与 `PROGRESS.md §7.169`。
> 日期：2026-11-12（初版）/ 2026-11-13（C 块整改：按 ROADMAP 对齐终态、更新实测数字与场景计数）。

## 1. 准入闸门（Gate）与当前是否满足

m00267 规定：只有完成 parity matrix 与后端约束表后，才能进入等价性测试设计；只有明确共同支持范围、误差容限与不等价情况后，才能提出统一实现方案。

| 闸门 | 状态 | 依据 |
|------|------|------|
| G1 完成 parity matrix（≥12 拓扑类，复数域比较，含失败行为/性能） | **已满足** | PARITY_MATRIX §3：**12 类要求全覆盖 + switch 增强，共 15 个数值/行为场景（T01–T14 + C15）+ state_invariance** |
| G2 完成后端约束表（逐项 12 维度 + Descriptor 奇异 E 专项） | **已满足** | BACKEND_CONSTRAINTS §2（12 维度）/§3（E 矩阵专项，含量化证据） |
| G3 明确共同支持范围 | **已满足** | `{R,C,L,V,I,VCVS,VCCS}` + switch（节点电压）+ 多源 + 悬空 + 节点电压/多数元件电流探针（见 §3） |
| G4 明确误差容限 | **建议值见 §3**（待统一阶段确认） | 实测 **≤2.9e-16**（T04 `max_abs=5.93e-17 / max_rel=2.84e-16`） |
| G5 明确不等价情况 | **已列 3 处**（见 §2） | 奇异错误语义 / 不支持元件文案 / switch 元件电流探针能力 |

结论：G1–G3、G5 已具备；G4 需在等价性测试设计中正式落为门限。据此可进入“等价性测试设计 → 统一提案”，但**实现仍需单独授权**。

## 2. 已确认的不等价区（统一必须处理）

1. **奇异/病态错误契约不等价（必修）**
   - 现状：T11（两理想压源并联）Legacy `ComputeError("电路矩阵奇异（零主元）：支路 'V2'；请检查悬空节点、缺少直流通路或重复接地的元件")`；Descriptor 直接泄漏 `LinAlgError: Singular matrix`。
   - 统一要求：Descriptor 侧把 `scipy.linalg.LinAlgError` / `LinAlgWarning` 转译为 `ComputeError`，附一致的定位信息（节点/支路），错误码与 Legacy 同构。
2. **不支持元件拒绝文案不等价（应修）**
   - opamp（C15）：Legacy “AC 分析暂不支持元件 'E1'（opamp）：小信号只对线性元件与受控源线性化…”；Descriptor “Descriptor 模型不支持非线性元件 'E1'（opamp）：请先线性化…”。
   - 统一要求：共同错误码/措辞（可保留后端细节，但对外 schema 与 code 一致）。
3. ~~**`switch` 元件拓扑覆盖未对齐（待验证）**~~ **已消解**：switch（closed ron=1mΩ / open roff=1GΩ）两后端节点电压实测一致（PARITY T13/T14，`max_rel=0`；参数契约 `catalog.py:190`）。不构成拓扑/数值不等价项。
4. **`switch` 元件电流探针能力不等价（新确认，必修或明确拒绝）**
   - 现状（PARITY S16）：同一 switch 电路，Legacy `ac_sweep` 对探针 `S1` 报 `ComputeError: AC 探针 'S1' 的电流暂不支持`；Descriptor `frequency_response` 正常返回该电流（`magnitude≈9.99999e-4`）。
   - 统一要求：二选一并写入契约——(a) Legacy 侧补齐 switch 元件电流探针；或 (b) 两后端统一声明“switch 电流探针不支持”。不得长期“一侧支持、一侧拒绝”。

## 3. 共同支持范围与建议误差容限（提案）

- 共同支持域（已实测等价）：R、C、L、vsource、isource、VCVS、VCCS；switch **节点电压**（closed/open）；多独立源（非输入源置零）；悬空（dangling）节点；节点电压探针 + **多数**元件电流探针。
  - 例外：switch **元件电流探针**目前仅 Descriptor 支持，Legacy 拒绝（见 §2 第 4 条），不计入“共同支持域”。
- 建议等价门限：`max_abs(complex) <= 1e-12` **且** `max_rel(complex) <= 1e-9`。其中
  - `max_abs = max_i |Δ_i|`；
  - `max_rel = max_abs / max(max_i |ref_i|, 1e-12)`（**场景峰值归一**，避免参考值近零频点放大伪误差；不是逐点 `|Δ_i|/max(|ref_i|,1e-30)`）；
  - `ref = Legacy`。
  - 当前实测最大 `2.84e-16`，相对 `1e-9` 留约 **6–7 个数量级**余量，兼顾不同拓扑规模。
- 频率网格：统一测试建议覆盖 **1e1–1e6 Hz 对数采样**，并强制包含 RLC 谐振点附近加密点，避免“只测平坦段”。当前基线矩阵仅用 `[10,100,1000,10000,100000]` Hz（1e1–1e5），是**初步对拍**，统一测试须扩展。

## 4. 统一实现方案（提案，不在本轮实施）

> 目标：在**不回归数值结果**、**保持 API 兼容**、**性能不明显退化**的前提下，收敛 AC/Bode 两后端。

**方案方向（依 ROADMAP P1-R2「二选一 canonical」，本文给决策矩阵与推荐；最终选择待用户拍板）**

ROADMAP `CORE_ARCHITECTURE_V2_ROADMAP.md:41` 明确要求：`ac_sweep()` 与 `frequency_response()` **二选一定为 canonical，另一个做兼容包装或删除**。据此给决策矩阵与推荐（**本文终态即“单 canonical”，不把“双引擎+适配器”作为终态**）：

| 维度 | Legacy `CircuitSolver.ac_sweep()`（MNA，`solver.py:969`） | Descriptor `DescriptorModel.frequency_response()`（状态空间，`descriptor.py:823`） |
|------|------|------|
| 与 P1-R1 方向一致性 | **高**：直接建立在 `elements.py` 元件 `stamp()` 单一模型上（P1-R1 已定 elements 为唯一元件模型） | 低：`_assemble_matrices` 属 P1-R1 要收敛掉的第二套重写 |
| 共同支持域对拍（本矩阵） | 与 Descriptor 机器精度一致（**13 MATCH / 15 场景**，`max_abs≤5.93e-17`、`max_rel≤2.84e-16`） | 同左 |
| 性能（预热稳态，5 频点） | 小电路 0.35–0.38 ms；180 段梯形 8.0–11.2 ms | 小电路 0.11–0.13 ms（**2.8–3.2×**）；180 段梯形 5.4–7.1 ms（**1.2–1.6×**） |
| 能力 | 支持 AC_KINDS（含 switch 节点电压）；**switch 元件电流探针不支持**；有 R43/P3 影子路径 | 状态空间原生、大规模稀疏、极点零点潜力；**switch 元件电流探针支持**；opamp/非线性同样拒绝 |
| 维护成本 | 与 R1 目标合一，长期最低 | 与 R1 去重方向冲突，留作 canonical 需反向维护第二套元件重写 |

**推荐：Legacy `ac_sweep()` 定为 canonical AC/Bode 后端**（与 P1-R1「elements.py 单一元件模型」方向一致、长期维护成本最低）；`DescriptorModel.frequency_response()` 收敛为**兼容/可选状态空间路径**（需要大规模稀疏/极点零点时保留），待能力迁到 canonical 后再评估**删除**。性能差距：小电路 2.8–3.2× 可用 canonical 侧优化弥补；大电路仅 1.2–1.6×，不构成 Descriptor 的决定性优势。**性能不作选型主依据。**

> 对齐说明（2026-11-13）：本节初版曾推荐“适配器 + 保留双引擎，再评估合并”，与 ROADMAP:41 的“二选一 canonical，另一个兼容包装或删除”不一致。现已按 ROADMAP 更正：**终态必须是单 canonical**；“适配器 / 双引擎并行”只能作为迁移期的过渡态（Step A），不得作为终态。ROADMAP 中 `descriptor.py:844` 的引用是笔误（函数定义在 **823** 行，844 为 docstring 区），本文件按 823 行引用；ROADMAP 本身不在本轮允许改动范围，建议后续单独更正。

- **Step A —— 错误/探针契约统一层（低风险，先行，两路径共用）**：内部适配器 `ac_analysis(scene, freqs, input_source, probes)` 统一对外：
  - 捕获 Descriptor `LinAlgError/LinAlgWarning` → 抛同构 `ComputeError`（含错误码、支路/节点定位）；
  - 统一不支持元件（opamp/二极管/…）错误 code 与措辞；
  - 统一 switch 元件电流探针契约（Legacy 补齐或两后端统一拒绝）；
  - 统一返回 dict 形状（`frequencies / probes{real,imag,magnitude,phase_deg,db}`，可选 `operating_point`）。
- **Step B —— 切 canonical + 兼容包装**：以 Legacy `ac_sweep()` 为唯一 canonical 计算路径；`DescriptorModel.frequency_response()` 转为可选兼容包装（默认转发 canonical 或仅在状态空间专属场景启用），保留 `Scene.ac_sweep` / `Simulation.ac_sweep` / `DescriptorModel.frequency_response` 既有入口签名。
- **Step C —— 迁移与回滚（需用户授权后实施）**：feature flag `ac_backend=legacy|descriptor` 保留可回切；以 PARITY_MATRIX 全场景（**15 个数值/行为场景 + state_invariance + S16 探针能力项**）为回归门限，逐场景 `max_abs<=1e-12 且 max_rel<=1e-9` 卡死；性能基准（3 次预热 + 30 次中位数；小 RC 低通 + 180 段梯形）不低于 canonical 基线 1.5×；待 Descriptor 专属能力（大规模稀疏/极点零点）在 canonical 侧落地或确认无需后，再评估删除 Descriptor 路径。

**明确不在本轮做**：任何 `solver.py`/`descriptor.py` 修改、任何删除 Legacy/Descriptor、任何入口签名变更；canonical 最终选择需用户拍板。

## 5. 风险与验证计划

| 风险 | 缓解 |
|------|------|
| Descriptor 错误包装改变既有调用方对 `LinAlgError` 的捕获 | 统一阶段先检索全仓 `except LinAlgError` 用法；适配器对外只抛 `ComputeError`，内部保留底层异常链（`raise ... from e`） |
| 后端选择策略引入“同输入不同后端→微差结果” | 选择策略确定化（按拓扑特征，非随机）；等价门限 1e-9 兜底 |
| switch 节点电压已补测一致；switch 元件电流探针仍一侧支持一侧拒绝 | 在 Step A 明确契约：Legacy 补齐探针，或两后端统一拒绝；并加入 S16 回归断言 |
| 大规模未覆盖（>500 网络） | 明确列入待验证清单，统一前补齐或显式拒绝 |
| 性能回退 | 基准门限（3 预热 + 30 中位数）+ 小/大电路分测；性能不作选型主依据 |

**等价性测试设计（下一步，非本轮）**：把本矩阵 **15 个场景（T01–T14 + C15）+ state_invariance + S16 switch 电流探针能力项**固化为 `tests/test_p1r2_ac_parity.py`（参数化，复数域断言；switch 已含 T13/T14），并补 1e1–1e6 对数频点 + 谐振加密；失败行为用例断言“两后端同为 `ComputeError` 且 code 一致”。

## 6. 交付边界声明

本文件与 PARITY_MATRIX、BACKEND_CONSTRAINTS 均为**只读审计产物**：允许新增文档，未改变任何生产计算行为。统一实现（Step A/B/C）需用户在阶段 6 后续明确授权后方可动生产代码。

## 7. 修订记录（2026-11-13，C 块整改）

- G1/G4/G5 与 §2/§3 更新：场景数 **15（T01–T14 + C15）+ state_invariance**；实测最大误差由旧 `3.4e-14` / `3.37e-14` 纠正为 **≤2.9e-16**；`max_rel` 明确定义为**场景峰值归一**。
- switch 拓扑差异已消解（T13/T14）；新增 **switch 元件电流探针能力差异（S16）** 为第 3 处必须收敛的不等价。
- §4 决策矩阵性能更新：小电路 0.35–0.38 vs 0.11–0.13 ms（2.8–3.2×）；180 段梯形 8.0–11.2 vs 5.4–7.1 ms（1.2–1.6×）；删除旧“0.604/0.288 ms、2.1×”与“3–4×”口径。
- §4 与 `CORE_ARCHITECTURE_V2_ROADMAP.md:41` 对齐并注明：终态为“二选一 canonical，另一个兼容包装或删除”；“适配器+保留双引擎”仅作迁移过渡，不得作终态；`descriptor.py:823` 为函数定义行（ROADMAP 写的 844 是 docstring 区笔误，未改 ROADMAP）。
- Step C 回归门限由 14 场景改为 **15 场景 + state_invariance + S16**；性能基准改为 3 预热 + 30 次中位数。
- 未改任何生产代码。
