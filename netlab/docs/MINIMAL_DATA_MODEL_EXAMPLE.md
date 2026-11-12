# 最小数据模型示例（阶段 4 / P1-A）

> 状态：`Proposed`（设计冻结草案，待评审）。本文给出两个最小领域的**完整示例**：RC 低通（3 节点 + 2 边）与质量-阻尼（2 节点 + 1 边），涵盖工程 JSON、内存对象、编译产物、运行结果。全部为设计草案，**不是当前实现的输出格式**，不是可执行生产代码；ADR 不是实施授权。
> 依据：`NETLAB_V2_PLANNING_REVIEW.md:100-108`（补 6 份文档第 6 份：最小领域完整 JSON/内存对象/编译产物/运行结果）、`:136`（建议先写本示例再写实现）、`CORE_ARCHITECTURE_V2_ROADMAP.md:58-60`（Circuit + 最小机械域验证、4 类物理量）。
> 边界：不写生产代码、不改外部工程 JSON、不迁移旧工程、不改 FEM。本示例已按数学物理自洽修订（见 `STAGE4_REMEDIATION_REPORT.md` P0-01/P1-01）。

## 1. 场景选择

两个最小领域：RC 低通为 3 个节点（含参考地）+ 2 条边；质量-阻尼为 2 个节点（含参考地）+ 1 条边：

- **Circuit（RC 低通）**：节点 `vin`（激励 voltage）、`vout`（输出 voltage）、`gnd`（ground 参考）；边 `R1`（resistor）、`C1`（capacitor）。方程为 `(v_vin-v_vout)/R = C·dv_vout/dt`，即 `RC·dv_vout/dt + v_vout = v_vin`，解析解 `v_vout(t)=1-exp(-t/RC)`。
- **Mechanical（质量-阻尼）**：节点 `body`（velocity）、`ground`（固定参考）；边 `damper`（damper）。方程为 `m·dv_body/dt = F - b·v_body`，解析解 `v_body(t)=v0·exp(-b·t/m)`。

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
        {"id": "vin", "kind": "junction", "ports": ["vin_p"], "params": {}},
        {"id": "vout", "kind": "junction", "ports": ["vout_p"], "params": {}},
        {"id": "gnd", "kind": "ground", "ports": ["gnd_p"], "params": {}}
      ],
      "edges": [
        {"id": "R1", "kind": "physical", "source": "vin", "target": "vout",
         "source_port": "vin_p", "target_port": "vout_p", "params": {"R": 1000.0}},
        {"id": "C1", "kind": "physical", "source": "vout", "target": "gnd",
         "source_port": "vout_p", "target_port": "gnd_p", "params": {"C": 1.0e-6}}
      ],
      "variables": [
        {"id": "v_vin", "quantity": "voltage", "unit": "V", "dimension": [2, 1, -3, -1, 0, 0, 0]},
        {"id": "v_vout", "quantity": "voltage", "unit": "V", "dimension": [2, 1, -3, -1, 0, 0, 0]},
        {"id": "i_R1", "quantity": "current", "unit": "A", "dimension": [0, 0, 0, 1, 0, 0, 0]},
        {"id": "i_C1", "quantity": "current", "unit": "A", "dimension": [0, 0, 0, 1, 0, 0, 0]}
      ],
      "equations": [
        {"id": "R1-constitutive", "expression": "v_vin - v_vout - R * i_R1 = 0", "variables": ["v_vin", "v_vout", "i_R1"], "linear": true},
        {"id": "C1-constitutive", "expression": "i_C1 - C * d(v_vout)/dt = 0", "variables": ["i_C1", "v_vout"], "linear": true},
        {"id": "kcl-vout", "expression": "i_R1 - i_C1 = 0", "variables": ["i_R1", "i_C1"], "linear": true}
      ],
      "constraints": [
        {"id": "gnd", "kind": "ground", "target": "gnd", "value": 0.0}
      ],
      "parameters": [
        {"id": "R", "value": 1000.0, "unit": "ohm", "writable": true},
        {"id": "C", "value": 1.0e-6, "unit": "F", "writable": true}
      ],
      "initial_conditions": [
        {"variable": "v_vout", "value": 0.0}
      ],
      "boundary_conditions": [
        {"variable": "v_vin", "expression": "1.0"}
      ],
      "compat": {},
      "presentation": {
        "node_styles": {
          "vin": {"color": "#2563eb"},
          "vout": {"color": "#16a34a"},
          "gnd": {"color": "#64748b"}
        }
      }
    }
  ],
  "metadata": {"author": "design-freeze-example", "runtime_snapshot": null}
}
```

注：`runtime_snapshot: null` 表示普通保存不含运行态；是否允许显式快照是 `PENDING_USER_AUTHORIZATION`（见 `ENGINE_LIFECYCLE.md` §5）。**外观（`presentation`）属于 Presentation 层，通过节点 id 关联，不进入 `NodeDesc`/物理模型/编译缓存键**（P0-04）。 `ports` 的 JSON 形式为 port_id 字符串列表，加载时由 `PortTypeRegistry` 按 `PortDesc` 定义转换为 `tuple[PortDesc, ...]`；别名 `port_type` 引用 `PortType`。

RC 校验：`R=1000 Ω`、`C=1e-6 F` ⇒ 时间常数 `RC=1e-3 s`。在 `t=RC` 时 `v_vout=1-e^{-1}=0.6321205588 V`，`i_R1=(1-0.6321205588)/1000=0.0003678794 A`，`i_C1=i_R1`。拓扑、方程、约束、数值四者一致。

## 3. 内存对象（Python 草案，ast.parse 可解析）

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


# PortType/PortDesc 的权威定义见 `CORE_MODEL_V2.md` §4；本示例不重复定义，仅展示对象关系。

# PortDesc 的唯一完整定义见 `CORE_MODEL_V2.md` §4；本示例不重复定义，
# 下面的 NodeDesc 仅用于展示对象关系（其中 PortDesc 为类型引用）。


@dataclass(frozen=True)
class NodeDesc:
    id: str
    kind: str
    name: str = ""
    ports: tuple[PortDesc, ...] = ()
    params: Mapping[str, Any] = field(default_factory=dict)
    initial_data: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class EdgeDesc:
    # 示例简化：真实 EdgeDesc 的 kind 为 EdgeKind（见 CORE_MODEL_V2.md §4）
    id: str
    kind: str
    source: str
    target: str
    source_port: str = ""
    target_port: str = ""
    params: Mapping[str, Any] = field(default_factory=dict)
```

