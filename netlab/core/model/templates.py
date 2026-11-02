"""模板场景：一键载入的信号链、状态空间反馈、传递函数与电路示例。"""

from __future__ import annotations

from typing import Any, Callable

TemplateBuilder = Callable[[], dict[str, Any]]


def _node(
    node_id: str,
    name: str,
    kind: str,
    x: float,
    y: float,
    *,
    params: dict[str, Any] | None = None,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": node_id,
        "name": name,
        "kind": kind,
        "position": {"x": x, "y": y},
    }
    if params:
        item["params"] = params
    if data:
        item["data"] = data
    return item


def _edge(
    edge_id: str,
    name: str,
    source: str,
    target: str,
    kind: str,
    *,
    params: dict[str, Any] | None = None,
    delay: bool = False,
    layout: dict[str, Any] | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": edge_id,
        "name": name,
        "source": source,
        "target": target,
        "kind": kind,
        "delay": delay,
    }
    if params:
        item["params"] = params
    if layout:
        item["layout"] = layout
    return item


# ---- 信号层 ----------------------------------------------------------------
def signal_chain() -> dict[str, Any]:
    """原始示例：两路输入、求和、放大输出。"""
    return {
        "mode": "signal",
        "nodes": [
            _node(
                "a00000000001",
                "signal",
                "manual",
                -430,
                -110,
                data={"voltage": 4.0, "source": "信号发生器"},
            ),
            _node(
                "a00000000002",
                "bias",
                "manual",
                -430,
                110,
                data={"voltage": 2.0, "source": "偏置电源"},
            ),
            _node(
                "a00000000003",
                "mixed",
                "sum",
                -180,
                0,
                params={"field": "voltage", "output": "voltage", "weights": {}},
            ),
            _node(
                "a00000000004",
                "output",
                "gain",
                90,
                0,
                params={"field": "voltage", "output": "voltage", "gain": 1.0},
            ),
        ],
        "edges": [
            _edge(
                "b00000000001",
                "signal_path",
                "a00000000001",
                "a00000000003",
                "scale",
                params={"gain": 2.0},
            ),
            _edge(
                "b00000000002",
                "bias_path",
                "a00000000002",
                "a00000000003",
                "scale",
                params={"gain": 0.5},
            ),
            _edge(
                "b00000000003",
                "amplifier",
                "a00000000003",
                "a00000000004",
                "scale",
                params={"gain": 3.0},
            ),
        ],
    }


def control_loop() -> dict[str, Any]:
    """状态空间对象 + 比例控制 + 单步延迟反馈。"""
    return {
        "mode": "signal",
        "nodes": [
            _node(
                "a10000000001",
                "reference",
                "manual",
                -520,
                -80,
                data={"voltage": 1.0},
            ),
            _node(
                "a10000000002",
                "error",
                "sum",
                -290,
                0,
                params={
                    "field": "voltage",
                    "output": "voltage",
                    "weights": {"ref_path": 1.0, "feedback": -1.0},
                },
            ),
            _node(
                "a10000000003",
                "controller",
                "gain",
                -60,
                0,
                params={"field": "voltage", "output": "voltage", "gain": 4.0},
            ),
            _node(
                "a10000000004",
                "plant",
                "state_space",
                180,
                0,
                params={
                    "A": [[0.0, 1.0], [-25.0, -2.0]],
                    "B": [[0.0], [1.0]],
                    "C": [[1.0, 0.0]],
                    "D": [[0.0]],
                    "method": "zoh",
                    "input_map": ["drive.voltage"],
                    "output_map": ["position"],
                    "x0": [0.0, 0.0],
                },
            ),
            _node(
                "a10000000005",
                "scope",
                "sum",
                430,
                0,
                params={"field": "voltage", "output": "voltage", "weights": {}},
            ),
        ],
        "edges": [
            _edge(
                "b10000000001",
                "ref_path",
                "a10000000001",
                "a10000000002",
                "scale",
                params={"gain": 1.0},
            ),
            _edge(
                "b10000000002",
                "err_path",
                "a10000000002",
                "a10000000003",
                "scale",
                params={"gain": 1.0},
            ),
            _edge(
                "b10000000003",
                "drive",
                "a10000000003",
                "a10000000004",
                "scale",
                params={"gain": 1.0},
            ),
            _edge(
                "b10000000004",
                "out_path",
                "a10000000004",
                "a10000000005",
                "scale",
                params={"input_key": "position", "output_key": "voltage", "gain": 1.0},
            ),
            _edge(
                "b10000000005",
                "feedback",
                "a10000000004",
                "a10000000002",
                "delay",
                params={
                    "input_key": "position",
                    "output_key": "voltage",
                    "initial": 0.0,
                },
                delay=True,
            ),
        ],
    }


