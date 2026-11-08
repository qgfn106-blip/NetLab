"""core/common/limits.py 的输入校验与 JSON 安全边界（D-1 覆盖率补强）。"""

from __future__ import annotations

import math

import pytest

from netlab.core.common.limits import (
    MAX_ARRAY,
    MAX_FIELDS,
    MAX_NAME,
    MAX_NUMBER,
    MAX_STRING,
    ValidationError,
    as_bool,
    as_dict,
    as_float,
    as_int,
    as_matrix,
    as_number_list,
    as_str,
    check_id,
    check_name,
    clamp,
    format_number,
    json_safe,
)


@pytest.mark.parametrize(
    ("value", "expected"),
    [("  节点 A  ", "节点 A"), ("abc", "abc"), ("a" * MAX_NAME, "a" * MAX_NAME)],
)
def test_check_name_accepts_and_strips(value, expected):
    assert check_name(value) == expected


@pytest.mark.parametrize(
    "value",
    [None, 1, [], "", "   ", "a" * (MAX_NAME + 1), "<script>", "a\x00b", "a&b"],
)
def test_check_name_rejects(value):
    with pytest.raises(ValidationError):
        check_name(value)


def test_check_id_accepts_hex_and_dashes():
    assert check_id("a1-B2-c3") == "a1-B2-c3"


@pytest.mark.parametrize("value", [None, 1, "", "x", "a" * 41, "中文"])
def test_check_id_rejects(value):
    with pytest.raises(ValidationError):
        check_id(value)


def test_as_float_default_none_and_allow_none():
    assert as_float(None, "x", default=2.5) == 2.5
    assert math.isnan(as_float(None, "x", allow_none=True))


@pytest.mark.parametrize(
    "kwargs",
    [
        {"value": None},
        {"value": True},
        {"value": "1"},
        {"value": math.inf},
        {"value": math.nan},
        {"value": MAX_NUMBER * 2},
        {"value": -1, "positive": True},
        {"value": -0.1, "nonnegative": True},
        {"value": 1, "lo": 2},
        {"value": 3, "hi": 2},
    ],
)
def test_as_float_rejects(kwargs):
    kwargs.setdefault("value", 1.0)
    with pytest.raises(ValidationError):
        as_float(kwargs.pop("value"), "x", **kwargs)


def test_as_float_accepts_bounds_and_integral():
    assert as_float(3, "x", lo=1, hi=3, positive=True, nonnegative=True) == 3.0


def test_as_int_default_and_bounds():
    assert as_int(None, "n", default=4) == 4
    assert as_int(2, "n", lo=1, hi=3) == 2
    with pytest.raises(ValidationError):
        as_int(True, "n")
    with pytest.raises(ValidationError):
        as_int(1.5, "n")
    with pytest.raises(ValidationError):
        as_int(0, "n", lo=1)
    with pytest.raises(ValidationError):
        as_int(4, "n", hi=3)


def test_as_bool_default_and_type():
    assert as_bool(None, "b", default=True) is True
    assert as_bool(False, "b") is False
    with pytest.raises(ValidationError):
        as_bool(1, "b")


def test_as_str_default_limits_and_control_chars():
    assert as_str(None, "s", default="d") == "d"
    assert as_str("ok", "s") == "ok"
    with pytest.raises(ValidationError):
        as_str(1, "s")
    with pytest.raises(ValidationError):
        as_str("x" * (MAX_STRING + 1), "s")
    with pytest.raises(ValidationError):
        as_str("a\x00b", "s")
    with pytest.raises(ValidationError):
        as_str("   ", "s", allow_empty=False)


def test_as_dict_type_and_key_limit():
    assert as_dict({"a": 1}, "d") == {"a": 1}
    with pytest.raises(ValidationError):
        as_dict([], "d")
    with pytest.raises(ValidationError):
        as_dict({str(i): i for i in range(MAX_FIELDS + 1)}, "d")


def test_json_safe_scalars_and_containers():
    assert json_safe(None) is None
    assert json_safe(True) is True
    assert json_safe(3) == 3
    assert json_safe(2.5) == 2.5
    assert json_safe([1, (2, 3)]) == [1, [2, 3]]
    assert json_safe({"a": [1, 2]}) == {"a": [1, 2]}
    # 深拷贝：不共享容器
    source = {"a": [1]}
    copied = json_safe(source)
    copied["a"].append(2)
    assert source == {"a": [1]}


@pytest.mark.parametrize(
    "value",
    [
        "x" * (MAX_STRING + 1),
        "a\x00b",
        MAX_NUMBER * 10,
        math.nan,
        math.inf,
        [0] * (MAX_ARRAY + 1),
        {str(i): i for i in range(MAX_FIELDS + 1)},
        {1: "bad-key"},
        {"a" * (MAX_NAME + 1): 1},
        object(),
    ],
)
def test_json_safe_rejects_unsafe_values(value):
    with pytest.raises(ValidationError):
        json_safe(value)


def test_json_safe_rejects_too_deep():
    nested = []
    cursor = nested
    for _ in range(9):
        child = []
        cursor.append(child)
        cursor = child
    with pytest.raises(ValidationError):
        json_safe(nested)


def test_as_number_list_type_length_and_items():
    assert as_number_list([1, 2.5], "xs") == [1.0, 2.5]
    with pytest.raises(ValidationError):
        as_number_list("1", "xs")
    with pytest.raises(ValidationError):
        as_number_list([1], "xs", min_len=2)
    with pytest.raises(ValidationError):
        as_number_list([1, 2], "xs", max_len=1)
    with pytest.raises(ValidationError):
        as_number_list([1, True], "xs")


def test_as_matrix_valid_and_shape_errors():
    assert as_matrix([[1, 2], [3, 4]], "m") == [[1.0, 2.0], [3.0, 4.0]]
    assert as_matrix([[1, 2]], "m", rows=1, cols=2) == [[1.0, 2.0]]
    with pytest.raises(ValidationError):
        as_matrix("x", "m")
    with pytest.raises(ValidationError):
        as_matrix([], "m")
    with pytest.raises(ValidationError):
        as_matrix([[1]] * 3, "m", max_size=2)
    with pytest.raises(ValidationError):
        as_matrix([[1], 2], "m")
    with pytest.raises(ValidationError):
        as_matrix([[1, 2, 3]], "m", max_size=2)
    with pytest.raises(ValidationError):
        as_matrix([[1], [2, 3]], "m")
    with pytest.raises(ValidationError):
        as_matrix([[1], [2]], "m", rows=3)
    with pytest.raises(ValidationError):
        as_matrix([[1, 2]], "m", cols=3)


def test_clamp_and_format_number():
    assert clamp(-1, 0, 1) == 0
    assert clamp(2, 0, 1) == 1
    assert clamp(0.5, 0, 1) == 0.5
    assert format_number(math.nan) == "nan"
    assert format_number(0) == "0"
    assert format_number(1e6) == "1.0000e+06"
    assert format_number(1e-4) == "1.0000e-04"
    assert format_number(12.34567) == "12.35"
