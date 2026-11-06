"""spec 层：数据结构、校验、序列化。"""

from .model import SPEC_VERSION, new_layer, new_spec
from .validate import Report, SpecError, validate_or_raise, validate_spec

__all__ = [
    "SPEC_VERSION",
    "new_spec",
    "new_layer",
    "validate_spec",
    "validate_or_raise",
    "SpecError",
    "Report",
]
