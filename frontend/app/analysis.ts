// S5-21 分析面板（R12 / R13 / R17，从 app.ts 原样迁出）
import type { ComplexLike, TfDataRec, TfBodeRec, TfMetricsRec, TfStepRec, SpectrumRec, NodeItem } from './types.js';
import { state, ui } from './state.js';
import { el, div, button } from './ui.js';
import { api, jsonRequest } from './net.js';
import { toast } from './desktop.js';
import { fmt } from '../app.utils.js';
import { $ } from './dom.js';
import { nodeByName } from './model.js';
import { openAnalysis, niceAxisTicks, niceAxisLabel } from './ac_analysis.js';

type AnalysisActions = {
  task: <T>(run: () => T | Promise<T>, options?: Record<string, unknown>) => Promise<T | null>;
  downloadText: (text: string, filename: string) => void;
  phaseStateKeys: (node: NodeItem) => string[];
  C: (value: string) => string;
  tokens: () => Record<string, string>;
};
const analysisActions = {} as AnalysisActions;
export function setAnalysisActions(actions: AnalysisActions): void {
  Object.assign(analysisActions, actions);
}
function task<T>(run: () => T | Promise<T>, options?: Record<string, unknown>) { return analysisActions.task(run, options); }
function downloadText(text: string, filename: string) { analysisActions.downloadText(text, filename); }
function analysisPhaseStateKeys(node: NodeItem) { return analysisActions.phaseStateKeys(node); }
function analysisC(value: string) { return analysisActions.C(value); }
function analysisTokens() { return analysisActions.tokens(); }

  /* ======================================================================
   * 8.8 分析面板（R12 / R13 / R17）：旁路分析，不写求解器
   * ==================================================================== */

export function analysisSignalKey() {
    if (state.chart.selected.size) return [...state.chart.selected][0];
    // 分析后端以显示名索引帧数据，fallback 必须与 updateSignalKeyCache 一致。
    const keys = state.probeKeys || [];
    return keys[0] || '';
  }

export async function analysisGet(path: string, query?: Record<string, string>) {
    const qs = query ? `?${new URLSearchParams(query)}` : '';
    return task(() => jsonRequest(`${path}${qs}`, 'GET'), { dirty: false });
  }

export function setAnalysisOutput(text: string) {
    state.analysisLast = text;
    const out = $('#analysisOut');
    if (out) out.textContent = text;
  }

export async function runAnalysisMetrics() {
    const key = analysisSignalKey();
    if (!key) return toast('还没有录制数据：先运行一段时间', 'info', 2600);
    const response = await analysisGet('/api/analysis/metrics', { keys: key });
    if (!response) return;
    const item = response.items?.[key];
    if (!item || item.ok === false) { setAnalysisOutput(JSON.stringify(item || response, null, 2)); return; }
    setAnalysisOutput(
      [
        `信号 ${key}（${item.samples} 点）`,
        `初值 ${fmt(item.initial, 5)} → 终值 ${fmt(item.final, 5)}`,
        `min ${fmt(item.min, 5)}  max ${fmt(item.max, 5)}  mean ${fmt(item.mean, 5)}  rms ${fmt(item.rms, 5)}`,
        `超调 ${fmt(item.overshoot_pct, 2)}%   上升时间 ${item.rise_time == null ? '—' : fmt(item.rise_time, 5) + ' s'}`,
        `调节时间(±${item.settle_band_pct}%) ${item.settling_time == null ? '—' : fmt(item.settling_time, 5) + ' s'}`,
        `来源：${item.source}`,
        `耗时 ${response.elapsed_ms ?? '?'} ms`,
      ].join('\n'),
    );
  }

export async function runAnalysisSpectrum() {
    const key = analysisSignalKey();
    if (!key) return toast('还没有录制数据：先运行一段时间', 'info', 2600);
    const response = await analysisGet('/api/analysis/spectrum', { key });
    if (!response) return;
    state.analysisSpectrum = response;
    const peaks = (response.peaks || []).map((p: { freq: number; magnitude: number }) => `${fmt(p.freq, 3)} Hz  |X|=${fmt(p.magnitude, 4)}`).join('\n');
    setAnalysisOutput([`FFT（${response.window} 窗，dt=${fmt(response.dt, 5)} s）`, peaks, `来源：${response.source}`].join('\n'));
    drawAnalysisSpectrum();
  }

