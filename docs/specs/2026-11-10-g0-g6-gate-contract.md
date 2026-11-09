# Netlab G0–G6 闸门契约（仓内 SSOT）

> 本文件是 `netlab/docs/specs/2026-11-09-g0-g4-signoff.md` 的**当前仓内规则 SSOT**。内容根据 2026-11-10 会话日志重建自已删除的 `NETLAB_AGENT_PROMPT_2026-11-10.md`（原 revision `2da6c36022715c48a7ded311c31019001aff6026e57fa2a49d00211d3c6bc55b`）。它提供当前可读的规则出处，但**不等同于原始用户授权或批准原文**；授权/追认仍须以可核验的用户原文或 S4 逐项签字为准。本文所称 `docs/` 均指 `NetlabHome` 仓库根下的 `docs/`（工作区路径为 `NetlabHome/docs/`）。

## 1. 阶段与唯一目标

| 阶段 | 内容 | 完成判据 |
|---|---|---|
| S0 | 推送授权裁定 | 用户书面授权并逐字指定待推 HEAD；无授权不得 push（X1） |
| S1 | 补 D-5 新指纹报告 + 修 changelog 门结构 | `check_solver_change.py --base <base>`、`--self-test`、`render_docs.py --check` 全 exit=0；报告含三态 + 独立参考解 |
| S2 | 推送并拿远端首绿 | 新 HEAD 上 python-tests / frontend-ts-build / container 三 workflow 全 success，且 python-tests step 3 与 D-5 步骤通过、step 4–24 未被 skipped |
| S3 | 回填签字表缺口 | 逐行 diff 清单 + `render_docs.py --check` 零漂移 + 三 CI 绿 + 绑定新 HEAD 与 run URL |
| S4 | 用户逐闸签字 | 用户签字列由用户本人填写；agent 不代签、不代选 |
| S5 | 用户书面放行后启动 N6 | 见第 5 节；无放行不得改 `graph.py`/`scene.py` |

S0–S2 是唯一硬阻塞目标。S3 不要求签字、S4 不催促、S5 不预建 G5。

## 2. 红线 X1–X17（全部生效）

- **X1** 禁止自行 `git push` / `force-push` / `rebase` / `amend` / `reset` / 改 `.git/config` 与代理网络设置。任何 push 须用户书面授权并逐字指定 HEAD。
- **X2** 禁止改写远端历史；禁止用 tree 等价冒充“本地/远端一致”。
- **X3** 禁止事后补豁免。`docs/waivers.md` 是历史授权/追认的核查登记，不是授权本身；事后追认不能改写为事前批准，也不能追溯授权未来动作。任何未找到可核验原文的历史事项只能列为「待用户明确追认」，不得由 agent 自证。
- **X4** 禁止把未 tracked 产物写成“已有”；`reports/` 只有 11 个 tracked 文件，`architecture.json` / `bench.jsonl` / `crossval.json` 仍不存在。
- **X5** 禁止把影子门、advisory 诊断或本机全绿当作正确性证据；正确性硬门是 `tests/evals` 的解析解/收敛阶/变异体。
- **X6** 证据基线必须重新钉死，禁止沿用本文件历史快照；远端 SHA 与本地 `origin/main` 引用分开记。
- **X7** 禁止放宽判据：禁 `>=` 替换 `==`、禁改阈值、禁 skip 失败用例、禁 `pytest -k` 冒充全量。
- **X8** 禁止靠补 `docs(readme):` 提交刷绿的记录链；尤其禁止用第 10 个 `docs(readme)` 掩盖 changelog 门。
- **X9** 禁止用 `numstat` 增删差证明“纯搬运等价”；禁止双份手工同步 TS/JS（改 `.ts` 后必须 `npm run build` 生成 `.js`）。
- **X10** 单轮 ≤5 文件；超出拆轮。
- **X11** 禁止把「证据齐全」写成「达标」；未签字即结论留白，后续闸门一律留白。
- **X12** 两套 G 编号禁止混用：`NL-G0–G6`（本契约）与 `PK-G0–G4`（PlotKit 双绿 + X4 零命中 + docs<1MB）同名不同义；本次只谈 NL。
- **X13** 禁止代签、禁止伪造批准原文或消息号；找不到授权出处只能写「待追认」。
- **X14** 签字前禁止启动 N6、禁止改 `netlab/core/model/graph.py` / `scene.py`、禁止写「N6 已启动」。
- **X15** 本契约自包含，禁止引用已删除的 `docs/NETLAB_*_2026-11-09.md`；禁止据记忆复原旧条款。
- **X16** 禁止用无 `--base` 的 `check_solver_change.py` 假绿作为通过证据。
- **X17** 禁止把 PlotKit 的跨仓双绿、或 `pyproject.toml:26` / `plotkit_bridge.py:129,191` 的 `plotkit>=0.2,<0.3` 硬编码状态，算作 Netlab G4 已达成或未达成。

