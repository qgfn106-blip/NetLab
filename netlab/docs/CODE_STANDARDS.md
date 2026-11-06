# Netlab 代码规范（强制）

> 最后修改：2026-11-06
> **适用范围：任何对 netlab（Python 后端 + 前端 TS/JS）与 PlotKit 的代码改动——不论人类还是 agent。开工改代码前，必须先读本文件并遵守；本规范与既有代码风格冲突时，新代码按本规范、旧代码在改动时逐步对齐，且不得借格式化之名改变任何行为。**

本文件是「怎么把代码写对 / 写好」的**单一事实来源**；需求与决策口径见 [REQUIREMENTS_AND_RULES.md](REQUIREMENTS_AND_RULES.md)，开工流程见 [AGENT_GUIDE.md](AGENT_GUIDE.md)。

---

## 0. 三条铁律（最高优先级）

1. **改代码必须遵守本规范**；review / 合并前逐条对照。违反即打回。
2. **只做等价的改进**：重构、类型化、格式化、优化都不得改变对外行为；必须用「AST 等价 / 行为等价比对 + 全量测试」证明。
3. **改代码必须同步文档**：需求状态改 `REQUIREMENTS_AND_RULES.md`，进度改 `PROGRESS.md`；文档陈述的事实必须能用 `文件:行号` 或测试结果佐证。

---

## 1. 通用原则

- 最小改动、单一职责、能读优先；不引入与任务无关的"顺手重构"。
- 不擅自改架构/依赖/构建方式；涉及取舍先查 §2 决策台账（`REQUIREMENTS_AND_RULES.md`）。
- 文件统一 **UTF-8（无 BOM）**；不要用 PowerShell `Get-Content | Set-Content` 改含中文的 UTF-8 源码（会乱码），用编辑工具或 Python `read_text/write_text(encoding="utf-8")`。
- 改动前先读相关文件；改后自查，提交前跑门禁（见 §5/§6）。

---

## 2. TypeScript / JavaScript 规范（netlab `frontend/`、PlotKit `src/plotkit/static/`、`vscode-extensions/netlab-sidebar/`）

**权威来源（冲突时以这两份为准）**
- 语言风格与语言特性：**Google TypeScript 风格指南** —— https://zh-google-styleguide.readthedocs.io/en/latest/google-typescript-styleguide/contents.html
- 类型建模与 JS→TS 迁移方法：**TypeScript 手册** —— https://bosens-china.github.io/Typescript-manual/describe/
- 两者冲突时，**风格类取 Google、类型建模取手册**。

**命名与风格**
- 变量 / 函数 / 参数 `camelCase`；类型 / 接口 / 类 / 枚举 `PascalCase`；模块级常量 `CONSTANT_CASE`；文件名小写。
- 统一 `prettier` 格式化；缩进与引号跟随仓库既有配置（当前产物为 4 空格、双引号）。

**类型系统**
- 优先**类型推导**，不写冗余类型标注。
- **禁用 `any`**；不确定用 `unknown` + 类型收窄，或写具体类型。
- 禁用 `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error`；确需时须注明理由（原则上不允许）。
- 少用 `as unknown as`；优先类型守卫 / 收窄；少量合理 `as` 断言可用。
- 对象结构用 `interface`，联合 / 交叉 / 工具类型用 `type`；简单数组 `T[]`、复杂 `Array<T>`；不用 `String/Number/Boolean` 包装类型。

**语言特性**
- 一律 `===` / `!==`；只用 `const` / `let`，禁 `var`；异常用 `Error` 子类、不抛字符串；迭代用 `for…of`。
- 对外 API 写 JSDoc。

**构建与产物（运行时零构建红线，D100 / D119）**
- 前端源是 `.ts`，**提交对应 `.js` 产物**；运行时页面仍以 `<script>` / 原生 ESM 加载，**不需要 node、不引入打包器运行时、离线可用**。
- 开发期允许用 **esbuild** 生成产物（D119），产物必须提交；加 `package-lock.json`、`.nvmrc`、`engines.node`，CI 用 `git diff --exit-code` 做产物漂移守卫。
- 禁止把产物改成需要构建才能运行；禁止在运行时引第三方 CDN。

