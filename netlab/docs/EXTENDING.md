# Netlab 扩展指南

> 配套文档：[ARCHITECTURE.md](ARCHITECTURE.md)（分层、运行时序、数据模型）
> 本文所有代码都按现有接口编写，可直接粘贴；示例的插入位置、测试写法、检查清单一并给出。

---

## 0. 三条硬规则

在动手之前，先接受这三个约束，能避免 90% 的返工：

1. **参数只从 `ParamSpec` 来**
   节点/连接/元件的参数必须声明为 `ParamSpec`，由 `validate_params` 统一校验并补默认值。不要自己解析 `raw_params`，否则前后端会漂移。

2. **跨步状态只放 `state`**
   `data` 是“本拍结果 + 用户可编辑数据”，会被界面编辑、导出、深拷贝；`state` 才是积分累计、滤波器抽头、振子状态、元件历史。放错位置会在导入/编辑后神秘重置。

3. **返回值必须是 JSON 原生类型**
   `handler` / 连接函数 / 元件结果的数值统一 `float(...)`，不要返回 `numpy.float64`、`set`、`bytes`。`json_safe` 会拒绝它们，报错信息通常很具体。

另外两条工程习惯：

- **不要在执行期改注册表**：`register` / `ELEMENT_SPECS[...]` 只在模块导入时做一次；运行中重复注册会抛 `RuntimeError`，多线程下更危险。
- **新功能先写测试**：本项目的测试很便宜（进程内 `TestClient`），一个 handler 的单元测试通常 10 行以内。

---

## 1. 新增节点计算方式（signal / vector）

节点是“输入字典 → 输出字典”的函数，跨步历史放在 `ctx.state`。

### 1.1 放哪里

- 想成为内置类型：写在 `computes.py` 的“对外接口”之前，紧挨同类实现。
- 想保持独立：新建模块后 `from netlab.computes import ComputeSpec, register`，但要注意**必须被导入**才会注册（`netlab/server.py` 启动时导入 `computes`；你的模块需要在某处 import，例如 `netlab/__init__.py`）。
- 不要改 `ComputeContext` 的字段；它已经包含 `name/inputs/data/state/params/dt/time`。

### 1.2 示例：速率限制器 `rate_limiter`

语义：`y` 每步最多上升 `rise·dt`、最多下降 `fall·dt`，输入是所有入边 `field` 之和。

```python
def _rate_limit_factory(params: dict[str, Any]) -> Handler:
    field = params["field"]
    output = params["output"]
    rise = float(params["rise"])
    fall = float(params["fall"])
    initial = float(params["initial"])
    if rise < 0.0 or fall < 0.0:
        raise ComputeError("速率限制的上升/下降速率不能为负")

    def handler(ctx: ComputeContext) -> NodeData:
        previous = float(ctx.state.get("y", initial))
        target = 0.0
        for payload in ctx.inputs.values():
            value = payload.get(field)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                continue
            number = float(value)
            if math.isfinite(number):
                target += number

        delta = target - previous
        limit = rise if delta >= 0.0 else fall
        step = limit * ctx.dt
        value = previous + max(-step, min(step, delta))
        ctx.state["y"] = value
        return {output: float(value)}

    return handler


register(
    ComputeSpec(
        kind="rate_limiter",
        label="速率限制器",
        group="动态",
        description="限制输入信号的变化速率：每步最多上升 rise·dt、下降 fall·dt。",
        params=(
            ParamSpec("field", "输入字段", "text", "voltage"),
            ParamSpec("output", "输出字段", "text", "voltage"),
            float_param("rise", "上升速率", 10.0, unit="1/s", positive=True, step=0.5),
            float_param("fall", "下降速率", 10.0, unit="1/s", positive=True, step=0.5),
            float_param("initial", "初值", 0.0, step=0.1),
        ),
        factory=_rate_limit_factory,
        outputs=("output",),
        notes="状态保存在节点 state.y",
    )
)
```

### 1.3 为什么这样写

| 点 | 说明 |
| --- | --- |
| 工厂只解析一次参数 | `params` 已由 `validate_params` 转成 float/str/bool，闭包里直接用 |
| 校验放在工厂里 | 参数组合非法（如下限 > 上限）在装配时立刻 422，而不是运行到一半 |
| 输入求和容错 | 缺字段/非数值/NaN 跳过；需要严格校验时用 `_numeric` 风格抛 `ComputeError` |
| 状态键名唯一 | `state["y"]` 只属于这个 kind；改 kind 时 `Scene` 会清空 state |
| 返回 `float(...)` | 避免 numpy 标量触发 `json_safe` 拒绝 |

> 如果节点需要“入边权重”或“按连接名区分来源”，参考 `computes.py` 的 `_sum_inputs` 与 `sum` 节点：`ctx.inputs` 的键是连接名。

