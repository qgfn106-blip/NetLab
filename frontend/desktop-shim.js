(() => {
  (function() {
    "use strict";
    if (window.netlabDesktop) return;
    var readyPromise = new Promise(function(resolve) {
      if (window.pywebview && window.pywebview.api) {
        resolve();
        return;
      }
      window.addEventListener("pywebviewready", function() {
        resolve();
      }, { once: true });
    });
    function invoke(method, args) {
      return readyPromise.then(function() {
        var api = window.pywebview && window.pywebview.api;
        if (!api || typeof api[method] !== "function") return null;
        try {
          return Promise.resolve(api[method].apply(api, args)).catch(function() {
            return null;
          });
        } catch (error) {
          return null;
        }
      });
    }
    function wrap(method) {
      return function() {
        var args = Array.prototype.slice.call(arguments);
        var callback = null;
        if (typeof args[args.length - 1] === "function") callback = args.pop();
        var promise = invoke(method, args);
        if (callback) {
          promise.then(function(value) {
            callback(value);
          });
          return void 0;
        }
        return promise;
      };
    }
    window.netlabDesktop = {
      saveProject: wrap("save_project"),
      saveProjectTo: wrap("save_project_to"),
      openProject: wrap("open_project"),
      openProjectPath: wrap("open_project_path"),
      currentPath: wrap("current_path"),
      hasAutosave: wrap("has_autosave"),
      recoverAutosave: wrap("recover_autosave"),
      autosave: wrap("autosave"),
      clearAutosave: wrap("clear_autosave")
    };
    window.addEventListener("keydown", function(event) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      var key = String(event.key || "").toLowerCase();
      var command = null;
      if (key === "s") command = event.shiftKey ? "saveAs" : "save";
      else if (key === "o") command = "open";
      else if (key === "n") command = "new";
      if (!command) return;
      event.preventDefault();
      if (typeof window.netlabDesktopCommand === "function") {
        window.netlabDesktopCommand(command);
      }
    }, true);
    function callApi(name, args) {
      var a = window.pywebview && window.pywebview.api;
      if (a && typeof a[name] === "function") {
        try {
          return a[name].apply(a, args || []);
        } catch (e) {
          return null;
        }
      }
      return null;
    }
    function toggleMaximize() {
      var p = callApi("window_toggle_maximize");
      if (p && p.then) p.catch(function() {
      });
    }
    function attachWindowDrag(el, opts) {
      if (!el) return null;
      opts = opts || {};
      var interactive = opts.interactive || 'button, input, select, textarea, a, label, [role="tab"], [contenteditable="true"], #nlWinCtl';
      var rect = null;
      var origin = null;
      var pending = null;
      var raf = 0;
      function refreshRect() {
        var p = callApi("window_rect");
        if (p && p.then) {
          p.then(function(r) {
            if (r && r.length >= 2) rect = { x: r[0], y: r[1] };
          }).catch(function() {
          });
        }
      }
      refreshRect();
      window.addEventListener("pywebviewready", refreshRect);
      el.addEventListener("pointerenter", refreshRect);
      function flush() {
        raf = 0;
        if (!pending) return;
        var x = pending[0], y = pending[1];
        pending = null;
        var p = callApi("window_move_to", [x, y]);
        if (p && p.then) p.catch(function() {
        });
        rect = { x, y };
      }
      function start(ev) {
        if (ev.button !== 0) return;
        if (ev.target && ev.target.closest && ev.target.closest(interactive)) return;
        origin = { sx: ev.screenX, sy: ev.screenY, wx: rect ? rect.x : null, wy: rect ? rect.y : null };
        if (origin.wx === null) {
          var p = callApi("window_rect");
          if (p && p.then) {
            p.then(function(r) {
              if (origin && r && r.length >= 2) {
                origin.wx = r[0];
                origin.wy = r[1];
              }
            }).catch(function() {
            });
          }
        }
        try {
          el.setPointerCapture(ev.pointerId);
        } catch (e) {
        }
        if (typeof opts.onStart === "function") opts.onStart(ev);
      }
      function move(ev) {
        if (!origin || origin.wx === null || origin.wy === null) return;
        pending = [origin.wx + (ev.screenX - origin.sx), origin.wy + (ev.screenY - origin.sy)];
        if (!raf) raf = requestAnimationFrame(flush);
      }
      function end() {
        origin = null;
        pending = null;
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        if (typeof opts.onEnd === "function") opts.onEnd();
      }
      el.addEventListener("pointerdown", start);
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", end);
      if (opts.dblclick) {
        el.addEventListener("dblclick", function(ev) {
          if (ev.target && ev.target.closest && ev.target.closest(interactive)) return;
          toggleMaximize();
        });
      }
      return { refresh: refreshRect };
    }
    window.netlabDesktop.attachWindowDrag = attachWindowDrag;
    function mountWindowChrome() {
      if (document.getElementById("nlWinCtl")) return;
      var bar = document.getElementById("topbar");
      if (!bar) return;
      var INTERACTIVE = 'button, input, select, textarea, a, label, [role="tab"], [contenteditable="true"], #nlWinCtl';
      if (bar) {
        bar.classList.add("pywebview-drag-region");
        var all = bar.querySelectorAll("*");
        for (var i = 0; i < all.length; i++) {
          if (!all[i].closest(INTERACTIVE)) all[i].classList.add("pywebview-drag-region");
        }
      }
      attachWindowDrag(bar, { interactive: INTERACTIVE, dblclick: true });
      (function installResize() {
        var api2 = function() {
          return window.pywebview && window.pywebview.api;
        };
        var MIN_W = 1100, MIN_H = 700;
        var rect = null, st = null, pending = null, raf = 0;
        function refresh() {
          var a = api2();
          if (a && typeof a.window_rect === "function") {
            try {
              a.window_rect().then(function(r) {
                if (r && r.length >= 4) rect = { x: r[0], y: r[1], w: r[2], h: r[3] };
              }).catch(function() {
              });
            } catch (e) {
            }
          }
        }
        refresh();
        window.addEventListener("pywebviewready", refresh);
        var css = document.createElement("style");
        css.textContent = [
          ".nl-resize{position:fixed;z-index:99999;background:transparent;}",
          '.nl-resize[data-dir="n"]{top:0;left:8px;right:8px;height:5px;cursor:n-resize;}',
          '.nl-resize[data-dir="s"]{bottom:0;left:8px;right:8px;height:5px;cursor:s-resize;}',
          '.nl-resize[data-dir="e"]{right:0;top:8px;bottom:8px;width:5px;cursor:e-resize;}',
          '.nl-resize[data-dir="w"]{left:0;top:8px;bottom:8px;width:5px;cursor:w-resize;}',
          '.nl-resize[data-dir="ne"]{top:0;right:0;width:10px;height:10px;cursor:ne-resize;}',
          '.nl-resize[data-dir="nw"]{top:0;left:0;width:10px;height:10px;cursor:nw-resize;}',
          '.nl-resize[data-dir="se"]{bottom:0;right:0;width:10px;height:10px;cursor:se-resize;}',
          '.nl-resize[data-dir="sw"]{bottom:0;left:0;width:10px;height:10px;cursor:sw-resize;}'
        ].join("");
        document.head.appendChild(css);
        function flush() {
          raf = 0;
          if (!pending) return;
          var a = api2(), p = pending;
          pending = null;
          if (a && typeof a.window_resize === "function") {
            try {
              a.window_resize(p[0], p[1], p[2], p[3]);
              rect = { x: p[0], y: p[1], w: p[2], h: p[3] };
            } catch (e) {
            }
          }
        }
        ["n", "s", "e", "w", "ne", "nw", "se", "sw"].forEach(function(dir) {
          var el = document.createElement("div");
          el.className = "nl-resize";
          el.setAttribute("data-dir", dir);
          document.body.appendChild(el);
          el.addEventListener("pointerdown", function(ev) {
            if (ev.button !== 0) return;
            ev.preventDefault();
            ev.stopPropagation();
            refresh();
            st = { dir, sx: ev.screenX, sy: ev.screenY, r: rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : null };
            try {
              el.setPointerCapture(ev.pointerId);
            } catch (e) {
            }
          });
          el.addEventListener("pointermove", function(ev) {
            if (!st || !st.r) return;
            var dx = ev.screenX - st.sx, dy = ev.screenY - st.sy;
            var x = st.r.x, y = st.r.y, w = st.r.w, h = st.r.h;
            if (dir.indexOf("e") >= 0) w = Math.max(MIN_W, st.r.w + dx);
            if (dir.indexOf("s") >= 0) h = Math.max(MIN_H, st.r.h + dy);
            if (dir.indexOf("w") >= 0) {
              w = Math.max(MIN_W, st.r.w - dx);
              x = st.r.x + (st.r.w - w);
            }
            if (dir.indexOf("n") >= 0) {
              h = Math.max(MIN_H, st.r.h - dy);
              y = st.r.y + (st.r.h - h);
            }
            pending = [x, y, w, h];
            if (!raf) raf = requestAnimationFrame(flush);
          });
          var end = function() {
            st = null;
            pending = null;
          };
          el.addEventListener("pointerup", end);
          el.addEventListener("pointercancel", end);
        });
      })();
      var style = document.createElement("style");
      style.textContent = [
        "#nlWinCtl{display:flex;align-items:center;gap:2px;margin-left:6px;}",
        "#nlWinCtl button{width:34px;height:26px;border:0;border-radius:6px;background:transparent;",
        "  color:var(--ink,#222);font-size:13px;line-height:1;cursor:default;opacity:.75;}",
        "#nlWinCtl button:hover{background:rgba(128,128,128,.18);opacity:1;}",
        '#nlWinCtl button[data-act="close"]:hover{background:#c0392b;color:#fff;opacity:1;}'
      ].join("");
      document.head.appendChild(style);
      var wrap2 = document.createElement("div");
      wrap2.id = "nlWinCtl";
      wrap2.innerHTML = '<button type="button" data-act="min" title="\u6700\u5C0F\u5316">&#8211;</button><button type="button" data-act="max" title="\u6700\u5927\u5316 / \u8FD8\u539F">&#9633;</button><button type="button" data-act="close" title="\u5173\u95ED\uFF08\u5E76\u91CA\u653E\u672C\u5730\u7AEF\u53E3\uFF09">&#10005;</button>';
      bar.appendChild(wrap2);
      function api() {
        return window.pywebview && window.pywebview.api;
      }
      function call(name) {
        var a = api();
        if (a && typeof a[name] === "function") {
          try {
            a[name]();
          } catch (e) {
          }
        }
      }
      function toggleMax() {
        call("window_toggle_maximize");
      }
      wrap2.addEventListener("click", function(event) {
        var btn = event.target.closest("button[data-act]");
        if (!btn) return;
        event.preventDefault();
        var act = btn.getAttribute("data-act");
        if (act === "min") call("window_minimize");
        else if (act === "max") toggleMax();
        else if (act === "close") call("window_close");
      });
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mountWindowChrome, { once: true });
    } else {
      mountWindowChrome();
    }
    window.addEventListener("pywebviewready", function() {
      setTimeout(mountWindowChrome, 0);
    });
  })();
})();