def transfer_cascade() -> dict[str, Any]:
    """两级一阶传递函数级联，输入为正弦。"""
    return {
        "mode": "signal",
        "nodes": [
            _node(
                "a20000000001",
                "source",
                "signal",
                -480,
                0,
                params={
                    "field": "value",
                    "wave": "sine",
                    "amplitude": 1.0,
                    "frequency": 5.0,
                },
            ),
            _node(
                "a20000000002",
                "stage1",
                "sum",
                -210,
                0,
                params={"field": "voltage", "output": "voltage", "weights": {}},
            ),
            _node(
                "a20000000003",
                "stage2",
                "sum",
                60,
                0,
                params={"field": "voltage", "output": "voltage", "weights": {}},
            ),
            _node(
                "a20000000004",
                "scope",
                "sum",
                320,
                0,
                params={"field": "voltage", "output": "voltage", "weights": {}},
            ),
        ],
        "edges": [
            _edge(
                "b20000000001",
                "lowpass1",
                "a20000000001",
                "a20000000002",
                "tf",
                params={
                    "domain": "continuous",
                    "numerator": [1.0],
                    "denominator": [0.02, 1.0],
                    "input_key": "value",
                    "output_key": "voltage",
                },
            ),
            _edge(
                "b20000000002",
                "lowpass2",
                "a20000000002",
                "a20000000003",
                "tf",
                params={
                    "domain": "continuous",
                    "numerator": [1.0],
                    "denominator": [0.01, 1.0],
                },
            ),
            _edge(
                "b20000000003",
                "out",
                "a20000000003",
                "a20000000004",
                "scale",
            ),
        ],
    }


# ---- 电路层 ----------------------------------------------------------------
def rc_step() -> dict[str, Any]:
    """RC 充电：阶跃 5 V、R=1 kΩ、C=1 µF（τ = 1 ms）。"""
    return {
        "mode": "circuit",
        "nodes": [
            _node("c00000000001", "src", "node", -330, 0),
            _node("c00000000002", "mid", "node", -40, 0),
            _node("c00000000003", "gnd", "ground", 170, 190),
        ],
        "edges": [
            _edge(
                "d00000000001",
                "V1",
                "c00000000001",
                "c00000000003",
                "vsource",
                params={
                    "wave": "step",
                    "offset": 0.0,
                    "amplitude": 5.0,
                    "delay": 0.0,
                },
            ),
            _edge(
                "d00000000002",
                "R1",
                "c00000000001",
                "c00000000002",
                "resistor",
                params={"R": 1000.0},
            ),
            _edge(
                "d00000000003",
                "C1",
                "c00000000002",
                "c00000000003",
                "capacitor",
                params={"C": 1.0e-6, "v0": 0.0},
            ),
        ],
    }


def rlc_series() -> dict[str, Any]:
    """RLC 串联谐振，50 Hz 正弦驱动。"""
    return {
        "mode": "circuit",
        "nodes": [
            _node("c10000000001", "src", "node", -420, 0),
            _node("c10000000002", "mid", "node", -150, 0),
            _node("c10000000003", "out", "node", 120, 0),
            _node("c10000000004", "gnd", "ground", 330, 200),
        ],
        "edges": [
            _edge(
                "d10000000001",
                "V1",
                "c10000000001",
                "c10000000004",
                "vsource",
                params={
                    "wave": "sine",
                    "amplitude": 1.0,
                    "frequency": 50.0,
                },
            ),
            _edge(
                "d10000000002",
                "R1",
                "c10000000001",
                "c10000000002",
                "resistor",
                params={"R": 10.0},
            ),
            _edge(
                "d10000000003",
                "L1",
                "c10000000002",
                "c10000000003",
                "inductor",
                params={"L": 0.01},
            ),
            _edge(
                "d10000000004",
                "C1",
                "c10000000003",
                "c10000000004",
                "capacitor",
                params={"C": 100.0e-6},
            ),
        ],
    }


