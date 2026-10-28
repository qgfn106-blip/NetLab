"""输入校验、硬性上限与 JSON 安全性检查。

所有来自 HTTP 的数据都必须先经过这里：只接受 JSON 原生类型，拒绝 NaN/Inf、
过深的嵌套、过大的数组与过长的字符串，避免异常数据破坏仿真状态或撑爆内存。
"""

from __future__ import annotations

import math
import numbers
import re
from typing import Any

# ---- 硬性上限（同时保护计算耗时与内存） ------------------------------------
MAX_NODES = 400
MAX_EDGES = 1200
MAX_FIELDS = 64
MAX_STRING = 400
MAX_DEPTH = 8
MAX_ARRAY = 256
MAX_MATRIX = 12
MAX_NUMBER = 1.0e15
MAX_NAME = 32

_NAME_RE = re.compile(r"^[^\x00-\x1f<>\"'&]{1,32}$")
_FORBIDDEN = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


class NetlabError(Exception):
    """所有可预期的业务异常基类，携带 HTTP 状态码。"""

    status = 400

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        if status is not None:
            self.status = status


class ValidationError(NetlabError):
    status = 422


class NotFoundError(NetlabError):
    status = 404


class ConflictError(NetlabError):
    status = 409


class LimitError(NetlabError):
    status = 413


class ComputeError(NetlabError):
    status = 422


def check_name(value: Any, field: str = "名称") -> str:
    """校验用户可见名称：非空、无控制字符、无 HTML 元字符、长度受限。"""
    if not isinstance(value, str):
        raise ValidationError(f"{field}必须是字符串")
    name = value.strip()
    if not name:
        raise ValidationError(f"{field}不能为空")
    if len(name) > MAX_NAME:
        raise ValidationError(f"{field}最长 {MAX_NAME} 个字符")
    if not _NAME_RE.match(name):
        raise ValidationError(f"{field}含有不允许的字符")
    return name


def check_id(value: Any, field: str = "id") -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-fA-F-]{1,40}", value):
        raise ValidationError(f"{field}不合法")
    return value


def as_float(
    value: Any,
    field: str,
    *,
    default: float | None = None,
    lo: float | None = None,
    hi: float | None = None,
    positive: bool = False,
    nonnegative: bool = False,
    allow_none: bool = False,
) -> float:
    """把输入转成有限浮点数并检查范围；布尔值不算数字。"""
    if value is None and default is not None:
        value = default
    if value is None:
        if allow_none:
            return float("nan")
        raise ValidationError(f"{field}不能为空")
    if isinstance(value, bool) or not isinstance(value, numbers.Real):
        raise ValidationError(f"{field}必须是数字")
    number = float(value)
    if not math.isfinite(number):
        raise ValidationError(f"{field}必须是有限数值")
    if abs(number) > MAX_NUMBER:
        raise ValidationError(f"{field}超出允许范围（|x| ≤ {MAX_NUMBER:g}）")
    if positive and number <= 0:
        raise ValidationError(f"{field}必须大于 0")
    if nonnegative and number < 0:
        raise ValidationError(f"{field}不能为负")
    if lo is not None and number < lo:
        raise ValidationError(f"{field}不能小于 {lo:g}")
    if hi is not None and number > hi:
        raise ValidationError(f"{field}不能大于 {hi:g}")
    return number


def as_int(
    value: Any,
    field: str,
    *,
    default: int | None = None,
    lo: int | None = None,
    hi: int | None = None,
) -> int:
    if value is None and default is not None:
        value = default
    if isinstance(value, bool) or not isinstance(value, numbers.Integral):
        raise ValidationError(f"{field}必须是整数")
    number = int(value)
    if lo is not None and number < lo:
        raise ValidationError(f"{field}不能小于 {lo}")
    if hi is not None and number > hi:
        raise ValidationError(f"{field}不能大于 {hi}")
    return number


def as_bool(value: Any, field: str, *, default: bool | None = None) -> bool:
    if value is None and default is not None:
        return default
    if isinstance(value, bool):
        return value
    raise ValidationError(f"{field}必须是布尔值")


def as_str(
    value: Any,
    field: str,
    *,
    default: str | None = None,
    max_len: int = MAX_STRING,
    allow_empty: bool = True,
) -> str:
    if value is None and default is not None:
        return default
    if not isinstance(value, str):
        raise ValidationError(f"{field}必须是字符串")
    if len(value) > max_len:
        raise ValidationError(f"{field}最长 {max_len} 个字符")
    if _FORBIDDEN.search(value):
        raise ValidationError(f"{field}含有非法控制字符")
    if not allow_empty and not value.strip():
        raise ValidationError(f"{field}不能为空")
    return value


