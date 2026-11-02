# 求解器、元件与连接计算优化方案

> 最后修改：2026-10-28 19:05
> 文档性质：**技术调查、改动设计、测试与验收计划**
> 当前状态：**Phase A/B/C/D/E 全部实施并验证；Phase F（DC/AC/Gear/稀疏化）由用户 2026-10-28 指令推翻「不做」并已实施完成（315 passed；证据见 [SOLVER_OPTIMIZATION_REPORT.md](SOLVER_OPTIMIZATION_REPORT.md)）；仅自适应 dt/自适应 LTE 仍明确不做（D17）**
> 适用需求：R11、R12、R13、R15、R21、R22、R23；相关决策：D14、D17、D22、D41、D43、D44、D47、D48
> 结论依据：以当前代码和可复现试验为准；文档中的历史描述用于解释设计意图，不作为当前行为证据。
>
> 实施状态速览（2026-10-28 04:48）：
>
> - §3.1 P0-01～P0-12 全部处理，测试见 `netlab/tests/test_solver_p0.py`；
> - §6.1 事务、§6.2 均衡/残差、§6.3 断点与超时已落地；
> - §6.4 元件契约完成：Comparator 回差方向记忆、LogicGate 电流、BJT 公式对齐、MOSFET 线性区/λ/体效应、OpAmp 转换速率/带宽、catalog 公式全同步；
> - §6.5 信号/矢量事务完成：`Network.step` 整步事务、延迟边输出回滚、handler state 隔离、块内状态快照；
> - §6.6 能力扩展完成：DC 工作点 `.op`、AC/Bode（工作点线性化 + 复数 MNA）、Gear2（BDF2）、稀疏矩阵（auto>200，splu）；API `GET /api/operating-point`、`GET /api/ac-sweep`、`PATCH /api/config` 的 sparse 字段接通（UI 图表入口未接）；
> - 原 §2.2 基线 262 passed → 当前 **315 passed**（`test_solver_p0.py` 13 项 + `test_element_contracts.py` 14 项 + `test_solver_transactions.py` 6 项 + `test_solver_analysis.py` 11 项 + `test_solver_integration.py` 6 项 + `test_solver_sparse.py` 6 项）。

---

## 0. 先给结论

当前系统的 MNA、Newton、断点、gmin/source stepping 和 SolverOptions 已经具备基础框架，但还存在一组会影响数值可信度和故障恢复能力的问题。最需要优先处理的是：

1. **失败步会留下副作用**：电路求解失败后，求解器时间可能已经推进，非线性元件的历史状态也可能被 Newton 试算改写。
2. **矩阵与残差没有尺度均衡**：电压、支路电流和 `1/dt` 形式的伴随电导处于不同量纲，细 `dt` 会把条件数放大；当前奇异阈值和残差判断不能稳定区分“病态但可解”和“真正奇异”。
3. **部分断点和超时逻辑只覆盖旧边路径**：器件节点形式下的波形源没有进入 `Scene.next_breakpoint`；单步超时是执行后的统计，不构成事务回滚。
4. **各元件都在 `state` 中混用“已提交历史”和“Newton 当前猜测”**：二极管、BJT、互感等元件在迭代中直接写 `state`，导致试算污染和重复运行不确定性。
5. **部分模型的文档公式、注册公式和实际代码不一致**：BJT、MOSFET、比较器、逻辑门、LDO 等需要明确行为边界，避免用户把教学行为模型误认为器件级模型。

本方案不是把 netlab 重写成 ngspice，也不改变固定 `dt` 的产品语义。第一阶段只修复求解边界和可验证的数值缺陷；元件精度、DC 工作点、AC 分析和大规模稀疏化作为后续独立阶段。

---

## 1. 文档依据与权威顺序

本次调查按项目约定读取：

- [AGENT_GUIDE.md](AGENT_GUIDE.md)：开工流程、文档裁定顺序、备份和收尾规则。
- [REQUIREMENTS_AND_RULES.md](REQUIREMENTS_AND_RULES.md)：R01–R25、D1–D52、P0–P6 和不做清单。
- [PROGRESS.md](PROGRESS.md)：当前阶段、测试数和已登记证据。
- [NGSPICE_SOLVER_COMPARISON.md](NGSPICE_SOLVER_COMPARISON.md)：与 ngspice 的数值机制差异和优先级建议。
- [SOLVER_CODE_MAP.md](SOLVER_CODE_MAP.md)：节点、连接、电路求解器和时间推进的代码地图。
- [FRAMEWORK_CHEATSHEET.md](FRAMEWORK_CHEATSHEET.md)：模块路由和改动位置。
- [EXTENDING.md](EXTENDING.md)：元件和连接函数的扩展契约。
- [LESSONS.md](LESSONS.md)：已经踩过的收敛、断点和状态陷阱。

权威顺序按 `AGENT_GUIDE.md`：

```text
代码 + 测试
  > REQUIREMENTS §2 决策台账
  > REQUIREMENTS §3 需求正文
  > PROGRESS 已核实证据
  > ARCHITECTURE / EXTENDING
  > 历史计划 / README
```

因此，本文把“代码事实”和“计划改动”分开写。没有执行过的测试不会写成已完成；没有复现的问题会标为“待确认”。

### 1.1 关于“思维链”

本文不公开不可核查的内部逐步思维过程。替代方式是给出：

- 观察到的代码或试验事实；
- 可能的根因；
- 选择和放弃的方案；
- 改动会影响的接口、性能和兼容性；
- 可重复的验证用例和通过条件。

这能满足工程审查和复现需要，但不会声称存在无法从代码和测试验证的结论。

---

## 2. 调查基线与已确认事实

### 2.1 已存在的求解能力

当前代码已经具备：

- `CircuitSolver` 的 MNA 未知量布局；
- 电压源、VCVS、电感和多端口元件的支路变量；
- 梯形法和后向欧拉伴随模型；
- 非线性元件的 Newton 迭代；
- `SolverOptions` 的 `reltol`、`vntol`、`abstol`、`max_iter`、`gmin_steps`、`src_steps`、`residual_tol`；
- 失败后的 gmin stepping 和 source stepping；
- 旧边路径的波形断点；
- LU 分解缓存和节点/支路名称映射；
- 中性网络、器件节点和 PinMap；
- 线性电路、二极管、BJT/MOS、逻辑、数字、磁性元件的基础测试。

### 2.2 修改前测试结果

在本次调查中执行了：

```powershell
python -m pytest -p no:cacheprovider tests/test_solver_p0.py tests/test_netlab.py -q `
  -k "solver or singular or breakpoint or rc_step or rlc_series or diode_rectifier or controlled_source"
