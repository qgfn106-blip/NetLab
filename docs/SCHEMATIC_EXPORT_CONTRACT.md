# NetLab 原理图导出契约（Schematic Export Contract v1）

> 状态：S0 已生效（2026-11-19）。依据 `docs/SCHEMATIC_EXPORT_GB_PLAN.md` 与用户 m01120/m01124 的授权。
> 适用代码：`netlab/core/compute/schematic_export_ir.py`（S1）及其后的符号渲染器。

## 1. 目标与边界

- 输入：NetLab 电路场景，既可以是旧的“元件边”形态（edge 同时也是元件），也可以是 R20 之后的“器件节点 + 引脚导线”形态。
- 输出：一个与渲染器无关的 `SchematicExportIR`；SchemDraw/GB 符号渲染、SVG 输出由后续阶段消费 IR。
- 不在本契约内：前端交互绘制、工程文件格式、导出窗口 UI、SchemDraw 具体符号实现。
- IR 只读地描述场景，不修改、不回写、不重排原场景。

## 2. 输入形态与只读保证

### 2.1 旧形态（legacy element-edge）

- `nodes` 全部是电气网络节点（`kind` 为 `node` / `ground` 等），`edges` 的 `kind` 是元件类型（`resistor`、`vsource`……）。
- 适配器调用 `netlab.core.model.project.migrate_scene_to_devices()` 的语义，在**副本**上转换成器件 + 导线；不得把转换结果写回 scene。

### 2.2 新形态（device + wire）

- `nodes` 同时包含 `kind="device"` 的器件节点与网络节点；`edges` 中 `kind="wire"` 的边表示引脚到网络（或网络到网络）的导线。
- 器件类型取 `node.params.element`；器件引脚取 `netlab.core.model.ports.pins_for_device(element)`。

### 2.3 幂等与只读

- 已含 `device` 节点或 `wire` 边的场景不得再次迁移。
- `build_schematic_export_ir(scene, ...)` 前后，调用方传入的 dict/Scene 必须逐字段相等。

## 3. 坐标与单位

- 场景坐标（world）：浮点 `x/y`，单位是 NetLab world unit；`y` 轴向下（与前端 Canvas 和 SVG 一致）。
- 标准栅格：`2.54 mm` 对应 `20 world units`。
- **`MM_PER_WORLD = 0.127`**；`WORLD_PER_GRID = 20.0`；`GRID_MM = 2.54`。
- 所有 IR 坐标保持 world unit；SVG 渲染阶段再统一乘 `MM_PER_WORLD` 或按 viewBox 换算。禁止在多个函数中散落 `*0.02` 一类隐式系数。
- 公开换算函数：`world_to_mm(value)`、`mm_to_world(value)`；测试必须覆盖 `world_to_mm(20) == 2.54`。

## 4. 路由优先级（强制）

```text
显式 manual waypoints > edge anchors/source_pin/target_pin > device layout/rotation > circuit 默认正交 > 缺失坐标时的导出专用 fallback layout
```

### 4.1 每条 wire 的判定顺序

1. `route == "manual"` 或 `waypoints` 非空：按用户给定顺序保留折点；只删除连续重复点和零长度段。
2. 有 `source_pin` / `target_pin`：先解析到具体引脚锚点，再决定路径。
3. 有 `layout` / device `position` / `rotation`：使用器件布局；不得用节点中心覆盖已有布局。
4. `route == "auto"` 且导出选项 `route_mode="orthogonal"`：生成正交折线（默认中段转折）。
5. `route == "auto"` 且导出选项 `route_mode="free"`：允许直线/自由角度。
6. 端点缺坐标：只使用导出阶段的确定性 `fallback layout`，并产生 warning；不回写工程。

`route == "straight"` 时必须保留直线，不得自动改成正交。

## 5. IR v1 数据结构

