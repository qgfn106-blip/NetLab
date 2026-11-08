"""Netlab 回归测试：信号流、延迟、数值内核、电路 MNA、场景与 HTTP API。"""

from __future__ import annotations

import copy
import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

from netlab.core.compute.computes import COMPUTE_SPECS, prepare_compute
from netlab.core.compute.fem import FemConfig, FemModel
from netlab.core.model.graph import ComputeContext, Network, Node
from netlab.core.common.limits import ComputeError, ValidationError  # noqa: F401
from netlab.core.compute.linalg import cont2discrete, expm, tustin_tf
from netlab.core.compute.methods import METHOD_SPECS
from netlab.core.compute.nodal import ELEMENT_SPECS
from netlab.core.model.scene import Scene
from netlab.server import app
from netlab.core.compute.simulation import Simulation
from netlab.core.model.templates import build_template


# ---------------------------------------------------------------------------
# 基础设施
# ---------------------------------------------------------------------------
def template_scene(name: str) -> Scene:
    payload = build_template(name)
    scene = Scene(payload.get("mode", "signal"))
    scene.load_payload(payload)
    return scene


def node_voltage(scene: Scene, name: str) -> float:
    node = next(item for item in scene.nodes.values() if item.name == name)
    return float(node.data.get("voltage", 0.0))


def edge_state(scene: Scene, name: str) -> dict:
    return next(item for item in scene.edges.values() if item.name == name).state


@pytest.fixture()
def client():
    """每个测试使用独立进程内服务，并回到原始信号链场景。"""
    with TestClient(app) as test_client:
        test_client.post("/api/control", json={"action": "pause"})
        test_client.post("/api/scene", json=build_template("signal_chain"))
        yield test_client


# ---------------------------------------------------------------------------
# 信号流：兼容原始 Node / Connection API
# ---------------------------------------------------------------------------
def test_original_chain_api_and_numbers():
    network = Network()

    def sum_compute(inputs, _data):
        return {
            "voltage": sum(float(payload["voltage"]) for payload in inputs.values())
        }

    def gain_compute(inputs, _data):
        return {
            "voltage": 3.0
            * sum(float(payload["voltage"]) for payload in inputs.values())
        }

    signal = Node("signal", {"voltage": 4.0})
    bias = Node("bias", {"voltage": 2.0})
    mixed = Node("mixed", {}, compute=sum_compute)
    output = Node("output", {}, compute=gain_compute)
    for node in (signal, bias, mixed, output):
        network.add_node(node)

    def scale(source, target, params, state, dt):
        del target, state, dt
        return {"voltage": source.data["voltage"] * params["gain"]}

    network.connect("signal_path", signal, mixed, scale, params={"gain": 2.0})
    network.connect("bias_path", bias, mixed, scale, params={"gain": 0.5})
    network.connect("amplifier", mixed, output, scale, params={"gain": 1.0})

    network.step(0.01)
    assert mixed.data["voltage"] == pytest.approx(9.0)
    assert output.data["voltage"] == pytest.approx(27.0)
    assert network.time == pytest.approx(0.01)


def test_node_and_connection_inputs_are_isolated():
    network = Network()
    source = Node("source", {"voltage": 5.0, "meta": {"tag": "x"}})
    seen = {}

    def guarded_compute(inputs, data):
        seen["input"] = copy.deepcopy(inputs)
        seen["data"] = copy.deepcopy(data)
        try:
            inputs["in"]["voltage"] = 999.0
        except Exception as exc:  # inputs 是深拷贝，允许修改副本
            seen["input_error"] = type(exc).__name__
        data["voltage"] = 999.0
        return {"result": 1.0}

    target = Node("target", {}, compute=guarded_compute)
    network.add_node(source)
    network.add_node(target)

    def guarded_method(source_view, target_view, params, state, dt):
        del target_view, dt
        with pytest.raises(TypeError):
            source_view.data["voltage"] = 0.0
        with pytest.raises(TypeError):
            params["gain"] = 3.0
        state["calls"] = int(state.get("calls", 0)) + 1
        return {"voltage": source_view.data["voltage"] * params["gain"]}

    network.connect("link", source, target, guarded_method, params={"gain": 2.0})
    network.step(0.1)

    assert source.data["voltage"] == pytest.approx(5.0)
    assert source.data["meta"]["tag"] == "x"
    assert target.data["result"] == pytest.approx(1.0)
    assert "voltage" not in target.data
    assert seen["input"]["link"]["voltage"] == pytest.approx(10.0)
    assert target.inputs["link"]["voltage"] == pytest.approx(10.0)

    network.step(0.1)
    assert network.connection("link").state["calls"] == 2
    assert target.inputs["link"]["voltage"] == pytest.approx(10.0)


