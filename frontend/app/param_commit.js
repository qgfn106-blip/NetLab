import { collectParamValues } from "./param_fields.js";
async function wbCommitNodeParam(deps, nodeId, control, baseParams) {
  let values;
  try {
    values = collectParamValues(control.parentElement || control);
  } catch (error) {
    deps.toast(error.message, "error", 5e3);
    return;
  }
  const merged = Object.assign({}, baseParams, values);
  try {
    const resp = await deps.jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, "PATCH", {
      params: merged
    });
    if (!resp) return;
    Object.assign(baseParams, values);
    if (resp.node) {
      const list = deps.state.scene?.nodes || [];
      const index = list.findIndex((item) => item.id === nodeId);
      if (index >= 0) list[index] = Object.assign({}, list[index], resp.node);
    }
    if (resp.sim) deps.state.sim = resp.sim;
    deps.wbMarkDirty();
  } catch (error) {
    deps.toast(error?.message || String(error), "error", 6e3);
  }
}
async function wbCommitEdgeParam(deps, edgeId, control, baseParams) {
  let values;
  try {
    values = collectParamValues(control.parentElement || control);
  } catch (error) {
    deps.toast(error.message, "error", 5e3);
    return;
  }
  const merged = Object.assign({}, baseParams, values);
  try {
    const resp = await deps.jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, "PATCH", {
      params: merged
    });
    if (!resp) return;
    Object.assign(baseParams, values);
    if (resp.edge) {
      const list = deps.state.scene?.edges || [];
      const index = list.findIndex((item) => item.id === edgeId);
      if (index >= 0) list[index] = Object.assign({}, list[index], resp.edge);
    }
    if (resp.sim) deps.state.sim = resp.sim;
    deps.wbMarkDirty();
  } catch (error) {
    deps.toast(error?.message || String(error), "error", 6e3);
  }
}
async function wbCommitSimParam(deps, key, control) {
  let values;
  try {
    values = collectParamValues(control.parentElement || control);
  } catch (error) {
    deps.toast(error.message, "error", 5e3);
    return;
  }
  try {
    const resp = await deps.jsonRequest("/api/config", "PATCH", {
      [key]: values[key]
    });
    if (!resp) return;
    if (resp.sim) deps.state.sim = resp.sim;
    deps.wbMarkDirty();
  } catch (error) {
    deps.toast(error?.message || String(error), "error", 6e3);
  }
}
async function wbCommitIntegration(deps, control) {
  let values;
  try {
    values = collectParamValues(control.parentElement || control);
  } catch (error) {
    deps.toast(error.message, "error", 5e3);
    return;
  }
  try {
    const resp = await deps.jsonRequest("/api/scene", "PATCH", {
      integration: values["integration"]
    });
    if (!resp) return;
    deps.applySnapshot(resp);
    deps.wbMarkDirty();
  } catch (error) {
    deps.toast(error?.message || String(error), "error", 6e3);
  }
}
export {
  wbCommitEdgeParam,
  wbCommitIntegration,
  wbCommitNodeParam,
  wbCommitSimParam
};
