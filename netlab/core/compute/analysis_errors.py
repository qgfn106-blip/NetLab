"""分析旁路的公共异常与上限常量。

P2-03 结构拆分第一步：从 analysis.py 迁出 AnalysisError 及相关常量。
analysis.py 通过 `from .analysis_errors import ...` 继续对外导出，既有
`netlab.core.compute.analysis.AnalysisError` 等 import 路径保持不变。
"""

from __future__ import annotations

# 分析超时秒数；run_with_timeout 的默认上限。
ANALYSIS_TIMEOUT = 5.0

# CSV 导出行数上限；export_csv 超限即报错。
MAX_EXPORT_ROWS = 200_000


class AnalysisError(Exception):
    """分析失败/超时；服务层转 422。"""


__all__ = ["ANALYSIS_TIMEOUT", "MAX_EXPORT_ROWS", "AnalysisError"]