def diode_rectifier() -> dict[str, Any]:
    """半波整流 + 电容滤波 + 1 kΩ 负载。"""
    return {
        "mode": "circuit",
        "nodes": [
            _node("c20000000001", "src", "node", -430, 0),
            _node("c20000000002", "out", "node", -80, 0),
            _node("c20000000003", "gnd", "ground", 240, 200),
        ],
        "edges": [
            _edge(
                "d20000000001",
                "V1",
                "c20000000001",
                "c20000000003",
                "vsource",
                params={
                    "wave": "sine",
                    "amplitude": 5.0,
                    "frequency": 50.0,
                },
            ),
            _edge(
                "d20000000002",
                "D1",
                "c20000000001",
                "c20000000002",
                "diode",
                params={"Is": 1.0e-12, "n": 1.0, "temperature": 300.0},
            ),
            _edge(
                "d20000000003",
                "C1",
                "c20000000002",
                "c20000000003",
                "capacitor",
                params={"C": 100.0e-6, "v0": 0.0},
            ),
            _edge(
                "d20000000004",
                "R1",
                "c20000000002",
                "c20000000003",
                "resistor",
                params={"R": 1000.0},
            ),
        ],
    }


def controlled_source() -> dict[str, Any]:
    """压控电压源（VCVS）演示：输出 = 3 × 输入。"""
    return {
        "mode": "circuit",
        "nodes": [
            _node("c30000000001", "src", "node", -400, -90),
            _node("c30000000002", "out", "node", -40, -90),
            _node("c30000000003", "gnd", "ground", 180, 180),
        ],
        "edges": [
            _edge(
                "d30000000001",
                "V1",
                "c30000000001",
                "c30000000003",
                "vsource",
                params={
                    "wave": "sine",
                    "amplitude": 1.0,
                    "frequency": 20.0,
                },
            ),
            _edge(
                "d30000000002",
                "E1",
                "c30000000002",
                "c30000000003",
                "vcvs",
                params={
                    "gain": 3.0,
                    "control_source": "c30000000001",
                    "control_target": "c30000000003",
                },
            ),
            _edge(
                "d30000000003",
                "R1",
                "c30000000002",
                "c30000000003",
                "resistor",
                params={"R": 1000.0},
            ),
        ],
    }


def blank_signal() -> dict[str, Any]:
    return {"mode": "signal", "nodes": [], "edges": []}


def blank_circuit() -> dict[str, Any]:
    return {
        "mode": "circuit",
        "nodes": [
            _node("c90000000001", "gnd", "ground", 0, 160),
            _node("c90000000002", "n1", "node", -160, 0),
            _node("c90000000003", "n2", "node", 120, 0),
        ],
        "edges": [
            _edge(
                "d90000000001",
                "V1",
                "c90000000002",
                "c90000000001",
                "vsource",
                params={"wave": "dc", "offset": 5.0},
            ),
            _edge(
                "d90000000002",
                "R1",
                "c90000000002",
                "c90000000003",
                "resistor",
                params={"R": 1000.0},
            ),
            _edge(
                "d90000000003",
                "R2",
                "c90000000003",
                "c90000000001",
                "resistor",
                params={"R": 1000.0},
            ),
        ],
    }