### 1.4 测试（单元 + API）

```python
def test_rate_limiter_limits_slew():
    _spec, params, handler = prepare_compute(
        "rate_limiter", {"rise": 2.0, "fall": 1.0}
    )
    state: dict = {}
    context = ComputeContext(
        name="rl",
        inputs={"u": {"voltage": 1.0}},
        data={},
        state=state,
        params=params,
        dt=0.25,
        time=0.0,
    )
    assert handler(context)["voltage"] == pytest.approx(0.5)   # 2.0 × 0.25
    context.time = 0.25
    assert handler(context)["voltage"] == pytest.approx(1.0)   # 到顶

    context.inputs = {"u": {"voltage": 0.0}}
    context.time = 0.5
    assert handler(context)["voltage"] == pytest.approx(0.75)  # 1.0 × 0.25
    assert state["y"] == pytest.approx(0.75)


def test_rate_limiter_node_api(client):
    created = client.post(
        "/api/nodes",
        json={
            "name": "rl",
            "kind": "rate_limiter",
            "params": {"rise": 2.0, "fall": 1.0},
            "data": {"voltage": 0.0},
        },
    )
    assert created.status_code == 200
    assert created.json()["node"]["params"]["initial"] == pytest.approx(0.0)
```

前端不需要改：`/api/catalog` 会多出这个 kind，检查器按 `ParamSpec` 自动生成三个数值框。

### 1.5 检查清单

- [ ] `kind` 全局唯一（`register` 会查重）
- [ ] 每个参数都有 `ParamSpec`，默认值合法
- [ ] 工厂里做跨参数校验
- [ ] handler 不修改 `ctx.inputs` / `ctx.data`（它们是副本，改了也不会回写，容易误判）
- [ ] 数值结果 `float(...)`，必要时检查 `math.isfinite`
- [ ] 有单元测试；涉及 API 的再补一个 `client` 测试
- [ ] 如果输出 `x/y` 或 `vx/vy`，确认相图能直接读（第 8 节）

---

## 2. 新增连接函数（signal / vector）

连接是“读起点、读终点、产出字典”的纯函数；结果进入**目标节点的 `inputs[连接名]`**，不会直接改目标 `data`。

### 2.1 签名与绑定

```python
def factory(params: dict[str, Any]) -> Method:
    ...
    def method(source, target, params_view, state, dt) -> dict[str, Any]:
        ...
    return method
```

- `source` / `target` 是 `NodeView`：`.name` 与 `.data`（只读 `MappingProxyType`）。
- `params_view` 是只读参数视图；闭包里捕获的已校验参数才是常用方式。
- `state` 是这条边独立的可变字典，用于延迟、滤波器抽头、电容电压等。
- `dt` 是本拍步长；`target` 在只需要源数据的场景里可以 `del target`。

### 2.2 示例：死区 `dead_zone`

语义：`|u| ≤ width` 输出 0；否则输出 `gain·(|u|−width)·sign(u)`。

```python
def _dead_zone_factory(params: dict[str, Any]) -> Method:
    input_key = params["input_key"]
    output_key = params["output_key"]
    width = float(params["width"])
    gain = float(params["gain"])
    if width < 0.0:
        raise ComputeError("死区宽度不能为负")

    def method(source, target, _params, _state, _dt) -> NodeData:
        del target
        raw = source.data.get(input_key)
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            raise ComputeError(
                f"节点 {source.name!r} 的字段 {input_key!r} 不是数值"
            )
        value = float(raw)
        if not math.isfinite(value):
            raise ComputeError(f"节点 {source.name!r} 的字段 {input_key!r} 不是有限数值")

        magnitude = max(0.0, abs(value) - width)
        result = math.copysign(gain * magnitude, value) if magnitude else 0.0
        return {output_key: float(result)}

    return method


register(
    MethodSpec(
        kind="dead_zone",
        label="死区",
        group="信号",
        description="绝对值小于阈值的输入被压成 0，其余按增益线性通过。",
        params=(
            ParamSpec("input_key", "输入字段", "text", "voltage"),
            ParamSpec("output_key", "输出字段", "text", "voltage"),
            float_param("width", "死区宽度", 0.5, step=0.1),
            float_param("gain", "增益", 1.0, step=0.1),
        ),
        factory=_dead_zone_factory,
        outputs=("output_key",),
        notes="纯代数连接，无历史状态",
    )
)
```

### 2.3 需要历史状态时

延迟、传递函数、积分器都依赖 `state`。要点：

- 在 `method` 内用 `state.get(key, default)` 取初值，再写回；
- 键名不要与其它逻辑冲突（如 `"value"`、`"s"`、`"y"` 已被现有类型使用，扩展时换名）；
- `reset` 会清空 `state`，但**不会重置节点 `data`**；不要把初值写进 `data` 期待被清空。

