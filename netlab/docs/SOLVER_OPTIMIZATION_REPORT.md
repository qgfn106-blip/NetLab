# 求解器加固实施报告（P0 事务 / 矩阵均衡 / 断点 / 超时）

> 最后修改：2026-10-28 19:05
>
> 对应方案：[SOLVER_OPTIMIZATION_PLAN.md](SOLVER_OPTIMIZATION_PLAN.md)
>
> 阶段状态：**Phase A/B/C/D/E 全部完成**（D：元件契约与模型边界；E：信号/矢量整步事务）；**R26 能力扩展（DC 工作点 / AC-Bode / Gear2 / 稀疏矩阵）已于 2026-10-28 完成**（用户推翻原「不做」清单，见 `REQUIREMENTS_AND_RULES.md` R26 / D53–D56）。
>
> 验证：`python -m pytest netlab/tests -q --basetemp .pytest_tmp` → **315 passed, 2 warnings**；`python -m compileall -q netlab` 通过；`python -m netlab.desktop --selftest` → `"ok": true`。

---

## 0. 结论

本轮把“求解失败”从**无法回滚的副作用**变成**事务边界**：失败步不再推进 `CircuitSolver.time`、不改变 `solution`/`node_voltages`、不污染元件已提交状态；`Simulation._advance_locked` 在异常或超时时把场景恢复到步前检查点。数值侧改为**尺度无关后向残差** + **行列均衡的缩放 LU**，线性电路也做最小解质量检查；断点扫描从“只遍历旧边”迁移到“旧边 + 器件节点源”；诊断信息按最大残差节点定位，并且只声明真正尝试过的 gmin/source stepping。

未完成项在 §6 明确列出，不把计划写成已完成。

---

## 1. 改动清单（§9.1）

