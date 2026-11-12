"""P1-R2 双后端 AC/Bode 对拍 harness。

对比两个生产实现（只读调用，不修改任何生产代码）：

- Legacy  : ``Simulation(scene).ac_sweep(freqs, input_source=..., probes=...)``
            -> ``netlab/core/compute/circuit/solver.py`` 的 ``ac_sweep``
- Descriptor: ``DescriptorModel.from_scene(scene).frequency_response(freqs, ...)``
            -> ``netlab/core/compute/circuit/descriptor.py`` 的 ``frequency_response``

覆盖 P1-R2 矩阵要求的 12 类拓扑/行为场景，并补充 switch、病态、奇异三类，
以及 E 矩阵秩证据与性能测试（冷启动 / 预热 / 重复中位数）。

运行（在 NetlabHome 目录下）::

    python tools/p1r2_parity_harness.py            # 全量，人读输出
    python tools/p1r2_parity_harness.py --quick    # 跳过性能重测
    python tools/p1r2_parity_harness.py --json     # 末尾附机器可读 JSON

本脚本不依赖任何本机绝对路径，也不写入仓库（除非显式 --json-out）。
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from netlab.core.compute.circuit import DescriptorModel  # noqa: E402
from netlab.core.compute.simulation import Simulation  # noqa: E402
from netlab.core.model.scene import Scene  # noqa: E402

# 与 P1-R2 文档一致的 5 点频格（Hz）
FREQUENCIES = [10.0, 100.0, 1000.0, 10000.0, 100000.0]

# 复数域误差判据（逐场景聚合，ref=Legacy）：
#   max_abs = max_{p,f} |Z_desc - Z_legacy|
#   scale   = max_{p,f} |Z_legacy|            （场景参考峰值，兜底 scale_floor=1e-12）
#   max_rel = max_abs / max(scale, scale_floor)
# 判定 MATCH 当且仅当  max_abs <= ATOL 且 max_rel <= RTOL。
# 用"参考峰值"而非逐点分母，避免参考值接近 0 时相对误差被 1e-30 放大成伪失败。
ATOL = 1e-12
RTOL = 1e-9
SCALE_FLOOR = 1e-12


def _vsource(scene: Scene, name: str, a, b, amplitude: float = 1.0) -> None:
    scene.add_edge(
        name=name,
        source=a.id,
        target=b.id,
        kind="vsource",
        params={"wave": "dc", "offset": 0.0, "amplitude": amplitude},
    )


def _isource(scene: Scene, name: str, a, b, amplitude: float = 1.0) -> None:
    scene.add_edge(
        name=name,
        source=a.id,
        target=b.id,
        kind="isource",
        params={"wave": "dc", "offset": 0.0, "amplitude": amplitude},
    )


def _res(scene: Scene, name: str, a, b, r: float) -> None:
    scene.add_edge(name=name, source=a.id, target=b.id, kind="resistor", params={"R": r})


def _cap(scene: Scene, name: str, a, b, c: float) -> None:
    scene.add_edge(name=name, source=a.id, target=b.id, kind="capacitor", params={"C": c})


def _ind(scene: Scene, name: str, a, b, l: float) -> None:
    scene.add_edge(name=name, source=a.id, target=b.id, kind="inductor", params={"L": l})


def _base(title: str):
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    out = scene.add_node(name="out", kind="node")
    _vsource(scene, "V1", vin, gnd)
    return scene, gnd, vin, out


# ---------------------------------------------------------------------------
# 场景构造器：每个返回 (scene, input_source, probes, description)
# ---------------------------------------------------------------------------
def s_rc_lowpass():
    scene, gnd, vin, out = _base("RC lowpass")
    _res(scene, "R1", vin, out, 1000.0)
    _cap(scene, "C1", out, gnd, 1e-6)
    return scene, "V1", ["out"], "RC 低通（一阶）"


def s_rc_highpass():
    scene, gnd, vin, out = _base("RC highpass")
    _cap(scene, "C1", vin, out, 1e-6)
    _res(scene, "R1", out, gnd, 1000.0)
    return scene, "V1", ["out"], "RC 高通（一阶）"


def s_rl_lowpass():
    scene, gnd, vin, out = _base("RL lowpass")
    _res(scene, "R1", vin, out, 1000.0)
    _ind(scene, "L1", out, gnd, 1e-3)
    return scene, "V1", ["out"], "RL 低通（一阶）"


def s_rlc_series():
    scene, gnd, vin, out = _base("RLC series")
    _res(scene, "R1", vin, out, 100.0)
    _ind(scene, "L1", out, gnd, 1e-3)
    _cap(scene, "C1", out, gnd, 1e-6)
    return scene, "V1", ["out"], "RLC 串联谐振（二阶）"


def s_vcvs():
    """VCVS 增益级（gain=2）。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    a = scene.add_node(name="a", kind="node")
    out = scene.add_node(name="out", kind="node")
    _vsource(scene, "V1", vin, gnd)
    _res(scene, "R1", vin, a, 1000.0)
    _cap(scene, "C1", a, gnd, 1e-6)
    scene.add_edge(
        name="E1",
        source=out.id,
        target=gnd.id,
        kind="vcvs",
        params={"gain": 2.0, "control_source": a.id, "control_target": gnd.id},
    )
    _res(scene, "R2", out, gnd, 1000.0)
    _cap(scene, "C2", out, gnd, 1e-6)
    return scene, "V1", ["a", "out"], "VCVS 增益级（gain=2）"


