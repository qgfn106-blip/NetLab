/* Netlab API client (S5 split from app.ts; behavior unchanged). */

export interface ApiOptions {
    timeoutMs?: number;
    headers?: Record<string, string>;
    method?: string;
    body?: string;
    quiet?: boolean;
    skipConfirm?: boolean;
    min?: number;
    max?: number;
    step?: number | string;
    [k: string]: unknown;
  }

export const DESKTOP_TOKEN = (() => {    try {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token') || '';
      if (token) {
        params.delete('token');
        const query = params.toString();
        window.history.replaceState(
          {},
          '',
          `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
        );
      }
      return token;
    } catch (error) {
      return '';
    }
  })();

export async function api(path: string, options: ApiOptions = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs) || 15000);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (DESKTOP_TOKEN) headers['X-Netlab-Token'] = DESKTOP_TOKEN;
    const config = {
      headers,
      signal: controller.signal,
      ...options,
    };
    if (options.headers) config.headers = { ...headers, ...options.headers };
    try {
      const response = await fetch(path, config);
      const text = await response.text();
      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch (error) {
          throw new Error(`服务器返回了无法解析的数据（HTTP ${response.status}）`);
        }
      }
      if (!response.ok) {
        let detail = payload && payload.detail;
        if (detail && typeof detail !== 'string') detail = JSON.stringify(detail);
        if (response.status === 403 && /token/i.test(String(detail || ''))) {
          throw new Error('桌面会话 token 无效：请从桌面窗口重新打开页面');
        }
        throw new Error(detail || `请求失败（HTTP ${response.status}）`);
      }
      return payload;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error('请求超时：后端可能未启动或计算阻塞（15 秒）');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

export function jsonRequest(path: string, method: string, body?: unknown) {
    return api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  // PlotKit 子应用是独立页面，拿不到 api() 的请求头；桌面鉴权走宿主同源 cookie
  // （桌面外壳打开 /?token= 时种下，HttpOnly + SameSite=Strict），子应用自己的
  // fetch/导航会自动携带。不要把 token 放进 URL 查询串或片段。
export function plotkitFrameUrl(extra: string | Record<string, string>) {
    const params = new URLSearchParams(extra || {});
    const query = params.toString();
    return `/plotkit/${query ? `?${query}` : ''}`;
  }
