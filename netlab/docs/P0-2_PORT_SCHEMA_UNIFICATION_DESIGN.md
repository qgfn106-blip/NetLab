# P0-2 端口 Schema 统一审计与设计（PortDef → PortDesc / PortType）

> 性质：**只读审计 + 统一设计提案**。本轮不修改任何生产代码（`blocks.py` / `ports.py` / `project.py` / `plugin_api` 均保持原样），仅新增本文档。
> 基线：git `HEAD=8f9344f67910caa3f738bbef5153f2aa897d3e5a`（main）。
> 日期：2026-11-13。
> 依据文档：`CORE_MODEL_V2.md`（Proposed）、`TYPED_PORT_SYSTEM.md`（Proposed）、`MINIMAL_DATA_MODEL_EXAMPLE.md`（Proposed）、`P0-2_PORT_SCHEMA_DECISION.md`（2026-11-12 决策记录）。
> 证据约定：**每条结论后标注 `文件:行号`**；无法从代码确认的标 `待确认`，不做推断性编造。文中 `blocks.py` 指 `netlab/core/model/blocks.py`，`ports.py` 指 `netlab/core/model/ports.py`，`project.py` 指 `netlab/core/model/project.py`。

---

## 0. 结论摘要（先看这五条）

1. **仓库并存三套「端口」概念，不是一个东西**：V1 块端口 `blocks.PortDef`（已实现、可变 dataclass）；V2 块端口 `CORE_MODEL_V2.PortDesc` + 内嵌 `PortType`（仅文档草案、零代码实现）；以及**与块端口无关**的器件引脚 `ports.PortSpec` / `ports.PinSpec`（已实现）。三者不可混称。
2. **V1 → V2 不是改名，是换模型**：V1 的 `name` 是唯一身份，V2 改为 `port_id` 且不再有 `name`；V1 一维的 `dtype/fields` 被 V2 的 `PortType`（domain/quantity/unit/dimension/…）取代。字段映射存在 **5 处信息损失/缺失**（`inout`、`electrical`、`default`、`net`、`name`），其中 2 处必须用户拍板。
3. **JSON 形态存在硬冲突且被测试写死**：`CORE_MODEL_V2.md:100` 规定 `ports: tuple[PortDesc, ...]`（对象数组），而 `MINIMAL_DATA_MODEL_EXAMPLE.md:29-31` 与校验脚本 `tools/check_stage4_docs.py:219-223` **强制要求 `ports` 是 `list[str]`**。这等于把「方案 B（引用式 + Registry 恢复）」写成了通过条件，**直接违反 `P0-2_PORT_SCHEMA_DECISION.md:8,19` 已定的方案 A（内嵌、不依赖 Registry）**。
4. **迁移入口已存在但缺端口级钩子**：`project.py:576-712` 是顺序 `if version < N` 链，当前 `PROJECT_VERSION=7`（`project.py:36`）。V1→V2 端口升级需要**新增 `version < 8` 分支**，且必须处理「块以引用式存储」与「场景按端口名接线」两处兼容（`project.py:716-722, 741-762`）。
5. **插件侧完全无法声明端口**：`plugin_api/v1/__init__.py:215` 的 `__all__` 无 `PortDef` / `PortDesc` / `PortType`，`ElementSpec.pins` 只是 `tuple[dict, ...]`（`__init__.py:64`）。这是 `P0-2_PORT_SCHEMA_DECISION.md:29` 已承认的 GAP，需以「新增导出、不改旧符号」的方式补齐。

---

## 1. 三者定义与差异

### 1.1 V1 —— `blocks.PortDef`（功能块端口，现行实现）

```python
# netlab/core/model/blocks.py:79-88
@dataclass
class PortDef:
    name: str
    direction: str
    fields: list[str] = field(default_factory=list)
    dtype: str = "signal"
    description: str = ""
    default: float = 0.0
    #: 电路模块专用：端口绑定的内部网络节点 id（R24/D51）。
    net: str = ""
```

要点：

- **可变对象**：普通 `@dataclass`，非 `frozen`（`blocks.py:79`）。可原地改字段。
- **身份 = `name`**：同一块内端口名唯一性由 `BlockDef.__post_init__` 强制（`blocks.py:160-162`），没有独立 `port_id`。
- **取值约束**：`direction ∈ {input, output, inout}`（`blocks.py:164`）；`dtype ∈ {signal, vector, bit, any, electrical}`（`blocks.py:111-113`）。
- **序列化内嵌**：`PortDef.to_payload()` 输出 `name/direction/fields/dtype/description/default`，仅当 `net` 非空才带 `net`（`blocks.py:90-101`）；`BlockDef.to_payload()` 用 `[port.to_payload() for port in self.ports]` 内联（`blocks.py:193`），反序列化 `PortDef.from_payload(item)`（`blocks.py:219`）。**已经是自包含纯数据**（与 `P0-2_PORT_SCHEMA_DECISION.md:25-26` 一致）。
- **使用方**：`BlockDef.input_ports/output_ports` 按 `direction` 过滤，`circuit_ports` 按 `dtype=="electrical"` 过滤（`blocks.py:167-178`）。