def test_invalid_node_result_is_rejected():
    network = Network()

    def bad_compute(_inputs, _data):
        return {"voltage": float("nan")}

    network.add_node(Node("a", {}, compute=bad_compute))
    with pytest.raises((ComputeError, ValidationError), match="非有限|数值|NaN"):
        network.step(0.1)


def test_delay_connection_is_strict_z_minus_one():
    network = Network()
    source = Node("source", {"voltage": 1.0})

    def increment(_inputs, data):
        value = float(data.get("voltage", 0.0)) + 1.0
        return {"voltage": value}

    source.compute = increment
    target = Node("target", {})
    network.add_node(source)
    network.add_node(target)

    def passthrough(source_view, target_view, params, state, dt):
        del target_view, params, dt
        prior = float(state.get("value", 0.0))
        value = float(source_view.data.get("voltage", prior))
        state["value"] = value
        return {"voltage": value}

    network.connect("later", source, target, passthrough, delay=True)
    for expected in (1.0, 2.0, 3.0):
        network.step(1.0)
        assert target.inputs["later"]["voltage"] == pytest.approx(expected)
        assert source.data["voltage"] == pytest.approx(expected + 1.0)


def test_algebraic_cycle_is_detected():
    network = Network()
    a = Node("a", {})
    b = Node("b", {})
    network.add_node(a)
    network.add_node(b)

    def passthrough(source, target, params, state, dt):
        del target, params, state, dt
        return {"voltage": source.data.get("voltage", 0.0)}

    network.connect("a_to_b", a, b, passthrough)
    network.connect("b_to_a", b, a, passthrough)
    with pytest.raises(ComputeError, match="代数环"):
        network.step(0.1)


def test_scene_auto_delay_breaks_cycle():
    scene = Scene("signal")
    a = scene.add_node(
        name="a", kind="sum", data={"voltage": 1.0}, position={"x": 0, "y": 0}
    )
    b = scene.add_node(
        name="b", kind="sum", data={"voltage": 0.0}, position={"x": 100, "y": 0}
    )
    first = scene.add_edge(source=a.id, target=b.id, kind="scale")
    second = scene.add_edge(
        source=b.id, target=a.id, kind="scale", auto_delay=True
    )
    assert first.delay is False
    assert second.delay is True
    scene.step(0.01)
    scene.step(0.01)


# ---------------------------------------------------------------------------
# 数值内核
# ---------------------------------------------------------------------------
def test_expm_matches_scipy():
    scipy_linalg = pytest.importorskip("scipy.linalg")
    rng = np.random.default_rng(42)
    matrix = rng.normal(size=(4, 4)) * 1.7
    assert np.allclose(expm(matrix), scipy_linalg.expm(matrix), rtol=1e-10, atol=1e-11)


def test_zoh_discretization_matches_scipy():
    scipy_signal = pytest.importorskip("scipy.signal")
    a = np.array([[0.0, 1.0], [-4.0, -0.8]])
    b = np.array([[0.0], [1.0]])
    c = np.array([[1.0, 0.0]])
    d = np.array([[0.0]])
    dt = 0.003
    ad, bd, cd, dd = cont2discrete(a, b, c, d, dt, "zoh")
    ref_ad, ref_bd, ref_cd, ref_dd, _ = scipy_signal.cont2discrete(
        (a, b, c, d), dt, method="zoh"
    )
    assert np.allclose(ad, ref_ad, rtol=1e-11, atol=1e-12)
    assert np.allclose(bd, ref_bd, rtol=1e-11, atol=1e-12)
    assert np.allclose(cd, ref_cd)
    assert np.allclose(dd, ref_dd)