| 文件 | 改动 | 原因 | 兼容性 |
| --- | --- | --- | --- |
| `netlab/core/compute/nodal.py` | `CircuitSolver._capture_element_state` / `capture_checkpoint` / `restore_checkpoint` / `zero_time`（`nodal.py:1361-1412`）；`step` 改为事务包装（`nodal.py:1421`），失败恢复后重抛 | P0-01/02/03：失败步不得留下时间/解/元件历史副作用 | 新增 API；`Scene.step(dt)` 签名不变 |
| `netlab/core/compute/nodal.py` | `_step_locked`（`nodal.py:1432`）：gmin 从 `options.gmin` 起步并逐 trial ×0.1；gmin/source stepping 每次 trial 前后快照/恢复元件状态；`last_strategies` 只记录实际尝试；错误文本带最大残差节点与“已尝试：…” | P0-03/05/11：配置真实生效、trial 隔离、提示诚实 | 失败仍抛 `ComputeError`，文案更具体 |
| `netlab/core/compute/nodal.py` | `_newton_solve`（`nodal.py:1586`）：每轮算相对后向残差；`residual_tol>0` 用显式阈值，否则用 `residual_safety_tol`；线性分支也做解质量检查；`source_scale` 放 `try/finally` 必恢复 | P0-04/06/08：量纲无关判据、线性解保护、异常不泄漏源比例 | `residual_tol` 默认仍为 0（只记录不强制） |
| `netlab/core/compute/nodal.py` | `_residual_metric`（`nodal.py:1574`）：`max(|Ax-b|) / (max(|A||x|) + dt·max|b| + 1e-30)`，返回最大残差下标 | P0-06：电压/电流/电导混合量纲下可比较 | 仅内部判据 |
| `netlab/core/compute/nodal.py` | `_solve_matrix`（`nodal.py:1672`）+ `_equilibration`（`nodal.py:1737`）：行列缩放后分解，缓存缩放 LU 与列尺度；`pivot_tol` 判零主元；仍保留 `solve_linear` 回退 | P0-07：病态可解矩阵不再被“未缩放对角线”误杀，真奇异仍报错 | 缩放默认开启；`SolverOptions.scaling` 可关；结果与旧实现只差最后几位 |
| `netlab/core/compute/nodal.py` | `_trouble_name`（`nodal.py:1547`）优先用 `_worst_residual_index`；`_build_index` 对未知量排序 | P0-12：诊断指向真正问题节点；未知量顺序确定化 | 节点/支路命名规则不变 |
| `netlab/core/compute/simulation.py` | `SimConfig` 增加 `residual_safety_tol=1e-8`、`scaling=True`、`pivot_tol=1e-14`；`apply_config` 增加允许键与 `SolverOptions` 传递（`simulation.py:431-437`） | P0-06/07 可配置、可持久化 | 旧工程缺字段时取默认值；UI 暂未暴露（stats 记录实际生效值） |
| `netlab/core/compute/simulation.py` | `_advance_locked`（`simulation.py:170`）在 `scene.step` 前取 `Scene.capture_checkpoint()`，异常与超时都先 `restore_checkpoint` 再记录错误 | P0-10：超时/失败后播放器时间与引擎状态一致 | `Simulation.time/steps` 语义不变 |
| `netlab/core/model/scene.py` | `CircuitEngine.capture_checkpoint/restore_checkpoint`（`scene.py:591-625`）：求解器检查点 + 节点 `data`/`inputs` + 非元件边状态；恢复时就地改写字典并重新绑定元件共享 `state` | P0-01：场景层也要可回滚，且不破坏 `Node` 引用 | 新增方法 |
| `netlab/core/model/scene.py` | `SignalEngine.capture_checkpoint/restore_checkpoint`（`scene.py:353-390`）：`network.time`、节点 data/state/inputs、边状态、`block_buffers` | Phase E 部分：信号步可回滚 | 新增方法；执行器未重写 |
| `netlab/core/model/scene.py` | `Scene.capture_checkpoint/restore_checkpoint`（`scene.py:726-736`）按引擎实例校验后转发 | 供 `Simulation` 使用 | 新增方法 |
| `netlab/core/model/scene.py` | `next_breakpoint` 重构（`scene.py:738-790`）：`_iter_source_params()` 同时收集旧边与器件节点上的 `vsource/isource`；`_breakpoint_in()` 统一处理 dc/delay/step/ramp/square/pulse，含相位 | P0-09：R20 器件节点波形边沿不再跨 `dt` | 旧边路径与器件节点路径共用同一实现 |
| `netlab/core/compute/transistors.py` | `BipolarJunction` 增加 `iteration_guess["vbe"]`：`stamp` 读当前猜测，`update_guess` 只写猜测，`commit` 才写已提交 `state` | P0-02/P1-01：BJT 猜测与历史分层 | 盖章方程未改 |
| `netlab/core/compute/timers.py` | LDO `stamp` 不再写 `self.value`，改用 `iteration_guess["value"]` 与本地 `target`；`commit` 才提交；`reset()` 复位 `value`/猜测；时钟 `SquareSource.reset` 复位 `value=vlow` | P0-02/P1-02：消除 stamp 副作用 | 行为不变，失败不再污染 |
| `netlab/tests/test_solver_p0.py` | 新增/扩充 13 项：配置跟随、默认 gmin、奇异、方波/脉冲断点、预计算、失败步恢复、失败后重试=干净运行、线性解质量、源比例恢复、gmin 起点来自配置、缩放保解、器件节点断点、超时回滚 | 每个 P0 项要有可复现证据 | 仅测试 |
| `netlab/core/compute/nodal.py` | `OpAmp` 新增可选参数 `slew_rate`（V/s）/`gbw`（Hz）与 `_dynamic()`：`state["vout"]` 记录上一拍输出，`α=1−exp(−dt/τ)`、`τ=1/(2π·gbw)`，再按 `|Δv|≤slew_rate·dt` 钳位；`reset` 清 `vout`，`commit` 提交 `vout` | P1-08：行为模型要有转换速率/带宽边界；默认 0 保持理想代数解 | 新增参数默认 0，旧工程行为不变 |
| `netlab/core/compute/nodal.py` | `Comparator` 迟滞改为回差方向记忆：`state["hys_level"]`（0 未定/+1 高/−1 低），`_f` 用 `offset=+0.5·hys·level`，`commit` 按输出相对中点更新电平（死区 `1e-3·span` 防抖）；`reset` 清状态 | P1-03：固定输入偏移没有方向记忆，无法表达施密特特性 | hys=0 时恒为 0，与旧行为一致 |
| `netlab/core/compute/nodal.py` | `spec.formula`/`notes` 与 `ELEMENT_FORMULAS` 全部与实现同步：diode（`min(60,·)`、`__name__junction`）、zener（softplus 击穿）、led、opamp（tanh + slew/gbw）、comparator（`off=+hys/2` / `−hys/2`）、nmos/pmos（三态 + λ + γ 体效应）、bjt_npn/pnp（分段线性） | P1-12：catalog 公式与实际执行路径漂移，用户会误读模型 | 只改文本与参数说明，数值路径不变 |
| `netlab/core/compute/logic.py` | `LogicGate` 新增 `_currents(ctx)`：`i_up=(drive/Ron)(v_a−v_VDD)`、`i_down=((1−drive)/Ron)(v_a−v_b)`；`current()` 返回和，`commit` 写 current/voltage_difference/power/supply_current，公式两行同步 | P1-04：`current()` 恒 0 与两条电导 stamp 矛盾 | 新增探针值，排版方程未变 |
| `netlab/core/compute/transistors.py` | `Mosfet` 增加线性区（`Vds<Vov` 时 `Id=k(Vov·Vds−Vds²/2)`）、沟道长度调制 λ（`clm=1+λ·Vds`）、体效应（`body_node` 参数 + γ/φ，`Vth=Vth0+γ(√(φ−Vbs)−√φ)`）；`_operating_point()` 返回 `(Id,gm,gds,gmbs,vgs,vds,vbs)`，`stamp` 盖章 gds/gmbs；`_drain_current(vgs,vds=0)` 保留旧签名为兼容包装 | P1-06：只有饱和平方律，开关电路的导通压降明显失真 | 默认 `λ=0/γ=0` 与旧饱和数值一致；新增参数向后兼容 |
| `netlab/core/compute/transistors.py` | 修复 `Mosfet.stamp`：`A[di,di]+=gds` 原被写在 `si is not None` 分支内，源极接地时 gds 丢失 → 线性区/饱和区之间 2 周期极限环（60 次不收敛，残差却为 0） | P1-06 实测回归：nmos 开关用例暴露 | 源极接地时也加自电导，nmos 开关解从 0.5 V 修正为 1.55 V |
| `netlab/core/compute/transistors.py` | `BJT_SPECS` 公式改为分段线性（`Vbe≤vbe_on` 时 `Ic≈0`；否则 `Ib=(Vbe−vbe_on)/rin`、`Ic=βIb`，`leak=1e-9`），注明 `Is/n` 仅记录并用于热电压限幅 | P1-05：catalog 写指数模型、代码是分段线性 | 仅文档/参数说明，电流路径不变 |
| `netlab/core/model/graph.py` | `_state_snapshot()`；`Node.update` 对非 trusted handler 传 `deepcopy(state)`、成功后原地回写；`Network.step` 整步事务：`capture_step_state()` 冻结 time/节点 data/state/inputs/ports/连接 state/output，异常 `restore_step_state()` 原地恢复后重抛 | Phase E S-01/S-02/S-03/S-04：逐节点提交导致半步推进与 handler 直接改内部状态 | 新增 API；正常路径结果不变 |
| `netlab/core/model/scene.py` + `netlab/core/model/blocks.py` | `SignalEngine.step` 先快照每个 `BlockRuntime`（内部 Scene 的积分器等状态），失败逐块恢复；`capture_checkpoint` 携带 `"blocks"`；`BlockRuntime.capture_checkpoint/restore_checkpoint` 转发内部 Scene | Phase E E2：网络事务不覆盖功能块内部状态 | 新增方法/字段，旧检查点缺 `"blocks"` 时按无块处理 |
| `netlab/tests/test_element_contracts.py`（新增 14 项） | catalog 公式↔实现一致性（diode/zener/BJT/MOS/比较器/运放）；比较器回差方向、hys=0 兼容、整电路三角波翻转阈值；逻辑门电流/power；MOS 线性区/饱和/λ/体效应；运放 slew/gbw 单步行为 | Phase D 退出条件：每个行为模型与其公式一致 | 仅测试 |
| `netlab/tests/test_solver_transactions.py`（新增 6 项） | `Network.step` 失败回滚、失败后重试=干净运行、untrusted handler state 隔离/原地回写、SignalEngine 检查点恢复块状态、SignalEngine 失败步回滚块状态 | Phase E 退出条件：失败重试与干净运行一致 | 仅测试 |
| `netlab/core/compute/nodal.py` | 新增 `CircuitSolver.operating_point()`：不调 `prepare`、`time=0`、源取 `waveform_value(params,0)`；`StampContext(mode="dc")` 下电容不盖章（开路）、电感用 `DC_CONDUCTANCE=1e5`（≈10 µΩ）短路、非线性元件工作点线性化；复用 gmin/source stepping；成功后 `commit` 出 `node_voltages/elements`，`finally` 恢复检查点（不改瞬态状态） | P2-01 / R26：把「瞬态第一拍当工作点」换成独立 DC 解 | 新增 API；不改变 `step` 语义 |
| `netlab/core/compute/nodal.py` | 新增 `CircuitSolver.ac_sweep(frequencies, *, input_source=None, probes=None)`：先求工作点，再逐频点 `mode="ac"`、`omega=2πf` 的复数 MNA（C→jωC、L→1/(jωL)、源取 1 V/1 A）；`AC_KINDS` 限定线性元件与受控源，非线性元件报「AC 分析暂不支持元件」；探针支持节点电压与 R/C/L/源电流，输出 `magnitude/phase_deg/db`；只读 | P2-04 / R26：Bode 需要工作点线性化，不能拿瞬态波形代替 | 新增 API |
| `netlab/core/compute/nodal.py` | `integration` 新增 `"gear2"`（BDF2）：C `g=1.5C/dt`、`src=C(−2v_n+0.5v_{n−1})/dt`；L `g=dt/(1.5L)`、`src=(2i_n−0.5i_{n−1})/1.5`；历史不足或 `gear_dt != dt` 回退 backward_euler 并滚动 `v_prev/i_prev/gear_dt` | P2-03 / R26：二阶积分选项 | 固定 dt 语义不变；新选项不影响旧工程 |
| `netlab/core/compute/nodal.py` | `SolverOptions.sparse="auto"|"on"|"off"` + `sparse_threshold=200`；`_build_index` 选 `_blank_matrix()`（lil/稠密）；`_newton_solve` 每轮新建；`_solve_sparse()` 用稀疏均衡 + `splu` + 字节级缓存键，奇异映射为「电路矩阵奇异（稀疏 LU）」；`_check_floating` 用 `getnnz(axis=1)`；无 SciPy 自动退稠密 | P2-05 / R26：大未知量 O(n³) 的装配层优化 | `sparse` 默认 auto；数值结果与稠密同口径 |
| `netlab/core/model/scene.py` / `netlab/core/compute/simulation.py` / `netlab/server.py` | `CircuitEngine.operating_point()/ac_sweep()` 做 `ComputedNode.id → CircuitNode.name` 映射；`Scene` 校验 `mode=="circuit"`；`SimConfig.sparse/sparse_threshold` 与 `Simulation.operating_point()/ac_sweep()`；`GET /api/operating-point`、`GET /api/ac-sweep`（log/lin、points、probes）、`ConfigUpdate.sparse`、`IntegrationRequest` 加 `gear2` | R26 要从 API/场景层可达，且错误在入口就明确 | 新增端点/字段；旧客户端缺省值不变 |
| `netlab/tests/test_solver_analysis.py`（新增 11 项）/ `test_solver_integration.py`（6 项）/ `test_solver_sparse.py`（6 项） | DC 分压/电容开路/电感短路/不污染状态；AC RC 截止 −3.0103 dB@−45°、反相 VCVS 180°、默认激励与探针、二极管拒绝、非法频率/激励/探针；Gear2 精度优于 BE、首步与 dt 变化回退、RL；稀疏 auto 阈值、60 节与稠密逐点一致、并联源诊断、非法 sparse 报错 | R26 每项能力必须有可复现证据 | 仅测试 |