### 1.2 V2 —— `CORE_MODEL_V2.PortDesc`（块端口的目标描述，设计草案）

```python
# netlab/docs/CORE_MODEL_V2.md:83-92
@dataclass(frozen=True)
class PortDesc:
    port_id: str
    direction: PortDirection
    port_type: PortType
    cardinality: str = "one"  # one | many
    reference: str = "node"  # node | ground
    component_id: str = ""
    coordinate_frame: str = ""
    metadata: Mapping[str, Any] = field(default_factory=dict)
```

要点：

- **不可变值对象**：`@dataclass(frozen=True)`（`CORE_MODEL_V2.md:83`）。
- **身份 = `port_id`**，**没有 `name` 字段**（对照 `CORE_MODEL_V2.md:83-92` 全字段）——这是与 V1 最大的语义断裂点。
- **方向枚举更窄**：`PortDirection = Literal["input", "output", "bidirectional"]`（`CORE_MODEL_V2.md:80`），**无 `inout`**。
- **类型外置到 `PortType`**（组合而非扁平），见 1.3；`PortDesc` 自身只保留实例级信息（方向、基数、引用目标、坐标框架、metadata）。
- 所有 V2 端口类型目前**只存在于文档**：`grep` 全仓无 `PortDesc` 实现类（待实现，见 §7 冲突 8）。

### 1.3 `PortType`（端口的"类型 / 物理量"值对象，V2 新增）

```python
# netlab/docs/CORE_MODEL_V2.md:65-77
@dataclass(frozen=True)
class PortType:
    domain: str
    quantity: str
    unit: str
    dimension: tuple[int, int, int, int, int, int, int]
    direction: str
    cardinality: str = "one"
    shape: tuple[int, ...] = ()
    dtype: str = "float"
    connection_semantics: str = "causal"
    coordinate_frame: str = ""
    metadata: Mapping[str, Any] = field(default_factory=dict)
```

- **11 个字段**，描述"这类端口是什么"，与具体实例解耦。`dimension` 固定 7 元组，顺序 `[L, M, T, I, Θ, N, J]`（`TYPED_PORT_SYSTEM.md:38`）。
- 标准量纲示例：`voltage(circuit,V,[2,1,-3,-1,0,0,0])`、`current(circuit,A,[0,0,0,1,0,0,0])`、`force(mechanical,N,[1,1,-2,0,0,0,0])`、`velocity(mechanical,m/s,[1,0,-1,0,0,0,0])`（`TYPED_PORT_SYSTEM.md:29-34`）。
- 连接语义 4 类：`causal` / `acausal` / `physical_conserving` / `multi_port`（`TYPED_PORT_SYSTEM.md:42-47`）。
- `direction` 在 `PortType` 与 `PortDesc` **重复出现**（`CORE_MODEL_V2.md:71` 与 `:86`）——**歧义点**，见 §7 冲突 9。

### 1.4 第三套 —— `ports.PortSpec` / `ports.PinSpec`（器件引脚，**不是**块端口）

```python
# netlab/core/model/ports.py:20-55（节选）
@dataclass(frozen=True)
class PortSpec:
    name: str
    role: str = "input"
    required: bool = False
    order: int = 0

@dataclass(frozen=True)
class PinSpec:
    name: str
    role: str = "passive"
    required: bool = True
    order: int = 0
    dx: float = 0.0
    dy: float = 0.0
```

- 文件 docstring 明确定位为"器件节点的引脚声明"（`ports.py:1`），`ROLE_VALUES=("input","output","bidirectional","power","passive")`（`ports.py:17`），`PINS` 是元件引脚表（`ports.py:67+`）。
- **它是元件库侧的电气引脚契约，与 `BlockDef.ports` 不是同一层对象**，`P0-2_PORT_SCHEMA_DECISION.md:30,50` 明确"不在本次迁移范围"。
- 但它和 V2 `PortType` 在字段上有表面重叠（都有 `name/role/order`），**是命名混淆的主要来源**。

### 1.5 差异矩阵

