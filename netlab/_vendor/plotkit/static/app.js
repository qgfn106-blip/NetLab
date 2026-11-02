/* PlotKit 前端：只做"呈现与绑定"，图元由服务端从 spec 生成（L2 权威在 Python，D2）。
 * 渲染在服务端（matplotlib，D33）：前端只显示 PNG，并把缩放/平移翻译成新的 xlim/ylim；
 * 拖动期间只做 CSS 变换（0 延迟），停手 120 ms 才回后端重绘（D34）；hover 读数本地算，不发请求。 */
"use strict";

const $ = (id) => document.getElementById(id);

// 嵌在别人页面里时（netlab 浮窗/停靠），默认收起右侧面板，把宽度全留给图
const EMBED = new URLSearchParams(location.search).get("embed") === "1";
// 宿主（netlab 原生界面）可以把主题带进来：?theme=light|dark。
// 只覆盖页面外壳的深浅色，图本身的 theme 仍由 spec.figure.theme 决定（渲染权威在服务端）。
const THEME_PARAM = (() => {
  const value = new URLSearchParams(location.search).get("theme");
  return value === "light" || value === "dark" ? value : null;
})();

const state = {
  expanded: new Set(),
  undo: [],          // 已提交过的 spec 快照（JSON 字符串）
  redo: [],
  committed: null,   // 最近一次成功 PUT 的 spec 快照，用来判断"这次改动要不要进撤销栈"
  layout: { panelWidth: 380, sections: {}, expanded: [], groups: [] },
  layoutTimer: null,
  selectedLayer: null,
  spec: null,
  catalog: { datasets: [], groups: {} },
  meta: null,
  catalogKey: "",
  selected: null, // 当前选中的数据集名
  playhead: null,     // 回放游标（秒）；null = 实时
  playing: false,
  playTimer: null,
  playSpeed: 60,      // 帧/秒，和 netlab 老画布一致
  playLoop: false,
  time: { min: null, max: null, count: 0 },
  busy: false,
  timings: [],
  img: null,                       // 当前显示的图：{xlim, ylim, box, px}
  view: { xlim: null, ylim: null },// 用户缩放/平移后的视窗（null = 自动）
  pending: null,                   // 停手重绘的定时器
};

const KIND_LABEL = { line: "折线", marker: "散点", bar: "柱状" };

/* ---------------- 网络 ---------------- */

async function api(path, options) {
  const res = await fetch(path, options);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = { raw: text }; }
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

/* ---------------- 启动 ---------------- */

