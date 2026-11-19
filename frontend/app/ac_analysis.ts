// 电路分析窗口外壳：DC 工作点 + 分析工作台入口（旧 Canvas 图表已于 phase 5 退役）
import { operatingPointRequest } from './analysis_client.js';
import { $, $$ } from './dom.js';
import { clampFloatWindow, raiseFloatWindow } from './float.js';
import { state } from './state.js';
import { toast } from './desktop.js';
import { openAnalysisWorkbench } from './analysis_workbench.js';
import type { OpElementRec } from './types.js';

function _dispDigits(): number {
    const n = Number((state.prefs || {}).numericDigits ?? 6);
    return Number.isFinite(n) ? Math.max(3, Math.min(17, Math.round(n))) : 6;
  }

export function analEscape(text: string) {
    return String(text ?? '').replace(/[&<>"]/g, (ch) => (
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[ch]
    ));
  }

export function analNum(value: unknown, digits: number = _dispDigits()) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    const abs = Math.abs(num);
    if (abs !== 0 && (abs < 1e-4 || abs >= 1e5)) return num.toExponential(3);
    return String(Number(num.toFixed(digits)));
  }

export function analToken(name: string, fallback: string) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (value || '').trim() || fallback;
  }

export function niceAxisTicks(min: number, max: number, target = 5): { min: number; max: number; step: number; values: number[] } {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      return { min: 0, max: 1, step: 1, values: [0, 1] };
    }
    const rough = (max - min) / Math.max(2, target);
    const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    const normalized = rough / magnitude;
    const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
    const low = Math.floor(min / step) * step;
    const high = Math.ceil(max / step) * step;
    const values: number[] = [];
    for (let value = low, index = 0; value <= high + step * 0.5 && index < 100; value += step, index += 1) {
      values.push(Number(value.toPrecision(_dispDigits())));
    }
    return { min: low, max: high, step, values };
  }

export function niceAxisLabel(value: number): string {
    if (!Number.isFinite(value)) return '';
    const abs = Math.abs(value);
    if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return value.toExponential(2);
    return String(Number(value.toPrecision(_dispDigits())));
  }

export function analysisWarn() {
    // 用户要求：开始分析前弹提醒，但不阻止
    toast('分析会基于当前场景重新求解，期间实时播放会暂停；可随时关闭分析窗。', 'warn', 4200);
  }

export function openAnalysis(tab = 'op') {
    const win = $('#analWin');
    if (!win) return;
    if ((state.scene?.mode || state.mode) !== 'circuit') {
      toast('电路分析只在电路模式下可用', 'error', 4000);
      return;
    }
    win.hidden = false;
    raiseFloatWindow(win);
    clampFloatWindow(win);
    const mapped = tab === 'ac' || tab === 'bypass' || tab === 'wb-analysis' ? 'workbench' : tab;
    selectAnalTab(mapped);
    if (mapped === 'workbench') {
      if (tab === 'wb-analysis') openAnalysisWorkbench();
      else openAnalysisWorkbench(tab === 'bypass' ? 'time' : 'bode');
    }
  }

export function closeAnalysis() {
    const win = $('#analWin');
    if (win) win.hidden = true;
  }

export function selectAnalTab(tab: string) {
    for (const btn of $$('.anal-tab')) {
      btn.classList.toggle('active', btn.dataset.anal === tab);
    }
    for (const pane of $$('.anal-pane')) {
      pane.hidden = pane.dataset.analPane !== tab;
    }
    if (tab === 'workbench' && !$('#analWorkbench')) {
      toast('分析工作台容器缺失', 'error', 4000);
    }
  }

export async function runOperatingPoint() {
    analysisWarn();
    const body = $('#analOpTable');
    const meta = $('#analOpMeta');
    if (meta) meta.textContent = '求解中…';
    try {
      const data = await operatingPointRequest();
      const result = data.result || {};
      const nodeRows = Object.entries(result.node_voltages || {}).map(([name, value]) => (
        `<tr><td>${analEscape(name)}</td><td class="num">${analNum(value)}</td></tr>`
      )).join('');
      const elementRows = Object.entries((result.elements || {}) as Record<string, OpElementRec>).map(([name, info]) => (
        `<tr><td>${analEscape(name)}</td><td class="num">${analNum(info.current)}</td>`
        + `<td class="num">${analNum(info.voltage_difference)}</td>`
        + `<td class="num">${analNum(info.power)}</td></tr>`
      )).join('');
      if (body) {
        body.innerHTML = '<table><caption>节点电压（V）</caption><thead><tr><th>节点</th>'
          + '<th>电压</th></tr></thead><tbody>' + (nodeRows || '<tr><td colspan="2">没有节点</td></tr>')
          + '</tbody></table><table><caption>元件</caption><thead><tr><th>元件</th>'
          + '<th>电流（A）</th><th>端电压（V）</th><th>功率（W）</th></tr></thead><tbody>'
          + (elementRows || '<tr><td colspan="4">没有元件</td></tr>') + '</tbody></table>';
      }
      if (meta) {
        meta.textContent = `迭代 ${result.iterations ?? '—'} 步 · 矩阵 ${result.matrix_size ?? '—'}`
          + ` · 残差 ${analNum(result.residual, 3)} · ${result.sparse ? '稀疏' : '稠密'}`
          + (result.strategies?.length ? ` · ${result.strategies.join('/')}` : '');
      }
    } catch (error) {
      if (body) body.innerHTML = `<div class="anal-empty">${analEscape((error as Error).message)}</div>`;
      if (meta) meta.textContent = '求解失败';
      toast(`DC 工作点失败：${(error as Error).message}`, 'error', 6000);
    }
  }
