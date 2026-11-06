"""有限时域 LTI 可观测性与 D-optimal 探针选择原型。

模型针对初值 x_0 的确定性离散 LTI：x[k+1] = A x[k]；测量噪声独立、零均值、协方差已知。
不包含过程噪声、传感器间相关噪声或非线性模型。
"""
from __future__ import annotations

from typing import Iterable

import numpy as np


def _square_matrix(name: str, value: np.ndarray) -> np.ndarray:
    matrix = np.asarray(value, dtype=float)
    if matrix.ndim != 2 or matrix.shape[0] != matrix.shape[1]:
        raise ValueError(f"{name} must be a square matrix")
    if not np.all(np.isfinite(matrix)):
        raise ValueError(f"{name} must contain only finite values")
    return matrix


def finite_horizon_observability(
    A: np.ndarray,
    C: np.ndarray,
    horizon: int,
    measurement_covariance: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Return ``(W, O)`` for samples k=0,...,horizon-1.

    W = sum_k (A^k)^T C^T R^-1 C A^k.  For R=I this is O.T @ O,
    where O is the stacked finite-horizon observability matrix.
    """
    A = _square_matrix("A", A)
    C = np.asarray(C, dtype=float)
    if C.ndim != 2 or C.shape[1] != A.shape[0] or C.shape[0] == 0:
        raise ValueError("C must be a non-empty 2D matrix with n columns")
    if not np.all(np.isfinite(C)):
        raise ValueError("C must contain only finite values")
    if not isinstance(horizon, (int, np.integer)) or horizon < 1:
        raise ValueError("horizon must be a positive integer")
    m = C.shape[0]
    if measurement_covariance is None:
        R_inv = np.eye(m)
    else:
        R = _square_matrix("measurement_covariance", measurement_covariance)
        if R.shape != (m, m) or not np.allclose(R, R.T, atol=1e-12, rtol=1e-12):
            raise ValueError("measurement_covariance must be symmetric and match C rows")
        if np.min(np.linalg.eigvalsh(R)) <= 0.0:
            raise ValueError("measurement_covariance must be positive definite")
        R_inv = np.linalg.solve(R, np.eye(m))

    blocks = []
    gramian = np.zeros_like(A)
    A_power = np.eye(A.shape[0])
    for _ in range(int(horizon)):
        block = C @ A_power
        blocks.append(block)
        gramian += block.T @ R_inv @ block
        A_power = A @ A_power
    observability = np.vstack(blocks)
    return (gramian + gramian.T) * 0.5, observability


def sensor_information_matrices(
    A: np.ndarray,
    sensor_rows: np.ndarray,
    horizon: int,
    variances: np.ndarray | None = None,
) -> np.ndarray:
    """Build one PSD finite-horizon information increment per scalar probe.

    Each candidate sensor is observed at every time in the horizon with
    independent Gaussian noise of its listed variance.
    """
    A = _square_matrix("A", A)
    sensors = np.asarray(sensor_rows, dtype=float)
    if sensors.ndim != 2 or sensors.shape[1] != A.shape[0] or sensors.shape[0] == 0:
        raise ValueError("sensor_rows must have shape (n_sensors, state_dim)")
    if not np.all(np.isfinite(sensors)):
        raise ValueError("sensor_rows must contain only finite values")
    if not isinstance(horizon, (int, np.integer)) or horizon < 1:
        raise ValueError("horizon must be a positive integer")
    if variances is None:
        variances = np.ones(sensors.shape[0])
    variances = np.asarray(variances, dtype=float)
    if variances.shape != (sensors.shape[0],) or not np.all(np.isfinite(variances)) or np.any(variances <= 0):
        raise ValueError("variances must be positive finite values, one per sensor")

    increments = []
    for row, variance in zip(sensors, variances):
        _, O = finite_horizon_observability(A, row[None, :], horizon)
        increments.append((O.T @ O) / variance)
    return np.asarray(increments)


def _validated_psd_increments(sensor_grams: Iterable[np.ndarray]) -> np.ndarray:
    grams = np.asarray(list(sensor_grams), dtype=float)
    if grams.ndim != 3 or grams.shape[0] == 0 or grams.shape[1] != grams.shape[2]:
        raise ValueError("sensor_grams must have shape (n_sensors, n, n)")
    if not np.all(np.isfinite(grams)):
        raise ValueError("sensor_grams must contain only finite values")
    for gram in grams:
        if not np.allclose(gram, gram.T, atol=1e-10, rtol=1e-10):
            raise ValueError("each sensor information matrix must be symmetric")
        if np.min(np.linalg.eigvalsh((gram + gram.T) * 0.5)) < -1e-9:
            raise ValueError("each sensor information matrix must be positive semidefinite")
    return (grams + grams.transpose(0, 2, 1)) * 0.5


def availability_weighted_information_matrices(
        sensor_grams: Iterable[np.ndarray],
        availability_probabilities: np.ndarray) -> np.ndarray:
    """Return expected information increments under independent packet loss.

    Each sensor's complete observation window is delivered with its stated
    Bernoulli probability; a missing window contributes zero information.
    Thus E[W_i] = p_i W_i. This is the expected information-matrix surrogate,
    not E[logdet(P0 + sum W_i)]; the latter generally differs. PSD increments
    remain PSD, so the resulting deterministic log-det set function is still
    monotone submodular. Probabilities are exogenous and sensor windows do not
    share a failure event.
    """
    grams = _validated_psd_increments(sensor_grams)
    probabilities = np.asarray(availability_probabilities, dtype=float)
    if (probabilities.shape != (grams.shape[0],)
            or not np.all(np.isfinite(probabilities))
            or np.any(probabilities < 0.0) or np.any(probabilities > 1.0)):
        raise ValueError("availability_probabilities must be finite values in [0,1]")
    return grams * probabilities[:, None, None]


def logdet_probe_selection(
    sensor_grams: Iterable[np.ndarray],
    budget: int,
    prior_precision: np.ndarray | None = None,
) -> dict[str, object]:
    """Greedy cardinality-constrained log-det information gain.

    Maximizes approximately F(S)=logdet(P0 + sum_{i in S} W_i)-logdet(P0),
    where P0 is positive-definite prior precision.  For PSD increments this
    objective is normalized, monotone, and submodular; greedy has the classical
    (1-1/e) cardinality approximation guarantee for exact arithmetic.
    """
    grams = _validated_psd_increments(sensor_grams)
    n_sensors, n, _ = grams.shape
    if not isinstance(budget, (int, np.integer)) or budget < 0:
        raise ValueError("budget must be a non-negative integer")
    budget = min(int(budget), n_sensors)
    if prior_precision is None:
        prior = np.eye(n)
    else:
        prior = _square_matrix("prior_precision", prior_precision)
        if prior.shape != (n, n) or not np.allclose(prior, prior.T, atol=1e-10, rtol=1e-10):
            raise ValueError("prior_precision must be symmetric and match sensor dimensions")
        if np.min(np.linalg.eigvalsh(prior)) <= 0.0:
            raise ValueError("prior_precision must be positive definite")
    base_sign, base_logdet = np.linalg.slogdet(prior)
    if base_sign <= 0:
        raise ValueError("prior_precision must have positive determinant")

    info = prior.copy()
    chosen: list[int] = []
    gains: list[float] = []
    remaining = set(range(n_sensors))
    for _ in range(budget):
        current_sign, current_logdet = np.linalg.slogdet(info)
        if current_sign <= 0:
            raise ArithmeticError("accumulated information matrix lost positive definiteness")
        best_index = -1
        best_gain = -np.inf
        for index in sorted(remaining):
            sign, logdet = np.linalg.slogdet(info + grams[index])
            if sign <= 0:
                raise ArithmeticError("candidate information matrix is not positive definite")
            gain = float(logdet - current_logdet)
            if gain > best_gain:
                best_gain, best_index = gain, index
        # Roundoff can produce a tiny negative marginal despite PSD increments.
        best_gain = max(0.0, best_gain)
        chosen.append(best_index)
        gains.append(best_gain)
        info += grams[best_index]
        remaining.remove(best_index)
    sign, total_logdet = np.linalg.slogdet(info)
    if sign <= 0:
        raise ArithmeticError("selected information matrix lost positive definiteness")
    return {
        "selected": chosen,
        "marginal_gains": gains,
        "objective": float(total_logdet - base_logdet),
        "information": info,
    }


def information_objective(
    sensor_grams: Iterable[np.ndarray],
    selected: Iterable[int],
    prior_precision: np.ndarray | None = None,
) -> float:
    """Evaluate the regularized log-det information gain for an index set."""
    grams = _validated_psd_increments(sensor_grams)
    n_sensors, n, _ = grams.shape
    prior = np.eye(n) if prior_precision is None else _square_matrix("prior_precision", prior_precision)
    if prior.shape != (n, n) or not np.allclose(prior, prior.T, atol=1e-10, rtol=1e-10):
        raise ValueError("prior_precision must be symmetric and match sensor dimensions")
    if np.min(np.linalg.eigvalsh(prior)) <= 0.0:
        raise ValueError("prior_precision must be positive definite")
    indices = list(selected)
    if len(set(indices)) != len(indices) or any(not isinstance(i, (int, np.integer)) or i < 0 or i >= n_sensors for i in indices):
        raise ValueError("selected must contain unique valid sensor indices")
    before = np.linalg.slogdet(prior)
    after = np.linalg.slogdet(prior + sum((grams[i] for i in indices), start=np.zeros_like(prior)))
    if before[0] <= 0 or after[0] <= 0:
        raise ArithmeticError("information matrix must be positive definite")
    return float(after[1] - before[1])
