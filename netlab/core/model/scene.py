"""场景层：把可序列化的节点/连接记录装配成可运行的仿真引擎。

信号模式使用 ``graph.Network``（字典沿有向边传播）；电路模式使用
``nodal.CircuitSolver``（节点电压法）。两种模式对外暴露相同的
``step / reset / probes / stats`` 接口，供仿真循环与 HTTP 层复用。
"""

from __future__ import annotations

import copy
import math
import re
import time
import uuid
from typing import Any

from .blocks import BlockRuntime, BlockStore
from .records import EdgeRecord, NodeRecord
from ..compute.clock import SimClock
from ..compute.computes import (
    compute_catalog,
    get_compute_spec,
    prepare_compute,
    solver_traits,
)
from .graph import Network, Node
from ..common.limits import (
    MAX_EDGES,
    MAX_FIELDS,
    MAX_NAME,
    MAX_NODES,
    ComputeError,
    ConflictError,
    LimitError,
    NotFoundError,
    ValidationError,
    as_float,
    check_id,
    check_name,
    json_safe,
)
from ..compute.methods import (
    get_method_spec,
    method_catalog,
    prepare_method,
)
from ..compute.nodal import (
    CircuitNode,
    CircuitSolver,
    create_element,
    create_element_from_pins,
    element_catalog,
    element_spec,
    integration_methods,
    node_catalog,
)
from ..compute.params import validate_params
from .ports import pins_for_device
from ..compute.profiling import timed

MODES = ("signal", "circuit", "vector")
MAX_POSITION = 10000.0
ROUTE_MODES = ("auto", "straight", "orthogonal", "manual")
ANCHOR_SIDES = ("auto", "left", "right", "top", "bottom")
MAX_WAYPOINTS = 64
MAX_NODE_SIZE = 200.0
MIN_NODE_SIZE = 24.0

#: 元素级外观覆盖（P-B）：可选、默认空；空表示完全沿用主题令牌与布局默认。
APPEARANCE_KEYS = ("color", "opacity", "lineWidth", "fontSize")
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def normalize_appearance(value: Any) -> dict[str, Any]:
    """校验并规范化元素级外观覆盖（P-B）。

    只接受 color/opacity/lineWidth/fontSize；``None`` 或空字典表示「无覆盖」。
    返回值只包含显式设置过的键，未设置的不出现在结果里（支持部分覆盖）。
    """
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValidationError("元素外观必须是对象")
    unknown = set(value) - set(APPEARANCE_KEYS)
    if unknown:
        raise ValidationError(f"元素外观包含未知字段：{', '.join(sorted(unknown))}")
    clean: dict[str, Any] = {}
    if "color" in value:
        color = value["color"]
        if not isinstance(color, str) or not _HEX_COLOR_RE.match(color):
            raise ValidationError("元素外观 color 必须是 #RRGGBB")
        clean["color"] = color.lower()
    if "opacity" in value:
        clean["opacity"] = as_float(value["opacity"], "元素外观 opacity", lo=0.05, hi=1.0)
    if "lineWidth" in value:
        clean["lineWidth"] = as_float(
            value["lineWidth"], "元素外观 lineWidth", lo=0.5, hi=12.0
        )
    if "fontSize" in value:
        clean["fontSize"] = as_float(
            value["fontSize"], "元素外观 fontSize", lo=6.0, hi=48.0
        )
    return clean


# ---- 引擎 ------------------------------------------------------------------
from .scene_engines import CircuitEngine, SignalEngine, _Engine
from .scene_channels import _SceneChannelsMixin


