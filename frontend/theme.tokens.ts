// frontend/theme.tokens.ts
// ⚠ 外观令牌的【唯一来源】(P-A1 单一来源 2026-11-07 D75；P-A2 浅/深双色板 2026-11-07)。
//    禁止在别处再手写第二份色值。
//
// 三层导出：
//  1) LIGHT / DARK —— CSS 变量令牌。键 = CSS 变量名去掉前导 "--"，值 = 当前实际生效值。
//     由 frontend/scripts/gen_theme_css.mjs 生成 frontend/theme.generated.css（构建期生成、产物入库）。
//  2) CANVAS_LIGHT / CANVAS_DARK —— 画布调色板。P-A2 起与 LIGHT/DARK 同值（同一套色），
//     语义映射：panel↔paper-2、surface↔paper-3、line↔line-strong、paper3↔paper-3；画布独有
//     gridDot/gridAxis 在此显式定义（CSS 变量里没有对应项）。这样画布用色与 DOM 令牌永不漂移。
//
// 约束：本文件为纯数据；生成脚本用括号匹配 + eval 读取 LIGHT / DARK（见 gen_theme_css.mjs）。
// 对比度：frontend/scripts/contrast_check.mjs 读 LIGHT/DARK 做 WCAG 校验（正文≥7/次≥4.5/边框≥3，深色弱化文字≤7）。

export type ThemeTokenMap = Record<string, string>;

// ---- CSS 变量令牌（浅色 :root，RhineLab 纸墨）----
export const LIGHT: ThemeTokenMap = {
  "paper": "#eae5e1",
  "paper-2": "#f2efe9",
  "paper-3": "#e2dccf",
  "paper-rgb": "234, 229, 225",
  "paper-2-rgb": "242, 239, 233",
  "ink": "#0a0c0a",
  "ink-2": "#2b2a24",
  "ink-rgb": "10, 12, 10",
  "muted": "#524f46",
  "dim": "#635e52",
  "line": "#cdc6b8",
  "line-strong": "#857e70",
  "field-bg": "#ffffff",
  "field-border": "#857e70",
  "accent": "#7a5a33",
  "accent-2": "#565c46",
  "accent-soft": "#e4d5c1",
  "accent-rgb": "122, 90, 51",
  "accent-2-rgb": "86, 92, 70",
  "green": "#565c46",
  "green-rgb": "86, 92, 70",
  "amber": "#a67d48",
  "red": "#8a4234",
  "red-rgb": "138, 66, 52",
  "radius": "0px",
  "mono": "\"Cascadia Code\", \"JetBrains Mono\", Consolas, \"SFMono-Regular\", monospace",
  "sans": "\"MiSans\", \"Mi Sans\", \"PingFang SC\", \"Microsoft YaHei\", system-ui, sans-serif",
  "ok": "var(--green)",
  "warn": "var(--amber)",
  "danger": "var(--red)",
  "float-bg": "#f2efe9",
  "panel-bg": "rgba(242, 239, 233, .94)",
  "topbar-bg": "rgba(242, 239, 233, .95)",
  "menu-bg": "rgba(234, 229, 225, .96)",
  "danger-bg": "#f2e4de",
  "ink-hover": "#22241d",
  "shadow-float": "0 18px 60px rgba(99, 81, 58, .14)",
  "shadow-line": "0 12px 28px rgba(20, 16, 10, .10)",
  "ease-out": "cubic-bezier(.22, 1, .36, 1)",
  "ease-in": "cubic-bezier(.4, 0, 1, 1)",
  "motion": "1",
  "t-fast": "calc(120ms * var(--motion))",
  "t-base": "calc(200ms * var(--motion))",
  "t-slow": "calc(300ms * var(--motion))",
  "d-in": "calc(12px * var(--motion))",
  "shell-top": "100px",
  "shell-bottom": "32px",
};

// ---- CSS 变量令牌（深色 html[data-theme="dark"] 覆盖；独立冷调，非浅色反相）----
export const DARK: ThemeTokenMap = {
  "paper": "#0f1417",
  "paper-2": "#161d21",
  "paper-3": "#1e282d",
  "ink": "#e6e9e2",
  "ink-2": "#c3c9c1",
  "muted": "#8b9799",
  "dim": "#778486",
  "line": "#2a3439",
  "line-strong": "#55666c",
  "field-bg": "#0b1114",
  "field-border": "#55666c",
  "accent": "#d0a86e",
  "accent-2": "#9aa88c",
  "accent-soft": "#2c3a33",
  "green": "#9aa88c",
  "amber": "#d0a86e",
  "red": "#c08a7d",
  "ink-rgb": "230, 233, 226",
  "paper-rgb": "15, 20, 23",
  "paper-2-rgb": "22, 29, 33",
  "accent-rgb": "208, 168, 110",
  "accent-2-rgb": "154, 168, 140",
  "green-rgb": "154, 168, 140",
  "red-rgb": "192, 138, 125",
  "float-bg": "#1e282d",
  "panel-bg": "rgba(22, 29, 33, .96)",
  "topbar-bg": "rgba(15, 20, 23, .96)",
  "menu-bg": "rgba(18, 24, 28, .97)",
  "danger-bg": "#2a1e1b",
  "ink-hover": "#cfd4cb",
  "shadow-float": "0 18px 60px rgba(0, 0, 0, .38)",
  "shadow-line": "0 12px 28px rgba(0, 0, 0, .34)",
};

// ---- 画布调色板（P-A2：与 LIGHT 同值，语义映射 panel↔paper-2 / surface↔paper-3 / line↔line-strong）----
export const CANVAS_LIGHT: ThemeTokenMap = {
  "ink": LIGHT["ink"],
  "ink2": LIGHT["ink-2"],
  "muted": LIGHT["muted"],
  "dim": LIGHT["dim"],
  "line": LIGHT["line-strong"],
  "paper": LIGHT["paper"],
  "panel": LIGHT["paper-2"],
  "surface": LIGHT["paper-3"],
  "paper3": LIGHT["paper-3"],
  "accent": LIGHT["accent"],
  "accent2": LIGHT["accent-2"],
  "accentSoft": LIGHT["accent-soft"],
  "red": LIGHT["red"],
  "amber": LIGHT["amber"],
  "green": LIGHT["green"],
  // 画布独有（CSS 无对应项）：点阵 = 暖墨 @20% 透明；网格轴 = 与 --line 同值，克制不抢戏。
  "gridDot": "rgba(104, 94, 78, 0.20)",
  "gridAxis": LIGHT["line"],
};

// ---- 画布调色板（P-A2：与 DARK 同值，独立冷调）----
export const CANVAS_DARK: ThemeTokenMap = {
  "ink": DARK["ink"],
  "ink2": DARK["ink-2"],
  "muted": DARK["muted"],
  "dim": DARK["dim"],
  "line": DARK["line-strong"],
  "paper": DARK["paper"],
  "panel": DARK["paper-2"],
  "surface": DARK["paper-3"],
  "paper3": DARK["paper-3"],
  "accent": DARK["accent"],
  "accent2": DARK["accent-2"],
  "accentSoft": DARK["accent-soft"],
  "red": DARK["red"],
  "amber": DARK["amber"],
  "green": DARK["green"],
  // 画布独有：冷灰点阵 @16% 透明；网格轴 = 与 --line 同值。
  "gridDot": "rgba(166, 176, 177, 0.16)",
  "gridAxis": DARK["line"],
};
