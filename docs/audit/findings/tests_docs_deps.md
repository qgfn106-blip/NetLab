# 测试体系 / 文档 / 依赖声明 / 隐私安全 审计报告

- 审计基线：**HEAD = 5c076ea**（NetLab 3.20.2 / Project Schema 8）
- 工作树：`.`
- 审计人：audit-tests（只读审计，未修改任何源码/文档）
- 方法：`git show HEAD:<file>` 读取基线内容；`python -m pytest --collect-only -q` 仅采集不跑用例；全部结论附 file:line 原文。

---

## 0. 重要前提：工作树并非“干净基线”（必须先告知 lead）

任务描述称“基线干净”，但实测 **工作树相对 HEAD 有 13 个文件的未提交改动**，且存在另一个会话的 WIP stash：

```
$ git log --oneline -3
5c076ea fix(analysis): 断环 Bode/Nyquist 改用解析开环传函
...
$ git stash list
stash@{0}: On main: other-session-wip-1855
$ git diff --stat
 .github/workflows/python-tests.yml         | 13 ++-----------
 README.md                                  |  2 +-
 netlab/core/model/path_guard.py            |  2 +-
 netlab/docs/BUILD_AND_PACKAGING.md         |  4 ++--
 netlab/docs/CODE_GUIDE.md                  |  2 +-
 netlab/docs/EXTENSIBILITY_ARCHITECTURE.md  |  4 ++--
 netlab/docs/MIGRATION_AND_COMPATIBILITY.md |  6 +++---
 netlab/docs/PLUGIN_GUIDE.md                |  2 +-
 netlab/requirements.txt                    |  1 +
 netlab/tests/test_plotkit_degraded.py      |  4 ++--
 13 files changed, 19 insertions(+), 24 deletions(-)
```

该 WIP 已在工作树中**部分修复** P1-03（README/BUILD/CODE_GUIDE/PLUGIN_GUIDE/requirements.txt）与 P1-04（EXTENSIBILITY/MIGRATION）。**本报告所有结论一律以 HEAD 5c076ea 基线为准**（用 `git show HEAD:` 取证），并在相关条目注明“工作树已被 WIP 改动”。lead 若要审“当前工作树”，需注意二者差异。

---

## 1. P0-04 测试体系

### 1.1 测试目录结构
- `pytest.ini:2` — `testpaths = netlab/tests mathspec/tests`（两套测试根都在采集范围）。
- `pytest.ini:3-5` — `python_files = test_*.py`；`pythonpath = .`；`addopts = -ra`。**pytest.ini 未配置任何覆盖率参数**（覆盖率仅在 CI workflow 中强制）。
- `netlab/tests/`：**217 个 .py 文件**，其中 `def test_` 定义 **1346 个**（`ops_grep '^\s*def test_' outputMode=summary` → 1346）。
- `mathspec/tests/`：存在且被采集（如 `mathspec/tests/test_telemetry.py` 大量参数化用例）。
- `netlab/tests/conftest.py` 存在；fixtures 目录 `netlab/tests/fixtures/projects/` 含 `grid_inverter_avg.netlab`、`grid_inverter_current.netlab`、`grid_inverter_switch.netlab`、`legacy/migrate_golden.json`、`legacy/scene_json.json` 等。

### 1.2 pytest 用例数量级（实测采集）
- 执行 `python -m pytest --collect-only -q`（Python 3.13.9）→ **collected 1748 items in 16.72s**（netlab/tests + mathspec/tests 合计，参数化展开）。即 **千级用例规模，约 1.7k 条可收集用例**。
- 旁证：`docs/canonical/decisions.yaml:1076` 仍写“全量 `python -m pytest netlab/tests -q` → 678 passed / 1 skipped”，该数值已明显过时（当前采集即 1748 条，且不含 mathspec 之外的差异口径）。

### 1.3 benchmarks
- `netlab/tests/benchmarks/test_benchmark_contracts.py` 存在（benchmarks 子目录已纳入)。

### 1.4 覆盖率门槛
- `.github/workflows/python-tests.yml:123` — `--cov=netlab/core --cov-branch --cov-fail-under=81` → **核心模块硬门槛 81，与任务口径“覆盖率门槛 81”一致**。
- `.github/workflows/python-tests.yml:134` — `python tools/diff_coverage.py --coverage coverage.json --base "$DIFF_BASE" --threshold 80` → **diff coverage 门槛 80**。
- **不一致（旁证，P0-04 附带）**：`docs/canonical/decisions.yaml:1071-1072` 写“`netlab/core/*` 设硬门限（基线实测 **81%**，`--cov-fail-under=78` ratchet 只升不降）”——文档写 `--cov-fail-under=78`，而 CI 实际为 `81`。文档口径落后于 CI，建议核对（`git show HEAD:.github/workflows/python-tests.yml:123` 确为 81）。
- `tools/diff_coverage.py:58` — `parser.add_argument("--coverage", default="coverage.json")`，默认阈值见其 argument（CI 显式传 `--threshold 80`）。

