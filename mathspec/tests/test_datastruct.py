"""数据结构验收：并查集 / 堆 / 环形缓冲 / LRU / CSR 不变量。"""
import numpy as np

from mathspec.experiments.datastruct import (
    BinaryHeap, LRUCache, RingBuffer, UnionFind, benchmark_heap, benchmark_ring,
    benchmark_union_find, csr_from_triplets, csr_matvec,
)


def test_union_find_matches_naive_components():
    rng = np.random.default_rng(3)
    n = 200
    uf = UnionFind(n)
    parent = list(range(n))

    def find_naive(x):
        while parent[x] != x:
            x = parent[x]
        return x

    for _ in range(400):
        a, b = int(rng.integers(0, n)), int(rng.integers(0, n))
        merged = uf.union(a, b)
        ra, rb = find_naive(a), find_naive(b)
        if ra != rb:
            parent[rb] = ra
        u, v = int(rng.integers(0, n)), int(rng.integers(0, n))
        assert uf.connected(u, v) == (find_naive(u) == find_naive(v))
    roots = {find_naive(i) for i in range(n)}
    assert uf.components == len(roots)
    assert uf.check_invariants()


def test_binary_heap_pops_sorted():
    rng = np.random.default_rng(4)
    vals = rng.random(1000).tolist()
    h = BinaryHeap()
    for v in vals:
        h.push(v)
    out = [h.pop() for _ in range(len(vals))]
    assert out == sorted(vals)
    assert h.check_invariants()


def test_ring_buffer_overwrites_oldest():
    rb = RingBuffer(4)
    for i in range(6):
        rb.push(i)
    assert len(rb) == 4
    assert rb.snapshot() == [2, 3, 4, 5]


def test_lru_cache_evicts_least_recent():
    c = LRUCache(2)
    c.put("a", 1); c.put("b", 2)
    assert c.get("a") == 1              # a 变为最近使用
    c.put("c", 3)                       # 淘汰 b
    assert c.get("b") is None
    assert c.keys() == ["a", "c"]
    assert c.hits == 1 and c.misses == 1


def test_csr_triplets_and_matvec():
    rows = [0, 0, 0, 1, 2, 2]
    cols = [0, 1, 1, 2, 0, 2]
    vals = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]   # (0,1) 重复 → 5
    csr = csr_from_triplets(rows, cols, vals, (3, 3))
    x = np.array([1.0, 2.0, 3.0])
    y = csr_matvec(csr, x)
    assert np.allclose(y, np.array([1 * 1 + 5 * 2, 4 * 3, 5 * 1 + 6 * 3]))


def test_data_structure_benchmarks_run():
    uf = benchmark_union_find(n=20000, seed=1)
    assert uf["ops"] == 20000 and uf["seconds"] > 0
    hp = benchmark_heap(n=10000)
    assert hp["seconds"] > 0
    rb = benchmark_ring(n=50000)
    assert rb["len"] == rb["capacity"]