```

结果：

```text
7 passed, 41 deselected
```

另外执行了全量测试：

```powershell
python -m pytest tests -q
```

结果不是可用的全绿基线：

- 220 项通过；
- 43 项在测试初始化阶段报错；
- 一个错误是 SymPy 导入时 Windows `gmpy2` 原生模块异常 `0xc0000139`；
- 后续多个测试因为无法访问 `C:\Users\weijiewang\AppData\Local\Temp\pytest-of-weijiewang` 报 `PermissionError`。

这些错误发生在修改代码之前，不能归因于本方案。它们说明后续全量验收需要先建立可用的测试临时目录和 SymPy 环境，不能把环境错误误报为求解器失败。

### 2.3 已复现的失败步副作用

构造一个最小电路：

- `n` 通过 5 V 电压源接地；
- `n` 通过一个二极管接地；
- `max_iter=1`；
- 关闭 gmin stepping 和 source stepping。

可观察结果：

```text
求解前：solver.time = 0.0，diode.state = {"vd": 0.0}
求解抛出未收敛错误
求解后：solver.time = 0.0001，diode.state["vd"] 约等于 0.1361
```

这说明失败步并非原子操作：

- `CircuitSolver.step` 在求解前就执行 `self.time += dt`；
- 非线性元件的 `update_guess` 直接写 `self.state`；
- 异常发生后没有回滚；
- `Simulation._advance_locked` 捕获异常只记录错误，不恢复引擎；
- 下一次“修复后重试”的起点可能不是上一成功步。

这是当前方案中的 P0 问题，不需要依赖外部数值库即可复现。

---

## 3. 问题清单

### 3.1 P0：会直接影响结果可信度或故障恢复的问题

| 编号 | 问题 | 代码位置/证据 | 影响 | 本阶段处理 |
| --- | --- | --- | --- | --- |
| P0-01 | 求解失败后电路时间仍推进 | `nodal.CircuitSolver.step` 在求解前 `self.time += dt` | 失败后继续运行会跳到错误时刻；回放时间戳和求解状态不一致 | 修复 |
| P0-02 | Newton 试算直接写已提交状态 | `Diode.update_guess`、`BipolarJunction.update_guess` 等修改 `self.state` | 失败步污染下一次初值；重复运行结果不确定 | 修复 |
| P0-03 | gmin/source stepping 共用污染状态 | `_newton_solve` 直接使用上一 trial 的 state | 救急路径可能把失败 trial 当作下一次初值；诊断失真 | 修复 |
| P0-04 | `source_scale` 异常时不一定恢复 | `_newton_solve` 只在正常返回时恢复源比例 | 一次异常后后续试算可能仍使用部分源值 | 修复 |
| P0-05 | `SolverOptions.gmin` 没有真正参与 gmin stepping | 代码固定从 `1e-3` 开始，`options.gmin` 未被读取 | 用户配置无效，行为和界面设置不一致 | 修复 |
| P0-06 | 残差检查不是尺度无关的 | `_newton_solve` 使用 `max(|A·x-b|)` 和 `max(1, max|b|)` | 电压、电流、电导混合量纲；细 `dt` 下可能误判 | 修复/校准 |
| P0-07 | 矩阵奇异判断只依赖未缩放 LU 对角线 | `_solve_matrix` 用 `diag <= 1e-16*max(diag)` | 病态可解矩阵可能误报；真奇异诊断也不完整 | 修复 |
| P0-08 | 线性电路没有通用解质量检查 | 线性分支只求一次解并接受 | 数值有害解或近奇异解可能进入 `commit` | 修复 |
| P0-09 | 器件节点源的断点未被扫描 | `Scene.next_breakpoint` 只遍历 `scene.edges` 中的 `vsource/isource` | R20 新模型下波形边沿可能跨过 `dt` | 修复 |
| P0-10 | 超时是事后检测，不是事务边界 | `Simulation._advance_locked` 先 `scene.step`，再检查耗时 | 超时后场景可能已推进，但 `Simulation.time/steps` 未推进 | 修复或明确降级 |
| P0-11 | 失败提示无条件声称尝试过 gmin | 未收敛错误文本固定包含“已尝试 gmin stepping” | 当 `gmin_steps=0` 时提示与实际不符 | 修复 |
| P0-12 | `_trouble_name` 取绝对值最大的未知量，而非最大残差节点 | `CircuitSolver._trouble_name` | 诊断可能指向非真正问题节点 | 改进 |

### 3.2 P1：数值/元件契约问题

| 编号 | 问题 | 证据 | 影响 | 优先级 |
| --- | --- | --- | --- | --- |
| P1-01 | 非线性元件的迭代猜测和历史状态没有明确分层 | Diode 的 `vd`、BJT 的 `vbe` 同时承担初值、工作点和结果 | 污染、重复运行不确定 | 高 |
| P1-02 | `stamp` 中仍有元件写临时属性 | `LDO.stamp` 写 `self.value` | Newton 多次 stamp 时属性语义不清 | 中 |
| P1-03 | 比较器“迟滞”只是固定输入偏移 | `Comparator._f(ctx, u + hysteresis)` | 没有方向相关记忆，不等于真实迟滞 | 中 |
| P1-04 | 逻辑门的 `current()` 固定返回 0 | `LogicGate.current` | 电流/功率探针与实际导通路径不一致 | 中 |
| P1-05 | BJT 文档公式与实现不一致 | 注册文字描述指数模型，代码是分段线性 `vbe_on/rin` | 用户会误认为实现为 Ebers-Moll 指数模型 | 中 |
| P1-06 | MOSFET 只实现平方律饱和电流 | `Mosfet._drain_current` 仅有 `0.5*k*over²` | 缺少线性区、体效应、沟道长度调制、电容 | 中 |
| P1-07 | 二极管缺少结电容、反向击穿和更完整温度模型 | `Diode` 只有 Shockey + 可选串联电阻 | 高频/瞬态/反向保护电路不精确 | 中 |
| P1-08 | OpAmp/Comparator 没有转换速率、带宽和输入偏置 | `OpAmp._evaluate` 为 tanh 代数约束 | 高频行为和真实器件差异大 | 中 |
| P1-09 | LED 使用通用二极管参数，缺少明确 Vf/颜色/亮度语义 | catalog 备注说明仅电学行为，但用户可能误用 | 模型边界需显式展示 | 中 |
| P1-10 | 磁性元件某些配置依赖副边直流通路 | `Transformer`/`CoupledInductor` 文档与实现 | 无负载时矩阵易奇异，错误应可解释 | 中 |
| P1-11 | 梯形法默认可对刚性/不连续系统产生数值振铃 | 代码默认 `trapezoidal` | 需要与后向欧拉对照并给出提示 | 中 |
| P1-12 | 元件注册公式和实际执行路径可能继续漂移 | `nodal.py` 的 `formula/notes` 与子模块实现分离 | 文档无法作为可信公式来源 | 中 |

### 3.3 P2：当前已知但不在第一阶段强行解决的问题

这些问题来自 ngspice 对比和现有架构，不建议与 P0 修复绑在一起：

| 编号 | 问题 | 原因 | 处理策略 |
| --- | --- | --- | --- |
| P2-01 | 没有独立 DC 工作点 `.op` | 目前瞬态第一拍作为工作点 | ✅ 2026-10-28 已实现 `operating_point()`（D53） |
| P2-02 | 没有 LTE 自适应步长 | D17 明确不做自适应调度；固定 dt 是回放和测试的确定性基础 | 不实现；只做断点、尺度保护和诊断 |
| P2-03 | 没有 Gear 1–6 阶 | 当前只有梯形/后向欧拉 | ✅ Gear2 已实现（D55），未做 Gear3–6 |
| P2-04 | 没有 AC/Bode 复数 MNA | `analysis.py` 目前不是运行点线性化 AC | ✅ 已实现 `ac_sweep()`（D54，限线性元件） |
| P2-05 | 稠密 MNA 在未知量增大后 O(n³) | 当前定位小规模交互系统 | ✅ 稀疏选项已实现（D56，auto>200 自动切换） |
| P2-06 | 部分非线性器件模型精度不足 | BJT/MOS 是行为级 | 以“教学/趋势”与“数据手册对照”分开验收 |
| P2-07 | 无噪声、失真、PZ、灵敏度 | 现有分析范围之外 | 不纳入本阶段 |
| P2-08 | 数字事件仍按固定时间步扫描 | 现有数字模型是行为级 | 先解决边沿断点和时钟状态，再考虑事件驱动 |

### 3.4 信号/矢量路径的独立问题

这些问题与电路 MNA 不同，但要单独记录，避免误以为只修 `nodal.py` 就完成全部优化：

| 编号 | 问题 | 证据 | 影响 |
| --- | --- | --- | --- |
| S-01 | `Network.step` 逐节点提交，没有失败事务 | `graph.py` 在拓扑循环中直接 `node.update`、`time += dt` | 中途失败会留下部分节点更新 |
| S-02 | 延迟边输出和连接状态在失败前已经写入 | `Connection.evaluate` 更新 `self.output` 和 `state` | 重试可能使用半更新历史 |
| S-03 | `node.inputs`/`node.ports` 在失败时可能保留部分连接载荷 | `Network.step` 循环中清空后写入 | 诊断和重试输入不完整 |
| S-04 | 非可信节点 handler 的 `state` 是直接引用 | `Node.update` 将 `self.state` 原对象传给 handler | 自定义代码可能绕过回滚 |
| S-05 | 连接函数可修改 `state`，而 `output` 的提交顺序缺少事务边界 | `Connection.evaluate` 直接设置 `output` | 失败后输出快照可能过期 |
| S-06 | 没有针对整步的复制/回滚性能基准 | 现有 `trusted` 快路径只优化输入复制 | 直接全量 deepcopy 可能伤害实时性能 |

建议把信号路径回滚作为**第二阶段**，不要在修复 MNA 时同时重写两条引擎。第一阶段先保证电路路径可回滚；第二阶段用边界快照和基准决定是否加入 journal 或只回滚受影响对象。

---

## 4. 根因分析

### 4.1 失败步不是事务

当前电路步进顺序近似为：

```text
time += dt
prepare(dt, time)
Newton 试算
  stamp 使用 solution 和 state
  solve
  update_guess 修改 state