**P0-04 结论**：测试体系存在且规模正常（千级/1748 采集、217 测试文件、benchmarks 在、mathspec 测试在、核心覆盖率门槛 81 + diff 80）。唯一问题：`decisions.yaml:1071-1076` 覆盖率/用例数与 CI 现状已脱节（78 vs 81；678 vs 1748）。

---

## 2. P2-07 tools/check_requirement_verifiability.py 审查

文件：`tools/check_requirement_verifiability.py`（48 行）。

- **仅查必填字段（存在性）**，`check_requirement_verifiability.py:29-31`：
  ```
  for key in ("user_scenario", "failure_cost", "verify_command", "expected", "failure_condition"):
      if not req.get(key):
          failures.append(f"{req['id']}: 缺字段 {key}")
  ```
  → 只判断“字段非空”，**未校验 expected 与 failure_condition 的语义内容**（二者多为通用模板，见下）。
- **执行 verify_command 并做粗糙字符串判定**，`:34-35`：
  ```
  proc = subprocess.run(req["verify_command"], cwd=ROOT, shell=True, capture_output=True, ...)
  ok = proc.returncode == 0 and "failed" not in proc.stdout.lower() and "error" not in proc.stdout.lower()
  ```
  → 只检查 **返回码 == 0** 且 **stdout 不含子串 "failed"/"error"**；**完全忽略 stderr**（stderr 只在失败时打印 tail，不参与 ok 判定）。任何正常输出若含 "error"/"failed" 子串都会误判 FAIL（假阳性）。
- **不支持 --all**：`:24-25` argparse 仅 `--ids`（逗号分隔）与 `--sample`（default 3），**无 --all 选项**。默认只抽 `:18` `["R01","R43", 中位]`，即默认仅跑 3 条。
- **R01–R43 数量核实**：`docs/canonical/requirements.yaml` 共 **43 条**（`ops_grep '^\s*- id:\s*R[0-9]+' count=43`，首 R01、尾 R43）。
- **expected / failure_condition 为通用模板（语义空转证据）**，`docs/canonical/requirements.yaml` R01：`verify_command = "python -m pytest netlab/tests/test_workspace.py -q"`、`expected = "退出码 0（全部 passed）"`、`failure_condition = "命令退出码非 0，或输出含 failed/error"`——与检查器判据同构，属于对所有需求雷同的套话，检查器无法据此区分需求是否“可验证”。

**P2-07 结论**：确认——只查 5 个必填字段是否存在 + 返回码/stdout 的 failed/error 子串，**未做 expected 与 failure_condition 的语义校验**；**无 --all**；仅 R01/R43/中位 3 条默认抽查；requirements 共 R01–R43 计 43 条。

---

## 3. P1-03 PlotKit 依赖声明冲突

基线（HEAD 5c076ea）中 PlotKit 版本声明四处不一致：

| 位置 | 声明 | 证据（git show HEAD） |
| --- | --- | --- |
| `pyproject.toml:18` | **plotkit>=0.3,<0.4**（必装，注释称“必需内部插件，不再是可选 extra”） | `pyproject.toml:17-18` |
| `README.md:176` | **PlotKit（可选）>=0.2,<0.3** | `README.md:176` |
| `netlab/docs/BUILD_AND_PACKAGING.md:56` | `plotkit>=0.2,<0.3`；**`:67` 又钉死 `plotkit==0.2.1`** | BUILD_AND_PACKAGING.md:56,67 |
| `netlab/docs/CODE_GUIDE.md:341` | `plotkit>=0.2,<0.3` | CODE_GUIDE.md:341 |
| `netlab/docs/PLUGIN_GUIDE.md:57` | `plotkit>=0.2,<0.3` | PLUGIN_GUIDE.md:57 |
| `netlab/requirements.txt` | **未声明 plotkit**（仅 fastapi/uvicorn/numpy/scipy） | `git show HEAD:netlab/requirements.txt` |

- **PlotKit 实际版本 = 0.3.0**：`PlotKit/pyproject.toml:7` `version = "0.3.0"`。
- **是否缺 pywebview？→ 不缺，已声明**：`netlab/requirements-desktop.txt:3` `pywebview>=4.0`（同文件 `:4` `pythonnet>=3.0`）；`pyproject.toml:27` desktop extra 亦含 `pywebview>=4.0`。
- **冲突结论**：pyproject 要求 0.3.x 且标“必需”，但 README/BUILD/CODE_GUIDE/PLUGIN_GUIDE 仍写 0.2.x（BUILD 另钉 0.2.1），`requirements.txt` 干脆不列 plotkit。**以实际 0.3.0 + pyproject `>=0.3,<0.4` 为准，上述 4 处文档与 requirements.txt 均过时/自相矛盾。**
- 工作树 WIP 已把 README:176→“必需内部插件 >=0.3,<0.4”、BUILD/CODE_GUIDE/PLUGIN_GUIDE 改 0.3、requirements.txt 补一行；但**基线仍为冲突状态**。

