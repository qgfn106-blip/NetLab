# 最小数据模型示例（阶段 4 / P1-A）

> 状态：`Proposed`（设计冻结草案，待评审）。本文是 2 节点 + 1 边的**完整示例**：工程 JSON、内存对象、编译产物、运行结果。全部为设计草案，**不是当前实现的输出格式**，不是可执行生产代码；ADR 不是实施授权。
> 依据：`NETLAB_V2_PLANNING_REVIEW.md:100-108`（补 6 份文档第 6 份：最小领域完整 JSON/内存对象/编译产物/运行结果）、`:136`（建议先写本示例再写实现）、`CORE_ARCHITECTURE_V2_ROADMAP.md:58-60`（Circuit + 最小机械域验证、4 类物理量）。
> 边界：不写生产代码、不改外部工程 JSON、不迁移旧工程、不改 FEM。

## 1. 场景选择

两个最小领域，各 2 节点 + 1 边：

- **Circuit（RC 低通）**：节点 `vin`（激励 voltage）、`vout`（输出 voltage），边 `R1`（resistor，PhysicalEdge）。配合 `BoundaryCondition` 与接地约束，体现 `voltage` + `current`。
- **Mechanical（质量-阻尼）**：节点 `body`、`ground`，边 `damper`（PhysicalEdge），体现 `force` + `velocity`。

合计覆盖 `voltage/current/force/velocity` 4 类物理量（见 `TYPED_PORT_SYSTEM.md` §2）。

## 2. 完整工程 JSON（设计草案，非当前格式）

```json
{
  "format": "netlab-project-v2-draft",
  "version": 8,
  "scenes": [
    {
      "id": "rc-lowpass",
      "mode": "circuit",
      "revision": 1,
      "domain": "circuit",
      "nodes": [
        {"id": "vin", "kind": "junction", "ports": ["p"], "params": {}, "appearance": {"color": "#2563eb"}},
        {"id": "vout", "kind": "junction", "ports": ["p"], "params": {}, "appearance": {}}
      ],
      "edges": [
        {"id": "R1", "kind": "physical", "source": "vin", "target": "vout",
         "source_port": "p", "target_port": "p", "params": {"resistance": 1000.0}}
      ],
      "variables": [
        {"id": "v_vin", "quantity": "voltage", "unit": "V", "dimension": [2, 1, -3, -1]},
        {"id": "v_vout", "quantity": "voltage", "unit": "V", "dimension": [2, 1, -3, -1]},
        {"id": "i_R1", "quantity": "current", "unit": "A", "dimension": [0, 0, 0, 1]}
      ],
      "equations": [
        {"id": "R1-constitutive", "expression": "v_vin - v_vout - R * i_R1 = 0", "variables": ["v_vin", "v_vout", "i_R1"], "linear": true}
      ],
      "constraints": [
        {"id": "gnd", "kind": "ground", "target": "vout", "value": 0.0}
      ],
      "parameters": [
        {"id": "R", "value": 1000.0, "unit": "ohm", "writable": true}
      ],
      "initial_conditions": [
        {"variable": "v_vout", "value": 0.0}
      ],
      "boundary_conditions": [
        {"variable": "v_vin", "expression": "1.0"}
      ]
    }
  ],
  "metadata": {"author": "design-freeze-example", "runtime_snapshot": null}
}
```

注：`runtime_snapshot: null` 表示普通保存不含运行态；是否允许显式快照是 `PENDING_USER_AUTHORIZATION`（见 `ENGINE_LIFECYCLE.md` §5），本示例不预设立场。`appearance` 存于记录层，说明它不进编译缓存键。

## 3. 内存对象（Python 草案，ast.parse 可解析）

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


@dataclass(frozen=True)
class PortType:
    domain: str
    quantity: str
    unit: str
    dimension: tuple[int, int, int, int]


