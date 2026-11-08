import { api } from "./net.js";
import { toast } from "./desktop.js";
function cacheHuman(n) {
  n = Number(n) || 0;
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + " GB";
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
  return Math.round(n) + " B";
}
function ensureCacheWin() {
  let win = document.getElementById("cacheWin");
  if (win) return win;
  win = document.createElement("div");
  win.id = "cacheWin";
  win.style.cssText = "position:fixed;inset:0;background:rgba(8,10,8,.36);display:none;z-index:90;";
  win.innerHTML = `
      <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(680px,92vw);
                  max-height:82vh;display:flex;flex-direction:column;border-radius:10px;overflow:hidden;
                  background:var(--paper-2,#faf8f2);border:1px solid var(--line,#cfc6b5);
                  box-shadow:0 18px 48px rgba(0,0,0,.28);color:var(--text-primary,#080a08);font:13px/1.5 'Microsoft YaHei UI',sans-serif;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;
                    border-bottom:1px solid var(--line,#cfc6b5);">
          <strong>\u7F13\u5B58\u4F53\u68C0\u4E0E\u6E05\u7406</strong>
          <button type="button" data-close style="border:0;background:transparent;font-size:16px;cursor:pointer;">\u2715</button>
        </div>
        <div id="cacheBody" style="padding:12px 16px;overflow:auto;"></div>
        <div style="display:flex;gap:8px;align-items:center;padding:10px 16px;border-top:1px solid var(--line,#cfc6b5);">
          <span id="cacheMsg" style="flex:1;color:var(--text-secondary,#7b7266);font-size:12px;">\u53EA\u6E05\u7406\u53EF\u518D\u751F\u6210\u7684\u7F13\u5B58\uFF1B\u5DE5\u7A0B\u3001\u81EA\u52A8\u4FDD\u5B58\u3001\u5BFC\u51FA\u7684\u56FE\u90FD\u4E0D\u4F1A\u88AB\u5220\u3002</span>
          <button type="button" data-act="scan" class="ghost">\u91CD\u65B0\u626B\u63CF</button>
          <button type="button" data-act="safe" class="primary">\u6E05\u7406\u5B89\u5168\u7F13\u5B58</button>
          <button type="button" data-act="caution" class="ghost">\u8FDE\u540C\u754C\u9762\u504F\u597D\u2026</button>
        </div>
      </div>`;
  document.body.appendChild(win);
  win.addEventListener("click", (ev) => {
    if (ev.target === win || ev.target.closest("[data-close]")) win.style.display = "none";
  });
  win.querySelector('[data-act="scan"]').addEventListener("click", () => renderCacheBody());
  win.querySelector('[data-act="safe"]').addEventListener("click", () => cleanCache(false));
  win.querySelector('[data-act="caution"]').addEventListener("click", () => cleanCache(true));
  return win;
}
function openCacheDialog() {
  ensureCacheWin().style.display = "block";
  renderCacheBody();
}
function renderCacheBody() {
  const body = document.getElementById("cacheBody");
  if (!body) return;
  body.textContent = "\u6B63\u5728\u626B\u63CF\u2026";
  api("/api/cache/status").then((data) => {
    body.textContent = "";
    const entries = (data.entries || []).filter((e) => e.exists);
    if (!entries.length) {
      body.textContent = "\u6CA1\u6709\u53D1\u73B0\u53EF\u6E05\u7406\u7684\u7F13\u5B58\u3002";
      return;
    }
    const tierName = { safe: "\u5B89\u5168", caution: "\u8C28\u614E", protected: "\u4FDD\u62A4" };
    entries.forEach((e) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-bottom:1px dashed var(--line,#cfc6b5);";
      const tag = document.createElement("span");
      tag.textContent = tierName[e.tier] || e.tier;
      tag.style.cssText = "flex:none;font-size:11px;padding:1px 6px;border-radius:9px;border:1px solid var(--line,#cfc6b5);color:var(--text-secondary,#7b7266);";
      const mid = document.createElement("div");
      mid.style.cssText = "flex:1;min-width:0;";
      const t = document.createElement("div");
      t.textContent = e.label;
      const p = document.createElement("div");
      p.textContent = e.path;
      p.style.cssText = "font-size:11px;color:var(--text-secondary,#7b7266);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      mid.append(t, p);
      if (e.note) {
        const n = document.createElement("div");
        n.textContent = e.note;
        n.style.cssText = "font-size:11px;color:var(--text-secondary,#7b7266);";
        mid.appendChild(n);
      }
      const size = document.createElement("span");
      size.textContent = cacheHuman(e.bytes);
      size.style.cssText = "flex:none;font-variant-numeric:tabular-nums;";
      row.append(tag, mid, size);
      body.appendChild(row);
    });
    const total = document.createElement("div");
    total.style.cssText = "padding-top:10px;font-weight:600;";
    total.textContent = `\u5408\u8BA1\uFF1A\u5B89\u5168 ${cacheHuman(data.totals.safe)}\uFF0C\u8C28\u614E ${cacheHuman(data.totals.caution)}`;
    body.appendChild(total);
    const msg = document.getElementById("cacheMsg");
    if (msg) msg.textContent = "\u53EA\u6E05\u7406\u53EF\u518D\u751F\u6210\u7684\u7F13\u5B58\uFF1B\u5DE5\u7A0B\u3001\u81EA\u52A8\u4FDD\u5B58\u3001\u5BFC\u51FA\u7684\u56FE\u90FD\u4E0D\u4F1A\u88AB\u5220\u3002";
  }).catch((error) => {
    body.textContent = `\u626B\u63CF\u5931\u8D25\uFF1A${error?.message || error}`;
    const msg = document.getElementById("cacheMsg");
    if (msg) msg.textContent = "\u7F13\u5B58\u72B6\u6001\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u684C\u9762\u4F1A\u8BDD\u6216\u540E\u7AEF\u8FDE\u63A5\u3002";
  });
}
function cleanCache(withCaution) {
  const msg = document.getElementById("cacheMsg");
  if (withCaution && !window.confirm("\u8C28\u614E\u6863\u4F1A\u5220\u6389\u6D4F\u89C8\u5668\u7528\u6237\u6570\u636E\uFF08\u9762\u677F\u5BBD\u5EA6\u7B49\u754C\u9762\u504F\u597D\u4F1A\u91CD\u7F6E\uFF09\u3002\u7EE7\u7EED\uFF1F")) return;
  if (msg) msg.textContent = "\u6B63\u5728\u6E05\u7406\u2026";
  api("/api/cache/clean", {
    method: "POST",
    body: JSON.stringify({ dry_run: false, caution: !!withCaution })
  }).then((data) => {
    const freed = cacheHuman(data.freed_bytes || 0);
    const skipped = (data.skipped || []).length;
    toast(`\u5DF2\u6E05\u7406 ${freed}${skipped ? `\uFF0C${skipped} \u9879\u88AB\u8DF3\u8FC7\uFF08\u5360\u7528/\u53D7\u4FDD\u62A4\uFF09` : ""}`, "info", 3200);
    renderCacheBody();
  }).catch((error) => {
    if (msg) msg.textContent = `\u6E05\u7406\u5931\u8D25\uFF1A${error?.message || error}`;
  });
}
function checkCacheQuietly() {
  api("/api/cache/status").then((data) => {
    const safe = data.totals && data.totals.safe || 0;
    if (safe > 300 * 1048576) {
      toast(`\u7F13\u5B58\u5DF2\u5360 ${cacheHuman(safe)}\uFF0C\u53EF\u5728 \u5DE5\u5177 \u2192 \u7F13\u5B58\u4F53\u68C0\u4E0E\u6E05\u7406 \u91CC\u91CA\u653E`, "info", 6e3);
    }
  }).catch(() => {
  });
}
export {
  checkCacheQuietly,
  openCacheDialog
};
