# P1-R2 交流/Bode 双后端一致性矩阵（只读审计）

> 任务来源：m00267《NetLab 阶段6 P1-R2 审计与 P0-2 Schema 决策》。
> 性质：**只读审计**。本轮不修改 `solver.py` / `descriptor.py`，不统一生产代码，不删除 Legacy 实现。
> 日期：2026-11-12。证据全部来自当前工作树实际运行（HEAD 基线见文末）。

## 1. 目的与范围

阶段 5（`eaec04a`）只统一了两端口 Laplacian 原语（`stamps.py:75` 等），**不代表完整 CircuitElement 元件模型已统一，更不宣称元件 Stamp 单一化完成**。阶段 6 正式改生产代码之前，必须先建立本文件与 `P1-R2_BACKEND_CONSTRAINTS.md` 两项只读地基。

本文件回答一个问题：在当前代码基线上，Legacy MNA 的 `CircuitSolver.ac_sweep()` 与 Descriptor 的 `DescriptorModel.frequency_response()`，在**共同支持域**内是否给出相同的复数频响？在**分歧区**（不支持元件、病态系统）各自行为如何？

## 2. 方法与环境

- 解释器：Python 3.13.9，numpy 2.3.5；`import netlab` 自 `NetlabHome/` 成功。
- 两个后端由**同一个 `Scene`** 构建，保证拓扑逐位一致：
  - Legacy：`Simulation(scene).ac_sweep(freqs, input_source=..., probes=[...])`
  - Descriptor：`DescriptorModel.from_scene(scene).frequency_response(freqs, input_source=..., probes=[...])`
- 频率网格：`[10, 100, 1000, 10000, 100000]` Hz（严格递增、有限、>0，满足 `solver.py:988` 校验）。
- 比较口径：**复数频响** `complex(real, imag)` 逐点比较，计算 `max_abs = max|Δ|`、`max_rel = max(|Δ|/max(|ref|,1e-30))`（ref=Legacy）。**不是**只比幅值/相位曲线。
- 判据：`max_rel(complex) < 1e-9` 且 `max_abs < 1e-12` 记为 `MATCH`（与 `P1-R2_CONVERGENCE_PLAN §3` 统一门限一致；原 1e-6 过松已收紧）。
- 探针：节点名（节点电压）或元件名（元件电流），两后端同一 token。
- 探针脚本（**已纳入仓库**）：`tools/p1r2_parity_probe.py`（原 scratch 脚本迁入，只读）。复现：

```bash
cd NetlabHome
PYTHONIOENCODING=utf-8 python tools/p1r2_parity_probe.py
```

## 3. 结果矩阵

| # | 场景 | 拓扑 / 元件参数 | 激励 | input_source | 探针 | Legacy | Descriptor | max_abs | max_rel | 判定 |
|---|------|----------------|------|--------------|------|--------|-----------|---------|---------|------|
| 1 | RC_lowpass | V–R(1k)–C(1µ) | AC 单位 | V1 | out | ok | ok | 0 | 0 | **MATCH** |
| 2 | RC_highpass | V–C(1µ)–R(1k) | AC 单位 | V1 | out | ok | ok | 0 | 0 | **MATCH** |
| 3 | RL_lowpass | V–R(10)–L(1m) | AC 单位 | V1 | out | ok | ok | 1.14e-16 | 2.21e-16 | **MATCH** |
| 4 | RLC_series | V–R(10)–L(1m)–C(1µ) | AC 单位 | V1 | n2 | ok | ok | 3.06e-15 | 3.37e-14 | **MATCH** |
| 5 | VCVS | V–E1(gain=2)–RL(1k) | AC 单位 | V1 | out | ok | ok | 0 | 0 | **MATCH** |
| 6 | VCCS | V–G1(gm=2m)–RL(1k) | AC 单位 | V1 | out | ok | ok | 0 | 0 | **MATCH** |
| 7 | multi_source | V1,V2(0.5)+R1(1k),R2(2k),R3(3k) | V1 单位，V2 置零 | V1 | out | ok | ok | 0 | 0 | **MATCH** |
| 8 | multi_probe | RC 低通 | AC 单位 | V1 | out, **R1** | ok | ok | out 0 / R1 2.17e-19 | out 0 / R1 2.17e-16 | **MATCH** |
| 9 | floating_node | V–R 悬空节点（dangle 仅经 R 连接） | AC 单位 | V1 | dangle | ok | ok | 0 | 0 | **MATCH** |
| 10 | singular_parallel_vsources | V1‖V2 两个理想电压源并联 | AC 单位 | V1 | a | **ComputeError** | **LinAlgError** | — | — | **DIVERGE（失败行为）** |
| 11 | isource_drive | I1(1A)–R(1k) | AC 单位 | I1 | inn | ok | ok | 0 | 0 | **MATCH** |
| 12 | opamp_support | V–opamp(vp=vin,vn=out,gain=1e5) | AC 单位 | V1 | out | **ComputeError** | **ComputeError** | — | — | **双方拒绝（消息不同）** |
| 13 | switch_closed | V–SW(closed,ron=1mΩ)–R(1k) | AC 单位 | V1 | out | ok | ok | 0 | 0 | **MATCH** |
| 14 | switch_open | V–SW(open,roff=1GΩ)–R(1k) | AC 单位 | V1 | out | ok | ok | 0 | 0 | **MATCH** |
| — | state_invariance | RC 低通，连续两次调用 | — | V1 | out | 两次全等 | 两次全等 | — | — | **MATCH** |

