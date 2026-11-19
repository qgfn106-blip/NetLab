/* P1-S3 S2：分析类 HTTP 边界统一封装（tf / export / operating-point / ac-sweep）。
 * 纯搬运既有调用，行为不变；供 analysis.ts 与 ac_analysis.ts 共用。 */
import { DESKTOP_TOKEN, api, jsonRequest } from './net.js';
import type { ApiOptions } from './net.js';

export function analysisTfRequest(body: unknown, _options?: ApiOptions) {
  return jsonRequest('/api/analysis/tf', 'POST', body);
}

export function analysisExportRequest(body: unknown, _options?: ApiOptions) {
  return jsonRequest('/api/analysis/export', 'POST', body);
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
/** 断环候选（受控源列表）。 */
export function analysisLoopsRequest(body: unknown) {
  return jsonRequest('/api/analysis/loops', 'POST', body);
}

/** 回路增益 / 闭环传函分析。 */
export function analysisLoopRequest(body: unknown) {
  return jsonRequest('/api/analysis/loop', 'POST', body);
}

/** Nyquist 分析。 */
export function analysisNyquistRequest(body: unknown) {
  return jsonRequest('/api/analysis/nyquist', 'POST', body);
}

export interface WorkbenchStatePayload {
  ok: boolean;
  state: Record<string, unknown>;
}

export function workbenchStatePayload(label: string, select = true) {
  return api(`/api/analysis/workbench/state-payload?label=${encodeURIComponent(label)}&select=${select ? 'true' : 'false'}`);
}

export function workbenchSessionsRequest() {
  return api('/api/analysis/workbench/sessions');
}

export function workbenchCreateSessionRequest(name: string) {
  return jsonRequest('/api/analysis/workbench/sessions', 'POST', { name });
}

export function workbenchSessionRequest(sessionId: string) {
  return api('/api/analysis/workbench/session/' + encodeURIComponent(sessionId));
}

export function workbenchStateRequest(body: unknown) {
  return jsonRequest('/api/analysis/workbench/state', 'POST', body);
}

export function workbenchRunRequest(body: unknown) {
  return jsonRequest('/api/analysis/workbench/run', 'POST', body);
}

export function workbenchCompareRequest(body: unknown) {
  return jsonRequest('/api/analysis/workbench/compare', 'POST', body);
}

export function workbenchInvalidateRequest(body: unknown) {
  return jsonRequest('/api/analysis/workbench/invalidate', 'POST', body);
}
/** 分析工作台导出：返回原始响应（二进制/文本），由调用方落盘。 */
export async function workbenchExportRequest(body: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (DESKTOP_TOKEN) headers['X-Netlab-Token'] = DESKTOP_TOKEN;
  const response = await fetch('/api/analysis/workbench/export', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json();
      detail = String((payload && (payload.detail || payload.error)) || '');
    } catch (error) {
      detail = await response.text().catch(() => '');
    }
    throw new Error(detail || `导出失败（HTTP ${response.status}）`);
  }
  return response;
}
