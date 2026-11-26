import { clamp } from "../app.utils.js";
import { ENDPOINTS } from "./endpoints.js";
import { stage } from "./dom.js";
import { state, ui } from "./state.js";
import { el, div, button } from "./ui.js";
import { toast } from "./desktop.js";
import { api } from "./net.js";
import { kindListFor } from "./fields.js";
import { nodeById } from "./model.js";
import { groupNodeSpecs } from "./menu_model.js";
import { plotkitFrames } from "./ui_helpers.js";
import { section } from "./inspector_shell.js";
import { isPinNode, devicePins } from "./device_pins.js";
import { openDoc } from "./docs.js";
import { addDeviceAt, addNodeAt, createEdge, createWire, createWireBetween, openWireDialog, startWireTool } from "./editor_services.js";
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
let networkModalResolver = null;
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
    api(ENDPOINTS.plotkitActive, {
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
    if (item.danger) strong.style.color = "var(--text-button-danger)";
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
function buildAddMenuItems(placeX, placeY) {
  const list = kindListFor("node");
  const items = [];
  if (state.mode !== "circuit") {
    for (const { group, specs } of groupNodeSpecs(list, state.mode)) {
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
function showHelp() {
  openDoc("shortcuts");
}
function newNetworkModal(defaultMode = state.mode) {
  return new Promise((resolve) => {
    if (networkModalResolver) networkModalResolver(null);
    networkModalResolver = resolve;
    ui.modalCard.replaceChildren();
    let chosen = defaultMode;
    const finish = (value) => {
      ui.modal.classList.add("hidden");
      ui.modalCard.replaceChildren();
      const inner = networkModalResolver;
      networkModalResolver = null;
      if (inner) inner(value);
    };
    const heading = el("h3", null, "\u65B0\u5EFA\u7F51\u7EDC");
    const body = el("p", null, "\u6BCF\u6761\u7F51\u7EDC\u72EC\u7ACB\u4FDD\u5B58\u81EA\u5DF1\u7684\u5DE5\u4F5C\u6A21\u5F0F\uFF0C\u5207\u6362\u6D3B\u52A8\u7F51\u7EDC\u65F6\u4F1A\u81EA\u52A8\u8F7D\u5165\u3002");
    const nameField = div("field");
    nameField.appendChild(el("span", null, "\u7F51\u7EDC\u540D\u79F0\uFF08\u53EF\u7559\u7A7A\u81EA\u52A8\u547D\u540D\uFF0C\u6700\u957F 60 \u5B57\uFF09"));
    const nameInput = el("input", "input");
    nameInput.type = "text";
    nameInput.maxLength = 60;
    nameInput.placeholder = `\u7F51\u7EDC ${(state.networks?.length || 0) + 1}`;
    nameField.appendChild(nameInput);
    const modeSection = section("\u5DE5\u4F5C\u6A21\u5F0F", "\u53EA\u5728\u65B0\u5EFA\u65F6\u5E94\u7528\uFF0C\u4E4B\u540E\u968F\u8BE5\u7F51\u7EDC\u72EC\u7ACB\u4FDD\u5B58");
    const segmented = div("segmented");
    const modes = state.catalog?.modes || [
      { value: "signal", label: "\u4FE1\u53F7\u6D41" },
      { value: "circuit", label: "\u7535\u8DEF" },
      { value: "vector", label: "\u77E2\u91CF\u573A" }
    ];
    const modeButtons = [];
    for (const item of modes) {
      const btn = button(item.label, "", () => {
        chosen = item.value;
        for (const other of modeButtons) other.classList.toggle("active", other === btn);
      });
      btn.dataset.mode = item.value;
      btn.classList.toggle("active", item.value === chosen);
      btn.title = item.description || "";
      modeButtons.push(btn);
      segmented.appendChild(btn);
    }
    modeSection.appendChild(segmented);
    const actions = div("modal-actions");
    const cancel = button("\u53D6\u6D88", "btn", () => finish(null));
    const okay = button(
      "\u521B\u5EFA\u7F51\u7EDC",
      "btn primary",
      () => finish({ name: nameInput.value.trim(), mode: chosen })
    );
    actions.append(cancel, okay);
    ui.modalCard.append(heading, body, nameField, modeSection, actions);
    ui.modal.classList.remove("hidden");
    setTimeout(() => nameInput.focus(), 30);
    nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        okay.click();
      }
    });
    ui.modal.onclick = (event) => {
      if (event.target === ui.modal) finish(null);
    };
  });
}
export {
  ELEMENT_GROUP_ORDER,
  buildAddMenuItems,
  centerPlacement,
  closePopups,
  networkModalResolver,
  newNetworkModal,
  notifyPlotkit,
  openAddMenu,
  openGenericMenu,
  openLinkMenu,
  positionPopup,
  showHelp
};
