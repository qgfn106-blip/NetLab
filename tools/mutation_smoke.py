#!/usr/bin/env python3
"""G2 层 F 变异烟雾测试：少量源码变异体必须被 evals 测试杀死。

用法：python tools/mutation_smoke.py [--threshold 0.6]
只做 smoke（6 个变异体），不是完整变异测试；每次变异后恢复原文件字节。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ELEMENTS = ROOT / "netlab/core/compute/circuit/elements.py"

MUTANTS = [
    ("resistor-gain-5pct", ELEMENTS, 'self.conductance = 1.0 / float(self.params["R"])', 'self.conductance = 1.05 / float(self.params["R"])'),
    ("capacitor-trap-coeff", ELEMENTS, "self.conductance = 2.0 * cache / dt", "self.conductance = 1.8 * cache / dt"),
    ("inductor-trap-coeff", ELEMENTS, "self.conductance = dt / (2.0 * self.inductance)", "self.conductance = dt / (1.8 * self.inductance)"),
    ("source-gain-2pct", ELEMENTS, "self.value = waveform_value(self.params, time)", "self.value = 1.02 * waveform_value(self.params, time)"),
    ("capacitor-value-5pct", ELEMENTS, "cache = self.capacitance", "cache = 1.05 * self.capacitance"),
    ("inductor-history-sign", ELEMENTS, "self.source_current = previous_i + self.conductance * previous_v", "self.source_current = previous_i - self.conductance * previous_v"),
]


def run_tests() -> int:
    return subprocess.run(
        [sys.executable, "-m", "pytest", "netlab/tests/evals", "-q", "--tb=no", "-p", "no:cacheprovider"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ).returncode


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--threshold", type=float, default=0.6)
    args = parser.parse_args()
    results = []
    for name, path, old, new in MUTANTS:
        original = path.read_bytes()
        text = original.decode("utf-8")
        if text.count(old) == 0:
            print(f"SKIP {name}: pattern not found")
            results.append({"mutant": name, "killed": False, "note": "pattern-not-found"})
            continue
        try:
            path.write_bytes(text.replace(old, new).encode("utf-8"))
            killed = run_tests() != 0
        finally:
            path.write_bytes(original)
        results.append({"mutant": name, "killed": killed})
        print(f"{'KILLED' if killed else 'SURVIVED'} {name}")
    killed = sum(1 for r in results if r["killed"])
    score = killed / len(results) if results else 0.0
    print(json.dumps({"killed": killed, "total": len(results), "score": round(score, 3)}, ensure_ascii=False))
    if score < args.threshold:
        print(f"FAIL: mutation score {score:.3f} < {args.threshold:.3f}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
