"""节点电压法（MNA）瞬态电路求解器（兼容层）。

实现在 :mod:`netlab.core.compute.circuit` 子包内：
- :mod:`~netlab.core.compute.circuit.stamps`：盖章基础设施；
- :mod:`~netlab.core.compute.circuit.elements`：元件模型；
- :mod:`~netlab.core.compute.circuit.solver`：目录与求解器。

本模块保留原有的 `from .nodal import ...` 公开入口（M 轮搬运，行为不变）。
"""

from __future__ import annotations

# 先导出盖章与元件符号，保证 solver 末尾的元件注册表导入
# （transistors/logic/timers/digital/magnetics/powerelectronics 会回导 .nodal）
# 时这些名字已经在模块命名空间中，避免循环导入。
from .circuit.stamps import *  # noqa: F401,F403
from .circuit.stamps import _stamp_conductance, _stamp_current  # noqa: F401
from .circuit.elements import *  # noqa: F401,F403
from .circuit.solver import *  # noqa: F401,F403
