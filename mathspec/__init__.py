"""mathspec —— 面向多物理场仿真的统一图模型与混合计算引擎 · 零耦合参考实现。

本包**不 import netlab**，仅依赖 numpy / scipy，用于在"数学形式上"先行验证
UNIFIED_SIM_MATH_SPEC.md 中的算子，通过 pytest 验收后再考虑进 netlab。

模块：
    graph      统一图模型（Node/Edge/Graph + 连接器并查集 + ext 插件命名空间）
    linalg     稠密 LU / 稀疏 splu 缓存
    newton     阻尼 Newton（双判据 + 线搜索）
    integrate  后向欧拉 / RK4 / 速度 Verlet（辛）
    hybrid     混合自动机 + 零穿越检测/定位 + 状态重置
    mor        POD / 平衡截断(带 H∞ 界) / DMD
    models     具体物理模型（dc_motor）
"""

__all__ = ["graph", "linalg", "newton", "integrate", "hybrid", "mor", "models"]
