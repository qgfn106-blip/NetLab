"""D88：缓存体检与安全清理。"""

from __future__ import annotations

import os
from pathlib import Path

from netlab import cache_guard as cg


def _mk(path: Path, files: dict[str, int]):
    path.mkdir(parents=True, exist_ok=True)
    for name, size in files.items():
        (path / name).write_bytes(b"x" * size)


def test_scan_classifies_tiers(tmp_path):
    home = tmp_path / "home"
    temp = tmp_path / "temp"
    _mk(home / ".plotkit", {"a.tmp": 100})
    _mk(home / ".plotkit-desktop", {"b.dat": 300})

    report = cg.scan(home=home, temp=temp, include_pycache=False)
    by_key = {e["key"]: e for e in report["entries"]}
    assert by_key["plotkit-cache"]["tier"] == "safe"
    assert by_key["plotkit-cache"]["bytes"] == 100
    assert by_key["plotkit-desktop"]["tier"] == "caution"
    assert by_key["plotkit-desktop"]["bytes"] == 300
    assert report["totals"] == {"safe": 100, "caution": 300}


def test_scan_marks_missing_dirs(tmp_path):
    report = cg.scan(home=tmp_path / "h", temp=tmp_path / "t", include_pycache=False)
    assert all(not e["exists"] for e in report["entries"])
    assert report["total_bytes"] == 0


def test_dry_run_does_not_delete(tmp_path):
    home = tmp_path / "home"
    temp = tmp_path / "temp"
    _mk(home / ".plotkit", {"a.tmp": 64})

    result = cg.clean(
        tiers=("safe",), dry_run=True, include_pycache=False, home=home, temp=temp
    )
    assert result["freed_bytes"] == 64
    assert result["removed"] and result["removed"][0]["dry_run"] is True
    assert (home / ".plotkit").exists()


def test_clean_deletes_only_safe_by_default(tmp_path):
    home = tmp_path / "home"
    temp = tmp_path / "temp"
    _mk(home / ".plotkit", {"a.tmp": 10})
    _mk(home / ".plotkit-desktop", {"b.dat": 20})

    result = cg.clean(
        tiers=("safe",), dry_run=False, include_pycache=False, home=home, temp=temp
    )
    assert not (home / ".plotkit").exists()
    assert (home / ".plotkit-desktop").exists(), "谨慎档默认必须保留"
    assert result["freed_bytes"] == 10


def test_caution_requires_explicit_tier(tmp_path):
    home = tmp_path / "home"
    temp = tmp_path / "temp"
    _mk(home / ".plotkit-desktop", {"b.dat": 20})
    result = cg.clean(
        tiers=("safe", "caution"),
        dry_run=False,
        include_pycache=False,
        home=home,
        temp=temp,
    )
    assert not (home / ".plotkit-desktop").exists()
    assert result["freed_bytes"] == 20


def test_protected_names_are_never_touched(tmp_path):
    assert cg._is_protected(Path("C:/x/autosave.netlab"))
    assert cg._is_protected(Path("C:/x/docs/a.md"))
    assert cg._is_protected(Path("C:/x/foo.netlab"))
    assert cg._is_protected(Path("C:/x/_vendor/plotkit"))
    assert not cg._is_protected(Path("C:/x/.plotkit-desktop"))


def test_too_shallow_guards(tmp_path):
    shallow = Path("C:/") if os.name == "nt" else Path("/")
    assert cg._too_shallow(shallow)
    assert not cg._too_shallow(tmp_path / "a" / "b" / "c" / "d")
