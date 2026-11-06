/*
 * 桌面壳桥接垫片（pywebview / WebView2）。
 *
 * 只在桌面模式下由服务端注入（NETLAB_DESKTOP_SHELL=pywebview），浏览器访问时不存在。
 * 作用：把 pywebview 的 Promise API 映射成前端已经在用的 QWebChannel 风格
 *       —— `bridge.method(...args, callback)`，这样 app.js 一行都不用改。
 */

interface PywebviewApi {
  [name: string]: unknown;
  window_rect?: () => Promise<number[]>;
  window_move_to?: (x: number, y: number) => Promise<unknown>;
  window_resize?: (x: number, y: number, width: number, height: number) => Promise<unknown>;
  window_toggle_maximize?: () => Promise<unknown>;
  window_minimize?: () => Promise<unknown>;
  window_close?: () => Promise<unknown>;
}

interface PywebviewBridge {
  api?: PywebviewApi;
}

type DesktopCallback = (value: unknown) => void;
type DesktopMethod = (...args: unknown[]) => Promise<unknown> | undefined;

interface WindowDragHandle {
  refresh: () => void;
}

interface WindowDragOptions {
  interactive?: string;
  dblclick?: boolean;
  onStart?: (ev: PointerEvent) => void;
  onEnd?: () => void;
}

interface NetlabDesktopApi {
  saveProject: DesktopMethod;
  saveProjectTo: DesktopMethod;
  openProject: DesktopMethod;
  openProjectPath: DesktopMethod;
  currentPath: DesktopMethod;
  hasAutosave: DesktopMethod;
  recoverAutosave: DesktopMethod;
  autosave: DesktopMethod;
  clearAutosave: DesktopMethod;
  attachWindowDrag?: (el: HTMLElement | null, opts?: WindowDragOptions) => WindowDragHandle | null;
}

interface Point {
  x: number;
  y: number;
}

interface PointerOrigin {
  sx: number;
  sy: number;
  wx: number | null;
  wy: number | null;
}

interface ResizeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ResizeState {
  dir: string;
  sx: number;
  sy: number;
  r: ResizeRect | null;
}

interface Window {
  pywebview?: PywebviewBridge;
  netlabDesktop?: NetlabDesktopApi;
  netlabDesktopCommand?: (command: string) => void;
}

