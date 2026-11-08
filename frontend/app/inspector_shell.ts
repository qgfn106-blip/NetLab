// S5-17 检查器壳、分节标题与空态助手（从 app.ts 原样迁出）
import { button, div, el } from './ui.js';
import { state, ui } from './state.js';

type EmptyInspectorActions = {
  centerPlacement: () => { x: number; y: number };
  openAddMenu: (x: number, y: number, placeX?: number, placeY?: number) => void;
  fitView: (announce?: boolean) => void;
};

const emptyActions: Partial<EmptyInspectorActions> = {};

export function setEmptyInspectorActions(actions: EmptyInspectorActions): void {
  Object.assign(emptyActions, actions);
}

export function sectionLabel(text: string, note?: string) {
  const label = div('section-label');
  label.appendChild(el('span', null, text));
  if (note) label.appendChild(el('em', null, note));
  return label;
}

export function section(title: string, note?: string, ...children: Node[]) {
  const wrapper = div('section');
  wrapper.appendChild(sectionLabel(title, note));
  for (const child of children) wrapper.appendChild(child);
  return wrapper;
}

export function buildHeader(titleText: string, subtitle: string, specLabel: string) {
  const head = div('insp-head');
  const title = div('insp-title');
  const heading = el('h2', null, titleText);
  const sub = el('p', null, subtitle);
  title.append(heading, sub);
  const badges = div('insp-badges');
  const badge = el('span', 'badge', specLabel);
  badges.appendChild(badge);
  const dirty = el('span', 'badge gray hidden', '未应用');
  dirty.dataset.role = 'dirty-badge';
  badges.appendChild(dirty);
  head.append(title, badges);
  return { head, heading, badge };
}

export function renderEmptyInspector() {
  const host = div('empty-state');
  host.appendChild(el('b', null, '未选择对象'));
  host.appendChild(div('help', '在画布上单击节点或连接以检查参数；双击可直接编辑。也可以从下面的入口开始：'));
  const actions = div('insp-actions');
  actions.appendChild(button('添加节点', 'btn primary', () => {
    const place = emptyActions.centerPlacement!();
    emptyActions.openAddMenu!(state.canvasSize.w / 2, state.canvasSize.h / 2, place.x, place.y);
  }));
  actions.appendChild(button('适配视图', 'btn', () => emptyActions.fitView!(true)));
  host.appendChild(actions);
  const hint = div('help');
  hint.style.marginTop = '12px';
  if (state.mode === 'vector') {
    hint.textContent = '矢量：非线性动态源产生 x/y/vx/vy，连接可传递或扩散二维矢量；画布箭头表示状态方向，相图显示轨迹。';
  } else if (state.mode === 'circuit') {
    hint.textContent = '电路：节点是等电位点，连接是 R/L/C/电源/二极管/开关/受控源，使用节点电压法（MNA）逐步求解。';
  } else {
    hint.textContent = '信号流：节点对入边数据求和/变换，连接负责字段传递、延迟、传递函数与积分。代数环会自动插入延迟。';
  }
  host.appendChild(hint);
  ui.inspector.replaceChildren(host);
  state.inspectorId = null;
}
