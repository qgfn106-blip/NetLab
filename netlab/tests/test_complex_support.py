"""R39 Complex Bridge 边界函数测试。"""

from __future__ import annotations

import numpy as np
import pytest

from netlab.core.compute import complex_support as cs


def test_scalar_conversions_accept_numeric_and_complex():
    assert cs.as_complex(2) == 2 + 0j
    assert cs.as_complex(1.5) == 1.5 + 0j
    assert cs.as_complex(1 + 2j) == 1 + 2j
    assert cs.as_complex(np.float64(0.5)) == 0.5 + 0j
    assert cs.as_complex(np.complex128(1 - 3j)) == 1 - 3j


@pytest.mark.parametrize("value", [True, False, "1.0", None, [1.0], {"x": 1}])
def test_scalar_conversions_reject_non_numeric(value):
    with pytest.raises(ValueError):
        cs.as_complex(value)


def test_array_conversion_preserves_shape_and_rejects_object_or_bool():
    array = cs.as_complex_array([[1, 2], [3, 4]])
    assert array.shape == (2, 2)
    assert array.dtype == np.complex128
    with pytest.raises(ValueError):
        cs.as_complex_array(np.array([1.0, "x"], dtype=object))
    with pytest.raises(ValueError):
        cs.as_complex_array(np.array([True, False]))


def test_as_real_accepts_tiny_imag_and_rejects_real_phase():
    assert cs.as_real(2.0 + 5e-13j) == pytest.approx(2.0)
    with pytest.raises(ValueError):
        cs.as_real(1.0 + 0.1j)


def test_complex_parts_and_map_complex():
    real, imag = cs.complex_parts([1 + 2j, 3 - 4j])
    assert real.tolist() == [1.0, 3.0]
    assert imag.tolist() == [2.0, -4.0]
    mapped = cs.map_complex({"a": [1, 2.5], "b": (3 + 1j,)})
    assert mapped["a"] == [1 + 0j, 2.5 + 0j]
    assert mapped["b"] == (3 + 1j,)


def test_phase_degrees_unwraps_and_can_be_wrapped():
    values = np.exp(1j * np.radians([350.0, 10.0, 30.0]))
    assert np.allclose(cs.phase_degrees(values), [-10.0, 10.0, 30.0])
    assert np.allclose(cs.phase_degrees(values, unwrap=False), [-10.0, 10.0, 30.0])
