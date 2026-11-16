"""COMP-02：检查点必须完整回滚功率电子/电机子类的状态缓存属性。

Thyristor/Igbt/Jfet/Relay 用 ``self.on``、DcMotor 用 ``self.speed`` 作快路径
缓存（以 ``self.state`` 为镜像）。旧 ``capture_checkpoint``/``restore_checkpoint``
只保存并恢复 ``element.state``，不恢复这些缓存属性，于是
``operating_point()``/``ac_sweep()`` 提交（commit 写 ``self.on``/``self.speed``）
后，``finally restore_checkpoint`` 虽回滚了 ``state``，缓存却停留在工作点结果，
泄漏到后续瞬态，导致「先跑 op/ac 再跑瞬态」与「独立瞬态」逐点不一致。

这些用例在修复前应 RED（缓存未回滚），修复后 GREEN。
"""

from __future__ import annotations

import pytest

from netlab.core.compute.nodal import CircuitNode, CircuitSolver
from netlab.core.compute.powerelectronics import DcMotor, Relay, Thyristor


def _nodes() -> list[CircuitNode]:
    return [
        CircuitNode(id="n1", name="n1"),
        CircuitNode(id="gnd", name="gnd", ground=True),
    ]


def _solver(element) -> CircuitSolver:
    return CircuitSolver(_nodes(), [element])


@pytest.mark.parametrize(
    "make, attr, value",
    [
        (lambda: Thyristor(name="T1", a="n1", b="gnd", params={}, state={}), "on", True),
        (lambda: Relay(name="RL1", a="n1", b="gnd", params={}, state={}), "on", True),
        (lambda: DcMotor(name="M1", a="n1", b="gnd", params={}, state={}), "speed", 12.5),
    ],
)
def test_checkpoint_restores_cached_subclass_state(make, attr, value) -> None:
    element = make()
    solver = _solver(element)
    # 模拟 commit 后的状态：缓存与 state 镜像都为该值
    setattr(element, attr, value)
    element.state[attr] = value

    checkpoint = solver.capture_checkpoint()

    # 继续推进把缓存污染成反值（state 同步被改，模拟另一段推进）
    polluted = (not value) if isinstance(value, bool) else 0.0
    setattr(element, attr, polluted)
    element.state[attr] = polluted

    solver.restore_checkpoint(checkpoint)

    assert getattr(element, attr) == value, f"{attr} 缓存未随检查点回滚"
    assert element.state[attr] == value


def test_checkpoint_restores_cache_even_when_state_absent() -> None:
    """op/ac_sweep 场景：新元件 state 尚无该键（仅缓存有默认值）。

    capture 发生在 commit 之前（``on=False``、``state`` 无 ``on`` 键），
    随后 commit 把 ``self.on`` 置 True；restore 必须把缓存恢复为 False。
    """
    element = Thyristor(name="T1", a="n1", b="gnd", params={}, state={})
    solver = _solver(element)
    assert element.on is False
    assert "on" not in element.state

    checkpoint = solver.capture_checkpoint()

    # 模拟 operating_point()/ac_sweep() 内部 commit 打开晶闸管（仅改缓存/随后 state）
    element.on = True

    solver.restore_checkpoint(checkpoint)

    assert element.on is False, "检查点未把 on 缓存回滚到 pre-commit 的 False"
