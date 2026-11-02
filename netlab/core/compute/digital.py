"""R15 第三批：4 位计数器与 4 位 DAC（行为级数字/模拟接口）。"""

from __future__ import annotations

from typing import Any

from .nodal import CircuitElement, StampContext
from .params import ParamSpec, choice_param, float_param


class Counter4(CircuitElement):
    """4 位二进制计数器：每个时钟上升沿 +1，RST 高有效。

    多输出用 branch_width=4，每路输出是一个独立电压源行。
    """

    kind = "counter4"
    label = "4 位计数器"
    needs_branch = True
    branch_width = 4
    nonlinear = True
    output_fields = ("current", "voltage_difference", "power", "count")

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.clk_node = self.pin("CLK", "clk_node")
        self.rst_node = self.pin("RST", "rst_node")
        self.q_nodes = [self.pin(f"Q{i}", f"q{i}_node") for i in range(4)]
        self.vhigh = float(self.params.get("vhigh", 5.0))
        self.vlow = float(self.params.get("vlow", 0.0))
        self.vth = float(self.params.get("vth", 2.5))
        self.state.setdefault("counter_value", 0)
        self.state.setdefault("clk", 0.0)

    def stamp(self, ctx: StampContext) -> None:
        count = int(self.state.get("counter_value", 0)) & 0xF
        for index, node in enumerate(self.q_nodes):
            row = self.branch_indices[index]
            bit = (count >> index) & 1
            value = self.vhigh if bit else self.vlow
            ni = ctx.index.get(node)
            bi = ctx.index.get(self.b)
            if ni is not None:
                ctx.A[ni, row] += 1.0
                ctx.A[row, ni] += 1.0
            if bi is not None:
                ctx.A[bi, row] -= 1.0
                ctx.A[row, bi] -= 1.0
            ctx.rhs[row] = value

    def update_guess(self, ctx: StampContext) -> None:
        pass

    def commit(self, ctx: StampContext) -> None:
        clk = ctx.voltage(self.clk_node) if self.clk_node else 0.0
        rst = ctx.voltage(self.rst_node) if self.rst_node else 0.0
        previous = float(self.state.get("clk", 0.0))
        rising = previous < self.vth <= clk
        if rst >= self.vth:
            self.state["counter_value"] = 0
        elif rising:
            self.state["counter_value"] = (int(self.state.get("counter_value", 0)) + 1) & 0xF
        self.state["clk"] = clk
        count = int(self.state.get("counter_value", 0)) & 0xF
        self.result = {
            "current": 0.0,
            "voltage_difference": 0.0,
            "power": 0.0,
            "count": float(count),
        }

    def current(self, ctx: StampContext) -> float:
        return 0.0


class DAC4(CircuitElement):
    """4 位理想 DAC：Vout = Vref·(b3b2b1b0)/15。"""

    kind = "dac4"
    label = "4 位 DAC"
    needs_branch = True
    nonlinear = True
    output_fields = ("current", "voltage_difference", "power", "out")

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.bits = [self.pin(f"B{i}", f"b{i}_node") for i in range(4)]
        self.vref = float(self.params.get("vref", 5.0))
        self.vth = float(self.params.get("vth", 2.5))

    def stamp(self, ctx: StampContext) -> None:
        code = 0
        for index, node in enumerate(self.bits):
            if node and ctx.voltage(node) >= self.vth:
                code |= 1 << index
        value = self.vref * code / 15.0
        row = self.branch_index
        ai = ctx.index.get(self.a)
        bi = ctx.index.get(self.b)
        if ai is not None:
            ctx.A[ai, row] += 1.0
            ctx.A[row, ai] += 1.0
        if bi is not None:
            ctx.A[bi, row] -= 1.0
            ctx.A[row, bi] -= 1.0
        ctx.rhs[row] = value

    def update_guess(self, ctx: StampContext) -> None:
        pass

    def current(self, ctx: StampContext) -> float:
        return float(ctx.solution[self.branch_index])

    def commit(self, ctx: StampContext) -> None:
        current = self.current(ctx)
        voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        self.result = {
            "current": float(current),
            "voltage_difference": float(voltage),
            "power": float(voltage * current),
            "out": float(voltage),
        }


