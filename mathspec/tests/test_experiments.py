"""§14 可行性验证与创造性拓展的验收测试。

覆盖：多域稳态/能量守恒/振荡频谱、均匀量化、差分编码、分块传输、
POD 最优截断与 POD-量化联合误差界、平衡截断 H∞ 误差界。
"""
from __future__ import annotations

import zlib

import numpy as np
import pytest

from mathspec.experiments.dataflow import (
    UniformQuantizer,
    compression_ratio,
    delta_decode,
    delta_encode,
    pack_codes,
    pack_delta_codes,
    pod_basis,
    pod_projection_error,
    pod_quantized_roundtrip,
    pod_series_roundtrip,
    sample_uniform,
    spectral_peak,
    transmit_with_retry,
    unpack_codes,
)
from mathspec.experiments.accel import anderson_solve, picard
from mathspec.experiments.drivetrain import (
    DriveTrainParams,
    energy_balance_error,
    observation_matrix,
    simulate,
    state_matrix,
    steady_state,
    torsional_frequency,
)
from mathspec.mor import balanced_truncation


# ---------------------------------------------------------------------------
# 物理模型：稳态 / 能量 / 频谱
# ---------------------------------------------------------------------------
def test_steady_state_identity():
    p = DriveTrainParams()
    A, B, E = state_matrix(p)
    x = steady_state(p, 12.0, 0.5)
    residual = A @ x + (B * 12.0 + E * 0.5).ravel()
    assert np.max(np.abs(residual)) < 1e-10


def test_energy_balance_conservation():
    p = DriveTrainParams()
    xss = steady_state(p, 12.0, 0.5)
    ts, xs = simulate(p, 12.0, 0.5, t_end=2.0, dt=1e-4,
                      x0=xss + np.array([0.0, 0.5, 0.0, 0.0]))
    assert energy_balance_error(ts, xs, p, 12.0, 0.5) < 1e-5


def test_torsional_frequency_matches_spectrum():
    p = DriveTrainParams()
    f0 = torsional_frequency(p)
    xss = steady_state(p, 12.0, 0.5)
    ts, xs = simulate(p, 12.0, 0.5, t_end=4.0, dt=1e-4,
                      x0=xss + np.array([0.0, 0.5, 0.0, 0.0]))
    t2, y2 = sample_uniform(ts, xs[:, 2], 200.0)
    f_peak, amp, _, _ = spectral_peak(t2, y2, 200.0)
    # 频率分辨率 fs/N ≈ 0.25 Hz，取 ±1 个 bin
    assert abs(f_peak - f0) <= 0.25
    assert amp > 0.0


# ---------------------------------------------------------------------------
# 量化与编码（定理 14.1 / 14.2）
# ---------------------------------------------------------------------------
def test_uniform_quantizer_bounds():
    q = UniformQuantizer(-1.0, 1.0, bits=8)
    rng = np.random.default_rng(42)
    x = rng.uniform(-1.0, 1.0, 200_000)
    codes, recon = q.encode(x), q.decode(q.encode(x))
    assert np.max(np.abs(x - recon)) <= q.max_abs_error() + 1e-12
    mse = float(np.mean((x - recon) ** 2))
    assert abs(mse / q.mse_uniform() - 1.0) < 0.05


def test_delta_codec_rejects_int32_overflow_but_accepts_boundaries():
    limits = np.array([np.iinfo(np.int32).min, np.iinfo(np.int32).max], dtype=np.int64)
    payload = pack_delta_codes(limits)
    assert np.array_equal(
        np.frombuffer(payload, dtype="<i4").astype(np.int64), limits)
    with pytest.raises(ValueError, match="int32"):
        pack_delta_codes(np.array([np.iinfo(np.int32).max + 1], dtype=np.int64))
    with pytest.raises(ValueError, match="int32"):
        pack_delta_codes(np.array([np.iinfo(np.int32).min - 1], dtype=np.int64))


def test_delta_codec_lossless():
    rng = np.random.default_rng(7)
    codes = np.cumsum(rng.integers(-3, 4, size=5000)).astype(np.int64) + 10_000
    assert np.array_equal(delta_decode(delta_encode(codes)), codes)

    # 平滑信号的差分 + zlib 应优于直接压缩
    t = np.linspace(0, 10, 5000)
    q = UniformQuantizer(-1.0, 1.0, bits=12)
    smooth = q.encode(np.sin(t))
    raw = pack_codes(smooth, q.bits)
    delta = pack_delta_codes(delta_encode(smooth))
    assert compression_ratio(raw, zlib.compress(delta)) > 1.5


def test_transport_with_crc_retry_is_lossless():
    rng = np.random.default_rng(11)
    payload = bytes(rng.integers(0, 256, size=4096, dtype=np.uint8))
    result = transmit_with_retry(payload, chunk_size=256,
                                 corruption_rate=0.2, seed=3)
    assert result["data"] == payload
    assert result["chunks"] == 16
    assert result["retransmits"] > 0


