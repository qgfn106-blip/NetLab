// 外观与偏好（S5-34 从 app.ts 迁出）
import { THEME_TOKENS, setRuntimeOverride, tokens } from './colors.js';
import { api, jsonRequest } from './net.js';
import { button } from './ui.js';
import { chartPalette, themeKey } from './theme.js';
import { clamp } from '../app.utils.js';
import { drawPhase } from './phase.js';
import { hexToRgbString, mixHex } from './color.js';
import { $, $$ } from './dom.js';
import { requestDraw } from './canvas_render.js';
import { state, ui } from './state.js';
import { toast } from './desktop.js';

let appearanceActions = {
  drawModulePreview: () => {},
  scheduleChartDraw: () => {},
};

export function setAppearanceActions(actions: { drawModulePreview: () => void; scheduleChartDraw: () => void }): void {
  appearanceActions = actions;
}

export const ACCENT_SWATCHES = ['', '#9b7247', '#565c46', '#3f5d6b', '#8a4234', '#6b6257', '#7a5a33', '#5f7a52'];
export const PREF_CACHE_KEY = 'netlab.ui.prefs';

  /* ---- P-A4 外观面板：默认值、档位枚举与运行期覆盖层 ----
   * 单一来源原则：默认令牌仍只来自 theme.tokens.ts；本层仅保存「用户可调项」的偏好，
   * 由 applyAppearance() 计算出一张精简的运行期覆盖（只含与默认不同的键），
   * tokens() 返回 {...基础令牌, ...运行期覆盖}，从而同一份覆盖同时驱动 DOM(--accent…) 与画布取色。 */
export interface AppearanceDefaults {
    theme: string; motion: string; perf: string; accent: string; accentDark: string;
    fontScale: number; density: string; surfaceTone: number; radius: number;
    lineWidth: number; chartPalette: string;
  }
export const PREF_DEFAULTS: AppearanceDefaults = {
    theme: 'system', motion: 'low', perf: 'perf', accent: '', accentDark: '',
    fontScale: 12, density: 'standard', surfaceTone: 0, radius: 0,
    lineWidth: 1, chartPalette: 'theme',
  };
export const FONT_SCALES = [11, 12, 13, 14];
export const RADIUS_STEPS = [0, 2, 4];
export const LINE_STEPS = [1, 1.5];
export const CHART_MODES = ['theme', 'high-contrast', 'colorblind'];

  // 运行期令牌覆盖表：默认空（=与静态令牌完全一致）；applyAppearance 按需填充。

  // 当前主题实际生效的强调色（浅色读 accent，深色读 accentDark，各自记忆）。
export function activeAccent(theme: string, pal: Record<string, string>): string {
    const pref = state.prefs || {};
    const custom = theme === 'dark' ? pref.accentDark : pref.accent;
    return (typeof custom === 'string' && custom) ? custom : pal.accent;
  }

  // 计算运行期覆盖：只记录与默认不同的键（强调色 / 明暗强度微调）。
export function computeRuntimeOverride(theme: 'light' | 'dark'): Record<string, string> {
    const base = THEME_TOKENS[theme] as Record<string, string>;
    const pref = state.prefs || {};
    const override: Record<string, string> = {};
    const accent = activeAccent(theme, base);
    if (accent && accent !== base.accent) {
      override.accent = accent;
      override.accentSoft = mixHex(base.paper, accent, 0.28);
    }
    const tone = clamp(Number(pref.surfaceTone) || 0, -1, 1);
    if (tone !== 0) {
      const anchor = tone > 0 ? base.toneWhite : base.toneBlack;
      if (anchor) {
        const amount = Math.abs(tone) * 0.16;
        for (const key of ['paper', 'panel', 'surface', 'paper3']) {
          if (base[key]) override[key] = mixHex(base[key], anchor, amount);
        }
      }
    }
    return override;
  }