**默认值变化说明**：`SolverOptions.gmin` / `SimConfig.gmin` 从 `1e-12` 改为 `1.0e-3`。旧实现硬编码 gmin stepping 从 `1e-3` 起步，`options.gmin` 实际没被使用；改为读取配置后若默认仍是 `1e-12`，救急路径会退化成几乎不生效。因此默认值对齐历史行为（1e-3 递减），并加 `test_default_gmin_stepping_starts_at_legacy_value` 防止再漂移。

---

## 2. 问题-改动-证据对应（§9.2）

| 问题 | 改动 | 复现前 | 复现后 | 测试证据 |
| --- | --- | --- | --- | --- |
| P0-01 失败后时间仍推进 | `step` 事务包装 + 场景检查点 | 失败步 `time` 已 +dt，`solution` 已被污染 | 失败后 `time`/`solution`/`node_voltages` 与步前一致 | `test_failed_step_restores_solver_and_element_state`、`test_timeout_restores_scene_checkpoint` |
| P0-02 Newton 写已提交状态 | Diode/BJT/LDO 猜测分层 | 失败 trial 的 `vd/vbe/value` 留在 `state` | 只有 `commit` 写 `state`，失败恢复猜测 | `test_failed_step_then_retry_matches_clean_run` |
| P0-03 stepping 共用污染状态 | 每 trial 快照/恢复元件状态 | 失败 trial 成为下一次初值 | 每次 trial 从干净猜测开始 | `test_failed_step_then_retry_matches_clean_run` |
| P0-04 `source_scale` 异常不恢复 | `try/finally` 必复位为 1.0 | 异常后后续试算仍用部分源值 | 异常抛出后 `source_scale == 1.0` | `test_source_scale_restored_after_solver_exception` |
| P0-05 gmin 配置无效 | 起点读 `options.gmin`，默认回到 1e-3 | 配置 0.02 仍从 1e-3 起 | 起点等于配置值 | `test_gmin_start_value_comes_from_options`、`test_default_gmin_stepping_starts_at_legacy_value` |
| P0-06 残差不尺度无关 | `_residual_metric` 相对后向误差 | `max(|Ax-b|)` 随量纲漂移 | 高电容细 dt 残差 `4.44e-17`（见 §3） | `test_matrix_scaling_preserves_solution` |
| P0-07 奇异误判 | 行列均衡 + 缩放 LU + `pivot_tol` | 病态可解报“奇异” | 病态可解；双电压源仍报零主元 | `test_matrix_scaling_preserves_solution`、`test_singular_matrix_reports_node` |
| P0-08 线性解无质量检查 | 线性分支也计算残差并按阈值检查 | 有害解直接 commit | 返回零解时抛“线性电路解质量不足”并回滚 | `test_linear_solution_quality_check` |
| P0-09 器件节点断点漏扫 | `_iter_source_params` 合并两类来源 | 器件节点方波边沿跨 `dt` | 断点出现在候选时刻 | `test_next_breakpoint_includes_device_source`、`test_next_breakpoint_square_and_pulse` |
| P0-10 超时非事务 | `_advance_locked` 超时先恢复场景 | 超时后场景已推进 | 超时后场景时间/状态回到步前 | `test_timeout_restores_scene_checkpoint` |
| P0-11 失败提示不诚实 | `attempted` 列表 +“未启用”分支 | `gmin_steps=0` 仍说“已尝试 gmin” | 只列实际尝试项 | `test_gmin_start_value_comes_from_options`（断言 `last_strategies`） |
| P0-12 诊断指向最大未知量 | 记录 `_worst_residual_index` | 指向大电压节点而非坏方程 | 指向最大残差节点/支路 | `test_singular_matrix_reports_node`、失败步报错断言 |
| P1-03 比较器无回差记忆 | `hys_level` + 方向相关偏移 | 上升/下降沿共用同一阈值（`u+hys`） | 上升沿 `u>+hys/2` 翻高、下降沿 `u<−hys/2` 翻低 | `test_comparator_hysteresis_direction`、三角波整电路用例 |
| P1-04 逻辑门电流恒 0 | `_currents()` 两条电导求和 | `probes["e:G1:current"]` 恒为 0 | and 门带 1k 负载时约 −4.7 mA，power≥0 | `test_logic_gate_current_and_power` |
| P1-05 BJT 文档/实现漂移 | catalog 改分段线性并说明 `Is/n` 只做记录 | 用户按指数模型理解开关行为 | 公式含 `vbe_on/rin`、不含 `e^{` | `test_catalog_bjt_matches_piecewise_implementation` |
| P1-06 MOSFET 无线性区/体效应 | 三态模型 + λ + γ，stamp 补 gds/gmbs | nmos 开关旧解 0.5 V（纯饱和） | 新解 1.5505 V（线性区），λ/γ 分别改变 Id/gm/gds | `test_mosfet_triode_and_saturation`、`test_mosfet_channel_length_and_body_effect`、`test_nmos_switch` |
| P1-06 回归 源极接地丢 gds | `Mosfet.stamp` 自电导移出 `si is not None` 分支 | 60 次 Newton 不收敛，`vd` 在 0.5↔4.875 V 振荡 | 一次收敛到 1.55 V | `test_nmos_switch` |
| P1-08 运放无动态边界 | 可选 `slew_rate/gbw` + `_dynamic()` | 单步可无限跳变 | SR=1e4 时单步差 ≤1 V；GBW 给出一阶滞后 | `test_opamp_slew_and_bandwidth_limits` |
| P1-12 catalog 公式漂移 | spec.formula + `ELEMENT_FORMULAS` 全量同步 | 公式与执行路径不一致 | 公式关键符号与实现一致 | `test_element_contracts.py` 一致性用例组 |
| S-01/S-02/S-03 半步提交 | `Network.step` 整步事务 + 延迟边输出回滚 | 失败时前半节点/连接已写入 | 失败后 time/节点/连接全部回到步前 | `test_network_step_rolls_back_on_failure`、`test_retry_after_failure_matches_clean_run` |
| S-04 handler 直改 state | 非 trusted handler 收 `deepcopy(state)`，成功后原地回写 | 异常 handler 的中间写入留在节点 | 异常后 state 为空，正常路径 dict 身份不变 | `test_untrusted_handler_state_isolated_on_failure`、`test_untrusted_handler_state_written_back_in_place` |
| E2 块内状态不随网络回滚 | `BlockRuntime` 检查点 + `SignalEngine.step` 逐块快照 | 失败步后积分器仍被推进 | 回滚后重放与干净运行一致 | `test_signal_step_rolls_back_block_state_on_failure`、`test_signal_checkpoint_restores_block_state` |

