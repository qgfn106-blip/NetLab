import { CHART_PALETTE_CB_DARK, CHART_PALETTE_CB_LIGHT, CHART_PALETTE_HC_DARK, CHART_PALETTE_HC_LIGHT } from '../theme.tokens.js';
import { state } from './state.js';

export const CHART_PALETTE = [
  '#a8541f', '#1f5f5b', '#7b8c3a', '#8a4a7c', '#4a6f8a',
  '#b08a3e', '#8e2f24', '#5f6b52', '#7a4a2a', '#4d463c',
];

export function chartPalette(): string[] {
  const mode = String((state.prefs && state.prefs.chartPalette) || 'theme');
  const dark = themeKey() === 'dark';
  if (mode === 'high-contrast') return dark ? CHART_PALETTE_HC_DARK : CHART_PALETTE_HC_LIGHT;
  if (mode === 'colorblind') return dark ? CHART_PALETTE_CB_DARK : CHART_PALETTE_CB_LIGHT;
  return CHART_PALETTE;
}

export function themeKey() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}