def nonlinear_control() -> dict[str, Any]:
    """Duffing 参考 + 非线性对象 + 滑模控制 + Van der Pol 扰动 + 矢量误差监视。"""
    return {
        "mode": "vector",
        "nodes": [
            _node(
                "e00000000001",
                "ref",
                "oscillator",
                -470,
                -160,
                params={
                    "system": "duffing",
                    "damping": 0.12,
                    "stiffness": 1.0,
                    "nonlinearity": 0.65,
                    "forcing_amplitude": 0.9,
                    "forcing_frequency": 0.18,
                    "coupling": 0.0,
                    "initial_x": 0.8,
                    "initial_y": 0.0,
                },
                data={"x": 0.8, "y": 0.0},
            ),
            _node(
                "e00000000002",
                "dist",
                "oscillator",
                -470,
                180,
                params={
                    "system": "vanderpol",
                    "damping": 0.4,
                    "stiffness": 1.0,
                    "forcing_amplitude": 0.35,
                    "forcing_frequency": 0.33,
                    "coupling": 0.0,
                    "initial_x": 0.1,
                    "initial_y": 0.2,
                },
                data={"x": 0.1, "y": 0.2},
            ),
            _node(
                "e00000000003",
                "plant",
                "nonlinear_plant",
                90,
                0,
                params={
                    "a": 1.2,
                    "b": 0.8,
                    "c": 0.35,
                    "disturbance": 0.15,
                    "frequency": 0.4,
                },
                data={"x1": 0.0, "x2": 0.0},
            ),
            _node(
                "e00000000004",
                "ctl",
                "sliding_mode",
                -210,
                0,
                params={
                    "lambda": 2.2,
                    "gain": 3.2,
                    "eta": 1.4,
                    "phi": 0.08,
                    "limit": 12.0,
                    "feedforward": 0.0,
                },
            ),
            _node(
                "e00000000005",
                "error_vec",
                "vector_transform",
                380,
                0,
                params={
                    "matrix": [[1.0, 0.0], [0.0, 1.0]],
                    "input_x": "x",
                    "input_y": "y",
                    "output_x": "x",
                    "output_y": "y",
                },
            ),
        ],
        "edges": [
            _edge(
                "f00000000001",
                "ref_x",
                "e00000000001",
                "e00000000004",
                "scale",
                params={"input_key": "x", "output_key": "ref", "gain": 1.0},
            ),
            _edge(
                "f00000000002",
                "ref_dx",
                "e00000000001",
                "e00000000004",
                "scale",
                params={"input_key": "y", "output_key": "dref", "gain": 1.0},
            ),
            _edge(
                "f00000000003",
                "plant_x",
                "e00000000003",
                "e00000000004",
                "scale",
                params={"input_key": "x1", "output_key": "x", "gain": 1.0},
            ),
            _edge(
                "f00000000004",
                "plant_dx",
                "e00000000003",
                "e00000000004",
                "scale",
                params={"input_key": "x2", "output_key": "dx", "gain": 1.0},
            ),
            _edge(
                "f00000000005",
                "control",
                "e00000000004",
                "e00000000003",
                "delay",
                params={"input_key": "u", "output_key": "u", "initial": 0.0},
                delay=True,
            ),
            _edge(
                "f00000000006",
                "disturbance",
                "e00000000002",
                "e00000000003",
                "scale",
                params={"input_key": "x", "output_key": "w", "gain": 1.0},
            ),
            _edge(
                "f00000000007",
                "error_x",
                "e00000000004",
                "e00000000005",
                "scale",
                params={"input_key": "error", "output_key": "x", "gain": 1.0},
            ),
            _edge(
                "f00000000008",
                "error_y",
                "e00000000004",
                "e00000000005",
                "scale",
                params={"input_key": "de", "output_key": "y", "gain": 1.0},
            ),
        ],
    }


def vector_network() -> dict[str, Any]:
    """三个非线性振子通过延迟扩散边耦合，并接一个矢量旋转监视节点。"""
    return {
        "mode": "vector",
        "nodes": [
            _node(
                "e10000000001",
                "osc_a",
                "oscillator",
                -300,
                -180,
                params={
                    "system": "duffing",
                    "damping": 0.12,
                    "stiffness": 1.0,
                    "nonlinearity": 0.5,
                    "forcing_amplitude": 0.45,
                    "forcing_frequency": 0.22,
                    "coupling": 0.65,
                    "initial_x": 1.0,
                    "initial_y": 0.0,
                },
                data={"x": 1.0, "y": 0.0},
            ),
            _node(
                "e10000000002",
                "osc_b",
                "oscillator",
                40,
                260,
                params={
                    "system": "vanderpol",
                    "damping": 0.45,
                    "stiffness": 1.0,
                    "forcing_amplitude": 0.2,
                    "forcing_frequency": 0.3,
                    "coupling": 0.5,
                    "initial_x": -0.6,
                    "initial_y": 0.4,
                },
                data={"x": -0.6, "y": 0.4},
            ),
            _node(
                "e10000000003",
                "osc_c",
                "oscillator",
                360,
                -180,
                params={
                    "system": "pendulum",
                    "damping": 0.08,
                    "stiffness": 1.0,
                    "forcing_amplitude": 0.0,
                    "forcing_frequency": 0.2,
                    "coupling": 0.55,
                    "initial_x": 0.7,
                    "initial_y": -0.25,
                },
                data={"x": 0.7, "y": -0.25},
            ),
            _node(
                "e10000000004",
                "rot",
                "vector_transform",
                40,
                -20,
                params={
                    "matrix": [[0.8660254, -0.5], [0.5, 0.8660254]],
                    "input_x": "x",
                    "input_y": "y",
                    "output_x": "x",
                    "output_y": "y",
                },
            ),
        ],
        "edges": [
            _edge(
                "f10000000001",
                "a_to_b",
                "e10000000001",
                "e10000000002",
                "vector_diffusion",
                params={"gain": 0.45},
                delay=True,
            ),
            _edge(
                "f10000000002",
                "b_to_a",
                "e10000000002",
                "e10000000001",
                "vector_diffusion",
                params={"gain": 0.45},
                delay=True,
            ),
            _edge(
                "f10000000003",
                "b_to_c",
                "e10000000002",
                "e10000000003",
                "vector_diffusion",
                params={"gain": 0.4},
                delay=True,
            ),
            _edge(
                "f10000000004",
                "c_to_b",
                "e10000000003",
                "e10000000002",
                "vector_diffusion",
                params={"gain": 0.4},
                delay=True,
            ),
            _edge(
                "f10000000005",
                "a_to_c",
                "e10000000001",
                "e10000000003",
                "vector_diffusion",
                params={"gain": 0.35},
                delay=True,
            ),
            _edge(
                "f10000000006",
                "c_to_a",
                "e10000000003",
                "e10000000001",
                "vector_diffusion",
                params={"gain": 0.35},
                delay=True,
            ),
            _edge(
                "f10000000007",
                "rot_monitor",
                "e10000000001",
                "e10000000004",
                "vector",
                params={
                    "matrix": [[0.8660254, -0.5], [0.5, 0.8660254]],
                },
            ),
        ],
    }


