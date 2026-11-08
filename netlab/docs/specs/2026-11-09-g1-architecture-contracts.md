# G1 架构契约（严格审计 §4 A1/A2/A3/A6 + §9 C1/C2）

- 日期：2026-11-09
- 依据：`docs/NETLAB_PLOTKIT_STRICT_AUDIT_2026-11-09.md` §4、§9、§10、§11
- 目标：把「架构达标」从行数口径改成可机检契约，并让契约进 CI；同时落地 C1（契约单一真源）与 C2（双版本兼容矩阵）。

## 验收（可复现）

1. `python tools/check_architecture.py` 输出 A1 依赖方向、A2 环、A3 模块级可变单例、A6 冷启动四项结果，任一硬失败 exit 1，并写 `reports/architecture.json`。
2. `pytest netlab/tests/test_architecture_contracts.py -q` 覆盖：core 不 import server/desktop/plotkit、无环、白名单外零可变全局、冷启动不加载 server/plotkit。
3. `python tools/check_contracts.py` 校验 `docs/canonical/contracts/schemas/*.json` 与 `frontend/app/contracts.ts`、`netlab/contracts/generated.py` 一致；漂移 exit 1。
4. `pytest netlab/tests/test_contract_schemas.py -q` 用 jsonschema 校验 channel key、frame、project、plot spec 样例。
5. `pytest netlab/tests/test_compat_matrix.py -q` 校验 `compatibility.yaml` 与 `plotkit_bridge` 的 min/max、`API_VERSION` 一致，并覆盖 available/missing/incompatible 三态。
6. CI `python-tests` 跑 `check_architecture.py` 与 `check_contracts.py`；两处均绿才可合入。

## 边界

- 本轮只做契约与校验，不重写 `core` 领域文件，不改 PlotKit 渲染实现。
- A3 现有模块级可变全局先登记白名单（原因 + 到期日），后续按白名单逐项迁移；新增白名单外条目即失败。
- C1 的 schema 是唯一真源；`frontend/app/contracts.ts` 与 `netlab/contracts/generated.py` 为生成物，由 `tools/gen_contracts.py` 重生成，禁止手改。
