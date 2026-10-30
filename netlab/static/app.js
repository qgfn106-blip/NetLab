/* Netlab 拓扑网络仿真台 — 前端交互脚本
 *
 * 设计约束：
 *  - 纯浏览器端 ES2020，无构建步骤、无第三方依赖；
 *  - 所有用户内容一律用 textContent / value 写入，绝不拼接 innerHTML；
 *  - 参数表单完全由 /api/catalog 的 ParamSpec 生成，前后端共用一套校验语义；
 *  - 画布使用 devicePixelRatio 缩放，交互命中测试在屏幕坐标中完成；
 *  - 仿真数据只通过 JSON 与后端交换，页面内不执行任何用户代码。
 */
(() => {
  'use strict';

  /* ======================================================================
   * 0. 常量与小工具
   * ==================================================================== */

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const PALETTE = [
    '#a8541f', '#1f5f5b', '#2a2621', '#7b8c3a', '#8a4a7c',
    '#b08a3e', '#4a6f8a', '#8e2f24', '#5f6b52', '#7a4a2a',
  ];
  const GROUP_COLORS = {
    '基础': '#1f5f5b',
    '动态': '#4f6b40',
    '高级': '#8a4a7c',
    '信号': '#a8541f',
    '电路': '#9a6a1c',
    '矢量': '#a8541f',
    '数学': '#4a6f8a',
  };
  const NODE_RADIUS = 46;
  const NODE_W = NODE_RADIUS * 2;
  const NODE_H = NODE_RADIUS * 2;
  const CHART_KEYS = 8;
  const MAX_IMPORT_BYTES = 2_000_000;
  const MAX_FRAMES = 5000;

  const stage = $('#stage');
  const canvas = $('#graph');
  const ctx = canvas.getContext('2d');
  const chartCanvas = $('#chart');
  const chartCtx = chartCanvas.getContext('2d');
  const femCanvas = $('#femCanvas');
  const femCtx = femCanvas.getContext('2d');
  const phaseCanvas = $('#phase');
  const phaseCtx = phaseCanvas.getContext('2d');
  const scopeCanvas = $('#scope');
  const scopeCtx = scopeCanvas?.getContext('2d');
  const lissCanvas = $('#lissajous');
  const lissCtx = lissCanvas?.getContext('2d');
  const INST_COLORS = ['#c2542f', '#2f6f9e', '#7a5aa8', '#3f8f6b'];

  const ui = {
    main: $('main'),
    panel: $('#panel'),
    graph: $('#graph'),
    modePill: $('#modePill'),
    runBtn: $('#btnRun'),
    runIcon: $('#runIcon'),
    runLabel: $('#runLabel'),
    simTime: $('#simTime'),
    simFps: $('#simFps'),
    simSteps: $('#simSteps'),
    statusMode: $('#statusMode'),
    statusEngine: $('#statusEngine'),
    statusHint: $('#statusHint'),
    statusCursor: $('#statusCursor'),
    statusLimits: $('#statusLimits'),
    errorBanner: $('#errorBanner'),
    zoomBadge: $('#zoomBadge'),
    addMenu: $('#addMenu'),
    linkMenu: $('#linkMenu'),
    modal: $('#modal'),
    modalCard: $('#modalCard'),
    toasts: $('#toasts'),
    inspector: $('#tab-inspect'),
    specPane: $('#tab-spec'),
    extPane: $('#tab-ext'),
    blocksPane: $('#tab-blocks'),
    analysisPane: $('#tab-analysis'),
    chartPane: $('#tab-chart'),
    instPane: $('#tab-inst'),
    instWindow: $('#instWindow'),
    instStatus: $('#instStatus'),
    instMeterKey: $('#instMeterKey'),
    instValNow: $('#instValNow'),
    instValMean: $('#instValMean'),
    instValRms: $('#instValRms'),
    instValPP: $('#instValPP'),
    instValMinMax: $('#instValMinMax'),
    instLegend: $('#instLegend'),
    instLX: $('#instLX'),
    instLY: $('#instLY'),
    instTrail: $('#instTrail'),
    instCh: ['#instCh1', '#instCh2', '#instCh3', '#instCh4'].map((sel) => $(sel)),
    scenePane: $('#settingsScene'),
    settingsScene: $('#settingsScene'),
    settingsWin: $('#settingsWin'),
    settingsClose: $('#setWinClose'),
    guide: $('#guide'),
    guideNever: $('#guideNever'),
    guideEnter: $('#guideEnter'),
    guideDocs: $('#guideDocs'),
    guideDemo: $('#guideDemo'),
    guideClose: $('#guideClose'),
    docWin: $('#docWin'),
    moduleWin: $('#moduleWin'),
    moduleWinTitle: $('#moduleWinTitle'),
    moduleWinHint: $('#moduleWinHint'),
    modulePorts: $('#modulePorts'),
    moduleMeta: $('#moduleMeta'),
    moduleStage: document.querySelector('#moduleWin .modwin-stage'),
    moduleCanvas: $('#moduleCanvas'),
    moduleEmpty: $('#moduleEmpty'),
    moduleDock: $('#moduleDock'),
    moduleWinClose: $('#moduleWinClose'),
    moduleEdit: $('#moduleEdit'),
    moduleAddInstance: $('#moduleAddInstance'),
    docNav: $('#docNav'),
    docMain: $('#docMain'),
    docContent: $('#docContent'),
    docSearch: $('#docSearch'),
    docResults: $('#docResults'),
    docTitle: $('#docWinTitle'),
    qcard: $('#qcard'),
    signalList: $('#signalList'),
    legend: $('#legend'),
    chartWindow: $('#chartWindow'),
    chartTimeline: $('#chartTimeline'),
    chartReplayTime: $('#chartReplayTime'),
    topTimeline: $('#topTimeline'),
    topTimelineTime: $('#topTimelineTime'),
    btnReplay: $('#btnReplay'),
    replaySpeed: $('#replaySpeed'),
    replaySpeedVal: $('#replaySpeedVal'),
    btnPrecompute: $('#btnPrecompute'),
    chartLoop: $('#chartLoop'),
    btnLive: $('#btnLive'),
    btnResolve: $('#btnResolve'),
    chartStatus: $('#chartStatus'),
    signalSearch: $('#signalSearch'),
    btnClearChart: $('#btnClearChart'),
    vectorPane: $('#tab-vector'),
    femPane: $('#tab-fem'),
    femPanel: $('#femPanel'),
    femStage: $('#femStage'),
    femHudProbe: $('#femHudProbe'),
    phaseCanvas,
    phaseReadout: $('#phaseReadout'),
    vectorNode: $('#vectorNode'),
    vectorTrail: $('#vectorTrail'),
    workspaceSwitch: $('#workspaceSwitch'),
    sessionClock: $('#sessionClock'),
    exitBtn: $('#btnExit'),
    menuItems: $('#menuItems'),
    infoBar: $('#infoBar'),
    networks: $('#networks'),
    networkList: $('#networkList'),
    netAdd: $('#btnNetAdd'),
    netRename: $('#btnNetRename'),
    netDelete: $('#btnNetDelete'),
    netResize: $('#netResize'),
    netHanger: $('#netHanger'),
    panelHanger: $('#panelHanger'),
    panelResize: $('#panelResize'),
    guideOpenProject: $('#guideOpenProject'),
    guideSettings: $('#guideSettings'),
  };

  const state = {
    catalog: null,
    templates: [],
    mode: 'signal',
    scene: null,
    sim: null,
    limits: null,
    selection: { type: null, id: null },
    inspectorId: null,
    inspectorDirty: false,
    hover: null,
    view: { x: 0, y: 0, k: 1 },
    canvasSize: { w: 1, h: 1, dpr: 1 },
    chartSize: { w: 1, h: 1, dpr: 1 },
    pointer: { x: 0, y: 0, wx: 0, wy: 0 },
    drag: null,
    needsDraw: true,
    lastPaint: 0,
    busy: false,
    liveBusy: false,
    stateBusy: false,
    cursor: 0,
    frames: [],
    values: new Map(),
    nodeValues: new Map(),
    edgeValues: new Map(),
    probeKeys: [],
    probeSignature: '',
    chart: {
      selected: new Set(),
      window: 5,
      filter: '',
      colors: new Map(),
      loop: false,
    },
    instrument: {
      meterKey: '',
      channels: [null, null, null, null],
      lx: '',
      ly: '',
      trail: 600,
      window: 5,
      scopeSize: { w: 1, h: 1, dpr: 1 },
      lissSize: { w: 1, h: 1, dpr: 1 },
    },
    replay: {
      active: false,
      playing: false,
      index: 0,
      timer: 0,
      speed: 60,
      recordingRevision: null,
    },
    pollTimer: 0,
    chartTimer: 0,
    stateTimer: 0,
    lastStateFetch: 0,
    dismissedError: null,
    dirtyPositions: new Map(),
    positionTimer: 0,
    booted: false,
    selectionBusy: false,
    specRole: 'node',
    fnRole: 'node',
    networks: [],
    currentNetwork: null,
    blocks: [],
    blocksLibrary: '',
    blocksStructural: false,
    analysisLast: '',
    analysisSpectrum: null,
    degradedBanner: false,
    ui: {
      snap: true,
      grid: 20,
      symbol: 'classic',
      showGrid: true,
      snapMarkers: true,
      circuitOrthogonal: true,
      nodeStyle: 'circle',
      symbolScale: 1.2,
      glyphColor: '#1f5f5b',
      drawingMode: false,
    },
    // R30：外观偏好、文档与引导状态
    prefs: { theme: 'light', motion: 'low', perf: 'perf', accent: '', guide: 'always', infobar: true },
    palette: null,
    settings: null,
    docs: [],
    docSlug: '',
    docGeo: null,
    plotkitGeo: null,
    plotkitDock: false,
    settingsGeo: null,
    moduleGeo: null,
    moduleBlock: null,
    moduleDock: false,
    guideMode: 'signal',
    guideShown: false,
    uiReady: false,
    multi: { nodes: new Set(), edges: new Set() },
    undoStack: [],
    redoStack: [],
    clipboard: null,
    specKind: '',
    ext: { list: null, scan: [], notice: '', code: '', result: null },
    lastLiveError: 0,
    workspace: 'network',
    fem: null,
    femMesh: null,
    femMeshRevision: 0,
    femCursor: 0,
    femFrames: [],
    femBusy: false,
    femSize: { w: 1, h: 1, dpr: 1 },
    femHover: null,
    femStarted: false,
    femPanelReady: false,
    phaseSize: { w: 1, h: 1, dpr: 1 },
    phaseNode: '',
    phaseTrail: 900,
    phaseTimer: 0,
    shuttingDown: false,
    project: {
      name: '未命名工程',
      path: '',
      dirty: false,
      autosave: true,
      autosaveInterval: 60000,
      autosavedAt: 0,
      recent: [],
      desktop: false,
    },
  };

  // 浏览器模式的工程文件选择器（桌面模式走原生对话框）。
  let projectFileInput = null;

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function div(cls, text) {
    return el('div', cls, text);
  }

  function button(label, cls, onClick) {
    const node = el('button', cls || 'btn', label);
    node.type = 'button';
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }

  function fmt(value, digits = 4) {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number)) return '—';
    const magnitude = Math.abs(number);
    if (magnitude !== 0 && (magnitude >= 1e5 || magnitude < 1e-3)) {
      return number.toExponential(3);
    }
    let text = number.toFixed(digits);
    if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
    return text === '-0' ? '0' : text;
  }

  function intText(value) {
    const number = Number(value);
    return Number.isFinite(number) ? String(Math.round(number)) : '0';
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function hashString(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function colorForKey(key) {
    if (!state.chart.colors.has(key)) {
      state.chart.colors.set(key, CHART_PALETTE[hashString(key) % CHART_PALETTE.length]);
    }
    return C(state.chart.colors.get(key));
  }

  function activeTab() {
    const group = $('.panel-group.active')?.dataset.group || 'inspect';
    if (group === 'fn') return state.fnRole === 'edge' ? 'edge-fn' : 'node-fn';
    if (group === 'analysis' || group === 'modules') {
      const sub = $('.panel-group.active .group-subnav [data-sub].active');
      return sub ? sub.dataset.sub : (group === 'modules' ? 'blocks' : 'chart');
    }
    if (group === 'fem') return 'fem';
    return 'inspect';
  }

  function modeLabel(mode) {
    if (mode === 'circuit') return '电路';
    if (mode === 'vector') return '矢量';
    return '信号流';
  }

  function selectedNode() {
    return state.selection.type === 'node' ? nodeById(state.selection.id) : null;
  }

  function selectedEdge() {
    return state.selection.type === 'edge' ? edgeById(state.selection.id) : null;
  }

  function nodeById(id) {
    return state.scene?.nodes?.find((node) => node.id === id) || null;
  }

  function edgeById(id) {
    return state.scene?.edges?.find((edge) => edge.id === id) || null;
  }

  function nodeByName(name) {
    return state.scene?.nodes?.find((node) => node.name === name) || null;
  }

  function edgeByName(name) {
    return state.scene?.edges?.find((edge) => edge.name === name) || null;
  }

  function getNodeSpec(kind) {
    if (!state.catalog) return null;
    const list = state.mode === 'circuit' ? state.catalog.circuit_nodes : state.catalog.computes;
    return (list || []).find((spec) => spec.kind === kind) || null;
  }

  function getEdgeSpec(kind) {
    if (!state.catalog) return null;
    const list = state.mode === 'circuit' ? state.catalog.elements : state.catalog.methods;
    return (list || []).find((spec) => spec.kind === kind) || null;
  }

  function specDefaults(spec) {
    const result = {};
    if (!spec || !Array.isArray(spec.params)) return result;
    for (const param of spec.params) {
      result[param.key] = clone(param.default);
    }
    return result;
  }

  function uniqueNodeName(base) {
    const names = new Set((state.scene?.nodes || []).map((node) => node.name));
    let index = 1;
    let candidate = `${base}${index}`;
    while (names.has(candidate)) {
      index += 1;
      candidate = `${base}${index}`;
    }
    return candidate.slice(0, 32);
  }

  function hasGroundNode() {
    return (state.scene?.nodes || []).some((node) => node.kind === 'ground');
  }

  function isFormTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON';
  }

  /* ======================================================================
   * 0. 桌面模式会话
   * ==================================================================== */

  // 桌面外壳通过 ?token= 传入会话 token；读取后立刻从地址栏移除。
  const DESKTOP_TOKEN = (() => {    try {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token') || '';
      if (token) {
        params.delete('token');
        const query = params.toString();
        window.history.replaceState(
          {},
          '',
          `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
        );
      }
      return token;
    } catch (error) {
      return '';
    }
  })();

  function desktopBridge() {
    return window.netlabDesktop || null;
  }

  function isDesktop() {
    return Boolean(desktopBridge());
  }

  function callBridge(method, args = []) {
    const bridge = desktopBridge();
    if (!bridge || typeof bridge[method] !== 'function') return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        bridge[method](...args, (result) => resolve(result));
      } catch (error) {
        toast(`桌面桥调用失败（${method}）：${error?.message || error}`, 'error', 6000);
        resolve(null);
      }
    });
  }

  function baseName(path) {
    const text = String(path || '').replace(/[\\/]+$/, '');
    const cut = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
    return cut >= 0 ? text.slice(cut + 1) : text;
  }

  /* ======================================================================
   * 1. 网络请求与提示
   * ==================================================================== */

  async function api(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs) || 15000);
    const headers = { 'Content-Type': 'application/json' };
    if (DESKTOP_TOKEN) headers['X-Netlab-Token'] = DESKTOP_TOKEN;
    const config = {
      headers,
      signal: controller.signal,
      ...options,
    };
    if (options.headers) config.headers = { ...headers, ...options.headers };
    try {
      const response = await fetch(path, config);
      const text = await response.text();
      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch (error) {
          throw new Error(`服务器返回了无法解析的数据（HTTP ${response.status}）`);
        }
      }
      if (!response.ok) {
        let detail = payload && payload.detail;
        if (detail && typeof detail !== 'string') detail = JSON.stringify(detail);
        if (response.status === 403 && /token/i.test(String(detail || ''))) {
          throw new Error('桌面会话 token 无效：请从桌面窗口重新打开页面');
        }
        throw new Error(detail || `请求失败（HTTP ${response.status}）`);
      }
      return payload;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('请求超时：后端可能未启动或计算阻塞（15 秒）');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function jsonRequest(path, method, body) {
    return api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  function toast(message, type = 'info', timeout = 4200) {
    const node = div(`toast ${type}`, message);
    ui.toasts.appendChild(node);
    while (ui.toasts.children.length > 4) ui.toasts.firstChild.remove();
    setTimeout(() => {
      node.style.opacity = '0';
      node.style.transform = 'translateY(4px)';
      node.style.transition = 'opacity .2s, transform .2s';
      setTimeout(() => node.remove(), 220);
    }, timeout);
    return node;
  }

  function showBanner(message) {
    const text = String(message || '').trim();
    if (!text) return;
    ui.errorBanner.replaceChildren();
    const icon = el('span', null, '⚠');
    const body = el('span', null, text);
    body.style.flex = '1';
    const close = el('button', null, '×');
    close.type = 'button';
    close.title = '关闭提示';
    close.addEventListener('click', () => {
      state.dismissedError = text;
      ui.errorBanner.classList.add('hidden');
    });
    ui.errorBanner.append(icon, body, close);
    ui.errorBanner.classList.remove('hidden');
  }

  function hideBanner() {
    ui.errorBanner.classList.add('hidden');
  }

  async function task(run, options = {}) {
    if (state.busy) {
      toast('上一条操作还在处理中，请稍候…', 'info', 1500);
      return null;
    }
    state.busy = true;
    try {
      if (options.dirty !== false && options.history !== false) await pushUndoSnapshot();
      const result = await run();
      // 默认把成功的写操作标记为"工程已修改"；运行/暂停等控制操作显式跳过。
      if (options.dirty !== false) markProjectDirty();
      return result;
    } catch (error) {
      const message = error?.message || String(error);
      if (!options.silent) toast(message, 'error', 7000);
      if (/电路|代数环|接地|引擎|求逆|奇异|发散|未收敛|有限元/.test(message)) showBanner(message);
      return null;
    } finally {
      state.busy = false;
    }
  }

  /* ======================================================================
   * 2. 快照同步与全局 UI
   * ==================================================================== */

  function applySnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.scene) return;
    const sim = snapshot.sim || state.sim;
    const previousCursor = state.cursor;
    const resetFrames = !state.sim || (sim && sim.steps === 0 && sim.time === 0);

    state.scene = snapshot.scene;
    state.sim = sim;
    if (snapshot.limits) state.limits = snapshot.limits;
    state.mode = state.scene.mode || state.mode;

    if (resetFrames || (sim && Number(sim.cursor) < previousCursor)) {
      state.frames = [];
      state.values.clear();
      state.nodeValues.clear();
      state.edgeValues.clear();
      state.cursor = Number(sim?.cursor) || 0;
      scheduleChartDraw();
    }

    if (state.selection.type && !lookupSelection()) {
      clearSelection();
    }
    // 场景被换掉/节点被删后，多选集合里的旧 id 要清掉，否则「封装选中」
    // 会拿着一批已经不存在的节点去请求，后端只能报「节点不存在」。
    const liveNodes = new Set((state.scene?.nodes || []).map((node) => node.id));
    const liveEdges = new Set((state.scene?.edges || []).map((edge) => edge.id));
    let staleSelection = false;
    for (const id of [...(state.multi?.nodes || [])]) {
      if (!liveNodes.has(id)) {
        state.multi.nodes.delete(id);
        staleSelection = true;
      }
    }
    for (const id of [...(state.multi?.edges || [])]) {
      if (!liveEdges.has(id)) {
        state.multi.edges.delete(id);
        staleSelection = true;
      }
    }
    if (staleSelection) requestDraw();
    updateModeUI();
    syncUI();
    updateInfoBar();
    const degraded = sim && sim.degraded;
    if (degraded && degraded.read_only) {
      const missing = (degraded.missing || []).map((item) => `${item.id}@v${item.version}`).join('、');
      showBanner(`降级只读：${degraded.message}${missing ? `（缺失：${missing}）` : ''}`);
      state.degradedBanner = true;
    } else if (state.degradedBanner) {
      state.degradedBanner = false;
      hideBanner();
    }
    updateScenePanelValues();
    updateSignalKeyCache();
    requestDraw();
    updateInspectorLive();
    renderVectorNodeList();
    schedulePhaseDraw();
  }

  function lookupSelection() {
    if (state.selection.type === 'node') return nodeById(state.selection.id);
    if (state.selection.type === 'edge') return edgeById(state.selection.id);
    return null;
  }

  function syncUI() {
    if (state.workspace === 'fem') {
      syncFemChrome();
      return;
    }
    const sim = state.sim;
    if (!sim) return;

    updateRunButton(sim.running);
    updateReplayUI();
    ui.simTime.textContent = fmt(sim.time ?? 0, 3);
    ui.simFps.textContent = String(Math.round(sim.actual_fps ?? 0));
    ui.simSteps.textContent = intText(sim.steps ?? 0);
    ui.simFps.title = `目标 ${sim.config?.fps ?? '—'} fps · 实际 ${(sim.actual_fps ?? 0).toFixed(1)}`;

    const nodes = state.scene?.nodes?.length ?? 0;
    const edges = state.scene?.edges?.length ?? 0;
    const maxNodes = state.catalog?.limits?.nodes ?? state.limits?.nodes ?? 400;
    const maxEdges = state.catalog?.limits?.edges ?? state.limits?.edges ?? 1200;
    ui.statusLimits.textContent = `节点 ${nodes}/${maxNodes} · 连接 ${edges}/${maxEdges}`;
    ui.statusMode.textContent = modeLabel(state.mode);

    const stats = sim.scene || {};
    const revision = state.scene?.revision ?? 0;
    if (stats.kind === 'circuit') {
      ui.statusEngine.textContent = `MNA ${stats.matrix_size || 0}×${stats.matrix_size || 0}`;
    } else if (stats.kind === 'vector') {
      ui.statusEngine.textContent = `矢量流 · rev ${revision}`;
    } else if (stats.kind === 'signal') {
      ui.statusEngine.textContent = `字典流 · rev ${revision}`;
    } else {
      ui.statusEngine.textContent = '—';
    }

    let hint = sim.running ? '运行中' : '已暂停';
    if (sim.config) {
      hint += ` · ${sim.config.fps} fps × ${sim.config.steps_per_frame} 步 · dt ${fmt(sim.config.dt, 3)}`;
    }
    ui.statusHint.textContent = hint;

    const engineError = state.scene?.engine_error || null;
    const simError = sim.error || null;
    const message = simError || engineError;
    if (message) {
      if (state.dismissedError !== message) showBanner(message);
    } else {
      state.dismissedError = null;
      hideBanner();
    }

    ui.zoomBadge.textContent = `${Math.round(state.view.k * 100)}%`;
    ui.modePill.classList.toggle('circuit', state.mode === 'circuit');
    ui.modePill.classList.toggle('vector', state.mode === 'vector');
    ui.modePill.textContent = modeLabel(state.mode);

    updateScenePanelValues();
    schedulePhaseDraw();
  }

  function updateModeUI() {
    ui.modePill.classList.toggle('circuit', state.mode === 'circuit');
    ui.modePill.classList.toggle('vector', state.mode === 'vector');
    ui.modePill.textContent = modeLabel(state.mode);
    ui.statusMode.textContent = modeLabel(state.mode);
    ui.main.dataset.mode = state.mode;
    const modeHost = $('[data-role="mode"]');
    if (modeHost) {
      $$('button[data-mode]', modeHost).forEach((item) => {
        item.classList.toggle('active', item.dataset.mode === state.mode);
      });
    }
    const integration = $('[data-role="integration"]');
    if (integration) {
      integration.disabled = state.mode !== 'circuit';
      if (state.scene) integration.value = state.scene.integration || 'trapezoidal';
    }
    const integrationNote = $('[data-role="integration-note"]');
    if (integrationNote) {
      integrationNote.textContent = state.mode === 'circuit'
        ? '梯形法精度高；后向欧拉更稳定，适合刚性电路。'
        : '仅电路模式使用；信号 / 矢量层由每条连接的离散化参数决定。';
    }
  }

  function updateRunButton(running) {
    ui.runBtn.classList.toggle('running', Boolean(running));
    ui.runBtn.setAttribute('aria-pressed', running ? 'true' : 'false');
    ui.runIcon.textContent = running ? '⏸' : '▶';
    ui.runLabel.textContent = running ? '暂停' : '运行';
    ui.runBtn.title = running ? '暂停（空格）' : '运行（空格）';
  }

  function updateSignalKeyCache() {
    const keys = Array.isArray(state.sim?.probe_keys) ? state.sim.probe_keys : [];
    const signature = keys.join('\u0001');
    if (signature === state.probeSignature) return;
    state.probeSignature = signature;
    state.probeKeys = keys;

    // 重置后 probe_keys 会短暂为空：保留用户探针选择，避免“重置即清空通道”。
    if (!keys.length) {
      renderSignalList();
      fillInstrumentSelects();
      scheduleChartDraw();
      return;
    }
    const available = new Set(keys);
    for (const key of Array.from(state.chart.selected)) {
      if (!available.has(key)) state.chart.selected.delete(key);
    }
    if (state.chart.selected.size === 0) {
      keys.slice(0, 2).forEach((key) => state.chart.selected.add(key));
    }
    renderSignalList();
    fillInstrumentSelects();
    scheduleChartDraw();
  }

  function ingestFrame(frame) {
    if (!frame || !frame.v) return;
    for (const [key, raw] of Object.entries(frame.v)) {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      state.values.set(key, raw);
      if (key.startsWith('n:')) {
        const rest = key.slice(2);
        const cut = rest.lastIndexOf(':');
        if (cut > 0) {
          const name = rest.slice(0, cut);
          const field = rest.slice(cut + 1);
          let bucket = state.nodeValues.get(name);
          if (!bucket) {
            bucket = {};
            state.nodeValues.set(name, bucket);
          }
          bucket[field] = raw;
        }
      } else if (key.startsWith('e:')) {
        const rest = key.slice(2);
        const cut = rest.lastIndexOf(':');
        if (cut > 0) {
          const name = rest.slice(0, cut);
          const field = rest.slice(cut + 1);
          let bucket = state.edgeValues.get(name);
          if (!bucket) {
            bucket = {};
            state.edgeValues.set(name, bucket);
          }
          bucket[field] = raw;
        }
      }
    }
  }

  function displayDataFor(record, liveMap) {
    const merged = Object.assign({}, record?.data || {});
    const live = liveMap.get(record?.name);
    if (live) {
      for (const [key, value] of Object.entries(live)) {
        if (typeof value === 'number' && Number.isFinite(value)) merged[key] = value;
      }
    }
    return merged;
  }

  function nodeDisplayData(node) {
    return displayDataFor(node, state.nodeValues);
  }

  function edgeDisplayData(edge) {
    const merged = Object.assign({}, edge?.output || {}, edge?.state || {});
    const live = state.edgeValues.get(edge?.name);
    if (live) {
      for (const [key, value] of Object.entries(live)) {
        if (typeof value === 'number' && Number.isFinite(value)) merged[key] = value;
      }
    }
    return merged;
  }

  /* ======================================================================
   * 3. 画布尺寸、视图变换与渲染
   * ==================================================================== */

  function resizeGraph() {
    const rect = stage.getBoundingClientRect();
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    state.canvasSize = { w: width, h: height, dpr };
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    requestDraw();
  }

  function resizeChart() {
    const wrap = $('.chart-wrap');
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    state.chartSize = { w: width, h: height, dpr };
    chartCanvas.width = Math.max(1, Math.round(width * dpr));
    chartCanvas.height = Math.max(1, Math.round(height * dpr));
    scheduleChartDraw();
  }

  function worldToScreen(point) {
    return {
      x: state.view.x + point.x * state.view.k,
      y: state.view.y + point.y * state.view.k,
    };
  }

  function screenToWorld(x, y) {
    return {
      x: (x - state.view.x) / state.view.k,
      y: (y - state.view.y) / state.view.k,
    };
  }

  function nodeDiameter(node) {
    if (
      state.scene?.mode === 'circuit'
      && state.ui?.symbol === 'gb'
      && node
      && (node.kind === 'node' || node.kind === 'ground')
      && (state.ui?.nodeStyle || 'circle') !== 'box'
    ) {
      return 24;
    }
    const raw = Number(node?.size?.w);
    if (Number.isFinite(raw) && raw > 0) return clamp(raw, 24, 200);
    return NODE_RADIUS * 2;
  }

  function nodeRect(node) {
    const k = state.view.k;
    if (isPinNode(node)) {
      return deviceRect(node);
    }
    const radius = (nodeDiameter(node) / 2) * k;
    const center = worldToScreen(node.position || { x: 0, y: 0 });
    return {
      x: center.x - radius,
      y: center.y - radius,
      w: radius * 2,
      h: radius * 2,
      r: radius,
      cx: center.x,
      cy: center.y,
      shape: 'circle',
    };
  }

  // ---- R20：器件节点（组件框 + 引脚） --------------------------------------
  function deviceElementSpec(node) {
    const element = String(node?.params?.element || '');
    return (state.catalog?.elements || []).find((spec) => spec.kind === element) || null;
  }

  function isModuleNode(node) {
    return state.scene?.mode === 'circuit' && node?.kind === 'module';
  }

  // 电路里"带引脚的东西"：器件与模块实例都按引脚连线。
  function isPinNode(node) {
    return state.scene?.mode === 'circuit'
      && (node?.kind === 'device' || node?.kind === 'module');
  }

  function modulePorts(node) {
    return Array.isArray(node?.params?.ports) ? node.params.ports : [];
  }

  function devicePins(node) {
    if (node?.kind === 'module') {
      // R24/D49：模块实例的端口就是引脚，方向决定它画在哪一侧。
      return modulePorts(node).map((port) => ({
        name: String(port?.name || ''),
        role: port?.direction === 'input'
          ? 'input'
          : port?.direction === 'output'
            ? 'output'
            : 'passive',
        required: false,
        module: true,
      }));
    }
    return deviceElementSpec(node)?.pins || [];
  }

  function devicePinGroups(node) {
    const pins = devicePins(node);
    const left = [];
    const right = [];
    const top = [];
    const bottom = [];
    if (pins.length === 2) {
      return { left: [pins[0]], right: [pins[1]], top: [], bottom: [] };
    }
    const half = Math.ceil(pins.length / 2);
    let passiveIndex = 0;
    pins.forEach((pin, index) => {
      if (pin.role === 'input') left.push(pin);
      else if (pin.role === 'output') right.push(pin);
      else if (pin.role === 'power') {
        // R21：正电源（V+/VCC/VDD）在上，负电源在下，贴近原理图画法。
        const name = String(pin.name || '');
        const positive = name.includes('+') || /VCC|VDD/i.test(name);
        (positive ? top : bottom).push(pin);
      } else if (pin.role === 'bidirectional') (index < half ? left : right).push(pin);
      else (passiveIndex++ % 2 === 0 ? left : right).push(pin);
    });
    return { left, right, top, bottom };
  }

  function deviceWorldSize(node) {
    const groups = devicePinGroups(node);
    const maxSide = Math.max(
      groups.left.length, groups.right.length,
      groups.top.length, groups.bottom.length, 1,
    );
    const w = Number(node?.size?.w) || 120;
    const h = Math.max(Number(node?.size?.h) || 0, Math.max(56, maxSide * 24 + 16));
    return { w, h };
  }

  function deviceRect(node) {
    const { w: worldW, h: worldH } = deviceWorldSize(node);
    const k = state.view.k;
    const center = worldToScreen(node.position || { x: 0, y: 0 });
    const w = worldW * k;
    const h = worldH * k;
    return {
      x: center.x - w / 2,
      y: center.y - h / 2,
      w,
      h,
      r: Math.min(w, h) / 2,
      cx: center.x,
      cy: center.y,
      shape: 'rect',
    };
  }

  function devicePinLocal(node, pin) {
    const { w, h } = deviceWorldSize(node);
    const groups = devicePinGroups(node);
    const leftIndex = groups.left.findIndex((item) => item.name === pin.name);
    if (leftIndex >= 0) {
      return { x: -w / 2, y: -h / 2 + (leftIndex + 1) * h / (groups.left.length + 1), side: 'left' };
    }
    const rightIndex = groups.right.findIndex((item) => item.name === pin.name);
    if (rightIndex >= 0) {
      return { x: w / 2, y: -h / 2 + (rightIndex + 1) * h / (groups.right.length + 1), side: 'right' };
    }
    const bottomIndex = groups.bottom.findIndex((item) => item.name === pin.name);
    if (bottomIndex >= 0) {
      return { x: -w / 2 + (bottomIndex + 1) * w / (groups.bottom.length + 1), y: h / 2, side: 'bottom' };
    }
    const topIndex = groups.top.findIndex((item) => item.name === pin.name);
    if (topIndex >= 0) {
      return { x: -w / 2 + (topIndex + 1) * w / (groups.top.length + 1), y: -h / 2, side: 'top' };
    }
    return { x: 0, y: 0, side: 'center' };
  }

  function devicePinWired(node, pinName) {
    return (state.scene?.edges || []).some((edge) => {
      if (edge.kind !== 'wire' || !edge.enabled) return false;
      if (edge.source === node.id && edge.source_pin === pinName) return true;
      return edge.target === node.id && edge.target_pin === pinName;
    });
  }

  function deviceSupplyLabel(node, pin) {
    // R21：V± 未接线时显示参数默认值，接线后只显示引脚名，避免“值/来源”混淆。
    const element = String(node?.params?.element || '');
    if (!['opamp', 'comparator'].includes(element)) return pin.name;
    if (pin.name !== 'V+' && pin.name !== 'V-') return pin.name;
    if (devicePinWired(node, pin.name)) return pin.name;
    const value = pin.name === 'V+' ? node.params.vcc : node.params.vee;
    if (!Number.isFinite(Number(value))) return pin.name;
    const text = `${Number(value).toPrecision(3)}V`;
    return `${pin.name} ${text}`;
  }

  function deviceMissingPins(node) {
    return devicePins(node)
      .filter((pin) => pin.required && !devicePinWired(node, pin.name))
      .map((pin) => pin.name);
  }

  function deviceImplicitGroundPin(node) {
    // R21/D43：两端电源只接一端时，空脚自动对地并画出接地标记。
    const element = String(node?.params?.element || '');
    if (!['vsource', 'isource'].includes(element)) return null;
    const missing = deviceMissingPins(node);
    return missing.length === 1 ? missing[0] : null;
  }

  function deviceInactive(node) {
    // 运行中“未参与求解”器件：缺必接引脚，但电源的单端自动接地不算。
    const implicit = deviceImplicitGroundPin(node);
    return deviceMissingPins(node).some((pin) => pin !== implicit);
  }

  function devicePinScreen(node, pinName) {
    const pin = devicePins(node).find((item) => item.name === pinName);
    if (!pin) return nodeCenterScreen(node);
    const rect = deviceRect(node);
    const local = devicePinLocal(node, pin);
    return { x: rect.cx + local.x * state.view.k, y: rect.cy + local.y * state.view.k };
  }

  function snapWorld(x, y, alt = false) {
    const grid = Number(state.ui?.grid) || 20;
    if (!state.ui?.snap || alt) return { x, y };
    return { x: Math.round(x / grid) * grid, y: Math.round(y / grid) * grid };
  }

  function portOut(node) {
    const rect = nodeRect(node);
    return { x: rect.cx + rect.r, y: rect.cy };
  }

  function portIn(node) {
    const rect = nodeRect(node);
    return { x: rect.cx - rect.r, y: rect.cy };
  }

  function curveFor(edge) {
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    if (!source || !target) return null;
    const s = nodeRect(source);
    const t = nodeRect(target);
    if (edge.source === edge.target) {
      return {
        p0: { x: s.cx + s.r, y: s.cy - s.r * 0.22 },
        p1: { x: s.cx + s.r + 92, y: s.cy - s.r - 88 },
        p2: { x: s.cx - s.r - 92, y: s.cy - s.r - 88 },
        p3: { x: s.cx - s.r, y: s.cy - s.r * 0.22 },
      };
    }
    const dx = t.cx - s.cx;
    const dy = t.cy - s.cy;
    const length = Math.max(1.0, Math.hypot(dx, dy));
    const ux = dx / length;
    const uy = dy / length;
    const margin = clamp(5 * state.view.k, 3, 8);
    const start = { x: s.cx + ux * (s.r + margin), y: s.cy + uy * (s.r + margin) };
    const end = { x: t.cx - ux * (t.r + margin), y: t.cy - uy * (t.r + margin) };
    const normal = { x: -uy, y: ux };
    const direction = hashString(edge.id) % 2 === 0 ? 1 : -1;
    const bend = direction * Math.min(46, 10 + length * 0.07);
    return {
      p0: start,
      p1: {
        x: start.x + dx * 0.33 + normal.x * bend,
        y: start.y + dy * 0.33 + normal.y * bend,
      },
      p2: {
        x: start.x + dx * 0.67 + normal.x * bend,
        y: start.y + dy * 0.67 + normal.y * bend,
      },
      p3: end,
    };
  }

  function nodeCenterScreen(node) {
    const rect = nodeRect(node);
    return { x: rect.cx, y: rect.cy };
  }

  function anchorPoint(node, side, toward) {
    const rect = nodeRect(node);
    if (side === 'left') return { x: rect.cx - rect.r, y: rect.cy };
    if (side === 'right') return { x: rect.cx + rect.r, y: rect.cy };
    if (side === 'top') return { x: rect.cx, y: rect.cy - rect.r };
    if (side === 'bottom') return { x: rect.cx, y: rect.cy + rect.r };
    const dx = toward.x - rect.cx;
    const dy = toward.y - rect.cy;
    const length = Math.max(1, Math.hypot(dx, dy));
    return { x: rect.cx + (dx / length) * rect.r, y: rect.cy + (dy / length) * rect.r };
  }

  function edgeEndpointHit(point) {
    const edge = selectedEdge();
    if (!edge) return null;
    const points = edgePathPoints(edge);
    if (!points || points.length < 2) return null;
    const ends = [
      { end: 'source', p: points[0] },
      { end: 'target', p: points[points.length - 1] },
    ];
    for (const item of ends) {
      if (distance(point.x, point.y, item.p.x, item.p.y) <= 11) {
        return { id: edge.id, end: item.end };
      }
    }
    return null;
  }

  function waypointHitAt(point, includeUnselected = false) {
    const candidates = [];
    const selected = selectedEdge();
    if (selected && selected.route === 'manual') candidates.push(selected);
    if (includeUnselected) {
      for (const edge of state.scene?.edges || []) {
        if (edge.route !== 'manual' || edge === selected) continue;
        candidates.push(edge);
      }
    }
    for (const edge of candidates) {
      const waypoints = edge.waypoints || [];
      for (let index = 0; index < waypoints.length; index += 1) {
        const wx = Number(waypoints[index].x) || 0;
        const wy = Number(waypoints[index].y) || 0;
        const screen = {
          x: state.view.x + wx * state.view.k,
          y: state.view.y + wy * state.view.k,
        };
        if (Math.abs(point.x - screen.x) <= 11 && Math.abs(point.y - screen.y) <= 11) {
          return { edge, index, screen };
        }
      }
    }
    return null;
  }

  function anchorSideFor(node, screenPoint) {
    const rect = nodeRect(node);
    const radius = Math.max(rect.r, 1);
    const dx = (screenPoint.x - rect.cx) / radius;
    const dy = (screenPoint.y - rect.cy) / radius;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 1.9) return 'auto';
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
    return dy >= 0 ? 'bottom' : 'top';
  }

  function anchorScreenPoint(node, side) {
    const rect = nodeRect(node);
    const r = rect.r;
    if (side === 'left') return { x: rect.cx - r, y: rect.cy };
    if (side === 'right') return { x: rect.cx + r, y: rect.cy };
    if (side === 'top') return { x: rect.cx, y: rect.cy - r };
    if (side === 'bottom') return { x: rect.cx, y: rect.cy + r };
    return { x: rect.cx, y: rect.cy };
  }

  function edgePathPoints(edge) {
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    if (!source || !target) return null;
    const pinned = circuitPinPath(edge, source, target);
    if (pinned) return pinned;
    if (edge.kind === 'wire' && state.scene?.mode === 'circuit') {
      return wirePathPoints(edge, source, target);
    }

    const sc = nodeCenterScreen(source);
    const tc = nodeCenterScreen(target);
    if (edge.source === edge.target) {
      const r = nodeRect(source).r;
      const curve = {
        p0: { x: sc.x + r, y: sc.y - r * 0.22 },
        p1: { x: sc.x + r + 92 * state.view.k, y: sc.y - r - 88 * state.view.k },
        p2: { x: sc.x - r - 92 * state.view.k, y: sc.y - r - 88 * state.view.k },
        p3: { x: sc.x - r, y: sc.y - r * 0.22 },
      };
      const points = [];
      for (let index = 0; index <= 20; index += 1) points.push(bezierPoint(curve, index / 20));
      return points;
    }
    const start = anchorPoint(source, edge.anchors?.source || 'auto', tc);
    const end = anchorPoint(target, edge.anchors?.target || 'auto', sc);
    let route = edge.route || 'auto';
    // 电路图默认按正交布线，贴近常规电路模拟软件的图纸风格。
    if (route === 'auto' && state.scene?.mode === 'circuit' && state.ui?.circuitOrthogonal !== false) route = 'orthogonal';
    if (route === 'straight') return [start, end];
    if (route === 'orthogonal') {
      if (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)) {
        const midX = (start.x + end.x) / 2;
        return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
      }
      const midY = (start.y + end.y) / 2;
      return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
    }
    if (route === 'manual' && Array.isArray(edge.waypoints) && edge.waypoints.length) {
      const points = [start];
      for (const item of edge.waypoints) points.push(worldToScreen(item));
      points.push(end);
      return points;
    }
    // auto：沿锚点方向的平滑三次曲线
    const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
    const c1 = horizontal
      ? { x: start.x + (end.x - start.x) * 0.4, y: start.y }
      : { x: start.x, y: start.y + (end.y - start.y) * 0.4 };
    const c2 = horizontal
      ? { x: end.x - (end.x - start.x) * 0.4, y: end.y }
      : { x: end.x, y: end.y - (end.y - start.y) * 0.4 };
    const curve = { p0: start, p1: c1, p2: c2, p3: end };
    const points = [];
    for (let index = 0; index <= 24; index += 1) points.push(bezierPoint(curve, index / 24));
    return points;
  }

  function pathSegments(points) {
    const segments = [];
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 0.001) continue;
      segments.push({ a, b, length, start: total });
      total += length;
    }
    return { segments, total };
  }

  function pathPointAt(points, t) {
    const { segments, total } = pathSegments(points);
    if (!segments.length) return points[0];
    let target = clamp(t, 0, 1) * total;
    for (const segment of segments) {
      if (target <= segment.length) {
        const r = segment.length ? target / segment.length : 0;
        return {
          x: segment.a.x + (segment.b.x - segment.a.x) * r,
          y: segment.a.y + (segment.b.y - segment.a.y) * r,
        };
      }
      target -= segment.length;
    }
    return segments[segments.length - 1].b;
  }

  function pathMidpoint(points) {
    return pathPointAt(points, 0.5);
  }

  function pathEndAngle(points) {
    const last = points[points.length - 1];
    const prev = points[points.length - 2] || last;
    return Math.atan2(last.y - prev.y, last.x - prev.x);
  }

  function distanceToPath(x, y, points) {
    let best = Infinity;
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;
      let r = 0;
      if (lengthSq > 1e-6) r = clamp(((x - a.x) * dx + (y - a.y) * dy) / lengthSq, 0, 1);
      const px = a.x + dx * r;
      const py = a.y + dy * r;
      best = Math.min(best, Math.hypot(x - px, y - py));
    }
    return best;
  }

  function vectorForNode(node) {
    const data = nodeDisplayData(node);
    let vx = data.vx;
    let vy = data.vy;
    let source = 'velocity';
    if (typeof vx !== 'number' || !Number.isFinite(vx) || typeof vy !== 'number' || !Number.isFinite(vy)) {
      vx = data.x;
      vy = data.y;
      source = 'position';
    }
    if (typeof vx !== 'number' || !Number.isFinite(vx) || typeof vy !== 'number' || !Number.isFinite(vy)) {
      vx = data.x1;
      vy = data.x2;
      source = 'state';
    }
    if (typeof vx !== 'number' || !Number.isFinite(vx) || typeof vy !== 'number' || !Number.isFinite(vy)) {
      return null;
    }
    const magnitude = Math.hypot(vx, vy);
    if (!Number.isFinite(magnitude) || magnitude < 1.0e-9) return null;
    return { vx, vy, magnitude, source };
  }

  function bezierPoint(curve, t) {
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const d = t * t * t;
    return {
      x: a * curve.p0.x + b * curve.p1.x + c * curve.p2.x + d * curve.p3.x,
      y: a * curve.p0.y + b * curve.p1.y + c * curve.p2.y + d * curve.p3.y,
    };
  }

  function roundRectPath(context, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + w - radius, y);
    context.quadraticCurveTo(x + w, y, x + w, y + radius);
    context.lineTo(x + w, y + h - radius);
    context.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    context.lineTo(x + radius, y + h);
    context.quadraticCurveTo(x, y + h, x, y + h - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();
  }

  const KIND_SHORT = {
    manual: 'MANUAL',
    sum: 'SUM',
    gain: 'GAIN',
    lag: 'LAG',
    integrate: 'INT',
    signal: 'SIGNAL',
    expression: 'EXPR',
    state_space: 'STATE',
    clip: 'CLIP',
    oscillator: 'OSC',
    nonlinear_plant: 'PLANT',
    sliding_mode: 'SMC',
    vector_transform: 'VECTOR',
    node: 'NODE',
    ground: 'GROUND',
  };

  const KIND_COLORS = {
    oscillator: '#a8541f',
    nonlinear_plant: '#1f5f5b',
    sliding_mode: '#7a4a7c',
    vector_transform: '#4a6f8a',
  };

  function nodeColor(node) {
    if (node.kind === 'ground') return C('#6f695f');
    if (state.mode === 'circuit') return C('#9a6a1c');
    if (KIND_COLORS[node.kind]) return C(KIND_COLORS[node.kind]);
    const spec = getNodeSpec(node.kind);
    return C(GROUP_COLORS[spec?.group] || '#a8541f');
  }

  function nodeKindLabel(node) {
    return KIND_SHORT[node.kind] || String(node.kind || '').toUpperCase().slice(0, 9);
  }

  function nodeValueText(node) {
    const data = nodeDisplayData(node);
    const fields = Object.keys(data).filter((key) => typeof data[key] === 'number' && Number.isFinite(data[key]));
    if (!fields.length) return '—';
    const preferred = ['voltage', 'value', 'y0', 'output', 'acc', 'x1', 'x', 'y', 'vx', 'vy']
      .find((key) => fields.includes(key));
    const ordered = preferred ? [preferred, ...fields.filter((key) => key !== preferred)] : fields;
    return ordered.slice(0, 2).map((key) => `${key} ${fmt(data[key], 3)}`).join('  ·  ');
  }

  function edgeValueText(edge) {
    const data = edgeDisplayData(edge);
    const field = ['current', 'voltage_difference', 'power', 'voltage']
      .find((key) => typeof data[key] === 'number');
    return field ? `${field} ${fmt(data[field], 3)}` : '';
  }

  function drawGrid(width, height) {
    if (state.ui?.showGrid === false || state.ui?.drawingMode) return;
    let step = (Number(state.ui?.grid) || 20) * state.view.k;
    while (step < 12) step *= 2;
    while (step > 84) step /= 2;
    const ox = ((state.view.x % step) + step) % step;
    const oy = ((state.view.y % step) + step) % step;

    ctx.fillStyle = tokens().gridDot;
    for (let x = ox; x < width; x += step) {
      for (let y = oy; y < height; y += step) {
        ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
    }

    if (state.view.x > 0 && state.view.x < width) {
      ctx.strokeStyle = tokens().gridAxis;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(state.view.x) + 0.5, 0);
      ctx.lineTo(Math.round(state.view.x) + 0.5, height);
      ctx.stroke();
    }
    if (state.view.y > 0 && state.view.y < height) {
      ctx.strokeStyle = tokens().gridAxis;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(state.view.y) + 0.5);
      ctx.lineTo(width, Math.round(state.view.y) + 0.5);
      ctx.stroke();
    }

    // CAD 式捕捉点：拖动时高亮最近的网格交点
    const dragging = state.drag && ['node', 'waypoint', 'resize', 'endpoint'].includes(state.drag.type);
    const pointer = state.pointer;
    if (
      dragging
      && state.ui?.snapMarkers !== false
      && state.ui?.snap
      && pointer
      && Number.isFinite(pointer.x)
      && Number.isFinite(pointer.y)
    ) {
      const grid = Number(state.ui?.grid) || 20;
      const snapped = {
        x: Math.round(pointer.x / grid) * grid,
        y: Math.round(pointer.y / grid) * grid,
      };
      const sp = worldToScreen(snapped.x, snapped.y);
      const size = 7;
      ctx.strokeStyle = C('rgba(168, 84, 31, 0.85)');
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(sp.x - size, sp.y);
      ctx.lineTo(sp.x + size, sp.y);
      ctx.moveTo(sp.x, sp.y - size);
      ctx.lineTo(sp.x, sp.y + size);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, size + 3, 0, Math.PI * 2);
      ctx.strokeStyle = C('rgba(168, 84, 31, 0.35)');
      ctx.stroke();
    }
  }



  function circuitMidAngle(points) {
    const segments = [];
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      const dx = points[index].x - points[index - 1].x;
      const dy = points[index].y - points[index - 1].y;
      const length = Math.hypot(dx, dy);
      if (length <= 0.5) continue;
      segments.push({ start: total, length, angle: Math.atan2(dy, dx) });
      total += length;
    }
    if (!segments.length) return 0;
    const at = total / 2;
    let chosen = segments[segments.length - 1].angle;
    for (const segment of segments) {
      if (at >= segment.start && at <= segment.start + segment.length) {
        chosen = segment.angle;
        break;
      }
    }
    const quarter = Math.PI / 2;
    return Math.round(chosen / quarter) * quarter;
  }

  function drawCircuitGlyph(edge, points, color) {
    if (state.view.k < 0.35) return;
    const mid = pathMidpoint(points);
    if (!mid) return;
    const layout = edge.layout || null;
    const center = layout && Number.isFinite(layout.x) && Number.isFinite(layout.y)
      ? worldToScreen({ x: layout.x, y: layout.y })
      : mid;
    // 布局层有 rot 时以它为准（30° 步长）；否则按中点导线方向量化。
    const angle = layout && Number.isFinite(Number(layout.rot))
      ? (Number(layout.rot) * Math.PI) / 180
      : circuitMidAngle(points);
    const scale = symbolScalePx();
    const theme = C(state.ui?.glyphColor || '#1f5f5b');
    const glyphColor = color === '#a8541f' ? C('#a8541f') : theme;
    const ctx2 = ctx;
    ctx2.save();
    ctx2.translate(center.x, center.y);
    ctx2.rotate(angle);
    ctx2.scale(scale, scale);
    ctx2.strokeStyle = glyphColor;
    ctx2.fillStyle = glyphColor;
    ctx2.lineWidth = 1.25;
    ctx2.lineCap = 'round';
    ctx2.lineJoin = 'round';
    const S = 9;
    const line = (x1, y1, x2, y2) => {
      ctx2.beginPath(); ctx2.moveTo(x1, y1); ctx2.lineTo(x2, y2); ctx2.stroke();
    };
    const poly = (coords) => {
      ctx2.beginPath(); ctx2.moveTo(coords[0], coords[1]);
      for (let i = 2; i < coords.length; i += 2) ctx2.lineTo(coords[i], coords[i + 1]);
      ctx2.stroke();
    };
    const kind = String(edge.kind || '');
    if (kind === 'wire') return;
    if (kind === 'resistor') {
      poly([-S, 0, -6, 0, -4.5, -4, -1.5, 4, 1.5, -4, 4.5, 4, 6, 0, S, 0]);
    } else if (kind === 'capacitor') {
      line(-S, 0, -2.5, 0); line(2.5, 0, S, 0); line(-2.5, -6, -2.5, 6); line(2.5, -6, 2.5, 6);
    } else if (kind === 'inductor') {
      ctx2.beginPath();
      ctx2.arc(-5, 0, 2.8, Math.PI, 0, false);
      ctx2.arc(0, 0, 2.8, Math.PI, 0, false);
      ctx2.arc(5, 0, 2.8, Math.PI, 0, false);
      ctx2.stroke();
      line(-S, 0, -7.8, 0); line(7.8, 0, S, 0);
    } else if (kind === 'vsource' || kind === 'isource') {
      ctx2.beginPath(); ctx2.arc(0, 0, 6.5, 0, Math.PI * 2); ctx2.stroke();
      line(-S, 0, -6.5, 0); line(6.5, 0, S, 0);
      if (kind === 'vsource') {
        line(-3, -2.5, 1, -2.5); line(-1, -4.5, -1, -0.5);
        line(-3, 2.5, 1, 2.5);
      } else {
        line(-1, -2.5, 1, -2.5); line(0, -4, 0, -1);
        line(0, -1, -1.2, 0.4); line(0, -1, 1.2, 0.4);
      }
    } else if (kind === 'diode' || kind === 'led' || kind === 'zener') {
      line(-S, 0, -4, 0);
      ctx2.beginPath(); ctx2.moveTo(-4, -5); ctx2.lineTo(-4, 5); ctx2.lineTo(4, 0); ctx2.closePath();
      ctx2.fill();
      line(4, -5.5, 4, 5.5); line(4, 0, S, 0);
      if (kind === 'zener') {
        line(4, -5.5, 1.5, -5.5); line(4, 5.5, 6.5, 5.5);
      }
      if (kind === 'led') {
        line(1, -7, 4, -10); line(1.5, -10, 4, -10);
        line(4, -7, 7, -10); line(4.5, -10, 7, -10);
      }
    } else if (kind === 'switch') {
      line(-S, 0, -3, 0); line(-3, 0, 5, -5); line(5, 0, S, 0);
      ctx2.beginPath(); ctx2.arc(-3, 0, 1.1, 0, Math.PI * 2); ctx2.fill();
    } else if (kind === 'vcvs' || kind === 'vccs') {
      ctx2.beginPath(); ctx2.moveTo(0, -6); ctx2.lineTo(8, 0); ctx2.lineTo(0, 6); ctx2.lineTo(-8, 0); ctx2.closePath(); ctx2.stroke();
      line(-S, 0, -8, 0); line(8, 0, S, 0);
      if (kind === 'vcvs') {
        line(-3.5, -1.5, -0.5, -1.5); line(-2, -3, -2, 0);
        line(-3.5, 2, -0.5, 2);
      } else {
        line(-3, 1, 2, 1); line(0.6, -0.2, 2, 1); line(0.6, 2.2, 2, 1);
      }
    } else if (kind === 'opamp' || kind === 'comparator') {
      ctx2.beginPath(); ctx2.moveTo(-6, -7); ctx2.lineTo(-6, 7); ctx2.lineTo(8, 0); ctx2.closePath(); ctx2.stroke();
      line(-S, 0, -6, 0); line(8, 0, S, 0);
      ctx2.font = '7px "Cascadia Code", Consolas, monospace';
      ctx2.textAlign = 'center'; ctx2.textBaseline = 'middle';
      ctx2.fillText('+', -3.5, -2.6); ctx2.fillText('−', -3.5, 2.6);
      if (kind === 'comparator') { line(-4, 5.2, 2, 5.2); }
    } else if (kind === 'npn' || kind === 'pnp') {
      ctx2.beginPath(); ctx2.arc(0, 0, 6.5, 0, Math.PI * 2); ctx2.stroke();
      line(-S, 0, -5, 0); line(-5, -5, -5, 5);
      line(-5, -2.5, 4, -6); line(-5, 2.5, 4, 6);
      line(4, 6, 1, 4.6); line(4, 6, 3, 3);
    } else if (kind === 'nmos' || kind === 'pmos') {
      line(-S, 0, -5, 0); line(-5, -5, -5, 5);
      line(-2.5, -5, -2.5, 5);
      line(-2.5, -4, 5, -4); line(5, -4, 5, -6);
      line(-2.5, 4, 5, 4); line(5, 4, 5, 6);
    } else if (kind === 'dflipflop') {
      ctx2.strokeRect(-7, -7, 14, 14);
      line(-7, 4, -10, 6); line(-10, 6, -7, 6);
      line(-4, 7, -4, 9); line(-4, 7, -2, 7);
      line(7, -2, 10, -2); line(7, 2, 10, 2);
      ctx2.font = '5.5px "Cascadia Code", Consolas, monospace';
      ctx2.fillText('D', -3.5, -5); ctx2.fillText('Q', 4, -5);
      ctx2.fillText('CLK', -3.5, 5.4);
    } else if (kind === 'transformer' || kind === 'coupling_inductor') {
      // 主绕组沿导线轴，副绕组平行偏置在上方，中间为铁芯（互感用虚线）。
      const coil = (y) => {
        for (const cx of [-4.8, 0, 4.8]) {
          ctx2.beginPath(); ctx2.arc(cx, y, 2.3, Math.PI, 0, false); ctx2.stroke();
        }
      };
      line(-S, 0, -7.1, 0);
      line(7.1, 0, S, 0);
      coil(0);
      if (kind === 'transformer') {
        line(-8, -3.4, 8, -3.4); line(-8, -6.2, 8, -6.2);
      } else {
        ctx2.setLineDash([2, 2]); line(-8, -4.8, 8, -4.8); ctx2.setLineDash([]);
      }
      coil(-9.6);
    } else if (kind === 'adc4') {
      ctx2.strokeRect(-7, -7, 14, 14);
      ctx2.font = '5px "Cascadia Code", Consolas, monospace';
      ctx2.textAlign = 'center'; ctx2.textBaseline = 'middle';
      ctx2.fillText('ADC', 0, -3.6);
      line(-4, 3.6, -1.5, 3.6); line(-1.5, 3.6, -1.5, 1.4);
      line(-1.5, 1.4, 1, 1.4); line(1, 1.4, 1, -0.2);
      line(-S, 0, -7, 0); line(7, 0, S, 0);
    } else {
      ctx2.strokeRect(-7, -6, 14, 12);
      ctx2.font = '6px "Cascadia Code", Consolas, monospace';
      ctx2.textAlign = 'center'; ctx2.textBaseline = 'middle';
      ctx2.fillText(kind.slice(0, 6), 0, 0);
    }
    ctx2.restore();
  }


  function elementValueText(edge) {
    const params = edge.params || {};
    const kind = String(edge.kind || '');
    const unit = (value, suffix) => (value == null ? '' : `${Number(value).toPrecision(4)}${suffix}`);
    if (kind === 'resistor') return unit(params.R, ' Ω');
    if (kind === 'capacitor') return unit(params.C, ' F');
    if (kind === 'inductor') return unit(params.L, ' H');
    if (kind === 'diode' || kind === 'led') return `${kind === 'led' ? 'LED' : 'D'}`;
    if (kind === 'zener') return `Vz=${unit(params.Vz, ' V')}`;
    if (kind === 'vsource' || kind === 'isource') {
      const wave = params.wave || 'dc';
      if (wave === 'dc') return `DC ${unit(params.offset, ' V')}`;
      return `${wave} ${unit(params.amplitude, ' V')} / ${unit(params.frequency, ' Hz')}`;
    }
    if (kind === 'vcvs' || kind === 'vccs') return `gain=${unit(params.gain, '')}`;
    if (kind === 'opamp' || kind === 'comparator') return `A=${unit(params.gain, '')}`;
    if (kind === 'switch') return params.closed ? '闭合' : '断开';
    if (kind === 'dflipflop') return `Q₀=${unit(params.q0, ' V')}`;
    return '';
  }

  function circuitWireGap(points, middle, gapLength) {
    // 在符号处把导线断开：只擦掉中点附近的一小段（不是整块贴图底）
    const half = gapLength / 2;
    const segments = [];
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length <= 0) continue;
      segments.push({ a, b, length, start: total });
      total += length;
    }
    if (!total) return;
    const midAt = (() => {
      let best = 0;
      let bestDist = Infinity;
      for (const segment of segments) {
        const dx = middle.x - segment.a.x;
        const dy = middle.y - segment.a.y;
        const t = Math.max(0, Math.min(1, (dx * (segment.b.x - segment.a.x) + dy * (segment.b.y - segment.a.y)) / (segment.length * segment.length)));
        const px = segment.a.x + (segment.b.x - segment.a.x) * t;
        const py = segment.a.y + (segment.b.y - segment.a.y) * t;
        const dist = Math.hypot(px - middle.x, py - middle.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = segment.start + segment.length * t;
        }
      }
      return best;
    })();
    const from = midAt - half;
    const to = midAt + half;
    ctx.save();
    ctx.strokeStyle = C('#f7f4ec');
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (const segment of segments) {
      const s = Math.max(from, segment.start);
      const e = Math.min(to, segment.start + segment.length);
      if (e <= s) continue;
      const t0 = (s - segment.start) / segment.length;
      const t1 = (e - segment.start) / segment.length;
      ctx.beginPath();
      ctx.moveTo(segment.a.x + (segment.b.x - segment.a.x) * t0, segment.a.y + (segment.b.y - segment.a.y) * t0);
      ctx.lineTo(segment.a.x + (segment.b.x - segment.a.x) * t1, segment.a.y + (segment.b.y - segment.a.y) * t1);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawJunctionDots() {
    if (state.scene?.mode !== 'circuit' || state.ui?.symbol !== 'gb') return;
    const degree = new Map();
    for (const edge of state.scene.edges || []) {
      if (!edge.enabled) continue;
      for (const key of [edge.source, edge.target]) {
        degree.set(key, (degree.get(key) || 0) + 1);
      }
    }
    for (const node of state.scene.nodes || []) {
      const count = degree.get(node.id) || 0;
      if (count < 3 || node.kind === 'ground') continue;
      const center = nodeCenterScreen(node);
      ctx.beginPath();
      ctx.arc(center.x, center.y, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = C('#4d463c');
      ctx.fill();
      ctx.strokeStyle = C('#f7f4ec');
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }


  // R19：符号本地引脚几何（单位=世界单位；+x 为符号轴）
  const ELEMENT_PIN_GEOMETRY = {
    opamp: [
      { name: 'IN+', x: -6.5, y: -4.5, bind: 'vp', role: 'in' },
      { name: 'IN-', x: -6.5, y: 4.5, bind: 'vn', role: 'in' },
      { name: 'OUT', x: 8, y: 0, bind: 'source', role: 'out' },
    ],
    comparator: [
      { name: 'IN+', x: -6.5, y: -4.5, bind: 'vp', role: 'in' },
      { name: 'IN-', x: -6.5, y: 4.5, bind: 'vn', role: 'in' },
      { name: 'OUT', x: 8, y: 0, bind: 'source', role: 'out' },
    ],
    dflipflop: [
      { name: 'D', x: -7, y: -4, bind: 'd_node', role: 'in' },
      { name: 'CLK', x: -7, y: 4, bind: 'clk_node', role: 'in' },
      { name: 'Q', x: 7, y: 0, bind: 'source', role: 'out' },
    ],
    transformer: [
      { name: 'S1', x: -7.1, y: -9.6, bind: 'secondary_source', role: 'out' },
      { name: 'S2', x: 7.1, y: -9.6, bind: 'secondary_target', role: 'out' },
    ],
    coupling_inductor: [
      { name: 'S1', x: -7.1, y: -9.6, bind: 'secondary_source', role: 'out' },
      { name: 'S2', x: 7.1, y: -9.6, bind: 'secondary_target', role: 'out' },
    ],
    adc4: [
      { name: 'VIN', x: -7, y: -4, bind: 'vin_node', role: 'in' },
      { name: 'CLK', x: -7, y: 4, bind: 'clk_node', role: 'in' },
      { name: 'Q0', x: 7, y: -6, bind: 'source', role: 'out' },
      { name: 'Q1', x: 7, y: -2, bind: 'q1_node', role: 'out' },
      { name: 'Q2', x: 7, y: 2, bind: 'q2_node', role: 'out' },
      { name: 'Q3', x: 7, y: 6, bind: 'q3_node', role: 'out' },
      { name: 'COM', x: 0, y: 7, bind: 'target', role: 'power' },
    ],
  };

  function elementPins(edge) {
    return ELEMENT_PIN_GEOMETRY[edge.kind] || [
      { name: 'pin1', x: -18, y: 0, bind: 'source', role: 'passive' },
      { name: 'pin2', x: 18, y: 0, bind: 'target', role: 'passive' },
    ];
  }

  function elementLayoutCenter(edge, points) {
    if (edge.layout && Number.isFinite(edge.layout.x) && Number.isFinite(edge.layout.y)) {
      return worldToScreen(edge.layout);
    }
    return pathMidpoint(points) || { x: 0, y: 0 };
  }

  function elementRot(edge) {
    if (edge.layout && Number.isFinite(Number(edge.layout.rot))) return (Number(edge.layout.rot) * Math.PI) / 180;
    return 0;
  }

  function symbolScalePx() {
    // 与 drawCircuitGlyph 使用同一缩放：符号本地 1 单位 = 多少画布像素。
    const base = Math.max(2.0, Math.min(3.0, state.view.k * 2.4));
    return base * ((Number(state.ui?.symbolScale) || 1.2) / 1.2);
  }

  function pinScreenPoint(edge, pin, points, scale = 1) {
    const center = elementLayoutCenter(edge, points);
    const angle = elementRot(edge);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const unit = state.view.k * scale;
    const wx = center.x + (pin.x * cos - pin.y * sin) * unit;
    const wy = center.y + (pin.x * sin + pin.y * cos) * unit;
    return { x: wx, y: wy };
  }

  function edgeAnchorTowards(node, otherNode) {
    const other = nodeCenterScreen(otherNode);
    return anchorPoint(node, 'auto', other);
  }

  function circuitPinPath(edge, source, target) {
    if (state.scene?.mode !== 'circuit' || state.ui?.symbol !== 'gb') return null;
    if (edge.kind === 'wire') return null;
    if (!edge.layout) return null;
    // 手动布线的边以 waypoints 为准，不再被引脚吸附改写。
    if (edge.route === 'manual' && Array.isArray(edge.waypoints) && edge.waypoints.length) return null;
    const pins = elementPins(edge);
    if (pins.length !== 2) return null; // 多引脚元件的输出端单独处理
    const binds = new Set(pins.map((pin) => pin.bind));
    if (!binds.has('source') || !binds.has('target')) return null; // 参数绑定的 2 引脚（变压器副边等）
    const start = edgeAnchorTowards(source, target);
    const end = edgeAnchorTowards(target, source);
    const pin1 = pinScreenPoint(edge, pins[0], [start, end]);
    const pin2 = pinScreenPoint(edge, pins[1], [start, end]);
    return [start, pin1, pin2, end];
  }

  function wirePathPoints(edge, source, target) {
    const start = isPinNode(source)
      ? devicePinScreen(source, edge.source_pin)
      : anchorPoint(source, 'auto', nodeCenterScreen(target));
    const end = isPinNode(target)
      ? devicePinScreen(target, edge.target_pin)
      : anchorPoint(target, 'auto', nodeCenterScreen(source));
    let route = edge.route || 'auto';
    if (route === 'auto' && state.ui?.circuitOrthogonal !== false) route = 'orthogonal';
    if (route === 'manual' && Array.isArray(edge.waypoints) && edge.waypoints.length) {
      return [start, ...edge.waypoints.map((item) => worldToScreen(item)), end];
    }
    if (route === 'straight') return [start, end];
    if (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)) {
      const midX = (start.x + end.x) / 2;
      return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
    }
    const midY = (start.y + end.y) / 2;
    return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
  }

  function drawMultiPinWires(edge, color) {
    if (state.scene?.mode !== 'circuit' || state.ui?.symbol !== 'gb' || !edge.layout) return;
    const pins = elementPins(edge);
    // 多引脚元件（运放/ADC/变压器…）主路径不画，所有引脚都由这里接线；
    // 两端元件只补参数绑定的引脚（主路径已在 drawEdges 画出）。
    const multi = pins.length > 2;
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    if (!source || !target) return;
    const points = [nodeCenterScreen(source), nodeCenterScreen(target)];
    const center = elementLayoutCenter(edge, points);
    for (const pin of pins) {
      if (!pin.bind) continue;
      if (!multi && (pin.bind === 'source' || pin.bind === 'target')) continue;
      const nodeId = pin.bind === 'source'
        ? edge.source
        : pin.bind === 'target'
          ? edge.target
          : edge.params?.[pin.bind];
      const node = nodeId ? nodeById(nodeId) : null;
      if (!node) continue;
      const from = pinScreenPoint(edge, pin, points, symbolScalePx());
      const to = anchorPoint(node, 'auto', center);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.0;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(to.x, to.y, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = C('#f7f4ec');
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  function elementIdentifier(edge) {
    // GB 标识：位号 + 极性/类型简称；名称本身已是 R1/C1 时直接用。
    const name = String(edge.name || '');
    const kind = String(edge.kind || '');
    if (name) return name;
    const prefix = {
      resistor: 'R', capacitor: 'C', inductor: 'L', diode: 'D', led: 'LED',
      zener: 'ZD', vsource: 'V', isource: 'I', switch: 'S', opamp: 'U',
      comparator: 'U', dflipflop: 'U', vcvs: 'E', vccs: 'G',
      npn: 'Q', pnp: 'Q', nmos: 'Q', pmos: 'Q',
      transformer: 'T', coupling_inductor: 'L', adc4: 'U',
    }[kind] || kind.slice(0, 2).toUpperCase();
    return `${prefix}?`;
  }


  function segmentIntersection(a, b, c, d) {
    const r = { x: b.x - a.x, y: b.y - a.y };
    const s = { x: d.x - c.x, y: d.y - c.y };
    const denom = r.x * s.y - r.y * s.x;
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
    const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
    if (t <= 0.02 || t >= 0.98 || u <= 0.02 || u >= 0.98) return null;
    return { x: a.x + r.x * t, y: a.y + r.y * t };
  }

  function circuitCrossingMap(edges) {
    const map = new Map();
    if (state.scene?.mode !== 'circuit' || state.ui?.symbol !== 'gb' || edges.length > 160) return map;
    const paths = edges.map((edge) => ({ id: edge.id, points: edgePathPoints(edge) || [] }));
    for (let i = 0; i < paths.length; i += 1) {
      for (let j = i + 1; j < paths.length; j += 1) {
        const first = paths[i];
        const second = paths[j];
        if (!first.points.length || !second.points.length) continue;
        const points = [];
        for (let a = 1; a < first.points.length; a += 1) {
          for (let b = 1; b < second.points.length; b += 1) {
            const hit = segmentIntersection(first.points[a - 1], first.points[a], second.points[b - 1], second.points[b]);
            if (hit) points.push(hit);
          }
        }
        if (points.length) map.set(second.id, [...(map.get(second.id) || []), ...points]);
      }
    }
    return map;
  }

  function drawCrossingHops(points, color) {
    for (const point of points) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = C('#f7f4ec');
      ctx.fill();
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4.2, Math.PI * 1.05, Math.PI * 1.95);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.restore();
    }
  }

  function labelCollisionFree(cx, cy, width, height, occupied) {
    const candidates = [
      [0, 0], [0, -14], [0, 14], [0, -28], [0, 28],
      [width / 2 + 12, 0], [-width / 2 - 12, 0],
    ];
    for (const [dx, dy] of candidates) {
      const rect = { x: cx + dx - width / 2, y: cy + dy - height / 2, w: width, h: height };
      const hit = occupied.some((item) =>
        rect.x < item.x + item.w && rect.x + rect.w > item.x && rect.y < item.y + item.h && rect.y + rect.h > item.y);
      if (!hit) return rect;
    }
    return { x: cx - width / 2, y: cy - height / 2, w: width, h: height };
  }

  function drawDrawingFrame(width, height) {
    const margin = 18;
    ctx.save();
    ctx.strokeStyle = C('#4d463c');
    ctx.lineWidth = 1.4;
    ctx.strokeRect(margin, margin, width - margin * 2, height - margin * 2);
    const boxW = 300;
    const boxH = 62;
    const x = width - margin - boxW;
    const y = height - margin - boxH;
    ctx.fillStyle = C('#fffdf8');
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeRect(x, y, boxW, boxH);
    ctx.fillStyle = C('#11100e');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '600 11px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText(state.project?.name || '未命名工程', x + 10, y + 16);
    ctx.font = '9px "Cascadia Code", Consolas, monospace';
    ctx.fillStyle = C('#6f695f');
    ctx.fillText(`${state.currentNetwork?.name || '网络'} · ${state.scene?.mode || ''} · R19`, x + 10, y + 34);
    ctx.fillText(new Date().toISOString().slice(0, 19).replace('T', ' '), x + 10, y + 50);
    ctx.restore();
  }


  function circuitPinSegments(edge, source, target) {
    if (state.scene?.mode !== 'circuit' || state.ui?.symbol !== 'gb' || !edge.layout) return null;
    const pins = elementPins(edge);
    if (pins.length !== 2) return null;
    const start = edgeAnchorTowards(source, target);
    const end = edgeAnchorTowards(target, source);
    const pin1 = pinScreenPoint(edge, pins[0], [start, end]);
    const pin2 = pinScreenPoint(edge, pins[1], [start, end]);
    const horizontal = Math.abs(Math.cos(elementRot(edge))) > 0.5;
    const before = horizontal
      ? [start, { x: pin1.x, y: start.y }, { x: pin1.x, y: pin1.y }, pin1]
      : [start, { x: start.x, y: pin1.y }, { x: pin1.x, y: pin1.y }, pin1];
    const after = horizontal
      ? [pin2, { x: pin2.x, y: end.y }, { x: end.x, y: end.y }, end]
      : [pin2, { x: pin2.x, y: end.y }, { x: end.x, y: end.y }, end];
    return { before, after };
  }

  function drawEdges(now) {
    const edges = (state.scene?.edges || []).slice().sort((a, b) => {
      if (a.id === state.selection.id) return 1;
      if (b.id === state.selection.id) return -1;
      return 0;
    });
    const crossingMap = circuitCrossingMap(edges);
    const occupiedLabels = [];
    for (const edge of edges) {
      const points = edgePathPoints(edge);
      if (!points || points.length < 2) continue;
      const selected =
        (state.selection.type === 'edge' && state.selection.id === edge.id) ||
        state.multi?.edges?.has(edge.id);
      const hovered = state.hover?.type === 'edge' && state.hover.id === edge.id;
      let color = '#a49a89';
      if (!edge.enabled) color = '#d3ccbc';
      else if (edge.delay) color = '#b0762a';
      if (selected) color = C('#a8541f');
      else if (hovered) color = '#5f584e';

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      ctx.lineWidth = selected ? 2.1 : hovered ? 1.7 : 1.15;
      if (!edge.enabled) ctx.setLineDash([3, 5]);
      else if (edge.delay) ctx.setLineDash([7, 5]);
      const circuitGb = state.scene?.mode === 'circuit' && state.ui?.symbol === 'gb';
      const multiPin = circuitGb && elementPins(edge).length > 2;
      if (!multiPin) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) {
          ctx.lineTo(points[index].x, points[index].y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);

      if (circuitGb) {
        const hops = crossingMap.get(edge.id);
        if (hops && hops.length) drawCrossingHops(hops, color);
        drawMultiPinWires(edge, color);
        const middle = pathMidpoint(points);
        const layout = edge.layout || null;
        const center = layout && Number.isFinite(layout.x) && Number.isFinite(layout.y)
          ? worldToScreen({ x: layout.x, y: layout.y })
          : middle;
        if (center && !multiPin && edge.kind !== 'wire') circuitWireGap(points, center, 40 * Math.max(1.2, state.view.k));
        drawCircuitGlyph(edge, points, color);
      } else {
        const angle = pathEndAngle(points);
        const tip = points[points.length - 1];
        const size = selected ? 8 : 6;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x - size * Math.cos(angle - 0.42), tip.y - size * Math.sin(angle - 0.42));
        ctx.lineTo(tip.x - size * Math.cos(angle + 0.42), tip.y - size * Math.sin(angle + 0.42));
        ctx.closePath();
        ctx.fill();
      }

      if (state.view.k > 0.38 && edge.kind !== 'wire') {
        const middle = pathMidpoint(points);
        const label = edge.delay ? `${edge.name}  z⁻¹` : elementIdentifier(edge);
        const labelRot = edge.layout && Number.isFinite(Number(edge.layout.rot))
          ? (Number(edge.layout.rot) * Math.PI) / 180
          : circuitMidAngle(points);
        const vertical = Math.abs(Math.sin(circuitGb ? labelRot : 0)) > 0.5;
        let labelX = middle.x;
        let labelY = middle.y - (circuitGb ? (vertical ? 0 : 24) : 16);
        ctx.textAlign = 'center';
        if (circuitGb && vertical) {
          labelX = middle.x + 20;
          labelY = middle.y - 2;
          ctx.textAlign = 'left';
        }
        ctx.font = '9px "Cascadia Code", Consolas, monospace';
        ctx.textBaseline = 'middle';
        const textWidth = ctx.measureText(label).width;
        const boxW = textWidth + 8;
        const labelRect = labelCollisionFree(
          ctx.textAlign === 'left' ? labelX + boxW / 2 : labelX,
          labelY,
          boxW,
          12,
          occupiedLabels,
        );
        occupiedLabels.push(labelRect);
        if (ctx.textAlign === 'left') {
          labelX = labelRect.x + 4;
        } else {
          labelX = labelRect.x + boxW / 2;
        }
        labelY = labelRect.y + 6;
        const boxLeft = labelRect.x;
        ctx.fillStyle = 'rgba(247, 244, 236, 0.92)';
        ctx.fillRect(boxLeft, labelY - 6, boxW, 12);
        ctx.fillStyle = selected ? C('#a8541f') : '#7b7266';
        ctx.fillText(label, labelX, labelY);
        if (selected && !circuitGb) {
          const value = edgeValueText(edge);
          if (value) {
            ctx.fillStyle = C('#1f5f5b');
            ctx.font = '9px "Cascadia Code", Consolas, monospace';
            ctx.fillText(value, middle.x, middle.y + 5);
          }
        }
      }

      if (selected) {
        const handles = [
          { p: points[0], end: 'source' },
          { p: points[points.length - 1], end: 'target' },
        ];
        for (const handle of handles) {
          const active = state.drag?.type === 'endpoint' && state.drag.id === edge.id && state.drag.end === handle.end;
          ctx.beginPath();
          ctx.arc(handle.p.x, handle.p.y, active ? 6 : 4.5, 0, Math.PI * 2);
          ctx.fillStyle = active ? C('#a8541f') : C('#faf8f2');
          ctx.fill();
          ctx.strokeStyle = C('#a8541f');
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        if (state.drag?.type === 'endpoint' && state.drag.id === edge.id) {
          const node = nodeById(state.drag.end === 'source' ? edge.source : edge.target);
          if (node && state.drag.anchor !== 'auto') {
            const snapPoint = anchorScreenPoint(node, state.drag.anchor);
            ctx.beginPath();
            ctx.arc(snapPoint.x, snapPoint.y, 7, 0, Math.PI * 2);
            ctx.fillStyle = C('rgba(168, 84, 31, 0.18)');
            ctx.fill();
            ctx.strokeStyle = C('#a8541f');
            ctx.lineWidth = 1.4;
            ctx.stroke();
          }
        }
      }

      if (edge.route === 'manual' && (selected || state.drag?.type === 'waypoint' || state.hoverWaypoint?.edgeId === edge.id)) {
        for (const item of edge.waypoints || []) {
          const point = worldToScreen(item.x, item.y);
          const index = (edge.waypoints || []).indexOf(item);
          const active = (state.drag?.type === 'waypoint' && state.drag.id === edge.id && state.drag.index === index)
            || (state.hoverWaypoint?.edgeId === edge.id && state.hoverWaypoint.index === index);
          ctx.beginPath();
          ctx.arc(point.x, point.y, active ? 6.5 : 5, 0, Math.PI * 2);
          ctx.fillStyle = active ? C('#a8541f') : C('#faf8f2');
          ctx.fill();
          ctx.strokeStyle = C('#a8541f');
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }

      const totalEdges = state.scene?.edges?.length || 0;
      if (state.sim?.running && edge.enabled && (totalEdges <= 220 || selected)) {
        const phase = (now / 1600 + (hashString(edge.id) % 997) / 997) % 1;
        for (let index = 0; index < 2; index += 1) {
          const t = (phase + index / 2) % 1;
          const point = pathPointAt(points, t);
          ctx.beginPath();
          ctx.arc(point.x, point.y, selected ? 2.0 : 1.35, 0, Math.PI * 2);
          ctx.fillStyle = edge.delay ? C('rgba(176,118,42,.8)') : C('rgba(168,84,31,.7)');
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }


  function drawGbCircuitNode(ctx, node, cx, cy, radius, accent, isSelected, isHovered, k) {
    const style = state.ui?.nodeStyle || 'circle';
    const color = isSelected ? C('#a8541f') : isHovered ? '#5f584e' : '#7b7266';
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = C('#faf8f2');
    ctx.lineWidth = isSelected ? 1.8 : 1.2;
    if (node.kind === 'ground') {
      const top = cy - radius * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx, cy + 2);
      ctx.stroke();
      const bars = [[15, 6], [10, 10], [5, 14]];
      for (const [width, offset] of bars) {
        ctx.beginPath();
        ctx.moveTo(cx - width / 2, cy + offset);
        ctx.lineTo(cx + width / 2, cy + offset);
        ctx.stroke();
      }
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(radius, 12) + 4, 0, Math.PI * 2);
        ctx.strokeStyle = C('rgba(168, 84, 31, 0.45)');
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    if (style === 'dot') {
      ctx.beginPath();
      ctx.arc(cx, cy, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? C('#a8541f') : accent;
      ctx.fill();
    } else if (style === 'box') {
      ctx.beginPath();
      ctx.rect(cx - 10, cy - 7, 20, 14);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(cx, cy, 10.5, 0, Math.PI * 2);
      ctx.strokeStyle = C('rgba(168, 84, 31, 0.6)');
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGbFunctionGlyph(ctx, node, cx, cy, radius, accent, isSelected, isHovered, k) {
    const color = isSelected ? C('#a8541f') : isHovered ? '#5f584e' : accent;
    const R = radius * 0.92;
    const fontPx = Math.max(10, Math.round(R * 0.8));
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = isSelected ? 1.8 : clamp(1.15 * k, 0.9, 1.8);
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${fontPx}px "Cascadia Code", Consolas, monospace`;
    const kind = node.kind;
    if (kind === 'sum') {
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText('Σ', cx, cy + 1);
    } else if (kind === 'gain') {
      ctx.beginPath();
      ctx.moveTo(cx - R * 0.72, cy - R * 0.75);
      ctx.lineTo(cx - R * 0.72, cy + R * 0.75);
      ctx.lineTo(cx + R * 0.9, cy);
      ctx.closePath();
      ctx.stroke();
      ctx.font = `600 ${Math.round(fontPx * 0.72)}px "Cascadia Code", Consolas, monospace`;
      ctx.fillText('K', cx - R * 0.18, cy + 1);
    } else if (kind === 'integrate') {
      ctx.strokeRect(cx - R * 0.62, cy - R * 0.58, R * 1.24, R * 1.16);
      ctx.fillText('∫', cx, cy + 1);
    } else if (kind === 'lag') {
      ctx.strokeRect(cx - R * 0.66, cy - R * 0.58, R * 1.32, R * 1.16);
      ctx.font = `600 ${Math.round(fontPx * 0.62)}px "Cascadia Code", Consolas, monospace`;
      ctx.fillText('1/(1+τs)', cx, cy + 1);
    } else if (kind === 'expression') {
      ctx.strokeRect(cx - R * 0.62, cy - R * 0.55, R * 1.24, R * 1.1);
      ctx.fillText('f(x)', cx, cy + 1);
    } else if (kind === 'oscillator') {
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.82, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText('~', cx, cy + 1);
    } else if (kind === 'signal') {
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.82, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText('s', cx, cy + 1);
    } else if (kind === 'manual') {
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.82, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText('M', cx, cy + 1);
    } else if (kind === 'module_input' || kind === 'module_output') {
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.7, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText(kind === 'module_input' ? 'I' : 'O', cx, cy + 1);
    } else if (kind === 'block') {
      const hw = R * 0.72;
      const hh = R * 0.5;
      ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
      ctx.font = `600 ${Math.round(fontPx * 0.7)}px "Cascadia Code", Consolas, monospace`;
      ctx.fillText('B', cx, cy + 1);
    } else {
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.72, 0, Math.PI * 2); ctx.stroke();
      ctx.font = `600 ${Math.round(fontPx * 0.55)}px "Cascadia Code", Consolas, monospace`;
      ctx.fillText(String(nodeKindLabel(node) || kind).slice(0, 2), cx, cy + 1);
    }
    ctx.restore();
  }

  function drawGbDeviceNode(ctx, node, rect, accent, isSelected, isHovered, k) {
    const color = isSelected ? C('#a8541f') : isHovered ? '#5f584e' : accent;
    const inactive = Boolean(state.sim?.running) && deviceInactive(node);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 1.8 : 1.2;
    ctx.fillStyle = C('#faf8f2');
    if (inactive) {
      // R21/D43：运行中未参与求解的器件红色辉光（停止后恢复）。
      ctx.save();
      ctx.shadowColor = 'rgba(220, 38, 38, 0.95)';
      ctx.shadowBlur = 16 * k;
      ctx.strokeStyle = C('#dc2626');
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 1.8 : 1.2;
    }
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.fill();
    ctx.stroke();
    const spec = deviceElementSpec(node);
    const cx = rect.cx;
    const cy = rect.cy;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${clamp(9 * k, 7, 12)}px "Cascadia Code", Consolas, monospace`;
    ctx.fillText(spec?.label || node.params?.block_name || node.params?.element || '器件', cx, cy);
    const showNames = k > 0.55 && state.ui.showPins !== false;
    for (const pin of devicePins(node)) {
      const local = devicePinLocal(node, pin);
      const px = cx + local.x * k;
      const py = cy + local.y * k;
      const inwardX = local.side === 'left' ? 1 : local.side === 'right' ? -1 : 0;
      const inwardY = local.side === 'bottom' ? -1 : local.side === 'top' ? 1 : 0;
      if (inwardX || inwardY) {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + inwardX * 8 * k, py + inwardY * 8 * k);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(px, py, 2.8 * k, 0, Math.PI * 2);
      ctx.fillStyle = pin.required ? color : '#9a9080';
      ctx.fill();
      if (showNames) {
        const label = deviceSupplyLabel(node, pin);
        ctx.fillStyle = C('#6f695f');
        ctx.font = `${clamp(6.5 * k, 4.5, 9)}px "Cascadia Code", Consolas, monospace`;
        if (local.side === 'left') {
          ctx.textAlign = 'right';
          ctx.fillText(label, px - 7 * k, py);
        } else if (local.side === 'right') {
          ctx.textAlign = 'left';
          ctx.fillText(label, px + 7 * k, py);
        } else if (local.side === 'top') {
          ctx.textAlign = 'center';
          ctx.fillText(label, px, py - 10 * k);
        } else {
          ctx.textAlign = 'center';
          ctx.fillText(label, px, py + 10 * k);
        }
      }
    }
    const implicitPin = deviceImplicitGroundPin(node);
    if (implicitPin) {
      // R21/D43：单端电源的空脚画接地标记（可见，不是隐藏接地）。
      const local = devicePinLocal(node, devicePins(node).find((pin) => pin.name === implicitPin));
      const gx = cx + local.x * k;
      const gy = cy + local.y * k;
      const dir = local.side === 'top' ? -1 : 1;
      ctx.strokeStyle = C('#6f695f');
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx, gy + dir * 6 * k);
      ctx.stroke();
      for (let row = 0; row < 3; row += 1) {
        const half = (5 - row * 1.4) * k;
        const y = gy + dir * (6 + row * 4) * k;
        ctx.beginPath();
        ctx.moveTo(gx - half, y);
        ctx.lineTo(gx + half, y);
        ctx.stroke();
      }
      if (showNames) {
        ctx.fillStyle = C('#6f695f');
        ctx.font = `${clamp(6 * k, 4.2, 8.5)}px "Cascadia Code", Consolas, monospace`;
        ctx.textAlign = 'center';
        ctx.fillText('自动接地', gx, gy + dir * 22 * k);
      }
    }
    ctx.restore();
  }

  function drawNodes() {
    const nodes = (state.scene?.nodes || []).slice();
    const selected = selectedNode();
    if (selected) {
      const index = nodes.findIndex((node) => node.id === selected.id);
      if (index >= 0) {
        nodes.splice(index, 1);
        nodes.push(selected);
      }
    }
    const k = state.view.k;
    const showDetail = k > 0.38;
    const showValue = k > 0.52;
    const nameSize = clamp(12.5 * k, 6.5, 17);
    const metaSize = clamp(7.5 * k, 5, 11);
    const valueSize = clamp(8.6 * k, 5, 12);

    for (const node of nodes) {
      const rect = nodeRect(node);
      if (rect.x + rect.w < -50 || rect.y + rect.h < -50 || rect.x > state.canvasSize.w + 50 || rect.y > state.canvasSize.h + 50) {
        continue;
      }
      const isPrimary = state.selection.type === 'node' && state.selection.id === node.id;
      const isSelected = isPrimary || state.multi?.nodes?.has(node.id);
      const isHovered = state.hover?.type === 'node' && state.hover.id === node.id;
      const accent = nodeColor(node);
      const cx = rect.cx;
      const cy = rect.cy;
      const radius = rect.r;

      ctx.save();
      const gbStyle = state.ui?.symbol === 'gb';
      const isDeviceNode = isPinNode(node);
      let customLabel = false;
      if (isDeviceNode) {
        customLabel = true;
        drawGbDeviceNode(ctx, node, rect, accent, isSelected, isHovered, k);
      } else if (gbStyle) {
        customLabel = true;
        const isCircuitTerminal = state.scene?.mode === 'circuit'
          && (node.kind === 'node' || node.kind === 'ground');
        if (isCircuitTerminal) {
          drawGbCircuitNode(ctx, node, cx, cy, radius, accent, isSelected, isHovered, k);
        } else {
          drawGbFunctionGlyph(ctx, node, cx, cy, radius, accent, isSelected, isHovered, k);
        }
      } else {
        // 外圈与纸面圆盘
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = isSelected ? C('#a8541f') : isHovered ? '#8e8477' : C('#cfc6b5');
        ctx.lineWidth = isSelected ? 1.6 : 1;
        if (!isSelected && !isHovered) ctx.setLineDash([2, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? '#f7ecdf' : C('#faf8f2');
        ctx.fill();
        ctx.strokeStyle = isSelected ? C('#a8541f') : C('#bcb3a1');
        ctx.lineWidth = isSelected ? 1.5 : 1;
        ctx.stroke();

        // 顶部彩色弧线，作为类型标识
        ctx.beginPath();
        ctx.arc(cx, cy, radius - 2.5, -Math.PI * 0.78, -Math.PI * 0.22);
        ctx.strokeStyle = accent;
        ctx.lineWidth = clamp(2.4 * k, 1.2, 3.5);
        ctx.stroke();
      }

      // 矢量箭头：优先速度，其次位置 / 状态
      const vector = vectorForNode(node);
      if (vector) {
        // 画布 y 轴向下；物理平面 y 轴向上，因此取反。
        const angle = Math.atan2(-vector.vy, vector.vx);
        const length = radius + clamp(7 + 13 * Math.tanh(vector.magnitude), 7, 26);
        const sx = cx + Math.cos(angle) * (radius * 0.38);
        const sy = cy + Math.sin(angle) * (radius * 0.38);
        const ex = cx + Math.cos(angle) * length;
        const ey = cy + Math.sin(angle) * length;
        ctx.strokeStyle = vector.source === 'velocity' ? C('rgba(168, 84, 31, .5)') : C('rgba(31, 95, 91, .45)');
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.fillStyle = vector.source === 'velocity' ? C('rgba(168, 84, 31, .8)') : C('rgba(31, 95, 91, .75)');
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - 5 * Math.cos(angle - 0.42), ey - 5 * Math.sin(angle - 0.42));
        ctx.lineTo(ex - 5 * Math.cos(angle + 0.42), ey - 5 * Math.sin(angle + 0.42));
        ctx.closePath();
        ctx.fill();
      }

      if (showDetail && !customLabel) {
        const pad = radius * 0.3;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = accent;
        ctx.font = `600 ${metaSize}px "Cascadia Code", Consolas, monospace`;
        ctx.fillText(nodeKindLabel(node), cx, cy - radius * 0.56, radius * 1.42);

        ctx.fillStyle = C('#11100e');
        ctx.font = `700 ${nameSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
        const maxNameWidth = radius * 1.55;
        let name = node.name;
        if (ctx.measureText(name).width > maxNameWidth) {
          while (name.length > 2 && ctx.measureText(`${name}…`).width > maxNameWidth) name = name.slice(0, -1);
          name += '…';
        }
        ctx.fillText(name, cx, cy - radius * 0.06);

        if (showValue) {
          ctx.fillStyle = node.kind === 'ground' ? C('#6f695f') : C('#6f695f');
          ctx.font = `${valueSize}px "Cascadia Code", Consolas, monospace`;
          const text = node.kind === 'ground' ? '0 V · REF' : nodeValueText(node);
          ctx.fillText(text, cx, cy + radius * 0.38, radius * 1.55);
        }

        if (isSelected) {
          ctx.fillStyle = C('#a8541f');
          ctx.font = `600 ${metaSize}px "Cascadia Code", Consolas, monospace`;
          ctx.fillText('●', cx, cy - radius - 13);
          ctx.fillStyle = C('#7b7266');
          ctx.font = `${metaSize}px "Cascadia Code", Consolas, monospace`;
          ctx.fillText(node.id.slice(-4), cx + radius * 0.9, cy - radius - 13);
        }
      } else if (showDetail && customLabel) {
        const nameSize2 = clamp(10.5 * k, 6.5, 13);
        const valueSize2 = clamp(8.6 * k, 5, 12);
        const labelY = node.kind === 'device'
          ? rect.y + rect.h + Math.max(11, 11 * k)
          : cy + (radius < 20 ? Math.max(14, radius + 8) : radius * 0.62);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = C('#11100e');
        ctx.font = `600 ${nameSize2}px "Segoe UI", "Microsoft YaHei", sans-serif`;
        ctx.fillText(node.name, cx, labelY, 96);
        if (showValue && state.scene?.mode !== 'circuit') {
          ctx.fillStyle = C('#6f695f');
          ctx.font = `${valueSize2}px "Cascadia Code", Consolas, monospace`;
          const text = node.kind === 'ground' ? '0 V · REF' : nodeValueText(node);
          ctx.fillText(text, cx, labelY + nameSize2 + 3, 96);
        }
      } else {
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (isSelected) {
        const tick = 6;
        ctx.strokeStyle = C('#a8541f');
        ctx.lineWidth = 1;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          ctx.beginPath();
          ctx.moveTo(cx + dx * (radius + 7), cy + dy * (radius + 7));
          ctx.lineTo(cx + dx * (radius + 7 + tick), cy + dy * (radius + 7 + tick));
          ctx.stroke();
        }
      }

      // 端口：电路 GB 小节点沿实际连线方向；其他模式保持左入右出
      const portRadius = clamp(3.4 * k, 2, 5);
      const circuitPorts = state.scene?.mode === 'circuit'
        && !state.ui?.drawingMode
        && state.ui?.symbol === 'gb'
        && state.ui?.nodeStyle !== 'box'
        && (node.kind === 'node' || node.kind === 'ground');
      if (circuitPorts) {
        const points = [];
        for (const edge of state.scene.edges || []) {
          if (!edge.enabled || (edge.source !== node.id && edge.target !== node.id)) continue;
          const other = nodeById(edge.source === node.id ? edge.target : edge.source);
          if (!other) continue;
          const otherCenter = nodeCenterScreen(other);
          const anchor = edge.source === node.id
            ? (edge.anchors?.source || 'auto')
            : (edge.anchors?.target || 'auto');
          const point = anchorPoint(node, anchor, otherCenter);
          if (!points.some((item) => Math.hypot(item.x - point.x, item.y - point.y) < 2)) points.push(point);
        }
        for (const point of points) {
          ctx.beginPath();
          ctx.arc(point.x, point.y, portRadius - 0.4, 0, Math.PI * 2);
          ctx.fillStyle = C('#faf8f2');
          ctx.fill();
          ctx.strokeStyle = C('#8e8477');
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.restore();
        continue;
      }
      const inPoint = { x: cx - radius, y: cy };
      const outPoint = { x: cx + radius, y: cy };
      const linkingSource = state.drag?.type === 'link' && state.drag.sourceId === node.id;
      ctx.fillStyle = C('#faf8f2');
      ctx.strokeStyle = C('#8e8477');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(inPoint.x, inPoint.y, portRadius - 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(outPoint.x, outPoint.y, linkingSource ? portRadius + 1.5 : portRadius, 0, Math.PI * 2);
      ctx.fillStyle = linkingSource ? C('#a8541f') : C('#faf8f2');
      ctx.strokeStyle = linkingSource ? C('#a8541f') : accent;
      ctx.lineWidth = 1.2;
      ctx.fill();
      ctx.stroke();

      if (isPrimary) {
        // 尺寸手柄：右下角，拖动改变节点直径（R09）
        const hx = cx + radius - 2;
        const hy = cy + radius - 2;
        ctx.fillStyle = C('#faf8f2');
        ctx.strokeStyle = C('#a8541f');
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.rect(hx - 4, hy - 4, 8, 8);
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  function drawLinkPreview() {
    const tool = state.wireTool;
    if (tool?.first) {
      const first = tool.first;
      const node = nodeById(first.nodeId);
      if (!node) return;
      const start = first.kind === 'pin'
        ? devicePinScreen(node, first.pin)
        : worldToScreen(node.position || { x: 0, y: 0 });
      const end = state.pointer
        ? { x: state.pointer.x, y: state.pointer.y }
        : start;
      ctx.save();
      ctx.strokeStyle = C('rgba(168, 84, 31, .55)');
      ctx.lineWidth = 1.7;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(start.x, start.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = C('rgba(168, 84, 31, .25)');
      ctx.fill();
      ctx.strokeStyle = C('#a8541f');
      ctx.stroke();
      ctx.restore();
      return;
    }
    const drag = state.drag;
    if (!drag || (drag.type !== 'link' && drag.type !== 'pin')) return;
    const source = nodeById(drag.sourceId);
    if (!source) return;
    const start = drag.type === 'pin'
      ? devicePinScreen(source, drag.pin)
      : portOut(source);
    const target = drag.targetId ? nodeById(drag.targetId) : null;
    const end = target ? portIn(target) : { x: state.pointer.x, y: state.pointer.y };
    const bend = Math.max(34, Math.abs(end.x - start.x) * 0.35);
    ctx.save();
    ctx.strokeStyle = target ? C('#a8541f') : C('rgba(168, 84, 31, .45)');
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.bezierCurveTo(start.x + bend, start.y, end.x - bend, end.y, end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(end.x, end.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = C('#a8541f');
    ctx.fill();
    ctx.restore();
  }

  function drawGraph() {
    const { w, h, dpr } = state.canvasSize;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawGrid(w, h);

    if (!state.scene || !(state.scene.nodes || []).length) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = C('#8e8477');
      ctx.font = '13px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillText('画布为空 · 点击左侧「节点」或从「场景」载入模板', w / 2, h / 2);
      ctx.font = '10px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = C('#a49a89');
      ctx.fillText('拖拽移动 · 从右侧端口拖出连接 · 滚轮缩放 · 双击编辑', w / 2, h / 2 + 24);
      ctx.restore();
      return;
    }

    drawEdges(performance.now());
    drawLinkPreview();
    drawNodes();
    drawSelectionBox();
    drawDragHud();
    if (state.ui?.drawingMode) drawDrawingFrame(w, h);
  }

  function drawSelectionBox() {
    const drag = state.drag;
    if (!drag || drag.type !== 'box') return;
    const x = Math.min(drag.startX, drag.x);
    const y = Math.min(drag.startY, drag.y);
    const w = Math.abs(drag.x - drag.startX);
    const h = Math.abs(drag.y - drag.startY);
    ctx.save();
    ctx.fillStyle = C('rgba(168, 84, 31, .08)');
    ctx.strokeStyle = C('rgba(168, 84, 31, .65)');
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawDragHud() {
    const { w, h } = state.canvasSize;
    const drag = state.drag;
    let target = null;
    let label = '';
    if (drag && drag.type === 'waypoint') {
      const edge = edgeById(drag.id);
      const point = edge?.waypoints?.[drag.index];
      if (point) {
        target = worldToScreen(point);
        label = `拐点 ${drag.index + 1}`;
      }
    } else if (drag && drag.type === 'node') {
      const node = nodeById(drag.id);
      if (node?.position) {
        target = worldToScreen(node.position);
        label = '节点';
      }
    } else if (drag && drag.type === 'endpoint') {
      const pointer = state.pointer;
      if (pointer) {
        target = { x: pointer.x, y: pointer.y };
        label = '端点';
      }
    } else if (state.hoverWaypoint) {
      const edge = edgeById(state.hoverWaypoint.edgeId);
      const point = edge?.waypoints?.[state.hoverWaypoint.index];
      if (point) {
        target = worldToScreen(point);
        label = `拐点 ${state.hoverWaypoint.index + 1}`;
      }
    }
    if (!target) return;
    const world = screenToWorld(target.x, target.y);
    ctx.save();
    // 十字准线：让用户看清拐点落在网格的哪里。
    ctx.strokeStyle = C('rgba(168, 84, 31, .28)');
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(0, target.y);
    ctx.lineTo(w, target.y);
    ctx.moveTo(target.x, 0);
    ctx.lineTo(target.x, h);
    ctx.stroke();
    ctx.setLineDash([]);
    // 拐点标记
    ctx.beginPath();
    ctx.arc(target.x, target.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = C('rgba(168, 84, 31, .18)');
    ctx.fill();
    ctx.strokeStyle = C('#a8541f');
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // 坐标标签（画布内偏移，避免贴边裁切）
    const text = `${label}  x ${world.x.toFixed(1)}  y ${world.y.toFixed(1)}`;
    ctx.font = '11px "Cascadia Code", Consolas, monospace';
    const padding = 7;
    const textWidth = ctx.measureText(text).width;
    const boxW = textWidth + padding * 2;
    const boxH = 22;
    let bx = target.x + 16;
    let by = target.y + 16;
    if (bx + boxW > w - 8) bx = target.x - 16 - boxW;
    if (by + boxH > h - 8) by = target.y - 16 - boxH;
    ctx.fillStyle = 'rgba(250, 248, 242, .96)';
    ctx.strokeStyle = C('rgba(168, 84, 31, .75)');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect
      ? ctx.roundRect(bx, by, boxW, boxH, 4)
      : ctx.rect(bx, by, boxW, boxH);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C('#5a3a24');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + padding, by + boxH / 2 + 0.5);
    ctx.restore();
  }

  function requestDraw() {
    state.needsDraw = true;
  }

  function animationLoop(timestamp) {
    if (state.shuttingDown) return;
    if (state.workspace === 'network') {
      if (state.sim?.running && timestamp - (state.lastPaint || 0) >= 33) {
        state.lastPaint = timestamp;
        state.needsDraw = false;
        drawGraph();
      } else if (state.needsDraw) {
        state.needsDraw = false;
        drawGraph();
      }
    }
    requestAnimationFrame(animationLoop);
  }

  function fitView(announce = false) {
    const nodes = state.scene?.nodes || [];
    const { w, h } = state.canvasSize;
    if (!nodes.length) {
      state.view = { x: w / 2, y: h / 2, k: 1 };
      requestDraw();
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.position.x - NODE_W / 2);
      maxX = Math.max(maxX, node.position.x + NODE_W / 2);
      minY = Math.min(minY, node.position.y - NODE_H / 2);
      maxY = Math.max(maxY, node.position.y + NODE_H / 2);
    }
    const margin = 90;
    const boxW = Math.max(1, maxX - minX + margin * 2);
    const boxH = Math.max(1, maxY - minY + margin * 2);
    const k = clamp(Math.min(w / boxW, h / boxH), 0.12, 1.5);
    state.view = {
      k,
      x: w / 2 - ((minX + maxX) / 2) * k,
      y: h / 2 - ((minY + maxY) / 2) * k,
    };
    requestDraw();
    ui.zoomBadge.textContent = `${Math.round(k * 100)}%`;
    if (announce) toast('已适配视图', 'info', 1200);
  }

  function zoomAt(factor, screenX, screenY) {
    const next = clamp(state.view.k * factor, 0.12, 3.2);
    const ratio = next / state.view.k;
    state.view.x = screenX - (screenX - state.view.x) * ratio;
    state.view.y = screenY - (screenY - state.view.y) * ratio;
    state.view.k = next;
    ui.zoomBadge.textContent = `${Math.round(next * 100)}%`;
    requestDraw();
  }

  function zoomCenter(factor) {
    zoomAt(factor, state.canvasSize.w / 2, state.canvasSize.h / 2);
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function distance(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }

  function hitTest(x, y) {
    const nodes = state.scene?.nodes || [];
    if (!nodes.length) return null;

    if (state.scene?.mode === 'circuit' && state.view.k > 0.25) {
      const radius = Math.max(7, 7 * state.view.k);
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index];
        if (node.kind !== 'device') continue;
        for (const pin of devicePins(node)) {
          const point = devicePinScreen(node, pin.name);
          if (distance(x, y, point.x, point.y) <= radius) {
            return { type: 'pin', id: node.id, node, pin: pin.name };
          }
        }
      }
    }
    if (state.view.k > 0.25) {
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index];
        const out = portOut(node);
        if (distance(x, y, out.x, out.y) <= Math.max(9, 8 * state.view.k)) {
          return { type: 'port', id: node.id, node };
        }
      }
    }

    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      const rect = nodeRect(node);
      if (rect.shape === 'rect'
        ? (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h)
        : distance(x, y, rect.cx, rect.cy) <= rect.r + 1) {
        return { type: 'node', id: node.id, node };
      }
    }

    const edges = (state.scene?.edges || []).slice().reverse();
    const crossingMap = circuitCrossingMap(edges);
    const occupiedLabels = [];
    for (const edge of edges) {
      const points = edgePathPoints(edge);
      if (!points) continue;
      const minX = Math.min(...points.map((p) => p.x)) - 9;
      const maxX = Math.max(...points.map((p) => p.x)) + 9;
      const minY = Math.min(...points.map((p) => p.y)) - 9;
      const maxY = Math.max(...points.map((p) => p.y)) + 9;
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      if (distanceToPath(x, y, points) <= 7) {
        return { type: 'edge', id: edge.id, edge };
      }
    }
    return null;
  }

  function nearestNodeWithin(x, y, margin = 24) {
    const nodes = state.scene?.nodes || [];
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      const rect = nodeRect(node);
      if (rect.shape === 'rect'
        ? (x >= rect.x - margin && x <= rect.x + rect.w + margin
          && y >= rect.y - margin && y <= rect.y + rect.h + margin)
        : distance(x, y, rect.cx, rect.cy) <= rect.r + margin) {
        return node;
      }
    }
    return null;
  }

  /* ======================================================================
   * 4. 画布交互：选择、拖拽、连线、缩放、平移
   * ==================================================================== */

  function bindCanvas() {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', () => {
      if (state.drag) return;
      if (state.hoverWaypoint) {
        state.hoverWaypoint = null;
        requestDraw();
      }
      if (ui.statusCursor) ui.statusCursor.textContent = 'x —  y —';
      if (state.hover) {
        state.hover = null;
        requestDraw();
        canvas.style.cursor = 'default';
      }
    });
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button === 1) {
        event.preventDefault();
      }
    });
  }

  function onPointerDown(event) {
    if (event.button === 2) return;
    closePopups();
    const point = pointerPosition(event);
    state.pointer = { ...point, ...screenToWorld(point.x, point.y) };

    if (event.button === 1) {
      state.drag = {
        type: 'pan',
        startX: point.x,
        startY: point.y,
        viewX: state.view.x,
        viewY: state.view.y,
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
      event.preventDefault();
      return;
    }

    const primaryNode = selectedNode();
    if (state.wireTool && event.button === 0) {
      const endpoint = wireToolEndpointAt(point);
      if (!endpoint) {
        toast('请点击网络节点或器件引脚（Esc 取消导线工具）', 'info', 2400);
        return;
      }
      if (!state.wireTool.first) {
        state.wireTool.first = endpoint;
        if (ui.statusHint) ui.statusHint.textContent = '导线工具：起点已选，点击第二个端点（Esc 取消）';
        requestDraw();
      } else {
        void completeWireTool(endpoint);
      }
      event.preventDefault();
      return;
    }
    if (primaryNode && !event.ctrlKey && !event.metaKey) {
      const rect = nodeRect(primaryNode);
      const hx = rect.cx + rect.r - 2;
      const hy = rect.cy + rect.r - 2;
      if (Math.abs(point.x - hx) <= 8 && Math.abs(point.y - hy) <= 8) {
        state.drag = {
          type: 'resize',
          id: primaryNode.id,
          startDiameter: nodeDiameter(primaryNode),
          startX: point.x,
          startY: point.y,
        };
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = 'nwse-resize';
        event.preventDefault();
        return;
      }
    }

    const primaryEdge = selectedEdge();
    if (primaryEdge && !event.ctrlKey && !event.metaKey) {
      const endpoint = edgeEndpointHit(point);
      if (endpoint) {
        const edgeRecord = edgeById(endpoint.id);
        state.drag = {
          type: 'endpoint',
          id: endpoint.id,
          end: endpoint.end,
          anchor: (edgeRecord?.anchors && edgeRecord.anchors[endpoint.end]) || 'auto',
          moved: false,
        };
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = 'crosshair';
        requestDraw();
        event.preventDefault();
        return;
      }
    }
    if (!event.ctrlKey && !event.metaKey) {
      const waypoint = waypointHitAt(point, true);
      if (waypoint) {
        // 直接拖拐点：即使连线未选中也先选中它，并显示坐标 HUD。
        if (state.selection.type !== 'edge' || state.selection.id !== waypoint.edge.id) {
          state.selection = { type: 'edge', id: waypoint.edge.id };
          state.inspectorDirty = false;
          renderInspector();
        }
        state.drag = { type: 'waypoint', id: waypoint.edge.id, index: waypoint.index, moved: false };
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = 'grabbing';
        requestDraw();
        event.preventDefault();
        return;
      }
    }
    if (primaryEdge && event.altKey) {
      const world = screenToWorld(point.x, point.y);
      const snapped = snapWorld(world.x, world.y, event.altKey);
      const waypoints = [...(primaryEdge.waypoints || []), { x: snapped.x, y: snapped.y }];
      void patchEdgeGeometry(primaryEdge.id, { route: 'manual', waypoints });
      return;
    }

    const hit = hitTest(point.x, point.y);
    if ((event.ctrlKey || event.metaKey) && hit && (hit.type === 'node' || hit.type === 'edge')) {
      toggleMultiSelection(hit.type, hit.id);
      event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !hit) {
      state.drag = {
        type: 'box',
        startX: point.x,
        startY: point.y,
        x: point.x,
        y: point.y,
      };
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (hit && hit.type === 'pin') {
      state.drag = {
        type: 'pin',
        sourceId: hit.id,
        pin: hit.pin,
        startX: point.x,
        startY: point.y,
      };
      canvas.setPointerCapture(event.pointerId);
      requestDraw();
      event.preventDefault();
      return;
    }
    if (hit && hit.type === 'port') {
      state.drag = {
        type: 'link',
        sourceId: hit.id,
        targetId: null,
        startX: point.x,
        startY: point.y,
      };
      canvas.setPointerCapture(event.pointerId);
      requestDraw();
      event.preventDefault();
      return;
    }

    if (hit && hit.type === 'node') {
      const node = hit.node;
      void selectEntity('node', node.id);
      state.drag = {
        type: 'node',
        id: node.id,
        startX: point.x,
        startY: point.y,
        originX: node.position.x,
        originY: node.position.y,
        moved: false,
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
      event.preventDefault();
      return;
    }

    if (hit && hit.type === 'edge') {
      void selectEntity('edge', hit.id);
      drawGraph();
      return;
    }

    void selectEntity(null, null);
    state.drag = {
      type: 'pan',
      startX: point.x,
      startY: point.y,
      viewX: state.view.x,
      viewY: state.view.y,
      moved: false,
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grab';
  }

  function onPointerMove(event) {
    const point = pointerPosition(event);
    const world = screenToWorld(point.x, point.y);
    state.pointer = { ...point, ...world };
    const cursorText = `x ${world.x.toFixed(1)}  y ${world.y.toFixed(1)}`;
    if (ui.statusCursor && ui.statusCursor.textContent !== cursorText) {
      ui.statusCursor.textContent = cursorText;
    }

    if (!state.drag) {
      const waypoint = waypointHitAt(point, true);
      if (waypoint) {
        state.hoverWaypoint = { edgeId: waypoint.edge.id, index: waypoint.index };
        canvas.style.cursor = 'grab';
        requestDraw();
        return;
      }
      if (state.hoverWaypoint) {
        state.hoverWaypoint = null;
        requestDraw();
      }
      if (edgeEndpointHit(point)) {
        canvas.style.cursor = 'crosshair';
        return;
      }
      const hit = hitTest(point.x, point.y);
      const nextHover = hit ? { type: hit.type, id: hit.id } : null;
      const changed = (nextHover?.type || null) !== (state.hover?.type || null)
        || (nextHover?.id || null) !== (state.hover?.id || null);
      if (changed) {
        state.hover = nextHover;
        requestDraw();
      }
      if (!hit) canvas.style.cursor = 'default';
      else if (hit.type === 'port' || hit.type === 'pin') canvas.style.cursor = 'crosshair';
      else if (hit.type === 'node') canvas.style.cursor = 'grab';
      else canvas.style.cursor = 'pointer';
      return;
    }

    const drag = state.drag;
    if (drag.type === 'box') {
      drag.x = point.x;
      drag.y = point.y;
      requestDraw();
      return;
    }

    if (drag.type === 'pan') {
      state.view.x = drag.viewX + (point.x - drag.startX);
      state.view.y = drag.viewY + (point.y - drag.startY);
      drag.moved = true;
      requestDraw();
      return;
    }

    if (drag.type === 'resize') {
      const node = nodeById(drag.id);
      if (!node) return;
      const rect = nodeRect(node);
      const world = screenToWorld(point.x, point.y);
      const center = { x: node.position.x, y: node.position.y };
      const raw = Math.hypot(world.x - center.x, world.y - center.y) * 2;
      const snapped = state.ui?.snap && !event.altKey
        ? Math.round(raw / (Number(state.ui.grid) || 20)) * (Number(state.ui.grid) || 20)
        : raw;
      const diameter = clamp(snapped, 24, 200);
      state.drag.diameter = diameter;
      drag.diameter = diameter;
      node.size = { w: diameter };
      rect.r = (diameter / 2) * state.view.k;
      drag.moved = true;
      requestDraw();
      return;
    }

    if (drag.type === 'endpoint') {
      const edge = edgeById(drag.id);
      if (!edge) return;
      const node = nodeById(drag.end === 'source' ? edge.source : edge.target);
      if (!node) return;
      const side = anchorSideFor(node, point);
      drag.anchor = side;
      edge.anchors = Object.assign({}, edge.anchors || {}, { [drag.end]: side });
      drag.moved = true;
      requestDraw();
      return;
    }

    if (drag.type === 'waypoint') {
      const edge = edgeById(drag.id);
      if (!edge) return;
      const world = screenToWorld(point.x, point.y);
      const snapped = snapWorld(world.x, world.y, event.altKey);
      edge.waypoints[drag.index] = { x: snapped.x, y: snapped.y };
      drag.moved = true;
      requestDraw();
      return;
    }

    if (drag.type === 'node') {
      const k = state.view.k;
      const node = nodeById(drag.id);
      if (!node) return;
      const rawX = clamp(drag.originX + (point.x - drag.startX) / k, -10000, 10000);
      const rawY = clamp(drag.originY + (point.y - drag.startY) / k, -10000, 10000);
      const snapped = snapWorld(rawX, rawY, event.altKey);
      node.position.x = snapped.x;
      node.position.y = snapped.y;
      drag.moved = true;
      requestDraw();
      return;
    }

    if (drag.type === 'link') {
      const target = nearestNodeWithin(point.x, point.y, 18);
      drag.targetId = target && target.id !== drag.sourceId ? target.id : (target ? target.id : null);
      requestDraw();
    }
  }

  function onPointerUp(event) {
    const drag = state.drag;
    state.drag = null;
    state.hoverWaypoint = null;
    canvas.style.cursor = 'default';
    if (!drag) return;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      // pointer capture 可能已自动释放
    }

    if (drag.type === 'box') {
      const x1 = Math.min(drag.startX, drag.x);
      const x2 = Math.max(drag.startX, drag.x);
      const y1 = Math.min(drag.startY, drag.y);
      const y2 = Math.max(drag.startY, drag.y);
      if (x2 - x1 > 3 && y2 - y1 > 3) {
        const nodes = (state.scene?.nodes || []).filter((node) => {
          const rect = nodeRect(node);
          return rect.cx >= x1 && rect.cx <= x2 && rect.cy >= y1 && rect.cy <= y2;
        });
        const nodeIds = new Set(nodes.map((node) => node.id));
        const edges = (state.scene?.edges || []).filter((edge) => {
          const points = edgePathPoints(edge);
          const middle = points ? pathMidpoint(points) : null;
          if (middle) return middle.x >= x1 && middle.x <= x2 && middle.y >= y1 && middle.y <= y2;
          return nodeIds.has(edge.source) && nodeIds.has(edge.target);
        });
        state.multi.nodes = new Set(nodes.map((node) => node.id));
        state.multi.edges = new Set(edges.map((edge) => edge.id));
        requestDraw();
        toast(`框选 ${nodes.length} 节点 / ${edges.length} 连接`, 'info', 1800);
      }
      return;
    }

    if (drag.type === 'node' && drag.moved) {
      queuePositionSave(drag.id);
    }

    if (drag.type === 'resize' && drag.moved) {
      const node = nodeById(drag.id);
      if (node) void patchNodeGeometry(node.id, { size: { w: node.size?.w || nodeDiameter(node) } });
    }

    if (drag.type === 'waypoint' && drag.moved) {
      const edge = edgeById(drag.id);
      if (edge) void patchEdgeGeometry(edge.id, { waypoints: edge.waypoints });
    }

    if (drag.type === 'endpoint' && drag.moved) {
      const edge = edgeById(drag.id);
      if (edge) void patchEdgeGeometry(edge.id, { anchors: edge.anchors });
    }

    if (drag.type === 'link') {
      const point = pointerPosition(event);
      const target = nearestNodeWithin(point.x, point.y, 18);
      if (target) {
        openLinkMenu(target.id, point.x, point.y, drag.sourceId);
      }
      requestDraw();
    }

    if (drag.type === 'pin') {
      const point = pointerPosition(event);
      const target = nearestNodeWithin(point.x, point.y, 18);
      if (target && (target.kind === 'node' || target.kind === 'ground')) {
        void createWire(drag.sourceId, target.id, drag.pin);
      } else {
        toast('请把引脚拖到网络节点（电学节点/接地）', 'error', 3500);
      }
      requestDraw();
    }
  }

  function onDoubleClick(event) {
    const point = pointerPosition(event);
    const hit = hitTest(point.x, point.y);
    if (hit && hit.type === 'node') {
      void selectEntity('node', hit.id, true);
      switchTab('inspect');
    } else if (hit && hit.type === 'edge') {
      void selectEntity('edge', hit.id, true);
      switchTab('inspect');
    } else {
      openAddMenu(point.x, point.y);
    }
  }

  function onWheel(event) {
    event.preventDefault();
    const point = pointerPosition(event);
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomAt(factor, point.x, point.y);
  }

  async function deleteDeviceWires(nodeId) {
    const wires = (state.scene?.edges || []).filter(
      (edge) => edge.kind === 'wire' && (edge.source === nodeId || edge.target === nodeId),
    );
    if (!wires.length) {
      toast('该器件没有导线', 'info', 2000);
      return;
    }
    for (const wire of wires) await deleteEdge(wire.id);
    toast(`已断开 ${wires.length} 条导线`, 'ok', 2200);
  }

  async function convertNodeToGround(nodeId) {
    try {
      await jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, 'PATCH', {
        kind: 'ground',
        params: {},
        data: {},
        size: {},
      });
      await refreshState(true);
      toast('已设为接地（多接地自动合并为 0V）', 'ok', 2600);
    } catch (error) {
      toast(`设为接地失败：${error.message}`, 'error', 4000);
    }
  }

  function pinWires(nodeId, pinName) {
    return (state.scene?.edges || []).filter(
      (edge) => edge.kind === 'wire'
        && ((edge.source === nodeId && edge.source_pin === pinName)
          || (edge.target === nodeId && edge.target_pin === pinName)),
    );
  }

  function wireToolEndpointAt(point) {
    const hit = hitTest(point.x, point.y);
    if (!hit) return null;
    if (hit.type === 'pin') return { kind: 'pin', nodeId: hit.id, pin: hit.pin };
    if (hit.type === 'node' && (hit.node.kind === 'node' || hit.node.kind === 'ground')) {
      return { kind: 'net', nodeId: hit.id };
    }
    return null;
  }

  function startWireTool(first = null) {
    state.wireTool = { first };
    const hint = first
      ? `导线工具：起点已选，点击第二个端点（网络节点或器件引脚）`
      : '导线工具：依次点击两个端点（网络节点 / 器件引脚）';
    if (ui.statusHint) ui.statusHint.textContent = hint;
    toast(hint, 'info', 2600);
    requestDraw();
  }

  function cancelWireTool() {
    if (!state.wireTool) return;
    state.wireTool = null;
    if (ui.statusHint) ui.statusHint.textContent = '就绪';
    requestDraw();
  }

  async function completeWireTool(second) {
    const first = state.wireTool?.first;
    if (!first) return;
    let sourceId = '';
    let targetId = '';
    let sourcePin = '';
    if (first.kind === 'pin' && second.kind === 'net') {
      sourceId = first.nodeId;
      targetId = second.nodeId;
      sourcePin = first.pin;
    } else if (first.kind === 'net' && second.kind === 'pin') {
      sourceId = second.nodeId;
      targetId = first.nodeId;
      sourcePin = second.pin;
    } else if (first.kind === 'net' && second.kind === 'net') {
      sourceId = first.nodeId;
      targetId = second.nodeId;
    } else {
      toast('导线只允许「器件引脚 ↔ 网络节点」或「网络 ↔ 网络」', 'error', 3600);
      return;
    }
    cancelWireTool();
    await createWireBetween(sourceId, targetId, sourcePin, '');
  }

  function alignmentMenuItems() {
    return [
      { label: '左对齐', action: () => void alignSelection('left') },
      { label: '右对齐', action: () => void alignSelection('right') },
      { label: '水平居中', action: () => void alignSelection('centerX') },
      { label: '顶对齐', action: () => void alignSelection('top') },
      { label: '底对齐', action: () => void alignSelection('bottom') },
      { label: '垂直居中', action: () => void alignSelection('centerY') },
      { sep: true },
      { label: '横向等距分布', action: () => void distributeSelection('x') },
      { label: '纵向等距分布', action: () => void distributeSelection('y') },
    ];
  }

  function displayMenuItems() {
    return [
      { label: '栅格', hint: state.ui?.showGrid !== false ? '当前：开' : '当前：关', action: () => $('#stGrid')?.click() },
      { label: '吸附', hint: state.ui?.snap !== false ? '当前：开' : '当前：关', action: () => $('#stSnap')?.click() },
      { label: '捕捉点', hint: state.ui?.snapMarkers !== false ? '当前：开' : '当前：关', action: () => $('#stSnapMark')?.click() },
      { label: '正交布线', hint: state.ui?.circuitOrthogonal !== false ? '当前：开' : '当前：关', action: () => $('#stOrtho')?.click() },
    ];
  }

  function onContextMenu(event) {
    event.preventDefault();
    const point = pointerPosition(event);
    const hit = hitTest(point.x, point.y);
    const items = [];
    if (hit && hit.type === 'pin') {
      const node = hit.node;
      const wires = pinWires(hit.id, hit.pin);
      items.push({
        label: '引脚信息',
        hint: `${node.name}.${hit.pin}${wires.length ? ` · ${wires.length} 条导线` : ' · 未接线'}`,
        action: () => toast(`${node.name}.${hit.pin}：${wires.length ? `已接 ${wires.length} 条导线` : '未接线'}`, 'info', 3000),
      });
      items.push({
        label: '从此引脚建线…',
        hint: '点击后选另一个网络节点',
        action: () => startWireTool({ kind: 'pin', nodeId: node.id, pin: hit.pin }),
      });
      if (wires.length) {
        items.push({
          label: '断开该引脚导线',
          hint: `${wires.length} 条`,
          danger: true,
          action: async () => {
            for (const wire of wires) await deleteEdge(wire.id);
            toast(`已断开 ${node.name}.${hit.pin} 的 ${wires.length} 条导线`, 'ok', 2400);
          },
        });
      }
      openGenericMenu(ui.linkMenu, point.x, point.y, `引脚 · ${node.name}.${hit.pin}`, items);
      return;
    }
    if (hit && hit.type === 'node') {
      const node = hit.node;
      const isDevice = node.kind === 'device';
      items.push({
        label: isDevice ? '器件属性' : '节点属性',
        hint: node.name,
        action: () => {
          void selectEntity('node', hit.id, true);
          switchTab('inspect');
        },
      });
      if (!isDevice && node.kind !== 'ground' && state.mode === 'circuit') {
        items.push({
          label: '设为接地',
          hint: '多接地会自动合并为 0V',
          action: () => void convertNodeToGround(hit.id),
        });
      }
      if (node.kind === 'node' && state.mode === 'circuit') {
        const marked = Boolean(node.params?.port_name);
        const current = node.params?.port_direction || 'inout';
        const portName = marked ? String(node.params.port_name) : node.name;
        items.push({
          label: marked ? '改端口方向' : '设为模块端口',
          hint: marked
            ? `当前「${portName}」· ${MODULE_DIR_LABEL[current] || '双向'}`
            : '先选方向，封装时按方向画引脚',
          children: PORT_DIRECTION_CHOICES.map(([value, label, hint]) => ({
            label: `${label}${marked && value === current ? ' · 当前' : ''}`,
            hint,
            action: () => void setNetPort(node.id, portName, value),
          })),
        });
        if (marked) {
          items.push({
            label: '取消模块端口',
            hint: `当前端口 ${portName}`,
            action: () => void setNetPort(node.id, '', 'inout'),
          });
        }
      }
      items.push({ label: '复制', hint: 'Ctrl+C', action: () => copySelection(false) });
      if (isDevice) {
        items.push({
          label: '断开全部导线',
          hint: '器件保留，只删导线',
          action: () => void deleteDeviceWires(hit.id),
        });
      }
      if ((state.multi?.nodes?.size || 0) > 1) {
        items.push({
          label: '对齐 / 分布',
          hint: `当前多选 ${state.multi.nodes.size} 个`,
          children: [
            { label: '左对齐', action: () => void alignSelection('left') },
            { label: '右对齐', action: () => void alignSelection('right') },
            { label: '水平居中', action: () => void alignSelection('centerX') },
            { label: '顶对齐', action: () => void alignSelection('top') },
            { label: '底对齐', action: () => void alignSelection('bottom') },
            { label: '垂直居中', action: () => void alignSelection('centerY') },
            { sep: true },
            { label: '横向等距分布', action: () => void distributeSelection('x') },
            { label: '纵向等距分布', action: () => void distributeSelection('y') },
          ],
        });
      }
      items.push({ sep: true });
      items.push({
        label: isDevice ? '删除器件' : '删除节点',
        hint: '同时删除相连连接',
        danger: true,
        action: () => deleteNode(hit.id),
      });
      openGenericMenu(ui.linkMenu, point.x, point.y, `${isDevice ? '器件' : '节点'} · ${node.name}`, items);
      return;
    }
    if (hit && hit.type === 'edge') {
      items.push({
        label: '连接属性',
        hint: hit.edge.name,
        action: () => {
          void selectEntity('edge', hit.id, true);
          switchTab('inspect');
        },
      });
      items.push({ label: '复制', hint: 'Ctrl+C', action: () => copySelection(false) });
      if (hit.edge.kind === 'wire') {
        items.push({
          label: '添加拐点（中点）',
          action: () => void addWireWaypoint(hit.edge),
        });
        if ((hit.edge.waypoints || []).length) {
          items.push({
            label: '清除拐点',
            hint: '恢复自动布线',
            action: () => void clearWireWaypoints(hit.id),
          });
        }
        items.push({
          label: '选中整条网络',
          hint: '同端点的导线一起选中',
          action: () => selectWireNetwork(hit.edge),
        });
      }
      if (state.mode !== 'circuit') {
        items.push({
          label: hit.edge.delay ? '取消单步延迟' : '设为单步延迟',
          hint: '用于切断代数环',
          action: () => toggleEdgeDelay(hit.id),
        });
      }
      items.push({ sep: true });
      items.push({
        label: '删除连接',
        hint: hit.edge.name,
        danger: true,
        action: () => deleteEdge(hit.id),
      });
      openGenericMenu(ui.linkMenu, point.x, point.y, `连接 · ${hit.edge.name}`, items);
      return;
    }
    items.push({
      label: '添加',
      hint: state.mode === 'circuit' ? '节点 / 器件（按分类）/ 导线' : '节点',
      children: buildAddMenuItems(point.x, point.y),
    });
    if (state.mode === 'circuit') {
      items.push({
        label: '导线工具（点两端）…',
        hint: '依次点击网络节点 / 器件引脚；Esc 取消',
        action: () => startWireTool(),
      });
    }
    items.push({ label: '显示', children: displayMenuItems() });
    const multiNodes = state.multi?.nodes?.size || 0;
    const multiEdges = state.multi?.edges?.size || 0;
    if (multiNodes > 1 || multiEdges > 0) {
      const multiItems = [];
      if (multiNodes > 1) {
        multiItems.push({
          label: '对齐 / 分布',
          hint: `${multiNodes} 个节点`,
          children: alignmentMenuItems(),
        });
        multiItems.push({
          label: '批量设置尺寸…',
          hint: '统一宽 / 直径',
          action: () => void batchResizeSelection(),
        });
        multiItems.push({ sep: true });
      }
      multiItems.push({
        label: '删除选中',
        hint: `节点 ${multiNodes} / 连接 ${multiEdges}`,
        danger: true,
        action: () => void deleteSelection(),
      });
      items.push({ label: `多选（${multiNodes} 节点 / ${multiEdges} 连接）`, children: multiItems });
    }
    items.push({ label: '粘贴', hint: 'Ctrl+V', action: () => void pasteClipboard() });
    items.push({ label: '全选', hint: 'Ctrl+A', action: () => selectAll() });
    items.push({ sep: true });
    items.push({ label: '撤销', hint: 'Ctrl+Z', action: () => void undo() });
    items.push({ label: '重做', hint: 'Ctrl+Shift+Z', action: () => void redo() });
    items.push({ sep: true });
    items.push({
      label: state.sim?.running ? '暂停' : '运行',
      hint: '空格',
      action: () => void control('toggle'),
    });
    items.push({ label: '单步', hint: 'S', action: () => void control('step') });
    items.push({ sep: true });
    items.push({ label: '适配视图', action: () => fitView(true) });
    items.push({ label: '自动布局', action: () => void autoLayout() });
    openGenericMenu(ui.linkMenu, point.x, point.y, '画布', items);
  }

  function queuePositionSave(nodeId) {
    const node = nodeById(nodeId);
    if (!node) return;
    state.dirtyPositions.set(nodeId, { x: node.position.x, y: node.position.y });
    clearTimeout(state.positionTimer);
    state.positionTimer = setTimeout(flushPositions, 180);
  }

  async function flushPositions() {
    if (!state.dirtyPositions.size) return;
    const items = Array.from(state.dirtyPositions.entries())
      .filter(([id]) => Boolean(nodeById(id)))
      .map(([id, position]) => ({
        id,
        position: { x: Number(position.x.toFixed(3)), y: Number(position.y.toFixed(3)) },
      }));
    state.dirtyPositions.clear();
    if (!items.length) return;
    try {
      await jsonRequest('/api/positions', 'POST', { positions: items });
    } catch (error) {
      toast(`保存坐标失败：${error.message}`, 'error', 6000);
      await refreshState(true);
    }
  }

  async function patchNodeGeometry(nodeId, payload) {
    const response = await task(() =>
      jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, 'PATCH', payload),
    );
    if (!response) return;
    await refreshState(true);
    renderInspector();
  }

  // R24/D49：把网络节点标记/取消为模块端口。
  async function setNetPort(nodeId, portName, direction = 'inout') {
    const node = nodeById(nodeId);
    if (!node) return;
    const params = portName
      ? { port_name: String(portName).slice(0, 24), port_direction: direction || 'inout' }
      : {};
    const response = await task(() =>
      jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, 'PATCH', {
        name: node.name,
        kind: node.kind,
        params,
      }),
    );
    if (!response) return;
    await refreshState(true);
    renderInspector();
    toast(params.port_name ? `已标记端口「${params.port_name}」` : '已取消端口标记', 'ok', 2200);
  }

  async function patchEdgeGeometry(edgeId, payload) {
    const response = await task(() =>
      jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, 'PATCH', payload),
    );
    if (!response) return;
    await refreshState(true);
    renderInspector();
  }

  function scheduleChartDraw() {
    if (state.chartTimer) return;
    state.chartTimer = setTimeout(() => {
      state.chartTimer = 0;
      const tab = activeTab();
      if (tab === 'chart') drawChart();
      else if (tab === 'inst') drawInstruments();
    }, 70);
  }

  const PANEL_GROUPS = {
    inspect: { group: 'inspect' },
    'node-fn': { group: 'fn', role: 'node' },
    'edge-fn': { group: 'fn', role: 'edge' },
    spec: { group: 'fn' },
    blocks: { group: 'modules', sub: 'blocks' },
    ext: { group: 'modules', sub: 'ext' },
    chart: { group: 'analysis', sub: 'chart' },
    inst: { group: 'analysis', sub: 'inst' },
    vector: { group: 'analysis', sub: 'vector' },
    analysis: { group: 'analysis', sub: 'analysis' },
    plotkit: { group: 'analysis', sub: 'plotkit' },
    fem: { group: 'fem' },
  };

  function defaultTabForGroup(group) {
    if (group === 'fn') return state.fnRole === 'edge' ? 'edge-fn' : 'node-fn';
    if (group === 'modules') {
      const sub = $('.panel-group[data-group="modules"] .group-subnav [data-sub].active');
      return sub ? sub.dataset.sub : 'blocks';
    }
    if (group === 'analysis') {
      const sub = $('.panel-group[data-group="analysis"] .group-subnav [data-sub].active');
      return sub ? sub.dataset.sub : 'chart';
    }
    if (group === 'fem') return 'fem';
    return 'inspect';
  }

  function setPanelGroup(group) {
    $$('.panel-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.group === group));
    $$('.panel-group').forEach((node) => node.classList.toggle('active', node.dataset.group === group));
  }

  function setGroupSub(group, sub) {
    const host = $(`.panel-group[data-group="${group}"]`);
    if (!host) return;
    const attr = group === 'fn' ? 'fnrole' : 'sub';
    $$(`[data-${attr}]`, host).forEach((node) => {
      node.classList.toggle('active', node.dataset[attr] === sub);
    });
    if (group === 'modules' || group === 'analysis') {
      $$('.tab-pane', host).forEach((pane) => {
        pane.classList.toggle('hidden', pane.id !== `tab-${sub}`);
      });
    }
  }

  function switchTab(name) {
    if (name === 'scene') {
      openSettings('project');
      return;
    }
    if (name === 'fem' && state.workspace !== 'fem') {
      void switchWorkspace('fem');
      return;
    }
    if (name !== 'fem' && state.workspace === 'fem') {
      void switchWorkspace('network').then(() => switchTab(name));
      return;
    }
    const conf = PANEL_GROUPS[name] || PANEL_GROUPS.inspect;
    if (conf.role) {
      state.fnRole = conf.role;
      state.specKind = '';
      setGroupSub('fn', conf.role);
    }
    setPanelGroup(conf.group);
    if (conf.sub) setGroupSub(conf.group, conf.sub);
    if (conf.group === 'fn') {
      const note = $('#fnNote');
      if (note) note.textContent = state.fnRole === 'edge' ? '连接函数' : '节点函数';
      renderSpecPane();
      requestDraw();
    }
    if (conf.sub === 'chart') {
      resizeChart();
      scheduleChartDraw();
    }
    if (conf.sub === 'vector') {
      resizePhase();
      renderVectorNodeList();
      drawPhase();
    }
    if (conf.sub === 'plotkit') {
      // 侧栏只放入口；真正的绘图在非模态浮窗里（iframe 懒加载）
      $('#btnOpenPlotkit')?.focus({ preventScroll: true });
    }
    if (conf.sub === 'analysis') {
      renderAnalysisPanel();
    }
    if (conf.sub === 'blocks') {
      renderBlocksPanel();
    }
    if (conf.sub === 'ext') {
      renderExtensionPanel();
    }
    if (conf.group === 'fem') {
      renderFemPanel();
      resizeFem();
      updateFemPanelValues();
      drawFem();
    }
  }

  /* ======================================================================
   * 5. 弹层、菜单、模态框
   * ==================================================================== */

  function positionPopup(popup, x, y) {
    popup.classList.remove('hidden');
    popup.style.left = '0px';
    popup.style.top = '0px';
    const stageRect = stage.getBoundingClientRect();
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    const left = clamp(x, 8, Math.max(8, stageRect.width - width - 8));
    const top = clamp(y, 8, Math.max(8, stageRect.height - height - 8));
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }

  function closePopups() {
    ui.addMenu.classList.add('hidden');
    ui.linkMenu.classList.add('hidden');
  }

  function openGenericMenu(popup, x, y, title, items) {
    popup.replaceChildren();
    popup.appendChild(div('popup-title', title));
    for (const item of items) {
      if (item.sep) {
        popup.appendChild(div('popup-sep'));
        continue;
      }
      if (Array.isArray(item.children)) {
        // R22：子菜单用“下钻 + 返回”而不是悬停级联，键盘/触控也能用。
        const node = el('button', 'popup-item');
        node.type = 'button';
        node.appendChild(el('strong', null, `${item.label}  ▸`));
        if (item.hint) node.appendChild(el('small', null, item.hint));
        node.addEventListener('click', (event) => {
          event.stopPropagation();
          const children = [
            ...item.children,
            { sep: true },
            {
              label: '‹ 返回',
              action: () => openGenericMenu(popup, x, y, title, items),
            },
          ];
          openGenericMenu(popup, x, y, `${title} › ${item.label}`, children);
        });
        popup.appendChild(node);
        continue;
      }
      const node = el('button', 'popup-item');
      node.type = 'button';
      const strong = el('strong', null, item.label);
      if (item.danger) strong.style.color = '#fca5a5';
      node.appendChild(strong);
      if (item.hint) node.appendChild(el('small', null, item.hint));
      node.addEventListener('click', () => {
        closePopups();
        item.action();
      });
      popup.appendChild(node);
    }
    positionPopup(popup, x, y);
  }

  // R22/D46：与后端 ELEMENT_GROUP_ORDER 同名同序；只作展示顺序，不重复分类逻辑。
  const ELEMENT_GROUP_ORDER = [
    '基础无源', '电源', '受控源', '二极管', '开关',
    '放大与比较', '晶体管', '数字与逻辑', '计时与电源管理', '磁性',
  ];

  function buildAddMenuItems(placeX, placeY) {
    const list = kindListFor('node');
    const items = [];
    for (const spec of list) {
      // 模块实例/端口节点只能由模块库实例化或封装生成，手动添加会得到
      // 没有 block_id 的坏节点（P0-0），所以按 catalog 的 addable 过滤。
      if (spec.addable === false) continue;
      items.push({
        label: spec.label,
        hint: state.mode === 'circuit' && spec.kind === 'ground'
          ? '参考节点（R21：可放多个，自动合并为 0V）'
          : spec.description,
        action: () => addNodeAt(spec.kind, placeX, placeY),
      });
    }
    if (state.mode === 'circuit') {
      const byGroup = new Map();
      for (const spec of state.catalog?.elements || []) {
        const group = String(spec.group || '未分类');
        if (!byGroup.has(group)) byGroup.set(group, []);
        byGroup.get(group).push(spec);
      }
      for (const group of ELEMENT_GROUP_ORDER) {
        const specs = byGroup.get(group);
        if (!specs || !specs.length) continue;
        items.push({
          label: `器件 · ${group}`,
          hint: `${specs.length} 种`,
          children: specs.map((spec) => ({
            label: spec.label,
            hint: spec.description,
            action: () => addDeviceAt(spec.kind, placeX, placeY),
          })),
        });
      }
      items.push({ sep: true });
      items.push({
        label: '导线工具（点两端）…',
        hint: '依次点击两个端点；Esc 取消',
        action: () => startWireTool(),
      });
      items.push({
        label: '导线（选择端点）…',
        hint: '点两个端点建线；也可从引脚拖拽（R22）',
        action: () => openWireDialog(),
      });
    }
    return items;
  }

  function openAddMenu(x, y, placeX = x, placeY = y) {
    if (!state.catalog) return;
    const items = buildAddMenuItems(placeX, placeY);
    const menuLabel = state.mode === 'circuit' ? '电学节点/器件' : state.mode === 'vector' ? '矢量节点' : '计算节点';
    openGenericMenu(ui.addMenu, x, y, `添加${menuLabel}`, items);
  }

  function centerPlacement() {
    const count = state.scene?.nodes?.length || 0;
    const offset = ((count % 3) - 1) * 46;
    return {
      x: state.canvasSize.w / 2 + offset,
      y: state.canvasSize.h / 2 + offset,
    };
  }

  function openLinkMenu(targetId, x, y, forcedSourceId) {
    const sourceId = forcedSourceId || state.drag?.sourceId;
    const target = nodeById(targetId);
    const source = nodeById(sourceId);
    if (!source || !target) return;
    if (state.mode === 'circuit' && source.id === target.id) {
      toast('电路元件两端不能是同一个节点', 'error');
      state.drag = null;
      return;
    }
    if (state.mode === 'circuit' && (isPinNode(source) || isPinNode(target))) {
      if (isPinNode(source) && isPinNode(target)) {
        toast('导线只允许「器件/模块引脚 ↔ 网络节点」', 'error', 4000);
        state.drag = null;
        return;
      }
      const deviceNode = isPinNode(source) ? source : target;
      const netNode = isPinNode(source) ? target : source;
      const used = new Set((state.scene?.edges || [])
        .filter((edge) => edge.kind === 'wire')
        .map((edge) => (edge.source === deviceNode.id ? edge.source_pin : edge.target === deviceNode.id ? edge.target_pin : '')));
      const items = devicePins(deviceNode)
        .filter((pin) => !used.has(pin.name))
        .map((pin) => ({
          label: `${deviceNode.name}.${pin.name}`,
          hint: `${pin.role}${pin.required ? ' · 必接' : ''} → ${netNode.name}`,
          action: () => createWire(deviceNode.id, netNode.id, pin.name),
        }));
      if (!items.length) {
        toast(`${deviceNode.name} 的引脚都已连接`, 'info', 3000);
        state.drag = null;
        return;
      }
      openGenericMenu(ui.linkMenu, x, y, `${deviceNode.name} 引脚 → ${netNode.name}`, items);
      state.drag = null;
      return;
    }
    const netKind = (node) => node.kind === 'node' || node.kind === 'ground';
    const items = [];
    if (state.mode === 'circuit' && netKind(source) && netKind(target)) {
      items.push({
        label: '纯导线（合并两个网络节点）',
        hint: '电气上视为同一个网络；可以连续画多段',
        action: () => createWireBetween(source.id, target.id, '', ''),
      });
    }
    const list = kindListFor('edge');
    items.push(...list.map((spec) => ({
      label: spec.label,
      hint: spec.description,
      action: () => createEdge(source.id, target.id, spec.kind),
    })));
    openGenericMenu(ui.linkMenu, x, y, `${source.name} → ${target.name}`, items);
    state.drag = null;
  }

  let modalResolver = null;

  function closeModal() {
    ui.modal.classList.add('hidden');
    ui.modalCard.replaceChildren();
    const resolver = modalResolver;
    modalResolver = null;
    if (resolver) resolver(false);
  }

  function confirmModal(title, message, confirmLabel = '确定', danger = false) {
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
      ui.modal.onclick = (event) => {
        if (event.target === ui.modal) cancel.click();
      };
      const onKey = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          document.removeEventListener('keydown', onKey, true);
          cancel.click();
        }
      };
      document.addEventListener('keydown', onKey, true);
    });
  }

  function showHelp() {
    openDoc('shortcuts');
  }

  /* ======================================================================
   * 6. 检查器：按 catalog 的 ParamSpec 动态生成表单
   * ==================================================================== */

  function markDirty() {
    state.inspectorDirty = true;
    const save = ui.inspector.querySelector('[data-role="save"]');
    if (save) {
      save.textContent = '应用修改 •';
      save.classList.add('dirty');
    }
    const badge = ui.inspector.querySelector('[data-role="dirty-badge"]');
    if (badge) badge.classList.remove('hidden');
  }

  function clearDirty() {
    state.inspectorDirty = false;
    const save = ui.inspector.querySelector('[data-role="save"]');
    if (save) {
      save.textContent = '应用修改';
      save.classList.remove('dirty');
    }
    const badge = ui.inspector.querySelector('[data-role="dirty-badge"]');
    if (badge) badge.classList.add('hidden');
  }

  async function selectEntity(type, id, force = false) {
    if (!type || !id) {
      clearSelection();
      return;
    }
    if (state.selection.type === type && state.selection.id === id) {
      if (force) renderInspector();
      requestDraw();
      return;
    }
    if (state.selectionBusy) return;
    state.selectionBusy = true;
    try {
      if (state.inspectorDirty && state.selection.type) {
        const applied = await applyInspector({ quiet: true });
        if (!applied) {
          toast('当前修改无法保存，请先修正检查器中的参数', 'error', 5000);
          return;
        }
      }
      state.selection = { type, id };
      state.inspectorDirty = false;
      renderInspector();
      requestDraw();
    } finally {
      state.selectionBusy = false;
    }
  }

  function clearSelection() {
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    state.inspectorDirty = false;
    state.multi.nodes.clear();
    state.multi.edges.clear();
    renderInspector();
    requestDraw();
  }

  function multiSelection() {
    const nodes = new Set(state.multi?.nodes || []);
    const edges = new Set(state.multi?.edges || []);
    if (state.selection.type === 'node' && state.selection.id) nodes.add(state.selection.id);
    if (state.selection.type === 'edge' && state.selection.id) edges.add(state.selection.id);
    return { nodes, edges };
  }

  function toggleMultiSelection(type, id) {
    if (type === 'node') {
      if (state.multi.nodes.has(id)) state.multi.nodes.delete(id);
      else state.multi.nodes.add(id);
    } else if (type === 'edge') {
      if (state.multi.edges.has(id)) state.multi.edges.delete(id);
      else state.multi.edges.add(id);
    }
    if ((state.multi.nodes.size + state.multi.edges.size) === 1) {
      const onlyNode = state.multi.nodes.values().next().value;
      const onlyEdge = state.multi.edges.values().next().value;
      if (onlyNode) void selectEntity('node', onlyNode);
      else if (onlyEdge) void selectEntity('edge', onlyEdge);
    } else {
      requestDraw();
    }
    toast(`已选 ${state.multi.nodes.size} 节点 / ${state.multi.edges.size} 连接`, 'info', 1600);
  }

  function selectAll() {
    state.multi.nodes = new Set((state.scene?.nodes || []).map((node) => node.id));
    state.multi.edges = new Set((state.scene?.edges || []).map((edge) => edge.id));
    requestDraw();
    toast(`已全选 ${state.multi.nodes.size} 节点 / ${state.multi.edges.size} 连接`, 'info', 1800);
  }

  function clipboardPayload() {
    const { nodes, edges } = multiSelection();
    if (!nodes.size && !edges.size) return null;
    const nodeSet = new Set(nodes);
    const edgeList = (state.scene?.edges || []).filter(
      (edge) => edges.has(edge.id) || (nodeSet.has(edge.source) && nodeSet.has(edge.target)),
    );
    return {
      networkId: state.currentNetwork?.id || '',
      nodes: (state.scene?.nodes || [])
        .filter((node) => nodeSet.has(node.id))
        .map((node) => JSON.parse(JSON.stringify(node))),
      edges: edgeList.map((edge) => JSON.parse(JSON.stringify(edge))),
    };
  }

  function copySelection(cut = false) {
    const payload = clipboardPayload();
    if (!payload) {
      toast('先在画布上选择节点或连线（Ctrl+单击 / Ctrl+拖框）', 'info', 2600);
      return;
    }
    state.clipboard = payload;
    if (cut) {
      void deleteSelection();
      toast(`已剪切 ${payload.nodes.length} 节点 / ${payload.edges.length} 连接`, 'ok', 2200);
    } else {
      toast(`已复制 ${payload.nodes.length} 节点 / ${payload.edges.length} 连接`, 'ok', 2200);
    }
  }

  function uniquePasteName(base, reserved) {
    const existing = new Set((state.scene?.nodes || []).map((node) => node.name));
    let candidate = `${String(base || 'node').slice(0, 24)}_copy`;
    let index = 2;
    while (existing.has(candidate) || reserved.has(candidate)) {
      candidate = `${String(base || 'node').slice(0, 22)}_c${index++}`;
    }
    reserved.add(candidate);
    return candidate.slice(0, 32);
  }

  async function pasteClipboard() {
    const clipboard = state.clipboard;
    if (!clipboard || (!clipboard.nodes.length && !clipboard.edges.length)) {
      toast('剪贴板为空：先 Ctrl+C 复制选中对象', 'info', 2400);
      return;
    }
    if (clipboard.networkId && clipboard.networkId !== (state.currentNetwork?.id || '')) {
      const confirmed = await confirmModal(
        '跨网络粘贴？',
        '剪贴板来自另一个网络。连接与参数会保留绑定，但跨层语义请自行确认。',
        '粘贴',
        false,
      );
      if (!confirmed) return;
    }
    const offset = 28;
    await pushUndoSnapshot();
    const reserved = new Set();
    const idMap = new Map();
    let nodesCreated = 0;
    let edgesCreated = 0;
    for (const node of clipboard.nodes) {
      const payload = {
        name: uniquePasteName(node.name, reserved),
        kind: node.kind,
        params: node.params || {},
        data: node.data || {},
        position: {
          x: (Number(node.position?.x) || 0) + offset,
          y: (Number(node.position?.y) || 0) + offset,
        },
        size: node.size || {},
      };
      const response = await task(() => jsonRequest('/api/nodes', 'POST', payload), { history: false });
      if (!response?.node) continue;
      idMap.set(node.id, response.node.id);
      nodesCreated += 1;
    }
    for (const edge of clipboard.edges) {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target) continue;
      const response = await task(
        () => jsonRequest('/api/edges', 'POST', {
          source,
          target,
          kind: edge.kind,
          params: edge.params || {},
          delay: Boolean(edge.delay),
          enabled: edge.enabled !== false,
          auto_delay: false,
          route: edge.route || 'auto',
          waypoints: edge.waypoints || [],
          anchors: edge.anchors || {},
        }),
        { history: false },
      );
      if (response) edgesCreated += 1;
    }
    await refreshState(true);
    toast(`已粘贴 ${nodesCreated} 节点 / ${edgesCreated} 连接`, 'ok', 2600);
  }

  async function captureSceneSnapshot() {
    try {
      return await jsonRequest('/api/scene/export', 'GET');
    } catch (error) {
      return null;
    }
  }

  async function pushUndoSnapshot() {
    const snapshot = await captureSceneSnapshot();
    if (!snapshot) return;
    state.undoStack.push(snapshot);
    if (state.undoStack.length > 100) state.undoStack.shift();
    state.redoStack.length = 0;
  }

  async function restoreSceneSnapshot(payload) {
    const current = await captureSceneSnapshot();
    // 库文件（blocks）用当前值：撤销不得复活已删除的库模块（D25）。
    const merged = { ...payload, blocks: current?.blocks || [] };
    await jsonRequest('/api/control', 'POST', { action: 'pause' });
    const response = await jsonRequest('/api/scene', 'POST', merged);
    if (!response?.scene) return;
    clearSelection();
    applySnapshot(response);
    renderInspector();
    markProjectDirty();
  }

  async function undo() {
    const snapshot = state.undoStack.pop();
    if (!snapshot) {
      toast('没有可撤销的操作', 'info', 2000);
      return;
    }
    const current = await captureSceneSnapshot();
    if (current) state.redoStack.push(current);
    await task(() => restoreSceneSnapshot(snapshot), { dirty: true, history: false });
    toast('已撤销', 'ok', 1600);
  }

  async function redo() {
    const snapshot = state.redoStack.pop();
    if (!snapshot) {
      toast('没有可重做的操作', 'info', 2000);
      return;
    }
    const current = await captureSceneSnapshot();
    if (current) state.undoStack.push(current);
    await task(() => restoreSceneSnapshot(snapshot), { dirty: true, history: false });
    toast('已重做', 'ok', 1600);
  }

  function formatAny(value) {
    if (typeof value === 'number') return fmt(value, 5);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (value === null || value === undefined) return '—';
    if (typeof value === 'object') {
      const text = JSON.stringify(value);
      return text.length > 140 ? `${text.slice(0, 140)}…` : text;
    }
    return String(value);
  }

  function valueToText(value) {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value, null, 0);
    return String(value);
  }

  function parseSmartValue(text) {
    const trimmed = String(text ?? '').trim();
    if (!trimmed) return '';
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
      const number = Number(trimmed);
      if (Number.isFinite(number)) return number;
    }
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        throw new Error('数据字段看起来是 JSON，但格式不合法');
      }
    }
    return trimmed;
  }

  function kindListFor(role) {
    if (!state.catalog) return [];
    if (role === 'node') {
      if (state.mode === 'circuit') return state.catalog.circuit_nodes || [];
      const computes = state.catalog.computes || [];
      if (state.mode === 'vector') {
        return computes.slice().sort((a, b) => {
          const rank = (item) => (item.group === '矢量' ? 0 : 1);
          return rank(a) - rank(b);
        });
      }
      return computes;
    }
    if (state.mode === 'circuit') return state.catalog.elements || [];
    const methods = state.catalog.methods || [];
    if (state.mode === 'vector') {
      return methods.slice().sort((a, b) => {
        const rank = (item) => (item.group === '矢量' ? 0 : 1);
        return rank(a) - rank(b);
      });
    }
    return methods;
  }

  function buildKindSelect(role, currentKind, currentId = null) {
    const select = el('select');
    select.dataset.role = 'kind';
    const list = kindListFor(role);
    const groups = new Map();
    for (const spec of list) {
      // 保留当前节点的 kind（块节点仍能显示自己），但不允许改成不可手动创建的 kind。
      if (spec.addable === false && spec.kind !== currentKind) continue;
      const group = spec.group || '';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(spec);
    }
    const appendOption = (parent, spec) => {
      const option = el('option', null, spec.label);
      option.value = spec.kind;
      if (spec.kind === currentKind) option.selected = true;
      parent.appendChild(option);
    };
    if (state.mode !== 'circuit' && role === 'node') {
      for (const [group, specs] of groups) {
        const wrapper = group ? el('optgroup') : select;
        if (group) wrapper.label = group;
        specs.forEach((spec) => appendOption(wrapper, spec));
        if (group) select.appendChild(wrapper);
      }
    } else {
      for (const specs of groups.values()) specs.forEach((spec) => appendOption(select, spec));
    }
    if (!$$('option', select).some((option) => option.value === currentKind)) {
      const option = el('option', null, currentKind || '—');
      option.value = currentKind || '';
      option.selected = true;
      select.appendChild(option);
    }
    return select;
  }

  function numberedField(labelText, unitText) {
    const label = el('label');
    label.appendChild(el('span', null, labelText));
    if (unitText) label.appendChild(el('em', null, unitText));
    return label;
  }

  // R22 追加：常用电学单位允许切前缀，避免被迫输入 1e-6 这类数字。
  const UNIT_PREFIXES = [
    { factor: 1e-12, prefix: 'p' },
    { factor: 1e-9, prefix: 'n' },
    { factor: 1e-6, prefix: 'µ' },
    { factor: 1e-3, prefix: 'm' },
    { factor: 1, prefix: '' },
    { factor: 1e3, prefix: 'k' },
    { factor: 1e6, prefix: 'M' },
  ];
  const PREFIXABLE_UNITS = new Set(['F', 'H', 'Ω', 'V', 'A', 's', 'Hz']);

  function unitStorageKey(param) {
    return `netlab.unit.${param.key}.${param.unit || ''}`;
  }

  function savedUnitFactor(param) {
    try {
      const raw = localStorage.getItem(unitStorageKey(param));
      const factor = Number(raw);
      if (Number.isFinite(factor) && factor > 0) return factor;
    } catch (error) {
      // localStorage 不可用时退回自动前缀
    }
    return 0;
  }

  function bestUnitFactor(value) {
    const magnitude = Math.abs(Number(value) || 0);
    if (!magnitude) return 1;
    for (const item of UNIT_PREFIXES) {
      if (magnitude < item.factor * 1000) return item.factor;
    }
    return UNIT_PREFIXES[UNIT_PREFIXES.length - 1].factor;
  }

  function trimNumber(value) {
    if (!Number.isFinite(value)) return '';
    return String(Number(value.toPrecision(12)));
  }

  function buildParamField(param, value) {
    const wrap = div('field');
    wrap.dataset.param = param.key;
    wrap.dataset.type = param.type || 'float';
    wrap.dataset.label = param.label || param.key;
    const labelText = param.label || param.key;
    const type = param.type || 'float';

    if (type === 'bool') {
      const row = div('switch-row');
      row.appendChild(el('span', null, labelText));
      const input = el('input');
      input.type = 'checkbox';
      input.checked = Boolean(value);
      input.dataset.role = 'param-input';
      row.appendChild(input);
      wrap.appendChild(row);
    } else {
      const prefixable = type === 'float' && PREFIXABLE_UNITS.has(String(param.unit || ''));
      const fieldLabel = numberedField(labelText, prefixable ? '' : (param.unit || ''));
      typeLabelHelp(fieldLabel, param);
      wrap.appendChild(fieldLabel);
      let control;
      let unitSelect = null;
      if (type === 'choice') {
        control = el('select');
        for (const choice of param.choices || []) {
          const option = el('option', null, choice.label || choice.value);
          option.value = choice.value;
          if (String(value) === String(choice.value)) option.selected = true;
          control.appendChild(option);
        }
      } else if (type === 'float' || type === 'int') {
        control = el('input');
        control.type = 'number';
        control.step = param.step !== undefined && param.step !== null
          ? String(param.step)
          : (type === 'int' ? '1' : 'any');
        if (param.min !== undefined && param.min !== null) control.min = String(param.min);
        if (param.max !== undefined && param.max !== null) control.max = String(param.max);
        control.value = value === undefined || value === null ? '' : String(value);
        if (prefixable) {
          const factor = savedUnitFactor(param) || bestUnitFactor(Number(value) || 0);
          if (!savedUnitFactor(param)) {
            try {
              localStorage.setItem(unitStorageKey(param), String(factor));
            } catch (error) {
              // localStorage 不可用时只影响本次会话
            }
          }
          control.value = trimNumber((Number(value) || 0) / factor);
          control.step = 'any';
          if (param.min !== undefined && param.min !== null) control.min = String(Number(param.min) / factor);
          if (param.max !== undefined && param.max !== null) control.max = String(Number(param.max) / factor);
          unitSelect = el('select');
          unitSelect.className = 'unit-select';
          unitSelect.dataset.role = 'param-unit';
          unitSelect.dataset.baseMin = param.min !== undefined && param.min !== null ? String(param.min) : '';
          unitSelect.dataset.baseMax = param.max !== undefined && param.max !== null ? String(param.max) : '';
          for (const item of UNIT_PREFIXES) {
            const option = el('option', null, `${item.prefix}${param.unit}`);
            option.value = String(item.factor);
            unitSelect.appendChild(option);
          }
          unitSelect.value = String(factor);
          unitSelect.dataset.factor = String(factor);
          unitSelect.addEventListener('change', () => {
            const oldFactor = Number(unitSelect.dataset.factor) || 1;
            const nextFactor = Number(unitSelect.value) || 1;
            const number = Number(control.value);
            if (Number.isFinite(number)) control.value = trimNumber((number * oldFactor) / nextFactor);
            unitSelect.dataset.factor = String(nextFactor);
            try {
              localStorage.setItem(unitStorageKey(param), String(nextFactor));
            } catch (error) {
              // localStorage 不可用时只影响本次会话
            }
            const baseMin = unitSelect.dataset.baseMin;
            const baseMax = unitSelect.dataset.baseMax;
            control.min = baseMin === '' ? '' : String(Number(baseMin) / nextFactor);
            control.max = baseMax === '' ? '' : String(Number(baseMax) / nextFactor);
          });
        }
      } else if (type === 'node') {
        control = el('select');
        const empty = el('option', null, '（未设置）');
        empty.value = '';
        control.appendChild(empty);
        for (const node of state.scene?.nodes || []) {
          const option = el('option', null, `${node.name} · ${node.kind}`);
          option.value = node.id;
          if (value === node.id) option.selected = true;
          control.appendChild(option);
        }
      } else if (type === 'json' || type === 'matrix' || type === 'list' || type === 'mapping') {
        control = el('textarea');
        if (type === 'matrix' || param.key === 'A' || param.key === 'B' || param.key === 'C' || param.key === 'D') {
          control.classList.add('tall');
        }
        control.value = JSON.stringify(value === undefined ? param.default : value, null, 2);
        control.spellcheck = false;
        control.addEventListener('blur', () => {
          try {
            JSON.parse(control.value);
            control.classList.remove('invalid');
          } catch (error) {
            control.classList.add('invalid');
          }
        });
      } else {
        control = el('input');
        control.type = 'text';
        control.value = value === undefined || value === null ? '' : String(value);
        if (param.placeholder) control.placeholder = param.placeholder;
        if (param.key === 'expr') control.classList.add('mono');
      }
      control.dataset.role = 'param-input';
      if (param.placeholder && (type === 'json' || type === 'matrix' || type === 'list' || type === 'mapping')) {
        control.placeholder = param.placeholder;
      }
      if (unitSelect) {
        const unitRow = div('param-unit-row');
        unitRow.append(control, unitSelect);
        wrap.appendChild(unitRow);
      } else {
        wrap.appendChild(control);
      }
    }

    if (param.help) wrap.appendChild(div('help', param.help));
    return wrap;
  }

  function applyPresetOnModelChange(container, spec) {
    const presets = spec.presets || {};
    const modelField = container.querySelector('[data-param="model"]');
    if (!modelField || !Object.keys(presets).length) return;
    const select = modelField.querySelector('select');
    if (!select) return;
    select.addEventListener('change', () => {
      const preset = presets[select.value];
      if (!preset) return;
      for (const [key, value] of Object.entries(preset)) {
        const field = container.querySelector(`[data-param="${key}"]`);
        const input = field ? field.querySelector('input') : null;
        if (!input) continue;
        const unit = field.querySelector('[data-role="param-unit"]');
        const factor = unit ? (Number(unit.value) || 1) : 1;
        input.value = trimNumber(Number(value) / factor);
      }
    });
  }

  // 电源波形：不同 wave 只显示实际参与计算的参数，避免 DC 还显示幅值/频率。
  const WAVE_FIELDS = {
    dc: ['offset'],
    sine: ['offset', 'amplitude', 'frequency', 'phase', 'delay'],
    square: ['offset', 'amplitude', 'frequency', 'phase', 'delay'],
    triangle: ['offset', 'amplitude', 'frequency', 'phase', 'delay'],
    saw: ['offset', 'amplitude', 'frequency', 'phase', 'delay'],
    pulse: ['offset', 'amplitude', 'frequency', 'phase', 'duty', 'delay'],
    step: ['offset', 'amplitude', 'delay'],
    ramp: ['offset', 'amplitude', 'delay'],
  };

  function applyWaveFieldVisibility(container) {
    const waveField = container.querySelector('[data-param="wave"]');
    const select = waveField ? waveField.querySelector('select') : null;
    if (!select) return;
    const allowed = new Set(WAVE_FIELDS[select.value] || []);
    for (const field of container.querySelectorAll('.field[data-param]')) {
      const key = field.dataset.param;
      if (key === 'wave') continue;
      field.hidden = !allowed.has(key);
    }
    const hint = waveField.querySelector('[data-role="wave-hint"]');
    if (hint) {
      hint.textContent = select.value === 'dc'
        ? 'DC 模式只使用「偏置 / 直流电压」；幅值、频率等不参与计算。'
        : '周期波形使用偏置 + 幅值 + 频率（方波/脉冲另有占空比）。';
    }
  }

  function buildWaveFieldVisibility(container) {
    const waveField = container.querySelector('[data-param="wave"]');
    if (!waveField) return;
    const select = waveField.querySelector('select');
    if (!select) return;
    if (!waveField.querySelector('[data-role="wave-hint"]')) {
      const hint = div('help');
      hint.dataset.role = 'wave-hint';
      waveField.appendChild(hint);
    }
    select.addEventListener('change', () => applyWaveFieldVisibility(container));
    applyWaveFieldVisibility(container);
  }

  function buildParamFields(spec, params) {
    const container = div('params-grid');
    container.dataset.role = 'params';
    if (!spec || !Array.isArray(spec.params) || !spec.params.length) {
      container.appendChild(div('help', '该类型没有可调参数。'));
      return container;
    }
    const values = Object.assign({}, specDefaults(spec), params || {});
    for (const param of spec.params) {
      if (!(param.key in values)) values[param.key] = clone(param.default);
      container.appendChild(buildParamField(param, values[param.key]));
    }
    applyPresetOnModelChange(container, spec);
    buildWaveFieldVisibility(container);
    return container;
  }

  function collectParamValues(container) {
    const values = {};
    for (const wrapper of $$('[data-param]', container)) {
      const key = wrapper.dataset.param;
      const type = wrapper.dataset.type;
      const label = wrapper.dataset.label || key;
      const input = wrapper.querySelector('input, select, textarea');
      if (!input) continue;
      if (type === 'bool') {
        values[key] = Boolean(input.checked);
      } else if (type === 'float' || type === 'int') {
        const text = String(input.value).trim();
        if (!text) throw new Error(`参数「${label}」不能为空`);
        const number = Number(text);
        if (!Number.isFinite(number)) throw new Error(`参数「${label}」必须是有限数字`);
        if (type === 'int' && !Number.isInteger(number)) throw new Error(`参数「${label}」必须是整数`);
        const unitSelect = wrapper.querySelector('[data-role="param-unit"]');
        values[key] = unitSelect ? number * (Number(unitSelect.value) || 1) : number;
      } else if (type === 'json' || type === 'matrix' || type === 'list' || type === 'mapping') {
        try {
          values[key] = JSON.parse(input.value);
        } catch (error) {
          input.classList.add('invalid');
          throw new Error(`参数「${label}」不是合法 JSON`);
        }
      } else {
        values[key] = input.value;
      }
    }
    return values;
  }

  function dataRow(key, value) {
    const row = div('data-row');
    const keyInput = el('input');
    keyInput.type = 'text';
    keyInput.className = 'data-key';
    keyInput.placeholder = '字段';
    keyInput.value = key;
    keyInput.spellcheck = false;
    const valueInput = el('input');
    valueInput.type = 'text';
    valueInput.className = 'data-val';
    valueInput.placeholder = '数值 / 文本 / JSON';
    valueInput.value = valueToText(value);
    valueInput.spellcheck = false;
    const remove = button('×', 'icon-btn', () => {
      row.remove();
      markDirty();
    });
    remove.title = '删除该字段';
    keyInput.addEventListener('input', markDirty);
    valueInput.addEventListener('input', markDirty);
    row.append(keyInput, valueInput, remove);
    return row;
  }

  function collectData(container) {
    const result = {};
    for (const row of $$('.data-row', container)) {
      const key = row.querySelector('.data-key').value.trim();
      if (!key) continue;
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        throw new Error(`数据字段「${key}」重复`);
      }
      result[key] = parseSmartValue(row.querySelector('.data-val').value);
    }
    return result;
  }

  function sectionLabel(text, note) {
    const label = div('section-label');
    label.appendChild(el('span', null, text));
    if (note) label.appendChild(el('em', null, note));
    return label;
  }

  function section(title, note, ...children) {
    const wrapper = div('section');
    wrapper.appendChild(sectionLabel(title, note));
    for (const child of children) wrapper.appendChild(child);
    return wrapper;
  }

  function renderEmptyInspector() {
    const host = div('empty-state');
    host.appendChild(el('b', null, '未选择对象'));
    host.appendChild(div('help', '在画布上单击节点或连接以检查参数；双击可直接编辑。也可以从下面的入口开始：'));
    const actions = div('insp-actions');
    actions.appendChild(button('添加节点', 'btn primary', () => {
      const place = centerPlacement();
      openAddMenu(state.canvasSize.w / 2, state.canvasSize.h / 2, place.x, place.y);
    }));
    actions.appendChild(button('适配视图', 'btn', () => fitView(true)));
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

  function buildDevicePinList(node) {
    const container = div('kv');
    const wires = (state.scene?.edges || []).filter((edge) => edge.kind === 'wire');
    const pins = devicePins(node);
    if (!pins.length) {
      container.appendChild(div('help', '该元件没有引脚声明。'));
      return container;
    }
    for (const pin of pins) {
      const row = div('kv-row');
      row.appendChild(el('span', null, `${pin.name}${pin.required ? ' *' : ''}`));
      const wire = wires.find((edge) => (edge.source === node.id && edge.source_pin === pin.name)
        || (edge.target === node.id && edge.target_pin === pin.name));
      const netId = wire ? (wire.source === node.id ? wire.target : wire.source) : '';
      const net = netId ? nodeById(netId) : null;
      row.appendChild(el('b', null, net ? net.name : (pin.required ? '未接' : '—')));
      container.appendChild(row);
    }
    return container;
  }

  function renderInspector() {
    syncFnRoleToSelection();
    scheduleSpecRender();
    if (!state.selection.type) {
      renderEmptyInspector();
      return;
    }
    if (state.selection.type === 'node') {
      const node = selectedNode();
      if (!node) {
        clearSelection();
        return;
      }
      renderNodeInspector(node);
    } else {
      const edge = selectedEdge();
      if (!edge) {
        clearSelection();
        return;
      }
      renderEdgeInspector(edge);
    }
  }

  function buildHeader(titleText, subtitle, specLabel) {
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

  function renderNodeInspector(node) {
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
      const portNames = modulePorts(node).map((port) => port.name).join('、') || '（无端口）';
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
      kindSelect = buildKindSelect('node', node.kind, node.id);
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
    sizeInput.value = String(Math.round(isDevice ? (Number(node.size?.w) || 120) : nodeDiameter(node)));
    sizeInput.dataset.role = 'node-size';
    sizeInput.addEventListener('change', () => {
      const value = clamp(Math.round(Number(sizeInput.value) || (isDevice ? (Number(node.size?.w) || 120) : nodeDiameter(node))), 24, 200);
      sizeInput.value = String(value);
      void patchNodeGeometry(node.id, { size: { w: value } });
    });
    sizeField.appendChild(sizeInput);
    identity.appendChild(sizeField);

    const params = buildParamFields(spec, node.params || {});
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

    let dataEditor = null;
    if (state.mode !== 'circuit') {
      dataEditor = div('data-rows');
      dataEditor.dataset.role = 'data';
      const entries = Object.entries(node.data || {});
      if (entries.length) {
        for (const [key, value] of entries) dataEditor.appendChild(dataRow(key, value));
      }
      const addRow = button('＋ 添加字段', 'btn tiny', () => {
        const row = dataRow('', '');
        dataEditor.appendChild(row);
        row.querySelector('.data-key').focus();
        markDirty();
      });
      const note = div('help', '计算节点会覆盖输出字段的值；手动数据源则以这里的值为准。值为数字、true/false、JSON 数组/对象或文本。');
      dataEditor.appendChild(addRow);
      dataEditor.appendChild(note);
    }

    const live = div('kv');
    live.dataset.role = 'node-live';
    const display = nodeDisplayData(node);
    const numericFields = Object.keys(display).filter((key) => typeof display[key] === 'number');
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
      section('参数', spec?.notes || '', params),
      ...(dataEditor ? [section('节点数据', '实时字段', dataEditor)] : []),
      section('实时值', '随帧更新', live),
      section('内部状态', '只读', statePre),
      actions,
    );

    if (kindSelect) kindSelect.addEventListener('change', () => {
      const nextSpec = getNodeSpec(kindSelect.value);
      const nextParams = buildParamFields(nextSpec, specDefaults(nextSpec));
      const current = form.querySelector('[data-role="params"]');
      if (current) current.replaceWith(nextParams);
      desc.textContent = nextSpec?.description || '';
      badge.textContent = nextSpec?.label || kindSelect.value;
      markDirty();
    });

    form.addEventListener('input', markDirty);
    form.addEventListener('change', markDirty);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void applyInspector();
    });

    ui.inspector.replaceChildren(head, form);
    state.inspectorId = `node:${node.id}`;
    state.inspectorDirty = false;
    updateInspectorLive();
  }

  function renderWireInspector(edge) {
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
    const appendPoint = (x, y) => {
      const row = div('inline-fields');
      row.dataset.role = 'waypoint-row';
      for (const [axis, value] of [['x', x], ['y', y]]) {
        const field = div('field');
        field.appendChild(numberedField(axis.toUpperCase(), ''));
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
      const x = last ? Number(last.querySelector('[data-role="waypoint-x"]').value) + 40 : 0;
      const y = last ? Number(last.querySelector('[data-role="waypoint-y"]').value) : 0;
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
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void applyInspector();
    });
    ui.inspector.replaceChildren(head, form);
    state.inspectorId = `edge:${edge.id}`;
    state.inspectorDirty = false;
  }

  function renderEdgeInspector(edge) {
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
    const kindSelect = buildKindSelect('edge', edge.kind, edge.id);
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

    const params = buildParamFields(spec, edge.params || {});

    let portSection = null;
    if (state.mode !== 'circuit') {
      const sourceSpec = getNodeSpec(source?.kind);
      const targetSpec = getNodeSpec(target?.kind);
      const outputs = Array.isArray(sourceSpec?.outputs) ? sourceSpec.outputs : [];
      const inputs = Array.isArray(targetSpec?.inputs) ? targetSpec.inputs : [];
      if (outputs.length || inputs.length) {
        const grid = div('params-grid');
        const makePort = (role, options, current) => {
          const wrapper = div('field');
          wrapper.appendChild(numberedField(role === 'source' ? '源端口' : '目标端口',
            role === 'source' ? '取源节点的哪个输出字段' : '写入目标节点的哪个输入端口'));
          const select = el('select');
          select.dataset.role = role === 'source' ? 'source-port' : 'target-port';
          const empty = el('option', null, '（不绑定，兼容旧语义）');
          empty.value = '';
          select.appendChild(empty);
          const names = options.map((item) => (typeof item === 'string' ? item : item.name));
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
    const fields = Object.keys(output).filter((key) => typeof output[key] === 'number');
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
      section('参数', spec?.notes || '', params),
      section('实时输出', '随帧更新', live),
      section('连接状态', '只读', statePre),
      actions,
    );

    kindSelect.addEventListener('change', () => {
      const nextSpec = getEdgeSpec(kindSelect.value);
      const nextParams = buildParamFields(nextSpec, specDefaults(nextSpec));
      const current = form.querySelector('[data-role="params"]');
      if (current) current.replaceWith(nextParams);
      desc.textContent = nextSpec?.description || '';
      badge.textContent = nextSpec?.label || kindSelect.value;
      markDirty();
    });

    form.addEventListener('input', markDirty);
    form.addEventListener('change', markDirty);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void applyInspector();
    });

    ui.inspector.replaceChildren(head, form);
    state.inspectorId = `edge:${edge.id}`;
    state.inspectorDirty = false;
    updateInspectorLive();
  }

  async function applyInspector(options = {}) {
    if (!state.selection.type) return true;
    const form = ui.inspector.querySelector('[data-role="form"]');
    if (!form) return true;
    if (state.busy) {
      if (!options.quiet) toast('正在处理其他请求，请稍候…', 'info', 1500);
      return false;
    }
    state.busy = true;
    try {
      const name = form.querySelector('[data-role="name"]').value.trim();
      const kind = form.querySelector('[data-role="kind"]').value;
      const params = collectParamValues(form.querySelector('[data-role="params"]'));

      if (state.selection.type === 'node') {
        const node = selectedNode();
        if (!node) return false;
        const payload = { name, kind, params };
        if (node.kind === 'device') params.element = String(node.params?.element || '');
        if (state.mode !== 'circuit') {
          const dataHost = form.querySelector('[data-role="data"]');
          if (dataHost) payload.data = collectData(dataHost);
        }
        const response = await jsonRequest(`/api/nodes/${encodeURIComponent(node.id)}`, 'PATCH', payload);
        const index = state.scene.nodes.findIndex((item) => item.id === node.id);
        if (index >= 0) state.scene.nodes[index] = response.node;
        if (response.sim) state.sim = response.sim;
        state.scene.revision = response.revision ?? state.scene.revision;
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
      const payload = { name, kind, params };
      if (state.mode !== 'circuit') payload.delay = Boolean(form.querySelector('[data-role="delay"]')?.checked);
      else payload.delay = false;
      const sourcePortBox = form.querySelector('[data-role="source-port"]');
      const targetPortBox = form.querySelector('[data-role="target-port"]');
      if (sourcePortBox) payload.source_port = sourcePortBox.value;
      if (targetPortBox) payload.target_port = targetPortBox.value;
      const waypointBox = form.querySelector('[data-role="waypoints"]');
      if (waypointBox) {
        payload.waypoints = [...waypointBox.querySelectorAll('[data-role="waypoint-row"]')].map((row) => ({
          x: Number(row.querySelector('[data-role="waypoint-x"]').value) || 0,
          y: Number(row.querySelector('[data-role="waypoint-y"]').value) || 0,
        }));
        payload.route = payload.waypoints.length ? 'manual' : 'auto';
      }
      const enabledBox = form.querySelector('[data-role="enabled"]');
      if (enabledBox) payload.enabled = Boolean(enabledBox.checked);
      const response = await jsonRequest(`/api/edges/${encodeURIComponent(edge.id)}`, 'PATCH', payload);
      const index = state.scene.edges.findIndex((item) => item.id === edge.id);
      if (index >= 0) state.scene.edges[index] = response.edge;
      if (response.sim) state.sim = response.sim;
      state.scene.revision = response.revision ?? state.scene.revision;
      state.inspectorDirty = false;
      syncUI();
      updateScenePanelValues();
      renderInspector();
      updateSignalKeyCache();
      if (!options.quiet) toast('连接已保存', 'ok', 1800);
      void refreshState(true);
      return true;
    } catch (error) {
      const message = error?.message || String(error);
      toast(message, 'error', 7000);
      if (!options.quiet && /电路|代数环|接地|奇异|发散/.test(message)) showBanner(message);
      return false;
    } finally {
      state.busy = false;
    }
  }

  function updateInspectorLive() {
    if (!state.inspectorId) return;
    const selected = selectedNode();
    if (selected) {
      const data = nodeDisplayData(selected);
      for (const value of $$('[data-live-node-value]', ui.inspector)) {
        if (value.dataset.node !== selected.id) continue;
        value.textContent = formatAny(data[value.dataset.field]);
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
        value.textContent = formatAny(data[value.dataset.field]);
      }
      const statePre = ui.inspector.querySelector('[data-live-state]');
      if (statePre) {
        const text = JSON.stringify(edge.state || {}, null, 2);
        if (statePre.textContent !== text) statePre.textContent = text;
      }
    }
  }

  /* ======================================================================
   * 6.5 规格查看（函数 / 公式）与 Python 扩展面板
   * ==================================================================== */

  function specListForMode() {
    if (!state.catalog) return [];
    return state.mode === 'circuit'
      ? { nodes: state.catalog.circuit_nodes || [], edges: state.catalog.elements || [] }
      : { nodes: state.catalog.computes || [], edges: state.catalog.methods || [] };
  }

  function specTarget() {
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

  function specByKind(role, kind) {
    const lists = specListForMode();
    const list = role === 'edge' ? lists.edges : lists.nodes;
    return (list || []).find((spec) => spec.kind === kind) || null;
  }

  function specBadges(spec) {
    const row = div('spec-badges');
    row.appendChild(el('span', 'badge', String(spec.mode || state.mode)));
    row.appendChild(el('span', spec.builtin ? 'badge gray' : 'badge violet', spec.builtin ? '内置' : '扩展'));
    if (spec.editable) row.appendChild(el('span', 'badge green', '可自定义'));
    return row;
  }

  function paramRangeText(param) {
    const parts = [];
    if (param.min !== undefined && param.min !== null) parts.push(`≥ ${param.min}`);
    if (param.max !== undefined && param.max !== null) parts.push(`≤ ${param.max}`);
    if (param.positive) parts.push('> 0');
    if (param.step !== undefined && param.step !== null) parts.push(`步长 ${param.step}`);
    return parts.join(' · ');
  }

  function paramTable(spec) {
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
      nameCell.appendChild(el('code', null, param.label || param.key));
      nameCell.appendChild(el('span', 'spec-key', param.key));
      row.appendChild(nameCell);
      row.appendChild(el('td', null, param.type));
      const def = param.default;
      row.appendChild(
        el('td', null, typeof def === 'object' && def !== null ? JSON.stringify(def) : String(def ?? '')),
      );
      row.appendChild(el('td', null, param.unit || '—'));
      row.appendChild(el('td', null, paramRangeText(param) || '—'));
      row.appendChild(el('td', null, param.required ? '是' : ''));
      const helpCell = el('td', 'spec-help', param.help || '');
      attachParamHelp(helpCell, param, spec, state.specRole || 'node');
      row.appendChild(helpCell);
      table.appendChild(row);
    }
    wrap.appendChild(table);
    return wrap;
  }

  function sourceBlock(source) {
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

  function renderSpecPane() {
    if (!ui.specPane) return;
    const fnRole = state.fnRole || 'node';
    const rawTarget = specTarget();
    const target = rawTarget && rawTarget.role === fnRole ? rawTarget : null;
    const lists = specListForMode();
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
    host.appendChild(section('源码', 'inspect 读取的真实实现', sourceHead, sourceBlock(spec.source)));

    if (!spec.builtin) {
      const note = div('help', '这是用户扩展提供的实现：代码在服务端本进程执行，不是沙箱。');
      note.style.marginTop = '10px';
      host.appendChild(note);
    }

    ui.specPane.replaceChildren(host);
  }

  function scheduleSpecRender() {
    const tab = activeTab();
    if (tab === 'spec' || tab === 'node-fn' || tab === 'edge-fn') renderSpecPane();
  }

  function applyExtensionResult(box) {
    const saved = state.ext.result;
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

  function showExtensionResult(kind, message, detail) {
    state.ext.result = { kind, message: message || '', detail };
    const box = ui.extPane?.querySelector('[data-role="ext-result"]');
    if (!box) {
      if (message) toast(message, kind === 'error' ? 'error' : kind === 'ok' ? 'ok' : 'info', 6000);
      return;
    }
    applyExtensionResult(box);
  }

  async function refreshExtensions() {
    try {
      const payload = await api('/api/extensions');
      state.ext.list = Array.isArray(payload.extensions) ? payload.extensions : [];
      state.ext.scan = Array.isArray(payload.scan?.files) ? payload.scan.files : [];
      state.ext.notice = String(payload.notice || '');
      renderExtensionPanel();
      return payload;
    } catch (error) {
      showExtensionResult('error', `读取扩展列表失败：${error.message}`);
      return null;
    }
  }

  function extensionEditorCode() {
    const area = ui.extPane?.querySelector('[data-role="ext-code"]');
    return area ? area.value : state.ext.code;
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
          ? `校验通过：声明了 ${declared.length} 个 kind（${declared.map((item) => item.kind || item.function).join('、')}）`
          : '校验通过：没有检测到 node/method 声明，启用后不会注册任何东西。',
        declared,
      );
    } catch (error) {
      showExtensionResult('error', error.message);
    }
  }

  async function activateExtension() {
    const code = extensionEditorCode();
    const filenameInput = ui.extPane?.querySelector('[data-role="ext-filename"]');
    const filename = filenameInput ? filenameInput.value.trim() : '';
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
      if (state.selection.type) renderInspector();
      return result;
    } catch (error) {
      showExtensionResult('error', `启用失败：${error.message}`);
      return null;
    }
  }

  async function deactivateExtension(kind) {
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
      if (state.selection.type) renderInspector();
    } catch (error) {
      showExtensionResult('error', `停用失败：${error.message}`);
    }
  }

  function loadExtensionIntoEditor(kind, code) {
    state.ext.code = String(code || '');
    const area = ui.extPane?.querySelector('[data-role="ext-code"]');
    if (area) area.value = state.ext.code;
    const nameInput = ui.extPane?.querySelector('[data-role="ext-filename"]');
    if (nameInput) nameInput.value = String(kind || '').replace(/[^\w.-]+/g, '_');
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

  function renderExtensionPanel() {
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
        if (area) area.value = state.ext.code;
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
    if (!state.ext.list.length) {
      listBlock.appendChild(div('help', '当前没有已启用的用户扩展。'));
    }
    for (const item of state.ext.list) {
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
        button('载入编辑器', 'btn tiny', () => loadExtensionIntoEditor(item.kind, item.source)),
      );
      actions.appendChild(button('停用', 'btn tiny danger', () => void deactivateExtension(item.kind)));
      card.appendChild(actions);
      listBlock.appendChild(card);
    }
    host.appendChild(section('已启用的扩展', `${state.ext.list.length} 个`, listBlock));

    const scanned = Array.isArray(state.ext.scan) ? state.ext.scan : [];
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
            button('载入编辑器', 'btn tiny', () => loadExtensionIntoEditor(item.filename || '', item.code || '')),
          );
          card.appendChild(actions);
        }
        scanBlock.appendChild(card);
      }
      host.appendChild(section('扩展目录中未启用的文件', `${scanned.length} 个`, scanBlock));
    }

    ui.extPane.replaceChildren(host);
  }

  /* ======================================================================
   * 7. 节点 / 连接 / 场景变更
   * ==================================================================== */

  async function alignSelection(mode) {
    const targets = [...multiSelection().nodes].map((id) => nodeById(id)).filter(Boolean);
    if (targets.length < 2) {
      toast('至少选中两个节点/器件才能对齐', 'info', 2400);
      return;
    }
    const xs = targets.map((node) => node.position.x);
    const ys = targets.map((node) => node.position.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const positions = targets.map((node) => {
      let x = node.position.x;
      let y = node.position.y;
      if (mode === 'left') x = minX;
      else if (mode === 'right') x = maxX;
      else if (mode === 'centerX') x = (minX + maxX) / 2;
      else if (mode === 'top') y = minY;
      else if (mode === 'bottom') y = maxY;
      else if (mode === 'centerY') y = (minY + maxY) / 2;
      return { id: node.id, position: { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 } };
    });
    try {
      await jsonRequest('/api/positions', 'POST', { positions });
      await refreshState(true);
      toast(`已对齐 ${targets.length} 个节点（${mode}）`, 'ok', 2200);
    } catch (error) {
      toast(`对齐失败：${error.message}`, 'error', 4000);
    }
  }

  async function distributeSelection(axis) {
    const targets = [...multiSelection().nodes].map((id) => nodeById(id)).filter(Boolean);
    if (targets.length < 3) {
      toast('等距分布至少需要三个节点/器件', 'info', 2400);
      return;
    }
    const key = axis === 'y' ? 'y' : 'x';
    const sorted = [...targets].sort((a, b) => a.position[key] - b.position[key]);
    const first = sorted[0].position[key];
    const last = sorted[sorted.length - 1].position[key];
    const step = (last - first) / (sorted.length - 1);
    const positions = sorted.map((node, index) => {
      const value = index === 0 || index === sorted.length - 1
        ? node.position[key]
        : first + step * index;
      const x = key === 'x' ? value : node.position.x;
      const y = key === 'y' ? value : node.position.y;
      return { id: node.id, position: { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 } };
    });
    try {
      await jsonRequest('/api/positions', 'POST', { positions });
      await refreshState(true);
      toast(`已等距分布 ${targets.length} 个节点（${axis === 'y' ? '纵向' : '横向'}）`, 'ok', 2200);
    } catch (error) {
      toast(`分布失败：${error.message}`, 'error', 4000);
    }
  }

  function selectWireNetwork(edge) {
    const ends = new Set([edge.source, edge.target]);
    const wires = (state.scene?.edges || []).filter(
      (item) => item.kind === 'wire' && (ends.has(item.source) || ends.has(item.target)),
    );
    state.multi.nodes = new Set(ends);
    state.multi.edges = new Set(wires.map((item) => item.id));
    state.selection = { type: null, id: null };
    requestDraw();
    toast(`已选中 ${wires.length} 条导线 / ${ends.size} 个端点`, 'info', 2200);
  }

  async function addWireWaypoint(edge) {
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    if (!source || !target) return;
    const x = (source.position.x + target.position.x) / 2;
    const y = (source.position.y + target.position.y) / 2;
    const waypoints = [...(edge.waypoints || []), { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }];
    try {
      await jsonRequest(`/api/edges/${encodeURIComponent(edge.id)}`, 'PATCH', {
        route: 'manual',
        waypoints,
      });
      await refreshState(true);
      state.selection = { type: 'edge', id: edge.id };
      renderInspector();
      requestDraw();
      toast(`已添加拐点（共 ${waypoints.length} 个）；可直接拖动拐点，画布会显示坐标`, 'ok', 2800);
    } catch (error) {
      toast(`添加拐点失败：${error.message}`, 'error', 4000);
    }
  }

  async function clearWireWaypoints(edgeId) {
    try {
      await jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, 'PATCH', {
        route: 'auto',
        waypoints: [],
      });
      await refreshState(true);
      toast('已清除拐点，恢复自动布线', 'ok', 2200);
    } catch (error) {
      toast(`清除拐点失败：${error.message}`, 'error', 4000);
    }
  }

  async function batchResizeSelection() {
    const { nodes } = multiSelection();
    const targets = [...nodes].map((id) => nodeById(id)).filter(Boolean);
    if (!targets.length) {
      toast('先多选节点/器件（Ctrl+单击），再执行批量尺寸', 'info', 2800);
      return;
    }
    const raw = window.prompt(
      `统一尺寸（24–200，宽/直径）；将应用到 ${targets.length} 个节点/器件`,
      '60',
    );
    if (raw === null) return;
    const width = Number(raw);
    if (!Number.isFinite(width) || width < 24 || width > 200) {
      toast('尺寸需在 24–200 之间', 'error', 3000);
      return;
    }
    let done = 0;
    for (const node of targets) {
      if (node.kind === 'ground') continue;
      try {
        await jsonRequest(`/api/nodes/${encodeURIComponent(node.id)}`, 'PATCH', {
          size: { w: Math.round(width) },
        });
        done += 1;
      } catch (error) {
        toast(`设置 ${node.name} 失败：${error.message}`, 'error', 4000);
      }
    }
    if (done) {
      await refreshState(true);
      toast(`已统一 ${done} 个节点/器件尺寸为 ${Math.round(width)}`, 'ok', 2600);
    }
  }

  async function addNodeAt(kind, screenX, screenY) {
    const spec = getNodeSpec(kind);
    if (!spec) {
      toast(`当前模式没有节点类型 ${kind}`, 'error');
      return;
    }
    const world = screenToWorld(screenX, screenY);
    const snapped = snapWorld(world.x, world.y);
    const base = kind === 'ground' ? 'gnd' : kind === 'node' ? 'n' : kind.replace(/[^a-z0-9_]/gi, '') || 'node';
    const name = uniqueNodeName(base);
    const payload = {
      name,
      kind,
      params: specDefaults(spec),
      data: kind === 'manual'
        ? (state.mode === 'vector' ? { x: 1.0, y: 0.0 } : { voltage: 1.0 })
        : {},
      position: {
        x: clamp(Math.round(snapped.x), -10000, 10000),
        y: clamp(Math.round(snapped.y), -10000, 10000),
      },
    };
    const response = await task(() => jsonRequest('/api/nodes', 'POST', payload));
    if (!response) return;
    applySnapshot(response);
    await selectEntity('node', response.node.id, true);
    switchTab('inspect');
    if (kind === 'ground') {
      const count = (state.scene?.nodes || []).filter((node) => node.kind === 'ground').length;
      toast(`已添加接地：共 ${count} 个，自动合并为 0V`, 'ok', 2600);
    } else {
      toast(`已添加节点 ${response.node.name}`, 'ok', 2000);
    }
  }

  async function addDeviceAt(element, screenX, screenY) {
    const spec = getEdgeSpec(element);
    if (!spec) {
      toast(`当前模式没有器件类型 ${element}`, 'error');
      return;
    }
    const world = screenToWorld(screenX, screenY);
    const snapped = snapWorld(world.x, world.y);
    const name = uniqueNodeName(element.replace(/[^a-z0-9]/gi, '') || 'dev');
    const payload = {
      name,
      kind: 'device',
      params: { element, ...specDefaults(spec) },
      data: {},
      position: {
        x: clamp(Math.round(snapped.x), -10000, 10000),
        y: clamp(Math.round(snapped.y), -10000, 10000),
      },
    };
    const response = await task(() => jsonRequest('/api/nodes', 'POST', payload));
    if (!response) return;
    applySnapshot(response);
    await selectEntity('node', response.node.id, true);
    switchTab('inspect');
    toast(`已添加器件 ${response.node.name}`, 'ok', 2000);
  }

  async function createWire(deviceId, netId, pinName) {
    return createWireBetween(deviceId, netId, pinName, '');
  }

  async function createWireBetween(sourceId, targetId, sourcePin, targetPin) {
    const source = nodeById(sourceId);
    const target = nodeById(targetId);
    if (!source || !target) {
      toast('连线的端点不存在', 'error', 3000);
      return;
    }
    if (source.id === target.id) {
      toast('连线的两个端点不能是同一个节点', 'error', 3000);
      return;
    }
    // 器件与模块实例都是"带引脚的东西"：模块实例的端口就是引脚。
    if (isPinNode(source) && isPinNode(target)) {
      toast('导线不允许直接连接两个器件（请经网络节点）', 'error', 3500);
      return;
    }
    const body = {
      source: source.id,
      target: target.id,
      kind: 'wire',
      params: {},
      enabled: true,
      route: state.ui?.circuitOrthogonal !== false ? 'orthogonal' : 'straight',
    };
    // 模块实例以前被漏掉（只判 kind==='device'），导致连到模块上的导线不带引脚。
    // 只有唯一端口时直接用它——用户从模块符号上拖线时不必再挑一次引脚。
    const pinFor = (node, pin) => {
      if (pin) return pin;
      const pins = devicePins(node);
      return pins.length === 1 ? String(pins[0].name || '') : '';
    };
    if (isPinNode(source)) body.source_pin = pinFor(source, sourcePin);
    if (isPinNode(target)) body.target_pin = pinFor(target, targetPin);
    const response = await task(() => jsonRequest('/api/edges', 'POST', body));
    if (!response) return;
    applySnapshot(response);
    if (response.edge) {
      await selectEntity('edge', response.edge.id, true);
      switchTab('inspect');
    }
    toast('已创建导线', 'ok', 1800);
  }

  function openWireDialog() {
    if (state.mode !== 'circuit') {
      toast('连线对话框只用于电路场景', 'error', 3000);
      return;
    }
    const nodes = state.scene?.nodes || [];
    if (nodes.length < 2) {
      toast('至少需要两个节点才能连线', 'error', 3000);
      return;
    }
    ui.modalCard.replaceChildren();
    const heading = el('h3', null, '新建连线（选择端点）');
    const note = el('p', null, '端点可以是「网络节点 ↔ 网络节点」（纯导线，电气合并）或「器件引脚 ↔ 网络节点」。');
    const form = el('form');
    form.autocomplete = 'off';
    const rows = div('inline-fields');
    const makeSelect = (roleLabel) => {
      const wrap = div('field');
      wrap.appendChild(numberedField(roleLabel, ''));
      const select = el('select');
      select.dataset.role = roleLabel.includes('A') ? 'wire-a' : 'wire-b';
      for (const node of nodes) {
        const option = el('option', null, `${node.name} · ${node.kind === 'module' ? `模块 ${node.params?.block_name || ''}`.trim() : node.kind === 'device' ? (node.params?.element || 'device') : node.kind}`);
        option.value = node.id;
        select.appendChild(option);
      }
      wrap.appendChild(select);
      const pinWrap = div('field');
      pinWrap.appendChild(numberedField('引脚', '器件节点必填'));
      const pinSelect = el('select');
      pinSelect.dataset.role = roleLabel.includes('A') ? 'wire-a-pin' : 'wire-b-pin';
      pinWrap.appendChild(pinSelect);
      return { wrap, select, pinWrap, pinSelect };
    };
    const first = makeSelect('端点 A');
    const second = makeSelect('端点 B');
    const refreshPins = () => {
      for (const item of [first, second]) {
        const node = nodeById(item.select.value);
        item.pinSelect.replaceChildren();
        const blank = el('option', null, isPinNode(node) ? '（请选择引脚）' : '—');
        blank.value = '';
        item.pinSelect.appendChild(blank);
        if (isPinNode(node)) {
          for (const pin of devicePins(node)) {
            const option = el('option', null, `${pin.name}（${pin.role}${pin.required ? ' · 必接' : ''}）`);
            option.value = pin.name;
            item.pinSelect.appendChild(option);
          }
        }
        item.pinSelect.disabled = !isPinNode(node);
      }
    };
    first.select.addEventListener('change', refreshPins);
    second.select.addEventListener('change', refreshPins);
    if (nodes[1]) second.select.value = nodes[1].id;
    refreshPins();
    rows.append(first.wrap, first.pinWrap, second.wrap, second.pinWrap);
    form.appendChild(rows);
    const actions = div('modal-actions');
    const cancel = button('取消', 'btn', closeModal);
    const create = button('创建连线', 'btn primary', null);
    create.type = 'button';
    create.addEventListener('click', () => {
      const a = nodeById(first.select.value);
      const b = nodeById(second.select.value);
      const aPin = isPinNode(a) ? first.pinSelect.value : '';
      const bPin = isPinNode(b) ? second.pinSelect.value : '';
      if (isPinNode(a) && !aPin) {
        toast('端点 A 是器件，请选择引脚', 'error', 3000);
        return;
      }
      if (isPinNode(b) && !bPin) {
        toast('端点 B 是器件，请选择引脚', 'error', 3000);
        return;
      }
      closeModal();
      void createWireBetween(first.select.value, second.select.value, aPin, bPin);
    });
    actions.append(cancel, create);
    form.append(actions);
    ui.modalCard.append(heading, note, form);
    ui.modal.classList.remove('hidden');
  }

  async function createEdge(source, target, kind) {
    const spec = getEdgeSpec(kind);
    if (!spec) {
      toast(`当前模式没有连接类型 ${kind}`, 'error');
      return;
    }
    const body = {
      source,
      target,
      kind,
      params: specDefaults(spec),
      delay: false,
      enabled: true,
      auto_delay: true,
    };
    if (state.mode === 'circuit' && state.ui?.circuitOrthogonal !== false) body.route = 'orthogonal';
    const response = await task(() => jsonRequest('/api/edges', 'POST', body));
    if (!response) return;
    applySnapshot(response);
    if (response.edge) {
      await selectEntity('edge', response.edge.id, true);
      switchTab('inspect');
    }
    if (response.notice) toast(response.notice, 'info', 5000);
    else toast(`已创建连接 ${response.edge?.name || ''}`, 'ok', 1800);
  }

  async function toggleEdgeDelay(edgeId) {
    const edge = edgeById(edgeId);
    if (!edge) return;
    const response = await task(() => jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, 'PATCH', { delay: !edge.delay }));
    if (!response) return;
    const index = state.scene.edges.findIndex((item) => item.id === edgeId);
    if (index >= 0) state.scene.edges[index] = response.edge;
    if (response.sim) state.sim = response.sim;
    syncUI();
    requestDraw();
    toast(response.edge.delay ? '已设为单步延迟' : '已取消单步延迟', 'ok', 2000);
    void refreshState(true);
  }

  async function deleteNode(nodeId) {
    const node = nodeById(nodeId);
    if (!node) return;
    const connected = (state.scene?.edges || []).filter((edge) => edge.source === nodeId || edge.target === nodeId).length;
    const confirmed = await confirmModal(
      `删除节点「${node.name}」？`,
      connected
        ? `将同时删除 ${connected} 条相连的连接。该操作不可撤销。`
        : '该操作不可撤销。',
      '删除',
      true,
    );
    if (!confirmed) return;
    const response = await task(() => jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, 'DELETE'));
    if (!response) return;
    if (state.selection.type === 'node' && state.selection.id === nodeId) {
      state.selection = { type: null, id: null };
      state.inspectorId = null;
    }
    applySnapshot(response);
    renderInspector();
    toast('节点已删除', 'ok', 1800);
  }

  async function deleteEdge(edgeId) {
    const edge = edgeById(edgeId);
    if (!edge) return;
    const confirmed = await confirmModal(
      `删除连接「${edge.name}」？`,
      '只删除这条传递关系，节点与其它连接保持不变。',
      '删除',
      true,
    );
    if (!confirmed) return;
    const response = await task(() => jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, 'DELETE'));
    if (!response) return;
    if (state.selection.type === 'edge' && state.selection.id === edgeId) {
      state.selection = { type: null, id: null };
      state.inspectorId = null;
    }
    applySnapshot(response);
    renderInspector();
    toast('连接已删除', 'ok', 1800);
  }

  async function deleteSelection() {
    const { nodes, edges } = multiSelection();
    if (!nodes.size && !edges.size) return;
    await pushUndoSnapshot();
    let removed = 0;
    for (const edgeId of edges) {
      if (!edgeById(edgeId)) continue;
      const response = await task(
        () => jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, 'DELETE'),
        { history: false },
      );
      if (response) {
        removed += 1;
        applySnapshot(response);
      }
    }
    for (const nodeId of nodes) {
      if (!nodeById(nodeId)) continue;
      const response = await task(
        () => jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, 'DELETE'),
        { history: false },
      );
      if (response) {
        removed += 1;
        applySnapshot(response);
      }
    }
    clearSelection();
    await refreshState(true);
    toast(`已删除 ${removed} 个对象`, 'ok', 2200);
  }

  async function autoLayout() {
    const nodes = state.scene?.nodes || [];
    if (!nodes.length) {
      toast('画布中还没有节点', 'info', 1800);
      return;
    }
    const edges = (state.scene?.edges || []).filter((edge) => edge.enabled);
    const ids = new Set(nodes.map((node) => node.id));
    const layer = new Map(nodes.map((node) => [node.id, 0]));

    if (state.mode === 'circuit') {
      const ground = nodes.find((node) => node.kind === 'ground');
      if (ground) layer.set(ground.id, 0);
    }

    const limit = Math.min(48, nodes.length + 4);
    for (let iteration = 0; iteration < limit; iteration += 1) {
      let changed = false;
      for (const edge of edges) {
        if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
        const candidate = (layer.get(edge.source) || 0) + 1;
        if (candidate > (layer.get(edge.target) || 0) && candidate < nodes.length + 2) {
          layer.set(edge.target, candidate);
          changed = true;
        }
      }
      if (!changed) break;
    }

    const groups = new Map();
    for (const node of nodes) {
      const level = layer.get(node.id) || 0;
      if (!groups.has(level)) groups.set(level, []);
      groups.get(level).push(node);
    }
    const levels = Array.from(groups.keys()).sort((a, b) => a - b);
    const mid = (levels[0] + levels[levels.length - 1]) / 2;
    const old = new Map(nodes.map((node) => [node.id, { x: node.position.x, y: node.position.y }]));

    for (const level of levels) {
      const members = groups.get(level).sort((a, b) => {
        if (a.position.y !== b.position.y) return a.position.y - b.position.y;
        return a.name.localeCompare(b.name);
      });
      members.forEach((node, index) => {
        node.position.x = (level - mid) * 276;
        node.position.y = (index - (members.length - 1) / 2) * 128;
      });
    }

    requestDraw();
    try {
      const items = nodes.map((node) => ({
        id: node.id,
        position: { x: Number(node.position.x.toFixed(3)), y: Number(node.position.y.toFixed(3)) },
      }));
      await jsonRequest('/api/positions', 'POST', { positions: items });
      fitView();
      toast('已按信号流向重新布局', 'ok', 1800);
    } catch (error) {
      for (const node of nodes) {
        const previous = old.get(node.id);
        if (previous) {
          node.position.x = previous.x;
          node.position.y = previous.y;
        }
      }
      requestDraw();
      toast(`自动布局失败：${error.message}`, 'error', 6000);
    }
  }

  /* ======================================================================
   * 8. 场景面板：模式、节奏、统计、模板、导入导出
   * ==================================================================== */

  function fieldFor(labelText, unitText, input) {
    const wrapper = div('field');
    wrapper.appendChild(numberedField(labelText, unitText));
    wrapper.appendChild(input);
    return wrapper;
  }

  function numberInput(value, options = {}) {
    const input = el('input');
    input.type = 'number';
    if (options.min !== undefined) input.min = String(options.min);
    if (options.max !== undefined) input.max = String(options.max);
    if (options.step !== undefined) input.step = String(options.step);
    input.value = String(value);
    return input;
  }

  function renderScenePanel() {
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
    for (const item of modes) {
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
    const dtInput = numberInput(0.01, { min: 0.000000001, max: 10, step: 'any' });
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
      const preset = button(label, 'btn tiny', () => {
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
    const solverInput = (label, unit, name, value, min, max, step) => {
      const input = numberInput(value, { min, max, step });
      input.dataset.solver = name;
      return fieldFor(label, unit, input);
    };
    solverGrid.append(
      solverInput('相对容差 reltol', '', 'reltol', 1e-9, 1e-15, 0.1, 'any'),
      solverInput('电压容差 vntol', 'V', 'vntol', 1e-6, 1e-15, 1, 'any'),
      solverInput('电流容差 abstol', 'A', 'abstol', 1e-6, 1e-15, 1, 'any'),
      solverInput('Newton 上限', '次', 'max_iter', 60, 1, 500, 1),
      solverInput('gmin 步数', '步', 'gmin_steps', 10, 0, 100, 1),
      solverInput('source 步数', '步', 'src_steps', 10, 0, 100, 1),
      solverInput('残差容差', '', 'residual_tol', 0, 0, 1, 'any'),
    );
    solverSection.appendChild(solverGrid);
    solverSection.appendChild(div('help', '残差容差 0 = 只记录不强制；失败时自动 gmin/source stepping，仍失败会报最大节点。修改后立即生效（重建电路引擎）。'));
    pane.appendChild(solverSection);

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
    for (const item of state.catalog?.integration || []) {
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
      const modeBadge = el('span', 'tpl-mode', modeLabel(template.mode));
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

    projectFileInput = el('input');
    projectFileInput.type = 'file';
    projectFileInput.accept = '.netlab,application/json,.json';
    projectFileInput.className = 'hidden-input';
    projectFileInput.addEventListener('change', () => {
      const file = projectFileInput.files && projectFileInput.files[0];
      projectFileInput.value = '';
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) {
        toast('工程文件超过 8 MB，已拒绝', 'error', 6000);
        return;
      }
      void file.text().then((text) => importProjectText(text, ''));
    });
    projectSection.appendChild(projectFileInput);
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
    const gridSelect = el('select', 'input');
    for (const size of [10, 20, 50]) {
      const option = el('option', null, `${size} 单位`);
      option.value = String(size);
      gridSelect.appendChild(option);
    }
    gridSelect.value = String(Number(state.ui.grid) || 20);
    gridSelect.addEventListener('change', () => {
      state.ui.grid = Number(gridSelect.value) || 20;
      markProjectDirty();
      requestDraw();
    });
    gridRow.append(el('label', null, '吸附'), snapBox, el('label', null, '标准网格'), gridSelect);
    gridSection.appendChild(gridRow);

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
      button('整理到网格', 'btn', () => void snapSceneToGrid()),
    );
    gridSection.appendChild(div('help', '元件位置由元件自身 layout 决定（可在检查器微调）；不再自动重排，避免打乱手工图。'));
    gridSection.appendChild(
      div('help', '电路模式新建连线默认正交路由；拖动/新建节点吸附到网格；按住 Alt 临时暂停吸附。整理会按当前网格对齐全部节点与手动拐点（可撤销）。'),
    );
    pane.appendChild(gridSection);
    updateProjectPanel();

    const dataSection = section('场景数据', 'JSON');
    const fileRow = div('file-row');
    fileRow.appendChild(button('导出 JSON', 'btn', () => void exportScene()));
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

    updateModeUI();
    updateScenePanelValues();
  }

  function setStat(key, value) {
    const node = $(`[data-stat="${key}"]`, ui.scenePane);
    if (node) node.textContent = value;
  }

  function updateScenePanelValues() {
    const pane = ui.scenePane;
    if (!pane || !pane.dataset.ready) return;
    const sim = state.sim;
    const config = sim?.config;
    if (config) {
      const setValue = (name, value) => {
        const input = $(`[data-sim="${name}"]`, pane);
        if (!input) return;
        if (document.activeElement === input) return;
        input.value = String(value);
      };
      setValue('fps', config.fps);
      setValue('steps', config.steps_per_frame);
      setValue('dt', config.dt);
      setValue('sample', config.sample_every);
      for (const key of ['reltol', 'vntol', 'abstol', 'max_iter', 'gmin_steps', 'src_steps', 'residual_tol']) {
        if (config[key] !== undefined) setValue(key, config[key]);
      }
      const lock = $('[data-sim="lock"]', pane);
      if (lock) lock.checked = Boolean(config.lock_dt);
      const realtime = $('[data-sim="realtime"]', pane);
      if (realtime) realtime.checked = Boolean(config.realtime);
      const dtInput = $('[data-sim="dt"]', pane);
      if (dtInput) dtInput.disabled = Boolean(config.lock_dt);

      const note = $('[data-role="sim-note"]', pane);
      if (note) {
        const perFrame = Number(config.dt) * Number(config.steps_per_frame);
        const perSecond = perFrame * Number(config.fps);
        let text = `每帧 ${fmt(perFrame, 4)} s · 每秒推进 ${fmt(perSecond, 4)} s`;
        if (config.realtime) {
          text += perSecond > 1.0001 ? ` · 加速 ${perSecond.toFixed(2)}×` : ' · 实时';
        } else {
          text += ' · 极速模式（不等待墙钟）';
        }
        text += config.lock_dt ? ' · dt 已锁定（每帧固定 1/fps，曲线采样也受此限制）' : '';
        note.textContent = text;
      }
    }

    const scene = state.scene;
    const stats = sim?.scene || {};
    setStat('nodes', String(scene?.nodes?.length ?? 0));
    setStat('edges', String(scene?.edges?.length ?? 0));
    const stepMs = Number(scene?.stats?.step_ms ?? stats.step_ms ?? 0);
    const stepEl = $('[data-stat="step"]', pane);
    if (stepEl) {
      stepEl.replaceChildren(
        document.createTextNode(fmt(stepMs, 3)),
        el('small', null, 'ms'),
      );
    }
    setStat('fps', String(Math.round(sim?.actual_fps ?? 0)));
    setStat('matrix', stats.kind === 'circuit' ? `${stats.matrix_size || 0}×${stats.matrix_size || 0}` : '—');
    setStat('iterations', stats.iterations !== undefined ? String(stats.iterations) : '—');
    setStat('frames', String(sim?.frames_recorded ?? state.frames.length));
    setStat('revision', String(scene?.revision ?? 0));

    const integration = $('[data-role="integration"]', pane);
    if (integration && scene) {
      integration.value = scene.integration || 'trapezoidal';
      integration.disabled = state.mode !== 'circuit';
    }
    const note = $('[data-role="integration-note"]', pane);
    if (note) {
      note.textContent = state.mode === 'circuit'
        ? '梯形法精度高；后向欧拉更稳定，适合刚性电路。'
        : '仅电路模式使用；信号流由每条连接的离散化参数决定。';
    }
    const modeHost = $('[data-role="mode"]', pane);
    if (modeHost) {
      $$('button[data-mode]', modeHost).forEach((item) => {
        item.classList.toggle('active', item.dataset.mode === state.mode);
      });
    }
  }

  function readSimConfig() {
    const pane = ui.scenePane;
    const fpsInput = $('[data-sim="fps"]', pane);
    const stepsInput = $('[data-sim="steps"]', pane);
    const dtInput = $('[data-sim="dt"]', pane);
    const sampleInput = $('[data-sim="sample"]', pane);
    const lockInput = $('[data-sim="lock"]', pane);
    const realtimeInput = $('[data-sim="realtime"]', pane);
    if (!fpsInput || !stepsInput || !dtInput || !sampleInput) return null;

    const fps = Number(fpsInput.value);
    const steps = Number(stepsInput.value);
    const sample = Number(sampleInput.value);
    const lock = Boolean(lockInput?.checked);
    let dt = Number(dtInput.value);
    if (!Number.isInteger(fps) || fps < 1 || fps > 240) throw new Error('帧率必须是 1–240 的整数');
    if (!Number.isInteger(steps) || steps < 1 || steps > 200) throw new Error('每帧步数必须是 1–200 的整数');
    if (!Number.isInteger(sample) || sample < 1 || sample > 100) throw new Error('采样间隔必须是 1–100 的整数');
    if (lock) dt = 1 / (fps * steps);
    if (!Number.isFinite(dt) || dt < 1e-9 || dt > 10) throw new Error('dt 必须在 1e-9 到 10 s 之间');
    if (dt * steps > 10) throw new Error('每帧推进的仿真时间过大，请减小 dt 或步数');
    const readSolver = (name, label, lo, hi, integer = false) => {
      const input = $(`[data-solver="${name}"]`, pane);
      if (!input) return undefined;
      const value = Number(input.value);
      if (!Number.isFinite(value) || value < lo || value > hi) {
        throw new Error(`${label}必须在 ${lo}–${hi} 之间`);
      }
      if (integer && !Number.isInteger(value)) throw new Error(`${label}必须是整数`);
      return value;
    };
    const payload = {
      fps,
      steps_per_frame: steps,
      dt,
      sample_every: sample,
      lock_dt: lock,
      realtime: Boolean(realtimeInput?.checked),
    };
    const solverFields = [
      ['reltol', '相对容差 reltol', 1e-15, 0.1, false],
      ['vntol', '电压容差 vntol', 1e-15, 1, false],
      ['abstol', '电流容差 abstol', 1e-15, 1, false],
      ['max_iter', 'Newton 迭代上限', 1, 500, true],
      ['gmin_steps', 'gmin 步数', 0, 100, true],
      ['src_steps', 'source 步数', 0, 100, true],
      ['residual_tol', '残差容差', 0, 1, false],
    ];
    for (const [key, label, lo, hi, integer] of solverFields) {
      const value = readSolver(key, label, lo, hi, integer);
      if (value !== undefined) payload[key] = value;
    }
    return payload;
  }

  async function applySimConfig() {
    let payload;
    try {
      payload = readSimConfig();
    } catch (error) {
      toast(error.message, 'error', 6000);
      updateScenePanelValues();
      return;
    }
    if (!payload) return;
    const response = await task(() => jsonRequest('/api/config', 'PATCH', payload));
    if (!response) {
      updateScenePanelValues();
      return;
    }
    state.sim = response.sim;
    syncUI();
    updateScenePanelValues();
    updateRunButton(Boolean(state.sim?.running));
    const solverKeys = ['reltol', 'vntol', 'abstol', 'max_iter', 'gmin_steps', 'src_steps', 'residual_tol'];
    toast('仿真设置已更新', 'ok', 1600);
  }

  async function changeIntegration(value) {
    if (state.mode !== 'circuit') {
      toast('积分方法只用于电路模式', 'info', 1800);
      updateScenePanelValues();
      return;
    }
    const response = await task(() => jsonRequest('/api/scene', 'PATCH', { integration: value }));
    if (!response) {
      updateScenePanelValues();
      return;
    }
    applySnapshot(response);
    renderScenePanel();
    toast(`积分方法已切换为 ${value === 'trapezoidal' ? '梯形法' : '后向欧拉'}`, 'ok', 2000);
  }

  async function switchMode(mode, options = {}) {
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
    const response = await task(() => jsonRequest('/api/mode', 'POST', { mode }));
    if (!response) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    state.frames = [];
    state.values.clear();
    state.nodeValues.clear();
    state.edgeValues.clear();
    applySnapshot(response);
    state.cursor = Number(response.sim?.cursor) || 0;
    renderInspector();
    renderScenePanel();
    renderSignalList();
    fitView();
    toast(`已切换到${modeLabel(mode)}模式`, 'ok', 2200);
  }

  async function loadTemplate(name, label) {
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
    const response = await task(() => jsonRequest(`/api/templates/${encodeURIComponent(name)}`, 'POST'));
    if (!response) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    applySnapshot(response);
    state.cursor = Number(response.sim?.cursor) || 0;
    renderInspector();
    renderScenePanel();
    renderSignalList();
    fitView();
    toast(`已载入模板：${label}`, 'ok', 2200);
  }

  async function migrateSceneToDevices() {
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
    const response = await task(() => jsonRequest('/api/scene/migrate-devices', 'POST', {}));
    if (!response) return;
    applySnapshot(response);
    const converted = Number(response.migration?.converted || 0);
    toast(`已迁移 ${converted} 个元件为器件节点`, 'ok', 3000);
    fitView(true);
  }

  async function clearScene() {
    const confirmed = await confirmModal(
      '清空当前场景？',
      '将删除所有节点与连接，并重建为空白模板。该操作不可撤销。',
      '清空',
      true,
    );
    if (!confirmed) return;
    const response = await task(() => jsonRequest('/api/scene/clear', 'POST'));
    if (!response) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    applySnapshot(response);
    state.cursor = Number(response.sim?.cursor) || 0;
    renderInspector();
    renderScenePanel();
    renderSignalList();
    fitView();
    toast('场景已清空', 'ok', 2000);
  }

  async function exportScene() {
    const payload = await task(() => api('/api/scene/export?include_state=false'), { dirty: false });
    if (!payload) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = `netlab-${state.mode}-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('场景已导出', 'ok', 1800);
  }

  async function importSceneFile(file) {
    if (file.size > MAX_IMPORT_BYTES) {
      toast('场景文件超过 2 MB，已拒绝', 'error', 6000);
      return;
    }
    let payload;
    try {
      const text = await file.text();
      payload = JSON.parse(text);
    } catch (error) {
      toast(`JSON 解析失败：${error.message}`, 'error', 6000);
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
    const response = await task(() => jsonRequest('/api/scene', 'POST', payload));
    if (!response) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    state.frames = [];
    state.values.clear();
    state.nodeValues.clear();
    state.edgeValues.clear();
    applySnapshot(response);
    state.cursor = Number(response.sim?.cursor) || 0;
    renderInspector();
    renderScenePanel();
    renderSignalList();
    fitView();
    toast('场景已导入', 'ok', 2200);
  }

  /* ======================================================================
   * 8.5 工程文件（.netlab）：保存 / 打开 / 自动保存 / 恢复
   * ==================================================================== */

  const AUTOSAVE_KEY = 'netlab.autosave.v1';
  const AUTOSAVE_ENABLED_KEY = 'netlab.autosave.enabled';
  const RECENT_KEY = 'netlab.recent.v1';

  function markProjectDirty() {
    if (!state.booted && !state.scene) return;
    if (!state.project.dirty) {
      state.project.dirty = true;
      const bridge = desktopBridge();
      if (bridge && typeof bridge.setDirty === 'function') {
        try {
          bridge.setDirty(true);
        } catch (error) {
          /* 桥不可用时只影响窗口标题提示 */
        }
      }
    }
    updateProjectPanel();
  }

  function projectSaved() {
    state.project.dirty = false;
    state.project.autosavedAt = 0;
    const bridge = desktopBridge();
    if (bridge && typeof bridge.setDirty === 'function') {
      try {
        bridge.setDirty(false);
      } catch (error) {
        /* 忽略 */
      }
      void callBridge('clearAutosave', []);
    } else {
      try {
        localStorage.removeItem(AUTOSAVE_KEY);
      } catch (error) {
        /* 忽略 */
      }
    }
    updateProjectPanel();
  }

  function rememberRecent(path, name) {
    if (!path) return;
    const entry = { path, name: name || baseName(path), at: Date.now() };
    state.project.recent = [entry]
      .concat(state.project.recent.filter((item) => item.path !== path))
      .slice(0, 6);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(state.project.recent));
    } catch (error) {
      /* 忽略 */
    }
  }

  function loadRecent() {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      const items = raw ? JSON.parse(raw) : [];
      state.project.recent = Array.isArray(items)
        ? items.filter((item) => item && typeof item.path === 'string').slice(0, 6)
        : [];
    } catch (error) {
      state.project.recent = [];
    }
  }

  function updateProjectPanel() {
    const pane = ui.scenePane;
    if (!pane) return;
    const pathNode = pane.querySelector('[data-role="project-path"]');
    if (pathNode) {
      const parts = [];
      if (state.project.path) {
        parts.push(baseName(state.project.path));
      } else {
        parts.push(isDesktop() ? '尚未保存到文件' : '浏览器模式：保存为下载文件');
      }
      parts.push(state.project.dirty ? '● 有未保存修改' : '已保存');
      if (state.project.autosavedAt) {
        const at = new Date(state.project.autosavedAt);
        parts.push(`自动保存 ${at.toLocaleTimeString('zh-CN', { hour12: false })}`);
      }
      pathNode.textContent = parts.join(' · ');
      pathNode.title = state.project.path || '';
      pathNode.classList.toggle('dirty', state.project.dirty);
    }
    const nameInput = pane.querySelector('[data-role="project-name"]');
    if (nameInput && document.activeElement !== nameInput) {
      nameInput.value = state.project.name || '';
    }
    const autosaveInput = pane.querySelector('[data-role="project-autosave"]');
    if (autosaveInput) autosaveInput.checked = Boolean(state.project.autosave);
    const recentBox = pane.querySelector('[data-role="project-recent"]');
    if (recentBox) {
      recentBox.replaceChildren();
      recentBox.appendChild(el('span', null, '最近工程'));
      if (!state.project.recent.length) {
        recentBox.appendChild(div('help', '（暂无）'));
        return;
      }
      for (const item of state.project.recent) {
        const chip = button(item.name || baseName(item.path), 'chip', () => {
          if (isDesktop()) void openProjectPath(item.path);
          else toast('浏览器模式无法直接打开本地路径，请使用「打开工程」选择文件', 'info', 4000);
        });
        chip.title = item.path;
        recentBox.appendChild(chip);
      }
    }
  }

  async function buildProjectPayload() {
    const response = await api('/api/project/export', {
      method: 'POST',
      body: JSON.stringify({
        name: state.project.name || null,
        ui: {
          view: state.view,
          tab: activeTab(),
          workspace: state.workspace,
          grid: {
            snap: Boolean(state.ui.snap),
            size: Number(state.ui.grid) || 20,
            show: state.ui.showGrid !== false,
            markers: state.ui.snapMarkers !== false,
            orthogonal: state.ui.circuitOrthogonal !== false,
          },
          symbol: state.ui.symbol,
          nodeStyle: state.ui.nodeStyle || 'circle',
          drawingMode: Boolean(state.ui.drawingMode),
          symbolScale: Number(state.ui.symbolScale) || 1.2,
          glyphColor: state.ui.glyphColor || '#1f5f5b',
        },
      }),
    });
    return response && response.project ? response.project : null;
  }

  function downloadText(text, filename) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function saveProject(forceDialog = false) {
    const bridge = desktopBridge();
    let project = null;
    try {
      project = await buildProjectPayload();
    } catch (error) {
      toast(`保存失败：${error.message}`, 'error', 7000);
      return false;
    }
    if (!project) return false;
    const text = JSON.stringify(project, null, 2);
    const safeName = (state.project.name || 'netlab-project').replace(/[\\/:*?"<>|]+/g, '_');
    if (!bridge) {
      downloadText(text, safeName.endsWith('.netlab') ? safeName : `${safeName}.netlab`);
      projectSaved();
      toast('工程已下载；浏览器模式请妥善保存该文件', 'ok', 3600);
      return true;
    }
    let path = '';
    if (!forceDialog && state.project.path) {
      path = await callBridge('saveProjectTo', [state.project.path, text]);
    }
    if (!path) {
      path = await callBridge('saveProject', [text, safeName]);
    }
    if (!path) return false;
    state.project.path = path;
    state.project.name = baseName(path).replace(/\.netlab$/i, '') || state.project.name;
    rememberRecent(path, state.project.name);
    projectSaved();
    toast(`已保存：${baseName(path)}`, 'ok', 2600);
    return true;
  }

  async function importProjectText(text, path = '') {
    let project = null;
    try {
      project = JSON.parse(text);
    } catch (error) {
      toast(`工程 JSON 解析失败：${error.message}`, 'error', 7000);
      return false;
    }
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
      toast('工程文件必须是 JSON 对象', 'error', 6000);
      return false;
    }
    const extensions = Array.isArray(project.extensions) ? project.extensions : [];
    let trust = false;
    if (extensions.length) {
      const body = div('trust-body');
      body.appendChild(
        el(
          'p',
          null,
          `该工程带有 ${extensions.length} 个 Python 扩展。启用后它们会在后端本进程以完整权限执行——这不是沙箱。只有确认来源可信时才继续。`,
        ),
      );
      const list = div('trust-list');
      for (const item of extensions.slice(0, 10)) {
        const row = div('trust-row');
        row.appendChild(el('b', null, String(item.kind || item.filename || '扩展')));
        row.appendChild(el('span', 'badge gray', String(item.type === 'method' ? '连接' : '节点')));
        const hash = String(item.sha256 || '').trim();
        row.appendChild(el('code', null, hash ? `sha256 ${hash.slice(0, 16)}…` : '无校验和'));
        list.appendChild(row);
      }
      if (extensions.length > 10) {
        list.appendChild(div('help', `… 另有 ${extensions.length - 10} 个未列出`));
      }
      body.appendChild(list);
      const warn = div('help trust-warn');
      warn.textContent = '选择「拒绝」后工程不会被载入；扩展代码保持不执行。';
      body.appendChild(warn);
      trust = await confirmModal('工程包含 Python 扩展', body, '信任并载入', true);
      if (!trust) {
        toast('已取消：未启用工程内扩展，工程未载入', 'info', 5000);
        return false;
      }
    }
    let response = null;
    try {
      response = await api('/api/project/import', {
        method: 'POST',
        body: JSON.stringify({ project, trust_extensions: trust }),
      });
    } catch (error) {
      toast(`工程载入失败：${error.message}`, 'error', 8000);
      showBanner(`工程载入失败：${error.message}`);
      return false;
    }
    if (!response || !response.scene) return false;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    state.inspectorDirty = false;
    state.frames = [];
    state.values.clear();
    state.nodeValues.clear();
    state.edgeValues.clear();
    applySnapshot({ scene: response.scene, sim: response.sim, limits: state.limits });
    state.cursor = Number(response.sim?.cursor || 0);
    if (response.fem && state.fem) state.fem = Object.assign({}, state.fem, response.fem);
    applyProjectUi(response.ui);
    state.project.name = String(project.name || state.project.name || '未命名工程').slice(0, 120);
    state.project.path = path || '';
    if (path) rememberRecent(path, state.project.name);
    projectSaved();
    renderScenePanel();
    renderInspector();
    renderSignalList();
    await fetchNetworks();
    fitView();
    toast(`工程已载入：${state.project.name}`, 'ok', 3000);
    const rails = response.migration?.rails || [];
    if (rails.length) {
      // R21/D42：旧比较器/运放 OUT− 已断开；接地者行为不变，非地者提示复核。
      const lines = rails.slice(0, 6).map((item) => {
        const risk = item.net_is_ground ? '地，行为不变' : '非地，请复核';
        return `· ${item.network || ''} ${item.device}：断开 OUT− → ${item.removed_net}（${risk}）`;
      });
      const more = rails.length > 6 ? `；… 共 ${rails.length} 条` : '';
      showBanner(`已自动迁移 ${rails.length} 个比较器/运放为单端输出：${lines.join('；')}${more}`);
      toast(`已迁移 ${rails.length} 个运放的旧输出端（R21）`, 'info', 6000);
    }
    return true;
  }

  async function openProject() {
    const bridge = desktopBridge();
    if (bridge) {
      const text = await callBridge('openProject', []);
      if (text) await importProjectText(text, (await callBridge('currentPath', [])) || '');
      return;
    }
    projectFileInput.click();
  }

  async function openProjectPath(path) {
    const bridge = desktopBridge();
    if (!bridge) return;
    const text = await callBridge('openProjectPath', [path]);
    if (text) await importProjectText(text, path);
  }

  async function newProject() {
    const confirmed = await confirmModal(
      '新建工程？',
      '当前场景会被空白场景替换，未保存的修改将丢失。需要保留请先保存或导出。',
      '新建',
      true,
    );
    if (!confirmed) return;
    const response = await task(() => jsonRequest('/api/scene/clear', 'POST'), { dirty: false });
    if (!response) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    state.frames = [];
    state.values.clear();
    state.nodeValues.clear();
    state.edgeValues.clear();
    applySnapshot(response);
    state.cursor = Number(response.sim?.cursor || 0);
    state.project.name = '未命名工程';
    state.project.path = '';
    projectSaved();
    renderScenePanel();
    renderInspector();
    renderSignalList();
    fitView();
    toast('已新建空白工程', 'ok', 2200);
  }

  async function recoverAutosave() {
    const bridge = desktopBridge();
    let text = '';
    if (bridge) {
      if (!(await callBridge('hasAutosave', []))) {
        toast('没有可恢复的自动保存', 'info', 2600);
        return false;
      }
      text = await callBridge('recoverAutosave', []);
    } else {
      try {
        const raw = localStorage.getItem(AUTOSAVE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        text = parsed && typeof parsed.text === 'string' ? parsed.text : '';
      } catch (error) {
        text = '';
      }
      if (!text) {
        toast('没有可恢复的自动保存', 'info', 2600);
        return false;
      }
    }
    if (!text) return false;
    const confirmed = await confirmModal(
      '恢复自动保存？',
      '自动保存来自上一次未正常退出的会话，载入会替换当前场景。',
      '恢复',
      false,
    );
    if (!confirmed) return false;
    return importProjectText(text, state.project.path || '');
  }

  async function autosaveProject() {
    if (!state.project.autosave || !state.project.dirty || !state.booted) return;
    try {
      // R16/D16：工程已有落盘路径时，自动保存只写工程 backups/ 快照，绝不覆盖正本。
      if (state.project.path) {
        const response = await jsonRequest('/api/workspace/snapshot', 'POST', {
          path: state.project.path,
          name: state.project.name,
        });
        if (response && response.saved) {
          state.project.autosavedAt = Date.now();
          updateProjectPanel();
        }
        return;
      }
      const project = await buildProjectPayload();
      if (!project) return;
      const text = JSON.stringify(project);
      const bridge = desktopBridge();
      if (bridge) {
        const path = await callBridge('autosave', [text]);
        if (path) state.project.autosavedAt = Date.now();
      } else {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ at: Date.now(), text }));
        state.project.autosavedAt = Date.now();
      }
      updateProjectPanel();
    } catch (error) {
      // 自动保存失败不打断使用；只在控制台留下痕迹，状态栏不刷屏。
      console.warn('autosave failed', error);
    }
  }

  async function maybeOfferRecovery() {
    const bridge = desktopBridge();
    let available = false;
    try {
      if (bridge) {
        available = Boolean(await callBridge('hasAutosave', []));
      } else {
        available = Boolean(localStorage.getItem(AUTOSAVE_KEY));
      }
    } catch (error) {
      available = false;
    }
    if (!available) return;
    const confirmed = await confirmModal(
      '发现自动保存的工程',
      '上次会话可能未正常退出。是否载入自动保存的工程？选择取消则保留当前场景。',
      '载入自动保存',
      false,
    );
    if (confirmed) await recoverAutosave();
  }

  function initProject() {
    loadRecent();
    try {
      const flag = localStorage.getItem(AUTOSAVE_ENABLED_KEY);
      if (flag === '0') state.project.autosave = false;
    } catch (error) {
      /* 忽略 */
    }
    window.addEventListener('netlab-desktop-ready', () => {
      state.project.desktop = true;
      updateProjectPanel();
    });
    window.addEventListener('beforeunload', (event) => {
      if (!state.project.dirty || isDesktop()) return;
      event.preventDefault();
      event.returnValue = '工程有未保存的修改。';
      return event.returnValue;
    });
    window.netlabDesktopCommand = (name, payload) => {
      const command = String(name || '');
      if (command === 'new') void newProject();
      else if (command === 'open') void openProject();
      else if (command === 'open-path') void openProjectPath(String(payload || ''));
      else if (command === 'save') void saveProject(false);
      else if (command === 'saveAs') void saveProject(true);
      else if (command === 'recover') void recoverAutosave();
      else if (command === 'fit') fitView(true);
      else if (command === 'help') showHelp();
      else toast(`未知桌面命令：${command}`, 'info', 2600);
    };
    // 自动保存间隔来自用户设置（默认 60 s）；设置读取失败时用默认值。
    jsonRequest('/api/settings', 'GET')
      .then((response) => {
        const settings = (response && response.settings) || {};
        if (typeof settings.autosave_enabled === 'boolean') {
          state.project.autosave = settings.autosave_enabled;
        }
        const seconds = Number(settings.autosave_interval_seconds);
        if (Number.isFinite(seconds) && seconds >= 5) {
          state.project.autosaveInterval = seconds * 1000;
        }
        updateProjectPanel();
      })
      .catch(() => {});
    setInterval(() => void autosaveProject(), state.project.autosaveInterval);
    if (isDesktop()) state.project.desktop = true;
  }


  /* ======================================================================
   * 9. 信号图与实时轮询
   * ==================================================================== */

  function decodeProbeKey(key) {
    if (key.startsWith('n:')) {
      const rest = key.slice(2);
      const cut = rest.lastIndexOf(':');
      return {
        group: '节点',
        label: cut > 0 ? `${rest.slice(0, cut)} · ${rest.slice(cut + 1)}` : rest,
        target: '节点',
      };
    }
    if (key.startsWith('e:')) {
      const rest = key.slice(2);
      const cut = rest.lastIndexOf(':');
      return {
        group: '连接',
        label: cut > 0 ? `${rest.slice(0, cut)} · ${rest.slice(cut + 1)}` : rest,
        target: '连接',
      };
    }
    return { group: '信号', label: key };
  }

  function renderSignalList() {
    if (!ui.signalList) return;
    ui.signalList.replaceChildren();
    if (!state.probeKeys.length) {
      ui.signalList.appendChild(div('help', '运行仿真后自动列出可绘制信号。'));
      renderLegend();
      return;
    }
    const filter = state.chart.filter.trim().toLowerCase();
    const keys = state.probeKeys.filter((key) => key.toLowerCase().includes(filter));
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
        dot.style.background = colorForKey(key);
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
          scheduleChartDraw();
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

  function updateSignalListValues() {
    for (const node of $$('[data-signal-value]', ui.signalList)) {
      const key = node.dataset.signalValue;
      node.textContent = state.values.has(key) ? fmt(state.values.get(key), 3) : '—';
    }
  }

  function renderLegend() {
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
      dot.style.background = colorForKey(key);
      const name = el('span', 'legend-name', decodeProbeKey(key).label);
      name.title = key;
      const value = el('span', 'legend-value', state.values.has(key) ? fmt(state.values.get(key), 4) : '—');
      value.dataset.legendValue = key;
      item.append(dot, name, value);
      ui.legend.appendChild(item);
    }
  }

  function updateLegendValues() {
    for (const node of $$('[data-legend-value]', ui.legend)) {
      const key = node.dataset.legendValue;
      node.textContent = state.values.has(key) ? fmt(state.values.get(key), 4) : '—';
    }
  }

  function nearestFrame(time) {
    const frames = state.frames;
    if (!frames.length) return null;
    let low = 0;
    let high = frames.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (frames[mid].t < time) low = mid + 1;
      else high = mid;
    }
    const after = frames[low];
    const before = frames[Math.max(0, low - 1)];
    return Math.abs(before.t - time) <= Math.abs(after.t - time) ? before : after;
  }

  /* ---- 回放（R23/D48）：只读录制帧，不改电路状态 ---------------------- */
  function recordingStale() {
    const revision = state.scene?.revision;
    return Boolean(
      state.frames.length
      && state.replay.recordingRevision !== null
      && revision !== undefined
      && revision !== state.replay.recordingRevision,
    );
  }

  function stopReplayTimer() {
    if (state.replay.timer) {
      clearInterval(state.replay.timer);
      state.replay.timer = 0;
    }
    state.replay.playing = false;
    state.replay.lastTick = 0;
    state.replay.carry = 0;
  }

  function updateReplayUI() {
    const max = Math.max(0, state.frames.length - 1);
    if (!state.replay.active) state.replay.index = max;
    state.replay.index = clamp(state.replay.index, 0, max);
    const frame = state.frames[state.replay.index];
    if (ui.chartTimeline) {
      ui.chartTimeline.max = String(max);
      ui.chartTimeline.value = String(state.replay.index);
      ui.chartTimeline.disabled = !state.frames.length;
    }
    if (ui.chartReplayTime) {
      ui.chartReplayTime.textContent = frame ? `t ${frame.t.toFixed(3)} s` : '—';
    }
    if (ui.topTimeline) {
      ui.topTimeline.max = String(max);
      ui.topTimeline.value = String(state.replay.index);
      ui.topTimeline.disabled = !state.frames.length;
    }
    if (ui.topTimelineTime) {
      const total = state.frames.length
        ? Number(state.frames[state.frames.length - 1].t || 0)
        : 0;
      ui.topTimelineTime.textContent = frame
        ? `t ${frame.t.toFixed(3)} / ${total.toFixed(3)} s`
        : '—';
    }
    if (ui.btnReplay) {
      ui.btnReplay.textContent = state.replay.playing ? '⏸ 暂停' : '▶ 回放';
      ui.btnReplay.disabled = !state.frames.length;
    }
    if (ui.replaySpeed) {
      ui.replaySpeed.value = String(state.replay.speed);
      ui.replaySpeed.disabled = !state.frames.length;
    }
    if (ui.replaySpeedVal) {
      ui.replaySpeedVal.textContent = `${Math.round(state.replay.speed)}/s`;
    }
    if (ui.btnLive) ui.btnLive.disabled = !state.replay.active;
    if (ui.btnResolve) ui.btnResolve.disabled = !recordingStale();
    if (ui.chartLoop) ui.chartLoop.checked = Boolean(state.chart.loop);
    const status = ui.chartStatus;
    if (!status) return;
    status.classList.remove('stale', 'replay');
    if (recordingStale()) {
      status.textContent = '记录已过期 · 场景已修改，请重新求解';
      status.classList.add('stale');
    } else if (state.replay.active) {
      status.textContent = `回放中 · ${state.replay.index + 1}/${state.frames.length}`;
      status.classList.add('replay');
    } else {
      status.textContent = '';
    }
  }

  function enterReplay(index = state.replay.index) {
    if (!state.frames.length) return;
    state.replay.active = true;
    state.replay.index = clamp(Number(index) || 0, 0, state.frames.length - 1);
    stopReplayTimer();
    updateReplayUI();
    scheduleChartDraw();
  }

  function leaveReplay() {
    state.replay.active = false;
    state.replay.index = Math.max(0, state.frames.length - 1);
    stopReplayTimer();
    updateReplayUI();
    scheduleChartDraw();
  }

  // 回放定时器固定 16 ms 一跳；速度只影响每次推进的帧数。
  const REPLAY_TICK_MS = 16;

  function toggleReplayPlayback() {
    if (!state.frames.length) {
      toast('还没有可回放的录制帧', 'info', 2200);
      return;
    }    if (state.replay.playing) {
      stopReplayTimer();
      updateReplayUI();
      return;
    }
    if (!state.replay.active) {
      state.replay.active = true;
      state.replay.index = 0;
    }
    if (state.replay.index >= state.frames.length - 1) state.replay.index = 0;
    state.replay.playing = true;
    state.replay.lastTick = performance.now();
    state.replay.carry = 0;
    state.replay.timer = setInterval(replayTick, REPLAY_TICK_MS);
    updateReplayUI();
  }

  // 按真实时间累积“要播放的帧数”，速度用 帧/秒 表示；
  // 这样调速度只改推进量，不改定时器频率，快放不会把主线程刷爆。
  function replayTick() {
    const now = performance.now();
    const elapsed = Math.min(400, Math.max(0, now - (state.replay.lastTick || now)));
    state.replay.lastTick = now;
    if (!state.frames.length) {
      stopReplayTimer();
      updateReplayUI();
      scheduleChartDraw();
      return;
    }
    const speed = clamp(Number(state.replay.speed) || 60, 5, 240);
    state.replay.carry = (state.replay.carry || 0) + (elapsed * speed) / 1000;
    const advance = Math.floor(state.replay.carry);
    if (advance <= 0) return;
    state.replay.carry -= advance;
    const max = state.frames.length - 1;
    let next = state.replay.index + advance;
    if (next > max) {
      if (!state.chart.loop) {
        state.replay.index = max;
        stopReplayTimer();
        updateReplayUI();
        scheduleChartDraw();
        return;
      }
      next = max > 0 ? next % (max + 1) : 0;
    }
    state.replay.index = next;
    updateReplayUI();
    scheduleChartDraw();
  }

  /* ---- 相图 ------------------------------------------------------------ */
  function vectorCandidates() {
    const nodes = state.scene?.nodes || [];
    return nodes.filter((node) => {
      const data = nodeDisplayData(node);
      const hasX = typeof data.x === 'number' && typeof data.y === 'number';
      const hasV = typeof data.vx === 'number' && typeof data.vy === 'number';
      const hasState = typeof data.x1 === 'number' && typeof data.x2 === 'number';
      return hasX || hasV || hasState;
    });
  }

  function renderVectorNodeList() {
    if (!ui.vectorNode) return;
    const nodes = vectorCandidates();
    const previous = state.phaseNode;
    ui.vectorNode.replaceChildren();
    if (!nodes.length) {
      const option = el('option', null, '（无矢量节点）');
      option.value = '';
      ui.vectorNode.appendChild(option);
      state.phaseNode = '';
      drawPhase();
      return;
    }
    for (const node of nodes) {
      const option = el('option', null, `${node.name} · ${node.kind}`);
      option.value = node.name;
      ui.vectorNode.appendChild(option);
    }
    if (!nodes.some((node) => node.name === previous)) {
      state.phaseNode = nodes[0].name;
    }
    ui.vectorNode.value = state.phaseNode;
    drawPhase();
  }

  function resizePhase() {
    const wrap = $('.phase-wrap');
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    state.phaseSize = { w: width, h: height, dpr };
    phaseCanvas.width = Math.max(1, Math.round(width * dpr));
    phaseCanvas.height = Math.max(1, Math.round(height * dpr));
    schedulePhaseDraw();
  }

  function schedulePhaseDraw() {
    if (state.phaseTimer) return;
    state.phaseTimer = setTimeout(() => {
      state.phaseTimer = 0;
      if (activeTab() === 'vector') drawPhase();
    }, 80);
  }

  function drawPhase() {
    if (activeTab() !== 'vector') return;
    const { w, h, dpr } = state.phaseSize;
    if (w < 20 || h < 20) return;
    phaseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    phaseCtx.clearRect(0, 0, w, h);
    phaseCtx.fillStyle = C('#faf8f2');
    phaseCtx.fillRect(0, 0, w, h);

    const node = nodeByName(state.phaseNode);
    if (!node) {
      phaseCtx.fillStyle = C('#969083');
      phaseCtx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
      phaseCtx.textAlign = 'center';
      phaseCtx.textBaseline = 'middle';
      phaseCtx.fillText('没有可绘制的二维矢量节点', w / 2, h / 2);
      ui.phaseReadout.textContent = '在矢量模式下添加「非线性动态源」后即可查看相图。';
      return;
    }

    const trail = clamp(Number(state.phaseTrail) || 360, 20, 1200);
    const frames = state.frames.slice(-trail);
    const keyX = `n:${node.name}:x`;
    const keyY = `n:${node.name}:y`;
    const keyVX = `n:${node.name}:vx`;
    const keyVY = `n:${node.name}:vy`;
    const keyX1 = `n:${node.name}:x1`;
    const keyX2 = `n:${node.name}:x2`;
    let fieldX = keyX;
    let fieldY = keyY;
    let labelX = 'x';
    let labelY = 'y';
    let points = frames
      .filter((frame) => typeof frame.v[keyX] === 'number' && typeof frame.v[keyY] === 'number')
      .map((frame) => ({ x: frame.v[keyX], y: frame.v[keyY], t: frame.t }));
    if (points.length < 2) {
      fieldX = keyVX;
      fieldY = keyVY;
      labelX = 'vx';
      labelY = 'vy';
      points = frames
        .filter((frame) => typeof frame.v[keyVX] === 'number' && typeof frame.v[keyVY] === 'number')
        .map((frame) => ({ x: frame.v[keyVX], y: frame.v[keyVY], t: frame.t }));
    }
    if (points.length < 2) {
      fieldX = keyX1;
      fieldY = keyX2;
      labelX = 'x1';
      labelY = 'x2';
      points = frames
        .filter((frame) => typeof frame.v[keyX1] === 'number' && typeof frame.v[keyX2] === 'number')
        .map((frame) => ({ x: frame.v[keyX1], y: frame.v[keyX2], t: frame.t }));
    }
    if (!points.length) {
      const data = nodeDisplayData(node);
      if (typeof data.x === 'number' && typeof data.y === 'number') {
        points = [{ x: data.x, y: data.y, t: state.sim?.time || 0 }];
        fieldX = 'x';
        fieldY = 'y';
      } else if (typeof data.vx === 'number' && typeof data.vy === 'number') {
        points = [{ x: data.vx, y: data.vy, t: state.sim?.time || 0 }];
        fieldX = 'vx';
        fieldY = 'vy';
        labelX = 'vx';
        labelY = 'vy';
      } else if (typeof data.x1 === 'number' && typeof data.x2 === 'number') {
        points = [{ x: data.x1, y: data.x2, t: state.sim?.time || 0 }];
        fieldX = 'x1';
        fieldY = 'x2';
        labelX = 'x1';
        labelY = 'x2';
      }
    }

    const margin = 34;
    const plotW = Math.max(10, w - margin * 2);
    const plotH = Math.max(10, h - margin * 2 - 14);
    const ox = margin;
    const oy = 20;
    const size = Math.min(plotW, plotH);
    const px = ox + (plotW - size) / 2;
    const py = oy + (plotH - size) / 2;

    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    let spanX = maxX - minX;
    let spanY = maxY - minY;
    const span = Math.max(spanX, spanY, 1.0e-3);
    const pad = span * 0.12;
    minX -= pad; maxX += pad; minY -= pad; maxY += pad;
    spanX = maxX - minX;
    spanY = maxY - minY;
    const scale = size / Math.max(spanX, spanY, 1.0e-3);
    const mapX = (value) => px + size / 2 + (value - (minX + maxX) / 2) * scale;
    const mapY = (value) => py + size / 2 - (value - (minY + maxY) / 2) * scale;

    // 网格
    phaseCtx.strokeStyle = C('#e3ddd0');
    phaseCtx.lineWidth = 1;
    phaseCtx.beginPath();
    for (let index = 0; index <= 6; index += 1) {
      const gx = px + (size * index) / 6;
      const gy = py + (size * index) / 6;
      phaseCtx.moveTo(gx, py);
      phaseCtx.lineTo(gx, py + size);
      phaseCtx.moveTo(px, gy);
      phaseCtx.lineTo(px + size, gy);
    }
    phaseCtx.stroke();

    // 坐标轴
    phaseCtx.strokeStyle = C('#bcb3a1');
    phaseCtx.lineWidth = 1;
    phaseCtx.beginPath();
    const axisY = clamp(mapY(0), py, py + size);
    const axisX = clamp(mapX(0), px, px + size);
    phaseCtx.moveTo(px, axisY);
    phaseCtx.lineTo(px + size, axisY);
    phaseCtx.moveTo(axisX, py);
    phaseCtx.lineTo(axisX, py + size);
    phaseCtx.stroke();

    // 轨迹
    if (points.length > 1) {
      phaseCtx.strokeStyle = C('rgba(168, 84, 31, 0.78)');
      phaseCtx.lineWidth = 1.4;
      phaseCtx.lineJoin = 'round';
      phaseCtx.beginPath();
      points.forEach((point, index) => {
        const sx = mapX(point.x);
        const sy = mapY(point.y);
        if (index === 0) phaseCtx.moveTo(sx, sy);
        else phaseCtx.lineTo(sx, sy);
      });
      phaseCtx.stroke();

      const previous = points[Math.max(0, points.length - 18)];
      const current = points[points.length - 1];
      const angle = Math.atan2(mapY(current.y) - mapY(previous.y), mapX(current.x) - mapX(previous.x));
      const tipX = mapX(current.x);
      const tipY = mapY(current.y);
      phaseCtx.fillStyle = C('#1f5f5b');
      phaseCtx.beginPath();
      phaseCtx.arc(tipX, tipY, 3.2, 0, Math.PI * 2);
      phaseCtx.fill();
      phaseCtx.beginPath();
      phaseCtx.moveTo(tipX, tipY);
      phaseCtx.lineTo(tipX - 11 * Math.cos(angle - 0.42), tipY - 11 * Math.sin(angle - 0.42));
      phaseCtx.lineTo(tipX - 11 * Math.cos(angle + 0.42), tipY - 11 * Math.sin(angle + 0.42));
      phaseCtx.closePath();
      phaseCtx.fill();
    }

    phaseCtx.fillStyle = C('#7b7266');
    phaseCtx.font = '9px "Cascadia Code", Consolas, monospace';
    phaseCtx.textAlign = 'left';
    phaseCtx.textBaseline = 'top';
    phaseCtx.fillText(`${labelX} / ${labelY} · ${node.name}`, px, 3);
    phaseCtx.textAlign = 'right';
    phaseCtx.fillText(`${points.length} pts`, px + size, 3);
    phaseCtx.textAlign = 'left';
    phaseCtx.textBaseline = 'bottom';
    phaseCtx.fillText(fmt(minX, 2), px, py + size + 12);
    phaseCtx.textAlign = 'right';
    phaseCtx.fillText(fmt(maxX, 2), px + size, py + size + 12);
    phaseCtx.textAlign = 'right';
    phaseCtx.textBaseline = 'bottom';
    phaseCtx.fillText(fmt(maxY, 2), px - 5, py + 9);
    phaseCtx.textBaseline = 'top';
    phaseCtx.fillText(fmt(minY, 2), px - 5, py + size - 9);

    const current = points[points.length - 1];
    if (current) {
      const magnitude = Math.hypot(current.x, current.y);
      ui.phaseReadout.textContent =
        `${node.kind}  ${labelX}=${fmt(current.x, 5)}  ${labelY}=${fmt(current.y, 5)}  `
        + `|r|=${fmt(magnitude, 5)}  t=${fmt(current.t, 4)} s`;
    }
  }

  // ---------------- 仪器面板（R23 / D47，P7-04） ----------------
  // 全部只读 state.frames：仪表/示波器/李萨如都是旁路观察，绝不写回电路状态。
  function instrumentPrefsKey() {
    return 'netlab.instrument';
  }

  function loadInstrumentPrefs() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(instrumentPrefsKey()) || 'null');
    } catch {
      data = null;
    }
    if (!data || typeof data !== 'object') return;
    if (typeof data.meterKey === 'string') state.instrument.meterKey = data.meterKey;
    if (Array.isArray(data.channels)) {
      state.instrument.channels = [0, 1, 2, 3].map((i) => (
        typeof data.channels[i] === 'string' ? data.channels[i] : null
      ));
    }
    if (typeof data.lx === 'string') state.instrument.lx = data.lx;
    if (typeof data.ly === 'string') state.instrument.ly = data.ly;
    if (Number.isFinite(data.trail)) state.instrument.trail = clamp(Math.round(data.trail), 20, 4000);
    if (Number.isFinite(data.window)) state.instrument.window = clamp(data.window, 0.1, 120);
  }

  function saveInstrumentPrefs() {
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

  function instrumentFieldLabel(field) {
    const map = { voltage: '电压', current: '电流', power: '功率', voltage_difference: '压差' };
    return map[field] || field || '值';
  }

  function instrumentKeyLabel(key) {
    const parts = String(key || '').split(':');
    const field = parts.length > 1 ? parts[parts.length - 1] : '';
    const name = parts.length > 2 ? parts.slice(1, -1).join(':') : (parts[1] || key);
    return `${name} · ${instrumentFieldLabel(field)}`;
  }

  function instrumentSelectGroups() {
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

  function fillInstrumentSelect(select, current, placeholder) {
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

  function fillInstrumentSelects() {
    if (!ui.instPane) return;
    const firstRun = !state.instrument.meterKey
      && !state.instrument.lx && !state.instrument.ly
      && state.instrument.channels.every((key) => !key);
    state.instrument.meterKey = fillInstrumentSelect(ui.instMeterKey, state.instrument.meterKey, '选择电压 / 电流信号');
    state.instrument.channels = [0, 1, 2, 3].map((i) => (
      fillInstrumentSelect(ui.instCh[i], state.instrument.channels[i], `CH${i + 1} 未接`) || null
    ));
    state.instrument.lx = fillInstrumentSelect(ui.instLX, state.instrument.lx, 'X 未接');
    state.instrument.ly = fillInstrumentSelect(ui.instLY, state.instrument.ly, 'Y 未接');
    if (firstRun && state.probeKeys.length) {
      // 首次打开仪器页时自动接上「第一个电压 + 第一个电流」，避免空白页
      const volts = state.probeKeys.filter((key) => key.endsWith(':voltage'));
      const currents = state.probeKeys.filter((key) => key.endsWith(':current'));
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
    state.instrument.channels.forEach((key, i) => {
      const dot = ui.instCh[i]?.closest('.inst-ch')?.querySelector('.dot');
      if (!dot) return;
      dot.classList.toggle('on', Boolean(key));
      dot.style.color = key ? INST_COLORS[i] : '';
    });
    if (ui.instWindow) ui.instWindow.value = String(state.instrument.window);
    if (ui.instTrail) ui.instTrail.value = String(state.instrument.trail);
    saveInstrumentPrefs();
    scheduleChartDraw();
  }

  function instrumentFrames() {
    const all = state.replay.active ? state.frames.slice(0, state.replay.index + 1) : state.frames;
    const window = Math.max(0.1, Number(state.instrument.window) || 5);
    if (!all.length) return { frames: [], window };
    const last = all[all.length - 1].t;
    const start = last - window;
    let from = all.length - 1;
    while (from > 0 && all[from - 1].t >= start) from -= 1;
    return { frames: all.slice(from), window };
  }

  function instrumentStats(frames, key) {
    let count = 0;
    let sum = 0;
    let square = 0;
    let min = Infinity;
    let max = -Infinity;
    let last = 0;
    for (const frame of frames) {
      const value = frame.v?.[key];
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

  function instrumentSurface(context, canvas, size, fill) {
    if (!context || !canvas) return null;
    const { w, h, dpr } = size;
    if (w < 20 || h < 20) return null;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, w, h);
    context.fillStyle = C(fill);
    context.fillRect(0, 0, w, h);
    return { w, h };
  }

  function instrumentHint(context, w, h, text) {
    context.fillStyle = C('#969083');
    context.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, w / 2, h / 2);
  }

  function renderInstrumentMeter(frames) {
    const key = state.instrument.meterKey;
    const stats = key ? instrumentStats(frames, key) : null;
    const put = (element, text) => {
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

  function renderInstrumentLegend(frames) {
    if (!ui.instLegend) return;
    ui.instLegend.innerHTML = '';
    state.instrument.channels.forEach((key, index) => {
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

  function drawScope(frames, window) {
    const surface = instrumentSurface(scopeCtx, scopeCanvas, state.instrument.scopeSize, '#faf8f2');
    if (!surface) return;
    const { w, h } = surface;
    const left = 46;
    const right = 12;
    const top = 12;
    const bottom = 20;
    const plotW = Math.max(10, w - left - right);
    const plotH = Math.max(10, h - top - bottom);
    scopeCtx.strokeStyle = C('#e7e2d7');
    scopeCtx.lineWidth = 1;
    scopeCtx.beginPath();
    for (let i = 0; i <= 4; i += 1) {
      const y = top + (plotH * i) / 4 + 0.5;
      scopeCtx.moveTo(left, y);
      scopeCtx.lineTo(left + plotW, y);
    }
    for (let i = 0; i <= 4; i += 1) {
      const x = left + (plotW * i) / 4 + 0.5;
      scopeCtx.moveTo(x, top);
      scopeCtx.lineTo(x, top + plotH);
    }
    scopeCtx.stroke();

    const channels = state.instrument.channels
      .map((key, index) => ({ key, index }))
      .filter((entry) => entry.key && state.probeKeys.includes(entry.key));
    if (!frames.length || !channels.length) {
      instrumentHint(
        scopeCtx, w, h,
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
        const value = frame.v?.[key];
        if (Number.isFinite(value)) amp = Math.max(amp, Math.abs(value));
      }
    }
    amp = amp > 0 ? amp * 1.1 : 1;
    const xOf = (t) => left + plotW * ((t - start) / span);
    const yOf = (v) => top + plotH / 2 - (v / amp) * (plotH / 2);

    scopeCtx.strokeStyle = C('#c9c2b4');
    scopeCtx.beginPath();
    scopeCtx.moveTo(left, top + plotH / 2 + 0.5);
    scopeCtx.lineTo(left + plotW, top + plotH / 2 + 0.5);
    scopeCtx.stroke();

    for (const { key, index } of channels) {
      scopeCtx.strokeStyle = INST_COLORS[index];
      scopeCtx.lineWidth = 1.5;
      scopeCtx.beginPath();
      let started = false;
      for (const frame of frames) {
        const value = frame.v?.[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        const x = xOf(frame.t);
        const y = yOf(value);
        if (!started) {
          scopeCtx.moveTo(x, y);
          started = true;
        } else {
          scopeCtx.lineTo(x, y);
        }
      }
      scopeCtx.stroke();
    }

    scopeCtx.fillStyle = C('#969083');
    scopeCtx.font = '9px "Segoe UI", "Microsoft YaHei", sans-serif';
    scopeCtx.textAlign = 'right';
    scopeCtx.textBaseline = 'middle';
    scopeCtx.fillText(fmt(amp, 2), left - 5, top + 6);
    scopeCtx.fillText('0', left - 5, top + plotH / 2);
    scopeCtx.fillText(fmt(-amp, 2), left - 5, top + plotH - 6);
    scopeCtx.textBaseline = 'top';
    scopeCtx.textAlign = 'left';
    scopeCtx.fillText(`${fmt(start, 3)} s`, left, top + plotH + 4);
    scopeCtx.textAlign = 'right';
    scopeCtx.fillText(`${fmt(last, 3)} s`, left + plotW, top + plotH + 4);
    renderInstrumentLegend(frames);
  }

  function drawLissajous(frames) {
    const surface = instrumentSurface(lissCtx, lissCanvas, state.instrument.lissSize, '#faf8f2');
    if (!surface) return;
    const { w, h } = surface;
    const pad = 14;
    lissCtx.strokeStyle = C('#e7e2d7');
    lissCtx.lineWidth = 1;
    lissCtx.beginPath();
    lissCtx.moveTo(w / 2 + 0.5, pad);
    lissCtx.lineTo(w / 2 + 0.5, h - pad);
    lissCtx.moveTo(pad, h / 2 + 0.5);
    lissCtx.lineTo(w - pad, h / 2 + 0.5);
    lissCtx.stroke();

    const xKey = state.instrument.lx;
    const yKey = state.instrument.ly;
    const ready = Boolean(xKey && yKey && state.probeKeys.includes(xKey) && state.probeKeys.includes(yKey));
    if (!ready || !frames.length) {
      instrumentHint(lissCtx, w, h, ready ? '运行仿真后显示李萨如图' : '选择 X / Y 两路信号');
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
    const xOf = (v) => w / 2 + (v / amp) * (size / 2);
    const yOf = (v) => h / 2 - (v / amp) * (size / 2);

    lissCtx.strokeStyle = C('#c2542f');
    lissCtx.lineWidth = 1.2;
    lissCtx.beginPath();
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
        lissCtx.moveTo(px, py);
        started = true;
      } else {
        lissCtx.lineTo(px, py);
      }
      tail = { x: px, y: py };
    }
    lissCtx.stroke();
    if (tail) {
      lissCtx.fillStyle = C('#c2542f');
      lissCtx.beginPath();
      lissCtx.arc(tail.x, tail.y, 2.5, 0, Math.PI * 2);
      lissCtx.fill();
    }
    lissCtx.fillStyle = C('#969083');
    lissCtx.font = '9px "Segoe UI", "Microsoft YaHei", sans-serif';
    lissCtx.textAlign = 'left';
    lissCtx.textBaseline = 'top';
    lissCtx.fillText(`X ${xKey.split(':').slice(1, -1).join(':')}`, pad, pad - 10 + 0.5);
    lissCtx.textBaseline = 'bottom';
    lissCtx.fillText(`Y ${yKey.split(':').slice(1, -1).join(':')}`, pad, h - 1);
  }

  function drawInstruments() {
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

  function resizeInstrument() {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    for (const [target, key] of [[scopeCanvas, 'scopeSize'], [lissCanvas, 'lissSize']]) {
      if (!target) continue;
      const wrap = target.parentElement;
      if (!wrap) continue;
      const rect = wrap.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      state.instrument[key] = { w, h, dpr };
      target.width = Math.max(1, Math.round(w * dpr));
      target.height = Math.max(1, Math.round(h * dpr));
    }
    scheduleChartDraw();
  }

  function bindInstrumentEvents() {
    const bind = (element, event, handler) => {
      if (element) element.addEventListener(event, handler);
    };
    bind(ui.instMeterKey, 'change', () => {
      state.instrument.meterKey = ui.instMeterKey.value || '';
      saveInstrumentPrefs();
      scheduleChartDraw();
    });
    ui.instCh.forEach((select, index) => {
      bind(select, 'change', () => {
        state.instrument.channels[index] = select.value || null;
        const dot = select.closest('.inst-ch')?.querySelector('.dot');
        if (dot) {
          dot.classList.toggle('on', Boolean(select.value));
          dot.style.color = select.value ? INST_COLORS[index] : '';
        }
        saveInstrumentPrefs();
        scheduleChartDraw();
      });
    });
    bind(ui.instLX, 'change', () => {
      state.instrument.lx = ui.instLX.value || '';
      saveInstrumentPrefs();
      scheduleChartDraw();
    });
    bind(ui.instLY, 'change', () => {
      state.instrument.ly = ui.instLY.value || '';
      saveInstrumentPrefs();
      scheduleChartDraw();
    });
    bind(ui.instWindow, 'input', () => {
      state.instrument.window = clamp(Number(ui.instWindow.value) || 5, 0.1, 120);
      saveInstrumentPrefs();
      scheduleChartDraw();
    });
    bind(ui.instTrail, 'input', () => {
      state.instrument.trail = clamp(Math.round(Number(ui.instTrail.value) || 600), 20, 4000);
      saveInstrumentPrefs();
      scheduleChartDraw();
    });
  }

  function initInstruments() {
    loadInstrumentPrefs();
    resizeInstrument();
    bindInstrumentEvents();
    fillInstrumentSelects();
  }

  function drawChart() {
    if (activeTab() !== 'chart') return;
    const { w, h, dpr } = state.chartSize;
    if (w < 20 || h < 20) return;
    chartCanvas.dataset.renderSize = `${w}x${h}@${dpr}`;
    chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    chartCtx.clearRect(0, 0, w, h);
    chartCtx.fillStyle = C('#faf8f2');
    chartCtx.fillRect(0, 0, w, h);

    const keys = Array.from(state.chart.selected);
    const frames = state.replay.active
      ? state.frames.slice(0, state.replay.index + 1)
      : state.frames;
    if (!keys.length || !frames.length) {
      chartCtx.fillStyle = C('#969083');
      chartCtx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
      chartCtx.textAlign = 'center';
      chartCtx.textBaseline = 'middle';
      chartCtx.fillText(frames.length ? '在信号列表里勾选要绘制的信号' : '运行仿真后自动采集轨迹', w / 2, h / 2);
      return;
    }

    const left = 54;
    const right = 14;
    const top = 14;
    const bottom = 24;
    const plotW = Math.max(10, w - left - right);
    const plotH = Math.max(10, h - top - bottom);
    const window = Math.max(0.1, Number(state.chart.window) || 5);
    const tMax = frames[frames.length - 1].t;
    const tMin = Math.max(0, tMax - window);
    const spanT = Math.max(1e-9, tMax - tMin);

    const series = [];
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const key of keys) {
      const color = colorForKey(key);
      const points = [];
      for (const frame of frames) {
        if (frame.t < tMin) continue;
        const value = frame.v[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        points.push({ t: frame.t, v: value });
        if (value < yMin) yMin = value;
        if (value > yMax) yMax = value;
      }
      series.push({ key, color, points });
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      chartCtx.fillStyle = C('#969083');
      chartCtx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
      chartCtx.textAlign = 'center';
      chartCtx.fillText('所选信号在时间窗内没有数值', w / 2, h / 2);
      return;
    }
    let spanY = yMax - yMin;
    if (spanY < 1e-9) {
      const pad = Math.max(1, Math.abs(yMax) * 0.2);
      yMin -= pad;
      yMax += pad;
      spanY = yMax - yMin;
    } else {
      const pad = spanY * 0.12;
      yMin -= pad;
      yMax += pad;
      spanY = yMax - yMin;
    }

    const xOf = (t) => left + ((t - tMin) / spanT) * plotW;
    const yOf = (v) => top + (1 - (v - yMin) / spanY) * plotH;

    chartCtx.font = '10px "Cascadia Code", Consolas, monospace';
    chartCtx.lineWidth = 1;
    chartCtx.textBaseline = 'middle';
    for (let index = 0; index <= 4; index += 1) {
      const y = top + (plotH * index) / 4;
      chartCtx.strokeStyle = index === 4 ? '#c0b6a5' : '#e7e1d5';
      chartCtx.beginPath();
      chartCtx.moveTo(left, Math.round(y) + 0.5);
      chartCtx.lineTo(left + plotW, Math.round(y) + 0.5);
      chartCtx.stroke();
      chartCtx.fillStyle = C('#8b8376');
      chartCtx.textAlign = 'right';
      chartCtx.fillText(fmt(yMax - (spanY * index) / 4, 3), left - 8, y);
    }
    for (let index = 0; index <= 4; index += 1) {
      const x = left + (plotW * index) / 4;
      chartCtx.strokeStyle = index === 0 ? '#c0b6a5' : '#e7e1d5';
      chartCtx.beginPath();
      chartCtx.moveTo(Math.round(x) + 0.5, top);
      chartCtx.lineTo(Math.round(x) + 0.5, top + plotH);
      chartCtx.stroke();
      chartCtx.fillStyle = C('#8b8376');
      chartCtx.textAlign = index === 0 ? 'left' : index === 4 ? 'right' : 'center';
      const tick = tMin + (spanT * index) / 4;
      const decimals = spanT >= 10 ? 1 : spanT >= 1 ? 2 : spanT >= 0.1 ? 3 : spanT >= 0.01 ? 4 : 5;
      chartCtx.fillText(`${tick.toFixed(decimals)}s`, x, top + plotH + 12);
    }

    chartCtx.save();
    chartCtx.beginPath();
    chartCtx.rect(left, top, plotW, plotH);
    chartCtx.clip();
    chartCtx.lineJoin = 'round';
    chartCtx.lineCap = 'round';
    for (const item of series) {
      if (!item.points.length) continue;
      chartCtx.strokeStyle = item.color;
      chartCtx.lineWidth = 1.6;
      chartCtx.beginPath();
      item.points.forEach((point, index) => {
        const x = xOf(point.t);
        const y = yOf(point.v);
        if (index === 0) chartCtx.moveTo(x, y);
        else chartCtx.lineTo(x, y);
      });
      chartCtx.stroke();
      const last = item.points[item.points.length - 1];
      chartCtx.fillStyle = item.color;
      chartCtx.beginPath();
      chartCtx.arc(xOf(last.t), yOf(last.v), 2.4, 0, Math.PI * 2);
      chartCtx.fill();
    }

    const hover = state.chart.hover;
    if (hover && hover.x >= left && hover.x <= left + plotW && hover.y >= top && hover.y <= top + plotH) {
      const t = tMin + ((hover.x - left) / plotW) * spanT;
      const frame = nearestFrame(t);
      if (frame) {
        const hx = xOf(frame.t);
        chartCtx.strokeStyle = C('rgba(168, 84, 31, .45)');
        chartCtx.lineWidth = 1;
        chartCtx.setLineDash([3, 3]);
        chartCtx.beginPath();
        chartCtx.moveTo(hx, top);
        chartCtx.lineTo(hx, top + plotH);
        chartCtx.stroke();
        chartCtx.setLineDash([]);
        for (const item of series) {
          const value = frame.v[item.key];
          if (typeof value !== 'number' || !Number.isFinite(value)) continue;
          chartCtx.beginPath();
          chartCtx.arc(hx, yOf(value), 2.8, 0, Math.PI * 2);
          chartCtx.fillStyle = item.color;
          chartCtx.fill();
        }
        const rows = series
          .filter((item) => typeof frame.v[item.key] === 'number' && Number.isFinite(frame.v[item.key]))
          .slice(0, 5)
          .map((item) => `${decodeProbeKey(item.key).label}  ${fmt(frame.v[item.key], 4)}`);
        const lines = [`t = ${fmt(frame.t, 4)} s`, ...rows];
        chartCtx.font = '10px "Cascadia Code", Consolas, monospace';
        let boxW = 0;
        for (const line of lines) boxW = Math.max(boxW, chartCtx.measureText(line).width);
        boxW += 16;
        const boxH = lines.length * 15 + 10;
        const boxX = clamp(hx + 12, left + 4, left + plotW - boxW - 4);
        const boxY = clamp(top + 6, top + 4, top + plotH - boxH - 4);
        chartCtx.fillStyle = 'rgba(250, 248, 242, .97)';
        chartCtx.strokeStyle = C('#bcb3a1');
        chartCtx.lineWidth = 1;
        roundRectPath(chartCtx, boxX, boxY, boxW, boxH, 6);
        chartCtx.fill();
        chartCtx.stroke();
        chartCtx.textAlign = 'left';
        chartCtx.textBaseline = 'top';
        lines.forEach((line, index) => {
          chartCtx.fillStyle = index === 0 ? C('#a8541f') : '#5f584e';
          chartCtx.fillText(line, boxX + 8, boxY + 6 + index * 15);
        });
      }
    }
    chartCtx.restore();
  }

  /* ======================================================================
   * 二维有限元场
   * ==================================================================== */
  function setWorkspaceButtons() {
    if (!ui.workspaceSwitch) return;
    $$('button[data-workspace]', ui.workspaceSwitch).forEach((item) => {
      item.classList.toggle('active', item.dataset.workspace === state.workspace);
    });
  }

  function syncFemChrome() {
    const fem = state.fem;
    if (!fem) return;
    updateRunButton(Boolean(fem.running));
    ui.simTime.textContent = fmt(fem.time ?? 0, 3);
    ui.simFps.textContent = String(Math.round(fem.actual_fps ?? 0));
    ui.simSteps.textContent = intText(fem.steps ?? 0);
    ui.simFps.title = `目标 ${fem.config?.fps ?? '—'} fps · 实际 ${(fem.actual_fps ?? 0).toFixed(1)}`;
    const stats = fem.stats || {};
    ui.statusMode.textContent = '有限元场';
    ui.statusEngine.textContent = `Q4 · ${stats.dof || 0} DOF`;
    let hint = fem.running ? '运行中' : '已暂停';
    if (fem.config) {
      hint += ` · ${fem.config.fps} fps × ${fem.config.steps_per_frame} 步 · dt ${fmt(fem.config.dt, 4)}`;
    }
    ui.statusHint.textContent = hint;
    ui.statusLimits.textContent = `节点 ${stats.nodes || 0} · 单元 ${stats.elements || 0}`;
    if (fem.error) {
      if (state.dismissedError !== fem.error) showBanner(fem.error);
    } else {
      state.dismissedError = null;
      hideBanner();
    }
    updateFemPanelValues();
  }

  function applyFemSnapshot(snapshot) {
    if (!snapshot) return;
    state.fem = snapshot;
    state.femMesh = snapshot.mesh || state.femMesh;
    state.femMeshRevision = snapshot.mesh_revision || state.femMeshRevision;
    state.femCursor = Number(snapshot.cursor) || 0;
    if (Array.isArray(snapshot.field)) {
      state.femFrames = [{ t: snapshot.time || 0, field: snapshot.field, min: snapshot.stats?.min, max: snapshot.stats?.max }];
      while (state.femFrames.length > 600) state.femFrames.shift();
    }
    updateFemPanelValues();
    syncFemChrome();
    resizeFem();
    drawFem();
  }

  async function ensureFemState(force = false) {
    if (state.fem && !force) return state.fem;
    try {
      const snapshot = await api('/api/fem/state');
      applyFemSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      toast(`有限元场加载失败：${error.message}`, 'error', 7000);
      return null;
    }
  }

  async function switchWorkspace(name) {
    if (name === state.workspace) return;
    if (name === 'fem') {
      if (state.sim?.running) await networkControl('pause');
      state.workspace = 'fem';
      document.body.classList.add('workspace-fem');
      ui.main.classList.add('fem-mode');
      ui.femStage.classList.remove('hidden');
      ui.panel.classList.remove('collapsed');
      ui.main.classList.remove('panel-hidden');
      ui.panel.classList.add('field-mode');
      setWorkspaceButtons();
      switchTab('fem');
      await ensureFemState();
      renderFemPanel();
      resizeFem();
      updateFemPanelValues();
      drawFem();
      syncFemChrome();
    } else {
      if (state.fem?.running) await femControl('pause');
      state.workspace = 'network';
      document.body.classList.remove('workspace-fem');
      ui.main.classList.remove('fem-mode');
      ui.femStage.classList.add('hidden');
      ui.panel.classList.remove('field-mode');
      setWorkspaceButtons();
      switchTab('inspect');
      resizeGraph();
      resizeChart();
      syncUI();
      requestDraw();
    }
  }

  async function femControl(action, steps) {
    const body = { action };
    if (steps !== undefined) body.steps = steps;
    const response = await task(() => jsonRequest('/api/fem/control', 'POST', body), { dirty: false });
    if (!response) return;
    if (action === 'reset') {
      await ensureFemState(true);
      state.femStarted = false;
    } else if (response.fem && state.fem) {
      state.fem = Object.assign({}, state.fem, response.fem);
    }
    syncFemChrome();
    drawFem();
    if (action === 'step' || action === 'reset') await pollFem();
  }

  function resizeFem() {
    if (!ui.femStage) return;
    const rect = ui.femStage.getBoundingClientRect();
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    state.femSize = { w: width, h: height, dpr };
    femCanvas.width = Math.max(1, Math.round(width * dpr));
    femCanvas.height = Math.max(1, Math.round(height * dpr));
    if (state.workspace === 'fem') drawFem();
  }

  function femLayout(w, h) {
    const padLeft = 52;
    const padRight = 118;
    const padTop = 42;
    const padBottom = 46;
    const size = Math.max(40, Math.min(w - padLeft - padRight, h - padTop - padBottom));
    return {
      size,
      x0: padLeft + Math.max(0, (w - padLeft - padRight - size) / 2),
      y0: padTop + Math.max(0, (h - padTop - padBottom - size) / 2),
    };
  }

  function femColor(value, minimum, maximum) {
    const span = Math.max(1.0e-9, maximum - minimum);
    const t = clamp((value - minimum) / span, 0, 1);
    const stops = [
      [0.00, [247, 244, 236]],
      [0.22, [236, 223, 204]],
      [0.45, [214, 169, 132]],
      [0.68, [184, 111, 70]],
      [0.86, [139, 57, 32]],
      [1.00, [59, 18, 10]],
    ];
    for (let index = 1; index < stops.length; index += 1) {
      if (t <= stops[index][0]) {
        const [t0, c0] = stops[index - 1];
        const [t1, c1] = stops[index];
        const ratio = (t - t0) / Math.max(1.0e-9, t1 - t0);
        return `rgb(${Math.round(c0[0] + (c1[0] - c0[0]) * ratio)},`
          + `${Math.round(c0[1] + (c1[1] - c0[1]) * ratio)},`
          + `${Math.round(c0[2] + (c1[2] - c0[2]) * ratio)})`;
      }
    }
    return 'rgb(59, 18, 10)';
  }

  function femHoverFromPoint(x, y) {
    if (!state.femMesh || !state.fem) return null;
    const { w, h } = state.femSize;
    const { size, x0, y0 } = femLayout(w, h);
    if (x < x0 || x > x0 + size || y < y0 || y > y0 + size) return null;
    const mesh = state.femMesh;
    const nx = mesh.nx;
    const ny = mesh.ny;
    const i = clamp(Math.round(((x - x0) / size) * nx), 0, nx);
    const j = clamp(Math.round((1 - (y - y0) / size) * ny), 0, ny);
    const index = j * (nx + 1) + i;
    const value = state.fem.field?.[index];
    if (typeof value !== 'number') return null;
    return {
      x, y, i, j, index, value,
      sx: x0 + (i / nx) * size,
      sy: y0 + (1 - j / ny) * size,
    };
  }

  function drawFem() {
    if (!ui.femStage || state.workspace !== 'fem') return;
    const { w, h, dpr } = state.femSize;
    if (w < 20 || h < 20) return;
    femCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    femCtx.clearRect(0, 0, w, h);
    femCtx.fillStyle = C('#f2efe7');
    femCtx.fillRect(0, 0, w, h);

    if (!state.fem || !state.femMesh) {
      femCtx.fillStyle = C('#969083');
      femCtx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
      femCtx.textAlign = 'center';
      femCtx.textBaseline = 'middle';
      femCtx.fillText('有限元场尚未初始化', w / 2, h / 2);
      return;
    }

    const mesh = state.femMesh;
    const field = state.fem.field || [];
    const stats = state.fem.stats || {};
    const config = state.fem.config || {};
    const minimum = Number.isFinite(stats.min) ? stats.min : Math.min(...field);
    const maximum = Number.isFinite(stats.max) ? stats.max : Math.max(...field);
    const { size, x0, y0 } = femLayout(w, h);
    const nx = Math.max(1, mesh.nx);
    const ny = Math.max(1, mesh.ny);
    const cellW = size / nx;
    const cellH = size / ny;
    const sub = 3;

    const elements = mesh.elements || [];
    for (const element of elements) {
      const [n0, n1, n2, n3] = element;
      const t0 = field[n0];
      const t1 = field[n1];
      const t2 = field[n2];
      const t3 = field[n3];
      if (![t0, t1, t2, t3].every((value) => typeof value === 'number')) continue;
      const ex = x0 + mesh.x[n0] * size;
      const eyTop = y0 + (1 - mesh.y[n2]) * size;
      for (let sy = 0; sy < sub; sy += 1) {
        const v = 1 - (sy + 0.5) / sub;
        for (let sx = 0; sx < sub; sx += 1) {
          const u = (sx + 0.5) / sub;
          const temp = (1 - u) * (1 - v) * t0 + u * (1 - v) * t1 + u * v * t2 + (1 - u) * v * t3;
          femCtx.fillStyle = femColor(temp, minimum, maximum);
          femCtx.fillRect(
            ex + (sx * cellW) / sub,
            eyTop + (sy * cellH) / sub,
            cellW / sub + 0.6,
            cellH / sub + 0.6,
          );
        }
      }
    }

    femCtx.strokeStyle = 'rgba(17, 16, 14, 0.12)';
    femCtx.lineWidth = 0.55;
    femCtx.beginPath();
    for (const element of elements) {
      const n0 = element[0];
      const n2 = element[2];
      const ex = x0 + mesh.x[n0] * size;
      const eyTop = y0 + (1 - mesh.y[n2]) * size;
      femCtx.rect(ex, eyTop, cellW, cellH);
    }
    femCtx.stroke();

    femCtx.strokeStyle = C('#11100e');
    femCtx.lineWidth = 1.2;
    femCtx.strokeRect(x0, y0, size, size);
    femCtx.strokeStyle = C('#a8541f');
    femCtx.lineWidth = 2.2;
    femCtx.beginPath();
    femCtx.moveTo(x0 + 0.5, y0);
    femCtx.lineTo(x0 + 0.5, y0 + size);
    femCtx.moveTo(x0 + size - 0.5, y0);
    femCtx.lineTo(x0 + size - 0.5, y0 + size);
    femCtx.stroke();

    femCtx.fillStyle = C('#6f695f');
    femCtx.font = '8px "Cascadia Code", Consolas, monospace';
    femCtx.textAlign = 'left';
    femCtx.textBaseline = 'top';
    femCtx.fillText(`DIRICHLET ${fmt(config.boundary_left, 0)} °C`, x0, y0 + size + 12);
    femCtx.textAlign = 'right';
    femCtx.fillText(`DIRICHLET ${fmt(config.boundary_right, 0)} °C`, x0 + size, y0 + size + 12);

    const sourceY = 0.5 + 0.22 * Math.sin(2 * Math.PI * 0.055 * (state.fem.time || 0) + 0.6);
    const sourceX = Number(config.source_x ?? 0.35);
    const sourceScreenX = x0 + sourceX * size;
    const sourceScreenY = y0 + (1 - sourceY) * size;
    const sourceRadius = Math.max(8, Number(config.source_sigma || 0.09) * size * 2.2);
    femCtx.strokeStyle = C('rgba(168, 84, 31, 0.85)');
    femCtx.lineWidth = 1;
    femCtx.setLineDash([3, 3]);
    femCtx.beginPath();
    femCtx.arc(sourceScreenX, sourceScreenY, sourceRadius, 0, Math.PI * 2);
    femCtx.stroke();
    femCtx.setLineDash([]);
    femCtx.beginPath();
    femCtx.moveTo(sourceScreenX - 5, sourceScreenY);
    femCtx.lineTo(sourceScreenX + 5, sourceScreenY);
    femCtx.moveTo(sourceScreenX, sourceScreenY - 5);
    femCtx.lineTo(sourceScreenX, sourceScreenY + 5);
    femCtx.stroke();
    femCtx.fillStyle = C('#a8541f');
    femCtx.font = '8px "Cascadia Code", Consolas, monospace';
    femCtx.textAlign = 'left';
    femCtx.textBaseline = 'top';
    femCtx.fillText('HEAT', sourceScreenX + sourceRadius + 3, sourceScreenY - 4);

    const barX = x0 + size + 22;
    const barY = y0 + 6;
    const barW = 9;
    const barH = size - 12;
    const gradient = femCtx.createLinearGradient(0, barY, 0, barY + barH);
    for (let index = 0; index <= 10; index += 1) {
      gradient.addColorStop(1 - index / 10, femColor(minimum + ((maximum - minimum) * index) / 10, minimum, maximum));
    }
    femCtx.fillStyle = gradient;
    femCtx.fillRect(barX, barY, barW, barH);
    femCtx.strokeStyle = C('#bcb3a1');
    femCtx.lineWidth = 1;
    femCtx.strokeRect(barX, barY, barW, barH);
    femCtx.fillStyle = C('#6f695f');
    femCtx.font = '8px "Cascadia Code", Consolas, monospace';
    femCtx.textAlign = 'center';
    femCtx.textBaseline = 'bottom';
    femCtx.fillText('T / °C', barX + barW / 2, barY - 4);
    femCtx.textAlign = 'left';
    femCtx.textBaseline = 'middle';
    for (let index = 0; index <= 4; index += 1) {
      const ratio = index / 4;
      const ty = barY + ratio * barH;
      const value = maximum - (maximum - minimum) * ratio;
      femCtx.beginPath();
      femCtx.moveTo(barX + barW, ty);
      femCtx.lineTo(barX + barW + 4, ty);
      femCtx.stroke();
      femCtx.fillText(fmt(value, 1), barX + barW + 7, ty);
    }


    femCtx.fillStyle = C('#6f695f');
    femCtx.font = '8px "Cascadia Code", Consolas, monospace';
    femCtx.textAlign = 'right';
    femCtx.textBaseline = 'top';
    femCtx.fillText(`t=${fmt(state.fem.time, 4)} s · solve ${fmt(stats.solve_ms, 2)} ms`, x0 + size, y0 - 24);

    const hover = state.femHover;
    if (hover) {
      femCtx.strokeStyle = C('#11100e');
      femCtx.lineWidth = 1;
      femCtx.beginPath();
      femCtx.moveTo(hover.sx - 7, hover.sy);
      femCtx.lineTo(hover.sx + 7, hover.sy);
      femCtx.moveTo(hover.sx, hover.sy - 7);
      femCtx.lineTo(hover.sx, hover.sy + 7);
      femCtx.stroke();
      femCtx.beginPath();
      femCtx.arc(hover.sx, hover.sy, 8, 0, Math.PI * 2);
      femCtx.stroke();
      const label = `T ${fmt(hover.value, 2)} °C · (${hover.i},${hover.j})`;
      femCtx.font = '9px "Cascadia Code", Consolas, monospace';
      const textWidth = femCtx.measureText(label).width;
      const labelX = clamp(hover.sx + 12, x0, x0 + size - textWidth - 10);
      const labelY = clamp(hover.sy - 20, y0, y0 + size - 18);
      femCtx.fillStyle = 'rgba(250, 248, 242, .95)';
      femCtx.fillRect(labelX - 4, labelY - 2, textWidth + 8, 15);
      femCtx.fillStyle = C('#11100e');
      femCtx.textAlign = 'left';
      femCtx.textBaseline = 'top';
      femCtx.fillText(label, labelX, labelY);
      ui.femHudProbe.textContent = `T=${fmt(hover.value, 3)} °C · node (${hover.i}, ${hover.j})`;
    } else {
      ui.femHudProbe.textContent = `Tmax=${fmt(maximum, 2)} °C · Tmin=${fmt(minimum, 2)} °C · mean=${fmt(stats.mean, 2)} °C`;
    }
  }

  function readFemConfig() {
    const read = (key) => {
      const input = $(`[data-fem="${key}"]`, ui.femPanel);
      return input ? Number(input.value) : NaN;
    };
    const config = {
      nx: read('nx'), ny: read('ny'), dt: read('dt'), fps: read('fps'),
      steps_per_frame: read('steps'), sample_every: read('sample'),
      conductivity: read('conductivity'), capacity: read('capacity'),
      source_amplitude: read('source_amplitude'), source_frequency: read('source_frequency'),
      source_sigma: read('source_sigma'), source_x: read('source_x'),
      boundary_left: read('boundary_left'), boundary_right: read('boundary_right'),
      initial_temperature: read('initial_temperature'),
    };
    for (const [key, value] of Object.entries(config)) {
      if (!Number.isFinite(value)) throw new Error(`有限元参数 ${key} 不是有效数字`);
    }
    if (!Number.isInteger(config.nx) || config.nx < 6 || config.nx > 80) throw new Error('网格 nx 必须是 6–80 的整数');
    if (!Number.isInteger(config.ny) || config.ny < 6 || config.ny > 60) throw new Error('网格 ny 必须是 6–60 的整数');
    if ((config.nx + 1) * (config.ny + 1) > 6000) throw new Error('节点数不能超过 6000');
    if (!(config.dt > 0)) throw new Error('dt 必须大于 0');
    if (config.dt * config.steps_per_frame > 2) throw new Error('每帧推进时间过大，请减小 dt 或步数');
    return config;
  }

  async function applyFemConfig() {
    let payload;
    try {
      payload = readFemConfig();
    } catch (error) {
      toast(error.message, 'error', 6000);
      return;
    }
    const response = await task(() => jsonRequest('/api/fem/config', 'PATCH', payload));
    if (!response) return;
    applyFemSnapshot(response.fem);
    renderFemPanel();
    toast('有限元参数已重建', 'ok', 2000);
  }

  function renderFemPanel() {
    if (!ui.femPanel || ui.femPanel.dataset.ready === '1') return;
    ui.femPanel.replaceChildren();
    ui.femPanel.dataset.ready = '1';

    const head = div('fem-head');
    head.appendChild(el('h2', null, 'FIELD · Q4 FEM'));
    head.appendChild(el('p', null, '二维瞬态热传导：单位方板、Q4 双线性单元、后向欧拉；左右 Dirichlet，上下绝缘，高斯热源随时间摆动。'));
    ui.femPanel.appendChild(head);

    const intro = div('fem-note');
    intro.textContent = '弱形式装配后使用稀疏 LU 一次分解、每步回代。色标从冷纸色过渡到铜色，黑色网格为实际有限元单元。';
    ui.femPanel.appendChild(intro);

    const configSection = section('场参数', '重建网格会重置时间');
    const grid = div('fem-grid');
    const fields = [
      ['nx', '网格 nx', 36, 6, 80, 1],
      ['ny', '网格 ny', 24, 6, 60, 1],
      ['dt', '时间步 dt', 0.002, 0.00001, 0.1, 0.0001],
      ['fps', '帧率 fps', 30, 1, 120, 1],
      ['steps', '每帧步数', 8, 1, 50, 1],
      ['sample', '采样间隔', 1, 1, 20, 1],
      ['conductivity', '导热 k', 1.0, 0.0001, 1000, 0.1],
      ['capacity', '热容 ρc', 1.0, 0.0001, 1000, 0.1],
      ['source_amplitude', '热源幅值', 5000, 0, 1000000, 100],
      ['source_frequency', '热源频率', 0.08, 0, 20, 0.01],
      ['source_sigma', '热源半径', 0.09, 0.02, 0.5, 0.01],
      ['source_x', '热源 x', 0.35, 0.05, 0.95, 0.01],
      ['boundary_left', '左边界 °C', 20, -500, 1000, 1],
      ['boundary_right', '右边界 °C', 20, -500, 1000, 1],
      ['initial_temperature', '初始温度', 20, -500, 1000, 1],
    ];
    for (const [key, labelText, value, minimum, maximum, step] of fields) {
      const input = numberInput(value, { min: minimum, max: maximum, step });
      input.dataset.fem = key;
      grid.appendChild(fieldFor(labelText, '', input));
    }
    configSection.appendChild(grid);
    const actions = div('fem-actions');
    actions.appendChild(button('应用场参数', 'btn primary', () => void applyFemConfig()));
    actions.appendChild(button('重置场', 'btn', () => void femControl('reset')));
    configSection.appendChild(actions);
    ui.femPanel.appendChild(configSection);

    const statsSection = section('求解统计', '每帧更新');
    const statsGrid = div('fem-stats');
    for (const [key, labelText] of [
      ['dof', '自由度'], ['elements', '单元'],
      ['solve', '求解 ms'], ['min', 'T min'],
      ['max', 'T max'], ['mean', 'T mean'],
    ]) {
      const stat = div('stat');
      stat.appendChild(el('span', null, labelText));
      const value = el('b', null, '—');
      value.dataset.femstat = key;
      stat.appendChild(value);
      statsGrid.appendChild(stat);
    }
    statsSection.appendChild(statsGrid);
    const probe = div('fem-probe');
    probe.dataset.role = 'fem-probe';
    probe.textContent = '把鼠标移动到色场上读取节点温度。';
    statsSection.appendChild(probe);
    ui.femPanel.appendChild(statsSection);

    const note = div('fem-note');
    note.textContent = '提示：提高 nx / ny 可以看到更细的网格；增大热源幅值或降低导热系数会让温差更明显。';
    ui.femPanel.appendChild(note);

    updateFemPanelValues();
  }

  function updateFemPanelValues() {
    if (!ui.femPanel || ui.femPanel.dataset.ready !== '1' || !state.fem) return;
    const config = state.fem.config || {};
    const setValue = (key, value) => {
      const input = $(`[data-fem="${key}"]`, ui.femPanel);
      if (!input || document.activeElement === input) return;
      input.value = String(value);
    };
    setValue('nx', config.nx);
    setValue('ny', config.ny);
    setValue('dt', config.dt);
    setValue('fps', config.fps);
    setValue('steps', config.steps_per_frame);
    setValue('sample', config.sample_every);
    setValue('conductivity', config.conductivity);
    setValue('capacity', config.capacity);
    setValue('source_amplitude', config.source_amplitude);
    setValue('source_frequency', config.source_frequency);
    setValue('source_sigma', config.source_sigma);
    setValue('source_x', config.source_x);
    setValue('boundary_left', config.boundary_left);
    setValue('boundary_right', config.boundary_right);
    setValue('initial_temperature', config.initial_temperature);

    const stats = state.fem.stats || {};
    const setStat = (key, value) => {
      const node = $(`[data-femstat="${key}"]`, ui.femPanel);
      if (node) node.textContent = value;
    };
    setStat('dof', String(stats.dof ?? '—'));
    setStat('elements', String(stats.elements ?? '—'));
    setStat('solve', fmt(stats.solve_ms, 2));
    setStat('min', fmt(stats.min, 2));
    setStat('max', fmt(stats.max, 2));
    setStat('mean', fmt(stats.mean, 2));
    const probe = $('[data-role="fem-probe"]', ui.femPanel);
    if (probe && !state.femHover) {
      probe.textContent = `中心温度 ${fmt(stats.mean, 3)} °C · 网格 ${config.nx}×${config.ny} · ${stats.elements || 0} 个 Q4 单元`;
    }
  }

  async function pollFem() {
    if (state.femBusy || !state.fem) return;
    if (!state.fem.running && state.femCursor >= Number(state.fem.cursor || 0)) return;
    state.femBusy = true;
    try {
      const data = await api(`/api/fem/live?cursor=${state.femCursor}&limit=1`);
      if (Array.isArray(data.frames) && data.frames.length) {
        const frame = data.frames[data.frames.length - 1];
        state.fem.field = frame.field;
        state.fem.time = frame.t;
        state.femFrames.push(frame);
        while (state.femFrames.length > 600) state.femFrames.shift();
        state.femCursor = data.cursor;
      }
      state.fem.running = data.running;
      state.fem.steps = data.steps;
      state.fem.time = data.time;
      state.fem.config = data.config;
      state.fem.actual_fps = data.actual_fps;
      state.fem.error = data.error;
      state.fem.stats = data.stats;
      syncFemChrome();
      drawFem();
    } catch (error) {
      const now = performance.now();
      if (now - (state.lastLiveError || 0) > 8000) {
        state.lastLiveError = now;
        toast(`有限元实时数据失败：${error.message}`, 'error', 5000);
      }
    } finally {
      state.femBusy = false;
    }
  }

  async function pollLive() {
    if (state.liveBusy) return;
    const sim = state.sim;
    if (!sim) return;
    if (!sim.running && state.cursor >= Number(sim.cursor || 0)) return;
    state.liveBusy = true;
    try {
      const previousCursor = state.cursor;
      const previousSteps = Number(sim.steps || 0);
      const data = await api(`/api/live?cursor=${state.cursor}&limit=600`);
      const resetDetected = Boolean(
        data.sim
        && (Number(data.cursor || 0) < previousCursor || Number(data.sim.steps || 0) < previousSteps),
      );
      if (resetDetected) {
        state.frames = [];
        state.values.clear();
        state.nodeValues.clear();
        state.edgeValues.clear();
      }
      if (Array.isArray(data.frames) && data.frames.length) {
        if (!state.frames.length) {
          state.replay.recordingRevision = state.scene?.revision ?? null;
        }
        for (const frame of data.frames) {
          state.frames.push(frame);
          ingestFrame(frame);
        }
        if (state.frames.length > MAX_FRAMES) {
          state.frames.splice(0, state.frames.length - MAX_FRAMES);
        }
      }
      if (typeof data.cursor === 'number') state.cursor = data.cursor;
      if (data.sim) state.sim = data.sim;
      updateSignalKeyCache();
      syncUI();
      updateReplayUI();
      updateInspectorLive();
      updateSignalListValues();
      updateLegendValues();
      scheduleChartDraw();
      if (resetDetected) void refreshState(true);
    } catch (error) {
      const now = performance.now();
      if (now - (state.lastLiveError || 0) > 8000) {
        state.lastLiveError = now;
        toast(`实时数据获取失败：${error.message}`, 'error', 5000);
      }
    } finally {
      state.liveBusy = false;
    }
  }

  async function refreshState(quiet = true) {
    if (state.stateBusy) return;
    if (state.drag) return;
    state.stateBusy = true;
    try {
      const snapshot = await api('/api/state');
      state.lastStateFetch = performance.now();
      applySnapshot(snapshot);
    } catch (error) {
      if (!quiet) toast(`状态刷新失败：${error.message}`, 'error', 5000);
    } finally {
      state.stateBusy = false;
    }
  }

  async function pollLoop() {
    clearTimeout(state.pollTimer);
    try {
      if (state.workspace === 'fem') {
        if (state.fem && (state.fem.running || state.femCursor < Number(state.fem.cursor || 0))) {
          await pollFem();
        }
      } else {
        const sim = state.sim;
        if (sim && (sim.running || state.cursor < Number(sim.cursor || 0))) {
          await pollLive();
        }
      }
    } finally {
      if (!state.shuttingDown) {
        const activeRunning = state.workspace === 'fem' ? state.fem?.running : state.sim?.running;
        state.pollTimer = setTimeout(pollLoop, activeRunning ? 110 : 500);
      }
    }
  }

  /* ======================================================================
   * 10. 仿真控制、静态事件与启动
   * ==================================================================== */

  function resetLocalFrames() {
    state.frames = [];
    state.values.clear();
    state.nodeValues.clear();
    state.edgeValues.clear();
    state.cursor = 0;
    stopReplayTimer();
    state.replay.active = false;
    state.replay.index = 0;
    state.replay.recordingRevision = null;
    updateSignalListValues();
    updateLegendValues();
    updateReplayUI();
    scheduleChartDraw();
  }

  async function networkControl(action, steps) {
    const body = { action };
    if (steps !== undefined) body.steps = steps;
    const response = await task(() => jsonRequest('/api/control', 'POST', body), { dirty: false });
    if (!response) return;
    state.sim = response.sim;
    if (action === 'reset') {
      resetLocalFrames();
    } else if (action === 'run' || action === 'step') {
      if (state.replay.active) leaveReplay();
    }
    syncUI();
    updateSignalKeyCache();
    updateInspectorLive();
    if (action === 'step' || action === 'reset') await pollLive();
    if (action === 'reset') toast('仿真已重置；探针与仪器设置保留', 'ok', 2200);
  }

  async function control(action, steps) {
    if (state.workspace === 'fem') {
      await femControl(action, steps);
      return;
    }
    await networkControl(action, steps);
  }

  async function maybeAutostart() {
    // R30-4：启动后任何模式都保持停止状态；运行必须由用户显式触发（空格/按钮）。
    return;
  }

  function showShutdownScreen() {
    ui.modalCard.replaceChildren();
    ui.modalCard.appendChild(el('h3', null, '服务已关闭'));
    const body = el('p', null, '后台网络与有限元线程已停止，监听端口已释放。现在可以关闭此标签页。');
    const note = div('fem-note');
    note.textContent = '如需再次使用，请重新运行 run.py 或双击 start.bat；端口通常会在 1 秒内重新可用。';
    ui.modalCard.append(body, note);
    ui.modal.classList.remove('hidden');
    ui.modal.onclick = null;
  }

  async function shutdownApp() {
    if (state.shuttingDown) return;
    const confirmed = await confirmModal(
      '退出 Netlab？',
      '将停止网络与有限元仿真线程，终止后端进程并释放监听端口。所有未导出的内存场景都会丢失。',
      '退出并关闭',
      true,
    );
    if (!confirmed) return;
    state.shuttingDown = true;
    clearTimeout(state.pollTimer);
    clearTimeout(state.chartTimer);
    clearTimeout(state.phaseTimer);
    clearTimeout(state.positionTimer);
    clearInterval(state.stateTimer);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      await fetch('/api/shutdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
        signal: controller.signal,
      });
    } catch (error) {
      // 进程可能在响应完全读取前退出；忽略网络错误。
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 550));
    showShutdownScreen();
  }

  /* ======================================================================
   * 8.6 外壳：菜单栏 / 左侧网络栏 / 顶部信息条（R08）
   * ==================================================================== */

  const SHELL_KEYS = {
    netWidth: 'netlab.networks.width',
    netCollapsed: 'netlab.networks.collapsed',
    panelCollapsed: 'netlab.panel.collapsed',
    panelWidth: 'netlab.panel.width',
    femPanelWidth: 'netlab.panel.width.fem',
  };

  function menuDefinition() {
    return [
      {
        label: '文件',
        items: [
          { label: '新建工程', hint: '替换当前场景（未保存会提示）', action: () => void newProject() },
          { label: '打开工程…', action: () => void openProject() },
          { label: '保存工程', action: () => void saveProject(false) },
          { label: '另存为…', action: () => void saveProject(true) },
          { sep: true },
          { label: '恢复自动保存', action: () => void recoverAutosave() },
          { label: '导出场景 JSON', hint: 'Ctrl+Shift+E（下一票）', action: () => void exportScene() },
          { sep: true },
          { label: '退出服务', action: () => void shutdownApp() },
        ],
      },
      {
        label: '编辑',
        items: [
          { label: '撤销', hint: 'Ctrl+Z（100 步）', action: () => void undo() },
          { label: '重做', hint: 'Ctrl+Shift+Z', action: () => void redo() },
          { sep: true },
          { label: '复制', hint: 'Ctrl+C', action: () => copySelection(false) },
          { label: '剪切', hint: 'Ctrl+X', action: () => copySelection(true) },
          { label: '粘贴', hint: 'Ctrl+V（跨网络需确认）', action: () => void pasteClipboard() },
          { label: '全选', hint: 'Ctrl+A', action: () => selectAll() },
          { sep: true },
          { label: '删除选中', hint: 'Delete', action: () => void deleteSelection() },
          { label: '批量设置尺寸…', hint: '多选节点/器件后统一宽或直径', action: () => void batchResizeSelection() },
          { label: '清空场景', action: () => void clearScene() },
        ],
      },
      {
        label: '视图',
        items: [
          { label: '适配视图', action: () => fitView(true) },
          { label: '放大', action: () => zoomCenter(1.2) },
          { label: '缩小', action: () => zoomCenter(1 / 1.2) },
          { label: '自动布局', action: () => void autoLayout() },
          { label: '切换网格吸附', hint: 'Alt 拖动可临时暂停', action: () => toggleSnap() },
          { label: '切换符号风格', hint: '经典圆形 / GB 矩形（工程级）', action: () => toggleSymbol() },
          { label: '显示 / 隐藏引脚名', hint: '器件框引脚标注', action: () => {
            state.ui.showPins = state.ui.showPins === false;
            requestDraw();
          } },
          { sep: true },
          { label: '收起 / 展开左侧网络栏', action: () => toggleNetworks() },
          { label: '收起 / 展开右侧面板', action: () => togglePanel() },
          { label: '切换到有限元场', action: () => void switchWorkspace('fem') },
        ],
      },
      {
        label: '工程 · 网络',
        items: [
          { label: '新建网络', action: () => void addNetwork() },
          { label: '重命名当前网络…', action: () => void renameNetwork() },
          { label: '删除当前网络…', action: () => void deleteNetwork() },
          { sep: true },
          { label: '刷新网络列表', action: () => void fetchNetworks(false) },
          { label: '工程文件位置', hint: '当前保存路径', action: () => {
            const path = state.project.path || '尚未保存：文件菜单可用「保存工程」落盘';
            toast(path, 'info', 5000);
          } },
        ],
      },
      {
        label: '仿真',
        items: [
          { label: '运行 / 暂停', hint: '空格', action: () => void control('toggle') },
          { label: '单步', hint: 'S', action: () => void control('step') },
          { label: '时间归零', hint: '只归零计时与录制，不清状态', action: () => void control('zero') },
          { label: '重置', hint: '清除状态与时间', action: () => void control('reset') },
        ],
      },
      {
        label: '分析',
        items: [
          { label: '分析面板', action: () => switchTab('analysis') },
          { label: '导出 CSV', action: () => void exportAnalysisCsv() },
        ],
      },
      {
        label: '工具',
        items: [
          { label: '全局搜索…', hint: 'Ctrl+K / R14', action: () => openDocSearch() },
          { sep: true },
          { label: '节点函数', action: () => switchTab('node-fn') },
          { label: '连接函数', action: () => switchTab('edge-fn') },
          { label: '模块与扩展', action: () => switchTab('blocks') },
          { sep: true },
          { label: '性能面板', action: () => switchTab('analysis') },
          { label: '迁移场景为器件模型（R20）', hint: '元件边 → 器件节点 + 引脚导线', action: () => void migrateSceneToDevices() },
          { label: '新建连线（选择端点）…', hint: '网络↔网络纯导线 / 器件引脚↔网络', action: () => openWireDialog() },
        ],
      },
      {
        label: '设置',
        items: [
          { label: '工程设置…', hint: '工作模式 / 模板 / 文件 / 画布网格', action: () => openSettings('project') },
          { label: '视图与外观…', hint: '主题 / 强调色 / 动效 / 性能', action: () => openSettings('view') },
          { label: '交互与文档…', hint: '启动引导 / 自动保存 / 快捷键', action: () => openSettings('interact') },
          { sep: true },
          { label: '重新打开引导页', action: () => showGuide(true) },
          { label: '自动保存', hint: state.project.autosave ? '当前：开' : '当前：关', action: () => void saveAutosaveSetting({ autosave_enabled: !state.project.autosave }) },
        ],
      },
      {
        label: '帮助',
        items: [
          { label: '快速上手', action: () => openDoc('quickstart') },
          { label: '界面指南', action: () => openDoc('interface') },
          { label: '术语表', action: () => openDoc('glossary') },
          { label: '常见问题', action: () => openDoc('faq') },
          { label: '快捷键', hint: '?', action: () => openDoc('shortcuts') },
          { sep: true },
          { label: '文档中心（搜索）', hint: 'Ctrl+K', action: () => openDocSearch() },
          { label: '关于 Netlab', action: () => toast('Netlab · 拓扑网络 / 电路 / 热场仿真（本地运行）', 'info', 4000) },
        ],
      },
    ];
  }

  function closeMenus() {
    $$('.menu.open').forEach((node) => node.classList.remove('open'));
  }

  function initMenus() {
    const host = ui.menuItems;
    if (!host) return;
    host.replaceChildren();
    for (const menu of menuDefinition()) {
      const wrap = div('menu');
      const button = el('button', null, menu.label);
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.setAttribute('aria-haspopup', 'true');
      const panel = div('menu-panel');
      panel.setAttribute('role', 'menu');
      for (const item of menu.items) {
        if (item.sep) {
          panel.appendChild(div('menu-sep'));
          continue;
        }
        const entry = el('button', 'menu-item');
        entry.type = 'button';
        entry.disabled = Boolean(item.disabled);
        entry.appendChild(el('strong', null, item.label));
        if (item.hint) entry.appendChild(el('small', null, item.hint));
        entry.addEventListener('click', () => {
          closeMenus();
          if (!item.disabled) item.action();
        });
        panel.appendChild(entry);
      }
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const open = wrap.classList.contains('open');
        closeMenus();
        if (!open) wrap.classList.add('open');
      });
      wrap.append(button, panel);
      host.appendChild(wrap);
    }
    document.addEventListener('pointerdown', (event) => {
      if (!event.target.closest('.menu')) closeMenus();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenus();
    });
  }

  function setInfo(key, value) {
    if (!ui.infoBar) return;
    const node = ui.infoBar.querySelector(`[data-info="${key}"]`);
    if (node) node.textContent = value;
  }

  function updateInfoBar() {
    if (!ui.infoBar) return;
    const modeLabel = { signal: '信号流', circuit: '电路', vector: '矢量' }[state.mode] || state.mode || '—';
    const network = state.currentNetwork?.name || '网络 1';
    const total = state.networks?.length || 1;
    const sim = state.sim || {};
    setInfo('project', `${state.project.name || '未命名工程'}${state.project.dirty ? ' *' : ''}`);
    setInfo('network', total > 1 ? `${network} (${total})` : network);
    setInfo('mode', modeLabel);
    const nodes = state.scene?.nodes?.length || 0;
    const edges = state.scene?.edges?.length || 0;
    setInfo('counts', `节点 ${nodes} · 连线 ${edges}`);
    const dt = Number(sim.config?.dt ?? sim.dt ?? state.scene?.sim?.dt ?? 0);
    const dtMs = dt * 1000;
    const dtText = dt >= 1
      ? `${dt.toFixed(dt % 1 ? 2 : 0)} s`
      : `${dtMs >= 10 ? dtMs.toFixed(0) : dtMs >= 1 ? dtMs.toFixed(1) : dtMs.toFixed(2)} ms`;
    setInfo('dt', `dt ${dtText}`);
    setInfo('time', `t ${Number(sim.time || 0).toFixed(3)} s`);
    setInfo('steps', `step ${Number(sim.steps || 0)}`);
    const alerts = Number(sim.alerts ?? sim.warnings ?? 0) || 0;
    const alertNode = ui.infoBar.querySelector('[data-info="alerts"]');
    if (alertNode) {
      alertNode.textContent = `告警 ${alerts}`;
      alertNode.classList.toggle('has-alert', alerts > 0);
    }
    const run = ui.infoBar.querySelector('[data-info="run"]');
    if (run) {
      run.textContent = sim.running ? '运行中' : '停止';
      run.classList.toggle('stopped', !sim.running);
    }
  }

  async function fetchNetworks(silent = true) {
    try {
      const response = await jsonRequest('/api/networks', 'GET');
      state.networks = response.networks || [];
      state.currentNetwork = state.networks.find((item) => item.current) || state.networks[0] || null;
      renderNetworkList();
      updateInfoBar();
      return state.networks;
    } catch (error) {
      if (!silent) toast(`网络列表读取失败：${error.message}`, 'error', 4000);
      return state.networks;
    }
  }

  function renderNetworkList() {
    if (!ui.networkList) return;
    ui.networkList.replaceChildren();
    for (const network of state.networks || []) {
      const item = el('button', 'network-item');
      item.type = 'button';
      item.setAttribute('role', 'option');
      item.dataset.networkId = network.id;
      item.classList.toggle('current', Boolean(network.current));
      item.setAttribute('aria-selected', network.current ? 'true' : 'false');
      item.title = `${network.name} · ${network.mode} · ${network.nodes} 节点 / ${network.edges} 连接`;
      const dot = div('dot');
      const label = el('span', null, network.name);
      const meta = el('span', 'meta', network.nodes);
      item.append(dot, label, meta);
      item.addEventListener('click', () => void switchNetwork(network.id));
      item.addEventListener('dblclick', () => void renameNetwork(network.id));
      item.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        openNetworkMenu(network, event.clientX, event.clientY);
      });
      ui.networkList.appendChild(item);
    }
  }

  /* 网络列表右键菜单（R02 / D49-D50，P7-07）：把封装入口放到网络这一层 */
  function openNetworkMenu(network, x, y) {
    const isCurrent = Boolean(network.current);
    const picked = isCurrent ? multiSelection().nodes.size : 0;
    const tempModule = String(network.name || '').startsWith('模块 ');
    const moduleName = tempModule ? String(network.name).slice(3).trim() : '';
    const knownBlock = moduleName ? (state.blocks || []).find((block) => block.name === moduleName) : null;
    if (tempModule && !(state.blocks || []).length) void refreshBlocks();
    const items = [
      {
        label: '封装选中节点为模块…',
        hint: isCurrent
          ? (picked ? `已选 ${picked} 个节点` : '先在画布上 Ctrl+单击多选')
          : '先切换到该网络',
        disabled: !isCurrent || !picked,
        action: () => void encapsulateSelection(),
      },
      {
        label: '打开模块库',
        hint: '封装 / 实例化 / 打开内部',
        action: () => switchTab('blocks'),
      },
      { sep: true },
      {
        label: '在模块内部浮窗中打开',
        hint: knownBlock ? `预览「${moduleName}」内部` : tempModule ? '模块库里找不到同名模块' : '先切到模块内部临时网络',
        disabled: !knownBlock,
        action: () => {
          if (knownBlock) openModuleInternal(knownBlock.id);
        },
      },
      {
        label: '关闭模块内部临时网络',
        disabled: !tempModule,
        action: () => void closeInternalNetwork(),
      },
    ];
    showFloatingMenu(x, y, items, network.name);
  }

  /* 轻量浮层菜单：给右键 / 局部入口复用 */
  let floatingMenu = null;

  function closeFloatingMenu() {
    if (!floatingMenu) return;
    floatingMenu.remove();
    floatingMenu = null;
  }

  function showFloatingMenu(x, y, items, title = '') {
    closeFloatingMenu();
    const box = div('ctxmenu');
    box.setAttribute('role', 'menu');
    if (title) box.appendChild(div('ctxmenu-title', title));
    for (const item of items) {
      if (item.sep) {
        box.appendChild(div('menu-sep'));
        continue;
      }
      const entry = el('button', 'menu-item');
      entry.type = 'button';
      entry.disabled = Boolean(item.disabled);
      entry.appendChild(el('strong', null, item.label));
      if (item.hint) entry.appendChild(el('small', null, item.hint));
      entry.addEventListener('click', () => {
        closeFloatingMenu();
        if (!item.disabled) item.action();
      });
      box.appendChild(entry);
    }
    document.body.appendChild(box);
    const rect = box.getBoundingClientRect();
    box.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    box.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    floatingMenu = box;
    return box;
  }

  function initFloatingMenu() {
    document.addEventListener('pointerdown', (event) => {
      if (!floatingMenu) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('.ctxmenu')) closeFloatingMenu();
    }, true);
    window.addEventListener('blur', () => closeFloatingMenu());
    window.addEventListener('resize', () => closeFloatingMenu());
  }

  async function switchNetwork(networkId) {
    if (!networkId || networkId === state.currentNetwork?.id) return;
    const response = await task(() =>
      jsonRequest(`/api/networks/${encodeURIComponent(networkId)}/activate`, 'POST', {}),
    );
    if (!response || !response.scene) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    state.inspectorDirty = false;
    state.frames = [];
    state.values.clear();
    state.nodeValues.clear();
    state.edgeValues.clear();
    applySnapshot({ scene: response.scene, sim: response.sim, limits: state.limits });
    state.cursor = Number(response.sim?.cursor || 0);
    await fetchNetworks();
    renderInspector();
    fitView();
    toast(`已切换到网络：${state.currentNetwork?.name || networkId}`, 'ok', 2200);
  }

  async function addNetwork() {
    const response = await task(() => jsonRequest('/api/networks', 'POST', {}));
    if (!response) return;
    await fetchNetworks();
    toast('已新建网络（自动命名，可双击改名）', 'ok', 2600);
  }

  async function renameNetwork(networkId = state.currentNetwork?.id) {
    if (!networkId) return;
    const item = (state.networks || []).find((network) => network.id === networkId);
    const proposed = window.prompt('网络名称（最长 60 字）', item?.name || '');
    if (proposed === null) return;
    const response = await task(() =>
      jsonRequest(`/api/networks/${encodeURIComponent(networkId)}`, 'PATCH', { name: proposed }),
    );
    if (!response) return;
    await fetchNetworks();
    toast(`网络已改名：${response.name}`, 'ok', 2200);
  }

  async function deleteNetwork() {
    const network = state.currentNetwork;
    if (!network) return;
    if ((state.networks || []).length <= 1) {
      toast('工程至少需要保留一个网络', 'error', 3200);
      return;
    }
    const confirmed = await confirmModal(
      `删除网络「${network.name}」？`,
      '该网络的节点与连接会一并删除；工程正本仍可用「保存工程」覆盖。',
      '删除',
      true,
    );
    if (!confirmed) return;
    const response = await task(() =>
      jsonRequest(`/api/networks/${encodeURIComponent(network.id)}`, 'DELETE'),
    );
    if (!response) return;
    await fetchNetworks();
    const snapshot = await api('/api/state');
    applySnapshot(snapshot);
    toast('网络已删除', 'ok', 2200);
  }

  // 挂耳位置跟随侧栏真实宽度：媒体查询会改列宽，只靠 CSS 里的默认值会偏出侧栏
  function syncChromeEdges() {
    if (!ui.main) return;
    if (ui.networks && !ui.main.classList.contains('net-hidden')) {
      const netWidth = Math.round(ui.networks.getBoundingClientRect().width);
      if (netWidth > 0) ui.main.style.setProperty('--net-edge', `${netWidth}px`);
    }
    if (ui.panel && !ui.main.classList.contains('panel-hidden')) {
      const panelWidth = Math.round(ui.panel.getBoundingClientRect().width);
      if (panelWidth > 0) ui.main.style.setProperty('--panel-edge', `${panelWidth}px`);
    }
  }

  function applyNetCollapsed(collapsed) {
    ui.main.classList.toggle('net-hidden', collapsed);
    if (ui.netHanger) {
      ui.netHanger.textContent = collapsed ? '›' : '‹';
      ui.netHanger.title = collapsed ? '展开网络栏' : '收起网络栏';
      ui.netHanger.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
    try {
      localStorage.setItem(SHELL_KEYS.netCollapsed, collapsed ? '1' : '0');
    } catch (error) {
      // 隐私模式忽略
    }
    setTimeout(() => {
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      schedulePhaseDraw();
    }, 60);
  }

  function toggleNetworks() {
    applyNetCollapsed(!ui.main.classList.contains('net-hidden'));
  }

  function initNetworkSidebar() {
    if (!ui.networkList) return;
    let width = 0;
    let collapsed = false;
    try {
      width = Number(localStorage.getItem(SHELL_KEYS.netWidth)) || 0;
      collapsed = localStorage.getItem(SHELL_KEYS.netCollapsed) === '1';
    } catch (error) {
      width = 0;
    }
    if (width >= 140 && width <= 360) {
      ui.main.style.setProperty('--net-w', `${Math.round(width)}px`);
    }
    applyNetCollapsed(collapsed);

    ui.netHanger?.addEventListener('click', toggleNetworks);
    ui.netAdd?.addEventListener('click', () => void addNetwork());
    ui.netRename?.addEventListener('click', () => void renameNetwork());
    ui.netDelete?.addEventListener('click', () => void deleteNetwork());

    const handle = ui.netResize;
    if (!handle) return;
    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    const currentWidth = () => {
      const rect = ui.networks?.getBoundingClientRect();
      if (rect && rect.width > 0) return rect.width;
      const value = parseFloat(getComputedStyle(ui.main).getPropertyValue('--net-w'));
      return Number.isFinite(value) ? value : 172;
    };
    handle.addEventListener('pointerdown', (event) => {
      dragging = true;
      startX = event.clientX;
      startWidth = currentWidth();
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add('net-dragging');
      event.preventDefault();
    });
    handle.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const next = clamp(Math.round(startWidth + event.clientX - startX), 140, 360);
      ui.main.style.setProperty('--net-w', `${next}px`);
      ui.main.style.setProperty('--net-edge', `${next}px`);
    });
    const finish = (event) => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('net-dragging');
      try {
        localStorage.setItem(SHELL_KEYS.netWidth, String(Math.round(currentWidth())));
      } catch (error) {
        // 忽略
      }
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      schedulePhaseDraw();
      if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  async function snapSceneToGrid() {
    const grid = Number(state.ui.grid) || 20;
    const snapValue = (value) => Math.round(value / grid) * grid;
    const nodes = (state.scene?.nodes || []).filter((node) => {
      const x = Number(node.position?.x || 0);
      const y = Number(node.position?.y || 0);
      return snapValue(x) !== Math.round(x) || snapValue(y) !== Math.round(y);
    });
    const edges = (state.scene?.edges || []).filter((edge) =>
      (edge.waypoints || []).some((point) => snapValue(point.x) !== Math.round(point.x) || snapValue(point.y) !== Math.round(point.y)),
    );
    if (!nodes.length && !edges.length) {
      toast('所有节点与拐点已在网格上', 'info', 2200);
      return;
    }
    await pushUndoSnapshot();
    for (const node of nodes) {
      const position = { x: snapValue(Number(node.position.x) || 0), y: snapValue(Number(node.position.y) || 0) };
      await task(() => jsonRequest(`/api/nodes/${encodeURIComponent(node.id)}`, 'PATCH', { position }), { history: false });
    }
    for (const edge of edges) {
      const waypoints = (edge.waypoints || []).map((point) => ({ x: snapValue(point.x), y: snapValue(point.y) }));
      await task(() => jsonRequest(`/api/edges/${encodeURIComponent(edge.id)}`, 'PATCH', { waypoints }), { history: false });
    }
    await refreshState(true);
    toast(`已整理 ${nodes.length} 个节点、${edges.length} 条连线到 ${grid} 网格`, 'ok', 2600);
  }

  function toggleSnap() {
    state.ui.snap = !state.ui.snap;
    toast(`网格吸附已${state.ui.snap ? '开启' : '关闭'}（Alt 临时暂停）`, 'info', 2400);
    markProjectDirty();
  }

  function toggleSymbol() {
    state.ui.symbol = state.ui.symbol === 'gb' ? 'classic' : 'gb';
    requestDraw();
    markProjectDirty();
    toast(`符号风格：${state.ui.symbol === 'gb' ? 'GB 矩形' : '经典圆形'}（仅本工程）`, 'info', 2600);
  }

  function applyProjectUi(uiSettings) {
    if (!uiSettings || typeof uiSettings !== 'object') return;
    if (uiSettings.grid && typeof uiSettings.grid === 'object') {
      if (typeof uiSettings.grid.snap === 'boolean') state.ui.snap = uiSettings.grid.snap;
      if (typeof uiSettings.grid.show === 'boolean') state.ui.showGrid = uiSettings.grid.show;
      if (typeof uiSettings.grid.markers === 'boolean') state.ui.snapMarkers = uiSettings.grid.markers;
      if (typeof uiSettings.grid.orthogonal === 'boolean') state.ui.circuitOrthogonal = uiSettings.grid.orthogonal;
      const size = Number(uiSettings.grid.size);
      if (Number.isFinite(size) && size >= 5 && size <= 80) state.ui.grid = size;
    }
    if (uiSettings.symbol === 'gb' || uiSettings.symbol === 'classic') {
      state.ui.symbol = uiSettings.symbol;
    }
    if (['circle', 'dot', 'box'].includes(uiSettings.nodeStyle)) state.ui.nodeStyle = uiSettings.nodeStyle;
    if (typeof uiSettings.drawingMode === 'boolean') state.ui.drawingMode = uiSettings.drawingMode;
    if (Number.isFinite(Number(uiSettings.symbolScale))) state.ui.symbolScale = clamp(Number(uiSettings.symbolScale), 0.6, 2.5);
    if (typeof uiSettings.glyphColor === 'string') state.ui.glyphColor = uiSettings.glyphColor;
    requestDraw();
  }

  /* ======================================================================
   * 8.7 模块库面板（R02：封装 / 实例化 / 导入）
   * ==================================================================== */

  function blockBadges(spec) {
    return [
      spec.mode,
      spec.model || 'behavioral',
      `v${spec.version}`,
      `${spec.node_count} 节点`,
      `${(spec.inputs || []).length} 入 / ${(spec.outputs || []).length} 出`,
    ];
  }

  async function refreshBlocks() {
    const response = await task(() => jsonRequest('/api/blocks', 'GET'), { dirty: false });
    if (!response) return;
    state.blocks = response.blocks || [];
    state.blocksLibrary = response.library || '';
    renderBlocksPanel();
  }

  async function instantiateBlockFromLibrary(blockId) {
    const place = centerPlacement();
    const response = await task(() =>
      jsonRequest('/api/blocks/instantiate', 'POST', {
        block_id: blockId,
        position: { x: Math.round(place.x), y: Math.round(place.y) },
      }),
    );
    if (!response) return;
    applySnapshot(response);
    await refreshBlocks();
    if (response.instance?.block_node) {
      await selectEntity('node', response.instance.block_node, true);
      switchTab('inspect');
    }
    toast('模块已实例化到画布', 'ok', 2400);
  }

  async function encapsulateSelection() {
    const liveNodes = new Set((state.scene?.nodes || []).map((node) => node.id));
    const picked = [...multiSelection().nodes];
    const nodes = picked.filter((id) => liveNodes.has(id));
    if (picked.length && !nodes.length) {
      // 画布和服务端场景不同步（后端重启、另一个窗口改过场景）：先同步再让用户重选。
      await refreshState(false);
      toast('画布已过期（节点已不在当前场景），已刷新，请重新选择要封装的节点', 'error', 5200);
      return;
    }
    if (!nodes.length) {
      toast('先在画布上选中要封装的节点（Ctrl+单击多选）', 'info', 3200);
      return;
    }
    const proposed = window.prompt('模块名称（最长 32 字）', '模块');
    if (proposed === null) return;
    let response = null;
    try {
      response = await jsonRequest('/api/blocks/encapsulate', 'POST', {
        node_ids: nodes,
        name: proposed,
        model: state.blocksStructural ? 'structural' : 'behavioral',
      });
    } catch (error) {
      await refreshState(false);
      toast(`封装失败：${error.message || error}`, 'error', 6000);
      return;
    }
    if (!response) return;
    applySnapshot({ scene: response.scene, sim: response.sim, limits: state.limits });
    state.multi.nodes.clear();
    state.multi.edges.clear();
    clearSelection();
    await refreshBlocks();
    toast(`已封装为模块「${response.block.name}」并写入库`, 'ok', 3000);
  }

  async function retryDegradedProject() {
    const response = await task(() => jsonRequest('/api/project/retry', 'POST', {}));
    if (!response) return;
    applySnapshot({ scene: response.scene, sim: response.sim, limits: state.limits });
    if (response.degraded) {
      toast('库文件仍缺失，已保持降级只读', 'error', 3200);
    } else {
      toast('已解除降级只读，可以运行', 'ok', 2800);
    }
    await refreshBlocks();
  }

  async function closeInternalNetwork() {
    const network = state.currentNetwork;
    if (!network || !String(network.name || '').startsWith('模块 ')) {
      toast('当前网络不是模块内部临时网络', 'info', 2600);
      return;
    }
    await deleteNetwork();
    await refreshBlocks();
  }

  function initBlockDragDrop() {
    const graph = ui.graph;
    if (!graph) return;
    graph.addEventListener('dragover', (event) => {
      if (!event.dataTransfer || !event.dataTransfer.types.includes('text/netlab-block')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    graph.addEventListener('drop', async (event) => {
      const blockId = event.dataTransfer?.getData('text/netlab-block');
      if (!blockId) return;
      event.preventDefault();
      const rect = graph.getBoundingClientRect();
      const world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      const response = await task(() =>
        jsonRequest('/api/blocks/instantiate', 'POST', {
          block_id: blockId,
          position: { x: Math.round(world.x), y: Math.round(world.y) },
        }),
      );
      if (!response) return;
      applySnapshot(response);
      if (response.instance?.block_node) {
        await selectEntity('node', response.instance.block_node, true);
      }
      toast('模块已拖入画布并实例化', 'ok', 2400);
    });
  }

  async function openBlockInternal(blockId) {
    const response = await task(() =>
      jsonRequest(`/api/blocks/${encodeURIComponent(blockId)}/open-internal`, 'POST', {}),
    );
    if (!response) return false;
    applySnapshot({ scene: response.scene, sim: response.sim, limits: state.limits });
    await fetchNetworks();
    fitView();
    toast('已在临时网络中打开模块内部', 'ok', 3000);
    return true;
  }

  /* 8.7b 模块内部浮窗（R02 / D50，P7-07）：只读预览，不切换当前网络 */
  const MODULE_DIR_GLYPH = { input: '→', output: '←', inout: '↔' };
  const MODULE_DIR_LABEL = { input: '输入', output: '输出', inout: '双向' };
  // 网络节点右键盘口方向三选一（D49：方向只决定引脚画在哪一侧）。
  const PORT_DIRECTION_CHOICES = [
    ['input', '输入', '引脚画在模块左侧，表示从外部流进来'],
    ['output', '输出', '引脚画在模块右侧，表示向外流出'],
    ['inout', '双向', '电气网络默认，两侧都可接线，也可当测试点'],
  ];

  // 模块库卡片上的端口摘要：电路模块按方向分组，信号块仍是「入 → 出」。
  function describeBlockPorts(spec) {
    const ports = Array.isArray(spec?.ports) ? spec.ports : [];
    if (String(spec?.mode || '') === 'circuit' && ports.length) {
      const grouped = { input: [], output: [], inout: [] };
      for (const port of ports) {
        const bucket = grouped[port.direction] || grouped.inout;
        bucket.push(port.name);
      }
      const parts = [];
      for (const key of ['input', 'output', 'inout']) {
        if (grouped[key].length) parts.push(`${MODULE_DIR_LABEL[key]} ${grouped[key].join('/')}`);
      }
      return parts.join('   ') || '无端口';
    }
    const inputs = (spec?.inputs || []).map((port) => port.name).join(', ') || '—';
    const outputs = (spec?.outputs || []).map((port) => port.name).join(', ') || '—';
    return `${inputs} → ${outputs}`;
  }

  function modulePortList(block) {
    return (block?.ports || []).map((port) => ({
      name: String(port.name || 'port'),
      direction: String(port.direction || (port.dtype === 'electrical' ? 'inout' : 'input')),
      dtype: String(port.dtype || ''),
      net: String(port.net || ''),
    }));
  }

  function renderModuleSide(block) {
    const side = ui.modulePorts;
    if (side) {
      side.replaceChildren();
      const ports = modulePortList(block);
      side.appendChild(el('h4', null, `端口（${ports.length}）`));
      if (!ports.length) side.appendChild(div('help', '这个模块没有端口。'));
      for (const port of ports) {
        const row = div('port-row');
        row.appendChild(el('span', 'port-dir', MODULE_DIR_GLYPH[port.direction] || '·'));
        const name = el('span', 'port-name', port.name);
        name.title = `${port.name} · ${port.direction}${port.net ? ` · ${port.net}` : ''}`;
        row.appendChild(name);
        row.appendChild(el('span', 'badge gray', port.dtype === 'electrical' ? '电气' : '信号'));
        side.appendChild(row);
      }
    }
    const meta = ui.moduleMeta;
    if (meta) {
      meta.replaceChildren();
      const rows = [
        ['节点', String((block?.nodes || []).length)],
        ['连线', String((block?.edges || []).length)],
        ['端口', String((block?.ports || []).length)],
        ['版本', `v${Number(block?.version || 1)}`],
        ['模型', block?.model === 'structural' ? '结构' : '行为'],
      ];
      for (const [key, value] of rows) {
        meta.appendChild(el('span', null, key));
        meta.appendChild(el('b', null, value));
      }
    }
  }

  function drawModulePreview() {
    const canvas = ui.moduleCanvas;
    const block = state.moduleBlock;
    const stage = ui.moduleStage;
    if (!canvas || !stage || !block) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const box = stage.getBoundingClientRect();
    const width = Math.round(box.width);
    const height = Math.round(box.height);
    if (width < 20 || height < 20) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = C('#faf8f2');
    ctx.fillRect(0, 0, width, height);

    const nodes = (block.nodes || []).map((node) => ({
      id: String(node.id || ''),
      label: String(node.params?.port_name || node.name || node.label || node.kind || node.id || '?'),
      kind: String(node.kind || ''),
      x: Number(node.position?.x ?? node.x ?? 0),
      y: Number(node.position?.y ?? node.y ?? 0),
    }));
    const isEmpty = !nodes.length;
    if (ui.moduleEmpty) ui.moduleEmpty.hidden = !isEmpty;
    canvas.hidden = isEmpty;
    if (isEmpty) return;

    const portNets = new Set(modulePortList(block).map((port) => port.net).filter(Boolean));
    const xs = nodes.map((node) => node.x);
    const ys = nodes.map((node) => node.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = 34;
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY, 1.15);
    const offsetX = (width - spanX * scale) / 2 - minX * scale;
    const offsetY = (height - spanY * scale) / 2 - minY * scale;
    const project = (node) => ({ x: node.x * scale + offsetX, y: node.y * scale + offsetY });
    const byId = new Map(nodes.map((node) => [node.id, node]));

    ctx.strokeStyle = C('#ded7c8');
    ctx.lineWidth = 1;
    for (const edge of block.edges || []) {
      const source = byId.get(String(edge.source || ''));
      const target = byId.get(String(edge.target || ''));
      if (!source || !target) continue;
      const a = project(source);
      const b = project(target);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    ctx.font = '10px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const node of nodes) {
      const point = project(node);
      const isPort = portNets.has(node.id);
      const isGround = node.kind === 'ground';
      const isDevice = node.kind === 'device';
      const text = node.label.length > 12 ? `${node.label.slice(0, 11)}…` : node.label;
      const w = Math.max(54, Math.round(ctx.measureText(text).width) + 18);
      const h = 22;
      // 端口 > 接地 > 器件 > 普通网络，四档配色让内部结构一眼分清
      const fill = isPort ? '#fdf3e4' : isGround ? '#eaf3e8' : isDevice ? '#eef1f6' : '#ffffff';
      const stroke = isPort ? '#c07a1c' : isGround ? '#4f8a4a' : isDevice ? '#7f8b9e' : '#cfc8b8';
      const ink = isPort ? '#8a5310' : isGround ? '#2f5a2b' : isDevice ? '#38414f' : '#3b3830';
      ctx.beginPath();
      ctx.rect(point.x - w / 2, point.y - h / 2, w, h);
      ctx.fillStyle = C(fill);
      ctx.fill();
      ctx.strokeStyle = C(stroke);
      ctx.lineWidth = isPort ? 1.6 : 1;
      ctx.stroke();
      ctx.fillStyle = C(ink);
      ctx.fillText(text, point.x, point.y);
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = C('#969083');
    ctx.font = '9.5px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText(`只读预览 · ${block.name || block.id} · ${nodes.length} 节点 / ${(block.edges || []).length} 连线`, 12, height - 12);
  }

  function layoutModuleWindow() {
    if (!ui.moduleWin) return;
    ui.moduleWin.classList.toggle('docked', Boolean(state.moduleDock));
    if (ui.moduleDock) ui.moduleDock.classList.toggle('on', Boolean(state.moduleDock));
  }

  function openModuleInternal(blockId, block) {
    const run = async () => {
      let target = block;
      if (!target) {
        const response = await task(
          () => jsonRequest(`/api/blocks/${encodeURIComponent(blockId)}`, 'GET'),
          { dirty: false },
        );
        if (!response?.block) return;
        target = response.block;
      }
      state.moduleBlock = target;
      if (ui.moduleWinTitle) ui.moduleWinTitle.textContent = target.name || target.id || '模块内部';
      if (ui.moduleWinHint) {
        ui.moduleWinHint.textContent = `MODULE · ${(target.nodes || []).length} 节点 · v${Number(target.version || 1)}`;
      }
      renderModuleSide(target);
      ui.moduleWin.hidden = false;
      layoutModuleWindow();
      if (!state.moduleDock) {
        placeFloatWindow(ui.moduleWin, 'moduleGeo');
        raiseFloatWindow(ui.moduleWin);
      }
      requestAnimationFrame(() => drawModulePreview());
    };
    void run();
  }

  function closeModuleInternal() {
    if (!ui.moduleWin || ui.moduleWin.hidden) return;
    ui.moduleWin.hidden = true;
    toast('已关闭模块内部视图', 'info', 1800);
  }

  function toggleModuleDock() {
    if (!ui.moduleWin) return;
    state.moduleDock = !state.moduleDock;
    layoutModuleWindow();
    if (state.moduleDock) {
      ui.moduleWin.hidden = false;
      ui.moduleWin.classList.remove('moved');
      ui.moduleWin.style.left = '';
      ui.moduleWin.style.top = '';
      ui.moduleWin.style.width = '';
      ui.moduleWin.style.height = '';
      requestAnimationFrame(() => drawModulePreview());
    } else {
      placeFloatWindow(ui.moduleWin, 'moduleGeo');
      raiseFloatWindow(ui.moduleWin);
      requestAnimationFrame(() => drawModulePreview());
    }
  }

  function initModuleWindow() {
    if (!ui.moduleWin) return;
    initFloatWindow(ui.moduleWin, 'moduleGeo', { minWidth: 520, minHeight: 340 });
    ui.moduleWinClose?.addEventListener('click', () => closeModuleInternal());
    ui.moduleDock?.addEventListener('click', () => toggleModuleDock());
    ui.moduleEdit?.addEventListener('click', () => {
      const block = state.moduleBlock;
      if (!block?.id) return;
      // 打开成功才收窗：失败（例如内部网络缺接地）时保留预览，错误由 task 统一提示
      void openBlockInternal(block.id).then((ok) => {
        if (ok) closeModuleInternal();
      });
    });
    ui.moduleAddInstance?.addEventListener('click', () => {
      const block = state.moduleBlock;
      if (!block?.id) return;
      void instantiateBlockFromLibrary(block.id);
    });
    if (ui.moduleStage && typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => {
        if (!ui.moduleWin?.hidden) drawModulePreview();
      });
      observer.observe(ui.moduleStage);
    }
  }

  async function saveCurrentAsBlockCopy() {
    const proposed = window.prompt('副本模块名称（新 id，v1）', `${state.currentNetwork?.name || '模块'}-copy`);
    if (proposed === null) return;
    const response = await task(() =>
      jsonRequest('/api/blocks/save-copy', 'POST', { name: proposed }),
    );
    if (!response) return;
    await refreshBlocks();
    await fetchNetworks();
    toast(`已另存为模块副本「${response.block.name}」（id=${response.block.id}）`, 'ok', 3400);
  }

  async function importBlockFile() {
    const input = el('input');
    input.type = 'file';
    input.accept = '.block,application/json';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        // R04：先校验再导入；阻断级直接拒绝，警告级需确认。
        const report = await task(
          () => jsonRequest('/api/blocks/validate', 'POST', { payload }),
          { dirty: false },
        );
        if (!report) return;
        if (!report.ok) {
          const lines = (report.blocking || []).map((item) => `· [${item.code}] ${item.message}`);
          showBanner(`模块校验未通过：${lines.join('；')}`);
          toast('模块校验未通过，已阻止导入（报告见顶部横幅）', 'error', 6000);
          return;
        }
        if ((report.warnings || []).length) {
          const body = div('help');
          body.textContent = (report.warnings || [])
            .map((item) => `· [${item.code}] ${item.message}`)
            .join('；');
          const proceed = await confirmModal(
            `模块有 ${report.warnings.length} 条警告`,
            body,
            '仍然导入',
            false,
          );
          if (!proceed) return;
        }
        const response = await task(() =>
          jsonRequest('/api/blocks/import', 'POST', { payload }),
        );
        if (!response) return;
        await refreshBlocks();
        toast(`已导入模块 v${response.version}（干跑 ${report.summary?.dry_run || 'skipped'}）`, 'ok', 3000);
      } catch (error) {
        toast(`导入失败：${error.message}`, 'error', 5000);
      }
    });
    input.click();
  }


  /* ======================================================================
   * 8.8 分析面板（R12 / R13 / R17）：旁路分析，不写求解器
   * ==================================================================== */

  function analysisSignalKey() {
    if (state.chart.selected.size) return [...state.chart.selected][0];
    const keys = state.sim?.probe_keys || [];
    return keys[0] || '';
  }

  async function analysisGet(path, query) {
    const qs = query ? `?${new URLSearchParams(query)}` : '';
    return task(() => jsonRequest(`${path}${qs}`, 'GET'), { dirty: false });
  }

  function setAnalysisOutput(text) {
    state.analysisLast = text;
    const out = $('#analysisOut');
    if (out) out.textContent = text;
  }

  async function runAnalysisMetrics() {
    const key = analysisSignalKey();
    if (!key) return toast('还没有录制数据：先运行一段时间', 'info', 2600);
    const response = await analysisGet('/api/analysis/metrics', { keys: key });
    if (!response) return;
    const item = response.items?.[key];
    if (!item || item.ok === false) { setAnalysisOutput(JSON.stringify(item || response, null, 2)); return; }
    setAnalysisOutput(
      [
        `信号 ${key}（${item.samples} 点）`,
        `初值 ${fmt(item.initial, 5)} → 终值 ${fmt(item.final, 5)}`,
        `min ${fmt(item.min, 5)}  max ${fmt(item.max, 5)}  mean ${fmt(item.mean, 5)}  rms ${fmt(item.rms, 5)}`,
        `超调 ${fmt(item.overshoot_pct, 2)}%   上升时间 ${item.rise_time == null ? '—' : fmt(item.rise_time, 5) + ' s'}`,
        `调节时间(±${item.settle_band_pct}%) ${item.settling_time == null ? '—' : fmt(item.settling_time, 5) + ' s'}`,
        `来源：${item.source}`,
        `耗时 ${response.elapsed_ms ?? '?'} ms`,
      ].join('\n'),
    );
  }

  async function runAnalysisSpectrum() {
    const key = analysisSignalKey();
    if (!key) return toast('还没有录制数据：先运行一段时间', 'info', 2600);
    const response = await analysisGet('/api/analysis/spectrum', { key });
    if (!response) return;
    state.analysisSpectrum = response;
    const peaks = (response.peaks || []).map((p) => `${fmt(p.freq, 3)} Hz  |X|=${fmt(p.magnitude, 4)}`).join('\n');
    setAnalysisOutput([`FFT（${response.window} 窗，dt=${fmt(response.dt, 5)} s）`, peaks, `来源：${response.source}`].join('\n'));
    drawAnalysisSpectrum();
  }

  async function runAnalysisPeriod() {
    const key = analysisSignalKey();
    if (!key) return toast('还没有录制数据：先运行一段时间', 'info', 2600);
    const response = await analysisGet('/api/analysis/period', { key });
    if (!response) return;
    if (!response.ok) { setAnalysisOutput(`周期推荐：失败\n原因：${response.reason}\n诊断：${response.diagnosis}`); return; }
    const lines = [`周期推荐：T ≈ ${fmt(response.period, 5)} s（score ${fmt(response.score, 3)}，${fmt(response.cycles, 2)} 个周期）`];
    for (const item of response.candidates || []) lines.push(`  候选 ${fmt(item.period, 5)} s  score ${fmt(item.score, 3)}`);
    lines.push(`诊断：${response.diagnosis}`);
    lines.push(`来源：${response.source}`);
    setAnalysisOutput(lines.join('\n'));
  }

  async function runAnalysisMath() {
    const response = await analysisGet('/api/analysis/math');
    if (!response) return;
    const lines = (response.rows || []).map((row) => `${row.name} (${row.kind})\n  ${row.formula || '（无公式）'}`);
    setAnalysisOutput([`数学形式（${(response.rows || []).length} 个节点）`, ...lines, `来源：${response.source}`].join('\n'));
  }

  async function runAnalysisTransfer() {
    const input = $('#analysisInputNode')?.value?.trim();
    const output = $('#analysisOutputNode')?.value?.trim();
    if (!input || !output) return toast('填写输入/输出节点名', 'info', 2400);
    const response = await analysisGet('/api/analysis/transfer', { input, output });
    if (!response) return;
    if (!response.ok) { setAnalysisOutput(`传递函数：无法解析\n原因：${response.reason}`); return; }
    setAnalysisOutput(
      [`H(s) = ${response.expression}`, `阶数 ${response.order}`, ...(response.assumptions || []).map((item) => `假设：${item}`), `来源：${response.source}`].join('\n'),
    );
  }

  async function exportAnalysisCsv() {
    const name = window.prompt('CSV 文件名（写入 exports/，同名自动加序号）', 'analysis');
    if (name === null) return;
    const key = analysisSignalKey();
    const response = await task(() =>
      jsonRequest('/api/analysis/export', 'POST', { name: name || 'analysis', keys: key ? [key] : null, decimate: 1 }),
    );
    if (!response) return;
    setAnalysisOutput(`已导出 ${response.rows} 行 → ${response.path}\n列：${(response.columns || []).join(', ')}`);
    toast(`CSV 已写入 ${response.path}`, 'ok', 3400);
  }

  function drawAnalysisSpectrum() {
    const canvas = $('#analysisChart');
    const data = state.analysisSpectrum;
    if (!canvas || !data) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 150;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const mags = data.magnitude || [];
    const freqs = data.freqs || [];
    if (!mags.length) return;
    const peak = Math.max(...mags.filter((v) => Number.isFinite(v)), 1e-12);
    const n = Math.min(mags.length, 400);
    const bw = width / n;
    for (let index = 0; index < n; index += 1) {
      const value = mags[index] / peak;
      const barH = Math.max(0, Math.min(1, value)) * (height - 18);
      ctx.fillStyle = index === 0 ? '#b09a78' : C('rgba(168, 84, 31, 0.55)');
      ctx.fillRect(index * bw, height - 14 - barH, Math.max(1, bw - 0.5), barH);
    }
    ctx.strokeStyle = 'rgba(104, 94, 78, 0.4)';
    ctx.beginPath();
    ctx.moveTo(0, height - 14.5);
    ctx.lineTo(width, height - 14.5);
    ctx.stroke();
    ctx.fillStyle = C('#7b7266');
    ctx.font = '9px "Cascadia Code", Consolas, monospace';
    ctx.fillText('0 Hz', 2, height - 3);
    const maxFreq = freqs.length ? freqs[Math.min(freqs.length - 1, 399)] : 0;
    ctx.fillText(`${fmt(maxFreq, 1)} Hz`, width - 44, height - 3);
  }

  function renderAnalysisPanel() {
    const pane = ui.analysisPane;
    if (!pane) return;
    const host = div('blocks-host');
    const head = div('insp-head');
    const title = div('insp-title');
    title.append(el('h2', null, '分析（旁路）'), el('p', null, '只读录制数据；结论带来源，不写求解器'));
    head.appendChild(title);
    host.appendChild(head);

    const keys = state.sim?.probe_keys || [];
    const signal = el('select', 'input');
    for (const key of keys) {
      const option = el('option', null, key);
      option.value = key;
      signal.appendChild(option);
    }
    const key = analysisSignalKey();
    if (key) signal.value = key;
    const keyRow = div('field-row');
    keyRow.append(el('label', null, '信号'), signal);
    host.appendChild(keyRow);

    const row = div('blocks-toolbar');
    row.append(
      button('指标', 'btn tiny primary', () => void runAnalysisMetrics()),
      button('频谱', 'btn tiny', () => void runAnalysisSpectrum()),
      button('周期', 'btn tiny', () => void runAnalysisPeriod()),
      button('数学形式', 'btn tiny', () => void runAnalysisMath()),
      button('导出 CSV', 'btn tiny', () => void exportAnalysisCsv()),
    );
    host.appendChild(row);

    const canvas = el('canvas', 'analysis-chart');
    canvas.id = 'analysisChart';
    host.appendChild(canvas);

    const transferRow = div('field-row');
    const inputNode = el('input', 'input');
    inputNode.id = 'analysisInputNode';
    inputNode.placeholder = '输入节点名';
    inputNode.value = state.scene?.nodes?.[0]?.name || '';
    const outputNode = el('input', 'input');
    outputNode.id = 'analysisOutputNode';
    outputNode.placeholder = '输出节点名';
    outputNode.value = state.scene?.nodes?.[state.scene.nodes.length - 1]?.name || '';
    transferRow.append(el('label', null, '传递函数'), inputNode, outputNode, button('推导', 'btn tiny', () => void runAnalysisTransfer()));
    host.appendChild(transferRow);

    const out = el('pre', 'analysis-out');
    out.id = 'analysisOut';
    out.textContent = state.analysisLast || '选信号后运行指标/频谱/周期/数学形式；传递函数填节点名。';
    host.appendChild(out);

    const perf = div('insp-section');
    perf.appendChild(el('h3', null, '性能与超时（R13）'));
    const timeoutInput = el('input', 'input');
    timeoutInput.type = 'number';
    timeoutInput.id = 'analysisStepTimeout';
    timeoutInput.min = '0';
    timeoutInput.step = '0.5';
    timeoutInput.value = String(state.sim?.config?.step_timeout_ms ?? 0);
    const apply = button('应用单步上限', 'btn tiny', async () => {
      const response = await task(() => jsonRequest('/api/config', 'PATCH', { step_timeout_ms: Number(timeoutInput.value) || 0 }));
      if (response) toast('单步超时已更新（0=关闭）', 'ok', 2400);
    });
    const perfRow = div('field-row');
    perfRow.append(el('label', null, '单步上限 ms'), timeoutInput, apply);
    perf.appendChild(perfRow);
    const profileOut = el('pre', 'analysis-out');
    profileOut.id = 'analysisProfile';
    profileOut.textContent = '点击刷新读取 /api/profile（默认关闭，开销可忽略）';
    perf.appendChild(
      button('刷新性能', 'btn tiny', async () => {
        const response = await task(() => jsonRequest('/api/profile', 'GET'), { dirty: false });
        if (response) profileOut.textContent = JSON.stringify(response, null, 2).slice(0, 4000);
      }),
    );
    perf.appendChild(profileOut);
    host.appendChild(perf);

    pane.replaceChildren(host);
    if (state.analysisSpectrum) drawAnalysisSpectrum();
  }

  function renderBlocksPanel() {
    const pane = ui.blocksPane;
    if (!pane) return;
    const host = div('blocks-host');
    const head = div('insp-head');
    const title = div('insp-title');
    title.append(
      el('h2', null, '模块库'),
      el('p', null, state.blocksLibrary ? `库目录：${state.blocksLibrary}` : '库目录：默认 library/'),
    );
    head.appendChild(title);
    host.appendChild(head);

    const toolbar = div('blocks-toolbar');
    const structuralRow = el('label', 'switch-row');
    structuralRow.appendChild(el('span', null, '封装为结构模型（可看内部）'));
    const structuralInput = el('input');
    structuralInput.type = 'checkbox';
    structuralInput.checked = Boolean(state.blocksStructural);
    structuralInput.addEventListener('change', () => {
      state.blocksStructural = Boolean(structuralInput.checked);
    });
    structuralRow.appendChild(structuralInput);
    toolbar.append(
      button('刷新', 'btn tiny', () => void refreshBlocks()),
      button('导入 .block', 'btn tiny', () => void importBlockFile()),
      button('封装选中', 'btn tiny primary', () => void encapsulateSelection()),
      button('另存为副本', 'btn tiny', () => void saveCurrentAsBlockCopy()),
    );
    const closeBtn = button('关闭内部网络', 'btn tiny', () => void closeInternalNetwork());
    closeBtn.disabled = !String(state.currentNetwork?.name || '').startsWith('模块 ');
    closeBtn.title = closeBtn.disabled ? '当前不是模块内部临时网络' : '删除当前临时网络并返回上一层';
    toolbar.appendChild(closeBtn);
    if (state.sim?.degraded?.read_only) {
      toolbar.appendChild(button('补回后重试', 'btn tiny', () => void retryDegradedProject()));
    }
    host.appendChild(structuralRow);
    host.appendChild(toolbar);

    if (!state.blocks.length) {
      host.appendChild(
        div('help', '库中没有模块：选中画布节点后点「封装选中」，或用「导入 .block」载入已有模块。'),
      );
      pane.replaceChildren(host);
      return;
    }

    const list = div('block-list');
    for (const spec of state.blocks) {
      const item = div('block-item');
      const info = div('block-info');
      const name = el('strong', null, spec.name || spec.id);
      const badges = div('block-badges');
      for (const badge of blockBadges(spec)) badges.appendChild(el('span', 'badge gray', badge));
      info.append(name, badges);
      const ports = el('small', 'block-ports', describeBlockPorts(spec));
      info.appendChild(ports);
      item.draggable = true;
      item.addEventListener('dragstart', (event) => {
        if (!event.dataTransfer) return;
        event.dataTransfer.setData('text/netlab-block', spec.id);
        event.dataTransfer.effectAllowed = 'copy';
      });
      const actions = div('block-actions');
      actions.appendChild(button('实例化', 'btn tiny primary', () => void instantiateBlockFromLibrary(spec.id)));
      const openBtn = button('打开内部', 'btn tiny', () => openModuleInternal(spec.id));
      openBtn.title = (spec.model || 'behavioral') !== 'structural'
        ? '打开内部浮窗（行为模型只看得到端口）'
        : '在内部浮窗中预览模块结构';
      actions.appendChild(openBtn);
      const renameBtn = button('改名', 'btn tiny', () => void renameLibraryBlock(spec));
      renameBtn.title = '改模块名字（文件名同步改，引用不变）';
      actions.appendChild(renameBtn);
      const deleteBtn = button('删除', 'btn tiny danger', () => void deleteLibraryBlock(spec));
      deleteBtn.title = '从库里删掉这个模块文件';
      actions.appendChild(deleteBtn);
      item.append(info, actions);
      list.appendChild(item);
    }
    host.appendChild(list);
    host.appendChild(
      div('help', '模块文件位于 library/blocks/<模块名>.block：一个模块一个文件，文件名就是模块名；库中只保留最新版。'),
    );
    pane.replaceChildren(host);
  }

  function findBlockNameClash(name, ignoreId) {
    const wanted = String(name || '').trim().toLowerCase();
    if (!wanted) return null;
    return (
      state.blocks.find(
        (item) =>
          item.id !== ignoreId && String(item.name || '').trim().toLowerCase() === wanted,
      ) || null
    );
  }

  async function renameLibraryBlock(spec) {
    const proposed = window.prompt(`模块新名字（当前：${spec.name || spec.id}）`, spec.name || '');
    if (proposed === null) return;
    const name = proposed.trim();
    if (!name) {
      toast('模块名不能为空', 'error');
      return;
    }
    if (name === spec.name) return;
    const clash = findBlockNameClash(name, spec.id);
    if (clash) {
      toast(`模块名已存在：「${clash.name}」，请换一个名字`, 'error', 3600);
      return;
    }
    const run = async (force) => {
      const body = await jsonRequest(
        `/api/blocks/${encodeURIComponent(spec.id)}/rename`,
        'POST',
        { name, force },
      );
      return body;
    };
    try {
      try {
        await run(false);
      } catch (error) {
        const message = error?.message || String(error);
        if (!/引用|存在/.test(message)) throw error;
        if (!window.confirm(`${message}\n\n仍然改名？`)) return;
        await run(true);
      }
      await refreshBlocks();
      toast(`已改名为「${name}」`, 'ok');
    } catch (error) {
      toast(`改名失败：${error?.message || error}`, 'error', 4000);
    }
  }

  async function deleteLibraryBlock(spec) {
    if (
      !window.confirm(
        `删除模块「${spec.name || spec.id}」？\n库里对应的 .block 文件会被删除，已经放进画布的实例会变成缺失状态。`,
      )
    ) {
      return;
    }
    const run = async (force) => {
      const body = await jsonRequest(
        `/api/blocks/${encodeURIComponent(spec.id)}/delete`,
        'POST',
        { version: spec.version, force },
      );
      return body;
    };
    try {
      try {
        await run(false);
      } catch (error) {
        const message = error?.message || String(error);
        if (!/引用|存在/.test(message)) throw error;
        if (!window.confirm(`${message}\n\n仍然删除？`)) return;
        await run(true);
      }
      await refreshBlocks();
      toast(`已删除模块「${spec.name || spec.id}」`, 'ok');
    } catch (error) {
      toast(`删除失败：${error?.message || error}`, 'error', 4000);
    }
  }

  function initStatusToggles() {
    const bind = (id, key, label) => {
      const node = $(`#${id}`);
      if (!node) return;
      const sync = () => {
        const active = Boolean(state.ui?.[key]);
        node.classList.toggle('active', active);
        if (label) node.textContent = label(active);
      };
      node.addEventListener('click', () => {
        state.ui[key] = !state.ui[key];
        sync();
        markProjectDirty();
        requestDraw();
        toast(`${node.textContent}：${state.ui[key] ? '开' : '关'}`, 'info', 1600);
      });
      sync();
    };
    bind('stGrid', 'showGrid');
    bind('stSnap', 'snap');
    bind('stSnapMark', 'snapMarkers');
    bind('stOrtho', 'circuitOrthogonal');
    bind('stDrawing', 'drawingMode');
    const styleBtn = $('#stNodeStyle');
    if (styleBtn) {
      const labels = { circle: '节点·圆', dot: '节点·点', box: '节点·框' };
      const order = ['circle', 'dot', 'box'];
      const sync = () => { styleBtn.textContent = labels[state.ui.nodeStyle || 'circle']; };
      styleBtn.addEventListener('click', () => {
        const index = order.indexOf(state.ui.nodeStyle || 'circle');
        state.ui.nodeStyle = order[(index + 1) % order.length];
        sync();
        markProjectDirty();
        requestDraw();
        toast(`节点样式：${styleBtn.textContent}`, 'info', 1800);
      });
      sync();
    }
  }

  function applyPanelHidden(hidden, persist = true) {
    ui.main.classList.toggle('panel-hidden', hidden);
    ui.panel?.classList.toggle('collapsed', hidden);
    if (ui.panelHanger) {
      ui.panelHanger.textContent = hidden ? '‹' : '›';
      ui.panelHanger.title = hidden ? '展开右侧面板' : '收起右侧面板';
      ui.panelHanger.setAttribute('aria-expanded', hidden ? 'false' : 'true');
    }
    if (persist) {
      try {
        localStorage.setItem(SHELL_KEYS.panelCollapsed, hidden ? '1' : '0');
      } catch (error) {
        // 隐私模式忽略
      }
    }
    setTimeout(() => {
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      resizeFem();
      resizePhase();
    }, 60);
  }

  function togglePanel() {
    applyPanelHidden(!ui.main.classList.contains('panel-hidden'));
  }

  function initPanelChrome() {
    let hidden = false;
    let width = 0;
    try {
      hidden = localStorage.getItem(SHELL_KEYS.panelCollapsed) === '1';
      width = Number(localStorage.getItem(SHELL_KEYS.panelWidth)) || 0;
    } catch (error) {
      hidden = false;
    }
    if (width >= 260 && width <= 720) ui.main.style.setProperty('--panel-w', `${Math.round(width)}px`);
    applyPanelHidden(hidden, false);
    ui.panelHanger?.addEventListener('click', togglePanel);

    const handle = ui.panelResize;
    if (!handle) return;
    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    // FEM 模式下右栏有独立的宽度变量，拖拽要写对口，否则面板看起来“拖不动”
    const panelVar = () => (ui.main.classList.contains('fem-mode') ? '--panel-w-fem' : '--panel-w');
    const currentWidth = () => {
      const rect = ui.panel?.getBoundingClientRect();
      if (rect && rect.width > 0) return rect.width;
      const value = parseFloat(getComputedStyle(ui.main).getPropertyValue(panelVar()));
      return Number.isFinite(value) && value > 0 ? value : 388;
    };
    handle.addEventListener('pointerdown', (event) => {
      if (ui.main.classList.contains('panel-hidden')) return;
      dragging = true;
      startX = event.clientX;
      startWidth = currentWidth();
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add('panel-dragging');
      event.preventDefault();
    });
    handle.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const next = clamp(Math.round(startWidth - (event.clientX - startX)), 260, 720);
      ui.main.style.setProperty(panelVar(), `${next}px`);
      ui.main.style.setProperty('--panel-edge', `${next}px`);
    });
    const finish = (event) => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('panel-dragging');
      try {
        localStorage.setItem(SHELL_KEYS.panelWidth, String(Math.round(currentWidth())));
      } catch (error) {
        // 忽略
      }
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      resizeFem();
      resizePhase();
      if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  function initShell() {
    initMenus();
    initNetworkSidebar();
    initPanelChrome();
    updateInfoBar();
    requestAnimationFrame(syncChromeEdges);
  }

  function bindStaticEvents() {
    ui.exitBtn?.addEventListener('click', () => void shutdownApp());
    ui.runBtn.addEventListener('click', () => void control('toggle'));
    $('#btnStep').addEventListener('click', () => void control('step', 1));
    $('#btnReset').addEventListener('click', () => void control('reset'));

    $('#btnAdd').addEventListener('click', () => {
      const place = centerPlacement();
      openAddMenu(16, 88, place.x, place.y);
    });
    $('#btnLayout').addEventListener('click', () => void autoLayout());
    $('#btnFit').addEventListener('click', () => fitView(true));
    $('#btnZoomIn').addEventListener('click', () => zoomCenter(1.2));
    $('#btnZoomOut').addEventListener('click', () => zoomCenter(1 / 1.2));
    $('#btnClear').addEventListener('click', () => void clearScene());

    $('#btnHelp').addEventListener('click', showHelp);

    if (ui.workspaceSwitch) {
      $$('button[data-workspace]', ui.workspaceSwitch).forEach((buttonNode) => {
        buttonNode.addEventListener('click', () => void switchWorkspace(buttonNode.dataset.workspace));
      });
    }
    setWorkspaceButtons();

    $$('.panel-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const group = tab.dataset.group;
        switchTab(group === 'inspect' ? 'inspect' : defaultTabForGroup(group));
      });
    });
    $$('#panel .group-subnav').forEach((nav) => {
      nav.addEventListener('click', (event) => {
        const target = event.target.closest('button');
        if (!target) return;
        if (target.dataset.fnrole) {
          state.fnRole = target.dataset.fnrole;
          state.specKind = '';
          switchTab(target.dataset.fnrole === 'edge' ? 'edge-fn' : 'node-fn');
        } else if (target.dataset.sub) {
          switchTab(target.dataset.sub);
        }
      });
    });
    setPanelGroup('inspect');
    setGroupSub('modules', 'blocks');
    setGroupSub('analysis', 'chart');

    if (ui.vectorNode) {
      ui.vectorNode.addEventListener('change', () => {
        state.phaseNode = ui.vectorNode.value;
        drawPhase();
      });
    }
    if (ui.vectorTrail) {
      ui.vectorTrail.addEventListener('change', () => {
        const value = Number(ui.vectorTrail.value);
        if (!Number.isFinite(value)) return;
        state.phaseTrail = clamp(Math.round(value), 20, 1200);
        ui.vectorTrail.value = String(state.phaseTrail);
        drawPhase();
      });
    }
    femCanvas.addEventListener('pointermove', (event) => {
      if (state.workspace !== 'fem') return;
      const rect = femCanvas.getBoundingClientRect();
      state.femHover = femHoverFromPoint(event.clientX - rect.left, event.clientY - rect.top);
      const probe = $('[data-role="fem-probe"]', ui.femPanel);
      if (probe) {
        probe.textContent = state.femHover
          ? `节点 (${state.femHover.i}, ${state.femHover.j}) · T=${fmt(state.femHover.value, 3)} °C · t=${fmt(state.fem?.time, 4)} s`
          : '把鼠标移动到色场上读取节点温度。';
      }
      drawFem();
    });
    femCanvas.addEventListener('pointerleave', () => {
      state.femHover = null;
      updateFemPanelValues();
      drawFem();
    });

    ui.chartWindow.addEventListener('change', () => {
      const value = Number(ui.chartWindow.value);
      if (!Number.isFinite(value) || value < 0.1 || value > 120) {
        toast('时间窗必须在 0.1–120 s 之间', 'error', 3000);
        ui.chartWindow.value = String(state.chart.window);
        return;
      }
      state.chart.window = value;
      scheduleChartDraw();
    });

    ui.signalSearch.addEventListener('input', () => {
      state.chart.filter = ui.signalSearch.value;
      renderSignalList();
    });

    ui.btnClearChart.addEventListener('click', () => {
      state.frames = [];
      state.chart.hover = null;
      stopReplayTimer();
      state.replay.active = false;
      state.replay.index = 0;
      state.replay.recordingRevision = null;
      updateReplayUI();
      drawChart();
      toast('轨迹已清空，新的采样会继续绘制', 'ok', 2000);
    });

    if (ui.chartTimeline) {
      ui.chartTimeline.addEventListener('input', () => {
        enterReplay(Number(ui.chartTimeline.value));
      });
    }
    if (ui.topTimeline) {
      ui.topTimeline.addEventListener('input', () => {
        enterReplay(Number(ui.topTimeline.value));
      });
      ui.topTimeline.addEventListener('dblclick', () => {
        leaveReplay();
        toast('已回到实时录制', 'info', 1600);
      });
    }
    if (ui.btnReplay) {
      ui.btnReplay.addEventListener('click', () => toggleReplayPlayback());
    }
    try {
      const storedSpeed = Number(localStorage.getItem('netlab.replaySpeed'));
      if (Number.isFinite(storedSpeed) && storedSpeed >= 5 && storedSpeed <= 240) {
        state.replay.speed = storedSpeed;
      }
    } catch (error) { /* 存储不可用时用默认速度 */ }
    if (ui.replaySpeed) {
      ui.replaySpeed.addEventListener('input', () => {
        state.replay.speed = clamp(Number(ui.replaySpeed.value) || 60, 5, 240);
        try {
          localStorage.setItem('netlab.replaySpeed', String(state.replay.speed));
        } catch (error) { /* 忽略 */ }
        updateReplayUI();
      });
    }
    if (ui.btnPrecompute) {
      ui.btnPrecompute.addEventListener('click', async () => {
        const raw = window.prompt('预计算 0→T 的时长（秒，最大 120）', '5');
        if (raw === null) return;
        const duration = Number(raw);
        if (!Number.isFinite(duration) || duration <= 0 || duration > 120) {
          toast('预计算时长必须在 (0, 120] s 内', 'error', 3000);
          return;
        }
        try {
          toast(`正在预计算 0→${duration} s…`, 'info', 2400);
          const response = await api('/api/solve-window', {
            method: 'POST',
            body: JSON.stringify({ duration }),
            timeoutMs: 180000,
          });
          leaveReplay();
          state.frames = [];
          state.cursor = 0;
          state.values.clear();
          state.nodeValues.clear();
          state.edgeValues.clear();
          state.sim = response.sim;
          state.replay.recordingRevision = state.scene?.revision ?? null;
          await pollLive();
          updateReplayUI();
          scheduleChartDraw();
          const result = response.result || {};
          if (result.error) toast(`预计算中断：${result.error}`, 'error', 6000);
          else toast(`预计算完成：${result.steps} 步 / ${result.frames} 帧`, 'ok', 3000);
        } catch (error) {
          toast(`预计算失败：${error.message}`, 'error', 6000);
        }
      });
    }
    if (ui.btnLive) {
      ui.btnLive.addEventListener('click', () => {
        leaveReplay();
        toast('已回到实时录制', 'info', 1800);
      });
    }
    if (ui.btnResolve) {
      ui.btnResolve.addEventListener('click', async () => {
        if (!recordingStale()) return;
        leaveReplay();
        await control('reset');
        await control('run');
        toast('场景已修改，旧记录清除并重新求解', 'ok', 2400);
      });
    }
    if (ui.chartLoop) {
      ui.chartLoop.addEventListener('change', () => {
        state.chart.loop = Boolean(ui.chartLoop.checked);
        toast(`循环回放：${state.chart.loop ? '开' : '关'}`, 'info', 1600);
      });
    }
    updateReplayUI();

    chartCanvas.addEventListener('pointermove', (event) => {
      const rect = chartCanvas.getBoundingClientRect();
      state.chart.hover = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      scheduleChartDraw();
    });
    chartCanvas.addEventListener('pointerleave', () => {
      state.chart.hover = null;
      scheduleChartDraw();
    });

    document.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.popup')) return;
      closePopups();
    }, true);

    document.addEventListener('keydown', (event) => {
      if (state.shuttingDown) return;
      if (event.key === 'Escape') {
        closePopups();
        if (state.wireTool) cancelWireTool();
        if (!ui.modal.classList.contains('hidden')) closeModal();
        return;
      }
      if (isFormTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === 's' && event.altKey) {
          event.preventDefault();
          void saveProject(true);
        } else if (key === 's') {
          event.preventDefault();
          void saveProject(false);
        } else if (key === 'e' && event.shiftKey) {
          event.preventDefault();
          if (state.workspace === 'network') void exportScene();
          else toast('有限元场不导出 JSON；可在「场」面板重建参数', 'info', 3000);
        } else if (key === 'z') {
          event.preventDefault();
          if (event.shiftKey) void redo();
          else void undo();
        } else if (key === 'y') {
          event.preventDefault();
          void redo();
        } else if (key === 'c') {
          event.preventDefault();
          copySelection(false);
        } else if (key === 'x') {
          event.preventDefault();
          copySelection(true);
        } else if (key === 'v') {
          event.preventDefault();
          void pasteClipboard();
        } else if (key === 'a') {
          event.preventDefault();
          selectAll();
        }
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        void control('toggle');
      } else if (event.key === 's' || event.key === 'S') {
        event.preventDefault();
        void control('step', 1);
      } else if (event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        void control('reset');
      } else if (state.workspace === 'network' && (event.key === 'f' || event.key === 'F')) {
        event.preventDefault();
        fitView(true);
      } else if (state.workspace === 'network' && (event.key === 'a' || event.key === 'A')) {
        event.preventDefault();
        const place = centerPlacement();
        openAddMenu(state.canvasSize.w / 2, state.canvasSize.h / 2, place.x, place.y);
      } else if (state.workspace === 'network' && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        void deleteSelection();
      } else if (state.workspace === 'network' && (event.key === '+' || event.key === '=')) {
        event.preventDefault();
        zoomCenter(1.2);
      } else if (state.workspace === 'network' && (event.key === '-' || event.key === '_')) {
        event.preventDefault();
        zoomCenter(1 / 1.2);
      } else if (event.key === '?') {
        event.preventDefault();
        showHelp();
      }
    });

    canvas.tabIndex = 0;
    canvas.addEventListener('focus', () => {
      // 让画布获得键盘焦点；输入控件仍优先。
    });
  }

  async function boot() {
    await loadUiPrefs();
    initProject();
    initShell();
    initAppearanceControls();
    initSettingsWin();
    initGuide();
    initDocWin();
    initModuleWindow();
    initFloatingMenu();
    initShellKeys();
    bindStaticEvents();
    bindCanvas();
    resizeGraph();
    resizeChart();
    resizePhase();
    initInstruments();

    const observer = new ResizeObserver(() => {
      if (state.workspace === 'network') resizeGraph();
      resizeChart();
      if (state.workspace === 'fem') resizeFem();
      resizePhase();
      resizeInstrument();
    });
    observer.observe(stage);
    const chartWrap = $('.chart-wrap');
    if (chartWrap) observer.observe(chartWrap);
    const phaseWrap = $('.phase-wrap');
    if (phaseWrap) observer.observe(phaseWrap);
    $$('.scope-wrap').forEach((wrap) => observer.observe(wrap));
    window.addEventListener('resize', () => {
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      resizeFem();
      resizePhase();
      resizeInstrument();
    });
    setInterval(() => {
      if (!ui.sessionClock) return;
      const now = new Date();
      ui.sessionClock.textContent = `LOCAL SESSION · ${now.toLocaleTimeString('zh-CN', { hour12: false })}`;
    }, 1000);

    requestAnimationFrame(animationLoop);

    try {
      const [catalog, snapshot] = await Promise.all([api('/api/catalog'), api('/api/state')]);
      state.catalog = catalog.catalog;
      state.templates = catalog.templates || [];
      state.mode = snapshot.scene?.mode || 'signal';
      applySnapshot(snapshot);
      await fetchNetworks();
      await refreshBlocks();
      initBlockDragDrop();
      initStatusToggles();
      state.cursor = Math.max(0, Number(snapshot.sim?.cursor || 0) - 600);
      renderScenePanel();
      await ensureDocs();
      renderSignalList();
      renderInspector();
      updateModeUI();
      fitView();
      if (Number(snapshot.sim?.cursor || 0) > 0) await pollLive();
      state.pollTimer = setTimeout(pollLoop, 220);
      state.stateTimer = setInterval(() => {
        if (state.sim?.running) void refreshState(true);
      }, 4000);
      state.booted = true;
      await maybeOfferRecovery();
      await ensureStoppedOnBoot();
      if (state.prefs.guide !== 'never') showGuide();
      if (!state.sim?.running) {
        toast('画布已就绪：空格运行，双击节点编辑，从右侧端口拖出连线', 'info', 4200);
      }
    } catch (error) {
      showBanner(`无法连接后端：${error.message}`);
      toast(`初始化失败：${error.message}`, 'error', 9000);
      renderScenePanel();
      renderInspector();
    }
  }

  // 只读调试钩子：给 CDP/自动化验证计算屏幕坐标用，不改变业务行为。
  window.__netlabDebug = {
    state,
    nodeRect,
    edgePathPoints,
    elementPins,
    devicePins,
    devicePinScreen,
    waypointHitAt,
    worldToScreen,
    screenToWorld,
  };

  /* ======================================================================
   * 8.7 R30：外观令牌 / 设置窗与浮窗通用层 / 启动引导 / 文档中心 / 参数帮助卡
   * ==================================================================== */

  const THEME_TOKENS = {
    light: {
      ink: '#080a08', ink2: '#2b2a24', muted: '#77756d', dim: '#9a9487', line: '#aaa59a',
      paper: '#eae5e1', panel: '#edebe4', surface: '#e2dccf', paper3: '#e2dccf',
      accent: '#9b7247', accent2: '#565c46', accentSoft: '#e4d5c1',
      red: '#8a4234', amber: '#a67d48', green: '#565c46',
      gridDot: 'rgba(104, 94, 78, 0.20)', gridAxis: '#cfc6b5',
    },
    dark: {
      ink: '#e0e3dc', ink2: '#c6cbc3', muted: '#a6b0b1', dim: '#7f8c8e', line: '#536166',
      paper: '#11181b', panel: '#202a2f', surface: '#2a363b', paper3: '#1b2429',
      accent: '#c5a16b', accent2: '#9aa88c', accentSoft: '#2e3b40',
      red: '#c08a7d', amber: '#c5a16b', green: '#9aa88c',
      gridDot: 'rgba(166, 176, 177, 0.16)', gridAxis: '#3a4a50',
    },
  };

  const COLOR_ALIAS = {
    '#a8541f': 'accent', '#1f5f5b': 'accent2', '#6f695f': 'muted', '#969083': 'dim',
    '#11100e': 'ink', '#faf8f2': 'panel', '#f7f4ec': 'paper', '#fffdf8': 'surface',
    '#f2efe7': 'paper', '#bcb3a1': 'line', '#cfc6b5': 'gridAxis', '#e7e1d5': 'paper3',
  };

  const CHART_PALETTE = [
    '#a8541f', '#1f5f5b', '#7b8c3a', '#8a4a7c', '#4a6f8a',
    '#b08a3e', '#8e2f24', '#5f6b52', '#7a4a2a', '#4d463c',
  ];

  const ACCENT_SWATCHES = ['', '#9b7247', '#565c46', '#3f5d6b', '#8a4234', '#6b6257'];
  const PREF_CACHE_KEY = 'netlab.ui.prefs';

  function themeKey() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function tokens() {
    return THEME_TOKENS[themeKey()];
  }

  function mixHex(foreground, background, amount) {
    const a = hexToRgb(foreground);
    const b = hexToRgb(background);
    if (!a || !b) return foreground;
    const t = clamp(Number(amount) || 0, 0, 1);
    const out = a.map((channel, index) => Math.round(channel + (b[index] - channel) * t));
    return `rgb(${out[0]}, ${out[1]}, ${out[2]})`;
  }

  // 画布取色：把旧版硬编码色映射到当前主题令牌；未知色在深色下向纸面文字方向提亮。
  const LEGACY_RGB = {
    '168,84,31': 'accent',
    '31,95,91': 'accent2',
    '142,47,36': 'red',
    '79,107,64': 'green',
    '176,118,42': 'amber',
  };

  function C(value) {
    const raw = String(value || '').trim();
    const legacy = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+))?\s*\)$/i);
    if (legacy) {
      const target = LEGACY_RGB[`${legacy[1]},${legacy[2]},${legacy[3]}`];
      const hex = target ? tokens()[target] : '';
      const rgb = hex ? hexToRgb(hex) : null;
      if (rgb) return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${legacy[4] ?? 1})`;
    }
    const token = COLOR_ALIAS[raw.toLowerCase()];
    if (token) return tokens()[token];
    if (themeKey() === 'dark') return mixHex(raw, '#e0e3dc', 0.42);
    return raw;
  }

  function applyAppearance() {
    const root = document.documentElement;
    const pref = state.prefs || {};
    const theme = resolveTheme(pref.theme || 'system');
    root.dataset.theme = theme;
    root.dataset.motion = pref.motion || 'low';
    root.dataset.perf = pref.perf || 'perf';
    const pal = THEME_TOKENS[theme];
    const accent = pref.accent || pal.accent;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-rgb', hexToRgbString(accent));
    root.style.setProperty('--accent-soft', mixHex(pal.paper, accent, 0.28));
    root.style.setProperty('--accent-2', pal.accent2);
    root.style.setProperty('--green', pal.green);
    state.palette = pal;
    if (ui.infoBar) ui.infoBar.style.display = pref.infobar === false ? 'none' : '';
    syncPrefControls();
    writePrefCache();
    if (state.booted) {
      requestDraw();
      scheduleChartDraw();
      drawPhase();
      if (state.workspace === 'fem') {
        drawFem();
      }
      if (ui.moduleWin && !ui.moduleWin.hidden) drawModulePreview();
    }
  }

  function resolveTheme(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function readPrefCache() {
    try {
      return JSON.parse(window.localStorage.getItem(PREF_CACHE_KEY) || 'null');
    } catch (error) {
      return null;
    }
  }

  function writePrefCache() {
    try {
      window.localStorage.setItem(PREF_CACHE_KEY, JSON.stringify(state.prefs || {}));
    } catch (error) {
      // 隐私模式忽略
    }
  }

  async function loadUiPrefs() {
    const cached = readPrefCache();
    if (cached && typeof cached === 'object') state.prefs = { ...state.prefs, ...cached };
    applyAppearance();
    try {
      const response = await jsonRequest('/api/settings', 'GET');
      const stored = response.settings || {};
      state.settings = stored;
      state.prefs.theme = ['system', 'light', 'dark'].includes(stored.theme) ? stored.theme : 'system';
      state.prefs.motion = ['off', 'low', 'med', 'high'].includes(stored.ui_motion) ? stored.ui_motion : 'low';
      state.prefs.perf = ['perf', 'balanced', 'quality'].includes(stored.ui_perf) ? stored.ui_perf : 'perf';
      state.prefs.accent = typeof stored.ui_accent === 'string' ? stored.ui_accent : '';
      state.prefs.guide = stored.ui_guide === 'never' ? 'never' : 'always';
      if (typeof stored.autosave_enabled === 'boolean') state.project.autosave = stored.autosave_enabled;
      const interval = Number(stored.autosave_interval_seconds);
      if (Number.isFinite(interval) && interval >= 5) state.project.autosaveInterval = interval * 1000;
      applyAppearance();
    } catch (error) {
      // 后端离线时使用缓存
    }
    state.uiReady = true;
  }

  const PREF_SETTING_KEYS = { theme: 'theme', motion: 'ui_motion', perf: 'ui_perf', accent: 'ui_accent', guide: 'ui_guide' };

  async function setPref(key, value) {
    state.prefs[key] = value;
    applyAppearance();
    const settingKey = PREF_SETTING_KEYS[key];
    if (!settingKey) return;
    try {
      const response = await jsonRequest('/api/settings', 'PATCH', { [settingKey]: value });
      state.settings = response.settings || state.settings;
    } catch (error) {
      toast(`偏好保存失败：${error.message}`, 'warn', 3200);
    }
  }

  function syncPrefControls() {
    const prefs = state.prefs || {};
    const paint = (host, value) => {
      if (!host) return;
      $$('button[data-value]', host).forEach((node) => {
        const on = node.dataset.value === value;
        node.classList.toggle('active', on);
        node.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    };
    paint($('#segTheme'), prefs.theme || 'system');
    paint($('#segMotion'), prefs.motion || 'low');
    paint($('#segPerf'), prefs.perf || 'perf');
    paint($('#segInfoBar'), prefs.infobar === false ? 'off' : 'on');
    paint($('#segGuide'), prefs.guide === 'never' ? 'never' : 'always');
    paint($('#segAutosave'), state.project.autosave ? 'on' : 'off');
    if ($('#selAutosaveInterval')) $('#selAutosaveInterval').value = String(Math.round(state.project.autosaveInterval / 1000));
    const swatches = $('#accentSwatches');
    if (swatches) {
      $$('button', swatches).forEach((node) => {
        node.classList.toggle('active', (node.dataset.value || '') === (prefs.accent || ''));
      });
    }
    if (ui.guideNever) ui.guideNever.checked = prefs.guide === 'never';
  }

  function initAppearanceControls() {
    $('#segTheme')?.addEventListener('click', (event) => {
      const target = event.target.closest('button[data-value]');
      if (target) void setPref('theme', target.dataset.value);
    });
    $('#segMotion')?.addEventListener('click', (event) => {
      const target = event.target.closest('button[data-value]');
      if (target) void setPref('motion', target.dataset.value);
    });
    $('#segPerf')?.addEventListener('click', (event) => {
      const target = event.target.closest('button[data-value]');
      if (target) void setPref('perf', target.dataset.value);
    });
    $('#segInfoBar')?.addEventListener('click', (event) => {
      const target = event.target.closest('button[data-value]');
      if (!target) return;
      state.prefs.infobar = target.dataset.value !== 'off';
      applyAppearance();
    });
    $('#segGuide')?.addEventListener('click', (event) => {
      const target = event.target.closest('button[data-value]');
      if (target) void setPref('guide', target.dataset.value);
    });
    $('#segAutosave')?.addEventListener('click', (event) => {
      const target = event.target.closest('button[data-value]');
      if (!target) return;
      void saveAutosaveSetting({ autosave_enabled: target.dataset.value === 'on' });
    });
    $('#selAutosaveInterval')?.addEventListener('change', () => {
      const seconds = Number($('#selAutosaveInterval').value);
      if (Number.isFinite(seconds)) void saveAutosaveSetting({ autosave_interval_seconds: seconds });
    });

    const swatches = $('#accentSwatches');
    if (swatches) {
      for (const value of ACCENT_SWATCHES) {
        const node = button(value ? '' : 'A', 'swatch', () => void setPref('accent', value));
        node.dataset.value = value;
        node.title = value ? `强调色 ${value}` : '默认强调色';
        if (!value) node.classList.add('default');
        node.style.background = value || 'linear-gradient(135deg, #9b7247 50%, #eae5e1 50%)';
        swatches.appendChild(node);
      }
    }
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((state.prefs.theme || 'system') === 'system') applyAppearance();
    });
  }

  async function saveAutosaveSetting(patch) {
    state.project.autosave = patch.autosave_enabled !== undefined ? patch.autosave_enabled : state.project.autosave;
    if (patch.autosave_interval_seconds) state.project.autosaveInterval = patch.autosave_interval_seconds * 1000;
    syncPrefControls();
    try {
      const response = await jsonRequest('/api/settings', 'PATCH', patch);
      state.settings = response.settings || state.settings;
      toast(patch.autosave_enabled === false ? '自动保存已关闭' : patch.autosave_enabled ? '自动保存已开启' : '快照间隔已更新', 'ok', 2000);
    } catch (error) {
      toast(`设置保存失败：${error.message}`, 'error', 3600);
    }
  }

  // ---- 设置窗（非模态内部浮窗） ---------------------------------------------
  function openSettings(pane = 'project') {
    if (!ui.settingsWin) return;
    ui.settingsWin.hidden = false;
    ui.settingsWin.classList.remove('minimized');
    setSettingsPane(pane);
    if (!ui.scenePane || !ui.scenePane.dataset.ready) renderScenePanel();
    placeFloatWindow(ui.settingsWin, 'settingsGeo');
    raiseFloatWindow(ui.settingsWin);
  }

  function closeSettings() {
    if (!ui.settingsWin) return;
    ui.settingsWin.classList.remove('minimized', 'maximized');
    ui.settingsWin.hidden = true;
  }

  function setSettingsPane(pane) {
    $$('#settingsWin .setwin-nav button[data-pane]').forEach((node) => {
      node.classList.toggle('active', node.dataset.pane === pane);
    });
    $$('#settingsWin .setwin-pane').forEach((node) => {
      node.classList.toggle('active', node.dataset.pane === pane);
    });
    const hint = $('#setWinHint');
    if (hint) {
      hint.textContent = { project: 'SETTINGS · 工程级，随 .netlab 保存', view: 'SETTINGS · 全局外观偏好', interact: 'SETTINGS · 全局交互偏好' }[pane] || '';
    }
    const main = ui.settingsWin?.querySelector('.setwin-main');
    if (main) main.scrollTop = 0;
  }

  function initSettingsWin() {
    $('#settingsWin .setwin-nav')?.addEventListener('click', (event) => {
      const target = event.target.closest('button[data-pane]');
      if (target) setSettingsPane(target.dataset.pane);
    });
    ui.settingsClose?.addEventListener('click', closeSettings);
    $$('#settingsWin [data-doc]').forEach((node) => {
      node.addEventListener('click', () => openDoc(node.dataset.doc));
    });
    initFloatWindow(ui.settingsWin, 'settingsGeo', { minWidth: 520, minHeight: 380 });
  }

  // ---- 启动引导 -------------------------------------------------------------
  function showGuide(force = false) {
    if (!ui.guide) return;
    if (!force && state.prefs.guide === 'never') return;
    state.guideShown = true;
    document.body.classList.add('guide-open');
    ui.guide.hidden = false;
    selectGuideMode(state.guideMode || state.mode || 'signal');
    syncPrefControls();
  }

  function hideGuide() {
    if (!ui.guide) return;
    ui.guide.hidden = true;
    document.body.classList.remove('guide-open');
  }

  function selectGuideMode(mode) {
    const picked = ['signal', 'circuit', 'vector'].includes(mode) ? mode : 'signal';
    state.guideMode = picked;
    $$('.guide-mode').forEach((node) => {
      const on = node.dataset.mode === picked;
      node.classList.toggle('selected', on);
      node.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  async function enterGuideScene() {
    const mode = state.guideMode || 'signal';
    if (ui.guideNever?.checked) {
      await setPref('guide', 'never');
    } else if (state.prefs.guide === 'never') {
      await setPref('guide', 'always');
    }
    hideGuide();
    if (mode !== state.mode) {
      await switchMode(mode, { skipConfirm: true });
    } else {
      toast(`${modeLabel(mode)}场景已就绪 · 空格运行`, 'ok', 2600);
    }
  }

  function initGuide() {
    if (!ui.guide) return;
    $$('.guide-mode').forEach((node) => {
      node.addEventListener('click', () => selectGuideMode(node.dataset.mode));
    });
    ui.guideEnter?.addEventListener('click', () => void enterGuideScene());
    ui.guideClose?.addEventListener('click', hideGuide);
    ui.guideDocs?.addEventListener('click', () => {
      // 保持引导层不退出：文档窗浮在开始页之上，关闭文档后仍回到开始页
      openDoc('quickstart');
    });
    ui.guideDemo?.addEventListener('click', () => {
      hideGuide();
      void loadTemplate('signal_chain', '信号链示例');
    });
    ui.guideOpenProject?.addEventListener('click', () => void openProject());
    ui.guideSettings?.addEventListener('click', () => openSettings('view'));
    $$('#guide [data-doc]').forEach((node) => {
      node.addEventListener('click', (event) => {
        event.stopPropagation();
        openDoc(node.dataset.doc);
      });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !ui.guide.hidden && !event.target.closest('input, textarea, select')) {
        event.preventDefault();
        void enterGuideScene();
      }
    });
  }

  // ---- 文档中心 -------------------------------------------------------------
  async function ensureDocs() {
    if (state.docs && state.docs.length) return state.docs;
    try {
      const response = await jsonRequest('/api/docs', 'GET');
      state.docs = Array.isArray(response.docs) ? response.docs : [];
    } catch (error) {
      state.docs = [];
      toast(`文档读取失败：${error.message}`, 'warn', 4200);
    }
    return state.docs;
  }

  function docBySlug(slug) {
    return (state.docs || []).find((doc) => doc.slug === slug) || null;
  }

  // ---- PlotKit 绘图窗口（非模态浮窗，iframe 懒加载） ----------------------
  let plotkitReady = false;

  function layoutPlotkitWindow() {
    const win = $('#plotkitWin');
    if (!win) return;
    win.classList.toggle('docked', Boolean(state.plotkitDock));
    const dock = $('#plotkitDock');
    if (dock) dock.classList.toggle('on', Boolean(state.plotkitDock));
    if (!state.plotkitDock) {
      if (!win.hidden) placeFloatWindow(win, 'plotkitGeo');
      return;
    }
    // 停靠 = 贴在画布区右侧，占 62% 宽、72% 高；跟随窗口尺寸变化
    const stage = $('#graph')?.closest('.stage') || $('#graph')?.parentElement;
    const rect = stage?.getBoundingClientRect();
    if (!rect || rect.width < 240) return;
    const width = Math.max(560, Math.round(rect.width * 0.72));
    const height = Math.max(320, Math.round(rect.height * 0.78));
    win.style.left = `${Math.round(rect.left + rect.width - width - 16)}px`;
    win.style.top = `${Math.round(rect.top + 16)}px`;
    win.style.width = `${width}px`;
    win.style.height = `${height}px`;
  }

  function togglePlotkitDock() {
    const win = $('#plotkitWin');
    if (!win || win.hidden) return;
    state.plotkitDock = !state.plotkitDock;
    if (!state.plotkitDock) {
      win.style.left = '';
      win.style.top = '';
      win.style.width = '';
      win.style.height = '';
    }
    layoutPlotkitWindow();
  }

  function openPlotkit() {
    const win = $('#plotkitWin');
    if (!win) return;
    const frame = $('#plotkitFrame');
    if (frame && !plotkitReady) {
      frame.src = '/plotkit/?embed=1';
      plotkitReady = true;
    }
    win.hidden = false;
    win.classList.remove('minimized');
    layoutPlotkitWindow();
    if (typeof raiseFloatWindow === 'function') raiseFloatWindow(win);
  }

  function closePlotkit() {
    const win = $('#plotkitWin');
    if (!win) return;
    win.hidden = true;
    win.classList.remove('minimized', 'maximized');
    state.plotkitGeo = null;
  }

  async function openDoc(slug = 'quickstart') {
    if (!ui.docWin) return;
    await ensureDocs();
    const doc = docBySlug(slug) || state.docs[0];
    if (!doc) {
      toast('文档目录为空，请检查后端安装', 'warn', 4000);
      return;
    }
    state.docSlug = doc.slug;
    ui.docWin.hidden = false;
    ui.docWin.classList.remove('min');
    document.body.classList.add('doc-open');
    ui.docTitle.textContent = `NETLAB · ${doc.title}`;
    renderDocNav();
    renderDocBody(doc);
    ui.docContent.parentElement.scrollTop = 0;
    ui.docSearch.value = '';
    ui.docResults.replaceChildren();
    placeDocWindow();
  }

  function closeDoc() {
    if (!ui.docWin) return;
    ui.docWin.hidden = true;
    ui.docWin.classList.remove('minimized', 'maximized');
    document.body.classList.remove('doc-open');
    state.docGeo = null;
    if (state.guideShown && !ui.guide.hidden) syncPrefControls();
  }

  function renderDocNav() {
    if (!ui.docNav) return;
    ui.docNav.replaceChildren();
    for (const doc of state.docs) {
      const node = button(doc.title, 'docnav-item', () => {
        state.docSlug = doc.slug;
        ui.docTitle.textContent = `NETLAB · ${doc.title}`;
        renderDocNav();
        renderDocBody(doc);
        ui.docResults.replaceChildren();
        ui.docSearch.value = '';
      });
      node.classList.toggle('active', doc.slug === state.docSlug);
      ui.docNav.appendChild(node);
    }
  }

  function renderDocBody(doc) {
    if (!ui.docContent) return;
    const fragment = renderMarkdown(doc.text || '');
    ui.docContent.replaceChildren(fragment);
  }

  function renderInline(text, target) {
    const source = String(text || '');
    const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(source))) {
      if (match.index > cursor) target.appendChild(document.createTextNode(source.slice(cursor, match.index)));
      const token = match[0];
      if (token.startsWith('**')) {
        target.appendChild(el('b', null, token.slice(2, -2)));
      } else if (token.startsWith('`')) {
        target.appendChild(el('code', null, token.slice(1, -1)));
      } else {
        const label = token.slice(1, token.indexOf(']'));
        target.appendChild(el('span', 'doc-link', label));
      }
      cursor = match.index + token.length;
    }
    if (cursor < source.length) target.appendChild(document.createTextNode(source.slice(cursor)));
    return target;
  }

  function renderMarkdown(text) {
    const fragment = document.createDocumentFragment();
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    let index = 0;
    let blockId = 0;
    while (index < lines.length) {
      const line = lines[index];
      const fence = line.match(/^```(\w*)\s*$/);
      if (fence) {
        const code = [];
        index += 1;
        while (index < lines.length && !/^```\s*$/.test(lines[index])) {
          code.push(lines[index]);
          index += 1;
        }
        index += 1;
        const pre = el('pre', 'doc-code');
        pre.textContent = code.join('\n');
        fragment.appendChild(pre);
        continue;
      }
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        const node = el(level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3', 'doc-h');
        node.id = `doc-h-${blockId++}`;
        renderInline(heading[2], node);
        fragment.appendChild(node);
        index += 1;
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        const list = el('ul', 'doc-list');
        while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
          const item = el('li');
          renderInline(lines[index].replace(/^\s*[-*]\s+/, ''), item);
          list.appendChild(item);
          index += 1;
        }
        fragment.appendChild(list);
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        const list = el('ol', 'doc-list');
        while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
          const item = el('li');
          renderInline(lines[index].replace(/^\s*\d+\.\s+/, ''), item);
          list.appendChild(item);
          index += 1;
        }
        fragment.appendChild(list);
        continue;
      }
      if (/^\s*>\s?/.test(line)) {
        const quote = el('blockquote', 'doc-quote');
        while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
          renderInline(lines[index].replace(/^\s*>\s?/, ''), quote);
          quote.appendChild(document.createElement('br'));
          index += 1;
        }
        fragment.appendChild(quote);
        continue;
      }
      if (!line.trim()) {
        index += 1;
        continue;
      }
      const paragraph = el('p', 'doc-p');
      const parts = [line];
      index += 1;
      while (index < lines.length && lines[index].trim() && !/^(#{1,4}\s|```|\s*[-*]\s|\s*\d+\.\s|>)/.test(lines[index])) {
        parts.push(lines[index]);
        index += 1;
      }
      renderInline(parts.join(' '), paragraph);
      fragment.appendChild(paragraph);
    }
    return fragment;
  }

  function searchDocs(query) {
    if (!ui.docResults) return;
    const text = String(query || '').trim().toLowerCase();
    ui.docResults.replaceChildren();
    if (!text) {
      ui.docMain.classList.remove('searching');
      return;
    }
    ui.docMain.classList.add('searching');
    const hits = [];
    for (const doc of state.docs) {
      const blocks = String(doc.text || '').split(/\n{2,}/);
      for (const block of blocks) {
        if (block.toLowerCase().includes(text)) {
          hits.push({
            slug: doc.slug,
            title: doc.title,
            snippet: block.replace(/[#>*`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150),
          });
          break;
        }
      }
    }
    if (!hits.length) {
      ui.docResults.appendChild(div('doc-empty', '没有匹配的段落；试试「节点」「求解器」「快捷键」等关键词。'));
      return;
    }
    for (const hit of hits) {
      const node = button('', 'doc-hit', () => {
        openDoc(hit.slug);
        ui.docSearch.value = query;
        searchDocs(query);
      });
      node.appendChild(el('b', null, hit.title));
      node.appendChild(el('span', null, hit.snippet));
      ui.docResults.appendChild(node);
    }
  }

  // ---- 内部浮窗（文档中心 / 设置窗共用：拖动 · 缩放 · 最小化 · 最大化） -------
  function placeFloatWindow(root, key) {
    if (!root) return;
    const geo = state[key];
    if (!geo) {
      root.classList.remove('moved');
      root.style.left = '';
      root.style.top = '';
      root.style.width = '';
      root.style.height = '';
      return;
    }
    root.classList.add('moved');
    root.style.left = `${geo.left}px`;
    root.style.top = `${geo.top}px`;
    root.style.width = `${geo.width}px`;
    root.style.height = `${geo.height}px`;
  }

  function placeDocWindow() {
    placeFloatWindow(ui.docWin, 'docGeo');
  }

  // 非模态浮窗互不阻塞：最近一次点击/打开的窗抬到最上层（qcard 140 仍在最上）
  function raiseFloatWindow(root) {
    if (!root) return;
    const cur = state.floatZ || 131;
    state.floatZ = cur >= 138 ? 132 : cur + 1;
    root.style.zIndex = String(state.floatZ);
  }

  function toggleFloatMaximize(root, key) {
    if (!root) return;
    root.classList.toggle('maximized');
    if (!root.classList.contains('maximized')) placeFloatWindow(root, key);
  }

  function initFloatWindow(root, key, spec = {}) {
    if (!root) return;
    const minWidth = spec.minWidth || 420;
    const minHeight = spec.minHeight || 320;
    root.addEventListener('pointerdown', () => raiseFloatWindow(root), true);
    const head = root.querySelector('.floatwin-head');
    if (head) {
      let drag = null;
      head.addEventListener('pointerdown', (event) => {
        if (event.target.closest('button')) return;
        if (root.classList.contains('maximized') || root.classList.contains('minimized')) return;
        const rect = root.getBoundingClientRect();
        drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
        head.setPointerCapture(event.pointerId);
      });
      head.addEventListener('pointermove', (event) => {
        if (!drag) return;
        const rect = root.getBoundingClientRect();
        // 标题栏始终留在视口内，且窗口底边不越界（否则右下角缩放柄会移到屏幕外）
        const maxTop = Math.max(40, window.innerHeight - rect.height - 8);
        const maxLeft = Math.max(8, window.innerWidth - 140);
        state[key] = {
          left: clamp(event.clientX - drag.dx, 8, maxLeft),
          top: clamp(event.clientY - drag.dy, 40, maxTop),
          width: rect.width,
          height: rect.height,
        };
        placeFloatWindow(root, key);
      });
      const stopDrag = () => { drag = null; };
      head.addEventListener('pointerup', stopDrag);
      head.addEventListener('pointercancel', stopDrag);
      head.addEventListener('dblclick', (event) => {
        if (event.target.closest('button')) return;
        toggleFloatMaximize(root, key);
      });
    }
    root.querySelector('.floatwin-min')?.addEventListener('click', () => {
      root.classList.toggle('minimized');
    });
    root.querySelector('.floatwin-max')?.addEventListener('click', () => toggleFloatMaximize(root, key));
    const grip = root.querySelector('.floatwin-resize');
    if (grip) {
      let resize = null;
      grip.addEventListener('pointerdown', (event) => {
        if (root.classList.contains('maximized') || root.classList.contains('minimized')) return;
        const rect = root.getBoundingClientRect();
        resize = { x: event.clientX, y: event.clientY, w: rect.width, h: rect.height, left: rect.left, top: rect.top };
        grip.setPointerCapture(event.pointerId);
      });
      grip.addEventListener('pointermove', (event) => {
        if (!resize) return;
        state[key] = {
          left: resize.left,
          top: resize.top,
          width: clamp(resize.w + event.clientX - resize.x, minWidth, Math.max(minWidth, window.innerWidth - resize.left - 12)),
          height: clamp(resize.h + event.clientY - resize.y, minHeight, Math.max(minHeight, window.innerHeight - resize.top - 12)),
        };
        placeFloatWindow(root, key);
      });
      const stopResize = () => { resize = null; };
      grip.addEventListener('pointerup', stopResize);
      grip.addEventListener('pointercancel', stopResize);
    }
  }

  function initDocWin() {
    if (!ui.docWin) return;
    ui.docWin.querySelector('#docWinClose')?.addEventListener('click', closeDoc);
    ui.docSearch?.addEventListener('input', () => searchDocs(ui.docSearch.value));
    ui.docSearch?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        const first = ui.docResults.querySelector('.doc-hit');
        if (first) first.click();
      }
      if (event.key === 'Escape') {
        ui.docSearch.value = '';
        searchDocs('');
      }
    });
    initFloatWindow(ui.docWin, 'docGeo', { minWidth: 420, minHeight: 320 });
    const plotkitWin = $('#plotkitWin');
    if (plotkitWin) {
      initFloatWindow(plotkitWin, 'plotkitGeo', { minWidth: 720, minHeight: 480 });
      $('#plotkitWinClose')?.addEventListener('click', closePlotkit);
      $('#plotkitDock')?.addEventListener('click', togglePlotkitDock);
      window.addEventListener('resize', () => {
        if (state.plotkitDock && !plotkitWin.hidden) layoutPlotkitWindow();
      });
      $('#btnOpenPlotkit')?.addEventListener('click', openPlotkit);
    }
  }

  // ---- 参数 ? 卡片 -----------------------------------------------------------
  function hideHelpCard() {
    if (ui.qcard) ui.qcard.hidden = true;
  }

  function showHelpCard(anchor, info) {
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
        switchTab(info.role === 'edge' ? 'edge-fn' : 'node-fn');
        toast(info.source, 'info', 5200);
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

  function attachParamHelp(cell, param, spec, role) {
    if (!cell) return;
    const ask = button('?', 'qbtn', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showHelpCard(ask, {
        title: `${param.label || param.key}（${param.key}）`,
        description: param.help,
        range: paramRangeText(param),
        unit: param.unit,
        def: param.default,
        formula: spec?.formula || '',
        source: spec?.source_path || '',
        role,
      });
    });
    ask.title = '四段式参数说明（说明 / 取值 / 单位与默认 / 公式）';
    ask.setAttribute('aria-label', `查看 ${param.key} 的说明`);
    cell.appendChild(ask);
  }

  // ---- 启动时保持停止 --------------------------------------------------------
  async function ensureStoppedOnBoot() {
    try {
      if (state.sim?.running) await networkControl('pause');
      if (state.fem?.running) await femControl('pause');
    } catch (error) {
      // 保持静默；状态刷新会纠正按钮
    }
  }

  // ---- 键盘：文档与设置窗 ----------------------------------------------------
  function initShellKeys() {
    document.addEventListener('keydown', (event) => {
      // 合成事件可能把 document 当 target（无 closest），统一兜一层
      const target = event.target instanceof Element ? event.target : null;
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]');
      if (event.key === 'Escape') {
        if (floatingMenu) {
          closeFloatingMenu();
          event.preventDefault();
          return;
        }
        if (ui.qcard && !ui.qcard.hidden) {
          hideHelpCard();
          event.preventDefault();
          return;
        }
        if (ui.moduleWin && !ui.moduleWin.hidden) {
          ui.moduleWin.hidden = true;
          event.preventDefault();
          return;
        }
        if (ui.settingsWin && !ui.settingsWin.hidden) {
          closeSettings();
          event.preventDefault();
          return;
        }
        if (ui.docWin && !ui.docWin.hidden) {
          closeDoc();
          event.preventDefault();
        }
        return;
      }
      if (typing) return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey && key === 'k') {
        event.preventDefault();
        openDoc(state.docSlug || 'quickstart');
        setTimeout(() => ui.docSearch?.focus(), 60);
        return;
      }
      if (key === 'h') {
        event.preventDefault();
        openDoc('quickstart');
      }
      if (event.key === '?') {
        event.preventDefault();
        openDoc('shortcuts');
      }
    });
    document.addEventListener('click', (event) => {
      if (ui.qcard && !ui.qcard.hidden && !event.target.closest('#qcard, .qbtn')) hideHelpCard();
    });
  }

  function hexToRgb(hex) {
    const text = String(hex || '').trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(text)) {
      return [0, 1, 2].map((index) => parseInt(text[index] + text[index], 16));
    }
    if (!/^[0-9a-fA-F]{6}$/.test(text)) return null;
    return [0, 2, 4].map((index) => parseInt(text.slice(index, index + 2), 16));
  }

  function hexToRgbString(hex) {
    const rgb = hexToRgb(hex);
    return rgb ? rgb.join(', ') : '155, 114, 71';
  }

  function typeLabelHelp(label, param) {
    if (!label || !param) return;
    const ask = button('?', 'qbtn inline', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showHelpCard(ask, {
        title: `${param.label || param.key}（${param.key}）`,
        description: param.help,
        range: paramRangeText(param),
        unit: param.unit,
        def: param.default,
        role: state.selection?.type === 'edge' ? 'edge' : 'node',
      });
    });
    ask.title = '参数说明：说明 / 取值 / 单位与默认';
    label.appendChild(ask);
  }

  function openDocSearch() {
    openDoc(state.docSlug || 'quickstart');
    setTimeout(() => {
      if (ui.docSearch) {
        ui.docSearch.focus();
        ui.docSearch.select();
      }
    }, 90);
  }

  function syncFnRoleToSelection() {
    const type = state.selection?.type;
    if (type !== 'node' && type !== 'edge') return;
    const role = type === 'edge' ? 'edge' : 'node';
    if (state.fnRole === role) return;
    state.fnRole = role;
    state.specKind = '';
    $$('#panel .group-subnav [data-fnrole]').forEach((node) => {
      node.classList.toggle('active', node.dataset.fnrole === role);
    });
    if ($('.panel-group.active')?.dataset.group === 'fn') renderSpecPane();
  }

  boot();
})();
