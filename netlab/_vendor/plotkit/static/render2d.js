/* ============================================================================================ */
import { ticksLinear, ticksLog, fmtNum, extent, padRange, union, quantile, hexAlpha, colorRamp } from './plot2d.utils.js';
(function () {
    "use strict";
    const PALETTE = [
        "#4fc3f7", "#ff8a65", "#aed581", "#ba68c8", "#ffd54f",
        "#4db6ac", "#f06292", "#90a4ae", "#9575cd", "#8d6e63",
    ];
    const FONT = '12px system-ui, "Microsoft YaHei", sans-serif';
    const FONT_SMALL = '11px system-ui, "Microsoft YaHei", sans-serif';
    const FONT_TITLE = '13px system-ui, "Microsoft YaHei", sans-serif';
    const DASH = {
        solid: [], dash: [6, 4], dot: [1.5, 3], dashdot: [7, 3, 1.5, 3],
        longdash: [12, 5], "dash-dot": [7, 3, 1.5, 3],
    };
    /* ---------------- 坐标变换 ---------------- */
    function makeScale(kind, d0, d1, p0, p1, invert) {
        const log = kind === "log" && d0 > 0 && d1 > 0;
        const lo = log ? Math.log10(d0) : d0;
        const hi = log ? Math.log10(d1) : d1;
        const span = hi - lo || 1;
        return {
            kind: log ? "log" : "linear",
            d0, d1,
            to(v) {
                if (log) {
                    if (!(v > 0))
                        return null;
                    v = Math.log10(v);
                }
                const f = (v - lo) / span;
                return invert ? p1 - (p1 - p0) * f : p0 + (p1 - p0) * f;
            },
            from(px) {
                const f = invert ? (p1 - px) / (p1 - p0) : (px - p0) / (p1 - p0);
                const v = lo + span * f;
                return log ? Math.pow(10, v) : v;
            },
            ticks(target) { return log ? ticksLog(d0, d1, target) : ticksLinear(d0, d1, target); },
        };
    }
    /* ---------------- 布局 ---------------- */
    function gridLayout(spec, W, H, pad) {
        const fig = spec.figure || {};
        const subplots = Math.max(1, ((fig.subplots ?? 0) | 0) || 1);
        const insets = new Set((fig.insets || []).map((it) => (it.subplot ?? 0) | 0));
        const slots = [];
        for (let i = 0; i < subplots; i++)
            if (!insets.has(i))
                slots.push(i);
        if (!slots.length)
            slots.push(0);
        const ncols = Math.max(1, Math.min(((fig.ncols ?? 0) | 0) || 1, slots.length));
        const nrows = Math.max(1, Math.ceil(slots.length / ncols));
        const gapX = 26, gapY = 30;
        const left = pad.left, right = pad.right, top = pad.top, bottom = pad.bottom;
        const cw = (W - left - right - gapX * (ncols - 1)) / ncols;
        const ch = (H - top - bottom - gapY * (nrows - 1)) / nrows;
        const boxes = new Map();
        slots.forEach((slot, i) => {
            const r = Math.floor(i / ncols), c = i % ncols;
            boxes.set(slot, {
                x: left + c * (cw + gapX),
                y: top + r * (ch + gapY),
                w: cw, h: ch,
            });
        });
        return { boxes, slots };
    }
    /* ---------------- 主渲染 ---------------- */
    function render(canvas, spec, store, opts) {
        opts = opts || {};
        const tokens = opts.tokens || {};
        const dpr = Math.min(3, opts.dpr || window.devicePixelRatio || 1);
        const cssW = Math.max(120, canvas.clientWidth | 0 || opts.width || 640);
        const cssH = Math.max(100, canvas.clientHeight | 0 || opts.height || 420);
        if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
            canvas.width = Math.round(cssW * dpr);
            canvas.height = Math.round(cssH * dpr);
        }
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);
        ctx.fillStyle = tokens.paper || "#0f172a";
        ctx.fillRect(0, 0, cssW, cssH);
        const fig = spec.figure || {};
        const layers = (spec.layers || []).filter((l) => !l.hidden);
        const pad = { left: 62, right: 18, top: fig.title ? 40 : 24, bottom: 46 };
        const layout = gridLayout(spec, cssW, cssH, pad);
        const t = opts.t == null ? Infinity : opts.t;
        const axesOut = [];
        const pickables = [];
        if (fig.title) {
            ctx.fillStyle = tokens.text || "#e2e8f0";
            ctx.font = FONT_TITLE;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(String(fig.title), cssW / 2, 12);
        }
        // 分组：按 subplot 槽位
        const bySlot = new Map();
        layers.forEach((layer) => {
            const slot = (layer.subplot ?? 0) | 0;
            if (!bySlot.has(slot))
                bySlot.set(slot, []);
            bySlot.get(slot).push(layer);
        });
        let colorIndex = 0;
        for (const slot of layout.slots) {
            const box = layout.boxes.get(slot);
            const group = bySlot.get(slot) || [];
            const view = mergeView(fig, group);
            const drawn = group.map((layer) => ({ layer, series: resolveSeries(layer, store, t, opts.tMin) }));
            const domains = domainsOf(drawn, view);
            const ov = (opts.overrides && opts.overrides[slot]) || {};
            const xlim = ov.xlim || view.xlim || padRange(domains.x, 0.04);
            const ylim = ov.ylim || view.ylim || padRange(domains.y, 0.06);
            const sx = makeScale(view.xscale, xlim[0], xlim[1], box.x, box.x + box.w, false);
            const sy = makeScale(view.yscale, ylim[0], ylim[1], box.y + box.h, box.y, !!view.invert_y);
            const axis = { slot, box, xlim, ylim, xscale: sx.kind, yscale: sy.kind, sx, sy };
            axesOut.push(axis);
            drawFrame(ctx, axis, tokens, view);
            drawn.forEach((item) => {
                const color = (item.layer.style && item.layer.style.color) || PALETTE[colorIndex++ % PALETTE.length];
                drawLayer(ctx, item, axis, color, tokens, opts);
                if (item.series && item.series.x) {
                    pickables.push({ slot, layer: item.layer, series: item.series, axis, color });
                }
            });
            drawLegend(ctx, drawn, axis, tokens);
            drawAxisTitles(ctx, axis, view, tokens);
        }
        return { axes: axesOut, pickables, cssW, cssH };
    }
    function mergeView(fig, group) {
        const base = {
            title: null, xlabel: null, ylabel: null, xlim: null, ylim: null,
            xscale: "linear", yscale: "linear", grid: true, invert_y: false, legend: true,
        };
        const merged = { ...base };
        for (const layer of group) {
            const v = layer.view || {};
            for (const key of ["xlabel", "ylabel", "xscale", "yscale", "xlim", "ylim", "grid", "invert_y"]) {
                if (v[key] != null && v[key] !== "")
                    merged[key] = v[key];
            }
        }
        if (fig.xlabel)
            merged.xlabel = fig.xlabel;
        if (fig.ylabel)
            merged.ylabel = fig.ylabel;
        return merged;
    }
    /* ---------------- 数据解析 ---------------- */
    function resolveSeries(layer, store, t, tMin) {
        const d = layer.data || {};
        const xName = d.x || d.x0 || null;
        const yName = d.y || d.y0 || null;
        if (!xName || !yName)
            return null;
        const xd = store.get(xName);
        const yd = store.get(yName);
        if (!xd || !yd)
            return null;
        let xs = xd.values, ys = yd.values;
        if (!xs || !ys)
            return null;
        const n = Math.min(xs.length, ys.length);
        if (n === 0)
            return null;
        // 时间截断：x 单调递增且给了 t
        let start = 0, stop = n;
        const mono = n > 1 && xs[0] <= xs[n - 1];
        if (mono && isFinite(t)) {
            let lo = 0, hi = n - 1;
            while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                if (xs[mid] <= t)
                    lo = mid;
                else
                    hi = mid - 1;
            }
            stop = lo + 1;
        }
        if (mono && tMin != null && isFinite(tMin)) {
            let lo = 0, hi = n - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (xs[mid] >= tMin)
                    hi = mid;
                else
                    lo = mid + 1;
            }
            start = lo;
        }
        if (start > 0 || stop < n) {
            xs = xs.subarray(start, Math.max(start + 1, stop));
            ys = ys.subarray(start, Math.max(start + 1, stop));
        }
        return { x: xs, y: ys, xName, yName, start, stop, total: n };
    }
    function domainsOf(drawn, view) {
        let xr = null, yr = null;
        for (const item of drawn) {
            const s = item.series;
            if (!s)
                continue;
            const kind = (item.layer.kind || "line").toLowerCase();
            if (kind === "bar" || kind === "hist") {
                xr = union(xr, extent(s.x));
                const zero = [0, 0];
                yr = union(yr, union(extent(s.y), zero));
            }
            else if (kind === "barh") {
                // 横向条形：x 从 0 起，y 是分类
                xr = union(xr, union(extent(s.x), [0, 0]));
                yr = union(yr, extent(s.y));
            }
            else if (kind === "pie") {
                // 饼图不依赖坐标，给个占位域
                xr = union(xr, [-1, 1]);
                yr = union(yr, [-1, 1]);
            }
            else if (kind === "ecdf") {
                xr = union(xr, extent(s.y));
                yr = union(yr, [0, 1]);
            }
            else if (kind === "hexbin" || kind === "quiver") {
                xr = union(xr, extent(s.x));
                yr = union(yr, extent(s.y));
            }
            else {
                xr = union(xr, extent(s.x));
                yr = union(yr, extent(s.y));
            }
        }
        return { x: xr, y: yr };
    }
    /* ---------------- 轴、网格 ---------------- */
    function drawFrame(ctx, axis, tokens, view) {
        const { box, sx, sy } = axis;
        ctx.fillStyle = tokens.plot || tokens.paper || "#111827";
        ctx.fillRect(box.x, box.y, box.w, box.h);
        if (view.grid !== false) {
            ctx.strokeStyle = tokens.grid || "rgba(148,163,184,.22)";
            ctx.lineWidth = 1;
            const xt = sx.ticks(Math.max(3, Math.min(9, Math.round(box.w / 90))));
            const yt = sy.ticks(Math.max(3, Math.min(9, Math.round(box.h / 55))));
            ctx.beginPath();
            for (const v of xt.ticks) {
                const px = sx.to(v);
                if (px == null)
                    continue;
                ctx.moveTo(px, box.y);
                ctx.lineTo(px, box.y + box.h);
            }
            for (const v of yt.ticks) {
                const py = sy.to(v);
                if (py == null)
                    continue;
                ctx.moveTo(box.x, py);
                ctx.lineTo(box.x + box.w, py);
            }
            ctx.stroke();
        }
        ctx.strokeStyle = tokens.muted || "#94a3b8";
        ctx.lineWidth = 1;
        ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
        // 刻度文字
        ctx.font = FONT_SMALL;
        ctx.fillStyle = tokens.muted || "#94a3b8";
        const xt = sx.ticks(Math.max(3, Math.min(9, Math.round(box.w / 90))));
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        for (const v of xt.ticks) {
            const px = sx.to(v);
            if (px == null || px < box.x - 2 || px > box.x + box.w + 2)
                continue;
            ctx.fillText(fmtNum(v, xt.step), px, box.y + box.h + 6);
        }
        const yt = sy.ticks(Math.max(3, Math.min(9, Math.round(box.h / 55))));
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        for (const v of yt.ticks) {
            const py = sy.to(v);
            if (py == null || py < box.y - 2 || py > box.y + box.h + 2)
                continue;
            ctx.fillText(fmtNum(v, yt.step), box.x - 8, py);
        }
    }
    function drawAxisTitles(ctx, axis, view, tokens) {
        const { box } = axis;
        ctx.fillStyle = tokens.muted || "#94a3b8";
        ctx.font = FONT_SMALL;
        if (view.xlabel) {
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillText(String(view.xlabel), box.x + box.w / 2, box.y + box.h + 40);
        }
        if (view.ylabel) {
            ctx.save();
            ctx.translate(box.x - 46, box.y + box.h / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillText(String(view.ylabel), 0, 0);
            ctx.restore();
        }
    }
    /* ---------------- 图层绘制 ---------------- */
    function styleOf(layer, color) {
        const st = layer.style || {};
        return {
            color: (st.color || color),
            width: st.width == null ? 1.6 : +st.width,
            dash: DASH[st.dash] || [],
            opacity: st.opacity == null ? 1 : +st.opacity,
            mode: st.mode || (layer.kind === "line" ? "lines" : "markers"),
            marker: st.marker || {},
            fill: st.fill,
        };
    }
    function drawLayer(ctx, item, axis, color, tokens, opts) {
        const { layer, series } = item;
        if (!series)
            return;
        const kind = (layer.kind || "line").toLowerCase();
        const st = styleOf(layer, color);
        ctx.save();
        ctx.globalAlpha = st.opacity;
        ctx.lineWidth = st.width;
        ctx.strokeStyle = st.color;
        ctx.setLineDash(st.dash);
        try {
            switch (kind) {
                case "line":
                case "step":
                    drawLine(ctx, series, axis, st, kind === "step");
                    if (st.mode && st.mode.indexOf("marker") >= 0)
                        drawMarkers(ctx, series, axis, st);
                    break;
                case "marker":
                case "scatter":
                case "points":
                    drawMarkers(ctx, series, axis, st);
                    break;
                case "bar":
                    drawBars(ctx, series, axis, st);
                    break;
                case "segments":
                    drawSegments(ctx, series, axis, st);
                    break;
                case "area":
                    drawArea(ctx, series, axis, st);
                    break;
                case "hist":
                    drawBars(ctx, series, axis, st, true);
                    break;
                case "heatmap":
                case "image":
                case "contour":
                case "contourf":
                    drawField(ctx, item, axis, st, tokens, kind);
                    break;
                case "barh":
                    drawBarH(ctx, series, axis, st);
                    break;
                case "stairs":
                    drawStairs(ctx, series, axis, st);
                    break;
                case "stem":
                    drawStem(ctx, series, axis, st);
                    break;
                case "ecdf":
                    drawEcdf(ctx, series, axis, st);
                    break;
                case "boxplot":
                    drawBoxplot(ctx, series, axis, st);
                    break;
                case "violinplot":
                case "violin":
                    drawViolin(ctx, series, axis, st);
                    break;
                case "pie":
                    drawPie(ctx, series, axis, st, tokens);
                    break;
                case "hexbin":
                    drawHexbin(ctx, item, axis, st);
                    break;
                case "quiver":
                    drawQuiver(ctx, item, axis, st);
                    break;
                case "table":
                    drawTable(ctx, series, axis, st, tokens);
                    break;
                default:
                    drawLine(ctx, series, axis, st, false);
            }
        }
        finally {
            ctx.restore();
        }
    }
    function pathOf(ctx, series, axis, step) {
        const { sx, sy } = axis;
        let started = false;
        let prevY = null;
        for (let i = 0; i < series.x.length; i++) {
            const px = sx.to(series.x[i]);
            const py = sy.to(series.y[i]);
            if (px == null || py == null) {
                started = false;
                continue;
            }
            if (!started) {
                ctx.moveTo(px, py);
                started = true;
            }
            else if (step && prevY != null) {
                ctx.lineTo(px, prevY);
                ctx.lineTo(px, py);
            }
            else
                ctx.lineTo(px, py);
            prevY = py;
        }
    }
    function drawLine(ctx, series, axis, st, step) {
        if (!series.x.length)
            return;
        ctx.beginPath();
        pathOf(ctx, series, axis, step);
        ctx.stroke();
    }
    function drawMarkers(ctx, series, axis, st) {
        const { sx, sy } = axis;
        const m = st.marker || {};
        const size = Math.max(1, +(m.size || 6)) / 2;
        const symbol = m.symbol || "circle";
        const step = Math.max(1, Math.ceil(series.x.length / 4000));
        ctx.fillStyle = st.color;
        for (let i = 0; i < series.x.length; i += step) {
            const px = sx.to(series.x[i]);
            const py = sy.to(series.y[i]);
            if (px == null || py == null)
                continue;
            ctx.beginPath();
            if (symbol === "square")
                ctx.rect(px - size, py - size, size * 2, size * 2);
            else if (symbol === "diamond") {
                ctx.moveTo(px, py - size);
                ctx.lineTo(px + size, py);
                ctx.lineTo(px, py + size);
                ctx.lineTo(px - size, py);
                ctx.closePath();
            }
            else if (symbol === "triangle") {
                ctx.moveTo(px, py - size);
                ctx.lineTo(px + size, py + size);
                ctx.lineTo(px - size, py + size);
                ctx.closePath();
            }
            else if (symbol === "cross") {
                ctx.moveTo(px - size, py);
                ctx.lineTo(px + size, py);
                ctx.moveTo(px, py - size);
                ctx.lineTo(px, py + size);
            }
            else
                ctx.arc(px, py, size, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    function drawBars(ctx, series, axis, st, hist) {
        const { sx, sy } = axis;
        const n = series.x.length;
        if (!n)
            return;
        const zeroY = sy.to(0) == null ? axis.box.y + axis.box.h : sy.to(0);
        let barW = 6;
        if (!hist && n > 1) {
            const dx = Math.abs(sx.to(series.x[1]) - sx.to(series.x[0]));
            barW = Math.max(1, dx * 0.8);
        }
        ctx.fillStyle = st.color;
        for (let i = 0; i < n; i++) {
            const px = sx.to(series.x[i]);
            const py = sy.to(series.y[i]);
            if (px == null || py == null)
                continue;
            const top = Math.min(py, zeroY);
            const h = Math.abs(zeroY - py);
            ctx.fillRect(px - barW / 2, top, barW, Math.max(1, h));
        }
    }
    function drawSegments(ctx, series, axis, st) {
        const { sx, sy } = axis;
        ctx.beginPath();
        for (let i = 0; i + 3 < series.x.length; i += 4) {
            const x0 = sx.to(series.x[i]), y0 = sy.to(series.y[i]);
            const x1 = sx.to(series.x[i + 2]), y1 = sy.to(series.y[i + 2]);
            if ([x0, y0, x1, y1].some((v) => v == null))
                continue;
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
        }
        ctx.stroke();
    }
    function drawArea(ctx, series, axis, st) {
        const { sx, sy } = axis;
        if (!series.x.length)
            return;
        const base = sy.to(0) == null ? axis.box.y + axis.box.h : sy.to(0);
        ctx.beginPath();
        ctx.moveTo(sx.to(series.x[0]), base);
        pathOf(ctx, series, axis, false);
        ctx.lineTo(sx.to(series.x[series.x.length - 1]), base);
        ctx.closePath();
        ctx.fillStyle = st.fill || hexAlpha(st.color, 0.25);
        ctx.fill();
        if (st.width > 0)
            ctx.stroke();
    }
    function drawField(ctx, item, axis, st, tokens, kind) {
        // 场类（heatmap/contour/image）：数据是 x/y/z 三条列，按网格索引铺像素
        const layer = item.layer || {};
        const d = layer.data || {};
        const s = item.series;
        if (!s)
            return;
        const n = s.x.length;
        let lo = item.min, hi = item.max;
        if (lo == null || hi == null) {
            let mn = Infinity, mx = -Infinity;
            for (let i = 0; i < n; i++) {
                const v = s.y[i];
                if (v === v) {
                    if (v < mn)
                        mn = v;
                    if (v > mx)
                        mx = v;
                }
            }
            lo = mn === Infinity ? 0 : mn;
            hi = mx === -Infinity ? 1 : mx;
            if (hi === lo) {
                hi = lo + 1;
            }
        }
        item.min = lo;
        item.max = hi;
        const ncols = Math.max(1, +(d.nx || d.cols || Math.round(Math.sqrt(n))));
        const nrows = Math.max(1, Math.round(n / ncols));
        const { box } = axis;
        const cellW = box.w / ncols, cellH = box.h / nrows;
        for (let i = 0; i < n; i++) {
            const r = Math.floor(i / ncols), c = i % ncols;
            const v = s.y[i];
            if (v !== v)
                continue;
            ctx.fillStyle = colorRamp(v, lo, hi, tokens);
            ctx.fillRect(box.x + c * cellW, box.y + r * cellH, cellW + 0.6, cellH + 0.6);
        }
    }
    /* ---------------- 扩展的 2D 类型 ---------------- */
    function drawBarH(ctx, series, axis, st) {
        const { sx, sy } = axis;
        const n = series.y.length;
        const base = Math.max(2, axis.box.w / Math.max(60, n * 3));
        ctx.fillStyle = st.color;
        ctx.globalAlpha = (st.opacity == null ? 1 : st.opacity) * 0.85;
        for (let i = 0; i < n; i++) {
            const y0 = sy.to(series.y[i]);
            const x0 = sx.to(0);
            const x1 = sx.to(series.x[i]);
            ctx.fillRect(Math.min(x0, x1), y0 - base / 2, Math.abs(x1 - x0), base);
        }
    }
    function drawStairs(ctx, series, axis, st) {
        const { sx, sy } = axis;
        ctx.beginPath();
        for (let i = 0; i < series.x.length; i++) {
            const px = sx.to(series.x[i]);
            const py = sy.to(series.y[i]);
            if (i === 0)
                ctx.moveTo(px, py);
            else {
                ctx.lineTo(px, sy.to(series.y[i - 1]));
                ctx.lineTo(px, py);
            }
        }
        ctx.stroke();
    }
    function drawStem(ctx, series, axis, st) {
        const { sx, sy } = axis;
        const zero = sy.to(0);
        ctx.strokeStyle = st.color;
        ctx.beginPath();
        for (let i = 0; i < series.x.length; i++) {
            const px = sx.to(series.x[i]);
            ctx.moveTo(px, zero);
            ctx.lineTo(px, sy.to(series.y[i]));
        }
        ctx.stroke();
        drawMarkers(ctx, series, axis, st);
    }
    function drawEcdf(ctx, series, axis, st) {
        const { sx, sy } = axis;
        const ys = Array.from(series.y).sort((a, b) => a - b);
        const n = ys.length;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const px = sx.to(ys[i]);
            const py = sy.to((i + 1) / n);
            if (i === 0)
                ctx.moveTo(px, py);
            else {
                ctx.lineTo(px, sy.to(i / n));
                ctx.lineTo(px, py);
            }
        }
        ctx.stroke();
    }
    function drawBoxGroup(ctx, axis, st, values, offset, width) {
        const { sx, sy } = axis;
        const s = Array.from(values).sort((a, b) => a - b);
        if (!s.length)
            return;
        const q1 = quantile(s, 0.25), med = quantile(s, 0.5), q3 = quantile(s, 0.75);
        const iqr = q3 - q1;
        const lo = Math.max(s[0], q1 - 1.5 * iqr), hi = Math.min(s[s.length - 1], q3 + 1.5 * iqr);
        const cx = sx.to(offset);
        ctx.strokeStyle = st.color;
        ctx.fillStyle = st.color;
        ctx.globalAlpha = 0.18;
        ctx.fillRect(cx - width / 2, sy.to(q3), width, sy.to(q1) - sy.to(q3));
        ctx.globalAlpha = 1;
        ctx.strokeRect(cx - width / 2, sy.to(q3), width, sy.to(q1) - sy.to(q3));
        ctx.beginPath();
        ctx.moveTo(cx - width / 2, sy.to(med));
        ctx.lineTo(cx + width / 2, sy.to(med));
        ctx.moveTo(cx, sy.to(q3));
        ctx.lineTo(cx, sy.to(hi));
        ctx.moveTo(cx, sy.to(q1));
        ctx.lineTo(cx, sy.to(lo));
        ctx.moveTo(cx - width / 4, sy.to(hi));
        ctx.lineTo(cx + width / 4, sy.to(hi));
        ctx.moveTo(cx - width / 4, sy.to(lo));
        ctx.lineTo(cx + width / 4, sy.to(lo));
        ctx.stroke();
    }
    function drawBoxplot(ctx, series, axis, st) {
        const xs = Array.from(series.x);
        const groups = new Map();
        xs.forEach((v, i) => { if (!groups.has(v))
            groups.set(v, []); groups.get(v).push(series.y[i]); });
        const keys = Array.from(groups.keys()).sort((a, b) => a - b);
        const width = Math.max(8, axis.box.w / Math.max(6, keys.length * 3));
        keys.forEach((k) => drawBoxGroup(ctx, axis, st, groups.get(k), k, width));
    }
    function drawViolin(ctx, series, axis, st) {
        const { sx, sy } = axis;
        const ys = Array.from(series.y);
        const s = ys.slice().sort((a, b) => a - b);
        if (!s.length)
            return;
        const cx = sx.to(series.x[0] != null ? series.x[0] : 0);
        const bins = 16, lo = s[0], hi = s[s.length - 1];
        const span = hi - lo || 1;
        const counts = new Array(bins).fill(0);
        ys.forEach((v) => { const b = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / span * bins))); counts[b]++; });
        const maxC = Math.max(1, ...counts);
        const halfW = Math.min(axis.box.w / 8, 18);
        ctx.beginPath();
        for (let b = 0; b < bins; b++) {
            const y0 = lo + span * (b / bins), y1 = lo + span * ((b + 1) / bins);
            const w = (counts[b] / maxC) * halfW;
            if (b === 0)
                ctx.moveTo(cx - w, sy.to(y0));
            ctx.lineTo(cx - w, sy.to(y1));
        }
        for (let b = bins - 1; b >= 0; b--) {
            const y1 = lo + span * ((b + 1) / bins);
            const w = (counts[b] / maxC) * halfW;
            ctx.lineTo(cx + w, sy.to(y1));
        }
        ctx.closePath();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = st.color;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
    }
    function drawPie(ctx, series, axis, st, tokens) {
        const box = axis.box;
        const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
        const r = Math.min(box.w, box.h) * 0.38;
        const vals = Array.from(series.y).map((v) => Math.abs(v) || 0);
        const total = vals.reduce((a, b) => a + b, 0) || 1;
        let ang = -Math.PI / 2;
        vals.forEach((v, i) => {
            const next = ang + (v / total) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, r, ang, next);
            ctx.closePath();
            ctx.fillStyle = (st.color && i === 0) ? st.color : PALETTE[i % PALETTE.length];
            ctx.globalAlpha = 0.85;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.strokeStyle = tokens.paper || "#fff";
            ctx.lineWidth = 1;
            ctx.stroke();
            ang = next;
        });
    }
    function drawHexbin(ctx, item, axis, st) {
        const s = item.series;
        if (!s)
            return;
        const bins = 24;
        const g = new Array(bins * bins).fill(0);
        const x0 = axis.xlim[0], x1 = axis.xlim[1], y0 = axis.ylim[0], y1 = axis.ylim[1];
        const spanX = x1 - x0 || 1, spanY = y1 - y0 || 1;
        for (let i = 0; i < s.x.length; i++) {
            const bx = Math.min(bins - 1, Math.max(0, Math.floor((s.x[i] - x0) / spanX * bins)));
            const by = Math.min(bins - 1, Math.max(0, Math.floor((s.y[i] - y0) / spanY * bins)));
            g[by * bins + bx]++;
        }
        const maxC = Math.max(1, ...g);
        const cw = axis.box.w / bins, ch = axis.box.h / bins;
        for (let by = 0; by < bins; by++)
            for (let bx = 0; bx < bins; bx++) {
                const c = g[by * bins + bx];
                if (!c)
                    continue;
                ctx.globalAlpha = 0.15 + 0.85 * (c / maxC);
                ctx.fillStyle = st.color;
                ctx.fillRect(axis.box.x + bx * cw, axis.box.y + (bins - 1 - by) * ch, cw + 1, ch + 1);
            }
        ctx.globalAlpha = 1;
    }
    function drawQuiver(ctx, item, axis, st) {
        const d = item.layer.data || {};
        const store = item.store;
        const s = item.series;
        if (!s)
            return;
        const { sx, sy } = axis;
        const u = d.u && store.get(d.u), v = d.v && store.get(d.v);
        const n = s.x.length;
        const step = Math.max(1, Math.floor(n / 34));
        ctx.strokeStyle = st.color;
        ctx.fillStyle = st.color;
        for (let i = 0; i < n; i += step) {
            const ux = u ? u.values[i] : 0, vy = v ? v.values[i] : 0;
            if (!isFinite(ux) || !isFinite(vy))
                continue;
            const px = sx.to(s.x[i]), py = sy.to(s.y[i]);
            const qx = sx.to(s.x[i] + ux), qy = sy.to(s.y[i] + vy);
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(qx, qy);
            ctx.stroke();
            const ang = Math.atan2(qy - py, qx - px), len = 4;
            ctx.beginPath();
            ctx.moveTo(qx, qy);
            ctx.lineTo(qx - len * Math.cos(ang - 0.4), qy - len * Math.sin(ang - 0.4));
            ctx.lineTo(qx - len * Math.cos(ang + 0.4), qy - len * Math.sin(ang + 0.4));
            ctx.closePath();
            ctx.fill();
        }
    }
    function drawTable(ctx, series, axis, st, tokens) {
        const box = axis.box;
        const n = Math.min(series.x.length, 24);
        const rowH = Math.min(22, box.h / (n + 2));
        ctx.font = "12px ui-monospace, monospace";
        ctx.fillStyle = st.color;
        ctx.textBaseline = "middle";
        for (let i = 0; i < n; i++) {
            const y = box.y + rowH * (i + 0.5);
            ctx.fillText(String(series.x[i]), box.x + 8, y);
            ctx.fillText(String(series.y[i]), box.x + box.w * 0.55, y);
        }
        ctx.strokeStyle = tokens.grid || "#ddd";
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
            const y = box.y + rowH * i;
            ctx.moveTo(box.x, y);
            ctx.lineTo(box.x + box.w, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
    }
    function drawLegend(ctx, drawn, axis, tokens) {
        const items = drawn.filter((it) => it.layer.legend !== false && it.series);
        if (!items.length)
            return;
        const { box } = axis;
        ctx.font = FONT_SMALL;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        let y = box.y + 12;
        for (const it of items) {
            const st = styleOf(it.layer, it.layer.style && it.layer.style.color);
            ctx.strokeStyle = st.color;
            ctx.lineWidth = Math.max(1.5, st.width);
            ctx.setLineDash(st.dash);
            ctx.beginPath();
            ctx.moveTo(box.x + 10, y);
            ctx.lineTo(box.x + 30, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = tokens.text || "#e2e8f0";
            const label = it.layer.label || (it.series && it.series.yName) || "series";
            ctx.fillText(String(label), box.x + 36, y);
            y += 16;
        }
    }
    /* ---------------- 拾取（hover 读数） ---------------- */
    function pick(result, px, py) {
        let best = null;
        for (const item of result.pickables) {
            const { sx, sy } = item.axis;
            const step = Math.max(1, Math.ceil(item.series.x.length / 2000));
            for (let i = 0; i < item.series.x.length; i += step) {
                const X = sx.to(item.series.x[i]);
                const Y = sy.to(item.series.y[i]);
                if (X == null || Y == null)
                    continue;
                const d = (X - px) * (X - px) + (Y - py) * (Y - py);
                if (!best || d < best.d)
                    best = { d, x: item.series.x[i], y: item.series.y[i], item };
            }
        }
        if (!best || best.d > 40 * 40)
            return null;
        return best;
    }
    window.Plot2D = { render, pick, PALETTE };
})();
