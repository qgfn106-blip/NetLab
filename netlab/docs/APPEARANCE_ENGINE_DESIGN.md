# 外观引擎设计（一期全局外观引擎 / 二期元素级视图外观）

- 状态：草案（grill 已定 Q1–Q4）
- 日期：2026-11-07
- 作用域：**仅 netlab 主壳**（Q1=B，PlotKit 视图与其 `app.css` 本期不动）
- 关联：ADR [adr/0003-appearance-engine.md](adr/0003-appearance-engine.md)；UI 唯一实现口径 [UI_SPEC.md](UI_SPEC.md)；决策 D75（主题单一来源）
- 参考风格：**RhineLabUI**（暖灰纸面 + 近黑墨字、0 圆角、1px 细线、MiSans、琥珀 `#9b7247` 强调、克制阴影）

## 1. 背景与根因（审计结论）
1. **浅色基调无回归**（一直是 RhineLab 纸墨风）。
2. **三处病根**：
   - ① **主题令牌多源、互相漂移**：`frontend/style.css` 两处 `:root` + `app.ts` 的 `THEME_TOKENS`(约 13118-13133) + PlotKit `app.css` 各写一份，且已不一致 → DOM 文字与画布文字深浅不统一（“字看不清”）。违反 **D75「单一来源、禁止两套各写一遍」**。
   - ② **深色下画布大量裸色**：`app.ts` 273 处 hex 仅 226 次走 `C()`，写死浅色（如 `#f7ecdf`/`#c0b6a5`/`#a49a89`）在深底成亮斑。
   - ③ **深色被反复调亮过头**：弱化文字对比度做到 8–11:1，几乎与主文字同亮 → 发白发灰、失去主次。
3. `UI_SPEC §3.1` 颜色表自身不满足其 `§14` 的 ≥7:1/≥4.5:1（light muted 3.69、dim 2.41）→ 规范与可读性自相矛盾，重做时须一并修订。

## 2. 目标 / 非目标
- 目标：深浅两套**独立完整**色板、同一 RhineLab 设计语言；文字清晰、风格统一；令牌单一来源；画布全部走令牌；设置窗可详细调外观。
- 非目标（本期）：不改 PlotKit 视图与 `app.css`；不做“完全自由主题系统（逐令牌编辑+导入导出）”（后期）；不引第三方 UI 框架。

## 3. 已定设计决策（grill）
- **Q1 = B**：只改 netlab 主壳。
- **Q2 = C**：一期全局外观引擎（A）+ 二期元素级视图外观（B），分两期先 A。
- **Q3 = A**：浅/深**同一套设计语言**，各用**一整套独立色板**（深色不是简单反色）。
- **Q4 = 1–9**：一期外观面板包含 9 项（见 §6）。

## 4. 令牌单一来源架构
- **唯一源文件**：`frontend/theme.tokens.ts` 导出 `ThemeTokens`（light/dark 两份），字段：
  `paper, paper2, paper3, ink, ink2, muted, dim, line, lineStrong, accent, accentSoft, green, amber, red, fieldBg, fieldBorder, focus, radius, spaceScale, fontScale`。
- **生成 CSS 变量**：构建期由该源生成 `:root`（light）与 `html[data-theme="dark"]`（dark）变量（= 现 style.css 的令牌块），**禁止**再手写第二份。
- **画布同源**：`app.ts` 的 `THEME_TOKENS`/`C()` 改为从 `theme.tokens.ts` 读取同一份；`C()` 覆盖率提升到画布所有颜色（裸 hex 归零）。
- PlotKit `app.css` 因非本期范围，保持独立但加“与 netlab 主壳非共享”注释，避免误认为同源。

