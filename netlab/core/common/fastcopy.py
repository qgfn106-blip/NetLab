"""快速状态快照工具。

元件 / 节点状态绝大多数是 ``{str: float}`` 或小列表；``copy.deepcopy`` 这类
纯标量结构非常慢（实测捕获检查点约占电路单步 40%）。本模块按值类型分派：

- 不可变标量（int/float/bool/str/bytes/complex/None、numpy 标量）→ 原样返回；
- numpy 数组 → ``.copy()``；
- dict / list / tuple → 递归；
- 其他自定义对象 → 退回 ``copy.deepcopy``。

语义与 ``copy.deepcopy`` 一致：返回的对象不会被后续原地修改污染。
"""
from __future__ import annotations

import copy
from typing import Any

import numpy as np

_IMMUTABLES = (int, float, bool, str, bytes, complex, type(None))


def copy_state(value: Any) -> Any:
    """返回状态树的安全副本（行为等价于 deepcopy，标量结构更快）。"""
    vtype = type(value)
    if vtype in _IMMUTABLES or isinstance(value, np.generic):
        return value
    if vtype is dict:
        return {key: copy_state(item) for key, item in value.items()}
    if vtype is list:
        return [copy_state(item) for item in value]
    if vtype is tuple:
        return tuple(copy_state(item) for item in value)
    if isinstance(value, np.ndarray):
        return value.copy()
    return copy.deepcopy(value)
