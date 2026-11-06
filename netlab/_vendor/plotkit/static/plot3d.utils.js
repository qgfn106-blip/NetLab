/* PlotKit 3D 纯数学工具（P17.1：从 view3d 抽出的纯函数）。
 *
 * 约定：本文件只含无 DOM / 无 WebGL / 无全局依赖的纯函数，可被 Node 直接单测。
 * 当前阶段（P17.1）为「新增可测试模块」；P17.2 再让 view3d.ts import 本模块并删除其内部重复实现。
 */
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
export const norm = (a) => {
    const n = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / n, a[1] / n, a[2] / n];
};
export function mat4Mul(a, b) {
    const out = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            let s = 0;
            for (let k = 0; k < 4; k++)
                s += a[k * 4 + j] * b[i * 4 + k];
            out[i * 4 + j] = s;
        }
    }
    return out;
}
export function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) * nf, -1,
        0, 0, 2 * far * near * nf, 0,
    ]);
}
export function lookAt(eye, center, up) {
    const z = norm(sub(eye, center));
    const x = norm(cross(up, z));
    const y = cross(z, x);
    return new Float32Array([
        x[0], y[0], z[0], 0,
        x[1], y[1], z[1], 0,
        x[2], y[2], z[2], 0,
        -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
    ]);
}
// 4x4 逆矩阵（列主序，与 mat4Mul 一致）——体渲染要从 NDC 反推世界坐标射线
export function invert(m) {
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det)
        return null;
    det = 1.0 / det;
    return new Float32Array([
        (a11 * b11 - a12 * b10 + a13 * b09) * det,
        (a02 * b10 - a01 * b11 - a03 * b09) * det,
        (a31 * b05 - a32 * b04 + a33 * b03) * det,
        (a22 * b04 - a21 * b05 - a23 * b03) * det,
        (a12 * b08 - a10 * b11 - a13 * b07) * det,
        (a00 * b11 - a02 * b08 + a03 * b07) * det,
        (a32 * b02 - a30 * b05 - a33 * b01) * det,
        (a20 * b05 - a22 * b02 + a23 * b01) * det,
        (a10 * b10 - a11 * b08 + a13 * b06) * det,
        (a01 * b08 - a00 * b10 - a03 * b06) * det,
        (a30 * b04 - a31 * b02 + a33 * b00) * det,
        (a21 * b02 - a20 * b04 - a23 * b00) * det,
        (a11 * b07 - a10 * b09 - a12 * b06) * det,
        (a00 * b09 - a01 * b07 + a02 * b06) * det,
        (a31 * b01 - a30 * b03 - a32 * b00) * det,
        (a20 * b03 - a21 * b01 + a22 * b00) * det,
    ]);
}
export function applyMat4(m, v) {
    const out = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
        out[i] = m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2] + m[12 + i] * v[3];
    }
    return out;
}
/** 1/2/5×10^k 的"好看"刻度。 */
export function niceTicks(lo, hi, target) {
    const span = hi - lo;
    if (!(span > 0))
        return [lo];
    const raw = span / Math.max(1, target);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-6; v += step) {
        out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
    }
    return out;
}
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function fmtTick(v) {
    const a = Math.abs(v);
    if (a === 0)
        return "0";
    if (a >= 1e5 || a < 1e-3)
        return v.toExponential(1).replace("e+", "e");
    return String(+v.toPrecision(3));
}
export function hexToRgba(hex, alpha = 1) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m)
        return new Float32Array([0.3, 0.6, 1, alpha]);
    const v = parseInt(m[1], 16);
    return new Float32Array([((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, alpha]);
}
