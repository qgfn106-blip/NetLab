import { $ } from "./dom.js";
import { state } from "./state.js";
import { el, div, button, clone } from "./ui.js";
import { toast } from "./desktop.js";
import { api, jsonRequest } from "./net.js";
import { placeFloatWindow, raiseFloatWindow } from "./float.js";
import { buildParamField } from "./param_fields.js";
import { getNodeSpec, getEdgeSpec, specDefaults } from "./model.js";
import { createParamGroupTable, fallbackParams } from "./param_groups.js";
import { wbToggleInArray, wbBadge } from "./ui_helpers.js";
import { markProjectDirty } from "./project.js";
import { openAnalysis } from "./ac_analysis.js";
import { wbCommitNodeParam, wbCommitEdgeParam, wbCommitSimParam } from "./param_commit.js";
import { createChartRenderer, initWorkbenchChart } from "./analysis_workbench_chart.js";
let deps;
let paramCommitDeps;
function initAnalysisWorkbenchPanel(d) {
  deps = d;
  paramCommitDeps = { state, toast, jsonRequest, wbMarkDirty, applySnapshot: d.applySnapshot };
  initWorkbenchChart({ colorForKey: d.colorForKey, getCompareLayout: () => wbCompareLayout });
}
function getWbCompareStateIds() {
  return wbCompareStateIds;
}
function getWbCacheStatus() {
  return wbCacheStatus;
}
function getWbComparePayload() {
  return wbComparePayload;
}
const WB_INTEGRATIONS = [
  { value: "trapezoidal", label: "\u68AF\u5F62\u6CD5" },
  { value: "backward_euler", label: "\u540E\u5411\u6B27\u62C9" },
  { value: "gear2", label: "Gear2" }
];
const WB_SIM_FIELDS = [
  { key: "dt", label: "\u6B65\u957F dt", type: "float", unit: "s" },
  { key: "fps", label: "\u76EE\u6807 FPS", type: "int" },
  { key: "steps_per_frame", label: "\u6BCF\u5E27\u6B65\u6570", type: "int" },
  { key: "sample_every", label: "\u91C7\u6837\u95F4\u9694", type: "int" },
  { key: "reltol", label: "\u76F8\u5BF9\u5BB9\u5DEE reltol", type: "float" },
  { key: "vntol", label: "\u7535\u538B\u5BB9\u5DEE vntol", type: "float", unit: "V" },
  { key: "abstol", label: "\u7535\u6D41\u5BB9\u5DEE abstol", type: "float", unit: "A" },
  { key: "max_iter", label: "\u6700\u5927\u8FED\u4EE3 max_iter", type: "int" },
  { key: "gmin_steps", label: "gmin \u6B65\u6570", type: "int" },
  { key: "src_steps", label: "\u6E90\u6B65\u6570", type: "int" },
  { key: "residual_tol", label: "\u6B8B\u5DEE\u5BB9\u5DEE", type: "float" }
];
let wbStatesPayload = null;
let wbSelectedId = "";
let wbDirty = false;
let wbFilterText = "";
let wbCacheStatus = null;
let wbCompareStateIds = [];
let wbCompareSignals = [];
let wbCompareLayout = { cols: 0, height: 220 };
let wbComparePayload = null;
let wbCompareRenderer = "simple-chart";
let wbActiveRenderers = [];
function wbMarkDirty() {
  wbDirty = true;
  const badge = $("#wbDirtyBadge");
  if (badge) {
    badge.textContent = "\u672A\u4FDD\u5B58\u5230\u72B6\u6001";
    badge.className = "badge violet";
  }
  markProjectDirty();
}
function renderWorkbenchAnalysis() {
  const pane = $("#tab-wb-analysis");
  if (!pane) return;
  const host = div("blocks-host wb-analysis");
  const head = div("insp-head");
  const title = div("insp-title");
  title.append(
    el("h2", null, "\u5DE5\u4F5C\u53F0 \xB7 \u5206\u6790"),
    el("p", null, "\u591A\u72B6\u6001\u7ED3\u679C\u5BF9\u6BD4\uFF1A\u6BCF\u4E2A\u72B6\u6001\u4E00\u5B50\u56FE\uFF0C\u5171\u4EAB\u540C\u4E00\u4FE1\u53F7\u7EC4\uFF0Cx \u8F74\u5BF9\u9F50\u3002")
  );
  head.appendChild(title);
  host.appendChild(head);
  const toolbar = div("blocks-toolbar");
  toolbar.append(
    button("\u6253\u5F00\u7535\u8DEF\u5206\u6790\u5DE5\u4F5C\u53F0", "btn tiny primary", () => openAnalysis("ac")),
    button("\u9884\u8BA1\u7B97\u9009\u4E2D\u72B6\u6001", "btn tiny", () => void wbPrecomputeSelected()),
    button("\u7EDF\u4E00\u4EFF\u771F\u8BBE\u7F6E", "btn tiny", () => void wbUnifySim()),
    button("\u751F\u6210\u5BF9\u6BD4\u56FE", "btn tiny primary", () => void wbGenerateCompare()),
    button("\u4FE1\u53F7\u7A97 \u6D6E\u51FA/\u505C\u9760", "btn tiny", () => setWbSignalDock(!state.wbSignalDock))
  );
  host.appendChild(toolbar);
  const layoutRow = div("field-row wb-layout-row");
  const colsInput = el("input", "input");
  colsInput.type = "number";
  colsInput.min = "0";
  colsInput.max = "6";
  colsInput.value = String(wbCompareLayout.cols);
  colsInput.title = "\u6BCF\u884C\u5217\u6570\uFF080 = \u81EA\u52A8\uFF09";
  const heightInput = el("input", "input");
  heightInput.type = "number";
  heightInput.min = "120";
  heightInput.max = "600";
  heightInput.step = "20";
  heightInput.value = String(wbCompareLayout.height);
  heightInput.title = "\u5355\u4E2A\u5B50\u56FE\u9AD8\u5EA6\uFF08px\uFF09";
  colsInput.addEventListener("change", () => {
    wbCompareLayout.cols = Math.max(0, Math.min(6, Number(colsInput.value) || 0));
    if (wbComparePayload) renderCompareGrid();
  });
  heightInput.addEventListener("change", () => {
    wbCompareLayout.height = Math.max(120, Math.min(600, Number(heightInput.value) || 220));
    if (wbComparePayload) renderCompareGrid();
  });
  const rendererSelect = el("select", "input");
  rendererSelect.title = "\u5BF9\u6BD4\u5B50\u56FE\u7ED8\u5236\u5668\uFF08\u7B80\u6613 canvas / PlotKit \u5185\u5D4C\uFF09";
  const rendererChoices = [
    ["simple-chart", "\u7B80\u6613 canvas"],
    ["plotkit", "PlotKit \u5185\u5D4C"]
  ];
  for (const [value, label] of rendererChoices) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    rendererSelect.appendChild(option);
  }
  rendererSelect.value = wbCompareRenderer;
  rendererSelect.addEventListener("change", () => {
    wbCompareRenderer = rendererSelect.value === "plotkit" ? "plotkit" : "simple-chart";
    if (wbComparePayload) renderCompareGrid();
  });
  layoutRow.append(
    el("label", null, "\u5217\u6570"),
    colsInput,
    el("label", null, "\u5B50\u56FE\u9AD8\u5EA6(px)"),
    heightInput,
    el("label", null, "\u7ED8\u5236\u5668"),
    rendererSelect
  );
  host.appendChild(layoutRow);
  const inline = el("div", "wb-signal-inline");
  inline.id = "wbSignalInline";
  host.appendChild(inline);
  const grid = el("div", "wb-compare-grid");
  grid.id = "wbCompareGrid";
  host.appendChild(grid);
  const status = div("help wb-compare-status");
  status.id = "wbCompareStatus";
  status.textContent = "\u8BFB\u53D6\u7F13\u5B58\u4E2D\u2026";
  host.appendChild(status);
  pane.replaceChildren(host);
  void refreshWbAnalysis();
}
async function syncProjectContext() {
  const path = String(state.project?.path || "");
  try {
    await api("/api/project/context", {
      method: "POST",
      body: JSON.stringify({ path }),
      timeoutMs: 8e3
    });
  } catch {
  }
}
function wbAvailableProbes() {
  const set = /* @__PURE__ */ new Set();
  const rows = wbCacheStatus?.states || [];
  const pick = rows.filter((row) => wbCompareStateIds.indexOf(String(row.state_id)) >= 0);
  const source = pick.length ? pick : rows;
  for (const row of source) for (const probe of row.probes || []) set.add(String(probe));
  if (!set.size) {
    const keys = state.probeKeys.length ? state.probeKeys : state.sim?.probe_keys || [];
    for (const key of keys) set.add(String(key));
  }
  return Array.from(set);
}
function wbSimInconsistent() {
  const states = wbStatesPayload?.states || [];
  if (states.length < 2) return false;
  const signatures = states.map((item) => JSON.stringify(item.sim || {}));
  return signatures.some((sig) => sig !== signatures[0]);
}
async function refreshWbAnalysis() {
  await syncProjectContext();
  try {
    const sp = await jsonRequest("/api/network/states", "GET");
    if (sp) wbStatesPayload = sp;
  } catch {
  }
  try {
    const cache = await jsonRequest("/api/network/state/cache", "GET");
    if (cache) wbCacheStatus = cache;
  } catch (error) {
    toast(`\u8BFB\u53D6\u7F13\u5B58\u72B6\u6001\u5931\u8D25\uFF1A${error?.message || error}`, "error", 6e3);
  }
  const rows = wbCacheStatus?.states || [];
  const ids = rows.map((row) => String(row.state_id || "")).filter(Boolean);
  wbCompareStateIds = wbCompareStateIds.filter((id) => ids.indexOf(id) >= 0);
  if (wbCompareStateIds.length < 2) wbCompareStateIds = ids.slice(0, 2);
  const probes = wbAvailableProbes();
  wbCompareSignals = wbCompareSignals.filter((sig) => probes.indexOf(sig) >= 0);
  if (!wbCompareSignals.length) wbCompareSignals = probes.slice(0, 2);
  renderWbSignalPanel();
  setWbSignalDock(state.wbSignalDock);
  if (wbCompareStateIds.length >= 2 && wbCompareSignals.length) {
    await wbGenerateCompare();
  } else {
    const status = $("#wbCompareStatus");
    if (status) status.textContent = "\u8BF7\u9009\u62E9\u81F3\u5C11\u4E24\u4E2A\u72B6\u6001\u4E0E\u4E00\u7EC4\u5171\u4EAB\u4FE1\u53F7\uFF0C\u518D\u70B9\u300C\u751F\u6210\u5BF9\u6BD4\u56FE\u300D\u3002";
  }
}
function renderWbSignalPanel() {
  let panel = $("#wbSignalPanel");
  if (!panel) {
    panel = div("wb-signal-panel");
    panel.id = "wbSignalPanel";
  }
  panel.replaceChildren();
  const rows = wbCacheStatus?.states || [];
  const stateSection = div("wb-signal-section");
  stateSection.appendChild(div("wb-signal-title", "\u72B6\u6001\uFF08\u52FE\u9009 \u22652 \u4E2A\u53C2\u4E0E\u5BF9\u6BD4\uFF09"));
  const stateList = div("wb-signal-list");
  if (!rows.length) stateList.appendChild(div("help", "\u5C1A\u65E0\u72B6\u6001\u3002\u8BF7\u5230\u300C\u72B6\u6001\u300D\u9875\u65B0\u5EFA\u3002"));
  for (const row of rows) {
    const id = String(row.state_id || "");
    const label = el("label", "wb-check");
    const box = el("input", "");
    box.type = "checkbox";
    box.checked = wbCompareStateIds.indexOf(id) >= 0;
    box.addEventListener("change", () => wbToggleInArray(wbCompareStateIds, id, box.checked));
    const suffix = row.cached ? `\uFF08${row.frames || 0} \u5E27\uFF09` : "\uFF08\u672A\u9884\u8BA1\u7B97\uFF09";
    label.append(box, el("span", null, `${row.name || id}${suffix}`));
    stateList.appendChild(label);
  }
  stateSection.appendChild(stateList);
  if (wbSimInconsistent()) {
    stateSection.appendChild(
      div("help wb-warn", "\u5404\u72B6\u6001\u4EFF\u771F\u8BBE\u7F6E\u4E0D\u4E00\u81F4\uFF0C\u5BF9\u6BD4\u524D\u5EFA\u8BAE\u70B9\u300C\u7EDF\u4E00\u4EFF\u771F\u8BBE\u7F6E\u300D\u4EE5\u4FDD\u8BC1\u53EF\u6BD4\u3002")
    );
  }
  panel.appendChild(stateSection);
  const probes = wbAvailableProbes();
  const signalSection = div("wb-signal-section");
  signalSection.appendChild(div("wb-signal-title", "\u5171\u4EAB\u4FE1\u53F7\uFF08\u6240\u6709\u5B50\u56FE\u5171\u7528\u540C\u4E00\u7EC4\uFF09"));
  const signalList = div("wb-signal-list");
  if (!probes.length) {
    signalList.appendChild(div("help", "\u5C1A\u65E0\u53EF\u9009\u4FE1\u53F7\uFF1A\u8BF7\u5148\u9884\u8BA1\u7B97\u81F3\u5C11\u4E00\u4E2A\u72B6\u6001\u3002"));
  }
  for (const key of probes) {
    const label = el("label", "wb-check");
    const box = el("input", "");
    box.type = "checkbox";
    box.checked = wbCompareSignals.indexOf(key) >= 0;
    box.addEventListener("change", () => wbToggleInArray(wbCompareSignals, key, box.checked));
    const swatch = el("span", "wb-swatch");
    swatch.style.background = deps.colorForKey(key);
    const nameSpan = el("span", null, deps.decodeProbeKey(key).label);
    nameSpan.title = key;
    label.append(box, swatch, nameSpan);
    signalList.appendChild(label);
  }
  signalSection.appendChild(signalList);
  const applyRow = div("blocks-toolbar");
  applyRow.append(button("\u5E94\u7528\u5E76\u7ED8\u56FE", "btn tiny primary", () => void wbGenerateCompare()));
  signalSection.appendChild(applyRow);
  panel.appendChild(signalSection);
  if (state.wbSignalDock) {
    const inline = $("#wbSignalInline");
    if (inline) inline.appendChild(panel);
  } else {
    const body = $("#wbSignalBody");
    if (body) body.appendChild(panel);
  }
}
function setWbSignalDock(docked) {
  state.wbSignalDock = docked;
  const win = $("#wbSignalWin");
  const panel = $("#wbSignalPanel");
  const inline = $("#wbSignalInline");
  const body = $("#wbSignalBody");
  if (!win || !panel) return;
  if (docked) {
    win.hidden = true;
    if (inline) {
      inline.hidden = false;
      inline.appendChild(panel);
    }
  } else {
    if (inline) inline.hidden = true;
    if (body) body.appendChild(panel);
    if (!state.wbSignalGeo) {
      state.wbSignalGeo = {
        left: Math.max(40, window.innerWidth - 430),
        top: 120,
        width: 360,
        height: 460
      };
    }
    win.hidden = false;
    placeFloatWindow(win, "wbSignalGeo");
    raiseFloatWindow(win);
  }
}
async function wbGenerateCompare() {
  const statusEl = $("#wbCompareStatus");
  if (wbCompareStateIds.length < 2) {
    if (statusEl) statusEl.textContent = "\u5BF9\u6BD4\u5206\u6790\u81F3\u5C11\u9700\u8981\u9009\u62E9\u4E24\u4E2A\u72B6\u6001\u3002";
    return;
  }
  if (!wbCompareSignals.length) {
    if (statusEl) statusEl.textContent = "\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u5171\u4EAB\u4FE1\u53F7\u3002";
    return;
  }
  if (statusEl) statusEl.textContent = "\u8BFB\u53D6\u7F13\u5B58\u4E2D\u2026";
  let payload = null;
  try {
    payload = await api("/api/network/state/compare", {
      method: "POST",
      body: JSON.stringify({ state_ids: wbCompareStateIds, signals: wbCompareSignals }),
      timeoutMs: 12e4
    });
  } catch (error) {
    if (statusEl) statusEl.textContent = `\u5BF9\u6BD4\u8BFB\u53D6\u5931\u8D25\uFF1A${error?.message || error}`;
    return;
  }
  if (!payload) return;
  wbComparePayload = payload;
  renderCompareGrid();
  if (statusEl) {
    const entries = payload.states || [];
    const ok = entries.filter((entry) => entry.ok).length;
    const total = entries.length;
    statusEl.textContent = ok === total ? `\u5DF2\u751F\u6210 ${total} \u4E2A\u5B50\u56FE \xB7 \u5171\u4EAB\u4FE1\u53F7\uFF1A${(payload.signals || []).join("\u3001")}` : `\u90E8\u5206\u72B6\u6001\u65E0\u6709\u6548\u7F13\u5B58\uFF08${ok}/${total} \u53EF\u7ED8\uFF09\xB7 \u8BF7\u5BF9\u7F3A\u5931\u72B6\u6001\u5148\u300C\u9884\u8BA1\u7B97\u9009\u4E2D\u72B6\u6001\u300D\u3002`;
  }
}
function renderCompareGrid() {
  const grid = $("#wbCompareGrid");
  if (!grid) return;
  const payload = wbComparePayload;
  const entries = (payload?.states || []).filter((entry) => entry.ok);
  const signals = payload?.signals && payload.signals.length ? payload.signals : wbCompareSignals.slice();
  for (const renderer of wbActiveRenderers) renderer.destroy();
  wbActiveRenderers = [];
  grid.replaceChildren();
  if (!entries.length) {
    grid.appendChild(div("help", "\u6CA1\u6709\u53EF\u7ED8\u5236\u7684\u7F13\u5B58\u3002\u8BF7\u5148\u5BF9\u9009\u4E2D\u72B6\u6001\u6267\u884C\u300C\u9884\u8BA1\u7B97\u9009\u4E2D\u72B6\u6001\u300D\u3002"));
    return;
  }
  const count = entries.length;
  const cols = wbCompareLayout.cols > 0 ? wbCompareLayout.cols : Math.min(count, Math.ceil(Math.sqrt(count)));
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  let xMin = Infinity;
  let xMax = -Infinity;
  for (const entry of entries) {
    const times = entry.t || [];
    if (times.length) {
      xMin = Math.min(xMin, times[0]);
      xMax = Math.max(xMax, times[times.length - 1]);
    }
  }
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMax <= xMin) {
    xMin = 0;
    xMax = 1;
  }
  for (const entry of entries) {
    const card = div("wb-subplot");
    const titleBar = div("wb-subplot-title");
    titleBar.append(
      el("b", null, entry.name || String(entry.state_id || "")),
      el("span", "wb-subplot-meta", `${(entry.t || []).length} \u70B9`)
    );
    card.appendChild(titleBar);
    const canvasHost = div("wb-subplot-canvas-host");
    card.appendChild(canvasHost);
    grid.appendChild(card);
    const renderer = createChartRenderer(wbCompareRenderer);
    renderer.mount(canvasHost, { height: wbCompareLayout.height, title: entry.name });
    renderer.setSeries({ entry, signals, xMin, xMax, height: wbCompareLayout.height });
    wbActiveRenderers.push(renderer);
  }
}
async function wbPrecomputeSelected() {
  deps.openPrecomputeDialog("states");
}
async function wbUnifySim() {
  const rows = wbCacheStatus?.states || [];
  if (rows.length < 2) {
    toast("\u81F3\u5C11\u9700\u8981\u4E24\u4E2A\u72B6\u6001\u624D\u80FD\u7EDF\u4E00\u4EFF\u771F\u8BBE\u7F6E", "error");
    return;
  }
  const sourceId = wbCompareStateIds[0] || String(rows[0].state_id || "");
  const sourceName = rows.find((row) => String(row.state_id) === String(sourceId))?.name || sourceId;
  if (!window.confirm(
    `\u4EE5\u300C${sourceName}\u300D\u7684\u4EFF\u771F\u8BBE\u7F6E\u7EDF\u4E00\u5168\u90E8\u72B6\u6001\uFF1F
\uFF08\u5404\u72B6\u6001\u7F13\u5B58\u5C06\u5931\u6548\uFF0C\u9700\u8981\u91CD\u65B0\u9884\u8BA1\u7B97\uFF09`
  )) {
    return;
  }
  try {
    await api("/api/network/state", {
      method: "POST",
      body: JSON.stringify({ action: "unify_sim", state_id: String(sourceId) }),
      timeoutMs: 3e4
    });
    markProjectDirty();
    toast("\u5DF2\u7EDF\u4E00\u5404\u72B6\u6001\u4EFF\u771F\u8BBE\u7F6E\uFF0C\u7F13\u5B58\u5DF2\u5931\u6548", "ok", 3600);
    await refreshWbAnalysis();
  } catch (error) {
    toast(error?.message || String(error), "error", 6e3);
  }
}
async function renderWorkbenchState() {
  const pane = $("#tab-wb-state");
  if (!pane) return;
  let payload = null;
  try {
    payload = await jsonRequest("/api/network/states", "GET");
  } catch (error) {
    toast(`\u8BFB\u53D6\u72B6\u6001\u5931\u8D25\uFF1A${error?.message || error}`, "error", 6e3);
  }
  if (payload) {
    wbStatesPayload = payload;
    const ids = (payload.states || []).map((item) => item.id);
    if (!wbSelectedId || ids.indexOf(wbSelectedId) < 0) {
      wbSelectedId = payload.base || ids[0] || "";
    }
  }
  const host = div("wb-host");
  const head = div("insp-head");
  const title = div("insp-title");
  title.append(
    el("h2", null, "\u5DE5\u4F5C\u53F0 \xB7 \u72B6\u6001"),
    el("p", null, "\u53C2\u6570\u8868\u683C + \u591A\u5957\u53C2\u6570\u72B6\u6001\uFF1B\u5207\u6362\u72B6\u6001\u5373\u628A\u8BE5\u72B6\u6001\u53C2\u6570\u5199\u56DE\u5F53\u524D\u7F51\u7EDC\u3002")
  );
  head.appendChild(title);
  const dirtyBadge = wbBadge(
    wbDirty ? "\u672A\u4FDD\u5B58\u5230\u72B6\u6001" : "\u5DF2\u540C\u6B65\u5230\u72B6\u6001",
    wbDirty ? "badge violet" : "badge green"
  );
  dirtyBadge.id = "wbDirtyBadge";
  head.appendChild(dirtyBadge);
  host.appendChild(head);
  const states = wbStatesPayload?.states || [];
  const toolbar = div("blocks-toolbar");
  toolbar.append(
    button("\uFF0B \u65B0\u5EFA\u72B6\u6001", "btn tiny primary", () => void wbCreateNew()),
    button("\u66F4\u65B0\u5230\u6B64\u72B6\u6001", "btn tiny", () => void wbUpdateCurrent()),
    button("\u53E6\u5B58\u4E3A\u65B0\u72B6\u6001", "btn tiny", () => void wbCreateNew())
  );
  host.appendChild(toolbar);
  const listRow = div("wb-state-list");
  if (!states.length) {
    listRow.appendChild(div("help", "\u6682\u65E0\u72B6\u6001\u3002\u70B9\u300C\u65B0\u5EFA\u72B6\u6001\u300D\u6309\u5F53\u524D\u7F51\u7EDC\u53C2\u6570\u5EFA\u7ACB\u7B2C\u4E00\u4E2A\u72B6\u6001\u3002"));
  }
  for (const item of states) {
    const rowEl = div("wb-state-chip" + (item.id === wbSelectedId ? " active" : ""));
    if (item.base) rowEl.appendChild(wbBadge("\u57FA\u51C6", "badge gray"));
    const nameEl = el("button", "wb-state-name", item.name);
    nameEl.type = "button";
    nameEl.title = "\u5207\u6362\u5230\u8BE5\u72B6\u6001\uFF08\u628A\u53C2\u6570\u5199\u56DE\u5F53\u524D\u7F51\u7EDC\uFF09";
    nameEl.addEventListener("click", () => void wbApplyState(item.id));
    rowEl.appendChild(nameEl);
    rowEl.appendChild(button("\u8BBE\u57FA\u51C6", "btn tiny", () => void wbAction("set_base", item.id)));
    rowEl.appendChild(button("\u91CD\u547D\u540D", "btn tiny", () => void wbRename(item.id, item.name)));
    rowEl.appendChild(button("\u590D\u5236", "btn tiny", () => void wbAction("duplicate", item.id)));
    rowEl.appendChild(button("\u5220\u9664", "btn tiny", () => void wbDelete(item.id)));
    listRow.appendChild(rowEl);
  }
  host.appendChild(listRow);
  const filter = el("input", "input");
  filter.type = "search";
  filter.placeholder = "\u68C0\u7D22 \u8282\u70B9\u540D / kind / \u53C2\u6570\u540D\u2026";
  filter.value = wbFilterText;
  const filterRow = div("field-row");
  filterRow.append(el("label", null, "\u68C0\u7D22"), filter);
  host.appendChild(filterRow);
  const { table, addRow, applyFilter: applyGroupFilter } = createParamGroupTable();
  const scene = state.scene;
  for (const node of scene?.nodes || []) {
    const spec = getNodeSpec(node.kind);
    const list = spec && Array.isArray(spec.params) && spec.params.length ? spec.params : fallbackParams(node.params);
    if (!list.length) continue;
    const baseParams = spec ? Object.assign(specDefaults(spec), node.params || {}) : Object.assign({}, node.params || {});
    for (const param of list) {
      const value = param.key in baseParams ? baseParams[param.key] : clone(param.default);
      const control = buildParamField(param, value);
      control.addEventListener("change", () => void wbCommitNodeParam(paramCommitDeps, node.id, control, baseParams));
      addRow(`${node.name} \xB7 ${node.kind}`, node.id, String(param.label || param.key), control);
    }
  }
  for (const edge of scene?.edges || []) {
    const spec = getEdgeSpec(edge.kind);
    const list = spec && Array.isArray(spec.params) && spec.params.length ? spec.params : fallbackParams(edge.params);
    if (!list.length) continue;
    const baseParams = spec ? Object.assign(specDefaults(spec), edge.params || {}) : Object.assign({}, edge.params || {});
    for (const param of list) {
      const value = param.key in baseParams ? baseParams[param.key] : clone(param.default);
      const control = buildParamField(param, value);
      control.addEventListener("change", () => void wbCommitEdgeParam(paramCommitDeps, edge.id, control, baseParams));
      addRow(`${edge.name || edge.id} \xB7 ${edge.kind}`, edge.id, String(param.label || param.key), control);
    }
  }
  const config = state.sim?.config || {};
  for (const field of WB_SIM_FIELDS) {
    const paramSpec = {
      key: field.key,
      type: field.type,
      label: field.label,
      unit: field.unit,
      step: field.step,
      min: field.min
    };
    const value = field.key in config ? config[field.key] : void 0;
    const control = buildParamField(paramSpec, value);
    control.addEventListener("change", () => void wbCommitSimParam(paramCommitDeps, field.key, control));
    addRow("\u4EFF\u771F\u8BBE\u7F6E", "sim", field.label, control);
  }
  const integValue = String(scene?.integration || "trapezoidal");
  const integSpec = {
    key: "integration",
    type: "choice",
    label: "\u79EF\u5206\u65B9\u6CD5",
    choices: ["trapezoidal", "backward_euler", "gear2"]
  };
  const integControl = buildParamField(integSpec, integValue);
  integControl.addEventListener("change", () => void wbCommitSimParam(paramCommitDeps, "integration", integControl));
  addRow("\u4EFF\u771F\u8BBE\u7F6E", "sim", "\u79EF\u5206\u65B9\u6CD5", integControl);
  const applyFilter = () => applyGroupFilter(wbFilterText);
  filter.addEventListener("input", () => {
    wbFilterText = filter.value.trim().toLowerCase();
    applyFilter();
  });
  applyFilter();
  host.appendChild(table);
  pane.replaceChildren(host);
}
async function wbCreateNew() {
  const suggested = `\u72B6\u6001 ${(wbStatesPayload?.states?.length || 0) + 1}`;
  const name = window.prompt("\u65B0\u72B6\u6001\u540D\u79F0\uFF08\u81EA\u52A8\u5FEB\u7167\u5F53\u524D\u7F51\u7EDC\u53C2\u6570\uFF09", suggested);
  if (name === null) return;
  await wbAction("create", void 0, { name });
}
async function wbRename(id, oldName) {
  const name = window.prompt("\u91CD\u547D\u540D\u72B6\u6001", oldName);
  if (name === null) return;
  await wbAction("rename", id, { name });
}
async function wbDelete(id) {
  if (!window.confirm("\u5220\u9664\u8BE5\u72B6\u6001\uFF1F\uFF08\u5176\u9884\u8BA1\u7B97\u7F13\u5B58\u5C06\u5728 W2 \u4E2D\u4E00\u5E76\u5220\u9664\uFF09")) return;
  await wbAction("delete", id);
}
async function wbUpdateCurrent() {
  if (!wbSelectedId) {
    toast("\u8BF7\u5148\u9009\u62E9\u4E00\u4E2A\u72B6\u6001", "error");
    return;
  }
  await wbAction("update", wbSelectedId);
}
async function wbAction(action, stateId, extra) {
  const body = Object.assign({ action }, extra || {});
  if (stateId) body.state_id = stateId;
  try {
    const resp = await jsonRequest("/api/network/state", "POST", body);
    if (!resp) return;
    markProjectDirty();
    await renderWorkbenchState();
  } catch (error) {
    toast(error?.message || String(error), "error", 6e3);
  }
}
async function wbApplyState(id) {
  try {
    const resp = await jsonRequest("/api/network/state", "POST", {
      action: "apply",
      state_id: id
    });
    if (!resp) return;
    deps.applySnapshot(resp);
    wbSelectedId = id;
    wbDirty = false;
    markProjectDirty();
    await renderWorkbenchState();
  } catch (error) {
    toast(error?.message || String(error), "error", 6e3);
  }
}
export {
  getWbCacheStatus,
  getWbComparePayload,
  getWbCompareStateIds,
  initAnalysisWorkbenchPanel,
  refreshWbAnalysis,
  renderCompareGrid,
  renderWorkbenchAnalysis,
  renderWorkbenchState,
  setWbSignalDock,
  syncProjectContext
};
