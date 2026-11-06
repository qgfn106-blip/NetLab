"""统一图模型（UGM）参考实现。

对应规范 §2；对应 netlab scene.py 的 NodeRecord/EdgeRecord，并显式加入
`ext` 插件命名空间（§9.4 前置改动）。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Tuple


@dataclass
class PortType:
    """端口类型：一对 (potential, flow) 物理量纲。"""
    potential: str
    flow: str


@dataclass
class Port:
    name: str
    ptype: PortType
    direction: str = "across"  # in / out / across


@dataclass
class Node:
    id: str
    kind: str
    params: Dict[str, Any] = field(default_factory=dict)
    ports: Dict[str, Port] = field(default_factory=dict)
    state: Dict[str, float] = field(default_factory=dict)
    ext: Dict[str, Any] = field(default_factory=dict)  # §9.4 插件私有命名空间

    def set_ext(self, plugin_id: str, value: Any) -> None:
        """只增不改；键为插件 id，跨插件互不可见。"""
        self.ext[plugin_id] = value

    def get_ext(self, plugin_id: str) -> Any:
        return self.ext.get(plugin_id)


@dataclass
class Edge:
    id: str
    source: str
    target: str
    kind: str = "signal"
    delay: int = 0  # 单位延迟拍数，>=1 打断代数环
    ext: Dict[str, Any] = field(default_factory=dict)


class Graph:
    """扁平超图 + 连接器并查集（§2.4 flow/potential 连接公理）。"""

    def __init__(self) -> None:
        self.nodes: Dict[str, Node] = {}
        self.edges: List[Edge] = []
        self._parent: Dict[Tuple[str, str], Tuple[str, str]] = {}
        self._rank: Dict[Tuple[str, str], int] = {}

    def add_node(self, node: Node) -> None:
        self.nodes[node.id] = node

    def add_edge(self, edge: Edge) -> None:
        self.edges.append(edge)

    # ---- 连接器代数：并查集合并端口簇 ----
    def _ensure(self, pin: Tuple[str, str]) -> None:
        if pin not in self._parent:
            self._parent[pin] = pin
            self._rank[pin] = 0

    def _find(self, pin: Tuple[str, str]) -> Tuple[str, str]:
        self._ensure(pin)
        root = pin
        while self._parent[root] != root:
            root = self._parent[root]
        while self._parent[pin] != root:
            nxt = self._parent[pin]
            self._parent[pin] = root
            pin = nxt
        return root

    def connect(self, pin_a: Tuple[str, str], pin_b: Tuple[str, str]) -> None:
        """连接两个端口（等价于 Modelica connect）：合并为同一势节点。"""
        ra, rb = self._find(pin_a), self._find(pin_b)
        if ra == rb:
            return
        if self._rank[ra] < self._rank[rb]:
            ra, rb = rb, ra
        self._parent[rb] = ra
        if self._rank[ra] == self._rank[rb]:
            self._rank[ra] += 1

    def clusters(self) -> List[List[Tuple[str, str]]]:
        groups: Dict[Tuple[str, str], List[Tuple[str, str]]] = {}
        for pin in self._parent:
            groups.setdefault(self._find(pin), []).append(pin)
        return list(groups.values())

    def potential_variables(self) -> Dict[Tuple[str, str], str]:
        """每个连接簇对应一个势变量（等势公理 potential_i = potential_j）。"""
        roots = {self._find(p) for p in self._parent}
        return {root: f"V_{{{root[0]}.{root[1]}}}" for root in roots}