## 3. 7 列证据格式

签字表正文固定 7 列：

```
| 阶段 | 锚点 HEAD | 命令全文 | 输出摘要 | 判据逐条 | 结论 | 遗留 |
```

实际签字表可在第 8 列增加「用户签字」，该列只由用户填写；第 8 列本身须用户在 S4 明确追认（原契约为 7 列）。

## 4. NL-G0–G6 判据（机器可判）

| 闸门 | 判据（必须同时满足） | 证据位置 |
|---|---|---|
| **NL-G0 基线 + 首绿** | 重新记录 `date` / 工作树 / `git rev-parse HEAD` / `git status --short` / `git rev-list --left-right --count origin/main...main` / 远端 main；三 workflow 全 success；python-tests step 3 与 D-5 步骤 success 且 step 4–24 未被 skipped；S3 锚点允许绑定「上一已推送 HEAD + 本提交 run URL」（本提交仅改文档时） | 签字表 G0 行 + 三 run URL |
| **NL-G1 需求可验证** | B-1 `bench_sparse_off_vs_auto.py` 输出 `passed=true` 且 ratio 在 VISION 判据内；B-2 43 条均有 `user_scenario/failure_cost/verify_command/expected/failure_condition`，`check_requirement_verifiability.py --ids R01,R43,R26` 全 PASS（其余 40 条静态 schema 明示为残余风险）；B-3 `check_status_freshness.py` 输出 `OK: status fresh at <HEAD>` | 签字表 G1 行 + `reports/test_status.json` |
| **NL-G2 端到端可复算** | `e2e_control_experiment.py` 退出 0，`error_table.json` 每项 error 在 limit 内；`--plant-scale 1.05` 变异必红；`plot_spec.json` 走 canonical `plot_semantics.yaml` | 签字表 G2 行 + `reports/e2e/*` |
| **NL-G3 数值变更防线** | `check_solver_change.py --self-test` 退出 0；compute 改动必须带 `reports/shadow/<fingerprint>.json`，含 off/shadow/on 三态 + 独立参考解 + `max_rel_error<1e-10`；不得用无 `--base` 假绿 | 签字表 G3 行 + `reports/shadow/*` |
| **NL-G4 文档单一真源** | `render_docs.py --check` 退出 0；`docs/canonical/requirements.yaml` 43 条、`decisions.yaml` 150 条；PROGRESS/BACKLOG 头部与索引由生成器产出、零漂移 | 签字表 G4 行 + `docs/canonical/*` |
| **NL-G5 P3/A′ 文档收窄** | `2026-11-09-n5-p3-audit.md` 按 §7.4 五项表述；withdrawal-list 含严格五项 + 15 处其他 P3 保留；§7.131 独立命名；不得写「P3 部分修复」 | 签字表 G5（未签字前只列证据） |
| **NL-G6 收尾/剩余项闭环** | N7 P5 PROGRESS 分片、N8 待裁定项均有结论；最终 `PROGRESS.md` ≤300 行/分片、`check_docs` 零漂移、三 CI 绿 | 签字表 G6（未启动前留白） |

## 5. S4/S5 边界与 N6

用户回复只允许三种：①「G0–G4 全部签字」（仅放行 N6，不含 PlotKit G4、不含 X1/X8 事后豁免、不含批准 B；也不自动追认 `docs/waivers.md` 的 W-01/W-02/W-03，W 事项须用户逐项填写）；②指出某闸补证据或改结论；③改目标顺序。收到①且仅在此之后才允许启动 N6：

- N6 目标：`graph.py:1076 capture_step_state()` 从 O(n) 浅快照改为增量事务 / undo log / COW。
- 机器判据：n=100/1000/10000 的开销斜率与置信区间、回滚后逐字段相等、回放 N 步状态一致。
- 改 `netlab/core/**` 会再次触发 D-5 硬门：须重生成新指纹三态报告 + 独立参考解 + `--self-test`，否则 N6 推送必红。
- G5 证据表签字列继续留白；不得预填、不得代签。

## 6. 阶段交付格式

每阶段交付必须包含：新 HEAD、`git status --short`、命令全文、输出摘要、判据逐条、三 run URL、遗留项、以及「用户签字：留白」。禁止写「已完成」「全部收敛」「达标」等结论性措辞，除非该阶段有远端 CI 全绿且用户已逐闸签字。

## 7. 批准出处与 waivers

`docs/waivers.md` 记录三条 W 事项：W-2026-11-10-01 G0 rebase+push、W-2026-11-10-02 A′ 裁定（§7.4 五项）、W-2026-11-10-03 X8 changelog 门降级。任何一项找不到可核验原文时，本文件与签字表统一写「待用户追认」；「G0–G4 全部签字」不自动追认 W 事项，用户须在 S4 逐项填写追认栏。