class ShiftRegister4(CircuitElement):
    """4 位串入并出移位寄存器：CLK 上升沿 D→Q0→Q1→Q2→Q3，RST 高有效。"""

    kind = "shift4"
    label = "4 位移位寄存器"
    needs_branch = True
    branch_width = 4
    nonlinear = True
    output_fields = ("current", "voltage_difference", "power", "bits")

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.d_node = self.pin("D", "d_node")
        self.clk_node = self.pin("CLK", "clk_node")
        self.rst_node = self.pin("RST", "rst_node")
        self.q_nodes = [self.pin(f"Q{i}", f"q{i}_node") for i in range(4)]
        self.vhigh = float(self.params.get("vhigh", 5.0))
        self.vlow = float(self.params.get("vlow", 0.0))
        self.vth = float(self.params.get("vth", 2.5))
        self.state.setdefault("shift_bits", [0, 0, 0, 0])
        self.state.setdefault("clk", 0.0)

    def stamp(self, ctx: StampContext) -> None:
        bits = list(self.state.get("shift_bits", [0, 0, 0, 0]))
        for index, node in enumerate(self.q_nodes):
            row = self.branch_indices[index]
            value = self.vhigh if int(bits[index]) else self.vlow
            ni = ctx.index.get(node)
            bi = ctx.index.get(self.b)
            if ni is not None:
                ctx.A[ni, row] += 1.0
                ctx.A[row, ni] += 1.0
            if bi is not None:
                ctx.A[bi, row] -= 1.0
                ctx.A[row, bi] -= 1.0
            ctx.rhs[row] = value

    def update_guess(self, ctx: StampContext) -> None:
        pass

    def commit(self, ctx: StampContext) -> None:
        clk = ctx.voltage(self.clk_node) if self.clk_node else 0.0
        rst = ctx.voltage(self.rst_node) if self.rst_node else 0.0
        previous = float(self.state.get("clk", 0.0))
        bits = list(self.state.get("shift_bits", [0, 0, 0, 0]))
        if rst >= self.vth:
            bits = [0, 0, 0, 0]
        elif previous < self.vth <= clk:
            d = 1 if (self.d_node and ctx.voltage(self.d_node) >= self.vth) else 0
            bits = [d, bits[0], bits[1], bits[2]]
        self.state["shift_bits"] = bits
        self.state["clk"] = clk
        self.result = {
            "current": 0.0,
            "voltage_difference": 0.0,
            "power": 0.0,
            "bits": float(sum((bit << index) for index, bit in enumerate(bits))),
        }

    def current(self, ctx: StampContext) -> float:
        return 0.0


