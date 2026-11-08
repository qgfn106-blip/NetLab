import { jsonRequest } from "./net.js";
import { button, div, el } from "./ui.js";
import { $$ } from "./dom.js";
import { clamp, fmt } from "../app.utils.js";
import { state, ui } from "./state.js";
import { toast, showBanner } from "./desktop.js";
import { buildHeader, section } from "./inspector_shell.js";
import { buildDevicePinList, deviceElementSpec, modulePorts } from "./device_pins.js";
import { buildKindSelect, formatAny, numberedField } from "./fields.js";
import { buildParamFields, collectData, collectParamValues, dataRow, markDirty } from "./param_fields.js";
import { edgeDisplayData, getEdgeSpec, getNodeSpec, nodeById, nodeDisplayData, selectedEdge, selectedNode, specDefaults } from "./model.js";
const hooks = {};
function setInspectorActions(actions) {
  Object.assign(hooks, actions);
}
function deleteNode(...args) {
  hooks.deleteNode(...args);
}
function patchNodeGeometry(...args) {
  hooks.patchNodeGeometry(...args);
}
function nodeDiameterHook(...args) {
  return hooks.nodeDiameter(...args);
}
function deleteEdge(...args) {
  hooks.deleteEdge(...args);
}
function patchEdgeGeometry(...args) {
  hooks.patchEdgeGeometry(...args);
}
function syncUI() {
  hooks.syncUI();
}
function updateScenePanelValues() {
  hooks.updateScenePanelValues();
}
function renderInspector() {
  hooks.renderInspector();
}
function updateSignalKeyCache(...args) {
  hooks.updateSignalKeyCache(...args);
}
function refreshState(...args) {
  hooks.refreshState(...args);
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
  sizeInput.value = String(Math.round(isDevice ? Number(node.size?.w) || 120 : nodeDiameterHook(node)));
  sizeInput.dataset.role = "node-size";
  sizeInput.addEventListener("change", () => {
    const value = clamp(Math.round(Number(sizeInput.value) || (isDevice ? Number(node.size?.w) || 120 : nodeDiameterHook(node))), 24, 200);
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
export {
  applyInspector,
  renderEdgeInspector,
  renderNodeInspector,
  renderWireInspector,
  setInspectorActions,
  updateInspectorLive
};
