import { clamp } from "../app.utils.js";
import { ENDPOINTS } from "./endpoints.js";
import { state, ui } from "./state.js";
import { el, div, button } from "./ui.js";
import { toast } from "./desktop.js";
import { jsonRequest } from "./net.js";
import { decodeProbeKey, renderSignalList } from "./signal_list.js";
import { blockBadges, modulePortList } from "./ui_helpers.js";
import { schedulePhaseDraw } from "./phase.js";
import { analysisSignalKey, analysisTFSummary, drawAnalysisSpectrum, drawAnalysisTF, exportAnalysisCsv, exportTFStateSpace, runAnalysisMath, runAnalysisMetrics, runAnalysisPeriod, runAnalysisSpectrum, runAnalysisTF, runAnalysisTransfer, sendTFToPlotKit } from "./analysis.js";
function createViews(deps) {
  const {
    task,
    scheduleChartDraw,
    resizeGraph,
    resizeChart,
    shellKeys: SHELL_KEYS,
    addNetwork,
    renameNetwork,
    deleteNetwork,
    refreshBlocks,
    importBlockFile,
    encapsulateSelection,
    saveCurrentAsBlockCopy,
    openPluginManager,
    openViewDesigner,
    closeInternalNetwork,
    retryDegradedProject,
    describeBlockPorts,
    instantiateBlockFromLibrary,
    openModuleInternal,
    compareBuiltinBlock,
    renameLibraryBlock,
    deleteLibraryBlock
  } = deps;
  const MODULE_DIR_GLYPH = { input: "\u2192", output: "\u2190", inout: "\u2194" };
  function renderAnalysisPanel() {
    const pane = ui.analysisPane;
    if (!pane) return;
    const host = div("blocks-host");
    const head = div("insp-head");
    const title = div("insp-title");
    title.append(el("h2", null, "\u5206\u6790\uFF08\u65C1\u8DEF\uFF09"), el("p", null, "\u53EA\u8BFB\u5F55\u5236\u6570\u636E\uFF1B\u7ED3\u8BBA\u5E26\u6765\u6E90\uFF0C\u4E0D\u5199\u6C42\u89E3\u5668"));
    head.appendChild(title);
    host.appendChild(head);
    const keys = state.probeKeys || [];
    const signal = el("select", "input");
    for (const key2 of keys) {
      const option = el("option", null, decodeProbeKey(key2).label);
      option.value = key2;
      signal.appendChild(option);
    }
    const key = analysisSignalKey();
    if (key) signal.value = key;
    signal.addEventListener("change", () => {
      const chosen = String(signal.value || "");
      if (!chosen) return;
      state.chart.selected.clear();
      state.chart.selected.add(chosen);
      renderSignalList();
      scheduleChartDraw();
    });
    const keyRow = div("field-row");
    keyRow.append(el("label", null, "\u4FE1\u53F7"), signal);
    host.appendChild(keyRow);
    const row = div("blocks-toolbar");
    row.append(
      button("\u6307\u6807", "btn tiny primary", () => void runAnalysisMetrics()),
      button("\u9891\u8C31", "btn tiny", () => void runAnalysisSpectrum()),
      button("\u5468\u671F", "btn tiny", () => void runAnalysisPeriod()),
      button("\u6570\u5B66\u5F62\u5F0F", "btn tiny", () => void runAnalysisMath()),
      button("\u5BFC\u51FA CSV", "btn tiny", () => void exportAnalysisCsv())
    );
    host.appendChild(row);
    const canvas2 = el("canvas", "analysis-chart");
    canvas2.id = "analysisChart";
    host.appendChild(canvas2);
    const transferRow = div("field-row");
    const inputNode = el("input", "input");
    inputNode.id = "analysisInputNode";
    inputNode.placeholder = "\u8F93\u5165\u8282\u70B9\u540D";
    inputNode.value = state.scene?.nodes?.[0]?.name || "";
    const outputNode = el("input", "input");
    outputNode.id = "analysisOutputNode";
    outputNode.placeholder = "\u8F93\u51FA\u8282\u70B9\u540D";
    outputNode.value = state.scene?.nodes?.[state.scene.nodes.length - 1]?.name || "";
    transferRow.append(
      el("label", null, "\u4F20\u9012\u51FD\u6570"),
      inputNode,
      outputNode,
      button("\u63A8\u5BFC", "btn tiny", () => void runAnalysisTransfer()),
      button("\u5BFC\u51FA A/B/C/D", "btn tiny", () => exportTFStateSpace())
    );
    host.appendChild(transferRow);
    const tfSection = div("insp-section");
    tfSection.appendChild(el("h3", null, "\u4F20\u9012\u51FD\u6570\u5206\u6790\uFF08s \u57DF\uFF09"));
    const tfNodes = (state.scene?.nodes || []).filter((node) => node.kind === "transfer_function");
    const tfNode = el("select", "input");
    tfNode.id = "analysisTFNode";
    const tfDirect = el("option", null, "\uFF08\u7528\u8868\u8FBE\u5F0F\uFF09");
    tfDirect.value = "";
    tfNode.appendChild(tfDirect);
    for (const node of tfNodes) {
      const option = el("option", null, node.name);
      option.value = node.name;
      tfNode.appendChild(option);
    }
    const tfExpr = el("input", "input");
    tfExpr.id = "analysisTFExpr";
    tfExpr.placeholder = "\u5982 (2*s+1)/(s^2+3*s+2)";
    tfExpr.value = "1/(s+1)";
    tfNode.addEventListener("change", () => {
      tfExpr.disabled = Boolean(tfNode.value);
    });
    const tfRow = div("field-row");
    tfRow.append(el("label", null, "\u8282\u70B9 / \u8868\u8FBE\u5F0F"), tfNode, tfExpr);
    tfSection.appendChild(tfRow);
    const tfView = el("select", "input");
    tfView.id = "analysisTFView";
    for (const [value, label] of [
      ["bode", "Bode \u56FE"],
      ["step", "\u9636\u8DC3\u54CD\u5E94"],
      ["poles", "\u96F6\u6781\u70B9\u56FE"]
    ]) {
      const option = el("option", null, label);
      option.value = value;
      tfView.appendChild(option);
    }
    tfView.addEventListener("change", () => drawAnalysisTF());
    const tfTools = div("field-row");
    tfTools.append(
      button("\u5206\u6790", "btn tiny primary", () => void runAnalysisTF()),
      button("\u53D1\u9001\u5230 PlotKit", "btn tiny", () => void sendTFToPlotKit()),
      el("label", null, "\u89C6\u56FE"),
      tfView
    );
    tfSection.appendChild(tfTools);
    const tfCanvas = el("canvas", "analysis-chart");
    tfCanvas.id = "analysisTFChart";
    tfCanvas.style.height = "210px";
    tfSection.appendChild(tfCanvas);
    const tfOut = el("pre", "analysis-out");
    tfOut.id = "analysisTFOut";
    tfOut.textContent = state.analysisTF ? analysisTFSummary(state.analysisTF) : "\u9009\u4F20\u9012\u51FD\u6570\u8282\u70B9\u6216\u76F4\u63A5\u5199 s \u8868\u8FBE\u5F0F\uFF0C\u70B9\u300C\u5206\u6790\u300D\u5F97\u5230 Bode / \u9636\u8DC3 / \u96F6\u6781\u70B9\u3002";
    tfSection.appendChild(tfOut);
    host.appendChild(tfSection);
    const out = el("pre", "analysis-out");
    out.id = "analysisOut";
    out.textContent = state.analysisLast || "\u9009\u4FE1\u53F7\u540E\u8FD0\u884C\u6307\u6807/\u9891\u8C31/\u5468\u671F/\u6570\u5B66\u5F62\u5F0F\uFF1B\u4F20\u9012\u51FD\u6570\u586B\u8282\u70B9\u540D\u3002";
    host.appendChild(out);
    const perf = div("insp-section");
    perf.appendChild(el("h3", null, "\u6027\u80FD\u4E0E\u8D85\u65F6\uFF08R13\uFF09"));
    const timeoutInput = el("input", "input");
    timeoutInput.type = "number";
    timeoutInput.id = "analysisStepTimeout";
    timeoutInput.min = "0";
    timeoutInput.step = "0.5";
    timeoutInput.value = String(state.sim?.config?.step_timeout_ms ?? 0);
    const apply = button("\u5E94\u7528\u5355\u6B65\u4E0A\u9650", "btn tiny", async () => {
      const response = await task(() => jsonRequest(ENDPOINTS.config, "PATCH", { step_timeout_ms: Number(timeoutInput.value) || 0 }));
      if (response) toast("\u5355\u6B65\u8D85\u65F6\u5DF2\u66F4\u65B0\uFF080=\u5173\u95ED\uFF09", "ok", 2400);
    });
    const perfRow = div("field-row");
    perfRow.append(el("label", null, "\u5355\u6B65\u4E0A\u9650 ms"), timeoutInput, apply);
    perf.appendChild(perfRow);
    const profileToggle = el("input");
    profileToggle.type = "checkbox";
    profileToggle.id = "analysisProfileEnabled";
    const profileButtons = div("field-row");
    profileButtons.append(
      el("label", null, "\u8BA1\u65F6\u5F00\u5173"),
      profileToggle,
      button("\u5E94\u7528", "btn tiny", async () => {
        const response = await task(() => jsonRequest(ENDPOINTS.profile, "PATCH", {
          enabled: Boolean(profileToggle.checked)
        }));
        if (response) {
          profileToggle.checked = Boolean(response.enabled);
          toast(response.enabled ? "\u6027\u80FD\u8BA1\u65F6\u5DF2\u5F00\u542F" : "\u6027\u80FD\u8BA1\u65F6\u5DF2\u5173\u95ED", "ok", 2200);
        }
      }),
      button("\u6E05\u7A7A", "btn tiny", async () => {
        const response = await task(() => jsonRequest(ENDPOINTS.profile, "PATCH", { reset: true }));
        if (response) toast("\u6027\u80FD\u91C7\u6837\u5DF2\u6E05\u7A7A", "ok", 2e3);
      })
    );
    perf.appendChild(profileButtons);
    const profileOut = el("pre", "analysis-out");
    profileOut.id = "analysisProfile";
    profileOut.textContent = "\u70B9\u51FB\u5237\u65B0\u8BFB\u53D6 /api/profile\uFF08\u9ED8\u8BA4\u5173\u95ED\uFF0C\u5F00\u9500\u53EF\u5FFD\u7565\uFF09";
    perf.appendChild(
      button("\u5237\u65B0\u6027\u80FD", "btn tiny", async () => {
        const response = await task(() => jsonRequest(ENDPOINTS.profileTop(20), "GET"), { dirty: false });
        if (!response) return;
        profileToggle.checked = Boolean(response.enabled);
        const rows = (response.entries || []).map(
          (item) => `${item.name}	${item.count} \u6B21	\u603B ${item.total_ms} ms	\u5747 ${item.mean_ms} ms	\u5CF0 ${item.max_ms} ms`
        );
        profileOut.textContent = [
          `\u8BA1\u65F6\uFF1A${response.enabled ? "\u5F00" : "\u5173"}  \u6837\u672C ${response.samples}/${response.capacity}`,
          ...rows.length ? rows : ["\uFF08\u6682\u65E0\u91C7\u6837\uFF0C\u5F00\u542F\u8BA1\u65F6\u540E\u8FD0\u884C\u4EFF\u771F\uFF09"]
        ].join("\n");
      })
    );
    perf.appendChild(profileOut);
    host.appendChild(perf);
    pane.replaceChildren(host);
    if (state.analysisSpectrum) drawAnalysisSpectrum();
    if (state.analysisTF) drawAnalysisTF();
  }
  function renderBlocksPanel() {
    const pane = ui.blocksPane;
    if (!pane) return;
    const host = div("blocks-host");
    const head = div("insp-head");
    const title = div("insp-title");
    title.append(
      el("h2", null, "\u6A21\u5757\u5E93"),
      el("p", null, state.blocksLibrary ? `\u5E93\u76EE\u5F55\uFF1A${state.blocksLibrary}` : "\u5E93\u76EE\u5F55\uFF1A\u9ED8\u8BA4 library/")
    );
    head.appendChild(title);
    host.appendChild(head);
    const toolbar = div("blocks-toolbar");
    const structuralRow = el("label", "switch-row");
    structuralRow.appendChild(el("span", null, "\u5C01\u88C5\u4E3A\u7ED3\u6784\u6A21\u578B\uFF08\u53EF\u770B\u5185\u90E8\uFF09"));
    const structuralInput = el("input");
    structuralInput.type = "checkbox";
    structuralInput.checked = Boolean(state.blocksStructural);
    structuralInput.addEventListener("change", () => {
      state.blocksStructural = Boolean(structuralInput.checked);
    });
    structuralRow.appendChild(structuralInput);
    toolbar.append(
      button("\u5237\u65B0", "btn tiny", () => void refreshBlocks()),
      button("\u5BFC\u5165 .block", "btn tiny", () => void importBlockFile()),
      button("\u5C01\u88C5\u9009\u4E2D", "btn tiny primary", () => void encapsulateSelection()),
      button("\u53E6\u5B58\u4E3A\u526F\u672C", "btn tiny", () => void saveCurrentAsBlockCopy()),
      button("\u63D2\u4EF6\u7BA1\u7406", "btn tiny", () => void openPluginManager()),
      button("\u89C6\u56FE\u8BBE\u8BA1", "btn tiny", () => void openViewDesigner())
    );
    const closeBtn = button("\u5173\u95ED\u5185\u90E8\u7F51\u7EDC", "btn tiny", () => void closeInternalNetwork());
    closeBtn.disabled = !String(state.currentNetwork?.name || "").startsWith("\u6A21\u5757 ");
    closeBtn.title = closeBtn.disabled ? "\u5F53\u524D\u4E0D\u662F\u6A21\u5757\u5185\u90E8\u4E34\u65F6\u7F51\u7EDC" : "\u5220\u9664\u5F53\u524D\u4E34\u65F6\u7F51\u7EDC\u5E76\u8FD4\u56DE\u4E0A\u4E00\u5C42";
    toolbar.appendChild(closeBtn);
    if (state.sim?.degraded?.read_only) {
      toolbar.appendChild(button("\u8865\u56DE\u540E\u91CD\u8BD5", "btn tiny", () => void retryDegradedProject()));
    }
    host.appendChild(structuralRow);
    host.appendChild(toolbar);
    if (!state.blocks.length) {
      host.appendChild(
        div("help", "\u5E93\u4E2D\u6CA1\u6709\u6A21\u5757\uFF1A\u9009\u4E2D\u753B\u5E03\u8282\u70B9\u540E\u70B9\u300C\u5C01\u88C5\u9009\u4E2D\u300D\uFF0C\u6216\u7528\u300C\u5BFC\u5165 .block\u300D\u8F7D\u5165\u5DF2\u6709\u6A21\u5757\u3002")
      );
      pane.replaceChildren(host);
      return;
    }
    const list = div("block-list");
    for (const spec of state.blocks) {
      const item = div("block-item");
      const info = div("block-info");
      const name = el("strong", null, spec.name || spec.id);
      const badges = div("block-badges");
      for (const badge of blockBadges(spec)) badges.appendChild(el("span", "badge gray", badge));
      info.append(name, badges);
      const ports = el("small", "block-ports", describeBlockPorts(spec));
      info.appendChild(ports);
      item.draggable = true;
      item.addEventListener("dragstart", (event) => {
        if (!event.dataTransfer) return;
        event.dataTransfer.setData("text/netlab-block", spec.id);
        event.dataTransfer.effectAllowed = "copy";
      });
      const actions = div("block-actions");
      actions.appendChild(button("\u5B9E\u4F8B\u5316", "btn tiny primary", () => void instantiateBlockFromLibrary(spec.id)));
      const openBtn = button("\u6253\u5F00\u5185\u90E8", "btn tiny", () => openModuleInternal(spec.id));
      openBtn.title = (spec.model || "behavioral") !== "structural" ? "\u6253\u5F00\u5185\u90E8\u6D6E\u7A97\uFF08\u884C\u4E3A\u6A21\u578B\u53EA\u770B\u5F97\u5230\u7AEF\u53E3\uFF09" : "\u5728\u5185\u90E8\u6D6E\u7A97\u4E2D\u9884\u89C8\u6A21\u5757\u7ED3\u6784";
      actions.appendChild(openBtn);
      if (spec.builtin) {
        const compareBtn = button("\u884C\u4E3A/\u7ED3\u6784\u5BF9\u6BD4", "btn tiny", () => void compareBuiltinBlock(spec));
        compareBtn.title = "\u8FD0\u884C\u884C\u4E3A\u5FEB\u901F\u6A21\u578B\u4E0E structural \u5185\u90E8\u573A\u666F\uFF0C\u5BF9\u6BD4\u540C\u4E00\u8F93\u5165\u7684\u8F93\u51FA";
        actions.appendChild(compareBtn);
      }
      const renameBtn = button("\u6539\u540D", "btn tiny", () => void renameLibraryBlock(spec));
      renameBtn.title = spec.builtin ? "\u5185\u7F6E\u6A21\u5757\u53EA\u8BFB\uFF0C\u8BF7\u5148\u53E6\u5B58\u4E3A\u526F\u672C" : "\u6539\u6A21\u5757\u540D\u5B57\uFF08\u6587\u4EF6\u540D\u540C\u6B65\u6539\uFF0C\u5F15\u7528\u4E0D\u53D8\uFF09";
      renameBtn.disabled = Boolean(spec.builtin);
      actions.appendChild(renameBtn);
      const deleteBtn = button("\u5220\u9664", "btn tiny danger", () => void deleteLibraryBlock(spec));
      deleteBtn.disabled = Boolean(spec.builtin);
      deleteBtn.title = spec.builtin ? "\u5185\u7F6E\u6A21\u5757\u53EA\u8BFB\uFF0C\u4E0D\u80FD\u5220\u9664" : "\u4ECE\u5E93\u91CC\u5220\u6389\u8FD9\u4E2A\u6A21\u5757\u6587\u4EF6";
      actions.appendChild(deleteBtn);
      item.append(info, actions);
      list.appendChild(item);
    }
    host.appendChild(list);
    host.appendChild(
      div("help", "\u6A21\u5757\u6587\u4EF6\u4F4D\u4E8E library/blocks/<\u6A21\u5757\u540D>.block\uFF1A\u4E00\u4E2A\u6A21\u5757\u4E00\u4E2A\u6587\u4EF6\uFF0C\u6587\u4EF6\u540D\u5C31\u662F\u6A21\u5757\u540D\uFF1B\u5E93\u4E2D\u53EA\u4FDD\u7559\u6700\u65B0\u7248\u3002")
    );
    pane.replaceChildren(host);
  }
  function renderModuleSide(block) {
    const side = ui.modulePorts;
    if (side) {
      side.replaceChildren();
      const ports = modulePortList(block);
      side.appendChild(el("h4", null, `\u7AEF\u53E3\uFF08${ports.length}\uFF09`));
      if (!ports.length) side.appendChild(div("help", "\u8FD9\u4E2A\u6A21\u5757\u6CA1\u6709\u7AEF\u53E3\u3002"));
      for (const port of ports) {
        const row = div("port-row");
        row.appendChild(el("span", "port-dir", MODULE_DIR_GLYPH[port.direction] || "\xB7"));
        const name = el("span", "port-name", port.name);
        name.title = `${port.name} \xB7 ${port.direction}${port.net ? ` \xB7 ${port.net}` : ""}`;
        row.appendChild(name);
        row.appendChild(el("span", "badge gray", port.dtype === "electrical" ? "\u7535\u6C14" : "\u4FE1\u53F7"));
        side.appendChild(row);
      }
    }
    const meta = ui.moduleMeta;
    if (meta) {
      meta.replaceChildren();
      const rows = [
        ["\u8282\u70B9", String((block?.nodes || []).length)],
        ["\u8FDE\u7EBF", String((block?.edges || []).length)],
        ["\u7AEF\u53E3", String((block?.ports || []).length)],
        ["\u7248\u672C", `v${Number(block?.version || 1)}`],
        ["\u6A21\u578B", block?.model === "structural" ? "\u7ED3\u6784" : "\u884C\u4E3A"]
      ];
      for (const [key, value] of rows) {
        meta.appendChild(el("span", null, key));
        meta.appendChild(el("b", null, value));
      }
    }
  }
  function syncChromeEdges() {
    if (!ui.main) return;
    if (ui.networks && !ui.main.classList.contains("net-hidden")) {
      const netWidth = Math.round(ui.networks.getBoundingClientRect().width);
      if (netWidth > 0) ui.main.style.setProperty("--net-edge", `${netWidth}px`);
    }
    if (ui.panel && !ui.main.classList.contains("panel-hidden")) {
      const panelWidth = Math.round(ui.panel.getBoundingClientRect().width);
      if (panelWidth > 0) ui.main.style.setProperty("--panel-edge", `${panelWidth}px`);
    }
  }
  function applyNetCollapsed(collapsed) {
    ui.main.classList.toggle("net-hidden", collapsed);
    if (ui.netHanger) {
      ui.netHanger.textContent = collapsed ? "\u203A" : "\u2039";
      ui.netHanger.title = collapsed ? "\u5C55\u5F00\u7F51\u7EDC\u680F" : "\u6536\u8D77\u7F51\u7EDC\u680F";
      ui.netHanger.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
    try {
      localStorage.setItem(SHELL_KEYS.netCollapsed, collapsed ? "1" : "0");
    } catch (error) {
    }
    setTimeout(() => {
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      schedulePhaseDraw();
    }, 60);
  }
  function toggleNetworks() {
    applyNetCollapsed(!ui.main.classList.contains("net-hidden"));
  }
  function initNetworkSidebar() {
    if (!ui.networkList) return;
    let width = 0;
    let collapsed = false;
    try {
      width = Number(localStorage.getItem(SHELL_KEYS.netWidth)) || 0;
      collapsed = localStorage.getItem(SHELL_KEYS.netCollapsed) === "1";
    } catch (error) {
      width = 0;
    }
    if (width >= 140 && width <= 360) {
      ui.main.style.setProperty("--net-w", `${Math.round(width)}px`);
    }
    applyNetCollapsed(collapsed);
    ui.netHanger?.addEventListener("click", toggleNetworks);
    ui.netAdd?.addEventListener("click", () => void addNetwork());
    ui.netRename?.addEventListener("click", () => void renameNetwork());
    ui.netDelete?.addEventListener("click", () => void deleteNetwork());
    const handle = ui.netResize;
    if (!handle) return;
    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    const currentWidth = () => {
      const rect = ui.networks?.getBoundingClientRect();
      if (rect && rect.width > 0) return rect.width;
      const value = parseFloat(getComputedStyle(ui.main).getPropertyValue("--net-w"));
      return Number.isFinite(value) ? value : 172;
    };
    handle.addEventListener("pointerdown", (event) => {
      dragging = true;
      startX = event.clientX;
      startWidth = currentWidth();
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add("net-dragging");
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const next = clamp(Math.round(startWidth + event.clientX - startX), 140, 360);
      ui.main.style.setProperty("--net-w", `${next}px`);
      ui.main.style.setProperty("--net-edge", `${next}px`);
    });
    const finish = (event) => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("net-dragging");
      try {
        localStorage.setItem(SHELL_KEYS.netWidth, String(Math.round(currentWidth())));
      } catch (error) {
      }
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      schedulePhaseDraw();
      if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }
  return {
    renderAnalysisPanel,
    renderBlocksPanel,
    renderModuleSide,
    syncChromeEdges,
    applyNetCollapsed,
    toggleNetworks,
    initNetworkSidebar
  };
}
export {
  createViews
};
