import { fmt, intText, clamp, hashString, baseName } from "./app.utils.js";
(() => {
  "use strict";
  const UI_BUILD = "3.20.1";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const PALETTE = [
    "#a8541f",
    "#1f5f5b",
    "#2a2621",
    "#7b8c3a",
    "#8a4a7c",
    "#b08a3e",
    "#4a6f8a",
    "#8e2f24",
    "#5f6b52",
    "#7a4a2a"
  ];
  const GROUP_COLORS = {
    "\u57FA\u7840": "#1f5f5b",
    "\u52A8\u6001": "#4f6b40",
    "\u9AD8\u7EA7": "#8a4a7c",
    "\u4FE1\u53F7": "#a8541f",
    "\u7535\u8DEF": "#9a6a1c",
    "\u77E2\u91CF": "#a8541f",
    "\u6570\u5B66": "#4a6f8a"
  };
  const NODE_RADIUS = 46;
  const NODE_W = NODE_RADIUS * 2;
  const NODE_H = NODE_RADIUS * 2;
  const CHART_KEYS = 8;
  const MAX_IMPORT_BYTES = 2e6;
  const MAX_FRAMES = 5e3;
  const stage = $("#stage");
  const canvas = $("#graph");
  const ctx = canvas.getContext("2d");
  const chartCanvas = $("#chart");
  const chartCtx = chartCanvas.getContext("2d");
  const femCanvas = $("#femCanvas");
  const femCtx = femCanvas.getContext("2d");
  const phaseCanvas = $("#phase");
  const phaseCtx = phaseCanvas.getContext("2d");
  const scopeCanvas = $("#scope");
  const scopeCtx = scopeCanvas?.getContext("2d");
  const lissCanvas = $("#lissajous");
  const lissCtx = lissCanvas?.getContext("2d");
  const INST_COLORS = ["#c2542f", "#2f6f9e", "#7a5aa8", "#3f8f6b"];
  const ui = {
    main: $("main"),
    panel: $("#panel"),
    graph: $("#graph"),
    modePill: $("#modePill"),
    runBtn: $("#btnRun"),
    runIcon: $("#runIcon"),
    runLabel: $("#runLabel"),
    simTime: $("#simTime"),
    simFps: $("#simFps"),
    simSteps: $("#simSteps"),
    statusMode: $("#statusMode"),
    statusEngine: $("#statusEngine"),
    statusHint: $("#statusHint"),
    statusCursor: $("#statusCursor"),
    statusLimits: $("#statusLimits"),
    errorBanner: $("#errorBanner"),
    zoomBadge: $("#zoomBadge"),
    addMenu: $("#addMenu"),
    linkMenu: $("#linkMenu"),
    modal: $("#modal"),
    modalCard: $("#modalCard"),
    toasts: $("#toasts"),
    inspector: $("#tab-inspect"),
    specPane: $("#tab-spec"),
    extPane: $("#tab-ext"),
    blocksPane: $("#tab-blocks"),
    analysisPane: $("#tab-analysis"),
    chartPane: $("#tab-chart"),
    instPane: $("#tab-inst"),
    instWindow: $("#instWindow"),
    instStatus: $("#instStatus"),
    instMeterKey: $("#instMeterKey"),
    instValNow: $("#instValNow"),
    instValMean: $("#instValMean"),
    instValRms: $("#instValRms"),
    instValPP: $("#instValPP"),
    instValMinMax: $("#instValMinMax"),
    instLegend: $("#instLegend"),
    instLX: $("#instLX"),
    instLY: $("#instLY"),
    instTrail: $("#instTrail"),
    instCh: ["#instCh1", "#instCh2", "#instCh3", "#instCh4"].map((sel) => $(sel)),
    scenePane: $("#settingsScene"),
    settingsScene: $("#settingsScene"),
    settingsWin: $("#settingsWin"),
    settingsClose: $("#setWinClose"),
    guide: $("#guide"),
    guideNever: $("#guideNever"),
    guideEnter: $("#guideEnter"),
    guideDocs: $("#guideDocs"),
    guideDemo: $("#guideDemo"),
    guideClose: $("#guideClose"),
    docWin: $("#docWin"),
    analWin: $("#analWin"),
    moduleWin: $("#moduleWin"),
    moduleWinTitle: $("#moduleWinTitle"),
    moduleWinHint: $("#moduleWinHint"),
    modulePorts: $("#modulePorts"),
    moduleMeta: $("#moduleMeta"),
    moduleStage: document.querySelector("#moduleWin .modwin-stage"),
    moduleCanvas: $("#moduleCanvas"),
    moduleEmpty: $("#moduleEmpty"),
    moduleDock: $("#moduleDock"),
    moduleWinClose: $("#moduleWinClose"),
    moduleEdit: $("#moduleEdit"),
    moduleAddInstance: $("#moduleAddInstance"),
    docNav: $("#docNav"),
    docMain: $("#docMain"),
    docContent: $("#docContent"),
    docSearch: $("#docSearch"),
    docResults: $("#docResults"),
    docTitle: $("#docWinTitle"),
    qcard: $("#qcard"),
    signalList: $("#signalList"),
    legend: $("#legend"),
    chartWindow: $("#chartWindow"),
    chartTimeline: $("#chartTimeline"),
    chartReplayTime: $("#chartReplayTime"),
    topTimeline: $("#topTimeline"),
    topTimelineTime: $("#topTimelineTime"),
    btnReplay: $("#btnReplay"),
    replaySpeed: $("#replaySpeed"),
    replaySpeedVal: $("#replaySpeedVal"),
    btnPrecompute: $("#btnPrecompute"),
    chartLoop: $("#chartLoop"),
    btnLive: $("#btnLive"),
    btnResolve: $("#btnResolve"),
    chartStatus: $("#chartStatus"),
    signalSearch: $("#signalSearch"),
    btnClearChart: $("#btnClearChart"),
    vectorPane: $("#tab-vector"),
    femPane: $("#tab-fem"),
    femPanel: $("#femPanel"),
    femStage: $("#femStage"),
    femHudProbe: $("#femHudProbe"),
    phaseCanvas,
    phaseReadout: $("#phaseReadout"),
    vectorNode: $("#vectorNode"),
    vectorTrail: $("#vectorTrail"),
    phasePlay: $("#phasePlay"),
    phaseStep: $("#phaseStep"),
    phaseExport: $("#phaseExport"),
    phasePlotkit: $("#phasePlotkit"),
    phaseLoop: $("#phaseLoop"),
    phaseFrame: $("#phaseFrame"),
    phaseFrameLabel: $("#phaseFrameLabel"),
    workspaceSwitch: $("#workspaceSwitch"),
    sessionClock: $("#sessionClock"),
    exitBtn: $("#btnExit"),
    menuItems: $("#menuItems"),
    infoBar: $("#infoBar"),
    networks: $("#networks"),
    networkList: $("#networkList"),
    netAdd: $("#btnNetAdd"),
    netRename: $("#btnNetRename"),
    netDelete: $("#btnNetDelete"),
    netResize: $("#netResize"),
    netHanger: $("#netHanger"),
    panelHanger: $("#panelHanger"),
    panelResize: $("#panelResize"),
    guideOpenProject: $("#guideOpenProject"),
    guideSettings: $("#guideSettings")
  };
  const state = {
    catalog: null,
    templates: [],
    mode: "signal",
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
    values: /* @__PURE__ */ new Map(),
    nodeValues: /* @__PURE__ */ new Map(),
    edgeValues: /* @__PURE__ */ new Map(),
    probeKeys: [],
    probeSignature: "",
    chart: {
      selected: /* @__PURE__ */ new Set(),
      window: 5,
      filter: "",
      colors: /* @__PURE__ */ new Map(),
      loop: false
    },
    instrument: {
      meterKey: "",
      channels: [null, null, null, null],
      lx: "",
      ly: "",
      trail: 600,
      window: 5,
      scopeSize: { w: 1, h: 1, dpr: 1 },
      lissSize: { w: 1, h: 1, dpr: 1 }
    },
    replay: {
      active: false,
      playing: false,
      index: 0,
      timer: 0,
      speed: 60,
      recordingRevision: null
    },
    pollTimer: 0,
    chartTimer: 0,
    stateTimer: 0,
    lastStateFetch: 0,
    dismissedError: null,
    dirtyPositions: /* @__PURE__ */ new Map(),
    positionTimer: 0,
    booted: false,
    selectionBusy: false,
    specRole: "node",
    fnRole: "node",
    networks: [],
    currentNetwork: null,
    blocks: [],
    blocksLibrary: "",
    blocksStructural: false,
    analysisLast: "",
    analysisSpectrum: null,
    analysisTF: null,
    tfCursor: null,
    degradedBanner: false,
    ui: {
      snap: true,
      grid: 20,
      symbol: "classic",
      showGrid: true,
      snapMarkers: true,
      circuitOrthogonal: true,
      nodeStyle: "circle",
      symbolScale: 1.2,
      glyphColor: "#1f5f5b",
      drawingMode: false,
      drawingSheet: "A3",
      drawingLabels: false,
      drawingPage: 1
    },
    // R30：外观偏好、文档与引导状态
    prefs: { theme: "light", motion: "low", perf: "perf", accent: "", guide: "always", infobar: true, runWarn: true },
    palette: null,
    settings: null,
    docs: [],
    docSlug: "",
    docGeo: null,
    plotkitGeo: null,
    vscodeGeo: null,
    plotkitDock: false,
    settingsGeo: null,
    moduleGeo: null,
    moduleBlock: null,
    moduleDock: false,
    guideMode: "signal",
    guideShown: false,
    uiReady: false,
    multi: { nodes: /* @__PURE__ */ new Set(), edges: /* @__PURE__ */ new Set() },
    undoStack: [],
    redoStack: [],
    clipboard: null,
    specKind: "",
    ext: { list: null, scan: [], notice: "", code: "", result: null },
    lastLiveError: 0,
    workspace: "network",
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
    phaseNode: "",
    phaseTrail: 900,
    phaseIndex: null,
    phasePlaying: false,
    phaseLoop: true,
    phasePlayTimer: 0,
    phaseTimer: 0,
    shuttingDown: false,
    project: {
      name: "\u672A\u547D\u540D\u5DE5\u7A0B",
      path: "",
      dirty: false,
      autosave: true,
      autosaveInterval: 6e4,
      autosavedAt: 0,
      recent: [],
      desktop: false
    }
  };
  let projectFileInput = null;
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== void 0 && text !== null) node.textContent = String(text);
    return node;
  }
  function div(cls, text) {
    return el("div", cls, text);
  }
  function button(label, cls, onClick) {
    const node = el("button", cls || "btn", label);
    node.type = "button";
    if (onClick) node.addEventListener("click", onClick);
    return node;
  }
  function clone(value) {
    return value === void 0 ? void 0 : JSON.parse(JSON.stringify(value));
  }
  function colorForKey(key) {
    if (!state.chart.colors.has(key)) {
      state.chart.colors.set(key, CHART_PALETTE[hashString(key) % CHART_PALETTE.length]);
    }
    return C(state.chart.colors.get(key));
  }
  function activeTab() {
    const group = $(".panel-group.active")?.dataset.group || "inspect";
    if (group === "fn") return state.fnRole === "edge" ? "edge-fn" : "node-fn";
    if (group === "analysis" || group === "modules") {
      const sub = $(".panel-group.active .group-subnav [data-sub].active");
      return sub ? sub.dataset.sub : group === "modules" ? "blocks" : "chart";
    }
    if (group === "fem") return "fem";
    return "inspect";
  }
  function modeLabel(mode) {
    if (mode === "circuit") return "\u7535\u8DEF";
    if (mode === "vector") return "\u77E2\u91CF";
    return "\u4FE1\u53F7\u6D41";
  }
  function selectedNode() {
    return state.selection.type === "node" ? nodeById(state.selection.id) : null;
  }
  function selectedEdge() {
    return state.selection.type === "edge" ? edgeById(state.selection.id) : null;
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
    const list = state.mode === "circuit" ? state.catalog.circuit_nodes : state.catalog.computes;
    return (list || []).find((spec) => spec.kind === kind) || null;
  }
  function getEdgeSpec(kind) {
    if (!state.catalog) return null;
    const list = state.mode === "circuit" ? state.catalog.elements : state.catalog.methods;
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
    return (state.scene?.nodes || []).some((node) => node.kind === "ground");
  }
  function isFormTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON";
  }
  const DESKTOP_TOKEN = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const token = params.get("token") || "";
      if (token) {
        params.delete("token");
        const query = params.toString();
        window.history.replaceState(
          {},
          "",
          `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
        );
      }
      return token;
    } catch (error) {
      return "";
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
    if (!bridge || typeof bridge[method] !== "function") return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        bridge[method](...args, (result) => resolve(result));
      } catch (error) {
        toast(`\u684C\u9762\u6865\u8C03\u7528\u5931\u8D25\uFF08${method}\uFF09\uFF1A${error?.message || error}`, "error", 6e3);
        resolve(null);
      }
    });
  }
  async function api(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs) || 15e3);
    const headers = { "Content-Type": "application/json" };
    if (DESKTOP_TOKEN) headers["X-Netlab-Token"] = DESKTOP_TOKEN;
    const config = {
      headers,
      signal: controller.signal,
      ...options
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
          throw new Error(`\u670D\u52A1\u5668\u8FD4\u56DE\u4E86\u65E0\u6CD5\u89E3\u6790\u7684\u6570\u636E\uFF08HTTP ${response.status}\uFF09`);
        }
      }
      if (!response.ok) {
        let detail = payload && payload.detail;
        if (detail && typeof detail !== "string") detail = JSON.stringify(detail);
        if (response.status === 403 && /token/i.test(String(detail || ""))) {
          throw new Error("\u684C\u9762\u4F1A\u8BDD token \u65E0\u6548\uFF1A\u8BF7\u4ECE\u684C\u9762\u7A97\u53E3\u91CD\u65B0\u6253\u5F00\u9875\u9762");
        }
        throw new Error(detail || `\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`);
      }
      return payload;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("\u8BF7\u6C42\u8D85\u65F6\uFF1A\u540E\u7AEF\u53EF\u80FD\u672A\u542F\u52A8\u6216\u8BA1\u7B97\u963B\u585E\uFF0815 \u79D2\uFF09");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  function jsonRequest(path, method, body) {
    return api(path, { method, body: body === void 0 ? void 0 : JSON.stringify(body) });
  }
  function plotkitFrameUrl(extra) {
    const params = new URLSearchParams(extra || {});
    const query = params.toString();
    const hash = DESKTOP_TOKEN ? `#netlabToken=${encodeURIComponent(DESKTOP_TOKEN)}` : "";
    return `/plotkit/${query ? `?${query}` : ""}${hash}`;
  }
  function toast(message, type = "info", timeout = 4200) {
    const node = div(`toast ${type}`, message);
    ui.toasts.appendChild(node);
    while (ui.toasts.children.length > 4) ui.toasts.firstChild.remove();
    setTimeout(() => {
      node.style.opacity = "0";
      node.style.transform = "translateY(4px)";
      node.style.transition = "opacity .2s, transform .2s";
      setTimeout(() => node.remove(), 220);
    }, timeout);
    return node;
  }
  function showBanner(message) {
    const text = String(message || "").trim();
    if (!text) return;
    ui.errorBanner.replaceChildren();
    const icon = el("span", null, "\u26A0");
    const body = el("span", null, text);
    body.style.flex = "1";
    const close = el("button", null, "\xD7");
    close.type = "button";
    close.title = "\u5173\u95ED\u63D0\u793A";
    close.addEventListener("click", () => {
      state.dismissedError = text;
      ui.errorBanner.classList.add("hidden");
    });
    ui.errorBanner.append(icon, body, close);
    ui.errorBanner.classList.remove("hidden");
  }
  function hideBanner() {
    ui.errorBanner.classList.add("hidden");
  }
  async function task(run, options = {}) {
    if (state.busy) {
      toast("\u4E0A\u4E00\u6761\u64CD\u4F5C\u8FD8\u5728\u5904\u7406\u4E2D\uFF0C\u8BF7\u7A0D\u5019\u2026", "info", 1500);
      return null;
    }
    state.busy = true;
    try {
      if (options.dirty !== false && options.history !== false) await pushUndoSnapshot();
      const result = await run();
      if (options.dirty !== false) markProjectDirty();
      return result;
    } catch (error) {
      const message = error?.message || String(error);
      if (!options.silent) toast(message, "error", 7e3);
      if (/电路|代数环|接地|引擎|求逆|奇异|发散|未收敛|有限元/.test(message)) showBanner(message);
      return null;
    } finally {
      state.busy = false;
    }
  }
  function applySnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object" || !snapshot.scene) return;
    const sim = snapshot.sim || state.sim;
    const previousCursor = state.cursor;
    const resetFrames = !state.sim || sim && sim.steps === 0 && sim.time === 0;
    state.scene = snapshot.scene;
    state.sim = sim;
    const nextRevision = snapshot.scene.revision ?? null;
    if (state.acResult && state.acRevision !== null && nextRevision !== state.acRevision) {
      state.acResult = null;
      const acMeta = $("#analAcMeta");
      if (acMeta) acMeta.textContent = "\u7535\u8DEF\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u626B\u9891";
      if (ui.analWin && !ui.analWin.hidden) requestAnimationFrame(() => drawAcChart());
    }
    state.acRevision = nextRevision;
    if (resetFrames || state.precomputedRevision != null && nextRevision !== state.precomputedRevision) {
      state.precomputedSeconds = null;
      state.precomputedRevision = null;
    }
    if (snapshot.limits) state.limits = snapshot.limits;
    state.mode = state.scene.mode || state.mode;
    if (resetFrames || sim && Number(sim.cursor) < previousCursor) {
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
    const liveNodes = new Set((state.scene?.nodes || []).map((node) => node.id));
    const liveEdges = new Set((state.scene?.edges || []).map((edge) => edge.id));
    let staleSelection = false;
    for (const id of [...state.multi?.nodes || []]) {
      if (!liveNodes.has(id)) {
        state.multi.nodes.delete(id);
        staleSelection = true;
      }
    }
    for (const id of [...state.multi?.edges || []]) {
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
      const missing = (degraded.missing || []).map((item) => `${item.id}@v${item.version}`).join("\u3001");
      showBanner(`\u964D\u7EA7\u53EA\u8BFB\uFF1A${degraded.message}${missing ? `\uFF08\u7F3A\u5931\uFF1A${missing}\uFF09` : ""}`);
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
    if (state.selection.type === "node") return nodeById(state.selection.id);
    if (state.selection.type === "edge") return edgeById(state.selection.id);
    return null;
  }
  function syncUI() {
    if (state.workspace === "fem") {
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
    ui.simFps.title = `\u76EE\u6807 ${sim.config?.fps ?? "\u2014"} fps \xB7 \u5B9E\u9645 ${(sim.actual_fps ?? 0).toFixed(1)}`;
    const nodes = state.scene?.nodes?.length ?? 0;
    const edges = state.scene?.edges?.length ?? 0;
    const maxNodes = state.catalog?.limits?.nodes ?? state.limits?.nodes ?? 400;
    const maxEdges = state.catalog?.limits?.edges ?? state.limits?.edges ?? 1200;
    ui.statusLimits.textContent = `\u8282\u70B9 ${nodes}/${maxNodes} \xB7 \u8FDE\u63A5 ${edges}/${maxEdges}`;
    ui.statusMode.textContent = modeLabel(state.mode);
    const stats = sim.scene || {};
    const revision = state.scene?.revision ?? 0;
    if (stats.kind === "circuit") {
      ui.statusEngine.textContent = `MNA ${stats.matrix_size || 0}\xD7${stats.matrix_size || 0}`;
    } else if (stats.kind === "vector") {
      ui.statusEngine.textContent = `\u77E2\u91CF\u6D41 \xB7 rev ${revision}`;
    } else if (stats.kind === "signal") {
      ui.statusEngine.textContent = `\u5B57\u5178\u6D41 \xB7 rev ${revision}`;
    } else {
      ui.statusEngine.textContent = "\u2014";
    }
    let hint = sim.running ? "\u8FD0\u884C\u4E2D" : "\u5DF2\u6682\u505C";
    if (sim.config) {
      hint += ` \xB7 ${sim.config.fps} fps \xD7 ${sim.config.steps_per_frame} \u6B65 \xB7 dt ${fmt(sim.config.dt, 3)}`;
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
    ui.modePill.classList.toggle("circuit", state.mode === "circuit");
    ui.modePill.classList.toggle("vector", state.mode === "vector");
    ui.modePill.textContent = modeLabel(state.mode);
    updateScenePanelValues();
    schedulePhaseDraw();
  }
  function updateModeUI() {
    ui.modePill.classList.toggle("circuit", state.mode === "circuit");
    ui.modePill.classList.toggle("vector", state.mode === "vector");
    ui.modePill.textContent = modeLabel(state.mode);
    ui.statusMode.textContent = modeLabel(state.mode);
    ui.main.dataset.mode = state.mode;
    const modeHost = $('[data-role="mode"]');
    if (modeHost) {
      $$("button[data-mode]", modeHost).forEach((item) => {
        item.classList.toggle("active", item.dataset.mode === state.mode);
      });
    }
    const integration = $('[data-role="integration"]');
    if (integration) {
      integration.disabled = state.mode !== "circuit";
      if (state.scene) integration.value = state.scene.integration || "trapezoidal";
    }
    const integrationNote = $('[data-role="integration-note"]');
    if (integrationNote) {
      integrationNote.textContent = state.mode === "circuit" ? "\u68AF\u5F62\u6CD5\u7CBE\u5EA6\u9AD8\uFF1B\u540E\u5411\u6B27\u62C9\u66F4\u7A33\u5B9A\uFF0C\u9002\u5408\u521A\u6027\u7535\u8DEF\u3002" : "\u4EC5\u7535\u8DEF\u6A21\u5F0F\u4F7F\u7528\uFF1B\u4FE1\u53F7 / \u77E2\u91CF\u5C42\u7531\u6BCF\u6761\u8FDE\u63A5\u7684\u79BB\u6563\u5316\u53C2\u6570\u51B3\u5B9A\u3002";
    }
  }
  function updateRunButton(running) {
    ui.runBtn.classList.toggle("running", Boolean(running));
    ui.runBtn.setAttribute("aria-pressed", running ? "true" : "false");
    ui.runIcon.textContent = running ? "\u23F8" : "\u25B6";
    ui.runLabel.textContent = running ? "\u6682\u505C" : "\u8FD0\u884C";
    ui.runBtn.title = running ? "\u6682\u505C\uFF08\u7A7A\u683C\uFF09" : "\u8FD0\u884C\uFF08\u7A7A\u683C\uFF09";
  }
  function frameCap() {
    const keys = Math.max(1, Number(state.sim?.probe_keys?.length) || state.values.size || 1);
    return Math.min(MAX_FRAMES, Math.max(600, Math.floor(25e4 / keys)));
  }
  function updateSignalKeyCache() {
    const keys = Array.isArray(state.sim?.probe_keys) ? state.sim.probe_keys : [];
    const signature = keys.join("");
    if (signature === state.probeSignature) return;
    state.probeSignature = signature;
    state.probeKeys = keys;
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
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
      state.values.set(key, raw);
      if (key.startsWith("n:")) {
        const rest = key.slice(2);
        const cut = rest.lastIndexOf(":");
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
      } else if (key.startsWith("e:")) {
        const rest = key.slice(2);
        const cut = rest.lastIndexOf(":");
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
        if (typeof value === "number" && Number.isFinite(value)) merged[key] = value;
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
        if (typeof value === "number" && Number.isFinite(value)) merged[key] = value;
      }
    }
    return merged;
  }
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
    const wrap = $(".chart-wrap");
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
      y: state.view.y + point.y * state.view.k
    };
  }
  function screenToWorld(x, y) {
    return {
      x: (x - state.view.x) / state.view.k,
      y: (y - state.view.y) / state.view.k
    };
  }
  function nodeDiameter(node) {
    if (state.scene?.mode === "circuit" && state.ui?.symbol === "gb" && node && (node.kind === "node" || node.kind === "ground") && (state.ui?.nodeStyle || "circle") !== "box") {
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
    const radius = nodeDiameter(node) / 2 * k;
    const center = worldToScreen(node.position || { x: 0, y: 0 });
    return {
      x: center.x - radius,
      y: center.y - radius,
      w: radius * 2,
      h: radius * 2,
      r: radius,
      cx: center.x,
      cy: center.y,
      shape: "circle"
    };
  }
  function deviceElementSpec(node) {
    const element = String(node?.params?.element || "");
    return (state.catalog?.elements || []).find((spec) => spec.kind === element) || null;
  }
  function isModuleNode(node) {
    return state.scene?.mode === "circuit" && node?.kind === "module";
  }
  function isPinNode(node) {
    return state.scene?.mode === "circuit" && (node?.kind === "device" || node?.kind === "module");
  }
  function modulePorts(node) {
    return Array.isArray(node?.params?.ports) ? node.params.ports : [];
  }
  function devicePins(node) {
    if (node?.kind === "module") {
      return modulePorts(node).map((port) => ({
        name: String(port?.name || ""),
        role: port?.direction === "input" ? "input" : port?.direction === "output" ? "output" : "passive",
        required: false,
        module: true
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
      if (pin.role === "input") left.push(pin);
      else if (pin.role === "output") right.push(pin);
      else if (pin.role === "power") {
        const name = String(pin.name || "");
        const positive = name.includes("+") || /VCC|VDD/i.test(name);
        (positive ? top : bottom).push(pin);
      } else if (pin.role === "bidirectional") (index < half ? left : right).push(pin);
      else (passiveIndex++ % 2 === 0 ? left : right).push(pin);
    });
    return { left, right, top, bottom };
  }
  function deviceWorldSize(node) {
    const groups = devicePinGroups(node);
    const maxSide = Math.max(
      groups.left.length,
      groups.right.length,
      groups.top.length,
      groups.bottom.length,
      1
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
      shape: "rect"
    };
  }
  function devicePinLocal(node, pin) {
    const { w, h } = deviceWorldSize(node);
    const groups = devicePinGroups(node);
    const leftIndex = groups.left.findIndex((item) => item.name === pin.name);
    if (leftIndex >= 0) {
      return { x: -w / 2, y: -h / 2 + (leftIndex + 1) * h / (groups.left.length + 1), side: "left" };
    }
    const rightIndex = groups.right.findIndex((item) => item.name === pin.name);
    if (rightIndex >= 0) {
      return { x: w / 2, y: -h / 2 + (rightIndex + 1) * h / (groups.right.length + 1), side: "right" };
    }
    const bottomIndex = groups.bottom.findIndex((item) => item.name === pin.name);
    if (bottomIndex >= 0) {
      return { x: -w / 2 + (bottomIndex + 1) * w / (groups.bottom.length + 1), y: h / 2, side: "bottom" };
    }
    const topIndex = groups.top.findIndex((item) => item.name === pin.name);
    if (topIndex >= 0) {
      return { x: -w / 2 + (topIndex + 1) * w / (groups.top.length + 1), y: -h / 2, side: "top" };
    }
    return { x: 0, y: 0, side: "center" };
  }
  function devicePinWired(node, pinName) {
    return (state.scene?.edges || []).some((edge) => {
      if (edge.kind !== "wire" || !edge.enabled) return false;
      if (edge.source === node.id && edge.source_pin === pinName) return true;
      return edge.target === node.id && edge.target_pin === pinName;
    });
  }
  function deviceSupplyLabel(node, pin) {
    const element = String(node?.params?.element || "");
    if (!["opamp", "comparator"].includes(element)) return pin.name;
    if (pin.name !== "V+" && pin.name !== "V-") return pin.name;
    if (devicePinWired(node, pin.name)) return pin.name;
    const value = pin.name === "V+" ? node.params.vcc : node.params.vee;
    if (!Number.isFinite(Number(value))) return pin.name;
    const text = `${Number(value).toPrecision(3)}V`;
    return `${pin.name} ${text}`;
  }
  function deviceMissingPins(node) {
    return devicePins(node).filter((pin) => pin.required && !devicePinWired(node, pin.name)).map((pin) => pin.name);
  }
  function deviceImplicitGroundPin(node) {
    const element = String(node?.params?.element || "");
    if (!["vsource", "isource"].includes(element)) return null;
    const missing = deviceMissingPins(node);
    return missing.length === 1 ? missing[0] : null;
  }
  function deviceInactive(node) {
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
        p3: { x: s.cx - s.r, y: s.cy - s.r * 0.22 }
      };
    }
    const dx = t.cx - s.cx;
    const dy = t.cy - s.cy;
    const length = Math.max(1, Math.hypot(dx, dy));
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
        y: start.y + dy * 0.33 + normal.y * bend
      },
      p2: {
        x: start.x + dx * 0.67 + normal.x * bend,
        y: start.y + dy * 0.67 + normal.y * bend
      },
      p3: end
    };
  }
  function nodeCenterScreen(node) {
    const rect = nodeRect(node);
    return { x: rect.cx, y: rect.cy };
  }
  function anchorPoint(node, side, toward) {
    const rect = nodeRect(node);
    if (side === "left") return { x: rect.cx - rect.r, y: rect.cy };
    if (side === "right") return { x: rect.cx + rect.r, y: rect.cy };
    if (side === "top") return { x: rect.cx, y: rect.cy - rect.r };
    if (side === "bottom") return { x: rect.cx, y: rect.cy + rect.r };
    const dx = toward.x - rect.cx;
    const dy = toward.y - rect.cy;
    const length = Math.max(1, Math.hypot(dx, dy));
    return { x: rect.cx + dx / length * rect.r, y: rect.cy + dy / length * rect.r };
  }
  function edgeEndpointHit(point) {
    const edge = selectedEdge();
    if (!edge) return null;
    const points = edgePathPoints(edge);
    if (!points || points.length < 2) return null;
    const ends = [
      { end: "source", p: points[0] },
      { end: "target", p: points[points.length - 1] }
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
    if (selected && selected.route === "manual") candidates.push(selected);
    if (includeUnselected) {
      for (const edge of state.scene?.edges || []) {
        if (edge.route !== "manual" || edge === selected) continue;
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
          y: state.view.y + wy * state.view.k
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
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 1.9) return "auto";
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
    return dy >= 0 ? "bottom" : "top";
  }
  function anchorScreenPoint(node, side) {
    const rect = nodeRect(node);
    const r = rect.r;
    if (side === "left") return { x: rect.cx - r, y: rect.cy };
    if (side === "right") return { x: rect.cx + r, y: rect.cy };
    if (side === "top") return { x: rect.cx, y: rect.cy - r };
    if (side === "bottom") return { x: rect.cx, y: rect.cy + r };
    return { x: rect.cx, y: rect.cy };
  }
  function edgePathPoints(edge) {
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    if (!source || !target) return null;
    const pinned = circuitPinPath(edge, source, target);
    if (pinned) return pinned;
    if (edge.kind === "wire" && state.scene?.mode === "circuit") {
      return wirePathPoints(edge, source, target);
    }
    const sc = nodeCenterScreen(source);
    const tc = nodeCenterScreen(target);
    if (edge.source === edge.target) {
      const r = nodeRect(source).r;
      const curve2 = {
        p0: { x: sc.x + r, y: sc.y - r * 0.22 },
        p1: { x: sc.x + r + 92 * state.view.k, y: sc.y - r - 88 * state.view.k },
        p2: { x: sc.x - r - 92 * state.view.k, y: sc.y - r - 88 * state.view.k },
        p3: { x: sc.x - r, y: sc.y - r * 0.22 }
      };
      const points2 = [];
      for (let index = 0; index <= 20; index += 1) points2.push(bezierPoint(curve2, index / 20));
      return points2;
    }
    const start = anchorPoint(source, edge.anchors?.source || "auto", tc);
    const end = anchorPoint(target, edge.anchors?.target || "auto", sc);
    let route = edge.route || "auto";
    if (route === "auto" && state.scene?.mode === "circuit" && state.ui?.circuitOrthogonal !== false) route = "orthogonal";
    if (route === "straight") return [start, end];
    if (route === "orthogonal") {
      if (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)) {
        const midX = (start.x + end.x) / 2;
        return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
      }
      const midY = (start.y + end.y) / 2;
      return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
    }
    if (route === "manual" && Array.isArray(edge.waypoints) && edge.waypoints.length) {
      const points2 = [start];
      for (const item of edge.waypoints) points2.push(worldToScreen(item));
      points2.push(end);
      return points2;
    }
    const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
    const c1 = horizontal ? { x: start.x + (end.x - start.x) * 0.4, y: start.y } : { x: start.x, y: start.y + (end.y - start.y) * 0.4 };
    const c2 = horizontal ? { x: end.x - (end.x - start.x) * 0.4, y: end.y } : { x: end.x, y: end.y - (end.y - start.y) * 0.4 };
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
      if (length < 1e-3) continue;
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
          y: segment.a.y + (segment.b.y - segment.a.y) * r
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
    let source = "velocity";
    if (typeof vx !== "number" || !Number.isFinite(vx) || typeof vy !== "number" || !Number.isFinite(vy)) {
      vx = data.x;
      vy = data.y;
      source = "position";
    }
    if (typeof vx !== "number" || !Number.isFinite(vx) || typeof vy !== "number" || !Number.isFinite(vy)) {
      vx = data.x1;
      vy = data.x2;
      source = "state";
    }
    if (typeof vx !== "number" || !Number.isFinite(vx) || typeof vy !== "number" || !Number.isFinite(vy)) {
      return null;
    }
    const magnitude = Math.hypot(vx, vy);
    if (!Number.isFinite(magnitude) || magnitude < 1e-9) return null;
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
      y: a * curve.p0.y + b * curve.p1.y + c * curve.p2.y + d * curve.p3.y
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
    manual: "MANUAL",
    sum: "SUM",
    gain: "GAIN",
    lag: "LAG",
    integrate: "INT",
    signal: "SIGNAL",
    expression: "EXPR",
    state_space: "STATE",
    clip: "CLIP",
    oscillator: "OSC",
    nonlinear_plant: "PLANT",
    sliding_mode: "SMC",
    vector_transform: "VECTOR",
    node: "NODE",
    ground: "GROUND"
  };
  const KIND_COLORS = {
    oscillator: "#a8541f",
    nonlinear_plant: "#1f5f5b",
    sliding_mode: "#7a4a7c",
    vector_transform: "#4a6f8a"
  };
  function nodeColor(node) {
    if (node.kind === "ground") return C("#6f695f");
    if (state.mode === "circuit") return C("#9a6a1c");
    if (KIND_COLORS[node.kind]) return C(KIND_COLORS[node.kind]);
    const spec = getNodeSpec(node.kind);
    return C(GROUP_COLORS[spec?.group] || "#a8541f");
  }
  function nodeKindLabel(node) {
    return KIND_SHORT[node.kind] || String(node.kind || "").toUpperCase().slice(0, 9);
  }
  function nodeValueText(node) {
    const data = nodeDisplayData(node);
    const fields = Object.keys(data).filter((key) => typeof data[key] === "number" && Number.isFinite(data[key]));
    if (!fields.length) return "\u2014";
    const preferred = ["voltage", "value", "y0", "output", "acc", "x1", "x", "y", "vx", "vy"].find((key) => fields.includes(key));
    const ordered = preferred ? [preferred, ...fields.filter((key) => key !== preferred)] : fields;
    return ordered.slice(0, 2).map((key) => `${key} ${fmt(data[key], 3)}`).join("  \xB7  ");
  }
  function edgeValueText(edge) {
    const data = edgeDisplayData(edge);
    const field = ["current", "voltage_difference", "power", "voltage"].find((key) => typeof data[key] === "number");
    return field ? `${field} ${fmt(data[field], 3)}` : "";
  }
  const __gridPattern = { key: "", pattern: null };
  function gridPattern(step, dpr, color) {
    const key = `${step.toFixed(3)}|${dpr}|${color}`;
    if (__gridPattern.key === key) return __gridPattern.pattern;
    try {
      const tile = document.createElement("canvas");
      const size = Math.max(1, Math.round(step * dpr));
      tile.width = size;
      tile.height = size;
      const tctx = tile.getContext("2d");
      tctx.scale(dpr, dpr);
      tctx.fillStyle = color;
      tctx.fillRect(0, 0, 1, 1);
      __gridPattern.key = key;
      __gridPattern.pattern = ctx.createPattern(tile, "repeat");
    } catch (error) {
      __gridPattern.key = key;
      __gridPattern.pattern = null;
    }
    return __gridPattern.pattern;
  }
  function drawGrid(width, height) {
    if (state.ui?.showGrid === false || state.ui?.drawingMode) return;
    let step = (Number(state.ui?.grid) || 20) * state.view.k;
    while (step < 12) step *= 2;
    while (step > 84) step /= 2;
    const ox = (state.view.x % step + step) % step;
    const oy = (state.view.y % step + step) % step;
    const pattern = gridPattern(step, state.canvasSize?.dpr || 1, tokens().gridDot);
    if (pattern) {
      ctx.save();
      ctx.translate(Math.round(ox), Math.round(oy));
      ctx.fillStyle = pattern;
      ctx.fillRect(-1, -1, width + 2, height + 2);
      ctx.restore();
    } else {
      ctx.fillStyle = tokens().gridDot;
      for (let x = ox; x < width; x += step) {
        for (let y = oy; y < height; y += step) {
          ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
        }
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
    const dragging = state.drag && ["node", "waypoint", "resize", "endpoint"].includes(state.drag.type);
    const pointer = state.pointer;
    if (dragging && state.ui?.snapMarkers !== false && state.ui?.snap && pointer && Number.isFinite(pointer.x) && Number.isFinite(pointer.y)) {
      const grid = Number(state.ui?.grid) || 20;
      const snapped = {
        x: Math.round(pointer.x / grid) * grid,
        y: Math.round(pointer.y / grid) * grid
      };
      const sp = worldToScreen(snapped.x, snapped.y);
      const size = 7;
      ctx.strokeStyle = C("rgba(168, 84, 31, 0.85)");
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(sp.x - size, sp.y);
      ctx.lineTo(sp.x + size, sp.y);
      ctx.moveTo(sp.x, sp.y - size);
      ctx.lineTo(sp.x, sp.y + size);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, size + 3, 0, Math.PI * 2);
      ctx.strokeStyle = C("rgba(168, 84, 31, 0.35)");
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
    const center = layout && Number.isFinite(layout.x) && Number.isFinite(layout.y) ? worldToScreen({ x: layout.x, y: layout.y }) : mid;
    const angle = layout && Number.isFinite(Number(layout.rot)) ? Number(layout.rot) * Math.PI / 180 : circuitMidAngle(points);
    const scale = symbolScalePx();
    const theme = C(state.ui?.glyphColor || "#1f5f5b");
    const glyphColor = color === "#a8541f" ? C("#a8541f") : theme;
    const ctx2 = ctx;
    ctx2.save();
    ctx2.translate(center.x, center.y);
    ctx2.rotate(angle);
    ctx2.scale(scale, scale);
    ctx2.strokeStyle = glyphColor;
    ctx2.fillStyle = glyphColor;
    ctx2.lineWidth = 1.25;
    ctx2.lineCap = "round";
    ctx2.lineJoin = "round";
    const S = 9;
    const line = (x1, y1, x2, y2) => {
      ctx2.beginPath();
      ctx2.moveTo(x1, y1);
      ctx2.lineTo(x2, y2);
      ctx2.stroke();
    };
    const poly = (coords) => {
      ctx2.beginPath();
      ctx2.moveTo(coords[0], coords[1]);
      for (let i = 2; i < coords.length; i += 2) ctx2.lineTo(coords[i], coords[i + 1]);
      ctx2.stroke();
    };
    const kind = String(edge.kind || "");
    if (kind === "wire") return;
    if (kind === "resistor") {
      poly([-S, 0, -6, 0, -4.5, -4, -1.5, 4, 1.5, -4, 4.5, 4, 6, 0, S, 0]);
    } else if (kind === "capacitor") {
      line(-S, 0, -2.5, 0);
      line(2.5, 0, S, 0);
      line(-2.5, -6, -2.5, 6);
      line(2.5, -6, 2.5, 6);
    } else if (kind === "inductor") {
      ctx2.beginPath();
      ctx2.arc(-5, 0, 2.8, Math.PI, 0, false);
      ctx2.arc(0, 0, 2.8, Math.PI, 0, false);
      ctx2.arc(5, 0, 2.8, Math.PI, 0, false);
      ctx2.stroke();
      line(-S, 0, -7.8, 0);
      line(7.8, 0, S, 0);
    } else if (kind === "vsource" || kind === "isource") {
      ctx2.beginPath();
      ctx2.arc(0, 0, 6.5, 0, Math.PI * 2);
      ctx2.stroke();
      line(-S, 0, -6.5, 0);
      line(6.5, 0, S, 0);
      if (kind === "vsource") {
        line(-3, -2.5, 1, -2.5);
        line(-1, -4.5, -1, -0.5);
        line(-3, 2.5, 1, 2.5);
      } else {
        line(-1, -2.5, 1, -2.5);
        line(0, -4, 0, -1);
        line(0, -1, -1.2, 0.4);
        line(0, -1, 1.2, 0.4);
      }
    } else if (kind === "diode" || kind === "led" || kind === "zener") {
      line(-S, 0, -4, 0);
      ctx2.beginPath();
      ctx2.moveTo(-4, -5);
      ctx2.lineTo(-4, 5);
      ctx2.lineTo(4, 0);
      ctx2.closePath();
      ctx2.fill();
      line(4, -5.5, 4, 5.5);
      line(4, 0, S, 0);
      if (kind === "zener") {
        line(4, -5.5, 1.5, -5.5);
        line(4, 5.5, 6.5, 5.5);
      }
      if (kind === "led") {
        line(1, -7, 4, -10);
        line(1.5, -10, 4, -10);
        line(4, -7, 7, -10);
        line(4.5, -10, 7, -10);
      }
    } else if (kind === "switch") {
      line(-S, 0, -3, 0);
      line(-3, 0, 5, -5);
      line(5, 0, S, 0);
      ctx2.beginPath();
      ctx2.arc(-3, 0, 1.1, 0, Math.PI * 2);
      ctx2.fill();
    } else if (kind === "vcvs" || kind === "vccs") {
      ctx2.beginPath();
      ctx2.moveTo(0, -6);
      ctx2.lineTo(8, 0);
      ctx2.lineTo(0, 6);
      ctx2.lineTo(-8, 0);
      ctx2.closePath();
      ctx2.stroke();
      line(-S, 0, -8, 0);
      line(8, 0, S, 0);
      if (kind === "vcvs") {
        line(-3.5, -1.5, -0.5, -1.5);
        line(-2, -3, -2, 0);
        line(-3.5, 2, -0.5, 2);
      } else {
        line(-3, 1, 2, 1);
        line(0.6, -0.2, 2, 1);
        line(0.6, 2.2, 2, 1);
      }
    } else if (kind === "opamp" || kind === "comparator") {
      ctx2.beginPath();
      ctx2.moveTo(-6, -7);
      ctx2.lineTo(-6, 7);
      ctx2.lineTo(8, 0);
      ctx2.closePath();
      ctx2.stroke();
      line(-S, 0, -6, 0);
      line(8, 0, S, 0);
      ctx2.font = '7px "Cascadia Code", Consolas, monospace';
      ctx2.textAlign = "center";
      ctx2.textBaseline = "middle";
      ctx2.fillText("+", -3.5, -2.6);
      ctx2.fillText("\u2212", -3.5, 2.6);
      if (kind === "comparator") {
        line(-4, 5.2, 2, 5.2);
      }
    } else if (kind === "npn" || kind === "pnp") {
      ctx2.beginPath();
      ctx2.arc(0, 0, 6.5, 0, Math.PI * 2);
      ctx2.stroke();
      line(-S, 0, -5, 0);
      line(-5, -5, -5, 5);
      line(-5, -2.5, 4, -6);
      line(-5, 2.5, 4, 6);
      line(4, 6, 1, 4.6);
      line(4, 6, 3, 3);
    } else if (kind === "nmos" || kind === "pmos") {
      line(-S, 0, -5, 0);
      line(-5, -5, -5, 5);
      line(-2.5, -5, -2.5, 5);
      line(-2.5, -4, 5, -4);
      line(5, -4, 5, -6);
      line(-2.5, 4, 5, 4);
      line(5, 4, 5, 6);
    } else if (kind === "thyristor") {
      line(-S, 0, -4, 0);
      ctx2.beginPath();
      ctx2.moveTo(-4, -5);
      ctx2.lineTo(-4, 5);
      ctx2.lineTo(4, 0);
      ctx2.closePath();
      ctx2.fill();
      line(4, -5.5, 4, 5.5);
      line(4, 0, S, 0);
      line(-4, -1.5, -8, 4.5);
      line(-8, 4.5, -6.5, 4.5);
    } else if (kind === "igbt") {
      line(-S, 0, -6, 0);
      line(-4, -5, -4, 5);
      line(-2.5, -5, -2.5, 5);
      line(-2.5, -4, 6, -4);
      line(6, -4, 6, -7);
      line(-2.5, 4, 6, 4);
      line(6, 4, 6, 7);
      line(-2.5, 0, 2, 0);
      line(2, 0, 2, 3);
    } else if (kind === "jfet") {
      line(-S, 0, -5, 0);
      line(-4, -5, -4, 5);
      line(-2, -5, -2, 5);
      line(-2, -4, 6, -4);
      line(6, -4, 6, -7);
      line(-2, 4, 6, 4);
      line(6, 4, 6, 7);
      line(-4, 0, 2, 0);
      line(2, 0, 0.5, -1.5);
      line(2, 0, 0.5, 1.5);
    } else if (kind === "relay") {
      ctx2.strokeRect(-8, -5.5, 8, 11);
      line(-S, 0, -8, 0);
      line(0, -5.5, 0, -9);
      line(0, 5.5, 0, 9);
      line(0, 5.5, 7, 5.5);
      line(7, 5.5, 7, 1);
      ctx2.beginPath();
      ctx2.arc(7, 0, 1.2, 0, Math.PI * 2);
      ctx2.fill();
      line(7, -1.2, S, -1.2);
    } else if (kind === "motor") {
      ctx2.beginPath();
      ctx2.arc(0, 0, 7, 0, Math.PI * 2);
      ctx2.stroke();
      line(-S, 0, -7, 0);
      line(7, 0, S, 0);
      ctx2.font = '8px "Cascadia Code", Consolas, monospace';
      ctx2.textAlign = "center";
      ctx2.textBaseline = "middle";
      ctx2.fillText("M", 0, 0.5);
    } else if (kind === "dflipflop") {
      ctx2.strokeRect(-7, -7, 14, 14);
      line(-7, 4, -10, 6);
      line(-10, 6, -7, 6);
      line(-4, 7, -4, 9);
      line(-4, 7, -2, 7);
      line(7, -2, 10, -2);
      line(7, 2, 10, 2);
      ctx2.font = '5.5px "Cascadia Code", Consolas, monospace';
      ctx2.fillText("D", -3.5, -5);
      ctx2.fillText("Q", 4, -5);
      ctx2.fillText("CLK", -3.5, 5.4);
    } else if (kind === "transformer" || kind === "coupling_inductor") {
      const coil = (y) => {
        for (const cx of [-4.8, 0, 4.8]) {
          ctx2.beginPath();
          ctx2.arc(cx, y, 2.3, Math.PI, 0, false);
          ctx2.stroke();
        }
      };
      line(-S, 0, -7.1, 0);
      line(7.1, 0, S, 0);
      coil(0);
      if (kind === "transformer") {
        line(-8, -3.4, 8, -3.4);
        line(-8, -6.2, 8, -6.2);
      } else {
        ctx2.setLineDash([2, 2]);
        line(-8, -4.8, 8, -4.8);
        ctx2.setLineDash([]);
      }
      coil(-9.6);
    } else if (kind === "adc4") {
      ctx2.strokeRect(-7, -7, 14, 14);
      ctx2.font = '5px "Cascadia Code", Consolas, monospace';
      ctx2.textAlign = "center";
      ctx2.textBaseline = "middle";
      ctx2.fillText("ADC", 0, -3.6);
      line(-4, 3.6, -1.5, 3.6);
      line(-1.5, 3.6, -1.5, 1.4);
      line(-1.5, 1.4, 1, 1.4);
      line(1, 1.4, 1, -0.2);
      line(-S, 0, -7, 0);
      line(7, 0, S, 0);
    } else {
      ctx2.strokeRect(-7, -6, 14, 12);
      ctx2.font = '6px "Cascadia Code", Consolas, monospace';
      ctx2.textAlign = "center";
      ctx2.textBaseline = "middle";
      ctx2.fillText(kind.slice(0, 6), 0, 0);
    }
    ctx2.restore();
  }
  function elementValueText(edge) {
    const params = edge.params || {};
    const kind = String(edge.kind || "");
    const unit = (value, suffix) => value == null ? "" : `${Number(value).toPrecision(4)}${suffix}`;
    if (kind === "resistor") return unit(params.R, " \u03A9");
    if (kind === "capacitor") return unit(params.C, " F");
    if (kind === "inductor") return unit(params.L, " H");
    if (kind === "diode" || kind === "led") return `${kind === "led" ? "LED" : "D"}`;
    if (kind === "zener") return `Vz=${unit(params.Vz, " V")}`;
    if (kind === "vsource" || kind === "isource") {
      const wave = params.wave || "dc";
      if (wave === "dc") return `DC ${unit(params.offset, " V")}`;
      return `${wave} ${unit(params.amplitude, " V")} / ${unit(params.frequency, " Hz")}`;
    }
    if (kind === "vcvs" || kind === "vccs") return `gain=${unit(params.gain, "")}`;
    if (kind === "opamp" || kind === "comparator") return `A=${unit(params.gain, "")}`;
    if (kind === "switch") return params.closed ? "\u95ED\u5408" : "\u65AD\u5F00";
    if (kind === "dflipflop") return `Q\u2080=${unit(params.q0, " V")}`;
    return "";
  }
  function circuitWireGap(points, middle, gapLength) {
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
    ctx.strokeStyle = C("#f7f4ec");
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
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
    if (state.scene?.mode !== "circuit" || state.ui?.symbol !== "gb") return;
    const degree = /* @__PURE__ */ new Map();
    for (const edge of state.scene.edges || []) {
      if (!edge.enabled) continue;
      for (const key of [edge.source, edge.target]) {
        degree.set(key, (degree.get(key) || 0) + 1);
      }
    }
    for (const node of state.scene.nodes || []) {
      const count = degree.get(node.id) || 0;
      if (count < 3 || node.kind === "ground") continue;
      const center = nodeCenterScreen(node);
      ctx.beginPath();
      ctx.arc(center.x, center.y, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = C("#4d463c");
      ctx.fill();
      ctx.strokeStyle = C("#f7f4ec");
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  const ELEMENT_PIN_GEOMETRY = {
    opamp: [
      { name: "IN+", x: -6.5, y: -4.5, bind: "vp", role: "in" },
      { name: "IN-", x: -6.5, y: 4.5, bind: "vn", role: "in" },
      { name: "OUT", x: 8, y: 0, bind: "source", role: "out" }
    ],
    comparator: [
      { name: "IN+", x: -6.5, y: -4.5, bind: "vp", role: "in" },
      { name: "IN-", x: -6.5, y: 4.5, bind: "vn", role: "in" },
      { name: "OUT", x: 8, y: 0, bind: "source", role: "out" }
    ],
    dflipflop: [
      { name: "D", x: -7, y: -4, bind: "d_node", role: "in" },
      { name: "CLK", x: -7, y: 4, bind: "clk_node", role: "in" },
      { name: "Q", x: 7, y: 0, bind: "source", role: "out" }
    ],
    transformer: [
      { name: "S1", x: -7.1, y: -9.6, bind: "secondary_source", role: "out" },
      { name: "S2", x: 7.1, y: -9.6, bind: "secondary_target", role: "out" }
    ],
    coupling_inductor: [
      { name: "S1", x: -7.1, y: -9.6, bind: "secondary_source", role: "out" },
      { name: "S2", x: 7.1, y: -9.6, bind: "secondary_target", role: "out" }
    ],
    adc4: [
      { name: "VIN", x: -7, y: -4, bind: "vin_node", role: "in" },
      { name: "CLK", x: -7, y: 4, bind: "clk_node", role: "in" },
      { name: "Q0", x: 7, y: -6, bind: "source", role: "out" },
      { name: "Q1", x: 7, y: -2, bind: "q1_node", role: "out" },
      { name: "Q2", x: 7, y: 2, bind: "q2_node", role: "out" },
      { name: "Q3", x: 7, y: 6, bind: "q3_node", role: "out" },
      { name: "COM", x: 0, y: 7, bind: "target", role: "power" }
    ],
    thyristor: [
      { name: "A", x: 7, y: -4.5, bind: "source", role: "out" },
      { name: "K", x: 7, y: 4.5, bind: "target", role: "out" },
      { name: "G", x: -7, y: 4.5, bind: "gate_node", role: "in" }
    ],
    igbt: [
      { name: "C", x: 6, y: -7, bind: "source", role: "out" },
      { name: "E", x: 6, y: 7, bind: "target", role: "out" },
      { name: "G", x: -6, y: 0, bind: "gate_node", role: "in" }
    ],
    jfet: [
      { name: "D", x: 6, y: -7, bind: "source", role: "out" },
      { name: "S", x: 6, y: 7, bind: "target", role: "out" },
      { name: "G", x: -6, y: 0, bind: "gate_node", role: "in" }
    ],
    relay: [
      { name: "COIL1", x: -8, y: -9, bind: "source", role: "in" },
      { name: "COIL2", x: 0, y: 9, bind: "target", role: "in" },
      { name: "COM", x: 0, y: 9, bind: "com_node", role: "out" },
      { name: "NO", x: 7, y: -1.2, bind: "no_node", role: "out" }
    ],
    motor: [
      { name: "+", x: -18, y: 0, bind: "source", role: "in" },
      { name: "-", x: 18, y: 0, bind: "target", role: "out" }
    ]
  };
  function elementPins(edge) {
    return ELEMENT_PIN_GEOMETRY[edge.kind] || [
      { name: "pin1", x: -18, y: 0, bind: "source", role: "passive" },
      { name: "pin2", x: 18, y: 0, bind: "target", role: "passive" }
    ];
  }
  function elementLayoutCenter(edge, points) {
    if (edge.layout && Number.isFinite(edge.layout.x) && Number.isFinite(edge.layout.y)) {
      return worldToScreen(edge.layout);
    }
    return pathMidpoint(points) || { x: 0, y: 0 };
  }
  function elementRot(edge) {
    if (edge.layout && Number.isFinite(Number(edge.layout.rot))) return Number(edge.layout.rot) * Math.PI / 180;
    return 0;
  }
  function symbolScalePx() {
    const base = Math.max(2, Math.min(3, state.view.k * 2.4));
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
    return anchorPoint(node, "auto", other);
  }
  function circuitPinPath(edge, source, target) {
    if (state.scene?.mode !== "circuit" || state.ui?.symbol !== "gb") return null;
    if (edge.kind === "wire") return null;
    if (!edge.layout) return null;
    if (edge.route === "manual" && Array.isArray(edge.waypoints) && edge.waypoints.length) return null;
    const pins = elementPins(edge);
    if (pins.length !== 2) return null;
    const binds = new Set(pins.map((pin) => pin.bind));
    if (!binds.has("source") || !binds.has("target")) return null;
    const start = edgeAnchorTowards(source, target);
    const end = edgeAnchorTowards(target, source);
    const pin1 = pinScreenPoint(edge, pins[0], [start, end]);
    const pin2 = pinScreenPoint(edge, pins[1], [start, end]);
    return [start, pin1, pin2, end];
  }
  function wirePathPoints(edge, source, target) {
    const start = isPinNode(source) ? devicePinScreen(source, edge.source_pin) : anchorPoint(source, "auto", nodeCenterScreen(target));
    const end = isPinNode(target) ? devicePinScreen(target, edge.target_pin) : anchorPoint(target, "auto", nodeCenterScreen(source));
    let route = edge.route || "auto";
    if (route === "auto" && state.ui?.circuitOrthogonal !== false) route = "orthogonal";
    if (route === "manual" && Array.isArray(edge.waypoints) && edge.waypoints.length) {
      return [start, ...edge.waypoints.map((item) => worldToScreen(item)), end];
    }
    if (route === "straight") return [start, end];
    if (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)) {
      const midX = (start.x + end.x) / 2;
      return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
    }
    const midY = (start.y + end.y) / 2;
    return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
  }
  function drawMultiPinWires(edge, color) {
    if (state.scene?.mode !== "circuit" || state.ui?.symbol !== "gb" || !edge.layout) return;
    const pins = elementPins(edge);
    const multi = pins.length > 2;
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    if (!source || !target) return;
    const points = [nodeCenterScreen(source), nodeCenterScreen(target)];
    const center = elementLayoutCenter(edge, points);
    for (const pin of pins) {
      if (!pin.bind) continue;
      if (!multi && (pin.bind === "source" || pin.bind === "target")) continue;
      const nodeId = pin.bind === "source" ? edge.source : pin.bind === "target" ? edge.target : edge.params?.[pin.bind];
      const node = nodeId ? nodeById(nodeId) : null;
      if (!node) continue;
      const from = pinScreenPoint(edge, pin, points, symbolScalePx());
      const to = anchorPoint(node, "auto", center);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(to.x, to.y, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = C("#f7f4ec");
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
  function elementIdentifier(edge) {
    const name = String(edge.name || "");
    const kind = String(edge.kind || "");
    if (name) return name;
    const prefix = {
      resistor: "R",
      capacitor: "C",
      inductor: "L",
      diode: "D",
      led: "LED",
      zener: "ZD",
      vsource: "V",
      isource: "I",
      switch: "S",
      opamp: "U",
      comparator: "U",
      dflipflop: "U",
      vcvs: "E",
      vccs: "G",
      npn: "Q",
      pnp: "Q",
      nmos: "Q",
      pmos: "Q",
      transformer: "T",
      coupling_inductor: "L",
      adc4: "U"
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
    const map = /* @__PURE__ */ new Map();
    if (state.scene?.mode !== "circuit" || state.ui?.symbol !== "gb" || edges.length > 160) return map;
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
        if (points.length) map.set(second.id, [...map.get(second.id) || [], ...points]);
      }
    }
    return map;
  }
  function drawCrossingHops(points, color) {
    for (const point of points) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = C("#f7f4ec");
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
      [0, 0],
      [0, -14],
      [0, 14],
      [0, -28],
      [0, 28],
      [width / 2 + 12, 0],
      [-width / 2 - 12, 0]
    ];
    for (const [dx, dy] of candidates) {
      const rect = { x: cx + dx - width / 2, y: cy + dy - height / 2, w: width, h: height };
      const hit = occupied.some((item) => rect.x < item.x + item.w && rect.x + rect.w > item.x && rect.y < item.y + item.h && rect.y + rect.h > item.y);
      if (!hit) return rect;
    }
    return { x: cx - width / 2, y: cy - height / 2, w: width, h: height };
  }
  const SHEET_SIZES = {
    A4: { w: 297, h: 210, label: "A4" },
    A3: { w: 420, h: 297, label: "A3" },
    A2: { w: 594, h: 420, label: "A2" },
    A1: { w: 841, h: 594, label: "A1" }
  };
  function drawDrawingFrame(width, height) {
    if (state.scene?.mode !== "circuit") return;
    const sheet = SHEET_SIZES[String(state.ui?.drawingSheet || "A3")] || SHEET_SIZES.A3;
    const page = Math.max(1, Math.min(9, Number(state.ui?.drawingPage) || 1));
    const margin = 12;
    const scale = Math.min((width - margin * 2) / sheet.w, (height - margin * 2) / sheet.h);
    const pw = sheet.w * scale;
    const ph = sheet.h * scale;
    const x = (width - pw) / 2;
    const y = (height - ph) / 2;
    ctx.save();
    ctx.fillStyle = C("#fffdf8");
    ctx.fillRect(x, y, pw, ph);
    ctx.strokeStyle = C("#3b352c");
    ctx.lineWidth = 2.2;
    ctx.strokeRect(x, y, pw, ph);
    ctx.lineWidth = 0.9;
    ctx.strokeRect(x + 4, y + 4, pw - 8, ph - 8);
    const cols = 8;
    const rows = 6;
    ctx.font = '9px "Cascadia Code", Consolas, monospace';
    ctx.fillStyle = C("#5b554b");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 1; i < cols; i += 1) {
      const gx = x + pw * i / cols;
      ctx.beginPath();
      ctx.moveTo(gx, y + 4);
      ctx.lineTo(gx, y + 12);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(gx, y + ph - 4);
      ctx.lineTo(gx, y + ph - 12);
      ctx.stroke();
      ctx.fillText(String(i), gx, y + 16);
      ctx.fillText(String(i), gx, y + ph - 16);
    }
    for (let i = 1; i < rows; i += 1) {
      const gy = y + ph * i / rows;
      ctx.beginPath();
      ctx.moveTo(x + 4, gy);
      ctx.lineTo(x + 12, gy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + pw - 4, gy);
      ctx.lineTo(x + pw - 12, gy);
      ctx.stroke();
      ctx.fillText(String.fromCharCode(64 + i), x + 16, gy);
      ctx.fillText(String.fromCharCode(64 + i), x + pw - 16, gy);
    }
    const boxW = Math.min(pw * 0.58, 180 * scale);
    const boxH = Math.min(ph * 0.22, 56 * scale);
    const bx = x + pw - 4 - boxW;
    const by = y + ph - 4 - boxH;
    ctx.fillStyle = C("#fffdf8");
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = C("#3b352c");
    ctx.lineWidth = 1.1;
    ctx.strokeRect(bx, by, boxW, boxH);
    ctx.beginPath();
    ctx.moveTo(bx, by + boxH * 0.52);
    ctx.lineTo(bx + boxW, by + boxH * 0.52);
    ctx.moveTo(bx + boxW * 0.62, by);
    ctx.lineTo(bx + boxW * 0.62, by + boxH);
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = C("#11100e");
    ctx.font = '600 11px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText(state.project?.name || "\u672A\u547D\u540D\u5DE5\u7A0B", bx + 8, by + 14);
    ctx.font = '9px "Cascadia Code", Consolas, monospace';
    ctx.fillStyle = C("#6f695f");
    ctx.fillText(`${state.currentNetwork?.name || "\u7F51\u7EDC"} \xB7 ${sheet.label} \xB7 \u7B2C ${page} \u9875`, bx + 8, by + 30);
    ctx.fillText(`\u6BD4\u4F8B 1:1 \xB7 ${pipeModeLabel(state.scene?.mode || "")}`, bx + 8, by + boxH - 12);
    ctx.textAlign = "right";
    ctx.fillText("NetLab / GB", bx + boxW - 8, by + 14);
    ctx.fillText((/* @__PURE__ */ new Date()).toISOString().slice(0, 10), bx + boxW - 8, by + boxH - 12);
    ctx.restore();
  }
  function pipeModeLabel(mode) {
    if (mode === "circuit") return "\u7535\u8DEF";
    if (mode === "vector") return "\u77E2\u91CF\u573A";
    if (mode === "signal") return "\u4FE1\u53F7\u6D41";
    return mode;
  }
  function circuitPinSegments(edge, source, target) {
    if (state.scene?.mode !== "circuit" || state.ui?.symbol !== "gb" || !edge.layout) return null;
    const pins = elementPins(edge);
    if (pins.length !== 2) return null;
    const start = edgeAnchorTowards(source, target);
    const end = edgeAnchorTowards(target, source);
    const pin1 = pinScreenPoint(edge, pins[0], [start, end]);
    const pin2 = pinScreenPoint(edge, pins[1], [start, end]);
    const horizontal = Math.abs(Math.cos(elementRot(edge))) > 0.5;
    const before = horizontal ? [start, { x: pin1.x, y: start.y }, { x: pin1.x, y: pin1.y }, pin1] : [start, { x: start.x, y: pin1.y }, { x: pin1.x, y: pin1.y }, pin1];
    const after = horizontal ? [pin2, { x: pin2.x, y: end.y }, { x: end.x, y: end.y }, end] : [pin2, { x: pin2.x, y: end.y }, { x: end.x, y: end.y }, end];
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
      const selected = state.selection.type === "edge" && state.selection.id === edge.id || state.multi?.edges?.has(edge.id);
      const hovered = state.hover?.type === "edge" && state.hover.id === edge.id;
      let color = "#a49a89";
      if (!edge.enabled) color = "#d3ccbc";
      else if (edge.delay) color = "#b0762a";
      if (selected) color = C("#a8541f");
      else if (hovered) color = "#5f584e";
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = color;
      ctx.lineWidth = selected ? 2.1 : hovered ? 1.7 : state.ui?.drawingMode ? edge.kind === "wire" ? 1.75 : 1.3 : 1.15;
      if (!edge.enabled) ctx.setLineDash([3, 5]);
      else if (edge.delay) ctx.setLineDash([7, 5]);
      const circuitGb = state.scene?.mode === "circuit" && state.ui?.symbol === "gb";
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
        const center = layout && Number.isFinite(layout.x) && Number.isFinite(layout.y) ? worldToScreen({ x: layout.x, y: layout.y }) : middle;
        if (center && !multiPin && edge.kind !== "wire") circuitWireGap(points, center, 40 * Math.max(1.2, state.view.k));
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
      if (state.view.k > 0.38 && edge.kind !== "wire") {
        const middle = pathMidpoint(points);
        const label = edge.delay ? `${edge.name}  z\u207B\xB9` : elementIdentifier(edge);
        const labelRot = edge.layout && Number.isFinite(Number(edge.layout.rot)) ? Number(edge.layout.rot) * Math.PI / 180 : circuitMidAngle(points);
        const vertical = Math.abs(Math.sin(circuitGb ? labelRot : 0)) > 0.5;
        let labelX = middle.x;
        let labelY = middle.y - (circuitGb ? vertical ? 0 : 24 : 16);
        ctx.textAlign = "center";
        if (circuitGb && vertical) {
          labelX = middle.x + 20;
          labelY = middle.y - 2;
          ctx.textAlign = "left";
        }
        ctx.font = '9px "Cascadia Code", Consolas, monospace';
        ctx.textBaseline = "middle";
        const textWidth = ctx.measureText(label).width;
        const boxW = textWidth + 8;
        const labelRect = labelCollisionFree(
          ctx.textAlign === "left" ? labelX + boxW / 2 : labelX,
          labelY,
          boxW,
          12,
          occupiedLabels
        );
        occupiedLabels.push(labelRect);
        if (ctx.textAlign === "left") {
          labelX = labelRect.x + 4;
        } else {
          labelX = labelRect.x + boxW / 2;
        }
        labelY = labelRect.y + 6;
        const boxLeft = labelRect.x;
        ctx.fillStyle = "rgba(247, 244, 236, 0.92)";
        ctx.fillRect(boxLeft, labelY - 6, boxW, 12);
        ctx.fillStyle = selected ? C("#a8541f") : "#7b7266";
        ctx.fillText(label, labelX, labelY);
        if (selected && !circuitGb) {
          const value = edgeValueText(edge);
          if (value) {
            ctx.fillStyle = C("#1f5f5b");
            ctx.font = '9px "Cascadia Code", Consolas, monospace';
            ctx.fillText(value, middle.x, middle.y + 5);
          }
        }
      }
      if (state.ui?.drawingMode && state.ui?.drawingLabels && state.view.k > 0.42) {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = '8px "Cascadia Code", Consolas, monospace';
        const mid = pathMidpoint(points);
        if (edge.kind === "wire" && mid) {
          const text = edge.name || "W";
          const w = ctx.measureText(text).width + 6;
          ctx.fillStyle = "rgba(255, 253, 248, 0.94)";
          ctx.fillRect(mid.x - w / 2, mid.y - 12, w, 11);
          ctx.fillStyle = C("#5b554b");
          ctx.fillText(text, mid.x, mid.y - 6.5);
        } else {
          ctx.fillStyle = C("#5b554b");
          ctx.fillText("1", points[0].x + 6, points[0].y - 6);
          ctx.fillText("2", points[points.length - 1].x - 6, points[points.length - 1].y - 6);
        }
      }
      if (selected) {
        const handles = [
          { p: points[0], end: "source" },
          { p: points[points.length - 1], end: "target" }
        ];
        for (const handle of handles) {
          const active = state.drag?.type === "endpoint" && state.drag.id === edge.id && state.drag.end === handle.end;
          ctx.beginPath();
          ctx.arc(handle.p.x, handle.p.y, active ? 6 : 4.5, 0, Math.PI * 2);
          ctx.fillStyle = active ? C("#a8541f") : C("#faf8f2");
          ctx.fill();
          ctx.strokeStyle = C("#a8541f");
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        if (state.drag?.type === "endpoint" && state.drag.id === edge.id) {
          const node = nodeById(state.drag.end === "source" ? edge.source : edge.target);
          if (node && state.drag.anchor !== "auto") {
            const snapPoint = anchorScreenPoint(node, state.drag.anchor);
            ctx.beginPath();
            ctx.arc(snapPoint.x, snapPoint.y, 7, 0, Math.PI * 2);
            ctx.fillStyle = C("rgba(168, 84, 31, 0.18)");
            ctx.fill();
            ctx.strokeStyle = C("#a8541f");
            ctx.lineWidth = 1.4;
            ctx.stroke();
          }
        }
      }
      if (edge.route === "manual" && (selected || state.drag?.type === "waypoint" || state.hoverWaypoint?.edgeId === edge.id)) {
        for (const item of edge.waypoints || []) {
          const point = worldToScreen(item.x, item.y);
          const index = (edge.waypoints || []).indexOf(item);
          const active = state.drag?.type === "waypoint" && state.drag.id === edge.id && state.drag.index === index || state.hoverWaypoint?.edgeId === edge.id && state.hoverWaypoint.index === index;
          ctx.beginPath();
          ctx.arc(point.x, point.y, active ? 6.5 : 5, 0, Math.PI * 2);
          ctx.fillStyle = active ? C("#a8541f") : C("#faf8f2");
          ctx.fill();
          ctx.strokeStyle = C("#a8541f");
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
      const totalEdges = state.scene?.edges?.length || 0;
      if (state.sim?.running && edge.enabled && (totalEdges <= 220 || selected)) {
        const phase = (now / 1600 + hashString(edge.id) % 997 / 997) % 1;
        for (let index = 0; index < 2; index += 1) {
          const t = (phase + index / 2) % 1;
          const point = pathPointAt(points, t);
          ctx.beginPath();
          ctx.arc(point.x, point.y, selected ? 2 : 1.35, 0, Math.PI * 2);
          ctx.fillStyle = edge.delay ? C("rgba(176,118,42,.8)") : C("rgba(168,84,31,.7)");
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }
  function drawGbCircuitNode(ctx2, node, cx, cy, radius, accent, isSelected, isHovered, k) {
    const style = state.ui?.nodeStyle || "circle";
    const color = isSelected ? C("#a8541f") : isHovered ? "#5f584e" : "#7b7266";
    ctx2.save();
    ctx2.strokeStyle = color;
    ctx2.fillStyle = C("#faf8f2");
    ctx2.lineWidth = isSelected ? 1.8 : 1.2;
    if (node.kind === "ground") {
      const top = cy - radius * 0.5;
      ctx2.beginPath();
      ctx2.moveTo(cx, top);
      ctx2.lineTo(cx, cy + 2);
      ctx2.stroke();
      const bars = [[15, 6], [10, 10], [5, 14]];
      for (const [width, offset] of bars) {
        ctx2.beginPath();
        ctx2.moveTo(cx - width / 2, cy + offset);
        ctx2.lineTo(cx + width / 2, cy + offset);
        ctx2.stroke();
      }
      if (isSelected) {
        ctx2.beginPath();
        ctx2.arc(cx, cy, Math.max(radius, 12) + 4, 0, Math.PI * 2);
        ctx2.strokeStyle = C("rgba(168, 84, 31, 0.45)");
        ctx2.stroke();
      }
      ctx2.restore();
      return;
    }
    if (style === "dot") {
      ctx2.beginPath();
      ctx2.arc(cx, cy, 4.2, 0, Math.PI * 2);
      ctx2.fillStyle = isSelected ? C("#a8541f") : accent;
      ctx2.fill();
    } else if (style === "box") {
      ctx2.beginPath();
      ctx2.rect(cx - 10, cy - 7, 20, 14);
      ctx2.fill();
      ctx2.stroke();
    } else {
      ctx2.beginPath();
      ctx2.arc(cx, cy, 5.5, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.stroke();
    }
    if (isSelected) {
      ctx2.beginPath();
      ctx2.arc(cx, cy, 10.5, 0, Math.PI * 2);
      ctx2.strokeStyle = C("rgba(168, 84, 31, 0.6)");
      ctx2.lineWidth = 1;
      ctx2.stroke();
    }
    ctx2.restore();
  }
  function drawGbFunctionGlyph(ctx2, node, cx, cy, radius, accent, isSelected, isHovered, k) {
    const color = isSelected ? C("#a8541f") : isHovered ? "#5f584e" : accent;
    const R = radius * 0.92;
    const fontPx = Math.max(10, Math.round(R * 0.8));
    ctx2.save();
    ctx2.strokeStyle = color;
    ctx2.fillStyle = color;
    ctx2.lineWidth = isSelected ? 1.8 : clamp(1.15 * k, 0.9, 1.8);
    ctx2.lineJoin = "round";
    ctx2.textAlign = "center";
    ctx2.textBaseline = "middle";
    ctx2.font = `600 ${fontPx}px "Cascadia Code", Consolas, monospace`;
    const kind = node.kind;
    if (kind === "sum") {
      ctx2.beginPath();
      ctx2.arc(cx, cy, R, 0, Math.PI * 2);
      ctx2.stroke();
      ctx2.fillText("\u03A3", cx, cy + 1);
    } else if (kind === "gain") {
      ctx2.beginPath();
      ctx2.moveTo(cx - R * 0.72, cy - R * 0.75);
      ctx2.lineTo(cx - R * 0.72, cy + R * 0.75);
      ctx2.lineTo(cx + R * 0.9, cy);
      ctx2.closePath();
      ctx2.stroke();
      ctx2.font = `600 ${Math.round(fontPx * 0.72)}px "Cascadia Code", Consolas, monospace`;
      ctx2.fillText("K", cx - R * 0.18, cy + 1);
    } else if (kind === "integrate") {
      ctx2.strokeRect(cx - R * 0.62, cy - R * 0.58, R * 1.24, R * 1.16);
      ctx2.fillText("\u222B", cx, cy + 1);
    } else if (kind === "lag") {
      ctx2.strokeRect(cx - R * 0.66, cy - R * 0.58, R * 1.32, R * 1.16);
      ctx2.font = `600 ${Math.round(fontPx * 0.62)}px "Cascadia Code", Consolas, monospace`;
      ctx2.fillText("1/(1+\u03C4s)", cx, cy + 1);
    } else if (kind === "expression") {
      ctx2.strokeRect(cx - R * 0.62, cy - R * 0.55, R * 1.24, R * 1.1);
      ctx2.fillText("f(x)", cx, cy + 1);
    } else if (kind === "oscillator") {
      ctx2.beginPath();
      ctx2.arc(cx, cy, R * 0.82, 0, Math.PI * 2);
      ctx2.stroke();
      ctx2.fillText("~", cx, cy + 1);
    } else if (kind === "signal") {
      ctx2.beginPath();
      ctx2.arc(cx, cy, R * 0.82, 0, Math.PI * 2);
      ctx2.stroke();
      ctx2.fillText("s", cx, cy + 1);
    } else if (kind === "manual") {
      ctx2.beginPath();
      ctx2.arc(cx, cy, R * 0.82, 0, Math.PI * 2);
      ctx2.stroke();
      ctx2.fillText("M", cx, cy + 1);
    } else if (kind === "module_input" || kind === "module_output") {
      ctx2.beginPath();
      ctx2.arc(cx, cy, R * 0.7, 0, Math.PI * 2);
      ctx2.stroke();
      ctx2.fillText(kind === "module_input" ? "I" : "O", cx, cy + 1);
    } else if (kind === "block") {
      const hw = R * 0.72;
      const hh = R * 0.5;
      ctx2.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
      ctx2.font = `600 ${Math.round(fontPx * 0.7)}px "Cascadia Code", Consolas, monospace`;
      ctx2.fillText("B", cx, cy + 1);
    } else {
      ctx2.beginPath();
      ctx2.arc(cx, cy, R * 0.72, 0, Math.PI * 2);
      ctx2.stroke();
      ctx2.font = `600 ${Math.round(fontPx * 0.55)}px "Cascadia Code", Consolas, monospace`;
      ctx2.fillText(String(nodeKindLabel(node) || kind).slice(0, 2), cx, cy + 1);
    }
    ctx2.restore();
  }
  function drawGbDeviceNode(ctx2, node, rect, accent, isSelected, isHovered, k) {
    const color = isSelected ? C("#a8541f") : isHovered ? "#5f584e" : accent;
    const inactive = Boolean(state.sim?.running) && deviceInactive(node);
    ctx2.save();
    ctx2.strokeStyle = color;
    ctx2.lineWidth = isSelected ? 1.8 : 1.2;
    ctx2.fillStyle = C("#faf8f2");
    if (inactive) {
      ctx2.save();
      ctx2.shadowColor = "rgba(220, 38, 38, 0.95)";
      ctx2.shadowBlur = 16 * k;
      ctx2.strokeStyle = C("#dc2626");
      ctx2.lineWidth = 2;
      ctx2.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx2.restore();
      ctx2.strokeStyle = color;
      ctx2.lineWidth = isSelected ? 1.8 : 1.2;
    }
    ctx2.beginPath();
    ctx2.rect(rect.x, rect.y, rect.w, rect.h);
    ctx2.fill();
    ctx2.stroke();
    const spec = deviceElementSpec(node);
    const cx = rect.cx;
    const cy = rect.cy;
    ctx2.fillStyle = color;
    ctx2.textAlign = "center";
    ctx2.textBaseline = "middle";
    ctx2.font = `600 ${clamp(9 * k, 7, 12)}px "Cascadia Code", Consolas, monospace`;
    ctx2.fillText(spec?.label || node.params?.block_name || node.params?.element || "\u5668\u4EF6", cx, cy);
    const showNames = k > 0.55 && state.ui.showPins !== false;
    for (const pin of devicePins(node)) {
      const local = devicePinLocal(node, pin);
      const px = cx + local.x * k;
      const py = cy + local.y * k;
      const inwardX = local.side === "left" ? 1 : local.side === "right" ? -1 : 0;
      const inwardY = local.side === "bottom" ? -1 : local.side === "top" ? 1 : 0;
      if (inwardX || inwardY) {
        ctx2.beginPath();
        ctx2.moveTo(px, py);
        ctx2.lineTo(px + inwardX * 8 * k, py + inwardY * 8 * k);
        ctx2.stroke();
      }
      ctx2.beginPath();
      ctx2.arc(px, py, 2.8 * k, 0, Math.PI * 2);
      ctx2.fillStyle = pin.required ? color : "#9a9080";
      ctx2.fill();
      if (showNames) {
        const label = deviceSupplyLabel(node, pin);
        ctx2.fillStyle = C("#6f695f");
        ctx2.font = `${clamp(6.5 * k, 4.5, 9)}px "Cascadia Code", Consolas, monospace`;
        if (local.side === "left") {
          ctx2.textAlign = "right";
          ctx2.fillText(label, px - 7 * k, py);
        } else if (local.side === "right") {
          ctx2.textAlign = "left";
          ctx2.fillText(label, px + 7 * k, py);
        } else if (local.side === "top") {
          ctx2.textAlign = "center";
          ctx2.fillText(label, px, py - 10 * k);
        } else {
          ctx2.textAlign = "center";
          ctx2.fillText(label, px, py + 10 * k);
        }
      }
    }
    const implicitPin = deviceImplicitGroundPin(node);
    if (implicitPin) {
      const local = devicePinLocal(node, devicePins(node).find((pin) => pin.name === implicitPin));
      const gx = cx + local.x * k;
      const gy = cy + local.y * k;
      const dir = local.side === "top" ? -1 : 1;
      ctx2.strokeStyle = C("#6f695f");
      ctx2.lineWidth = 1.2;
      ctx2.beginPath();
      ctx2.moveTo(gx, gy);
      ctx2.lineTo(gx, gy + dir * 6 * k);
      ctx2.stroke();
      for (let row = 0; row < 3; row += 1) {
        const half = (5 - row * 1.4) * k;
        const y = gy + dir * (6 + row * 4) * k;
        ctx2.beginPath();
        ctx2.moveTo(gx - half, y);
        ctx2.lineTo(gx + half, y);
        ctx2.stroke();
      }
      if (showNames) {
        ctx2.fillStyle = C("#6f695f");
        ctx2.font = `${clamp(6 * k, 4.2, 8.5)}px "Cascadia Code", Consolas, monospace`;
        ctx2.textAlign = "center";
        ctx2.fillText("\u81EA\u52A8\u63A5\u5730", gx, gy + dir * 22 * k);
      }
    }
    ctx2.restore();
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
      const isPrimary = state.selection.type === "node" && state.selection.id === node.id;
      const isSelected = isPrimary || state.multi?.nodes?.has(node.id);
      const isHovered = state.hover?.type === "node" && state.hover.id === node.id;
      const accent = nodeColor(node);
      const cx = rect.cx;
      const cy = rect.cy;
      const radius = rect.r;
      ctx.save();
      const gbStyle = state.ui?.symbol === "gb";
      const isDeviceNode = isPinNode(node);
      let customLabel = false;
      if (isDeviceNode) {
        customLabel = true;
        drawGbDeviceNode(ctx, node, rect, accent, isSelected, isHovered, k);
      } else if (gbStyle) {
        customLabel = true;
        const isCircuitTerminal = state.scene?.mode === "circuit" && (node.kind === "node" || node.kind === "ground");
        if (isCircuitTerminal) {
          drawGbCircuitNode(ctx, node, cx, cy, radius, accent, isSelected, isHovered, k);
        } else {
          drawGbFunctionGlyph(ctx, node, cx, cy, radius, accent, isSelected, isHovered, k);
        }
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = isSelected ? C("#a8541f") : isHovered ? "#8e8477" : C("#cfc6b5");
        ctx.lineWidth = isSelected ? 1.6 : 1;
        if (!isSelected && !isHovered) ctx.setLineDash([2, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? "#f7ecdf" : C("#faf8f2");
        ctx.fill();
        ctx.strokeStyle = isSelected ? C("#a8541f") : C("#bcb3a1");
        ctx.lineWidth = isSelected ? 1.5 : 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, radius - 2.5, -Math.PI * 0.78, -Math.PI * 0.22);
        ctx.strokeStyle = accent;
        ctx.lineWidth = clamp(2.4 * k, 1.2, 3.5);
        ctx.stroke();
      }
      const vector = vectorForNode(node);
      if (vector) {
        const angle = Math.atan2(-vector.vy, vector.vx);
        const length = radius + clamp(7 + 13 * Math.tanh(vector.magnitude), 7, 26);
        const sx = cx + Math.cos(angle) * (radius * 0.38);
        const sy = cy + Math.sin(angle) * (radius * 0.38);
        const ex = cx + Math.cos(angle) * length;
        const ey = cy + Math.sin(angle) * length;
        ctx.strokeStyle = vector.source === "velocity" ? C("rgba(168, 84, 31, .5)") : C("rgba(31, 95, 91, .45)");
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.fillStyle = vector.source === "velocity" ? C("rgba(168, 84, 31, .8)") : C("rgba(31, 95, 91, .75)");
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - 5 * Math.cos(angle - 0.42), ey - 5 * Math.sin(angle - 0.42));
        ctx.lineTo(ex - 5 * Math.cos(angle + 0.42), ey - 5 * Math.sin(angle + 0.42));
        ctx.closePath();
        ctx.fill();
      }
      if (showDetail && !customLabel) {
        const pad = radius * 0.3;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = accent;
        ctx.font = `600 ${metaSize}px "Cascadia Code", Consolas, monospace`;
        ctx.fillText(nodeKindLabel(node), cx, cy - radius * 0.56, radius * 1.42);
        ctx.fillStyle = C("#11100e");
        ctx.font = `700 ${nameSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
        const maxNameWidth = radius * 1.55;
        let name = node.name;
        if (ctx.measureText(name).width > maxNameWidth) {
          while (name.length > 2 && ctx.measureText(`${name}\u2026`).width > maxNameWidth) name = name.slice(0, -1);
          name += "\u2026";
        }
        ctx.fillText(name, cx, cy - radius * 0.06);
        if (showValue) {
          ctx.fillStyle = node.kind === "ground" ? C("#6f695f") : C("#6f695f");
          ctx.font = `${valueSize}px "Cascadia Code", Consolas, monospace`;
          const text = node.kind === "ground" ? "0 V \xB7 REF" : nodeValueText(node);
          ctx.fillText(text, cx, cy + radius * 0.38, radius * 1.55);
        }
        if (isSelected) {
          ctx.fillStyle = C("#a8541f");
          ctx.font = `600 ${metaSize}px "Cascadia Code", Consolas, monospace`;
          ctx.fillText("\u25CF", cx, cy - radius - 13);
          ctx.fillStyle = C("#7b7266");
          ctx.font = `${metaSize}px "Cascadia Code", Consolas, monospace`;
          ctx.fillText(node.id.slice(-4), cx + radius * 0.9, cy - radius - 13);
        }
      } else if (showDetail && customLabel) {
        const nameSize2 = clamp(10.5 * k, 6.5, 13);
        const valueSize2 = clamp(8.6 * k, 5, 12);
        const labelY = node.kind === "device" ? rect.y + rect.h + Math.max(11, 11 * k) : cy + (radius < 20 ? Math.max(14, radius + 8) : radius * 0.62);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = C("#11100e");
        ctx.font = `600 ${nameSize2}px "Segoe UI", "Microsoft YaHei", sans-serif`;
        ctx.fillText(node.name, cx, labelY, 96);
        if (showValue && state.scene?.mode !== "circuit") {
          ctx.fillStyle = C("#6f695f");
          ctx.font = `${valueSize2}px "Cascadia Code", Consolas, monospace`;
          const text = node.kind === "ground" ? "0 V \xB7 REF" : nodeValueText(node);
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
        ctx.strokeStyle = C("#a8541f");
        ctx.lineWidth = 1;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          ctx.beginPath();
          ctx.moveTo(cx + dx * (radius + 7), cy + dy * (radius + 7));
          ctx.lineTo(cx + dx * (radius + 7 + tick), cy + dy * (radius + 7 + tick));
          ctx.stroke();
        }
      }
      const portRadius = clamp(3.4 * k, 2, 5);
      const circuitPorts = state.scene?.mode === "circuit" && !state.ui?.drawingMode && state.ui?.symbol === "gb" && state.ui?.nodeStyle !== "box" && (node.kind === "node" || node.kind === "ground");
      if (circuitPorts) {
        const points = [];
        for (const edge of state.scene.edges || []) {
          if (!edge.enabled || edge.source !== node.id && edge.target !== node.id) continue;
          const other = nodeById(edge.source === node.id ? edge.target : edge.source);
          if (!other) continue;
          const otherCenter = nodeCenterScreen(other);
          const anchor = edge.source === node.id ? edge.anchors?.source || "auto" : edge.anchors?.target || "auto";
          const point = anchorPoint(node, anchor, otherCenter);
          if (!points.some((item) => Math.hypot(item.x - point.x, item.y - point.y) < 2)) points.push(point);
        }
        for (const point of points) {
          ctx.beginPath();
          ctx.arc(point.x, point.y, portRadius - 0.4, 0, Math.PI * 2);
          ctx.fillStyle = C("#faf8f2");
          ctx.fill();
          ctx.strokeStyle = C("#8e8477");
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.restore();
        continue;
      }
      const inPoint = { x: cx - radius, y: cy };
      const outPoint = { x: cx + radius, y: cy };
      const linkingSource = state.drag?.type === "link" && state.drag.sourceId === node.id;
      ctx.fillStyle = C("#faf8f2");
      ctx.strokeStyle = C("#8e8477");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(inPoint.x, inPoint.y, portRadius - 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(outPoint.x, outPoint.y, linkingSource ? portRadius + 1.5 : portRadius, 0, Math.PI * 2);
      ctx.fillStyle = linkingSource ? C("#a8541f") : C("#faf8f2");
      ctx.strokeStyle = linkingSource ? C("#a8541f") : accent;
      ctx.lineWidth = 1.2;
      ctx.fill();
      ctx.stroke();
      if (isPrimary) {
        const hx = cx + radius - 2;
        const hy = cy + radius - 2;
        ctx.fillStyle = C("#faf8f2");
        ctx.strokeStyle = C("#a8541f");
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
      const start2 = first.kind === "pin" ? devicePinScreen(node, first.pin) : worldToScreen(node.position || { x: 0, y: 0 });
      const end2 = state.pointer ? { x: state.pointer.x, y: state.pointer.y } : start2;
      ctx.save();
      ctx.strokeStyle = C("rgba(168, 84, 31, .55)");
      ctx.lineWidth = 1.7;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(start2.x, start2.y);
      ctx.lineTo(end2.x, end2.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(start2.x, start2.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = C("rgba(168, 84, 31, .25)");
      ctx.fill();
      ctx.strokeStyle = C("#a8541f");
      ctx.stroke();
      ctx.restore();
      return;
    }
    const drag = state.drag;
    if (!drag || drag.type !== "link" && drag.type !== "pin") return;
    const source = nodeById(drag.sourceId);
    if (!source) return;
    const start = drag.type === "pin" ? devicePinScreen(source, drag.pin) : portOut(source);
    const target = drag.targetId ? nodeById(drag.targetId) : null;
    const end = target ? portIn(target) : { x: state.pointer.x, y: state.pointer.y };
    const bend = Math.max(34, Math.abs(end.x - start.x) * 0.35);
    ctx.save();
    ctx.strokeStyle = target ? C("#a8541f") : C("rgba(168, 84, 31, .45)");
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.bezierCurveTo(start.x + bend, start.y, end.x - bend, end.y, end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(end.x, end.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = C("#a8541f");
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
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = C("#8e8477");
      ctx.font = '13px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillText("\u753B\u5E03\u4E3A\u7A7A \xB7 \u70B9\u51FB\u5DE6\u4FA7\u300C\u8282\u70B9\u300D\u6216\u4ECE\u300C\u573A\u666F\u300D\u8F7D\u5165\u6A21\u677F", w / 2, h / 2);
      ctx.font = '10px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = C("#a49a89");
      ctx.fillText("\u62D6\u62FD\u79FB\u52A8 \xB7 \u4ECE\u53F3\u4FA7\u7AEF\u53E3\u62D6\u51FA\u8FDE\u63A5 \xB7 \u6EDA\u8F6E\u7F29\u653E \xB7 \u53CC\u51FB\u7F16\u8F91", w / 2, h / 2 + 24);
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
    if (!drag || drag.type !== "box") return;
    const x = Math.min(drag.startX, drag.x);
    const y = Math.min(drag.startY, drag.y);
    const w = Math.abs(drag.x - drag.startX);
    const h = Math.abs(drag.y - drag.startY);
    ctx.save();
    const dark = themeKey() === "dark";
    ctx.fillStyle = dark ? "rgba(197, 161, 107, .16)" : "rgba(168, 84, 31, .10)";
    ctx.strokeStyle = dark ? "rgba(197, 161, 107, .70)" : "rgba(168, 84, 31, .65)";
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
    let label = "";
    if (drag && drag.type === "waypoint") {
      const edge = edgeById(drag.id);
      const point = edge?.waypoints?.[drag.index];
      if (point) {
        target = worldToScreen(point);
        label = `\u62D0\u70B9 ${drag.index + 1}`;
      }
    } else if (drag && drag.type === "node") {
      const node = nodeById(drag.id);
      if (node?.position) {
        target = worldToScreen(node.position);
        label = "\u8282\u70B9";
      }
    } else if (drag && drag.type === "endpoint") {
      const pointer = state.pointer;
      if (pointer) {
        target = { x: pointer.x, y: pointer.y };
        label = "\u7AEF\u70B9";
      }
    } else if (state.hoverWaypoint) {
      const edge = edgeById(state.hoverWaypoint.edgeId);
      const point = edge?.waypoints?.[state.hoverWaypoint.index];
      if (point) {
        target = worldToScreen(point);
        label = `\u62D0\u70B9 ${state.hoverWaypoint.index + 1}`;
      }
    }
    if (!target) return;
    const world = screenToWorld(target.x, target.y);
    ctx.save();
    ctx.strokeStyle = C("rgba(168, 84, 31, .28)");
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(0, target.y);
    ctx.lineTo(w, target.y);
    ctx.moveTo(target.x, 0);
    ctx.lineTo(target.x, h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(target.x, target.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = C("rgba(168, 84, 31, .18)");
    ctx.fill();
    ctx.strokeStyle = C("#a8541f");
    ctx.lineWidth = 1.6;
    ctx.stroke();
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
    ctx.fillStyle = "rgba(250, 248, 242, .96)";
    ctx.strokeStyle = C("rgba(168, 84, 31, .75)");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(bx, by, boxW, boxH, 4) : ctx.rect(bx, by, boxW, boxH);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C("#5a3a24");
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + padding, by + boxH / 2 + 0.5);
    ctx.restore();
  }
  function requestDraw() {
    state.needsDraw = true;
  }
  const __graphMs = [];
  function __dbgGraph(ms) {
    __graphMs.push(Math.round(ms * 10) / 10);
    if (__graphMs.length > 300) __graphMs.splice(0, 150);
    window.__graphMs = __graphMs;
  }
  function animationLoop(timestamp) {
    if (state.shuttingDown) return;
    if (state.workspace === "network") {
      if (state.sim?.running && timestamp - (state.lastPaint || 0) >= 33) {
        state.lastPaint = timestamp;
        state.needsDraw = false;
        const __g0 = performance.now();
        drawGraph();
        __dbgGraph(performance.now() - __g0);
      } else if (state.needsDraw) {
        state.needsDraw = false;
        const __g0 = performance.now();
        drawGraph();
        __dbgGraph(performance.now() - __g0);
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
      x: w / 2 - (minX + maxX) / 2 * k,
      y: h / 2 - (minY + maxY) / 2 * k
    };
    requestDraw();
    ui.zoomBadge.textContent = `${Math.round(k * 100)}%`;
    if (announce) toast("\u5DF2\u9002\u914D\u89C6\u56FE", "info", 1200);
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
      y: event.clientY - rect.top
    };
  }
  function distance(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }
  function hitTest(x, y) {
    const nodes = state.scene?.nodes || [];
    if (!nodes.length) return null;
    if (state.scene?.mode === "circuit" && state.view.k > 0.25) {
      const radius = Math.max(7, 7 * state.view.k);
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index];
        if (node.kind !== "device") continue;
        for (const pin of devicePins(node)) {
          const point = devicePinScreen(node, pin.name);
          if (distance(x, y, point.x, point.y) <= radius) {
            return { type: "pin", id: node.id, node, pin: pin.name };
          }
        }
      }
    }
    if (state.view.k > 0.25) {
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index];
        const out = portOut(node);
        if (distance(x, y, out.x, out.y) <= Math.max(9, 8 * state.view.k)) {
          return { type: "port", id: node.id, node };
        }
      }
    }
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      const rect = nodeRect(node);
      if (rect.shape === "rect" ? x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h : distance(x, y, rect.cx, rect.cy) <= rect.r + 1) {
        return { type: "node", id: node.id, node };
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
        return { type: "edge", id: edge.id, edge };
      }
    }
    return null;
  }
  function nearestNodeWithin(x, y, margin = 24) {
    const nodes = state.scene?.nodes || [];
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      const rect = nodeRect(node);
      if (rect.shape === "rect" ? x >= rect.x - margin && x <= rect.x + rect.w + margin && y >= rect.y - margin && y <= rect.y + rect.h + margin : distance(x, y, rect.cx, rect.cy) <= rect.r + margin) {
        return node;
      }
    }
    return null;
  }
  function bindCanvas() {
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", () => {
      if (state.drag) return;
      if (state.hoverWaypoint) {
        state.hoverWaypoint = null;
        requestDraw();
      }
      if (ui.statusCursor) ui.statusCursor.textContent = "x \u2014  y \u2014";
      if (state.hover) {
        state.hover = null;
        requestDraw();
        canvas.style.cursor = "default";
      }
    });
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("pointerdown", (event) => {
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
        type: "pan",
        startX: point.x,
        startY: point.y,
        viewX: state.view.x,
        viewY: state.view.y
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
      event.preventDefault();
      return;
    }
    const primaryNode = selectedNode();
    if (state.wireTool && event.button === 0) {
      const endpoint = wireToolEndpointAt(point);
      if (!endpoint) {
        toast("\u8BF7\u70B9\u51FB\u7F51\u7EDC\u8282\u70B9\u6216\u5668\u4EF6\u5F15\u811A\uFF08Esc \u53D6\u6D88\u5BFC\u7EBF\u5DE5\u5177\uFF09", "info", 2400);
        return;
      }
      if (!state.wireTool.first) {
        state.wireTool.first = endpoint;
        if (ui.statusHint) ui.statusHint.textContent = "\u5BFC\u7EBF\u5DE5\u5177\uFF1A\u8D77\u70B9\u5DF2\u9009\uFF0C\u70B9\u51FB\u7B2C\u4E8C\u4E2A\u7AEF\u70B9\uFF08Esc \u53D6\u6D88\uFF09";
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
          type: "resize",
          id: primaryNode.id,
          startDiameter: nodeDiameter(primaryNode),
          startX: point.x,
          startY: point.y
        };
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = "nwse-resize";
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
          type: "endpoint",
          id: endpoint.id,
          end: endpoint.end,
          anchor: edgeRecord?.anchors && edgeRecord.anchors[endpoint.end] || "auto",
          moved: false
        };
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = "crosshair";
        requestDraw();
        event.preventDefault();
        return;
      }
    }
    if (!event.ctrlKey && !event.metaKey) {
      const waypoint = waypointHitAt(point, true);
      if (waypoint) {
        if (state.selection.type !== "edge" || state.selection.id !== waypoint.edge.id) {
          state.selection = { type: "edge", id: waypoint.edge.id };
          state.inspectorDirty = false;
          renderInspector();
        }
        state.drag = { type: "waypoint", id: waypoint.edge.id, index: waypoint.index, moved: false };
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = "grabbing";
        requestDraw();
        event.preventDefault();
        return;
      }
    }
    if (primaryEdge && event.altKey) {
      const world = screenToWorld(point.x, point.y);
      const snapped = snapWorld(world.x, world.y, event.altKey);
      const waypoints = [...primaryEdge.waypoints || [], { x: snapped.x, y: snapped.y }];
      void patchEdgeGeometry(primaryEdge.id, { route: "manual", waypoints });
      return;
    }
    const hit = hitTest(point.x, point.y);
    if ((event.ctrlKey || event.metaKey) && hit && (hit.type === "node" || hit.type === "edge")) {
      toggleMultiSelection(hit.type, hit.id);
      event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !hit) {
      state.drag = {
        type: "box",
        startX: point.x,
        startY: point.y,
        x: point.x,
        y: point.y
      };
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (hit && hit.type === "pin") {
      state.drag = {
        type: "pin",
        sourceId: hit.id,
        pin: hit.pin,
        startX: point.x,
        startY: point.y
      };
      canvas.setPointerCapture(event.pointerId);
      requestDraw();
      event.preventDefault();
      return;
    }
    if (hit && hit.type === "port") {
      state.drag = {
        type: "link",
        sourceId: hit.id,
        targetId: null,
        startX: point.x,
        startY: point.y
      };
      canvas.setPointerCapture(event.pointerId);
      requestDraw();
      event.preventDefault();
      return;
    }
    if (hit && hit.type === "node") {
      const node = hit.node;
      void selectEntity("node", node.id);
      state.drag = {
        type: "node",
        id: node.id,
        startX: point.x,
        startY: point.y,
        originX: node.position.x,
        originY: node.position.y,
        moved: false
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
      event.preventDefault();
      return;
    }
    if (hit && hit.type === "edge") {
      void selectEntity("edge", hit.id);
      drawGraph();
      return;
    }
    void selectEntity(null, null);
    state.drag = {
      type: "pan",
      startX: point.x,
      startY: point.y,
      viewX: state.view.x,
      viewY: state.view.y,
      moved: false
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grab";
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
        canvas.style.cursor = "grab";
        requestDraw();
        return;
      }
      if (state.hoverWaypoint) {
        state.hoverWaypoint = null;
        requestDraw();
      }
      if (edgeEndpointHit(point)) {
        canvas.style.cursor = "crosshair";
        return;
      }
      const hit = hitTest(point.x, point.y);
      const nextHover = hit ? { type: hit.type, id: hit.id } : null;
      const changed = (nextHover?.type || null) !== (state.hover?.type || null) || (nextHover?.id || null) !== (state.hover?.id || null);
      if (changed) {
        state.hover = nextHover;
        requestDraw();
      }
      if (!hit) canvas.style.cursor = "default";
      else if (hit.type === "port" || hit.type === "pin") canvas.style.cursor = "crosshair";
      else if (hit.type === "node") canvas.style.cursor = "grab";
      else canvas.style.cursor = "pointer";
      return;
    }
    const drag = state.drag;
    if (drag.type === "box") {
      drag.x = point.x;
      drag.y = point.y;
      requestDraw();
      return;
    }
    if (drag.type === "pan") {
      state.view.x = drag.viewX + (point.x - drag.startX);
      state.view.y = drag.viewY + (point.y - drag.startY);
      drag.moved = true;
      requestDraw();
      return;
    }
    if (drag.type === "resize") {
      const node = nodeById(drag.id);
      if (!node) return;
      const rect = nodeRect(node);
      const world2 = screenToWorld(point.x, point.y);
      const center = { x: node.position.x, y: node.position.y };
      const raw = Math.hypot(world2.x - center.x, world2.y - center.y) * 2;
      const snapped = state.ui?.snap && !event.altKey ? Math.round(raw / (Number(state.ui.grid) || 20)) * (Number(state.ui.grid) || 20) : raw;
      const diameter = clamp(snapped, 24, 200);
      state.drag.diameter = diameter;
      drag.diameter = diameter;
      node.size = { w: diameter };
      rect.r = diameter / 2 * state.view.k;
      drag.moved = true;
      requestDraw();
      return;
    }
    if (drag.type === "endpoint") {
      const edge = edgeById(drag.id);
      if (!edge) return;
      const node = nodeById(drag.end === "source" ? edge.source : edge.target);
      if (!node) return;
      const side = anchorSideFor(node, point);
      drag.anchor = side;
      edge.anchors = Object.assign({}, edge.anchors || {}, { [drag.end]: side });
      drag.moved = true;
      requestDraw();
      return;
    }
    if (drag.type === "waypoint") {
      const edge = edgeById(drag.id);
      if (!edge) return;
      const world2 = screenToWorld(point.x, point.y);
      const snapped = snapWorld(world2.x, world2.y, event.altKey);
      edge.waypoints[drag.index] = { x: snapped.x, y: snapped.y };
      drag.moved = true;
      requestDraw();
      return;
    }
    if (drag.type === "node") {
      const k = state.view.k;
      const node = nodeById(drag.id);
      if (!node) return;
      const rawX = clamp(drag.originX + (point.x - drag.startX) / k, -1e4, 1e4);
      const rawY = clamp(drag.originY + (point.y - drag.startY) / k, -1e4, 1e4);
      const snapped = snapWorld(rawX, rawY, event.altKey);
      node.position.x = snapped.x;
      node.position.y = snapped.y;
      drag.moved = true;
      requestDraw();
      return;
    }
    if (drag.type === "link") {
      const target = nearestNodeWithin(point.x, point.y, 18);
      drag.targetId = target && target.id !== drag.sourceId ? target.id : target ? target.id : null;
      requestDraw();
    }
  }
  function onPointerUp(event) {
    const drag = state.drag;
    state.drag = null;
    state.hoverWaypoint = null;
    canvas.style.cursor = "default";
    if (!drag) return;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
    }
    if (drag.type === "box") {
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
        toast(`\u6846\u9009 ${nodes.length} \u8282\u70B9 / ${edges.length} \u8FDE\u63A5`, "info", 1800);
      }
      return;
    }
    if (drag.type === "node" && drag.moved) {
      queuePositionSave(drag.id);
    }
    if (drag.type === "resize" && drag.moved) {
      const node = nodeById(drag.id);
      if (node) void patchNodeGeometry(node.id, { size: { w: node.size?.w || nodeDiameter(node) } });
    }
    if (drag.type === "waypoint" && drag.moved) {
      const edge = edgeById(drag.id);
      if (edge) void patchEdgeGeometry(edge.id, { waypoints: edge.waypoints });
    }
    if (drag.type === "endpoint" && drag.moved) {
      const edge = edgeById(drag.id);
      if (edge) void patchEdgeGeometry(edge.id, { anchors: edge.anchors });
    }
    if (drag.type === "link") {
      const point = pointerPosition(event);
      const target = nearestNodeWithin(point.x, point.y, 18);
      if (target) {
        openLinkMenu(target.id, point.x, point.y, drag.sourceId);
      }
      requestDraw();
    }
    if (drag.type === "pin") {
      const point = pointerPosition(event);
      const target = nearestNodeWithin(point.x, point.y, 18);
      if (target && (target.kind === "node" || target.kind === "ground")) {
        void createWire(drag.sourceId, target.id, drag.pin);
      } else {
        toast("\u8BF7\u628A\u5F15\u811A\u62D6\u5230\u7F51\u7EDC\u8282\u70B9\uFF08\u7535\u5B66\u8282\u70B9/\u63A5\u5730\uFF09", "error", 3500);
      }
      requestDraw();
    }
  }
  function onDoubleClick(event) {
    const point = pointerPosition(event);
    const hit = hitTest(point.x, point.y);
    if (hit && hit.type === "node") {
      void selectEntity("node", hit.id, true);
      switchTab("inspect");
    } else if (hit && hit.type === "edge") {
      void selectEntity("edge", hit.id, true);
      switchTab("inspect");
    } else {
      openAddMenu(point.x, point.y);
    }
  }
  function onWheel(event) {
    event.preventDefault();
    const point = pointerPosition(event);
    const factor = Math.exp(-event.deltaY * 15e-4);
    zoomAt(factor, point.x, point.y);
  }
  async function deleteDeviceWires(nodeId) {
    const wires = (state.scene?.edges || []).filter(
      (edge) => edge.kind === "wire" && (edge.source === nodeId || edge.target === nodeId)
    );
    if (!wires.length) {
      toast("\u8BE5\u5668\u4EF6\u6CA1\u6709\u5BFC\u7EBF", "info", 2e3);
      return;
    }
    for (const wire of wires) await deleteEdge(wire.id);
    toast(`\u5DF2\u65AD\u5F00 ${wires.length} \u6761\u5BFC\u7EBF`, "ok", 2200);
  }
  async function convertNodeToGround(nodeId) {
    try {
      await jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, "PATCH", {
        kind: "ground",
        params: {},
        data: {},
        size: {}
      });
      await refreshState(true);
      toast("\u5DF2\u8BBE\u4E3A\u63A5\u5730\uFF08\u591A\u63A5\u5730\u81EA\u52A8\u5408\u5E76\u4E3A 0V\uFF09", "ok", 2600);
    } catch (error) {
      toast(`\u8BBE\u4E3A\u63A5\u5730\u5931\u8D25\uFF1A${error.message}`, "error", 4e3);
    }
  }
  function pinWires(nodeId, pinName) {
    return (state.scene?.edges || []).filter(
      (edge) => edge.kind === "wire" && (edge.source === nodeId && edge.source_pin === pinName || edge.target === nodeId && edge.target_pin === pinName)
    );
  }
  function wireToolEndpointAt(point) {
    const hit = hitTest(point.x, point.y);
    if (!hit) return null;
    if (hit.type === "pin") return { kind: "pin", nodeId: hit.id, pin: hit.pin };
    if (hit.type === "node" && (hit.node.kind === "node" || hit.node.kind === "ground")) {
      return { kind: "net", nodeId: hit.id };
    }
    return null;
  }
  function startWireTool(first = null) {
    state.wireTool = { first };
    const hint = first ? `\u5BFC\u7EBF\u5DE5\u5177\uFF1A\u8D77\u70B9\u5DF2\u9009\uFF0C\u70B9\u51FB\u7B2C\u4E8C\u4E2A\u7AEF\u70B9\uFF08\u7F51\u7EDC\u8282\u70B9\u6216\u5668\u4EF6\u5F15\u811A\uFF09` : "\u5BFC\u7EBF\u5DE5\u5177\uFF1A\u4F9D\u6B21\u70B9\u51FB\u4E24\u4E2A\u7AEF\u70B9\uFF08\u7F51\u7EDC\u8282\u70B9 / \u5668\u4EF6\u5F15\u811A\uFF09";
    if (ui.statusHint) ui.statusHint.textContent = hint;
    toast(hint, "info", 2600);
    requestDraw();
  }
  function cancelWireTool() {
    if (!state.wireTool) return;
    state.wireTool = null;
    if (ui.statusHint) ui.statusHint.textContent = "\u5C31\u7EEA";
    requestDraw();
  }
  async function completeWireTool(second) {
    const first = state.wireTool?.first;
    if (!first) return;
    let sourceId = "";
    let targetId = "";
    let sourcePin = "";
    if (first.kind === "pin" && second.kind === "net") {
      sourceId = first.nodeId;
      targetId = second.nodeId;
      sourcePin = first.pin;
    } else if (first.kind === "net" && second.kind === "pin") {
      sourceId = second.nodeId;
      targetId = first.nodeId;
      sourcePin = second.pin;
    } else if (first.kind === "net" && second.kind === "net") {
      sourceId = first.nodeId;
      targetId = second.nodeId;
    } else {
      toast("\u5BFC\u7EBF\u53EA\u5141\u8BB8\u300C\u5668\u4EF6\u5F15\u811A \u2194 \u7F51\u7EDC\u8282\u70B9\u300D\u6216\u300C\u7F51\u7EDC \u2194 \u7F51\u7EDC\u300D", "error", 3600);
      return;
    }
    cancelWireTool();
    await createWireBetween(sourceId, targetId, sourcePin, "");
  }
  function alignmentMenuItems() {
    return [
      { label: "\u5DE6\u5BF9\u9F50", action: () => void alignSelection("left") },
      { label: "\u53F3\u5BF9\u9F50", action: () => void alignSelection("right") },
      { label: "\u6C34\u5E73\u5C45\u4E2D", action: () => void alignSelection("centerX") },
      { label: "\u9876\u5BF9\u9F50", action: () => void alignSelection("top") },
      { label: "\u5E95\u5BF9\u9F50", action: () => void alignSelection("bottom") },
      { label: "\u5782\u76F4\u5C45\u4E2D", action: () => void alignSelection("centerY") },
      { sep: true },
      { label: "\u6A2A\u5411\u7B49\u8DDD\u5206\u5E03", action: () => void distributeSelection("x") },
      { label: "\u7EB5\u5411\u7B49\u8DDD\u5206\u5E03", action: () => void distributeSelection("y") }
    ];
  }
  function displayMenuItems() {
    return [
      { label: "\u6805\u683C", hint: state.ui?.showGrid !== false ? "\u5F53\u524D\uFF1A\u5F00" : "\u5F53\u524D\uFF1A\u5173", action: () => $("#stGrid")?.click() },
      { label: "\u5438\u9644", hint: state.ui?.snap !== false ? "\u5F53\u524D\uFF1A\u5F00" : "\u5F53\u524D\uFF1A\u5173", action: () => $("#stSnap")?.click() },
      { label: "\u6355\u6349\u70B9", hint: state.ui?.snapMarkers !== false ? "\u5F53\u524D\uFF1A\u5F00" : "\u5F53\u524D\uFF1A\u5173", action: () => $("#stSnapMark")?.click() },
      { label: "\u6B63\u4EA4\u5E03\u7EBF", hint: state.ui?.circuitOrthogonal !== false ? "\u5F53\u524D\uFF1A\u5F00" : "\u5F53\u524D\uFF1A\u5173", action: () => $("#stOrtho")?.click() }
    ];
  }
  function onContextMenu(event) {
    event.preventDefault();
    const point = pointerPosition(event);
    const hit = hitTest(point.x, point.y);
    const items = [];
    if (hit && hit.type === "pin") {
      const node = hit.node;
      const wires = pinWires(hit.id, hit.pin);
      items.push({
        label: "\u5F15\u811A\u4FE1\u606F",
        hint: `${node.name}.${hit.pin}${wires.length ? ` \xB7 ${wires.length} \u6761\u5BFC\u7EBF` : " \xB7 \u672A\u63A5\u7EBF"}`,
        action: () => toast(`${node.name}.${hit.pin}\uFF1A${wires.length ? `\u5DF2\u63A5 ${wires.length} \u6761\u5BFC\u7EBF` : "\u672A\u63A5\u7EBF"}`, "info", 3e3)
      });
      items.push({
        label: "\u4ECE\u6B64\u5F15\u811A\u5EFA\u7EBF\u2026",
        hint: "\u70B9\u51FB\u540E\u9009\u53E6\u4E00\u4E2A\u7F51\u7EDC\u8282\u70B9",
        action: () => startWireTool({ kind: "pin", nodeId: node.id, pin: hit.pin })
      });
      if (wires.length) {
        items.push({
          label: "\u65AD\u5F00\u8BE5\u5F15\u811A\u5BFC\u7EBF",
          hint: `${wires.length} \u6761`,
          danger: true,
          action: async () => {
            for (const wire of wires) await deleteEdge(wire.id);
            toast(`\u5DF2\u65AD\u5F00 ${node.name}.${hit.pin} \u7684 ${wires.length} \u6761\u5BFC\u7EBF`, "ok", 2400);
          }
        });
      }
      openGenericMenu(ui.linkMenu, point.x, point.y, `\u5F15\u811A \xB7 ${node.name}.${hit.pin}`, items);
      return;
    }
    if (hit && hit.type === "node") {
      const node = hit.node;
      const isDevice = node.kind === "device";
      items.push({
        label: isDevice ? "\u5668\u4EF6\u5C5E\u6027" : "\u8282\u70B9\u5C5E\u6027",
        hint: node.name,
        action: () => {
          void selectEntity("node", hit.id, true);
          switchTab("inspect");
        }
      });
      if (!isDevice && node.kind !== "ground" && state.mode === "circuit") {
        items.push({
          label: "\u8BBE\u4E3A\u63A5\u5730",
          hint: "\u591A\u63A5\u5730\u4F1A\u81EA\u52A8\u5408\u5E76\u4E3A 0V",
          action: () => void convertNodeToGround(hit.id)
        });
      }
      if (node.kind === "node" && state.mode === "circuit") {
        const marked = Boolean(node.params?.port_name);
        const current = node.params?.port_direction || "inout";
        const portName = marked ? String(node.params.port_name) : node.name;
        items.push({
          label: marked ? "\u6539\u7AEF\u53E3\u65B9\u5411" : "\u8BBE\u4E3A\u6A21\u5757\u7AEF\u53E3",
          hint: marked ? `\u5F53\u524D\u300C${portName}\u300D\xB7 ${MODULE_DIR_LABEL[current] || "\u53CC\u5411"}` : "\u5148\u9009\u65B9\u5411\uFF0C\u5C01\u88C5\u65F6\u6309\u65B9\u5411\u753B\u5F15\u811A",
          children: PORT_DIRECTION_CHOICES.map(([value, label, hint]) => ({
            label: `${label}${marked && value === current ? " \xB7 \u5F53\u524D" : ""}`,
            hint,
            action: () => void setNetPort(node.id, portName, value)
          }))
        });
        if (marked) {
          items.push({
            label: "\u53D6\u6D88\u6A21\u5757\u7AEF\u53E3",
            hint: `\u5F53\u524D\u7AEF\u53E3 ${portName}`,
            action: () => void setNetPort(node.id, "", "inout")
          });
        }
      }
      items.push({ label: "\u590D\u5236", hint: "Ctrl+C", action: () => copySelection(false) });
      if (isDevice) {
        items.push({
          label: "\u65AD\u5F00\u5168\u90E8\u5BFC\u7EBF",
          hint: "\u5668\u4EF6\u4FDD\u7559\uFF0C\u53EA\u5220\u5BFC\u7EBF",
          action: () => void deleteDeviceWires(hit.id)
        });
      }
      if ((state.multi?.nodes?.size || 0) > 1) {
        items.push({
          label: "\u5BF9\u9F50 / \u5206\u5E03",
          hint: `\u5F53\u524D\u591A\u9009 ${state.multi.nodes.size} \u4E2A`,
          children: [
            { label: "\u5DE6\u5BF9\u9F50", action: () => void alignSelection("left") },
            { label: "\u53F3\u5BF9\u9F50", action: () => void alignSelection("right") },
            { label: "\u6C34\u5E73\u5C45\u4E2D", action: () => void alignSelection("centerX") },
            { label: "\u9876\u5BF9\u9F50", action: () => void alignSelection("top") },
            { label: "\u5E95\u5BF9\u9F50", action: () => void alignSelection("bottom") },
            { label: "\u5782\u76F4\u5C45\u4E2D", action: () => void alignSelection("centerY") },
            { sep: true },
            { label: "\u6A2A\u5411\u7B49\u8DDD\u5206\u5E03", action: () => void distributeSelection("x") },
            { label: "\u7EB5\u5411\u7B49\u8DDD\u5206\u5E03", action: () => void distributeSelection("y") }
          ]
        });
      }
      items.push({ sep: true });
      items.push({
        label: isDevice ? "\u5220\u9664\u5668\u4EF6" : "\u5220\u9664\u8282\u70B9",
        hint: "\u540C\u65F6\u5220\u9664\u76F8\u8FDE\u8FDE\u63A5",
        danger: true,
        action: () => deleteNode(hit.id)
      });
      openGenericMenu(ui.linkMenu, point.x, point.y, `${isDevice ? "\u5668\u4EF6" : "\u8282\u70B9"} \xB7 ${node.name}`, items);
      return;
    }
    if (hit && hit.type === "edge") {
      items.push({
        label: "\u8FDE\u63A5\u5C5E\u6027",
        hint: hit.edge.name,
        action: () => {
          void selectEntity("edge", hit.id, true);
          switchTab("inspect");
        }
      });
      items.push({ label: "\u590D\u5236", hint: "Ctrl+C", action: () => copySelection(false) });
      if (hit.edge.kind === "wire") {
        items.push({
          label: "\u6DFB\u52A0\u62D0\u70B9\uFF08\u4E2D\u70B9\uFF09",
          action: () => void addWireWaypoint(hit.edge)
        });
        if ((hit.edge.waypoints || []).length) {
          items.push({
            label: "\u6E05\u9664\u62D0\u70B9",
            hint: "\u6062\u590D\u81EA\u52A8\u5E03\u7EBF",
            action: () => void clearWireWaypoints(hit.id)
          });
        }
        items.push({
          label: "\u9009\u4E2D\u6574\u6761\u7F51\u7EDC",
          hint: "\u540C\u7AEF\u70B9\u7684\u5BFC\u7EBF\u4E00\u8D77\u9009\u4E2D",
          action: () => selectWireNetwork(hit.edge)
        });
      }
      if (state.mode !== "circuit") {
        items.push({
          label: hit.edge.delay ? "\u53D6\u6D88\u5355\u6B65\u5EF6\u8FDF" : "\u8BBE\u4E3A\u5355\u6B65\u5EF6\u8FDF",
          hint: "\u7528\u4E8E\u5207\u65AD\u4EE3\u6570\u73AF",
          action: () => toggleEdgeDelay(hit.id)
        });
      }
      items.push({ sep: true });
      items.push({
        label: "\u5220\u9664\u8FDE\u63A5",
        hint: hit.edge.name,
        danger: true,
        action: () => deleteEdge(hit.id)
      });
      openGenericMenu(ui.linkMenu, point.x, point.y, `\u8FDE\u63A5 \xB7 ${hit.edge.name}`, items);
      return;
    }
    items.push({
      label: "\u6DFB\u52A0",
      hint: state.mode === "circuit" ? "\u8282\u70B9 / \u5668\u4EF6\uFF08\u6309\u5206\u7C7B\uFF09/ \u5BFC\u7EBF" : "\u8282\u70B9",
      children: buildAddMenuItems(point.x, point.y)
    });
    if (state.mode === "circuit") {
      items.push({
        label: "\u5BFC\u7EBF\u5DE5\u5177\uFF08\u70B9\u4E24\u7AEF\uFF09\u2026",
        hint: "\u4F9D\u6B21\u70B9\u51FB\u7F51\u7EDC\u8282\u70B9 / \u5668\u4EF6\u5F15\u811A\uFF1BEsc \u53D6\u6D88",
        action: () => startWireTool()
      });
    }
    items.push({ label: "\u663E\u793A", children: displayMenuItems() });
    const multiNodes = state.multi?.nodes?.size || 0;
    const multiEdges = state.multi?.edges?.size || 0;
    if (multiNodes > 1 || multiEdges > 0) {
      const multiItems = [];
      if (multiNodes > 1) {
        multiItems.push({
          label: "\u5BF9\u9F50 / \u5206\u5E03",
          hint: `${multiNodes} \u4E2A\u8282\u70B9`,
          children: alignmentMenuItems()
        });
        multiItems.push({
          label: "\u6279\u91CF\u8BBE\u7F6E\u5C3A\u5BF8\u2026",
          hint: "\u7EDF\u4E00\u5BBD / \u76F4\u5F84",
          action: () => void batchResizeSelection()
        });
        multiItems.push({ sep: true });
      }
      multiItems.push({
        label: "\u5220\u9664\u9009\u4E2D",
        hint: `\u8282\u70B9 ${multiNodes} / \u8FDE\u63A5 ${multiEdges}`,
        danger: true,
        action: () => void deleteSelection()
      });
      items.push({ label: `\u591A\u9009\uFF08${multiNodes} \u8282\u70B9 / ${multiEdges} \u8FDE\u63A5\uFF09`, children: multiItems });
    }
    items.push({ label: "\u7C98\u8D34", hint: "Ctrl+V", action: () => void pasteClipboard() });
    items.push({ label: "\u5168\u9009", hint: "Ctrl+A", action: () => selectAll() });
    items.push({ sep: true });
    items.push({ label: "\u64A4\u9500", hint: "Ctrl+Z", action: () => void undo() });
    items.push({ label: "\u91CD\u505A", hint: "Ctrl+Shift+Z", action: () => void redo() });
    items.push({ sep: true });
    items.push({
      label: state.sim?.running ? "\u6682\u505C" : "\u8FD0\u884C",
      hint: "\u7A7A\u683C",
      action: () => void control("toggle")
    });
    items.push({ label: "\u5355\u6B65", hint: "S", action: () => void control("step") });
    items.push({ sep: true });
    items.push({ label: "\u9002\u914D\u89C6\u56FE", action: () => fitView(true) });
    items.push({ label: "\u81EA\u52A8\u5E03\u5C40", action: () => void autoLayout() });
    openGenericMenu(ui.linkMenu, point.x, point.y, "\u753B\u5E03", items);
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
    const items = Array.from(state.dirtyPositions.entries()).filter(([id]) => Boolean(nodeById(id))).map(([id, position]) => ({
      id,
      position: { x: Number(position.x.toFixed(3)), y: Number(position.y.toFixed(3)) }
    }));
    state.dirtyPositions.clear();
    if (!items.length) return;
    try {
      await jsonRequest("/api/positions", "POST", { positions: items });
    } catch (error) {
      toast(`\u4FDD\u5B58\u5750\u6807\u5931\u8D25\uFF1A${error.message}`, "error", 6e3);
      await refreshState(true);
    }
  }
  async function patchNodeGeometry(nodeId, payload) {
    const response = await task(
      () => jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, "PATCH", payload)
    );
    if (!response) return;
    await refreshState(true);
    renderInspector();
  }
  async function setNetPort(nodeId, portName, direction = "inout") {
    const node = nodeById(nodeId);
    if (!node) return;
    const params = portName ? { port_name: String(portName).slice(0, 24), port_direction: direction || "inout" } : {};
    const response = await task(
      () => jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, "PATCH", {
        name: node.name,
        kind: node.kind,
        params
      })
    );
    if (!response) return;
    await refreshState(true);
    renderInspector();
    toast(params.port_name ? `\u5DF2\u6807\u8BB0\u7AEF\u53E3\u300C${params.port_name}\u300D` : "\u5DF2\u53D6\u6D88\u7AEF\u53E3\u6807\u8BB0", "ok", 2200);
  }
  async function patchEdgeGeometry(edgeId, payload) {
    const response = await task(
      () => jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, "PATCH", payload)
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
      if (tab === "chart") drawChart();
      else if (tab === "inst") drawInstruments();
    }, 70);
  }
  const PANEL_GROUPS = {
    inspect: { group: "inspect" },
    "node-fn": { group: "fn", role: "node" },
    "edge-fn": { group: "fn", role: "edge" },
    spec: { group: "fn" },
    blocks: { group: "modules", sub: "blocks" },
    ext: { group: "modules", sub: "ext" },
    chart: { group: "analysis", sub: "chart" },
    inst: { group: "analysis", sub: "inst" },
    vector: { group: "analysis", sub: "vector" },
    analysis: { group: "analysis", sub: "analysis" },
    plotkit: { group: "analysis", sub: "plotkit" },
    fem: { group: "fem" }
  };
  function defaultTabForGroup(group) {
    if (group === "fn") return state.fnRole === "edge" ? "edge-fn" : "node-fn";
    if (group === "modules") {
      const sub = $('.panel-group[data-group="modules"] .group-subnav [data-sub].active');
      return sub ? sub.dataset.sub : "blocks";
    }
    if (group === "analysis") {
      const sub = $('.panel-group[data-group="analysis"] .group-subnav [data-sub].active');
      return sub ? sub.dataset.sub : "chart";
    }
    if (group === "fem") return "fem";
    return "inspect";
  }
  function setPanelGroup(group) {
    $$(".panel-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.group === group));
    $$(".panel-group").forEach((node) => node.classList.toggle("active", node.dataset.group === group));
  }
  function setGroupSub(group, sub) {
    const host = $(`.panel-group[data-group="${group}"]`);
    if (!host) return;
    const attr = group === "fn" ? "fnrole" : "sub";
    $$(`[data-${attr}]`, host).forEach((node) => {
      node.classList.toggle("active", node.dataset[attr] === sub);
    });
    if (group === "modules" || group === "analysis") {
      $$(".tab-pane", host).forEach((pane) => {
        pane.classList.toggle("hidden", pane.id !== `tab-${sub}`);
      });
    }
  }
  function switchTab(name) {
    if (name === "scene") {
      openSettings("project");
      return;
    }
    if (name === "fem" && state.workspace !== "fem") {
      void switchWorkspace("fem");
      return;
    }
    if (name !== "fem" && state.workspace === "fem") {
      void switchWorkspace("network").then(() => switchTab(name));
      return;
    }
    const conf = PANEL_GROUPS[name] || PANEL_GROUPS.inspect;
    if (conf.role) {
      state.fnRole = conf.role;
      state.specKind = "";
      setGroupSub("fn", conf.role);
    }
    setPanelGroup(conf.group);
    if (conf.sub) setGroupSub(conf.group, conf.sub);
    if (conf.group === "fn") {
      const note = $("#fnNote");
      if (note) note.textContent = state.fnRole === "edge" ? "\u8FDE\u63A5\u51FD\u6570" : "\u8282\u70B9\u51FD\u6570";
      renderSpecPane();
      requestDraw();
    }
    if (conf.sub === "chart") {
      resizeChart();
      scheduleChartDraw();
    }
    if (conf.sub === "vector") {
      resizePhase();
      renderVectorNodeList();
      drawPhase();
    }
    if (conf.sub === "plotkit") {
      $("#btnOpenPlotkit")?.focus({ preventScroll: true });
    }
    notifyPlotkit(conf.sub === "plotkit");
    if (conf.sub === "analysis") {
      renderAnalysisPanel();
    }
    if (conf.sub === "blocks") {
      renderBlocksPanel();
    }
    if (conf.sub === "ext") {
      renderExtensionPanel();
    }
    if (conf.group === "fem") {
      renderFemPanel();
      resizeFem();
      updateFemPanelValues();
      drawFem();
    }
  }
  function plotkitFrames() {
    return [$("#plotkitFrame"), $("#plotkitInlineHost iframe")].filter(Boolean);
  }
  function notifyPlotkit(visible) {
    for (const frame of plotkitFrames()) {
      try {
        frame.contentWindow?.postMessage({ type: "plotkit-visibility", visible: Boolean(visible) }, "*");
      } catch (err) {
      }
    }
    const want = Boolean(visible);
    if (want !== state.plotkitActive) {
      state.plotkitActive = want;
      api("/api/plotkit/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: want })
      }).catch(() => {
      });
    }
  }
  function positionPopup(popup, x, y) {
    popup.classList.remove("hidden");
    popup.style.left = "0px";
    popup.style.top = "0px";
    const stageRect = stage.getBoundingClientRect();
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    const left = clamp(x, 8, Math.max(8, stageRect.width - width - 8));
    const top = clamp(y, 8, Math.max(8, stageRect.height - height - 8));
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }
  function closePopups() {
    ui.addMenu.classList.add("hidden");
    ui.linkMenu.classList.add("hidden");
  }
  function openGenericMenu(popup, x, y, title, items) {
    popup.replaceChildren();
    popup.appendChild(div("popup-title", title));
    for (const item of items) {
      if (item.sep) {
        popup.appendChild(div("popup-sep"));
        continue;
      }
      if (Array.isArray(item.children)) {
        const node2 = el("button", "popup-item");
        node2.type = "button";
        node2.appendChild(el("strong", null, `${item.label}  \u25B8`));
        if (item.hint) node2.appendChild(el("small", null, item.hint));
        node2.addEventListener("click", (event) => {
          event.stopPropagation();
          const children = [
            ...item.children,
            { sep: true },
            {
              label: "\u2039 \u8FD4\u56DE",
              action: () => openGenericMenu(popup, x, y, title, items)
            }
          ];
          openGenericMenu(popup, x, y, `${title} \u203A ${item.label}`, children);
        });
        popup.appendChild(node2);
        continue;
      }
      const node = el("button", "popup-item");
      node.type = "button";
      const strong = el("strong", null, item.label);
      if (item.danger) strong.style.color = "#fca5a5";
      node.appendChild(strong);
      if (item.hint) node.appendChild(el("small", null, item.hint));
      node.addEventListener("click", () => {
        closePopups();
        item.action();
      });
      popup.appendChild(node);
    }
    positionPopup(popup, x, y);
  }
  const ELEMENT_GROUP_ORDER = [
    "\u57FA\u7840\u65E0\u6E90",
    "\u7535\u6E90",
    "\u53D7\u63A7\u6E90",
    "\u4E8C\u6781\u7BA1",
    "\u5F00\u5173",
    "\u653E\u5927\u4E0E\u6BD4\u8F83",
    "\u6676\u4F53\u7BA1",
    "\u6570\u5B57\u4E0E\u903B\u8F91",
    "\u8BA1\u65F6\u4E0E\u7535\u6E90\u7BA1\u7406",
    "\u78C1\u6027"
  ];
  const COMPUTE_GROUP_ORDER = ["\u57FA\u7840", "\u52A8\u6001", "\u9AD8\u7EA7", "\u77E2\u91CF", "\u6A21\u5757", "\u63A5\u53E3"];
  function buildAddMenuItems(placeX, placeY) {
    const list = kindListFor("node");
    const items = [];
    if (state.mode !== "circuit") {
      const byGroup = /* @__PURE__ */ new Map();
      for (const spec of list) {
        if (spec.addable === false) continue;
        const group = String(spec.group || "\u672A\u5206\u7C7B");
        if (!byGroup.has(group)) byGroup.set(group, []);
        byGroup.get(group).push(spec);
      }
      const order = state.mode === "vector" ? ["\u77E2\u91CF", ...COMPUTE_GROUP_ORDER.filter((group) => group !== "\u77E2\u91CF")] : COMPUTE_GROUP_ORDER;
      const emitted = /* @__PURE__ */ new Set();
      for (const group of [...order, ...byGroup.keys()]) {
        if (emitted.has(group)) continue;
        const specs = byGroup.get(group);
        if (!specs || !specs.length) continue;
        emitted.add(group);
        items.push({
          label: `\u8282\u70B9 \xB7 ${group}`,
          hint: `${specs.length} \u79CD`,
          children: specs.map((spec) => ({
            label: spec.label,
            hint: spec.description,
            action: () => addNodeAt(spec.kind, placeX, placeY)
          }))
        });
      }
      return items;
    }
    for (const spec of list) {
      if (spec.addable === false) continue;
      items.push({
        label: spec.label,
        hint: state.mode === "circuit" && spec.kind === "ground" ? "\u53C2\u8003\u8282\u70B9\uFF08R21\uFF1A\u53EF\u653E\u591A\u4E2A\uFF0C\u81EA\u52A8\u5408\u5E76\u4E3A 0V\uFF09" : spec.description,
        action: () => addNodeAt(spec.kind, placeX, placeY)
      });
    }
    if (state.mode === "circuit") {
      const byGroup = /* @__PURE__ */ new Map();
      for (const spec of state.catalog?.elements || []) {
        const group = String(spec.group || "\u672A\u5206\u7C7B");
        if (!byGroup.has(group)) byGroup.set(group, []);
        byGroup.get(group).push(spec);
      }
      for (const group of ELEMENT_GROUP_ORDER) {
        const specs = byGroup.get(group);
        if (!specs || !specs.length) continue;
        items.push({
          label: `\u5668\u4EF6 \xB7 ${group}`,
          hint: `${specs.length} \u79CD`,
          children: specs.map((spec) => ({
            label: spec.label,
            hint: spec.description,
            action: () => addDeviceAt(spec.kind, placeX, placeY)
          }))
        });
      }
      items.push({ sep: true });
      items.push({
        label: "\u5BFC\u7EBF\u5DE5\u5177\uFF08\u70B9\u4E24\u7AEF\uFF09\u2026",
        hint: "\u4F9D\u6B21\u70B9\u51FB\u4E24\u4E2A\u7AEF\u70B9\uFF1BEsc \u53D6\u6D88",
        action: () => startWireTool()
      });
      items.push({
        label: "\u5BFC\u7EBF\uFF08\u9009\u62E9\u7AEF\u70B9\uFF09\u2026",
        hint: "\u70B9\u4E24\u4E2A\u7AEF\u70B9\u5EFA\u7EBF\uFF1B\u4E5F\u53EF\u4ECE\u5F15\u811A\u62D6\u62FD\uFF08R22\uFF09",
        action: () => openWireDialog()
      });
    }
    return items;
  }
  function openAddMenu(x, y, placeX = x, placeY = y) {
    if (!state.catalog) return;
    const items = buildAddMenuItems(placeX, placeY);
    const menuLabel = state.mode === "circuit" ? "\u7535\u5B66\u8282\u70B9/\u5668\u4EF6" : state.mode === "vector" ? "\u77E2\u91CF\u8282\u70B9" : "\u8BA1\u7B97\u8282\u70B9";
    openGenericMenu(ui.addMenu, x, y, `\u6DFB\u52A0${menuLabel}`, items);
  }
  function centerPlacement() {
    const count = state.scene?.nodes?.length || 0;
    const offset = (count % 3 - 1) * 46;
    return {
      x: state.canvasSize.w / 2 + offset,
      y: state.canvasSize.h / 2 + offset
    };
  }
  function openLinkMenu(targetId, x, y, forcedSourceId) {
    const sourceId = forcedSourceId || state.drag?.sourceId;
    const target = nodeById(targetId);
    const source = nodeById(sourceId);
    if (!source || !target) return;
    if (state.mode === "circuit" && source.id === target.id) {
      toast("\u7535\u8DEF\u5143\u4EF6\u4E24\u7AEF\u4E0D\u80FD\u662F\u540C\u4E00\u4E2A\u8282\u70B9", "error");
      state.drag = null;
      return;
    }
    if (state.mode === "circuit" && (isPinNode(source) || isPinNode(target))) {
      if (isPinNode(source) && isPinNode(target)) {
        toast("\u5BFC\u7EBF\u53EA\u5141\u8BB8\u300C\u5668\u4EF6/\u6A21\u5757\u5F15\u811A \u2194 \u7F51\u7EDC\u8282\u70B9\u300D", "error", 4e3);
        state.drag = null;
        return;
      }
      const deviceNode = isPinNode(source) ? source : target;
      const netNode = isPinNode(source) ? target : source;
      const used = new Set((state.scene?.edges || []).filter((edge) => edge.kind === "wire").map((edge) => edge.source === deviceNode.id ? edge.source_pin : edge.target === deviceNode.id ? edge.target_pin : ""));
      const items2 = devicePins(deviceNode).filter((pin) => !used.has(pin.name)).map((pin) => ({
        label: `${deviceNode.name}.${pin.name}`,
        hint: `${pin.role}${pin.required ? " \xB7 \u5FC5\u63A5" : ""} \u2192 ${netNode.name}`,
        action: () => createWire(deviceNode.id, netNode.id, pin.name)
      }));
      if (!items2.length) {
        toast(`${deviceNode.name} \u7684\u5F15\u811A\u90FD\u5DF2\u8FDE\u63A5`, "info", 3e3);
        state.drag = null;
        return;
      }
      openGenericMenu(ui.linkMenu, x, y, `${deviceNode.name} \u5F15\u811A \u2192 ${netNode.name}`, items2);
      state.drag = null;
      return;
    }
    const netKind = (node) => node.kind === "node" || node.kind === "ground";
    const items = [];
    if (state.mode === "circuit" && netKind(source) && netKind(target)) {
      items.push({
        label: "\u7EAF\u5BFC\u7EBF\uFF08\u5408\u5E76\u4E24\u4E2A\u7F51\u7EDC\u8282\u70B9\uFF09",
        hint: "\u7535\u6C14\u4E0A\u89C6\u4E3A\u540C\u4E00\u4E2A\u7F51\u7EDC\uFF1B\u53EF\u4EE5\u8FDE\u7EED\u753B\u591A\u6BB5",
        action: () => createWireBetween(source.id, target.id, "", "")
      });
    }
    const list = kindListFor("edge");
    items.push(...list.map((spec) => ({
      label: spec.label,
      hint: spec.description,
      action: () => createEdge(source.id, target.id, spec.kind)
    })));
    openGenericMenu(ui.linkMenu, x, y, `${source.name} \u2192 ${target.name}`, items);
    state.drag = null;
  }
  let modalResolver = null;
  function closeModal() {
    ui.modal.classList.add("hidden");
    ui.modalCard.replaceChildren();
    const resolver = modalResolver;
    modalResolver = null;
    if (resolver) resolver(false);
  }
  function confirmModal(title, message, confirmLabel = "\u786E\u5B9A", danger = false) {
    return new Promise((resolve) => {
      if (modalResolver) modalResolver(false);
      modalResolver = resolve;
      ui.modalCard.replaceChildren();
      const heading = el("h3", null, title);
      const body = message instanceof Node ? message : el("p", null, message);
      const actions = div("modal-actions");
      const cancel = button("\u53D6\u6D88", "btn", () => {
        ui.modal.classList.add("hidden");
        const inner = modalResolver;
        modalResolver = null;
        if (inner) inner(false);
      });
      const okay = button(confirmLabel, danger ? "btn danger" : "btn primary", () => {
        ui.modal.classList.add("hidden");
        const inner = modalResolver;
        modalResolver = null;
        if (inner) inner(true);
      });
      actions.append(cancel, okay);
      ui.modalCard.append(heading, body, actions);
      ui.modal.classList.remove("hidden");
      setTimeout(() => okay.focus(), 30);
      ui.modal.onclick = (event) => {
        if (event.target === ui.modal) cancel.click();
      };
      const onKey = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          document.removeEventListener("keydown", onKey, true);
          cancel.click();
        }
      };
      document.addEventListener("keydown", onKey, true);
    });
  }
  let modeResolver = null;
  function chooseModeModal() {
    return new Promise((resolve) => {
      if (modeResolver) modeResolver(null);
      modeResolver = resolve;
      ui.modalCard.replaceChildren();
      const finish = (value) => {
        ui.modal.classList.add("hidden");
        ui.modalCard.replaceChildren();
        const inner = modeResolver;
        modeResolver = null;
        if (inner) inner(value);
      };
      const heading = el("h3", null, "\u65B0\u5EFA\u5DE5\u7A0B\uFF1A\u9009\u62E9\u573A\u666F\u6A21\u5F0F");
      const body = el("p", null, "\u6A21\u5F0F\u51B3\u5B9A\u53EF\u7528\u5143\u4EF6\u4E0E\u6C42\u89E3\u5668\uFF1B\u521B\u5EFA\u540E\u4ECD\u53EF\u901A\u8FC7\u6253\u5F00\u5DE5\u7A0B\u5207\u6362\u3002");
      const list = div("modal-actions");
      const make = (mode, label, hint) => {
        const item = button(`${label} \xB7 ${hint}`, "btn", () => finish(mode));
        item.style.flex = "1";
        return item;
      };
      const cancel = button("\u53D6\u6D88", "btn", () => finish(null));
      list.append(
        make("signal", "\u4FE1\u53F7\u6D41", "\u589E\u76CA/\u6C42\u548C/\u6EE4\u6CE2"),
        make("circuit", "\u7535\u8DEF", "\u5668\u4EF6\u8282\u70B9\u4E0E MNA"),
        make("vector", "\u77E2\u91CF\u573A", "\u6709\u9650\u5143/\u573A\u6C42\u89E3")
      );
      const actions = div("modal-actions");
      actions.append(cancel);
      ui.modalCard.append(heading, body, list, actions);
      ui.modal.classList.remove("hidden");
      ui.modal.onclick = (event) => {
        if (event.target === ui.modal) finish(null);
      };
    });
  }
  function showHelp() {
    openDoc("shortcuts");
  }
  function markDirty() {
    state.inspectorDirty = true;
    const save = ui.inspector.querySelector('[data-role="save"]');
    if (save) {
      save.textContent = "\u5E94\u7528\u4FEE\u6539 \u2022";
      save.classList.add("dirty");
    }
    const badge = ui.inspector.querySelector('[data-role="dirty-badge"]');
    if (badge) badge.classList.remove("hidden");
  }
  function clearDirty() {
    state.inspectorDirty = false;
    const save = ui.inspector.querySelector('[data-role="save"]');
    if (save) {
      save.textContent = "\u5E94\u7528\u4FEE\u6539";
      save.classList.remove("dirty");
    }
    const badge = ui.inspector.querySelector('[data-role="dirty-badge"]');
    if (badge) badge.classList.add("hidden");
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
          toast("\u5F53\u524D\u4FEE\u6539\u65E0\u6CD5\u4FDD\u5B58\uFF0C\u8BF7\u5148\u4FEE\u6B63\u68C0\u67E5\u5668\u4E2D\u7684\u53C2\u6570", "error", 5e3);
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
    if (state.selection.type === "node" && state.selection.id) nodes.add(state.selection.id);
    if (state.selection.type === "edge" && state.selection.id) edges.add(state.selection.id);
    return { nodes, edges };
  }
  function toggleMultiSelection(type, id) {
    if (type === "node") {
      if (state.multi.nodes.has(id)) state.multi.nodes.delete(id);
      else state.multi.nodes.add(id);
    } else if (type === "edge") {
      if (state.multi.edges.has(id)) state.multi.edges.delete(id);
      else state.multi.edges.add(id);
    }
    if (state.multi.nodes.size + state.multi.edges.size === 1) {
      const onlyNode = state.multi.nodes.values().next().value;
      const onlyEdge = state.multi.edges.values().next().value;
      if (onlyNode) void selectEntity("node", onlyNode);
      else if (onlyEdge) void selectEntity("edge", onlyEdge);
    } else {
      requestDraw();
    }
    toast(`\u5DF2\u9009 ${state.multi.nodes.size} \u8282\u70B9 / ${state.multi.edges.size} \u8FDE\u63A5`, "info", 1600);
  }
  function selectAll() {
    state.multi.nodes = new Set((state.scene?.nodes || []).map((node) => node.id));
    state.multi.edges = new Set((state.scene?.edges || []).map((edge) => edge.id));
    requestDraw();
    toast(`\u5DF2\u5168\u9009 ${state.multi.nodes.size} \u8282\u70B9 / ${state.multi.edges.size} \u8FDE\u63A5`, "info", 1800);
  }
  function clipboardPayload() {
    const { nodes, edges } = multiSelection();
    if (!nodes.size && !edges.size) return null;
    const nodeSet = new Set(nodes);
    const edgeList = (state.scene?.edges || []).filter(
      (edge) => edges.has(edge.id) || nodeSet.has(edge.source) && nodeSet.has(edge.target)
    );
    return {
      networkId: state.currentNetwork?.id || "",
      nodes: (state.scene?.nodes || []).filter((node) => nodeSet.has(node.id)).map((node) => JSON.parse(JSON.stringify(node))),
      edges: edgeList.map((edge) => JSON.parse(JSON.stringify(edge)))
    };
  }
  function copySelection(cut = false) {
    const payload = clipboardPayload();
    if (!payload) {
      toast("\u5148\u5728\u753B\u5E03\u4E0A\u9009\u62E9\u8282\u70B9\u6216\u8FDE\u7EBF\uFF08Ctrl+\u5355\u51FB / Ctrl+\u62D6\u6846\uFF09", "info", 2600);
      return;
    }
    state.clipboard = payload;
    if (cut) {
      void deleteSelection();
      toast(`\u5DF2\u526A\u5207 ${payload.nodes.length} \u8282\u70B9 / ${payload.edges.length} \u8FDE\u63A5`, "ok", 2200);
    } else {
      toast(`\u5DF2\u590D\u5236 ${payload.nodes.length} \u8282\u70B9 / ${payload.edges.length} \u8FDE\u63A5`, "ok", 2200);
    }
  }
  function uniquePasteName(base, reserved) {
    const existing = new Set((state.scene?.nodes || []).map((node) => node.name));
    let candidate = `${String(base || "node").slice(0, 24)}_copy`;
    let index = 2;
    while (existing.has(candidate) || reserved.has(candidate)) {
      candidate = `${String(base || "node").slice(0, 22)}_c${index++}`;
    }
    reserved.add(candidate);
    return candidate.slice(0, 32);
  }
  async function pasteClipboard() {
    const clipboard = state.clipboard;
    if (!clipboard || !clipboard.nodes.length && !clipboard.edges.length) {
      toast("\u526A\u8D34\u677F\u4E3A\u7A7A\uFF1A\u5148 Ctrl+C \u590D\u5236\u9009\u4E2D\u5BF9\u8C61", "info", 2400);
      return;
    }
    if (clipboard.networkId && clipboard.networkId !== (state.currentNetwork?.id || "")) {
      const confirmed = await confirmModal(
        "\u8DE8\u7F51\u7EDC\u7C98\u8D34\uFF1F",
        "\u526A\u8D34\u677F\u6765\u81EA\u53E6\u4E00\u4E2A\u7F51\u7EDC\u3002\u8FDE\u63A5\u4E0E\u53C2\u6570\u4F1A\u4FDD\u7559\u7ED1\u5B9A\uFF0C\u4F46\u8DE8\u5C42\u8BED\u4E49\u8BF7\u81EA\u884C\u786E\u8BA4\u3002",
        "\u7C98\u8D34",
        false
      );
      if (!confirmed) return;
    }
    const offset = 28;
    await pushUndoSnapshot();
    const reserved = /* @__PURE__ */ new Set();
    const idMap = /* @__PURE__ */ new Map();
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
          y: (Number(node.position?.y) || 0) + offset
        },
        size: node.size || {}
      };
      const response = await task(() => jsonRequest("/api/nodes", "POST", payload), { history: false });
      if (!response?.node) continue;
      idMap.set(node.id, response.node.id);
      nodesCreated += 1;
    }
    for (const edge of clipboard.edges) {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target) continue;
      const response = await task(
        () => jsonRequest("/api/edges", "POST", {
          source,
          target,
          kind: edge.kind,
          params: edge.params || {},
          delay: Boolean(edge.delay),
          enabled: edge.enabled !== false,
          auto_delay: false,
          route: edge.route || "auto",
          waypoints: edge.waypoints || [],
          anchors: edge.anchors || {}
        }),
        { history: false }
      );
      if (response) edgesCreated += 1;
    }
    await refreshState(true);
    toast(`\u5DF2\u7C98\u8D34 ${nodesCreated} \u8282\u70B9 / ${edgesCreated} \u8FDE\u63A5`, "ok", 2600);
  }
  async function captureSceneSnapshot() {
    try {
      return await jsonRequest("/api/scene/export", "GET");
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
    const merged = { ...payload, blocks: current?.blocks || [] };
    await jsonRequest("/api/control", "POST", { action: "pause" });
    const response = await jsonRequest("/api/scene", "POST", merged);
    if (!response?.scene) return;
    clearSelection();
    applySnapshot(response);
    renderInspector();
    markProjectDirty();
  }
  async function undo() {
    const snapshot = state.undoStack.pop();
    if (!snapshot) {
      toast("\u6CA1\u6709\u53EF\u64A4\u9500\u7684\u64CD\u4F5C", "info", 2e3);
      return;
    }
    const current = await captureSceneSnapshot();
    if (current) state.redoStack.push(current);
    await task(() => restoreSceneSnapshot(snapshot), { dirty: true, history: false });
    toast("\u5DF2\u64A4\u9500", "ok", 1600);
  }
  async function redo() {
    const snapshot = state.redoStack.pop();
    if (!snapshot) {
      toast("\u6CA1\u6709\u53EF\u91CD\u505A\u7684\u64CD\u4F5C", "info", 2e3);
      return;
    }
    const current = await captureSceneSnapshot();
    if (current) state.undoStack.push(current);
    await task(() => restoreSceneSnapshot(snapshot), { dirty: true, history: false });
    toast("\u5DF2\u91CD\u505A", "ok", 1600);
  }
  function formatAny(value) {
    if (typeof value === "number") return fmt(value, 5);
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value === null || value === void 0) return "\u2014";
    if (typeof value === "object") {
      const text = JSON.stringify(value);
      return text.length > 140 ? `${text.slice(0, 140)}\u2026` : text;
    }
    return String(value);
  }
  function valueToText(value) {
    if (typeof value === "string") return value;
    if (value === null || value === void 0) return "";
    if (typeof value === "object") return JSON.stringify(value, null, 0);
    return String(value);
  }
  function parseSmartValue(text) {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) return "";
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (trimmed === "null") return null;
    if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
      const number = Number(trimmed);
      if (Number.isFinite(number)) return number;
    }
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        throw new Error("\u6570\u636E\u5B57\u6BB5\u770B\u8D77\u6765\u662F JSON\uFF0C\u4F46\u683C\u5F0F\u4E0D\u5408\u6CD5");
      }
    }
    return trimmed;
  }
  function kindListFor(role) {
    if (!state.catalog) return [];
    if (role === "node") {
      if (state.mode === "circuit") return state.catalog.circuit_nodes || [];
      const computes = state.catalog.computes || [];
      if (state.mode === "vector") {
        return computes.slice().sort((a, b) => {
          const rank = (item) => item.group === "\u77E2\u91CF" ? 0 : 1;
          return rank(a) - rank(b);
        });
      }
      return computes;
    }
    if (state.mode === "circuit") return state.catalog.elements || [];
    const methods = state.catalog.methods || [];
    if (state.mode === "vector") {
      return methods.slice().sort((a, b) => {
        const rank = (item) => item.group === "\u77E2\u91CF" ? 0 : 1;
        return rank(a) - rank(b);
      });
    }
    return methods;
  }
  function buildKindSelect(role, currentKind, currentId = null) {
    const select = el("select");
    select.dataset.role = "kind";
    const list = kindListFor(role);
    const groups = /* @__PURE__ */ new Map();
    for (const spec of list) {
      if (spec.addable === false && spec.kind !== currentKind) continue;
      const group = spec.group || "";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(spec);
    }
    const appendOption = (parent, spec) => {
      const option = el("option", null, spec.label);
      option.value = spec.kind;
      if (spec.kind === currentKind) option.selected = true;
      parent.appendChild(option);
    };
    if (state.mode !== "circuit" && role === "node") {
      for (const [group, specs] of groups) {
        const wrapper = group ? el("optgroup") : select;
        if (group) wrapper.label = group;
        specs.forEach((spec) => appendOption(wrapper, spec));
        if (group) select.appendChild(wrapper);
      }
    } else {
      for (const specs of groups.values()) specs.forEach((spec) => appendOption(select, spec));
    }
    if (!$$("option", select).some((option) => option.value === currentKind)) {
      const option = el("option", null, currentKind || "\u2014");
      option.value = currentKind || "";
      option.selected = true;
      select.appendChild(option);
    }
    return select;
  }
  function numberedField(labelText, unitText) {
    const label = el("label");
    label.appendChild(el("span", null, labelText));
    if (unitText) label.appendChild(el("em", null, unitText));
    return label;
  }
  const UNIT_PREFIXES = [
    { factor: 1e-12, prefix: "p" },
    { factor: 1e-9, prefix: "n" },
    { factor: 1e-6, prefix: "\xB5" },
    { factor: 1e-3, prefix: "m" },
    { factor: 1, prefix: "" },
    { factor: 1e3, prefix: "k" },
    { factor: 1e6, prefix: "M" }
  ];
  const PREFIXABLE_UNITS = /* @__PURE__ */ new Set(["F", "H", "\u03A9", "V", "A", "s", "Hz"]);
  function unitStorageKey(param) {
    return `netlab.unit.${param.key}.${param.unit || ""}`;
  }
  function savedUnitFactor(param) {
    try {
      const raw = localStorage.getItem(unitStorageKey(param));
      const factor = Number(raw);
      if (Number.isFinite(factor) && factor > 0) return factor;
    } catch (error) {
    }
    return 0;
  }
  function bestUnitFactor(value) {
    const magnitude = Math.abs(Number(value) || 0);
    if (!magnitude) return 1;
    for (const item of UNIT_PREFIXES) {
      if (magnitude < item.factor * 1e3) return item.factor;
    }
    return UNIT_PREFIXES[UNIT_PREFIXES.length - 1].factor;
  }
  function trimNumber(value) {
    if (!Number.isFinite(value)) return "";
    return String(Number(value.toPrecision(12)));
  }
  function buildParamField(param, value) {
    const wrap = div("field");
    wrap.dataset.param = param.key;
    wrap.dataset.type = param.type || "float";
    wrap.dataset.label = param.label || param.key;
    const labelText = param.label || param.key;
    const type = param.type || "float";
    if (type === "bool") {
      const row = div("switch-row");
      row.appendChild(el("span", null, labelText));
      const input = el("input");
      input.type = "checkbox";
      input.checked = Boolean(value);
      input.dataset.role = "param-input";
      row.appendChild(input);
      wrap.appendChild(row);
    } else {
      const prefixable = type === "float" && PREFIXABLE_UNITS.has(String(param.unit || ""));
      const fieldLabel = numberedField(labelText, prefixable ? "" : param.unit || "");
      typeLabelHelp(fieldLabel, param);
      wrap.appendChild(fieldLabel);
      let control2;
      let unitSelect = null;
      if (type === "choice") {
        control2 = el("select");
        for (const choice of param.choices || []) {
          const option = el("option", null, choice.label || choice.value);
          option.value = choice.value;
          if (String(value) === String(choice.value)) option.selected = true;
          control2.appendChild(option);
        }
      } else if (type === "float" || type === "int") {
        control2 = el("input");
        control2.type = "number";
        control2.step = param.step !== void 0 && param.step !== null ? String(param.step) : type === "int" ? "1" : "any";
        if (param.min !== void 0 && param.min !== null) control2.min = String(param.min);
        if (param.max !== void 0 && param.max !== null) control2.max = String(param.max);
        control2.value = value === void 0 || value === null ? "" : String(value);
        if (prefixable) {
          const factor = savedUnitFactor(param) || bestUnitFactor(Number(value) || 0);
          if (!savedUnitFactor(param)) {
            try {
              localStorage.setItem(unitStorageKey(param), String(factor));
            } catch (error) {
            }
          }
          control2.value = trimNumber((Number(value) || 0) / factor);
          control2.step = "any";
          if (param.min !== void 0 && param.min !== null) control2.min = String(Number(param.min) / factor);
          if (param.max !== void 0 && param.max !== null) control2.max = String(Number(param.max) / factor);
          unitSelect = el("select");
          unitSelect.className = "unit-select";
          unitSelect.dataset.role = "param-unit";
          unitSelect.dataset.baseMin = param.min !== void 0 && param.min !== null ? String(param.min) : "";
          unitSelect.dataset.baseMax = param.max !== void 0 && param.max !== null ? String(param.max) : "";
          for (const item of UNIT_PREFIXES) {
            const option = el("option", null, `${item.prefix}${param.unit}`);
            option.value = String(item.factor);
            unitSelect.appendChild(option);
          }
          unitSelect.value = String(factor);
          unitSelect.dataset.factor = String(factor);
          unitSelect.addEventListener("change", () => {
            const oldFactor = Number(unitSelect.dataset.factor) || 1;
            const nextFactor = Number(unitSelect.value) || 1;
            const number = Number(control2.value);
            if (Number.isFinite(number)) control2.value = trimNumber(number * oldFactor / nextFactor);
            unitSelect.dataset.factor = String(nextFactor);
            try {
              localStorage.setItem(unitStorageKey(param), String(nextFactor));
            } catch (error) {
            }
            const baseMin = unitSelect.dataset.baseMin;
            const baseMax = unitSelect.dataset.baseMax;
            control2.min = baseMin === "" ? "" : String(Number(baseMin) / nextFactor);
            control2.max = baseMax === "" ? "" : String(Number(baseMax) / nextFactor);
          });
        }
      } else if (type === "node") {
        control2 = el("select");
        const empty = el("option", null, "\uFF08\u672A\u8BBE\u7F6E\uFF09");
        empty.value = "";
        control2.appendChild(empty);
        for (const node of state.scene?.nodes || []) {
          const option = el("option", null, `${node.name} \xB7 ${node.kind}`);
          option.value = node.id;
          if (value === node.id) option.selected = true;
          control2.appendChild(option);
        }
      } else if (type === "json" || type === "matrix" || type === "list" || type === "mapping") {
        control2 = el("textarea");
        if (type === "matrix" || param.key === "A" || param.key === "B" || param.key === "C" || param.key === "D") {
          control2.classList.add("tall");
        }
        control2.value = JSON.stringify(value === void 0 ? param.default : value, null, 2);
        control2.spellcheck = false;
        control2.addEventListener("blur", () => {
          try {
            JSON.parse(control2.value);
            control2.classList.remove("invalid");
          } catch (error) {
            control2.classList.add("invalid");
          }
        });
      } else {
        control2 = el("input");
        control2.type = "text";
        control2.value = value === void 0 || value === null ? "" : String(value);
        if (param.placeholder) control2.placeholder = param.placeholder;
        if (param.key === "expr") control2.classList.add("mono");
      }
      control2.dataset.role = "param-input";
      if (param.placeholder && (type === "json" || type === "matrix" || type === "list" || type === "mapping")) {
        control2.placeholder = param.placeholder;
      }
      if (unitSelect) {
        const unitRow = div("param-unit-row");
        unitRow.append(control2, unitSelect);
        wrap.appendChild(unitRow);
      } else {
        wrap.appendChild(control2);
      }
    }
    if (param.help) wrap.appendChild(div("help", param.help));
    return wrap;
  }
  function applyPresetOnModelChange(container, spec) {
    const presets = spec.presets || {};
    const modelField = container.querySelector('[data-param="model"]');
    if (!modelField || !Object.keys(presets).length) return;
    const select = modelField.querySelector("select");
    if (!select) return;
    select.addEventListener("change", () => {
      const preset = presets[select.value];
      if (!preset) return;
      for (const [key, value] of Object.entries(preset)) {
        const field = container.querySelector(`[data-param="${key}"]`);
        const input = field ? field.querySelector("input") : null;
        if (!input) continue;
        const unit = field.querySelector('[data-role="param-unit"]');
        const factor = unit ? Number(unit.value) || 1 : 1;
        input.value = trimNumber(Number(value) / factor);
      }
    });
  }
  const WAVE_FIELDS = {
    dc: ["offset"],
    sine: ["offset", "amplitude", "frequency", "phase", "delay"],
    square: ["offset", "amplitude", "frequency", "phase", "delay"],
    triangle: ["offset", "amplitude", "frequency", "phase", "delay"],
    saw: ["offset", "amplitude", "frequency", "phase", "delay"],
    pulse: ["offset", "amplitude", "frequency", "phase", "duty", "delay"],
    step: ["offset", "amplitude", "delay"],
    ramp: ["offset", "amplitude", "delay"]
  };
  function applyWaveFieldVisibility(container) {
    const waveField = container.querySelector('[data-param="wave"]');
    const select = waveField ? waveField.querySelector("select") : null;
    if (!select) return;
    const allowed = new Set(WAVE_FIELDS[select.value] || []);
    for (const field of container.querySelectorAll(".field[data-param]")) {
      const key = field.dataset.param;
      if (key === "wave") continue;
      field.hidden = !allowed.has(key);
    }
    const hint = waveField.querySelector('[data-role="wave-hint"]');
    if (hint) {
      hint.textContent = select.value === "dc" ? "DC \u6A21\u5F0F\u53EA\u4F7F\u7528\u300C\u504F\u7F6E / \u76F4\u6D41\u7535\u538B\u300D\uFF1B\u5E45\u503C\u3001\u9891\u7387\u7B49\u4E0D\u53C2\u4E0E\u8BA1\u7B97\u3002" : "\u5468\u671F\u6CE2\u5F62\u4F7F\u7528\u504F\u7F6E + \u5E45\u503C + \u9891\u7387\uFF08\u65B9\u6CE2/\u8109\u51B2\u53E6\u6709\u5360\u7A7A\u6BD4\uFF09\u3002";
    }
  }
  function buildWaveFieldVisibility(container) {
    const waveField = container.querySelector('[data-param="wave"]');
    if (!waveField) return;
    const select = waveField.querySelector("select");
    if (!select) return;
    if (!waveField.querySelector('[data-role="wave-hint"]')) {
      const hint = div("help");
      hint.dataset.role = "wave-hint";
      waveField.appendChild(hint);
    }
    select.addEventListener("change", () => applyWaveFieldVisibility(container));
    applyWaveFieldVisibility(container);
  }
  function buildParamFields(spec, params) {
    const container = div("params-grid");
    container.dataset.role = "params";
    if (!spec || !Array.isArray(spec.params) || !spec.params.length) {
      container.appendChild(div("help", "\u8BE5\u7C7B\u578B\u6CA1\u6709\u53EF\u8C03\u53C2\u6570\u3002"));
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
    for (const wrapper of $$("[data-param]", container)) {
      const key = wrapper.dataset.param;
      const type = wrapper.dataset.type;
      const label = wrapper.dataset.label || key;
      const input = wrapper.querySelector("input, select, textarea");
      if (!input) continue;
      if (type === "bool") {
        values[key] = Boolean(input.checked);
      } else if (type === "float" || type === "int") {
        const text = String(input.value).trim();
        if (!text) throw new Error(`\u53C2\u6570\u300C${label}\u300D\u4E0D\u80FD\u4E3A\u7A7A`);
        const number = Number(text);
        if (!Number.isFinite(number)) throw new Error(`\u53C2\u6570\u300C${label}\u300D\u5FC5\u987B\u662F\u6709\u9650\u6570\u5B57`);
        if (type === "int" && !Number.isInteger(number)) throw new Error(`\u53C2\u6570\u300C${label}\u300D\u5FC5\u987B\u662F\u6574\u6570`);
        const unitSelect = wrapper.querySelector('[data-role="param-unit"]');
        values[key] = unitSelect ? number * (Number(unitSelect.value) || 1) : number;
      } else if (type === "json" || type === "matrix" || type === "list" || type === "mapping") {
        try {
          values[key] = JSON.parse(input.value);
        } catch (error) {
          input.classList.add("invalid");
          throw new Error(`\u53C2\u6570\u300C${label}\u300D\u4E0D\u662F\u5408\u6CD5 JSON`);
        }
      } else {
        values[key] = input.value;
      }
    }
    return values;
  }
  function dataRow(key, value) {
    const row = div("data-row");
    const keyInput = el("input");
    keyInput.type = "text";
    keyInput.className = "data-key";
    keyInput.placeholder = "\u5B57\u6BB5";
    keyInput.value = key;
    keyInput.spellcheck = false;
    const valueInput = el("input");
    valueInput.type = "text";
    valueInput.className = "data-val";
    valueInput.placeholder = "\u6570\u503C / \u6587\u672C / JSON";
    valueInput.value = valueToText(value);
    valueInput.spellcheck = false;
    const remove = button("\xD7", "icon-btn", () => {
      row.remove();
      markDirty();
    });
    remove.title = "\u5220\u9664\u8BE5\u5B57\u6BB5";
    keyInput.addEventListener("input", markDirty);
    valueInput.addEventListener("input", markDirty);
    row.append(keyInput, valueInput, remove);
    return row;
  }
  function collectData(container) {
    const result = {};
    for (const row of $$(".data-row", container)) {
      const key = row.querySelector(".data-key").value.trim();
      if (!key) continue;
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        throw new Error(`\u6570\u636E\u5B57\u6BB5\u300C${key}\u300D\u91CD\u590D`);
      }
      result[key] = parseSmartValue(row.querySelector(".data-val").value);
    }
    return result;
  }
  function sectionLabel(text, note) {
    const label = div("section-label");
    label.appendChild(el("span", null, text));
    if (note) label.appendChild(el("em", null, note));
    return label;
  }
  function section(title, note, ...children) {
    const wrapper = div("section");
    wrapper.appendChild(sectionLabel(title, note));
    for (const child of children) wrapper.appendChild(child);
    return wrapper;
  }
  function renderEmptyInspector() {
    const host = div("empty-state");
    host.appendChild(el("b", null, "\u672A\u9009\u62E9\u5BF9\u8C61"));
    host.appendChild(div("help", "\u5728\u753B\u5E03\u4E0A\u5355\u51FB\u8282\u70B9\u6216\u8FDE\u63A5\u4EE5\u68C0\u67E5\u53C2\u6570\uFF1B\u53CC\u51FB\u53EF\u76F4\u63A5\u7F16\u8F91\u3002\u4E5F\u53EF\u4EE5\u4ECE\u4E0B\u9762\u7684\u5165\u53E3\u5F00\u59CB\uFF1A"));
    const actions = div("insp-actions");
    actions.appendChild(button("\u6DFB\u52A0\u8282\u70B9", "btn primary", () => {
      const place = centerPlacement();
      openAddMenu(state.canvasSize.w / 2, state.canvasSize.h / 2, place.x, place.y);
    }));
    actions.appendChild(button("\u9002\u914D\u89C6\u56FE", "btn", () => fitView(true)));
    host.appendChild(actions);
    const hint = div("help");
    hint.style.marginTop = "12px";
    if (state.mode === "vector") {
      hint.textContent = "\u77E2\u91CF\uFF1A\u975E\u7EBF\u6027\u52A8\u6001\u6E90\u4EA7\u751F x/y/vx/vy\uFF0C\u8FDE\u63A5\u53EF\u4F20\u9012\u6216\u6269\u6563\u4E8C\u7EF4\u77E2\u91CF\uFF1B\u753B\u5E03\u7BAD\u5934\u8868\u793A\u72B6\u6001\u65B9\u5411\uFF0C\u76F8\u56FE\u663E\u793A\u8F68\u8FF9\u3002";
    } else if (state.mode === "circuit") {
      hint.textContent = "\u7535\u8DEF\uFF1A\u8282\u70B9\u662F\u7B49\u7535\u4F4D\u70B9\uFF0C\u8FDE\u63A5\u662F R/L/C/\u7535\u6E90/\u4E8C\u6781\u7BA1/\u5F00\u5173/\u53D7\u63A7\u6E90\uFF0C\u4F7F\u7528\u8282\u70B9\u7535\u538B\u6CD5\uFF08MNA\uFF09\u9010\u6B65\u6C42\u89E3\u3002";
    } else {
      hint.textContent = "\u4FE1\u53F7\u6D41\uFF1A\u8282\u70B9\u5BF9\u5165\u8FB9\u6570\u636E\u6C42\u548C/\u53D8\u6362\uFF0C\u8FDE\u63A5\u8D1F\u8D23\u5B57\u6BB5\u4F20\u9012\u3001\u5EF6\u8FDF\u3001\u4F20\u9012\u51FD\u6570\u4E0E\u79EF\u5206\u3002\u4EE3\u6570\u73AF\u4F1A\u81EA\u52A8\u63D2\u5165\u5EF6\u8FDF\u3002";
    }
    host.appendChild(hint);
    ui.inspector.replaceChildren(host);
    state.inspectorId = null;
  }
  function buildDevicePinList(node) {
    const container = div("kv");
    const wires = (state.scene?.edges || []).filter((edge) => edge.kind === "wire");
    const pins = devicePins(node);
    if (!pins.length) {
      container.appendChild(div("help", "\u8BE5\u5143\u4EF6\u6CA1\u6709\u5F15\u811A\u58F0\u660E\u3002"));
      return container;
    }
    for (const pin of pins) {
      const row = div("kv-row");
      row.appendChild(el("span", null, `${pin.name}${pin.required ? " *" : ""}`));
      const wire = wires.find((edge) => edge.source === node.id && edge.source_pin === pin.name || edge.target === node.id && edge.target_pin === pin.name);
      const netId = wire ? wire.source === node.id ? wire.target : wire.source : "";
      const net = netId ? nodeById(netId) : null;
      row.appendChild(el("b", null, net ? net.name : pin.required ? "\u672A\u63A5" : "\u2014"));
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
    if (state.selection.type === "node") {
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
    const head = div("insp-head");
    const title = div("insp-title");
    const heading = el("h2", null, titleText);
    const sub = el("p", null, subtitle);
    title.append(heading, sub);
    const badges = div("insp-badges");
    const badge = el("span", "badge", specLabel);
    badges.appendChild(badge);
    const dirty = el("span", "badge gray hidden", "\u672A\u5E94\u7528");
    dirty.dataset.role = "dirty-badge";
    badges.appendChild(dirty);
    head.append(title, badges);
    return { head, heading, badge };
  }
  function renderNodeInspector(node) {
    const isModule = state.mode === "circuit" && node.kind === "module";
    const isDevice = state.mode === "circuit" && node.kind === "device";
    const spec = isDevice ? deviceElementSpec(node) : isModule ? null : getNodeSpec(node.kind);
    const specLabel = isModule ? "\u6A21\u5757" : spec?.label || node.kind;
    const { head, heading, badge } = buildHeader(
      node.name,
      `${specLabel} \xB7 ${isModule ? "\u6A21\u5757\u5B9E\u4F8B" : isDevice ? "\u5668\u4EF6" : "\u8282\u70B9"} ${node.id}`,
      specLabel
    );
    const form = el("form");
    form.dataset.role = "form";
    form.autocomplete = "off";
    const identity = section("\u8EAB\u4EFD");
    const nameField = div("field");
    nameField.appendChild(numberedField("\u540D\u79F0", "\u6700\u591A 32 \u5B57\u7B26"));
    const nameInput = el("input");
    nameInput.type = "text";
    nameInput.maxLength = 32;
    nameInput.value = node.name;
    nameInput.dataset.role = "name";
    nameInput.addEventListener("input", () => {
      heading.textContent = nameInput.value.trim() || node.name;
      markDirty();
    });
    nameField.appendChild(nameInput);
    identity.appendChild(nameField);
    const kindField = div("field");
    let kindSelect = null;
    if (isModule) {
      kindField.appendChild(numberedField("\u6A21\u5757\u7C7B\u578B", "\u5C01\u88C5\u540E\u7684\u7535\u8DEF\u6A21\u5757\u5B9E\u4F8B"));
      const hiddenKind = el("input");
      hiddenKind.type = "hidden";
      hiddenKind.dataset.role = "kind";
      hiddenKind.value = "module";
      kindField.appendChild(hiddenKind);
      const portNames = modulePorts(node).map((port) => port.name).join("\u3001") || "\uFF08\u65E0\u7AEF\u53E3\uFF09";
      kindField.appendChild(div("help", `\u5757 ${node.params?.block_name || node.params?.block_id || "?"} \xB7 \u7AEF\u53E3 ${portNames}`));
    } else if (isDevice) {
      kindField.appendChild(numberedField("\u5143\u4EF6\u7C7B\u578B", "\u5668\u4EF6\u8282\u70B9\uFF1A\u5F15\u811A\u5728\u4E0B\u65B9\u300C\u5F15\u811A\u300D\u533A\u67E5\u770B"));
      const hiddenKind = el("input");
      hiddenKind.type = "hidden";
      hiddenKind.dataset.role = "kind";
      hiddenKind.value = "device";
      kindField.appendChild(hiddenKind);
      kindField.appendChild(div("help", `${specLabel}\uFF08${node.params?.element || "?"}\uFF09`));
    } else {
      kindField.appendChild(numberedField("\u8BA1\u7B97\u65B9\u6CD5", state.mode === "circuit" ? "\u7535\u5B66\u8282\u70B9\u7C7B\u578B" : "\u8282\u70B9\u5185\u90E8\u8BA1\u7B97"));
      kindSelect = buildKindSelect("node", node.kind, node.id);
      kindField.appendChild(kindSelect);
      kindField.appendChild(div("help", spec?.description || ""));
    }
    identity.appendChild(kindField);
    const sizeField = div("field");
    sizeField.appendChild(numberedField(isDevice ? "\u5BBD\u5EA6" : "\u5C3A\u5BF8", isDevice ? "\u5668\u4EF6\u6846\u5BBD\u5EA6 24\u2013200" : "\u76F4\u5F84 24\u2013200\uFF0C\u8FDE\u7EBF\u7AEF\u70B9\u968F\u4E4B\u8054\u52A8"));
    const sizeInput = el("input");
    sizeInput.type = "number";
    sizeInput.min = "24";
    sizeInput.max = "200";
    sizeInput.step = "4";
    sizeInput.value = String(Math.round(isDevice ? Number(node.size?.w) || 120 : nodeDiameter(node)));
    sizeInput.dataset.role = "node-size";
    sizeInput.addEventListener("change", () => {
      const value = clamp(Math.round(Number(sizeInput.value) || (isDevice ? Number(node.size?.w) || 120 : nodeDiameter(node))), 24, 200);
      sizeInput.value = String(value);
      void patchNodeGeometry(node.id, { size: { w: value } });
    });
    sizeField.appendChild(sizeInput);
    identity.appendChild(sizeField);
    const params = buildParamFields(spec, node.params || {});
    if (state.mode === "circuit" && node.kind === "node") {
      const portName = div("field");
      portName.dataset.param = "port_name";
      portName.dataset.type = "text";
      portName.dataset.label = "\u7AEF\u53E3\u540D";
      portName.appendChild(numberedField("\u7AEF\u53E3\u540D", "\u7559\u7A7A\uFF1D\u4E0D\u4F5C\u7AEF\u53E3"));
      const portInput = el("input");
      portInput.type = "text";
      portInput.maxLength = 24;
      portInput.value = String(node.params?.port_name || "");
      portName.appendChild(portInput);
      const portDir = div("field");
      portDir.dataset.param = "port_direction";
      portDir.dataset.type = "text";
      portDir.dataset.label = "\u7AEF\u53E3\u65B9\u5411";
      portDir.appendChild(numberedField("\u7AEF\u53E3\u65B9\u5411", "\u5C01\u88C5\u540E\u753B\u6210\u8FDB/\u51FA/\u53CC\u5411"));
      const dirSelect = el("select");
      for (const [value, label] of [["inout", "\u53CC\u5411"], ["input", "\u8F93\u5165"], ["output", "\u8F93\u51FA"]]) {
        const option = el("option", null, label);
        option.value = value;
        dirSelect.appendChild(option);
      }
      dirSelect.value = String(node.params?.port_direction || "inout");
      portDir.appendChild(dirSelect);
      params.append(portName, portDir);
    }
    let dataEditor = null;
    if (state.mode !== "circuit") {
      dataEditor = div("data-rows");
      dataEditor.dataset.role = "data";
      const entries = Object.entries(node.data || {});
      if (entries.length) {
        for (const [key, value] of entries) dataEditor.appendChild(dataRow(key, value));
      }
      const addRow = button("\uFF0B \u6DFB\u52A0\u5B57\u6BB5", "btn tiny", () => {
        const row = dataRow("", "");
        dataEditor.appendChild(row);
        row.querySelector(".data-key").focus();
        markDirty();
      });
      const note = div("help", "\u8BA1\u7B97\u8282\u70B9\u4F1A\u8986\u76D6\u8F93\u51FA\u5B57\u6BB5\u7684\u503C\uFF1B\u624B\u52A8\u6570\u636E\u6E90\u5219\u4EE5\u8FD9\u91CC\u7684\u503C\u4E3A\u51C6\u3002\u503C\u4E3A\u6570\u5B57\u3001true/false\u3001JSON \u6570\u7EC4/\u5BF9\u8C61\u6216\u6587\u672C\u3002");
      dataEditor.appendChild(addRow);
      dataEditor.appendChild(note);
    }
    const live = div("kv");
    live.dataset.role = "node-live";
    const display = nodeDisplayData(node);
    const numericFields = Object.keys(display).filter((key) => typeof display[key] === "number");
    for (const key of numericFields.slice(0, 10)) {
      const row = div("kv-row");
      row.appendChild(el("span", null, key));
      const value = el("b", null, fmt(display[key], 5));
      value.dataset.liveNodeValue = "1";
      value.dataset.node = node.id;
      value.dataset.field = key;
      row.appendChild(value);
      live.appendChild(row);
    }
    if (!numericFields.length) live.appendChild(div("help", "\u6682\u65E0\u5B9E\u65F6\u6570\u503C\u8F93\u51FA\u3002"));
    const inputsRow = div("kv-row");
    inputsRow.appendChild(el("span", null, "\u5165\u8FB9\u6570\u91CF"));
    const inputsValue = el("b", null, String(Object.keys(node.inputs || {}).length));
    inputsValue.dataset.liveInputs = "1";
    inputsRow.appendChild(inputsValue);
    live.appendChild(inputsRow);
    const statePre = el("pre", "json");
    statePre.textContent = JSON.stringify(node.state || {}, null, 2);
    statePre.dataset.liveState = "1";
    const actions = div("insp-actions");
    const save = button("\u5E94\u7528\u4FEE\u6539", "btn primary", null);
    save.type = "submit";
    save.dataset.role = "save";
    const remove = button("\u5220\u9664\u8282\u70B9", "btn danger", () => void deleteNode(node.id));
    actions.append(save, remove);
    const pinSection = isDevice || isModule ? section("\u5F15\u811A", isModule ? "\u6A21\u5757\u7AEF\u53E3 \u2194 \u7F51\u7EDC\u8282\u70B9\u5BFC\u7EBF" : "\u5FC5\u63A5\u5F15\u811A\u9700\u6070\u597D\u4E00\u6761\u5BFC\u7EBF\uFF08pin\u2194net\uFF09", buildDevicePinList(node)) : null;
    form.append(
      identity,
      ...pinSection ? [pinSection] : [],
      section("\u53C2\u6570", spec?.notes || "", params),
      ...dataEditor ? [section("\u8282\u70B9\u6570\u636E", "\u5B9E\u65F6\u5B57\u6BB5", dataEditor)] : [],
      section("\u5B9E\u65F6\u503C", "\u968F\u5E27\u66F4\u65B0", live),
      section("\u5185\u90E8\u72B6\u6001", "\u53EA\u8BFB", statePre),
      actions
    );
    if (kindSelect) kindSelect.addEventListener("change", () => {
      const nextSpec = getNodeSpec(kindSelect.value);
      const nextParams = buildParamFields(nextSpec, specDefaults(nextSpec));
      const current = form.querySelector('[data-role="params"]');
      if (current) current.replaceWith(nextParams);
      desc.textContent = nextSpec?.description || "";
      badge.textContent = nextSpec?.label || kindSelect.value;
      markDirty();
    });
    form.addEventListener("input", markDirty);
    form.addEventListener("change", markDirty);
    form.addEventListener("submit", (event) => {
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
      `\u5BFC\u7EBF \xB7 ${source?.name || "?"}${edge.source_pin ? `[${edge.source_pin}]` : ""} \u2192 ${target?.name || "?"}${edge.target_pin ? `[${edge.target_pin}]` : ""}`,
      "\u5BFC\u7EBF"
    );
    const form = el("form");
    form.dataset.role = "form";
    const identity = section("\u8EAB\u4EFD");
    const nameField = div("field");
    nameField.appendChild(numberedField("\u540D\u79F0", "\u6700\u591A 32 \u5B57\u7B26"));
    const nameInput = el("input");
    nameInput.type = "text";
    nameInput.maxLength = 32;
    nameInput.value = edge.name;
    nameInput.dataset.role = "name";
    nameInput.addEventListener("input", markDirty);
    nameField.appendChild(nameInput);
    identity.appendChild(nameField);
    const hiddenKind = el("input");
    hiddenKind.type = "hidden";
    hiddenKind.dataset.role = "kind";
    hiddenKind.value = "wire";
    identity.appendChild(hiddenKind);
    const params = div("params-grid");
    params.dataset.role = "params";
    const waypoints = div("params-grid");
    waypoints.dataset.role = "waypoints";
    const appendPoint = (x, y) => {
      const row = div("inline-fields");
      row.dataset.role = "waypoint-row";
      for (const [axis, value] of [["x", x], ["y", y]]) {
        const field = div("field");
        field.appendChild(numberedField(axis.toUpperCase(), ""));
        const input = el("input");
        input.type = "number";
        input.step = "10";
        input.value = String(Math.round(Number(value) || 0));
        input.dataset.role = `waypoint-${axis}`;
        input.addEventListener("input", markDirty);
        field.appendChild(input);
        row.appendChild(field);
      }
      const drop = button("\xD7", "icon-btn", () => {
        row.remove();
        markDirty();
      });
      drop.title = "\u5220\u9664\u8BE5\u6298\u70B9";
      row.appendChild(drop);
      waypoints.appendChild(row);
    };
    for (const point of edge.waypoints || []) appendPoint(point.x, point.y);
    const addPoint = button("\uFF0B \u6DFB\u52A0\u6298\u70B9", "btn tiny", () => {
      const rows = [...waypoints.querySelectorAll('[data-role="waypoint-row"]')];
      const last = rows.length ? rows[rows.length - 1] : null;
      const x = last ? Number(last.querySelector('[data-role="waypoint-x"]').value) + 40 : 0;
      const y = last ? Number(last.querySelector('[data-role="waypoint-y"]').value) : 0;
      appendPoint(x, y);
      markDirty();
    });
    addPoint.dataset.role = "waypoint-add";
    const actions = div("insp-actions");
    const save = button("\u5E94\u7528\u4FEE\u6539", "btn primary", null);
    save.type = "submit";
    save.dataset.role = "save";
    const remove = button("\u5220\u9664\u5BFC\u7EBF", "btn danger", () => void deleteEdge(edge.id));
    actions.append(save, remove);
    form.append(
      identity,
      section("\u8BF4\u660E", "\u5BFC\u7EBF\u5141\u8BB8\u300C\u7F51\u7EDC\u8282\u70B9 \u2194 \u7F51\u7EDC\u8282\u70B9\u300D\uFF08\u7EAF\u5BFC\u7EBF\uFF0C\u7535\u6C14\u5408\u5E76\uFF09\u6216\u300C\u5668\u4EF6\u5F15\u811A \u2194 \u7F51\u7EDC\u8282\u70B9\u300D", div("help", "\u5220\u9664\u5BFC\u7EBF\u5373\u65AD\u5F00\u8FDE\u63A5\uFF1B\u6298\u70B9\u4E3A\u7A7A\u65F6\u6309\u6B63\u4EA4/\u76F4\u7EBF\u8DEF\u7531\u3002")),
      section("\u6298\u70B9", "\u53EF\u8BBE\u7F6E\u591A\u4E2A\u6298\u70B9\uFF1B\u6709\u6298\u70B9\u65F6\u8DEF\u7531\u81EA\u52A8\u53D8\u4E3A\u624B\u52A8", waypoints),
      addPoint,
      section("\u53C2\u6570", "", params),
      actions
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void applyInspector();
    });
    ui.inspector.replaceChildren(head, form);
    state.inspectorId = `edge:${edge.id}`;
    state.inspectorDirty = false;
  }
  function renderEdgeInspector(edge) {
    if (edge.kind === "wire") {
      renderWireInspector(edge);
      return;
    }
    const spec = getEdgeSpec(edge.kind);
    const specLabel = spec?.label || edge.kind;
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    const { head, badge } = buildHeader(
      edge.name,
      `${specLabel} \xB7 ${source?.name || "?"} \u2192 ${target?.name || "?"}`,
      specLabel
    );
    const form = el("form");
    form.dataset.role = "form";
    form.autocomplete = "off";
    const identity = section("\u8EAB\u4EFD");
    const nameField = div("field");
    nameField.appendChild(numberedField("\u540D\u79F0", "\u6700\u591A 32 \u5B57\u7B26"));
    const nameInput = el("input");
    nameInput.type = "text";
    nameInput.maxLength = 32;
    nameInput.value = edge.name;
    nameInput.dataset.role = "name";
    nameField.appendChild(nameInput);
    identity.appendChild(nameField);
    const kindField = div("field");
    kindField.appendChild(numberedField("\u4F20\u9012\u65B9\u5F0F", state.mode === "circuit" ? "\u7535\u8DEF\u5143\u4EF6" : "\u8FDE\u63A5\u51FD\u6570"));
    const kindSelect = buildKindSelect("edge", edge.kind, edge.id);
    kindField.appendChild(kindSelect);
    const desc2 = div("help", spec?.description || "");
    kindField.appendChild(desc2);
    identity.appendChild(kindField);
    const endpoints = div("kv");
    const sourceRow = div("kv-row");
    sourceRow.append(el("span", null, "\u8D77\u70B9"), el("b", null, source?.name || edge.source));
    const targetRow = div("kv-row");
    targetRow.append(el("span", null, "\u7EC8\u70B9"), el("b", null, target?.name || edge.target));
    endpoints.append(sourceRow, targetRow);
    identity.appendChild(endpoints);
    if (state.mode !== "circuit") {
      const delayRow = div("switch-row");
      delayRow.appendChild(el("span", null, "\u5355\u6B65\u5EF6\u8FDF z\u207B\xB9\uFF08\u5207\u65AD\u4EE3\u6570\u73AF\uFF09"));
      const delayInput = el("input");
      delayInput.type = "checkbox";
      delayInput.checked = Boolean(edge.delay);
      delayInput.dataset.role = "delay";
      delayRow.appendChild(delayInput);
      identity.appendChild(delayRow);
    }
    const enabledRow = div("switch-row");
    enabledRow.appendChild(el("span", null, "\u542F\u7528\u8BE5\u8FDE\u63A5"));
    const enabledInput = el("input");
    enabledInput.type = "checkbox";
    enabledInput.checked = Boolean(edge.enabled);
    enabledInput.dataset.role = "enabled";
    enabledRow.appendChild(enabledInput);
    identity.appendChild(enabledRow);
    const geometry = section("\u51E0\u4F55", "\u8DEF\u7531 / \u951A\u70B9\u7ACB\u5373\u751F\u6548\uFF1B\u624B\u52A8\u8DEF\u7531\u53EF\u7528 Alt+\u70B9\u51FB\u8FDE\u7EBF\u6DFB\u52A0\u62D0\u70B9");
    const routeField = div("field");
    routeField.appendChild(numberedField("\u8DEF\u7531", "\u81EA\u52A8 / \u76F4\u7EBF / \u6B63\u4EA4 / \u624B\u52A8"));
    const routeSelect = el("select");
    for (const [value, label] of [
      ["auto", "\u81EA\u52A8\uFF08\u66F2\u7EBF\uFF09"],
      ["straight", "\u76F4\u7EBF"],
      ["orthogonal", "\u6B63\u4EA4\u6298\u7EBF"],
      ["manual", "\u624B\u52A8\u62D0\u70B9"]
    ]) {
      const option = el("option", null, label);
      option.value = value;
      if ((edge.route || "auto") === value) option.selected = true;
      routeSelect.appendChild(option);
    }
    routeSelect.addEventListener("change", () => {
      void patchEdgeGeometry(edge.id, { route: routeSelect.value });
    });
    routeField.appendChild(routeSelect);
    geometry.appendChild(routeField);
    const anchorsRow = div("inline-fields");
    for (const [key, label] of [["source", "\u8D77\u70B9\u951A\u70B9"], ["target", "\u7EC8\u70B9\u951A\u70B9"]]) {
      const wrap = div("field");
      wrap.appendChild(numberedField(label, ""));
      const select = el("select");
      for (const [value, text] of [
        ["auto", "\u81EA\u52A8"],
        ["left", "\u5DE6"],
        ["right", "\u53F3"],
        ["top", "\u4E0A"],
        ["bottom", "\u4E0B"]
      ]) {
        const option = el("option", null, text);
        option.value = value;
        if ((edge.anchors?.[key] || "auto") === value) option.selected = true;
        select.appendChild(option);
      }
      select.addEventListener("change", () => {
        void patchEdgeGeometry(edge.id, { anchors: { ...edge.anchors || {}, [key]: select.value } });
      });
      wrap.appendChild(select);
      anchorsRow.appendChild(wrap);
    }
    geometry.appendChild(anchorsRow);
    if (edge.route === "manual") {
      const clear = button("\u6E05\u7A7A\u62D0\u70B9", "btn tiny", () => void patchEdgeGeometry(edge.id, { waypoints: [] }));
      geometry.appendChild(clear);
    }
    const params = buildParamFields(spec, edge.params || {});
    let portSection = null;
    if (state.mode !== "circuit") {
      const sourceSpec = getNodeSpec(source?.kind);
      const targetSpec = getNodeSpec(target?.kind);
      const outputs = Array.isArray(sourceSpec?.outputs) ? sourceSpec.outputs : [];
      const inputs = Array.isArray(targetSpec?.inputs) ? targetSpec.inputs : [];
      if (outputs.length || inputs.length) {
        const grid = div("params-grid");
        const makePort = (role, options, current) => {
          const wrapper = div("field");
          wrapper.appendChild(numberedField(
            role === "source" ? "\u6E90\u7AEF\u53E3" : "\u76EE\u6807\u7AEF\u53E3",
            role === "source" ? "\u53D6\u6E90\u8282\u70B9\u7684\u54EA\u4E2A\u8F93\u51FA\u5B57\u6BB5" : "\u5199\u5165\u76EE\u6807\u8282\u70B9\u7684\u54EA\u4E2A\u8F93\u5165\u7AEF\u53E3"
          ));
          const select = el("select");
          select.dataset.role = role === "source" ? "source-port" : "target-port";
          const empty = el("option", null, "\uFF08\u4E0D\u7ED1\u5B9A\uFF0C\u517C\u5BB9\u65E7\u8BED\u4E49\uFF09");
          empty.value = "";
          select.appendChild(empty);
          const names = options.map((item) => typeof item === "string" ? item : item.name);
          if (current && !names.includes(current)) names.push(current);
          for (const name of names) {
            const option = el("option", null, name);
            option.value = name;
            if (current === name) option.selected = true;
            select.appendChild(option);
          }
          select.addEventListener("change", markDirty);
          wrapper.appendChild(select);
          return wrapper;
        };
        grid.append(
          makePort("source", outputs, edge.source_port || ""),
          makePort("target", inputs, edge.target_port || "")
        );
        portSection = section("\u7AEF\u53E3\u7ED1\u5B9A", "R20/Q8\uFF1A\u8FB9\u663E\u5F0F\u7ED1\u5B9A\u6E90\u8F93\u51FA\u5B57\u6BB5\u4E0E\u76EE\u6807\u8F93\u5165\u7AEF\u53E3\uFF1B\u4E0D\u7ED1\u5B9A\u5219\u6309\u65E7\u8BED\u4E49\uFF08\u8FDE\u63A5\u540D\u805A\u5408/input_key\uFF09", grid);
      }
    }
    const live = div("kv");
    const output = edgeDisplayData(edge);
    const fields = Object.keys(output).filter((key) => typeof output[key] === "number");
    for (const key of fields.slice(0, 8)) {
      const row = div("kv-row");
      row.appendChild(el("span", null, key));
      const value = el("b", null, fmt(output[key], 5));
      value.dataset.liveEdgeValue = "1";
      value.dataset.edge = edge.id;
      value.dataset.field = key;
      row.appendChild(value);
      live.appendChild(row);
    }
    if (!fields.length) live.appendChild(div("help", "\u8FD0\u884C\u540E\u663E\u793A\u8FDE\u63A5\u8F93\u51FA\u3002"));
    const statePre = el("pre", "json");
    statePre.textContent = JSON.stringify(edge.state || {}, null, 2);
    statePre.dataset.liveState = "1";
    const actions = div("insp-actions");
    const save = button("\u5E94\u7528\u4FEE\u6539", "btn primary", null);
    save.type = "submit";
    save.dataset.role = "save";
    const remove = button("\u5220\u9664\u8FDE\u63A5", "btn danger", () => void deleteEdge(edge.id));
    actions.append(save, remove);
    form.append(
      identity,
      geometry,
      ...portSection ? [portSection] : [],
      section("\u53C2\u6570", spec?.notes || "", params),
      section("\u5B9E\u65F6\u8F93\u51FA", "\u968F\u5E27\u66F4\u65B0", live),
      section("\u8FDE\u63A5\u72B6\u6001", "\u53EA\u8BFB", statePre),
      actions
    );
    kindSelect.addEventListener("change", () => {
      const nextSpec = getEdgeSpec(kindSelect.value);
      const nextParams = buildParamFields(nextSpec, specDefaults(nextSpec));
      const current = form.querySelector('[data-role="params"]');
      if (current) current.replaceWith(nextParams);
      desc2.textContent = nextSpec?.description || "";
      badge.textContent = nextSpec?.label || kindSelect.value;
      markDirty();
    });
    form.addEventListener("input", markDirty);
    form.addEventListener("change", markDirty);
    form.addEventListener("submit", (event) => {
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
      if (!options.quiet) toast("\u6B63\u5728\u5904\u7406\u5176\u4ED6\u8BF7\u6C42\uFF0C\u8BF7\u7A0D\u5019\u2026", "info", 1500);
      return false;
    }
    state.busy = true;
    try {
      const name = form.querySelector('[data-role="name"]').value.trim();
      const kind = form.querySelector('[data-role="kind"]').value;
      const params = collectParamValues(form.querySelector('[data-role="params"]'));
      if (state.selection.type === "node") {
        const node = selectedNode();
        if (!node) return false;
        const payload2 = { name, kind, params };
        if (node.kind === "device") params.element = String(node.params?.element || "");
        if (state.mode !== "circuit") {
          const dataHost = form.querySelector('[data-role="data"]');
          if (dataHost) payload2.data = collectData(dataHost);
        }
        const response2 = await jsonRequest(`/api/nodes/${encodeURIComponent(node.id)}`, "PATCH", payload2);
        const index2 = state.scene.nodes.findIndex((item) => item.id === node.id);
        if (index2 >= 0) state.scene.nodes[index2] = response2.node;
        if (response2.sim) state.sim = response2.sim;
        state.scene.revision = response2.revision ?? state.scene.revision;
        state.inspectorDirty = false;
        syncUI();
        updateScenePanelValues();
        renderInspector();
        updateSignalKeyCache();
        if (!options.quiet) toast("\u8282\u70B9\u5DF2\u4FDD\u5B58", "ok", 1800);
        void refreshState(true);
        return true;
      }
      const edge = selectedEdge();
      if (!edge) return false;
      const payload = { name, kind, params };
      if (state.mode !== "circuit") payload.delay = Boolean(form.querySelector('[data-role="delay"]')?.checked);
      else payload.delay = false;
      const sourcePortBox = form.querySelector('[data-role="source-port"]');
      const targetPortBox = form.querySelector('[data-role="target-port"]');
      if (sourcePortBox) payload.source_port = sourcePortBox.value;
      if (targetPortBox) payload.target_port = targetPortBox.value;
      const waypointBox = form.querySelector('[data-role="waypoints"]');
      if (waypointBox) {
        payload.waypoints = [...waypointBox.querySelectorAll('[data-role="waypoint-row"]')].map((row) => ({
          x: Number(row.querySelector('[data-role="waypoint-x"]').value) || 0,
          y: Number(row.querySelector('[data-role="waypoint-y"]').value) || 0
        }));
        payload.route = payload.waypoints.length ? "manual" : "auto";
      }
      const enabledBox = form.querySelector('[data-role="enabled"]');
      if (enabledBox) payload.enabled = Boolean(enabledBox.checked);
      const response = await jsonRequest(`/api/edges/${encodeURIComponent(edge.id)}`, "PATCH", payload);
      const index = state.scene.edges.findIndex((item) => item.id === edge.id);
      if (index >= 0) state.scene.edges[index] = response.edge;
      if (response.sim) state.sim = response.sim;
      state.scene.revision = response.revision ?? state.scene.revision;
      state.inspectorDirty = false;
      syncUI();
      updateScenePanelValues();
      renderInspector();
      updateSignalKeyCache();
      if (!options.quiet) toast("\u8FDE\u63A5\u5DF2\u4FDD\u5B58", "ok", 1800);
      void refreshState(true);
      return true;
    } catch (error) {
      const message = error?.message || String(error);
      toast(message, "error", 7e3);
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
      for (const value of $$("[data-live-node-value]", ui.inspector)) {
        if (value.dataset.node !== selected.id) continue;
        value.textContent = formatAny(data[value.dataset.field]);
      }
      const inputs = ui.inspector.querySelector("[data-live-inputs]");
      if (inputs) inputs.textContent = String(Object.keys(selected.inputs || {}).length);
      const statePre = ui.inspector.querySelector("[data-live-state]");
      if (statePre) {
        const text = JSON.stringify(selected.state || {}, null, 2);
        if (statePre.textContent !== text) statePre.textContent = text;
      }
      return;
    }
    const edge = selectedEdge();
    if (edge) {
      const data = edgeDisplayData(edge);
      for (const value of $$("[data-live-edge-value]", ui.inspector)) {
        if (value.dataset.edge !== edge.id) continue;
        value.textContent = formatAny(data[value.dataset.field]);
      }
      const statePre = ui.inspector.querySelector("[data-live-state]");
      if (statePre) {
        const text = JSON.stringify(edge.state || {}, null, 2);
        if (statePre.textContent !== text) statePre.textContent = text;
      }
    }
  }
  function specListForMode() {
    if (!state.catalog) return [];
    return state.mode === "circuit" ? { nodes: state.catalog.circuit_nodes || [], edges: state.catalog.elements || [] } : { nodes: state.catalog.computes || [], edges: state.catalog.methods || [] };
  }
  function specTarget() {
    if (state.selection.type === "node") {
      const node = selectedNode();
      if (!node) return null;
      return { role: "node", spec: getNodeSpec(node.kind), kind: node.kind, name: node.name };
    }
    if (state.selection.type === "edge") {
      const edge = selectedEdge();
      if (!edge) return null;
      return { role: "edge", spec: getEdgeSpec(edge.kind), kind: edge.kind, name: edge.name };
    }
    return null;
  }
  function specByKind(role, kind) {
    const lists = specListForMode();
    const list = role === "edge" ? lists.edges : lists.nodes;
    return (list || []).find((spec) => spec.kind === kind) || null;
  }
  function specBadges(spec) {
    const row = div("spec-badges");
    row.appendChild(el("span", "badge", String(spec.mode || state.mode)));
    row.appendChild(el("span", spec.builtin ? "badge gray" : "badge violet", spec.builtin ? "\u5185\u7F6E" : "\u6269\u5C55"));
    if (spec.editable) row.appendChild(el("span", "badge green", "\u53EF\u81EA\u5B9A\u4E49"));
    return row;
  }
  function paramRangeText(param) {
    const parts = [];
    if (param.min !== void 0 && param.min !== null) parts.push(`\u2265 ${param.min}`);
    if (param.max !== void 0 && param.max !== null) parts.push(`\u2264 ${param.max}`);
    if (param.positive) parts.push("> 0");
    if (param.step !== void 0 && param.step !== null) parts.push(`\u6B65\u957F ${param.step}`);
    return parts.join(" \xB7 ");
  }
  function paramTable(spec) {
    const wrap = div("spec-table-wrap");
    const table = el("table", "spec-table");
    const head = el("tr");
    for (const title of ["\u53C2\u6570", "\u7C7B\u578B", "\u9ED8\u8BA4", "\u5355\u4F4D", "\u8303\u56F4", "\u5FC5\u586B", "\u8BF4\u660E"]) {
      head.appendChild(el("th", null, title));
    }
    table.appendChild(head);
    const params = Array.isArray(spec.params) ? spec.params : [];
    if (!params.length) {
      const row = el("tr");
      const cell = el("td", "spec-empty", "\u8BE5\u89C4\u683C\u6CA1\u6709\u53EF\u8C03\u53C2\u6570");
      cell.colSpan = 7;
      row.appendChild(cell);
      table.appendChild(row);
    }
    for (const param of params) {
      const row = el("tr");
      const nameCell = el("td");
      nameCell.appendChild(el("code", null, param.label || param.key));
      nameCell.appendChild(el("span", "spec-key", param.key));
      row.appendChild(nameCell);
      row.appendChild(el("td", null, param.type));
      const def = param.default;
      row.appendChild(
        el("td", null, typeof def === "object" && def !== null ? JSON.stringify(def) : String(def ?? ""))
      );
      row.appendChild(el("td", null, param.unit || "\u2014"));
      row.appendChild(el("td", null, paramRangeText(param) || "\u2014"));
      row.appendChild(el("td", null, param.required ? "\u662F" : ""));
      const helpCell = el("td", "spec-help", param.help || "");
      attachParamHelp(helpCell, param, spec, state.specRole || "node");
      row.appendChild(helpCell);
      table.appendChild(row);
    }
    wrap.appendChild(table);
    return wrap;
  }
  function sourceBlock(source) {
    const text = String(source || "");
    if (!text.trim()) {
      return div("help spec-no-source", "\u6E90\u7801\u4E0D\u53EF\u7528\uFF1A\u8BE5\u5B9E\u73B0\u6CA1\u6709\u53EF\u76F4\u63A5\u8BFB\u53D6\u7684 Python \u6E90\u7801\uFF08\u53EF\u80FD\u7531\u5185\u7F6E C \u6269\u5C55\u6216\u52A8\u6001\u751F\u6210\uFF09\u3002");
    }
    const pre = el("pre", "spec-source");
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const row = div("src-line");
      row.appendChild(el("span", "src-ln", String(index + 1)));
      row.appendChild(el("span", "src-code", lines[index] || " "));
      pre.appendChild(row);
    }
    return pre;
  }
  function renderSpecPane() {
    if (!ui.specPane) return;
    const fnRole = state.fnRole || "node";
    const rawTarget = specTarget();
    const target = rawTarget && rawTarget.role === fnRole ? rawTarget : null;
    const lists = specListForMode();
    const roleList = fnRole === "edge" ? lists.edges : lists.nodes;
    let spec = target?.spec || null;
    if (!spec) {
      spec = specByKind(fnRole, state.specKind) || roleList[0] || null;
    }
    const host = div("spec-host");
    const intro = div("help");
    intro.textContent = target ? `\u5F53\u524D\u9009\u4E2D${target.role === "node" ? "\u8282\u70B9" : "\u8FDE\u63A5"}\u300C${target.name}\u300D\uFF0C\u4E0B\u9762\u5C55\u793A\u5B83\u5B9E\u9645\u4F7F\u7528\u7684\u8BA1\u7B97\u51FD\u6570\u4E0E\u53C2\u6570\u5B9A\u4E49\u3002` : fnRole === "node" ? "\u8282\u70B9\u51FD\u6570\uFF1A\u5F53\u524D\u6A21\u5F0F\u4E0B\u6240\u6709\u8282\u70B9\u7C7B\u578B\u7684\u771F\u5B9E\u516C\u5F0F\u3001\u6E90\u7801\u4E0E\u53C2\u6570\u3002" : "\u8FDE\u63A5\u51FD\u6570\uFF1A\u5F53\u524D\u6A21\u5F0F\u4E0B\u6240\u6709\u8FDE\u63A5\u7C7B\u578B\u7684\u771F\u5B9E\u516C\u5F0F\u3001\u6E90\u7801\u4E0E\u53C2\u6570\u3002";
    host.appendChild(intro);
    const picker = div("spec-picker");
    const select = el("select");
    select.dataset.role = "spec-kind";
    const group = el("optgroup");
    group.label = fnRole === "edge" ? "\u8FDE\u63A5\u4F20\u9012" : "\u8282\u70B9\u8BA1\u7B97";
    for (const item of roleList || []) {
      const option = el("option", null, `${item.label} \xB7 ${item.kind}`);
      option.value = `${fnRole}:${item.kind}`;
      if (item.kind === spec?.kind) option.selected = true;
      group.appendChild(option);
    }
    select.appendChild(group);
    select.addEventListener("change", () => {
      const [role, kind] = String(select.value).split(":");
      state.specRole = role === "edge" ? "edge" : "node";
      state.specKind = kind || "";
      renderSpecPane();
    });
    picker.appendChild(select);
    host.appendChild(picker);
    if (!spec) {
      host.appendChild(div("help", "\u5F53\u524D\u6A21\u5F0F\u8FD8\u6CA1\u6709\u53EF\u7528\u7684\u89C4\u683C\u5B9A\u4E49\u3002"));
      ui.specPane.replaceChildren(host);
      return;
    }
    state.specRole = fnRole;
    state.specKind = spec.kind;
    const head = div("insp-head");
    const title = div("insp-title");
    title.appendChild(el("h2", null, spec.label || spec.kind));
    title.appendChild(el("p", null, `${spec.kind} \xB7 ${spec.description || "\u65E0\u8BF4\u660E"}`));
    head.append(title, specBadges(spec));
    host.appendChild(head);
    const formulaText = String(spec.formula || "").trim() || "\uFF08\u8BE5\u89C4\u683C\u6CA1\u6709\u767B\u8BB0\u516C\u5F0F\uFF09";
    const formulaPre = el("pre", "spec-formula", formulaText);
    host.appendChild(section("\u516C\u5F0F", "\u6CE8\u518C\u8868\u4E2D\u767B\u8BB0\u7684\u8BA1\u7B97\u5F0F", formulaPre));
    host.appendChild(section("\u53C2\u6570", `${(spec.params || []).length} \u4E2A\u53EF\u8C03\u9879`, paramTable(spec)));
    if (spec.outputs && spec.outputs.length) {
      host.appendChild(section("\u8F93\u51FA\u5B57\u6BB5", spec.outputs.join(" / ")));
    }
    const sourceHead = div("spec-source-meta");
    sourceHead.appendChild(el("code", null, spec.source_path || "\u6E90\u7801\u8DEF\u5F84\u4E0D\u53EF\u7528"));
    if (spec.source) {
      const lineCount = String(spec.source).split("\n").length;
      sourceHead.appendChild(el("span", "spec-key", `${lineCount} \u884C`));
    }
    host.appendChild(section("\u6E90\u7801", "inspect \u8BFB\u53D6\u7684\u771F\u5B9E\u5B9E\u73B0", sourceHead, sourceBlock(spec.source)));
    if (!spec.builtin) {
      const note = div("help", "\u8FD9\u662F\u7528\u6237\u6269\u5C55\u63D0\u4F9B\u7684\u5B9E\u73B0\uFF1A\u4EE3\u7801\u5728\u670D\u52A1\u7AEF\u672C\u8FDB\u7A0B\u6267\u884C\uFF0C\u4E0D\u662F\u6C99\u7BB1\u3002");
      note.style.marginTop = "10px";
      host.appendChild(note);
    }
    ui.specPane.replaceChildren(host);
  }
  function scheduleSpecRender() {
    const tab = activeTab();
    if (tab === "spec" || tab === "node-fn" || tab === "edge-fn") renderSpecPane();
  }
  function applyExtensionResult(box) {
    const saved = state.ext.result;
    if (!box || !saved) return;
    box.className = `ext-result ${saved.kind}`;
    box.replaceChildren();
    box.appendChild(div("ext-result-main", saved.message || ""));
    if (saved.detail) {
      const pre = el("pre", "ext-result-detail");
      pre.textContent = typeof saved.detail === "string" ? saved.detail : JSON.stringify(saved.detail, null, 2);
      box.appendChild(pre);
    }
  }
  function showExtensionResult(kind, message, detail) {
    state.ext.result = { kind, message: message || "", detail };
    const box = ui.extPane?.querySelector('[data-role="ext-result"]');
    if (!box) {
      if (message) toast(message, kind === "error" ? "error" : kind === "ok" ? "ok" : "info", 6e3);
      return;
    }
    applyExtensionResult(box);
  }
  async function refreshExtensions() {
    try {
      const payload = await api("/api/extensions");
      state.ext.list = Array.isArray(payload.extensions) ? payload.extensions : [];
      state.ext.scan = Array.isArray(payload.scan?.files) ? payload.scan.files : [];
      state.ext.notice = String(payload.notice || "");
      renderExtensionPanel();
      return payload;
    } catch (error) {
      showExtensionResult("error", `\u8BFB\u53D6\u6269\u5C55\u5217\u8868\u5931\u8D25\uFF1A${error.message}`);
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
      const result = await api("/api/extensions/validate", {
        method: "POST",
        body: JSON.stringify({ code })
      });
      const declared = Array.isArray(result.declared) ? result.declared : [];
      showExtensionResult(
        "ok",
        declared.length ? `\u6821\u9A8C\u901A\u8FC7\uFF1A\u58F0\u660E\u4E86 ${declared.length} \u4E2A kind\uFF08${declared.map((item) => item.kind || item.function).join("\u3001")}\uFF09` : "\u6821\u9A8C\u901A\u8FC7\uFF1A\u6CA1\u6709\u68C0\u6D4B\u5230 node/method \u58F0\u660E\uFF0C\u542F\u7528\u540E\u4E0D\u4F1A\u6CE8\u518C\u4EFB\u4F55\u4E1C\u897F\u3002",
        declared
      );
    } catch (error) {
      showExtensionResult("error", error.message);
    }
  }
  async function activateExtension() {
    const code = extensionEditorCode();
    const filenameInput = ui.extPane?.querySelector('[data-role="ext-filename"]');
    const filename = filenameInput ? filenameInput.value.trim() : "";
    const confirmed = await confirmModal(
      "\u542F\u7528\u8FD9\u6BB5 Python \u6269\u5C55\uFF1F",
      "\u6269\u5C55\u4F1A\u5728\u540E\u7AEF\u672C\u8FDB\u7A0B\u4EE5\u5B8C\u6574 Python \u6743\u9650\u6267\u884C\uFF0C\u8FD9\u4E0D\u662F\u6C99\u7BB1\u3002\u53EA\u542F\u7528\u4F60\u81EA\u5DF1\u5199\u7684\u6216\u6765\u6E90\u53EF\u4FE1\u7684\u4EE3\u7801\u3002",
      "\u542F\u7528",
      true
    );
    if (!confirmed) return;
    try {
      const result = await api("/api/extensions/activate", {
        method: "POST",
        body: JSON.stringify({ code, filename, persist: true })
      });
      if (result?.catalog) state.catalog = result.catalog;
      showExtensionResult("ok", `\u5DF2\u542F\u7528\uFF1A${(result.kinds || []).join("\u3001") || "\uFF08\u65E0 kind\uFF09"}`, result.kinds || []);
      toast("\u6269\u5C55\u5DF2\u542F\u7528", "ok", 3e3);
      await refreshExtensions();
      renderSpecPane();
      if (state.selection.type) renderInspector();
      return result;
    } catch (error) {
      showExtensionResult("error", `\u542F\u7528\u5931\u8D25\uFF1A${error.message}`);
      return null;
    }
  }
  async function deactivateExtension(kind) {
    const confirmed = await confirmModal(
      `\u505C\u7528\u6269\u5C55 ${kind}\uFF1F`,
      "\u505C\u7528\u540E\u8BE5 kind \u4F1A\u4ECE\u6CE8\u518C\u8868\u79FB\u9664\uFF1B\u5982\u679C\u5F53\u524D\u573A\u666F\u91CC\u8FD8\u6709\u8282\u70B9/\u8FDE\u63A5\u5728\u7528\u5B83\uFF0C\u9700\u8981\u5148\u5220\u9664\u3002",
      "\u505C\u7528",
      true
    );
    if (!confirmed) return;
    try {
      const result = await api("/api/extensions/deactivate", {
        method: "POST",
        body: JSON.stringify({ kind, remove_file: false })
      });
      if (result?.catalog) state.catalog = result.catalog;
      toast(`\u5DF2\u505C\u7528 ${kind}`, "ok", 3e3);
      await refreshExtensions();
      renderSpecPane();
      if (state.selection.type) renderInspector();
    } catch (error) {
      showExtensionResult("error", `\u505C\u7528\u5931\u8D25\uFF1A${error.message}`);
    }
  }
  function loadExtensionIntoEditor(kind, code) {
    state.ext.code = String(code || "");
    const area = ui.extPane?.querySelector('[data-role="ext-code"]');
    if (area) area.value = state.ext.code;
    const nameInput = ui.extPane?.querySelector('[data-role="ext-filename"]');
    if (nameInput) nameInput.value = String(kind || "").replace(/[^\w.-]+/g, "_");
    showExtensionResult("info", `\u5DF2\u8F7D\u5165 ${kind} \u7684\u6E90\u7801\u5230\u7F16\u8F91\u5668`);
  }
  const EXTENSION_TEMPLATE = [
    "@node(",
    '    kind="user.rate_limiter",',
    '    label="\u901F\u7387\u9650\u5236",',
    '    group="\u81EA\u5B9A\u4E49",',
    '    description="\u9650\u5236\u6BCF\u6B65\u8F93\u51FA\u53D8\u5316\u91CF\uFF0C\u6309\u6B65\u957F\u903C\u8FD1\u8F93\u5165",',
    '    outputs=("y",),',
    '    formula="y[k] = y[k-1] + clamp(\u03A3u \u2212 y[k-1], \xB1rate)",',
    '    params=(Param("rate", "\u6BCF\u6B65\u6700\u5927\u53D8\u5316", "float", 1.0, unit="V", min=0.0),),',
    ")",
    "# \u88AB\u88C5\u9970\u51FD\u6570\u672C\u8EAB\u5C31\u662F handler\uFF1A\u76F4\u63A5\u6536 ComputeContext\uFF0C\u53C2\u6570\u5728 ctx.params \u91CC\u3002",
    "def rate_limiter(ctx):",
    '    rate = float(ctx.params.get("rate", 1.0))',
    "    total = 0.0",
    "    for payload in ctx.inputs.values():",
    '        total += float(payload.get("voltage", 0.0))',
    '    previous = float(ctx.data.get("y", 0.0))',
    "    delta = total - previous",
    "    if delta > rate:",
    "        delta = rate",
    "    elif delta < -rate:",
    "        delta = -rate",
    '    return {"y": previous + delta}',
    ""
  ].join("\n");
  function renderExtensionPanel() {
    if (!ui.extPane) return;
    const host = div("ext-host");
    const notice = div("help ext-notice");
    notice.textContent = state.ext.notice || "\u6269\u5C55\u4EE3\u7801\u5728\u670D\u52A1\u7AEF\u672C\u8FDB\u7A0B\u6267\u884C\uFF0C\u4E0D\u662F\u6C99\u7BB1\u3002\u53EA\u542F\u7528\u6765\u6E90\u53EF\u4FE1\u7684\u4EE3\u7801\uFF1B\u9879\u76EE\u5185\u5D4C\u4EE3\u7801\u9ED8\u8BA4\u4E0D\u6267\u884C\u3002";
    host.appendChild(notice);
    const toolbar = div("ext-toolbar");
    toolbar.append(
      button("\u65B0\u5EFA\u6A21\u677F", "btn tiny", () => {
        state.ext.code = EXTENSION_TEMPLATE;
        const area2 = ui.extPane.querySelector('[data-role="ext-code"]');
        if (area2) area2.value = state.ext.code;
        showExtensionResult("info", "\u5DF2\u586B\u5165\u6700\u5C0F\u53EF\u8FD0\u884C\u6A21\u677F\uFF0C\u6539\u5B8C\u70B9\u300C\u6821\u9A8C\u300D\u518D\u300C\u542F\u7528\u300D\u3002");
      }),
      button("\u6821\u9A8C", "btn tiny", () => void validateExtension()),
      button("\u542F\u7528", "btn tiny primary", () => void activateExtension()),
      button("\u5237\u65B0", "btn tiny", () => void refreshExtensions())
    );
    host.appendChild(toolbar);
    const filenameField = div("field");
    const filenameLabel = el("label");
    filenameLabel.appendChild(el("span", null, "\u6587\u4EF6\u540D\uFF08\u53EF\u9009\uFF09"));
    filenameLabel.appendChild(el("em", null, "\u6301\u4E45\u5316\u5230 extensions/nodes|methods"));
    const filename = el("input");
    filename.type = "text";
    filename.placeholder = "user_rate_limiter.py";
    filename.dataset.role = "ext-filename";
    filenameField.append(filenameLabel, filename);
    host.appendChild(filenameField);
    const area = el("textarea", "ext-code");
    area.dataset.role = "ext-code";
    area.spellcheck = false;
    area.rows = 16;
    area.value = state.ext.code || "";
    area.addEventListener("input", () => {
      state.ext.code = area.value;
    });
    host.appendChild(area);
    const result = div("ext-result hidden");
    result.dataset.role = "ext-result";
    host.appendChild(result);
    applyExtensionResult(result);
    if (state.ext.list === null) {
      host.appendChild(div("help", "\u6B63\u5728\u8BFB\u53D6\u6269\u5C55\u5217\u8868\u2026"));
      ui.extPane.replaceChildren(host);
      void refreshExtensions();
      return;
    }
    const listBlock = div("ext-list");
    listBlock.dataset.role = "ext-list";
    if (!state.ext.list.length) {
      listBlock.appendChild(div("help", "\u5F53\u524D\u6CA1\u6709\u5DF2\u542F\u7528\u7684\u7528\u6237\u6269\u5C55\u3002"));
    }
    for (const item of state.ext.list) {
      const card = div("ext-item");
      const top = div("ext-item-head");
      top.appendChild(el("b", null, item.label || item.kind));
      top.appendChild(el("span", "badge violet", item.type === "method" ? "\u8FDE\u63A5" : "\u8282\u70B9"));
      top.appendChild(el("code", "ext-kind", item.kind));
      card.appendChild(top);
      const meta = div("help");
      meta.textContent = [
        item.filename ? `\u6587\u4EF6 ${item.filename}` : "",
        item.sha256 ? `sha256 ${String(item.sha256).slice(0, 12)}` : "",
        Array.isArray(item.params) && item.params.length ? `${item.params.length} \u4E2A\u53C2\u6570` : ""
      ].filter(Boolean).join(" \xB7 ");
      card.appendChild(meta);
      const actions = div("ext-item-actions");
      actions.appendChild(
        button("\u8F7D\u5165\u7F16\u8F91\u5668", "btn tiny", () => loadExtensionIntoEditor(item.kind, item.source))
      );
      actions.appendChild(button("\u505C\u7528", "btn tiny danger", () => void deactivateExtension(item.kind)));
      card.appendChild(actions);
      listBlock.appendChild(card);
    }
    host.appendChild(section("\u5DF2\u542F\u7528\u7684\u6269\u5C55", `${state.ext.list.length} \u4E2A`, listBlock));
    const scanned = Array.isArray(state.ext.scan) ? state.ext.scan : [];
    if (scanned.length) {
      const scanBlock = div("ext-list");
      for (const item of scanned) {
        const card = div("ext-item");
        const top = div("ext-item-head");
        top.appendChild(el("b", null, item.filename || item.kind || "\u672A\u547D\u540D"));
        card.appendChild(top);
        if (item.error) {
          card.appendChild(div("help", `\u626B\u63CF\u5931\u8D25\uFF1A${item.error}`));
        } else {
          const actions = div("ext-item-actions");
          actions.appendChild(
            button("\u8F7D\u5165\u7F16\u8F91\u5668", "btn tiny", () => loadExtensionIntoEditor(item.filename || "", item.code || ""))
          );
          card.appendChild(actions);
        }
        scanBlock.appendChild(card);
      }
      host.appendChild(section("\u6269\u5C55\u76EE\u5F55\u4E2D\u672A\u542F\u7528\u7684\u6587\u4EF6", `${scanned.length} \u4E2A`, scanBlock));
    }
    ui.extPane.replaceChildren(host);
  }
  async function alignSelection(mode) {
    const targets = [...multiSelection().nodes].map((id) => nodeById(id)).filter(Boolean);
    if (targets.length < 2) {
      toast("\u81F3\u5C11\u9009\u4E2D\u4E24\u4E2A\u8282\u70B9/\u5668\u4EF6\u624D\u80FD\u5BF9\u9F50", "info", 2400);
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
      if (mode === "left") x = minX;
      else if (mode === "right") x = maxX;
      else if (mode === "centerX") x = (minX + maxX) / 2;
      else if (mode === "top") y = minY;
      else if (mode === "bottom") y = maxY;
      else if (mode === "centerY") y = (minY + maxY) / 2;
      return { id: node.id, position: { x: Math.round(x * 1e3) / 1e3, y: Math.round(y * 1e3) / 1e3 } };
    });
    try {
      await jsonRequest("/api/positions", "POST", { positions });
      await refreshState(true);
      toast(`\u5DF2\u5BF9\u9F50 ${targets.length} \u4E2A\u8282\u70B9\uFF08${mode}\uFF09`, "ok", 2200);
    } catch (error) {
      toast(`\u5BF9\u9F50\u5931\u8D25\uFF1A${error.message}`, "error", 4e3);
    }
  }
  async function distributeSelection(axis) {
    const targets = [...multiSelection().nodes].map((id) => nodeById(id)).filter(Boolean);
    if (targets.length < 3) {
      toast("\u7B49\u8DDD\u5206\u5E03\u81F3\u5C11\u9700\u8981\u4E09\u4E2A\u8282\u70B9/\u5668\u4EF6", "info", 2400);
      return;
    }
    const key = axis === "y" ? "y" : "x";
    const sorted = [...targets].sort((a, b) => a.position[key] - b.position[key]);
    const first = sorted[0].position[key];
    const last = sorted[sorted.length - 1].position[key];
    const step = (last - first) / (sorted.length - 1);
    const positions = sorted.map((node, index) => {
      const value = index === 0 || index === sorted.length - 1 ? node.position[key] : first + step * index;
      const x = key === "x" ? value : node.position.x;
      const y = key === "y" ? value : node.position.y;
      return { id: node.id, position: { x: Math.round(x * 1e3) / 1e3, y: Math.round(y * 1e3) / 1e3 } };
    });
    try {
      await jsonRequest("/api/positions", "POST", { positions });
      await refreshState(true);
      toast(`\u5DF2\u7B49\u8DDD\u5206\u5E03 ${targets.length} \u4E2A\u8282\u70B9\uFF08${axis === "y" ? "\u7EB5\u5411" : "\u6A2A\u5411"}\uFF09`, "ok", 2200);
    } catch (error) {
      toast(`\u5206\u5E03\u5931\u8D25\uFF1A${error.message}`, "error", 4e3);
    }
  }
  function selectWireNetwork(edge) {
    const ends = /* @__PURE__ */ new Set([edge.source, edge.target]);
    const wires = (state.scene?.edges || []).filter(
      (item) => item.kind === "wire" && (ends.has(item.source) || ends.has(item.target))
    );
    state.multi.nodes = new Set(ends);
    state.multi.edges = new Set(wires.map((item) => item.id));
    state.selection = { type: null, id: null };
    requestDraw();
    toast(`\u5DF2\u9009\u4E2D ${wires.length} \u6761\u5BFC\u7EBF / ${ends.size} \u4E2A\u7AEF\u70B9`, "info", 2200);
  }
  async function addWireWaypoint(edge) {
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    if (!source || !target) return;
    const x = (source.position.x + target.position.x) / 2;
    const y = (source.position.y + target.position.y) / 2;
    const waypoints = [...edge.waypoints || [], { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }];
    try {
      await jsonRequest(`/api/edges/${encodeURIComponent(edge.id)}`, "PATCH", {
        route: "manual",
        waypoints
      });
      await refreshState(true);
      state.selection = { type: "edge", id: edge.id };
      renderInspector();
      requestDraw();
      toast(`\u5DF2\u6DFB\u52A0\u62D0\u70B9\uFF08\u5171 ${waypoints.length} \u4E2A\uFF09\uFF1B\u53EF\u76F4\u63A5\u62D6\u52A8\u62D0\u70B9\uFF0C\u753B\u5E03\u4F1A\u663E\u793A\u5750\u6807`, "ok", 2800);
    } catch (error) {
      toast(`\u6DFB\u52A0\u62D0\u70B9\u5931\u8D25\uFF1A${error.message}`, "error", 4e3);
    }
  }
  async function clearWireWaypoints(edgeId) {
    try {
      await jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, "PATCH", {
        route: "auto",
        waypoints: []
      });
      await refreshState(true);
      toast("\u5DF2\u6E05\u9664\u62D0\u70B9\uFF0C\u6062\u590D\u81EA\u52A8\u5E03\u7EBF", "ok", 2200);
    } catch (error) {
      toast(`\u6E05\u9664\u62D0\u70B9\u5931\u8D25\uFF1A${error.message}`, "error", 4e3);
    }
  }
  async function batchResizeSelection() {
    const { nodes } = multiSelection();
    const targets = [...nodes].map((id) => nodeById(id)).filter(Boolean);
    if (!targets.length) {
      toast("\u5148\u591A\u9009\u8282\u70B9/\u5668\u4EF6\uFF08Ctrl+\u5355\u51FB\uFF09\uFF0C\u518D\u6267\u884C\u6279\u91CF\u5C3A\u5BF8", "info", 2800);
      return;
    }
    const raw = window.prompt(
      `\u7EDF\u4E00\u5C3A\u5BF8\uFF0824\u2013200\uFF0C\u5BBD/\u76F4\u5F84\uFF09\uFF1B\u5C06\u5E94\u7528\u5230 ${targets.length} \u4E2A\u8282\u70B9/\u5668\u4EF6`,
      "60"
    );
    if (raw === null) return;
    const width = Number(raw);
    if (!Number.isFinite(width) || width < 24 || width > 200) {
      toast("\u5C3A\u5BF8\u9700\u5728 24\u2013200 \u4E4B\u95F4", "error", 3e3);
      return;
    }
    let done = 0;
    for (const node of targets) {
      if (node.kind === "ground") continue;
      try {
        await jsonRequest(`/api/nodes/${encodeURIComponent(node.id)}`, "PATCH", {
          size: { w: Math.round(width) }
        });
        done += 1;
      } catch (error) {
        toast(`\u8BBE\u7F6E ${node.name} \u5931\u8D25\uFF1A${error.message}`, "error", 4e3);
      }
    }
    if (done) {
      await refreshState(true);
      toast(`\u5DF2\u7EDF\u4E00 ${done} \u4E2A\u8282\u70B9/\u5668\u4EF6\u5C3A\u5BF8\u4E3A ${Math.round(width)}`, "ok", 2600);
    }
  }
  async function addNodeAt(kind, screenX, screenY) {
    const spec = getNodeSpec(kind);
    if (!spec) {
      toast(`\u5F53\u524D\u6A21\u5F0F\u6CA1\u6709\u8282\u70B9\u7C7B\u578B ${kind}`, "error");
      return;
    }
    const world = screenToWorld(screenX, screenY);
    const snapped = snapWorld(world.x, world.y);
    const base = kind === "ground" ? "gnd" : kind === "node" ? "n" : kind.replace(/[^a-z0-9_]/gi, "") || "node";
    const name = uniqueNodeName(base);
    const payload = {
      name,
      kind,
      params: specDefaults(spec),
      data: kind === "manual" ? state.mode === "vector" ? { x: 1, y: 0 } : { voltage: 1 } : {},
      position: {
        x: clamp(Math.round(snapped.x), -1e4, 1e4),
        y: clamp(Math.round(snapped.y), -1e4, 1e4)
      }
    };
    const response = await task(() => jsonRequest("/api/nodes", "POST", payload));
    if (!response) return;
    applySnapshot(response);
    await selectEntity("node", response.node.id, true);
    switchTab("inspect");
    if (kind === "ground") {
      const count = (state.scene?.nodes || []).filter((node) => node.kind === "ground").length;
      toast(`\u5DF2\u6DFB\u52A0\u63A5\u5730\uFF1A\u5171 ${count} \u4E2A\uFF0C\u81EA\u52A8\u5408\u5E76\u4E3A 0V`, "ok", 2600);
    } else {
      toast(`\u5DF2\u6DFB\u52A0\u8282\u70B9 ${response.node.name}`, "ok", 2e3);
    }
  }
  async function addDeviceAt(element, screenX, screenY) {
    const spec = getEdgeSpec(element);
    if (!spec) {
      toast(`\u5F53\u524D\u6A21\u5F0F\u6CA1\u6709\u5668\u4EF6\u7C7B\u578B ${element}`, "error");
      return;
    }
    const world = screenToWorld(screenX, screenY);
    const snapped = snapWorld(world.x, world.y);
    const name = uniqueNodeName(element.replace(/[^a-z0-9]/gi, "") || "dev");
    const payload = {
      name,
      kind: "device",
      params: { element, ...specDefaults(spec) },
      data: {},
      position: {
        x: clamp(Math.round(snapped.x), -1e4, 1e4),
        y: clamp(Math.round(snapped.y), -1e4, 1e4)
      }
    };
    const response = await task(() => jsonRequest("/api/nodes", "POST", payload));
    if (!response) return;
    applySnapshot(response);
    await selectEntity("node", response.node.id, true);
    switchTab("inspect");
    toast(`\u5DF2\u6DFB\u52A0\u5668\u4EF6 ${response.node.name}`, "ok", 2e3);
  }
  async function createWire(deviceId, netId, pinName) {
    return createWireBetween(deviceId, netId, pinName, "");
  }
  async function createWireBetween(sourceId, targetId, sourcePin, targetPin) {
    const source = nodeById(sourceId);
    const target = nodeById(targetId);
    if (!source || !target) {
      toast("\u8FDE\u7EBF\u7684\u7AEF\u70B9\u4E0D\u5B58\u5728", "error", 3e3);
      return;
    }
    if (source.id === target.id) {
      toast("\u8FDE\u7EBF\u7684\u4E24\u4E2A\u7AEF\u70B9\u4E0D\u80FD\u662F\u540C\u4E00\u4E2A\u8282\u70B9", "error", 3e3);
      return;
    }
    if (isPinNode(source) && isPinNode(target)) {
      toast("\u5BFC\u7EBF\u4E0D\u5141\u8BB8\u76F4\u63A5\u8FDE\u63A5\u4E24\u4E2A\u5668\u4EF6\uFF08\u8BF7\u7ECF\u7F51\u7EDC\u8282\u70B9\uFF09", "error", 3500);
      return;
    }
    const body = {
      source: source.id,
      target: target.id,
      kind: "wire",
      params: {},
      enabled: true,
      route: state.ui?.circuitOrthogonal !== false ? "orthogonal" : "straight"
    };
    const pinFor = (node, pin) => {
      if (pin) return pin;
      const pins = devicePins(node);
      return pins.length === 1 ? String(pins[0].name || "") : "";
    };
    if (isPinNode(source)) body.source_pin = pinFor(source, sourcePin);
    if (isPinNode(target)) body.target_pin = pinFor(target, targetPin);
    const response = await task(() => jsonRequest("/api/edges", "POST", body));
    if (!response) return;
    applySnapshot(response);
    if (response.edge) {
      await selectEntity("edge", response.edge.id, true);
      switchTab("inspect");
    }
    toast("\u5DF2\u521B\u5EFA\u5BFC\u7EBF", "ok", 1800);
  }
  function openWireDialog() {
    if (state.mode !== "circuit") {
      toast("\u8FDE\u7EBF\u5BF9\u8BDD\u6846\u53EA\u7528\u4E8E\u7535\u8DEF\u573A\u666F", "error", 3e3);
      return;
    }
    const nodes = state.scene?.nodes || [];
    if (nodes.length < 2) {
      toast("\u81F3\u5C11\u9700\u8981\u4E24\u4E2A\u8282\u70B9\u624D\u80FD\u8FDE\u7EBF", "error", 3e3);
      return;
    }
    ui.modalCard.replaceChildren();
    const heading = el("h3", null, "\u65B0\u5EFA\u8FDE\u7EBF\uFF08\u9009\u62E9\u7AEF\u70B9\uFF09");
    const note = el("p", null, "\u7AEF\u70B9\u53EF\u4EE5\u662F\u300C\u7F51\u7EDC\u8282\u70B9 \u2194 \u7F51\u7EDC\u8282\u70B9\u300D\uFF08\u7EAF\u5BFC\u7EBF\uFF0C\u7535\u6C14\u5408\u5E76\uFF09\u6216\u300C\u5668\u4EF6\u5F15\u811A \u2194 \u7F51\u7EDC\u8282\u70B9\u300D\u3002");
    const form = el("form");
    form.autocomplete = "off";
    const rows = div("inline-fields");
    const makeSelect = (roleLabel) => {
      const wrap = div("field");
      wrap.appendChild(numberedField(roleLabel, ""));
      const select = el("select");
      select.dataset.role = roleLabel.includes("A") ? "wire-a" : "wire-b";
      for (const node of nodes) {
        const option = el("option", null, `${node.name} \xB7 ${node.kind === "module" ? `\u6A21\u5757 ${node.params?.block_name || ""}`.trim() : node.kind === "device" ? node.params?.element || "device" : node.kind}`);
        option.value = node.id;
        select.appendChild(option);
      }
      wrap.appendChild(select);
      const pinWrap = div("field");
      pinWrap.appendChild(numberedField("\u5F15\u811A", "\u5668\u4EF6\u8282\u70B9\u5FC5\u586B"));
      const pinSelect = el("select");
      pinSelect.dataset.role = roleLabel.includes("A") ? "wire-a-pin" : "wire-b-pin";
      pinWrap.appendChild(pinSelect);
      return { wrap, select, pinWrap, pinSelect };
    };
    const first = makeSelect("\u7AEF\u70B9 A");
    const second = makeSelect("\u7AEF\u70B9 B");
    const refreshPins = () => {
      for (const item of [first, second]) {
        const node = nodeById(item.select.value);
        item.pinSelect.replaceChildren();
        const blank = el("option", null, isPinNode(node) ? "\uFF08\u8BF7\u9009\u62E9\u5F15\u811A\uFF09" : "\u2014");
        blank.value = "";
        item.pinSelect.appendChild(blank);
        if (isPinNode(node)) {
          for (const pin of devicePins(node)) {
            const option = el("option", null, `${pin.name}\uFF08${pin.role}${pin.required ? " \xB7 \u5FC5\u63A5" : ""}\uFF09`);
            option.value = pin.name;
            item.pinSelect.appendChild(option);
          }
        }
        item.pinSelect.disabled = !isPinNode(node);
      }
    };
    first.select.addEventListener("change", refreshPins);
    second.select.addEventListener("change", refreshPins);
    if (nodes[1]) second.select.value = nodes[1].id;
    refreshPins();
    rows.append(first.wrap, first.pinWrap, second.wrap, second.pinWrap);
    form.appendChild(rows);
    const actions = div("modal-actions");
    const cancel = button("\u53D6\u6D88", "btn", closeModal);
    const create = button("\u521B\u5EFA\u8FDE\u7EBF", "btn primary", null);
    create.type = "button";
    create.addEventListener("click", () => {
      const a = nodeById(first.select.value);
      const b = nodeById(second.select.value);
      const aPin = isPinNode(a) ? first.pinSelect.value : "";
      const bPin = isPinNode(b) ? second.pinSelect.value : "";
      if (isPinNode(a) && !aPin) {
        toast("\u7AEF\u70B9 A \u662F\u5668\u4EF6\uFF0C\u8BF7\u9009\u62E9\u5F15\u811A", "error", 3e3);
        return;
      }
      if (isPinNode(b) && !bPin) {
        toast("\u7AEF\u70B9 B \u662F\u5668\u4EF6\uFF0C\u8BF7\u9009\u62E9\u5F15\u811A", "error", 3e3);
        return;
      }
      closeModal();
      void createWireBetween(first.select.value, second.select.value, aPin, bPin);
    });
    actions.append(cancel, create);
    form.append(actions);
    ui.modalCard.append(heading, note, form);
    ui.modal.classList.remove("hidden");
  }
  async function createEdge(source, target, kind) {
    const spec = getEdgeSpec(kind);
    if (!spec) {
      toast(`\u5F53\u524D\u6A21\u5F0F\u6CA1\u6709\u8FDE\u63A5\u7C7B\u578B ${kind}`, "error");
      return;
    }
    const body = {
      source,
      target,
      kind,
      params: specDefaults(spec),
      delay: false,
      enabled: true,
      auto_delay: true
    };
    if (state.mode === "circuit" && state.ui?.circuitOrthogonal !== false) body.route = "orthogonal";
    const response = await task(() => jsonRequest("/api/edges", "POST", body));
    if (!response) return;
    applySnapshot(response);
    if (response.edge) {
      await selectEntity("edge", response.edge.id, true);
      switchTab("inspect");
    }
    if (response.notice) toast(response.notice, "info", 5e3);
    else toast(`\u5DF2\u521B\u5EFA\u8FDE\u63A5 ${response.edge?.name || ""}`, "ok", 1800);
  }
  async function toggleEdgeDelay(edgeId) {
    const edge = edgeById(edgeId);
    if (!edge) return;
    const response = await task(() => jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, "PATCH", { delay: !edge.delay }));
    if (!response) return;
    const index = state.scene.edges.findIndex((item) => item.id === edgeId);
    if (index >= 0) state.scene.edges[index] = response.edge;
    if (response.sim) state.sim = response.sim;
    syncUI();
    requestDraw();
    toast(response.edge.delay ? "\u5DF2\u8BBE\u4E3A\u5355\u6B65\u5EF6\u8FDF" : "\u5DF2\u53D6\u6D88\u5355\u6B65\u5EF6\u8FDF", "ok", 2e3);
    void refreshState(true);
  }
  async function deleteNode(nodeId) {
    const node = nodeById(nodeId);
    if (!node) return;
    const connected = (state.scene?.edges || []).filter((edge) => edge.source === nodeId || edge.target === nodeId).length;
    const confirmed = await confirmModal(
      `\u5220\u9664\u8282\u70B9\u300C${node.name}\u300D\uFF1F`,
      connected ? `\u5C06\u540C\u65F6\u5220\u9664 ${connected} \u6761\u76F8\u8FDE\u7684\u8FDE\u63A5\u3002\u8BE5\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002` : "\u8BE5\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002",
      "\u5220\u9664",
      true
    );
    if (!confirmed) return;
    const response = await task(() => jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, "DELETE"));
    if (!response) return;
    if (state.selection.type === "node" && state.selection.id === nodeId) {
      state.selection = { type: null, id: null };
      state.inspectorId = null;
    }
    applySnapshot(response);
    renderInspector();
    toast("\u8282\u70B9\u5DF2\u5220\u9664", "ok", 1800);
  }
  async function deleteEdge(edgeId) {
    const edge = edgeById(edgeId);
    if (!edge) return;
    const confirmed = await confirmModal(
      `\u5220\u9664\u8FDE\u63A5\u300C${edge.name}\u300D\uFF1F`,
      "\u53EA\u5220\u9664\u8FD9\u6761\u4F20\u9012\u5173\u7CFB\uFF0C\u8282\u70B9\u4E0E\u5176\u5B83\u8FDE\u63A5\u4FDD\u6301\u4E0D\u53D8\u3002",
      "\u5220\u9664",
      true
    );
    if (!confirmed) return;
    const response = await task(() => jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, "DELETE"));
    if (!response) return;
    if (state.selection.type === "edge" && state.selection.id === edgeId) {
      state.selection = { type: null, id: null };
      state.inspectorId = null;
    }
    applySnapshot(response);
    renderInspector();
    toast("\u8FDE\u63A5\u5DF2\u5220\u9664", "ok", 1800);
  }
  async function deleteSelection() {
    const { nodes, edges } = multiSelection();
    if (!nodes.size && !edges.size) return;
    await pushUndoSnapshot();
    let removed = 0;
    for (const edgeId of edges) {
      if (!edgeById(edgeId)) continue;
      const response = await task(
        () => jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, "DELETE"),
        { history: false }
      );
      if (response) {
        removed += 1;
        applySnapshot(response);
      }
    }
    for (const nodeId of nodes) {
      if (!nodeById(nodeId)) continue;
      const response = await task(
        () => jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, "DELETE"),
        { history: false }
      );
      if (response) {
        removed += 1;
        applySnapshot(response);
      }
    }
    clearSelection();
    await refreshState(true);
    toast(`\u5DF2\u5220\u9664 ${removed} \u4E2A\u5BF9\u8C61`, "ok", 2200);
  }
  async function autoLayout() {
    const nodes = state.scene?.nodes || [];
    if (!nodes.length) {
      toast("\u753B\u5E03\u4E2D\u8FD8\u6CA1\u6709\u8282\u70B9", "info", 1800);
      return;
    }
    const edges = (state.scene?.edges || []).filter((edge) => edge.enabled);
    const ids = new Set(nodes.map((node) => node.id));
    const layer = new Map(nodes.map((node) => [node.id, 0]));
    if (state.mode === "circuit") {
      const ground = nodes.find((node) => node.kind === "ground");
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
    const groups = /* @__PURE__ */ new Map();
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
        position: { x: Number(node.position.x.toFixed(3)), y: Number(node.position.y.toFixed(3)) }
      }));
      await jsonRequest("/api/positions", "POST", { positions: items });
      fitView();
      toast("\u5DF2\u6309\u4FE1\u53F7\u6D41\u5411\u91CD\u65B0\u5E03\u5C40", "ok", 1800);
    } catch (error) {
      for (const node of nodes) {
        const previous = old.get(node.id);
        if (previous) {
          node.position.x = previous.x;
          node.position.y = previous.y;
        }
      }
      requestDraw();
      toast(`\u81EA\u52A8\u5E03\u5C40\u5931\u8D25\uFF1A${error.message}`, "error", 6e3);
    }
  }
  function fieldFor(labelText, unitText, input) {
    const wrapper = div("field");
    wrapper.appendChild(numberedField(labelText, unitText));
    wrapper.appendChild(input);
    return wrapper;
  }
  function numberInput(value, options = {}) {
    const input = el("input");
    input.type = "number";
    if (options.min !== void 0) input.min = String(options.min);
    if (options.max !== void 0) input.max = String(options.max);
    if (options.step !== void 0) input.step = String(options.step);
    input.value = String(value);
    return input;
  }
  function renderScenePanel() {
    const pane = ui.scenePane;
    if (!pane) return;
    pane.replaceChildren();
    pane.dataset.ready = "1";
    const modes = state.catalog?.modes || [
      { value: "signal", label: "\u4FE1\u53F7\u6D41" },
      { value: "circuit", label: "\u7535\u8DEF" }
    ];
    const modeSection = section("\u5DE5\u4F5C\u6A21\u5F0F", "\u5207\u6362\u4F1A\u91CD\u5EFA\u7A7A\u767D\u573A\u666F");
    const segmented = div("segmented");
    segmented.dataset.role = "mode";
    for (const item of modes) {
      const btn = button(item.label, "", () => void switchMode(item.value));
      btn.dataset.mode = item.value;
      btn.classList.toggle("active", item.value === state.mode);
      btn.title = item.description || "";
      segmented.appendChild(btn);
    }
    modeSection.appendChild(segmented);
    modeSection.appendChild(div("help", "\u4FE1\u53F7\u6D41\u6309\u62D3\u6251\u987A\u5E8F\u4F20\u64AD\u5B57\u5178\u6570\u636E\uFF1B\u7535\u8DEF\u7528\u8282\u70B9\u7535\u538B\u6CD5\u6C42\u89E3\uFF1B\u77E2\u91CF\u6A21\u5F0F\u63D0\u4F9B\u975E\u7EBF\u6027\u52A8\u6001\u6E90\u3001\u4E8C\u7EF4\u77E2\u91CF\u8FDE\u63A5\u4E0E\u76F8\u56FE\u3002"));
    pane.appendChild(modeSection);
    const simSection = section("\u4EFF\u771F\u8282\u594F", "\u4FEE\u6539\u540E\u81EA\u52A8\u5E94\u7528");
    const simGrid = div("inline-fields");
    const fpsInput = numberInput(30, { min: 1, max: 240, step: 1 });
    fpsInput.dataset.sim = "fps";
    const stepsInput = numberInput(1, { min: 1, max: 200, step: 1 });
    stepsInput.dataset.sim = "steps";
    const dtInput = numberInput(0.01, { min: 1e-9, max: 10, step: "any" });
    dtInput.dataset.sim = "dt";
    const sampleInput = numberInput(1, { min: 1, max: 100, step: 1 });
    sampleInput.dataset.sim = "sample";
    simGrid.append(
      fieldFor("\u5E27\u7387", "fps", fpsInput),
      fieldFor("\u6BCF\u5E27\u6B65\u6570", "steps", stepsInput),
      (() => {
        const field = fieldFor("\u65F6\u95F4\u6B65\u957F", "s", dtInput);
        const tools = div("inline-fields");
        const stepDown = button("\xF710", "btn tiny", () => {
          dtInput.value = trimNumber(Math.max(1e-9, Number(dtInput.value) / 10));
          dtInput.dispatchEvent(new Event("change", { bubbles: true }));
        });
        const stepUp = button("\xD710", "btn tiny", () => {
          dtInput.value = trimNumber(Math.min(10, Number(dtInput.value) * 10));
          dtInput.dispatchEvent(new Event("change", { bubbles: true }));
        });
        stepDown.title = "\u65F6\u95F4\u6B65\u957F \xF710\uFF08\u66F4\u7EC6\uFF09";
        stepUp.title = "\u65F6\u95F4\u6B65\u957F \xD710\uFF08\u66F4\u7C97\uFF09";
        tools.append(stepDown, stepUp);
        field.appendChild(tools);
        return field;
      })(),
      fieldFor("\u91C7\u6837\u95F4\u9694", "\u5E27", sampleInput)
    );
    simSection.appendChild(simGrid);
    const lockRow = div("switch-row");
    lockRow.appendChild(el("span", null, "\u9501\u5B9A dt = 1 / (fps \xD7 \u6B65\u6570)"));
    const lockInput = el("input");
    lockInput.type = "checkbox";
    lockInput.dataset.sim = "lock";
    lockRow.appendChild(lockInput);
    simSection.appendChild(lockRow);
    const realtimeRow = div("switch-row");
    realtimeRow.appendChild(el("span", null, "\u5B9E\u65F6\u8282\u62CD\uFF08\u5173\u95ED\u5219\u6781\u901F\u8FED\u4EE3\uFF09"));
    const realtimeInput = el("input");
    realtimeInput.type = "checkbox";
    realtimeInput.dataset.sim = "realtime";
    realtimeRow.appendChild(realtimeInput);
    simSection.appendChild(realtimeRow);
    const precisionRow = div("inline-fields");
    precisionRow.appendChild(el("span", null, "\u65F6\u95F4\u6B65\u957F\u9884\u8BBE"));
    for (const [label, value] of [["\u5FEB\u901F 1e-4", 1e-4], ["\u6807\u51C6 1e-5", 1e-5], ["\u9AD8\u7CBE\u5EA6 1e-6", 1e-6], ["\u8D85\u9AD8 1e-7", 1e-7]]) {
      const preset = button(label, "btn tiny", () => {
        dtInput.value = String(value);
        if (lockInput.checked) {
          lockInput.checked = false;
          dtInput.disabled = false;
        }
        void applySimConfig();
      });
      preset.dataset.dtPreset = String(value);
      preset.title = `\u65F6\u95F4\u6B65\u957F\u8BBE\u4E3A ${value} s`;
      precisionRow.appendChild(preset);
    }
    simSection.appendChild(precisionRow);
    simSection.appendChild(div("help", "\u65F6\u95F4\u6B65\u957F\u8D8A\u5C0F\u6C42\u89E3\u8D8A\u7EC6\uFF0C\u4F46\u6BCF\u5E27\u8BA1\u7B97\u91CF\u8D8A\u5927\uFF1B\u66F2\u7EBF\u5206\u8FA8\u7387\u8FD8\u53D7\u300C\u91C7\u6837\u95F4\u9694\u300D\u5F71\u54CD\u3002"));
    const simNote = div("help");
    simNote.dataset.role = "sim-note";
    simSection.appendChild(simNote);
    pane.appendChild(simSection);
    const solverSection = section("\u6C42\u89E3\u5668\u8BBE\u7F6E", "\u7535\u8DEF\u6A21\u5F0F\uFF1ANewton \u6536\u655B\u4E0E\u5931\u8D25\u6551\u6025");
    const solverGrid = div("inline-fields");
    const solverInput = (label, unit, name, value, min, max, step) => {
      const input = numberInput(value, { min, max, step });
      input.dataset.solver = name;
      return fieldFor(label, unit, input);
    };
    solverGrid.append(
      solverInput("\u76F8\u5BF9\u5BB9\u5DEE reltol", "", "reltol", 1e-9, 1e-15, 0.1, "any"),
      solverInput("\u7535\u538B\u5BB9\u5DEE vntol", "V", "vntol", 1e-6, 1e-15, 1, "any"),
      solverInput("\u7535\u6D41\u5BB9\u5DEE abstol", "A", "abstol", 1e-6, 1e-15, 1, "any"),
      solverInput("Newton \u4E0A\u9650", "\u6B21", "max_iter", 60, 1, 500, 1),
      solverInput("gmin \u6B65\u6570", "\u6B65", "gmin_steps", 10, 0, 100, 1),
      solverInput("source \u6B65\u6570", "\u6B65", "src_steps", 10, 0, 100, 1),
      solverInput("\u6B8B\u5DEE\u5BB9\u5DEE", "", "residual_tol", 0, 0, 1, "any")
    );
    solverSection.appendChild(solverGrid);
    solverSection.appendChild(div("help", "\u6B8B\u5DEE\u5BB9\u5DEE 0 = \u53EA\u8BB0\u5F55\u4E0D\u5F3A\u5236\uFF1B\u5931\u8D25\u65F6\u81EA\u52A8 gmin/source stepping\uFF0C\u4ECD\u5931\u8D25\u4F1A\u62A5\u6700\u5927\u8282\u70B9\u3002\u4FEE\u6539\u540E\u7ACB\u5373\u751F\u6548\uFF08\u91CD\u5EFA\u7535\u8DEF\u5F15\u64CE\uFF09\u3002"));
    pane.appendChild(solverSection);
    const statsSection = section("\u7F51\u7EDC\u7EDF\u8BA1", "\u8FD0\u884C\u65F6\u66F4\u65B0");
    const statsGrid = div("stat-grid");
    const statSpecs = [
      ["\u8282\u70B9", "nodes"],
      ["\u8FDE\u63A5", "edges"],
      ["\u6B65\u8017\u65F6", "step"],
      ["\u5B9E\u9645\u5E27\u7387", "fps"],
      ["\u77E9\u9635", "matrix"],
      ["Newton", "iterations"],
      ["\u5F55\u5236\u5E27", "frames"],
      ["\u4FEE\u8BA2", "revision"]
    ];
    for (const [labelText, key] of statSpecs) {
      const stat = div("stat");
      stat.appendChild(el("span", null, labelText));
      const value = el("b", null, "\u2014");
      value.dataset.stat = key;
      stat.appendChild(value);
      statsGrid.appendChild(stat);
    }
    statsSection.appendChild(statsGrid);
    pane.appendChild(statsSection);
    const integrationSection = section("\u79EF\u5206\u65B9\u6CD5", "\u4EC5\u7535\u8DEF\u6A21\u5F0F");
    const integration = el("select");
    integration.dataset.role = "integration";
    for (const item of state.catalog?.integration || []) {
      const option = el("option", null, item.label || item.value);
      option.value = item.value;
      integration.appendChild(option);
    }
    integration.addEventListener("change", () => void changeIntegration(integration.value));
    integrationSection.appendChild(integration);
    const integrationNote = div("help");
    integrationNote.dataset.role = "integration-note";
    integrationSection.appendChild(integrationNote);
    pane.appendChild(integrationSection);
    const templateSection = section("\u573A\u666F\u6A21\u677F", "\u4E00\u952E\u66FF\u6362");
    const templateList = div("template-list");
    templateList.dataset.role = "templates";
    for (const template of state.templates) {
      const item = el("button", "template");
      item.type = "button";
      const title = el("strong");
      title.append(el("span", null, template.label));
      title.append(document.createTextNode("  "));
      const modeBadge = el("span", "tpl-mode", modeLabel(template.mode));
      title.appendChild(modeBadge);
      item.appendChild(title);
      item.appendChild(el("small", null, template.description));
      if (template.sim && Object.keys(template.sim).length) {
        const bits = [];
        if (template.sim.fps) bits.push(`${template.sim.fps} fps`);
        if (template.sim.dt) bits.push(`dt ${fmt(template.sim.dt, 3)}`);
        if (template.sim.steps_per_frame) bits.push(`${template.sim.steps_per_frame} \u6B65/\u5E27`);
        item.appendChild(el("small", null, bits.join(" \xB7 ")));
      }
      item.addEventListener("click", () => void loadTemplate(template.name, template.label));
      templateList.appendChild(item);
    }
    if (!state.templates.length) templateList.appendChild(div("help", "\u6A21\u677F\u76EE\u5F55\u4E0D\u53EF\u7528\u3002"));
    templateSection.appendChild(templateList);
    pane.appendChild(templateSection);
    const projectSection = section("\u5DE5\u7A0B\u6587\u4EF6", "\u7248\u672C\u5316 .netlab \xB7 \u539F\u5B50\u5199\u5165");
    const projectName = el("input");
    projectName.type = "text";
    projectName.maxLength = 120;
    projectName.dataset.role = "project-name";
    projectName.value = state.project.name || "";
    projectName.addEventListener("change", () => {
      const value = projectName.value.trim() || "\u672A\u547D\u540D\u5DE5\u7A0B";
      if (value !== state.project.name) {
        state.project.name = value.slice(0, 120);
        markProjectDirty();
      }
      updateProjectPanel();
    });
    projectSection.appendChild(fieldFor("\u5DE5\u7A0B\u540D\u79F0", "", projectName));
    const projectPath = div("project-path");
    projectPath.dataset.role = "project-path";
    projectSection.appendChild(projectPath);
    const projectRow = div("file-row");
    projectRow.append(
      button("\u4FDD\u5B58", "btn", () => void saveProject(false)),
      button("\u53E6\u5B58\u4E3A\u2026", "btn", () => void saveProject(true)),
      button("\u6253\u5F00\u2026", "btn", () => void openProject()),
      button("\u6062\u590D\u81EA\u52A8\u4FDD\u5B58", "btn", () => void recoverAutosave())
    );
    projectSection.appendChild(projectRow);
    const autosaveRow = div("switch-row");
    autosaveRow.appendChild(
      el("span", null, `\u6BCF ${Math.round(state.project.autosaveInterval / 1e3)} \u79D2\u5199\u5DE5\u7A0B\u5FEB\u7167\uFF08\u53EA\u5199 backups/\uFF0C\u4E0D\u52A8\u6B63\u672C\uFF09`)
    );
    const autosaveToggle = el("input");
    autosaveToggle.type = "checkbox";
    autosaveToggle.dataset.role = "project-autosave";
    autosaveToggle.checked = Boolean(state.project.autosave);
    autosaveToggle.addEventListener("change", () => {
      state.project.autosave = Boolean(autosaveToggle.checked);
      try {
        localStorage.setItem(AUTOSAVE_ENABLED_KEY, state.project.autosave ? "1" : "0");
      } catch (error) {
      }
      toast(state.project.autosave ? "\u5DF2\u5F00\u542F\u81EA\u52A8\u4FDD\u5B58" : "\u5DF2\u5173\u95ED\u81EA\u52A8\u4FDD\u5B58", "info", 2e3);
    });
    autosaveRow.appendChild(autosaveToggle);
    projectSection.appendChild(autosaveRow);
    const recentBox = div("recent-projects");
    recentBox.dataset.role = "project-recent";
    projectSection.appendChild(recentBox);
    projectFileInput = el("input");
    projectFileInput.type = "file";
    projectFileInput.accept = ".netlab,application/json,.json";
    projectFileInput.className = "hidden-input";
    projectFileInput.addEventListener("change", () => {
      const file = projectFileInput.files && projectFileInput.files[0];
      projectFileInput.value = "";
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) {
        toast("\u5DE5\u7A0B\u6587\u4EF6\u8D85\u8FC7 8 MB\uFF0C\u5DF2\u62D2\u7EDD", "error", 6e3);
        return;
      }
      void file.text().then((text) => importProjectText(text, ""));
    });
    projectSection.appendChild(projectFileInput);
    projectSection.appendChild(div("help", "\u5DE5\u7A0B\u53EA\u4FDD\u5B58\u62D3\u6251\u3001\u53C2\u6570\u3001\u6A21\u5757\u5B9A\u4E49\u4E0E\u754C\u9762\u504F\u597D\uFF0C\u4E0D\u4FDD\u5B58\u8FD0\u884C\u72B6\u6001\u4E0E\u5F55\u5236\u5E27\u3002\u6D4F\u89C8\u5668\u6A21\u5F0F\u901A\u8FC7\u4E0B\u8F7D/\u4E0A\u4F20\u6587\u4EF6\u4FDD\u5B58\u3002"));
    pane.appendChild(projectSection);
    const gridSection = section("\u753B\u5E03\u4E0E\u6807\u51C6\u7F51\u683C", "\u5438\u9644 \xB7 \u6B63\u4EA4\u5E03\u7EBF \xB7 \u6574\u7406");
    const gridRow = div("field-row");
    const snapBox = el("input");
    snapBox.type = "checkbox";
    snapBox.checked = Boolean(state.ui.snap);
    snapBox.addEventListener("change", () => {
      state.ui.snap = Boolean(snapBox.checked);
      markProjectDirty();
      toast(state.ui.snap ? "\u7F51\u683C\u5438\u9644\u5DF2\u5F00\u542F" : "\u7F51\u683C\u5438\u9644\u5DF2\u5173\u95ED", "info", 1800);
    });
    const gridSelect = el("select", "input");
    for (const size of [10, 20, 50]) {
      const option = el("option", null, `${size} \u5355\u4F4D`);
      option.value = String(size);
      gridSelect.appendChild(option);
    }
    gridSelect.value = String(Number(state.ui.grid) || 20);
    gridSelect.addEventListener("change", () => {
      state.ui.grid = Number(gridSelect.value) || 20;
      markProjectDirty();
      requestDraw();
    });
    gridRow.append(el("label", null, "\u5438\u9644"), snapBox, el("label", null, "\u6807\u51C6\u7F51\u683C"), gridSelect);
    gridSection.appendChild(gridRow);
    const styleRow = div("field-row");
    const nodeStyleSelect = el("select", "input");
    for (const [value, label] of [["circle", "\u7A7A\u5FC3\u5706"], ["dot", "\u5B9E\u5FC3\u70B9"], ["box", "\u5C0F\u65B9\u6846"]]) {
      const option = el("option", null, label);
      option.value = value;
      nodeStyleSelect.appendChild(option);
    }
    nodeStyleSelect.value = state.ui.nodeStyle || "circle";
    nodeStyleSelect.addEventListener("change", () => {
      state.ui.nodeStyle = nodeStyleSelect.value;
      markProjectDirty();
      requestDraw();
    });
    const scaleSelect = el("select", "input");
    for (const size of [0.8, 1, 1.2, 1.6]) {
      const option = el("option", null, `${size}\xD7`);
      option.value = String(size);
      scaleSelect.appendChild(option);
    }
    scaleSelect.value = String(Number(state.ui.symbolScale) || 1.2);
    scaleSelect.addEventListener("change", () => {
      state.ui.symbolScale = Number(scaleSelect.value) || 1.2;
      markProjectDirty();
      requestDraw();
    });
    const colorSelect = el("select", "input");
    for (const [value, label] of [["#1f5f5b", "\u9752\u7EFF"], [C("#a8541f"), "\u6696\u6A59"], ["#2563a8", "\u975B\u84DD"]]) {
      const option = el("option", null, label);
      option.value = value;
      colorSelect.appendChild(option);
    }
    colorSelect.value = state.ui.glyphColor || "#1f5f5b";
    colorSelect.addEventListener("change", () => {
      state.ui.glyphColor = colorSelect.value;
      markProjectDirty();
      requestDraw();
    });
    styleRow.append(
      el("label", null, "\u8282\u70B9\u6837\u5F0F"),
      nodeStyleSelect,
      el("label", null, "\u7B26\u53F7\u5927\u5C0F"),
      scaleSelect,
      el("label", null, "\u7B26\u53F7\u989C\u8272"),
      colorSelect
    );
    gridSection.appendChild(styleRow);
    gridSection.appendChild(
      button("\u6574\u7406\u5230\u7F51\u683C", "btn", () => void snapSceneToGrid())
    );
    gridSection.appendChild(div("help", "\u5143\u4EF6\u4F4D\u7F6E\u7531\u5143\u4EF6\u81EA\u8EAB layout \u51B3\u5B9A\uFF08\u53EF\u5728\u68C0\u67E5\u5668\u5FAE\u8C03\uFF09\uFF1B\u4E0D\u518D\u81EA\u52A8\u91CD\u6392\uFF0C\u907F\u514D\u6253\u4E71\u624B\u5DE5\u56FE\u3002"));
    gridSection.appendChild(
      div("help", "\u7535\u8DEF\u6A21\u5F0F\u65B0\u5EFA\u8FDE\u7EBF\u9ED8\u8BA4\u6B63\u4EA4\u8DEF\u7531\uFF1B\u62D6\u52A8/\u65B0\u5EFA\u8282\u70B9\u5438\u9644\u5230\u7F51\u683C\uFF1B\u6309\u4F4F Alt \u4E34\u65F6\u6682\u505C\u5438\u9644\u3002\u6574\u7406\u4F1A\u6309\u5F53\u524D\u7F51\u683C\u5BF9\u9F50\u5168\u90E8\u8282\u70B9\u4E0E\u624B\u52A8\u62D0\u70B9\uFF08\u53EF\u64A4\u9500\uFF09\u3002")
    );
    pane.appendChild(gridSection);
    updateProjectPanel();
    const dataSection = section("\u573A\u666F\u6570\u636E", "JSON");
    const fileRow = div("file-row");
    fileRow.appendChild(button("\u5BFC\u51FA JSON", "btn", () => void exportScene()));
    fileRow.appendChild(button("\u5BFC\u51FA\u539F\u7406\u56FE SVG", "btn", () => void exportSchematic()));
    fileRow.appendChild(button("\u5BFC\u5165 JSON", "btn", () => importInput.click()));
    dataSection.appendChild(fileRow);
    const importInput = el("input");
    importInput.type = "file";
    importInput.accept = "application/json,.json";
    importInput.className = "hidden-input";
    importInput.addEventListener("change", () => {
      const file = importInput.files && importInput.files[0];
      importInput.value = "";
      if (file) void importSceneFile(file);
    });
    dataSection.appendChild(importInput);
    dataSection.appendChild(div("help", "\u5BFC\u51FA\u4E0D\u542B\u8FD0\u884C\u65F6\u72B6\u6001\uFF1B\u5BFC\u5165\u4E0A\u9650 2 MB\uFF0C\u5BFC\u5165\u524D\u4F1A\u518D\u6B21\u786E\u8BA4\u3002\u670D\u52A1\u7AEF\u4F1A\u6821\u9A8C\u8282\u70B9\u3001\u8FDE\u63A5\u3001\u53C2\u6570\u4E0E\u62D3\u6251\u3002"));
    pane.appendChild(dataSection);
    for (const input of [fpsInput, stepsInput, dtInput, sampleInput, lockInput, realtimeInput]) {
      input.addEventListener("change", () => void applySimConfig());
    }
    for (const input of $$("[data-solver]", pane)) {
      input.addEventListener("change", () => void applySimConfig());
    }
    lockInput.addEventListener("change", () => {
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
      setValue("fps", config.fps);
      setValue("steps", config.steps_per_frame);
      setValue("dt", config.dt);
      setValue("sample", config.sample_every);
      for (const key of ["reltol", "vntol", "abstol", "max_iter", "gmin_steps", "src_steps", "residual_tol"]) {
        if (config[key] !== void 0) setValue(key, config[key]);
      }
      const lock = $('[data-sim="lock"]', pane);
      if (lock) lock.checked = Boolean(config.lock_dt);
      const realtime = $('[data-sim="realtime"]', pane);
      if (realtime) realtime.checked = Boolean(config.realtime);
      const dtInput = $('[data-sim="dt"]', pane);
      if (dtInput) dtInput.disabled = Boolean(config.lock_dt);
      const note2 = $('[data-role="sim-note"]', pane);
      if (note2) {
        const perFrame = Number(config.dt) * Number(config.steps_per_frame);
        const perSecond = perFrame * Number(config.fps);
        let text = `\u6BCF\u5E27 ${fmt(perFrame, 4)} s \xB7 \u6BCF\u79D2\u63A8\u8FDB ${fmt(perSecond, 4)} s`;
        if (config.realtime) {
          text += perSecond > 1.0001 ? ` \xB7 \u52A0\u901F ${perSecond.toFixed(2)}\xD7` : " \xB7 \u5B9E\u65F6";
        } else {
          text += " \xB7 \u6781\u901F\u6A21\u5F0F\uFF08\u4E0D\u7B49\u5F85\u5899\u949F\uFF09";
        }
        text += config.lock_dt ? " \xB7 dt \u5DF2\u9501\u5B9A\uFF08\u6BCF\u5E27\u56FA\u5B9A 1/fps\uFF0C\u66F2\u7EBF\u91C7\u6837\u4E5F\u53D7\u6B64\u9650\u5236\uFF09" : "";
        note2.textContent = text;
      }
    }
    const scene = state.scene;
    const stats = sim?.scene || {};
    setStat("nodes", String(scene?.nodes?.length ?? 0));
    setStat("edges", String(scene?.edges?.length ?? 0));
    const stepMs = Number(scene?.stats?.step_ms ?? stats.step_ms ?? 0);
    const stepEl = $('[data-stat="step"]', pane);
    if (stepEl) {
      stepEl.replaceChildren(
        document.createTextNode(fmt(stepMs, 3)),
        el("small", null, "ms")
      );
    }
    setStat("fps", String(Math.round(sim?.actual_fps ?? 0)));
    setStat("matrix", stats.kind === "circuit" ? `${stats.matrix_size || 0}\xD7${stats.matrix_size || 0}` : "\u2014");
    setStat("iterations", stats.iterations !== void 0 ? String(stats.iterations) : "\u2014");
    setStat("frames", String(sim?.frames_recorded ?? state.frames.length));
    setStat("revision", String(scene?.revision ?? 0));
    const integration = $('[data-role="integration"]', pane);
    if (integration && scene) {
      integration.value = scene.integration || "trapezoidal";
      integration.disabled = state.mode !== "circuit";
    }
    const note = $('[data-role="integration-note"]', pane);
    if (note) {
      note.textContent = state.mode === "circuit" ? "\u68AF\u5F62\u6CD5\u7CBE\u5EA6\u9AD8\uFF1B\u540E\u5411\u6B27\u62C9\u66F4\u7A33\u5B9A\uFF0C\u9002\u5408\u521A\u6027\u7535\u8DEF\u3002" : "\u4EC5\u7535\u8DEF\u6A21\u5F0F\u4F7F\u7528\uFF1B\u4FE1\u53F7\u6D41\u7531\u6BCF\u6761\u8FDE\u63A5\u7684\u79BB\u6563\u5316\u53C2\u6570\u51B3\u5B9A\u3002";
    }
    const modeHost = $('[data-role="mode"]', pane);
    if (modeHost) {
      $$("button[data-mode]", modeHost).forEach((item) => {
        item.classList.toggle("active", item.dataset.mode === state.mode);
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
    if (!Number.isInteger(fps) || fps < 1 || fps > 240) throw new Error("\u5E27\u7387\u5FC5\u987B\u662F 1\u2013240 \u7684\u6574\u6570");
    if (!Number.isInteger(steps) || steps < 1 || steps > 200) throw new Error("\u6BCF\u5E27\u6B65\u6570\u5FC5\u987B\u662F 1\u2013200 \u7684\u6574\u6570");
    if (!Number.isInteger(sample) || sample < 1 || sample > 100) throw new Error("\u91C7\u6837\u95F4\u9694\u5FC5\u987B\u662F 1\u2013100 \u7684\u6574\u6570");
    if (lock) dt = 1 / (fps * steps);
    if (!Number.isFinite(dt) || dt < 1e-9 || dt > 10) throw new Error("dt \u5FC5\u987B\u5728 1e-9 \u5230 10 s \u4E4B\u95F4");
    if (dt * steps > 10) throw new Error("\u6BCF\u5E27\u63A8\u8FDB\u7684\u4EFF\u771F\u65F6\u95F4\u8FC7\u5927\uFF0C\u8BF7\u51CF\u5C0F dt \u6216\u6B65\u6570");
    const readSolver = (name, label, lo, hi, integer = false) => {
      const input = $(`[data-solver="${name}"]`, pane);
      if (!input) return void 0;
      const value = Number(input.value);
      if (!Number.isFinite(value) || value < lo || value > hi) {
        throw new Error(`${label}\u5FC5\u987B\u5728 ${lo}\u2013${hi} \u4E4B\u95F4`);
      }
      if (integer && !Number.isInteger(value)) throw new Error(`${label}\u5FC5\u987B\u662F\u6574\u6570`);
      return value;
    };
    const payload = {
      fps,
      steps_per_frame: steps,
      dt,
      sample_every: sample,
      lock_dt: lock,
      realtime: Boolean(realtimeInput?.checked)
    };
    const solverFields = [
      ["reltol", "\u76F8\u5BF9\u5BB9\u5DEE reltol", 1e-15, 0.1, false],
      ["vntol", "\u7535\u538B\u5BB9\u5DEE vntol", 1e-15, 1, false],
      ["abstol", "\u7535\u6D41\u5BB9\u5DEE abstol", 1e-15, 1, false],
      ["max_iter", "Newton \u8FED\u4EE3\u4E0A\u9650", 1, 500, true],
      ["gmin_steps", "gmin \u6B65\u6570", 0, 100, true],
      ["src_steps", "source \u6B65\u6570", 0, 100, true],
      ["residual_tol", "\u6B8B\u5DEE\u5BB9\u5DEE", 0, 1, false]
    ];
    for (const [key, label, lo, hi, integer] of solverFields) {
      const value = readSolver(key, label, lo, hi, integer);
      if (value !== void 0) payload[key] = value;
    }
    return payload;
  }
  async function applySimConfig() {
    let payload;
    try {
      payload = readSimConfig();
    } catch (error) {
      toast(error.message, "error", 6e3);
      updateScenePanelValues();
      return;
    }
    if (!payload) return;
    const response = await task(() => jsonRequest("/api/config", "PATCH", payload));
    if (!response) {
      updateScenePanelValues();
      return;
    }
    state.sim = response.sim;
    syncUI();
    updateScenePanelValues();
    updateRunButton(Boolean(state.sim?.running));
    const solverKeys = ["reltol", "vntol", "abstol", "max_iter", "gmin_steps", "src_steps", "residual_tol"];
    toast("\u4EFF\u771F\u8BBE\u7F6E\u5DF2\u66F4\u65B0", "ok", 1600);
  }
  async function changeIntegration(value) {
    if (state.mode !== "circuit") {
      toast("\u79EF\u5206\u65B9\u6CD5\u53EA\u7528\u4E8E\u7535\u8DEF\u6A21\u5F0F", "info", 1800);
      updateScenePanelValues();
      return;
    }
    const response = await task(() => jsonRequest("/api/scene", "PATCH", { integration: value }));
    if (!response) {
      updateScenePanelValues();
      return;
    }
    applySnapshot(response);
    renderScenePanel();
    toast(`\u79EF\u5206\u65B9\u6CD5\u5DF2\u5207\u6362\u4E3A ${value === "trapezoidal" ? "\u68AF\u5F62\u6CD5" : "\u540E\u5411\u6B27\u62C9"}`, "ok", 2e3);
  }
  async function switchMode(mode, options = {}) {
    if (mode === state.mode) return;
    if (!options.skipConfirm) {
      const confirmed = await confirmModal(
        `\u5207\u6362\u5230${modeLabel(mode)}\u6A21\u5F0F\uFF1F`,
        "\u5207\u6362\u4F1A\u628A\u5F53\u524D\u573A\u666F\u66FF\u6362\u4E3A\u8BE5\u6A21\u5F0F\u7684\u7A7A\u767D\u6A21\u677F\uFF0C\u8282\u70B9\u3001\u8FDE\u63A5\u3001\u53C2\u6570\u4E0E\u5F55\u5236\u6570\u636E\u90FD\u4F1A\u6E05\u7A7A\u3002\u8BF7\u5148\u5BFC\u51FA\u9700\u8981\u4FDD\u7559\u7684\u573A\u666F\u3002",
        "\u5207\u6362",
        true
      );
      if (!confirmed) return;
    }
    const response = await task(() => jsonRequest("/api/mode", "POST", { mode }));
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
    toast(`\u5DF2\u5207\u6362\u5230${modeLabel(mode)}\u6A21\u5F0F`, "ok", 2200);
  }
  async function loadTemplate(name, label) {
    const nodeCount = state.scene?.nodes?.length || 0;
    if (nodeCount > 0) {
      const confirmed = await confirmModal(
        `\u8F7D\u5165\u6A21\u677F\u300C${label}\u300D\uFF1F`,
        `\u5F53\u524D\u573A\u666F\u6709 ${nodeCount} \u4E2A\u8282\u70B9\uFF0C\u5C06\u88AB\u6A21\u677F\u5B8C\u5168\u66FF\u6362\u3002\u8BF7\u5148\u5BFC\u51FA\u9700\u8981\u4FDD\u7559\u7684\u573A\u666F\u3002`,
        "\u8F7D\u5165",
        true
      );
      if (!confirmed) return;
    }
    const response = await task(() => jsonRequest(`/api/templates/${encodeURIComponent(name)}`, "POST"));
    if (!response) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    applySnapshot(response);
    state.cursor = Number(response.sim?.cursor) || 0;
    renderInspector();
    renderScenePanel();
    renderSignalList();
    fitView();
    toast(`\u5DF2\u8F7D\u5165\u6A21\u677F\uFF1A${label}`, "ok", 2200);
  }
  async function migrateSceneToDevices() {
    if (state.mode !== "circuit") {
      toast("\u53EA\u6709\u7535\u8DEF\u573A\u666F\u53EF\u4EE5\u8FC1\u79FB\u4E3A\u5668\u4EF6\u6A21\u578B", "error", 3500);
      return;
    }
    const confirmed = await confirmModal(
      "\u8FC1\u79FB\u4E3A\u5668\u4EF6\u6A21\u578B\uFF08R20\uFF09",
      "\u5C06\u628A\u5F53\u524D\u573A\u666F\u7684\u5143\u4EF6\u8FB9\u8F6C\u6362\u4E3A\u300C\u5668\u4EF6\u8282\u70B9 + \u5F15\u811A\u5BFC\u7EBF\u300D\uFF0C\u7F51\u7EDC\u8282\u70B9\u4FDD\u7559\uFF1B\u4E4B\u540E\u5DE5\u7A0B\u6309 v4 \u4FDD\u5B58\u3002\u8BE5\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002",
      "\u8FC1\u79FB",
      false
    );
    if (!confirmed) return;
    const response = await task(() => jsonRequest("/api/scene/migrate-devices", "POST", {}));
    if (!response) return;
    applySnapshot(response);
    const converted = Number(response.migration?.converted || 0);
    toast(`\u5DF2\u8FC1\u79FB ${converted} \u4E2A\u5143\u4EF6\u4E3A\u5668\u4EF6\u8282\u70B9`, "ok", 3e3);
    fitView(true);
  }
  async function clearScene() {
    const confirmed = await confirmModal(
      "\u6E05\u7A7A\u5F53\u524D\u573A\u666F\uFF1F",
      "\u5C06\u5220\u9664\u6240\u6709\u8282\u70B9\u4E0E\u8FDE\u63A5\uFF0C\u5E76\u91CD\u5EFA\u4E3A\u7A7A\u767D\u6A21\u677F\u3002\u8BE5\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002",
      "\u6E05\u7A7A",
      true
    );
    if (!confirmed) return;
    const response = await task(() => jsonRequest("/api/scene/clear", "POST"));
    if (!response) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    applySnapshot(response);
    state.cursor = Number(response.sim?.cursor) || 0;
    renderInspector();
    renderScenePanel();
    renderSignalList();
    fitView();
    toast("\u573A\u666F\u5DF2\u6E05\u7A7A", "ok", 2e3);
  }
  async function exportScene() {
    const payload = await task(() => api("/api/scene/export?include_state=false"), { dirty: false });
    if (!payload) return;
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = el("a");
    link.href = url;
    link.download = `netlab-${state.mode}-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2e3);
    toast("\u573A\u666F\u5DF2\u5BFC\u51FA", "ok", 1800);
  }
  async function exportSchematic() {
    if (state.scene?.mode !== "circuit") {
      toast("\u539F\u7406\u56FE\u5BFC\u51FA\u4EC5\u652F\u6301\u7535\u8DEF\u6A21\u5F0F", "info", 2600);
      return;
    }
    const params = new URLSearchParams({
      name: state.project?.name || "",
      network: state.currentNetwork?.name || ""
    });
    const payload = await task(
      () => jsonRequest(`/api/export/schematic?${params.toString()}`, "GET"),
      { dirty: false }
    );
    if (!payload?.svg) return;
    const blob = new Blob([String(payload.svg)], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = el("a");
    link.href = url;
    link.download = String(payload.filename || "schematic.svg");
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2e3);
    toast("\u539F\u7406\u56FE SVG \u5DF2\u5BFC\u51FA", "ok", 1800);
  }
  async function importSceneFile(file) {
    if (file.size > MAX_IMPORT_BYTES) {
      toast("\u573A\u666F\u6587\u4EF6\u8D85\u8FC7 2 MB\uFF0C\u5DF2\u62D2\u7EDD", "error", 6e3);
      return;
    }
    let payload;
    try {
      const text = await file.text();
      payload = JSON.parse(text);
    } catch (error) {
      toast(`JSON \u89E3\u6790\u5931\u8D25\uFF1A${error.message}`, "error", 6e3);
      return;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      toast("\u573A\u666F\u5FC5\u987B\u662F JSON \u5BF9\u8C61", "error", 5e3);
      return;
    }
    if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
      toast("\u573A\u666F\u5FC5\u987B\u5305\u542B nodes \u4E0E edges \u6570\u7EC4", "error", 5e3);
      return;
    }
    const confirmed = await confirmModal(
      "\u5BFC\u5165\u5E76\u66FF\u6362\u5F53\u524D\u573A\u666F\uFF1F",
      `\u6587\u4EF6\u5305\u542B ${payload.nodes.length} \u4E2A\u8282\u70B9\u3001${payload.edges.length} \u6761\u8FDE\u63A5\u3002\u5BFC\u5165\u4F1A\u6E05\u7A7A\u5F53\u524D\u573A\u666F\u7684\u8282\u70B9\u3001\u8FDE\u63A5\u4E0E\u5F55\u5236\u6570\u636E\u3002`,
      "\u5BFC\u5165",
      true
    );
    if (!confirmed) return;
    const response = await task(() => jsonRequest("/api/scene", "POST", payload));
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
    toast("\u573A\u666F\u5DF2\u5BFC\u5165", "ok", 2200);
  }
  const AUTOSAVE_KEY = "netlab.autosave.v1";
  const AUTOSAVE_ENABLED_KEY = "netlab.autosave.enabled";
  const RECENT_KEY = "netlab.recent.v1";
  function markProjectDirty() {
    if (!state.booted && !state.scene) return;
    if (!state.project.dirty) {
      state.project.dirty = true;
      const bridge = desktopBridge();
      if (bridge && typeof bridge.setDirty === "function") {
        try {
          bridge.setDirty(true);
        } catch (error) {
        }
      }
    }
    updateProjectPanel();
  }
  function projectSaved() {
    state.project.dirty = false;
    state.project.autosavedAt = 0;
    const bridge = desktopBridge();
    if (bridge && typeof bridge.setDirty === "function") {
      try {
        bridge.setDirty(false);
      } catch (error) {
      }
      void callBridge("clearAutosave", []);
    } else {
      try {
        localStorage.removeItem(AUTOSAVE_KEY);
      } catch (error) {
      }
    }
    updateProjectPanel();
  }
  function rememberRecent(path, name) {
    if (!path) return;
    const entry = { path, name: name || baseName(path), at: Date.now() };
    state.project.recent = [entry].concat(state.project.recent.filter((item) => item.path !== path)).slice(0, 6);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(state.project.recent));
    } catch (error) {
    }
  }
  function loadRecent() {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      const items = raw ? JSON.parse(raw) : [];
      state.project.recent = Array.isArray(items) ? items.filter((item) => item && typeof item.path === "string").slice(0, 6) : [];
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
        parts.push(isDesktop() ? "\u5C1A\u672A\u4FDD\u5B58\u5230\u6587\u4EF6" : "\u6D4F\u89C8\u5668\u6A21\u5F0F\uFF1A\u4FDD\u5B58\u4E3A\u4E0B\u8F7D\u6587\u4EF6");
      }
      parts.push(state.project.dirty ? "\u25CF \u6709\u672A\u4FDD\u5B58\u4FEE\u6539" : "\u5DF2\u4FDD\u5B58");
      if (state.project.autosavedAt) {
        const at = new Date(state.project.autosavedAt);
        parts.push(`\u81EA\u52A8\u4FDD\u5B58 ${at.toLocaleTimeString("zh-CN", { hour12: false })}`);
      }
      pathNode.textContent = parts.join(" \xB7 ");
      pathNode.title = state.project.path || "";
      pathNode.classList.toggle("dirty", state.project.dirty);
    }
    const nameInput = pane.querySelector('[data-role="project-name"]');
    if (nameInput && document.activeElement !== nameInput) {
      nameInput.value = state.project.name || "";
    }
    const autosaveInput = pane.querySelector('[data-role="project-autosave"]');
    if (autosaveInput) autosaveInput.checked = Boolean(state.project.autosave);
    const recentBox = pane.querySelector('[data-role="project-recent"]');
    if (recentBox) {
      recentBox.replaceChildren();
      recentBox.appendChild(el("span", null, "\u6700\u8FD1\u5DE5\u7A0B"));
      if (!state.project.recent.length) {
        recentBox.appendChild(div("help", "\uFF08\u6682\u65E0\uFF09"));
        return;
      }
      for (const item of state.project.recent) {
        const chip = button(item.name || baseName(item.path), "chip", () => {
          if (isDesktop()) void openProjectPath(item.path);
          else toast("\u6D4F\u89C8\u5668\u6A21\u5F0F\u65E0\u6CD5\u76F4\u63A5\u6253\u5F00\u672C\u5730\u8DEF\u5F84\uFF0C\u8BF7\u4F7F\u7528\u300C\u6253\u5F00\u5DE5\u7A0B\u300D\u9009\u62E9\u6587\u4EF6", "info", 4e3);
        });
        chip.title = item.path;
        recentBox.appendChild(chip);
      }
    }
  }
  async function buildProjectPayload() {
    const response = await api("/api/project/export", {
      method: "POST",
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
            orthogonal: state.ui.circuitOrthogonal !== false
          },
          symbol: state.ui.symbol,
          nodeStyle: state.ui.nodeStyle || "circle",
          drawingMode: Boolean(state.ui.drawingMode),
          drawingSheet: String(state.ui.drawingSheet || "A3"),
          drawingLabels: Boolean(state.ui.drawingLabels),
          drawingPage: Math.max(1, Math.min(9, Number(state.ui.drawingPage) || 1)),
          symbolScale: Number(state.ui.symbolScale) || 1.2,
          glyphColor: state.ui.glyphColor || "#1f5f5b"
        }
      })
    });
    return response && response.project ? response.project : null;
  }
  function downloadText(text, filename) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = el("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2e3);
  }
  async function saveProject(forceDialog = false) {
    const bridge = desktopBridge();
    let project = null;
    try {
      project = await buildProjectPayload();
    } catch (error) {
      toast(`\u4FDD\u5B58\u5931\u8D25\uFF1A${error.message}`, "error", 7e3);
      return false;
    }
    if (!project) return false;
    const text = JSON.stringify(project, null, 2);
    const safeName = (state.project.name || "netlab-project").replace(/[\\/:*?"<>|]+/g, "_");
    if (!bridge) {
      downloadText(text, safeName.endsWith(".netlab") ? safeName : `${safeName}.netlab`);
      projectSaved();
      toast("\u5DE5\u7A0B\u5DF2\u4E0B\u8F7D\uFF1B\u6D4F\u89C8\u5668\u6A21\u5F0F\u8BF7\u59A5\u5584\u4FDD\u5B58\u8BE5\u6587\u4EF6", "ok", 3600);
      return true;
    }
    let path = "";
    if (!forceDialog && state.project.path) {
      path = await callBridge("saveProjectTo", [state.project.path, text]);
    }
    if (!path) {
      path = await callBridge("saveProject", [text, safeName]);
    }
    if (!path) return false;
    state.project.path = path;
    state.project.name = baseName(path).replace(/\.netlab$/i, "") || state.project.name;
    rememberRecent(path, state.project.name);
    projectSaved();
    toast(`\u5DF2\u4FDD\u5B58\uFF1A${baseName(path)}`, "ok", 2600);
    return true;
  }
  async function importProjectText(text, path = "") {
    let project = null;
    try {
      project = JSON.parse(text);
    } catch (error) {
      toast(`\u5DE5\u7A0B JSON \u89E3\u6790\u5931\u8D25\uFF1A${error.message}`, "error", 7e3);
      return false;
    }
    if (!project || typeof project !== "object" || Array.isArray(project)) {
      toast("\u5DE5\u7A0B\u6587\u4EF6\u5FC5\u987B\u662F JSON \u5BF9\u8C61", "error", 6e3);
      return false;
    }
    const extensions = Array.isArray(project.extensions) ? project.extensions : [];
    let trust = false;
    if (extensions.length) {
      const body = div("trust-body");
      body.appendChild(
        el(
          "p",
          null,
          `\u8BE5\u5DE5\u7A0B\u5E26\u6709 ${extensions.length} \u4E2A Python \u6269\u5C55\u3002\u542F\u7528\u540E\u5B83\u4EEC\u4F1A\u5728\u540E\u7AEF\u672C\u8FDB\u7A0B\u4EE5\u5B8C\u6574\u6743\u9650\u6267\u884C\u2014\u2014\u8FD9\u4E0D\u662F\u6C99\u7BB1\u3002\u53EA\u6709\u786E\u8BA4\u6765\u6E90\u53EF\u4FE1\u65F6\u624D\u7EE7\u7EED\u3002`
        )
      );
      const list = div("trust-list");
      for (const item of extensions.slice(0, 10)) {
        const row = div("trust-row");
        row.appendChild(el("b", null, String(item.kind || item.filename || "\u6269\u5C55")));
        row.appendChild(el("span", "badge gray", String(item.type === "method" ? "\u8FDE\u63A5" : "\u8282\u70B9")));
        const hash = String(item.sha256 || "").trim();
        row.appendChild(el("code", null, hash ? `sha256 ${hash.slice(0, 16)}\u2026` : "\u65E0\u6821\u9A8C\u548C"));
        list.appendChild(row);
      }
      if (extensions.length > 10) {
        list.appendChild(div("help", `\u2026 \u53E6\u6709 ${extensions.length - 10} \u4E2A\u672A\u5217\u51FA`));
      }
      body.appendChild(list);
      const warn = div("help trust-warn");
      warn.textContent = "\u9009\u62E9\u300C\u62D2\u7EDD\u300D\u540E\u5DE5\u7A0B\u4E0D\u4F1A\u88AB\u8F7D\u5165\uFF1B\u6269\u5C55\u4EE3\u7801\u4FDD\u6301\u4E0D\u6267\u884C\u3002";
      body.appendChild(warn);
      trust = await confirmModal("\u5DE5\u7A0B\u5305\u542B Python \u6269\u5C55", body, "\u4FE1\u4EFB\u5E76\u8F7D\u5165", true);
      if (!trust) {
        toast("\u5DF2\u53D6\u6D88\uFF1A\u672A\u542F\u7528\u5DE5\u7A0B\u5185\u6269\u5C55\uFF0C\u5DE5\u7A0B\u672A\u8F7D\u5165", "info", 5e3);
        return false;
      }
    }
    let response = null;
    try {
      response = await api("/api/project/import", {
        method: "POST",
        body: JSON.stringify({ project, trust_extensions: trust })
      });
    } catch (error) {
      toast(`\u5DE5\u7A0B\u8F7D\u5165\u5931\u8D25\uFF1A${error.message}`, "error", 8e3);
      showBanner(`\u5DE5\u7A0B\u8F7D\u5165\u5931\u8D25\uFF1A${error.message}`);
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
    state.project.name = String(project.name || state.project.name || "\u672A\u547D\u540D\u5DE5\u7A0B").slice(0, 120);
    state.project.path = path || "";
    if (path) rememberRecent(path, state.project.name);
    projectSaved();
    renderScenePanel();
    renderInspector();
    renderSignalList();
    await fetchNetworks();
    fitView();
    toast(`\u5DE5\u7A0B\u5DF2\u8F7D\u5165\uFF1A${state.project.name}`, "ok", 3e3);
    const rails = response.migration?.rails || [];
    if (rails.length) {
      const lines = rails.slice(0, 6).map((item) => {
        const risk = item.net_is_ground ? "\u5730\uFF0C\u884C\u4E3A\u4E0D\u53D8" : "\u975E\u5730\uFF0C\u8BF7\u590D\u6838";
        return `\xB7 ${item.network || ""} ${item.device}\uFF1A\u65AD\u5F00 OUT\u2212 \u2192 ${item.removed_net}\uFF08${risk}\uFF09`;
      });
      const more = rails.length > 6 ? `\uFF1B\u2026 \u5171 ${rails.length} \u6761` : "";
      showBanner(`\u5DF2\u81EA\u52A8\u8FC1\u79FB ${rails.length} \u4E2A\u6BD4\u8F83\u5668/\u8FD0\u653E\u4E3A\u5355\u7AEF\u8F93\u51FA\uFF1A${lines.join("\uFF1B")}${more}`);
      toast(`\u5DF2\u8FC1\u79FB ${rails.length} \u4E2A\u8FD0\u653E\u7684\u65E7\u8F93\u51FA\u7AEF\uFF08R21\uFF09`, "info", 6e3);
    }
    return true;
  }
  async function openProject() {
    const bridge = desktopBridge();
    if (bridge) {
      const text = await callBridge("openProject", []);
      if (text) await importProjectText(text, await callBridge("currentPath", []) || "");
      return;
    }
    projectFileInput.click();
  }
  async function openProjectPath(path) {
    const bridge = desktopBridge();
    if (!bridge) return;
    const text = await callBridge("openProjectPath", [path]);
    if (text) await importProjectText(text, path);
  }
  async function newProject() {
    const mode = await chooseModeModal();
    if (!mode) return;
    const labels = { signal: "\u4FE1\u53F7\u6D41", circuit: "\u7535\u8DEF", vector: "\u77E2\u91CF\u573A" };
    const confirmed = await confirmModal(
      "\u65B0\u5EFA\u5DE5\u7A0B\uFF1F",
      `\u5C06\u521B\u5EFA\u7A7A\u767D\u300C${labels[mode]}\u300D\u573A\u666F\uFF1B\u5F53\u524D\u573A\u666F\u4F1A\u88AB\u66FF\u6362\uFF0C\u672A\u4FDD\u5B58\u7684\u4FEE\u6539\u5C06\u4E22\u5931\u3002`,
      "\u65B0\u5EFA",
      true
    );
    if (!confirmed) return;
    const response = await task(
      () => jsonRequest(`/api/scene/clear?mode=${encodeURIComponent(mode)}`, "POST"),
      { dirty: false }
    );
    if (!response) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    state.frames = [];
    state.values.clear();
    state.nodeValues.clear();
    state.edgeValues.clear();
    applySnapshot(response);
    state.cursor = Number(response.sim?.cursor || 0);
    state.project.name = "\u672A\u547D\u540D\u5DE5\u7A0B";
    state.project.path = "";
    projectSaved();
    renderScenePanel();
    renderInspector();
    renderSignalList();
    fitView();
    toast("\u5DF2\u65B0\u5EFA\u7A7A\u767D\u5DE5\u7A0B", "ok", 2200);
  }
  async function recoverAutosave() {
    const bridge = desktopBridge();
    let text = "";
    if (bridge) {
      if (!await callBridge("hasAutosave", [])) {
        toast("\u6CA1\u6709\u53EF\u6062\u590D\u7684\u81EA\u52A8\u4FDD\u5B58", "info", 2600);
        return false;
      }
      text = await callBridge("recoverAutosave", []);
    } else {
      try {
        const raw = localStorage.getItem(AUTOSAVE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        text = parsed && typeof parsed.text === "string" ? parsed.text : "";
      } catch (error) {
        text = "";
      }
      if (!text) {
        toast("\u6CA1\u6709\u53EF\u6062\u590D\u7684\u81EA\u52A8\u4FDD\u5B58", "info", 2600);
        return false;
      }
    }
    if (!text) return false;
    const confirmed = await confirmModal(
      "\u6062\u590D\u81EA\u52A8\u4FDD\u5B58\uFF1F",
      "\u81EA\u52A8\u4FDD\u5B58\u6765\u81EA\u4E0A\u4E00\u6B21\u672A\u6B63\u5E38\u9000\u51FA\u7684\u4F1A\u8BDD\uFF0C\u8F7D\u5165\u4F1A\u66FF\u6362\u5F53\u524D\u573A\u666F\u3002",
      "\u6062\u590D",
      false
    );
    if (!confirmed) return false;
    return importProjectText(text, state.project.path || "");
  }
  async function autosaveProject() {
    if (!state.project.autosave || !state.project.dirty || !state.booted) return;
    try {
      if (state.project.path) {
        const response = await jsonRequest("/api/workspace/snapshot", "POST", {
          path: state.project.path,
          name: state.project.name
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
        const path = await callBridge("autosave", [text]);
        if (path) state.project.autosavedAt = Date.now();
      } else {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ at: Date.now(), text }));
        state.project.autosavedAt = Date.now();
      }
      updateProjectPanel();
    } catch (error) {
      console.warn("autosave failed", error);
    }
  }
  async function maybeOfferRecovery() {
    const bridge = desktopBridge();
    let available = false;
    try {
      if (bridge) {
        available = Boolean(await callBridge("hasAutosave", []));
      } else {
        available = Boolean(localStorage.getItem(AUTOSAVE_KEY));
      }
    } catch (error) {
      available = false;
    }
    if (!available) return;
    const confirmed = await confirmModal(
      "\u53D1\u73B0\u81EA\u52A8\u4FDD\u5B58\u7684\u5DE5\u7A0B",
      "\u4E0A\u6B21\u4F1A\u8BDD\u53EF\u80FD\u672A\u6B63\u5E38\u9000\u51FA\u3002\u662F\u5426\u8F7D\u5165\u81EA\u52A8\u4FDD\u5B58\u7684\u5DE5\u7A0B\uFF1F\u9009\u62E9\u53D6\u6D88\u5219\u4FDD\u7559\u5F53\u524D\u573A\u666F\u3002",
      "\u8F7D\u5165\u81EA\u52A8\u4FDD\u5B58",
      false
    );
    if (confirmed) await recoverAutosave();
  }
  function initProject() {
    loadRecent();
    try {
      const flag = localStorage.getItem(AUTOSAVE_ENABLED_KEY);
      if (flag === "0") state.project.autosave = false;
    } catch (error) {
    }
    window.addEventListener("netlab-desktop-ready", () => {
      state.project.desktop = true;
      updateProjectPanel();
    });
    window.addEventListener("beforeunload", (event) => {
      if (!state.project.dirty || isDesktop()) return;
      event.preventDefault();
      event.returnValue = "\u5DE5\u7A0B\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539\u3002";
      return event.returnValue;
    });
    window.netlabDesktopCommand = (name, payload) => {
      const command = String(name || "");
      if (command === "new") void newProject();
      else if (command === "open") void openProject();
      else if (command === "open-path") void openProjectPath(String(payload || ""));
      else if (command === "save") void saveProject(false);
      else if (command === "saveAs") void saveProject(true);
      else if (command === "recover") void recoverAutosave();
      else if (command === "fit") fitView(true);
      else if (command === "help") showHelp();
      else toast(`\u672A\u77E5\u684C\u9762\u547D\u4EE4\uFF1A${command}`, "info", 2600);
    };
    jsonRequest("/api/settings", "GET").then((response) => {
      const settings = response && response.settings || {};
      if (typeof settings.autosave_enabled === "boolean") {
        state.project.autosave = settings.autosave_enabled;
      }
      const seconds = Number(settings.autosave_interval_seconds);
      if (Number.isFinite(seconds) && seconds >= 5) {
        state.project.autosaveInterval = seconds * 1e3;
      }
      updateProjectPanel();
    }).catch(() => {
    });
    setInterval(() => void autosaveProject(), state.project.autosaveInterval);
    if (isDesktop()) state.project.desktop = true;
  }
  function decodeProbeKey(key) {
    if (key.startsWith("n:")) {
      const rest = key.slice(2);
      const cut = rest.lastIndexOf(":");
      return {
        group: "\u8282\u70B9",
        label: cut > 0 ? `${rest.slice(0, cut)} \xB7 ${rest.slice(cut + 1)}` : rest,
        target: "\u8282\u70B9"
      };
    }
    if (key.startsWith("e:")) {
      const rest = key.slice(2);
      const cut = rest.lastIndexOf(":");
      return {
        group: "\u8FDE\u63A5",
        label: cut > 0 ? `${rest.slice(0, cut)} \xB7 ${rest.slice(cut + 1)}` : rest,
        target: "\u8FDE\u63A5"
      };
    }
    return { group: "\u4FE1\u53F7", label: key };
  }
  function renderSignalList() {
    if (!ui.signalList) return;
    ui.signalList.replaceChildren();
    if (!state.probeKeys.length) {
      ui.signalList.appendChild(div("help", "\u8FD0\u884C\u4EFF\u771F\u540E\u81EA\u52A8\u5217\u51FA\u53EF\u7ED8\u5236\u4FE1\u53F7\u3002"));
      renderLegend();
      return;
    }
    const filter = state.chart.filter.trim().toLowerCase();
    const keys = state.probeKeys.filter((key) => key.toLowerCase().includes(filter));
    if (!keys.length) {
      ui.signalList.appendChild(div("help", "\u6CA1\u6709\u5339\u914D\u7684\u4FE1\u53F7\u3002"));
      renderLegend();
      return;
    }
    const groups = /* @__PURE__ */ new Map();
    for (const key of keys) {
      const info = decodeProbeKey(key);
      if (!groups.has(info.group)) groups.set(info.group, []);
      groups.get(info.group).push({ key, info });
    }
    for (const [group, entries] of groups) {
      ui.signalList.appendChild(div("signal-group", group));
      for (const { key, info } of entries) {
        const item = el("label", "signal-item");
        item.dataset.key = key;
        item.title = key;
        const dot = el("span", "legend-dot");
        dot.style.background = colorForKey(key);
        const checkbox = el("input");
        checkbox.type = "checkbox";
        checkbox.checked = state.chart.selected.has(key);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            if (state.chart.selected.size >= CHART_KEYS) {
              checkbox.checked = false;
              toast(`\u6700\u591A\u540C\u65F6\u7ED8\u5236 ${CHART_KEYS} \u6761\u4FE1\u53F7`, "info", 2200);
              return;
            }
            state.chart.selected.add(key);
          } else {
            state.chart.selected.delete(key);
          }
          renderLegend();
          scheduleChartDraw();
        });
        const name = el("span", null, info.label);
        const value = el("em", null, state.values.has(key) ? fmt(state.values.get(key), 3) : "\u2014");
        value.dataset.signalValue = key;
        item.append(dot, checkbox, name, value);
        ui.signalList.appendChild(item);
      }
    }
    updateSignalListValues();
    renderLegend();
  }
  function updateSignalListValues() {
    for (const node of $$("[data-signal-value]", ui.signalList)) {
      const key = node.dataset.signalValue;
      node.textContent = state.values.has(key) ? fmt(state.values.get(key), 3) : "\u2014";
    }
  }
  function renderLegend() {
    if (!ui.legend) return;
    ui.legend.replaceChildren();
    const keys = Array.from(state.chart.selected);
    if (!keys.length) {
      ui.legend.appendChild(div("help", "\u52FE\u9009\u4E0A\u65B9\u4FE1\u53F7\u4EE5\u7ED8\u5236\u66F2\u7EBF\u3002"));
      return;
    }
    for (const key of keys) {
      const item = div("legend-item");
      const dot = el("span", "legend-dot");
      dot.style.background = colorForKey(key);
      const name = el("span", "legend-name", decodeProbeKey(key).label);
      name.title = key;
      const value = el("span", "legend-value", state.values.has(key) ? fmt(state.values.get(key), 4) : "\u2014");
      value.dataset.legendValue = key;
      item.append(dot, name, value);
      ui.legend.appendChild(item);
    }
  }
  function updateLegendValues() {
    for (const node of $$("[data-legend-value]", ui.legend)) {
      const key = node.dataset.legendValue;
      node.textContent = state.values.has(key) ? fmt(state.values.get(key), 4) : "\u2014";
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
  function recordingStale() {
    const revision = state.scene?.revision;
    return Boolean(
      state.frames.length && state.replay.recordingRevision !== null && revision !== void 0 && revision !== state.replay.recordingRevision
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
      ui.chartReplayTime.textContent = frame ? `t ${frame.t.toFixed(3)} s` : "\u2014";
    }
    if (ui.topTimeline) {
      ui.topTimeline.max = String(max);
      ui.topTimeline.value = String(state.replay.index);
      ui.topTimeline.disabled = !state.frames.length;
    }
    if (ui.topTimelineTime) {
      const total = state.frames.length ? Number(state.frames[state.frames.length - 1].t || 0) : 0;
      ui.topTimelineTime.textContent = frame ? `t ${frame.t.toFixed(3)} / ${total.toFixed(3)} s` : "\u2014";
    }
    if (ui.btnReplay) {
      ui.btnReplay.textContent = state.replay.playing ? "\u23F8 \u6682\u505C" : "\u25B6 \u56DE\u653E";
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
    status.classList.remove("stale", "replay");
    if (recordingStale()) {
      status.textContent = "\u8BB0\u5F55\u5DF2\u8FC7\u671F \xB7 \u573A\u666F\u5DF2\u4FEE\u6539\uFF0C\u8BF7\u91CD\u65B0\u6C42\u89E3";
      status.classList.add("stale");
    } else if (state.replay.active) {
      status.textContent = `\u56DE\u653E\u4E2D \xB7 ${state.replay.index + 1}/${state.frames.length}`;
      status.classList.add("replay");
    } else {
      status.textContent = "";
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
  const REPLAY_TICK_MS = 16;
  function toggleReplayPlayback() {
    if (!state.frames.length) {
      toast("\u8FD8\u6CA1\u6709\u53EF\u56DE\u653E\u7684\u5F55\u5236\u5E27", "info", 2200);
      return;
    }
    if (state.replay.playing) {
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
    state.replay.carry = (state.replay.carry || 0) + elapsed * speed / 1e3;
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
  function phaseStateKeys(node) {
    const prefix = `state:${node.name}:`;
    return (state.probeKeys || []).filter((key) => key.startsWith(prefix)).sort((left, right) => {
      const a = Number(left.slice(prefix.length));
      const b = Number(right.slice(prefix.length));
      if (Number.isFinite(a) && Number.isFinite(b)) return a - b;
      return left.localeCompare(right);
    });
  }
  function vectorCandidates() {
    const nodes = state.scene?.nodes || [];
    return nodes.filter((node) => {
      const data = nodeDisplayData(node);
      const hasX = typeof data.x === "number" && typeof data.y === "number";
      const hasV = typeof data.vx === "number" && typeof data.vy === "number";
      const hasState = typeof data.x1 === "number" && typeof data.x2 === "number";
      return hasX || hasV || hasState || phaseStateKeys(node).length >= 2;
    });
  }
  function renderVectorNodeList() {
    if (!ui.vectorNode) return;
    const nodes = vectorCandidates();
    const previous = state.phaseNode;
    ui.vectorNode.replaceChildren();
    if (!nodes.length) {
      const option = el("option", null, "\uFF08\u65E0\u77E2\u91CF\u8282\u70B9\uFF09");
      option.value = "";
      ui.vectorNode.appendChild(option);
      state.phaseNode = "";
      drawPhase();
      return;
    }
    for (const node of nodes) {
      const option = el("option", null, `${node.name} \xB7 ${node.kind}`);
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
    const wrap = $(".phase-wrap");
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
      if (activeTab() === "vector") drawPhase();
    }, 80);
  }
  function drawPhase() {
    if (activeTab() !== "vector") return;
    const { w, h, dpr } = state.phaseSize;
    if (w < 20 || h < 20) return;
    phaseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    phaseCtx.clearRect(0, 0, w, h);
    phaseCtx.fillStyle = C("#faf8f2");
    phaseCtx.fillRect(0, 0, w, h);
    const node = nodeByName(state.phaseNode);
    if (!node) {
      phaseCtx.fillStyle = C("#969083");
      phaseCtx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
      phaseCtx.textAlign = "center";
      phaseCtx.textBaseline = "middle";
      phaseCtx.fillText("\u6CA1\u6709\u53EF\u7ED8\u5236\u7684\u4E8C\u7EF4\u77E2\u91CF\u8282\u70B9", w / 2, h / 2);
      ui.phaseReadout.textContent = "\u5728\u77E2\u91CF\u6A21\u5F0F\u4E0B\u6DFB\u52A0\u300C\u975E\u7EBF\u6027\u52A8\u6001\u6E90\u300D\u540E\u5373\u53EF\u67E5\u770B\u76F8\u56FE\u3002";
      return;
    }
    const trail = clamp(Number(state.phaseTrail) || 360, 20, 1200);
    const total = state.frames.length;
    const cursor = state.phaseIndex == null ? Math.max(0, total - 1) : clamp(Math.round(Number(state.phaseIndex) || 0), 0, Math.max(0, total - 1));
    const frames = state.frames.slice(Math.max(0, cursor - trail + 1), cursor + 1);
    const keyX = `n:${node.name}:x`;
    const keyY = `n:${node.name}:y`;
    const keyVX = `n:${node.name}:vx`;
    const keyVY = `n:${node.name}:vy`;
    const keyX1 = `n:${node.name}:x1`;
    const keyX2 = `n:${node.name}:x2`;
    let fieldX = keyX;
    let fieldY = keyY;
    let labelX = "x";
    let labelY = "y";
    let points = frames.filter((frame) => typeof frame.v[keyX] === "number" && typeof frame.v[keyY] === "number").map((frame) => ({ x: frame.v[keyX], y: frame.v[keyY], t: frame.t }));
    if (points.length < 2) {
      fieldX = keyVX;
      fieldY = keyVY;
      labelX = "vx";
      labelY = "vy";
      points = frames.filter((frame) => typeof frame.v[keyVX] === "number" && typeof frame.v[keyVY] === "number").map((frame) => ({ x: frame.v[keyVX], y: frame.v[keyVY], t: frame.t }));
    }
    if (points.length < 2) {
      fieldX = keyX1;
      fieldY = keyX2;
      labelX = "x1";
      labelY = "x2";
      points = frames.filter((frame) => typeof frame.v[keyX1] === "number" && typeof frame.v[keyX2] === "number").map((frame) => ({ x: frame.v[keyX1], y: frame.v[keyX2], t: frame.t }));
    }
    if (points.length < 2) {
      const stateKeys = phaseStateKeys(node);
      if (stateKeys.length >= 2) {
        fieldX = stateKeys[0];
        fieldY = stateKeys[1];
        labelX = fieldX.slice(`state:${node.name}:`.length);
        labelY = fieldY.slice(`state:${node.name}:`.length);
        points = frames.filter((frame) => typeof frame.v[fieldX] === "number" && typeof frame.v[fieldY] === "number").map((frame) => ({ x: frame.v[fieldX], y: frame.v[fieldY], t: frame.t }));
      }
    }
    if (!points.length) {
      if (state.sim?.mode === "signal" && !phaseStateKeys(node).length) {
        ui.phaseReadout.textContent = "\u8BE5\u4FE1\u53F7\u6D41\u8282\u70B9\u6682\u65E0\u72B6\u6001\u901A\u9053\uFF1A\u5148\u8FD0\u884C\u9884\u8BA1\u7B97\uFF0C\u6216\u9009\u62E9\u4F20\u9012\u51FD\u6570 / \u79EF\u5206\u5668\u8282\u70B9\u3002";
        return;
      }
      const data = nodeDisplayData(node);
      if (typeof data.x === "number" && typeof data.y === "number") {
        points = [{ x: data.x, y: data.y, t: state.sim?.time || 0 }];
        fieldX = "x";
        fieldY = "y";
      } else if (typeof data.vx === "number" && typeof data.vy === "number") {
        points = [{ x: data.vx, y: data.vy, t: state.sim?.time || 0 }];
        fieldX = "vx";
        fieldY = "vy";
        labelX = "vx";
        labelY = "vy";
      } else if (typeof data.x1 === "number" && typeof data.x2 === "number") {
        points = [{ x: data.x1, y: data.x2, t: state.sim?.time || 0 }];
        fieldX = "x1";
        fieldY = "x2";
        labelX = "x1";
        labelY = "x2";
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
    const span = Math.max(spanX, spanY, 1e-3);
    const pad = span * 0.12;
    minX -= pad;
    maxX += pad;
    minY -= pad;
    maxY += pad;
    spanX = maxX - minX;
    spanY = maxY - minY;
    const scale = size / Math.max(spanX, spanY, 1e-3);
    const mapX = (value) => px + size / 2 + (value - (minX + maxX) / 2) * scale;
    const mapY = (value) => py + size / 2 - (value - (minY + maxY) / 2) * scale;
    phaseCtx.strokeStyle = C("#e3ddd0");
    phaseCtx.lineWidth = 1;
    phaseCtx.beginPath();
    for (let index = 0; index <= 6; index += 1) {
      const gx = px + size * index / 6;
      const gy = py + size * index / 6;
      phaseCtx.moveTo(gx, py);
      phaseCtx.lineTo(gx, py + size);
      phaseCtx.moveTo(px, gy);
      phaseCtx.lineTo(px + size, gy);
    }
    phaseCtx.stroke();
    phaseCtx.strokeStyle = C("#bcb3a1");
    phaseCtx.lineWidth = 1;
    phaseCtx.beginPath();
    const axisY = clamp(mapY(0), py, py + size);
    const axisX = clamp(mapX(0), px, px + size);
    phaseCtx.moveTo(px, axisY);
    phaseCtx.lineTo(px + size, axisY);
    phaseCtx.moveTo(axisX, py);
    phaseCtx.lineTo(axisX, py + size);
    phaseCtx.stroke();
    if (points.length > 1) {
      phaseCtx.strokeStyle = C("rgba(168, 84, 31, 0.78)");
      phaseCtx.lineWidth = 1.4;
      phaseCtx.lineJoin = "round";
      phaseCtx.beginPath();
      points.forEach((point, index) => {
        const sx = mapX(point.x);
        const sy = mapY(point.y);
        if (index === 0) phaseCtx.moveTo(sx, sy);
        else phaseCtx.lineTo(sx, sy);
      });
      phaseCtx.stroke();
      const previous = points[Math.max(0, points.length - 18)];
      const current2 = points[points.length - 1];
      const angle = Math.atan2(mapY(current2.y) - mapY(previous.y), mapX(current2.x) - mapX(previous.x));
      const tipX = mapX(current2.x);
      const tipY = mapY(current2.y);
      phaseCtx.fillStyle = C("#1f5f5b");
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
    phaseCtx.fillStyle = C("#7b7266");
    phaseCtx.font = '9px "Cascadia Code", Consolas, monospace';
    phaseCtx.textAlign = "left";
    phaseCtx.textBaseline = "top";
    phaseCtx.fillText(`${labelX} / ${labelY} \xB7 ${node.name}`, px, 3);
    phaseCtx.textAlign = "right";
    phaseCtx.fillText(`${points.length} pts`, px + size, 3);
    phaseCtx.textAlign = "left";
    phaseCtx.textBaseline = "bottom";
    phaseCtx.fillText(fmt(minX, 2), px, py + size + 12);
    phaseCtx.textAlign = "right";
    phaseCtx.fillText(fmt(maxX, 2), px + size, py + size + 12);
    phaseCtx.textAlign = "right";
    phaseCtx.textBaseline = "bottom";
    phaseCtx.fillText(fmt(maxY, 2), px - 5, py + 9);
    phaseCtx.textBaseline = "top";
    phaseCtx.fillText(fmt(minY, 2), px - 5, py + size - 9);
    const current = points[points.length - 1];
    if (current) {
      const magnitude = Math.hypot(current.x, current.y);
      let pathLength = 0;
      let area = 0;
      for (let index = 1; index < points.length; index += 1) {
        pathLength += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
        area += points[index - 1].x * points[index].y - points[index].x * points[index - 1].y;
      }
      const ys = points.map((point) => point.y);
      const finalY = current.y;
      const peakY = finalY >= 0 ? Math.max(...ys) : Math.min(...ys);
      const overshoot = Math.abs(finalY) > 1e-12 ? Math.max(0, (peakY - finalY) / Math.abs(finalY) * 100) : 0;
      const band = Math.abs(finalY) * 0.02;
      let lastOutside = -1;
      for (let index = 0; index < points.length; index += 1) {
        if (Math.abs(points[index].y - finalY) > band) lastOutside = index;
      }
      const settling = lastOutside >= 0 && lastOutside + 1 < points.length ? Math.max(0, current.t - points[lastOutside].t) : 0;
      ui.phaseReadout.textContent = `${node.kind}  ${labelX}=${fmt(current.x, 5)}  ${labelY}=${fmt(current.y, 5)}  |r|=${fmt(magnitude, 5)}  t=${fmt(current.t, 4)} s  L=${fmt(pathLength, 4)}  A=${fmt(Math.abs(area) / 2, 4)}  \u5CF0\u503C=${fmt(peakY, 5)}  \u8D85\u8C03=${fmt(overshoot, 2)}%  \u7A33\u6001=${fmt(finalY, 5)}  \u8C03\u8282=${fmt(settling, 4)} s`;
    }
    syncPhaseControls();
  }
  function phaseFrameCount() {
    return state.frames.length;
  }
  function syncPhaseControls() {
    const total = phaseFrameCount();
    const cursor = state.phaseIndex == null ? Math.max(0, total - 1) : clamp(Math.round(Number(state.phaseIndex) || 0), 0, Math.max(0, total - 1));
    if (ui.phaseFrame) {
      ui.phaseFrame.max = String(Math.max(0, total - 1));
      ui.phaseFrame.value = String(cursor);
      ui.phaseFrame.disabled = total === 0;
    }
    if (ui.phaseFrameLabel) {
      ui.phaseFrameLabel.textContent = total ? `${cursor + 1}/${total}` : "0/0";
    }
    if (ui.phasePlay) {
      ui.phasePlay.textContent = state.phasePlaying ? "\u6682\u505C" : "\u64AD\u653E";
    }
  }
  function setPhaseIndex(index) {
    const total = phaseFrameCount();
    if (!total) return;
    state.phaseIndex = clamp(Math.round(Number(index) || 0), 0, total - 1);
    drawPhase();
  }
  function stopPhasePlay() {
    state.phasePlaying = false;
    if (state.phasePlayTimer) {
      clearInterval(state.phasePlayTimer);
      state.phasePlayTimer = 0;
    }
    syncPhaseControls();
  }
  function togglePhasePlay() {
    if (state.phasePlaying) {
      stopPhasePlay();
      return;
    }
    if (phaseFrameCount() < 2) return;
    state.phasePlaying = true;
    if (state.phaseIndex == null) state.phaseIndex = phaseFrameCount() - 1;
    state.phasePlayTimer = setInterval(() => {
      const total = phaseFrameCount();
      if (!total) {
        stopPhasePlay();
        return;
      }
      let next = (state.phaseIndex == null ? total - 1 : state.phaseIndex) + 1;
      if (next >= total) {
        if (!state.phaseLoop) {
          stopPhasePlay();
          return;
        }
        next = 0;
      }
      state.phaseIndex = next;
      drawPhase();
    }, 90);
    syncPhaseControls();
  }
  function instrumentPrefsKey() {
    return "netlab.instrument";
  }
  function loadInstrumentPrefs() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(instrumentPrefsKey()) || "null");
    } catch {
      data = null;
    }
    if (!data || typeof data !== "object") return;
    if (typeof data.meterKey === "string") state.instrument.meterKey = data.meterKey;
    if (Array.isArray(data.channels)) {
      state.instrument.channels = [0, 1, 2, 3].map((i) => typeof data.channels[i] === "string" ? data.channels[i] : null);
    }
    if (typeof data.lx === "string") state.instrument.lx = data.lx;
    if (typeof data.ly === "string") state.instrument.ly = data.ly;
    if (Number.isFinite(data.trail)) state.instrument.trail = clamp(Math.round(data.trail), 20, 4e3);
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
        window: state.instrument.window
      }));
    } catch {
    }
  }
  function instrumentFieldLabel(field) {
    const map = { voltage: "\u7535\u538B", current: "\u7535\u6D41", power: "\u529F\u7387", voltage_difference: "\u538B\u5DEE" };
    return map[field] || field || "\u503C";
  }
  function instrumentKeyLabel(key) {
    const parts = String(key || "").split(":");
    const field = parts.length > 1 ? parts[parts.length - 1] : "";
    const name = parts.length > 2 ? parts.slice(1, -1).join(":") : parts[1] || key;
    return `${name} \xB7 ${instrumentFieldLabel(field)}`;
  }
  function instrumentSelectGroups() {
    const groups = /* @__PURE__ */ new Map();
    for (const key of state.probeKeys) {
      const parts = String(key).split(":");
      const field = parts.length > 1 ? parts[parts.length - 1] : "";
      const name = parts.length > 2 ? parts.slice(1, -1).join(":") : parts[1] || key;
      const kind = parts[0] === "e" ? "\u5143\u4EF6" : "\u8282\u70B9";
      const label = `${kind}${instrumentFieldLabel(field)}`;
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push({ key, text: `${name} \xB7 ${instrumentFieldLabel(field)}` });
    }
    const order = ["\u8282\u70B9\u7535\u538B", "\u5143\u4EF6\u7535\u6D41", "\u5143\u4EF6\u538B\u5DEE", "\u5143\u4EF6\u7535\u538B", "\u5143\u4EF6\u529F\u7387"];
    return [...groups.entries()].sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0]);
    });
  }
  function fillInstrumentSelect(select, current, placeholder) {
    if (!select) return "";
    select.innerHTML = "";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = placeholder;
    select.appendChild(none);
    for (const [label, items] of instrumentSelectGroups()) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = label;
      for (const item of items) {
        const option = document.createElement("option");
        option.value = item.key;
        option.textContent = item.text;
        optgroup.appendChild(option);
      }
      select.appendChild(optgroup);
    }
    const wanted = current && state.probeKeys.includes(current) ? current : "";
    select.value = wanted;
    return select.value;
  }
  function fillInstrumentSelects() {
    if (!ui.instPane) return;
    const firstRun = !state.instrument.meterKey && !state.instrument.lx && !state.instrument.ly && state.instrument.channels.every((key) => !key);
    state.instrument.meterKey = fillInstrumentSelect(ui.instMeterKey, state.instrument.meterKey, "\u9009\u62E9\u7535\u538B / \u7535\u6D41\u4FE1\u53F7");
    state.instrument.channels = [0, 1, 2, 3].map((i) => fillInstrumentSelect(ui.instCh[i], state.instrument.channels[i], `CH${i + 1} \u672A\u63A5`) || null);
    state.instrument.lx = fillInstrumentSelect(ui.instLX, state.instrument.lx, "X \u672A\u63A5");
    state.instrument.ly = fillInstrumentSelect(ui.instLY, state.instrument.ly, "Y \u672A\u63A5");
    if (firstRun && state.probeKeys.length) {
      const volts = state.probeKeys.filter((key) => key.endsWith(":voltage"));
      const currents = state.probeKeys.filter((key) => key.endsWith(":current"));
      const ch1 = volts[0] || state.probeKeys[0];
      const ch2 = currents[0] || state.probeKeys[1] || "";
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
      const dot = ui.instCh[i]?.closest(".inst-ch")?.querySelector(".dot");
      if (!dot) return;
      dot.classList.toggle("on", Boolean(key));
      dot.style.color = key ? INST_COLORS[i] : "";
    });
    if (ui.instWindow) ui.instWindow.value = String(state.instrument.window);
    if (ui.instTrail) ui.instTrail.value = String(state.instrument.trail);
    saveInstrumentPrefs();
    scheduleChartDraw();
  }
  function instrumentFrames() {
    const all = state.replay.active ? state.frames.slice(0, state.replay.index + 1) : state.frames;
    const window2 = Math.max(0.1, Number(state.instrument.window) || 5);
    if (!all.length) return { frames: [], window: window2 };
    const last = all[all.length - 1].t;
    const start = last - window2;
    let from = all.length - 1;
    while (from > 0 && all[from - 1].t >= start) from -= 1;
    return { frames: all.slice(from), window: window2 };
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
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
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
  function instrumentSurface(context, canvas2, size, fill) {
    if (!context || !canvas2) return null;
    const { w, h, dpr } = size;
    if (w < 20 || h < 20) return null;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, w, h);
    context.fillStyle = C(fill);
    context.fillRect(0, 0, w, h);
    return { w, h };
  }
  function instrumentHint(context, w, h, text) {
    context.fillStyle = C("#969083");
    context.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, w / 2, h / 2);
  }
  function renderInstrumentMeter(frames) {
    const key = state.instrument.meterKey;
    const stats = key ? instrumentStats(frames, key) : null;
    const put = (element, text) => {
      if (element) element.textContent = text;
    };
    if (!stats) {
      put(ui.instValNow, "\u2014");
      put(ui.instValMean, "\u2014");
      put(ui.instValRms, "\u2014");
      put(ui.instValPP, "\u2014");
      put(ui.instValMinMax, "\u2014");
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
    ui.instLegend.innerHTML = "";
    state.instrument.channels.forEach((key, index) => {
      if (!key) return;
      const stats = instrumentStats(frames, key);
      const item = document.createElement("div");
      item.className = "legend-item";
      const dot = document.createElement("i");
      dot.className = "legend-dot";
      dot.style.background = INST_COLORS[index];
      const name = document.createElement("span");
      name.className = "legend-name";
      name.textContent = `CH${index + 1} ${instrumentKeyLabel(key)}`;
      const value = document.createElement("em");
      value.className = "legend-value";
      value.textContent = stats ? fmt(stats.last, 4) : "\u2014";
      item.append(dot, name, value);
      ui.instLegend.appendChild(item);
    });
  }
  function drawScope(frames, window2) {
    const surface = instrumentSurface(scopeCtx, scopeCanvas, state.instrument.scopeSize, "#faf8f2");
    if (!surface) return;
    const { w, h } = surface;
    const left = 46;
    const right = 12;
    const top = 12;
    const bottom = 20;
    const plotW = Math.max(10, w - left - right);
    const plotH = Math.max(10, h - top - bottom);
    scopeCtx.strokeStyle = C("#e7e2d7");
    scopeCtx.lineWidth = 1;
    scopeCtx.beginPath();
    for (let i = 0; i <= 4; i += 1) {
      const y = top + plotH * i / 4 + 0.5;
      scopeCtx.moveTo(left, y);
      scopeCtx.lineTo(left + plotW, y);
    }
    for (let i = 0; i <= 4; i += 1) {
      const x = left + plotW * i / 4 + 0.5;
      scopeCtx.moveTo(x, top);
      scopeCtx.lineTo(x, top + plotH);
    }
    scopeCtx.stroke();
    const channels = state.instrument.channels.map((key, index) => ({ key, index })).filter((entry) => entry.key && state.probeKeys.includes(entry.key));
    if (!frames.length || !channels.length) {
      instrumentHint(
        scopeCtx,
        w,
        h,
        channels.length ? "\u8FD0\u884C\u4EFF\u771F\u540E\u663E\u793A\u6CE2\u5F62" : "\u7ED9 CH1\u2013CH4 \u63A5\u4E0A\u4FE1\u53F7"
      );
      renderInstrumentLegend([]);
      return;
    }
    const last = frames[frames.length - 1].t;
    const start = Math.max(frames[0].t, last - Math.max(0.1, window2));
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
    const yOf = (v) => top + plotH / 2 - v / amp * (plotH / 2);
    scopeCtx.strokeStyle = C("#c9c2b4");
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
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
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
    scopeCtx.fillStyle = C("#969083");
    scopeCtx.font = '9px "Segoe UI", "Microsoft YaHei", sans-serif';
    scopeCtx.textAlign = "right";
    scopeCtx.textBaseline = "middle";
    scopeCtx.fillText(fmt(amp, 2), left - 5, top + 6);
    scopeCtx.fillText("0", left - 5, top + plotH / 2);
    scopeCtx.fillText(fmt(-amp, 2), left - 5, top + plotH - 6);
    scopeCtx.textBaseline = "top";
    scopeCtx.textAlign = "left";
    scopeCtx.fillText(`${fmt(start, 3)} s`, left, top + plotH + 4);
    scopeCtx.textAlign = "right";
    scopeCtx.fillText(`${fmt(last, 3)} s`, left + plotW, top + plotH + 4);
    renderInstrumentLegend(frames);
  }
  function drawLissajous(frames) {
    const surface = instrumentSurface(lissCtx, lissCanvas, state.instrument.lissSize, "#faf8f2");
    if (!surface) return;
    const { w, h } = surface;
    const pad = 14;
    lissCtx.strokeStyle = C("#e7e2d7");
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
      instrumentHint(lissCtx, w, h, ready ? "\u8FD0\u884C\u4EFF\u771F\u540E\u663E\u793A\u674E\u8428\u5982\u56FE" : "\u9009\u62E9 X / Y \u4E24\u8DEF\u4FE1\u53F7");
      return;
    }
    const trail = clamp(Math.round(Number(state.instrument.trail) || 600), 20, 4e3);
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
    const xOf = (v) => w / 2 + v / amp * (size / 2);
    const yOf = (v) => h / 2 - v / amp * (size / 2);
    lissCtx.strokeStyle = C("#c2542f");
    lissCtx.lineWidth = 1.2;
    lissCtx.beginPath();
    let started = false;
    let tail = null;
    for (const frame of slice) {
      const x = frame.v?.[xKey];
      const y = frame.v?.[yKey];
      if (typeof x !== "number" || typeof y !== "number") continue;
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
      lissCtx.fillStyle = C("#c2542f");
      lissCtx.beginPath();
      lissCtx.arc(tail.x, tail.y, 2.5, 0, Math.PI * 2);
      lissCtx.fill();
    }
    lissCtx.fillStyle = C("#969083");
    lissCtx.font = '9px "Segoe UI", "Microsoft YaHei", sans-serif';
    lissCtx.textAlign = "left";
    lissCtx.textBaseline = "top";
    lissCtx.fillText(`X ${xKey.split(":").slice(1, -1).join(":")}`, pad, pad - 10 + 0.5);
    lissCtx.textBaseline = "bottom";
    lissCtx.fillText(`Y ${yKey.split(":").slice(1, -1).join(":")}`, pad, h - 1);
  }
  function drawInstruments() {
    if (activeTab() !== "inst") return;
    const { frames, window: window2 } = instrumentFrames();
    renderInstrumentMeter(frames);
    drawScope(frames, window2);
    drawLissajous(frames);
    if (ui.instStatus) {
      if (frames.length) {
        ui.instStatus.textContent = `${frames.length} \u5E27 \xB7 \u7A97\u53E3 ${fmt(window2, 2)} s${state.replay.active ? " \xB7 \u56DE\u653E\u4E2D" : ""}`;
      } else {
        ui.instStatus.textContent = state.sim?.running ? "\u7B49\u5F85\u91C7\u96C6\u4E2D\u2026" : "\u8FD0\u884C\u4EFF\u771F\u540E\u663E\u793A\u8BFB\u6570\u4E0E\u6CE2\u5F62";
      }
    }
  }
  function resizeInstrument() {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    for (const [target, key] of [[scopeCanvas, "scopeSize"], [lissCanvas, "lissSize"]]) {
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
    bind(ui.instMeterKey, "change", () => {
      state.instrument.meterKey = ui.instMeterKey.value || "";
      saveInstrumentPrefs();
      scheduleChartDraw();
    });
    ui.instCh.forEach((select, index) => {
      bind(select, "change", () => {
        state.instrument.channels[index] = select.value || null;
        const dot = select.closest(".inst-ch")?.querySelector(".dot");
        if (dot) {
          dot.classList.toggle("on", Boolean(select.value));
          dot.style.color = select.value ? INST_COLORS[index] : "";
        }
        saveInstrumentPrefs();
        scheduleChartDraw();
      });
    });
    bind(ui.instLX, "change", () => {
      state.instrument.lx = ui.instLX.value || "";
      saveInstrumentPrefs();
      scheduleChartDraw();
    });
    bind(ui.instLY, "change", () => {
      state.instrument.ly = ui.instLY.value || "";
      saveInstrumentPrefs();
      scheduleChartDraw();
    });
    bind(ui.instWindow, "input", () => {
      state.instrument.window = clamp(Number(ui.instWindow.value) || 5, 0.1, 120);
      saveInstrumentPrefs();
      scheduleChartDraw();
    });
    bind(ui.instTrail, "input", () => {
      state.instrument.trail = clamp(Math.round(Number(ui.instTrail.value) || 600), 20, 4e3);
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
    if (activeTab() !== "chart") return;
    const { w, h, dpr } = state.chartSize;
    if (w < 20 || h < 20) return;
    chartCanvas.dataset.renderSize = `${w}x${h}@${dpr}`;
    chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    chartCtx.clearRect(0, 0, w, h);
    chartCtx.fillStyle = C("#faf8f2");
    chartCtx.fillRect(0, 0, w, h);
    const keys = Array.from(state.chart.selected);
    const frames = state.replay.active ? state.frames.slice(0, state.replay.index + 1) : state.frames;
    if (!keys.length || !frames.length) {
      chartCtx.fillStyle = C("#969083");
      chartCtx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
      chartCtx.textAlign = "center";
      chartCtx.textBaseline = "middle";
      chartCtx.fillText(frames.length ? "\u5728\u4FE1\u53F7\u5217\u8868\u91CC\u52FE\u9009\u8981\u7ED8\u5236\u7684\u4FE1\u53F7" : "\u8FD0\u884C\u4EFF\u771F\u540E\u81EA\u52A8\u91C7\u96C6\u8F68\u8FF9", w / 2, h / 2);
      return;
    }
    const left = 54;
    const right = 14;
    const top = 14;
    const bottom = 24;
    const plotW = Math.max(10, w - left - right);
    const plotH = Math.max(10, h - top - bottom);
    const window2 = Math.max(0.1, Number(state.chart.window) || 5);
    const tMax = frames[frames.length - 1].t;
    const tMin = Math.max(0, tMax - window2);
    const spanT = Math.max(1e-9, tMax - tMin);
    let startAt = 0;
    {
      let lo = 0;
      let hi = frames.length;
      while (lo < hi) {
        const mid = lo + hi >> 1;
        if (frames[mid].t < tMin) lo = mid + 1;
        else hi = mid;
      }
      startAt = lo;
    }
    const visibleCount = frames.length - startAt;
    const stride = visibleCount > plotW * 4 ? Math.ceil(visibleCount / (plotW * 4)) : 1;
    const lastFrame = frames[frames.length - 1];
    const series = [];
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const key of keys) {
      const color = colorForKey(key);
      const points = [];
      for (let i = startAt; i < frames.length; i += stride) {
        const frame = frames[i];
        const value = frame.v[key];
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        points.push({ t: frame.t, v: value });
        if (value < yMin) yMin = value;
        if (value > yMax) yMax = value;
      }
      if (lastFrame && lastFrame.t >= tMin && lastFrame.v && typeof lastFrame.v[key] === "number" && Number.isFinite(lastFrame.v[key]) && (!points.length || points[points.length - 1].t !== lastFrame.t)) {
        const lastV = lastFrame.v[key];
        points.push({ t: lastFrame.t, v: lastV });
        if (lastV < yMin) yMin = lastV;
        if (lastV > yMax) yMax = lastV;
      }
      series.push({ key, color, points });
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      chartCtx.fillStyle = C("#969083");
      chartCtx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
      chartCtx.textAlign = "center";
      chartCtx.fillText("\u6240\u9009\u4FE1\u53F7\u5728\u65F6\u95F4\u7A97\u5185\u6CA1\u6709\u6570\u503C", w / 2, h / 2);
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
    const xOf = (t) => left + (t - tMin) / spanT * plotW;
    const yOf = (v) => top + (1 - (v - yMin) / spanY) * plotH;
    chartCtx.font = '10px "Cascadia Code", Consolas, monospace';
    chartCtx.lineWidth = 1;
    chartCtx.textBaseline = "middle";
    for (let index = 0; index <= 4; index += 1) {
      const y = top + plotH * index / 4;
      chartCtx.strokeStyle = index === 4 ? "#c0b6a5" : "#e7e1d5";
      chartCtx.beginPath();
      chartCtx.moveTo(left, Math.round(y) + 0.5);
      chartCtx.lineTo(left + plotW, Math.round(y) + 0.5);
      chartCtx.stroke();
      chartCtx.fillStyle = C("#8b8376");
      chartCtx.textAlign = "right";
      chartCtx.fillText(fmt(yMax - spanY * index / 4, 3), left - 8, y);
    }
    for (let index = 0; index <= 4; index += 1) {
      const x = left + plotW * index / 4;
      chartCtx.strokeStyle = index === 0 ? "#c0b6a5" : "#e7e1d5";
      chartCtx.beginPath();
      chartCtx.moveTo(Math.round(x) + 0.5, top);
      chartCtx.lineTo(Math.round(x) + 0.5, top + plotH);
      chartCtx.stroke();
      chartCtx.fillStyle = C("#8b8376");
      chartCtx.textAlign = index === 0 ? "left" : index === 4 ? "right" : "center";
      const tick = tMin + spanT * index / 4;
      const decimals = spanT >= 10 ? 1 : spanT >= 1 ? 2 : spanT >= 0.1 ? 3 : spanT >= 0.01 ? 4 : 5;
      chartCtx.fillText(`${tick.toFixed(decimals)}s`, x, top + plotH + 12);
    }
    chartCtx.save();
    chartCtx.beginPath();
    chartCtx.rect(left, top, plotW, plotH);
    chartCtx.clip();
    chartCtx.lineJoin = "round";
    chartCtx.lineCap = "round";
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
      const t = tMin + (hover.x - left) / plotW * spanT;
      const frame = nearestFrame(t);
      if (frame) {
        const hx = xOf(frame.t);
        chartCtx.strokeStyle = C("rgba(168, 84, 31, .45)");
        chartCtx.lineWidth = 1;
        chartCtx.setLineDash([3, 3]);
        chartCtx.beginPath();
        chartCtx.moveTo(hx, top);
        chartCtx.lineTo(hx, top + plotH);
        chartCtx.stroke();
        chartCtx.setLineDash([]);
        for (const item of series) {
          const value = frame.v[item.key];
          if (typeof value !== "number" || !Number.isFinite(value)) continue;
          chartCtx.beginPath();
          chartCtx.arc(hx, yOf(value), 2.8, 0, Math.PI * 2);
          chartCtx.fillStyle = item.color;
          chartCtx.fill();
        }
        const rows = series.filter((item) => typeof frame.v[item.key] === "number" && Number.isFinite(frame.v[item.key])).slice(0, 5).map((item) => `${decodeProbeKey(item.key).label}  ${fmt(frame.v[item.key], 4)}`);
        const lines = [`t = ${fmt(frame.t, 4)} s`, ...rows];
        chartCtx.font = '10px "Cascadia Code", Consolas, monospace';
        let boxW = 0;
        for (const line of lines) boxW = Math.max(boxW, chartCtx.measureText(line).width);
        boxW += 16;
        const boxH = lines.length * 15 + 10;
        const boxX = clamp(hx + 12, left + 4, left + plotW - boxW - 4);
        const boxY = clamp(top + 6, top + 4, top + plotH - boxH - 4);
        chartCtx.fillStyle = "rgba(250, 248, 242, .97)";
        chartCtx.strokeStyle = C("#bcb3a1");
        chartCtx.lineWidth = 1;
        roundRectPath(chartCtx, boxX, boxY, boxW, boxH, 6);
        chartCtx.fill();
        chartCtx.stroke();
        chartCtx.textAlign = "left";
        chartCtx.textBaseline = "top";
        lines.forEach((line, index) => {
          chartCtx.fillStyle = index === 0 ? C("#a8541f") : "#5f584e";
          chartCtx.fillText(line, boxX + 8, boxY + 6 + index * 15);
        });
      }
    }
    chartCtx.restore();
  }
  function setWorkspaceButtons() {
    if (!ui.workspaceSwitch) return;
    $$("button[data-workspace]", ui.workspaceSwitch).forEach((item) => {
      item.classList.toggle("active", item.dataset.workspace === state.workspace);
    });
  }
  function syncFemChrome() {
    const fem = state.fem;
    if (!fem) return;
    updateRunButton(Boolean(fem.running));
    ui.simTime.textContent = fmt(fem.time ?? 0, 3);
    ui.simFps.textContent = String(Math.round(fem.actual_fps ?? 0));
    ui.simSteps.textContent = intText(fem.steps ?? 0);
    ui.simFps.title = `\u76EE\u6807 ${fem.config?.fps ?? "\u2014"} fps \xB7 \u5B9E\u9645 ${(fem.actual_fps ?? 0).toFixed(1)}`;
    const stats = fem.stats || {};
    ui.statusMode.textContent = "\u6709\u9650\u5143\u573A";
    ui.statusEngine.textContent = `Q4 \xB7 ${stats.dof || 0} DOF`;
    let hint = fem.running ? "\u8FD0\u884C\u4E2D" : "\u5DF2\u6682\u505C";
    if (fem.config) {
      hint += ` \xB7 ${fem.config.fps} fps \xD7 ${fem.config.steps_per_frame} \u6B65 \xB7 dt ${fmt(fem.config.dt, 4)}`;
    }
    ui.statusHint.textContent = hint;
    ui.statusLimits.textContent = `\u8282\u70B9 ${stats.nodes || 0} \xB7 \u5355\u5143 ${stats.elements || 0}`;
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
      const snapshot = await api("/api/fem/state");
      applyFemSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      toast(`\u6709\u9650\u5143\u573A\u52A0\u8F7D\u5931\u8D25\uFF1A${error.message}`, "error", 7e3);
      return null;
    }
  }
  async function switchWorkspace(name) {
    if (name === state.workspace) return;
    if (name === "fem") {
      if (state.sim?.running) await networkControl("pause");
      state.workspace = "fem";
      document.body.classList.add("workspace-fem");
      ui.main.classList.add("fem-mode");
      ui.femStage.classList.remove("hidden");
      ui.panel.classList.remove("collapsed");
      ui.main.classList.remove("panel-hidden");
      ui.panel.classList.add("field-mode");
      setWorkspaceButtons();
      switchTab("fem");
      await ensureFemState();
      renderFemPanel();
      resizeFem();
      updateFemPanelValues();
      drawFem();
      syncFemChrome();
    } else {
      if (state.fem?.running) await femControl("pause");
      state.workspace = "network";
      document.body.classList.remove("workspace-fem");
      ui.main.classList.remove("fem-mode");
      ui.femStage.classList.add("hidden");
      ui.panel.classList.remove("field-mode");
      setWorkspaceButtons();
      switchTab("inspect");
      resizeGraph();
      resizeChart();
      syncUI();
      requestDraw();
    }
  }
  async function femControl(action, steps) {
    const body = { action };
    if (steps !== void 0) body.steps = steps;
    const response = await task(() => jsonRequest("/api/fem/control", "POST", body), { dirty: false });
    if (!response) return;
    if (action === "reset") {
      await ensureFemState(true);
      state.femStarted = false;
    } else if (response.fem && state.fem) {
      state.fem = Object.assign({}, state.fem, response.fem);
    }
    syncFemChrome();
    drawFem();
    if (action === "step" || action === "reset") await pollFem();
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
    if (state.workspace === "fem") drawFem();
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
      y0: padTop + Math.max(0, (h - padTop - padBottom - size) / 2)
    };
  }
  function femColor(value, minimum, maximum) {
    const span = Math.max(1e-9, maximum - minimum);
    const t = clamp((value - minimum) / span, 0, 1);
    const stops = [
      [0, [247, 244, 236]],
      [0.22, [236, 223, 204]],
      [0.45, [214, 169, 132]],
      [0.68, [184, 111, 70]],
      [0.86, [139, 57, 32]],
      [1, [59, 18, 10]]
    ];
    for (let index = 1; index < stops.length; index += 1) {
      if (t <= stops[index][0]) {
        const [t0, c0] = stops[index - 1];
        const [t1, c1] = stops[index];
        const ratio = (t - t0) / Math.max(1e-9, t1 - t0);
        return `rgb(${Math.round(c0[0] + (c1[0] - c0[0]) * ratio)},${Math.round(c0[1] + (c1[1] - c0[1]) * ratio)},${Math.round(c0[2] + (c1[2] - c0[2]) * ratio)})`;
      }
    }
    return "rgb(59, 18, 10)";
  }
  function femHoverFromPoint(x, y) {
    if (!state.femMesh || !state.fem) return null;
    const { w, h } = state.femSize;
    const { size, x0, y0 } = femLayout(w, h);
    if (x < x0 || x > x0 + size || y < y0 || y > y0 + size) return null;
    const mesh = state.femMesh;
    const nx = mesh.nx;
    const ny = mesh.ny;
    const i = clamp(Math.round((x - x0) / size * nx), 0, nx);
    const j = clamp(Math.round((1 - (y - y0) / size) * ny), 0, ny);
    const index = j * (nx + 1) + i;
    const value = state.fem.field?.[index];
    if (typeof value !== "number") return null;
    return {
      x,
      y,
      i,
      j,
      index,
      value,
      sx: x0 + i / nx * size,
      sy: y0 + (1 - j / ny) * size
    };
  }
  function drawFem() {
    if (!ui.femStage || state.workspace !== "fem") return;
    const { w, h, dpr } = state.femSize;
    if (w < 20 || h < 20) return;
    femCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    femCtx.clearRect(0, 0, w, h);
    femCtx.fillStyle = C("#f2efe7");
    femCtx.fillRect(0, 0, w, h);
    if (!state.fem || !state.femMesh) {
      femCtx.fillStyle = C("#969083");
      femCtx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
      femCtx.textAlign = "center";
      femCtx.textBaseline = "middle";
      femCtx.fillText("\u6709\u9650\u5143\u573A\u5C1A\u672A\u521D\u59CB\u5316", w / 2, h / 2);
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
      if (![t0, t1, t2, t3].every((value) => typeof value === "number")) continue;
      const ex = x0 + mesh.x[n0] * size;
      const eyTop = y0 + (1 - mesh.y[n2]) * size;
      for (let sy = 0; sy < sub; sy += 1) {
        const v = 1 - (sy + 0.5) / sub;
        for (let sx = 0; sx < sub; sx += 1) {
          const u = (sx + 0.5) / sub;
          const temp = (1 - u) * (1 - v) * t0 + u * (1 - v) * t1 + u * v * t2 + (1 - u) * v * t3;
          femCtx.fillStyle = femColor(temp, minimum, maximum);
          femCtx.fillRect(
            ex + sx * cellW / sub,
            eyTop + sy * cellH / sub,
            cellW / sub + 0.6,
            cellH / sub + 0.6
          );
        }
      }
    }
    femCtx.strokeStyle = "rgba(17, 16, 14, 0.12)";
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
    femCtx.strokeStyle = C("#11100e");
    femCtx.lineWidth = 1.2;
    femCtx.strokeRect(x0, y0, size, size);
    femCtx.strokeStyle = C("#a8541f");
    femCtx.lineWidth = 2.2;
    femCtx.beginPath();
    femCtx.moveTo(x0 + 0.5, y0);
    femCtx.lineTo(x0 + 0.5, y0 + size);
    femCtx.moveTo(x0 + size - 0.5, y0);
    femCtx.lineTo(x0 + size - 0.5, y0 + size);
    femCtx.stroke();
    femCtx.fillStyle = C("#6f695f");
    femCtx.font = '8px "Cascadia Code", Consolas, monospace';
    femCtx.textAlign = "left";
    femCtx.textBaseline = "top";
    femCtx.fillText(`DIRICHLET ${fmt(config.boundary_left, 0)} \xB0C`, x0, y0 + size + 12);
    femCtx.textAlign = "right";
    femCtx.fillText(`DIRICHLET ${fmt(config.boundary_right, 0)} \xB0C`, x0 + size, y0 + size + 12);
    const sourceY = 0.5 + 0.22 * Math.sin(2 * Math.PI * 0.055 * (state.fem.time || 0) + 0.6);
    const sourceX = Number(config.source_x ?? 0.35);
    const sourceScreenX = x0 + sourceX * size;
    const sourceScreenY = y0 + (1 - sourceY) * size;
    const sourceRadius = Math.max(8, Number(config.source_sigma || 0.09) * size * 2.2);
    femCtx.strokeStyle = C("rgba(168, 84, 31, 0.85)");
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
    femCtx.fillStyle = C("#a8541f");
    femCtx.font = '8px "Cascadia Code", Consolas, monospace';
    femCtx.textAlign = "left";
    femCtx.textBaseline = "top";
    femCtx.fillText("HEAT", sourceScreenX + sourceRadius + 3, sourceScreenY - 4);
    const barX = x0 + size + 22;
    const barY = y0 + 6;
    const barW = 9;
    const barH = size - 12;
    const gradient = femCtx.createLinearGradient(0, barY, 0, barY + barH);
    for (let index = 0; index <= 10; index += 1) {
      gradient.addColorStop(1 - index / 10, femColor(minimum + (maximum - minimum) * index / 10, minimum, maximum));
    }
    femCtx.fillStyle = gradient;
    femCtx.fillRect(barX, barY, barW, barH);
    femCtx.strokeStyle = C("#bcb3a1");
    femCtx.lineWidth = 1;
    femCtx.strokeRect(barX, barY, barW, barH);
    femCtx.fillStyle = C("#6f695f");
    femCtx.font = '8px "Cascadia Code", Consolas, monospace';
    femCtx.textAlign = "center";
    femCtx.textBaseline = "bottom";
    femCtx.fillText("T / \xB0C", barX + barW / 2, barY - 4);
    femCtx.textAlign = "left";
    femCtx.textBaseline = "middle";
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
    femCtx.fillStyle = C("#6f695f");
    femCtx.font = '8px "Cascadia Code", Consolas, monospace';
    femCtx.textAlign = "right";
    femCtx.textBaseline = "top";
    femCtx.fillText(`t=${fmt(state.fem.time, 4)} s \xB7 solve ${fmt(stats.solve_ms, 2)} ms`, x0 + size, y0 - 24);
    const hover = state.femHover;
    if (hover) {
      femCtx.strokeStyle = C("#11100e");
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
      const label = `T ${fmt(hover.value, 2)} \xB0C \xB7 (${hover.i},${hover.j})`;
      femCtx.font = '9px "Cascadia Code", Consolas, monospace';
      const textWidth = femCtx.measureText(label).width;
      const labelX = clamp(hover.sx + 12, x0, x0 + size - textWidth - 10);
      const labelY = clamp(hover.sy - 20, y0, y0 + size - 18);
      femCtx.fillStyle = "rgba(250, 248, 242, .95)";
      femCtx.fillRect(labelX - 4, labelY - 2, textWidth + 8, 15);
      femCtx.fillStyle = C("#11100e");
      femCtx.textAlign = "left";
      femCtx.textBaseline = "top";
      femCtx.fillText(label, labelX, labelY);
      ui.femHudProbe.textContent = `T=${fmt(hover.value, 3)} \xB0C \xB7 node (${hover.i}, ${hover.j})`;
    } else {
      ui.femHudProbe.textContent = `Tmax=${fmt(maximum, 2)} \xB0C \xB7 Tmin=${fmt(minimum, 2)} \xB0C \xB7 mean=${fmt(stats.mean, 2)} \xB0C`;
    }
  }
  function readFemConfig() {
    const read = (key) => {
      const input = $(`[data-fem="${key}"]`, ui.femPanel);
      return input ? Number(input.value) : NaN;
    };
    const config = {
      nx: read("nx"),
      ny: read("ny"),
      dt: read("dt"),
      fps: read("fps"),
      steps_per_frame: read("steps"),
      sample_every: read("sample"),
      conductivity: read("conductivity"),
      capacity: read("capacity"),
      source_amplitude: read("source_amplitude"),
      source_frequency: read("source_frequency"),
      source_sigma: read("source_sigma"),
      source_x: read("source_x"),
      boundary_left: read("boundary_left"),
      boundary_right: read("boundary_right"),
      initial_temperature: read("initial_temperature")
    };
    for (const [key, value] of Object.entries(config)) {
      if (!Number.isFinite(value)) throw new Error(`\u6709\u9650\u5143\u53C2\u6570 ${key} \u4E0D\u662F\u6709\u6548\u6570\u5B57`);
    }
    if (!Number.isInteger(config.nx) || config.nx < 6 || config.nx > 80) throw new Error("\u7F51\u683C nx \u5FC5\u987B\u662F 6\u201380 \u7684\u6574\u6570");
    if (!Number.isInteger(config.ny) || config.ny < 6 || config.ny > 60) throw new Error("\u7F51\u683C ny \u5FC5\u987B\u662F 6\u201360 \u7684\u6574\u6570");
    if ((config.nx + 1) * (config.ny + 1) > 6e3) throw new Error("\u8282\u70B9\u6570\u4E0D\u80FD\u8D85\u8FC7 6000");
    if (!(config.dt > 0)) throw new Error("dt \u5FC5\u987B\u5927\u4E8E 0");
    if (config.dt * config.steps_per_frame > 2) throw new Error("\u6BCF\u5E27\u63A8\u8FDB\u65F6\u95F4\u8FC7\u5927\uFF0C\u8BF7\u51CF\u5C0F dt \u6216\u6B65\u6570");
    return config;
  }
  async function applyFemConfig() {
    let payload;
    try {
      payload = readFemConfig();
    } catch (error) {
      toast(error.message, "error", 6e3);
      return;
    }
    const response = await task(() => jsonRequest("/api/fem/config", "PATCH", payload));
    if (!response) return;
    applyFemSnapshot(response.fem);
    renderFemPanel();
    toast("\u6709\u9650\u5143\u53C2\u6570\u5DF2\u91CD\u5EFA", "ok", 2e3);
  }
  function renderFemPanel() {
    if (!ui.femPanel || ui.femPanel.dataset.ready === "1") return;
    ui.femPanel.replaceChildren();
    ui.femPanel.dataset.ready = "1";
    const head = div("fem-head");
    head.appendChild(el("h2", null, "FIELD \xB7 Q4 FEM"));
    head.appendChild(el("p", null, "\u4E8C\u7EF4\u77AC\u6001\u70ED\u4F20\u5BFC\uFF1A\u5355\u4F4D\u65B9\u677F\u3001Q4 \u53CC\u7EBF\u6027\u5355\u5143\u3001\u540E\u5411\u6B27\u62C9\uFF1B\u5DE6\u53F3 Dirichlet\uFF0C\u4E0A\u4E0B\u7EDD\u7F18\uFF0C\u9AD8\u65AF\u70ED\u6E90\u968F\u65F6\u95F4\u6446\u52A8\u3002"));
    ui.femPanel.appendChild(head);
    const intro = div("fem-note");
    intro.textContent = "\u5F31\u5F62\u5F0F\u88C5\u914D\u540E\u4F7F\u7528\u7A00\u758F LU \u4E00\u6B21\u5206\u89E3\u3001\u6BCF\u6B65\u56DE\u4EE3\u3002\u8272\u6807\u4ECE\u51B7\u7EB8\u8272\u8FC7\u6E21\u5230\u94DC\u8272\uFF0C\u9ED1\u8272\u7F51\u683C\u4E3A\u5B9E\u9645\u6709\u9650\u5143\u5355\u5143\u3002";
    ui.femPanel.appendChild(intro);
    const configSection = section("\u573A\u53C2\u6570", "\u91CD\u5EFA\u7F51\u683C\u4F1A\u91CD\u7F6E\u65F6\u95F4");
    const grid = div("fem-grid");
    const fields = [
      ["nx", "\u7F51\u683C nx", 36, 6, 80, 1],
      ["ny", "\u7F51\u683C ny", 24, 6, 60, 1],
      ["dt", "\u65F6\u95F4\u6B65 dt", 2e-3, 1e-5, 0.1, 1e-4],
      ["fps", "\u5E27\u7387 fps", 30, 1, 120, 1],
      ["steps", "\u6BCF\u5E27\u6B65\u6570", 8, 1, 50, 1],
      ["sample", "\u91C7\u6837\u95F4\u9694", 1, 1, 20, 1],
      ["conductivity", "\u5BFC\u70ED k", 1, 1e-4, 1e3, 0.1],
      ["capacity", "\u70ED\u5BB9 \u03C1c", 1, 1e-4, 1e3, 0.1],
      ["source_amplitude", "\u70ED\u6E90\u5E45\u503C", 5e3, 0, 1e6, 100],
      ["source_frequency", "\u70ED\u6E90\u9891\u7387", 0.08, 0, 20, 0.01],
      ["source_sigma", "\u70ED\u6E90\u534A\u5F84", 0.09, 0.02, 0.5, 0.01],
      ["source_x", "\u70ED\u6E90 x", 0.35, 0.05, 0.95, 0.01],
      ["boundary_left", "\u5DE6\u8FB9\u754C \xB0C", 20, -500, 1e3, 1],
      ["boundary_right", "\u53F3\u8FB9\u754C \xB0C", 20, -500, 1e3, 1],
      ["initial_temperature", "\u521D\u59CB\u6E29\u5EA6", 20, -500, 1e3, 1]
    ];
    for (const [key, labelText, value, minimum, maximum, step] of fields) {
      const input = numberInput(value, { min: minimum, max: maximum, step });
      input.dataset.fem = key;
      grid.appendChild(fieldFor(labelText, "", input));
    }
    configSection.appendChild(grid);
    const actions = div("fem-actions");
    actions.appendChild(button("\u5E94\u7528\u573A\u53C2\u6570", "btn primary", () => void applyFemConfig()));
    actions.appendChild(button("\u91CD\u7F6E\u573A", "btn", () => void femControl("reset")));
    configSection.appendChild(actions);
    ui.femPanel.appendChild(configSection);
    const statsSection = section("\u6C42\u89E3\u7EDF\u8BA1", "\u6BCF\u5E27\u66F4\u65B0");
    const statsGrid = div("fem-stats");
    for (const [key, labelText] of [
      ["dof", "\u81EA\u7531\u5EA6"],
      ["elements", "\u5355\u5143"],
      ["solve", "\u6C42\u89E3 ms"],
      ["min", "T min"],
      ["max", "T max"],
      ["mean", "T mean"]
    ]) {
      const stat = div("stat");
      stat.appendChild(el("span", null, labelText));
      const value = el("b", null, "\u2014");
      value.dataset.femstat = key;
      stat.appendChild(value);
      statsGrid.appendChild(stat);
    }
    statsSection.appendChild(statsGrid);
    const probe = div("fem-probe");
    probe.dataset.role = "fem-probe";
    probe.textContent = "\u628A\u9F20\u6807\u79FB\u52A8\u5230\u8272\u573A\u4E0A\u8BFB\u53D6\u8282\u70B9\u6E29\u5EA6\u3002";
    statsSection.appendChild(probe);
    ui.femPanel.appendChild(statsSection);
    const note = div("fem-note");
    note.textContent = "\u63D0\u793A\uFF1A\u63D0\u9AD8 nx / ny \u53EF\u4EE5\u770B\u5230\u66F4\u7EC6\u7684\u7F51\u683C\uFF1B\u589E\u5927\u70ED\u6E90\u5E45\u503C\u6216\u964D\u4F4E\u5BFC\u70ED\u7CFB\u6570\u4F1A\u8BA9\u6E29\u5DEE\u66F4\u660E\u663E\u3002";
    ui.femPanel.appendChild(note);
    updateFemPanelValues();
  }
  function updateFemPanelValues() {
    if (!ui.femPanel || ui.femPanel.dataset.ready !== "1" || !state.fem) return;
    const config = state.fem.config || {};
    const setValue = (key, value) => {
      const input = $(`[data-fem="${key}"]`, ui.femPanel);
      if (!input || document.activeElement === input) return;
      input.value = String(value);
    };
    setValue("nx", config.nx);
    setValue("ny", config.ny);
    setValue("dt", config.dt);
    setValue("fps", config.fps);
    setValue("steps", config.steps_per_frame);
    setValue("sample", config.sample_every);
    setValue("conductivity", config.conductivity);
    setValue("capacity", config.capacity);
    setValue("source_amplitude", config.source_amplitude);
    setValue("source_frequency", config.source_frequency);
    setValue("source_sigma", config.source_sigma);
    setValue("source_x", config.source_x);
    setValue("boundary_left", config.boundary_left);
    setValue("boundary_right", config.boundary_right);
    setValue("initial_temperature", config.initial_temperature);
    const stats = state.fem.stats || {};
    const setStat2 = (key, value) => {
      const node = $(`[data-femstat="${key}"]`, ui.femPanel);
      if (node) node.textContent = value;
    };
    setStat2("dof", String(stats.dof ?? "\u2014"));
    setStat2("elements", String(stats.elements ?? "\u2014"));
    setStat2("solve", fmt(stats.solve_ms, 2));
    setStat2("min", fmt(stats.min, 2));
    setStat2("max", fmt(stats.max, 2));
    setStat2("mean", fmt(stats.mean, 2));
    const probe = $('[data-role="fem-probe"]', ui.femPanel);
    if (probe && !state.femHover) {
      probe.textContent = `\u4E2D\u5FC3\u6E29\u5EA6 ${fmt(stats.mean, 3)} \xB0C \xB7 \u7F51\u683C ${config.nx}\xD7${config.ny} \xB7 ${stats.elements || 0} \u4E2A Q4 \u5355\u5143`;
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
      if (now - (state.lastLiveError || 0) > 8e3) {
        state.lastLiveError = now;
        toast(`\u6709\u9650\u5143\u5B9E\u65F6\u6570\u636E\u5931\u8D25\uFF1A${error.message}`, "error", 5e3);
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
        data.sim && (Number(data.cursor || 0) < previousCursor || Number(data.sim.steps || 0) < previousSteps)
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
        const cap = frameCap();
        if (state.frames.length > cap) {
          state.frames.splice(0, state.frames.length - cap);
        }
      }
      const gotFrames = Boolean(Array.isArray(data.frames) && data.frames.length);
      if (typeof data.cursor === "number") state.cursor = data.cursor;
      if (data.sim) state.sim = data.sim;
      if (gotFrames || resetDetected) {
        updateSignalKeyCache();
        syncUI();
        updateReplayUI();
        if (ui.inspector?.offsetParent !== null) updateInspectorLive();
        if (ui.signalList?.offsetParent !== null) updateSignalListValues();
        if (activeTab() === "chart") updateLegendValues();
        scheduleChartDraw();
      } else {
        syncUI();
      }
      if (resetDetected) void refreshState(true);
    } catch (error) {
      const now = performance.now();
      if (now - (state.lastLiveError || 0) > 8e3) {
        state.lastLiveError = now;
        toast(`\u5B9E\u65F6\u6570\u636E\u83B7\u53D6\u5931\u8D25\uFF1A${error.message}`, "error", 5e3);
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
      const snapshot = await api("/api/state");
      state.lastStateFetch = performance.now();
      applySnapshot(snapshot);
    } catch (error) {
      if (!quiet) toast(`\u72B6\u6001\u5237\u65B0\u5931\u8D25\uFF1A${error.message}`, "error", 5e3);
    } finally {
      state.stateBusy = false;
    }
  }
  async function pollLoop() {
    clearTimeout(state.pollTimer);
    try {
      if (state.workspace === "fem") {
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
        const activeRunning = state.workspace === "fem" ? state.fem?.running : state.sim?.running;
        const delay = document.hidden ? 1e3 : activeRunning ? 110 : 500;
        state.pollTimer = setTimeout(pollLoop, delay);
      }
    }
  }
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
    if (steps !== void 0) body.steps = steps;
    const response = await task(() => jsonRequest("/api/control", "POST", body), { dirty: false });
    if (!response) return;
    state.sim = response.sim;
    if (action === "reset") {
      resetLocalFrames();
    } else if (action === "run" || action === "step") {
      if (state.replay.active) leaveReplay();
    }
    syncUI();
    updateSignalKeyCache();
    updateInspectorLive();
    if (action === "step" || action === "reset") await pollLive();
    if (action === "reset") toast("\u4EFF\u771F\u5DF2\u91CD\u7F6E\uFF1B\u63A2\u9488\u4E0E\u4EEA\u5668\u8BBE\u7F6E\u4FDD\u7559", "ok", 2200);
  }
  async function control(action, steps, opts) {
    const running = !!(state.sim && state.sim.running);
    if ((action === "toggle" || action === "run") && !running && !(opts && opts.skipWarn) && state.prefs.runWarn !== false && !hasPrecomputed()) {
      openRunWarn();
      return;
    }
    if (state.workspace === "fem") {
      await femControl(action, steps);
      return;
    }
    await networkControl(action, steps);
  }
  function hasPrecomputed() {
    if (state.precomputedSeconds != null) return true;
    const frames = state.frames || [];
    if (frames.length < 2) return false;
    const span = frames[frames.length - 1].t - frames[0].t;
    const need = Number(state.chart && state.chart.window || 5);
    return span >= need * 0.9;
  }
  function openRunWarn() {
    if (document.getElementById("runWarnWin")) return;
    const overlay = document.createElement("div");
    overlay.id = "runWarnWin";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(16,20,18,.45);display:flex;align-items:center;justify-content:center;z-index:9999;";
    const card = document.createElement("div");
    card.style.cssText = 'width:520px;max-width:92vw;background:var(--paper,#faf8f2);color:var(--ink,#080a08);border:1px solid var(--line,#cfc6b5);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.28);padding:22px 24px 18px;font:13px/1.7 "Microsoft YaHei UI",sans-serif;';
    card.innerHTML = `
      <div style="font-size:16px;font-weight:700;margin-bottom:6px;">\u8FD0\u884C\u524D\u5EFA\u8BAE\u5148\u9884\u8BA1\u7B97</div>
      <div style="color:var(--muted,#7b7266);margin-bottom:14px;">
        \u5B9E\u65F6\u8FD0\u884C\u53EA\u767B\u8BB0\u63A2\u9488\uFF0C\u7ED8\u56FE\u9762\u677F\u4E0D\u4F1A\u8FB9\u7B97\u8FB9\u753B\u3002\u5148\u7528\u4E0B\u9762\u7684\u65F6\u95F4\u7A97\u628A 0\u2192T \u6574\u6BB5\u7B97\u5B8C\uFF0C
        \u4E4B\u540E\u5728\u300C\u7ED8\u56FE\u300D\u9875\u53EF\u4EE5\u6BEB\u79D2\u7EA7\u56DE\u653E\u3001\u5E76\u76F4\u63A5\u63A5\u5165\u4E3A\u6570\u636E\u6E90\u3002
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <span>\u9884\u8BA1\u7B97\u65F6\u95F4\u7A97</span>
        <input id="runWarnSec" type="number" min="1" max="120" step="1" value="${Math.max(1, Math.min(120, Math.round(Number(state.chart && state.chart.window || 5))))}"
          style="width:84px;padding:5px 8px;border:1px solid var(--line,#cfc6b5);border-radius:8px;background:#ffffff;color:#111814;-webkit-text-fill-color:#111814;font:600 14px/1.4 'Microsoft YaHei UI',sans-serif;" />
        <span>s</span>
        <span id="runWarnChips" style="display:flex;gap:6px;margin-left:6px;"></span>
      </div>
      <div id="runWarnInfo" style="color:var(--muted,#7b7266);min-height:20px;margin-bottom:6px;"></div>
      <label style="display:flex;align-items:center;gap:8px;margin:10px 0 16px;color:var(--muted,#7b7266);">
        <input id="runWarnNever" type="checkbox" /> \u4EE5\u540E\u4E0D\u518D\u63D0\u793A
      </label>
      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button id="runWarnCancel" class="ghost" style="padding:7px 14px;border:1px solid var(--line,#cfc6b5);border-radius:9px;background:transparent;color:inherit;cursor:pointer;">\u53D6\u6D88</button>
        <button id="runWarnRun" class="ghost" style="padding:7px 14px;border:1px solid var(--line,#cfc6b5);border-radius:9px;background:transparent;color:inherit;cursor:pointer;">\u76F4\u63A5\u8FD0\u884C</button>
        <button id="runWarnStop" class="ghost" style="display:none;padding:7px 14px;border:1px solid #b75555;border-radius:9px;background:transparent;color:#b75555;cursor:pointer;">\u505C\u6B62\u8BA1\u7B97</button>
        <button id="runWarnPre" class="primary" style="padding:7px 16px;border:1px solid var(--accent,#9b7247);border-radius:9px;background:var(--accent,#9b7247);color:#fff;cursor:pointer;">\u9884\u8BA1\u7B97\u5E76\u63A5\u5165</button>
      </div>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const sec = card.querySelector("#runWarnSec");
    const info = card.querySelector("#runWarnInfo");
    const chips = card.querySelector("#runWarnChips");
    [1, 5, 10, 30].forEach((v) => {
      const b = document.createElement("button");
      b.textContent = v + "s";
      b.style.cssText = "padding:3px 9px;border:1px solid var(--line,#cfc6b5);border-radius:999px;background:transparent;color:inherit;cursor:pointer;font:inherit;";
      b.onclick = () => {
        sec.value = String(v);
      };
      chips.appendChild(b);
    });
    const close = () => overlay.remove();
    overlay.onclick = (ev) => {
      if (ev.target === overlay) close();
    };
    card.querySelector("#runWarnCancel").onclick = close;
    card.querySelector("#runWarnRun").onclick = () => {
      if (card.querySelector("#runWarnNever").checked) void setPref("runWarn", false);
      close();
      void control("toggle", void 0, { skipWarn: true });
    };
    card.querySelector("#runWarnPre").onclick = async () => {
      const seconds = Math.max(1, Math.min(120, Math.round(Number(sec.value) || 5)));
      if (card.querySelector("#runWarnNever").checked) void setPref("runWarn", false);
      const btn = card.querySelector("#runWarnPre");
      const stopBtn = card.querySelector("#runWarnStop");
      btn.disabled = true;
      btn.textContent = "\u9884\u8BA1\u7B97\u4E2D\u2026";
      info.textContent = `\u6B63\u5728\u8BA1\u7B97 0\u2192${seconds}s\u2026`;
      stopBtn.style.display = "inline-block";
      stopBtn.disabled = false;
      stopBtn.textContent = "\u505C\u6B62\u8BA1\u7B97";
      stopBtn.onclick = async () => {
        stopBtn.disabled = true;
        stopBtn.textContent = "\u6B63\u5728\u505C\u6B62\u2026";
        try {
          await api("/api/control", { method: "POST", body: JSON.stringify({ action: "cancel_precompute" }) });
        } catch (error) {
          info.textContent = `\u53D6\u6D88\u5931\u8D25\uFF1A${error.message || "\u8BF7\u6C42\u5931\u8D25"}`;
        }
      };
      try {
        const pre = await api("/api/plotkit/precompute", {
          method: "POST",
          body: JSON.stringify({ seconds })
        });
        if (!pre || pre.ok === false) {
          info.textContent = "\u9884\u8BA1\u7B97\u5931\u8D25\uFF1A" + (pre && pre.error || "\u672A\u77E5\u9519\u8BEF") + "\uFF0C\u53EF\u76F4\u63A5\u8FD0\u884C\u6216\u7F29\u5C0F\u65F6\u95F4\u7A97\u91CD\u8BD5\u3002";
          return;
        }
        if (pre.cancelled) {
          info.textContent = `\u5DF2\u505C\u6B62\uFF1A\u4FDD\u7559\u524D ${pre.frames ?? "?"} \u5E27\uFF08${Number(pre.last_time || 0).toFixed(3)}s\uFF09\u3002`;
          return;
        }
        state.precomputedSeconds = seconds;
        state.precomputedRevision = state.scene?.revision ?? null;
        const preNote = pre.degraded ? `\uFF08\u6B65\u957F\u53D7 20 \u4E07\u6B65\u4E0A\u9650\u9650\u5236\uFF1A\u8BF7\u6C42 ${Number(pre.requested_dt).toExponential(1)}s\uFF0C\u5B9E\u9645 ${Number(pre.dt_used).toExponential(1)}s\uFF09` : "";
        info.textContent = `\u5B8C\u6210\uFF1A${seconds}s / ${pre.frames ?? "?"} \u5E27 / ${Math.round(pre.elapsed_ms || 0)} ms${preNote}`;
        toast(
          pre.degraded ? `\u9884\u8BA1\u7B97\u5B8C\u6210\u4F46\u5DF2\u964D\u7EA7\u6B65\u957F\uFF08${Number(pre.dt_used).toExponential(1)}s\uFF09\uFF1A${pre.frames ?? "?"} \u5E27\uFF0C\u7F29\u5C0F\u65F6\u95F4\u7A97\u53EF\u63D0\u9AD8\u7CBE\u5EA6` : `\u9884\u8BA1\u7B97\u5B8C\u6210\uFF1A${pre.frames ?? "?"} \u5E27\uFF0C\u53BB\u300C\u7ED8\u56FE\u300D\u9875\u52FE\u9009\u63A2\u9488\u540E\u70B9\u300C\u63A5\u5165\u300D`,
          pre.degraded ? "warn" : "ok",
          pre.degraded ? 5200 : 4200
        );
        close();
        const tab = document.querySelector('[data-sub="plotkit"]');
        if (tab) tab.click();
        setTimeout(() => refreshPkChannels(true), 400);
      } catch (error) {
        info.textContent = `\u9884\u8BA1\u7B97\u5931\u8D25\uFF1A${error.message || "\u8BF7\u6C42\u5931\u8D25"}\uFF1B\u53EF\u76F4\u63A5\u8FD0\u884C\u6216\u68C0\u67E5\u684C\u9762\u4F1A\u8BDD\u3002`;
      } finally {
        stopBtn.style.display = "none";
        btn.disabled = false;
        btn.textContent = "\u9884\u8BA1\u7B97\u5E76\u63A5\u5165";
      }
    };
    sec.focus();
  }
  async function maybeAutostart() {
    return;
  }
  function showShutdownScreen() {
    ui.modalCard.replaceChildren();
    ui.modalCard.appendChild(el("h3", null, "\u670D\u52A1\u5DF2\u5173\u95ED"));
    const body = el("p", null, "\u540E\u53F0\u7F51\u7EDC\u4E0E\u6709\u9650\u5143\u7EBF\u7A0B\u5DF2\u505C\u6B62\uFF0C\u76D1\u542C\u7AEF\u53E3\u5DF2\u91CA\u653E\u3002\u73B0\u5728\u53EF\u4EE5\u5173\u95ED\u6B64\u6807\u7B7E\u9875\u3002");
    const note = div("fem-note");
    note.textContent = "\u5982\u9700\u518D\u6B21\u4F7F\u7528\uFF0C\u8BF7\u91CD\u65B0\u8FD0\u884C run.py \u6216\u53CC\u51FB start.bat\uFF1B\u7AEF\u53E3\u901A\u5E38\u4F1A\u5728 1 \u79D2\u5185\u91CD\u65B0\u53EF\u7528\u3002";
    ui.modalCard.append(body, note);
    ui.modal.classList.remove("hidden");
    ui.modal.onclick = null;
  }
  async function shutdownApp() {
    if (state.shuttingDown) return;
    const confirmed = await confirmModal(
      "\u9000\u51FA Netlab\uFF1F",
      "\u5C06\u505C\u6B62\u7F51\u7EDC\u4E0E\u6709\u9650\u5143\u4EFF\u771F\u7EBF\u7A0B\uFF0C\u7EC8\u6B62\u540E\u7AEF\u8FDB\u7A0B\u5E76\u91CA\u653E\u76D1\u542C\u7AEF\u53E3\u3002\u6240\u6709\u672A\u5BFC\u51FA\u7684\u5185\u5B58\u573A\u666F\u90FD\u4F1A\u4E22\u5931\u3002",
      "\u9000\u51FA\u5E76\u5173\u95ED",
      true
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
      await fetch("/api/shutdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
        signal: controller.signal
      });
    } catch (error) {
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 550));
    showShutdownScreen();
  }
  const SHELL_KEYS = {
    netWidth: "netlab.networks.width",
    netCollapsed: "netlab.networks.collapsed",
    panelCollapsed: "netlab.panel.collapsed",
    panelWidth: "netlab.panel.width",
    femPanelWidth: "netlab.panel.width.fem"
  };
  function menuDefinition() {
    return [
      {
        label: "\u6587\u4EF6",
        items: [
          { label: "\u65B0\u5EFA\u5DE5\u7A0B", hint: "\u66FF\u6362\u5F53\u524D\u573A\u666F\uFF08\u672A\u4FDD\u5B58\u4F1A\u63D0\u793A\uFF09", action: () => void newProject() },
          { label: "\u6253\u5F00\u5DE5\u7A0B\u2026", action: () => void openProject() },
          { label: "\u4FDD\u5B58\u5DE5\u7A0B", action: () => void saveProject(false) },
          { label: "\u53E6\u5B58\u4E3A\u2026", action: () => void saveProject(true) },
          { sep: true },
          { label: "\u6062\u590D\u81EA\u52A8\u4FDD\u5B58", action: () => void recoverAutosave() },
          { label: "\u5BFC\u51FA\u573A\u666F JSON", hint: "Ctrl+Shift+E\uFF08\u4E0B\u4E00\u7968\uFF09", action: () => void exportScene() },
          { sep: true },
          { label: "\u9000\u51FA\u670D\u52A1", action: () => void shutdownApp() }
        ]
      },
      {
        label: "\u7F16\u8F91",
        items: [
          { label: "\u64A4\u9500", hint: "Ctrl+Z\uFF08100 \u6B65\uFF09", action: () => void undo() },
          { label: "\u91CD\u505A", hint: "Ctrl+Shift+Z", action: () => void redo() },
          { sep: true },
          { label: "\u590D\u5236", hint: "Ctrl+C", action: () => copySelection(false) },
          { label: "\u526A\u5207", hint: "Ctrl+X", action: () => copySelection(true) },
          { label: "\u7C98\u8D34", hint: "Ctrl+V\uFF08\u8DE8\u7F51\u7EDC\u9700\u786E\u8BA4\uFF09", action: () => void pasteClipboard() },
          { label: "\u5168\u9009", hint: "Ctrl+A", action: () => selectAll() },
          { sep: true },
          { label: "\u5220\u9664\u9009\u4E2D", hint: "Delete", action: () => void deleteSelection() },
          { label: "\u6279\u91CF\u8BBE\u7F6E\u5C3A\u5BF8\u2026", hint: "\u591A\u9009\u8282\u70B9/\u5668\u4EF6\u540E\u7EDF\u4E00\u5BBD\u6216\u76F4\u5F84", action: () => void batchResizeSelection() },
          { label: "\u6E05\u7A7A\u573A\u666F", action: () => void clearScene() }
        ]
      },
      {
        label: "\u89C6\u56FE",
        items: [
          { label: "\u9002\u914D\u89C6\u56FE", action: () => fitView(true) },
          { label: "\u653E\u5927", action: () => zoomCenter(1.2) },
          { label: "\u7F29\u5C0F", action: () => zoomCenter(1 / 1.2) },
          { label: "\u81EA\u52A8\u5E03\u5C40", action: () => void autoLayout() },
          { label: "\u5207\u6362\u7F51\u683C\u5438\u9644", hint: "Alt \u62D6\u52A8\u53EF\u4E34\u65F6\u6682\u505C", action: () => toggleSnap() },
          { label: "\u5207\u6362\u7B26\u53F7\u98CE\u683C", hint: "\u7ECF\u5178\u5706\u5F62 / GB \u77E9\u5F62\uFF08\u5DE5\u7A0B\u7EA7\uFF09", action: () => toggleSymbol() },
          { label: "\u663E\u793A / \u9690\u85CF\u5F15\u811A\u540D", hint: "\u5668\u4EF6\u6846\u5F15\u811A\u6807\u6CE8", action: () => {
            state.ui.showPins = state.ui.showPins === false;
            requestDraw();
          } },
          { sep: true },
          { label: "\u6536\u8D77 / \u5C55\u5F00\u5DE6\u4FA7\u7F51\u7EDC\u680F", action: () => toggleNetworks() },
          { label: "\u6536\u8D77 / \u5C55\u5F00\u53F3\u4FA7\u9762\u677F", action: () => togglePanel() },
          { label: "\u5207\u6362\u5230\u6709\u9650\u5143\u573A", action: () => void switchWorkspace("fem") }
        ]
      },
      {
        label: "\u5DE5\u7A0B \xB7 \u7F51\u7EDC",
        items: [
          { label: "\u65B0\u5EFA\u7F51\u7EDC", action: () => void addNetwork() },
          { label: "\u91CD\u547D\u540D\u5F53\u524D\u7F51\u7EDC\u2026", action: () => void renameNetwork() },
          { label: "\u5220\u9664\u5F53\u524D\u7F51\u7EDC\u2026", action: () => void deleteNetwork() },
          { sep: true },
          { label: "\u5237\u65B0\u7F51\u7EDC\u5217\u8868", action: () => void fetchNetworks(false) },
          { label: "\u5DE5\u7A0B\u6587\u4EF6\u4F4D\u7F6E", hint: "\u5F53\u524D\u4FDD\u5B58\u8DEF\u5F84", action: () => {
            const path = state.project.path || "\u5C1A\u672A\u4FDD\u5B58\uFF1A\u6587\u4EF6\u83DC\u5355\u53EF\u7528\u300C\u4FDD\u5B58\u5DE5\u7A0B\u300D\u843D\u76D8";
            toast(path, "info", 5e3);
          } }
        ]
      },
      {
        label: "\u4EFF\u771F",
        items: [
          { label: "\u8FD0\u884C / \u6682\u505C", hint: "\u7A7A\u683C", action: () => void control("toggle") },
          { label: "\u9884\u8BA1\u7B97\u6570\u636E\u2026", hint: "\u5148\u7B97 0\u2192T\uFF0C\u518D\u5728\u7ED8\u56FE\u9875\u56DE\u653E/\u63A5\u5165", action: () => openRunWarn() },
          { label: "\u5355\u6B65", hint: "S", action: () => void control("step") },
          { label: "\u65F6\u95F4\u5F52\u96F6", hint: "\u53EA\u5F52\u96F6\u8BA1\u65F6\u4E0E\u5F55\u5236\uFF0C\u4E0D\u6E05\u72B6\u6001", action: () => void control("zero") },
          { label: "\u91CD\u7F6E", hint: "\u6E05\u9664\u72B6\u6001\u4E0E\u65F6\u95F4", action: () => void control("reset") }
        ]
      },
      {
        label: "\u5206\u6790",
        items: [
          { label: "\u5206\u6790\u9762\u677F", action: () => switchTab("analysis") },
          { label: "\u5BFC\u51FA CSV", action: () => void exportAnalysisCsv() }
        ]
      },
      {
        label: "\u5DE5\u5177",
        items: [
          { label: "\u5168\u5C40\u641C\u7D22\u2026", hint: "Ctrl+K / R14", action: () => openDocSearch() },
          { sep: true },
          { label: "\u8282\u70B9\u51FD\u6570", action: () => switchTab("node-fn") },
          { label: "\u8FDE\u63A5\u51FD\u6570", action: () => switchTab("edge-fn") },
          { label: "\u6A21\u5757\u4E0E\u6269\u5C55", action: () => switchTab("blocks") },
          { sep: true },
          { label: "\u4EE3\u7801\u5DE5\u4F5C\u533A\uFF08VS Code\uFF09", hint: "\u672C\u5730 IDE \xB7 \u7EC8\u7AEF / \u6269\u5C55 / \u8C03\u8BD5", action: () => void openVscode() },
          { sep: true },
          { label: "\u6027\u80FD\u9762\u677F", action: () => switchTab("analysis") },
          { label: "\u7F13\u5B58\u4F53\u68C0\u4E0E\u6E05\u7406\u2026", hint: "\u53EA\u6E05\u53EF\u518D\u751F\u6210\u7684\u7F13\u5B58\uFF0C\u4E0D\u78B0\u5DE5\u7A0B\u4E0E\u81EA\u52A8\u4FDD\u5B58", action: () => openCacheDialog() },
          { label: "DC \u5DE5\u4F5C\u70B9\uFF08.op\uFF09", hint: "\u4E0D\u63A8\u8FDB\u4EFF\u771F\uFF0C\u9759\u9ED8\u89E3\u4E00\u6B21\u9759\u6001\u7535\u8DEF", action: () => openAnalysis("op") },
          { label: "AC \u626B\u9891\uFF08Bode\uFF09\u2026", hint: "\u5148\u6C42\u5DE5\u4F5C\u70B9\u518D\u9010\u9891\u70B9\u6C42\u89E3", action: () => openAnalysis("ac") },
          { label: "\u8FC1\u79FB\u573A\u666F\u4E3A\u5668\u4EF6\u6A21\u578B\uFF08R20\uFF09", hint: "\u5143\u4EF6\u8FB9 \u2192 \u5668\u4EF6\u8282\u70B9 + \u5F15\u811A\u5BFC\u7EBF", action: () => void migrateSceneToDevices() },
          { label: "\u65B0\u5EFA\u8FDE\u7EBF\uFF08\u9009\u62E9\u7AEF\u70B9\uFF09\u2026", hint: "\u7F51\u7EDC\u2194\u7F51\u7EDC\u7EAF\u5BFC\u7EBF / \u5668\u4EF6\u5F15\u811A\u2194\u7F51\u7EDC", action: () => openWireDialog() }
        ]
      },
      {
        label: "\u8BBE\u7F6E",
        items: [
          { label: "\u5DE5\u7A0B\u8BBE\u7F6E\u2026", hint: "\u5DE5\u4F5C\u6A21\u5F0F / \u6A21\u677F / \u6587\u4EF6 / \u753B\u5E03\u7F51\u683C", action: () => openSettings("project") },
          { label: "\u89C6\u56FE\u4E0E\u5916\u89C2\u2026", hint: "\u4E3B\u9898 / \u5F3A\u8C03\u8272 / \u52A8\u6548 / \u6027\u80FD", action: () => openSettings("view") },
          { label: "\u4EA4\u4E92\u4E0E\u6587\u6863\u2026", hint: "\u542F\u52A8\u5F15\u5BFC / \u81EA\u52A8\u4FDD\u5B58 / \u5FEB\u6377\u952E", action: () => openSettings("interact") },
          { sep: true },
          { label: "\u91CD\u65B0\u6253\u5F00\u5F15\u5BFC\u9875", action: () => showGuide(true) },
          { label: "\u81EA\u52A8\u4FDD\u5B58", hint: state.project.autosave ? "\u5F53\u524D\uFF1A\u5F00" : "\u5F53\u524D\uFF1A\u5173", action: () => void saveAutosaveSetting({ autosave_enabled: !state.project.autosave }) }
        ]
      },
      {
        label: "\u5E2E\u52A9",
        items: [
          { label: "\u5FEB\u901F\u4E0A\u624B", action: () => openDoc("quickstart") },
          { label: "\u754C\u9762\u6307\u5357", action: () => openDoc("interface") },
          { label: "\u672F\u8BED\u8868", action: () => openDoc("glossary") },
          { label: "\u5E38\u89C1\u95EE\u9898", action: () => openDoc("faq") },
          { label: "\u5FEB\u6377\u952E", hint: "?", action: () => openDoc("shortcuts") },
          { sep: true },
          { label: "\u6587\u6863\u4E2D\u5FC3\uFF08\u641C\u7D22\uFF09", hint: "Ctrl+K", action: () => openDocSearch() },
          { label: "\u5173\u4E8E Netlab", action: () => toast("Netlab \xB7 \u62D3\u6251\u7F51\u7EDC / \u7535\u8DEF / \u70ED\u573A\u4EFF\u771F\uFF08\u672C\u5730\u8FD0\u884C\uFF09", "info", 4e3) }
        ]
      }
    ];
  }
  function closeMenus() {
    $$(".menu.open").forEach((node) => node.classList.remove("open"));
  }
  function initMenus() {
    const host = ui.menuItems;
    if (!host) return;
    host.replaceChildren();
    for (const menu of menuDefinition()) {
      const wrap = div("menu");
      const button2 = el("button", null, menu.label);
      button2.type = "button";
      button2.setAttribute("role", "menuitem");
      button2.setAttribute("aria-haspopup", "true");
      const panel = div("menu-panel");
      panel.setAttribute("role", "menu");
      for (const item of menu.items) {
        if (item.sep) {
          panel.appendChild(div("menu-sep"));
          continue;
        }
        const entry = el("button", "menu-item");
        entry.type = "button";
        entry.disabled = Boolean(item.disabled);
        entry.appendChild(el("strong", null, item.label));
        if (item.hint) entry.appendChild(el("small", null, item.hint));
        entry.addEventListener("click", () => {
          closeMenus();
          if (!item.disabled) item.action();
        });
        panel.appendChild(entry);
      }
      button2.addEventListener("click", (event) => {
        event.stopPropagation();
        const open = wrap.classList.contains("open");
        closeMenus();
        if (!open) wrap.classList.add("open");
      });
      wrap.append(button2, panel);
      host.appendChild(wrap);
    }
    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".menu")) closeMenus();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenus();
    });
  }
  function setInfo(key, value) {
    if (!ui.infoBar) return;
    const node = ui.infoBar.querySelector(`[data-info="${key}"]`);
    if (node) node.textContent = value;
  }
  function updateInfoBar() {
    if (!ui.infoBar) return;
    const modeLabel2 = { signal: "\u4FE1\u53F7\u6D41", circuit: "\u7535\u8DEF", vector: "\u77E2\u91CF" }[state.mode] || state.mode || "\u2014";
    const network = state.currentNetwork?.name || "\u7F51\u7EDC 1";
    const total = state.networks?.length || 1;
    const sim = state.sim || {};
    setInfo("project", `${state.project.name || "\u672A\u547D\u540D\u5DE5\u7A0B"}${state.project.dirty ? " *" : ""}`);
    setInfo("network", total > 1 ? `${network} (${total})` : network);
    setInfo("mode", modeLabel2);
    const nodes = state.scene?.nodes?.length || 0;
    const edges = state.scene?.edges?.length || 0;
    setInfo("counts", `\u8282\u70B9 ${nodes} \xB7 \u8FDE\u7EBF ${edges}`);
    const dt = Number(sim.config?.dt ?? sim.dt ?? state.scene?.sim?.dt ?? 0);
    const dtMs = dt * 1e3;
    const dtText = dt >= 1 ? `${dt.toFixed(dt % 1 ? 2 : 0)} s` : `${dtMs >= 10 ? dtMs.toFixed(0) : dtMs >= 1 ? dtMs.toFixed(1) : dtMs.toFixed(2)} ms`;
    setInfo("dt", `dt ${dtText}`);
    setInfo("time", `t ${Number(sim.time || 0).toFixed(3)} s`);
    setInfo("steps", `step ${Number(sim.steps || 0)}`);
    const alerts = Number(sim.alerts ?? sim.warnings ?? 0) || 0;
    const alertNode = ui.infoBar.querySelector('[data-info="alerts"]');
    if (alertNode) {
      alertNode.textContent = `\u544A\u8B66 ${alerts}`;
      alertNode.classList.toggle("has-alert", alerts > 0);
    }
    const run = ui.infoBar.querySelector('[data-info="run"]');
    if (run) {
      run.textContent = sim.running ? "\u8FD0\u884C\u4E2D" : "\u505C\u6B62";
      run.classList.toggle("stopped", !sim.running);
    }
  }
  async function fetchNetworks(silent = true) {
    try {
      const response = await jsonRequest("/api/networks", "GET");
      state.networks = response.networks || [];
      state.currentNetwork = state.networks.find((item) => item.current) || state.networks[0] || null;
      renderNetworkList();
      updateInfoBar();
      return state.networks;
    } catch (error) {
      if (!silent) toast(`\u7F51\u7EDC\u5217\u8868\u8BFB\u53D6\u5931\u8D25\uFF1A${error.message}`, "error", 4e3);
      return state.networks;
    }
  }
  function renderNetworkList() {
    if (!ui.networkList) return;
    ui.networkList.replaceChildren();
    for (const network of state.networks || []) {
      const item = el("button", "network-item");
      item.type = "button";
      item.setAttribute("role", "option");
      item.dataset.networkId = network.id;
      item.classList.toggle("current", Boolean(network.current));
      item.setAttribute("aria-selected", network.current ? "true" : "false");
      item.title = `${network.name} \xB7 ${network.mode} \xB7 ${network.nodes} \u8282\u70B9 / ${network.edges} \u8FDE\u63A5`;
      const dot = div("dot");
      const label = el("span", null, network.name);
      const meta = el("span", "meta", network.nodes);
      item.append(dot, label, meta);
      item.addEventListener("click", () => void switchNetwork(network.id));
      item.addEventListener("dblclick", () => void renameNetwork(network.id));
      item.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        openNetworkMenu(network, event.clientX, event.clientY);
      });
      ui.networkList.appendChild(item);
    }
  }
  function openNetworkMenu(network, x, y) {
    const isCurrent = Boolean(network.current);
    const picked = isCurrent ? multiSelection().nodes.size : 0;
    const tempModule = String(network.name || "").startsWith("\u6A21\u5757 ");
    const moduleName = tempModule ? String(network.name).slice(3).trim() : "";
    const knownBlock = moduleName ? (state.blocks || []).find((block) => block.name === moduleName) : null;
    if (tempModule && !(state.blocks || []).length) void refreshBlocks();
    const items = [
      {
        label: "\u5C01\u88C5\u9009\u4E2D\u8282\u70B9\u4E3A\u6A21\u5757\u2026",
        hint: isCurrent ? picked ? `\u5DF2\u9009 ${picked} \u4E2A\u8282\u70B9` : "\u5148\u5728\u753B\u5E03\u4E0A Ctrl+\u5355\u51FB\u591A\u9009" : "\u5148\u5207\u6362\u5230\u8BE5\u7F51\u7EDC",
        disabled: !isCurrent || !picked,
        action: () => void encapsulateSelection()
      },
      {
        label: "\u6253\u5F00\u6A21\u5757\u5E93",
        hint: "\u5C01\u88C5 / \u5B9E\u4F8B\u5316 / \u6253\u5F00\u5185\u90E8",
        action: () => switchTab("blocks")
      },
      { sep: true },
      {
        label: "\u5728\u6A21\u5757\u5185\u90E8\u6D6E\u7A97\u4E2D\u6253\u5F00",
        hint: knownBlock ? `\u9884\u89C8\u300C${moduleName}\u300D\u5185\u90E8` : tempModule ? "\u6A21\u5757\u5E93\u91CC\u627E\u4E0D\u5230\u540C\u540D\u6A21\u5757" : "\u5148\u5207\u5230\u6A21\u5757\u5185\u90E8\u4E34\u65F6\u7F51\u7EDC",
        disabled: !knownBlock,
        action: () => {
          if (knownBlock) openModuleInternal(knownBlock.id);
        }
      },
      {
        label: "\u5173\u95ED\u6A21\u5757\u5185\u90E8\u4E34\u65F6\u7F51\u7EDC",
        disabled: !tempModule,
        action: () => void closeInternalNetwork()
      }
    ];
    showFloatingMenu(x, y, items, network.name);
  }
  let floatingMenu = null;
  function closeFloatingMenu() {
    if (!floatingMenu) return;
    floatingMenu.remove();
    floatingMenu = null;
  }
  function showFloatingMenu(x, y, items, title = "") {
    closeFloatingMenu();
    const box = div("ctxmenu");
    box.setAttribute("role", "menu");
    if (title) box.appendChild(div("ctxmenu-title", title));
    for (const item of items) {
      if (item.sep) {
        box.appendChild(div("menu-sep"));
        continue;
      }
      const entry = el("button", "menu-item");
      entry.type = "button";
      entry.disabled = Boolean(item.disabled);
      entry.appendChild(el("strong", null, item.label));
      if (item.hint) entry.appendChild(el("small", null, item.hint));
      entry.addEventListener("click", () => {
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
    document.addEventListener("pointerdown", (event) => {
      if (!floatingMenu) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".ctxmenu")) closeFloatingMenu();
    }, true);
    window.addEventListener("blur", () => closeFloatingMenu());
    window.addEventListener("resize", () => closeFloatingMenu());
  }
  async function switchNetwork(networkId) {
    if (!networkId || networkId === state.currentNetwork?.id) return;
    const response = await task(
      () => jsonRequest(`/api/networks/${encodeURIComponent(networkId)}/activate`, "POST", {})
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
    toast(`\u5DF2\u5207\u6362\u5230\u7F51\u7EDC\uFF1A${state.currentNetwork?.name || networkId}`, "ok", 2200);
  }
  async function addNetwork() {
    const response = await task(() => jsonRequest("/api/networks", "POST", {}));
    if (!response) return;
    await fetchNetworks();
    toast("\u5DF2\u65B0\u5EFA\u7F51\u7EDC\uFF08\u81EA\u52A8\u547D\u540D\uFF0C\u53EF\u53CC\u51FB\u6539\u540D\uFF09", "ok", 2600);
  }
  async function renameNetwork(networkId = state.currentNetwork?.id) {
    if (!networkId) return;
    const item = (state.networks || []).find((network) => network.id === networkId);
    const proposed = window.prompt("\u7F51\u7EDC\u540D\u79F0\uFF08\u6700\u957F 60 \u5B57\uFF09", item?.name || "");
    if (proposed === null) return;
    const response = await task(
      () => jsonRequest(`/api/networks/${encodeURIComponent(networkId)}`, "PATCH", { name: proposed })
    );
    if (!response) return;
    await fetchNetworks();
    toast(`\u7F51\u7EDC\u5DF2\u6539\u540D\uFF1A${response.name}`, "ok", 2200);
  }
  async function deleteNetwork() {
    const network = state.currentNetwork;
    if (!network) return;
    if ((state.networks || []).length <= 1) {
      toast("\u5DE5\u7A0B\u81F3\u5C11\u9700\u8981\u4FDD\u7559\u4E00\u4E2A\u7F51\u7EDC", "error", 3200);
      return;
    }
    const confirmed = await confirmModal(
      `\u5220\u9664\u7F51\u7EDC\u300C${network.name}\u300D\uFF1F`,
      "\u8BE5\u7F51\u7EDC\u7684\u8282\u70B9\u4E0E\u8FDE\u63A5\u4F1A\u4E00\u5E76\u5220\u9664\uFF1B\u5DE5\u7A0B\u6B63\u672C\u4ECD\u53EF\u7528\u300C\u4FDD\u5B58\u5DE5\u7A0B\u300D\u8986\u76D6\u3002",
      "\u5220\u9664",
      true
    );
    if (!confirmed) return;
    const response = await task(
      () => jsonRequest(`/api/networks/${encodeURIComponent(network.id)}`, "DELETE")
    );
    if (!response) return;
    await fetchNetworks();
    const snapshot = await api("/api/state");
    applySnapshot(snapshot);
    toast("\u7F51\u7EDC\u5DF2\u5220\u9664", "ok", 2200);
  }
  function syncChromeEdges() {
    if (!ui.main) return;
    if (ui.networks && !ui.main.classList.contains("net-hidden")) {
      const netWidth = Math.round(ui.networks.getBoundingClientRect().width);
      if (netWidth > 0) ui.main.style.setProperty("--net-edge", `${netWidth}px`);
    }
    if (ui.panel && !ui.main.classList.contains("panel-hidden")) {
      const panelWidth = Math.round(ui.panel.getBoundingClientRect().width);
      if (panelWidth > 0) ui.main.style.setProperty("--panel-edge", `${panelWidth}px`);
    }
  }
  function applyNetCollapsed(collapsed) {
    ui.main.classList.toggle("net-hidden", collapsed);
    if (ui.netHanger) {
      ui.netHanger.textContent = collapsed ? "\u203A" : "\u2039";
      ui.netHanger.title = collapsed ? "\u5C55\u5F00\u7F51\u7EDC\u680F" : "\u6536\u8D77\u7F51\u7EDC\u680F";
      ui.netHanger.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
    try {
      localStorage.setItem(SHELL_KEYS.netCollapsed, collapsed ? "1" : "0");
    } catch (error) {
    }
    setTimeout(() => {
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      schedulePhaseDraw();
    }, 60);
  }
  function toggleNetworks() {
    applyNetCollapsed(!ui.main.classList.contains("net-hidden"));
  }
  function initNetworkSidebar() {
    if (!ui.networkList) return;
    let width = 0;
    let collapsed = false;
    try {
      width = Number(localStorage.getItem(SHELL_KEYS.netWidth)) || 0;
      collapsed = localStorage.getItem(SHELL_KEYS.netCollapsed) === "1";
    } catch (error) {
      width = 0;
    }
    if (width >= 140 && width <= 360) {
      ui.main.style.setProperty("--net-w", `${Math.round(width)}px`);
    }
    applyNetCollapsed(collapsed);
    ui.netHanger?.addEventListener("click", toggleNetworks);
    ui.netAdd?.addEventListener("click", () => void addNetwork());
    ui.netRename?.addEventListener("click", () => void renameNetwork());
    ui.netDelete?.addEventListener("click", () => void deleteNetwork());
    const handle = ui.netResize;
    if (!handle) return;
    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    const currentWidth = () => {
      const rect = ui.networks?.getBoundingClientRect();
      if (rect && rect.width > 0) return rect.width;
      const value = parseFloat(getComputedStyle(ui.main).getPropertyValue("--net-w"));
      return Number.isFinite(value) ? value : 172;
    };
    handle.addEventListener("pointerdown", (event) => {
      dragging = true;
      startX = event.clientX;
      startWidth = currentWidth();
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add("net-dragging");
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const next = clamp(Math.round(startWidth + event.clientX - startX), 140, 360);
      ui.main.style.setProperty("--net-w", `${next}px`);
      ui.main.style.setProperty("--net-edge", `${next}px`);
    });
    const finish = (event) => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("net-dragging");
      try {
        localStorage.setItem(SHELL_KEYS.netWidth, String(Math.round(currentWidth())));
      } catch (error) {
      }
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      schedulePhaseDraw();
      if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }
  async function snapSceneToGrid() {
    const grid = Number(state.ui.grid) || 20;
    const snapValue = (value) => Math.round(value / grid) * grid;
    const nodes = (state.scene?.nodes || []).filter((node) => {
      const x = Number(node.position?.x || 0);
      const y = Number(node.position?.y || 0);
      return snapValue(x) !== Math.round(x) || snapValue(y) !== Math.round(y);
    });
    const edges = (state.scene?.edges || []).filter(
      (edge) => (edge.waypoints || []).some((point) => snapValue(point.x) !== Math.round(point.x) || snapValue(point.y) !== Math.round(point.y))
    );
    if (!nodes.length && !edges.length) {
      toast("\u6240\u6709\u8282\u70B9\u4E0E\u62D0\u70B9\u5DF2\u5728\u7F51\u683C\u4E0A", "info", 2200);
      return;
    }
    await pushUndoSnapshot();
    for (const node of nodes) {
      const position = { x: snapValue(Number(node.position.x) || 0), y: snapValue(Number(node.position.y) || 0) };
      await task(() => jsonRequest(`/api/nodes/${encodeURIComponent(node.id)}`, "PATCH", { position }), { history: false });
    }
    for (const edge of edges) {
      const waypoints = (edge.waypoints || []).map((point) => ({ x: snapValue(point.x), y: snapValue(point.y) }));
      await task(() => jsonRequest(`/api/edges/${encodeURIComponent(edge.id)}`, "PATCH", { waypoints }), { history: false });
    }
    await refreshState(true);
    toast(`\u5DF2\u6574\u7406 ${nodes.length} \u4E2A\u8282\u70B9\u3001${edges.length} \u6761\u8FDE\u7EBF\u5230 ${grid} \u7F51\u683C`, "ok", 2600);
  }
  function toggleSnap() {
    state.ui.snap = !state.ui.snap;
    toast(`\u7F51\u683C\u5438\u9644\u5DF2${state.ui.snap ? "\u5F00\u542F" : "\u5173\u95ED"}\uFF08Alt \u4E34\u65F6\u6682\u505C\uFF09`, "info", 2400);
    markProjectDirty();
  }
  function toggleSymbol() {
    state.ui.symbol = state.ui.symbol === "gb" ? "classic" : "gb";
    requestDraw();
    markProjectDirty();
    toast(`\u7B26\u53F7\u98CE\u683C\uFF1A${state.ui.symbol === "gb" ? "GB \u77E9\u5F62" : "\u7ECF\u5178\u5706\u5F62"}\uFF08\u4EC5\u672C\u5DE5\u7A0B\uFF09`, "info", 2600);
  }
  function applyProjectUi(uiSettings) {
    if (!uiSettings || typeof uiSettings !== "object") return;
    if (uiSettings.grid && typeof uiSettings.grid === "object") {
      if (typeof uiSettings.grid.snap === "boolean") state.ui.snap = uiSettings.grid.snap;
      if (typeof uiSettings.grid.show === "boolean") state.ui.showGrid = uiSettings.grid.show;
      if (typeof uiSettings.grid.markers === "boolean") state.ui.snapMarkers = uiSettings.grid.markers;
      if (typeof uiSettings.grid.orthogonal === "boolean") state.ui.circuitOrthogonal = uiSettings.grid.orthogonal;
      const size = Number(uiSettings.grid.size);
      if (Number.isFinite(size) && size >= 5 && size <= 80) state.ui.grid = size;
    }
    if (uiSettings.symbol === "gb" || uiSettings.symbol === "classic") {
      state.ui.symbol = uiSettings.symbol;
    }
    if (["circle", "dot", "box"].includes(uiSettings.nodeStyle)) state.ui.nodeStyle = uiSettings.nodeStyle;
    if (typeof uiSettings.drawingMode === "boolean") state.ui.drawingMode = uiSettings.drawingMode;
    if (typeof uiSettings.drawingSheet === "string" && SHEET_SIZES[uiSettings.drawingSheet]) state.ui.drawingSheet = uiSettings.drawingSheet;
    if (typeof uiSettings.drawingLabels === "boolean") state.ui.drawingLabels = uiSettings.drawingLabels;
    if (Number.isFinite(Number(uiSettings.drawingPage))) state.ui.drawingPage = Math.max(1, Math.min(9, Number(uiSettings.drawingPage)));
    if (Number.isFinite(Number(uiSettings.symbolScale))) state.ui.symbolScale = clamp(Number(uiSettings.symbolScale), 0.6, 2.5);
    if (typeof uiSettings.glyphColor === "string") state.ui.glyphColor = uiSettings.glyphColor;
    requestDraw();
  }
  function blockBadges(spec) {
    const badges = [
      spec.mode,
      spec.model || "behavioral",
      `v${spec.version}`,
      `${spec.node_count} \u8282\u70B9`,
      `${(spec.inputs || []).length} \u5165 / ${(spec.outputs || []).length} \u51FA`
    ];
    if (spec.builtin) badges.unshift("\u5185\u7F6E");
    return badges;
  }
  async function refreshBlocks() {
    const response = await task(() => jsonRequest("/api/blocks", "GET"), { dirty: false });
    if (!response) return;
    state.blocks = response.blocks || [];
    state.blocksLibrary = response.library || "";
    renderBlocksPanel();
  }
  async function instantiateBlockFromLibrary(blockId) {
    const place = centerPlacement();
    const response = await task(
      () => jsonRequest("/api/blocks/instantiate", "POST", {
        block_id: blockId,
        position: { x: Math.round(place.x), y: Math.round(place.y) }
      })
    );
    if (!response) return;
    applySnapshot(response);
    await refreshBlocks();
    if (response.instance?.block_node) {
      await selectEntity("node", response.instance.block_node, true);
      switchTab("inspect");
    }
    toast("\u6A21\u5757\u5DF2\u5B9E\u4F8B\u5316\u5230\u753B\u5E03", "ok", 2400);
  }
  async function encapsulateSelection() {
    const liveNodes = new Set((state.scene?.nodes || []).map((node) => node.id));
    const picked = [...multiSelection().nodes];
    const nodes = picked.filter((id) => liveNodes.has(id));
    if (picked.length && !nodes.length) {
      await refreshState(false);
      toast("\u753B\u5E03\u5DF2\u8FC7\u671F\uFF08\u8282\u70B9\u5DF2\u4E0D\u5728\u5F53\u524D\u573A\u666F\uFF09\uFF0C\u5DF2\u5237\u65B0\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u8981\u5C01\u88C5\u7684\u8282\u70B9", "error", 5200);
      return;
    }
    if (!nodes.length) {
      toast("\u5148\u5728\u753B\u5E03\u4E0A\u9009\u4E2D\u8981\u5C01\u88C5\u7684\u8282\u70B9\uFF08Ctrl+\u5355\u51FB\u591A\u9009\uFF09", "info", 3200);
      return;
    }
    const proposed = window.prompt("\u6A21\u5757\u540D\u79F0\uFF08\u6700\u957F 32 \u5B57\uFF09", "\u6A21\u5757");
    if (proposed === null) return;
    let response = null;
    try {
      response = await jsonRequest("/api/blocks/encapsulate", "POST", {
        node_ids: nodes,
        name: proposed,
        model: state.blocksStructural ? "structural" : "behavioral"
      });
    } catch (error) {
      await refreshState(false);
      toast(`\u5C01\u88C5\u5931\u8D25\uFF1A${error.message || error}`, "error", 6e3);
      return;
    }
    if (!response) return;
    applySnapshot({ scene: response.scene, sim: response.sim, limits: state.limits });
    state.multi.nodes.clear();
    state.multi.edges.clear();
    clearSelection();
    await refreshBlocks();
    toast(`\u5DF2\u5C01\u88C5\u4E3A\u6A21\u5757\u300C${response.block.name}\u300D\u5E76\u5199\u5165\u5E93`, "ok", 3e3);
  }
  async function retryDegradedProject() {
    const response = await task(() => jsonRequest("/api/project/retry", "POST", {}));
    if (!response) return;
    applySnapshot({ scene: response.scene, sim: response.sim, limits: state.limits });
    if (response.degraded) {
      toast("\u5E93\u6587\u4EF6\u4ECD\u7F3A\u5931\uFF0C\u5DF2\u4FDD\u6301\u964D\u7EA7\u53EA\u8BFB", "error", 3200);
    } else {
      toast("\u5DF2\u89E3\u9664\u964D\u7EA7\u53EA\u8BFB\uFF0C\u53EF\u4EE5\u8FD0\u884C", "ok", 2800);
    }
    await refreshBlocks();
  }
  async function closeInternalNetwork() {
    const network = state.currentNetwork;
    if (!network || !String(network.name || "").startsWith("\u6A21\u5757 ")) {
      toast("\u5F53\u524D\u7F51\u7EDC\u4E0D\u662F\u6A21\u5757\u5185\u90E8\u4E34\u65F6\u7F51\u7EDC", "info", 2600);
      return;
    }
    await deleteNetwork();
    await refreshBlocks();
  }
  function initBlockDragDrop() {
    const graph = ui.graph;
    if (!graph) return;
    graph.addEventListener("dragover", (event) => {
      if (!event.dataTransfer || !event.dataTransfer.types.includes("text/netlab-block")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    });
    graph.addEventListener("drop", async (event) => {
      const blockId = event.dataTransfer?.getData("text/netlab-block");
      if (!blockId) return;
      event.preventDefault();
      const rect = graph.getBoundingClientRect();
      const world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      const response = await task(
        () => jsonRequest("/api/blocks/instantiate", "POST", {
          block_id: blockId,
          position: { x: Math.round(world.x), y: Math.round(world.y) }
        })
      );
      if (!response) return;
      applySnapshot(response);
      if (response.instance?.block_node) {
        await selectEntity("node", response.instance.block_node, true);
      }
      toast("\u6A21\u5757\u5DF2\u62D6\u5165\u753B\u5E03\u5E76\u5B9E\u4F8B\u5316", "ok", 2400);
    });
  }
  async function openBlockInternal(blockId) {
    const response = await task(
      () => jsonRequest(`/api/blocks/${encodeURIComponent(blockId)}/open-internal`, "POST", {})
    );
    if (!response) return false;
    applySnapshot({ scene: response.scene, sim: response.sim, limits: state.limits });
    await fetchNetworks();
    fitView();
    toast("\u5DF2\u5728\u4E34\u65F6\u7F51\u7EDC\u4E2D\u6253\u5F00\u6A21\u5757\u5185\u90E8", "ok", 3e3);
    return true;
  }
  const MODULE_DIR_GLYPH = { input: "\u2192", output: "\u2190", inout: "\u2194" };
  const MODULE_DIR_LABEL = { input: "\u8F93\u5165", output: "\u8F93\u51FA", inout: "\u53CC\u5411" };
  const PORT_DIRECTION_CHOICES = [
    ["input", "\u8F93\u5165", "\u5F15\u811A\u753B\u5728\u6A21\u5757\u5DE6\u4FA7\uFF0C\u8868\u793A\u4ECE\u5916\u90E8\u6D41\u8FDB\u6765"],
    ["output", "\u8F93\u51FA", "\u5F15\u811A\u753B\u5728\u6A21\u5757\u53F3\u4FA7\uFF0C\u8868\u793A\u5411\u5916\u6D41\u51FA"],
    ["inout", "\u53CC\u5411", "\u7535\u6C14\u7F51\u7EDC\u9ED8\u8BA4\uFF0C\u4E24\u4FA7\u90FD\u53EF\u63A5\u7EBF\uFF0C\u4E5F\u53EF\u5F53\u6D4B\u8BD5\u70B9"]
  ];
  function describeBlockPorts(spec) {
    const ports = Array.isArray(spec?.ports) ? spec.ports : [];
    if (String(spec?.mode || "") === "circuit" && ports.length) {
      const grouped = { input: [], output: [], inout: [] };
      for (const port of ports) {
        const bucket = grouped[port.direction] || grouped.inout;
        bucket.push(port.name);
      }
      const parts = [];
      for (const key of ["input", "output", "inout"]) {
        if (grouped[key].length) parts.push(`${MODULE_DIR_LABEL[key]} ${grouped[key].join("/")}`);
      }
      return parts.join("   ") || "\u65E0\u7AEF\u53E3";
    }
    const inputs = (spec?.inputs || []).map((port) => port.name).join(", ") || "\u2014";
    const outputs = (spec?.outputs || []).map((port) => port.name).join(", ") || "\u2014";
    return `${inputs} \u2192 ${outputs}`;
  }
  function modulePortList(block) {
    return (block?.ports || []).map((port) => ({
      name: String(port.name || "port"),
      direction: String(port.direction || (port.dtype === "electrical" ? "inout" : "input")),
      dtype: String(port.dtype || ""),
      net: String(port.net || "")
    }));
  }
  function renderModuleSide(block) {
    const side = ui.modulePorts;
    if (side) {
      side.replaceChildren();
      const ports = modulePortList(block);
      side.appendChild(el("h4", null, `\u7AEF\u53E3\uFF08${ports.length}\uFF09`));
      if (!ports.length) side.appendChild(div("help", "\u8FD9\u4E2A\u6A21\u5757\u6CA1\u6709\u7AEF\u53E3\u3002"));
      for (const port of ports) {
        const row = div("port-row");
        row.appendChild(el("span", "port-dir", MODULE_DIR_GLYPH[port.direction] || "\xB7"));
        const name = el("span", "port-name", port.name);
        name.title = `${port.name} \xB7 ${port.direction}${port.net ? ` \xB7 ${port.net}` : ""}`;
        row.appendChild(name);
        row.appendChild(el("span", "badge gray", port.dtype === "electrical" ? "\u7535\u6C14" : "\u4FE1\u53F7"));
        side.appendChild(row);
      }
    }
    const meta = ui.moduleMeta;
    if (meta) {
      meta.replaceChildren();
      const rows = [
        ["\u8282\u70B9", String((block?.nodes || []).length)],
        ["\u8FDE\u7EBF", String((block?.edges || []).length)],
        ["\u7AEF\u53E3", String((block?.ports || []).length)],
        ["\u7248\u672C", `v${Number(block?.version || 1)}`],
        ["\u6A21\u578B", block?.model === "structural" ? "\u7ED3\u6784" : "\u884C\u4E3A"]
      ];
      for (const [key, value] of rows) {
        meta.appendChild(el("span", null, key));
        meta.appendChild(el("b", null, value));
      }
    }
  }
  function drawModulePreview() {
    const canvas2 = ui.moduleCanvas;
    const block = state.moduleBlock;
    const stage2 = ui.moduleStage;
    if (!canvas2 || !stage2 || !block) return;
    const ctx2 = canvas2.getContext("2d");
    if (!ctx2) return;
    const box = stage2.getBoundingClientRect();
    const width = Math.round(box.width);
    const height = Math.round(box.height);
    if (width < 20 || height < 20) return;
    const dpr = window.devicePixelRatio || 1;
    canvas2.width = Math.round(width * dpr);
    canvas2.height = Math.round(height * dpr);
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, width, height);
    ctx2.fillStyle = C("#faf8f2");
    ctx2.fillRect(0, 0, width, height);
    const nodes = (block.nodes || []).map((node) => ({
      id: String(node.id || ""),
      label: String(node.params?.port_name || node.name || node.label || node.kind || node.id || "?"),
      kind: String(node.kind || ""),
      x: Number(node.position?.x ?? node.x ?? 0),
      y: Number(node.position?.y ?? node.y ?? 0)
    }));
    const isEmpty = !nodes.length;
    if (ui.moduleEmpty) ui.moduleEmpty.hidden = !isEmpty;
    canvas2.hidden = isEmpty;
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
    ctx2.strokeStyle = C("#ded7c8");
    ctx2.lineWidth = 1;
    for (const edge of block.edges || []) {
      const source = byId.get(String(edge.source || ""));
      const target = byId.get(String(edge.target || ""));
      if (!source || !target) continue;
      const a = project(source);
      const b = project(target);
      ctx2.beginPath();
      ctx2.moveTo(a.x, a.y);
      ctx2.lineTo(b.x, b.y);
      ctx2.stroke();
    }
    ctx2.font = '10px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx2.textAlign = "center";
    ctx2.textBaseline = "middle";
    for (const node of nodes) {
      const point = project(node);
      const isPort = portNets.has(node.id);
      const isGround = node.kind === "ground";
      const isDevice = node.kind === "device";
      const text = node.label.length > 12 ? `${node.label.slice(0, 11)}\u2026` : node.label;
      const w = Math.max(54, Math.round(ctx2.measureText(text).width) + 18);
      const h = 22;
      const fill = isPort ? "#fdf3e4" : isGround ? "#eaf3e8" : isDevice ? "#eef1f6" : "#ffffff";
      const stroke = isPort ? "#c07a1c" : isGround ? "#4f8a4a" : isDevice ? "#7f8b9e" : "#cfc8b8";
      const ink = isPort ? "#8a5310" : isGround ? "#2f5a2b" : isDevice ? "#38414f" : "#3b3830";
      ctx2.beginPath();
      ctx2.rect(point.x - w / 2, point.y - h / 2, w, h);
      ctx2.fillStyle = C(fill);
      ctx2.fill();
      ctx2.strokeStyle = C(stroke);
      ctx2.lineWidth = isPort ? 1.6 : 1;
      ctx2.stroke();
      ctx2.fillStyle = C(ink);
      ctx2.fillText(text, point.x, point.y);
    }
    ctx2.textAlign = "left";
    ctx2.fillStyle = C("#969083");
    ctx2.font = '9.5px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx2.fillText(`\u53EA\u8BFB\u9884\u89C8 \xB7 ${block.name || block.id} \xB7 ${nodes.length} \u8282\u70B9 / ${(block.edges || []).length} \u8FDE\u7EBF`, 12, height - 12);
  }
  function layoutModuleWindow() {
    if (!ui.moduleWin) return;
    ui.moduleWin.classList.toggle("docked", Boolean(state.moduleDock));
    if (ui.moduleDock) ui.moduleDock.classList.toggle("on", Boolean(state.moduleDock));
  }
  function openModuleInternal(blockId, block) {
    const run = async () => {
      let target = block;
      if (!target) {
        const response = await task(
          () => jsonRequest(`/api/blocks/${encodeURIComponent(blockId)}`, "GET"),
          { dirty: false }
        );
        if (!response?.block) return;
        target = response.block;
      }
      state.moduleBlock = target;
      if (ui.moduleWinTitle) ui.moduleWinTitle.textContent = target.name || target.id || "\u6A21\u5757\u5185\u90E8";
      if (ui.moduleWinHint) {
        const suffix = target.builtin ? " \xB7 \u5185\u7F6E\u7ED3\u6784\u53EA\u8BFB\uFF0C\u53EF\u53E6\u5B58\u526F\u672C" : "";
        ui.moduleWinHint.textContent = `MODULE \xB7 ${(target.nodes || []).length} \u8282\u70B9 \xB7 v${Number(target.version || 1)}${suffix}`;
      }
      if (ui.moduleEdit) {
        ui.moduleEdit.textContent = target.builtin ? "\u5728\u4E34\u65F6\u7F51\u7EDC\u4E2D\u53E6\u5B58\u526F\u672C" : "\u5728\u4E34\u65F6\u7F51\u7EDC\u4E2D\u7F16\u8F91";
      }
      renderModuleSide(target);
      ui.moduleWin.hidden = false;
      layoutModuleWindow();
      if (!state.moduleDock) {
        placeFloatWindow(ui.moduleWin, "moduleGeo");
        raiseFloatWindow(ui.moduleWin);
      }
      requestAnimationFrame(() => drawModulePreview());
    };
    void run();
  }
  function closeModuleInternal() {
    if (!ui.moduleWin || ui.moduleWin.hidden) return;
    ui.moduleWin.hidden = true;
    toast("\u5DF2\u5173\u95ED\u6A21\u5757\u5185\u90E8\u89C6\u56FE", "info", 1800);
  }
  function toggleModuleDock() {
    if (!ui.moduleWin) return;
    state.moduleDock = !state.moduleDock;
    layoutModuleWindow();
    if (state.moduleDock) {
      ui.moduleWin.hidden = false;
      ui.moduleWin.classList.remove("moved");
      ui.moduleWin.style.left = "";
      ui.moduleWin.style.top = "";
      ui.moduleWin.style.width = "";
      ui.moduleWin.style.height = "";
      requestAnimationFrame(() => drawModulePreview());
    } else {
      placeFloatWindow(ui.moduleWin, "moduleGeo");
      raiseFloatWindow(ui.moduleWin);
      requestAnimationFrame(() => drawModulePreview());
    }
  }
  function initModuleWindow() {
    if (!ui.moduleWin) return;
    initFloatWindow(ui.moduleWin, "moduleGeo", { minWidth: 520, minHeight: 340 });
    ui.moduleWinClose?.addEventListener("click", () => closeModuleInternal());
    ui.moduleDock?.addEventListener("click", () => toggleModuleDock());
    ui.moduleEdit?.addEventListener("click", () => {
      const block = state.moduleBlock;
      if (!block?.id) return;
      void openBlockInternal(block.id).then((ok) => {
        if (ok) closeModuleInternal();
      });
    });
    ui.moduleAddInstance?.addEventListener("click", () => {
      const block = state.moduleBlock;
      if (!block?.id) return;
      void instantiateBlockFromLibrary(block.id);
    });
    if (ui.moduleStage && typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(() => {
        if (!ui.moduleWin?.hidden) drawModulePreview();
      });
      observer.observe(ui.moduleStage);
    }
  }
  async function saveCurrentAsBlockCopy() {
    const proposed = window.prompt("\u526F\u672C\u6A21\u5757\u540D\u79F0\uFF08\u65B0 id\uFF0Cv1\uFF09", `${state.currentNetwork?.name || "\u6A21\u5757"}-copy`);
    if (proposed === null) return;
    const response = await task(
      () => jsonRequest("/api/blocks/save-copy", "POST", { name: proposed })
    );
    if (!response) return;
    await refreshBlocks();
    await fetchNetworks();
    toast(`\u5DF2\u53E6\u5B58\u4E3A\u6A21\u5757\u526F\u672C\u300C${response.block.name}\u300D\uFF08id=${response.block.id}\uFF09`, "ok", 3400);
  }
  async function importBlockFile() {
    const input = el("input");
    input.type = "file";
    input.accept = ".block,application/json";
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const report = await task(
          () => jsonRequest("/api/blocks/validate", "POST", { payload }),
          { dirty: false }
        );
        if (!report) return;
        if (!report.ok) {
          const lines = (report.blocking || []).map((item) => `\xB7 [${item.code}] ${item.message}`);
          showBanner(`\u6A21\u5757\u6821\u9A8C\u672A\u901A\u8FC7\uFF1A${lines.join("\uFF1B")}`);
          toast("\u6A21\u5757\u6821\u9A8C\u672A\u901A\u8FC7\uFF0C\u5DF2\u963B\u6B62\u5BFC\u5165\uFF08\u62A5\u544A\u89C1\u9876\u90E8\u6A2A\u5E45\uFF09", "error", 6e3);
          return;
        }
        if ((report.warnings || []).length) {
          const body = div("help");
          body.textContent = (report.warnings || []).map((item) => `\xB7 [${item.code}] ${item.message}`).join("\uFF1B");
          const proceed = await confirmModal(
            `\u6A21\u5757\u6709 ${report.warnings.length} \u6761\u8B66\u544A`,
            body,
            "\u4ECD\u7136\u5BFC\u5165",
            false
          );
          if (!proceed) return;
        }
        const response = await task(
          () => jsonRequest("/api/blocks/import", "POST", { payload })
        );
        if (!response) return;
        await refreshBlocks();
        toast(`\u5DF2\u5BFC\u5165\u6A21\u5757 v${response.version}\uFF08\u5E72\u8DD1 ${report.summary?.dry_run || "skipped"}\uFF09`, "ok", 3e3);
      } catch (error) {
        toast(`\u5BFC\u5165\u5931\u8D25\uFF1A${error.message}`, "error", 5e3);
      }
    });
    input.click();
  }
  function analysisSignalKey() {
    if (state.chart.selected.size) return [...state.chart.selected][0];
    const keys = state.sim?.probe_keys || [];
    return keys[0] || "";
  }
  async function analysisGet(path, query) {
    const qs = query ? `?${new URLSearchParams(query)}` : "";
    return task(() => jsonRequest(`${path}${qs}`, "GET"), { dirty: false });
  }
  function setAnalysisOutput(text) {
    state.analysisLast = text;
    const out = $("#analysisOut");
    if (out) out.textContent = text;
  }
  async function runAnalysisMetrics() {
    const key = analysisSignalKey();
    if (!key) return toast("\u8FD8\u6CA1\u6709\u5F55\u5236\u6570\u636E\uFF1A\u5148\u8FD0\u884C\u4E00\u6BB5\u65F6\u95F4", "info", 2600);
    const response = await analysisGet("/api/analysis/metrics", { keys: key });
    if (!response) return;
    const item = response.items?.[key];
    if (!item || item.ok === false) {
      setAnalysisOutput(JSON.stringify(item || response, null, 2));
      return;
    }
    setAnalysisOutput(
      [
        `\u4FE1\u53F7 ${key}\uFF08${item.samples} \u70B9\uFF09`,
        `\u521D\u503C ${fmt(item.initial, 5)} \u2192 \u7EC8\u503C ${fmt(item.final, 5)}`,
        `min ${fmt(item.min, 5)}  max ${fmt(item.max, 5)}  mean ${fmt(item.mean, 5)}  rms ${fmt(item.rms, 5)}`,
        `\u8D85\u8C03 ${fmt(item.overshoot_pct, 2)}%   \u4E0A\u5347\u65F6\u95F4 ${item.rise_time == null ? "\u2014" : fmt(item.rise_time, 5) + " s"}`,
        `\u8C03\u8282\u65F6\u95F4(\xB1${item.settle_band_pct}%) ${item.settling_time == null ? "\u2014" : fmt(item.settling_time, 5) + " s"}`,
        `\u6765\u6E90\uFF1A${item.source}`,
        `\u8017\u65F6 ${response.elapsed_ms ?? "?"} ms`
      ].join("\n")
    );
  }
  async function runAnalysisSpectrum() {
    const key = analysisSignalKey();
    if (!key) return toast("\u8FD8\u6CA1\u6709\u5F55\u5236\u6570\u636E\uFF1A\u5148\u8FD0\u884C\u4E00\u6BB5\u65F6\u95F4", "info", 2600);
    const response = await analysisGet("/api/analysis/spectrum", { key });
    if (!response) return;
    state.analysisSpectrum = response;
    const peaks = (response.peaks || []).map((p) => `${fmt(p.freq, 3)} Hz  |X|=${fmt(p.magnitude, 4)}`).join("\n");
    setAnalysisOutput([`FFT\uFF08${response.window} \u7A97\uFF0Cdt=${fmt(response.dt, 5)} s\uFF09`, peaks, `\u6765\u6E90\uFF1A${response.source}`].join("\n"));
    drawAnalysisSpectrum();
  }
  async function runAnalysisPeriod() {
    const key = analysisSignalKey();
    if (!key) return toast("\u8FD8\u6CA1\u6709\u5F55\u5236\u6570\u636E\uFF1A\u5148\u8FD0\u884C\u4E00\u6BB5\u65F6\u95F4", "info", 2600);
    const response = await analysisGet("/api/analysis/period", { key });
    if (!response) return;
    if (!response.ok) {
      setAnalysisOutput(`\u5468\u671F\u63A8\u8350\uFF1A\u5931\u8D25
\u539F\u56E0\uFF1A${response.reason}
\u8BCA\u65AD\uFF1A${response.diagnosis}`);
      return;
    }
    const lines = [`\u5468\u671F\u63A8\u8350\uFF1AT \u2248 ${fmt(response.period, 5)} s\uFF08score ${fmt(response.score, 3)}\uFF0C${fmt(response.cycles, 2)} \u4E2A\u5468\u671F\uFF09`];
    for (const item of response.candidates || []) lines.push(`  \u5019\u9009 ${fmt(item.period, 5)} s  score ${fmt(item.score, 3)}`);
    lines.push(`\u8BCA\u65AD\uFF1A${response.diagnosis}`);
    lines.push(`\u6765\u6E90\uFF1A${response.source}`);
    setAnalysisOutput(lines.join("\n"));
  }
  async function runAnalysisMath() {
    const response = await analysisGet("/api/analysis/math");
    if (!response) return;
    const lines = (response.rows || []).map((row) => `${row.name} (${row.kind})
  ${row.formula || "\uFF08\u65E0\u516C\u5F0F\uFF09"}`);
    setAnalysisOutput([`\u6570\u5B66\u5F62\u5F0F\uFF08${(response.rows || []).length} \u4E2A\u8282\u70B9\uFF09`, ...lines, `\u6765\u6E90\uFF1A${response.source}`].join("\n"));
  }
  async function runAnalysisTransfer() {
    const input = $("#analysisInputNode")?.value?.trim();
    const output = $("#analysisOutputNode")?.value?.trim();
    if (!input || !output) return toast("\u586B\u5199\u8F93\u5165/\u8F93\u51FA\u8282\u70B9\u540D", "info", 2400);
    const out = $("#analysisTFOut");
    if (out) out.textContent = "\u5206\u6790\u4E2D\u2026";
    try {
      const response = await jsonRequest("/api/analysis/tf", "POST", {
        input_node: input,
        output_node: output,
        points: 240
      });
      if (!response.ok) {
        const reason = `\u4F20\u9012\u51FD\u6570\uFF1A\u65E0\u6CD5\u89E3\u6790
\u539F\u56E0\uFF1A${response.reason || "\u672A\u77E5\u539F\u56E0"}`;
        if (out) out.textContent = reason;
        setAnalysisOutput(reason);
        return;
      }
      state.analysisTF = response;
      const summary = analysisTFSummary(response);
      if (out) out.textContent = summary;
      setAnalysisOutput([`\u7F51\u7EDC\u603B\u4F20\u51FD\uFF08${input} \u2192 ${output}\uFF09`, summary].join("\n"));
      drawAnalysisTF();
    } catch (error) {
      const reason = `\u4F20\u9012\u51FD\u6570\uFF1A\u5931\u8D25
\u539F\u56E0\uFF1A${error?.message || error}`;
      if (out) out.textContent = reason;
      setAnalysisOutput(reason);
      state.analysisTF = null;
      drawAnalysisTF();
    }
  }
  function fmtComplex(value) {
    const real = Number(value?.real ?? value?.re ?? 0);
    const imag = Number(value?.imag ?? value?.im ?? 0);
    if (!Number.isFinite(real) || !Number.isFinite(imag)) return "\u2014";
    if (Math.abs(imag) < 1e-9) return fmt(real, 4);
    const sign = imag < 0 ? "\u2212" : "+";
    return `${fmt(real, 4)} ${sign} ${fmt(Math.abs(imag), 4)}j`;
  }
  function analysisTFSummary(data) {
    const step = data.step || {};
    const metrics = step.metrics || {};
    const stability = { stable: "\u7A33\u5B9A", marginal: "\u4E34\u754C\u7A33\u5B9A", unstable: "\u4E0D\u7A33\u5B9A" }[data.stability] || data.stability || "\u672A\u77E5";
    const lines = [
      `G(s) = ${data.expression}`,
      `\u9636\u6570 ${data.order}\uFF0C\u76F8\u5BF9\u9636 ${data.relative_order}`,
      `\u6781\u70B9\uFF1A${(data.poles || []).map(fmtComplex).join(", ") || "\u65E0"}`,
      `\u96F6\u70B9\uFF1A${(data.zeros || []).map(fmtComplex).join(", ") || "\u65E0"}`,
      `DC \u589E\u76CA\uFF1A${data.dc_gain_finite ? fmt(data.dc_gain, 5) : "\u221E\uFF08\u542B\u79EF\u5206\u73AF\u8282\uFF09"}`,
      `\u7A33\u5B9A\u6027\uFF1A${stability}`
    ];
    if (metrics.final !== null && metrics.final !== void 0) {
      lines.push(
        `\u9636\u8DC3\uFF1A\u7EC8\u503C ${fmt(metrics.final, 5)}\uFF0C\u5CF0\u503C ${fmt(metrics.peak_value, 5)} @ ${fmt(metrics.peak_time, 3)} s\uFF0C\u8D85\u8C03 ${fmt(metrics.overshoot_pct, 2)}%\uFF0C\u4E0A\u5347 ${fmt(metrics.rise_time, 3)} s\uFF0C\u8C03\u8282 ${fmt(metrics.settling_time, 3)} s\uFF0C\u7A33\u6001\u8BEF\u5DEE ${fmt(metrics.steady_state_error, 4)}`
      );
    } else if (step.stable === false) {
      lines.push("\u9636\u8DC3\uFF1A\u7CFB\u7EDF\u4E0D\u7A33\u5B9A\uFF0C\u65F6\u57DF\u6307\u6807\u4E0D\u9002\u7528");
    }
    for (const item of data.assumptions || []) lines.push(`\u5047\u8BBE\uFF1A${item}`);
    return lines.join("\n");
  }
  async function runAnalysisTF() {
    const node = $("#analysisTFNode")?.value?.trim() || "";
    const expr = $("#analysisTFExpr")?.value?.trim() || "";
    if (!node && !expr) return toast("\u9009\u62E9\u4F20\u9012\u51FD\u6570\u8282\u70B9\u6216\u8F93\u5165 s \u57DF\u8868\u8FBE\u5F0F", "info", 2400);
    const out = $("#analysisTFOut");
    if (out) out.textContent = "\u5206\u6790\u4E2D\u2026";
    try {
      const response = await jsonRequest("/api/analysis/tf", "POST", {
        node: node || null,
        expr: node ? null : expr,
        points: 240
      });
      state.analysisTF = response;
      if (out) out.textContent = analysisTFSummary(response);
      drawAnalysisTF();
    } catch (error) {
      state.analysisTF = null;
      const text = `\u4F20\u9012\u51FD\u6570\u5206\u6790\uFF1A\u5931\u8D25
\u539F\u56E0\uFF1A${error?.message || error}`;
      if (out) out.textContent = text;
      drawAnalysisTF();
    }
  }
  function drawAnalysisTF() {
    const canvas2 = $("#analysisTFChart");
    const data = state.analysisTF;
    if (!canvas2 || !data) return;
    attachTfCursor();
    const dpr = window.devicePixelRatio || 1;
    const width = canvas2.clientWidth || 360;
    const height = canvas2.clientHeight || 210;
    canvas2.width = Math.round(width * dpr);
    canvas2.height = Math.round(height * dpr);
    const ctx2 = canvas2.getContext("2d");
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, width, height);
    const view = $("#analysisTFView")?.value || "bode";
    if (view === "step") drawTFStep(ctx2, data, width, height);
    else if (view === "poles") drawTFPoles(ctx2, data, width, height);
    else drawTFBode(ctx2, data, width, height);
  }
  function tfRange(values) {
    const finite = values.filter((value) => Number.isFinite(value));
    if (!finite.length) return [0, 1];
    let low = Math.min(...finite);
    let high = Math.max(...finite);
    if (high - low < 1e-9) {
      low -= 1;
      high += 1;
    }
    const pad = (high - low) * 0.1;
    return [low - pad, high + pad];
  }
  function drawTFBode(ctx2, data, width, height) {
    const bode = data.bode || {};
    const omega = (bode.omega || []).map(Number);
    const magnitude = (bode.magnitude_db || []).map(Number);
    const phase = (bode.phase_deg || []).map(Number);
    if (omega.length < 2 || !magnitude.some(Number.isFinite)) return;
    const left = 44;
    const right = 10;
    const top = 12;
    const bottom = 20;
    const gap = 16;
    const plotWidth = Math.max(24, width - left - right);
    const plotHeight = Math.max(28, (height - top - bottom - gap) / 2);
    const phaseTop = top + plotHeight + gap;
    const logMin = Math.log10(Math.max(omega[0], 1e-9));
    const logMax = Math.log10(Math.max(omega[omega.length - 1], 1e-8));
    const logSpan = Math.max(logMax - logMin, 1e-9);
    const xAt = (index) => left + plotWidth * ((Math.log10(Math.max(omega[index], 1e-9)) - logMin) / logSpan);
    const grid = "rgba(104, 94, 78, 0.18)";
    const axis = "rgba(104, 94, 78, 0.42)";
    ctx2.font = '9px "Cascadia Code", Consolas, monospace';
    const panel = (base, values, color, unit) => {
      const [low, high] = tfRange(values);
      ctx2.strokeStyle = grid;
      ctx2.fillStyle = C("#7b7266");
      ctx2.textAlign = "right";
      for (let index = 0; index <= 3; index += 1) {
        const y = base + plotHeight * index / 3;
        ctx2.beginPath();
        ctx2.moveTo(left, y);
        ctx2.lineTo(left + plotWidth, y);
        ctx2.stroke();
        ctx2.fillText(fmt(high - (high - low) * index / 3, 2), left - 4, y + 3);
      }
      ctx2.textAlign = "left";
      ctx2.fillText(unit, 3, base + 8);
      ctx2.strokeStyle = axis;
      ctx2.beginPath();
      ctx2.moveTo(left, base + plotHeight + 0.5);
      ctx2.lineTo(left + plotWidth, base + plotHeight + 0.5);
      ctx2.stroke();
      ctx2.strokeStyle = color;
      ctx2.lineWidth = 1.4;
      ctx2.beginPath();
      let started = false;
      for (let index = 0; index < Math.min(omega.length, values.length); index += 1) {
        const value = values[index];
        if (!Number.isFinite(value)) {
          started = false;
          continue;
        }
        const x = xAt(index);
        const y = base + plotHeight * (1 - (value - low) / Math.max(high - low, 1e-9));
        if (!started) {
          ctx2.moveTo(x, y);
          started = true;
        } else {
          ctx2.lineTo(x, y);
        }
      }
      ctx2.stroke();
    };
    panel(top, magnitude, C("#a8541f"), "dB");
    panel(phaseTop, phase, C("#3f6f8f"), "deg");
    ctx2.strokeStyle = grid;
    ctx2.fillStyle = C("#7b7266");
    ctx2.textAlign = "center";
    let decades = 0;
    for (let exponent = Math.ceil(logMin); exponent <= Math.floor(logMax); exponent += 1) {
      const x = left + plotWidth * ((exponent - logMin) / logSpan);
      ctx2.beginPath();
      ctx2.moveTo(x, top);
      ctx2.lineTo(x, phaseTop + plotHeight);
      ctx2.stroke();
      ctx2.fillText(`10^${exponent}`, x, height - 5);
      decades += 1;
    }
    if (!decades) {
      ctx2.textAlign = "left";
      ctx2.fillText(fmt(omega[0], 2), left, height - 5);
      ctx2.textAlign = "right";
      ctx2.fillText(fmt(omega[omega.length - 1], 2), left + plotWidth, height - 5);
    }
    ctx2.textAlign = "left";
    ctx2.fillStyle = C("#7b7266");
    ctx2.fillText("rad/s", left + plotWidth - 34, height - 5);
    const cursor = state.tfCursor;
    if (cursor != null && cursor >= 0 && cursor < omega.length) {
      const x = xAt(cursor);
      ctx2.save();
      ctx2.strokeStyle = "rgba(168, 84, 31, 0.55)";
      ctx2.setLineDash([4, 3]);
      ctx2.beginPath();
      ctx2.moveTo(x, top);
      ctx2.lineTo(x, phaseTop + plotHeight);
      ctx2.stroke();
      ctx2.setLineDash([]);
      const dot = (base, value) => {
        if (!Number.isFinite(value)) return;
        const [low, high] = tfRange(base === top ? magnitude : phase);
        const y = base + plotHeight * (1 - (value - low) / Math.max(high - low, 1e-9));
        ctx2.fillStyle = C("#a8541f");
        ctx2.beginPath();
        ctx2.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx2.fill();
      };
      dot(top, magnitude[cursor]);
      dot(phaseTop, phase[cursor]);
      const label = `\u03C9=${fmt(omega[cursor], 3)}  |G|=${fmt(magnitude[cursor], 2)} dB  \u2220=${fmt(phase[cursor], 1)}\xB0`;
      ctx2.font = '10px "Cascadia Code", Consolas, monospace';
      const labelWidth = ctx2.measureText(label).width + 12;
      ctx2.fillStyle = "rgba(251, 248, 242, 0.94)";
      ctx2.strokeStyle = "rgba(168, 84, 31, 0.35)";
      ctx2.beginPath();
      ctx2.roundRect(left + 4, top + 3, Math.min(labelWidth, plotWidth - 8), 18, 4);
      ctx2.fill();
      ctx2.stroke();
      ctx2.fillStyle = C("#5f3a20");
      ctx2.textAlign = "left";
      ctx2.fillText(label, left + 10, top + 16);
      ctx2.restore();
    }
  }
  function tfBodeCursorFromEvent(event) {
    const data = state.analysisTF;
    const canvas2 = $("#analysisTFChart");
    const bode = data?.bode;
    if (!canvas2 || !bode?.omega?.length) return null;
    const rect = canvas2.getBoundingClientRect();
    const left = 44;
    const right = 10;
    const width = rect.width;
    const plotWidth = Math.max(24, width - left - right);
    const x = event.clientX - rect.left;
    if (x < left || x > left + plotWidth) return null;
    const omega = bode.omega.map(Number);
    const logMin = Math.log10(Math.max(omega[0], 1e-9));
    const logMax = Math.log10(Math.max(omega[omega.length - 1], 1e-8));
    const target = logMin + (x - left) / plotWidth * Math.max(logMax - logMin, 1e-9);
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < omega.length; index += 1) {
      const distance2 = Math.abs(Math.log10(Math.max(omega[index], 1e-9)) - target);
      if (distance2 < bestDistance) {
        bestDistance = distance2;
        best = index;
      }
    }
    return best;
  }
  function attachTfCursor() {
    const canvas2 = $("#analysisTFChart");
    if (!canvas2 || canvas2.dataset.tfCursor === "1") return;
    canvas2.dataset.tfCursor = "1";
    canvas2.addEventListener("mousemove", (event) => {
      const view = $("#analysisTFView")?.value || "bode";
      if (view !== "bode") return;
      const index = tfBodeCursorFromEvent(event);
      if (index == null) return;
      state.tfCursor = index;
      drawAnalysisTF();
    });
    canvas2.addEventListener("mouseleave", () => {
      if (state.tfCursor == null) return;
      state.tfCursor = null;
      drawAnalysisTF();
    });
  }
  function drawTFStep(ctx2, data, width, height) {
    const step = data.step || {};
    const time = (step.t || []).map(Number);
    const values = (step.y || []).map(Number);
    if (time.length < 2 || !values.some(Number.isFinite)) return;
    const left = 46;
    const right = 10;
    const top = 12;
    const bottom = 20;
    const plotWidth = Math.max(24, width - left - right);
    const plotHeight = Math.max(24, height - top - bottom);
    const [low, high] = tfRange(values);
    const xAt = (index) => left + plotWidth * ((time[index] - time[0]) / Math.max(time[time.length - 1] - time[0], 1e-9));
    const yAt = (value) => top + plotHeight * (1 - (value - low) / Math.max(high - low, 1e-9));
    const grid = "rgba(104, 94, 78, 0.18)";
    const axis = "rgba(104, 94, 78, 0.42)";
    ctx2.font = '9px "Cascadia Code", Consolas, monospace';
    ctx2.strokeStyle = grid;
    ctx2.fillStyle = C("#7b7266");
    ctx2.textAlign = "right";
    for (let index = 0; index <= 3; index += 1) {
      const y = top + plotHeight * index / 3;
      ctx2.beginPath();
      ctx2.moveTo(left, y);
      ctx2.lineTo(left + plotWidth, y);
      ctx2.stroke();
      ctx2.fillText(fmt(high - (high - low) * index / 3, 3), left - 4, y + 3);
    }
    ctx2.strokeStyle = axis;
    ctx2.beginPath();
    ctx2.moveTo(left, top + plotHeight + 0.5);
    ctx2.lineTo(left + plotWidth, top + plotHeight + 0.5);
    ctx2.stroke();
    const metrics = step.metrics || {};
    if (Number.isFinite(metrics.final)) {
      ctx2.setLineDash([4, 4]);
      ctx2.strokeStyle = "rgba(63, 111, 143, 0.55)";
      ctx2.beginPath();
      ctx2.moveTo(left, yAt(metrics.final));
      ctx2.lineTo(left + plotWidth, yAt(metrics.final));
      ctx2.stroke();
      ctx2.setLineDash([]);
    }
    ctx2.strokeStyle = C("#a8541f");
    ctx2.lineWidth = 1.5;
    ctx2.beginPath();
    let started = false;
    for (let index = 0; index < Math.min(time.length, values.length); index += 1) {
      const value = values[index];
      if (!Number.isFinite(value)) {
        started = false;
        continue;
      }
      const x = xAt(index);
      const y = yAt(value);
      if (!started) {
        ctx2.moveTo(x, y);
        started = true;
      } else {
        ctx2.lineTo(x, y);
      }
    }
    ctx2.stroke();
    if (Number.isFinite(metrics.peak_value) && Number.isFinite(metrics.peak_time)) {
      let peakIndex = 0;
      let best = Infinity;
      for (let index = 0; index < Math.min(time.length, values.length); index += 1) {
        if (!Number.isFinite(time[index])) continue;
        const distance2 = Math.abs(time[index] - metrics.peak_time);
        if (distance2 < best) {
          best = distance2;
          peakIndex = index;
        }
      }
      const px = xAt(peakIndex);
      const py = yAt(metrics.peak_value);
      ctx2.fillStyle = C("#8a4b12");
      ctx2.beginPath();
      ctx2.arc(px, py, 2.6, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.textAlign = px > left + plotWidth * 0.66 ? "right" : "left";
      ctx2.fillText(
        `\u5CF0\u503C ${fmt(metrics.peak_value, 3)} @ ${fmt(metrics.peak_time, 3)} s`,
        px + (ctx2.textAlign === "right" ? -5 : 5),
        Math.max(top + 9, py - 6)
      );
    }
    ctx2.fillStyle = C("#7b7266");
    ctx2.textAlign = "left";
    ctx2.fillText("0 s", left, height - 5);
    ctx2.textAlign = "right";
    ctx2.fillText(`${fmt(time[time.length - 1], 3)} s`, left + plotWidth, height - 5);
  }
  function drawTFPoles(ctx2, data, width, height) {
    const poles = data.poles || [];
    const zeros = data.zeros || [];
    const left = 18;
    const right = 10;
    const top = 12;
    const bottom = 18;
    const plotWidth = Math.max(24, width - left - right);
    const plotHeight = Math.max(24, height - top - bottom);
    const all = [...poles, ...zeros];
    let extent = 1;
    for (const point of all) {
      extent = Math.max(extent, Math.abs(Number(point.real) || 0), Math.abs(Number(point.imag) || 0));
    }
    extent *= 1.15;
    const cx = left + plotWidth / 2;
    const cy = top + plotHeight / 2;
    const scale = Math.min(plotWidth / (2 * extent), plotHeight / (2 * extent));
    const xAt = (real) => cx + real * scale;
    const yAt = (imag) => cy - imag * scale;
    ctx2.fillStyle = "rgba(63, 111, 143, 0.08)";
    ctx2.fillRect(left, top, plotWidth / 2, plotHeight);
    const grid = "rgba(104, 94, 78, 0.18)";
    const axis = "rgba(104, 94, 78, 0.5)";
    ctx2.strokeStyle = grid;
    ctx2.beginPath();
    ctx2.moveTo(cx, top);
    ctx2.lineTo(cx, top + plotHeight);
    ctx2.moveTo(left, cy);
    ctx2.lineTo(left + plotWidth, cy);
    ctx2.stroke();
    ctx2.strokeStyle = axis;
    ctx2.beginPath();
    ctx2.moveTo(cx, top);
    ctx2.lineTo(cx, top + plotHeight);
    ctx2.moveTo(left, cy);
    ctx2.lineTo(left + plotWidth, cy);
    ctx2.stroke();
    ctx2.font = '9px "Cascadia Code", Consolas, monospace';
    ctx2.fillStyle = C("#7b7266");
    ctx2.textAlign = "center";
    ctx2.fillText("Re", left + plotWidth - 10, cy - 4);
    ctx2.textAlign = "left";
    ctx2.fillText("Im", cx + 4, top + 8);
    for (const point of zeros) {
      const x = xAt(Number(point.real) || 0);
      const y = yAt(Number(point.imag) || 0);
      ctx2.strokeStyle = C("#3f6f8f");
      ctx2.lineWidth = 1.3;
      ctx2.beginPath();
      ctx2.arc(x, y, 4, 0, Math.PI * 2);
      ctx2.stroke();
    }
    for (const point of poles) {
      const x = xAt(Number(point.real) || 0);
      const y = yAt(Number(point.imag) || 0);
      ctx2.strokeStyle = C("#a8541f");
      ctx2.lineWidth = 1.6;
      ctx2.beginPath();
      ctx2.moveTo(x - 4, y - 4);
      ctx2.lineTo(x + 4, y + 4);
      ctx2.moveTo(x + 4, y - 4);
      ctx2.lineTo(x - 4, y + 4);
      ctx2.stroke();
    }
    ctx2.fillStyle = C("#7b7266");
    ctx2.textAlign = "left";
    ctx2.fillText("\xD7 \u6781\u70B9   \u25CB \u96F6\u70B9", left + 2, top + 9);
  }
  function exportTFStateSpace() {
    const space = state.analysisTF?.state_space;
    if (!space) {
      toast("\u5F53\u524D\u4F20\u9012\u51FD\u6570\u6CA1\u6709 A/B/C/D\uFF08\u9759\u6001\u589E\u76CA\u6216 z \u57DF\u7ED3\u679C\uFF09", "info", 3200);
      return;
    }
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    downloadText(JSON.stringify({ version: 1, state_space: space }, null, 2), `netlab-state-space-${stamp}.json`);
    toast(`\u5DF2\u5BFC\u51FA ${space.order} \u9636 A/B/C/D`, "ok", 2600);
  }
  async function sendCurveToPlotKit(name, x, y, xLabel, yLabel) {
    if (!Array.isArray(x) || !Array.isArray(y) || x.length < 2 || x.length !== y.length) {
      toast("\u8FD9\u6761\u66F2\u7EBF\u4E3A\u7A7A\uFF0C\u65E0\u6CD5\u53D1\u9001\u5230 PlotKit", "info", 2800);
      return null;
    }
    try {
      const response = await jsonRequest("/api/plotkit/analysis", "POST", {
        name,
        x,
        y,
        x_label: xLabel,
        y_label: yLabel
      });
      if (!response?.ok) {
        toast(`PlotKit \u63A5\u6536\u5931\u8D25\uFF1A${response?.reason || "\u672A\u6302\u8F7D"}`, "error", 4200);
        return null;
      }
      toast(`\u5DF2\u53D1\u9001\u300C${response.label}\u300D\u5230 PlotKit\uFF08${response.points} \u70B9\uFF09`, "ok", 3200);
      return response;
    } catch (error) {
      toast(`PlotKit \u63A5\u6536\u5931\u8D25\uFF1A${error.message}`, "error", 4200);
      return null;
    }
  }
  async function sendTFToPlotKit() {
    const step = state.analysisTF?.step;
    if (!step?.t || !step?.y) {
      toast("\u5148\u63A8\u5BFC\u4E00\u6761\u4F20\u9012\u51FD\u6570\u9636\u8DC3\u54CD\u5E94", "info", 3e3);
      return;
    }
    await sendCurveToPlotKit("TF \u9636\u8DC3\u54CD\u5E94", step.t, step.y, "t / s", "\u5E45\u503C");
  }
  function phaseSeriesForPlotKit() {
    const node = nodeByName(state.phaseNode);
    if (!node) return null;
    const frames = state.frames || [];
    const pairs = [];
    const stateKeys = phaseStateKeys(node);
    if (stateKeys.length >= 2) pairs.push([stateKeys[0], stateKeys[1]]);
    pairs.push(
      [`n:${node.name}:x`, `n:${node.name}:y`],
      [`n:${node.name}:vx`, `n:${node.name}:vy`],
      [`n:${node.name}:x1`, `n:${node.name}:x2`]
    );
    for (const [keyX, keyY] of pairs) {
      const points = frames.filter(
        (frame) => typeof frame.v?.[keyX] === "number" && typeof frame.v?.[keyY] === "number"
      );
      if (points.length >= 2) {
        return {
          name: `\u76F8\u56FE ${node.name}`,
          x: points.map((frame) => frame.v[keyX]),
          y: points.map((frame) => frame.v[keyY]),
          xLabel: keyX.split(":").pop(),
          yLabel: keyY.split(":").pop()
        };
      }
    }
    return null;
  }
  async function sendPhaseToPlotKit() {
    const series = phaseSeriesForPlotKit();
    if (!series) {
      toast("\u5F53\u524D\u76F8\u56FE\u6CA1\u6709\u53EF\u53D1\u9001\u7684\u8F68\u8FF9", "info", 3e3);
      return;
    }
    await sendCurveToPlotKit(series.name, series.x, series.y, series.xLabel, series.yLabel);
  }
  async function exportAnalysisCsv(keys = null, defaultName = "analysis") {
    const name = window.prompt("CSV \u6587\u4EF6\u540D\uFF08\u5199\u5165 exports/\uFF0C\u540C\u540D\u81EA\u52A8\u52A0\u5E8F\u53F7\uFF09", defaultName);
    if (name === null) return;
    const key = analysisSignalKey();
    const wanted = Array.isArray(keys) && keys.length ? keys : key ? [key] : null;
    const response = await task(
      () => jsonRequest("/api/analysis/export", "POST", { name: name || defaultName, keys: wanted, decimate: 1 })
    );
    if (!response) return;
    setAnalysisOutput(`\u5DF2\u5BFC\u51FA ${response.rows} \u884C \u2192 ${response.path}
\u5217\uFF1A${(response.columns || []).join(", ")}`);
    toast(`CSV \u5DF2\u5199\u5165 ${response.path}`, "ok", 3400);
  }
  function drawAnalysisSpectrum() {
    const canvas2 = $("#analysisChart");
    const data = state.analysisSpectrum;
    if (!canvas2 || !data) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas2.clientWidth || 320;
    const height = canvas2.clientHeight || 150;
    canvas2.width = Math.round(width * dpr);
    canvas2.height = Math.round(height * dpr);
    const ctx2 = canvas2.getContext("2d");
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, width, height);
    const mags = data.magnitude || [];
    const freqs = data.freqs || [];
    if (!mags.length) return;
    const peak = Math.max(...mags.filter((v) => Number.isFinite(v)), 1e-12);
    const n = Math.min(mags.length, 400);
    const bw = width / n;
    for (let index = 0; index < n; index += 1) {
      const value = mags[index] / peak;
      const barH = Math.max(0, Math.min(1, value)) * (height - 18);
      ctx2.fillStyle = index === 0 ? "#b09a78" : C("rgba(168, 84, 31, 0.55)");
      ctx2.fillRect(index * bw, height - 14 - barH, Math.max(1, bw - 0.5), barH);
    }
    ctx2.strokeStyle = "rgba(104, 94, 78, 0.4)";
    ctx2.beginPath();
    ctx2.moveTo(0, height - 14.5);
    ctx2.lineTo(width, height - 14.5);
    ctx2.stroke();
    ctx2.fillStyle = C("#7b7266");
    ctx2.font = '9px "Cascadia Code", Consolas, monospace';
    ctx2.fillText("0 Hz", 2, height - 3);
    const maxFreq = freqs.length ? freqs[Math.min(freqs.length - 1, 399)] : 0;
    ctx2.fillText(`${fmt(maxFreq, 1)} Hz`, width - 44, height - 3);
  }
  function renderAnalysisPanel() {
    const pane = ui.analysisPane;
    if (!pane) return;
    const host = div("blocks-host");
    const head = div("insp-head");
    const title = div("insp-title");
    title.append(el("h2", null, "\u5206\u6790\uFF08\u65C1\u8DEF\uFF09"), el("p", null, "\u53EA\u8BFB\u5F55\u5236\u6570\u636E\uFF1B\u7ED3\u8BBA\u5E26\u6765\u6E90\uFF0C\u4E0D\u5199\u6C42\u89E3\u5668"));
    head.appendChild(title);
    host.appendChild(head);
    const keys = state.sim?.probe_keys || [];
    const signal = el("select", "input");
    for (const key2 of keys) {
      const option = el("option", null, key2);
      option.value = key2;
      signal.appendChild(option);
    }
    const key = analysisSignalKey();
    if (key) signal.value = key;
    const keyRow = div("field-row");
    keyRow.append(el("label", null, "\u4FE1\u53F7"), signal);
    host.appendChild(keyRow);
    const row = div("blocks-toolbar");
    row.append(
      button("\u6307\u6807", "btn tiny primary", () => void runAnalysisMetrics()),
      button("\u9891\u8C31", "btn tiny", () => void runAnalysisSpectrum()),
      button("\u5468\u671F", "btn tiny", () => void runAnalysisPeriod()),
      button("\u6570\u5B66\u5F62\u5F0F", "btn tiny", () => void runAnalysisMath()),
      button("\u5BFC\u51FA CSV", "btn tiny", () => void exportAnalysisCsv())
    );
    host.appendChild(row);
    const canvas2 = el("canvas", "analysis-chart");
    canvas2.id = "analysisChart";
    host.appendChild(canvas2);
    const transferRow = div("field-row");
    const inputNode = el("input", "input");
    inputNode.id = "analysisInputNode";
    inputNode.placeholder = "\u8F93\u5165\u8282\u70B9\u540D";
    inputNode.value = state.scene?.nodes?.[0]?.name || "";
    const outputNode = el("input", "input");
    outputNode.id = "analysisOutputNode";
    outputNode.placeholder = "\u8F93\u51FA\u8282\u70B9\u540D";
    outputNode.value = state.scene?.nodes?.[state.scene.nodes.length - 1]?.name || "";
    transferRow.append(
      el("label", null, "\u4F20\u9012\u51FD\u6570"),
      inputNode,
      outputNode,
      button("\u63A8\u5BFC", "btn tiny", () => void runAnalysisTransfer()),
      button("\u5BFC\u51FA A/B/C/D", "btn tiny", () => exportTFStateSpace())
    );
    host.appendChild(transferRow);
    const tfSection = div("insp-section");
    tfSection.appendChild(el("h3", null, "\u4F20\u9012\u51FD\u6570\u5206\u6790\uFF08s \u57DF\uFF09"));
    const tfNodes = (state.scene?.nodes || []).filter((node) => node.kind === "transfer_function");
    const tfNode = el("select", "input");
    tfNode.id = "analysisTFNode";
    const tfDirect = el("option", null, "\uFF08\u7528\u8868\u8FBE\u5F0F\uFF09");
    tfDirect.value = "";
    tfNode.appendChild(tfDirect);
    for (const node of tfNodes) {
      const option = el("option", null, node.name);
      option.value = node.name;
      tfNode.appendChild(option);
    }
    const tfExpr = el("input", "input");
    tfExpr.id = "analysisTFExpr";
    tfExpr.placeholder = "\u5982 (2*s+1)/(s^2+3*s+2)";
    tfExpr.value = "1/(s+1)";
    tfNode.addEventListener("change", () => {
      tfExpr.disabled = Boolean(tfNode.value);
    });
    const tfRow = div("field-row");
    tfRow.append(el("label", null, "\u8282\u70B9 / \u8868\u8FBE\u5F0F"), tfNode, tfExpr);
    tfSection.appendChild(tfRow);
    const tfView = el("select", "input");
    tfView.id = "analysisTFView";
    for (const [value, label] of [
      ["bode", "Bode \u56FE"],
      ["step", "\u9636\u8DC3\u54CD\u5E94"],
      ["poles", "\u96F6\u6781\u70B9\u56FE"]
    ]) {
      const option = el("option", null, label);
      option.value = value;
      tfView.appendChild(option);
    }
    tfView.addEventListener("change", () => drawAnalysisTF());
    const tfTools = div("field-row");
    tfTools.append(
      button("\u5206\u6790", "btn tiny primary", () => void runAnalysisTF()),
      button("\u53D1\u9001\u5230 PlotKit", "btn tiny", () => void sendTFToPlotKit()),
      el("label", null, "\u89C6\u56FE"),
      tfView
    );
    tfSection.appendChild(tfTools);
    const tfCanvas = el("canvas", "analysis-chart");
    tfCanvas.id = "analysisTFChart";
    tfCanvas.style.height = "210px";
    tfSection.appendChild(tfCanvas);
    const tfOut = el("pre", "analysis-out");
    tfOut.id = "analysisTFOut";
    tfOut.textContent = state.analysisTF ? analysisTFSummary(state.analysisTF) : "\u9009\u4F20\u9012\u51FD\u6570\u8282\u70B9\u6216\u76F4\u63A5\u5199 s \u8868\u8FBE\u5F0F\uFF0C\u70B9\u300C\u5206\u6790\u300D\u5F97\u5230 Bode / \u9636\u8DC3 / \u96F6\u6781\u70B9\u3002";
    tfSection.appendChild(tfOut);
    host.appendChild(tfSection);
    const out = el("pre", "analysis-out");
    out.id = "analysisOut";
    out.textContent = state.analysisLast || "\u9009\u4FE1\u53F7\u540E\u8FD0\u884C\u6307\u6807/\u9891\u8C31/\u5468\u671F/\u6570\u5B66\u5F62\u5F0F\uFF1B\u4F20\u9012\u51FD\u6570\u586B\u8282\u70B9\u540D\u3002";
    host.appendChild(out);
    const perf = div("insp-section");
    perf.appendChild(el("h3", null, "\u6027\u80FD\u4E0E\u8D85\u65F6\uFF08R13\uFF09"));
    const timeoutInput = el("input", "input");
    timeoutInput.type = "number";
    timeoutInput.id = "analysisStepTimeout";
    timeoutInput.min = "0";
    timeoutInput.step = "0.5";
    timeoutInput.value = String(state.sim?.config?.step_timeout_ms ?? 0);
    const apply = button("\u5E94\u7528\u5355\u6B65\u4E0A\u9650", "btn tiny", async () => {
      const response = await task(() => jsonRequest("/api/config", "PATCH", { step_timeout_ms: Number(timeoutInput.value) || 0 }));
      if (response) toast("\u5355\u6B65\u8D85\u65F6\u5DF2\u66F4\u65B0\uFF080=\u5173\u95ED\uFF09", "ok", 2400);
    });
    const perfRow = div("field-row");
    perfRow.append(el("label", null, "\u5355\u6B65\u4E0A\u9650 ms"), timeoutInput, apply);
    perf.appendChild(perfRow);
    const profileToggle = el("input");
    profileToggle.type = "checkbox";
    profileToggle.id = "analysisProfileEnabled";
    const profileButtons = div("field-row");
    profileButtons.append(
      el("label", null, "\u8BA1\u65F6\u5F00\u5173"),
      profileToggle,
      button("\u5E94\u7528", "btn tiny", async () => {
        const response = await task(() => jsonRequest("/api/profile", "PATCH", {
          enabled: Boolean(profileToggle.checked)
        }));
        if (response) {
          profileToggle.checked = Boolean(response.enabled);
          toast(response.enabled ? "\u6027\u80FD\u8BA1\u65F6\u5DF2\u5F00\u542F" : "\u6027\u80FD\u8BA1\u65F6\u5DF2\u5173\u95ED", "ok", 2200);
        }
      }),
      button("\u6E05\u7A7A", "btn tiny", async () => {
        const response = await task(() => jsonRequest("/api/profile", "PATCH", { reset: true }));
        if (response) toast("\u6027\u80FD\u91C7\u6837\u5DF2\u6E05\u7A7A", "ok", 2e3);
      })
    );
    perf.appendChild(profileButtons);
    const profileOut = el("pre", "analysis-out");
    profileOut.id = "analysisProfile";
    profileOut.textContent = "\u70B9\u51FB\u5237\u65B0\u8BFB\u53D6 /api/profile\uFF08\u9ED8\u8BA4\u5173\u95ED\uFF0C\u5F00\u9500\u53EF\u5FFD\u7565\uFF09";
    perf.appendChild(
      button("\u5237\u65B0\u6027\u80FD", "btn tiny", async () => {
        const response = await task(() => jsonRequest("/api/profile?top=20", "GET"), { dirty: false });
        if (!response) return;
        profileToggle.checked = Boolean(response.enabled);
        const rows = (response.entries || []).map(
          (item) => `${item.name}	${item.count} \u6B21	\u603B ${item.total_ms} ms	\u5747 ${item.mean_ms} ms	\u5CF0 ${item.max_ms} ms`
        );
        profileOut.textContent = [
          `\u8BA1\u65F6\uFF1A${response.enabled ? "\u5F00" : "\u5173"}  \u6837\u672C ${response.samples}/${response.capacity}`,
          ...rows.length ? rows : ["\uFF08\u6682\u65E0\u91C7\u6837\uFF0C\u5F00\u542F\u8BA1\u65F6\u540E\u8FD0\u884C\u4EFF\u771F\uFF09"]
        ].join("\n");
      })
    );
    perf.appendChild(profileOut);
    host.appendChild(perf);
    pane.replaceChildren(host);
    if (state.analysisSpectrum) drawAnalysisSpectrum();
    if (state.analysisTF) drawAnalysisTF();
  }
  function applyUiTokens(tokens2, mode) {
    const root = document.documentElement;
    const tokenVars = {
      background: "--paper",
      surface: "--paper-2",
      panel: "--paper-3",
      text: "--ink",
      muted: "--muted",
      accent: "--accent",
      grid: "--line",
      edge: "--line-strong",
      node: "--ink-2",
      danger: "--red",
      success: "--green"
    };
    for (const [key, value] of Object.entries(tokens2 || {})) {
      root.style.setProperty(`--nl-${key}`, value);
      const target = tokenVars[key];
      if (target) root.style.setProperty(target, value);
    }
    if (tokens2?.accent) root.style.setProperty("--accent-strong", tokens2.accent);
    if (mode) {
      document.body.dataset.canvasMode = mode;
      document.body.classList.toggle("simple-canvas", mode === "simple");
    }
  }
  async function loadUiProfile() {
    try {
      const response = await jsonRequest("/api/ui", "GET");
      if (response?.current) applyUiTokens(response.current.tokens, response.current.mode);
    } catch {
    }
  }
  function openIroColorPopover(anchor, value, onChange) {
    document.querySelectorAll(".iro-popover").forEach((node) => node.remove());
    if (!window.iro || typeof window.iro.ColorPicker !== "function") {
      anchor.click();
      return;
    }
    const pop = div("iro-popover");
    const rect = anchor.getBoundingClientRect();
    pop.style.position = "fixed";
    pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 260))}px`;
    pop.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 300))}px`;
    pop.style.zIndex = "20000";
    pop.style.padding = "10px";
    pop.style.borderRadius = "10px";
    pop.style.background = "var(--panel, #fff)";
    pop.style.boxShadow = "0 12px 36px rgba(0,0,0,.24)";
    pop.style.border = "1px solid var(--line, #ccd4d8)";
    const host = div("iro-host");
    pop.appendChild(host);
    pop.appendChild(button("\u5173\u95ED", "btn tiny", () => pop.remove()));
    document.body.appendChild(pop);
    const picker = new window.iro.ColorPicker(host, { width: 220, color: value || "#000000" });
    picker.on("color:change", (color) => onChange(color.hexString));
    setTimeout(() => {
      const close = (event) => {
        if (pop.contains(event.target) || event.target === anchor) return;
        pop.remove();
        document.removeEventListener("pointerdown", close);
      };
      document.addEventListener("pointerdown", close);
    }, 0);
  }
  async function openViewDesigner() {
    try {
      const response = await jsonRequest("/api/ui", "GET");
      if (!response) return;
      let current = response.current || response.defaults;
      const tokenLabels = {
        background: "\u80CC\u666F",
        surface: "\u8868\u9762",
        panel: "\u9762\u677F",
        text: "\u6587\u5B57",
        muted: "\u6B21\u8981\u6587\u5B57",
        accent: "\u5F3A\u8C03\u8272",
        grid: "\u7F51\u683C",
        edge: "\u8FDE\u7EBF",
        node: "\u8282\u70B9",
        danger: "\u8B66\u793A",
        success: "\u6210\u529F"
      };
      const tokenInputs = {};
      const tokenGrid = div("ui-token-grid");
      for (const [key, value] of Object.entries(current.tokens || {})) {
        const label = div("ui-field");
        label.appendChild(el("span", null, tokenLabels[key] || key));
        const input = el("input", "ui-color");
        input.type = "color";
        input.value = value;
        input.dataset.token = key;
        input.addEventListener("input", () => {
          current.tokens[key] = input.value;
          applyUiTokens(current.tokens);
        });
        tokenInputs[key] = input;
        const colorRow = div("ui-color-row");
        colorRow.appendChild(input);
        colorRow.appendChild(button("\u8C03\u8272", "btn tiny", () => openIroColorPopover(input, input.value, (hex) => {
          input.value = hex;
          current.tokens[key] = hex;
          applyUiTokens(current.tokens);
        })));
        label.appendChild(colorRow);
        tokenGrid.appendChild(label);
      }
      const modeRow = div("ui-field wide");
      modeRow.appendChild(el("span", null, "\u753B\u5E03\u6A21\u5F0F"));
      const modeSelect = el("select");
      for (const [value, label] of [["simple", "\u7B80\u6D01\u753B\u5E03"], ["professional", "\u4E13\u4E1A\u753B\u5E03"]]) {
        const option = el("option", null, label);
        option.value = value;
        modeSelect.appendChild(option);
      }
      modeSelect.value = current.mode || "professional";
      modeSelect.addEventListener("change", () => {
        current.mode = modeSelect.value;
      });
      modeRow.appendChild(modeSelect);
      const layoutRows = div("ui-layout-rows");
      for (const [key, value] of Object.entries(current.layout || {})) {
        const label = div("ui-field wide");
        label.appendChild(el("span", null, key));
        const input = el("input");
        input.type = "range";
        input.min = key === "font_scale" ? "0.6" : "4";
        input.max = key === "font_scale" ? "2.0" : "600";
        input.step = key === "font_scale" ? "0.05" : "1";
        input.value = String(value);
        input.addEventListener("input", () => {
          current.layout[key] = Number(input.value);
        });
        label.appendChild(input);
        layoutRows.appendChild(label);
      }
      ui.modalCard.replaceChildren();
      ui.modalCard.append(
        el("h3", null, "\u89C6\u56FE\u8BBE\u8BA1"),
        div("help", "\u53EA\u8C03\u6574\u58F0\u660E\u5F0F UI \u4EE4\u724C\u4E0E\u5E03\u5C40\uFF0C\u4E0D\u6267\u884C\u4EFB\u610F HTML/CSS/JS\u3002\u989C\u8272\u9009\u62E9\u5668\u53EF\u76F4\u63A5\u53D6\u8272\uFF0C\u4FEE\u6539\u4F1A\u7ACB\u5373\u9884\u89C8\u3002"),
        modeRow,
        tokenGrid,
        el("h4", null, "\u5E03\u5C40"),
        layoutRows
      );
      const actions = div("modal-actions");
      actions.appendChild(button("\u5E94\u7528\u5E76\u4FDD\u5B58", "btn primary", async () => {
        const saved = await jsonRequest("/api/ui", "POST", current);
        if (saved?.current) applyUiTokens(saved.current.tokens, saved.current.mode);
        toast("\u89C6\u56FE\u8BBE\u8BA1\u5DF2\u4FDD\u5B58", "success");
        ui.modal.classList.add("hidden");
        ui.modalCard.replaceChildren();
      }));
      actions.appendChild(button("\u5173\u95ED", "btn", () => {
        ui.modal.classList.add("hidden");
        ui.modalCard.replaceChildren();
      }));
      ui.modalCard.appendChild(actions);
      ui.modal.classList.remove("hidden");
    } catch (error) {
      toast(`\u89C6\u56FE\u8BBE\u8BA1\u6253\u5F00\u5931\u8D25\uFF1A${error.message || error}`, "error", 6e3);
    }
  }
  async function openPluginManager() {
    const render = async () => {
      const response = await jsonRequest("/api/plugins", "GET");
      if (!response) return;
      const plugins = response.plugins || [];
      const list = div("plugin-list");
      if (!plugins.length) list.appendChild(div("help", "\u5C1A\u672A\u53D1\u73B0\u63D2\u4EF6\u3002\u628A\u63D2\u4EF6\u5305\u653E\u5230 NetlabHome/extensions/plugins/<id>/ \u540E\u70B9\u300C\u626B\u63CF\u300D\u3002"));
      for (const plugin of plugins) {
        const row = div("plugin-row");
        const head = div("plugin-head");
        head.appendChild(el("b", null, `${plugin.name || plugin.id}  `));
        head.appendChild(el("span", "plugin-version", `v${plugin.version || "?"}`));
        head.appendChild(el("span", `plugin-status ${plugin.status || ""}`, plugin.status || "unknown"));
        row.appendChild(head);
        row.appendChild(div("help", `${plugin.id} \xB7 API ${plugin.plugin_api} \xB7 ${plugin.description || "\u65E0\u63CF\u8FF0"}`));
        row.appendChild(div("help", `\u80FD\u529B\uFF1A${(plugin.capabilities || []).join(", ") || "\u2014"}`));
        if (plugin.error) row.appendChild(div("plugin-error", plugin.error));
        const actions = div("modal-actions");
        actions.appendChild(button(plugin.status === "loaded" ? "\u7981\u7528" : "\u542F\u7528", "btn tiny", async () => {
          await jsonRequest(`/api/plugins/${encodeURIComponent(plugin.id)}/enable`, "POST", { enabled: plugin.status !== "loaded" });
          await render();
        }));
        actions.appendChild(button("\u91CD\u65B0\u52A0\u8F7D", "btn tiny", async () => {
          await jsonRequest(`/api/plugins/${encodeURIComponent(plugin.id)}/reload`, "POST", {});
          await render();
        }));
        row.appendChild(actions);
        list.appendChild(row);
      }
      ui.modalCard.replaceChildren();
      ui.modalCard.append(
        el("h3", null, "\u63D2\u4EF6\u7BA1\u7406"),
        div("help", "\u63D2\u4EF6\u662F\u53D7\u4FE1\u4EFB\u7684\u8FDB\u7A0B\u5185 Python \u5305\uFF0C\u4E0D\u662F\u6C99\u7BB1\u3002\u5DE5\u7A0B\u53EA\u5F15\u7528\u63D2\u4EF6 id/version\uFF1B\u7F3A\u5305\u65F6\u5DE5\u7A0B\u4F1A\u964D\u7EA7\u6253\u5F00\u3002"),
        list
      );
      const footer = div("modal-actions");
      footer.appendChild(button("\u626B\u63CF\u63D2\u4EF6\u76EE\u5F55", "btn", async () => {
        await jsonRequest("/api/plugins/scan", "POST", {});
        await render();
      }));
      footer.appendChild(button("\u5173\u95ED", "btn", () => {
        ui.modal.classList.add("hidden");
        ui.modalCard.replaceChildren();
      }));
      ui.modalCard.appendChild(footer);
      ui.modal.classList.remove("hidden");
    };
    try {
      await render();
    } catch (error) {
      toast(`\u63D2\u4EF6\u7BA1\u7406\u6253\u5F00\u5931\u8D25\uFF1A${error.message || error}`, "error", 6e3);
    }
  }
  async function compareBuiltinBlock(spec) {
    try {
      const result = await jsonRequest(
        `/api/blocks/${encodeURIComponent(spec.id)}/compare`,
        "POST",
        { duration: 0.02, dt: 1e-3 }
      );
      if (!result.ok) {
        toast(`\u5BF9\u6BD4\u5931\u8D25\uFF1A${result.reason || "\u672A\u77E5\u539F\u56E0"}`, "error", 6e3);
        return;
      }
      const summary = [
        `\u6A21\u5757\uFF1A${result.name || spec.name || spec.id}`,
        `\u8F93\u51FA\uFF1A${result.output}.${result.field}`,
        `\u65F6\u957F/\u6B65\u957F\uFF1A${result.duration}s / ${result.dt}s\uFF08${result.steps} \u6B65\uFF09`,
        `\u884C\u4E3A\u5CF0\u503C\uFF1A${Math.max(...result.behavior).toFixed(6)}`,
        `\u7ED3\u6784\u5CF0\u503C\uFF1A${Math.max(...result.structural).toFixed(6)}`,
        `\u6700\u5927\u7EDD\u5BF9\u5DEE\uFF1A${Number(result.max_abs_diff).toFixed(6)}`,
        `RMS \u5DEE\uFF1A${Number(result.rms_diff).toFixed(6)}`
      ].join("\n");
      const detail = [
        `\u884C\u4E3A\uFF1A${result.behavior.join(", ")}`,
        `\u7ED3\u6784\uFF1A${result.structural.join(", ")}`
      ].join("\n");
      ui.modalCard.replaceChildren();
      ui.modalCard.append(
        el("h3", null, "\u5185\u7F6E\u5757\uFF1A\u884C\u4E3A / \u7ED3\u6784\u5BF9\u6BD4"),
        div("help", summary),
        el("pre", "compare-pre", detail),
        div("help", result.note || "")
      );
      const close = button("\u5173\u95ED", "btn", () => {
        ui.modal.classList.add("hidden");
        ui.modalCard.replaceChildren();
      });
      const actions = div("modal-actions");
      actions.appendChild(close);
      ui.modalCard.appendChild(actions);
      ui.modal.classList.remove("hidden");
      ui.modal.onclick = (event) => {
        if (event.target === ui.modal) close.click();
      };
    } catch (error) {
      toast(`\u5BF9\u6BD4\u5931\u8D25\uFF1A${error.message || error}`, "error", 6e3);
    }
  }
  function renderBlocksPanel() {
    const pane = ui.blocksPane;
    if (!pane) return;
    const host = div("blocks-host");
    const head = div("insp-head");
    const title = div("insp-title");
    title.append(
      el("h2", null, "\u6A21\u5757\u5E93"),
      el("p", null, state.blocksLibrary ? `\u5E93\u76EE\u5F55\uFF1A${state.blocksLibrary}` : "\u5E93\u76EE\u5F55\uFF1A\u9ED8\u8BA4 library/")
    );
    head.appendChild(title);
    host.appendChild(head);
    const toolbar = div("blocks-toolbar");
    const structuralRow = el("label", "switch-row");
    structuralRow.appendChild(el("span", null, "\u5C01\u88C5\u4E3A\u7ED3\u6784\u6A21\u578B\uFF08\u53EF\u770B\u5185\u90E8\uFF09"));
    const structuralInput = el("input");
    structuralInput.type = "checkbox";
    structuralInput.checked = Boolean(state.blocksStructural);
    structuralInput.addEventListener("change", () => {
      state.blocksStructural = Boolean(structuralInput.checked);
    });
    structuralRow.appendChild(structuralInput);
    toolbar.append(
      button("\u5237\u65B0", "btn tiny", () => void refreshBlocks()),
      button("\u5BFC\u5165 .block", "btn tiny", () => void importBlockFile()),
      button("\u5C01\u88C5\u9009\u4E2D", "btn tiny primary", () => void encapsulateSelection()),
      button("\u53E6\u5B58\u4E3A\u526F\u672C", "btn tiny", () => void saveCurrentAsBlockCopy()),
      button("\u63D2\u4EF6\u7BA1\u7406", "btn tiny", () => void openPluginManager()),
      button("\u89C6\u56FE\u8BBE\u8BA1", "btn tiny", () => void openViewDesigner())
    );
    const closeBtn = button("\u5173\u95ED\u5185\u90E8\u7F51\u7EDC", "btn tiny", () => void closeInternalNetwork());
    closeBtn.disabled = !String(state.currentNetwork?.name || "").startsWith("\u6A21\u5757 ");
    closeBtn.title = closeBtn.disabled ? "\u5F53\u524D\u4E0D\u662F\u6A21\u5757\u5185\u90E8\u4E34\u65F6\u7F51\u7EDC" : "\u5220\u9664\u5F53\u524D\u4E34\u65F6\u7F51\u7EDC\u5E76\u8FD4\u56DE\u4E0A\u4E00\u5C42";
    toolbar.appendChild(closeBtn);
    if (state.sim?.degraded?.read_only) {
      toolbar.appendChild(button("\u8865\u56DE\u540E\u91CD\u8BD5", "btn tiny", () => void retryDegradedProject()));
    }
    host.appendChild(structuralRow);
    host.appendChild(toolbar);
    if (!state.blocks.length) {
      host.appendChild(
        div("help", "\u5E93\u4E2D\u6CA1\u6709\u6A21\u5757\uFF1A\u9009\u4E2D\u753B\u5E03\u8282\u70B9\u540E\u70B9\u300C\u5C01\u88C5\u9009\u4E2D\u300D\uFF0C\u6216\u7528\u300C\u5BFC\u5165 .block\u300D\u8F7D\u5165\u5DF2\u6709\u6A21\u5757\u3002")
      );
      pane.replaceChildren(host);
      return;
    }
    const list = div("block-list");
    for (const spec of state.blocks) {
      const item = div("block-item");
      const info = div("block-info");
      const name = el("strong", null, spec.name || spec.id);
      const badges = div("block-badges");
      for (const badge of blockBadges(spec)) badges.appendChild(el("span", "badge gray", badge));
      info.append(name, badges);
      const ports = el("small", "block-ports", describeBlockPorts(spec));
      info.appendChild(ports);
      item.draggable = true;
      item.addEventListener("dragstart", (event) => {
        if (!event.dataTransfer) return;
        event.dataTransfer.setData("text/netlab-block", spec.id);
        event.dataTransfer.effectAllowed = "copy";
      });
      const actions = div("block-actions");
      actions.appendChild(button("\u5B9E\u4F8B\u5316", "btn tiny primary", () => void instantiateBlockFromLibrary(spec.id)));
      const openBtn = button("\u6253\u5F00\u5185\u90E8", "btn tiny", () => openModuleInternal(spec.id));
      openBtn.title = (spec.model || "behavioral") !== "structural" ? "\u6253\u5F00\u5185\u90E8\u6D6E\u7A97\uFF08\u884C\u4E3A\u6A21\u578B\u53EA\u770B\u5F97\u5230\u7AEF\u53E3\uFF09" : "\u5728\u5185\u90E8\u6D6E\u7A97\u4E2D\u9884\u89C8\u6A21\u5757\u7ED3\u6784";
      actions.appendChild(openBtn);
      if (spec.builtin) {
        const compareBtn = button("\u884C\u4E3A/\u7ED3\u6784\u5BF9\u6BD4", "btn tiny", () => void compareBuiltinBlock(spec));
        compareBtn.title = "\u8FD0\u884C\u884C\u4E3A\u5FEB\u901F\u6A21\u578B\u4E0E structural \u5185\u90E8\u573A\u666F\uFF0C\u5BF9\u6BD4\u540C\u4E00\u8F93\u5165\u7684\u8F93\u51FA";
        actions.appendChild(compareBtn);
      }
      const renameBtn = button("\u6539\u540D", "btn tiny", () => void renameLibraryBlock(spec));
      renameBtn.title = spec.builtin ? "\u5185\u7F6E\u6A21\u5757\u53EA\u8BFB\uFF0C\u8BF7\u5148\u53E6\u5B58\u4E3A\u526F\u672C" : "\u6539\u6A21\u5757\u540D\u5B57\uFF08\u6587\u4EF6\u540D\u540C\u6B65\u6539\uFF0C\u5F15\u7528\u4E0D\u53D8\uFF09";
      renameBtn.disabled = Boolean(spec.builtin);
      actions.appendChild(renameBtn);
      const deleteBtn = button("\u5220\u9664", "btn tiny danger", () => void deleteLibraryBlock(spec));
      deleteBtn.disabled = Boolean(spec.builtin);
      deleteBtn.title = spec.builtin ? "\u5185\u7F6E\u6A21\u5757\u53EA\u8BFB\uFF0C\u4E0D\u80FD\u5220\u9664" : "\u4ECE\u5E93\u91CC\u5220\u6389\u8FD9\u4E2A\u6A21\u5757\u6587\u4EF6";
      actions.appendChild(deleteBtn);
      item.append(info, actions);
      list.appendChild(item);
    }
    host.appendChild(list);
    host.appendChild(
      div("help", "\u6A21\u5757\u6587\u4EF6\u4F4D\u4E8E library/blocks/<\u6A21\u5757\u540D>.block\uFF1A\u4E00\u4E2A\u6A21\u5757\u4E00\u4E2A\u6587\u4EF6\uFF0C\u6587\u4EF6\u540D\u5C31\u662F\u6A21\u5757\u540D\uFF1B\u5E93\u4E2D\u53EA\u4FDD\u7559\u6700\u65B0\u7248\u3002")
    );
    pane.replaceChildren(host);
  }
  function findBlockNameClash(name, ignoreId) {
    const wanted = String(name || "").trim().toLowerCase();
    if (!wanted) return null;
    return state.blocks.find(
      (item) => item.id !== ignoreId && String(item.name || "").trim().toLowerCase() === wanted
    ) || null;
  }
  async function renameLibraryBlock(spec) {
    const proposed = window.prompt(`\u6A21\u5757\u65B0\u540D\u5B57\uFF08\u5F53\u524D\uFF1A${spec.name || spec.id}\uFF09`, spec.name || "");
    if (proposed === null) return;
    const name = proposed.trim();
    if (!name) {
      toast("\u6A21\u5757\u540D\u4E0D\u80FD\u4E3A\u7A7A", "error");
      return;
    }
    if (name === spec.name) return;
    const clash = findBlockNameClash(name, spec.id);
    if (clash) {
      toast(`\u6A21\u5757\u540D\u5DF2\u5B58\u5728\uFF1A\u300C${clash.name}\u300D\uFF0C\u8BF7\u6362\u4E00\u4E2A\u540D\u5B57`, "error", 3600);
      return;
    }
    const run = async (force) => {
      const body = await jsonRequest(
        `/api/blocks/${encodeURIComponent(spec.id)}/rename`,
        "POST",
        { name, force }
      );
      return body;
    };
    try {
      try {
        await run(false);
      } catch (error) {
        const message = error?.message || String(error);
        if (!/引用|存在/.test(message)) throw error;
        if (!window.confirm(`${message}

\u4ECD\u7136\u6539\u540D\uFF1F`)) return;
        await run(true);
      }
      await refreshBlocks();
      toast(`\u5DF2\u6539\u540D\u4E3A\u300C${name}\u300D`, "ok");
    } catch (error) {
      toast(`\u6539\u540D\u5931\u8D25\uFF1A${error?.message || error}`, "error", 4e3);
    }
  }
  async function deleteLibraryBlock(spec) {
    if (!window.confirm(
      `\u5220\u9664\u6A21\u5757\u300C${spec.name || spec.id}\u300D\uFF1F
\u5E93\u91CC\u5BF9\u5E94\u7684 .block \u6587\u4EF6\u4F1A\u88AB\u5220\u9664\uFF0C\u5DF2\u7ECF\u653E\u8FDB\u753B\u5E03\u7684\u5B9E\u4F8B\u4F1A\u53D8\u6210\u7F3A\u5931\u72B6\u6001\u3002`
    )) {
      return;
    }
    const run = async (force) => {
      const body = await jsonRequest(
        `/api/blocks/${encodeURIComponent(spec.id)}/delete`,
        "POST",
        { version: spec.version, force }
      );
      return body;
    };
    try {
      try {
        await run(false);
      } catch (error) {
        const message = error?.message || String(error);
        if (!/引用|存在/.test(message)) throw error;
        if (!window.confirm(`${message}

\u4ECD\u7136\u5220\u9664\uFF1F`)) return;
        await run(true);
      }
      await refreshBlocks();
      toast(`\u5DF2\u5220\u9664\u6A21\u5757\u300C${spec.name || spec.id}\u300D`, "ok");
    } catch (error) {
      toast(`\u5220\u9664\u5931\u8D25\uFF1A${error?.message || error}`, "error", 4e3);
    }
  }
  function initStatusToggles() {
    const bind = (id, key, label) => {
      const node = $(`#${id}`);
      if (!node) return;
      const sync = () => {
        const active = Boolean(state.ui?.[key]);
        node.classList.toggle("active", active);
        if (label) node.textContent = label(active);
      };
      node.addEventListener("click", () => {
        state.ui[key] = !state.ui[key];
        sync();
        markProjectDirty();
        requestDraw();
        toast(`${node.textContent}\uFF1A${state.ui[key] ? "\u5F00" : "\u5173"}`, "info", 1600);
      });
      sync();
    };
    bind("stGrid", "showGrid");
    bind("stSnap", "snap");
    bind("stSnapMark", "snapMarkers");
    bind("stOrtho", "circuitOrthogonal");
    bind("stDrawing", "drawingMode");
    const styleBtn = $("#stNodeStyle");
    if (styleBtn) {
      const labels = { circle: "\u8282\u70B9\xB7\u5706", dot: "\u8282\u70B9\xB7\u70B9", box: "\u8282\u70B9\xB7\u6846" };
      const order = ["circle", "dot", "box"];
      const sync = () => {
        styleBtn.textContent = labels[state.ui.nodeStyle || "circle"];
      };
      styleBtn.addEventListener("click", () => {
        const index = order.indexOf(state.ui.nodeStyle || "circle");
        state.ui.nodeStyle = order[(index + 1) % order.length];
        sync();
        markProjectDirty();
        requestDraw();
        toast(`\u8282\u70B9\u6837\u5F0F\uFF1A${styleBtn.textContent}`, "info", 1800);
      });
      sync();
    }
  }
  function applyPanelHidden(hidden, persist = true) {
    ui.main.classList.toggle("panel-hidden", hidden);
    ui.panel?.classList.toggle("collapsed", hidden);
    if (ui.panelHanger) {
      ui.panelHanger.textContent = hidden ? "\u2039" : "\u203A";
      ui.panelHanger.title = hidden ? "\u5C55\u5F00\u53F3\u4FA7\u9762\u677F" : "\u6536\u8D77\u53F3\u4FA7\u9762\u677F";
      ui.panelHanger.setAttribute("aria-expanded", hidden ? "false" : "true");
    }
    if (persist) {
      try {
        localStorage.setItem(SHELL_KEYS.panelCollapsed, hidden ? "1" : "0");
      } catch (error) {
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
    applyPanelHidden(!ui.main.classList.contains("panel-hidden"));
  }
  function initPanelChrome() {
    let hidden = false;
    let width = 0;
    try {
      hidden = localStorage.getItem(SHELL_KEYS.panelCollapsed) === "1";
      width = Number(localStorage.getItem(SHELL_KEYS.panelWidth)) || 0;
    } catch (error) {
      hidden = false;
    }
    if (width >= 260 && width <= 720) ui.main.style.setProperty("--panel-w", `${Math.round(width)}px`);
    applyPanelHidden(hidden, false);
    ui.panelHanger?.addEventListener("click", togglePanel);
    const handle = ui.panelResize;
    if (!handle) return;
    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    const panelVar = () => ui.main.classList.contains("fem-mode") ? "--panel-w-fem" : "--panel-w";
    const currentWidth = () => {
      const rect = ui.panel?.getBoundingClientRect();
      if (rect && rect.width > 0) return rect.width;
      const value = parseFloat(getComputedStyle(ui.main).getPropertyValue(panelVar()));
      return Number.isFinite(value) && value > 0 ? value : 388;
    };
    handle.addEventListener("pointerdown", (event) => {
      if (ui.main.classList.contains("panel-hidden")) return;
      dragging = true;
      startX = event.clientX;
      startWidth = currentWidth();
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add("panel-dragging");
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const next = clamp(Math.round(startWidth - (event.clientX - startX)), 260, 720);
      ui.main.style.setProperty(panelVar(), `${next}px`);
      ui.main.style.setProperty("--panel-edge", `${next}px`);
    });
    const finish = (event) => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("panel-dragging");
      try {
        localStorage.setItem(SHELL_KEYS.panelWidth, String(Math.round(currentWidth())));
      } catch (error) {
      }
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      resizeFem();
      resizePhase();
      if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }
  function initShell() {
    initMenus();
    initNetworkSidebar();
    initPanelChrome();
    updateInfoBar();
    requestAnimationFrame(syncChromeEdges);
  }
  function bindStaticEvents() {
    ui.exitBtn?.addEventListener("click", () => void shutdownApp());
    ui.runBtn.addEventListener("click", () => void control("toggle"));
    $("#btnStep").addEventListener("click", () => void control("step", 1));
    $("#btnReset").addEventListener("click", () => void control("reset"));
    $("#btnAdd").addEventListener("click", () => {
      const place = centerPlacement();
      openAddMenu(16, 88, place.x, place.y);
    });
    $("#btnLayout").addEventListener("click", () => void autoLayout());
    $("#btnFit").addEventListener("click", () => fitView(true));
    $("#btnZoomIn").addEventListener("click", () => zoomCenter(1.2));
    $("#btnZoomOut").addEventListener("click", () => zoomCenter(1 / 1.2));
    $("#btnClear").addEventListener("click", () => void clearScene());
    if (ui.workspaceSwitch) {
      $$("button[data-workspace]", ui.workspaceSwitch).forEach((buttonNode) => {
        buttonNode.addEventListener("click", () => void switchWorkspace(buttonNode.dataset.workspace));
      });
    }
    setWorkspaceButtons();
    $$(".panel-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const group = tab.dataset.group;
        switchTab(group === "inspect" ? "inspect" : defaultTabForGroup(group));
      });
    });
    $$("#panel .group-subnav").forEach((nav) => {
      nav.addEventListener("click", (event) => {
        const target = event.target.closest("button");
        if (!target) return;
        if (target.dataset.fnrole) {
          state.fnRole = target.dataset.fnrole;
          state.specKind = "";
          switchTab(target.dataset.fnrole === "edge" ? "edge-fn" : "node-fn");
        } else if (target.dataset.sub) {
          switchTab(target.dataset.sub);
        }
      });
    });
    setPanelGroup("inspect");
    setGroupSub("modules", "blocks");
    setGroupSub("analysis", "chart");
    if (ui.vectorNode) {
      ui.vectorNode.addEventListener("change", () => {
        state.phaseNode = ui.vectorNode.value;
        state.phaseIndex = null;
        stopPhasePlay();
        drawPhase();
      });
    }
    if (ui.vectorTrail) {
      ui.vectorTrail.addEventListener("change", () => {
        const value = Number(ui.vectorTrail.value);
        if (!Number.isFinite(value)) return;
        state.phaseTrail = clamp(Math.round(value), 20, 1200);
        ui.vectorTrail.value = String(state.phaseTrail);
        drawPhase();
      });
    }
    if (ui.phasePlay) {
      ui.phasePlay.addEventListener("click", togglePhasePlay);
    }
    if (ui.phaseStep) {
      ui.phaseStep.addEventListener("click", () => {
        const total = phaseFrameCount();
        if (!total) return;
        stopPhasePlay();
        const current = state.phaseIndex == null ? total - 1 : state.phaseIndex;
        setPhaseIndex(current + 1 >= total ? 0 : current + 1);
      });
    }
    if (ui.phaseLoop) {
      ui.phaseLoop.addEventListener("change", () => {
        state.phaseLoop = Boolean(ui.phaseLoop.checked);
      });
    }
    if (ui.phaseExport) {
      ui.phaseExport.addEventListener("click", () => {
        const node = (state.scene?.nodes || []).find((item) => item.name === state.phaseNode);
        const stateKeys = node ? phaseStateKeys(node) : [];
        const keys = stateKeys.length >= 2 ? stateKeys.slice(0, 2) : node ? [`n:${node.name}:x`, `n:${node.name}:y`] : null;
        void exportAnalysisCsv(keys, "phase");
      });
    }
    if (ui.phasePlotkit) {
      ui.phasePlotkit.addEventListener("click", () => void sendPhaseToPlotKit());
    }
    if (ui.phaseFrame) {
      ui.phaseFrame.addEventListener("input", () => {
        stopPhasePlay();
        setPhaseIndex(Number(ui.phaseFrame.value));
      });
    }
    femCanvas.addEventListener("pointermove", (event) => {
      if (state.workspace !== "fem") return;
      const rect = femCanvas.getBoundingClientRect();
      state.femHover = femHoverFromPoint(event.clientX - rect.left, event.clientY - rect.top);
      const probe = $('[data-role="fem-probe"]', ui.femPanel);
      if (probe) {
        probe.textContent = state.femHover ? `\u8282\u70B9 (${state.femHover.i}, ${state.femHover.j}) \xB7 T=${fmt(state.femHover.value, 3)} \xB0C \xB7 t=${fmt(state.fem?.time, 4)} s` : "\u628A\u9F20\u6807\u79FB\u52A8\u5230\u8272\u573A\u4E0A\u8BFB\u53D6\u8282\u70B9\u6E29\u5EA6\u3002";
      }
      drawFem();
    });
    femCanvas.addEventListener("pointerleave", () => {
      state.femHover = null;
      updateFemPanelValues();
      drawFem();
    });
    ui.chartWindow.addEventListener("change", () => {
      const value = Number(ui.chartWindow.value);
      if (!Number.isFinite(value) || value < 0.1 || value > 120) {
        toast("\u65F6\u95F4\u7A97\u5FC5\u987B\u5728 0.1\u2013120 s \u4E4B\u95F4", "error", 3e3);
        ui.chartWindow.value = String(state.chart.window);
        return;
      }
      state.chart.window = value;
      scheduleChartDraw();
    });
    ui.signalSearch.addEventListener("input", () => {
      state.chart.filter = ui.signalSearch.value;
      renderSignalList();
    });
    ui.btnClearChart.addEventListener("click", () => {
      state.frames = [];
      state.chart.hover = null;
      stopReplayTimer();
      state.replay.active = false;
      state.replay.index = 0;
      state.replay.recordingRevision = null;
      updateReplayUI();
      drawChart();
      toast("\u8F68\u8FF9\u5DF2\u6E05\u7A7A\uFF0C\u65B0\u7684\u91C7\u6837\u4F1A\u7EE7\u7EED\u7ED8\u5236", "ok", 2e3);
    });
    if (ui.chartTimeline) {
      ui.chartTimeline.addEventListener("input", () => {
        enterReplay(Number(ui.chartTimeline.value));
      });
    }
    if (ui.topTimeline) {
      ui.topTimeline.addEventListener("input", () => {
        enterReplay(Number(ui.topTimeline.value));
      });
      ui.topTimeline.addEventListener("dblclick", () => {
        leaveReplay();
        toast("\u5DF2\u56DE\u5230\u5B9E\u65F6\u5F55\u5236", "info", 1600);
      });
    }
    if (ui.btnReplay) {
      ui.btnReplay.addEventListener("click", () => toggleReplayPlayback());
    }
    try {
      const storedSpeed = Number(localStorage.getItem("netlab.replaySpeed"));
      if (Number.isFinite(storedSpeed) && storedSpeed >= 5 && storedSpeed <= 240) {
        state.replay.speed = storedSpeed;
      }
    } catch (error) {
    }
    if (ui.replaySpeed) {
      ui.replaySpeed.addEventListener("input", () => {
        state.replay.speed = clamp(Number(ui.replaySpeed.value) || 60, 5, 240);
        try {
          localStorage.setItem("netlab.replaySpeed", String(state.replay.speed));
        } catch (error) {
        }
        updateReplayUI();
      });
    }
    if (ui.btnPrecompute) {
      ui.btnPrecompute.addEventListener("click", async () => {
        const raw = window.prompt("\u9884\u8BA1\u7B97 0\u2192T \u7684\u65F6\u957F\uFF08\u79D2\uFF0C\u6700\u5927 120\uFF09", "5");
        if (raw === null) return;
        const duration = Number(raw);
        if (!Number.isFinite(duration) || duration <= 0 || duration > 120) {
          toast("\u9884\u8BA1\u7B97\u65F6\u957F\u5FC5\u987B\u5728 (0, 120] s \u5185", "error", 3e3);
          return;
        }
        try {
          toast(`\u6B63\u5728\u9884\u8BA1\u7B97 0\u2192${duration} s\u2026`, "info", 2400);
          const response = await api("/api/solve-window", {
            method: "POST",
            body: JSON.stringify({ duration }),
            timeoutMs: 18e4
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
          if (result.error) toast(`\u9884\u8BA1\u7B97\u4E2D\u65AD\uFF1A${result.error}`, "error", 6e3);
          else toast(`\u9884\u8BA1\u7B97\u5B8C\u6210\uFF1A${result.steps} \u6B65 / ${result.frames} \u5E27`, "ok", 3e3);
        } catch (error) {
          toast(`\u9884\u8BA1\u7B97\u5931\u8D25\uFF1A${error.message}`, "error", 6e3);
        }
      });
    }
    if (ui.btnLive) {
      ui.btnLive.addEventListener("click", () => {
        leaveReplay();
        toast("\u5DF2\u56DE\u5230\u5B9E\u65F6\u5F55\u5236", "info", 1800);
      });
    }
    if (ui.btnResolve) {
      ui.btnResolve.addEventListener("click", async () => {
        if (!recordingStale()) return;
        leaveReplay();
        await control("reset");
        await control("run", void 0, { skipWarn: true });
        toast("\u573A\u666F\u5DF2\u4FEE\u6539\uFF0C\u65E7\u8BB0\u5F55\u6E05\u9664\u5E76\u91CD\u65B0\u6C42\u89E3", "ok", 2400);
      });
    }
    if (ui.chartLoop) {
      ui.chartLoop.addEventListener("change", () => {
        state.chart.loop = Boolean(ui.chartLoop.checked);
        toast(`\u5FAA\u73AF\u56DE\u653E\uFF1A${state.chart.loop ? "\u5F00" : "\u5173"}`, "info", 1600);
      });
    }
    updateReplayUI();
    chartCanvas.addEventListener("pointermove", (event) => {
      const rect = chartCanvas.getBoundingClientRect();
      state.chart.hover = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
      scheduleChartDraw();
    });
    chartCanvas.addEventListener("pointerleave", () => {
      state.chart.hover = null;
      scheduleChartDraw();
    });
    document.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".popup")) return;
      closePopups();
    }, true);
    document.addEventListener("keydown", (event) => {
      if (state.shuttingDown) return;
      if (event.key === "Escape") {
        closePopups();
        if (state.wireTool) cancelWireTool();
        if (!ui.modal.classList.contains("hidden")) closeModal();
        return;
      }
      if (isFormTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "s" && event.altKey) {
          event.preventDefault();
          void saveProject(true);
        } else if (key === "s") {
          event.preventDefault();
          void saveProject(false);
        } else if (key === "e" && event.shiftKey) {
          event.preventDefault();
          if (state.workspace === "network") void exportScene();
          else toast("\u6709\u9650\u5143\u573A\u4E0D\u5BFC\u51FA JSON\uFF1B\u53EF\u5728\u300C\u573A\u300D\u9762\u677F\u91CD\u5EFA\u53C2\u6570", "info", 3e3);
        } else if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) void redo();
          else void undo();
        } else if (key === "y") {
          event.preventDefault();
          void redo();
        } else if (key === "c") {
          event.preventDefault();
          copySelection(false);
        } else if (key === "x") {
          event.preventDefault();
          copySelection(true);
        } else if (key === "v") {
          event.preventDefault();
          void pasteClipboard();
        } else if (key === "a") {
          event.preventDefault();
          selectAll();
        }
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        void control("toggle");
      } else if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        void control("step", 1);
      } else if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        void control("reset");
      } else if (state.workspace === "network" && (event.key === "f" || event.key === "F")) {
        event.preventDefault();
        fitView(true);
      } else if (state.workspace === "network" && (event.key === "a" || event.key === "A")) {
        event.preventDefault();
        const place = centerPlacement();
        openAddMenu(state.canvasSize.w / 2, state.canvasSize.h / 2, place.x, place.y);
      } else if (state.workspace === "network" && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        void deleteSelection();
      } else if (state.workspace === "network" && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        zoomCenter(1.2);
      } else if (state.workspace === "network" && (event.key === "-" || event.key === "_")) {
        event.preventDefault();
        zoomCenter(1 / 1.2);
      } else if (event.key === "?") {
        event.preventDefault();
        showHelp();
      }
    });
    canvas.tabIndex = 0;
    canvas.addEventListener("focus", () => {
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
    initAnalWin();
    initPlotkitDataBar();
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
      if (state.workspace === "network") resizeGraph();
      resizeChart();
      if (state.workspace === "fem") resizeFem();
      resizePhase();
      resizeInstrument();
    });
    observer.observe(stage);
    const chartWrap = $(".chart-wrap");
    if (chartWrap) observer.observe(chartWrap);
    const phaseWrap = $(".phase-wrap");
    if (phaseWrap) observer.observe(phaseWrap);
    $$(".scope-wrap").forEach((wrap) => observer.observe(wrap));
    window.addEventListener("resize", () => {
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      resizeFem();
      resizePhase();
      resizeInstrument();
    });
    setInterval(() => {
      if (!ui.sessionClock) return;
      const now = /* @__PURE__ */ new Date();
      ui.sessionClock.textContent = `LOCAL SESSION \xB7 ${now.toLocaleTimeString("zh-CN", { hour12: false })}`;
    }, 1e3);
    requestAnimationFrame(animationLoop);
    try {
      const [catalog, snapshot] = await Promise.all([api("/api/catalog"), api("/api/state")]);
      state.catalog = catalog.catalog;
      state.templates = catalog.templates || [];
      state.mode = snapshot.scene?.mode || "signal";
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
      }, 8e3);
      state.booted = true;
      await maybeOfferRecovery();
      await ensureStoppedOnBoot();
      if (state.prefs.guide !== "never") showGuide();
      if (!state.sim?.running) {
        toast("\u753B\u5E03\u5DF2\u5C31\u7EEA\uFF1A\u7A7A\u683C\u8FD0\u884C\uFF0C\u53CC\u51FB\u8282\u70B9\u7F16\u8F91\uFF0C\u4ECE\u53F3\u4FA7\u7AEF\u53E3\u62D6\u51FA\u8FDE\u7EBF", "info", 4200);
      }
    } catch (error) {
      showBanner(`\u65E0\u6CD5\u8FDE\u63A5\u540E\u7AEF\uFF1A${error.message}`);
      toast(`\u521D\u59CB\u5316\u5931\u8D25\uFF1A${error.message}`, "error", 9e3);
      renderScenePanel();
      renderInspector();
    }
  }
  window.__netlabDebug = {
    state,
    nodeRect,
    edgePathPoints,
    elementPins,
    devicePins,
    devicePinScreen,
    waypointHitAt,
    worldToScreen,
    screenToWorld
  };
  const THEME_TOKENS = {
    light: {
      ink: "#080a08",
      ink2: "#2b2a24",
      muted: "#77756d",
      dim: "#9a9487",
      line: "#aaa59a",
      paper: "#eae5e1",
      panel: "#edebe4",
      surface: "#e2dccf",
      paper3: "#e2dccf",
      accent: "#9b7247",
      accent2: "#565c46",
      accentSoft: "#e4d5c1",
      red: "#8a4234",
      amber: "#a67d48",
      green: "#565c46",
      gridDot: "rgba(104, 94, 78, 0.20)",
      gridAxis: "#cfc6b5"
    },
    dark: {
      ink: "#e0e3dc",
      ink2: "#c6cbc3",
      muted: "#a6b0b1",
      dim: "#7f8c8e",
      line: "#536166",
      paper: "#11181b",
      panel: "#202a2f",
      surface: "#2a363b",
      paper3: "#1b2429",
      accent: "#c5a16b",
      accent2: "#9aa88c",
      accentSoft: "#2e3b40",
      red: "#c08a7d",
      amber: "#c5a16b",
      green: "#9aa88c",
      gridDot: "rgba(166, 176, 177, 0.16)",
      gridAxis: "#3a4a50"
    }
  };
  const COLOR_ALIAS = {
    "#a8541f": "accent",
    "#1f5f5b": "accent2",
    "#6f695f": "muted",
    "#969083": "dim",
    "#11100e": "ink",
    "#faf8f2": "panel",
    "#f7f4ec": "paper",
    "#fffdf8": "surface",
    "#f2efe7": "paper",
    "#bcb3a1": "line",
    "#cfc6b5": "gridAxis",
    "#e7e1d5": "paper3"
  };
  const CHART_PALETTE = [
    "#a8541f",
    "#1f5f5b",
    "#7b8c3a",
    "#8a4a7c",
    "#4a6f8a",
    "#b08a3e",
    "#8e2f24",
    "#5f6b52",
    "#7a4a2a",
    "#4d463c"
  ];
  const ACCENT_SWATCHES = ["", "#9b7247", "#565c46", "#3f5d6b", "#8a4234", "#6b6257"];
  const PREF_CACHE_KEY = "netlab.ui.prefs";
  function themeKey() {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
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
  const LEGACY_RGB = {
    "168,84,31": "accent",
    "31,95,91": "accent2",
    "142,47,36": "red",
    "79,107,64": "green",
    "176,118,42": "amber"
  };
  function C(value) {
    const raw = String(value || "").trim();
    const legacy = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+))?\s*\)$/i);
    if (legacy) {
      const target = LEGACY_RGB[`${legacy[1]},${legacy[2]},${legacy[3]}`];
      const hex = target ? tokens()[target] : "";
      const rgb = hex ? hexToRgb(hex) : null;
      if (rgb) return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${legacy[4] ?? 1})`;
    }
    const token = COLOR_ALIAS[raw.toLowerCase()];
    if (token) return tokens()[token];
    if (themeKey() === "dark") return mixHex(raw, "#e0e3dc", 0.42);
    return raw;
  }
  function applyAppearance() {
    const root = document.documentElement;
    const pref = state.prefs || {};
    const theme = resolveTheme(pref.theme || "system");
    root.dataset.theme = theme;
    root.dataset.motion = pref.motion || "low";
    root.dataset.perf = pref.perf || "perf";
    const pal = THEME_TOKENS[theme];
    const accent = pref.accent || pal.accent;
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-rgb", hexToRgbString(accent));
    root.style.setProperty("--accent-soft", mixHex(pal.paper, accent, 0.28));
    root.style.setProperty("--accent-2", pal.accent2);
    root.style.setProperty("--green", pal.green);
    state.palette = pal;
    if (ui.infoBar) ui.infoBar.style.display = pref.infobar === false ? "none" : "";
    syncPrefControls();
    writePrefCache();
    if (state.booted) {
      requestDraw();
      scheduleChartDraw();
      drawPhase();
      if (state.workspace === "fem") {
        drawFem();
      }
      if (ui.moduleWin && !ui.moduleWin.hidden) drawModulePreview();
    }
  }
  function resolveTheme(pref) {
    if (pref === "light" || pref === "dark") return pref;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function readPrefCache() {
    try {
      return JSON.parse(window.localStorage.getItem(PREF_CACHE_KEY) || "null");
    } catch (error) {
      return null;
    }
  }
  function writePrefCache() {
    try {
      window.localStorage.setItem(PREF_CACHE_KEY, JSON.stringify(state.prefs || {}));
    } catch (error) {
    }
  }
  async function loadUiPrefs() {
    const cached = readPrefCache();
    if (cached && typeof cached === "object") state.prefs = { ...state.prefs, ...cached };
    applyAppearance();
    try {
      const response = await jsonRequest("/api/settings", "GET");
      const stored = response.settings || {};
      state.settings = stored;
      state.prefs.theme = ["system", "light", "dark"].includes(stored.theme) ? stored.theme : "system";
      state.prefs.motion = ["off", "low", "med", "high"].includes(stored.ui_motion) ? stored.ui_motion : "low";
      state.prefs.perf = ["perf", "balanced", "quality"].includes(stored.ui_perf) ? stored.ui_perf : "perf";
      state.prefs.accent = typeof stored.ui_accent === "string" ? stored.ui_accent : "";
      state.prefs.guide = stored.ui_guide === "never" ? "never" : "always";
      if (typeof stored.autosave_enabled === "boolean") state.project.autosave = stored.autosave_enabled;
      const interval = Number(stored.autosave_interval_seconds);
      if (Number.isFinite(interval) && interval >= 5) state.project.autosaveInterval = interval * 1e3;
      applyAppearance();
    } catch (error) {
    }
    state.uiReady = true;
  }
  const PREF_SETTING_KEYS = { theme: "theme", motion: "ui_motion", perf: "ui_perf", accent: "ui_accent", guide: "ui_guide" };
  async function setPref(key, value) {
    state.prefs[key] = value;
    applyAppearance();
    const settingKey = PREF_SETTING_KEYS[key];
    if (!settingKey) return;
    try {
      const response = await jsonRequest("/api/settings", "PATCH", { [settingKey]: value });
      state.settings = response.settings || state.settings;
    } catch (error) {
      toast(`\u504F\u597D\u4FDD\u5B58\u5931\u8D25\uFF1A${error.message}`, "warn", 3200);
    }
  }
  function syncPrefControls() {
    const prefs = state.prefs || {};
    const paint = (host, value) => {
      if (!host) return;
      $$("button[data-value]", host).forEach((node) => {
        const on = node.dataset.value === value;
        node.classList.toggle("active", on);
        node.setAttribute("aria-pressed", on ? "true" : "false");
      });
    };
    paint($("#segTheme"), prefs.theme || "system");
    paint($("#segMotion"), prefs.motion || "low");
    paint($("#segPerf"), prefs.perf || "perf");
    paint($("#segInfoBar"), prefs.infobar === false ? "off" : "on");
    paint($("#segSheet"), String(state.ui?.drawingSheet || "A3"));
    paint($("#segDrawLabels"), state.ui?.drawingLabels ? "on" : "off");
    paint($("#segDrawPage"), String(state.ui?.drawingPage || 1));
    paint($("#segGuide"), prefs.guide === "never" ? "never" : "always");
    paint($("#segAutosave"), state.project.autosave ? "on" : "off");
    if ($("#selAutosaveInterval")) $("#selAutosaveInterval").value = String(Math.round(state.project.autosaveInterval / 1e3));
    const swatches = $("#accentSwatches");
    if (swatches) {
      $$("button", swatches).forEach((node) => {
        node.classList.toggle("active", (node.dataset.value || "") === (prefs.accent || ""));
      });
    }
    if (ui.guideNever) ui.guideNever.checked = prefs.guide === "never";
  }
  function initAppearanceControls() {
    $("#segTheme")?.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-value]");
      if (target) void setPref("theme", target.dataset.value);
    });
    $("#segMotion")?.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-value]");
      if (target) void setPref("motion", target.dataset.value);
    });
    $("#segPerf")?.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-value]");
      if (target) void setPref("perf", target.dataset.value);
    });
    $("#segInfoBar")?.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-value]");
      if (!target) return;
      state.prefs.infobar = target.dataset.value !== "off";
      applyAppearance();
    });
    const bindDrawingSeg = (id, apply) => {
      $(id)?.addEventListener("click", (event) => {
        const target = event.target.closest("button[data-value]");
        if (!target) return;
        apply(String(target.dataset.value || ""));
        markProjectDirty();
        requestDraw();
        syncPrefControls();
      });
    };
    bindDrawingSeg("#segSheet", (value) => {
      state.ui.drawingSheet = value;
    });
    bindDrawingSeg("#segDrawLabels", (value) => {
      state.ui.drawingLabels = value === "on";
    });
    bindDrawingSeg("#segDrawPage", (value) => {
      state.ui.drawingPage = Math.max(1, Math.min(9, Number(value) || 1));
    });
    $("#segGuide")?.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-value]");
      if (target) void setPref("guide", target.dataset.value);
    });
    $("#segAutosave")?.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-value]");
      if (!target) return;
      void saveAutosaveSetting({ autosave_enabled: target.dataset.value === "on" });
    });
    $("#selAutosaveInterval")?.addEventListener("change", () => {
      const seconds = Number($("#selAutosaveInterval").value);
      if (Number.isFinite(seconds)) void saveAutosaveSetting({ autosave_interval_seconds: seconds });
    });
    const swatches = $("#accentSwatches");
    if (swatches) {
      for (const value of ACCENT_SWATCHES) {
        const node = button(value ? "" : "A", "swatch", () => void setPref("accent", value));
        node.dataset.value = value;
        node.title = value ? `\u5F3A\u8C03\u8272 ${value}` : "\u9ED8\u8BA4\u5F3A\u8C03\u8272";
        if (!value) node.classList.add("default");
        node.style.background = value || "linear-gradient(135deg, #9b7247 50%, #eae5e1 50%)";
        swatches.appendChild(node);
      }
    }
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if ((state.prefs.theme || "system") === "system") applyAppearance();
    });
  }
  async function saveAutosaveSetting(patch) {
    state.project.autosave = patch.autosave_enabled !== void 0 ? patch.autosave_enabled : state.project.autosave;
    if (patch.autosave_interval_seconds) state.project.autosaveInterval = patch.autosave_interval_seconds * 1e3;
    syncPrefControls();
    try {
      const response = await jsonRequest("/api/settings", "PATCH", patch);
      state.settings = response.settings || state.settings;
      toast(patch.autosave_enabled === false ? "\u81EA\u52A8\u4FDD\u5B58\u5DF2\u5173\u95ED" : patch.autosave_enabled ? "\u81EA\u52A8\u4FDD\u5B58\u5DF2\u5F00\u542F" : "\u5FEB\u7167\u95F4\u9694\u5DF2\u66F4\u65B0", "ok", 2e3);
    } catch (error) {
      toast(`\u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25\uFF1A${error.message}`, "error", 3600);
    }
  }
  function formatQualityNumber(value, unit = "") {
    if (value === null || value === void 0) return "\u2014";
    if (!Number.isFinite(value)) return String(value);
    return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 6 })}${unit}`;
  }
  function setQualityText(selector, text) {
    const node = $(selector);
    if (node) node.textContent = text;
  }
  async function refreshTelemetryQuality() {
    const status = $("#diagStatus");
    if (status) status.textContent = "\u8BFB\u53D6\u4E2D\u2026";
    try {
      const payload = await api("/api/diagnostics/telemetry");
      const quality = payload?.telemetry || {};
      const assumptions = (quality.assumptions || []).filter((item) => item.trim().length > 0);
      const missing = [];
      if (quality.sample_dt === null || quality.sample_dt === void 0) missing.push("sample_dt");
      if (quality.interp_error_bound === null || quality.interp_error_bound === void 0) missing.push("interp_error_bound");
      if (quality.delay_bound === null || quality.delay_bound === void 0) missing.push("delay_bound");
      setQualityText("#diagSampleDt", formatQualityNumber(quality.sample_dt, " s"));
      setQualityText(
        "#diagQuantBits",
        quality.quant_bits === null || quality.quant_bits === void 0 ? "\u672A\u542F\u7528\u91CF\u5316" : `${quality.quant_bits} bit`
      );
      setQualityText(
        "#diagInterpBound",
        quality.interp_error_bound === null || quality.interp_error_bound === void 0 ? "\u672A\u58F0\u660E" : `${formatQualityNumber(quality.interp_error_bound)}${quality.interp_error_bound_method ? `\uFF08${quality.interp_error_bound_method}\uFF09` : ""}`
      );
      setQualityText("#diagFifoDepth", formatQualityNumber(quality.fifo_depth, " \u5E27"));
      setQualityText(
        "#diagDelayBound",
        quality.delay_bound === null || quality.delay_bound === void 0 ? "\u672A\u58F0\u660E" : `${formatQualityNumber(quality.delay_bound, " s")}${quality.delay_bound_method ? `\uFF08${quality.delay_bound_method}\uFF09` : ""}`
      );
      setQualityText("#diagAssumptions", assumptions.length ? `\u5047\u8BBE\uFF1A${assumptions.join("\uFF1B")}` : "\u5047\u8BBE\uFF1A\u2014");
      if (status) {
        status.textContent = missing.length ? `\u4E0D\u5B8C\u6574\uFF1A\u7F3A\u5C11 ${missing.join("\u3001")}` : "\u5B8C\u6574\uFF08\u53EF\u7528\uFF09";
        status.dataset.state = missing.length ? "partial" : "ok";
      }
    } catch (error) {
      if (status) {
        status.textContent = `\u8BFB\u53D6\u5931\u8D25\uFF1A${error.message}`;
        status.dataset.state = "error";
      }
    }
  }
  function openSettings(pane = "project") {
    if (!ui.settingsWin) return;
    ui.settingsWin.hidden = false;
    ui.settingsWin.classList.remove("minimized");
    setSettingsPane(pane);
    if (!ui.scenePane || !ui.scenePane.dataset.ready) renderScenePanel();
    placeFloatWindow(ui.settingsWin, "settingsGeo");
    raiseFloatWindow(ui.settingsWin);
  }
  function closeSettings() {
    if (!ui.settingsWin) return;
    ui.settingsWin.classList.remove("minimized", "maximized");
    ui.settingsWin.hidden = true;
  }
  function setSettingsPane(pane) {
    $$("#settingsWin .setwin-nav button[data-pane]").forEach((node) => {
      node.classList.toggle("active", node.dataset.pane === pane);
    });
    $$("#settingsWin .setwin-pane").forEach((node) => {
      node.classList.toggle("active", node.dataset.pane === pane);
    });
    const hint = $("#setWinHint");
    if (hint) {
      const hints = {
        project: "SETTINGS \xB7 \u5DE5\u7A0B\u7EA7\uFF0C\u968F .netlab \u4FDD\u5B58",
        view: "SETTINGS \xB7 \u5168\u5C40\u5916\u89C2\u504F\u597D",
        interact: "SETTINGS \xB7 \u5168\u5C40\u4EA4\u4E92\u504F\u597D",
        diag: "SETTINGS \xB7 \u53EA\u8BFB\u8BCA\u65AD\uFF08P5 \u8BEF\u5DEE\u5408\u540C\uFF09"
      };
      hint.textContent = hints[pane] || "";
    }
    const main = ui.settingsWin?.querySelector(".setwin-main");
    if (main) main.scrollTop = 0;
    if (pane === "diag") void refreshTelemetryQuality();
  }
  function initSettingsWin() {
    $("#settingsWin .setwin-nav")?.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-pane]");
      if (target) setSettingsPane(target.dataset.pane);
    });
    $("#btnDiagRefresh")?.addEventListener("click", () => void refreshTelemetryQuality());
    ui.settingsClose?.addEventListener("click", closeSettings);
    $$("#settingsWin [data-doc]").forEach((node) => {
      node.addEventListener("click", () => openDoc(node.dataset.doc));
    });
    initFloatWindow(ui.settingsWin, "settingsGeo", { minWidth: 520, minHeight: 380 });
  }
  function showGuide(force = false) {
    if (!ui.guide) return;
    if (!force && state.prefs.guide === "never") return;
    state.guideShown = true;
    document.body.classList.add("guide-open");
    ui.guide.hidden = false;
    selectGuideMode(state.guideMode || state.mode || "signal");
    syncPrefControls();
  }
  function hideGuide() {
    if (!ui.guide) return;
    ui.guide.hidden = true;
    document.body.classList.remove("guide-open");
  }
  function selectGuideMode(mode) {
    const picked = ["signal", "circuit", "vector"].includes(mode) ? mode : "signal";
    state.guideMode = picked;
    $$(".guide-mode").forEach((node) => {
      const on = node.dataset.mode === picked;
      node.classList.toggle("selected", on);
      node.setAttribute("aria-checked", on ? "true" : "false");
    });
  }
  async function enterGuideScene() {
    const mode = state.guideMode || "signal";
    if (ui.guideNever?.checked) {
      await setPref("guide", "never");
    } else if (state.prefs.guide === "never") {
      await setPref("guide", "always");
    }
    hideGuide();
    if (mode !== state.mode) {
      await switchMode(mode, { skipConfirm: true });
    } else {
      toast(`${modeLabel(mode)}\u573A\u666F\u5DF2\u5C31\u7EEA \xB7 \u7A7A\u683C\u8FD0\u884C`, "ok", 2600);
    }
  }
  function initGuide() {
    if (!ui.guide) return;
    $$(".guide-mode").forEach((node) => {
      node.addEventListener("click", () => selectGuideMode(node.dataset.mode));
    });
    (() => {
      const handle = document.querySelector("#guide .guide-top");
      if (!handle) return;
      const desktop = window.netlabDesktop;
      if (!desktop || typeof desktop.attachWindowDrag !== "function") return;
      handle.style.cursor = "grab";
      desktop.attachWindowDrag(handle, {
        dblclick: false,
        onStart: () => {
          handle.style.cursor = "grabbing";
        },
        onEnd: () => {
          handle.style.cursor = "grab";
        }
      });
    })();
    ui.guideEnter?.addEventListener("click", () => void enterGuideScene());
    ui.guideClose?.addEventListener("click", hideGuide);
    ui.guideDocs?.addEventListener("click", () => {
      openDoc("quickstart");
    });
    ui.guideDemo?.addEventListener("click", () => {
      hideGuide();
      void loadTemplate("signal_chain", "\u4FE1\u53F7\u94FE\u793A\u4F8B");
    });
    ui.guideOpenProject?.addEventListener("click", () => void openProject());
    ui.guideSettings?.addEventListener("click", () => openSettings("view"));
    $$("#guide [data-doc]").forEach((node) => {
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        openDoc(node.dataset.doc);
      });
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !ui.guide.hidden && !event.target.closest("input, textarea, select")) {
        event.preventDefault();
        void enterGuideScene();
      }
    });
  }
  async function ensureDocs() {
    if (state.docs && state.docs.length) return state.docs;
    try {
      const response = await jsonRequest("/api/docs", "GET");
      state.docs = Array.isArray(response.docs) ? response.docs : [];
    } catch (error) {
      state.docs = [];
      toast(`\u6587\u6863\u8BFB\u53D6\u5931\u8D25\uFF1A${error.message}`, "warn", 4200);
    }
    return state.docs;
  }
  function docBySlug(slug) {
    return (state.docs || []).find((doc) => doc.slug === slug) || null;
  }
  let plotkitReady = false;
  function layoutPlotkitWindow() {
    const win = $("#plotkitWin");
    if (!win) return;
    win.classList.toggle("docked", Boolean(state.plotkitDock));
    const dock = $("#plotkitDock");
    if (dock) dock.classList.toggle("on", Boolean(state.plotkitDock));
    if (!state.plotkitDock) {
      if (!win.hidden) placeFloatWindow(win, "plotkitGeo");
      return;
    }
    const stage2 = $("#graph")?.closest(".stage") || $("#graph")?.parentElement;
    const rect = stage2?.getBoundingClientRect();
    if (!rect || rect.width < 240) return;
    const width = Math.max(560, Math.round(rect.width * 0.72));
    const height = Math.max(320, Math.round(rect.height * 0.78));
    win.style.left = `${Math.round(rect.left + rect.width - width - 16)}px`;
    win.style.top = `${Math.round(rect.top + 16)}px`;
    win.style.width = `${width}px`;
    win.style.height = `${height}px`;
  }
  function togglePlotkitDock() {
    const win = $("#plotkitWin");
    if (!win || win.hidden) return;
    state.plotkitDock = !state.plotkitDock;
    if (!state.plotkitDock) {
      win.style.left = "";
      win.style.top = "";
      win.style.width = "";
      win.style.height = "";
    }
    layoutPlotkitWindow();
  }
  function ensurePlotkitFrame() {
    const frame = $("#plotkitFrame");
    if (frame && !plotkitReady) {
      frame.src = plotkitFrameUrl({ embed: "1" });
      plotkitReady = true;
    }
    return frame;
  }
  function placePlotkit(mode) {
    const frame = ensurePlotkitFrame();
    const win = $("#plotkitWin");
    const host = $("#plotkitInlineHost");
    const floatBody = $("#plotkitWin .plotkit-body");
    state.plotkitMode = mode;
    if (!frame) {
      if (mode === "popup") toast("\u7ED8\u56FE iframe \u4E0D\u5B58\u5728\uFF0C\u5DF2\u6539\u4E3A\u72EC\u7ACB\u7A97\u53E3", "warn", 2400);
      return;
    }
    if (mode === "inline") {
      if (win) win.hidden = true;
      if (host) {
        host.hidden = false;
        host.appendChild(frame);
      }
      document.querySelector('[data-sub="plotkit"]')?.click();
      if (typeof setStatusHint === "function") setStatusHint("\u7ED8\u56FE\u5DF2\u5D4C\u5728\u53F3\u4FA7\u9762\u677F \xB7 \u70B9\u300C\u6D6E\u51FA\u7A97\u53E3\u300D\u53EF\u62D6\u5230\u753B\u5E03\u4E0A");
    } else if (mode === "float") {
      if (host) host.hidden = true;
      if (floatBody) floatBody.appendChild(frame);
      openPlotkit();
    } else if (mode === "popup") {
      const url = plotkitFrameUrl({ embed: "1" });
      const popup = window.open(url, "netlab-plotkit", "width=1180,height=820");
      if (popup) {
        toast("\u5DF2\u5728\u72EC\u7ACB\u7A97\u53E3\u6253\u5F00\u7ED8\u56FE", "ok", 2400);
        if (typeof setStatusHint === "function") setStatusHint("\u72EC\u7ACB\u7ED8\u56FE\u7A97\u53E3 \xB7 \u6570\u636E\u4E0E\u4E3B\u754C\u9762\u540C\u6E90");
      } else {
        toast("\u6D4F\u89C8\u5668\u62E6\u622A\u4E86\u5F39\u51FA\u7A97\u53E3\uFF0C\u8BF7\u5141\u8BB8\u540E\u91CD\u8BD5", "warn", 3200);
      }
    }
  }
  function openPlotkit() {
    const win = $("#plotkitWin");
    if (!win) return;
    ensurePlotkitFrame();
    win.hidden = false;
    win.classList.remove("minimized");
    layoutPlotkitWindow();
    if (typeof raiseFloatWindow === "function") raiseFloatWindow(win);
  }
  function closePlotkit() {
    const win = $("#plotkitWin");
    if (!win) return;
    win.hidden = true;
    win.classList.remove("minimized", "maximized");
    state.plotkitGeo = null;
  }
  let vscodeStarting = null;
  async function ensureVscodeFrame() {
    const frame = $("#vscodeFrame");
    if (!frame) return null;
    if (frame.dataset.ready === "1") return frame;
    if (vscodeStarting) return vscodeStarting;
    const status = $("#vscodeStatus");
    if (status) {
      status.hidden = false;
      status.textContent = "\u6B63\u5728\u542F\u52A8 VS Code Server\u2026";
    }
    vscodeStarting = (async () => {
      try {
        const info = await api("/api/vscode/status?start=1", { timeoutMs: 6e4 });
        if (!info || !info.url) {
          throw new Error(info && info.error || "VS Code Server \u4E0D\u53EF\u7528");
        }
        frame.src = info.url;
        frame.dataset.ready = "1";
        if (status) status.hidden = true;
        try {
          localStorage.setItem("netlab.vscode.used", "1");
        } catch (e) {
        }
        return frame;
      } catch (error) {
        if (status) {
          status.hidden = false;
          status.textContent = `VS Code \u542F\u52A8\u5931\u8D25\uFF1A${error.message}`;
        }
        toast(`VS Code \u542F\u52A8\u5931\u8D25\uFF1A${error.message}`, "warn", 5e3);
        return null;
      } finally {
        vscodeStarting = null;
      }
    })();
    return vscodeStarting;
  }
  async function openVscode() {
    const win = $("#vscodeWin");
    if (!win) return;
    win.hidden = false;
    win.classList.remove("minimized");
    placeFloatWindow(win, "vscodeGeo");
    raiseFloatWindow(win);
    await ensureVscodeFrame();
  }
  function closeVscode() {
    const win = $("#vscodeWin");
    if (!win) return;
    win.hidden = true;
    win.classList.remove("minimized", "maximized");
    state.vscodeGeo = null;
  }
  function vscodeWasUsed() {
    try {
      return localStorage.getItem("netlab.vscode.used") === "1";
    } catch (e) {
      return false;
    }
  }
  function maybePrewarmVscode() {
    if (!vscodeWasUsed()) return;
    setTimeout(() => {
      void ensureVscodeFrame();
    }, 2500);
  }
  async function openDoc(slug = "quickstart") {
    if (!ui.docWin) return;
    await ensureDocs();
    const doc = docBySlug(slug) || state.docs[0];
    if (!doc) {
      toast("\u6587\u6863\u76EE\u5F55\u4E3A\u7A7A\uFF0C\u8BF7\u68C0\u67E5\u540E\u7AEF\u5B89\u88C5", "warn", 4e3);
      return;
    }
    state.docSlug = doc.slug;
    ui.docWin.hidden = false;
    ui.docWin.classList.remove("min");
    document.body.classList.add("doc-open");
    ui.docTitle.textContent = `NETLAB \xB7 ${doc.title}`;
    renderDocNav();
    renderDocBody(doc);
    ui.docContent.parentElement.scrollTop = 0;
    ui.docSearch.value = "";
    ui.docResults.replaceChildren();
    placeDocWindow();
  }
  function closeDoc() {
    if (!ui.docWin) return;
    ui.docWin.hidden = true;
    ui.docWin.classList.remove("minimized", "maximized");
    document.body.classList.remove("doc-open");
    state.docGeo = null;
    if (state.guideShown && !ui.guide.hidden) syncPrefControls();
  }
  function renderDocNav() {
    if (!ui.docNav) return;
    ui.docNav.replaceChildren();
    for (const doc of state.docs) {
      const node = button(doc.title, "docnav-item", () => {
        state.docSlug = doc.slug;
        ui.docTitle.textContent = `NETLAB \xB7 ${doc.title}`;
        renderDocNav();
        renderDocBody(doc);
        ui.docResults.replaceChildren();
        ui.docSearch.value = "";
      });
      node.classList.toggle("active", doc.slug === state.docSlug);
      ui.docNav.appendChild(node);
    }
  }
  function renderDocBody(doc) {
    if (!ui.docContent) return;
    const fragment = renderMarkdown(doc.text || "");
    ui.docContent.replaceChildren(fragment);
  }
  function renderInline(text, target) {
    const source = String(text || "");
    const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
    let cursor = 0;
    let match;
    while (match = pattern.exec(source)) {
      if (match.index > cursor) target.appendChild(document.createTextNode(source.slice(cursor, match.index)));
      const token = match[0];
      if (token.startsWith("**")) {
        target.appendChild(el("b", null, token.slice(2, -2)));
      } else if (token.startsWith("`")) {
        target.appendChild(el("code", null, token.slice(1, -1)));
      } else {
        const label = token.slice(1, token.indexOf("]"));
        target.appendChild(el("span", "doc-link", label));
      }
      cursor = match.index + token.length;
    }
    if (cursor < source.length) target.appendChild(document.createTextNode(source.slice(cursor)));
    return target;
  }
  function renderMarkdown(text) {
    const fragment = document.createDocumentFragment();
    const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
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
        const pre = el("pre", "doc-code");
        pre.textContent = code.join("\n");
        fragment.appendChild(pre);
        continue;
      }
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        const node = el(level === 1 ? "h1" : level === 2 ? "h2" : "h3", "doc-h");
        node.id = `doc-h-${blockId++}`;
        renderInline(heading[2], node);
        fragment.appendChild(node);
        index += 1;
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        const list = el("ul", "doc-list");
        while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
          const item = el("li");
          renderInline(lines[index].replace(/^\s*[-*]\s+/, ""), item);
          list.appendChild(item);
          index += 1;
        }
        fragment.appendChild(list);
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        const list = el("ol", "doc-list");
        while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
          const item = el("li");
          renderInline(lines[index].replace(/^\s*\d+\.\s+/, ""), item);
          list.appendChild(item);
          index += 1;
        }
        fragment.appendChild(list);
        continue;
      }
      if (/^\s*>\s?/.test(line)) {
        const quote = el("blockquote", "doc-quote");
        while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
          renderInline(lines[index].replace(/^\s*>\s?/, ""), quote);
          quote.appendChild(document.createElement("br"));
          index += 1;
        }
        fragment.appendChild(quote);
        continue;
      }
      if (!line.trim()) {
        index += 1;
        continue;
      }
      const paragraph = el("p", "doc-p");
      const parts = [line];
      index += 1;
      while (index < lines.length && lines[index].trim() && !/^(#{1,4}\s|```|\s*[-*]\s|\s*\d+\.\s|>)/.test(lines[index])) {
        parts.push(lines[index]);
        index += 1;
      }
      renderInline(parts.join(" "), paragraph);
      fragment.appendChild(paragraph);
    }
    return fragment;
  }
  let docSearchSeq = 0;
  async function searchDocs(query) {
    if (!ui.docResults) return;
    const text = String(query || "").trim().toLowerCase();
    const seq = ++docSearchSeq;
    ui.docResults.replaceChildren();
    if (!text) {
      ui.docMain.classList.remove("searching");
      return;
    }
    ui.docMain.classList.add("searching");
    const hits = [];
    for (const doc of state.docs) {
      const blocks = String(doc.text || "").split(/\n{2,}/);
      for (const block of blocks) {
        if (block.toLowerCase().includes(text)) {
          hits.push({
            slug: doc.slug,
            title: doc.title,
            snippet: block.replace(/[#>*`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 150)
          });
          break;
        }
      }
    }
    let extra = [];
    try {
      const response = await api(`/api/help/search?q=${encodeURIComponent(text)}&limit=12`);
      extra = (response?.items || []).filter((item) => item.kind !== "doc");
    } catch {
      extra = [];
    }
    if (seq !== docSearchSeq) return;
    if (!hits.length && !extra.length) {
      ui.docResults.appendChild(div("doc-empty", "\u6CA1\u6709\u5339\u914D\u7684\u6BB5\u843D\uFF1B\u8BD5\u8BD5\u300C\u8282\u70B9\u300D\u300C\u6C42\u89E3\u5668\u300D\u300C\u5FEB\u6377\u952E\u300D\u7B49\u5173\u952E\u8BCD\u3002"));
      return;
    }
    for (const hit of hits) {
      const node = button("", "doc-hit", () => {
        void openDoc(hit.slug);
        ui.docSearch.value = query;
        void searchDocs(query);
      });
      node.appendChild(el("b", null, hit.title));
      node.appendChild(el("span", null, hit.snippet));
      ui.docResults.appendChild(node);
    }
    if (extra.length) {
      ui.docResults.appendChild(el("div", "doc-sec", "\u8282\u70B9 / \u5143\u4EF6 / \u6A21\u677F"));
      for (const item of extra) {
        const title = `${item.title} \xB7 ${item.subtitle}`;
        const node = button("", "doc-hit", () => {
          if (item.kind === "template") {
            closeDoc();
            void loadTemplate(item.ref || "", item.title || "");
          } else {
            toast(`${item.title}\uFF1A${item.text || "\u65E0\u66F4\u591A\u8BF4\u660E"}`, "info", 4200);
          }
        });
        node.appendChild(el("b", null, item.title || item.ref || ""));
        node.appendChild(el("span", null, item.text || item.subtitle || ""));
        ui.docResults.appendChild(node);
        node.title = title;
      }
    }
  }
  function placeFloatWindow(root, key) {
    if (!root) return;
    const geo = state[key];
    if (!geo) {
      root.classList.remove("moved");
      root.style.left = "";
      root.style.top = "";
      root.style.width = "";
      root.style.height = "";
      return;
    }
    root.classList.add("moved");
    root.style.left = `${geo.left}px`;
    root.style.top = `${geo.top}px`;
    root.style.width = `${geo.width}px`;
    root.style.height = `${geo.height}px`;
  }
  function placeDocWindow() {
    placeFloatWindow(ui.docWin, "docGeo");
  }
  function raiseFloatWindow(root) {
    if (!root) return;
    const cur = state.floatZ || 131;
    state.floatZ = cur >= 138 ? 132 : cur + 1;
    root.style.zIndex = String(state.floatZ);
  }
  function toggleFloatMaximize(root, key) {
    if (!root) return;
    root.classList.toggle("maximized");
    if (!root.classList.contains("maximized")) placeFloatWindow(root, key);
  }
  function initFloatWindow(root, key, spec = {}) {
    if (!root) return;
    const minWidth = spec.minWidth || 420;
    const minHeight = spec.minHeight || 320;
    root.addEventListener("pointerdown", () => raiseFloatWindow(root), true);
    const head = root.querySelector(".floatwin-head");
    if (head) {
      let drag = null;
      head.addEventListener("pointerdown", (event) => {
        if (event.target.closest("button")) return;
        if (root.classList.contains("maximized") || root.classList.contains("minimized")) return;
        const rect = root.getBoundingClientRect();
        drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
        head.setPointerCapture(event.pointerId);
      });
      head.addEventListener("pointermove", (event) => {
        if (!drag) return;
        const rect = root.getBoundingClientRect();
        const maxTop = Math.max(40, window.innerHeight - rect.height - 8);
        const maxLeft = Math.max(8, window.innerWidth - 140);
        state[key] = {
          left: clamp(event.clientX - drag.dx, 8, maxLeft),
          top: clamp(event.clientY - drag.dy, 40, maxTop),
          width: rect.width,
          height: rect.height
        };
        placeFloatWindow(root, key);
      });
      const stopDrag = () => {
        drag = null;
      };
      head.addEventListener("pointerup", stopDrag);
      head.addEventListener("pointercancel", stopDrag);
      head.addEventListener("dblclick", (event) => {
        if (event.target.closest("button")) return;
        toggleFloatMaximize(root, key);
      });
    }
    root.querySelector(".floatwin-min")?.addEventListener("click", () => {
      root.classList.toggle("minimized");
    });
    root.querySelector(".floatwin-max")?.addEventListener("click", () => toggleFloatMaximize(root, key));
    const grip = root.querySelector(".floatwin-resize");
    if (grip) {
      let resize = null;
      grip.addEventListener("pointerdown", (event) => {
        if (root.classList.contains("maximized") || root.classList.contains("minimized")) return;
        const rect = root.getBoundingClientRect();
        resize = { x: event.clientX, y: event.clientY, w: rect.width, h: rect.height, left: rect.left, top: rect.top };
        grip.setPointerCapture(event.pointerId);
      });
      grip.addEventListener("pointermove", (event) => {
        if (!resize) return;
        state[key] = {
          left: resize.left,
          top: resize.top,
          width: clamp(resize.w + event.clientX - resize.x, minWidth, Math.max(minWidth, window.innerWidth - resize.left - 12)),
          height: clamp(resize.h + event.clientY - resize.y, minHeight, Math.max(minHeight, window.innerHeight - resize.top - 12))
        };
        placeFloatWindow(root, key);
      });
      const stopResize = () => {
        resize = null;
      };
      grip.addEventListener("pointerup", stopResize);
      grip.addEventListener("pointercancel", stopResize);
    }
  }
  function analEscape(text) {
    return String(text ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  }
  function analNum(value, digits = 6) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "\u2014";
    const abs = Math.abs(num);
    if (abs !== 0 && (abs < 1e-4 || abs >= 1e5)) return num.toExponential(3);
    return String(Number(num.toFixed(digits)));
  }
  function analToken(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (value || "").trim() || fallback;
  }
  function analysisWarn() {
    toast("\u5206\u6790\u4F1A\u57FA\u4E8E\u5F53\u524D\u573A\u666F\u91CD\u65B0\u6C42\u89E3\uFF0C\u671F\u95F4\u5B9E\u65F6\u64AD\u653E\u4F1A\u6682\u505C\uFF1B\u53EF\u968F\u65F6\u5173\u95ED\u5206\u6790\u7A97\u3002", "warn", 4200);
  }
  function openAnalysis(tab = "op") {
    const win = $("#analWin");
    if (!win) return;
    if ((state.scene?.mode || state.mode) !== "circuit") {
      toast("DC \u5DE5\u4F5C\u70B9 / AC \u626B\u9891\u53EA\u5728\u7535\u8DEF\u6A21\u5F0F\u4E0B\u53EF\u7528", "error", 4e3);
      return;
    }
    win.hidden = false;
    raiseFloatWindow(win);
    fillAcSources();
    selectAnalTab(tab);
  }
  function closeAnalysis() {
    const win = $("#analWin");
    if (win) win.hidden = true;
  }
  function selectAnalTab(tab) {
    for (const btn of $$(".anal-tab")) {
      btn.classList.toggle("active", btn.dataset.anal === tab);
    }
    for (const pane of $$(".anal-pane")) {
      pane.hidden = pane.dataset.analPane !== tab;
    }
    if (tab === "ac") requestAnimationFrame(() => drawAcChart());
  }
  function fillAcSources() {
    const select = $("#analAcInput");
    if (!select) return;
    const previous = select.value;
    const nodes = state.scene?.nodes || [];
    const sources = nodes.filter((node) => {
      const kind = node.kind === "device" ? node.params?.element : node.kind;
      return kind === "vsource" || kind === "isource";
    });
    select.innerHTML = '<option value="">\u81EA\u52A8</option>' + sources.map((node) => `<option value="${analEscape(node.name)}">${analEscape(node.name)}</option>`).join("");
    if (sources.some((node) => node.name === previous)) select.value = previous;
  }
  async function runOperatingPoint() {
    analysisWarn();
    const body = $("#analOpTable");
    const meta = $("#analOpMeta");
    if (meta) meta.textContent = "\u6C42\u89E3\u4E2D\u2026";
    try {
      const data = await api("/api/operating-point");
      const result = data.result || {};
      const nodeRows = Object.entries(result.node_voltages || {}).map(([name, value]) => `<tr><td>${analEscape(name)}</td><td class="num">${analNum(value)}</td></tr>`).join("");
      const elementRows = Object.entries(result.elements || {}).map(([name, info]) => `<tr><td>${analEscape(name)}</td><td class="num">${analNum(info.current)}</td><td class="num">${analNum(info.voltage_difference)}</td><td class="num">${analNum(info.power)}</td></tr>`).join("");
      if (body) {
        body.innerHTML = "<table><caption>\u8282\u70B9\u7535\u538B\uFF08V\uFF09</caption><thead><tr><th>\u8282\u70B9</th><th>\u7535\u538B</th></tr></thead><tbody>" + (nodeRows || '<tr><td colspan="2">\u6CA1\u6709\u8282\u70B9</td></tr>') + "</tbody></table><table><caption>\u5143\u4EF6</caption><thead><tr><th>\u5143\u4EF6</th><th>\u7535\u6D41\uFF08A\uFF09</th><th>\u7AEF\u7535\u538B\uFF08V\uFF09</th><th>\u529F\u7387\uFF08W\uFF09</th></tr></thead><tbody>" + (elementRows || '<tr><td colspan="4">\u6CA1\u6709\u5143\u4EF6</td></tr>') + "</tbody></table>";
      }
      if (meta) {
        meta.textContent = `\u8FED\u4EE3 ${result.iterations ?? "\u2014"} \u6B65 \xB7 \u77E9\u9635 ${result.matrix_size ?? "\u2014"} \xB7 \u6B8B\u5DEE ${analNum(result.residual, 3)} \xB7 ${result.sparse ? "\u7A00\u758F" : "\u7A20\u5BC6"}` + (result.strategies?.length ? ` \xB7 ${result.strategies.join("/")}` : "");
      }
    } catch (error) {
      if (body) body.innerHTML = `<div class="anal-empty">${analEscape(error.message)}</div>`;
      if (meta) meta.textContent = "\u6C42\u89E3\u5931\u8D25";
      toast(`DC \u5DE5\u4F5C\u70B9\u5931\u8D25\uFF1A${error.message}`, "error", 6e3);
    }
  }
  async function runAcSweep() {
    analysisWarn();
    const meta = $("#analAcMeta");
    const params = new URLSearchParams();
    const input = $("#analAcInput")?.value || "";
    if (input) params.set("input", input);
    params.set("f_start", $("#analAcF1")?.value || "10");
    params.set("f_stop", $("#analAcF2")?.value || "1000000");
    params.set("points", $("#analAcPts")?.value || "121");
    params.set("scale", $("#analAcScale")?.value || "log");
    const probeNames = (state.scene?.nodes || []).filter((node) => node.kind === "node").map((node) => node.name).filter(Boolean);
    if (probeNames.length) params.set("probes", probeNames.join(","));
    if (meta) meta.textContent = "\u626B\u9891\u4E2D\u2026";
    try {
      const data = await api(`/api/ac-sweep?${params.toString()}`);
      state.acResult = data.result || null;
      state.acRevision = state.scene?.revision ?? null;
      const result = state.acResult;
      const count = Object.keys(result?.probes || {}).length;
      if (meta) {
        meta.textContent = `${count} \u6761\u66F2\u7EBF \xB7 \u6FC0\u52B1 ${result?.input || "\u2014"} \xB7 ${result?.frequencies?.length || 0} \u70B9`;
      }
      drawAcChart();
    } catch (error) {
      state.acResult = null;
      if (meta) meta.textContent = "\u626B\u9891\u5931\u8D25";
      toast(`AC \u626B\u9891\u5931\u8D25\uFF1A${error.message}`, "error", 7e3);
      drawAcChart();
    }
  }
  function drawAcChart() {
    const canvas2 = $("#analAcCanvas");
    if (!canvas2) return;
    const rect = canvas2.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    const dpr = window.devicePixelRatio || 1;
    canvas2.width = Math.round(rect.width * dpr);
    canvas2.height = Math.round(rect.height * dpr);
    const ctx2 = canvas2.getContext("2d");
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = rect.width;
    const H = rect.height;
    const ink = analToken("--ink", "#080a08");
    const muted = analToken("--muted", "#7b7266");
    const line = analToken("--line", "#d9d3c7");
    ctx2.clearRect(0, 0, W, H);
    const result = state.acResult;
    const legend = $("#analAcLegend");
    if (!result || !result.frequencies?.length) {
      if (legend) legend.innerHTML = "";
      ctx2.fillStyle = muted;
      ctx2.font = '12.5px "Microsoft YaHei UI", sans-serif';
      ctx2.fillText("\u9009\u62E9\u6FC0\u52B1\u4E0E\u9891\u7387\u8303\u56F4\u540E\u70B9\u300C\u5F00\u59CB\u626B\u9891\u300D", 16, 26);
      return;
    }
    const freqs = result.frequencies;
    const probes = Object.entries(result.probes || {});
    const scale = $("#analAcScale")?.value || "log";
    const f0 = freqs[0];
    const f1 = freqs[freqs.length - 1];
    const padL = 52;
    const padR = 14;
    const padT = 12;
    const gap = 30;
    const padB = 26;
    const magH = (H - padT - padB - gap) * 0.62;
    const phaseH = H - padT - padB - gap - magH;
    const magTop = padT;
    const phaseTop = padT + magH + gap;
    const plotW = Math.max(40, W - padL - padR);
    const xOf = (f) => {
      if (scale === "log") {
        const lo = Math.log10(Math.max(f0, 1e-9));
        const hi = Math.log10(Math.max(f1, 1e-9));
        const span2 = hi - lo || 1;
        return padL + (Math.log10(Math.max(f, 1e-9)) - lo) / span2 * plotW;
      }
      const span = f1 - f0 || 1;
      return padL + (f - f0) / span * plotW;
    };
    let minDb = 0;
    let maxDb = 0;
    for (const [, info] of probes) {
      for (const value of info.db || []) {
        if (!Number.isFinite(value)) continue;
        minDb = Math.min(minDb, value);
        maxDb = Math.max(maxDb, value);
      }
    }
    if (maxDb - minDb < 6) {
      maxDb += 3;
      minDb -= 3;
    } else {
      minDb -= 3;
      maxDb += 3;
    }
    const yMag = (db) => magTop + (1 - (db - minDb) / (maxDb - minDb || 1)) * magH;
    const yPhase = (deg) => phaseTop + (1 - (deg + 180) / 360) * phaseH;
    ctx2.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx2.strokeStyle = line;
    ctx2.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = magTop + magH * i / 4;
      ctx2.beginPath();
      ctx2.moveTo(padL, y);
      ctx2.lineTo(padL + plotW, y);
      ctx2.stroke();
      ctx2.fillStyle = muted;
      const value = maxDb - (maxDb - minDb) * i / 4;
      ctx2.fillText(`${value.toFixed(0)} dB`, 6, y + 4);
    }
    for (const deg of [-180, -90, 0, 90, 180]) {
      const y = yPhase(deg);
      ctx2.beginPath();
      ctx2.moveTo(padL, y);
      ctx2.lineTo(padL + plotW, y);
      ctx2.stroke();
      ctx2.fillStyle = muted;
      ctx2.fillText(`${deg}\xB0`, 18, y + 4);
    }
    const ticks = 5;
    for (let i = 0; i < ticks; i += 1) {
      const ratio = i / (ticks - 1);
      const f = scale === "log" ? 10 ** (Math.log10(f0) + (Math.log10(f1) - Math.log10(f0)) * ratio) : f0 + (f1 - f0) * ratio;
      const x = padL + plotW * ratio;
      ctx2.strokeStyle = line;
      ctx2.beginPath();
      ctx2.moveTo(x, magTop);
      ctx2.lineTo(x, magTop + magH + gap + phaseH);
      ctx2.stroke();
      ctx2.fillStyle = muted;
      const label = f >= 1e6 ? `${(f / 1e6).toFixed(1)}M` : f >= 1e3 ? `${(f / 1e3).toFixed(1)}k` : f >= 1 ? `${f.toFixed(0)}` : f.toExponential(0);
      ctx2.fillText(label, x - 8, H - 8);
    }
    const swatches = [];
    probes.forEach(([name, info], index) => {
      const color = PALETTE[index % PALETTE.length];
      swatches.push(`<span><i style="background:${color}"></i>${analEscape(name)}</span>`);
      const draw = (values, yFn) => {
        ctx2.beginPath();
        ctx2.strokeStyle = color;
        ctx2.lineWidth = 1.6;
        let started = false;
        for (let i = 0; i < freqs.length; i += 1) {
          const value = values?.[i];
          if (!Number.isFinite(value)) continue;
          const x = xOf(freqs[i]);
          const y = yFn(value);
          if (!started) {
            ctx2.moveTo(x, y);
            started = true;
          } else {
            ctx2.lineTo(x, y);
          }
        }
        if (started) ctx2.stroke();
      };
      draw(info.db, yMag);
      draw(info.phase_deg, yPhase);
    });
    if (legend) legend.innerHTML = swatches.join("");
    ctx2.fillStyle = ink;
    ctx2.font = '11.5px "Microsoft YaHei UI", sans-serif';
    ctx2.fillText("\u5E45\u503C", 6, magTop + 8);
    ctx2.fillText("\u76F8\u4F4D", 6, phaseTop + 10);
  }
  let pkChannelCache = [];
  function pkKeyShort(key) {
    const parts = String(key).split(":");
    if (parts.length >= 3 && parts[0] === "n") return parts.slice(1).join(".");
    return String(key);
  }
  function pkCheckedKeys() {
    return Array.from(document.querySelectorAll("#pkChannelList input[type=checkbox]")).filter((el2) => el2.checked).map((el2) => el2.value);
  }
  function renderPkChannels(selected) {
    const box = $("#pkChannelList");
    if (!box) return;
    const want = new Set(selected && selected.length ? selected : pkCheckedKeys());
    box.textContent = "";
    if (!pkChannelCache.length) {
      const empty = document.createElement("span");
      empty.className = "pk-empty";
      empty.textContent = "\u8FD8\u6CA1\u6709\u63A2\u9488\u6570\u636E\uFF1A\u5148\u8FD0\u884C\u4EFF\u771F\uFF0C\u6216\u6253\u5F00\u5E26\u63A2\u9488\u7684\u5DE5\u7A0B\u3002";
      box.appendChild(empty);
    } else {
      pkChannelCache.forEach((key) => {
        const label = document.createElement("label");
        label.className = "pk-ch";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = key;
        input.checked = want.has(key);
        const span = document.createElement("span");
        span.textContent = pkKeyShort(key);
        span.title = key;
        label.appendChild(input);
        label.appendChild(span);
        box.appendChild(label);
      });
    }
    const count = $("#pkDataCount");
    if (count) count.textContent = String(pkChannelCache.length);
  }
  function showPkChannelLoadError(message) {
    const hint = $("#pkDataHint");
    const box = $("#pkChannelList");
    const text = message || "\u8BF7\u6C42\u5931\u8D25";
    if (hint) hint.textContent = `\u6570\u636E\u5237\u65B0\u5931\u8D25\uFF1A${text}\uFF1B\u73B0\u6709\u901A\u9053\u5217\u8868\u672A\u6E05\u9664\uFF0C\u53EF\u70B9\u51FB\u300C\u91CD\u8BD5\u300D\u3002`;
    if (pkChannelCache.length || !box) return;
    box.textContent = "";
    const empty = document.createElement("span");
    empty.className = "pk-empty";
    empty.textContent = `\u63A2\u9488\u5217\u8868\u52A0\u8F7D\u5931\u8D25\uFF1A${text}`;
    box.appendChild(empty);
  }
  async function refreshPkChannels(keepSelection) {
    const hint = $("#pkDataHint");
    try {
      const data = await api("/api/plotkit/channels");
      const avail = data && data.available || [];
      const registered = data && data.channels || [];
      if (data && data.build && data.build !== UI_BUILD) {
        pkChannelCache = avail;
        renderPkChannels([]);
        if (hint) hint.textContent = `\u670D\u52A1\u7AEF\u8FDB\u7A0B\u8FD8\u662F\u65E7\u7248\u672C\uFF08\u540E\u7AEF ${data.build} / \u754C\u9762 ${UI_BUILD}\uFF09\u2014\u2014\u8BF7\u5B8C\u5168\u9000\u51FA\u5E94\u7528\u540E\u91CD\u65B0\u542F\u52A8\uFF1B\u53EA\u5173\u95ED\u7A97\u53E3\u53EF\u80FD\u6B8B\u7559\u65E7\u8FDB\u7A0B\u3002`;
        return false;
      }
      if (!data || !data.mounted) {
        pkChannelCache = avail;
        renderPkChannels([]);
        const why = data && data.diag && data.diag.last_error || "\u627E\u4E0D\u5230 plotkit \u5305";
        if (hint) hint.textContent = `PlotKit \u672A\u6302\u8F7D\uFF1A${why}`;
        return false;
      }
      pkChannelCache = avail.length ? avail : registered;
      renderPkChannels(keepSelection ? null : data.selected || []);
      if (hint) {
        hint.textContent = avail.length ? `\u573A\u666F\u5171 ${avail.length} \u6761\u63A2\u9488\uFF0C\u5DF2\u767B\u8BB0 ${registered.length} \u6761\uFF0C\u5F53\u524D\u753B ${(data.selected || []).length} \u6761\uFF1B\u52FE\u9009\u540E\u70B9\u300C\u63A5\u5165\u300D\u3002` : "\u5F53\u524D\u573A\u666F\u6CA1\u6709\u63A2\u9488\uFF1A\u5148\u653E\u63A2\u9488\u8282\u70B9\u6216\u6253\u5F00\u5E26\u63A2\u9488\u7684\u5DE5\u7A0B\u3002";
      }
      return true;
    } catch (error) {
      showPkChannelLoadError(error.message);
      return false;
    }
  }
  async function retryPlotkit() {
    const hint = $("#pkDataHint");
    if (hint) hint.textContent = "\u6B63\u5728\u91CD\u65B0\u68C0\u6D4B PlotKit\u2026";
    try {
      const data = await api("/api/plotkit/channels");
      if (data && data.mounted) {
        reloadPlotkitFrame();
        const refreshed = await refreshPkChannels(true);
        if (!refreshed) {
          toast("\u901A\u9053\u5237\u65B0\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u63D0\u793A", "warn", 4e3);
          return;
        }
        toast("PlotKit \u5DF2\u5C31\u7EEA", "info", 1800);
      } else {
        const why = data && data.diag && data.diag.last_error || "\u672A\u77E5\u539F\u56E0";
        if (hint) hint.textContent = `\u4ECD\u7136\u672A\u6302\u8F7D\uFF1A${why}`;
        toast("PlotKit \u4ECD\u672A\u6302\u8F7D\uFF0C\u8BF7\u770B\u63D0\u793A", "warn", 4e3);
      }
    } catch (error) {
      showPkChannelLoadError(error.message);
      toast("\u91CD\u65B0\u68C0\u6D4B\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u63D0\u793A", "warn", 4e3);
    }
  }
  function reloadPlotkitFrame() {
    const frame = $("#plotkitFrame");
    if (frame) frame.src = plotkitFrameUrl({ embed: "1", r: String(Date.now()) });
  }
  async function applyPkChannels() {
    const keys = pkCheckedKeys();
    const hint = $("#pkDataHint");
    const applyBtn = $("#pkChApply");
    const seconds = Math.max(1, Math.min(120, Number(state.chart && state.chart.window) || 5));
    if (applyBtn) applyBtn.disabled = true;
    try {
      if (hint) hint.textContent = "\u6B63\u5728\u767B\u8BB0\u9009\u4E2D\u901A\u9053\u2026";
      const data = await api("/api/plotkit/channels", {
        method: "POST",
        body: JSON.stringify({ keys })
      });
      if (!data || !data.ok) {
        const message = data && data.error || (data && data.mounted === false ? "PlotKit \u672A\u6302\u8F7D" : "\u672A\u77E5\u539F\u56E0");
        if (hint) hint.textContent = `\u63A5\u5165\u5931\u8D25\uFF1A${message}`;
        toast(`\u63A5\u5165\u5931\u8D25\uFF1A${message}`, "warn", 4e3);
        return;
      }
      if (hint) hint.textContent = `\u6B63\u5728\u9884\u8BA1\u7B97 0\u2192${seconds}s \u7684\u6570\u636E\u2026`;
      const pre = await api("/api/plotkit/precompute", {
        method: "POST",
        body: JSON.stringify({ seconds })
      });
      if (pre && pre.ok === false) {
        toast("\u9884\u8BA1\u7B97\u5931\u8D25\uFF1A" + (pre.error || "\u672A\u77E5\u9519\u8BEF"), "warn", 4e3);
        if (hint) hint.textContent = `\u9884\u8BA1\u7B97\u5931\u8D25\uFF1A${pre.error || "\u672A\u77E5\u9519\u8BEF"}\uFF1B\u53EF\u91CD\u8BD5\u6216\u68C0\u67E5\u573A\u666F\u3002`;
        return;
      }
      if (pre && pre.elapsed_ms) {
        const degradedNote = pre.degraded ? `\uFF1B\u6B65\u957F\u5DF2\u964D\u7EA7\u4E3A ${Number(pre.dt_used).toExponential(1)}s\uFF08\u8BF7\u6C42 ${Number(pre.requested_dt).toExponential(1)}s\uFF0C\u53D7 20 \u4E07\u6B65\u4E0A\u9650\u9650\u5236\uFF09` : "";
        if (hint) hint.textContent = `\u9884\u8BA1\u7B97\u5B8C\u6210\uFF1A${seconds}s / ${pre.frames ?? pre.frames_recorded ?? "?"} \u5E27 / ${Math.round(pre.elapsed_ms)} ms${degradedNote}`;
        if (pre.degraded) {
          toast(`\u9884\u8BA1\u7B97\u5DF2\u964D\u7EA7\u6B65\u957F ${Number(pre.dt_used).toExponential(1)}s\uFF0C\u7F29\u5C0F\u65F6\u95F4\u7A97\u53EF\u63D0\u9AD8\u7CBE\u5EA6`, "warn", 5200);
        }
      }
      toast(`\u5DF2\u63A5\u5165 ${(data.selected || []).length} \u6761\u901A\u9053`, "ok", 2600);
      reloadPlotkitFrame();
      await refreshPkChannels();
    } catch (error) {
      const message = error.message || "\u8BF7\u6C42\u5931\u8D25";
      if (hint) hint.textContent = `\u63A5\u5165\u5931\u8D25\uFF1A${message}`;
      toast(`\u63A5\u5165\u5931\u8D25\uFF1A${message}`, "warn", 4e3);
    } finally {
      if (applyBtn) applyBtn.disabled = false;
    }
  }
  function pkKeysForSelectedNode() {
    const node = selectedNode();
    if (!node) {
      toast("\u5148\u5728\u753B\u5E03\u4E0A\u9009\u4E2D\u4E00\u4E2A\u8282\u70B9", "warn", 2400);
      return null;
    }
    const names = [node.id, node.name].filter(Boolean).map(String);
    return pkChannelCache.filter((key) => names.some((name) => key === name || key.startsWith(name + ":") || key.indexOf(":" + name + ":") >= 0));
  }
  function initPlotkitDataBar() {
    const all = $("#pkChAll");
    const none = $("#pkChNone");
    const nodeBtn = $("#pkChNode");
    const apply = $("#pkChApply");
    if (all) all.addEventListener("click", () => {
      document.querySelectorAll("#pkChannelList input").forEach((i) => {
        i.checked = true;
      });
    });
    if (none) none.addEventListener("click", () => {
      document.querySelectorAll("#pkChannelList input").forEach((i) => {
        i.checked = false;
      });
    });
    if (nodeBtn) nodeBtn.addEventListener("click", () => {
      const keys = pkKeysForSelectedNode();
      if (!keys) return;
      if (!keys.length) {
        toast("\u8FD9\u4E2A\u8282\u70B9\u6CA1\u6709\u63A2\u9488\u901A\u9053", "warn", 2400);
        return;
      }
      document.querySelectorAll("#pkChannelList input").forEach((i) => {
        i.checked = keys.indexOf(i.value) >= 0;
      });
      toast(`\u5DF2\u52FE\u9009\u8BE5\u8282\u70B9\u7684 ${keys.length} \u6761\u901A\u9053`, "info", 2200);
    });
    if (apply) apply.addEventListener("click", applyPkChannels);
    const retry = $("#pkChRetry");
    if (retry) retry.addEventListener("click", retryPlotkit);
    document.querySelectorAll('[data-sub="plotkit"]').forEach((btn) => {
      btn.addEventListener("click", () => setTimeout(() => refreshPkChannels(true), 60));
    });
    setInterval(() => {
      const pane = $("#tab-plotkit");
      if (pane && !pane.hidden) refreshPkChannels(true);
    }, 5e3);
  }
  function initAnalWin() {
    const win = $("#analWin");
    if (!win) return;
    win.querySelector("#analWinClose")?.addEventListener("click", closeAnalysis);
    for (const btn of $$(".anal-tab")) {
      btn.addEventListener("click", () => {
        selectAnalTab(btn.dataset.anal || "op");
        if (btn.dataset.anal === "ac") fillAcSources();
      });
    }
    $("#analRunOp")?.addEventListener("click", () => void runOperatingPoint());
    $("#analRunAc")?.addEventListener("click", () => void runAcSweep());
    initFloatWindow(win, "analGeo", { minWidth: 560, minHeight: 420 });
    window.addEventListener("resize", () => {
      if (!win.hidden && !win.querySelector('.anal-pane[data-anal-pane="ac"]')?.hidden) {
        drawAcChart();
      }
    });
  }
  function initDocWin() {
    if (!ui.docWin) return;
    ui.docWin.querySelector("#docWinClose")?.addEventListener("click", closeDoc);
    ui.docSearch?.addEventListener("input", () => searchDocs(ui.docSearch.value));
    ui.docSearch?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        const first = ui.docResults.querySelector(".doc-hit");
        if (first) first.click();
      }
      if (event.key === "Escape") {
        ui.docSearch.value = "";
        searchDocs("");
      }
    });
    initFloatWindow(ui.docWin, "docGeo", { minWidth: 420, minHeight: 320 });
    const plotkitWin = $("#plotkitWin");
    if (plotkitWin) {
      initFloatWindow(plotkitWin, "plotkitGeo", { minWidth: 720, minHeight: 480 });
      $("#plotkitWinClose")?.addEventListener("click", closePlotkit);
      $("#plotkitDock")?.addEventListener("click", togglePlotkitDock);
      window.addEventListener("resize", () => {
        if (state.plotkitDock && !plotkitWin.hidden) layoutPlotkitWindow();
      });
      $("#btnOpenPlotkit")?.addEventListener("click", () => placePlotkit("float"));
      $("#btnPlotkitInline")?.addEventListener("click", () => placePlotkit("inline"));
      $("#btnPlotkitPopup")?.addEventListener("click", () => placePlotkit("popup"));
      $("#plotkitPopout")?.addEventListener("click", () => {
        closePlotkit();
        placePlotkit("popup");
      });
    }
    const vscodeWin = $("#vscodeWin");
    if (vscodeWin) {
      initFloatWindow(vscodeWin, "vscodeGeo", { minWidth: 720, minHeight: 520 });
      $("#vscodeWinClose")?.addEventListener("click", closeVscode);
      maybePrewarmVscode();
    }
  }
  function hideHelpCard() {
    if (ui.qcard) ui.qcard.hidden = true;
  }
  function showHelpCard(anchor, info) {
    if (!ui.qcard) return;
    ui.qcard.replaceChildren();
    const head = div("qcard-head");
    head.appendChild(el("b", null, info.title || "\u53C2\u6570\u8BF4\u660E"));
    const close = button("\u2715", "qcard-close", hideHelpCard);
    head.appendChild(close);
    ui.qcard.appendChild(head);
    const dl = el("dl");
    const sections = [
      ["\u8BF4\u660E", info.description || "\u8BE5\u53C2\u6570\u6CA1\u6709\u989D\u5916\u8BF4\u660E\u3002"],
      ["\u53D6\u503C", info.range || "\u2014"],
      ["\u5355\u4F4D\u4E0E\u9ED8\u8BA4", `${info.unit || "\u65E0\u91CF\u7EB2"} \xB7 \u9ED8\u8BA4 ${info.def === void 0 || info.def === null || info.def === "" ? "\u2014" : info.def}`],
      ["\u516C\u5F0F / \u5B9E\u73B0", info.formula || "\u2014"]
    ];
    for (const [label, value] of sections) {
      dl.appendChild(el("dt", null, label));
      dl.appendChild(el("dd", null, value));
    }
    ui.qcard.appendChild(dl);
    if (info.source) {
      const actions = div("qcard-actions");
      const jump = button("\u67E5\u770B\u5B9E\u73B0\u9875 \u2192", "btn tiny", () => {
        hideHelpCard();
        switchTab(info.role === "edge" ? "edge-fn" : "node-fn");
        toast(info.source, "info", 5200);
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
    const ask = button("?", "qbtn", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showHelpCard(ask, {
        title: `${param.label || param.key}\uFF08${param.key}\uFF09`,
        description: param.help,
        range: paramRangeText(param),
        unit: param.unit,
        def: param.default,
        formula: spec?.formula || "",
        source: spec?.source_path || "",
        role
      });
    });
    ask.title = "\u56DB\u6BB5\u5F0F\u53C2\u6570\u8BF4\u660E\uFF08\u8BF4\u660E / \u53D6\u503C / \u5355\u4F4D\u4E0E\u9ED8\u8BA4 / \u516C\u5F0F\uFF09";
    ask.setAttribute("aria-label", `\u67E5\u770B ${param.key} \u7684\u8BF4\u660E`);
    cell.appendChild(ask);
  }
  async function ensureStoppedOnBoot() {
    try {
      if (state.sim?.running) await networkControl("pause");
      if (state.fem?.running) await femControl("pause");
    } catch (error) {
    }
  }
  function initShellKeys() {
    document.addEventListener("keydown", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]');
      if (event.key === "Escape") {
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
        if (ui.analWin && !ui.analWin.hidden) {
          closeAnalysis();
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
      if (event.ctrlKey && key === "k") {
        event.preventDefault();
        openDoc(state.docSlug || "quickstart");
        setTimeout(() => ui.docSearch?.focus(), 60);
        return;
      }
      if (key === "h") {
        event.preventDefault();
        openDoc("quickstart");
      }
      if (event.key === "?") {
        event.preventDefault();
        openDoc("shortcuts");
      }
    });
    document.addEventListener("click", (event) => {
      if (ui.qcard && !ui.qcard.hidden && !event.target.closest("#qcard, .qbtn")) hideHelpCard();
    });
  }
  function hexToRgb(hex) {
    const text = String(hex || "").trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(text)) {
      return [0, 1, 2].map((index) => parseInt(text[index] + text[index], 16));
    }
    if (!/^[0-9a-fA-F]{6}$/.test(text)) return null;
    return [0, 2, 4].map((index) => parseInt(text.slice(index, index + 2), 16));
  }
  function hexToRgbString(hex) {
    const rgb = hexToRgb(hex);
    return rgb ? rgb.join(", ") : "155, 114, 71";
  }
  function typeLabelHelp(label, param) {
    if (!label || !param) return;
    const ask = button("?", "qbtn inline", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showHelpCard(ask, {
        title: `${param.label || param.key}\uFF08${param.key}\uFF09`,
        description: param.help,
        range: paramRangeText(param),
        unit: param.unit,
        def: param.default,
        role: state.selection?.type === "edge" ? "edge" : "node"
      });
    });
    ask.title = "\u53C2\u6570\u8BF4\u660E\uFF1A\u8BF4\u660E / \u53D6\u503C / \u5355\u4F4D\u4E0E\u9ED8\u8BA4";
    label.appendChild(ask);
  }
  function cacheHuman(n) {
    n = Number(n) || 0;
    if (n >= 1073741824) return (n / 1073741824).toFixed(1) + " GB";
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
    return Math.round(n) + " B";
  }
  function ensureCacheWin() {
    let win = document.getElementById("cacheWin");
    if (win) return win;
    win = document.createElement("div");
    win.id = "cacheWin";
    win.style.cssText = "position:fixed;inset:0;background:rgba(8,10,8,.36);display:none;z-index:90;";
    win.innerHTML = `
      <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(680px,92vw);
                  max-height:82vh;display:flex;flex-direction:column;border-radius:10px;overflow:hidden;
                  background:var(--bg,#faf8f2);border:1px solid var(--line,#cfc6b5);
                  box-shadow:0 18px 48px rgba(0,0,0,.28);color:var(--text,#080a08);font:13px/1.5 'Microsoft YaHei UI',sans-serif;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;
                    border-bottom:1px solid var(--line,#cfc6b5);">
          <strong>\u7F13\u5B58\u4F53\u68C0\u4E0E\u6E05\u7406</strong>
          <button type="button" data-close style="border:0;background:transparent;font-size:16px;cursor:pointer;">\u2715</button>
        </div>
        <div id="cacheBody" style="padding:12px 16px;overflow:auto;"></div>
        <div style="display:flex;gap:8px;align-items:center;padding:10px 16px;border-top:1px solid var(--line,#cfc6b5);">
          <span id="cacheMsg" style="flex:1;color:var(--muted,#7b7266);font-size:12px;">\u53EA\u6E05\u7406\u53EF\u518D\u751F\u6210\u7684\u7F13\u5B58\uFF1B\u5DE5\u7A0B\u3001\u81EA\u52A8\u4FDD\u5B58\u3001\u5BFC\u51FA\u7684\u56FE\u90FD\u4E0D\u4F1A\u88AB\u5220\u3002</span>
          <button type="button" data-act="scan" class="ghost">\u91CD\u65B0\u626B\u63CF</button>
          <button type="button" data-act="safe" class="primary">\u6E05\u7406\u5B89\u5168\u7F13\u5B58</button>
          <button type="button" data-act="caution" class="ghost">\u8FDE\u540C\u754C\u9762\u504F\u597D\u2026</button>
        </div>
      </div>`;
    document.body.appendChild(win);
    win.addEventListener("click", (ev) => {
      if (ev.target === win || ev.target.closest("[data-close]")) win.style.display = "none";
    });
    win.querySelector('[data-act="scan"]').addEventListener("click", () => renderCacheBody());
    win.querySelector('[data-act="safe"]').addEventListener("click", () => cleanCache(false));
    win.querySelector('[data-act="caution"]').addEventListener("click", () => cleanCache(true));
    return win;
  }
  function openCacheDialog() {
    ensureCacheWin().style.display = "block";
    renderCacheBody();
  }
  function renderCacheBody() {
    const body = document.getElementById("cacheBody");
    if (!body) return;
    body.textContent = "\u6B63\u5728\u626B\u63CF\u2026";
    api("/api/cache/status").then((data) => {
      body.textContent = "";
      const entries = (data.entries || []).filter((e) => e.exists);
      if (!entries.length) {
        body.textContent = "\u6CA1\u6709\u53D1\u73B0\u53EF\u6E05\u7406\u7684\u7F13\u5B58\u3002";
        return;
      }
      const tierName = { safe: "\u5B89\u5168", caution: "\u8C28\u614E", protected: "\u4FDD\u62A4" };
      entries.forEach((e) => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-bottom:1px dashed var(--line,#cfc6b5);";
        const tag = document.createElement("span");
        tag.textContent = tierName[e.tier] || e.tier;
        tag.style.cssText = "flex:none;font-size:11px;padding:1px 6px;border-radius:9px;border:1px solid var(--line,#cfc6b5);color:var(--muted,#7b7266);";
        const mid = document.createElement("div");
        mid.style.cssText = "flex:1;min-width:0;";
        const t = document.createElement("div");
        t.textContent = e.label;
        const p = document.createElement("div");
        p.textContent = e.path;
        p.style.cssText = "font-size:11px;color:var(--muted,#7b7266);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        mid.append(t, p);
        if (e.note) {
          const n = document.createElement("div");
          n.textContent = e.note;
          n.style.cssText = "font-size:11px;color:var(--muted,#7b7266);";
          mid.appendChild(n);
        }
        const size = document.createElement("span");
        size.textContent = cacheHuman(e.bytes);
        size.style.cssText = "flex:none;font-variant-numeric:tabular-nums;";
        row.append(tag, mid, size);
        body.appendChild(row);
      });
      const total = document.createElement("div");
      total.style.cssText = "padding-top:10px;font-weight:600;";
      total.textContent = `\u5408\u8BA1\uFF1A\u5B89\u5168 ${cacheHuman(data.totals.safe)}\uFF0C\u8C28\u614E ${cacheHuman(data.totals.caution)}`;
      body.appendChild(total);
      const msg = document.getElementById("cacheMsg");
      if (msg) msg.textContent = "\u53EA\u6E05\u7406\u53EF\u518D\u751F\u6210\u7684\u7F13\u5B58\uFF1B\u5DE5\u7A0B\u3001\u81EA\u52A8\u4FDD\u5B58\u3001\u5BFC\u51FA\u7684\u56FE\u90FD\u4E0D\u4F1A\u88AB\u5220\u3002";
    }).catch((error) => {
      body.textContent = `\u626B\u63CF\u5931\u8D25\uFF1A${error?.message || error}`;
      const msg = document.getElementById("cacheMsg");
      if (msg) msg.textContent = "\u7F13\u5B58\u72B6\u6001\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u684C\u9762\u4F1A\u8BDD\u6216\u540E\u7AEF\u8FDE\u63A5\u3002";
    });
  }
  function cleanCache(withCaution) {
    const msg = document.getElementById("cacheMsg");
    if (withCaution && !window.confirm("\u8C28\u614E\u6863\u4F1A\u5220\u6389\u6D4F\u89C8\u5668\u7528\u6237\u6570\u636E\uFF08\u9762\u677F\u5BBD\u5EA6\u7B49\u754C\u9762\u504F\u597D\u4F1A\u91CD\u7F6E\uFF09\u3002\u7EE7\u7EED\uFF1F")) return;
    if (msg) msg.textContent = "\u6B63\u5728\u6E05\u7406\u2026";
    api("/api/cache/clean", {
      method: "POST",
      body: JSON.stringify({ dry_run: false, caution: !!withCaution })
    }).then((data) => {
      const freed = cacheHuman(data.freed_bytes || 0);
      const skipped = (data.skipped || []).length;
      toast(`\u5DF2\u6E05\u7406 ${freed}${skipped ? `\uFF0C${skipped} \u9879\u88AB\u8DF3\u8FC7\uFF08\u5360\u7528/\u53D7\u4FDD\u62A4\uFF09` : ""}`, "info", 3200);
      renderCacheBody();
    }).catch((error) => {
      if (msg) msg.textContent = `\u6E05\u7406\u5931\u8D25\uFF1A${error?.message || error}`;
    });
  }
  function checkCacheQuietly() {
    api("/api/cache/status").then((data) => {
      const safe = data.totals && data.totals.safe || 0;
      if (safe > 300 * 1048576) {
        toast(`\u7F13\u5B58\u5DF2\u5360 ${cacheHuman(safe)}\uFF0C\u53EF\u5728 \u5DE5\u5177 \u2192 \u7F13\u5B58\u4F53\u68C0\u4E0E\u6E05\u7406 \u91CC\u91CA\u653E`, "info", 6e3);
      }
    }).catch(() => {
    });
  }
  function openDocSearch() {
    openDoc(state.docSlug || "quickstart");
    setTimeout(() => {
      if (ui.docSearch) {
        ui.docSearch.focus();
        ui.docSearch.select();
      }
    }, 90);
  }
  function syncFnRoleToSelection() {
    const type = state.selection?.type;
    if (type !== "node" && type !== "edge") return;
    const role = type === "edge" ? "edge" : "node";
    if (state.fnRole === role) return;
    state.fnRole = role;
    state.specKind = "";
    $$("#panel .group-subnav [data-fnrole]").forEach((node) => {
      node.classList.toggle("active", node.dataset.fnrole === role);
    });
    if ($(".panel-group.active")?.dataset.group === "fn") renderSpecPane();
  }
  loadUiProfile();
  boot();
  setTimeout(checkCacheQuietly, 6e3);
})();