**对象关系**：`NodeDesc.ports` 持有 `PortDesc`；`PortDesc.port_type` 引用 `PortTypeRegistry` 中的 `PortType`。`EdgeDesc` 只用 port id 关联，不内嵌外观。兼容判定：`PortType.domain` 与 `connection_semantics` 必须一致；跨物理域连接须显式 `multi_port` 或转换器；单位换算由 `UnitRegistry` 显式完成（禁止隐式跨维度）；`cardinality=many` 表示一对多/多对一汇聚，展开为多条单端口连接；`shape` 不符则 `ModelValidationError`。

## 4. 最小机械域（质量-阻尼）

```json
{
  "id": "mass-damper",
  "mode": "mechanical",
  "domain": "mechanical",
  "revision": 1,
  "compat": {},
  "presentation": {},
  "nodes": [
    {"id": "body", "kind": "mass", "ports": ["body_v"], "params": {}},
    {"id": "ground", "kind": "ground", "ports": ["ground_v"], "params": {}}
  ],
  "edges": [
    {"id": "damper", "kind": "physical", "source": "body", "target": "ground",
     "source_port": "body_v", "target_port": "ground_v", "params": {"b": 2.0}}
  ],
  "variables": [
    {"id": "v_body", "quantity": "velocity", "unit": "m/s", "dimension": [1, 0, -1, 0, 0, 0, 0]},
    {"id": "f_damper", "quantity": "force", "unit": "N", "dimension": [1, 1, -2, 0, 0, 0, 0]}
  ],
  "equations": [
    {"id": "damper-constitutive", "expression": "f_damper - b * v_body = 0", "variables": ["f_damper", "v_body"], "linear": true},
    {"id": "newton-body", "expression": "m * d(v_body)/dt - F + f_damper = 0", "variables": ["v_body", "f_damper"], "linear": true}
  ],
  "constraints": [
    {"id": "ground-fixed", "kind": "fixed", "target": "ground", "value": 0.0}
  ],
  "parameters": [
    {"id": "m", "value": 1.0, "unit": "kg", "writable": true},
    {"id": "b", "value": 2.0, "unit": "N*s/m", "writable": true},
    {"id": "F", "value": 0.0, "unit": "N", "writable": true}
  ],
  "initial_conditions": [
    {"variable": "v_body", "value": 1.0}
  ],
  "boundary_conditions": []
}
```

机械校验：`m=1 kg`、`b=2 N·s/m`、初速 `v0=1 m/s`、`F=0` ⇒ `v_body(t)=e^{-2t}`；在 `t=0.5 s` 时 `v_body=e^{-1}=0.3678794412 m/s`。`ground` 固定为 0，**不是把 `body` 速度置零**。

## 5. 编译产物与运行结果（设计草案）

```json
{
  "compiled": {
    "generation": "rc-lowpass@1",
    "variables": ["v_vin", "v_vout", "i_R1", "i_C1"],
    "equations": ["R1-constitutive", "C1-constitutive", "kcl-vout"],
    "execution_plan": {"backend": "descriptor", "order": ["assemble", "solve"]},
    "sparse_structure": {"nnz": 8},
    "cache_key_excludes": ["appearance", "card_fields", "layout_edge", "runtime_state", "ui_state"]
  },
  "result": {
    "time_s": 0.001,
    "v_vout": 0.6321205588,
    "i_R1": 0.0003678794,
    "i_C1": 0.0003678794
  }
}
```

## 6. 已知边界

- 本示例用于设计评审，不作为验收阈值；运行结果只验证数学一致性。
- 显式 Runtime 快照是否允许、Plugin 权限边界、v6 兼容窗口三项仍是 `PENDING_USER_AUTHORIZATION`，见 ADR-008。
