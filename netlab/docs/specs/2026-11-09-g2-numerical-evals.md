# G2 规格：可被外部检验的数值对照（层 A/B/C/D/E/F）

日期：2026-11-09
依据：`docs/NETLAB_PLOTKIT_STRICT_AUDIT_2026-11-09.md` §7.1–§7.2、§10.3

## 目标

把“跑通了/自家两条路径一致”替换为**不看源码可复算**的证据：

- 层 A 解析解：RC 充电、RLC 阶跃，闭式解 + 双容差（abs/rel）。
- 层 B 不变量：节点 KCL 残差、RLC 能量漂移有界。
- 层 D 收敛阶：dt 减半，Richardson 实测阶与声明阶比较；**源步末采样导致的 1 阶降阶必须暴露**。
- 层 C 外部交叉：用 scipy `solve_ivp` 独立积分 RC/RLC，与 Netlab 固定步长结果对比。
- 层 E 病态与事件：`reset`/`zero_time` 语义、非法 dt、负参数、奇异电路必须显式报错且不产生 NaN。
- 层 F 变异：`Resistor.stamp` 注入 5% 误差，解析解对照必须变红；`tools/mutation_smoke.py` 跑 6 个变异体，分数 ≥0.6。

## 问题定义

`docs/canonical/problems/*.yaml`，字段固定：`id/family/input_domain/observable/independent_reference/tolerance/scale_axis/exclusions`。
参考解必须独立于实现；禁止以 Netlab 另一条求解路径作为参考。

## 验收

1. `tests/evals/` 下四层测试可单独运行，全量 pytest 不回归。
2. `tools/bench_solver.py` 输出 `reports/bench.jsonl`，每行含 `problem/solver/nodes/dt/err_abs/err_rel/observed_order/residual/wall_ms`；`residual` 是独立计算的 KCL 失配，不是线性求解后向误差。
3. 已知降阶用 `xfail(strict=True)` 显式登记，不允许静默通过或放宽断言。
4. 变异测试在变异体下失败（红），在原实现下通过（绿）。

## 非目标

- 不在本轮修内核（P3）；只建立能暴露问题的门。
- 不引入 ngspice/PySpice；层 C 先用 scipy 独立积分器，ngspice 留待后续。