---

## 3. 数值结果（§9.3）

| 用例 | 参考解来源 | 结果 | 说明 |
| --- | --- | --- | --- |
| 100 µF + 1 kΩ RC，5 V step，dt=1e-6，200 步（t=2.000e-4 s） | 解析 `v = 5(1−e^{−t/RC})` = 0.009990 V | 0.009965 V，绝对误差 **2.495e-05 V** | 旧实现此前在该 dt 因 `2C/dt=200 S` 与 1 kΩ 混合被判奇异；现可解，`residual=4.44e-17`，`scaling=True` |
| 11 节点 RC 阶梯，dt=1e-4，1500 步 | 与未缩放解逐点对照 | 缩放前后解一致（测试 `test_matrix_scaling_preserves_solution`） | 缩放只改求解路径，不改方程 |
| 双电压源并联 | 真奇异 | 仍抛 `ComputeError("电路矩阵奇异（零主元）…")` 并报节点 | `test_singular_matrix_reports_node`；scipy 仍会先发一条 `LinAlgWarning`，属预期内的底层提示 |
| VCVS 精确增益 | 解析增益 | 1.0× 输入（回归用例 `test_vcvs_gain_is_exact`） | 缩放 LU 缓存重建已验证 |
| NMOS 开关（VCC=5 V、VG=5 V、RD=1 kΩ、k=1 mA/V²、Vth=2 V） | 手算：`Vds=1.5505 V`，`Id=k(Vov·Vds−Vds²/2)=3.4495 mA`，`(5−1.5505)/1k=3.4495 mA` | 1.5505 V | 旧纯饱和模型给 0.5 V；`test_nmos_switch` 断言改为 `1.0<drain<2.0` 并在 LESSONS 记录 |
| 比较器回差（hys=1 V、±1 V/10 Hz 三角波、gain=1e5） | 理想翻转阈值 ±0.5 V | 上升沿 ∈(0.35,0.65) V，下降沿 ∈(−0.65,−0.35) V | 与施密特方向一致；`hys=0` 时仍为 0 V（旧行为） |
| 逻辑门电流（and 门、Ron=50 Ω、VDD=5 V、1 kΩ 负载） | 分压 `v_out≈4.76 V`，`i_up≈(4.76−5)/50≈−4.7 mA` | `probes["e:G1:current"]≈−4.7 mA`、`power≥0` | 旧实现恒为 0；`test_logic_gate_current_and_power` |
| 运放转换速率（SR=1e4 V/s、dt=1e-4 s） | 单步输出差上限 `SR·dt=1 V` | 输出差钳位到 1 V | `test_opamp_slew_and_bandwidth_limits` |
| MOSFET 体效应（γ=0.5 √V、φ=0.7 V、Vbs=−0.3 V） | `Vth=Vth0+γ(√(φ−Vbs)−√φ)=Vth0+0.0967 V` | 与解析值一致（1e-9 相对误差） | `test_mosfet_channel_length_and_body_effect` |