**门禁（DoD，每个改动都要过）**
- `tsc --strict`（或 `tsc -p tsconfig.json --noEmit`）**0 error**；`eslint` 0 error；`prettier` 已格式化（或已登记临时豁免）。
- 行为等价：迁移 / 重构用 **AST 归一化比对** 或 **录制型行为等价比对**（如 canvas 操作序列、动态 import 冒烟）证明零行为变化。

---

## 3. Python 规范（`netlab/`、`PlotKit` 的 `.py`）

- 遵循 **PEP 8**（https://legacy.python.org/dev/peps/pep-0008/）；格式化用 **`black`**（默认 88 列），必要时配合 `ruff` / `pycodestyle`。
- 命名 `snake_case`（函数/变量/模块）、`PascalCase`（类）、`UPPER_CASE`（常量）；鼓励 PEP 484 类型注解与规范 docstring。
- **只做等价格式化与规范化，不改语义**：格式化后必须证明 **AST 等价**（`ast.dump` 比对，可忽略 docstring 内容），并跑全量 `pytest` 通过。
- 格式化命令（在对应仓库根执行，排除第三方/缓存/构建目录）：
  - netlab：`python -m black netlab --exclude '/(_vendor|__pycache__|node_modules|\.tsbuild|build|dist)/'`
  - PlotKit：`python -m black src tests examples tools`
- flake8 门禁（P18 起）：
  - netlab：`python -m flake8 netlab`
  - PlotKit：`python -m flake8 src tests examples tools`
  - 两仓库根各有 `.flake8`：`max-line-length=88`、`extend-ignore=E203,E501,W503`（与 black 对齐，见下条）、排除 `_vendor`/缓存/构建；E402 仅在确有运行期 `sys.path`/注册依赖的文件按 per-file-ignores 登记。
- 注意：`black` 会规范化 docstring 缩进（仅改 `__doc__` 显示，不改逻辑）；`black` 与 `pycodestyle` 在个别规则（E203 切片空格、E501 行宽）上默认冲突，以 `black` 为准。

---

## 4. 测试规范

- 新增 / 改动行为必须有对应测试；纯函数优先拆到 `*.utils.ts` 并配 `node --test`（`tests/*.test.mjs` / `.cjs`）单测；Python 用 `pytest`（`netlab/tests/`、PlotKit `tests/`）。
- **不得为通过而弱化断言**；测试要断言外部可观察行为，正反覆盖（如带 token 200 / 不带 token 401），少用脆弱 mock。
- 若因产物化（tsc/esbuild 重排版）导致「按源码字符串匹配」的测试失效，应把测试读取目标改到**源码 `.ts`** 或改为**行为测试**，不得放宽到失去校验意义。

---

## 5. 提交规范

- **精确 pathspec 提交**，一个任务一个提交；不要 `git add -A` 把并行会话/无关文件卷进同一提交。
- 提交前：`git status` 看清 staged；跑 `tsc` / `pytest`；**提交后对干净 HEAD 再验一次**。
- 提交信息格式：`<type>(<scope>): 摘要`（type 如 feat/fix/docs/style/refactor/test/chore）。
- 不改写他人未提交改动；不动与任务无关的分支。

---

## 6. 文档规范

- 改代码同步更新：需求/决策 → `REQUIREMENTS_AND_RULES.md`（R/D 编号唯一递增），进度 → `PROGRESS.md`（台账状态 + 下一步），必要处补 spec / ADR。
- 文档中凡"事实性陈述"（编号、计数、行号、端点、构建方式）必须能用代码或测试佐证；不确定的标「待核实」，不得臆测。

---

## 7. 参考

- Google TypeScript 风格指南：https://zh-google-styleguide.readthedocs.io/en/latest/google-typescript-styleguide/contents.html
- TypeScript 手册（中文）：https://bosens-china.github.io/Typescript-manual/describe/
- PEP 8：https://legacy.python.org/dev/peps/pep-0008/
- 前端构建 / 产物 / ESM 决策：见 `REQUIREMENTS_AND_RULES.md` D100 / D119、R41 / R42、P16 / P17 / P18。