def blank_vector() -> dict[str, Any]:
    return {"mode": "vector", "nodes": [], "edges": []}



def trip_unit() -> dict[str, Any]:
    """脱扣器示意电路：整流 → RC 滤波 → 分压 → 比较器 → D 触发器 → LED。

    受现有元件限制（暂无变压器/互感/BJT），这是 DW15 脱扣器原理图的
    行为级近似，用来检验图纸规范（位号/参数/汇合点/正交/断线）。
    """
    return {
        "mode": "circuit",
        "nodes": [
            _node("c80000000001", "ac", "node", -520, 0),
            _node("c80000000002", "p", "node", -340, -140),
            _node("c80000000003", "filt", "node", -160, 0),
            _node("c80000000004", "sense", "node", 0, 0),
            _node("c80000000005", "ref", "node", -60, 180),
            _node("c80000000006", "cmp", "node", 120, -180),
            _node("c80000000007", "clk", "node", 140, 120),
            _node("c80000000008", "q", "node", 340, 0),
            _node("c80000000009", "led", "node", 500, 0),
            _node("c80000000010", "gnd", "ground", 340, 260),
        ],
        "edges": [
            _edge("d80000000001", "V1", "c80000000001", "c80000000010", "vsource",
                  params={"wave": "sine", "amplitude": 12.0, "frequency": 50.0, "offset": 0.0}),
            _edge("d80000000002", "D1", "c80000000001", "c80000000002", "diode",
                  params={"Is": 1.0e-12, "n": 1.0, "temperature": 300.0, "rs": 0.0}),
            _edge("d80000000003", "D2", "c80000000010", "c80000000002", "diode",
                  params={"Is": 1.0e-12, "n": 1.0, "temperature": 300.0, "rs": 0.0}),
            _edge("d80000000004", "R1", "c80000000002", "c80000000003", "resistor",
                  params={"R": 1000.0}),
            _edge("d80000000005", "C1", "c80000000003", "c80000000010", "capacitor",
                  params={"C": 100e-6}),
            _edge("d80000000006", "R2", "c80000000003", "c80000000004", "resistor",
                  params={"R": 10000.0}),
            _edge("d80000000007", "R3", "c80000000004", "c80000000010", "resistor",
                  params={"R": 4700.0}),
            _edge("d80000000008", "Z1", "c80000000010", "c80000000004", "zener",
                  params={"Vz": 5.1, "ron": 0.5, "Is": 1.0e-12, "n": 1.5, "temperature": 300.0, "rs": 0.0}),
            _edge("d80000000009", "VREF", "c80000000005", "c80000000010", "vsource",
                  params={"wave": "dc", "offset": 1.0, "amplitude": 0.0}),
            _edge("d80000000010", "CMP", "c80000000006", "c80000000010", "comparator",
                  params={"vp": "c80000000004", "vn": "c80000000005", "gain": 1.0e6, "vmax": 5.0}),
            _edge("d80000000011", "R5", "c80000000006", "c80000000007", "resistor",
                  params={"R": 1000.0}),
            _edge("d80000000012", "R6", "c80000000007", "c80000000010", "resistor",
                  params={"R": 10000.0}),
            _edge("d80000000013", "FF1", "c80000000008", "c80000000010", "dflipflop",
                  params={"d_node": "c80000000003", "clk_node": "c80000000007",
                          "vth": 2.5, "vhigh": 5.0, "vlow": 0.0, "q0": 0.0}),
            _edge("d80000000014", "R7", "c80000000008", "c80000000009", "resistor",
                  params={"R": 330.0}),
            _edge("d80000000015", "LED1", "c80000000009", "c80000000010", "led",
                  params={"Is": 1.0e-12, "n": 1.0, "temperature": 300.0, "rs": 0.0}),
        ],
    }