export function applyAppearance() {
    const root = document.documentElement;
    const pref = state.prefs || {};
    const theme = resolveTheme(pref.theme || 'system');
    root.dataset.theme = theme;
    root.dataset.motion = pref.motion || 'low';
    root.dataset.perf = pref.perf || 'perf';

    // 3) 字号档 / 4) 密度 / 6b) 线条 / 9) 画布配色 → data-* 钩子（CSS 侧 var(--ui-font-scale) / var(--ui-line) / 密度规则）
    const fontScale = FONT_SCALES.includes(Number(pref.fontScale)) ? Number(pref.fontScale) : PREF_DEFAULTS.fontScale;
    root.dataset.font = String(fontScale);
    const density = ['compact', 'standard', 'loose'].includes(String(pref.density)) ? String(pref.density) : PREF_DEFAULTS.density;
    root.dataset.density = density;
    const lineWidth = LINE_STEPS.includes(Number(pref.lineWidth)) ? Number(pref.lineWidth) : PREF_DEFAULTS.lineWidth;
    root.dataset.line = String(lineWidth);
    const chartMode = CHART_MODES.includes(String(pref.chartPalette)) ? String(pref.chartPalette) : PREF_DEFAULTS.chartPalette;
    root.dataset.chart = chartMode;

    // 6a) 圆角：直接覆盖 --radius（默认 0px 与生成 CSS 一致，不产生变化）
    const radius = RADIUS_STEPS.includes(Number(pref.radius)) ? Number(pref.radius) : PREF_DEFAULTS.radius;
    root.style.setProperty('--radius', `${radius}px`);

    // 运行期覆盖层（强调色 / 明暗微调）：同步写入画布 token 与 DOM CSS 变量
    const pal = THEME_TOKENS[theme] as Record<string, string>;
    const override = computeRuntimeOverride(theme);
    setRuntimeOverride(override);
    const accent = override.accent || pal.accent;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-rgb', hexToRgbString(accent));
    root.style.setProperty('--accent-soft', override.accentSoft || mixHex(pal.paper, accent, 0.28));
    root.style.setProperty('--accent-2', pal.accent2);
    root.style.setProperty('--green', pal.green);
    // 5) 明暗强度微调：纸面(paper) / 表面(paper-2↔panel, paper-3↔surface)；默认值=基础令牌值，无变化
    root.style.setProperty('--paper', override.paper || pal.paper);
    root.style.setProperty('--paper-2', override.panel || pal.panel);
    root.style.setProperty('--paper-3', override.surface || pal.surface);

    state.palette = pal;
    if (ui.infoBar) ui.infoBar.style.display = pref.infobar === false ? 'none' : '';
    syncPrefControls();
    writePrefCache();
    if (state.booted) {
      requestDraw();
      appearanceActions.scheduleChartDraw();
      drawPhase();
      if (ui.moduleWin && !ui.moduleWin.hidden) appearanceActions.drawModulePreview();
    }
  }

