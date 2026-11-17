"""D-4 端到端验收：二阶欠阻尼控制系统的一条命令实验。

流程：建工程 -> 连线 -> 仿真 -> 对照解析解 -> 输出 CSV/SVG 与误差表。
默认输出到临时目录；传入 --out 则输出到指定目录。
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BUDGET_PATH = ROOT / "docs" / "e2e_control_budget.json"
DEFAULT_BUDGET = {
    "final_abs": 0.02,
    "overshoot_pp": 2.5,
    "settling_2pct_s": 0.5,
    "max_abs_tracking": 0.08,
    "rmse_tracking": 0.03,
    "integral_abs_error": 0.2,
    "feedback_delay_s": 0.02,
    "sampling_jitter_s": 1e-9,
}

from netlab.core.compute.simulation import Simulation
from netlab.core.model.project import load_project, save_project
from netlab.core.model.scene import Scene


def load_budget(path: Path | None = None) -> dict[str, float]:
    """加载误差预算；文件缺失回退内置阈值，文件键必须完整。"""
    if path is None:
        path = DEFAULT_BUDGET_PATH
    if not path.is_file():
        return dict(DEFAULT_BUDGET)
    raw = json.loads(path.read_text(encoding="utf-8"))
    values = raw.get("budget", raw)
    missing = set(DEFAULT_BUDGET) - set(values)
    if missing:
        raise ValueError(f"误差预算缺少字段: {sorted(missing)}")
    return {key: float(values[key]) for key in DEFAULT_BUDGET}


def build_scene(plant_scale: float = 1.0) -> tuple[Scene, object]:
    """G(s)=4/(s(s+1.2)) 单位负反馈，ωn=2、ζ=0.3；plant_scale 用于变异体反证。"""
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
            "expr": f"{4.0 * plant_scale:g}/(s^2+1.2*s)",
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


def write_csv(
    path: Path,
    times: list[float],
    values: list[float],
    analytic: list[float],
) -> None:
    """全轨迹落盘：时间、实测输出、解析参考、绝对误差。"""
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["time_s", "plant_value", "analytic_value", "abs_error"])
        writer.writerows(
            (time_value, value, reference, abs(value - reference))
            for time_value, value, reference in zip(times, values, analytic)
        )


def write_svg(path: Path, times: list[float], values: list[float]) -> None:
    """用 PlotKit 真实渲染管线出图，线宽取绘图语义单一真源。"""
    from netlab.contracts import PLOT_LINE_WIDTH
    import plotkit as pk

    pk.quick(
        times,
        values,
        title="D-4 二阶欠阻尼阶跃响应",
        xlabel="time (s)",
        ylabel="output",
        path=path,
        fmt="svg",
        style={"width": PLOT_LINE_WIDTH, "color": "#1f77b4"},
    )


def write_plot_spec(path: Path, times: list[float], values: list[float]) -> None:
    """写一份符合 canonical plot_spec 的图层描述（与老 canvas/PlotKit 共用语义）。"""
    from netlab.contracts import PLOT_LINE_WIDTH, PLOT_TIME_FIELD, PLOT_VALUE_FIELD

    spec = {
        "spec_version": "0.1",
        "figure": {"title": "D-4 二阶欠阻尼阶跃响应"},
        "layers": [
            {
                "kind": "line",
                "data": {PLOT_TIME_FIELD: times, PLOT_VALUE_FIELD: values},
                "style": {"width": PLOT_LINE_WIDTH},
            }
        ],
    }
    path.write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")


def _head() -> str:
    value = os.environ.get("GITHUB_SHA")
    if value:
        return value
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"



def analytic_step_response(time_value: float, zeta: float = 0.3, omega_n: float = 2.0) -> float:
    """G(s)=4/(s(s+1.2)) 单位负反馈的闭式阶跃响应。"""
    if time_value <= 0.0:
        return 0.0
    omega_d = omega_n * math.sqrt(1.0 - zeta * zeta)
    phi = math.acos(zeta)
    return 1.0 - (
        math.exp(-zeta * omega_n * time_value)
        / math.sqrt(1.0 - zeta * zeta)
        * math.sin(omega_d * time_value + phi)
    )


def metrics(
    values: list[float],
    times: list[float],
    *,
    feedback_delay_s: float = 0.0,
) -> dict[str, float]:
    """误差预算：不只看 final，还覆盖全轨迹、积分误差、延迟与采样抖动。"""
    analytic = [analytic_step_response(time_value) for time_value in times]
    errors = [value - reference for value, reference in zip(values, analytic)]
    final = sum(values[-max(3, len(values) // 10):]) / max(3, len(values) // 10)
    peak_index = max(range(len(values)), key=values.__getitem__) if values else 0
    peak = values[peak_index] if values else float("nan")
    peak_time = times[peak_index] if times else float("nan")
    overshoot = (peak - final) / abs(final) * 100.0 if final else float("nan")
    band = 0.02 * 1.0
    settled_at = times[-1] if times else 0.0
    entered_band = False
    for index in range(len(values) - 1, -1, -1):
        if abs(values[index] - 1.0) > band:
            entered_band = index < len(values) - 1
            settled_at = times[index] if entered_band else times[-1]
            break
    if not entered_band and all(abs(value - 1.0) <= band for value in values):
        settled_at = 0.0
    differences = [later - earlier for earlier, later in zip(times, times[1:])]
    nominal_dt = sum(differences) / len(differences) if differences else 0.0
    jitter = max((abs(item - nominal_dt) for item in differences), default=0.0)
    sampling_dt = nominal_dt or 1.0
    absolute_errors = [abs(item) for item in errors]
    return {
        "final": final,
        "peak": peak,
        "peak_time_s": peak_time,
        "overshoot_pct": overshoot,
        "settling_2pct_s": settled_at,
        "max_abs_tracking_error": max(absolute_errors),
        "mean_abs_tracking_error": sum(absolute_errors) / len(absolute_errors),
        "rmse_tracking": math.sqrt(sum(item * item for item in errors) / len(errors)),
        "integral_abs_error": sum(absolute_errors) * sampling_dt,
        "feedback_delay_s": feedback_delay_s,
        "sampling_jitter_s": jitter,
        "samples": float(len(values)),
        "duration_s": times[-1],
    }


def budget_rows(
    measured: dict[str, float],
    analytic: dict[str, float],
    budget: dict[str, float],
) -> list[tuple[str, float, float, float, str]]:
    return [
        ("final", measured["final"], analytic["final"], budget["final_abs"], "abs"),
        ("overshoot_pct", measured["overshoot_pct"], analytic["overshoot_pct"], budget["overshoot_pp"], "pp"),
        ("settling_2pct_s", measured["settling_2pct_s"], analytic["settling_2pct_s"], budget["settling_2pct_s"], "s"),
        ("max_abs_tracking", measured["max_abs_tracking_error"], 0.0, budget["max_abs_tracking"], "abs"),
        ("rmse_tracking", measured["rmse_tracking"], 0.0, budget["rmse_tracking"], "abs"),
        ("integral_abs_error", measured["integral_abs_error"], 0.0, budget["integral_abs_error"], "abs*s"),
        ("feedback_delay_s", measured["feedback_delay_s"], analytic["feedback_delay_s"], budget["feedback_delay_s"], "s"),
        ("sampling_jitter_s", measured["sampling_jitter_s"], 0.0, budget["sampling_jitter_s"], "s"),
    ]


def write_error_table(
    path: Path,
    measured: dict[str, float],
    analytic: dict[str, float],
    budget: dict[str, float],
) -> bool:
    table = []
    ok = True
    for name, actual, expected, limit, unit in budget_rows(measured, analytic, budget):
        error = abs(actual - expected)
        passed = error <= limit
        ok = ok and passed
        table.append({
            "metric": name,
            "measured": actual,
            "analytic": expected,
            "error": error,
            "limit": limit,
            "unit": unit,
            "pass": passed,
        })
    payload = {
        "env": {"python": os.sys.version.split()[0], "platform": os.sys.platform},
        "head": _head(),
        "budget": budget,
        "metrics": measured,
        "rows": table,
        "pass": ok,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return ok


def print_error_table(
    measured: dict[str, float],
    analytic: dict[str, float],
    budget: dict[str, float],
) -> bool:
    rows = budget_rows(measured, analytic, budget)
    print("\n=== D-4 second-order control error table ===")
    print(f"{'metric':<24} {'measured':>12} {'analytic':>12} {'error':>10} {'limit':>8} {'pass':>5}")
    ok = True
    for name, actual, expected, limit, unit in rows:
        error = abs(actual - expected)
        passed = error <= limit
        ok = ok and passed
        print(f"{name:<24} {actual:12.4f} {expected:12.4f} {error:10.4f} {limit:8.2f} {str(passed):>5}")
    print("=== end ===\n")
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "reports" / "e2e", help="output directory")
    parser.add_argument("--steps", type=int, default=1200, help="simulation steps")
    parser.add_argument("--dt", type=float, default=0.01, help="time step in seconds")
    parser.add_argument("--plant-scale", type=float, default=1.0, help="plant gain scale (mutation testing)")
    parser.add_argument("--budget", type=Path, default=DEFAULT_BUDGET_PATH, help="error budget JSON")
    args = parser.parse_args()
    if args.steps <= 0 or args.dt <= 0:
        parser.error("--steps and --dt must be positive")
    out_dir = args.out or Path(tempfile.mkdtemp(prefix="netlab-e2e-control-"))
    out_dir.mkdir(parents=True, exist_ok=True)

    scene, plant = build_scene(args.plant_scale)
    times: list[float] = []
    values: list[float] = []
    for _index in range(args.steps):
        scene.step(args.dt)
        times.append(float(scene.clock.time))
        values.append(float(plant.data["value"]))
    analytic_values = [analytic_step_response(time_value) for time_value in times]

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
    write_csv(csv_path, times, values, analytic_values)
    write_svg(svg_path, times, values)
    write_plot_spec(out_dir / "plot_spec.json", times, values)

    zeta = 0.3
    omega_n = 2.0
    analytic = {
        "final": 1.0,
        "overshoot_pct": math.exp(-math.pi * zeta / math.sqrt(1 - zeta**2)) * 100.0,
        "settling_2pct_s": 4.0 / (zeta * omega_n),
        "feedback_delay_s": 0.0,
    }
    budget = load_budget(args.budget)
    measured = metrics(values, times, feedback_delay_s=args.dt)
    (out_dir / "trajectory.json").write_text(
        json.dumps(
            {
                "time_s": times,
                "plant_value": values,
                "analytic_value": analytic_values,
                "abs_error": [abs(value - reference) for value, reference in zip(values, analytic_values)],
                "metrics": measured,
                "budget": budget,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    ok = print_error_table(measured, analytic, budget)
    ok = write_error_table(out_dir / "error_table.json", measured, analytic, budget) and ok
    print(f"project: {project_path}")
    print(f"csv:     {csv_path}")
    print(f"svg:     {svg_path}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
