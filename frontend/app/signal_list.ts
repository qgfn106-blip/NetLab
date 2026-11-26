// P1-02 第四片：信号列表与图例视图，从 app.ts 抽出（行为等价）。
import { fmt } from '../app.utils.js';
import { CHART_KEYS } from './constants.js';
import { $$ } from './dom.js';
import { state, ui } from './state.js';
import { el, div } from './ui.js';
import { toast } from './desktop.js';

export interface SignalListDeps {
  colorForKey(key: string): string;
  scheduleChartDraw(): void;
}

let deps: SignalListDeps;

export function initSignalList(d: SignalListDeps) {
  deps = d;
}

export function decodeProbeKey(key: string) {
    const displayKey = state.probeLabels[key] || key;
    if (key.startsWith('n:') || displayKey.startsWith('n:')) {
      const rest = displayKey.startsWith('n:') ? displayKey.slice(2) : displayKey;
      const cut = rest.lastIndexOf(':');
      return {
        group: '节点',
        label: cut > 0 ? `${rest.slice(0, cut)} · ${rest.slice(cut + 1)}` : rest,
        target: '节点',
      };
    }
    if (key.startsWith('e:') || displayKey.startsWith('e:')) {
      const rest = displayKey.startsWith('e:') ? displayKey.slice(2) : displayKey;
      const cut = rest.lastIndexOf(':');
      return {
        group: '连接',
        label: cut > 0 ? `${rest.slice(0, cut)} · ${rest.slice(cut + 1)}` : rest,
        target: '连接',
      };
    }
    return { group: '信号', label: displayKey };
  }

export function renderSignalList() {
    if (!ui.signalList) return;
    ui.signalList.replaceChildren();
    if (!state.probeKeys.length) {
      ui.signalList.appendChild(div('help', '运行仿真后自动列出可绘制信号。'));
      renderLegend();
      return;
    }
    const filter = state.chart.filter.trim().toLowerCase();
    const keys = state.probeKeys.filter((key: string) => {
      if (!filter) return true;
      const label = state.probeLabels[key] || '';
      return key.toLowerCase().includes(filter) || label.toLowerCase().includes(filter);
    });
    if (!keys.length) {
      ui.signalList.appendChild(div('help', '没有匹配的信号。'));
      renderLegend();
      return;
    }
    const groups = new Map();
    for (const key of keys) {
      const info = decodeProbeKey(key);
      if (!groups.has(info.group)) groups.set(info.group, []);
      groups.get(info.group).push({ key, info });
    }
    for (const [group, entries] of groups) {
      ui.signalList.appendChild(div('signal-group', group));
      for (const { key, info } of entries) {
        const item = el('label', 'signal-item');
        item.dataset.key = key;
        item.title = key;
        const dot = el('span', 'legend-dot');
        dot.style.background = deps.colorForKey(key);
        const checkbox = el('input');
        checkbox.type = 'checkbox';
        checkbox.checked = state.chart.selected.has(key);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            if (state.chart.selected.size >= CHART_KEYS) {
              checkbox.checked = false;
              toast(`最多同时绘制 ${CHART_KEYS} 条信号`, 'info', 2200);
              return;
            }
            state.chart.selected.add(key);
          } else {
            state.chart.selected.delete(key);
          }
          renderLegend();
          deps.scheduleChartDraw();
        });
        const name = el('span', null, info.label);
        const value = el('em', null, state.values.has(key) ? fmt(state.values.get(key), 3) : '—');
        value.dataset.signalValue = key;
        item.append(dot, checkbox, name, value);
        ui.signalList.appendChild(item);
      }
    }
    updateSignalListValues();
    renderLegend();
  }

export function updateSignalListValues() {
    for (const node of $$('[data-signal-value]', ui.signalList)) {
      const key = node.dataset.signalValue;
      node.textContent = state.values.has((key as string)) ? fmt(state.values.get((key as string)), 3) : '—';
    }
  }

export function renderLegend() {
    if (!ui.legend) return;
    ui.legend.replaceChildren();
    const keys = Array.from(state.chart.selected);
    if (!keys.length) {
      ui.legend.appendChild(div('help', '勾选上方信号以绘制曲线。'));
      return;
    }
    for (const key of keys) {
      const item = div('legend-item');
      const dot = el('span', 'legend-dot');
      dot.style.background = deps.colorForKey(key);
      const name = el('span', 'legend-name', decodeProbeKey(key).label);
      name.title = key;
      const value = el('span', 'legend-value', state.values.has(key) ? fmt(state.values.get(key), 4) : '—');
      value.dataset.legendValue = key;
      item.append(dot, name, value);
      ui.legend.appendChild(item);
    }
  }

export function updateLegendValues() {
    for (const node of $$('[data-legend-value]', ui.legend)) {
      const key = node.dataset.legendValue;
      node.textContent = state.values.has((key as string)) ? fmt(state.values.get((key as string)), 4) : '—';
    }
  }
