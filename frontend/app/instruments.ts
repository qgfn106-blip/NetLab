// 仪器面板与示波/李萨如渲染（S5-27 从 app.ts 迁出）
import { clamp, fmt } from '../app.utils.js';
import { C } from './colors.js';
import { INST_COLORS } from './constants.js';
import { canvas, lissCanvas, lissCtx, scopeCanvas, scopeCtx } from './dom.js';
import { activeTab } from './model.js';
import { state, ui } from './state.js';
import { div } from './ui.js';
import type { FieldKey, FrameItem, SizeRec } from './types.js';

type InstrumentActions = { scheduleChartDraw: () => void };
const instrumentActions = {} as InstrumentActions;
export function setInstrumentActions(actions: InstrumentActions): void {
  Object.assign(instrumentActions, actions);
}
function instrumentScheduleChartDraw() { instrumentActions.scheduleChartDraw(); }

  function instrumentPrefsKey() {
    return 'netlab.instrument';
  }

export function loadInstrumentPrefs() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(instrumentPrefsKey()) || 'null');
    } catch {
      data = null;
    }
    if (!data || typeof data !== 'object') return;
    if (typeof data.meterKey === 'string') state.instrument.meterKey = data.meterKey;
    if (Array.isArray(data.channels)) {
      state.instrument.channels = [0, 1, 2, 3].map((i: number) => (
        typeof data.channels[i] === 'string' ? data.channels[i] : null
      ));
    }
    if (typeof data.lx === 'string') state.instrument.lx = data.lx;
    if (typeof data.ly === 'string') state.instrument.ly = data.ly;
    if (Number.isFinite(data.trail)) state.instrument.trail = clamp(Math.round(data.trail), 20, 4000);
    if (Number.isFinite(data.window)) state.instrument.window = clamp(data.window, 0.1, 120);
  }

export function saveInstrumentPrefs() {
    try {
      localStorage.setItem(instrumentPrefsKey(), JSON.stringify({
        meterKey: state.instrument.meterKey,
        channels: state.instrument.channels,
        lx: state.instrument.lx,
        ly: state.instrument.ly,
        trail: state.instrument.trail,
        window: state.instrument.window,
      }));
    } catch {
      /* 存储不可用时静默降级：仪表仍可用，只是不记忆选择 */
    }
  }

  function instrumentFieldLabel(field: FieldKey) {
    const map = { voltage: '电压', current: '电流', power: '功率', voltage_difference: '压差' };
    return map[field as keyof typeof map] || field || '值';
  }

  function instrumentKeyLabel(key: string) {
    const parts = String(key || '').split(':');
    const field = parts.length > 1 ? parts[parts.length - 1] : '';
    const name = parts.length > 2 ? parts.slice(1, -1).join(':') : (parts[1] || key);
    return `${name} · ${instrumentFieldLabel(field)}`;
  }

export function instrumentSelectGroups() {
    const groups = new Map();
    for (const key of state.probeKeys) {
      const parts = String(key).split(':');
      const field = parts.length > 1 ? parts[parts.length - 1] : '';
      const name = parts.length > 2 ? parts.slice(1, -1).join(':') : (parts[1] || key);
      const kind = parts[0] === 'e' ? '元件' : '节点';
      const label = `${kind}${instrumentFieldLabel(field)}`;
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push({ key, text: `${name} · ${instrumentFieldLabel(field)}` });
    }
    const order = ['节点电压', '元件电流', '元件压差', '元件电压', '元件功率'];
    return [...groups.entries()].sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0]);
    });
  }

  function fillInstrumentSelect(select: HTMLInputElement | HTMLSelectElement, current: string | null, placeholder: string) {
    if (!select) return '';
    select.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = placeholder;
    select.appendChild(none);
    for (const [label, items] of instrumentSelectGroups()) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = label;
      for (const item of items) {
        const option = document.createElement('option');
        option.value = item.key;
        option.textContent = item.text;
        optgroup.appendChild(option);
      }
      select.appendChild(optgroup);
    }
    const wanted = current && state.probeKeys.includes(current) ? current : '';
    select.value = wanted;
    return select.value;
  }

