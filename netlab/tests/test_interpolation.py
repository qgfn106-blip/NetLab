"""需求④：两种中点细分插值（直接平均 / 高斯核加权）的单元测试。"""

from __future__ import annotations

import pytest

from netlab.core.compute.interpolation import METHODS, midpoint_resample, resample_multi


def test_methods_available():
    assert METHODS == ("average", "gaussian")


def test_rounds_zero_is_identity():
    assert midpoint_resample([0.0, 1.0], [2.0, 4.0], rounds=0) == ([0.0, 1.0], [2.0, 4.0])


def test_average_method_inserts_linear_midpoints():
    t, v = midpoint_resample([0.0, 1.0, 2.0], [0.0, 10.0, 20.0], method="average", rounds=1)
    assert t == [0.0, 0.5, 1.0, 1.5, 2.0]
    assert v == [0.0, 5.0, 10.0, 15.0, 20.0]


def test_gaussian_default_window_equals_average_for_uniform_grid():
    # 默认窗口=间隔中位数；对称网格上高斯权重对两端点相等 → 等价线性中点
    t_avg, v_avg = midpoint_resample([0.0, 1.0, 2.0], [0.0, 10.0, 20.0], method="average", rounds=1)
    t_g, v_g = midpoint_resample([0.0, 1.0, 2.0], [0.0, 10.0, 20.0], method="gaussian", rounds=1)
    assert t_g == t_avg
    for a, b in zip(v_g, v_avg):
        assert a == pytest.approx(b)


def test_gaussian_wide_window_blends_more_neighbors():
    t, v = midpoint_resample(
        [0.0, 1.0, 2.0, 3.0], [0.0, 0.0, 10.0, 10.0], method="gaussian", rounds=1, window=10.0
    )
    # 大窗口把邻点纳入，中点不再等于纯两端平均，但仍在全局范围内
    assert min(v) <= v[3] <= max(v)


def test_rounds_double_point_count():
    t = [float(i) for i in range(5)]
    v = [float(i) for i in range(5)]
    t1, _ = midpoint_resample(t, v, rounds=1)
    t2, _ = midpoint_resample(t, v, rounds=2)
    assert len(t1) == 2 * len(t) - 1
    assert len(t2) == 2 * len(t1) - 1


def test_resample_multi_dict_and_list():
    ts = [0.0, 1.0]
    nt, d = resample_multi(ts, {"a": [0.0, 2.0], "b": [2.0, 0.0]}, rounds=1)
    assert nt == [0.0, 0.5, 1.0]
    assert d["a"] == [0.0, 1.0, 2.0]
    assert d["b"] == [2.0, 1.0, 0.0]
    nt2, lst = resample_multi(ts, [[0.0, 2.0], [2.0, 0.0]], rounds=1)
    assert nt2 == nt and lst == [[0.0, 1.0, 2.0], [2.0, 1.0, 0.0]]


def test_invalid_inputs():
    with pytest.raises(ValueError):
        midpoint_resample([0.0, 1.0], [1.0, 2.0], method="cubic")
    with pytest.raises(ValueError):
        midpoint_resample([0.0, 1.0], [1.0, 2.0], rounds=-1)
    with pytest.raises(ValueError):
        midpoint_resample([0.0, 1.0], [1.0], rounds=1)
    with pytest.raises(ValueError):
        midpoint_resample([1.0, 0.0], [1.0, 2.0], rounds=1)

def test_gaussian_is_true_gaussian_not_exponential():
    # 真高斯：sigma 小则远端（t=2，d=1.5）权重 exp(-(1.5^2)/(2*0.3^2))≈3.7e-6 可忽略，
    # t=0.5 处只受两端 0 与 100 影响 → ≈50；旧 exp(-d) 会被远端明显拉低（≈42）。
    t, v = midpoint_resample(
        [0.0, 1.0, 2.0], [0.0, 100.0, 0.0], method="gaussian", rounds=1, window=10.0, sigma=0.3
    )
    assert v[1] == pytest.approx(50.0, abs=1.0)


def test_gaussian_sigma_must_be_positive():
    import pytest as _p

    with _p.raises(ValueError):
        midpoint_resample([0.0, 1.0], [0.0, 1.0], method="gaussian", sigma=0.0)

