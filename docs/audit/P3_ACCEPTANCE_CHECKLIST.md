# NetLab Core V2 总验收清单（P3-08）

> 状态：**验收清单草案，未签署**。基线 main `5c076eae`；本清单对应分支 `feat/2026-11-25-p3-core-v2` 的本地工作。
> 原则：没有证据的项一律记“未完成”，不得用加权平均掩盖阻断项；CI 未跑通不得宣称 Core V2 通过。

## 1. 验收门定义

| 门 | 含义 | 判定方式 |
|---|---|---|
| G0 | 契约冻结 | `CORE_V2_CONTRACT_FREEZE.md` 评审通过；`test_core_v2_contract.py` 全绿；API 快照无差异 |
| G1 | Schema/版本一致 | `check_version.py` + 文档扫描无 v7 当前版本残留 |
| G2 | 单一 StampBuilder | 静态装配只经 `stamp_element_static`；8 类元件逐项对拍相等；电感例外有记录 |
| G3 | AC 后端收敛 | 同一电路 fast/native/强制 native 三路 Bode 逐点一致（rtol=1e-8/atol=1e-12） |
| G4 | analysis 分层 | `analysis.py` 只保留编排与再导出，数值/错误模块可独立测试 |
| G5 | 工作台四层 | model/render/interaction/facade 依赖方向单向；模块行数 ≤800 |
| G6 | app.ts 拆分 | router/store/views/commands/handlers 分层；endpoint 后端契约 88 条不变；前端快照 91 唯一路径/101 方法+路径条目；app.ts ≤8000、单文件 ≤800 |
| G7 | GPU/FEM 边界 | GPU 异常回退 CPU；FEM 边界枚举与时间积分可插拔且非法值报 `ValidationError` |
| G8 | 总验收 | G0..G7 全部通过 + 6 项必需 CI 全绿 + 全量测试 0 失败 |

## 2. 逐项验收表

| ID | 交付物 | 验收标准 | 当前状态 | 证据/缺口 |
|---|---|---|---|---|
| P3-01 | `docs/audit/CORE_V2_CONTRACT_FREEZE.md` + `netlab/tests/test_core_v2_contract.py` | CF-01..CF-14 可断言；G0 评审通过 | **本地完成，待评审** | 20 passed（与 test_fem 合跑）；已提交 192c783 |
| P3-02 | analysis 分层 | analysis.py 仅编排/再导出；错误与数值纯函数独立 | **本地完成，待评审** | analysis.py 2771→85 行 facade；新增 analysis_metrics/transfer/envelopes/loop/scan 五个模块（451/588/688/673/569 行）；`test_analysis_layering.py` 断言公共符号与 facade 同一对象、无循环导入；全量 pytest 1811 passed/14 skipped/0 failed，覆盖率 87%；提交 a3ccfa8 |
| P3-03 | 单一 StampBuilder | `_assemble_matrices` 无 kind 矩阵特判；9 路 kind 全走共享函数；逐项对拍 | **已实现（P2-01 已合入）** | `stamp_builder.py` + `test_stamp_parity.py` 8 passed；电感例外见 CF-06 |
| P3-04 | ac_sweep strategy | 统一入口；策略优先级与 Bode 对拍 | **已实现（P2-02 已合入）** | `ac_backend.py` + `test_ac_backend.py` 6 passed；CF-07..09 已断言 |
| P3-05 | 工作台四层 | 依赖方向单向；行数门禁 | **本地完成，待评审** | 新增 analysis_chart_model/interaction 纯层（analysis_chart 786→718）；`check_analysis_layers.mjs` 守卫 24 个分析图/工作台模块：≤800 行、仅允许同层或更低层 import、反向依赖报错；`test:utils` 96 passed；提交 a3ccfa8 |
| P3-06 | app.ts 拆分 | endpoint 快照不变；冒烟通过；行数门禁 | **部分完成（契约守护 + 多片拆分 + S1/S2/S3/S4 + router/handlers/views 首片）** | 已新增 `frontend/tools/app_endpoint_snapshot.json`（91 个唯一路径 / 101 个方法+路径条目）与 `frontend/tests/app_endpoints.test.mjs`（3 条，`node --test` 通过），扫描范围扩展至抽取模块；app.ts 由 7511 降至 4463，工作台面板/图表渲染（b5288f4）、场景面板/场景动作（1f27eca）、回放控制 analysis_replay（cc8922b）、信号列表 signal_list（6800cfc）、端点注册表 endpoints.ts（S1，ea8413d）、会话状态 store.ts（S2，1625eeb）、命令层 commands.ts（S3，729bf6e）、外壳视图 shell_view.ts（S4，66d8272）、路由 router.ts、网络处理器 handlers.ts、视图 views.ts 首片已拆出（57211fc，空白修正 e1fcd10）；typecheck/build/test:utils 96 passed/parity/sections/端点快照/L1 smoke 全绿；P3-05 分层守卫亦覆盖工作台既有模块；完整 handlers/views 迁移与入口仅装配未完成 |
| P3-07 | GPU/FEM 边界 | GPU 非有限回退 CPU；FEM 枚举非法拒绝 | **部分完成** | GPU 回退（`test_accel_fallback.py` 5 passed）、FEM 边界/CN（`test_fem.py` 8 passed）已落地；更细的 GPU 初始化错误矩阵与 FEM 时间积分扩展仍可加强 |
| P3-08 | 本清单 | G0..G7 + CI + 全量测试 | **清单已交付（G8 未通过）** | 本文件即 P3-08 交付，当前仅作为验收基线 |

