"""B3 M2：BlockRuntime.compile 统一入口与直接构造等价。"""
from __future__ import annotations

import copy

from netlab.core.model.blocks import BlockRuntime, BlockStore
from netlab.core.model.builtins import builtin_blocks


def test_compile_equivalent_to_init():
    block = builtin_blocks()[0]
    store = BlockStore(); store.add(copy.deepcopy(block))
    a = BlockRuntime.compile(block, store, depth=0, internal_sim=True)
    b = BlockRuntime(block, store, depth=0, internal_sim=True)
    assert type(a) is BlockRuntime and type(b) is BlockRuntime
    assert a._input_nodes == b._input_nodes
    assert a._output_nodes == b._output_nodes
    assert (a.depth, a.internal_sim) == (b.depth, b.internal_sim)


def test_compile_propagates_depth_limit():
    block = builtin_blocks()[0]
    store = BlockStore(); store.add(copy.deepcopy(block))
    from netlab.core.model.blocks import MAX_BLOCK_DEPTH
    from netlab.core.common.limits import ComputeError
    import pytest
    with pytest.raises(ComputeError):
        BlockRuntime.compile(block, store, depth=MAX_BLOCK_DEPTH + 1)
