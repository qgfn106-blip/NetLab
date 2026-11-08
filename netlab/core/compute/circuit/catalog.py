"""电路元件注册表：ElementSpec、型号预设与 ELEMENT_SPECS。

从 ``circuit/solver.py`` 原样搬出（M 轮，逻辑零改动）；对外仍由 ``nodal``
兼容层与 ``circuit`` 子包再导出。
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace as _dataclass_replace
from typing import Any

from ...common.limits import ComputeError
from ..params import ParamSpec, choice_param, float_param, validate_params
from ..waveform import WAVEFORM_SPECS
from .elements import (
    ActuatorCurrent,
    ActuatorSource,
    Capacitor,
    CircuitElement,
    Comparator,
    CurrentSource,
    DFlipFlop,
    Diode,
    Inductor,
    OpAmp,
    Resistor,
    SensorElement,
    Switch,
    VCCS,
    VCVS,
    VoltageSource,
    Zener,
)
# ---- 元件注册表 ------------------------------------------------------------
@dataclass(frozen=True)
class ElementSpec:
    kind: str
    label: str
    description: str
    params: tuple[ParamSpec, ...]
    cls: type[CircuitElement]
    notes: str = ""
    group: str = "电路"
    formula: str = ""
    source: str = ""
    editable: bool = False
    builtin: bool = True
    #: 图纸引脚表（R19）：[{name, role, bind, dx, dy}]；空=两端元件默认。
    pins: tuple[dict[str, Any], ...] = ()
    #: 常用型号预设（R22 追加）：{型号: {参数键: SI 值}}，前端选型号时填入。
    presets: dict[str, dict[str, float]] = field(default_factory=dict)


OPAMP_MODELS = {
    "LM741": dict(gain=2.0e5, vcc=15.0, vee=-15.0, vmax=14.0),
    "LM358": dict(gain=1.0e5, vcc=15.0, vee=-15.0, vmax=13.5),
    "TL072": dict(gain=1.0e5, vcc=15.0, vee=-15.0, vmax=13.5),
    "NE5532": dict(gain=1.0e5, vcc=15.0, vee=-15.0, vmax=13.0),
    "LM324": dict(gain=1.0e5, vcc=15.0, vee=0.0, vmax=13.5),
}
COMPARATOR_MODELS = {
    "LM393": dict(gain=1.0e6, vcc=15.0, vee=0.0, vmax=5.0, hysteresis=0.0),
    "LM311": dict(gain=2.0e5, vcc=15.0, vee=-15.0, vmax=15.0, hysteresis=0.0),
    "LM339": dict(gain=1.0e6, vcc=15.0, vee=0.0, vmax=13.5, hysteresis=0.0),
    "TLV3201": dict(gain=1.0e6, vcc=5.0, vee=0.0, vmax=5.0, hysteresis=0.0),
}
DFF_MODELS = {
    "74HC74": dict(vth=2.5, vhigh=5.0, vlow=0.0),
    "74LS74": dict(vth=1.4, vhigh=5.0, vlow=0.0),
    "CD4013": dict(vth=2.5, vhigh=5.0, vlow=0.0),
}

ELEMENT_SPECS: dict[str, ElementSpec] = {
    "resistor": ElementSpec(
        kind="resistor",
        label="电阻",
        description="线性电阻，g = 1/R。",
        params=(
            float_param(
                "R",
                "电阻 R",
                1000.0,
                unit="Ω",
                positive=True,
                step=100.0,
            ),
        ),
        cls=Resistor,
    ),
    "capacitor": ElementSpec(
        kind="capacitor",
        label="电容",
        description="储能元件，按梯形法/后向欧拉伴随模型参与求解。",
        params=(
            float_param(
                "C",
                "电容 C",
                1.0e-6,
                unit="F",
                positive=True,
                step=1.0e-6,
            ),
            float_param("v0", "初始电压", 0.0, unit="V", step=0.1),
        ),
        cls=Capacitor,
        notes="历史电压保存在连接 state.v",
    ),
    "inductor": ElementSpec(
        kind="inductor",
        label="电感",
        description="储能元件，按梯形法/后向欧拉伴随模型参与求解。",
        params=(
            float_param(
                "L",
                "电感 L",
                1.0e-3,
                unit="H",
                positive=True,
                step=1.0e-4,
            ),
            float_param("initial", "初始电流", 0.0, unit="A", step=0.1),
        ),
        cls=Inductor,
        notes="历史电流保存在连接 state.i",
    ),
    "vsource": ElementSpec(
        kind="vsource",
        label="电压源",
        description="理想电压源，支持直流、正弦、方波等波形。",
        params=tuple(WAVEFORM_SPECS),
        cls=VoltageSource,
        notes="支路电流由求解器同时解出",
    ),
    "isource": ElementSpec(
        kind="isource",
        label="电流源",
        description="理想电流源：电流从起点经元件流向终点。",
        params=tuple(WAVEFORM_SPECS),
        cls=CurrentSource,
    ),
    "sensor": ElementSpec(
        kind="sensor",
        label="电压传感器",
        description="R31/P11-05 跨域采样桥：高阻读取节点电压并写入信号字段。",
        params=(ParamSpec("signal", "信号字段", "text", "voltage"),),
        cls=SensorElement,
        formula="v_signal = v(node)",
        notes="只读，不改变电路工作点；采样结果供 actuator 下一拍使用",
    ),
    "actuator": ElementSpec(
        kind="actuator",
        label="受控电压源",
        description="R31/P11-05 跨域驱动桥：按信号字段驱动电压源。",
        params=(
            ParamSpec("source", "信号来源（节点.字段）", "text", ""),
            float_param("gain", "增益", 1.0, step=0.1),
            float_param("offset", "偏置", 0.0, unit="V", step=0.1),
        ),
        cls=ActuatorSource,
        formula="v_out = gain * signal + offset",
        notes="驱动值由 CircuitEngine 在每步 MNA 前从 source 读取，显式一拍延迟",
    ),
    "diode": ElementSpec(
        kind="diode",
        label="二极管",
        description="肖克利方程 pn 结，Newton–Raphson 迭代求解；可带串联电阻。",
        params=(
            float_param(
                "Is", "饱和电流 Is", 1.0e-12, unit="A", positive=True, step=1.0e-13
            ),
            float_param("n", "理想因子 n", 1.0, positive=True, step=0.1),
            float_param(
                "temperature",
                "温度",
                300.0,
                unit="K",
                step=1.0,
            ),
            float_param(
                "rs",
                "串联电阻",
                0.0,
                unit="Ω",
                step=0.01,
                help="大于 0 时自动插入内部节点",
            ),
        ),
        cls=Diode,
    ),
    "switch": ElementSpec(
        kind="switch",
        label="开关",
        description="用导通/断开电阻近似理想开关，可在运行中切换。",
        params=(
            ParamSpec("closed", "闭合", "bool", True),
            float_param("ron", "导通电阻", 1.0e-3, unit="Ω", positive=True, step=0.001),
            float_param("roff", "断开电阻", 1.0e9, unit="Ω", positive=True, step=1.0e6),
        ),
        cls=Switch,
    ),
    "vcvs": ElementSpec(
        kind="vcvs",
        label="压控电压源",
        description="输出电压 = gain × 控制端电压差（VCVS/E 元件）。",
        params=(
            float_param("gain", "增益", 2.0, step=0.1),
            ParamSpec("control_source", "控制正端", "node", ""),
            ParamSpec("control_target", "控制负端", "node", ""),
        ),
        cls=VCVS,
    ),
    "vccs": ElementSpec(
        kind="vccs",
        label="压控电流源",
        description="输出电流 = gm × 控制端电压差（VCCS/G 元件）。",
        params=(
            float_param("gm", "跨导 gm", 0.01, unit="S", step=0.001),
            ParamSpec("control_source", "控制正端", "node", ""),
            ParamSpec("control_target", "控制负端", "node", ""),
        ),
        cls=VCCS,
    ),
    "opamp": ElementSpec(
        kind="opamp",
        label="运算放大器",
        description="单端推挽输出运放；双电源可设参数或接 V+/V− 引脚。",
        params=(
            choice_param(
                "model",
                "型号",
                "LM741",
                (("custom", "自定义"),) + tuple((k, k) for k in OPAMP_MODELS),
                help="LM741/LM358/TL072/NE5532/LM324：选型号填开环增益与电源轨",
            ),
            ParamSpec("vp", "同相端（旧边兼容）", "node", ""),
            ParamSpec("vn", "反相端（旧边兼容）", "node", ""),
            float_param("gain", "开环增益", 2.0e5, step=1.0e4),
            float_param("vcc", "正电源 VCC", 15.0, unit="V", help="未接 V+ 引脚时使用"),
            float_param(
                "vee", "负电源 VEE", -15.0, unit="V", help="未接 V− 引脚时使用"
            ),
            float_param(
                "vmax",
                "饱和电压（旧边兼容）",
                15.0,
                unit="V",
                positive=True,
                help="仅旧「边=元件」路径使用；器件节点请用 VCC/VEE 或引脚",
            ),
            float_param(
                "slew_rate",
                "压摆率 SR",
                0.0,
                unit="V/s",
                help="0 = 理想瞬态（默认）；>0 时每步输出变化不超过 SR·dt",
            ),
            float_param(
                "gbw",
                "增益带宽积 GBW",
                0.0,
                unit="Hz",
                help="0 = 无带宽限制（默认）；>0 时按一阶极点 τ=1/(2π·GBW) 逼近",
            ),
        ),
        cls=OpAmp,
        formula="器件节点：v(OUT) − v(V−) = lo + span·(1 + tanh(A·u/span))/2；"
        "旧边：v(a) − v(b) = vmax·tanh(A·u/vmax)；u = v(IN+) − v(IN−)",
        notes="器件节点为单端输出；V+/V− 同时接线才按引脚电压，否则用 VCC/VEE 且参考地；"
        "slew_rate/gbw 为 0 时按理想瞬态（旧行为）；常用型号 " + "/".join(OPAMP_MODELS),
        presets=OPAMP_MODELS,
    ),
    "comparator": ElementSpec(
        kind="comparator",
        label="电压比较器",
        description="高增益单端比较器；双电源可设参数或接 V+/V− 引脚，可设迟滞。",
        params=(
            choice_param(
                "model",
                "型号",
                "LM393",
                (("custom", "自定义"),) + tuple((k, k) for k in COMPARATOR_MODELS),
                help="LM393/LM311/LM339/TLV3201：选型号填增益、电源轨与迟滞",
            ),
            ParamSpec("vp", "同相端（旧边兼容）", "node", ""),
            ParamSpec("vn", "反相端（旧边兼容）", "node", ""),
            float_param("gain", "开环增益", 1.0e6, step=1.0e5),
            float_param("vcc", "正电源 VCC", 15.0, unit="V", help="未接 V+ 引脚时使用"),
            float_param(
                "vee", "负电源 VEE", -15.0, unit="V", help="未接 V− 引脚时使用"
            ),
            float_param("hysteresis", "迟滞", 0.0, unit="V", step=0.01),
            float_param(
                "vmax",
                "饱和电压（旧边兼容）",
                5.0,
                unit="V",
                positive=True,
                help="仅旧「边=元件」路径使用；器件节点请用 VCC/VEE 或引脚",
            ),
        ),
        cls=Comparator,
        formula="v(OUT) = lo + span·(1 + tanh(A·(u + off)/span))/2，"
        "off = +hys/2（当前输出为高）/ −hys/2（当前输出为低）/ 0（未判定）",
        notes="器件节点为单端输出；迟滞带回差方向记忆（上升沿 u>+hys/2、下降沿 u<−hys/2 翻转）；"
        "常用型号 " + "/".join(COMPARATOR_MODELS),
        presets=COMPARATOR_MODELS,
    ),
    "zener": ElementSpec(
        kind="zener",
        label="稳压二极管",
        description="正向 PN 结 + 反向击穿指数；Vz 为击穿电压。",
        params=(
            float_param("Vz", "击穿电压", 5.1, unit="V", positive=True, step=0.1),
            float_param("ron", "击穿动态电阻", 0.5, unit="Ω", positive=True, step=0.1),
            float_param("Is", "饱和电流", 1.0e-12, unit="A", positive=True),
            float_param("n", "发射系数", 1.5),
            float_param("temperature", "温度", 300.0, unit="K"),
            float_param("rs", "串联电阻", 0.0, unit="Ω"),
        ),
        cls=Zener,
        formula="I = Is(e^{v/Vt}−1) − softplus(−(v+Vz)/0.1)/ron",
        notes="反向击穿用 0.1 V 尺度 softplus 平滑 + 动态电阻 ron（Newton 更稳）；不做温度漂移/噪声",
    ),
    "led": ElementSpec(
        kind="led",
        label="发光二极管",
        description="二极管行为模型（较高正向压降），不做发光物理。",
        params=(
            float_param("Is", "饱和电流", 1.0e-12, unit="A", positive=True),
            float_param("n", "发射系数", 1.0),
            float_param("temperature", "温度", 300.0, unit="K"),
            float_param("rs", "串联电阻", 0.0, unit="Ω"),
        ),
        cls=Diode,
        formula="I = Is(e^{v/(n·Vt)}−1)，指数项限幅 60·Vt；rs>0 时串联电阻进内部节点",
        notes="仅电学行为；发光/颜色不建模",
    ),
    "dflipflop": ElementSpec(
        kind="dflipflop",
        label="D 触发器",
        description="上升沿锁存 D 到 Q 的行为模型；Q 输出为电压源（a-b）。",
        params=(
            choice_param(
                "model",
                "型号",
                "74HC74",
                (("custom", "自定义"),) + tuple((k, k) for k in DFF_MODELS),
                help="74HC74/74LS74/CD4013：选型号填逻辑阈值与高低电平",
            ),
            ParamSpec("d_node", "D 节点", "node", ""),
            ParamSpec("clk_node", "CLK 节点", "node", ""),
            float_param("vth", "逻辑阈值", 2.5, unit="V"),
            float_param("vhigh", "高电平", 5.0, unit="V", positive=True),
            float_param("vlow", "低电平", 0.0, unit="V"),
            float_param("q0", "初值", 0.0, unit="V"),
        ),
        cls=DFlipFlop,
        formula="clk 上升沿：Q←D；否则保持",
        notes="行为级、单步延迟（commit 更新，下一步输出）；不做建立/保持时间；常用型号 "
        + "/".join(DFF_MODELS),
        presets=DFF_MODELS,
    ),
    "if_voltage_to_signal": ElementSpec(
        kind="if_voltage_to_signal",
        label="电压→信号接口",
        description="R06/P4 电路侧接口：高阻采样节点电压并写入信号字段。",
        params=(ParamSpec("signal", "信号字段", "text", "voltage"),),
        cls=SensorElement,
        group="受控源",
        formula="v_signal = v(node)",
        notes="与 sensor 同模型；用于显式标注跨域边界",
    ),
    "if_signal_to_current": ElementSpec(
        kind="if_signal_to_current",
        label="信号→电流源接口",
        description="R06/P4 电路侧接口：按信号字段驱动电流源。",
        params=(
            ParamSpec("source", "信号来源（节点.字段）", "text", ""),
            float_param("gain", "增益", 1.0, step=0.1),
            float_param("offset", "偏置", 0.0, unit="A", step=0.1),
        ),
        cls=ActuatorCurrent,
        group="受控源",
        formula="i_out = gain * signal + offset",
        notes="驱动值由 CircuitEngine 在每步 MNA 前读取，显式一拍延迟",
    ),
}

def element_spec(kind: str) -> ElementSpec:
    spec = ELEMENT_SPECS.get(kind)
    if spec is None:
        raise ComputeError(f"未知电路元件：{kind!r}")
    return spec


def create_element(
    kind: str,
    name: str,
    a: str,
    b: str,
    raw_params: dict[str, Any] | None,
    state: dict[str, Any],
    *,
    integration: str = "trapezoidal",
) -> CircuitElement:
    spec = element_spec(kind)
    params = dict(raw_params or {})
    # 兼容垫片（R21/D42）：旧「边=元件」只给 vmax；换算成 vcc/vee 后再校验，
    # 旧差分语义仍由 vmax 驱动（§8.1）。
    if kind in ("opamp", "comparator"):
        raw_vmax = params.get("vmax")
        if isinstance(raw_vmax, (int, float)) and not isinstance(raw_vmax, bool):
            magnitude = abs(float(raw_vmax))
            params.setdefault("vcc", magnitude)
            params.setdefault("vee", -magnitude)
    params = validate_params(list(spec.params), params)
    return spec.cls(name, a, b, params, state, integration=integration)


#: 多引脚元件的「引脚 → 旧参数端口」映射（R20 过渡）：参数端口逐步退役为引脚。
PIN_BINDINGS: dict[str, tuple[str, str, dict[str, str]]] = {
    "opamp": ("OUT", "V-", {"IN+": "vp", "IN-": "vn"}),
    "comparator": ("OUT", "V-", {"IN+": "vp", "IN-": "vn"}),
    "vcvs": ("OUT+", "OUT-", {"IN+": "control_source", "IN-": "control_target"}),
    "vccs": ("OUT+", "OUT-", {"IN+": "control_source", "IN-": "control_target"}),
    "transformer": ("P1", "P2", {"S1": "secondary_source", "S2": "secondary_target"}),
    "coupling_inductor": (
        "P1",
        "P2",
        {"S1": "secondary_source", "S2": "secondary_target"},
    ),
    "dflipflop": ("Q+", "Q-", {"D": "d_node", "CLK": "clk_node"}),
    "thyristor": ("A", "K", {"G": "gate_node"}),
    "igbt": ("C", "E", {"G": "gate_node"}),
    "jfet": ("D", "S", {"G": "gate_node"}),
    "relay": ("COIL1", "COIL2", {"COM": "com_node", "NO": "no_node"}),
    "ne555": ("OUT", "GND", {"VCC": "vcc_node"}),
    "ldo": ("OUT", "GND", {"IN": "vin_node"}),
    "and_gate": ("Y", "GND", {"A": "in_a", "B": "in_b", "VDD": "vdd_node"}),
    "or_gate": ("Y", "GND", {"A": "in_a", "B": "in_b", "VDD": "vdd_node"}),
    "not_gate": ("Y", "GND", {"A": "in_a", "VDD": "vdd_node"}),
    "xor_gate": ("Y", "GND", {"A": "in_a", "B": "in_b", "VDD": "vdd_node"}),
    "counter4": (
        "Q0",
        "COM",
        {
            "CLK": "clk_node",
            "RST": "rst_node",
            "Q0": "q0_node",
            "Q1": "q1_node",
            "Q2": "q2_node",
            "Q3": "q3_node",
        },
    ),
    "shift4": (
        "Q0",
        "COM",
        {
            "D": "d_node",
            "CLK": "clk_node",
            "RST": "rst_node",
            "Q0": "q0_node",
            "Q1": "q1_node",
            "Q2": "q2_node",
            "Q3": "q3_node",
        },
    ),
    "adc4": (
        "Q0",
        "COM",
        {
            "VIN": "vin_node",
            "CLK": "clk_node",
            "Q1": "q1_node",
            "Q2": "q2_node",
            "Q3": "q3_node",
        },
    ),
    "dac4": (
        "OUT",
        "COM",
        {"B0": "b0_node", "B1": "b1_node", "B2": "b2_node", "B3": "b3_node"},
    ),
    "npn": ("C", "E", {"B": "base_node"}),
    "pnp": ("C", "E", {"B": "base_node"}),
    "nmos": ("D", "S", {"G": "gate_node"}),
    "pmos": ("D", "S", {"G": "gate_node"}),
}

#: v3→v4 迁移专用的旧引脚表（R21 前，OUT+/OUT− 差分输出）；v4→v5 会再改写。
LEGACY_PIN_BINDINGS: dict[str, tuple[str, str, dict[str, str]]] = {
    **PIN_BINDINGS,
    "opamp": ("OUT+", "OUT-", {"IN+": "vp", "IN-": "vn"}),
    "comparator": ("OUT+", "OUT-", {"IN+": "vp", "IN-": "vn"}),
}


def create_element_from_pins(
    kind: str,
    name: str,
    pins: dict[str, str],
    raw_params: dict[str, Any] | None,
    state: dict[str, Any],
    *,
    integration: str = "trapezoidal",
    ground: str | None = None,
) -> CircuitElement:
    """按引脚表装配元件（R20 器件节点）。

    ``pins`` 是「引脚名 → 网络节点 id」；两引脚元件按声明顺序映射到 a/b，
    多引脚元件用 ``PIN_BINDINGS`` 决定 a/b 的引脚名；元件实例持有完整 pin 表，
    通过 ``self.pin(...)`` 读取（旧参数端口只作兼容回退）。

    R21：``V+/V−`` 这类可选引脚缺失时，若它在绑定里承担参考端（如运放 V−），
    用 ``ground`` 作为参考节点；没有接地则明确报错。
    """
    from ...model.ports import pins_for_device

    table = list(pins_for_device(kind))
    names = {pin.name for pin in table}
    extra = sorted(set(pins) - names)
    if extra:
        raise ComputeError(f"元件 {name!r} 收到未声明的引脚：{', '.join(extra)}")
    missing = [pin.name for pin in table if pin.required and pin.name not in pins]
    if missing:
        raise ComputeError(f"元件 {name!r} 的必接引脚没有导线：{', '.join(missing)}")
    spec = element_spec(kind)
    params = dict(raw_params or {})
    params.pop("element", None)
    if len(table) == 2:
        a = pins[table[0].name]
        b = pins[table[1].name]
    else:
        binding = PIN_BINDINGS.get(kind)
        if binding is None:
            raise ComputeError(
                f"器件节点暂不支持元件 {kind!r}（引脚到求解器的映射未登记）"
            )
        a_pin, b_pin, _param_map = binding
        a = pins[a_pin]
        b = pins.get(b_pin)
        if b is None:
            if ground is None:
                raise ComputeError(
                    f"元件 {name!r} 缺少引脚 {b_pin!r}，且电路没有接地参考"
                )
            b = ground
    params_clean = validate_params(list(spec.params), params)
    return spec.cls(name, a, b, params_clean, state, pins=pins, integration=integration)


def element_catalog() -> list[dict[str, Any]]:
    from ..introspection import formula_for, spec_entry
    from ...model.ports import PINS, pin_table

    result: list[dict[str, Any]] = []
    for spec in ELEMENT_SPECS.values():
        entry = spec_entry(
            spec,
            mode="circuit",
            formula=formula_for(spec, ELEMENT_FORMULAS),
            source_target=spec.cls,
            outputs=("current", "voltage_difference", "power"),
        )
        entry["pins"] = pin_table(spec.kind) if spec.kind in PINS else []
        entry["presets"] = getattr(spec, "presets", {})
        result.append(entry)
    return result


ELEMENT_FORMULAS: dict[str, str] = {
    "resistor": "i = (v_a − v_b)/R\ng = 1/R 盖章到 MNA 节点导纳矩阵",
    "capacitor": "梯形法: g = 2C/dt,  i_hist = −g·v[k-1] − i[k-1]\n后向欧拉: g = C/dt,  i_hist = −g·v[k-1]",
    "inductor": "梯形法: g = dt/(2L),  i_hist = i[k-1] + g·v[k-1]\n后向欧拉: g = dt/L,  i_hist = i[k-1]",
    "vsource": "v_a − v_b = waveform(t)\n支路电流为额外未知量",
    "isource": "i_a→b = waveform(t)",
    "diode": "i = Is·(exp(min(60, v/(n·Vt))) − 1)\n"
    "rs>0：串联电阻进内部节点 __name__junction（电流源 offset 盖章）\n"
    "Newton: g = dI/dV,  I_eq = I − g·V",
    "switch": "g = 1/R_on (闭合) 或 1/R_off (断开)",
    "vcvs": "v_a − v_b = gain·(v_c+ − v_c−)",
    "vccs": "i_a→b = gm·(v_c+ − v_c−)",
    "fuse": "g = 1/R_on，|i| > rating 后锁存为 1/R_off",
    "ptc": "R(T) 随温度/电流上升；超过 holding_current 后进入高阻，冷却后恢复",
    "mov": "|v| > clamp_voltage 时电导急剧上升，钳位浪涌电压",
    "zener": "正向 PN 结；反向击穿区 v ≈ −Vz 时强烈导通",
    "schottky": "i = Is·(exp(v/(n·Vt)) − 1)，低 Vf / 低 n",
    "led": "PN 结 + 光子输出；正向 Vf 由材料参数决定，输出亮度 ∝ 电流",
    "tvs": "双向钳位：超过 ±Vbr 后快速导通",
    "varactor": "C(V) = C0 / (1 + V/V0)^m（反偏时）",
    "photodiode": "i = Is·(exp(v/(n·Vt)) − 1) − I_ph",
    "varistor": "V = k·I^α；α>1 时具有非线性限压",
    "thermistor": "R(T) = R0·exp(B·(1/T − 1/T0))",
    "potentiometer": "三端口：R_total 分为 R1 + R2，滑动端按 position 分压",
    "bridge_rectifier": "四只二极管组成的全桥整流",
    "opamp": "器件节点：v(OUT) − v(V−) = lo + span·(1 + tanh(A·u/span))/2\n"
    "旧边：v(a) − v(b) = vmax·tanh(A·u/vmax)\n"
    "gbw>0：一阶极点 τ = 1/(2π·GBW)；slew_rate>0：|Δvout| ≤ SR·dt",
    "comparator": "带回差方向记忆：输出高时翻转阈值 −hys/2、输出低时 +hys/2\n"
    "tanh 平滑（同一 Newton 迭代内只在端点上翻转）",
    "ldo": "可调线性稳压器：反馈分压 + 误差放大 + 输出限流",
    "cccs": "i_a→b = gain·i_control",
    "ccvs": "v_a − v_b = transresistance·i_control",
    "coupling_inductor": "v1 = L1·di1/dt + M·di2/dt；v2 = M·di1/dt + L2·di2/dt",
    "transformer": "理想变压器：v2 = n·v1，i2 = −i1/n（可选励磁电感）",
    "relay": "线圈电流驱动机械触点；触点按 R_on/R_off 建模",
    "dc_motor": "反电动势 v_bemf = Ke·ω；转矩 T = Kt·i；J·dω/dt = T − b·ω",
    "bjt_npn": "分段线性：vbe ≤ vbe_on 时 Ib = vbe·leak；否则 Ib = (vbe−vbe_on)/rin + vbe·leak\n"
    "Ic = β·Ib（Ic_max 限幅）；leak = 1e-9，Is/n/Vt 只用于记录与结电压限幅",
    "bjt_pnp": "分段线性的 PNP 版本（极性取反，Vbe 以发射结为正）",
    "nmos": "Id = 0（vgs ≤ vth_eff）；vds < vov 时线性区 Id = k·(vov·vds − vds²/2)\n"
    "否则饱和区 Id = ½·k·vov²；两者再乘 (1+λ·vds)\n"
    "vth_eff = vth + γ·(√(φ−vbs) − √φ)（body_node 接地或指定衬底）",
    "pmos": "平方律 PMOS 版本（vgs/vds/vbs 均取反，Id 方向相反）",
    "jfet": "Id = Idss·(1 − Vgs/Vp)²（饱和区）",
    "scr": "门极触发后锁存导通，直到电流低于维持电流",
    "triac": "双向晶闸管：门极触发后双向锁存",
    "igbt": "MOS 输入 + BJT 输出，行为级导通/关断模型",
}


def node_catalog() -> list[dict[str, Any]]:
    """电路模式的节点类型。

    和元素规格一样返回「公式 + 真实源码 + 源码路径」，前端规格页才能对
    电路节点给出与实现一致的说明，而不是空白。
    """
    from ..introspection import safe_source, source_path
    from .solver import CircuitSolver

    entries: list[dict[str, Any]] = [
        {
            "kind": "node",
            "label": "电学节点",
            "group": "电路节点",
            "description": "一个等电位节点，数据中保存 voltage。",
            "outputs": ["voltage"],
            "notes": "节点本身没有独立算式：它的电压由整张 MNA 方程一起解出。",
            "formula": (
                "MNA：对每个非接地节点 Σ 注入电流 = 0 → G·V = I；\n"
                "解出后把 V_i 写回 data.voltage（非线性元件走 Newton 迭代）"
            ),
            "target": CircuitSolver.step,
        },
        {
            "kind": "ground",
            "label": "接地",
            "group": "电路节点",
            "description": "参考节点（0 V）。每个电路至少需要一个接地节点。",
            "outputs": [],
            "notes": "接地节点不进入未知量集合，作为矩阵的参考电位。",
            "formula": "V_ground ≡ 0（参考电位）；未知量只包含非接地节点",
            "target": CircuitSolver._build_index,
        },
    ]
    result: list[dict[str, Any]] = []
    for entry in entries:
        target = entry.pop("target")
        result.append(
            {
                **entry,
                "mode": "circuit",
                "editable": False,
                "builtin": True,
                "addable": True,
                "params": [],
                "source": safe_source(target),
                "source_path": source_path(target),
            }
        )
    return result

# ---- 第三批：三极管 / MOSFET（R15） ---------------------------------------
from ..transistors import BJT_SPECS as _TRANSISTOR_SPECS

for _kind, _spec in _TRANSISTOR_SPECS.items():
    ELEMENT_SPECS[_kind] = ElementSpec(**_spec)

from ..logic import LOGIC_GATE_SPECS as _LOGIC_SPECS

for _kind, _spec in _LOGIC_SPECS.items():
    ELEMENT_SPECS[_kind] = ElementSpec(**_spec)

from ..timers import TIMER_SPECS as _TIMER_SPECS

for _kind, _spec in _TIMER_SPECS.items():
    ELEMENT_SPECS[_kind] = ElementSpec(**_spec)

from ..digital import DIGITAL_SPECS as _DIGITAL_SPECS

for _kind, _spec in _DIGITAL_SPECS.items():
    ELEMENT_SPECS[_kind] = ElementSpec(**_spec)

from ..magnetics import MAGNETIC_SPECS as _MAGNETIC_SPECS

for _kind, _spec in _MAGNETIC_SPECS.items():
    ELEMENT_SPECS[_kind] = ElementSpec(**_spec)

from ..powerelectronics import POWER_ELECTRONIC_SPECS as _POWER_SPECS

for _kind, _spec in _POWER_SPECS.items():
    ELEMENT_SPECS[_kind] = ElementSpec(**_spec)


# ---- R22/D46：元件分类（catalog group 是唯一来源） --------------------------
#: 菜单里的固定分组顺序；新增元件必须登记，否则测试会报“未分类”。
ELEMENT_GROUP_ORDER: tuple[str, ...] = (
    "基础无源",
    "电源",
    "受控源",
    "二极管",
    "开关",
    "放大与比较",
    "晶体管",
    "数字与逻辑",
    "计时与电源管理",
    "磁性",
    "功率电子与电机",
)

ELEMENT_GROUPS: dict[str, str] = {
    "resistor": "基础无源",
    "capacitor": "基础无源",
    "inductor": "基础无源",
    "vsource": "电源",
    "isource": "电源",
    "vcvs": "受控源",
    "vccs": "受控源",
    "diode": "二极管",
    "zener": "二极管",
    "led": "二极管",
    "switch": "开关",
    "opamp": "放大与比较",
    "comparator": "放大与比较",
    "sensor": "放大与比较",
    "actuator": "电源",
    "npn": "晶体管",
    "pnp": "晶体管",
    "nmos": "晶体管",
    "pmos": "晶体管",
    "and_gate": "数字与逻辑",
    "or_gate": "数字与逻辑",
    "not_gate": "数字与逻辑",
    "xor_gate": "数字与逻辑",
    "dflipflop": "数字与逻辑",
    "counter4": "数字与逻辑",
    "shift4": "数字与逻辑",
    "adc4": "数字与逻辑",
    "dac4": "数字与逻辑",
    "ne555": "计时与电源管理",
    "ldo": "计时与电源管理",
    "transformer": "磁性",
    "coupling_inductor": "磁性",
    "thyristor": "功率电子与电机",
    "igbt": "功率电子与电机",
    "jfet": "功率电子与电机",
    "relay": "功率电子与电机",
    "motor": "功率电子与电机",
    "if_voltage_to_signal": "受控源",
    "if_signal_to_current": "受控源",
}

for _kind, _group in ELEMENT_GROUPS.items():
    _spec = ELEMENT_SPECS.get(_kind)
    if _spec is not None:
        ELEMENT_SPECS[_kind] = _dataclass_replace(_spec, group=_group)