commit 写入 result/state
写回 node_voltages
```

只要 `prepare`、`stamp`、求解、`commit` 中任何一步抛错，前面已经发生的状态都不能自动撤回。尤其非线性元件的 `state` 同时被当作：

- 上一步历史；
- 本步 Newton 初值；
- Newton 当前工作点；
- 最终结果存储。

这是根因，不是单一元件错误。

### 4.2 量纲混合导致矩阵尺度差异

MNA 矩阵包含：

- 电导，单位 S；
- 支路约束的 ±1；
- VCVS/VCCS 的增益项；
- 电容伴随电导 `C/dt` 或 `2C/dt`；
- 电感伴随项 `dt/L` 或 `dt/(2L)`；
- 非线性元件的 Jacobian 项。

同一个 `.001` 在电压行、电流行和约束行没有相同意义。`dt` 很小时，`C/dt` 可能远大于周围电导，直接 LU 容易出现：

- 主元绝对值很大但结果仍可解；
- 固定阈值把病态矩阵误判成奇异；
- 绝对残差看起来小，但相对问题仍然很坏；
- 用“最大绝对值未知量”定位故障，指向错误节点。

### 4.3 固定 `dt` 是产品语义，不是根因本身

项目 D17 明确不做自适应 dt。固定 `dt` 让回放、录制和测试可复现，因此：

- 不根据失败次数自动改小 `dt`；
- 不在用户不知情时改变时间戳；
- 不用自动降步掩盖拓扑错误；
- 继续用断点把源跳变精确落在时间轴上。

优化方向是让固定步长下的矩阵和残差判断更稳健，并提供“为什么这个步长不够”的诊断。

### 4.4 器件节点迁移后断点扫描没有同步迁移

R20 后主要模型是“器件节点 + 引脚导线”，但 `Scene.next_breakpoint` 仍按旧“边=元件”路径读取源参数。于是：

- 旧边形式的方波可能被准确落点；
- 器件节点形式的方波可能被跨过；
- 同一个波形因建模路径不同而结果不同。

这是结构迁移不一致，不是波形函数本身错误。

### 4.5 元件模型和描述缺少可执行契约

例如：

- BJT catalog 注册公式描述了指数模型，类实现使用分段线性开启电阻；
- MOSFET catalog 描述可能暗示多个工作区，实际只有平方律饱和区；
- 比较器参数名为 `hysteresis`，实现却只是固定加法偏移；
- 逻辑门 `current=0` 使其功率和电流读数失真。

修复方式不是一次把所有器件升级到 BSIM，而是：

1. 先让行为模型真实、可解释；
2. 明确“教学行为级”与“器件级”边界；
3. 把公式、参数、测试和 UI 备注统一；
4. 对高频/精密模型另立阶段。

---

## 5. 设计原则与兼容边界

### 5.1 必须保持不变

- `Simulation.config.dt` 的固定步长语义；
- `lock_dt` 的现有含义；
- `Scene.step(dt)` 对外接口；
- `CircuitElement.prepare/stamp/commit/reset` 的扩展生命周期；
- `MethodSpec` 和连接函数的 5 参数签名；
- 现有工程文件格式和旧字段读取；
- 默认 `residual_tol=0` 的旧配置兼容；
- 旧“边=元件”路径在迁移完成前仍可读、可运行；
- 小矩阵 CPU 快路径和线性 LU 复用的思想。

### 5.2 允许变化的数值边界

为了提高可信度，可以允许极小量级的最后几位变化，但必须满足：

- 解析 RC/RL/RLC 测试在原有容差内；
- 线性电路结果与新缩放求解器的参考值一致；
- 旧模板趋势和饱和行为不改变；
- 任何显著变化都必须在报告中列出原因和测试证据；
- 不以“优化”为名改变固定 `dt` 或隐藏失败。

### 5.3 不采用的方案

- 不在失败时自动把 `dt` 改成 `dt/10`；
- 不在用户不知情时切换积分方法；
- 不直接引入 ngspice 作为运行时依赖；
- 不做一次性的大规模 `nodal.py` 重写；
- 不删除旧的错误保护和测试来换取通过率；
- 不把“试算成功”误写成“已提交成功”；
- 不将行为级 BJT/MOS 宣称为器件级 SPICE 模型。

---

## 6. 目标结构与拟修改代码

建议把改动分为四个阶段。每个阶段单独验收，避免一次改动 MNA、信号引擎、器件模型和 UI。

### 6.1 阶段 A：MNA 求解事务

#### 目标

保证一个 `CircuitSolver.step` 具有以下原子性：

```text
成功：
  旧状态 -> 新时间/新解/新结果