export async function runAnalysisPeriod() {
    const key = analysisSignalKey();
    if (!key) return toast('还没有录制数据：先运行一段时间', 'info', 2600);
    const response = await analysisGet('/api/analysis/period', { key });
    if (!response) return;
    if (!response.ok) { setAnalysisOutput(`周期推荐：失败\n原因：${response.reason}\n诊断：${response.diagnosis}`); return; }
    const lines = [`周期推荐：T ≈ ${fmt(response.period, 5)} s（score ${fmt(response.score, 3)}，${fmt(response.cycles, 2)} 个周期）`];
    for (const item of response.candidates || []) lines.push(`  候选 ${fmt(item.period, 5)} s  score ${fmt(item.score, 3)}`);
    lines.push(`诊断：${response.diagnosis}`);
    lines.push(`来源：${response.source}`);
    setAnalysisOutput(lines.join('\n'));
  }

export async function runAnalysisMath() {
    const response = await analysisGet('/api/analysis/math');
    if (!response) return;
    const lines = (response.rows || []).map((row: { name: string; kind: string; formula?: string }) => `${row.name} (${row.kind})\n  ${row.formula || '（无公式）'}`);
    setAnalysisOutput([`数学形式（${(response.rows || []).length} 个节点）`, ...lines, `来源：${response.source}`].join('\n'));
  }

export async function runAnalysisTransfer() {
    if ((state.scene?.mode || state.mode) === 'circuit') {
      toast('电路场景请使用「小信号分析（旁路）」的 G(s) / 零极点 / 阶跃结果。', 'info', 4200);
      openAnalysis('bypass');
      return;
    }
    const input = ($('#analysisInputNode') as HTMLInputElement)?.value?.trim();
    const output = ($('#analysisOutputNode') as HTMLInputElement)?.value?.trim();
    if (!input || !output) return toast('填写输入/输出节点名', 'info', 2400);
    const out = $('#analysisTFOut');
    if (out) out.textContent = '分析中…';
    try {
      const response = await jsonRequest('/api/analysis/tf', 'POST', {
        input_node: input,
        output_node: output,
        points: 240,
      });
      if (!response.ok) {
        const reason = `传递函数：无法解析\n原因：${response.reason || '未知原因'}`;
        if (out) out.textContent = reason;
        setAnalysisOutput(reason);
        return;
      }
      state.analysisTF = response;
      const summary = analysisTFSummary(response);
      if (out) out.textContent = summary;
      setAnalysisOutput([`网络总传函（${input} → ${output}）`, summary].join('\n'));
      drawAnalysisTF();
    } catch (error) {
      const reason = `传递函数：失败\n原因：${(error as Error)?.message || error}`;
      if (out) out.textContent = reason;
      setAnalysisOutput(reason);
      state.analysisTF = null;
      drawAnalysisTF();
    }
  }

export function fmtComplex(value: ComplexLike | null | undefined) {
    const real = Number(value?.real ?? value?.re ?? 0);
    const imag = Number(value?.imag ?? value?.im ?? 0);
    if (!Number.isFinite(real) || !Number.isFinite(imag)) return '—';
    if (Math.abs(imag) < 1e-9) return fmt(real, 4);
    const sign = imag < 0 ? '−' : '+';
    return `${fmt(real, 4)} ${sign} ${fmt(Math.abs(imag), 4)}j`;
  }

