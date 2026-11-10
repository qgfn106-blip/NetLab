"""M4.1 / M4.3：线性 Descriptor 极点与传输零点分析测试。"""

from __future__ import annotations

import math

import numpy as np
import pytest

from netlab.core.common.limits import ComputeError, ValidationError
from netlab.core.compute.circuit import DescriptorModel
from netlab.core.compute.circuit.descriptor_analysis import (
    UnsupportedAnalysisError,
    analyze_poles,
    analyze_zeros,
    build_output_matrices,
    check_pencil_regularity,
    descriptor_poles,
    descriptor_zeros,
    is_regular_pencil,
)
from netlab.core.model.scene import Scene


# ---------------------------------------------------------------------------
# 测试电路
# ---------------------------------------------------------------------------


def _rc_low_pass() -> Scene:
    """RC 低通：V1 -> R1 -> out，C1 从 out 到地。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(
        name="V1",
        source=vin.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 0.0, "amplitude": 1.0},
    )
    scene.add_edge(
        name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0}
    )
    scene.add_edge(
        name="C1", source=out.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6}
    )
    return scene


def _rc_high_pass() -> Scene:
    """RC 高通：V1 -> C1 -> out，R1 从 out 到地。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(
        name="V1",
        source=vin.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 0.0, "amplitude": 1.0},
    )
    scene.add_edge(
        name="C1", source=vin.id, target=out.id, kind="capacitor", params={"C": 1.0e-6}
    )
    scene.add_edge(
        name="R1", source=out.id, target=gnd.id, kind="resistor", params={"R": 1000.0}
    )
    return scene


def _series_rlc() -> Scene:
    """串联 RLC：V1 -> L1 -> mid -> R1 -> out，C1 从 out 到地。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    mid = scene.add_node(name="mid", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(
        name="V1",
        source=vin.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 0.0, "amplitude": 1.0},
    )
    scene.add_edge(
        name="L1", source=vin.id, target=mid.id, kind="inductor", params={"L": 1.0e-3}
    )
    scene.add_edge(
        name="R1", source=mid.id, target=out.id, kind="resistor", params={"R": 10.0}
    )
    scene.add_edge(
        name="C1", source=out.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6}
    )
    return scene


def _parallel_rc_without_source() -> Scene:
    """无独立源的并联 RC：R1 与 C1 均从 out 到地。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(
        name="R1", source=out.id, target=gnd.id, kind="resistor", params={"R": 1000.0}
    )
    scene.add_edge(
        name="C1", source=out.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6}
    )
    return scene


def _assert_complex_close(
    actual: np.ndarray, expected: np.ndarray, *, atol: float = 1e-9
) -> None:
    """比较复极点/零点，先按实部、虚部（四舍五入后）统一顺序。"""
    actual_array = np.asarray(actual)
    expected_array = np.asarray(expected)
    if actual_array.size:
        actual_order = np.lexsort(
            (np.round(actual_array.imag, 9), np.round(actual_array.real, 9))
        )
        actual_array = actual_array[actual_order]
    if expected_array.size:
        expected_order = np.lexsort(
            (np.round(expected_array.imag, 9), np.round(expected_array.real, 9))
        )
        expected_array = expected_array[expected_order]
    np.testing.assert_allclose(
        actual_array,
        expected_array,
        rtol=1e-9,
        atol=atol,
    )


# ---------------------------------------------------------------------------
# M4.1 极点
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("scene_builder", [_rc_low_pass, _rc_high_pass])
def test_rc_pole_matches_analytic(scene_builder) -> None:
    """RC 低通/高通的一阶极点均为 -1/RC = -1000 rad/s。"""
    model = DescriptorModel.from_scene(scene_builder())
    result = descriptor_poles(model)

    _assert_complex_close(result.finite_poles, np.array([-1.0 / (1000.0 * 1.0e-6)]))
    assert result.finite_count == 1
    assert result.infinite_count == model.index.size - 1
    assert result.max_residual < 1.0e-10


def test_series_rlc_poles_match_analytic() -> None:
    """串联 RLC 的欠阻尼共轭极点与解析式一致。"""
    R, L, C = 10.0, 1.0e-3, 1.0e-6
    alpha = -R / (2.0 * L)
    omega = math.sqrt(1.0 / (L * C) - alpha**2)
    expected = np.array([alpha + 1j * omega, alpha - 1j * omega])

    model = DescriptorModel.from_scene(_series_rlc())
    result = descriptor_poles(model)

    _assert_complex_close(result.finite_poles, expected)
    assert result.finite_count == 2
    assert result.infinite_count == model.index.size - 2
    assert result.max_residual < 1.0e-10