(function () {
  'use strict';

  if (window.netlabDesktop) return;

  var readyPromise = new Promise<void>(function (resolve) {
    if (window.pywebview && window.pywebview.api) {
      resolve();
      return;
    }
    window.addEventListener('pywebviewready', function () { resolve(); }, { once: true });
  });

  function invoke(method: string, args: unknown[]): Promise<unknown> {
    return readyPromise.then(function () {
      var api = window.pywebview && window.pywebview.api;
      if (!api || typeof api[method] !== 'function') return null;
      try {
        return Promise.resolve((api[method] as Function).apply(api, args)).catch(function () { return null; });
      } catch (error) {
        return null;
      }
    });
  }

  function wrap(method: string): DesktopMethod {
    return function () {
      var args = Array.prototype.slice.call(arguments);
      var callback: DesktopCallback | null = null;
      if (typeof args[args.length - 1] === 'function') callback = args.pop();
      var promise = invoke(method, args);
      if (callback) {
        promise.then(function (value) { callback!(value); });
        return undefined;
      }
      return promise;
    };
  }

  window.netlabDesktop = {
    saveProject: wrap('save_project'),
    saveProjectTo: wrap('save_project_to'),
    openProject: wrap('open_project'),
    openProjectPath: wrap('open_project_path'),
    currentPath: wrap('current_path'),
    hasAutosave: wrap('has_autosave'),
    recoverAutosave: wrap('recover_autosave'),
    autosave: wrap('autosave'),
    clearAutosave: wrap('clear_autosave')
  };

  // pywebview 没有原生菜单加速键，这里补上 Ctrl/Cmd+N/O/S/Shift+S。
  window.addEventListener('keydown', function (event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    var key = String(event.key || '').toLowerCase();
    var command: string | null = null;
    if (key === 's') command = event.shiftKey ? 'saveAs' : 'save';
    else if (key === 'o') command = 'open';
    else if (key === 'n') command = 'new';
    if (!command) return;
    event.preventDefault();
    if (typeof window.netlabDesktopCommand === 'function') {
      window.netlabDesktopCommand(command);
    }
  }, true);

  /* ------------------------------------------------------------------
   * 无边框窗口：自绘最小化 / 最大化 / 关闭，并只让品牌区拖动窗口。
   * 依赖 webview.settings['DRAG_REGION_DIRECT_TARGET_ONLY'] = True
   * 与 `.pywebview-drag-region` 类（pywebview 内置的拖拽机制）。
   * ------------------------------------------------------------------ */
  function callApi<T = unknown>(name: string, args?: unknown[]): Promise<T> | null {
    var a = window.pywebview && window.pywebview.api;
    if (a && typeof a[name] === 'function') {
      try { return (a[name] as Function).apply(a, args || []) as Promise<T>; } catch (e) { return null; }
    }
    return null;
  }

  function toggleMaximize() {
    var p = callApi<number[]>('window_toggle_maximize');
    if (p && (p.then as unknown)) p.catch(function () {});
  }

  /**
   * 把元素变成窗口拖动柄：按住它（交互控件除外）移动整个窗口。
   * 顶栏与开始页共用；浏览器模式没有 pywebview，调用方需先判断 window.netlabDesktop。
   * opts: { interactive: cssSelector, dblclick: bool, onStart, onEnd }
   */
  function attachWindowDrag(el: HTMLElement | null, opts?: WindowDragOptions): WindowDragHandle | null {
    if (!el) return null;
    opts = opts || {};
    var interactive = opts.interactive ||
      'button, input, select, textarea, a, label, [role="tab"], [contenteditable="true"], #nlWinCtl';
    var rect: Point | null = null;      // {x, y} 窗口左上角
    var origin: PointerOrigin | null = null;    // 按下时的指针 + 窗口位置
    var pending: [number, number] | null = null;
    var raf = 0;

    function refreshRect() {
      var p = callApi<number[]>('window_rect');
      if (p && p.then) {
        p.then(function (r) {
          if (r && r.length >= 2) rect = { x: r[0], y: r[1] };
        }).catch(function () {});
      }
    }
    refreshRect();
    window.addEventListener('pywebviewready', refreshRect);
    el.addEventListener('pointerenter', refreshRect);

    function flush() {
      raf = 0;
      if (!pending) return;
      var x = pending[0], y = pending[1];
      pending = null;
      var p = callApi<number[]>('window_move_to', [x, y]);
      if (p && (p.then as unknown)) p.catch(function () {});
      rect = { x: x, y: y };
    }

    function start(ev: PointerEvent) {
      if (ev.button !== 0) return;
      if (ev.target && (ev.target as Element).closest && (ev.target as Element).closest(interactive)) return;
      origin = { sx: ev.screenX, sy: ev.screenY, wx: rect ? rect.x : null, wy: rect ? rect.y : null };
      if (origin.wx === null) {
        var p = callApi<number[]>('window_rect');
        if (p && p.then) {
          p.then(function (r) {
            if (origin && r && r.length >= 2) { origin.wx = r[0]; origin.wy = r[1]; }
          }).catch(function () {});
        }
      }
      try { el!.setPointerCapture(ev.pointerId); } catch (e) { /* noop */ }
      if (typeof opts!.onStart === 'function') opts!.onStart(ev);
    }

    function move(ev: PointerEvent) {
      if (!origin || origin.wx === null || origin.wy === null) return;
      pending = [origin.wx + (ev.screenX - origin.sx), origin.wy + (ev.screenY - origin.sy)];
      if (!raf) raf = requestAnimationFrame(flush);
    }

    function end() {
      origin = null;
      pending = null;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (typeof opts!.onEnd === 'function') opts!.onEnd();
    }

    el.addEventListener('pointerdown', start);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    if (opts.dblclick) {
      el.addEventListener('dblclick', function (ev: MouseEvent) {
        if (ev.target && (ev.target as Element).closest && (ev.target as Element).closest(interactive)) return;
        toggleMaximize();
      });
    }
    return { refresh: refreshRect };
  }

  window.netlabDesktop.attachWindowDrag = attachWindowDrag;

  function mountWindowChrome() {
    if (document.getElementById('nlWinCtl')) return;
    var bar = document.getElementById('topbar');
    if (!bar) return;

    // 1) 拖动区：整个顶栏（除按钮/输入等交互控件）都能拖动窗口。
    //    这里自己做指针拖动（调用 window_move_to），不依赖 pywebview 的 easy_drag，
    //    以免 DRAG_REGION_DIRECT_TARGET_ONLY 命中判定导致"点哪都拖不动"。
    var INTERACTIVE = 'button, input, select, textarea, a, label, [role="tab"], [contenteditable="true"], #nlWinCtl';
    if (bar) {
      bar.classList.add('pywebview-drag-region');
      var all = bar.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        if (!all[i].closest(INTERACTIVE)) all[i].classList.add('pywebview-drag-region');
      }
    }
    attachWindowDrag(bar, { interactive: INTERACTIVE, dblclick: true });

    // 1b) 四边/四角缩放：无边框窗口没有系统边框，这里补 8 个透明手柄。
    (function installResize() {
      var api = function () { return window.pywebview && window.pywebview.api; };
      var MIN_W = 1100, MIN_H = 700;
      var rect: ResizeRect | null = null, st: ResizeState | null = null, pending: [number, number, number, number] | null = null, raf = 0;

      function refresh() {
        var a = api();
        if (a && typeof a.window_rect === 'function') {
          try {
            a.window_rect().then(function (r) {
              if (r && r.length >= 4) rect = { x: r[0], y: r[1], w: r[2], h: r[3] };
            }).catch(function () {});
          } catch (e) { /* noop */ }
        }
      }
      refresh();
      window.addEventListener('pywebviewready', refresh);

      var css = document.createElement('style');
      css.textContent = [
        '.nl-resize{position:fixed;z-index:99999;background:transparent;}',
        '.nl-resize[data-dir="n"]{top:0;left:8px;right:8px;height:5px;cursor:n-resize;}',
        '.nl-resize[data-dir="s"]{bottom:0;left:8px;right:8px;height:5px;cursor:s-resize;}',
        '.nl-resize[data-dir="e"]{right:0;top:8px;bottom:8px;width:5px;cursor:e-resize;}',
        '.nl-resize[data-dir="w"]{left:0;top:8px;bottom:8px;width:5px;cursor:w-resize;}',
        '.nl-resize[data-dir="ne"]{top:0;right:0;width:10px;height:10px;cursor:ne-resize;}',
        '.nl-resize[data-dir="nw"]{top:0;left:0;width:10px;height:10px;cursor:nw-resize;}',
        '.nl-resize[data-dir="se"]{bottom:0;right:0;width:10px;height:10px;cursor:se-resize;}',
        '.nl-resize[data-dir="sw"]{bottom:0;left:0;width:10px;height:10px;cursor:sw-resize;}'
      ].join('');
      document.head.appendChild(css);

      function flush() {
        raf = 0;
        if (!pending) return;
        var a = api(), p = pending;
        pending = null;
        if (a && typeof a.window_resize === 'function') {
          try {
            a.window_resize(p[0], p[1], p[2], p[3]);
            rect = { x: p[0], y: p[1], w: p[2], h: p[3] };
          } catch (e) { /* noop */ }
        }
      }

      ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(function (dir) {
        var el = document.createElement('div');
        el.className = 'nl-resize';
        el.setAttribute('data-dir', dir);
        document.body.appendChild(el);

        el.addEventListener('pointerdown', function (ev: PointerEvent) {
          if (ev.button !== 0) return;
          ev.preventDefault();
          ev.stopPropagation();
          refresh();
          st = { dir: dir, sx: ev.screenX, sy: ev.screenY, r: rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : null };
          try { el.setPointerCapture(ev.pointerId); } catch (e) { /* noop */ }
        });

        el.addEventListener('pointermove', function (ev: PointerEvent) {
          if (!st || !st.r) return;
          var dx = ev.screenX - st.sx, dy = ev.screenY - st.sy;
          var x = st.r.x, y = st.r.y, w = st.r.w, h = st.r.h;
          if (dir.indexOf('e') >= 0) w = Math.max(MIN_W, st.r.w + dx);
          if (dir.indexOf('s') >= 0) h = Math.max(MIN_H, st.r.h + dy);
          if (dir.indexOf('w') >= 0) { w = Math.max(MIN_W, st.r.w - dx); x = st.r.x + (st.r.w - w); }
          if (dir.indexOf('n') >= 0) { h = Math.max(MIN_H, st.r.h - dy); y = st.r.y + (st.r.h - h); }
          pending = [x, y, w, h];
          if (!raf) raf = requestAnimationFrame(flush);
        });

        var end = function () { st = null; pending = null; };
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);
      });
    })();

    // 2) 窗口按钮，放在顶栏最右侧
    var style = document.createElement('style');
    style.textContent = [
      '#nlWinCtl{display:flex;align-items:center;gap:2px;margin-left:6px;}',
      '#nlWinCtl button{width:34px;height:26px;border:0;border-radius:6px;background:transparent;',
      '  color:var(--ink,#222);font-size:13px;line-height:1;cursor:default;opacity:.75;}',
      '#nlWinCtl button:hover{background:rgba(128,128,128,.18);opacity:1;}',
      '#nlWinCtl button[data-act="close"]:hover{background:#c0392b;color:#fff;opacity:1;}'
    ].join('');
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.id = 'nlWinCtl';
    wrap.innerHTML =
      '<button type="button" data-act="min" title="最小化">&#8211;</button>' +
      '<button type="button" data-act="max" title="最大化 / 还原">&#9633;</button>' +
      '<button type="button" data-act="close" title="关闭（并释放本地端口）">&#10005;</button>';
    bar.appendChild(wrap);

    function api() { return window.pywebview && window.pywebview.api; }
    function call(name: string) {
      var a = api();
      if (a && typeof a[name] === 'function') {
        try { (a[name] as Function)(); } catch (e) { /* noop */ }
      }
    }
    function toggleMax() { call('window_toggle_maximize'); }

    wrap.addEventListener('click', function (event: MouseEvent) {
      var btn = (event.target as Element).closest('button[data-act]');
      if (!btn) return;
      event.preventDefault();
      var act = btn.getAttribute('data-act');
      if (act === 'min') call('window_minimize');
      else if (act === 'max') toggleMax();
      else if (act === 'close') call('window_close');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountWindowChrome, { once: true });
  } else {
    mountWindowChrome();
  }
  // 页面若在 pywebview 就绪后才渲染顶栏，再补一次
  window.addEventListener('pywebviewready', function () { setTimeout(mountWindowChrome, 0); });
})();