async function boot() {
  try {
    const [meta, spec, catalog, layout] = await Promise.all([
      api("api/meta"), api("api/spec"), api("api/datasets"), api("api/layout"),
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
    renderLayers();
    await redraw("首次绘制");
    // performance.now() 从导航开始计时，所以这个数就是"打开页面到图出来"
    pushTiming("首帧（含引擎解析）", performance.now());
    setStatus(`就绪 · ${catalog.datasets.length} 个数据集 · ${spec.layers.length} 个图层`, "good");
  } catch (err) {
    setStatus(`启动失败：${err.message}`, "bad");
    console.error(err);
  }
}

function renderLayoutControls() {
  const fig = state.spec.figure;
  $("ncols").value = fig.ncols;
  $("subplots").value = fig.subplots;
  $("theme").value = fig.theme || "default";
  $("linkx").checked = !!fig.link_x;
  $("figtitle").textContent = fig.title || "未命名";
  document.body.dataset.theme = THEME_PARAM || (fig.theme === "default" ? "light" : "dark");
}

/* ---------------- 数据集 ---------------- */

function newLayerFor(x, y, subplot) {
  return {
    id: "l" + Math.random().toString(16).slice(2, 10),
    kind: "line",
    subplot: subplot | 0,
    data: { x, y },
    label: y,
    legend: true,
    style: { mode: "lines", color: null, width: 1.6, dash: "solid",
             marker: { symbol: "circle", size: 6, opacity: 1 }, fill: null, opacity: 1 },
    view: { title: null, xlabel: null, ylabel: null, xlim: null, ylim: null,
            xscale: "linear", yscale: "linear", grid: true, invert_y: false, zero_line: false },
    annotations: [],
  };
}

function dsFilter() {
  const keyword = ($("dsSearch").value || "").trim().toLowerCase();
  const all = state.catalog.datasets || [];
  if (!keyword) return all;
  return all.filter((d) =>
    d.name.toLowerCase().includes(keyword) ||
    (d.tags || []).some((tag) => String(tag).toLowerCase().includes(keyword)) ||
    String(d.unit || "").toLowerCase().includes(keyword));
}

function renderDatasets() {
  const box = $("datasets");
  box.innerHTML = "";
  const all = state.catalog.datasets || [];
  const list = dsFilter();
  $("dscount").textContent = list.length === all.length ? String(all.length) : `${list.length}/${all.length}`;
  if (!list.length) {
    box.innerHTML = `<p class="hint">先用 <code>fig.add_data("v_out", arr, role="series")</code> 注册数据。</p>`;
    return;
  }
  for (const ds of list) {
    const el = document.createElement("span");
    el.className = "ds" + (state.selected === ds.name ? " active" : "");
    el.title = `role=${ds.role} · ${ds.length} 点${ds.unit ? " · 单位 " + ds.unit : ""}${ds.tags.length ? " · " + ds.tags.join("/") : ""}`;
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
    hint.textContent = `筛出 ${list.length} 个`;
    box.appendChild(hint);
  }
}

/** 批量加图层：把当前筛选出的 series 一次性变成折线（对齐老画布的"信号列表勾选"）。 */
function addFilteredLayers() {
  const coords = datasetsByRole("coord");
  const x = coords.length ? coords[0].name : null;
  const series = dsFilter().filter((d) => d.role !== "coord" && d.name !== x);
  if (!x) { setStatus("缺少 x 轴坐标数据集（role=\"coord\"）", "bad"); return; }
  if (!series.length) { setStatus("筛选结果里没有可画的信号", "bad"); return; }
  const subplots = state.spec.figure.subplots || 1;
  let added = 0;
  for (const ds of series) {
    if (state.spec.layers.some((l) => l.data && l.data.y === ds.name && l.data.x === x)) continue;
    state.spec.layers.push(newLayerFor(x, ds.name, 0));
    added += 1;
  }
  if (!added) { setStatus("这些信号已经在图上了", "bad"); return; }
  commit(`批量加 ${added} 条曲线`);
}

function datasetsByRole(role) {
  return (state.catalog.datasets || []).filter((d) => role == null || d.role === role || d.role === "auto");
}

/* ---------------- 图层编辑器 ---------------- */

function makeLayerCard(layer, index) {
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
    <span class="sub">槽 ${layer.subplot}</span>
    <span class="caret" title="展开/收起参数">⌄</span>
    <span class="grip" title="拖到别的子图或分组">⠿</span>`;
  card.appendChild(head);

  // 卡片折叠：11 个图层时一屏能扫完，展开才显示参数
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
  fields.appendChild(selectField("图型", ["line", "marker", "bar"], layer.kind, (v) => {
    layer.kind = v;
    commit("改图型");
  }));
  fields.appendChild(selectField("颜色", [], layer.style.color || "", (v) => {
    layer.style.color = v || null;
    commit("改颜色");
  }, true));
  fields.appendChild(selectField("子图槽", range(state.spec.figure.subplots).map(String), String(layer.subplot), (v) => {
    layer.subplot = Number(v);
    commit("换子图");
  }));
  fields.appendChild(selectField("X 数据", datasetsByRole("coord").map((d) => d.name), layer.data.x, (v) => {
    layer.data.x = v;
    commit("改 X");
  }));
  fields.appendChild(selectField("Y 数据", datasetsByRole("series").map((d) => d.name), layer.data.y, (v) => {
    layer.data.y = v;
    commit("改 Y");
  }));
  fields.appendChild(textField("图例名", layer.label || "", (v) => {
    layer.label = v || null;
    commit("改图例");
  }));
  body.appendChild(fields);

  const foot = document.createElement("div");
  foot.className = "foot";
  const modeSel = selectEl(["lines", "markers", "lines+markers"], layer.style.mode || "lines");
  modeSel.onchange = () => { layer.style.mode = modeSel.value; commit("改模式"); };
  modeSel.title = "绘制模式";
  foot.appendChild(modeSel);
  const del = document.createElement("button");
  del.className = "btn small danger";
  del.textContent = "删除";
  del.onclick = () => {
    state.spec.layers.splice(index, 1);
    commit("删图层");
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
  card.addEventListener("dragover", (ev) => { ev.preventDefault(); card.classList.add("dragover"); });
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
    commit("交换子图");
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
  const grouped = new Set();
  const alive = new Set(layers.map((l) => l.id));
  (state.layout.groups || []).forEach((group) => {
    // 服务端 spec 换过之后 id 会变，先剔除失效引用，避免分组永远显示 1 个空成员
    group.layerIds = (group.layerIds || []).filter((id) => alive.has(id));
    const members = layers.filter((l) => group.layerIds.includes(l.id));
    if (!members.length && !group.name) return;
    members.forEach((l) => grouped.add(l.id));
    const head = document.createElement("div");
    head.className = "group-head";
    head.innerHTML = `<span>${group.open === false ? "▸" : "▾"}</span><span class="gname">${group.name || "分组"}</span><span class="gnum">${members.length}</span><button class="gdel" title="解散分组">✕</button>`;
    head.ondblclick = (ev) => {
      ev.stopPropagation();
      const next = prompt("分组名", group.name);
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
    head.addEventListener("dragover", (ev) => { ev.preventDefault(); head.classList.add("dragover"); });
    head.addEventListener("dragleave", () => head.classList.remove("dragover"));
    head.addEventListener("drop", (ev) => {
      ev.preventDefault();
      head.classList.remove("dragover");
      const draggedId = ev.dataTransfer.getData("text/plain");
      if (!draggedId) return;
      (state.layout.groups || []).forEach((g) => { g.layerIds = (g.layerIds || []).filter((id) => id !== draggedId); });
      group.layerIds = [...(group.layerIds || []), draggedId];
      renderLayers();
      scheduleLayoutSave();
      setStatus(`已加入分组「${group.name}」`, "good");
    });
    box.appendChild(head);
    if (group.open !== false) members.forEach(draw);
  });
  layers.filter((l) => !grouped.has(l.id)).forEach(draw);
}


function range(n) { return Array.from({ length: Math.max(1, n) }, (_, i) => i); }

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
    o.textContent = c || "自动";
    if ((value || "") === c) o.selected = true;
    sel.appendChild(o);
  }
  return sel;
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

/* ---------------- 提交与重绘 ---------------- */

async function commit(reason, { record = true } = {}) {
  if (state.busy) return;
  state.busy = true;
  const t0 = performance.now();
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
      body: JSON.stringify(state.spec),
    });
    if (res && res.ok === false) throw new Error("spec 校验未通过");
    state.committed = snapshot;
    await redraw(reason);
    setStatus(`已保存 · ${reason}`, "good");
    if (res && res.warnings && res.warnings.length) {
      $("warnings").textContent = `${res.warnings.length} 条警告`;
      $("warnings").className = "bad";
    }
  } catch (err) {
    setStatus(`保存失败：${err.message}`, "bad");
  } finally {
    state.busy = false;
    pushTiming("提交+重绘", performance.now() - t0);
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
    $("empty").hidden = false;
    return;
  }
  $("empty").hidden = true;
  const { w, h } = plotSize();
  const res = await fetch(renderUrl(w, h));
  if (!res.ok) { setStatus(`渲染失败 HTTP ${res.status}`, "bad"); return; }
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
    }) : [],
  };
  const t1 = performance.now();
  renderInsetOverlay();
  pushTiming(reason || "渲染", t1 - t0, { 服务端渲染: t1 - t0 });
}

/* ---------------- 渲染入口（D33：matplotlib 出图，前端只呈现） ---------------- */

const SETTLE_MS = 120;

function plotSize() {
  const el = $("plot");
  return { w: Math.max(320, el.clientWidth | 0), h: Math.max(200, el.clientHeight | 0) };
}

function renderUrl(w, h) {
  // 实时重绘的成本几乎全在 matplotlib 出图上，且它占着解释器锁，会拖慢同进程的
  // 仿真步进与 netlab 的 /api/live。像素尺寸按面积上限等比缩小（默认 1400×1000），
  // 面板再大也不按原始 CSS 尺寸出图。
  const MAX_W = 1400;
  const MAX_H = 1000;
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
  // 三维动画导出：转台（每帧只改相机方位角），交给 /api/render3d/batch 批量出图
  const btn = $("btn-anim3d");
  const frames = 24;
  if (btn) { btn.disabled = true; btn.classList.add("on"); }
  setStatus("三维动画导出中…", "busy");
  try {
    const spec = JSON.parse(JSON.stringify(state.spec));
    const base = (spec.figure = spec.figure || {});
    const elev = base.elev === undefined ? 26 : Number(base.elev);
    const azim0 = base.azim === undefined ? -58 : Number(base.azim);
    const payload = {
      width: 900, height: 620, dpi: 100,
      frames: Array.from({ length: frames }, (_, i) => {
        const s2 = JSON.parse(JSON.stringify(spec));
        s2.figure = Object.assign({}, s2.figure, {
          elev: elev, azim: azim0 + (360 * i) / frames,
        });
        return { spec: s2 };
      }),
    };
    const res = await fetch("api/render3d/batch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "plotkit-3d-frames.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    setStatus(`已导出 ${frames} 帧（${(blob.size / 1048576).toFixed(1)} MB）`, "ok");
  } catch (err) {
    setStatus(`三维动画导出失败：${err.message}`, "warn");
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove("on"); }
  }
}

function showBlob(blob, { animated = false } = {}) {
  const img = $("plotImg");
  const url = URL.createObjectURL(blob);
  const prev = img.dataset.url;
  img.dataset.url = url;
  img.src = url;
  img.style.transform = "none";
  if (prev) URL.revokeObjectURL(prev);  // 立刻释放，别依赖 onload（并发时会丢回调）
  if (animated) state.img = null;       // 动画帧没有静态几何，避免 hover/缩放读旧值
}

function scheduleRender(reason) {
  clearTimeout(state.pending);
  state.pending = setTimeout(() => {
    state.pending = null;
    redraw(reason).catch((err) => setStatus(`渲染失败：${err.message}`, "bad"));
  }, SETTLE_MS);
}

/* 拖动/缩放中的低清预览（P2）：每 70ms 允许一次半分辨率请求，
   回来后直接替换成新视窗的图，所以"拖的时候看到的就是真的"，不再只是拉伸旧图。 */
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
  fetch(renderUrl(pw, ph))
    .then((res) => (res.ok ? res.blob() : null))
    .then((blob) => {
      previewBusy = false;
      if (!blob || (!plotDrag && !zooming)) return;   // 已经松手：交给最终渲染
      showBlob(blob);
    })
    .catch(() => { previewBusy = false; });
}

function pushTiming(label, ms, parts) {
  const detail = parts ? Object.entries(parts).map(([k, v]) => `${k} ${v.toFixed(1)}ms`).join(" · ") : "";
  state.timings.unshift({ label, ms, detail, at: new Date().toLocaleTimeString() });
  state.timings = state.timings.slice(0, 6);
  const box = $("timing");
  box.innerHTML = state.timings
    .map((t) => `<div><b>${t.ms.toFixed(1)} ms</b> ${t.label}${t.detail ? ` <span style="opacity:.7">(${t.detail})</span>` : ""}</div>`)
    .join("");
}

/* ---------------- 交互 ---------------- */

$("btn-add").onclick = () => {
  const subplots = state.spec.figure.subplots || 1;
  const coords = datasetsByRole("coord");
  const series = datasetsByRole("series");
  const y = state.selected && series.some((d) => d.name === state.selected)
    ? state.selected
    : (series[0] && series[0].name);
  const x = coords[0] ? coords[0].name : (series[0] && series[0].name);
  if (!x || !y) {
    setStatus("还没有可用数据集：先在 Python 侧 add_data()", "bad");
    return;
  }
  state.spec.layers.push(newLayerFor(x, y, Math.min(state.spec.layers.length, subplots - 1)));
  commit("新增图层");
};

/* ---------------- 动画（P13-06） ---------------- */

let animPlaying = false;

$("btn-anim").onclick = async () => {
  if (animPlaying) {
    animPlaying = false;
    $("btn-anim").classList.remove("on");
    redraw("停止动画");
    return;
  }
  if (!state.spec.layers.length) { setStatus("还没有图层", "bad"); return; }
  if (state.animBusy) return;   // 生成要好几秒，连点会起两个请求并漏掉一个 blob
  state.animBusy = true;
  $("btn-anim").disabled = true;
  setStatus("正在生成动画…", "ok");
  try {
    const { w, h } = plotSize();
    const res = await fetch(`api/anim?w=${w}&h=${h}`);
    if (!res.ok) { setStatus(`动画失败 HTTP ${res.status}`, "bad"); return; }
    showBlob(await res.blob(), { animated: true });
    animPlaying = true;
    $("btn-anim").classList.add("on");
    setStatus("播放动画（再点一次停止）", "ok");
  } finally {
    state.animBusy = false;
    $("btn-anim").disabled = false;
  }
};

$("btn-png").onclick = () => {
  window.open("api/png", "_blank");
  setStatus("已用 matplotlib 导出静态图", "good");
};

$("btn-theme").onclick = () => {
  const dark = document.body.dataset.theme !== "light";
  document.body.dataset.theme = dark ? "light" : "dark";
  state.spec.figure.theme = dark ? "default" : "netlab-dark";
  $("theme").value = state.spec.figure.theme;
  commit("切主题");
};

/* 面板宽度：拖左缘挂耳调整，双击复位；宽度记在 localStorage（属于"软件怎么摆"） */
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
    scheduleRender("面板宽度");
    renderInsetOverlay();
  });
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = "";
    const width = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--panel-w")) || 380;
    localStorage.setItem(PANEL_KEY, String(Math.round(width)));
  };
  grip.addEventListener("pointerup", stop);
  grip.addEventListener("pointercancel", stop);
  grip.addEventListener("dblclick", () => {
    localStorage.removeItem(PANEL_KEY);
    applyPanelWidth(380);
    scheduleRender("面板复位");
    renderInsetOverlay();
  });
})();

// 嵌入模式：一进来就收面板，避免 500px 宽的宿主里图被挤成一条缝
if (EMBED) {
  document.body.classList.add("embed");
  $("panel").classList.add("collapsed");
  $("btn-panel").textContent = "◂";
}

$("btn-panel").onclick = () => {
  const panel = $("panel");
  panel.classList.toggle("collapsed");
  $("btn-panel").textContent = panel.classList.contains("collapsed") ? "◂" : "▸";
  setTimeout(() => redraw("面板开合"), 200);
};

$("theme").onchange = (ev) => {
  state.spec.figure.theme = ev.target.value;
  document.body.dataset.theme = ev.target.value === "default" ? "light" : "dark";
  commit("切主题");
};

$("ncols").onchange = (ev) => { state.spec.figure.ncols = Number(ev.target.value) || 1; commit("改列数"); };
$("subplots").onchange = (ev) => { state.spec.figure.subplots = Number(ev.target.value) || 1; commit("改子图数"); };
$("linkx").onchange = (ev) => { state.spec.figure.link_x = ev.target.checked; commit("改联动"); };

window.addEventListener("resize", () => {
  if (state.spec && state.spec.layers.length) {
    scheduleRender("窗口尺寸");
    renderInsetOverlay();
  }
});

/* ---------------- 内嵌子图：面板 + 拖拽 ---------------- */

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
    name.textContent = `内嵌 ${index + 1} · 槽 ${ins.subplot}`;
    const del = document.createElement("button");
    del.className = "btn danger tiny";
    del.textContent = "删除";
    del.onclick = () => {
      state.spec.figure.insets = insetList().filter((x) => x !== ins);
      commit("删除内嵌图");
    };
    head.append(dot, name, del);
    card.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "fields four";
    const r = ins.rect || [0.6, 0.6, 0.35, 0.35];
    [["x", 0], ["y", 1], ["宽", 2], ["高", 3]].forEach(([label, i]) => {
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
        commit("改内嵌图位置");
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
  // 改用服务端返回的各槽位包围盒（X-PlotKit-Axes）
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
    // rect 是父轴绘图区的比例（y 从下往上），屏幕坐标从上往下，需要翻转
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
    tag.textContent = `内嵌 ${index + 1}`;
    const handle = document.createElement("span");
    handle.className = "inset-handle";
    box.append(tag, handle);

    const start = (ev, mode) => {
      ev.preventDefault();
      ev.stopPropagation();
      overlayState.active = {
        ins, dom, size, mode,
        x0: ev.clientX, y0: ev.clientY,
        rect0: [...r],
        box,
      };
      box.classList.add("dragging");
      try { box.setPointerCapture(ev.pointerId); } catch { /* 合成事件没有真实指针，忽略 */ }
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
      const r2 = act.ins.rect.map((v) => Math.round(v * 1000) / 1000);
      act.ins.rect = r2;
      commit(act.mode === "move" ? "拖动内嵌图" : "缩放内嵌图");
    };
    box.addEventListener("pointerup", finish);
    box.addEventListener("pointercancel", finish);
    overlay.appendChild(box);
  });
}

function clamp01(value, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, value));
}

/* ---------------- 时间窗与回放（对齐 netlab 老画布：时间窗 / 回放 / 速度 / 循环 / 回到实时 / 清空） ---------------- */

function fmtTime(value) {
  return value == null ? "实时" : `${value.toFixed(2)} s`;
}

async function refreshTimeInfo() {
  try {
    const meta = await api("api/meta");
    state.meta = meta;
    state.time = meta.time || { min: null, max: null, count: 0 };
    syncPlayheadUI();
  } catch (err) {
    /* 轮询失败不打扰用户 */
  }
}

function playStep() {
  const { min, max } = state.time;
  const n = Math.max(1, (state.time.count || 1) - 1);
  if (min == null || max == null || max <= min) return 0;
  return (max - min) / n;   // 一帧 = 一个采样点，和 netlab 的"帧/秒"同义
}

function syncPlayheadUI() {
  const slider = $("playhead");
  const { min, max } = state.time;
  if (min != null && max != null && max > min) {
    slider.min = min;
    slider.max = max;
    slider.step = ((max - min) / 1000).toPrecision(2);
    slider.value = state.playhead == null ? max : Math.min(Math.max(state.playhead, min), max);
    slider.disabled = false;
  } else {
    slider.disabled = true;
  }
  $("playTime").textContent = state.playhead == null ? "实时" : fmtTime(state.playhead);
  $("btn-play").textContent = state.playing ? "⏸" : "▶";
  $("playSpeedVal").textContent = `${state.playSpeed}/s`;
  $("playStatus").textContent = state.playhead == null ? "" : `历史 ${fmtTime(state.playhead)}`;
  const windowSec = (state.spec && state.spec.figure && state.spec.figure.window) || null;
  if (document.activeElement !== $("winSec")) $("winSec").value = windowSec || "";
}

function setPlayhead(value) {
  state.playhead = value;
  syncPlayheadUI();
  redraw("回放");
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
  const dt = Math.min(0.5, (now - (state.playClock || now)) / 1000);
  state.playClock = now;
  if (!state.busy) {
    // 按真实时间前进：速度是"每秒多少帧"，一帧 = 一个采样点。
    // 这样即使重绘被浏览器降频，回放速度也不会变慢。
    const base = state.playhead == null ? min : state.playhead;
    let next = base + playStep() * state.playSpeed * dt;
    if (max != null && next >= max) {
      if (state.playLoop) next = min;
      else { state.playhead = max; syncPlayheadUI(); redraw("回放"); stopPlaying(); return; }
    }
    state.playhead = next;
    syncPlayheadUI();
    redraw("回放");
  }
  // 用 setTimeout 而不是 requestAnimationFrame：后者在无头/后台标签里会被暂停，
  // 回放看起来"点了没反应"。
  state.playTimer = setTimeout(tickPlay, 1000 / Math.max(5, state.playSpeed));
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
    // 注意顺序：stopPlaying() 会 syncPlayheadUI() 把滑杆值写回旧游标，
    // 所以必须先读用户刚拖到的值，再停播。
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
  $("playLoop").onchange = (e) => { state.playLoop = e.target.checked; };
  $("btn-live").onclick = () => {
    stopPlaying();
    state.playhead = null;
    syncPlayheadUI();
    redraw("回到实时");
  };
  // 时间窗属于 spec（"图长什么样"），改完要回写后端
  let winTimer = null;
  $("winSec").oninput = (e) => {
    const raw = e.target.value.trim();
    const value = raw === "" ? null : Math.max(0.05, parseFloat(raw) || 0);
    if (winTimer) clearTimeout(winTimer);
    winTimer = setTimeout(() => {
      state.spec.figure.window = value;
      commit("时间窗");
    }, 350);
  };
  $("btn-clear").onclick = async () => {
    stopPlaying();
    try {
      await api("api/clear", { method: "POST" });
      state.playhead = null;
      await refreshCatalog();
      await redraw("清空轨迹");
      setStatus("已清空轨迹", "good");
    } catch (err) {
      setStatus(`清空失败：${err.message}`, "bad");
    }
  };
}

function bindDatasetSearch() {
  $("dsSearch").oninput = () => renderDatasets();
  $("dsAdd").onclick = () => addFilteredLayers();
}

function initPlayback(meta) {
  state.time = (meta && meta.time) || state.time;
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

/* ---------------- 实时：数据集变了就重取图元 ---------------- */
/* 只轮询"数据集目录"（很小），版本号变了才重建；缩放/平移期间暂停，避免抢帧。
   实时自动重绘再节流到 LIVE_MIN_MS 一次：一次 render 要 70–200ms，500ms 一次
   会让面板永远在出图，还会抢走仿真线程的时间片（表现为整个窗口卡顿）。 */
// 宿主（netlab 等）通过 postMessage 告知"当前是否看得见这个面板"：
// 看不见就完全停掉轮询与自动重绘，切回来时补一次。
window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "plotkit-visibility") return;
  const visible = Boolean(data.visible);
  if (state.suspended === !visible) return;
  state.suspended = !visible;
  if (visible) scheduleLiveRedraw("重新可见");
});

function plotVisible() {
  const el = $("plot");
  return !!el && el.offsetParent !== null && el.clientWidth > 0;
}

const LIVE_MIN_MS = 1000;
let liveAt = 0;
let liveTimer = null;
function scheduleLiveRedraw(reason) {
  if (liveTimer) return;
  const wait = Math.max(0, LIVE_MIN_MS - (performance.now() - liveAt));
  liveTimer = setTimeout(() => {
    liveTimer = null;
    if (state.busy || state.suspended || document.hidden || !plotVisible()) return;
    liveAt = performance.now();
    redraw(reason).catch((err) => setStatus(`渲染失败：${err.message}`, "bad"));
  }, wait);
}

let polling = false;
async function poll() {
  if (state.busy || state.suspended || document.hidden || !state.spec || !plotVisible()) return;
  try {
    // 图层是后端在"通道出现后"才补的：面板若先于仿真打开，启动时 spec 里没有 layer，
    // 不主动重取就会一直停在「0 个图层」，看起来像卡死。空图层时顺带刷新 spec。
    if (!state.spec.layers.length) {
      const spec = await api("api/spec");
      if ((spec.layers || []).length) {
        state.spec = spec;
        renderLayoutControls();
        renderLayers();
        renderInsets();
        refreshTimeInfo();
        scheduleLiveRedraw("图层出现");
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
      scheduleLiveRedraw("实时更新");
    }
  } catch (err) {
    setStatus(`实时更新失败：${err.message}`, "bad");
  }
}

function startPolling(intervalMs) {
  if (polling) return;
  polling = true;
  setInterval(() => { poll(); }, intervalMs || 1000);
}


/* ---------------- 布局（.layout.json）：面板宽 / 折叠 / 展开 / 分组 ----------------
 * 归属规则：spec 决定"图长什么样"，layout 决定"软件怎么摆"（D14）。
 */
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
  document.querySelectorAll("#panel > details[id]").forEach((el) => { sections[el.id] = el.open; });
  state.layout.sections = sections;
  state.layout.expanded = Array.from(state.expanded);
  try {
    await api("api/layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.layout),
    });
  } catch (err) {
    setStatus(`布局未保存：${err.message}`, "bad");
  }
}

/* ---------------- 撤销 / 重做 ---------------- */
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
  if (!state.undo.length) { setStatus("没有可撤销的操作", "bad"); return; }
  state.redo.push(state.committed);
  await restoreSnapshot(state.undo.pop(), "撤销");
}

async function redo() {
  if (!state.redo.length) { setStatus("没有可重做的操作", "bad"); return; }
  state.undo.push(state.committed);
  await restoreSnapshot(state.redo.pop(), "重做");
}

/* ---------------- 菜单栏（结构参照 netlab：紧凑、可键盘操作） ---------------- */
const MENUS = {
  file: {
    title: "文件",
    items: [
      { id: "save-spec", label: "保存 spec.json", kbd: "Ctrl+S", run: () => downloadText("spec.json", JSON.stringify(state.spec, null, 2)) },
      { id: "png", label: "导出 PNG（matplotlib）", kbd: "Ctrl+E", run: () => exportPng() },
      { sep: true },
      { id: "reload", label: "重新载入服务端 spec", run: () => location.reload() },
    ],
  },
  edit: {
    title: "编辑",
    items: [
      { id: "undo", label: "撤销", kbd: "Ctrl+Z", run: () => undo() },
      { id: "redo", label: "重做", kbd: "Ctrl+Y", run: () => redo() },
      { sep: true },
      { id: "dup", label: "复制选中图层", kbd: "Ctrl+D", run: () => duplicateSelected() },
      { id: "del", label: "删除选中图层", kbd: "Delete", run: () => deleteSelected() },
    ],
  },
  insert: {
    title: "插入",
    items: [
      { id: "layer", label: "新建图层", run: () => addLayer() },
      { id: "group", label: "新建分组", run: () => createGroup() },
      { id: "inset", label: "在子图 0 加内嵌图", run: () => addInset() },
    ],
  },
  view: {
    title: "视图",
    items: [
      { id: "panel", label: "收起/展开右侧面板", run: () => $("btn-panel").click() },
      { id: "theme", label: "切换深浅色", run: () => $("btn-theme").click() },
      { sep: true },
      { id: "sections", label: "展开全部面板分组", run: () => setAllSections(true) },
      { id: "collapse", label: "收起数据集/内嵌图", run: () => setAllSections(false) },
    ],
  },
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
      if (openPop && openPop.dataset.menu === id) { closeMenus(); return; }
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
      try { item.run(); } catch (err) { setStatus(`操作失败：${err.message}`, "bad"); }
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
  if (openPop) { openPop.remove(); openPop = null; }
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
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function duplicateSelected() {
  const layer = state.spec.layers.find((l) => l.id === state.selectedLayer);
  if (!layer) { setStatus("先点一个图层选中它", "bad"); return; }
  const copy = JSON.parse(JSON.stringify(layer));
  copy.id = `l${Math.random().toString(16).slice(2, 10)}`;
  const at = state.spec.layers.indexOf(layer);
  state.spec.layers.splice(at + 1, 0, copy);
  state.selectedLayer = copy.id;
  commit("复制图层");
}

function deleteSelected() {
  const idx = state.spec.layers.findIndex((l) => l.id === state.selectedLayer);
  if (idx < 0) { setStatus("先点一个图层选中它", "bad"); return; }
  state.spec.layers.splice(idx, 1);
  state.selectedLayer = null;
  commit("删图层");
}

function createGroup() {
  // 不弹 prompt（headless/快捷键场景会卡住），先建一个默认名，双击标题可改名
  const name = `分组 ${(state.layout.groups || []).length + 1}`;
  state.layout.groups.push({ id: `g${Date.now().toString(16)}`, name, open: true, layerIds: [] });
  renderLayers();
  scheduleLayoutSave();
  setStatus(`已建分组「${name}」，把图层拖到分组标题上即可归组`, "good");
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
    fonts: {},
  });
  commit("加内嵌图");
}

function addLayer() {
  const series = datasetsByRole("series")[0] || datasetsByRole("auto")[0] || state.catalog.datasets[0];
  const coord = datasetsByRole("coord")[0] || state.catalog.datasets[0];
  if (!series || !coord) { setStatus("没有可用数据集，先在 Python 侧 add_data()", "bad"); return; }
  state.spec.layers.push({
    id: `l${Math.random().toString(16).slice(2, 10)}`,
    kind: "line",
    subplot: 0,
    data: { x: coord.name, y: series.name },
    label: null,
    legend: true,
    style: { color: null, width: 1.6, dash: "solid", mode: "lines", opacity: 1.0, marker: { symbol: "circle", size: 7 } },
    view: {},
    annotations: [],
  });
  commit("新建图层");
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
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------- 快捷键 ---------------- */
function bindShortcuts() {
  window.addEventListener("keydown", (ev) => {
    const key = ev.key.toLowerCase();
    const mod = ev.ctrlKey || ev.metaKey;
    if (ev.key === "Escape") { closeMenus(); return; }
    if (mod && key === "z") { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
    if (mod && key === "y") { ev.preventDefault(); redo(); return; }
    if (mod && key === "d") { ev.preventDefault(); duplicateSelected(); return; }
    if (mod && key === "s") { ev.preventDefault(); downloadText("spec.json", JSON.stringify(state.spec, null, 2)); return; }
    if (mod && key === "e") { ev.preventDefault(); exportPng().catch((e) => setStatus(`导出失败：${e.message}`, "bad")); return; }
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

startPolling(1000);


/* ---------------- 3D 视图（P15）：WebGL 直画，拖动只改矩阵 ---------------- */

const view3d = { view: null, on: false };

async function load3dLayers() {
  const out = [];
  let colorIndex = 0;
  let seen = 0;
  for (const layer of state.spec.layers || []) {
    const data = layer.data || {};
    // 体渲染：三维标量场（values 形状 nz×ny×nx），浏览器里 raymarch
    if (layer.kind === "volume" && data.values && data.x && data.y && data.z) {
      try {
        const lv = (layer.style && (layer.style.level || layer.style.iso)) || "";
        const res = await fetch(`api/volume?x=${encodeURIComponent(data.x)}&y=${encodeURIComponent(data.y)}` +
                                `&z=${encodeURIComponent(data.z)}&values=${encodeURIComponent(data.values)}` +
                                `&stride=1&mode=surface${lv !== "" ? `&level=${lv}` : ""}`);
        if (res.ok && view3d.view) {
          const m = PK3D.parseMesh(await res.arrayBuffer());
          out.push({ mode: "mesh", positions: m.positions, normals: m.normals,
                     indices: m.indices, color: [0.58, 0.66, 1.00, 0.42], opacity: 0.42,
                     meta: m.meta, label: "volume" });
          setStatus(`等值面 ${m.meta.nvert} 顶点 / ${m.meta.ntri} 三角`, "ok");
        } else {
          setStatus("体积场加载失败", "warn");
        }
      } catch (err) {
        setStatus(`体积场加载失败：${err.message}`, "warn");
      }
      continue;
    }
    // 多段折线（流线束 / 轨迹束）：端点点对，浏览器用 gl.LINES 画
    if (layer.kind === "segments" && data.x && data.y && data.z) {
      try {
        const res = await fetch(`api/segments?x=${encodeURIComponent(data.x)}&y=${encodeURIComponent(data.y)}` +
                                `&z=${encodeURIComponent(data.z)}&stride=1`);
        if (res.ok) {
          const sg = PK3D.parseParticles(await res.arrayBuffer());
          const col = (layer.style && layer.style.color) || [0.55, 0.75, 1.0];
          out.push({ mode: "segments", positions: sg.xyz,
                     color: [col[0], col[1], col[2], 1.0], opacity: 1.0,
                     meta: sg.meta, label: "segments" });
          setStatus(`流线段 ${Math.round(sg.xyz.length / 6)} 段`, "ok");
        } else {
          setStatus("流线加载失败", "warn");
        }
      } catch (err) {
        setStatus(`流线加载失败：${err.message}`, "warn");
      }
      continue;
    }
    // 时空点云：柔光点精灵，c 作为逐点标量着色
    if (layer.kind === "particles" && data.x && data.y && data.z) {
      try {
        const cname = data.scalar || data.c;
        const cq = cname ? `&c=${encodeURIComponent(cname)}` : "";
        const res = await fetch(`api/particles?x=${encodeURIComponent(data.x)}&y=${encodeURIComponent(data.y)}` +
                                `&z=${encodeURIComponent(data.z)}${cq}&stride=1`);
        if (res.ok && view3d.view) {
          const pt = PK3D.parseParticles(await res.arrayBuffer());
          if (layer.style && (layer.style.markersize || layer.style.size)) view3d.view.ptSize = layer.style.markersize || layer.style.size;
          if (layer.style && (layer.style.opacity || layer.style.alpha)) view3d.view.ptAlpha = layer.style.opacity || layer.style.alpha;
          view3d.view.setParticles(pt.meta, pt.xyz, pt.scalar);
          setStatus(`点云 ${pt.meta.count} 点`, "ok");
        } else {
          setStatus("点云加载失败", "warn");
        }
      } catch (err) {
        setStatus(`点云加载失败：${err.message}`, "warn");
      }
      continue;
    }
    if (!data.x || !data.y || !data.z) continue;   // 其余图层必须有 x/y/z
    const surfaceLike = ["surface", "trisurf", "voxels", "heatmap", "contourf"].includes(layer.kind);
    if (surfaceLike) {
      // 曲面走三角网格：服务端给顶点 + 法线 + 索引，前端只 drawElements
      try {
        const res = await fetch(`api/mesh?x=${encodeURIComponent(data.x)}&y=${encodeURIComponent(data.y)}` +
                                `&z=${encodeURIComponent(data.z)}&stride=1`);
        if (res.ok) {
          const m = PK3D.parseMesh(await res.arrayBuffer());
          out.push({
            name: `${layer.kind} ${++seen}`,
            mode: "mesh",
            positions: m.positions,
            normals: m.normals,
            indices: m.indices,
            color: PK3D.hexToRgba(PK3D.PALETTE[colorIndex++ % PK3D.PALETTE.length]),
          });
          continue;
        }
      } catch (err) {
        setStatus(`曲面加载失败，退回点云：${err.message}`, "warn");
      }
    }
    const url = `api/xyz?x=${encodeURIComponent(data.x)}&y=${encodeURIComponent(data.y)}` +
                `&z=${encodeURIComponent(data.z)}&max=300000`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const frame = PK3D.parseFrame(await res.arrayBuffer());
      const lineLike = ["line3d", "stream3d", "line", "step"].includes(layer.kind);
      out.push({
        name: `${layer.kind} ${++seen}`,
        mode: lineLike ? "lines" : "points",
        positions: frame.positions,
        color: PK3D.hexToRgba(PK3D.PALETTE[colorIndex++ % PK3D.PALETTE.length]),
      });
    } catch (err) {
      setStatus(`三维数据加载失败：${err.message}`, "bad");
    }
  }
  return out;
}

async function toggle3d(force) {
  const want = force === undefined ? !view3d.on : !!force;
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
      setStatus(`3D 视图不可用：${err.message}`, "bad");
      return;
    }
    view3d.view.onSelect = async ({ rect, mvp }) => {
      const layer = (state.spec.layers || []).find((l) => l.data && l.data.x && l.data.y && l.data.z);
      const panel = $("plot3d-region");
      if (!layer || !mvp) return;
      panel.hidden = false;
      panel.textContent = "区域统计中…";
      try {
        const res = await fetch("api/region", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x: layer.data.x, y: layer.data.y, z: layer.data.z, mvp, rect }),
        });
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          throw new Error(detail.detail || `HTTP ${res.status}`);
        }
        const body = await res.json();
        const f = (v) => (Math.abs(v) >= 1e4 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(2) : v.toFixed(3));
        const z = body.stats && body.stats.z;
        panel.textContent = (z && z.count)
          ? `选中 ${body.count}/${body.total} 点（${(body.ratio * 100).toFixed(1)}%）
` +
            `z  min ${f(z.min)}   max ${f(z.max)}
` +
            `   mean ${f(z.mean)}  p05 ${f(z.p05)}  p95 ${f(z.p95)}`
          : "框内没有点（试试更大的框）";
      } catch (err) {
        panel.textContent = `区域统计失败：${err.message}`;
      }
    };
    view3d.view.onStats = ({ fps, points }) => {
      hud.hidden = false;
      hud.textContent = `${fps.toFixed(0)} fps · ${(points / 1000).toFixed(0)}k 点`;
      hud.style.left = "12px";
      hud.style.top = "12px";
    };
  }
  const layers = await load3dLayers();
  const hasVolumeOrPoints = !!(view3d.view && (view3d.view.vol || view3d.view.ptCount));
  if (!layers.length && !hasVolumeOrPoints) {
    setStatus("当前没有带 z 的图层（scatter3d / line3d / stream3d 才有）", "bad");
    return;
  }
  const total = view3d.view.setLayers(layers);
  const first = layers[0] || {};
  const meta = first.meta || {};
  view3d.view.axisNames = [meta.x || "x", meta.y || "y", meta.z || "z"];
  view3d.view.title = (state.spec.figure && state.spec.figure.title) || state.spec.title || "";
  view3d.on = true;
  canvas.hidden = false;
  $("plot3d-deco").hidden = false;
  plot.classList.add("mode-3d");
  $("btn-3d").classList.add("on");
  loadTimeline3d().catch(() => {});
  setStatus(`3D 视图 · ${layers.length} 图层 / ${(total / 1000).toFixed(0)}k 点（拖动旋转，滚轮缩放，Shift 平移）`, "good");
}

/* ---------------- 三维时间轴（位姿表驱动，拖动不请求服务端） ---------------- */

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
  const url = `api/timeline?x=${encodeURIComponent(d.x)}&y=${encodeURIComponent(d.y)}` +
              `&z=${encodeURIComponent(d.z)}&t=${encodeURIComponent(d.t)}&frames=240`;
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
    setStatus(`时间轴不可用：${err.message}`, "warn");
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
  $("plot3d-time").textContent = `${data.t[idx].toFixed(2)} · ${idx + 1}/${n}`;
}

function stopPlay3d() {
  timeline3d.playing = false;
  if (timeline3d.timer) clearInterval(timeline3d.timer);
  timeline3d.timer = 0;
  $("btn-3d-play").textContent = "▶";
}

function togglePlay3d() {
  if (timeline3d.playing) { stopPlay3d(); return; }
  if (!timeline3d.data) return;
  timeline3d.playing = true;
  $("btn-3d-play").textContent = "⏸";
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

$("btn-3d").addEventListener("click", () => { toggle3d().catch((err) => setStatus(err.message, "bad")); });

/* ---------------- 缩放 / 平移 / 读数（D34） ---------------- */

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
  fetch(`api/pick?x=${x}&y=${y}&sx=${sx}&sy=${sy}`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      pickBusy = false;
      if (!data || !data.hit || seq !== pickSeq) return;
      chip.textContent = `x ${data.x.toPrecision(6)}   y ${data.y.toPrecision(6)}   #${data.i}`;
    })
    .catch(() => { pickBusy = false; });
}

