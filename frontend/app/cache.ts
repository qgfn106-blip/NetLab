import type { CacheEntryRec } from './types.js';
import { api } from './net.js';
import { toast } from './desktop.js';

  // ---- 缓存体检与安全清理（D88）----
  function cacheHuman(n: number) {
    n = Number(n) || 0;
    if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
    return Math.round(n) + ' B';
  }

  function ensureCacheWin() {
    let win = document.getElementById('cacheWin');
    if (win) return win;
    win = document.createElement('div');
    win.id = 'cacheWin';
    win.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,8,.36);display:none;z-index:90;';
    win.innerHTML = `
      <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(680px,92vw);
                  max-height:82vh;display:flex;flex-direction:column;border-radius:10px;overflow:hidden;
                  background:var(--paper-2,#faf8f2);border:1px solid var(--line,#cfc6b5);
                  box-shadow:0 18px 48px rgba(0,0,0,.28);color:var(--text-primary,#080a08);font:13px/1.5 'Microsoft YaHei UI',sans-serif;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;
                    border-bottom:1px solid var(--line,#cfc6b5);">
          <strong>缓存体检与清理</strong>
          <button type="button" data-close style="border:0;background:transparent;font-size:16px;cursor:pointer;">✕</button>
        </div>
        <div id="cacheBody" style="padding:12px 16px;overflow:auto;"></div>
        <div style="display:flex;gap:8px;align-items:center;padding:10px 16px;border-top:1px solid var(--line,#cfc6b5);">
          <span id="cacheMsg" style="flex:1;color:var(--text-secondary,#7b7266);font-size:12px;">只清理可再生成的缓存；工程、自动保存、导出的图都不会被删。</span>
          <button type="button" data-act="scan" class="ghost">重新扫描</button>
          <button type="button" data-act="safe" class="primary">清理安全缓存</button>
          <button type="button" data-act="caution" class="ghost">连同界面偏好…</button>
        </div>
      </div>`;
    document.body.appendChild(win);
    win.addEventListener('click', (ev) => {
      if (ev.target === win || (ev.target! as Element).closest('[data-close]')) win.style.display = 'none';
    });
    win!.querySelector('[data-act="scan"]')!.addEventListener('click', () => renderCacheBody());
    win!.querySelector('[data-act="safe"]')!.addEventListener('click', () => cleanCache(false));
    win!.querySelector('[data-act="caution"]')!.addEventListener('click', () => cleanCache(true));
    return win;
  }

  export function openCacheDialog() {
    ensureCacheWin().style.display = 'block';
    renderCacheBody();
  }

  function renderCacheBody() {
    const body = document.getElementById('cacheBody');
    if (!body) return;
    body.textContent = '正在扫描…';
    api('/api/cache/status').then((data) => {
      body.textContent = '';
      const entries = (data.entries || []).filter((e: CacheEntryRec) => e.exists);
      if (!entries.length) {
        body.textContent = '没有发现可清理的缓存。';
        return;
      }
      const tierName = { safe: '安全', caution: '谨慎', protected: '保护' };
      entries.forEach((e: CacheEntryRec) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-bottom:1px dashed var(--line,#cfc6b5);';
        const tag = document.createElement('span');
        tag.textContent = (tierName[e.tier as keyof typeof tierName] || e.tier) as string;
        tag.style.cssText = 'flex:none;font-size:11px;padding:1px 6px;border-radius:9px;border:1px solid var(--line,#cfc6b5);color:var(--text-secondary,#7b7266);';
        const mid = document.createElement('div');
        mid.style.cssText = 'flex:1;min-width:0;';
        const t = document.createElement('div');
        t.textContent = e.label as string;
        const p = document.createElement('div');
        p.textContent = e.path as string;
        p.style.cssText = 'font-size:11px;color:var(--text-secondary,#7b7266);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        mid.append(t, p);
        if (e.note) {
          const n = document.createElement('div');
          n.textContent = e.note as string;
          n.style.cssText = 'font-size:11px;color:var(--text-secondary,#7b7266);';
          mid.appendChild(n);
        }
        const size = document.createElement('span');
        size.textContent = cacheHuman((e.bytes as number));
        size.style.cssText = 'flex:none;font-variant-numeric:tabular-nums;';
        row.append(tag, mid, size);
        body.appendChild(row);
      });
      const total = document.createElement('div');
      total.style.cssText = 'padding-top:10px;font-weight:600;';
      total.textContent = `合计：安全 ${cacheHuman(data.totals.safe)}，谨慎 ${cacheHuman(data.totals.caution)}`;
      body.appendChild(total);
      const msg = document.getElementById('cacheMsg');
      if (msg) msg.textContent = '只清理可再生成的缓存；工程、自动保存、导出的图都不会被删。';
    }).catch((error) => {
      body.textContent = `扫描失败：${(error as Error)?.message || error}`;
      const msg = document.getElementById('cacheMsg');
      if (msg) msg.textContent = '缓存状态读取失败，请检查桌面会话或后端连接。';
    });
  }

  function cleanCache(withCaution: boolean) {
    const msg = document.getElementById('cacheMsg');
    if (withCaution && !window.confirm('谨慎档会删掉浏览器用户数据（面板宽度等界面偏好会重置）。继续？')) return;
    if (msg) msg.textContent = '正在清理…';
    api('/api/cache/clean', {
      method: 'POST',
      body: JSON.stringify({ dry_run: false, caution: !!withCaution }),
    }).then((data) => {
      const freed = cacheHuman(data.freed_bytes || 0);
      const skipped = (data.skipped || []).length;
      toast(`已清理 ${freed}${skipped ? `，${skipped} 项被跳过（占用/受保护）` : ''}`, 'info', 3200);
      renderCacheBody();
    }).catch((error) => {
      if (msg) msg.textContent = `清理失败：${(error as Error)?.message || error}`;
    });
  }

  export function checkCacheQuietly() {
    api('/api/cache/status').then((data) => {
      const safe = (data.totals && data.totals.safe) || 0;
      if (safe > 300 * 1048576) {
        toast(`缓存已占 ${cacheHuman(safe)}，可在 工具 → 缓存体检与清理 里释放`, 'info', 6000);
      }
    }).catch(() => {});
  }
