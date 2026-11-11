import { state, ui } from "./state.js";
import { el, div, button } from "./ui.js";
import { api, jsonRequest } from "./net.js";
import { desktopBridge, callBridge, isDesktop, showBanner, toast } from "./desktop.js";
import { baseName } from "../app.utils.js";
import { activeTab } from "./model.js";
import { normalizeCardFields } from "./card_fields.js";
const projectActions = {};
function setProjectActions(actions) {
  Object.assign(projectActions, actions);
}
function projectConfirmModal(...a) {
  return projectActions.confirmModal(...a);
}
function applySnapshot(...a) {
  return projectActions.applySnapshot(...a);
}
function syncProjectContext(...a) {
  return projectActions.syncProjectContext(...a);
}
function applyProjectUi(...a) {
  return projectActions.applyProjectUi(...a);
}
function renderScenePanel(...a) {
  return projectActions.renderScenePanel(...a);
}
function projectRenderInspector(...a) {
  return projectActions.renderInspector(...a);
}
function renderSignalList(...a) {
  return projectActions.renderSignalList(...a);
}
function fetchNetworks(...a) {
  return projectActions.fetchNetworks(...a);
}
function fitView(...a) {
  return projectActions.fitView(...a);
}
function chooseModeModal(...a) {
  return projectActions.chooseModeModal(...a);
}
function projectTask(run, options) {
  return projectActions.task(run, options);
}
function showHelp(...a) {
  return projectActions.showHelp(...a);
}
let projectFileInput = null;
function setProjectFileInput(input) {
  projectFileInput = input;
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
        cardDetail: state.ui.cardDetail !== false,
        cardValue: state.ui.cardValue !== false,
        cardFields: normalizeCardFields(state.ui.cardFields),
        symbolScale: Number(state.ui.symbolScale) || 1.2,
        glyphColor: state.ui.glyphColor || "#1f5f5b"
      }
    })
  });
  return response && response.project ? response.project : null;
}
function projectDownloadText(text, filename) {
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
    projectDownloadText(text, safeName.endsWith(".netlab") ? safeName : `${safeName}.netlab`);
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
  void syncProjectContext();
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
    trust = await projectConfirmModal("\u5DE5\u7A0B\u5305\u542B Python \u6269\u5C55", body, "\u4FE1\u4EFB\u5E76\u8F7D\u5165", true);
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
  applyProjectUi(response.ui);
  state.project.name = String(project.name || state.project.name || "\u672A\u547D\u540D\u5DE5\u7A0B").slice(0, 120);
  state.project.path = path || "";
  void syncProjectContext();
  if (path) rememberRecent(path, state.project.name);
  projectSaved();
  renderScenePanel();
  projectRenderInspector();
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
  const confirmed = await projectConfirmModal(
    "\u65B0\u5EFA\u5DE5\u7A0B\uFF1F",
    `\u5C06\u521B\u5EFA\u7A7A\u767D\u300C${labels[mode]}\u300D\u573A\u666F\uFF1B\u5F53\u524D\u573A\u666F\u4F1A\u88AB\u66FF\u6362\uFF0C\u672A\u4FDD\u5B58\u7684\u4FEE\u6539\u5C06\u4E22\u5931\u3002`,
    "\u65B0\u5EFA",
    true
  );
  if (!confirmed) return;
  const response = await projectTask(
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
  void syncProjectContext();
  projectSaved();
  renderScenePanel();
  projectRenderInspector();
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
  const confirmed = await projectConfirmModal(
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
  const confirmed = await projectConfirmModal(
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
export {
  AUTOSAVE_ENABLED_KEY,
  autosaveProject,
  buildProjectPayload,
  importProjectText,
  initProject,
  loadRecent,
  markProjectDirty,
  maybeOfferRecovery,
  newProject,
  openProject,
  openProjectPath,
  projectDownloadText,
  projectSaved,
  recoverAutosave,
  rememberRecent,
  saveProject,
  setProjectActions,
  setProjectFileInput,
  updateProjectPanel
};