export function analysisTFSummary(data: TfDataRec) {
    const step = (data.step || {}) as TfStepRec;
    const metrics = (step.metrics || {}) as TfMetricsRec;
    const stability =
      { stable: '稳定', marginal: '临界稳定', unstable: '不稳定' }[data.stability as 'stable' | 'marginal' | 'unstable'] || data.stability || '未知';
    const lines = [
      `G(s) = ${data.expression}`,
      `阶数 ${data.order}，相对阶 ${data.relative_order}`,
      `极点：${(data.poles || []).map(fmtComplex).join(', ') || '无'}`,
      `零点：${(data.zeros || []).map(fmtComplex).join(', ') || '无'}`,
      `DC 增益：${data.dc_gain_finite ? fmt(data.dc_gain, 5) : '∞（含积分环节）'}`,
      `稳定性：${stability}`,
    ];
    if (metrics.final !== null && metrics.final !== undefined) {
      lines.push(
        `阶跃：终值 ${fmt(metrics.final, 5)}，峰值 ${fmt(metrics.peak_value, 5)} @ ${fmt(metrics.peak_time, 3)} s，超调 ${fmt(metrics.overshoot_pct, 2)}%，上升 ${fmt(metrics.rise_time, 3)} s，调节 ${fmt(metrics.settling_time, 3)} s，稳态误差 ${fmt(metrics.steady_state_error, 4)}`,
      );
    } else if (step.stable === false) {
      lines.push('阶跃：系统不稳定，时域指标不适用');
    }
    for (const item of data.assumptions || []) lines.push(`假设：${item}`);
    return lines.join('\n');
  }

export async function runAnalysisTF() {
    const node = ($('#analysisTFNode') as HTMLInputElement)?.value?.trim() || '';
    const expr = ($('#analysisTFExpr') as HTMLInputElement)?.value?.trim() || '';
    if (!node && !expr) return toast('选择传递函数节点或输入 s 域表达式', 'info', 2400);
    const out = $('#analysisTFOut');
    if (out) out.textContent = '分析中…';
    try {
      const response = await jsonRequest('/api/analysis/tf', 'POST', {
        node: node || null,
        expr: node ? null : expr,
        points: 240,
      });
      state.analysisTF = response;
      if (out) out.textContent = analysisTFSummary(response);
      drawAnalysisTF();
    } catch (error) {
      state.analysisTF = null;
      const text = `传递函数分析：失败\n原因：${(error as Error)?.message || error}`;
      if (out) out.textContent = text;
      drawAnalysisTF();
    }
  }

export function drawAnalysisTF() {
    const canvas = $('#analysisTFChart');
    const data = state.analysisTF;
    if (!canvas || !data) return;
    attachTfCursor();
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 360;
    const height = canvas.clientHeight || 210;
    (canvas as HTMLCanvasElement).width = Math.round(width * dpr);
    (canvas as HTMLCanvasElement).height = Math.round(height * dpr);
    const ctx = (canvas as HTMLCanvasElement).getContext('2d');
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.clearRect(0, 0, width, height);
    const view = ($('#analysisTFView') as HTMLInputElement)?.value || 'bode';
    if (view === 'step') drawTFStep((ctx as CanvasRenderingContext2D), (data as TfDataRec), width, height);
    else if (view === 'poles') drawTFPoles((ctx as CanvasRenderingContext2D), (data as TfDataRec), width, height);
    else drawTFBode((ctx as CanvasRenderingContext2D), (data as TfDataRec), width, height);
  }

export function tfRange(values: number[]) {
    const finite = values.filter((value: number) => Number.isFinite(value));
    if (!finite.length) return [0, 1];
    let low = Math.min(...finite);
    let high = Math.max(...finite);
    if (high - low < 1e-9) {
      low -= 1;
      high += 1;
    }
    const pad = (high - low) * 0.1;
    return [low - pad, high + pad];
  }

