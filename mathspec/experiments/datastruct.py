"""数据结构原型：并查集 / 二叉堆 / 环形缓冲 / LRU / CSR。

配套规范 §15 与 PERFORMANCE §32；只依赖标准库 + numpy，不 import netlab。
"""
from __future__ import annotations

import heapq
from collections import OrderedDict
import numpy as np


class UnionFind:
    """带路径压缩 + 按大小合并的并查集（amortized α(n)）。"""

    def __init__(self, n: int):
        self.parent = list(range(n))
        self.size = [1] * n
        self.components = n

    def find(self, x: int) -> int:
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:          # 路径压缩（迭代版）
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a: int, b: int) -> bool:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        if self.size[ra] < self.size[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        self.size[ra] += self.size[rb]
        self.components -= 1
        return True

    def connected(self, a: int, b: int) -> bool:
        return self.find(a) == self.find(b)

    def check_invariants(self) -> bool:
        n = len(self.parent)
        roots = [i for i in range(n) if self.parent[i] == i]
        if len(roots) != self.components:
            return False
        for i in range(n):
            if self.parent[i] != i and self.size[i] != 1:
                # 非根节点的 size 字段不维护，属于实现取舍
                pass
        return all(self.find(i) in roots for i in range(n))


class BinaryHeap:
    """最小二叉堆（heapq 包装，带不变量自检）。"""

    def __init__(self):
        self.data = []

    def push(self, item):
        heapq.heappush(self.data, item)

    def pop(self):
        return heapq.heappop(self.data)

    def peek(self):
        return self.data[0]

    def __len__(self):
        return len(self.data)

    def check_invariants(self) -> bool:
        n = len(self.data)
        for i in range(1, n):
            if self.data[(i - 1) // 2] > self.data[i]:
                return False
        return True


class RingBuffer:
    """定长环形缓冲：满后覆盖最旧数据，snapshot() 返回从旧到新。"""

    def __init__(self, capacity: int):
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        self.capacity = int(capacity)
        self._buf = [None] * self.capacity
        self._start = 0
        self._len = 0

    def push(self, value):
        if self._len < self.capacity:
            self._buf[(self._start + self._len) % self.capacity] = value
            self._len += 1
        else:
            self._buf[self._start] = value
            self._start = (self._start + 1) % self.capacity

    def __len__(self):
        return self._len

    def snapshot(self) -> list:
        return [self._buf[(self._start + i) % self.capacity] for i in range(self._len)]


class LRUCache:
    """LRU 缓存（OrderedDict 实现，O(1) get/put）。"""

    def __init__(self, capacity: int):
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        self.capacity = int(capacity)
        self._data = OrderedDict()
        self.hits = 0
        self.misses = 0

    def get(self, key):
        if key in self._data:
            self._data.move_to_end(key)
            self.hits += 1
            return self._data[key]
        self.misses += 1
        return None

    def put(self, key, value):
        if key in self._data:
            self._data.move_to_end(key)
            self._data[key] = value
        else:
            self._data[key] = value
            if len(self._data) > self.capacity:
                self._data.popitem(last=False)

    def __len__(self):
        return len(self._data)

    def keys(self):
        return list(self._data.keys())


def csr_from_triplets(rows, cols, vals, shape):
    """由三元组构造 CSR，重复项按求和合并（与 scipy coo→csr 语义一致）。"""
    rows = np.asarray(rows, int)
    cols = np.asarray(cols, int)
    vals = np.asarray(vals, float)
    n_rows, n_cols = shape
    order = np.lexsort((cols, rows))
    rows, cols, vals = rows[order], cols[order], vals[order]
    indptr = np.zeros(n_rows + 1, dtype=int)
    data = []
    indices = []
    last_row = -1
    for r, c, v in zip(rows, cols, vals):
        while last_row < r:
            last_row += 1
            indptr[last_row] = len(data)
        if indices and indices[-1] == c and last_row == r:
            data[-1] += float(v)
        else:
            indices.append(int(c))
            data.append(float(v))
    while last_row + 1 <= n_rows:
        last_row += 1
        indptr[last_row] = len(data)
    return indptr, np.asarray(indices, int), np.asarray(data, float), shape


def csr_matvec(csr, x):
    indptr, indices, data, (m, n) = csr
    x = np.asarray(x, float)
    out = np.zeros(m)
    for i in range(m):
        s = 0.0
        for k in range(indptr[i], indptr[i + 1]):
            s += data[k] * x[indices[k]]
        out[i] = s
    return out


def benchmark_union_find(n: int = 200000, seed: int = 0, clock=__import__("time").perf_counter):
    """随机 union/find 混合操作基准。"""
    import random
    rng = random.Random(seed)
    uf = UnionFind(n)
    t0 = clock()
    ops = 0
    for _ in range(n):
        a, b = rng.randrange(n), rng.randrange(n)
        if rng.random() < 0.5:
            uf.union(a, b)
        else:
            uf.connected(a, b)
        ops += 1
    return {"n": n, "ops": ops, "seconds": clock() - t0, "components": uf.components}


def benchmark_heap(n: int = 100000, seed: int = 0, clock=__import__("time").perf_counter):
    import random
    rng = random.Random(seed)
    h = BinaryHeap()
    t0 = clock()
    for _ in range(n):
        h.push(rng.random())
    for _ in range(n):
        h.pop()
    return {"n": n, "seconds": clock() - t0}


def benchmark_ring(n: int = 500000, clock=__import__("time").perf_counter):
    rb = RingBuffer(4096)
    t0 = clock()
    for i in range(n):
        rb.push(i)
    return {"pushes": n, "capacity": rb.capacity, "seconds": clock() - t0, "len": len(rb)}