所有数值回归都在既有容差内；没有发现“缩放改变旧结果最后几位”导致断言失败的情况。

---

## 4. 性能结果（§9.4）

环境：本机 Windows，Python 3.13.9，NumPy/SciPy，CPU（无 CuPy）。

| 基准 | 结果 |
| --- | --- |
| 11 节点 RC 阶梯，dt=1e-4，1500 步，开启缩放 | **0.315 ms/step** |
| 同上，关闭缩放 | **0.304 ms/step** |
| 缩放开销 | 约 **3.6%** |
| `capture_checkpoint()` 单独 | **0.133 ms** |
| 裸 `_step_locked()` | **0.155 ms** |
| 事务总开销 | 小电路每步约 **0.29 ms**（检查点约占 +86%），仍远低于 30 fps 帧预算；长 `precompute` 会线性累积 |

结论：本轮保留 `deepcopy` 检查点（正确性优先）。若后续大规模预计算出现可感知卡顿，再按方案 §11 评估 journal/最小恢复集；本轮不做。

---

## 5. 测试与验收（§8.5）

| 验收项 | 结果 |
| --- | --- |
| 失败步不改变时间/解/元件状态 | ✅ `test_failed_step_restores_solver_and_element_state` |
| 失败后重跑 = 干净运行 | ✅ `test_failed_step_then_retry_matches_clean_run`（按探针名比较，规避两场景节点 id 排序差异） |
| gmin/source stepping 不泄漏状态/源比例 | ✅ trial 快照 + `finally` 复位 |
| `SolverOptions.gmin` 生效 | ✅ `test_gmin_start_value_comes_from_options` |
| 细 dt 高电容可解 + 解析回归 | ✅ §3 第一行 |
| 双电压源并联仍判真奇异 | ✅ `test_singular_matrix_reports_node` |
| 线性电路最小解质量检查 | ✅ `test_linear_solution_quality_check` |
| 器件节点源断点覆盖 | ✅ `test_next_breakpoint_includes_device_source` |
| 断点后时间严格递增 | ✅ 既有断点回归 + 预计算测试 |
| 超时/失败后场景与播放器一致 | ✅ `test_timeout_restores_scene_checkpoint` |
| 旧边与器件节点两条路径都有测试 | ✅ `test_next_breakpoint_square_and_pulse` / `test_next_breakpoint_includes_device_source` |
| 每个行为模型与 catalog 公式一致 | ✅ `netlab/tests/test_element_contracts.py` 14 项 |
| 信号步失败重试与干净运行一致 | ✅ `test_retry_after_failure_matches_clean_run`（逐节点/连接/时间） |
| 延迟边输出与会话状态回滚 | ✅ `test_network_step_rolls_back_on_failure` |
| 自定义 handler state 隔离 | ✅ `test_untrusted_handler_state_isolated_on_failure` / `..._written_back_in_place` |
| 现有测试全绿 | ✅ **315 passed, 2 warnings**（8.88 s） |
| `compileall` / 桌面 selftest | ✅ COMPILE_OK / `"ok": true` |
| 性能无明显退化 | ✅ 缩放 +3.6%；事务开销见 §4；新增模型只增加每步算术量 |
| 错误信息含节点/策略/诊断 | ✅ 最大残差节点 + “已尝试：…”/“未启用…” |

