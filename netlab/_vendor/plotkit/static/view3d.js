import { mat4Mul, perspective, lookAt, applyMat4, niceTicks, clamp, fmtTick, hexToRgba } from "./plot3d.utils.js";
(function() {
  "use strict";
  const VS = `#version 300 es
  in vec3 aPos;
  in vec3 aNormal;
  uniform mat4 uMVP;
  uniform float uPointSize;
  out vec3 vNormal;
  void main() {
    gl_Position = uMVP * vec4(aPos, 1.0);
    gl_PointSize = uPointSize;
    vNormal = aNormal;
  }`;
  const FS = `#version 300 es
  precision mediump float;
  uniform vec4 uColor;
  uniform float uLit;       // 1 = \u66F2\u9762\u7740\u8272\uFF08Lambert\uFF09\uFF0C0 = \u7EAF\u8272
  in vec3 vNormal;
  out vec4 outColor;
  void main() {
    if (uLit < 0.5) { outColor = uColor; return; }
    vec3 n = normalize(vNormal);
    vec3 L = normalize(vec3(0.45, -0.75, 0.9));   // \u56FA\u5B9A\u659C\u4E0A\u65B9\u5149\uFF0C\u4E0E\u89C6\u89D2\u65E0\u5173
    float diff = max(dot(n, L), 0.0);
    float rim = 0.30 + 0.70 * diff;               // 30% \u73AF\u5883\u5149\uFF0C\u80CC\u9762\u4E0D\u81F3\u4E8E\u5168\u9ED1
    outColor = vec4(uColor.rgb * rim, uColor.a);
  }`;
  const PALETTE = ["#4ea1ff", "#ff8f5a", "#5ad19a", "#e6c15a", "#c98bff", "#ff6f91"];
  class View3D {
    constructor(canvas) {
      this.layers = [];
      this.yaw = -0.9;
      this.pitch = 0.42;
      this.dist = 3.2;
      this.target = [0, 0, 0];
      this.center = [0, 0, 0];
      this.radius = 1;
      this.fps = 0;
      this.deco = null;
      this.overlay = null;
      this.title = "";
      this.axisNames = ["x", "y", "z"];
      this.lo = null;
      this.hi = null;
      this.markerBuf = null;
      this.markerPos = null;
      this.trailBuf = null;
      this.trailCount = 0;
      this.selection = null;
      this.onSelect = null;
      this.onStats = null;
      this._mvp = null;
      this._frames = 0;
      this._last = 0;
      this.volProg = null;
      this.volQuad = null;
      this.volTex = null;
      this.vol = null;
      this.volSteps = 0;
      this.volGamma = 0;
      this.volGain = 0;
      this.ptProg = null;
      this.ptPos = null;
      this.ptScl = null;
      this.ptCount = 0;
      this.ptMeta = null;
      this.ptSize = 0;
      this.ptAlpha = 0;
      this._userCamera = false;
      this.canvas = canvas;
      const gl = canvas.getContext("webgl2", {
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true
      });
      if (!gl) throw new Error("\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301 WebGL2");
      this.gl = gl;
      this.layers = [];
      this.yaw = -0.9;
      this.pitch = 0.42;
      this.dist = 3.2;
      this.target = [0, 0, 0];
      this.center = [0, 0, 0];
      this.radius = 1;
      this.fps = 0;
      this.deco = null;
      this.overlay = null;
      this.title = "";
      this.axisNames = ["x", "y", "z"];
      this.lo = null;
      this.hi = null;
      this.markerBuf = null;
      this.markerPos = null;
      this.trailBuf = null;
      this.trailCount = 0;
      this.selection = null;
      this.onSelect = null;
      this._mvp = null;
      this._frames = 0;
      this._last = performance.now();
      this._build();
      this._bindInput();
      this._resize();
      requestAnimationFrame(() => this._loop());
    }
    _build() {
      const gl = this.gl;
      const compile = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(sh) || "shader \u7F16\u8BD1\u5931\u8D25");
        }
        return sh;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(prog) || "\u7A0B\u5E8F\u94FE\u63A5\u5931\u8D25");
      }
      this.prog = prog;
      this.aPos = gl.getAttribLocation(prog, "aPos");
      this.aNormal = gl.getAttribLocation(prog, "aNormal");
      this.uLit = gl.getUniformLocation(prog, "uLit");
      this.uMVP = gl.getUniformLocation(prog, "uMVP");
      this.uColor = gl.getUniformLocation(prog, "uColor");
      this.uPointSize = gl.getUniformLocation(prog, "uPointSize");
      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0.043, 0.055, 0.075, 1);
    }
    _mkProgram(vsSrc, fsSrc) {
      const gl = this.gl;
      const compile = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          throw new Error("shader: " + (gl.getShaderInfoLog(sh) || "\u7F16\u8BD1\u5931\u8D25"));
        }
        return sh;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error("link: " + (gl.getProgramInfoLog(prog) || "\u94FE\u63A5\u5931\u8D25"));
      }
      return prog;
    }
    _resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      const ov = this.overlay;
      if (ov && (ov.width !== w || ov.height !== h)) {
        ov.width = w;
        ov.height = h;
      }
    }
    /** 挂一个 2D 画布当装饰层（轴/刻度/色标/标题）。它不参与 WebGL，只是叠在上面。 */
    attachOverlay(canvas) {
      this.overlay = canvas;
      this.deco = canvas.getContext("2d");
    }
    _bindInput() {
      const c = this.canvas;
      let drag = null;
      c.addEventListener("pointerdown", (ev) => {
        const rect = c.getBoundingClientRect();
        drag = {
          x: ev.clientX,
          y: ev.clientY,
          shift: ev.shiftKey || ev.button === 1,
          select: !!ev.altKey,
          ox: ev.clientX - rect.left,
          oy: ev.clientY - rect.top
        };
        if (drag.select) {
          this.selection = { x0: drag.ox, y0: drag.oy, x1: drag.ox, y1: drag.oy };
        }
        try {
          c.setPointerCapture(ev.pointerId);
        } catch (_) {
        }
      });
      c.addEventListener("pointermove", (ev) => {
        if (!drag) return;
        if (drag.select) {
          const rect = c.getBoundingClientRect();
          this.selection = {
            x0: drag.ox,
            y0: drag.oy,
            x1: ev.clientX - rect.left,
            y1: ev.clientY - rect.top
          };
          return;
        }
        const dx = ev.clientX - drag.x;
        const dy = ev.clientY - drag.y;
        drag.x = ev.clientX;
        drag.y = ev.clientY;
        if (drag.shift) {
          const k = this.dist * 16e-4;
          const right = [Math.cos(this.yaw), -Math.sin(this.yaw), 0];
          const up = [0, 0, 1];
          this.target[0] -= dx * right[0] * k;
          this.target[1] -= dx * right[1] * k;
          this.target[2] += dy * k * up[2];
        } else {
          this.yaw -= dx * 6e-3;
          this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dy * 6e-3));
        }
      });
      const stop = () => {
        if (drag && drag.select && this.selection && this.onSelect) {
          const sel = this.selection;
          const w = c.clientWidth || 1;
          const h = c.clientHeight || 1;
          const toNdcX = (px) => px / w * 2 - 1;
          const toNdcY = (py) => 1 - py / h * 2;
          const rect = [toNdcX(sel.x0), toNdcY(sel.y1), toNdcX(sel.x1), toNdcY(sel.y0)];
          if (Math.abs(sel.x1 - sel.x0) > 3 && Math.abs(sel.y1 - sel.y0) > 3) {
            try {
              this.onSelect({ rect, mvp: this._mvp ? Array.from(this._mvp) : null });
            } catch (err) {
              console.warn("region select failed", err);
            }
          }
          this.selection = null;
        }
        drag = null;
      };
      c.addEventListener("pointerup", stop);
      c.addEventListener("pointercancel", stop);
      c.addEventListener("wheel", (ev) => {
        ev.preventDefault();
        this.dist = Math.max(this.radius * 0.15, Math.min(this.radius * 40, this.dist * Math.exp(ev.deltaY * 12e-4)));
      }, { passive: false });
      c.addEventListener("dblclick", () => this.resetView());
    }
    resetView() {
      this.yaw = -0.9;
      this.pitch = 0.42;
      this.target = this.center.slice();
      this.dist = this.radius * 4.4;
    }
    /** 用已经解好的 {name, color, mode, positions:Float32Array} 列表替换场景。 */
    setLayers(layers) {
      const gl = this.gl;
      if (!layers.length && this.lo && isFinite(this.lo[0])) {
        this._fitCamera();
        return 0;
      }
      for (const item of this.layers) {
        gl.deleteBuffer(item.buffer);
        if (item.normalBuffer) gl.deleteBuffer(item.normalBuffer);
        if (item.indexBuffer) gl.deleteBuffer(item.indexBuffer);
      }
      this.layers = [];
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (const item of layers) {
        const pos = item.positions;
        for (let i = 0; i < pos.length; i += 3) {
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k], pos[i + k]);
            hi[k] = Math.max(hi[k], pos[i + k]);
          }
        }
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
        const entry = { ...item, buffer, count: pos.length / 3 };
        if (item.normals) {
          entry.normalBuffer = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, entry.normalBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, item.normals, gl.STATIC_DRAW);
        }
        if (item.indices) {
          entry.indexBuffer = gl.createBuffer();
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.indexBuffer);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, item.indices, gl.STATIC_DRAW);
          entry.indexCount = item.indices.length;
        }
        this.layers.push(entry);
      }
      this.lo = lo.slice();
      this.hi = hi.slice();
      if (this.layers.length) {
        this.center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
        this.radius = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-6) / 2;
        this.target = this.center.slice();
        this.dist = this.radius * 4.4;
      }
      return this.layers.reduce((n, l) => n + l.count, 0);
    }
    /** 时间轴用：一个会动的标记点（小车/粒子）。 */
    setMarker(p) {
      const gl = this.gl;
      if (!this.markerBuf) this.markerBuf = gl.createBuffer();
      this.markerPos = p ? new Float32Array([p[0], p[1], p[2]]) : null;
      if (this.markerPos) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.markerBuf);
        gl.bufferData(gl.ARRAY_BUFFER, this.markerPos, gl.DYNAMIC_DRAW);
      }
    }
    /** 时间轴用：已经走过的路径（逐帧追加，不重传整条轨迹）。 */
    setTrail(points) {
      const gl = this.gl;
      if (!this.trailBuf) this.trailBuf = gl.createBuffer();
      this.trailCount = points ? points.length / 3 : 0;
      if (this.trailCount > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.trailBuf);
        gl.bufferData(gl.ARRAY_BUFFER, points, gl.DYNAMIC_DRAW);
      }
    }
    _drawDynamic(gl) {
      if (this.trailCount > 1) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.trailBuf);
        gl.enableVertexAttribArray(this.aPos);
        gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
        gl.uniform1f(this.uLit, 0);
        gl.uniform1f(this.uPointSize, 1);
        gl.uniform4fv(this.uColor, new Float32Array([0.98, 0.72, 0.32, 0.9]));
        gl.drawArrays(gl.LINE_STRIP, 0, this.trailCount);
      }
      if (this.markerPos) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.markerBuf);
        gl.enableVertexAttribArray(this.aPos);
        gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
        gl.uniform1f(this.uLit, 0);
        gl.uniform1f(this.uPointSize, 13 * (window.devicePixelRatio || 1));
        gl.uniform4fv(this.uColor, new Float32Array([1, 0.95, 0.35, 1]));
        gl.drawArrays(gl.POINTS, 0, 1);
      }
    }
    _project(mvp, p, w, h) {
      const v = applyMat4(mvp, [p[0], p[1], p[2], 1]);
      if (!(v[3] > 1e-6)) return null;
      return [
        (v[0] / v[3] * 0.5 + 0.5) * w,
        (1 - (v[1] / v[3] * 0.5 + 0.5)) * h
      ];
    }
    /** 在 2D 叠加层上画包围盒 / 三轴 / 刻度 / 轴名 / 标题 / 图例。成本 <0.5ms。 */
    _drawDecor(mvp, w, h) {
      const ctx = this.deco;
      if (!ctx || !this.lo || !this.hi) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = w / dpr;
      const H = h / dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const lo = this.lo;
      const hi = this.hi;
      const P = (p) => {
        const r = this._project(mvp, p, w, h);
        return r ? [r[0] / dpr, r[1] / dpr] : null;
      };
      const corner = (i) => [
        i & 1 ? hi[0] : lo[0],
        i & 2 ? hi[1] : lo[1],
        i & 4 ? hi[2] : lo[2]
      ];
      const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(148,163,184,0.32)";
      for (const [a, b] of EDGES) {
        const pa = P(corner(a));
        const pb = P(corner(b));
        if (!pa || !pb) continue;
        ctx.beginPath();
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
        ctx.stroke();
      }
      const centerScreen = P(this.center) || [W / 2, H / 2];
      for (let axis = 0; axis < 3; axis++) {
        let best = null;
        const others = [0, 1, 2].filter((k) => k !== axis);
        for (let i = 0; i < 4; i++) {
          const a = [0, 0, 0];
          const b = [0, 0, 0];
          others.forEach((k, idx) => {
            const bit = i >> idx & 1;
            a[k] = b[k] = bit ? hi[k] : lo[k];
          });
          a[axis] = lo[axis];
          b[axis] = hi[axis];
          const pa = P(a);
          const pb = P(b);
          if (!pa || !pb) continue;
          const midY2 = (pa[1] + pb[1]) / 2;
          const midX2 = (pa[0] + pb[0]) / 2;
          const better = axis === 2 ? !best || midX2 < best.midX : !best || midY2 > best.midY;
          if (better) best = { pa, pb, midY: midY2, midX: midX2 };
        }
        if (!best) continue;
        ctx.strokeStyle = "rgba(203,213,225,0.78)";
        ctx.beginPath();
        ctx.moveTo(best.pa[0], best.pa[1]);
        ctx.lineTo(best.pb[0], best.pb[1]);
        ctx.stroke();
        const dx = best.pb[0] - best.pa[0];
        const dy = best.pb[1] - best.pa[1];
        const len = Math.hypot(dx, dy) || 1;
        let nx = -dy / len;
        let ny = dx / len;
        const midX = (best.pa[0] + best.pb[0]) / 2;
        const midY = (best.pa[1] + best.pb[1]) / 2;
        if ((midX - centerScreen[0]) * nx + (midY - centerScreen[1]) * ny < 0) {
          nx = -nx;
          ny = -ny;
        }
        ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const t of niceTicks(lo[axis], hi[axis], 5)) {
          const f = (t - lo[axis]) / (hi[axis] - lo[axis] || 1);
          const px = best.pa[0] + dx * f;
          const py = best.pa[1] + dy * f;
          ctx.strokeStyle = "rgba(203,213,225,0.78)";
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + nx * 5, py + ny * 5);
          ctx.stroke();
          const lx = clamp(px + nx * 15, 10, W - 10);
          const ly = clamp(py + ny * 15, 8, H - 8);
          ctx.fillStyle = "rgba(9,12,16,0.9)";
          ctx.fillText(fmtTick(t), lx + 0.7, ly + 0.7);
          ctx.fillStyle = "#9fb0c6";
          ctx.fillText(fmtTick(t), lx, ly);
        }
        const name = this.axisNames && this.axisNames[axis] || "xyz"[axis];
        ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = "#cbd5e1";
        ctx.fillText(
          name,
          clamp(best.pb[0] + nx * 30, 10, W - 10),
          clamp(best.pb[1] + ny * 30, 8, H - 8)
        );
      }
      const sel = this.selection;
      if (sel) {
        const x = Math.min(sel.x0, sel.x1);
        const y = Math.min(sel.y0, sel.y1);
        const w2 = Math.abs(sel.x1 - sel.x0);
        const h2 = Math.abs(sel.y1 - sel.y0);
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(96,165,250,0.95)";
        ctx.strokeRect(x, y, w2, h2);
        ctx.fillStyle = "rgba(96,165,250,0.12)";
        ctx.fillRect(x, y, w2, h2);
        ctx.restore();
      }
      if (this.title) {
        ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(9,12,16,0.9)";
        ctx.fillText(this.title, 13, 13);
        ctx.fillStyle = "#e2e8f0";
        ctx.fillText(this.title, 12, 12);
      }
      const items = this.layers.filter((l) => l.name).slice(0, 6);
      if (items.length) {
        ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        let y = H - 14 - (items.length - 1) * 16;
        for (const layer of items) {
          const rgb = layer.color;
          ctx.fillStyle = `rgba(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)},0.95)`;
          ctx.fillRect(W - 132, y - 5, 10, 10);
          ctx.fillStyle = "#cbd5e1";
          ctx.fillText(String(layer.name).slice(0, 18), W - 116, y);
          y += 16;
        }
      }
    }
    // ---------- 体积渲染：沿 z 切片叠加（加法混合，顺序无关，不需要逆矩阵） ----------
    _initVolume() {
      const gl = this.gl;
      if (this.volProg) return;
      const vs = `#version 300 es
      in vec2 aUv;
      uniform mat4 uMVP;
      uniform vec3 uLo, uHi;
      uniform float uZ;
      out vec3 vUvw;
      void main() {
        vec3 uvw = vec3(aUv, uZ);
        vUvw = uvw;
        gl_Position = uMVP * vec4(mix(uLo, uHi, uvw), 1.0);
      }`;
      const fs = `#version 300 es
      precision highp float;
      precision highp sampler3D;
      in vec3 vUvw;
      uniform sampler3D uField;
      uniform float uVmin, uVmax, uGamma, uGain, uSteps;
      out vec4 frag;
      vec3 ramp(float t) {
        vec3 c0 = vec3(0.03, 0.02, 0.10);
        vec3 c1 = vec3(0.38, 0.08, 0.46);
        vec3 c2 = vec3(0.97, 0.47, 0.12);
        vec3 c3 = vec3(1.00, 0.97, 0.85);
        if (t < 0.33) return mix(c0, c1, t / 0.33);
        if (t < 0.70) return mix(c1, c2, (t - 0.33) / 0.37);
        return mix(c2, c3, (t - 0.70) / 0.30);
      }
      void main() {
        float raw = texture(uField, vUvw).r;
        float x = clamp((raw - uVmin) / max(uVmax - uVmin, 1e-9), 0.0, 1.0);
        float dens = pow(x, uGamma) * uGain;
        if (dens < 0.002) discard;
        float a = clamp(dens / max(uSteps, 1.0) * 1.6, 0.0, 0.35);
        frag = vec4(ramp(x) * a, a);
      }`;
      this.volProg = this._mkProgram(vs, fs);
      const quad = new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]);
      this.volQuad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.volQuad);
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    }
    setVolume(meta, data) {
      this._initVolume();
      const gl = this.gl;
      if (this.volTex) gl.deleteTexture(this.volTex);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_3D, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage3D(
        gl.TEXTURE_3D,
        0,
        gl.R32F,
        meta.nx,
        meta.ny,
        meta.nz,
        0,
        gl.RED,
        gl.FLOAT,
        data
      );
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
      this.volTex = tex;
      this.vol = meta;
      this._growBounds(meta.x[0], meta.y[0], meta.z[0]);
      this._growBounds(meta.x[1], meta.y[1], meta.z[1]);
      this._fitCamera();
      return meta.nx * meta.ny * meta.nz;
    }
    _drawVolume(mvp) {
      if (!this.vol || !this.volTex) return;
      const gl = this.gl;
      const steps = this.volSteps || 96;
      gl.useProgram(this.volProg);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.volQuad);
      const a = gl.getAttribLocation(this.volProg, "aUv");
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_3D, this.volTex);
      gl.uniform1i(gl.getUniformLocation(this.volProg, "uField"), 6);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.volProg, "uMVP"), false, mvp);
      gl.uniform3f(gl.getUniformLocation(this.volProg, "uLo"), this.vol.x[0], this.vol.y[0], this.vol.z[0]);
      gl.uniform3f(gl.getUniformLocation(this.volProg, "uHi"), this.vol.x[1], this.vol.y[1], this.vol.z[1]);
      gl.uniform1f(gl.getUniformLocation(this.volProg, "uVmin"), this.vol.vmin);
      gl.uniform1f(gl.getUniformLocation(this.volProg, "uVmax"), this.vol.vmax);
      gl.uniform1f(gl.getUniformLocation(this.volProg, "uGamma"), this.volGamma || 1.4);
      gl.uniform1f(gl.getUniformLocation(this.volProg, "uGain"), this.volGain || 2.4);
      gl.uniform1f(gl.getUniformLocation(this.volProg, "uSteps"), steps);
      const uZ = gl.getUniformLocation(this.volProg, "uZ");
      for (let i = 0; i < steps; i++) {
        gl.uniform1f(uZ, (i + 0.5) / steps);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.enable(gl.DEPTH_TEST);
      gl.disableVertexAttribArray(a);
      gl.activeTexture(gl.TEXTURE0);
    }
    // ---------- 点云层：柔光点精灵（逐点标量着色） ----------
    _initParticles() {
      if (this.ptProg) return;
      const vs = `#version 300 es
      in vec3 aPos; in float aScalar;
      uniform mat4 uMVP; uniform float uSize;
      out float vS;
      void main() {
        vec4 c = uMVP * vec4(aPos, 1.0);
        gl_Position = c;
        gl_PointSize = uSize * (3.0 / max(c.w, 0.2));
        vS = aScalar;
      }`;
      const fs = `#version 300 es
      precision highp float;
      in float vS;
      uniform float uAlpha;
      out vec4 frag;
      vec3 ramp(float t) {
        vec3 c0 = vec3(0.35, 0.10, 0.65);
        vec3 c1 = vec3(0.15, 0.55, 0.85);
        vec3 c2 = vec3(1.00, 0.62, 0.15);
        vec3 c3 = vec3(1.00, 0.98, 0.85);
        if (t < 0.33) return mix(c0, c1, t / 0.33);
        if (t < 0.70) return mix(c1, c2, (t - 0.33) / 0.37);
        return mix(c2, c3, (t - 0.70) / 0.30);
      }
      void main() {
        float r = length(gl_PointCoord * 2.0 - 1.0);
        if (r > 1.0) discard;
        float core = exp(-r * r * 5.0);
        float halo = smoothstep(1.0, 0.1, r) * 0.25;
        frag = vec4(ramp(clamp(vS, 0.0, 1.0)) * (0.7 + 0.6 * core), (core + halo) * uAlpha);
      }`;
      this.ptProg = this._mkProgram(vs, fs);
    }
    setParticles(meta, xyz, scalar) {
      this._initParticles();
      const gl = this.gl;
      if (this.ptPos) gl.deleteBuffer(this.ptPos);
      if (this.ptScl) gl.deleteBuffer(this.ptScl);
      this.ptPos = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ptPos);
      gl.bufferData(gl.ARRAY_BUFFER, xyz, gl.STATIC_DRAW);
      this.ptScl = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ptScl);
      gl.bufferData(gl.ARRAY_BUFFER, scalar, gl.STATIC_DRAW);
      this.ptCount = meta.count;
      this.ptMeta = meta;
      this._growBounds(meta.x[0], meta.y[0], meta.z[0]);
      this._growBounds(meta.x[1], meta.y[1], meta.z[1]);
      this._fitCamera();
      return meta.count;
    }
    _drawParticles(mvp) {
      if (!this.ptCount) return;
      const gl = this.gl;
      gl.useProgram(this.ptProg);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ptPos);
      const a = gl.getAttribLocation(this.ptProg, "aPos");
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ptScl);
      const sc = gl.getAttribLocation(this.ptProg, "aScalar");
      gl.enableVertexAttribArray(sc);
      gl.vertexAttribPointer(sc, 1, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.ptProg, "uMVP"), false, mvp);
      gl.uniform1f(gl.getUniformLocation(this.ptProg, "uSize"), (this.ptSize || 3) * (window.devicePixelRatio || 1));
      gl.uniform1f(gl.getUniformLocation(this.ptProg, "uAlpha"), this.ptAlpha || 0.35);
      gl.drawArrays(gl.POINTS, 0, this.ptCount);
      gl.enable(gl.DEPTH_TEST);
      gl.disableVertexAttribArray(a);
      gl.disableVertexAttribArray(sc);
    }
    _growBounds(x, y, z) {
      if (!this.lo) this.lo = [Infinity, Infinity, Infinity];
      if (!this.hi) this.hi = [-Infinity, -Infinity, -Infinity];
      this.lo = [Math.min(this.lo[0], x), Math.min(this.lo[1], y), Math.min(this.lo[2], z)];
      this.hi = [Math.max(this.hi[0], x), Math.max(this.hi[1], y), Math.max(this.hi[2], z)];
    }
    _fitCamera() {
      if (!this.lo || !this.hi) return;
      if (!isFinite(this.lo[0]) || !isFinite(this.hi[0])) return;
      this.center = [
        (this.lo[0] + this.hi[0]) / 2,
        (this.lo[1] + this.hi[1]) / 2,
        (this.lo[2] + this.hi[2]) / 2
      ];
      this.radius = Math.max(
        this.hi[0] - this.lo[0],
        this.hi[1] - this.lo[1],
        this.hi[2] - this.lo[2],
        1e-6
      ) / 2;
      if (!this._userCamera) {
        this.target = this.center.slice();
        this.dist = this.radius * 4.4;
      }
    }
    _loop() {
      this._resize();
      const gl = this.gl;
      const { width: w, height: h } = this.canvas;
      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.prog);
      const cp = Math.cos(this.pitch);
      const eye = [
        this.target[0] + this.dist * cp * Math.cos(this.yaw),
        this.target[1] + this.dist * cp * Math.sin(this.yaw),
        this.target[2] + this.dist * Math.sin(this.pitch)
      ];
      const proj = perspective(Math.PI / 4, w / h, this.dist * 0.01, this.dist * 20);
      const view = lookAt(eye, this.target, [0, 0, 1]);
      const mvp = mat4Mul(proj, view);
      this._mvp = mvp;
      gl.uniformMatrix4fv(this.uMVP, false, mvp);
      this._drawVolume(mvp);
      gl.useProgram(this.prog);
      gl.uniformMatrix4fv(this.uMVP, false, mvp);
      for (const layer of this.layers) {
        gl.bindBuffer(gl.ARRAY_BUFFER, layer.buffer);
        gl.enableVertexAttribArray(this.aPos);
        gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
        gl.uniform4fv(this.uColor, layer.color);
        if (layer.mode === "mesh" && layer.indexBuffer) {
          gl.uniform1f(this.uLit, 1);
          gl.uniform1f(this.uPointSize, 1);
          gl.bindBuffer(gl.ARRAY_BUFFER, layer.normalBuffer);
          gl.enableVertexAttribArray(this.aNormal);
          gl.vertexAttribPointer(this.aNormal, 3, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, layer.buffer);
          gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, layer.indexBuffer);
          gl.drawElements(gl.TRIANGLES, layer.indexCount, gl.UNSIGNED_INT, 0);
          gl.disableVertexAttribArray(this.aNormal);
          gl.uniform1f(this.uLit, 0);
          continue;
        }
        gl.uniform1f(this.uLit, 0);
        if (layer.mode === "segments") {
          gl.uniform1f(this.uPointSize, 1);
          gl.drawArrays(gl.LINES, 0, layer.count);
        } else if (layer.mode === "lines") {
          gl.uniform1f(this.uPointSize, 1);
          gl.drawArrays(gl.LINE_STRIP, 0, layer.count);
        } else {
          gl.uniform1f(this.uPointSize, layer.size || 2 * (window.devicePixelRatio || 1));
          gl.drawArrays(gl.POINTS, 0, layer.count);
        }
      }
      this._drawParticles(mvp);
      this._drawDynamic(gl);
      this._drawDecor(mvp, w, h);
      this._frames += 1;
      const now = performance.now();
      if (now - this._last > 500) {
        this.fps = this._frames * 1e3 / (now - this._last);
        this._frames = 0;
        this._last = now;
        if (this.onStats) this.onStats({ fps: this.fps, points: this.layers.reduce((n, l) => n + l.count, 0) });
      }
      requestAnimationFrame(() => this._loop());
    }
  }
  function parseFrame(buffer) {
    const view = new DataView(buffer);
    const metaLen = view.getUint32(4, true);
    const n = view.getUint32(8, true);
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, metaLen)));
    const offset = 12 + metaLen;
    const positions = new Float32Array(buffer.slice(offset, offset + n * 12));
    return { meta, positions };
  }
  function parseMesh(buffer) {
    const view = new DataView(buffer);
    const metaLen = view.getUint32(4, true);
    const nvert = view.getUint32(8, true);
    const ntri = view.getUint32(12, true);
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 16, metaLen)));
    const base = 16 + metaLen;
    const positions = new Float32Array(buffer.slice(base, base + nvert * 12));
    const nOff = base + nvert * 12;
    const normals = new Float32Array(buffer.slice(nOff, nOff + nvert * 12));
    const iOff = nOff + nvert * 12;
    const indices = new Uint32Array(buffer.slice(iOff, iOff + ntri * 12));
    return { meta, positions, normals, indices };
  }
  function parseVolume(buffer) {
    const view = new DataView(buffer);
    const metaLen = view.getUint32(4, true);
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, metaLen)));
    const offset = 12 + metaLen;
    return { meta, field: new Float32Array(buffer.slice(offset)) };
  }
  function parseParticles(buffer) {
    const view = new DataView(buffer);
    const metaLen = view.getUint32(4, true);
    const n = view.getUint32(8, true);
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, metaLen)));
    const base = 12 + metaLen;
    return {
      meta,
      xyz: new Float32Array(buffer.slice(base, base + n * 12)),
      scalar: new Float32Array(buffer.slice(base + n * 12, base + n * 16))
    };
  }
  window.PK3D = { View3D, hexToRgba, parseFrame, parseMesh, parseVolume, parseParticles, PALETTE };
})();