### 2.4 测试

```python
def test_dead_zone_passes_outside_band():
    _spec, params, method = prepare_method(
        "dead_zone", {"width": 1.0, "gain": 2.0}
    )
    network = Network()
    source = Node("src", {"voltage": 3.0})
    target = Node("dst", {})
    network.add_node(source)
    network.add_node(target)
    network.connect("link", source, target, method, params=params)

    network.step(0.01)
    assert target.inputs["link"]["voltage"] == pytest.approx(4.0)  # 2×(3−1)
    assert target.data == {}                                      # 连接不写目标 data
```

### 2.5 关于环与延迟

- 新建边若会成环，`Scene.add_edge` 默认自动改延迟；连接函数本身不需要感知。
- 延迟边的求值时机由 `Network.step` 统一处理（步首、上一拍值），函数里不要自己 `state` 缓存“上一步”来模拟延迟——那会和框架重复。
- 电路模式的“元件”不是连接函数，别把 `MethodSpec` 和 `ElementSpec` 混用。

---

## 3. 新增电路元件（circuit）

电路元件直接参与 MNA 方程组，比连接函数多几个钩子。

### 3.1 元件生命周期

```text
构造（create_element）
  └─ __init__：解析 params、初始化 state、计算常量
每步（CircuitSolver.step）
  ├─ prepare(dt, time)：波形值 / 伴随模型电导 / 历史源
  ├─ stamp(ctx)：把贡献写入 ctx.A 与 ctx.rhs
  │    └─ 非线性元件：Newton 迭代中可能多次 stamp + update_guess
  ├─ commit(ctx)：计算 current / 电压差 / 功率，写入 self.result
  └─ solver 把 result 合并进 element.state
```

`CircuitElement` 的默认 `commit` 已经会算 `current / voltage_difference / power`，如果你的 `current(ctx)` 正确，通常不用覆盖。

### 3.2 钩子与字段

| 成员 | 何时用 |
| --- | --- |
| `kind` / `label` | 注册表与界面显示 |
| `needs_branch = True` | 需要额外解出支路电流（独立电压源、VCVS） |
| `nonlinear = True` | 需要 Newton 迭代（二极管） |
| `internal_nodes` | 元件内部节点（如二极管串联电阻的中间点） |
| `prepare` | 每步开始，计算依赖 dt/时间的系数 |
| `stamp` | 组装 A/rhs；用 `ctx.index.get(node_id)` 取未知量位置，接地返回 `None` |
| `update_guess` | 非线性迭代后更新内部猜测（并做限幅） |
| `commit` | 步末写 `self.result`，更新历史 `state` |
| `reset` | 恢复初值（参数保留） |
| `current` | 供默认 `commit` 使用 |
| `output_fields` | 默认 `("current","voltage_difference","power")` |

### 3.3 示例：保险丝 `fuse`

语义：正常时是 `ron`；电流超过 `rating` 后熔断，变为 `roff` 并保持。

```python
class Fuse(CircuitElement):
    kind = "fuse"
    label = "保险丝"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.rating = float(self.params["rating"])
        self.ron = float(self.params["ron"])
        self.roff = float(self.params["roff"])
        if self.rating <= 0.0 or self.ron <= 0.0 or self.roff <= 0.0:
            raise ComputeError("保险丝的额定电流与电阻必须大于 0")
        if not isinstance(self.state.get("blown"), bool):
            self.state["blown"] = False
        self.conductance = 0.0

    def reset(self) -> None:
        self.state["blown"] = False

    def prepare(self, dt: float, time: float) -> None:
        super().prepare(dt, time)
        self.conductance = 1.0 / (self.roff if self.state["blown"] else self.ron)

    def stamp(self, ctx: StampContext) -> None:
        g = self.conductance
        ai = ctx.index.get(self.a)
        bi = ctx.index.get(self.b)
        if ai is not None:
            ctx.A[ai, ai] += g
        if bi is not None:
            ctx.A[bi, bi] += g
        if ai is not None and bi is not None:
            ctx.A[ai, bi] -= g
            ctx.A[bi, ai] -= g

    def current(self, ctx: StampContext) -> float:
        voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        return voltage * self.conductance

    def commit(self, ctx: StampContext) -> None:
        voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        current = voltage * self.conductance
        self.result = {
            "current": float(current),
            "voltage_difference": float(voltage),
            "power": float(voltage * current),
        }
        if not self.state["blown"] and abs(current) > self.rating:
            self.state["blown"] = True
```

注册（放在 `ELEMENT_SPECS` 字典之后，或直接写进字典字面量）：

