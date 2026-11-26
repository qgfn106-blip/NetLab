import { ENDPOINTS } from "./endpoints.js";
import { state, ui } from "./state.js";
import { el, div, button } from "./ui.js";
import { normalizeCardFields } from "./card_fields.js";
import { toast } from "./desktop.js";
import { jsonRequest } from "./net.js";
import { appearancePanelTitle, collectAppearanceTargets, renderAppearancePanel } from "./appearance_panel.js";
import { requestDraw } from "./canvas_render.js";
import { openIroColorPopover } from "./ui_helpers.js";
import { pushUndoSnapshot } from "./commands.js";
import { task, renderInspector, refreshBlocks } from "./editor_services.js";
const UI_TOKEN_LEGACY_DEFAULTS = {
  background: "#0b1220",
  surface: "#111a2c",
  panel: "#162238",
  text: "#e6edf7",
  muted: "#8da2bf",
  accent: "#4cc9f0",
  grid: "#22314b",
  edge: "#7c8db5",
  node: "#1c2b45",
  danger: "#ff6b6b",
  success: "#5ee39b"
};
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
    if (!target) continue;
    const isCustom = String(value).toLowerCase() !== (UI_TOKEN_LEGACY_DEFAULTS[key] || "").toLowerCase();
    if (isCustom) root.style.setProperty(target, value);
  }
  if (tokens2?.accent && String(tokens2.accent).toLowerCase() !== UI_TOKEN_LEGACY_DEFAULTS.accent) {
    root.style.setProperty("--accent-strong", tokens2.accent);
  }
  if (mode) {
    document.body.dataset.canvasMode = mode;
    document.body.classList.toggle("simple-canvas", mode === "simple");
  }
}
async function loadUiProfile() {
  try {
    const response = await jsonRequest(ENDPOINTS.ui, "GET");
    if (response?.current) applyUiTokens(response.current.tokens, response.current.mode);
  } catch {
  }
}
async function persistElementAppearanceBatch(items) {
  if (!items.length) return;
  const payload = {
    nodes: items.filter((item) => item.kind === "node").map((item) => ({ id: item.id, appearance: item.appearance ?? {} })),
    edges: items.filter((item) => item.kind === "edge").map((item) => ({ id: item.id, appearance: item.appearance ?? {} }))
  };
  const response = await task(() => jsonRequest(ENDPOINTS.sceneAppearance, "PATCH", payload));
  if (!response) return;
  renderInspector();
}
async function persistElementAppearance(kind, id, appearance) {
  await persistElementAppearanceBatch([{ kind, id, appearance }]);
}
async function openViewDesigner() {
  try {
    const response = await jsonRequest(ENDPOINTS.ui, "GET");
    if (!response) return;
    let current = response.current || response.defaults;
    state.ui.cardDetail = current.node?.show_detail !== false;
    state.ui.cardValue = current.node?.show_value !== false;
    state.ui.cardFields = normalizeCardFields(current.node?.card_fields);
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
    const nodeRows = div("ui-layout-rows");
    const fieldCatalog = Array.isArray(response.card_fields) ? response.card_fields : [];
    let cardFields = normalizeCardFields(current.node?.card_fields);
    const syncCardFields = () => {
      current.node = current.node || {};
      current.node.card_fields = cardFields.slice();
      current.node.show_detail = cardFields.length > 0;
      current.node.show_value = cardFields.includes("value");
      state.ui.cardFields = cardFields.slice();
      state.ui.cardDetail = cardFields.length > 0;
      state.ui.cardValue = cardFields.includes("value");
      requestDraw();
    };
    const renderCardRows = () => {
      nodeRows.replaceChildren();
      const ordered = [...cardFields, ...fieldCatalog.map((entry) => entry.id).filter((id) => !cardFields.includes(id))];
      for (const [index, id] of ordered.entries()) {
        const entry = fieldCatalog.find((item) => item.id === id);
        const row = div("ui-field wide");
        const input = el("input");
        input.type = "checkbox";
        input.checked = cardFields.includes(id);
        input.dataset.cardField = id;
        input.addEventListener("change", () => {
          cardFields = input.checked ? normalizeCardFields([...cardFields, id]) : cardFields.filter((item) => item !== id);
          syncCardFields();
          renderCardRows();
        });
        row.appendChild(input);
        row.appendChild(el("span", null, entry ? entry.label : id));
        for (const [delta, text, dir] of [[-1, "\u2191", "up"], [1, "\u2193", "down"]]) {
          const move = button(text, "btn tiny", () => {
            const from = cardFields.indexOf(id);
            const to = from + delta;
            if (from < 0 || to < 0 || to >= cardFields.length) return;
            const next = cardFields.slice();
            [next[from], next[to]] = [next[to], next[from]];
            cardFields = next;
            syncCardFields();
            renderCardRows();
          });
          move.dataset.cardMove = dir;
          row.appendChild(move);
        }
        nodeRows.appendChild(row);
      }
    };
    renderCardRows();
    const appearanceRows = div("ui-layout-rows");
    const appearanceTargets = collectAppearanceTargets();
    const appearanceTitle = appearancePanelTitle(appearanceTargets);
    renderAppearancePanel(appearanceRows, appearanceTargets, {
      pushUndo: () => {
        void pushUndoSnapshot();
      },
      persist: persistElementAppearance,
      persistElements: (items) => persistElementAppearanceBatch(items)
    });
    ui.modalCard.replaceChildren();
    ui.modalCard.append(
      el("h3", null, "\u89C6\u56FE\u8BBE\u8BA1"),
      div("help", "\u53EA\u8C03\u6574\u58F0\u660E\u5F0F UI \u4EE4\u724C\u4E0E\u5E03\u5C40\uFF0C\u4E0D\u6267\u884C\u4EFB\u610F HTML/CSS/JS\u3002\u989C\u8272\u9009\u62E9\u5668\u53EF\u76F4\u63A5\u53D6\u8272\uFF0C\u4FEE\u6539\u4F1A\u7ACB\u5373\u9884\u89C8\u3002"),
      modeRow,
      tokenGrid,
      el("h4", null, "\u5E03\u5C40"),
      layoutRows,
      el("h4", null, "\u8282\u70B9\u5361\u7247\u5B57\u6BB5"),
      nodeRows,
      el("h4", null, appearanceTitle),
      appearanceRows
    );
    const actions = div("modal-actions");
    actions.appendChild(button("\u5E94\u7528\u5E76\u4FDD\u5B58", "btn primary", async () => {
      const saved = await jsonRequest(ENDPOINTS.ui, "POST", current);
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
    const response = await jsonRequest(ENDPOINTS.plugins, "GET");
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
        await jsonRequest(ENDPOINTS.pluginEnable(plugin.id), "POST", { enabled: plugin.status !== "loaded" });
        await render();
      }));
      actions.appendChild(button("\u91CD\u65B0\u52A0\u8F7D", "btn tiny", async () => {
        await jsonRequest(ENDPOINTS.pluginReload(plugin.id), "POST", {});
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
      await jsonRequest(ENDPOINTS.pluginScan, "POST", {});
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
      ENDPOINTS.blockCompare(spec.id),
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
      ENDPOINTS.blockRename(spec.id),
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
      ENDPOINTS.blockDelete(spec.id),
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
export {
  UI_TOKEN_LEGACY_DEFAULTS,
  applyUiTokens,
  compareBuiltinBlock,
  deleteLibraryBlock,
  findBlockNameClash,
  loadUiProfile,
  openPluginManager,
  openViewDesigner,
  persistElementAppearance,
  persistElementAppearanceBatch,
  renameLibraryBlock
};
