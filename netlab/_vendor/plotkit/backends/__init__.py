"""后端层：注册表 + matplotlib 后端（D33：plotly 已退役）。"""

from . import mpl_backend  # noqa: F401 - import 即注册基础图层
from .registry import LAYER_SPECS, LayerSpec, describe, kinds, register, resolve

__all__ = ["LAYER_SPECS", "LayerSpec", "register", "resolve", "kinds", "describe"]