---

## 4. P1-04 版本常量与文档不一致

源码事实（未改动文件）：
- `netlab/core/model/project.py:37` — `PROJECT_VERSION = 8`
- `netlab/core/model/project.py:38` — `APP_VERSION = "2.1.0"`

仍写“Project Version 7 / 工程 v7 / PROJECT_VERSION=7”的文档（**基线 HEAD，精确 file:line**）：
- `README.md:25` — “工程文件（`*.netlab`，当前 `version: 7`）”（当前版本号过期）
- `README.md:145` — “插件 API v1、**工程 v7**、UI profile、EngineProtocol”（链接描述过期）
- `netlab/docs/EXTENSIBILITY_ARCHITECTURE.md:598` — “## 9. **工程格式 v7（PROJECT_VERSION = 7）**”
- `netlab/docs/EXTENSIBILITY_ARCHITECTURE.md:625` — “（当前 `PROJECT_VERSION = 7`）”
- `netlab/docs/MIGRATION_AND_COMPATIBILITY.md:12` — 表格“工程版本 | `PROJECT_VERSION = 7`”
- `netlab/docs/MIGRATION_AND_COMPATIBILITY.md:47` — “`.netlab` 的 `PROJECT_VERSION=7`”
- 另：源码自身 docstring 也过时——`netlab/core/model/project.py:147` “校验并规范化…（工作台多状态，PROJECT_VERSION 7）”。

**结论**：代码 `PROJECT_VERSION=8 / APP_VERSION=2.1.0`，但 README 2 处 + EXTENSIBILITY 2 处 + MIGRATION 2 处 + project.py docstring 仍宣称 v7 / PROJECT_VERSION=7，**属明确过期文档**（历史迁移章节 v0→v7 的叙述可保留，但“当前 PROJECT_VERSION=7”的断言错误）。工作树 WIP 已修 EXTENSIBILITY/MIGRATION，但 **README:25、README:145 与 project.py:147 docstring 仍未修**。

---

## 5. P1-05 README 的 MyProject/ 示例在干净仓库不存在

- `.gitignore:20` — `MyProject/`（整目录被排除）。
- **干净仓库无 MyProject**：`git ls-files | grep -i myproject` → 无输出。
- 但多处文档强引用 `MyProject/`：
  - `README.md:44` — “`MyProject/` 提供可直接打开的运行示例…例如并网逆变器控制链示例：`grid_inverter_avg.netlab`、`pll_template.netlab`、`grid_inverter_current.netlab`、`grid_inverter_switch.netlab`”
  - `OPERATION.md:149` — “`MyProject/` 下有三个可载入的示例工程：”
  - `ARCHITECTURE.md:143` / `:145` — “示例应用（`MyProject/`）…可运行示例位于 `MyProject/`”
- **examples/ 现状**：仅 1 个文件 `examples/demo.netlab`（933 B），无 README 所述 4 个并网逆变器示例。
- **fixtures 现状**：上述同名 `.netlab` 实际存在于 `netlab/tests/fixtures/projects/`（`grid_inverter_avg.netlab`、`grid_inverter_current.netlab`、`grid_inverter_switch.netlab` 等）——即示例数据以**测试 fixture**形式存在，但**不在 README 所指的 `MyProject/`，也不在 `examples/`**。

**结论**：新克隆（干净仓库）打开会缺 `MyProject/` 目录，README/OPERATION/ARCHITECTURE 三处示例指引落空；示例实际只散落在 `netlab/tests/fixtures/projects/`（测试用）与 `examples/demo.netlab`（单一）。建议改指向 examples/ 或说明 MyProject 需另行提供。

---

## 6. 隐私安全（.gitignore 覆盖）

逐项核对 `.gitignore`（基线 HEAD，line 精确）：
- `.env` → `.gitignore:74`；`.env.*` → `:75`；`!.env.example` 白名单 → `:76`。
- 证书/密钥：`*.pem`(77)、`*.key`(78)、`*.p12`(79)、`*.pfx`(80)、`*.jks`(81)、`.git-credentials`(82)。
- 本地 Agent 配置：`.dsh/` → `:84`；`.codex/` → `:85`。
- `MyProject/` → `:20`（个人数据不入库）。
- pytest 报告含本机路径：`reports/pytest.xml` → `:69`（注释说明隐私整改）。
- `*.sqlite`/`*.sqlite3` → `:92-93`；`.coverage.*` → `:94`。

