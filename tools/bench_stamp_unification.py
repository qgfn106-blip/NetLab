# -*- coding: utf-8 -*-
"""Stage 5 P1-R1: real quantitative benchmark for the stamp convergence.

Not a substitute for numerical-equivalence tests; this measures the actual
cost of the shared primitive and of a full descriptor matrix assembly so that
section 9.3 item 7 (performance baseline) can cite real numbers instead of
"not applicable". Run from NetlabHome/.
"""
from __future__ import annotations

import statistics
import time

import numpy as np

from netlab.core.compute.circuit import DescriptorModel
from netlab.core.compute.circuit.stamps import stamp_laplacian
from netlab.core.model.scene import Scene


def _inline(matrix, index, a, b, weight):
    ai = index.get(a)
    bi = index.get(b)
    if ai is not None:
        matrix[ai, ai] += weight
    if bi is not None:
        matrix[bi, bi] += weight
    if ai is not None and bi is not None:
        matrix[ai, bi] -= weight
        matrix[bi, ai] -= weight


def _time(fn, repeats):
    samples = []
    for _ in range(repeats):
        t0 = time.perf_counter()
        fn()
        samples.append((time.perf_counter() - t0) * 1000.0)
    return statistics.median(samples)


def _ladder(count: int) -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    nodes = [scene.add_node(name=f"n{i}", kind="node") for i in range(count)]
    scene.add_edge(
        name="V1", source=nodes[0].id, target=gnd.id, kind="vsource",
        params={"wave": "dc", "offset": 1.0, "amplitude": 0.0},
    )
    for i in range(count - 1):
        scene.add_edge(name=f"Rs{i}", source=nodes[i].id, target=nodes[i + 1].id,
                       kind="resistor", params={"R": 1000.0})
    for i in range(1, count):
        scene.add_edge(name=f"Rp{i}", source=nodes[i].id, target=gnd.id,
                       kind="resistor", params={"R": 10000.0})
    for i in range(1, count):
        scene.add_edge(name=f"C{i}", source=nodes[i].id, target=gnd.id,
                       kind="capacitor", params={"C": 1.0e-9})
    return scene


def main() -> int:
    index = {"a": 0, "b": 1}
    shared = np.zeros((2, 2))
    inline = np.zeros((2, 2))
    n_calls = 200_000

    def run_shared():
        for _ in range(n_calls):
            stamp_laplacian(shared, index, "a", "b", 1e-3)

    def run_inline():
        for _ in range(n_calls):
            _inline(inline, index, "a", "b", 1e-3)

    shared_ms = _time(run_shared, 5)
    inline_ms = _time(run_inline, 5)
    np.testing.assert_array_equal(shared, inline)

    count = 120
    scene = _ladder(count)
    model = DescriptorModel.from_scene(scene)

    def run_assemble():
        model._assemble_matrices()

    assemble_ms = _time(run_assemble, 7)

    print(f"stamp_laplacian {n_calls} calls: {shared_ms:.2f} ms "
          f"({shared_ms * 1e6 / n_calls:.3f} us/call)")
    print(f"inline reference {n_calls} calls: {inline_ms:.2f} ms "
          f"({inline_ms * 1e6 / n_calls:.3f} us/call)")
    print(f"shared/inline ratio: {shared_ms / inline_ms:.3f}x")
    print(f"_assemble_matrices {count}-node RC ladder: {assemble_ms:.2f} ms")
    print(f"A shape={model.A.shape} E shape={model.E.shape}")
    print("RESULT: matrices elementwise equal, real timings above")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
