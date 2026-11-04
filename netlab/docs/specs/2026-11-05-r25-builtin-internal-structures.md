---
status: implemented
---
# R25 内置内部结构与只读模块

## Problem
R25 要求运放、比较器、触发器、计数器、移位寄存器、555、LDO、ADC/DAC 能看到内部结构；内置结构随程序发布，不依赖用户 `library/blocks` 目录；打开后只读，另存副本后才可编辑。此前模块库只有用户文件，`BlockDef.builtin` 字段没有实际语义，模块库为空时这些内置元件不可用。

## Solution
- 新增 `netlab/core/model/builtins.py`：9 个 `BlockDef` 内置结构，固定 id `a25000000001`–`a25000000009`，`model="structural"`、`builtin=True`，metadata 标记 `r25/readonly/group/macro/slug`。
- 内置块内部用现有 signal 宏节点组装（`module_input/module_output`、`sum/gain/clip/expression/signal`、延迟边），端口、节点、连线可在 R24 内部预览浮窗渲染；后续可在不改 id/端口的前提下替换成电路级实现。
- `blocklib` 增加虚拟注册表语义：`scan_library(include_builtin=True)` 合并内置摘要；`load_block` 对内置返回深拷贝；`find_block_path/ensure_blocks` 跳过内置写库；`write/overwrite/import/remove/rename` 拒绝内置块。
- `server.py` 所有块扫描入口传 `include_builtin=True`；`blocks_open_internal` 继续复用临时网络浮窗；打开内部后可用 `POST /api/blocks/save-copy` 另存为普通 structural 副本。
- 前端块库卡片显示「内置」徽标，内置块的改名/删除禁用；模块内部浮窗标题提示只读和另存副本。

## User Stories
- R25-01：模块库为空时，用户仍能看到并打开 9 类内置元件的只读内部结构。
- R25-02：用户打开内置结构后可另存为普通模块副本并编辑，不影响内置原件。
- R25-03：用户删除/改名/覆盖内置块时得到明确拒绝提示。

## Non-Goals / Known Limits
- 当前 9 个内置块是 signal 宏模型，不是完整电路级器件模型；复杂数字块（counter4/shift4）仍是简化宏。
- 「按内部结构仿真」开关与行为模型对比表尚未实现；当前所有块实例使用 internal scene 求解，内置结构等同常开。
- 后续可逐类替换为电路级结构并补等价性测试，不改变块 id/端口。

## Verification
- `python -m pytest netlab/tests/test_builtin_blocks.py netlab/tests/test_blocklib.py netlab/tests/test_block_internal.py -q` → 14 passed。
- `python -m pytest netlab/tests -q` 全量。
- API：`GET /api/blocks?library=...` 含 9 个 builtin；`POST /api/blocks/{id}/open-internal`；`POST /api/blocks/save-copy`。
