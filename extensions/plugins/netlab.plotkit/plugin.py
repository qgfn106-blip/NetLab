"""PlotKit 的 Netlab 插件声明。

PlotKit 的 Python 包和 HTTP 子应用仍由 ``netlab.plotkit_bridge`` 负责加载与
挂载；本插件只声明它在 Netlab 中的面板位置和能力边界，使插件管理器能够
发现、启用/停用并在目录中展示 PlotKit，而不把 PlotKit 内部实现混进核心。
"""

from __future__ import annotations

from netlab.plugin_api.v1 import PanelSpec, PluginContext


def register(ctx: PluginContext) -> None:
    ctx.register_panel(
        PanelSpec(
            id="plotkit",
            title="PlotKit",
            slot="right",
            layout={
                "kind": "iframe",
                "src": "/plotkit/",
                "height": "100%",
                "sandbox": "same-origin",
            },
            data_sources=("recorder", "analysis"),
        )
    )
