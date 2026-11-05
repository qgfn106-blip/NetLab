"""R25 内置块的行为快速模型。

内置 structural 块同时带一份 ``metadata["behavior"]`` 行为描述：默认走这里的
纯 Python 端口映射（快、稳定，适合大网络），勾选“按内部结构仿真”后再走
``BlockRuntime`` 的内部 Scene。两种模式使用完全相同的端口契约，便于对比。

注意：行为模型是黑盒宏模型，不是电路级晶体管的替代品；它只负责端口时序/
饱和特性，R25 的完整电路级内部结构仍以 structural 块为准。
"""

from __future__ import annotations

import math
from typing import Any


def behavior_spec(block: Any) -> dict[str, Any] | None:
    """返回块的 behavior 描述；没有行为模型时返回 None。"""
    metadata = getattr(block, "metadata", None) or {}
    spec = metadata.get("behavior")
    return spec if isinstance(spec, dict) else None


def new_state() -> dict[str, Any]:
    """创建一个实例独占的行为状态。"""
    return {}


def reset_state(state: dict[str, Any]) -> None:
    state.clear()


def _numeric(payload: Any) -> float | None:
    if isinstance(payload, (int, float)) and not isinstance(payload, bool):
        return float(payload)
    if not isinstance(payload, dict):
        return None
    for key in ("voltage", "value", "code", "current"):
        if key in payload:
            value = payload[key]
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                return float(value)
    for value in payload.values():
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return float(value)
    return None


def _input(inputs: dict[str, dict[str, Any]], port: str, default: float = 0.0) -> float:
    payload = inputs.get(port)
    value = _numeric(payload)
    return default if value is None else value


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _rising_edge(state: dict[str, Any], inputs: dict[str, dict[str, Any]], port: str = "clk") -> bool:
    value = _input(inputs, port)
    previous = float(state.get("_last_clk", 0.0))
    state["_last_clk"] = value
    return value >= 0.5 and previous < 0.5


def step(
    block: Any,
    state: dict[str, Any],
    dt: float,
    inputs: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """推进一拍行为模型，返回 ``{端口: {字段: 值}}``。"""
    spec = behavior_spec(block)
    if spec is None:
        raise ValueError(f"功能块 {getattr(block, 'id', '?')} 没有行为模型")
    kind = str(spec.get("kind", ""))
    output = str(spec.get("output", "voltage"))
    if kind == "opamp":
        value = float(spec.get("gain", 1.0e6)) * (_input(inputs, "inp") - _input(inputs, "inn"))
        value = _clamp(value, float(spec.get("low", -15.0)), float(spec.get("high", 15.0)))
    elif kind == "comparator":
        value = float(spec.get("high", 1.0)) if _input(inputs, "inp") >= _input(inputs, "inn") else float(spec.get("low", -1.0))
    elif kind == "dff":
        if _rising_edge(state, inputs):
            state["q"] = 1.0 if _input(inputs, "d") >= 0.5 else 0.0
        value = float(state.get("q", 0.0))
    elif kind == "counter":
        if _input(inputs, "rst") >= 0.5:
            state["count"] = 0
        elif _rising_edge(state, inputs):
            width = max(1, int(spec.get("bits", 4)))
            state["count"] = (int(state.get("count", 0)) + 1) % (1 << width)
        value = float(state.get("count", 0))
    elif kind == "shift":
        if _rising_edge(state, inputs):
            length = max(1, int(spec.get("bits", 4)))
            buffer = list(state.get("buffer") or [0.0] * length)
            buffer = [1.0 if _input(inputs, "data") >= 0.5 else 0.0] + buffer[:-1]
            state["buffer"] = buffer
        buffer = state.get("buffer") or [0.0]
        value = float(buffer[-1])
    elif kind == "timer555":
        high = float(spec.get("high", 5.0))
        low = float(spec.get("low", 0.0))
        frequency = float(spec.get("frequency", 1000.0))
        duty = _clamp(float(spec.get("duty", 0.5)), 0.0, 1.0)
        elapsed = float(state.get("time", 0.0))
        phase = (elapsed * frequency) % 1.0 if frequency > 0 else 1.0
        value = high if phase < duty else low
        state["time"] = elapsed + max(0.0, float(dt))
    elif kind == "ldo":
        value = _clamp(
            _input(inputs, "vin"),
            float(spec.get("low", 0.0)),
            float(spec.get("high", 5.0)),
        )
    elif kind == "adc":
        bits = max(1, int(spec.get("bits", 4)))
        vref = _input(inputs, "vref", float(spec.get("vref", 5.0)))
        if vref <= 0:
            code = 0
        else:
            code = int(math.floor(((1 << bits) - 1) * _input(inputs, "vin") / vref))
        value = float(_clamp(code, 0, (1 << bits) - 1))
    elif kind == "dac":
        bits = max(1, int(spec.get("bits", 4)))
        vref = _input(inputs, "vref", float(spec.get("vref", 5.0)))
        code = _clamp(int(round(_input(inputs, "code"))), 0, (1 << bits) - 1)
        value = vref * code / float((1 << bits) - 1)
    else:
        raise ValueError(f"未知行为模型类型：{kind}")
    return {str(spec.get("port", block.output_ports[0].name if block.output_ports else "out")): {output: value}}
