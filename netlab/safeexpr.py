"""受限算术表达式求值器（不执行任意 Python 代码）。

只允许数字、四则运算、幂、比较、三元表达式，以及一组数学函数。
没有属性访问、下标、lambda、推导式或任意函数调用，因此用户输入无法触达
解释器的对象系统。解析结果缓存在小容量 LRU 中，重复求值开销很低。
"""

from __future__ import annotations

import ast
import math
from functools import lru_cache
from typing import Any

from .limits import ComputeError, MAX_STRING

_MAX_NODES = 160
_MAX_DEPTH = 24
_MAX_EXPONENT = 32.0

_FUNCTIONS: dict[str, Any] = {
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "asin": math.asin,
    "acos": math.acos,
    "atan": math.atan,
    "atan2": math.atan2,
    "sinh": math.sinh,
    "cosh": math.cosh,
    "tanh": math.tanh,
    "exp": math.exp,
    "log": math.log,
    "log10": math.log10,
    "log2": math.log2,
    "sqrt": math.sqrt,
    "abs": abs,
    "floor": math.floor,
    "ceil": math.ceil,
    "round": round,
    "min": min,
    "max": max,
    "clamp": lambda x, lo, hi: max(lo, min(hi, x)),
}

_ALLOWED_NODES = (
    ast.Expression,
    ast.Constant,
    ast.Name,
    ast.Load,
    ast.BinOp,
    ast.UnaryOp,
    ast.BoolOp,
    ast.Compare,
    ast.IfExp,
    ast.Call,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.FloorDiv,
    ast.Mod,
    ast.Pow,
    ast.UAdd,
    ast.USub,
    ast.Not,
    ast.And,
    ast.Or,
    ast.Lt,
    ast.LtE,
    ast.Gt,
    ast.GtE,
    ast.Eq,
    ast.NotEq,
)


def _ensure_finite(value: float, expression: str) -> float:
    if not math.isfinite(value) or abs(value) > 1.0e15:
        raise ComputeError(f"表达式 {expression!r} 的结果不是有限数值")
    return value


@lru_cache(maxsize=256)
def _parse(expression: str) -> ast.Expression:
    if len(expression) > 500:
        raise ComputeError("表达式过长（上限 500 字符）")
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as exc:
        raise ComputeError(f"表达式语法错误：{exc.msg}") from exc
    count = 0
    for node in ast.walk(tree):
        count += 1
        if count > _MAX_NODES:
            raise ComputeError("表达式过于复杂")
        if not isinstance(node, _ALLOWED_NODES):
            raise ComputeError(
                f"表达式包含不允许的语法：{type(node).__name__}"
            )
        if isinstance(node, ast.Constant) and not isinstance(
            node.value, (int, float)
        ):
            raise ComputeError("表达式只允许数字常量")
        if isinstance(node, ast.Name) and not node.id.isidentifier():
            raise ComputeError("表达式包含非法变量名")
    return tree


