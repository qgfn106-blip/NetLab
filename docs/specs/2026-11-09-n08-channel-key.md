# N-08 通道键结构化规格（2026-11-09）

## 目标

把 `<kind>:<node-or-edge-id>:<field>` 从散落的字符串拼接/`split(":", 2)` 收口为一个结构化类型 `ChannelKey`：

- 构造：`ChannelKey.node(ident, field)` / `.edge(...)` / `.state(...)`；
- 解析：`ChannelKey.parse(text)`，非法形状返回 `None`，不抛异常；
- 输出：`str(key)` 仍为旧 wire 格式，保持 `/api/live`、recorder、PlotKit 的线上兼容；
- 改名：`key.with_ident(new_ident)` 生成新键，不在业务代码里手工拼字符串。

`ChannelKey` 使用 **id** 而非显示名；显示名只在 `Scene.channel_display_name()` 这一层替换。

## 非目标

- 不改变 `/api/live`、`/api/plotkit/*` 的 JSON 形状；
- 不改变 recorder 帧结构（`{"seq","t","v"}`，`v` 仍为 `dict[str,float]`）；
- 不引入通道订阅/持久化注册表；`feed`/`input_map` 的解析路径保持不变。

## 验收判据

1. `ChannelKey.parse(str(ChannelKey.node("n1","voltage")))` 往返相等；
2. 非法输入（少于 3 段、未知 kind、空段）返回 `None`，不抛异常；
3. 重命名节点后，`scene.channel_display_name("state:<id>:0")` 返回新名字，值不变（沿用 `test_state_channels`）；
4. 全仓 `netlab/core/model` 与 `netlab/plotkit_bridge.py` 不再出现 `split(":", 2)` / `key.split(":")` 形式的通道键解析（插件 manifest 的 `partition(":")` 不属于通道键，保留）；
5. 全量 `python -m pytest netlab/tests -q` 不低于 733 passed / 1 skipped；
6. 前端与 PlotKit 通道标签行为不变（`n:<id>:voltage` → `<name>·voltage`）。

## 回滚

单提交可 `git revert`；`ChannelKey` 是新增模块，旧字符串路径在解析失败时原样返回，回滚不影响已保存工程。
