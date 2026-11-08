import { state, ui } from "./state.js";
import { el, div, button } from "./ui.js";
import { api } from "./net.js";
import { toast } from "./desktop.js";
import { section } from "./inspector_shell.js";
import { paramRangeText } from "./help_card.js";
import { activeTab, getEdgeSpec, getNodeSpec, selectedEdge, selectedNode } from "./model.js";
const specPanelHooks = {};
function setSpecPanelActions(actions) {
  Object.assign(specPanelHooks, actions);
}
function attachParamHelp(...args) {
  specPanelHooks.attachParamHelp(...args);
}
function confirmModal(...args) {
  return specPanelHooks.confirmModal(...args);
}
function callRenderInspector() {
  specPanelHooks.renderInspector();
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
    if (state.selection.type) callRenderInspector();
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
    if (state.selection.type) callRenderInspector();
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
export {
  applyExtensionResult,
  extensionEditorCode,
  loadExtensionIntoEditor,
  paramTable,
  refreshExtensions,
  renderExtensionPanel,
  renderSpecPane,
  scheduleSpecRender,
  setSpecPanelActions,
  showExtensionResult,
  sourceBlock,
  specBadges,
  specByKind,
  specListForMode,
  specTarget
};
