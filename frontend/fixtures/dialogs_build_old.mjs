// Old (base 6820a95) dialog cluster, verbatim bodies for equivalence test.
import { el, div, button } from '../app/ui.js';
import { ui } from '../app/state.js';

export let oldModalResolver = null;
export function oldCloseModal() {
  if (oldModalResolver) { const r = oldModalResolver; oldModalResolver = null; ui.modal.classList.add('hidden'); r(false); }
}

export function oldConfirmModal(title, message, confirmLabel = '确定', danger = false) {
  return new Promise((resolve) => {
    oldModalResolver = resolve;
    ui.modalCard.replaceChildren();
    const heading = el('h3', null, title);
    const body = el('p', null, message);
    const actions = div('modal-actions');
    const cancel = button('取消', 'btn', () => oldCloseModal());
    const okay = button(confirmLabel, danger ? 'btn danger' : 'btn primary', () => { const r = oldModalResolver; oldModalResolver = null; ui.modal.classList.add('hidden'); if (r) r(true); });
    actions.append(cancel, okay);
    ui.modalCard.append(heading, body, actions);
    ui.modal.classList.remove('hidden');
    ui.modal.onclick = (event) => { if (event.target === ui.modal) oldCloseModal(); };
    setTimeout(() => okay.focus(), 30);
  });
}

export let oldModeResolver = null;
export function oldChooseModeModal() {
  return new Promise((resolve) => {
    if (oldModeResolver) oldModeResolver(null);
    oldModeResolver = resolve;
    ui.modalCard.replaceChildren();
    const finish = (value) => { ui.modal.classList.add('hidden'); ui.modalCard.replaceChildren(); const inner = oldModeResolver; oldModeResolver = null; if (inner) inner(value); };
    const heading = el('h3', null, '新建工程：选择场景模式');
    const body = el('p', null, '模式决定可用元件与求解器；创建后仍可通过打开工程切换。');
    const list = div('modal-actions');
    const make = (mode, label, hint) => { const item = button(`${label} · ${hint}`, 'btn', () => finish(mode)); item.style.flex = '1'; return item; };
    const cancel = button('取消', 'btn', () => finish(null));
    list.append(make('signal','信号流','增益/求和/滤波'), make('circuit','电路','器件节点与 MNA'), make('vector','矢量场','有限元/场求解'));
    const actions = div('modal-actions');
    actions.append(cancel);
    ui.modalCard.append(heading, body, list, actions);
    ui.modal.classList.remove('hidden');
    ui.modal.onclick = (event) => { if (event.target === ui.modal) finish(null); };
  });
}