def _eval(node: ast.AST, variables: dict[str, float], expression: str, depth: int = 0) -> float:
    if depth > _MAX_DEPTH:
        raise ComputeError("表达式嵌套过深")
    if isinstance(node, ast.Expression):
        return _eval(node.body, variables, expression, depth + 1)
    if isinstance(node, ast.Constant):
        return _ensure_finite(float(node.value), expression)
    if isinstance(node, ast.Name):
        try:
            value = variables[node.id]
        except KeyError as exc:
            raise ComputeError(f"表达式引用了未知变量 {node.id!r}") from exc
        return _ensure_finite(float(value), expression)
    if isinstance(node, ast.UnaryOp):
        operand = _eval(node.operand, variables, expression, depth + 1)
        if isinstance(node.op, ast.USub):
            return -operand
        if isinstance(node.op, ast.UAdd):
            return operand
        if isinstance(node.op, ast.Not):
            return 0.0 if operand else 1.0
        raise ComputeError("不支持的一元运算")
    if isinstance(node, ast.BinOp):
        left = _eval(node.left, variables, expression, depth + 1)
        right = _eval(node.right, variables, expression, depth + 1)
        if isinstance(node.op, ast.Add):
            return _ensure_finite(left + right, expression)
        if isinstance(node.op, ast.Sub):
            return _ensure_finite(left - right, expression)
        if isinstance(node.op, ast.Mult):
            return _ensure_finite(left * right, expression)
        if isinstance(node.op, ast.Div):
            if right == 0:
                raise ComputeError("表达式出现除以零")
            return _ensure_finite(left / right, expression)
        if isinstance(node.op, ast.FloorDiv):
            if right == 0:
                raise ComputeError("表达式出现除以零")
            return _ensure_finite(float(left // right), expression)
        if isinstance(node.op, ast.Mod):
            if right == 0:
                raise ComputeError("表达式出现除以零")
            return _ensure_finite(left % right, expression)
        if isinstance(node.op, ast.Pow):
            if abs(right) > _MAX_EXPONENT:
                raise ComputeError(f"指数绝对值不能超过 {_MAX_EXPONENT:g}")
            try:
                return _ensure_finite(left**right, expression)
            except OverflowError as exc:
                raise ComputeError("表达式幂运算溢出") from exc
        raise ComputeError("不支持的二元运算符")
    if isinstance(node, ast.BoolOp):
        values = [_eval(value, variables, expression, depth + 1) for value in node.values]
        if isinstance(node.op, ast.And):
            return 1.0 if all(values) else 0.0
        if isinstance(node.op, ast.Or):
            return 1.0 if any(values) else 0.0
        raise ComputeError("不支持的布尔运算")
    if isinstance(node, ast.Compare):
        left = _eval(node.left, variables, expression, depth + 1)
        for op, comparator in zip(node.ops, node.comparators):
            right = _eval(comparator, variables, expression, depth + 1)
            if isinstance(op, ast.Lt):
                ok = left < right
            elif isinstance(op, ast.LtE):
                ok = left <= right
            elif isinstance(op, ast.Gt):
                ok = left > right
            elif isinstance(op, ast.GtE):
                ok = left >= right
            elif isinstance(op, ast.Eq):
                ok = left == right
            elif isinstance(op, ast.NotEq):
                ok = left != right
            else:
                raise ComputeError("不支持的比较运算")
            if not ok:
                return 0.0
            left = right
        return 1.0
    if isinstance(node, ast.IfExp):
        condition = _eval(node.test, variables, expression, depth + 1)
        branch = node.body if condition else node.orelse
        return _eval(branch, variables, expression, depth + 1)
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name):
            raise ComputeError("只允许调用内置数学函数")
        function = _FUNCTIONS.get(node.func.id)
        if function is None:
            raise ComputeError(f"不允许的函数 {node.func.id!r}")
        if node.keywords:
            raise ComputeError("函数调用不支持关键字参数")
        if len(node.args) > 3:
            raise ComputeError("函数参数过多")
        arguments = [_eval(arg, variables, expression, depth + 1) for arg in node.args]
        try:
            return _ensure_finite(float(function(*arguments)), expression)
        except (ValueError, TypeError, OverflowError, ZeroDivisionError) as exc:
            raise ComputeError(f"函数 {node.func.id} 计算失败：{exc}") from exc
    raise ComputeError(f"不支持的表达式节点：{type(node).__name__}")


def evaluate(expression: str, variables: dict[str, float]) -> float:
    """在给定变量表下计算受限表达式，返回有限浮点数。"""
    if not isinstance(expression, str) or not expression.strip():
        raise ComputeError("表达式不能为空")
    if len(expression) > MAX_STRING:
        raise ComputeError("表达式过长")
    tree = _parse(expression.strip())
    # 变量表也做一次有限性检查，防止上游误传 NaN。
    clean = {};
    for key, value in variables.items():
        number = float(value)
        if not math.isfinite(number):
            raise ComputeError(f"变量 {key!r} 不是有限数值")
        clean[key] = number
    return _eval(tree, clean, expression.strip())


def expression_names(expression: str) -> set[str]:
    """返回表达式中出现的变量名，供界面提示缺失变量。"""
    tree = _parse(expression.strip())
    return {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
