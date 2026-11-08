// S5-19 检查器渲染：节点/导线/边/应用修改/实时刷新（从 app.ts 原样迁出）
import type { EdgeItem, NodeItem, PayloadRec, PortSpec, SpecRec } from './types.js';
declare const desc: HTMLElement;
import type { ApiOptions } from './net.js';
import { jsonRequest } from './net.js';
import { button, div, el } from './ui.js';
import { $$ } from './dom.js';
import { clamp, fmt } from '../app.utils.js';
import { state, ui } from './state.js';
import { toast, showBanner } from './desktop.js';
import { buildHeader, section } from './inspector_shell.js';
import { buildDevicePinList, deviceElementSpec, modulePorts } from './device_pins.js';
import { buildKindSelect, formatAny, numberedField } from './fields.js';
import { buildParamFields, collectData, collectParamValues, dataRow, markDirty } from './param_fields.js';
import { edgeDisplayData, getEdgeSpec, getNodeSpec, nodeById, nodeDisplayData, selectedEdge, selectedNode, specDefaults } from './model.js';

type InspectorHooks = {
  deleteNode: (nodeId: string) => void;
  patchNodeGeometry: (nodeId: string, patch: Record<string, unknown>) => void;
  nodeDiameter: (node: NodeItem) => number;
  deleteEdge: (edgeId: string) => void;
  patchEdgeGeometry: (edgeId: string, patch: Record<string, unknown>) => void;
  syncUI: () => void;
  updateScenePanelValues: () => void;
  renderInspector: () => void;
  updateSignalKeyCache: (...args: any[]) => void;
  refreshState: (...args: any[]) => void;
};

const hooks: Partial<InspectorHooks> = {};
export function setInspectorActions(actions: InspectorHooks): void {
  Object.assign(hooks, actions);
}

function deleteNode(...args: Parameters<InspectorHooks['deleteNode']>) { hooks.deleteNode!(...args); }
function patchNodeGeometry(...args: Parameters<InspectorHooks['patchNodeGeometry']>) { hooks.patchNodeGeometry!(...args); }
function nodeDiameterHook(...args: Parameters<InspectorHooks['nodeDiameter']>) { return hooks.nodeDiameter!(...args); }
function deleteEdge(...args: Parameters<InspectorHooks['deleteEdge']>) { hooks.deleteEdge!(...args); }
function patchEdgeGeometry(...args: Parameters<InspectorHooks['patchEdgeGeometry']>) { hooks.patchEdgeGeometry!(...args); }
function syncUI() { hooks.syncUI!(); }
function updateScenePanelValues() { hooks.updateScenePanelValues!(); }
function renderInspector() { hooks.renderInspector!(); }
function updateSignalKeyCache(...args: any[]) { hooks.updateSignalKeyCache!(...args); }
function refreshState(...args: any[]) { hooks.refreshState!(...args); }

