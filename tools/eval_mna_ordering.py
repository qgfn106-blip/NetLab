"""P1：在真实 MyProject 电路工程上评测 MNA 稀疏排序（R43/M1a）。

只读脚本：不修改工程、不触碰求解器；输出 Markdown + CSV 报告。
用法（在 NetlabHome 下）：python tools/eval_mna_ordering.py
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from netlab.core.compute.math_accel.ordering_eval import (
    evaluate_corpus,
    evaluate_matrix,
)  # noqa: E402

CORPUS_DIR = PROJECT_ROOT / "MyProject"
OUT_DIR = PROJECT_ROOT.parent / "mathspec" / "research"


def synthetic_cases() -> list[tuple[str, object]]:
    """固定种子的电路状稀疏矩阵（补充证据，不计入真实矩阵 DoD）。"""
    import numpy as np
    from scipy import sparse

    cases = []
    rng = np.random.default_rng(7)
    for n in (100, 200, 400):
        rows = list(range(n))
        cols = list(range(n))
        vals = [1.0] * n
        for i in range(n):
            for _ in range(2):
                j = int(rng.integers(0, n - 1))
                if j >= i:
                    j += 1
                rows += [i, j]
                cols += [j, i]
                vals += [-1.0, -1.0]
        matrix = sparse.csc_matrix((vals, (rows, cols)), shape=(n, n), dtype=complex)
        matrix = matrix + sparse.eye(n, format="csc", dtype=complex)
        cases.append((f"synthetic-{n}", matrix))
    return cases


def main() -> int:
    rows: list[dict[str, object]] = []
    skipped: list[str] = []
    for path in sorted(CORPUS_DIR.glob("*.netlab")):
        try:
            rows.extend(evaluate_corpus([path], repeats=3))
        except ValueError:
            skipped.append(path.name)
    if not rows:
        print("没有可评测的 circuit 工程", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = OUT_DIR / "P1_ORDERING_RESULTS.csv"
    fieldnames = [
        "file",
        "network",
        "nodes",
        "edges",
        "n",
        "nnz",
        "name",
        "nnz_factor",
        "fill_ratio",
        "factor_ms",
        "solve_ms",
        "peak_kb",
        "rel_residual",
        "ok",
        "note",
    ]
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fieldnames})

    by_file: dict[str, list[dict[str, object]]] = {}
    for row in rows:
        by_file.setdefault(str(row["file"]), []).append(row)

    lines = [
        "# P1 真实 MNA 矩阵排序评测报告（R43/M1a）",
        "",
        "> 只读评测：`netlab/core/compute/math_accel/ordering_eval.py` + `tools/eval_mna_ordering.py`。",
        "> 排序候选：COLAMD（现状）/ MMD_ATA / MMD_AT_PLUS_A / NATURAL / RCM / MIN_DEGREE / NESTED_DISSECTION。",
        "",
        "| 工程 | 网络 | n | nnz | 基线 COLAMD factor(ms) | 最佳候选 | 最佳 factor(ms) | factor 比 | fill 比 | 结论 |",
        "|---|---|---:|---:|---:|---|---:|---:|---:|---|",
    ]
    verdict_lines: list[str] = []
    for file_name, group in sorted(by_file.items()):
        base = next((item for item in group if item["name"] == "COLAMD"), group[0])
        candidates = [item for item in group if item["name"] != "COLAMD" and item["ok"]]
        best = min(candidates, key=lambda item: float(item["factor_ms"]))
        factor_ratio = float(best["factor_ms"]) / max(1e-9, float(base["factor_ms"]))
        fill_ratio = float(best["fill_ratio"]) / max(1e-9, float(base["fill_ratio"]))
        passed = factor_ratio <= 0.85 or fill_ratio <= 0.80
        verdict = "达标" if passed else "未达标"
        lines.append(
            f"| {file_name} | {base['network']} | {base['n']} | {base['nnz']} | "
            f"{float(base['factor_ms']):.3f} | {best['name']} | {float(best['factor_ms']):.3f} | "
            f"{factor_ratio:.3f}× | {fill_ratio:.3f}× | {verdict} |"
        )
        verdict_lines.append(
            f"- {file_name}：最佳 `{best['name']}`，factor {factor_ratio:.3f}×、fill {fill_ratio:.3f}×，{verdict}"
        )
    synthetic_lines = [
        "",
        "## 合成补充证据（不计入真实矩阵 DoD）",
        "",
        "| 用例 | n | COLAMD factor(ms) | 最佳候选 | 最佳 factor(ms) | factor 比 | fill 比 |",
        "|---|---:|---:|---|---:|---:|---:|",
    ]
    for label, matrix in synthetic_cases():
        synthetic_results = evaluate_matrix(matrix, repeats=3)
        base = next(item for item in synthetic_results if item.name == "COLAMD")
        best = min(
            (item for item in synthetic_results if item.name != "COLAMD" and item.ok),
            key=lambda item: float(item.factor_ms),
        )
        synthetic_lines.append(
            f"| {label} | {base.n} | {float(base.factor_ms):.3f} | {best.name} | "
            f"{float(best.factor_ms):.3f} | "
            f"{float(best.factor_ms) / max(1e-9, float(base.factor_ms)):.3f}× | "
            f"{float(best.fill_ratio) / max(1e-9, float(base.fill_ratio)):.3f}× |"
        )
    passed_real = sum(
        1 for item in verdict_lines if "达标" in item and "未达标" not in item
    )
    lines += [
        *synthetic_lines,
        "",
        "## 判定",
        "",
        "- DoD：至少两类真实 circuit 矩阵 factor 时间下降 ≥15%（比 ≤0.85）或 fill-in 下降 ≥20%（比 ≤0.80）。",
        *verdict_lines,
        f"- 真实矩阵达标数：{passed_real} / {len(by_file)}；**P1 总体结论：未通过 DoD，生产路径保持 COLAMD（仅保留只读评测器与合成证据）**。",
        f"- 无 circuit 场景而跳过的工程：{', '.join(skipped) if skipped else '无'}",
        "",
        f"原始逐排序数据：`{csv_path.name}`",
    ]
    md_path = OUT_DIR / "P1_ORDERING_REPORT.md"
    md_path.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))
    print(f"\n已写入 {md_path} 与 {csv_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