两条 warning 均为既有环境提示：starlette/httpx 弃用提示；真奇异用例中 scipy 的 `LinAlgWarning`（显式零主元检查随后仍抛 `ComputeError`）。

`netlab/tests/test_solver_p0.py` 现有 13 项：配置跟随、默认 gmin、奇异、方波/脉冲断点、预计算、失败步恢复、失败后重试一致、线性解质量、源比例恢复、gmin 起点、缩放保解、器件节点断点、超时回滚。Phase D/E 新增 `netlab/tests/test_element_contracts.py`（14 项，公式↔实现一致性 + 行为边界）与 `netlab/tests/test_solver_transactions.py`（6 项，整步事务 + handler 隔离 + 块状态回滚）；R26 新增 `test_solver_analysis.py`（11 项）、`test_solver_integration.py`（6 项）、`test_solver_sparse.py`（6 项）。

---

## 6. 风险与遗留（§9.5）

**已完成**

- Phase D 全部完成：Comparator 回差方向记忆（P1-03）、LogicGate 电流（P1-04）、BJT 公式与分段线性实现对齐（P1-05）、MOSFET 线性区/λ/体效应（P1-06）、OpAmp 转换速率/带宽（P1-08）、catalog 公式全同步（P1-12）；每个模型在 `test_element_contracts.py` 有公式/符号级断言。
- Phase E 全部完成：`Network.step` 整步事务（含延迟边输出回滚）、非 trusted handler state 隔离、`SignalEngine` 块内状态快照与回滚、失败重试一致性测试。
- R26 能力扩展完成（用户 2026-10-28 推翻原「不做」）：DC 工作点（`operating_point()`，含 op 后状态不被污染）、AC/Bode（`ac_sweep()`，工作点线性化 + 复数 MNA，限线性元件）、Gear2（BDF2，回退规则见 D55）、稀疏矩阵（auto>200，splu，无 SciPy 退稠密）；API 三个端点接通；UI 图表入口未接。