export function renderNodeInspector(node: NodeItem) {
    const isModule = state.mode === 'circuit' && node.kind === 'module';
    const isDevice = state.mode === 'circuit' && node.kind === 'device';
    const spec = isDevice ? deviceElementSpec(node) : (isModule ? null : getNodeSpec(node.kind));
    const specLabel = isModule ? '模块' : (spec?.label || node.kind);
    const { head, heading, badge } = buildHeader(
      node.name,
      `${specLabel} · ${isModule ? '模块实例' : isDevice ? '器件' : '节点'} ${node.id}`,
      specLabel,
    );

    const form = el('form');
    form.dataset.role = 'form';
    form.autocomplete = 'off';

    const identity = section('身份');
    const nameField = div('field');
    nameField.appendChild(numberedField('名称', '最多 32 字符'));
    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.maxLength = 32;
    nameInput.value = node.name;
    nameInput.dataset.role = 'name';
    nameInput.addEventListener('input', () => {
      heading.textContent = nameInput.value.trim() || node.name;
      markDirty();
    });
    nameField.appendChild(nameInput);
    identity.appendChild(nameField);

    const kindField = div('field');
    let kindSelect = null;
    if (isModule) {
      kindField.appendChild(numberedField('模块类型', '封装后的电路模块实例'));
      const hiddenKind = el('input');
      hiddenKind.type = 'hidden';
      hiddenKind.dataset.role = 'kind';
      hiddenKind.value = 'module';
      kindField.appendChild(hiddenKind);
      const portNames = modulePorts(node).map((port: PortSpec) => port.name).join('、') || '（无端口）';
      kindField.appendChild(div('help', `块 ${node.params?.block_name || node.params?.block_id || '?'} · 端口 ${portNames}`));
    } else if (isDevice) {
      kindField.appendChild(numberedField('元件类型', '器件节点：引脚在下方「引脚」区查看'));
      const hiddenKind = el('input');
      hiddenKind.type = 'hidden';
      hiddenKind.dataset.role = 'kind';
      hiddenKind.value = 'device';
      kindField.appendChild(hiddenKind);
      kindField.appendChild(div('help', `${specLabel}（${node.params?.element || '?'}）`));
    } else {
      kindField.appendChild(numberedField('计算方法', state.mode === 'circuit' ? '电学节点类型' : '节点内部计算'));
      kindSelect = buildKindSelect('node', node.kind, ((node.id)));
      kindField.appendChild(kindSelect);
      kindField.appendChild(div('help', spec?.description || ''));
    }
    identity.appendChild(kindField);

    const sizeField = div('field');
    sizeField.appendChild(numberedField(isDevice ? '宽度' : '尺寸', isDevice ? '器件框宽度 24–200' : '直径 24–200，连线端点随之联动'));
    const sizeInput = el('input');
    sizeInput.type = 'number';
    sizeInput.min = '24';
    sizeInput.max = '200';
    sizeInput.step = '4';
    sizeInput.value = String(Math.round(isDevice ? (Number(node.size?.w) || 120) : nodeDiameterHook(node)));
    sizeInput.dataset.role = 'node-size';
    sizeInput.addEventListener('change', () => {
      const value = clamp(Math.round(Number(sizeInput.value) || (isDevice ? (Number(node.size?.w) || 120) : nodeDiameterHook(node))), 24, 200);
      sizeInput.value = String(value);
      void patchNodeGeometry(node.id, { size: { w: value } });
    });
    sizeField.appendChild(sizeInput);
    identity.appendChild(sizeField);

    const params = buildParamFields((spec as SpecRec), node.params || {});
    if (state.mode === 'circuit' && node.kind === 'node') {
      // R24/D49：网络节点可标记为模块端口，封装时按端口暴露到外部。
      const portName = div('field');
      portName.dataset.param = 'port_name';
      portName.dataset.type = 'text';
      portName.dataset.label = '端口名';
      portName.appendChild(numberedField('端口名', '留空＝不作端口'));
      const portInput = el('input');
      portInput.type = 'text';
      portInput.maxLength = 24;
      portInput.value = String(node.params?.port_name || '');
      portName.appendChild(portInput);
      const portDir = div('field');
      portDir.dataset.param = 'port_direction';
      portDir.dataset.type = 'text';
      portDir.dataset.label = '端口方向';
      portDir.appendChild(numberedField('端口方向', '封装后画成进/出/双向'));
      const dirSelect = el('select');
      for (const [value, label] of [['inout', '双向'], ['input', '输入'], ['output', '输出']]) {
        const option = el('option', null, label);
        option.value = value;
        dirSelect.appendChild(option);
      }
      dirSelect.value = String(node.params?.port_direction || 'inout');
      portDir.appendChild(dirSelect);
      params.append(portName, portDir);
    }

    let dataEditor: HTMLElement | null = null;
    if (state.mode !== 'circuit') {
      dataEditor = div('data-rows');
      dataEditor.dataset.role = 'data';
      const entries = Object.entries(node.data || {});
      if (entries.length) {
        for (const [key, value] of entries) dataEditor.appendChild(dataRow(key, value));
      }
      const addRow = button('＋ 添加字段', 'btn tiny', () => {
        const row = dataRow('', '');
        dataEditor!.appendChild(row);
        (row!.querySelector('.data-key') as HTMLElement).focus();
        markDirty();
      });
      const note = div('help', '计算节点会覆盖输出字段的值；手动数据源则以这里的值为准。值为数字、true/false、JSON 数组/对象或文本。');
      dataEditor.appendChild(addRow);
      dataEditor.appendChild(note);
    }

    const live = div('kv');
    live.dataset.role = 'node-live';
    const display = nodeDisplayData(node);
    const numericFields = Object.keys(display).filter((key: string) => typeof display[key] === 'number');
    for (const key of numericFields.slice(0, 10)) {
      const row = div('kv-row');
      row.appendChild(el('span', null, key));
      const value = el('b', null, fmt(display[key], 5));
      value.dataset.liveNodeValue = '1';
      value.dataset.node = node.id;
      value.dataset.field = key;
      row.appendChild(value);
      live.appendChild(row);
    }
    if (!numericFields.length) live.appendChild(div('help', '暂无实时数值输出。'));
    const inputsRow = div('kv-row');
    inputsRow.appendChild(el('span', null, '入边数量'));
    const inputsValue = el('b', null, String(Object.keys(node.inputs || {}).length));
    inputsValue.dataset.liveInputs = '1';
    inputsRow.appendChild(inputsValue);
    live.appendChild(inputsRow);

    const statePre = el('pre', 'json');
    statePre.textContent = JSON.stringify(node.state || {}, null, 2);
    statePre.dataset.liveState = '1';

    const actions = div('insp-actions');
    const save = button('应用修改', 'btn primary', null);
    save.type = 'submit';
    save.dataset.role = 'save';
    const remove = button('删除节点', 'btn danger', () => void deleteNode(node.id));
    actions.append(save, remove);

    const pinSection = (isDevice || isModule)
      ? section('引脚', isModule ? '模块端口 ↔ 网络节点导线' : '必接引脚需恰好一条导线（pin↔net）', buildDevicePinList(node))
      : null;
    form.append(
      identity,
      ...(pinSection ? [pinSection] : []),
      section('参数', (spec?.notes || '') as string, params),
      ...(dataEditor ? [section('节点数据', '实时字段', dataEditor)] : []),
      section('实时值', '随帧更新', live),
      section('内部状态', '只读', statePre),
      actions,
    );

    if (kindSelect) kindSelect.addEventListener('change', () => {
      const nextSpec = getNodeSpec(kindSelect.value);
      const nextParams = buildParamFields((nextSpec as SpecRec), specDefaults(nextSpec));
      const current = form.querySelector('[data-role="params"]');
      if (current) current.replaceWith(nextParams);
      desc.textContent = nextSpec?.description || '';
      badge.textContent = nextSpec?.label || kindSelect.value;
      markDirty();
    });

    form.addEventListener('input', markDirty);
    form.addEventListener('change', markDirty);
    form.addEventListener('submit', (event: SubmitEvent) => {
      event.preventDefault();
      void applyInspector();
    });

    ui.inspector.replaceChildren(head, form);
    state.inspectorId = `node:${node.id}`;
    state.inspectorDirty = false;
    updateInspectorLive();
  }