export function fillInstrumentSelects() {
    if (!ui.instPane) return;
    const firstRun = !state.instrument.meterKey
      && !state.instrument.lx && !state.instrument.ly
      && state.instrument.channels.every((key: string | null) => !key);
    state.instrument.meterKey = fillInstrumentSelect(((ui.instMeterKey)), state.instrument.meterKey, '选择电压 / 电流信号');
    state.instrument.channels = [0, 1, 2, 3].map((i: number) => (
      fillInstrumentSelect(((ui.instCh[i])), state.instrument.channels[i], `CH${i + 1} 未接`) || null
    ));
    state.instrument.lx = fillInstrumentSelect(((ui.instLX)), state.instrument.lx, 'X 未接');
    state.instrument.ly = fillInstrumentSelect(((ui.instLY)), state.instrument.ly, 'Y 未接');
    if (firstRun && state.probeKeys.length) {
      // 首次打开仪器页时自动接上「第一个电压 + 第一个电流」，避免空白页
      const volts = state.probeKeys.filter((key: string) => key.endsWith(':voltage'));
      const currents = state.probeKeys.filter((key: string) => key.endsWith(':current'));
      const ch1 = volts[0] || state.probeKeys[0];
      const ch2 = currents[0] || state.probeKeys[1] || '';
      state.instrument.meterKey = ch1;
      state.instrument.channels = [ch1, ch2 || null, null, null];
      state.instrument.lx = ch1;
      state.instrument.ly = ch2;
      if (ui.instMeterKey) ui.instMeterKey.value = ch1;
      if (ui.instCh[0]) ui.instCh[0].value = ch1;
      if (ui.instCh[1]) ui.instCh[1].value = ch2;
      if (ui.instLX) ui.instLX.value = ch1;
      if (ui.instLY) ui.instLY.value = ch2;
    }
    state.instrument.channels.forEach((key: string | null, i: number) => {
      const dot = ui.instCh[i]?.closest('.inst-ch')?.querySelector('.dot');
      if (!dot) return;
      dot.classList.toggle('on', Boolean(key));
      (dot as HTMLElement).style.color = key ? INST_COLORS[i] : '';
    });
    if (ui.instWindow) ui.instWindow.value = String(state.instrument.window);
    if (ui.instTrail) ui.instTrail.value = String(state.instrument.trail);
    saveInstrumentPrefs();
    instrumentScheduleChartDraw();
  }

export function instrumentFrames() {
    const all = state.replay.active ? state.frames.slice(0, state.replay.index + 1) : state.frames;
    const window = Math.max(0.1, Number(state.instrument.window) || 5);
    if (!all.length) return { frames: [], window };
    const last = all[all.length - 1].t;
    const start = last - window;
    let from = all.length - 1;
    while (from > 0 && all[from - 1].t >= start) from -= 1;
    return { frames: all.slice(from), window };
  }

  function instrumentStats(frames: FrameItem[], key: string) {
    let count = 0;
    let sum = 0;
    let square = 0;
    let min = Infinity;
    let max = -Infinity;
    let last = 0;
    for (const frame of frames) {
      const value = frame.v?.[key as string];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      count += 1;
      sum += value;
      square += value * value;
      last = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (!count) return null;
    return { count, last, mean: sum / count, rms: Math.sqrt(square / count), min, max, pp: max - min };
  }

export function instrumentSurface(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, size: SizeRec, fill: string) {
    if (!context || !canvas) return null;
    const { w, h, dpr } = size;
    if (w < 20 || h < 20) return null;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, w, h);
    context.fillStyle = C(fill);
    context.fillRect(0, 0, w, h);
    return { w, h };
  }

  function instrumentHint(context: CanvasRenderingContext2D, w: number, h: number, text: string) {
    context.fillStyle = C('#969083');
    context.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, w / 2, h / 2);
  }

