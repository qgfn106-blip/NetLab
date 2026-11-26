"""netlab.core.model —— 见 docs/ARCHITECTURE.md。

三层公共入口：Model（不可变描述）、CompiledModel（编译产物）、
Runtime / RuntimeSnapshot（执行实例与快照）。
"""
from .compiled_model import COMPILER_VERSION, CompiledModel, compile_model
from .model import Model
from .runtime import Runtime, RuntimeSnapshot

__all__ = [
    "COMPILER_VERSION",
    "CompiledModel",
    "Model",
    "Runtime",
    "RuntimeSnapshot",
    "compile_model",
]