# ---- 场景 ------------------------------------------------------------------
class Scene(_SceneChannelsMixin):
    def __init__(self, mode: str = "signal") -> None:
        if mode not in MODES:
            from .engine_registry import ENGINE_SPECS

            if mode not in ENGINE_SPECS:
                raise ValidationError(f"未知模式：{mode!r}")
        self.mode = mode
        self.integration = "trapezoidal"
        self.solver_options = None
        #: One shared clock for every engine in this scene (A-3/N-05).
        self.clock = SimClock()
        #: R36/P2：信号流是否启用直接馈通 SCC 线性求解（默认关闭，保持旧行为；开关随工程持久化）。
        self.solve_algebraic = False
        self.nodes: dict[str, NodeRecord] = {}
        self.edges: dict[str, EdgeRecord] = {}
        # 功能块定义；BlockRuntime 的内部场景共享同一份定义表。
        self.blocks = BlockStore()
        # 功能块实例的运行时缓存：结构变化重建引擎时复用，内部 state 才不会丢。
        self.block_instances: dict[str, BlockRuntime] = {}
        self.block_depth = 0
        self.revision = 0
        self._engine: _Engine | None = None
        self._dirty = True
        self.last_step_ms = 0.0
        self._counter = 0

    # ---- 通用 -------------------------------------------------------------
    def _touch(self) -> None:
        self.revision += 1
        self._dirty = True

    def ensure_engine(self) -> _Engine:
        if self._engine is None or self._dirty:
            if self.mode not in MODES:
                from .engine_registry import create_engine

                self._engine = create_engine(self.mode, self)
            else:
                self._engine = (
                    CircuitEngine(self)
                    if self.mode == "circuit"
                    else SignalEngine(self)
                )
            self._dirty = False
        return self._engine

    def set_solver_options(self, options: object | None) -> None:
        """P0：更新求解器选项；下次 ensure_engine 时生效。"""
        self.solver_options = options
        self.revision += 1

    def set_algebraic_solver(self, enabled: bool) -> None:
        """R36/P2：开启/关闭信号流直接馈通 SCC 线性求解。"""
        self.solve_algebraic = bool(enabled)
        self._touch()
        self._dirty = True

    def capture_checkpoint(self) -> dict[str, Any]:
        engine = self.ensure_engine()
        return {"engine": engine, "state": engine.capture_checkpoint()}

    def rollback_last_step(self) -> None:
        """N-36：回滚最近一步的引擎事务，不再重建完整 Scene 深拷贝。"""
        engine = self.ensure_engine()
        rollback = getattr(engine, "rollback_last_step", None)
        if callable(rollback):
            rollback()

    def restore_checkpoint(self, checkpoint: dict[str, Any] | None) -> None:
        if not checkpoint:
            return
        engine = self.ensure_engine()
        state = checkpoint.get("state")
        if engine is checkpoint.get("engine") and state is not None:
            engine.restore_checkpoint(state)

    def _iter_source_params(self) -> list[dict[str, Any]]:
        """收集边源与器件节点源的参数（P0-09：器件节点也参与断点）。"""
        rows: list[dict[str, Any]] = []
        for edge in self.edges.values():
            if edge.enabled and edge.kind in ("vsource", "isource"):
                rows.append(edge.params or {})
        for record in self.nodes.values():
            if record.kind != "device":
                continue
            params = record.params or {}
            if str(params.get("element", "")) in ("vsource", "isource"):
                rows.append(params)
        return rows

    @staticmethod
    def _breakpoint_in(params: dict[str, Any], now: float, dt: float) -> float | None:
        wave = str(params.get("wave", "sine"))
        if wave == "dc":
            return None
        frequency = float(params.get("frequency", 0.0) or 0.0)
        delay = float(params.get("delay", 0.0) or 0.0)
        phase = float(params.get("phase", 0.0) or 0.0)
        eps = 1.0e-12
        candidates: list[float] = []
        # 延迟起点本身就是一次跳变（之前是 offset，之后按相位取值）。
        if delay > now + eps and delay <= now + dt + eps:
            candidates.append(delay)
        if wave in ("step", "ramp"):
            return min(candidates) if candidates else None
        if frequency <= 0.0:
            return min(candidates) if candidates else None
        if wave not in ("square", "pulse"):
            return min(candidates) if candidates else None
        period = 1.0 / frequency
        duty = min(0.99, max(0.01, float(params.get("duty", 0.5) or 0.5)))
        fractions = (0.5, 1.0) if wave == "square" else (duty, 1.0)
        cycles_now = (now - delay) * frequency + phase / 360.0
        base = int(math.floor(cycles_now))
        for cycle in (base - 1, base, base + 1):
            for fraction in fractions:
                point = delay + (cycle + fraction - phase / 360.0) * period
                if point > now + eps and point <= now + dt + eps:
                    candidates.append(point)
        return min(candidates) if candidates else None

    def next_breakpoint(self, now: float, dt: float) -> float | None:
        """P0/D48：返回 (now, now+dt] 内最近的波形跳变时刻（边源+器件源）。"""
        if dt <= 0.0:
            return None
        best: float | None = None
        for params in self._iter_source_params():
            point = self._breakpoint_in(params, now, dt)
            if point is not None:
                best = point if best is None else min(best, point)
        return best

    @timed("scene.step")
    def step(self, dt: float) -> dict[str, Any]:
        engine = self.ensure_engine()
        started = time.perf_counter()
        engine.step(dt)
        self.last_step_ms = (time.perf_counter() - started) * 1000.0
        stats = engine.stats()
        stats["step_ms"] = self.last_step_ms
        return stats

    def zero_time(self) -> None:
        """时间归零：引擎时间轴归零，节点数据/历史状态保留（R11/D14）。"""
        self.ensure_engine().zero_time()

    def reset(self) -> None:
        engine = self.ensure_engine()
        engine.reset()
        self.last_step_ms = 0.0


    # ---- 名称与参数 -------------------------------------------------------
    def _unique_node_name(self, name: str, *, ignore: str | None = None) -> None:
        for node_id, record in self.nodes.items():
            if node_id != ignore and record.name == name:
                raise ConflictError(f"节点名称 {name!r} 已存在")

    def _unique_edge_name(self, name: str, *, ignore: str | None = None) -> None:
        for edge_id, record in self.edges.items():
            if edge_id != ignore and record.name == name:
                raise ConflictError(f"连接名称 {name!r} 已存在")

    def _auto_edge_name(self, kind: str) -> str:
        while True:
            self._counter += 1
            candidate = f"{kind}-{self._counter}"
            if all(record.name != candidate for record in self.edges.values()):
                return candidate

    def next_node_name(self, base: str) -> str:
        """在现有节点名中生成唯一名称（保留可读前缀）。"""
        return self._unique_name(base, {record.name for record in self.nodes.values()})

    def next_edge_name(self, base: str) -> str:
        """在现有连接名中生成唯一名称。"""
        return self._unique_name(base, {record.name for record in self.edges.values()})

    @staticmethod
    def _unique_name(base: str, existing: set[str]) -> str:
        text = str(base or "").strip() or "item"
        if len(text) > MAX_NAME:
            text = text[:MAX_NAME]
        candidate = text
        index = 2
        while candidate in existing:
            suffix = f"_{index}"
            candidate = text[: MAX_NAME - len(suffix)] + suffix
            index += 1
        return candidate

    def _normalize_node_params(self, kind: str, raw: Any) -> tuple[dict[str, Any], str]:
        if self.mode in ("signal", "vector"):
            spec = get_compute_spec(kind)
            params = validate_params(list(spec.params), raw)
            # 只有 kind="block" 手动创建一定坏（没有 block_id）；module_input /
            # module_output 在模块内部场景里本来就不带 block_id，不能在这里拦。
            if kind == "block" and not str(params.get("block_id") or "").strip():
                raise ValidationError(
                    f"{spec.label}（kind={kind}）缺少 block_id，不能手动创建："
                    "功能块实例只能由模块库实例化或封装生成。"
                    "若这是打开旧工程时报的错，请删除该节点后用模块库重新实例化。"
                )
            return params, spec.label
        if kind == "device":
            return self._normalize_device_params(raw), "器件"
        if kind == "module":
            return self._normalize_module_params(raw), "电路模块"
        if kind not in ("node", "ground"):
            raise ValidationError(
                "电路模式的节点类型只能是 node、ground、device 或 module"
            )
        return self._normalize_net_params(raw), (
            "接地" if kind == "ground" else "电学节点"
        )

    def _normalize_net_params(self, raw: Any) -> dict[str, Any]:
        """网络节点可带端口标记（R24/D49）：这个名字/方向的网络就是模块端口。"""
        if raw in (None, {}):
            return {}
        if not isinstance(raw, dict):
            raise ValidationError("网络节点参数必须是对象")
        allowed = {"port_name", "port_direction", "port_note"}
        unknown = set(raw) - allowed
        if unknown:
            raise ValidationError(
                "网络节点只支持端口标记参数：" + ", ".join(sorted(allowed))
            )
        name = str(raw.get("port_name") or "").strip()
        direction = str(raw.get("port_direction") or "").strip()
        if direction and direction not in ("input", "output", "inout"):
            raise ValidationError("端口方向必须是 input / output / inout")
        if direction and not name:
            raise ValidationError("选了端口方向就要给端口名称")
        params: dict[str, Any] = {}
        if name:
            params["port_name"] = name[:32]
            params["port_direction"] = direction or "inout"
        if raw.get("port_note"):
            params["port_note"] = str(raw.get("port_note"))[:200]
        return params

    def _normalize_module_params(self, raw: Any) -> dict[str, Any]:
        """电路模块节点：只能由模块库实例化或封装生成（R24/D51）。"""
        if not isinstance(raw, dict):
            raise ValidationError("模块节点参数必须是对象")
        block_id = str(raw.get("block_id") or "").strip()
        if not block_id:
            raise ValidationError(
                "模块节点缺少 block_id，不能手动创建：电路模块只能由模块库实例化或封装生成"
            )
        ports = raw.get("ports")
        clean: list[dict[str, str]] = []
        if isinstance(ports, list):
            for item in ports:
                if not isinstance(item, dict):
                    raise ValidationError("模块端口必须是对象")
                name = str(item.get("name") or "").strip()
                direction = str(item.get("direction") or "inout")
                if not name:
                    raise ValidationError("模块端口缺少名称")
                if direction not in ("input", "output", "inout"):
                    raise ValidationError("模块端口方向必须是 input / output / inout")
                clean.append({"name": name[:32], "direction": direction})
        return {
            "block_id": block_id,
            "block_name": str(raw.get("block_name") or "")[:32],
            "ports": clean,
        }

    def _normalize_device_params(self, raw: Any) -> dict[str, Any]:
        """器件节点参数：``{"element": 元件 kind, ...元件参数}``。"""
        if not isinstance(raw, dict):
            raise ValidationError("器件节点参数必须是对象：{'element': 元件 kind, ...}")
        element = raw.get("element")
        if not isinstance(element, str) or not element:
            raise ValidationError("器件节点缺少 element（元件 kind）")
        try:
            spec = element_spec(element)
            pins_for_device(element)
        except (ComputeError, KeyError) as exc:
            raise ValidationError(f"器件节点元件不合法：{exc}") from exc
        payload = {key: value for key, value in raw.items() if key != "element"}
        params = validate_params(list(spec.params), payload)
        return {"element": element, **params}

    def _normalize_edge_params(self, kind: str, raw: Any) -> dict[str, Any]:
        if self.mode in ("signal", "vector"):
            spec = get_method_spec(kind)
            return validate_params(list(spec.params), raw)
        if kind == "wire":
            if raw not in (None, {}):
                raise ValidationError("导线没有参数")
            return {}
        spec = element_spec(kind)
        return validate_params(list(spec.params), raw)

    def _normalize_wire_pins(
        self,
        kind: str,
        source_id: str,
        target_id: str,
        source_pin: Any,
        target_pin: Any,
        nodes: dict[str, "NodeRecord"] | None = None,
    ) -> tuple[str, str]:
        """R20：导线只允许「器件引脚 ↔ 网络节点」，并校验引脚存在。"""
        node_map = self.nodes if nodes is None else nodes
        if kind != "wire":
            if source_pin or target_pin:
                raise ValidationError("只有导线（kind=wire）可以绑定引脚")
            return "", ""
        if self.mode != "circuit":
            raise ValidationError("导线（kind=wire）只用于电路模式")
        if not isinstance(source_pin, str) or not isinstance(target_pin, str):
            raise ValidationError("导线引脚必须是字符串")
        source_node = node_map.get(source_id)
        target_node = node_map.get(target_id)
        if source_node is None or target_node is None:
            raise NotFoundError("导线的端点节点不存在")
        from ..compute.circuit_modules import DEVICE_KINDS, pin_names

        is_device = (
            source_node.kind in DEVICE_KINDS,
            target_node.kind in DEVICE_KINDS,
        )
        if is_device[0] and is_device[1]:
            raise ValidationError("导线不允许直接连接两个器件（请经网络节点）")
        if not any(is_device):
            # 纯导线：两个网络节点之间，电气上合并为一个网络。
            if source_pin or target_pin:
                raise ValidationError("网络节点之间的纯导线不能绑定引脚")
            return "", ""
        resolved = [source_pin, target_pin]
        for index, (side, node) in enumerate(
            (("起点", source_node), ("终点", target_node))
        ):
            pin = resolved[index]
            if node.kind in DEVICE_KINDS:
                if not pin and node.kind == "module":
                    # 只有一个端口的模块：外部直接连到那个端口，不必再指定引脚名。
                    only = pin_names(node)
                    if len(only) == 1:
                        pin = resolved[index] = only[0]
                if not pin:
                    raise ValidationError(
                        f"{side}是器件节点 {node.name!r}，必须指定引脚"
                    )
                if node.kind == "module":
                    names = set(pin_names(node))
                    label = "模块"
                else:
                    element = str(node.params.get("element") or "")
                    try:
                        names = {item.name for item in pins_for_device(element)}
                    except KeyError as exc:
                        raise ValidationError(str(exc)) from exc
                    label = "器件"
                if pin not in names:
                    raise ValidationError(
                        f"{label} {node.name!r} 没有引脚 {pin!r}；可用：{', '.join(sorted(names))}"
                    )
            elif pin:
                raise ValidationError(f"{side}是网络节点，不能绑定引脚 {pin!r}")
        return resolved[0], resolved[1]

    def _normalize_signal_ports(
        self,
        kind: str,
        source_id: str,
        target_id: str,
        source_port: Any,
        target_port: Any,
        nodes: dict[str, "NodeRecord"] | None = None,
    ) -> tuple[str, str]:
        """R20/Q8：信号/矢量边的端口绑定；电路用 source_pin/target_pin。"""
        node_map = self.nodes if nodes is None else nodes
        source_port = "" if source_port in (None, "") else str(source_port)
        target_port = "" if target_port in (None, "") else str(target_port)
        if self.mode == "circuit":
            if source_port or target_port:
                raise ValidationError(
                    "电路场景使用引脚的 source_pin/target_pin，不用端口"
                )
            return "", ""
        if not source_port and not target_port:
            return "", ""
        source = node_map.get(source_id)
        target = node_map.get(target_id)
        if source is None or target is None:
            raise NotFoundError("连接的端点节点不存在")
        source_spec = get_compute_spec(source.kind)
        target_spec = get_compute_spec(target.kind)
        if source_port:
            outputs = tuple(source_spec.outputs or ())
            if outputs and source_port not in outputs:
                raise ValidationError(
                    f"节点 {source.name!r} 没有输出字段 {source_port!r}；可用：{', '.join(outputs)}"
                )
        if target_port:
            ports = [item.name for item in target_spec.inputs]
            if not ports:
                raise ValidationError(f"节点 {target.name!r} 没有声明输入端口")
            if target_port not in ports:
                raise ValidationError(
                    f"节点 {target.name!r} 没有输入端口 {target_port!r}；可用：{', '.join(ports)}"
                )
        return source_port, target_port

    def _check_block_mode(
        self, kind: str, params: dict[str, Any], *, node_id: str | None = None
    ) -> None:
        """R06/D11：模块模式必须与所在场景一致，跨模式要被明确拒绝。"""
        if kind != "block":
            return
        block_id = str(params.get("block_id") or "")
        block = self.blocks.get(block_id) if block_id else None
        if block is None:
            return
        if block.mode != self.mode:
            where = f"节点 {node_id!r}" if node_id else f"模块 {block.name!r}"
            raise ValidationError(
                f"{where} 是 {block.mode} 模式模块，不能放进 {self.mode} 模式场景；"
                "请改用同模式模块，或经显式接口块连接（signal↔vector 用 if_*_interface，"
                "circuit 侧接口块在 P4）"
            )

    @staticmethod
    def _node_size(raw: Any) -> dict[str, float]:
        """节点尺寸：只接受 ``{"w": 直径}``（可选 h），范围 24..200。"""
        if raw in (None, {}):
            return {}
        if not isinstance(raw, dict):
            raise ValidationError("节点尺寸必须是对象")
        unknown = set(raw) - {"w", "h"}
        if unknown:
            raise ValidationError(f"节点尺寸包含未知键：{', '.join(sorted(unknown))}")
        result: dict[str, float] = {}
        for key in ("w", "h"):
            if key not in raw:
                continue
            value = as_float(
                raw[key], f"节点尺寸 {key}", lo=MIN_NODE_SIZE, hi=MAX_NODE_SIZE
            )
            result[key] = round(value, 3)
        return result

    @staticmethod
    def _edge_route(raw: Any) -> str:
        if raw in (None, ""):
            return "auto"
        route = str(raw)
        if route not in ROUTE_MODES:
            raise ValidationError(
                f"路由方式必须是 {'/'.join(ROUTE_MODES)} 之一，收到 {route!r}"
            )
        return route

    @staticmethod
    def _edge_layout(raw: Any) -> dict[str, Any]:
        if raw in (None, {}):
            return {}
        if not isinstance(raw, dict):
            raise ValidationError("layout 必须是对象")
        unknown = set(raw) - {"x", "y", "rot"}
        if unknown:
            raise ValidationError(f"layout 包含未知键：{', '.join(sorted(unknown))}")
        rot = int(raw.get("rot", 0) or 0)
        if rot % 30 != 0:
            raise ValidationError("layout.rot 必须是 30° 的整数倍")
        return {
            "x": as_float(raw.get("x", 0.0), "layout.x"),
            "y": as_float(raw.get("y", 0.0), "layout.y"),
            "rot": rot % 360,
        }

    @staticmethod
    def _edge_waypoints(raw: Any) -> list[dict[str, float]]:
        if raw in (None, []):
            return []
        if not isinstance(raw, list):
            raise ValidationError("拐点必须是数组")
        if len(raw) > MAX_WAYPOINTS:
            raise LimitError(f"拐点最多 {MAX_WAYPOINTS} 个")
        points: list[dict[str, float]] = []
        for index, item in enumerate(raw):
            if not isinstance(item, dict):
                raise ValidationError(f"第 {index + 1} 个拐点必须是对象")
            unknown = set(item) - {"x", "y"}
            if unknown:
                raise ValidationError(f"拐点包含未知键：{', '.join(sorted(unknown))}")
            points.append(
                {
                    "x": as_float(
                        item.get("x"), "拐点 x", lo=-MAX_POSITION, hi=MAX_POSITION
                    ),
                    "y": as_float(
                        item.get("y"), "拐点 y", lo=-MAX_POSITION, hi=MAX_POSITION
                    ),
                }
            )
        return points

    @staticmethod
    def _edge_anchors(raw: Any) -> dict[str, str]:
        if raw in (None, {}):
            return {}
        if not isinstance(raw, dict):
            raise ValidationError("锚点必须是对象")
        unknown = set(raw) - {"source", "target"}
        if unknown:
            raise ValidationError(f"锚点包含未知键：{', '.join(sorted(unknown))}")
        result: dict[str, str] = {}
        for key in ("source", "target"):
            if key not in raw:
                continue
            side = str(raw[key])
            if side not in ANCHOR_SIDES:
                raise ValidationError(
                    f"锚点 {key} 必须是 {'/'.join(ANCHOR_SIDES)} 之一"
                )
            result[key] = side
        return result

    def _position(self, raw: Any) -> dict[str, float]:
        if raw is None:
            angle = len(self.nodes) * 0.72
            return {
                "x": float(round(220.0 * math.cos(angle))),
                "y": float(round(150.0 * math.sin(angle))),
            }
        if not isinstance(raw, dict):
            raise ValidationError("坐标必须是 {x, y} 对象")
        unknown = set(raw) - {"x", "y"}
        if unknown:
            raise ValidationError(f"坐标包含未知键：{', '.join(sorted(unknown))}")
        return {
            "x": as_float(
                raw.get("x", 0.0), "x 坐标", lo=-MAX_POSITION, hi=MAX_POSITION
            ),
            "y": as_float(
                raw.get("y", 0.0), "y 坐标", lo=-MAX_POSITION, hi=MAX_POSITION
            ),
        }

    # ---- 节点 -------------------------------------------------------------
    def add_node(
        self,
        *,
        name: str,
        kind: str = "manual",
        params: Any = None,
        data: Any = None,
        position: Any = None,
        size: Any = None,
        node_id: str | None = None,
    ) -> NodeRecord:
        if len(self.nodes) >= MAX_NODES:
            raise LimitError(f"节点数量不能超过 {MAX_NODES}")
        clean_name = check_name(name, "节点名称")
        self._unique_node_name(clean_name)
        if not isinstance(kind, str):
            raise ValidationError("kind 必须是字符串")
        params_clean, _label = self._normalize_node_params(kind, params)
        self._check_block_mode(kind, params_clean)
        data_clean = json_safe(data or {}, where=f"节点 {clean_name!r} 的数据")
        if len(data_clean) > MAX_FIELDS:
            raise LimitError(f"节点数据最多 {MAX_FIELDS} 个字段")
        identifier = check_id(node_id, "节点 id") if node_id else uuid.uuid4().hex[:12]
        if identifier in self.nodes:
            raise ConflictError(f"节点 id {identifier!r} 已存在")
        record = NodeRecord(
            id=identifier,
            name=clean_name,
            kind=kind,
            params=params_clean,
            data=data_clean,
            state={},
            inputs={},
            position=self._position(position),
            size=self._node_size(size),
        )
        self.nodes[identifier] = record
        self._touch()
        return record

    def update_node(self, node_id: str, payload: dict[str, Any]) -> NodeRecord:
        record = self.nodes.get(node_id)
        if record is None:
            raise NotFoundError(f"节点 {node_id!r} 不存在")
        allowed = {"name", "kind", "params", "data", "position", "size", "appearance"}
        unknown = set(payload) - allowed
        if unknown:
            raise ValidationError(f"节点更新包含未知字段：{', '.join(sorted(unknown))}")

        if "name" in payload:
            name = check_name(payload["name"], "节点名称")
            self._unique_node_name(name, ignore=node_id)
            record.name = name
        if "kind" in payload:
            kind = payload["kind"]
            if not isinstance(kind, str):
                raise ValidationError("kind 必须是字符串")
            params_clean, _label = self._normalize_node_params(
                kind, payload.get("params")
            )
            self._check_block_mode(kind, params_clean, node_id=node_id)
            if kind != record.kind:
                record.state.clear()
                record.inputs.clear()
            record.kind = kind
            record.params = params_clean
        elif "params" in payload:
            params_clean, _label = self._normalize_node_params(
                record.kind, payload["params"]
            )
            record.params = params_clean
        if "data" in payload:
            data_clean = json_safe(
                payload["data"], where=f"节点 {record.name!r} 的数据"
            )
            if len(data_clean) > MAX_FIELDS:
                raise LimitError(f"节点数据最多 {MAX_FIELDS} 个字段")
            record.data = data_clean
        if "position" in payload:
            position = self._position(payload["position"])
            record.position = position
        if "size" in payload:
            record.size = self._node_size(payload["size"])
        if "appearance" in payload:
            record.appearance = normalize_appearance(payload["appearance"])
        self._touch()
        return record

    def update_positions(self, items: list[dict[str, Any]]) -> None:
        if not isinstance(items, list) or len(items) > MAX_NODES:
            raise ValidationError("positions 必须是节点坐标数组")
        seen: set[str] = set()
        updates: dict[str, dict[str, float]] = {}
        for item in items:
            if not isinstance(item, dict):
                raise ValidationError("坐标项必须是对象")
            node_id = check_id(item.get("id"), "节点 id")
            if node_id in seen:
                raise ValidationError(f"重复的节点 id：{node_id}")
            if node_id not in self.nodes:
                raise NotFoundError(f"节点 {node_id!r} 不存在")
            seen.add(node_id)
            updates[node_id] = self._position(item.get("position"))
        for node_id, position in updates.items():
            self.nodes[node_id].position = position
        if updates:
            self.revision += 1  # 坐标变化不需要重建引擎

    def delete_node(self, node_id: str) -> list[str]:
        if node_id not in self.nodes:
            raise NotFoundError(f"节点 {node_id!r} 不存在")
        removed_edges = [
            edge.id
            for edge in self.edges.values()
            if edge.source == node_id or edge.target == node_id
        ]
        for edge_id in removed_edges:
            del self.edges[edge_id]
        del self.nodes[node_id]
        self._touch()
        return removed_edges

    # ---- 连接 -------------------------------------------------------------
    def _cycle_path(
        self,
        source_id: str,
        target_id: str,
        *,
        skip_edge: str | None = None,
        edges: dict[str, "EdgeRecord"] | None = None,
        nodes: dict[str, "NodeRecord"] | None = None,
    ) -> list[str]:
        """返回新增 source→target 边会形成的环路径（节点 id 序列）。"""
        if source_id == target_id:
            return [source_id, source_id]
        node_items = self.nodes if nodes is None else nodes
        adjacency: dict[str, list[str]] = {node_id: [] for node_id in node_items}
        edge_items = self.edges.values() if edges is None else edges.values()
        for edge in edge_items:
            if not edge.enabled or edge.delay or edge.id == skip_edge:
                continue
            adjacency[edge.source].append(edge.target)
        parent: dict[str, str | None] = {target_id: None}
        stack = [target_id]
        while stack:
            current = stack.pop()
            for neighbour in adjacency.get(current, ()):
                if neighbour == source_id:
                    path = [source_id]
                    cursor: str | None = current
                    while cursor is not None:
                        path.append(cursor)
                        if cursor == target_id:
                            break
                        cursor = parent.get(cursor)
                    path.append(source_id)
                    return path
                if neighbour not in parent:
                    parent[neighbour] = current
                    stack.append(neighbour)
        return []

    def _would_cycle(
        self, source_id: str, target_id: str, *, skip_edge: str | None = None
    ) -> bool:
        return bool(self._cycle_path(source_id, target_id, skip_edge=skip_edge))

    def add_edge(
        self,
        *,
        source: str,
        target: str,
        kind: str,
        name: str | None = None,
        params: Any = None,
        delay: bool = False,
        enabled: bool = True,
        auto_delay: bool = False,
        route: Any = "auto",
        waypoints: Any = None,
        anchors: Any = None,
        pins: Any = None,
        layout: Any = None,
        source_pin: Any = "",
        target_pin: Any = "",
        source_port: Any = "",
        target_port: Any = "",
    ) -> EdgeRecord:
        if len(self.edges) >= MAX_EDGES:
            raise LimitError(f"连接数量不能超过 {MAX_EDGES}")
        if pins is not None:
            from .schematic import apply_pin_bindings

            bound = apply_pin_bindings(
                {
                    "kind": kind,
                    "source": source,
                    "target": target,
                    "params": params or {},
                    "pins": pins,
                }
            )
            source, target, params = bound["source"], bound["target"], bound["params"]
        source_id = check_id(source, "起点 id")
        target_id = check_id(target, "终点 id")
        if source_id not in self.nodes:
            raise NotFoundError(f"起点节点 {source_id!r} 不存在")
        if target_id not in self.nodes:
            raise NotFoundError(f"终点节点 {target_id!r} 不存在")
        if not isinstance(kind, str):
            raise ValidationError("kind 必须是字符串")
        params_clean = self._normalize_edge_params(kind, params)
        clean_name = (
            check_name(name, "连接名称") if name else self._auto_edge_name(kind)
        )
        self._unique_edge_name(clean_name)

        auto_delay_applied = False
        if self.mode == "circuit":
            if delay:
                raise ValidationError("电路模式使用节点电压法求解，不支持延迟连接")
            if source_id == target_id:
                raise ValidationError("元件两端不能是同一个节点")
            delay = False
        elif not delay and self._would_cycle(source_id, target_id):
            if auto_delay:
                delay = True
                auto_delay_applied = True
            elif getattr(self, "solve_algebraic", False):
                # R36/P2：代数环交给 solver_plan/SCC 求解，不再自动改写为 z⁻¹。
                pass
            else:
                cycle_ids = self._cycle_path(source_id, target_id)
                cycle_names = [
                    self.nodes[node_id].name if node_id in self.nodes else node_id
                    for node_id in cycle_ids
                ]
                path = " -> ".join(cycle_names)
                raise ConflictError(
                    f"这条连接会形成代数环：{path}。"
                    "请显式设置 delay=True 或启用 solve_algebraic。"
                )

        source_pin, target_pin = self._normalize_wire_pins(
            kind, source_id, target_id, source_pin, target_pin
        )
        source_port, target_port = self._normalize_signal_ports(
            kind, source_id, target_id, source_port, target_port
        )

        identifier = uuid.uuid4().hex[:12]
        record = EdgeRecord(
            id=identifier,
            name=clean_name,
            source=source_id,
            target=target_id,
            kind=kind,
            params=params_clean,
            state={},
            delay=bool(delay),
            auto_delay=auto_delay_applied,
            enabled=bool(enabled),
            route=self._edge_route(route),
            waypoints=self._edge_waypoints(waypoints),
            anchors=self._edge_anchors(anchors),
            layout=self._edge_layout(layout),
            source_pin=source_pin,
            target_pin=target_pin,
            source_port=source_port,
            target_port=target_port,
        )
        self.edges[identifier] = record
        self._touch()
        return record

    def update_edge(self, edge_id: str, payload: dict[str, Any]) -> EdgeRecord:
        record = self.edges.get(edge_id)
        if record is None:
            raise NotFoundError(f"连接 {edge_id!r} 不存在")
        allowed = {
            "name",
            "kind",
            "params",
            "delay",
            "enabled",
            "source",
            "target",
            "route",
            "waypoints",
            "anchors",
            "layout",
            "pins",
            "source_pin",
            "target_pin",
            "source_port",
            "target_port",
            "appearance",
        }
        unknown = set(payload) - allowed
        if unknown:
            raise ValidationError(f"连接更新包含未知字段：{', '.join(sorted(unknown))}")

        if "pins" in payload:
            from .schematic import apply_pin_bindings

            bound = apply_pin_bindings(
                {
                    "kind": payload.get("kind", record.kind),
                    "source": payload.get("source", record.source),
                    "target": payload.get("target", record.target),
                    "params": payload.get("params", record.params),
                    "pins": payload["pins"],
                }
            )
            payload = dict(payload)
            payload["source"] = bound["source"]
            payload["target"] = bound["target"]
            payload["params"] = bound["params"]
        source_id = record.source
        target_id = record.target
        if "source" in payload:
            source_id = check_id(payload["source"], "起点 id")
            if source_id not in self.nodes:
                raise NotFoundError(f"起点节点 {source_id!r} 不存在")
        if "target" in payload:
            target_id = check_id(payload["target"], "终点 id")
            if target_id not in self.nodes:
                raise NotFoundError(f"终点节点 {target_id!r} 不存在")

        kind = record.kind
        new_params: dict[str, Any] | None = None
        if "kind" in payload:
            kind = payload["kind"]
            if not isinstance(kind, str):
                raise ValidationError("kind 必须是字符串")
        if "params" in payload or kind != record.kind:
            new_params = self._normalize_edge_params(kind, payload.get("params"))

        delay = bool(payload.get("delay", record.delay))
        enabled = bool(payload.get("enabled", record.enabled))
        if self.mode == "circuit":
            if delay:
                raise ValidationError("电路模式不支持延迟连接")
            if source_id == target_id:
                raise ValidationError("元件两端不能是同一个节点")

        if "name" in payload:
            name = check_name(payload["name"], "连接名称")
            self._unique_edge_name(name, ignore=edge_id)
            record.name = name
        source_pin, target_pin = self._normalize_wire_pins(
            kind,
            source_id,
            target_id,
            payload.get("source_pin", record.source_pin),
            payload.get("target_pin", record.target_pin),
        )
        source_port, target_port = self._normalize_signal_ports(
            kind,
            source_id,
            target_id,
            payload.get("source_port", record.source_port),
            payload.get("target_port", record.target_port),
        )
        if kind != record.kind:
            record.state.clear()
            record.kind = kind
        if new_params is not None:
            record.params = new_params
        if self.mode == "signal" and enabled and not delay:
            if self._would_cycle(source_id, target_id, skip_edge=edge_id):
                raise ConflictError(
                    "取消延迟或启用该连接会形成代数环；请保留一条单步延迟"
                )
        record.source = source_id
        record.target = target_id
        record.source_pin = source_pin
        record.target_pin = target_pin
        record.source_port = source_port
        record.target_port = target_port
        record.delay = delay
        record.enabled = enabled
        if "route" in payload:
            record.route = self._edge_route(payload["route"])
        if "waypoints" in payload:
            record.waypoints = self._edge_waypoints(payload["waypoints"])
        if "anchors" in payload:
            record.anchors = self._edge_anchors(payload["anchors"])
        if "layout" in payload:
            record.layout = self._edge_layout(payload["layout"])
        if "appearance" in payload:
            record.appearance = normalize_appearance(payload["appearance"])
        self._touch()
        return record

    def delete_edge(self, edge_id: str) -> None:
        if edge_id not in self.edges:
            raise NotFoundError(f"连接 {edge_id!r} 不存在")
        del self.edges[edge_id]
        self._touch()

    def set_integration(self, method: str) -> None:
        allowed = {item["value"] for item in integration_methods()}
        if method not in allowed:
            raise ValidationError(f"未知积分方法：{method!r}")
        self.integration = method
        self._touch()

    def operating_point(self) -> dict[str, Any]:
        """DC 工作点（仅电路模式），不推进时间、不改瞬态状态。"""
        if self.mode != "circuit":
            raise ValidationError("DC 工作点仅支持电路模式")
        return self.ensure_engine().operating_point()

    def ac_sweep(
        self,
        frequencies: list[float],
        *,
        input_source: str | None = None,
        probes: list[str] | None = None,
    ) -> dict[str, Any]:
        """AC 小信号扫频（仅电路模式），先在工作点线性化。"""
        if self.mode != "circuit":
            raise ValidationError("AC 分析仅支持电路模式")
        return self.ensure_engine().ac_sweep(
            frequencies, input_source=input_source, probes=probes
        )

    # ---- 整体导入/导出 ----------------------------------------------------
    def to_payload(self, *, include_state: bool = False) -> dict[str, Any]:
        nodes = []
        for record in self.nodes.values():
            nodes.append(record.snapshot(include_state=include_state))
        edges = []
        for record in self.edges.values():
            edges.append(record.snapshot(include_state=include_state))
        return {
            "mode": self.mode,
            "integration": self.integration,
            "solve_algebraic": bool(self.solve_algebraic),
            "nodes": nodes,
            "edges": edges,
            "blocks": self.blocks.export_user(),
        }

    def load_payload(self, payload: Any) -> None:
        if not isinstance(payload, dict):
            raise ValidationError("场景必须是 JSON 对象")
        mode = payload.get("mode", self.mode)
        if mode not in MODES:
            raise ValidationError(f"未知模式：{mode!r}")
        integration = payload.get("integration", "trapezoidal")
        allowed_integration = {item["value"] for item in integration_methods()}
        if integration not in allowed_integration:
            raise ValidationError(f"未知积分方法：{integration!r}")
        solve_algebraic = payload.get("solve_algebraic", False)
        if not isinstance(solve_algebraic, bool):
            raise ValidationError("solve_algebraic 必须是布尔值")

        raw_nodes = payload.get("nodes")
        raw_edges = payload.get("edges")
        if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
            raise ValidationError("场景必须包含 nodes 与 edges 数组")
        if len(raw_nodes) > MAX_NODES:
            raise LimitError(f"节点数量不能超过 {MAX_NODES}")
        if len(raw_edges) > MAX_EDGES:
            raise LimitError(f"连接数量不能超过 {MAX_EDGES}")

        raw_blocks = payload.get("blocks")
        if raw_blocks is not None:
            if not isinstance(raw_blocks, list):
                raise ValidationError("场景 blocks 必须是数组")
            store = BlockStore()
            store.load_payloads(raw_blocks)
            self.blocks = store

        self.mode = mode
        self.integration = integration
        nodes: dict[str, NodeRecord] = {}
        edges: dict[str, EdgeRecord] = {}

        for index, raw in enumerate(raw_nodes):
            if not isinstance(raw, dict):
                raise ValidationError(f"第 {index + 1} 个节点不是对象")
            name = check_name(raw.get("name"), f"第 {index + 1} 个节点名称")
            if any(record.name == name for record in nodes.values()):
                raise ConflictError(f"节点名称 {name!r} 重复")
            kind = raw.get("kind", "manual")
            if not isinstance(kind, str):
                raise ValidationError("节点 kind 必须是字符串")
            params = self._normalize_node_params(kind, raw.get("params"))
            data = json_safe(raw.get("data") or {}, where=f"节点 {name!r} 的数据")
            state = json_safe(raw.get("state") or {}, where=f"节点 {name!r} 的状态")
            position = self._position(raw.get("position"))
            node_id = raw.get("id")
            identifier = (
                check_id(node_id, "节点 id") if node_id else uuid.uuid4().hex[:12]
            )
            if identifier in nodes:
                raise ConflictError(f"节点 id {identifier!r} 重复")
            nodes[identifier] = NodeRecord(
                id=identifier,
                name=name,
                kind=kind,
                params=params[0],
                data=data,
                state=state,
                inputs={},
                position=position,
                size=self._node_size(raw.get("size")),
                appearance=normalize_appearance(raw.get("appearance")),
            )

        for index, raw in enumerate(raw_edges):
            if not isinstance(raw, dict):
                raise ValidationError(f"第 {index + 1} 条连接不是对象")
            if raw.get("pins") is not None:
                from .schematic import apply_pin_bindings

                raw = apply_pin_bindings(
                    {
                        "kind": raw.get("kind"),
                        "source": raw.get("source"),
                        "target": raw.get("target"),
                        "params": raw.get("params") or {},
                        "pins": raw.get("pins"),
                    }
                )
            source_id = check_id(raw.get("source"), "起点 id")
            target_id = check_id(raw.get("target"), "终点 id")
            if source_id not in nodes or target_id not in nodes:
                raise ValidationError(f"第 {index + 1} 条连接的端点不存在")
            kind = raw.get("kind")
            if not isinstance(kind, str):
                raise ValidationError("连接 kind 必须是字符串")
            params = self._normalize_edge_params(kind, raw.get("params"))
            source_pin, target_pin = self._normalize_wire_pins(
                kind,
                source_id,
                target_id,
                raw.get("source_pin", ""),
                raw.get("target_pin", ""),
                nodes,
            )
            source_port, target_port = self._normalize_signal_ports(
                kind,
                source_id,
                target_id,
                raw.get("source_port", ""),
                raw.get("target_port", ""),
                nodes,
            )
            name = (
                check_name(raw["name"], "连接名称")
                if raw.get("name")
                else f"{kind}-{index + 1}"
            )
            if any(record.name == name for record in edges.values()):
                raise ConflictError(f"连接名称 {name!r} 重复")
            state = json_safe(raw.get("state") or {}, where=f"连接 {name!r} 的状态")
            delay = bool(raw.get("delay", False))
            enabled = bool(raw.get("enabled", True))
            if mode == "circuit":
                delay = False
                if source_id == target_id:
                    raise ValidationError("元件两端不能是同一个节点")
            identifier = (
                check_id(raw.get("id"), "连接 id")
                if raw.get("id")
                else uuid.uuid4().hex[:12]
            )
            if identifier in edges:
                raise ConflictError(f"连接 id {identifier!r} 重复")
            edges[identifier] = EdgeRecord(
                id=identifier,
                name=name,
                source=source_id,
                target=target_id,
                kind=kind,
                params=params,
                state=state,
                delay=delay,
                auto_delay=bool(raw.get("auto_delay", False)),
                enabled=enabled,
                route=self._edge_route(raw.get("route")),
                waypoints=self._edge_waypoints(raw.get("waypoints")),
                anchors=self._edge_anchors(raw.get("anchors")),
                layout=self._edge_layout(raw.get("layout")),
                source_pin=source_pin,
                target_pin=target_pin,
                source_port=source_port,
                target_port=target_port,
                appearance=normalize_appearance(raw.get("appearance")),
            )

        for record in nodes.values():
            if record.kind != "block":
                continue
            block_id = str(record.params.get("block_id") or "")
            if not block_id or self.blocks.get(block_id) is None:
                raise ValidationError(
                    f"节点 {record.name!r} 引用的功能块不存在：{block_id!r}"
                    "；请删除该节点后用模块库重新实例化，或把对应模块文件补回库中"
                )
            self._check_block_mode("block", {"block_id": block_id}, node_id=record.id)

        if mode == "signal" and not solve_algebraic:
            for record in edges.values():
                if record.delay or not record.enabled:
                    continue
                cycle = self._cycle_path(
                    record.source,
                    record.target,
                    skip_edge=record.id,
                    edges=edges,
                    nodes=nodes,
                )
                if not cycle:
                    continue
                route = cycle
                raise ConflictError(
                    "导入信号流工程发现未显式处理的代数环："
                    + " -> ".join(route)
                    + "。请显式设置 delay=True 或启用 solve_algebraic。"
                )

        self.nodes = nodes
        self.edges = edges
        self.solve_algebraic = solve_algebraic
        self.block_instances = {}
        self._counter = len(edges)
        self._engine = None
        self._dirty = True
        self.revision += 1

    # ---- 元数据 -----------------------------------------------------------
    def catalog(self) -> dict[str, Any]:
        from .engine_registry import plugin_modes

        modes = [
            {"value": "signal", "label": "信号流", "description": "字典沿有向边传播"},
            {
                "value": "circuit",
                "label": "电路",
                "description": "节点电压法求解，支持反馈与双向元件",
            },
            {
                "value": "vector",
                "label": "矢量",
                "description": "二维矢量场与非线性动态源，支持扩散耦合",
            },
        ]
        modes.extend(
            {"value": mode, "label": f"插件模式：{mode}", "description": "插件引擎"}
            for mode in plugin_modes()
        )
        return {
            "modes": modes,
            "computes": compute_catalog(),
            "methods": method_catalog(),
            "elements": element_catalog(),
            "circuit_nodes": node_catalog(),
            "integration": integration_methods(),
            "limits": {
                "nodes": MAX_NODES,
                "edges": MAX_EDGES,
                "fields": MAX_FIELDS,
            },
        }
