"""M1：端口推导单一来源（iter_interface_nodes）一致性测试。

确保 derive_ports / BlockRuntime._build / block_validate._interface_ports 三处
都从同一 iter_interface_nodes 纯函数派生，行为一致（名称集合一一对应）。
"""
from __future__ import annotations

from netlab.core.model.blocks import derive_ports, iter_interface_nodes
from netlab.core.model.block_validate import _interface_ports
from netlab.core.model.builtins import builtin_blocks


def _port_names(nodes):
    return {str(p.name) for p in derive_ports(nodes, [])}


def test_builtins_three_derivations_agree():
    for block in builtin_blocks():
        iter_names = {
            str(v["params"].get("port_name") or v["node_name"] or "port")
            for v in iter_interface_nodes(block.nodes)
        }
        assert iter_names == _port_names(block.nodes), block.id
        assert _interface_ports(block) == _port_names(block.nodes), block.id


def test_iter_filters_non_interface_and_non_module():
    nodes = [
        {"id": "i1", "name": "A", "kind": "module_input", "params": {"role": "interface"}},
        {"id": "n1", "name": "B", "kind": "module_input", "params": {"role": "internal"}},
        {"id": "n2", "name": "C", "kind": "sum", "params": {}},
        {"id": "o1", "name": "D", "kind": "module_output", "params": {"role": "interface"}},
    ]
    views = list(iter_interface_nodes(nodes))
    assert [v["node_id"] for v in views] == ["i1", "o1"]
    assert [v["kind"] for v in views] == ["module_input", "module_output"]


def test_default_role_is_interface():
    nodes = [{"id": "i1", "name": "A", "kind": "module_input", "params": {}}]
    assert len(list(iter_interface_nodes(nodes))) == 1
