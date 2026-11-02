"""兼容层：实现在 netlab.core.model.workspace（2026-11-02 结构整理）。

保留这个文件只是为了不破坏历史 import；新代码请直接用新路径。
"""
from .core.model import workspace as _impl
from .core.model.workspace import *  # noqa: F401,F403


def __getattr__(attr):  # 转发私有名字与非常量
    return getattr(_impl, attr)


def __dir__():
    return dir(_impl)