```python
ELEMENT_SPECS["fuse"] = ElementSpec(
    kind="fuse",
    label="保险丝",
    description="超过额定电流后熔断，熔断后保持高阻。",
    params=(
        float_param("rating", "额定电流", 1.0, unit="A", positive=True, step=0.1),
        float_param(
            "ron", "导通电阻", 1.0e-3, unit="Ω",
            positive=True, minimum=1.0e-9, step=1.0e-3,
        ),
        float_param(
            "roff", "熔断电阻", 1.0e9, unit="Ω",
            positive=True, minimum=1.0, step=1.0e6,
        ),
    ),
    cls=Fuse,
    notes="熔断状态保存在连接 state.blown",
)
```

### 3.4 为什么用 `prepare` 算电导

`stamp` 可能在 Newton 迭代里被调用多次，**不要在 `stamp` 里改历史状态**；`prepare` 每步只调用一次，适合把 `state["blown"]` 翻译成电导。`commit` 里再根据本步结果更新 `blown`，顺序是：

```text
prepare（用旧状态） → stamp → solve → commit（更新状态）
```

如果反过来（在 stamp 里改 state），Newton 迭代会看到不一致的状态。

### 3.5 测试

```python
def test_fuse_blows_and_latches():
    scene = Scene("circuit")
    ground = scene.add_node(name="gnd", kind="ground")
    source = scene.add_node(name="src", kind="node")
    scene.add_edge(
        source=source.id, target=ground.id, kind="vsource",
        params={"wave": "dc", "offset": 10.0},
    )
    fuse = scene.add_edge(
        source=source.id, target=ground.id, kind="fuse",
        params={"rating": 1.0, "ron": 1.0, "roff": 1.0e9},
    )

    scene.step(1.0e-3)                 # 10 A > 1 A
    assert fuse.state["blown"] is True
    scene.step(1.0e-3)                 # 熔断后电流 ~1e-8 A
    assert abs(fuse.state["current"]) < 1.0e-6
```

### 3.6 检查清单

- [ ] `stamp` 只读 `self.conductance` 等预计算量，不推进状态
- [ ] 接地节点 `ctx.index.get(...) is None` 时跳过对应行列
- [ ] 需要支路电流时设 `needs_branch = True`，并在 `current` 里读 `ctx.solution[self.branch_index]`
- [ ] 非线性元件设 `nonlinear = True`，实现 `update_guess` 并做限幅
- [ ] 内部节点 `internal_nodes` 命名唯一，避免与已有 id 冲突
- [ ] `reset` 恢复所有历史键
- [ ] `state` 初始值在 `__init__` 里补齐（导入旧场景时可能没有新键）
- [ ] 有数值测试；最好再加一个模板，让界面能一键复现

---

## 4. 新增场景模板

模板是“一键可复现的实验”，也是最好的文档。

### 4.1 builder 形状

```python
def rate_limit_demo() -> dict[str, Any]:
    return {
        "mode": "signal",
        "nodes": [
            _node("e00000000001", "src", "manual", -360, 0, data={"voltage": 1.0}),
            _node(
                "e00000000002", "rl", "rate_limiter", -80, 0,
                params={"rise": 2.0, "fall": 2.0},
            ),
            _node(
                "e00000000003", "out", "gain", 200, 0,
                params={"field": "voltage", "output": "voltage", "gain": 1.0},
            ),
        ],
        "edges": [
            _edge(
                "f00000000001", "src_path",
                "e00000000001", "e00000000002", "scale",
                params={"input_key": "voltage", "output_key": "voltage", "gain": 1.0},
            ),
            _edge(
                "f00000000002", "rl_path",
                "e00000000002", "e00000000003", "scale",
                params={"input_key": "voltage", "output_key": "voltage", "gain": 1.0},
            ),
        ],
    }


TEMPLATES["rate_limit_demo"] = {
    "label": "速率限制演示",
    "mode": "signal",
    "description": "阶跃输入经过速率限制器，观察输出斜坡。",
    "builder": rate_limit_demo,
}

SIM_PRESETS["rate_limit_demo"] = {"fps": 30, "dt": 0.01, "steps_per_frame": 1}
```

### 4.2 规则

| 项 | 规则 |
| --- | --- |
| `mode` | 必须是 `Scene.MODES` 之一 |
| 节点 `id` | 12 位十六进制（`check_id` 允许 `[0-9a-fA-F-]{1,40}`），场景内唯一 |
| 节点 `name` | 场景内唯一，≤32 字符，不能含控制字符/HTML 元字符 |
| 节点 `kind` | 必须已注册；电路模式只能是 `node` / `ground` |
| 边 `kind` | signal/vector 用 `METHOD_SPECS`；circuit 用 `ELEMENT_SPECS` |
| 参数 | 可以只写部分，`validate_params` 会补默认值；未知键会 422 |
| 成环 | signal 导入时会自动加延迟；**vector 不会**，模板里要显式 `"delay": True` |
| `sim` | builder 不用返回；`build_template` 自动附加 `SIM_PRESETS`，`Simulation.load_scene` 读取 |