export function drawTFBode(ctx: CanvasRenderingContext2D, data: TfDataRec, width: number, height: number) {
    const bode = (data.bode || {}) as TfBodeRec;
    const omega = (bode.omega || []).map(Number);
    const magnitude = (bode.magnitude_db || []).map(Number);
    const phase = (bode.phase_deg || []).map(Number);
    if (omega.length < 2 || !magnitude.some(Number.isFinite)) return;
    const left = 44;
    const right = 10;
    const top = 12;
    const bottom = 20;
    const gap = 16;
    const plotWidth = Math.max(24, width - left - right);
    const plotHeight = Math.max(28, (height - top - bottom - gap) / 2);
    const phaseTop = top + plotHeight + gap;
    const logMin = Math.log10(Math.max(omega[0], 1e-9));
    const logMax = Math.log10(Math.max(omega[omega.length - 1], 1e-8));
    const logSpan = Math.max(logMax - logMin, 1e-9);
    const xAt = (index: number) => left + plotWidth * ((Math.log10(Math.max(omega[index], 1e-9)) - logMin) / logSpan);
    const grid = analysisTokens().tfGrid;
    const axis = analysisTokens().tfAxis;
    ctx.font = '9px "Cascadia Code", Consolas, monospace';

    const panel = (base: number, values: number[], color: string, unit: string) => {
      const [rawLow, rawHigh] = tfRange(values);
      const ticks = niceAxisTicks(rawLow, rawHigh, 4);
      const low = ticks.min;
      const high = ticks.max;
      ctx.strokeStyle = grid;
      ctx.fillStyle = analysisC('#7b7266');
      ctx.textAlign = 'right';
      for (const value of ticks.values) {
        const y = base + plotHeight * (1 - (value - low) / Math.max(high - low, 1e-9));
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(left + plotWidth, y);
        ctx.stroke();
        ctx.fillText(niceAxisLabel(value), left - 4, y + 3);
      }
      ctx.textAlign = 'left';
      ctx.fillText(unit, 3, base + 8);
      ctx.strokeStyle = axis;
      ctx.beginPath();
      ctx.moveTo(left, base + plotHeight + 0.5);
      ctx.lineTo(left + plotWidth, base + plotHeight + 0.5);
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      let started = false;
      for (let index = 0; index < Math.min(omega.length, values.length); index += 1) {
        const value = values[index];
        if (!Number.isFinite(value)) {
          started = false;
          continue;
        }
        const x = xAt(index);
        const y = base + plotHeight * (1 - (value - low) / Math.max(high - low, 1e-9));
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    };

    panel(top, magnitude, analysisC('#a8541f'), 'dB');
    panel(phaseTop, phase, analysisC('#3f6f8f'), 'deg');

    ctx.strokeStyle = grid;
    ctx.fillStyle = analysisC('#7b7266');
    ctx.textAlign = 'center';
    let decades = 0;
    for (let exponent = Math.ceil(logMin); exponent <= Math.floor(logMax); exponent += 1) {
      const x = left + plotWidth * ((exponent - logMin) / logSpan);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, phaseTop + plotHeight);
      ctx.stroke();
      ctx.fillText(`10^${exponent}`, x, height - 5);
      decades += 1;
    }
    if (!decades) {
      ctx.textAlign = 'left';
      ctx.fillText(fmt(omega[0], 2), left, height - 5);
      ctx.textAlign = 'right';
      ctx.fillText(fmt(omega[omega.length - 1], 2), left + plotWidth, height - 5);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = analysisC('#7b7266');
    ctx.fillText('rad/s', left + plotWidth - 34, height - 5);

    const cursor = state.tfCursor;
    if (cursor != null && cursor >= 0 && cursor < omega.length) {
      const x = xAt(cursor);
      ctx.save();
      ctx.strokeStyle = analysisC('rgba(168, 84, 31, 0.55)');
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, phaseTop + plotHeight);
      ctx.stroke();
      ctx.setLineDash([]);
      const dot = (base: number, value: number) => {
        if (!Number.isFinite(value)) return;
        const [low, high] = tfRange(base === top ? magnitude : phase);
        const y = base + plotHeight * (1 - (value - low) / Math.max(high - low, 1e-9));
        ctx.fillStyle = analysisC('#a8541f');
        ctx.strokeStyle = analysisTokens().tfDotRing;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(x, y, 3.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      };
      dot(top, magnitude[cursor]);
      dot(phaseTop, phase[cursor]);
      const label = `ω=${fmt(omega[cursor], 3)}  |G|=${fmt(magnitude[cursor], 2)} dB  ∠=${fmt(phase[cursor], 1)}°`;
      ctx.font = '10px "Cascadia Code", Consolas, monospace';
      const labelWidth = ctx.measureText(label).width + 12;
      ctx.fillStyle = analysisTokens().tfCalloutBg;
      ctx.strokeStyle = analysisC('rgba(168, 84, 31, 0.35)');
      ctx.beginPath();
      ctx.roundRect(left + 4, top + 3, Math.min(labelWidth, plotWidth - 8), 30, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = analysisC('#5f3a20');
      ctx.textAlign = 'left';
      ctx.fillText(label, left + 10, top + 15);
      ctx.font = '8px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = analysisC('#8a7b68');
      ctx.fillText('拖动读数 · ← → 吸附采样点（Shift ×10）', left + 10, top + 27);
      ctx.restore();
    }
  }

export function tfBodeCursorFromEvent(event: MouseEvent, clamp = false): number | null {
    const data = state.analysisTF as TfDataRec | null;
    const canvas = $('#analysisTFChart') as HTMLCanvasElement | null;
    const bode = data?.bode;
    if (!canvas || !bode?.omega?.length) return null;
    const rect = canvas.getBoundingClientRect();
    const left = 44;
    const right = 10;
    const width = rect.width;
    const plotWidth = Math.max(24, width - left - right);
    let x = event.clientX - rect.left;
    if (clamp) {
      x = Math.max(left, Math.min(left + plotWidth, x));
    } else if (x < left || x > left + plotWidth) {
      return null;
    }
    const omega = bode.omega.map(Number);
    const logMin = Math.log10(Math.max(omega[0], 1e-9));
    const logMax = Math.log10(Math.max(omega[omega.length - 1], 1e-8));
    const target = logMin + ((x - left) / plotWidth) * Math.max(logMax - logMin, 1e-9);
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < omega.length; index += 1) {
      const distance = Math.abs(Math.log10(Math.max(omega[index], 1e-9)) - target);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    return best;
  }

export function attachTfCursor() {
    const canvas = $('#analysisTFChart') as HTMLCanvasElement | null;
    if (!canvas || canvas.dataset.tfCursor === '1') return;
    canvas.dataset.tfCursor = '1';
    canvas.tabIndex = 0;
    canvas.style.cursor = 'crosshair';
    const active = () =>
      (($('#analysisTFView') as HTMLInputElement)?.value || 'bode') === 'bode';
    const move = (event: MouseEvent, clamp = false) => {
      if (!active()) return;
      const index = tfBodeCursorFromEvent(event, clamp);
      if (index == null) return;
      state.tfCursor = index;
      drawAnalysisTF();
    };
    canvas.addEventListener('mousemove', (event) => {
      move(event, state.tfDragging);
    });
    canvas.addEventListener('mousedown', (event) => {
      if (!active()) return;
      state.tfDragging = true;
      canvas.style.cursor = 'grabbing';
      move(event, true);
      event.preventDefault();
    });
    window.addEventListener('mouseup', () => {
      if (!state.tfDragging) return;
      state.tfDragging = false;
      canvas.style.cursor = 'crosshair';
    });
    canvas.addEventListener('mouseleave', () => {
      if (state.tfDragging || state.tfCursor == null) return;
      state.tfCursor = null;
      drawAnalysisTF();
    });
    canvas.addEventListener('keydown', (event) => {
      if (!active() || state.tfCursor == null) return;
      const omegaLength = (state.analysisTF as TfDataRec | null)?.bode?.omega?.length || 0;
      if (!omegaLength) return;
      const step = event.shiftKey ? 10 : 1;
      if (event.key === 'ArrowLeft') {
        state.tfCursor = Math.max(0, state.tfCursor - step);
      } else if (event.key === 'ArrowRight') {
        state.tfCursor = Math.min(omegaLength - 1, state.tfCursor + step);
      } else {
        return;
      }
      event.preventDefault();
      drawAnalysisTF();
    });
  }

export function drawTFStep(ctx: CanvasRenderingContext2D, data: TfDataRec, width: number, height: number) {
    const step = (data.step || {}) as TfStepRec;
    const time = (step.t || []).map(Number);
    const values = (step.y || []).map(Number);
    if (time.length < 2 || !values.some(Number.isFinite)) return;
    const left = 46;
    const right = 10;
    const top = 12;
    const bottom = 20;
    const plotWidth = Math.max(24, width - left - right);
    const plotHeight = Math.max(24, height - top - bottom);
    const [rawLow, rawHigh] = tfRange(values);
    const ticks = niceAxisTicks(rawLow, rawHigh, 4);
    const low = ticks.min;
    const high = ticks.max;
    const xAt = (index: number) => left + plotWidth * ((time[index] - time[0]) / Math.max(time[time.length - 1] - time[0], 1e-9));
    const yAt = (value: number) => top + plotHeight * (1 - (value - low) / Math.max(high - low, 1e-9));
    const grid = analysisTokens().tfGrid;
    const axis = analysisTokens().tfAxis;
    ctx.font = '9px "Cascadia Code", Consolas, monospace';
    ctx.strokeStyle = grid;
    ctx.fillStyle = analysisC('#7b7266');
    ctx.textAlign = 'right';
    for (const value of ticks.values) {
      const y = yAt(value);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + plotWidth, y);
      ctx.stroke();
      ctx.fillText(niceAxisLabel(value), left - 4, y + 3);
    }
    ctx.strokeStyle = axis;
    ctx.beginPath();
    ctx.moveTo(left, top + plotHeight + 0.5);
    ctx.lineTo(left + plotWidth, top + plotHeight + 0.5);
    ctx.stroke();
    const metrics = (step.metrics || {}) as TfMetricsRec;
    if (Number.isFinite(metrics.final)) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = analysisTokens().tfGhostLine;
      ctx.beginPath();
      ctx.moveTo(left, yAt((metrics.final as number)));
      ctx.lineTo(left + plotWidth, yAt((metrics.final as number)));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = analysisC('#a8541f');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (let index = 0; index < Math.min(time.length, values.length); index += 1) {
      const value = values[index];
      if (!Number.isFinite(value)) {
        started = false;
        continue;
      }
      const x = xAt(index);
      const y = yAt(value);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    if (Number.isFinite(metrics.peak_value) && Number.isFinite(metrics.peak_time)) {
      let peakIndex = 0;
      let best = Infinity;
      for (let index = 0; index < Math.min(time.length, values.length); index += 1) {
        if (!Number.isFinite(time[index])) continue;
        const distance = Math.abs(time[index] - metrics.peak_time!);
        if (distance < best) { best = distance; peakIndex = index; }
      }
      const px = xAt(peakIndex);
      const py = yAt((metrics.peak_value as number));
      ctx.fillStyle = analysisC('#8a4b12');
      ctx.beginPath();
      ctx.arc(px, py, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = px > left + plotWidth * 0.66 ? 'right' : 'left';
      ctx.fillText(
        `峰值 ${fmt(metrics.peak_value, 3)} @ ${fmt(metrics.peak_time, 3)} s`,
        px + (ctx.textAlign === 'right' ? -5 : 5),
        Math.max(top + 9, py - 6),
      );
    }
    ctx.fillStyle = analysisC('#7b7266');
    ctx.textAlign = 'left';
    ctx.fillText('0 s', left, height - 5);
    ctx.textAlign = 'right';
    ctx.fillText(`${fmt(time[time.length - 1], 3)} s`, left + plotWidth, height - 5);
  }

export function drawTFPoles(ctx: CanvasRenderingContext2D, data: TfDataRec, width: number, height: number) {
    const poles = data.poles || [];
    const zeros = data.zeros || [];
    const left = 18;
    const right = 10;
    const top = 12;
    const bottom = 18;
    const plotWidth = Math.max(24, width - left - right);
    const plotHeight = Math.max(24, height - top - bottom);
    const all = [...poles, ...zeros];
    let extent = 1;
    for (const point of all) {
      extent = Math.max(extent, Math.abs(Number(point.real) || 0), Math.abs(Number(point.imag) || 0));
    }
    extent *= 1.15;
    const cx = left + plotWidth / 2;
    const cy = top + plotHeight / 2;
    const scale = Math.min(plotWidth / (2 * extent), plotHeight / (2 * extent));
    const xAt = (real: number) => cx + real * scale;
    const yAt = (imag: number) => cy - imag * scale;
    ctx.fillStyle = analysisTokens().tfLeftTint;
    ctx.fillRect(left, top, plotWidth / 2, plotHeight);
    const grid = analysisTokens().tfGrid;
    const axis = analysisTokens().tfAxisStrong;
    ctx.strokeStyle = grid;
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx, top + plotHeight);
    ctx.moveTo(left, cy);
    ctx.lineTo(left + plotWidth, cy);
    ctx.stroke();
    ctx.strokeStyle = axis;
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx, top + plotHeight);
    ctx.moveTo(left, cy);
    ctx.lineTo(left + plotWidth, cy);
    ctx.stroke();
    ctx.font = '9px "Cascadia Code", Consolas, monospace';
    ctx.fillStyle = analysisC('#7b7266');
    ctx.textAlign = 'center';
    ctx.fillText('Re', left + plotWidth - 10, cy - 4);
    ctx.textAlign = 'left';
    ctx.fillText('Im', cx + 4, top + 8);
    for (const point of zeros) {
      const x = xAt(Number(point.real) || 0);
      const y = yAt(Number(point.imag) || 0);
      ctx.strokeStyle = analysisC('#3f6f8f');
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const point of poles) {
      const x = xAt(Number(point.real) || 0);
      const y = yAt(Number(point.imag) || 0);
      ctx.strokeStyle = analysisC('#a8541f');
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 4);
      ctx.lineTo(x + 4, y + 4);
      ctx.moveTo(x + 4, y - 4);
      ctx.lineTo(x - 4, y + 4);
      ctx.stroke();
    }
    ctx.fillStyle = analysisC('#7b7266');
    ctx.textAlign = 'left';
    ctx.fillText('× 极点   ○ 零点', left + 2, top + 9);
  }

