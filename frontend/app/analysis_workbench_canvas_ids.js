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
