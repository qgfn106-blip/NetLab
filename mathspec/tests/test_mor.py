import numpy as np

from mathspec.mor import balanced_truncation, pod


def _diff_hinf(A, B, C, Ar, Br, Cr, ws):
    vals = []
    for w in ws:
        G = C @ np.linalg.solve(1j * w * np.eye(A.shape[0]) - A, B)
        Gr = Cr @ np.linalg.solve(1j * w * np.eye(Ar.shape[0]) - Ar, Br)
        vals.append(abs(complex(G[0, 0] - Gr[0, 0])))
    return max(vals)


def test_balanced_truncation_bound():
    A = np.diag([-1.0, -2.0, -20.0, -50.0])
    B = np.array([[1.0], [1.0], [0.1], [0.05]])
    C = np.array([[1.0, 0.5, 0.2, 0.1]])
    Ar, Br, Cr, hsv, bound = balanced_truncation(A, B, C, 2)
    ws = np.logspace(-2, 3, 400)
    err = _diff_hinf(A, B, C, Ar, Br, Cr, ws)
    assert bound > 0
    # H∞ 误差界：2 * sum_{i>r} sigma_i
    assert err <= bound * 1.0001 + 1e-9


def test_pod_reconstruct():
    rng = np.random.default_rng(1)
    U = rng.normal(size=(10, 2))
    X = U @ rng.normal(size=(2, 5))
    Ur, Sr, _ = pod(X, 2)
    Xr = Ur @ Ur.T @ X
    assert np.linalg.norm(X - Xr) < 1e-8
