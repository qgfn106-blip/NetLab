# Changelog

All notable changes to Netlab are recorded here. The format follows
Keep a Changelog, and versions follow the package metadata in
`netlab/__init__.py`.

## Unreleased

### Security

- VS Code 集成不再以 `--without-connection-token` 启动：每次拉起生成随机连接
  token（`--connection-token-file` + `?tkn=`），并停止复用 8790 上已有服务器，
  避免本机网页直连未鉴权的完整 IDE；见 `docs/VSCODE_INTEGRATION.md`。
- 桌面 token 守卫：非 ASCII token 头返回 403 而非 500；`/openapi.json`、`/docs`、
  `/redoc` 也要求 token；bootstrap 种 cookie 增加 `Secure` 与 8 小时 `Max-Age`，
  并校验 Host/Origin 必须为本机回环地址。
- 工程导入：FEM 配置在提交失败时回滚；扩展注册表被替换成 dict 子类时事务在写入
  前拒绝，回滚先校验全部注册表再清空，杜绝半提交。

### Fixed

- 梯形积分源值改为步末采样（原先与伴随模型的历史项重复计权，正弦激励收敛阶
  只有 ~1.0，现为 ~2.0）；电感首步用后向欧拉启动（阶跃激励下电感电流不再从 0
  起跳），新增 RLC 正弦/阶跃收敛阶回归用例。

### Changed

- WP-8: paired ladder/grid/star benchmarks could not prove a stable global
  benefit from raising `SolverOptions.sparse_threshold` / `SimConfig.sparse_threshold`,
  so the default stays 512; `step()` and circuit `stats()` now expose the
  selected `sparse` backend.
- WP-8: opt-in AC Woodbury fast path (`NETLAB_MATH_ACCEL_P3=on`, matrix size
  >=160, reactive ratio <=0.10) with a cheap LU-pivot condition estimate and a
  per-frequency backward-residual guard that falls back to the full solve;
  default remains `off`. Paired benchmarks: 7.9x/11.0x/8.8x at n=400/600/800
  with 200 frequencies, 1.51x for all-node probes at n=400; see
  `docs/WP8_AC_SWEEP.md`.
- D-2 / N-21: version now has a single source (`netlab/__init__.py`).
  `frontend/index.html` uses the `__NETLAB_VERSION__` placeholder, filled at
  response time; `UI_BUILD` is injected by the esbuild build script.
- D-2 / N-20: added `requirements.lock` generated from a clean editable
  install, plus a `tools/check_version.py` CI guard.

## 3.20.2 — 2026-11-14

### Fixed

- UI：深色主题对比度与浮窗缩放夹取修正。

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

- Prior baseline release. See `netlab/docs/内部进度文档（私有仓）` for the detailed
  engineering history.
