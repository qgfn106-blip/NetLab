import { el, div, button } from './ui.js';
import { ui } from './state.js';

export let modalResolver: ((value: boolean) => void) | null = null;

export function closeModal() {
  ui.modal.classList.add('hidden');
  ui.modalCard.replaceChildren();
  const resolver = modalResolver;
  modalResolver = null;
  if (resolver) resolver(false);
}

export function openConfirmModal(title: string, message: string | Node, confirmLabel = '确定', danger = false) {
  return new Promise((resolve) => {
    if (modalResolver) modalResolver(false);
    modalResolver = resolve;
    ui.modalCard.replaceChildren();
    const heading = el('h3', null, title);
    const body = message instanceof Node ? message : el('p', null, message);
    const actions = div('modal-actions');
    const cancel = button('取消', 'btn', () => {
      ui.modal.classList.add('hidden');
      const inner = modalResolver;
      modalResolver = null;
      if (inner) inner(false);
    });
    const okay = button(confirmLabel, danger ? 'btn danger' : 'btn primary', () => {
      ui.modal.classList.add('hidden');
      const inner = modalResolver;
      modalResolver = null;
      if (inner) inner(true);
    });
    actions.append(cancel, okay);
    ui.modalCard.append(heading, body, actions);
    ui.modal.classList.remove('hidden');
    setTimeout(() => okay.focus(), 30);
    ui.modal.onclick = (event: MouseEvent) => {
      if (event.target === ui.modal) cancel.click();
    };
    const onKey = (event: MouseEvent) => {
      if ((event as Event as KeyboardEvent).key === 'Escape') {
        event.preventDefault();
        document.removeEventListener('keydown', onKey as EventListener, true);
        cancel.click();
      }
    };
    document.addEventListener('keydown', onKey as EventListener, true);
  });
}

export let modeResolver: ((value: string | null) => void) | null = null;

export function openModeModal() {
  return new Promise<string | null>((resolve) => {
    if (modeResolver) modeResolver(null);
    modeResolver = resolve;
    ui.modalCard.replaceChildren();
    const finish = (value: string | null) => {
      ui.modal.classList.add('hidden');
      ui.modalCard.replaceChildren();
      const inner = modeResolver;
      modeResolver = null;
      if (inner) inner(value);
    };
    const heading = el('h3', null, '新建工程：选择场景模式');
    const body = el('p', null, '模式决定可用元件与求解器；创建后仍可通过打开工程切换。');
    const list = div('modal-actions');
    const make = (mode: string, label: string, hint: string) => {
      const item = button(`${label} · ${hint}`, 'btn', () => finish(mode));
      item.style.flex = '1';
      return item;
    };
    const cancel = button('取消', 'btn', () => finish(null));
    list.append(
      make('signal', '信号流', '增益/求和/滤波'),
      make('circuit', '电路', '器件节点与 MNA'),
      make('vector', '矢量场', '有限元/场求解'),
    );
    const actions = div('modal-actions');
    actions.append(cancel);
    ui.modalCard.append(heading, body, list, actions);
    ui.modal.classList.remove('hidden');
    ui.modal.onclick = (event: MouseEvent) => {
      if (event.target === ui.modal) finish(null);
    };
  });
}
