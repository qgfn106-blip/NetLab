---
status: implemented
---
# 信号流输入字段自动匹配与 value 优先

## Problem
信号流节点和连接方法的输入字段长期默认 `voltage`，而较新的节点（如 `transfer_function`、表达式节点）默认输出 `value`。用户把两者连起来时，运行/预计算会直接失败：

```
连接 'tf-5' 计算失败：“节点 'transfer_function2' 没有数据字段 'voltage'”
```

用户必须逐条打开连接检查器，把「输入字段」从 `voltage` 改成 `value` 才能跑通。字段名是内部实现细节，不应该成为连线的必填项；同时用户仍希望保留显式自定义键（例如 `current`、`power`）传递的能力。

## Solution
1. 新增 `netlab/core/compute/fields.py`，集中做字段解析与数值读取：
   - `resolve_field(payload, requested)`：
     1. 显式 `requested` 存在且是数值字段 → 用它；
     2. 否则优先 `value`；
     3. 再 `voltage`；
     4. 再「唯一数值字段」；
     5. 仍有歧义 → 报 `ComputeError`，列出可用字段。
   - `read_numeric(payload, requested, source=...)`：在解析出的字段上做数值/有限性校验，错误信息带连接名或节点名。
   - `resolve_output(requested)`：输出字段留空、`auto` 或 `*` 时统一为 `value`。
2. 接入读取路径：
   - 节点 `_sum_inputs` 改为逐条入边解析，支持同一求和节点混接 `value` / `voltage` 源。
   - 节点 `_numeric` 委托 `read_numeric`。
   - 连接方法 `_read` 委托 `read_numeric`（节点数据作为 payload）。
   - 表达式节点 `variables` 中不带点号的来源改为自动匹配，带点号仍显式指定。
   - `StateSpaceModel.resolve_inputs`：未连接的输入仍取 0；已连接但字段缺失时自动匹配，歧义才报错。
   - `_port_value` 的端口载荷读取增加自动匹配回退。
3. 默认值统一：
   - 信号节点 `sum` / `gain` / `lag` / `integrate` / `transfer_function` / `clip` 的 `field` 与 `output` 默认改为 `value`。
   - 信号连接方法 `scale` / `delay` / `tf` / `integrator` / `clamp` 的 `input_key` / `output_key` 默认改为 `value`。
   - 已保存场景里的 `voltage` 参数不迁移；读取时的自动匹配保证旧场景继续可用。
4. 参数说明补一句「留空/auto 自动匹配，优先 value」，减少用户手动改字段的动机。

## User Stories
- R-01：作为用户，我把 `transfer_function` 节点直接连到求和/比例节点，不改字段也能运行。
- R-02：作为用户，新建信号节点的输入/输出默认就是 `value`，不必再记 `voltage`。
- R-03：作为用户，我在连接上显式填 `current` 或 `power` 时，仍然按自定义键传递，不会被自动匹配覆盖。
- R-04：作为用户，当源节点同时有多个数值字段且没有 `value`/`voltage` 时，报错会列出可用字段，而不是含糊地说「没有字段」。
- R-05：作为用户，打开旧工程（参数仍是 `voltage`）不需要批量改连线即可运行。

## Implementation Decisions
- 自动匹配只在「请求字段不存在」时发生；显式字段存在时永远优先，避免自定义键被 `value` 抢走。
- 只把数值字段纳入候选；布尔、字符串、数组不参与自动匹配。显式请求到非数值字段时仍报「不是数值」。
- 歧义判定是「多个数值字段且没有 value/voltage」；此时不猜，直接报错并列出字段，避免静默读错信号。
- `state_space` 的未连接输入保持 0.0（这是「没接线」的语义），不因自动匹配改成报错。
- 不改输出字典的结构：节点仍只输出一个 `output` 键；自动匹配只影响读取端。
- 不做场景参数迁移；旧参数由读取端兼容。
- 前端不新增控件，默认值通过 `/api/catalog` 下发；只补参数 help 文案。

## Testing Decisions
- 新增 `tests/test_fields.py`：解析优先级、显式键、唯一数值字段、歧义报错、非数值、`resolve_output`。
- 新增/扩展节点测试：求和节点混接 `value` 与 `voltage` 源；`gain` 默认输出 `value`；旧 `voltage` 参数仍可读；`transfer_function` + 连接方法 `tf` 的截图场景不再报错。
- 扩展 `test_signal_ports.py`：端口载荷只有 `voltage` 时自动匹配。
- 扩展 `test_netlab.py` 或 `test_transfer.py`：状态空间 `input_map` 不带点号时自动匹配。
- 回归：全量 `python -m pytest netlab/tests -q`，只增不减。

## Out of Scope
- 自动改写已保存工程的参数字典。
- 多字段向量的自动选择 / MIMO 字段映射 UI。
- 连接检查器里根据源节点实时列字段的下拉框。
- 把 `voltage` 从代码中彻底删除（电路域仍使用电压语义）。

## Further Notes
- 这次改动是读取端的兼容层，不改变仿真求解顺序、延迟边或拓扑排序。
- 报错统一用 `ComputeError`（HTTP 422），与现有节点参数错误一致。
- 版本戳升到 3.16.13。

## 实现结果（2026-11-04 02:30）

- 新增 `netlab/core/compute/fields.py`（100 行）：`resolve_field` / `read_numeric` / `read_node_numeric` / `resolve_output`；用 `collections.abc.Mapping` 兼容 `NodeView.data` 的 `mappingproxy`。
- 接入：`computes._numeric`/`_sum_inputs`、表达式 `resolve`、`methods._read` 与 5 个 signal 工厂、`statespace.resolve_inputs`、`blocks.py` 单字段端口别名。
- 默认值：6 组节点 + 5 个 signal 方法改 `value`；旧 `voltage` 参数与显式自定义键保留。
- 测试：新增 `tests/test_fields.py` 22 条；更新 `test_signal_ports`/`test_blocks`/`test_project`/`test_netlab`/`test_solver_transactions`/`test_block_validate`；定向 42 passed，块相关 37 passed，全量 **484 passed / 3 warnings / 70.77 s / 退出码 0**。
- 与设计的偏差：`_port_value` 原实现已按「port → value → 任一数值」回退，本轮未改；额外增加 `blocks.py` 端口别名，解决封装块内外部键不一致（截图场景之外的第二个断链点）。
- 版本 3.16.13；备份 `NetlabExtras/backups/ProjectPoint_backups/netlab_fields_20261104_0225`。

## 后续修复（2026-11-04）

预计算反馈环首拍报错：延迟边在步首先求值，源节点 `data` 为空时 `_read` 抛字段错误。`methods._read` 对空 `data` 返回 0.0；`graph.step` 不注入空延迟载荷（覆盖 `pass` 边原样复制空 dict 的情况）。新增 1 条反馈环首拍测试，全量 487 passed。详见 PROGRESS §7.58。
