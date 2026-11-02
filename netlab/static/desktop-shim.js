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
})();
