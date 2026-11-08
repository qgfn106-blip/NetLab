// S5-16：参数帮助卡片与提示按钮（从 app.ts 拆出，M 轮）
import { div, el, button } from './ui.js';
import { state, ui } from './state.js';
import { clamp } from '../app.utils.js';
import { toast } from './desktop.js';
import type { HelpInfoRec, ParamSpec } from './types.js';

export type SwitchTabFn = (tab: string) => void;
let switchTabFn: SwitchTabFn | null = null;

export function setSwitchTab(fn: SwitchTabFn) {
  switchTabFn = fn;
}

  export function paramRangeText(param: ParamSpec) {
    const parts = [];
    if (param.min !== undefined && param.min !== null) parts.push(`≥ ${param.min}`);
    if (param.max !== undefined && param.max !== null) parts.push(`≤ ${param.max}`);
    if (param.positive) parts.push('> 0');
    if (param.step !== undefined && param.step !== null) parts.push(`步长 ${param.step}`);
    return parts.join(' · ');
  }

  export function hideHelpCard() {
    if (ui.qcard) ui.qcard.hidden = true;
  }


  export function showHelpCard(anchor: HTMLElement, info: HelpInfoRec) {
    if (!ui.qcard) return;
    ui.qcard.replaceChildren();
    const head = div('qcard-head');
    head.appendChild(el('b', null, info.title || '参数说明'));
    const close = button('✕', 'qcard-close', hideHelpCard);
    head.appendChild(close);
    ui.qcard.appendChild(head);

    const dl = el('dl');
    const sections = [
      ['说明', info.description || '该参数没有额外说明。'],
      ['取值', info.range || '—'],
      ['单位与默认', `${info.unit || '无量纲'} · 默认 ${info.def === undefined || info.def === null || info.def === '' ? '—' : info.def}`],
      ['公式 / 实现', info.formula || '—'],
    ];
    for (const [label, value] of sections) {
      dl.appendChild(el('dt', null, label));
      dl.appendChild(el('dd', null, value));
    }
    ui.qcard.appendChild(dl);
    if (info.source) {
      const actions = div('qcard-actions');
      const jump = button('查看实现页 →', 'btn tiny', () => {
        hideHelpCard();
        switchTabFn?.(info.role === 'edge' ? 'edge-fn' : 'node-fn');
        toast((info.source as string), 'info', 5200);
      });
      actions.appendChild(jump);
      ui.qcard.appendChild(actions);
    }
    ui.qcard.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const width = 320;
    const left = clamp(rect.right + 10, 12, window.innerWidth - width - 12);
    const top = clamp(rect.top - 8, 56, window.innerHeight - 240);
    ui.qcard.style.left = `${left}px`;
    ui.qcard.style.top = `${top}px`;
  }

  export function typeLabelHelp(label: HTMLElement, param: ParamSpec) {
    if (!label || !param) return;
    const ask = button('?', 'qbtn inline', (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      showHelpCard(ask, {
        title: `${param.label || param.key}（${param.key}）`,
        description: (param.help as string | undefined),
        range: paramRangeText(param),
        unit: (param.unit as string | undefined),
        def: param.default,
        role: state.selection?.type === 'edge' ? 'edge' : 'node',
      });
    });
    ask.title = '参数说明：说明 / 取值 / 单位与默认';
    label.appendChild(ask);
  }