export function renderInstrumentMeter(frames: FrameItem[]) {
    const key = state.instrument.meterKey;
    const stats = key ? instrumentStats(frames, key) : null;
    const put = (element: HTMLElement, text: string) => {
      if (element) element.textContent = text;
    };
    if (!stats) {
      put(ui.instValNow, '—');
      put(ui.instValMean, '—');
      put(ui.instValRms, '—');
      put(ui.instValPP, '—');
      put(ui.instValMinMax, '—');
      return;
    }
    put(ui.instValNow, fmt(stats.last, 4));
    put(ui.instValMean, fmt(stats.mean, 4));
    put(ui.instValRms, fmt(stats.rms, 4));
    put(ui.instValPP, fmt(stats.pp, 4));
    put(ui.instValMinMax, `${fmt(stats.max, 3)} / ${fmt(stats.min, 3)}`);
  }

  function renderInstrumentLegend(frames: FrameItem[]) {
    if (!ui.instLegend) return;
    ui.instLegend.innerHTML = '';
    state.instrument.channels.forEach((key: string | null, index: number) => {
      if (!key) return;
      const stats = instrumentStats(frames, key);
      const item = document.createElement('div');
      item.className = 'legend-item';
      const dot = document.createElement('i');
      dot.className = 'legend-dot';
      dot.style.background = INST_COLORS[index];
      const name = document.createElement('span');
      name.className = 'legend-name';
      name.textContent = `CH${index + 1} ${instrumentKeyLabel(key)}`;
      const value = document.createElement('em');
      value.className = 'legend-value';
      value.textContent = stats ? fmt(stats.last, 4) : '—';
      item.append(dot, name, value);
      ui.instLegend.appendChild(item);
    });
  }

export function drawScope(frames: FrameItem[], window: number) {
    const surface = instrumentSurface((scopeCtx as CanvasRenderingContext2D), scopeCanvas, state.instrument.scopeSize, '#faf8f2');
    if (!surface) return;
    const { w, h } = surface;
    const left = 46;
    const right = 12;
    const top = 12;
    const bottom = 20;
    const plotW = Math.max(10, w - left - right);
    const plotH = Math.max(10, h - top - bottom);
    scopeCtx!.strokeStyle = C('#e7e2d7');
    scopeCtx!.lineWidth = 1;
    scopeCtx!.beginPath();
    for (let i = 0; i <= 4; i += 1) {
      const y = top + (plotH * i) / 4 + 0.5;
      scopeCtx!.moveTo(left, y);
      scopeCtx!.lineTo(left + plotW, y);
    }
    for (let i = 0; i <= 4; i += 1) {
      const x = left + (plotW * i) / 4 + 0.5;
      scopeCtx!.moveTo(x, top);
      scopeCtx!.lineTo(x, top + plotH);
    }
    scopeCtx!.stroke();

    const channels = state.instrument.channels
      .map((key: string | null, index: number) => ({ key, index }))
      .filter((entry) => entry.key && state.probeKeys.includes(entry.key));
    if (!frames.length || !channels.length) {
      instrumentHint(
        (scopeCtx as CanvasRenderingContext2D), w, h,
        channels.length ? '运行仿真后显示波形' : '给 CH1–CH4 接上信号',
      );
      renderInstrumentLegend([]);
      return;
    }

    const last = frames[frames.length - 1].t;
    const start = Math.max(frames[0].t, last - Math.max(0.1, window));
    const span = Math.max(1e-9, last - start);
    let amp = 0;
    for (const { key } of channels) {
      for (const frame of frames) {
        const value = frame.v?.[key as string];
        if (Number.isFinite(value)) amp = Math.max(amp, Math.abs(value));
      }
    }
    amp = amp > 0 ? amp * 1.1 : 1;
    const xOf = (t: number) => left + plotW * ((t - start) / span);
    const yOf = (v: number) => top + plotH / 2 - (v / amp) * (plotH / 2);

    scopeCtx!.strokeStyle = C('#c9c2b4');
    scopeCtx!.beginPath();
    scopeCtx!.moveTo(left, top + plotH / 2 + 0.5);
    scopeCtx!.lineTo(left + plotW, top + plotH / 2 + 0.5);
    scopeCtx!.stroke();

    for (const { key, index } of channels) {
      scopeCtx!.strokeStyle = INST_COLORS[index];
      scopeCtx!.lineWidth = 1.5;
      scopeCtx!.beginPath();
      let started = false;
      for (const frame of frames) {
        const value = frame.v?.[key as string];
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        const x = xOf(frame.t);
        const y = yOf(value);
        if (!started) {
          scopeCtx!.moveTo(x, y);
          started = true;
        } else {
          scopeCtx!.lineTo(x, y);
        }
      }
      scopeCtx!.stroke();
    }

    scopeCtx!.fillStyle = C('#969083');
    scopeCtx!.font = '9px "Segoe UI", "Microsoft YaHei", sans-serif';
    scopeCtx!.textAlign = 'right';
    scopeCtx!.textBaseline = 'middle';
    scopeCtx!.fillText(fmt(amp, 2), left - 5, top + 6);
    scopeCtx!.fillText('0', left - 5, top + plotH / 2);
    scopeCtx!.fillText(fmt(-amp, 2), left - 5, top + plotH - 6);
    scopeCtx!.textBaseline = 'top';
    scopeCtx!.textAlign = 'left';
    scopeCtx!.fillText(`${fmt(start, 3)} s`, left, top + plotH + 4);
    scopeCtx!.textAlign = 'right';
    scopeCtx!.fillText(`${fmt(last, 3)} s`, left + plotW, top + plotH + 4);
    renderInstrumentLegend(frames);
  }

