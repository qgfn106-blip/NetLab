import itertools

import numpy as np
import pytest

from mathspec.experiments.observability import (
    availability_weighted_information_matrices,
    finite_horizon_observability,
    information_objective,
    logdet_probe_selection,
    sensor_information_matrices,
)


def test_gramian_equals_stacked_observability_matrix_product():
    A = np.array([[1.0, 0.2], [0.0, 0.9]])
    C = np.array([[1.0, 0.0], [0.0, 1.0]])
    W, O = finite_horizon_observability(A, C, horizon=5)
    assert np.allclose(W, O.T @ O, atol=1e-12)
    assert np.allclose(W, W.T, atol=1e-14)
    assert np.min(np.linalg.eigvalsh(W)) >= -1e-12


def test_weighted_gramian_matches_whitened_observability_matrix():
    A = np.array([[1.0, 0.25], [-0.1, 0.8]])
    C = np.array([[1.0, 0.0], [0.5, 1.0]])
    R = np.array([[0.4, 0.05], [0.05, 0.8]])
    W, O = finite_horizon_observability(A, C, 4, R)
    R_inv = np.linalg.inv(R)
    expected = sum((O[k * 2:(k + 1) * 2].T @ R_inv @ O[k * 2:(k + 1) * 2] for k in range(4)))
    assert np.allclose(W, expected, atol=1e-12)
    assert np.min(np.linalg.eigvalsh(W)) > 0


def test_sensor_selection_is_monotone_and_submodular_by_exhaustion():
    rng = np.random.default_rng(20261106)
    A = np.array([[1.0, 0.2], [0.0, 0.85]])
    sensors = rng.normal(size=(5, 2))
    grams = sensor_information_matrices(A, sensors, horizon=3, variances=np.array([0.5, 1, 2, 0.75, 1.5]))
    prior = np.diag([0.7, 1.3])
    n = len(grams)
    subsets = [set(c) for r in range(n + 1) for c in itertools.combinations(range(n), r)]
    values = {frozenset(S): information_objective(grams, S, prior) for S in subsets}
    for S in subsets:
        for i in range(n):
            if i not in S:
                assert values[frozenset(S | {i})] >= values[frozenset(S)] - 1e-12
        for T in subsets:
            if S <= T:
                for i in range(n):
                    if i not in T:
                        gain_S = values[frozenset(S | {i})] - values[frozenset(S)]
                        gain_T = values[frozenset(T | {i})] - values[frozenset(T)]
                        assert gain_S + 1e-11 >= gain_T


def test_greedy_selection_returns_valid_nonincreasing_marginals():
    A = np.array([[1.0, 0.1], [0.0, 0.9]])
    sensors = np.array([[1.0, 0.0], [0.0, 1.0], [1.0, 1.0], [1.0, -1.0]])
    grams = sensor_information_matrices(A, sensors, horizon=4)
    result = logdet_probe_selection(grams, budget=3)
    assert len(result["selected"]) == 3
    assert len(set(result["selected"])) == 3
    assert all(g >= 0 for g in result["marginal_gains"])
    assert np.all(np.diff(result["marginal_gains"]) <= 1e-10)
    assert np.isclose(result["objective"], information_objective(grams, result["selected"]))


def test_single_probe_observability_rank_and_unobservable_mode():
    A = np.array([[1.0, 0.0], [0.0, 0.9]])
    C = np.array([[1.0, 0.0]])
    W, O = finite_horizon_observability(A, C, horizon=8)
    assert np.linalg.matrix_rank(O) == 1
    assert np.linalg.matrix_rank(W) == 1
    assert np.isclose(W[1, 1], 0.0)




def test_availability_weighting_has_expected_scaling_and_preserves_psd():
    grams = np.asarray([
        [[2.0, 0.5], [0.5, 1.0]],
        [[1.0, 0.0], [0.0, 3.0]],
    ])
    probabilities = np.array([0.0, 0.25])
    weighted = availability_weighted_information_matrices(grams, probabilities)
    assert np.allclose(weighted[0], 0.0)
    assert np.allclose(weighted[1], 0.25 * grams[1])
    assert all(np.min(np.linalg.eigvalsh(w)) >= -1e-12 for w in weighted)
    assert information_objective(weighted, [0, 1]) == pytest.approx(
        information_objective(grams * probabilities[:, None, None], [0, 1]))


@pytest.mark.parametrize("probabilities", [
    np.array([-0.01, 0.5]), np.array([0.5, 1.01]),
    np.array([np.nan, 0.5]), np.array([0.5]),
])
def test_availability_weighting_rejects_invalid_probability_vector(probabilities):
    grams = np.asarray([np.eye(2), 2.0 * np.eye(2)])
    with pytest.raises(ValueError, match="availability_probabilities"):
        availability_weighted_information_matrices(grams, probabilities)


def test_availability_weighting_rejects_nonsymmetric_or_indefinite_grams():
    with pytest.raises(ValueError):
        availability_weighted_information_matrices(
            [np.array([[1.0, 2.0], [0.0, 1.0]])], np.array([1.0]))
    with pytest.raises(ValueError):
        availability_weighted_information_matrices(
            [np.diag([1.0, -1.0])], np.array([1.0]))


def test_validation_rejects_invalid_noise_budget_and_covariance():
    A = np.eye(2)
    C = np.eye(2)
    with pytest.raises(ValueError, match="positive integer"):
        finite_horizon_observability(A, C, 0)
    with pytest.raises(ValueError, match="positive definite"):
        finite_horizon_observability(A, C, 2, np.zeros((2, 2)))
    with pytest.raises(ValueError, match="positive finite"):
        sensor_information_matrices(A, C, 2, np.array([1.0, 0.0]))
    grams = sensor_information_matrices(A, C, 2)
    with pytest.raises(ValueError, match="positive definite"):
        logdet_probe_selection(grams, 1, np.zeros((2, 2)))