function hoverAt(ev) {
  const chip = $("plotHover");
  const hit = axesFraction(ev);
  if (!hit || !hit.inside || !state.img.xlim || !state.img.ylim) { chip.hidden = true; return; }
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
  const factor = Math.exp(ev.deltaY * 0.0015);
  const [x0, x1] = state.img.xlim, [y0, y1] = state.img.ylim;
  const cx = x0 + hit.fx * (x1 - x0), cy = y0 + hit.fy * (y1 - y0);
  state.view.xlim = [cx - (cx - x0) * factor, cx + (x1 - cx) * factor];
  state.view.ylim = [cy - (cy - y0) * factor, cy + (y1 - cy) * factor];
  const scale = Math.max(0.5, Math.min(2, 1 / factor));
  $("plotImg").style.transform = `scale(${scale})`;
  zooming = true;
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => { zooming = false; }, 320);
  schedulePreview();
  scheduleRender("缩放");
}, { passive: false });

let plotDrag = null;
$("plot").addEventListener("pointerdown", (ev) => {
  if (!state.img || !state.img.xlim || ev.button !== 0) return;
  plotDrag = { x: ev.clientX, y: ev.clientY, xlim: state.img.xlim.slice(),
               ylim: state.img.ylim.slice(), moved: false };
  $("plot").classList.add("dragging");
  try { $("plot").setPointerCapture(ev.pointerId); } catch (_) { /* 合成事件下会抛，忽略 */ }
});
$("plot").addEventListener("pointermove", (ev) => {
  if (!plotDrag) { hoverAt(ev); return; }
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
  if (moved) scheduleRender("平移");
  else $("plotImg").style.transform = "none";
}
$("plot").addEventListener("pointerup", endPlotDrag);
$("plot").addEventListener("pointercancel", endPlotDrag);
$("plot").addEventListener("dblclick", () => {
  state.view = { xlim: null, ylim: null };
  $("plotImg").style.transform = "none";
  redraw("复位视图");
});
$("plot").addEventListener("pointerleave", () => { $("plotHover").hidden = true; });

renderMenus();
bindShortcuts();
boot();

// 调试入口（前端自检用；不影响功能）
window.__pk = { get state() { return state; }, renderInsetOverlay, renderInsets, undo, redo, commit, renderLayers, scheduleLayoutSave, redraw, hoverAt };
