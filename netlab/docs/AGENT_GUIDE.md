# Netlab Agent 指南（开工第一步）

> 最后修改：2026-10-28 19:10（目录整理：运行根目录改为 `NetlabHome/`）
> 这份文档只回答四件事：**开工先问什么、去哪找东西、哪些文档说了算、发现冲突怎么改**。
> 需求正文、架构细节、踩坑记录都不在这里复制——只给指针（单一事实来源）。
> 适用于任何 agent 会话，不论模型与窗口；读完 §1 就可以开始干活。

---

## 1. 开工三问（先答完，再动手）

1. **这条需求是第几号？** 在 [REQUIREMENTS_AND_RULES.md](REQUIREMENTS_AND_RULES.md) §3 找到 `R01–R30` 里对应那条，读它的「原话 / 解读 / 验收 / 现状」。
2. **当前阶段是什么？** 读 [PROGRESS.md](PROGRESS.md) 头部表格（阶段 + 测试数 + 备份位置）与 §7（P0–P6 进度）。
3. **这个决定定过没有？** 在 REQUIREMENTS §2 的 `D1–D61` 台账里搜关键词；定过就照台账做，不要再自己拍。

**完成判据**：你能说出「R 编号 + P 期次 + 相关 D 编号 + 现状里哪几条是已核实事实」。说不出来就别改代码。

**闸门（2026-10-26 用户授权变更）**：开工前用 chat 简报「要做什么」，完工后简报「做了什么 + 进度 + 耗时（分钟）」，汇报尽量简短；**任务是否进行不需要逐期批准，按票单顺序连续推进**（`PROGRESS §7` / `NetlabExtras/scratch/*/issues/`）；每完成一个大任务或一批票后停下整理并汇报。三件套（见 §5）与 PROGRESS 更新仍是硬要求。
> 原规则「每期做完 → 报告 → 停下等批准」已被上述授权覆盖，保留原文备查。

**界面（2026-11-02 D78 起）**：`python -m netlab.desktop`（或 `netlab/start_desktop.bat`）启动 pywebview + WebView2 网页壳，前端在 `netlab/static/`（index.html / app.js / style.css）。Qt 原生界面曾于同日完整实现（R33），按用户决定「还是用 html 的 ui」整体备份到 Git 分支 `backup/qt-native-2026-11-02`（标签同名）后删除，`netlab/ui/` 不再存在；`--native` 会提示已移除。

**运行目录（2026-10-28 整理后）**：仓库根是 `ProjectPoint/`，但 Netlab 的运行根是 `NetlabHome/`。**所有命令先 `cd NetlabHome`**（`python -m pytest netlab/tests -q`、`python -m netlab.desktop`、备份目标 `../NetlabExtras/backups/ProjectPoint_backups/`）；直接双击 `NetlabHome/netlab/start_desktop.bat` 也可以。文档里的相对链接都以 `netlab/docs/` 为基准，不受影响。

---

## 2. 文档路由（按任务查，不要通读）

