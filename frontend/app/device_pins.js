import { div, el } from "./ui.js";
import { state } from "./state.js";
import { nodeById } from "./model.js";
function modulePorts(node) {
  return Array.isArray(node?.params?.ports) ? node.params.ports : [];
}
function deviceElementSpec(node) {
  const element = String(node?.params?.element || "");
  return (state.catalog?.elements || []).find((spec) => spec.kind === element) || null;
}
function isPinNode(node) {
  return state.scene?.mode === "circuit" && (node?.kind === "device" || node?.kind === "module");
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
export {
  buildDevicePinList,
  deviceElementSpec,
  devicePins,
  isPinNode,
  modulePorts
};