```json
{
  "schema": "netlab-schematic-ir/1",
  "units": {"world": "netlab-world", "svg": "pt", "mm_per_world": 0.127, "grid_mm": 2.54},
  "style": "gb",
  "devices": [{"id": "", "kind": "", "name": "", "params": {}, "center": {"x": 0, "y": 0}, "rotation_deg": 0, "bbox": null, "pins": [{"name": "", "role": "", "required": true, "x": 0, "y": 0}]}],
  "nets": [{"id": "", "name": "", "members": [{"device": "", "pin": ""}], "is_ground": false}],
  "wires": [{"id": "", "net_id": "", "points": [{"x": 0, "y": 0}], "source_pin": "", "target_pin": "", "route_source": ""}],
  "junctions": [{"x": 0, "y": 0, "reason": "branch"}],
  "crossings": [{"x": 0, "y": 0, "over_wire_id": "", "under_wire_id": ""}],
  "labels": [{"text": "", "anchor": {"x": 0, "y": 0}, "placement": "above", "owner_id": "", "role": "designator"}],
  "unsupported": [{"id": "", "kind": "", "name": "", "reason": ""}],
  "warnings": [{"code": "", "message": "", "owner_id": ""}],
  "stats": {"nodes": 0, "devices": 0, "wires": 0, "junctions": 0, "crossings": 0, "labels": 0, "unsupported": 0, "warnings": 0}
}
```

- `bbox` 在 S1 可为 `null`；S2 的 symbol spec 必须为每个 supported kind 填真实 bbox。
- `pins[].x/y` 在 S1 等于器件中心（`PinSpec.dx/dy` 当前为 0）；S2 用 symbol spec 填充局部引脚坐标。
- `route_source` 取值：`manual`、`straight`、`orthogonal`、`free`、`fallback`。

## 6. IR 构建规则

1. 先归一化为 device + net 图；不得直接按 `edge.source → edge.target` 画线。
2. 每条 wire 解析端点：器件端点必须按 `source_pin` / `target_pin` 命中引脚；网络端点取网络节点坐标。
3. 规范化路径：删除连续重复点、零长度段；`manual` 折点即使共线也保留。
4. 同一 wire 的 `points[0]` 是源端锚点，`points[-1]` 是目标端锚点。
5. `nets[].members` 列出所有接到该 net 的 `(device, pin)`；一个 `(device,pin)` 只出现一次。
6. 全部集合按稳定键排序（device: name,id；net: id；wire: id；junction/crossing: x,y），保证同一输入产生逐字节相同 JSON。
7. `to_dict()` 的 JSON 必须可被标准 `json.dumps` 序列化，禁止 set/元组泄漏。

## 7. Junction 与 crossing

- **branch junction**：同一 net 的三个或以上 wire 端点/合法分支在同一规范化坐标相遇。
- 同一坐标、不同 net：不得合并，也不画 junction；若线段相交则输出 `crossings[]`。
- crossing 的 over/under 规则：wire id 字典序较小者为 `over_wire_id`，较大者为 `under_wire_id`（稳定、可测试）。
- 浮点比较使用 `EPSILON = 1e-9`；近似合并必须写 `warnings[]`，不得静默吞掉。

## 8. 标签

- wire 不产生任何文字标签；禁止出现 `wire-*` 文本。
- 器件标签：`role="designator"`（名称）与 `role="value"`（关键参数值，若启用）。
- 标签坐标必须由 symbol spec 的 label slot 决定（S2）；S1 允许使用器件中心上/下偏移作为占位。

## 9. unsupported 与 warnings

| code | 触发条件 | 行为 |
| --- | --- | --- |
| `unsupported_device` | `params.element` 不在 PINS 清单 | 生成显式“不支持的器件”占位信息，写入 `unsupported[]`，不得静默删除 |
| `missing_pin_binding` | wire 端点指向器件但缺少 `source_pin`/`target_pin` | 用器件中心占位，写 warning |
| `zero_length_wire` | 规范化后起终点相同 | 保留单点 wire，写 warning |
| `nets_touch_at_endpoint` | 两个不同 net 的线段在端点处重合 | 不合并，写 warning |
| `fallback_layout` | 端点缺坐标，使用导出 fallback | 写 warning |

## 10. 版本与兼容

- `schema` 固定为 `netlab-schematic-ir/1`；新增字段保持向后兼容，破坏性变更升 v2。
- S1 不改变旧 `scene_to_svg()` 的签名与输出；S4 才把 `scene_to_svg()` 收口到 IR。
- 旧/新两种输入必须针对同一工程得到结构等价的 IR（fixture `legacy_rc_branch.json` 与 `device_wire_rc_branch.json` 是契约测试基准）。
