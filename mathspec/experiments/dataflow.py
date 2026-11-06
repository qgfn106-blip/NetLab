"""数据侧数学验证：采样、量化、差分编码、分块传输、频谱、POD 压缩。

对应规范 §7（环形缓冲/压缩/传输）与 §14（可行性验证）：
- 定理 14.1：均匀量化 |x-Q(x)| ≤ Δ/2，均匀分布下 MSE = Δ²/12；
- 定理 14.2：一阶差分编码是可逆整数变换（无损）；
- 定理 14.4：POD + 系数均匀量化的重构误差 ≤ 投影残差 + √r·Δ/2；
- 定理 14.5：DFT 频率分辨率 fs/N（矩形窗），Hann 窗主瓣更宽但泄漏更小。
"""
from __future__ import annotations

import zlib
from dataclasses import dataclass
from typing import Dict, Tuple

import numpy as np


# ---------------------------------------------------------------------------
# 采样
# ---------------------------------------------------------------------------
def sample_uniform(ts: np.ndarray, xs: np.ndarray, fs: float,
                   t0: float | None = None,
                   t1: float | None = None) -> Tuple[np.ndarray, np.ndarray]:
    """把非均匀/高密度时间序列按 fs 均匀重采样（线性插值）。"""
    ts = np.asarray(ts, float)
    xs = np.asarray(xs, float)
    one_d = xs.ndim == 1
    arr = xs.reshape(-1, 1) if one_d else xs
    lo = float(ts[0] if t0 is None else t0)
    hi = float(ts[-1] if t1 is None else t1)
    n = int(np.floor((hi - lo) * fs))
    t_new = lo + np.arange(n + 1) / fs
    out = np.empty((t_new.size, arr.shape[1]), dtype=float)
    for j in range(arr.shape[1]):
        out[:, j] = np.interp(t_new, ts, arr[:, j])
    return t_new, (out[:, 0] if one_d else out)


# ---------------------------------------------------------------------------
# 均匀量化（定理 14.1）
# ---------------------------------------------------------------------------
@dataclass
class UniformQuantizer:
    xmin: float
    xmax: float
    bits: int

    def __post_init__(self):
        if self.bits < 1:
            raise ValueError("bits 必须 >= 1")
        if not self.xmax > self.xmin:
            raise ValueError("xmax 必须大于 xmin")
        self.levels = 2 ** int(self.bits)
        self.step = (self.xmax - self.xmin) / (self.levels - 1)

    def encode(self, x: np.ndarray) -> np.ndarray:
        x = np.asarray(x, float)
        q = np.round((x - self.xmin) / self.step)
        return np.clip(q, 0, self.levels - 1).astype(np.int64)

    def decode(self, codes: np.ndarray) -> np.ndarray:
        return self.xmin + np.asarray(codes, float) * self.step

    def max_abs_error(self) -> float:
        return 0.5 * self.step

    def mse_uniform(self) -> float:
        """输入在 [xmin,xmax] 上均匀分布时的理论 MSE。"""
        return self.step ** 2 / 12.0


def quantize(x: np.ndarray, q: UniformQuantizer) -> Tuple[np.ndarray, np.ndarray]:
    codes = q.encode(x)
    return codes, q.decode(codes)


# ---------------------------------------------------------------------------
# 一阶差分编码（定理 14.2）
# ---------------------------------------------------------------------------
def delta_encode(codes: np.ndarray) -> np.ndarray:
    c = np.asarray(codes, dtype=np.int64)
    if c.size == 0:
        return c.copy()
    return np.concatenate(([c[0]], np.diff(c)))


def delta_decode(deltas: np.ndarray) -> np.ndarray:
    d = np.asarray(deltas, dtype=np.int64)
    if d.size == 0:
        return d.copy()
    return np.cumsum(d)


def pack_codes(codes: np.ndarray, bits: int) -> bytes:
    """把非负整数码打包成最小无符号整型字节串（小端）。"""
    c = np.asarray(codes, dtype=np.int64)
    if bits <= 8:
        return c.astype("<u1").tobytes()
    if bits <= 16:
        return c.astype("<u2").tobytes()
    if bits <= 32:
        return c.astype("<u4").tobytes()
    return c.astype("<u8").tobytes()


