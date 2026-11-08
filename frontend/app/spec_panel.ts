// S5-20 规格查看（函数/公式）与 Python 扩展面板（从 app.ts 原样迁出）
import type { DeclaredItemRec, ExtItemRec, ExtResultRec, ParamSpec, SpecRec } from './types.js';
import { state, ui } from './state.js';
import { el, div, button } from './ui.js';
import { api } from './net.js';
import { toast } from './desktop.js';
import { section } from './inspector_shell.js';
import { paramRangeText } from './help_card.js';
import { activeTab, getEdgeSpec, getNodeSpec, selectedEdge, selectedNode } from './model.js';

type SpecPanelHooks = {
  attachParamHelp: (cell: HTMLElement, param: ParamSpec, spec: SpecRec, role: string) => void;
  confirmModal: (title: string, message: string | Node, confirmLabel?: string, danger?: boolean) => Promise<unknown>;
  renderInspector: () => void;
};

const specPanelHooks: Partial<SpecPanelHooks> = {};
export function setSpecPanelActions(actions: SpecPanelHooks): void {
  Object.assign(specPanelHooks, actions);
}

function attachParamHelp(...args: Parameters<SpecPanelHooks['attachParamHelp']>) { specPanelHooks.attachParamHelp!(...args); }
function confirmModal(...args: Parameters<SpecPanelHooks['confirmModal']>) { return specPanelHooks.confirmModal!(...args); }
function callRenderInspector() { specPanelHooks.renderInspector!(); }

  /* ======================================================================
   * 6.5 规格查看（函数 / 公式）与 Python 扩展面板
   * ==================================================================== */

export function specListForMode() {
    if (!state.catalog) return [];
    return state.mode === 'circuit'
      ? { nodes: state.catalog.circuit_nodes || [], edges: state.catalog.elements || [] }
      : { nodes: state.catalog.computes || [], edges: state.catalog.methods || [] };
  }

export function specTarget() {
    if (state.selection.type === 'node') {
      const node = selectedNode();
      if (!node) return null;
      return { role: 'node', spec: getNodeSpec(node.kind), kind: node.kind, name: node.name };
    }
    if (state.selection.type === 'edge') {
      const edge = selectedEdge();
      if (!edge) return null;
      return { role: 'edge', spec: getEdgeSpec(edge.kind), kind: edge.kind, name: edge.name };
    }
    return null;
  }

export function specByKind(role: string, kind: string) {
    const lists = specListForMode() as { nodes: SpecRec[]; edges: SpecRec[] };
    const list = role === 'edge' ? lists.edges : lists.nodes;
    return (list || []).find((spec: SpecRec) => spec.kind === kind) || null;
  }

export function specBadges(spec: SpecRec) {
    const row = div('spec-badges');
    row.appendChild(el('span', 'badge', String(spec.mode || state.mode)));
    row.appendChild(el('span', spec.builtin ? 'badge gray' : 'badge violet', spec.builtin ? '内置' : '扩展'));
    if (spec.editable) row.appendChild(el('span', 'badge green', '可自定义'));
    return row;
  }


export function paramTable(spec: SpecRec) {
    const wrap = div('spec-table-wrap');
    const table = el('table', 'spec-table');
    const head = el('tr');
    for (const title of ['参数', '类型', '默认', '单位', '范围', '必填', '说明']) {
      head.appendChild(el('th', null, title));
    }
    table.appendChild(head);
    const params = Array.isArray(spec.params) ? spec.params : [];
    if (!params.length) {
      const row = el('tr');
      const cell = el('td', 'spec-empty', '该规格没有可调参数');
      cell.colSpan = 7;
      row.appendChild(cell);
      table.appendChild(row);
    }
    for (const param of params) {
      const row = el('tr');
      const nameCell = el('td');
      nameCell.appendChild(el('code', null, (param.label || param.key) as string));
      nameCell.appendChild(el('span', 'spec-key', param.key));
      row.appendChild(nameCell);
      row.appendChild(el('td', null, param.type as string));
      const def = param.default;
      row.appendChild(
        el('td', null, typeof def === 'object' && def !== null ? JSON.stringify(def) : String(def ?? '')),
      );
      row.appendChild(el('td', null, (param.unit || '—') as string));
      row.appendChild(el('td', null, paramRangeText(param) || '—'));
      row.appendChild(el('td', null, param.required ? '是' : ''));
      const helpCell = el('td', 'spec-help', (param.help || '') as string);
      attachParamHelp(helpCell, param, spec, state.specRole || 'node');
      row.appendChild(helpCell);
      table.appendChild(row);
    }
    wrap.appendChild(table);
    return wrap;
  }