### 4.3 测试

```python
def test_rate_limit_template_steps():
    payload = build_template("rate_limit_demo")
    assert payload["sim"]["fps"] == 30
    scene = Scene(payload["mode"])
    scene.load_payload(payload)
    scene.step(0.25)
    assert node_voltage(scene, "rl") == pytest.approx(0.5)
```

再补一个 API 测试：

```python
def test_rate_limit_template_api(client):
    response = client.post("/api/templates/rate_limit_demo")
    assert response.status_code == 200
    body = response.json()
    assert body["scene"]["mode"] == "signal"
    assert any(node["kind"] == "rate_limiter" for node in body["scene"]["nodes"])
```

---

## 5. 新增参数类型（`ParamSpec.type`）

这一步前后端必须同步改，否则会出现“表单能显示但提交不上”或“服务端接受但界面不认”。

### 5.1 后端两处

`params.py` 的 `ParamSpec.coerce` 加分支：

```python
if self.type == "color":
    text = as_str(value, label)
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", text):
        raise ValidationError(f"{label}必须是 #RRGGBB 颜色")
    return text
```

`to_dict` 已经把 `type/default/help` 带上；如果新类型需要额外字段（如 `min/max`），在这里补序列化。

### 5.2 前端两处

- `buildParamField`：决定控件。颜色可以用 `<input type="color">`。
- `collectParamValues`：决定提交值。颜色可以直接取 `input.value`；数值类型要转 `Number`。

```javascript
} else if (type === 'color') {
  control = el('input');
  control.type = 'color';
  control.value = value || '#000000';
}
```

```javascript
if (type === 'color') {
  values[key] = input.value;
}
```

### 5.3 检查清单

- [ ] `coerce` 有严格校验与可读错误
- [ ] `to_dict` 带上前端需要的字段（`choices/min/max/step/placeholder`）
- [ ] `buildParamField` 与 `collectParamValues` 都处理了
- [ ] 有校验测试（合法值、非法值、默认值）
- [ ] 更新 `docs/ARCHITECTURE.md` 第 8.4 节的类型表（可选但推荐）

---

## 6. 新增一种模式（较大改动）

**先判断是否真的需要。** 大多数需求可以在现有模式里加 kind 解决；`vector` 就是“signal 引擎 + 不同前端呈现”，没有新增引擎。只有求解语义真的不同（比如 PDE、离散事件）才值得加模式。

### 6.1 后端改动点

| 位置 | 要做什么 |
| --- | --- |
| `scene.py` `MODES` | 加入新名字 |
| `Scene._normalize_node_params` | 新模式的节点 kind 校验与参数归一化 |
| `Scene._normalize_edge_params` | 新模式的边/元件参数归一化 |
| `Scene.ensure_engine` | 映射到新引擎（实现 `step/reset/probes/stats`） |
| `Scene.catalog()` | `modes` 列表加 `{value,label,description}` |
| `Scene.add_edge` | 环/延迟/自环规则是否不同 |
| `Scene.probes` | 探针字段是否不同 |
| `server.switch_mode` | `{"新名字": "blank_新名字"}` |
| `server.clear_scene` | 新模式的清空模板 |
| `templates.py` | `blank_新名字` builder + `SIM_PRESETS` |
| `simulation.default_simulation` | 不需要；默认仍是 signal_chain |

新引擎的最小接口：

```python
class MyEngine(_Engine):
    def __init__(self, scene: Scene) -> None: ...
    def step(self, dt: float) -> None: ...
    def reset(self) -> None: ...
    def probes(self) -> dict[str, float]: ...
    def stats(self) -> dict[str, Any]: ...
```

引擎构造时要把 `NodeRecord.data/state/inputs` 按引用接过去（与 `SignalEngine` 一致），否则界面看不到实时值。

### 6.2 前端改动点

| 位置 | 要做什么 |
| --- | --- |
| `modeLabel` | 新名字 → 中文标签 |
| `kindListFor` | 新模式从哪个 catalog 源取节点/边 |
| `getNodeSpec` / `getEdgeSpec` | 若 catalog 结构不同，补映射 |
| `updateModeUI` | pill / 状态栏 / 面板提示 |
| `switchMode` | 确认弹窗与 `/api/mode` 调用 |
| `renderNodeInspector` / `renderEdgeInspector` | 新模式是否显示 data 编辑器/延迟开关 |
| `drawNodes` / `drawEdges` | 新可视化（如场、端口） |
| `state.workspace` / `index.html` | 若需要独立工作区，参考 `femStage` 的显隐 |