**仍未做 / 明确不做**

- 自适应 dt（D17 明确不做）、自适应 LTE；AC 只做线性小信号（非线性元件明确拒绝），DC 电感用 `1e5 S` 短路近似（不是 0 Ω）；BJT/MOS 不宣称器件级（无 Gummel-Poon/BSIM、无结电容）。
- R26 的 UI 入口未接：DC 工作点/AC 扫频目前只有 HTTP API 与场景层方法，没有图表按钮与分析面板。
- 前端求解器面板未暴露 `residual_safety_tol/scaling/pivot_tol`；按方案 §6.2 允许“先不暴露”，`stats()` 已记录 `scaling/pivot_tol/residual/strategies`。
- 整步事务的性能基准（方案 §8.3 的 E2 项）未单独出表：本轮只保证既有基准与全量测试不退化，未对 `Network.step` 的 checkpoint 做微基准。

**已修正的既有断言**

- `test_transistors.py::test_nmos_switch`：旧断言 `drain<1.5` 编码了“纯饱和模型”的错误物理（旧解得 0.5 V）。加入线性区后正确解为 1.5505 V，断言改为 `1.0<drain<2.0`；这是物理模型修正导致的期望更新，不是放宽通过率（LESSONS 记录）。

**数值边界**

- `residual_safety_tol=1e-8` 目前是“回归校准”值（全绿），尚未按方案 §6.2 在全部模板上做基准标定；报告如实标注。
- `gmin` 默认值由 `1e-12` 改为 `1e-3` 是本轮唯一的行为默认值变化，理由是恢复历史 gmin stepping 语义；已在测试中固定。
- 缩放可能改变结果最后几位；现有回归均在容差内，若未来出现严格逐位断言，应按方案 §5.2 用解析参考替代。
- MOSFET 新增 λ/γ 默认 0、OpAmp 新增 SR/GBW 默认 0，旧工程数值不变；启用后属行为模型边界，不是器件级精度。

