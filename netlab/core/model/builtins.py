"""R25：随程序发布的只读内置结构块。

内置块不依赖用户 ``library/blocks`` 目录：它们直接以 ``BlockDef`` 形式注册在
代码里，由 :mod:`netlab.core.model.blocklib` 合并进扫描结果、提供 ``load_block``
回退，并拒绝删除/覆盖。这样即使模块库为空（或工程被拷到另一台机器），
运放、比较器、触发器等内置结构仍可打开和另存副本。

当前内置块采用 signal 宏模型表达内部结构（R25 P7-09/P7-10 的第一阶段）：
端口、内部节点、连接和参数都可被“打开内部结构”窗口正常渲染，也可以在
“另存为副本”后作为普通模块编辑。后续可在不改变块 id/端口的前提下把内部
结构替换成电路级实现。
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

from .blocks import BlockDef, PortDef

_STAMP = "2026-11-05T02:00:00+0800"

# BlockDef.id 的校验规则只接受 1–40 位十六进制/连字符；内置块使用稳定、可读的
# 固定 id（a250... 段），避免每次生成时变化导致工程引用失效。
_BUILTIN_IDS = {
    "opamp": "a25000000001",
    "comparator": "a25000000002",
    "dff": "a25000000003",
    "counter4": "a25000000004",
    "shift4": "a25000000005",
    "timer555": "a25000000006",
    "ldo": "a25000000007",
    "adc4": "a25000000008",
    "dac4": "a25000000009",
}


def _hex_id(value: str) -> str:
    """把逻辑节点/边 id 归一化成 BlockDef 接受的十六进制 id。"""
    text = str(value)
    if re.fullmatch(r"[0-9a-fA-F-]{1,40}", text):
        return text
    return hashlib.md5(text.encode("utf-8")).hexdigest()[:12]


def _node(
    node_id: str,
    name: str,
    kind: str,
    x: float,
    y: float,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": _hex_id(node_id),
        "name": name,
        "kind": kind,
        "params": dict(params or {}),
        "data": {},
        "position": {"x": float(x), "y": float(y)},
        "size": {},
    }


def _edge(
    edge_id: str,
    name: str,
    source: str,
    target: str,
    kind: str = "pass",
    params: dict[str, Any] | None = None,
    delay: bool = False,
) -> dict[str, Any]:
    return {
        "id": _hex_id(edge_id),
        "name": name,
        "source": _hex_id(source),
        "target": _hex_id(target),
        "kind": kind,
        "params": dict(params or {}),
        "delay": bool(delay),
        "enabled": True,
    }


def _port(name: str, direction: str, description: str = "") -> PortDef:
    return PortDef(
        name=name,
        direction=direction,
        fields=["voltage"],
        dtype="signal",
        description=description,
    )


def _module_in(prefix: str, port: str, x: float, y: float) -> dict[str, Any]:
    return _node(
        f"{prefix}in{port.replace('-', '')}",
        f"in_{port}",
        "module_input",
        x,
        y,
        {
            "role": "interface",
            "port_name": port,
            "fields": ["voltage"],
            "dtype": "signal",
            "default": 0.0,
        },
    )


def _module_out(prefix: str, port: str, x: float, y: float) -> dict[str, Any]:
    return _node(
        f"{prefix}out{port.replace('-', '')}",
        f"out_{port}",
        "module_output",
        x,
        y,
        {
            "role": "interface",
            "port_name": port,
            "fields": ["voltage"],
            "dtype": "signal",
            "default": 0.0,
        },
    )


def _sum(prefix: str, name: str, x: float, y: float) -> dict[str, Any]:
    return _node(
        f"{prefix}{name}",
        name,
        "sum",
        x,
        y,
        {"field": "voltage", "output": "voltage", "weights": {}},
    )


def _gain(
    prefix: str,
    name: str,
    x: float,
    y: float,
    gain: float,
    offset: float = 0.0,
) -> dict[str, Any]:
    return _node(
        f"{prefix}{name}",
        name,
        "gain",
        x,
        y,
        {"field": "voltage", "output": "voltage", "gain": float(gain), "offset": float(offset)},
    )


def _clip(prefix: str, name: str, x: float, y: float, low: float, high: float) -> dict[str, Any]:
    return _node(
        f"{prefix}{name}",
        name,
        "clip",
        x,
        y,
        {"field": "voltage", "output": "voltage", "minimum": float(low), "maximum": float(high)},
    )


def _block(
    *,
    block_id: str,
    name: str,
    description: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    ports: list[PortDef],
    group: str,
) -> BlockDef:
    return BlockDef(
        id=_BUILTIN_IDS[block_id],
        name=name,
        mode="signal",
        description=description,
        version=1,
        model="structural",
        builtin=True,
        created=_STAMP,
        modified=_STAMP,
        nodes=nodes,
        edges=edges,
        ports=ports,
        metadata={"r25": True, "readonly": True, "group": group, "macro": True, "slug": block_id},
    )


def _amplifier_like(
    *,
    block_id: str,
    name: str,
    description: str,
    gain: float,
    low: float,
    high: float,
) -> BlockDef:
    p = f"r25{block_id}"
    nodes = [
        _module_in(p, "inp", -420, 0),
        _module_in(p, "inn", -420, 120),
        _sum(p, "diff", -40, 0),
        _gain(p, "aol", 140, 0, gain),
        _clip(p, "limit", 320, 0, low, high),
        _module_out(p, "out", 520, 0),
    ]
    edges = [
        _edge(f"{p}epin", "inp-sum", f"{p}ininp", f"{p}diff"),
        _edge(
            f"{p}einn",
            "inn-sum",
            f"{p}ininn",
            f"{p}diff",
            kind="scale",
            params={"input_key": "voltage", "output_key": "voltage", "gain": -1.0, "offset": 0.0},
        ),
        _edge(f"{p}esum", "diff-aol", f"{p}diff", f"{p}aol"),
        _edge(f"{p}eaol", "aol-limit", f"{p}aol", f"{p}limit"),
        _edge(f"{p}eout", "limit-out", f"{p}limit", f"{p}outout"),
    ]
    ports = [_port("inp", "input"), _port("inn", "input"), _port("out", "output")]
    return _block(
        block_id=block_id,
        name=name,
        description=description,
        nodes=nodes,
        edges=edges,
        ports=ports,
        group="模拟",
    )


def _opamp() -> BlockDef:
    return _amplifier_like(
        block_id="opamp",
        name="内置运放",
        description="只读内置结构：差分输入、高开环增益、电源轨限幅的运放宏模型。",
        gain=1.0e6,
        low=-15.0,
        high=15.0,
    )


def _comparator() -> BlockDef:
    return _amplifier_like(
        block_id="comparator",
        name="内置比较器",
        description="只读内置结构：高增益差分比较、输出限幅到逻辑电平的比较器宏模型。",
        gain=1.0e7,
        low=-1.0,
        high=1.0,
    )


def _dff() -> BlockDef:
    p = "r25dff"
    nodes = [
        _module_in(p, "d", -360, -40),
        _module_in(p, "clk", -360, 100),
        _module_out(p, "q", 360, -40),
    ]
    edges = [
        _edge(f"{p}ed", "d-q-delay", f"{p}ind", f"{p}outq", delay=True),
    ]
    return _block(
        block_id="dff",
        name="内置 D 触发器",
        description="只读内置结构：上升沿把 D 锁存到 Q 的 D 触发器宏模型（延迟边表示锁存）。",
        nodes=nodes,
        edges=edges,
        ports=[_port("d", "input"), _port("clk", "input"), _port("q", "output")],
        group="数字",
    )


def _shift4() -> BlockDef:
    p = "r25shift4"
    nodes = [
        _module_in(p, "data", -520, 0),
        _module_in(p, "clk", -520, 140),
        _sum(p, "s1", -280, 0),
        _sum(p, "s2", -60, 0),
        _sum(p, "s3", 160, 0),
        _module_out(p, "q", 420, 0),
    ]
    edges = [
        _edge(f"{p}e1", "data-s1", f"{p}indata", f"{p}s1", delay=True),
        _edge(f"{p}e2", "s1-s2", f"{p}s1", f"{p}s2", delay=True),
        _edge(f"{p}e3", "s2-s3", f"{p}s2", f"{p}s3", delay=True),
        _edge(f"{p}e4", "s3-q", f"{p}s3", f"{p}outq", delay=True),
    ]
    return _block(
        block_id="shift4",
        name="内置 4 位移位寄存器",
        description="只读内置结构：四级延迟边串联的 4 位移位寄存器宏模型。",
        nodes=nodes,
        edges=edges,
        ports=[_port("data", "input"), _port("clk", "input"), _port("q", "output")],
        group="数字",
    )


def _counter4() -> BlockDef:
    p = "r25counter4"
    nodes = [
        _module_in(p, "clk", -420, 0),
        _module_in(p, "rst", -420, 120),
        _node(
            f"{p}count",
            "count",
            "expression",
            80,
            0,
            {
                "expr": "floor(16 * t)",
                "variables": {},
                "output": "voltage",
            },
        ),
        _module_out(p, "q", 420, 0),
    ]
    edges = [
        _edge(f"{p}eclk", "clk-count", f"{p}inclk", f"{p}count"),
        _edge(f"{p}eq", "count-q", f"{p}count", f"{p}outq"),
    ]
    return _block(
        block_id="counter4",
        name="内置 4 位计数器",
        description="只读内置结构：时钟驱动的 4 位计数宏模型（结构预览，输出 0–15 计数码）。",
        nodes=nodes,
        edges=edges,
        ports=[_port("clk", "input"), _port("rst", "input"), _port("q", "output")],
        group="数字",
    )


def _timer555() -> BlockDef:
    p = "r25555"
    nodes = [
        _module_in(p, "vcc", -420, -80),
        _module_in(p, "gnd", -420, 80),
        _node(
            f"{p}osc",
            "osc",
            "signal",
            0,
            0,
            {
                "field": "voltage",
                "wave": "square",
                "offset": 2.5,
                "amplitude": 2.5,
                "frequency": 1000.0,
                "phase": 0.0,
                "duty": 0.5,
                "delay": 0.0,
            },
        ),
        _module_out(p, "out", 360, 0),
    ]
    edges = [
        _edge(f"{p}e1", "osc-out", f"{p}osc", f"{p}outout"),
    ]
    return _block(
        block_id="timer555",
        name="内置 555 定时器",
        description="只读内置结构：以方波振荡宏模型表达 555 定时器输出级。",
        nodes=nodes,
        edges=edges,
        ports=[_port("vcc", "input"), _port("gnd", "input"), _port("out", "output")],
        group="模拟",
    )


def _ldo() -> BlockDef:
    p = "r25ldo"
    nodes = [
        _module_in(p, "vin", -420, 0),
        _module_in(p, "gnd", -420, 120),
        _gain(p, "reg", -80, 0, 1.0),
        _clip(p, "limit", 180, 0, 0.0, 5.0),
        _module_out(p, "vout", 440, 0),
    ]
    edges = [
        _edge(f"{p}e1", "vin-reg", f"{p}invin", f"{p}reg"),
        _edge(f"{p}e2", "reg-limit", f"{p}reg", f"{p}limit"),
        _edge(f"{p}e3", "limit-out", f"{p}limit", f"{p}outvout"),
    ]
    return _block(
        block_id="ldo",
        name="内置 LDO",
        description="只读内置结构：线性稳压器的单位增益调整管 + 输出限幅宏模型。",
        nodes=nodes,
        edges=edges,
        ports=[_port("vin", "input"), _port("gnd", "input"), _port("vout", "output")],
        group="电源",
    )


def _adc4() -> BlockDef:
    p = "r25adc4"
    nodes = [
        _module_in(p, "vin", -460, 0),
        _module_in(p, "vref", -460, 140),
        _node(
            f"{p}code",
            "code",
            "expression",
            40,
            0,
            {
                "expr": "floor(15 * u / v)",
                "variables": {"u": "in_vin.voltage", "v": "in_vref.voltage"},
                "output": "voltage",
            },
        ),
        _clip(p, "limit", 300, 0, 0.0, 15.0),
        _module_out(p, "code", 500, 0),
    ]
    edges = [
        _edge(f"{p}e1", "vin-code", f"{p}invin", f"{p}code"),
        _edge(f"{p}e2", "vref-code", f"{p}invref", f"{p}code"),
        _edge(f"{p}e3", "code-limit", f"{p}code", f"{p}limit"),
        _edge(f"{p}e4", "limit-out", f"{p}limit", f"{p}outcode"),
    ]
    return _block(
        block_id="adc4",
        name="内置 4 位 ADC",
        description="只读内置结构：以输入/基准比值量化到 0–15 码的 4 位 ADC 宏模型。",
        nodes=nodes,
        edges=edges,
        ports=[_port("vin", "input"), _port("vref", "input"), _port("code", "output")],
        group="混合信号",
    )


def _dac4() -> BlockDef:
    p = "r25dac4"
    nodes = [
        _module_in(p, "code", -420, 0),
        _module_in(p, "vref", -420, 140),
        _gain(p, "scale", -60, 0, 5.0 / 15.0),
        _clip(p, "limit", 200, 0, 0.0, 5.0),
        _module_out(p, "vout", 460, 0),
    ]
    edges = [
        _edge(f"{p}e1", "code-scale", f"{p}incode", f"{p}scale"),
        _edge(f"{p}e2", "scale-limit", f"{p}scale", f"{p}limit"),
        _edge(f"{p}e3", "limit-out", f"{p}limit", f"{p}outvout"),
    ]
    return _block(
        block_id="dac4",
        name="内置 4 位 DAC",
        description="只读内置结构：把 0–15 码按 5 V 满量程换算为模拟电压的 4 位 DAC 宏模型。",
        nodes=nodes,
        edges=edges,
        ports=[_port("code", "input"), _port("vref", "input"), _port("vout", "output")],
        group="混合信号",
    )


_BUILTIN_BUILDERS = (
    _opamp,
    _comparator,
    _dff,
    _counter4,
    _shift4,
    _timer555,
    _ldo,
    _adc4,
    _dac4,
)

_CACHE: tuple[BlockDef, ...] | None = None


def builtin_blocks() -> tuple[BlockDef, ...]:
    """返回全部只读内置块（深拷贝由调用方按需处理）。"""
    global _CACHE
    if _CACHE is None:
        _CACHE = tuple(builder() for builder in _BUILTIN_BUILDERS)
    return _CACHE


def builtin_block(block_id: str) -> BlockDef | None:
    """按 id 查找内置块；未命中返回 ``None``。"""
    for block in builtin_blocks():
        if block.id == block_id:
            return block
    return None


def builtin_ids() -> set[str]:
    return {block.id for block in builtin_blocks()}


def is_builtin(block_id: str) -> bool:
    return builtin_block(block_id) is not None


__all__ = [
    "builtin_blocks",
    "builtin_block",
    "builtin_ids",
    "is_builtin",
]
