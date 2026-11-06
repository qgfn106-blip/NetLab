import numpy as np

from mathspec.integrate import backward_euler, verlet


def test_backward_euler_order_RC():
    R = C = 1.0
    Vs = 1.0
    f = lambda t, x: np.array([(Vs - x[0]) / (R * C)])

    def err(dt):
        ts, xs = backward_euler(f, np.array([0.0]), 0.0, 2.0, dt)
        v = xs[:, 0]
        va = Vs * (1 - np.exp(-ts / (R * C)))
        return np.max(np.abs(v - va))

    e1, e2 = err(0.1), err(0.05)
    ratio = e1 / e2
    # 后向欧拉 1 阶：步长减半，误差约减半
    assert 1.4 < ratio < 3.0
    assert e2 < 0.05


def test_verlet_energy_conservation():
    k = m = 1.0
    accel = lambda t, x: np.array([-k / m * x[0]])
    ts, xs, vs = verlet(accel, np.array([1.0]), np.array([0.0]), 0.0, 20.0, 0.01)
    E = 0.5 * m * vs[:, 0] ** 2 + 0.5 * k * xs[:, 0] ** 2
    assert np.max(np.abs(E - E[0])) < 1e-2