export function renderWireInspector(edge: EdgeItem) {
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    const { head } = buildHeader(
      edge.name,
      `导线 · ${source?.name || '?'}${edge.source_pin ? `[${edge.source_pin}]` : ''} → `
        + `${target?.name || '?'}${edge.target_pin ? `[${edge.target_pin}]` : ''}`,
      '导线',
    );
    const form = el('form');
    form.dataset.role = 'form';
    const identity = section('身份');
    const nameField = div('field');
    nameField.appendChild(numberedField('名称', '最多 32 字符'));
    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.maxLength = 32;
    nameInput.value = edge.name;
    nameInput.dataset.role = 'name';
    nameInput.addEventListener('input', markDirty);
    nameField.appendChild(nameInput);
    identity.appendChild(nameField);
    const hiddenKind = el('input');
    hiddenKind.type = 'hidden';
    hiddenKind.dataset.role = 'kind';
    hiddenKind.value = 'wire';
    identity.appendChild(hiddenKind);
    const params = div('params-grid');
    params.dataset.role = 'params';
    const waypoints = div('params-grid');
    waypoints.dataset.role = 'waypoints';
    const appendPoint = (x: number, y: number) => {
      const row = div('inline-fields');
      row.dataset.role = 'waypoint-row';
      for (const [axis, value] of [['x', x], ['y', y]]) {
        const field = div('field');
        field.appendChild(numberedField((axis as string).toUpperCase(), ''));
        const input = el('input');
        input.type = 'number';
        input.step = '10';
        input.value = String(Math.round(Number(value) || 0));
        input.dataset.role = `waypoint-${axis}`;
        input.addEventListener('input', markDirty);
        field.appendChild(input);
        row.appendChild(field);
      }
      const drop = button('×', 'icon-btn', () => {
        row.remove();
        markDirty();
      });
      drop.title = '删除该折点';
      row.appendChild(drop);
      waypoints.appendChild(row);
    };
    for (const point of edge.waypoints || []) appendPoint(point.x, point.y);
    const addPoint = button('＋ 添加折点', 'btn tiny', () => {
      const rows = [...waypoints.querySelectorAll('[data-role="waypoint-row"]')];
      const last = rows.length ? rows[rows.length - 1] : null;
      const x = last ? Number((last!.querySelector('[data-role="waypoint-x"]') as HTMLInputElement).value) + 40 : 0;
      const y = last ? Number((last!.querySelector('[data-role="waypoint-y"]') as HTMLInputElement).value) : 0;
      appendPoint(x, y);
      markDirty();
    });
    addPoint.dataset.role = 'waypoint-add';
    const actions = div('insp-actions');
    const save = button('应用修改', 'btn primary', null);
    save.type = 'submit';
    save.dataset.role = 'save';
    const remove = button('删除导线', 'btn danger', () => void deleteEdge(edge.id));
    actions.append(save, remove);
    form.append(identity,
      section('说明', '导线允许「网络节点 ↔ 网络节点」（纯导线，电气合并）或「器件引脚 ↔ 网络节点」', div('help', '删除导线即断开连接；折点为空时按正交/直线路由。')),
      section('折点', '可设置多个折点；有折点时路由自动变为手动', waypoints),
      addPoint,
      section('参数', '', params), actions);
    form.addEventListener('submit', (event: SubmitEvent) => {
      event.preventDefault();
      void applyInspector();
    });
    ui.inspector.replaceChildren(head, form);
    state.inspectorId = `edge:${edge.id}`;
    state.inspectorDirty = false;
  }