失败：
  旧状态 -> 旧时间/旧解/旧历史/旧诊断
```

#### 修改位置

- `netlab/core/compute/nodal.py`
  - `CircuitSolver.step`
  - `CircuitSolver._newton_solve`
  - `CircuitSolver._solve_matrix`
  - `CircuitSolver._trouble_name`
  - `CircuitSolver.reset`
- 新增私有辅助对象/函数，建议仍放在 `nodal.py`，避免当前阶段引入新模块：

```text
_SolverCheckpoint
  time
  solution
  node_voltages
  element_states
  element_results
  source_scales
  lu_cache / lu_matrix / cached_dt

_SolverDiagnostics
  iterations
  max_abs_residual
  relative_residual
  row_scales
  col_scales
  condition_estimate
  trouble_index
```

#### 拟改流程

```python
def step(self, dt):
    validate(dt)
    checkpoint = self._capture_checkpoint()
    candidate_time = self.time + dt
    try:
        self._prepare_elements(dt, candidate_time)
        solution = self._solve_with_fallbacks(dt, candidate_time)
        self._commit_elements(solution)
        self.time = candidate_time
        self.solution = solution
        self.node_voltages = ...
        return stats
    except Exception:
        self._restore_checkpoint(checkpoint)
        raise
```

注意：

- `element.prepare` 可以使用候选时间，但失败后要恢复 `element.time`；
- 不能只在异常类型为 `ComputeError` 时回滚；任何计算异常都要恢复；
- 回滚后再抛出原始异常，不吞掉根因；
- `Matrix`/`rhs` 可以只清空后重建，不要求恢复其内容；
- 单体 state 深拷贝需要基准，先以正确性为主，之后按性能测试优化。

#### 非线性猜测和历史的分离

推荐逐步把“迭代猜测”从 `state` 拆出：

```text
element.state         已成功提交的历史
element.iteration_guess Newton 当前工作点
element.result        本步候选结果
```

对现有类：

- `Diode`：新增 `guess_vd`；`update_guess` 只写 `guess_vd`；`stamp` 读取 `guess_vd`；`commit` 成功后再写 `state["vd"]`。
- `BipolarJunction`：新增 `guess_vbe`；`update_guess` 只写 `guess_vbe`；成功 commit 后写 `state["vbe"]`。
- `LDO`：`stamp` 用局部 `value` 或 `iteration_guess`，不在 `stamp` 中修改已提交状态。
- 其他 `nonlinear=True` 元件：检查是否存在 `stamp` 或 `update_guess` 修改 `state` 的路径，并增加同类测试。

如果时间不允许做全量拆分，阶段 A 可以先加 checkpoint，阶段 B 再拆 `guess_*`。但 checkpoint 只能解决“失败后恢复”，不能解决“迭代期间语义混杂”，因此不能把 checkpoint 当作最终设计。

#### gmin/source stepping 改动

- 读取 `self.options.gmin` 作为起始 gmin，不再硬编码 `1e-3`；
- 如果 `gmin_steps <= 0`，不执行 gmin stepping；
- 每个 gmin trial 使用独立 checkpoint，失败的 trial 恢复；
- 只有成功 trial 才更新候选 solution；
- source stepping 每个比例同样独立 checkpoint；
- `source_scale` 用 `try/finally` 恢复到 `1.0`；
- 最终错误信息按实际尝试情况拼接，不再无条件声称执行过 gmin；
- 返回累计迭代次数和实际使用的策略。

#### 诊断改动

`_trouble_name` 不应取 `argmax(|solution|)`。应优先计算：

```text
r = A x - b
row_score_i = |r_i| / (row_scale_i * (|b_i| + ||A_i|| * |x| + epsilon))
```

优先报告最大归一化 KCL 残差对应的节点；如果失败发生在约束行，则报告支路名。没有残差信息时才退回最大绝对值未知量，并在消息中标明这是“回退定位”。

### 6.2 阶段 B：矩阵均衡与解质量

#### 目标

在不改变 `dt` 语义的前提下，降低“病态但可解”和“真奇异”混淆的概率。

#### 基本算法

对每个需要求解的 `A x = b`：

1. 计算行尺度 `r_i = max_j |A_ij|`；
2. 计算列尺度 `c_j = max_i |A_ij|`；
3. 构造 `D_r A D_c y = D_r b`，其中 `x = D_c y`；
4. 对缩放后的矩阵执行 LU；
5. 解出 `y` 后恢复 `x`；
6. 计算未缩放和缩放后的相对后向误差；
7. 将尺度、残差和 LU 状态记录到诊断对象。

可做一次或两次迭代均衡。需要避免：

- 使用 `max(1, ...)` 让大电阻/小电导的缩放失效；
- 对空行/空列悄悄设 1 而不报悬空；
- 把 RHS 的绝对值直接作为唯一的尺度标准；
- 在非线性每个 Newton 迭代中分配不必要的临时大对象。

#### LU 缓存

缓存键至少包括：

```text
scaled matrix identity
dt
row scales
column scales
```

现有线性复用必须保持。若矩阵和尺度相同，只重新回代；若非线性矩阵变化，则重新分解。不能把未缩放的 `_lu_matrix` 与缩放后的 factor 混用。

#### 解质量检查

对线性和非线性解都建议计算：

```text
relative_backward_error =
  ||A x - b||_inf /
  (||A||_inf * ||x||_inf + ||b||_inf + epsilon)
```

当 `residual_tol > 0` 时，使用它作为显式阈值；当 `residual_tol == 0` 时：

- 保持旧配置的行为原则，不突然收紧正常电路；
- 但仍对明显非有限值、明显不可接受的相对误差做安全失败；
- 建议新增内部安全阈值并在多个模板/解析电路上校准，不能凭感觉选值。

候选字段：

```python
@dataclass(frozen=True)
class SolverOptions:
    ...
    residual_tol: float = 0.0
    residual_safety_tol: float = 1.0e-8  # 待基准校准
    pivot_tol: float = 1.0e-14           # 待实验校准
    scaling: bool = True