def test_tustin_first_order_step_response():
    dt = 0.001
    b, a = tustin_tf([1.0], [1.0, 1.0], dt)
    order = len(a) - 1
    state = [0.0] * order
    value = 0.0
    for _ in range(1000):
        value = b[0] * 1.0 + (state[0] if order else 0.0)
        for index in range(order):
            nxt = state[index + 1] if index + 1 < order else 0.0
            state[index] = b[index + 1] * 1.0 + nxt - a[index + 1] * value
    assert value == pytest.approx(1.0 - math.exp(-1.0), abs=5e-4)


def test_tustin_preserves_tau_and_gain():
    b, a = tustin_tf([1.0], [0.02, 1.0], 0.001)
    assert np.allclose(b, [0.0243902439, 0.0243902439])
    assert np.allclose(a, [1.0, -0.9512195122])


def test_transfer_cascade_reaches_expected_amplitude():
    scene = template_scene("transfer_cascade")
    peak1 = 0.0
    peak2 = 0.0
    for index in range(2500):
        scene.step(0.001)
        if index > 1500:
            peak1 = max(peak1, node_voltage(scene, "stage1"))
            peak2 = max(peak2, node_voltage(scene, "stage2"))
    # 5 Hz 正弦经过 τ=20 ms / 10 ms 两级低通：
    # 单级幅度 0.847，两级串联 0.847 × 0.954 ≈ 0.808。
    assert 0.78 < peak1 < 0.90
    assert 0.74 < peak2 < 0.86


def test_discrete_transfer_function_uses_descending_coefficients():
    scene = Scene("signal")
    source = scene.add_node(name="src", kind="manual", data={"value": 1.0})
    target = scene.add_node(
        name="out",
        kind="sum",
        params={"field": "voltage", "output": "voltage", "weights": {}},
    )
    scene.add_edge(
        source=source.id,
        target=target.id,
        kind="tf",
        name="discrete_link",
        params={
            "domain": "discrete",
            "numerator": [2.0, 1.0],
            "denominator": [1.0, -0.5],
            "discretization": "tustin",
            "input_key": "value",
            "output_key": "voltage",
        },
    )
    outputs = []
    for _ in range(4):
        scene.step(1.0)
        outputs.append(float(scene.nodes[target.id].data["voltage"]))
    assert outputs[0] == pytest.approx(2.0)
    assert outputs[1] == pytest.approx(4.0)
    assert outputs[2] == pytest.approx(5.0)
    assert outputs[3] == pytest.approx(5.5)


def test_state_space_node_integrates():
    scene = Scene("signal")
    source = scene.add_node(name="src", kind="manual", data={"voltage": 1.0})
    node = scene.add_node(
        name="ss",
        kind="state_space",
        params={
            "A": [[-1.0]],
            "B": [[1.0]],
            "C": [[1.0]],
            "D": [[0.0]],
            "method": "zoh",
            "input_map": ["link.voltage"],
            "output_map": ["y0"],
            "x0": [0.0],
        },
    )
    scene.add_edge(
        source=source.id,
        target=node.id,
        kind="scale",
        params={"gain": 1.0},
        name="link",
    )
    for _ in range(20):
        scene.step(0.1)
    value = float(scene.nodes[node.id].data["y0"])
    assert value == pytest.approx(1.0 - math.exp(-2.0), abs=2e-2)
    assert 0.0 < value < 1.0


