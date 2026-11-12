"""Read-only P1-R2 parity probe: Legacy ac_sweep vs Descriptor frequency_response.

Produces empirical evidence for P1-R2_PARITY_MATRIX / BACKEND_CONSTRAINTS.
Does NOT modify any production code. Run from NetlabHome cwd:
    python ../NetlabExtras/scratch/p1r2_parity_probe.py
"""
from __future__ import annotations

import math
import time
import traceback

from netlab.core.compute.simulation import Simulation
from netlab.core.compute.circuit import DescriptorModel
from netlab.core.model.scene import Scene

FREQS = [10.0, 100.0, 1000.0, 10000.0, 100000.0]


def _vsrc(scene, name, a, b, amp=1.0):
    scene.add_edge(name=name, source=a.id, target=b.id, kind="vsource",
                   params={"wave": "dc", "offset": 0.0, "amplitude": amp})


def _isrc(scene, name, a, b, amp=1.0):
    scene.add_edge(name=name, source=a.id, target=b.id, kind="isource",
                   params={"wave": "dc", "offset": 0.0, "amplitude": amp})


# ---------------- scene builders: each returns (scene, input_source, probes) ---
def rc_lowpass():
    s = Scene("circuit")
    g = s.add_node(name="gnd", kind="ground")
    vin = s.add_node(name="vin", kind="node")
    out = s.add_node(name="out", kind="node")
    _vsrc(s, "V1", vin, g)
    s.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0})
    s.add_edge(name="C1", source=out.id, target=g.id, kind="capacitor", params={"C": 1e-6})
    return s, "V1", ["out"]


def rc_highpass():
    s = Scene("circuit")
    g = s.add_node(name="gnd", kind="ground")
    vin = s.add_node(name="vin", kind="node")
    out = s.add_node(name="out", kind="node")
    _vsrc(s, "V1", vin, g)
    s.add_edge(name="C1", source=vin.id, target=out.id, kind="capacitor", params={"C": 1e-6})
    s.add_edge(name="R1", source=out.id, target=g.id, kind="resistor", params={"R": 1000.0})
    return s, "V1", ["out"]


def rl_lowpass():
    s = Scene("circuit")
    g = s.add_node(name="gnd", kind="ground")
    vin = s.add_node(name="vin", kind="node")
    out = s.add_node(name="out", kind="node")
    _vsrc(s, "V1", vin, g)
    s.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 10.0})
    s.add_edge(name="L1", source=out.id, target=g.id, kind="inductor", params={"L": 1e-3})
    return s, "V1", ["out"]


def rlc_series():
    s = Scene("circuit")
    g = s.add_node(name="gnd", kind="ground")
    vin = s.add_node(name="vin", kind="node")
    n1 = s.add_node(name="n1", kind="node")
    n2 = s.add_node(name="n2", kind="node")
    _vsrc(s, "V1", vin, g)
    s.add_edge(name="R1", source=vin.id, target=n1.id, kind="resistor", params={"R": 10.0})
    s.add_edge(name="L1", source=n1.id, target=n2.id, kind="inductor", params={"L": 1e-3})
    s.add_edge(name="C1", source=n2.id, target=g.id, kind="capacitor", params={"C": 1e-6})
    return s, "V1", ["n2"]


def controlled_vcvs():
    s = Scene("circuit")
    g = s.add_node(name="gnd", kind="ground")
    vin = s.add_node(name="vin", kind="node")
    out = s.add_node(name="out", kind="node")
    _vsrc(s, "V1", vin, g)
    s.add_edge(name="E1", source=out.id, target=g.id, kind="vcvs",
               params={"gain": 2.0, "control_source": vin.id, "control_target": g.id})
    s.add_edge(name="RL", source=out.id, target=g.id, kind="resistor", params={"R": 1000.0})
    return s, "V1", ["out"]


def controlled_vccs():
    s = Scene("circuit")
    g = s.add_node(name="gnd", kind="ground")
    vin = s.add_node(name="vin", kind="node")
    out = s.add_node(name="out", kind="node")
    _vsrc(s, "V1", vin, g)
    s.add_edge(name="G1", source=out.id, target=g.id, kind="vccs",
               params={"gm": 0.002, "control_source": vin.id, "control_target": g.id})
    s.add_edge(name="RL", source=out.id, target=g.id, kind="resistor", params={"R": 1000.0})
    return s, "V1", ["out"]


def multi_source():
    s = Scene("circuit")
    g = s.add_node(name="gnd", kind="ground")
    vin = s.add_node(name="vin", kind="node")
    aux = s.add_node(name="aux", kind="node")
    out = s.add_node(name="out", kind="node")
    _vsrc(s, "V1", vin, g)
    _vsrc(s, "V2", aux, g, amp=0.5)
    s.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0})
    s.add_edge(name="R2", source=aux.id, target=out.id, kind="resistor", params={"R": 2000.0})
    s.add_edge(name="R3", source=out.id, target=g.id, kind="resistor", params={"R": 3000.0})
    return s, "V1", ["out"]


def floating_node():
    # dangling node: connected only through a resistor, no path to ground
    s = Scene("circuit")
    g = s.add_node(name="gnd", kind="ground")
    vin = s.add_node(name="vin", kind="node")
    dangle = s.add_node(name="dangle", kind="node")
    _vsrc(s, "V1", vin, g)
    s.add_edge(name="R1", source=vin.id, target=dangle.id, kind="resistor", params={"R": 1000.0})
    return s, "V1", ["dangle"]


