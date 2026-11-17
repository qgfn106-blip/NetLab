import { $, $$ } from "./dom.js";
import { el, div, button } from "./ui.js";
import { jsonRequest } from "./net.js";
import { numberedField } from "./fields.js";
import { requestDraw } from "./canvas_render.js";
function openIroColorPopover(anchor, value, onChange) {
  document.querySelectorAll(".iro-popover").forEach((node) => node.remove());
  if (!window.iro || typeof window.iro.ColorPicker !== "function") {
    anchor.click();
    return;
  }
  const pop = div("iro-popover");
  const rect = anchor.getBoundingClientRect();
  pop.style.position = "fixed";
  pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 260))}px`;
  pop.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 300))}px`;
  pop.style.zIndex = "20000";
  pop.style.padding = "10px";
  pop.style.borderRadius = "10px";
  pop.style.background = "var(--panel-bg)";
  pop.style.boxShadow = "0 12px 36px rgba(0,0,0,.24)";
  pop.style.border = "1px solid var(--line, #ccd4d8)";
  const host = div("iro-host");
  pop.appendChild(host);
  pop.appendChild(button("\u5173\u95ED", "btn tiny", () => pop.remove()));
  document.body.appendChild(pop);
  const picker = new window.iro.ColorPicker(host, { width: 220, color: value || "#000000" });
  picker.on("color:change", (color) => onChange(color.hexString));
  setTimeout(() => {
    const close = (event) => {
      if (pop.contains(event.target) || event.target === anchor) return;
      pop.remove();
      document.removeEventListener("pointerdown", close);
    };
    document.addEventListener("pointerdown", close);
  }, 0);
}
function setGroupSub(group, sub) {
  const host = $(`.panel-group[data-group="${group}"]`);
  if (!host) return;
  const attr = group === "fn" ? "fnrole" : "sub";
  $$(`[data-${attr}]`, host).forEach((node) => {
    node.classList.toggle("active", node.dataset[attr] === sub);
  });
  if (group === "modules" || group === "analysis" || group === "workbench") {
    $$(".tab-pane", host).forEach((pane) => {
      pane.classList.toggle("hidden", pane.id !== `tab-${sub}`);
    });
  }
}
function blockBadges(spec) {
  const badges = [
    spec.mode,
    spec.model || "behavioral",
    `v${spec.version}`,
    `${spec.node_count} \u8282\u70B9`,
    `${(spec.inputs || []).length} \u5165 / ${(spec.outputs || []).length} \u51FA`
  ];
  if (spec.builtin) badges.unshift("\u5185\u7F6E");
  return badges;
}
function numberInput(value, options = {}) {
  const input = el("input");
  input.type = "number";
  if (options.min !== void 0) input.min = String(options.min);
  if (options.max !== void 0) input.max = String(options.max);
  if (options.step !== void 0) input.step = String(options.step);
  input.value = String(value);
  return input;
}
function modulePortList(block) {
  return (block?.ports || []).map((port) => ({
    name: String(port.name || "port"),
    direction: String(port.direction || (port.dtype === "electrical" ? "inout" : "input")),
    dtype: String(port.dtype || ""),
    net: String(port.net || "")
  }));
}
async function captureSceneSnapshot() {
  try {
    return await jsonRequest("/api/scene/export", "GET");
  } catch (error) {
    return null;
  }
}
function fieldFor(labelText, unitText, input) {
  const wrapper = div("field");
  wrapper.appendChild(numberedField(labelText, unitText));
  wrapper.appendChild(input);
  return wrapper;
}
function wbFmtAxis(value) {
  if (!Number.isFinite(value)) return "\u2014";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e4 || abs < 1e-3)) return value.toExponential(1);
  return String(Math.round(value * 1e3) / 1e3);
}
function wbToggleInArray(arr, value, on) {
  const index = arr.indexOf(value);
  if (on && index < 0) arr.push(value);
  else if (!on && index >= 0) arr.splice(index, 1);
}
function setPanelGroup(group) {
  $$(".panel-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.group === group));
  $$(".panel-group").forEach((node) => node.classList.toggle("active", node.dataset.group === group));
}
function previewElementAppearance(item, appearance) {
  item.appearance = { ...appearance };
  requestDraw();
}
function plotkitFrames() {
  return [$("#plotkitFrame"), $("#plotkitInlineHost iframe")].filter(Boolean);
}
function closeMenus() {
  $$(".menu.open").forEach((node) => node.classList.remove("open"));
}
function wbBadge(text, cls) {
  return el("span", cls, text);
}
export {
  blockBadges,
  captureSceneSnapshot,
  closeMenus,
  fieldFor,
  modulePortList,
  numberInput,
  openIroColorPopover,
  plotkitFrames,
  previewElementAppearance,
  setGroupSub,
  setPanelGroup,
  wbBadge,
  wbFmtAxis,
  wbToggleInArray
};