export function exportTFStateSpace() {
    const space = (state.analysisTF as TfDataRec | null)?.state_space;
    if (!space) {
      toast('当前传递函数没有 A/B/C/D（静态增益或 z 域结果）', 'info', 3200);
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadText(JSON.stringify({ version: 1, state_space: space }, null, 2), `netlab-state-space-${stamp}.json`);
    toast(`已导出 ${space.order} 阶 A/B/C/D`, 'ok', 2600);
  }

export async function sendCurveToPlotKit(name: string, x: number[], y: number[], xLabel: string, yLabel: string) {
    if (!Array.isArray(x) || !Array.isArray(y) || x.length < 2 || x.length !== y.length) {
      toast('这条曲线为空，无法发送到 PlotKit', 'info', 2800);
      return null;
    }
    try {
      const response = await jsonRequest('/api/plotkit/analysis', 'POST', {
        name, x, y, x_label: xLabel, y_label: yLabel,
      });
      if (!response?.ok) {
        toast(`PlotKit 接收失败：${response?.reason || '未挂载'}`, 'error', 4200);
        return null;
      }
      toast(`已发送「${response.label}」到 PlotKit（${response.points} 点）`, 'ok', 3200);
      return response;
    } catch (error) {
      toast(`PlotKit 接收失败：${(error as Error).message}`, 'error', 4200);
      return null;
    }
  }

export async function sendTFToPlotKit() {
    const step = (state.analysisTF as TfDataRec | null)?.step;
    if (!step?.t || !step?.y) {
      toast('先推导一条传递函数阶跃响应', 'info', 3000);
      return;
    }
    await sendCurveToPlotKit('TF 阶跃响应', ((step.t)), step.y, 't / s', '幅值');
  }

export function phaseSeriesForPlotKit() {
    const node = nodeByName(state.phaseNode);
    if (!node) return null;
    const frames = state.frames || [];
    const pairs = [];
    const stateKeys = analysisPhaseStateKeys(node);
    if (stateKeys.length >= 2) pairs.push([stateKeys[0], stateKeys[1]]);
    pairs.push(
      [`n:${node.name}:x`, `n:${node.name}:y`],
      [`n:${node.name}:vx`, `n:${node.name}:vy`],
      [`n:${node.name}:x1`, `n:${node.name}:x2`],
    );
    for (const [keyX, keyY] of pairs) {
      const points = frames.filter(
        (frame) => typeof frame.v?.[keyX] === 'number' && typeof frame.v?.[keyY] === 'number',
      );
      if (points.length >= 2) {
        return {
          name: `相图 ${node.name}`,
          x: points.map((frame) => frame.v[keyX]),
          y: points.map((frame) => frame.v[keyY]),
          xLabel: keyX.split(':').pop(),
          yLabel: keyY.split(':').pop(),
        };
      }
    }
    return null;
  }

export async function sendPhaseToPlotKit() {
    const series = phaseSeriesForPlotKit();
    if (!series) {
      toast('当前相图没有可发送的轨迹', 'info', 3000);
      return;
    }
    await sendCurveToPlotKit(series.name as string, ((series.x)) as number[], series.y as number[], series.xLabel as string, series.yLabel as string);
  }

export async function exportAnalysisCsv(keys: string[] | null = null, defaultName = 'analysis') {
    const name = window.prompt('CSV 文件名（写入 exports/，同名自动加序号）', defaultName);
    if (name === null) return;
    const key = analysisSignalKey();
    const wanted = Array.isArray(keys) && keys.length ? keys : (key ? [key] : null);
    const response = await task(() =>
      jsonRequest('/api/analysis/export', 'POST', { name: name || defaultName, keys: wanted, decimate: 1 }),
    );
    if (!response) return;
    setAnalysisOutput(`已导出 ${response.rows} 行 → ${response.path}\n列：${(response.columns || []).join(', ')}`);
    toast(`CSV 已写入 ${response.path}`, 'ok', 3400);
  }

export function drawAnalysisSpectrum() {
    const canvas = $('#analysisChart');
    const data = state.analysisSpectrum as SpectrumRec | null;
    if (!canvas || !data) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 150;
    (canvas as HTMLCanvasElement).width = Math.round(width * dpr);
    (canvas as HTMLCanvasElement).height = Math.round(height * dpr);
    const ctx = (canvas as HTMLCanvasElement).getContext('2d');
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.clearRect(0, 0, width, height);
    const mags = data.magnitude || [];
    const freqs = data.freqs || [];
    if (!mags.length) return;
    const peak = Math.max(...mags.filter((v: number) => Number.isFinite(v)), 1e-12);
    const n = Math.min(mags.length, 400);
    const bw = width / n;
    for (let index = 0; index < n; index += 1) {
      const value = mags[index] / peak;
      const barH = Math.max(0, Math.min(1, value)) * (height - 18);
      ctx!.fillStyle = index === 0 ? analysisTokens().nyqLabel : analysisC('rgba(168, 84, 31, 0.55)');
      ctx!.fillRect(index * bw, height - 14 - barH, Math.max(1, bw - 0.5), barH);
    }
    ctx!.strokeStyle = analysisTokens().tfAxisSoft;
    ctx!.beginPath();
    ctx!.moveTo(0, height - 14.5);
    ctx!.lineTo(width, height - 14.5);
    ctx!.stroke();
    ctx!.fillStyle = analysisC('#7b7266');
    ctx!.font = '9px "Cascadia Code", Consolas, monospace';
    ctx!.fillText('0 Hz', 2, height - 3);
    const maxFreq = freqs.length ? freqs[Math.min(freqs.length - 1, 399)] : 0;
    ctx!.fillText(`${fmt(maxFreq, 1)} Hz`, width - 44, height - 3);
  }
