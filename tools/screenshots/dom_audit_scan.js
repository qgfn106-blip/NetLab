// In-page DOM text-contrast scanner, injected by dom_contrast_audit.mjs.
// Pure browser JS (no imports). Defines window.__auditScan() returning a plain
// object: { theme, checked, failures:[{sel,text,fg,bg,ratio,thr,basis,fontSize,fontWeight,bgSource}] }.
// It measures EVERY visible element that directly owns a text node (or a form
// control value/placeholder), computes its effective background (CSS ancestor
// chain incl. translucent overlays; canvas sampling for elements over #graph),
// folds opacity, and checks WCAG contrast against per-role thresholds.
(function () {
  function parseColor(str) {
    if (!str) return { r: 0, g: 0, b: 0, a: 0 };
    str = String(str).trim();
    if (str === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    var m = str.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      var parts = m[1].split(',').map(function (s) { return s.trim(); });
      return { r: +parts[0], g: +parts[1], b: +parts[2], a: parts.length > 3 ? +parts[3] : 1 };
    }
    m = str.match(/^#([0-9a-f]{3,8})$/i);
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
      if (h.length === 6 || h.length === 8) {
        return {
          r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
          a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
        };
      }
    }
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  function blend(fg, bg) {
    var a = (fg.a == null ? 1 : fg.a);
    if (a < 0) a = 0; if (a > 1) a = 1;
    return {
      r: Math.round(fg.r * a + bg.r * (1 - a)),
      g: Math.round(fg.g * a + bg.g * (1 - a)),
      b: Math.round(fg.b * a + bg.b * (1 - a)),
      a: 1,
    };
  }
  function lum(c) {
    function f(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function contrast(a, b) {
    var la = lum(a), lb = lum(b);
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }
  function hexc(c) {
    return '#' + [c.r, c.g, c.b].map(function (v) {
      v = Math.max(0, Math.min(255, Math.round(v)));
      return v.toString(16).padStart(2, '0');
    }).join('');
  }
  function dist(a, b) {
    var dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }
  function directText(el) {
    var t = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) t += n.nodeValue;
    }
    return t.replace(/\s+/g, ' ').trim();
  }
  function cssPath(el) {
    var parts = [], node = el, depth = 0;
    while (node && node.nodeType === 1 && depth < 5) {
      var seg = node.tagName.toLowerCase();
      if (node.id) seg += '#' + node.id;
      else if (node.classList && node.classList.length) seg += '.' + Array.prototype.slice.call(node.classList, 0, 3).join('.');
      parts.unshift(seg);
      node = node.parentElement; depth++;
    }
    return parts.join(' > ');
  }

  window.__auditScan = function () {
    var root = document.documentElement;
    var cs = getComputedStyle(root);
    function cv(name) { return cs.getPropertyValue('--' + name).trim(); }

    var SPEC = {
      'text-primary': 7, 'text-heading': 7, 'text-menu-item': 7, 'text-tab-active': 7,
      'text-button-primary': 7, 'text-button-secondary': 7, 'text-input': 7, 'text-on-accent': 7, 'text-tooltip': 7,
      'text-secondary': 4.5, 'text-tertiary': 4.5, 'text-label': 4.5, 'text-menu-desc': 4.5, 'text-tab-inactive': 4.5,
      'text-button-danger': 4.5, 'text-placeholder': 4.5, 'text-link': 4.5, 'text-badge': 4.5,
      'ink': 7, 'ink-2': 7, 'muted': 4.5, 'dim': 4.5,
      'accent': 4.5, 'accent-2': 4.5, 'green': 4.5, 'amber': 4.5, 'red': 4.5,
    };
    var tokens = [];
    Object.keys(SPEC).forEach(function (k) {
      var c = parseColor(cv(k));
      if (c.a > 0.01) tokens.push({ name: k, color: c, thr: SPEC[k] });
    });
    function matchToken(c) {
      var best = null, bd = 1e9;
      for (var i = 0; i < tokens.length; i++) {
        var d = dist(c, tokens[i].color);
        if (d < bd) { bd = d; best = tokens[i]; }
      }
      if (best && bd <= 16) return best;
      return null;
    }

    var graph = document.getElementById('graph');
    var gctx = null, gw = 0, gh = 0, grect = null;
    if (graph) {
      try {
        gctx = graph.getContext('2d', { willReadFrequently: true });
        gw = graph.width; gh = graph.height; grect = graph.getBoundingClientRect();
      } catch (e) { gctx = null; }
    }
    function sampleCanvasAt(clientX, clientY) {
      if (!gctx || !grect || grect.width < 1) return null;
      var sx = Math.round((clientX - grect.left) * (gw / grect.width));
      var sy = Math.round((clientY - grect.top) * (gh / grect.height));
      if (sx < 0 || sy < 0 || sx >= gw || sy >= gh) return null;
      try {
        var d = gctx.getImageData(sx, sy, 1, 1).data;
        return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
      } catch (e) { return null; }
    }

    function bgStack(el) {
      var stack = [], node = el;
      while (node && node.nodeType === 1) {
        var s = getComputedStyle(node);
        var c = parseColor(s.backgroundColor);
        if (c.a > 0.001) { stack.push(c); if (c.a >= 0.999) break; }
        node = node.parentElement;
      }
      return stack;
    }
    function compositeStack(stack, base) {
      var col = base || { r: 255, g: 255, b: 255 };
      for (var i = stack.length - 1; i >= 0; i--) {
        if (stack[i].a <= 0.001) continue;
        col = blend(stack[i], col);
      }
      return col;
    }
    function effectiveBg(el, rect) {
      // Elements over the graph canvas: sample the real drawn pixels, then
      // composite the element's own translucent background stack on top.
      if (el.closest('#stage') && grect) {
        var pts = [];
        var y = Math.min(rect.bottom - 1, rect.top + 2);
        for (var i = 1; i <= 5; i++) {
          var x = rect.left + rect.width * (i / 6);
          var sm = sampleCanvasAt(x, y);
          if (sm && sm.a > 0.5) pts.push(sm);
        }
        if (pts.length) {
          var avg = { r: 0, g: 0, b: 0 };
          for (var j = 0; j < pts.length; j++) { avg.r += pts[j].r; avg.g += pts[j].g; avg.b += pts[j].b; }
          avg.r /= pts.length; avg.g /= pts.length; avg.b /= pts.length;
          var stack = bgStack(el);
          return { color: compositeStack(stack, { r: avg.r, g: avg.g, b: avg.b }), source: 'canvas' };
        }
      }
      var st = bgStack(el);
      if (!st.length) return { color: { r: 255, g: 255, b: 255 }, source: 'assumed-white' };
      var hadOpaque = st[st.length - 1].a >= 0.999;
      var base = hadOpaque ? { r: st[st.length - 1].r, g: st[st.length - 1].g, b: st[st.length - 1].b } : { r: 255, g: 255, b: 255 };
      return { color: compositeStack(st, base), source: hadOpaque ? 'css' : 'css-noopaque' };
    }

    var failures = [];
    var count = 0;
    var all = document.querySelectorAll('body *');
    for (var ai = 0; ai < all.length; ai++) {
      var el = all[ai];
      var tag = el.tagName;
      if (/^(SCRIPT|STYLE|TITLE|META|LINK|BR|HR|IMG|CANVAS|svg|SVG)$/.test(tag)) continue;
      if (el.closest('[hidden]')) continue;
      if (el.getAttribute('aria-hidden') === 'true') continue;
      var txt = directText(el);
      var isPlaceholder = false;
      if (!txt && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) {
        var ph = el.getAttribute('placeholder');
        var val = ('value' in el && el.value) ? String(el.value) : '';
        if (val) { txt = val; }
        else if (ph) { txt = ph; isPlaceholder = true; }
      }
      if (!txt) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) continue;
      var s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none') continue;
      var op = 1, n2 = el;
      while (n2 && n2.nodeType === 1) {
        var so = parseFloat(getComputedStyle(n2).opacity);
        if (!isNaN(so)) op *= so;
        n2 = n2.parentElement;
      }
      if (op <= 0.01) continue;

      var fgStr = isPlaceholder ? getComputedStyle(el, '::placeholder').color : s.color;
      var fg = parseColor(fgStr);
      if (fg.a === 0 && fg.r === 0 && fg.g === 0 && fg.b === 0) fg = parseColor(s.color);

      var bgInfo = effectiveBg(el, r);
      var bg = bgInfo.color;
      var fgA = (fg.a == null ? 1 : fg.a) * op;
      var fgEff = blend({ r: fg.r, g: fg.g, b: fg.b, a: fgA }, bg);
      var ratio = contrast(fgEff, bg);

      var fs = parseFloat(s.fontSize) || 14;
      var fw = parseInt(s.fontWeight) || 400;
      var large = fs >= 24 || (fs >= 18.66 && fw >= 700);
      var disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true' ||
        /(^|\s)(disabled|is-disabled)(\s|$)/.test(el.className || '') || !!el.closest('[disabled]');
      var thr, basis, tok = matchToken(fg);
      if (disabled) { thr = 3; basis = 'disabled'; }
      else if (large) { thr = 3; basis = 'large'; }
      else if (tok) { thr = tok.thr; basis = 'token:' + tok.name; }
      else { thr = fs < 12.5 ? 4.5 : 7; basis = 'size:' + (fs < 12.5 ? 'small' : 'normal'); }

      count++;
      var rec = {
        sel: cssPath(el), text: txt.slice(0, 48), fg: hexc(fg), bg: hexc(bg),
        ratio: Math.round(ratio * 100) / 100, thr: thr, basis: basis,
        fontSize: fs, fontWeight: fw, bgSource: bgInfo.source,
      };
      if (ratio + 1e-9 < thr) failures.push(rec);
    }
    failures.sort(function (a, b) { return (a.ratio - a.thr) - (b.ratio - b.thr); });
    return { theme: document.documentElement.dataset.theme, checked: count, failures: failures };
  };
})();
