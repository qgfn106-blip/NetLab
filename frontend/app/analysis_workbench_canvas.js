import { createAnalysisChart } from "./analysis_chart.js";
import { KIND_LABELS } from "./analysis_workbench_meta.js";
import {
  appendCanvas,
  arrangeRoot,
  canvasNode,
  cloneCanvasRec,
  collectCanvasIds,
  findCanvasTab,
  findTab,
  firstCanvasId,
  layoutPresetOf,
  mergeCanvasIntoTabs,
  normalizeLayout,
  removeCanvasFromLayout,
  splitCanvasInLayout
} from "./analysis_workbench_layout_tree.js";
function newCanvasId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch (error) {
  }
  return "canvas-" + Date.now().toString(36) + "-" + Math.random().toString(16).slice(2, 10);
}
function newTabId() {
  return "tab-" + Date.now().toString(36) + "-" + Math.random().toString(16).slice(2, 6);
}
function cloneNodeWithNewIds(node, map) {
  if (node.type === "canvas") {
    const id = newCanvasId();
    map.set(node.canvasId, id);
    return { type: "canvas", canvasId: id };
  }
  if (node.type === "auto") {
    return { type: "auto", canvasIds: node.canvasIds.map((id) => {
      const copy = newCanvasId();
      map.set(id, copy);
      return copy;
    }) };
  }
  if (node.type === "tabs") {
    const children = node.children.map((child) => {
      const id = newCanvasId();
      map.set(child.canvasId, id);
      return { type: "canvas", canvasId: id };
    });
    return { type: "tabs", active: children[0]?.canvasId || "", children };
  }
  return {
    type: "split",
    axis: node.axis,
    ratio: node.ratio,
    first: cloneNodeWithNewIds(node.first, map),
    second: cloneNodeWithNewIds(node.second, map)
  };
}
function containsTabsNode(node, canvasId) {
  if (node.type === "canvas") return false;
  if (node.type === "auto") return false;
  if (node.type === "tabs") return node.children.some((child) => child.canvasId === canvasId);
  return containsTabsNode(node.first, canvasId) || containsTabsNode(node.second, canvasId);
}
class AnalysisCanvasWorkspace {
  constructor(host, detailHost, saved, layout, events) {
    this.entries = [];
    this.activeId = "";
    this.maximizedId = "";
    this.dragCanvasId = "";
    this.dragTabId = "";
    this.dropTargetId = "";
    this.dropPosition = "";
    this.menu = null;
    this.menuAway = null;
    this.host = host;
    this.detailHost = detailHost;
    this.events = events;
    this.root = document.createElement("div");
    this.root.className = "awb-canvas-grid";
    this.root.dataset.awb = "canvas-workspace";
    this.tabbar = document.createElement("div");
    this.tabbar.className = "awb-tabbar";
    this.tabbar.dataset.awb = "tabbar";
    this.bodyHost = document.createElement("div");
    this.bodyHost.className = "awb-canvas-body";
    this.bodyHost.dataset.awb = "canvas-body";
    this.root.append(this.tabbar, this.bodyHost);
    this.host.append(this.root);
    this.layoutRec = normalizeLayout(layout, saved.map((rec) => rec.canvas_id), false);
    for (const rec of saved) this.createEntry(rec);
    this.activeId = saved.length ? firstCanvasId(this.activeRoot()) || saved[0].canvas_id : "";
    this.bindDropTarget();
    this.render();
  }
  activeRoot() {
    return findTab(this.layoutRec, this.layoutRec.activeTab)?.root || null;
  }
  createEntry(rec) {
    const tile = document.createElement("section");
    tile.className = "awb-canvas-tile";
    tile.dataset.canvasId = rec.canvas_id;
    const head = document.createElement("header");
    head.className = "awb-canvas-head";
    head.draggable = true;
    head.title = "\u62D6\u52A8\u5230\u53E6\u4E00\u4E2A\u5B50\u56FE\u8FB9\u7F18\u53EF\u5206\u5272\uFF0C\u62D6\u5230\u4E2D\u592E\u53EF\u5408\u5E76\u4E3A\u6807\u7B7E\u9875";
    const title = document.createElement("span");
    title.className = "awb-canvas-title";
    title.textContent = rec.title || KIND_LABELS[rec.kind] || rec.kind;
    const chip = document.createElement("span");
    chip.className = "awb-canvas-chip";
    chip.textContent = KIND_LABELS[rec.kind] || rec.kind;
    const spacer = document.createElement("span");
    spacer.className = "awb-canvas-spacer";
    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "awb-canvas-icon";
    menuButton.dataset.awb = "canvas-menu";
    menuButton.title = "\u5B50\u56FE\u83DC\u5355";
    menuButton.textContent = "\u22EF";
    const maxButton = document.createElement("button");
    maxButton.type = "button";
    maxButton.className = "awb-canvas-icon";
    maxButton.dataset.awb = "canvas-max";
    maxButton.title = "\u6700\u5927\u5316 / \u6062\u590D";
    maxButton.textContent = "\u2922";
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "awb-canvas-icon";
    closeButton.dataset.awb = "canvas-close";
    closeButton.title = "\u5173\u95ED\u5B50\u56FE";
    closeButton.textContent = "\xD7";
    head.append(title, chip, spacer, menuButton, maxButton, closeButton);
    const body = document.createElement("div");
    body.className = "awb-canvas-body";
    tile.append(head, body);
    const chart = createAnalysisChart(body, {
      title: rec.title || KIND_LABELS[rec.kind] || rec.kind,
      detailHost: null,
      events: {
        onCursor: (frequency, source, unit, axisKey) => this.events.onCursor?.(frequency, source, rec.canvas_id, unit, axisKey),
        onPin: () => this.events.onPin?.(rec.canvas_id),
        onViewChange: () => this.events.onChange?.()
      }
    });
    tile.addEventListener("pointerdown", () => {
      if (this.activeId !== rec.canvas_id) this.activate(rec.canvas_id);
    });
    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.openTileMenu(rec.canvas_id, menuButton);
    });
    maxButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggleMaximized(rec.canvas_id);
    });
    closeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.closeCanvas(rec.canvas_id);
    });
    head.addEventListener("dragstart", (event) => {
      this.dragCanvasId = rec.canvas_id;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", rec.canvas_id);
      }
      tile.classList.add("dragging");
    });
    head.addEventListener("dragend", () => {
      this.dragCanvasId = "";
      this.clearDropIndicator();
      tile.classList.remove("dragging");
    });
    const entry = { rec, tile, body, chart };
    this.entries.push(entry);
    return entry;
  }
  entry(id) {
    return this.entries.find((item) => item.rec.canvas_id === id);
  }
  render() {
    this.root.dataset.active = this.activeId;
    this.root.dataset.layout = layoutPresetOf(this.activeRoot() || canvasNode(""));
    this.renderTabbar();
    this.bodyHost.replaceChildren();
    if (!this.entries.length) {
      const empty = document.createElement("div");
      empty.className = "awb-canvas-empty";
      empty.textContent = "\u5C1A\u672A\u751F\u6210\u5206\u6790\u5B50\u56FE\u3002\u8BBE\u7F6E\u53C2\u6570\u5E76\u8FD0\u884C\u4E00\u6B21\u5206\u6790\uFF0C\u6216\u4ECE\u9876\u90E8\u5DE5\u5177\u680F\u6DFB\u52A0\u3002";
      this.bodyHost.append(empty);
      return;
    }
    if (!this.layoutRec.tabs.length) {
      this.layoutRec = appendCanvas(this.layoutRec, this.entries[0].rec.canvas_id);
    }
    if (!findTab(this.layoutRec, this.layoutRec.activeTab)) this.layoutRec.activeTab = this.layoutRec.tabs[0]?.id || "";
    if (!this.activeId || !this.entry(this.activeId)) this.activeId = firstCanvasId(this.activeRoot()) || this.entries[0].rec.canvas_id;
    const root = this.activeRoot();
    if (!root) return;
    if (this.maximizedId && this.entry(this.maximizedId)) {
      const max = document.createElement("div");
      max.className = "awb-max-pane";
      max.append(this.entry(this.maximizedId).tile);
      this.bodyHost.append(max);
    } else {
      const rendered = this.renderNode(root);
      if (rendered) this.bodyHost.append(rendered);
    }
    for (const item of this.entries) item.tile.classList.toggle("active", item.rec.canvas_id === this.activeId);
  }
  renderTabbar() {
    this.tabbar.replaceChildren();
    this.tabbar.hidden = this.layoutRec.tabs.length <= 1;
    for (const tab of this.layoutRec.tabs) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "awb-tab";
      button.dataset.tabId = tab.id;
      button.draggable = true;
      button.textContent = tab.title;
      button.classList.toggle("active", tab.id === this.layoutRec.activeTab);
      button.addEventListener("click", () => this.setActiveTab(tab.id));
      button.addEventListener("dblclick", () => {
        const next = window.prompt("\u6807\u7B7E\u9875\u540D\u79F0", tab.title);
        if (next && next.trim()) {
          tab.title = next.trim();
          this.render();
          this.events.onChange?.();
        }
      });
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.openTabMenu(tab.id, button);
      });
      button.addEventListener("dragstart", (event) => {
        this.dragTabId = tab.id;
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });
      button.addEventListener("dragover", (event) => {
        if (this.dragTabId && this.dragTabId !== tab.id) event.preventDefault();
      });
      button.addEventListener("drop", (event) => {
        event.preventDefault();
        this.reorderTabs(this.dragTabId, tab.id);
        this.dragTabId = "";
      });
      this.tabbar.append(button);
    }
    const add = document.createElement("button");
    add.type = "button";
    add.className = "awb-tab awb-tab-add";
    add.dataset.awb = "tab-add";
    add.title = "\u65B0\u5EFA\u6807\u7B7E\u9875\uFF08\u590D\u5236\u5F53\u524D\u6807\u7B7E\u9875\uFF09";
    add.textContent = "+";
    add.addEventListener("click", () => this.newTabFromActive());
    this.tabbar.append(add);
  }
  renderNode(node) {
    if (node.type === "canvas") {
      const entry = this.entry(node.canvasId);
      if (!entry) return null;
      return entry.tile;
    }
    if (node.type === "auto") {
      const grid = document.createElement("div");
      grid.className = "awb-auto-grid";
      grid.dataset.count = String(node.canvasIds.length);
      for (const id of node.canvasIds) {
        const entry = this.entry(id);
        if (entry) grid.append(entry.tile);
      }
      return grid;
    }
    if (node.type === "tabs") {
      const wrap = document.createElement("div");
      wrap.className = "awb-tabs";
      const bar = document.createElement("div");
      bar.className = "awb-tabs-bar";
      for (const child of node.children) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "awb-tab awb-tab-inner";
        button.dataset.innerTab = child.canvasId;
        button.textContent = this.entry(child.canvasId)?.rec.title || child.canvasId;
        button.classList.toggle("active", node.active === child.canvasId);
        button.addEventListener("click", () => {
          if (node.active === child.canvasId) return;
          node.active = child.canvasId;
          this.render();
          this.events.onChange?.();
        });
        bar.append(button);
      }
      const content = document.createElement("div");
      content.className = "awb-tabs-body";
      const active = this.entry(node.active) ? node.active : node.children[0]?.canvasId || "";
      if (active) {
        node.active = active;
        const entry = this.entry(active);
        if (entry) content.append(entry.tile);
      }
      wrap.append(bar, content);
      return wrap;
    }
    const split = document.createElement("div");
    split.className = "awb-split";
    split.dataset.axis = node.axis;
    const firstPane = document.createElement("div");
    firstPane.className = "awb-pane awb-pane-first";
    firstPane.style.flexGrow = String(node.ratio);
    firstPane.style.flexBasis = "0";
    const secondPane = document.createElement("div");
    secondPane.className = "awb-pane awb-pane-second";
    secondPane.style.flexGrow = String(1 - node.ratio);
    secondPane.style.flexBasis = "0";
    const first = this.renderNode(node.first);
    const second = this.renderNode(node.second);
    if (first) firstPane.append(first);
    if (second) secondPane.append(second);
    const splitter = document.createElement("div");
    splitter.className = "awb-splitter";
    splitter.dataset.axis = node.axis;
    splitter.title = "\u62D6\u52A8\u8C03\u6574\u6BD4\u4F8B\uFF0C\u53CC\u51FB\u6062\u590D 50/50";
    splitter.addEventListener("pointerdown", (event) => this.beginSplitDrag(event, node, firstPane, secondPane));
    splitter.addEventListener("dblclick", () => {
      node.ratio = 0.5;
      this.render();
      this.events.onChange?.();
    });
    split.append(firstPane, splitter, secondPane);
    return split;
  }
  beginSplitDrag(event, node, first, second) {
    event.preventDefault();
    const parent = first.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const horizontal = node.axis === "row";
    const move = (moveEvent) => {
      const raw = horizontal ? (moveEvent.clientX - rect.left) / Math.max(1, rect.width) : (moveEvent.clientY - rect.top) / Math.max(1, rect.height);
      const ratio = Math.min(0.85, Math.max(0.15, raw));
      node.ratio = ratio;
      first.style.flexGrow = String(ratio);
      second.style.flexGrow = String(1 - ratio);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.events.onChange?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  bindDropTarget() {
    this.root.addEventListener("dragover", (event) => {
      if (!this.dragCanvasId) return;
      const tile = event.target.closest(".awb-canvas-tile");
      if (!tile) return;
      const targetId = tile.dataset.canvasId || "";
      if (!targetId || targetId === this.dragCanvasId) return;
      event.preventDefault();
      const rect = tile.getBoundingClientRect();
      const x = (event.clientX - rect.left) / Math.max(1, rect.width);
      const y = (event.clientY - rect.top) / Math.max(1, rect.height);
      let position = "center";
      if (x < 0.25) position = "left";
      else if (x > 0.75) position = "right";
      else if (y < 0.25) position = "top";
      else if (y > 0.75) position = "bottom";
      if (this.dropTargetId !== targetId || this.dropPosition !== position) {
        this.clearDropIndicator();
        this.dropTargetId = targetId;
        this.dropPosition = position;
        tile.classList.add("drop-" + position);
      }
    });
    this.root.addEventListener("dragleave", (event) => {
      if (!this.root.contains(event.relatedTarget)) this.clearDropIndicator();
    });
    this.root.addEventListener("drop", (event) => {
      if (!this.dragCanvasId || !this.dropTargetId) return;
      event.preventDefault();
      const dragged = this.dragCanvasId;
      const target = this.dropTargetId;
      const position = this.dropPosition;
      this.clearDropIndicator();
      this.dragCanvasId = "";
      this.applyDrop(target, dragged, position);
    });
  }
  clearDropIndicator() {
    this.dropTargetId = "";
    this.dropPosition = "";
    for (const entry of this.entries) {
      entry.tile.classList.remove("drop-center", "drop-left", "drop-right", "drop-top", "drop-bottom");
    }
  }
  applyDrop(targetId, draggedId, position) {
    const tab = findCanvasTab(this.layoutRec, targetId);
    if (!tab) return;
    if (position === "center" || containsTabsNode(tab.root, targetId)) {
      this.layoutRec = mergeCanvasIntoTabs(this.layoutRec, targetId, draggedId);
    } else {
      const axis = position === "left" || position === "right" ? "row" : "column";
      const side = position === "left" || position === "top" ? "before" : "after";
      this.layoutRec = splitCanvasInLayout(this.layoutRec, targetId, draggedId, axis, side);
    }
    this.maximizedId = "";
    this.activate(draggedId);
    this.render();
    this.events.onChange?.();
  }
  openMenu(anchor, items) {
    this.closeMenu();
    const menu = document.createElement("div");
    menu.className = "awb-menu";
    menu.dataset.awb = "menu";
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "awb-menu-item";
      button.textContent = item.label;
      button.disabled = item.disabled === true;
      button.addEventListener("click", () => {
        this.closeMenu();
        item.action();
      });
      menu.append(button);
    }
    document.body.append(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, rect.left)) + "px";
    menu.style.top = Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 4)) + "px";
    this.menu = menu;
    window.setTimeout(() => {
      const away = (event) => {
        if (this.menu && !this.menu.contains(event.target)) this.closeMenu();
      };
      this.menuAway = away;
      if (!this.menu) return;
      window.addEventListener("pointerdown", away);
    }, 0);
  }
  closeMenu() {
    if (this.menuAway) {
      window.removeEventListener("pointerdown", this.menuAway);
      this.menuAway = null;
    }
    if (this.menu) {
      this.menu.remove();
      this.menu = null;
    }
  }
  openTileMenu(canvasId, anchor) {
    const entry = this.entry(canvasId);
    if (!entry) return;
    this.openMenu(anchor, [
      { label: "\u5411\u53F3\u5206\u5272", action: () => this.splitCanvas(canvasId, "row", "after") },
      { label: "\u5411\u4E0B\u5206\u5272", action: () => this.splitCanvas(canvasId, "column", "after") },
      { label: "\u590D\u5236\u5B50\u56FE", action: () => this.duplicateCanvas(canvasId) },
      { label: "\u79FB\u5230\u65B0\u6807\u7B7E\u9875", action: () => this.moveToNewTab(canvasId) },
      { label: this.maximizedId === canvasId ? "\u6062\u590D\u5E03\u5C40" : "\u6700\u5927\u5316", action: () => this.toggleMaximized(canvasId) },
      { label: "\u5173\u95ED", action: () => this.closeCanvas(canvasId) }
    ]);
  }
  openTabMenu(tabId, anchor) {
    this.openMenu(anchor, [
      { label: "\u91CD\u547D\u540D", action: () => {
        const tab = findTab(this.layoutRec, tabId);
        if (!tab) return;
        const next = window.prompt("\u6807\u7B7E\u9875\u540D\u79F0", tab.title);
        if (next && next.trim()) {
          tab.title = next.trim();
          this.render();
          this.events.onChange?.();
        }
      } },
      { label: "\u590D\u5236\u6807\u7B7E\u9875", action: () => this.duplicateTab(tabId) },
      { label: "\u5173\u95ED\u6807\u7B7E\u9875", action: () => this.closeTab(tabId), disabled: this.layoutRec.tabs.length <= 1 }
    ]);
  }
  splitCanvas(canvasId, axis, position) {
    const source = this.entry(canvasId);
    if (!source) return;
    const rec = cloneCanvasRec(source.rec, newCanvasId(), (source.rec.title || "\u5B50\u56FE") + " \u526F\u672C");
    this.createEntry(rec);
    const tab = findCanvasTab(this.layoutRec, canvasId);
    if (tab && containsTabsNode(tab.root, canvasId)) {
      this.layoutRec = mergeCanvasIntoTabs(this.layoutRec, canvasId, rec.canvas_id);
    } else {
      this.layoutRec = splitCanvasInLayout(this.layoutRec, canvasId, rec.canvas_id, axis, position);
    }
    this.activate(rec.canvas_id);
    this.render();
    this.events.onChange?.();
  }
  duplicateCanvas(canvasId) {
    const source = this.entry(canvasId);
    if (!source) return;
    const rec = cloneCanvasRec(source.rec, newCanvasId(), (source.rec.title || "\u5B50\u56FE") + " \u526F\u672C");
    this.createEntry(rec);
    this.layoutRec = appendCanvas(this.layoutRec, rec.canvas_id, findCanvasTab(this.layoutRec, canvasId)?.id || "");
    this.activate(rec.canvas_id);
    this.render();
    this.events.onChange?.();
  }
  moveToNewTab(canvasId) {
    const tab = findCanvasTab(this.layoutRec, canvasId);
    if (!tab) return;
    const id = newTabId();
    this.layoutRec = removeCanvasFromLayout(this.layoutRec, canvasId);
    const remaining = this.layoutRec.tabs.length;
    this.layoutRec.tabs.push({ id, title: remaining ? "\u89C6\u56FE " + (remaining + 1) : "\u4E3B\u89C6\u56FE", root: canvasNode(canvasId) });
    this.layoutRec.activeTab = id;
    this.activate(canvasId);
    this.render();
    this.events.onChange?.();
  }
  duplicateTab(tabId) {
    const tab = findTab(this.layoutRec, tabId);
    if (!tab) return;
    const map = /* @__PURE__ */ new Map();
    const root = cloneNodeWithNewIds(tab.root, map);
    const copies = [];
    for (const [oldId, newId] of map) {
      const source = this.entry(oldId);
      if (!source) continue;
      const rec = cloneCanvasRec(source.rec, newId, source.rec.title || "\u5B50\u56FE");
      copies.push(this.createEntry(rec));
    }
    if (!copies.length) return;
    const id = newTabId();
    this.layoutRec.tabs.push({ id, title: tab.title + " \u526F\u672C", root });
    this.layoutRec.activeTab = id;
    this.activate(copies[0].rec.canvas_id);
    this.render();
    this.events.onChange?.();
  }
  closeTab(tabId) {
    const tab = findTab(this.layoutRec, tabId);
    if (!tab || this.layoutRec.tabs.length <= 1) return;
    for (const canvasId of collectCanvasIds(tab.root)) this.removeEntry(canvasId);
    this.layoutRec.tabs = this.layoutRec.tabs.filter((item) => item.id !== tabId);
    if (this.layoutRec.activeTab === tabId) this.layoutRec.activeTab = this.layoutRec.tabs[0]?.id || "";
    this.activeId = firstCanvasId(this.activeRoot()) || this.entries[0]?.rec.canvas_id || "";
    this.maximizedId = "";
    this.render();
    this.events.onChange?.();
  }
  reorderTabs(fromId, toId) {
    if (!fromId || fromId === toId) return;
    const tabs = this.layoutRec.tabs.slice();
    const from = tabs.findIndex((tab) => tab.id === fromId);
    const to = tabs.findIndex((tab) => tab.id === toId);
    if (from < 0 || to < 0) return;
    const [moved] = tabs.splice(from, 1);
    tabs.splice(to, 0, moved);
    this.layoutRec.tabs = tabs;
    this.render();
    this.events.onChange?.();
  }
  newTabFromActive() {
    const root = this.activeRoot();
    if (!root) return;
    const map = /* @__PURE__ */ new Map();
    const copy = cloneNodeWithNewIds(root, map);
    if (!map.size) return;
    const first = map.values().next().value;
    for (const [oldId, newId] of map) {
      const source = this.entry(oldId);
      if (!source) continue;
      this.createEntry(cloneCanvasRec(source.rec, newId, source.rec.title || "\u5B50\u56FE"));
    }
    const id = newTabId();
    this.layoutRec.tabs.push({ id, title: "\u89C6\u56FE " + (this.layoutRec.tabs.length + 1), root: copy });
    this.layoutRec.activeTab = id;
    this.activate(first);
    this.render();
    this.events.onChange?.();
  }
  removeEntry(canvasId) {
    const index = this.entries.findIndex((item) => item.rec.canvas_id === canvasId);
    if (index < 0) return;
    const entry = this.entries[index];
    entry.chart.destroy();
    entry.tile.remove();
    this.entries.splice(index, 1);
  }
  get layoutTree() {
    return JSON.parse(JSON.stringify(this.layoutRec));
  }
  get layout() {
    return layoutPresetOf(this.activeRoot() || canvasNode(""));
  }
  get maximizedCanvasId() {
    return this.maximizedId;
  }
  setLayout(mode, notify = true) {
    if (mode === "max") {
      if (this.activeId) this.toggleMaximized(this.activeId);
      return;
    }
    const preset = mode === "split" ? "row" : mode === "tile" || mode === "grid" ? "auto" : mode;
    this.setPreset(preset, notify);
  }
  setPreset(preset, notify = true) {
    const tab = findTab(this.layoutRec, this.layoutRec.activeTab);
    if (!tab) return;
    const root = arrangeRoot(tab.root, preset);
    if (root) tab.root = root;
    this.maximizedId = "";
    this.render();
    if (notify) this.events.onChange?.();
  }
  setActiveTab(tabId) {
    if (!findTab(this.layoutRec, tabId) || this.layoutRec.activeTab === tabId) return;
    this.layoutRec.activeTab = tabId;
    this.maximizedId = "";
    this.activeId = firstCanvasId(this.activeRoot()) || this.activeId;
    this.render();
    this.events.onChange?.();
  }
  toggleMaximized(canvasId) {
    if (!this.entry(canvasId)) return;
    this.maximizedId = this.maximizedId === canvasId ? "" : canvasId;
    this.activeId = canvasId;
    this.render();
  }
  activate(canvasId, notify = true) {
    if (!this.entry(canvasId) || this.activeId === canvasId) return;
    this.activeId = canvasId;
    const tab = findCanvasTab(this.layoutRec, canvasId);
    if (tab && this.layoutRec.activeTab !== tab.id) this.layoutRec.activeTab = tab.id;
    this.render();
    if (notify) this.events.onChange?.();
  }
  activateKind(kind) {
    const found = this.entries.find((item) => item.rec.kind === kind);
    if (found) {
      this.activate(found.rec.canvas_id);
      return found.rec.canvas_id;
    }
    const rec = {
      canvas_id: newCanvasId(),
      kind,
      figure_id: "f1",
      slot_id: this.entries.length,
      title: KIND_LABELS[kind]
    };
    return this.addCanvas(rec);
  }
  hasKind(kind) {
    return this.entries.some((item) => item.rec.kind === kind);
  }
  hasCanvas(canvasId) {
    return Boolean(this.entry(canvasId));
  }
  addCanvas(rec) {
    const entry = this.entry(rec.canvas_id) || this.createEntry(rec);
    this.layoutRec = appendCanvas(this.layoutRec, entry.rec.canvas_id, this.layoutRec.activeTab);
    this.maximizedId = "";
    this.activate(entry.rec.canvas_id, false);
    this.render();
    this.events.onChange?.();
    return entry.rec.canvas_id;
  }
  closeCanvas(canvasId) {
    const before = this.entries.findIndex((item) => item.rec.canvas_id === canvasId);
    if (before < 0) return;
    this.removeEntry(canvasId);
    this.layoutRec = removeCanvasFromLayout(this.layoutRec, canvasId);
    if (this.maximizedId === canvasId) this.maximizedId = "";
    if (this.activeId === canvasId) this.activeId = this.entries[Math.max(0, before - 1)]?.rec.canvas_id || this.entries[0]?.rec.canvas_id || "";
    this.render();
    this.events.onChange?.();
  }
  get canvases() {
    return this.entries.map((item) => item.rec);
  }
  get activeCanvas() {
    return this.entry(this.activeId)?.rec || this.entries[0]?.rec || null;
  }
  get activeKind() {
    return this.entry(this.activeId)?.rec.kind || null;
  }
  persist() {
    return this.entries.map((entry) => {
      const view = entry.chart.getViewState() || entry.viewState;
      return {
        ...entry.rec,
        ...view ? { view_state: view } : {}
      };
    });
  }
  setEnvelope(canvasId, envelope, resultKey, resultKeys) {
    const entry = this.entry(canvasId);
    if (!entry) return;
    const savedView = entry.viewState;
    entry.chart.setEnvelope(envelope);
    entry.rec.result_key = resultKey;
    entry.rec.result_keys = resultKeys && resultKeys.length ? resultKeys : void 0;
    if (resultKey) entry.tile.dataset.resultKey = resultKey;
    else delete entry.tile.dataset.resultKey;
    if (savedView) {
      entry.chart.applyViewState(savedView);
      entry.viewState = void 0;
    }
  }
  /** 清除所有子画布结果（状态/参数变化后防止旧曲线冒充新结果）。 */
  clearAllEnvelopes() {
    for (const entry of this.entries) {
      entry.chart.setEnvelope(null);
      entry.rec.result_key = void 0;
      entry.rec.result_keys = void 0;
      delete entry.tile.dataset.resultKey;
      entry.viewState = void 0;
    }
  }
  setCursor(frequency, sourceCanvasId = "", unit = "", axisKey = "") {
    for (const entry of this.entries) {
      if (entry.rec.canvas_id === sourceCanvasId) continue;
      entry.chart.setCursorFrequency(frequency, "linked", unit, axisKey);
    }
  }
  refreshActiveDetail() {
    const active = this.entry(this.activeId);
    active?.chart.setDetailHost(this.detailHost);
  }
  destroy() {
    this.closeMenu();
    for (const entry of this.entries) entry.chart.destroy();
    this.entries.length = 0;
    this.root.remove();
  }
}
export {
  AnalysisCanvasWorkspace
};