class ADC4(CircuitElement):
    """4 位逐次逼近 ADC：每个 CLK 上升沿做一次比较，4 拍完成一次转换。

    状态：``sar_code``（已确定的位）与 ``sar_trial``（当前试探位，8→4→2→1）。
    转换结束后把结果锁存到 ``adc_code``，Q3..Q0 以电压源输出（Q3=MSB）。
    元件两端 a=Q0、b=公共端（通常接地），其余输出/输入由参数绑定。
    """

    kind = "adc4"
    label = "4 位 ADC（逐次逼近）"
    needs_branch = True
    branch_width = 4
    output_fields = ("current", "voltage_difference", "power", "code")

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.vin_node = self.pin("VIN", "vin_node")
        self.clk_node = self.pin("CLK", "clk_node")
        # Q0 固定接元件起点 a（与其它多输出元件一致），Q1..Q3 由引脚绑定。
        self.q_nodes = [self.a, *(self.pin(f"Q{i}", f"q{i}_node") for i in range(1, 4))]
        self.vref = max(1.0e-9, float(self.params.get("vref", 5.0)))
        self.vth = float(self.params.get("vth", 2.5))
        self.vhigh = float(self.params.get("vhigh", 5.0))
        self.vlow = float(self.params.get("vlow", 0.0))
        self.state.setdefault("adc_code", 0)
        self.state.setdefault("sar_code", 0)
        self.state.setdefault("sar_trial", 0)
        self.state.setdefault("clk", 0.0)

    def stamp(self, ctx: StampContext) -> None:
        code = int(self.state.get("adc_code", 0)) & 0xF
        for index, node in enumerate(self.q_nodes):
            row = self.branch_indices[index]
            value = self.vhigh if ((code >> index) & 1) else self.vlow
            ni = ctx.index.get(node)
            bi = ctx.index.get(self.b)
            if ni is not None:
                ctx.A[ni, row] += 1.0
                ctx.A[row, ni] += 1.0
            if bi is not None:
                ctx.A[bi, row] -= 1.0
                ctx.A[row, bi] -= 1.0
            ctx.rhs[row] = value

    def update_guess(self, ctx: StampContext) -> None:
        pass

    def current(self, ctx: StampContext) -> float:
        return 0.0

    def commit(self, ctx: StampContext) -> None:
        clk = ctx.voltage(self.clk_node) if self.clk_node else 0.0
        previous = float(self.state.get("clk", 0.0))
        code = int(self.state.get("sar_code", 0))
        trial = int(self.state.get("sar_trial", 0))
        if previous < self.vth <= clk:
            if trial <= 0:
                code, trial = 0, 8  # 新的一次转换
            candidate = code | trial
            vin = ctx.voltage(self.vin_node) if self.vin_node else 0.0
            if vin >= self.vref * candidate / 16.0:
                code = candidate
            trial >>= 1
            if trial == 0:
                self.state["adc_code"] = code
        self.state["sar_code"] = code
        self.state["sar_trial"] = trial
        self.state["clk"] = clk
        self.result = {
            "current": 0.0,
            "voltage_difference": 0.0,
            "power": 0.0,
            "code": float(int(self.state.get("adc_code", 0)) & 0xF),
        }


DIGITAL_MODELS = {
    "counter4": {
        "74HC161": dict(vhigh=5.0, vlow=0.0, vth=2.5),
        "74HC163": dict(vhigh=5.0, vlow=0.0, vth=2.5),
        "CD4029": dict(vhigh=5.0, vlow=0.0, vth=2.5),
    },
    "shift4": {
        "74HC595": dict(vhigh=5.0, vlow=0.0, vth=2.5),
        "74HC164": dict(vhigh=5.0, vlow=0.0, vth=2.5),
        "CD4094": dict(vhigh=5.0, vlow=0.0, vth=2.5),
    },
    "adc4": {
        "ADC0804": dict(vref=5.0, vth=2.5, vhigh=5.0, vlow=0.0),
        "ADC0809": dict(vref=5.0, vth=2.5, vhigh=5.0, vlow=0.0),
        "TLC549": dict(vref=5.0, vth=2.5, vhigh=5.0, vlow=0.0),
    },
    "dac4": {
        "DAC0832": dict(vref=5.0, vth=2.5),
        "TLC5620": dict(vref=5.0, vth=2.5),
        "MCP4725": dict(vref=5.0, vth=2.5),
    },
}

