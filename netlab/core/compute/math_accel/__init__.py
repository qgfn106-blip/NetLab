"""数学加速器的影子实现（P3/P1/P5，默认关闭）。

本包只包含 R43（M1）新增的、与既有求解器解耦的可选路径：
- ``woodbury_ac``：AC 扫频双参数仿射族 + Woodbury 求解；
- ``config``：``NETLAB_MATH_ACCEL`` 开关解析；
- ``diagnostics``：只读诊断记录。

默认行为与旧路径完全一致：任何新路径只有显式开启才会被调用。
"""

from .config import math_accel_mode
from .woodbury_ac import ACWoodburySolver, ReactiveStamp, collect_reactive_stamps

__all__ = [
    "ACWoodburySolver",
    "ReactiveStamp",
    "collect_reactive_stamps",
    "math_accel_mode",
]
