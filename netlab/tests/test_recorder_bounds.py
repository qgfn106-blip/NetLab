from netlab.core.compute.simulation import Recorder


def test_recorder_drops_oldest_and_counts_overflow():
    rec = Recorder(capacity=2)
    for index in range(3):
        rec.push(float(index), {"n:a:v": float(index)})
    assert [frame["seq"] for frame in rec.frames] == [2, 3]
    assert rec.dropped == 1
    assert rec.keys() == ["n:a:v"]


def test_recorder_snapshot_restore_preserves_dropped():
    rec = Recorder(capacity=2)
    for index in range(3):
        rec.push(float(index), {"n:a:v": float(index)})
    snap = rec.snapshot()
    rec.clear()
    rec.restore(snap)
    assert rec.dropped == 1
    assert [frame["seq"] for frame in rec.frames] == [2, 3]