export function sourceBlock(source: string) {
    const text = String(source || '');
    if (!text.trim()) {
      return div('help spec-no-source', '源码不可用：该实现没有可直接读取的 Python 源码（可能由内置 C 扩展或动态生成）。');
    }
    const pre = el('pre', 'spec-source');
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const row = div('src-line');
      row.appendChild(el('span', 'src-ln', String(index + 1)));
      row.appendChild(el('span', 'src-code', lines[index] || ' '));
      pre.appendChild(row);
    }
    return pre;
  }

export function renderSpecPane() {
    if (!ui.specPane) return;
    const fnRole = state.fnRole || 'node';
    const rawTarget = specTarget();
    const target = rawTarget && rawTarget.role === fnRole ? rawTarget : null;
    const lists = specListForMode() as { nodes: SpecRec[]; edges: SpecRec[] };
    const roleList = fnRole === 'edge' ? lists.edges : lists.nodes;
    let spec = target?.spec || null;
    if (!spec) {
      spec = specByKind(fnRole, state.specKind) || roleList[0] || null;
    }

    const host = div('spec-host');
    const intro = div('help');
    intro.textContent = target
      ? `当前选中${target.role === 'node' ? '节点' : '连接'}「${target.name}」，下面展示它实际使用的计算函数与参数定义。`
      : fnRole === 'node'
        ? '节点函数：当前模式下所有节点类型的真实公式、源码与参数。'
        : '连接函数：当前模式下所有连接类型的真实公式、源码与参数。';
    host.appendChild(intro);

    const picker = div('spec-picker');
    const select = el('select');
    select.dataset.role = 'spec-kind';
    const group = el('optgroup');
    group.label = fnRole === 'edge' ? '连接传递' : '节点计算';
    for (const item of roleList || []) {
      const option = el('option', null, `${item.label} · ${item.kind}`);
      option.value = `${fnRole}:${item.kind}`;
      if (item.kind === spec?.kind) option.selected = true;
      group.appendChild(option);
    }
    select.appendChild(group);
    select.addEventListener('change', () => {
      const [role, kind] = String(select.value).split(':');
      state.specRole = role === 'edge' ? 'edge' : 'node';
      state.specKind = kind || '';
      renderSpecPane();
    });
    picker.appendChild(select);
    host.appendChild(picker);

    if (!spec) {
      host.appendChild(div('help', '当前模式还没有可用的规格定义。'));
      ui.specPane.replaceChildren(host);
      return;
    }

    state.specRole = fnRole;
    state.specKind = spec.kind;

    const head = div('insp-head');
    const title = div('insp-title');
    title.appendChild(el('h2', null, spec.label || spec.kind));
    title.appendChild(el('p', null, `${spec.kind} · ${spec.description || '无说明'}`));
    head.append(title, specBadges(spec));
    host.appendChild(head);

    const formulaText = String(spec.formula || '').trim() || '（该规格没有登记公式）';
    const formulaPre = el('pre', 'spec-formula', formulaText);
    host.appendChild(section('公式', '注册表中登记的计算式', formulaPre));

    host.appendChild(section('参数', `${(spec.params || []).length} 个可调项`, paramTable(spec)));

    if (spec.outputs && spec.outputs.length) {
      host.appendChild(section('输出字段', spec.outputs.join(' / ')));
    }

    const sourceHead = div('spec-source-meta');
    sourceHead.appendChild(el('code', null, spec.source_path || '源码路径不可用'));
    if (spec.source) {
      const lineCount = String(spec.source).split('\n').length;
      sourceHead.appendChild(el('span', 'spec-key', `${lineCount} 行`));
    }
    host.appendChild(section('源码', 'inspect 读取的真实实现', sourceHead, sourceBlock((spec.source as string))));

    if (!spec.builtin) {
      const note = div('help', '这是用户扩展提供的实现：代码在服务端本进程执行，不是沙箱。');
      note.style.marginTop = '10px';
      host.appendChild(note);
    }

    ui.specPane.replaceChildren(host);
  }

export function scheduleSpecRender() {
    const tab = activeTab();
    if (tab === 'spec' || tab === 'node-fn' || tab === 'edge-fn') renderSpecPane();
  }

export function applyExtensionResult(box: HTMLElement) {
    const saved = state.ext.result as ExtResultRec | null;
    if (!box || !saved) return;
    box.className = `ext-result ${saved.kind}`;
    box.replaceChildren();
    box.appendChild(div('ext-result-main', saved.message || ''));
    if (saved.detail) {
      const pre = el('pre', 'ext-result-detail');
      pre.textContent = typeof saved.detail === 'string' ? saved.detail : JSON.stringify(saved.detail, null, 2);
      box.appendChild(pre);
    }
  }

