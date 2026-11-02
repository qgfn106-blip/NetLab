/*
 * 桌面壳桥接垫片（pywebview / WebView2）。
 *
 * 只在桌面模式下由服务端注入（NETLAB_DESKTOP_SHELL=pywebview），浏览器访问时不存在。
 * 作用：把 pywebview 的 Promise API 映射成前端已经在用的 QWebChannel 风格
 *       —— `bridge.method(...args, callback)`，这样 app.js 一行都不用改。
 */
(function () {
  'use strict';

  if (window.netlabDesktop) return;

  var readyPromise = new Promise(function (resolve) {
    if (window.pywebview && window.pywebview.api) {
      resolve();
      return;
    }
    window.addEventListener('pywebviewready', function () { resolve(); }, { once: true });
  });

  function invoke(method, args) {
    return readyPromise.then(function () {
      var api = window.pywebview && window.pywebview.api;
      if (!api || typeof api[method] !== 'function') return null;
      try {
        return Promise.resolve(api[method].apply(api, args)).catch(function () { return null; });
      } catch (error) {
        return null;
      }
    });
  }

  function wrap(method) {
    return function () {
      var args = Array.prototype.slice.call(arguments);
      var callback = null;
      if (typeof args[args.length - 1] === 'function') callback = args.pop();
      var promise = invoke(method, args);
      if (callback) {
        promise.then(function (value) { callback(value); });
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
  window.addEventListener('keydown', function (event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    var key = String(event.key || '').toLowerCase();
    var command = null;
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
  function mountWindowChrome() {
    if (document.getElementById('nlWinCtl')) return;
    var bar = document.getElementById('topbar');
    if (!bar) return;

    // 1) 拖动区：品牌块及其所有子元素都带上拖拽类（direct-target-only 需要命中目标本身）
    var brand = bar.querySelector('.brand');
    if (brand) {
      brand.classList.add('pywebview-drag-region');
      var kids = brand.querySelectorAll('*');
      for (var i = 0; i < kids.length; i++) kids[i].classList.add('pywebview-drag-region');
      brand.addEventListener('dblclick', function () { toggleMax(); });
    }

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
    function call(name) {
      var a = api();
      if (a && typeof a[name] === 'function') {
        try { a[name](); } catch (e) { /* noop */ }
      }
    }
    function toggleMax() { call('window_toggle_maximize'); }

    wrap.addEventListener('click', function (event) {
      var btn = event.target.closest('button[data-act]');
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