def s_vccs():
    """VCCS 跨导级（gm=2 mS）。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    a = scene.add_node(name="a", kind="node")
    out = scene.add_node(name="out", kind="node")
    _vsource(scene, "V1", vin, gnd)
    _res(scene, "R1", vin, a, 1000.0)
    _cap(scene, "C1", a, gnd, 1e-6)
    scene.add_edge(
        name="G1",
        source=gnd.id,
        target=out.id,
        kind="vccs",
        params={"gm": 2e-3, "control_source": a.id, "control_target": gnd.id},
    )
    _res(scene, "R2", out, gnd, 1000.0)
    _cap(scene, "C2", out, gnd, 1e-6)
    return scene, "V1", ["a", "out"], "VCCS 跨导级（gm=2mS）"


def s_isource_drive():
    """电流源激励：I1(1A) 驱动 R(1k)。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    inn = scene.add_node(name="inn", kind="node")
    _isource(scene, "I1", gnd, inn, amplitude=1.0)
    _res(scene, "R1", inn, gnd, 1000.0)
    return scene, "I1", ["inn"], "电流源激励（I1=1A，R=1k）"


def s_multi_independent():
    """两个独立电压源 + 一个独立电流源，只选 V1 作激励，其余置零。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    mid = scene.add_node(name="mid", kind="node")
    out = scene.add_node(name="out", kind="node")
    _vsource(scene, "V1", vin, gnd)
    _vsource(scene, "V2", mid, gnd, amplitude=5.0)
    _isource(scene, "I1", gnd, out, amplitude=2e-3)
    _res(scene, "R1", vin, out, 1000.0)
    _res(scene, "R2", mid, out, 1000.0)
    _cap(scene, "C1", out, gnd, 1e-6)
    return scene, "V1", ["out"], "多独立源（V1 激励，V2/I1 置零）"


def s_floating_grounded():
    """非直接接地的浮置支路节点 + 一端接地，检验节点电压参考。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    a = scene.add_node(name="a", kind="node")
    b = scene.add_node(name="b", kind="node")
    _vsource(scene, "V1", vin, gnd)
    _res(scene, "R1", vin, a, 1000.0)
    _res(scene, "R2", a, b, 2200.0)
    _cap(scene, "C1", b, gnd, 1e-6)
    _res(scene, "R3", b, gnd, 10000.0)
    return scene, "V1", ["a", "b"], "浮置支路节点 a/b 与接地节点混排"


