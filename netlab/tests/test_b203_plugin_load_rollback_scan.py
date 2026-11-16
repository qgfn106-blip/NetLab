"""REM-B2-03：插件加载事务回滚 / 扫描幂等 / stale 语义复现测试（RED→GREEN）。

放行要点：_load_record 事务回滚后必须 re-raise（不本层吞）；版本变化保留旧 loaded 记录并
标 stale、绝不自动 reload；disabled 跨 scan 保持；scan 合并 _records 条目稳定；unload_all
须清理失败残留（registered 非空但 status=error 的记录）。
"""
import json
import shutil
from pathlib import Path

import pytest

from netlab.core.model import plugins as P
from netlab.core.model import engine_registry as ER

_GOOD = '''from netlab.plugin_api.v1 import EngineSpec
def register(ctx):
    ctx.register_engine(EngineSpec(mode="{mode}", label="L", description="D", factory=lambda s: s))
'''
_FAIL = '''from netlab.plugin_api.v1 import EngineSpec
def register(ctx):
    ctx.register_engine(EngineSpec(mode="{mode}", label="L", description="D", factory=lambda s: s))
    ctx.register_engine(EngineSpec(mode="{mode}", label="L", description="D", factory=lambda s: s))
'''


def _make_plugin(root: Path, pid: str, mode: str, body: str, version: str = "0.1.0") -> Path:
    d = root / pid
    d.mkdir(parents=True)
    (d / "plugin.json").write_text(
        json.dumps({
            "schema": "netlab-plugin/1", "id": pid, "name": "Demo",
            "version": version, "plugin_api": "1.0", "netlab": ">=3.0.0",
            "entry": "plugin:register", "capabilities": ["engine"],
        }),
        encoding="utf-8",
    )
    (d / "plugin.py").write_text(body.format(mode=mode), encoding="utf-8")
    return d


@pytest.fixture
def mode():
    name = "b203mode"
    yield name
    ER.ENGINE_SPECS.pop(name, None)
    ER.ENGINE_OWNERS.pop(name, None)


def _manager(root: Path) -> P.PluginManager:
    return P.PluginManager(root=root, data_root=root / "data")


def test_1_partial_engine_failure_zero_residue(tmp_path, mode):
    _make_plugin(tmp_path, "com.example.b203fail", mode, _FAIL)
    pm = _manager(tmp_path)
    pm.scan(load=True)
    rec = pm._records["com.example.b203fail"]
    assert rec.status == "error"
    assert rec.registered == {}
    assert mode not in ER.ENGINE_SPECS
    assert mode not in ER.ENGINE_OWNERS


def test_2_reload_bad_plugin_raises_and_no_residue(tmp_path, mode):
    _make_plugin(tmp_path, "com.example.b203fail", mode, _FAIL)
    pm = _manager(tmp_path)
    pm.scan(load=False)
    with pytest.raises(Exception):
        pm.reload("com.example.b203fail")
    assert mode not in ER.ENGINE_SPECS
    assert mode not in ER.ENGINE_OWNERS


def test_3_unload_all_cleans_failed_residue(tmp_path, mode):
    _make_plugin(tmp_path, "com.example.b203fail", mode, _FAIL)
    pm = _manager(tmp_path)
    pm.scan(load=True)
    pm.unload_all()
    assert mode not in ER.ENGINE_SPECS
    assert mode not in ER.ENGINE_OWNERS
    assert "com.example.b203fail" not in pm._modules


def test_4_scan_twice_idempotent(tmp_path, mode):
    _make_plugin(tmp_path, "com.example.b203good", mode, _GOOD)
    pm = _manager(tmp_path)
    pm.scan(load=True)
    first = set(pm._records)
    pm.scan(load=True)
    assert set(pm._records) == first == {"com.example.b203good"}
    assert len(pm._records) == 1
    assert mode in ER.ENGINE_SPECS


def test_5_directory_removed_unloads_and_drops(tmp_path, mode):
    d = _make_plugin(tmp_path, "com.example.b203good", mode, _GOOD)
    pm = _manager(tmp_path)
    pm.scan(load=True)
    assert mode in ER.ENGINE_SPECS
    shutil.rmtree(d)
    pm.scan(load=True)
    assert "com.example.b203good" not in pm._records
    assert mode not in ER.ENGINE_SPECS


def test_6_disabled_persists_across_scans(tmp_path, mode):
    _make_plugin(tmp_path, "com.example.b203good", mode, _GOOD)
    pm = _manager(tmp_path)
    pm._disabled.add("com.example.b203good")
    pm.scan(load=True)
    assert pm._records["com.example.b203good"].status == "disabled"
    pm.scan(load=True)
    assert pm._records["com.example.b203good"].status == "disabled"
    assert mode not in ER.ENGINE_SPECS


def test_7_version_change_marks_stale_without_reload(tmp_path, mode):
    d = _make_plugin(tmp_path, "com.example.b203good", mode, _GOOD, version="0.1.0")
    pm = _manager(tmp_path)
    pm.scan(load=True)
    pid = "com.example.b203good"
    assert pm._records[pid].status == "loaded"
    # 改动版本号后重新扫描：保留旧 loaded 记录 + stale=True，不自动 reload
    (d / "plugin.json").write_text(
        json.dumps({
            "schema": "netlab-plugin/1", "id": pid, "name": "Demo",
            "version": "0.2.0", "plugin_api": "1.0", "netlab": ">=3.0.0",
            "entry": "plugin:register", "capabilities": ["engine"],
        }),
        encoding="utf-8",
    )
    pm.scan(load=False)
    rec = pm._records[pid]
    assert rec.status == "loaded"
    assert rec.stale is True
    assert rec.manifest.version == "0.1.0"
    assert pm._records[pid].summary()["stale"] is True