def opamp_internal() -> dict[str, Any]:
    """运放内部宏模型（简化）：差分输入 → 高增益级 → RC 极点 → 输出缓冲。

    用 VCVS 近似内部增益级；不含晶体管级细节（BJT 属 R15 第三批）。
    """
    return {
        "mode": "circuit",
        "nodes": [
            _node("c90000000001", "inp", "node", -520, -80),
            _node("c90000000002", "inn", "node", -520, 80),
            _node("c90000000003", "n1", "node", -300, 0),
            _node("c90000000004", "n2", "node", -120, 0),
            _node("c90000000005", "out", "node", 100, 0),
            _node("c90000000006", "n3", "node", 260, 0),
            _node("c90000000007", "gnd", "ground", 0, 220),
        ],
        "edges": [
            _edge("e90000000001", "VIN", "c90000000001", "c90000000007", "vsource",
                  params={"wave": "dc", "offset": 0.001, "amplitude": 0.0}),
            _edge("e90000000002", "VREF", "c90000000002", "c90000000007", "vsource",
                  params={"wave": "dc", "offset": 0.0, "amplitude": 0.0}),
            _edge("e90000000003", "RIN", "c90000000001", "c90000000002", "resistor",
                  params={"R": 1.0e6}),
            _edge("e90000000004", "E1", "c90000000003", "c90000000007", "vcvs",
                  params={"gain": 10000.0, "control_source": "c90000000001", "control_target": "c90000000002"}),
            _edge("e90000000005", "R1", "c90000000003", "c90000000004", "resistor",
                  params={"R": 1000.0}),
            _edge("e90000000006", "C1", "c90000000004", "c90000000007", "capacitor",
                  params={"C": 1.0e-6}),
            _edge("e90000000007", "E2", "c90000000005", "c90000000007", "vcvs",
                  params={"gain": 1.0, "control_source": "c90000000004", "control_target": "c90000000007"}),
            _edge("e90000000008", "ROUT", "c90000000005", "c90000000006", "resistor",
                  params={"R": 75.0}),
            _edge("e90000000009", "RL", "c90000000006", "c90000000007", "resistor",
                  params={"R": 10000.0}),
        ],
    }



def opamp_inverting() -> dict[str, Any]:
    """运放反相放大（手工摆位示例）。"""
    return {
        "mode": "circuit",
        "nodes": [
            _node("ca0000000001", "in", "node", -420, 0),
            _node("ca0000000002", "vn", "node", -120, 0),
            _node("ca0000000003", "out", "node", 300, 0),
            _node("ca0000000004", "gnd", "ground", 0, 200),
        ],
        "edges": [
            _edge("ea0000000001", "VIN", "ca0000000001", "ca0000000004", "vsource",
                  params={"wave": "sine", "amplitude": 0.05, "frequency": 100.0, "offset": 0.0},
                  layout={"x": -420, "y": 100, "rot": 90}),
            _edge("ea0000000002", "RIN", "ca0000000001", "ca0000000002", "resistor",
                  params={"R": 10000.0}, layout={"x": -270, "y": 0, "rot": 0}),
            _edge("ea0000000003", "RF", "ca0000000002", "ca0000000003", "resistor",
                  params={"R": 100000.0}, layout={"x": 90, "y": -120, "rot": 0}),
            _edge("ea0000000004", "U1", "ca0000000003", "ca0000000004", "opamp",
                  params={"vp": "ca0000000004", "vn": "ca0000000002", "gain": 1.0e5, "vmax": 15.0},
                  layout={"x": 70, "y": 0, "rot": 0}),
            _edge("ea0000000005", "RL", "ca0000000003", "ca0000000004", "resistor",
                  params={"R": 10000.0}, layout={"x": 220, "y": 100, "rot": 90}),
        ],
    }


