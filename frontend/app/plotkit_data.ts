// PlotKit 数据栏（S5-35 从 app.ts 迁出）
import { UI_BUILD } from './constants.js';
import { $, $$ } from './dom.js';
import { activeTab, selectedNode } from './model.js';
import { api, plotkitFrameUrl } from './net.js';
import { div, el } from './ui.js';
import { state, ui } from './state.js';
import { toast } from './desktop.js';
import type { SimRec } from './types.js';

let plotkitDataActions = {
  refreshState: async (_quiet = true): Promise<void> => {},
  renderAnalysisPanel: (): void => {},
  updateSignalKeyCache: (): void => {},
};

export function setPlotkitDataActions(actions: {
  refreshState: (quiet?: boolean) => Promise<void>;
  renderAnalysisPanel: () => void;
  updateSignalKeyCache: () => void;
}): void {
  plotkitDataActions = actions;
}

export let pkChannelCache: string[] = [];

export function pkKeyShort(key: string) {
    const parts = String(key).split(':');
    if (parts.length >= 3 && parts[0] === 'n') return parts.slice(1).join('.');
    return String(key);
  }

export function pkCheckedKeys() {
    return Array.from(document.querySelectorAll('#pkChannelList input[type=checkbox]'))
      .filter((el) => (el as HTMLInputElement).checked).map((el) => (el as HTMLInputElement).value);
  }

export function renderPkChannels(selected: Set<string> | string[]) {
    const box = $('#pkChannelList');
    if (!box) return;
    const want = new Set(selected && (selected as Set<string> & { length?: number }).length ? selected : pkCheckedKeys());
    box.textContent = '';
    if (!pkChannelCache.length) {
      const empty = document.createElement('span');
      empty.className = 'pk-empty';
      empty.textContent = '还没有探针数据：先运行仿真，或打开带探针的工程。';
      box.appendChild(empty);
    } else {
      pkChannelCache.forEach((key: string) => {
        const label = document.createElement('label');
        label.className = 'pk-ch';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = key;
        input.checked = want.has(key);
        const span = document.createElement('span');
        span.textContent = pkKeyShort(key);
        span.title = key;
        label.appendChild(input);
        label.appendChild(span);
        box.appendChild(label);
      });
    }
    const count = $('#pkDataCount');
    if (count) count.textContent = String(pkChannelCache.length);
  }

export function showPkChannelLoadError(message: string) {
    const hint = $('#pkDataHint');
    const box = $('#pkChannelList');
    const text = message || '请求失败';
    if (hint) hint.textContent = `数据刷新失败：${text}；现有通道列表未清除，可点击「重试」。`;
    if (pkChannelCache.length || !box) return;
    box.textContent = '';
    const empty = document.createElement('span');
    empty.className = 'pk-empty';
    empty.textContent = `探针列表加载失败：${text}`;
    box.appendChild(empty);
  }

export async function refreshPkChannels(keepSelection?: boolean) {
    const hint = $('#pkDataHint');
    try {
      const data = await api('/api/plotkit/channels');
      const avail = (data && data.available) || [];
      const registered = (data && data.channels) || [];
      if (data && data.build && data.build !== UI_BUILD) {
        pkChannelCache = avail;
        renderPkChannels([]);
        if (hint) hint.textContent = `服务端进程还是旧版本（后端 ${data.build} / 界面 ${UI_BUILD}）——请完全退出应用后重新启动；只关闭窗口可能残留旧进程。`;
        return false;
      }
      if (!data || !data.mounted) {
        pkChannelCache = avail;
        renderPkChannels([]);
        const why = (data && data.diag && data.diag.last_error) || '找不到 plotkit 包';
        if (hint) hint.textContent = `PlotKit 未挂载：${why}`;
        return false;
      }
      // 优先列「场景里的探针」（不运行也能选），已登记的也算
      pkChannelCache = avail.length ? avail : registered;
      renderPkChannels(keepSelection ? null : (data.selected || []));
      if (hint) {
        hint.textContent = avail.length
          ? `场景共 ${avail.length} 条探针，已登记 ${registered.length} 条，当前画 ${(data.selected || []).length} 条；勾选后点「接入」。`
          : '当前场景没有探针：先放探针节点或打开带探针的工程。';
      }
      return true;
    } catch (error) {
      showPkChannelLoadError((error as Error).message);
      return false;
    }
  }

