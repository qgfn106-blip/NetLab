---
status: implemented
---
# 控制链路与欠阻尼阶跃反馈补强

## Problem
R35 的输入字段自动匹配已解决多数 `value`/`voltage` 不兼容，但控制系统实测仍暴露五类可复现问题：欠阻尼阶跃超调指标可能为 0；重复预计算时显式延迟边读取上次运行的节点数据；离散 `tf` 的纯单位延迟系数错位；计算节点 `output=auto` 未归一化为 `value`；分析旁路在 `duration/dt` 非整数时错误标记时间轴。用户要求修复信号流控制链路，并交付可打开、可验证的 Netlab 工程。

## Solution
- 超调按最终值的响应方向取峰值：正最终值取最大值，负最终值取最小值，忽略另一侧初始零值。
- `Network.reset_state()` 恢复节点建模初始数据快照，保留手动源的初始值，避免重复预计算污染显式延迟边。
- 离散连接 `tf` 按分母阶数左侧补齐分子系数，保持降幂系数的 z^-1 对齐。
- 所有输出节点工厂统一使用 `resolve_output`，`""`/`auto`/`*` 写入 `value`。
- `transfer.step_response` 使用真实推进时间网格；非整数末步按实际步长离散推进，不把 dt 状态伪装到错误时间。
- 保持 `StateSpaceModel.step` 的现有离散语义：先输出 x[k]，再更新 x[k+1]；本轮不重定义录制时间契约。

## User Stories
- R-01：欠阻尼 `1/(s^2+0.4*s+1)` 的阶跃报告能给出约 52.66% 超调。
- R-02：同一工程连续预计算两次，显式延迟反馈的首帧结果一致。
- R-03：连接级 `H(z)=1/z` 的单位阶跃为 `[0, 1, 1, ...]`。
- R-04：节点输出设置为 `auto` 后产生 `value` 字段。
- R-05：控制链路用阶跃源、求和负反馈、欠阻尼二阶对象运行并可保存/加载 `.netlab`。

## Implementation Decisions
- 本轮作为 R35 后续修复，不新增 R/D 编号；记录在 PROGRESS §7.61，并在 REQUIREMENTS §9 记录。
- 节点初始数据快照在 `Network` 建模时保存；`reset_state` 恢复该快照，而非无差别清空，确保 manual/signal 初值语义不变。
- 工程必须通过 `build_project`/`save_project` 生成，加载通过 `load_project` 校验，不手写 checksum。
- 现有状态空间采样语义不在本轮改变；测试明确首拍零输出是零初始状态的既有语义。

## Testing Decisions
- 新增传递函数欠阻尼超调测试、非整数时间网格测试。
- 新增离散 `1/z` 测试、`output=auto` 节点测试、重复预计算一致性测试。
- 新增控制工程构造、保存、加载、预计算与欠阻尼响应验收测试。
- 运行定向测试、`python -m pytest netlab/tests -q`、`python -m compileall -q netlab`、桌面 selftest。

## Out of Scope
- 不改状态空间 `y[k]`/`x[k+1]` 的采样契约。
- 不重构录制器、前端回放或电路求解器。
- 不覆盖共享工作树已有 §7.59/§7.60 结构护栏与工作树规范并行改动。

## Further Notes
- 当前共享基线由并行会话维护，PROGRESS 记录 504 passed（2026-11-04 18:11）；最终测试数以本轮全量实测为准。
- 运行环境可能继续输出 Windows `gmpy2` `0xc0000139` native 噪声；本轮全量 stderr 为 0 次（gmpy2 已卸载）。若测试退出码为 0，需在报告中单独注明。

## 实现结果（2026-11-04 18:11）
- 代码：`transfer.py`（超调方向/实际网格）、`methods.py`（离散左补零）、`graph.py`（`Node._initial_data` + reset 恢复）、`computes.py`（`resolve_output` 5 处）。
- 测试：`test_fields.py` 3 条、`test_transfer.py` 2 条、`test_control_project.py` 2 条，共 7 条；全量 **504 passed / 77.06 s / exit 0**。
- 工程：`MyProject/underdamped_control.netlab`，checksum `0002a6aa…`；12 s/dt=0.01 重放峰值 1.393032、终值 1.000861、超调 39.18%。
- 备份：`NetlabExtras/backups/ProjectPoint_backups/netlab_control_20261104_1815`（14 文件 + MANIFEST）。