# ---------------------------------------------------------------------------
# 电路层（MNA）
# ---------------------------------------------------------------------------
def test_rc_step_matches_analytic_solution():
    scene = template_scene("rc_step")
    for _ in range(400):  # 400 × 10 µs = 4 ms = 4 τ
        scene.step(1.0e-5)
    value = node_voltage(scene, "mid")
    analytic = 5.0 * (1.0 - math.exp(-4.0))
    assert value == pytest.approx(analytic, abs=0.01)
    assert value == pytest.approx(4.9075, abs=0.01)


def test_rlc_series_stays_finite_and_resonates():
    scene = template_scene("rlc_series")
    for _ in range(1000):  # 20 ms, 一个 50 Hz 周期
        scene.step(2.0e-5)
    values = [node_voltage(scene, name) for name in ("src", "mid", "out")]
    assert all(math.isfinite(item) for item in values)
    # 50 Hz、1 V 源经 R=10 Ω，L/C 分压：输出应有可观测幅度但不发散。
    assert 0.01 < abs(values[2]) < 5.0
    current = (
        edge_state(scene, "L1")["current"]
        if "current" in edge_state(scene, "L1")
        else None
    )
    if current is not None:
        assert math.isfinite(current)


def test_diode_rectifier_produces_positive_filtered_output():
    scene = template_scene("diode_rectifier")
    peak = 0.0
    for _ in range(1000):  # 20 ms
        scene.step(2.0e-5)
        peak = max(peak, node_voltage(scene, "out"))
    value = node_voltage(scene, "out")
    assert math.isfinite(value)
    assert 0.0 <= value < 5.1
    assert peak > 0.1


def test_vcvs_gain_is_exact():
    scene = template_scene("controlled_source")
    for _ in range(100):
        scene.step(1.0e-5)
    source = node_voltage(scene, "src")
    output = node_voltage(scene, "out")
    assert output == pytest.approx(3.0 * source, rel=1e-7, abs=1e-6)


def test_multiple_grounds_load_and_merge():
    """R21/D44：多接地合法，自动合并为同一 0V 参考。"""
    payload = build_template("rc_step")
    payload["nodes"].append(
        {
            "id": "c99999999999",
            "name": "g2",
            "kind": "ground",
            "position": {"x": 0, "y": 0},
        }
    )
    scene = Scene("circuit")
    scene.load_payload(payload)
    grounds = [item for item in scene.nodes.values() if item.kind == "ground"]
    assert len(grounds) == 2
    for _ in range(5):
        scene.step(1e-4)
    assert scene.ensure_engine().solver is not None