| 我要做的事 | 先读 | 再读 |
| --- | --- | --- |
| 加/改节点计算方式、连接函数 | [FRAMEWORK_CHEATSHEET.md](FRAMEWORK_CHEATSHEET.md) §4 §12 | [EXTENDING.md](EXTENDING.md) 对应小节 |
| 加/改电路元件（MNA） | CHEATSHEET §5 §12 | [ARCHITECTURE.md](ARCHITECTURE.md) §9.2、EXTENDING 电路小节 |
| 封装/使用模块、端口方向、模块库 | [MODULES_HOWTO.md](MODULES_HOWTO.md) | UI_SPEC §5.7 §5.8；PROGRESS §7.21–§7.25 |
| 改前端面板、画布、交互 | [UI_SPEC.md](UI_SPEC.md) | CHEATSHEET §6、ARCHITECTURE §11；电路图先读 [SCHEMATIC_DRAWING_SPEC.md](SCHEMATIC_DRAWING_SPEC.md) 与 [GLOSSARY.md](GLOSSARY.md) |
| 改**原生界面**（Qt Widgets，`netlab/ui/`） | [QT_NATIVE_SPEC.md](QT_NATIVE_SPEC.md) |
| 想知道**现在要做什么、还差什么** | [BACKLOG.md](BACKLOG.md) | `.scratch/netlab-qt/issues/01–15`、`netlab/ui/` 各模块 docstring |
| 改工程文件、校验和、目录 | CHEATSHEET §8 | [REQUIREMENTS_AND_RULES.md](REQUIREMENTS_AND_RULES.md) R01/R16、`netlab/project.py` |
| 改桌面外壳、bat 启动 | CHEATSHEET §9 | `netlab/desktop/*`、[LESSONS.md](LESSONS.md)「bat 三坑」 |
| 改扩展系统（Python 自定义） | CHEATSHEET §10 | EXTENDING、LESSONS §5（handler 语义坑） |
| 排查报错、验证功能 | LESSONS §0 | LESSONS §3（CDP）、PROGRESS 现有证据 |
| 加/改需求、规则、优先级 | REQUIREMENTS §2 §3 §5 | §7 已废弃口径、§9 变更记录 |
| 想知道"为什么这么设计" | REQUIREMENTS §2 台账 | ARCHITECTURE 对应章节 |
| 研究底层求解原理（节点/连接/计算/求解器/时间） | [SOLVER_CODE_MAP.md](SOLVER_CODE_MAP.md) | 本文档 §1 调用链、`graph.py` / `nodal.py` 原文 |
| 想知道历史计划 | [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) 顶部「变动索引」 | 该文档旧正文（可能已失效） |

**检索配方**（比翻目录快）：

```bash
cd netlab/docs
grep -n "^### R" REQUIREMENTS_AND_RULES.md      # 定位需求条目
grep -n "| D[0-9]" REQUIREMENTS_AND_RULES.md    # 定位决策
grep -n "^### P[0-9]" REQUIREMENTS_AND_RULES.md # 定位分期
grep -n "^## " PROGRESS.md                      # 定位进度章节
grep -n "^   \* [0-9]" ../static/app.js         # 定位前端分区
```

---

## 3. 哪些文档说了算（权威范围表）

| 文档 | 权威范围 | 不作权威 |
| --- | --- | --- |
| **代码 + 测试** | 系统当前**实际行为** | 需求意图（代码可能本来就错） |
| **REQUIREMENTS_AND_RULES** | 需求、决策、权重、分期、不做清单、已废弃口径 | 当前实现状态（「现状」栏只作线索，需复核） |
| **PROGRESS** | 进度与**证据**（测试数、实测结论、备份位置） | 需求口径（只放指针与证据） |
| **FRAMEWORK_CHEATSHEET** | 模块职责、数据流、API、上限、改哪里 | 设计理由（指向台账与 ARCHITECTURE） |
| **LESSONS** | 踩坑、验证套路、未验证清单 | 需求 |
| **ARCHITECTURE** | 机制原理（可能滞后于代码） | 当前行为（以代码为准） |
| **EXTENDING** | 扩展步骤与可复制代码 | 需求 |
| **IMPLEMENTATION_PLAN** | 2026-10-24 的历史设计与判断 | 现状（看顶部变动索引） |

**裁定顺序（冲突时从上往下取信）**：

```
代码+测试  >  REQUIREMENTS §2 台账  >  REQUIREMENTS §3 需求正文
          >  PROGRESS 的已核实证据  >  ARCHITECTURE / EXTENDING
          >  IMPLEMENTATION_PLAN / README
```

理由：**代码是事实，台账是决策，旧计划是历史**。台账与需求正文打架时，台账赢（它记录的是最新一次拍板）。

---

## 4. 冲突检查与修正（这是本指南的核心动作）

### 4.1 什么时候必须做冲突检查

- 新增或修改任何 `R*` 需求条目、`D*` 决策、`P*` 分期；
- 改了代码，使某条「现状」或架构描述不再成立；
- 读文档时发现两处说法不一致；
- 收到"实现与预期不符"的反馈。

### 4.2 检查清单（逐条过，每条给结论：一致 / 已改 / 待确认）

