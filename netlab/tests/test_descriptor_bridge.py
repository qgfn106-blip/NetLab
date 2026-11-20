"""跨域桥 sensor/actuator 在 Descriptor 小信号模型中的兼容性回归。"""

from __future__ import annotations

from netlab.core.compute.circuit.descriptor import DescriptorModel
from netlab.core.model.scene import Scene


def _bridge_scene(
    sensor_element: str = "sensor",
    actuator_element: str = "actuator",
    actuator_gain: float = 1.0,
) -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    out = scene.add_node(name="out", kind="node")
    act_out = scene.add_node(name="act_out", kind="node")
    scene.add_edge(
        name="V1",
        source=vin.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 10.0, "amplitude": 0.0},
    )
    scene.add_edge(
        name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0}
    )
    scene.add_edge(
        name="R2", source=out.id, target=gnd.id, kind="resistor", params={"R": 1000.0}
    )
    scene.add_edge(
        name="R3",
        source=act_out.id,
        target=gnd.id,
        kind="resistor",
        params={"R": 1000.0},
    )

    sensor = scene.add_node(
        name="sensor",
        kind="device",
        params={"element": sensor_element, "signal": "voltage"},
    )
    scene.add_edge(
        name="sensor_in", source=sensor.id, target=out.id, kind="wire", source_pin="IN"
    )
    scene.add_edge(
        name="sensor_gnd",
        source=sensor.id,
        target=gnd.id,
        kind="wire",
        source_pin="GND",
    )

    actuator = scene.add_node(
        name="actuator",
        kind="device",
        params={
            "element": actuator_element,
            "source": "sensor.voltage",
            "gain": actuator_gain,
            "offset": 0.0,
        },
    )
    scene.add_edge(
        name="act_out",
        source=actuator.id,
        target=act_out.id,
        kind="wire",
        source_pin="OUT",
    )
    scene.add_edge(
        name="act_gnd", source=actuator.id, target=gnd.id, kind="wire", source_pin="GND"
    )
    return scene


def test_descriptor_accepts_signal_interface_bridge_elements() -> None:
    # 与现场报错一致的接口元件名：if_voltage_to_signal / if_signal_to_current。
    scene = _bridge_scene("if_voltage_to_signal", "if_signal_to_current")
    op = scene.ensure_engine().solver.operating_point()
    model = DescriptorModel.from_scene(scene, operating_point=op)
    assert "sensor" not in model.index.vsource_index
    data = model.frequency_response([10.0, 1000.0], input_source="V1", probes=["out"])
    magnitudes = data["probes"]["out"]["magnitude"]
    assert len(magnitudes) == 2
    assert all(abs(value) > 0.0 for value in magnitudes)


def test_descriptor_accepts_sensor_and_actuator() -> None:
    scene = _bridge_scene()
    op = scene.ensure_engine().solver.operating_point()
    model = DescriptorModel.from_scene(scene, operating_point=op)
    # 传感器按高阻开路处理，不引入支路未知量；受控电压源获得独立支路。
    assert "sensor" not in model.index.vsource_index
    assert "actuator" in model.index.vsource_index
    data = model.frequency_response([10.0, 1000.0], input_source="V1", probes=["out"])
    magnitudes = data["probes"]["out"]["magnitude"]
    assert len(magnitudes) == 2
    assert all(abs(value) > 0.0 for value in magnitudes)


def test_descriptor_bridge_voltage_actuator_transfer_matches_network() -> None:
    scene = _bridge_scene()
    op = scene.ensure_engine().solver.operating_point()
    model = DescriptorModel.from_scene(scene, operating_point=op)
    data = model.frequency_response(
        [10.0, 1000.0], input_source="V1", probes=["act_out"]
    )
    magnitudes = data["probes"]["act_out"]["magnitude"]
    # sensor 取 R1/R2 分压 0.5，actuator 单位增益理想 VCVS 应把该电压送到 act_out。
    assert all(abs(value - 0.5) < 1.0e-6 for value in magnitudes)


def test_descriptor_bridge_current_actuator_transfer_matches_network() -> None:
    scene = _bridge_scene("if_voltage_to_signal", "if_signal_to_current", 1.0e-3)
    op = scene.ensure_engine().solver.operating_point()
    model = DescriptorModel.from_scene(scene, operating_point=op)
    data = model.frequency_response(
        [10.0, 1000.0], input_source="V1", probes=["act_out"]
    )
    magnitudes = data["probes"]["act_out"]["magnitude"]
    # 1 mA/V 电流受控源在 1 kΩ 负载上得到 0.5 V。
    assert all(abs(value - 0.5) < 1.0e-6 for value in magnitudes)
