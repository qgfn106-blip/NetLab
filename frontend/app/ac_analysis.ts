// 交流分析面板（S5-36 从 app.ts 迁出）
import { PALETTE } from './constants.js';
import { api } from './net.js';
import { $, $$, canvas, ctx } from './dom.js';
import { chartPalette } from './theme.js';
import { div } from './ui.js';
import { raiseFloatWindow } from './float.js';
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

export function analysisWarn() {
    // 用户要求：开始分析前弹提醒，但不阻止
    toast('分析会基于当前场景重新求解，期间实时播放会暂停；可随时关闭分析窗。', 'warn', 4200);
  }

export function openAnalysis(tab = 'op') {
    const win = $('#analWin');
    if (!win) return;
    if ((state.scene?.mode || state.mode) !== 'circuit') {
      toast('DC 工作点 / AC 扫频只在电路模式下可用', 'error', 4000);
      return;
    }
    win.hidden = false;
    raiseFloatWindow(win);
    fillAcSources();
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
    probes.forEach(([name, info], index: number) => {
      const chartMode = String((state.prefs && state.prefs.chartPalette) || 'theme');
      const series = chartMode === 'theme' ? PALETTE : chartPalette();
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