### 6.3 测试

至少覆盖：

```text
[ ] /api/mode 切到新模式 → scene.mode 正确、空白模板载入
[ ] 新模式新增节点/连接 → 200，参数校验生效
[ ] step 若干步 → 无 error，probes 有值
[ ] 导出/导入 roundtrip
[ ] 前端手动冒烟（切模式、添加、运行、面板）
```

---

## 7. 新增 HTTP 接口

### 7.1 读接口

```python
@app.get("/api/nodes/{node_id}/inputs")
def node_inputs(node_id: str) -> dict[str, Any]:
    with SERVICE.lock:
        node = SERVICE.scene.nodes.get(node_id)
        if node is None:
            raise NotFoundError(f"节点 {node_id!r} 不存在")
        return {"inputs": copy.deepcopy(node.inputs)}
```

### 7.2 写接口

```python
class CloneNodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    node_id: str


@app.post("/api/nodes/clone")
def clone_node(request: CloneNodeRequest) -> dict[str, Any]:
    def apply(scene: Scene) -> Any:
        source = scene.nodes.get(request.node_id)
        if source is None:
            raise NotFoundError(f"节点 {request.node_id!r} 不存在")
        return scene.add_node(
            name=f"{source.name}-copy",
            kind=source.kind,
            params=source.params,
            data=source.data,
            position={"x": source.position["x"] + 40, "y": source.position["y"] + 40},
        )

    record = SERVICE.mutate(apply)
    snapshot = SERVICE.snapshot()
    snapshot["node"] = record.snapshot()
    return snapshot
```

要点：

- 参数校验/业务错误直接抛 `NetlabError` 子类，异常处理器会转成 `{"detail"}`。
- 写操作一律通过 `SERVICE.mutate`，不要 `with SERVICE.lock: ...` 手工改场景再自己保证重建。
- 返回快照（或至少 `{node, sim, revision}`），前端才能同步。
- 路由顺序：`/api/nodes/{node_id}` 会吃掉同方法下的静态路径；新增静态子路径时放在动态路由之前，或换路径前缀。
- 请求体 `extra="forbid"`，可空字段用 `| None` + `exclude_unset`。

### 7.3 测试

```python
def test_clone_node_api(client):
    scene = client.get("/api/state").json()["scene"]
    source = scene["nodes"][0]
    response = client.post("/api/nodes/clone", json={"node_id": source["id"]})
    assert response.status_code == 200
    body = response.json()
    assert len(body["scene"]["nodes"]) == len(scene["nodes"]) + 1
    assert body["node"]["name"] == f"{source['name']}-copy"
```

---

## 8. 改前端（渲染 / 面板 / 交互）

`app.js` 是单文件 IIFE，按第 0–10 段组织。新增功能时先定位段，不要全文件搜。

### 8.1 加一个节点上的可视元素

```javascript
// 在 drawNodes() 里，节点圆与文字绘制之后
function drawNodeBadge(node, sx, sy) {
  const text = String(nodeDisplayData(node).mode || '');
  if (!text) return;
  ctx.save();
  ctx.fillStyle = '#a8541f';
  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text, sx, sy - NODE_RADIUS - 8);
  ctx.restore();
}
```

调用后要 `requestDraw()`；不要每帧无条件重绘。

### 8.2 加一个侧边面板

1. `index.html` 增加 `<section id="tab-xxx" class="tab-pane">` 与对应 `<button class="tab" data-tab="xxx">`；
2. `app.js` 的 `switchTab` 已经按 `data-tab` 通用处理，无需改；
3. 在 `boot()` 里 `renderXxxPanel()` 初始化；
4. 在 `applySnapshot` / `pollLive` 里更新数值；
5. 面板内的输入统一走 `el/div/button`，文本用 `textContent`。

### 8.3 加一个画布手势

- 命中测试：`hitTest`、`nearestNodeWithin`；
- 指针状态：`state.drag`（拖拽）或自定义 `state.xxxDrag`；
- 松手提交：参考 `flushPositions` 的防抖批量提交；
- 键盘：`bindStaticEvents` 的 `keydown` 分支，注意 `isFormTarget` 优先。

### 8.4 三条前端约束

1. **不拼 HTML**：不用 `innerHTML`，所有用户内容 `textContent` / `value`。
2. **catalog 驱动**：节点/边/参数表单不要硬编码；新增 kind 应自动出现。
3. **按需重绘**：`requestDraw()` / `scheduleChartDraw()` / `schedulePhaseDraw()`，不要自己 `setInterval` 全量重绘。

---

## 9. 改 FEM

### 9.1 加一个配置项

按这条链改，缺一处就会出现“界面有但后端不认”或反之：

