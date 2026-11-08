import { div, el, button } from "./ui.js";
import { state, ui } from "./state.js";
import { clamp } from "../app.utils.js";
import { toast } from "./desktop.js";
let switchTabFn = null;
function setSwitchTab(fn) {
  switchTabFn = fn;
}
function paramRangeText(param) {
  const parts = [];
  if (param.min !== void 0 && param.min !== null) parts.push(`\u2265 ${param.min}`);
  if (param.max !== void 0 && param.max !== null) parts.push(`\u2264 ${param.max}`);
  if (param.positive) parts.push("> 0");
  if (param.step !== void 0 && param.step !== null) parts.push(`\u6B65\u957F ${param.step}`);
  return parts.join(" \xB7 ");
}
function hideHelpCard() {
  if (ui.qcard) ui.qcard.hidden = true;
}
function showHelpCard(anchor, info) {
  if (!ui.qcard) return;
  ui.qcard.replaceChildren();
  const head = div("qcard-head");
  head.appendChild(el("b", null, info.title || "\u53C2\u6570\u8BF4\u660E"));
  const close = button("\u2715", "qcard-close", hideHelpCard);
  head.appendChild(close);
  ui.qcard.appendChild(head);
  const dl = el("dl");
  const sections = [
    ["\u8BF4\u660E", info.description || "\u8BE5\u53C2\u6570\u6CA1\u6709\u989D\u5916\u8BF4\u660E\u3002"],
    ["\u53D6\u503C", info.range || "\u2014"],
    ["\u5355\u4F4D\u4E0E\u9ED8\u8BA4", `${info.unit || "\u65E0\u91CF\u7EB2"} \xB7 \u9ED8\u8BA4 ${info.def === void 0 || info.def === null || info.def === "" ? "\u2014" : info.def}`],
    ["\u516C\u5F0F / \u5B9E\u73B0", info.formula || "\u2014"]
  ];
  for (const [label, value] of sections) {
    dl.appendChild(el("dt", null, label));
    dl.appendChild(el("dd", null, value));
  }
  ui.qcard.appendChild(dl);
  if (info.source) {
    const actions = div("qcard-actions");
    const jump = button("\u67E5\u770B\u5B9E\u73B0\u9875 \u2192", "btn tiny", () => {
      hideHelpCard();
      switchTabFn?.(info.role === "edge" ? "edge-fn" : "node-fn");
      toast(info.source, "info", 5200);
    });
    actions.appendChild(jump);
    ui.qcard.appendChild(actions);
  }
  ui.qcard.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const width = 320;
  const left = clamp(rect.right + 10, 12, window.innerWidth - width - 12);
  const top = clamp(rect.top - 8, 56, window.innerHeight - 240);
  ui.qcard.style.left = `${left}px`;
  ui.qcard.style.top = `${top}px`;
}
function typeLabelHelp(label, param) {
  if (!label || !param) return;
  const ask = button("?", "qbtn inline", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showHelpCard(ask, {
      title: `${param.label || param.key}\uFF08${param.key}\uFF09`,
      description: param.help,
      range: paramRangeText(param),
      unit: param.unit,
      def: param.default,
      role: state.selection?.type === "edge" ? "edge" : "node"
    });
  });
  ask.title = "\u53C2\u6570\u8BF4\u660E\uFF1A\u8BF4\u660E / \u53D6\u503C / \u5355\u4F4D\u4E0E\u9ED8\u8BA4";
  label.appendChild(ask);
}
export {
  hideHelpCard,
  paramRangeText,
  setSwitchTab,
  showHelpCard,
  typeLabelHelp
};
