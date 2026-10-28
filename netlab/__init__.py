"""Netlab: 由节点与连接构成的离散仿真网络。

分两层：

* ``signal``  信号流层：节点持有数据字典，连接是纯函数 ``(source, target,
  params, state, dt) -> dict``，按拓扑顺序传播（与原示例 API 兼容）。
* ``circuit`` 电路层：节点是电学节点，连接是元件，使用节点电压法（MNA）
  在每一步求解线性/非线性方程组，天然支持反馈与双向元件。
"""

from __future__ import annotations

__version__ = "1.0.0"

from .graph import Connection, Network, Node  # noqa: E402,F401
from .limits import NetlabError  # noqa: E402,F401
from .scene import Scene  # noqa: E402,F401

__all__ = [
    "Connection",
    "NetlabError",
    "Network",
    "Node",
    "Scene",
    "__version__",
]
