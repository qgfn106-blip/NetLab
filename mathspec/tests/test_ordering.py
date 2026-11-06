"""稀疏排序验收：RCM 降带宽、最小度/嵌套剖分降填充。"""
import numpy as np

from mathspec.experiments.ordering import (
    bandwidth, elimination_fill, grid_adjacency, min_degree_order,
    nested_dissection_order, ordering_report, rcm_order,
)


def test_ordering_reduces_bandwidth_and_fill():
    rep = ordering_report(12, 12)
    natural = rep["natural"]
    assert rep["rcm"]["fill"] < natural["fill"]
    assert rep["rcm"]["bandwidth"] <= natural["bandwidth"]
    assert rep["min_degree"]["fill"] < natural["fill"]
    assert rep["nested_dissection"]["fill"] < natural["fill"]


def test_rcm_recovers_bandwidth_after_random_relabel():
    adj = grid_adjacency(12, 12)
    n = len(adj)
    perm = np.random.default_rng(5).permutation(n)
    relabeled = [set() for _ in range(n)]
    for i in range(n):
        relabeled[int(perm[i])] = {int(perm[j]) for j in adj[i]}
    bw_natural = bandwidth(relabeled, list(range(n)))
    bw_rcm = bandwidth(relabeled, rcm_order(relabeled))
    assert bw_rcm < bw_natural


def test_elimination_fill_zero_on_tree():
    # 树（无环）消元不产生任何填充
    adj = [{1}, {0, 2}, {1, 3}, {2}]
    assert elimination_fill(adj, [0, 1, 2, 3]) == 0


def test_rcm_bandwidth_of_path_is_one():
    n = 20
    adj = [set() for _ in range(n)]
    for i in range(n - 1):
        adj[i].add(i + 1); adj[i + 1].add(i)
    order = rcm_order(adj)
    assert bandwidth(adj, order) == 1
