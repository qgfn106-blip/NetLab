"""结构化通道键：``<kind>:<node-or-edge-id>:<field>``。

内部统一用 id 标识通道，避免节点/连接改名后历史帧与新帧断档；对外
wire 格式仍是同形字符串，``str(ChannelKey)`` 可直接用于 recorder、
``/api/live`` 与 PlotKit。所有字符串解析集中在本模块的 :meth:`ChannelKey.parse`。
"""

from __future__ import annotations

from dataclasses import dataclass

KIND_NODE = "n"
KIND_EDGE = "e"
KIND_STATE = "state"
KINDS = frozenset({KIND_NODE, KIND_EDGE, KIND_STATE})


@dataclass(frozen=True, slots=True, order=True)
class ChannelKey:
    """稳定通道键：``kind`` + 实体 id + 字段名。"""

    kind: str
    ident: str
    field: str

    def __post_init__(self) -> None:
        if self.kind not in KINDS:
            raise ValueError(f"未知的通道类型：{self.kind!r}")
        if not self.ident:
            raise ValueError("通道实体 id 不能为空")
        if not self.field:
            raise ValueError("通道字段名不能为空")

    def __str__(self) -> str:
        return f"{self.kind}:{self.ident}:{self.field}"

    @classmethod
    def node(cls, ident: str, field: str) -> "ChannelKey":
        return cls(KIND_NODE, ident, field)

    @classmethod
    def edge(cls, ident: str, field: str) -> "ChannelKey":
        return cls(KIND_EDGE, ident, field)

    @classmethod
    def state(cls, ident: str, field: str) -> "ChannelKey":
        return cls(KIND_STATE, ident, field)

    @classmethod
    def parse(cls, text: str) -> "ChannelKey | None":
        """解析旧字符串键；非法形状返回 ``None``（未知键按原样透传）。"""
        if not isinstance(text, str):
            return None
        parts = text.split(":", 2)
        if len(parts) != 3:
            return None
        kind, ident, field = parts
        if kind not in KINDS or not ident or not field:
            return None
        return cls(kind, ident, field)

    @classmethod
    def coerce(cls, value: "str | ChannelKey") -> "ChannelKey | None":
        if isinstance(value, ChannelKey):
            return value
        return cls.parse(value)

    def with_ident(self, ident: str) -> "ChannelKey":
        """换实体 id（改名/映射时使用），kind 与 field 不变。"""
        return ChannelKey(self.kind, ident, self.field)

    def label(self) -> str:
        """给图例用的短标签：``<ident>·<field>``。"""
        return f"{self.ident}·{self.field}"