**性能**

- 检查点深拷贝在小电路上约 +86%/步；本轮接受。后续若预计算变慢，优先做 journal 或只复制受影响元件，而不是删检查点。

**环境**

- 本机无 CuPy，GPU 路径未验证；与求解器加固无关，继续沿用既有“CPU 回退已验证”口径。

---

## 7. 收尾动作（§9.6）

1. 备份：`NetlabExtras/backups/ProjectPoint_backups/netlab_20261028_0405/`（改动前 `graph.py`、`logic.py`、`nodal.py`、`transistors.py` + `MANIFEST.sha256`）、`NetlabExtras/backups/ProjectPoint_backups/netlab_20261028_0318/`（P0 轮），以及本轮文档备份 `NetlabExtras/backups/ProjectPoint_backups/netlab_docs_20261028_0420/`（含 `MANIFEST.sha256`）。
2. `PROGRESS.md`：头部测试数 292、备份位置；§7 记录 Phase D/E 改动与证据。
3. `REQUIREMENTS_AND_RULES.md` §9：新增变更记录行。
4. `LESSONS.md`：补“源极接地丢 gds 导致 Newton 极限环”“纯饱和模型断言 vs 线性区物理修正”“handler state 必须隔离”三条踩坑。
5. `SOLVER_CODE_MAP.md`：补 §5.2.1 整步事务与行为模型入口。
6. `SOLVER_OPTIMIZATION_PLAN.md`：§10 Phase D/E 已标 ✅ 完成并写明遗留边界。
7. 测试、`compileall`、桌面 selftest 均已通过（见 §5）：**292 passed** / COMPILE_OK / `"ok": true`。
8. R26 收尾（2026-10-28 04:48）：代码备份 `NetlabExtras/backups/ProjectPoint_backups/netlab_20261028_0434/`、文档备份 `netlab_docs_20261028_0445/`；`PROGRESS.md` §7.9、`REQUIREMENTS_AND_RULES.md` R26 + D53–D56 + §9、`LESSONS.md`、`SOLVER_CODE_MAP.md` §5.5、`SOLVER_OPTIMIZATION_PLAN.md` §10 Phase F 均已更新；全量 **315 passed**。
