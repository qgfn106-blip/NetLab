# 核心代码问题整改设计（8 项，只读设计·未实施）

> 性质：**只读整改设计**。本轮**不修改任何生产代码**（`solver.py` / `descriptor.py` / `graph.py` / `simulation.py` / `project.py` / `scene_types.py` / `blocks.py` 均不改）。每项给出：位置（`file:line`）、根因、影响、最小修复方案、失败测试（先红）、回归测试、风险。
> 事实基线：GitHub `main = 8f9344f`；最新生产代码 `212a890`；本轮全量 953 passed / 1 skipped / 322.70s，core line 81.528757%。日期：2026-11-13。
> 约束：不改 FEM、不做 `graph.py` / `scene.py` 大规模结构重构、不改外部工程格式；所有修复须先有可复现失败测试，不得放宽断言使测试变绿。

## 汇总（风险分级与依赖）

| # | 模块:行 | 问题 | 严重度 | 类型 | 依赖 | 本轮状态 |
|---|---------|------|--------|------|------|----------|
| 1 | `compute/simulation.py:565-627` | 预计算失败/取消 Runtime 恢复不完整 | 中 | 状态一致性 | — | 仅设计 |
| 2 | `compute/circuit/solver.py:271-280` | `capture_checkpoint` 未保存 `_startup_pending` | 中 | 状态一致性 | — | 仅设计 |
| 3 | `compute/circuit/solver.py:446-475` | Source Stepping 最后一次 Newton 遗漏 `deadline` | 中 | 超时契约 | — | 仅设计 |
| 4 | `model/graph.py:568-660` | `solver_plan` 断点重新引入依赖边、排序失败任意追加 | 高 | 执行顺序正确性 | — | 仅设计 |
| 5 | `model/graph.py:893-982` | 非线性 SCC Newton 重复推进外部状态连接 | 高 | 数值正确性 | 需 4 的计划语义清晰 | 仅设计 |
| 6 | `model/project.py:967-985` | `decode_project_bytes` 解压后才判 8MB（zip-bomb） | 高 | 内存安全/DoS | — | 仅设计 |
| 7 | `model/scene_types.py:13-22` | `is_known_mode` 非字符串缺类型防护 | 低 | 健壮性 | — | 仅设计 |
| 8 | `model/blocks.py:148-149` | 插件模式 ↔ BlockDef 模式边界不一致 | 中 | 契约一致性 | 需用户定策略 | 仅设计 |

依赖顺序（建议）：先 7（低风险、解锁健壮性）→ 6（安全）→ 2/3（求解器小修）→ 1（运行时状态对齐）→ 8（需先定策略）→ 4 → 5（执行计划语义清晰后）。全部实施前需用户明确授权。

---

## 1. simulation.py：预计算失败/取消时 Runtime 状态恢复不完整
- **位置**：`netlab/core/compute/simulation.py:565-627`（`precompute`：步首快照 `before_scene/before_time/before_steps/before_last_sample/before_recorder`；失败分支 :618-627 逐项 restore，`self._frame_times.clear()` 于 :627）。
- **根因**：快照集只覆盖 `{scene payload, time, steps, _last_sample_time, recorder, error}`，与突变集不对齐——**未快照 `_frame_times`**（步首清空，失败时仅清空不恢复旧值），也未快照/恢复引擎内部瞬态缓存与 `_precompute_progress["running"]`。
- **影响**：预计算中途失败或取消后，`_frame_times` 与已恢复的 recorder 帧数不一致（帧时间轴错位），后续进度查询/再次预计算读到脏统计；引擎缓存可能残留半推进状态。
- **最小修复**：增加 `before_frame_times = list(self._frame_times)`、`before_progress = dict(self._precompute_progress)`，失败分支恢复二者；或抽 `_runtime_state_snapshot()/restore()` 使快照集与突变集一致。不改计算逻辑。
- **失败测试**：monkeypatch 令某步 `evaluate` 抛异常，断言 after == before 的 `{time, steps, _last_sample_time, _frame_times, recorder frames, progress.running}`。
- **回归测试**：现有 precompute 取消/完成测试；正常帧序列字节级不变。
- **风险**：低（仅状态字段对齐）。

