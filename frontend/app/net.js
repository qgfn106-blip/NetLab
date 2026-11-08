const DESKTOP_TOKEN = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token") || "";
    if (token) {
      params.delete("token");
      const query = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
      );
    }
    return token;
  } catch (error) {
    return "";
  }
})();
async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs) || 15e3);
  const headers = { "Content-Type": "application/json" };
  if (DESKTOP_TOKEN) headers["X-Netlab-Token"] = DESKTOP_TOKEN;
  const config = {
    headers,
    signal: controller.signal,
    ...options
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
        throw new Error(`\u670D\u52A1\u5668\u8FD4\u56DE\u4E86\u65E0\u6CD5\u89E3\u6790\u7684\u6570\u636E\uFF08HTTP ${response.status}\uFF09`);
      }
    }
    if (!response.ok) {
      let detail = payload && payload.detail;
      if (detail && typeof detail !== "string") detail = JSON.stringify(detail);
      if (response.status === 403 && /token/i.test(String(detail || ""))) {
        throw new Error("\u684C\u9762\u4F1A\u8BDD token \u65E0\u6548\uFF1A\u8BF7\u4ECE\u684C\u9762\u7A97\u53E3\u91CD\u65B0\u6253\u5F00\u9875\u9762");
      }
      throw new Error(detail || `\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`);
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("\u8BF7\u6C42\u8D85\u65F6\uFF1A\u540E\u7AEF\u53EF\u80FD\u672A\u542F\u52A8\u6216\u8BA1\u7B97\u963B\u585E\uFF0815 \u79D2\uFF09");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function jsonRequest(path, method, body) {
  return api(path, { method, body: body === void 0 ? void 0 : JSON.stringify(body) });
}
function plotkitFrameUrl(extra) {
  const params = new URLSearchParams(extra || {});
  const query = params.toString();
  return `/plotkit/${query ? `?${query}` : ""}`;
}
export {
  DESKTOP_TOKEN,
  api,
  jsonRequest,
  plotkitFrameUrl
};