**结论：.env / .dsh / .codex / MyProject 均已覆盖，隐私门禁无发现缺口（正面结论）。** 唯一提示：`docs/archive/netlab-web-ui-2026-11-02.zip` 等归档产物已入库，属可接受（无凭证迹象）。

---

## 7. 文档内部引用有效性（抽查）

- README 引用的文档/资源**均存在**：`netlab/docs/CODE_GUIDE.md`(存在)、`netlab/docs/MATH.md`(存在，在 27 个 netlab/docs/*.md 之内)、`netlab/docs/EXTENSIBILITY_ARCHITECTURE.md`(存在)、`netlab/docs/PLUGIN_GUIDE.md`(存在)、`docs/assets/netlab-architecture.svg`、`docs/assets/signal-flow.png`、`docs/assets/nonlinear-control.png`(均存在)。
- `netlab/docs/` 共 27 个 .md（含 MATH.md、GLOSSARY.md、PLUGIN_GUIDE.md 等），目录结构完整。
- **失效/易误导引用**：
  - `docs/canonical/decisions.yaml:1074` 引 `ProjectPoint/docs/NETLAB_PLOTKIT_AUDIT_AND_REMEDIATION.md`，但同句已注明“不在 NetlabHome 仓内、无版本历史”（设计如此，非缺陷）。
  - README/OPERATION/ARCHITECTURE 的 `MyProject/` 指向（见 §5）在干净仓库不存在——属**实际失效引用**。
  - BUILD/CODE_GUIDE/PLUGIN_GUIDE 的 `plotkit>=0.2,<0.3` 与 pyproject 0.3 冲突（见 §3）——属**内容失效**。

---

## 8. 发现汇总

| ID | 严重度 | 结论 | 关键证据 file:line |
| --- | --- | --- | --- |
| P0-04 | —（核实通过） | 测试体系存在、规模千级：217 测试文件 / 1346 def test_ / 采集 1748 条；benchmarks 在；mathspec 测试在；核心覆盖率门槛 81、diff 80 | `pytest.ini:2`；`.github/workflows/python-tests.yml:123,134`；`netlab/tests/benchmarks/test_benchmark_contracts.py` |
| P0-04 附 | 低 | decisions.yaml 覆盖率/用例数过时（78 vs CI 81；678 vs 采集 1748） | `docs/canonical/decisions.yaml:1071-1076` |
| P1-03 | 中 | PlotKit 声明冲突：pyproject 0.3.x（必需） vs README/BUILD/CODE_GUIDE/PLUGIN_GUIDE 0.2.x（BUILD 钉 0.2.1），requirements.txt 未列 plotkit；实际 0.3.0。pywebview 已声明，不缺 | `pyproject.toml:18`；`README.md:176`；`BUILD_AND_PACKAGING.md:56,67`；`CODE_GUIDE.md:341`；`PLUGIN_GUIDE.md:57`；`PlotKit/pyproject.toml:7` |
| P1-04 | 中 | 代码 PROJECT_VERSION=8/APP=2.1.0，但 README×2、EXTENSIBILITY×2、MIGRATION×2、project.py docstring 仍写 v7/7 | `project.py:37-38,147`；`README.md:25,145`；`EXTENSIBILITY_ARCHITECTURE.md:598,625`；`MIGRATION_AND_COMPATIBILITY.md:12,47` |
| P1-05 | 中 | README 指向 MyProject/ 示例，但 .gitignore 排除 MyProject、干净仓库无该目录；examples/ 仅 demo.netlab；同名 .netlab 实际在 netlab/tests/fixtures/projects/ | `.gitignore:20`；`README.md:44`；`OPERATION.md:149`；`ARCHITECTURE.md:143,145`；`examples/demo.netlab` |
| P2-07 | 中 | 检查器仅查 5 字段存在 + 返回码/stdout 的 failed/error 子串，忽略 stderr，未校验 expected/failure_condition 语义；无 --all；默认抽 R01/R43/中位 3 条；requirements 共 R01–R43（43） | `check_requirement_verifiability.py:18,24-25,29-35`；`requirements.yaml`（43 条） |
| 隐私 | —（正面） | .env/.env.*/.dsh/.codex/MyProject/*.pem 等均已在 .gitignore 覆盖，无缺口 | `.gitignore:20,69,74-85,92-94` |
| 前提 | 高（流程） | 工作树并非干净基线：13 文件未提交 WIP + `stash other-session-wip-1855`，已部分修改 §3/§4 相关文件 | `git diff --stat`；`git stash list` |

> 全部结论基于 HEAD=5c076ea，用 `git show HEAD:` 取原文；未修改任何源码/文档，只写本报告。