export function resolveTheme(pref: string) {
    if (pref === 'light' || pref === 'dark') return pref;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

export function readPrefCache() {
    try {
      return JSON.parse(window.localStorage.getItem(PREF_CACHE_KEY) || 'null');
    } catch (error) {
      return null;
    }
  }

export function writePrefCache() {
    try {
      window.localStorage.setItem(PREF_CACHE_KEY, JSON.stringify(state.prefs || {}));
    } catch (error) {
      // 隐私模式忽略
    }
  }

export async function loadUiPrefs() {
    const cached = readPrefCache();
    if (cached && typeof cached === 'object') state.prefs = { ...state.prefs, ...cached };
    // 启动引导改为「每次启动必显」：无论缓存里存过什么都没关系，强制 always
    state.prefs.guide = 'always';
    applyAppearance();
    try {
      const response = await jsonRequest('/api/settings', 'GET');
      const stored = response.settings || {};
      state.settings = stored;
      state.prefs.theme = ['system', 'light', 'dark'].includes(stored.theme) ? stored.theme : 'system';
      state.prefs.motion = ['off', 'low', 'med', 'high'].includes(stored.ui_motion) ? stored.ui_motion : 'low';
      state.prefs.perf = ['perf', 'balanced', 'quality'].includes(stored.ui_perf) ? stored.ui_perf : 'perf';
      state.prefs.accent = typeof stored.ui_accent === 'string' ? stored.ui_accent : '';
      // 启动引导一律按 always 处理（不再允许通过 ui_guide='never' 关闭开始页）
      state.prefs.guide = 'always';
      if (typeof stored.autosave_enabled === 'boolean') state.project.autosave = stored.autosave_enabled;
      const interval = Number(stored.autosave_interval_seconds);
      if (Number.isFinite(interval) && interval >= 5) state.project.autosaveInterval = interval * 1000;
      applyAppearance();
    } catch (error) {
      // 后端离线时使用缓存
    }
    state.uiReady = true;
  }

export const PREF_SETTING_KEYS = { theme: 'theme', motion: 'ui_motion', perf: 'ui_perf', accent: 'ui_accent' };

export async function setPref(key: string, value: unknown) {
    state.prefs[key] = value;
    applyAppearance();
    const settingKey = PREF_SETTING_KEYS[key as keyof typeof PREF_SETTING_KEYS];
    if (!settingKey) return;
    try {
      const response = await jsonRequest('/api/settings', 'PATCH', { [settingKey]: value });
      state.settings = response.settings || state.settings;
    } catch (error) {
      toast(`偏好保存失败：${(error as Error).message}`, 'warn', 3200);
    }
  }

export function syncPrefControls() {
    const prefs = state.prefs || {};
    const paint = (host: HTMLElement, value: string) => {
      if (!host) return;
      $$('button[data-value]', host).forEach((node) => {
        const on = node.dataset.value === value;
        node.classList.toggle('active', on);
        node.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    };
    paint($('#segTheme'), prefs.theme || 'system');
    paint($('#segMotion'), prefs.motion || 'low');
    paint($('#segPerf'), prefs.perf || 'perf');
    paint($('#segInfoBar'), prefs.infobar === false ? 'off' : 'on');
    paint($('#segSheet'), String(state.ui?.drawingSheet || 'A3'));
    paint($('#segDrawLabels'), state.ui?.drawingLabels ? 'on' : 'off');
    paint($('#segDrawPage'), String(state.ui?.drawingPage || 1));
    paint($('#segAutosave'), state.project.autosave ? 'on' : 'off');
    if ($('#selAutosaveInterval')) ($('#selAutosaveInterval') as HTMLInputElement).value = String(Math.round(state.project.autosaveInterval / 1000));
    // P-A4 新增 6 项外观控件回填
    paint($('#segFont'), String(prefs.fontScale ?? PREF_DEFAULTS.fontScale));
    paint($('#segDensity'), String(prefs.density ?? PREF_DEFAULTS.density));
    paint($('#segRadius'), String(prefs.radius ?? PREF_DEFAULTS.radius));
    paint($('#segLine'), String(prefs.lineWidth ?? PREF_DEFAULTS.lineWidth));
    paint($('#segChart'), String(prefs.chartPalette ?? PREF_DEFAULTS.chartPalette));
    const toneInput = $('#rngTone') as HTMLInputElement | null;
    if (toneInput) {
      const tone = Number(prefs.surfaceTone ?? 0);
      if (document.activeElement !== toneInput) toneInput.value = String(tone);
      const toneLabel = $('#rngToneVal');
      if (toneLabel) toneLabel.textContent = tone === 0 ? '0' : (tone > 0 ? `+${tone.toFixed(2)}` : tone.toFixed(2));
    }
    const swatches = $('#accentSwatches');
    if (swatches) {
      const activeVal = themeKey() === 'dark' ? (prefs.accentDark || '') : (prefs.accent || '');
      const preset = ACCENT_SWATCHES.includes(activeVal);
      $$('button', swatches).forEach((node) => {
        const val = node.dataset.value || '';
        const on = val === '__custom__' ? (!preset && !!activeVal) : (val === activeVal);
        node.classList.toggle('active', on);
        node.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (val === '__custom__') node.style.background = (activeVal && !preset) ? activeVal : '';
      });
    }
  }