def unpack_codes(payload: bytes, bits: int) -> np.ndarray:
    if bits <= 8:
        dt = "<u1"
    elif bits <= 16:
        dt = "<u2"
    elif bits <= 32:
        dt = "<u4"
    else:
        dt = "<u8"
    return np.frombuffer(payload, dtype=dt).astype(np.int64)


def pack_delta_codes(deltas: np.ndarray) -> bytes:
    """差分码可能为负：统一用有符号 int32 打包（无损）。"""
    values = np.asarray(deltas, dtype=np.int64)
    if np.any(values < np.iinfo(np.int32).min) or np.any(values > np.iinfo(np.int32).max):
        raise ValueError("差分码超出 int32 可表示范围，无法无损打包")
    return values.astype("<i4").tobytes()


def unpack_delta_codes(payload: bytes) -> np.ndarray:
    return np.frombuffer(payload, dtype="<i4").astype(np.int64)


# ---------------------------------------------------------------------------
# 分块传输 + 校验 + 重传（无损链路模型）
# ---------------------------------------------------------------------------
def crc32_chunk(chunk: bytes) -> int:
    return zlib.crc32(chunk) & 0xFFFFFFFF


def transmit_with_retry(payload: bytes, chunk_size: int = 256,
                        corruption_rate: float = 0.0, seed: int = 0,
                        max_attempts: int = 1000,
                        max_retransmit: int = 1000) -> Dict[str, object]:
    """把 payload 分块发送；每块带 CRC32，坏块重传，直到全对为止。

    返回 {data, chunks, retransmits, attempts}。corruption_rate 为每块
    独立损坏概率（位翻转让 CRC 失配）。
    """
    rng = np.random.default_rng(seed)
    chunks = [payload[k:k + chunk_size] for k in range(0, len(payload), chunk_size)]
    received = []
    retransmits = 0
    attempts = 0
    for chunk in chunks:
        good = False
        while not good:
            attempts += 1
            if attempts > max_attempts:
                raise RuntimeError("传输失败：超过最大尝试次数")
            corrupt = rng.random() < corruption_rate
            wire = bytearray(chunk)
            if corrupt and wire:
                pos = int(rng.integers(0, len(wire)))
                wire[pos] ^= 0x01
            wire = bytes(wire)
            ok = crc32_chunk(wire) == crc32_chunk(chunk)
            if ok:
                received.append(wire)
                good = True
            else:
                retransmits += 1
                if retransmits > max_retransmit:
                    raise RuntimeError("传输失败：重传次数超限")
    return {"data": b"".join(received), "chunks": len(chunks),
            "retransmits": retransmits, "attempts": attempts}


# ---------------------------------------------------------------------------
# 频谱分析（定理 14.5）
# ---------------------------------------------------------------------------
def spectral_peak(ts: np.ndarray, y: np.ndarray, fs: float,
                  window: str = "hann") -> Tuple[float, float, np.ndarray, np.ndarray]:
    """去均值 + 窗 + rfft，返回 (峰值频率 Hz, 幅值, freqs, 幅值谱)。"""
    y = np.asarray(y, float)
    y = y - np.mean(y)
    n = y.size
    if window == "hann":
        w = np.hanning(n)
        coherent_gain = np.sum(w) / n
    elif window == "rect":
        w = np.ones(n)
        coherent_gain = 1.0
    else:
        raise ValueError(f"未知窗：{window!r}")
    spec = np.fft.rfft(y * w)
    freqs = np.fft.rfftfreq(n, d=1.0 / fs)
    amp = np.abs(spec) * 2.0 / (n * coherent_gain)
    k = int(np.argmax(amp[1:]) + 1)
    return float(freqs[k]), float(amp[k]), freqs, amp