# ---------------------------------------------------------------------------
# POD（定理 14.3 / 14.4）
# ---------------------------------------------------------------------------
def test_pod_truncation_is_optimal():
    rng = np.random.default_rng(5)
    n, m, r = 40, 30, 3
    X = rng.normal(size=(n, r)) @ rng.normal(size=(r, m))
    U, S, _ = np.linalg.svd(X, full_matrices=False)
    X2 = U[:, :2] @ U[:, :2].T @ X
    err_spec = np.linalg.norm(X - X2, 2)
    assert abs(err_spec - S[2]) < 1e-10
    # Eckart–Young：任意 rank-2 矩阵的谱误差不小于 σ3
    Y = rng.normal(size=(n, 2)) @ rng.normal(size=(2, m))
    assert np.linalg.norm(X - Y, 2) >= S[2] - 1e-10


def test_pod_quantized_error_decomposition_bound():
    p = DriveTrainParams()
    snaps = []
    for V in (6.0, 12.0, 18.0):
        for tau in (0.0, 0.5, 1.0):
            x0 = steady_state(p, V, tau) + np.array([0.0, 0.3, 0.0, 0.01])
            _, X = simulate(p, V, tau, t_end=2.0, dt=5e-4, x0=x0)
            snaps.append(X.T[:, ::20])
    X_train = np.hstack(snaps)
    U_r, S = pod_basis(X_train, r=3)
    assert np.sum(S[:3] ** 2) / np.sum(S ** 2) > 0.9999
    assert pod_projection_error(X_train, U_r) < 1e-3

    coeffs = U_r.T @ X_train
    margin = 0.05 * (np.max(coeffs) - np.min(coeffs))
    q = UniformQuantizer(float(np.min(coeffs) - margin),
                         float(np.max(coeffs) + margin), bits=10)
    x_test = X_train[:, -1]
    out = pod_quantized_roundtrip(x_test, U_r, q)
    assert out["total"] <= out["bound"] + 1e-9
    # 三角不等式下界：总误差至少接近投影残差
    assert out["total"] + 1e-12 >= out["projection_residual"]


# ---------------------------------------------------------------------------
# 平衡截断（定理 14.6，Glover H∞ 界）
# ---------------------------------------------------------------------------
def _hinf_norm_error(A, B, C, Ar, Br, Cr, n_grid=400):
    def H(A_, B_, C_, w):
        return C_ @ np.linalg.solve(1j * w * np.eye(A_.shape[0]) - A_, B_)

    worst = 0.0
    for w in np.logspace(-2, 3, n_grid):
        G = H(A, B, C, w)
        Gr = H(Ar, Br, Cr, w)
        s = np.linalg.svd(G - Gr, compute_uv=False)[0]
        worst = max(worst, float(s))
    return worst


def test_balanced_truncation_hinf_bound():
    p = DriveTrainParams()
    A, B, _ = state_matrix(p)
    C = observation_matrix()
    Ar, Br, Cr, hsv, bound = balanced_truncation(A, B, C, r=2)
    assert np.all(np.real(np.linalg.eigvals(Ar)) < 0.0)
    err = _hinf_norm_error(A, B, C, Ar, Br, Cr)
    assert err <= bound + 1e-6
    assert bound > 0.0


# ---------------------------------------------------------------------------
# 创造力组合：Anderson 加速（定理 14.8 的数值验证）
# ---------------------------------------------------------------------------
def test_anderson_accelerates_affine_fixed_point():
    A = np.diag([0.9, 0.8])
    b = np.array([1.0, -1.0])
    G = lambda x: A @ x + b
    x_p, it_p = picard(G, np.zeros(2))
    x_a, it_a = anderson_solve(G, np.zeros(2), m=5)
    assert np.max(np.abs(G(x_a) - x_a)) <= 1e-10
    assert it_a < it_p // 2


# ---------------------------------------------------------------------------
# 端到端：POD + 量化 + 差分 + 压缩 + 传输 + 重构 + 频谱
# ---------------------------------------------------------------------------
def test_end_to_end_pod_transport_pipeline():
    p = DriveTrainParams()
    train = []
    for V in (6.0, 12.0, 18.0):
        for tau in (0.0, 0.5, 1.0):
            _, X = simulate(p, V, tau, t_end=2.0, dt=5e-4,
                            x0=steady_state(p, V, tau) + np.array([0.0, 0.3, 0.0, 0.01]))
            train.append(X.T[:, ::20])
    X_train = np.hstack(train)
    U_r, S = pod_basis(X_train, r=3)
    coeff = U_r.T @ X_train
    margin = 0.05 * (float(coeff.max()) - float(coeff.min()))
    q = UniformQuantizer(float(coeff.min()) - margin, float(coeff.max()) + margin, bits=10)

    # 留出轨迹：与训练同参数族但不同初值
    _, X_test = simulate(p, 12.0, 0.2, t_end=2.0, dt=5e-4,
                         x0=steady_state(p, 12.0, 0.2) + np.array([0.0, 0.8, 0.0, 0.02]))
    X_test = X_test.T[:, ::20]
    out = pod_series_roundtrip(X_test, U_r, q, chunk_size=128, corruption_rate=0.1, seed=9)
    assert out["total"] <= out["bound"] + 1e-9
    assert out["compression_ratio"] > 1.0

    # 重构后的负载转速仍能恢复振荡频率 ±1 bin
    t = np.arange(X_test.shape[1]) / 200.0  # 每 20 个 5e-4 步长 ≈ 0.01 s
    f_peak, _, _, _ = spectral_peak(t, np.asarray(out["X_hat"])[2], 100.0)
    assert abs(f_peak - torsional_frequency(p)) <= 0.5
