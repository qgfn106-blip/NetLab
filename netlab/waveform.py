"""标准波形发生器：电压源、电流源与信号节点共用。"""

from __future__ import annotations

import math
from typing import Any

from .limits import ComputeError
from .params import ParamSpec, choice_param, float_param

WAVE_KINDS: tuple[tuple[str, str], ...] = (
    ("dc", "直流"),
    ("sine", "正弦"),
    ("square", "方波"),
    ("triangle", "三角波"),
    ("saw", "锯齿波"),
    ("pulse", "脉冲"),
    ("step", "阶跃"),
    ("ramp", "斜坡"),
)

WAVEFORM_SPECS: list[ParamSpec] = [
    choice_param("wave", "波形", "sine", WAVE_KINDS, help="周期波形的频率单位为 Hz"),
    float_param(
        "offset", "偏置 / 直流电压", 0.0, unit="V", step=0.1,
        help="DC 波形下这个值就是输出电压；其他波形下是直流偏置",
    ),
    float_param(
        "amplitude", "幅值（交流）", 1.0, unit="V", step=0.1,
        help="峰峰值的一半；DC 波形不使用",
    ),
    float_param(
        "frequency", "频率（交流）", 10.0, unit="Hz", minimum=0.0, step=1.0,
        help="周期波形使用；DC/step/ramp 不使用",
    ),
    float_param("phase", "相位", 0.0, unit="°", step=15.0),
    float_param(
        "duty", "占空比", 0.5, minimum=0.0, maximum=1.0, step=0.05,
        help="仅 pulse 使用；square 固定 50%",
    ),
    float_param(
        "delay", "延迟", 0.0, unit="s", minimum=0.0, step=0.001,
        help="波形从该时刻开始；DC 不使用",
    ),
]


def waveform_value(params: dict[str, Any], time: float) -> float:
    """在时刻 ``time``（秒）求波形瞬时值。参数应已经过模式校验。"""
    kind = str(params.get("wave", "sine"))
    offset = float(params.get("offset", 0.0))
    amplitude = float(params.get("amplitude", 1.0))
    delay = float(params.get("delay", 0.0))

    if kind == "dc":
        return offset
    if not math.isfinite(time):
        raise ComputeError("波形时间不是有限数值")
    if time < delay:
        return offset

    local = time - delay
    frequency = float(params.get("frequency", 0.0))
    phase_deg = float(params.get("phase", 0.0))
    duty = float(params.get("duty", 0.5))

    if kind in ("sine", "square", "triangle", "saw", "pulse"):
        if frequency <= 0.0:
            # 频率为 0 时退化为直流偏置，避免除零。
            return offset
        cycles = local * frequency + phase_deg / 360.0
        fraction = cycles - math.floor(cycles)
        if kind == "sine":
            return offset + amplitude * math.sin(2.0 * math.pi * cycles)
        if kind == "square":
            return offset + (amplitude if fraction < 0.5 else -amplitude)
        if kind == "triangle":
            return offset + amplitude * (4.0 * abs(fraction - 0.5) - 1.0)
        if kind == "saw":
            return offset + amplitude * (2.0 * fraction - 1.0)
        if kind == "pulse":
            return offset + (amplitude if fraction < duty else 0.0)
    if kind == "step":
        return offset + amplitude
    if kind == "ramp":
        return offset + amplitude * local
    raise ComputeError(f"未知波形：{kind!r}")


def waveform_specs() -> list[ParamSpec]:
    return list(WAVEFORM_SPECS)
