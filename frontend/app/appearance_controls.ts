// 外观设置与遥测质量（S5-40 从 app.ts 迁出）
import { CANVAS_DARK, CANVAS_LIGHT } from '../theme.tokens.js';
import { ACCENT_SWATCHES, PREF_DEFAULTS, applyAppearance, setPref, syncPrefControls, writePrefCache } from './appearance.js';
import { api, jsonRequest } from './net.js';
import { button } from './ui.js';
import { chartPalette, themeKey } from './theme.js';
import { markProjectDirty } from './project.js';
import { requestDraw } from './canvas_render.js';
import { $, $$ } from './dom.js';
import { state, ui } from './state.js';
import { toast } from './desktop.js';

let appearanceControlActions = {
  openIroColorPopover: (_anchor: HTMLElement, _value: string, _onChange: (value: string) => void): void => {},
};

export function setAppearanceControlActions(actions: {
  openIroColorPopover: (anchor: HTMLElement, value: string, onChange: (value: string) => void) => void;
}): void {
  appearanceControlActions = actions;
}

export function initAppearanceControls() {
    $('#segTheme')?.addEventListener('click', (event: MouseEvent) => {
      const target = (event.target! as Element).closest('button[data-value]') as HTMLElement | null;
      if (target) void setPref('theme', target.dataset.value);
    });
    $('#segMotion')?.addEventListener('click', (event: MouseEvent) => {
      const target = (event.target! as Element).closest('button[data-value]') as HTMLElement | null;
      if (target) void setPref('motion', target.dataset.value);
    });
    $('#segPerf')?.addEventListener('click', (event: MouseEvent) => {
      const target = (event.target! as Element).closest('button[data-value]') as HTMLElement | null;
      if (target) void setPref('perf', target.dataset.value);
    });
    $('#segInfoBar')?.addEventListener('click', (event: MouseEvent) => {
      const target = (event.target! as Element).closest('button[data-value]') as HTMLElement | null;
      if (!target) return;
      state.prefs.infobar = target.dataset.value !== 'off';
      applyAppearance();
    });
    const bindDrawingSeg = (id: string, apply: (value: string) => void) => {
      $(id)?.addEventListener('click', (event: MouseEvent) => {
        const target = (event.target! as Element).closest('button[data-value]') as HTMLElement | null;
        if (!target) return;
        apply(String(target.dataset.value || ''));
        markProjectDirty();
        requestDraw();
        syncPrefControls();
      });
    };
    bindDrawingSeg('#segSheet', (value) => { state.ui.drawingSheet = value; });
    bindDrawingSeg('#segDrawLabels', (value) => { state.ui.drawingLabels = value === 'on'; });
    bindDrawingSeg('#segDrawPage', (value) => { state.ui.drawingPage = Math.max(1, Math.min(9, Number(value) || 1)); });
    $('#segAutosave')?.addEventListener('click', (event: MouseEvent) => {
      const target = (event.target! as Element).closest('button[data-value]') as HTMLElement | null;
      if (!target) return;
      void saveAutosaveSetting({ autosave_enabled: target.dataset.value === 'on' });
    });
    $('#selAutosaveInterval')?.addEventListener('change', () => {
      const seconds = Number(($('#selAutosaveInterval') as HTMLInputElement).value);
      if (Number.isFinite(seconds)) void saveAutosaveSetting({ autosave_interval_seconds: seconds });
    });

    // P-A4：字号 / 密度 / 圆角 / 线条 / 画布配色 —— 通用分段控件绑定
    const bindAppearSeg = (id: string, key: string, numeric: boolean) => {
      $(id)?.addEventListener('click', (event: MouseEvent) => {
        const target = (event.target! as Element).closest('button[data-value]') as HTMLElement | null;
        if (!target) return;
        const raw = String(target.dataset.value || '');
        void setPref(key, numeric ? Number(raw) : raw);
      });
    };
    bindAppearSeg('#segFont', 'fontScale', true);
    bindAppearSeg('#segDensity', 'density', false);
    bindAppearSeg('#segRadius', 'radius', true);
    bindAppearSeg('#segLine', 'lineWidth', true);
    bindAppearSeg('#segChart', 'chartPalette', false);

    // 5) 明暗强度微调（纸面/表面）：拖动实时应用，结束落盘
    $('#rngTone')?.addEventListener('input', () => {
      const input = $('#rngTone') as HTMLInputElement;
      state.prefs.surfaceTone = Number(input.value) || 0;
      applyAppearance();
      const toneLabel = $('#rngToneVal');
      const tone = Number(state.prefs.surfaceTone);
      if (toneLabel) toneLabel.textContent = tone === 0 ? '0' : (tone > 0 ? `+${tone.toFixed(2)}` : tone.toFixed(2));
    });
    $('#rngTone')?.addEventListener('change', () => { writePrefCache(); });

    const swatches = $('#accentSwatches');
    if (swatches) {
      for (const value of ACCENT_SWATCHES) {
        const node = button(value ? '' : 'A', 'swatch', () => {
          // 浅色与深色各自记忆：浅色写 accent（后端），深色写 accentDark（本地）
          if (themeKey() === 'dark') void setPref('accentDark', value);
          else void setPref('accent', value);
        });
        node.dataset.value = value;
        node.title = value ? `强调色 ${value}` : '默认强调色（跟随主题）';
        if (!value) node.classList.add('default');
        node.style.background = value || 'linear-gradient(135deg, #9b7247 50%, #eae5e1 50%)';
        node.dataset.swatch = value || 'default';
        swatches.appendChild(node);
      }
      // 2) 自定义强调色（iro 取色器，浅深各记）
      const custom = button('', 'swatch swatch-custom');
      custom.dataset.value = '__custom__';
      custom.title = '自定义强调色';
      custom.addEventListener('click', () => {
        const dark = themeKey() === 'dark';
        const current = (dark ? state.prefs.accentDark : state.prefs.accent) || '';
        const seed = current || (dark ? CANVAS_DARK.accent : CANVAS_LIGHT.accent);
        appearanceControlActions.openIroColorPopover(custom, seed, (hex: string) => {
          if (dark) void setPref('accentDark', hex);
          else void setPref('accent', hex);
        });
      });
      swatches.appendChild(custom);
    }

    // 恢复默认（外观 9 项回默认 = 当前外观）
    $('#btnResetAppearance')?.addEventListener('click', () => void resetAppearance());

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((state.prefs.theme || 'system') === 'system') applyAppearance();
    });
  }

  // P-A4：恢复默认（把外观 9 项偏好回退到默认值；默认=当前外观，不改则无视觉变化）。
  // 新增 6 项只存 localStorage（writePrefCache）；现有 5 项同步回后端 settings.json。