映射到 m00267 要求的 12 类覆盖（另补开关 switch 作增强项，不计入 12 类）：RC(#1/#2)、RL(#3)、RLC(#4)、受控源(#5 VCVS + #6 VCCS)、多独立源(#7)、浮置与接地(#9，其余皆有接地)、病态/奇异(#10)、多探针(#8)、源归一化(#7 非输入源置零 + #11 单位电流激励)、**开关 switch(#13 closed / #14 open，两后端均按 conductance，实测一致)**、状态不变性(state_invariance)、复数误差(全表复数域)、性能(§4)。共 **14 个拓扑场景** + state_invariance 复核；MATCH = #1–#9、#11、#13、#14（共 **12 个**）。

## 4. 性能观测

- 方法：增强 harness `tools/p1r2_parity_harness.py`，端到端 API 调用（含 Scene/模型构建），5 频点，预热后多次取中位数；冷启动单列。
- 冷启动（首调，含 import/缓存预热）：Legacy ≈0.66 ms，Descriptor ≈0.27 ms（早期 361 ms 是 import/model 预热，非单次调用成本）。
- 小电路（3 节点 RC 低通）预热稳态中位：Legacy **≈0.484 ms** vs Descriptor **≈0.250 ms**，**≈1.93×**。
- 大电路（180 段 RC 梯形）预热稳态中位：Legacy **≈12.775 ms** vs Descriptor **≈10.397 ms**，**≈1.23×** —— **性能优势随规模显著收窄**。
- 结论：早期「3–4×」来自单次含预热噪声；按冷/热分离 + 小/大电路分测，**小电路约 1.9×、大电路约 1.2×**。性能不作选型主依据（canonical 侧可优化）。

## 5. 关键结论

1. **共同支持域内，两后端达到机器精度一致**：12 个 `MATCH` 场景复数相对误差 ≤ `3.37e-14`（含 switch #13/#14，实测 max_rel=0），覆盖 RC/RL/RLC、VCVS/VCCS、多独立源、悬空节点、元件电流探针、电流源激励。此前仅有的 `test_descriptor_rlc.py:174`（单一 RC 低通 / 4 频点）**不足以**支撑"完整等价"结论，本矩阵将其扩展到 14 个拓扑场景（+state_invariance 复核）。
2. **唯一数值性分歧是失败行为，而非结果**：病态/奇异系统下，Legacy 抛结构化 `ComputeError`（"电路矩阵奇异（零主元）：支路 'V2'；请检查悬空节点、缺少直流通路或重复接地的元件"），Descriptor **直接泄漏 scipy 的 `LinAlgError: Singular matrix`**，未包装为 `ComputeError`、无同样错误 schema。→ 统一方案必须收敛错误语义（见 CONVERGENCE_PLAN）。
3. **不支持元件两后端均拒绝，但报错文案不一致**：opamp 在 AC 下 Legacy 报"AC 分析暂不支持元件 'E1'（opamp）：小信号只对线性元件与受控源线性化…"，Descriptor 报"Descriptor 模型不支持非线性元件 'E1'（opamp）：请先线性化…"。结论一致（拒绝），错误契约不统一。
4. **VCCS 实际可用**：尽管 `DescriptorNode` 的分支未知量布局只显式列了电感/电压源/VCVS/opamp，实测 VCCS 场景两后端完全一致（说明其经通用元件 stamp 路径处理，无专属支路电流）。此点纠正了"Descriptor 仅支持 VCVS"的直觉。
5. **悬空（dangling）电阻不等价于奇异**：仅经一个电阻连接、无对地通路的悬浮节点，两后端给出完全一致结果（该电阻无电流、节点随 vin）。只有当出现并联理想电压源等真退化拓扑才触发奇异。

## 6. 证据与环境基线

- 探针脚本（已纳入仓库）：`tools/p1r2_parity_probe.py`（最小复现，只读、未改生产码）；增强 harness：`tools/p1r2_parity_harness.py`（含 switch/病态/奇异/E 秩证据/性能法，只读）。
- 关键代码锚点：Legacy `NetlabHome/netlab/core/compute/circuit/solver.py:969`（`ac_sweep`）、`solver.py:890-901`（`AC_KINDS`）；Descriptor `NetlabHome/netlab/core/compute/circuit/descriptor.py:823`（`frequency_response`）、`descriptor.py:112`（`DescriptorNode.__init__`）、`descriptor.py:243`（`DescriptorSystem.solve`）。
- 现有 parity 测试：`NetlabHome/netlab/tests/test_descriptor_rlc.py:174 test_frequency_response_shape_and_legacy_parity`（RC 低通 / 4 频点 / rtol1e-8 atol1e-10）。

## 7. 修订记录（2026-11-13，C 块整改）
- 判据收紧为 `max_rel(complex)<1e-9` 且 `max_abs<1e-12`（原 1e-6）。
- 新增 switch(#13 closed / #14 open) 实测，两后端 max_rel=0；MATCH 场景 12 个、拓扑 14 个。
- 探针脚本由 `NetlabExtras/scratch` 迁入 `tools/p1r2_parity_probe.py`。
- 性能改中位数法（7 次）：Legacy 0.604ms / Descriptor 0.288ms ≈ 2.1×（原单次 3–4× 已纠正）。
- 未改任何生产代码（solver.py / descriptor.py 不变）。