## 2. solver.py：capture_checkpoint 未保存 _startup_pending
- **位置**：`netlab/core/compute/circuit/solver.py:271-280 capture_checkpoint`（dict 仅含 time/solution/node_voltages/last_iterations/last_solve_ms/elements）；`_startup_pending` 定义 :151；`restore_checkpoint`（:282+）未恢复它。
- **根因**：checkpoint 缺 `_startup_pending` 字段，回滚后该标志保留失败步中被污染的值。
- **影响**：失败步回滚后求解器「启动待处理」状态不一致，下一拍可能跳过/重复启动逻辑（初始化 guess / source ramp），导致重试结果 ≠ 干净运行。
- **最小修复**：checkpoint 增加 `"startup_pending": self._startup_pending`；restore 中 `self._startup_pending = bool(checkpoint.get("startup_pending", self._startup_pending))`。
- **失败测试**：构造 step 中途失败，断言 restore 后 `_startup_pending` 回到步首值。
- **回归测试**：现有 solver 回滚/重试一致性测试。
- **风险**：低。

## 3. solver.py：Source Stepping 最后一次 Newton 调用遗漏 deadline
- **位置**：`netlab/core/compute/circuit/solver.py:446-475`：source stepping 循环内 Newton 调用带 `deadline=deadline`；**最后收敛步 `_newton_solve(dt, 0.0, solution, source_scale=1.0, mode=mode)`（:470 附近）未传 `deadline`**。
- **根因**：最后一次调用漏传 `deadline`，该次 Newton 不受时间预算约束。
- **影响**：病态电路最后一次 Newton 可能长时间 hang，超过调用方 deadline 却不受控，破坏超时契约。
- **最小修复**：最后调用补 `deadline=deadline`，与循环内其余调用一致。
- **失败测试**：注入慢收敛场景 + 短 deadline，断言超时抛 `ComputeError`（当前会 hang / 超时不可控）。
- **回归测试**：source stepping 正常收敛路径结果不变。
- **风险**：低（仅补参数）。

## 4. graph.py：solver_plan 对状态断点重新引入依赖边，排序失败后任意追加组件
- **位置**：`netlab/core/model/graph.py:568-660 solver_plan`：断点作 singleton 追加（`components.extend([[node] for node in breakpoints])`）；`component_edges` 由**全部 enabled 边**（含指向断点的边）构建；Kahn 后若有环，`ordered.extend(index for index ... not in ordered)` **任意追加**剩余组件。
- **根因**：断点语义是「读上一拍状态、可在同拍先算」，但构建组件边时仍保留**进入断点的依赖边**，使 `direct→breakpoint` 与 `breakpoint→direct` 形成组件级环；Kahn 无法全序时按索引任意追加，得到**非拓扑顺序**。
- **影响**：含「状态断点 + 直接馈通」混合的网络，执行计划顺序可能违反真实依赖，一拍内求值顺序错误（数值不正确）且**静默**（不报错）。
- **最小修复**：构建 `component_edges` 时**跳过 target 为断点组件的边**（断点组作 source、indegree=0，先行）；若 Kahn 后仍有未排序组件，**raise `ComputeError`**，不得任意追加。
- **失败测试**：构造 breakpoint↔direct 混合网络，断言计划中所有断点先于依赖它们的 direct 组件；无环不 raise，人为环时 raise。
- **回归测试**：纯 DAG 网络 `solver_plan` 顺序不变。
- **风险**：中（涉及执行顺序，需充分对拍；仅影响 R36/P1 结构描述时应不改 `step` 默认行为）。

## 5. graph.py：非线性 SCC Newton 迭代重复推进外部状态连接
- **位置**：`netlab/core/model/graph.py:893-982 _solve_nonlinear_stage`；`residual()`（:922）每次调用 `self._evaluate_node(node, values, index, delayed_payloads, dt)`；Newton 每迭代做 `size+1` 次 residual（含有限差分列探测 :945-950）。
- **根因**：`_evaluate_node` 会求值进入 SCC 的**外部非延迟连接**；若这些连接有状态（源缩放/滤波器），每次 residual 调用都推进其状态 → 每步被推进 `O(iterations×(size+1))` 次，而非 1 次。
- **影响**：含外部有状态连接馈入非线性 SCC 的网络，每拍外部连接状态被多次推进，数值结果依赖迭代次数（不确定/偏大），违背串行语义。
- **最小修复**：进入 Newton 前对**外部状态连接输出做一次冻结快照**（类比 `delayed_payloads`），`_evaluate_node` 用冻结值而非实时 evaluate；外部连接每步仅在步首推进一次。
- **失败测试**：SCC + 外部有状态源连接，记录该连接 evaluate 次数/状态增量，断言每步恰好 1 次（当前 >1）。
- **回归测试**：纯内部 SCC（无外部状态连接）结果不变。
- **风险**：中（触及代数路径数值，需对拍）。