def common_collector() -> dict[str, Any]:
    """共集放大电路（射极跟随器，R20 器件节点模型）。

    VCC=12 V；R1=47k/R2=22k 基极分压，VE≈3.1 V；RE=1k；1 kHz、0.2 V 正弦经
    CIN=10 µF 耦合到基极；输出在发射极，电压跟随输入（略小于 1）。
    """
    def net(nid, name, x, y, kind="node"):
        return {"id": nid, "name": name, "kind": kind,
                "position": {"x": x, "y": y}}

    def dev(nid, name, element, x, y, **params):
        return {"id": nid, "name": name, "kind": "device",
                "params": {"element": element, **params},
                "data": {}, "position": {"x": x, "y": y}, "size": {}}

    nodes = [
        net("a00000000001", "VCC", 0, 0),
        net("a00000000002", "BASE", 0, 220),
        net("a00000000003", "EMIT", 0, 420),
        net("a00000000004", "GND", 0, 680, "ground"),
        net("a00000000005", "IN", -300, 220),
        dev("b00000000001", "V1", "vsource", -360, 60,
            wave="dc", offset=12.0, amplitude=0.0, frequency=50.0),
        dev("b00000000002", "R1", "resistor", 210, 90, R=47000.0),
        dev("b00000000003", "R2", "resistor", 210, 520, R=22000.0),
        dev("b00000000004", "Q1", "npn", 430, 320,
            Is=1.0e-14, n=1.0, temperature=300.0, beta=100.0,
            vbe_on=0.7, rin=1000.0),
        dev("b00000000005", "RE", "resistor", 120, 590, R=1000.0),
        dev("b00000000006", "CIN", "capacitor", -160, 220, C=1.0e-5, v0=-3.826),
        dev("b00000000007", "VIN", "vsource", -470, 440,
            wave="sine", offset=0.0, amplitude=0.2, frequency=1000.0),
    ]
    wires = [
        ("b00000000001", "a00000000001", "+", "V1.VCC"),
        ("b00000000001", "a00000000004", "-", "V1.GND"),
        ("b00000000002", "a00000000001", "1", "R1.VCC"),
        ("b00000000002", "a00000000002", "2", "R1.BASE"),
        ("b00000000003", "a00000000002", "1", "R2.BASE"),
        ("b00000000003", "a00000000004", "2", "R2.GND"),
        ("b00000000004", "a00000000001", "C", "Q1.C"),
        ("b00000000004", "a00000000002", "B", "Q1.B"),
        ("b00000000004", "a00000000003", "E", "Q1.E"),
        ("b00000000005", "a00000000003", "1", "RE.EMIT"),
        ("b00000000005", "a00000000004", "2", "RE.GND"),
        ("b00000000006", "a00000000005", "1", "CIN.IN"),
        ("b00000000006", "a00000000002", "2", "CIN.BASE"),
        ("b00000000007", "a00000000005", "+", "VIN.IN"),
        ("b00000000007", "a00000000004", "-", "VIN.GND"),
    ]
    edges = []
    for index, (device_id, net_id, pin, name) in enumerate(wires, start=1):
        edges.append({
            "id": f"c{index:011x}",
            "name": name,
            "source": device_id,
            "target": net_id,
            "kind": "wire",
            "params": {},
            "state": {},
            "delay": False,
            "enabled": True,
            "route": "orthogonal",
            "waypoints": [],
            "anchors": {},
            "layout": {},
            "source_pin": pin,
            "target_pin": "",
        })
    return {"mode": "circuit", "integration": "trapezoidal",
            "nodes": nodes, "edges": edges}

