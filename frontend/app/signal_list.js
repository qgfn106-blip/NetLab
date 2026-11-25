import { fmt } from "../app.utils.js";
import { CHART_KEYS } from "./constants.js";
import { $$ } from "./dom.js";
import { state, ui } from "./state.js";
import { el, div } from "./ui.js";
import { toast } from "./desktop.js";
let deps;
function initSignalList(d) {
  deps = d;
}
function decodeProbeKey(key) {
  const displayKey = state.probeLabels[key] || key;
  if (key.startsWith("n:") || displayKey.startsWith("n:")) {
    const rest = displayKey.startsWith("n:") ? displayKey.slice(2) : displayKey;
    const cut = rest.lastIndexOf(":");
    return {
      group: "\u8282\u70B9",
      label: cut > 0 ? `${rest.slice(0, cut)} \xB7 ${rest.slice(cut + 1)}` : rest,
      target: "\u8282\u70B9"
    };
  }
  if (key.startsWith("e:") || displayKey.startsWith("e:")) {
    const rest = displayKey.startsWith("e:") ? displayKey.slice(2) : displayKey;
    const cut = rest.lastIndexOf(":");
    return {
      group: "\u8FDE\u63A5",
      label: cut > 0 ? `${rest.slice(0, cut)} \xB7 ${rest.slice(cut + 1)}` : rest,
      target: "\u8FDE\u63A5"
    };
  }
  return { group: "\u4FE1\u53F7", label: displayKey };
}
function renderSignalList() {
  if (!ui.signalList) return;
  ui.signalList.replaceChildren();
  if (!state.probeKeys.length) {
    ui.signalList.appendChild(div("help", "\u8FD0\u884C\u4EFF\u771F\u540E\u81EA\u52A8\u5217\u51FA\u53EF\u7ED8\u5236\u4FE1\u53F7\u3002"));
    renderLegend();
    return;
  }
  const filter = state.chart.filter.trim().toLowerCase();
  const keys = state.probeKeys.filter((key) => {
    if (!filter) return true;
    const label = state.probeLabels[key] || "";
    return key.toLowerCase().includes(filter) || label.toLowerCase().includes(filter);
  });
  if (!keys.length) {
    ui.signalList.appendChild(div("help", "\u6CA1\u6709\u5339\u914D\u7684\u4FE1\u53F7\u3002"));
    renderLegend();
    return;
  }
  const groups = /* @__PURE__ */ new Map();
  for (const key of keys) {
    const info = decodeProbeKey(key);
    if (!groups.has(info.group)) groups.set(info.group, []);
    groups.get(info.group).push({ key, info });
  }
  for (const [group, entries] of groups) {
    ui.signalList.appendChild(div("signal-group", group));
    for (const { key, info } of entries) {
      const item = el("label", "signal-item");
      item.dataset.key = key;
      item.title = key;
      const dot = el("span", "legend-dot");
      dot.style.background = deps.colorForKey(key);
      const checkbox = el("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.chart.selected.has(key);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          if (state.chart.selected.size >= CHART_KEYS) {
            checkbox.checked = false;
            toast(`\u6700\u591A\u540C\u65F6\u7ED8\u5236 ${CHART_KEYS} \u6761\u4FE1\u53F7`, "info", 2200);
            return;
          }
          state.chart.selected.add(key);
        } else {
          state.chart.selected.delete(key);
        }
        renderLegend();
        deps.scheduleChartDraw();
      });
      const name = el("span", null, info.label);
      const value = el("em", null, state.values.has(key) ? fmt(state.values.get(key), 3) : "\u2014");
      value.dataset.signalValue = key;
      item.append(dot, checkbox, name, value);
      ui.signalList.appendChild(item);
    }
  }
  updateSignalListValues();
  renderLegend();
}
function updateSignalListValues() {
  for (const node of $$("[data-signal-value]", ui.signalList)) {
    const key = node.dataset.signalValue;
    node.textContent = state.values.has(key) ? fmt(state.values.get(key), 3) : "\u2014";
  }
}
function renderLegend() {
  if (!ui.legend) return;
  ui.legend.replaceChildren();
  const keys = Array.from(state.chart.selected);
  if (!keys.length) {
    ui.legend.appendChild(div("help", "\u52FE\u9009\u4E0A\u65B9\u4FE1\u53F7\u4EE5\u7ED8\u5236\u66F2\u7EBF\u3002"));
    return;
  }
  for (const key of keys) {
    const item = div("legend-item");
    const dot = el("span", "legend-dot");
    dot.style.background = deps.colorForKey(key);
    const name = el("span", "legend-name", decodeProbeKey(key).label);
    name.title = key;
    const value = el("span", "legend-value", state.values.has(key) ? fmt(state.values.get(key), 4) : "\u2014");
    value.dataset.legendValue = key;
    item.append(dot, name, value);
    ui.legend.appendChild(item);
  }
}
function updateLegendValues() {
  for (const node of $$("[data-legend-value]", ui.legend)) {
    const key = node.dataset.legendValue;
    node.textContent = state.values.has(key) ? fmt(state.values.get(key), 4) : "\u2014";
  }
}
export {
  decodeProbeKey,
  initSignalList,
  renderLegend,
  renderSignalList,
  updateLegendValues,
  updateSignalListValues
};
