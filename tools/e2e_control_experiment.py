"""D-4 端到端验收：二阶欠阻尼控制系统的一条命令实验。

流程：建工程 -> 连线 -> 仿真 -> 对照解析解 -> 输出 CSV/SVG 与误差表。
默认输出到临时目录；传入 --out 则输出到指定目录。
"""

from __future__ import annotations

import argparse
import csv
import math
import tempfile
from pathlib import Path

from netlab.core.compute.simulation import Simulation
from netlab.core.model.project import load_project, save_project
from netlab.core.model.scene import Scene


def build_scene() -> tuple[Scene, object]:
    """G(s)=4/(s(s+1.2)) 单位负反馈，ωn=2、ζ=0.3。"""
    scene = Scene("signal")
    reference = scene.add_node(
        name="reference",
        kind="signal",
        params={
            "field": "value",
            "wave": "step",
            "offset": 0.0,
            "amplitude": 1.0,
            "delay": 0.0,
        },
    )
    error = scene.add_node(
        name="error",
        kind="sum",
        params={
            "field": "value",
            "output": "value",
            "weights": {"ref": 1.0, "feedback": 1.0},
        },
    )
    plant = scene.add_node(
        name="plant",
        kind="transfer_function",
        params={
            "form": "expr",
            "expr": "4/(s^2+1.2*s)",
            "method": "zoh",
            "field": "value",
            "output": "value",
        },
    )
    scene.add_edge(name="ref", source=reference.id, target=error.id, kind="pass")
    scene.add_edge(name="forward", source=error.id, target=plant.id, kind="pass")
    scene.add_edge(
        name="feedback",
        source=plant.id,
        target=error.id,
        kind="scale",
        params={"gain": -1.0},
        auto_delay=True,
    )
    return scene, plant


def write_csv(path: Path, times: list[float], values: list[float]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["time_s", "plant_value"])
        writer.writerows(zip(times, values))


def write_svg(path: Path, times: list[float], values: list[float]) -> None:
    """不依赖绘图库，生成可直接打开的 step response SVG。"""
    width, height = 900, 360
    left, top, right, bottom = 70, 30, 30, 50
    x_span = max(times) - min(times) or 1.0
    y_min = min(0.0, min(values))
    y_max = max(1.05, max(values) * 1.05)
    y_span = y_max - y_min or 1.0

    def px(t: float) -> float:
        return left + (t - min(times)) / x_span * (width - left - right)

    def py(v: float) -> float:
        return height - bottom - (v - y_min) / y_span * (height - top - bottom)

    points = " ".join(f"{px(t):.2f},{py(v):.2f}" for t, v in zip(times, values))
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <rect width="100%" height="100%" fill="white"/>
  <line x1="{left}" y1="{height-bottom}" x2="{width-right}" y2="{height-bottom}" stroke="#333"/>
  <line x1="{left}" y1="{top}" x2="{left}" y2="{height-bottom}" stroke="#333"/>
  <text x="{width/2:.0f}" y="{height-12}" text-anchor="middle" font-family="sans-serif" font-size="13">time (s)</text>
  <text x="14" y="{height/2:.0f}" text-anchor="middle" font-family="sans-serif" font-size="13" transform="rotate(-90 14 {height/2:.0f})">output</text>
  <line x1="{left}" y1="{py(1.0):.2f}" x2="{width-right}" y2="{py(1.0):.2f}" stroke="#999" stroke-dasharray="5 4"/>
  <polyline points="{points}" fill="none" stroke="#1f77b4" stroke-width="2"/>
  <text x="{left+8}" y="{py(1.0)-8:.2f}" font-family="sans-serif" font-size="12" fill="#555">target = 1.0</text>
</svg>
"""
    path.write_text(svg, encoding="utf-8")


def metrics(values: list[float], dt: float) -> dict[str, float]:
    final = sum(values[-max(3, len(values) // 10):]) / max(3, len(values) // 10)
    peak = max(values)
    overshoot = (peak - final) / abs(final) * 100.0 if final else float("nan")
    # 2% settling band, last sample outside band then settle index.
    band = 0.02 * abs(final)
    settled_at = 0.0
    for index in range(len(values) - 1, -1, -1):
        if abs(values[index] - final) > band:
            settled_at = (index + 1) * dt
            break
    return {
        "final": final,
        "peak": peak,
        "overshoot_pct": overshoot,
        "settling_2pct_s": settled_at,
    }


def print_error_table(measured: dict[str, float], analytic: dict[str, float]) -> bool:
    rows = [
        ("final value", measured["final"], analytic["final"], 1.0, "abs"),
        ("overshoot %", measured["overshoot_pct"], analytic["overshoot_pct"], 2.0, "pp"),
        ("settling 2pct s", measured["settling_2pct_s"], analytic["settling_2pct_s"], 2.5, "s"),
    ]
    print("\n=== D-4 second-order control error table ===")
    print(f"{'metric':<18} {'measured':>12} {'analytic':>12} {'error':>10} {'limit':>8} {'pass':>5}")
    ok = True
    for name, actual, expected, limit, unit in rows:
        error = abs(actual - expected)
        passed = error <= limit
        ok = ok and passed
        print(f"{name:<18} {actual:12.4f} {expected:12.4f} {error:10.4f} {limit:8.2f} {str(passed):>5}")
    print("=== end ===\n")
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=None, help="output directory")
    parser.add_argument("--steps", type=int, default=1200, help="simulation steps")
    parser.add_argument("--dt", type=float, default=0.01, help="time step in seconds")
    args = parser.parse_args()
    if args.steps <= 0 or args.dt <= 0:
        parser.error("--steps and --dt must be positive")
    out_dir = args.out or Path(tempfile.mkdtemp(prefix="netlab-e2e-control-"))
    out_dir.mkdir(parents=True, exist_ok=True)

    scene, plant = build_scene()
    times: list[float] = []
    values: list[float] = []
    for index in range(args.steps):
        scene.step(args.dt)
        times.append((index + 1) * args.dt)
        values.append(float(plant.data["value"]))

    project_path = out_dir / "underdamped_control.netlab"
    sim = Simulation(scene)
    try:
        save_project(project_path, sim, name="欠阻尼二阶控制", network_name="信号流")
    finally:
        sim.shutdown()
    project = load_project(project_path)
    if not project.get("checksum"):
        raise RuntimeError("project checksum missing")

    csv_path = out_dir / "step_response.csv"
    svg_path = out_dir / "step_response.svg"
    write_csv(csv_path, times, values)
    write_svg(svg_path, times, values)

    zeta = 0.3
    omega_n = 2.0
    analytic = {
        "final": 1.0,
        "overshoot_pct": math.exp(-math.pi * zeta / math.sqrt(1 - zeta**2)) * 100.0,
        "settling_2pct_s": 4.0 / (zeta * omega_n),
    }
    measured = metrics(values, args.dt)
    ok = print_error_table(measured, analytic)
    print(f"project: {project_path}")
    print(f"csv:     {csv_path}")
    print(f"svg:     {svg_path}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