export async function resetAppearance() {
    state.prefs = { ...state.prefs, ...PREF_DEFAULTS };
    applyAppearance();
    try {
      const response = await jsonRequest('/api/settings', 'PATCH', {
        theme: PREF_DEFAULTS.theme,
        ui_motion: PREF_DEFAULTS.motion,
        ui_perf: PREF_DEFAULTS.perf,
        ui_accent: PREF_DEFAULTS.accent,
      });
      state.settings = response.settings || state.settings;
      toast('外观已恢复默认', 'ok', 2000);
    } catch (error) {
      toast(`外观已恢复默认（本地）；后端未同步：${(error as Error).message}`, 'warn', 3200);
    }
  }

export async function saveAutosaveSetting(patch: Record<string, unknown>) {
    state.project.autosave = (patch.autosave_enabled !== undefined ? patch.autosave_enabled : state.project.autosave) as boolean;
    if (patch.autosave_interval_seconds) state.project.autosaveInterval = (patch.autosave_interval_seconds as number) * 1000;
    syncPrefControls();
    try {
      const response = await jsonRequest('/api/settings', 'PATCH', patch);
      state.settings = response.settings || state.settings;
      toast(patch.autosave_enabled === false ? '自动保存已关闭' : patch.autosave_enabled ? '自动保存已开启' : '快照间隔已更新', 'ok', 2000);
    } catch (error) {
      toast(`设置保存失败：${(error as Error).message}`, 'error', 3600);
    }
  }

  // ---- 设置窗（非模态内部浮窗） ---------------------------------------------
  export type TelemetryQuality = {
    sample_dt?: number | null;
    quant_bits?: number | null;
    interp_error_bound?: number | null;
    interp_error_bound_method?: string | null;
    fifo_depth?: number | null;
    delay_bound?: number | null;
    delay_bound_method?: string | null;
    assumptions?: string[];
    sim_time?: number;
    steps?: number;
    running?: boolean;
  };

export function formatQualityNumber(value: number | null | undefined, unit = ''): string {
    if (value === null || value === undefined) return '—';
    if (!Number.isFinite(value)) return String(value);
    return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 6 })}${unit}`;
  }

export function setQualityText(selector: string, text: string) {
    const node = $(selector);
    if (node) node.textContent = text;
  }

export async function refreshTelemetryQuality() {
    const status = $('#diagStatus');
    if (status) status.textContent = '读取中…';
    try {
      const payload = await api('/api/diagnostics/telemetry');
      const quality = (payload?.telemetry || {}) as TelemetryQuality;
      const assumptions = (quality.assumptions || []).filter((item) => item.trim().length > 0);
      const missing: string[] = [];
      if (quality.sample_dt === null || quality.sample_dt === undefined) missing.push('sample_dt');
      // quant_bits=None 表示"当前链路未启用量化"，是合法状态，不算缺失。
      if (quality.interp_error_bound === null || quality.interp_error_bound === undefined) missing.push('interp_error_bound');
      if (quality.delay_bound === null || quality.delay_bound === undefined) missing.push('delay_bound');
      setQualityText('#diagSampleDt', formatQualityNumber(quality.sample_dt, ' s'));
      setQualityText(
        '#diagQuantBits',
        quality.quant_bits === null || quality.quant_bits === undefined ? '未启用量化' : `${quality.quant_bits} bit`,
      );
      setQualityText(
        '#diagInterpBound',
        quality.interp_error_bound === null || quality.interp_error_bound === undefined
          ? '未声明'
          : `${formatQualityNumber(quality.interp_error_bound)}${quality.interp_error_bound_method ? `（${quality.interp_error_bound_method}）` : ''}`,
      );
      setQualityText('#diagFifoDepth', formatQualityNumber(quality.fifo_depth, ' 帧'));
      setQualityText(
        '#diagDelayBound',
        quality.delay_bound === null || quality.delay_bound === undefined
          ? '未声明'
          : `${formatQualityNumber(quality.delay_bound, ' s')}${quality.delay_bound_method ? `（${quality.delay_bound_method}）` : ''}`,
      );
      setQualityText('#diagAssumptions', assumptions.length ? `假设：${assumptions.join('；')}` : '假设：—');
      if (status) {
        status.textContent = missing.length ? `不完整：缺少 ${missing.join('、')}` : '完整（可用）';
        status.dataset.state = missing.length ? 'partial' : 'ok';
      }
    } catch (error) {
      if (status) {
        status.textContent = `读取失败：${(error as Error).message}`;
        status.dataset.state = 'error';
      }
    }
  }