```text
FemConfig（dataclass 字段）
  → FemConfigUpdate（server.py 的 Pydantic 模型）
  → FemSimulation.apply_config（读取 + as_float/as_int 校验 + 范围）
  → FemModel 使用该字段
  → 前端 renderFemPanel（控件）+ readFemConfig（收集）+ updateFemPanelValues（回填）
  → 测试：PATCH /api/fem/config 后快照里出现新字段
```

注意 `FemConfigUpdate` 的字段默认是 `None`，`apply_config` 用 `if "xxx" in payload` 判断是否更新。

### 9.2 改方程/材料

- 各向异性导热：`_element_matrices` 里把标量 `conductivity` 换成 `kx/ky` 两个梯度项；
- 新边界条件：目前 `dirichlet` 只标记左右列；对流/绝热需要在 `_build_factorization` 的约化与 RHS 里加项；
- 新热源：改 `_source_vector`，注意仍在参考单元 2×2 Gauss 点上积分；
- 新单元类型：`build_mesh` 的连接表与 `_shape` 要一起改，且 `FemModel._assemble` 假定 4 节点。

### 9.3 改渲染

`drawFem` 依赖：

```text
mesh.x / mesh.y / mesh.elements / mesh.left / mesh.right
field（与 mesh.x 等长）
stats.min / stats.max
```

改网格后这些仍然成立即可；若新增标量场，需要在 `FemModel` 里输出，并在 `drawFem` 里换色标。

### 9.4 性能注意

- `dt` 变化 → 重新分解（`_build_factorization`）；不要每步改 dt。
- 网格/材料/边界变化 → 重建 `FemModel`；改这些参数会让时间归零。
- 每帧录制的是整个温度场，`MAX_FEM_FRAMES = 900`；调大前先评估内存。

---

## 10. 新增数值算法 / 波形 / 离散化

### 10.1 新波形

1. `waveform.py` 的 `WAVE_KINDS` 加 `(value, label)`；
2. `waveform_value` 加分支（注意 `frequency <= 0` 与 `delay` 的退化行为）；
3. 测试：`waveform_value({...}, t)` 的若干个时间点；
4. 信号节点与电压/电流源会自动获得新选项（共用 `WAVEFORM_SPECS`）。

> 波形约定：`dc` 只返回 `offset`，`amplitude` 不参与；`step` 返回 `offset + amplitude`；
> 周期波（`sine/square/triangle/saw/pulse`）才使用 `amplitude/frequency/duty`。
> 写直流源时用 `{"wave": "dc", "offset": 10.0}`，不要写 `amplitude`——这是新增元件示例里踩过的坑。

### 10.2 新离散化方法

1. `statespace.py` 的 `DISCRETIZATION_METHODS` 加选项；
2. `linalg.cont2discrete`（或 `StateSpaceModel.step` 的分支）实现矩阵；
3. 用解析解或 SciPy `cont2discrete` 对比测试；
4. `state_space` 节点的参数下拉会自动出现。

### 10.3 新线性代数工具

`linalg.py` 只依赖 NumPy。新增函数时：

- 输入先 `np.asarray(..., dtype=float)`；
- 检查 `np.all(np.isfinite(...))`；
- 失败抛 `ComputeError`，不要抛裸 `LinAlgError`；
- 加数值测试（小矩阵、奇异矩阵、边界情况）。

---

## 11. 测试怎么写

### 11.1 三种测试

| 对象 | 写法 | 例子 |
| --- | --- | --- |
| 节点 handler | 直接构造 `ComputeContext` | 第 1.4 节 |
| 连接函数 | `Network` + `Node` + `connect` | 第 2.4 节 |
| 元件/场景 | `Scene` + `add_node/add_edge/step` | 第 3.5 节 |
| API | `client` fixture + `TestClient` | 第 1.4 / 4.3 节 |
| 模板 | `build_template` + `Scene.load_payload` | 第 4.3 节 |

### 11.2 现成工具

```python
from netlab.tests.test_netlab import template_scene, node_voltage, edge_state
```

（如果不想跨测试文件 import，就在本文件复制四个小函数；它们只是便利包装。）

`client` fixture 在每个测试前暂停仿真并载入 `signal_chain`；需要干净场景时显式 `client.post("/api/scene", json=build_template("blank_signal"))`。

### 11.3 数值断言

- 浮点比较一律 `pytest.approx`，必要时给 `rel/abs`；
- 电路/ODE 的结果依赖 dt，测试里把 dt 写小一点（如 `1e-4`）再断言趋势；
- 发散/奇异场景用 `pytest.raises(ComputeError, match="...")`，匹配中文关键词即可。

### 11.4 运行

```bash
cd netlab
python -m pytest tests -q
python -m pytest tests -q -k "rate_limit"
python -m pytest tests -q -x
```

---

## 12. 提交前检查清单

