# N5 P3 撤回清单（A′ 收窄版，2026-11-09）

本清单只处理**严格审计 §3.2 第 3/4 条、§7.4 语境下的「P3 数值内核」五项**。
仓内其他「P3」属于不同编号体系，**不撤回、不改写**；本文件逐行登记，供审计复核。

## 一、严格审计 P3 五项（唯一撤回范围）

依据 `docs/NETLAB_PLOTKIT_STRICT_AUDIT_2026-11-09.md` 附录表：

| # | §7.4 条目 | 现状 | 是否可签收 |
|---|---|---|---|
| 1 | LTE 估计 + 自适应步长（rtol/atol、accepted/rejected） | 全仓 `LTE|adaptive_step|variable_step|自适应步长` 真实实现零命中；`simulation.py` 仍固定 dt 循环 | 否 |
| 2 | 统一离散语义（源在同一规则下求值；Gear2 变步长报错或显式标记降阶） | `_source_value()` 已对梯形法取步首/步末平均；但 `elements.py` 的 `gear_dt != dt` 仍静默回退 BE，`test_gear2_dt_change_resets_history` 把降阶写成期望 | 否 |
| 3 | 真实 KCL 残差 | `solver._true_residual()` 在解处重盖章算 F(x*)；`tools/bench_solver.py` 有中点 KCL 失配（1e-18 A 量级）；但 `solver.py` 存在重复 `_true_residual` 定义（第 533/554 行），且无公开 KCL 残差契约 | 否 |
| 4 | cond/残差返回 | `last_residual` 有；全仓无 `cond` 计算/返回 | 否 |
| 5 | 延迟语义统一 | `auto_delay` 默认 False，`AlgebraicLoopError` 存在；但未形成跨方法统一的延迟语义契约与测试 | 否 |

结论：五项均**未完成签收**。不得写「P3 完成」或「P3 部分修复」。
`PROGRESS §7.131` 的梯形首步初始电流自洽是**另一缺陷**，已单独命名，不计入本五项。

## 二、不属于撤回范围的既有「P3」标注（保持原文）

以下均属其他编号体系；逐行核对后**全部保留**：

| 文件:行 | 原文要点 | 归属 |
|---|---|---|
| `netlab/docs/BACKLOG.md:27` | R36 P1–P5 已完成（P3 阻尼 Newton） | R36 子阶段 |
| `netlab/docs/BACKLOG.md:58` | M1b P3 AC 扫频 Woodbury | math_accel / R43 |
| `netlab/docs/BACKLOG.md:138` | R36 P3 完成（Newton/线搜索） | R36 子阶段 |
| `netlab/docs/MATH_INTEGRATION_PLAN.md:3` | M1b P3 影子实现 | math_accel |
| `netlab/docs/MATH_INTEGRATION_PLAN.md:5` | M1b P3 影子路径 | math_accel |
| `netlab/docs/MATH_INTEGRATION_PLAN.md:265` | P3 真实语料扩展完成 | math_accel |
| `netlab/docs/MATH_INTEGRATION_PLAN.md:312` | Woodbury P3 影子路径 | math_accel |
| `netlab/docs/PROGRESS.md:472` | P3 分析：R12/R11/R13/R17 面板 | 分析阶段 |
| `netlab/docs/PROGRESS.md:1886` | R36 P1–P3 完成 | R36 子阶段 |
| `netlab/docs/REQUIREMENTS_AND_RULES.md:245` | P3 完成推荐周期 | 分析 R11 |
| `netlab/docs/REQUIREMENTS_AND_RULES.md:254` | P3 完成分析模块 | 分析 R12 |
| `netlab/docs/REQUIREMENTS_INDEX.md:15` | P3 推荐周期 | 分析 R11 |
| `netlab/docs/REQUIREMENTS_INDEX.md:16` | P3 分析模块 | 分析 R12 |
| `netlab/docs/REQUIREMENTS_INDEX.md:21` | P3 部分完成（R17 L2） | 呈现层 |
| `netlab/docs/REQUIREMENTS_INDEX.md:38` | R34 P3（2026-11-03 实现） | 呈现层 |

## 三、本次实际改写的行（机器可判）

- `netlab/docs/specs/2026-11-09-n5-p3-audit.md`（已按保留策略归档，见 Git 历史）：逐条证据由 3 项扩为 §7.4 五项；结论句收窄到「严格审计 §3.2/§7.4 语境」；删除「撤回所有 P3 完成」表述，改为 A′。
- `netlab/docs/PROGRESS.md:2660`：`## §7.131 P3 梯形源采样与初始电容电流自洽` → `## §7.131 梯形首步初始电容电流自洽缺陷（非 P3 数值内核）`。
- `netlab/docs/PROGRESS.md:2731`：结论由「三项」改为「§7.4 五项」，并指向本清单。
- `docs/NETLAB_PLOTKIT_STRICT_AUDIT_2026-11-09.md`：若原文存在「此前任何 P3 完成标注应视为不成立」，收窄为「严格审计 §3.2/§7.4 语境下的 P3 数值内核五项」；其余 P3 编号不受影响。

## 四、验收命令

```bash
python tools/render_docs.py --check
python -m pytest netlab/tests -q
npm run typecheck && npm test && npm run build
git diff --name-only
```

CI 须绑定新 HEAD 与三工作流 run URL 后才算 A′ 完成；本清单本身不改代码、不改任何既有 P3 业务标注。