def s_ill_conditioned():
    """病态但非奇异：6 级 R 交替 1e-6 / 1e6 欧 + 每级电容。

    实测 cond(A) ~ 1.5e13，但矩阵仍满秩可解，两个后端都给出相同结果。
    """
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    _vsource(scene, "V1", vin, gnd)
    prev = vin
    for i in range(6):
        node = scene.add_node(name=f"n{i}", kind="node")
        _res(scene, f"R{i}", prev, node, 1e-6 if i % 2 == 0 else 1e6)
        _cap(scene, f"C{i}", node, gnd, 1e-9)
        prev = node
    return scene, "V1", ["n5"], "病态梯形网络（cond(A)≈1.5e13，非奇异）"


def s_singular():
    """奇异：两个理想电压源并联同一节点，A 秩亏，A+jwE 对所有 w 奇异。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    a = scene.add_node(name="a", kind="node")
    _vsource(scene, "V1", a, gnd)
    _vsource(scene, "V2", a, gnd)
    _res(scene, "R1", a, gnd, 1000.0)
    return scene, "V1", ["a"], "奇异（两个理想压源并联，A 秩亏）"


def s_multi_probe():
    scene, gnd, vin, out = _base("multi probe")
    _res(scene, "R1", vin, out, 1000.0)
    _cap(scene, "C1", out, gnd, 1e-6)
    _ind(scene, "L1", out, gnd, 1e-3)
    return scene, "V1", ["out", "R1", "C1", "V1"], "多探针（节点 + 三个元件电流）"


def s_switch_closed():
    scene, gnd, vin, out = _base("switch")
    _res(scene, "R1", vin, out, 1000.0)
    scene.add_edge(
        name="S1",
        source=out.id,
        target=gnd.id,
        kind="switch",
        params={"closed": True, "ron": 1e-3, "roff": 1e9},
    )
    return scene, "V1", ["out"], "switch 闭合（ron=1mΩ），节点电压探针"


def s_switch_open():
    scene, gnd, vin, out = _base("switch")
    _res(scene, "R1", vin, out, 1000.0)
    scene.add_edge(
        name="S1",
        source=out.id,
        target=gnd.id,
        kind="switch",
        params={"closed": False, "ron": 1e-3, "roff": 1e9},
    )
    return scene, "V1", ["out"], "switch 断开（roff=1GΩ），节点电压探针"


def s_state_invariance():
    scene, gnd, vin, out = _base("state invariance")
    _res(scene, "R1", vin, out, 1200.0)
    _cap(scene, "C1", out, gnd, 2.2e-6)
    _ind(scene, "L1", out, gnd, 4.7e-3)
    return scene, "V1", ["out"], "状态不变性（同 scene 连续两次调用）"


def s_nonlinear_reject():
    """非线性元件：两个后端都拒绝（错误契约不同），不计 MATCH。"""
    scene, gnd, vin, out = _base("nonlinear")
    scene.add_edge(
        name="E1",
        source=out.id,
        target=gnd.id,
        kind="opamp",
        params={"gain": 1e5},
    )
    _res(scene, "R1", vin, out, 1000.0)
    return scene, "V1", ["out"], "非线性 opamp（双方拒绝，控制项）"


SCENARIOS = [
    ("T01", s_rc_lowpass),
    ("T02", s_rc_highpass),
    ("T03", s_rl_lowpass),
    ("T04", s_rlc_series),
    ("T05", s_vcvs),
    ("T06", s_vccs),
    ("T07", s_multi_independent),
    ("T08", s_multi_probe),
    ("T09", s_floating_grounded),
    ("T10", s_ill_conditioned),
    ("T11", s_singular),
    ("T12", s_isource_drive),
    ("T13", s_switch_closed),
    ("T14", s_switch_open),
    ("C15", s_nonlinear_reject),
]


def _complex_vector(result, probe):
    node = result["probes"][probe]
    return np.asarray(node["real"], dtype=float) + 1j * np.asarray(node["imag"], dtype=float)


def _compare(legacy, desc, probes):
    worst_abs = 0.0
    scale = 0.0
    detail = {}
    for probe in probes:
        lv = _complex_vector(legacy, probe)
        dv = _complex_vector(desc, probe)
        delta = np.abs(dv - lv)
        detail[probe] = {"max_abs": float(delta.max()), "ref_peak": float(np.abs(lv).max())}
        worst_abs = max(worst_abs, float(delta.max()))
        scale = max(scale, float(np.abs(lv).max()))
    worst_rel = worst_abs / max(scale, SCALE_FLOOR)
    return {"max_abs": worst_abs, "max_rel": worst_rel, "ref_scale": scale, "per_probe": detail}


def _matrix_info(scene, input_source):
    """取 DescriptorSystem 的 A/E 秩与条件数（只读，用于数学说明证据）。"""
    try:
        system = DescriptorModel.from_scene(scene).build(input_source)
        a = system.A
        e = system.E
        info = {
            "size": int(system.size),
            "rank_E": int(np.linalg.matrix_rank(e)),
            "rank_A": int(np.linalg.matrix_rank(a)),
            "cond_A": float(np.linalg.cond(a)),
        }
        try:
            info["rank_A_plus_jwE_at_1k"] = int(
                np.linalg.matrix_rank(system.matrix(2 * math.pi * 1000.0))
            )
            info["cond_A_plus_jwE_at_1k"] = float(
                np.linalg.cond(system.matrix(2 * math.pi * 1000.0))
            )
        except Exception:  # pragma: no cover - 诊断用，失败不影响判定
            pass
        return info
    except Exception as exc:  # noqa: BLE001 - 诊断信息，不改变主判定
        return {"error": f"{type(exc).__name__}: {exc}"}


def run_scenario(code, builder):
    scene, input_source, probes, description = builder()
    record = {"code": code, "name": builder.__name__, "description": description}
    legacy = desc = None
    try:
        legacy = Simulation(scene).ac_sweep(
            FREQUENCIES, input_source=input_source, probes=probes
        )
    except Exception as exc:  # noqa: BLE001
        record["legacy_error"] = f"{type(exc).__name__}: {exc}"
    try:
        desc = DescriptorModel.from_scene(scene).frequency_response(
            FREQUENCIES, input_source=input_source, probes=probes
        )
    except Exception as exc:  # noqa: BLE001
        record["desc_error"] = f"{type(exc).__name__}: {exc}"

    record["legacy_ok"] = legacy is not None
    record["desc_ok"] = desc is not None
    if legacy is not None and desc is not None:
        record["parity"] = _compare(legacy, desc, probes)
        match = record["parity"]["max_abs"] <= ATOL and record["parity"]["max_rel"] <= RTOL
        record["verdict"] = "MATCH" if match else "MISMATCH"
    elif legacy is None and desc is None:
        record["verdict"] = "DIVERGE(双方拒绝)"
    else:
        record["verdict"] = "DIVERGE(单侧失败)"
    record["matrix"] = _matrix_info(scene, input_source)
    return record


def run_state_invariance():
    scene, input_source, probes, _ = s_state_invariance()
    legacy_a = Simulation(scene).ac_sweep(FREQUENCIES, input_source=input_source, probes=probes)
    legacy_b = Simulation(scene).ac_sweep(FREQUENCIES, input_source=input_source, probes=probes)
    model = DescriptorModel.from_scene(scene)
    desc_a = model.frequency_response(FREQUENCIES, input_source=input_source, probes=probes)
    desc_b = model.frequency_response(FREQUENCIES, input_source=input_source, probes=probes)
    legacy_same = np.array_equal(_complex_vector(legacy_a, "out"), _complex_vector(legacy_b, "out"))
    desc_same = np.array_equal(_complex_vector(desc_a, "out"), _complex_vector(desc_b, "out"))
    return {"legacy_repeat_identical": bool(legacy_same), "desc_repeat_identical": bool(desc_same)}


def run_switch_current_capability():
    """switch 元件电流探针：Legacy 明确拒绝，Descriptor 支持（能力不对等，单列）。"""
    scene, input_source, probes, _ = s_switch_closed()
    record = {}
    try:
        result = Simulation(scene).ac_sweep(FREQUENCIES, input_source=input_source, probes=["S1"])
        record["legacy"] = {"ok": True, "magnitude": result["probes"]["S1"]["magnitude"]}
    except Exception as exc:  # noqa: BLE001
        record["legacy"] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    try:
        result = DescriptorModel.from_scene(scene).frequency_response(
            FREQUENCIES, input_source=input_source, probes=["S1"]
        )
        record["desc"] = {"ok": True, "magnitude": result["probes"]["S1"]["magnitude"]}
    except Exception as exc:  # noqa: BLE001
        record["desc"] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    return record


def build_scale_scene(sections: int = 180) -> tuple[Scene, str, list[str]]:
    """性能场景：180 段 RC 梯形网络，与 tools/bench_ac_backends.py 同构。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    nodes = [scene.add_node(name=f"n{i}", kind="node") for i in range(1, sections + 1)]
    _vsource(scene, "V1", nodes[0], gnd)
    reactive_step = max(1, len(nodes) // 5)
    for index, node in enumerate(nodes):
        if index % reactive_step == 0 or index == len(nodes) - 1:
            _cap(scene, f"C{index + 1}", node, gnd, 1e-6)
        if index + 1 < len(nodes):
            _res(scene, f"R{index + 1}", node, nodes[index + 1], 100.0)
    return scene, "V1", [f"n{sections}"]


def _time_call(fn, repeats: int) -> dict:
    samples = []
    for _ in range(repeats):
        start = time.perf_counter()
        fn()
        samples.append((time.perf_counter() - start) * 1000.0)
    samples.sort()
    return {
        "repeats": repeats,
        "median_ms": statistics.median(samples),
        "mean_ms": statistics.fmean(samples),
        "min_ms": samples[0],
        "max_ms": samples[-1],
    }


def _measure_pair(scene, input_source, probes, repeats: int, cold: bool) -> dict:
    legacy_fn = lambda: Simulation(scene).ac_sweep(  # noqa: E731
        FREQUENCIES, input_source=input_source, probes=probes
    )
    desc_fn = lambda: DescriptorModel.from_scene(scene).frequency_response(  # noqa: E731
        FREQUENCIES, input_source=input_source, probes=probes
    )
    result = {}
    if cold:
        # 冷启动：进程内首次 API 调用（模块已 import，含后端懒初始化）。
        # 单独记录，不代表稳态；不把 import 时间算进来。
        result["cold_first_call_ms"] = {
            "legacy": _time_call(legacy_fn, 1)["median_ms"],
            "descriptor": _time_call(desc_fn, 1)["median_ms"],
        }
    # 预热 3 次后取重复中位数，才代表稳态每次成本。
    for _ in range(3):
        legacy_fn()
        desc_fn()
    legacy = _time_call(legacy_fn, repeats)
    desc = _time_call(desc_fn, repeats)
    result["warm"] = {"legacy": legacy, "descriptor": desc}
    result["speedup_median"] = legacy["median_ms"] / desc["median_ms"]
    return result


def run_performance(repeats: int) -> dict:
    # 小电路（3 节点 RC 低通）：代表交互式单次 Bode 的调用成本。
    small_scene, small_input, small_probes, _ = s_rc_lowpass()
    small = _measure_pair(small_scene, small_input, small_probes, max(repeats, 50), cold=True)

    # 大电路（180 段 RC 梯形）：代表规模化/批量扫频成本，也与 tools/bench_ac_backends.py 同构。
    scale_scene, scale_input, scale_probes = build_scale_scene()
    large = _measure_pair(scale_scene, scale_input, scale_probes, repeats, cold=False)

    return {
        "frequencies": FREQUENCIES,
        "small_rc_lowpass": {"nodes": 3, **small},
        "ladder_180_sections": {"nodes": 180, **large},
    }


def _print_report(records, state_inv, switch_cap, perf):
    print("=" * 78)
    print("P1-R2 parity harness — freqs(Hz) =", FREQUENCIES)
    print(f"判据: max_abs <= {ATOL:g} 且 max_rel <= {RTOL:g} 记 MATCH")
    print("=" * 78)
    for rec in records:
        print(f"\n[{rec['code']}] {rec['description']}  ({rec['name']})")
        if rec.get("legacy_error"):
            print("  legacy_error:", rec["legacy_error"])
        if rec.get("desc_error"):
            print("  desc_error  :", rec["desc_error"])
        if "parity" in rec:
            par = rec["parity"]
            print(f"  max_abs={par['max_abs']:.3e}  max_rel={par['max_rel']:.3e}")
        print("  verdict:", rec["verdict"])
        matrix = rec.get("matrix", {})
        if matrix and "error" not in matrix:
            print(
                "  matrix: size={size} rank(E)={rank_E} rank(A)={rank_A} "
                "cond(A)={cond_A:.2e}".format(**matrix)
            )
        elif matrix.get("error"):
            print("  matrix: n/a —", matrix["error"])
    print("\n[state invariance]", state_inv)
    print("[switch 元件电流探针能力]", json.dumps(switch_cap, ensure_ascii=False))
    if perf:
        print("\n[performance] 端到端 API 调用（含场景/模型构建），5 频点")
        for label, key in (("小电路 3 节点 RC 低通", "small_rc_lowpass"), ("大电路 180 段 RC 梯形", "ladder_180_sections")):
            block = perf[key]
            if "cold_first_call_ms" in block:
                print(
                    "  {} cold first call: legacy={:.2f}ms descriptor={:.2f}ms".format(
                        label,
                        block["cold_first_call_ms"]["legacy"],
                        block["cold_first_call_ms"]["descriptor"],
                    )
                )
            print(
                "  {} warm median: legacy={:.3f}ms descriptor={:.3f}ms  speedup={:.2f}x".format(
                    label,
                    block["warm"]["legacy"]["median_ms"],
                    block["warm"]["descriptor"]["median_ms"],
                    block["speedup_median"],
                )
            )


def main() -> int:
    parser = argparse.ArgumentParser(description="P1-R2 AC/Bode 双后端对拍 harness")
    parser.add_argument("--quick", action="store_true", help="跳过性能重测")
    parser.add_argument("--repeats", type=int, default=30, help="性能重复次数")
    parser.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    parser.add_argument("--json-out", type=Path, default=None, help="把 JSON 写入指定路径")
    args = parser.parse_args()

    records = [run_scenario(code, builder) for code, builder in SCENARIOS]
    state_inv = run_state_invariance()
    switch_cap = run_switch_current_capability()
    perf = None if args.quick else run_performance(max(5, args.repeats))

    _print_report(records, state_inv, switch_cap, perf)
    payload = {
        "frequencies_hz": FREQUENCIES,
        "thresholds": {"atol": ATOL, "rtol": RTOL, "scale_floor": SCALE_FLOOR},
        "scenarios": records,
        "state_invariance": state_inv,
        "switch_current_probe": switch_cap,
        "performance": perf,
    }
    if args.json:
        print("\n" + json.dumps(payload, ensure_ascii=False, indent=2, default=float))
    if args.json_out:
        args.json_out.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, default=float), encoding="utf-8"
        )
        print(f"\nJSON 已写入: {args.json_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
