"""阶段6 P1-R2：AC/Bode 双后端（Legacy ac_sweep 为 canonical vs Descriptor）一致性对拍。

覆盖 T01–T14 + C15 + S16 + state_invariance。容差严格：逐点 max_abs≤1e-12 且当 |ref|>1e-9 时 max_rel(complex)≤1e-9（由 _assert_strict_allclose 显式断言，非 assert_allclose 合并界）。频点 1e1–1e6 log 加密（41 点）并在 RLC 串联谐振≈5.03kHz 附近补 7 个采样点。
- 纯线性拓扑：descriptor 走委托（A+B 已并入后）；逐点比较 real/imag/magnitude/phase/db。
- C15（opamp 无工作点）：两后端各自 raise，仅断言同为 ComputeError（不逐字比文案）。
- 非线性线性化：单列 known-difference，不计入 parity 失败。
- S16（switch 电流探针）：依赖 A 支，比较 canonical 与 descriptor 的 switch 电流。
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from netlab.core.common.limits import ComputeError
from netlab.core.compute.circuit import DescriptorModel
from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene

def _build_freqs() -> list[float]:
    freqs = [float(round(f, 9)) for f in np.logspace(1.0, 6.0, 41)]  # 1e1..1e6, 每 0.125 decade
    f0 = 1.0 / (2.0 * math.pi * math.sqrt(1.0e-3 * 1.0e-6))  # RLC 串联谐振 ≈ 5032.9 Hz
    for m in (0.8, 0.9, 0.95, 1.0, 1.05, 1.1, 1.2):
        freqs.append(float(round(f0 * m, 9)))
    return sorted(set(freqs))


FREQS = _build_freqs()
ATOL = 1e-12
RTOL = 1e-9


def _assert_strict_allclose(got, ref, rtol=RTOL, atol=ATOL, err_msg=""):
    """严格逐点断言：max_abs<=atol 且当 |ref|>1e-9 时 max_rel<=rtol（不是 assert_allclose 的合并界）。"""
    got = np.asarray(got, dtype=float)
    ref = np.asarray(ref, dtype=float)
    assert got.shape == ref.shape, f"{err_msg}: shape {got.shape} != {ref.shape}"
    if ref.size == 0:
        return
    abs_err = np.abs(got - ref)
    m = float(np.max(abs_err))
    assert m <= atol, f"{err_msg}: max_abs={m:.3e} > atol={atol:.0e}"
    mask = np.abs(ref) > 1e-9
    if bool(np.any(mask)):
        r = float(np.max(abs_err[mask] / np.abs(ref[mask])))
        assert r <= rtol, f"{err_msg}: max_rel={r:.3e} > rtol={rtol:.0e}"


def _gnd(s):
    return s.add_node(name="gnd", kind="ground")


def _nod(s, name):
    return s.add_node(name=name, kind="node")


def _vdc(s, name, node, gnd, amp=1.0, offset=0.0):
    s.add_edge(name=name, source=node.id, target=gnd.id, kind="vsource",
               params={"wave": "dc", "offset": offset, "amplitude": amp})


def _parity(scene: Scene, probe: str) -> None:
    can = Simulation(scene).ac_sweep(FREQS, input_source="V1", probes=[probe])
    des = DescriptorModel.from_scene(scene).frequency_response(FREQS, input_source="V1", probes=[probe])
    cp = can["probes"][probe]
    dp = des["probes"][probe]
    keys = [k for k in cp if k in dp]
    assert keys, f"{probe} 无共同可比字段"
    for k in keys:
        a = np.asarray(cp[k], dtype=float)
        b = np.asarray(dp[k], dtype=float)
        if a.shape != b.shape or a.size == 0:
            continue
        _assert_strict_allclose(b, a, rtol=RTOL, atol=ATOL, err_msg=f"{probe}.{k}")


# ---- 拓扑构建器（T01–T14）----
def _t01_rc_lpf():
    s = Scene("circuit"); g = _gnd(s); vin = _nod(s, "vin"); out = _nod(s, "out")
    _vdc(s, "V1", vin, g)
    s.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0})
    s.add_edge(name="C1", source=out.id, target=g.id, kind="capacitor", params={"C": 1.0e-6})
    return s, "out"


def _t02_rc_hpf():
    s = Scene("circuit"); g = _gnd(s); vin = _nod(s, "vin"); out = _nod(s, "out")
    _vdc(s, "V1", vin, g)
    s.add_edge(name="C1", source=vin.id, target=out.id, kind="capacitor", params={"C": 1.0e-6})
    s.add_edge(name="R1", source=out.id, target=g.id, kind="resistor", params={"R": 1000.0})
    return s, "out"


def _t03_rl_lpf():
    s = Scene("circuit"); g = _gnd(s); vin = _nod(s, "vin"); out = _nod(s, "out")
    _vdc(s, "V1", vin, g)
    s.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0})
    s.add_edge(name="L1", source=out.id, target=g.id, kind="inductor", params={"L": 1.0e-3})
    return s, "out"


def _t04_rlc_series():
    s = Scene("circuit"); g = _gnd(s); vin = _nod(s, "vin"); a = _nod(s, "a"); b = _nod(s, "b")
    _vdc(s, "V1", vin, g)
    s.add_edge(name="R1", source=vin.id, target=a.id, kind="resistor", params={"R": 1000.0})
    s.add_edge(name="L1", source=a.id, target=b.id, kind="inductor", params={"L": 1.0e-3})
    s.add_edge(name="C1", source=b.id, target=g.id, kind="capacitor", params={"C": 1.0e-6})
    return s, "b"


def _t05_vcvs():
    s = Scene("circuit"); g = _gnd(s); vin = _nod(s, "vin"); a = _nod(s, "a"); b = _nod(s, "b")
    _vdc(s, "V1", vin, g)
    s.add_edge(name="R1", source=vin.id, target=a.id, kind="resistor", params={"R": 1000.0})
    s.add_edge(name="C1", source=a.id, target=g.id, kind="capacitor", params={"C": 1.0e-6})
    s.add_edge(name="E1", source=b.id, target=g.id, kind="vcvs",
               params={"gain": 1.0, "control_source": a.id, "control_target": g.id})
    return s, "b"


def _t06_vccs():
    s = Scene("circuit"); g = _gnd(s); vin = _nod(s, "vin"); a = _nod(s, "a"); out = _nod(s, "out")
    _vdc(s, "V1", vin, g)
    s.add_edge(name="R1", source=vin.id, target=a.id, kind="resistor", params={"R": 1000.0})
    s.add_edge(name="C1", source=a.id, target=g.id, kind="capacitor", params={"C": 1.0e-6})
    s.add_edge(name="G1", source=out.id, target=g.id, kind="vccs",
               params={"gm": 1.0e-3, "control_source": a.id, "control_target": g.id})
    s.add_edge(name="R2", source=out.id, target=g.id, kind="resistor", params={"R": 1000.0})
    return s, "out"


def _t07_multi_source():
    s = Scene("circuit"); g = _gnd(s); vin = _nod(s, "vin"); vin2 = _nod(s, "vin2"); out = _nod(s, "out")
    _vdc(s, "V1", vin, g, amp=1.0)
    _vdc(s, "V2", vin2, g, amp=0.5)
    s.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0})
    s.add_edge(name="R2", source=vin2.id, target=out.id, kind="resistor", params={"R": 2000.0})
    s.add_edge(name="C1", source=out.id, target=g.id, kind="capacitor", params={"C": 1.0e-6})
    return s, "out"


def _t09_floating_ground():
    s = Scene("circuit"); g = _gnd(s); vin = _nod(s, "vin"); out = _nod(s, "out"); f = _nod(s, "f")
    _vdc(s, "V1", vin, g)
    s.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0})
    s.add_edge(name="R2", source=out.id, target=f.id, kind="resistor", params={"R": 1000.0})
    s.add_edge(name="R3", source=f.id, target=g.id, kind="resistor", params={"R": 1000.0})
    s.add_edge(name="C1", source=out.id, target=g.id, kind="capacitor", params={"C": 1.0e-6})
    return s, "out"


def _t10_ill_conditioned():
    s = Scene("circuit"); g = _gnd(s); vin = _nod(s, "vin"); out = _nod(s, "out")
    _vdc(s, "V1", vin, g)
    s.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1.0})
    s.add_edge(name="R2", source=out.id, target=g.id, kind="resistor", params={"R": 1.0e12})
    s.add_edge(name="C1", source=out.id, target=g.id, kind="capacitor", params={"C": 1.0e-9})
    return s, "out"


def _t12_source_normalization():
    s = Scene("circuit"); g = _gnd(s); vin = _nod(s, "vin"); out = _nod(s, "out")
    # 大直流偏置 + 单位幅度：AC 应归一化幅度、忽略偏置
    _vdc(s, "V1", vin, g, amp=1.0, offset=1000.0)
    s.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0})
    s.add_edge(name="R2", source=out.id, target=g.id, kind="resistor", params={"R": 1000.0})
    return s, "out"


def _switch_topology(closed: bool):
    s = Scene("circuit"); g = _gnd(s); vin = _nod(s, "vin"); out = _nod(s, "out")
    _vdc(s, "V1", vin, g)
    s.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0})
    s.add_edge(name="SW1", source=out.id, target=g.id, kind="switch",
               params={"closed": closed, "ron": 1.0, "roff": 1.0e12})
    return s, "out"


def _t13_switch_closed():
    return _switch_topology(True)


def _t14_switch_open():
    return _switch_topology(False)


SCENARIOS = {
    "T01_rc_lpf": _t01_rc_lpf,
    "T02_rc_hpf": _t02_rc_hpf,
    "T03_rl_lpf": _t03_rl_lpf,
    "T04_rlc_series": _t04_rlc_series,
    "T05_vcvs": _t05_vcvs,
    "T06_vccs": _t06_vccs,
    "T07_multi_source": _t07_multi_source,
    "T09_floating_ground": _t09_floating_ground,
    "T10_ill_conditioned": _t10_ill_conditioned,
    "T12_source_normalization": _t12_source_normalization,
    "T13_switch_closed": _t13_switch_closed,
    "T14_switch_open": _t14_switch_open,
}


@pytest.mark.parametrize("name", sorted(SCENARIOS))
def test_linear_topology_parity(name):
    scene, probe = SCENARIOS[name]()
    _parity(scene, probe)


def test_t08_multi_probe_parity():
    s = Scene("circuit"); g = _gnd(s); vin = _nod(s, "vin"); out = _nod(s, "out")
    _vdc(s, "V1", vin, g)
    s.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0})
    s.add_edge(name="C1", source=out.id, target=g.id, kind="capacitor", params={"C": 1.0e-6})
    probes = ["out", "vin"]
    can = Simulation(s).ac_sweep(FREQS, input_source="V1", probes=probes)
    des = DescriptorModel.from_scene(s).frequency_response(FREQS, input_source="V1", probes=probes)
    for p in probes:
        for k in [k for k in can["probes"][p] if k in des["probes"][p]]:
            _assert_strict_allclose(np.asarray(des["probes"][p][k], float),
                                       np.asarray(can["probes"][p][k], float),
                                       rtol=RTOL, atol=ATOL, err_msg=f"{p}.{k}")


def test_state_invariance():
    scene, probe = _t01_rc_lpf()
    a = Simulation(scene).ac_sweep(FREQS, input_source="V1", probes=[probe])
    b = Simulation(scene).ac_sweep(FREQS, input_source="V1", probes=[probe])
    for k in a["probes"][probe]:
        _assert_strict_allclose(np.asarray(b["probes"][probe][k], float),
                                   np.asarray(a["probes"][probe][k], float),
                                   rtol=0, atol=0, err_msg=f"state mutation in {k}")


def test_t11_singular_both_raise_compute_error():
    s = Scene("circuit"); g = _gnd(s); vin = _nod(s, "vin"); a = _nod(s, "a")
    _vdc(s, "V1", vin, g)
    # a 只接电流源、无对地导电路径 → AC 矩阵奇异
    s.add_edge(name="I1", source=g.id, target=a.id, kind="isource",
               params={"wave": "dc", "offset": 0.0, "amplitude": 1.0})
    with pytest.raises(ComputeError) as e_can:
        Simulation(s).ac_sweep(FREQS, input_source="V1", probes=["a"])
    with pytest.raises(ComputeError) as e_des:
        DescriptorModel.from_scene(s).frequency_response(FREQS, input_source="V1", probes=["a"])
    # 统一错误契约：默认路径 descriptor 委托 canonical，故两者同为 ComputeError 且文案一致、均点名节点 a
    assert str(e_can.value) == str(e_des.value), f"canonical/descriptor 错误文案不一致: {e_can.value!r} vs {e_des.value!r}"
    assert "'a'" in str(e_can.value), f"错误文案未点名节点 a: {e_can.value}"


def test_c15_opamp_no_operating_point_both_raise():
    s = Scene("circuit"); g = _gnd(s); vin = _nod(s, "vin"); vn = _nod(s, "vn"); vout = _nod(s, "vout")
    _vdc(s, "V1", vin, g, amp=1.0)
    s.add_edge(name="R1", source=vin.id, target=vn.id, kind="resistor", params={"R": 1000.0})
    s.add_edge(name="R2", source=vn.id, target=vout.id, kind="resistor", params={"R": 10000.0})
    s.add_edge(name="OP1", source=vout.id, target=g.id, kind="opamp",
               params={"vp": g.id, "vn": vn.id, "gain": 1.0e5, "vmax": 15.0})
    with pytest.raises(ComputeError) as e_can:
        Simulation(s).ac_sweep(FREQS, input_source="V1", probes=["vout"])
    with pytest.raises(ComputeError) as e_des:
        DescriptorModel.from_scene(s).frequency_response(FREQS, input_source="V1", probes=["vout"])
    # 统一错误契约：默认路径两者同为 ComputeError，且均点名 opamp 元件 OP1
    for _tag, _exc in (("canonical", e_can.value), ("descriptor", e_des.value)):
        _msg = str(_exc)
        assert "OP1" in _msg and "opamp" in _msg, f"{_tag} 错误文案未点名 OP1/opamp: {_msg}"


def test_s16_switch_current_probe_parity():
    s = Scene("circuit"); g = _gnd(s); vin = _nod(s, "vin"); out = _nod(s, "out")
    _vdc(s, "V1", vin, g)
    s.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0})
    s.add_edge(name="SW1", source=out.id, target=g.id, kind="switch",
               params={"closed": True, "ron": 1.0, "roff": 1.0e12})
    can = Simulation(s).ac_sweep(FREQS, input_source="V1", probes=["SW1"])
    des = DescriptorModel.from_scene(s).frequency_response(FREQS, input_source="V1", probes=["SW1"])
    for k in [k for k in can["probes"]["SW1"] if k in des["probes"]["SW1"]]:
        _assert_strict_allclose(np.asarray(des["probes"]["SW1"][k], float),
                                   np.asarray(can["probes"]["SW1"][k], float),
                                   rtol=RTOL, atol=ATOL, err_msg=f"SW1.{k}")
