import { DESKTOP_TOKEN, api, jsonRequest } from "./net.js";
function analysisTfRequest(body, _options) {
  return jsonRequest("/api/analysis/tf", "POST", body);
}
function analysisExportRequest(body, _options) {
  return jsonRequest("/api/analysis/export", "POST", body);
}
function operatingPointRequest(options = {}) {
  return api("/api/operating-point", options);
}
function acSweepRequest(params, options = {}) {
  return api(`/api/ac-sweep?${params.toString()}`, options);
}
function analysisTfApi(body, options = {}) {
  return api("/api/analysis/tf", { method: "POST", body: JSON.stringify(body), ...options });
}
function analysisLoopsRequest(body) {
  return jsonRequest("/api/analysis/loops", "POST", body);
}
function analysisLoopCandidatesRequest(body) {
  return jsonRequest("/api/analysis/loops/candidates", "POST", body);
}
function analysisLoopFromBreakRequest(body) {
  return jsonRequest("/api/analysis/loops/from-break", "POST", body);
}
function analysisLoopRequest(body) {
  return jsonRequest("/api/analysis/loop", "POST", body);
}
function analysisNyquistRequest(body) {
  return jsonRequest("/api/analysis/nyquist", "POST", body);
}
function workbenchStatePayload(label, select = true) {
  return api(`/api/analysis/workbench/state-payload?label=${encodeURIComponent(label)}&select=${select ? "true" : "false"}`);
}
function workbenchSessionsRequest() {
  return api("/api/analysis/workbench/sessions");
}
function workbenchCreateSessionRequest(name) {
  return jsonRequest("/api/analysis/workbench/sessions", "POST", { name });
}
function workbenchSessionRequest(sessionId) {
  return api("/api/analysis/workbench/session/" + encodeURIComponent(sessionId));
}
function workbenchStateRequest(body) {
  return jsonRequest("/api/analysis/workbench/state", "POST", body);
}
function workbenchRunRequest(body) {
  return jsonRequest("/api/analysis/workbench/run", "POST", body);
}
function workbenchCompareRequest(body) {
  return jsonRequest("/api/analysis/workbench/compare", "POST", body);
}
function workbenchInvalidateRequest(body) {
  return jsonRequest("/api/analysis/workbench/invalidate", "POST", body);
}
async function workbenchExportRequest(body) {
  const headers = { "Content-Type": "application/json" };
  if (DESKTOP_TOKEN) headers["X-Netlab-Token"] = DESKTOP_TOKEN;
  const response = await fetch("/api/analysis/workbench/export", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = String(payload && (payload.detail || payload.error) || "");
    } catch (error) {
      detail = await response.text().catch(() => "");
    }
    throw new Error(detail || `\u5BFC\u51FA\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`);
  }
  return response;
}
export {
  acSweepRequest,
  analysisExportRequest,
  analysisLoopCandidatesRequest,
  analysisLoopFromBreakRequest,
  analysisLoopRequest,
  analysisLoopsRequest,
  analysisNyquistRequest,
  analysisTfApi,
  analysisTfRequest,
  operatingPointRequest,
  workbenchCompareRequest,
  workbenchCreateSessionRequest,
  workbenchExportRequest,
  workbenchInvalidateRequest,
  workbenchRunRequest,
  workbenchSessionRequest,
  workbenchSessionsRequest,
  workbenchStatePayload,
  workbenchStateRequest
};