## 5. 两套色板（候选值，最终以 §7 对比度脚本验收为准）
- 规则：正文 `ink/paper` ≥ 7:1；次文字 `muted`/`dim` 与 paper ≥ 4.5:1；`fieldBorder`/`lineStrong` 与相邻底 ≥ 3:1；深色 muted/dim 不超过约 7:1（避免过亮压平层级）。
- 浅色（纸墨）：paper `#eae5e1` / paper2 `#f2efe9` / paper3 `#e2dccf` / ink `#0a0c0a` / ink2 `#2b2a24` / muted `#524f46` / dim `#6b665b` / line `#cdc6b8` / lineStrong `#8f887a` / accent `#7a5a33`（正文用加深琥珀）/ accentSoft `#e4d5c1` / fieldBg `#ffffff` / fieldBorder `#8f887a`。
- 深色（独立冷调，非反色）：paper `#0f1417` / paper2 `#161d21` / paper3 `#1e282d` / ink `#e6e9e2` / ink2 `#c3c9c1` / muted `#8b9799` / dim `#6f7c7e` / line `#2a3439` / lineStrong `#55666c` / accent `#d0a86e` / accentSoft `#2c3a33` / fieldBg `#0b1114` / fieldBorder `#55666c`。
- 圆角 `0px`；细线 `1px`（可调档见 §6）；字体 MiSans 栈 + Cascadia Code（mono）。

## 6. 一期外观面板（可调 1–9）
1. 主题模式：浅/深/跟随系统；2. 强调色 Accent（预设 6–8 + 自定义，浅深各记）；3. 全局字号（小/标准/大 ≈11/12/13/14px）；4. 界面密度（紧凑/标准/宽松）；5. 明暗强度微调（纸面/表面滑块）；6. 圆角(0/2/4px)与线条(1/1.5px)；7. 动效开关+强度；8. 性能档位（自动/高/低）；9. 画布/图表配色（跟随主题/高对比/色盲友好）。10（保存/命名/导入导出）留二期。
- 存储：`state.prefs = {theme, accent, fontScale, density, surfaceTone, radius, lineWidth, motion, perf, chartPalette}`，持久化本地。

## 7. 验收标准（可测量，不可只靠肉眼）
- **对比度脚本**（Node，读 tokens 算 WCAG）：正文 ≥7、次/弱 ≥4.5、边框 ≥3；**深浅两套都过**（脚本随代码提交）。
- `tsc` 0 / `node --check` 0 / esbuild build ok / GUI `--probe` 桥接+JS→Python 往返 true / `pytest netlab/tests` 627 passed。
- **对比页**：浅/深 × 关键界面（主界面、设置窗、图表、帮助）旧 vs 新并排截图，肉眼与脚本双确认。

## 8. 分期步骤（一次一小步，每步可回退）
- **P-A1 令牌单一来源**（不改视觉）：抽出 `theme.tokens.ts`，生成 CSS 令牌块，`C()` 读同源；输出“迁移前后同像素”对比证明无视觉回归。
- **P-A2 双色板**：按 §5 落浅/深两套，跑对比度脚本全过。
- **P-A3 画布裸色收敛**：`app.ts` 所有 hex 经 `C()`/tokens；深色无亮斑（截图对比页）。
- **P-A4 外观面板**：设置窗接入 1–9 项，持久化。
- **P-B 元素级视图外观**（二期）：视图面板对单元素外观详细可调（承 R40）。
- 每步：先存基线 tag / 分支，改动可回退；反馈沉淀进本文件与 `AGENT_GUIDE` 的规则。

## 9. 风险
- 画布裸色多（273 hex）迁移量大 → 分批 + 对比页守住。
- 令牌生成引入构建步骤 → 保持“开发期生成、产物提交、运行时零构建”。
- 深色过亮复发 → 对比度脚本上限（≤约 7:1）纳入验收。

## 10. 采用的工作流（RhineLabUI-Workflow 五法）
1. 写标准不写做法；2. 反馈说现象、归因错了当场纠正；3. 看不清就画出来/报可测量指标；4. 满意即冻结方向、先存基线、改动走分支；5. 看不出区别就做对比页，效果不好就回退。反馈沉淀为规则（AGENTS/本文档）。