TEMPLATES: dict[str, dict[str, Any]] = {
    "signal_chain": {
        "label": "信号链（原始示例）",
        "mode": "signal",
        "description": "两路手动输入，经增益连接求和、放大。",
        "builder": signal_chain,
    },
    "control_loop": {
        "label": "状态空间闭环",
        "mode": "signal",
        "description": "二阶状态空间对象 + 比例控制 + 单步延迟反馈。",
        "builder": control_loop,
    },
    "transfer_cascade": {
        "label": "传递函数级联",
        "mode": "signal",
        "description": "两级一阶低通串联，观察幅值与相位衰减。",
        "builder": transfer_cascade,
    },
    "rc_step": {
        "label": "RC 阶跃",
        "mode": "circuit",
        "description": "5 V 阶跃经 1 kΩ 给 1 µF 充电，τ = 1 ms。",
        "builder": rc_step,
    },
    "rlc_series": {
        "label": "RLC 串联",
        "mode": "circuit",
        "description": "R=10 Ω、L=10 mH、C=100 µF 的串联谐振。",
        "builder": rlc_series,
    },
    "diode_rectifier": {
        "label": "二极管整流",
        "mode": "circuit",
        "description": "半波整流 + 电容滤波，需要 Newton 迭代。",
        "builder": diode_rectifier,
    },
    "common_collector": {
        "label": "共集放大（射极跟随器，器件节点）",
        "mode": "circuit",
        "description": "VCC=12 V，R1/R2 分压、RE=1k；1 kHz 0.2 V 经 CIN 耦合，输出跟随输入。",
        "builder": common_collector,
    },
    "opamp_inverting": {
        "label": "运放反相放大（手工摆位）",
        "mode": "circuit",
        "description": "Rin/RF 反相放大，元件全部显式 layout。",
        "builder": opamp_inverting,
    },
    "opamp_internal": {
        "label": "运放内部（宏模型）",
        "mode": "circuit",
        "description": "差分输入→高增益级→RC 极点→输出缓冲；用于绘制/阅读内部电路。",
        "builder": opamp_internal,
    },
    "trip_unit": {
        "label": "脱扣器示意",
        "mode": "circuit",
        "description": "整流→RC→分压→比较器→D 触发器→LED；展示图纸规范（位号/参数/汇合点/正交/断线）。",
        "builder": trip_unit,
    },
    "controlled_source": {
        "label": "压控电压源",
        "mode": "circuit",
        "description": "用 VCVS 实现 ×3 放大器，观察控制端与输出。",
        "builder": controlled_source,
    },
    "nonlinear_control": {
        "label": "非线性滑模控制",
        "mode": "vector",
        "description": "Duffing 参考 + 非线性对象 + 滑模控制 + Van der Pol 扰动，含延迟反馈。",
        "builder": nonlinear_control,
    },
    "vector_network": {
        "label": "矢量耦合振子",
        "mode": "vector",
        "description": "三个非线性振子经延迟扩散边耦合，展示二维矢量与相位轨迹。",
        "builder": vector_network,
    },
    "blank_vector": {
        "label": "空白矢量场景",
        "mode": "vector",
        "description": "从零搭建二维矢量网络。",
        "builder": blank_vector,
    },
    "blank_signal": {
        "label": "空白信号场景",
        "mode": "signal",
        "description": "清空后从零搭建。",
        "builder": blank_signal,
    },
    "blank_circuit": {
        "label": "空白电路",
        "mode": "circuit",
        "description": "包含接地与分压器的最小电路。",
        "builder": blank_circuit,
    },
}


SIM_PRESETS: dict[str, dict[str, Any]] = {
    "signal_chain": {"fps": 30, "dt": 0.01, "steps_per_frame": 1},
    # 二阶对象 ω≈5 rad/s，放大步长后便于实时观察闭环收敛
    "control_loop": {"fps": 60, "dt": 0.002, "steps_per_frame": 4},
    # 5 Hz 正弦经过 20 ms / 10 ms 两个低通
    "transfer_cascade": {"fps": 60, "dt": 0.001, "steps_per_frame": 4},
    # τ = 1 ms，每帧推进 40 µs
    "rc_step": {"fps": 60, "dt": 1.0e-5, "steps_per_frame": 4},
    "rlc_series": {"fps": 60, "dt": 2.0e-5, "steps_per_frame": 8},
    "diode_rectifier": {"fps": 60, "dt": 2.0e-5, "steps_per_frame": 8},
    "controlled_source": {"fps": 60, "dt": 1.0e-5, "steps_per_frame": 10},
    "nonlinear_control": {"fps": 60, "dt": 0.001, "steps_per_frame": 8},
    "vector_network": {"fps": 60, "dt": 0.002, "steps_per_frame": 4},
    "blank_vector": {"fps": 60, "dt": 0.002, "steps_per_frame": 2},
    "blank_signal": {"fps": 30, "dt": 0.005, "steps_per_frame": 1},
    "common_collector": {"fps": 60, "dt": 1.0e-5, "steps_per_frame": 10},
    "blank_circuit": {"fps": 60, "dt": 1.0e-4, "steps_per_frame": 2},
}



def template_catalog() -> list[dict[str, Any]]:
    return [
        {
            "name": name,
            "label": item["label"],
            "mode": item["mode"],
            "description": item["description"],
            "sim": dict(SIM_PRESETS.get(name, {})),
        }
        for name, item in TEMPLATES.items()
    ]


def build_template(name: str) -> dict[str, Any]:
    item = TEMPLATES.get(name)
    if item is None:
        raise KeyError(name)
    builder: TemplateBuilder = item["builder"]
    payload = builder()
    payload["sim"] = dict(SIM_PRESETS.get(name, {}))
    return payload
