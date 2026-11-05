"""R39 复数分析层的边界适配函数。

本模块只做「实数 ↔ 复数」的显式转换，不改变时域求解、记录器或工程数据。
分析入口可以接受实数信号，在频域边界转成 ``complex128``；离开分析层时
再通过 :func:`as_real` / :func:`complex_parts` 明确地回到实数或拆分实虚部。
"""

from __future__ import annotations

import numbers
from typing import Any

import numpy as np

_COMPLEX_EPS = 1.0e-12


def as_complex(value: Any) -> complex:
    """把标量数值转换为 Python ``complex``。

    bool、字符串、None 与容器都拒绝：它们不是可解释的数值输入，静默
    转成 0/1 会让频域结果难以排查。
    """
    if isinstance(value, (bool, str, bytes)) or value is None:
        raise ValueError(f"不能把 {type(value).__name__} 当作复数标量")
    if isinstance(value, (complex, numbers.Real)):
        return complex(value)
    if isinstance(value, np.generic) and np.issubdtype(value.dtype, np.number):
        if np.iscomplexobj(value):
            return complex(value)
        return complex(float(value))
    raise ValueError(f"不能把 {type(value).__name__} 当作复数标量")


def as_complex_array(values: Any) -> np.ndarray:
    """把数值序列转换为 ``complex128`` 数组，保持输入形状。

    先检查 object dtype，避免 numpy 把字符串/None 静默转成 0 或复数。
    """
    array = np.asarray(values)
    if array.dtype.kind == "O":
        raise ValueError("复数数组不接受 object dtype；请先清理非数值元素")
    if array.dtype.kind not in "iufc":
        raise ValueError(f"复数数组需要数值 dtype，收到 {array.dtype}")
    return np.asarray(values, dtype=np.complex128)


def as_real(value: Any) -> float:
    """取复数的精确实部；虚部超出浮点容差时拒绝，避免静默丢相位。"""
    number = as_complex(value)
    tolerance = _COMPLEX_EPS * max(1.0, abs(number.real))
    if abs(number.imag) > tolerance:
        raise ValueError(f"复数虚部不为零（{number.imag:g}），不能当作实数")
    return float(number.real)


def complex_parts(values: Any) -> tuple[np.ndarray, np.ndarray]:
    """返回 ``(real, imag)`` 两个 ``float64`` 数组，供 API/导出使用。"""
    array = as_complex_array(values)
    return np.real(array).astype(np.float64), np.imag(array).astype(np.float64)


def map_complex(value: Any) -> Any:
    """递归转换 dict/list/tuple 中的数值叶子，保持容器结构。

    非数值叶子（字符串、None、bool 等）原样保留；调用方若需要严格拒绝，
    应在使用前用 :func:`as_complex` 逐个校验。
    """
    if isinstance(value, dict):
        return {key: map_complex(item) for key, item in value.items()}
    if isinstance(value, list):
        return [map_complex(item) for item in value]
    if isinstance(value, tuple):
        return tuple(map_complex(item) for item in value)
    if isinstance(value, (bool, str, bytes)) or value is None:
        return value
    try:
        return as_complex(value)
    except ValueError:
        return value


def phase_degrees(values: Any, *, unwrap: bool = True) -> np.ndarray:
    """统一相位出口：角度制，默认 ``np.unwrap`` 消除 360° 跳变。"""
    array = as_complex_array(values)
    phase = np.angle(array)
    if unwrap and phase.size:
        phase = np.unwrap(phase)
    return np.degrees(phase)
