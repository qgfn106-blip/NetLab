import { state, ui } from './state.js';
import { section } from './inspector_shell.js';
import { div, button, el } from './ui.js';
import { numberInput, fieldFor } from './ui_helpers.js';
import { trimNumber } from './fields.js';
import { modeLabel } from './model.js';
import { fmt } from '../app.utils.js';
import { markProjectDirty, updateProjectPanel, saveProject, openProject, recoverAutosave, AUTOSAVE_ENABLED_KEY, setProjectFileInput, importProjectText } from './project.js';
import { toast, desktopBridge, callBridge } from './desktop.js';
import { requestDraw } from './canvas_render.js';
import { normaliseAngleSet } from './grid_prefs.js';
import { C } from './colors.js';
import { $$, $ } from './dom.js';
import type { SimStats } from './types.js';
import { jsonRequest, api } from './net.js';
import type { ApiOptions } from './net.js';
import { openConfirmModal as confirmModal } from './dialogs_build.js';
import type { ExportDestination, ExportStyle, ExportChoice } from './export_dialog.js';
import { openExportDialog } from './export_dialog.js';
import { MAX_IMPORT_BYTES } from './constants.js';
import { updateScenePanelValues, applySimConfig } from './scene_panel.js';
import type { ScenePanelDeps } from './scene_panel.js';