| 维度 | V1 `PortDef`（blocks.py:79） | V2 `PortDesc`（CORE_MODEL_V2.md:83） | `PortType`（CORE_MODEL_V2.md:65） | `ports.PortSpec/PinSpec`（ports.py:20/38） |
|---|---|---|---|---|
| 归属对象 | 功能块 `BlockDef` | 块 / 节点描述 `NodeDesc` | 被 `PortDesc` 内嵌 | 电路元件引脚 |
| 可变性 | **可变** `@dataclass` | `frozen=True` | `frozen=True` | `frozen=True` |
| 身份字段 | `name`（块内唯一） | `port_id` | 无（值对象） | `name` |
| 类型表达 | 扁平 `dtype` + `fields` | 组合 `port_type: PortType` | 自描述 11 字段 | `role` 字符串 |
| 方向取值 | input/output/**inout** | input/output/**bidirectional** | `direction: str` | input/output/bidirectional/power/passive |
| 物理量/单位 | 无 | 经 `PortType` | domain/quantity/unit/dimension | 无 |
| 现状 | **已实现** | 草案 | 草案 | 已实现 |
| 是否迁移范围 | 源 | 目标 | 目标 | **否**（decision:30,50） |

---

## 2. 完整字段映射表（V1 `PortDef` → V2 `PortDesc`）

### 2.1 逐字段映射

| # | V1 字段（blocks.py:80-88） | V2 目标字段 | 映射规则 | 状态 |
|---|---|---|---|---|
| 1 | `name: str` | **无对应**（`PortDesc` 无 name，`CORE_MODEL_V2.md:83-92`） | `name` → 生成 `port_id`；原 `name` 保到 `PortDesc.metadata["legacy_name"]` | ⚠️ **语义变更** |
| 2 | `direction: str`（input/output/inout） | `PortDesc.direction`（`CORE_MODEL_V2.md:85,80`） | `input→input`、`output→output`、**`inout→bidirectional`** | ⚠️ **有损**（见 2.2） |
| 3 | `fields: list[str]` | `PortType.shape` / `PortType.dtype`（`CORE_MODEL_V2.md:73-74`） | `vector` 时 `fields` 维度 → `shape=(len(fields),)`；`signal` 时为空 → 标量 | ⚠️ **待确认**（语义不等价） |
| 4 | `dtype: str`（signal/vector/bit/any/electrical） | `PortType.dtype`（`:74`）+ `PortType.domain/quantity/unit`（`:67-69`） | `signal→dtype="float",domain="signal"`；`vector→dtype="vector"`；`bit→dtype="bit"`；`electrical→domain="circuit"`（quantity/unit=待定）；`any→` 无对应 | ⚠️ **有损/待确认** |
| 5 | `description: str` | 无同名字段 → `PortDesc.metadata["description"]`（`:92`） | 降级进 metadata | ✅ 可表达 |
| 6 | `default: float = 0.0` | **无对应**（`PortDesc`/`PortType` 均无默认值字段） | 只能 `PortDesc.metadata["default"]` | ❌ **缺失**（需拍板是否升级为正式字段） |
| 7 | `net: str`（circuit 内部网节点 id，`blocks.py:87-88`） | 无 `net`；`reference("node"/"ground")` + `component_id`（`CORE_MODEL_V2.md:89-90`） | 无法等价表达"内部网节点"；只能 `metadata["legacy_net"]` | ❌ **缺失**（语义不等价） |
| 8 | （无） | `port_id: str`（`:85`） | **新增**：由 `name` 派生 slug + 块内去重后缀 | ➕ 需新增 |
| 9 | （无，块级 `version:int=1` 仅块版本，`blocks.py:137`） | **端口 `schema_version`**（`PortDesc` 无此字段） | 建议加在 `BlockDef` payload 顶层 `ports_schema_version` | ➕ 需新增 |
| 10 | （无） | `PortType.domain: str`（`:67`） | 需补（signal/circuit/mechanical/…） | ➕ 需新增 |
| 11 | （无） | `PortType.quantity: str`（`:68`） | 需补（voltage/current/force/…） | ➕ 需新增 |
| 12 | （无） | `PortType.unit: str`（`:69`） | 需补（V/A/N/…） | ➕ 需新增 |
| 13 | （无） | `PortType.dimension: tuple[7]`（`:70`） | 需补（见 TYPED_PORT_SYSTEM.md:29-34） | ➕ 需新增 |
| 14 | （无） | `PortDesc.cardinality` / `PortType.cardinality`（`:88/:72`） | 默认 `"one"` | ➕ 需新增（默认值） |
| 15 | （无） | `PortType.connection_semantics`（`:75`） | 默认 `"causal"`（signal）/`physical_conserving`（circuit）**待确认** | ➕ 需新增 |
| 16 | （无） | `PortType.coordinate_frame` / `PortDesc.coordinate_frame`（`:76/:91`） | 默认 `""` | ➕ 需新增 |
| 17 | （无） | `PortDesc.reference`（`:89`） | 默认 `"node"` | ➕ 需新增 |
| 18 | （无） | `PortDesc.component_id`（`:90`） | 默认 `""` | ➕ 需新增 |

### 2.2 缺失项清单（`P0-2_PORT_SCHEMA_DECISION.md:12-19` 8 项要求对照）

| 要求（decision 编号） | V1 是否满足 | 依据 | 缺口 |
|---|---|---|---|
| 稳定 `port_id`（#1） | ❌ | 仅 `name`（`blocks.py:81`） | 需派生/回填 `port_id` |
| 定义/运行态分离（#2） | ✅ | `PortDef` 是纯数据，无运行时态 | 无 |
| `direction/data_type/domain/unit`（#3） | 部分 | 有 `direction/dtype`；**无 domain/unit** | 需补 `PortType` |
| 插件自定义块（#4） | ❌ | `plugin_api/v1/__init__.py:215` 未导出 | 见 §6 |
| 工程保存/加载（#5） | ✅ | `project.py` 存取 blocks | 需扩到 PortDesc |
| `schema_version`+迁移（#6） | ❌ | 仅块级 `version`（`blocks.py:137`），无端口级 | 需新增 |
| 不放可执行函数（#7） | ✅ | `PortDef` 全字段皆值类型 | 保持 |
| 不依赖 Registry 恢复（#8） | ✅（V1） | `PortDef.from_payload` 自包含（`blocks.py:104-125`） | **V2 草图却违反**（见 §7 冲突 2） |

---

## 3. JSON 序列化形式

### 3.1 现行 V1 payload（真实输出，`blocks.py:90-101,193`）

信号端口：

```json
{ "name": "vin", "direction": "input", "fields": [], "dtype": "signal", "description": "输入", "default": 0.0 }
```

电路端口（`net` 非空才出现）：

```json
{ "name": "n1", "direction": "inout", "fields": ["voltage"], "dtype": "electrical", "description": "", "default": 0.0, "net": "n_inner_3" }
```

块级：`"ports": [ …PortDef payload… ]` 内联（`blocks.py:193`）。

### 3.2 候选 A：对象内嵌（**推荐**，符合 `P0-2_PORT_SCHEMA_DECISION.md:8`）

```json
{
  "id": "blk_sum", "name": "求和", "version": 1,
  "ports_schema_version": 2,
  "ports": [
    {
      "port_id": "vin_p",
      "direction": "input",
      "cardinality": "one",
      "reference": "node",
      "component_id": "",
      "coordinate_frame": "",
      "metadata": { "legacy_name": "vin", "description": "输入", "default": 0.0 },
      "port_type": {
        "domain": "signal", "quantity": "voltage", "unit": "V",
        "dimension": [2, 1, -3, -1, 0, 0, 0],
        "direction": "input", "cardinality": "one", "shape": [],
        "dtype": "float", "connection_semantics": "causal",
        "coordinate_frame": "", "metadata": {}
      }
    }
  ]
}
```

优点：`PortDesc` 全量内嵌，**加载无需 Registry 即可还原**（满足 decision #8），与 V1「已内嵌」事实同源（`blocks.py:193`）。缺点：payload 体积增大，`PortType` 重复度高（可后续用「块内 `port_types` 字典 + 端口引用 key」的**局部**去重，但仍不依赖全局 Registry）。

### 3.3 候选 B：ID 引用式（**现状被测试写死**，`MINIMAL_DATA_MODEL_EXAMPLE.md:29-31` + `check_stage4_docs.py:219-223`）

```json
{ "id": "vin", "kind": "junction", "ports": ["vin_p"] }
```

`MINIMAL_DATA_MODEL_EXAMPLE.md:77` 明说：`ports` 的 JSON 形式是 `port_id` 字符串列表，**加载时由 `PortTypeRegistry` 按 `PortDesc` 定义转换为 `tuple[PortDesc,...]`**。

- 这实际是**方案 B**（引用 + 全局注册表恢复），与 `P0-2_PORT_SCHEMA_DECISION.md:8,19` 已裁定的方案 A 冲突。
- 校验脚本把它升格为硬门槛：`tools/check_stage4_docs.py:219-223`
  ```python
  if isinstance(ports, list) and all(isinstance(x, str) for x in ports):
      node_ports_ok = True
  ...
  if not node_ports_ok:
      errors.append("MINIMAL_DATA_MODEL_EXAMPLE.md: node ports JSON must be list[str] (converted to tuple[PortDesc])")
  ```
  同时 `check_stage4_docs.py:89-93` 又要求 `MINIMAL` 文本里出现 `ports: tuple[PortDesc`。**同一脚本同时要求"内存里是 PortDesc 元组、JSON 里是字符串列表"**——正是 `NETLAB_REVIEW_AUDIT_2026-11-12.md:112` 记录的不一致。

### 3.4 裁定建议

- 文档层面以**候选 A** 为唯一"工程文件"序列化形态（自包含、可离线还原、可校验 checksum）。
- 若确需"引用式"减小体积，限定为**块内局部 `port_types` 表**，`PortDesc` 仍在同一 payload 内，不引入跨文件/全局 Registry 依赖——这样仍满足 decision #8。
- `check_stage4_docs.py:219-223` 的 `list[str]` 断言必须随决策更新（**这是需要用户拍板的点 P1**）。

---

## 4. 旧数据迁移方案（V1 → V2）

### 4.1 现行迁移机制（事实）

- `PROJECT_FORMAT="netlab-project"`、`PROJECT_VERSION=7`（`project.py:35-36`）。
- `migrate_project(payload)` 是顺序 `if version < N` 链（`project.py:576-712`）：
  - 版本校验：非负且 `≤ PROJECT_VERSION`，否则报错（`project.py:603-609`）；
  - `version<1` 补默认分区（`project.py:611-618`）；
  - `version<2` 或无 networks → 单 network 包装（`project.py:619-629`）；
  - `version<4` → `migrate_scene_to_devices`（`:630-638`）；`<5` → `migrate_scene_rails`（`:639-654`）；`<6` → plugins/ui.profile（`:655-666`）；`<7` → 各 network 补工作台 states（`:667-683`）。
- checksum 覆盖除自身外全部字段（`project.py:92-108`），迁移后必须重算。
- 块可**引用式**存储（`id + version`，`project.py:245, 716-722`），也可内联完整 payload（`project.py:786-832` 加载时解析）。
- **场景按端口 `name` 接线**：`_scene_port_map` 从节点的 `params.input_nodes/output_nodes` 字典键推导端口名（`project.py:741-762`）——**这是迁移最大风险：改身份键会断线**。

### 4.2 V1→V2 端口升级算法（建议，伪代码）

```text
migrate_ports_v8(project):
  for block in project["blocks"]:            # 仅内联 payload；引用式先经 library 解析（project.py:786-832）
      if not isinstance(block, dict): continue
      ports = block.get("ports") or []
      for p in ports:
          if "port_type" in p: continue      # 幂等：已是 V2
          name = str(p.get("name") or "")
          p["port_id"]   = slug(name) 去重(块内已有 port_id)
          p["direction"] = "bidirectional" if p["direction"]=="inout" else p["direction"]
          p["metadata"]  = {**(p.get("metadata") or {}),
                            "legacy_name": name,
                            "description": p.get("description",""),
                            "default": p.get("default",0.0),
                            "legacy_net": p.get("net","")}
          p["port_type"] = porttype_from_dtype(p.get("dtype"), p.get("fields") or [])
          p["cardinality"]="one"; p["reference"]="node"
          p["component_id"]=""; p["coordinate_frame"]=""
          for k in ("name","fields","dtype","description","default","net"): p.pop(k,None)
      block["ports_schema_version"] = 2
  # 场景侧：把 node.params.input_nodes 的 key 由 name 视情况改写为 port_id
  #（见 4.4 风险；建议保留 name→port_id 映射表一并写入 metadata，避免断线）
```

`porttype_from_dtype` 映射：

| dtype | domain | quantity | unit | dimension | dtype | connection_semantics |
|---|---|---|---|---|---|---|
| signal | signal | 待确认 | 待确认 | 待确认 | float | causal |
| vector | signal | 待确认 | 待确认 | shape=(len(fields),) | vector | causal |
| bit | signal | — | — | — | bit | causal |
| electrical | circuit | 待确认（voltage/current） | 待确认 | 见 TYPED_PORT_SYSTEM.md:29-34 | float | physical_conserving |
| any | 待确认 | — | — | — | any | 待确认 |

### 4.3 `PROJECT_VERSION` 8 分支（新增位置）

在 `project.py:667-683` 的 `if version < 7` 之后追加：

```python
if version < 8:
    # v8：块端口 V1(PortDef) → V2(PortDesc)；幂等，保留 legacy_* 供回退
    for block in migrated.get("blocks") or []:
        _upgrade_block_ports_v8(block)
    migrated.setdefault("metadata", {})["migrated_port_schema"] = f"v{version}"
```

注意：`version` 一旦改为 8，`migrate_project` 顶部对 `version > PROJECT_VERSION` 的拒绝（`project.py:603-609`）会自动正确；旧 7 仍走已有分支再落到 8。

### 4.4 迁移风险

| 风险 | 依据 | 处理 |
|---|---|---|
| 块引用式（id+version）无内联 ports | `project.py:716-722,245` | 迁移只改内联 payload；引用式在库侧按版本另存，需 `blocklib` 一并升级（待确认 `blocklib` 位置与接口） |
| 场景按端口名接线，改名即断线 | `project.py:741-762` | 保留 `name↔port_id` 映射（写入 block.metadata），或场景继续用 name、只在块定义侧引入 port_id |
| `inout→bidirectional` 丢三态语义 | `blocks.py:164` vs `CORE_MODEL_V2.md:80` | 待确认：是否保留 `direction="inout"` 兼容值 |
| `electrical` 无 unit/quantity 依据 | `blocks.py:113`、`TYPED_PORT_SYSTEM.md:29-34` | 待确认物理量口径后再自动生成，否则置 `待确认` 占位 |
| checksum 失效 | `project.py:92-108` | 迁移末尾重算（现有流程已做，沿用） |
| `MINIMAL` 声称 `version:8` 但代码为 7 | `MINIMAL_DATA_MODEL_EXAMPLE.md:20-21` vs `project.py:36` | 以代码 7 为准，迁移后升 8；文档需同步（拍板点 P3） |

---

## 5. 不可变对象设计

目标：`PortType` / `PortDesc` 成为**自包含、可序列化、可哈希、深不可变**的值对象（`CORE_MODEL_V2.md:65,83` 已用 `frozen=True`）。

### 5.1 规则

1. **`@dataclass(frozen=True, slots=True)`**：禁止赋值、减少内存、禁止动态属性。当前草案仅 `frozen`（`CORE_MODEL_V2.md:65,83`），建议补 `slots=True`（待确认 Python 版本支持，见 5.4）。
2. **所有嵌套字段必须也是不可变或副本**：`metadata: Mapping` 用 `MappingProxyType` 包装；`dimension: tuple[int,...]` 天然不可变；`shape: tuple`。
3. **禁止可变默认**：用 `field(default_factory=...)`（草案已用于 `metadata`，`:77,:92`）。
4. **`__hash__` 一致性**：`frozen=True` 自动生成 `__hash__`，但 `metadata` 为 Mapping 时**不可哈希**——需在 `__hash__` 中按排序键值对计算，或排除 metadata（拍板点 P4）。
5. **自包含**：`to_dict()/from_dict()` 只依赖自身与内建类型，**不查全局 Registry**（decision #8）。参考 V1 已做到（`blocks.py:90-125`）。
6. **序列化稳定性**：字段顺序固定、`dimension`/`shape` 输出为数组、`metadata` 按键排序，保证 checksum 稳定（`project.py:92-108`）。
7. **禁止可执行内容**：不含 `Callable`（decision #7）；插件工厂函数留在 `ComputeSpec/ElementSpec`（`plugin_api/v1/__init__.py:22-64`），不进端口 Schema。

### 5.2 与 V1 可变 `BlockDef` 共存

- `BlockDef` 仍是可变 `@dataclass`（`blocks.py:128`），`PortDef` 可变（`:79`）。
- 建议：**端口值对象改 frozen，块容器保持可变**——块内 `ports: list[PortDesc]` 整体替换而非原地改，避免破坏 `BlockDef.__post_init__` 的端口校验（`blocks.py:160-165`）。过渡期可让 `PortDef` 继续可变，新增 `PortDesc` 并行，通过 `to_port_desc()/from_port_def()` 桥接。

### 5.3 值对象相等性

- `frozen=True` 得到结构化 `__eq__`：两个端口仅当**全字段相等**才相等，符合"值对象"语义。
- 若需稳定身份比较，用 `port_id`；若需类型等价，用 `PortType` 的 `dimension+dtype+connection_semantics`。

### 5.4 待确认

- Python 最低版本是否支持 `dataclass(slots=True)`（3.10+）——**待确认**。
- `MappingProxyType` 参与 `deepcopy`/`pickle` 的行为——**待确认**。

---

## 6. 插件接口兼容方案（`plugin_api/v1`）

### 6.1 现状 GAP

- `plugin_api/v1/__init__.py:215` 的 `__all__` **不含** `PortDef/PortDesc/PortType`；全文件 grep 无二者（仅 `ParamSpec` 导入，`:15`）。
- `ElementSpec.pins: tuple[dict[str, Any], ...] = ()`（`plugin_api/v1/__init__.py:64`）——引脚是**裸 dict**，无类型约束、无 schema。
- `ComputeSpec.factory: Callable`（`:22-35`）等带可执行字段，但端口 Schema 不应带（decision #7）。
- 结论：**插件当前无法声明 V2 端口**（`P0-2_PORT_SCHEMA_DECISION.md:29` 已记 GAP）。

### 6.2 扩展方案（**只加不改**，保 v1 兼容）

1. 新建 `netlab/plugin_api/v1/ports.py`（或 `ports_v2.py`），导出 **frozen** 的 `PortType`/`PortDesc`/`PortDirection` 与纯函数 `port_type_from_dtype()`。
2. 在 `plugin_api/v1/__init__.py` 的 `__all__` **追加**（不删除现有符号）：`"PortType","PortDesc","PortDirection"`——旧插件 import 不受影响。
3. 为插件块扩展一个**可选**声明面：新增 `BlockSpec(ports: tuple[PortDesc,...]=())` 或在现有 `ComputeSpec` 增加**带默认空值**的 `ports` 字段（`@dataclass(frozen=True)` 加尾字段不破坏旧构造）。
4. 保持 `ElementSpec.pins: tuple[dict,...]` 原样（`__init__.py:64`），**不动器件引脚面**（与 decision:50 一致）；若要类型化，另起 `pins_v2`，不替换。
5. 插件注册路径：若采用 `PortTypeRegistry.register(port_type)`（`TYPED_PORT_SYSTEM.md:72`、`CORE_INTERFACE_CONTRACTS.md:134-140` 的 Protocol），**仅用于类型校验**，不得成为工程恢复的前提（decision #8）。

### 6.3 版本策略

- `PLUGIN_API_VERSION="1.0"`（`plugin_api/v1/__init__.py:17`）保持不变；新增端口导出属于**向后兼容的次版本扩展**（1.0 → 1.1）。
- 若未来要移除旧 `pins: dict` 形态，走 `plugin_api/v2` 并行，不在 v1 内破坏。

---

## 7. 冲突与歧义清单（**不掩盖**）

| # | 冲突 | 证据（file:line） | 影响 | 建议 |
|---|---|---|---|---|
| 1 | **两套端口模型并存**：`BlockDef.PortDef`（块端口）vs `ports.PortSpec/PinSpec`（器件引脚） | `blocks.py:79-88,136`；`ports.py:1,20-55` | 命名混淆，易误迁 | 明确 PortSpec 不迁移（decision:50），文档统一加"器件引脚/块端口"前缀 |
| 2 | **方案 A vs 方案 B 冲突**：MINIMAL 依赖 `PortTypeRegistry` 恢复端口 | `MINIMAL_DATA_MODEL_EXAMPLE.md:77` vs `P0-2_PORT_SCHEMA_DECISION.md:8,19`；`CORE_INTERFACE_CONTRACTS.md:134-140` 仅有 Protocol 无实现 | 加载路径根本不同 | 以方案 A 为准，`PortTypeRegistry` 降级为校验器（拍板点 P1） |
| 3 | **JSON 形态被写死**：内存 `tuple[PortDesc]` vs JSON `list[str]` | `CORE_MODEL_V2.md:100`；`MINIMAL_DATA_MODEL_EXAMPLE.md:29-31`；`tools/check_stage4_docs.py:89-93,219-223` | CI 强制错形态，正确实现反而"报错" | 改 checker 断言为"对象数组"（拍板点 P1） |
| 4 | **迁移范围矛盾**：MIGRATION 把 `PortSpec/PinSpec` 纳入迁移 | `MIGRATION_AND_COMPATIBILITY.md:177` vs `P0-2_PORT_SCHEMA_DECISION.md:30,50` | 会误改器件库 | 修正 MIGRATION 文档，排除引脚 |
| 5 | **决策状态不一致**：P0-2 已"决策方案 A"，审计仍"需裁决" | `P0-2_PORT_SCHEMA_DECISION.md:8` vs `NETLAB_REVIEW_AUDIT_2026-11-12.md:50-51,112` | 执行口径摇摆 | 以 P0-2 决策为准，更新审计结论 |
| 6 | **版本号不一致**：文档 `version:8`，代码 `PROJECT_VERSION=7` | `MINIMAL_DATA_MODEL_EXAMPLE.md:20-21` vs `project.py:36` | 加载版本校验失败 | 以代码 7 为准，迁移后升 8（拍板点 P3） |
| 7 | **方向枚举不闭合**：V1 `inout` vs V2 `bidirectional` | `blocks.py:164` vs `CORE_MODEL_V2.md:80` | `inout` 语义丢失 | 映射为 `bidirectional`，或 V2 增补 `inout`（拍板点 P2） |
| 8 | **V2 端口无任何代码实现** | 全仓 grep 无 `PortDesc` 实现类；仅 `CORE_MODEL_V2.md:83` 草案；`CORE_INTERFACE_CONTRACTS.md:134-140` 仅 Protocol | 设计无法验证 | 先在 `core/model` 加 frozen 值对象与 `to_dict/from_dict`，再谈迁移 |
| 9 | **`direction` 双重定义**：`PortType.direction` 与 `PortDesc.direction` 重复 | `CORE_MODEL_V2.md:71` 与 `:86` | 二者不一致时语义不明 | 建议 `PortType` 去掉 direction，方向只归 `PortDesc`（拍板点 P5） |
| 10 | **`name` 语义迁移丢失**：V1 用 name 做身份与接线键，V2 无 name | `blocks.py:81,160-162`；`project.py:741-762`；`CORE_MODEL_V2.md:83-92` | 现有场景接线断裂 | 迁移保留 `name→port_id` 映射，场景键暂不改写 |

---

## 8. 需要用户拍板的点（Decision Points）

| 编号 | 问题 | 选项 | 建议 |
|---|---|---|---|
| **P1** | 工程文件里 `ports` 是**对象内嵌**（方案 A）还是**ID 引用 + Registry**（方案 B）？ | A / B | **A**（符合 P0-2 已定决策，自包含可恢复）；同步改 `check_stage4_docs.py:219-223` |
| **P2** | V1 `inout` 如何映射？ | 并入 `bidirectional` / V2 增 `inout` | 并入 `bidirectional`，并在 metadata 记 `legacy_direction` |
| **P3** | `PROJECT_VERSION` 是否升 8？文档 `version:8` 如何对齐？ | 升 8 / 保持 7 | 升 8，MINIMAL 草案标注"目标版本" |
| **P4** | `PortDesc.metadata` 是否参与 `__hash__` / 相等性？ | 参与 / 排除 | 排除 metadata 参与哈希，仅参与显示 |
| **P5** | `direction` 归属：`PortType` 还是 `PortDesc`？ | 双层 / 单层 | 单层（`PortDesc`），`PortType` 去 direction |
| **P6** | `default` / `net` 是否提升为 V2 正式字段（而非塞 metadata）？ | 提升 / metadata | 先 metadata，视求解器需求再提升 |
| **P7** | 插件如何声明端口：新增 `BlockSpec.ports` / 复用 `ComputeSpec.ports`？ | 新增 / 复用 | 新增 `BlockSpec`，不污染 `ComputeSpec` |

---

## 9. 待确认（代码无法证实）

- `blocklib.resolve_refs` 的精确接口与引用式块的版本化存储位置（仅从 `project.py:786-832` 看到调用，未读其实现）——**待确认**。
- `signal/vector/electrical` 对应的 `quantity/unit/dimension` 具体取值，文档仅给 circuit/mechanical 示例（`TYPED_PORT_SYSTEM.md:29-34`），signal 域未定义——**待确认**。
- `PortTypeRegistry` 是否已有代码实现（`CORE_INTERFACE_CONTRACTS.md:134-140` 仅为 `Protocol` 文档）——**待确认**，建议全仓 grep 复核。
- Python 运行时最低版本（决定 `slots=True` 可用性）——**待确认**。

---

## 10. 证据索引（file:line）

- `netlab/core/model/blocks.py`：`79-88` PortDef；`90-101` to_payload；`104-125` from_payload；`128-143` BlockDef；`145-165` post_init（名唯一/方向）；`160-162` 名唯一；`164` 方向集合；`167-178` 端口属性；`180-195` BlockDef.to_payload（`193` ports 内联）；`215-234` BlockDef.from_payload（`219` ports 解析）。
- `netlab/core/model/ports.py`：`1` 器件引脚 docstring；`17` ROLE_VALUES；`20-35` PortSpec；`38-55` PinSpec；`67+` PINS。
- `netlab/core/model/project.py`：`35-36` FORMAT/VERSION=7；`92-108` checksum；`245` 引用式存储；`576-712` migrate_project；`603-609` 版本校验；`611-683` 各版本分支；`716-722` `_is_block_ref`；`741-762` `_scene_port_map`；`786-832` 加载解析 blocks。
- `netlab/plugin_api/v1/__init__.py`：`15` ParamSpec 导入；`17-19` 版本常量；`22-64` Spec 类（`64` ElementSpec.pins）；`215` `__all__`。
- `netlab/docs/CORE_MODEL_V2.md`：`65-77` PortType；`80` PortDirection；`83-92` PortDesc；`95-102` NodeDesc（`100` ports 元组）。
- `netlab/docs/TYPED_PORT_SYSTEM.md`：`29-34` 物理量；`38` 量纲顺序；`42-47` 连接语义；`49-53` cardinality；`55-60` UnitRegistry；`72` 插件注册。
- `netlab/docs/MINIMAL_DATA_MODEL_EXAMPLE.md`：`20-21` version 8；`29-31` ports 字符串列表；`77` Registry 恢复。
- `netlab/docs/P0-2_PORT_SCHEMA_DECISION.md`：`8` 方案 A；`12-19` 8 项要求；`25-30` 依赖审计；`30,50` 引脚排除。
- `netlab/docs/MIGRATION_AND_COMPATIBILITY.md`：`177` 引脚误纳入迁移。
- `netlab/docs/CORE_INTERFACE_CONTRACTS.md`：`134-140` PortTypeRegistry Protocol。
- `netlab/docs/NETLAB_REVIEW_AUDIT_2026-11-12.md`：`50-51` 方案 A/B 未裁决；`112` 端口形态不一致。
- `netlab/tools/check_stage4_docs.py`：`89-93` 要求 tuple[PortDesc]；`219-223` 强制 list[str]。
