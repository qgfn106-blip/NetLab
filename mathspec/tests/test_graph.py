import numpy as np

import mathspec.graph as g


def test_ext_isolation():
    n = g.Node(id="n1", kind="gain")
    n.set_ext("pluginA", {"k": 1})
    assert n.get_ext("pluginA") == {"k": 1}
    assert n.get_ext("pluginB") is None


def test_connector_cluster_merge():
    G = g.Graph()
    pt = g.PortType("V", "A")
    G.add_node(g.Node("a", "resistor", ports={"p1": g.Port("p1", pt)}))
    G.add_node(g.Node("b", "resistor", ports={"p1": g.Port("p1", pt), "p2": g.Port("p2", pt)}))
    G.connect(("a", "p1"), ("b", "p1"))
    G.connect(("b", "p1"), ("b", "p2"))
    clusters = G.clusters()
    assert len(clusters) == 1
    assert len(clusters[0]) == 3
    assert len(G.potential_variables()) == 1