```

新增字段要同时更新：

- `simulation.SimConfig`；
- `Simulation.apply_config` 的 allowed 集合；
- `project.py` 的工程 `sim` 序列化；
- 前端求解器设置面板（若暴露为可调项）；
- 旧工程缺省值兼容；
- 配置往返测试。

如果第一阶段不想扩大 UI 配置面，可把 `scaling` 和 `pivot_tol` 先作为内部常量/默认字段，不暴露给用户；但必须在 API stats 中记录实际生效值。

#### 奇异诊断

- 缩放 LU 的零主元/非有限主元映射回未知量；
- 检查 `A` 的行/列是否全零；
- 对真奇异给出“节点/支路 + 缺少直流通路/重复电压源”；
- 对可能是病态但可解的情况，给出条件数估计和“系统已尝试缩放”，不要简单提示“减小 dt”；
- 对双电压源并联等真奇异用例继续抛出 `ComputeError`。

### 6.3 阶段 C：断点与时间推进安全

#### 器件节点断点

修改 `Scene.next_breakpoint`：

- 保留旧 `scene.edges` 的源扫描；
- 增加 `kind == "device"` 且 `element in ("vsource", "isource")` 的扫描；
- 从器件参数读取 `wave/frequency/delay/duty`；
- 使用与 `waveform_value` 相同的时间定义，避免前端/引擎边界不一致；
- 对同一时刻去重，返回最近候选。

#### 断点精度

- 断点落下后，下一条记录时间必须严格递增；
- 不允许重复把同一点作为断点；
- 对与当前时间相差小于内部 epsilon 的候选做明确处理；
- 保持 `dt` 上限和断点缩短逻辑，但不自动做 LTE 降步；
- 增加 1 kHz 方波、脉冲、step 在旧边和器件节点两条路径的对照测试。

#### 超时与事务

当前 `_advance_locked` 的问题：

```text
scene.step 已经完成
 -> 超时检查
 -> 返回 False
 -> Simulation.time/steps 没有推进
```

这会造成“场景时间已变、播放器时间未变”。两种可行设计：

1. 推出 `Scene.step` 的候选/commit 接口，先得到候选状态，超时前不提交；
2. 先记录场景 checkpoint；超时后调用 `rollback`。

第一阶段建议先为电路引擎加入 checkpoint/rollback，并让 `_advance_locked` 在超时后恢复。信号引擎另立阶段，不要假装电路回滚会自动修复信号路径。

如果 Python 无法安全中断一个正在执行的 C/NumPy 调用，超时只能是“返回后的截止检测”。文档和 UI 必须明确这一点；真正的抢占需要线程/进程隔离，属于后续架构工作。

### 6.4 阶段 D：元件模型和连接计算契约

#### 元件统一契约

建议在 `CircuitElement` 文档和测试中明确：

- `prepare` 只使用已提交历史，计算本步系数；
- `stamp` 只读 `ctx.solution`、已准备系数和迭代猜测，不写已提交历史；
- `update_guess` 只写迭代猜测；
- `commit` 只有在求解成功后才写历史；
- `reset` 恢复所有历史键；
- `state` 不能作为跨元件共享的可变通信通道；
- `result` 是候选结果，失败时不得被外部当作已提交结果。

#### 具体元件

| 元件 | 当前问题 | 建议改动 | 测试 |
| --- | --- | --- | --- |
| Diode | `vd` 混用；无 Cj/击穿模型 | 拆分 `guess_vd`；先修正契约，再决定是否加 `Cj`/`BV` | 失败回滚、指数扫描、RC 整流 |
| Zener | 反向软击穿已有平滑；缺少温度/电容 | 保留软击穿，补参数边界和公式一致性测试 | 击穿钳位、反向曲线 |
| BJT | 注册公式与实现不一致；缺少 Early/电容/温度 | 先修公式/备注和迭代状态；后续独立做器件级升级 | 截止/放大/饱和、失败回滚 |
| MOSFET | 仅平方律饱和；catalog 可能暗示线性区 | 先明确行为级公式；若补线性区，使用统一 `vds` 分支并做连续性测试 | 截止/饱和/线性/边界 |
| OpAmp | tanh 代数限幅；无 slew/带宽 | 明确理想行为；后续补 slew/GBW | 反相/同相闭环、饱和 |
| Comparator | 固定偏移不是真迟滞 | 若要真迟滞，增加方向状态/latch；否则改名为输入偏置并改文档 | 上行/下行阈值 |
| LogicGate | `current()` 为 0 | 从输出电导和节点电压计算输出电流；明确 VDD/GND 电流方向 | 真值表 + 电流/功率 |
| LDO | `stamp` 写 `self.value` | 使用迭代局部量；补 dropout/限流测试 | 稳压/压差 |
| Transformer | 副边无直流通路易奇异 | 增加可读诊断和可选负载提示；保持理想约束 | 理想/励磁/无负载 |
| CoupledInductor | k→1 被截断且矩阵条件差 | 已在参数层限制；增加近奇异诊断和能量/波形测试 | k=0、0.9、0.999 |
| 555/数字 | 固定步扫描，边沿可能漏掉 | 与断点阶段联动；不宣称事件驱动 | 高低电平、上升沿、采样 |
| 开关 | 静态 `closed`，无动态控制 | 保持行为级；补 `ron/roff` 极端值测试 | 开/关、功耗 |

#### 连接计算

信号/矢量连接函数目前以状态字典保存历史。第一阶段不修改连接函数签名，但建议：

- 在 `Network.step` 外层做一次 checkpoint；
- 对非可信 handler 至少恢复 `state`、`data`、`inputs`、`ports`、`output`；
- 对可信内置 handler 可以记录“最小恢复集”，避免每步全量 deepcopy；
- 延迟边的 `output` 和状态必须在同一个事务边界内提交；
- 为 `tf`、`integrator`、`delay` 增加失败后重试测试；
- 任何优化都必须通过现有信号链和矢量模板回归。

### 6.5 结构建议

`nodal.py` 当前同时包含元件定义、注册表和求解器，文件较大。此次不建议立刻拆成大量模块，避免扩大风险。建议阶段 A 先在原文件内增加清晰的私有辅助结构；如果后续需要拆分，按以下边界进行：

```text
netlab/mna_scale.py    矩阵均衡、LU 诊断、相对残差
netlab/mna_solver.py   CircuitSolver、事务、Newton
netlab/core/compute/nodal.py        元件模型与注册表兼容入口
```

这只是后续候选结构，不在第一阶段直接执行。拆模块前必须先建立所有元件和求解器的回归基线。

---

## 7. 改动后的数据流

### 7.1 成功步

```text
Simulation._advance_locked
  -> 选择断点后的步长（不自动 LTE 降步）
  -> Scene.step(step_dt)
     -> CircuitEngine.step(step_dt)
        -> CircuitSolver.step(step_dt)
           -> checkpoint 已提交状态
           -> prepare
           -> stamp / scaled solve / Newton
           -> update temporary guesses
           -> commit 候选结果
           -> 提交 time/solution/node_voltages
        -> 写回网络节点电压
  -> Simulation.time += step_dt
  -> Recorder 写帧
```

### 7.2 失败步

```text
任何 prepare/stamp/solve/quality/commit 异常
  -> 恢复 checkpoint
  -> 保持旧 time/solution/state/result
  -> 返回可读诊断
  -> Simulation.error 记录错误
  -> 不产生新录制帧
  -> 不自动改变 dt