let deps: ScenePanelDeps;
export function initSceneActions(d: ScenePanelDeps): void { deps = d; }

  export function renderScenePanel() {
    const pane = ui.scenePane;
    if (!pane) return;
    pane.replaceChildren();
    pane.dataset.ready = '1';

    const modes = state.catalog?.modes || [
      { value: 'signal', label: '信号流' },
      { value: 'circuit', label: '电路' },
    ];
    const modeSection = section('工作模式', '切换会重建空白场景');
    const segmented = div('segmented');
    segmented.dataset.role = 'mode';
    for (const item of (modes as Array<{ value: string; label: string; description?: string }>)) {
      const btn = button(item.label, '', () => void switchMode(item.value));
      btn.dataset.mode = item.value;
      btn.classList.toggle('active', item.value === state.mode);
      btn.title = item.description || '';
      segmented.appendChild(btn);
    }
    modeSection.appendChild(segmented);
    modeSection.appendChild(div('help', '信号流按拓扑顺序传播字典数据；电路用节点电压法求解；矢量模式提供非线性动态源、二维矢量连接与相图。'));
    pane.appendChild(modeSection);

    const simSection = section('仿真节奏', '修改后自动应用');
    const simGrid = div('inline-fields');
    const fpsInput = numberInput(30, { min: 1, max: 240, step: 1 });
    fpsInput.dataset.sim = 'fps';
    const stepsInput = numberInput(1, { min: 1, max: 200, step: 1 });
    stepsInput.dataset.sim = 'steps';
    const dtInput = numberInput(0.01, { min: 0.000000001, max: 10, step: 'a' + 'ny' });
    dtInput.dataset.sim = 'dt';
    const sampleInput = numberInput(1, { min: 1, max: 100, step: 1 });
    sampleInput.dataset.sim = 'sample';
    simGrid.append(
      fieldFor('帧率', 'fps', fpsInput),
      fieldFor('每帧步数', 'steps', stepsInput),
      (() => {
        const field = fieldFor('时间步长', 's', dtInput);
        const tools = div('inline-fields');
        const stepDown = button('÷10', 'btn tiny', () => {
          dtInput.value = trimNumber(Math.max(1e-9, Number(dtInput.value) / 10));
          dtInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
        const stepUp = button('×10', 'btn tiny', () => {
          dtInput.value = trimNumber(Math.min(10, Number(dtInput.value) * 10));
          dtInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
        stepDown.title = '时间步长 ÷10（更细）';
        stepUp.title = '时间步长 ×10（更粗）';
        tools.append(stepDown, stepUp);
        field.appendChild(tools);
        return field;
      })(),
      fieldFor('采样间隔', '帧', sampleInput),
    );
    simSection.appendChild(simGrid);

    const lockRow = div('switch-row');
    lockRow.appendChild(el('span', null, '锁定 dt = 1 / (fps × 步数)'));
    const lockInput = el('input');
    lockInput.type = 'checkbox';
    lockInput.dataset.sim = 'lock';
    lockRow.appendChild(lockInput);
    simSection.appendChild(lockRow);

    const realtimeRow = div('switch-row');
    realtimeRow.appendChild(el('span', null, '实时节拍（关闭则极速迭代）'));
    const realtimeInput = el('input');
    realtimeInput.type = 'checkbox';
    realtimeInput.dataset.sim = 'realtime';
    realtimeRow.appendChild(realtimeInput);
    simSection.appendChild(realtimeRow);

    const precisionRow = div('inline-fields');
    precisionRow.appendChild(el('span', null, '时间步长预设'));
    for (const [label, value] of [['快速 1e-4', 1e-4], ['标准 1e-5', 1e-5], ['高精度 1e-6', 1e-6], ['超高 1e-7', 1e-7]]) {
      const preset = button((label as string | null | undefined), 'btn tiny', () => {
        dtInput.value = String(value);
        if (lockInput.checked) {
          lockInput.checked = false;
          dtInput.disabled = false;
        }
        void applySimConfig();
      });
      preset.dataset.dtPreset = String(value);
      preset.title = `时间步长设为 ${value} s`;
      precisionRow.appendChild(preset);
    }
    simSection.appendChild(precisionRow);
    simSection.appendChild(div('help', '时间步长越小求解越细，但每帧计算量越大；曲线分辨率还受「采样间隔」影响。'));

    const simNote = div('help');
    simNote.dataset.role = 'sim-note';
    simSection.appendChild(simNote);
    pane.appendChild(simSection);

    const solverSection = section('求解器设置', '电路模式：Newton 收敛与失败救急');
    const solverGrid = div('inline-fields');
    const solverInput = (label: string, unit: string, name: string, value: number, min: number, max: number, step: number | string) => {
      const input = numberInput(value, { min, max, step });
      input.dataset.solver = name;
      return fieldFor(label, unit, input);
    };
    solverGrid.append(
      solverInput('相对容差 reltol', '', 'reltol', 1e-9, 1e-15, 0.1, 'a' + 'ny'),
      solverInput('电压容差 vntol', 'V', 'vntol', 1e-6, 1e-15, 1, 'a' + 'ny'),
      solverInput('电流容差 abstol', 'A', 'abstol', 1e-6, 1e-15, 1, 'a' + 'ny'),
      solverInput('Newton 上限', '次', 'max_iter', 60, 1, 500, 1),
      solverInput('gmin 步数', '步', 'gmin_steps', 10, 0, 100, 1),
      solverInput('source 步数', '步', 'src_steps', 10, 0, 100, 1),
      solverInput('残差容差', '', 'residual_tol', 0, 0, 1, 'a' + 'ny'),
    );
    solverSection.appendChild(solverGrid);
    solverSection.appendChild(div('help', '残差容差 0 = 只记录不强制；失败时自动 gmin/source stepping，仍失败会报最大节点。修改后立即生效（重建电路引擎）。'));
    pane.appendChild(solverSection);

    if (state.mode !== 'circuit') {
      const algebraicSection = section('信号流代数环', '显式选择；不再静默改写拓扑');
      const algebraicRow = div('set-row');
      const algebraicLabel = el('label', null, '直接馈通求解');
      algebraicLabel.appendChild(el('em', null, '开启后环路由 solver_plan/SCC 求线性解；关闭时含环连接报错，除非显式设置单步延迟'));
      const algebraicControl = div('set-control');
      const algebraicInput = el('input');
      algebraicInput.type = 'checkbox';
      algebraicInput.dataset.role = 'algebraic';
      algebraicInput.checked = Boolean(state.scene?.solve_algebraic);
      algebraicInput.addEventListener('change', () => void changeAlgebraicSolver(algebraicInput.checked));
      algebraicControl.appendChild(algebraicInput);
      algebraicRow.append(algebraicLabel, algebraicControl);
      algebraicSection.appendChild(algebraicRow);
      pane.appendChild(algebraicSection);
    }

    const statsSection = section('网络统计', '运行时更新');
    const statsGrid = div('stat-grid');
    const statSpecs = [
      ['节点', 'nodes'], ['连接', 'edges'],
      ['步耗时', 'step'], ['实际帧率', 'fps'],
      ['矩阵', 'matrix'], ['Newton', 'iterations'],
      ['录制帧', 'frames'], ['修订', 'revision'],
    ];
    for (const [labelText, key] of statSpecs) {
      const stat = div('stat');
      stat.appendChild(el('span', null, labelText));
      const value = el('b', null, '—');
      value.dataset.stat = key;
      stat.appendChild(value);
      statsGrid.appendChild(stat);
    }
    statsSection.appendChild(statsGrid);
    pane.appendChild(statsSection);

    const integrationSection = section('积分方法', '仅电路模式');
    const integration = el('select');
    integration.dataset.role = 'integration';
    for (const item of ((state.catalog?.integration as Array<{ value: string; label: string }>) || [])) {
      const option = el('option', null, item.label || item.value);
      option.value = item.value;
      integration.appendChild(option);
    }
    integration.addEventListener('change', () => void changeIntegration(integration.value));
    integrationSection.appendChild(integration);
    const integrationNote = div('help');
    integrationNote.dataset.role = 'integration-note';
    integrationSection.appendChild(integrationNote);
    pane.appendChild(integrationSection);

    const templateSection = section('场景模板', '一键替换');
    const templateList = div('template-list');
    templateList.dataset.role = 'templates';
    for (const template of state.templates) {
      const item = el('button', 'template');
      item.type = 'button';
      const title = el('strong');
      title.append(el('span', null, template.label));
      title.append(document.createTextNode('  '));
      const modeBadge = el('span', 'tpl-mode', modeLabel((template.mode as string)));
      title.appendChild(modeBadge);
      item.appendChild(title);
      item.appendChild(el('small', null, template.description));
      if (template.sim && Object.keys(template.sim).length) {
        const bits = [];
        if (template.sim.fps) bits.push(`${template.sim.fps} fps`);
        if (template.sim.dt) bits.push(`dt ${fmt(template.sim.dt, 3)}`);
        if (template.sim.steps_per_frame) bits.push(`${template.sim.steps_per_frame} 步/帧`);
        item.appendChild(el('small', null, bits.join(' · ')));
      }
      item.addEventListener('click', () => void loadTemplate(template.name, template.label));
      templateList.appendChild(item);
    }
    if (!state.templates.length) templateList.appendChild(div('help', '模板目录不可用。'));
    templateSection.appendChild(templateList);
    pane.appendChild(templateSection);

    const projectSection = section('工程文件', '版本化 .netlab · 原子写入');
    const projectName = el('input');
    projectName.type = 'text';
    projectName.maxLength = 120;
    projectName.dataset.role = 'project-name';
    projectName.value = state.project.name || '';
    projectName.addEventListener('change', () => {
      const value = projectName.value.trim() || '未命名工程';
      if (value !== state.project.name) {
        state.project.name = value.slice(0, 120);
        markProjectDirty();
      }
      updateProjectPanel();
    });
    projectSection.appendChild(fieldFor('工程名称', '', projectName));

    const projectPath = div('project-path');
    projectPath.dataset.role = 'project-path';
    projectSection.appendChild(projectPath);

    const projectRow = div('file-row');
    projectRow.append(
      button('保存', 'btn', () => void saveProject(false)),
      button('另存为…', 'btn', () => void saveProject(true)),
      button('打开…', 'btn', () => void openProject()),
      button('恢复自动保存', 'btn', () => void recoverAutosave()),
    );
    projectSection.appendChild(projectRow);

    const autosaveRow = div('switch-row');
    autosaveRow.appendChild(
      el('span', null, `每 ${Math.round(state.project.autosaveInterval / 1000)} 秒写工程快照（只写 backups/，不动正本）`),
    );
    const autosaveToggle = el('input');
    autosaveToggle.type = 'checkbox';
    autosaveToggle.dataset.role = 'project-autosave';
    autosaveToggle.checked = Boolean(state.project.autosave);
    autosaveToggle.addEventListener('change', () => {
      state.project.autosave = Boolean(autosaveToggle.checked);
      try {
        localStorage.setItem(AUTOSAVE_ENABLED_KEY, state.project.autosave ? '1' : '0');
      } catch (error) {
        /* 忽略 */
      }
      toast(state.project.autosave ? '已开启自动保存' : '已关闭自动保存', 'info', 2000);
    });
    autosaveRow.appendChild(autosaveToggle);
    projectSection.appendChild(autosaveRow);

    const recentBox = div('recent-projects');
    recentBox.dataset.role = 'project-recent';
    projectSection.appendChild(recentBox);

    const fileInput = el('input');
    setProjectFileInput(fileInput);
    fileInput.type = 'file';
    fileInput.accept = '.netlab,application/json,.json';
    fileInput.className = 'hidden-input';
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) {
        toast('工程文件超过 8 MB，已拒绝', 'error', 6000);
        return;
      }
      void file.text().then((text: string) => importProjectText(text, ''));
    });
    projectSection.appendChild(fileInput);
    projectSection.appendChild(div('help', '工程只保存拓扑、参数、模块定义与界面偏好，不保存运行状态与录制帧。浏览器模式通过下载/上传文件保存。'));
    pane.appendChild(projectSection);

    const gridSection = section('画布与标准网格', '吸附 · 正交布线 · 整理');
    const gridRow = div('field-row');
    const snapBox = el('input');
    snapBox.type = 'checkbox';
    snapBox.checked = Boolean(state.ui.snap);
    snapBox.addEventListener('change', () => {
      state.ui.snap = Boolean(snapBox.checked);
      markProjectDirty();
      toast(state.ui.snap ? '网格吸附已开启' : '网格吸附已关闭', 'info', 1800);
    });
    const spacing = document.createElement('input');
    spacing.className = 'input';
    spacing.type = 'number';
    spacing.min = '5';
    spacing.max = '80';
    spacing.step = '1';
    spacing.value = String(Number(state.ui.grid) || 20);
    spacing.dataset.role = 'grid-spacing';
    const setSpacing = (next: number) => {
      const value = Math.max(5, Math.min(80, Math.round(next)));
      state.ui.grid = value;
      spacing.value = String(value);
      markProjectDirty();
      requestDraw();
    };
    spacing.addEventListener('change', () => setSpacing(Number(spacing.value) || 20));
    const spacingMinus = button('−', 'btn tiny', () => setSpacing((Number(state.ui.grid) || 20) - 1));
    spacingMinus.dataset.role = 'grid-spacing-minus';
    const spacingPlus = button('＋', 'btn tiny', () => setSpacing((Number(state.ui.grid) || 20) + 1));
    spacingPlus.dataset.role = 'grid-spacing-plus';
    const spacingField = div('field');
    spacingField.appendChild(el('label', null, '间距（单位）'));
    spacingField.appendChild(spacing);
    const spacingWrap = div('inline-fields');
    spacingWrap.dataset.role = 'grid-spacing-control';
    spacingWrap.append(spacingMinus, spacingField, spacingPlus);
    gridRow.append(el('label', null, '吸附'), snapBox, spacingWrap);
    gridSection.appendChild(gridRow);

    const subRow = div('field-row');
    const subInput = document.createElement('input');
    subInput.className = 'input';
    subInput.type = 'number';
    subInput.min = '1';
    subInput.max = '20';
    subInput.step = '1';
    subInput.value = String(Number(state.ui.gridSubdivisions) || 4);
    subInput.dataset.role = 'grid-subdivisions';
    subInput.addEventListener('change', () => {
      state.ui.gridSubdivisions = Math.max(1, Math.min(20, Math.round(Number(subInput.value) || 4)));
      markProjectDirty();
      requestDraw();
    });
    const showBox = document.createElement('input');
    showBox.type = 'checkbox';
    showBox.checked = state.ui.showGrid !== false;
    showBox.dataset.role = 'grid-show';
    showBox.addEventListener('change', () => { state.ui.showGrid = showBox.checked; markProjectDirty(); requestDraw(); });
    const markersBox = document.createElement('input');
    markersBox.type = 'checkbox';
    markersBox.checked = state.ui.snapMarkers !== false;
    markersBox.dataset.role = 'grid-markers';
    markersBox.addEventListener('change', () => { state.ui.snapMarkers = markersBox.checked; markProjectDirty(); requestDraw(); });
    subRow.append(el('label', null, '细分'), subInput, el('label', null, '显示网格'), showBox, el('label', null, '捕捉点'), markersBox);
    gridSection.appendChild(subRow);

    const angleRow = div('field-row');
    const angleMode = el('select', 'input');
    for (const [value, label] of [['constrained', '约束角集'], ['free', '自由角度']]) {
      const option = el('option', null, label);
      option.value = value;
      angleMode.appendChild(option);
    }
    angleMode.value = state.ui.angleMode === 'free' ? 'free' : 'constrained';
    angleMode.dataset.role = 'grid-angle-mode';
    angleMode.addEventListener('change', () => { state.ui.angleMode = angleMode.value === 'free' ? 'free' : 'constrained'; markProjectDirty(); });
    const tolerance = document.createElement('input');
    tolerance.className = 'input';
    tolerance.type = 'number';
    tolerance.min = '0.5';
    tolerance.max = '15';
    tolerance.step = '0.5';
    tolerance.value = String(Number(state.ui.angleToleranceDeg) || 3);
    tolerance.dataset.role = 'grid-angle-tolerance';
    tolerance.addEventListener('change', () => { state.ui.angleToleranceDeg = Math.max(0.5, Math.min(15, Number(tolerance.value) || 3)); markProjectDirty(); });
    angleRow.append(el('label', null, '角度模式'), angleMode, el('label', null, '吸附容差°'), tolerance);
    gridSection.appendChild(angleRow);

    const angleSetRow = div('field-row');
    angleSetRow.dataset.role = 'grid-angle-set';
    angleSetRow.appendChild(el('label', null, '允许角度'));
    const currentAngles = normaliseAngleSet(state.ui.angleSet);
    for (const angle of [0, 45, 60, 90]) {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = String(angle);
      box.checked = currentAngles.includes(angle);
      box.dataset.angle = String(angle);
      box.addEventListener('change', () => {
        const boxes = [...angleSetRow.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
        state.ui.angleSet = normaliseAngleSet(boxes.filter((item) => item.checked).map((item) => Number(item.value)));
        markProjectDirty();
      });
      angleSetRow.append(box, el('span', null, `${angle}°`));
    }
    gridSection.appendChild(angleSetRow);

    const viewRow = div('field-row');
    const originBox = document.createElement('input');
    originBox.type = 'checkbox';
    originBox.checked = state.ui.showOrigin !== false;
    originBox.dataset.role = 'grid-show-origin';
    originBox.addEventListener('change', () => { state.ui.showOrigin = originBox.checked; markProjectDirty(); requestDraw(); });
    const rulerBox = document.createElement('input');
    rulerBox.type = 'checkbox';
    rulerBox.checked = Boolean(state.ui.showRuler);
    rulerBox.dataset.role = 'grid-show-ruler';
    rulerBox.addEventListener('change', () => { state.ui.showRuler = rulerBox.checked; markProjectDirty(); requestDraw(); });
    const adaptiveBox = document.createElement('input');
    adaptiveBox.type = 'checkbox';
    adaptiveBox.checked = state.ui.adaptiveZoom !== false;
    adaptiveBox.dataset.role = 'grid-adaptive-zoom';
    adaptiveBox.addEventListener('change', () => { state.ui.adaptiveZoom = adaptiveBox.checked; markProjectDirty(); requestDraw(); });
    viewRow.append(el('label', null, '显示原点'), originBox, el('label', null, '标尺'), rulerBox, el('label', null, '缩放自适应'), adaptiveBox);
    gridSection.appendChild(viewRow);
    gridSection.appendChild(div('help', '网格默认值随工程保存；只影响新建导线和导出，不会改写已有手工折点。'));

    const styleRow = div('field-row');
    const nodeStyleSelect = el('select', 'input');
    for (const [value, label] of [['circle', '空心圆'], ['dot', '实心点'], ['box', '小方框']]) {
      const option = el('option', null, label);
      option.value = value;
      nodeStyleSelect.appendChild(option);
    }
    nodeStyleSelect.value = state.ui.nodeStyle || 'circle';
    nodeStyleSelect.addEventListener('change', () => {
      state.ui.nodeStyle = nodeStyleSelect.value;
      markProjectDirty();
      requestDraw();
    });
    const scaleSelect = el('select', 'input');
    for (const size of [0.8, 1.0, 1.2, 1.6]) {
      const option = el('option', null, `${size}×`);
      option.value = String(size);
      scaleSelect.appendChild(option);
    }
    scaleSelect.value = String(Number(state.ui.symbolScale) || 1.2);
    scaleSelect.addEventListener('change', () => {
      state.ui.symbolScale = Number(scaleSelect.value) || 1.2;
      markProjectDirty();
      requestDraw();
    });
    const colorSelect = el('select', 'input');
    for (const [value, label] of [['#1f5f5b', '青绿'], [C('#a8541f'), '暖橙'], ['#2563a8', '靛蓝']]) {
      const option = el('option', null, label);
      option.value = value;
      colorSelect.appendChild(option);
    }
    colorSelect.value = state.ui.glyphColor || '#1f5f5b';
    colorSelect.addEventListener('change', () => {
      state.ui.glyphColor = colorSelect.value;
      markProjectDirty();
      requestDraw();
    });
    styleRow.append(
      el('label', null, '节点样式'), nodeStyleSelect,
      el('label', null, '符号大小'), scaleSelect,
      el('label', null, '符号颜色'), colorSelect,
    );
    gridSection.appendChild(styleRow);
    gridSection.appendChild(
      button('整理到网格', 'btn', () => void deps.snapSceneToGrid()),
    );
    gridSection.appendChild(div('help', '元件位置由元件自身 layout 决定（可在检查器微调）；不再自动重排，避免打乱手工图。'));
    gridSection.appendChild(
      div('help', '电路模式新建连线默认正交路由；拖动/新建节点吸附到网格；按住 Alt 临时暂停吸附。整理会按当前网格对齐全部节点与手动拐点（可撤销）。'),
    );
    pane.appendChild(gridSection);
    updateProjectPanel();

    const dataSection = section('场景数据', 'JSON');
    const fileRow = div('file-row');
    fileRow.appendChild(button('导出 JSON', 'btn', () => void openExport('scene-data')));
    fileRow.appendChild(button('导出原理图 SVG', 'btn', () => void openExport('schematic')));
    fileRow.appendChild(button('导入 JSON', 'btn', () => importInput.click()));
    dataSection.appendChild(fileRow);
    const importInput = el('input');
    importInput.type = 'file';
    importInput.accept = 'application/json,.json';
    importInput.className = 'hidden-input';
    importInput.addEventListener('change', () => {
      const file = importInput.files && importInput.files[0];
      importInput.value = '';
      if (file) void importSceneFile(file);
    });
    dataSection.appendChild(importInput);
    dataSection.appendChild(div('help', '导出不含运行时状态；导入上限 2 MB，导入前会再次确认。服务端会校验节点、连接、参数与拓扑。'));
    pane.appendChild(dataSection);

    for (const input of [fpsInput, stepsInput, dtInput, sampleInput, lockInput, realtimeInput]) {
      input.addEventListener('change', () => void applySimConfig());
    }
    for (const input of $$('[data-solver]', pane)) {
      input.addEventListener('change', () => void applySimConfig());
    }
    lockInput.addEventListener('change', () => {
      dtInput.disabled = lockInput.checked;
    });

    deps.updateModeUI();
    updateScenePanelValues();
  }

  export async function switchMode(mode: string, options: ApiOptions = {}) {
    if (mode === state.mode) return;
    if (!options.skipConfirm) {
      const confirmed = await confirmModal(
        `切换到${modeLabel(mode)}模式？`,
        '切换会把当前场景替换为该模式的空白模板，节点、连接、参数与录制数据都会清空。请先导出需要保留的场景。',
        '切换',
        true,
      );
      if (!confirmed) return;
    }
    const response = await deps.task(() => jsonRequest('/api/mode', 'POST', { mode }));
    if (!response) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    state.frames = [];
    state.values.clear();
    state.nodeValues.clear();
    state.edgeValues.clear();
    deps.applySnapshot(response);
    state.cursor = Number(response.sim?.cursor) || 0;
    deps.renderInspector();
    renderScenePanel();
    deps.renderSignalList();
    await deps.fetchNetworks();
    deps.fitView();
    toast(`已切换到${modeLabel(mode)}模式`, 'ok', 2200);
  }

  export async function loadTemplate(name: string, label: string) {
    const nodeCount = state.scene?.nodes?.length || 0;
    if (nodeCount > 0) {
      const confirmed = await confirmModal(
        `载入模板「${label}」？`,
        `当前场景有 ${nodeCount} 个节点，将被模板完全替换。请先导出需要保留的场景。`,
        '载入',
        true,
      );
      if (!confirmed) return;
    }
    const response = await deps.task(() => jsonRequest(`/api/templates/${encodeURIComponent(name)}`, 'POST'));
    if (!response) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    deps.applySnapshot(response);
    state.cursor = Number(response.sim?.cursor) || 0;
    deps.renderInspector();
    renderScenePanel();
    deps.renderSignalList();
    deps.fitView();
    toast(`已载入模板：${label}`, 'ok', 2200);
  }

  export async function migrateSceneToDevices() {
    if (state.mode !== 'circuit') {
      toast('只有电路场景可以迁移为器件模型', 'error', 3500);
      return;
    }
    const confirmed = await confirmModal(
      '迁移为器件模型（R20）',
      '将把当前场景的元件边转换为「器件节点 + 引脚导线」，网络节点保留；之后工程按 v4 保存。该操作不可撤销。',
      '迁移',
      false,
    );
    if (!confirmed) return;
    const response = await deps.task(() => jsonRequest('/api/scene/migrate-devices', 'POST', {}));
    if (!response) return;
    deps.applySnapshot(response);
    const converted = Number(response.migration?.converted || 0);
    toast(`已迁移 ${converted} 个元件为器件节点`, 'ok', 3000);
    deps.fitView(true);
  }

  export async function clearScene() {
    const confirmed = await confirmModal(
      '清空当前场景？',
      '将删除所有节点与连接，并重建为空白模板。该操作不可撤销。',
      '清空',
      true,
    );
    if (!confirmed) return;
    const response = await deps.task(() => jsonRequest('/api/scene/clear', 'POST'));
    if (!response) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    deps.applySnapshot(response);
    state.cursor = Number(response.sim?.cursor) || 0;
    deps.renderInspector();
    renderScenePanel();
    deps.renderSignalList();
    deps.fitView();
    toast('场景已清空', 'ok', 2000);
  }

  async function exportScene(destination: ExportDestination = 'browser-download') {
    const payload = await deps.task(() => api('/api/scene/export?include_state=false'), { dirty: false });
    if (!payload) throw new Error('后端未返回场景数据');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `netlab-${state.mode}-${stamp}.json`;
    const text = JSON.stringify(payload, null, 2);
    if (await saveTextViaDesktop(text, fileName, destination)) return;
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('场景已交给浏览器下载', 'ok', 2400);
  }

  /**
   * 桌面模式：走原生保存对话框，由用户选文件夹，返回真实写入路径。
   * 返回 true = 已处理完（含用户取消，此时不提示成功）；false = 该走浏览器下载。
   * 显式选择桌面保存但桥不可用时抛错，避免静默降级成浏览器下载。
   */
  async function saveTextViaDesktop(
    text: string,
    defaultName: string,
    destination: ExportDestination | 'auto' = 'auto',
  ): Promise<boolean> {
    if (destination === 'browser-download') return false;
    if (!desktopBridge()) {
      if (destination === 'desktop-save-dialog') throw new Error('当前环境没有桌面保存对话框，请改用浏览器下载');
      return false;
    }
    const result = await callBridge('saveText', [defaultName, text]);
    if (result === null) {
      if (destination === 'desktop-save-dialog') throw new Error('桌面保存桥未连接');
      return false;
    }
    const path = String(result);
    if (!path) return true;
    if (path.startsWith('__error__')) {
      const message = path.slice('__error__'.length);
      if (destination === 'desktop-save-dialog') throw new Error(message);
      toast(`导出失败：${message}`, 'error', 7000);
      return true;
    }
    toast(`已导出到 ${path}`, 'ok', 6000);
    return true;
  }

  async function exportSchematic(
    destination: ExportDestination = 'browser-download',
    style: ExportStyle = 'follow-project',
  ) {
    if (state.scene?.mode !== 'circuit') {
      throw new Error('原理图导出仅支持电路模式');
    }
    const params = new URLSearchParams({
      name: state.project?.name || '',
      network: state.currentNetwork?.name || '',
    });
    if (style !== 'follow-project') params.set('style', style);
    const payload = await deps.task(
      () => jsonRequest(`/api/export/schematic?${params.toString()}`, 'GET'),
      { dirty: false },
    );
    if (!payload?.svg) throw new Error('后端未返回原理图 SVG');
    const svg = String(payload.svg);
    const fileName = String(payload.filename || 'schematic.svg');
    if (await saveTextViaDesktop(svg, fileName, destination)) return;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('原理图 SVG 已交给浏览器下载', 'ok', 2400);
  }

  async function performExport(choice: ExportChoice): Promise<void> {
    if (choice.mode === 'scene-data') {
      await exportScene(choice.destination);
      return;
    }
    await exportSchematic(choice.destination, choice.style);
  }

  export async function openExport(initialMode: 'schematic' | 'scene-data' = 'schematic'): Promise<void> {
    await openExportDialog({
      projectStyle: String(state.ui?.symbol || 'classic') === 'gb' ? 'gb' : 'classic',
      initialMode,
      desktopAvailable: Boolean(desktopBridge()),
      run: performExport,
    });
  }

  async function importSceneFile(file: File) {
    if (file.size > MAX_IMPORT_BYTES) {
      toast('场景文件超过 2 MB，已拒绝', 'error', 6000);
      return;
    }
    let payload;
    try {
      const text = await file.text();
      payload = JSON.parse(text);
    } catch (error) {
      toast(`JSON 解析失败：${(error as Error).message}`, 'error', 6000);
      return;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      toast('场景必须是 JSON 对象', 'error', 5000);
      return;
    }
    if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
      toast('场景必须包含 nodes 与 edges 数组', 'error', 5000);
      return;
    }
    const confirmed = await confirmModal(
      '导入并替换当前场景？',
      `文件包含 ${payload.nodes.length} 个节点、${payload.edges.length} 条连接。导入会清空当前场景的节点、连接与录制数据。`,
      '导入',
      true,
    );
    if (!confirmed) return;
    const response = await deps.task(() => jsonRequest('/api/scene', 'POST', payload));
    if (!response) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    state.frames = [];
    state.values.clear();
    state.nodeValues.clear();
    state.edgeValues.clear();
    deps.applySnapshot(response);
    state.cursor = Number(response.sim?.cursor) || 0;
    deps.renderInspector();
    renderScenePanel();
    deps.renderSignalList();
    deps.fitView();
    toast('场景已导入', 'ok', 2200);
  }

  async function changeIntegration(value: string) {
    if (state.mode !== 'circuit') {
      toast('积分方法只用于电路模式', 'info', 1800);
      updateScenePanelValues();
      return;
    }
    const response = await deps.task(() => jsonRequest('/api/scene', 'PATCH', { integration: value }));
    if (!response) {
      updateScenePanelValues();
      return;
    }
    deps.applySnapshot(response);
    renderScenePanel();
    toast(`积分方法已切换为 ${value === 'trapezoidal' ? '梯形法' : '后向欧拉'}`, 'ok', 2000);
  }

  async function changeAlgebraicSolver(enabled: boolean) {
    const response = await deps.task(() => jsonRequest('/api/scene/algebraic', 'PUT', { enabled }));
    if (!response) {
      updateScenePanelValues();
      return;
    }
    deps.applySnapshot(response);
    renderScenePanel();
    toast(enabled ? '已开启信号流代数环直接求解' : '已关闭代数环直接求解', 'ok', 2000);
  }