## 3. 阻断性验收条件（任一不满足即不得报通过）

1. **契约测试**：`python -m pytest netlab/tests/test_core_v2_contract.py -q` 全绿；
2. **全量测试**：`python -m pytest netlab/tests mathspec/tests -q` 0 failed/0 error，覆盖率 ≥81%；
3. **API 快照**：`test_analysis_api_surface.py` 0 差异；
4. **前端等价**：`npm run typecheck`、`npm run build`、`npm run test:utils`、`verify_app_parity.js`、`check_app_sections.mjs` 全绿；
5. **必需 CI**：build / docker / desktop-l2 / e2e / e2e-l1 / test 六项全绿（以 GitHub PR 实际结果为准）；
6. **隐私与提交卫生**：无会话、凭证、内网地址、本机绝对路径提交；无 `reports/` 原始隐私报告入库；
7. **无未决 API 破坏**：若有，必须给出 major 版本与迁移说明，否则阻断。

## 4. 验收执行顺序

1. 契约评审（G0）→ 2. 版本/Schema 扫描（G1）→ 3. StampBuilder 对拍（G2）→ 4. AC 三路对拍（G3）；
5. analysis 分层（G4）→ 6. 工作台四层（G5）→ 7. app.ts 拆分（G6）→ 8. GPU/FEM 边界（G7）；
9. 全量测试 + 前端门禁 + 必需 CI（G8）。

## 5. 当前证据索引

- `netlab/tests/test_core_v2_contract.py`：本次新增，20 passed（与 `test_fem.py` 合跑）。
- `netlab/tests/test_fem.py`：FEM 边界/时间积分 8 passed。
- `netlab/tests/test_stamp_parity.py`：8 类元件静态装配逐项相等。
- `netlab/tests/test_ac_backend.py`：fast/native/强制 native 三路 Bode 对拍。
- `netlab/tests/test_accel_fallback.py`：GPU 非有限回退 CPU。
- `netlab/tests/test_analysis_api_surface.py` + `fixtures/analysis_api_snapshot.json`：analysis 对外 API 快照。
- 最新全量证据（P3 分支）：`python -m pytest -q` 1811 passed/14 skipped/0 failed；`python -m coverage report --format=total` 87%（≥81）；历史基线 `reports/evidence/python-tests.json` 1789 passed/14 skipped/0 failed、覆盖率 82.70%。

## 6. 结论与签署

- 当前可以确认：**契约文本已形成、P3-01/P3-02/P3-03/P3-04/P3-05/P3-07 的本地证据成立**；
- 当前不能确认：P3-06 的完整 handlers/views 迁移尚未完成，app.ts 入口尚未收敛为仅装配，必需的 GitHub CI 尚未执行，G0/G2/G5/G6 评审尚未签字；
- 因此本清单结论为：**未达到 Core V2 总验收（G8 未通过）**，不得对外宣称完成；
- 签署人：__________（项目负责人）　日期：__________
