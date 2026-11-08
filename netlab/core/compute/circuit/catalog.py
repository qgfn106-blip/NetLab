"""电路元件注册表：ElementSpec、型号预设与 ELEMENT_SPECS。

从 ``circuit/solver.py`` 原样搬出（M 轮，逻辑零改动）；对外仍由 ``nodal``
兼容层与 ``circuit`` 子包再导出。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ...common.limits import ComputeError
from ..params import ParamSpec, choice_param, float_param
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
