/* P1-S3 S2：分析类 HTTP 边界统一封装（tf / export / operating-point / ac-sweep）。
 * 纯搬运既有调用，行为不变；供 analysis.ts 与 ac_analysis.ts 共用。 */
import { api, jsonRequest } from './net.js';
import type { ApiOptions } from './net.js';

export function analysisTfRequest(body: unknown, options: ApiOptions = {}) {
  return jsonRequest('/api/analysis/tf', 'POST', body, options);
}

export function analysisExportRequest(body: unknown, options: ApiOptions = {}) {
  return jsonRequest('/api/analysis/export', 'POST', body, options);
}

export function operatingPointRequest(options: ApiOptions = {}) {
  return api('/api/operating-point', options);
}

export function acSweepRequest(params: URLSearchParams, options: ApiOptions = {}) {
  return api(`/api/ac-sweep?${params.toString()}`, options);
}

export function analysisTfApi(body: unknown, options: ApiOptions = {}) {
  return api('/api/analysis/tf', { method: 'POST', body: JSON.stringify(body), ...options });
}
