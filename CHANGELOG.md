# Changelog

All notable changes to Netlab are recorded here. The format follows
Keep a Changelog, and versions follow the package metadata in
`netlab/__init__.py`.

## Unreleased

### Changed

- D-2 / N-21: version now has a single source (`netlab/__init__.py`).
  `frontend/index.html` uses the `__NETLAB_VERSION__` placeholder, filled at
  response time; `UI_BUILD` is injected by the esbuild build script.
- D-2 / N-20: added `requirements.lock` generated from a clean editable
  install, plus a `tools/check_version.py` CI guard.

## 3.20.1 — 2026-11-08

### Added

- PlotKit is packaged as an official `netlab.plotkit` panel plugin under
  `extensions/plugins/` while preserving the existing vendor fallback.
- Shared `SimClock` and `SimConfig.numerical_params()` /
  `presentation_params()` APIs.
- Numerical benchmark suite (`netlab/tests/benchmarks/`) and a Python test
  workflow (`.github/workflows/python-tests.yml`).
- `VISION.md`, `MILESTONES.md`, and the hash-table optimization research
  report.

### Changed

- `SolverOptions.sparse_threshold` and `SimConfig.sparse_threshold` default
  changed from 200 to 512; explicit `sparse="on"` / `sparse="off"` behavior is
  unchanged.
- `Scene.add_edge()` now defaults `auto_delay=False`; algebraic cycles require
  explicit `auto_delay=True` or `solve_algebraic=True`.
- `Scene.solve_algebraic` is persisted in scene payloads and exposed through
  `PUT /api/scene/algebraic`.
- Recorder timestamps reflect actual sample intervals instead of nominal
  solver `dt`.
- Recorder channels use stable node/edge ids internally and map to display
  names at `Simulation.live()` / analysis boundaries, so renames do not split
  historical curves.
- `APP_BUILD` now reads `netlab.__version__`; package metadata uses the same
  dynamic version source.

### Fixed

- Removed silent signal-mode topology rewriting during scene loading.
- Added path whitelist checks for project/workspace/desktop bridge operations.
- Corrected the DSU test assertion and tightened numerical acceptance ranges.

## 3.20.0 — 2026-11-07

- Prior baseline release. See `netlab/docs/PROGRESS.md` for the detailed
  engineering history.