export async function retryPlotkit() {
    const hint = $('#pkDataHint');
    if (hint) hint.textContent = '正在重新检测 PlotKit…';
    try {
      const data = await api('/api/plotkit/channels');
      if (data && data.mounted) {
        reloadPlotkitFrame();
        const refreshed = await refreshPkChannels(true);
        if (!refreshed) {
          toast('通道刷新失败，请查看提示', 'warn', 4000);
          return;
        }
        toast('PlotKit 已就绪', 'info', 1800);
      } else {
        const why = (data && data.diag && data.diag.last_error) || '未知原因';
        if (hint) hint.textContent = `仍然未挂载：${why}`;
        toast('PlotKit 仍未挂载，请看提示', 'warn', 4000);
      }
    } catch (error) {
      showPkChannelLoadError((error as Error).message);
      toast('重新检测失败，请查看提示', 'warn', 4000);
    }
  }

export function reloadPlotkitFrame() {
    const frame = $('#plotkitFrame');
    if (frame) (frame as HTMLIFrameElement).src = plotkitFrameUrl({ embed: '1', r: String(Date.now()) });
  }

  /** 预计算进度快照（GET /api/precompute/progress 的返回体）。 */
  export type PrecomputeProgress = {
    ok?: boolean;
    status?: string;
    running?: boolean;
    done?: number;
    total?: number;
    percent?: number;
    elapsed?: number;
    eta?: number | null;
    error?: string | null;
  };

