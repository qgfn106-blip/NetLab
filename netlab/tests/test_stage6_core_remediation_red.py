"""阶段 6 / 第一批整改：#7 / #3 / #2 的回归测试（红测已转绿）。

对应 ``netlab/docs/CORE_CODE_REMEDIATION_DESIGN.md`` 的 §7 / §3 / §2。
2026-11-13 已按依赖序 7→3→2 落地最小生产代码修复，原 ``xfail(strict=True)``
标记全部移除，用例现为正常回归测试（转绿即通过）：

* #7 ``scene_types.is_known_mode`` 首行加 ``if not isinstance(mode, str): return False``。
* #3 ``solver.py`` source stepping 末次 ``_newton_solve`` 补 ``deadline=deadline``。
* #2 ``capture_checkpoint`` 增 ``"startup_pending"``、``restore_checkpoint`` 恢复之。
* 断言保持全强度（不降低、不放宽）；#3 仅 stub ``_newton_solve`` 的收敛返回值
  以驱动策略分支，被测对象仍是生产方法 ``_newton_with_strategies`` 本身
  （不使用 Fake Runtime 冒充仿真运行时）。
"""
from __future__ import annotations

import time

import numpy as np
import pytest

from netlab.core.compute.nodal import CircuitNode, CircuitSolver, Diode
from netlab.core.model.scene_types import is_known_mode


def _nodes():
    return [
        CircuitNode(id="n1", name="n1"),
        CircuitNode(id="gnd", name="gnd", ground=True),
    ]


def _diode(name: str = "D1") -> Diode:
    params = {"Is": 1e-14, "n": 1.0, "temperature": 300.0, "rs": 2.0}
    return Diode(name=name, a="n1", b="gnd", params=params, state={})


# --------------------------------------------------------------------------- #7
# scene_io.load_payload 经 is_known_mode 校验 mode；不可哈希的非法 mode
# 应友好返回 False（上层再抛 ValidationError），而不是抛原生 TypeError。
@pytest.mark.parametrize("bad", [["circuit"], {"mode": "circuit"}, {"circuit"}])
def test_7_is_known_mode_rejects_unhashable_without_typeerror(bad):
    assert is_known_mode(bad) is False


# --------------------------------------------------------------------------- #3
# source stepping 末次 _newton_solve（solver.py:471-473）漏传 deadline，
# 该次 Newton 不受时间预算约束。用 stub 记录每次调用收到的 deadline，
# 驱动完整策略分支后断言「所有调用都带同一个 deadline」——当前最后一次为 None。
def test_3_source_stepping_final_newton_receives_deadline(monkeypatch):
    solver = CircuitSolver(_nodes(), [_diode()])
    assert any(e.nonlinear for e in solver.elements), "前置条件：必须走非线性策略分支"
    deadline = time.perf_counter() + 60.0
    seen: list[float | None] = []

    def fake_newton(dt, gmin, initial, source_scale=1.0, *, mode="tran", deadline=None):
        seen.append(deadline)
        return np.array(initial, copy=True), 1, False, 1.0

    monkeypatch.setattr(solver, "_newton_solve", fake_newton)
    solver._newton_with_strategies(
        1e-3, np.zeros(len(solver.unknown_ids)), mode="tran", deadline=deadline
    )
    assert len(seen) >= 3, "应至少经过首解 / gmin / 末次 Newton 三次调用"
    assert all(d == deadline for d in seen), f"有 Newton 调用未收到 deadline：{seen}"


# --------------------------------------------------------------------------- #2
# capture_checkpoint（solver.py:271-280）未冻结 _startup_pending，
# restore_checkpoint（:282-305）也未恢复它 → 失败步回滚后保留被污染值。
def test_2_capture_checkpoint_freezes_startup_pending():
    solver = CircuitSolver(_nodes(), [_diode()])
    solver._startup_pending = False
    cp = solver.capture_checkpoint()
    assert cp.get("startup_pending") is False, "checkpoint 应冻结步首的 startup_pending"
    assert cp["startup_pending"] == solver._startup_pending


def test_2_restore_checkpoint_restores_startup_pending():
    solver = CircuitSolver(_nodes(), [_diode()])
    cp = solver.capture_checkpoint()
    cp["startup_pending"] = True  # 模拟修复后 capture 会产出的字段
    solver._startup_pending = False
    solver.restore_checkpoint(cp)
    assert solver._startup_pending is True, "restore 应把 startup_pending 回到步首值"
