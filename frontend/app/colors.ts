// 颜色令牌与运行期覆盖：C()/tokens() 的唯一实现。
// 默认令牌来自 theme.tokens.ts；RT_OVERRIDE 只保存与默认不同的用户覆盖。
import { CANVAS_LIGHT, CANVAS_DARK } from '../theme.tokens.js';
import { themeKey } from './theme.js';
import { hexToRgb, mixHex } from './color.js';
import { state } from './state.js';

export const THEME_TOKENS = { light: CANVAS_LIGHT, dark: CANVAS_DARK };

const COLOR_ALIAS = {
  '#a8541f': 'accent', '#1f5f5b': 'accent2', '#6f695f': 'muted', '#969083': 'dim',
  '#11100e': 'ink', '#faf8f2': 'panel', '#f7f4ec': 'paper', '#fffdf8': 'surface',
  '#f2efe7': 'paper', '#bcb3a1': 'line', '#cfc6b5': 'gridAxis', '#e7e1d5': 'paper3',
};

let RT_OVERRIDE: Record<string, string> = {};

export function tokens(): Record<string, string> {
  const base = THEME_TOKENS[themeKey()] as Record<string, string>;
  // P-A4：叠加运行期覆盖（仅当存在覆盖时才展开，默认零开销、零差异）。
  return RT_OVERRIDE && Object.keys(RT_OVERRIDE).length ? { ...base, ...RT_OVERRIDE } : base;
}


// 画布取色：把旧版硬编码色映射到当前主题令牌；未知色在深色下向纸面文字方向提亮。
const LEGACY_RGB = {
  '168,84,31': 'accent',
  '31,95,91': 'accent2',
  '142,47,36': 'red',
  '79,107,64': 'green',
  '176,118,42': 'amber',
};

export function C(value: string) {
  const raw = String(value || '').trim();
  const legacy = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+))?\s*\)$/i);
  if (legacy) {
    const target = LEGACY_RGB[`${legacy[1]},${legacy[2]},${legacy[3]}` as keyof typeof LEGACY_RGB];
    const hex = target ? (tokens() as Record<string, string>)[target] : '';
    const rgb = hex ? (hexToRgb(hex) as number[] & { r: number; g: number; b: number }) : null;
    if (rgb) return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${legacy[4] ?? 1})`;
  }
  const token = COLOR_ALIAS[raw.toLowerCase() as keyof typeof COLOR_ALIAS];
  if (token) return (tokens() as Record<string, string>)[token];
  if (themeKey() === 'dark') return mixHex(raw, '#e0e3dc', 0.42);
  return raw;
}

export function setRuntimeOverride(next: Record<string, string>): void {
  RT_OVERRIDE = next || {};
}

export function getRuntimeOverride(): Record<string, string> {
  return RT_OVERRIDE;
}
