import { UI_BUILD } from "./constants.js";
import { $ } from "./dom.js";
import { activeTab, selectedNode } from "./model.js";
import { api, plotkitFrameUrl } from "./net.js";
import { state } from "./state.js";
import { toast } from "./desktop.js";
let plotkitDataActions = {
  refreshState: async (_quiet = true) => {
  },
  renderAnalysisPanel: () => {
  },
  updateSignalKeyCache: () => {
  }
};
function setPlotkitDataActions(actions) {
  plotkitDataActions = actions;
}
let pkChannelCache = [];
function pkKeyShort(key) {
  const parts = String(key).split(":");
  if (parts.length >= 3 && parts[0] === "n") return parts.slice(1).join(".");
  return String(key);
}
function pkCheckedKeys() {
  return Array.from(document.querySelectorAll("#pkChannelList input[type=checkbox]")).filter((el2) => el2.checked).map((el2) => el2.value);
}
function renderPkChannels(selected) {
  const box = $("#pkChannelList");
  if (!box) return;
  const want = new Set(selected && selected.length ? selected : pkCheckedKeys());
  box.textContent = "";
  if (!pkChannelCache.length) {
    const empty = document.createElement("span");
    empty.className = "pk-empty";
    empty.textContent = "\u8FD8\u6CA1\u6709\u63A2\u9488\u6570\u636E\uFF1A\u5148\u8FD0\u884C\u4EFF\u771F\uFF0C\u6216\u6253\u5F00\u5E26\u63A2\u9488\u7684\u5DE5\u7A0B\u3002";
    box.appendChild(empty);
  } else {
    pkChannelCache.forEach((key) => {
      const label = document.createElement("label");
      label.className = "pk-ch";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = key;
      input.checked = want.has(key);
      const span = document.createElement("span");
      span.textContent = pkKeyShort(key);
      span.title = key;
      label.appendChild(input);
      label.appendChild(span);
      box.appendChild(label);
    });
  }
  const count = $("#pkDataCount");
  if (count) count.textContent = String(pkChannelCache.length);
}
function showPkChannelLoadError(message) {
  const hint = $("#pkDataHint");
  const box = $("#pkChannelList");
  const text = message || "\u8BF7\u6C42\u5931\u8D25";
  if (hint) hint.textContent = `\u6570\u636E\u5237\u65B0\u5931\u8D25\uFF1A${text}\uFF1B\u73B0\u6709\u901A\u9053\u5217\u8868\u672A\u6E05\u9664\uFF0C\u53EF\u70B9\u51FB\u300C\u91CD\u8BD5\u300D\u3002`;
  if (pkChannelCache.length || !box) return;
  box.textContent = "";
  const empty = document.createElement("span");
  empty.className = "pk-empty";
  empty.textContent = `\u63A2\u9488\u5217\u8868\u52A0\u8F7D\u5931\u8D25\uFF1A${text}`;
  box.appendChild(empty);
}
async function refreshPkChannels(keepSelection) {
  const hint = $("#pkDataHint");
  try {
    const data = await api("/api/plotkit/channels");
    const avail = data && data.available || [];
    const registered = data && data.channels || [];
    if (data && data.build && data.build !== UI_BUILD) {
      pkChannelCache = avail;
      renderPkChannels([]);
      if (hint) hint.textContent = `\u670D\u52A1\u7AEF\u8FDB\u7A0B\u8FD8\u662F\u65E7\u7248\u672C\uFF08\u540E\u7AEF ${data.build} / \u754C\u9762 ${UI_BUILD}\uFF09\u2014\u2014\u8BF7\u5B8C\u5168\u9000\u51FA\u5E94\u7528\u540E\u91CD\u65B0\u542F\u52A8\uFF1B\u53EA\u5173\u95ED\u7A97\u53E3\u53EF\u80FD\u6B8B\u7559\u65E7\u8FDB\u7A0B\u3002`;
      return false;
    }
    if (!data || !data.mounted) {
      pkChannelCache = avail;
      renderPkChannels([]);
      const why = data && data.diag && data.diag.last_error || "\u627E\u4E0D\u5230 plotkit \u5305";
      if (hint) hint.textContent = `PlotKit \u672A\u6302\u8F7D\uFF1A${why}`;
      return false;
    }
    pkChannelCache = avail.length ? avail : registered;
    renderPkChannels(keepSelection ? null : data.selected || []);
    if (hint) {
      hint.textContent = avail.length ? `\u573A\u666F\u5171 ${avail.length} \u6761\u63A2\u9488\uFF0C\u5DF2\u767B\u8BB0 ${registered.length} \u6761\uFF0C\u5F53\u524D\u753B ${(data.selected || []).length} \u6761\uFF1B\u52FE\u9009\u540E\u70B9\u300C\u63A5\u5165\u300D\u3002` : "\u5F53\u524D\u573A\u666F\u6CA1\u6709\u63A2\u9488\uFF1A\u5148\u653E\u63A2\u9488\u8282\u70B9\u6216\u6253\u5F00\u5E26\u63A2\u9488\u7684\u5DE5\u7A0B\u3002";
    }
    return true;
  } catch (error) {
    showPkChannelLoadError(error.message);
    return false;
  }
}
async function retryPlotkit() {
  const hint = $("#pkDataHint");
  if (hint) hint.textContent = "\u6B63\u5728\u91CD\u65B0\u68C0\u6D4B PlotKit\u2026";
  try {
    const data = await api("/api/plotkit/channels");
    if (data && data.mounted) {
      reloadPlotkitFrame();
      const refreshed = await refreshPkChannels(true);
      if (!refreshed) {
        toast("\u901A\u9053\u5237\u65B0\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u63D0\u793A", "warn", 4e3);
        return;
      }
      toast("PlotKit \u5DF2\u5C31\u7EEA", "info", 1800);
    } else {
      const why = data && data.diag && data.diag.last_error || "\u672A\u77E5\u539F\u56E0";
      if (hint) hint.textContent = `\u4ECD\u7136\u672A\u6302\u8F7D\uFF1A${why}`;
      toast("PlotKit \u4ECD\u672A\u6302\u8F7D\uFF0C\u8BF7\u770B\u63D0\u793A", "warn", 4e3);
    }
  } catch (error) {
    showPkChannelLoadError(error.message);
    toast("\u91CD\u65B0\u68C0\u6D4B\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u63D0\u793A", "warn", 4e3);
  }
}
function reloadPlotkitFrame() {
  const frame = $("#plotkitFrame");
  if (frame) frame.src = plotkitFrameUrl({ embed: "1", r: String(Date.now()) });
}
function mountPrecomputeBar() {
  const prior = document.getElementById("pkPrecomputeBar");
  if (prior) prior.remove();
  const host = document.createElement("div");
  host.id = "pkPrecomputeBar";
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");
  host.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:10000;width:min(460px,92vw);background:var(--paper-2,#f3efe6);color:var(--text-primary,#080a08);border:1px solid var(--line-strong,#b9ae98);border-radius:12px;box-shadow:0 18px 48px rgba(0,0,0,.28);padding:12px 16px 13px;font:13px/1.5 "Microsoft YaHei",system-ui,sans-serif;';
  const head = document.createElement("div");
  head.style.cssText = "display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:8px;";
  const title = document.createElement("span");
  title.style.cssText = "color:var(--text-primary,#080a08);font-weight:600;";
  title.textContent = "\u9884\u8BA1\u7B97\u4E2D\u2026";
  const pct = document.createElement("span");
  pct.style.cssText = "color:var(--accent,#9b7247);font-weight:600;font-variant-numeric:tabular-nums;";
  pct.textContent = "0%";
  head.append(title, pct);
  const track = document.createElement("div");
  track.style.cssText = "height:8px;border-radius:999px;background:var(--paper-3,#e7e0d1);overflow:hidden;";
  const fill = document.createElement("div");
  fill.style.cssText = "height:100%;width:0%;border-radius:999px;background:var(--accent,#9b7247);transition:width .18s linear;";
  track.appendChild(fill);
  const sub = document.createElement("div");
  sub.style.cssText = "margin-top:7px;color:var(--text-secondary,#7b7266);font-size:12px;";
  sub.textContent = "\u6B63\u5728\u51C6\u5907\u2026";
  host.append(head, track, sub);
  document.body.appendChild(host);
  return { host, title, pct, fill, sub };
}
function paintPrecomputeBar(parts, progress, label) {
  if (!progress) return;
  const total = Number(progress.total || 0);
  const done = Number(progress.done || 0);
  let pctValue = Number(progress.percent);
  if (!Number.isFinite(pctValue)) pctValue = total > 0 ? done * 100 / total : 0;
  pctValue = Math.max(0, Math.min(100, pctValue));
  parts.fill.style.width = `${pctValue.toFixed(1)}%`;
  parts.pct.textContent = `${Math.round(pctValue)}%`;
  const status = progress.status || "";
  parts.title.textContent = status === "done" ? "\u9884\u8BA1\u7B97\u5B8C\u6210" : status === "cancelled" ? "\u5DF2\u505C\u6B62\u9884\u8BA1\u7B97" : status === "error" ? "\u9884\u8BA1\u7B97\u5931\u8D25" : label;
  const bits = [];
  if (total > 0) bits.push(`${done} / ${total} \u6B65`);
  const elapsed = Number(progress.elapsed);
  if (Number.isFinite(elapsed) && elapsed > 0) bits.push(`\u5DF2\u7528 ${elapsed.toFixed(1)}s`);
  const eta = progress.eta == null ? Number.NaN : Number(progress.eta);
  if (progress.running && Number.isFinite(eta) && eta >= 0 && pctValue < 100) {
    bits.push(`\u5269\u4F59\u7EA6 ${eta.toFixed(1)}s`);
  }
  parts.sub.textContent = bits.length ? bits.join(" \xB7 ") : "\u6B63\u5728\u51C6\u5907\u2026";
}
async function runPrecomputeWithProgress(launch, label = "\u9884\u8BA1\u7B97\u4E2D\u2026") {
  const parts = mountPrecomputeBar();
  let finished = false;
  const tick = async () => {
    if (finished) return;
    try {
      const progress = await api("/api/precompute/progress", {
        timeoutMs: 4e3
      });
      if (!finished) paintPrecomputeBar(parts, progress, label);
    } catch {
    }
  };
  void tick();
  const timer = window.setInterval(() => {
    void tick();
  }, 220);
  try {
    return await launch();
  } finally {
    finished = true;
    window.clearInterval(timer);
    parts.host.remove();
  }
}
async function syncAfterPrecompute(pre) {
  if (pre && pre.sim) state.sim = pre.sim;
  else await plotkitDataActions.refreshState(true);
  plotkitDataActions.updateSignalKeyCache();
  if (activeTab() === "analysis") plotkitDataActions.renderAnalysisPanel();
}
async function applyPkChannels() {
  const keys = pkCheckedKeys();
  const hint = $("#pkDataHint");
  const applyBtn = $("#pkChApply");
  const seconds = Math.max(1, Math.min(120, Number(state.chart && state.chart.window) || 5));
  if (applyBtn) applyBtn.disabled = true;
  try {
    if (hint) hint.textContent = "\u6B63\u5728\u767B\u8BB0\u9009\u4E2D\u901A\u9053\u2026";
    const data = await api("/api/plotkit/channels", {
      method: "POST",
      body: JSON.stringify({ keys })
    });
    if (!data || !data.ok) {
      const message = data && data.error || (data && data.mounted === false ? "PlotKit \u672A\u6302\u8F7D" : "\u672A\u77E5\u539F\u56E0");
      if (hint) hint.textContent = `\u63A5\u5165\u5931\u8D25\uFF1A${message}`;
      toast(`\u63A5\u5165\u5931\u8D25\uFF1A${message}`, "warn", 4e3);
      return;
    }
    if (hint) hint.textContent = `\u6B63\u5728\u9884\u8BA1\u7B97 0\u2192${seconds}s \u7684\u6570\u636E\u2026`;
    const pre = await runPrecomputeWithProgress(
      () => api("/api/plotkit/precompute", {
        method: "POST",
        body: JSON.stringify({ seconds }),
        timeoutMs: 18e4
      }),
      `\u6B63\u5728\u8BA1\u7B97 0\u2192${seconds}s`
    );
    if (pre && pre.ok === false) {
      toast("\u9884\u8BA1\u7B97\u5931\u8D25\uFF1A" + (pre.error || "\u672A\u77E5\u9519\u8BEF"), "warn", 4e3);
      if (hint) hint.textContent = `\u9884\u8BA1\u7B97\u5931\u8D25\uFF1A${pre.error || "\u672A\u77E5\u9519\u8BEF"}\uFF1B\u53EF\u91CD\u8BD5\u6216\u68C0\u67E5\u573A\u666F\u3002`;
      return;
    }
    if (pre && pre.elapsed_ms) {
      const degradedNote = pre.degraded ? `\uFF1B\u6B65\u957F\u5DF2\u964D\u7EA7\u4E3A ${Number(pre.dt_used).toExponential(1)}s\uFF08\u8BF7\u6C42 ${Number(pre.requested_dt).toExponential(1)}s\uFF0C\u53D7 20 \u4E07\u6B65\u4E0A\u9650\u9650\u5236\uFF09` : "";
      if (hint) hint.textContent = `\u9884\u8BA1\u7B97\u5B8C\u6210\uFF1A${seconds}s / ${pre.frames ?? pre.frames_recorded ?? "?"} \u5E27 / ${Math.round(pre.elapsed_ms)} ms${degradedNote}`;
      if (pre.degraded) {
        toast(`\u9884\u8BA1\u7B97\u5DF2\u964D\u7EA7\u6B65\u957F ${Number(pre.dt_used).toExponential(1)}s\uFF0C\u7F29\u5C0F\u65F6\u95F4\u7A97\u53EF\u63D0\u9AD8\u7CBE\u5EA6`, "warn", 5200);
      }
    }
    await syncAfterPrecompute(pre);
    toast(`\u5DF2\u63A5\u5165 ${(data.selected || []).length} \u6761\u901A\u9053`, "ok", 2600);
    reloadPlotkitFrame();
    await refreshPkChannels();
  } catch (error) {
    const message = error.message || "\u8BF7\u6C42\u5931\u8D25";
    if (hint) hint.textContent = `\u63A5\u5165\u5931\u8D25\uFF1A${message}`;
    toast(`\u63A5\u5165\u5931\u8D25\uFF1A${message}`, "warn", 4e3);
  } finally {
    if (applyBtn) applyBtn.disabled = false;
  }
}
function pkKeysForSelectedNode() {
  const node = selectedNode();
  if (!node) {
    toast("\u5148\u5728\u753B\u5E03\u4E0A\u9009\u4E2D\u4E00\u4E2A\u8282\u70B9", "warn", 2400);
    return null;
  }
  const names = [node.id, node.name].filter(Boolean).map(String);
  return pkChannelCache.filter((key) => names.some((name) => key === name || key.startsWith(name + ":") || key.indexOf(":" + name + ":") >= 0));
}
function initPlotkitDataBar() {
  const all = $("#pkChAll");
  const none = $("#pkChNone");
  const nodeBtn = $("#pkChNode");
  const apply = $("#pkChApply");
  if (all) all.addEventListener("click", () => {
    document.querySelectorAll("#pkChannelList input").forEach((i) => {
      i.checked = true;
    });
  });
  if (none) none.addEventListener("click", () => {
    document.querySelectorAll("#pkChannelList input").forEach((i) => {
      i.checked = false;
    });
  });
  if (nodeBtn) nodeBtn.addEventListener("click", () => {
    const keys = pkKeysForSelectedNode();
    if (!keys) return;
    if (!keys.length) {
      toast("\u8FD9\u4E2A\u8282\u70B9\u6CA1\u6709\u63A2\u9488\u901A\u9053", "warn", 2400);
      return;
    }
    document.querySelectorAll("#pkChannelList input").forEach((i) => {
      i.checked = keys.indexOf(i.value) >= 0;
    });
    toast(`\u5DF2\u52FE\u9009\u8BE5\u8282\u70B9\u7684 ${keys.length} \u6761\u901A\u9053`, "info", 2200);
  });
  if (apply) apply.addEventListener("click", applyPkChannels);
  const retry = $("#pkChRetry");
  if (retry) retry.addEventListener("click", retryPlotkit);
  document.querySelectorAll('[data-sub="plotkit"]').forEach((btn) => {
    btn.addEventListener("click", () => setTimeout(() => refreshPkChannels(true), 60));
  });
  setInterval(() => {
    const pane = $("#tab-plotkit");
    if (pane && !pane.hidden) refreshPkChannels(true);
  }, 5e3);
}
export {
  applyPkChannels,
  initPlotkitDataBar,
  mountPrecomputeBar,
  paintPrecomputeBar,
  pkChannelCache,
  pkCheckedKeys,
  pkKeyShort,
  pkKeysForSelectedNode,
  refreshPkChannels,
  reloadPlotkitFrame,
  renderPkChannels,
  retryPlotkit,
  runPrecomputeWithProgress,
  setPlotkitDataActions,
  showPkChannelLoadError,
  syncAfterPrecompute
};