export function mountPrecomputeBar() {
    const prior = document.getElementById('pkPrecomputeBar');
    if (prior) prior.remove();
    const host = document.createElement('div');
    host.id = 'pkPrecomputeBar';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    host.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:10000;width:min(460px,92vw);background:var(--paper-2,#f3efe6);color:var(--text-primary,#080a08);border:1px solid var(--line-strong,#b9ae98);border-radius:12px;box-shadow:0 18px 48px rgba(0,0,0,.28);padding:12px 16px 13px;font:13px/1.5 "Microsoft YaHei",system-ui,sans-serif;';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:8px;';
    const title = document.createElement('span');
    title.style.cssText = 'color:var(--text-primary,#080a08);font-weight:600;';
    title.textContent = '预计算中…';
    const pct = document.createElement('span');
    pct.style.cssText = 'color:var(--accent,#9b7247);font-weight:600;font-variant-numeric:tabular-nums;';
    pct.textContent = '0%';
    head.append(title, pct);
    const track = document.createElement('div');
    track.style.cssText = 'height:8px;border-radius:999px;background:var(--paper-3,#e7e0d1);overflow:hidden;';
    const fill = document.createElement('div');
    fill.style.cssText = 'height:100%;width:0%;border-radius:999px;background:var(--accent,#9b7247);transition:width .18s linear;';
    track.appendChild(fill);
    const sub = document.createElement('div');
    sub.style.cssText = 'margin-top:7px;color:var(--text-secondary,#7b7266);font-size:12px;';
    sub.textContent = '正在准备…';
    host.append(head, track, sub);
    document.body.appendChild(host);
    return { host, title, pct, fill, sub };
  }

export function paintPrecomputeBar(
    parts: ReturnType<typeof mountPrecomputeBar>,
    progress: PrecomputeProgress | null,
    label: string,
  ) {
    if (!progress) return;
    const total = Number(progress.total || 0);
    const done = Number(progress.done || 0);
    let pctValue = Number(progress.percent);
    if (!Number.isFinite(pctValue)) pctValue = total > 0 ? (done * 100) / total : 0;
    pctValue = Math.max(0, Math.min(100, pctValue));
    parts.fill.style.width = `${pctValue.toFixed(1)}%`;
    parts.pct.textContent = `${Math.round(pctValue)}%`;
    const status = progress.status || '';
    parts.title.textContent =
      status === 'done' ? '预计算完成'
      : status === 'cancelled' ? '已停止预计算'
      : status === 'error' ? '预计算失败'
      : label;
    const bits: string[] = [];
    if (total > 0) bits.push(`${done} / ${total} 步`);
    const elapsed = Number(progress.elapsed);
    if (Number.isFinite(elapsed) && elapsed > 0) bits.push(`已用 ${elapsed.toFixed(1)}s`);
    const eta = progress.eta == null ? Number.NaN : Number(progress.eta);
    if (progress.running && Number.isFinite(eta) && eta >= 0 && pctValue < 100) {
      bits.push(`剩余约 ${eta.toFixed(1)}s`);
    }
    parts.sub.textContent = bits.length ? bits.join(' · ') : '正在准备…';
  }

  /**
   * 预计算期间挂一个浮动进度条 + 百分比 + ETA，完成/失败后自动消失。
   * 进度条生命周期绑定 launch() 的 Promise（而非进度快照的 status），因此不会
   * 因上一轮遗留的 done 快照而提前收掉；POST 仍保持同步返回完整结果，调用方拿到
   * pre 后照常 await syncAfterPrecompute(pre)。进度查询失败不影响主流程。
   */
  export async function runPrecomputeWithProgress<T>(
    launch: () => Promise<T>,
    label = '预计算中…',
  ): Promise<T> {
    const parts = mountPrecomputeBar();
    let finished = false;
    const tick = async () => {
      if (finished) return;
      try {
        const progress = (await api('/api/precompute/progress', {
          timeoutMs: 4000,
        })) as PrecomputeProgress | null;
        if (!finished) paintPrecomputeBar(parts, progress, label);
      } catch {
        // 进度查询失败不应影响主流程；继续等待 launch()
      }
    };
    void tick();
    const timer = window.setInterval(() => { void tick(); }, 220);
    try {
      return await launch();
    } finally {
      finished = true;
      window.clearInterval(timer);
      parts.host.remove();
    }
  }

  /**
   * 预计算（/api/plotkit/precompute）把 0→T 整段时序写进了 SERVICE.current.recorder，
   * 与 /api/solve-window 是同一条落地路径。但此前前端只提示帧数、从不刷新 state.sim，
   * 于是「分析·信号」等 netlab 自身分析面板仍用旧的（空）probe_keys，表现为"没有
   * 数据可加载"。这里把最新 sim 同步回本地 state，并重渲染分析面板（若正显示）。
   */
export async function syncAfterPrecompute(pre: { sim?: SimRec } | null) {
    if (pre && pre.sim) state.sim = pre.sim;
    else await plotkitDataActions.refreshState(true);
    plotkitDataActions.updateSignalKeyCache();
    if (activeTab() === 'analysis') plotkitDataActions.renderAnalysisPanel();
  }

export async function applyPkChannels() {
    const keys = pkCheckedKeys();
    const hint = $('#pkDataHint');
    const applyBtn = $('#pkChApply');
    const seconds = Math.max(1, Math.min(120, Number(state.chart && state.chart.window) || 5));
    if (applyBtn) (applyBtn as HTMLButtonElement).disabled = true;
    try {
      // 先登记选中通道，再预计算：桥的同步线程可能在预计算期间就消费帧，顺序反过来
      // 会让旧选择吃掉整段预计算，新选中的通道则永远停在 NaN（2026-11-03 修复）。
      if (hint) hint.textContent = '正在登记选中通道…';
      const data = await api('/api/plotkit/channels', {
        method: 'POST',
        body: JSON.stringify({ keys }),
      });
      if (!data || !data.ok) {
        const message = (data && data.error) || (data && data.mounted === false ? 'PlotKit 未挂载' : '未知原因');
        if (hint) hint.textContent = `接入失败：${message}`;
        toast(`接入失败：${message}`, 'warn', 4000);
        return;
      }
      // 接入前先强制预计算：把 0→T 的整段数据算完再登记，避免边跑边画导致的卡顿
      if (hint) hint.textContent = `正在预计算 0→${seconds}s 的数据…`;
      const pre = await runPrecomputeWithProgress(
        () => api('/api/plotkit/precompute', {
          method: 'POST',
          body: JSON.stringify({ seconds }),
          timeoutMs: 180000,
        }),
        `正在计算 0→${seconds}s`,
      );
      if (pre && pre.ok === false) {
        toast('预计算失败：' + (pre.error || '未知错误'), 'warn', 4000);
        if (hint) hint.textContent = `预计算失败：${pre.error || '未知错误'}；可重试或检查场景。`;
        return;
      }
      if (pre && pre.elapsed_ms) {
        // 2026-11-03：降级（步数超上限）要说清楚，否则看起来像「提高精度没生效」。
        const degradedNote = pre.degraded
          ? `；步长已降级为 ${Number(pre.dt_used).toExponential(1)}s（请求 ${Number(pre.requested_dt).toExponential(1)}s，受 20 万步上限限制）`
          : '';
        if (hint) hint.textContent = `预计算完成：${seconds}s / ${pre.frames ?? pre.frames_recorded ?? '?'} 帧 / ${Math.round(pre.elapsed_ms)} ms${degradedNote}`;
        if (pre.degraded) {
          toast(`预计算已降级步长 ${Number(pre.dt_used).toExponential(1)}s，缩小时间窗可提高精度`, 'warn', 5200);
        }
      }
      // 同步预计算产出的录制数据，让「分析·信号」等面板能列出并加载变量
      await syncAfterPrecompute(pre);
      toast(`已接入 ${(data.selected || []).length} 条通道`, 'ok', 2600);
      reloadPlotkitFrame();
      await refreshPkChannels();
    } catch (error) {
      const message = (error as Error).message || '请求失败';
      if (hint) hint.textContent = `接入失败：${message}`;
      toast(`接入失败：${message}`, 'warn', 4000);
    } finally {
      if (applyBtn) (applyBtn as HTMLButtonElement).disabled = false;
    }
  }

export function pkKeysForSelectedNode() {
    const node = selectedNode();
    if (!node) { toast('先在画布上选中一个节点', 'warn', 2400); return null; }
    const names = [node.id, node.name].filter(Boolean).map(String);
    return pkChannelCache.filter((key: string) => names.some((name: string) => (
      key === name || key.startsWith(name + ':') || key.indexOf(':' + name + ':') >= 0
    )));
  }

export function initPlotkitDataBar() {
    const all = $('#pkChAll');
    const none = $('#pkChNone');
    const nodeBtn = $('#pkChNode');
    const apply = $('#pkChApply');
    if (all) all.addEventListener('click', () => {
      document.querySelectorAll<HTMLInputElement>('#pkChannelList input').forEach((i: HTMLInputElement) => { i.checked = true; });
    });
    if (none) none.addEventListener('click', () => {
      document.querySelectorAll<HTMLInputElement>('#pkChannelList input').forEach((i: HTMLInputElement) => { i.checked = false; });
    });
    if (nodeBtn) nodeBtn.addEventListener('click', () => {
      const keys = pkKeysForSelectedNode();
      if (!keys) return;
      if (!keys.length) { toast('这个节点没有探针通道', 'warn', 2400); return; }
      document.querySelectorAll<HTMLInputElement>('#pkChannelList input').forEach((i: HTMLInputElement) => { i.checked = keys.indexOf(i.value) >= 0; });
      toast(`已勾选该节点的 ${keys.length} 条通道`, 'info', 2200);
    });
    if (apply) apply.addEventListener('click', applyPkChannels);
    const retry = $('#pkChRetry');
    if (retry) retry.addEventListener('click', retryPlotkit);
    document.querySelectorAll('[data-sub="plotkit"]').forEach((btn) => {
      btn.addEventListener('click', () => setTimeout(() => refreshPkChannels(true), 60));
    });
    setInterval(() => {
      const pane = $('#tab-plotkit');
      if (pane && !pane.hidden) refreshPkChannels(true);
    }, 5000);
  }