export function showExtensionResult(kind: string, message: string, detail?: unknown) {
    state.ext.result = { kind, message: message || '', detail };
    const box = ui.extPane?.querySelector('[data-role="ext-result"]');
    if (!box) {
      if (message) toast(message, kind === 'error' ? 'error' : kind === 'ok' ? 'ok' : 'info', 6000);
      return;
    }
    applyExtensionResult((box as HTMLElement));
  }

  export async function refreshExtensions() {
    try {
      const payload = await api('/api/extensions');
      state.ext.list = Array.isArray(payload.extensions) ? payload.extensions : [];
      state.ext.scan = Array.isArray(payload.scan?.files) ? payload.scan.files : [];
      state.ext.notice = String(payload.notice || '');
      renderExtensionPanel();
      return payload;
    } catch (error) {
      showExtensionResult('error', `读取扩展列表失败：${(error as Error).message}`);
      return null;
    }
  }

export function extensionEditorCode() {
    const area = ui.extPane?.querySelector('[data-role="ext-code"]');
    return area ? (area as HTMLInputElement).value : state.ext.code;
  }

  async function validateExtension() {
    const code = extensionEditorCode();
    try {
      const result = await api('/api/extensions/validate', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      const declared = Array.isArray(result.declared) ? result.declared : [];
      showExtensionResult(
        'ok',
        declared.length
          ? `校验通过：声明了 ${declared.length} 个 kind（${declared.map((item: DeclaredItemRec) => item.kind || item.function).join('、')}）`
          : '校验通过：没有检测到 node/method 声明，启用后不会注册任何东西。',
        declared,
      );
    } catch (error) {
      showExtensionResult('error', (error as Error).message);
    }
  }

  async function activateExtension() {
    const code = extensionEditorCode();
    const filenameInput = ui.extPane?.querySelector('[data-role="ext-filename"]');
    const filename = filenameInput ? (filenameInput as HTMLInputElement).value.trim() : '';
    const confirmed = await confirmModal(
      '启用这段 Python 扩展？',
      '扩展会在后端本进程以完整 Python 权限执行，这不是沙箱。只启用你自己写的或来源可信的代码。',
      '启用',
      true,
    );
    if (!confirmed) return;
    try {
      const result = await api('/api/extensions/activate', {
        method: 'POST',
        body: JSON.stringify({ code, filename, persist: true }),
      });
      if (result?.catalog) state.catalog = result.catalog;
      showExtensionResult('ok', `已启用：${(result.kinds || []).join('、') || '（无 kind）'}`, result.kinds || []);
      toast('扩展已启用', 'ok', 3000);
      await refreshExtensions();
      renderSpecPane();
      if (state.selection.type) callRenderInspector();
      return result;
    } catch (error) {
      showExtensionResult('error', `启用失败：${(error as Error).message}`);
      return null;
    }
  }

  async function deactivateExtension(kind: string) {
    const confirmed = await confirmModal(
      `停用扩展 ${kind}？`,
      '停用后该 kind 会从注册表移除；如果当前场景里还有节点/连接在用它，需要先删除。',
      '停用',
      true,
    );
    if (!confirmed) return;
    try {
      const result = await api('/api/extensions/deactivate', {
        method: 'POST',
        body: JSON.stringify({ kind, remove_file: false }),
      });
      if (result?.catalog) state.catalog = result.catalog;
      toast(`已停用 ${kind}`, 'ok', 3000);
      await refreshExtensions();
      renderSpecPane();
      if (state.selection.type) callRenderInspector();
    } catch (error) {
      showExtensionResult('error', `停用失败：${(error as Error).message}`);
    }
  }

export function loadExtensionIntoEditor(kind: string, code: string) {
    state.ext.code = String(code || '');
    const area = ui.extPane?.querySelector('[data-role="ext-code"]');
    if (area) (area as HTMLInputElement).value = state.ext.code;
    const nameInput = ui.extPane?.querySelector('[data-role="ext-filename"]');
    if (nameInput) (nameInput as HTMLInputElement).value = String(kind || '').replace(/[^\w.-]+/g, '_');
    showExtensionResult('info', `已载入 ${kind} 的源码到编辑器`);
  }

  const EXTENSION_TEMPLATE = [
    '@node(',
    '    kind="user.rate_limiter",',
    '    label="速率限制",',
    '    group="自定义",',
    '    description="限制每步输出变化量，按步长逼近输入",',
    '    outputs=("y",),',
    '    formula="y[k] = y[k-1] + clamp(Σu − y[k-1], ±rate)",',
    '    params=(Param("rate", "每步最大变化", "float", 1.0, unit="V", min=0.0),),',
    ')',
    '# 被装饰函数本身就是 handler：直接收 ComputeContext，参数在 ctx.params 里。',
    'def rate_limiter(ctx):',
    '    rate = float(ctx.params.get("rate", 1.0))',
    '    total = 0.0',
    '    for payload in ctx.inputs.values():',
    '        total += float(payload.get("voltage", 0.0))',
    '    previous = float(ctx.data.get("y", 0.0))',
    '    delta = total - previous',
    '    if delta > rate:',
    '        delta = rate',
    '    elif delta < -rate:',
    '        delta = -rate',
    '    return {"y": previous + delta}',
    '',
  ].join('\n');

export function renderExtensionPanel() {
    if (!ui.extPane) return;
    const host = div('ext-host');

    const notice = div('help ext-notice');
    notice.textContent =
      state.ext.notice || '扩展代码在服务端本进程执行，不是沙箱。只启用来源可信的代码；项目内嵌代码默认不执行。';
    host.appendChild(notice);

    const toolbar = div('ext-toolbar');
    toolbar.append(
      button('新建模板', 'btn tiny', () => {
        state.ext.code = EXTENSION_TEMPLATE;
        const area = ui.extPane.querySelector('[data-role="ext-code"]');
        if (area) (area as HTMLInputElement).value = state.ext.code;
        showExtensionResult('info', '已填入最小可运行模板，改完点「校验」再「启用」。');
      }),
      button('校验', 'btn tiny', () => void validateExtension()),
      button('启用', 'btn tiny primary', () => void activateExtension()),
      button('刷新', 'btn tiny', () => void refreshExtensions()),
    );
    host.appendChild(toolbar);

    const filenameField = div('field');
    const filenameLabel = el('label');
    filenameLabel.appendChild(el('span', null, '文件名（可选）'));
    filenameLabel.appendChild(el('em', null, '持久化到 extensions/nodes|methods'));
    const filename = el('input');
    filename.type = 'text';
    filename.placeholder = 'user_rate_limiter.py';
    filename.dataset.role = 'ext-filename';
    filenameField.append(filenameLabel, filename);
    host.appendChild(filenameField);

    const area = el('textarea', 'ext-code');
    area.dataset.role = 'ext-code';
    area.spellcheck = false;
    area.rows = 16;
    area.value = state.ext.code || '';
    area.addEventListener('input', () => {
      state.ext.code = area.value;
    });
    host.appendChild(area);

    const result = div('ext-result hidden');
    result.dataset.role = 'ext-result';
    host.appendChild(result);
    applyExtensionResult(result);

    if (state.ext.list === null) {
      host.appendChild(div('help', '正在读取扩展列表…'));
      ui.extPane.replaceChildren(host);
      void refreshExtensions();
      return;
    }

    const listBlock = div('ext-list');
    listBlock.dataset.role = 'ext-list';
    if (!(state.ext.list as ExtItemRec[]).length) {
      listBlock.appendChild(div('help', '当前没有已启用的用户扩展。'));
    }
    for (const item of (state.ext.list as ExtItemRec[])) {
      const card = div('ext-item');
      const top = div('ext-item-head');
      top.appendChild(el('b', null, item.label || item.kind));
      top.appendChild(el('span', 'badge violet', item.type === 'method' ? '连接' : '节点'));
      top.appendChild(el('code', 'ext-kind', item.kind));
      card.appendChild(top);
      const meta = div('help');
      meta.textContent = [
        item.filename ? `文件 ${item.filename}` : '',
        item.sha256 ? `sha256 ${String(item.sha256).slice(0, 12)}` : '',
        Array.isArray(item.params) && item.params.length ? `${item.params.length} 个参数` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      card.appendChild(meta);
      const actions = div('ext-item-actions');
      actions.appendChild(
        button('载入编辑器', 'btn tiny', () => loadExtensionIntoEditor((item.kind as string), (item.source as string))),
      );
      actions.appendChild(button('停用', 'btn tiny danger', () => void deactivateExtension((item.kind as string))));
      card.appendChild(actions);
      listBlock.appendChild(card);
    }
    host.appendChild(section('已启用的扩展', `${(state.ext.list as ExtItemRec[]).length} 个`, listBlock));

    const scanned = (Array.isArray(state.ext.scan) ? state.ext.scan : []) as ExtItemRec[];
    if (scanned.length) {
      const scanBlock = div('ext-list');
      for (const item of scanned) {
        const card = div('ext-item');
        const top = div('ext-item-head');
        top.appendChild(el('b', null, item.filename || item.kind || '未命名'));
        card.appendChild(top);
        if (item.error) {
          card.appendChild(div('help', `扫描失败：${item.error}`));
        } else {
          const actions = div('ext-item-actions');
          actions.appendChild(
            button('载入编辑器', 'btn tiny', () => loadExtensionIntoEditor((item.filename || '') as string, (item.code || '') as string)),
          );
          card.appendChild(actions);
        }
        scanBlock.appendChild(card);
      }
      host.appendChild(section('扩展目录中未启用的文件', `${scanned.length} 个`, scanBlock));
    }

    ui.extPane.replaceChildren(host);
  }