DIGITAL_SPECS = {
    "counter4": dict(
        kind="counter4",
        label="4 位计数器",
        description="行为级 4 位二进制计数器：CLK 上升沿 +1，RST 高有效，Q0..Q3 输出。",
        params=(
            choice_param("model", "型号", "74HC161", (("custom", "自定义"),) + tuple((k, k) for k in DIGITAL_MODELS["counter4"]), help="74HC161/163=4 位二进制，CD4029=可预置；选型号填电平/阈值"),
            ParamSpec("clk_node", "时钟节点", "node", ""),
            ParamSpec("rst_node", "复位节点", "node", ""),
            *(ParamSpec(f"q{i}_node", f"Q{i} 节点", "node", "") for i in range(4)),
            float_param("vhigh", "高电平", 5.0, unit="V"),
            float_param("vlow", "低电平", 0.0, unit="V"),
            float_param("vth", "时钟阈值", 2.5, unit="V"),
        ),
        cls=Counter4,
        formula="Q ← (Q+1) mod 16（CLK 上升沿），RST 时 Q=0",
        notes="行为级；无传播延迟/异步复位毛刺",
        presets=DIGITAL_MODELS["counter4"],
        source="netlab/digital.py",
    ),
    "shift4": dict(
        kind="shift4",
        label="4 位移位寄存器",
        description="行为级串入并出移位寄存器：CLK 上升沿 D→Q0→Q1→Q2→Q3，RST 高有效。",
        params=(
            choice_param("model", "型号", "74HC595", (("custom", "自定义"),) + tuple((k, k) for k in DIGITAL_MODELS["shift4"]), help="74HC595=串入并出+锁存，74HC164=串入并出，CD4094=8 位；选型号填电平/阈值"),
            ParamSpec("d_node", "串行输入 D", "node", ""),
            ParamSpec("clk_node", "时钟节点", "node", ""),
            ParamSpec("rst_node", "复位节点", "node", ""),
            *(ParamSpec(f"q{i}_node", f"Q{i} 节点", "node", "") for i in range(4)),
            float_param("vhigh", "高电平", 5.0, unit="V"),
            float_param("vlow", "低电平", 0.0, unit="V"),
            float_param("vth", "时钟阈值", 2.5, unit="V"),
        ),
        cls=ShiftRegister4,
        formula="Q0'=D, Q1'=Q0, Q2'=Q1, Q3'=Q2（CLK 上升沿）",
        notes="行为级；无传播延迟/异步复位毛刺",
        presets=DIGITAL_MODELS["shift4"],
        source="netlab/digital.py",
    ),
    "adc4": dict(
        kind="adc4",
        label="4 位 ADC（逐次逼近）",
        description="行为级逐次逼近 ADC：CLK 上升沿逐位比较，4 拍得到 Q3..Q0。",
        params=(
            choice_param("model", "型号", "ADC0804", (("custom", "自定义"),) + tuple((k, k) for k in DIGITAL_MODELS["adc4"]), help="ADC0804/0809=8 位 SAR，TLC549=8 位串行；本模型为 4 位行为级"),
            ParamSpec("vin_node", "模拟输入节点", "node", ""),
            ParamSpec("clk_node", "时钟节点", "node", ""),
            *(ParamSpec(f"q{i}_node", f"Q{i} 节点", "node", "") for i in range(1, 4)),
            float_param("vref", "参考电压", 5.0, unit="V", positive=True),
            float_param("vth", "时钟阈值", 2.5, unit="V"),
            float_param("vhigh", "高电平", 5.0, unit="V"),
            float_param("vlow", "低电平", 0.0, unit="V"),
        ),
        cls=ADC4,
        formula=(
            "逐次逼近：trial=8,4,2,1；若 Vin ≥ Vref·(code|trial)/16 则保留该位；"
            "4 拍后 code 锁存到 Q3..Q0（Q0=元件起点 a）"
        ),
        notes="行为级；不建模采样保持、比较器延迟与量化噪声；1 次转换=4 个时钟上升沿",
        presets=DIGITAL_MODELS["adc4"],
        source="netlab/digital.py",
    ),
    "dac4": dict(
        kind="dac4",
        label="4 位 DAC",
        description="理想 4 位 DAC：按 b0..b3 的数字电平输出 Vref·code/15。",
        params=(
            choice_param("model", "型号", "DAC0832", (("custom", "自定义"),) + tuple((k, k) for k in DIGITAL_MODELS["dac4"]), help="DAC0832=8 位电流输出，TLC5620/MCP4725=电压输出；本模型为 4 位行为级"),
            *(ParamSpec(f"b{i}_node", f"B{i} 节点", "node", "") for i in range(4)),
            float_param("vref", "参考电压", 5.0, unit="V"),
            float_param("vth", "位阈值", 2.5, unit="V"),
        ),
        cls=DAC4,
        formula="Vout = Vref · (b3·8+b2·4+b1·2+b0) / 15",
        notes="行为级；无建立时间/量化噪声",
        presets=DIGITAL_MODELS["dac4"],
        source="netlab/digital.py",
    ),
}

__all__ = ["ADC4", "Counter4", "DAC4", "ShiftRegister4", "DIGITAL_SPECS"]