def test_poles_accept_descriptor_system_and_plain_matrix() -> None:
    """descriptor_poles 接受 DescriptorSystem；analyze_poles 对普通矩阵默认 E=I。"""
    model = DescriptorModel.from_scene(_rc_low_pass())
    from_system = descriptor_poles(model.build("V1"))
    from_model = descriptor_poles(model)
    _assert_complex_close(from_system.finite_poles, from_model.finite_poles)

    # E = I 时，极点方程 A v = -s v，因此极点为 -eig(A)。
    plain = analyze_poles(np.diag([1.0, 2.0]))
    _assert_complex_close(plain.finite_poles, np.array([-2.0, -1.0]))
    assert plain.infinite_count == 0
    assert plain.size == 2


def test_poles_without_input_source_still_work() -> None:
    """极点只需 A/E，不依赖独立源；无源 RC 的极点为 -1/RC。"""
    model = DescriptorModel.from_scene(_parallel_rc_without_source())
    result = descriptor_poles(model)

    _assert_complex_close(result.finite_poles, np.array([-1000.0]))
    assert result.infinite_count == 0
    assert result.max_residual < 1.0e-10

    # 但零点分析必须有输入源，build() 会明确报错。
    with pytest.raises(ComputeError):
        descriptor_zeros(model, output="out")


def test_analyze_poles_rejects_non_square_and_mismatched_shapes() -> None:
    """非方阵与形状不一致的铅笔必须显式报 ValidationError。"""
    with pytest.raises(ValidationError):
        analyze_poles(np.zeros((2, 3)))
    with pytest.raises(ValidationError):
        analyze_poles(np.eye(2), np.eye(3))
    with pytest.raises(ValidationError):
        analyze_poles(np.empty((0, 0)))


def test_singular_pencil_is_detected_and_rejected() -> None:
    """奇异铅笔 det(A+sE)≡0 必须被正则性检查识别，极点分析明确失败。"""
    A = np.array([[1.0, 0.0], [0.0, 0.0]])
    E = np.array([[0.0, 1.0], [0.0, 0.0]])

    assert is_regular_pencil(np.eye(2), np.eye(2)) is True
    assert check_pencil_regularity(A, E) is False
    with pytest.raises(ComputeError, match="奇异"):
        analyze_poles(A, E)


def test_all_zero_pencil_is_singular() -> None:
    """A=E=0 是最直接的奇异铅笔边界。"""
    assert is_regular_pencil(np.zeros((2, 2)), np.zeros((2, 2))) is False
    with pytest.raises(ComputeError):
        analyze_poles(np.zeros((2, 2)), np.zeros((2, 2)))


# ---------------------------------------------------------------------------
# M4.3 传输零点
# ---------------------------------------------------------------------------


def test_rc_low_pass_has_no_finite_zeros() -> None:
    """RC 低通 H(s)=1/(1+sRC) 的分子为常数，无有限零点。"""
    model = DescriptorModel.from_scene(_rc_low_pass())
    result = descriptor_zeros(model, input_source="V1", output="out")

    assert result.finite_count == 0
    assert result.infinite_count == model.index.size + 1
    assert result.siso is True
    assert result.max_residual == 0.0


def test_rc_high_pass_has_zero_at_origin() -> None:
    """RC 高通 H(s)=sRC/(1+sRC) 在原点有一个传输零点。"""
    model = DescriptorModel.from_scene(_rc_high_pass())
    result = descriptor_zeros(model, output="out")

    _assert_complex_close(result.finite_zeros, np.array([0.0 + 0.0j]), atol=1.0e-9)
    assert result.finite_count == 1
    assert result.infinite_count == model.index.size
    assert result.max_residual < 1.0e-10


def test_series_rlc_capacitor_voltage_has_no_finite_zeros() -> None:
    """串联 RLC 电容电压 H(s)=1/(LCs^2+RCs+1) 无有限零点。"""
    model = DescriptorModel.from_scene(_series_rlc())
    result = descriptor_zeros(model, output="out")

    assert result.finite_count == 0
    assert result.infinite_count == model.index.size + 1


def test_series_rlc_mid_voltage_zero_matches_analytic() -> None:
    """串联 RLC 的 mid 节点电压含零点 -1/(RC) = -100000 rad/s。"""
    R, C = 10.0, 1.0e-6
    model = DescriptorModel.from_scene(_series_rlc())
    result = descriptor_zeros(model, output="mid")

    _assert_complex_close(result.finite_zeros, np.array([-1.0 / (R * C)]))
    assert result.finite_count == 1
    assert result.max_residual < 1.0e-10


