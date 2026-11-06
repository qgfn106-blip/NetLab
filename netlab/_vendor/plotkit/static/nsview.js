const NS = /* @__PURE__ */ (() => {
  const VERT = `#version 300 es
  in vec2 aPos;
  void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const FRAG_VOL = `#version 300 es
  precision highp float;
  uniform vec2 uRes;
  uniform mat4 uInvVP;
  uniform vec3 uCam;
  uniform sampler2D uField;   // (r,z) -> [log10 Omega, |u|]
  uniform vec2 uExtent;       // r_max, z_max
  uniform float uStep;
  uniform float uDensity;
  uniform vec2 uRange;
  uniform float uAxis;
  uniform float uTime;
  uniform float uTau;
  uniform float uStreak;
  uniform float uSpin;
  uniform float uEnvelope;
  uniform float uZoomScale;   // 0=\u67F1, 1=\u8584\u76D8\uFF08\u663E\u793A\u5305\u7EDC\uFF0C\u975E\u7269\u7406\uFF09
  uniform vec3 uCore, uMid, uOuter;
  out vec4 fragColor;

  vec3 ramp(float s) {
    // 0 \u2192 \u5916\u5708\u84DD\u7D2B, 0.55 \u2192 \u9752\u7EFF, 1 \u2192 \u6A59\u9EC4\u6838\u5FC3
    vec3 c = mix(uOuter, uMid, smoothstep(0.05, 0.55, s));
    return mix(c, uCore, smoothstep(0.55, 1.0, s));
  }

  float sampleField(vec3 p, out float speed) {
    float r = length(p.xy) / uExtent.x;
    float z = (p.z / uExtent.y) * 0.5 + 0.5;
    if (r > 1.0 || z < 0.0 || z > 1.0) { speed = 0.0; return 0.0; }
    vec4 t = texture(uField, vec2(r, z));
    speed = t.g;
    return t.r;
  }

  void main() {
    vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
    vec4 pNear = uInvVP * vec4(ndc, -1.0, 1.0);
    vec4 pFar  = uInvVP * vec4(ndc,  1.0, 1.0);
    vec3 o = pNear.xyz / pNear.w;
    vec3 d = normalize(pFar.xyz / pFar.w - o);

    // \u4E0E\u5706\u67F1\u5305\u56F4\u76D2\u6C42\u4EA4\uFF1A|xy| <= r_max, |z| <= z_max
    float t0 = 0.0, t1 = 60.0;
    float a = dot(d.xy, d.xy);
    float b = 2.0 * dot(o.xy, d.xy);
    float c = dot(o.xy, o.xy) - uExtent.x * uExtent.x;
    if (a > 1e-8) {
      float disc = b * b - 4.0 * a * c;
      if (disc < 0.0) { fragColor = vec4(0.0); return; }
      float sq = sqrt(disc);
      t0 = max(t0, (-b - sq) / (2.0 * a));
      t1 = min(t1, (-b + sq) / (2.0 * a));
    }
    if (abs(d.z) > 1e-8) {
      float za = (-uExtent.y - o.z) / d.z;
      float zb = ( uExtent.y - o.z) / d.z;
      t0 = max(t0, min(za, zb));
      t1 = min(t1, max(za, zb));
    }
    if (t1 <= t0) { fragColor = vec4(0.0); return; }

    float dt = max(uStep, (t1 - t0) / 220.0);
    vec3 acc = vec3(0.0);
    float alpha = 0.0;
    for (float s = t0; s < t1; s += dt) {
      vec3 p = o + d * s;
      float speed;
      float v = sampleField(p, speed);
      if (v > -20.0) {
        float omega = pow(10.0, v);
        float x = clamp(omega / max(uAxis, 1e-6), 0.0, 1.0);
        // \u8F6F\u4F20\u9012\uFF1Apow(x,8) \u53EA\u4F1A\u5269\u4E0B"\u6700\u5F3A\u7B49\u503C\u9762"\u90A3\u4E00\u5C42\u7EC6\u4E1D\uFF08\u8BE5\u81EA\u76F8\u4F3C\u573A \u03A9 \u6CBF r \u5F88\u5E73\uFF09\uFF0C
        // \u7528 sqrt \u578B\u5BBD\u4F20\u9012\u624D\u80FD\u8BA9\u6574\u6839\u6DA1\u67F1\u53D1\u4EAE\uFF0C\u5BBD\u2192\u7A84\u7684\u6536\u7F29\u624D\u770B\u5F97\u51FA\u6765\u3002
        float dens = (0.12 + 0.88 * pow(x, 1.5)) * uDensity;
        float theta = atan(p.y, p.x);
        float phi = theta - uSpin * omega * uTime;
        float zs = p.z * max(uTau, 1e-3);
        float streak = 0.5 + 0.5 * sin(6.0 * phi + 2.4 * sin(9.0 * zs + 1.7 * phi));
        dens *= mix(1.0, 0.12 + 1.75 * streak, uStreak);
        float speedN = clamp(speed / 6.0, 0.0, 1.0);
        vec3 col = ramp(x) * (0.55 + 0.9 * speedN);
        float radial = exp(-5.2 * pow(length(p.xy) / uExtent.x, 2.0));
        // \u8F74\u5411\u663E\u793A\u5305\u7EDC\uFF1A\u8BE5\u81EA\u76F8\u4F3C\u573A\u5728 z \u65B9\u5411\u6CA1\u6709\u7279\u5F81\u957F\u5EA6\uFF08\u7269\u7406\u4E0A\u662F\u957F\u67F1\uFF09\uFF0C
        // \u8FD9\u91CC\u6309 |z| \u52A0\u4E00\u5C42\u9AD8\u65AF\u5305\u7EDC\u628A"\u67F1"\u6536\u6210"\u76D8"\uFF0C\u7EAF\u5C5E\u663E\u793A\u52A0\u6743\uFF0C\u754C\u9762\u6807\u6CE8\u975E\u7269\u7406\u3002
        float lz = mix(1.0, 0.16, uEnvelope);
        float axial = exp(-pow(abs(p.z) / (uExtent.y * lz), 2.2));
        // \u76D8\u8FB9\u7F18\u505A\u4E00\u70B9\u5916\u6269\uFF0C\u5F62\u6210"\u8D64\u9053\u76D8 + \u4E0A\u4E0B\u9525"\u7684\u8FC7\u6E21
        float flare = mix(0.0, 0.55, uEnvelope) * exp(-pow(abs(p.z) / (uExtent.y * lz * 1.9), 2.0));
        radial *= (1.0 + flare);
        // \u6536\u6210\u76D8\u65F6\u5149\u7A0B\u53D8\u77ED\u3001\u4EAE\u5EA6\u4F1A\u96C6\u4E2D\uFF0C\u6309\u5305\u7EDC\u5F3A\u5EA6\u538B\u4E00\u4E0B\u66DD\u5149\u514D\u5F97\u7CCA\u6210\u767D\u997C
        // \u91C7\u6837\u76D2\u7F29\u5C0F\u540E\u4E00\u6761\u5149\u7EBF\u7A7F\u8FC7\u7684\u4E16\u754C\u8DDD\u79BB\u4E5F\u53D8\u77ED\uFF0C\u6309 1/scale \u8865\u66DD\u5149\uFF08\u4E0A\u9650 8\xD7\uFF09
        float zoomComp = clamp(1.0 / max(uZoomScale, 1e-3), 1.0, 3.0);
        float a = clamp(dens * dt * 2.2 * mix(1.0, 0.55, uEnvelope) * zoomComp, 0.0, 0.12) * radial * axial;
        acc += (1.0 - alpha) * a * col;
        alpha += (1.0 - alpha) * a;
        if (alpha > 0.985) break;
      }
    }
    // \u8F7B\u5FAE\u8F89\u5149\uFF1A\u628A\u4EAE\u5EA6\u505A\u4E00\u6B21\u8F6F\u538B\u7F29
    acc = acc / (1.0 + 1.7 * acc);   // Reinhard \u578B\u538B\u7F29\uFF0C\u9632\u6B62\u6838\u5FC3\u7CCA\u6210\u7EAF\u767D
    fragColor = vec4(acc, alpha);
  }`;
  const VERT_PT = `#version 300 es
  in vec3 aPos;
  in vec3 aPrev;          // \u4E0A\u4E00\u5E27\u4F4D\u7F6E\uFF1A\u7528\u5B83\u63D2\u503C\u51FA"\u8FD0\u52A8\u62D6\u5C3E"\u7684\u6B8B\u5F71
  in float aAge;
  in vec3 aCol;
  uniform mat4 uVP;
  uniform float uPointSize;
  uniform float uLerp;    // 0 = \u5F53\u524D\u4F4D\u7F6E\uFF1B\u8D8A\u5927\u8D8A\u9760\u540E\uFF08\u6B8B\u5F71\u8D8A\u6DE1\u8D8A\u5C0F\uFF09
  uniform float uAlphaScale;
  out float vAge;
  out vec3 vCol;
  out float vFade;
  void main() {
    vec3 p = mix(aPos, aPrev, uLerp);
    vec4 c = uVP * vec4(p, 1.0);
    gl_Position = c;
    gl_PointSize = uPointSize * (1.0 - 0.25 * aAge) * (1.0 - 0.55 * uLerp) * (3.0 / max(c.w, 0.2));
    vAge = aAge;
    vCol = aCol;
    vFade = (1.0 - 0.62 * uLerp) * uAlphaScale;
  }`;
  const FRAG_PT = `#version 300 es
  precision highp float;
  in float vAge;
  in vec3 vCol;
  in float vFade;
  uniform vec3 uColor;
  out vec4 fragColor;
  void main() {
    // \u5706\u5F62\u67D4\u5149\u70B9\u7CBE\u7075\uFF1A\u6838\u5FC3\u9AD8\u65AF + \u5916\u5708\u5149\u6655\uFF08\u539F\u6765\u662F\u786C\u8FB9\u5706\u76D8\uFF0C\u653E\u5927\u540E\u80FD\u770B\u5230\u952F\u9F7F\u65B9\u89D2\uFF09
    float r = length(gl_PointCoord * 2.0 - 1.0);
    if (r > 1.0) discard;
    float core = exp(-r * r * 5.5);
    float halo = smoothstep(1.0, 0.1, r) * 0.14;
    float a = (core + halo) * (1.0 - 0.25 * vAge) * vFade * 0.038;
    vec3 col = vCol * (0.85 + 0.45 * core) + vec3(0.10 * core);
    fragColor = vec4(col, a);
  }`;
  const VERT_RIB = `#version 300 es
  precision highp float;
  uniform mat4 uVP;
  uniform sampler2D uHist;
  uniform int uK;
  uniform int uHead;
  uniform int uW;
  uniform int uRows;
  uniform float uAlpha;
  uniform int uStride;
  out float vFade;
  void main() {
    int id = gl_InstanceID * uStride;   // LOD\uFF1A\u7C92\u5B50\u592A\u591A\u65F6\u6309\u6B65\u957F\u8DF3\u7740\u753B
    int k = (gl_VertexID + uHead) % uK;
    int x = id % uW;
    int y = k * uRows + id / uW;
    vec3 p = texelFetch(uHist, ivec2(x, y), 0).xyz;
    gl_Position = uVP * vec4(p, 1.0);
    float age = float(gl_VertexID) / float(max(uK - 1, 1));
    vFade = (1.0 - age) * (1.0 - age) * uAlpha;
  }`;
  const FRAG_RIB = `#version 300 es
  precision highp float;
  in float vFade;
  out vec4 fragColor;
  void main() {
    fragColor = vec4(vec3(1.0, 0.66, 0.30) * vFade, vFade);
  }`;
  const VERT_LN = `#version 300 es
  in vec3 aPos;
  in float aT;
  uniform mat4 uVP;
  uniform float uHead;
  uniform float uRMax;
  out float vA;
  out float vR;
  void main() {
    gl_Position = uVP * vec4(aPos, 1.0);
    vR = length(aPos.xy) / max(uRMax, 1e-6);
    // \u5934\u90E8\u968F uHead \u751F\u957F\uFF0C\u5C3E\u90E8\u6DE1\u51FA\uFF1A\u5426\u5219\u6BCF\u6761\u7EBF\u90FD\u662F\u4E00\u6574\u6839\u3001\u5806\u5728\u5FC3\u6838\u7CCA\u6210\u4E00\u56E2
    float head = clamp((uHead - aT) * 6.0, 0.0, 1.0);
    float tail = smoothstep(0.0, 0.18, aT);
    vA = head * tail * 0.26;
  }`;
  const FRAG_LN = `#version 300 es
  precision highp float;
  in float vA;
  in float vR;
  uniform vec3 uColor;      // \u517C\u5BB9\u65E7\u8C03\u7528\uFF1AuColor \u4F5C\u5185\u5708\u8272
  out vec4 fragColor;
  void main() {
    // \u5185\u5708\u6696\u8272\u3001\u5916\u5708\u84DD\u7D2B\uFF0C\u548C\u4F53\u79EF/\u7C92\u5B50\u7684\u8C03\u8272\u677F\u4E00\u81F4\uFF0C\u907F\u514D\u4E00\u6839\u7A81\u5140\u7684\u7C73\u8272\u4E71\u7EBF
    vec3 outer = vec3(0.62, 0.50, 1.00);
    vec3 c = mix(uColor, outer, clamp((vR - 0.18) / 0.5, 0.0, 1.0));
    fragColor = vec4(c, vA);
  }`;
  const VERT_AR = `#version 300 es
  in vec3 aPos;
  in vec3 aCol;
  uniform mat4 uVP;
  out vec3 vCol;
  void main() {
    gl_Position = uVP * vec4(aPos, 1.0);
    vCol = aCol;
  }`;
  const FRAG_AR = `#version 300 es
  precision highp float;
  in vec3 vCol;
  uniform float uAlpha;
  out vec4 fragColor;
  void main() { fragColor = vec4(vCol, uAlpha); }`;
  const mat4 = {
    mul(a, b) {
      const o = new Float32Array(16);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
        o[i * 4 + j] = s;
      }
      return o;
    },
    perspective(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    },
    lookAt(eye, target, up) {
      const z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
      return new Float32Array([
        x[0],
        y[0],
        z[0],
        0,
        x[1],
        y[1],
        z[1],
        0,
        x[2],
        y[2],
        z[2],
        0,
        -dot(x, eye),
        -dot(y, eye),
        -dot(z, eye),
        1
      ]);
    },
    invert(m) {
      const inv = new Float32Array(16);
      const a = m;
      const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4];
      const b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5];
      const b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
      const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12];
      const b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13];
      const b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return null;
      det = 1 / det;
      inv[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det;
      inv[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
      inv[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det;
      inv[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
      inv[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det;
      inv[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
      inv[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det;
      inv[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
      inv[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det;
      inv[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
      inv[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det;
      inv[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
      inv[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det;
      inv[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
      inv[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det;
      inv[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
      return inv;
    }
  };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  class NSView {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.gl = canvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: true });
      if (!this.gl) throw new Error("\u9700\u8981 WebGL2");
      const gl = this.gl;
      this.quad = program(gl, VERT, FRAG_VOL);
      this.points = program(gl, VERT_PT, FRAG_PT);
      this.ribbon = program(gl, VERT_RIB, FRAG_RIB);
      this.lines = program(gl, VERT_LN, FRAG_LN);
      this.arrowProg = program(gl, VERT_AR, FRAG_AR);
      this.quadBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.presets = {
        top: { yaw: -Math.PI / 2, pitch: 1.33, dist: 2.55 },
        // 近俯视：环盘接近正圆
        side: { yaw: -0.6, pitch: 0.1, dist: 3 },
        // 侧视：看轴向拉伸
        home: { yaw: -0.6, pitch: 0.62, dist: 3.1 }
        // 默认 3/4 视角
      };
      this.cam = { yaw: -0.6, pitch: 0.62, dist: 3.1, target: [0, 0, 0] };
      this.zoomScale = 1;
      this.setZoomScale = (k) => {
        this.zoomScale = Math.max(0.05, Math.min(20, k));
      };
      this.extent = [0.35, 1.2];
      this.particles = null;
      this.trails = null;
      this.settings = {
        density: 1,
        pointSize: 5.4,
        trail: 0.6,
        envelope: 0.45,
        showParticles: true,
        showTrails: false,
        showArrows: false,
        arrowLen: 0.14,
        arrowAlpha: 0.9,
        streaks: 0.8,
        spin: 2,
        bloom: 0.28,
        bloomThresh: 0.92,
        ringAlpha: 0.22,
        showRings: true
      };
      this.time = 0;
      this.tau = 1;
      this.stats = { fps: 0 };
      this._frames = 0;
      this._t0 = performance.now();
      this._bindInput();
      this._resize();
      window.addEventListener("resize", () => this._resize());
      requestAnimationFrame(() => this._loop());
    }
    _resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = this.canvas.clientWidth || 800, h = this.canvas.clientHeight || 600;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    _bindInput() {
      const c = this.canvas;
      let drag = null;
      c.addEventListener("pointerdown", (e) => {
        drag = { x: e.clientX, y: e.clientY };
        c.setPointerCapture(e.pointerId);
      });
      c.addEventListener("pointerup", () => {
        drag = null;
      });
      c.addEventListener("pointermove", (e) => {
        if (!drag) return;
        this.cam.yaw += (e.clientX - drag.x) * 8e-3;
        this.cam.pitch = Math.max(-1.4, Math.min(1.4, this.cam.pitch + (e.clientY - drag.y) * 6e-3));
        drag = { x: e.clientX, y: e.clientY };
      });
      c.addEventListener("wheel", (e) => {
        e.preventDefault();
        this.cam.dist = Math.max(0.5, Math.min(12, this.cam.dist * (1 + Math.sign(e.deltaY) * 0.08)));
      }, { passive: false });
    }
    setField(meta, data) {
      const gl = this.gl;
      const nz = meta.n_z, nr = meta.n_r;
      const scalar = data.subarray(0, nz * nr);
      const speed = data.subarray(nz * nr, nz * nr * 2);
      const packed = new Float32Array(nz * nr * 2);
      for (let i = 0; i < nz * nr; i++) {
        packed[i * 2] = scalar[i];
        packed[i * 2 + 1] = speed[i];
      }
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, nr, nz, 0, gl.RG, gl.FLOAT, packed);
      const prevR = this.extent ? this.extent[0] : meta.r_max;
      const prevZ = this.extent ? this.extent[1] : meta.z_max;
      if (this.particles && prevR > 0 && prevZ > 0 && (Math.abs(prevR - meta.r_max) > 1e-9 || Math.abs(prevZ - meta.z_max) > 1e-9)) {
        const kr = meta.r_max / prevR;
        const kz = meta.z_max / prevZ;
        const pos = this.particles.pos;
        for (let i = 0; i < pos.length; i += 3) {
          pos[i] *= kr;
          pos[i + 1] *= kr;
          pos[i + 2] *= kz;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.particles.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
      }
      this.extent = [meta.r_max, meta.z_max];
      this.fieldMeta = meta;
      this.vmin = meta.vmin;
      this.vmax = meta.vmax;
      this.omegaAxis = meta.omega_p995;
    }
    setVelocity(meta, data) {
      this.vel = { n: meta.n, extent: meta.extent, zExtent: meta.z_extent, data };
      if (this.settings.gpuAdvect !== false) {
        if (this.settings.gpuAdvect === true && this._initParticleGPU()) this._uploadVelTex();
      }
    }
    seedParticles(count = 12e4) {
      const rng = mulberry32(12345);
      const pos = new Float32Array(count * 3);
      const age = new Float32Array(count);
      const col = new Float32Array(count * 3);
      const rMax = this.extent && this.extent[0] || 0.5;
      const zMax = this.extent && this.extent[1] || 1.2;
      for (let i = 0; i < count; i++) {
        const th = i * 2.399963229728653 % (Math.PI * 2);
        const disk = rng() < 0.78;
        const SHELLS = 40;
        const shell = Math.floor(rng() * SHELLS);
        const rr = disk ? rMax * (shell + 0.5) / SHELLS * (0.997 + 6e-3 * rng()) : 0.02 + 0.16 * rMax * Math.sqrt(rng());
        const zz = disk ? (rng() * 2 - 1) * 0.035 * zMax : (rng() * 2 - 1) * 0.92 * zMax;
        const taper = disk ? 1 : 1 - 0.86 * Math.pow(Math.abs(zz) / zMax, 1.1);
        pos[i * 3] = rr * taper * Math.cos(th);
        pos[i * 3 + 1] = rr * taper * Math.sin(th);
        pos[i * 3 + 2] = zz;
        age[i] = rng();
        const rn = Math.min(1, rr / rMax);
        const pal = (t) => {
          if (t < 0.25) {
            const k2 = t / 0.25;
            return [1, 0.95 + (0.6 - 0.95) * k2, 0.8 + (0.15 - 0.8) * k2];
          }
          if (t < 0.55) {
            const k2 = (t - 0.25) / 0.3;
            return [1 + (0.2 - 1) * k2, 0.6 + (0.82 - 0.6) * k2, 0.15 + (0.72 - 0.15) * k2];
          }
          const k = (t - 0.55) / 0.45;
          return [0.28 + (0.45 - 0.28) * k, 0.86 + (0.4 - 0.86) * k, 0.78 + (1 - 0.78) * k];
        };
        const c0 = pal(rn);
        const dim = disk ? 1 : 0.72;
        col[i * 3] = c0[0] * dim;
        col[i * 3 + 1] = c0[1] * dim;
        col[i * 3 + 2] = c0[2] * dim;
      }
      const gl = this.gl;
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
      const abo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, abo);
      gl.bufferData(gl.ARRAY_BUFFER, age, gl.STATIC_DRAW);
      const cbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, cbo);
      gl.bufferData(gl.ARRAY_BUFFER, col, gl.DYNAMIC_DRAW);
      const prev = new Float32Array(pos);
      const pvo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, pvo);
      gl.bufferData(gl.ARRAY_BUFFER, prev, gl.DYNAMIC_DRAW);
      const K = 8, W = 1024, rows = Math.ceil(count / W);
      const hist = new Float32Array(K * rows * W * 3);
      for (let k = 0; k < K; k++) hist.set(pos, k * rows * W * 3);
      const histTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, histTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, W, rows * K, 0, gl.RGB, gl.FLOAT, hist);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.particles = {
        pos,
        prev,
        age,
        col,
        vbo,
        pvo,
        abo,
        cbo,
        count,
        hist,
        histTex,
        K,
        W,
        rows,
        slot: 0
      };
      if (this.settings.gpuAdvect === true) this._initParticleGPU();
    }
    setTime(t, tBlow) {
      this.time = t;
      this.tau = Math.max(1e-3, tBlow - t);
    }
    setArrows(meta, data) {
      const n = meta.count;
      const f = new Float32Array(data);
      const pos = new Float32Array(n * 2 * 3);
      const col = new Float32Array(n * 2 * 3);
      const umax = Math.max(meta.u_max || 1e-6, 1e-6);
      let vmax = 1e-6;
      for (let i = 0; i < n; i++) vmax = Math.max(vmax, Math.hypot(f[i * 6 + 3], f[i * 6 + 4], f[i * 6 + 5]));
      const len = this.settings.arrowLen;
      for (let i = 0; i < n; i++) {
        const x = f[i * 6], y = f[i * 6 + 1], z = f[i * 6 + 2];
        const vx = f[i * 6 + 3], vy = f[i * 6 + 4], vz = f[i * 6 + 5];
        const m = Math.hypot(vx, vy, vz) || 1e-9;
        const t = Math.min(1, m / vmax);
        const L = len * (0.35 + 0.65 * t);
        const o = i * 6;
        pos[o] = x;
        pos[o + 1] = y;
        pos[o + 2] = z;
        pos[o + 3] = x + vx / m * L;
        pos[o + 4] = y + vy / m * L;
        pos[o + 5] = z + vz / m * L;
        const r = Math.hypot(x, y) / Math.max(this.extent ? this.extent[0] : 0.5, 1e-6);
        const c = r < 0.3 ? [1, 0.78, 0.35] : r < 0.65 ? [0.95, 0.45, 0.22] : [0.55, 0.55, 1];
        col[o] = c[0];
        col[o + 1] = c[1];
        col[o + 2] = c[2];
        col[o + 3] = c[0];
        col[o + 4] = c[1];
        col[o + 5] = c[2];
      }
      const gl = this.gl;
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
      const cbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, cbo);
      gl.bufferData(gl.ARRAY_BUFFER, col, gl.STATIC_DRAW);
      this.arrows = { vbo, cbo, count: n * 2, uMax: umax };
      this.arrowsRaw = f;
      this.arrowsN = n;
    }
    setTrails(meta, data) {
      const { steps, seeds } = meta;
      const gl = this.gl;
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const tbo = gl.createBuffer();
      const tt = new Float32Array(steps * seeds);
      for (let s = 0; s < steps; s++) for (let k = 0; k < seeds; k++) tt[s * seeds + k] = s / (steps - 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, tbo);
      gl.bufferData(gl.ARRAY_BUFFER, tt, gl.STATIC_DRAW);
      this.trails = { steps, seeds, vbo, tbo, head: 1 };
    }
    _mkProgram(vsSrc, fsSrc) {
      const gl = this.gl;
      const sh = (type, src) => {
        const o = gl.createShader(type);
        gl.shaderSource(o, src);
        gl.compileShader(o);
        if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(o) || "shader compile failed");
        }
        return o;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, vsSrc));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fsSrc));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(prog) || "link failed");
      }
      return prog;
    }
    // GPU 路径专用的点精灵着色器：位置从纹理 texelFetch，不再走 VBO
    _initPointsGpuProgram() {
      const gl = this.gl;
      const vs = `#version 300 es
    precision highp float;
    precision highp sampler2D;   // \u9876\u70B9\u7740\u8272\u5668\u91CC sampler \u9ED8\u8BA4 lowp\uFF0C\u53D6\u4E0D\u5230 float32 \u7EB9\u7406\u7684\u771F\u5B9E\u503C
    uniform highp sampler2D uPos; uniform highp sampler2D uPrev;
    uniform mat4 uVP; uniform float uPointSize; uniform float uLerp;
    uniform float uAlphaScale; uniform float uExt; uniform int uW; uniform int uStride;
    out float vAge; out vec3 vCol; out float vFade;
    void main() {
      int id = gl_VertexID * uStride;
      ivec2 t = ivec2(id % uW, id / uW);
      vec4 a = texelFetch(uPos, t, 0);
      vec4 b = texelFetch(uPrev, t, 0);
      vec3 pos = mix(a.xyz, b.xyz, uLerp);
      vec4 c = uVP * vec4(pos, 1.0);
      gl_Position = c;
      gl_PointSize = uPointSize * (1.0 - 0.25 * a.w) * (1.0 - 0.55 * uLerp) * (3.0 / max(c.w, 0.2));
      float rn = clamp(length(a.xy) / max(uExt, 1e-6), 0.0, 1.0);
      vec3 col;
      if (rn < 0.25) col = mix(vec3(1.0, 0.95, 0.80), vec3(1.0, 0.60, 0.15), rn / 0.25);
      else if (rn < 0.55) col = mix(vec3(1.0, 0.60, 0.15), vec3(0.20, 0.82, 0.72), (rn - 0.25) / 0.30);
      else col = mix(vec3(0.20, 0.82, 0.72), vec3(0.35, 0.32, 0.95), (rn - 0.55) / 0.45);
      vAge = a.w; vCol = col;
      vFade = (1.0 - 0.62 * uLerp) * uAlphaScale;
    }`;
      const fs = `#version 300 es
    precision highp float;
    in float vAge; in vec3 vCol; in float vFade; out vec4 o;
    void main() {
      float r = length(gl_PointCoord * 2.0 - 1.0);
      if (r > 1.0) discard;
      float core = exp(-r * r * 5.5);
      float halo = smoothstep(1.0, 0.1, r) * 0.22;
      float a = (core + halo) * (1.0 - 0.25 * vAge) * vFade * 0.055;
      o = vec4(vCol * (0.75 + 0.55 * core) + vec3(0.20 * core), a);
    }`;
      try {
        this.pointsGpu = this._mkProgram(vs, fs);
        this.pointsGpuOk = gl.getProgramParameter(this.pointsGpu, gl.LINK_STATUS);
        this.pointsGpuLog = gl.getProgramInfoLog(this.pointsGpu) || "";
      } catch (e) {
        console.warn("GPU \u70B9\u7CBE\u7075 program \u7F16\u8BD1\u5931\u8D25\uFF0C\u56DE\u9000 CPU \u7ED8\u5236", e);
        this.pointsGpu = null;
      }
    }
    // ==================== GPU 粒子推进（位置纹理 ping-pong） ====================
    // 为什么：JS 侧 _advect 每帧每粒子做三线性采样 + RK2，100 万粒子要几百万次采样，
    // V8 扛不住。这里把状态存进 RGBA32F 纹理（xyz + age），全屏 pass 里做积分，
    // 历史帧用 blitFramebuffer 拷进历史纹理（流线直接 texelFetch 它）。
    _initParticleGPU() {
      if (!this.gl || !this.particles) return false;
      const gl = this.gl, P = this.particles;
      if (this.gpu && this.gpu.count === P.count) return true;
      try {
        const W = 1024;
        const rows = Math.ceil(P.count / W);
        const K = P.K || 8;
        const mk = () => {
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, rows, 0, gl.RGBA, gl.FLOAT, null);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          const fbo = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
          return { tex, fbo };
        };
        const buf = new Float32Array(W * rows * 4);
        for (let i = 0; i < P.count; i++) {
          buf[i * 4] = P.pos[i * 3];
          buf[i * 4 + 1] = P.pos[i * 3 + 1];
          buf[i * 4 + 2] = P.pos[i * 3 + 2];
          buf[i * 4 + 3] = P.age[i];
        }
        const A = mk();
        gl.bindTexture(gl.TEXTURE_2D, A.tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, rows, gl.RGBA, gl.FLOAT, buf);
        const B = mk();
        gl.bindTexture(gl.TEXTURE_2D, B.tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, rows, gl.RGBA, gl.FLOAT, buf);
        const hist = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, hist);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, rows * K, 0, gl.RGBA, gl.FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const histFBO = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, histFBO);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hist, 0);
        for (let k = 0; k < K; k++) {
          gl.bindTexture(gl.TEXTURE_2D, hist);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, k * rows, W, rows, gl.RGBA, gl.FLOAT, buf, 0);
        }
        this.gpu = {
          W,
          rows,
          K,
          tex: [A.tex, B.tex],
          fbo: [A.fbo, B.fbo],
          hist,
          histFBO,
          cur: 0,
          slot: 0,
          count: P.count,
          frame: 0
        };
        this.particles.histTex = hist;
        this.particles.W = W;
        this.particles.rows = rows;
        this.particles.K = K;
        this._initAdvectProgram();
        this._initPointsGpuProgram();
        this._uploadVelTex();
        return true;
      } catch (err) {
        console.warn("GPU \u7C92\u5B50\u63A8\u8FDB\u4E0D\u53EF\u7528\uFF0C\u56DE\u9000 CPU\uFF1A", err);
        this.gpuError = String(err && err.message || err).slice(0, 300);
        this.gpu = null;
        return false;
      }
    }
    _initAdvectProgram() {
      const gl = this.gl;
      const vs = `#version 300 es
    precision highp float;
    in vec2 aPos;
    void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
      const fs = `#version 300 es
    precision highp float;
    precision highp sampler3D;   // GLSL ES 3.0 \u8981\u6C42\u663E\u5F0F\u7ED9 sampler3D \u7CBE\u5EA6
    uniform sampler2D uPos;
    uniform highp sampler3D uVel;
    uniform float uStep, uExt, uZExt;
    uniform int uW, uCount, uSubCap, uFrame;
    out vec4 o;

    uint hash(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
    float rnd(inout uint s) { s = hash(s); return float(s & 0xffffffu) / 16777216.0; }

    vec3 sampleVel(vec3 p) {
      vec3 g = vec3(p.x / uExt * 0.5 + 0.5, p.y / uExt * 0.5 + 0.5, p.z / uZExt * 0.5 + 0.5);
      if (g.x < 0.0 || g.y < 0.0 || g.z < 0.0 || g.x > 1.0 || g.y > 1.0 || g.z > 1.0) return vec3(0.0);
      ivec3 n = textureSize(uVel, 0);
      vec3 f = g * vec3(n - 1);
      ivec3 i0 = ivec3(floor(f));
      ivec3 i1 = min(i0 + 1, n - 1);
      vec3 t = f - vec3(i0);
      vec3 c00 = mix(texelFetch(uVel, ivec3(i0.x, i0.y, i0.z), 0).xyz,
                     texelFetch(uVel, ivec3(i1.x, i0.y, i0.z), 0).xyz, t.x);
      vec3 c10 = mix(texelFetch(uVel, ivec3(i0.x, i1.y, i0.z), 0).xyz,
                     texelFetch(uVel, ivec3(i1.x, i1.y, i0.z), 0).xyz, t.x);
      vec3 c01 = mix(texelFetch(uVel, ivec3(i0.x, i0.y, i1.z), 0).xyz,
                     texelFetch(uVel, ivec3(i1.x, i0.y, i1.z), 0).xyz, t.x);
      vec3 c11 = mix(texelFetch(uVel, ivec3(i0.x, i1.y, i1.z), 0).xyz,
                     texelFetch(uVel, ivec3(i1.x, i1.y, i1.z), 0).xyz, t.x);
      return mix(mix(c00, c10, t.y), mix(c01, c11, t.y), t.z);
    }

    void main() {
      ivec2 px = ivec2(gl_FragCoord.xy);
      int id = px.y * uW + px.x;
      if (id >= uCount) { o = vec4(0.0); return; }
      vec4 st = texelFetch(uPos, px, 0);
      vec3 x = st.xyz;
      float age = st.w;
      vec3 v0 = sampleVel(x);
      float vm = length(v0);
      int sub = int(clamp(ceil(vm * uStep / max(0.004, 0.02 * uExt)), 1.0, float(uSubCap)));
      float hs = uStep / float(sub);
      for (int k = 0; k < 8; k++) {
        if (k >= sub) break;
        vec3 a = sampleVel(x);
        vec3 b = sampleVel(x + 0.5 * hs * a);
        x += hs * b;
      }
      float rr = length(x.xy);
      if (!(rr == rr) || rr > uExt * 1.6 || abs(x.z) > uZExt * 1.15 || rr < uExt * 0.05 || age > 0.85) {
        uint sd = hash(uint(id) * 747796405u + uint(uFrame) * 2891336453u);
        float diskP = rnd(sd);
        float shellP = rnd(sd);
        float angP = rnd(sd);
        float zP = rnd(sd);
        bool disk = diskP < 0.78;
        float shell = floor(shellP * 40.0);
        float rad = disk ? uExt * (shell + 0.5) / 40.0 * 0.997 : 0.02 + 0.16 * uExt * sqrt(shellP);
        float th = angP * 6.28318530718;
        float zz = disk ? (zP * 2.0 - 1.0) * 0.035 * uZExt : (zP * 2.0 - 1.0) * 0.92 * uZExt;
        float taper = disk ? 1.0 : 1.0 - 0.86 * pow(abs(zz) / uZExt, 1.1);
        x = vec3(rad * taper * cos(th), rad * taper * sin(th), zz);
        age = 0.0;
      }
      age = min(1.0, age + 0.004);
      o = vec4(x, age);
    }`;
      const mk = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || "shader");
        return sh;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, mk(gl.VERTEX_SHADER, vs));
      gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link");
      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this.gpu.adv = { prog, quad };
    }
    _uploadVelTex() {
      const gl = this.gl, g = this.gpu;
      if (!gl || !g || !this.vel) return;
      const v = this.vel, n = v.n;
      if (!g.velTex) {
        g.velTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_3D, g.velTex);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
      }
      gl.bindTexture(gl.TEXTURE_3D, g.velTex);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB32F, n, n, n, 0, gl.RGB, gl.FLOAT, v.data);
    }
    _advectGPU(dt) {
      const gl = this.gl, g = this.gpu;
      if (!gl || !g || !g.adv) return false;
      const src = g.cur, dst = 1 - g.cur;
      const ext = this.vel.extent, zext = this.vel.zExtent;
      const tauScale = Math.max(0.1, Math.min(1, Math.pow(Math.max(this.tau, 1e-3), 0.55) * 3.2));
      const step = 0.012 * Math.max(dt, 0.4) * tauScale;
      const subCap = g.count > 4e5 ? 1 : g.count > 15e4 ? 2 : 6;
      const P0 = g.adv.prog;
      gl.useProgram(P0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo[dst]);
      gl.viewport(0, 0, g.W, g.rows);
      gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, g.tex[src]);
      gl.uniform1i(gl.getUniformLocation(P0, "uPos"), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, g.velTex);
      gl.uniform1i(gl.getUniformLocation(P0, "uVel"), 1);
      gl.uniform1f(gl.getUniformLocation(P0, "uStep"), step);
      gl.uniform1f(gl.getUniformLocation(P0, "uExt"), ext);
      gl.uniform1f(gl.getUniformLocation(P0, "uZExt"), zext);
      gl.uniform1i(gl.getUniformLocation(P0, "uW"), g.W);
      gl.uniform1i(gl.getUniformLocation(P0, "uCount"), g.count);
      gl.uniform1i(gl.getUniformLocation(P0, "uSubCap"), subCap);
      g.frame = (g.frame + 1) % 1e5;
      gl.uniform1i(gl.getUniformLocation(P0, "uFrame"), g.frame);
      const a = gl.getAttribLocation(P0, "aPos");
      gl.bindBuffer(gl.ARRAY_BUFFER, g.adv.quad);
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (this.settings.gpuBlit === false) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        g.slot = (g.slot + 1) % g.K;
        g.cur = dst;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        return true;
      }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, g.fbo[dst]);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, g.histFBO);
      gl.blitFramebuffer(
        0,
        0,
        g.W,
        g.rows,
        0,
        g.slot * g.rows,
        g.W,
        (g.slot + 1) * g.rows,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      g.slot = (g.slot + 1) % g.K;
      g.cur = dst;
      this.particles.slot = g.slot;
      gl.activeTexture(gl.TEXTURE0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      return true;
    }
    _advect(dt) {
      const v = this.vel, P = this.particles;
      if (!v || !P) return;
      const n = v.n, ext = v.extent, zext = v.zExtent, D = v.data;
      const tauScale = Math.max(0.1, Math.min(1, Math.pow(Math.max(this.tau, 1e-3), 0.55) * 3.2));
      const step = 0.012 * Math.max(dt, 0.4) * tauScale;
      const sample = (x, y, z, out) => {
        const fx = (x / ext * 0.5 + 0.5) * (n - 1);
        const fy = (y / ext * 0.5 + 0.5) * (n - 1);
        const fz = (z / zext * 0.5 + 0.5) * (n - 1);
        if (fx < 0 || fy < 0 || fz < 0 || fx > n - 1 || fy > n - 1 || fz > n - 1) {
          out[0] = out[1] = out[2] = 0;
          return false;
        }
        const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz);
        const i1 = Math.min(i0 + 1, n - 1), j1 = Math.min(j0 + 1, n - 1), k12 = Math.min(k0 + 1, n - 1);
        const tx = fx - i0, ty = fy - j0, tz = fz - k0;
        const idx = (i, j, k) => (i + j * n + k * n * n) * 3;
        for (let c = 0; c < 3; c++) {
          const c00 = D[idx(i0, j0, k0) + c] * (1 - tx) + D[idx(i1, j0, k0) + c] * tx;
          const c10 = D[idx(i0, j1, k0) + c] * (1 - tx) + D[idx(i1, j1, k0) + c] * tx;
          const c01 = D[idx(i0, j0, k12) + c] * (1 - tx) + D[idx(i1, j0, k12) + c] * tx;
          const c11 = D[idx(i0, j1, k12) + c] * (1 - tx) + D[idx(i1, j1, k12) + c] * tx;
          const c0 = c00 * (1 - ty) + c10 * ty, c1 = c01 * (1 - ty) + c11 * ty;
          out[c] = c0 * (1 - tz) + c1 * tz;
        }
        return true;
      };
      const k1 = [0, 0, 0], k2 = [0, 0, 0];
      const subCap = P.count > 4e5 ? 1 : P.count > 15e4 ? 2 : 6;
      const doColor = (this._colTick = ((this._colTick || 0) + 1) % 4) === 0;
      const pos = P.pos, age = P.age;
      const prev = P.prev;
      const frac = P.count > 4e5 ? 3 : P.count > 15e4 ? 2 : 1;
      this._advOff = ((this._advOff || 0) + 1) % frac;
      for (let i = this._advOff; i < P.count; i += frac) {
        const o = i * 3;
        let x = pos[o], y = pos[o + 1], z = pos[o + 2];
        prev[o] = x;
        prev[o + 1] = y;
        prev[o + 2] = z;
        sample(x, y, z, k1);
        const vmag = Math.sqrt(k1[0] * k1[0] + k1[1] * k1[1] + k1[2] * k1[2]);
        const maxMove = Math.max(4e-3, 0.02 * ext);
        const sub2 = vmag > 1e-9 ? Math.min(subCap, Math.max(1, Math.ceil(vmag * step / maxMove))) : 1;
        const hs = step / sub2;
        for (let k = 0; k < sub2; k++) {
          sample(x, y, z, k1);
          sample(x + 0.5 * hs * k1[0], y + 0.5 * hs * k1[1], z + 0.5 * hs * k1[2], k2);
          x += hs * k2[0];
          y += hs * k2[1];
          z += hs * k2[2];
        }
        const rr = Math.sqrt(x * x + y * y);
        if (!isFinite(x) || rr > ext * 1.6 || Math.abs(z) > zext * 1.15 || rr < ext * 0.05 || age[i] > 0.85) {
          const disk = Math.random() < 0.85;
          const SHELLS = 40;
          const shell = Math.floor(Math.random() * SHELLS);
          const rad = disk ? ext * (shell + 0.5) / SHELLS * (0.985 + 0.03 * Math.random()) : 0.02 + 0.3 * ext * Math.sqrt(Math.random());
          const th = Math.random() * Math.PI * 2;
          const zz = disk ? (Math.random() * 2 - 1) * 0.035 * zext : (Math.random() * 2 - 1) * zext;
          const taper = disk ? 1 : 1 - 0.78 * Math.pow(Math.abs(zz) / zext, 1.1);
          x = rad * taper * Math.cos(th);
          y = rad * taper * Math.sin(th);
          z = zz;
          prev[o] = x;
          prev[o + 1] = y;
          prev[o + 2] = z;
          age[i] = 0;
        }
        age[i] = Math.min(1, age[i] + 4e-3 * frac);
        pos[o] = x;
        pos[o + 1] = y;
        pos[o + 2] = z;
        if (!doColor) continue;
        const rn = Math.min(1, Math.sqrt(x * x + y * y) / (ext || 0.5));
        if (rn < 0.25) {
          const t = rn / 0.25;
          P.col[o] = 1;
          P.col[o + 1] = 0.95 + (0.6 - 0.95) * t;
          P.col[o + 2] = 0.8 + (0.15 - 0.8) * t;
        } else if (rn < 0.55) {
          const t = (rn - 0.25) / 0.3;
          P.col[o] = 1 + (0.2 - 1) * t;
          P.col[o + 1] = 0.6 + (0.82 - 0.6) * t;
          P.col[o + 2] = 0.15 + (0.72 - 0.15) * t;
        } else {
          const t = (rn - 0.55) / 0.45;
          P.col[o] = 0.2 + (0.35 - 0.2) * t;
          P.col[o + 1] = 0.82 + (0.32 - 0.82) * t;
          P.col[o + 2] = 0.72 + (0.95 - 0.72) * t;
        }
      }
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, P.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
      gl.bindBuffer(gl.ARRAY_BUFFER, P.abo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, age);
      if (doColor) {
        this._colDirty = true;
      }
      if (this.settings.trail !== 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, P.pvo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, prev);
      }
      const K = P.K, W = P.W, rows = P.rows, slot = P.slot;
      const base = slot * rows * W * 3;
      const hist = P.hist;
      for (let i = 0; i < P.count; i++) {
        const o = i * 3;
        const h = base + ((i / W | 0) * W + i % W) * 3;
        hist[h] = pos[o];
        hist[h + 1] = pos[o + 1];
        hist[h + 2] = pos[o + 2];
      }
      gl.bindTexture(gl.TEXTURE_2D, P.histTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, slot * rows, W, rows, gl.RGB, gl.FLOAT, hist, base);
      P.slot = (slot + 1) % K;
    }
    // ---------- 相机预设（俯视看同心环 / 侧视看轴向拉伸） ----------
    setPreset(name) {
      const p = this.presets && this.presets[name];
      if (!p) return null;
      this.cam.yaw = p.yaw;
      this.cam.pitch = p.pitch;
      this.cam.dist = p.dist;
      return name;
    }
    // ---------- 环层：几何圆环（比粒子撒点更细更匀，直接反映等半径壳） ----------
    buildRings(shells = 40, seg = 160) {
      const gl = this.gl;
      const rMax = this.extent && this.extent[0] || 0.5;
      const vert = [], col = [], alo = [];
      const pal = (x) => {
        if (x < 0.22) return [1, 0.96, 0.86];
        if (x < 0.45) {
          const k2 = (x - 0.22) / 0.23;
          return [1, 0.96 + (0.72 - 0.96) * k2, 0.86 + (0.18 - 0.86) * k2];
        }
        if (x < 0.68) {
          const k2 = (x - 0.45) / 0.23;
          return [1 + (0.42 - 1) * k2, 0.72 + (0.6 - 0.72) * k2, 0.18 + (0.35 - 0.18) * k2];
        }
        const k = (x - 0.68) / 0.32;
        return [0.52 + (0.62 - 0.52) * k, 0.58 + (0.5 - 0.58) * k, 0.62 + (1 - 0.62) * k];
      };
      for (let s = 0; s < shells; s++) {
        const r = rMax * (s + 3) / (shells + 3);
        const c = pal(r / rMax);
        for (let j = 0; j < seg; j++) {
          const a0 = j / seg * Math.PI * 2, a1 = (j + 1) / seg * Math.PI * 2;
          const a = 0.55 + 0.95 * (r / rMax);
          vert.push(r * Math.cos(a0), r * Math.sin(a0), 0, r * Math.cos(a1), r * Math.sin(a1), 0);
          col.push(c[0], c[1], c[2], c[0], c[1], c[2]);
          alo.push(a, a);
        }
      }
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vert), gl.STATIC_DRAW);
      const cbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, cbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(col), gl.STATIC_DRAW);
      const abo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, abo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(alo), gl.STATIC_DRAW);
      if (!this.ringProg) {
        const VS = `#version 300 es
in vec3 aPos; in vec3 aCol; in float aAlpha; uniform mat4 uVP; out vec3 vCol; out float vA;
void main(){ vCol = aCol; vA = aAlpha; gl_Position = uVP * vec4(aPos, 1.0); }`;
        const FS = `#version 300 es
precision highp float; in vec3 vCol; in float vA; out vec4 o; uniform float uAlpha;
void main(){ o = vec4(vCol, vA * uAlpha); }`;
        const mk = (ty, src) => {
          const sh = gl.createShader(ty);
          gl.shaderSource(sh, src);
          gl.compileShader(sh);
          return sh;
        };
        const p = gl.createProgram();
        gl.attachShader(p, mk(gl.VERTEX_SHADER, VS));
        gl.attachShader(p, mk(gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(p);
        this.ringProg = p;
      }
      this.rings = { vbo, cbo, abo, count: vert.length / 3 };
    }
    _loop() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - (this._last || now)) / 1e3);
      this._last = now;
      this._frames++;
      if (now - this._t0 > 500) {
        this.stats.fps = Math.round(this._frames * 1e3 / (now - this._t0));
        this._frames = 0;
        this._t0 = now;
        if (this.onStats) this.onStats(this.stats);
      }
      if (this.settings.showParticles) {
        if (!(this.settings.gpuAdvect === true && this.gpu)) this._advect(dt);
      }
      this._draw();
      if (this.settings.showParticles && this.settings.gpuAdvect === true && this.gpu) {
        this._advectGPU(dt);
        gl__restoreViewport: {
          const gl2 = this.gl;
          if (gl2) gl2.viewport(0, 0, this.canvas.width, this.canvas.height);
          break gl__restoreViewport;
        }
      }
      requestAnimationFrame(() => this._loop());
    }
    _draw() {
      const gl = this.gl;
      const w = this.canvas.width, h = this.canvas.height;
      this._ensureFBOs();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0.016, 0.02, 0.03, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const eye = [
        this.cam.target[0] + this.cam.dist * this.zoomScale * Math.cos(this.cam.pitch) * Math.cos(this.cam.yaw),
        this.cam.target[1] + this.cam.dist * this.zoomScale * Math.cos(this.cam.pitch) * Math.sin(this.cam.yaw),
        this.cam.target[2] + this.cam.dist * this.zoomScale * Math.sin(this.cam.pitch)
      ];
      const proj = mat4.perspective(0.8, w / h, 0.05, 100);
      const view = mat4.lookAt(eye, this.cam.target, [0, 0, 1]);
      const vp = mat4.mul(proj, view);
      this._vp = vp;
      const inv = mat4.invert(vp);
      gl.useProgram(this.quad);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
      const aPos = gl.getAttribLocation(this.quad, "aPos");
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(gl.getUniformLocation(this.quad, "uRes"), w, h);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.quad, "uInvVP"), false, inv);
      gl.uniform3fv(gl.getUniformLocation(this.quad, "uCam"), eye);
      gl.uniform2f(gl.getUniformLocation(this.quad, "uExtent"), this.extent[0], this.extent[1]);
      gl.uniform1f(gl.getUniformLocation(this.quad, "uStep"), 6e-3);
      gl.uniform1f(gl.getUniformLocation(this.quad, "uDensity"), this.settings.density);
      gl.uniform2f(gl.getUniformLocation(this.quad, "uRange"), this.vmin ?? -4, this.vmax ?? 0);
      gl.uniform1f(gl.getUniformLocation(this.quad, "uAxis"), this.omegaAxis ?? 1);
      gl.uniform1f(gl.getUniformLocation(this.quad, "uTime"), this.time);
      gl.uniform1f(gl.getUniformLocation(this.quad, "uTau"), this.tau);
      gl.uniform1f(gl.getUniformLocation(this.quad, "uStreak"), this.settings.streaks);
      gl.uniform1f(gl.getUniformLocation(this.quad, "uSpin"), this.settings.spin);
      gl.uniform1f(gl.getUniformLocation(this.quad, "uEnvelope"), this.settings.envelope);
      gl.uniform1f(gl.getUniformLocation(this.quad, "uZoomScale"), this.zoomScale || 1);
      gl.uniform2f(gl.getUniformLocation(this.quad, "uExtent"), this.extent?.[0] ?? 0.5, this.extent?.[1] ?? 1.2);
      gl.uniform3f(gl.getUniformLocation(this.quad, "uCore"), 1, 0.72, 0.25);
      gl.uniform3f(gl.getUniformLocation(this.quad, "uMid"), 0.16, 0.72, 0.66);
      gl.uniform3f(gl.getUniformLocation(this.quad, "uOuter"), 0.22, 0.26, 0.75);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.uniform1i(gl.getUniformLocation(this.quad, "uField"), 0);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (this.settings.showTrails && this.trails) {
        const T = this.trails;
        gl.useProgram(this.lines);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindBuffer(gl.ARRAY_BUFFER, T.vbo);
        const la = gl.getAttribLocation(this.lines, "aPos");
        gl.enableVertexAttribArray(la);
        gl.vertexAttribPointer(la, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, T.tbo);
        const lt = gl.getAttribLocation(this.lines, "aT");
        gl.enableVertexAttribArray(lt);
        gl.vertexAttribPointer(lt, 1, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.lines, "uVP"), false, vp);
        gl.uniform1f(gl.getUniformLocation(this.lines, "uHead"), T.head);
        gl.uniform1f(gl.getUniformLocation(this.lines, "uRMax"), this.extent ? this.extent[0] : 0.5);
        gl.uniform3f(gl.getUniformLocation(this.lines, "uColor"), 1, 0.55, 0.18);
        gl.drawArrays(gl.LINES, 0, T.steps * T.seeds);
      }
      if (this.settings.showRings !== false && this.rings) {
        gl.useProgram(this.ringProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.rings.vbo);
        const ra = gl.getAttribLocation(this.ringProg, "aPos");
        gl.enableVertexAttribArray(ra);
        gl.vertexAttribPointer(ra, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.rings.cbo);
        const rc = gl.getAttribLocation(this.ringProg, "aCol");
        gl.enableVertexAttribArray(rc);
        gl.vertexAttribPointer(rc, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.rings.abo);
        const ral = gl.getAttribLocation(this.ringProg, "aAlpha");
        gl.enableVertexAttribArray(ral);
        gl.vertexAttribPointer(ral, 1, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.ringProg, "uVP"), false, vp);
        gl.uniform1f(gl.getUniformLocation(this.ringProg, "uAlpha"), this.settings.ringAlpha);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.drawArrays(gl.LINES, 0, this.rings.count);
      }
      if (this.settings.showArrows !== false && this.arrows) {
        const A = this.arrows;
        gl.useProgram(this.arrowProg);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindBuffer(gl.ARRAY_BUFFER, A.vbo);
        const aa = gl.getAttribLocation(this.arrowProg, "aPos");
        gl.enableVertexAttribArray(aa);
        gl.vertexAttribPointer(aa, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, A.cbo);
        const ac = gl.getAttribLocation(this.arrowProg, "aCol");
        gl.enableVertexAttribArray(ac);
        gl.vertexAttribPointer(ac, 3, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.arrowProg, "uVP"), false, vp);
        gl.uniform1f(gl.getUniformLocation(this.arrowProg, "uAlpha"), this.settings.arrowAlpha);
        gl.lineWidth(1);
        gl.drawArrays(gl.LINES, 0, A.count);
      }
      if (this.settings.showParticles && this.particles) {
        const P = this.particles;
        gl.useProgram(this.points);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.bindBuffer(gl.ARRAY_BUFFER, P.vbo);
        const pa = gl.getAttribLocation(this.points, "aPos");
        gl.enableVertexAttribArray(pa);
        gl.vertexAttribPointer(pa, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, P.abo);
        const pg = gl.getAttribLocation(this.points, "aAge");
        gl.enableVertexAttribArray(pg);
        gl.vertexAttribPointer(pg, 1, gl.FLOAT, false, 0, 0);
        if (!this.gpu && this._colDirty) {
          gl.bindBuffer(gl.ARRAY_BUFFER, P.cbo);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, P.col);
          this._colDirty = false;
        }
        const pc = gl.getAttribLocation(this.points, "aCol");
        if (pc >= 0) {
          gl.enableVertexAttribArray(pc);
          gl.vertexAttribPointer(pc, 3, gl.FLOAT, false, 0, 0);
        }
        const G = this.gpu;
        gl.uniformMatrix4fv(gl.getUniformLocation(this.points, "uVP"), false, vp);
        gl.uniform1f(gl.getUniformLocation(this.points, "uPointSize"), this.settings.pointSize * (h / 900));
        gl.uniform3f(gl.getUniformLocation(this.points, "uColor"), 1, 0.62, 0.22);
        const uLerp = gl.getUniformLocation(this.points, "uLerp");
        const trail = this.settings.trail === void 0 ? 0.5 : this.settings.trail;
        const ghosts = trail > 0.02 ? P.count > 2e5 ? 2 : 3 : 1;
        const trailNorm = 1 / (1 + 0.9 * trail);
        [gl.getUniformLocation(this.points, "uAlphaScale")].fill(1);
        if (G && this.pointsGpu) {
          gl.useProgram(this.pointsGpu);
          const g2 = this.pointsGpu;
          const loc = (name) => gl.getUniformLocation(g2, name);
          gl.uniformMatrix4fv(loc("uVP"), false, vp);
          gl.uniform1f(loc("uPointSize"), this.settings.pointSize * (h / 900));
          gl.uniform1f(loc("uExt"), this.vel.extent);
          gl.uniform1i(loc("uW"), G.W);
          gl.activeTexture(gl.TEXTURE4);
          gl.bindTexture(gl.TEXTURE_2D, G.tex[G.cur]);
          gl.uniform1i(loc("uPos"), 4);
          gl.activeTexture(gl.TEXTURE5);
          gl.bindTexture(gl.TEXTURE_2D, G.tex[1 - G.cur]);
          gl.uniform1i(loc("uPrev"), 5);
          const strideP = 1;
          gl.uniform1i(loc("uStride"), strideP);
          const countFade = Math.min(1, Math.sqrt(12e4 / Math.max(G.count, 1)));
          for (let g = 0; g < ghosts; g++) {
            gl.uniform1f(loc("uLerp"), ghosts === 1 ? 0 : g / ghosts * trail);
            gl.uniform1f(loc("uAlphaScale"), (ghosts === 1 ? 1 : trailNorm) * countFade);
            gl.drawArrays(gl.POINTS, 0, Math.ceil(G.count / strideP));
            if (!this._ptChecked) {
              this._ptChecked = true;
              this._ptErr = gl.getError();
              this._ptDrawn = Math.ceil(G.count / strideP);
              this._ptLoc = {
                uPos: gl.getUniformLocation(this.pointsGpu, "uPos") ? 1 : 0,
                uVP: gl.getUniformLocation(this.pointsGpu, "uVP") ? 1 : 0,
                uSize: gl.getUniformLocation(this.pointsGpu, "uPointSize") ? 1 : 0,
                uStride: gl.getUniformLocation(this.pointsGpu, "uStride") ? 1 : 0
              };
            }
          }
          gl.activeTexture(gl.TEXTURE0);
        } else {
          gl.bindBuffer(gl.ARRAY_BUFFER, P.pvo);
          const pp = gl.getAttribLocation(this.points, "aPrev");
          if (pp >= 0) {
            gl.enableVertexAttribArray(pp);
            gl.vertexAttribPointer(pp, 3, gl.FLOAT, false, 0, 0);
          }
          const strideP = Math.max(1, Math.ceil(P.count / 12e4));
          for (let g = 0; g < ghosts; g++) {
            gl.uniform1f(uLerp, ghosts === 1 ? 0 : g / ghosts * trail);
            gl.uniform1f(gl.getUniformLocation(this.points, "uAlphaScale"), ghosts === 1 ? 1 : trailNorm);
            gl.drawArrays(gl.POINTS, 0, Math.ceil(P.count / strideP));
          }
        }
        if (trail > 0.02 && P.histTex) {
          gl.useProgram(this.ribbon);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, P.histTex);
          const R = this.ribbon;
          gl.uniformMatrix4fv(gl.getUniformLocation(R, "uVP"), false, vp);
          gl.uniform1i(gl.getUniformLocation(R, "uHist"), 0);
          gl.uniform1i(gl.getUniformLocation(R, "uK"), P.K);
          gl.uniform1i(gl.getUniformLocation(R, "uW"), P.W);
          gl.uniform1i(gl.getUniformLocation(R, "uRows"), P.rows);
          gl.uniform1i(gl.getUniformLocation(R, "uHead"), (P.slot + P.K - 1) % P.K);
          gl.uniform1f(gl.getUniformLocation(R, "uAlpha"), 0.85 * trail);
          const strideL = Math.max(1, Math.ceil(P.count / 15e4));
          gl.uniform1i(gl.getUniformLocation(R, "uStride"), strideL);
          gl.drawArraysInstanced(gl.LINE_STRIP, 0, P.K, Math.ceil(P.count / strideL));
        }
      }
      gl.disable(gl.BLEND);
      this._lastVP = vp;
      this._postProcess(w, h);
    }
    // ---------- 辉光（bloom）：亮部提取 → 分离高斯模糊 → 加法合成 ----------
    _initPost() {
      if (this.post) return;
      const gl = this.gl;
      const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
      const mk = (fs) => {
        const v = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(v, VS);
        gl.compileShader(v);
        const f = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(f, fs);
        gl.compileShader(f);
        if (!gl.getShaderParameter(f, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(f));
        const p = gl.createProgram();
        gl.attachShader(p, v);
        gl.attachShader(p, f);
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        return p;
      };
      const bright = mk(`#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform float uThresh; uniform float uKnee;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = clamp((l - uThresh) / max(uKnee, 1e-4), 0.0, 1.0);
  o = vec4(c * k * k, 1.0);
}`);
      const blur = mk(`#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform vec2 uDir;
void main() {
  float w0 = 0.227027, w1 = 0.1945946, w2 = 0.1216216, w3 = 0.054054, w4 = 0.016216;
  vec3 s = texture(uTex, vUv).rgb * w0;
  s += texture(uTex, vUv + uDir * 1.0).rgb * w1;
  s += texture(uTex, vUv - uDir * 1.0).rgb * w1;
  s += texture(uTex, vUv + uDir * 2.0).rgb * w2;
  s += texture(uTex, vUv - uDir * 2.0).rgb * w2;
  s += texture(uTex, vUv + uDir * 3.0).rgb * w3;
  s += texture(uTex, vUv - uDir * 3.0).rgb * w3;
  s += texture(uTex, vUv + uDir * 4.0).rgb * w4;
  s += texture(uTex, vUv - uDir * 4.0).rgb * w4;
  o = vec4(s, 1.0);
}`);
      const comp = mk(`#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uScene; uniform sampler2D uBloom;
uniform float uStrength; uniform float uExposure;
uniform float uCoreGain;   // \u53EA\u653E\u5927"\u6DA1\u4F53\u81EA\u8EAB\u53D1\u5149"\uFF0C\u4E0D\u52A8\u8F89\u5149\u3001\u4E0D\u52A8\u80CC\u666F
uniform float uWhite;      // \u9AD8\u5149\u767D\u70B9\uFF1A\u8D8A\u5927\u8D8A\u665A\u538B\u7F29\uFF08>1 \u65F6\u4E2D\u4F4E\u4EAE\u5EA6\u5B8C\u5168\u4E0D\u53D7\u5F71\u54CD\uFF09
void main() {
  vec3 s = texture(uScene, vUv).rgb * uCoreGain;
  vec3 b = texture(uBloom, vUv).rgb;
  vec3 c = (s + b * uStrength) * uExposure;
  // Reinhard + \u767D\u70B9\uFF1A\u53EA\u6709\u63A5\u8FD1 uWhite \u7684\u9AD8\u5149\u624D\u88AB\u538B\uFF0C\u4E2D\u4F4E\u4EAE\u5EA6\u7EBF\u6027\u4E0D\u52A8
  // \uFF08\u539F\u6765\u662F c/(1+max(c-0.85,0))\uFF0C\u4E00\u65E6\u8C03\u4F4E\u66DD\u5149\u6574\u4F53\u5C31\u53D1\u7070\u53D1\u6697\uFF09
  float w2 = max(uWhite * uWhite, 1e-4);
  c = c * (1.0 + c / w2) / (1.0 + c);
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this.post = { bright, blur, comp, buf };
    }
    _ensureFBOs() {
      const gl = this.gl, w = this.canvas.width, h = this.canvas.height;
      this._initPost();
      if (this.sceneFBO && this._fbW === w && this._fbH === h) return;
      const mkRT = (tw, th) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        return { tex: t, fbo: f };
      };
      if (this.sceneFBO) {
        gl.deleteFramebuffer(this.sceneFBO);
        gl.deleteTexture(this.sceneTex);
        gl.deleteFramebuffer(this.bloomFBO[0]);
        gl.deleteFramebuffer(this.bloomFBO[1]);
        gl.deleteTexture(this.bloomTex[0]);
        gl.deleteTexture(this.bloomTex[1]);
      }
      const scene = mkRT(w, h);
      this.sceneTex = scene.tex;
      this.sceneFBO = scene.fbo;
      this._bW = Math.max(1, Math.floor(w / 2));
      this._bH = Math.max(1, Math.floor(h / 2));
      const a = mkRT(this._bW, this._bH), b = mkRT(this._bW, this._bH);
      this.bloomTex = [a.tex, b.tex];
      this.bloomFBO = [a.fbo, b.fbo];
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this._fbW = w;
      this._fbH = h;
    }
    _postProcess(w, h) {
      const gl = this.gl, P = this.post;
      const bw = this._bW, bh = this._bH;
      gl.disable(gl.BLEND);
      const bindQuad = (prog) => {
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, P.buf);
        const a = gl.getAttribLocation(prog, "aPos");
        gl.enableVertexAttribArray(a);
        gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      };
      bindQuad(P.bright);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFBO[0]);
      gl.viewport(0, 0, bw, bh);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
      gl.uniform1i(gl.getUniformLocation(P.bright, "uTex"), 0);
      gl.uniform1f(gl.getUniformLocation(P.bright, "uThresh"), this.settings.bloomThresh);
      gl.uniform1f(gl.getUniformLocation(P.bright, "uKnee"), 0.35);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      bindQuad(P.blur);
      gl.uniform1i(gl.getUniformLocation(P.blur, "uTex"), 0);
      for (let i = 0; i < 2; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFBO[(i + 1) % 2]);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.bloomTex[i]);
        const dx = i === 0 ? 1.6 / bw : 0, dy = i === 0 ? 0 : 1.6 / bh;
        gl.uniform2f(gl.getUniformLocation(P.blur, "uDir"), dx, dy);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      bindQuad(P.comp);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.bloomTex[0]);
      gl.uniform1i(gl.getUniformLocation(P.comp, "uScene"), 0);
      gl.uniform1i(gl.getUniformLocation(P.comp, "uBloom"), 1);
      gl.uniform1f(gl.getUniformLocation(P.comp, "uStrength"), this.settings.bloom);
      gl.uniform1f(
        gl.getUniformLocation(P.comp, "uExposure"),
        this.settings.exposure === void 0 ? 1 : this.settings.exposure
      );
      gl.uniform1f(
        gl.getUniformLocation(P.comp, "uCoreGain"),
        this.settings.coreGain === void 0 ? 1 : this.settings.coreGain
      );
      gl.uniform1f(
        gl.getUniformLocation(P.comp, "uWhite"),
        this.settings.white === void 0 ? 2.2 : this.settings.white
      );
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }
  }
  function mulberry32(a) {
    return function() {
      a |= 0;
      a = a + 1831565813 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  return { NSView };
})();
window.NS = NS;
