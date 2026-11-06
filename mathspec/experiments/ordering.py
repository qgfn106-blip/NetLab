"""稀疏矩阵排序原型：自然序 / RCM / 最小度 / 嵌套剖分 + 符号填充计数。

用于验证"排序 → 减少 LU 填充"这一数学事实（对应 nodal.py `_solve_sparse` 的 COLAMD），
只依赖标准库 + numpy，不 import netlab。
"""
from __future__ import annotations

import heapq
import numpy as np


def grid_adjacency(nx: int, ny: int):
    """二维 nx×ny 网格（4 邻域）的邻接表，节点编号 i = y*nx + x。"""
    n = nx * ny
    adj = [set() for _ in range(n)]

    def idx(x, y):
        return y * nx + x

    for y in range(ny):
        for x in range(nx):
            v = idx(x, y)
            if x + 1 < nx:
                u = idx(x + 1, y)
                adj[v].add(u); adj[u].add(v)
            if y + 1 < ny:
                u = idx(x, y + 1)
                adj[v].add(u); adj[u].add(v)
    return adj


def elimination_fill(adj, order):
    """按给定消元顺序模拟符号分解，返回填充边数（对称结构）。"""
    a = [set(s) for s in adj]
    fill = 0
    for v in order:
        nbrs = list(a[v])
        for i in range(len(nbrs)):
            for j in range(i + 1, len(nbrs)):
                u, w = nbrs[i], nbrs[j]
                if w not in a[u]:
                    a[u].add(w); a[w].add(u)
                    fill += 1
        for u in nbrs:
            a[u].discard(v)
        a[v].clear()
    return fill


def bandwidth(adj, order):
    pos = {v: i for i, v in enumerate(order)}
    bw = 0
    for v, nbrs in enumerate(adj):
        for u in nbrs:
            bw = max(bw, abs(pos[v] - pos[u]))
    return bw


def rcm_order(adj):
    """Reverse Cuthill–McKee：从最小度节点 BFS 分层，层内按度升序，最后反转。"""
    n = len(adj)
    seen = [False] * n
    order = []
    for start in sorted(range(n), key=lambda i: len(adj[i])):
        if seen[start]:
            continue
        seen[start] = True
        queue = [start]
        head = 0
        component = []
        while head < len(queue):
            v = queue[head]; head += 1
            component.append(v)
            nbrs = sorted((u for u in adj[v] if not seen[u]), key=lambda u: len(adj[u]))
            for u in nbrs:
                if not seen[u]:
                    seen[u] = True
                    queue.append(u)
        order.extend(reversed(component))
    return order


def min_degree_order(adj):
    """贪心最小度排序：每次消去当前度最小的节点，并补全其邻域（延迟删除堆）。"""
    n = len(adj)
    a = [set(s) for s in adj]
    heap = [(len(a[i]), i) for i in range(n)]
    heapq.heapify(heap)
    removed = [False] * n
    order = []
    while heap:
        d, v = heapq.heappop(heap)
        if removed[v] or d != len(a[v]):
            continue
        removed[v] = True
        order.append(v)
        nbrs = list(a[v])
        for i in range(len(nbrs)):
            for j in range(i + 1, len(nbrs)):
                u, w = nbrs[i], nbrs[j]
                if w not in a[u]:
                    a[u].add(w); a[w].add(u)
        for u in nbrs:
            a[u].discard(v)
            heapq.heappush(heap, (len(a[u]), u))
        a[v].clear()
    return order


def nested_dissection_order(nx: int, ny: int, leaf: int = 16):
    """二维网格递归嵌套剖分：左右/上下递归 → 最后消去分隔线。"""
    n = nx * ny
    order = []

    def rec(x0, x1, y0, y1):
        w, h = x1 - x0, y1 - y0
        if w <= 0 or h <= 0:
            return
        if w * h <= leaf:
            for y in range(y0, y1):
                for x in range(x0, x1):
                    order.append(y * nx + x)
            return
        if w >= h:
            mid = x0 + w // 2
            rec(x0, mid, y0, y1)
            rec(mid + 1, x1, y0, y1)
            for y in range(y0, y1):
                order.append(y * nx + mid)
        else:
            mid = y0 + h // 2
            rec(x0, x1, y0, mid)
            rec(x0, x1, mid + 1, y1)
            for x in range(x0, x1):
                order.append(mid * nx + x)

    rec(0, nx, 0, ny)
    return order


def ordering_report(nx: int = 12, ny: int = 12):
    """在网格上对比四种排序的带宽与符号填充。"""
    adj = grid_adjacency(nx, ny)
    n = nx * ny
    variants = {
        "natural": list(range(n)),
        "rcm": rcm_order(adj),
        "min_degree": min_degree_order(adj),
        "nested_dissection": nested_dissection_order(nx, ny),
    }
    out = {}
    for name, order in variants.items():
        out[name] = {
            "bandwidth": bandwidth(adj, order),
            "fill": elimination_fill(adj, order),
        }
    return out
