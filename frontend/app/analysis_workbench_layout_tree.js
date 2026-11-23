const LAYOUT_PRESETS = [
  ["auto", "\u81EA\u52A8\u7F51\u683C"],
  ["row", "\u5DE6\u53F3\u5206\u680F"],
  ["column", "\u4E0A\u4E0B\u5206\u680F"],
  ["tabs", "\u6807\u7B7E\u9875"]
];
const RATIO_MIN = 0.15;
const RATIO_MAX = 0.85;
function isRecordNode(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function clampRatio(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.5;
  return Math.max(RATIO_MIN, Math.min(RATIO_MAX, parsed));
}
function emptyLayout() {
  return { tabs: [], activeTab: "" };
}
function canvasNode(canvasId) {
  return { type: "canvas", canvasId };
}
function collectCanvasIds(node) {
  if (!node) return [];
  if (node.type === "canvas") return [node.canvasId];
  if (node.type === "auto") return [...node.canvasIds];
  if (node.type === "tabs") return node.children.map((child) => child.canvasId);
  return [...collectCanvasIds(node.first), ...collectCanvasIds(node.second)];
}
function firstCanvasId(node) {
  if (!node) return "";
  if (node.type === "canvas") return node.canvasId;
  if (node.type === "auto") return node.canvasIds[0] || "";
  if (node.type === "tabs") return node.children[0]?.canvasId || "";
  return firstCanvasId(node.first) || firstCanvasId(node.second);
}
function rootForCanvasIds(canvasIds, preset = "auto") {
  const ids = Array.from(new Set(canvasIds.filter(Boolean)));
  if (!ids.length) return null;
  if (ids.length === 1 && preset !== "tabs") return canvasNode(ids[0]);
  if (preset === "tabs") {
    if (ids.length === 1) return canvasNode(ids[0]);
    return { type: "tabs", active: ids[0], children: ids.map((id) => ({ type: "canvas", canvasId: id })) };
  }
  if (preset === "auto") {
    if (ids.length === 1) return canvasNode(ids[0]);
    return { type: "auto", canvasIds: ids };
  }
  const axis = preset === "row" ? "row" : "column";
  const build = (items) => {
    if (items.length === 1) return canvasNode(items[0]);
    const mid = Math.ceil(items.length / 2);
    return { type: "split", axis, ratio: 0.5, first: build(items.slice(0, mid)), second: build(items.slice(mid)) };
  };
  return build(ids);
}
function normalizeNode(value, valid, used) {
  if (!isRecordNode(value)) return null;
  const type = value.type;
  if (type === "canvas") {
    const id = typeof value.canvasId === "string" ? value.canvasId : "";
    if (!valid.has(id) || used.has(id)) return null;
    used.add(id);
    return canvasNode(id);
  }
  if (type === "split") {
    const first = normalizeNode(value.first, valid, used);
    const second = normalizeNode(value.second, valid, used);
    if (!first || !second) return first || second;
    const axis = value.axis === "column" ? "column" : "row";
    return { type: "split", axis, ratio: clampRatio(value.ratio), first, second };
  }
  if (type === "tabs") {
    const children = [];
    const rawChildren = Array.isArray(value.children) ? value.children : [];
    for (const child of rawChildren) {
      const node = normalizeNode(child, valid, used);
      if (node && node.type === "canvas") children.push(node);
    }
    if (!children.length) return null;
    if (children.length === 1) return children[0];
    const active = typeof value.active === "string" && children.some((child) => child.canvasId === value.active) ? value.active : children[0].canvasId;
    return { type: "tabs", active, children };
  }
  if (type === "auto") {
    const rawIds = Array.isArray(value.canvasIds) ? value.canvasIds : [];
    const ids = [];
    for (const raw of rawIds) {
      if (typeof raw !== "string" || !valid.has(raw) || used.has(raw)) continue;
      used.add(raw);
      ids.push(raw);
    }
    if (!ids.length) return null;
    if (ids.length === 1) return canvasNode(ids[0]);
    return { type: "auto", canvasIds: ids };
  }
  return null;
}
function migrateV1Layout(value, canvasIds) {
  const order = isRecordNode(value) && Array.isArray(value.order) ? value.order.filter((id) => typeof id === "string" && canvasIds.includes(id)) : [];
  const ids = order.length ? order : canvasIds;
  if (!ids.length) return emptyLayout();
  const mode = isRecordNode(value) && typeof value.mode === "string" ? value.mode : "grid";
  const preset = mode === "split" ? "row" : "auto";
  const root = rootForCanvasIds(ids, preset);
  return { tabs: root ? [{ id: "tab-1", title: "\u4E3B\u89C6\u56FE", root }] : [], activeTab: root ? "tab-1" : "" };
}
function appendMissing(root, ids) {
  if (!ids.length) return root;
  if (!root) return rootForCanvasIds(ids, "auto");
  const current = collectCanvasIds(root);
  const missing = ids.filter((id) => !current.includes(id));
  if (!missing.length) return root;
  if (root.type === "auto") return { type: "auto", canvasIds: [...root.canvasIds, ...missing] };
  if (root.type === "tabs") {
    const children = [...root.children, ...missing.map((id) => ({ type: "canvas", canvasId: id }))];
    return { type: "tabs", active: root.active, children };
  }
  return { type: "split", axis: "row", ratio: 0.7, first: root, second: rootForCanvasIds(missing, "auto") };
}
function normalizeLayout(value, canvasIds, legacy) {
  if (legacy || isRecordNode(value) && !Array.isArray(value.tabs)) return migrateV1Layout(value, canvasIds);
  if (!isRecordNode(value)) return migrateV1Layout(null, canvasIds);
  const valid = new Set(canvasIds);
  const used = /* @__PURE__ */ new Set();
  const tabs = [];
  const rawTabs = Array.isArray(value.tabs) ? value.tabs : [];
  const seenTabIds = /* @__PURE__ */ new Set();
  rawTabs.forEach((raw, index) => {
    if (!isRecordNode(raw)) return;
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : "tab-" + (index + 1);
    if (seenTabIds.has(id)) return;
    const root = normalizeNode(raw.root, valid, used);
    if (!root) return;
    seenTabIds.add(id);
    const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "\u89C6\u56FE " + (tabs.length + 1);
    tabs.push({ id, title, root });
  });
  const missing = canvasIds.filter((id) => valid.has(id) && !used.has(id));
  if (missing.length) {
    if (tabs.length) tabs[tabs.length - 1].root = appendMissing(tabs[tabs.length - 1].root, missing);
    else {
      const root = rootForCanvasIds(missing, "auto");
      if (root) tabs.push({ id: "tab-1", title: "\u4E3B\u89C6\u56FE", root });
    }
  }
  if (!tabs.length) return emptyLayout();
  const activeTab = typeof value.activeTab === "string" && tabs.some((tab) => tab.id === value.activeTab) ? value.activeTab : tabs[0].id;
  return { tabs, activeTab };
}
function findTab(layout, tabId) {
  return layout.tabs.find((tab) => tab.id === tabId) || null;
}
function findCanvasTab(layout, canvasId) {
  return layout.tabs.find((tab) => collectCanvasIds(tab.root).includes(canvasId)) || null;
}
function replaceLeaf(node, targetId, replacement) {
  if (node.type === "canvas") return node.canvasId === targetId ? replacement : node;
  if (node.type === "auto") return node;
  if (node.type === "tabs") {
    return {
      type: "tabs",
      active: node.active === targetId ? firstCanvasId(replacement) : node.active,
      children: node.children.map((child) => ({ type: "canvas", canvasId: child.canvasId === targetId ? firstCanvasId(replacement) : child.canvasId }))
    };
  }
  return { ...node, first: replaceLeaf(node.first, targetId, replacement), second: replaceLeaf(node.second, targetId, replacement) };
}
function removeLeaf(node, canvasId) {
  if (node.type === "canvas") return node.canvasId === canvasId ? null : node;
  if (node.type === "auto") {
    const ids = node.canvasIds.filter((id) => id !== canvasId);
    if (!ids.length) return null;
    if (ids.length === 1) return canvasNode(ids[0]);
    return { type: "auto", canvasIds: ids };
  }
  if (node.type === "tabs") {
    const children = node.children.filter((child) => child.canvasId !== canvasId);
    if (!children.length) return null;
    if (children.length === 1) return children[0];
    return { type: "tabs", active: node.active === canvasId ? children[0].canvasId : node.active, children };
  }
  const first = removeLeaf(node.first, canvasId);
  const second = removeLeaf(node.second, canvasId);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}
function removeCanvasFromLayout(layout, canvasId) {
  const tabs = [];
  for (const tab of layout.tabs) {
    const root = removeLeaf(tab.root, canvasId);
    if (root) tabs.push({ ...tab, root });
  }
  let activeTab = layout.activeTab;
  if (!tabs.some((tab) => tab.id === activeTab)) activeTab = tabs[0]?.id || "";
  return { tabs, activeTab };
}
function appendCanvas(layout, canvasId, tabId = "") {
  const tabs = layout.tabs.map((tab) => ({ ...tab }));
  let target = tabs.find((tab) => tab.id === tabId) || tabs.find((tab) => tab.id === layout.activeTab) || tabs[tabs.length - 1];
  if (!target) {
    const root = rootForCanvasIds([canvasId], "auto");
    const id = "tab-" + Date.now().toString(36);
    return { tabs: [{ id, title: "\u4E3B\u89C6\u56FE", root }], activeTab: id };
  }
  target.root = appendMissing(target.root, [canvasId]);
  return { tabs, activeTab: target.id };
}
function containsCanvasInTabs(node, canvasId) {
  if (node.type === "tabs") return node.children.some((child) => child.canvasId === canvasId);
  if (node.type === "split") return containsCanvasInTabs(node.first, canvasId) || containsCanvasInTabs(node.second, canvasId);
  return false;
}
function splitCanvasInLayout(layout, targetId, draggedId, axis, position) {
  const without = removeCanvasFromLayout(layout, draggedId);
  const tabs = without.tabs.map((tab) => {
    if (!collectCanvasIds(tab.root).includes(targetId)) return tab;
    const dragged = canvasNode(draggedId);
    const target = canvasNode(targetId);
    const split = position === "before" ? { type: "split", axis, ratio: 0.5, first: dragged, second: target } : { type: "split", axis, ratio: 0.5, first: target, second: dragged };
    if (containsCanvasInTabs(tab.root, targetId)) {
      const root = position === "before" ? { type: "split", axis, ratio: 0.5, first: dragged, second: tab.root } : { type: "split", axis, ratio: 0.5, first: tab.root, second: dragged };
      return { ...tab, root };
    }
    return { ...tab, root: replaceLeaf(tab.root, targetId, split) };
  });
  return { ...without, tabs };
}
function insertIntoCanvasTabs(node, targetId, draggedId) {
  if (node.type === "tabs") {
    if (!node.children.some((child) => child.canvasId === targetId)) return node;
    return { type: "tabs", active: draggedId, children: [...node.children, { type: "canvas", canvasId: draggedId }] };
  }
  if (node.type === "canvas") {
    if (node.canvasId !== targetId) return node;
    return {
      type: "tabs",
      active: draggedId,
      children: [
        { type: "canvas", canvasId: targetId },
        { type: "canvas", canvasId: draggedId }
      ]
    };
  }
  if (node.type === "split") {
    return { ...node, first: insertIntoCanvasTabs(node.first, targetId, draggedId), second: insertIntoCanvasTabs(node.second, targetId, draggedId) };
  }
  return node;
}
function mergeCanvasIntoTabs(layout, targetId, draggedId) {
  const without = removeCanvasFromLayout(layout, draggedId);
  const tabs = without.tabs.map((tab) => collectCanvasIds(tab.root).includes(targetId) ? { ...tab, root: insertIntoCanvasTabs(tab.root, targetId, draggedId) } : tab);
  return { ...without, tabs };
}
function arrangeRoot(root, preset) {
  return rootForCanvasIds(collectCanvasIds(root), preset);
}
function layoutPresetOf(root) {
  if (root.type === "auto") return "auto";
  if (root.type === "tabs") return "tabs";
  if (root.type === "canvas") return "auto";
  return root.axis === "row" ? "row" : "column";
}
function cloneCanvasRec(rec, canvasId, title) {
  return {
    ...rec,
    canvas_id: canvasId,
    title,
    view_state: rec.view_state ? JSON.parse(JSON.stringify(rec.view_state)) : void 0,
    appearance: rec.appearance ? JSON.parse(JSON.stringify(rec.appearance)) : void 0
  };
}
export {
  LAYOUT_PRESETS,
  appendCanvas,
  arrangeRoot,
  canvasNode,
  cloneCanvasRec,
  collectCanvasIds,
  emptyLayout,
  findCanvasTab,
  findTab,
  firstCanvasId,
  layoutPresetOf,
  mergeCanvasIntoTabs,
  migrateV1Layout,
  normalizeLayout,
  removeCanvasFromLayout,
  removeLeaf,
  replaceLeaf,
  rootForCanvasIds,
  splitCanvasInLayout
};
