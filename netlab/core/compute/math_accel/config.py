"""数学加速器开关（R43/P3）。

环境变量：``NETLAB_MATH_ACCEL=off|shadow|on``，默认 ``off``。
也支持组件级覆盖：``NETLAB_MATH_ACCEL_P3=on`` 优先于全局值。
非法值回退 ``off``，绝不因配置错误改变默认行为。
"""

from __future__ import annotations

import logging
import os

MODES = ("off", "shadow", "on")
DEFAULT_MODE = "off"
_LOGGER = logging.getLogger(__name__)


def math_accel_mode(component: str | None = None) -> str:
    """读取数学加速器模式。"""
    key = f"NETLAB_MATH_ACCEL_{component}" if component else "NETLAB_MATH_ACCEL"
    raw = os.environ.get(key) or os.environ.get("NETLAB_MATH_ACCEL", DEFAULT_MODE)
    mode = str(raw).strip().lower()
    if mode not in MODES:
        _LOGGER.warning("NETLAB_MATH_ACCEL 取值非法%r，已回退 off", raw)
        return DEFAULT_MODE
    return mode


def component_enabled(component: str) -> bool:
    """组件是否至少处于 shadow（用于诊断记录）。"""
    return math_accel_mode(component) in ("shadow", "on")
