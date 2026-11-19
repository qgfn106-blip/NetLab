"""分析结果导出：CSV/JSON/Spec/位图与打包清单。"""

from __future__ import annotations

import csv
import io
import json
import zipfile

import pytest

from netlab.core.common.limits import ValidationError
from netlab.core.compute.circuit.analysis_session import AnalysisSession
from netlab.core.model.scene import Scene
from netlab.server_analysis.export_bundle import export_session
from netlab.server_analysis.workbench import _run_state


def _rc_low_pass(capacitance: float = 1.0e-6) -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(
        name="V1",
        source=vin.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 0.0, "amplitude": 1.0},
    )
    scene.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0})
    scene.add_edge(name="C1", source=out.id, target=gnd.id, kind="capacitor", params={"C": capacitance})
    return scene


def _payload(capacitance: float = 1.0e-6, label: str = "RC") -> dict:
    return {
        "label": label,
        "circuit": _rc_low_pass(capacitance).to_payload(include_state=False),
        "input_source": "V1",
        "output": "out",
        "ranges": {"f_start": 1.0, "f_stop": 1.0e5, "points": 21},
    }


def _session_with_results(*, kinds: tuple[str, ...] = ("bode",)) -> AnalysisSession:
    session = AnalysisSession("export")
    state_a = session.add_state(_payload(1.0e-6, "1uF"))
    state_b = session.add_state(_payload(1.0e-7, "0.1uF"))
    for state in (state_a, state_b):
        for kind in kinds:
            params = {"element": "V1"} if kind in ("loop", "nyquist") else None
            session.compute(
                state.state_id,
                kind,
                lambda item, kind=kind: _run_state(item, kind, {}),
                params=params,
            )
    return session


def test_csv_export_has_rows_for_both_states() -> None:
    session = _session_with_results()
    artifact = export_session(session, format="csv", state_ids=list(session.states))
    assert artifact.media_type.startswith("text/csv")
    assert artifact.filename.endswith(".csv")
    rows = list(csv.DictReader(io.StringIO(artifact.data.decode("utf-8-sig"))))
    assert rows
    assert {row["state_label"] for row in rows} == {"1uF", "0.1uF"}
    assert {row["curve_id"] for row in rows} >= {"bode_mag", "bode_phase"}
    assert all(row["x_axis"] == "f" for row in rows)


def test_json_export_carries_manifest_and_envelopes() -> None:
    session = _session_with_results()
    artifact = export_session(
        session,
        format="json",
        state_ids=list(session.states),
        source_path="E:/demo/demo.netlab.json",
    )
    payload = json.loads(artifact.data.decode("utf-8"))
    assert payload["schema"] == "netlab-analysis-export/1"
    manifest = payload["manifest"]
    assert manifest["format"] == "json"
    assert manifest["source"]["path"] == "E:/demo/demo.netlab.json"
    assert len(manifest["result_hashes"]) == 2
    assert manifest["plotkit_version"] != "unknown"
    assert {item["kind"] for item in payload["results"]} == {"bode"}
    assert all(item["envelope"]["schema"] == "netlab-analysis-result/1" for item in payload["results"])


def test_zip_export_bundles_manifest_curves_and_results() -> None:
    session = _session_with_results()
    artifact = export_session(session, format="zip", state_ids=list(session.states))
    archive = zipfile.ZipFile(io.BytesIO(artifact.data))
    names = set(archive.namelist())
    assert {"manifest.json", "curves.csv", "results.json", "plot_spec.json"} <= names
    manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
    assert manifest["format"] == "zip"
    assert len(manifest["result_hashes"]) == 2


def test_spec_export_is_plotkit_payload() -> None:
    session = _session_with_results()
    artifact = export_session(session, format="spec")
    payload = json.loads(artifact.data.decode("utf-8"))
    assert payload["schema"] == "netlab-plotkit-export/1"
    assert payload["spec"]["figure"]["subplots"] == 2
    assert payload["datasets"]
    assert all(isinstance(values, list) for values in payload["datasets"].values())


@pytest.mark.parametrize(
    ("fmt", "magic"),
    (("png", b"\x89PNG\r\n"), ("pdf", b"%PDF-")),
)
def test_binary_export_formats(fmt: str, magic: bytes) -> None:
    session = _session_with_results()
    artifact = export_session(session, format=fmt)
    assert artifact.data.startswith(magic)


def test_svg_export() -> None:
    session = _session_with_results()
    artifact = export_session(session, format="svg")
    head = artifact.data[:400].decode("utf-8", "ignore")
    assert "<svg" in head


def test_export_requires_cached_results() -> None:
    session = AnalysisSession("empty")
    session.add_state(_payload())
    with pytest.raises(ValidationError) as excinfo:
        export_session(session, format="png")
    assert "先运行分析" in str(excinfo.value)


def test_export_rejects_unknown_format() -> None:
    session = _session_with_results()
    with pytest.raises(ValidationError) as excinfo:
        export_session(session, format="bmp")
    assert "不支持的导出格式" in str(excinfo.value)
