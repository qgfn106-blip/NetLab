"""输入数值语义转换：把用户十进制输入转为 SymPy 精确数，避免二进制 float 漂移。

方案依据《NetLab Gs 浮点精度与传递函数算法改进方案》§1.1 / §3.1：十进制输入在进入
分析前若已变为二进制 float，直接 ``sympify(str(float))`` 会得到 ``sp.Float``（53 位
近似）。对有限 float 采用 ``sp.Rational(str(value))`` 可恢复其「最短十进制」书写意图
（如 0.1 -> 1/10），从而让符号传函保持精确有理数、不在系数里残留二进制浮点。
"""

from __future__ import annotations

import math
from decimal import Decimal
from fractions import Fraction
from typing import Any

import sympy as sp


def to_exact(value: Any) -> Any:
    """把数值/字符串转成 SymPy 精确表达式（有限浮点->有理数）。"""
    if isinstance(value, bool):
        return sp.Integer(int(value))
    if isinstance(value, int):
        return sp.Integer(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"非有限数值无法精确表示：{value!r}")
        if value.is_integer():
            return sp.Integer(int(value))
        return sp.Rational(str(value))
    if isinstance(value, Decimal):
        return sp.Rational(value)
    if isinstance(value, Fraction):
        return sp.Rational(value.numerator, value.denominator)
    if isinstance(value, str):
        text = value.strip()
        try:
            return sp.Rational(text)
        except (ValueError, TypeError):
            return sp.sympify(text)
    return sp.sympify(value)