export function drawLissajous(frames: FrameItem[]) {
    const surface = instrumentSurface((lissCtx as CanvasRenderingContext2D), lissCanvas, state.instrument.lissSize, '#faf8f2');
    if (!surface) return;
    const { w, h } = surface;
    const pad = 14;
    lissCtx!.strokeStyle = C('#e7e2d7');
    lissCtx!.lineWidth = 1;
    lissCtx!.beginPath();
    lissCtx!.moveTo(w / 2 + 0.5, pad);
    lissCtx!.lineTo(w / 2 + 0.5, h - pad);
    lissCtx!.moveTo(pad, h / 2 + 0.5);
    lissCtx!.lineTo(w - pad, h / 2 + 0.5);
    lissCtx!.stroke();

    const xKey = state.instrument.lx;
    const yKey = state.instrument.ly;
    const ready = Boolean(xKey && yKey && state.probeKeys.includes(xKey) && state.probeKeys.includes(yKey));
    if (!ready || !frames.length) {
      instrumentHint((lissCtx as CanvasRenderingContext2D), w, h, ready ? '运行仿真后显示李萨如图' : '选择 X / Y 两路信号');
      return;
    }
    const trail = clamp(Math.round(Number(state.instrument.trail) || 600), 20, 4000);
    const slice = frames.slice(-trail);
    let amp = 0;
    for (const frame of slice) {
      const x = frame.v?.[xKey];
      const y = frame.v?.[yKey];
      if (Number.isFinite(x)) amp = Math.max(amp, Math.abs(x));
      if (Number.isFinite(y)) amp = Math.max(amp, Math.abs(y));
    }
    amp = amp > 0 ? amp * 1.1 : 1;
    const size = Math.max(10, Math.min(w, h) - pad * 2);
    const xOf = (v: number) => w / 2 + (v / amp) * (size / 2);
    const yOf = (v: number) => h / 2 - (v / amp) * (size / 2);

    lissCtx!.strokeStyle = C('#c2542f');
    lissCtx!.lineWidth = 1.2;
    lissCtx!.beginPath();
    let started = false;
    let tail = null;
    for (const frame of slice) {
      const x = frame.v?.[xKey];
      const y = frame.v?.[yKey];
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const px = xOf(x);
      const py = yOf(y);
      if (!started) {
        lissCtx!.moveTo(px, py);
        started = true;
      } else {
        lissCtx!.lineTo(px, py);
      }
      tail = { x: px, y: py };
    }
    lissCtx!.stroke();
    if (tail) {
      lissCtx!.fillStyle = C('#c2542f');
      lissCtx!.beginPath();
      lissCtx!.arc(tail.x, tail.y, 2.5, 0, Math.PI * 2);
      lissCtx!.fill();
    }
    lissCtx!.fillStyle = C('#969083');
    lissCtx!.font = '9px "Segoe UI", "Microsoft YaHei", sans-serif';
    lissCtx!.textAlign = 'left';
    lissCtx!.textBaseline = 'top';
    lissCtx!.fillText(`X ${xKey.split(':').slice(1, -1).join(':')}`, pad, pad - 10 + 0.5);
    lissCtx!.textBaseline = 'bottom';
    lissCtx!.fillText(`Y ${yKey.split(':').slice(1, -1).join(':')}`, pad, h - 1);
  }