@dataclass(frozen=True)
class NodeDesc:
    id: str
    kind: str
    appearance: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class EdgeDesc:
    id: str
    source: str
    target: str
    params: Mapping[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class SceneDesc:
    mode: str
    nodes: tuple[NodeDesc, ...]
    edges: tuple[EdgeDesc, ...]
    revision: int = 1


voltage = PortType("circuit", "voltage", "V", (2, 1, -3, -1))
current = PortType("circuit", "current", "A", (0, 0, 0, 1))
force = PortType("mechanical", "force", "N", (1, 1, -2, 0))
velocity = PortType("mechanical", "velocity", "m/s", (1, 0, -1, 0))

rc_desc = SceneDesc(
    mode="circuit",
    nodes=(
        NodeDesc("vin", "junction", {"color": "#2563eb"}),
        NodeDesc("vout", "junction"),
    ),
    edges=(EdgeDesc("R1", "vin", "vout", {"resistance": 1000.0}),),
)
```

## 4. 编译产物（设计草案）

```json
{
  "generation": "gen-rc-lowpass-1",
  "engine_spec": {"mode": "circuit", "domain": "circuit", "version": 2},
  "variables": ["v_vin", "v_vout", "i_R1"],
  "equations": ["v_vin - v_vout - R * i_R1 = 0"],
  "port_resolution": [
    {"edge": "R1", "from": "vin.p", "to": "vout.p", "semantics": "physical_conserving", "unit_ok": true}
  ],
  "unit_check": {"status": "ok", "registry": "UnitRegistry", "implicit_dimension_conversion": false},
  "sparse_structure": {"rows": 3, "cols": 3, "nnz": 5},
  "execution_plan": {"backend": "mna", "integration": "trapezoidal", "dt": 0.0001},
  "diagnostics": [],
  "cache_key": "hash(Desc + compile_config + SPI_version + EngineSpec_version)",
  "cache_key_excludes": ["appearance", "card_fields", "LayoutEdge", "runtime_state", "ui_state"]
}
```

`cache_key_excludes` 明确外观/布局/运行态不进编译缓存键（七项裁决 ②、ADR-005-lite、阶段 2 的 `ensure_engine() is engine` 机制断言）。

## 5. 运行结果（设计草案）

```json
{
  "generation": "gen-rc-lowpass-1",
  "time_s": 0.001,
  "probes": {
    "v_vin": 1.0,
    "v_vout": 0.6321205588,
    "i_R1": 0.0003678794
  },
  "stats": {"steps": 10, "dt": 0.0001, "solver": "mna", "numerical_error": false},
  "description_modified": false,
  "runtime_snapshot": null
}
```

`description_modified: false` 是硬约束：运行/快照/恢复全过程不改 Desc（见 `CORE_OBJECT_RELATIONSHIP.md` §3、`ENGINE_LIFECYCLE.md` §2）。`v_vout = 1 - exp(-t/RC)` 在 `t = RC = 0.001 s` 处约为 `0.6321205588`，仅作示例数值，不作为数值验收阈值；数值验收仍以 `netlab/tests` 的既有解析解测试为准。

## 6. 最小机械域（4 类物理量的补验证）

```json
{
  "id": "mass-damper",
  "mode": "mechanical",
  "nodes": [
    {"id": "body", "kind": "mass", "ports": ["p"], "params": {"mass": 1.0}},
    {"id": "ground", "kind": "fixed", "ports": ["p"], "params": {}}
  ],
  "edges": [
    {"id": "damper", "kind": "physical", "source": "body", "target": "ground",
     "params": {"damping": 2.0}}
  ],
  "variables": [
    {"id": "v_body", "quantity": "velocity", "unit": "m/s", "dimension": [1, 0, -1, 0]},
    {"id": "f_damper", "quantity": "force", "unit": "N", "dimension": [1, 1, -2, 0]}
  ],
  "equations": [
    {"id": "damper-law", "expression": "f_damper = damping * v_body", "variables": ["f_damper", "v_body"], "linear": true}
  ],
  "constraints": [
    {"id": "ground-fixed", "kind": "fixed", "target": "v_body", "value": 0.0}
  ]
}
```

Circuit 与机械域共用同一个 `PortType` / `UnitRegistry` / `EngineSpec` 接口，核心不硬编码领域类型名（`TYPED_PORT_SYSTEM.md` §6）。这是 ROADMAP §2「先用 Circuit + 一个最小机械域验证 Typed Port」的最小落地示意，**不是已实现的功能**。

## 7. 旧工程适配层可读

v7 工程的 `NodeRecord` / `EdgeRecord` 经 `MIGRATION_AND_COMPATIBILITY.md` §4 的适配层投影为上述 Desc + Runtime 初值；字段只加不删、旧 API 不破坏。本示例不改写任何现存工程文件。

三项「需用户决策」（`NETLAB_V2_PLANNING_REVIEW.md:136`）见 `MIGRATION_AND_COMPATIBILITY.md` §6，均标 `PENDING_USER_AUTHORIZATION`，本阶段不裁定、不升格 ADR。