## 6. project.py：decode_project_bytes 完整解压后才执行 8MB 限制
- **位置**：`netlab/core/model/project.py:967-985 decode_project_bytes`：`body = zlib.decompress(raw[len(PROJECT_MAGIC):])`（:972）**先完整解压**，再 `if len(body) > MAX_PROJECT_BYTES: raise LimitError`（:978）；`MAX_PROJECT_BYTES = 8_000_000`（:38）。
- **根因**：大小上限在完整解压之后才校验 → 恶意/超大压缩体（zip-bomb）在内存中先膨胀到任意大小才被拒，OOM/DoS 风险。
- **影响**：加载不可信工程文件可致内存耗尽。
- **最小修复**：改用 `zlib.decompressobj()` 分块解压，累积长度一旦超过 `MAX_PROJECT_BYTES` 立即 `raise LimitError`（如 `decompress(data, MAX_PROJECT_BYTES+1)`，若 `unconsumed_tail` 非空即超限）；再对解压结果做 canonical/checksum 校验。`save_project` 侧已在压缩前判 `len(body)`（:1004），保持一致。
- **失败测试**：构造高压缩比 >8MB 解压体，断言抛 `LimitError` 且未产出完整 body。
- **回归测试**：正常 <8MB 工程 decode 结果字节级不变。
- **风险**：低（读路径）。

## 7. scene_types.py：is_known_mode 对非字符串输入缺少类型防护
- **位置**：`netlab/core/model/scene_types.py:13-22 is_known_mode(mode: Any)`：`if mode in MODES`（tuple，安全）→ 否则 `return mode in ENGINE_SPECS`（**dict，要求 hashable**）。
- **根因**：传入不可哈希类型（list/dict/set）时 `mode in ENGINE_SPECS` 抛 `TypeError: unhashable type`，而非返回 `False`。
- **影响**：上层对 mode 字段做合法性检查时遇非 str 会异常崩溃而非友好拒绝。
- **最小修复**：函数首行 `if not isinstance(mode, str): return False`。
- **失败测试**：`is_known_mode([])` / `is_known_mode({})` 返回 `False` 不抛；`is_known_mode("circuit") is True`。
- **回归测试**：现有 plugin mode 判定测试。
- **风险**：低。

## 8. blocks.py：插件模式与 BlockDef 模式限制之间的边界
- **位置**：`netlab/core/model/blocks.py:148-149 BlockDef.__post_init__`：`if self.mode not in ("signal","vector","circuit"): raise ValidationError("功能块 mode 必须是 signal/vector/circuit")`；对比 `scene_types.is_known_mode`（内置 `MODES` ∪ `ENGINE_SPECS`，含插件模式）。
- **根因**：BlockDef 硬编码只允许 3 内置模式，而场景层用 `is_known_mode` 允许插件注册模式，二者边界不一致 → 插件自定义 mode 的功能块无法定义（尽管场景层接受该 mode）。
- **影响**：插件引擎的 mode 无法打包为功能块（BlockDef 拒绝），限制 R40 插件能力；语义不一致。
- **最小修复**（二选一，需拍板）：① BlockDef 模式校验改用 `scene_types.is_known_mode(self.mode)`（保留 `model` 的 behavioral/structural 校验），并在文档声明插件模式允许范围；② 若刻意仅允许内置，则显式记录该决策并在 `is_known_mode` 对 BlockDef 场景收紧。
- **失败测试**：注册一个 `ENGINE_SPECS` 插件模式后，构造该 mode 的 BlockDef 应成功（当前 raise）。
- **回归测试**：内置 3 模式构造不变。
- **风险**：中（触及模型边界与插件契约，需明确策略与文档）。

---

## 9. 修复状态与本轮边界
- 8 项均为**仅设计（未实施）**；本轮不改任何生产代码，符合任务书「先审计和整改准备、不开展大规模重构」。
- 全部实施前需用户明确授权；每项已给「先红」失败测试设计，禁止放宽断言使测试变绿。
- 未覆盖/待授权：真实 Runtime 级联调（不能用 Fake 对象冒充）、`graph.py`/`scene.py` 大规模结构调整、FEM 相关（硬冻结）、外部工程格式变更。