def as_dict(value: Any, field: str, *, max_fields: int = MAX_FIELDS) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError(f"{field}必须是字典")
    if len(value) > max_fields:
        raise ValidationError(f"{field}最多 {max_fields} 个键")
    return value


def json_safe(value: Any, *, where: str = "数据", _depth: int = 0) -> Any:
    """校验并**深拷贝**为纯 JSON 结构；同时拒绝不安全或不合理的值。"""
    if _depth > MAX_DEPTH:
        raise ValidationError(f"{where}嵌套过深（上限 {MAX_DEPTH} 层）")
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, str):
        if len(value) > MAX_STRING:
            raise ValidationError(f"{where}中的字符串过长")
        if _FORBIDDEN.search(value):
            raise ValidationError(f"{where}中的字符串含有非法控制字符")
        return value
    if isinstance(value, numbers.Integral):
        number = int(value)
        if abs(number) > MAX_NUMBER:
            raise ValidationError(f"{where}中的整数超出范围")
        return number
    if isinstance(value, numbers.Real):
        number = float(value)
        if not math.isfinite(number):
            raise ValidationError(f"{where}中不允许 NaN 或无穷大")
        if abs(number) > MAX_NUMBER:
            raise ValidationError(f"{where}中的数值超出范围（|x| ≤ {MAX_NUMBER:g}）")
        return number
    if isinstance(value, (list, tuple)):
        if len(value) > MAX_ARRAY:
            raise ValidationError(f"{where}中的数组最多 {MAX_ARRAY} 项")
        return [json_safe(item, where=where, _depth=_depth + 1) for item in value]
    if isinstance(value, dict):
        if len(value) > MAX_FIELDS:
            raise ValidationError(f"{where}最多 {MAX_FIELDS} 个键")
        result: dict[str, Any] = {}
        for key, item in value.items():
            if not isinstance(key, str) or not key:
                raise ValidationError(f"{where}的键必须是非空字符串")
            if len(key) > MAX_NAME:
                raise ValidationError(f"{where}中的键过长")
            result[key] = json_safe(item, where=where, _depth=_depth + 1)
        return result
    raise ValidationError(f"{where}包含不支持的类型：{type(value).__name__}")


def as_number_list(
    value: Any, field: str, *, max_len: int = MAX_ARRAY, min_len: int = 0
) -> list[float]:
    if not isinstance(value, (list, tuple)):
        raise ValidationError(f"{field}必须是数组")
    if not (min_len <= len(value) <= max_len):
        raise ValidationError(f"{field}长度必须在 {min_len}..{max_len} 之间")
    return [as_float(item, f"{field}[{index}]") for index, item in enumerate(value)]


def as_matrix(
    value: Any,
    field: str,
    *,
    rows: int | None = None,
    cols: int | None = None,
    max_size: int = MAX_MATRIX,
) -> list[list[float]]:
    if not isinstance(value, (list, tuple)) or not value:
        raise ValidationError(f"{field}必须是非空二维数组")
    if len(value) > max_size:
        raise ValidationError(f"{field}行数不能超过 {max_size}")
    matrix: list[list[float]] = []
    for index, row in enumerate(value):
        if not isinstance(row, (list, tuple)):
            raise ValidationError(f"{field}[{index}] 必须是数组")
        if len(row) > max_size:
            raise ValidationError(f"{field}列数不能超过 {max_size}")
        matrix.append([as_float(item, f"{field}[{index}]") for item in row])
    width = len(matrix[0])
    if any(len(row) != width for row in matrix):
        raise ValidationError(f"{field}每行长度必须一致")
    if rows is not None and len(matrix) != rows:
        raise ValidationError(f"{field}必须有 {rows} 行")
    if cols is not None and width != cols:
        raise ValidationError(f"{field}必须有 {cols} 列")
    return matrix


def clamp(value: float, lo: float, hi: float) -> float:
    return lo if value < lo else hi if value > hi else value


def format_number(value: float, digits: int = 4) -> str:
    if not math.isfinite(value):
        return "nan"
    if value == 0:
        return "0"
    if abs(value) >= 1e5 or abs(value) < 1e-3:
        return f"{value:.{digits}e}"
    return f"{value:.{digits}g}"
