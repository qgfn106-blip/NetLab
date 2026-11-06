import "./view3d.js";
import "./render2d.js";
const $ = (id) => document.getElementById(id);
const EMBED = new URLSearchParams(location.search).get("embed") === "1";
const THEME_PARAM = (() => {
  const value = new URLSearchParams(location.search).get("theme");
  return value === "light" || value === "dark" ? value : null;
})();
const state = {
  expanded: /* @__PURE__ */ new Set(),
  undo: [],
  // 已提交过的 spec 快照（JSON 字符串）
  redo: [],
  committed: null,
  // 最近一次成功 PUT 的 spec 快照，用来判断"这次改动要不要进撤销栈"
  layout: { panelWidth: 380, sections: {}, expanded: [], groups: [] },
  layoutTimer: null,
  selectedLayer: null,
  spec: null,
  catalog: { datasets: [], groups: {} },
  meta: null,
  catalogKey: "",
  selected: null,
  // 当前选中的数据集名
  playhead: null,
  // 回放游标（秒）；null = 实时
  playing: false,
  playTimer: null,
  playSpeed: 60,
  // 帧/秒，和 netlab 老画布一致
  playLoop: false,
  time: { min: null, max: null, count: 0 },
  busy: false,
  timings: [],
  img: null,
  // 当前显示的图：{xlim, ylim, box, px}
  view: { xlim: null, ylim: null },
  // 用户缩放/平移后的视窗（null = 自动）
  pending: null
  // 停手重绘的定时器
};
const KIND_LABEL = { line: "\u6298\u7EBF", marker: "\u6563\u70B9", bar: "\u67F1\u72B6" };
const CLIENT_KINDS = /* @__PURE__ */ new Set([
  "line",
  "step",
  "stairs",
  "stem",
  "marker",
  "scatter",
  "points",
  "bar",
  "barh",
  "segments",
  "area",
  "hist",
  "ecdf",
  "boxplot",
  "violinplot",
  "violin",
  "pie",
  "hexbin",
  "quiver",
  "table",
  "heatmap",
  "image",
  "contour",
  "contourf"
]);
const SERIES_CACHE = /* @__PURE__ */ new Map();
state.clientZoom = {};
state.clientResult = null;
function clientTokens() {
  const cs = getComputedStyle(document.body);
  const read = (key, fallback) => (cs.getPropertyValue(key) || "").trim() || fallback;
  return {
    paper: read("--bg", "#0f172a"),
    plot: read("--bg-2", "#111827"),
    text: read("--text", "#e2e8f0"),
    muted: read("--muted", "#94a3b8"),
    grid: read("--line", "#1f2937"),
    accent: read("--accent", "#4fc3f7")
  };
}
function clientRenderable(spec) {
  if (!spec || !spec.layers || !spec.layers.length) return false;
  return spec.layers.every((layer) => CLIENT_KINDS.has(String(layer.kind || "line").toLowerCase()));
}
function datasetTotal(name) {
  const item = (state.catalog.datasets || []).find((d) => d.name === name);
  return item && typeof item.n === "number" ? item.n : null;
}
async function ensureSeries(name) {
  const total = datasetTotal(name);
  const cached = SERIES_CACHE.get(name);
  if (cached && (total == null || cached.total === total)) return cached;
  const res = await fetch(`api/column?name=${encodeURIComponent(name)}&pixels=8000`);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const view = new DataView(buf);
  const metaLen = view.getUint32(4, true);
  const n = view.getUint32(8, true);
  const values = new Float32Array(n);
  const base = 12 + metaLen;
  for (let i = 0; i < n; i++) values[i] = view.getFloat32(base + i * 4, true);
  const entry = { values, total: total == null ? n : total };
  SERIES_CACHE.set(name, entry);
  return entry;
}
async function renderClient(reason) {
  const canvas = $("plotCanvas");
  const img = $("plotImg");
  const { w, h } = plotSize();
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.hidden = false;
  img.style.display = "none";
  $("empty").hidden = true;
  const names = /* @__PURE__ */ new Set();
  for (const layer of state.spec.layers) {
    const data = layer.data || {};
    if (data.x || data.x0) names.add(data.x || data.x0);
    if (data.y || data.y0) names.add(data.y || data.y0);
  }
  await Promise.all([...names].map((name) => ensureSeries(name)));
  const store = { get: (name) => SERIES_CACHE.get(name) || null };
  const head = state.playhead;
  const win = parseFloat($("winSec").value);
  const tMin = head != null && isFinite(win) && win > 0 ? head - win : null;
  state.clientResult = window.Plot2D.render(canvas, state.spec, store, {
    tokens: clientTokens(),
    t: head == null ? Infinity : head,
    tMin,
    overrides: state.clientZoom,
    dpr: window.devicePixelRatio || 1
  });
}
function resetClientZoom() {
  state.clientZoom = {};
}
function bindClientInteractions() {
  const canvas = $("plotCanvas");
  if (!canvas || canvas.dataset.bound === "1") return;
  canvas.dataset.bound = "1";
  const axisAt = (px, py) => {
    const res = state.clientResult;
    if (!res) return null;
    return res.axes.find((a) => px >= a.box.x && px <= a.box.x + a.box.w && py >= a.box.y && py <= a.box.y + a.box.h) || null;
  };
  canvas.addEventListener("wheel", (ev) => {
    if (!state.clientResult) return;
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    const axis = axisAt(px, py);
    if (!axis) return;
    const factor = Math.exp(ev.deltaY * 12e-4);
    const cur = state.clientZoom[axis.slot] || { xlim: axis.xlim.slice(), ylim: axis.ylim.slice() };
    const xv = axis.sx.from(px), yv = axis.sy.from(py);
    state.clientZoom[axis.slot] = {
      xlim: [xv + (cur.xlim[0] - xv) * factor, xv + (cur.xlim[1] - xv) * factor],
      ylim: [yv + (cur.ylim[0] - yv) * factor, yv + (cur.ylim[1] - yv) * factor]
    };
    renderClient("\u7F29\u653E");
  }, { passive: false });
  let drag = null;
  let raf = 0;
  canvas.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 || !state.clientResult) return;
    const rect = canvas.getBoundingClientRect();
    const axis = axisAt(ev.clientX - rect.left, ev.clientY - rect.top);
    if (!axis) return;
    drag = { axis, x: ev.clientX, y: ev.clientY, cur: state.clientZoom[axis.slot] || { xlim: axis.xlim.slice(), ylim: axis.ylim.slice() } };
    canvas.setPointerCapture(ev.pointerId);
    canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", (ev) => {
    const rect = canvas.getBoundingClientRect();
    if (drag) {
      const dxData = drag.axis.sx.from(drag.axis.box.x) - drag.axis.sx.from(drag.axis.box.x + (ev.clientX - drag.x));
      const dyData = drag.axis.sy.from(drag.axis.box.y) - drag.axis.sy.from(drag.axis.box.y + (ev.clientY - drag.y));
      state.clientZoom[drag.axis.slot] = {
        xlim: [drag.cur.xlim[0] + dxData, drag.cur.xlim[1] + dxData],
        ylim: [drag.cur.ylim[0] + dyData, drag.cur.ylim[1] + dyData]
      };
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        renderClient("\u5E73\u79FB");
      });
      return;
    }
    const hit = window.Plot2D.pick(state.clientResult, ev.clientX - rect.left, ev.clientY - rect.top);
    const hover = $("plotHover");
    if (!hit) {
      hover.hidden = true;
      return;
    }
    hover.hidden = false;
    hover.style.left = `${ev.clientX - rect.left + 12}px`;
    hover.style.top = `${ev.clientY - rect.top + 12}px`;
    hover.textContent = `${hit.item.series.yName || "y"} = ${+hit.y.toPrecision(4)}  \xB7  x = ${+hit.x.toPrecision(4)}`;
  });
  const end = (ev) => {
    if (!drag) return;
    drag = null;
    canvas.style.cursor = "";
    try {
      canvas.releasePointerCapture(ev.pointerId);
    } catch (err) {
    }
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("dblclick", () => {
    state.clientZoom = {};
    renderClient("\u590D\u4F4D\u7F29\u653E");
  });
}
async function api(path, options) {
  const res = await fetch(path, options);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = { raw: text };
  }
  if (!res.ok) {
    const detail = body && body.errors ? body.errors.map((e) => `${e.path} ${e.message}`).join("; ") : text;
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return body;
}
function setStatus(text, tone) {
  const el = $("status");
  el.textContent = text;
  el.className = tone || "";
}
function bindFigureFields() {
  const fig = () => state.spec.figure;
  const set = (k, v) => {
    fig()[k] = v;
    commit("\u753B\u5E03");
  };
  const subCount = () => Number(state.spec.figure.subplots) || 1;
  $("figTitle").onchange = (e) => set("title", e.target.value);
  $("figNcols").onchange = (e) => set("ncols", +e.target.value || 1);
  $("figXlabel").onchange = (e) => set("xlabel", e.target.value);
  $("figYlabel").onchange = (e) => set("ylabel", e.target.value);
  $("figSubplots").onchange = (e) => {
    const n = Math.max(1, +e.target.value || 1);
    state.spec.figure.subplots = n;
    state.spec.layers.forEach((l) => {
      if ((l.subplot | 0) >= n) l.subplot = n - 1;
    });
    trimLayoutTo(n);
    commit("\u5B50\u56FE\u6570");
  };
  const sync = () => {
    const f = state.spec.figure;
    $("figTitle").value = f.title || "";
    $("figNcols").value = String(f.ncols || 1);
    $("figXlabel").value = f.xlabel || "";
    $("figYlabel").value = f.ylabel || "";
    $("figSubplots").value = String(subCount());
  };
  sync();
  state.syncFigureFields = sync;
}
async function boot() {
  try {
    const [meta, spec, catalog, layout] = await Promise.all([
      api("api/meta"),
      api("api/spec"),
      api("api/datasets"),
      api("api/layout")
    ]);
    state.meta = meta;
    state.spec = spec;
    state.catalog = catalog;
    state.catalogKey = catalog.datasets.map((d) => `${d.name}:${d.version}:${d.length}`).join("|");
    state.committed = JSON.stringify(spec);
    applyLayout(layout || {});
    $("specversion").textContent = `spec v${spec.spec_version}`;
    initPlayback(meta);
    renderLayoutControls();
    renderDatasets();
    bindFigureFields();
    renderLayers();
    bindClientInteractions();
    await redraw("\u9996\u6B21\u7ED8\u5236");
    pushTiming("\u9996\u5E27\uFF08\u542B\u5F15\u64CE\u89E3\u6790\uFF09", performance.now());
    setStatus(`\u5C31\u7EEA \xB7 ${catalog.datasets.length} \u4E2A\u6570\u636E\u96C6 \xB7 ${spec.layers.length} \u4E2A\u56FE\u5C42`, "good");
  } catch (err) {
    setStatus(`\u542F\u52A8\u5931\u8D25\uFF1A${err.message}`, "bad");
    console.error(err);
  }
}
function renderLayoutControls() {
  const fig = state.spec.figure;
  $("ncols").value = fig.ncols;
  $("subplots").value = fig.subplots;
  $("theme").value = fig.theme || "default";
  $("linkx").checked = !!fig.link_x;
  $("figtitle").textContent = fig.title || "\u672A\u547D\u540D";
  document.body.dataset.theme = THEME_PARAM || (fig.theme === "default" ? "light" : "dark");
}
function newLayerFor(x, y, subplot) {
  return {
    id: "l" + Math.random().toString(16).slice(2, 10),
    kind: "line",
    subplot: subplot | 0,
    data: { x, y },
    label: y,
    legend: true,
    style: {
      mode: "lines",
      color: null,
      width: 1.6,
      dash: "solid",
      marker: { symbol: "circle", size: 6, opacity: 1 },
      fill: null,
      opacity: 1
    },
    view: {
      title: null,
      xlabel: null,
      ylabel: null,
      xlim: null,
      ylim: null,
      xscale: "linear",
      yscale: "linear",
      grid: true,
      invert_y: false,
      zero_line: false
    },
    annotations: []
  };
}
function dsFilter() {
  const keyword = ($("dsSearch").value || "").trim().toLowerCase();
  const all = state.catalog.datasets || [];
  if (!keyword) return all;
  return all.filter((d) => d.name.toLowerCase().includes(keyword) || (d.tags || []).some((tag) => String(tag).toLowerCase().includes(keyword)) || String(d.unit || "").toLowerCase().includes(keyword));
}
function renderDatasets() {
  const box = $("datasets");
  box.innerHTML = "";
  const all = state.catalog.datasets || [];
  const list = dsFilter();
  $("dscount").textContent = list.length === all.length ? String(all.length) : `${list.length}/${all.length}`;
  if (!list.length) {
    box.innerHTML = `<p class="hint">\u5148\u7528 <code>fig.add_data("v_out", arr, role="series")</code> \u6CE8\u518C\u6570\u636E\u3002</p>`;
    return;
  }
  for (const ds of list) {
    const el = document.createElement("span");
    el.className = "ds" + (state.selected === ds.name ? " active" : "");
    el.title = `role=${ds.role} \xB7 ${ds.length} \u70B9${ds.unit ? " \xB7 \u5355\u4F4D " + ds.unit : ""}${ds.tags.length ? " \xB7 " + ds.tags.join("/") : ""}`;
    el.innerHTML = `${ds.name}${ds.unit ? ` <span class="u">${ds.unit}</span>` : ""}`;
    el.onclick = () => {
      state.selected = state.selected === ds.name ? null : ds.name;
      renderDatasets();
    };
    box.appendChild(el);
  }
  if (list.length && list.length !== all.length) {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = `\u7B5B\u51FA ${list.length} \u4E2A`;
    box.appendChild(hint);
  }
}
function addFilteredLayers() {
  const coords = datasetsByRole("coord");
  const x = coords.length ? coords[0].name : null;
  const series = dsFilter().filter((d) => d.role !== "coord" && d.name !== x);
  if (!x) {
    setStatus('\u7F3A\u5C11 x \u8F74\u5750\u6807\u6570\u636E\u96C6\uFF08role="coord"\uFF09', "bad");
    return;
  }
  if (!series.length) {
    setStatus("\u7B5B\u9009\u7ED3\u679C\u91CC\u6CA1\u6709\u53EF\u753B\u7684\u4FE1\u53F7", "bad");
    return;
  }
  const subplots = state.spec.figure.subplots || 1;
  let added = 0;
  for (const ds of series) {
    if (state.spec.layers.some((l) => l.data && l.data.y === ds.name && l.data.x === x)) continue;
    state.spec.layers.push(newLayerFor(x, ds.name, 0));
    added += 1;
  }
  if (!added) {
    setStatus("\u8FD9\u4E9B\u4FE1\u53F7\u5DF2\u7ECF\u5728\u56FE\u4E0A\u4E86", "bad");
    return;
  }
  commit(`\u6279\u91CF\u52A0 ${added} \u6761\u66F2\u7EBF`);
}
function datasetsByRole(role) {
  return (state.catalog.datasets || []).filter((d) => role == null || d.role === role || d.role === "auto");
}
function makeLayerCard(layer, index) {
  if (!layer.style) layer.style = {};
  if (!layer.data) layer.data = {};
  if (!layer.style.marker) layer.style.marker = { symbol: "circle", size: 6 };
  const card = document.createElement("div");
  card.className = "layer";
  card.draggable = true;
  card.dataset.layerId = layer.id;
  if (state.selectedLayer === layer.id) card.classList.add("selected");
  const head = document.createElement("div");
  head.className = "head";
  head.innerHTML = `
    <span class="dot" style="background:${layer.style.color || "var(--accent)"}"></span>
    <span class="name">${layer.label || layer.data.z || layer.data.u || layer.data.y || layer.data.values || layer.data.image || layer.data.cells || layer.data.x || KIND_LABEL[layer.kind] || layer.kind}</span>
    <span class="kindtag">${KIND_LABEL[layer.kind] || layer.kind}</span>
    <span class="sub">\u69FD ${layer.subplot}</span>
    <span class="caret" title="\u5C55\u5F00/\u6536\u8D77\u53C2\u6570">\u2304</span>
    <span class="grip" title="\u62D6\u5230\u522B\u7684\u5B50\u56FE\u6216\u5206\u7EC4">\u283F</span>`;
  card.appendChild(head);
  const body = document.createElement("div");
  body.className = "body";
  const expanded = state.expanded.has(layer.id);
  body.hidden = !expanded;
  card.classList.toggle("open", expanded);
  head.onclick = (ev) => {
    state.selectedLayer = layer.id;
    if (ev.target.classList.contains("grip")) return;
    if (state.expanded.has(layer.id)) state.expanded.delete(layer.id);
    else state.expanded.add(layer.id);
    body.hidden = !state.expanded.has(layer.id);
    card.classList.toggle("open", state.expanded.has(layer.id));
    syncLayoutExpanded();
  };
  const fields = document.createElement("div");
  fields.className = "fields";
  const allMeta = state.meta && state.meta.kinds || [];
  const flat = allMeta.filter((k) => k.dimension !== 3).map((k) => ({ value: k.kind, label: `${k.description || k.kind} \xB7 ${k.kind}` }));
  const deep = allMeta.filter((k) => k.dimension === 3).map((k) => ({ value: k.kind, label: `${k.description || k.kind} \xB7 ${k.kind}\uFF083D\uFF09` }));
  const kindPairs = flat.concat(deep);
  if (layer.kind && !kindPairs.some((p) => p.value === layer.kind)) {
    kindPairs.unshift({ value: layer.kind, label: layer.kind });
  }
  fields.appendChild(selectPairs("\u56FE\u578B", kindPairs, layer.kind, (v) => {
    layer.kind = v;
    commit("\u6539\u56FE\u578B");
  }));
  fields.appendChild(selectField("\u989C\u8272", [], layer.style.color || "", (v) => {
    layer.style.color = v || null;
    commit("\u6539\u989C\u8272");
  }, true));
  fields.appendChild(selectPairs("\u5B50\u56FE\u69FD", range(state.spec.figure.subplots).map((i) => ({ value: String(i), label: `\u69FD ${i}` })), String(layer.subplot), (v) => {
    layer.subplot = Number(v);
    commit("\u6362\u5B50\u56FE");
  }));
  const allNames = (state.catalog.datasets || []).map((d) => ({ value: d.name, label: d.name }));
  fields.appendChild(selectPairs("X \u6570\u636E", allNames, layer.data.x || "", (v) => {
    layer.data.x = v;
    commit("\u6539 X");
  }));
  fields.appendChild(selectPairs("Y \u6570\u636E", allNames, layer.data.y || "", (v) => {
    layer.data.y = v;
    commit("\u6539 Y");
  }));
  fields.appendChild(textField("\u56FE\u4F8B\u540D", layer.label || "", (v) => {
    layer.label = v || null;
    commit("\u6539\u56FE\u4F8B");
  }));
  fields.appendChild(numberField("\u7EBF\u5BBD", layer.style.width == null ? 1.6 : layer.style.width, 0, 12, 0.2, (v) => {
    layer.style.width = v;
    commit("\u6539\u7EBF\u5BBD");
  }));
  fields.appendChild(selectField("\u7EBF\u578B", ["solid", "dash", "dot", "dashdot", "longdash"], layer.style.dash || "solid", (v) => {
    layer.style.dash = v;
    commit("\u6539\u7EBF\u578B");
  }));
  if (!layer.style.marker) layer.style.marker = { symbol: "circle", size: 6 };
  fields.appendChild(selectField("\u70B9\u5F62", ["circle", "square", "diamond", "triangle", "cross"], layer.style.marker.symbol || "circle", (v) => {
    layer.style.marker.symbol = v;
    commit("\u6539\u70B9\u5F62");
  }));
  fields.appendChild(numberField("\u70B9\u5927\u5C0F", layer.style.marker.size == null ? 6 : layer.style.marker.size, 1, 30, 1, (v) => {
    layer.style.marker.size = v;
    commit("\u6539\u70B9\u5927\u5C0F");
  }));
  fields.appendChild(numberField("\u4E0D\u900F\u660E\u5EA6", layer.style.opacity == null ? 1 : layer.style.opacity, 0, 1, 0.05, (v) => {
    layer.style.opacity = v;
    commit("\u6539\u4E0D\u900F\u660E\u5EA6");
  }));
  fields.appendChild(selectField("\u56FE\u4F8B", ["\u663E\u793A", "\u9690\u85CF"], layer.legend === false ? "\u9690\u85CF" : "\u663E\u793A", (v) => {
    layer.legend = v === "\u663E\u793A";
    commit("\u6539\u56FE\u4F8B\u5F00\u5173");
  }));
  layer.view = layer.view || {};
  const rangeText = (v) => Array.isArray(v) && v.length === 2 ? v.join(", ") : "";
  const parseRange = (txt) => {
    const parts = String(txt).split(/[,，\s]+/).map(Number).filter((x) => isFinite(x));
    return parts.length === 2 ? parts : null;
  };
  fields.appendChild(textField("X \u8303\u56F4", rangeText(layer.view.xlim), (v) => {
    layer.view.xlim = parseRange(v);
    commit("X \u8303\u56F4");
  }));
  fields.appendChild(textField("Y \u8303\u56F4", rangeText(layer.view.ylim), (v) => {
    layer.view.ylim = parseRange(v);
    commit("Y \u8303\u56F4");
  }));
  fields.appendChild(selectPairs("X \u523B\u5EA6", [["linear", "\u7EBF\u6027"], ["log", "\u5BF9\u6570"]], layer.view.xscale || "linear", (v) => {
    layer.view.xscale = v;
    commit("X \u523B\u5EA6");
  }));
  fields.appendChild(selectPairs("Y \u523B\u5EA6", [["linear", "\u7EBF\u6027"], ["log", "\u5BF9\u6570"]], layer.view.yscale || "linear", (v) => {
    layer.view.yscale = v;
    commit("Y \u523B\u5EA6");
  }));
  fields.appendChild(selectPairs("\u7F51\u683C", [[true, "\u663E\u793A"], [false, "\u9690\u85CF"]], layer.view.grid !== false, (v) => {
    layer.view.grid = v;
    commit("\u7F51\u683C");
  }));
  fields.appendChild(selectPairs("Y \u8F74", [[false, "\u6B63\u5E38"], [true, "\u7FFB\u8F6C"]], !!layer.view.invert_y, (v) => {
    layer.view.invert_y = v;
    commit("Y \u8F74");
  }));
  body.appendChild(fields);
  const foot = document.createElement("div");
  foot.className = "foot";
  const modeSel = selectEl(["lines", "markers", "lines+markers"], layer.style.mode || "lines");
  modeSel.onchange = () => {
    layer.style.mode = modeSel.value;
    commit("\u6539\u6A21\u5F0F");
  };
  modeSel.title = "\u7ED8\u5236\u6A21\u5F0F";
  foot.appendChild(modeSel);
  const del = document.createElement("button");
  del.className = "btn small danger";
  del.textContent = "\u5220\u9664";
  del.onclick = () => {
    state.spec.layers.splice(index, 1);
    commit("\u5220\u56FE\u5C42");
  };
  foot.appendChild(del);
  body.appendChild(foot);
  card.appendChild(body);
  card.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    state.selectedLayer = layer.id;
    closeMenus();
    openMenuAt("layer", ev.clientX, ev.clientY);
  });
  card.addEventListener("dragstart", (ev) => {
    ev.dataTransfer.setData("text/plain", layer.id);
    ev.dataTransfer.effectAllowed = "move";
  });
  card.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    card.classList.add("dragover");
  });
  card.addEventListener("dragleave", () => card.classList.remove("dragover"));
  card.addEventListener("drop", (ev) => {
    ev.preventDefault();
    card.classList.remove("dragover");
    const draggedId = ev.dataTransfer.getData("text/plain");
    const dragged = state.spec.layers.find((l) => l.id === draggedId);
    if (!dragged || dragged === layer) return;
    const from = dragged.subplot;
    dragged.subplot = layer.subplot;
    layer.subplot = from;
    commit("\u4EA4\u6362\u5B50\u56FE");
  });
  return card;
}
function groupIndexOf(layerId) {
  return state.layout.groups.findIndex((g) => (g.layerIds || []).includes(layerId));
}
function renderLayers() {
  const box = $("layers");
  box.innerHTML = "";
  const layers = state.spec.layers;
  $("layercount").textContent = String(layers.length);
  $("empty").hidden = layers.length > 0;
  const draw = (layer) => box.appendChild(makeLayerCard(layer, layers.indexOf(layer)));
  const grouped = /* @__PURE__ */ new Set();
  const alive = new Set(layers.map((l) => l.id));
  (state.layout.groups || []).forEach((group) => {
    group.layerIds = (group.layerIds || []).filter((id) => alive.has(id));
    const members = layers.filter((l) => group.layerIds.includes(l.id));
    if (!members.length && !group.name) return;
    members.forEach((l) => grouped.add(l.id));
    const head = document.createElement("div");
    head.className = "group-head";
    head.innerHTML = `<span>${group.open === false ? "\u25B8" : "\u25BE"}</span><span class="gname">${group.name || "\u5206\u7EC4"}</span><span class="gnum">${members.length}</span><button class="gdel" title="\u89E3\u6563\u5206\u7EC4">\u2715</button>`;
    head.ondblclick = (ev) => {
      ev.stopPropagation();
      const next = prompt("\u5206\u7EC4\u540D", group.name);
      if (!next) return;
      group.name = next;
      renderLayers();
      scheduleLayoutSave();
    };
    head.onclick = (ev) => {
      if (ev.target.classList.contains("gdel")) {
        group.layerIds = [];
        state.layout.groups = state.layout.groups.filter((g) => g !== group);
        renderLayers();
        scheduleLayoutSave();
        return;
      }
      group.open = group.open === false;
      renderLayers();
      scheduleLayoutSave();
    };
    head.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      head.classList.add("dragover");
    });
    head.addEventListener("dragleave", () => head.classList.remove("dragover"));
    head.addEventListener("drop", (ev) => {
      ev.preventDefault();
      head.classList.remove("dragover");
      const draggedId = ev.dataTransfer.getData("text/plain");
      if (!draggedId) return;
      (state.layout.groups || []).forEach((g) => {
        g.layerIds = (g.layerIds || []).filter((id) => id !== draggedId);
      });
      group.layerIds = [...group.layerIds || [], draggedId];
      renderLayers();
      scheduleLayoutSave();
      setStatus(`\u5DF2\u52A0\u5165\u5206\u7EC4\u300C${group.name}\u300D`, "good");
    });
    box.appendChild(head);
    if (group.open !== false) members.forEach(draw);
  });
  layers.filter((l) => !grouped.has(l.id)).forEach(draw);
}
function range(n) {
  return Array.from({ length: Math.max(1, n) }, (_, i) => i);
}
function selectEl(options, value) {
  const sel = document.createElement("select");
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    if (opt === value) o.selected = true;
    sel.appendChild(o);
  }
  if (value && !options.includes(value)) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = value;
    o.selected = true;
    sel.appendChild(o);
  }
  return sel;
}
function selectField(labelText, options, value, onChange, isColor) {
  const wrap = document.createElement("label");
  wrap.textContent = labelText;
  const sel = isColor ? colorEl(value) : selectEl(options, value);
  sel.onchange = () => onChange(sel.value);
  wrap.appendChild(sel);
  return wrap;
}
function colorEl(value) {
  const sel = document.createElement("select");
  const palette = ["", "#4fc3f7", "#ff8a65", "#aed581", "#ba68c8", "#ffd54f", "#4db6ac", "#f06292"];
  for (const c of palette) {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c || "\u81EA\u52A8";
    if ((value || "") === c) o.selected = true;
    sel.appendChild(o);
  }
  return sel;
}
function selectPairs(labelText, pairs, value, onChange) {
  const wrap = document.createElement("label");
  wrap.textContent = labelText;
  const sel = document.createElement("select");
  let matched = false;
  for (const pair of pairs) {
    const opt = document.createElement("option");
    opt.value = pair.value;
    opt.textContent = pair.label;
    if (String(pair.value) === String(value)) {
      opt.selected = true;
      matched = true;
    }
    sel.appendChild(opt);
  }
  if (!matched && value != null && value !== "") {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = String(value);
    opt.selected = true;
    sel.appendChild(opt);
  }
  sel.onchange = () => onChange(sel.value);
  wrap.appendChild(sel);
  return wrap;
}
function numberField(labelText, value, min, max, step, onChange) {
  const wrap = document.createElement("label");
  wrap.textContent = labelText;
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.onchange = () => {
    let v = parseFloat(input.value);
    if (!isFinite(v)) v = min;
    v = Math.max(min, Math.min(max, v));
    onChange(v);
  };
  wrap.appendChild(input);
  return wrap;
}
function textField(labelText, value, onChange) {
  const wrap = document.createElement("label");
  wrap.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.onchange = () => onChange(input.value);
  wrap.appendChild(input);
  return wrap;
}
async function commit(reason, { record = true } = {}) {
  if (state.busy) return;
  state.busy = true;
  const t0 = performance.now();
  resetClientZoom();
  const snapshot = JSON.stringify(state.spec);
  if (record && state.committed && state.committed !== snapshot) {
    state.undo.push(state.committed);
    if (state.undo.length > 50) state.undo.shift();
    state.redo.length = 0;
  }
  try {
    const res = await api("api/spec", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.spec)
    });
    if (res && res.ok === false) throw new Error("spec \u6821\u9A8C\u672A\u901A\u8FC7");
    state.committed = snapshot;
    await redraw(reason);
    setStatus(`\u5DF2\u4FDD\u5B58 \xB7 ${reason}`, "good");
    if (res && res.warnings && res.warnings.length) {
      $("warnings").textContent = `${res.warnings.length} \u6761\u8B66\u544A`;
      $("warnings").className = "bad";
    }
  } catch (err) {
    setStatus(`\u4FDD\u5B58\u5931\u8D25\uFF1A${err.message}`, "bad");
  } finally {
    state.busy = false;
    pushTiming("\u63D0\u4EA4+\u91CD\u7ED8", performance.now() - t0);
  }
}
async function redraw(reason) {
  const t0 = performance.now();
  animPlaying = false;
  $("btn-anim").classList.remove("on");
  renderLayoutControls();
  renderLayers();
  renderInsets();
  const img = $("plotImg");
  if (!state.spec.layers.length) {
    img.removeAttribute("src");
    state.img = null;
    $("plotCanvas").hidden = true;
    img.style.display = "";
    $("empty").hidden = false;
    return;
  }
  $("empty").hidden = true;
  if (clientRenderable(state.spec) && !layoutList().length && !noteList().length && !noteState.tool) {
    try {
      await renderClient(reason);
      renderLayoutOverlay();
      pushTiming(reason || "\u6E32\u67D3", performance.now() - t0, { \u524D\u7AEF\u6E32\u67D3: performance.now() - t0 });
      return;
    } catch (err) {
      console.warn("\u524D\u7AEF\u6E32\u67D3\u5931\u8D25\uFF0C\u56DE\u9000\u670D\u52A1\u7AEF", err);
    }
  }
  $("plotCanvas").hidden = true;
  img.style.display = "";
  const { w, h } = plotSize();
  const res = await fetch(renderUrl(w, h));
  if (!res.ok) {
    setStatus(`\u6E32\u67D3\u5931\u8D25 HTTP ${res.status}`, "bad");
    return;
  }
  showBlob(await res.blob());
  const xl = res.headers.get("X-PlotKit-Xlim");
  const yl = res.headers.get("X-PlotKit-Ylim");
  const box = res.headers.get("X-PlotKit-Box");
  const px = res.headers.get("X-PlotKit-Px");
  const axes = res.headers.get("X-PlotKit-Axes");
  state.img = {
    xlim: xl ? xl.split(",").map(Number) : null,
    ylim: yl ? yl.split(",").map(Number) : null,
    box: box ? box.split(",").map(Number) : null,
    px: px ? px.split(",").map(Number) : [w, h],
    slots: axes ? axes.split(";").map((item) => {
      const [slot, ...rest] = item.split(",").map(Number);
      return { slot, box: rest };
    }) : []
  };
  const t1 = performance.now();
  renderInsetOverlay();
  renderLayoutOverlay();
  pushTiming(reason || "\u6E32\u67D3", t1 - t0, { \u670D\u52A1\u7AEF\u6E32\u67D3: t1 - t0 });
}
const SETTLE_MS = 120;
function plotSize() {
  const el = $("plot");
  return { w: Math.max(320, el.clientWidth | 0), h: Math.max(200, el.clientHeight | 0) };
}
function renderUrl(w, h) {
  const MAX_W = 1400;
  const MAX_H = 1e3;
  const scale = Math.min(1, MAX_W / Math.max(1, w), MAX_H / Math.max(1, h));
  w = Math.max(240, Math.round(w * scale));
  h = Math.max(160, Math.round(h * scale));
  let url = `api/render?w=${w}&h=${h}&dpi=100`;
  if (state.view.xlim) url += `&xlim=${state.view.xlim[0]},${state.view.xlim[1]}`;
  if (state.view.ylim) url += `&ylim=${state.view.ylim[0]},${state.view.ylim[1]}`;
  if (state.playhead != null) url += `&t=${state.playhead.toFixed(4)}`;
  return url;
}
async function export3dFrames() {
  const btn = $("btn-anim3d");
  const frames = 24;
  if (btn) {
    btn.disabled = true;
    btn.classList.add("on");
  }
  setStatus("\u4E09\u7EF4\u52A8\u753B\u5BFC\u51FA\u4E2D\u2026", "busy");
  try {
    const spec = JSON.parse(JSON.stringify(state.spec));
    const base = spec.figure = spec.figure || {};
    const elev = base.elev === void 0 ? 26 : Number(base.elev);
    const azim0 = base.azim === void 0 ? -58 : Number(base.azim);
    const payload = {
      width: 900,
      height: 620,
      dpi: 100,
      frames: Array.from({ length: frames }, (_, i) => {
        const s2 = JSON.parse(JSON.stringify(spec));
        s2.figure = Object.assign({}, s2.figure, {
          elev,
          azim: azim0 + 360 * i / frames
        });
        return { spec: s2 };
      })
    };
    const res = await fetch("api/render3d/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "plotkit-3d-frames.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4e3);
    setStatus(`\u5DF2\u5BFC\u51FA ${frames} \u5E27\uFF08${(blob.size / 1048576).toFixed(1)} MB\uFF09`, "ok");
  } catch (err) {
    setStatus(`\u4E09\u7EF4\u52A8\u753B\u5BFC\u51FA\u5931\u8D25\uFF1A${err.message}`, "warn");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("on");
    }
  }
}
function showBlob(blob, { animated = false } = {}) {
  const img = $("plotImg");
  const url = URL.createObjectURL(blob);
  const prev = img.dataset.url;
  img.dataset.url = url;
  img.src = url;
  img.style.transform = "none";
  if (prev) URL.revokeObjectURL(prev);
  if (animated) state.img = null;
}
function scheduleRender(reason) {
  clearTimeout(state.pending);
  state.pending = setTimeout(() => {
    state.pending = null;
    redraw(reason).catch((err) => setStatus(`\u6E32\u67D3\u5931\u8D25\uFF1A${err.message}`, "bad"));
  }, SETTLE_MS);
}
const PREVIEW_MS = 160;
const PREVIEW_SCALE = 0.5;
let previewBusy = false;
let previewAt = 0;
let zooming = false;
let zoomTimer = null;
function schedulePreview() {
  const now = performance.now();
  if (previewBusy || state.suspended || document.hidden || !plotVisible() || now - previewAt < PREVIEW_MS) return;
  if (!state.img || !state.img.xlim || !state.img.ylim) return;
  previewAt = now;
  previewBusy = true;
  const { w, h } = plotSize();
  const pw = Math.max(240, Math.round(w * PREVIEW_SCALE));
  const ph = Math.max(160, Math.round(h * PREVIEW_SCALE));
  fetch(renderUrl(pw, ph)).then((res) => res.ok ? res.blob() : null).then((blob) => {
    previewBusy = false;
    if (!blob || !plotDrag && !zooming) return;
    showBlob(blob);
  }).catch(() => {
    previewBusy = false;
  });
}
function pushTiming(label, ms, parts) {
  const detail = parts ? Object.entries(parts).map(([k, v]) => `${k} ${v.toFixed(1)}ms`).join(" \xB7 ") : "";
  state.timings.unshift({ label, ms, detail, at: (/* @__PURE__ */ new Date()).toLocaleTimeString() });
  state.timings = state.timings.slice(0, 6);
  const box = $("timing");
  box.innerHTML = state.timings.map((t) => `<div><b>${t.ms.toFixed(1)} ms</b> ${t.label}${t.detail ? ` <span style="opacity:.7">(${t.detail})</span>` : ""}</div>`).join("");
}
$("btn-add").onclick = () => {
  const subplots = state.spec.figure.subplots || 1;
  const coords = datasetsByRole("coord");
  const series = datasetsByRole("series");
  const y = state.selected && series.some((d) => d.name === state.selected) ? state.selected : series[0] && series[0].name;
  const x = coords[0] ? coords[0].name : series[0] && series[0].name;
  if (!x || !y) {
    setStatus("\u8FD8\u6CA1\u6709\u53EF\u7528\u6570\u636E\u96C6\uFF1A\u5148\u5728 Python \u4FA7 add_data()", "bad");
    return;
  }
  state.spec.layers.push(newLayerFor(x, y, Math.min(state.spec.layers.length, subplots - 1)));
  commit("\u65B0\u589E\u56FE\u5C42");
};
let animPlaying = false;
$("btn-anim").onclick = async () => {
  if (animPlaying) {
    animPlaying = false;
    $("btn-anim").classList.remove("on");
    redraw("\u505C\u6B62\u52A8\u753B");
    return;
  }
  if (!state.spec.layers.length) {
    setStatus("\u8FD8\u6CA1\u6709\u56FE\u5C42", "bad");
    return;
  }
  if (state.animBusy) return;
  state.animBusy = true;
  $("btn-anim").disabled = true;
  setStatus("\u6B63\u5728\u751F\u6210\u52A8\u753B\u2026", "ok");
  try {
    const { w, h } = plotSize();
    const res = await fetch(`api/anim?w=${w}&h=${h}`);
    if (!res.ok) {
      setStatus(`\u52A8\u753B\u5931\u8D25 HTTP ${res.status}`, "bad");
      return;
    }
    showBlob(await res.blob(), { animated: true });
    animPlaying = true;
    $("btn-anim").classList.add("on");
    setStatus("\u64AD\u653E\u52A8\u753B\uFF08\u518D\u70B9\u4E00\u6B21\u505C\u6B62\uFF09", "ok");
  } finally {
    state.animBusy = false;
    $("btn-anim").disabled = false;
  }
};
$("btn-png").onclick = () => {
  window.open("api/png", "_blank");
  setStatus("\u5DF2\u7528 matplotlib \u5BFC\u51FA\u9759\u6001\u56FE", "good");
};
$("btn-theme").onclick = () => {
  const dark = document.body.dataset.theme !== "light";
  document.body.dataset.theme = dark ? "light" : "dark";
  state.spec.figure.theme = dark ? "default" : "netlab-dark";
  $("theme").value = state.spec.figure.theme;
  commit("\u5207\u4E3B\u9898");
};
const PANEL_MIN = 300;
const PANEL_MAX = 620;
const PANEL_KEY = "pk.panelWidth";
function applyPanelWidth(width) {
  const clamped = Math.max(PANEL_MIN, Math.min(PANEL_MAX, Math.round(width)));
  document.documentElement.style.setProperty("--panel-w", `${clamped}px`);
  return clamped;
}
(function initPanelWidth() {
  const saved = Number(localStorage.getItem(PANEL_KEY));
  applyPanelWidth(Number.isFinite(saved) && saved > 0 ? saved : 380);
})();
(function bindPanelGrip() {
  const grip = $("panel-grip");
  let dragging = false;
  let startX = 0;
  let startW = 0;
  grip.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    dragging = true;
    startX = ev.clientX;
    startW = $("panel").getBoundingClientRect().width;
    grip.setPointerCapture(ev.pointerId);
    document.body.style.cursor = "col-resize";
  });
  grip.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    applyPanelWidth(startW - (ev.clientX - startX));
    renderInsetOverlay();
    renderLayoutOverlay();
  });
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = "";
    const width = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--panel-w")) || 380;
    localStorage.setItem(PANEL_KEY, String(Math.round(width)));
    scheduleRender("\u9762\u677F\u5BBD\u5EA6");
  };
  grip.addEventListener("pointerup", stop);
  grip.addEventListener("pointercancel", stop);
  const resetPanelWidth = () => {
    localStorage.removeItem(PANEL_KEY);
    applyPanelWidth(380);
    scheduleRender("\u9762\u677F\u590D\u4F4D");
    renderInsetOverlay();
    renderLayoutOverlay();
  };
  grip.addEventListener("dblclick", resetPanelWidth);
  $("btn-panel-reset").onclick = resetPanelWidth;
})();
const LAYERWIN_KEY = "pk.layerWin";
const LAYERWIN_MIN_W = 260;
const LAYERWIN_MIN_H = 180;
const layerWinState = { popped: false, drag: null };
function layerWinWrap() {
  return document.querySelector(".plotwrap") || document.body;
}
function clampLayerWinRect(rect) {
  const wrap = layerWinWrap();
  const maxW = Math.max(LAYERWIN_MIN_W, wrap.clientWidth - 8);
  const maxH = Math.max(LAYERWIN_MIN_H, wrap.clientHeight - 8);
  const width = Math.max(LAYERWIN_MIN_W, Math.min(maxW, Math.round(rect.width)));
  const height = Math.max(LAYERWIN_MIN_H, Math.min(maxH, Math.round(rect.height)));
  const left = Math.max(0, Math.min(maxW - width, Math.round(rect.left)));
  const top = Math.max(0, Math.min(maxH - height, Math.round(rect.top)));
  return { left, top, width, height };
}
function defaultLayerWinRect() {
  const wrap = layerWinWrap();
  const width = Math.max(LAYERWIN_MIN_W, Math.min(380, Math.round(wrap.clientWidth * 0.46)));
  const height = Math.max(LAYERWIN_MIN_H, Math.min(520, Math.round(wrap.clientHeight * 0.62)));
  return { left: Math.max(8, wrap.clientWidth - width - 20), top: 12, width, height };
}
function applyLayerWinRect(rect) {
  const r = clampLayerWinRect(rect);
  const win = $("layerWin");
  win.style.left = `${r.left}px`;
  win.style.top = `${r.top}px`;
  win.style.width = `${r.width}px`;
  win.style.height = `${r.height}px`;
  return r;
}
function saveLayerWinRect() {
  const win = $("layerWin");
  const rect = {
    left: parseFloat(win.style.left) || 0,
    top: parseFloat(win.style.top) || 0,
    width: parseFloat(win.style.width) || LAYERWIN_MIN_W,
    height: parseFloat(win.style.height) || LAYERWIN_MIN_H
  };
  localStorage.setItem(LAYERWIN_KEY, JSON.stringify({ popped: layerWinState.popped, rect }));
}
function readLayerWinSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYERWIN_KEY) || "null");
    if (!saved || !saved.rect) return null;
    return saved;
  } catch (e) {
    return null;
  }
}
function popLayers() {
  if (layerWinState.popped) return;
  const sect = $("layerSect");
  if (!sect) return;
  const body = $("layerWinBody");
  if (!body.contains(sect)) {
    sect.dataset.home = "panel";
    body.appendChild(sect);
  }
  sect.open = true;
  $("layerWin").hidden = false;
  layerWinState.popped = true;
  $("btn-layer-pop").textContent = "\u56FE\u5C42\u5DF2\u6D6E\u51FA";
  const saved = readLayerWinSaved();
  applyLayerWinRect(saved && saved.rect && saved.rect.width ? saved.rect : defaultLayerWinRect());
  saveLayerWinRect();
  if (state.spec) renderLayers();
}
function dockLayers() {
  if (!layerWinState.popped) return;
  const sect = $("layerSect");
  const panel = $("panel");
  const anchor = $("insetgroup");
  if (sect && panel) panel.insertBefore(sect, anchor && anchor.parentNode === panel ? anchor : null);
  $("layerWin").hidden = true;
  layerWinState.popped = false;
  $("btn-layer-pop").textContent = "\u56FE\u5C42\u72EC\u7ACB\u7A97\u53E3";
  saveLayerWinRect();
}
(function bindLayerWindow() {
  const bar = $("layerWinBar");
  const win = $("layerWin");
  if (!bar || !win) return;
  $("btn-layer-pop").onclick = () => layerWinState.popped ? dockLayers() : popLayers();
  $("btn-layer-close").onclick = () => dockLayers();
  const startDrag = (ev, mode) => {
    if (ev.button !== void 0 && ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const rect = win.getBoundingClientRect();
    const wrap = layerWinWrap().getBoundingClientRect();
    layerWinState.drag = {
      mode,
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      left: rect.left - wrap.left,
      top: rect.top - wrap.top,
      width: rect.width,
      height: rect.height
    };
    win.classList.add("dragging");
    if (ev.target.setPointerCapture) ev.target.setPointerCapture(ev.pointerId);
  };
  bar.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest("button")) return;
    startDrag(ev, "move");
  });
  win.querySelector(".layerwin-resize").addEventListener("pointerdown", (ev) => startDrag(ev, "resize"));
  const onMove = (ev) => {
    const d = layerWinState.drag;
    if (!d || ev.pointerId !== d.pointerId) return;
    const dx = ev.clientX - d.startX;
    const dy = ev.clientY - d.startY;
    if (d.mode === "move") {
      applyLayerWinRect({ left: d.left + dx, top: d.top + dy, width: d.width, height: d.height });
    } else {
      applyLayerWinRect({ left: d.left, top: d.top, width: d.width + dx, height: d.height + dy });
    }
  };
  const onUp = (ev) => {
    const d = layerWinState.drag;
    if (!d || ev.pointerId !== void 0 && ev.pointerId !== d.pointerId) return;
    layerWinState.drag = null;
    win.classList.remove("dragging");
    saveLayerWinRect();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  window.addEventListener("resize", () => {
    if (!layerWinState.popped) return;
    const win2 = $("layerWin");
    applyLayerWinRect({
      left: parseFloat(win2.style.left) || 0,
      top: parseFloat(win2.style.top) || 0,
      width: parseFloat(win2.style.width) || LAYERWIN_MIN_W,
      height: parseFloat(win2.style.height) || LAYERWIN_MIN_H
    });
  });
  const saved = readLayerWinSaved();
  if (saved && saved.popped) {
    try {
      popLayers();
    } catch (e) {
    }
  }
})();
if (EMBED) {
  document.body.classList.add("embed");
  $("panel").classList.add("collapsed");
  $("btn-panel").textContent = "\u25C2";
}
$("btn-panel").onclick = () => {
  const panel = $("panel");
  panel.classList.toggle("collapsed");
  $("btn-panel").textContent = panel.classList.contains("collapsed") ? "\u25C2" : "\u25B8";
  setTimeout(() => redraw("\u9762\u677F\u5F00\u5408"), 200);
};
$("theme").onchange = (ev) => {
  state.spec.figure.theme = ev.target.value;
  document.body.dataset.theme = ev.target.value === "default" ? "light" : "dark";
  commit("\u5207\u4E3B\u9898");
};
$("ncols").onchange = (ev) => {
  state.spec.figure.ncols = Number(ev.target.value) || 1;
  commit("\u6539\u5217\u6570");
};
$("subplots").onchange = (ev) => {
  const n = Math.max(1, Number(ev.target.value) || 1);
  state.spec.figure.subplots = n;
  state.spec.layers.forEach((l) => {
    if ((l.subplot | 0) >= n) l.subplot = n - 1;
  });
  trimLayoutTo(n);
  commit("\u6539\u5B50\u56FE\u6570");
};
$("btn-free-layout").onclick = enableFreeLayout;
$("btn-grid-layout").onclick = disableFreeLayout;
$("linkx").onchange = (ev) => {
  state.spec.figure.link_x = ev.target.checked;
  commit("\u6539\u8054\u52A8");
};
window.addEventListener("resize", () => {
  if (state.spec && state.spec.layers.length) {
    scheduleRender("\u7A97\u53E3\u5C3A\u5BF8");
    renderInsetOverlay();
    renderLayoutOverlay();
  }
});
function insetList() {
  if (!state.spec) return [];
  state.spec.figure.insets = state.spec.figure.insets || [];
  return state.spec.figure.insets;
}
function renderInsets() {
  const group = $("insetgroup");
  const host = $("insets");
  const list = insetList();
  group.hidden = list.length === 0;
  $("insetcount").textContent = String(list.length);
  host.textContent = "";
  list.forEach((ins, index) => {
    const card = document.createElement("div");
    card.className = "layer";
    const head = document.createElement("div");
    head.className = "layer-head";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = "var(--accent)";
    const name = document.createElement("strong");
    name.textContent = `\u5185\u5D4C ${index + 1} \xB7 \u69FD ${ins.subplot}`;
    const del = document.createElement("button");
    del.className = "btn danger tiny";
    del.textContent = "\u5220\u9664";
    del.onclick = () => {
      state.spec.figure.insets = insetList().filter((x) => x !== ins);
      commit("\u5220\u9664\u5185\u5D4C\u56FE");
    };
    head.append(dot, name, del);
    card.appendChild(head);
    const grid = document.createElement("div");
    grid.className = "fields four";
    const r = ins.rect || [0.6, 0.6, 0.35, 0.35];
    [["x", 0], ["y", 1], ["\u5BBD", 2], ["\u9AD8", 3]].forEach(([label, i]) => {
      const wrap = document.createElement("label");
      wrap.className = "field";
      const span = document.createElement("span");
      span.textContent = label;
      const input = document.createElement("input");
      input.type = "number";
      input.step = "0.01";
      input.min = "0";
      input.max = "1";
      input.value = Number(r[i]).toFixed(2);
      input.onchange = () => {
        const v = Math.max(0, Math.min(1, Number(input.value) || 0));
        r[i] = v;
        ins.rect = r;
        commit("\u6539\u5185\u5D4C\u56FE\u4F4D\u7F6E");
      };
      wrap.append(span, input);
      grid.appendChild(wrap);
    });
    card.appendChild(grid);
    host.appendChild(card);
  });
}
const overlayState = { active: null };
function overlayPixels() {
  if (!state.img || !state.img.slots || !state.img.slots.length || !state.img.px) return null;
  const [W, H] = state.img.px;
  const fl = {};
  for (const { slot, box } of state.img.slots) {
    const [x0, y0, bw, bh] = box;
    const name = slot === 0 ? "xaxis" : `xaxis${slot + 1}`;
    const yname = slot === 0 ? "yaxis" : `yaxis${slot + 1}`;
    fl[name] = { domain: [x0, x0 + bw] };
    fl[yname] = { domain: [y0, y0 + bh] };
  }
  return { size: { l: 0, t: 0, w: W, h: H }, fl };
}
function axisDomainOf(fl, slot) {
  const name = slot === 0 ? "xaxis" : `xaxis${slot + 1}`;
  const yname = slot === 0 ? "yaxis" : `yaxis${slot + 1}`;
  const xa = fl[name];
  const ya = fl[yname];
  if (!xa || !ya) return null;
  return { x: xa.domain, y: ya.domain };
}
function renderInsetOverlay() {
  const overlay = $("inset-overlay");
  const list = insetList();
  const px = overlayPixels();
  overlay.textContent = "";
  overlay.hidden = list.length === 0 || !px;
  if (overlay.hidden) return;
  const { size, fl } = px;
  list.forEach((ins, index) => {
    const dom = axisDomainOf(fl, Number(ins.parent || 0));
    if (!dom) return;
    const r = ins.rect || [0.6, 0.6, 0.35, 0.35];
    const left = size.l + (dom.x[0] + r[0] * (dom.x[1] - dom.x[0])) * size.w;
    const width = r[2] * (dom.x[1] - dom.x[0]) * size.w;
    const top = size.t + (1 - (dom.y[0] + (r[1] + r[3]) * (dom.y[1] - dom.y[0]))) * size.h;
    const height = r[3] * (dom.y[1] - dom.y[0]) * size.h;
    const box = document.createElement("div");
    box.className = "inset-box";
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
    const tag = document.createElement("span");
    tag.className = "inset-tag";
    tag.textContent = `\u5185\u5D4C ${index + 1}`;
    const handle = document.createElement("span");
    handle.className = "inset-handle";
    box.append(tag, handle);
    const start = (ev, mode) => {
      ev.preventDefault();
      ev.stopPropagation();
      overlayState.active = {
        ins,
        dom,
        size,
        mode,
        x0: ev.clientX,
        y0: ev.clientY,
        rect0: [...r],
        box
      };
      box.classList.add("dragging");
      try {
        box.setPointerCapture(ev.pointerId);
      } catch {
      }
    };
    box.addEventListener("pointerdown", (ev) => start(ev, "move"));
    handle.addEventListener("pointerdown", (ev) => start(ev, "resize"));
    box.addEventListener("pointermove", (ev) => {
      const act = overlayState.active;
      if (!act || act.box !== box) return;
      const dx = (ev.clientX - act.x0) / (act.size.w * (act.dom.x[1] - act.dom.x[0]));
      const dy = (ev.clientY - act.y0) / (act.size.h * (act.dom.y[1] - act.dom.y[0]));
      const rect = [...act.rect0];
      if (act.mode === "move") {
        rect[0] = clamp01(act.rect0[0] + dx, 1 - rect[2]);
        rect[1] = clamp01(act.rect0[1] - dy, 1 - rect[3]);
      } else {
        rect[2] = clamp01(act.rect0[2] + dx, 0.05, 1 - rect[0]);
        rect[3] = clamp01(act.rect0[3] - dy, 0.05, 1 - rect[1]);
      }
      act.ins.rect = rect;
      box.style.left = `${act.size.l + (act.dom.x[0] + rect[0] * (act.dom.x[1] - act.dom.x[0])) * act.size.w}px`;
      box.style.width = `${rect[2] * (act.dom.x[1] - act.dom.x[0]) * act.size.w}px`;
      box.style.top = `${act.size.t + (1 - (act.dom.y[0] + (rect[1] + rect[3]) * (act.dom.y[1] - act.dom.y[0]))) * act.size.h}px`;
      box.style.height = `${rect[3] * (act.dom.y[1] - act.dom.y[0]) * act.size.h}px`;
    });
    const finish = () => {
      const act = overlayState.active;
      if (!act || act.box !== box) return;
      overlayState.active = null;
      box.classList.remove("dragging");
      const r2 = act.ins.rect.map((v) => Math.round(v * 1e3) / 1e3);
      act.ins.rect = r2;
      commit(act.mode === "move" ? "\u62D6\u52A8\u5185\u5D4C\u56FE" : "\u7F29\u653E\u5185\u5D4C\u56FE");
    };
    box.addEventListener("pointerup", finish);
    box.addEventListener("pointercancel", finish);
    overlay.appendChild(box);
  });
}
function clamp01(value, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, value));
}
const layoutState = { active: null };
function layoutList() {
  const fig = state.spec.figure;
  return fig && Array.isArray(fig.layout) ? fig.layout : [];
}
function gridRectFor(index, cols, rows, top = 0.95) {
  const left = 0.085;
  const right = 0.97;
  const bottom = 0.1;
  const cw = (right - left) / Math.max(1, cols);
  const ch = (top - bottom) / Math.max(1, rows);
  const row = Math.floor(index / Math.max(1, cols));
  const col = index % Math.max(1, cols);
  return [left + col * cw + cw * 0.02, top - (row + 1) * ch + ch * 0.03, cw * 0.96, ch * 0.94];
}
function enableFreeLayout() {
  const fig = state.spec.figure;
  const count = Math.max(1, Number(fig.subplots) || 1);
  const slots = state.img && state.img.slots || [];
  let layout = slots.filter((s) => Number(s.slot) < count).map((s) => ({ slot: Number(s.slot), rect: s.box.map((v) => Math.round(v * 1e3) / 1e3) }));
  if (!layout.length) {
    const cols = Math.max(1, Number(fig.ncols) || 1);
    const rows = Math.max(1, Math.ceil(count / cols));
    const top = fig.title ? 0.9 : 0.95;
    layout = Array.from({ length: count }, (_, i) => ({ slot: i, rect: gridRectFor(i, cols, rows, top) }));
  }
  fig.layout = layout;
  fig.subplots = Math.max(count, ...layout.map((it) => Number(it.slot) + 1));
  commit("\u542F\u7528\u81EA\u7531\u5E03\u5C40");
}
function disableFreeLayout() {
  if (!state.spec.figure) return;
  delete state.spec.figure.layout;
  commit("\u56DE\u5230\u7F51\u683C\u5E03\u5C40");
}
function trimLayoutTo(count) {
  const layout = layoutList();
  if (!layout.length) return;
  state.spec.figure.layout = layout.filter((it) => Number(it.slot) < count);
}
const NOTE_TOOLS = { text: "\u6587\u5B57\u6846", arrow: "\u7BAD\u5934", region: "\u6846\u9009", mark: "\u6570\u636E\u6807\u6CE8" };
const NOTE_DEFAULT_COLOR = "#0f766e";
const noteState = { tool: null, selected: null, drag: null };
function noteList() {
  const fig = state.spec && state.spec.figure;
  return fig && Array.isArray(fig.notes) ? fig.notes : [];
}
function noteImageRect() {
  const img = $("plotImg");
  if (!state.img || !img || !state.img.px) return null;
  const r = img.getBoundingClientRect();
  return r.width && r.height ? r : null;
}
function setNoteTool(tool) {
  noteState.tool = noteState.tool === tool ? null : tool;
  for (const key of Object.keys(NOTE_TOOLS)) {
    const btn = $(`btn-note-${key}`);
    if (btn) btn.classList.toggle("on", noteState.tool === key);
  }
  const hint = $("noteHint");
  if (hint) hint.hidden = !noteState.tool;
  const overlay = $("note-overlay");
  if (overlay) overlay.classList.toggle("armed", Boolean(noteState.tool));
  if (noteState.tool) setStatus(`\u6279\u6CE8\u5DE5\u5177\uFF1A${NOTE_TOOLS[noteState.tool]}\uFF08Esc \u53D6\u6D88\uFF09`, "info");
  renderNoteOverlay();
  redraw("\u6279\u6CE8\u5DE5\u5177").catch((err) => console.warn("\u6279\u6CE8\u5DE5\u5177\u91CD\u7ED8\u5931\u8D25", err));
}
function notePoint(ev) {
  const r = noteImageRect();
  if (!r) return null;
  return {
    x: clamp01((ev.clientX - r.left) / r.width),
    y: clamp01(1 - (ev.clientY - r.top) / r.height),
    w: r.width,
    h: r.height
  };
}
function addNote(note) {
  const fig = state.spec.figure;
  const list = noteList().slice();
  const item = {
    id: `n${Math.random().toString(36).slice(2, 10)}`,
    color: NOTE_DEFAULT_COLOR,
    size: 11,
    text: "",
    ...note
  };
  list.push(item);
  fig.notes = list;
  noteState.selected = list.length - 1;
  commit("\u6DFB\u52A0\u6279\u6CE8");
  return item;
}
function deleteSelectedNote() {
  const index = noteState.selected;
  const list = noteList();
  if (index == null || index < 0 || index >= list.length) return;
  const next = list.slice();
  next.splice(index, 1);
  const fig = state.spec.figure;
  if (next.length) fig.notes = next;
  else delete fig.notes;
  noteState.selected = null;
  commit("\u5220\u9664\u6279\u6CE8");
}
function editNoteText(index) {
  const note = noteList()[index];
  if (!note) return;
  const value = window.prompt("\u6279\u6CE8\u6587\u5B57", note.text || "");
  if (value == null) return;
  note.text = value;
  commit("\u4FEE\u6539\u6279\u6CE8");
}
function renderNoteOverlay() {
  const overlay = $("note-overlay");
  if (!overlay) return;
  const notes = noteList();
  const r = noteImageRect();
  overlay.textContent = "";
  if (!r || !notes.length && !noteState.tool) {
    overlay.hidden = true;
    return;
  }
  const wrap = overlay.parentElement.getBoundingClientRect();
  overlay.hidden = false;
  overlay.style.left = `${r.left - wrap.left}px`;
  overlay.style.top = `${r.top - wrap.top}px`;
  overlay.style.width = `${r.width}px`;
  overlay.style.height = `${r.height}px`;
  const W = r.width;
  const H = r.height;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "note-svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const defs = document.createElementNS(ns, "defs");
  defs.innerHTML = '<marker id="note-arrow-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/></marker>';
  svg.appendChild(defs);
  overlay.appendChild(svg);
  notes.forEach((note, index) => {
    const active = noteState.selected === index;
    const color = note.color || NOTE_DEFAULT_COLOR;
    const tag = (el) => {
      el.dataset.note = String(index);
      el.style.setProperty("--note-color", color);
      el.classList.toggle("on", active);
      return el;
    };
    if (note.kind === "arrow") {
      const start = note.start || [0.2, 0.2];
      const end = note.end || [0.4, 0.4];
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", String(start[0] * W));
      line.setAttribute("y1", String((1 - start[1]) * H));
      line.setAttribute("x2", String(end[0] * W));
      line.setAttribute("y2", String((1 - end[1]) * H));
      line.setAttribute("stroke", "currentColor");
      line.setAttribute("stroke-width", active ? "2.6" : "1.6");
      line.setAttribute("marker-end", "url(#note-arrow-head)");
      line.setAttribute("class", "note-arrow");
      line.style.color = color;
      line.dataset.note = String(index);
      svg.appendChild(line);
      if (note.text) {
        const label = document.createElement("div");
        label.className = "note-item note-label";
        label.style.left = `${end[0] * W}px`;
        label.style.top = `${(1 - end[1]) * H}px`;
        label.textContent = note.text;
        overlay.appendChild(tag(label));
      }
      return;
    }
    const box = document.createElement("div");
    if (note.kind === "region") {
      const [x, y, w, h] = note.rect || [0.3, 0.3, 0.3, 0.2];
      box.className = "note-item note-region";
      box.style.left = `${x * W}px`;
      box.style.top = `${(1 - (y + h)) * H}px`;
      box.style.width = `${w * W}px`;
      box.style.height = `${h * H}px`;
      box.textContent = note.text || "";
    } else {
      const pos = note.pos || [0.5, 0.5];
      box.className = note.kind === "mark" ? "note-item note-mark" : "note-item note-text";
      box.style.left = `${pos[0] * W}px`;
      box.style.top = `${(1 - pos[1]) * H}px`;
      box.textContent = note.text || (note.kind === "mark" ? "\u6807\u6CE8" : "\uFF08\u7A7A\u6279\u6CE8\uFF09");
    }
    overlay.appendChild(tag(box));
  });
}
function bindNoteOverlay() {
  const overlay = $("note-overlay");
  if (!overlay) return;
  for (const key of Object.keys(NOTE_TOOLS)) {
    const btn = $(`btn-note-${key}`);
    if (btn) btn.onclick = () => setNoteTool(key);
  }
  const del = $("btn-note-del");
  if (del) del.onclick = deleteSelectedNote;
  overlay.addEventListener("pointerdown", (ev) => {
    const p = notePoint(ev);
    if (!p) return;
    const hit = ev.target.closest("[data-note]");
    if (hit && !noteState.tool) {
      const index = Number(hit.dataset.note);
      noteState.selected = index;
      const note = noteList()[index];
      if (!note) return;
      ev.preventDefault();
      noteState.drag = {
        index,
        x0: ev.clientX,
        y0: ev.clientY,
        origin: JSON.parse(JSON.stringify(note)),
        moved: false
      };
      try {
        overlay.setPointerCapture(ev.pointerId);
      } catch {
      }
      renderNoteOverlay();
      return;
    }
    if (!noteState.tool) {
      noteState.selected = null;
      renderNoteOverlay();
      return;
    }
    ev.preventDefault();
    noteState.drag = { create: noteState.tool, x0: ev.clientX, y0: ev.clientY, p0: p, moved: false };
    try {
      overlay.setPointerCapture(ev.pointerId);
    } catch {
    }
  });
  overlay.addEventListener("pointermove", (ev) => {
    const act = noteState.drag;
    if (!act) return;
    const dx = ev.clientX - act.x0;
    const dy = ev.clientY - act.y0;
    if (Math.abs(dx) + Math.abs(dy) > 3) act.moved = true;
    if (act.origin) {
      const r = noteImageRect();
      if (!r) return;
      const note = noteList()[act.index];
      if (!note) return;
      const fx = dx / r.width;
      const fy = -dy / r.height;
      if (note.kind === "arrow") {
        note.start = act.origin.start.map((v, i) => clamp01(v + (i === 0 ? fx : fy)));
        note.end = act.origin.end.map((v, i) => clamp01(v + (i === 0 ? fx : fy)));
      } else {
        const pos = act.origin.pos || [act.origin.rect[0], act.origin.rect[1]];
        const moved = [clamp01(pos[0] + fx), clamp01(pos[1] + fy)];
        if (note.kind === "region") note.rect = [moved[0], moved[1], act.origin.rect[2], act.origin.rect[3]];
        else note.pos = moved;
      }
      renderNoteOverlay();
      return;
    }
    if (act.create === "region" || act.create === "arrow") {
      const p = notePoint(ev);
      if (!p) return;
      const x0 = Math.min(act.p0.x, p.x);
      const y0 = Math.min(act.p0.y, p.y);
      const w = Math.abs(p.x - act.p0.x);
      const h = Math.abs(p.y - act.p0.y);
      const preview = $("note-preview") || (() => {
        const el = document.createElement("div");
        el.id = "note-preview";
        el.className = "note-item note-preview";
        overlay.appendChild(el);
        return el;
      })();
      preview.style.left = `${x0 * p.w}px`;
      preview.style.top = `${(1 - (y0 + h)) * p.h}px`;
      preview.style.width = `${Math.max(w * p.w, 1)}px`;
      preview.style.height = `${Math.max(h * p.h, 1)}px`;
    }
  });
  const finish = (ev) => {
    const act = noteState.drag;
    noteState.drag = null;
    const preview = $("note-preview");
    if (preview) preview.remove();
    if (!act) return;
    if (act.origin) {
      if (act.moved) {
        const note = noteList()[act.index];
        if (note && note.pos) note.pos = note.pos.map((v) => Math.round(v * 1e3) / 1e3);
        if (note && note.rect) note.rect = note.rect.map((v) => Math.round(v * 1e3) / 1e3);
        commit("\u79FB\u52A8\u6279\u6CE8");
      }
      return;
    }
    const p = notePoint(ev) || act.p0;
    const kind = act.create;
    if (kind === "text") {
      const value = window.prompt("\u6279\u6CE8\u6587\u5B57", "\u7B14\u8BB0");
      if (value == null) return;
      addNote({ kind: "text", pos: [p.x, p.y], text: value });
    } else if (kind === "arrow") {
      if (!act.moved) return;
      addNote({
        kind: "arrow",
        start: [act.p0.x, act.p0.y],
        end: [p.x, p.y],
        text: ""
      });
    } else if (kind === "region") {
      const x = Math.min(act.p0.x, p.x);
      const y = Math.min(act.p0.y, p.y);
      const w = Math.abs(p.x - act.p0.x);
      const h = Math.abs(p.y - act.p0.y);
      if (w < 0.02 || h < 0.02) return;
      addNote({ kind: "region", rect: [x, y, w, h], text: "" });
    } else if (kind === "mark") {
      const hit = axesFraction(ev);
      if (!hit || !hit.inside || !state.img || !state.img.xlim || !state.img.ylim) {
        toast("\u8BF7\u5728\u5750\u6807\u8F74\u5185\u70B9\u6570\u636E\u70B9\u9644\u8FD1", "warn", 2400);
        return;
      }
      const [x0, x1] = state.img.xlim;
      const [y0, y1] = state.img.ylim;
      const x = x0 + hit.fx * (x1 - x0);
      const y = y0 + hit.fy * (y1 - y0);
      const value = window.prompt("\u6570\u636E\u6807\u6CE8\u6587\u5B57", `(${x.toPrecision(4)}, ${y.toPrecision(4)})`);
      if (value == null) return;
      addNote({ kind: "mark", subplot: 0, x, y, pos: [p.x, p.y], text: value });
    }
  };
  overlay.addEventListener("pointerup", finish);
  overlay.addEventListener("pointercancel", finish);
  overlay.addEventListener("dblclick", (ev) => {
    const hit = ev.target.closest("[data-note]");
    if (!hit) return;
    editNoteText(Number(hit.dataset.note));
  });
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && noteState.tool) {
      setNoteTool(noteState.tool);
      return;
    }
    if (ev.key !== "Delete" && ev.key !== "Backspace") return;
    const tag = document.activeElement && document.activeElement.tagName || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (noteState.selected == null) return;
    ev.preventDefault();
    deleteSelectedNote();
  });
}
bindNoteOverlay();
function renderLayoutOverlay() {
  renderNoteOverlay();
  const overlay = $("layout-overlay");
  if (!overlay) return;
  const layout = layoutList();
  const px = overlayPixels();
  overlay.textContent = "";
  const hint = $("layoutHint");
  if (hint) hint.hidden = layout.length === 0;
  overlay.hidden = layout.length === 0 || !px;
  if (overlay.hidden) return;
  const { size } = px;
  layout.forEach((item) => {
    const box = document.createElement("div");
    box.className = "layout-box";
    const place = () => {
      const r = item.rect || [0, 0, 0.5, 0.5];
      box.style.left = `${r[0] * size.w}px`;
      box.style.top = `${(1 - (r[1] + r[3])) * size.h}px`;
      box.style.width = `${r[2] * size.w}px`;
      box.style.height = `${r[3] * size.h}px`;
    };
    place();
    const tag = document.createElement("span");
    tag.className = "inset-tag";
    tag.textContent = `\u69FD ${item.slot}`;
    const handle = document.createElement("span");
    handle.className = "inset-handle";
    box.append(tag, handle);
    const start = (ev, mode) => {
      ev.preventDefault();
      ev.stopPropagation();
      const rect0 = [...item.rect || [0, 0, 0.5, 0.5]];
      layoutState.active = { item, rect0, size, mode, x0: ev.clientX, y0: ev.clientY, box };
      box.classList.add("dragging");
      try {
        box.setPointerCapture(ev.pointerId);
      } catch {
      }
    };
    box.addEventListener("pointerdown", (ev) => start(ev, "move"));
    handle.addEventListener("pointerdown", (ev) => start(ev, "resize"));
    box.addEventListener("pointermove", (ev) => {
      const act = layoutState.active;
      if (!act || act.box !== box) return;
      const dx = (ev.clientX - act.x0) / act.size.w;
      const dy = (ev.clientY - act.y0) / act.size.h;
      const rect = [...act.rect0];
      if (act.mode === "move") {
        rect[0] = clamp01(act.rect0[0] + dx, 0, 1 - rect[2]);
        rect[1] = clamp01(act.rect0[1] - dy, 0, 1 - rect[3]);
      } else {
        rect[2] = clamp01(act.rect0[2] + dx, 0.05, 1 - rect[0]);
        rect[3] = clamp01(act.rect0[3] - dy, 0.05, 1 - rect[1]);
      }
      item.rect = rect;
      place();
    });
    const finish = () => {
      const act = layoutState.active;
      if (!act || act.box !== box) return;
      layoutState.active = null;
      box.classList.remove("dragging");
      item.rect = item.rect.map((v) => Math.round(v * 1e3) / 1e3);
      commit(act.mode === "move" ? "\u62D6\u62FD\u5B50\u56FE" : "\u7F29\u653E\u5B50\u56FE");
    };
    box.addEventListener("pointerup", finish);
    box.addEventListener("pointercancel", finish);
    overlay.appendChild(box);
  });
}
function fmtTime(value) {
  return value == null ? "\u5B9E\u65F6" : `${value.toFixed(2)} s`;
}
async function refreshTimeInfo() {
  try {
    const meta = await api("api/meta");
    state.meta = meta;
    state.time = meta.time || { min: null, max: null, count: 0 };
    syncPlayheadUI();
  } catch (err) {
  }
}
function playStep() {
  const { min, max } = state.time;
  const n = Math.max(1, (state.time.count || 1) - 1);
  if (min == null || max == null || max <= min) return 0;
  return (max - min) / n;
}
function syncPlayheadUI() {
  const slider = $("playhead");
  const { min, max } = state.time;
  if (min != null && max != null && max > min) {
    slider.min = min;
    slider.max = max;
    slider.step = ((max - min) / 1e3).toPrecision(2);
    slider.value = state.playhead == null ? max : Math.min(Math.max(state.playhead, min), max);
    slider.disabled = false;
  } else {
    slider.disabled = true;
  }
  $("playTime").textContent = state.playhead == null ? "\u5B9E\u65F6" : fmtTime(state.playhead);
  $("btn-play").textContent = state.playing ? "\u23F8" : "\u25B6";
  $("playSpeedVal").textContent = `${state.playSpeed}/s`;
  $("playStatus").textContent = state.playhead == null ? "" : `\u5386\u53F2 ${fmtTime(state.playhead)}`;
  const windowSec = state.spec && state.spec.figure && state.spec.figure.window || null;
  if (document.activeElement !== $("winSec")) $("winSec").value = windowSec || "";
}
function replayRender(reason) {
  if (clientRenderable(state.spec) && !layoutList().length && !noteList().length && !noteState.tool) {
    renderClient(reason || "\u56DE\u653E").catch(() => redraw("\u56DE\u653E"));
    return;
  }
  redraw(reason || "\u56DE\u653E");
}
function setPlayhead(value) {
  state.playhead = value;
  syncPlayheadUI();
  replayRender("\u56DE\u653E");
}
function stopPlaying() {
  state.playing = false;
  if (state.playTimer) clearTimeout(state.playTimer);
  state.playTimer = null;
  syncPlayheadUI();
}
function tickPlay() {
  if (!state.playing) return;
  const { min, max } = state.time;
  const now = performance.now();
  const dt = Math.min(0.5, (now - (state.playClock || now)) / 1e3);
  state.playClock = now;
  if (!state.busy) {
    const base = state.playhead == null ? min : state.playhead;
    let next = base + playStep() * state.playSpeed * dt;
    if (max != null && next >= max) {
      if (state.playLoop) next = min;
      else {
        state.playhead = max;
        syncPlayheadUI();
        replayRender("\u56DE\u653E");
        stopPlaying();
        return;
      }
    }
    state.playhead = next;
    syncPlayheadUI();
    replayRender("\u56DE\u653E");
  }
  state.playTimer = setTimeout(tickPlay, 1e3 / Math.max(5, state.playSpeed));
}
function startPlaying() {
  if (state.playing) return;
  if (state.playhead == null) state.playhead = state.time.min;
  state.playing = true;
  state.playClock = performance.now();
  syncPlayheadUI();
  state.playTimer = setTimeout(tickPlay, 0);
}
function bindPlayback() {
  $("playhead").oninput = (e) => {
    const value = parseFloat(e.target.value);
    stopPlaying();
    setPlayhead(value);
  };
  $("btn-play").onclick = () => {
    if (state.playing) stopPlaying();
    else startPlaying();
  };
  $("playSpeed").oninput = (e) => {
    state.playSpeed = parseInt(e.target.value, 10) || 60;
    syncPlayheadUI();
  };
  $("playLoop").onchange = (e) => {
    state.playLoop = e.target.checked;
  };
  $("btn-live").onclick = () => {
    stopPlaying();
    state.playhead = null;
    syncPlayheadUI();
    redraw("\u56DE\u5230\u5B9E\u65F6");
  };
  let winTimer = null;
  $("winSec").oninput = (e) => {
    const raw = e.target.value.trim();
    const value = raw === "" ? null : Math.max(0.05, parseFloat(raw) || 0);
    if (winTimer) clearTimeout(winTimer);
    winTimer = setTimeout(() => {
      state.spec.figure.window = value;
      commit("\u65F6\u95F4\u7A97");
    }, 350);
  };
  $("btn-clear").onclick = async () => {
    stopPlaying();
    try {
      await api("api/clear", { method: "POST" });
      state.playhead = null;
      await refreshCatalog();
      await redraw("\u6E05\u7A7A\u8F68\u8FF9");
      setStatus("\u5DF2\u6E05\u7A7A\u8F68\u8FF9", "good");
    } catch (err) {
      setStatus(`\u6E05\u7A7A\u5931\u8D25\uFF1A${err.message}`, "bad");
    }
  };
}
function bindDatasetSearch() {
  $("dsSearch").oninput = () => renderDatasets();
  $("dsAdd").onclick = () => addFilteredLayers();
}
function initPlayback(meta) {
  state.time = meta && meta.time || state.time;
  bindPlayback();
  bindDatasetSearch();
  syncPlayheadUI();
}
async function refreshCatalog() {
  const catalog = await api("api/datasets");
  state.catalog = catalog;
  state.catalogKey = catalog.datasets.map((d) => `${d.name}:${d.version}:${d.length}`).join("|");
  renderDatasets();
}
window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "plotkit-visibility") return;
  const visible = Boolean(data.visible);
  if (state.suspended === !visible) return;
  state.suspended = !visible;
  if (visible) scheduleLiveRedraw("\u91CD\u65B0\u53EF\u89C1");
});
function plotVisible() {
  const el = $("plot");
  return !!el && el.offsetParent !== null && el.clientWidth > 0;
}
const LIVE_MIN_MS = 1e3;
let liveAt = 0;
let liveTimer = null;
function scheduleLiveRedraw(reason) {
  if (liveTimer) return;
  const wait = Math.max(0, LIVE_MIN_MS - (performance.now() - liveAt));
  liveTimer = setTimeout(() => {
    liveTimer = null;
    if (state.busy || state.suspended || document.hidden || !plotVisible()) return;
    liveAt = performance.now();
    redraw(reason).catch((err) => setStatus(`\u6E32\u67D3\u5931\u8D25\uFF1A${err.message}`, "bad"));
  }, wait);
}
let polling = false;
async function poll() {
  if (state.busy || state.suspended || document.hidden || !state.spec || !plotVisible()) return;
  try {
    if (!state.spec.layers.length) {
      const spec = await api("api/spec");
      if ((spec.layers || []).length) {
        state.spec = spec;
        renderLayoutControls();
        renderLayers();
        renderInsets();
        refreshTimeInfo();
        scheduleLiveRedraw("\u56FE\u5C42\u51FA\u73B0");
        return;
      }
      return;
    }
    const catalog = await api("api/datasets");
    const key = catalog.datasets.map((d) => `${d.name}:${d.version}:${d.length}`).join("|");
    if (key !== state.catalogKey) {
      state.catalogKey = key;
      state.catalog = catalog;
      renderDatasets();
      await refreshTimeInfo();
      scheduleLiveRedraw("\u5B9E\u65F6\u66F4\u65B0");
    }
  } catch (err) {
    setStatus(`\u5B9E\u65F6\u66F4\u65B0\u5931\u8D25\uFF1A${err.message}`, "bad");
  }
}
function startPolling(intervalMs) {
  if (polling) return;
  polling = true;
  setInterval(() => {
    poll();
  }, intervalMs || 1e3);
}
function applyLayout(layout) {
  state.layout = Object.assign({ panelWidth: 380, sections: {}, expanded: [], groups: [] }, layout || {});
  if (!Array.isArray(state.layout.groups)) state.layout.groups = [];
  if (!Array.isArray(state.layout.expanded)) state.layout.expanded = [];
  state.expanded = new Set(state.layout.expanded);
  applyPanelWidth(state.layout.panelWidth || 380);
  Object.entries(state.layout.sections || {}).forEach(([id, open]) => {
    const el = $(id);
    if (el && el.tagName === "DETAILS") el.open = Boolean(open);
  });
}
function syncLayoutExpanded() {
  state.layout.expanded = Array.from(state.expanded);
  scheduleLayoutSave();
}
function scheduleLayoutSave() {
  clearTimeout(state.layoutTimer);
  state.layoutTimer = setTimeout(saveLayoutNow, 400);
}
async function saveLayoutNow() {
  const width = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--panel-w")) || 380;
  state.layout.panelWidth = Math.round(width);
  const sections = {};
  document.querySelectorAll("#panel > details[id]").forEach((el) => {
    sections[el.id] = el.open;
  });
  state.layout.sections = sections;
  state.layout.expanded = Array.from(state.expanded);
  try {
    await api("api/layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.layout)
    });
  } catch (err) {
    setStatus(`\u5E03\u5C40\u672A\u4FDD\u5B58\uFF1A${err.message}`, "bad");
  }
}
async function restoreSnapshot(snapshot, reason) {
  state.spec = JSON.parse(snapshot);
  state.committed = snapshot;
  renderLayoutControls();
  renderDatasets();
  renderLayers();
  renderInsets();
  await commit(reason, { record: false });
}
async function undo() {
  if (!state.undo.length) {
    setStatus("\u6CA1\u6709\u53EF\u64A4\u9500\u7684\u64CD\u4F5C", "bad");
    return;
  }
  state.redo.push(state.committed);
  await restoreSnapshot(state.undo.pop(), "\u64A4\u9500");
}
async function redo() {
  if (!state.redo.length) {
    setStatus("\u6CA1\u6709\u53EF\u91CD\u505A\u7684\u64CD\u4F5C", "bad");
    return;
  }
  state.undo.push(state.committed);
  await restoreSnapshot(state.redo.pop(), "\u91CD\u505A");
}
const MENUS = {
  file: {
    title: "\u6587\u4EF6",
    items: [
      { id: "save-spec", label: "\u4FDD\u5B58 spec.json", kbd: "Ctrl+S", run: () => downloadText("spec.json", JSON.stringify(state.spec, null, 2)) },
      { id: "png", label: "\u5BFC\u51FA PNG\uFF08matplotlib\uFF09", kbd: "Ctrl+E", run: () => exportPng() },
      { sep: true },
      { id: "reload", label: "\u91CD\u65B0\u8F7D\u5165\u670D\u52A1\u7AEF spec", run: () => location.reload() }
    ]
  },
  edit: {
    title: "\u7F16\u8F91",
    items: [
      { id: "undo", label: "\u64A4\u9500", kbd: "Ctrl+Z", run: () => undo() },
      { id: "redo", label: "\u91CD\u505A", kbd: "Ctrl+Y", run: () => redo() },
      { sep: true },
      { id: "dup", label: "\u590D\u5236\u9009\u4E2D\u56FE\u5C42", kbd: "Ctrl+D", run: () => duplicateSelected() },
      { id: "del", label: "\u5220\u9664\u9009\u4E2D\u56FE\u5C42", kbd: "Delete", run: () => deleteSelected() }
    ]
  },
  insert: {
    title: "\u63D2\u5165",
    items: [
      { id: "layer", label: "\u65B0\u5EFA\u56FE\u5C42", run: () => addLayer() },
      { id: "group", label: "\u65B0\u5EFA\u5206\u7EC4", run: () => createGroup() },
      { id: "inset", label: "\u5728\u5B50\u56FE 0 \u52A0\u5185\u5D4C\u56FE", run: () => addInset() }
    ]
  },
  view: {
    title: "\u89C6\u56FE",
    items: [
      { id: "panel", label: "\u6536\u8D77/\u5C55\u5F00\u53F3\u4FA7\u9762\u677F", run: () => $("btn-panel").click() },
      { id: "theme", label: "\u5207\u6362\u6DF1\u6D45\u8272", run: () => $("btn-theme").click() },
      { sep: true },
      { id: "sections", label: "\u5C55\u5F00\u5168\u90E8\u9762\u677F\u5206\u7EC4", run: () => setAllSections(true) },
      { id: "collapse", label: "\u6536\u8D77\u6570\u636E\u96C6/\u5185\u5D4C\u56FE", run: () => setAllSections(false) }
    ]
  }
};
let openPop = null;
function renderMenus() {
  const bar = $("menubar");
  bar.innerHTML = "";
  Object.entries(MENUS).forEach(([id, menu]) => {
    const btn = document.createElement("button");
    btn.className = "menu";
    btn.textContent = menu.title;
    btn.dataset.menu = id;
    btn.onclick = (ev) => {
      ev.stopPropagation();
      if (openPop && openPop.dataset.menu === id) {
        closeMenus();
        return;
      }
      const rect = btn.getBoundingClientRect();
      openMenuAt(id, rect.left, rect.bottom + 4);
    };
    bar.appendChild(btn);
  });
}
function openMenuAt(id, x, y) {
  closeMenus();
  const menu = MENUS[id];
  if (!menu) return;
  const pop = document.createElement("div");
  pop.className = "menu-pop";
  pop.dataset.menu = id;
  menu.items.forEach((item) => {
    if (item.sep) {
      const sep = document.createElement("div");
      sep.className = "sep";
      pop.appendChild(sep);
      return;
    }
    const btn = document.createElement("button");
    btn.innerHTML = `<span>${item.label}</span>${item.kbd ? `<span class="kbd">${item.kbd}</span>` : ""}`;
    btn.onclick = (ev) => {
      ev.stopPropagation();
      closeMenus();
      try {
        item.run();
      } catch (err) {
        setStatus(`\u64CD\u4F5C\u5931\u8D25\uFF1A${err.message}`, "bad");
      }
    };
    pop.appendChild(btn);
  });
  pop.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
  pop.style.top = `${Math.min(y, window.innerHeight - 24 - menu.items.length * 30)}px`;
  document.body.appendChild(pop);
  openPop = pop;
  document.querySelectorAll(".menubar .menu").forEach((b) => b.classList.toggle("open", b.dataset.menu === id));
}
function closeMenus() {
  if (openPop) {
    openPop.remove();
    openPop = null;
  }
  document.querySelectorAll(".menubar .menu").forEach((b) => b.classList.remove("open"));
}
function setAllSections(open) {
  document.querySelectorAll("#panel > details").forEach((el) => {
    el.open = open && (el.id !== "insetgroup" || !el.hidden);
  });
  scheduleLayoutSave();
}
function downloadText(name, text) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1e3);
}
function duplicateSelected() {
  const layer = state.spec.layers.find((l) => l.id === state.selectedLayer);
  if (!layer) {
    setStatus("\u5148\u70B9\u4E00\u4E2A\u56FE\u5C42\u9009\u4E2D\u5B83", "bad");
    return;
  }
  const copy = JSON.parse(JSON.stringify(layer));
  copy.id = `l${Math.random().toString(16).slice(2, 10)}`;
  const at = state.spec.layers.indexOf(layer);
  state.spec.layers.splice(at + 1, 0, copy);
  state.selectedLayer = copy.id;
  commit("\u590D\u5236\u56FE\u5C42");
}
function deleteSelected() {
  const idx = state.spec.layers.findIndex((l) => l.id === state.selectedLayer);
  if (idx < 0) {
    setStatus("\u5148\u70B9\u4E00\u4E2A\u56FE\u5C42\u9009\u4E2D\u5B83", "bad");
    return;
  }
  state.spec.layers.splice(idx, 1);
  state.selectedLayer = null;
  commit("\u5220\u56FE\u5C42");
}
function createGroup() {
  const name = `\u5206\u7EC4 ${(state.layout.groups || []).length + 1}`;
  state.layout.groups.push({ id: `g${Date.now().toString(16)}`, name, open: true, layerIds: [] });
  renderLayers();
  scheduleLayoutSave();
  setStatus(`\u5DF2\u5EFA\u5206\u7EC4\u300C${name}\u300D\uFF0C\u628A\u56FE\u5C42\u62D6\u5230\u5206\u7EC4\u6807\u9898\u4E0A\u5373\u53EF\u5F52\u7EC4`, "good");
}
function addInset() {
  const spec = state.spec;
  spec.figure.insets = spec.figure.insets || [];
  const nextSlot = spec.layers.length ? Math.max(...spec.layers.map((l) => l.subplot)) + 1 : 1;
  spec.figure.subplots = Math.max(spec.figure.subplots || 1, nextSlot + 1);
  spec.figure.insets.push({
    id: `i${Math.random().toString(16).slice(2, 8)}`,
    subplot: nextSlot,
    parent: 0,
    rect: [0.62, 0.62, 0.34, 0.32],
    view: {},
    fonts: {}
  });
  commit("\u52A0\u5185\u5D4C\u56FE");
}
function addLayer() {
  const series = datasetsByRole("series")[0] || datasetsByRole("auto")[0] || state.catalog.datasets[0];
  const coord = datasetsByRole("coord")[0] || state.catalog.datasets[0];
  if (!series || !coord) {
    setStatus("\u6CA1\u6709\u53EF\u7528\u6570\u636E\u96C6\uFF0C\u5148\u5728 Python \u4FA7 add_data()", "bad");
    return;
  }
  state.spec.layers.push({
    id: `l${Math.random().toString(16).slice(2, 10)}`,
    kind: "line",
    subplot: 0,
    data: { x: coord.name, y: series.name },
    label: null,
    legend: true,
    style: { color: null, width: 1.6, dash: "solid", mode: "lines", opacity: 1, marker: { symbol: "circle", size: 7 } },
    view: {},
    annotations: []
  });
  commit("\u65B0\u5EFA\u56FE\u5C42");
}
async function exportPng() {
  const res = await fetch("api/png");
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "plot.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1e3);
}
function bindShortcuts() {
  window.addEventListener("keydown", (ev) => {
    const key = ev.key.toLowerCase();
    const mod = ev.ctrlKey || ev.metaKey;
    if (ev.key === "Escape") {
      closeMenus();
      return;
    }
    if (mod && key === "z") {
      ev.preventDefault();
      if (ev.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && key === "y") {
      ev.preventDefault();
      redo();
      return;
    }
    if (mod && key === "d") {
      ev.preventDefault();
      duplicateSelected();
      return;
    }
    if (mod && key === "s") {
      ev.preventDefault();
      downloadText("spec.json", JSON.stringify(state.spec, null, 2));
      return;
    }
    if (mod && key === "e") {
      ev.preventDefault();
      exportPng().catch((e) => setStatus(`\u5BFC\u51FA\u5931\u8D25\uFF1A${e.message}`, "bad"));
      return;
    }
    if ((ev.key === "Delete" || ev.key === "Backspace") && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      ev.preventDefault();
      deleteSelected();
    }
  });
}
document.addEventListener("click", () => closeMenus());
document.addEventListener("click", (ev) => {
  if (ev.target.closest("#panel > details")) setTimeout(scheduleLayoutSave, 0);
}, true);
startPolling(1e3);
const view3d = { view: null, on: false };
async function load3dLayers() {
  const out = [];
  let colorIndex = 0;
  let seen = 0;
  for (const layer of state.spec.layers || []) {
    const data = layer.data || {};
    if (layer.kind === "volume" && data.values && data.x && data.y && data.z) {
      try {
        const lv = layer.style && (layer.style.level || layer.style.iso) || "";
        const res = await fetch(`api/volume?x=${encodeURIComponent(data.x)}&y=${encodeURIComponent(data.y)}&z=${encodeURIComponent(data.z)}&values=${encodeURIComponent(data.values)}&stride=1&mode=surface${lv !== "" ? `&level=${lv}` : ""}`);
        if (res.ok && view3d.view) {
          const m = PK3D.parseMesh(await res.arrayBuffer());
          out.push({
            mode: "mesh",
            positions: m.positions,
            normals: m.normals,
            indices: m.indices,
            color: [0.58, 0.66, 1, 0.42],
            opacity: 0.42,
            meta: m.meta,
            label: "volume"
          });
          setStatus(`\u7B49\u503C\u9762 ${m.meta.nvert} \u9876\u70B9 / ${m.meta.ntri} \u4E09\u89D2`, "ok");
        } else {
          setStatus("\u4F53\u79EF\u573A\u52A0\u8F7D\u5931\u8D25", "warn");
        }
      } catch (err) {
        setStatus(`\u4F53\u79EF\u573A\u52A0\u8F7D\u5931\u8D25\uFF1A${err.message}`, "warn");
      }
      continue;
    }
    if (layer.kind === "segments" && data.x && data.y && data.z) {
      try {
        const res = await fetch(`api/segments?x=${encodeURIComponent(data.x)}&y=${encodeURIComponent(data.y)}&z=${encodeURIComponent(data.z)}&stride=1`);
        if (res.ok) {
          const sg = PK3D.parseParticles(await res.arrayBuffer());
          const col = layer.style && layer.style.color || [0.55, 0.75, 1];
          out.push({
            mode: "segments",
            positions: sg.xyz,
            color: [col[0], col[1], col[2], 1],
            opacity: 1,
            meta: sg.meta,
            label: "segments"
          });
          setStatus(`\u6D41\u7EBF\u6BB5 ${Math.round(sg.xyz.length / 6)} \u6BB5`, "ok");
        } else {
          setStatus("\u6D41\u7EBF\u52A0\u8F7D\u5931\u8D25", "warn");
        }
      } catch (err) {
        setStatus(`\u6D41\u7EBF\u52A0\u8F7D\u5931\u8D25\uFF1A${err.message}`, "warn");
      }
      continue;
    }
    if (layer.kind === "particles" && data.x && data.y && data.z) {
      try {
        const cname = data.scalar || data.c;
        const cq = cname ? `&c=${encodeURIComponent(cname)}` : "";
        const res = await fetch(`api/particles?x=${encodeURIComponent(data.x)}&y=${encodeURIComponent(data.y)}&z=${encodeURIComponent(data.z)}${cq}&stride=1`);
        if (res.ok && view3d.view) {
          const pt = PK3D.parseParticles(await res.arrayBuffer());
          if (layer.style && (layer.style.markersize || layer.style.size)) view3d.view.ptSize = layer.style.markersize || layer.style.size;
          if (layer.style && (layer.style.opacity || layer.style.alpha)) view3d.view.ptAlpha = layer.style.opacity || layer.style.alpha;
          view3d.view.setParticles(pt.meta, pt.xyz, pt.scalar);
          setStatus(`\u70B9\u4E91 ${pt.meta.count} \u70B9`, "ok");
        } else {
          setStatus("\u70B9\u4E91\u52A0\u8F7D\u5931\u8D25", "warn");
        }
      } catch (err) {
        setStatus(`\u70B9\u4E91\u52A0\u8F7D\u5931\u8D25\uFF1A${err.message}`, "warn");
      }
      continue;
    }
    if (!data.x || !data.y || !data.z) continue;
    const surfaceLike = ["surface", "trisurf", "voxels", "heatmap", "contourf"].includes(layer.kind);
    if (surfaceLike) {
      try {
        const res = await fetch(`api/mesh?x=${encodeURIComponent(data.x)}&y=${encodeURIComponent(data.y)}&z=${encodeURIComponent(data.z)}&stride=1`);
        if (res.ok) {
          const m = PK3D.parseMesh(await res.arrayBuffer());
          out.push({
            name: `${layer.kind} ${++seen}`,
            mode: "mesh",
            positions: m.positions,
            normals: m.normals,
            indices: m.indices,
            color: PK3D.hexToRgba(PK3D.PALETTE[colorIndex++ % PK3D.PALETTE.length])
          });
          continue;
        }
      } catch (err) {
        setStatus(`\u66F2\u9762\u52A0\u8F7D\u5931\u8D25\uFF0C\u9000\u56DE\u70B9\u4E91\uFF1A${err.message}`, "warn");
      }
    }
    const url = `api/xyz?x=${encodeURIComponent(data.x)}&y=${encodeURIComponent(data.y)}&z=${encodeURIComponent(data.z)}&max=300000`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const frame = PK3D.parseFrame(await res.arrayBuffer());
      const lineLike = ["line3d", "stream3d", "line", "step"].includes(layer.kind);
      out.push({
        name: `${layer.kind} ${++seen}`,
        mode: lineLike ? "lines" : "points",
        positions: frame.positions,
        color: PK3D.hexToRgba(PK3D.PALETTE[colorIndex++ % PK3D.PALETTE.length])
      });
    } catch (err) {
      setStatus(`\u4E09\u7EF4\u6570\u636E\u52A0\u8F7D\u5931\u8D25\uFF1A${err.message}`, "bad");
    }
  }
  return out;
}
async function toggle3d(force) {
  const want = force === void 0 ? !view3d.on : !!force;
  const canvas = $("plot3d");
  const hud = $("plot3d-hud");
  const plot = $("plot");
  if (!want) {
    view3d.on = false;
    stopPlay3d();
    $("plot3d-timeline").hidden = true;
    $("plot3d-region").hidden = true;
    canvas.hidden = true;
    $("plot3d-deco").hidden = true;
    hud.hidden = true;
    plot.classList.remove("mode-3d");
    $("btn-3d").classList.remove("on");
    return;
  }
  if (!view3d.view) {
    try {
      view3d.view = new PK3D.View3D(canvas);
      view3d.view.attachOverlay($("plot3d-deco"));
    } catch (err) {
      setStatus(`3D \u89C6\u56FE\u4E0D\u53EF\u7528\uFF1A${err.message}`, "bad");
      return;
    }
    view3d.view.onSelect = async ({ rect, mvp }) => {
      const layer = (state.spec.layers || []).find((l) => l.data && l.data.x && l.data.y && l.data.z);
      const panel = $("plot3d-region");
      if (!layer || !mvp) return;
      panel.hidden = false;
      panel.textContent = "\u533A\u57DF\u7EDF\u8BA1\u4E2D\u2026";
      try {
        const res = await fetch("api/region", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x: layer.data.x, y: layer.data.y, z: layer.data.z, mvp, rect })
        });
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          throw new Error(detail.detail || `HTTP ${res.status}`);
        }
        const body = await res.json();
        const f = (v) => Math.abs(v) >= 1e4 || Math.abs(v) < 0.01 && v !== 0 ? v.toExponential(2) : v.toFixed(3);
        const z = body.stats && body.stats.z;
        panel.textContent = z && z.count ? `\u9009\u4E2D ${body.count}/${body.total} \u70B9\uFF08${(body.ratio * 100).toFixed(1)}%\uFF09
z  min ${f(z.min)}   max ${f(z.max)}
   mean ${f(z.mean)}  p05 ${f(z.p05)}  p95 ${f(z.p95)}` : "\u6846\u5185\u6CA1\u6709\u70B9\uFF08\u8BD5\u8BD5\u66F4\u5927\u7684\u6846\uFF09";
      } catch (err) {
        panel.textContent = `\u533A\u57DF\u7EDF\u8BA1\u5931\u8D25\uFF1A${err.message}`;
      }
    };
    view3d.view.onStats = ({ fps, points }) => {
      hud.hidden = false;
      hud.textContent = `${fps.toFixed(0)} fps \xB7 ${(points / 1e3).toFixed(0)}k \u70B9`;
      hud.style.left = "12px";
      hud.style.top = "12px";
    };
  }
  const layers = await load3dLayers();
  const hasVolumeOrPoints = !!(view3d.view && (view3d.view.vol || view3d.view.ptCount));
  if (!layers.length && !hasVolumeOrPoints) {
    setStatus("\u5F53\u524D\u6CA1\u6709\u5E26 z \u7684\u56FE\u5C42\uFF08scatter3d / line3d / stream3d \u624D\u6709\uFF09", "bad");
    return;
  }
  const total = view3d.view.setLayers(layers);
  const first = layers[0] || {};
  const meta = first.meta || {};
  view3d.view.axisNames = [meta.x || "x", meta.y || "y", meta.z || "z"];
  view3d.view.title = state.spec.figure && state.spec.figure.title || state.spec.title || "";
  view3d.on = true;
  canvas.hidden = false;
  $("plot3d-deco").hidden = false;
  plot.classList.add("mode-3d");
  $("btn-3d").classList.add("on");
  loadTimeline3d().catch(() => {
  });
  setStatus(`3D \u89C6\u56FE \xB7 ${layers.length} \u56FE\u5C42 / ${(total / 1e3).toFixed(0)}k \u70B9\uFF08\u62D6\u52A8\u65CB\u8F6C\uFF0C\u6EDA\u8F6E\u7F29\u653E\uFF0CShift \u5E73\u79FB\uFF09`, "good");
}
const timeline3d = { data: null, index: 0, playing: false, timer: 0 };
async function loadTimeline3d() {
  const bar = $("plot3d-timeline");
  const layer = (state.spec.layers || []).find(
    (l) => l.data && l.data.x && l.data.y && l.data.z && l.data.t
  );
  if (!layer) {
    bar.hidden = true;
    timeline3d.data = null;
    return;
  }
  const d = layer.data;
  const url = `api/timeline?x=${encodeURIComponent(d.x)}&y=${encodeURIComponent(d.y)}&z=${encodeURIComponent(d.z)}&t=${encodeURIComponent(d.t)}&frames=240`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    timeline3d.data = data;
    timeline3d.index = 0;
    $("plot3d-slider").max = String(Math.max(0, data.t.length - 1));
    $("plot3d-slider").value = "0";
    bar.hidden = false;
    applyFrame3d(0);
  } catch (err) {
    bar.hidden = true;
    timeline3d.data = null;
    setStatus(`\u65F6\u95F4\u8F74\u4E0D\u53EF\u7528\uFF1A${err.message}`, "warn");
  }
}
function applyFrame3d(i) {
  const data = timeline3d.data;
  if (!data || !view3d.view) return;
  const n = data.t.length;
  const idx = Math.max(0, Math.min(n - 1, i));
  timeline3d.index = idx;
  const pts = new Float32Array((idx + 1) * 3);
  for (let k = 0; k <= idx; k++) {
    pts[k * 3] = data.x[k];
    pts[k * 3 + 1] = data.y[k];
    pts[k * 3 + 2] = data.z[k];
  }
  view3d.view.setTrail(pts);
  view3d.view.setMarker([data.x[idx], data.y[idx], data.z[idx]]);
  $("plot3d-slider").value = String(idx);
  $("plot3d-time").textContent = `${data.t[idx].toFixed(2)} \xB7 ${idx + 1}/${n}`;
}
function stopPlay3d() {
  timeline3d.playing = false;
  if (timeline3d.timer) clearInterval(timeline3d.timer);
  timeline3d.timer = 0;
  $("btn-3d-play").textContent = "\u25B6";
}
function togglePlay3d() {
  if (timeline3d.playing) {
    stopPlay3d();
    return;
  }
  if (!timeline3d.data) return;
  timeline3d.playing = true;
  $("btn-3d-play").textContent = "\u23F8";
  timeline3d.timer = setInterval(() => {
    const n = timeline3d.data.t.length;
    const next = timeline3d.index + 1 >= n ? 0 : timeline3d.index + 1;
    applyFrame3d(next);
  }, 50);
}
$("btn-3d-play").addEventListener("click", togglePlay3d);
$("plot3d-slider").addEventListener("input", (ev) => {
  stopPlay3d();
  applyFrame3d(Number(ev.target.value));
});
$("btn-3d").addEventListener("click", () => {
  toggle3d().catch((err) => setStatus(err.message, "bad"));
});
function axesFraction(ev) {
  const img = $("plotImg");
  if (!state.img || !state.img.box || !img.getBoundingClientRect().width) return null;
  const r = img.getBoundingClientRect();
  const [x0, y0, bw, bh] = state.img.box;
  const fx = (ev.clientX - r.left) / r.width;
  const fy = 1 - (ev.clientY - r.top) / r.height;
  const inside = fx >= x0 && fx <= x0 + bw && fy >= y0 && fy <= y0 + bh;
  return { fx: (fx - x0) / bw, fy: (fy - y0) / bh, inside, r };
}
let pickBusy = false;
let pickAt = 0;
let pickSeq = 0;
function hoverPick(x, y, xlim, ylim, chip, seq) {
  const now = performance.now();
  if (pickBusy || now - pickAt < 90) return;
  pickAt = now;
  pickBusy = true;
  const sx = Math.abs(xlim[1] - xlim[0]) || 1;
  const sy = Math.abs(ylim[1] - ylim[0]) || 1;
  fetch(`api/pick?x=${x}&y=${y}&sx=${sx}&sy=${sy}`).then((res) => res.ok ? res.json() : null).then((data) => {
    pickBusy = false;
    if (!data || !data.hit || seq !== pickSeq) return;
    chip.textContent = `x ${data.x.toPrecision(6)}   y ${data.y.toPrecision(6)}   #${data.i}`;
  }).catch(() => {
    pickBusy = false;
  });
}
function hoverAt(ev) {
  const chip = $("plotHover");
  const hit = axesFraction(ev);
  if (!hit || !hit.inside || !state.img.xlim || !state.img.ylim) {
    chip.hidden = true;
    return;
  }
  const [x0, x1] = state.img.xlim, [y0, y1] = state.img.ylim;
  const x = x0 + hit.fx * (x1 - x0), y = y0 + hit.fy * (y1 - y0);
  chip.hidden = false;
  chip.textContent = `x ${x.toPrecision(4)}   y ${y.toPrecision(4)}`;
  chip.style.left = `${ev.clientX - hit.r.left + 12}px`;
  chip.style.top = `${ev.clientY - hit.r.top + 12}px`;
  pickSeq += 1;
  hoverPick(x, y, state.img.xlim, state.img.ylim, chip, pickSeq);
}
$("plot").addEventListener("wheel", (ev) => {
  if (!state.img || !state.img.xlim || !state.img.ylim) return;
  const hit = axesFraction(ev);
  if (!hit || !hit.inside) return;
  ev.preventDefault();
  const factor = Math.exp(ev.deltaY * 15e-4);
  const [x0, x1] = state.img.xlim, [y0, y1] = state.img.ylim;
  const cx = x0 + hit.fx * (x1 - x0), cy = y0 + hit.fy * (y1 - y0);
  state.view.xlim = [cx - (cx - x0) * factor, cx + (x1 - cx) * factor];
  state.view.ylim = [cy - (cy - y0) * factor, cy + (y1 - cy) * factor];
  const scale = Math.max(0.5, Math.min(2, 1 / factor));
  $("plotImg").style.transform = `scale(${scale})`;
  zooming = true;
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => {
    zooming = false;
  }, 320);
  schedulePreview();
  scheduleRender("\u7F29\u653E");
}, { passive: false });
let plotDrag = null;
$("plot").addEventListener("pointerdown", (ev) => {
  if (!state.img || !state.img.xlim || ev.button !== 0) return;
  plotDrag = {
    x: ev.clientX,
    y: ev.clientY,
    xlim: state.img.xlim.slice(),
    ylim: state.img.ylim.slice(),
    moved: false
  };
  $("plot").classList.add("dragging");
  try {
    $("plot").setPointerCapture(ev.pointerId);
  } catch (_) {
  }
});
$("plot").addEventListener("pointermove", (ev) => {
  if (!plotDrag) {
    hoverAt(ev);
    return;
  }
  const r = $("plotImg").getBoundingClientRect();
  if (!r.width) return;
  const dx = (ev.clientX - plotDrag.x) / r.width;
  const dy = (ev.clientY - plotDrag.y) / r.height;
  if (Math.abs(ev.clientX - plotDrag.x) + Math.abs(ev.clientY - plotDrag.y) > 3) plotDrag.moved = true;
  const [x0, x1] = plotDrag.xlim, [y0, y1] = plotDrag.ylim;
  const sx = (x1 - x0) * dx, sy = (y1 - y0) * dy;
  state.view.xlim = [x0 - sx, x1 - sx];
  state.view.ylim = [y0 + sy, y1 + sy];
  $("plotImg").style.transform = `translate(${ev.clientX - plotDrag.x}px, ${ev.clientY - plotDrag.y}px)`;
  schedulePreview();
});
function endPlotDrag() {
  if (!plotDrag) return;
  const moved = plotDrag.moved;
  plotDrag = null;
  $("plot").classList.remove("dragging");
  if (moved) scheduleRender("\u5E73\u79FB");
  else $("plotImg").style.transform = "none";
}
$("plot").addEventListener("pointerup", endPlotDrag);
$("plot").addEventListener("pointercancel", endPlotDrag);
$("plot").addEventListener("dblclick", () => {
  state.view = { xlim: null, ylim: null };
  $("plotImg").style.transform = "none";
  redraw("\u590D\u4F4D\u89C6\u56FE");
});
$("plot").addEventListener("pointerleave", () => {
  $("plotHover").hidden = true;
});
renderMenus();
bindShortcuts();
boot();
window.__pk = { get state() {
  return state;
}, renderInsetOverlay, renderInsets, undo, redo, commit, renderLayers, scheduleLayoutSave, redraw, hoverAt };
