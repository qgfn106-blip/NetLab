import { api, jsonRequest } from "./net.js";
function analysisTfRequest(body, options = {}) {
  return jsonRequest("/api/analysis/tf", "POST", body, options);
}
function analysisExportRequest(body, options = {}) {
  return jsonRequest("/api/analysis/export", "POST", body, options);
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
export {
  acSweepRequest,
  analysisExportRequest,
  analysisTfApi,
  analysisTfRequest,
  operatingPointRequest
};
