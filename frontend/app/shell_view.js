import { state, ui } from "./state.js";
import { el, div } from "./ui.js";
let deps;
function initShellView(d) {
  deps = d;
}
function updateInfoBar() {
  if (!ui.infoBar) return;
  const modeLabel = { signal: "\u4FE1\u53F7\u6D41", circuit: "\u7535\u8DEF", vector: "\u77E2\u91CF" }[state.mode] || state.mode || "\u2014";
  const network = state.currentNetwork?.name || "\u7F51\u7EDC 1";
  const total = state.networks?.length || 1;
  const sim = state.sim || {};
  deps.setInfo("project", `${state.project.name || "\u672A\u547D\u540D\u5DE5\u7A0B"}${state.project.dirty ? " *" : ""}`);
  deps.setInfo("network", total > 1 ? `${network} (${total})` : network);
  deps.setInfo("mode", modeLabel);
  const nodes = state.scene?.nodes?.length || 0;
  const edges = state.scene?.edges?.length || 0;
  deps.setInfo("counts", `\u8282\u70B9 ${nodes} \xB7 \u8FDE\u7EBF ${edges}`);
  const dt = Number(sim.config?.dt ?? sim.dt ?? state.scene?.sim?.dt ?? 0);
  const dtMs = dt * 1e3;
  const dtText = dt >= 1 ? `${dt.toFixed(dt % 1 ? 2 : 0)} s` : `${dtMs >= 10 ? dtMs.toFixed(0) : dtMs >= 1 ? dtMs.toFixed(1) : dtMs.toFixed(2)} ms`;
  deps.setInfo("dt", `dt ${dtText}`);
  deps.setInfo("time", `t ${Number(sim.time || 0).toFixed(3)} s`);
  deps.setInfo("steps", `step ${Number(sim.steps || 0)}`);
  const alerts = Number(sim.alerts ?? sim.warnings ?? 0) || 0;
  const alertNode = ui.infoBar.querySelector('[data-info="alerts"]');
  if (alertNode) {
    alertNode.textContent = `\u544A\u8B66 ${alerts}`;
    alertNode.classList.toggle("has-alert", alerts > 0);
  }
  const run = ui.infoBar.querySelector('[data-info="run"]');
  if (run) {
    run.textContent = sim.running ? "\u8FD0\u884C\u4E2D" : "\u505C\u6B62";
    run.classList.toggle("stopped", !sim.running);
  }
}
function renderNetworkList() {
  if (!ui.networkList) return;
  ui.networkList.replaceChildren();
  for (const network of state.networks || []) {
    const item = el("button", "network-item");
    item.type = "button";
    item.setAttribute("role", "option");
    item.dataset.networkId = network.id;
    item.classList.toggle("current", Boolean(network.current));
    item.setAttribute("aria-selected", network.current ? "true" : "false");
    item.title = `${network.name} \xB7 ${network.mode} \xB7 ${network.nodes} \u8282\u70B9 / ${network.edges} \u8FDE\u63A5`;
    const dot = div("dot");
    const label = el("span", null, network.name);
    const meta = el("span", "meta", network.nodes);
    item.append(dot, label, meta);
    item.addEventListener("click", () => void deps.switchNetwork(network.id));
    item.addEventListener("dblclick", () => void deps.renameNetwork(network.id));
    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      deps.openNetworkMenu(network, event.clientX, event.clientY);
    });
    ui.networkList.appendChild(item);
  }
}
export {
  initShellView,
  renderNetworkList,
  updateInfoBar
};
