// 交流分析面板（S5-36 从 app.ts 迁出）
import { C } from './colors.js';
import { PALETTE } from './constants.js';
import { api } from './net.js';
import { $, $$, canvas, ctx } from './dom.js';
import { chartPalette } from './theme.js';
import { div } from './ui.js';
import { clampFloatWindow, raiseFloatWindow } from './float.js';
import { state, ui } from './state.js';
import { probeNamesForAc } from './ac_probe.js';
import { toast } from './desktop.js';
import type { AcResultRec, OpElementRec } from './types.js';

export function analEscape(text: string) {
    return String(text ?? '').replace(/[&<>"]/g, (ch) => (
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[ch]
    ));
  }

export function analNum(value: unknown, digits: number = 6) {
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

// 图表取色：跟随主题时用 C() 把调色板映射到当前主题令牌（深色主题自动提亮），
// 高对比/色盲友好档位保持原样值。
export function analSeries(): string[] {
    const chartMode = String((state.prefs && state.prefs.chartPalette) || 'theme');
    return chartMode === 'theme' ? PALETTE.map((color) => C(color)) : chartPalette();
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
      values.push(Number(value.toPrecision(12)));
    }
    return { min: low, max: high, step, values };
  }

export function niceAxisLabel(value: number): string {
    if (!Number.isFinite(value)) return '';
    const abs = Math.abs(value);
    if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return value.toExponential(2);
    return String(Number(value.toPrecision(6)));
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
    fillAcSources();
    fillBypassSources();
    selectAnalTab(tab);
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
    if (tab === 'ac') requestAnimationFrame(() => drawAcChart());
    if (tab === 'bypass') {
      fillBypassSources();
      requestAnimationFrame(() => drawBypassCharts());
    }
  }

export function fillAcSources() {
    const select = $('#analAcInput');
    if (!select) return;
    const previous = (select as HTMLInputElement).value;
    const nodes = state.scene?.nodes || [];
    const sources = nodes.filter((node) => {
      const kind = node.kind === 'device' ? node.params?.element : node.kind;
      return kind === 'vsource' || kind === 'isource';
    });
    select.innerHTML = '<option value="">自动</option>'
      + sources.map((node) => (
        `<option value="${analEscape(node.name)}">${analEscape(node.name)}</option>`
      )).join('');
    if (sources.some((node) => node.name === previous)) (select as HTMLInputElement).value = previous;
  }

