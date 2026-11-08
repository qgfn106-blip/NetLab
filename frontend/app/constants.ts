/* Netlab app constants (S5 split from app.ts; no behavior change). */

/* ======================================================================
 * 0. 常量与小工具
 * ==================================================================== */

// 界面版本号：必须与 index.html 的 ?v= 和 netlab/server.py 的 APP_BUILD 一致。
// 用来识别「前端文件已更新、后端进程还是旧的」这种只关窗口不重启的情况。
// D-2 / N-21：版本由构建注入（netlab/__init__.py 是唯一来源）。
declare const __NETLAB_BUILD__: string;
export const UI_BUILD = __NETLAB_BUILD__;

export const PALETTE = [
  '#a8541f', '#1f5f5b', '#2a2621', '#7b8c3a', '#8a4a7c',
  '#b08a3e', '#4a6f8a', '#8e2f24', '#5f6b52', '#7a4a2a',
];
export const GROUP_COLORS = {
  '基础': '#1f5f5b',
  '动态': '#4f6b40',
  '高级': '#8a4a7c',
  '信号': '#a8541f',
  '电路': '#9a6a1c',
  '矢量': '#a8541f',
  '数学': '#4a6f8a',
};
export const NODE_RADIUS = 46;
export const NODE_W = NODE_RADIUS * 2;
export const NODE_H = NODE_RADIUS * 2;
export const CHART_KEYS = 8;
export const MAX_IMPORT_BYTES = 2_000_000;
export const MAX_FRAMES = 5000;
export const INST_COLORS = ['#c2542f', '#2f6f9e', '#7a5aa8', '#3f8f6b'];