# ---------------------------------------------------------------------------
# POD + 系数量化（定理 14.3 / 14.4）
# ---------------------------------------------------------------------------
def pod_basis(snapshots: np.ndarray, r: int) -> Tuple[np.ndarray, np.ndarray]:
    """快照矩阵 X(n,N) -> (U_r, S)。"""
    X = np.asarray(snapshots, float)
    U, S, _ = np.linalg.svd(X, full_matrices=False)
    return U[:, :r], S


def pod_projection_error(snapshots: np.ndarray, U_r: np.ndarray) -> float:
    """全快照集上的相对 Frobenius 投影残差。U_r 须为正交基（U_r.T U_r = I）。"""
    X = np.asarray(snapshots, float)
    R = X - U_r @ (U_r.T @ X)
    return float(np.linalg.norm(R, "fro") / max(np.linalg.norm(X, "fro"), 1e-15))


def pod_quantized_roundtrip(x: np.ndarray, U_r: np.ndarray,
                            q: UniformQuantizer) -> Dict[str, float]:
    """POD 投影 + 系数均匀量化 + 重构；返回误差分解。

    误差分解 ``投影残差 + sqrt(r) Δ/2`` 要求 U_r 列正交且量化不饱和；
    本函数只做计算，不替调用方检查这两项条件。
    """
    x = np.asarray(x, float)
    coeff = U_r.T @ x
    codes, coeff_hat = quantize(coeff, q)
    recon = U_r @ coeff_hat
    proj = U_r @ coeff
    proj_res = float(np.linalg.norm(x - proj))
    quant_err = float(np.linalg.norm(coeff - coeff_hat))
    total = float(np.linalg.norm(x - recon))
    r = U_r.shape[1]
    bound = proj_res + np.sqrt(r) * q.max_abs_error()
    return {"total": total, "projection_residual": proj_res,
            "quant_error": quant_err, "bound": float(bound),
            "coeff_codes": float(codes.size)}


def compression_ratio(raw: bytes, compressed: bytes) -> float:
    return len(raw) / max(len(compressed), 1)


def pod_series_roundtrip(X: np.ndarray, U_r: np.ndarray, q: UniformQuantizer,
                         chunk_size: int = 256, corruption_rate: float = 0.0,
                         seed: int = 0) -> Dict[str, object]:
    """端到端：POD 投影 → 系数量化 → 一阶差分 → zlib → 分块传输 → 重构。

    返回归一化误差、理论界与传输统计。误差界（Frobenius）：
        ||X - U_r Q(U_r^T X)||_F / ||X||_F
        ≤ ( ||X - U_r U_r^T X||_F + sqrt(r·N)·Δ/2 ) / ||X||_F
    """
    X = np.asarray(X, float)
    r, n = U_r.shape[1], X.shape[1]
    coeff = U_r.T @ X
    codes = q.encode(coeff)
    deltas = np.concatenate([codes[:, :1], np.diff(codes, axis=1)], axis=1)
    payload = pack_delta_codes(deltas.ravel())
    compressed = zlib.compress(payload)
    sent = transmit_with_retry(compressed, chunk_size=chunk_size,
                               corruption_rate=corruption_rate, seed=seed)
    received = unpack_delta_codes(zlib.decompress(sent["data"]))
    codes_hat = np.cumsum(received.reshape(deltas.shape), axis=1)
    X_hat = U_r @ q.decode(codes_hat)

    norm_x = max(float(np.linalg.norm(X, "fro")), 1e-15)
    proj_res = float(np.linalg.norm(X - U_r @ coeff, "fro"))
    total = float(np.linalg.norm(X - X_hat, "fro"))
    bound = proj_res + np.sqrt(r * n) * q.max_abs_error()
    return {
        "X_hat": X_hat,
        "total": total,
        "total_norm": total / norm_x,
        "projection_residual": proj_res,
        "bound": bound,
        "bound_norm": bound / norm_x,
        "raw_bytes": len(payload),
        "compressed_bytes": len(compressed),
        "compression_ratio": compression_ratio(payload, compressed),
        "retransmits": sent["retransmits"],
        "chunks": sent["chunks"],
    }
