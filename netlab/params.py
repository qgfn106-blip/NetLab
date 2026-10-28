"""参数模式：统一定义、校验与序列化节点/元件参数。

界面需要知道每种节点、连接、元件有哪些参数，后端也需要在入库前把参数
限制成合法数值。二者共用这里的 ``ParamSpec``，避免前后端各写一份规则。
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any

from .limits import (
    MAX_ARRAY,
    MAX_MATRIX,
    ValidationError,
    as_bool,
    as_dict,
    as_float,
    as_int,
    as_matrix,
    as_number_list,
    as_str,
    json_safe,
)

_MISSING = object()


@dataclass(frozen=True)
class ParamSpec:
    key: str
    label: str
    type: str = "float"
    default: Any = 0.0
    unit: str = ""
    minimum: float | None = None
    maximum: float | None = None
    step: float | None = None
    positive: bool = False
    choices: tuple[tuple[str, str], ...] = ()
    help: str = ""
    max_size: int = MAX_MATRIX
    placeholder: str = ""
    group: str = ""
    example: str = ""
    required: bool = False

    def coerce(self, value: Any) -> Any:
        if value is _MISSING:
            return copy.deepcopy(self.default)
        label = self.label or self.key
        if self.type == "float":
            return as_float(
                value,
                label,
                lo=self.minimum,
                hi=self.maximum,
                positive=self.positive,
            )
        if self.type == "int":
            lo = int(self.minimum) if self.minimum is not None else None
            hi = int(self.maximum) if self.maximum is not None else None
            return as_int(value, label, lo=lo, hi=hi)
        if self.type == "bool":
            return as_bool(value, label)
        if self.type == "choice":
            text = as_str(value, label)
            allowed = {choice[0] for choice in self.choices}
            if text not in allowed:
                raise ValidationError(f"{label}必须是 {sorted(allowed)} 之一")
            return text
        if self.type == "text":
            return as_str(value, label)
        if self.type == "json":
            return json_safe(value, where=label)
        if self.type == "matrix":
            return as_matrix(value, label, max_size=self.max_size)
        if self.type == "list":
            return as_number_list(value, label, max_len=MAX_ARRAY)
        if self.type == "mapping":
            data = as_dict(value, label)
            result: dict[str, str] = {}
            for key, item in data.items():
                if not isinstance(key, str) or not key.strip():
                    raise ValidationError(f"{label}的键必须是非空字符串")
                result[key] = as_str(item, f"{label}.{key}")
            return result
        if self.type == "node":
            return as_str(value, label, max_len=40)
        raise ValidationError(f"未知参数类型：{self.type!r}")

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "key": self.key,
            "label": self.label,
            "type": self.type,
            "default": copy.deepcopy(self.default),
            "unit": self.unit,
            "help": self.help,
            "group": self.group,
            "example": self.example,
            "required": self.required,
        }
        if self.minimum is not None:
            data["min"] = self.minimum
        if self.maximum is not None:
            data["max"] = self.maximum
        if self.step is not None:
            data["step"] = self.step
        if self.positive:
            data["positive"] = True
        if self.choices:
            data["choices"] = [
                {"value": value, "label": label} for value, label in self.choices
            ]
        if self.placeholder:
            data["placeholder"] = self.placeholder
        return data


def validate_params(specs: list[ParamSpec], raw: Any | None) -> dict[str, Any]:
    """按模式校验参数并补上默认值；拒绝未知键，避免隐藏配置。"""
    if raw is None:
        raw = {}
    data = as_dict(raw, "参数", max_fields=max(16, len(specs) + 8))
    allowed = {spec.key for spec in specs}
    unknown = set(data) - allowed
    if unknown:
        raise ValidationError(f"未知参数：{', '.join(sorted(unknown))}")
    return {
        spec.key: spec.coerce(data.get(spec.key, _MISSING)) for spec in specs
    }


def defaults(specs: list[ParamSpec]) -> dict[str, Any]:
    return validate_params(specs, {})


def float_param(
    key: str,
    label: str,
    default: float,
    *,
    unit: str = "",
    minimum: float | None = None,
    maximum: float | None = None,
    step: float | None = None,
    positive: bool = False,
    help: str = "",
) -> ParamSpec:
    return ParamSpec(
        key=key,
        label=label,
        type="float",
        default=default,
        unit=unit,
        minimum=minimum,
        maximum=maximum,
        step=step,
        positive=positive,
        help=help,
    )


def choice_param(
    key: str,
    label: str,
    default: str,
    choices: tuple[tuple[str, str], ...],
    *,
    help: str = "",
) -> ParamSpec:
    return ParamSpec(
        key=key,
        label=label,
        type="choice",
        default=default,
        choices=choices,
        help=help,
    )


def matrix_param(
    key: str, label: str, default: list[list[float]], *, help: str = ""
) -> ParamSpec:
    return ParamSpec(
        key=key, label=label, type="matrix", default=default, help=help
    )


def list_param(
    key: str, label: str, default: list[float], *, help: str = ""
) -> ParamSpec:
    return ParamSpec(key=key, label=label, type="list", default=default, help=help)


def json_param(key: str, label: str, default: Any, *, help: str = "") -> ParamSpec:
    return ParamSpec(key=key, label=label, type="json", default=default, help=help)


@dataclass
class SpecSet:
    """一组参数的命名容器，便于界面按名称展示。"""

    specs: list[ParamSpec] = field(default_factory=list)

    def validate(self, raw: Any | None) -> dict[str, Any]:
        return validate_params(self.specs, raw)

    def defaults(self) -> dict[str, Any]:
        return defaults(self.specs)

    def serialize(self) -> list[dict[str, Any]]:
        return [spec.to_dict() for spec in self.specs]