| 类别 | 检查项 |
| --- | --- |
| 注册 | `kind` 唯一；`group`/`label`/`description` 完整；`outputs` 与真实返回一致 |
| 参数 | 全部 `ParamSpec`；默认值合法；跨参数校验在工厂里；未知参数会被拒 |
| 状态 | 跨步量在 `state`；`reset` 能恢复；导入旧场景缺键时有默认值 |
| 数值 | 返回 `float`；检查 `isfinite`；有发散/奇异保护；不产生 NaN |
| 线程 | handler/元件里不 sleep、不阻塞、不起线程、不发 HTTP |
| JSON | 不返回 numpy/自定义对象；字符串长度、数组大小在上限内 |
| 前端 | 若新增参数类型/模式/面板，前后端两处都改了；仍用 `textContent` |
| 测试 | 单元 + 场景/API 至少各一条；全量测试通过 |
| 文档 | 更新 `docs/ARCHITECTURE.md` 的类型表/模块表；必要时加 README 说明 |

---

## 13. 反模式（踩过的坑）

1. **在 `data` 里存积分累计**：导出/编辑/重置后会丢。用 `state`。
2. **handler 里改 `ctx.inputs` 或 `ctx.data` 后期待回写**：传入的是副本；只有返回值会合并。
3. **连接函数写目标节点 `data`**：`NodeView` 是只读的，写了会抛错；正确做法是返回字典，由目标节点决定怎么用。
4. **在 `stamp` 里改元件状态**：Newton 迭代会多次调用，状态会抖动；历史更新放 `prepare` / `commit`。
5. **用 `eval` 或 `exec` 处理表达式**：项目已有 `safeexpr.py`，新增表达式类功能必须走它。
6. **运行中动态 `register` 同一个 kind**：`RuntimeError`；热重载时尤其注意。
7. **忘记 `float(...)`**：`numpy.float64` 会被 `json_safe` 拒绝，报错点在连接/节点，不在你的算法。
8. **在电路里加延迟边**：`Scene.add_edge` 会 422；电路靠 MNA 解反馈，不需要延迟。
9. **vector 模板忘了 `delay: True`**：导入不会自动补，会报代数环。
10. **每步分配大数组**：`probes`、`json_safe`、深拷贝都在热路径；大规模扩展先 profile。
11. **前端硬编码 kind 列表**：新增类型不会出现；一律从 `state.catalog` 取。
12. **只改后端不改前端参数控件**：新类型/新模式会出现“能提交但无法编辑”。

---

## 14. 常用代码索引

| 想参考什么 | 去看 |
| --- | --- |
| 最简单的节点 | `computes.py` 的 `manual`、`gain` |
| 带状态的一阶动态 | `computes.py` 的 `lag`、`integrate` |
| 复杂节点 + RK4 | `computes.py` 的 `oscillator`、`nonlinear_plant` |
| 带参数的连接 | `methods.py` 的 `scale`、`clamp` |
| 带历史状态的连接 | `methods.py` 的 `delay`、`tf`、`integrator` |
| 双向/矢量连接 | `methods.py` 的 `vector_diffusion` |
| 线性元件 | `nodal.py` 的 `Resistor`、`Capacitor`、`Inductor` |
| 带支路电流的元件 | `nodal.py` 的 `VoltageSource`、`VCVS` |
| 非线性元件 | `nodal.py` 的 `Diode` |
| 场景模板 | `templates.py` 的 `signal_chain`、`rc_step`、`nonlinear_control` |
| 二维矢量模板 | `templates.py` 的 `vector_network` |
| 固定步长线程 | `simulation.py` 的 `Simulation._loop` |
| 增量接口 | `simulation.py` 的 `Recorder.since`、`Simulation.live` |
| FEM 装配/推进 | `fem.py` 的 `FemModel._assemble` / `_build_factorization` / `step` |
| 动态表单 | `app.js` 的 `buildParamField` / `collectParamValues` |
| 画布渲染 | `app.js` 的 `drawGraph` / `drawNodes` / `drawEdges` |
| 轮询 | `app.js` 的 `pollLoop` / `pollLive` / `pollFem` |

---

## 15. 最小工作流（推荐）

新增一个功能时，按这个顺序做，通常一轮就能过：

```text
1. 写 handler / method / element（先不注册）
2. 用 Python REPL 或临时脚本直接喂输入，确认数值对
3. 注册 Spec
4. 写单元测试（handler 级）并跑通
5. 写场景/模板（可选）与 API 测试
6. 启动服务，手动点一遍：添加菜单出现、检查器表单正确、运行有数据
7. 跑全量测试
8. 更新文档（ARCHITECTURE 的类型表 / 本指南的索引）
```

第 2 步能省掉大量“为什么界面上是 0”的排查——先把算法跑对，再接框架。
