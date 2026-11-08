"""可序列化的节点/连接记录。

这些记录只描述工程数据，不持有引擎状态；放在独立模块中可避免
``scene.py`` 继续膨胀，同时让序列化与仿真层共享同一数据契约。
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any


@dataclass
class NodeRecord:
    id: str
    name: str
    kind: str
    params: dict[str, Any] = field(default_factory=dict)
    data: dict[str, Any] = field(default_factory=dict)
    state: dict[str, Any] = field(default_factory=dict)
    inputs: dict[str, dict[str, Any]] = field(default_factory=dict)
    position: dict[str, float] = field(default_factory=lambda: {"x": 0.0, "y": 0.0})
    #: 节点尺寸（R09）：``{"w": 直径}``；空字典表示用默认半径。
    size: dict[str, float] = field(default_factory=dict)
    #: 元素级外观覆盖（P-B，可选）；空字典表示不覆盖、完全沿用默认。
    appearance: dict[str, Any] = field(default_factory=dict)

    def snapshot(self, *, include_state: bool = True) -> dict[str, Any]:
        """返回可 JSON 化的节点快照。

        ``include_state=False``（前端画布/场景树用的只读视图）时不深拷贝
        ``state``/``inputs``：这两个字段每拍都变、体积最大，而调用方随后
        就会丢弃它们，拷贝纯属浪费（204 节点场景实测占 to_payload 一半时间）。
        """
        item = {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "params": copy.deepcopy(self.params),
            "data": copy.deepcopy(self.data),
            "position": dict(self.position),
            "size": dict(self.size),
        }
        if self.appearance:
            item["appearance"] = copy.deepcopy(self.appearance)
        if include_state:
            item["state"] = copy.deepcopy(self.state)
            item["inputs"] = copy.deepcopy(self.inputs)
        return item


@dataclass
class EdgeRecord:
    id: str
    name: str
    source: str
    target: str
    kind: str
    params: dict[str, Any] = field(default_factory=dict)
    state: dict[str, Any] = field(default_factory=dict)
    delay: bool = False
    #: 是否由显式请求的 auto_delay 逻辑加上；该状态写入工程快照，避免载入后丢失。
    auto_delay: bool = False
    enabled: bool = True
    #: 连线几何（R09/D24）：路由方式、手动拐点（世界坐标）、两端锚点。
    route: str = "auto"
    waypoints: list[dict[str, float]] = field(default_factory=list)
    anchors: dict[str, str] = field(default_factory=dict)
    #: 图纸布局层（R19）：符号位置与旋转（30° 步长）；空=未布局，自动生成。
    layout: dict[str, Any] = field(default_factory=dict)
    #: 导线引脚绑定（R20）：只在 kind=="wire" 时使用；网络节点一侧为空。
    source_pin: str = ""
    target_pin: str = ""
    #: 信号/矢量端口绑定（R20/Q8）：source 输出字段 → target 输入端口。
    source_port: str = ""
    target_port: str = ""
    #: 元素级外观覆盖（P-B，可选）；空字典表示不覆盖、完全沿用默认。
    appearance: dict[str, Any] = field(default_factory=dict)

    def snapshot(self, *, include_state: bool = True) -> dict[str, Any]:
        item = {
            "id": self.id,
            "name": self.name,
            "source": self.source,
            "target": self.target,
            "kind": self.kind,
            "source_pin": self.source_pin,
            "target_pin": self.target_pin,
            "source_port": self.source_port,
            "target_port": self.target_port,
            "params": copy.deepcopy(self.params),
            "delay": self.delay,
            "auto_delay": self.auto_delay,
            "enabled": self.enabled,
            "route": self.route,
            "waypoints": [dict(item) for item in self.waypoints],
            "anchors": dict(self.anchors),
            "layout": dict(self.layout),
        }
        if self.appearance:
            item["appearance"] = copy.deepcopy(self.appearance)
        if include_state:
            item["state"] = copy.deepcopy(self.state)
        return item