export function renderEdgeInspector(edge: EdgeItem) {
    if (edge.kind === 'wire') {
      renderWireInspector(edge);
      return;
    }
    const spec = getEdgeSpec(edge.kind);
    const specLabel = spec?.label || edge.kind;
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    const { head, badge } = buildHeader(
      edge.name,
      `${specLabel} · ${source?.name || '?'} → ${target?.name || '?'}`,
      specLabel,
    );

    const form = el('form');
    form.dataset.role = 'form';
    form.autocomplete = 'off';

    const identity = section('身份');
    const nameField = div('field');
    nameField.appendChild(numberedField('名称', '最多 32 字符'));
    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.maxLength = 32;
    nameInput.value = edge.name;
    nameInput.dataset.role = 'name';
    nameField.appendChild(nameInput);
    identity.appendChild(nameField);

    const kindField = div('field');
    kindField.appendChild(numberedField('传递方式', state.mode === 'circuit' ? '电路元件' : '连接函数'));
    const kindSelect = buildKindSelect('edge', edge.kind, ((edge.id)));
    kindField.appendChild(kindSelect);
    const desc = div('help', spec?.description || '');
    kindField.appendChild(desc);
    identity.appendChild(kindField);

    const endpoints = div('kv');
    const sourceRow = div('kv-row');
    sourceRow.append(el('span', null, '起点'), el('b', null, source?.name || edge.source));
    const targetRow = div('kv-row');
    targetRow.append(el('span', null, '终点'), el('b', null, target?.name || edge.target));
    endpoints.append(sourceRow, targetRow);
    identity.appendChild(endpoints);

    if (state.mode !== 'circuit') {
      const delayRow = div('switch-row');
      delayRow.appendChild(el('span', null, '单步延迟 z⁻¹（切断代数环）'));
      const delayInput = el('input');
      delayInput.type = 'checkbox';
      delayInput.checked = Boolean(edge.delay);
      delayInput.dataset.role = 'delay';
      delayRow.appendChild(delayInput);
      identity.appendChild(delayRow);
    }
    const enabledRow = div('switch-row');
    enabledRow.appendChild(el('span', null, '启用该连接'));
    const enabledInput = el('input');
    enabledInput.type = 'checkbox';
    enabledInput.checked = Boolean(edge.enabled);
    enabledInput.dataset.role = 'enabled';
    enabledRow.appendChild(enabledInput);
    identity.appendChild(enabledRow);

    const geometry = section('几何', '路由 / 锚点立即生效；手动路由可用 Alt+点击连线添加拐点');
    const routeField = div('field');
    routeField.appendChild(numberedField('路由', '自动 / 直线 / 正交 / 手动'));
    const routeSelect = el('select');
    for (const [value, label] of [
      ['auto', '自动（曲线）'],
      ['straight', '直线'],
      ['orthogonal', '正交折线'],
      ['manual', '手动拐点'],
    ]) {
      const option = el('option', null, label);
      option.value = value;
      if ((edge.route || 'auto') === value) option.selected = true;
      routeSelect.appendChild(option);
    }
    routeSelect.addEventListener('change', () => {
      void patchEdgeGeometry(edge.id, { route: routeSelect.value });
    });
    routeField.appendChild(routeSelect);
    geometry.appendChild(routeField);

    const anchorsRow = div('inline-fields');
    for (const [key, label] of [['source', '起点锚点'], ['target', '终点锚点']]) {
      const wrap = div('field');
      wrap.appendChild(numberedField(label, ''));
      const select = el('select');
      for (const [value, text] of [
        ['auto', '自动'],
        ['left', '左'],
        ['right', '右'],
        ['top', '上'],
        ['bottom', '下'],
      ]) {
        const option = el('option', null, text);
        option.value = value;
        if ((edge.anchors?.[key] || 'auto') === value) option.selected = true;
        select.appendChild(option);
      }
      select.addEventListener('change', () => {
        void patchEdgeGeometry(edge.id, { anchors: { ...(edge.anchors || {}), [key]: select.value } });
      });
      wrap.appendChild(select);
      anchorsRow.appendChild(wrap);
    }
    geometry.appendChild(anchorsRow);
    if (edge.route === 'manual') {
      const clear = button('清空拐点', 'btn tiny', () => void patchEdgeGeometry(edge.id, { waypoints: [] }));
      geometry.appendChild(clear);
    }

    const params = buildParamFields((spec as SpecRec), edge.params || {});

    let portSection = null;
    if (state.mode !== 'circuit') {
      const sourceSpec = getNodeSpec((source?.kind as string));
      const targetSpec = getNodeSpec((target?.kind as string));
      const outputs = Array.isArray(sourceSpec?.outputs) ? sourceSpec.outputs : [];
      const inputs = Array.isArray(targetSpec?.inputs) ? targetSpec.inputs : [];
      if (outputs.length || inputs.length) {
        const grid = div('params-grid');
        const makePort = (role: string, options: (string | PortSpec)[], current: string) => {
          const wrapper = div('field');
          wrapper.appendChild(numberedField(role === 'source' ? '源端口' : '目标端口',
            role === 'source' ? '取源节点的哪个输出字段' : '写入目标节点的哪个输入端口'));
          const select = el('select');
          select.dataset.role = role === 'source' ? 'source-port' : 'target-port';
          const empty = el('option', null, '（不绑定，兼容旧语义）');
          empty.value = '';
          select.appendChild(empty);
          const names = options.map((item: string | PortSpec) => (typeof item === 'string' ? item : item.name));
          if (current && !names.includes(current)) names.push(current);
          for (const name of names) {
            const option = el('option', null, name);
            option.value = name;
            if (current === name) option.selected = true;
            select.appendChild(option);
          }
          select.addEventListener('change', markDirty);
          wrapper.appendChild(select);
          return wrapper;
        };
        grid.append(
          makePort('source', outputs, edge.source_port || ''),
          makePort('target', inputs, edge.target_port || ''),
        );
        portSection = section('端口绑定', 'R20/Q8：边显式绑定源输出字段与目标输入端口；不绑定则按旧语义（连接名聚合/input_key）', grid);
      }
    }

    const live = div('kv');
    const output = edgeDisplayData(edge);
    const fields = Object.keys(output).filter((key: string) => typeof output[key] === 'number');
    for (const key of fields.slice(0, 8)) {
      const row = div('kv-row');
      row.appendChild(el('span', null, key));
      const value = el('b', null, fmt(output[key], 5));
      value.dataset.liveEdgeValue = '1';
      value.dataset.edge = edge.id;
      value.dataset.field = key;
      row.appendChild(value);
      live.appendChild(row);
    }
    if (!fields.length) live.appendChild(div('help', '运行后显示连接输出。'));

    const statePre = el('pre', 'json');
    statePre.textContent = JSON.stringify(edge.state || {}, null, 2);
    statePre.dataset.liveState = '1';

    const actions = div('insp-actions');
    const save = button('应用修改', 'btn primary', null);
    save.type = 'submit';
    save.dataset.role = 'save';
    const remove = button('删除连接', 'btn danger', () => void deleteEdge(edge.id));
    actions.append(save, remove);

    form.append(
      identity,
      geometry,
      ...(portSection ? [portSection] : []),
      section('参数', (spec?.notes || '') as string, params),
      section('实时输出', '随帧更新', live),
      section('连接状态', '只读', statePre),
      actions,
    );

    kindSelect.addEventListener('change', () => {
      const nextSpec = getEdgeSpec(kindSelect.value);
      const nextParams = buildParamFields((nextSpec as SpecRec), specDefaults(nextSpec));
      const current = form.querySelector('[data-role="params"]');
      if (current) current.replaceWith(nextParams);
      desc.textContent = nextSpec?.description || '';
      badge.textContent = nextSpec?.label || kindSelect.value;
      markDirty();
    });

    form.addEventListener('input', markDirty);
    form.addEventListener('change', markDirty);
    form.addEventListener('submit', (event: SubmitEvent) => {
      event.preventDefault();
      void applyInspector();
    });

    ui.inspector.replaceChildren(head, form);
    state.inspectorId = `edge:${edge.id}`;
    state.inspectorDirty = false;
    updateInspectorLive();
  }

  export async function applyInspector(options: ApiOptions = {}) {
    if (!state.selection.type) return true;
    const form = ui.inspector.querySelector('[data-role="form"]');
    if (!form) return true;
    if (state.busy) {
      if (!options.quiet) toast('正在处理其他请求，请稍候…', 'info', 1500);
      return false;
    }
    state.busy = true;
    try {
      const name = (form!.querySelector('[data-role="name"]') as HTMLInputElement).value.trim();
      const kind = (form!.querySelector('[data-role="kind"]') as HTMLInputElement).value;
      const params = collectParamValues((form.querySelector('[data-role="params"]') as HTMLElement));

      if (state.selection.type === 'node') {
        const node = selectedNode();
        if (!node) return false;
        const payload: PayloadRec = { name, kind, params };
        if (node.kind === 'device') params.element = String(node.params?.element || '');
        if (state.mode !== 'circuit') {
          const dataHost = form.querySelector('[data-role="data"]');
          if (dataHost) payload.data = collectData((dataHost as HTMLElement));
        }
        const response = await jsonRequest(`/api/nodes/${encodeURIComponent(node.id)}`, 'PATCH', payload);
        const index = state.scene!.nodes.findIndex((item) => item.id === node.id);
        if (index >= 0) state.scene!.nodes[index] = response.node;
        if (response.sim) state.sim = response.sim;
        state.scene!.revision = response.revision ?? state.scene!.revision;
        state.inspectorDirty = false;
        syncUI();
        updateScenePanelValues();
        renderInspector();
        updateSignalKeyCache();
        if (!options.quiet) toast('节点已保存', 'ok', 1800);
        void refreshState(true);
        return true;
      }

      const edge = selectedEdge();
      if (!edge) return false;
      const payload: PayloadRec = { name, kind, params };
      if (state.mode !== 'circuit') payload.delay = Boolean((form.querySelector('[data-role="delay"]') as HTMLInputElement)?.checked);
      else payload.delay = false;
      const sourcePortBox = form.querySelector('[data-role="source-port"]');
      const targetPortBox = form.querySelector('[data-role="target-port"]');
      if (sourcePortBox) payload.source_port = (sourcePortBox as HTMLInputElement).value;
      if (targetPortBox) payload.target_port = (targetPortBox as HTMLInputElement).value;
      const waypointBox = form.querySelector('[data-role="waypoints"]');
      if (waypointBox) {
        payload.waypoints = [...waypointBox.querySelectorAll('[data-role="waypoint-row"]')].map((row) => ({
          x: Number((row.querySelector('[data-role="waypoint-x"]') as HTMLInputElement).value) || 0,
          y: Number((row.querySelector('[data-role="waypoint-y"]') as HTMLInputElement).value) || 0,
        }));
        payload.route = (payload.waypoints as Array<{ x: number; y: number }>).length ? 'manual' : 'auto';
      }
      const enabledBox = form.querySelector('[data-role="enabled"]');
      if (enabledBox) payload.enabled = Boolean((enabledBox as HTMLInputElement).checked);
      const response = await jsonRequest(`/api/edges/${encodeURIComponent(edge.id)}`, 'PATCH', payload);
      const index = state.scene!.edges.findIndex((item) => item.id === edge.id);
      if (index >= 0) state.scene!.edges[index] = response.edge;
      if (response.sim) state.sim = response.sim;
      state.scene!.revision = response.revision ?? state.scene!.revision;
      state.inspectorDirty = false;
      syncUI();
      updateScenePanelValues();
      renderInspector();
      updateSignalKeyCache();
      if (!options.quiet) toast('连接已保存', 'ok', 1800);
      void refreshState(true);
      return true;
    } catch (error) {
      const message = (error as Error)?.message || String(error);
      toast(message, 'error', 7000);
      if (!options.quiet && /电路|代数环|接地|奇异|发散/.test(message)) showBanner(message);
      return false;
    } finally {
      state.busy = false;
    }
  }

