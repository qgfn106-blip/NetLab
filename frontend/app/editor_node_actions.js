import { clamp } from "../app.utils.js";
import { ENDPOINTS } from "./endpoints.js";
import { applySnapshot } from "./store.js";
import { state, ui } from "./state.js";
import { el, div, button } from "./ui.js";
import { toast } from "./desktop.js";
import { jsonRequest } from "./net.js";
import { numberedField } from "./fields.js";
import { selectedNode, selectedEdge, nodeById, edgeById, getNodeSpec, getEdgeSpec, specDefaults, uniqueNodeName } from "./model.js";
import { requestDraw } from "./canvas_render.js";
import { renderEmptyInspector } from "./inspector_shell.js";
import { isPinNode, devicePins } from "./device_pins.js";
import { renderNodeInspector, renderEdgeInspector, applyInspector } from "./inspector.js";
import { scheduleSpecRender } from "./spec_panel.js";
import { screenToWorld, snapWorld } from "./geometry.js";
import { closeModal, openConfirmModal as confirmModal } from "./dialogs_build.js";
import { clearSelection, multiSelection, pushUndoSnapshot } from "./commands.js";
import { switchTab } from "./editor_runtime.js";
import { syncFnRoleToSelection, refreshState, fitView, syncUI, task } from "./editor_services.js";
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
async function alignSelection(mode) {
  const targets = [...multiSelection().nodes].map((id) => nodeById(id)).filter(Boolean);
  if (targets.length < 2) {
    toast("\u81F3\u5C11\u9009\u4E2D\u4E24\u4E2A\u8282\u70B9/\u5668\u4EF6\u624D\u80FD\u5BF9\u9F50", "info", 2400);
    return;
  }
  await pushUndoSnapshot();
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
    await jsonRequest(ENDPOINTS.positions, "POST", { positions });
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
  await pushUndoSnapshot();
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
    await jsonRequest(ENDPOINTS.positions, "POST", { positions });
    await refreshState(true);
    toast(`\u5DF2\u7B49\u8DDD\u5206\u5E03 ${targets.length} \u4E2A\u8282\u70B9\uFF08${axis === "y" ? "\u7EB5\u5411" : "\u6A2A\u5411"}\uFF09`, "ok", 2200);
  } catch (error) {
    toast(`\u5206\u5E03\u5931\u8D25\uFF1A${error.message}`, "error", 4e3);
  }
}
function selectWireNetwork(edge) {
  const adjacency = /* @__PURE__ */ new Map();
  for (const item of state.scene?.edges || []) {
    if (item.kind !== "wire") continue;
    if (!adjacency.has(item.source)) adjacency.set(item.source, []);
    if (!adjacency.has(item.target)) adjacency.set(item.target, []);
    adjacency.get(item.source).push({ edge: item, other: item.target });
    adjacency.get(item.target).push({ edge: item, other: item.source });
  }
  const endpoints = /* @__PURE__ */ new Set([edge.source, edge.target]);
  const selectedWires = /* @__PURE__ */ new Map();
  if (edge.kind === "wire") selectedWires.set(edge.id, edge);
  const queue = [edge.source, edge.target];
  while (queue.length) {
    const id = queue.shift();
    for (const link of adjacency.get(id) || []) {
      selectedWires.set(link.edge.id, link.edge);
      if (!endpoints.has(link.other)) {
        endpoints.add(link.other);
        queue.push(link.other);
      }
    }
  }
  state.multi.nodes = endpoints;
  state.multi.edges = new Set(selectedWires.keys());
  state.selection = { type: null, id: null };
  requestDraw();
  toast(`\u5DF2\u9009\u4E2D ${selectedWires.size} \u6761\u5BFC\u7EBF / ${endpoints.size} \u4E2A\u7AEF\u70B9`, "info", 2200);
}
async function addWireWaypoint(edge) {
  const source = nodeById(edge.source);
  const target = nodeById(edge.target);
  if (!source || !target) return;
  const x = (source.position.x + target.position.x) / 2;
  const y = (source.position.y + target.position.y) / 2;
  const waypoints = [...edge.waypoints || [], { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }];
  try {
    await jsonRequest(ENDPOINTS.edge(edge.id), "PATCH", {
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
    await jsonRequest(ENDPOINTS.edge(edgeId), "PATCH", {
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
      await jsonRequest(ENDPOINTS.node(node.id), "PATCH", {
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
  const response = await task(() => jsonRequest(ENDPOINTS.nodes, "POST", payload));
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
  const response = await task(() => jsonRequest(ENDPOINTS.nodes, "POST", payload));
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
  const response = await task(() => jsonRequest(ENDPOINTS.edges, "POST", body));
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
    auto_delay: false
  };
  if (state.mode === "circuit" && state.ui?.circuitOrthogonal !== false) body.route = "orthogonal";
  const response = await task(() => jsonRequest(ENDPOINTS.edges, "POST", body));
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
  const response = await task(() => jsonRequest(ENDPOINTS.edge(edgeId), "PATCH", { delay: !edge.delay }));
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
  const response = await task(() => jsonRequest(ENDPOINTS.node(nodeId), "DELETE"));
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
  const response = await task(() => jsonRequest(ENDPOINTS.edge(edgeId), "DELETE"));
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
      () => jsonRequest(ENDPOINTS.edge(edgeId), "DELETE"),
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
      () => jsonRequest(ENDPOINTS.node(nodeId), "DELETE"),
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
  await pushUndoSnapshot();
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
    await jsonRequest(ENDPOINTS.positions, "POST", { positions: items });
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
export {
  addDeviceAt,
  addNodeAt,
  addWireWaypoint,
  alignSelection,
  autoLayout,
  batchResizeSelection,
  clearWireWaypoints,
  createEdge,
  createWire,
  createWireBetween,
  deleteEdge,
  deleteNode,
  deleteSelection,
  distributeSelection,
  openWireDialog,
  renderInspector,
  selectEntity,
  selectWireNetwork,
  toggleEdgeDelay
};