export async function runOperatingPoint() {
    analysisWarn();
    const body = $('#analOpTable');
    const meta = $('#analOpMeta');
    if (meta) meta.textContent = '求解中…';
    try {
      const data = await api('/api/operating-point');
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

export async function runAcSweep() {
    analysisWarn();
    const meta = $('#analAcMeta');
    const params = new URLSearchParams();
    const input = ($('#analAcInput') as HTMLInputElement)?.value || '';
    if (input) params.set('input', input);
    params.set('f_start', ($('#analAcF1') as HTMLInputElement)?.value || '10');
    params.set('f_stop', ($('#analAcF2') as HTMLInputElement)?.value || '1000000');
    params.set('points', ($('#analAcPts') as HTMLInputElement)?.value || '121');
    params.set('scale', ($('#analAcScale') as HTMLInputElement)?.value || 'log');
    // 默认只看节点电压（元件电流曲线太密，需要时可在后端 probes 指定）；
    // 接地节点由 probeNamesForAc 排除（后端 AC 探针不接受 ground）。
    const probeNames = probeNamesForAc(state.scene?.nodes || []);
    if (probeNames.length) params.set('probes', probeNames.join(','));
    if (meta) meta.textContent = '扫频中…';
    try {
      const data = await api(`/api/ac-sweep?${params.toString()}`);
      state.acResult = data.result || null;
      state.acRevision = state.scene?.revision ?? null;
      const result = state.acResult as AcResultRec | null;
      const count = Object.keys(result?.probes || {}).length;
      if (meta) {
        meta.textContent = `${count} 条曲线 · 激励 ${result?.input || '—'} · ${result?.frequencies?.length || 0} 点`;
      }
      drawAcChart();
    } catch (error) {
      state.acResult = null;
      if (meta) meta.textContent = '扫频失败';
      toast(`AC 扫频失败：${(error as Error).message}`, 'error', 7000);
      drawAcChart();
    }
  }

export function drawAcChart() {
    const canvas = $('#analAcCanvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    const dpr = window.devicePixelRatio || 1;
    (canvas as HTMLCanvasElement).width = Math.round(rect.width * dpr);
    (canvas as HTMLCanvasElement).height = Math.round(rect.height * dpr);
    const ctx = (canvas as HTMLCanvasElement).getContext('2d');
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = rect.width;
    const H = rect.height;
    const ink = analToken('--ink', '#080a08');
    const muted = analToken('--muted', '#7b7266');
    const line = analToken('--line', '#d9d3c7');
    ctx!.clearRect(0, 0, W, H);
    const result = state.acResult as AcResultRec | null;
    const legend = $('#analAcLegend');
    if (!result || !result.frequencies?.length) {
      if (legend) legend.innerHTML = '';
      ctx!.fillStyle = muted;
      ctx!.font = '12.5px "Microsoft YaHei UI", sans-serif';
      ctx!.fillText('选择激励与频率范围后点「开始扫频」', 16, 26);
      return;
    }
    const freqs = result.frequencies;
    const probes = Object.entries(result.probes || {});
    const scale = ($('#analAcScale') as HTMLInputElement)?.value || 'log';
    const f0 = freqs[0];
    const f1 = freqs[freqs.length - 1];
    const padL = 52;
    const padR = 14;
    const padT = 12;
    const gap = 30;
    const padB = 26;
    const magH = (H - padT - padB - gap) * 0.62;
    const phaseH = (H - padT - padB - gap) - magH;
    const magTop = padT;
    const phaseTop = padT + magH + gap;
    const plotW = Math.max(40, W - padL - padR);
    const xOf = (f: number) => {
      if (scale === 'log') {
        const lo = Math.log10(Math.max(f0, 1e-9));
        const hi = Math.log10(Math.max(f1, 1e-9));
        const span = hi - lo || 1;
        return padL + ((Math.log10(Math.max(f, 1e-9)) - lo) / span) * plotW;
      }
      const span = (f1 - f0) || 1;
      return padL + ((f - f0) / span) * plotW;
    };

    let minDb = 0;
    let maxDb = 0;
    for (const [, info] of probes) {
      for (const value of (info as { db?: number[] }).db || []) {
        if (!Number.isFinite(value)) continue;
        minDb = Math.min(minDb, value);
        maxDb = Math.max(maxDb, value);
      }
    }
    if (maxDb - minDb < 6) {
      maxDb += 3;
      minDb -= 3;
    } else {
      minDb -= 3;
      maxDb += 3;
    }
    const yMag = (db: number) => magTop + (1 - (db - minDb) / (maxDb - minDb || 1)) * magH;
    const yPhase = (deg: number) => phaseTop + (1 - (deg + 180) / 360) * phaseH;

    ctx!.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    // 幅度区网格
    ctx!.strokeStyle = line;
    ctx!.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = magTop + (magH * i) / 4;
      ctx!.beginPath();
      ctx!.moveTo(padL, y);
      ctx!.lineTo(padL + plotW, y);
      ctx!.stroke();
      ctx!.fillStyle = muted;
      const value = maxDb - ((maxDb - minDb) * i) / 4;
      ctx!.fillText(`${value.toFixed(0)} dB`, 6, y + 4);
    }
    // 相位区网格
    for (const deg of [-180, -90, 0, 90, 180]) {
      const y = yPhase(deg);
      ctx!.beginPath();
      ctx!.moveTo(padL, y);
      ctx!.lineTo(padL + plotW, y);
      ctx!.stroke();
      ctx!.fillStyle = muted;
      ctx!.fillText(`${deg}°`, 18, y + 4);
    }
    // 频率刻度
    const ticks = 5;
    for (let i = 0; i < ticks; i += 1) {
      const ratio = i / (ticks - 1);
      const f = scale === 'log' ? 10 ** (Math.log10(f0) + (Math.log10(f1) - Math.log10(f0)) * ratio) : f0 + (f1 - f0) * ratio;
      const x = padL + plotW * ratio;
      ctx!.strokeStyle = line;
      ctx!.beginPath();
      ctx!.moveTo(x, magTop);
      ctx!.lineTo(x, magTop + magH + gap + phaseH);
      ctx!.stroke();
      ctx!.fillStyle = muted;
      const label = f >= 1e6 ? `${(f / 1e6).toFixed(1)}M` : f >= 1e3 ? `${(f / 1e3).toFixed(1)}k` : f >= 1 ? `${f.toFixed(0)}` : f.toExponential(0);
      ctx!.fillText(label, x - 8, H - 8);
    }
    // 曲线
    const swatches: string[] = [];
    const series = analSeries();
    probes.forEach(([name, info], index: number) => {
      const color = series[index % series.length];
      swatches.push(`<span><i style="background:${color}"></i>${analEscape(name)}</span>`);
      const draw = (values: number[], yFn: (value: number) => number) => {
        ctx!.beginPath();
        ctx!.strokeStyle = color;
        ctx!.lineWidth = 1.6;
        let started = false;
        for (let i = 0; i < freqs.length; i += 1) {
          const value = values?.[i];
          if (!Number.isFinite(value)) continue;
          const x = xOf(freqs[i]);
          const y = yFn(value);
          if (!started) {
            ctx!.moveTo(x, y);
            started = true;
          } else {
            ctx!.lineTo(x, y);
          }
        }
        if (started) ctx!.stroke();
      };
      draw((info as { db: number[] }).db, yMag);
      draw((info as { phase_deg: number[] }).phase_deg, yPhase);
    });
    if (legend) legend.innerHTML = swatches.join('');
    ctx!.fillStyle = ink;
    ctx!.font = '11.5px "Microsoft YaHei UI", sans-serif';
    ctx!.fillText('幅值', 6, magTop + 8);
    ctx!.fillText('相位', 6, phaseTop + 10);
  }

interface BypassPoleZeroRec {
  finite?: [number, number][];
  infinite_count?: number;
  max_residual?: number;
  size?: number;
  regular?: boolean;
  siso?: boolean;
}

interface BypassStateSpaceRec {
  n?: number;
  m?: number;
  p?: number;
  elements?: number;
  truncated?: boolean;
  A?: number[][][];
  E?: number[][][];
  B?: number[][][];
  C?: number[][][];
  D?: number[][][];
}

interface BypassTransferRec {
  supported?: boolean;
  reason?: string;
  expression?: string;
  numerator?: string;
  denominator?: string;
  order?: number;
  relative_order?: number;
  dc_gain?: number | null;
  dc_gain_finite?: boolean;
}

interface BypassPoleMetricRec {
  real?: number;
  imag?: number;
  omega_n?: number | null;
  zeta?: number | null;
  time_constant?: number | null;
}

interface BypassMetricsRec {
  final?: number | null;
  overshoot_pct?: number | null;
  rise_time?: number | null;
  peak_time?: number | null;
  peak_value?: number | null;
  settling_time?: number | null;
  steady_state_error?: number | null;
  stable?: boolean;
  dc_gain?: number | null;
  poles?: BypassPoleMetricRec[];
  bode?: { bandwidth_hz?: number | null; resonant_peak_db?: number | null; resonant_frequency_hz?: number | null };
}

interface BypassRec {
  input_source?: string;
  output?: string;
  operating_point_supplied?: boolean;
  state_space?: BypassStateSpaceRec;
  poles?: BypassPoleZeroRec;
  zeros?: BypassPoleZeroRec;
  transfer_function?: BypassTransferRec;
  metrics?: BypassMetricsRec;
  step?: { probe?: string; times?: number[]; values?: number[]; dt?: number };
  bode?: { frequencies?: number[]; probes?: Record<string, { frequencies?: number[]; db?: number[]; phase_deg?: number[] }> };
}

let bypassResult: BypassRec | null = null;

function bypassNodeKind(node: { kind?: string; params?: { element?: string } }): string {
  return node.kind === 'device' ? (node.params?.element || '') : (node.kind || '');
}

export function fillBypassSources() {
    const input = $('#analBypassInput') as HTMLInputElement | null;
    const output = $('#analBypassOutput') as HTMLInputElement | null;
    const nodes = state.scene?.nodes || [];
    const edges = state.scene?.edges || [];
    if (input) {
      const previous = input.value;
      const edgeSources = edges
        .filter((edge) => ['vsource', 'isource'].includes(edge.kind))
        .map((edge) => edge.name);
      const nodeSources = nodes
        .filter((node) => ['vsource', 'isource'].includes(bypassNodeKind(node)))
        .map((node) => node.name);
      const sources = Array.from(new Set([...edgeSources, ...nodeSources]));
      input.innerHTML = '<option value="">自动</option>'
        + sources.map((name) => `<option value="${analEscape(name)}">${analEscape(name)}</option>`).join('');
      if (sources.includes(previous)) input.value = previous;
      else if (sources.length) input.value = sources[0];
    }
    if (output) {
      const previous = output.value;
      const probes = nodes.filter((node) => node.kind !== 'ground');
      const selectedSource = (input?.value || '').trim();
      const sourceEdge = edges.find((edge) => edge.name === selectedSource
        && ['vsource', 'isource'].includes(edge.kind));
      const sourceNodes = new Set(sourceEdge ? [sourceEdge.source, sourceEdge.target] : []);
      const preferred = probes.find((node) => !sourceNodes.has(node.id)) || probes[0];
      output.innerHTML = probes.map((node) => (
        `<option value="${analEscape(node.name)}">${analEscape(node.name)}</option>`
      )).join('');
      if (probes.some((node) => node.name === previous)) output.value = previous;
      else if (preferred) output.value = preferred.name;
    }
  }

function bypassComplex(value: [number, number] | undefined): string {
    if (!Array.isArray(value)) return '—';
    const [re, im] = value;
    const real = analNum(re);
    const imag = Math.abs(im) < 1e-12 ? '0' : analNum(Math.abs(im));
    if (Math.abs(im) < 1e-12) return real;
    return `${real} ${im < 0 ? '−' : '+'} j${imag}`;
  }

function bypassTable(target: string, label: string, data: BypassPoleZeroRec | undefined, poleMetrics?: BypassPoleMetricRec[]) {
    const host = $(target);
    if (!host) return;
    const values = data?.finite || [];
    const showPoleMetrics = Boolean(poleMetrics?.length);
    const rows = values.map((value, index) => {
      const metric = poleMetrics?.[index];
      const extra = showPoleMetrics
        ? `<td class="num">${analNum(metric?.omega_n)}</td><td class="num">${analNum(metric?.zeta)}</td><td class="num">${analNum(metric?.time_constant)}</td>`
        : '';
      return `<tr><td>${index + 1}</td><td class="num">${bypassComplex(value)}</td>${extra}</tr>`;
    }).join('');
    const notes: string[] = [];
    if (data?.infinite_count) notes.push(`无穷模态 ${data.infinite_count}`);
    if (data?.max_residual !== undefined) notes.push(`残差 ${analNum(data.max_residual)}`);
    if (data?.regular === false) notes.push('QZ 非正则');
    if (data?.siso === false) notes.push('MIMO 未求零点');
    host.innerHTML = `<div class="anal-meta">${label}（${values.length} 个）${notes.length ? ` · ${notes.join(' · ')}` : ''}</div>`
      + (rows
        ? `<table class="anal-table"><thead><tr><th>#</th><th>值</th>${showPoleMetrics ? '<th>ωn (rad/s)</th><th>ζ</th><th>时间常数 (s)</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>`
        : '<div class="anal-empty">无有限值</div>');
}

function bypassSummary(result: BypassRec) {
    const host = $('#analBypassSummary');
    const transferHost = $('#analBypassTransfer');
    if (!host || !transferHost) return;
    const tf = result.transfer_function || {};
    const metrics = result.metrics || {};
    const fmtValue = (value: number | null | undefined, unit = '') => (
      value === null || value === undefined || !Number.isFinite(Number(value))
        ? '—'
        : `${analNum(value)}${unit}`
    );
    if (tf.supported === false) {
      transferHost.innerHTML = `<div class="anal-empty">传递函数：${analEscape(tf.reason || '当前电路阶数过高')}</div>`;
    } else {
      transferHost.innerHTML = `<div class="anal-transfer">G(s) = <code>${analEscape(tf.expression || '—')}</code>`
        + `<span class="anal-meta"> · 阶数 ${tf.order ?? '—'} · 相对阶 ${tf.relative_order ?? '—'}</span></div>`;
    }
    const items: Array<[string, string]> = [
      ['DC 增益', tf.dc_gain_finite === false ? '—（A 奇异）' : fmtValue(tf.dc_gain)],
      ['上升时间', fmtValue(metrics.rise_time, ' s')],
      ['峰值时间', fmtValue(metrics.peak_time, ' s')],
      ['峰值', fmtValue(metrics.peak_value, ' V')],
      ['超调', fmtValue(metrics.overshoot_pct, ' %')],
      ['调节时间', fmtValue(metrics.settling_time, ' s')],
      ['稳态误差', fmtValue(metrics.steady_state_error, ' V')],
      ['稳定性', metrics.stable ? '稳定' : '不稳定／无有限极点'],
    ];
    const bode = metrics.bode || {};
    items.push(['Bode 带宽', fmtValue(bode.bandwidth_hz, ' Hz')]);
    items.push(['谐振峰', fmtValue(bode.resonant_peak_db, ' dB')]);
    host.innerHTML = `<div class="anal-metrics-grid">${items.map(([label, value]) => (
      `<div><span>${label}</span><b>${analEscape(value)}</b></div>`
    )).join('')}</div>`;
  }

function bypassPlotFrame(canvasEl: HTMLCanvasElement, emptyText: string) {
    const rect = canvasEl.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return null;
    const dpr = window.devicePixelRatio || 1;
    canvasEl.width = Math.round(rect.width * dpr);
    canvasEl.height = Math.round(rect.height * dpr);
    const context = canvasEl.getContext('2d');
    if (!context) return null;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    if (!bypassResult) {
      context.fillStyle = analToken('--muted', '#7b7266');
      context.font = '12.5px "Microsoft YaHei UI", sans-serif';
      context.fillText(emptyText, 16, 26);
      return null;
    }
    return { context, width: rect.width, height: rect.height };
  }

export function drawBypassBode() {
    const canvasEl = $('#analBypassBode') as HTMLCanvasElement | null;
    if (!canvasEl) return;
    const frame = bypassPlotFrame(canvasEl, '选择激励与输出后点「Bode」');
    if (!frame) return;
    const { context, width, height } = frame;
    const freqs = bypassResult?.bode?.frequencies || [];
    const probes = Object.entries(bypassResult?.bode?.probes || {});
    const legend = $('#analBypassLegend');
    if (!freqs.length || !probes.length) {
      context.fillStyle = analToken('--muted', '#7b7266');
      context.font = '12.5px "Microsoft YaHei UI", sans-serif';
      context.fillText('没有 Bode 数据', 16, 26);
      if (legend) legend.innerHTML = '';
      return;
    }
    const info = probes[0][1];
    const db = info.db || [];
    const phase = info.phase_deg || [];
    const series = analSeries();
    const padL = 52;
    const padR = 14;
    const padT = 12;
    const padB = 26;
    const gap = 24;
    const plotW = Math.max(40, width - padL - padR);
    const magH = (height - padT - padB - gap) * 0.62;
    const phaseH = (height - padT - padB - gap) - magH;
    const phaseTop = padT + magH + gap;
    const logLo = Math.log10(Math.max(freqs[0], 1e-12));
    const logHi = Math.log10(Math.max(freqs[freqs.length - 1], 1e-12));
    const span = logHi - logLo || 1;
    const xOf = (f: number) => padL + ((Math.log10(Math.max(f, 1e-12)) - logLo) / span) * plotW;
    let minDb = 0;
    let maxDb = 0;
    for (const value of db) {
      if (!Number.isFinite(value)) continue;
      minDb = Math.min(minDb, value);
      maxDb = Math.max(maxDb, value);
    }
    if (maxDb - minDb < 6) { maxDb += 3; minDb -= 3; } else { minDb -= 3; maxDb += 3; }
    const magTicks = niceAxisTicks(minDb, maxDb, 5);
    minDb = magTicks.min;
    maxDb = magTicks.max;
    const yMag = (value: number) => padT + (1 - (value - minDb) / (maxDb - minDb || 1)) * magH;
    const yPhase = (value: number) => phaseTop + (1 - (value + 180) / 360) * phaseH;
    const line = analToken('--line', '#d9d3c7');
    const muted = analToken('--muted', '#7b7266');
    context.strokeStyle = line;
    context.lineWidth = 1;
    for (const value of magTicks.values) {
      const y = yMag(value);
      context.beginPath();
      context.moveTo(padL, y);
      context.lineTo(padL + plotW, y);
      context.stroke();
      context.fillStyle = muted;
      context.font = '10px ui-monospace, monospace';
      context.fillText(`${niceAxisLabel(value)} dB`, 4, y + 3);
    }
    context.strokeStyle = series[0];
    context.lineWidth = 1.6;
    context.beginPath();
    db.forEach((value, index) => {
      const x = xOf(freqs[index]);
      const y = yMag(value);
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.stroke();
    context.strokeStyle = series[1] || series[0];
    context.beginPath();
    phase.forEach((value, index) => {
      const x = xOf(freqs[index]);
      const y = yPhase(value);
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.stroke();
    context.fillStyle = muted;
    context.font = '10.5px ui-monospace, monospace';
    context.fillText('幅值', 6, padT + 9);
    context.fillText('相位', 6, phaseTop + 10);
    context.fillText(`${analNum(freqs[0], 3)} Hz`, padL, height - 7);
    context.fillText(`${analNum(freqs[freqs.length - 1], 3)} Hz`, width - padR - 54, height - 7);
    if (legend) {
      legend.innerHTML = `<span><i style="background:${series[0]}"></i>${analEscape(probes[0][0])} 幅值</span>`
        + `<span><i style="background:${series[1] || series[0]}"></i>相位</span>`;
    }
  }

export function drawBypassStep() {
    const canvasEl = $('#analBypassStep') as HTMLCanvasElement | null;
    if (!canvasEl) return;
    const frame = bypassPlotFrame(canvasEl, '运行旁路后显示阶跃响应');
    if (!frame) return;
    const { context, width, height } = frame;
    const times = bypassResult?.step?.times || [];
    const values = bypassResult?.step?.values || [];
    if (!times.length || times.length !== values.length) {
      context.fillStyle = analToken('--muted', '#7b7266');
      context.font = '12.5px "Microsoft YaHei UI", sans-serif';
      context.fillText('没有阶跃数据', 16, 26);
      return;
    }
    const padL = 52;
    const padR = 14;
    const padT = 14;
    const padB = 26;
    const series = analSeries();
    const plotW = Math.max(40, width - padL - padR);
    const plotH = Math.max(30, height - padT - padB);
    const t0 = times[0];
    const t1 = times[times.length - 1];
    let minV = 0;
    let maxV = 0;
    for (const value of values) {
      if (!Number.isFinite(value)) continue;
      minV = Math.min(minV, value);
      maxV = Math.max(maxV, value);
    }
    if (maxV - minV < 1e-9) { maxV += 1e-6; minV -= 1e-6; }
    const yOf = (value: number) => padT + (1 - (value - minV) / (maxV - minV || 1)) * plotH;
    const xOf = (time: number) => padL + ((time - t0) / (t1 - t0 || 1)) * plotW;
    const line = analToken('--line', '#d9d3c7');
    const muted = analToken('--muted', '#7b7266');
    context.strokeStyle = line;
    context.lineWidth = 1;
    const yTicks = niceAxisTicks(minV, maxV, 5);
    minV = yTicks.min;
    maxV = yTicks.max;
    for (const value of yTicks.values) {
      const y = padT + (1 - (value - minV) / (maxV - minV || 1)) * plotH;
      context.beginPath();
      context.moveTo(padL, y);
      context.lineTo(padL + plotW, y);
      context.stroke();
      context.fillStyle = muted;
      context.font = '10px ui-monospace, monospace';
      context.fillText(niceAxisLabel(value), 4, y + 3);
    }
    context.strokeStyle = series[2] || series[0];
    context.lineWidth = 1.6;
    context.beginPath();
    values.forEach((value, index) => {
      const x = xOf(times[index]);
      const y = yOf(value);
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.stroke();
    context.fillStyle = muted;
    context.font = '10.5px ui-monospace, monospace';
    context.fillText('V', 6, padT + 9);
    context.fillText(`${analNum(t0, 3)} s`, padL, height - 7);
    context.fillText(`${analNum(t1, 3)} s`, width - padR - 50, height - 7);
  }

export function drawBypassCharts() {
    drawBypassBode();
    drawBypassStep();
  }

export async function runCircuitBypass() {
    analysisWarn();
    const input = ($('#analBypassInput') as HTMLInputElement | null)?.value || '';
    const output = ($('#analBypassOutput') as HTMLInputElement | null)?.value || '';
    const meta = $('#analBypassMeta');
    if (!input || !output) {
      toast('旁路分析需要选择激励源与输出节点', 'error', 5000);
      return;
    }
    if (meta) meta.textContent = '求解中…';
    try {
      const opData = await api('/api/operating-point');
      const op = (opData.result || {}).node_voltages || null;
      const body = {
        mode: 'circuit',
        input_source: input,
        output,
        operating_point: op,
        step_dt: Number(($('#analBypassDt') as HTMLInputElement | null)?.value || 1e-5),
        step_duration: Number(($('#analBypassDuration') as HTMLInputElement | null)?.value || 5e-3),
        f_start: Number(($('#analBypassF1') as HTMLInputElement | null)?.value || 10),
        f_stop: Number(($('#analBypassF2') as HTMLInputElement | null)?.value || 1e6),
        points: 121,
        scale: 'log',
      };
      const data = await api('/api/analysis/tf', { method: 'POST', body: JSON.stringify(body) });
      bypassResult = data as BypassRec;
      const result = bypassResult;
      const stateSpace = result?.state_space;
      const poleCount = result?.poles?.finite?.length || 0;
      const zeroCount = result?.zeros?.finite?.length || 0;
      if (meta) {
        meta.textContent = result
          ? `n=${stateSpace?.n ?? '—'} · 极点 ${poleCount} · 零点 ${zeroCount}`
            + `${result.poles?.infinite_count ? ` · 无穷 ${result.poles.infinite_count}` : ''}`
            + `${result.operating_point_supplied ? ' · 工作点线性化' : ''}`
          : '无结果';
      }
      bypassTable('#analBypassPoles', '极点', result?.poles, result?.metrics?.poles);
      bypassTable('#analBypassZeros', '零点', result?.zeros);
      bypassSummary(result || {});
      drawBypassCharts();
    } catch (error) {
      bypassResult = null;
      if (meta) meta.textContent = '旁路分析失败';
      const transferHost = $('#analBypassTransfer');
      if (transferHost) transferHost.innerHTML = '';
      const summaryHost = $('#analBypassSummary');
      if (summaryHost) summaryHost.innerHTML = '';
      toast(`旁路分析失败：${(error as Error).message}`, 'error', 7000);
      bypassTable('#analBypassPoles', '极点', undefined);
      bypassTable('#analBypassZeros', '零点', undefined);
      drawBypassCharts();
    }
  }
