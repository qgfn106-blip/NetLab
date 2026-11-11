import { state } from "./state.js";
import { edgeById, nodeById, selectedEdge, selectedNode } from "./model.js";
import { button, div, el } from "./ui.js";
import { tokens } from "./colors.js";
import { toast } from "./desktop.js";
import { requestDraw } from "./canvas_render.js";
function collectAppearanceTargets() {
  const targets = [];
  const multiNodes = state.multi?.nodes || /* @__PURE__ */ new Set();
  const multiEdges = state.multi?.edges || /* @__PURE__ */ new Set();
  if (multiNodes.size || multiEdges.size) {
    for (const id of multiNodes) {
      const item = nodeById(id);
      if (item) targets.push({ kind: "node", item });
    }
    for (const id of multiEdges) {
      const item = edgeById(id);
      if (item) targets.push({ kind: "edge", item });
    }
  }
  if (!targets.length) {
    const node = selectedNode();
    const edge = node ? null : selectedEdge();
    if (node) targets.push({ kind: "node", item: node });
    else if (edge) targets.push({ kind: "edge", item: edge });
  }
  return targets;
}
function appearancePanelTitle(targets) {
  return targets.length > 1 ? `\u5143\u7D20\u5916\u89C2\uFF08\u5DF2\u9009 ${targets.length} \u9879\uFF09` : "\u5143\u7D20\u5916\u89C2\uFF08\u5F53\u524D\u9009\u4E2D\u9879\uFF09";
}
function channelLum(hex, index) {
  const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
function contrastRatio(a, b) {
  const la = 0.2126 * channelLum(a, 0) + 0.7152 * channelLum(a, 1) + 0.0722 * channelLum(a, 2);
  const lb = 0.2126 * channelLum(b, 0) + 0.7152 * channelLum(b, 1) + 0.0722 * channelLum(b, 2);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function renderAppearancePanel(rows, targets, options) {
  if (!targets.length) {
    rows.appendChild(div("help", "\u5148\u5728\u753B\u5E03\u4E0A\u9009\u4E2D\u4E00\u4E2A\u6216\u591A\u4E2A\u8282\u70B9/\u8FDE\u7EBF\uFF0C\u518D\u56DE\u5230\u8FD9\u91CC\u8BBE\u7F6E\u5143\u7D20\u5916\u89C2\u3002"));
    return;
  }
  options.pushUndo();
  const hasNode = targets.some((target) => target.kind === "node");
  const primary = targets[0].item;
  const app = { ...primary.appearance || {} };
  const setField = (key, value) => {
    for (const target of targets) {
      const next = { ...target.item.appearance || {} };
      if (value === void 0) delete next[key];
      else next[key] = value;
      target.item.appearance = next;
    }
    requestDraw();
  };
  const persist = async () => {
    const weak = targets.some((target) => {
      const current = target.item.appearance || {};
      return Boolean(current.fillColor && current.textColor && contrastRatio(current.fillColor, current.textColor) < 3);
    });
    if (weak) {
      toast("\u586B\u5145\u8272\u4E0E\u6587\u5B57\u8272\u5BF9\u6BD4\u5EA6\u4E0D\u8DB3 3:1\uFF0C\u8BF7\u8C03\u6574\u540E\u518D\u4FDD\u5B58", "warn");
      return;
    }
    const patches = targets.map((target) => {
      const current = target.item.appearance || {};
      return { kind: target.kind, id: target.item.id, appearance: Object.keys(current).length ? current : null };
    });
    if (options.persistElements) {
      await options.persistElements(patches);
      return;
    }
    for (const patch of patches) {
      await options.persist(patch.kind, patch.id, patch.appearance);
    }
  };
  const addColor = (key, labelText, fallback) => {
    const field = div("ui-field wide");
    field.appendChild(el("span", null, labelText));
    const input = el("input");
    input.type = "color";
    input.value = String(app[key] || fallback);
    input.addEventListener("input", () => {
      setField(key, input.value);
    });
    input.addEventListener("change", () => {
      void persist();
    });
    field.appendChild(input);
    rows.appendChild(field);
  };
  addColor("strokeColor", "\u7EBF\u6761/\u63CF\u8FB9", app.color || tokens().edgeDefault);
  if (hasNode) addColor("fillColor", "\u586B\u5145\u8272", "#faf8f2");
  addColor("textColor", "\u6587\u5B57\u8272", "#11100e");
  if (hasNode) {
    addColor("portColor", "\u7AEF\u53E3\u8272", "#1f5f5b");
    addColor("tickColor", "\u523B\u5EA6/\u9009\u4E2D\u8272", "#a8541f");
  }
  const styleField = div("ui-field wide");
  styleField.appendChild(el("span", null, "\u7EBF\u578B"));
  const styleInput = el("select");
  for (const style of ["solid", "dashed", "dotted"]) {
    const option = el("option", null, style);
    option.value = style;
    styleInput.appendChild(option);
  }
  styleInput.value = app.lineStyle || "solid";
  styleInput.addEventListener("change", () => {
    setField("lineStyle", styleInput.value);
    void persist();
  });
  styleField.appendChild(styleInput);
  rows.appendChild(styleField);
  const addRange = (key, labelText, min, max, step, fallback) => {
    const field = div("ui-field wide");
    field.appendChild(el("span", null, labelText));
    const input = el("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const currentValue = app[key];
    input.value = String(currentValue !== void 0 ? currentValue : fallback);
    input.addEventListener("input", () => {
      setField(key, Number(input.value));
    });
    input.addEventListener("change", () => {
      void persist();
    });
    field.appendChild(input);
    rows.appendChild(field);
  };
  addRange("opacity", "\u900F\u660E\u5EA6", 0.05, 1, 0.05, 1);
  addRange("lineWidth", "\u7EBF\u5BBD", 0.5, 12, 0.1, hasNode ? 1 : 1.15);
  addRange("fontSize", "\u6807\u7B7E\u5B57\u53F7", 6, 48, 0.5, 12);
  const clearRow = div("modal-actions");
  clearRow.appendChild(button("\u6E05\u9664\u9009\u4E2D\u9879\u5916\u89C2\u8986\u76D6", "btn tiny", () => {
    for (const target of targets) target.item.appearance = {};
    requestDraw();
    for (const target of targets) {
      void options.persist(target.kind, target.item.id, null);
    }
    toast("\u5DF2\u6E05\u9664\u9009\u4E2D\u9879\u7684\u5916\u89C2\u8986\u76D6", "ok");
  }));
  rows.appendChild(clearRow);
}
export {
  appearancePanelTitle,
  collectAppearanceTargets,
  renderAppearancePanel
};
