"""D-5 solver shadow check CLI.

Runs the same RC ladder through the dense and sparse solver paths and applies
the ``shadow_gate`` threshold. Exit code is non-zero when the gate fails, so
this can be used as a local check or a CI step.
"""

from __future__ import annotations

import argparse
import json

import numpy as np

from netlab.core.compute.nodal import SolverOptions
from netlab.core.compute.shadow import shadow_gate
from netlab.core.model.scene import Scene


def _ladder(count: int, *, source: float = 3.0) -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    nodes = [scene.add_node(name=f"n{i}", kind="node") for i in range(count)]
    scene.add_edge(
        name="V1",
        source=nodes[0].id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": source, "amplitude": 0.0},
    )
    for index in range(count - 1):
        scene.add_edge(
            name=f"Rs{index}",
            source=nodes[index].id,
            target=nodes[index + 1].id,
            kind="resistor",
            params={"R": 1000.0},
        )
    for index, node in enumerate(nodes):
        scene.add_edge(
            name=f"Rp{index}",
            source=node.id,
            target=gnd.id,
            kind="resistor",
            params={"R": 1000.0},
        )
    return scene


def _voltages(scene: Scene) -> list[float]:
    return [
        float(record.data.get("voltage", 0.0))
        for record in scene.nodes.values()
        if record.name.startswith("n")
    ]


def run_check(count: int = 390, rtol: float = 1.0e-10) -> dict[str, object]:
    dense_scene = _ladder(count)
    dense_scene.set_solver_options(SolverOptions(sparse="off"))
    dense_scene.step(1.0e-4)

    sparse_scene = _ladder(count)
    sparse_scene.set_solver_options(SolverOptions(sparse="on"))
    sparse_scene.step(1.0e-4)

    result = shadow_gate(
        np.asarray(_voltages(dense_scene), dtype=float),
        np.asarray(_voltages(sparse_scene), dtype=float),
        mode="shadow",
        rtol=rtol,
    )
    return {
        "mode": result.mode,
        "count": count,
        "max_abs_error": result.max_abs_error,
        "max_rel_error": result.max_rel_error,
        "rtol": rtol,
        "passed": result.passed,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the D-5 solver shadow gate.")
    parser.add_argument("--count", type=int, default=390)
    parser.add_argument("--rtol", type=float, default=1.0e-10)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    result = run_check(count=args.count, rtol=args.rtol)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    else:
        print(
            f"shadow gate: passed={result['passed']} count={result['count']} "
            f"max_abs={result['max_abs_error']:.3e} max_rel={result['max_rel_error']:.3e}"
        )
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