def test_series_rlc_inductor_current_zero_at_origin() -> None:
    """串联 RLC 电感电流 I(s) ∝ s/(LCs^2+RCs+1)，原点为零点。"""
    model = DescriptorModel.from_scene(_series_rlc())
    result = descriptor_zeros(model, output="L1")

    assert result.finite_count == 1
    np.testing.assert_allclose(
        result.finite_zeros, np.array([0.0 + 0.0j]), rtol=0.0, atol=1.0e-6
    )
    assert result.max_residual < 1.0e-10


def test_analyze_zeros_with_explicit_matrices() -> None:
    """显式矩阵形式：一阶系统 (s+3)/(s+2) 的零点为 -3。"""
    result = analyze_zeros(
        np.array([[2.0]]),
        np.array([[1.0]]),
        np.array([[1.0]]),
        np.array([[1.0]]),
        np.array([[1.0]]),
    )

    _assert_complex_close(result.finite_zeros, np.array([-3.0 + 0.0j]))
    assert result.size == 1
    assert result.infinite_count == 1
    assert result.max_residual < 1.0e-12


def test_analyze_zeros_rejects_mimo_explicitly() -> None:
    """MIMO 传输零点尚未实现，必须抛出明确的未实现/限制异常。"""
    model = DescriptorModel.from_scene(_rc_low_pass())
    system = model.build("V1")
    B = np.column_stack([system.B, system.B])
    C = np.zeros((1, model.index.size))
    C[0, model.index.node_index[model.index.node_name_to_id["out"]]] = 1.0

    # 多输出（2 个输出、1 个输入）应被明确拒绝。
    with pytest.raises(UnsupportedAnalysisError) as excinfo:
        analyze_zeros(system, C=np.vstack([C, C]), D=np.zeros((2, 1)))
    assert isinstance(excinfo.value, ComputeError)
    assert isinstance(excinfo.value, NotImplementedError)
    assert "MIMO" in str(excinfo.value)

    # B 本身也接受多列形状，但 MIMO 在输出阶段应被拒绝。
    with pytest.raises(UnsupportedAnalysisError):
        analyze_zeros(system.A, system.E, B, np.vstack([C, C]), np.zeros((2, 2)))


def test_analyze_zeros_rejects_bad_shapes_and_empty_input() -> None:
    """B/C/D 形状不合法或 B 全零时必须报 ValidationError。"""
    A = np.eye(2)
    E = np.eye(2)
    C = np.array([[1.0, 0.0]])

    with pytest.raises(ValidationError):
        analyze_zeros(A, E, np.zeros((3, 1)), C, np.zeros((1, 1)))
    with pytest.raises(ValidationError):
        analyze_zeros(A, E, np.zeros((2, 1)), C, np.zeros((1, 1)))
    with pytest.raises(ValidationError):
        analyze_zeros(A, E, np.ones((2, 1)), np.zeros((1, 3)), np.zeros((1, 1)))
    with pytest.raises(ValidationError):
        analyze_zeros(A, E, np.ones((2, 1)), C, np.zeros((2, 1)))


def test_build_output_matrices_node_branch_and_capacitor_current() -> None:
    """节点电压与支路电流可转为 C/D；电容电流显式不支持。"""
    model = DescriptorModel.from_scene(_series_rlc())
    C_node, D_node = build_output_matrices(model, "out")
    out_index = model.index.node_index[model.index.node_name_to_id["out"]]
    assert C_node.shape == (1, model.index.size)
    assert D_node.shape == (1, 1)
    assert C_node[0, out_index] == pytest.approx(1.0)
    assert np.count_nonzero(C_node) == 1

    C_branch, D_branch = build_output_matrices(model, "L1")
    assert C_branch[0, model.index.branch_index["L1"]] == pytest.approx(1.0)
    assert np.count_nonzero(D_branch) == 0

    with pytest.raises(ComputeError, match="电容电流"):
        build_output_matrices(model, "C1")


def test_analyze_zeros_accepts_matrix_form_and_rejects_singular_rosenbrock() -> None:
    """矩阵形式的正常调用可用；全零输出/输入导致 Rosenbrock 铅笔奇异时明确报错。"""
    # 正常的一阶系统
    result = analyze_zeros([[2.0]], [[1.0]], [[1.0]], [[1.0]], [[1.0]])
    _assert_complex_close(result.finite_zeros, np.array([-3.0 + 0.0j]))

    # C=0 且 D=0：输出恒为零，零点无定义。
    with pytest.raises(ValidationError):
        analyze_zeros([[2.0]], [[1.0]], [[1.0]], [[0.0]], [[0.0]])