1. 新增内容是否与 `D1–D40` 台账里已有决定冲突？
2. 是否落进 §6「不做清单」？（落进去就停，先问）
3. 是否与 PROGRESS 里已核实的事实冲突（测试数、已完成能力）？
4. 是否与代码实际行为冲突？（以代码为准，改文档；若代码错，登记到 PROGRESS §7 的待办，而不是直接改需求）
5. 命名是否与术语一致（§7）？
6. 是否与 IMPLEMENTATION_PLAN 的失效章节冲突？（看顶部变动索引，不改旧正文）
7. 是否踩中 LESSONS 已记录的坑？（踩中就引用，不重复解释）

### 4.3 修正流程（四步，顺序不可换）

1. **定位权威**：按 §3 裁定顺序确定改哪一份；
2. **只改权威处**：其他文档改成**指针**，不复制结论（复制必然产生第二份真相）；
3. **登记**：REQUIREMENTS §9 变更记录加一行（日期 + 改了什么 + 为什么）；
4. **留痕**：被推翻的旧口径移入 §7「已废弃口径」，原文保留。

### 4.4 冲突报告（交付格式，缺一不可）

| 冲突点 | 出处 A | 出处 B | 裁定依据 | 改了哪份 | 遗留 |
| --- | --- | --- | --- | --- | --- |

没有冲突时也写一行「已核对，无冲突」，并列出核对了哪几节——这是"查过了"的证据，不是形式。

---

## 5. 收尾（每期/每次改动）

```bash
cd /e/Python/MyPython/ProjectPoint
python -m pytest netlab/tests -q          # 数量只增不减（当前 195）
python -m compileall -q netlab
python -m netlab.desktop --selftest       # 期望 "ok": true
```

然后：更新 PROGRESS §7 状态列（附证据）→ REQUIREMENTS §9 加一行 → 复制变更文件到 `NetlabExtras/backups/ProjectPoint_backups/<name>_<时间戳>/` + `MANIFEST.sha256` → 修改过的文档顶部加「最后修改：日期 时间」（时间用 `date '+%Y-%m-%d %H:%M'` 取，不要估算）→ 简报（含耗时）。

**完成判据（四项全中才算收尾）**：测试数对上、编译无错、selftest ok、三处文档（需求/进度/索引）口径一致。

---

## 6. 工作方式（正面表述）

- **先证据后判断**：写「现状」只写读过代码或跑过测试能证明的事，其余标「待核实」。
- **一次一个问题**：需要用户拍板时，一轮只问一个，并给出建议答案。
- **先文本后核实**：需求有变更时，先按文本列差异清单给用户确认，再统一核实现状。
- **小步收口**：一次只推进一个票或一批相关票；做完按「大进度汇报」节奏报告（含耗时），继续按票单推进。
- **需求原话照抄**：引用用户说法时保留原措辞，不转述。
- **改文档用脚本搬运长段落**：原文保留场景下，备份→写新→按标记切段回填，不手抄。

---

## 7. 术语表（界面与文档必须同名）

| 术语 | 含义 | 曾经的错名 |
| --- | --- | --- |
| 工程 | 一个项目，含多个网络 | 场景 |
| 网络 | 一张拓扑图（一个 Scene），左侧栏一条目；用户口语里的"层/图层"与它同义，**界面统一用「网络」** | 场景、层、图层 |
| 节点函数 | 节点 kind 的公式/参数/源码页 | 规格 |
| 连接函数 | 连接 kind 的公式/参数/源码页 | 规格、方法 |
| 模块 | 封装成可复用功能节点的子网络（`*.block`） | 功能块节点 |
| 占位块 | 库文件缺失时的降级替身，带标记 | default 模板 |
| 口径 | 需求与决策的唯一表述来源 | — |
| 台账 | REQUIREMENTS §2 的 D1–D34 决策表 | — |
| 闸门 | 每期做完必须停下的批准点 | — |
| 票号 | `P<期>-<序号>`（如 P1-03）；正文括号里的 `R**` 才是需求编号，两者不可混用 | — |

---

## 8. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-10-25 | 新建：开工三问、文档路由、权威范围与裁定顺序、冲突检查与修正流程、收尾判据、术语表 |
| 2026-10-26 | 路由表新增 SOLVER_CODE_MAP.md（底层求解代码地图），供"研究底层原理"类任务直接定位 |
| 2026-10-26 | 闸门规则改为开工/完工简报（含耗时、不需逐期批准）；收尾要求文档顶部加最后修改时间；测试基线更新为 113 |