```

### 7.3 状态所有权

```text
Element.state          已成功历史
Element.iteration_guess Newton 临时工作点
Element.result         候选结果
CircuitSolver.solution 上一成功解/本步候选解
Simulation.time        已完成步的时间
Recorder.frames        已完成步的快照
```

任何“候选”与“已提交”混用都应视为需要测试的契约缺陷。

---

## 8. 测试与验证方案

### 8.1 测试分层

#### 单元测试

新增建议文件：

```text
tests/test_solver_transactions.py
tests/test_solver_numerics.py
tests/test_solver_breakpoints.py
tests/test_element_contracts.py
```

至少覆盖：

1. `max_iter=1` 的二极管求解失败后，`time`、`state`、`solution` 不变；
2. 同一电路第一次失败、修正 `max_iter` 后成功，结果与从零重新构造一致；
3. gmin trial 失败后不会污染下一次 trial；
4. source stepping 异常后 `source_scale == 1.0`；
5. 配置 `gmin` 被实际读取；
6. 双电压源并联仍报真奇异，错误包含节点或支路；
7. 细 `dt` 下高电容电路可解，解与解析 RC 或 NumPy 参考解在容差内；
8. 人为注入坏解后残差检查能拒绝；
9. 1 kHz 方波在旧边和器件节点路径都得到正确断点；
10. 超时后电路时间和状态回到超时前；
11. 全部元件 `reset` 后重复运行结果一致；
12. BJT/MOSFET 关键工作区公式与注册描述一致。

#### 集成测试

- 旧边电路模板；
- 器件节点 + PinMap 模板；
- R/L/C、二极管整流、RLC、共集、运放/比较器；
- 多接地、未接器件、孤立网络；
- 预计算 0→T；
- 回放时间戳严格递增；
- 失败后重新运行。

#### 回归测试

必须运行现有：

```text
tests/test_solver_p0.py
tests/test_netlab.py
tests/test_device_nodes.py
tests/test_circuit_semantics.py
tests/test_magnetics.py
tests/test_transistors.py
tests/test_timers.py
tests/test_logic.py
tests/test_digital.py
tests/test_time_profile.py
```

### 8.2 数值参考

至少使用以下参考：

- RC 阶跃：解析式 `V(t)=V0(1-exp(-t/RC))`；
- RL 阶跃：解析电流响应；
- RLC 欠阻尼/过阻尼：解析或独立 `scipy.integrate.solve_ivp`；
- 纯电阻分压：直接代数解；
- 二极管小信号/扫描：独立单调性和能量符号检查；
- 平行电压源：数学上的奇异应被稳定识别；
- 高电容细步长：与同一方程在缩放到可处理尺度后的参考解比较。

测试容差不能只以“旧实现结果”为准，否则会把旧错误固化。解析解优先，独立数值解次之，旧实现回归仅用于发现非预期行为变化。

### 8.3 性能基准

记录：

- 矩阵大小；
- 元件数；
- 线性/非线性；
- 未缩放与缩放求解耗时；
- LU 复用次数；
- Newton 次数；
- 最大/相对残差；
- 失败步耗时；
- 波形断点次数。

目标不是让所有小矩阵更快，而是确认：

- 缩放没有让常用线性模板出现明显性能退化；
- checkpoint 的深拷贝成本在交互规模内可接受；
- 线性 LU 缓存仍然有效；
- GPU 路径没有被缩放逻辑悄悄破坏。

可用现有 `tools/bench.py` 或新增可重复基准。报告中必须写测试条件、重复次数、耗时中位数/最大值，而不是只写一次运行结果。

### 8.4 命令模板

推荐在项目根目录而非 `netlab` 子目录执行：

```powershell
cd E:\Python\MyPython\ProjectPoint
python -m pytest netlab/tests -q --basetemp E:\Python\MyPython\ProjectPoint\.pytest_tmp
python -m compileall -q netlab
python -m netlab.desktop --selftest
```

如果环境仍存在 SymPy/gmpy2 错误：

1. 先运行不含 `analysis`/SymPy 的求解器测试；
2. 将原生依赖问题单独记录为环境阻塞；
3. 不在本阶段修改第三方依赖或伪造全量通过；
4. 环境修复后再执行完整测试。

已知当前测试环境问题：

- `E:\anaconda3\Lib\site-packages\gmpy2\__init__.py` 导入导致的 Windows 异常；
- `AppData\Local\Temp\pytest-of-weijiewang` 临时目录权限问题。

这两个问题应在阶段开始前处理或明确隔离，否则全量报告无法审计。

### 8.5 验收标准

阶段 A/B/C 必须同时满足：

- [x] 失败步不会改变 `CircuitSolver.time`、`solution`、元件历史状态和 `Simulation.time`；
- [x] 失败后重新运行与从干净状态运行一致；
- [x] gmin/source stepping 不泄漏状态和源比例；
- [x] `SolverOptions.gmin` 配置实际生效；
- [x] 细 `dt` 下高电容可解，且解析 RC/RLC 回归通过；
- [x] 双电压源并联仍被诊断为真奇异；
- [x] 线性电路也有最小解质量检查；
- [x] 器件节点源断点被覆盖；
- [x] 断点后时间戳严格递增；
- [x] 超时或失败后场景状态与播放器状态一致；
- [x] 旧边和器件节点路径都有测试；
- [x] 现有相关测试全绿（当时 292 passed；Phase F 后 315 passed）；
- [x] `compileall` 和桌面 selftest 通过；
- [x] 性能基准没有不可接受退化（缩放 +3.6%，事务开销见报告 §4）；
- [x] 错误信息能指出节点/支路、策略和下一步诊断。

> 勾选依据：`netlab/tests/test_solver_p0.py` 13 项 + `test_element_contracts.py` 14 项 + `test_solver_transactions.py` 6 项 + 全量 292 passed（当时）+ `SOLVER_OPTIMIZATION_REPORT.md` §3/§5。Phase D/E 的退出条件见 §10，均已于 2026-10-28 04:20 满足；后续 Phase F 追加后全量为 315 passed。

任何一项未满足，阶段不能标记完成。若只是环境错误，应单独列为“未验证”，不能写成“通过”。

---

## 9. 报告模板

实现完成后新增：

```text
docs/SOLVER_OPTIMIZATION_REPORT.md
```

报告建议包含以下表格。

### 9.1 改动清单

| 文件 | 改动 | 原因 | 兼容性 |
| --- | --- | --- | --- |
| `nodal.py` | ... | ... | ... |
| `simulation.py` | ... | ... | ... |
| `scene.py` | ... | ... | ... |
| `tests/...` | ... | ... | ... |

### 9.2 问题-改动-证据对应

| 问题编号 | 改动 | 复现前 | 复现后 | 测试证据 |
| --- | --- | --- | --- | --- |
| P0-01 | 事务化 step | 失败后 time 前进 | 失败后 time 不变 | `test_...` |
| P0-07 | 矩阵缩放 | 病态矩阵误判 | 可解且真奇异可报 | `test_...` |

### 9.3 数值结果

记录：

- 用例；
- 参考解来源；
- 旧实现结果；
- 新实现结果；
- 绝对误差/相对误差；
- 矩阵规模；
- 条件数或缩放尺度；
- 是否触发回滚；
- 是否使用 gmin/source stepping。

### 9.4 性能结果

记录：

- 基准命令；
- 机器和 Python 版本；
- 样本数；
- 中位数、p95、最大值；
- 线性 LU 复用次数；
- 与改动前的差异；
- 内存或 checkpoint 复制开销。

### 9.5 风险与遗留

必须写清楚：

- 未完成的能力；
- 未覆盖的元件；
- 环境阻塞；
- 与旧结果不同的数值边界；
- 不做自适应 dt 的理由；
- Phase F 的边界：AC 只做线性小信号、DC 电感为 1e5 S 近似、Gear2 固定 dt、稀疏默认 auto。

### 9.6 收尾动作

按项目规则执行：

1. 修改前将拟改文件复制到 `NetlabExtras/backups/ProjectPoint_backups/<name>_<timestamp>/`；
2. 生成 `MANIFEST.sha256`；
3. 更新 `PROGRESS.md` 对应阶段和证据；
4. 在 `REQUIREMENTS_AND_RULES.md` §9 增加值、变更和验证结果；
5. 更新本方案中实际完成状态和遗留项；
6. 生成报告；
7. 运行测试、编译、selftest；
8. 简报说明“做了什么、证据、耗时”。

---

## 10. 分阶段执行计划

### Phase A：失败事务和诊断

范围：

- checkpoint/restore；
- 时间候选化；
- `source_scale` finally；
- 实际 gmin 配置；
- `trouble_name` 残差定位；
- 失败信息诚实化；
- 测试。

不包含：

- 矩阵缩放；
- 新器件模型；
- 信号引擎回滚。

退出条件：失败步不污染状态；所有相关回归通过。

**实施结果（2026-10-28）：✅ 完成**。`CircuitSolver.capture/restore_checkpoint`、`step` 事务包装、`_step_locked` trial 隔离、`source_scale` finally、`gmin` 读配置并默认对齐 1e-3、`_trouble_name` 最大残差、失败信息如实列策略；`Scene`/`SignalEngine` 检查点与 `Simulation` 异常/超时回滚同步落地。证据：`test_failed_step_restores_solver_and_element_state`、`test_failed_step_then_retry_matches_clean_run`、`test_source_scale_restored_after_solver_exception`、`test_timeout_restores_scene_checkpoint`。

### Phase B：矩阵均衡和残差质量

范围：

- 行列缩放；
- 缩放 LU 缓存；
- 相对后向误差；
- 线性解质量保护；
- 奇异诊断；
- 高电容细 dt 和真奇异测试。

不包含：

- 自适应 dt；
- 稀疏矩阵（**2026-10-28 用户指令推翻，Phase F / D56 已实现**）；
- GPU 大规模重构。

退出条件：病态可解与真奇异可区分；解析电路容差通过；无明显性能退化。

**实施结果（2026-10-28）：✅ 完成**。`_equilibration` 行列缩放 + 缩放 LU 缓存 + `pivot_tol`；`_residual_metric` 相对后向误差；线性分支同样做解质量检查。数值：100 µF/1 kΩ、dt=1e-6 误差 2.495e-05 V、`residual=4.44e-17`；缩放开销约 3.6%（`SOLVER_OPTIMIZATION_REPORT.md` §3/§4）。证据：`test_matrix_scaling_preserves_solution`、`test_linear_solution_quality_check`、`test_singular_matrix_reports_node`。

### Phase C：断点与超时安全

范围：

- 器件节点源断点；
- 断点时间去重和单调性；
- 超时回滚；
- 失败/重试时间轴测试。

不包含：

- 全事件驱动数字引擎；
- 自适应 LTE。

退出条件：旧边和器件节点断点一致；超时后播放器和引擎时间一致。

**实施结果（2026-10-28）：✅ 完成**。`next_breakpoint` 经 `_iter_source_params` 同时收集旧边与器件节点源，`_breakpoint_in` 统一 dc/delay/step/ramp/square/pulse 与相位；超时由 `Simulation._advance_locked` 先恢复场景再记错。证据：`test_next_breakpoint_square_and_pulse`、`test_next_breakpoint_includes_device_source`、`test_timeout_restores_scene_checkpoint`。

### Phase D：元件契约和模型边界

范围：

- 迭代猜测分层；
- BJT/MOS/Comparator/Logic/LDO 的明确行为边界；
- 公式/备注/参数同步；
- 元件级测试。

不包含：

- Gummel-Poon/BSIM；
- 结电容和噪声的完整器件库；
- 温度全局扫描。

退出条件：每个行为模型与其 catalog 公式一致；失败回滚测试覆盖。

**实施结果（2026-10-28 04:20）：✅ 完成**。P1-03 Comparator 改为回差方向记忆（`state["hys_level"]=±1`，高电平阈值 u>+hys/2、低电平阈值 u<−hys/2，`reset` 清状态；hys=0 与旧行为一致）；P1-04 `LogicGate.current()` 由两条电导支路求和，`commit` 写 current/power/supply_current；P1-05 BJT catalog 公式改为与实现一致的分段线性（`vbe_on/rin`、leak、`Ic=βIb`，`Is/n` 仅记录并用于热电压限幅）；P1-06 MOSFET 增加线性区 `Id=k(Vov·Vds−Vds²/2)`、沟道长度调制 λ、体效应（`body_node` 参数、γ/φ，`Vth=Vth0+γ(√(φ−Vbs)−√φ)`），stamp 补 gds/gmbs；P1-08 OpAmp 增加可选 `slew_rate`/`gbw`（默认 0 = 理想，动态用 `state["vout"]`）；P1-12 nodal/transistors/logic 的 spec.formula、notes 与 `ELEMENT_FORMULAS` 全部与实现同步。退出条件满足：`test_element_contracts.py`（14 项）逐模型断言公式符号/参数与实现一致，失败回滚由 `test_solver_transactions.py`（6 项）与既有 P0 用例覆盖。注意：nmos 开关用例因新增线性区，正确解由旧“纯饱和”0.5 V 变为 1.55 V，测试期望按物理修正为 `1.0 < drain < 2.0`（非放宽通过率，已在 LESSONS 记录）。

### Phase E：信号/矢量事务（独立审批）

范围：

- 节点和连接状态 checkpoint；
- 延迟边输出事务；
- 自定义 handler state 隔离；
- 性能基准。

不包含：

- 重写拓扑执行器；
- 并行化节点计算。

退出条件：失败重试与干净运行一致；信号链和矢量模板回归通过。

**实施结果（2026-10-28 04:20）：✅ 完成**。`Network.step` 改为整步事务：`capture_step_state()` 冻结 time、节点 data/state/inputs/ports、连接 state/output，任一节点抛异常则 `restore_step_state()` 原地回滚后重抛（S-01/S-02/S-03，延迟边输出 `Connection.output` 一并回滚）；自定义 handler 默认收到 `deepcopy(state)`，成功后原地写回（S-04）；`SignalEngine.step` 额外快照并回滚每个 `BlockRuntime` 的内部 Scene（块内积分器等状态），`capture_checkpoint` 携带 `"blocks"`（E2）；`BlockRuntime` 新增 `capture_checkpoint/restore_checkpoint`。证据：`test_network_step_rolls_back_on_failure`、`test_retry_after_failure_matches_clean_run`、`test_untrusted_handler_state_isolated_on_failure`、`test_untrusted_handler_state_written_back_in_place`、`test_signal_checkpoint_restores_block_state`、`test_signal_step_rolls_back_block_state_on_failure`。退出条件满足：失败后重试与干净运行逐探针一致；信号链/矢量模板全部既有回归通过（当时 292 passed）。原“独立审批”由本轮用户指令（完成报告与计划中剩余任务）覆盖。

### Phase F：能力扩展（DC / AC-Bode / Gear / 稀疏，2026-10-28 用户追加）

> 原方案把 DC 工作点、AC/Bode、Gear、稀疏化列为「能力扩展、明确不做」。用户于 2026-10-28 04:29 指令：「DC 工作点 .op、AC/Bode、Gear、稀疏化 将这些完成」，本条覆盖原口径。自适应 dt / 自适应 LTE 仍不做（D17 不变）。

范围：

- `CircuitSolver.operating_point()`：`time=0`、源取 t=0 波形值、`mode="dc"`（电容开路、电感 `DC_CONDUCTANCE=1e5` 短路近似）、复用 gmin/source stepping、`finally` 恢复检查点；
- `CircuitSolver.ac_sweep()`：工作点线性化 + 复数 MNA（C→jωC、L→1/(jωL)、源 1 V/1 A），限 `AC_KINDS` 线性元件/受控源/开关，节点与元件探针输出 magnitude/phase/db；
- `integration="gear2"`（BDF2）：C `g=1.5C/dt`、L `g=dt/(1.5L)`；历史缺失或 dt 变化回退 BE；
- `SolverOptions.sparse/sparse_threshold` + `_solve_sparse`（均衡、splu、字节级缓存、稀疏奇异诊断、无 SciPy 退稠密）；
- 接入层：Scene 映射节点名、SimConfig 透传、`GET /api/operating-point`、`GET /api/ac-sweep`、`ConfigUpdate.sparse`、`IntegrationRequest` 支持 gear2。

不包含：

- 非线性元件的小信号模型（二极管/MOS/BJT 不参与 AC，明确报错）；
- 自适应 dt、Gear3–6、AC 噪声/失真/灵敏度、UI 图表入口。

退出条件：四项能力各有可复现测试；AC 解析参考（RC 截止、反相增益）与 DC 分压/开路/短路通过；Gear2 精度优于 BE；稀疏与稠密解一致。

**实施结果（2026-10-28 04:48）：✅ 完成**。DC：10 V 分压 n2=5.0 V、R1 5 mA、V1 −5 mA，分析后 `time/solution` 不变；AC：RC 低通 fc 处 0.707107/−45.0°/−3.0103 dB，反相 VCVS 2.0/180°，二极管报「AC 分析暂不支持元件」；Gear2：RC 放电 10×1e-4 s → 1.847744（BE 1.927716，精确 1.839397），首步与 BE 相同、dt 变化回退；稀疏：60 节点与稠密 `rtol=1e-9` 一致、并联双压源报奇异、非法值报「sparse 必须是 auto、on 或 off」。证据：`test_solver_analysis.py` 11 项、`test_solver_integration.py` 6 项、`test_solver_sparse.py` 6 项；全量 **315 passed**。

---

## 11. 风险和对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| checkpoint 深拷贝过重 | 实时帧率下降 | 先用最小恢复集；基准决定是否改用 journal |
| 缩放改变旧结果最后几位 | 回归断言失败 | 用解析参考和合理容差；报告中列出差异 |
| `residual_tol=0` 兼容行为被误改 | 旧工程突然失败 | 保留默认关；内部安全检查先广泛基准 |
| 失败回滚不完整 | 仍可能污染 | 对每个 element state/result/source/time 建立清单测试 |
| 断点逻辑重复触发 | 死循环或时间不前进 | epsilon、去重、严格时间递增测试 |
| 器件模型升级过大 | 改动范围和收敛风险失控 | 先修契约；模型精度另立阶段 |
| 测试环境原生库错误 | 无法全量验收 | 单独隔离环境，保留真实日志，不伪造通过 |
| 旧边和器件节点行为分叉 | 同一电路结果不同 | 两条路径成对测试，统一波形参数读取 |

---

## 12. 需要保持的文档口径

本方案不改变现有需求，只解释和补强实现。若后续实现改变以下口径，必须按 `AGENT_GUIDE.md` 的冲突流程处理：

- 固定 `dt` 和 `lock_dt` 的语义；
- 不做自适应 dt 的决策 D17；
- `residual_tol=0` 的兼容承诺；
- 器件节点的 PinMap 和旧边兼容；
- 多接地合并和未接器件跳过；
- 回放只读、不改电路状态。

实施后需要同步：

- `PROGRESS.md`：阶段状态、测试数量、备份位置；
- `REQUIREMENTS_AND_RULES.md` §9：变更记录；
- `SOLVER_CODE_MAP.md`：求解器调用链、事务和缩放入口；
- `LESSONS.md`：失败回滚、缩放和细 dt 的踩坑；
- 本方案：完成状态、实际改动和遗留项；
- `SOLVER_OPTIMIZATION_REPORT.md`：数值、性能和风险证据。

---

## 13. 当前结论

优先级应是：

```text
失败事务
  > 矩阵尺度与残差
  > 器件节点断点
  > 超时一致性
  > 元件契约
  > 信号/矢量事务
  > DC/AC/Gear/稀疏化等能力扩展（2026-10-28 已完成，见 Phase F）
```

原因：

1. 失败事务修复后，所有后续数值调试才有可信起点；
2. 缩放和残差修复后，细 `dt` 不再被简单的“奇异”阈值误杀；
3. 断点修复后，固定 `dt` 的确定性和波形边沿可信度同时成立；
4. 元件模型升级应在共同边界可靠之后进行，否则很难区分“模型错”还是“事务/矩阵错”；
5. 自适应 dt、DC/AC 和稀疏化是能力扩展，不应与基础正确性修复混在同一批；其中 DC/AC/Gear2/稀疏已由用户 2026-10-28 指令在 Phase F 单独实施（自适应 dt 仍不做）。

本文件可作为后续实现和独立审查的票单依据。实际修改前仍需按项目规则建立备份并在修改完成后更新进度、需求记录和验证报告。
