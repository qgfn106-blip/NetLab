// frontend/theme.tokens.ts
// ⚠ 外观令牌的【唯一来源】(P-A1, 2026-11-07, D75)。禁止在别处再手写第二份色值。
//
// 三层导出：
//  1) LIGHT / DARK —— CSS 变量令牌。键 = CSS 变量名去掉前导 "--"，值 = 当前实际生效值
//     （取自 frontend/style.css 的浅色 :root 两段 与 html[data-theme="dark"] 块）。
//     由 frontend/scripts/gen_theme_css.mjs 生成 frontend/theme.generated.css（构建期生成、产物入库）。
//  2) CANVAS_LIGHT / CANVAS_DARK —— 画布调色板（旧 app.ts THEME_TOKENS 值快照）。
//     P-A1 只做结构迁移，不改画布视觉；与 1) 存在历史冲突的键见 P-A1 报告（P-A2 再统一）。
//
// 约束：本文件为纯数据；生成脚本用括号匹配 + eval 读取 LIGHT / DARK（见 gen_theme_css.mjs）。

export type ThemeTokenMap = Record<string, string>;

// ---- CSS 变量令牌（浅色 :root，共 47 项）----
export const LIGHT: ThemeTokenMap = {
  "paper": "#eae5e1",
  "paper-2": "#edebe4",
  "paper-3": "#e2dccf",
  "paper-rgb": "234, 229, 225",
  "paper-2-rgb": "237, 235, 228",
  "ink": "#080a08",
  "ink-2": "#2b2a24",
  "ink-rgb": "8, 10, 8",
  "muted": "#5a574e",
  "dim": "#6e685c",
  "line": "#d6d0c4",
  "line-strong": "#aaa59a",
  "field-bg": "#ffffff",
  "field-border": "#9a9284",
  "accent": "#9b7247",
  "accent-2": "#565c46",
  "accent-soft": "#e4d5c1",
  "accent-rgb": "155, 114, 71",
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
  "float-bg": "#f2efe8",
  "panel-bg": "rgba(237, 235, 228, .94)",
  "topbar-bg": "rgba(237, 235, 228, .95)",
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

// ---- CSS 变量令牌（深色 html[data-theme="dark"] 覆盖，共 32 项）----
export const DARK: ThemeTokenMap = {
  "paper": "#11181b",
  "paper-2": "#202a2f",
  "paper-3": "#2a363b",
  "ink": "#e0e3dc",
  "ink-2": "#c6cbc3",
  "muted": "#c4cdce",
  "dim": "#a9b4b5",
  "line": "#2e3b40",
  "line-strong": "#64767c",
  "field-bg": "#0b1114",
  "field-border": "#6d7f86",
  "accent": "#c5a16b",
  "accent-2": "#9aa88c",
  "accent-soft": "#2c3a33",
  "green": "#9aa88c",
  "amber": "#c5a16b",
  "red": "#c08a7d",
  "ink-rgb": "224, 227, 220",
  "paper-rgb": "17, 24, 27",
  "paper-2-rgb": "32, 42, 47",
  "accent-rgb": "197, 161, 107",
  "accent-2-rgb": "154, 168, 140",
  "green-rgb": "154, 168, 140",
  "red-rgb": "192, 138, 125",
  "float-bg": "#1b2429",
  "panel-bg": "rgba(32, 42, 47, .96)",
  "topbar-bg": "rgba(17, 24, 27, .96)",
  "menu-bg": "rgba(23, 31, 35, .97)",
  "danger-bg": "#2a1e1b",
  "ink-hover": "#cfd4cb",
  "shadow-float": "0 18px 60px rgba(0, 0, 0, .38)",
  "shadow-line": "0 12px 28px rgba(0, 0, 0, .34)",
};

// ---- 画布调色板（app.ts THEME_TOKENS 值快照；P-A1 不改视觉）----
export const CANVAS_LIGHT: ThemeTokenMap = {
  "ink": "#080a08",
  "ink2": "#2b2a24",
  "muted": "#77756d",
  "dim": "#9a9487",
  "line": "#aaa59a",
  "paper": "#eae5e1",
  "panel": "#edebe4",
  "surface": "#e2dccf",
  "paper3": "#e2dccf",
  "accent": "#9b7247",
  "accent2": "#565c46",
  "accentSoft": "#e4d5c1",
  "red": "#8a4234",
  "amber": "#a67d48",
  "green": "#565c46",
  "gridDot": "rgba(104, 94, 78, 0.20)",
  "gridAxis": "#cfc6b5",
};

export const CANVAS_DARK: ThemeTokenMap = {
  "ink": "#e0e3dc",
  "ink2": "#c6cbc3",
  "muted": "#a6b0b1",
  "dim": "#7f8c8e",
  "line": "#536166",
  "paper": "#11181b",
  "panel": "#202a2f",
  "surface": "#2a363b",
  "paper3": "#1b2429",
  "accent": "#c5a16b",
  "accent2": "#9aa88c",
  "accentSoft": "#2e3b40",
  "red": "#c08a7d",
  "amber": "#c5a16b",
  "green": "#9aa88c",
  "gridDot": "rgba(166, 176, 177, 0.16)",
  "gridAxis": "#3a4a50",
};