def singular_parallel_vsources():
    s = Scene("circuit")
    g = s.add_node(name="gnd", kind="ground")
    a = s.add_node(name="a", kind="node")
    _vsrc(s, "V1", a, g)
    _vsrc(s, "V2", a, g)
    s.add_edge(name="R1", source=a.id, target=g.id, kind="resistor", params={"R": 1000.0})
    return s, "V1", ["a"]


def isource_drive():
    s = Scene("circuit")
    g = s.add_node(name="gnd", kind="ground")
    inn = s.add_node(name="inn", kind="node")
    _isrc(s, "I1", g, inn)  # inject current into inn
    s.add_edge(name="R1", source=inn.id, target=g.id, kind="resistor", params={"R": 1000.0})
    return s, "I1", ["inn"]


def multi_probe():
    s, isrc, _ = rc_lowpass()
    return s, isrc, ["out", "R1"]  # node voltage + element current probe


def opamp_support():
    s = Scene("circuit")
    g = s.add_node(name="gnd", kind="ground")
    vin = s.add_node(name="vin", kind="node")
    out = s.add_node(name="out", kind="node")
    _vsrc(s, "V1", vin, g)
    s.add_edge(name="E1", source=out.id, target=g.id, kind="opamp",
               params={"vp": vin.id, "vn": out.id, "gain": 1.0e5, "vmax": 15.0})
    return s, "V1", ["out"]


SCENARIOS = [
    ("RC_lowpass", rc_lowpass),
    ("RC_highpass", rc_highpass),
    ("RL_lowpass", rl_lowpass),
    ("RLC_series", rlc_series),
    ("VCVS", controlled_vcvs),
    ("VCCS", controlled_vccs),
    ("multi_source", multi_source),
    ("multi_probe", multi_probe),
    ("floating_node", floating_node),
    ("singular_parallel_vsources", singular_parallel_vsources),
    ("isource_drive", isource_drive),
    ("opamp_support", opamp_support),
]


def _complex(probe):
    return [complex(r, i) for r, i in zip(probe["real"], probe["imag"])]


def _err(ref, got):
    if len(ref) != len(got):
        return float("inf"), float("inf")
    max_abs = 0.0
    max_rel = 0.0
    for a, b in zip(ref, got):
        d = abs(a - b)
        max_abs = max(max_abs, d)
        denom = max(abs(a), 1e-30)
        max_rel = max(max_rel, d / denom)
    return max_abs, max_rel


def run_one(name, builder):
    rec = {"scenario": name}
    try:
        scene, isrc, probes = builder()
    except Exception:
        rec["build"] = "ERROR"
        rec["detail"] = traceback.format_exc(limit=2)
        return rec
    # legacy
    try:
        t0 = time.perf_counter()
        leg = Simulation(scene).ac_sweep(FREQS, input_source=isrc, probes=probes)
        rec["legacy_ms"] = round((time.perf_counter() - t0) * 1000, 2)
        rec["legacy"] = "ok"
    except Exception as e:
        rec["legacy"] = f"{type(e).__name__}: {e}"
        leg = None
    # descriptor
    try:
        t0 = time.perf_counter()
        desc = DescriptorModel.from_scene(scene).frequency_response(
            FREQS, input_source=isrc, probes=probes)
        rec["desc_ms"] = round((time.perf_counter() - t0) * 1000, 2)
        rec["desc"] = "ok"
    except Exception as e:
        rec["desc"] = f"{type(e).__name__}: {e}"
        desc = None

    if leg and desc:
        rec["parity"] = {}
        ok_all = True
        for p in probes:
            try:
                ref = _complex(leg["probes"][p])
                got = _complex(desc["probes"][p])
                ma, mr = _err(ref, got)
                rec["parity"][p] = {"max_abs": ma, "max_rel": mr}
                if not (mr < 1e-6):
                    ok_all = False
            except Exception as e:
                rec["parity"][p] = f"ERR {type(e).__name__}: {e}"
                ok_all = False
        rec["parity_verdict"] = "MATCH" if ok_all else "DIVERGE"
    return rec


def state_invariance():
    rec = {"scenario": "state_invariance"}
    try:
        from netlab.core.model.scene import Scene as _S
        scene, isrc, probes = rc_lowpass()
        sim = Simulation(scene)
        a = sim.ac_sweep(FREQS, input_source=isrc, probes=probes)
        b = sim.ac_sweep(FREQS, input_source=isrc, probes=probes)
        same_l = all(a["probes"][p]["real"] == b["probes"][p]["real"]
                     and a["probes"][p]["imag"] == b["probes"][p]["imag"] for p in probes)
        rec["legacy_repeat_identical"] = same_l
        model = DescriptorModel.from_scene(scene)
        c = model.frequency_response(FREQS, input_source=isrc, probes=probes)
        d = model.frequency_response(FREQS, input_source=isrc, probes=probes)
        same_d = all(c["probes"][p]["real"] == d["probes"][p]["real"]
                     and c["probes"][p]["imag"] == d["probes"][p]["imag"] for p in probes)
        rec["desc_repeat_identical"] = same_d
    except Exception as e:
        rec["error"] = f"{type(e).__name__}: {e}"
    return rec


def main():
    print("=" * 72)
    print("P1-R2 parity probe — freqs =", FREQS)
    print("=" * 72)
    for name, builder in SCENARIOS:
        rec = run_one(name, builder)
        print("\n### " + name)
        for k, v in rec.items():
            if k == "scenario":
                continue
            print(f"  {k}: {v}")
    print("\n### state_invariance")
    for k, v in state_invariance().items():
        if k == "scenario":
            continue
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
