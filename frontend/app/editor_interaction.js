import { clamp } from "../app.utils.js";
import { ENDPOINTS } from "./endpoints.js";
import { canvas } from "./dom.js";
import { pointerPosition } from "./canvas_geometry.js";
import { state, ui } from "./state.js";
import { toast } from "./desktop.js";
import { jsonRequest } from "./net.js";
import { selectedNode, selectedEdge, nodeById, edgeById } from "./model.js";
import { drawGraph, requestDraw } from "./canvas_render.js";
import { screenToWorld, nodeDiameter, nodeRect, snapWorld, edgeEndpointHit, waypointHitAt, anchorSideFor, edgePathPoints, pathMidpoint } from "./geometry.js";
import { multiSelection, toggleMultiSelection, pushUndoSnapshot } from "./commands.js";
import { switchTab } from "./editor_runtime.js";
import { completeWireTool, onContextMenu, patchEdgeGeometry, patchNodeGeometry, queuePositionSave, wireToolEndpointAt, closePopups, openAddMenu, openLinkMenu, createWire, renderInspector, selectEntity, hitTest, nearestNodeWithin, task, zoomAt } from "./editor_services.js";
function bindCanvas() {
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", () => {
    if (state.drag) return;
    if (state.hoverWaypoint) {
      state.hoverWaypoint = null;
      requestDraw();
    }
    if (ui.statusCursor) ui.statusCursor.textContent = "x \u2014  y \u2014";
    if (state.hover) {
      state.hover = null;
      requestDraw();
      canvas.style.cursor = "default";
    }
  });
  canvas.addEventListener("dblclick", onDoubleClick);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button === 1) {
      event.preventDefault();
    }
  });
}
function onPointerDown(event) {
  if (event.button === 2) return;
  closePopups();
  const point = pointerPosition(event);
  state.pointer = { ...point, ...screenToWorld(point.x, point.y) };
  if (event.button === 1) {
    state.drag = {
      type: "pan",
      startX: point.x,
      startY: point.y,
      viewX: state.view.x,
      viewY: state.view.y
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
    event.preventDefault();
    return;
  }
  const primaryNode = selectedNode();
  if (state.wireTool && event.button === 0) {
    const endpoint = wireToolEndpointAt(point);
    if (!endpoint) {
      toast("\u8BF7\u70B9\u51FB\u7F51\u7EDC\u8282\u70B9\u6216\u5668\u4EF6\u5F15\u811A\uFF08Esc \u53D6\u6D88\u5BFC\u7EBF\u5DE5\u5177\uFF09", "info", 2400);
      return;
    }
    if (!state.wireTool.first) {
      state.wireTool.first = endpoint;
      if (ui.statusHint) ui.statusHint.textContent = "\u5BFC\u7EBF\u5DE5\u5177\uFF1A\u8D77\u70B9\u5DF2\u9009\uFF0C\u70B9\u51FB\u7B2C\u4E8C\u4E2A\u7AEF\u70B9\uFF08Esc \u53D6\u6D88\uFF09";
      requestDraw();
    } else {
      void completeWireTool(endpoint);
    }
    event.preventDefault();
    return;
  }
  if (primaryNode && !event.ctrlKey && !event.metaKey) {
    const rect = nodeRect(primaryNode);
    const hx = rect.cx + rect.r - 2;
    const hy = rect.cy + rect.r - 2;
    if (Math.abs(point.x - hx) <= 8 && Math.abs(point.y - hy) <= 8) {
      state.drag = {
        type: "resize",
        id: primaryNode.id,
        startDiameter: nodeDiameter(primaryNode),
        startX: point.x,
        startY: point.y
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "nwse-resize";
      event.preventDefault();
      return;
    }
  }
  const primaryEdge = selectedEdge();
  if (primaryEdge && !event.ctrlKey && !event.metaKey) {
    const endpoint = edgeEndpointHit(point);
    if (endpoint) {
      const edgeRecord = edgeById(endpoint.id);
      state.drag = {
        type: "endpoint",
        id: endpoint.id,
        end: endpoint.end,
        anchor: edgeRecord?.anchors && edgeRecord.anchors[endpoint.end] || "auto",
        moved: false
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "crosshair";
      requestDraw();
      event.preventDefault();
      return;
    }
  }
  if (!event.ctrlKey && !event.metaKey) {
    const waypoint = waypointHitAt(point, true);
    if (waypoint) {
      if (state.selection.type !== "edge" || state.selection.id !== waypoint.edge.id) {
        state.selection = { type: "edge", id: waypoint.edge.id };
        state.inspectorDirty = false;
        renderInspector();
      }
      state.drag = { type: "waypoint", id: waypoint.edge.id, index: waypoint.index, moved: false };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
      requestDraw();
      event.preventDefault();
      return;
    }
  }
  if (primaryEdge && event.altKey) {
    const world = screenToWorld(point.x, point.y);
    const snapped = snapWorld(world.x, world.y, event.altKey);
    const waypoints = [...primaryEdge.waypoints || [], { x: snapped.x, y: snapped.y }];
    void patchEdgeGeometry(primaryEdge.id, { route: "manual", waypoints });
    return;
  }
  const hit = hitTest(point.x, point.y);
  if ((event.ctrlKey || event.metaKey) && hit && (hit.type === "node" || hit.type === "edge")) {
    toggleMultiSelection(hit.type, hit.id);
    event.preventDefault();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !hit) {
    state.drag = {
      type: "box",
      startX: point.x,
      startY: point.y,
      x: point.x,
      y: point.y
    };
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  if (hit && hit.type === "pin") {
    state.drag = {
      type: "pin",
      sourceId: hit.id,
      pin: hit.pin,
      startX: point.x,
      startY: point.y
    };
    canvas.setPointerCapture(event.pointerId);
    requestDraw();
    event.preventDefault();
    return;
  }
  if (hit && hit.type === "port") {
    state.drag = {
      type: "link",
      sourceId: hit.id,
      targetId: null,
      startX: point.x,
      startY: point.y
    };
    canvas.setPointerCapture(event.pointerId);
    requestDraw();
    event.preventDefault();
    return;
  }
  if (hit && hit.type === "node") {
    const node = hit.node;
    const multi = multiSelection();
    const inGroup = !event.ctrlKey && !event.metaKey && multi.nodes.has(node.id);
    if (inGroup) {
      const origins = /* @__PURE__ */ new Map();
      for (const id of multi.nodes) {
        const item = nodeById(id);
        if (item?.position) origins.set(id, { x: item.position.x, y: item.position.y });
      }
      if (origins.size > 1) {
        const waypointOrigins = /* @__PURE__ */ new Map();
        for (const edgeItem of state.scene?.edges || []) {
          if (!edgeItem.waypoints?.length) continue;
          if (!origins.has(edgeItem.source) || !origins.has(edgeItem.target)) continue;
          waypointOrigins.set(edgeItem.id, edgeItem.waypoints.map((point2) => ({ ...point2 })));
        }
        state.drag = {
          type: "nodes",
          startX: point.x,
          startY: point.y,
          origins,
          waypoints: waypointOrigins,
          moved: false
        };
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = "grabbing";
        event.preventDefault();
        return;
      }
    }
    void selectEntity("node", node.id);
    state.drag = {
      type: "node",
      id: node.id,
      startX: point.x,
      startY: point.y,
      originX: node.position.x,
      originY: node.position.y,
      moved: false
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
    event.preventDefault();
    return;
  }
  if (hit && hit.type === "edge") {
    void selectEntity("edge", hit.id);
    drawGraph();
    return;
  }
  void selectEntity(null, null);
  state.drag = {
    type: "pan",
    startX: point.x,
    startY: point.y,
    viewX: state.view.x,
    viewY: state.view.y,
    moved: false
  };
  canvas.setPointerCapture(event.pointerId);
  canvas.style.cursor = "grab";
}
function onPointerMove(event) {
  const point = pointerPosition(event);
  const world = screenToWorld(point.x, point.y);
  state.pointer = { ...point, ...world };
  const cursorText = `x ${world.x.toFixed(1)}  y ${world.y.toFixed(1)}`;
  if (ui.statusCursor && ui.statusCursor.textContent !== cursorText) {
    ui.statusCursor.textContent = cursorText;
  }
  if (!state.drag) {
    const waypoint = waypointHitAt(point, true);
    if (waypoint) {
      state.hoverWaypoint = { edgeId: waypoint.edge.id, index: waypoint.index };
      canvas.style.cursor = "grab";
      requestDraw();
      return;
    }
    if (state.hoverWaypoint) {
      state.hoverWaypoint = null;
      requestDraw();
    }
    if (edgeEndpointHit(point)) {
      canvas.style.cursor = "crosshair";
      return;
    }
    const hit = hitTest(point.x, point.y);
    const nextHover = hit ? { type: hit.type, id: hit.id } : null;
    const changed = (nextHover?.type || null) !== (state.hover?.type || null) || (nextHover?.id || null) !== (state.hover?.id || null);
    if (changed) {
      state.hover = nextHover;
      requestDraw();
    }
    if (!hit) canvas.style.cursor = "default";
    else if (hit.type === "port" || hit.type === "pin") canvas.style.cursor = "crosshair";
    else if (hit.type === "node") canvas.style.cursor = "grab";
    else canvas.style.cursor = "pointer";
    return;
  }
  const drag = state.drag;
  if (drag.type === "box") {
    drag.x = point.x;
    drag.y = point.y;
    requestDraw();
    return;
  }
  if (drag.type === "pan") {
    state.view.x = drag.viewX + (point.x - drag.startX);
    state.view.y = drag.viewY + (point.y - drag.startY);
    drag.moved = true;
    requestDraw();
    return;
  }
  if (drag.type === "resize") {
    const node = nodeById(drag.id);
    if (!node) return;
    const rect = nodeRect(node);
    const world2 = screenToWorld(point.x, point.y);
    const center = { x: node.position.x, y: node.position.y };
    const raw = Math.hypot(world2.x - center.x, world2.y - center.y) * 2;
    const snapped = state.ui?.snap && !event.altKey ? Math.round(raw / (Number(state.ui.grid) || 20)) * (Number(state.ui.grid) || 20) : raw;
    const diameter = clamp(snapped, 24, 200);
    state.drag.diameter = diameter;
    drag.diameter = diameter;
    node.size = { w: diameter };
    rect.r = diameter / 2 * state.view.k;
    drag.moved = true;
    requestDraw();
    return;
  }
  if (drag.type === "endpoint") {
    const edge = edgeById(drag.id);
    if (!edge) return;
    const node = nodeById(drag.end === "source" ? edge.source : edge.target);
    if (!node) return;
    const side = anchorSideFor(node, point);
    drag.anchor = side;
    edge.anchors = Object.assign({}, edge.anchors || {}, { [drag.end]: side });
    drag.moved = true;
    requestDraw();
    return;
  }
  if (drag.type === "waypoint") {
    const edge = edgeById(drag.id);
    if (!edge) return;
    const world2 = screenToWorld(point.x, point.y);
    const snapped = snapWorld(world2.x, world2.y, event.altKey);
    edge.waypoints[drag.index] = { x: snapped.x, y: snapped.y };
    drag.moved = true;
    requestDraw();
    return;
  }
  if (drag.type === "nodes") {
    const k = state.view.k;
    const dx = (point.x - drag.startX) / k;
    const dy = (point.y - drag.startY) / k;
    const origins = drag.origins;
    let appliedDx = dx;
    let appliedDy = dy;
    let firstOrigin = true;
    for (const [id, origin] of origins) {
      const node = nodeById(id);
      if (!node?.position) continue;
      const snapped = snapWorld(origin.x + dx, origin.y + dy, event.altKey);
      if (firstOrigin) {
        appliedDx = snapped.x - origin.x;
        appliedDy = snapped.y - origin.y;
        firstOrigin = false;
      }
      node.position.x = snapped.x;
      node.position.y = snapped.y;
    }
    const waypointOrigins = drag.waypoints;
    for (const [edgeId, points] of waypointOrigins || []) {
      const edgeItem = edgeById(edgeId);
      if (!edgeItem) continue;
      edgeItem.waypoints = points.map((point2) => ({
        x: Math.round((point2.x + appliedDx) * 100) / 100,
        y: Math.round((point2.y + appliedDy) * 100) / 100
      }));
    }
    drag.moved = true;
    requestDraw();
    return;
  }
  if (drag.type === "node") {
    const k = state.view.k;
    const node = nodeById(drag.id);
    if (!node) return;
    const rawX = clamp(drag.originX + (point.x - drag.startX) / k, -1e4, 1e4);
    const rawY = clamp(drag.originY + (point.y - drag.startY) / k, -1e4, 1e4);
    const snapped = snapWorld(rawX, rawY, event.altKey);
    node.position.x = snapped.x;
    node.position.y = snapped.y;
    drag.moved = true;
    requestDraw();
    return;
  }
  if (drag.type === "link") {
    const target = nearestNodeWithin(point.x, point.y, 18);
    drag.targetId = target && target.id !== drag.sourceId ? target.id : target ? target.id : null;
    requestDraw();
  }
}
async function onPointerUp(event) {
  const drag = state.drag;
  state.drag = null;
  state.hoverWaypoint = null;
  canvas.style.cursor = "default";
  if (!drag) return;
  try {
    canvas.releasePointerCapture(event.pointerId);
  } catch (error) {
  }
  if (drag.type === "box") {
    const x1 = Math.min(drag.startX, drag.x);
    const x2 = Math.max(drag.startX, drag.x);
    const y1 = Math.min(drag.startY, drag.y);
    const y2 = Math.max(drag.startY, drag.y);
    if (x2 - x1 > 3 && y2 - y1 > 3) {
      const nodes = (state.scene?.nodes || []).filter((node) => {
        const rect = nodeRect(node);
        return rect.cx >= x1 && rect.cx <= x2 && rect.cy >= y1 && rect.cy <= y2;
      });
      const nodeIds = new Set(nodes.map((node) => node.id));
      const edges = (state.scene?.edges || []).filter((edge) => {
        const points = edgePathPoints(edge);
        const middle = points ? pathMidpoint(points) : null;
        if (middle) return middle.x >= x1 && middle.x <= x2 && middle.y >= y1 && middle.y <= y2;
        return nodeIds.has(edge.source) && nodeIds.has(edge.target);
      });
      state.multi.nodes = new Set(nodes.map((node) => node.id));
      state.multi.edges = new Set(edges.map((edge) => edge.id));
      requestDraw();
      toast(`\u6846\u9009 ${nodes.length} \u8282\u70B9 / ${edges.length} \u8FDE\u63A5`, "info", 1800);
    }
    return;
  }
  if (drag.type === "nodes" && drag.moved) {
    await pushUndoSnapshot();
    const waypointOrigins = drag.waypoints;
    for (const [edgeId] of waypointOrigins || []) {
      const edgeItem = edgeById(edgeId);
      if (!edgeItem) continue;
      await task(
        () => jsonRequest(ENDPOINTS.edge(edgeId), "PATCH", { waypoints: edgeItem.waypoints || [] }),
        { history: false }
      );
    }
    const origins = drag.origins;
    for (const id of origins.keys()) queuePositionSave(id);
  }
  if (drag.type === "node" && drag.moved) {
    await pushUndoSnapshot();
    queuePositionSave(drag.id);
  }
  if (drag.type === "resize" && drag.moved) {
    const node = nodeById(drag.id);
    if (node) void patchNodeGeometry(node.id, { size: { w: node.size?.w || nodeDiameter(node) } });
  }
  if (drag.type === "waypoint" && drag.moved) {
    const edge = edgeById(drag.id);
    if (edge) void patchEdgeGeometry(edge.id, { waypoints: edge.waypoints });
  }
  if (drag.type === "endpoint" && drag.moved) {
    const edge = edgeById(drag.id);
    if (edge) void patchEdgeGeometry(edge.id, { anchors: edge.anchors });
  }
  if (drag.type === "link") {
    const point = pointerPosition(event);
    const target = nearestNodeWithin(point.x, point.y, 18);
    if (target) {
      openLinkMenu(target.id, point.x, point.y, drag.sourceId);
    }
    requestDraw();
  }
  if (drag.type === "pin") {
    const point = pointerPosition(event);
    const target = nearestNodeWithin(point.x, point.y, 18);
    if (target && (target.kind === "node" || target.kind === "ground")) {
      void createWire(drag.sourceId, target.id, drag.pin);
    } else {
      toast("\u8BF7\u628A\u5F15\u811A\u62D6\u5230\u7F51\u7EDC\u8282\u70B9\uFF08\u7535\u5B66\u8282\u70B9/\u63A5\u5730\uFF09", "error", 3500);
    }
    requestDraw();
  }
}
function onDoubleClick(event) {
  const point = pointerPosition(event);
  const hit = hitTest(point.x, point.y);
  if (hit && hit.type === "node") {
    void selectEntity("node", hit.id, true);
    switchTab("inspect");
  } else if (hit && hit.type === "edge") {
    void selectEntity("edge", hit.id, true);
    switchTab("inspect");
  } else {
    openAddMenu(point.x, point.y);
  }
}
function onWheel(event) {
  event.preventDefault();
  const point = pointerPosition(event);
  const factor = Math.exp(-event.deltaY * 15e-4);
  zoomAt(factor, point.x, point.y);
}
export {
  bindCanvas,
  onDoubleClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel
};