def test_isolated_net_is_ignored():
    """R21/D43：没有任何元件引脚的孤立网络被忽略，不再报“悬空”挡住运行。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    src = scene.add_node(name="n1", kind="node")
    scene.add_node(name="float", kind="node")
    scene.add_edge(
        name="VS",
        source=src.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 5.0, "amplitude": 0.0},
    )
    scene.add_edge(
        name="RL", source=src.id, target=gnd.id, kind="resistor", params={"R": 1000.0}
    )
    scene.step(1e-4)
    float_node = next(item for item in scene.nodes.values() if item.name == "float")
    assert abs(float(float_node.data.get("voltage", 0.0))) < 1e-9


# ---------------------------------------------------------------------------
# 场景、仿真与导入导出
# ---------------------------------------------------------------------------
def test_signal_chain_template_values():
    scene = template_scene("signal_chain")
    scene.step(0.01)
    assert node_voltage(scene, "mixed") == pytest.approx(9.0)
    assert node_voltage(scene, "output") == pytest.approx(27.0)
    probes = scene.probes()
    assert probes["n:mixed:voltage"] == pytest.approx(9.0)


def test_scene_export_import_roundtrip():
    scene = template_scene("rlc_series")
    payload = scene.to_payload()
    rebuilt = Scene("circuit")
    rebuilt.load_payload(payload)
    assert len(rebuilt.nodes) == len(scene.nodes)
    assert len(rebuilt.edges) == len(scene.edges)
    assert rebuilt.mode == "circuit"
    assert rebuilt.integration == scene.integration


def test_simulation_records_frames_and_resets():
    simulation = Simulation(template_scene("signal_chain"))
    try:
        simulation.apply_config({"fps": 100, "dt": 0.001, "steps_per_frame": 2})
        simulation.step_once(2)
        assert simulation.steps == 2
        assert simulation.time == pytest.approx(0.002)
        live = simulation.live(0)
        assert len(live["frames"]) == 2
        assert "n:mixed:voltage" in live["frames"][-1]["v"]
        assert live["cursor"] == 2
        simulation.reset()
        assert simulation.steps == 0
        assert simulation.live(0)["frames"] == []
    finally:
        simulation.shutdown()


def test_simulation_lock_dt_and_validation():
    simulation = Simulation(Scene("signal"))
    try:
        config = simulation.apply_config(
            {"fps": 50, "steps_per_frame": 2, "lock_dt": True}
        )
        assert config["dt"] == pytest.approx(1.0 / 100.0)
        with pytest.raises(ValidationError):
            simulation.apply_config({"fps": 0})
        with pytest.raises(ValidationError):
            simulation.apply_config({"dt": 20.0, "steps_per_frame": 2})
    finally:
        simulation.shutdown()


# ---------------------------------------------------------------------------
# 矢量 / 非线性网络
# ---------------------------------------------------------------------------
def test_sliding_mode_saturates_and_keeps_sign():
    _spec, params, handler = prepare_compute(
        "sliding_mode",
        {
            "lambda": 2.0,
            "gain": 100.0,
            "eta": 0.0,
            "phi": 0.1,
            "limit": 5.0,
            "feedforward": 0.0,
        },
    )
    context = ComputeContext(
        name="ctl",
        inputs={"a": {"ref": 1.0, "dref": 0.0}, "b": {"x": 0.0, "dx": 0.0}},
        data={},
        state={},
        params=params,
        dt=0.001,
        time=0.0,
    )
    result = handler(context)
    assert result["error"] == pytest.approx(1.0)
    assert result["u"] == pytest.approx(5.0)
    assert result["s"] > 0


def test_nonlinear_oscillator_is_bounded():
    scene = Scene("vector")
    node = scene.add_node(
        name="osc",
        kind="oscillator",
        params={
            "system": "duffing",
            "damping": 0.12,
            "stiffness": 1.0,
            "nonlinearity": 0.5,
            "forcing_amplitude": 0.6,
            "forcing_frequency": 0.2,
            "initial_x": 1.0,
            "initial_y": 0.0,
        },
    )
    for _ in range(1000):
        scene.step(0.001)
    data = scene.nodes[node.id].data
    for field in ("x", "y", "z", "vx", "vy", "vz"):
        assert math.isfinite(float(data[field]))
    assert abs(data["x"]) < 10.0
    assert abs(data["y"]) < 20.0


def test_nonlinear_control_template_runs_and_saturates():
    scene = template_scene("nonlinear_control")
    assert scene.mode == "vector"
    for _ in range(900):
        scene.step(0.001)
    for node in scene.nodes.values():
        for value in node.data.values():
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                assert math.isfinite(float(value)), (node.name, value)
    controller = next(node for node in scene.nodes.values() if node.name == "ctl")
    reference = next(node for node in scene.nodes.values() if node.name == "ref")
    assert abs(float(controller.data["u"])) <= 12.0 + 1e-9
    assert abs(float(reference.data["x"])) < 10.0
    probes = scene.probes()
    assert "n:ref:x" in probes
    assert "n:ctl:u" in probes


def test_vector_network_couples_three_oscillators():
    scene = template_scene("vector_network")
    for _ in range(600):
        scene.step(0.002)
    oscillators = [node for node in scene.nodes.values() if node.kind == "oscillator"]
    assert len(oscillators) == 3
    for node in oscillators:
        assert math.isfinite(float(node.data["x"]))
        assert math.isfinite(float(node.data["y"]))
    positions = [(float(node.data["x"]), float(node.data["y"])) for node in oscillators]
    assert len(set(positions)) == 3
    rot = next(node for node in scene.nodes.values() if node.name == "rot")
    assert float(rot.data["magnitude"]) > 0.0


# ---------------------------------------------------------------------------
# 二维有限元
# ---------------------------------------------------------------------------
def test_fem_linear_dirichlet_profile():
    config = FemConfig(
        nx=10,
        ny=6,
        dt=0.005,
        source_amplitude=0.0,
        boundary_left=0.0,
        boundary_right=100.0,
        initial_temperature=50.0,
    )
    model = FemModel(config)
    for _ in range(1200):
        model.step(config.dt)
    row = (config.ny // 2) * (config.nx + 1)
    for i in range(config.nx + 1):
        expected = 100.0 * i / config.nx
        assert model.temperature[row + i] == pytest.approx(expected, abs=1e-6)


def test_fem_source_heats_interior_and_keeps_boundaries():
    config = FemConfig(nx=16, ny=10, dt=0.002, source_amplitude=5000.0)
    model = FemModel(config)
    for _ in range(80):
        model.step(config.dt)
    assert float(model.temperature.max()) > config.initial_temperature + 0.1
    assert float(model.temperature[model.mesh.left].max()) == pytest.approx(20.0)
    assert float(model.temperature[model.mesh.right].min()) == pytest.approx(20.0)
    assert model.stats()["elements"] == 160


def test_fem_requires_scipy_available():
    # 当前测试环境已安装 SciPy；若没有，FemModel 会给出明确的 ComputeError。
    try:
        FemModel(FemConfig(nx=6, ny=6))
    except ComputeError as exc:
        assert "SciPy" in str(exc)


# ---------------------------------------------------------------------------
# HTTP API
# ---------------------------------------------------------------------------
def test_catalog_and_health(client):
    response = client.get("/api/catalog")
    assert response.status_code == 200
    payload = response.json()
    catalog = payload["catalog"]
    # 数量与注册表保持一致即可：新增 kind 不应该让测试变成数字填空。
    assert {item["kind"] for item in catalog["computes"]} == set(COMPUTE_SPECS)
    assert {item["kind"] for item in catalog["methods"]} == set(METHOD_SPECS)
    assert {item["kind"] for item in catalog["elements"]} == set(ELEMENT_SPECS)
    # 关键能力必须仍然存在（防止被误删）。
    assert {"sum", "signal", "block", "module_input", "module_output"} <= set(
        COMPUTE_SPECS
    )
    assert {"scale", "tf", "pass"} <= set(METHOD_SPECS)
    assert len(payload["templates"]) >= 16
    assert {"signal", "circuit", "vector"} == {
        item["value"] for item in payload["catalog"]["modes"]
    }
    assert client.get("/api/health").json()["ok"] is True


def test_control_step_and_live(client):
    response = client.post("/api/control", json={"action": "step", "steps": 3})
    assert response.status_code == 200
    assert response.json()["sim"]["steps"] == 3
    live = client.get("/api/live", params={"cursor": 0, "limit": 50}).json()
    assert len(live["frames"]) == 3
    assert "n:mixed:voltage" in live["frames"][-1]["v"]
    state = client.get("/api/state").json()
    mixed = next(node for node in state["scene"]["nodes"] if node["name"] == "mixed")
    assert mixed["data"]["voltage"] == pytest.approx(9.0)


def test_node_crud_and_positions(client):
    created = client.post(
        "/api/nodes",
        json={
            "name": "extra",
            "kind": "gain",
            "params": {"gain": 2.0},
            "data": {"voltage": 1.0},
            "position": {"x": 12.0, "y": -8.0},
        },
    )
    assert created.status_code == 200
    body = created.json()
    node_id = body["node"]["id"]
    assert len(body["scene"]["nodes"]) == 5
    assert body["node"]["params"]["field"] == "value"

    patched = client.patch(
        f"/api/nodes/{node_id}",
        json={
            "name": "extra2",
            "params": {
                "field": "voltage",
                "output": "voltage",
                "gain": 5.0,
                "offset": 1.0,
            },
        },
    )
    assert patched.status_code == 200
    assert patched.json()["node"]["name"] == "extra2"
    assert patched.json()["node"]["params"]["gain"] == pytest.approx(5.0)

    moved = client.post(
        "/api/positions",
        json={"positions": [{"id": node_id, "position": {"x": 100.0, "y": 120.0}}]},
    )
    assert moved.status_code == 200
    state = client.get("/api/state").json()
    moved_node = next(item for item in state["scene"]["nodes"] if item["id"] == node_id)
    assert moved_node["position"]["x"] == pytest.approx(100.0)

    deleted = client.delete(f"/api/nodes/{node_id}")
    assert deleted.status_code == 200
    assert len(deleted.json()["scene"]["nodes"]) == 4


def test_invalid_node_params_are_rejected(client):
    response = client.post(
        "/api/nodes",
        json={"name": "broken", "kind": "gain", "params": {"not_a_param": 1.0}},
    )
    assert response.status_code == 422
    assert "未知参数" in response.json()["detail"]


def test_manual_module_node_is_rejected_with_fix_hint(client):
    """P0-0：功能块实例不能手动添加，API 必须挡住并给可操作提示。"""
    before = len(client.get("/api/state").json()["scene"]["nodes"])
    response = client.post(
        "/api/nodes",
        json={
            "name": "block1",
            "kind": "block",
            "params": {},
            "position": {"x": 0.0, "y": 0.0},
        },
    )
    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert "缺少 block_id" in detail
    assert "重新实例化" in detail
    assert len(client.get("/api/state").json()["scene"]["nodes"]) == before


def test_edge_crud_and_auto_delay(client):
    blank = build_template("blank_signal")
    client.post("/api/scene", json=blank)
    first = client.post("/api/nodes", json={"name": "a", "kind": "sum"}).json()["node"][
        "id"
    ]
    second = client.post("/api/nodes", json={"name": "b", "kind": "sum"}).json()[
        "node"
    ]["id"]
    forward = client.post(
        "/api/edges",
        json={
            "source": first,
            "target": second,
            "kind": "scale",
            "params": {"gain": 1.0},
        },
    )
    assert forward.status_code == 200
    backward = client.post(
        "/api/edges",
        json={
            "source": second,
            "target": first,
            "kind": "scale",
            "params": {"gain": 1.0},
            "auto_delay": True,
        },
    )
    assert backward.status_code == 200
    edge = backward.json()["edge"]
    assert edge["delay"] is True
    assert backward.json()["notice"]

    patched = client.patch(f"/api/edges/{edge['id']}", json={"delay": False})
    assert patched.status_code == 409
    deleted = client.delete(f"/api/edges/{edge['id']}")
    assert deleted.status_code == 200


def test_circuit_multiple_grounds_allowed(client):
    """R21/D44：API 也允许第二个接地，并自动合并。"""
    client.post("/api/scene", json=build_template("blank_circuit"))
    response = client.post("/api/nodes", json={"name": "g2", "kind": "ground"})
    assert response.status_code == 200, response.text
    grounds = [
        node for node in response.json()["scene"]["nodes"] if node["kind"] == "ground"
    ]
    assert len(grounds) == 2  # 模板自带 gnd + 新增 g2


def test_mode_switch_and_templates(client):
    response = client.post("/api/mode", json={"mode": "circuit"})
    assert response.status_code == 200
    body = response.json()
    assert body["scene"]["mode"] == "circuit"
    assert body["sim"]["config"]["dt"] > 0
    template = client.post("/api/templates/rc_step")
    assert template.status_code == 200
    state = template.json()
    assert len(state["scene"]["nodes"]) == 3
    assert state["scene"]["integration"] == "trapezoidal"

    patched = client.patch("/api/scene", json={"integration": "backward_euler"})
    assert patched.status_code == 200
    assert patched.json()["scene"]["integration"] == "backward_euler"


def test_config_validation_and_live_cursor(client):
    response = client.patch(
        "/api/config", json={"fps": 60, "dt": 0.0001, "steps_per_frame": 4}
    )
    assert response.status_code == 200
    assert response.json()["config"]["fps"] == 60
    bad = client.patch("/api/config", json={"fps": 999})
    assert bad.status_code == 422
    assert client.get("/api/live", params={"cursor": 999999}).json()["frames"] == []


def test_scene_export_import_api(client):
    exported = client.get("/api/scene/export").json()
    assert exported["mode"] == "signal"
    assert len(exported["nodes"]) == 4
    assert "state" not in exported["nodes"][0]
    client.post("/api/scene/clear")
    empty = client.get("/api/state").json()
    assert len(empty["scene"]["nodes"]) == 0
    reimported = client.post("/api/scene", json=exported)
    assert reimported.status_code == 200
    assert len(reimported.json()["scene"]["nodes"]) == 4


def test_import_two_grounds_is_allowed(client):
    """R21/D44：导入含两个接地的场景不再 422，引擎自动合并。"""
    payload = build_template("rc_step")
    payload["nodes"].append(
        {
            "id": "c99999999999",
            "name": "g2",
            "kind": "ground",
            "position": {"x": 0, "y": 0},
        }
    )
    response = client.post("/api/scene", json=payload)
    assert response.status_code == 200, response.text
    grounds = [
        node for node in response.json()["scene"]["nodes"] if node["kind"] == "ground"
    ]
    assert len(grounds) == 2


def test_vector_mode_and_nonlinear_template_api(client):
    response = client.post("/api/mode", json={"mode": "vector"})
    assert response.status_code == 200
    body = response.json()
    assert body["scene"]["mode"] == "vector"
    assert len(body["scene"]["nodes"]) == 0
    template = client.post("/api/templates/nonlinear_control")
    assert template.status_code == 200
    state = template.json()
    assert state["scene"]["mode"] == "vector"
    assert len(state["scene"]["nodes"]) == 5
    assert len(state["scene"]["edges"]) == 8
    stepped = client.post("/api/control", json={"action": "step", "steps": 30})
    assert stepped.status_code == 200
    assert stepped.json()["sim"]["error"] is None
    live = client.get("/api/live", params={"cursor": 0, "limit": 5}).json()
    assert any(key.startswith("n:ref:x") for key in live["frames"][-1]["v"])


def test_shutdown_requires_confirmation_and_local_host(client):
    missing = client.post("/api/shutdown", json={})
    assert missing.status_code == 422
    assert "confirm" in missing.json()["detail"]
    refused = client.post("/api/shutdown", json={"confirm": False})
    assert refused.status_code == 422
    # TestClient 的客户端地址不是本机回环地址，因此不会真的退出进程。
    remote = client.post("/api/shutdown", json={"confirm": True})
    assert remote.status_code == 422
    assert "本机" in remote.json()["detail"]


def test_fem_api_state_config_and_live(client):
    reset = client.post("/api/fem/control", json={"action": "reset"})
    assert reset.status_code == 200
    configured = client.patch(
        "/api/fem/config",
        json={
            "nx": 12,
            "ny": 8,
            "dt": 0.002,
            "fps": 30,
            "steps_per_frame": 2,
            "source_amplitude": 1000.0,
        },
    )
    assert configured.status_code == 200
    snapshot = configured.json()["fem"]
    assert snapshot["mesh"]["nx"] == 12
    assert len(snapshot["mesh"]["x"]) == 13 * 9
    assert len(snapshot["field"]) == 13 * 9
    stepped = client.post("/api/fem/control", json={"action": "step", "steps": 3})
    assert stepped.status_code == 200
    live = client.get("/api/fem/live", params={"cursor": 0, "limit": 20}).json()
    assert live["frames"]
    assert len(live["frames"][-1]["field"]) == 13 * 9
    assert live["stats"]["dof"] == 13 * 9
    invalid = client.patch("/api/fem/config", json={"nx": 2})
    assert invalid.status_code == 422
    assert client.post("/api/fem/control", json={"action": "reset"}).status_code == 200