export function drawInstruments() {
    if (activeTab() !== 'inst') return;
    const { frames, window } = instrumentFrames();
    renderInstrumentMeter(frames);
    drawScope(frames, window);
    drawLissajous(frames);
    if (ui.instStatus) {
      if (frames.length) {
        ui.instStatus.textContent = `${frames.length} 帧 · 窗口 ${fmt(window, 2)} s${state.replay.active ? ' · 回放中' : ''}`;
      } else {
        ui.instStatus.textContent = state.sim?.running ? '等待采集中…' : '运行仿真后显示读数与波形';
      }
    }
  }

export function resizeInstrument() {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    for (const [target, key] of [[scopeCanvas, 'scopeSize'], [lissCanvas, 'lissSize']]) {
      if (!target) continue;
      const wrap = (target as HTMLCanvasElement).parentElement;
      if (!wrap) continue;
      const rect = wrap.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      state.instrument[key as string] = { w, h, dpr };
      (target as HTMLCanvasElement).width = Math.max(1, Math.round(w * dpr));
      (target as HTMLCanvasElement).height = Math.max(1, Math.round(h * dpr));
    }
    instrumentScheduleChartDraw();
  }

export function bindInstrumentEvents() {
    const bind = (element: HTMLElement, event: string, handler: (event: MouseEvent) => void) => {
      if (element) element.addEventListener(event, handler as EventListener);
    };
    bind(ui.instMeterKey, (('change')), () => {
      state.instrument.meterKey = ui.instMeterKey.value || '';
      saveInstrumentPrefs();
      instrumentScheduleChartDraw();
    });
    ui.instCh.forEach((select, index: number) => {
      bind(select, (('change')), () => {
        state.instrument.channels[index] = select.value || null;
        const dot = select.closest('.inst-ch')?.querySelector('.dot');
        if (dot) {
          dot.classList.toggle('on', Boolean(select.value));
          (dot as HTMLElement).style.color = select.value ? INST_COLORS[index] : '';
        }
        saveInstrumentPrefs();
        instrumentScheduleChartDraw();
      });
    });
    bind(ui.instLX, (('change')), () => {
      state.instrument.lx = ui.instLX.value || '';
      saveInstrumentPrefs();
      instrumentScheduleChartDraw();
    });
    bind(ui.instLY, (('change')), () => {
      state.instrument.ly = ui.instLY.value || '';
      saveInstrumentPrefs();
      instrumentScheduleChartDraw();
    });
    bind(ui.instWindow, (('input')), () => {
      state.instrument.window = clamp(Number(ui.instWindow.value) || 5, 0.1, 120);
      saveInstrumentPrefs();
      instrumentScheduleChartDraw();
    });
    bind(ui.instTrail, (('input')), () => {
      state.instrument.trail = clamp(Math.round(Number(ui.instTrail.value) || 600), 20, 4000);
      saveInstrumentPrefs();
      instrumentScheduleChartDraw();
    });
  }

export function initInstruments() {
    loadInstrumentPrefs();
    resizeInstrument();
    bindInstrumentEvents();
    fillInstrumentSelects();
  }
