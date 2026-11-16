"""兼容再导出：实现在 netlab.core.common.fields；保留旧导入路径。"""
from ..common import fields as _src
globals().update({_n: getattr(_src, _n) for _n in dir(_src) if not _n.startswith("__")})
__all__ = [n for n in dir(_src) if not n.startswith("_")]
