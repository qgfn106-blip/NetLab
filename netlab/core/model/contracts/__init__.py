"""B3 R1：model↔compute 依赖下沉用的纯类型层（skeleton）。

严格约束（R1）：本包**只放 Protocol / dataclass / 常量 / 类型别名**，
不 import 任何 compute 实现、不引用任何现有模块、不接线；可整目录删除回滚。
后续 R2–R5 分批把 `netlab/core/model/*` 的顶层 compute import 改为仅依赖本包类型 +
函数内惰性 import（见 `NetlabExtras/scratch/REM_B3_01_03_READONLY_DESIGN.md`）。
"""

__all__: list[str] = []
