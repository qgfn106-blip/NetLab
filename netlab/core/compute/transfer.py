"""s 域传递函数工具（R34）。

面向 Simulink「Transfer Fcn」式的信号流用法：用户可以直接写
``(2*s+1)/(s^2+3*s+2)``，也可以给降幂系数或零极点；本模块负责

* 解析 s 的有理式（只允许 s、数字、+ - * / ^、括号与隐式乘法）；
* 求零极点、DC 增益、稳定性；
* 转可控标准型状态空间（供节点逐步仿真）；
* Bode 频响与单位阶跃响应（供分析旁路）。

这里只做纯数学，不碰求解器状态；节点执行器在 ``computes.py``，接口在
``server.py``，界面在 ``frontend/app.js``。
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

import numpy as np

from ..common.limits import ComputeError
from .linalg import cont2discrete

MAX_ORDER = 20
MAX_EXPRESSION = 2000
MAX_TOKENS = 400

_NUMBER = re.compile(r"(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?")


# ---------------------------------------------------------------------------
# 多项式：内部一律用升幂（index = 次数），对外一律用降幂系数。
# ---------------------------------------------------------------------------


def _trim(poly: list[float]) -> list[float]:
    """去掉最高次（升幂表示的尾部）的精确零；至少保留一项。"""
    while len(poly) > 1 and poly[-1] == 0.0:
        poly.pop()
    return poly or [0.0]


def _desc_to_asc(values: Sequence[float]) -> list[float]:
    return _trim([float(item) for item in reversed(list(values))])


def _asc_to_desc(poly: Sequence[float]) -> list[float]:
    return [float(item) for item in reversed(_trim(list(poly)))]


def _poly_add(left: list[float], right: list[float]) -> list[float]:
    size = max(len(left), len(right))
    result = [0.0] * size
    for index in range(size):
        result[index] = (left[index] if index < len(left) else 0.0) + (
            right[index] if index < len(right) else 0.0
        )
    return _trim(result)


def _poly_mul(left: list[float], right: list[float]) -> list[float]:
    result = [0.0] * (len(left) + len(right) - 1)
    for i, a in enumerate(left):
        if a == 0.0:
            continue
        for j, b in enumerate(right):
            result[i + j] += a * b
    return _trim(result)


def _poly_scale(poly: list[float], factor: float) -> list[float]:
    return _trim([factor * item for item in poly])


def _poly_pow(poly: list[float], exponent: int) -> list[float]:
    if exponent < 0:
        raise AssertionError("负指数应在调用前交换分子分母")
    result = [1.0]
    base = poly
    power = exponent
    while power:
        if power & 1:
            result = _poly_mul(result, base)
        power >>= 1
        if power:
            base = _poly_mul(base, base)
    return result


def _is_zero(poly: Sequence[float]) -> bool:
    return all(item == 0.0 for item in poly)


# ---------------------------------------------------------------------------
# 词法 / 语法
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Token:
    kind: str
    text: str
    pos: int


def _tokenize(text: str) -> list[_Token]:
    tokens: list[_Token] = []
    index = 0
    size = len(text)
    while index < size:
        char = text[index]
        if char.isspace():
            index += 1
            continue
        if char.isdigit() or char == ".":
            match = _NUMBER.match(text, index)
            if not match:
                raise ComputeError(
                    f"表达式第 {index + 1} 个字符处数字不完整：{text[index:index + 8]!r}"
                )
            tokens.append(_Token("num", match.group(), index))
            index = match.end()
            continue
        if char in "sS":
            if index + 1 < size and (text[index + 1].isalpha() or text[index + 1] == "_"):
                raise ComputeError(
                    f"不支持的变量或函数 {text[index:index + 8]!r}；传递函数只允许变量 s"
                )
            tokens.append(_Token("ident", "s", index))
            index += 1
            continue
        if char in "+-*/^()":
            tokens.append(_Token(char, char, index))
            index += 1
            continue
        raise ComputeError(
            f"表达式第 {index + 1} 个字符 {char!r} 无法识别；"
            "只允许 s、数字与 + - * / ^ ( )"
        )
    if len(tokens) > MAX_TOKENS:
        raise ComputeError(f"表达式过长（{len(tokens)} 个记号，上限 {MAX_TOKENS}）")
    return tokens


def _insert_implicit(tokens: list[_Token]) -> list[_Token]:
    """在 ``2s``、``2(s+1)``、``(s+1)(s+2)`` 之间补乘号。"""
    result: list[_Token] = []
    for token in tokens:
        if result:
            previous = result[-1]
            left = previous.kind in ("num", "ident", ")")
            right = token.kind in ("num", "ident", "(")
            if left and right:
                result.append(_Token("*", "*", token.pos))
        result.append(token)
    return result


class _Parser:
    """递归下降；值统一为 ``(分子升幂, 分母升幂)``。"""

    def __init__(self, tokens: list[_Token]) -> None:
        self.tokens = tokens
        self.index = 0

    def peek(self) -> _Token | None:
        return self.tokens[self.index] if self.index < len(self.tokens) else None

    def take(self) -> _Token:
        token = self.peek()
        if token is None:
            raise ComputeError("表达式意外结束（可能缺少右括号或数字）")
        self.index += 1
        return token

    def expect(self, kind: str) -> _Token:
        token = self.peek()
        if token is None or token.kind != kind:
            found = "表达式结束" if token is None else repr(token.text)
            raise ComputeError(f"表达式第 {self._pos(token)} 个字符处应为 {kind!r}，实际是 {found}")
        return self.take()

    @staticmethod
    def _pos(token: _Token | None) -> int:
        return 1 if token is None else token.pos + 1

    def parse(self) -> tuple[list[float], list[float]]:
        value = self.expression()
        token = self.peek()
        if token is not None:
            raise ComputeError(
                f"表达式第 {token.pos + 1} 个字符处多出了 {token.text!r}"
            )
        return value

    def expression(self) -> tuple[list[float], list[float]]:
        num, den = self.term()
        while True:
            token = self.peek()
            if token is None or token.kind not in ("+", "-"):
                return num, den
            self.take()
            other_num, other_den = self.term()
            if token.kind == "+":
                num = _poly_add(_poly_mul(num, other_den), _poly_mul(other_num, den))
            else:
                num = _poly_add(
                    _poly_mul(num, other_den),
                    _poly_scale(_poly_mul(other_num, den), -1.0),
                )
            den = _poly_mul(den, other_den)
            if _is_zero(den):
                raise ComputeError("表达式分母为零")

    def term(self) -> tuple[list[float], list[float]]:
        num, den = self.unary()
        while True:
            token = self.peek()
            if token is None or token.kind not in ("*", "/"):
                return num, den
            self.take()
            other_num, other_den = self.unary()
            if token.kind == "*":
                num = _poly_mul(num, other_num)
                den = _poly_mul(den, other_den)
            else:
                if _is_zero(other_num):
                    raise ComputeError("表达式除以零")
                num = _poly_mul(num, other_den)
                den = _poly_mul(den, other_num)
            if _is_zero(den):
                raise ComputeError("表达式分母为零")

    def unary(self) -> tuple[list[float], list[float]]:
        token = self.peek()
        if token is not None and token.kind in ("+", "-"):
            self.take()
            num, den = self.unary()
            if token.kind == "-":
                num = _poly_scale(num, -1.0)
            return num, den
        return self.power()

    def power(self) -> tuple[list[float], list[float]]:
        num, den = self.atom()
        token = self.peek()
        if token is None or token.kind != "^":
            return num, den
        self.take()
        exponent = self.exponent()
        if exponent == 0:
            return [1.0], [1.0]
        if exponent > 0:
            return _poly_pow(num, exponent), _poly_pow(den, exponent)
        if _is_zero(num):
            raise ComputeError("0 的负整数次幂没有意义")
        return _poly_pow(den, -exponent), _poly_pow(num, -exponent)

    def exponent(self) -> int:
        sign = 1
        token = self.peek()
        if token is not None and token.kind in ("+", "-"):
            if self.take().kind == "-":
                sign = -1
        token = self.expect("num")
        try:
            value = float(token.text)
        except ValueError as exc:  # pragma: no cover - 词法已保证
            raise ComputeError(f"指数 {token.text!r} 不合法") from exc
        if not value.is_integer():
            raise ComputeError("指数必须是整数")
        if abs(value) > 100:
            raise ComputeError("指数绝对值过大（上限 100）")
        return sign * int(value)

    def atom(self) -> tuple[list[float], list[float]]:
        token = self.take()
        if token.kind == "num":
            try:
                value = float(token.text)
            except ValueError as exc:  # pragma: no cover
                raise ComputeError(f"数字 {token.text!r} 不合法") from exc
            if not math.isfinite(value):
                raise ComputeError(f"数字 {token.text!r} 不是有限值")
            return [value], [1.0]
        if token.kind == "ident":
            return [0.0, 1.0], [1.0]
        if token.kind == "(":
            num, den = self.expression()
            self.expect(")")
            return num, den
        raise ComputeError(
            f"表达式第 {token.pos + 1} 个字符处不能以 {token.text!r} 开始"
        )


# ---------------------------------------------------------------------------
# 传递函数对象
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TransferFunction:
    """降幂系数表示的有理传递函数 ``num(s) / den(s)``。"""

    num: tuple[float, ...]
    den: tuple[float, ...]

    def __post_init__(self) -> None:
        num = _desc_to_asc(self.num)
        den = _desc_to_asc(self.den)
        if _is_zero(den):
            raise ComputeError("传递函数分母不能为零")
        if len(num) - 1 > MAX_ORDER or len(den) - 1 > MAX_ORDER:
            raise ComputeError(
                f"传递函数阶数过高（上限 {MAX_ORDER}；"
                f"当前分子 {len(num) - 1} 阶、分母 {len(den) - 1} 阶）"
            )
        if len(num) - 1 > len(den) - 1:
            raise ComputeError(
                "传递函数不是真有理式（分子阶数高于分母），无法按因果系统仿真；"
                "请加一个极点或改用状态空间"
            )
        # 浮点有限性
        for value in (*num, *den):
            if not math.isfinite(value):
                raise ComputeError("传递函数系数必须是有限数值")
        object.__setattr__(self, "num", tuple(_asc_to_desc(num)))
        object.__setattr__(self, "den", tuple(_asc_to_desc(den)))

    # ---- 基本属性 ---------------------------------------------------------
    @property
    def order(self) -> int:
        return max(0, len(self.den) - 1)

    @property
    def relative_order(self) -> int:
        return max(0, len(self.den) - len(self.num))

    @property
    def is_static(self) -> bool:
        return self.order == 0

    def gain(self) -> float:
        """静态增益；分母常数项为 0 时返回 ``inf``。"""
        if self.den[-1] == 0.0:
            return float("inf")
        return float(self.num[-1] / self.den[-1])

    # ---- 零极点 -----------------------------------------------------------
    def poles(self) -> list[complex]:
        if len(self.den) <= 1:
            return []
        return _clean_roots(np.roots(self.den))

    def zeros(self) -> list[complex]:
        if _is_zero(self.num):
            return []
        if len(self.num) <= 1:
            return []
        return _clean_roots(np.roots(self.num))

    def stability(self) -> str:
        """``stable`` / ``marginal`` / ``unstable``。"""
        roots = self.poles()
        if not roots:
            return "stable"
        scale = max(1.0, max(abs(root) for root in roots))
        tolerance = 1.0e-9 * scale
        largest = max(root.real for root in roots)
        if largest > tolerance:
            return "unstable"
        if largest > -tolerance:
            return "marginal"
        return "stable"

    # ---- 状态空间与频响 ---------------------------------------------------
    def to_state_space(self) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray] | None:
        """可控标准型；静态增益返回 ``None``。"""
        if self.is_static:
            return None
        num = _desc_to_asc(self.num)
        den = _desc_to_asc(self.den)
        order = len(den) - 1
        if len(num) - 1 > order:
            raise ComputeError("传递函数不是真有理式，无法转状态空间")
        # 首一化
        leading = den[-1]
        if leading == 0.0:
            raise ComputeError("分母最高次系数不能为 0")
        num = [value / leading for value in num]
        den = [value / leading for value in den]
        padded = num + [0.0] * (order + 1 - len(num))
        direct = padded[order]
        strict = [padded[index] - direct * den[index] for index in range(order + 1)]
        # 升幂 -> 降幂索引：b_desc[k] = padded[order-k]
        a = np.zeros((order, order), dtype=float)
        for row in range(order - 1):
            a[row, row + 1] = 1.0
        a[-1, :] = [-den[index] for index in range(order)]
        b = np.zeros((order, 1), dtype=float)
        b[-1, 0] = 1.0
        c = np.zeros((1, order), dtype=float)
        for column in range(order):
            c[0, column] = strict[column]
        d = np.zeros((1, 1), dtype=float)
        d[0, 0] = direct
        return a, b, c, d

    def at(self, s: complex) -> complex:
        return complex(np.polyval(self.num, s) / np.polyval(self.den, s))

    def frequency_response(self, omega: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        s = 1j * np.asarray(omega, dtype=float)
        with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
            value = np.polyval(self.num, s) / np.polyval(self.den, s)
        return np.abs(value), np.angle(value)

    # ---- 文本 -------------------------------------------------------------
    def to_expression(self, *, power: str = "^") -> str:
        numerator = _poly_text(self.num, power=power)
        denominator = _poly_text(self.den, power=power)
        if denominator == "1":
            return numerator
        if _needs_parentheses(self.num):
            numerator = f"({numerator})"
        if _needs_parentheses(self.den):
            denominator = f"({denominator})"
        return f"{numerator}/{denominator}"


def _clean_roots(roots: Iterable[complex]) -> list[complex]:
    cleaned: list[complex] = []
    for root in roots:
        real = 0.0 if abs(root.real) < 1.0e-12 else float(root.real)
        imag = 0.0 if abs(root.imag) < 1.0e-12 else float(root.imag)
        cleaned.append(complex(real, imag))
    cleaned.sort(key=lambda item: (round(item.real, 9), round(item.imag, 9)))
    return cleaned


def _format_number(value: float) -> str:
    if value == int(value) and abs(value) < 1.0e15:
        return str(int(value))
    return f"{value:.6g}"


def _needs_parentheses(poly: Sequence[float]) -> bool:
    return sum(1 for value in poly if value != 0.0) > 1


def _poly_text(poly: Sequence[float], *, power: str) -> str:
    degree = len(poly) - 1
    parts: list[str] = []
    for index, coefficient in enumerate(poly):
        if coefficient == 0.0:
            continue
        exponent = degree - index
        magnitude = abs(coefficient)
        if exponent == 0:
            body = _format_number(magnitude)
        elif exponent == 1:
            body = "s" if magnitude == 1.0 else f"{_format_number(magnitude)}*s"
        else:
            unit = f"s{power}{exponent}"
            body = unit if magnitude == 1.0 else f"{_format_number(magnitude)}*{unit}"
        if not parts:
            parts.append(("-" if coefficient < 0 else "") + body)
        else:
            parts.append((" - " if coefficient < 0 else " + ") + body)
    return "".join(parts) or "0"


# ---------------------------------------------------------------------------
# 构造入口
# ---------------------------------------------------------------------------


def from_coefficients(
    numerator: Sequence[float], denominator: Sequence[float]
) -> TransferFunction:
    """降幂系数，例如 ``[1, 2]`` 表示 ``s + 2``。"""
    try:
        num = [float(item) for item in numerator]
        den = [float(item) for item in denominator]
    except (TypeError, ValueError) as exc:
        raise ComputeError("分子/分母系数必须是数值列表") from exc
    if not num:
        num = [0.0]
    if not den:
        raise ComputeError("分母系数不能为空")
    if den[0] == 0.0:
        raise ComputeError("分母最高次系数不能为 0")
    return TransferFunction(num=tuple(num), den=tuple(den))


def from_zpk(
    zeros: Sequence[float], poles: Sequence[float], gain: float = 1.0
) -> TransferFunction:
    """由实零点/极点与增益构造：``gain * Π(s-z) / Π(s-p)``。"""
    if isinstance(gain, bool) or not isinstance(gain, (int, float)):
        raise ComputeError("增益必须是数值")
    if not math.isfinite(float(gain)):
        raise ComputeError("增益必须是有限数值")

    def build(roots: Sequence[float]) -> list[float]:
        poly = [1.0]
        for root in roots:
            if isinstance(root, bool) or not isinstance(root, (int, float)):
                raise ComputeError("零极点必须是数值")
            if not math.isfinite(float(root)):
                raise ComputeError("零极点必须是有限数值")
            poly = _poly_mul(poly, [-float(root), 1.0])
        return poly

    num = _poly_scale(build(zeros), float(gain))
    den = build(poles)
    return TransferFunction(
        num=tuple(_asc_to_desc(num)), den=tuple(_asc_to_desc(den))
    )


def parse_expression(text: str) -> TransferFunction:
    """解析 s 的有理式；支持隐式乘法与整数指数。"""
    if not isinstance(text, str):
        raise ComputeError("传递函数表达式必须是字符串")
    source = text.strip()
    if not source:
        raise ComputeError("传递函数表达式不能为空")
    if len(source) > MAX_EXPRESSION:
        raise ComputeError(f"表达式过长（{len(source)} 字符，上限 {MAX_EXPRESSION}）")
    tokens = _insert_implicit(_tokenize(source))
    if not tokens:
        raise ComputeError("传递函数表达式不能为空")
    num, den = _Parser(tokens).parse()
    if _is_zero(den):
        raise ComputeError("传递函数分母为零")
    return TransferFunction(
        num=tuple(_asc_to_desc(num)), den=tuple(_asc_to_desc(den))
    )


def from_params(params: dict[str, Any]) -> TransferFunction:
    """按节点参数 ``form`` 构造；节点执行器与分析共用。"""
    form = str(params.get("form", "expr") or "expr")
    if form == "coeff":
        return from_coefficients(
            params.get("numerator") or [0.0],
            params.get("denominator") or [1.0],
        )
    if form == "zpk":
        return from_zpk(
            params.get("zeros") or [],
            params.get("poles") or [],
            params.get("gain", 1.0) or 0.0,
        )
    return parse_expression(str(params.get("expr", "") or ""))


# ---------------------------------------------------------------------------
# 频响与阶跃
# ---------------------------------------------------------------------------


def _auto_omega(tf: TransferFunction, points: int) -> np.ndarray:
    scales = [
        abs(root)
        for root in (*tf.poles(), *tf.zeros())
        if root != 0 and math.isfinite(abs(root))
    ]
    if scales:
        low = min(scales) / 100.0
        high = max(scales) * 100.0
    else:
        low, high = 0.1, 100.0
    low = max(low, 1.0e-6)
    high = max(high, low * 10.0)
    high = min(high, 1.0e9)
    return np.logspace(math.log10(low), math.log10(high), max(16, int(points)))


def bode_data(
    tf: TransferFunction, *, omega: np.ndarray | None = None, points: int = 240
) -> dict[str, Any]:
    grid = _auto_omega(tf, points) if omega is None else np.asarray(omega, dtype=float)
    grid = grid[(grid > 0) & np.isfinite(grid)]
    if grid.size == 0:
        raise ComputeError("频响频率点必须为正数")
    magnitude, phase = tf.frequency_response(grid)
    with np.errstate(divide="ignore", invalid="ignore"):
        mag_db = 20.0 * np.log10(magnitude)
    # JSON 不能表达 inf/nan：幅值下限截到 -400 dB，相位保持连续。
    mag_db = np.nan_to_num(mag_db, nan=-400.0, posinf=400.0, neginf=-400.0)
    mag_db = np.clip(mag_db, -400.0, 400.0)
    phase = np.nan_to_num(phase, nan=0.0)
    phase_deg = np.degrees(np.unwrap(phase))
    return {
        "omega": [float(value) for value in grid],
        "frequency_hz": [float(value / (2.0 * math.pi)) for value in grid],
        "magnitude": [float(value) for value in magnitude],
        "magnitude_db": [float(value) for value in mag_db],
        "phase_deg": [float(value) for value in phase_deg],
        "source": "transfer.bode_data",
    }


def _step_metrics(
    time: np.ndarray, values: np.ndarray, *, stable: bool, dc_gain: float | None
) -> dict[str, Any]:
    if values.size == 0:
        return {}
    if not stable:
        return {
            "final": None,
            "overshoot_pct": None,
            "rise_time": None,
            "settling_time": None,
            "steady_state_error": None,
        }
    if dc_gain is not None and math.isfinite(dc_gain):
        final = float(dc_gain)
    else:
        final = float(np.mean(values[-max(1, values.size // 20) :]))
        if not math.isfinite(final):
            final = float(values[-1])
    magnitude = abs(final) if abs(final) > 1.0e-12 else 1.0
    if final > 0.0:
        overshoot = max(0.0, (float(np.max(values)) - final) / magnitude * 100.0)
    elif final < 0.0:
        overshoot = max(0.0, (final - float(np.min(values))) / magnitude * 100.0)
    else:
        overshoot = 0.0

    def crossing(level: float) -> float | None:
        target = final * level
        for index in range(1, values.size):
            before = values[index - 1] - target
            after = values[index] - target
            if before == 0.0:
                return float(time[index - 1])
            if before * after <= 0.0 and after != before:
                fraction = -before / (after - before)
                return float(time[index - 1] + fraction * (time[index] - time[index - 1]))
        return None

    t10 = crossing(0.1)
    t90 = crossing(0.9)
    rise = None if t10 is None or t90 is None or t90 < t10 else t90 - t10
    settled = None
    for index in range(values.size - 1, -1, -1):
        if abs(values[index] - final) > 0.02 * magnitude:
            settled = float(time[min(index + 1, time.size - 1)])
            break
    if settled is None:
        settled = float(time[0])
    if dc_gain is None or not math.isfinite(dc_gain):
        steady_state_error = None
    else:
        steady_state_error = float(1.0 - dc_gain)
    return {
        "final": final,
        "overshoot_pct": float(overshoot),
        "rise_time": rise,
        "settling_time": settled,
        "steady_state_error": steady_state_error,
    }


def step_response(
    tf: TransferFunction,
    *,
    dt: float | None = None,
    duration: float | None = None,
    method: str = "zoh",
    max_points: int = 400,
) -> dict[str, Any]:
    """单位阶跃响应；零初始状态，按所选方法离散。"""
    if method not in ("zoh", "tustin", "backward", "forward"):
        raise ComputeError(f"未知的离散化方法：{method!r}")
    poles = tf.poles()
    stable = tf.stability() == "stable"
    if duration is None:
        if stable and poles:
            slowest = min(abs(root.real) for root in poles if root.real < 0)
            duration = min(max(6.0 / slowest, 1.0), 120.0) if slowest else 10.0
        else:
            duration = 10.0
    duration = float(duration)
    if not math.isfinite(duration) or duration <= 0:
        raise ComputeError("阶跃时长必须是正数")
    if dt is None:
        dt = duration / 1000.0
    dt = float(dt)
    if not math.isfinite(dt) or dt <= 0:
        raise ComputeError("阶跃步长必须是正数")
    # 限制总步数，避免一次分析卡死；优先保证时长，牺牲分辨率。
    if duration / dt > 20000:
        dt = duration / 20000.0
    full_steps = int(math.floor(duration / dt + 1e-9))
    remainder = duration - full_steps * dt
    times = [index * dt for index in range(full_steps + 1)]
    if remainder > 1e-12:
        times.append(duration)
    time = np.asarray(times, dtype=float)
    diverged = False
    if tf.is_static:
        gain = tf.gain()
        values = np.full(time.size, gain, dtype=float)
    else:
        state_space = tf.to_state_space()
        assert state_space is not None
        a, b, c, d = state_space
        try:
            ad, bd, cd, dd = cont2discrete(a, b, c, d, dt, method)
        except Exception as exc:
            raise ComputeError(f"离散化失败：{exc}") from exc
        state = np.zeros((a.shape[0], 1), dtype=float)
        values = np.zeros(time.size, dtype=float)
        for index in range(time.size):
            output = cd @ state + dd
            values[index] = float(output[0, 0])
            if index + 1 < time.size:
                step_dt = float(time[index + 1] - time[index])
                if abs(step_dt - dt) > 1e-12:
                    try:
                        ad, bd, cd, dd = cont2discrete(a, b, c, d, step_dt, method)
                    except Exception as exc:
                        raise ComputeError(f"离散化失败：{exc}") from exc
                state = ad @ state + bd
            if not np.all(np.isfinite(state)) or abs(values[index]) > 1.0e12:
                diverged = True
                time = time[: index + 1]
                values = values[: index + 1]
                break
    metrics = _step_metrics(
        time,
        values,
        stable=stable,
        dc_gain=tf.gain() if math.isfinite(tf.gain()) else None,
    )
    # 抽稀到界面能承受的点数，但保留最后一个点。
    stride = max(1, int(math.ceil(values.size / max(32, int(max_points)))))
    sampled = slice(None, None, stride)
    t_out = time[sampled].tolist()
    y_out = values[sampled].tolist()
    if t_out and t_out[-1] != time[-1]:
        t_out.append(float(time[-1]))
        y_out.append(float(values[-1]))
    return {
        "t": [float(value) for value in t_out],
        "y": [float(value) for value in y_out],
        "dt": dt,
        "duration": duration,
        "method": method,
        "stable": stable,
        "diverged": diverged,
        "metrics": {key: (None if value is None else float(value)) for key, value in metrics.items()},
        "source": "transfer.step_response",
    }


def analyze(
    tf: TransferFunction,
    *,
    dt: float | None = None,
    duration: float | None = None,
    method: str = "zoh",
    points: int = 240,
) -> dict[str, Any]:
    """一次给出表达式、零极点、稳定性、Bode 与阶跃。"""
    poles = [
        {"real": float(root.real), "imag": float(root.imag)} for root in tf.poles()
    ]
    zeros = [
        {"real": float(root.real), "imag": float(root.imag)} for root in tf.zeros()
    ]
    gain = tf.gain()
    stability = tf.stability()
    return {
        "ok": True,
        "expression": tf.to_expression(),
        "num": [float(value) for value in tf.num],
        "den": [float(value) for value in tf.den],
        "order": tf.order,
        "relative_order": tf.relative_order,
        "poles": poles,
        "zeros": zeros,
        "dc_gain": gain if math.isfinite(gain) else None,
        "dc_gain_finite": math.isfinite(gain),
        "stable": stability == "stable",
        "stability": stability,
        "bode": bode_data(tf, points=points),
        "step": step_response(tf, dt=dt, duration=duration, method=method),
        "assumptions": [
            "系数按降幂排列；表达式只允许变量 s、数字与 + - * / ^ ( )",
            "连续域模型按所选方法离散；阶跃响应为零初始状态、单位阶跃",
            "零极点由系数多项式数值求根，重根附近可能有微小虚部",
            "分析只读模型本身，不写求解器状态",
        ],
        "source": "transfer.analyze",
        "elapsed_ms": 0.0,
    }


__all__ = [
    "MAX_ORDER",
    "TransferFunction",
    "analyze",
    "bode_data",
    "from_coefficients",
    "from_params",
    "from_zpk",
    "parse_expression",
    "step_response",
]
