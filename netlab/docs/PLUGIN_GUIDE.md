# Netlab 插件包指南（R40）

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

详细规范和验收矩阵见 [EXTENSIBILITY_ARCHITECTURE.md](EXTENSIBILITY_ARCHITECTURE.md)，
决策见 [adr/0002-plugin-extension-architecture.md](adr/0002-plugin-extension-architecture.md)。
