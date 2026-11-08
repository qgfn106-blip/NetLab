import { $ } from "./dom.js";
import { clone } from "./ui.js";
import { state } from "./state.js";
function activeTab() {
  const group = $(".panel-group.active")?.dataset.group || "inspect";
  if (group === "fn") return state.fnRole === "edge" ? "edge-fn" : "node-fn";
  if (group === "analysis" || group === "modules" || group === "workbench") {
    const sub = $(".panel-group.active .group-subnav [data-sub].active");
    if (sub) return sub.dataset.sub;
    return group === "modules" ? "blocks" : group === "workbench" ? "wb-analysis" : "chart";
  }
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
function appearanceOf(item) {
  return item.appearance || {};
}
export {
  activeTab,
  appearanceOf,
  displayDataFor,
  edgeById,
  edgeByName,
  edgeDisplayData,
  getEdgeSpec,
  getNodeSpec,
  hasGroundNode,
  modeLabel,
  nodeById,
  nodeByName,
  nodeDisplayData,
  selectedEdge,
  selectedNode,
  specDefaults,
  uniqueNodeName
};