export function updateInspectorLive() {
    if (!state.inspectorId) return;
    const selected = selectedNode();
    if (selected) {
      const data = nodeDisplayData(selected);
      for (const value of $$('[data-live-node-value]', ui.inspector)) {
        if (value.dataset.node !== selected.id) continue;
        value.textContent = formatAny(data[value.dataset.field as string]);
      }
      const inputs = ui.inspector.querySelector('[data-live-inputs]');
      if (inputs) inputs.textContent = String(Object.keys(selected.inputs || {}).length);
      const statePre = ui.inspector.querySelector('[data-live-state]');
      if (statePre) {
        const text = JSON.stringify(selected.state || {}, null, 2);
        if (statePre.textContent !== text) statePre.textContent = text;
      }
      return;
    }
    const edge = selectedEdge();
    if (edge) {
      const data = edgeDisplayData(edge);
      for (const value of $$('[data-live-edge-value]', ui.inspector)) {
        if (value.dataset.edge !== edge.id) continue;
        value.textContent = formatAny(data[value.dataset.field as string]);
      }
      const statePre = ui.inspector.querySelector('[data-live-state]');
      if (statePre) {
        const text = JSON.stringify(edge.state || {}, null, 2);
        if (statePre.textContent !== text) statePre.textContent = text;
      }
    }
  }
