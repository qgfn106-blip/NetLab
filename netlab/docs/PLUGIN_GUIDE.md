# Netlab 插件包指南（R40）

> 最后更新：2026-11-07（补「加载与启用」流程、capabilities 取值与端点清单，以 plugins.py/server.py 为准）

每个插件一个子目录：`extensions/plugins/<反向域名 id>/`，目录名必须与
`plugin.json` 的 `id` 完全一致。

```json
{
  "schema": "netlab-plugin/1",
  "id": "com.example.double",
  "name": "Double",
  "version": "1.0.0",
  "plugin_api": "1.0",
  "netlab": ">=3.0 <4.0",
  "entry": "plugin:register",
  "capabilities": ["compute"]
}
```

`plugin.py` 使用稳定门面 `netlab.plugin_api.v1`：

```python
from netlab.plugin_api.v1 import ComputeSpec, PluginContext, ParamSpec


def register(ctx: PluginContext) -> None:
    ctx.register_compute(ComputeSpec(
        kind="double",
        label="Double",
        group="示例",
        description="输入乘以 2",
        params=(ParamSpec("gain", "增益", type="float", default=2.0),),
        factory=lambda params: (lambda ctx: {}),
    ))
```

约定：

- 插件是受信任的进程内 Python 代码，不是安全沙箱；
- 只能依赖 `netlab.plugin_api.v1`，不得导入 `netlab.core.*`；
- 插件私有数据放 `params`/`data`/`state`，不要改 Node/Edge 核心字段；
- 工程只锁 `id + version`；缺插件时工程降级打开，节点标为未解析。
- `capabilities` 取值限定 `compute/method/element/analysis/data_io/panel/template/engine/visual`（`netlab/core/model/plugins.py:55-65`）。

## 加载与启用（3.20.1）

1. 把插件目录放到 `NetlabHome/extensions/plugins/<id>/`（目录名与 `plugin.json` 的 `id` 一致）。
2. 打开 UI「插件管理」→「扫描插件目录」（`POST /api/plugins/scan`）→ 启用（`POST /api/plugins/{id}/enable`，体 `{enabled: true}`）；改动后「重新加载」（`POST /api/plugins/{id}/reload`）。
3. 路由以实现为准：仅 `GET /api/plugins`、`GET /api/plugins/{id}`、`POST /api/plugins/scan`、`POST /api/plugins/{id}/enable`、`POST /api/plugins/{id}/reload`；**无** `/disable`、`/open-folder` 路由（`netlab/server.py:658-710`）。

## 官方 PlotKit 插件（D125）

`extensions/plugins/netlab.plotkit/` 是随仓库分发的面板插件：`plugin.json`
声明 `capabilities=["panel"]`，`plugin.py` 注册 `PanelSpec(id="plotkit")`，
面板布局指向宿主挂载的 `/plotkit/` iframe。PlotKit 的 Python 包仍由
`netlab/plotkit_bridge.py` 单向加载；插件包负责发现/启停与面板声明，
`plotkit_bridge.mount()` 只在插件未被停用时挂载子应用。插件包存在时，若
`extensions/plugins/netlab.plotkit/plotkit/` 下有副本则优先于
`netlab/_vendor/plotkit`；没有插件包时保留旧的 vendor 回退路径，兼容旧安装。
验证：`python -m pytest netlab/tests/test_plotkit_plugin.py -q`。

详细规范和验收矩阵见 [EXTENSIBILITY_ARCHITECTURE.md](EXTENSIBILITY_ARCHITECTURE.md)，
决策见 [adr/0002-plugin-extension-architecture.md](adr/0002-plugin-extension-architecture.md)。
