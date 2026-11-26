import { ENDPOINTS } from "./endpoints.js";
import { $ } from "./dom.js";
import { pointerPosition } from "./canvas_geometry.js";
import { drawChart } from "./chart_draw.js";
import { state, ui } from "./state.js";
import { switchMode, openExport } from "./scene_actions.js";
import { nearestFrame } from "./analysis_replay.js";
import { decodeProbeKey } from "./signal_list.js";
import { toast } from "./desktop.js";
import { jsonRequest } from "./net.js";
import { activeTab, modeLabel, nodeById } from "./model.js";
import { requestDraw } from "./canvas_render.js";
import { drawInstruments } from "./instruments.js";
import { selectAll, copySelection, pasteClipboard, undo, redo } from "./commands.js";
import { MODULE_DIR_LABEL, PORT_DIRECTION_CHOICES } from "./editor_consts.js";
import { switchTab } from "./editor_runtime.js";
import { addWireWaypoint, alignSelection, autoLayout, batchResizeSelection, clearWireWaypoints, createWireBetween, deleteEdge, deleteNode, deleteSelection, distributeSelection, renderInspector, selectEntity, selectWireNetwork, toggleEdgeDelay, control, refreshState, colorForKey, fitView, hitTest, task, buildAddMenuItems, openGenericMenu } from "./editor_services.js";
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
    await jsonRequest(ENDPOINTS.node(nodeId), "PATCH", {
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
        hint: "\u76F8\u8FDE\u7684\u5BFC\u7EBF\u6574\u6BB5\u4E00\u8D77\u9009\u4E2D",
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
  const modeChoices = state.catalog?.modes || [
    { value: "signal", label: "\u4FE1\u53F7\u6D41" },
    { value: "circuit", label: "\u7535\u8DEF" },
    { value: "vector", label: "\u77E2\u91CF\u573A" }
  ];
  items.push({
    label: `\u5207\u6362\u672C\u7F51\u7EDC\u6A21\u5F0F\uFF08\u5F53\u524D\uFF1A${modeLabel(state.mode)}\uFF09`,
    hint: "\u53EA\u5F71\u54CD\u5F53\u524D\u7F51\u7EDC",
    children: modeChoices.map((entry) => ({
      label: entry.value === state.mode ? `${entry.label}\uFF08\u5F53\u524D\uFF09` : entry.label,
      hint: entry.value === state.mode ? "\u5DF2\u662F\u5F53\u524D\u6A21\u5F0F" : "\u4F1A\u91CD\u5EFA\u672C\u7F51\u7EDC\u7684\u7A7A\u767D\u573A\u666F",
      action: entry.value === state.mode ? null : () => void switchMode(entry.value)
    }))
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
  if (state.mode === "circuit") {
    items.push({ sep: true });
    items.push({ label: "\u5BFC\u51FA\u2026", action: () => void openExport("schematic") });
  }
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
    await jsonRequest(ENDPOINTS.positions, "POST", { positions: items });
  } catch (error) {
    toast(`\u4FDD\u5B58\u5750\u6807\u5931\u8D25\uFF1A${error.message}`, "error", 6e3);
    await refreshState(true);
  }
}
async function patchNodeGeometry(nodeId, payload) {
  const response = await task(
    () => jsonRequest(ENDPOINTS.node(nodeId), "PATCH", payload)
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
    () => jsonRequest(ENDPOINTS.node(nodeId), "PATCH", {
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
    () => jsonRequest(ENDPOINTS.edge(edgeId), "PATCH", payload)
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
    if (tab === "chart") drawChart({ colorForKey, decodeProbeKey, nearestFrame, state: { chart: state.chart, chartSize: state.chartSize, frames: state.frames, replay: state.replay } });
    else if (tab === "inst") drawInstruments();
  }, 70);
}
export {
  alignmentMenuItems,
  cancelWireTool,
  completeWireTool,
  convertNodeToGround,
  deleteDeviceWires,
  displayMenuItems,
  flushPositions,
  onContextMenu,
  patchEdgeGeometry,
  patchNodeGeometry,
  pinWires,
  queuePositionSave,
  scheduleChartDraw,
  setNetPort,
  startWireTool,
  wireToolEndpointAt
};
