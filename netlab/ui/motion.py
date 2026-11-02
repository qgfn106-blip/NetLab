"""轻量动效工具：只用 Qt 自带的动画类，不引额外依赖。

设计约束（spec C7）：
- 不引入 QML / 第三方动画库，全部走 ``QPropertyAnimation`` / ``QVariantAnimation``。
- 用户可在「视图 → 动效」里关掉；关掉后所有函数立刻落到终态，不留残余 effect。
- 动画只做「过渡」，不做「装饰」：时长 120–220ms，OutCubic，避免拖慢交互。
"""

from __future__ import annotations

from typing import Callable

from PySide6.QtCore import QEasingCurve, QObject, QPropertyAnimation, QTimer
from PySide6.QtWidgets import QDockWidget, QGraphicsOpacityEffect, QWidget

#: 全局开关（由 shell 从 QSettings 恢复）
_ENABLED = True


def set_enabled(flag: bool) -> None:
    global _ENABLED
    _ENABLED = bool(flag)


def enabled() -> bool:
    return _ENABLED


def duration(base: int) -> int:
    """动效关闭时返回 0，让调用方直接落终态。"""
    return base if _ENABLED else 0


def fade_in(
    widget: QWidget,
    ms: int = 180,
    *,
    start: float = 0.0,
    end: float = 1.0,
    on_done: Callable[[], None] | None = None,
) -> QPropertyAnimation | None:
    """淡入一个控件；结束后摘掉 effect，避免常驻 QGraphicsEffect 拖慢重绘。"""
    if not _ENABLED or widget is None:
        if on_done:
            on_done()
        return None
    effect = QGraphicsOpacityEffect(widget)
    effect.setOpacity(start)
    widget.setGraphicsEffect(effect)
    anim = QPropertyAnimation(effect, b"opacity", widget)
    anim.setDuration(ms)
    anim.setStartValue(start)
    anim.setEndValue(end)
    anim.setEasingCurve(QEasingCurve.OutCubic)

    def _finish() -> None:
        widget.setGraphicsEffect(None)
        if on_done:
            on_done()

    anim.finished.connect(_finish)
    anim.start(QPropertyAnimation.DeleteWhenStopped)
    return anim


def slide_dock(dock: QDockWidget, show: bool, ms: int = 170) -> QPropertyAnimation | None:
    """展开/收起停靠面板：按面板形状决定动画维度（宽 / 高）。"""
    if dock is None:
        return None
    horizontal = dock.width() > dock.height() or dock.sizeHint().width() > dock.sizeHint().height()
    prop = b"maximumWidth" if horizontal else b"maximumHeight"
    target = (dock.sizeHint().width() if horizontal else dock.sizeHint().height()) or 320
    target = max(target, 240)
    if not _ENABLED:
        dock.setVisible(show)
        dock.setMaximumWidth(16777215)
        dock.setMaximumHeight(16777215)
        return None
    anim = QPropertyAnimation(dock, prop, dock)
    anim.setDuration(ms)
    anim.setEasingCurve(QEasingCurve.OutCubic)
    if show:
        dock.setVisible(True)
        dock.setMaximumWidth(0 if horizontal else 16777215)
        dock.setMaximumHeight(16777215 if horizontal else 0)
        anim.setStartValue(0)
        anim.setEndValue(target)
        anim.finished.connect(lambda: _release(dock, horizontal))
    else:
        start = dock.width() if horizontal else dock.height()
        anim.setStartValue(max(0, start))
        anim.setEndValue(0)
        anim.finished.connect(lambda: (dock.setVisible(False), _release(dock, horizontal)))
    anim.start(QPropertyAnimation.DeleteWhenStopped)
    return anim


def _release(dock: QDockWidget, horizontal: bool) -> None:
    dock.setMaximumWidth(16777215)
    dock.setMaximumHeight(16777215)


class Ramp:
    """把一个 0→1 的进度值按固定节奏推进，用于 hover / 选中脉冲这类自绘动效。

    自绘控件没有现成的属性可动画，这里用一个小定时器推进标量，
    调用方在 paintEvent 里读 ``value``。
    """

    def __init__(self, owner: QWidget, *, step_ms: int = 16, speed: float = 0.18) -> None:
        self.value = 0.0
        self.target = 0.0
        self.speed = speed
        self._timer = QTimer()
        if isinstance(owner, QObject):  # 自绘控件做父对象，随控件一起销毁
            self._timer.setParent(owner)
        self._timer.setInterval(step_ms)
        self._timer.timeout.connect(self._tick)
        self._owner = owner

    def to(self, target: float) -> None:
        self.target = max(0.0, min(1.0, target))
        if not _ENABLED:
            self.value = self.target
            self._owner.update()
            return
        if abs(self.value - self.target) < 1e-3:
            self.value = self.target
            self._owner.update()
            return
        if not self._timer.isActive():
            self._timer.start()

    def _tick(self) -> None:
        delta = self.target - self.value
        if abs(delta) < 0.02:
            self.value = self.target
            self._timer.stop()
        else:
            self.value += delta * self.speed
        self._owner.update()
