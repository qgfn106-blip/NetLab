"""阶段6 P1-R2 · A 支：AC 分析支持 switch 的电流探针（S16）。

现状（base 02b9fda）：`CircuitSolver._ac_probe` 只处理 resistor/capacitor/inductor/
vsource/isource，switch 落到末尾 raise「AC 探针…的电流暂不支持」。修法：补
`switch: (va - vb) * element.conductance`（与 Switch.commit 的 current=(va-vb)*conductance 同口径，
conductance=1/(ron if closed else roff)）。
"""

from __future__ import annotations

import math

from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene


def _switch_scene() -> tuple[Scene, str]:
    s = Scene("circuit")
    gnd = s.add_node(name="gnd", kind="ground")
    vin = s.add_node(name="vin", kind="node")
    out = s.add_node(name="out", kind="node")
    s.add_edge(name="V1", source=vin.id, target=gnd.id, kind="vsource",
               params={"wave": "dc", "offset": 0.0, "amplitude": 1.0})
    s.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0})
    s.add_edge(name="SW1", source=out.id, target=gnd.id, kind="switch",
               params={"closed": True, "ron": 1.0, "roff": 1.0e12})
    return s, "SW1"


def test_switch_current_probe_is_supported():
    scene, name = _switch_scene()
    data = Simulation(scene).ac_sweep([10.0, 1000.0], input_source="V1", probes=[name])
    current = data["probes"][name]
    assert len(current["magnitude"]) == 2
    assert all(math.isfinite(v) and v > 0.0 for v in current["magnitude"])


def test_switch_current_probe_matches_descriptor():
    # 与 descriptor 后端对照（switch 两端电压 * conductance 的口径一致）
    from netlab.core.compute.circuit import DescriptorModel

    scene, name = _switch_scene()
    freq = [10.0, 100.0, 1000.0]
    canonical = Simulation(scene).ac_sweep(freq, input_source="V1", probes=[name])
    descriptor = DescriptorModel.from_scene(scene).frequency_response(
        freq, input_source="V1", probes=[name]
    )
    for key in ("real", "imag", "magnitude", "phase_deg", "db"):
        import numpy as np
        np.testing.assert_allclose(
            np.asarray(descriptor["probes"][name][key], dtype=float),
            np.asarray(canonical["probes"][name][key], dtype=float),
            rtol=1e-9, atol=1e-12, err_msg=f"{key} 超容差",
        )
